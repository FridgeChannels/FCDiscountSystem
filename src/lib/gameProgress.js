import { useCallback, useEffect, useRef, useState } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Progress Rail 数据模型(第一版:mock 数据)
// 对应《游戏进度定义.md》:行动 → 奖励 → 进度 → 升级 反馈闭环。
// 真实接入时,把 MOCK_COUPON_LADDER / 初始金币换成后端 plan 的阶梯与积分即可,
// 其余派生逻辑与组件无需改动。
// ───────────────────────────────────────────────────────────────────────────

/** 优惠券阶梯(mock):每档的折扣百分比 + 解锁所需的累计金币门槛。 */
export const MOCK_COUPON_LADDER = [
  { percent: 10, threshold: 0 },
  { percent: 15, threshold: 200 },
  { percent: 20, threshold: 450 },
  { percent: 25, threshold: 750 },
];

/** 进入游戏时的初始金币(mock)。 */
export const MOCK_INITIAL_COINS = 30;

function normalizeLadder(ladder) {
  return [...(ladder ?? [])].sort((a, b) => a.threshold - b.threshold);
}

function resolveCurrentIndex(safeCoins, sorted) {
  let currentIndex = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (safeCoins >= sorted[i].threshold) currentIndex = i;
  }
  return currentIndex;
}

function resolveNodeRole(index, currentIndex) {
  if (currentIndex < 0) {
    return index === 0 ? 'next' : 'future';
  }
  if (index < currentIndex) return 'past';
  if (index === currentIndex) return 'current';
  if (index === currentIndex + 1) return 'next';
  return 'future';
}

function resolveNodeStatus(tier, safeCoins, role) {
  const left = Math.max(0, tier.threshold - safeCoins);
  if (role === 'current') return 'Current';
  if (role === 'past' || left === 0) return 'Unlocked';
  return `${left} left`;
}

function segmentFillBetween(sorted, safeCoins, fromIndex) {
  const end = sorted[fromIndex + 1];
  if (!end) return 0;

  const segStart = sorted[fromIndex].threshold;
  const segTotal = end.threshold - segStart;
  if (segTotal <= 0) {
    return safeCoins >= end.threshold ? 100 : 0;
  }
  if (safeCoins <= segStart) return 0;
  if (safeCoins >= end.threshold) return 100;
  return Math.min(100, ((safeCoins - segStart) / segTotal) * 100);
}

function segmentFillAfterNode(sorted, safeCoins, nodeIndex, currentIndex) {
  if (nodeIndex >= sorted.length - 1) return 0;

  if (currentIndex < 0) {
    if (nodeIndex !== 0) return 0;
    const target = sorted[0].threshold;
    if (target <= 0) return 100;
    return Math.min(100, (safeCoins / target) * 100);
  }

  if (nodeIndex < currentIndex) return 100;
  if (nodeIndex > currentIndex) return 0;
  return segmentFillBetween(sorted, safeCoins, nodeIndex);
}

/**
 * 单档券:没有「当前已解锁档」,唯一一档始终是冲刺目标(target/next)。
 * 与首页 singleTargetMode 语义一致(当前视为 0% OFF,单档券为目标)。
 */
function deriveSingleTierRail(safeCoins, tier) {
  const left = Math.max(0, tier.threshold - safeCoins);
  const reached = left <= 0;
  const segmentPct = tier.threshold > 0
    ? Math.min(100, (safeCoins / tier.threshold) * 100)
    : (reached ? 100 : 0);

  return {
    coins: safeCoins,
    currentIndex: reached ? 0 : -1,
    current: null,
    next: tier,
    future: null,
    leftToNext: left,
    leftToFuture: 0,
    segmentPct,
    isMaxTier: reached,
    nodes: [{
      ...tier,
      role: 'next',
      status: reached ? 'Unlocked' : `${left} left`,
      left,
      segmentFillPct: 0,
    }],
  };
}

/**
 * 纯函数:根据当前金币与阶梯,派生 Progress Rail 视图。
 * 展示 ladder 中的全部档位,并标注 current / next / future / past。
 */
