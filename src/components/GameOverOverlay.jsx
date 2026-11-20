import { RewardBrandMark } from './RewardBrand.jsx';

export default function GameOverOverlay({ visible }) {
  if (!visible) return null;

  return (
    <div className="platform-game-over-overlay" role="status" aria-live="polite">
      <div className="dtc-game-result">
        <RewardBrandMark />
        <span className="dtc-kicker">Game complete</span>
        <h2>Counting your points…</h2>
      </div>
    </div>
  );
}
