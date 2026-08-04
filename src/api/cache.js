import { dedupeWalletCoupons } from './walletCoupons.js';

const REWARD_PLAN_CACHE_PREFIX = 'fc.rewardPlan.';
const TOUCH_ID_COOKIE = 'fc_touch_id';
const REWARD_PLAN_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const REWARD_PLAN_CACHE_VERSION = 3;
const CLAIM_RECORD_VERSION = 1;
const PROFILE_CACHE_PREFIX = 'fc.profile.';
const PROFILE_CACHE_VERSION = 1;
const COUPON_WALLET_PREFIX = 'fc.wallet.';
const COUPON_WALLET_VERSION = 1;

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
    if (!Array.isArray(cached.plan.tasks)) return null;
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

/** 结算后立刻把本地 plan 缓存里的积分对齐到权威余额,避免刷新读到旧积分。 */
export function patchCachedRewardPlanPoints(touchId, pointsBalance) {
  if (!canUseBrowserStorage() || !touchId) return;
  const nextBalance = Math.max(0, Math.round(Number(pointsBalance) || 0));
  if (!Number.isFinite(nextBalance)) return;
  const plan = readCachedRewardPlan(touchId);
  if (!plan) return;
  writeCachedRewardPlan(touchId, { ...plan, pointsBalance: nextBalance });
}

export function clearCachedRewardPlan(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(`${REWARD_PLAN_CACHE_PREFIX}${touchId}`);
}

function welcomeKey(touchId) {
  return `fc.welcome_completed.${touchId}`;
}

function welcomeCycleKey(touchId) {
  return `fc.welcome_cycle.${touchId}`;
}

function claimedKey(touchId) {
  return `fc.claimed_code.${touchId}`;
}

function couponWalletKey(touchId) {
  return `${COUPON_WALLET_PREFIX}${touchId}`;
}

/**
 * 「我的券包」：用户跨轮次持有的全部券。每张券形如
 * { packId, code, num, value, conditions, expiresAt, status, source, couponId, cycleId, addedAt }。
 * status: 'active' | 'used' | 'expired'；source: 'start' | 'target'。
 */
function normalizeWalletCoupon(raw) {
  if (!raw || typeof raw !== 'object' || !raw.code) return null;
  return {
    packId: raw.packId ? String(raw.packId) : undefined,
    paletteTier: Number.isInteger(raw.paletteTier) ? Math.max(0, Math.min(5, raw.paletteTier)) : undefined,
    code: String(raw.code),
    num: raw.num != null ? String(raw.num) : undefined,
    value: raw.value != null ? String(raw.value) : undefined,
    conditions: raw.conditions != null ? String(raw.conditions) : undefined,
    expiresAt: raw.expiresAt ? String(raw.expiresAt) : undefined,
    status: raw.status === 'used' || raw.status === 'expired' ? raw.status : 'active',
    source: raw.source === 'target' ? 'target' : 'start',
    couponId: raw.couponId ? String(raw.couponId) : undefined,
    cycleId: raw.cycleId ? String(raw.cycleId) : undefined,
    couponType: raw.couponType ? String(raw.couponType) : undefined,
    headline: raw.headline != null ? String(raw.headline) : undefined,
    displayMode: raw.displayMode != null ? String(raw.displayMode) : undefined,
    addedAt: raw.addedAt ? String(raw.addedAt) : new Date().toISOString(),
  };
}

/** One wallet row per issuance: unique code wins; pre-issue rows scoped by cycle + campaign. */
export function walletCouponKey(coupon) {
  if (coupon?.code) return `code:${coupon.code}`;
  if (coupon?.cycleId && coupon?.couponId) return `cycle:${coupon.cycleId}:id:${coupon.couponId}`;
  if (coupon?.couponId) return `id:${coupon.couponId}`;
  return null;
}

function mergeWalletCoupon(prev, incoming) {
  if (!incoming) return prev ?? null;
  if (!prev) return incoming;
  return {
    ...prev,
    ...incoming,
    status: prev.status,
    addedAt: prev.addedAt ?? incoming.addedAt,
  };
}

export function readCouponWallet(touchId) {
  if (!canUseBrowserStorage() || !touchId) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(couponWalletKey(touchId)) ?? 'null');
    if (parsed?.version !== COUPON_WALLET_VERSION || !Array.isArray(parsed.coupons)) return [];
    return dedupeWalletCoupons(parsed.coupons.map(normalizeWalletCoupon).filter(Boolean));
  } catch {
    return [];
  }
}

export function writeCouponWallet(touchId, coupons) {
  if (!canUseBrowserStorage() || !touchId || !Array.isArray(coupons)) return;
  try {
    window.localStorage.setItem(
      couponWalletKey(touchId),
      JSON.stringify({
        version: COUPON_WALLET_VERSION,
        coupons: coupons.map(normalizeWalletCoupon).filter(Boolean),
      }),
    );
  } catch {
    // Wallet persistence is best-effort.
  }
}

/** 合并一组券进券包，按 cycle+couponId / 券码去重。返回合并后的列表。 */
export function upsertCouponsToWallet(touchId, coupons) {
  const incoming = (Array.isArray(coupons) ? coupons : []).map(normalizeWalletCoupon).filter(Boolean);
  if (!incoming.length) return readCouponWallet(touchId);
  const merged = dedupeWalletCoupons([...readCouponWallet(touchId), ...incoming]);
  writeCouponWallet(touchId, merged);
  return merged;
}

/**
 * 用 plan 签发的券同步当前 cycle 的券包内容（与已有条目合并，不丢弃已签发但 plan 尚未带回 code 的券）。
 */
