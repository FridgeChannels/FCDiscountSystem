import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test, mock } from 'node:test';
import sharp from 'sharp';
import { handleLogoRelief } from './endpoint.js';
import { estimateImageCost } from './usage.js';

const savedEnv = { ...process.env };
const usageDir = await mkdtemp(join(tmpdir(), 'logo-usage-test-'));
const alaskins = await readFile(new URL('./fixtures/alaskins.webp', import.meta.url));
const silhouette = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="#6b28a0" d="M15 10H85V90H15Z"/></svg>');
const flat = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="#e33" d="M10 10H50V90H10Z"/><path fill="#39f" d="M50 10H90V90H50Z"/></svg>');
const transparentPng = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#38a' } })
  .extend({ top: 10, bottom: 10, left: 10, right: 10, background: '#0000' }).png().toBuffer();
const opaquePng = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#38a' } }).png().toBuffer();
const emptyPng = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#0000' } }).png().toBuffer();
const success = () => Response.json({ data: [{ b64_json: transparentPng.toString('base64') }] });
let upstream = success;
let upstreamCalls = [];
const server = http.createServer((req, res) => {
  const sendJson = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body));
  };
  const sendBinary = (res, status, body, type, headers = {}) => {
    res.writeHead(status, { 'content-type': type, ...headers }); res.end(body);
  };
  handleLogoRelief(req, res, new URL(req.url, 'http://localhost').searchParams, { sendJson, sendBinary });
});

before(async () => {
  process.env.LOGO_USAGE_LOG_DIR = usageDir;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.LOGO_IMAGE_EDIT_TOKEN = 'logo-test';
  process.env.PRODUCT_IMAGE_EDIT_TOKEN = 'product-test';
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    upstreamCalls.push(options);
    return upstream(url, options);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  mock.restoreAll();
  for (const key of ['OPENAI_API_KEY', 'LOGO_IMAGE_EDIT_TOKEN', 'PRODUCT_IMAGE_EDIT_TOKEN', 'LOGO_USAGE_LOG_DIR']) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
  await new Promise(resolve => server.close(resolve));
  await rm(usageDir, { recursive: true, force: true });
});

function startRequest({ query = '', body = alaskins, mime = 'image/webp', token = 'logo-test', method = 'POST' } = {}) {
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/?' + query, method,
      headers: { 'content-type': mime, ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Test request timed out')));
    req.end(body);
  });
  return { req, response };
}
const request = options => startRequest(options).response;

