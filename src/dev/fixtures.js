/** Dev-only RewardPlan fixtures. Shape matches engine RewardPlan for mapPlanToViewModel(). */

const BRAND = {
  name: 'Ritual',
  logoUrl: 'http://localhost:8789/brand-assets/ritual-logo.svg',
  primaryColor: '#4f8a4a',
  shopUrl: 'https://ritual.com',
};

const GAMES = [
  {
    gameInstanceId: 'dev_memory_match',
    templateKey: 'memory_match',
    displayName: 'Card Match',
    score: 0.9,
    reasonCodes: [],
  },
  {
    gameInstanceId: 'dev_bridge_cross',
    templateKey: 'bridge_cross',
    displayName: 'Bridge Cross',
    score: 0.85,
    reasonCodes: [],
  },
];

const LADDER = [
  {
    tier: 1,
    couponId: 'camp_t1',
    campaignId: 'camp_t1',
    pointsThreshold: 0,
    discountValue: '15',
  },
  {
    tier: 2,
    couponId: 'camp_t2',
    campaignId: 'camp_t2',
    pointsThreshold: 80,
    discountValue: '20',
  },
  {
    tier: 3,
    couponId: 'camp_t3',
    campaignId: 'camp_t3',
    pointsThreshold: 120,
    discountValue: '30',
  },
];

function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function observedCoupon({ couponCode, couponId, tier, discountValue, status, claimedAt }) {
  return {
    couponCode,
    couponId,
    tier,
    discountValue,
    status,
    claimedAt,
  };
}

function basePlan(overrides = {}) {
  const cycleId = overrides.cycleId ?? 'cycle_dev';
  return {
    rewardPlanId: cycleId,
    policyVersion: 'dev-1',
    magnetId: 5001,
    customerId: 1001,
    cycleId,
    cycleDurationDays: 7,
    cycleExpiresAt: isoAfter(3 * 24 * 3600 * 1000),
    currentTier: 1,
    currentCouponId: 'camp_t1',
    targetCouponId: 'camp_t3',
    pointsBalance: 45,
    ladder: LADDER,
    recommendedGames: GAMES,
    customerBrand: BRAND,
    cycleStatus: 'active',
    reasonCodes: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export const DEV_FIXTURES = {
  intro: () => basePlan({ pointsBalance: 0, currentTier: 1 }),

  welcome: () =>
    basePlan({
      pointsBalance: 5,
      currentTier: 1,
      tapReward: { awarded: 5, available: true, reasonCodes: ['TAP_REWARD_GRANTED'] },
    }),

  returnVisit: () =>
    basePlan({
      pointsBalance: 15,
      currentTier: 1,
      tapReward: { awarded: 5, available: true, reasonCodes: ['TAP_REWARD_GRANTED'] },
    }),

  home: () => basePlan({ pointsBalance: 45, currentTier: 1 }),

  urgent: () =>
    basePlan({
      pointsBalance: 62,
      currentTier: 1,
      cycleExpiresAt: isoAfter(12 * 3600 * 1000),
    }),

  best: () =>
    basePlan({
      pointsBalance: 125,
      currentTier: 3,
      currentCouponId: 'camp_t3',
      targetCouponId: 'camp_t3',
    }),

  claimed: () =>
    basePlan({
      pointsBalance: 125,
      currentTier: 3,
      currentCouponId: 'camp_t3',
      observedCoupon: observedCoupon({
        couponCode: 'FC30RITUAL',
        couponId: 'camp_t3',
        tier: 3,
        discountValue: '30',
        status: 'assigned',
        claimedAt: new Date().toISOString(),
      }),
    }),

  receipt: () =>
    basePlan({
      pointsBalance: 82,
      currentTier: 1,
    }),

  zoom: () =>
    basePlan({
      pointsBalance: 40,
      currentTier: 2,
      currentCouponId: 'camp_t2',
      observedCoupon: observedCoupon({
        couponCode: 'FC20RITUAL',
        couponId: 'camp_t2',
        tier: 2,
        discountValue: '20',
        status: 'assigned',
        claimedAt: new Date().toISOString(),
      }),
    }),

  survey: () => basePlan({ pointsBalance: 30, currentTier: 1 }),

  claim: () => basePlan({ pointsBalance: 125, currentTier: 3, currentCouponId: 'camp_t3' }),

  redeemed: () =>
    basePlan({
      pointsBalance: 0,
      currentTier: 1,
      cycleStatus: 'redeemed',
      recentlyRedeemedCoupon: {
        couponCode: 'FC30RITUAL',
        redeemedAt: new Date().toISOString(),
      },
    }),

  expired: () =>
    basePlan({
      pointsBalance: 55,
      currentTier: 1,
      cycleStatus: 'expired',
      cycleExpiresAt: isoAfter(-3600 * 1000),
    }),

  notify: () => basePlan({ pointsBalance: 50, currentTier: 1 }),

  game: () => basePlan({ pointsBalance: 35, currentTier: 1 }),
};
