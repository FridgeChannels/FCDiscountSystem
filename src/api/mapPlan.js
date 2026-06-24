import { iconForTemplate, labelForTemplate } from './gameLabels.js';
import { mergeBrand } from '../lib/brandTheme.js';
import { splitCouponsIntoPacks } from './splitRewardPacks.js';
import { enrichCouponDisplay } from './couponDisplay.js';

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
  if (step.couponType === 'free_shipping' || String(step.discountValue ?? '').toLowerCase().includes('free ship')) {
    return 'Free Ship';
  }
  if (step.discountValue) return `${step.discountValue}%`;
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

function normalizePackCoupon(raw, fallbackTarget = 0, fallbackTier = null) {
  if (!raw || typeof raw !== 'object') return null;
  const couponId = raw.couponId ?? raw.campaignId ?? null;
  const couponType = raw.couponType ?? raw.discountType ?? undefined;
  const rawNum = raw.num ?? raw.discountValue ?? raw.discountPercent ?? '';
  const normalizedNum =
    rawNum == null || rawNum === ''
      ? ''
      : String(rawNum).replace('%', '').replace('Free Ship', '0').replace(/^B\d+G\d+$/, '0');
  const base = {
    tier: raw.tier != null && Number.isFinite(Number(raw.tier)) ? Number(raw.tier) : fallbackTier ?? undefined,
    campaignId: couponId ?? undefined,
    couponId: couponId ?? undefined,
    num: normalizedNum,
    target: Number.isFinite(Number(raw.target ?? raw.pointsThreshold))
      ? Math.max(0, Number(raw.target ?? raw.pointsThreshold))
      : fallbackTarget,
    code: raw.code ?? raw.couponCode ?? raw.mockCode ?? '',
    expiresAt: raw.expiresAt ?? raw.expiryAt ?? undefined,
    couponType,
    currencyCode: raw.currencyCode ?? null,
    restrictions: raw.restrictions ?? undefined,
    issued: Boolean(raw.issued ?? raw.isIssued ?? raw.couponCode ?? raw.code),
    label: raw.label ?? raw.title ?? undefined,
    value: raw.value ?? raw.discountValue ?? undefined,
    conditions: raw.conditions ?? raw.terms ?? undefined,
  };
  return enrichCouponDisplay(base);
}

/** 初始礼包是否已在服务端签发（以 plan.initialReward 为准）。 */
export function isInitialPackIssued(plan, startPack) {
  const initial = plan?.initialReward;
  if (initial?.issued || initial?.couponCode) return true;
  const coupon = startPack?.coupons?.[0];
  return Boolean(coupon?.issued || coupon?.code);
}

/** 目标礼包是否已全部签发（以 plan.targetRewardPack 为准）。 */
export function isTargetPackIssued(plan, targetPack) {
  const target = plan?.targetRewardPack;
  if (target?.issued) return true;
  const apiCoupons = target?.coupons ?? [];
  if (apiCoupons.length > 0) {
    return apiCoupons.every((c) => c.issued || c.couponCode || c.code);
  }
  const packCoupons = targetPack?.coupons ?? [];
  if (!packCoupons.length) return false;
  return packCoupons.every((c) => c.issued || c.code);
}

