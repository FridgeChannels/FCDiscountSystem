import { enrichCouponDisplay } from '../api/couponDisplay.js';

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
      couponType: 'percentage',
      mockCode: 'WELCOME15',
    },
  ],
};

export const MOCK_TARGET_PACK = {
  id: 'mock-target-pack',
  type: 'target',
  title: 'Your target gift',
  subtitle: 'Your bonus coupons, ready to use.',
  threshold: 0,
  coupons: [
    {
      couponId: 'mock-target-20',
      num: '20',
      value: '20% OFF',
      conditions: DEFAULT_CONDITIONS,
      couponType: 'percentage',
      mockCode: 'TARGET20',
    },
    {
      couponId: 'mock-target-10',
      value: '$10 OFF',
      conditions: 'Orders over $80',
      couponType: 'fixed_amount',
      mockCode: 'SAVE10',
    },
    {
      couponId: 'mock-start-ship',
      value: 'FREE SHIPPING',
      conditions: 'All countries · Shipping up to $20.00',
      couponType: 'free_shipping',
      mockCode: 'SHIPFREE',
    },
    {
      couponId: 'mock-target-bogo',
      value: 'BUY 1 GET 1',
      conditions: 'Buy 1, get 1 free',
      couponType: 'buy_x_get_y',
      mockCode: 'BOGO1',
    },
  ],
};

export const MOCK_DEV_ACTIVE_COUPONS = [
  {
    code: 'DEV30',
    num: '30',
    value: '30% OFF',
    conditions: DEFAULT_CONDITIONS,
    couponType: 'percentage',
    status: 'active',
    source: 'target',
    couponId: 'mock-dev-active-30',
  },
  {
    code: 'DEVFREE',
    value: 'FREE SHIPPING',
    conditions: 'All countries · Shipping up to $20.00',
    couponType: 'free_shipping',
    status: 'active',
    source: 'target',
    couponId: 'mock-dev-active-ship',
  },
];

export const MOCK_USED_COUPONS = [
  {
    code: 'DEVUSED10',
    num: '10',
    value: '$10 OFF',
    conditions: 'Orders over $80',
    couponType: 'fixed_amount',
    status: 'used',
    source: 'start',
    couponId: 'mock-dev-used-10',
  },
  {
    code: 'DEVUSED15',
    num: '15',
    value: '15% OFF',
    conditions: DEFAULT_CONDITIONS,
    couponType: 'percentage',
    status: 'used',
    source: 'start',
    couponId: 'mock-dev-used-15',
  },
];

export const MOCK_EXPIRED_COUPONS = [
  {
    code: 'DEVEXP20',
    num: '20',
    value: '20% OFF',
    conditions: DEFAULT_CONDITIONS,
    couponType: 'percentage',
    status: 'expired',
    source: 'target',
    couponId: 'mock-dev-expired-20',
  },
];

export function mockPackWalletEntries(pack, expiresAt) {
  return (pack?.coupons ?? []).map((coupon) => enrichCouponDisplay({
    packId: pack.id,
    code: coupon.mockCode,
    num: coupon.num,
    value: coupon.value,
    conditions: coupon.conditions,
    couponType: coupon.couponType,
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
