import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers';

const { PutObjectCommand, S3Client } = createRequire('/Users/ln/Downloads/DTC-dashboard-2/package.json')('@aws-sdk/client-s3');

const DASHBOARD_ENV = '/Users/ln/Downloads/DTC-dashboard-2/.env';
const STATE_PATH = '/tmp/product-cutout-state.jsonl';
const SUMMARY_PATH = '/tmp/product-cutout-summary.json';
const MODEL_ID = 'studioludens/birefnet-lite-512';
const MODEL_REVISION = '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7';
const DONE_MARKERS = ['/brand-colors/product-2p5d/', '/brand-colors/product-cutouts/'];

sharp.cache(false);

function loadEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, index).trim()] = value;
  }
  return env;
}

function alreadyDone(url) {
  return DONE_MARKERS.some((marker) => url.includes(marker));
}

function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function fetchJobs(env) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const url = new URL('/rest/v1/magnet_brand_param', env.SUPABASE_URL);
    url.searchParams.set('select', 'id,magnet_sn,brand_name,product_image_url');
    url.searchParams.set('experience', 'eq.asin_plus');
    url.searchParams.set('product_image_url', 'not.is.null');
    url.searchParams.set('order', 'id.asc');
    const response = await fetch(url, {
      headers: supabaseHeaders(env, { range: `${from}-${from + 999}` }),
    });
    if (!response.ok) throw new Error(`query failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    const page = await response.json();
    rows.push(...page.filter((row) => String(row.product_image_url || '').trim()));
    if (page.length < 1000) break;
  }
  const groups = new Map();
  for (const row of rows) {
    const imageUrl = String(row.product_image_url).trim();
    const group = groups.get(imageUrl) ?? [];
    group.push(row);
    groups.set(imageUrl, group);
  }
  return [...groups.entries()]
    .map(([imageUrl, groupRows]) => ({
      imageUrl,
      rows: groupRows.sort((a, b) => a.id - b.id),
    }))
    .filter((job) => !alreadyDone(job.imageUrl))
    .sort((a, b) => a.rows[0].id - b.rows[0].id);
}

function createUploader(env) {
  const client = new S3Client({
    region: env.AWS_DEFAULT_REGION || 'sa-east-1',
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const bucket = env.S3_BUCKET;
  const region = env.AWS_DEFAULT_REGION || 'sa-east-1';
  const prefix = (env.S3_KEY_PREFIX || 'brand-colors').replace(/\/$/, '');
  return async function upload(buffer) {
    const key = `${prefix}/product-cutouts/${randomUUID()}.png`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
    }));
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  };
}

async function downloadImage(imageUrl) {
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error('product_image_url is not an http(s) URL');
  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(45000),
    redirect: 'follow',
    headers: { 'user-agent': 'FCDiscountSystem-cutout/1.0' },
  });
  if (!response.ok) throw new Error(`download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('empty download');
  if (bytes.length > 20 * 1024 * 1024) throw new Error('download exceeds 20 MiB');
  return bytes;
}

function findCropBounds(data, width, height) {
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 12) {
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
    left: Math.max(0, left - padding),
    top: Math.max(0, top - padding),
    width: Math.min(width, right + padding + 1) - Math.max(0, left - padding),
    height: Math.min(height, bottom + padding + 1) - Math.max(0, top - padding),
  };
}

async function loadSegmenter() {
  console.log('loading BiRefNet…');
  const [model, processor] = await Promise.all([
    AutoModel.from_pretrained(MODEL_ID, {
      revision: MODEL_REVISION,
      device: 'cpu',
      dtype: 'fp32',
    }),
    AutoProcessor.from_pretrained(MODEL_ID, { revision: MODEL_REVISION }),
  ]);
  console.log('BiRefNet ready');
  return { model, processor };
}

