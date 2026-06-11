import { dbg } from '../lib/debug.js';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

// 阶段0/3:GET 请求在途去重。
// 相同的并发 GET(例如 React StrictMode 在开发模式下重复执行 effect,
// 或多个组件同时拉取 reward-plan)会复用同一个网络请求,
// 从根上消除“接口同时请求两次”的问题。
const inflightGets = new Map();

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
    const res = await fetch(`${API_BASE}${path}`, {
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
    const key = `GET ${API_BASE}${path}`;
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

export function fetchRewardPlan(touchId) {
  return request(`/api/fc/reward-plan?touchId=${encodeURIComponent(touchId)}`);
}

export function startGameSession(rewardPlanId, gameInstanceId) {
  return request('/api/fc/session/start', {
    method: 'POST',
    body: JSON.stringify({ rewardPlanId, gameInstanceId }),
  });
}

export function completeGameSession(payload) {
  return request('/api/fc/session/complete', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function completeSurvey(touchId, rewardPlanId, answers) {
  return request('/api/fc/survey/complete', {
    method: 'POST',
    body: JSON.stringify({ touchId, rewardPlanId, answers }),
  });
}
