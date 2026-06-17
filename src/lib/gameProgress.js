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

/**
 * 纯函数:根据当前金币与阶梯,派生 Progress Rail 视图。
 * 返回 current / next / future 三档,以及到下一档/后续档的剩余金币、当前段进度百分比。
 */
export function deriveRail(coins, ladder = MOCK_COUPON_LADDER) {
  const safeCoins = Math.max(0, Number(coins) || 0);
  const sorted = [...(ladder ?? [])].sort((a, b) => a.threshold - b.threshold);
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

  let currentIndex = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (safeCoins >= sorted[i].threshold) currentIndex = i;
  }

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

  const nodes = [];
  if (current) nodes.push({ ...current, role: 'current', status: 'Current', left: 0 });
  if (next) {
    nodes.push({
      ...next,
      role: 'next',
      status: `${Math.max(0, next.threshold - safeCoins)} left`,
      left: Math.max(0, next.threshold - safeCoins),
    });
  }
  if (future) {
    nodes.push({
      ...future,
      role: 'future',
      status: `${Math.max(0, future.threshold - safeCoins)} left`,
      left: Math.max(0, future.threshold - safeCoins),
    });
  }

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

    const beforeIndex = deriveRail(before, ladder).currentIndex;
    const afterRail = deriveRail(after, ladder);
    if (afterRail.currentIndex > beforeIndex && afterRail.current) {
      setTierUnlock({ percent: afterRail.current.percent, id: Date.now() });
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
