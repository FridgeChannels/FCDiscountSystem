import { useCallback, useEffect, useRef } from 'react';
import GameHost from './GameHost.jsx';
import ProgressRail from './ProgressRail.jsx';
import CouponUnlockedModal from './CouponUnlockedModal.jsx';
import { useGameProgress, MOCK_INITIAL_COINS } from '../lib/gameProgress.js';

/** 从游戏运行时事件里尽力解析“本次获得金币”。真实埋点确定后可收敛字段。 */
function readCoinDelta(event) {
  if (!event || typeof event !== 'object') return 0;
  const candidates = [event.coins, event.coinsAwarded, event.pointsAwarded, event.delta, event.amount];
  const isCoinish =
    event.type === 'coins' ||
    event.type === 'coin' ||
    event.type === 'score' ||
    event.type === 'reward' ||
    candidates.some((value) => typeof value === 'number');
  if (!isCoinish) return 0;
  const value = candidates.find((candidate) => typeof candidate === 'number');
  return Math.max(0, Math.round(Number(value) || 0));
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
  // Progress Rail 状态(第一版 mock):进入游戏时用当前真实金币播种,阶梯用 mock。
  const initialCoins = Number(progressView?.currentPoints ?? MOCK_INITIAL_COINS);
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
  } = useGameProgress({ initialCoins });

  // 进入新一局时用最新真实金币重新播种 Rail。
  useEffect(() => {
    if (open) resetTo(initialCoins);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    const delta = readCoinDelta(event);
    if (delta > 0) awardCoins(delta);
    onRuntimeEvent?.(event);
  }, [awardCoins, onRuntimeEvent]);

  // 游戏结束:先把本次金币反馈到顶部 Rail(+N Coins / count-up / 升级检测),再交还父级结算。
  const handleDone = useCallback((settlement) => {
    const delta = Math.max(0, Math.round(Number(settlement?.pointsAwarded ?? settlement?.coinsAwarded ?? 0)));
    if (delta > 0) awardCoins(delta);
    onDone?.(settlement);
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