/** 把 plan 里已签发的礼包券同步进本地券包（无独立 wallet API 时的权威来源）。 */
export function buildWalletEntriesFromPacks({
  rewardPlanId,
  cycleId,
  startPack,
  targetPack,
  expiresAt,
}) {
  const entries = [];
  const pushCoupon = (packType, coupon) => {
    const code = coupon?.code ?? coupon?.couponCode;
    if (!code) return;
    entries.push(enrichCouponDisplay({
      packId: `${packType}-${rewardPlanId ?? 'local'}`,
      code,
      num: coupon.num,
      value: coupon.value,
      headline: coupon.headline,
      conditions: coupon.conditions,
      couponType: coupon.couponType,
      displayMode: coupon.displayMode,
      restrictions: coupon.restrictions,
      currencyCode: coupon.currencyCode,
      expiresAt: coupon.expiresAt ?? expiresAt,
      status: 'active',
      source: packType === 'target' ? 'target' : 'start',
      couponId: coupon.couponId ?? coupon.campaignId,
      cycleId,
      addedAt: coupon.addedAt ?? new Date().toISOString(),
    }));
  };
  for (const coupon of startPack?.coupons ?? []) pushCoupon('start', coupon);
  for (const coupon of targetPack?.coupons ?? []) pushCoupon('target', coupon);
  return entries;
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

/** 折扣百分比（无法解析时为 0），用于过滤掉占位的 0% 券。 */
function couponPercent(coupon) {
  if (coupon?.couponType === 'free_shipping') return 1;
  const raw = coupon?.num ?? coupon?.value;
  const parsed = parseInt(String(raw ?? '').replace(/[^\d]/g, ''), 10);
  if (String(raw ?? '').toLowerCase().includes('free ship')) return 1;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 把已映射的 discounts 适配成礼包模型：
 *  - startPack：随机选一张作为初始券，直接展示券码，无需任务或点击解锁。
 *  - targetPack：其余券作为大礼包，领取时一次性展示全部券码（threshold=0，无需攒分）。
 */
/** 折扣值是否有效（含免邮、BOGO 等非百分比券）。 */
function isRewardCouponStep(step) {
  if (step?.couponType === 'free_shipping' || step?.couponType === 'buy_x_get_y' || step?.couponType === 'fixed_amount') {
    return true;
  }
  return couponPercent(step) > 0;
}

export function buildPacksFromDiscounts(discounts = [], seed = '') {
  const list = (discounts ?? []).filter((d) => isRewardCouponStep(d));
  const { initial, targetCoupons } = splitCouponsIntoPacks(list, seed);

  const startPack = initial ? { coupons: [{ ...initial, target: 0 }] } : null;
  const targetPack = targetCoupons.length
    ? {
        threshold: 0,
        coupons: targetCoupons.map((coupon) => ({ ...coupon, target: 0 })),
      }
    : null;

  return { startPack, targetPack };
}

/** 当前 magnet 是否只有一张可领券(无需做任务、不进首页)。 */
export function isSingleCouponReward(startPack, targetPack) {
  const startCount = startPack?.coupons?.length ?? 0;
  const targetCount = targetPack?.coupons?.length ?? 0;
  return startCount + targetCount === 1;
}

function buildExplicitPacksFromPlan(plan) {
  const initialReward = normalizePackCoupon(plan?.initialReward, 0, 1);
  const rawTargetCoupons = Array.isArray(plan?.targetRewardPack?.coupons)
    ? plan.targetRewardPack.coupons
    : [];
  const explicitThreshold = Number(plan?.targetRewardPack?.threshold);
  const normalizedTargetCoupons = rawTargetCoupons
    .map((coupon, index) =>
      normalizePackCoupon(
        coupon,
        Number.isFinite(explicitThreshold) ? explicitThreshold : 0,
        index + 2,
      ))
    .filter(Boolean);

  if (!initialReward && !normalizedTargetCoupons.length) return null;

  const targetThreshold = Number.isFinite(explicitThreshold) ? explicitThreshold : 0;

  return {
    startPack: initialReward ? { coupons: [initialReward] } : null,
    targetPack: normalizedTargetCoupons.length
      ? {
          threshold: targetThreshold,
          coupons: normalizedTargetCoupons.map((coupon) => ({ ...coupon, target: targetThreshold })),
        }
      : null,
  };
}

/** 优先使用引擎下发的 initialReward / targetRewardPack，否则从 discounts 推导。 */
export function resolveRewardPacks(plan, discounts = [], seed = '') {
  const explicit = buildExplicitPacksFromPlan(plan);
  if (explicit) return explicit;
  return buildPacksFromDiscounts(discounts, seed);
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

  const progress = gameProgressForTask(task, gameIndex);
  return {
    id: task.gameInstanceId,
    type: 'game',
    badge: 'Game',
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
  const packSeed = plan.rewardPlanId ?? plan.touchId ?? '';
  const { startPack, targetPack } = resolveRewardPacks(plan, discounts, packSeed);

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
    startPack,
    targetPack,
    currentStepIndex,
    countdownSeconds,
    brand: mergeBrand(plan.customerBrand, magnetBrandParam),
    challenges,
    rewardPlanId: plan.rewardPlanId,
    dailyCapReached: plan.reasonCodes?.includes('DAILY_CAP_REACHED') ?? false,
    hasInitialDiscount: Boolean(startPack?.coupons?.length) || deriveHasInitialDiscount(ladder),
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
    initialPackIssued: isInitialPackIssued(plan, startPack),
    targetPackIssued: isTargetPackIssued(plan, targetPack),
  };
}

export function applySettlementToViewModel(viewModel, settlement, plan) {
  const next = mapPlanToViewModel(plan);
  return {
    ...next,
    settlement,
  };
}
