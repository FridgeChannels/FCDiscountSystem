import { randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { PutObjectCommand, S3Client } = createRequire('/Users/ln/Downloads/DTC-dashboard-2/package.json')('@aws-sdk/client-s3');

const MAX_BYTES = 1024 * 1024;
const API_URL = 'http://127.0.0.1:3001/api/fc/brand-assets/logo-2p5d';
const ENV_PATH = '/Users/ln/Downloads/DTC-dashboard-2/.env';
const STATE_PATH = process.env.WORDMARK_BACKFILL_STATE || '/tmp/wordmark-backfill-state.jsonl';

function apiUrlForStyle(style) {
  if (!style || style === 'auto') return API_URL;
  const url = new URL(API_URL);
  url.searchParams.set('style', style);
  return url.toString();
}

sharp.cache(false);

function loadEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function sniff(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) return 'gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  const text = buffer.subarray(0, Math.min(buffer.length, 800)).toString('utf8').trimStart();
  if (text.startsWith('<') && /<svg[\s>]/i.test(text)) return 'svg';
  return 'unknown';
}

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

async function toPng(buffer) {
  return sharp(buffer, { animated: false }).png().toBuffer();
}

async function shrink(buffer) {
  let size = 1400;
  while (size >= 256) {
    const output = await sharp(buffer)
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    if (output.length <= MAX_BYTES) return output;
    size = Math.floor(size * 0.75);
  }
  throw new Error('logo still exceeds 1 MiB after resize');
}

async function prepareInput(buffer) {
  let kind = sniff(buffer);
  let rasterized = false;
  if (kind === 'gif' || kind === 'avif' || kind === 'unknown') {
    buffer = await toPng(buffer);
    kind = 'png';
    rasterized = true;
  }
  if (kind === 'svg' && (buffer.length > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(buffer.toString('utf8')))) {
    buffer = await toPng(buffer);
    kind = 'png';
    rasterized = true;
  }
  if (buffer.length > MAX_BYTES && kind !== 'svg') {
    buffer = await shrink(buffer);
    kind = 'png';
    rasterized = true;
  }
  if (buffer.length > MAX_BYTES) throw new Error('logo exceeds 1 MiB');
  if (!MIME[kind]) throw new Error(`unsupported logo type: ${kind}`);
  return { buffer, mime: MIME[kind], rasterized };
}

