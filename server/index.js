import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadProjectEnv } from './load-env.js';
import { getRuntimeManifest, validateManifestEntry } from './runtime-manifest.js';
import { splitCouponsIntoPacks } from '../src/api/splitRewardPacks.js';
import {
  fetchBrandAsset,
  isAllowedBrandAssetUrl,
  unwrapBrandAssetProxyUrl,
} from './brandAssetProxy.js';

loadProjectEnv();

const ENGINE_BASE_URL = process.env.ENGINE_BASE_URL ?? 'http://localhost:8787';
const PORT = Number(process.env.BFF_PORT ?? 3001);
const ENGINE_SERVICE_TOKEN = process.env.ENGINE_SERVICE_TOKEN ?? '';
const ENGINE_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS ?? 30000);
const ENGINE_REWARD_PLAN_TIMEOUT_MS = Number(
  process.env.ENGINE_REWARD_PLAN_TIMEOUT_MS ?? Math.max(ENGINE_TIMEOUT_MS, 120000),
);

// reward-plan: 在途去重。不再用进程内 TTL 短缓存直接回包——
// SQL/DB 旁路 reset 清不掉那层 Map，会 6ms 吐旧 plan、页面完全不变。
// 读路径一律打引擎；引擎 planCache 会校验 active cycle 后再决定命中/重算。
const planInflight = new Map(); // touchId -> Promise

