import { timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { readImage } from './endpoint.js';
import { ProductImageError } from './render.js';

const STYLE_REFERENCE = new URL('./reference/steak-depth.png', import.meta.url);
const EDIT_URL = 'https://api.openai.com/v1/images/edits';
const MODEL = 'gpt-image-2.5-sunburst';
const formats = new Map([['image/png', 'png'], ['image/webp', 'webp'], ['image/jpeg', 'jpeg']]);
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const prompt = [
  'Create one photorealistic 2.5D e-commerce product cutout. Image 1 is the sole source of the product identity. Image 2 is a style reference only: study the steak silhouette, foreshortening, overlap and dimensional lighting.',
  'Keep the exact product, packaging, count, arrangement, proportions, colors and visible artwork from image 1. Preserve printed logos, spelling, numbers and units. Do not invent lettering, hidden graphics, exposed contents or props.',
  'Keep the main identifying face dominant. Choose a modest three-quarter camera view, around 20–25 degrees from frontal and slightly above when appropriate. Show the physically plausible thickness, a little of the top and one receding side. Preserve genuine details when already visible.',
  'Match the new planes to the original material. Use directional softbox light, realistic highlights on the near edge, a slightly darker far plane and gentle occlusion in seams and folds. Keep the product sharp, fully in frame, centered and visually substantial, with clear space at every edge.',
  'Remove the original scene and tabletop. Return the product isolated on real alpha transparency, with at most a faint contact shadow fading to transparency. No poster, UI, checkerboard, background color, meat from the reference, added text or watermark.',
].join('\n');
let busy = false;

async function sourceForEdit(req) {
  const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (mime === 'application/json') {
    const body = await readImage(req, 16 * 1024);
    try {
      const { imageUrl } = JSON.parse(body.toString('utf8'));
      const url = new URL(imageUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      return url.href;
    } catch {
      throw new ProductImageError(400, 'Supply a public HTTPS product URL in imageUrl.');
    }
  }
  if (!formats.has(mime)) throw new ProductImageError(415, 'Use application/json, image/png, image/webp or image/jpeg.');
  const body = await readImage(req);
  if (!body.length) throw new ProductImageError(400, 'The product image is empty.');
  let metadata;
  try {
    metadata = await sharp(body, { limitInputPixels: 24_000_000 }).metadata();
  } catch {
    throw new ProductImageError(422, 'Cannot read the product image.');
  }
  if (metadata.format !== formats.get(mime) || (metadata.pages || 1) !== 1) {
    throw new ProductImageError(422, 'Supply one still product photo matching the Content-Type.');
  }
  return 'data:' + mime + ';base64,' + body.toString('base64');
}

async function verifyPng(png) {
  try {
    if (!png.subarray(0, 8).equals(pngSignature)) throw new Error();
    const image = sharp(png, { limitInputPixels: 4_000_000 });
    if (!(await image.metadata()).hasAlpha) throw new Error();
    const { channels } = await image.stats();
    const alpha = channels.at(-1);
    if (alpha.min !== 0 || alpha.max === 0) throw new Error();
  } catch {
    throw new ProductImageError(502, 'The image service did not return a valid transparent product PNG.');
  }
}

async function editProduct(source, apiKey, signal) {
  const reference = await readFile(STYLE_REFERENCE);
  const response = await fetch(EDIT_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, n: 1, quality: 'high', size: '1024x1024',
      background: 'transparent', output_format: 'png', prompt,
      images: [{ image_url: source }, { image_url: 'data:image/png;base64,' + reference.toString('base64') }],
    }),
    signal,
  });
  if (!response.ok) {
    const reason = (await response.json().catch(() => ({}))).error?.code;
    if (response.status === 429) throw new ProductImageError(429, 'Image provider quota or rate limit reached.');
    if (response.status === 401 || response.status === 403) throw new ProductImageError(503, 'Check the server API key and image model access.');
    if (response.status === 400 || response.status === 422) throw new ProductImageError(422, 'Image provider rejected the edit' + (reason ? ' (' + reason + ').' : '.'));
    throw new ProductImageError(502, 'Image provider request failed.');
  }
  const payload = await response.json();
  const png = Buffer.from(payload.data?.[0]?.b64_json || '', 'base64');
  await verifyPng(png);
  return { png, usage: payload.usage ?? null };
}

function imageUsageHeaders(usage) {
  const fields = {
    'x-image-usage-total-tokens': usage?.total_tokens,
    'x-image-usage-input-tokens': usage?.input_tokens,
    'x-image-usage-output-tokens': usage?.output_tokens,
    'x-image-usage-input-image-tokens': usage?.input_tokens_details?.image_tokens,
    'x-image-usage-input-text-tokens': usage?.input_tokens_details?.text_tokens,
    'x-image-usage-output-image-tokens': usage?.output_tokens_details?.image_tokens,
    'x-image-usage-output-text-tokens': usage?.output_tokens_details?.text_tokens,
  };
  const headers = {
    'access-control-expose-headers': Object.keys(fields).join(', '),
  };
  for (const [name, value] of Object.entries(fields)) {
    if (Number.isFinite(value)) headers[name] = String(value);
  }
  return headers;
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export async function handleProductPerspective(req, res, { sendJson, sendBinary }) {
  let acquired = false;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST a product photo or imageUrl.' }, { allow: 'POST, OPTIONS' });
    if (!process.env.OPENAI_API_KEY || !process.env.PRODUCT_IMAGE_EDIT_TOKEN) {
      throw new ProductImageError(503, 'Configure OPENAI_API_KEY and PRODUCT_IMAGE_EDIT_TOKEN on the server.');
    }
    const expected = 'Bearer ' + process.env.PRODUCT_IMAGE_EDIT_TOKEN;
    if (!timingSafeEqual(digest(req.headers.authorization || ''), digest(expected))) {
      throw new ProductImageError(401, 'Supply a valid product image edit token.');
    }
    if (busy) return sendJson(res, 429, { error: 'An edit is in progress.' }, { 'retry-after': '10' });
    busy = acquired = true;
    res.once('close', cancel);
    const source = await sourceForEdit(req);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]);
    const { png, usage } = await editProduct(source, process.env.OPENAI_API_KEY, signal);
    console.info(JSON.stringify({
      event: 'product_2p5d_edit_usage',
      model: MODEL,
      usage: usage ?? null,
    }));
    sendBinary(res, 200, png, 'image/png', {
      'cache-control': 'no-store',
      ...imageUsageHeaders(usage),
    });
  } catch (error) {
    if (res.destroyed) return;
    const timeout = error.name === 'TimeoutError';
    const status = error.status || (timeout ? 504 : 502);
    sendJson(res, status, { error: error.status ? error.message : timeout ? 'Image edit timed out.' : 'Image edit unavailable.' });
  } finally {
    if (acquired) busy = false;
    res.removeListener('close', cancel);
    req.resume();
  }
}
