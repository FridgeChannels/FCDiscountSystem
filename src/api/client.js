import { readRememberedTouchId } from './cache.js';
import { dbg } from '../lib/debug.js';

function resolveTouchIdForRequest() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('touchId');
  if (fromQuery) return fromQuery;
  const pathMatch = window.location.pathname.match(/^\/(?:p|t)\/([^/]+)\/?$/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  return readRememberedTouchId();
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const NORMALIZED_API_BASE = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

function buildApiUrl(path) {
  if (path.startsWith('/api/')) return path;
  if (!NORMALIZED_API_BASE) return path;
  if (path.startsWith(NORMALIZED_API_BASE)) return path;
  return `${NORMALIZED_API_BASE}${path}`;
}

// 阶段0/3:GET 请求在途去重。
// 相同的并发 GET(例如 React StrictMode 在开发模式下重复执行 effect,
// 或多个组件同时拉取 reward-plan)会复用同一个网络请求,
// 从根上消除“接口同时请求两次”的问题。
const inflightGets = new Map();
/** touchId -> { document, etag } */
const manifestCacheByTouch = new Map();

async function request(path, options = {}) {
  const method = options.method ?? 'GET';
  let parsedBody;
  if (typeof options.body === 'string') {
    try {
      parsedBody = JSON.parse(options.body);
    } catch {
      parsedBody = options.body;
    }
  } else {
    parsedBody = options.body;
  }
  dbg('[FCDBG][API] request', { method, path, body: parsedBody });

  const doFetch = async () => {
    const res = await fetch(buildApiUrl(path), {
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      ...options,
    });
    const json = await res.json().catch(() => ({}));
    dbg('[FCDBG][API] response', {
      method,
      path,
      status: res.status,
      ok: res.ok,
      data: json,
    });
    if (!res.ok) {
      throw new Error(json.error ?? `Request failed: ${res.status}`);
    }
    return json;
  };

  // 只对 GET 去重:POST 是带副作用的变更,不合并。
  if (method === 'GET') {
    const key = `GET ${buildApiUrl(path)}`;
    const existing = inflightGets.get(key);
    if (existing) {
      dbg('[FCDBG][API] reuse in-flight GET', { path });
      return existing;
    }
    const promise = doFetch().finally(() => {
      inflightGets.delete(key);
    });
    inflightGets.set(key, promise);
    return promise;
  }

  return doFetch();
}

export function fetchRewardPlan(touchId, { refresh = false, skipTapReward = false } = {}) {
  const refreshQs = refresh ? '&refresh=1' : '';
  const skipTapQs = skipTapReward ? '&skipTapReward=1' : '';
  return request(`/api/fc/reward-plan?touchId=${encodeURIComponent(touchId)}${refreshQs}${skipTapQs}`);
}

export function fetchShopifyStatus(touchId, { refresh = false } = {}) {
  const refreshQs = refresh ? '&refresh=1' : '';
  return request(`/api/fc/shopify-status?touchId=${encodeURIComponent(touchId)}${refreshQs}`);
}

export function fetchMagnetBrandParam(touchId, { refresh = false } = {}) {
  const refreshQs = refresh ? '&refresh=1' : '';
  return request(`/api/fc/magnet-brand-param?touchId=${encodeURIComponent(touchId)}${refreshQs}`);
}

export function startGameSession(rewardPlanId, gameInstanceId) {
  return request('/api/fc/session/start', {
    method: 'POST',
    body: JSON.stringify({ rewardPlanId, gameInstanceId }),
  });
}

export function completeGameSession(payload) {
  const touchId = resolveTouchIdForRequest();
  return request('/api/fc/session/complete', {
    method: 'POST',
    body: JSON.stringify(touchId ? { ...payload, touchId } : payload),
  });
}

// 领取优惠券:调用 redeem 发券(方案 A — Claim 不关 cycle)
export function claimCoupon(touchId, rewardPlanId, couponId) {
  return request('/api/fc/coupons/redeem', {
    method: 'POST',
    body: JSON.stringify({
      touchId,
      rewardPlanId,
      couponId,
      campaignId: couponId,
    }),
  });
}

export function observeCoupon(touchId) {
  return request('/api/fc/coupons/observe', {
    method: 'POST',
    body: JSON.stringify({ touchId }),
  });
}

export function renewCycle(touchId, reason = 'expired') {
  return request('/api/fc/cycle/renew', {
    method: 'POST',
    body: JSON.stringify({ touchId, reason }),
  });
}

export function completeSurvey(touchId, rewardPlanId, answers) {
  return request('/api/fc/survey/complete', {
    method: 'POST',
    body: JSON.stringify({ touchId, rewardPlanId, answers }),
  });
}

export function fetchSurveyQuestions(touchId) {
  return request(`/api/fc/survey/questions?touchId=${encodeURIComponent(touchId)}`);
}

export function submitSurveyAnswers(touchId, payload) {
  return request('/api/fc/survey/answers', {
    method: 'POST',
    body: JSON.stringify({ touchId, ...payload }),
  });
}

export function redeemCoupon(payload) {
  return request('/api/fc/coupons/redeem', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchGameManifest(touchId) {
  const path = `/api/fc/games/manifest?touchId=${encodeURIComponent(touchId)}`;
  const url = buildApiUrl(path);
  const key = `GET ${url}#manifest`;
  const existing = inflightGets.get(key);
  if (existing) return existing;

  const cached = manifestCacheByTouch.get(touchId);

  const promise = (async () => {
    const res = await fetch(url, {
      headers: {
        'content-type': 'application/json',
        ...(cached?.etag ? { 'if-none-match': cached.etag } : {}),
      },
    });
    if (res.status === 304 && cached?.document) {
      dbg('[FCDBG][API] manifest not modified', { touchId });
      return cached.document;
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error ?? `Request failed: ${res.status}`);
    }
    const etag = res.headers.get('etag') ?? cached?.etag ?? '';
    manifestCacheByTouch.set(touchId, { document: json, etag });
    return json;
  })().finally(() => {
    inflightGets.delete(key);
  });

  inflightGets.set(key, promise);
  return promise;
}
