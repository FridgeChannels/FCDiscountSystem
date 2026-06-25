import { enrichCouponDisplay } from './couponDisplay.js';

/** 同一 cycle + couponId 视为同一张券（优先于 code 去重，避免重复出码产生两条）。 */
export function walletIdentityKey(coupon) {
  if (coupon?.couponId && coupon?.cycleId) return `cycle:${coupon.cycleId}:id:${coupon.couponId}`;
  if (coupon?.couponId) return `id:${coupon.couponId}`;
  if (coupon?.code) return `code:${coupon.code}`;
  return null;
}

function preferWalletEntry(prev, incoming) {
  if (!incoming) return prev ?? null;
  if (!prev) return incoming;
  const merged = {
    ...prev,
    ...incoming,
    status: prev.status === 'used' || prev.status === 'expired'
      ? prev.status
      : (incoming.status ?? prev.status),
    addedAt: prev.addedAt ?? incoming.addedAt,
  };
  if (prev.code && incoming.code && prev.code !== incoming.code) {
    const prevTs = new Date(prev.addedAt ?? 0).getTime();
    const incomingTs = new Date(incoming.addedAt ?? 0).getTime();
    if (incomingTs >= prevTs) {
      merged.code = incoming.code;
      merged.addedAt = incoming.addedAt;
    } else {
      merged.code = prev.code;
      merged.addedAt = prev.addedAt;
    }
  } else {
    merged.code = prev.code || incoming.code;
  }
  return merged;
}

/** 按 couponId/cycle 合并重复券，保留最新 code。 */
export function dedupeWalletCoupons(coupons = []) {
  const byIdentity = new Map();
  for (const coupon of coupons) {
    if (!coupon) continue;
    const key = walletIdentityKey(coupon);
    if (!key) continue;
    byIdentity.set(key, preferWalletEntry(byIdentity.get(key), coupon));
  }
  return sortWalletCouponsByAcquiredAt([...byIdentity.values()]);
}

export function walletHasCouponForCycle(couponWallet, cycleId, couponId) {
  if (!couponId) return false;
  return (couponWallet ?? []).some(
    (coupon) => coupon.couponId === couponId
      && (!cycleId || !coupon.cycleId || coupon.cycleId === cycleId),
  );
}

/** 券是否已过 expiresAt（无 expiresAt 视为未过期）。 */
export function isWalletCouponExpired(coupon, nowMs = Date.now()) {
  if (!coupon?.expiresAt) return false;
  const ts = new Date(coupon.expiresAt).getTime();
  return Number.isFinite(ts) && ts <= nowMs;
}

/** 可用券：status=active 且未过期。 */
export function isWalletCouponUsable(coupon, nowMs = Date.now()) {
  return coupon?.status === 'active' && !isWalletCouponExpired(coupon, nowMs);
}

export function sortWalletCouponsByAcquiredAt(coupons = []) {
  return [...coupons].sort((a, b) => {
    const ta = new Date(a?.addedAt ?? 0).getTime();
    const tb = new Date(b?.addedAt ?? 0).getTime();
    if (tb !== ta) return tb - ta;
    return String(b?.code ?? '').localeCompare(String(a?.code ?? ''));
  });
}

/** 用 pack 元数据 enrich 券包条目（展示文案 / 类型 / 色档）。 */
export function enrichWalletCoupons(coupons = [], packCoupons = []) {
  const paletteByCouponId = new Map(
    packCoupons
      .filter((coupon) => coupon?.couponId)
      .map((coupon) => [coupon.couponId, enrichCouponDisplay(coupon)]),
  );
  return coupons.map((coupon) => {
    const packCoupon = paletteByCouponId.get(coupon.couponId);
    return enrichCouponDisplay({
      ...(packCoupon ?? {}),
      ...coupon,
      couponType: packCoupon?.couponType ?? coupon.couponType,
      conditions: packCoupon?.conditions ?? coupon.conditions,
      restrictions: packCoupon?.restrictions ?? coupon.restrictions,
      headline: packCoupon?.headline ?? coupon.headline,
      displayMode: packCoupon?.displayMode ?? coupon.displayMode,
    });
  });
}

/** Completed 页：全部活动中可用券（active + 未过期）。 */
export function selectCompletedAvailableCoupons(coupons = [], nowMs = Date.now()) {
  return sortWalletCouponsByAcquiredAt(
    coupons.filter((coupon) => isWalletCouponUsable(coupon, nowMs)),
  );
}

/** 我的卡包：历史全部券，按获得时间倒序。 */
export function selectWalletArchiveCoupons(coupons = []) {
  return sortWalletCouponsByAcquiredAt(coupons);
}

/** 券是否属于指定活动周期（cycleId 或 start/target packId）。 */
export function couponBelongsToCycle(coupon, cycleId) {
  if (!cycleId || !coupon?.code) return false;
  if (coupon.cycleId === cycleId) return true;
  const packId = String(coupon.packId ?? '');
  return packId === `start-${cycleId}` || packId === `target-${cycleId}`;
}

/**
 * Round Complete 页：本周期获得的全部有码券。
 * 周期刚结束时 wallet 里常为 active，不能按 expired/used 过滤否则会漏券并回退到单券。
 */
export function selectSettlementCouponsForCycle(coupons = [], cycleId, { reason = 'expired' } = {}) {
  if (!cycleId) return [];
  const settlementStatus = reason === 'redeemed' ? 'used' : 'expired';
  const cycleCoupons = dedupeWalletCoupons(
    (coupons ?? []).filter((coupon) => couponBelongsToCycle(coupon, cycleId)),
  );
  return sortWalletCouponsByAcquiredAt(
    cycleCoupons.map((coupon) => ({
      ...coupon,
      status: coupon.status === 'used' ? 'used' : settlementStatus,
    })),
  );
}

/**
 * 解锁页展示券：严格按 pack.coupons 顺序与 couponId 对齐，合并出码数据；
 * 默认剔除礼包外条目与无 code 占位券，避免解锁页出现重复/幽灵券。
 */
export function selectPackRevealCoupons(pack, sourceCoupons = [], { requireCode = true } = {}) {
  const packCoupons = pack?.coupons ?? [];
  if (!packCoupons.length) {
    const fallback = (sourceCoupons ?? []).filter(Boolean);
    return requireCode ? fallback.filter((coupon) => coupon?.code) : fallback;
  }

  const sourceById = new Map();
  for (const coupon of sourceCoupons ?? []) {
    if (!coupon) continue;
    const id = coupon.couponId ?? coupon.campaignId;
    if (!id) continue;
    const key = String(id);
    const prev = sourceById.get(key);
    if (!prev || !prev.code) {
      sourceById.set(key, coupon);
    }
  }

  const merged = packCoupons.map((packCoupon) => {
    const id = packCoupon.couponId ?? packCoupon.campaignId;
    const matched = id ? sourceById.get(String(id)) : null;
    return enrichCouponDisplay({
      ...packCoupon,
      ...(matched ?? {}),
      couponId: packCoupon.couponId ?? packCoupon.campaignId ?? matched?.couponId,
      campaignId: packCoupon.campaignId ?? packCoupon.couponId ?? matched?.campaignId,
      code: matched?.code || packCoupon.code || '',
    });
  });

  return requireCode ? merged.filter((coupon) => coupon?.code) : merged;
}
