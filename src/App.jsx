import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { completeSurvey, fetchRewardPlan, redeemCoupon, startGameSession } from './api/client.js';
import { readCachedRewardPlan, readRememberedTouchId, rememberTouchId, writeCachedRewardPlan } from './api/cache.js';
import { mapPlanToViewModel } from './api/mapPlan.js';
import PlatformGameModal from './components/PlatformGameModal.jsx';
import { dbg, dbgError } from './lib/debug.js';
import { preloadRuntimeManifest } from './lib/runtimeRegistry.js';

// 阶段4:对不依赖每秒倒计时的叶子组件做 memo,
// 避免倒计时每秒触发它们跟着整棵树一起重渲染。
const Header = memo(HeaderBase);
const Challenges = memo(
  ChallengesBase,
  (prev, next) =>
    prev.challenges === next.challenges &&
    prev.dailyCapReached === next.dailyCapReached,
);
const RulesFooter = memo(
  RulesFooterBase,
  (prev, next) => prev.rulesOpen === next.rulesOpen,
);

const INITIAL_SECONDS = 2 * 24 * 3600 + 4 * 3600 + 55 * 60;
const INTRO_REWARD_POINTS = 5;
const DEFAULT_TOUCH_ID = 'A8SQN3V2OW';

function getTouchId() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('touchId');
  if (fromQuery) return fromQuery;

  // NFC / landing paths: /p/:touchId or /t/:touchId (aligned with fc-platform /t/[touchId])
  const pathMatch = window.location.pathname.match(/^\/(?:p|t)\/([^/]+)\/?$/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);

  return readRememberedTouchId() || DEFAULT_TOUCH_ID;
}

const INITIAL_DISCOUNTS = [
  { num: '15', value: '15% OFF', target: 0, code: 'FC15RITUAL' },
  { num: '20', value: '20% OFF', target: 80, code: 'FC20RITUAL' },
  { num: '30', value: '30% OFF', target: 20, code: 'FC30RITUAL' }
];

const FALLBACK_CHALLENGES = [
  { id: 'survey', type: 'survey', badge: 'Survey', icon: '📝', title: 'Preferences', desc: 'Share habits for rewards', reward: '+10 PTS', cta: 'Start' }
];

const SURVEY_STEPS = [
  {
    title: '1. How often do you take health supplements?',
    options: ['Daily', 'Few times a week', 'Rarely']
  },
  {
    title: '2. What is most important to you when choosing supplements?',
    options: ['Ingredient quality', 'Price & value', 'Brand reputation']
  },
  {
    title: '3. Would you recommend Ritual to a friend?',
    options: ['Yes, definitely', 'Maybe', 'No']
  }
];

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    } catch (err) {
      reject(err);
    }
  });
}

function tierForDiscount(num) {
  const n = parseInt(num, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(5, Math.round((n - 15) / 5)));
}

