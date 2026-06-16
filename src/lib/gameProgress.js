import { useCallback, useEffect, useRef, useState } from 'react';
import { getLeaderboard } from './leaderboard.js';

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

  // Rail 上展示的节点(current / next / future),每个带状态文案。
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
 * 管理:当前金币、金币 count-up 动画值、+N Coins 反馈、跨档升级弹层事件。
 *
 * @returns {{
 *   coins: number,                 // 真实金币(动画目标值)
 *   displayCoins: number,          // 用于展示的动画过程值(count-up)
 *   lastGain: { amount: number, id: number } | null,  // 最近一次获得金币(+N Coins 反馈)
 *   upgrade: { percent: number } | null,              // 升级弹层事件(跨档时触发)
 *   rail: object,                  // 基于真实金币派生的 Rail 视图
 *   displayRail: object,           // 基于动画值派生的 Rail 视图(路径推进用)
 *   awardCoins: (amount: number) => void,             // 发放金币(动画 + 升级检测 + 反馈)
 *   clearUpgrade: () => void,
 *   reset: () => void,
 * }}
 */
export function useGameProgress({
  ladder = MOCK_COUPON_LADDER,
  initialCoins = MOCK_INITIAL_COINS,
} = {}) {
  const [coins, setCoins] = useState(initialCoins);
  const [displayCoins, setDisplayCoins] = useState(initialCoins);
  const [lastGain, setLastGain] = useState(null);
  const [upgrade, setUpgrade] = useState(null);
  const [todayRank, setTodayRank] = useState(() => getLeaderboard('You', initialCoins).currentUserRank);
  const [rankChange, setRankChange] = useState(null);

  const coinsRef = useRef(initialCoins);
  const rafRef = useRef(null);
  const gainTimerRef = useRef(null);
  const rankTimerRef = useRef(null);

  // count-up:displayCoins 平滑追上 coins(数字动态增长,强化奖励感)
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
    // 仅在目标值变化时重新启动动画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins]);

  useEffect(() => () => {
    if (gainTimerRef.current) clearTimeout(gainTimerRef.current);
    if (rankTimerRef.current) clearTimeout(rankTimerRef.current);
  }, []);

  // 发放金币:更新金币、展示 +N、跨档则触发升级弹层。
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
      setUpgrade({ percent: afterRail.current.percent });
    }

    setLastGain({ amount: n, id: Date.now() });
    if (gainTimerRef.current) clearTimeout(gainTimerRef.current);
    gainTimerRef.current = setTimeout(() => setLastGain(null), 1800);

    const prevRank = getLeaderboard('You', before).currentUserRank;
    const nextRank = getLeaderboard('You', after).currentUserRank;
    const delta = prevRank - nextRank;
    if (delta > 0) {
      setTodayRank(nextRank);
      setRankChange({ amount: delta, id: Date.now() });
      if (rankTimerRef.current) clearTimeout(rankTimerRef.current);
      rankTimerRef.current = setTimeout(() => setRankChange(null), 2200);
    } else {
      setTodayRank(nextRank);
    }
  }, [ladder]);

  const clearUpgrade = useCallback(() => setUpgrade(null), []);

  // 重置到指定金币(进入新一局游戏时,用当前真实金币重新播种 Rail)。
  const resetTo = useCallback((value) => {
    const v = Math.max(0, Math.round(Number(value) || 0));
    coinsRef.current = v;
    setCoins(v);
    setDisplayCoins(v);
    setLastGain(null);
    setUpgrade(null);
    setRankChange(null);
    setTodayRank(getLeaderboard('You', v).currentUserRank);
  }, []);

  const reset = useCallback(() => resetTo(initialCoins), [initialCoins, resetTo]);

  return {
    coins,
    displayCoins,
    lastGain,
    upgrade,
    todayRank,
    rankChange,
    rail: deriveRail(coins, ladder),
    displayRail: deriveRail(displayCoins, ladder),
    awardCoins,
    clearUpgrade,
    reset,
    resetTo,
  };
}
