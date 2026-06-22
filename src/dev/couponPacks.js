const DEFAULT_CONDITIONS = 'Sitewide · No minimum';

export const MOCK_CURRENT_PACK = {
  id: 'mock-start-pack',
  type: 'start',
  title: 'Your welcome gift',
  subtitle: 'A little something to get you started.',
  coupons: [
    {
      couponId: 'mock-start-15',
      num: '15',
      value: '15% OFF',
      conditions: DEFAULT_CONDITIONS,
      mockCode: 'WELCOME15',
    },
    {
      couponId: 'mock-start-ship',
      value: 'Free Shipping',
      conditions: 'Free standard shipping',
      mockCode: 'SHIPFREE',
    },
  ],
};

export const MOCK_TARGET_PACK = {
  id: 'mock-target-pack',
  type: 'target',
  title: 'Your target gift',
  subtitle: 'Complete challenges to unlock the whole pack.',
  threshold: 120,
  coupons: [
    {
      couponId: 'mock-target-20',
      num: '20',
      value: '20% OFF',
      conditions: DEFAULT_CONDITIONS,
      mockCode: 'TARGET20',
    },
    {
      couponId: 'mock-target-10',
      value: '$10 OFF',
      conditions: 'Orders over $80',
      mockCode: 'SAVE10',
    },
    {
      couponId: 'mock-target-ship',
      value: 'Free Shipping',
      conditions: 'Free express shipping',
      mockCode: 'EXPRESSFREE',
    },
  ],
};

export function mockPackWalletEntries(pack, expiresAt) {
  return (pack?.coupons ?? []).map((coupon) => ({
    packId: pack.id,
    paletteTier: coupon.paletteTier,
    code: coupon.mockCode,
    num: coupon.num,
    value: coupon.value,
    conditions: coupon.conditions,
    expiresAt,
    status: 'active',
    source: pack.type,
    couponId: coupon.couponId,
  }));
}

export function walletHasPack(wallet, packId) {
  if (!packId) return false;
  return (wallet ?? []).some((coupon) => coupon.packId === packId);
}
