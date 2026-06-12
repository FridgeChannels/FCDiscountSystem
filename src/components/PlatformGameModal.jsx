import GameHost from './GameHost.jsx';

/** 游戏层铺满 mobile-viewport 卡片(非居中小弹窗) */
export default function PlatformGameModal({ open, title, gameStart, loadingMessage, onClose, onDone, onError }) {
  if (!open) return null;

  return (
    <div className="platform-game-overlay open" role="dialog" aria-label={title}>
      <button type="button" className="platform-game-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {gameStart ? (
        <div className="platform-game-stage">
          <GameHost start={gameStart} onDone={onDone} onError={onError} />
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