function formatCountdown(totalSeconds) {
  const safe = Math.max(totalSeconds, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  return {
    days,
    hours,
    mins,
    secs,
    digits: [pad(days), pad(hours), pad(mins), pad(secs)],
    short: days > 0 ? `${days}d ${pad(hours)}h` : `${hours}h ${pad(mins)}m`,
    drawer: `${days}d ${pad(hours)}h ${pad(mins)}m`
  };
}

function formatTickingTime(totalSeconds) {
  const safe = Math.max(totalSeconds, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const totalHours = days * 24 + hours;
  return `${pad(totalHours)}:${pad(mins)}:${pad(secs)}`;
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

// Read the resolved tier color tokens off a coupon DOM element so other
// surfaces (zoom card, receipt) can mirror the operated coupon's color.
function readCouponTokens(el) {
  if (!el) return null;
  const cs = getComputedStyle(el);
  const get = (name) => cs.getPropertyValue(name).trim();
  return {
    main: get('--coupon-main'),
    accent: get('--coupon-accent'),
    ink: get('--coupon-ink'),
    gradient: get('--coupon-gradient')
  };
}

// Map resolved tokens to the CSS custom properties consumed by the zoom card.
function couponColorVars(colors) {
  if (!colors) return undefined;
  return {
    '--zc-main': colors.main,
    '--zc-accent': colors.accent,
    '--zc-ink': colors.ink,
    '--zc-gradient': colors.gradient
  };
}

function getArcPoint(progress) {
  const t = Math.min(Math.max(progress, 0), 1);
  const u = 1 - t;
  const x = 8 * u * u * u + 156 * u * u * t + 372 * u * t * t + 170 * t * t * t;
  const y = 58 * u * u * u + 6 * u * u * t + 6 * u * t * t + 58 * t * t * t;
  return {
    left: `${(x / 178) * 100}%`,
    top: `${(y / 70) * 100}%`
  };
}

export default function App() {
  const viewportRef = useRef(null);
  const targetCouponRef = useRef(null);
  const canvasRef = useRef(null);
  const tearTimerRef = useRef(null);
  const activeGameRequestRef = useRef(0);
  const preloadedGameStartsRef = useRef(new Map());
  const preloadingGameStartsRef = useRef(new Map());
  const confettiRef = useRef({ ctx: null, particles: [], frame: null });
  const couponFaceRef = useRef(null);
  const pointsTweenRef = useRef(null);
  const loginBonusGrantedRef = useRef(false);

  const [touchId] = useState(getTouchId);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState(null);
  const [rewardPlanId, setRewardPlanId] = useState(null);
  const [brand, setBrand] = useState({ name: null, logoUrl: null, primaryColor: null, shopUrl: '#' });
  const [challenges, setChallenges] = useState(FALLBACK_CHALLENGES);
  const [gameStart, setGameStart] = useState(null);
  const [gameModalTitle, setGameModalTitle] = useState('Play & Earn');
  const [gameLoadingMessage, setGameLoadingMessage] = useState('Preparing game…');
  const [surveyAnswers, setSurveyAnswers] = useState([]);
  const [welcomeStep, setWelcomeStep] = useState(() => {
    return localStorage.getItem('fc_welcome_completed') === 'true' ? 3 : 0;
  });
  const [welcomeTargetPoints, setWelcomeTargetPoints] = useState(67);
  const [points, setPoints] = useState(() => {
    const isFirstTime = localStorage.getItem('fc_welcome_completed') !== 'true';
    return isFirstTime ? 0 : 67;
  });
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(INITIAL_SECONDS);
  const [tick, setTick] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isTearingCoupon, setIsTearingCoupon] = useState(false);
  const [copyState, setCopyState] = useState('Copy');
  const [shopLoading, setShopLoading] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [notification, setNotification] = useState(null);
  const [dailyCapReached] = useState(false);
  const [targetPulse, setTargetPulse] = useState('');
  const [crediting, setCrediting] = useState(false);
  const [currentSwap, setCurrentSwap] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);
  const [introActive, setIntroActive] = useState(true);
  const closeIntro = useCallback(() => setIntroActive(false), []);

  useEffect(() => () => {
    if (pointsTweenRef.current) cancelAnimationFrame(pointsTweenRef.current);
  }, []);

  const clearGameSessionCache = useCallback(() => {
    preloadedGameStartsRef.current.clear();
    preloadingGameStartsRef.current.clear();
  }, []);

  // 3D Zoom-and-Flip state
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomRect, setZoomRect] = useState(null);
  const [zoomPhase, setZoomPhase] = useState('init'); // 'init' | 'zoomed' | 'flipped'
  const [zoomCoupon, setZoomCoupon] = useState(null);
  const [zoomColors, setZoomColors] = useState(null);
  const [receiptColors, setReceiptColors] = useState(null);
  const [zoomCopyState, setZoomCopyState] = useState('Copy');

  const [tapGame, setTapGame] = useState({ active: false, taps: 0, timeLeft: 5 });
  const [memoryGame, setMemoryGame] = useState({
    active: false,
    values: ['❓', '❓', '❓', '❓'],
    flipped: [],
    matched: []
  });
  const [spinActive, setSpinActive] = useState(false);
  const [spinRotation, setSpinRotation] = useState(0);
  const [surveyStep, setSurveyStep] = useState(0);

  const [discounts, setDiscounts] = useState(INITIAL_DISCOUNTS);

  const syncFromPlan = useCallback((plan) => {
    const vm = mapPlanToViewModel(plan);
    setRewardPlanId(vm.rewardPlanId);
    setDiscounts(vm.discounts.length ? vm.discounts : INITIAL_DISCOUNTS);
    setCurrentStepIndex(vm.currentStepIndex);
    setCountdownSeconds(vm.countdownSeconds);
    setBrand(vm.brand);
    setChallenges(vm.challenges.length ? vm.challenges : FALLBACK_CHALLENGES);
    
    const isFirstTime = localStorage.getItem('fc_welcome_completed') !== 'true';
    if (isFirstTime) {
      setWelcomeTargetPoints(vm.points);
      setPoints(0);
    } else {
      setPoints(vm.points);
    }

    if (vm.brand.primaryColor) {
      document.documentElement.style.setProperty('--brand-primary', vm.brand.primaryColor);
    }
  }, []);

  const reloadPlan = useCallback(async () => {
    const plan = await fetchRewardPlan(touchId);
    clearGameSessionCache();
    writeCachedRewardPlan(touchId, plan);
    syncFromPlan(plan);
    return plan;
  }, [clearGameSessionCache, syncFromPlan, touchId]);

  const preloadGameStart = useCallback((challenge) => {
    if (!rewardPlanId || !challenge?.gameInstanceId) return null;
    const key = `${rewardPlanId}:${challenge.gameInstanceId}`;
    if (preloadedGameStartsRef.current.has(key)) {
      return Promise.resolve(preloadedGameStartsRef.current.get(key));
    }
    if (preloadingGameStartsRef.current.has(key)) {
      return preloadingGameStartsRef.current.get(key);
    }

    const promise = startGameSession(rewardPlanId, challenge.gameInstanceId)
      .then((start) => {
        dbg('[FCDBG][App] startGameSession success', {
          rewardPlanId,
          gameInstanceId: challenge.gameInstanceId,
          templateKey: start.templateKey,
          runtimeComponent: start.runtimeComponent,
          pointsMode: start.pointsMode,
          difficultyParams: start.difficultyParams,
          sessionId: start.sessionId,
        });
        preloadedGameStartsRef.current.set(key, start);
        return start;
      })
      .catch((err) => {
        dbgError('[FCDBG][App] startGameSession failed', {
          rewardPlanId,
          gameInstanceId: challenge.gameInstanceId,
          err,
        });
        preloadedGameStartsRef.current.delete(key);
        throw err;
      })
      .finally(() => {
        preloadingGameStartsRef.current.delete(key);
      });

    preloadingGameStartsRef.current.set(key, promise);
    return promise;
  }, [rewardPlanId]);

  useEffect(() => {
    if (!rewardPlanId) return undefined;
    const gameChallenges = challenges
      .filter((challenge) => challenge.type !== 'survey' && challenge.gameInstanceId)
      .slice(0, 1);
    if (!gameChallenges.length) return undefined;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      gameChallenges.forEach((challenge) => {
        preloadGameStart(challenge)?.catch(() => {
          // Preloading is an optimization; click-time fallback will surface errors.
        });
      });
    };

    const idleId = window.requestIdleCallback
      ? window.requestIdleCallback(run, { timeout: 1200 })
      : window.setTimeout(run, 250);

    return () => {
      cancelled = true;
      if (window.cancelIdleCallback && typeof idleId === 'number') {
        window.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [challenges, preloadGameStart, rewardPlanId]);

  useEffect(() => {
    let cancelled = false;
    rememberTouchId(touchId);

    preloadRuntimeManifest(touchId).catch((err) => {
      dbgError('[FCDBG][App] runtime manifest preload failed', err);
    });

    const cached = readCachedRewardPlan(touchId);
    if (cached) {
      syncFromPlan(cached);
      setPlanLoading(false);
    }

    (async () => {
      try {
        setPlanLoading(true);
        setPlanError(null);
        const plan = await fetchRewardPlan(touchId);
        if (!cancelled) {
          clearGameSessionCache();
          writeCachedRewardPlan(touchId, plan);
          syncFromPlan(plan);
        }
      } catch (err) {
        if (!cancelled) setPlanError(err instanceof Error ? err.message : 'Failed to load rewards');
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearGameSessionCache, syncFromPlan, touchId]);

  const current = discounts[currentStepIndex];
  const next = discounts[currentStepIndex + 1];
  const targetPoints = next?.target ?? current.target;
  const progressPct = next ? Math.min((points / targetPoints) * 100, 100) : 100;
  const delta = next ? Math.max(targetPoints - points, 0) : 0;
  const isBestOffer = !next;
  const isExpired = countdownSeconds <= 0;
  const time = useMemo(() => formatCountdown(countdownSeconds), [countdownSeconds]);
  const urgent = countdownSeconds < 86400 && countdownSeconds > 0;

  function resetRound() {
    setDiscounts((prevDiscounts) => {
      const nextStart = parseInt(prevDiscounts[0].num) + 5;
      const finalStart = nextStart > 30 ? 15 : nextStart;
      return [
        { num: String(finalStart), value: `${finalStart}% OFF`, target: 0, code: `FC${finalStart}RITUAL` },
        { num: String(finalStart + 5), value: `${finalStart + 5}% OFF`, target: 80, code: `FC${finalStart + 5}RITUAL` },
        { num: String(finalStart + 10), value: `${finalStart + 10}% OFF`, target: 20, code: `FC${finalStart + 10}RITUAL` }
      ];
    });
    setCurrentStepIndex(0);
    setPoints(5);
    setCountdownSeconds(INITIAL_SECONDS);
    setShowReceipt(false);
    setZoomActive(false);
    setZoomPhase('init');
    setZoomCoupon(null);
  }

  useEffect(() => {
    if (countdownSeconds === 0) {
      resetRound();
    }
  }, [countdownSeconds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdownSeconds((value) => Math.max(value - 1, 0));
      setTick((value) => !value);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (tearTimerRef.current) window.clearTimeout(tearTimerRef.current);
  }, []);

function triggerLoginBonusAnimation(pts) {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const card = document.createElement('div');
    card.className = 'login-bonus-card';
    card.innerHTML = `
      <div class="login-bonus-glow"></div>
      <div class="login-bonus-coin">¢</div>
      <div class="login-bonus-value">+${pts}</div>
      <div class="login-bonus-label">Coins</div>
    `;
    viewport.appendChild(card);

    const flyTimer = setTimeout(() => {
      card.classList.add('exiting');

      const cardRect = card.getBoundingClientRect();
      const vpRect = viewport.getBoundingClientRect();
      const startPos = {
        x: cardRect.left - vpRect.left + cardRect.width / 2,
        y: cardRect.bottom - vpRect.top + 8
      };

      flyCoins(
        Math.min(10, Math.max(6, Math.round(pts * 1.5))),
        () => {
          creditPoints(pts);
        },
        startPos
      );
    }, 1200);

    const exitTimer = setTimeout(() => {
      card.remove();
    }, 1900);

    const cleanup = () => {
      clearTimeout(flyTimer);
      clearTimeout(exitTimer);
      if (card.parentElement) card.remove();
    };

    card.addEventListener('animationend', (e) => {
      if (e.animationName === 'login-bonus-exit') {
        cleanup();
      }
    });
  }

  // 登录奖励:loading 收尾(加载层关闭)那一刻,把每次打开发放的 5 金币
  // 飞进余额计数器 —— 复用到账动效(飞币 + “+5” + 计数器滚动)。只发放一次。
  useEffect(() => {
    if (introActive || loginBonusGrantedRef.current) return;
    loginBonusGrantedRef.current = true;
    const timer = window.setTimeout(() => triggerLoginBonusAnimation(INTRO_REWARD_POINTS), 150);
    return () => window.clearTimeout(timer);
  }, [introActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const resize = () => {
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };

    confettiRef.current.ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      if (confettiRef.current.frame) cancelAnimationFrame(confettiRef.current.frame);
    };
  }, []);

  useEffect(() => {
    if (!tapGame.active) return undefined;

    const timer = window.setInterval(() => {
      setTapGame((game) => {
        const nextTime = Math.max(game.timeLeft - 0.05, 0);
        return { ...game, timeLeft: nextTime };
      });
    }, 50);

    return () => window.clearInterval(timer);
  }, [tapGame.active]);

  useEffect(() => {
    if (!tapGame.active || tapGame.timeLeft > 0) return;

    const pointsEarned = Math.min(Math.max(tapGame.taps, 10), 20);
    setTapGame((game) => ({ ...game, active: false }));
    setTimeout(() => {
      setActiveModal(null);
      showNotification(
        'Challenge Completed!',
        `You tapped the target ${tapGame.taps} times and earned +${pointsEarned} pts.`,
        '🎮',
        () => addPoints(pointsEarned)
      );
      setTapGame({ active: false, taps: 0, timeLeft: 5 });
    }, 500);
  }, [tapGame.active, tapGame.timeLeft, tapGame.taps]);

  function showNotification(title, message, icon = '✨', onConfirm = null) {
    setNotification({ title, message, icon, onConfirm });
  }

  function confirmNotification() {
    const onConfirm = notification?.onConfirm;
    setNotification(null);
    if (onConfirm) onConfirm();
  }

  function startConfetti() {
    const canvas = canvasRef.current;
    const ctx = confettiRef.current.ctx;
    if (!canvas || !ctx) return;

    const colors = ['#5c6e58', '#b89855', '#d4dec9', '#ffffff', '#e2dbce', '#ddc483'];
    confettiRef.current.particles = Array.from({ length: 110 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * canvas.height,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    }));

    if (confettiRef.current.frame) cancelAnimationFrame(confettiRef.current.frame);
    drawConfetti();
  }

  function drawConfetti() {
    const canvas = canvasRef.current;
    const ctx = confettiRef.current.ctx;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = 0;

    confettiRef.current.particles.forEach((particle, index) => {
      particle.tiltAngle += particle.tiltAngleIncremental;
      particle.y += (Math.cos(particle.d) + 3 + particle.r / 2) / 2;
      particle.x += Math.sin(particle.tiltAngle);
      particle.tilt = Math.sin(particle.tiltAngle - index / 3) * 15;

      if (particle.y <= canvas.height) {
        active++;
        ctx.beginPath();
        ctx.lineWidth = particle.r;
        ctx.strokeStyle = particle.color;
        ctx.moveTo(particle.x + particle.tilt + particle.r / 2, particle.y);
        ctx.lineTo(particle.x + particle.tilt, particle.y + particle.tilt + particle.r / 2);
        ctx.stroke();
      }
    });

    if (active > 0) {
      confettiRef.current.frame = requestAnimationFrame(drawConfetti);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // 🅑 Landing impact: a shockwave ring + radial sparks at the coupon.
  function spawnImpact(x, y) {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const burst = document.createElement('div');
    burst.className = 'coin-burst';
    burst.style.left = `${x}px`;
    burst.style.top = `${y}px`;
    viewport.appendChild(burst);
    burst.addEventListener('animationend', () => burst.remove());

    if (prefersReducedMotion()) return;

    const sparkCount = 7;
    for (let i = 0; i < sparkCount; i++) {
      const spark = document.createElement('span');
      spark.className = 'coin-spark';
      const angle = (Math.PI * 2 * i) / sparkCount + (Math.random() - 0.5) * 0.5;
      const dist = 24 + Math.random() * 24;
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      spark.style.setProperty('--sx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--sy', `${Math.sin(angle) * dist}px`);
      viewport.appendChild(spark);
      spark.addEventListener('animationend', () => spark.remove());
    }
  }

  // 🅒 "+N" callout that pops at the target coupon and floats up.
  function spawnGainCallout(amount) {
    const viewport = viewportRef.current;
    const target = targetCouponRef.current;
    if (!viewport || !target || !amount) return;

    const vpRect = viewport.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.bottom < vpRect.top || targetRect.top > vpRect.bottom) return;

    const cx = targetRect.left - vpRect.left + targetRect.width * 0.5;
    const cy = targetRect.top - vpRect.top + targetRect.height * 0.4;
    const el = document.createElement('div');
    el.className = 'gain-callout';
    el.innerText = `+${amount}`;
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    viewport.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  // 🅐 Arc coin stream: bigger coins fly a parabola, spin with a glint and a
  // glowing trail, land at high opacity and trigger the impact (🅑).
  function flyCoins(count, done, startPos) {
    const viewport = viewportRef.current;
    const target = targetCouponRef.current;
    if (!viewport || !target) {
      done();
      return;
    }

    const vpRect = viewport.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.bottom < vpRect.top || targetRect.top > vpRect.bottom) {
      done();
      return;
    }

    const startX = startPos ? startPos.x : vpRect.width / 2;
    const startY = startPos ? startPos.y : vpRect.height * 0.8;
    const endX = targetRect.left - vpRect.left + targetRect.width * 0.5;
    const endY = targetRect.top - vpRect.top + targetRect.height * 0.5;
    const reduce = prefersReducedMotion();

    let landed = 0;
    const finishOne = () => {
      landed += 1;
      if (landed >= count) done();
    };

    for (let i = 0; i < count; i++) {
      const coin = document.createElement('div');
      coin.className = 'fly-coin';
      coin.innerText = '¢';

      const sx = startX + (Math.random() - 0.5) * 56;
      const sy = startY + (Math.random() - 0.5) * 22;
      const ex = endX + (Math.random() - 0.5) * 26;
      const ey = endY + (Math.random() - 0.5) * 20;
      coin.style.left = `${sx - 15}px`;
      coin.style.top = `${sy - 15}px`;
      viewport.appendChild(coin);

      const midX = (sx + ex) / 2 + (Math.random() - 0.5) * 44;
      const apexY = Math.min(sy, ey) - (88 + Math.random() * 64);
      const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 260);
      const duration = reduce ? 340 : 600 + Math.random() * 180;
      const delay = i * (reduce ? 24 : 58);

      const anim = coin.animate(
        [
          { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1, offset: 0 },
          {
            transform: `translate(${midX - sx}px, ${apexY - sy}px) rotate(${spin * 0.5}deg) scale(1.14)`,
            opacity: 1,
            offset: 0.5
          },
          {
            transform: `translate(${ex - sx}px, ${ey - sy}px) rotate(${spin}deg) scale(0.62)`,
            opacity: 1,
            offset: 1
          }
        ],
        { duration, delay, easing: 'cubic-bezier(0.42, 0, 0.58, 1)', fill: 'forwards' }
      );

      anim.onfinish = () => {
        coin.remove();
        spawnImpact(endX, endY);
        setTargetPulse('absorb');
        window.setTimeout(() => setTargetPulse(''), 360);
        finishOne();
      };
    }
  }

  function addPoints(pts) {
    if (!next) return;

    spawnGainCallout(pts);
    flyCoins(Math.min(12, Math.max(8, Math.round(pts / 2))), () => {
      creditPoints(pts);
    });
  }

  // 🅓 Roll the points counter up to the new total (instead of a hard jump),
  // highlighting the counter while it credits; celebrate once at the end.
  function creditPoints(pts) {
    if (!pts) return;
    if (pointsTweenRef.current) {
      cancelAnimationFrame(pointsTweenRef.current);
      pointsTweenRef.current = null;
    }

    const from = points;
    const to = from + pts;

    if (prefersReducedMotion()) {
      setPoints(to);
      if (to >= targetPoints) triggerCelebration(to);
      return;
    }

    setCrediting(true);
    const duration = 600;
    const startedAt = performance.now();
    const step = (now) => {
      const t = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setPoints(Math.round(from + (to - from) * eased));
      if (t < 1) {
        pointsTweenRef.current = requestAnimationFrame(step);
      } else {
        pointsTweenRef.current = null;
        setPoints(to);
        setCrediting(false);
        if (to >= targetPoints) triggerCelebration(to);
      }
    };
    pointsTweenRef.current = requestAnimationFrame(step);
  }

  function triggerCelebration(updatedPoints) {
    setTargetPulse('ready unlocking');
    startConfetti();

    // Show receipt immediately — confetti falls on top of the printer overlay
    setReceiptColors(readCouponTokens(targetCouponRef.current));
    setPendingPoints(updatedPoints);
    setShowReceipt(true);
    setTargetPulse('');
  }

  function handleUseReceiptCoupon() {
    const nextCoupon = discounts[currentStepIndex + 1];
    const targetPointsVal = nextCoupon?.target ?? 90;
    setCurrentStepIndex((index) => index + 1);
    setPoints(Math.max(pendingPoints - targetPointsVal, 0));
    setShowReceipt(false);
    
    // Stop confetti when opening zoom card from receipt
    if (confettiRef.current.frame) {
      cancelAnimationFrame(confettiRef.current.frame);
      confettiRef.current.frame = null;
    }
    const confCanvas = canvasRef.current;
    const confCtx = confettiRef.current.ctx;
    if (confCanvas && confCtx) {
      confCtx.clearRect(0, 0, confCanvas.width, confCanvas.height);
    }

    // Open zoom card directly in flipped state (centered)
    setZoomCoupon(nextCoupon || current);
    setZoomColors(readCouponTokens(targetCouponRef.current));
    setZoomCopyState('Copy');
    const viewport = viewportRef.current;
    if (viewport) {
      const vpRect = viewport.getBoundingClientRect();
      const cardW = Math.min(vpRect.width * 0.82, 320);
      const cardH = cardW * 1.58;
      setZoomRect({
        left: vpRect.left + (vpRect.width - cardW) / 2,
        top: vpRect.top + (vpRect.height - cardH) / 2,
        width: cardW,
        height: cardH
      });
    }
    setZoomPhase('flipped');
    setZoomActive(true);
  }

  function handleAccumulateMore() {
    const targetPointsVal = discounts[currentStepIndex + 1]?.target ?? 90;
    setCurrentStepIndex((index) => index + 1);
    setPoints(Math.max(pendingPoints - targetPointsVal, 0));
    setShowReceipt(false);
    
    // Trigger swap animation on both coupons to signify cards have changed
    setCurrentSwap(true);
    setTimeout(() => setCurrentSwap(false), 800);
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopyState('Copied!');
      setTimeout(() => setCopyState('Copy'), 2000);
    } catch {
      showNotification('Copy Failed', `We couldn't copy it automatically. Please copy manually: ${current.code}`, '⚠️');
    }
  }

  async function ensureCouponReadyForUse() {
    if (current?.code) return current.code;
    if (!rewardPlanId) throw new Error('Reward plan is not ready yet');
    setRedeemingCoupon(true);
    try {
      const issued = await redeemCoupon({ rewardPlanId, touchId });
      const code = issued?.couponCode;
      if (!code) throw new Error('No coupon code returned');
      setDiscounts((prev) =>
        prev.map((item, idx) =>
          idx === currentStepIndex
            ? { ...item, code }
            : item
        )
      );
      await reloadPlan();
      return code;
    } finally {
      setRedeemingCoupon(false);
    }
  }

  function handleShopNow() {
    // 第一原则:交互即时反馈,去掉假延迟,点击立刻给出反馈。
    setShopLoading(true);
    const shopUrl = brand.shopUrl || '#';
    showNotification('Ready to use', 'Your coupon is ready. Opening the shop with your code!', '🛍️', () => {
      setShopLoading(false);
      setDrawerOpen(false);
      if (shopUrl && shopUrl !== '#') window.open(shopUrl, '_blank', 'noopener,noreferrer');
    });
  }

  async function handleSettlementComplete(settlement) {
    dbg('[FCDBG][App] settlement received', settlement);
    clearGameSessionCache();
    setActiveModal(null);
    setGameStart(null);
    const pts = settlement.pointsAwarded ?? 0;
    showNotification(
      'Challenge Completed!',
      pts > 0 ? `You earned +${pts} pts.` : 'Challenge completed for today.',
      '🎮',
      () => {
        // 第一原则:动效不等接口。先用结算结果立即给出庆祝反馈,
        // 真实 plan 在后台静默同步;失败只降级提示,不打断动效。
        if (settlement.couponWon) {
          setReceiptColors(readCouponTokens(targetCouponRef.current));
          setShowReceipt(true);
          startConfetti();
        } else if (pts > 0) {
          spawnGainCallout(pts);
          flyCoins(Math.min(12, Math.max(8, Math.round(pts / 2))), () => {});
        }

        // 后台静默校正:重新拉取 plan,与服务端对齐(失败仅降级提示)。
        reloadPlan().catch((err) => {
          dbgError('[FCDBG][App] background reloadPlan failed', err);
          setPlanError(err instanceof Error ? err.message : 'Could not refresh rewards');
        });
      }
    );
  }

  async function handleUseCoupon() {
    if (isExpired || isTearingCoupon || redeemingCoupon) return;
    if (isBestOffer) {
      try {
        await ensureCouponReadyForUse();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not issue coupon';
        showNotification('Coupon unavailable', msg, '⚠️');
        return;
      }
      const faceEl = couponFaceRef.current;
      const viewport = viewportRef.current;
      if (faceEl && viewport) {
        const faceRect = faceEl.getBoundingClientRect();
        setZoomRect({
          left: faceRect.left,
          top: faceRect.top,
          width: faceRect.width,
          height: faceRect.height
        });
        setZoomCoupon(current);
        setZoomColors(readCouponTokens(faceEl.closest('.coupon')));
        setZoomCopyState('Copy');
        setZoomPhase('init');
        setZoomActive(true);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const vpRect = viewport.getBoundingClientRect();
            const cardW = Math.min(vpRect.width * 0.82, 320);
            const cardH = cardW * 1.58;
            setZoomRect({
              left: vpRect.left + (vpRect.width - cardW) / 2,
              top: vpRect.top + (vpRect.height - cardH) / 2,
              width: cardW,
              height: cardH
            });
            setZoomPhase('flipped');
          });
        });
      } else {
        setDrawerOpen(true);
      }
      return;
    }
    setIsTearingCoupon(true);
  }

  const handleUseWelcomeCoupon = useCallback(() => {
    setWelcomeStep(3);
    localStorage.setItem('fc_welcome_completed', 'true');
    
    // Immediately start the points counter tweening from 0 to welcomeTargetPoints
    const from = 0;
    const to = welcomeTargetPoints;
    const duration = 1200;
    const startedAt = performance.now();
    const step = (now) => {
      const t = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setPoints(Math.round(from + (to - from) * eased));
      if (t < 1) {
        pointsTweenRef.current = requestAnimationFrame(step);
      } else {
        pointsTweenRef.current = null;
        setPoints(to);
      }
    };
    pointsTweenRef.current = requestAnimationFrame(step);

    // Zoom-and-flip card transition centered and flipped
    setZoomCoupon(current);
    const faceEl = couponFaceRef.current;
    if (faceEl) {
      setZoomColors(readCouponTokens(faceEl.closest('.coupon')));
    } else {
      setZoomColors({
        main: '#F6E7C8',
        accent: '#A8783B',
        ink: '#6E4E23',
        gradient: 'linear-gradient(160deg, #FAF4E8 0%, #F6E7C8 52%, #CABCA0 100%)'
      });
    }
    setZoomCopyState('Copy');
    
    const viewport = viewportRef.current;
    if (viewport) {
      const vpRect = viewport.getBoundingClientRect();
      const cardW = Math.min(vpRect.width * 0.82, 320);
      const cardH = cardW * 1.58;
      setZoomRect({
        left: vpRect.left + (vpRect.width - cardW) / 2,
        top: vpRect.top + (vpRect.height - cardH) / 2,
        width: cardW,
        height: cardH
      });
    }
    setZoomPhase('flipped');
    setZoomActive(true);
  }, [current, welcomeTargetPoints]);

  function handleTearComplete() {
    // Get bounding rect of the coupon face (the card body above the torn button)
    const faceEl = couponFaceRef.current;
    const viewport = viewportRef.current;
    if (faceEl && viewport) {
      const faceRect = faceEl.getBoundingClientRect();
      setZoomRect({
        left: faceRect.left,
        top: faceRect.top,
        width: faceRect.width,
        height: faceRect.height
      });
      setZoomCoupon(current);
      setZoomColors(readCouponTokens(faceEl.closest('.coupon')));
      setZoomCopyState('Copy');
      setZoomPhase('init');
      setZoomActive(true);

      // Animate: init -> zoomed -> flipped
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const vpRect = viewport.getBoundingClientRect();
          const cardW = Math.min(vpRect.width * 0.82, 320);
          const cardH = cardW * 1.58;
          setZoomRect({
            left: vpRect.left + (vpRect.width - cardW) / 2,
            top: vpRect.top + (vpRect.height - cardH) / 2,
            width: cardW,
            height: cardH
          });
          setZoomPhase('zoomed');

          setTimeout(() => {
            setZoomPhase('flipped');
          }, 580);
        });
      });
    } else {
      // Fallback: just open drawer
      setDrawerOpen(true);
    }
  }

  function handleZoomClose() {
    // Flip back first
    setZoomPhase('zoomed');

    setTimeout(() => {
      // Zoom out to original position
      const faceEl = couponFaceRef.current;
      if (faceEl) {
        const faceRect = faceEl.getBoundingClientRect();
        setZoomRect({
          left: faceRect.left,
          top: faceRect.top,
          width: faceRect.width,
          height: faceRect.height
        });
      }
      setZoomPhase('init');

      setTimeout(() => {
        setZoomActive(false);
        setIsTearingCoupon(false);
      }, 550);
    }, 700);
  }

  function handleZoomCopy() {
    const code = zoomCoupon?.code || current.code;
    copyText(code).then(() => {
      setZoomCopyState('Copied!');
      setTimeout(() => setZoomCopyState('Copy'), 2000);
    }).catch(() => {
      showNotification('Copy Failed', `We couldn't copy it automatically. Please copy manually: ${code}`, '⚠️');
    });
  }

  function closeCouponDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setIsTearingCoupon(false), 260);
  }

  async function openChallenge(challenge) {
    dbg('[FCDBG][App] openChallenge', challenge);
    if (challenge.type === 'survey' || challenge.id === 'survey') {
      setActiveModal('survey');
      setSurveyStep(0);
      setSurveyAnswers([]);
      return;
    }

    if (!rewardPlanId) {
      showNotification('Not ready', 'Rewards are still loading. Please try again.', '⚠️');
      return;
    }

    const requestToken = activeGameRequestRef.current + 1;
    activeGameRequestRef.current = requestToken;
    setGameModalTitle(challenge.title);
    setActiveModal('platform-game');
    setGameStart(null);
    setGameLoadingMessage('Loading game…');

    try {
      const key = `${rewardPlanId}:${challenge.gameInstanceId}`;
      const preloaded = preloadedGameStartsRef.current.get(key);
      if (preloaded) {
        dbg('[FCDBG][App] using preloaded game start', {
          key,
          sessionId: preloaded.sessionId,
          templateKey: preloaded.templateKey,
        });
        setGameStart(preloaded);
        setGameLoadingMessage('');
        return;
      }

      setGameLoadingMessage('Finishing game setup…');
      const start = await (preloadingGameStartsRef.current.get(key) ?? preloadGameStart(challenge));
      if (activeGameRequestRef.current === requestToken) {
        dbg('[FCDBG][App] game start ready for modal', {
          key,
          sessionId: start.sessionId,
          templateKey: start.templateKey,
          runtimeComponent: start.runtimeComponent,
        });
        setGameStart(start);
        setGameLoadingMessage('');
      }
    } catch (err) {
      if (activeGameRequestRef.current !== requestToken) return;
      setActiveModal(null);
      setGameStart(null);
      showNotification('Game unavailable', err instanceof Error ? err.message : 'Could not start game', '⚠️');
    }
  }

  function startTapGame() {
    setTapGame({ active: true, taps: 0, timeLeft: 5 });
  }

  function startMemoryGame() {
    setMemoryGame({
      active: true,
      values: shuffle(['🍋', '🍇', '🍋', '🍇']),
      flipped: [],
      matched: []
    });
  }

  function handleMemoryCard(index) {
    setMemoryGame((game) => {
      if (!game.active || game.flipped.includes(index) || game.matched.includes(index) || game.flipped.length >= 2) return game;
      const flipped = [...game.flipped, index];

      if (flipped.length === 2) {
        const [first, second] = flipped;
        const isMatch = game.values[first] === game.values[second];
        window.setTimeout(() => {
          setMemoryGame((currentGame) => {
            const matched = isMatch ? [...currentGame.matched, first, second] : currentGame.matched;
            const complete = matched.length === 4;
            if (complete) {
              window.setTimeout(() => {
                setActiveModal(null);
                showNotification('Memory Match Completed!', 'Excellent memory! You matched all pairs and earned +15 pts.', '🃏', () => addPoints(15));
              }, 350);
            }
            return { ...currentGame, active: !complete, flipped: [], matched };
          });
        }, 800);
      }

      return { ...game, flipped };
    });
  }

  function startSpinGame() {
    if (spinActive) return;
    setSpinActive(true);
    const randomSector = Math.floor(Math.random() * 4);
    const rewards = [
      { pts: 5, label: '+5 pts' },
      { pts: 10, label: '+10 pts' },
      { pts: 15, label: '+15 pts' },
      { pts: 8, label: '+8 pts' }
    ];
    const reward = rewards[randomSector];
    setSpinRotation(1440 + randomSector * 90);

    setTimeout(() => {
      setActiveModal(null);
      setSpinRotation(0);
      setSpinActive(false);
      showNotification('Lucky Spin Winner!', `The wheel stopped on ${reward.label}. Points added to your locked coupon!`, '🎡', () => addPoints(reward.pts));
    }, 3200);
  }

  async function handleSurveyOption(option) {
    const nextAnswers = [...surveyAnswers, { questionId: String(surveyStep + 1), value: option }];
    setSurveyAnswers(nextAnswers);

    if (surveyStep < SURVEY_STEPS.length - 1) {
      setSurveyStep((step) => step + 1);
      return;
    }

    // 第一原则:动效不等接口。问卷全部答完后立即关闭弹窗,并像游戏一样
    // 弹出「获得金币」动效;completeSurvey 仅在后台静默同步,失败只记录日志,
    // 不打断动效、不弹错误提示。
    setActiveModal(null);
    setSurveyStep(0);
    setSurveyAnswers([]);

    const surveyReward = 10;
    showNotification(
      'Survey Completed!',
      `Thanks for sharing — you earned +${surveyReward} pts.`,
      '📝',
      () => addPoints(surveyReward)
    );

    completeSurvey(touchId, rewardPlanId, nextAnswers).catch((err) => {
      dbgError('[FCDBG][App] background completeSurvey failed', err);
    });
  }

  return (
    <div
      className="mobile-viewport"
      data-screen-label="优惠券首页"
      ref={viewportRef}
      style={brand.primaryColor ? { '--brand-primary': brand.primaryColor } : undefined}
    >
      <canvas id="confetti-canvas" ref={canvasRef} />
      {introActive && (
        <BrandIntro 
          onComplete={closeIntro} 
          brand={brand} 
          isWelcome={welcomeStep < 3}
          onOpenPackage={() => {
            setWelcomeStep(1);
            setIntroActive(false);
          }}
        />
      )}

      <Header brand={brand} />
      {(planLoading || planError) && (
        <div className={`reward-sync-status ${planError ? 'error' : ''}`} role="status">
          {planError ? 'Using saved rewards. Refresh failed.' : 'Refreshing rewards…'}
        </div>
      )}

      <main className="content-area">
        {isBestOffer ? (
          <BestCouponLockedPage
            coupon={current}
            time={time}
            tick={tick}
            countdownSeconds={countdownSeconds}
            isExpired={isExpired}
            couponFaceRef={couponFaceRef}
            onUse={handleUseCoupon}
          />
        ) : (
          <>
            <UrgencyBanner
              isExpired={isExpired}
              time={time}
              tick={tick}
              urgent={urgent}
              isBestOffer={isBestOffer}
            />

            <CouponWallet
              current={current}
              next={next}
              delta={delta}
              progressPct={progressPct}
              points={points}
              targetPoints={targetPoints}
              crediting={crediting}
              time={time}
              isBestOffer={isBestOffer}
              isExpired={isExpired}
              targetPulse={targetPulse}
              currentSwap={currentSwap}
              isTearingCoupon={isTearingCoupon}
              targetCouponRef={targetCouponRef}
              couponFaceRef={couponFaceRef}
              onUse={handleUseCoupon}
              onTearComplete={handleTearComplete}
              countdownSeconds={countdownSeconds}
            />

            <Challenges challenges={challenges} dailyCapReached={dailyCapReached} onOpen={openChallenge} />
            <RulesFooter rulesOpen={rulesOpen} onToggle={() => setRulesOpen((value) => !value)} />
          </>
        )}
      </main>

      <CouponDrawer
        open={drawerOpen}
        current={current}
        time={time}
        copyState={copyState}
        shopLoading={shopLoading}
        onClose={closeCouponDrawer}
        onCopy={handleCopyCode}
        onShop={handleShopNow}
      />

      <PlatformGameModal
        open={activeModal === 'platform-game'}
        title={gameModalTitle}
        gameStart={gameStart}
        loadingMessage={gameLoadingMessage}
        onClose={() => {
          activeGameRequestRef.current += 1;
          clearGameSessionCache();
          setActiveModal(null);
          setGameStart(null);
        }}
        onDone={handleSettlementComplete}
        onError={(message) => showNotification('Game error', message, '⚠️')}
      />

      <SurveyModal
        open={activeModal === 'survey'}
        step={surveyStep}
        onClose={() => setActiveModal(null)}
        onOption={handleSurveyOption}
      />

      <NotificationModal notification={notification} onConfirm={confirmNotification} />

      {showReceipt && (
        <ReceiptPrinter
          unlockedCoupon={discounts[currentStepIndex + 1]}
          colors={receiptColors}
          onUse={handleUseReceiptCoupon}
          onAccumulate={handleAccumulateMore}
        />
      )}

      {zoomActive && (
        <ZoomFlipCard
          coupon={zoomCoupon || current}
          colors={zoomColors}
          rect={zoomRect}
          phase={zoomPhase}
          isBestOffer={isBestOffer}
          copyState={zoomCopyState}
          onClose={handleZoomClose}
          onCopy={handleZoomCopy}
        />
      )}

      {welcomeStep < 3 && !introActive && (
        <WelcomeRitual
          step={welcomeStep}
          coupon={current}
          brand={brand}
          couponFaceRef={couponFaceRef}
          onAdvanceToSettle={() => {
            setWelcomeStep(2);
          }}
          onUse={handleUseWelcomeCoupon}
          onComplete={() => {
            setWelcomeStep(3);
            localStorage.setItem('fc_welcome_completed', 'true');
            // Immediately start the points counter tweening from 0 to welcomeTargetPoints
            const from = 0;
            const to = welcomeTargetPoints;
            const duration = 1200;
            const startedAt = performance.now();
            const step = (now) => {
              const t = Math.min((now - startedAt) / duration, 1);
              const eased = 1 - Math.pow(1 - t, 3);
              setPoints(Math.round(from + (to - from) * eased));
              if (t < 1) {
                pointsTweenRef.current = requestAnimationFrame(step);
              } else {
                pointsTweenRef.current = null;
                setPoints(to);
              }
            };
            pointsTweenRef.current = requestAnimationFrame(step);
          }}
        />
      )}
    </div>
  );
}

