import { useState } from 'react';
import VivoraCan3D from './VivoraCan3D.jsx';
import './dailyGrindGameMap.css';

const TASK_SPOTS = [
  { key: 'memory_match', fallback: 'card', className: 'daily-grind-spot--cards', bounds: { left: 15, top: 72, width: 28, height: 27 }, accepts: (task) => task.type === 'game' },
  { key: 'bridge_cross', fallback: 'bridge', className: 'daily-grind-spot--bridge', bounds: { left: 39.5, top: 36.5, width: 20, height: 15 }, accepts: (task) => task.type === 'game' },
  { key: 'dodge_plane', fallback: 'dodge', className: 'daily-grind-spot--dodge', bounds: { left: 5, top: 36.5, width: 25, height: 26 }, accepts: (task) => task.type === 'game' },
  { key: 'shopify_connect', className: 'daily-grind-spot--shopify', bounds: { left: 73, top: 26, width: 23, height: 30 }, accepts: (task) => task.type === 'shopify_connect' },
  { key: 'survey', className: 'daily-grind-spot--survey', bounds: { left: 46, top: 0, width: 25, height: 24 }, accepts: (task) => task.type === 'survey' },
];

function gameType(challenge) {
  return `${challenge?.templateKey ?? ''} ${challenge?.gameInstanceId ?? ''} ${challenge?.title ?? ''}`.toLowerCase();
}

function iconAssetForTask(challenge, spot) {
  if (!challenge) return null;
  if (challenge.type === 'survey') return '/rewards/survey-3d.png';
  if (challenge.type === 'shopify_connect') return '/rewards/shopify-connect-3d.png';
  if (challenge.type !== 'game') return null;

  const type = gameType(challenge);
  if (type.includes('crossy road')) return '/rewards/crossy-road-3d.png';
  if (type.includes('bridge_cross') || type.includes('bridge')) return '/rewards/bridge-cross-3d.png';
  if (type.includes('memory_match') || type.includes('card')) return '/rewards/memory-match-3d.png';
  if (type.includes('dodge_plane') || type.includes('dodge') || type.includes('plane')) return '/rewards/dodge-plane-3d.png';

  if (spot?.key === 'bridge_cross') return '/rewards/bridge-cross-3d.png';
  if (spot?.key === 'memory_match') return '/rewards/memory-match-3d.png';
  if (spot?.key === 'dodge_plane') return '/rewards/dodge-plane-3d.png';
  return null;
}

