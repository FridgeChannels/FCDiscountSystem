import { useEffect, useRef, useState } from 'react';
import OnboardingController, { useOnboarding } from '../onboarding/OnboardingController.jsx';
import VivoraCan3D from './VivoraCan3D.jsx';
import './dailyGrindGameMap.css';
import './islandVisualTheme.css';

const TASK_SPOTS = [
  { key: 'memory_match', fallback: 'card', className: 'daily-grind-spot--cards', bounds: { left: 15, top: 72, width: 28, height: 27 }, accepts: (task) => task.type === 'game' },
  { key: 'bridge_cross', fallback: 'bridge', className: 'daily-grind-spot--bridge', bounds: { left: 39.5, top: 36.5, width: 20, height: 15 }, accepts: (task) => task.type === 'game' },
  { key: 'dodge_plane', fallback: 'dodge', className: 'daily-grind-spot--dodge', bounds: { left: 5, top: 36.5, width: 25, height: 26 }, accepts: (task) => task.type === 'game' },
  { key: 'shopify_connect', className: 'daily-grind-spot--shopify', bounds: { left: 73, top: 26, width: 23, height: 30 }, accepts: (task) => task.type === 'shopify_connect' },
  { key: 'survey', className: 'daily-grind-spot--survey', bounds: { left: 46, top: 0, width: 25, height: 24 }, accepts: (task) => task.type === 'survey' },
];

// The original video is shared by all animated spots. Masks use percentages of
// the source frame so every active region stays aligned as the map resizes.
const VIDEO_SPOT_MASKS = {
  bridge_cross: 'radial-gradient(ellipse 18% 17% at 48% 37%, #000 75%, transparent 100%)',
  dodge_plane: 'radial-gradient(ellipse 13% 14% at 16% 41%, #000 72%, transparent 100%)',
  survey: 'radial-gradient(ellipse 15% 16% at 56% 9%, #000 75%, transparent 100%)',
};