function parseCouponPercent(raw) {
  const parsed = Number.parseInt(String(raw ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function stepCouponId(step) {
  return step?.couponId ?? step?.campaignId ?? null;
}

function formatStepValue(step) {
  if (step?.label) return step.label;
  if (step?.couponType === 'free_shipping') return 'FREE SHIPPING';
  if (step?.couponType === 'buy_x_get_y') return 'BUY X GET Y';
  if (step?.couponType === 'fixed_amount' && step?.discountValue) return `${step.discountValue} OFF`;
  if (step?.discountValue) return `${step.discountValue}% OFF`;
  return 'Reward';
}

function packCouponFromStep(step, observed) {
  return {
    couponId: stepCouponId(step),
    tier: step.tier,
    discountValue: formatStepNum(step),
    label: formatStepValue(step),
    conditions: step.conditions ?? 'No minimum',
    couponType: step.couponType,
    couponCode: observedMatchesStep(observed, step) ? observed?.couponCode ?? null : null,
    issued: observedMatchesStep(observed, step) && Boolean(observed?.couponCode),
  };
}

function formatStepNum(step) {
  if (step?.couponType === 'free_shipping') return '0';
  if (step?.discountValue == null) return '';
  return String(step.discountValue).replace('%', '');
}

function observedMatchesStep(observed, step) {
  if (!observed || !step) return false;
  const observedId = observed.couponId ?? observed.campaignId ?? null;
  const couponId = stepCouponId(step);
  if (observedId && couponId) return observedId === couponId;
  return observed.tier != null && step.tier != null && Number(observed.tier) === Number(step.tier);
}

function normalizePlanForPackFlow(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  if (plan.initialReward || plan.targetRewardPack) return plan;

  const ladder = [...(plan.ladder ?? [])].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
  const observed = plan.observedCoupon ?? plan.currentCoupon ?? null;
  const validSteps = ladder.filter(
    (step) => parseCouponPercent(step.discountValue ?? step.num) > 0
      || step.couponType === 'free_shipping'
      || step.couponType === 'buy_x_get_y'
      || step.couponType === 'fixed_amount'
      || String(step.discountValue ?? '').toLowerCase().includes('free ship'),
  );
  if (!validSteps.length) return plan;

  if (validSteps.length === 1) {
    const only = validSteps[0];
    return {
      ...plan,
      initialReward: packCouponFromStep(only, observed),
      targetRewardPack: null,
    };
  }

  const packSeed = plan.rewardPlanId ?? plan.touchId ?? '';
  const { initial: startStep, targetCoupons: targetSteps } = splitCouponsIntoPacks(validSteps, packSeed);

  const initialReward = startStep ? packCouponFromStep(startStep, observed) : null;

  const targetRewardPack = targetSteps.length
    ? {
        threshold: plan.ladder?.find((step) => step.tier === 1)?.pointsThreshold ?? 0,
        issued: false,
        coupons: targetSteps.map((step) => packCouponFromStep(step, observed)),
      }
    : null;

  return {
    ...plan,
    initialReward,
    targetRewardPack,
  };
}

function getPlanDeduped(touchId, { timeoutMs = ENGINE_REWARD_PLAN_TIMEOUT_MS, skipTapReward = false } = {}) {
  const inflightKey = `${touchId}:${skipTapReward ? 'skipTap' : 'tap'}`;
  const existing = planInflight.get(inflightKey);
  if (existing) return existing;
  const body = { touchId };
  if (skipTapReward) body.skipTapReward = true;
  const promise = callEngine('/reward-plan/generate', body, timeoutMs)
    .then((data) => normalizePlanForPackFlow(data))
    .finally(() => {
      planInflight.delete(inflightKey);
    });
  planInflight.set(inflightKey, promise);
  return promise;
}

function engineErrorMessage(json, status) {
  const err = json?.error;
  if (err && typeof err === 'object') {
    const code = err.code ? String(err.code) : '';
    const message = err.message ? String(err.message) : '';
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
  }
  if (typeof err === 'string' && err.trim()) return err;
  if (typeof json?.message === 'string' && json.message.trim()) return json.message;
  return `HTTP ${status}`;
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error || json.data === null) {
    throw new Error(engineErrorMessage(json, res.status));
  }
  return json.data;
}

async function callEngineGet(path, timeoutMs = ENGINE_TIMEOUT_MS) {
  const headers = {};
  if (ENGINE_SERVICE_TOKEN) {
    headers.authorization = `Bearer ${ENGINE_SERVICE_TOKEN}`;
  }

  const res = await fetch(`${ENGINE_BASE_URL}${path}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (!res.ok || json.error || json.data === null) {
    const msg = json.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data;
}

async function callEngineGetAllowNull(path, timeoutMs = ENGINE_TIMEOUT_MS) {
  const headers = {};
  if (ENGINE_SERVICE_TOKEN) {
    headers.authorization = `Bearer ${ENGINE_SERVICE_TOKEN}`;
  }

  const res = await fetch(`${ENGINE_BASE_URL}${path}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const msg = json.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data ?? null;
}

async function callEnginePatch(path, body, timeoutMs = ENGINE_TIMEOUT_MS) {
  const headers = { 'content-type': 'application/json' };
  if (ENGINE_SERVICE_TOKEN) {
    headers.authorization = `Bearer ${ENGINE_SERVICE_TOKEN}`;
  }

  const res = await fetch(`${ENGINE_BASE_URL}${path}`, {
    method: 'PATCH',
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

function resolveRequestId(req) {
  const fromHeader = req.headers['x-request-id'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  if (Array.isArray(fromHeader) && fromHeader[0]?.trim()) return fromHeader[0].trim();
  return randomUUID();
}

function emitTelemetryEvent(eventType, context = {}) {
  const body = {
    eventType,
    touchId: context.touchId,
    magnetId: context.magnetId,
    customerId: context.customerId,
    cycleId: context.cycleId,
    sessionId: context.sessionId,
    payload: context.payload ?? {},
  };
  void callEngine('/telemetry/event', body, 1500).catch(() => {
    // 埋点失败不影响主业务
  });
}

function emitActionEvent(stage, action, context = {}, extraPayload = {}) {
  emitTelemetryEvent(`user_action_${stage}`, {
    ...context,
    payload: {
      action,
      ...extraPayload,
    },
  });
}

function emitActionFailed(action, context = {}, extraPayload = {}) {
  emitActionEvent('failed', action, context, extraPayload);
}

const SHOPIFY_STATUS_CACHE_TTL_MS = Number(process.env.SHOPIFY_STATUS_CACHE_TTL_MS ?? 3600000);
const shopifyStatusCache = new Map(); // touchId -> { data, expiresAt }
const shopifyStatusInflight = new Map(); // touchId -> Promise

const magnetBrandParamInflight = new Map(); // touchId -> Promise (in-flight dedup only, no TTL cache)

const PLAYER_PROFILE_CACHE_TTL_MS = Number(process.env.PLAYER_PROFILE_CACHE_TTL_MS ?? 86400000);
const playerProfileCache = new Map(); // touchId -> { data, expiresAt }
const playerProfileInflight = new Map(); // touchId -> Promise

const LEADERBOARD_CACHE_TTL_MS = Number(process.env.LEADERBOARD_CACHE_TTL_MS ?? 30000);
const leaderboardCache = new Map(); // touchId -> { data, expiresAt }
const leaderboardInflight = new Map(); // touchId -> Promise

function readShopifyStatusCache(touchId) {
  const entry = shopifyStatusCache.get(touchId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) shopifyStatusCache.delete(touchId);
  return null;
}

function writeShopifyStatusCache(touchId, data) {
  shopifyStatusCache.set(touchId, { data, expiresAt: Date.now() + SHOPIFY_STATUS_CACHE_TTL_MS });
}

function getShopifyStatusDeduped(touchId, refresh = false) {
  if (!refresh) {
    const cached = readShopifyStatusCache(touchId);
    if (cached) return Promise.resolve(cached);
  } else {
    shopifyStatusCache.delete(touchId);
  }
  const existing = shopifyStatusInflight.get(touchId);
  if (existing) return existing;
  const refreshQs = refresh ? '&refresh=1' : '';
  const promise = callEngineGet(
    `/identity/shopify-status?touchId=${encodeURIComponent(touchId)}${refreshQs}`,
  )
    .then((data) => {
      writeShopifyStatusCache(touchId, data);
      return data;
    })
    .finally(() => {
      shopifyStatusInflight.delete(touchId);
    });
  shopifyStatusInflight.set(touchId, promise);
  return promise;
}

function getMagnetBrandParamDeduped(touchId) {
  const existing = magnetBrandParamInflight.get(touchId);
  if (existing) return existing;
  const promise = callEngineGetAllowNull(
    `/identity/magnet-brand-param?touchId=${encodeURIComponent(touchId)}`,
  )
    .then((data) => data ?? null)
    .finally(() => {
      magnetBrandParamInflight.delete(touchId);
    });
  magnetBrandParamInflight.set(touchId, promise);
  return promise;
}

function readPlayerProfileCache(touchId) {
  const entry = playerProfileCache.get(touchId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) playerProfileCache.delete(touchId);
  return null;
}

function writePlayerProfileCache(touchId, data) {
  playerProfileCache.set(touchId, { data, expiresAt: Date.now() + PLAYER_PROFILE_CACHE_TTL_MS });
}

function getPlayerProfileDeduped(touchId, refresh = false) {
  if (!refresh) {
    const cached = readPlayerProfileCache(touchId);
    if (cached) return Promise.resolve(cached);
  } else {
    playerProfileCache.delete(touchId);
  }
  const existing = playerProfileInflight.get(touchId);
  if (existing) return existing;
  const promise = callEngineGet(
    `/identity/player-profile?touchId=${encodeURIComponent(touchId)}`,
  )
    .then((data) => {
      writePlayerProfileCache(touchId, data);
      return data;
    })
    .finally(() => {
      playerProfileInflight.delete(touchId);
    });
  playerProfileInflight.set(touchId, promise);
  return promise;
}

function readLeaderboardCache(touchId) {
  const entry = leaderboardCache.get(touchId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) leaderboardCache.delete(touchId);
  return null;
}

function writeLeaderboardCache(touchId, data) {
  leaderboardCache.set(touchId, { data, expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS });
}

function getLeaderboardDeduped(touchId, refresh = false) {
  if (!refresh) {
    const cached = readLeaderboardCache(touchId);
    if (cached) return Promise.resolve(cached);
  } else {
    leaderboardCache.delete(touchId);
  }
  const existing = leaderboardInflight.get(touchId);
  if (existing) return existing;
  const promise = callEngineGet(
    `/leaderboard/today?touchId=${encodeURIComponent(touchId)}`,
  )
    .then((data) => {
      writeLeaderboardCache(touchId, data);
      return data;
    })
    .finally(() => {
      leaderboardInflight.delete(touchId);
    });
  leaderboardInflight.set(touchId, promise);
  return promise;
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
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,if-none-match,x-request-id',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function sendBinary(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
    ...extraHeaders,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, null);
    return;
  }

  let requestId = resolveRequestId(req);
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    res.setHeader('x-request-id', requestId);

    if (req.method === 'GET' && url.pathname === '/api/fc/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/brand-asset') {
      const rawTarget = url.searchParams.get('url')?.trim();
      if (!rawTarget) {
        sendJson(res, 400, { error: 'url query parameter required' });
        return;
      }
      const target = unwrapBrandAssetProxyUrl(rawTarget);
      if (!isAllowedBrandAssetUrl(target)) {
        sendJson(res, 403, { error: 'url not allowed' });
        return;
      }
      try {
        const asset = await fetchBrandAsset(target);
        sendBinary(res, 200, asset.body, asset.contentType);
      } catch (err) {
        const status = err?.statusCode === 502 ? 502 : 502;
        sendJson(res, status, {
          error: err instanceof Error ? err.message : 'brand asset proxy failed',
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/shopify-status') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const refresh = url.searchParams.get('refresh') === '1';
      const data = await getShopifyStatusDeduped(touchId, refresh);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/magnet-brand-param') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const data = await getMagnetBrandParamDeduped(touchId);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/player-profile') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const refresh = url.searchParams.get('refresh') === '1';
      const data = await getPlayerProfileDeduped(touchId, refresh);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'PATCH' && url.pathname === '/api/fc/player-profile') {
      const body = await readJson(req);
      if (!body?.touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const data = await callEnginePatch('/identity/player-profile', {
        touchId: body.touchId,
        displayCode: body.displayCode,
        displayName: body.displayName,
        avatarColor: body.avatarColor,
        clearAvatarImage: body.clearAvatarImage,
      });
      writePlayerProfileCache(body.touchId, data);
      leaderboardCache.delete(body.touchId);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/player-profile/avatar') {
      const body = await readJson(req);
      if (!body?.touchId || !body?.contentType || !body?.dataBase64) {
        sendJson(res, 400, { error: 'touchId, contentType and dataBase64 required' });
        return;
      }
      // Storage upload of ~2MB base64 payloads can exceed the default engine timeout.
      const data = await callEngine(
        '/identity/player-profile/avatar',
        {
          touchId: body.touchId,
          contentType: body.contentType,
          dataBase64: body.dataBase64,
        },
        Math.max(ENGINE_TIMEOUT_MS, 120000),
      );
      writePlayerProfileCache(body.touchId, data);
      leaderboardCache.delete(body.touchId);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/leaderboard/today') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const refresh = url.searchParams.get('refresh') === '1';
      const data = await getLeaderboardDeduped(touchId, refresh);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/reward-plan') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        emitActionFailed('reward_plan_generate', {}, { requestId, reason: 'TOUCH_ID_REQUIRED' });
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const skipTapReward = url.searchParams.get('skipTapReward') === '1';
      emitTelemetryEvent('tap_received', {
        touchId,
        payload: { requestId, cacheHit: false, skipTapReward },
      });
      emitActionEvent('attempted', 'reward_plan_generate', { touchId }, {
        requestId,
        cacheHit: false,
      });
      const data = await getPlanDeduped(touchId, {
        timeoutMs: ENGINE_REWARD_PLAN_TIMEOUT_MS,
        skipTapReward,
      });
      emitActionEvent('succeeded', 'reward_plan_generate', { touchId }, {
        requestId,
        cacheHit: false,
      });
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
      emitActionEvent('attempted', 'session_start', { touchId: body?.touchId }, { requestId });
      const data = await callEngine('/games/session/start', body);
      emitActionEvent('succeeded', 'session_start', { touchId: body?.touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/session/complete') {
      const body = await readJson(req);
      const touchId = typeof body.touchId === 'string' ? body.touchId : '';
      emitActionEvent('attempted', 'session_complete', { touchId }, { requestId });
      const { touchId: _omitTouchId, ...engineBody } = body;
      const data = await callEngine('/games/session/complete', engineBody);
      emitActionEvent('succeeded', 'session_complete', { touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/survey/questions') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        emitActionFailed('survey_questions', {}, { requestId, reason: 'TOUCH_ID_REQUIRED' });
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      emitActionEvent('attempted', 'survey_questions', { touchId }, { requestId });
      const data = await callEngineGet(
        `/survey/questions?touchId=${encodeURIComponent(touchId)}`,
      );
      emitActionEvent('succeeded', 'survey_questions', { touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/survey/answers') {
      const body = await readJson(req);
      emitActionEvent('attempted', 'survey_answers', { touchId: body?.touchId }, { requestId });
      const data = await callEngine('/survey/answers', body);
      emitActionEvent('succeeded', 'survey_answers', { touchId: body?.touchId }, { requestId });
      sendJson(res, 201, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/survey/complete') {
      const body = await readJson(req);
      emitActionEvent('attempted', 'survey_complete', { touchId: body?.touchId }, { requestId });
      const data = await callEngine('/survey/complete', body);
      emitActionEvent('succeeded', 'survey_complete', { touchId: body?.touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/coupons/redeem') {
      const body = await readJson(req);
      emitActionEvent('attempted', 'coupon_redeem', { touchId: body?.touchId }, { requestId });
      const data = await callEngine('/coupons/redeem', body);
      emitActionEvent('succeeded', 'coupon_redeem', { touchId: body?.touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/rewards/claim-initial') {
      const body = await readJson(req);
      const touchId = body?.touchId;
      const rewardPlanId = body?.rewardPlanId;
      emitActionEvent('attempted', 'claim_initial', { touchId }, { requestId, rewardPlanId });
      if (!touchId || !rewardPlanId) {
        emitActionFailed('claim_initial', { touchId }, {
          requestId,
          rewardPlanId,
          reason: 'TOUCH_ID_OR_REWARD_PLAN_ID_REQUIRED',
        });
        sendJson(res, 400, { error: 'touchId and rewardPlanId required' });
        return;
      }

      const plan = await getPlanDeduped(touchId, { timeoutMs: ENGINE_REWARD_PLAN_TIMEOUT_MS });
      const couponId = plan?.initialReward?.couponId;
      if (!couponId) {
        emitActionFailed('claim_initial', { touchId }, {
          requestId,
          rewardPlanId,
          reason: 'INITIAL_REWARD_NOT_AVAILABLE',
        });
        sendJson(res, 400, { error: 'initial reward coupon not available' });
        return;
      }

      const issued = await callEngine('/coupons/redeem', {
        touchId,
        rewardPlanId,
        couponId,
        campaignId: couponId,
      });
      emitActionEvent('succeeded', 'claim_initial', { touchId }, { requestId, rewardPlanId });
      sendJson(res, 200, {
        coupon: {
          couponId: issued?.couponId ?? couponId,
          couponCode: issued?.couponCode ?? plan?.initialReward?.couponCode ?? null,
          discountValue: plan?.initialReward?.discountValue ?? '',
          label: plan?.initialReward?.label ?? '',
          conditions: plan?.initialReward?.conditions ?? '',
          expiresAt: plan?.cycleExpiresAt ?? null,
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/rewards/claim-target-pack') {
      const body = await readJson(req);
      const touchId = body?.touchId;
      const rewardPlanId = body?.rewardPlanId;
      emitActionEvent('attempted', 'claim_target_pack', { touchId }, { requestId, rewardPlanId });
      if (!touchId || !rewardPlanId) {
        emitActionFailed('claim_target_pack', { touchId }, {
          requestId,
          rewardPlanId,
          reason: 'TOUCH_ID_OR_REWARD_PLAN_ID_REQUIRED',
        });
        sendJson(res, 400, { error: 'touchId and rewardPlanId required' });
        return;
      }

      const packResult = await callEngine('/coupons/redeem-pack', { touchId, rewardPlanId });
      const issuedCoupons = (packResult?.coupons ?? []).map((coupon) => ({
        couponId: coupon?.couponId ?? null,
        couponCode: coupon?.couponCode ?? null,
      }));

      emitActionEvent('succeeded', 'claim_target_pack', { touchId }, { requestId, rewardPlanId });
      sendJson(res, 200, {
        pack: {
          threshold: 0,
          coupons: issuedCoupons,
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/coupons/observe') {
      const body = await readJson(req);
      emitActionEvent('attempted', 'coupon_observe', { touchId: body?.touchId }, { requestId });
      const data = await callEngine('/coupons/observe', body);
      emitActionEvent('succeeded', 'coupon_observe', { touchId: body?.touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/coupons/wallet') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        emitActionFailed('coupon_wallet', {}, { requestId, reason: 'TOUCH_ID_REQUIRED' });
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      emitActionEvent('attempted', 'coupon_wallet', { touchId }, { requestId });
      const limit = url.searchParams.get('limit');
      const qs = limit ? `&limit=${encodeURIComponent(limit)}` : '';
      const coupons = await callEngineGet(
        `/coupons/wallet?touchId=${encodeURIComponent(touchId)}${qs}`,
      );
      emitActionEvent('succeeded', 'coupon_wallet', { touchId }, { requestId });
      sendJson(res, 200, { coupons });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/cycle/renew') {
      const body = await readJson(req);
      const touchId = body.touchId;
      emitActionEvent('attempted', 'cycle_renew', { touchId }, { requestId });
      if (!touchId) {
        emitActionFailed('cycle_renew', {}, { requestId, reason: 'TOUCH_ID_REQUIRED' });
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      if (body.reason === 'manual' && process.env.FC_DEMO_FORCE_RENEW_ENABLED !== 'true') {
        emitActionFailed('cycle_renew', { touchId }, { requestId, reason: 'MANUAL_RENEW_DISABLED' });
        sendJson(res, 403, { error: 'manual cycle renew is disabled' });
        return;
      }
      const data = await callEngine('/cycle/renew', body);
      emitActionEvent('succeeded', 'cycle_renew', { touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/cycle/force-expire') {
      const body = await readJson(req);
      const touchId = body.touchId;
      emitActionEvent('attempted', 'cycle_force_expire', { touchId }, { requestId });
      if (!touchId) {
        emitActionFailed('cycle_force_expire', {}, { requestId, reason: 'TOUCH_ID_REQUIRED' });
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      if (process.env.FC_DEMO_FORCE_RENEW_ENABLED !== 'true') {
        emitActionFailed('cycle_force_expire', { touchId }, { requestId, reason: 'FORCE_EXPIRE_DISABLED' });
        sendJson(res, 403, { error: 'demo force expire is disabled' });
        return;
      }
      const data = await callEngine('/cycle/force-expire', body);
      emitActionEvent('succeeded', 'cycle_force_expire', { touchId }, { requestId });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/cycle/sample-reset') {
      const body = await readJson(req);
      const touchId = body.touchId;
      emitActionEvent('attempted', 'cycle_sample_reset', { touchId }, { requestId });
      if (!touchId) {
        emitActionFailed('cycle_sample_reset', {}, { requestId, reason: 'TOUCH_ID_REQUIRED' });
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      try {
        const data = await callEngine('/cycle/sample-reset', { touchId });
        emitActionEvent('succeeded', 'cycle_sample_reset', { touchId }, { requestId });
        sendJson(res, 200, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'sample reset failed';
        const forbidden = message.includes('SAMPLE_RESET_FORBIDDEN') || message.includes('sample reset is only allowed');
        emitActionFailed('cycle_sample_reset', { touchId }, {
          requestId,
          reason: forbidden ? 'SAMPLE_RESET_FORBIDDEN' : 'SAMPLE_RESET_FAILED',
        });
        sendJson(res, forbidden ? 403 : 400, { error: message });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    emitTelemetryEvent('user_action_failed', {
      payload: {
        requestId,
        path: req.url ?? '',
        method: req.method ?? '',
        message: err instanceof Error ? err.message : 'request failed',
      },
    });
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'request failed' });
  }
});

server.listen(PORT, () => {
  console.log(`FCDiscountSystem BFF listening on http://localhost:${PORT}`);
});
