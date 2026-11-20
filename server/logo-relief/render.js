import sharp from 'sharp';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// A two-pass distance field gives each contour (including holes) its own
// rounded bevel. Estimate stroke thickness from the ratio of area to perimeter.
async function contour(face, width, height, bevelLimit) {
  const stride = width + 2;
  const d = new Float32Array(stride * (height + 2));
  let area = 0, perimeter = 0;
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const i = y * stride + x;
      const a = face[((y - 1) * width + x - 1) * 4 + 3] / 255;
      d[i] = a > 0.12 ? Infinity : 0;
      area += a;
      if (a > 0.5) {
        if (x === 1 || face[((y - 1) * width + x - 2) * 4 + 3] <= 127) perimeter += 2;
        if (y === 1 || face[((y - 2) * width + x - 1) * 4 + 3] <= 127) perimeter += 2;
      }
      d[i] = Math.min(d[i], 1 + d[i - 1], 1 + d[i - stride],
        Math.SQRT2 + d[i - stride - 1], Math.SQRT2 + d[i - stride + 1]);
    }
  }
  const bevel = clamp(area / Math.max(1, perimeter) * 0.58, 1, bevelLimit);
  for (let y = height; y > 0; y--) {
    for (let x = width; x > 0; x--) {
      const i = y * stride + x;
      d[i] = Math.min(d[i], 1 + d[i + 1], 1 + d[i + stride],
        Math.SQRT2 + d[i + stride + 1], Math.SQRT2 + d[i + stride - 1]);
    }
  }
  // Height of a rounded cross-section. Its slope supplies the lighting normals.
  const relief = Buffer.alloc(d.length);
  for (let i = 0; i < d.length; i++) {
    const t = Math.min(1, d[i] / bevel);
    relief[i] = Math.round(255 * Math.sqrt(t * (2 - t)));
  }
  // Smooth the lighting field, independently of the unmodified alpha contour.
  const softened = await sharp(relief, { raw: { width: stride, height: height + 2, channels: 1 } })
    .blur(Math.max(0.8, bevel * 0.23)).greyscale().raw().toBuffer();
  for (let i = 0; i < d.length; i++) d[i] = softened[i] * bevel / 255;
  return { heights: d, bevel };
}

export async function renderRelief(prepared, options) {
  const { style, box } = prepared;
  if (!['silhouette', 'flat'].includes(style)) throw new Error('Illustrations require AI rendering.');
  // Reserve space first so the artwork is raster-resized only once and the
  // final image, including both margins, fits the requested longest edge.
  const shortSide = options.size * Math.min(box.width, box.height) / Math.max(box.width, box.height);
  const maxDepth = style === 'silhouette' ? 0.022 : 0.012;
  const depthBudget = Math.round(clamp(shortSide * 0.05, 1, options.size * maxDepth));
  const blur = Math.max(0.6, depthBudget * 0.31);
  const pad = Math.ceil(depthBudget + 4 * blur + 2);
  const faceSize = options.size - 2 * pad;
  const { data: face, info: { width, height } } = await prepared.face
    .resize(faceSize, faceSize, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const bevelLimit = style === 'flat' ? Math.max(1, shortSide * 0.007) : Math.max(1, shortSide * 0.07);
  const relief = await contour(face, width, height, bevelLimit);
  const depth = style === 'silhouette' ? Math.round(clamp(relief.bevel * 0.9, 1, depthBudget)) : depthBudget;
  const outWidth = width + 2 * pad, outHeight = height + 2 * pad;
  const raw = { width: outWidth, height: outHeight, channels: 4 };
  const surface = Buffer.alloc(outWidth * outHeight * 4);
  const tint = options.color ? Buffer.from(options.color, 'hex') : null;

  // Sweep the original colored silhouette back to front. Keep the maximum
  // coverage so antialiased and translucent details do not pile up into ridges.
  for (let z = depth; z >= 0; z--) {
    const dx = Math.round(z * 0.72);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const a = face[i + 3];
        if (!a) continue;
        const out = ((y + pad + z) * outWidth + x + pad + dx) * 4;
        const alpha = Math.max(surface[out + 3], a);
        const weight = a / alpha;
        let shade = 0.55 + 0.15 * (1 - z / depth);
        let light = 0;
        if (!z) {
          shade = 1;
          if (relief) {
            const stride = width + 2, p = (y + 1) * stride + x + 1;
            const { heights } = relief;
            const nx = (heights[p - 1] - heights[p + 1]) * 0.5;
            const ny = (heights[p - stride] - heights[p + stride]) * 0.5;
            const length = Math.hypot(nx, ny, 1);
            if (style === 'flat') {
              // The flat interior has zero slope and retains its source color.
              const rim = (-0.52 * nx - 0.63 * ny) / length;
              light = Math.max(0, rim) * 0.36;
              shade = 1 + Math.min(0, rim) * 0.22;
            } else {
              const diffuse = Math.max(0, (-0.52 * nx - 0.63 * ny + 0.57) / length);
              const specular = Math.max(0, (-0.30 * nx - 0.36 * ny + 0.88) / length) ** 22;
              shade = 0.74 + 0.26 * diffuse;
              light = clamp(0.27 + 0.38 * diffuse + 0.35 * specular - 0.08 * y / height, 0, 0.90);
            }
          }
        }
        for (let c = 0; c < 3; c++) {
          const base = (tint ? tint[c] : face[i + c]) * shade;
          const lit = base + (255 - base) * light;
          surface[out + c] = Math.round(surface[out + c] * (1 - weight) + lit * weight);
        }
        surface[out + 3] = alpha;
      }
    }
  }
  const shadow = Buffer.alloc(surface.length);
  const offset = 4 * (Math.ceil(depth * 0.23) * outWidth + Math.ceil(depth * 0.12));
  for (let i = 0; i + offset < shadow.length; i += 4) {
    shadow[i + offset + 3] = Math.round(surface[i + 3] * 0.23);
  }
  const softShadow = await sharp(shadow, { raw }).blur(blur).raw().toBuffer();
  const layered = await sharp(softShadow, { raw }).composite([{ input: surface, raw }]).raw().toBuffer();
  const result = sharp(layered, { raw });
  const image = await (options.format === 'png' ? result.png() : result.webp({ lossless: true })).toBuffer();
  return { image, style };
}
