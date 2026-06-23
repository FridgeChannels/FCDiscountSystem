import http from 'node:http';
import { getRuntimeManifest, validateManifestEntry } from './runtime-manifest.js';
import { splitCouponsIntoPacks } from '../src/api/splitRewardPacks.js';
import {
  fetchBrandAsset,
  isAllowedBrandAssetUrl,
  unwrapBrandAssetProxyUrl,
} from './brandAssetProxy.js';

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
const PLAN_CACHE_TTL_MS = Number(process.env.PLAN_CACHE_TTL_MS ?? 60000);
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

function parseCouponPercent(raw) {
  const parsed = Number.parseInt(String(raw ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function stepCouponId(step) {
  return step?.couponId ?? step?.campaignId ?? null;
}

function formatStepValue(step) {
  if (step?.discountValue) return `${step.discountValue}% OFF`;
  if (step?.couponType === 'free_shipping') return 'FREE SHIPPING';
  return 'Reward';
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
      || String(step.discountValue ?? '').toLowerCase().includes('free ship'),
  );
  if (!validSteps.length) return plan;

  if (validSteps.length === 1) {
    const only = validSteps[0];
    return {
      ...plan,
      initialReward: {
        couponId: stepCouponId(only),
        tier: only.tier,
        discountValue: formatStepNum(only),
        label: formatStepValue(only),
        conditions: 'Sitewide · No minimum',
        couponCode: observedMatchesStep(observed, only) ? observed?.couponCode ?? null : null,
        issued: observedMatchesStep(observed, only) && Boolean(observed?.couponCode),
      },
      targetRewardPack: null,
    };
  }

  const packSeed = plan.rewardPlanId ?? plan.touchId ?? '';
  const { initial: startStep, targetCoupons: targetSteps } = splitCouponsIntoPacks(validSteps, packSeed);

  const initialReward = startStep
    ? {
        couponId: stepCouponId(startStep),
        tier: startStep.tier,
        discountValue: formatStepNum(startStep),
        label: formatStepValue(startStep),
        conditions: 'Sitewide · No minimum',
        couponCode: observedMatchesStep(observed, startStep) ? observed?.couponCode ?? null : null,
        issued: observedMatchesStep(observed, startStep) && Boolean(observed?.couponCode),
      }
    : null;

  const targetRewardPack = targetSteps.length
    ? {
        threshold: plan.ladder?.find((step) => step.tier === 1)?.pointsThreshold ?? 0,
        issued: false,
        coupons: targetSteps.map((step) => ({
          couponId: stepCouponId(step),
          tier: step.tier,
          discountValue: formatStepNum(step),
          label: formatStepValue(step),
          conditions: 'Sitewide · No minimum',
          couponCode: observedMatchesStep(observed, step) ? observed?.couponCode ?? null : null,
          issued: observedMatchesStep(observed, step) && Boolean(observed?.couponCode),
        })),
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

const SHOPIFY_STATUS_CACHE_TTL_MS = Number(process.env.SHOPIFY_STATUS_CACHE_TTL_MS ?? 3600000);
const shopifyStatusCache = new Map(); // touchId -> { data, expiresAt }
const shopifyStatusInflight = new Map(); // touchId -> Promise

const MAGNET_BRAND_PARAM_CACHE_TTL_MS = Number(process.env.MAGNET_BRAND_PARAM_CACHE_TTL_MS ?? 86400000);
const magnetBrandParamCache = new Map(); // touchId -> { data, expiresAt }
const magnetBrandParamInflight = new Map(); // touchId -> Promise

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

function readMagnetBrandParamCache(touchId) {
  const entry = magnetBrandParamCache.get(touchId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) magnetBrandParamCache.delete(touchId);
  return undefined;
}

function writeMagnetBrandParamCache(touchId, data) {
  magnetBrandParamCache.set(touchId, { data, expiresAt: Date.now() + MAGNET_BRAND_PARAM_CACHE_TTL_MS });
}

function getMagnetBrandParamDeduped(touchId, refresh = false) {
  if (!refresh) {
    const cached = readMagnetBrandParamCache(touchId);
    if (cached !== undefined) return Promise.resolve(cached);
  } else {
    magnetBrandParamCache.delete(touchId);
  }
  const existing = magnetBrandParamInflight.get(touchId);
  if (existing) return existing;
  const promise = callEngineGetAllowNull(
    `/identity/magnet-brand-param?touchId=${encodeURIComponent(touchId)}`,
  )
    .then((data) => {
      writeMagnetBrandParamCache(touchId, data ?? null);
      return data ?? null;
    })
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
    'access-control-allow-headers': 'content-type,if-none-match',
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

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

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
      const refresh = url.searchParams.get('refresh') === '1';
      const data = await getMagnetBrandParamDeduped(touchId, refresh);
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
      const data = await callEngine('/identity/player-profile/avatar', {
        touchId: body.touchId,
        contentType: body.contentType,
        dataBase64: body.dataBase64,
      });
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
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const skipPlanCache = url.searchParams.get('refresh') === '1';
      const skipTapReward = url.searchParams.get('skipTapReward') === '1';
      if (!skipPlanCache) {
        const cachedPlan = readPlanCache(touchId);
        if (cachedPlan) {
          sendJson(res, 200, cachedPlan);
          return;
        }
      }
      const data = await getPlanDeduped(touchId, {
        timeoutMs: ENGINE_REWARD_PLAN_TIMEOUT_MS,
        skipTapReward,
      });
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
      const touchId = typeof body.touchId === 'string' ? body.touchId : '';
      const { touchId: _omitTouchId, ...engineBody } = body;
      const data = await callEngine('/games/session/complete', engineBody);
      if (touchId) planCache.delete(touchId);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fc/survey/questions') {
      const touchId = url.searchParams.get('touchId');
      if (!touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const data = await callEngineGet(
        `/survey/questions?touchId=${encodeURIComponent(touchId)}`,
      );
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/survey/answers') {
      const body = await readJson(req);
      const data = await callEngine('/survey/answers', body);
      sendJson(res, 201, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/survey/complete') {
      const body = await readJson(req);
      const data = await callEngine('/survey/complete', body);
      if (body.touchId) planCache.delete(body.touchId);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/coupons/redeem') {
      const body = await readJson(req);
      const data = await callEngine('/coupons/redeem', body);
      if (body.touchId) planCache.delete(body.touchId);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/rewards/claim-initial') {
      const body = await readJson(req);
      const touchId = body?.touchId;
      const rewardPlanId = body?.rewardPlanId;
      if (!touchId || !rewardPlanId) {
        sendJson(res, 400, { error: 'touchId and rewardPlanId required' });
        return;
      }

      const plan = await getPlanDeduped(touchId, { timeoutMs: ENGINE_REWARD_PLAN_TIMEOUT_MS });
      const couponId = plan?.initialReward?.couponId;
      if (!couponId) {
        sendJson(res, 400, { error: 'initial reward coupon not available' });
        return;
      }

      const issued = await callEngine('/coupons/redeem', {
        touchId,
        rewardPlanId,
        couponId,
        campaignId: couponId,
      });
      planCache.delete(touchId);
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
      if (!touchId || !rewardPlanId) {
        sendJson(res, 400, { error: 'touchId and rewardPlanId required' });
        return;
      }

      const plan = await getPlanDeduped(touchId, { timeoutMs: ENGINE_REWARD_PLAN_TIMEOUT_MS });
      const rawCoupons = Array.isArray(plan?.targetRewardPack?.coupons) ? plan.targetRewardPack.coupons : [];
      if (!rawCoupons.length) {
        sendJson(res, 400, { error: 'target reward pack not available' });
        return;
      }

      const packResult = await callEngine('/coupons/redeem-pack', { touchId, rewardPlanId });
      const issuedById = new Map(
        (packResult?.coupons ?? [])
          .filter((coupon) => coupon?.couponId)
          .map((coupon) => [String(coupon.couponId), coupon]),
      );
      const issuedCoupons = rawCoupons.map((coupon) => {
        const couponId = coupon?.couponId;
        const issued = couponId ? issuedById.get(String(couponId)) : null;
        return {
          couponId: issued?.couponId ?? couponId,
          couponCode: issued?.couponCode ?? coupon?.couponCode ?? null,
          discountValue: coupon?.discountValue ?? '',
          label: coupon?.label ?? '',
          conditions: coupon?.conditions ?? '',
          expiresAt: plan?.cycleExpiresAt ?? null,
        };
      });

      planCache.delete(touchId);
      sendJson(res, 200, {
        pack: {
          threshold: plan?.targetRewardPack?.threshold ?? 0,
          coupons: issuedCoupons,
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/coupons/observe') {
      const body = await readJson(req);
      const data = await callEngine('/coupons/observe', body);
      if (body.touchId) planCache.delete(body.touchId);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fc/cycle/renew') {
      const body = await readJson(req);
      const touchId = body.touchId;
      if (!touchId) {
        sendJson(res, 400, { error: 'touchId required' });
        return;
      }
      const data = await callEngine('/cycle/renew', body);
      if (touchId) {
        planCache.delete(touchId);
        writePlanCache(touchId, data);
      }
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