export function syncWalletForCycle(
  touchId,
  cycleId,
  entries,
  { pruneOtherCycles = true } = {},
) {
  if (!touchId || !cycleId) return readCouponWallet(touchId);
  const incoming = (Array.isArray(entries) ? entries : []).map(normalizeWalletCoupon).filter(Boolean);
  const existing = readCouponWallet(touchId);
  const prevForCycle = existing.filter((c) => c.cycleId === cycleId);
  const byKey = new Map();
  for (const coupon of prevForCycle) {
    const key = walletCouponKey(coupon);
    if (key) byKey.set(key, coupon);
  }
  for (const coupon of incoming) {
    const key = walletCouponKey(coupon);
    if (!key) continue;
    byKey.set(key, mergeWalletCoupon(byKey.get(key), coupon));
  }
  const current = dedupeWalletCoupons(Array.from(byKey.values()));
  const otherCycles = pruneOtherCycles
    ? []
    : existing.filter((c) => c.cycleId && c.cycleId !== cycleId);
  const wallet = [...otherCycles, ...current];
  writeCouponWallet(touchId, wallet);
  return wallet;
}

/** 更新券包中某张券的状态（如核销 → 'used'）。返回更新后的列表。 */
export function setWalletCouponStatus(touchId, code, status) {
  if (!code) return readCouponWallet(touchId);
  const next = readCouponWallet(touchId).map((c) =>
    c.code === code ? { ...c, status } : c,
  );
  writeCouponWallet(touchId, next);
  return next;
}

export function clearCouponWallet(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(couponWalletKey(touchId));
}

/** 每个 magnet 独立的 Welcome 完成标记 */
export function readWelcomeCompleted(touchId) {
  if (!canUseBrowserStorage() || !touchId) return false;
  return window.localStorage.getItem(welcomeKey(touchId)) === 'true';
}

/** Cycle id that the welcome flag was completed for (used after server/SQL reset). */
export function readWelcomeCycleId(touchId) {
  if (!canUseBrowserStorage() || !touchId) return '';
  return window.localStorage.getItem(welcomeCycleKey(touchId)) || '';
}

export function writeWelcomeCompleted(touchId, completed = true, cycleId) {
  if (!canUseBrowserStorage() || !touchId) return;
  if (completed) {
    window.localStorage.setItem(welcomeKey(touchId), 'true');
    if (cycleId) {
      window.localStorage.setItem(welcomeCycleKey(touchId), String(cycleId));
    }
  } else {
    window.localStorage.removeItem(welcomeKey(touchId));
    window.localStorage.removeItem(welcomeCycleKey(touchId));
  }
}

export function clearWelcomeCompleted(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(welcomeKey(touchId));
  window.localStorage.removeItem(welcomeCycleKey(touchId));
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
        num: parsed.num != null ? String(parsed.num) : undefined,
        value: parsed.value ? String(parsed.value) : undefined,
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
      num: record.num,
      value: record.value,
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

/**
 * Clear per-magnet client session so the next open matches a first-round welcome
 * (needed after server-side / SQL sample-reset which cannot touch localStorage).
 */
export function clearMagnetClientSession(touchId) {
  if (!touchId) return;
  clearWelcomeCompleted(touchId);
  clearClaimedCode(touchId);
  clearCachedRewardPlan(touchId);
  clearCouponWallet(touchId);
  clearCachedMagnetBrandParam(touchId);
  clearCachedShopifyStatus(touchId);
  if (canUseBrowserStorage()) {
    try {
      window.sessionStorage.removeItem(`fc_tap_fx_${touchId}`);
    } catch {
      // ignore
    }
  }
}

function profileKey(touchId) {
  return `${PROFILE_CACHE_PREFIX}${touchId}`;
}

export function readCachedProfile(touchId) {
  if (!canUseBrowserStorage() || !touchId) return null;
  try {
    const raw = window.localStorage.getItem(profileKey(touchId));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached?.version !== PROFILE_CACHE_VERSION || !cached.profile) return null;
    return {
      nickname: typeof cached.profile.nickname === 'string' ? cached.profile.nickname : '',
      displayCode: typeof cached.profile.displayCode === 'string' ? cached.profile.displayCode : '',
      avatarColor: typeof cached.profile.avatarColor === 'string' ? cached.profile.avatarColor : '',
      avatarImageUrl: typeof cached.profile.avatarImageUrl === 'string' ? cached.profile.avatarImageUrl : '',
    };
  } catch {
    return null;
  }
}

export function writeCachedProfile(touchId, profile) {
  if (!canUseBrowserStorage() || !touchId || !profile) return;
  try {
    window.localStorage.setItem(
      profileKey(touchId),
      JSON.stringify({
        version: PROFILE_CACHE_VERSION,
        updatedAt: Date.now(),
        profile,
      }),
    );
  } catch {
    // Profile cache is user convenience only.
  }
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

function magnetBrandParamKey(touchId) {
  return `${MAGNET_BRAND_PARAM_PREFIX}${touchId}`;
}

/** magnet_brand_param is always fetched live — no localStorage cache. */
export function readCachedMagnetBrandParam(_touchId) {
  return null;
}

/** @deprecated no-op; magnet brand is not cached client-side */
export function writeCachedMagnetBrandParam(_touchId, _param) {}

/** Remove legacy cached rows from older builds. */
export function clearCachedMagnetBrandParam(touchId) {
  if (!canUseBrowserStorage() || !touchId) return;
  window.localStorage.removeItem(magnetBrandParamKey(touchId));
}
