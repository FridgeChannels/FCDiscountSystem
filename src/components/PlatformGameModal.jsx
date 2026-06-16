import { useEffect } from 'react';
import GameHost from './GameHost.jsx';

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

  if (!open) return null;

  const currentPoints = Number(progressView?.currentPoints ?? 0);
  const targetPoints = Math.max(1, Number(progressView?.targetPoints ?? 100));
  const progressPct = Math.max(
    0,
    Math.min(Number(progressView?.progressPct ?? (currentPoints / targetPoints) * 100), 100),
  );
  const progressLabel = progressView?.label ?? `${currentPoints} / ${targetPoints}`;
  const brandName = brand?.name || 'Brand';

  return (
    <div
      className={`platform-game-overlay open${gameStart ? ' platform-game-overlay--playing' : ''}`}
      role="dialog"
      aria-label={title}
    >
      <div className="platform-game-topbar">
        <div className="platform-game-topbar-brand">
          {brand?.logoUrl ? (
            <img className="platform-game-topbar-logo" src={brand.logoUrl} alt={`${brandName} logo`} />
          ) : null}
          <span className="platform-game-topbar-name">{brandName}</span>
        </div>
        <div className="platform-game-topbar-progress" aria-label="Game progress placeholder">
          <div className="platform-game-topbar-progress-track">
            <div className="platform-game-topbar-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="platform-game-topbar-progress-text">{progressLabel}</span>
        </div>
        <button type="button" className="platform-game-close" onClick={onClose} aria-label="Close game">
          Exit
        </button>
      </div>
      {gameStart ? (
        <div className="platform-game-stage">
          <GameHost start={gameStart} onDone={onDone} onError={onError} onRuntimeEvent={onRuntimeEvent} />
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
