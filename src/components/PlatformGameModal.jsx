import ModalShell from './ModalShell.jsx';
import GameHost from './GameHost.jsx';

export default function PlatformGameModal({ open, title, gameStart, loadingMessage, onClose, onDone, onError }) {
  return (
    <ModalShell open={open} title={title} onClose={onClose}>
      {gameStart ? (
        <div className="platform-game-shell">
          <GameHost start={gameStart} onDone={onDone} onError={onError} />
        </div>
      ) : (
        <div className="platform-game-loading">
          <span className="platform-game-spinner" aria-hidden="true" />
          <p>{loadingMessage || 'Preparing game…'}</p>
        </div>
      )}
    </ModalShell>
  );
}
