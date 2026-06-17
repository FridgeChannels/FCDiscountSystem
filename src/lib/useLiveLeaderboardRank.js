import { useCallback, useEffect, useRef, useState } from 'react';
import { computeRankChange, FALLBACK_RANK, projectUserRank } from './leaderboard.js';

/**
 * Live rank feedback during a game session.
 * Snapshots leaderboard at session start, then projects rank as game coins are earned.
 */
export function useLiveLeaderboardRank(leaderboard, sessionKey) {
  const [sessionCoins, setSessionCoins] = useState(0);
  const [todayRank, setTodayRank] = useState(FALLBACK_RANK);
  const [rankChange, setRankChange] = useState(null);

  const playersRef = useRef([]);
  const baseCoinsRef = useRef(0);
  const prevRankRef = useRef(FALLBACK_RANK);
  const rankTimerRef = useRef(null);

  useEffect(() => () => {
    if (rankTimerRef.current) clearTimeout(rankTimerRef.current);
  }, []);

  useEffect(() => {
    if (!sessionKey) return;

    const players = leaderboard?.players ?? [];
    const baseTodayCoins = Math.max(0, Math.round(Number(leaderboard?.currentUserCoins) || 0));
    const startRank = projectUserRank(players, baseTodayCoins);

    playersRef.current = players;
    baseCoinsRef.current = baseTodayCoins;
    prevRankRef.current = startRank;
    setSessionCoins(0);
    setTodayRank(startRank);
    setRankChange(null);
  }, [sessionKey, leaderboard]);

  const noteGameCoinsAwarded = useCallback((amount) => {
    const delta = Math.max(0, Math.round(Number(amount) || 0));
    if (delta <= 0) return;

    setSessionCoins((prevSession) => {
      const nextSession = prevSession + delta;
      const projectedCoins = baseCoinsRef.current + nextSession;
      const nextRank = projectUserRank(playersRef.current, projectedCoins);
      const change = computeRankChange(prevRankRef.current, nextRank);

      if (change > 0) {
        setRankChange({ amount: change, id: Date.now() });
        if (rankTimerRef.current) clearTimeout(rankTimerRef.current);
        rankTimerRef.current = setTimeout(() => setRankChange(null), 2200);
      }

      prevRankRef.current = nextRank;
      setTodayRank(nextRank);
      return nextSession;
    });
  }, []);

  return {
    todayRank: todayRank ?? FALLBACK_RANK,
    rankChange,
    sessionCoins,
    noteGameCoinsAwarded,
  };
}
