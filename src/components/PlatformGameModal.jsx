import GameHost from './GameHost.jsx';
import { resolveBrandDisplay } from '../lib/brandTheme.js';

/** 游戏层铺满 mobile-viewport 卡片(非居中小弹窗) */
export default function PlatformGameModal({
  open,
  title,
  gameStart,
  brand,
  loadingMessage,
  onClose,
  onDone,
  onError,
}) {
  if (!open) return null;

  const display = resolveBrandDisplay(brand, gameStart?.brandTheme);
  const difficultyLevel = gameStart?.difficultyLevel;

  return (
    <div
      className="platform-game-overlay open"
      role="dialog"
      aria-label={title}
      style={display.primary ? { '--platform-game-accent': display.primary } : undefined}
    >
      <header className="platform-game-brand-bar">
        <div className="platform-game-brand-info">
          {display.logoUrl ? (
            <img
              className="platform-game-brand-logo"
              src={display.logoUrl}
              alt={display.name ? `${display.name} logo` : 'Brand logo'}
            />
          ) : display.name ? (
            <span className="platform-game-brand-name">{display.name}</span>
          ) : (
            <span className="platform-game-brand-name platform-game-brand-name--placeholder">Play &amp; earn</span>
          )}
        </div>
        {difficultyLevel ? (
          <span className="platform-game-difficulty" title="Difficulty level">
            {difficultyLevel}
          </span>
        ) : null}
      </header>
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
