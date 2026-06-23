import { enrichCouponDisplay } from './couponDisplay.js';

/** Map engine GET /coupons/wallet rows into local wallet entries. */
export function mapApiWalletToLocal(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.code)
    .map((entry) => enrichCouponDisplay({
      packId: `${entry.source === 'target' ? 'target' : 'start'}-${entry.cycleId}`,
      code: String(entry.code),
      couponId: entry.couponId ? String(entry.couponId) : undefined,
      cycleId: entry.cycleId ? String(entry.cycleId) : undefined,
      status: entry.status === 'used' || entry.status === 'expired' ? entry.status : 'active',
      source: entry.source === 'target' ? 'target' : 'start',
      expiresAt: entry.expiresAt ? String(entry.expiresAt) : undefined,
      couponType: entry.couponType ? String(entry.couponType) : undefined,
      num: entry.num != null ? String(entry.num) : undefined,
      value: entry.value != null ? String(entry.value) : undefined,
      headline: entry.headline != null ? String(entry.headline) : undefined,
      conditions: entry.conditions != null ? String(entry.conditions) : undefined,
      restrictions: entry.restrictions ?? undefined,
      addedAt: entry.issuedAt ? String(entry.issuedAt) : new Date().toISOString(),
    }));
}
