const REWARD_PLAN_CACHE_PREFIX = 'fc.rewardPlan.';
const TOUCH_ID_COOKIE = 'fc_touch_id';
const REWARD_PLAN_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const REWARD_PLAN_CACHE_VERSION = 2;

function canUseBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readCookie(name) {
  if (typeof document === 'undefined') return '';
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? '';
}

export function writeCookie(name, value, maxAgeSeconds = 30 * 24 * 60 * 60) {
  if (typeof document === 'undefined') return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

export function rememberTouchId(touchId) {
  if (touchId) writeCookie(TOUCH_ID_COOKIE, touchId);
}

export function readRememberedTouchId() {
  const value = readCookie(TOUCH_ID_COOKIE);
  return value ? decodeURIComponent(value) : '';
}

export function readCachedRewardPlan(touchId) {
  if (!canUseBrowserStorage() || !touchId) return null;
  try {
    const raw = window.localStorage.getItem(`${REWARD_PLAN_CACHE_PREFIX}${touchId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached?.version !== REWARD_PLAN_CACHE_VERSION) return null;
    if (!cached?.plan || Date.now() - cached.cachedAt > REWARD_PLAN_MAX_STALE_MS) return null;
    return cached.plan;
  } catch {
    return null;
  }
}

export function writeCachedRewardPlan(touchId, plan) {
  if (!canUseBrowserStorage() || !touchId || !plan) return;
  try {
    window.localStorage.setItem(
      `${REWARD_PLAN_CACHE_PREFIX}${touchId}`,
      JSON.stringify({ version: REWARD_PLAN_CACHE_VERSION, cachedAt: Date.now(), plan }),
    );
  } catch {
    // Cache is an optimization only.
  }
}
