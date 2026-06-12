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

function welcomeKey(touchId) {
  return `fc.welcome_completed.${touchId}`;
}

function claimedKey(touchId) {
  return `fc.claimed_code.${touchId}`;
}

/** 每个 magnet 独立的 Welcome 完成标记 */
export function readWelcomeCompleted(touchId) {
  if (!canUseBrowserStorage() || !touchId) return false;
  return window.localStorage.getItem(welcomeKey(touchId)) === 'true';
}

export function writeWelcomeCompleted(touchId, completed = true) {
  if (!canUseBrowserStorage() || !touchId) return;
  if (completed) {
    window.localStorage.setItem(welcomeKey(touchId), 'true');
  } else {
    window.localStorage.removeItem(welcomeKey(touchId));
  }
}

/** 每个 magnet 独立的已领取券码(强锁定态) */
export function readClaimedCode(touchId) {
  if (!canUseBrowserStorage() || !touchId) return null;
  const code = window.localStorage.getItem(claimedKey(touchId));
  if (code && code.includes('NaN')) {
    window.localStorage.removeItem(claimedKey(touchId));
    return null;
  }
  return code || null;
}

export function writeClaimedCode(touchId, code) {
  if (!canUseBrowserStorage() || !touchId || !code) return;
  window.localStorage.setItem(claimedKey(touchId), code);
}

export function clearClaimedCode(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(claimedKey(touchId));
}

export function clearWelcomeCompleted(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(welcomeKey(touchId));
}

/** 清除旧版全局 key(曾导致跨 magnet 串页) */
export function clearLegacyMagnetStorage() {
  if (!canUseBrowserStorage()) return;
  window.localStorage.removeItem('fc_welcome_completed');
  window.localStorage.removeItem('fc_claimed_code');
}