const exampleUsage = { input_tokens: 150, input_tokens_details: { text_tokens: 100, image_tokens: 50 }, output_tokens: 200, total_tokens: 350 };
const readUsage = async () => (await readFile(join(usageDir, 'usage.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);

test('cost estimate requires complete matching usage and preserves unknown as null', () => {
  assert.equal(estimateImageCost('gpt-image-2.5-sunburst', exampleUsage).amount, 0.0069);
  for (const usage of [null, {}, { ...exampleUsage, input_tokens: 0 },
    { ...exampleUsage, output_tokens: -1 }, { ...exampleUsage, output_tokens: '200' },
    { ...exampleUsage, input_tokens_details: { ...exampleUsage.input_tokens_details, cached_tokens: 50 } }]) {
    assert.equal(estimateImageCost('gpt-image-2.5-sunburst', usage), null);
  }
  assert.equal(estimateImageCost('unknown-model', exampleUsage), null);
});

test('saves real usage and provider ID before output validation, without image data or secrets', async () => {
  try {
    upstream = () => Response.json({ usage: exampleUsage, data: [{ b64_json: opaquePng.toString('base64') }] },
      { headers: { 'x-request-id': 'req-test-usage' } });
    assert.equal((await request({ query: 'style=illustration' })).status, 502);
    const events = await readUsage();
    const event = events.at(-1);
    assert.equal(events.at(-2).event, 'started');
    assert.equal(events.at(-2).id, event.id);
    assert.equal(event.event, 'provider_response');
    assert.equal(event.providerRequestId, 'req-test-usage');
    assert.deepEqual(event.usage, exampleUsage);
    assert.equal(event.estimatedCost.amount, 0.0069);
    assert.equal(event.estimatedCost.kind, 'estimate_not_invoice');
    assert.match(event.sourceSha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(events), /test-key|logo-test|b64_json|data:image|authorization|prompt/);
  } finally { upstream = success; }
});

test('missing usage is saved as unknown, never a zero-cost generation', async () => {
  assert.equal((await request({ query: 'style=illustration' })).status, 200);
  const event = (await readUsage()).at(-1);
  assert.equal(event.event, 'provider_response');
  assert.equal(event.usage, null);
  assert.equal(event.estimatedCost, null);
});

test('unwritable usage storage prevents a paid API request', async () => {
  const count = upstreamCalls.length;
  process.env.LOGO_USAGE_LOG_DIR = join(usageDir, 'usage.jsonl', 'not-a-directory');
  try {
    const res = await request({ query: 'style=illustration' });
    assert.equal(res.status, 503);
    assert.match(res.body.toString(), /usage records/);
    assert.equal(upstreamCalls.length, count);
  } finally { process.env.LOGO_USAGE_LOG_DIR = usageDir; }
});

test('auto detects the AlaSkins illustration and submits source plus bundled style reference', async () => {
  upstreamCalls = [];
  const res = await request({ query: 'size=320' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-logo-style'], 'illustration');
  assert.equal(res.headers['x-logo-renderer'], 'ai');
  assert.equal(res.headers['x-logo-model'], 'gpt-image-2.5-sunburst');
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(upstreamCalls.length, 1);
  const edit = JSON.parse(upstreamCalls[0].body);
  assert.equal(edit.n, 1);
  assert.equal(edit.background, 'transparent');
  assert.equal(edit.quality, 'high');
  assert.equal(edit.images.length, 2);
  const source = Buffer.from(edit.images[0].image_url.split(',')[1], 'base64');
  assert.equal((await sharp(source).metadata()).format, 'png');
  assert.ok((await sharp(source).stats()).channels.at(-1).min === 0);
  const reference = Buffer.from(edit.images[1].image_url.split(',')[1], 'base64');
  assert.deepEqual(reference, await readFile(new URL('./reference/pet-depth.png', import.meta.url)));
  const meta = await sharp(res.body).metadata();
  assert.equal(Math.max(meta.width, meta.height), 320);
  assert.equal(meta.hasAlpha, true);
  assert.equal((await sharp(res.body).stats()).channels.at(-1).min, 0);
});

test('explicit illustration honors PNG, size, color and retained backing guidance', async () => {
  const res = await request({ query: 'style=illustration&format=png&size=128&color=681cab&background=keep' });
  assert.equal(res.status, 200);
  const meta = await sharp(res.body).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(Math.max(meta.width, meta.height), 128);
  const edit = JSON.parse(upstreamCalls.at(-1).body);
  assert.match(edit.prompt, /#681cab/);
  assert.match(edit.prompt, /Retain the source backing/);
});

test('automatic silhouette and flat renders remain local without credentials', async () => {
  const count = upstreamCalls.length;
  for (const [body, style] of [[silhouette, 'silhouette'], [flat, 'flat']]) {
    const res = await request({ body, mime: 'image/svg+xml', token: '', query: 'size=180' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-logo-style'], style);
    assert.equal(res.headers['x-logo-renderer'], 'local');
    const meta = await sharp(res.body).metadata();
    assert.ok(Math.max(meta.width, meta.height) <= 180);
  }
  assert.equal(upstreamCalls.length, count);
});

test('both explicit and auto illustration reject missing authorization before provider calls', async () => {
  const count = upstreamCalls.length;
  for (const query of ['style=illustration', 'style=auto']) {
    assert.equal((await request({ query, token: '' })).status, 401);
  }
  assert.equal(upstreamCalls.length, count);
});

test('product token is only a fallback when a separate logo token is absent', async () => {
  assert.equal((await request({ query: 'style=illustration', token: 'product-test' })).status, 401);
  delete process.env.LOGO_IMAGE_EDIT_TOKEN;
  try {
    assert.equal((await request({ query: 'style=illustration', token: 'product-test' })).status, 200);
  } finally { process.env.LOGO_IMAGE_EDIT_TOKEN = 'logo-test'; }
});

test('missing provider configuration fails clearly without the old illustration fallback', async () => {
  const count = upstreamCalls.length;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal((await request({ query: 'style=illustration' })).status, 503);
  } finally { process.env.OPENAI_API_KEY = 'test-key'; }
  assert.equal(upstreamCalls.length, count);
});

test('invalid requests do not reach the image provider', async () => {
  const count = upstreamCalls.length;
  for (const [options, status] of [
    [{ method: 'GET', body: Buffer.alloc(0) }, 405],
    [{ body: Buffer.alloc(0) }, 400],
    [{ query: 'style=invalid' }, 400],
    [{ query: 'size=1201' }, 400],
    [{ query: 'color=nope' }, 400],
    [{ query: 'format=jpeg' }, 400],
    [{ query: 'background=invalid' }, 400],
    [{ mime: 'image/gif' }, 415],
    [{ mime: 'image/png' }, 422],
    [{ body: Buffer.alloc(1024 * 1024 + 1) }, 413],
    [{ mime: 'image/png', body: emptyPng }, 422],
  ]) assert.equal((await request(options)).status, status);
  assert.equal(upstreamCalls.length, count);
});

test('upstream errors are mapped without leaking secrets or retrying a paid request', async () => {
  try {
    for (const [providerStatus, status] of [[400, 422], [401, 503], [403, 503], [404, 503], [429, 429], [500, 502]]) {
      const count = upstreamCalls.length;
      upstream = () => Response.json({ error: { message: 'secret-provider-detail' } }, { status: providerStatus });
      const res = await request({ query: 'style=illustration' });
      assert.equal(res.status, status);
      assert.equal(upstreamCalls.length, count + 1);
      assert.doesNotMatch(res.body.toString(), /secret-provider-detail/);
      assert.equal(res.headers['x-logo-renderer'], 'ai');
    }
  } finally { upstream = success; }
});

test('invalid, opaque and invisible generated images are rejected', async () => {
  try {
    for (const png of [Buffer.from('bad image'), opaquePng, emptyPng]) {
      upstream = () => Response.json({ data: [{ b64_json: png.toString('base64') }] });
      assert.equal((await request({ query: 'style=illustration' })).status, 502);
    }
    upstream = () => Response.json({ data: [] });
    assert.equal((await request({ query: 'style=illustration' })).status, 502);
    upstream = () => new Response('not json');
    assert.equal((await request({ query: 'style=illustration' })).status, 502);
  } finally { upstream = success; }
});

test('provider timeout returns 504 and frees the render slot', async () => {
  try {
    upstream = () => { throw new DOMException('Timed out', 'TimeoutError'); };
    assert.equal((await request({ query: 'style=illustration' })).status, 504);
    const event = (await readUsage()).at(-1);
    assert.equal(event.event, 'usage_unavailable');
    assert.equal(event.estimatedCost, null);
  } finally { upstream = success; }
  assert.equal((await request({ body: silhouette, mime: 'image/svg+xml', token: '' })).status, 200);
});

test('concurrency limit and client disconnect cancellation cover slow AI requests', async () => {
  const pending = [];
  const waitUntil = async predicate => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await delay(10); }
    throw new Error('Timed out waiting for pending edit');
  };
  upstream = (_url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ signal, resolve });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const first = startRequest({ query: 'style=illustration' });
  const firstDone = first.response.catch(error => error);
  const second = startRequest({ query: 'style=illustration' });
  try {
    await waitUntil(() => pending.length === 2);
    const busy = await request({ query: 'style=illustration' });
    assert.equal(busy.status, 429);
    assert.equal(busy.headers['retry-after'], '2');
    first.req.destroy();
    await firstDone;
    await waitUntil(() => pending.some(edit => edit.signal.aborted));
    pending.forEach(edit => edit.resolve(success()));
    assert.equal((await second.response).status, 200);
  } finally {
    upstream = success;
    pending.forEach(edit => edit.resolve(success()));
    first.req.destroy(); second.req.destroy();
  }
  assert.equal((await request({ query: 'style=illustration' })).status, 200);
});
