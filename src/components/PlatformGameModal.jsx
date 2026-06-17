import { useCallback, useEffect, useMemo, useRef } from 'react';
import GameHost from './GameHost.jsx';
import ProgressRail from './ProgressRail.jsx';
import { useGameProgress, MOCK_INITIAL_COINS } from '../lib/gameProgress.js';
import { useLiveLeaderboardRank } from '../lib/useLiveLeaderboardRank.js';
import { bindVisibleViewportLock } from '../lib/visibleViewport.js';

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
  leaderboard,
  onClose,
  onDone,
  onError,
  onRuntimeEvent,
}) {
  const initialCoins = Number(progressView?.currentPoints ?? MOCK_INITIAL_COINS);
  const ladder = useMemo(
    () => (Array.isArray(progressView?.ladder) && progressView.ladder.length ? progressView.ladder : undefined),
    [progressView?.ladder],
  );
  const {
    displayCoins,
    displayRail,
    lastGain,
    tierUnlock,
    awardCoins,
    resetTo,
  } = useGameProgress({ initialCoins, ladder });

  const { todayRank, rankChange, noteGameCoinsAwarded } = useLiveLeaderboardRank(
    leaderboard,
    open ? gameStart?.sessionId : null,
  );

  const awardCoinsWithRank = useCallback((amount) => {
    const delta = Math.max(0, Math.round(Number(amount) || 0));
    if (delta <= 0) return;
    awardCoins(delta);
    noteGameCoinsAwarded(delta);
  }, [awardCoins, noteGameCoinsAwarded]);

  const seenEventSeqRef = useRef(0);
  const seenSessionTotalRef = useRef(0);
  const runtimeAwardedCoinsRef = useRef(0);
  const activeSessionRef = useRef('');
  const seedCoinsRef = useRef(initialCoins);

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

    const releaseViewportLock = viewport instanceof HTMLElement
      ? bindVisibleViewportLock(viewport)
      : () => {};

    return () => {
      releaseViewportLock();
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      if (viewport instanceof HTMLElement) {
        viewport.style.overflow = prev.viewportOverflow;
      }
    };
  }, [open]);

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
      awardCoinsWithRank(parsed.deltaCoins);
    }
    onRuntimeEvent?.(event);
  }, [awardCoinsWithRank, onRuntimeEvent]);

  const handleDone = useCallback((settlement) => {
    const totalAwarded = Math.max(
      0,
      Math.round(Number(settlement?.pointsAwarded ?? settlement?.coinsAwarded ?? 0)),
    );
    const remaining = Math.max(0, totalAwarded - runtimeAwardedCoinsRef.current);
    if (remaining > 0) awardCoinsWithRank(remaining);
    const authoritativeTotal = Number.isFinite(Number(settlement?.pointsBalance))
      ? Math.max(0, Math.round(Number(settlement.pointsBalance)))
      : seedCoinsRef.current + totalAwarded;

    resetTo(authoritativeTotal);
    runtimeAwardedCoinsRef.current = totalAwarded;

    window.setTimeout(() => {
      onDone?.(settlement);
    }, 80);
  }, [awardCoinsWithRank, onDone, resetTo]);

  if (!open) return null;

  return (
    <div
      className={`platform-game-overlay open${gameStart ? ' platform-game-overlay--playing' : ''}`}
      role="dialog"
      aria-label={title}
    >
      <div className="platform-game-topbar">
        <ProgressRail
          rail={displayRail}
          displayCoins={displayCoins}
          lastGain={lastGain}
          tierUnlock={tierUnlock}
          todayRank={todayRank}
          rankChange={rankChange}
        />

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

    </div>
  );
}