function BrandMark({ className = 'brand-logo' }) {
  return (
    <svg className={className} viewBox="0 0 40 40" role="img" aria-label="Ritual logo">
      <defs>
        <linearGradient id="ritualMark" x1="7" y1="5" x2="33" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#72866b" />
          <stop offset="0.52" stopColor="#32422d" />
          <stop offset="1" stopColor="#182316" />
        </linearGradient>
        <linearGradient id="ritualLeaf" x1="13" y1="10" x2="29" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f4df9f" />
          <stop offset="1" stopColor="#b98b3e" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#ritualMark)" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="#f1e2b4" strokeOpacity="0.38" strokeWidth="1.2" />
      <path d="M15.3 12.4c8.1.2 13.2 5.4 13.4 13.5-8-.2-13.2-5.4-13.4-13.5Z" fill="url(#ritualLeaf)" />
      <path d="M25.6 15.2c-3.6 2.6-6.1 6-7.6 10.3" fill="none" stroke="#fff4ce" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M13.2 28.4h13.6" stroke="#f1e2b4" strokeWidth="1.45" strokeLinecap="round" />
      <text x="20" y="24.8" textAnchor="middle" className="brand-logo-letter">R</text>
    </svg>
  );
}

function WelcomeRitual({ step, coupon, brand, couponFaceRef, onAdvanceToSettle, onUse, onComplete }) {
  const [rect, setRect] = useState(() => {
    if (typeof window !== 'undefined') {
      const wWidth = window.innerWidth;
      const wHeight = window.innerHeight;
      const startW = 40;
      const startH = startW * 1.58;
      return {
        left: wWidth / 2 - startW / 2,
        top: wHeight / 2 - startH / 2,
        width: startW,
        height: startH
      };
    }
    return null;
  });
  const [phase, setPhase] = useState('activation');
  const [colors, setColors] = useState({
    main: '#F6E7C8',
    accent: '#A8783B',
    ink: '#6E4E23',
    gradient: 'linear-gradient(160deg, #FAF4E8 0%, #F6E7C8 52%, #CABCA0 100%)'
  });

  useEffect(() => {
    const wWidth = window.innerWidth;
    const wHeight = window.innerHeight;
    const cardW = Math.min(wWidth * 0.82, 320);
    const cardH = cardW * 1.58;

    // Small delay to let browser paint the initial small rect at the box's position
    const timer = setTimeout(() => {
      setRect({
        left: (wWidth - cardW) / 2,
        top: (wHeight - cardH) / 2 - 20,
        width: cardW,
        height: cardH
      });
    }, 50);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const faceEl = couponFaceRef.current;
    if (faceEl) {
      const tokens = readCouponTokens(faceEl.closest('.coupon'));
      if (tokens && tokens.gradient) {
        setColors(tokens);
      }
    }
  }, [couponFaceRef, coupon]);

  useEffect(() => {
    if (step === 2) {
      setPhase('settling');
      const faceEl = couponFaceRef.current;
      if (faceEl) {
        const faceRect = faceEl.getBoundingClientRect();
        setRect({
          left: faceRect.left,
          top: faceRect.top,
          width: faceRect.width,
          height: faceRect.height
        });
      }
      
      const timer = setTimeout(onComplete, 800);
      return () => clearTimeout(timer);
    }
  }, [step, couponFaceRef, onComplete]);

  return (
    <>
      <div className={`welcome-backdrop ${phase}`} />
      <div 
        className={`welcome-coupon-container zoom-card-container ${phase}`}
        style={{
          left: rect ? `${rect.left}px` : '50%',
          top: rect ? `${rect.top}px` : '50%',
          width: rect ? `${rect.width}px` : '320px',
          height: rect ? `${rect.height}px` : '505px',
          ...couponColorVars(colors)
        }}
      >
        <div className="zoom-card-inner">
          <div className="zoom-card-front welcome-card-variant">
            {brand?.name && (
              <div className="welcome-card-brand">
                {brand?.logoUrl ? (
                  <img className="welcome-card-brand-logo" src={brand.logoUrl} alt={`${brand.name} logo`} />
                ) : null}
                <span className="welcome-card-brand-name">{brand.name}</span>
              </div>
            )}
            <span className="welcome-card-emoji">🎉</span>
            <h2 className="welcome-card-title">Exclusive Discount Activated!</h2>
            <div className="welcome-card-value">
              {coupon.num}<small>%</small> <span className="welcome-card-off">OFF</span>
            </div>
            <span className="welcome-card-claimed">Claimed & Ready!</span>
          </div>
        </div>
      </div>
      
      {phase === 'activation' && (
        <div className="welcome-activation-content">
          <div 
            className="welcome-activation-footer" 
            style={{ 
              position: 'absolute',
              top: rect ? `${rect.top + rect.height + 20}px` : 'auto',
              left: 0,
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'auto'
            }}
          >
            <div className="welcome-buttons" style={{ pointerEvents: 'auto' }}>
              <button 
                className="btn-printer-primary" 
                onClick={(e) => {
                  e.stopPropagation();
                  onUse();
                }}
              >
                Use Now
              </button>
              <button 
                className="btn-printer-secondary" 
                onClick={(e) => {
                  e.stopPropagation();
                  onAdvanceToSettle();
                }}
              >
                Earn More Rewards
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BrandIntro({ onComplete, brand, isWelcome, onOpenPackage }) {
  const target = brand?.name ?? '';
  const [exiting, setExiting] = useState(false);
  const [settled, setSettled] = useState(false);
  const [unboxed, setUnboxed] = useState(false);

  useEffect(() => {
    if (isWelcome) {
      // For welcome, wait for package to drop and settle (takes about 2.5s)
      const settleTimer = window.setTimeout(() => setSettled(true), 2500);
      return () => window.clearTimeout(settleTimer);
    } else {
      // Standard auto-play intro
      const exit = window.setTimeout(() => setExiting(true), 8000);
      const complete = window.setTimeout(onComplete, 8800);
      return () => {
        window.clearTimeout(exit);
        window.clearTimeout(complete);
      };
    }
  }, [onComplete, target, isWelcome]);

  const handleOpen = () => {
    if (!settled || unboxed) return;
    setUnboxed(true);
    if (navigator.vibrate) {
      navigator.vibrate(60);
    }
    if (onOpenPackage) {
      onOpenPackage();
    }
  };

  return (
    <section className={`brand-intro ${exiting ? 'exiting' : ''} ${isWelcome ? 'interactive' : ''} ${unboxed ? 'unboxed' : ''}`} aria-label={`${target} intro`}>
      {isWelcome && target && (
        <div className="welcome-brand-header">
          {brand?.logoUrl ? (
            <img className="welcome-brand-logo" src={brand.logoUrl} alt={`${target} logo`} />
          ) : null}
          {target && <span className="welcome-brand-name">{target}</span>}
        </div>
      )}
      {isWelcome && !target && null}
      <div className="intro-stage" aria-hidden="true" onClick={isWelcome ? handleOpen : undefined}>
        <div className="intro-glow" />
        <div className="intro-rays" />

        <svg className="intro-package" viewBox="0 0 180 150">
          {isWelcome ? (
            /* Premium Closed Gift Box for Welcome Flow */
            <g className="closed-gift-box">
              {/* Box Base Left Face */}
              <path 
                d="M46 70 L90 92 L90 136 L46 114 Z" 
                style={{ fill: '#EADBBF', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              {/* Box Base Right Face */}
              <path 
                d="M90 92 L134 70 L134 114 L90 136 Z" 
                style={{ fill: '#DBCBB0', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              
              {/* Box Base Left vertical ribbon */}
              <path 
                d="M62 78 L62 122 L74 128 L74 84 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              {/* Box Base Right vertical ribbon */}
              <path 
                d="M106 84 L106 128 L118 122 L118 78 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />

              {/* Lid Left lip */}
              <path 
                d="M42 60 L90 82 L90 92 L42 70 Z" 
                style={{ fill: '#F6E7C8', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              {/* Lid Right lip */}
              <path 
                d="M90 82 L138 60 L138 70 L90 92 Z" 
                style={{ fill: '#EADBBF', stroke: '#b8892e', strokeWidth: '2px' }} 
              />

              {/* Lid Left lip ribbon */}
              <path 
                d="M60 69 L60 79 L72 85 L72 75 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              {/* Lid Right lip ribbon */}
              <path 
                d="M108 74 L108 84 L120 78 L120 68 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />

              {/* Lid Top Face */}
              <path 
                d="M42 60 L90 38 L138 60 L90 82 Z" 
                style={{ fill: '#FDF6ED', stroke: '#b8892e', strokeWidth: '2px' }} 
              />

              {/* Lid Top crossing ribbons */}
              <path 
                d="M60 69 L108 46 L120 52 L72 75 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              <path 
                d="M60 52 L108 74 L120 68 L72 46 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />

              {/* Ribbon Bow Loops */}
              <path 
                d="M90 60 C70 40 60 50 90 60 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              <path 
                d="M90 60 C110 40 120 50 90 60 Z" 
                style={{ fill: '#f0cc82', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              
              {/* Bow tails */}
              <path 
                d="M90 60 Q75 80 70 95" 
                style={{ fill: 'none', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
              <path 
                d="M90 60 Q105 80 110 95" 
                style={{ fill: 'none', stroke: '#b8892e', strokeWidth: '2px' }} 
              />

              {/* Knot */}
              <circle 
                cx="90" 
                cy="60" 
                r="6" 
                style={{ fill: '#b8892e', stroke: '#b8892e', strokeWidth: '2px' }} 
              />
            </g>
          ) : (
            /* Original Express Cardboard Box for Normal Loading */
            <>
              <g className="package-box">
                <path d="M42 64 90 42l48 22v54l-48 22-48-22Z" />
                <path d="M42 64 90 86l48-22M90 86v54" />
                <path d="M69 54v28l16-8 16 8V54" />
                <path d="M54 104h18v12H54ZM117 105h15v11h-15Z" />
              </g>
              <g className="package-lid lid-left">
                <path d="M42 63 90 41l-12-21-50 22Z" />
                <path d="M42 63 78 79" />
              </g>
              <g className="package-lid lid-right">
                <path d="M90 41 138 63l14-22-50-21Z" />
                <path d="M102 79 138 63" />
              </g>
            </>
          )}
        </svg>

        {(!isWelcome || unboxed) && (
          <>
            <svg className="intro-ticket" viewBox="0 0 160 106">
              <path d="M18 28 Q18 17 29 17 H61 Q64 28 80 28 Q96 28 99 17 H131 Q142 17 142 28 V43 Q128 46 128 53 Q128 60 142 63 V78 Q142 89 131 89 H99 Q96 78 80 78 Q64 78 61 89 H29 Q18 89 18 78 V63 Q32 60 32 53 Q32 46 18 43Z" />
              <path className="ticket-dash" d="M50 23v60M110 23v60" />
              <text x="80" y="69" textAnchor="middle">%</text>
            </svg>

            <div className="intro-orbit">
              {[0, 1, 2, 3, 4, 5].map((coin) => (
                <span className="intro-coin" style={{ '--coin': coin }} key={coin}>¢</span>
              ))}
            </div>
          </>
        )}

        {!isWelcome && target && (
          <div className="intro-final-logo">
            {brand?.logoUrl ? (
              <img className="intro-final-mark" src={brand.logoUrl} alt={`${target} logo`} />
            ) : null}
            <span>{target}</span>
            <i />
          </div>
        )}
        {isWelcome && settled && !unboxed && (
          <div className="welcome-box-pulse" onClick={handleOpen}>
            <span className="pulse-text">🎁 Click to Reveal Exclusive Discount</span>
          </div>
        )}
      </div>
    </section>
  );
}

function HeaderBase({ brand }) {
  return (
    <header className="brand-header">
      <div className="brand-info">
        {brand?.logoUrl ? (
          <img className="brand-logo-img" src={brand.logoUrl} alt={`${brand.name} logo`} />
        ) : null}
        {brand?.name && <span className="brand-name">{brand.name}</span>}
      </div>
    </header>
  );
}

function UrgencyBanner({ isExpired, time, tick, urgent, isBestOffer }) {
  return (
    <section className={`urgency-banner ${urgent ? 'urgent' : ''}`} data-screen-label="倒计时">
      <div className="ub-label">
        <span className="live-pulse" />
        <span>{isExpired ? 'This round has ended' : urgent ? "Ends today - don't lose it" : 'Limited offer ends in'}</span>
      </div>
      <div className="clock">
        {['Days', 'Hours', 'Min', 'Sec'].map((label, index) => (
          <ClockUnit key={label} label={label} value={time.digits[index]} tick={index === 3 && tick} isLast={index === 3} />
        ))}
      </div>
      {isBestOffer && (
        <p className="ub-round-note">倒计时结束后，新的折扣挑战开始</p>
      )}
    </section>
  );
}

function ClockUnit({ label, value, tick, isLast }) {
  return (
    <>
      <div className="clock-unit">
        <span className={`digit ${tick ? 'tick' : ''}`}>{value}</span>
        <span className="unit-label">{label}</span>
      </div>
      {!isLast && <span className="clock-colon">:</span>}
    </>
  );
}

function BestCouponLockedPage({ coupon, time, tick, isExpired, couponFaceRef, onUse }) {
  return (
    <section className="best-locked-page" data-screen-label="最佳优惠券">
      <div className="best-locked-copy">
        <span className="best-locked-eyebrow">Best Coupon Locked</span>
        <h1>Best Coupon Locked</h1>
      </div>

      <div className="best-locked-coupon" data-coupon-theme="dtc">
        <div className="coupon coupon-current best-locked-ticket" data-tier={tierForDiscount(coupon.num)}>
          <div className="coupon-face" ref={couponFaceRef}>
            <span className="coupon-kicker">Your Best Coupon</span>
            <span className="stub-value">{coupon.num}<small>%</small></span>
            <span className="stub-off">OFF</span>
          </div>
        </div>
      </div>

      <div className="best-locked-countdown">
        <span>Expires in</span>
        <div className="best-locked-clock" aria-label={`${time.days} days ${time.hours} hours ${time.mins} minutes ${time.secs} seconds`}>
          {['Days', 'Hours', 'Min', 'Sec'].map((label, index) => (
            <ClockUnit key={label} label={label} value={time.digits[index]} tick={index === 3 && tick} isLast={index === 3} />
          ))}
        </div>
      </div>

      <button className="best-locked-cta" id="use-now-btn" type="button" disabled={isExpired} onClick={onUse}>
        Use Coupon Now
      </button>

      <p className="best-locked-footnote">A new challenge will start automatically when the timer ends.</p>
    </section>
  );
}

function CouponWallet({
  current,
  next,
  delta,
  progressPct,
  points,
  targetPoints,
  crediting,
  time,
  isBestOffer,
  isExpired,
  targetPulse,
  currentSwap,
  isTearingCoupon,
  targetCouponRef,
  couponFaceRef,
  onUse,
  onTearComplete,
  countdownSeconds
}) {
  return (
    <section className={`wallet ${isBestOffer ? 'best-offer' : ''}`} data-screen-label="优惠券">
      <div className="section-head">
        <span className="section-tag">{isBestOffer ? 'Best offer unlocked' : 'Your coupon'}</span>
      </div>

      {isBestOffer && (
        <div className="best-offer-note">
          <span>Exclusive reward unlocked</span>
          <p>恭喜您，您已获得本轮最低折扣。专属礼遇已为您保留，快去购物吧！</p>
        </div>
      )}

      {!isBestOffer && (
        <div className="coupon-route" aria-hidden="true">
          <div className="route-arc-container">
            <svg className="route-arc" viewBox="0 0 178 70" preserveAspectRatio="none">
              <path className="route-arc-shadow" d="M8 58 C52 2 124 2 170 58" />
              <path className="route-arc-line" d="M8 58 C52 2 124 2 170 58" />
            </svg>
            <span className="route-coin" id="route-coin" style={getArcPoint(progressPct / 100)}>¢</span>
          </div>
          <span className={`route-progress ${crediting ? 'crediting' : ''}`}>{points} / {targetPoints}</span>
        </div>
      )}

      <div className="coupon-pair" data-coupon-theme="dtc">
        <div className={`coupon-wrap current ${currentSwap ? 'swap' : ''} ${isTearingCoupon ? 'tearing' : ''}`}>
          <div className={`coupon coupon-current ${isExpired ? 'expired' : ''}`} data-tier={tierForDiscount(current.num)}>
            <div className="coupon-face" ref={couponFaceRef}>
              <span className="coupon-kicker">{isBestOffer ? '当前可用优惠券' : 'Unlocked Offer'}</span>
              <span className="stub-value">{current.num}<small>%</small></span>
              {isBestOffer ? (
                <>
                  <span className="max-discount-label">本轮最低折扣</span>
                </>
              ) : (
                <>
                  <span className="stub-off">OFF</span>
                  <span className="coupon-title">Sitewide · No minimum</span>
                </>
              )}
            </div>
            <button className="btn-use" id="use-now-btn" aria-label="Use current coupon" disabled={isExpired || isTearingCoupon} onClick={onUse}>
              <span>{isExpired ? 'Expired' : isBestOffer ? 'Claim now' : 'Use now'}</span>
              <svg className="use-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 4.5V19" />
                <path d="M6 13l6 6 6-6" />
              </svg>
            </button>
          </div>
          <TearCanvas active={isTearingCoupon} isBestOffer={isBestOffer} onComplete={onTearComplete} />
        </div>

        {next && (
          <div className={`coupon-wrap target ${delta <= 0 ? 'ready' : ''} ${targetPulse} ${currentSwap ? 'swap' : ''}`}>
            <div className="coupon coupon-target" data-tier={tierForDiscount(next.num)} ref={targetCouponRef}>
              <div className="coupon-face">
                <span className="coupon-kicker">Next Offer</span>
                <span className="stub-value">{next.num}<small>%</small></span>
                <span className="stub-off">OFF</span>
                <span className="coupon-title">Orders $75+</span>
              </div>
              <div className="locked-floor">
                <div className="coupon-fill" style={{ width: `${progressPct}%` }} />
                <span>Locked</span>
                <span>Need <b>{delta}</b> pts</span>
              </div>
            </div>
            <div className="lock-badge">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" stroke="none" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ChallengesBase({ challenges, dailyCapReached, onOpen }) {
  return (
    <section className="earn-progress-section" data-screen-label="挑战任务">
      <div className="section-head stacked">
        <span className="section-tag">Play &amp; Earn</span>
        <span className="section-note">Updated daily · New challenges every day</span>
      </div>
      <div className="challenges-swiper">
        {challenges.map((challenge) => {
          const pts = challenge.reward.replace(/[^0-9]/g, '');
          return (
            <div className="challenge-card" key={challenge.id}>
              <span className="challenge-badge">{challenge.badge}</span>
              <div className="challenge-icon-wrapper">{challenge.icon}</div>
              <h4 className="challenge-title">{challenge.title}</h4>
              <p className="challenge-desc">{challenge.desc}</p>
              <button
                className="btn btn-outline btn-play"
                id={challenge.type === 'survey' ? 'take-survey-btn' : `play-${challenge.id}-btn`}
                disabled={dailyCapReached}
                onClick={() => onOpen(challenge)}
              >
                {dailyCapReached ? (
                  <span>Cap Reached</span>
                ) : (
                  <>
                    <span className="btn-play-reward">+{pts}<i className="coin-ic" aria-hidden="true" /></span>
                    <span className="btn-play-label">{challenge.cta}</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RulesFooterBase({ rulesOpen, onToggle }) {
  return (
    <footer className="rules-footer">
      <div className="accordion-item">
        <button className="accordion-trigger" onClick={onToggle}>
          <span>How does it work?</span>
          <span className="accordion-icon">{rulesOpen ? '−' : '+'}</span>
        </button>
        <div className={`accordion-content ${rulesOpen ? 'open' : ''}`}>
          <ol className="rules-list">
            <li>Complete the quick games or surveys to earn points.</li>
            <li>Once the locked coupon fills up, it unlocks automatically.</li>
            <li>Copy your coupon code and shop before the countdown expires.</li>
            <li>Your progression resets once you place an order, starting a new cycle.</li>
          </ol>
        </div>
      </div>
    </footer>
  );
}


function CouponDrawer({ open, current, time, copyState, shopLoading, onClose, onCopy, onShop }) {
  return (
    <>
      <div className={`drawer-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`bottom-drawer ${open ? 'open' : ''}`}>
        <div className="drawer-drag-handle" />
        <div className="drawer-header">
          <h3 className="drawer-title">Claim Your Coupon</h3>
          <button className="close-drawer-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="drawer-body">
          <div className="coupon-value">{current.value}</div>
          <p className="coupon-desc">Coupon claimed. Use this code at checkout on the brand site.</p>
          <div className="coupon-code-container">
            <span className="coupon-code">{current.code}</span>
            <button className={`copy-btn ${copyState === 'Copied!' ? 'copied' : ''}`} onClick={onCopy}>{copyState}</button>
          </div>
          <button className="btn btn-primary btn-block" disabled={shopLoading} onClick={onShop}>
            {shopLoading ? 'Opening store...' : 'Use at Store'}
          </button>
          <p className="drawer-footer-timer">Expires in <span className="drawer-timer-text">{time.drawer}</span></p>
        </div>
      </div>
    </>
  );
}

function TapGameModal({ open, game, onClose, onStart, onTap }) {
  return (
    <Modal id="game-modal" open={open} title="Challenge: Tap the Target" onClose={onClose}>
      <p className="game-instructions">Tap the circle as many times as possible in 5 seconds!</p>
      <div className="game-stage">
        <div className="game-timer">{game.timeLeft.toFixed(2).padStart(5, '0')}</div>
        <div className="game-score">Taps: {game.taps}</div>
        <button className={`game-tap-circle ${game.active ? '' : 'disabled'}`} id="game-tap-target" onClick={onTap}>Tap Me!</button>
      </div>
      {!game.active && <button className="btn btn-primary btn-block" id="start-game-btn" onClick={onStart}>Start Game</button>}
    </Modal>
  );
}

function MemoryModal({ open, game, onClose, onStart, onFlip }) {
  return (
    <Modal id="memory-modal" open={open} title="Challenge: Memory Match" onClose={onClose}>
      <p className="game-instructions">Match the pairs of identical icons below!</p>
      <div className="memory-grid">
        {game.values.map((value, index) => {
          const visible = game.flipped.includes(index) || game.matched.includes(index);
          const matched = game.matched.includes(index);
          return (
            <div
              className={`memory-card ${visible ? 'flipped' : ''} ${matched ? 'matched' : ''}`}
              key={index}
              onClick={() => onFlip(index)}
            >
              <span>{visible ? value : '❓'}</span>
            </div>
          );
        })}
      </div>
      {!game.active && game.matched.length < 4 && (
        <button className="btn btn-primary btn-block" id="start-memory-btn" onClick={onStart}>Start Match</button>
      )}
    </Modal>
  );
}

function SpinModal({ open, active, rotation, onClose, onStart }) {
  return (
    <Modal id="spin-modal" open={open} title="Challenge: Lucky Spin" onClose={onClose} textCenter>
      <p className="game-instructions">Spin the wheel to earn points towards your discount!</p>
      <div className="wheel-stage">
        <div className="wheel-pointer">▼</div>
        <div className="wheel-outer" style={{ transform: `rotate(${rotation}deg)` }}>
          <div className="wheel-inner">
            {[
              ['#7a8c75', '+5'],
              ['#b89855', '+10'],
              ['#6b7e65', '+15'],
              ['#a08447', '+8']
            ].map(([color, label], index) => (
              <div className="wheel-segment" style={{ '--i': index, '--clr': color }} key={label}>{label}</div>
            ))}
          </div>
        </div>
      </div>
      <button className="btn btn-primary btn-block" disabled={active} onClick={onStart}>Spin Now</button>
    </Modal>
  );
}

function SurveyModal({ open, step, onClose, onOption }) {
  const currentStep = SURVEY_STEPS[step];
  return (
    <Modal id="survey-modal" open={open} title="Quick Preferences Survey" onClose={onClose}>
      <div className="survey-progress-bar">
        <div className="survey-progress-fill" style={{ width: `${((step + 1) / SURVEY_STEPS.length) * 100}%` }} />
      </div>
      <div className="survey-questions">
        <div className="survey-question-step active">
          <h4>{currentStep.title}</h4>
          <div className="survey-options">
            {currentStep.options.map((option) => (
              <button className="survey-option-btn" key={option} onClick={() => onOption(option)}>{option}</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function NotificationModal({ notification, onConfirm }) {
  return (
    <Modal id="notification-modal" open={!!notification} title={notification?.title ?? 'Success!'} onClose={onConfirm} textCenter>
      <div className="notification-icon">{notification?.icon ?? '✨'}</div>
      <p className="notification-message">{notification?.message}</p>
      <button className="btn btn-primary btn-block" id="notification-confirm-btn" onClick={onConfirm}>Understood</button>
    </Modal>
  );
}

function Modal({ id, open, title, onClose, textCenter = false, children }) {
  return (
    <div className={`modal-overlay ${open ? 'open' : ''}`} id={id}>
      <div className={`modal-content ${textCenter ? 'text-center' : ''}`}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="close-modal-btn" onClick={onClose}>&times;</button>
        </div>
        <div className={`modal-body ${textCenter ? 'text-center' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

function TearCanvas({ active, isBestOffer, onComplete }) {
  const canvasRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = 250;
    const H_btn = 58;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // Resolve the operated coupon's tier tokens from its sibling DOM node,
    // so the torn stub mirrors the static coupon's color exactly.
    const couponEl = canvas.parentElement?.querySelector('.coupon');
    const cs = couponEl ? getComputedStyle(couponEl) : null;
    const tokenMain = cs?.getPropertyValue('--coupon-main').trim() || '#ec82bd';
    const tokenAccent = cs?.getPropertyValue('--coupon-accent').trim() || '#cf609f';
    const tokenInk = cs?.getPropertyValue('--coupon-ink').trim() || '#ffffff';

    // Zigzag teeth matching the static coupon mask (--tooth:12px, depth 6px).
    const TOOTH = 12;
    const DEPTH = 6;
    function zigzagEdge(ctx, x0, x1, y, dir) {
      const span = x1 - x0;
      const n = Math.max(1, Math.round(Math.abs(span) / TOOTH));
      const step = span / n;
      for (let i = 1; i <= n; i++) {
        const xMid = x0 + step * (i - 0.5);
        const xEnd = x0 + step * i;
        ctx.lineTo(xMid, y + DEPTH * dir);
        ctx.lineTo(xEnd, y);
      }
    }

    let animationFrameId;
    let startTime = null;
    const tearDuration = 650;
    const maxTearAngle = 0.38;

    const numPoints = 15;
    const jaggedOffsets = Array.from({ length: numPoints }, (v, i) => {
      if (i === 0 || i === numPoints - 1) return 0;
      return (Math.random() - 0.5) * 3.5;
    });

    let particles = [];
    function spawnParticle(x, y) {
      const r = Math.random();
      let color;
      if (r > 0.6) color = '#ffffff';
      else if (isBestOffer) color = r > 0.3 ? '#cda756' : '#977229';
      else color = r > 0.3 ? tokenMain : tokenAccent;
      particles.push({
        x,
        y,
        color,
        vx: (Math.random() - 0.7) * 2.5,
        vy: (Math.random() - 0.6) * 3,
        g: 0.14,
        size: Math.random() * 2 + 1,
        alpha: 1.0,
        decay: Math.random() * 0.02 + 0.025
      });
    }

    let fallX = 0;
    let fallY = 0;
    let fallVX = 0.6;
    let fallVY = 1.0;
    let fallAngle = 0;
    let fallVAngle = 0.045;
    let fallAlpha = 1.0;
    const gravity = 0.35;

    function drawButtonBase(ctx, text) {
      const grad = ctx.createLinearGradient(0, 0, W, H_btn);
      if (isBestOffer) {
        grad.addColorStop(0, '#cda756');
        grad.addColorStop(1, '#977229');
      } else {
        grad.addColorStop(0, tokenMain);
        grad.addColorStop(1, tokenAccent);
      }

      // Toothed body: square corners with zigzag notches on top & bottom,
      // matching the static coupon silhouette.
      ctx.beginPath();
      ctx.moveTo(0, 0);
      zigzagEdge(ctx, 0, W, 0, 1);
      ctx.lineTo(W, H_btn);
      zigzagEdge(ctx, W, 0, H_btn, -1);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      if (!isBestOffer) {
        // Translucent dark overlay to mirror the static .btn-use footer.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
        ctx.fill();
      }

      const textColor = isBestOffer ? '#ffffff' : tokenInk;
      ctx.fillStyle = textColor;
      ctx.font = '900 12px "DM Sans", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const textCenterX = 18 + (W - 66) / 2;
      ctx.fillText(text, textCenterX, H_btn / 2);

      const ax = W - 33;
      const ay = H_btn / 2;
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Clean downward arrow: vertical shaft + chevron head.
      ctx.beginPath();
      ctx.moveTo(ax, ay - 8);
      ctx.lineTo(ax, ay + 8);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(ax - 6, ay + 2);
      ctx.lineTo(ax, ay + 8);
      ctx.lineTo(ax + 6, ay + 2);
      ctx.stroke();
    }

    function drawJaggedLine(ctx, startX, startY, endX, endY) {
      const steps = numPoints - 1;
      for (let i = 1; i <= steps; i++) {
        const pct = i / steps;
        const cy = startY + (endY - startY) * pct;
        const cx = startX + (endX - startX) * pct + jaggedOffsets[i];
        ctx.lineTo(cx, cy);
      }
    }

    let completedTriggered = false;

    const render = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      ctx.clearRect(0, 0, W, H);

      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.alpha -= p.decay;
        if (p.alpha <= 0) {
          particles.splice(idx, 1);
        }
      });

      if (elapsed < tearDuration) {
        const p = elapsed / tearDuration;
        const x_tear = p * W;

        // Dynamic clip path: set CSS --tear-x on parent to crop card background
        if (canvas.parentElement) {
          canvas.parentElement.style.setProperty('--tear-x', `${x_tear}px`);
        }

        const vibrate = Math.sin(p * 55) * 0.012 * (1 - p);
        const theta = -maxTearAngle * Math.pow(p, 1.6) + vibrate;

        if (Math.random() > 0.1) {
          spawnParticle(x_tear, 0);
          spawnParticle(x_tear, H_btn / 2);
          spawnParticle(x_tear, H_btn);
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x_tear, 0);
        drawJaggedLine(ctx, x_tear, 0, x_tear, H_btn);
        ctx.lineTo(W, H_btn);
        ctx.lineTo(W, 0);
        ctx.closePath();
        ctx.clip();
        
        drawButtonBase(ctx, isBestOffer ? 'CLAIM NOW' : 'USE NOW');
        ctx.restore();

        ctx.save();
        ctx.translate(x_tear, 0);
        ctx.rotate(theta);
        
        ctx.beginPath();
        ctx.moveTo(-x_tear, 0);
        ctx.lineTo(0, 0);
        drawJaggedLine(ctx, 0, 0, 0, H_btn);
        ctx.lineTo(-x_tear, H_btn);
        ctx.closePath();
        ctx.clip();

        ctx.translate(-x_tear, 0);
        drawButtonBase(ctx, isBestOffer ? 'CLAIM NOW' : 'USE NOW');
        ctx.restore();

        fallX = x_tear;
        fallY = 0;
        fallAngle = theta;

      } else {
        const fallElapsed = elapsed - tearDuration;
        
        // Lock clip path to full width when tear is complete
        if (canvas.parentElement) {
          canvas.parentElement.style.setProperty('--tear-x', `${W}px`);
        }

        if (!completedTriggered && fallElapsed > 250) {
          completedTriggered = true;
          onCompleteRef.current();
        }

        fallY += fallVY;
        fallVY += gravity;
        fallX += fallVX;
        fallAngle += fallVAngle;
        fallAlpha -= 0.032;

        if (fallAlpha > 0) {
          ctx.save();
          ctx.translate(fallX, fallY);
          ctx.rotate(fallAngle);
          ctx.globalAlpha = fallAlpha;

          ctx.beginPath();
          ctx.moveTo(-W, 0);
          ctx.lineTo(0, 0);
          drawJaggedLine(ctx, 0, 0, 0, H_btn);
          ctx.lineTo(-W + 18, H_btn);
          ctx.quadraticCurveTo(-W, H_btn, -W, H_btn - 18);
          ctx.closePath();
          ctx.clip();

          ctx.translate(-W, 0);
          drawButtonBase(ctx, isBestOffer ? 'CLAIM NOW' : 'USE NOW');
          ctx.restore();
        }
      }

      particles.forEach((p) => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      if (elapsed < tearDuration || fallAlpha > 0 || particles.length > 0) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (canvas && canvas.parentElement) {
        canvas.parentElement.style.removeProperty('--tear-x');
      }
    };
  }, [active, isBestOffer]);

  return <canvas ref={canvasRef} className="tear-canvas" />;
}

const ReceiptPrinter = memo(function ReceiptPrinter({ unlockedCoupon, colors, onUse, onAccumulate }) {
  const formattedDate = useMemo(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = pad(now.getDate());
    const month = pad(now.getMonth() + 1);
    const year = String(now.getFullYear()).slice(-2);
    
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    
    return `${day}/${month}/${year} ${hours}${ampm} (EST)`;
  }, []);

  return (
    <div className="printer-overlay" style={couponColorVars(colors)}>
      <div className="printer-machine">
        <div className="printer-slot" />
        <div className="receipt-paper-wrap">
          <div className="receipt-paper">
            <div className="receipt-header">
              <div className="receipt-logo">Ritual</div>
              <div className="receipt-title">VIP Reward Voucher</div>
            </div>
            
            <div className="receipt-divider" />
            
            <div className="receipt-meta">
              <div className="receipt-meta-row">
                <span>REDEEM CODE:</span>
                <span style={{ fontWeight: 'bold' }}>{unlockedCoupon?.code}</span>
              </div>
              <div className="receipt-meta-row">
                <span>DATE/TIME:</span>
                <span>{formattedDate}</span>
              </div>
              <div className="receipt-meta-row">
                <span>VOUCHER ID:</span>
                <span>#8849-002</span>
              </div>
            </div>
            
            <div className="receipt-divider" />
            
            <div className="receipt-big-text">
              {unlockedCoupon?.num}% OFF
            </div>
            
            <div className="receipt-divider" />
            
            <div className="receipt-meta">
              <div className="receipt-item-row">
                <span>UNLOCKED DISCOUNT</span>
                <span>{unlockedCoupon?.value}</span>
              </div>
              <div className="receipt-item-row">
                <span>VALIDITY</span>
                <span>Sitewide · No Min</span>
              </div>
            </div>
            
            <div className="receipt-divider" />
            
            <div style={{ textAlign: 'center', fontSize: '0.62rem', letterSpacing: '0.5px', color: '#555' }}>
              ########## {formattedDate.split(' ')[0]} ##########
            </div>
            
            <div className="receipt-barcode">
              {[1, 3, 2, 1, 4, 1, 2, 3, 1, 2, 4, 1, 3, 1, 2, 4, 1, 2, 3, 1, 4, 1, 2, 3, 1, 2, 4, 1, 2, 1].map((width, index) => (
                <div key={index} className="bar" style={{ width: `${width}px` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <div className="printer-buttons">
        <button className="btn-printer-primary" id="btn-receipt-use" onClick={onUse}>
          Use Now
        </button>
        <button className="btn-printer-secondary" id="btn-receipt-accumulate" onClick={onAccumulate}>
          Keep Accumulating Points
        </button>
      </div>
    </div>
  );
});

function ZoomFlipCard({ coupon, colors, rect, phase, isBestOffer, copyState, onClose, onCopy }) {
  const containerStyle = {
    ...(rect ? {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    } : {}),
    ...(isBestOffer ? {} : couponColorVars(colors))
  };

  const isZoomed = phase === 'zoomed' || phase === 'flipped';
  const isFlipped = phase === 'flipped';

  return (
    <>
      <div className={`zoom-overlay ${phase === 'init' ? 'closing' : ''}`} onClick={onClose} />
      <div
        className={`zoom-card-container ${isZoomed ? 'zoomed' : ''}`}
        style={containerStyle}
      >
        <div className={`zoom-card-inner ${isFlipped ? 'flipped' : ''}`}>
          {/* Front: coupon face clone */}
          <div className={`zoom-card-front ${isBestOffer ? 'best-offer-face' : ''}`}>
            <span className="front-kicker">Unlocked Offer</span>
            <span className="front-value">{coupon.num}<small>%</small></span>
            <span className="front-label">COUPON</span>
            <span className="front-subtitle">Sitewide · No minimum</span>
          </div>

          {/* Back: Kristalina-style redeem ticket */}
          <div className="zoom-card-back">
            <button className="zoom-back-close" onClick={onClose} aria-label="Close">×</button>

            <div className="kt-ticket">
              <div className="kt-top">
                <div className="kt-brand">Ritual</div>
                <div className="kt-cupom"></div>
                <div className="kt-percent">{coupon.num}<span className="kt-pct">%</span></div>
                <div className="kt-off">OFF</div>
              </div>

              <div className="kt-divider">
                <span className="kt-dline" />
              </div>

              <div className="kt-bottom">
                <div className="kt-code-row">
                  <span className="kt-utilize">Utilize:</span>
                  <span className="kt-code">{coupon.code}</span>
                  <button
                    className={`kt-copy ${copyState === 'Copied!' ? 'copied' : ''}`}
                    onClick={onCopy}
                    aria-label="Copy code"
                    title="Copy code"
                  >
                    {copyState === 'Copied!' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="kt-hint">on your first order.</div>
                <button
                  className="kt-visit"
                  onClick={() => window.open('https://ritual.com', '_blank', 'noopener')}
                >
                  <span>Shop at RITUAL.COM</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 17 17 7" />
                    <path d="M8 7h9v9" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
