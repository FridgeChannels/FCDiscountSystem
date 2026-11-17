import { AutoModel, AutoProcessor, RawImage, pipeline } from '@huggingface/transformers';

const MODEL_ID = 'studioludens/birefnet-lite-512';
const MODEL_REVISION = '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7';
let modelPromise;
let depthPipelinePromise;
let depthDevice = 'webgpu';

function loadModel(device, dtype) {
  if (!modelPromise) {
    modelPromise = Promise.all([
      AutoModel.from_pretrained(MODEL_ID, {
        revision: MODEL_REVISION,
        device,
        dtype,
        progress_callback: (progress) => self.postMessage({ type: 'progress', progress }),
      }),
      AutoProcessor.from_pretrained(MODEL_ID, { revision: MODEL_REVISION }),
    ]).then(([model, processor]) => ({ model, processor })).catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

async function createMask(imageBlob) {
  try {
    const { model, processor } = await loadModel('webgpu', 'fp16');
    const image = await RawImage.fromBlob(imageBlob);
    const { pixel_values: inputImage } = await processor(image);
    const { logits } = await model({ input_image: inputImage });
    return RawImage.fromTensor(logits[0].sigmoid().mul(255).to('uint8'));
  } catch {
    modelPromise = null;
    const { model, processor } = await loadModel('wasm', 'fp32');
    const image = await RawImage.fromBlob(imageBlob);
    const { pixel_values: inputImage } = await processor(image);
    const { logits } = await model({ input_image: inputImage });
    return RawImage.fromTensor(logits[0].sigmoid().mul(255).to('uint8'));
  }
}

/*
 * BiRefNet Lite is a foreground segmentation model, so retain the alpha matte
 * as a grayscale channel and scale it to the source dimensions before compositing.
 */
async function makeCutout(blob) {
  const imageBitmap = await createImageBitmap(blob);
  const { width, height } = imageBitmap;
  const sourceCanvas = new OffscreenCanvas(width, height);
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  const mask = await createMask(blob);
  if (!mask?.data?.length || !mask.width || !mask.height) throw new Error('The product image could not be segmented.');

  const maskCanvas = new OffscreenCanvas(mask.width, mask.height);
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  const maskPixels = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let index = 0; index < mask.width * mask.height; index += 1) {
    const alpha = mask.data[index * mask.channels] ?? 0;
    const pixel = index * 4;
    maskPixels[pixel] = 255;
    maskPixels[pixel + 1] = 255;
    maskPixels[pixel + 2] = 255;
    maskPixels[pixel + 3] = alpha;
  }
  maskContext.putImageData(new ImageData(maskPixels, mask.width, mask.height), 0, 0);

  const sourcePixels = sourceContext.getImageData(0, 0, width, height);
  const scaledMaskCanvas = new OffscreenCanvas(width, height);
  const scaledMaskContext = scaledMaskCanvas.getContext('2d', { willReadFrequently: true });
  scaledMaskContext.drawImage(maskCanvas, 0, 0, width, height);
  const alphaPixels = scaledMaskContext.getImageData(0, 0, width, height).data;
  for (let index = 0; index < width * height; index += 1) {
    const pixel = index * 4;
    const sourceAlpha = sourcePixels.data[pixel + 3] / 255;
    const matteAlpha = alphaPixels[pixel + 3] / 255;
    const alpha = sourceAlpha * matteAlpha;
    if (alpha <= 0.015) {
      sourcePixels.data[pixel + 3] = 0;
      continue;
    }

    // Product photos use a white studio background. Unmix that matte from
    // partially transparent edge pixels so the cutout does not glow white
    // against the dark green hero scene.
    const foregroundAlpha = Math.max(matteAlpha, 0.08);
    for (let channel = 0; channel < 3; channel += 1) {
      const source = sourcePixels.data[pixel + channel];
      sourcePixels.data[pixel + channel] = Math.max(0, Math.min(255, Math.round((source - 255 * (1 - foregroundAlpha)) / foregroundAlpha)));
    }
    sourcePixels.data[pixel + 3] = Math.round(alpha * 255);
  }
  sourceContext.putImageData(sourcePixels, 0, 0);

  const bounds = findCropBounds(sourcePixels.data, width, height);
  if (!bounds) throw new Error('No product subject was detected in this image.');
  const croppedCanvas = new OffscreenCanvas(bounds.width, bounds.height);
  croppedCanvas.getContext('2d').drawImage(sourceCanvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return {
    blob: await croppedCanvas.convertToBlob({ type: 'image/png' }),
    crop: bounds,
  };
}

async function makeDepthMap(blob, cutoutBlob, crop) {
  const loadDepth = async (device, dtype) => pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
    device,
    dtype,
    progress_callback: (progress) => self.postMessage({ type: 'progress', progress }),
  });
  if (!depthPipelinePromise) {
    depthPipelinePromise = loadDepth('webgpu', 'fp16').catch(() => {
      depthDevice = 'wasm';
      depthPipelinePromise = null;
      return loadDepth('wasm', 'fp32');
    });
  }
  let estimator = await depthPipelinePromise;
  const image = await RawImage.fromBlob(blob);
  let output;
  try {
    output = await estimator(image);
  } catch (error) {
    if (depthDevice !== 'webgpu') throw error;
    depthDevice = 'wasm';
    depthPipelinePromise = loadDepth('wasm', 'fp32');
    estimator = await depthPipelinePromise;
    output = await estimator(image);
  }
  const { depth } = output;
  const x = Math.max(0, crop?.x || 0);
  const y = Math.max(0, crop?.y || 0);
  const width = Math.min(depth.width - x, crop?.width || depth.width);
  const height = Math.min(depth.height - y, crop?.height || depth.height);
  if (width < 1 || height < 1) throw new Error('The depth map could not be aligned with the product cutout.');

  const depthCanvas = new OffscreenCanvas(width, height);
  const depthContext = depthCanvas.getContext('2d', { willReadFrequently: true });
  const depthPixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const sourceIndex = (row + y) * depth.width + column + x;
      const pixel = (row * width + column) * 4;
      const level = depth.data[sourceIndex] ?? 0;
      depthPixels[pixel] = level;
      depthPixels[pixel + 1] = level;
      depthPixels[pixel + 2] = level;
      depthPixels[pixel + 3] = 255;
    }
  }
  depthContext.putImageData(new ImageData(depthPixels, width, height), 0, 0);

  if (cutoutBlob) {
    const cutoutBitmap = await createImageBitmap(cutoutBlob);
    const alphaCanvas = new OffscreenCanvas(width, height);
    const alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true });
    alphaContext.drawImage(cutoutBitmap, 0, 0, width, height);
    cutoutBitmap.close();
    const alpha = alphaContext.getImageData(0, 0, width, height).data;
    const depthImage = depthContext.getImageData(0, 0, width, height);
    for (let i = 0; i < width * height; i += 1) depthImage.data[i * 4 + 3] = alpha[i * 4 + 3];
    depthContext.putImageData(depthImage, 0, 0);
  }
  return depthCanvas.convertToBlob({ type: 'image/png' });
}

function findCropBounds(imageData, width, height) {
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (imageData[(y * width + x) * 4 + 3] > 12) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right <= left || bottom <= top) return null;
  const padding = Math.round(Math.max(right - left, bottom - top) * 0.035);
  return {
    x: Math.max(0, left - padding),
    y: Math.max(0, top - padding),
    width: Math.min(width, right + padding + 1) - Math.max(0, left - padding),
    height: Math.min(height, bottom + padding + 1) - Math.max(0, top - padding),
  };
}

self.onmessage = async (event) => {
  const { id, blob, action = 'cutout', cutoutBlob, crop } = event.data || {};
  if (!blob) return;
  try {
    if (action === 'depth') {
      const depth = await makeDepthMap(blob, cutoutBlob, crop);
      self.postMessage({ type: 'depth-result', id, blob: depth });
    } else {
      const result = await makeCutout(blob);
      self.postMessage({ type: 'result', id, blob: result.blob, crop: result.crop });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : 'Could not prepare this product image.' });
  }
};
