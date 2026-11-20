import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const { PutObjectCommand, S3Client } = createRequire('/Users/ln/Downloads/DTC-dashboard-2/package.json')('@aws-sdk/client-s3');

const DASHBOARD_ENV = '/Users/ln/Downloads/DTC-dashboard-2/.env';
const PROJECT_ENV = '/Users/ln/Downloads/FCDiscountSystem/.env';
const API_URL = 'http://127.0.0.1:3001/api/fc/brand-assets/product-2p5d/edit';
const STATE_PATH = '/tmp/product-2p5d-edit-state.jsonl';
const SUMMARY_PATH = '/tmp/product-2p5d-edit-summary.json';

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
    // Already-replaced assets live under this prefix; do not send them through edit again.
    .filter((job) => !job.imageUrl.includes('/brand-colors/product-2p5d/'))
    .sort((a, b) => a.rows[0].id - b.rows[0].id);
}

async function loadDone() {
  try {
    const text = await readFile(STATE_PATH, 'utf8');
    const done = new Map();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.ok) done.set(item.imageUrl, item);
    }
    return done;
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
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
    const key = `${prefix}/product-2p5d/${randomUUID()}.png`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
    }));
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  };
}

async function editProduct(imageUrl, token) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ imageUrl }),
      signal: AbortSignal.timeout(260000),
    });
    if (response.status === 429 && attempt <= 12) {
      const waitMs = Math.min(180000, 15000 * (2 ** Math.min(attempt - 1, 4)));
      console.error(`rate limited, waiting ${Math.round(waitMs / 1000)}s before retry ${attempt}/12`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    const usage = {
      total: Number(response.headers.get('x-image-usage-total-tokens')) || 0,
      input: Number(response.headers.get('x-image-usage-input-tokens')) || 0,
      output: Number(response.headers.get('x-image-usage-output-tokens')) || 0,
      inputImage: Number(response.headers.get('x-image-usage-input-image-tokens')) || 0,
      inputText: Number(response.headers.get('x-image-usage-input-text-tokens')) || 0,
      outputImage: Number(response.headers.get('x-image-usage-output-image-tokens')) || 0,
      outputText: Number(response.headers.get('x-image-usage-output-text-tokens')) || 0,
    };
    if (!response.ok) {
      const text = await response.text();
      let message = text.slice(0, 400);
      try { message = JSON.parse(text).error || message; } catch {}
      const error = new Error(`edit HTTP ${response.status}: ${message}`);
      error.status = response.status;
      error.usage = usage;
      throw error;
    }
    const png = Buffer.from(await response.arrayBuffer());
    if (!png.length || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('edit did not return a PNG');
    }
    return { png, usage };
  }
}

async function updateRows(env, ids, productImageUrl, oldById) {
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
      if (!oldById.has(row.id)) throw new Error(`unexpected id ${row.id}`);
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string', default: '30' },
      resume: { type: 'boolean', default: false },
    },
  });
  const dashboardEnv = loadEnv(await readFile(DASHBOARD_ENV, 'utf8'));
  const projectEnv = loadEnv(await readFile(PROJECT_ENV, 'utf8'));
  const token = projectEnv.PRODUCT_IMAGE_EDIT_TOKEN;
  if (!token) throw new Error('PRODUCT_IMAGE_EDIT_TOKEN missing');
  const upload = createUploader(dashboardEnv);
  const jobs = await fetchJobs(dashboardEnv);
  const done = values.resume ? await loadDone() : new Map();
  const pending = jobs.filter((job) => !done.has(job.imageUrl)).slice(0, Number(values.limit));
  console.log(`unique=${jobs.size ?? jobs.length} pending_selected=${pending.length}`);

  const totals = {
    total: 0, input: 0, output: 0, inputImage: 0, inputText: 0, outputImage: 0, outputText: 0,
  };
  const failures = [];
  let ok = 0;

  for (let index = 0; index < pending.length; index++) {
    const job = pending[index];
    const names = [...new Set(job.rows.map((row) => row.brand_name || ''))].slice(0, 2).join(' / ');
    const ids = job.rows.map((row) => row.id);
    try {
      const { png, usage } = await editProduct(job.imageUrl, token);
      for (const key of Object.keys(totals)) totals[key] += usage[key] || 0;
      const productUrl = await upload(png);
      const oldById = new Map(job.rows.map((row) => [row.id, row.product_image_url]));
      await updateRows(dashboardEnv, ids, productUrl, oldById);
      ok += 1;
      const record = {
        ok: true,
        imageUrl: job.imageUrl,
        productUrl,
        ids,
        sns: job.rows.map((row) => row.magnet_sn),
        usage,
      };
      await appendFile(STATE_PATH, `${JSON.stringify(record)}\n`);
      console.log(`[${index + 1}/${pending.length}] ok ids=${ids.length} total=${usage.total} ${names} ${productUrl}`);
    } catch (error) {
      const usage = error.usage || {};
      for (const key of Object.keys(totals)) totals[key] += usage[key] || 0;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ ids, brands: [...new Set(job.rows.map((row) => row.brand_name))], reason, imageUrl: job.imageUrl });
      await appendFile(STATE_PATH, `${JSON.stringify({ ok: false, imageUrl: job.imageUrl, ids, reason, usage })}\n`);
      console.error(`[${index + 1}/${pending.length}] FAIL ${names} :: ${reason}`);
    }
  }

  const summary = {
    selected: pending.length,
    succeeded: ok,
    failed: failures.length,
    updatedRows: ok === 0 ? 0 : pending.slice(0, ok).reduce((sum, job, i) => {
      // recount from state file below instead
      return sum;
    }, 0),
    tokens: totals,
    failures,
  };
  // recount updated rows from successes in this run
  let updatedRows = 0;
  try {
    const text = await readFile(STATE_PATH, 'utf8');
    const lines = text.trim().split('\n').slice(-pending.length);
    for (const line of lines) {
      const item = JSON.parse(line);
      if (item.ok) updatedRows += item.ids.length;
    }
  } catch {}
  summary.updatedRows = updatedRows;
  await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
