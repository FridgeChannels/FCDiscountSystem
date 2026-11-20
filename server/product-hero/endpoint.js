import { MAX_BYTES, ProductImageError, renderProductHero } from './render.js';

const types = new Map([['image/webp', 'webp'], ['image/png', 'png'], ['image/jpeg', 'jpeg']]);
let rendering = false;

export async function readImage(req, maxBytes = MAX_BYTES) {
  const chunks = [];
  let length = 0;
  const tooLarge = () => new ProductImageError(413, 'Request body exceeds ' + maxBytes + ' bytes.');
  if (Number(req.headers['content-length']) > maxBytes) throw tooLarge();
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

export async function handleProductHero(req, res, query, { sendJson, sendBinary }) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST with a product photo.' }, { allow: 'POST, OPTIONS' });
  const inputFormat = types.get(req.headers['content-type']?.split(';')[0].trim().toLowerCase());
  if (!inputFormat || rendering) {
    req.resume();
    return !inputFormat
      ? sendJson(res, 415, { error: 'Use image/png, image/webp or image/jpeg.' })
      : sendJson(res, 429, { error: 'Product renderer is busy.' }, { 'retry-after': '3' });
  }
  rendering = true;
  try {
    const format = query.get('format') ?? 'webp';
    const image = await renderProductHero(await readImage(req), {
      format, inputFormat, primary: query.get('primary') ?? undefined, secondary: query.get('secondary') ?? undefined,
    });
    sendBinary(res, 200, image, 'image/' + format, { 'cache-control': 'no-store' });
  } catch (error) {
    req.resume();
    if (!(error instanceof ProductImageError)) console.error('[product-hero]', error);
    sendJson(res, error.status || 500, { error: error.status ? error.message : 'Product rendering failed.' });
  } finally {
    rendering = false;
  }
}
