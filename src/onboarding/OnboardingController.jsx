import { useEffect, useLayoutEffect, useState } from 'react';
import './onboarding.css';

const STEPS = ['welcome', 'credits', 'rewards', 'game', 'launch', 'playing', 'complete'];
const COPY = {
  credits: ['Earn Credits as You Play', 'Every island activity earns credits. Watch your balance grow toward your next coupon.', 'Tap Credits to see your goal and campaign time.'],
  rewards: ['Your Rewards', "Your unlocked coupons are kept together here, ready whenever you need them.", 'Tap Rewards to view your collection.'],
  countdown: ['Limited-Time Rewards', "Keep an eye on the campaign countdown so you don't miss your rewards.", 'Tap Timer to see the countdown.'],
  game: ['Choose Your Island Activity', 'Each glowing spot leads to a game or activity. Pick one to see what it offers.', 'Tap a highlighted spot to continue.'],
  launch: ['Ready to Play?', 'Complete an activity to earn credits and move closer to your coupon.', 'Tap Play now to start.'],
};

export function useOnboarding(identity, channel = 'dtc') {
  const key = identity ? `vivora-onboarding:v1:${channel}:${identity}` : null;
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!key) { setState(null); return; }
    // Local testing: show the guide on each page load without changing production persistence.
    if (import.meta.env.DEV) { setState({ status: 'in_progress', step: 'welcome' }); return; }
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch { /* storage unavailable */ }
    if (saved?.status === 'completed' || saved?.status === 'skipped') setState(saved);
    else if (saved?.status === 'in_progress') setState({ status: 'in_progress', step: ['countdown', 'launch', 'playing'].includes(saved.step) ? 'game' : (STEPS.includes(saved.step) ? saved.step : 'welcome') });
    else setState({ status: 'in_progress', step: 'welcome' });
  }, [key]);
  useEffect(() => { if (key && state) { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* continue in memory */ } } }, [key, state]);
  const go = (step) => setState({ status: 'in_progress', step });
  return { state, go, skip: () => setState({ status: 'skipped', step: null }), finish: () => setState({ status: 'completed', step: null }), replay: () => go('welcome') };
}

export function TutorialProgress({ step }) {
  const index = ({ welcome: 1, credits: 2, rewards: 3, game: 4, launch: 4, playing: 4, complete: 5 })[step] || 1;
  return <div className="tutorial-progress"><span>ISLAND GUIDE · {index} / 5</span><div aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < index ? 'is-active' : ''} />)}</div></div>;
}

export function SpotlightTarget({ rect }) {
  if (!rect) return <div className="tutorial-shade" />;
  const pad = 7, left = Math.max(0, rect.left - pad), top = Math.max(0, rect.top - pad), right = Math.min(window.innerWidth, rect.right + pad), bottom = Math.min(window.innerHeight, rect.bottom + pad);
  return <><div className="tutorial-mask" style={{ left: 0, top: 0, right: 0, height: top }} /><div className="tutorial-mask" style={{ left: 0, top, width: left, height: bottom - top }} /><div className="tutorial-mask" style={{ left: right, top, right: 0, height: bottom - top }} /><div className="tutorial-mask" style={{ left: 0, top: bottom, right: 0, bottom: 0 }} /><div className="tutorial-ring" style={{ left, top, width: right - left, height: bottom - top }} /></>;
}

export function ContextualTooltip({ step, rect, onSkip }) {
  const copy = step === 'game' && !rect ? ['Your Adventure Starts Here!', 'A game is not available right now. You can return to the tutorial from How it works when one is ready.', 'You can skip the tutorial at any time.'] : COPY[step];
  if (!copy) return null;
  const width = Math.min(320, window.innerWidth - 32);
  const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect ? rect.left + rect.width / 2 - width / 2 : (window.innerWidth - width) / 2));
  const below = rect && rect.bottom < window.innerHeight * .53;
  const top = rect ? (below ? Math.min(rect.bottom + 20, window.innerHeight - 245) : Math.max(16, rect.top - 230)) : Math.max(16, window.innerHeight / 2 - 110);
  return <div className={`tutorial-card tutorial-tooltip ${below ? 'points-up' : 'points-down'}`} style={{ left, top, width, '--tutorial-arrow-x': `${Math.max(20, Math.min(width - 20, rect ? rect.left + rect.width / 2 - left : width / 2))}px` }} role="dialog" aria-label={copy[0]}><button className="tutorial-close" onClick={onSkip} aria-label="Close tutorial">×</button><TutorialProgress step={step} /><div className="tutorial-content"><img src={step === 'rewards' ? '/rewards/hud-rewards-3d.png' : '/rewards/hud-credits-3d.png'} alt="" /><div><h2>{copy[0]}</h2><p>{copy[1]}</p><strong>{copy[2]}</strong></div></div></div>;
}

export function TutorialOverlay({ step, selector, onSkip }) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    const update = () => { const el = selector && document.querySelector(selector); setRect(el?.getBoundingClientRect() ?? null); };
    const target = selector && document.querySelector(selector);
    if (target) { const bounds = target.getBoundingClientRect(); if (bounds.top < 0 || bounds.bottom > window.innerHeight) target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    update(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    const timer = window.setInterval(update, 500);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.clearInterval(timer); };
  }, [selector, step]);
  return <div className="tutorial-layer"><SpotlightTarget rect={rect} /><ContextualTooltip step={step} rect={rect} onSkip={onSkip} /><button className="tutorial-skip" onClick={onSkip}>Skip tutorial</button></div>;
}

export function TutorialCompletionModal({ onFinish, onSkip }) {
  return <div className="tutorial-layer"><div className="tutorial-shade" /><div className="tutorial-card tutorial-centered" role="dialog" aria-modal="true" aria-labelledby="tutorial-complete"><button className="tutorial-close" onClick={onSkip} aria-label="Close tutorial">×</button><TutorialProgress step="complete" /><div className="tutorial-emblem">✦</div><h2 id="tutorial-complete">Your Island Is Ready!</h2><p>Pick an activity, earn credits, and come back to this buoy whenever you need a guide!</p><button className="tutorial-primary" onClick={onFinish}>Start Playing</button></div></div>;
}

export default function OnboardingController({ onboarding, selector, modalOpen }) {
  const { state, go, skip, finish } = onboarding;
  if (state?.status !== 'in_progress') return null;
  const step = state.step;
  if (step === 'welcome') return <div className="tutorial-layer"><div className="tutorial-shade" /><div className="tutorial-card tutorial-centered" role="dialog" aria-modal="true" aria-labelledby="tutorial-welcome"><button className="tutorial-close" onClick={skip} aria-label="Close tutorial">×</button><TutorialProgress step={step} /><div className="tutorial-emblem">✦</div><h2 id="tutorial-welcome">Welcome to VIVORA Island!</h2><p>Choose activities on the island, collect credits, and unlock coupons. This quick guide will show you how.</p><button className="tutorial-primary" onClick={() => go('credits')}>Let's Explore</button><button className="tutorial-text-button" onClick={skip}>Skip tutorial</button></div></div>;
  if (step === 'complete') return <TutorialCompletionModal onFinish={finish} onSkip={skip} />;
  if (modalOpen || step === 'playing') return <button className="tutorial-skip tutorial-skip--modal" onClick={skip}>Skip tutorial</button>;
  return <TutorialOverlay step={step} selector={selector} onSkip={skip} />;
}
