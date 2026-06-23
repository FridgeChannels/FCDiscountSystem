/** Stable index in [0, length) from a string seed (rewardPlanId, touchId, etc.). */
export function stableIndex(length, seed = '0') {
  if (length <= 0) return 0;
  let hash = 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
}

/**
 * Split coupons into one initial reward and the rest as a gift pack.
 * When only one coupon exists, it is the initial reward and the pack is empty.
 */
export function splitCouponsIntoPacks(coupons, seed = '') {
  const list = (coupons ?? []).filter(Boolean);
  if (!list.length) {
    return { initial: null, targetCoupons: [] };
  }
  if (list.length === 1) {
    return { initial: list[0], targetCoupons: [] };
  }
  const index = stableIndex(list.length, seed || list[0]?.couponId || 'fc');
  return {
    initial: list[index],
    targetCoupons: list.filter((_, i) => i !== index),
  };
}
