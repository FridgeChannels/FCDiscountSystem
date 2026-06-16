import { iconForTemplate, labelForTemplate } from './gameLabels.js';
import { mergeBrand } from '../lib/brandTheme.js';

const GAME_PROGRESS_TIERS = [
  { difficultyLevel: 1, rewardPotentialLevel: 1 },
  { difficultyLevel: 2, rewardPotentialLevel: 2 },
  { difficultyLevel: 3, rewardPotentialLevel: 3 },
];

function gameProgressForTask(task, gameIndex) {
  const fallback = GAME_PROGRESS_TIERS[Math.min(gameIndex, GAME_PROGRESS_TIERS.length - 1)];

  return {
    difficultyLevel: clampGameRating(task.difficultyLevel ?? task.difficultyRating ?? task.difficulty ?? fallback.difficultyLevel),
    rewardPotentialLevel: clampGameRating(task.rewardPotentialLevel ?? task.rewardPotential ?? task.rewardRating ?? fallback.rewardPotentialLevel),
  };
}

function clampGameRating(value) {
  const rating = Number.parseInt(value, 10);
  if (Number.isNaN(rating)) return 1;
  return Math.max(1, Math.min(3, rating));
}

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

/** 结算页（Reward Used / Round Complete）展示用的券信息 */
export function resolveSettlementCoupon({
  discounts = [],
  claimRecord = null,
  observedCoupon = null,
  fallbackCoupon = null,
}) {
  if (claimRecord?.code) {
    const byCode = discounts.find((d) => d.code === claimRecord.code);
    if (byCode) return byCode;

    if (claimRecord.num || claimRecord.value) {
      return {
        tier: claimRecord.tier,
        couponId: claimRecord.couponId,
        num: String(claimRecord.num ?? ''),
        value: claimRecord.value ?? '',
        code: claimRecord.code,
      };
    }

    if (claimRecord.tier != null) {
      const byTier = discounts.find((d) => d.tier === claimRecord.tier);
      if (byTier) return { ...byTier, code: claimRecord.code };
    }
  }

  if (observedCoupon?.couponCode) {
    const stepId = observedCoupon.couponId;
    const matched = discounts.find(
      (d) =>
        (stepId && (d.couponId === stepId || d.campaignId === stepId))
        || d.tier === observedCoupon.tier,
    );
    const rawDiscount = observedCoupon.discountValue ?? '';
    const num =
      String(rawDiscount).replace('%', '').replace('Free Ship', '0')
      || matched?.num
      || '';
    const value =
      matched?.value
      || (rawDiscount
        ? (String(rawDiscount).includes('OFF') ? String(rawDiscount) : `${rawDiscount}% OFF`)
        : '');
    return {
      ...(matched ?? {}),
      tier: observedCoupon.tier ?? matched?.tier,
      couponId: stepId ?? matched?.couponId,
      num: num || matched?.num,
      value: value || matched?.value,
      code: observedCoupon.couponCode,
    };
  }

  if (fallbackCoupon) return fallbackCoupon;
  return null;
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

function mapTaskToChallenge(task, gameIndex) {
  if (task.type === 'shopify_connect') {
    return {
      id: 'shopify_connect',
      type: 'shopify_connect',
      badge: 'Shopify',
      icon: '🛍️',
      title: 'Connect Shopify Account',
      desc: 'Log in once and earn a big points boost.',
      reward: `+${task.pointsOffered} PTS`,
      cta: 'Connect',
      pointsOffered: task.pointsOffered,
    };
  }

  if (task.type === 'survey') {
    return {
      id: `survey-${task.campaignId}`,
      type: 'survey',
      badge: 'Survey',
      icon: '📝',
      title: 'Preferences',
      desc: 'Share habits for rewards',
      reward: `+${task.pointsOffered} PTS`,
      cta: 'Start',
      campaignId: task.campaignId,
      questionCount: task.questionCount,
      pointsOffered: task.pointsOffered,
      pointsPerQuestion: task.pointsPerQuestion,
      allowSkip: task.allowSkip,
    };
  }

  const index = gameIndex + 1;
  const progress = gameProgressForTask(task, gameIndex);
  return {
    id: task.gameInstanceId,
    type: 'game',
    badge: `Game ${index}`,
    icon: iconForTemplate(task.templateKey),
    iconUrl: task.iconUrl,
    title: task.displayName || labelForTemplate(task.templateKey),
    desc: '',
    reward: '+pts',
    difficultyLevel: progress.difficultyLevel,
    rewardPotentialLevel: progress.rewardPotentialLevel,
    cta: 'Play Now',
    gameInstanceId: task.gameInstanceId,
    templateKey: task.templateKey,
  };
}

function challengesFromPlan(plan) {
  const tasks = plan.tasks ?? [];
  if (tasks.length > 0) {
    let gameIndex = 0;
    return tasks.map((task) => {
      if (task.type === 'game') {
        const challenge = mapTaskToChallenge(task, gameIndex);
        gameIndex += 1;
        return challenge;
      }
      return mapTaskToChallenge(task, gameIndex);
    });
  }

  // 兼容旧 plan(无 tasks):游戏 + 问卷
  const gameChallenges = (plan.recommendedGames ?? []).map((game, index) =>
    mapTaskToChallenge({ type: 'game', ...game }, index),
  );
  return gameChallenges;
}

export function mapPlanToViewModel(plan, claimRecord = null, magnetBrandParam = null) {
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

  const challenges = challengesFromPlan(plan);

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
    brand: mergeBrand(plan.customerBrand, magnetBrandParam),
    challenges,
    rewardPlanId: plan.rewardPlanId,
    dailyCapReached: plan.reasonCodes?.includes('DAILY_CAP_REACHED') ?? false,
    hasInitialDiscount: deriveHasInitialDiscount(ladder),
    cycleExpired,
    tapReward: plan.tapReward ?? null,
    shopifyReward: plan.shopifyReward ?? null,
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
