import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { claimCoupon, completeSurvey, fetchRewardPlan, redeemCoupon, renewCycle, startGameSession } from './api/client.js';
import { readCachedRewardPlan, readRememberedTouchId, rememberTouchId, writeCachedRewardPlan, readWelcomeCompleted, writeWelcomeCompleted, readClaimedCode, writeClaimedCode, clearClaimedCode, clearWelcomeCompleted, clearLegacyMagnetStorage } from './api/cache.js';
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
const DEFAULT_TOUCH_ID = 'A8SQN3V2OW';

/** 将 BFF/引擎错误文案转为用户可读提示 */
function formatFcError(err, fallback = 'Please try again') {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (!msg) return fallback;
  if (msg.includes('cycle is not expired')) {
    return 'This challenge is still active. Refresh the page to continue.';
  }
  if (msg.includes('cycle is not active') || msg.includes('no active cycle')) {
    return 'This challenge has ended. Tap Start New Challenge to begin a fresh round.';
  }
  if (msg.includes('COUPON_ALREADY_REDEEMED')) return 'This coupon was already used.';
  if (msg.includes('COUPON_NOT_FOUND') || msg.includes('coupon not found')) {
    return 'Coupon not found. Please refresh and try again.';
  }
  if (msg.includes('DAILY_CAP_REACHED')) {
    return 'Daily points limit reached. Come back tomorrow for more rewards.';
  }
  return msg.includes(':') ? msg.split(':').slice(1).join(':').trim() || msg : msg;
}

function getTouchId() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('touchId');
  if (fromQuery) return fromQuery;

  // NFC / landing paths: /p/:touchId or /t/:touchId (aligned with fc-platform /t/[touchId])
  const pathMatch = window.location.pathname.match(/^\/(?:p|t)\/([^/]+)\/?$/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);

  return readRememberedTouchId() || DEFAULT_TOUCH_ID;
}