async function downloadLogo(logoUrl) {
  if (logoUrl.startsWith('data:image/')) {
    const match = logoUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error('invalid data URL logo');
    return Buffer.from(match[2], 'base64');
  }
  if (!/^https?:\/\//i.test(logoUrl)) throw new Error('brand_logo is not an http(s) URL');
  const response = await fetch(logoUrl, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!response.ok) throw new Error(`logo download failed: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 20 * 1024 * 1024) throw new Error('logo download exceeds 20 MiB');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('logo download exceeds 20 MiB');
  if (!bytes.length) throw new Error('logo download was empty');
  return bytes;
}

async function renderLogo(buffer, mime, editToken, forcedStyle = 'auto') {
  let attempt = 0;
  const requestUrl = apiUrlForStyle(forcedStyle);
  while (true) {
    attempt += 1;
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'content-type': mime, ...(editToken ? { authorization: `Bearer ${editToken}` } : {}) },
      body: buffer,
      signal: AbortSignal.timeout(270000),
    });
    // Only local capacity rejections are safe to retry automatically. A network
    // failure or AI error may already have consumed a paid generation.
    if (response.status === 429 && response.headers.has('retry-after') && attempt <= 6) {
      await response.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    const style = response.headers.get('x-logo-style');
    const renderer = response.headers.get('x-logo-renderer') || 'unknown';
    const model = response.headers.get('x-logo-model') || null;
    if (!response.ok) {
      const text = await response.text();
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text).error || message;
      } catch {
        // keep text
      }
      const error = new Error(`render HTTP ${response.status}: ${message}`);
      error.status = response.status;
      error.ai = renderer === 'ai';
      throw error;
    }
    const output = Buffer.from(await response.arrayBuffer());
    if (!output.length) throw new Error('render returned an empty image');
    return { output, style: style || 'unknown', renderer, model };
  }
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
    const key = `${prefix}/wordmarks/${randomUUID()}.webp`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/webp',
    }));
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  };
}

function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function isFridgeChannels(website) {
  const value = String(website || '').trim().replace(/\/+$/, '').toLowerCase();
  return value === 'https://fridgechannels.com' || value === 'http://fridgechannels.com' || value === 'fridgechannels.com';
}

function needsWordmark(row) {
  return !String(row.brand_wordmark_url || '').trim();
}

async function fetchRows(env) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const url = new URL('/rest/v1/magnet_brand_param', env.SUPABASE_URL);
    url.searchParams.set('select', 'id,brand_name,magnet_sn,brand_logo,brand_wordmark_url,website');
    url.searchParams.set('experience', 'eq.dtc');
    url.searchParams.set('brand_logo', 'not.is.null');
    url.searchParams.set('order', 'id.asc');
    const response = await fetch(url, {
      headers: supabaseHeaders(env, { range: `${from}-${from + 499}` }),
    });
    if (!response.ok) throw new Error(`query failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows.filter((row) => String(row.brand_logo || '').trim() && needsWordmark(row) && !isFridgeChannels(row.website));
}

async function updateRows(env, ids, wordmarkUrl, logosById) {
  for (let offset = 0; offset < ids.length; offset += 80) {
    const part = ids.slice(offset, offset + 80);
    const url = new URL('/rest/v1/magnet_brand_param', env.SUPABASE_URL);
    // Only fill empty wordmarks for the exact ids in this job.
    url.searchParams.set('id', `in.(${part.join(',')})`);
    url.searchParams.set('or', '(brand_wordmark_url.is.null,brand_wordmark_url.eq.)');
    url.searchParams.set('select', 'id,brand_logo,brand_wordmark_url');
    const response = await fetch(url, {
      method: 'PATCH',
      headers: supabaseHeaders(env, {
        'content-type': 'application/json',
        prefer: 'return=representation',
      }),
      body: JSON.stringify({ brand_wordmark_url: wordmarkUrl }),
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`update failed HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
    const updated = JSON.parse(bodyText);
    if (updated.length !== part.length) throw new Error(`updated ${updated.length} of ${part.length} rows`);
    for (const row of updated) {
      if (row.brand_logo !== logosById.get(row.id)) throw new Error(`brand_logo changed on id ${row.id}`);
      if (row.brand_wordmark_url !== wordmarkUrl) throw new Error(`wordmark mismatch on id ${row.id}`);
    }
  }
}

async function loadSuccesses() {
  try {
    const text = await readFile(STATE_PATH, 'utf8');
    const successes = new Map();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.ok) successes.set(item.key || item.logo, item.wordmarkUrl);
    }
    return successes;
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
}

let writeChain = Promise.resolve();
function enqueueWrite(line) {
  writeChain = writeChain.then(() => appendFile(STATE_PATH, `${line}\n`));
  return writeChain;
}

function isPaidIllustrationSkip(error) {
  // Without an edit token, auto-classified illustrations stop at auth and never
  // call OpenAI. Treat those as deferred, not hard failures.
  return error?.status === 401
    || (error?.status === 503 && /LOGO_IMAGE_EDIT_TOKEN|OPENAI_API_KEY|illustration/i.test(String(error.message || '')));
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string' },
      single: { type: 'boolean', default: false },
      resume: { type: 'boolean', default: false },
      'local-only': { type: 'boolean', default: false },
      'force-style': { type: 'string' },
      // One API render + S3 upload + DB update per magnet row. No logo grouping.
      'per-row': { type: 'boolean', default: false },
      // Single worker, true sequential order by id.
      sequential: { type: 'boolean', default: false },
    },
  });
  const localOnly = Boolean(values['local-only']);
  const perRow = Boolean(values['per-row']);
  const sequential = Boolean(values.sequential) || perRow;
  // local-only defaults to silhouette so auto-illustration logos still render
  // locally instead of calling the paid OpenAI path.
  const forcedStyle = values['force-style']
    || (localOnly ? 'silhouette' : 'auto');
  if (!['auto', 'silhouette', 'flat', 'illustration'].includes(forcedStyle)) {
    throw new Error('force-style must be auto, silhouette, flat or illustration');
  }
  const env = loadEnv(await readFile(ENV_PATH, 'utf8'));
  const localEnv = loadEnv(await readFile(new URL('../.env', import.meta.url), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  }));
  const editToken = localOnly || ['silhouette', 'flat'].includes(forcedStyle)
    ? null
    : (process.env.LOGO_IMAGE_EDIT_TOKEN || localEnv.LOGO_IMAGE_EDIT_TOKEN
      || process.env.PRODUCT_IMAGE_EDIT_TOKEN || localEnv.PRODUCT_IMAGE_EDIT_TOKEN);
  const upload = createUploader(env);
  const rows = await fetchRows(env);
  let jobs;
  if (perRow) {
    jobs = rows
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ logo: String(row.brand_logo).trim(), rows: [row], key: `id:${row.id}` }));
  } else {
    const groups = new Map();
    for (const row of rows) {
      const logo = String(row.brand_logo).trim();
      const group = groups.get(logo) ?? [];
      group.push(row);
      groups.set(logo, group);
    }
    jobs = [...groups.entries()]
      .map(([logo, groupRows]) => ({ logo, rows: groupRows.sort((a, b) => a.id - b.id), key: logo }))
      .sort((a, b) => a.rows[0].id - b.rows[0].id);
  }
  if (values.single) jobs = jobs.filter((job) => job.rows.length === 1);
  if (values.limit) jobs = jobs.slice(0, Number(values.limit));
  const successes = values.resume ? await loadSuccesses() : new Map();
  const pending = jobs.filter((job) => !successes.has(job.key));
  console.log(`rows=${rows.length} jobs=${jobs.length} pending=${pending.length} perRow=${perRow} sequential=${sequential} localOnly=${localOnly} forceStyle=${forcedStyle}`);

  const failures = [];
  const skipped = [];
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const index = cursor;
      const job = pending[cursor];
      cursor += 1;
      const names = [...new Set(job.rows.map((row) => row.brand_name || ''))].slice(0, 3).join(' / ');
      const idLabel = job.rows.map((row) => row.id).join(',');
      try {
        const source = await downloadLogo(job.logo);
        let prepared = await prepareInput(source);
        let rendered;
        try {
          rendered = await renderLogo(prepared.buffer, prepared.mime, editToken, forcedStyle);
        } catch (error) {
          if (localOnly && forcedStyle === 'auto' && isPaidIllustrationSkip(error)) throw error;
          if (!error.ai && !prepared.rasterized && (error.status === 415 || error.status === 422)) {
            let png = await toPng(source);
            if (png.length > MAX_BYTES) png = await shrink(png);
            rendered = await renderLogo(png, 'image/png', editToken, forcedStyle);
          } else {
            throw error;
          }
        }
        if ((localOnly || ['silhouette', 'flat'].includes(forcedStyle)) && rendered.renderer === 'ai') {
          throw Object.assign(new Error('local-only refused paid AI render'), { status: 401 });
        }
        const wordmarkUrl = await upload(rendered.output);
        const logosById = new Map(job.rows.map((row) => [row.id, row.brand_logo]));
        await updateRows(env, job.rows.map((row) => row.id), wordmarkUrl, logosById);
        await enqueueWrite(JSON.stringify({
          ok: true,
          key: job.key,
          logo: job.logo,
          wordmarkUrl,
          ids: job.rows.map((row) => row.id),
          brands: [...new Set(job.rows.map((row) => row.brand_name))],
          style: rendered.style,
          renderer: rendered.renderer,
          model: rendered.model,
        }));
        console.log(`[${index + 1}/${pending.length}] ok id=${idLabel} style=${rendered.style} renderer=${rendered.renderer} ${names} ${wordmarkUrl}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const entry = {
          ids: job.rows.map((row) => row.id),
          brands: [...new Set(job.rows.map((row) => row.brand_name))],
          logo: job.logo,
          reason,
          ai: Boolean(error?.ai) || isPaidIllustrationSkip(error),
        };
        if (localOnly && forcedStyle === 'auto' && isPaidIllustrationSkip(error)) {
          skipped.push(entry);
          await enqueueWrite(JSON.stringify({ ok: false, skipped: true, needsAi: true, key: job.key, logo: job.logo, ids: entry.ids, reason }));
          console.log(`[${index + 1}/${pending.length}] SKIP needs-ai id=${idLabel} ${names}`);
        } else {
          failures.push(entry);
          await enqueueWrite(JSON.stringify({ ok: false, key: job.key, logo: job.logo, ids: entry.ids, reason, ai: entry.ai }));
          console.error(`[${index + 1}/${pending.length}] FAIL id=${idLabel} ${names} :: ${reason}`);
        }
      }
    }
  }
  if (sequential) await worker();
  else await Promise.all([worker(), worker()]);
  console.log(JSON.stringify({
    updatedJobs: pending.length - failures.length - skipped.length,
    failedJobs: failures.length,
    skippedNeedsAi: skipped.length,
    failedRows: failures.reduce((sum, item) => sum + item.ids.length, 0),
    skippedRows: skipped.reduce((sum, item) => sum + item.ids.length, 0),
  }));
  if (skipped.length) {
    console.log('SKIPPED_NEEDS_AI');
    for (const item of skipped) {
      console.log(`${item.ids.join(',')} | ${item.brands.join(' / ')} | ${item.logo}`);
    }
  }
  if (failures.length) {
    console.log('FAILURES');
    for (const failure of failures) {
      console.log(`${failure.ids.join(',')} | ${failure.brands.join(' / ')} | ${failure.reason} | ${failure.logo}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