const ISLAND_DETAIL_MASK = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 1034" preserveAspectRatio="none"><path fill="white" d="M 682 18 L 798 18 L 806 78 L 826 113 L 822 143 L 706 153 L 662 59 L 682 48 Z M 175 345 L 285 330 L 320 390 L 305 460 L 185 475 L 155 420 Z"/></svg>',
)}`;

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
  targetRewardLabel = null, brandLogoUrl = null, brandName = '', onLeaderboard, onRewards, rewardNotice = false, expiryDate = '', identity = '', coinGainSignal = 0, lastGainAmount = 0, rewardsOpen = false, gameOpen = false, gameCompletion = 0,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const toggleSelectedTask = (id) => setSelectedId((current) => current === id ? null : id);
  const [hudModal, setHudModal] = useState(null);
  const [recentGain, setRecentGain] = useState(0);
  const seenCoinGain = useRef(coinGainSignal);
  useEffect(() => {
    if (coinGainSignal > seenCoinGain.current && lastGainAmount > 0) {
      seenCoinGain.current = coinGainSignal;
      setRecentGain(lastGainAmount);
      setHudModal('credits');
      const timer = window.setTimeout(() => setRecentGain(0), 2600);
      return () => window.clearTimeout(timer);
    }
    seenCoinGain.current = coinGainSignal;
  }, [coinGainSignal, lastGainAmount]);
  const onboarding = useOnboarding(identity, 'dtc');
  const tutorialStep = onboarding.state?.status === 'in_progress' ? onboarding.state.step : null;
  const [tutorialModal, setTutorialModal] = useState(null);
  const previousGameOpen = useRef(false);
  const completionSeen = useRef(gameCompletion);
  const tutorialSettled = useRef(false);
  useEffect(() => {
    if (!tutorialModal) return;
    const open = tutorialModal === 'rewards' ? rewardsOpen : hudModal === tutorialModal;
    if (!open) {
      setTutorialModal(null);
      if (tutorialStep === tutorialModal) onboarding.go(tutorialModal === 'credits' ? 'rewards' : 'game');
    }
  }, [hudModal, rewardsOpen, tutorialModal, tutorialStep]);
  useEffect(() => {
    if (gameCompletion !== completionSeen.current) {
      completionSeen.current = gameCompletion;
      tutorialSettled.current = true;
      if (tutorialStep === 'playing') {
        const timer = window.setTimeout(() => onboarding.go('complete'), 2600);
        return () => window.clearTimeout(timer);
      }
    }
  }, [gameCompletion, tutorialStep]);
  useEffect(() => {
    if (previousGameOpen.current && !gameOpen && tutorialStep === 'playing' && !tutorialSettled.current) {
      // A closed game without a settlement can be tried again.
      const timer = window.setTimeout(() => onboarding.go('game'), 350);
      previousGameOpen.current = gameOpen;
      return () => window.clearTimeout(timer);
    }
    previousGameOpen.current = gameOpen;
  }, [gameOpen, tutorialStep, gameCompletion]);
  useEffect(() => {
    if (!hudModal) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setHudModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hudModal]);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef(null);
  const closeHelp = () => {
    setHelpOpen(false);
    helpButtonRef.current?.focus();
  };
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
  const tutorialGame = tasks.find(({ spot, challenge }) => challenge.type === 'game' && spot.key !== 'memory_match') ?? tasks.find(({ challenge }) => challenge.type === 'game');
  const productIslandChallenge = tasks.find(({ spot }) => spot.key === 'memory_match')?.challenge;
  const hasShopifyTask = tasks.some(({ spot }) => spot.key === 'shopify_connect');
  const activeVideoMasks = tasks.map(({ spot }) => VIDEO_SPOT_MASKS[spot.key]).filter(Boolean);
  const videoMask = activeVideoMasks.join(', ');
  const progressMax = Number(threshold) > 0 ? Number(threshold) : 100;
  const progressValue = Math.max(0, Math.min(progressMax, Number(points) || 0));
  const progressPercent = (progressValue / progressMax) * 100;

  return (
    <div className="daily-grind-map" aria-label="VIVORA island map">
      <div className="game-hud" aria-label="Game information">
        <button type="button" className="game-hud__icon" aria-label="Credits" data-tutorial="credits" onClick={() => { setHudModal('credits'); if (tutorialStep === 'credits') setTutorialModal('credits'); }}><span aria-hidden="true"><img className="game-hud__asset" src="/rewards/hud-credits-3d.png" alt="" /></span><small>Credits</small></button>
        <button type="button" className="game-hud__icon" aria-label="Rewards" data-tutorial="rewards" onClick={() => { onRewards?.(); if (tutorialStep === 'rewards') setTutorialModal('rewards'); }}><span aria-hidden="true"><img className="game-hud__asset" src="/rewards/hud-rewards-3d.png" alt="" /></span>{rewardNotice && <i className="game-hud__notice" />}<small>Rewards</small></button>
        <button type="button" className="game-hud__icon" aria-label="Leaderboard" onClick={() => onLeaderboard?.()}><span aria-hidden="true"><img className="game-hud__asset" src="/rewards/hud-ranking-3d.png" alt="" /></span><small>Ranking</small></button>
      </div>
      {hudModal && (
        <div className="game-hud-modal__overlay" onClick={() => setHudModal(null)}>
          <section className="credits-stone" role="dialog" aria-modal="true" aria-labelledby="hud-modal-title" onClick={(event) => event.stopPropagation()}>
            <button className="credits-stone__close" type="button" aria-label="Close" onClick={() => setHudModal(null)}>×</button>
            <div className="credits-reference__heading">
              <img src="/rewards/hud-credits-3d.png" alt="" />
              <h2 id="hud-modal-title">Your<br />Progress</h2>
              <div className="credits-reference__time"><span>◷</span><div><small>{isExpired ? 'Challenge ended' : 'Time left'}</small>{!isExpired && <strong>{countdownText}</strong>}</div></div>
            </div>
            {Number(threshold) > 0 && <>
              <div className="credits-reference__comparison">
                <div><span>CREDITS</span><strong><i aria-hidden="true">✦</i>{points} / {threshold}</strong></div>
                <b aria-hidden="true">➜</b>
                <div><span>NEXT REWARD</span><strong><img src="/rewards/hud-rewards-3d.png" alt="" />{targetRewardLabel || 'Coupon'}</strong></div>
              </div>
              <p className="credits-reference__description">{isExpired ? 'This challenge has ended.' : delta > 0 ? `Earn ${delta} more credits to unlock ${targetRewardLabel || 'your next coupon'}.` : 'Your reward goal is reached!'}</p>
              {recentGain > 0 && <div className="credits-reference__earned" role="status">+{recentGain} credits earned</div>}
              <div className="credits-progress-track">
                <div className="credits-stone__bar" role="progressbar" aria-label="Reward progress" aria-valuemin="0" aria-valuemax={progressMax} aria-valuenow={progressValue}><span className={recentGain ? 'is-gaining' : ''} style={{ width: `${progressPercent}%` }} /></div>
                <div className="credits-progress-marker" style={{ left: `clamp(22px, ${progressPercent}%, calc(100% - 22px))` }} aria-hidden="true">{brandLogoUrl ? <img src={brandLogoUrl} alt="" /> : <span>{brandName.trim().charAt(0).toUpperCase() || '★'}</span>}</div>
                <span className="credits-progress-percent">{Math.round(progressPercent)}%</span>
              </div>
            </>}
          
          </section>
        </div>
      )}
      <div className="daily-grind-map__scene">
        <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
          <filter id="island-soft-green" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0.96 0 0 0 0  0 1 0 0 0  0 0 0.93 0 0  0 0 0 1 0" />
          </filter>
          <filter id="island-water-matte" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" result="rg" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  5 -5 0 0 0" />
            <feColorMatrix in="SourceGraphic" result="gr" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -5 5 0 0 0" />
            <feColorMatrix in="SourceGraphic" result="rb" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  5 0 -5 0 0" />
            <feColorMatrix in="SourceGraphic" result="br" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -5 0 5 0 0" />
            <feColorMatrix in="SourceGraphic" result="dark" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.7008 -5.7216 -0.5776 0 5.76" />
            <feComposite in="rg" in2="gr" operator="arithmetic" k2="1" k3="1" result="c1" />
            <feComposite in="rb" in2="br" operator="arithmetic" k2="1" k3="1" result="c2" />
            <feComposite in="c1" in2="c2" operator="arithmetic" k2="1" k3="1" result="color" />
            <feComposite in="color" in2="dark" operator="arithmetic" k2="1" k3="1" result="matte" />
            <feImage href={ISLAND_DETAIL_MASK} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="details" />
            <feComposite in="matte" in2="details" operator="arithmetic" k2="1" k3="1" result="complete-matte" />
            <feComposite in="SourceGraphic" in2="complete-matte" operator="in" />
          </filter>
        </svg>
        <div className="daily-grind-map__world-art" aria-hidden="true">
          <img className="daily-grind-map__still" src="/scene-media/daily-grind-map-frame.png" alt="" />
          {activeVideoMasks.length > 0 && (
            <video
              className="daily-grind-map__task-motion"
              src="/scene-media/daily-grind.mp4"
              style={{ maskImage: videoMask, WebkitMaskImage: videoMask }}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
            />
          )}
          {hasShopifyTask && (
            <span className="daily-grind-map__flag-motion">
              <img src="/scene-media/daily-grind-map-frame.png" alt="" />
            </span>
          )}
          {productIslandChallenge && (
            <span className="daily-grind-map__product-motion">
              <img src="/scene-media/daily-grind-map-frame.png" alt="" />
            </span>
          )}
        </div>
        {tasks.map(({ spot }) => (
          <svg
            key={`${spot.key}-shimmer`}
            className="daily-grind-task-shimmer"
            style={{
              left: `${spot.bounds.left}%`,
              top: `${spot.bounds.top}%`,
              width: `${spot.bounds.width}%`,
              height: `${spot.bounds.height}%`,
            }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon
              points={spot.key === 'bridge_cross' ? '12,0 100,57 88,100 0,42' : '50,0 100,25 100,75 50,100 0,75 0,25'}
              pathLength="100"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ))}
        <button
          type="button"
          className={`daily-grind-product-landmark ${productIslandChallenge ? 'has-game' : ''} ${selectedId === productIslandChallenge?.id ? 'is-selected' : ''}`}
          aria-label={productIslandChallenge ? `Select island: ${productIslandChallenge.title}` : 'VIVORA product island'}
          aria-hidden="true"
          tabIndex={-1}
          disabled={!productIslandChallenge}
          onClick={() => { if (productIslandChallenge) { toggleSelectedTask(productIslandChallenge.id); if (tutorialStep === 'game' && tutorialGame?.challenge.id === productIslandChallenge.id) onboarding.go('launch'); } }}
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
            data-tutorial={tutorialGame?.challenge.id === challenge.id ? 'game' : undefined}
            aria-pressed={selectedId === challenge.id}
            disabled={disabled}
            onClick={() => { toggleSelectedTask(challenge.id); if (tutorialStep === 'game' && tutorialGame?.challenge.id === challenge.id) onboarding.go('launch'); }}
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
          <div className="daily-grind-details__reward"><i className="coin-ic" aria-hidden="true" /><b>+{selectedReward}</b></div>
          <button
            type="button"
            className="daily-grind-details__action"
            data-tutorial="launch"
            onClick={() => { if (tutorialStep === 'launch') { tutorialSettled.current = false; onboarding.go('playing'); } onOpen?.(selectedChallenge); }}
          >
            <span className="daily-grind-details__action-main">
              <span>{selectedActionLabel}</span>

            </span>
            <span className="daily-grind-details__action-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      )}
      <div
        className={`island-map-footer ${helpOpen ? 'is-open' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && helpOpen) closeHelp();
        }}
      >
        <button
          type="button"
          ref={helpButtonRef}
          className="island-guide-buoy"
          onClick={() => { setHelpOpen(false); setSelectedId(null); setTutorialModal(null); onboarding.replay(); }}
          aria-label="Replay island guide"
          title="Replay island guide"
        >
          <span aria-hidden="true">🛟</span>
          <small>Island guide</small>
        </button>

      </div>
      <OnboardingController onboarding={onboarding} modalOpen={Boolean(tutorialModal)} selector={tutorialStep === 'game' ? (tutorialGame && !disabled ? '[data-tutorial="game"]' : null) : `[data-tutorial="${tutorialStep}"]`} />
    </div>
  );
}