/** 随 URL /p/:touchId 变化更新(含 bfcache 返回) */
function useTouchId() {
  const [touchId, setTouchId] = useState(getTouchId);

  useEffect(() => {
    clearLegacyMagnetStorage();
    const sync = () => {
      const next = getTouchId();
      setTouchId((prev) => (prev === next ? prev : next));
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, []);

  return touchId;
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
  const pointsRef = useRef(0);
  const prevCountdownRef = useRef(null);

  const touchId = useTouchId();
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState(null);
  const [rewardPlanId, setRewardPlanId] = useState(null);
  const [brand, setBrand] = useState({ name: null, logoUrl: null, primaryColor: null, shopUrl: '#' });
  const [challenges, setChallenges] = useState(FALLBACK_CHALLENGES);
  const [gameStart, setGameStart] = useState(null);
  const [gameModalTitle, setGameModalTitle] = useState('Play & Earn');
  const [gameLoadingMessage, setGameLoadingMessage] = useState('Preparing game…');
  const [surveyAnswers, setSurveyAnswers] = useState([]);
  const [welcomeStep, setWelcomeStep] = useState(0);
  const [welcomeTargetPoints, setWelcomeTargetPoints] = useState(67);
  const [points, setPoints] = useState(0);
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
  const [dailyCapReached, setDailyCapReached] = useState(false);
  const [targetPulse, setTargetPulse] = useState('');
  const [crediting, setCrediting] = useState(false);
  const [currentSwap, setCurrentSwap] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);
  const [introActive, setIntroActive] = useState(false);
  const closeIntro = useCallback(() => setIntroActive(false), []);
  const [hasInitialDiscount, setHasInitialDiscount] = useState(false);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

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
  // 已领取但后端未核销的券码。存在时,每次登录都强制停留在最低折扣页,直到后端标记核销。
  const [claimedCode, setClaimedCode] = useState(null);
  // 确认领取弹窗:{ onConfirm } —— 点击「确认领取」后执行的领取动作。
  const [claimConfirm, setClaimConfirm] = useState(null);
  // 状态D · 新挑战开启过渡页:null | { reason: 'redeemed' | 'expired' }
  const [newChallenge, setNewChallenge] = useState(null);

  const syncFromPlan = useCallback((plan, { fromCache = false } = {}) => {
    const vm = mapPlanToViewModel(plan);
    setRewardPlanId(vm.rewardPlanId);
    setDiscounts(vm.discounts.length ? vm.discounts : INITIAL_DISCOUNTS);
    setCurrentStepIndex(vm.currentStepIndex);
    setCountdownSeconds(vm.countdownSeconds);
    setBrand(vm.brand);
    setChallenges(vm.challenges.length ? vm.challenges : FALLBACK_CHALLENGES);
    setDailyCapReached(vm.dailyCapReached);
    setHasInitialDiscount(vm.hasInitialDiscount);
    setWelcomeTargetPoints(vm.points);
    setPoints(vm.points);

    const welcomeDone = readWelcomeCompleted(touchId);
    const welcomeInProgress = vm.hasInitialDiscount && !welcomeDone;
    if (welcomeInProgress) {
      // 礼盒仅首屏展示;用户打开 Welcome 后不再回退到 intro
      setIntroActive(welcomeStep === 0);
    } else {
      setIntroActive(false);
      if (!vm.hasInitialDiscount) {
        setWelcomeStep(3);
      }
    }

    if (vm.brand.primaryColor) {
      document.documentElement.style.setProperty('--brand-primary', vm.brand.primaryColor);
    }

    const storedClaim = readClaimedCode(touchId);
    const redeemedMatch =
      (vm.recentlyRedeemedCoupon &&
        storedClaim &&
        vm.recentlyRedeemedCoupon.couponCode === storedClaim) ||
      vm.couponRedeemed;

    // 过渡页仅在权威 plan 同步时更新,避免缓存 plan 误触发 expired NC
    if (!fromCache) {
      if (redeemedMatch && storedClaim) {
        clearClaimedCode(touchId);
        setClaimedCode(null);
        setNewChallenge({ reason: 'redeemed' });
      } else if (vm.cycleExpired && !welcomeInProgress) {
        if (storedClaim) {
          clearClaimedCode(touchId);
          setClaimedCode(null);
        }
        setNewChallenge((prev) => prev ?? { reason: 'expired' });
      } else {
        setNewChallenge((prev) => {
          if (!vm.cycleExpired && prev?.reason === 'expired') return null;
          if (!redeemedMatch && prev?.reason === 'redeemed') return null;
          return prev;
        });
        if (vm.couponClaimed && vm.claimedCouponCode) {
          writeClaimedCode(touchId, vm.claimedCouponCode);
          setClaimedCode(vm.claimedCouponCode);
        }
      }
    } else if (vm.couponClaimed && vm.claimedCouponCode) {
      writeClaimedCode(touchId, vm.claimedCouponCode);
      setClaimedCode(vm.claimedCouponCode);
    }

    const tapAwarded = vm.tapReward?.awarded ?? 0;
    if (
      !fromCache &&
      tapAwarded > 0 &&
      welcomeDone &&
      !storedClaim &&
      !vm.cycleExpired &&
      !redeemedMatch
    ) {
      const fxKey = `fc_tap_fx_${touchId}`;
      if (!sessionStorage.getItem(fxKey)) {
        sessionStorage.setItem(fxKey, '1');
        window.setTimeout(() => triggerLoginBonusAnimation(tapAwarded), 200);
      }
    }
  }, [touchId, welcomeStep]);

  const reloadPlan = useCallback(async () => {
    const plan = await fetchRewardPlan(touchId);
    clearGameSessionCache();
    writeCachedRewardPlan(touchId, plan);
    syncFromPlan(plan);
    return plan;
  }, [clearGameSessionCache, syncFromPlan, touchId]);

  // 领取:调用 redeem 发券(方案 A — cycle 保持 active),写入锁态。
  const issueClaimedCoupon = useCallback(async (coupon) => {
    if (!rewardPlanId) throw new Error('Reward plan is not ready yet');
    const campaignId = coupon?.campaignId;
    if (!campaignId) throw new Error('No campaign for this coupon tier');

    const issued = await claimCoupon(touchId, rewardPlanId, campaignId);
    const code = issued?.couponCode ?? coupon?.code;
    if (!code) throw new Error('No coupon code returned');

    writeClaimedCode(touchId, code);
    setClaimedCode(code);
    setDiscounts((prev) =>
      prev.map((item) =>
        item.campaignId === campaignId || item.tier === coupon.tier
          ? { ...item, code }
          : item,
      ),
    );
    return code;
  }, [rewardPlanId, touchId]);

  const tweenPointsTo = useCallback((target, duration = 1200) => {
    const from = pointsRef.current;
    if (from === target) {
      setPoints(target);
      return;
    }
    const startedAt = performance.now();
    const step = (now) => {
      const t = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (target - from) * eased);
      setPoints(next);
      pointsRef.current = next;
      if (t < 1) {
        pointsTweenRef.current = requestAnimationFrame(step);
      } else {
        pointsTweenRef.current = null;
        setPoints(target);
        pointsRef.current = target;
      }
    };
    if (pointsTweenRef.current) cancelAnimationFrame(pointsTweenRef.current);
    pointsTweenRef.current = requestAnimationFrame(step);
  }, []);

  const handleWelcomeEarnMore = useCallback(async () => {
    try {
      const plan = await reloadPlan();
      const vm = mapPlanToViewModel(plan);
      const awarded = vm.tapReward?.awarded ?? 0;
      setWelcomeStep(2);
      if (awarded > 0) {
        window.setTimeout(() => triggerLoginBonusAnimation(awarded), 300);
      }
    } catch (err) {
      dbgError('[FCDBG][App] welcome earn more failed', err);
      showNotification(
        'Could not load rewards',
        formatFcError(err, 'Please try again.'),
        '⚠️',
      );
    }
  }, [reloadPlan]);

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

    setWelcomeStep(readWelcomeCompleted(touchId) ? 3 : 0);
    setClaimedCode(readClaimedCode(touchId));
    setNewChallenge(null);
    setIntroActive(false);
    setPlanLoading(true);
    setPlanError(null);
    setRewardPlanId(null);
    clearGameSessionCache();

    rememberTouchId(touchId);

    preloadRuntimeManifest(touchId).catch((err) => {
      dbgError('[FCDBG][App] runtime manifest preload failed', err);
    });

    const cached = readCachedRewardPlan(touchId);
    if (cached) {
      syncFromPlan(cached, { fromCache: true });
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

  const current = discounts[currentStepIndex] || discounts[discounts.length - 1] || { num: '15', target: 0 };
  const next = discounts[currentStepIndex + 1] || null;
  const targetPoints = next?.target ?? current?.target ?? 0;
  const progressPct = next ? Math.min((points / targetPoints) * 100, 100) : 100;
  const delta = next ? Math.max(targetPoints - points, 0) : 0;
  const isBestOffer = !next;
  // 已领取未核销:强制锁定在最低折扣页,直到后端确认核销。
  const claimedUnused = !!claimedCode;
  const showBestOffer = isBestOffer || claimedUnused;
  // 锁定时展示已领取的那张券(优先按券码匹配,兜底用当前券)。
  const lockedCoupon = claimedCode
    ? (discounts.find((d) => d.code === claimedCode) || current)
    : current;
  const isExpired = countdownSeconds <= 0;
  const time = useMemo(() => formatCountdown(countdownSeconds), [countdownSeconds]);
  const urgent = countdownSeconds < 86400 && countdownSeconds > 0;

  function resetRound() {
    setDiscounts((prevDiscounts) => {
      const firstNum = prevDiscounts?.[0]?.num;
      const numVal = parseInt(firstNum, 10);
      const nextStart = !Number.isNaN(numVal) ? (numVal + 5) : 15;
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
    // 有效期归零:解除已领取锁定,从状态C回到状态A,开启新一轮挑战。
    clearClaimedCode(touchId);
    setClaimedCode(null);
    setClaimConfirm(null);
  }

  // 完整重置回首登起点(开场礼盒 + 欢迎流)。
  function resetToFirstLogin() {
    clearWelcomeCompleted(touchId);
    clearClaimedCode(touchId);
    setClaimedCode(null);
    resetRound();                       // 刷新折扣档位 / 倒计时 / 清各类卡片
    setPoints(0);                       // 首登从 0 金币开始累积
    setWelcomeStep(0);                  // 回到欢迎流起点
    setIntroActive(true);               // 重新播放开场礼盒
    setNewChallenge(null);
  }

  // 「新挑战开启页」CTA:轻量进入首页(不 replay Welcome/礼盒)
  async function handleStartNewChallenge() {
    const reason = newChallenge?.reason ?? 'expired';
    setNewChallenge(null);
    setShowReceipt(false);
    setZoomActive(false);
    setClaimConfirm(null);
    clearClaimedCode(touchId);
    setClaimedCode(null);
    try {
      if (reason === 'expired') {
        await renewCycle(touchId, 'expired');
      }
      await reloadPlan();
      setWelcomeStep(3);
      setIntroActive(false);
      sessionStorage.removeItem(`fc_tap_fx_${touchId}`);
    } catch (err) {
      dbgError('[FCDBG][App] start new challenge failed', err);
      setNewChallenge({ reason });
      showNotification(
        'Could not start new challenge',
        formatFcError(err, 'Please check your connection and try again.'),
        '⚠️',
      );
    }
  }

  // 仅开发环境:在无真实后端时手动预览「新挑战开启页」两态(生产构建会被 import.meta.env.DEV 摇树移除)。
  function devShowNewChallenge(reason) {
    if (reason === 'redeemed') {
      clearClaimedCode(touchId);
      setClaimedCode(null);
    }
    setNewChallenge({ reason });
  }

  useEffect(() => {
    // 客户端倒计时归零且 plan 未标 expired 时的兜底(主路径为 plan.cycleExpired)
    const prev = prevCountdownRef.current;
    prevCountdownRef.current = countdownSeconds;
    if (
      prev > 0 &&
      countdownSeconds === 0 &&
      !newChallenge &&
      readWelcomeCompleted(touchId)
    ) {
      setNewChallenge({ reason: 'expired' });
    }
  }, [countdownSeconds, newChallenge, touchId]);

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

  // 任意「Claim now」按钮先弹确认弹窗,确认后再执行真正的领取动作。
  function requestClaim(onConfirm, discount) {
    setClaimConfirm({ onConfirm, discount });
  }

  function cancelClaim() {
    setClaimConfirm(null);

    // 首次登录时如果用户取消领取，标记首登欢迎流程完成，进入真正的钱包首页
    if (welcomeStep < 3) {
      setWelcomeStep(3);
      writeWelcomeCompleted(touchId);
      tweenPointsTo(welcomeTargetPoints);
    }

    if (showReceipt) {
      handleAccumulateMore();
    } else {
      const walletEl = document.getElementById('wallet') || document.querySelector('.wallet');
      if (walletEl) {
        walletEl.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  function confirmClaim() {
    const onConfirm = claimConfirm?.onConfirm;
    setClaimConfirm(null);
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

  /** 积分越高,金币数量、飞行时长与计数器滚动越久 */
  function getPointsEffectTiming(pts) {
    const safePts = Math.max(0, Math.round(pts));
    const count = Math.min(22, Math.max(4, Math.round(safePts / 7) || 4));
    const totalMs = Math.min(5200, Math.max(720, 480 + safePts * 32));
    const staggerMs = Math.max(36, Math.floor(totalMs / (count + 1.5)));
    const coinDuration = Math.min(1100, Math.max(420, Math.floor(staggerMs * 1.85)));
    const creditDuration = Math.min(2400, Math.max(500, 380 + safePts * 20));
    return { count, staggerMs, coinDuration, creditDuration };
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
  function flyCoins(count, done, startPos, { staggerMs = 58, coinDuration = 680 } = {}) {
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
      const duration = reduce ? 340 : coinDuration + Math.random() * (coinDuration * 0.22);
      const delay = i * (reduce ? 24 : staggerMs);

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

    const timing = getPointsEffectTiming(pts);
    spawnGainCallout(pts);
    flyCoins(timing.count, () => {
      creditPoints(pts, timing.creditDuration);
    }, null, { staggerMs: timing.staggerMs, coinDuration: timing.coinDuration });
  }

  // 🅓 Roll the points counter up to the new total (instead of a hard jump),
  // highlighting the counter while it credits; celebrate once at the end.
  function creditPoints(pts, duration = 600) {
    if (!pts) return;
    if (pointsTweenRef.current) {
      cancelAnimationFrame(pointsTweenRef.current);
      pointsTweenRef.current = null;
    }

    const from = points;
    const to = from + pts;

    if (prefersReducedMotion()) {
      setPoints(to);
      if (next && to >= targetPoints) triggerCelebration(to);
      return;
    }

    setCrediting(true);
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
        if (next && to >= targetPoints) triggerCelebration(to);
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

  const handleTargetClick = () => {
    setReceiptColors(readCouponTokens(targetCouponRef.current));
    setPendingPoints(points);
    setShowReceipt(true);
  };

  async function handleUseReceiptCoupon() {
    const nextCoupon = discounts[currentStepIndex + 1];
    try {
      setRedeemingCoupon(true);
      await issueClaimedCoupon(nextCoupon);
    } catch (err) {
      showNotification('Coupon unavailable', formatFcError(err, 'Could not issue coupon'), '⚠️');
      return;
    } finally {
      setRedeemingCoupon(false);
    }
    const targetPointsVal = nextCoupon?.target ?? 90;
    setCurrentStepIndex((index) => Math.min(index + 1, discounts.length - 1));
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
    setCurrentStepIndex((index) => Math.min(index + 1, discounts.length - 1));
    setPoints(Math.max(pendingPoints - targetPointsVal, 0));
    setShowReceipt(false);
    
    // Trigger swap animation on both coupons to signify cards have changed
    setCurrentSwap(true);
    setTimeout(() => setCurrentSwap(false), 800);
  }

  async function handleCopyCode() {
    const code = claimedCode || current.code;
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('Copied!');
      setTimeout(() => setCopyState('Copy'), 2000);
    } catch {
      showNotification('Copy Failed', `We couldn't copy it automatically. Please copy manually: ${code}`, '⚠️');
    }
  }

  async function handleUseCoupon() {
    if (isExpired || isTearingCoupon || redeemingCoupon) return;

    setRedeemingCoupon(true);
    try {
      await issueClaimedCoupon(current);
    } catch (err) {
      showNotification('Coupon unavailable', formatFcError(err, 'Could not issue coupon'), '⚠️');
      return;
    } finally {
      setRedeemingCoupon(false);
    }

    const faceEl = couponFaceRef.current;
    const viewport = viewportRef.current;
    if (!faceEl || !viewport) {
      setDrawerOpen(true);
      return;
    }

    if (isBestOffer) {
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
      return;
    }

    const vpRect = viewport.getBoundingClientRect();
    const cardW = Math.min(vpRect.width * 0.82, 320);
    const cardH = cardW * 1.58;
    setZoomRect({
      left: vpRect.left + (vpRect.width - cardW) / 2,
      top: vpRect.top + (vpRect.height - cardH) / 2,
      width: cardW,
      height: cardH
    });
    setZoomCoupon(current);
    setZoomColors(readCouponTokens(faceEl.closest('.coupon')));
    setZoomCopyState('Copy');
    setZoomPhase('flipped');
    setZoomActive(true);
  }

  function handleShopNow() {
    setShopLoading(true);
    const shopUrl = brand.shopUrl || '#';
    showNotification('Ready to use', 'Your coupon is ready. Opening the shop with your code!', '🛍️', () => {
      setShopLoading(false);
      setDrawerOpen(false);
      if (shopUrl && shopUrl !== '#') window.open(shopUrl, '_blank', 'noopener,noreferrer');
    });
  }

  function handleShopNowDirect() {
    const shopUrl = (brand.shopUrl && brand.shopUrl !== '#') ? brand.shopUrl : 'https://ritual.com';
    window.open(shopUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleSettlementComplete(settlement) {
    dbg('[FCDBG][App] settlement received', settlement);
    clearGameSessionCache();
    setActiveModal(null);
    setGameStart(null);
    const pts = settlement.pointsAwarded ?? 0;

    const refreshPlan = () => {
      reloadPlan().catch((err) => {
        dbgError('[FCDBG][App] background reloadPlan failed', err);
        setPlanError(err instanceof Error ? err.message : 'Could not refresh rewards');
      });
    };

    if (settlement.couponWon) {
      setReceiptColors(readCouponTokens(targetCouponRef.current));
      setPendingPoints(points + pts);
      setShowReceipt(true);
      startConfetti();
      refreshPlan();
      return;
    }

    if (pts > 0) {
      const timing = getPointsEffectTiming(pts);
      const startPos = {
        x: (viewportRef.current?.clientWidth ?? 360) / 2,
        y: (viewportRef.current?.clientHeight ?? 640) * 0.42,
      };
      spawnGainCallout(pts);
      flyCoins(
        timing.count,
        () => {
          creditPoints(pts, timing.creditDuration);
          refreshPlan();
        },
        startPos,
        { staggerMs: timing.staggerMs, coinDuration: timing.coinDuration },
      );
      return;
    }

    refreshPlan();
  }

  const handleUseWelcomeCoupon = useCallback(async () => {
    const prevStep = welcomeStep;
    setWelcomeStep(3);
    writeWelcomeCompleted(touchId);
    try {
      setRedeemingCoupon(true);
      await issueClaimedCoupon(current);
    } catch (err) {
      clearWelcomeCompleted(touchId);
      setWelcomeStep(prevStep);
      dbgError('[FCDBG][App] welcome claim failed', err);
      showNotification('Coupon unavailable', formatFcError(err, 'Please try again'), '⚠️');
      return;
    } finally {
      setRedeemingCoupon(false);
    }

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
  }, [current, issueClaimedCoupon, welcomeStep]);

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
      {introActive && hasInitialDiscount && (
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
        {showBestOffer ? (
          <BestCouponLockedPage
            coupon={lockedCoupon}
            time={time}
            tick={tick}
            countdownSeconds={countdownSeconds}
            isExpired={isExpired}
            couponFaceRef={couponFaceRef}
            claimed={claimedUnused}
            copyState={copyState}
            onClaim={() => requestClaim(handleUseCoupon, lockedCoupon.num)}
            onShop={handleShopNowDirect}
            onCopy={handleCopyCode}
            points={points}
            targetPoints={targetPoints}
            challenges={challenges}
            dailyCapReached={dailyCapReached}
            onOpenChallenge={openChallenge}
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
              onUse={() => requestClaim(handleUseCoupon, current.num)}
              onTearComplete={handleTearComplete}
              countdownSeconds={countdownSeconds}
              confirmOpen={!!claimConfirm}
              onTargetClick={handleTargetClick}
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

      <ClaimConfirmModal claim={claimConfirm} onConfirm={confirmClaim} onCancel={cancelClaim} />

      {newChallenge && (
        <NewChallengeUnlocked reason={newChallenge.reason} onStart={handleStartNewChallenge} prevCoupon={lockedCoupon} />
      )}

      {import.meta.env.DEV && !newChallenge && (
        <div
          style={{
            position: 'fixed', left: 10, bottom: 10, zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 8px', borderRadius: 8,
            background: 'rgba(20,24,20,0.82)', font: '600 11px/1 sans-serif'
          }}
        >
          <span style={{ color: '#9fe1cb', letterSpacing: 1 }}>DEV</span>
          <button
            type="button"
            onClick={resetToFirstLogin}
            style={{ padding: '5px 8px', borderRadius: 6, border: 0, cursor: 'pointer', background: '#377add', color: '#fff' }}
          >
            首登
          </button>
          <button
            type="button"
            onClick={() => devShowNewChallenge('redeemed')}
            style={{ padding: '5px 8px', borderRadius: 6, border: 0, cursor: 'pointer', background: '#4f8a4a', color: '#fff' }}
          >
            Redeemed
          </button>
          <button
            type="button"
            onClick={() => devShowNewChallenge('expired')}
            style={{ padding: '5px 8px', borderRadius: 6, border: 0, cursor: 'pointer', background: '#a98435', color: '#fff' }}
          >
            Expired
          </button>
        </div>
      )}

      {showReceipt && (
        <ReceiptPrinter
          unlockedCoupon={discounts[currentStepIndex + 1]}
          colors={receiptColors}
          onUse={() => requestClaim(handleUseReceiptCoupon, discounts[currentStepIndex + 1]?.num)}
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

      {welcomeStep < 3 && !introActive && hasInitialDiscount && (
        <WelcomeRitual
          step={welcomeStep}
          coupon={current}
          brand={brand}
          couponFaceRef={couponFaceRef}
          onAdvanceToSettle={handleWelcomeEarnMore}
          onUse={() => requestClaim(handleUseWelcomeCoupon, current.num)}
          onComplete={() => {
            setWelcomeStep(3);
            writeWelcomeCompleted(touchId);
            tweenPointsTo(welcomeTargetPoints);
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
                Claim Now
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

function BestCouponLockedPage({ 
  coupon, time, tick, isExpired, couponFaceRef, claimed, copyState, onClaim, onShop, onCopy,
  points, targetPoints, challenges, dailyCapReached, onOpenChallenge 
}) {
  if (claimed) {
    const displayTarget = coupon.target ?? 0;
    const displayPoints = displayTarget === 0 ? points : (points + displayTarget);
    return (
      <section className="best-locked-page voucher-ready" data-screen-label="券已领取">
        {/* Top Countdown Banner */}
        <div className="limited-offer-banner">
          <div className="limited-offer-title">
            <span className="limited-offer-dot">●</span> LIMITED OFFER ENDS IN
          </div>
          <div className="limited-offer-timer-boxes">
            <div className="limited-offer-timer-box-wrapper">
              <div className="limited-offer-timer-box">{time.digits[0]}</div>
              <div className="limited-offer-timer-label">DAYS</div>
            </div>
            <div className="limited-offer-timer-colon">:</div>
            <div className="limited-offer-timer-box-wrapper">
              <div className="limited-offer-timer-box">{time.digits[1]}</div>
              <div className="limited-offer-timer-label">HOURS</div>
            </div>
            <div className="limited-offer-timer-colon">:</div>
            <div className="limited-offer-timer-box-wrapper">
              <div className="limited-offer-timer-box">{time.digits[2]}</div>
              <div className="limited-offer-timer-label">MIN</div>
            </div>
            <div className="limited-offer-timer-colon">:</div>
            <div className="limited-offer-timer-box-wrapper">
              <div className="limited-offer-timer-box">{time.digits[3]}</div>
              <div className="limited-offer-timer-label">SEC</div>
            </div>
          </div>
        </div>

        {/* 2. Title YOUR COUPON */}
        <h2 className="your-coupon-title">YOUR COUPON</h2>

        {/* 3. Coupon Card */}
        <div className="voucher-coupon-card-container">
          {/* Progress badge pill */}
          <div className="voucher-coupon-progress-badge">
            {displayPoints} / {displayTarget}
          </div>

          {/* Left/Right badges */}
          <div className="voucher-coupon-left-badge">C</div>
          <div className="voucher-coupon-right-badge">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
          </div>

          <div className="voucher-coupon-card">
            {/* CLAIMED with checkmark */}
            <div className="voucher-coupon-claimed-badge">
              • CLAIMED ✓
            </div>

            {/* Large Coupon Value */}
            <h1 className="voucher-coupon-value-large">{coupon.num}%</h1>
            <div className="voucher-coupon-off-label">OFF</div>
            
            <div className="voucher-coupon-subtitle">Sitewide · No minimum</div>

            {/* Code Capsule */}
            <div className="voucher-code-capsule">
              <div className="voucher-code-left-cutout"></div>
              <div className="voucher-code-right-cutout"></div>
              <div className="voucher-code-text-wrapper">
                <span className="voucher-code-label">Your Code</span>
                <span className="voucher-code-value">{coupon.code}</span>
              </div>
              <button className="voucher-code-copy-btn" onClick={onCopy} aria-label="Copy Code">
                {copyState === 'Copied!' ? (
                  <span style={{ fontWeight: 'bold', color: '#4f8a4a', fontSize: '14px' }}>✓</span>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                )}
              </button>
            </div>

            {/* Redeem CTA */}
            <button className="btn-voucher-use-now" id="use-now-btn" onClick={onShop}>
              Redeem
            </button>

            {/* Expiry Pill */}
            <div className="voucher-expiry-countdown">
              Expires in <span className="voucher-expiry-time">{time.digits.join(' : ')}</span>
            </div>
          </div>
        </div>


      </section>
    );
  }

  return (
    <section className="best-locked-page" data-screen-label="最佳优惠券">
      <div className="best-locked-copy">
        <span className="best-locked-eyebrow">本轮最低折扣</span>
        <h1>{coupon.num}% OFF <small>可立即领取</small></h1>
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

      <button className="best-locked-cta" id="use-now-btn" type="button" disabled={isExpired} onClick={onClaim}>
        Claim Now
      </button>

      <p className="best-locked-footnote">
        有效期结束后将自动开启新一轮挑战。
      </p>
    </section>
  );
}

function NewChallengeUnlocked({ reason, onStart, prevCoupon }) {
  const redeemed = reason === 'redeemed';
  const expired = reason === 'expired';
  
  // Previous offer details
  const prevNum = prevCoupon?.num || '20';
  const prevValue = prevCoupon?.value || '20% OFF';
  // Subtitle for previous offer (Orders $75+ or Sitewide depending on tier)
  const prevSubtitle = prevNum === '20' ? 'Orders $75+' : 'Sitewide · No minimum';

  // New round details (starts at 15%)
  const newNum = '15';
  
  return (
    <div className="new-challenge-overlay" role="dialog" aria-label="New challenge unlocked" data-screen-label="新挑战开启">
      <div className="nc-container">
        
        {/* 1. Header badge */}
        {expired ? (
          <div className="nc-header-badge expired">
            <svg className="nc-header-clock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span className="nc-header-badge-text">LAST CHALLENGE ENDED</span>
          </div>
        ) : (
          <div className="nc-used-badge-wrapper">
            <div className="nc-used-circle">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <span className="nc-used-label">OFFER USED</span>
          </div>
        )}

        {/* 2. Main title & description */}
        <h1 className="nc-title">New Challenge Unlocked</h1>
        <p className="nc-subtitle">
          {expired 
            ? 'Your previous challenge has ended. A fresh round is now ready for you.'
            : 'Nice! Your last offer was used successfully. Earn points to unlock your next coupon.'}
        </p>

        {/* 3. Previous Offer/Challenge Ticket */}
        <div className="nc-ticket-previous">
          <div className="nc-ticket-label">
            {expired ? 'PREVIOUS CHALLENGE' : 'PREVIOUS OFFER'}
          </div>
          
          <div className="nc-ticket-value-row">
            <span className="nc-ticket-value-number">{prevNum}</span>
            <div className="nc-ticket-percent-off-stack">
              <span className="nc-ticket-percent-symbol">%</span>
              <span className="nc-ticket-off-label">OFF</span>
            </div>
          </div>
          
          <div className="nc-ticket-subtitle">{prevSubtitle}</div>
          
          {/* Stamp */}
          {expired ? (
            <div className="nc-stamp-ended">
              <span className="nc-stamp-ended-star">★</span>
              <span className="nc-stamp-ended-text">ENDED</span>
              <span className="nc-stamp-ended-star">★</span>
            </div>
          ) : (
            <div className="nc-stamp-used">
              <svg className="nc-stamp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>USED</span>
              <span className="nc-stamp-star">★</span>
            </div>
          )}

          {/* Clock timer pill for expired page */}
          {expired && (
            <div className="nc-ticket-timer-pill">
              <svg className="nc-pill-clock-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span>00:00:00</span>
            </div>
          )}
        </div>

        {/* 4. Separator */}
        {expired ? (
          <div className="nc-connector-circle">
            <svg className="nc-refresh-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </div>
        ) : (
          <div className="nc-arrow-down">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <polyline points="19 12 12 19 5 12"></polyline>
            </svg>
            <div className="nc-arrow-glow"></div>
          </div>
        )}

        {/* 5. New Round Ticket */}
        <div className={`nc-new-round-section ${expired ? 'expired-glow' : ''}`}>
          {expired ? (
            /* Progress pill on top centered on the border */
            <div className="nc-ticket-new-progress-pill">0 / 80</div>
          ) : (
            /* Mini Arc Path Header */
            <div className="nc-mini-arc-container">
              <svg className="nc-mini-arc-svg" viewBox="0 0 178 70" preserveAspectRatio="none">
                <path d="M8 58 C52 14 126 14 170 58" fill="none" stroke="#e6e1d5" strokeWidth="2" strokeDasharray="5 5" />
              </svg>
              <div className="nc-mini-arc-coin">¢</div>
              <div className="nc-mini-arc-progress">0 / 80</div>
              <div className="nc-mini-arc-lock">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                </svg>
              </div>
            </div>
          )}

          {/* New Round Ticket Card */}
          <div className="nc-ticket-new-round">
            <div className="nc-ticket-label">NEW ROUND</div>
            
            <div className="nc-ticket-value-row">
              <span className="nc-ticket-value-number">{newNum}</span>
              <div className="nc-ticket-percent-off-stack">
                <span className="nc-ticket-percent-symbol">%</span>
                <span className="nc-ticket-off-label">OFF</span>
              </div>
            </div>
            
            <div className="nc-ticket-value-subtitle">Orders $75+</div>
            
            <div className="nc-ticket-divider">
              <span className="nc-ticket-diamond">♦</span>
            </div>
            
            <div className="nc-ticket-subtitle">Start earning to unlock more</div>
          </div>
        </div>

        {/* 6. Bottom CTA Button and Timer Footer */}
        <div className="nc-footer">
          <button className="nc-btn-start" type="button" onClick={onStart}>
            <span>Start New Challenge</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
          <p className="nc-footer-text">
            {expired ? 'A new countdown has started.' : 'Your new timer has started.'}
          </p>
        </div>

      </div>
    </div>
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
  countdownSeconds,
  confirmOpen,
  onTargetClick
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
          <div className={`coupon coupon-current ${isExpired ? 'expired' : ''} ${confirmOpen ? 'confirm-open-zoom' : ''}`} data-tier={tierForDiscount(current.num)}>
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
              <span>{isExpired ? 'Expired' : 'Claim'}</span>
              <svg className="use-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 4.5V19" />
                <path d="M6 13l6 6 6-6" />
              </svg>
            </button>
          </div>
          <TearCanvas active={isTearingCoupon} isBestOffer={isBestOffer} onComplete={onTearComplete} />
        </div>

        {next && (
          <div 
            className={`coupon-wrap target ${delta <= 0 ? 'ready' : ''} ${targetPulse} ${currentSwap ? 'swap' : ''}`}
            onClick={delta <= 0 ? onTargetClick : undefined}
            style={delta <= 0 ? { cursor: 'pointer' } : undefined}
          >
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
      <div className="survey-progress-header">
        <span className="survey-step-indicator">{step + 1}/{SURVEY_STEPS.length}</span>
        <div className="survey-progress-bar">
          <div className="survey-progress-fill" style={{ width: `${((step + 1) / SURVEY_STEPS.length) * 100}%` }} />
        </div>
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

function ClaimConfirmModal({ claim, onConfirm, onCancel }) {
  const discount = claim?.discount || '15';
  const [isClaiming, setIsClaiming] = useState(false);

  useEffect(() => {
    if (claim) {
      setIsClaiming(false);
    }
  }, [claim]);

  if (!claim) return null;

  const handleConfirm = () => {
    if (isClaiming) return;
    setIsClaiming(true);
    setTimeout(() => {
      onConfirm();
    }, 1200);
  };

  const nextDiscount = discount === 10 ? 15 : 20;
  const isMaxTier = discount >= 20;

  return (
    <div className="modal-overlay open" id="claim-confirm-modal">
      <div className={`claim-confirm-content ${isClaiming ? 'modal-claiming' : ''}`}>
        <button className="claim-confirm-close-btn" onClick={onCancel} disabled={isClaiming}>&times;</button>
        
        {/* Title */}
        <h3 className="claim-confirm-title">Ready to lock it in?</h3>

        {/* Current Reward Display */}
        <div className="claim-confirm-reward-display">
          <div className="claim-confirm-reward-value">{discount}% OFF</div>
          <div className="claim-confirm-reward-subtitle">You’ve unlocked this reward.</div>
        </div>

        {/* Decision Description Text */}
        <div className="claim-confirm-body">
          {!isMaxTier && (
            <p>Or keep earning points<br />for a chance at <strong>{nextDiscount}% OFF</strong>.</p>
          )}
          <p className="claim-confirm-round-complete">Once claimed,<br />this round is complete.</p>
        </div>

        <div className="claim-confirm-actions">
          <button 
            className={`btn-claim-confirm-yes ${isClaiming ? 'claiming' : ''}`} 
            id="claim-confirm-btn"
            onClick={handleConfirm}
            disabled={isClaiming}
          >
            {isClaiming ? (
              <>
                <span className="claiming-spinner"></span>
                Locking In...
              </>
            ) : (
              `Lock In ${discount}% OFF`
            )}
          </button>
          <button 
            className="btn-claim-confirm-cancel" 
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCancel();
            }}
            disabled={isClaiming}
          >
            {isMaxTier ? 'Go Back' : 'Go for More OFF'}
          </button>
        </div>
      </div>
    </div>
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
        
        drawButtonBase(ctx, 'CLAIM NOW');
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
        drawButtonBase(ctx, 'CLAIM NOW');
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
          drawButtonBase(ctx, 'CLAIM NOW');
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
          Claim Now
        </button>
        <button className="btn-printer-secondary" id="btn-receipt-accumulate" onClick={onAccumulate}>
          Keep Accumulating Points
        </button>
      </div>
    </div>
  );
});

function ZoomFlipCard({ coupon, colors, rect, phase, copyState, onClose, onCopy }) {
  const canvasRef = useRef(null);
  const [scratched, setScratched] = useState(false);

  const containerStyle = {
    ...(rect ? {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    } : {}),
    ...couponColorVars(colors)
  };

  const isZoomed = phase === 'zoomed' || phase === 'flipped';
  const isFlipped = phase === 'flipped';

  useEffect(() => {
    if (phase !== 'flipped') {
      setScratched(false);
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'flipped' || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set display size based on container bounding rect
    const width = canvas.parentElement.clientWidth || 260;
    const height = canvas.parentElement.clientHeight || 76;
    canvas.width = width;
    canvas.height = height;

    // Draw Gold Foil Background
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#dfbe74');
    grad.addColorStop(0.35, '#ca9d4c');
    grad.addColorStop(0.7, '#e8cf96');
    grad.addColorStop(1, '#ab7b2b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Draw metallic brush noise/glitter texture
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let i = 0; i < 200; i++) {
      ctx.fillRect(Math.random() * width, Math.random() * height, Math.random() * 3 + 1, Math.random() * 2 + 1);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    for (let i = 0; i < 200; i++) {
      ctx.fillRect(Math.random() * width, Math.random() * height, Math.random() * 2 + 1, Math.random() * 2 + 1);
    }

    // Scratch Animation
    let animationFrameId;
    const duration = 1800; // 1.8 seconds scratch-off
    const startTime = performance.now();
    const particles = [];

    const animate = (time) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Current X position of scratch brush (scratches from left to right)
      // We start slightly off-screen left and go slightly off-screen right
      const x = -30 + progress * (width + 60);
      
      // Wobble y to make it look organic (brush strokes)
      const y = height / 2 + Math.sin(progress * Math.PI * 6) * 10;

      // Draw destination-out circles to scratch off the gold layer
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      
      // Draw a main clear circle
      ctx.beginPath();
      ctx.arc(x, y, 28, 0, Math.PI * 2);
      ctx.fill();

      // Draw minor offset circles for irregular brush edges
      ctx.beginPath();
      ctx.arc(x - 8, y + (Math.sin(progress * 15) * 6), 20, 0, Math.PI * 2);
      ctx.arc(x + 8, y - (Math.cos(progress * 12) * 6), 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Spawn falling gold foil particles at the scratch head!
      if (progress < 0.95 && Math.random() < 0.7) {
        for (let j = 0; j < 3; j++) {
          particles.push({
            x: x + (Math.random() - 0.5) * 20,
            y: y + (Math.random() - 0.5) * 20,
            vx: -1.5 - Math.random() * 2, // fly left/backward
            vy: -2 + Math.random() * 4, // fly vertical
            size: Math.random() * 3 + 2,
            life: 1.0,
            color: Math.random() > 0.5 ? '#ca9d4c' : '#dfbe74'
          });
        }
      }

      // Update and Draw Particles
      if (particles.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.25; // gravity
          p.life -= 0.03;

          if (p.life <= 0) {
            particles.splice(i, 1);
          } else {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.fillRect(p.x, p.y, p.size, p.size);
          }
        }
        ctx.restore();
      }

      if (progress < 1 || particles.length > 0) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        setScratched(true);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [phase]);

  return (
    <>
      <div className={`zoom-overlay ${phase === 'init' ? 'closing' : ''}`} onClick={onClose} />
      
      {/* Outside close button positioned relative to the card's bounding rect */}
      {isZoomed && (
        <button 
          className="zoom-outside-close-btn" 
          onClick={onClose} 
          aria-label="Close"
          style={{
            position: 'fixed',
            left: rect ? `${rect.left + rect.width - 14}px` : '50%',
            top: rect ? `${rect.top - 14}px` : '50%',
            transform: rect ? 'none' : 'translate(146px, -236px)',
            zIndex: 105
          }}
        >
          &times;
        </button>
      )}

      <div
        className={`zoom-card-container ${isZoomed ? 'zoomed' : ''}`}
        style={containerStyle}
      >
        <div className={`zoom-card-inner ${isFlipped ? 'flipped' : ''}`}>
          {/* Front: coupon face clone */}
          <div className="zoom-card-front">
            <span className="front-kicker">Unlocked Offer</span>
            <span className="front-value">{coupon.num}<small>%</small></span>
            <span className="front-label">COUPON</span>
            <span className="front-subtitle">Sitewide · No minimum</span>
          </div>

          {/* Back: Scratch Card Ticket */}
          <div className="zoom-card-back scratch-ticket-back">
            <div className="scratch-ticket-container">
              <div className="scratch-header">UNLOCKED OFFER</div>
              <div className="scratch-value">{coupon.num}% OFF</div>
              <div className="scratch-subtitle">Sitewide · No minimum</div>
              <div className="scratch-dotted-divider"></div>
              
              <div className="scratch-instruction">Scratch to reveal your code</div>
              
              <div className="scratch-area">
                <div className="scratch-code-container">
                  <span className="scratch-code">{coupon.code}</span>
                  <button className="scratch-code-copy-btn" onClick={onCopy} type="button" title="Copy code">
                    {copyState === 'Copied!' ? (
                      <span className="scratch-copied-badge">Copied ✓</span>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    )}
                  </button>
                </div>
                <canvas 
                  className="scratch-canvas" 
                  ref={canvasRef}
                  style={{ display: scratched ? 'none' : 'block' }}
                ></canvas>
              </div>

              <div className="scratch-actions">
                <button 
                  className="scratch-btn-use" 
                  onClick={() => {
                    window.open('https://ritual.com', '_blank', 'noopener');
                    onClose();
                  }}
                  type="button"
                >
                  <span className="coin-icon">¢</span>
                  <span>Use This Code</span>
                </button>
              </div>

              <div className="scratch-lock-footer">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                </svg>
                <span>Your coupon is already locked in.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
