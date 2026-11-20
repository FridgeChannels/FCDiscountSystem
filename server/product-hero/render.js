import sharp from 'sharp';

const WIDTH = 640;
const HEIGHT = 800;
const FRAMES = 28;
const DURATION_MS = 7000;
export const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

export class ProductImageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hexColor(value) {
  if (typeof value !== 'string' || !/^#?[a-f\d]{6}$/i.test(value)) {
    throw new ProductImageError(400, 'Brand colors must be six-digit RGB values.');
  }
  return '#' + value.replace('#', '').toLowerCase();
}

function mix(from, to, amount) {
  const rgb = [1, 3, 5].map(i => {
    const start = parseInt(from.slice(i, i + 2), 16);
    const end = parseInt(to.slice(i, i + 2), 16);
    return Math.round(start + (end - start) * amount).toString(16).padStart(2, '0');
  });
  return '#' + rgb.join('');
}

function makeBackdrop(primary, secondary, contactY) {
  const mosh = primary === '#681cab' && secondary === '#fbeaff';
  const mid = mosh ? '#eacbf9' : mix(secondary, primary, 0.15);
  const end = mosh ? '#ac72ce' : mix(secondary, primary, 0.54);
  const floor = HEIGHT * 0.79;
  const radius = WIDTH * 0.1;
  // The foreground crosses this rounded panel edge, as it does in the mobile layout.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <linearGradient id="wash" x1=".46" y1="0" x2=".54" y2="1">
        <stop offset=".08" stop-color="${secondary}"/><stop offset=".56" stop-color="${mid}"/><stop offset="1" stop-color="${end}"/>
      </linearGradient>
      <radialGradient id="light" cx=".5" cy=".72" r=".51">
        <stop stop-color="white" stop-opacity=".53"/><stop offset="1" stop-color="white" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="contact"><stop stop-opacity=".6"/><stop offset=".68" stop-opacity="0"/></radialGradient>
      <filter id="blur" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    <rect width="100%" height="90%" fill="url(#wash)"/><rect width="100%" height="90%" fill="url(#light)"/>
    <rect y="${floor}" width="100%" height="${HEIGHT - floor + radius}" rx="${radius}" fill="${secondary}"/>
    <ellipse cx="${WIDTH / 2}" cy="${contactY}" rx="${WIDTH * .21}" ry="10.5" fill="url(#contact)" filter="url(#blur)"/>
  </svg>`);
}

async function readSubject(input, expectedType) {
  if (!Buffer.isBuffer(input) || !input.length) throw new ProductImageError(400, 'Supply an image buffer.');
  if (input.length > MAX_BYTES) throw new ProductImageError(413, 'Maximum upload is 12 MiB.');
  const signature = input.subarray(0, 8).toString('hex');
  const type = signature === '89504e470d0a1a0a' ? 'png'
    : signature.startsWith('ffd8ff') ? 'jpeg'
    : input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!type || (expectedType && expectedType !== type)) {
    throw new ProductImageError(415, 'Supply a PNG, WebP or JPEG matching its Content-Type.');
  }
  try {
    const source = sharp(input, { failOn: 'error', limitInputPixels: MAX_PIXELS });
    const meta = await source.metadata();
    if ((meta.pages ?? 1) > 1) throw new ProductImageError(422, 'Supply a still product photo.');
    const { data, info } = await source.autoOrient().resize(Math.round(WIDTH * .92), Math.round(HEIGHT * .84), {
      fit: 'inside',
    }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Preserve the photographed arrangement and its horizontal margins. Anchor the
    // floating shadow to the actual product even if the file has bottom padding.
    let last = data.length - 1;
    while (last >= 0 && data[last] < 8) last -= 4;
    if (last < 0) throw new ProductImageError(422, 'The product image is fully transparent.');
    const bottomRow = Math.floor(last / (4 * info.width));
    return { data, raw: { width: info.width, height: info.height, channels: 4 }, bottomRow };
  } catch (error) {
    if (error instanceof ProductImageError) throw error;
    throw new ProductImageError(422, 'Cannot decode the product image (maximum 24 megapixels).');
  }
}

// Eased motion between the same -0.3° and +0.3° endpoints as the marketplace.
function frameAngle(index) {
  return -0.3 * Math.cos(index * 2 * Math.PI / FRAMES);
}

/** Render one supplied product photo. Returns a standalone animated WebP or static PNG. */
export async function renderProductHero(input, {
  primary = '#681cab', secondary = '#fbeaff', format = 'webp', inputFormat,
} = {}) {
  if (!['webp', 'png'].includes(format)) throw new ProductImageError(400, 'format must be webp or png.');
  primary = hexColor(primary);
  secondary = hexColor(secondary);
  const { data, raw, bottomRow } = await readSubject(input, inputFormat);
  const top = Math.min(Math.round(HEIGHT * .85) - bottomRow, HEIGHT - raw.height - 6);
  const contactY = top + bottomRow + Math.round(WIDTH * .05);
  const backdrop = await sharp(makeBackdrop(primary, secondary, contactY)).png().toBuffer();

  // Build the contour shadow once. The pad keeps its blur intact while rotating.
  const pad = 60;
  const shadowPixels = Buffer.alloc(data.length);
  for (let p = 0; p < data.length; p += 4) {
    shadowPixels[p] = 38; shadowPixels[p + 1] = 4; shadowPixels[p + 2] = 4;
    shadowPixels[p + 3] = Math.round(data[p + 3] / 3);
  }
  const spriteWidth = raw.width + 2 * pad;
  const spriteHeight = raw.height + 2 * pad;
  const blank = { create: { width: spriteWidth, height: spriteHeight, channels: 4, background: CLEAR } };
  const shadow = await sharp(blank).composite([{ input: shadowPixels, raw, left: pad + 6, top: pad + 21 }]).png().toBuffer();
  const blurred = await sharp(shadow).blur(15).png().toBuffer();
  const sprite = await sharp(blurred).composite([{ input: data, raw, left: pad, top: pad }]).png().toBuffer();

  const count = format === 'png' ? 1 : FRAMES;
  const bytesPerFrame = WIDTH * HEIGHT * 3;
  const frames = Buffer.allocUnsafe(bytesPerFrame * count);
  for (let i = 0; i < count; i++) {
    const rotated = await sharp(sprite).rotate(count === 1 ? 0 : frameAngle(i), { background: CLEAR })
      .png().toBuffer({ resolveWithObject: true });
    const left = Math.round((WIDTH - rotated.info.width) / 2);
    const y = top + Math.round((raw.height - rotated.info.height) / 2);
    // Clip only the off-canvas parts of the padded layer before compositing.
    const crop = {
      left: Math.max(0, -left), top: Math.max(0, -y),
      width: Math.min(WIDTH, left + rotated.info.width) - Math.max(0, left),
      height: Math.min(HEIGHT, y + rotated.info.height) - Math.max(0, y),
    };
    const layer = await sharp(rotated.data).extract(crop).png().toBuffer();
    const frame = await sharp(backdrop).composite([{ input: layer, left: Math.max(left, 0), top: Math.max(y, 0) }])
      .removeAlpha().raw().toBuffer();
    frame.copy(frames, bytesPerFrame * i);
  }
  const output = sharp(frames, { raw: { width: WIDTH, height: HEIGHT * count, channels: 3, pageHeight: HEIGHT } });
  if (format === 'png') return output.png().toBuffer();
  return output.webp({ quality: 90, effort: 3, loop: 0, delay: Array(count).fill(DURATION_MS / count) }).toBuffer();
}
