import { iconForTemplate, labelForTemplate } from './gameLabels.js';

function formatDiscountValue(step) {
  if (step.discountValue) return `${step.discountValue}%`;
  if (step.couponType === 'free_shipping') return 'Free Ship';
  return `${step.tier}`;
}

function formatDiscountLabel(step) {
  const value = formatDiscountValue(step);
  if (step.couponType === 'free_shipping') return 'FREE SHIPPING';
  return `${value} OFF`;
}

export function secondsUntil(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 1000));
}

/** ladder 第一档 pointsThreshold=0 且有有效折扣值 → 有初始折扣(需 Welcome 流) */
export function deriveHasInitialDiscount(ladder) {
  const sorted = [...(ladder ?? [])].sort((a, b) => a.tier - b.tier);
  const first = sorted[0];
  if (!first) return false;
  const value = first.discountValue;
  const hasValue = value != null && value !== '' && value !== '0';
  return first.pointsThreshold === 0 && hasValue;
}

export function mapPlanToViewModel(plan) {
  const ladder = [...plan.ladder].sort((a, b) => a.tier - b.tier);
  const currentCoupon = plan.currentCoupon;
  const discounts = ladder.map((step) => ({
    tier: step.tier,
    campaignId: step.campaignId,
    num: formatDiscountValue(step).replace('%', '').replace('Free Ship', '0'),
    value: formatDiscountLabel(step),
    target: step.pointsThreshold,
    code: (() => {
      if (!currentCoupon) return '';
      if (currentCoupon.campaignId && step.campaignId) {
        return currentCoupon.campaignId === step.campaignId
          ? currentCoupon.couponCode
          : '';
      }
      return currentCoupon.tier === step.tier ? currentCoupon.couponCode : '';
    })(),
  }));

  const currentStepIndex = Math.max(
    0,
    ladder.findIndex((step) => step.tier === plan.currentTier),
  );

  const gameChallenges = (plan.recommendedGames ?? []).map((game, index) => ({
    id: game.gameInstanceId,
    type: 'game',
    badge: `Game ${index + 1}`,
    icon: iconForTemplate(game.templateKey),
    title: game.displayName || labelForTemplate(game.templateKey),
    desc: 'Play to earn points toward your next coupon',
    reward: '+pts',
    cta: 'Play Now',
    gameInstanceId: game.gameInstanceId,
    templateKey: game.templateKey,
  }));

  const challenges = [
    ...gameChallenges,
    {
      id: 'survey',
      type: 'survey',
      badge: 'Survey',
      icon: '📝',
      title: 'Preferences',
      desc: 'Share habits for rewards',
      reward: '+10 PTS',
      cta: 'Start',
    },
  ];

  const countdownSeconds = secondsUntil(plan.cycleExpiresAt);
  const cycleExpired =
    plan.cycleStatus === 'expired' ||
    (plan.cycleStatus !== 'redeemed' && countdownSeconds <= 0);

  return {
    plan,
    touchId: null,
    points: plan.pointsBalance,
    discounts,
    currentStepIndex,
    countdownSeconds,
    brand: {
      name: plan.customerBrand?.name || null,
      logoUrl: plan.customerBrand?.logoUrl,
      primaryColor: plan.customerBrand?.primaryColor,
      shopUrl: plan.customerBrand?.shopUrl ?? '#',
    },
    challenges,
    rewardPlanId: plan.rewardPlanId,
    dailyCapReached: plan.reasonCodes?.includes('DAILY_CAP_REACHED') ?? false,
    hasInitialDiscount: deriveHasInitialDiscount(ladder),
    cycleExpired,
    tapReward: plan.tapReward ?? null,
    recentlyRedeemedCoupon: plan.recentlyRedeemedCoupon ?? null,
    couponClaimed:
      currentCoupon?.status === 'claimed' ||
      currentCoupon?.status === 'won',
    couponRedeemed: currentCoupon?.status === 'redeemed',
    claimedCouponCode: currentCoupon?.couponCode || null,
  };
}

export function applySettlementToViewModel(viewModel, settlement, plan) {
  const next = mapPlanToViewModel(plan);
  return {
    ...next,
    settlement,
  };
}
