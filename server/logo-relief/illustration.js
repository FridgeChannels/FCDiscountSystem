import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { beginImageUsage, estimateImageCost } from './usage.js';

const REFERENCE = new URL('./reference/pet-depth.png', import.meta.url);
const EDIT_URL = 'https://api.openai.com/v1/images/edits';
const MODEL = 'gpt-image-2.5-sunburst';
export const ILLUSTRATION_TIMEOUT_MS = 240_000;

export class IllustrationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const digest = value => createHash('sha256').update(value).digest();

// Only the paid illustration branch needs a token; local relief stays compatible.
export function assertIllustrationAccess(authorization = '') {
  const token = process.env.LOGO_IMAGE_EDIT_TOKEN || process.env.PRODUCT_IMAGE_EDIT_TOKEN;
  if (!process.env.OPENAI_API_KEY || !token) {
    throw new IllustrationError(503, 'Configure OPENAI_API_KEY and LOGO_IMAGE_EDIT_TOKEN (or PRODUCT_IMAGE_EDIT_TOKEN) for illustration rendering.');
  }
  if (!timingSafeEqual(digest(authorization), digest('Bearer ' + token))) {
    throw new IllustrationError(401, 'Supply a valid logo image edit token for illustration rendering.');
  }
}

export function illustrationPrompt(options) {
  return [
    'Create ONE premium 2.5D / sculptural 3D brand icon. Image 1 is the sole source of brand identity, lettering, subjects and composition.',
    'Image 2 is ONLY a reference for convincing animal volume, soft materials, dimensional lighting and depth popping out of a frame. Do not copy its web UI, dogs, paws, cards, green palette or text into the source logo.',
    'Transform the flat illustration in image 1 into a beautifully sculpted, dimensional subject. Preserve its species or object identity, recognizable features, pose, facing direction, expression, proportions and original color palette. For animal mascots, give the skull, muzzle, nose, cheeks and ears real rounded volume with softly textured fur appropriate to that animal. For other subjects, apply the same volumetric treatment to their own forms and materials.',
    'Use a premium satin resin collectible finish with natural material detail and soft form shading. The subject itself must have convincing curved surfaces, not a flat image glued onto an extruded disk. Where the original has a badge or frame, let its existing foreground subject emerge forward and slightly beyond that frame without inventing limbs or extra objects. Do not add a badge to an unframed logo.',
    'Preserve all existing scenic elements and their layout. Recess background elements behind the main subject as subtly separated relief layers with soft contact shadows. Add depth to existing mountains, trees, scenery or other shapes only when present in image 1.',
    'Reproduce all source lettering verbatim, including capitalization and spelling. Preserve the distinctive letter shapes, serif or sans-serif structure, spacing, fill patterns, colors and outlines as closely as possible. Make the existing wordmark a separate softly beveled dimensional foreground element in its original location, legible and unobstructed. Do not invent any text.',
    'Keep the original brand composition and silhouette recognizable. Render nearly front-on, centered and fully in frame, with generous transparent clearance around every edge. Unified soft upper-left studio lighting, gentle ambient occlusion between layers, restrained highlights and realistic form shadows.',
    options.color
      ? `Use a unified satin resin material based on RGB #${options.color} for all visible source elements; retain their geometry, text and light/shadow detail.`
      : 'Retain the original brand colors; do not adopt colors from the style reference.',
    options.background === 'keep'
      ? 'Retain the source backing plate/background as part of the logo, with real alpha transparency outside the complete asset.'
      : 'Remove the source exterior background while retaining scenery and enclosed colors belonging to the logo. Return real alpha transparency outside the complete asset.',
    'No chrome, harsh metallic extrusion, stacked contour ridges, flat subject face, added heavy outlines, white rectangle, drawn checkerboard, UI, caption, watermark or additional objects. Output one polished transparent PNG.',
  ].join('\n');
}

async function verifyTransparentPng(png) {
  try {
    if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error();
    const decoded = sharp(png, { limitInputPixels: 4_000_000, failOn: 'error' });
    const meta = await decoded.metadata();
    if (!meta.hasAlpha || (meta.pages || 1) !== 1) throw new Error();
    const alpha = (await decoded.stats()).channels.at(-1);
    if (alpha.min !== 0 || alpha.max === 0) throw new Error();
  } catch {
    throw new IllustrationError(502, 'Image service did not return a valid transparent logo PNG.');
  }
}

export async function renderIllustration(source, options, signal) {
  const reference = await readFile(REFERENCE);
  let record;
  try {
    record = await beginImageUsage(MODEL, createHash('sha256').update(source).digest('hex'));
  } catch {
    throw new IllustrationError(503, 'Cannot save image usage records. Check server log storage before generating.');
  }
  let response, payload;
  try {
    response = await fetch(EDIT_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, n: 1, quality: 'high', size: '1024x1024',
        background: 'transparent', output_format: 'png',
        prompt: illustrationPrompt(options),
        images: [source, reference].map(image => ({ image_url: 'data:image/png;base64,' + image.toString('base64') })),
      }),
      signal,
    });
    payload = await response.json();
  } catch (error) {
    await record({
      event: 'usage_unavailable', providerRequestId: response?.headers.get('x-request-id') || null,
      httpStatus: response?.status || null, usage: null, estimatedCost: null,
      reason: signal?.aborted ? 'cancelled_or_timed_out' : response ? 'invalid_json' : 'network_error',
    });
    signal?.throwIfAborted();
    if (!response) throw error;
    throw new IllustrationError(502, 'Image service returned an invalid logo response.');
  }
  // Persist upstream usage BEFORE validating pixels; rejected output can still
  // incur a charge. Do not save API keys, prompts or base64 image contents.
  await record({
    event: 'provider_response', providerRequestId: response.headers.get('x-request-id'),
    httpStatus: response.status, usage: payload?.usage ?? null,
    estimatedCost: estimateImageCost(MODEL, payload?.usage),
  });
  if (!response.ok) {
    // Never retry a paid generation automatically or silently return flat relief.
    if (response.status === 429) throw new IllustrationError(429, 'Image provider quota or rate limit reached.');
    if ([401, 403, 404].includes(response.status)) throw new IllustrationError(503, 'Check the server API key and image model access.');
    if ([400, 422].includes(response.status)) throw new IllustrationError(422, 'Image provider rejected the logo edit.');
    throw new IllustrationError(502, 'Image provider request failed.');
  }
  let png;
  try {
    const base64 = payload?.data?.[0]?.b64_json;
    if (typeof base64 !== 'string' || !base64.length || base64.length > 24 * 1024 * 1024) throw new Error();
    png = Buffer.from(base64, 'base64');
  } catch (error) {
    signal?.throwIfAborted();
    throw new IllustrationError(502, 'Image service returned an invalid logo response.');
  }
  await verifyTransparentPng(png);
  const result = sharp(png).resize(options.size, options.size, { fit: 'inside' });
  const image = await (options.format === 'png' ? result.png() : result.webp({ lossless: true })).toBuffer();
  return { image, style: 'illustration', renderer: 'ai', model: MODEL };
}
