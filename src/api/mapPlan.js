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

function stepCouponId(step) {
  return step.couponId ?? step.campaignId;
}

function observedCouponId(observed) {
  return observed?.couponId ?? observed?.campaignId;
}

/** 已发券观测记录与 ladder 档位对齐（couponId 优先，tier 兜底） */
function observedMatchesStep(observed, step) {
  if (!observed) return false;
  const obsId = observedCouponId(observed);
  const stepId = stepCouponId(step);
  if (obsId && stepId) return obsId === stepId;
  return observed.tier === step.tier;
}

export function secondsUntil(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 1000));
}

/** ladder 第一档 pointsThreshold=0 且有有效折扣值 → 有初始折扣(需 Welcome 流) */
/** 将本地/服务端已领券记录合并进 discounts，供 UI 展示券码与 Lock In 状态 */
export function applyClaimToDiscounts(discounts, claim) {
  if (!claim?.code || !discounts?.length) return discounts ?? [];
  return discounts.map((step) => {
    const stepId = step.couponId ?? step.campaignId;
    const idMatch = claim.couponId && stepId && claim.couponId === stepId;
    const tierMatch = claim.tier != null && step.tier === claim.tier;
    if (idMatch || tierMatch) return { ...step, code: claim.code };
    return step;
  });
}

export function couponWithCode(coupon, code) {
  return code ? { ...coupon, code } : coupon;
}

/** 下一档积分门槛（与 fc-platform engineClient.nextTierThreshold 一致） */
export function nextTierThreshold(ladder, currentTier) {
  const next = (ladder ?? []).find((step) => step.tier === currentTier + 1);
  return next ? next.pointsThreshold : null;
}

/** 由 mapPlan discounts 推导下一档门槛 */
export function nextTierThresholdFromDiscounts(discounts, currentTier) {
  const next = (discounts ?? []).find((step) => step.tier === currentTier + 1);
  return next?.target ?? null;
}

export function deriveHasInitialDiscount(ladder) {
  const sorted = [...(ladder ?? [])].sort((a, b) => a.tier - b.tier);
  const first = sorted[0];
  if (!first) return false;
  const value = first.discountValue;
  const hasValue = value != null && value !== '' && value !== '0';
  return first.pointsThreshold === 0 && hasValue;
}

export function mapPlanToViewModel(plan, claimRecord = null) {
  const ladder = [...(plan.ladder ?? [])].sort((a, b) => a.tier - b.tier);
  const observed = plan.observedCoupon ?? plan.currentCoupon;

  const claimForCycle =
    claimRecord &&
    (!claimRecord.cycleId || !plan.cycleId || claimRecord.cycleId === plan.cycleId)
      ? claimRecord
      : null;

  const baseDiscounts = ladder.map((step) => ({
    tier: step.tier,
    campaignId: stepCouponId(step),
    couponId: stepCouponId(step),
    num: formatDiscountValue(step).replace('%', '').replace('Free Ship', '0'),
    value: formatDiscountLabel(step),
    target: step.pointsThreshold,
    code: observedMatchesStep(observed, step) ? observed.couponCode : '',
  }));

  const discounts = applyClaimToDiscounts(baseDiscounts, claimForCycle);

  const tierIndex = ladder.findIndex((step) => step.tier === plan.currentTier);
  const currentStepIndex =
    plan.currentTier === 0 || tierIndex < 0 ? 0 : tierIndex;

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

  const observedStatus = observed?.status;

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
  // assigned/claimed = 已发券；won 仅表示档位达成，不算已领取页
    couponClaimed:
      observedStatus === 'claimed' || observedStatus === 'assigned',
    couponRedeemed: observedStatus === 'redeemed',
    claimedCouponCode: observed?.couponCode || null,
    awaitingNewChallenge: plan.reasonCodes?.includes('AWAITING_NEW_CHALLENGE') ?? false,
    observedCouponStatus: observed?.status ?? null,
  };
}

export function applySettlementToViewModel(viewModel, settlement, plan) {
  const next = mapPlanToViewModel(plan);
  return {
    ...next,
    settlement,
  };
}