export function deriveRail(coins, ladder = MOCK_COUPON_LADDER) {
  const safeCoins = Math.max(0, Number(coins) || 0);
  const sorted = normalizeLadder(ladder);
  if (!sorted.length) {
    return {
      coins: safeCoins,
      currentIndex: -1,
      current: null,
      next: null,
      future: null,
      leftToNext: 0,
      leftToFuture: 0,
      segmentPct: 0,
      isMaxTier: false,
      nodes: [],
    };
  }

  if (sorted.length === 1) {
    return deriveSingleTierRail(safeCoins, sorted[0]);
  }

  const currentIndex = resolveCurrentIndex(safeCoins, sorted);
  const current = currentIndex >= 0 ? sorted[currentIndex] ?? null : null;
  const next = currentIndex >= 0
    ? sorted[currentIndex + 1] ?? null
    : sorted[0] ?? null;
  const future = currentIndex >= 0
    ? sorted[currentIndex + 2] ?? null
    : sorted[1] ?? null;

  const segStart = current ? current.threshold : 0;
  const segTotal = next ? next.threshold - segStart : 0;
  const segDone = next ? Math.max(0, Math.min(segTotal, safeCoins - segStart)) : segTotal;
  const segmentPct = segTotal > 0 ? Math.min(100, (segDone / segTotal) * 100) : 100;

  const nodes = sorted.map((tier, index) => {
    const role = resolveNodeRole(index, currentIndex);
    const left = Math.max(0, tier.threshold - safeCoins);
    return {
      ...tier,
      role,
      status: resolveNodeStatus(tier, safeCoins, role),
      left,
      segmentFillPct: segmentFillAfterNode(sorted, safeCoins, index, currentIndex),
    };
  });

  return {
    coins: safeCoins,
    currentIndex,
    current,
    next,
    future,
    leftToNext: next ? Math.max(0, next.threshold - safeCoins) : 0,
    leftToFuture: future ? Math.max(0, future.threshold - safeCoins) : 0,
    segmentPct,
    isMaxTier: currentIndex >= sorted.length - 1 && !next,
    nodes,
  };
}

/**
 * Progress Rail 控制器 hook。
 * 管理:当前金币、金币 count-up 动画值、+N Coins 反馈、跨档解锁轨道动效。
 */
export function useGameProgress({
  ladder = MOCK_COUPON_LADDER,
  initialCoins = MOCK_INITIAL_COINS,
} = {}) {
  const [coins, setCoins] = useState(initialCoins);
  const [displayCoins, setDisplayCoins] = useState(initialCoins);
  const [lastGain, setLastGain] = useState(null);
  const [tierUnlock, setTierUnlock] = useState(null);

  const coinsRef = useRef(initialCoins);
  const rafRef = useRef(null);
  const gainTimerRef = useRef(null);
  const unlockTimerRef = useRef(null);

  useEffect(() => {
    if (displayCoins === coins) return undefined;
    const from = displayCoins;
    const to = coins;
    const start = performance.now();
    const duration = 700;
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayCoins(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplayCoins(to);
        rafRef.current = null;
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins]);

  useEffect(() => () => {
    if (gainTimerRef.current) clearTimeout(gainTimerRef.current);
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
  }, []);

  const awardCoins = useCallback((amount) => {
    const n = Math.round(Number(amount) || 0);
    if (n <= 0) return;

    const before = coinsRef.current;
    const after = before + n;
    coinsRef.current = after;
    setCoins(after);

    const beforeRail = deriveRail(before, ladder);
    const afterRail = deriveRail(after, ladder);
    const sorted = normalizeLadder(ladder);
    let unlockedPercent = null;

    if (sorted.length === 1) {
      const threshold = sorted[0].threshold;
      if (before < threshold && after >= threshold) {
        unlockedPercent = sorted[0].percent;
      }
    } else if (afterRail.currentIndex > beforeRail.currentIndex && afterRail.current) {
      unlockedPercent = afterRail.current.percent;
    }

    if (unlockedPercent != null) {
      setTierUnlock({ percent: unlockedPercent, id: Date.now() });
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = setTimeout(() => setTierUnlock(null), 2200);
    }

    setLastGain({ amount: n, id: Date.now() });
    if (gainTimerRef.current) clearTimeout(gainTimerRef.current);
    gainTimerRef.current = setTimeout(() => setLastGain(null), 1800);
  }, [ladder]);

  const resetTo = useCallback((value) => {
    const v = Math.max(0, Math.round(Number(value) || 0));
    coinsRef.current = v;
    setCoins(v);
    setDisplayCoins(v);
    setLastGain(null);
    setTierUnlock(null);
  }, []);

  const reset = useCallback(() => resetTo(initialCoins), [initialCoins, resetTo]);

  return {
    coins,
    displayCoins,
    lastGain,
    tierUnlock,
    rail: deriveRail(coins, ladder),
    displayRail: deriveRail(displayCoins, ladder),
    awardCoins,
    reset,
    resetTo,
  };
}