async function makeCutoutPng(sourceBytes, segmenter) {
  const source = await sharp(sourceBytes, { animated: false, limitInputPixels: 24_000_000 })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: rgba, info: { width, height } } = source;
  if (!width || !height) throw new Error('invalid source dimensions');

  const blob = new Blob([sourceBytes]);
  const image = await RawImage.fromBlob(blob);
  const { pixel_values: inputImage } = await segmenter.processor(image);
  const prediction = await segmenter.model({ input_image: inputImage });
  const tensor = prediction.output_image ?? prediction.logits;
  if (!tensor) throw new Error('segmentation returned no mask tensor');
  const mask = RawImage.fromTensor(tensor[0].sigmoid().mul(255).to('uint8'));
  if (!mask?.data?.length || !mask.width || !mask.height) throw new Error('segmentation failed');

  const maskRaw = Buffer.alloc(mask.width * mask.height * 4);
  for (let index = 0; index < mask.width * mask.height; index += 1) {
    const alpha = mask.data[index * mask.channels] ?? 0;
    const pixel = index * 4;
    maskRaw[pixel] = 255;
    maskRaw[pixel + 1] = 255;
    maskRaw[pixel + 2] = 255;
    maskRaw[pixel + 3] = alpha;
  }
  const scaledMask = await sharp(maskRaw, { raw: { width: mask.width, height: mask.height, channels: 4 } })
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer();

  const out = Buffer.from(rgba);
  for (let index = 0; index < width * height; index += 1) {
    const pixel = index * 4;
    const sourceAlpha = out[pixel + 3] / 255;
    const matteAlpha = scaledMask[pixel + 3] / 255;
    const alpha = sourceAlpha * matteAlpha;
    if (alpha <= 0.015) {
      out[pixel + 3] = 0;
      continue;
    }
    const foregroundAlpha = Math.max(matteAlpha, 0.08);
    for (let channel = 0; channel < 3; channel += 1) {
      const value = out[pixel + channel];
      out[pixel + channel] = Math.max(0, Math.min(255, Math.round((value - 255 * (1 - foregroundAlpha)) / foregroundAlpha)));
    }
    out[pixel + 3] = Math.round(alpha * 255);
  }

  const bounds = findCropBounds(out, width, height);
  if (!bounds) throw new Error('no product subject detected');
  return sharp(out, { raw: { width, height, channels: 4 } })
    .extract(bounds)
    .png()
    .toBuffer();
}

async function updateRows(env, ids, productImageUrl) {
  for (let offset = 0; offset < ids.length; offset += 80) {
    const part = ids.slice(offset, offset + 80);
    const url = new URL('/rest/v1/magnet_brand_param', env.SUPABASE_URL);
    url.searchParams.set('id', `in.(${part.join(',')})`);
    url.searchParams.set('select', 'id,magnet_sn,product_image_url');
    const response = await fetch(url, {
      method: 'PATCH',
      headers: supabaseHeaders(env, {
        'content-type': 'application/json',
        prefer: 'return=representation',
      }),
      body: JSON.stringify({ product_image_url: productImageUrl }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`update failed HTTP ${response.status}: ${text.slice(0, 300)}`);
    const updated = JSON.parse(text);
    if (updated.length !== part.length) throw new Error(`updated ${updated.length} of ${part.length}`);
    for (const row of updated) {
      if (row.product_image_url !== productImageUrl) throw new Error(`mismatch on id ${row.id}`);
    }
  }
}

async function loadDone() {
  try {
    const text = await readFile(STATE_PATH, 'utf8');
    const done = new Set();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.ok) done.add(item.imageUrl);
    }
    return done;
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string' },
      resume: { type: 'boolean', default: true },
    },
  });
  const env = loadEnv(await readFile(DASHBOARD_ENV, 'utf8'));
  const upload = createUploader(env);
  const jobs = await fetchJobs(env);
  const done = values.resume ? await loadDone() : new Set();
  let pending = jobs.filter((job) => !done.has(job.imageUrl));
  if (values.limit) pending = pending.slice(0, Number(values.limit));
  console.log(`pending=${pending.length} (skipped_done_urls=${done.size})`);

  const segmenter = await loadSegmenter();
  const failures = [];
  let ok = 0;
  let updatedRows = 0;

  for (let index = 0; index < pending.length; index += 1) {
    const job = pending[index];
    const names = [...new Set(job.rows.map((row) => row.brand_name || ''))].slice(0, 2).join(' / ');
    const ids = job.rows.map((row) => row.id);
    try {
      const source = await downloadImage(job.imageUrl);
      const png = await makeCutoutPng(source, segmenter);
      const productUrl = await upload(png);
      await updateRows(env, ids, productUrl);
      ok += 1;
      updatedRows += ids.length;
      await appendFile(STATE_PATH, `${JSON.stringify({ ok: true, imageUrl: job.imageUrl, productUrl, ids, sns: job.rows.map((r) => r.magnet_sn) })}\n`);
      console.log(`[${index + 1}/${pending.length}] ok ids=${ids.length} ${names} ${productUrl}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ ids, brands: [...new Set(job.rows.map((row) => row.brand_name))], reason, imageUrl: job.imageUrl });
      await appendFile(STATE_PATH, `${JSON.stringify({ ok: false, imageUrl: job.imageUrl, ids, reason })}\n`);
      console.error(`[${index + 1}/${pending.length}] FAIL ${names} :: ${reason}`);
    }
  }

  const summary = { selected: pending.length, succeeded: ok, failed: failures.length, updatedRows, failures };
  await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
