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
      // 新链路优先以 campaignId 对齐，避免 tier 变动导致券码贴错卡位。
      if (currentCoupon.campaignId && step.campaignId) {
        return currentCoupon.campaignId === step.campaignId
          ? currentCoupon.couponCode
          : '';
      }
      // 兼容回退:旧数据缺 campaignId 时继续按 tier 匹配。
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

  return {
    plan,
    touchId: null,
    points: plan.pointsBalance,
    discounts,
    currentStepIndex,
    countdownSeconds: secondsUntil(plan.cycleExpiresAt),
    brand: {
      name: plan.customerBrand?.name || null,
      logoUrl: plan.customerBrand?.logoUrl,
      primaryColor: plan.customerBrand?.primaryColor,
      shopUrl: plan.customerBrand?.shopUrl ?? '#',
    },
    challenges,
    rewardPlanId: plan.rewardPlanId,
    dailyCapReached: plan.reasonCodes?.includes('DAILY_CAP_REACHED') ?? false,
    // 领取/核销状态(后端字段优先,前端据此锁定/解锁最低折扣页)。
    couponClaimed: !!(plan.currentCoupon?.claimedAt || plan.currentCoupon?.status === 'CLAIMED'),
    couponRedeemed: !!(plan.currentCoupon?.redeemedAt || plan.currentCoupon?.status === 'REDEEMED'),
    claimedCouponCode: plan.currentCoupon?.couponCode || null,
  };
}

export function applySettlementToViewModel(viewModel, settlement, plan) {
  const next = mapPlanToViewModel(plan);
  return {
    ...next,
    settlement,
  };
}
