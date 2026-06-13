const REWARD_PLAN_CACHE_PREFIX = 'fc.rewardPlan.';
const TOUCH_ID_COOKIE = 'fc_touch_id';
const REWARD_PLAN_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const REWARD_PLAN_CACHE_VERSION = 2;
const CLAIM_RECORD_VERSION = 1;

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

export function clearCachedRewardPlan(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(`${REWARD_PLAN_CACHE_PREFIX}${touchId}`);
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

function parseClaimRecord(raw) {
  if (!raw) return null;
  if (raw.includes('NaN')) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === CLAIM_RECORD_VERSION && parsed.code) {
      return {
        code: String(parsed.code),
        couponId: parsed.couponId ? String(parsed.couponId) : undefined,
        tier: parsed.tier != null ? Number(parsed.tier) : undefined,
        cycleId: parsed.cycleId ? String(parsed.cycleId) : undefined,
        claimedAt: parsed.claimedAt ? String(parsed.claimedAt) : undefined,
      };
    }
  } catch {
    // legacy plain string
  }
  return { code: raw };
}

/** 本周期已领券记录（含 cycleId，用于跨刷新恢复展示） */
export function readClaimRecord(touchId) {
  if (!canUseBrowserStorage() || !touchId) return null;
  return parseClaimRecord(window.localStorage.getItem(claimedKey(touchId)));
}

export function writeClaimRecord(touchId, record) {
  if (!canUseBrowserStorage() || !touchId || !record?.code) return;
  window.localStorage.setItem(
    claimedKey(touchId),
    JSON.stringify({
      version: CLAIM_RECORD_VERSION,
      code: record.code,
      couponId: record.couponId,
      tier: record.tier,
      cycleId: record.cycleId,
      claimedAt: record.claimedAt ?? new Date().toISOString(),
    }),
  );
}

/** @deprecated 使用 readClaimRecord */
export function readClaimedCode(touchId) {
  return readClaimRecord(touchId)?.code ?? null;
}

/** @deprecated 使用 writeClaimRecord */
export function writeClaimedCode(touchId, code) {
  writeClaimRecord(touchId, { code });
}

export function clearClaimedCode(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(claimedKey(touchId));
}

export function clearWelcomeCompleted(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(welcomeKey(touchId));
}

const SHOPIFY_STATUS_PREFIX = 'fc.shopifyStatus.';
const SHOPIFY_STATUS_CACHE_VERSION = 1;
const SHOPIFY_STATUS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function shopifyStatusKey(touchId) {
  return `${SHOPIFY_STATUS_PREFIX}${touchId}`;
}

/** 浏览器侧 Shopify 绑定状态缓存 */
export function readCachedShopifyStatus(touchId) {
  if (!canUseBrowserStorage() || !touchId) return null;
  try {
    const raw = window.localStorage.getItem(shopifyStatusKey(touchId));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached?.version !== SHOPIFY_STATUS_CACHE_VERSION) return null;
    if (Date.now() - cached.cachedAt > SHOPIFY_STATUS_MAX_AGE_MS) return null;
    if (typeof cached.connected !== 'boolean') return null;
    return {
      connected: cached.connected,
      shopifyCustomerId: cached.shopifyCustomerId ?? null,
      shopDomain: cached.shopDomain ?? null,
      shop: cached.shop ?? null,
      email: cached.email ?? null,
    };
  } catch {
    return null;
  }
}

export function writeCachedShopifyStatus(touchId, status) {
  if (!canUseBrowserStorage() || !touchId || !status || typeof status.connected !== 'boolean') return;
  try {
    window.localStorage.setItem(
      shopifyStatusKey(touchId),
      JSON.stringify({
        version: SHOPIFY_STATUS_CACHE_VERSION,
        cachedAt: Date.now(),
        connected: status.connected,
        shopifyCustomerId: status.shopifyCustomerId ?? null,
        shopDomain: status.shopDomain ?? null,
        shop: status.shop ?? null,
        email: status.email ?? null,
      }),
    );
  } catch {
    // Cache is an optimization only.
  }
}

export function clearCachedShopifyStatus(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(shopifyStatusKey(touchId));
}

function shopifyOAuthPendingKey(touchId) {
  return `fc.shopify_oauth_pending.${touchId}`;
}

function shopifyPendingSourceKey(touchId) {
  return `fc.shopify_pending_source.${touchId}`;
}

/** 跳转 Shopify 授权前标记,回流后触发刷新 plan + 登录积分动效 */
export function markShopifyOAuthPending(touchId, source = '') {
  if (!canUseBrowserStorage() || !touchId) return;
  sessionStorage.setItem(shopifyOAuthPendingKey(touchId), '1');
  if (source) sessionStorage.setItem(shopifyPendingSourceKey(touchId), source);
}

export function readShopifyOAuthPendingSource(touchId) {
  if (!canUseBrowserStorage() || !touchId) return '';
  return sessionStorage.getItem(shopifyPendingSourceKey(touchId)) ?? '';
}

export function consumeShopifyOAuthPending(touchId) {
  if (!canUseBrowserStorage() || !touchId) return false;
  const pending = sessionStorage.getItem(shopifyOAuthPendingKey(touchId)) === '1';
  sessionStorage.removeItem(shopifyOAuthPendingKey(touchId));
  return pending;
}

export function isShopifyOAuthPending(touchId) {
  if (!canUseBrowserStorage() || !touchId) return false;
  return sessionStorage.getItem(shopifyOAuthPendingKey(touchId)) === '1';
}

export function clearShopifyOAuthPending(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  sessionStorage.removeItem(shopifyOAuthPendingKey(touchId));
  sessionStorage.removeItem(shopifyPendingSourceKey(touchId));
}

/** 清除旧版全局 key(曾导致跨 magnet 串页) */
export function clearLegacyMagnetStorage() {
  if (!canUseBrowserStorage()) return;
  window.localStorage.removeItem('fc_welcome_completed');
  window.localStorage.removeItem('fc_claimed_code');
}

const MAGNET_BRAND_PARAM_PREFIX = 'fc.magnetBrandParam.';
const MAGNET_BRAND_PARAM_CACHE_VERSION = 1;
const MAGNET_BRAND_PARAM_MAX_STALE_MS = 24 * 60 * 60 * 1000;

function magnetBrandParamKey(touchId) {
  return `${MAGNET_BRAND_PARAM_PREFIX}${touchId}`;
}

/** 按 magnet SN 缓存的品牌参数(magnet_brand_param),优先于 customer 表 */
export function readCachedMagnetBrandParam(touchId) {
  if (!canUseBrowserStorage() || !touchId) return null;
  try {
    const raw = window.localStorage.getItem(magnetBrandParamKey(touchId));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached?.version !== MAGNET_BRAND_PARAM_CACHE_VERSION) return null;
    if (Date.now() - cached.cachedAt > MAGNET_BRAND_PARAM_MAX_STALE_MS) return null;
    return cached.param ?? null;
  } catch {
    return null;
  }
}

export function writeCachedMagnetBrandParam(touchId, param) {
  if (!canUseBrowserStorage() || !touchId || !param) return;
  try {
    window.localStorage.setItem(
      magnetBrandParamKey(touchId),
      JSON.stringify({
        version: MAGNET_BRAND_PARAM_CACHE_VERSION,
        cachedAt: Date.now(),
        param,
      }),
    );
  } catch {
    // Cache is an optimization only.
  }
}

export function clearCachedMagnetBrandParam(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(magnetBrandParamKey(touchId));
}
