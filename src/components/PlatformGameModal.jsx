import { useCallback, useEffect, useMemo, useRef } from 'react';
import GameHost from './GameHost.jsx';
import ProgressRail from './ProgressRail.jsx';
import CouponUnlockedModal from './CouponUnlockedModal.jsx';
import { useGameProgress, MOCK_INITIAL_COINS } from '../lib/gameProgress.js';

function parseProgressCoinEvent(event, expectedSessionId, prevTotalCoinsInSession = 0) {
  if (!event || typeof event !== 'object') return null;
  const gameEvent = event.type === 'fc.game.event' ? event.payload : event;
  if (!gameEvent || typeof gameEvent !== 'object') return null;
  if (gameEvent.type !== 'progress.coin_awarded') return null;
  const payload = gameEvent.payload;
  if (!payload || typeof payload !== 'object') return null;

  const sessionId = String(payload.sessionId || '');
  if (!sessionId || (expectedSessionId && sessionId !== expectedSessionId)) return null;

  const seqValue = Number(payload.seq);
  const seq = Number.isFinite(seqValue) && seqValue > 0 ? seqValue : null;
  const totalCoinsInSession = Math.max(0, Math.round(Number(payload.totalCoinsInSession) || 0));

  let deltaCoins = Math.max(0, Math.round(Number(payload.deltaCoins) || 0));
  if (deltaCoins <= 0 && totalCoinsInSession > prevTotalCoinsInSession) {
    deltaCoins = totalCoinsInSession - prevTotalCoinsInSession;
  }
  if (deltaCoins <= 0) return null;

  return { sessionId, seq, deltaCoins, totalCoinsInSession };
}

/** 游戏层铺满 mobile-viewport 卡片(非居中小弹窗)，沉浸式全屏仅保留关闭按钮 */
export default function PlatformGameModal({
  open,
  title,
  gameStart,
  brand,
  progressView,
  loadingMessage,
  onClose,
  onDone,
  onError,
  onRuntimeEvent,
}) {
  // Progress Rail 状态:用真实 points 播种,优先使用后端阶梯(无则回退 mock)。
  const initialCoins = Number(progressView?.currentPoints ?? MOCK_INITIAL_COINS);
  const ladder = useMemo(
    () => (Array.isArray(progressView?.ladder) && progressView.ladder.length ? progressView.ladder : undefined),
    [progressView?.ladder],
  );
  const {
    displayCoins,
    displayRail,
    lastGain,
    upgrade,
    todayRank,
    rankChange,
    awardCoins,
    clearUpgrade,
    resetTo,
  } = useGameProgress({ initialCoins, ladder });
  const seenEventSeqRef = useRef(0);
  const seenSessionTotalRef = useRef(0);
  const runtimeAwardedCoinsRef = useRef(0);
  const activeSessionRef = useRef('');
  const seedCoinsRef = useRef(initialCoins);

  // 进入新一局时用最新真实金币重新播种 Rail。
  useEffect(() => {
    if (!open) return;
    resetTo(initialCoins);
    seedCoinsRef.current = initialCoins;
    activeSessionRef.current = gameStart?.sessionId || '';
    seenEventSeqRef.current = 0;
    seenSessionTotalRef.current = 0;
    runtimeAwardedCoinsRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gameStart?.sessionId]);

  useEffect(() => {
    if (!open) return undefined;

    const html = document.documentElement;
    const body = document.body;
    const viewport = document.querySelector('.mobile-viewport');
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      viewportOverflow: viewport instanceof HTMLElement ? viewport.style.overflow : '',
    };

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    if (viewport instanceof HTMLElement) {
      viewport.style.overflow = 'hidden';
    }

    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      if (viewport instanceof HTMLElement) {
        viewport.style.overflow = prev.viewportOverflow;
      }
    };
  }, [open]);

  // 实时进度:游戏运行时若发出含金币的事件,立即推进 Rail。
  const handleRuntimeEvent = useCallback((event) => {
    const parsed = parseProgressCoinEvent(event, activeSessionRef.current, seenSessionTotalRef.current);
    if (parsed) {
      const hasNewSeq = parsed.seq ? parsed.seq > seenEventSeqRef.current : false;
      const hasNewSessionTotal = parsed.totalCoinsInSession > seenSessionTotalRef.current;
      if (!hasNewSeq && !hasNewSessionTotal) return;
      if (parsed.seq && parsed.seq > seenEventSeqRef.current) {
        seenEventSeqRef.current = parsed.seq;
      }
      if (parsed.totalCoinsInSession > seenSessionTotalRef.current) {
        seenSessionTotalRef.current = parsed.totalCoinsInSession;
      }
      runtimeAwardedCoinsRef.current += parsed.deltaCoins;
      awardCoins(parsed.deltaCoins);
    }
    onRuntimeEvent?.(event);
  }, [awardCoins, onRuntimeEvent]);

  // 游戏结束:仅补齐“结算金币 - 已实时发放金币”,避免重复累计。
  const handleDone = useCallback((settlement) => {
    const totalAwarded = Math.max(
      0,
      Math.round(Number(settlement?.pointsAwarded ?? settlement?.coinsAwarded ?? 0)),
    );
    const remaining = Math.max(0, totalAwarded - runtimeAwardedCoinsRef.current);
    if (remaining > 0) awardCoins(remaining);
    const authoritativeTotal = Number.isFinite(Number(settlement?.pointsBalance))
      ? Math.max(0, Math.round(Number(settlement.pointsBalance)))
      : seedCoinsRef.current + totalAwarded;

    // 结算前强制对齐到后端权威积分,避免用户感知“游戏内与首页不一致”。
    resetTo(authoritativeTotal);
    runtimeAwardedCoinsRef.current = totalAwarded;

    window.setTimeout(() => {
      onDone?.(settlement);
    }, 80);
  }, [awardCoins, onDone]);

  if (!open) return null;

  return (
    <div
      className={`platform-game-overlay open${gameStart ? ' platform-game-overlay--playing' : ''}`}
      role="dialog"
      aria-label={title}
    >
      <div className="platform-game-topbar">
        <ProgressRail rail={displayRail} displayCoins={displayCoins} lastGain={lastGain} todayRank={todayRank} rankChange={rankChange} />

        <button type="button" className="platform-game-close" onClick={onClose} aria-label="Close game">
          Exit
        </button>
      </div>

      {gameStart ? (
        <div className="platform-game-stage">
          <GameHost start={gameStart} onDone={handleDone} onError={onError} onRuntimeEvent={handleRuntimeEvent} />
        </div>
      ) : (
        <div className="platform-game-loading platform-game-loading--immersive">
          <span className="platform-game-spinner" aria-hidden="true" />
          <p>{loadingMessage || 'Preparing game…'}</p>
        </div>
      )}

      <CouponUnlockedModal
        open={!!upgrade}
        percent={upgrade?.percent}
        onContinue={clearUpgrade}
      />
    </div>
  );
}
