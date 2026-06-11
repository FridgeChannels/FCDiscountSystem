import http from 'node:http';
import { getRuntimeManifest, validateManifestEntry } from './runtime-manifest.js';

const ENGINE_BASE_URL = process.env.ENGINE_BASE_URL ?? 'http://localhost:8787';
const PORT = Number(process.env.BFF_PORT ?? 3001);
const ENGINE_SERVICE_TOKEN = process.env.ENGINE_SERVICE_TOKEN ?? '';
const ENGINE_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS ?? 30000);
const ENGINE_REWARD_PLAN_TIMEOUT_MS = Number(
  process.env.ENGINE_REWARD_PLAN_TIMEOUT_MS ?? Math.max(ENGINE_TIMEOUT_MS, 120000),
);

// 阶段5:reward-plan 服务端短缓存 + 在途去重。
// - 同一 touchId 的并发请求只打一次引擎(去重)
// - 命中短缓存的请求直接返回,降低引擎压力与首屏延迟
const PLAN_CACHE_TTL_MS = Number(process.env.PLAN_CACHE_TTL_MS ?? 15000);
const planCache = new Map(); // touchId -> { data, expiresAt }
const planInflight = new Map(); // touchId -> Promise

function readPlanCache(touchId) {
  const entry = planCache.get(touchId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) planCache.delete(touchId);
  return null;
}

function writePlanCache(touchId, data) {
  planCache.set(touchId, { data, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
}

function getPlanDeduped(touchId, timeoutMs = ENGINE_REWARD_PLAN_TIMEOUT_MS) {
  const existing = planInflight.get(touchId);
  if (existing) return existing;
  const promise = callEngine('/reward-plan/generate', { touchId }, timeoutMs).finally(() => {
    planInflight.delete(touchId);
  });
  planInflight.set(touchId, promise);
  return promise;
}

async function callEngine(path, body, timeoutMs = ENGINE_TIMEOUT_MS) {
  const headers = { 'content-type': 'application/json' };
  if (ENGINE_SERVICE_TOKEN) {
    headers.authorization = `Bearer ${ENGINE_SERVICE_TOKEN}`;
  }

  const res = await fetch(`${ENGINE_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (!res.ok || json.error || json.data === null) {
    const msg = json.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data;
}


function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,if-none-match',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, null);
    return;
  }

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/fc/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/reward-plan') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const cachedPlan = readPlanCache(touchId);
      if (cachedPlan) {
        sendJson(res, 200, cachedPlan);
        return;
      }
      const data = await getPlanDeduped(touchId, ENGINE_REWARD_PLAN_TIMEOUT_MS);
      writePlanCache(touchId, data);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/games/manifest') {
      const touchId = url.searchParams.get('touchId') || 'anonymous';
      const document = await getRuntimeManifest(touchId);
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === document.etag) {
        res.writeHead(304, {
          etag: document.etag,
          'cache-control': `private, max-age=${document.payload.ttlSeconds}`,
          'access-control-allow-origin': '*',
        });
        res.end();
        return;
      }

      const hasInvalidEntry = document.payload.entries.some(
        (entry) => !validateManifestEntry(entry),
      );
      if (hasInvalidEntry) {
        sendJson(res, 500, { error: 'manifest validation failed' });
        return;
      }

      sendJson(
        res,
        200,
        document,
        {
          etag: document.etag,
          'cache-control': `private, max-age=${document.payload.ttlSeconds}`,
        },
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/session/start') {
      const body = await readJson(req);
      const data = await callEngine('/games/session/start', body);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/session/complete') {
      const body = await readJson(req);
      const data = await callEngine('/games/session/complete', body);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/survey/complete') {
      const body = await readJson(req);
      const data = await callEngine('/survey/complete', body);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/coupons/redeem') {
      const body = await readJson(req);
      const data = await callEngine('/coupons/redeem', body);
      sendJson(res, 200, data);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'request failed' });
  }
});

server.listen(PORT, () => {
  console.log(`FCDiscountSystem BFF listening on http://localhost:${PORT}`);
});
