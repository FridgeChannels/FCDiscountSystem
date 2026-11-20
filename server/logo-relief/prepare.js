import sharp from 'sharp';

export class InvalidLogo extends Error {}

const MAX_INPUT_PIXELS = 16_000_000;

function colorDistance(data, i, rgb) {
  return Math.max(Math.abs(data[i] - rgb[0]), Math.abs(data[i + 1] - rgb[1]), Math.abs(data[i + 2] - rgb[2]));
}

// Estimate the border color even if the top-left corner touches the artwork.
function borderColor(data, width, height) {
  const samples = [];
  const horizontalStep = Math.ceil(width / 1024);
  const verticalStep = Math.ceil(height / 1024);
  for (let x = 0; x < width; x += horizontalStep) {
    samples.push(x, (height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += verticalStep) {
    samples.push(y * width, (y + 1) * width - 1);
  }
  const rgb = [0, 1, 2].map(channel => {
    const values = samples.map(p => data[4 * p + channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  if (samples.filter(p => colorDistance(data, 4 * p, rgb) <= 12).length < samples.length * 0.95) {
    throw new InvalidLogo('Background is not uniform. Supply a transparent logo or use background=keep.');
  }
  return rgb;
}

function removeExterior(data, width, height) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return null;
  }
  const rgb = borderColor(data, width, height);
  const queue = new Uint32Array(width * height);
  let tail = 0;
  function visit(p) {
    const i = 4 * p;
    if (data[i + 3] && colorDistance(data, i, rgb) <= 12) {
      data[i + 3] = 0;
      queue[tail++] = p;
    }
  }
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(y * width);
    visit((y + 1) * width - 1);
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    if (p % width > 0) visit(p - 1);
    if (p % width < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p + width < queue.length) visit(p + width);
  }
  return rgb;
}

function bounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new InvalidLogo('No visible logo found after background removal.');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// Only a one-ink wordmark on a uniform matte can safely recover its enclosed
// counters from color. Check that the other colors lie on the ink–matte line.
function singleInk(data, matte) {
  let strongest = 0, index = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const delta = colorDistance(data, i, matte);
    if (delta > strongest) { strongest = delta; index = i; }
  }
  if (!strongest) return null;
  const ink = data.subarray(index, index + 3);
  const vector = Array.from(ink, (v, c) => v - matte[c]);
  const axis = vector.findIndex(v => Math.abs(v) === strongest);
  let solid = 0, samples = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3] || colorDistance(data, i, matte) <= 4) continue;
    samples++;
    if (colorDistance(data, i, ink) <= 4) { solid++; continue; }
    const coverage = (data[i + axis] - matte[axis]) / vector[axis];
    if (vector.some((v, c) => Math.abs(data[i + c] - matte[c] - coverage * v) > 6)) return null;
  }
  return solid > samples * 0.7 ? { ink: Buffer.from(ink), axis, vector } : null;
}

function recoverInk(data, matte, { ink, axis, vector }) {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const coverage = (data[i + axis] - matte[axis]) / vector[axis];
    data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, coverage)));
    data.set(ink, i);
  }
}

// Measure a bounded grid on the cropped source. Transparent and antialiased
// edge pixels should not turn a one-color mark into a multicolor illustration.
function classify(data, width, box, matte, oneInk) {
  const step = Math.max(1, Math.ceil(Math.max(box.width, box.height) / 256));
  const palette = new Map();
  let samples = 0, interior = 0, transitions = 0, smoothChanges = 0, translucent = 0;
  const visible = i => data[i + 3] >= 224 && !(oneInk && colorDistance(data, i, matte) <= 12);
  for (let y = box.top; y < box.top + box.height; y += step) {
    for (let x = box.left; x < box.left + box.width; x += step) {
      const i = 4 * (y * width + x);
      if (data[i + 3] > 32 && data[i + 3] < 224) translucent++;
      if (!visible(i)) continue;
      samples++;
      const nextX = i + 4 * step, nextY = i + 4 * width * step;
      if (x + step >= box.left + box.width || y + step >= box.top + box.height ||
          !visible(nextX) || !visible(nextY)) continue;
      interior++;
      const rgb = data.subarray(i, i + 3);
      const key = ((rgb[0] >> 4) << 8) | ((rgb[1] >> 4) << 4) | (rgb[2] >> 4);
      palette.set(key, (palette.get(key) || 0) + 1);
      const change = Math.max(colorDistance(data, nextX, rgb), colorDistance(data, nextY, rgb));
      if (change > 20) transitions++;
      else if (change > 0) smoothChanges++;
    }
  }
  if (!samples || !interior) return 'illustration';
  const colors = [...palette.values()].sort((a, b) => b - a);
  const coverage = samples * step * step / (box.width * box.height);
  const fineLines = coverage < 0.23 || interior / samples < 0.74;
  if (fineLines || translucent > samples * 0.18 || transitions / interior > 0.13 ||
      smoothChanges / interior > 0.18) return 'illustration';
  if (oneInk || colors[0] / interior >= 0.985) return 'silhouette';
  const flatColors = colors.slice(0, 8).reduce((sum, n) => sum + n, 0);
  return flatColors / interior >= 0.965 ? 'flat' : 'illustration';
}

export async function prepareLogo(input, options) {
  let raw;
  try {
    const decoder = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' };
    const meta = await sharp(input, decoder).metadata();
    if (meta.format !== options.inputFormat || (meta.pages || 1) > 1) {
      throw new InvalidLogo('Supply a still image matching the request Content-Type.');
    }
    if (meta.format === 'svg') {
      decoder.density = Math.min(100000, Math.max(1, Math.round(72 * options.size / Math.max(meta.width, meta.height))));
    }
    raw = await sharp(input, decoder).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (err) {
    if (err instanceof InvalidLogo) throw err;
    throw new InvalidLogo('Cannot decode this logo. Check the file and the 16 megapixel input limit.');
  }
  const { data, info: { width, height } } = raw;
  const matte = options.background === 'auto' ? removeExterior(data, width, height) : null;
  const box = bounds(data, width, height);
  const requested = options.style ?? 'auto';
  const ink = matte && (requested === 'auto' || requested === 'silhouette') ? singleInk(data, matte) : null;
  const style = requested === 'auto' ? classify(data, width, box, matte, ink) : requested;
  if (ink && style === 'silhouette') recoverInk(data, matte, ink);
  const face = sharp(data, { raw: { width, height, channels: 4 } }).extract(box);
  return { face, style, box };
}
