/** Host shell overlay shown when a game session ends, before complete API returns. */
export default function GameOverOverlay({ visible, title = 'Game Over' }) {
  if (!visible) return null;

  return (
    <div className="platform-game-over-overlay" role="status" aria-live="polite" aria-label={title}>
      <p className="platform-game-over-title">{title}</p>
    </div>
  );
}