export default function DailyGrindGameMap({
  challenges = [], disabled = false, onOpen, upgradeMaxPoints = 5,
  countdownText = '', isExpired = false, points = 0, threshold = null, delta = 0,
  brandLogoUrl = null, brandName = '', targetRewardLabel = null, targetCouponLabel = null, onLeaderboard,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const assignments = new Map();
  const usedIds = new Set();
  // Reserve known task destinations first so an unknown game cannot take the bridge tile.
  for (const spot of TASK_SPOTS) {
    const challenge = challenges.find((item) => !usedIds.has(item.id)
      && spot.accepts(item)
      && (item.type !== 'game' || gameType(item).includes(spot.key) || gameType(item).includes(spot.fallback)));
    if (challenge) {
      assignments.set(spot.key, challenge);
      usedIds.add(challenge.id);
    }
  }
  const openGameSpots = TASK_SPOTS.filter((spot) => spot.accepts({ type: 'game' }) && !assignments.has(spot.key));
  const remainingGames = challenges.filter((item) => item.type === 'game' && !usedIds.has(item.id));
  openGameSpots.forEach((spot, index) => {
    const challenge = remainingGames[index];
    if (challenge) {
      assignments.set(spot.key, challenge);
      usedIds.add(challenge.id);
    }
  });
  const tasks = TASK_SPOTS
    .map((spot) => ({ spot, challenge: assignments.get(spot.key) }))
    .filter(({ challenge }) => challenge);
  const selectedTask = tasks.find(({ challenge }) => challenge.id === selectedId) ?? null;
  const selectedChallenge = selectedTask?.challenge ?? null;
  const selectedIconAsset = iconAssetForTask(selectedChallenge, selectedTask?.spot);
  const selectedIsGeneratedIcon = selectedIconAsset?.startsWith('/rewards/');
  const selectedDifficulty = Math.max(1, Math.min(3, Number.parseInt(selectedChallenge?.difficultyLevel, 10) || 1));
  const gameRewardCap = Math.max(5, Math.round(Number(upgradeMaxPoints) || 0));
  const selectedReward = selectedChallenge?.type === 'game'
    ? `5–${gameRewardCap}`
    : Number(selectedChallenge?.pointsOffered)
      || Number.parseInt(String(selectedChallenge?.reward ?? '').replace(/\D/g, ''), 10)
      || gameRewardCap;
  const selectedQuestLabel = selectedChallenge?.type === 'game'
    ? 'GAME QUEST'
    : selectedChallenge?.type === 'survey'
      ? 'SIDE QUEST'
      : 'BONUS QUEST';
  const selectedActionLabel = selectedChallenge?.type === 'shopify_connect'
    ? 'Connect'
    : selectedChallenge?.type === 'survey'
      ? 'Start survey'
      : 'Play now';
  const productIslandChallenge = tasks.find(({ spot }) => spot.key === 'memory_match')?.challenge;
  const progressMax = Number(threshold) > 0 ? Number(threshold) : 100;
  const progressValue = Math.max(0, Math.min(progressMax, Number(points) || 0));
  const progressPercent = (progressValue / progressMax) * 100;
  const rewardDescription = targetRewardLabel || 'your next reward';

  if (!tasks.length) return null;

  return (
    <div className="daily-grind-map" aria-label="VIVORA island map">
      <div className="daily-grind-map__heading">
        <div className="daily-grind-map__heading-main">
          <div className="daily-grind-map__heading-copy">
            <span>Gain your coupons!</span>
            <small>{isExpired ? 'Challenge ended' : `Time left ${countdownText}`}</small>
          </div>
          <button type="button" onClick={onLeaderboard} aria-label="Open leaderboard">🏆 Leaderboard</button>
        </div>
        <div className="daily-grind-map__campaign">
          <div className="daily-grind-map__campaign-copy">
            <div className="daily-grind-map__campaign-goal">
              <strong aria-live="polite">
                {isExpired
                  ? 'Challenge ended'
                  : delta > 0
                    ? <>Earn <span className="daily-grind-map__campaign-remaining">{delta}</span> more credits</>
                    : 'Reward goal reached'}
              </strong>
              <small>
                {isExpired
                  ? `You earned ${points} of ${threshold ?? '—'} credits toward ${targetRewardLabel || 'your reward'}`
                  : delta > 0
                    ? `to unlock ${targetRewardLabel ? `your ${targetRewardLabel}` : 'your next reward'}`
                    : targetRewardLabel
                      ? `Your ${targetRewardLabel} is unlocked`
                      : 'Your reward is unlocked'}
              </small>
            </div>
            {!isExpired && (
              <span className="daily-grind-map__campaign-tally">{points} / {threshold ?? '—'} credits</span>
            )}
          </div>
          <div className="daily-grind-map__campaign-meter">
            <div className="daily-grind-map__campaign-meter-rail">
              <div
                className="daily-grind-map__campaign-bar"
                role="progressbar"
                aria-label="Reward progress"
                aria-valuemin={0}
                aria-valuemax={progressMax}
                aria-valuenow={progressValue}
                aria-valuetext={isExpired
                  ? `Challenge ended; ${points} of ${threshold ?? '—'} credits earned toward ${targetRewardLabel || 'your reward'}`
                  : delta > 0
                    ? `${points} of ${threshold ?? '—'} credits earned; ${delta} more to unlock ${rewardDescription}`
                    : `Reward goal reached; ${targetRewardLabel || 'your reward'} unlocked`}
              >
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <span
                className="daily-grind-map__campaign-marker"
                style={{ left: `${progressPercent}%` }}
                aria-hidden="true"
              >
                {brandLogoUrl
                  ? <img src={brandLogoUrl} alt="" />
                  : <span>{brandName?.trim()?.charAt(0) || '•'}</span>}
              </span>
            </div>
            {targetCouponLabel && (
              <div
                className="daily-grind-map__campaign-target"
                role="group"
                aria-label={`Target coupon: ${targetRewardLabel || targetCouponLabel}`}
                title={`Target coupon: ${targetRewardLabel || targetCouponLabel}`}
              >
                <span>Target</span>
                <strong>{targetCouponLabel}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="daily-grind-map__scene">
        <video
          src="/scene-media/daily-grind.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
        {tasks.map(({ spot, challenge }, index) => spot.bounds && (
          <span
            key={`${spot.key}-island-art`}
            className={`daily-grind-game-tile ${spot.className} ${selectedId === challenge.id ? 'is-selected' : ''}`}
            style={{
              left: `${spot.bounds.left}%`,
              top: `${spot.bounds.top}%`,
              width: `${spot.bounds.width}%`,
              height: `${spot.bounds.height}%`,
              '--island-bob-delay': `${index * 180}ms`,
            }}
            aria-hidden="true"
          >
            <img
              src="/scene-media/daily-grind-map-frame.png"
              alt=""
              style={{
                width: `${10000 / spot.bounds.width}%`,
                height: `${10000 / spot.bounds.height}%`,
                left: `${-spot.bounds.left * 100 / spot.bounds.width}%`,
                top: `${-spot.bounds.top * 100 / spot.bounds.height}%`,
              }}
            />
          </span>
        ))}
        <button
          type="button"
          className={`daily-grind-product-landmark ${productIslandChallenge ? 'has-game' : ''} ${selectedId === productIslandChallenge?.id ? 'is-selected' : ''}`}
          aria-label={productIslandChallenge ? `Select island: ${productIslandChallenge.title}` : 'VIVORA product island'}
          disabled={!productIslandChallenge}
          onClick={() => productIslandChallenge && setSelectedId(productIslandChallenge.id)}
        >
          <VivoraCan3D label="VIVORA Sparkling product model" />
        </button>
        {tasks.map(({ spot, challenge }) => (
          <button
            key={spot.key}
            type="button"
            className={`daily-grind-spot ${spot.className} ${selectedId === challenge.id ? 'is-selected' : ''}`}
            aria-label={challenge.type === 'shopify_connect'
              ? `Select Connect Shopify Account`
              : challenge.type === 'survey'
                ? `Select survey: ${challenge.title}`
                : `Select game: ${challenge.title}`}
            aria-pressed={selectedId === challenge.id}
            onClick={() => setSelectedId(challenge.id)}
          />
        ))}
      </div>
      {selectedChallenge && (
        <div className="daily-grind-details" role="region" aria-live="polite" aria-label={`${selectedChallenge.title} details`}>
          <div className="daily-grind-details__main">
            <div className="daily-grind-details__identity">
              <span className={`daily-grind-details__icon ${selectedIconAsset ? 'is-asset' : ''} ${selectedIsGeneratedIcon ? 'is-generated' : ''}`} aria-hidden="true">
                {selectedIconAsset
                  ? <img className="daily-grind-details__icon-image" src={selectedIconAsset} alt="" />
                  : selectedChallenge.icon || (selectedChallenge.type === 'survey' ? '📝' : '🎮')}
              </span>
              <div className="daily-grind-details__copy">
                <div className="daily-grind-details__eyebrow">
                  <span className={`daily-grind-details__badge is-${selectedChallenge.type}`}>
                    {selectedChallenge.type === 'game' ? 'GAME QUEST' : selectedChallenge.type === 'survey' ? 'SURVEY' : 'SHOPIFY'}
                  </span>
                  {selectedChallenge.type !== 'game' && (
                    <span className="daily-grind-details__quest-label">{selectedQuestLabel}</span>
                  )}
                </div>
                <div className="daily-grind-details__title-row">
                  <strong className="daily-grind-details__title">{selectedChallenge.title}</strong>
                  {selectedChallenge.type === 'game' && (
                    <div className="challenge-rating-row daily-grind-details__difficulty" aria-label={`Difficulty ${selectedDifficulty} of 3`}>
                      <span>Difficulty</span>
                      <span className="challenge-rating-icons is-difficulty" aria-hidden="true">
                        {Array.from({ length: selectedDifficulty }).map((_, index) => (
                          <i className="challenge-rating-bolt" key={index} />
                        ))}
                      </span>
                    </div>
                  )}
                </div>
                {selectedChallenge.type === 'game' ? (
                  null
                ) : (
                  <p className="daily-grind-details__description">
                    {selectedChallenge.desc || (selectedChallenge.type === 'survey'
                      ? 'Share your preferences to earn credits.'
                      : 'Connect your Shopify account to earn credits.')}
                  </p>
                )}
                {selectedChallenge.type === 'survey' && Number(selectedChallenge.questionCount) > 0 && (
                  <div className="daily-grind-details__meta">
                    <span className="daily-grind-details__question-count">
                      {selectedChallenge.questionCount} {Number(selectedChallenge.questionCount) === 1 ? 'question' : 'questions'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="daily-grind-details__action"
            onClick={() => onOpen?.(selectedChallenge)}
          >
            <span className="daily-grind-details__action-main">
              <span>{selectedActionLabel}</span>
              <span className="daily-grind-details__action-reward">
                <i className="coin-ic" aria-hidden="true" />
                <b>+{selectedReward}</b>
              </span>
            </span>
            <span className="daily-grind-details__action-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      )}
      <div className={`island-map-footer ${helpOpen ? 'is-open' : ''}`}>
        <button
          type="button"
          onClick={() => setHelpOpen((open) => !open)}
          aria-expanded={helpOpen}
          aria-controls="island-field-guide"
        >
          <span>How does it work?</span>
          <span aria-hidden="true">{helpOpen ? '−' : '+'}</span>
        </button>
        {helpOpen && <p id="island-field-guide">Choose a game or task on the island to earn credits. Collect enough credits to unlock your coupons.</p>}
      </div>
    </div>
  );
}
