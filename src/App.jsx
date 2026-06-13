import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { claimCoupon, completeSurvey, fetchMagnetBrandParam, fetchRewardPlan, fetchShopifyStatus, observeCoupon, redeemCoupon, renewCycle, startGameSession } from './api/client.js';
import {
  readCachedRewardPlan,
  readCachedMagnetBrandParam,
  readCachedShopifyStatus,
  readRememberedTouchId,
  rememberTouchId,
  writeCachedRewardPlan,
  writeCachedMagnetBrandParam,
  writeCachedShopifyStatus,
  clearCachedShopifyStatus,
  markShopifyOAuthPending,
  consumeShopifyOAuthPending,
  readShopifyOAuthPendingSource,
  clearShopifyOAuthPending,
  isShopifyOAuthPending,
  clearCachedRewardPlan,
  readWelcomeCompleted,
  writeWelcomeCompleted,
  readClaimRecord,
  writeClaimRecord,
  clearClaimedCode,
  clearWelcomeCompleted,
  clearLegacyMagnetStorage,
} from './api/cache.js';
import {
  applyClaimToDiscounts,
  couponWithCode,
  mapPlanToViewModel,
  nextTierThresholdFromDiscounts,
} from './api/mapPlan.js';
import PlatformGameModal from './components/PlatformGameModal.jsx';
import DevToolbar from './components/DevToolbar.jsx';
import {
  applyDevSceneUi,
  getDevScene,
  isDevPreviewEnabled,
  navigateToDevScene,
  resolveDevScene,
} from './dev/index.js';
import { dbg, dbgError } from './lib/debug.js';
import { applyBrandCssVar, brandFromMagnetParam } from './lib/brandTheme.js';
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
const DEV_SCENE_TAP = {
  intro: { pending: 5, points: 0 },
  welcome: { pending: 5, points: 0 },
  'return-visit': { pending: 5, points: 10 },
};

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

const SHOPIFY_TAP_AUTH_BASE = 'https://dtc-dashboard.fridgechannels.com/tap';

function buildShopifyAuthUrl(touchId) {
  const id = touchId || getTouchId();
  const redirectedFrom = encodeURIComponent(window.location.href);
  return `${SHOPIFY_TAP_AUTH_BASE}/${encodeURIComponent(id)}?redirectedFrom=${redirectedFrom}`;
}

function shopifyAuthStatusFromBinding(status) {
  return status?.connected ? 'connected' : 'unconnected';
}

function shopifyAccountLabel(binding) {
  if (!binding?.connected) return 'Not connected';
  return (
    binding.shopDomain ||
    binding.shop ||
    binding.email ||
    (binding.shopifyCustomerId ? `Customer ${binding.shopifyCustomerId}` : 'Connected Shopify account')
  );
}

function tierReceiptSessionKey(touchId, cycleId, tier) {
  return `fc_receipt_tier_${touchId}_${cycleId ?? 'none'}_${tier ?? 'unknown'}`;
}

/** 非首次回访:有 welcome 标记、已领券缓存、或历史 plan 缓存 */
function isReturnVisitor(touchId) {
  if (!touchId) return false;
  return (
    readWelcomeCompleted(touchId) ||
    !!readClaimRecord(touchId)?.code ||
    !!readCachedRewardPlan(touchId)
  );
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

const COUPON_THEME = 'pop'; // Switch to 'dtc' to apply the premium coupon palette globally.

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
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
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

function formatExpiryDate(totalSeconds) {
  const safe = Math.max(totalSeconds, 0);
  const expiry = new Date(Date.now() + safe * 1000);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(expiry);
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
  const pendingTapRewardRef = useRef(0);
  const pendingTapTargetRef = useRef(0);
  const pendingRewardKindRef = useRef('tap');
  const playPendingTapRewardRef = useRef(() => {});
  const returnIntroShownRef = useRef(false);
  const returnIntroPendingRef = useRef(false);
  const newChallengeRenewRef = useRef(null);
  const renewPlanRef = useRef(null);
  const renewFlowActiveRef = useRef(false);
  const applyRenewPlanAfterGiftRef = useRef(null);
  const zoomCenteredOpenRef = useRef(false);
  const zoomAfterCloseRef = useRef(null);
  const shopifyPendingRef = useRef(null);
  const devPreviewActiveRef = useRef(false);
  const devSceneRef = useRef('');
  const magnetBrandParamRef = useRef(null);

  const touchId = useTouchId();
  const [devScene, setDevScene] = useState(() => getDevScene());
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState(null);
  const [rewardPlanId, setRewardPlanId] = useState(null);
  const [brand, setBrand] = useState({ name: null, logoUrl: null, primaryColor: null, shopUrl: '#' });
  const [challenges, setChallenges] = useState(FALLBACK_CHALLENGES);
  const [gameStart, setGameStart] = useState(null);
  const [gameModalTitle, setGameModalTitle] = useState('Play & Earn');
  const [gameLoadingMessage, setGameLoadingMessage] = useState('Preparing game…');
  const [surveyAnswers, setSurveyAnswers] = useState([]);
  const [welcomeStep, setWelcomeStep] = useState(() => (isReturnVisitor(getTouchId()) ? 3 : 0));
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
  const [receiptCoupon, setReceiptCoupon] = useState(null);
  const [forceWalletView, setForceWalletView] = useState(false);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);
  const [introActive, setIntroActive] = useState(() => isReturnVisitor(getTouchId()));
  const [returnIntroGate, setReturnIntroGate] = useState(() => isReturnVisitor(getTouchId()));
  const [renewGiftIntro, setRenewGiftIntro] = useState(false);
  const [renewFlowActive, setRenewFlowActive] = useState(false);
  const [renewPlanReady, setRenewPlanReady] = useState(false);
  const [pendingRewardSignal, setPendingRewardSignal] = useState(0);
  const closeIntro = useCallback(() => setIntroActive(false), []);
  const [hasInitialDiscount, setHasInitialDiscount] = useState(false);

  const [shopifyAuthStatus, setShopifyAuthStatus] = useState(() => {
    const cached = readCachedShopifyStatus(getTouchId());
    return shopifyAuthStatusFromBinding(cached);
  });
  const [shopifyBinding, setShopifyBinding] = useState(() => readCachedShopifyStatus(getTouchId()));
  const [shopifyAuthSkipCount, setShopifyAuthSkipCount] = useState(0);
  const [shopifyAuthLastSkippedAt, setShopifyAuthLastSkippedAt] = useState(null);
  const [getMoreOffAuthPromptSeen, setGetMoreOffAuthPromptSeen] = useState(false);
  const [shopifyLoginTaskStatus, setShopifyLoginTaskStatus] = useState('incomplete');
  const [shopifyAuthOverlay, setShopifyAuthOverlay] = useState(null);
  const [shopifyAccountOpen, setShopifyAccountOpen] = useState(false);
  const [shopifyAuthSuccess, setShopifyAuthSuccess] = useState(false);

  const syncShopifyBindingStatus = useCallback(async (forceRefresh = false) => {
    if (devPreviewActiveRef.current) {
      const cached = readCachedShopifyStatus(touchId);
      setShopifyBinding(cached);
      setShopifyAuthStatus(shopifyAuthStatusFromBinding(cached));
      return cached;
    }
    if (forceRefresh) clearCachedShopifyStatus(touchId);
    const cached = !forceRefresh ? readCachedShopifyStatus(touchId) : null;
    if (cached) {
      setShopifyBinding(cached);
      setShopifyAuthStatus(shopifyAuthStatusFromBinding(cached));
    }
    try {
      const status = await fetchShopifyStatus(touchId, { refresh: true });
      writeCachedShopifyStatus(touchId, status);
      setShopifyBinding(status);
      setShopifyAuthStatus(shopifyAuthStatusFromBinding(status));
      return status;
    } catch (err) {
      dbgError('[FCDBG][App] fetch shopify status failed', err);
      if (!cached) {
        setShopifyBinding(null);
        setShopifyAuthStatus('unconnected');
      }
      return null;
    }
  }, [touchId]);

  const applyMagnetBrandParam = useCallback((param) => {
    if (!param) return;
    const nextBrand = brandFromMagnetParam(param);
    setBrand((prev) => ({
      ...prev,
      ...nextBrand,
    }));
    applyBrandCssVar(nextBrand.primaryColor);
  }, []);

  const syncMagnetBrandParam = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = readCachedMagnetBrandParam(touchId);
      if (cached) {
        magnetBrandParamRef.current = cached;
        applyMagnetBrandParam(cached);
      }
    }
    try {
      const param = await fetchMagnetBrandParam(touchId, { refresh: forceRefresh });
      if (param) {
        writeCachedMagnetBrandParam(touchId, param);
        magnetBrandParamRef.current = param;
        applyMagnetBrandParam(param);
      } else {
        magnetBrandParamRef.current = null;
      }
      return param;
    } catch (err) {
      dbgError('[FCDBG][App] fetch magnet brand param failed', err);
      return magnetBrandParamRef.current;
    }
  }, [applyMagnetBrandParam, touchId]);

  const shopifyTask = useMemo(() => {
    if (!needsShopifyAuth()) return null;
    return {
      id: 'shopify_connect',
      type: 'shopify_connect',
      badge: shopifyAuthStatus === 'expired' ? 'Reconnect' : 'Shopify',
      icon: '🛍️',
      title: shopifyAuthStatus === 'expired' ? 'Reconnect Shopify Account' : 'Connect Shopify Account',
      desc: shopifyAuthStatus === 'expired' ? 'Your connection expired. Reconnect to keep earning.' : 'Log in once and earn a big points boost.',
      reward: '+500 PTS',
      cta: 'Connect',
    };
  }, [shopifyAuthStatus]);

  const displayChallenges = useMemo(() => {
    if (!shopifyTask) return challenges;
    return [shopifyTask, ...challenges];
  }, [shopifyTask, challenges]);

  const [isWelcomeVideoActive, setIsWelcomeVideoActive] = useState(false);
  const [welcomeVideoFading, setWelcomeVideoFading] = useState(false);
  const welcomeVideoRef = useRef(null);
  const welcomeVideoFallbackTimerRef = useRef(null);

  const handleWelcomeVideoEnd = useCallback(() => {
    if (welcomeVideoFading) return;
    if (welcomeVideoFallbackTimerRef.current) {
      window.clearTimeout(welcomeVideoFallbackTimerRef.current);
      welcomeVideoFallbackTimerRef.current = null;
    }
    setWelcomeVideoFading(true);

    if (renewFlowActiveRef.current) {
      void applyRenewPlanAfterGiftRef.current?.();
    } else if (welcomeStep >= 3) {
      returnIntroShownRef.current = true;
      returnIntroPendingRef.current = false;
      setReturnIntroGate(false);
      setIntroActive(false);
      setPendingRewardSignal((value) => value + 1);
      if (!planLoading) {
        window.setTimeout(() => playPendingTapRewardRef.current(), 760);
      }
    } else {
      // 立即触发拆开礼包过渡到 WelcomeRitual 页面 (welcomeStep -> 1, introActive -> false)
      setWelcomeStep(1);
      setIntroActive(false);
    }

    if (navigator.vibrate) {
      navigator.vibrate(60);
    }

    setTimeout(() => {
      setIsWelcomeVideoActive(false);
      setWelcomeVideoFading(false);
    }, 500);
  }, [planLoading, welcomeStep, welcomeVideoFading]);

  // 同步礼盒视频状态:首登和回访礼盒都直接播放同一段开场动画。
  useEffect(() => {
    if ((welcomeStep === 0 || welcomeStep >= 3) && introActive) {
      setIsWelcomeVideoActive(true);
      setWelcomeVideoFading(false);
    } else {
      // 如果是非渐淡退出的切换，立即关闭视频
      setIsWelcomeVideoActive((prev) => (welcomeVideoFading ? prev : false));
    }
  }, [welcomeStep, introActive, welcomeVideoFading]);

  useEffect(() => {
    if (isWelcomeVideoActive && welcomeVideoRef.current) {
      welcomeVideoRef.current.currentTime = 0;
      welcomeVideoFallbackTimerRef.current = window.setTimeout(() => {
        handleWelcomeVideoEnd();
      }, 7000);
      welcomeVideoRef.current.play().catch((e) => {
        console.log("React welcome video play error:", e);
        window.setTimeout(() => handleWelcomeVideoEnd(), 600);
      });
    }
    return () => {
      if (welcomeVideoFallbackTimerRef.current) {
        window.clearTimeout(welcomeVideoFallbackTimerRef.current);
        welcomeVideoFallbackTimerRef.current = null;
      }
    };
  }, [handleWelcomeVideoEnd, isWelcomeVideoActive]);

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

  const syncFromPlan = useCallback((plan, { fromCache = false, devPreview = false, fromNewChallengeRenew = false } = {}) => {
    const renewInProgress = Boolean(newChallengeRenewRef.current || renewFlowActiveRef.current);
    let claimRecord = readClaimRecord(touchId);
    if (
      claimRecord?.cycleId &&
      plan.cycleId &&
      claimRecord.cycleId !== plan.cycleId
    ) {
      clearClaimedCode(touchId);
      claimRecord = null;
    }
    const vm = mapPlanToViewModel(plan, claimRecord, magnetBrandParamRef.current);
    setRewardPlanId(vm.rewardPlanId);
    setDiscounts(vm.discounts.length ? vm.discounts : INITIAL_DISCOUNTS);
    setCurrentStepIndex(vm.currentStepIndex);
    setCountdownSeconds(vm.countdownSeconds);
    setBrand(vm.brand);
    setChallenges(vm.challenges.length ? vm.challenges : FALLBACK_CHALLENGES);
    setDailyCapReached(vm.dailyCapReached);
    setHasInitialDiscount(vm.hasInitialDiscount);
    setWelcomeTargetPoints(vm.points);

    if (devPreview) {
      setPoints(vm.points);
      if (vm.brand.primaryColor) {
        document.documentElement.style.setProperty('--brand-primary', vm.brand.primaryColor);
      }
      return vm;
    }

    const welcomeDone = readWelcomeCompleted(touchId);
    const welcomeInProgress = vm.hasInitialDiscount && !welcomeDone;
    const storedClaim = claimRecord?.code ?? null;
    const redeemedMatch =
      (vm.recentlyRedeemedCoupon &&
        storedClaim &&
        vm.recentlyRedeemedCoupon.couponCode === storedClaim) ||
      vm.couponRedeemed;
    const tapAwarded = vm.tapReward?.awarded ?? 0;
    const shopifyAwarded = vm.shopifyReward?.awarded ?? 0;
    const entryAwarded = shopifyAwarded > 0 ? shopifyAwarded : tapAwarded;
    const entryKind = shopifyAwarded > 0 ? 'shopify' : 'tap';
    const tapFxKey = `fc_tap_fx_${touchId}`;
    const shopifyFxKey = `fc_shopify_fx_${touchId}`;
    const entryFxPlayed =
      entryKind === 'shopify'
        ? sessionStorage.getItem(shopifyFxKey)
        : sessionStorage.getItem(tapFxKey);
    const blocksEntryReward =
      fromCache ||
      entryAwarded <= 0 ||
      vm.cycleExpired ||
      redeemedMatch ||
      !!storedClaim;
    const deferEntryFx =
      !blocksEntryReward &&
      (welcomeInProgress || (welcomeDone && !entryFxPlayed));

    if (!renewInProgress) {
      pendingTapTargetRef.current = vm.points;
      if (shopifyAwarded > 0) {
        setShopifyLoginTaskStatus('completed');
      }
      if (deferEntryFx) {
        pendingRewardKindRef.current = entryKind;
        pendingTapRewardRef.current = entryAwarded;
        setPendingRewardSignal((value) => value + 1);
        setPoints(Math.max(0, vm.points - entryAwarded));
      } else {
        pendingTapRewardRef.current = 0;
        pendingRewardKindRef.current = 'tap';
        setPoints(vm.points);
      }
    }

    const isReturnVisit =
      welcomeDone ||
      !!storedClaim ||
      returnIntroPendingRef.current;
    const shouldShowReturnIntro =
      isReturnVisit &&
      !welcomeInProgress &&
      !fromCache &&
      !vm.cycleExpired &&
      !redeemedMatch &&
      !returnIntroShownRef.current &&
      !renewFlowActiveRef.current;

    if (!fromNewChallengeRenew && !renewInProgress) {
      if (welcomeInProgress) {
        setIntroActive(welcomeStep === 0);
      } else if (shouldShowReturnIntro || returnIntroPendingRef.current) {
        // 非首次回访:礼盒与 plan 并行,结束后再进首页
        if (!welcomeDone) writeWelcomeCompleted(touchId);
        setWelcomeStep(3);
        setIntroActive(true);
        setReturnIntroGate(true);
        returnIntroPendingRef.current = true;
      } else if (!returnIntroPendingRef.current) {
        setIntroActive(false);
        setReturnIntroGate(false);
        if (!vm.hasInitialDiscount) {
          setWelcomeStep(3);
          if (!welcomeDone) writeWelcomeCompleted(touchId);
        }
      }
    }

    if (vm.brand.primaryColor) {
      document.documentElement.style.setProperty('--brand-primary', vm.brand.primaryColor);
    }

    // 过渡页仅在权威 plan 同步时更新,避免缓存 plan 误触发 expired NC
    if (!fromCache) {
      if (fromNewChallengeRenew || renewInProgress) {
        setNewChallenge(null);
      } else if (redeemedMatch && storedClaim) {
        clearClaimedCode(touchId);
        setClaimedCode(null);
        setNewChallenge({ reason: 'redeemed' });
        setIntroActive(false);
        setReturnIntroGate(false);
        returnIntroPendingRef.current = false;
      } else if (vm.cycleExpired && !welcomeInProgress) {
        if (storedClaim) {
          clearClaimedCode(touchId);
          setClaimedCode(null);
        }
        setNewChallenge((prev) => prev ?? { reason: 'expired' });
        setIntroActive(false);
        setReturnIntroGate(false);
        returnIntroPendingRef.current = false;
      } else {
        setNewChallenge((prev) => {
          if (!vm.cycleExpired && prev?.reason === 'expired') return null;
          if (!redeemedMatch && prev?.reason === 'redeemed') return null;
          return prev;
        });
        if (vm.couponClaimed && vm.claimedCouponCode) {
          const cycleId = plan.cycleId ?? plan.rewardPlanId;
          writeClaimRecord(touchId, {
            code: vm.claimedCouponCode,
            couponId: plan.observedCoupon?.couponId,
            tier: plan.observedCoupon?.tier,
            cycleId,
          });
          setClaimedCode(vm.claimedCouponCode);
        }
      }
    } else if (vm.couponClaimed && vm.claimedCouponCode) {
      const cycleId = plan.cycleId ?? plan.rewardPlanId;
      writeClaimRecord(touchId, {
        code: vm.claimedCouponCode,
        couponId: plan.observedCoupon?.couponId,
        tier: plan.observedCoupon?.tier,
        cycleId,
      });
      setClaimedCode(vm.claimedCouponCode);
    }

    if (claimRecord?.code) {
      setClaimedCode(claimRecord.code);
    }

    if (!fromNewChallengeRenew && !renewInProgress && vm.awaitingNewChallenge) {
      setNewChallenge({ reason: 'redeemed' });
      setIntroActive(false);
      setReturnIntroGate(false);
    }

    return vm;
  }, [touchId, welcomeStep]);

  const applyDevPreviewScene = useCallback((sceneId) => {
    const resolved = resolveDevScene(sceneId);
    if (!resolved) {
      setPlanError(`Unknown dev scene: ${sceneId}`);
      setPlanLoading(false);
      return;
    }

    clearGameSessionCache();
    setPlanError(null);
    setPlanLoading(false);
    setNewChallenge(null);
    setShowReceipt(false);
    setReceiptCoupon(null);
    setZoomActive(false);
    setClaimConfirm(null);
    setNotification(null);
    setActiveModal(null);

    const vm = syncFromPlan(resolved.plan, { devPreview: true });
    applyDevSceneUi(resolved.ui, {
      touchId,
      rewardPlanId: vm.rewardPlanId,
      planCycleId: resolved.plan.cycleId,
      setters: {
        setWelcomeStep,
        setIntroActive,
        setClaimedCode,
        setNewChallenge,
        setActiveModal,
        setSurveyStep,
        setNotification,
        setClaimConfirm,
        setShowReceipt,
        setReceiptCoupon,
        setPendingPoints,
        setReceiptColors,
        setZoomActive,
        setZoomPhase,
        setZoomCoupon,
        setZoomColors,
        setZoomRect,
        setZoomCopyState,
        setGameStart,
        setGameModalTitle,
        setShopifyBinding,
        setShopifyAuthStatus,
        writeCachedShopifyStatus,
        clearCachedShopifyStatus,
        points: vm.points,
        discounts: vm.discounts.length ? vm.discounts : INITIAL_DISCOUNTS,
        currentStepIndex: vm.currentStepIndex,
        readCouponTokens,
        targetCouponRef,
        viewportRef,
      },
    });

    const devTap = DEV_SCENE_TAP[sceneId];
    if (devTap) {
      pendingTapRewardRef.current = devTap.pending;
      setPendingRewardSignal((value) => value + 1);
      setPoints(devTap.points);
    }

    if (sceneId === 'return-visit') {
      sessionStorage.removeItem(`fc_tap_fx_${touchId}`);
      returnIntroPendingRef.current = true;
      returnIntroShownRef.current = false;
      setReturnIntroGate(true);
    } else {
      setReturnIntroGate(false);
    }
  }, [
    clearGameSessionCache,
    syncFromPlan,
    touchId,
  ]);

  const reloadPlan = useCallback(async ({ refresh = false } = {}) => {
    if (devPreviewActiveRef.current) {
      const resolved = resolveDevScene(devSceneRef.current || 'home');
      if (resolved) {
        syncFromPlan(resolved.plan, { devPreview: true });
        return resolved.plan;
      }
    }

    const plan = await fetchRewardPlan(touchId, { refresh });
    clearGameSessionCache();
    writeCachedRewardPlan(touchId, plan);
    if (newChallengeRenewRef.current || renewFlowActiveRef.current) {
      syncFromPlan(plan, { fromNewChallengeRenew: true });
    } else {
      syncFromPlan(plan);
    }
    return plan;
  }, [clearGameSessionCache, syncFromPlan, touchId]);

  // 领取:调用 redeem 发券,持久化本周期券码,返回带 code 的 coupon 供 Zoom 展示。
  const issueClaimedCoupon = useCallback(async (coupon) => {
    if (devPreviewActiveRef.current) {
      const code = coupon?.code || `DEV${coupon?.num ?? '15'}`;
      const withCode = couponWithCode(coupon, code);
      writeClaimRecord(touchId, { code, couponId: coupon?.couponId, tier: coupon?.tier });
      setClaimedCode(code);
      setDiscounts((prev) => applyClaimToDiscounts(prev, { code, couponId: coupon?.couponId, tier: coupon?.tier }));
      return { code, cycleClosed: false, coupon: withCode };
    }

    if (!rewardPlanId) throw new Error('Reward plan is not ready yet');
    const couponId = coupon?.couponId ?? coupon?.campaignId;
    if (!couponId) throw new Error('No coupon for this tier');

    const issued = await claimCoupon(touchId, rewardPlanId, couponId);
    const code = issued?.couponCode ?? coupon?.code;
    if (!code) throw new Error('No coupon code returned');

    const claim = {
      code,
      couponId: issued.couponId ?? couponId,
      tier: coupon?.tier,
      cycleId: rewardPlanId,
    };
    writeClaimRecord(touchId, claim);
    clearCachedRewardPlan(touchId);
    setClaimedCode(code);
    setDiscounts((prev) => applyClaimToDiscounts(prev, claim));
    return {
      code,
      cycleClosed: Boolean(issued.cycleClosed),
      coupon: couponWithCode(coupon, code),
    };
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
    const advanceWelcome = () => {
      setWelcomeStep(2);
      reloadPlan().catch((err) => {
        dbgError('[FCDBG][App] welcome earn more reload failed', err);
      });
    };

    if (needsShopifyAuth() && !getMoreOffAuthPromptSeen) {
      showShopifyAuth('get_more_off', advanceWelcome);
      return;
    }
    advanceWelcome();
  }, [reloadPlan, shopifyAuthStatus, getMoreOffAuthPromptSeen]);

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
    if (!isDevPreviewEnabled()) return;
    const syncSceneFromUrl = () => setDevScene(getDevScene());
    window.addEventListener('popstate', syncSceneFromUrl);
    return () => window.removeEventListener('popstate', syncSceneFromUrl);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (isDevPreviewEnabled() && devScene) {
      applyDevPreviewScene(devScene);
      return () => {
        cancelled = true;
      };
    }

    const returnVisitorOnEntry = isReturnVisitor(touchId);
    setWelcomeStep(returnVisitorOnEntry ? 3 : 0);
    setClaimedCode(readClaimRecord(touchId)?.code ?? null);
    setNewChallenge(null);
    const hadCachedPlan = Boolean(readCachedRewardPlan(touchId));
    setPlanLoading(!hadCachedPlan);
    setPlanError(null);
    setRewardPlanId(null);
    clearGameSessionCache();

    rememberTouchId(touchId);
    returnIntroShownRef.current = false;
    returnIntroPendingRef.current = false;

    const shopifyOAuthReturn = isShopifyOAuthPending(touchId);

    // 非首次 tap:立即播回访礼盒,与 plan 请求并行(Shopify 授权回流时不播礼盒,直接进登录积分动效)
    if (returnVisitorOnEntry && !shopifyOAuthReturn) {
      if (!readWelcomeCompleted(touchId)) writeWelcomeCompleted(touchId);
      sessionStorage.removeItem(`fc_tap_fx_${touchId}`);
      returnIntroPendingRef.current = true;
      setReturnIntroGate(true);
      setWelcomeStep(3);
      setIntroActive(true);
    } else if (shopifyOAuthReturn) {
      returnIntroShownRef.current = true;
      returnIntroPendingRef.current = false;
      setReturnIntroGate(false);
      setIntroActive(false);
      setWelcomeStep(3);
    } else {
      setReturnIntroGate(false);
      setIntroActive(false);
    }

    preloadRuntimeManifest(touchId).catch((err) => {
      dbgError('[FCDBG][App] runtime manifest preload failed', err);
    });

    magnetBrandParamRef.current = readCachedMagnetBrandParam(touchId);
    if (magnetBrandParamRef.current) {
      applyMagnetBrandParam(magnetBrandParamRef.current);
    }

    const cached = readCachedRewardPlan(touchId);
    if (cached && !shopifyOAuthReturn) {
      syncFromPlan(cached, { fromCache: true });
      setPlanLoading(false);
    }

    (async () => {
      try {
        await syncMagnetBrandParam();
        if (cancelled) return;

        const status = await syncShopifyBindingStatus(true);
        if (cancelled) return;

        if (status?.connected && shopifyOAuthReturn && consumeShopifyOAuthPending(touchId)) {
          setShopifyLoginTaskStatus('completed');
          setShopifyAuthOverlay(null);
          clearCachedRewardPlan(touchId);
          setPlanLoading(true);
          setPlanError(null);
          const plan = await fetchRewardPlan(touchId, { refresh: true });
          if (cancelled) return;
          clearGameSessionCache();
          writeCachedRewardPlan(touchId, plan);
          syncFromPlan(plan);
          return;
        }

        if (!cached || shopifyOAuthReturn) setPlanLoading(true);
        setPlanError(null);
        const plan = await fetchRewardPlan(touchId, { refresh: shopifyOAuthReturn });
        if (!cancelled) {
          clearGameSessionCache();
          writeCachedRewardPlan(touchId, plan);
          if (newChallengeRenewRef.current || renewFlowActiveRef.current) {
            syncFromPlan(plan, { fromNewChallengeRenew: true });
          } else {
            syncFromPlan(plan);
          }
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
  }, [applyDevPreviewScene, applyMagnetBrandParam, clearGameSessionCache, devScene, syncFromPlan, syncMagnetBrandParam, syncShopifyBindingStatus, touchId]);

  useEffect(() => {
    const onPageShow = async () => {
      const status = await syncShopifyBindingStatus(true);
      if (!status?.connected || !isShopifyOAuthPending(touchId)) return;
      if (!consumeShopifyOAuthPending(touchId)) return;

      returnIntroShownRef.current = true;
      returnIntroPendingRef.current = false;
      setReturnIntroGate(false);
      setIntroActive(false);
      setWelcomeStep(3);
      setShopifyLoginTaskStatus('completed');
      setShopifyAuthOverlay(null);

      try {
        clearCachedRewardPlan(touchId);
        await reloadPlan({ refresh: true });
      } catch (err) {
        dbgError('[FCDBG][App] shopify oauth return reload failed', err);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [reloadPlan, syncShopifyBindingStatus, touchId]);

  const current = discounts[currentStepIndex] || discounts[discounts.length - 1] || { num: '15', target: 0, tier: 1 };
  const currentTier = current.tier ?? currentStepIndex + 1;
  const nextThreshold = nextTierThresholdFromDiscounts(discounts, currentTier);
  const targetPoints = nextThreshold ?? current?.target ?? 0;
  const next = nextThreshold != null ? discounts.find((d) => d.tier === currentTier + 1) ?? null : null;
  const progressPct = nextThreshold != null ? Math.min((points / targetPoints) * 100, 100) : 100;
  const delta = nextThreshold != null ? Math.max(targetPoints - points, 0) : 0;
  const isBestOffer = nextThreshold == null;
  // 已领取未核销:强制锁定在最低折扣页,直到后端确认核销。
  // 注意：如果已领取的优惠券是第一张欢迎券(15% OFF)，不能锁定/改住钱包页面，以允许用户继续挑战更高档位。
  const claimRecord = readClaimRecord(touchId);
  const showClaimedScreen = Boolean(
    !newChallenge &&
    claimedCode &&
    rewardPlanId &&
    claimRecord?.code === claimedCode &&
    claimRecord?.cycleId === rewardPlanId,
  );
  const showBestOffer = (showClaimedScreen || isBestOffer) && !forceWalletView;
  const lockedCoupon = claimedCode
    ? (discounts.find((d) => d.code === claimedCode) || current)
    : current;
  const isCurrentCouponClaimed = showClaimedScreen;
  const isExpired = countdownSeconds <= 0;
  const time = useMemo(() => formatCountdown(countdownSeconds), [countdownSeconds]);
  const expiryDate = useMemo(() => formatExpiryDate(countdownSeconds), [countdownSeconds]);
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

  // 「新挑战开启页」CTA:先播礼盒,并行 renew → 欢迎流(如需) → 首页 → +5
  function handleStartNewChallenge() {
    const reason = newChallenge?.reason ?? 'expired';
    const renewReason = reason === 'redeemed' ? 'redeemed' : 'expired';

    const promise = renewCycle(touchId, renewReason)
      .then((plan) => {
        clearCachedRewardPlan(touchId);
        writeCachedRewardPlan(touchId, plan);
        renewPlanRef.current = plan;
        setRenewPlanReady(true);
        return plan;
      })
      .catch((err) => {
        dbgError('[FCDBG][App] start new challenge failed', err);
        newChallengeRenewRef.current = null;
        renewPlanRef.current = null;
        renewFlowActiveRef.current = false;
        setRenewFlowActive(false);
        setRenewPlanReady(false);
        setRenewGiftIntro(false);
        setNewChallenge({ reason });
        setIntroActive(false);
        setReturnIntroGate(false);
        showNotification(
          'Could not start new challenge',
          formatFcError(err, 'Please check your connection and try again.'),
          '⚠️',
        );
        throw err;
      });
    newChallengeRenewRef.current = { promise, reason };
    renewPlanRef.current = null;
    renewFlowActiveRef.current = true;
    setRenewFlowActive(true);
    setRenewPlanReady(false);

    setNewChallenge(null);
    setShowReceipt(false);
    setZoomActive(false);
    setClaimConfirm(null);
    clearClaimedCode(touchId);
    setClaimedCode(null);

    clearWelcomeCompleted(touchId);
    sessionStorage.removeItem(`fc_tap_fx_${touchId}`);
    pendingTapRewardRef.current = 0;
    returnIntroShownRef.current = true;
    returnIntroPendingRef.current = false;

    setWelcomeStep(0);
    setPoints(0);
    setRenewGiftIntro(true);
    setReturnIntroGate(true);
    setIntroActive(true);
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

  // 已领券态：轮询券系统 lookup，核销/过期后进入新挑战
  useEffect(() => {
    if (!showClaimedScreen || devPreviewActiveRef.current || !touchId) return undefined;

    const poll = async () => {
      try {
        const result = await observeCoupon(touchId);
        if (result.cycleClosed) {
          if (newChallengeRenewRef.current || renewFlowActiveRef.current) return;
          const reason =
            result.couponStatus === 'expired' || result.isValid === false ? 'expired' : 'redeemed';
          clearCachedRewardPlan(touchId);
          await reloadPlan();
          if (newChallengeRenewRef.current || renewFlowActiveRef.current) return;
          setNewChallenge({ reason });
        } else if (result.couponStatus) {
          const record = readClaimRecord(touchId);
          if (record?.code) {
            writeClaimRecord(touchId, { ...record, observedStatus: result.couponStatus });
          }
        }
      } catch (err) {
        dbgError('[FCDBG][App] coupon observe failed', err);
      }
    };

    poll();
    const id = window.setInterval(poll, 45_000);
    return () => window.clearInterval(id);
  }, [reloadPlan, showClaimedScreen, touchId]);

  useEffect(() => () => {
    if (tearTimerRef.current) window.clearTimeout(tearTimerRef.current);
  }, []);

  const playPendingTapReward = useCallback(() => {
    const pts = pendingTapRewardRef.current;
    if (!pts || pts <= 0) return;
    const kind = pendingRewardKindRef.current === 'shopify' ? 'shopify' : 'tap';
    const fxKey = kind === 'shopify' ? `fc_shopify_fx_${touchId}` : `fc_tap_fx_${touchId}`;
    if (sessionStorage.getItem(fxKey)) {
      pendingTapRewardRef.current = 0;
      pendingRewardKindRef.current = 'tap';
      setPoints(pendingTapTargetRef.current || pointsRef.current);
      return;
    }
    sessionStorage.setItem(fxKey, '1');
    pendingTapRewardRef.current = 0;
    pendingRewardKindRef.current = 'tap';
    triggerLoginBonusAnimation(pts, pendingTapTargetRef.current || pointsRef.current + pts);
  }, [touchId]);

  const finishRenewFlowToHome = useCallback((vm) => {
    renewFlowActiveRef.current = false;
    setRenewFlowActive(false);
    setRenewPlanReady(false);
    renewPlanRef.current = null;
    returnIntroShownRef.current = true;
    returnIntroPendingRef.current = false;
    setReturnIntroGate(false);
    setRenewGiftIntro(false);
    setIntroActive(false);

    const tapAwarded = vm.tapReward?.awarded ?? 0;
    pendingTapTargetRef.current = vm.points;
    if (tapAwarded > 0) {
      pendingTapRewardRef.current = tapAwarded;
      setPoints(Math.max(0, vm.points - tapAwarded));
      window.setTimeout(() => playPendingTapReward(), 280);
    } else {
      setPoints(vm.points);
    }
  }, []);

  const applyRenewPlanAfterGift = useCallback(async () => {
    if (!renewFlowActiveRef.current) return;

    const pending = newChallengeRenewRef.current;
    let plan = renewPlanRef.current;
    if (!plan && pending) {
      try {
        plan = await pending.promise;
        renewPlanRef.current = plan;
        setRenewPlanReady(true);
      } catch {
        return;
      }
    }
    if (!plan) return;

    newChallengeRenewRef.current = null;
    setRenewGiftIntro(false);
    setIntroActive(false);
    setReturnIntroGate(false);

    const vm = syncFromPlan(plan, { fromNewChallengeRenew: true });
    const welcomeNeeded = vm.hasInitialDiscount && !readWelcomeCompleted(touchId);

    if (welcomeNeeded) {
      const tapAwarded = vm.tapReward?.awarded ?? 0;
      pendingTapTargetRef.current = vm.points;
      if (tapAwarded > 0) {
        pendingTapRewardRef.current = tapAwarded;
        setPoints(Math.max(0, vm.points - tapAwarded));
      } else {
        setPoints(vm.points);
      }
      setWelcomeStep(1);
      return;
    }

    writeWelcomeCompleted(touchId);
    setWelcomeStep(3);
    finishRenewFlowToHome(vm);
  }, [finishRenewFlowToHome, syncFromPlan, touchId]);

  useEffect(() => {
    applyRenewPlanAfterGiftRef.current = applyRenewPlanAfterGift;
  }, [applyRenewPlanAfterGift]);

  const finishReturnIntro = useCallback(() => {
    returnIntroShownRef.current = true;
    returnIntroPendingRef.current = false;
    setReturnIntroGate(false);
    setIntroActive(false);
  }, []);

  // 回访礼盒结束且首页就绪后再播 +5/Shopify(不在 intro 期间触发)
  useEffect(() => {
    if (introActive || planLoading || isWelcomeVideoActive || welcomeVideoFading) return undefined;
    if (!returnIntroShownRef.current) return undefined;
    if (!pendingTapRewardRef.current) return undefined;

    const kind = pendingRewardKindRef.current === 'shopify' ? 'shopify' : 'tap';
    const fxKey = kind === 'shopify' ? `fc_shopify_fx_${touchId}` : `fc_tap_fx_${touchId}`;
    if (sessionStorage.getItem(fxKey)) {
      pendingTapRewardRef.current = 0;
      pendingRewardKindRef.current = 'tap';
      setPoints(pendingTapTargetRef.current || pointsRef.current);
      return undefined;
    }

    const timer = window.setTimeout(() => playPendingTapReward(), 220);
    return () => window.clearTimeout(timer);
  }, [
    introActive,
    isWelcomeVideoActive,
    pendingRewardSignal,
    planLoading,
    playPendingTapReward,
    touchId,
    welcomeVideoFading,
  ]);

  // 进页时积分已够下一档门槛 → 补触发 receipt(不仅依赖 creditPoints 动画)
  useEffect(() => {
    if (introActive || planLoading || isWelcomeVideoActive || welcomeVideoFading) return undefined;
    if (returnIntroPendingRef.current && !returnIntroShownRef.current) return undefined;
    if (welcomeStep < 3 && hasInitialDiscount && !readWelcomeCompleted(touchId)) return undefined;
    if (showReceipt || newChallenge || showClaimedScreen) return undefined;
    if (pendingTapRewardRef.current > 0) return undefined;
    if (!next || nextThreshold == null || points < targetPoints) return undefined;

    const unlocked = resolveUnlockedCoupon(discounts, currentStepIndex);
    if (!unlocked?.tier) return undefined;
    const receiptKey = tierReceiptSessionKey(touchId, rewardPlanId, unlocked.tier);
    if (sessionStorage.getItem(receiptKey)) return undefined;

    const timer = window.setTimeout(() => {
      if (sessionStorage.getItem(receiptKey)) return;
      triggerCelebration(points);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    currentStepIndex,
    discounts,
    hasInitialDiscount,
    introActive,
    isWelcomeVideoActive,
    newChallenge,
    next,
    nextThreshold,
    planLoading,
    points,
    pendingRewardSignal,
    rewardPlanId,
    showClaimedScreen,
    showReceipt,
    targetPoints,
    touchId,
    welcomeStep,
    welcomeVideoFading,
  ]);

  function triggerLoginBonusAnimation(pts, targetBalance) {
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
          creditPoints(pts, 600, targetBalance);
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


  function resolveUnlockedCoupon(discountList, stepIndex) {
    return discountList[stepIndex + 1] ?? discountList[stepIndex] ?? discountList[0] ?? null;
  }

  function closeReceipt() {
    setShowReceipt(false);
    setReceiptCoupon(null);
  }

  function showNotification(title, message, icon = '✨', onConfirm = null) {
    setNotification({ title, message, icon, onConfirm });
  }

  function confirmNotification() {
    const onConfirm = notification?.onConfirm;
    setNotification(null);
    if (onConfirm) onConfirm();
  }

  function needsShopifyAuth() {
    return shopifyAuthStatus !== 'connected';
  }

  function scrollToEarnSection() {
    const section = document.querySelector('.earn-progress-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const scroller = document.querySelector('.content-area');
    if (scroller) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    }
  }

  function openClaimConfirm(onConfirm, discount) {
    setForceWalletView(false);
    setClaimConfirm({ onConfirm, discount });
  }

  function scheduleShopifyResume(resume) {
    if (typeof resume !== 'function') return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          resume();
        } catch (err) {
          dbgError('[FCDBG][App] shopify skip resume failed', err);
        }
      });
    });
  }

  function showShopifyAuth(source, resume = null) {
    shopifyPendingRef.current = { source, resume: typeof resume === 'function' ? resume : null };
    setShopifyAccountOpen(false);
    setShopifyAuthOverlay({ source });
  }

  function openShopifyAccountEntry() {
    const cached = readCachedShopifyStatus(touchId);
    const binding = shopifyBinding?.connected ? shopifyBinding : cached;
    if (binding?.connected || shopifyAuthStatus === 'connected') {
      setShopifyBinding(binding?.connected ? binding : { connected: true });
      setShopifyAccountOpen(true);
      return;
    }
    showShopifyAuth('account_entry');
  }

  function disconnectShopifyAccount() {
    clearCachedShopifyStatus(touchId);
    setShopifyBinding(null);
    setShopifyAuthStatus('unconnected');
    setShopifyLoginTaskStatus('incomplete');
    setShopifyAccountOpen(false);
    showNotification(
      'Shopify disconnected',
      'This device is no longer using a connected Shopify account.',
      '✓',
    );
  }

  function handleShopifyContinue() {
    const pending = shopifyPendingRef.current;
    const source = shopifyAuthOverlay?.source ?? pending?.source ?? '';
    markShopifyOAuthPending(touchId, source);
    shopifyPendingRef.current = null;
    clearCachedShopifyStatus(touchId);
    clearCachedRewardPlan(touchId);
    setShopifyAuthOverlay(null);
    window.location.href = buildShopifyAuthUrl(touchId);
  }

  function handleShopifySkip() {
    const pending = shopifyPendingRef.current;
    const source = shopifyAuthOverlay?.source ?? pending?.source;
    setShopifyAuthSkipCount((c) => c + 1);
    setShopifyAuthLastSkippedAt(new Date().toISOString());
    setShopifyAuthOverlay(null);
    shopifyPendingRef.current = null;

    if (source === 'get_more_off') {
      setGetMoreOffAuthPromptSeen(true);
    }

    // Skip should return to the page/state that opened Shopify auth, without continuing the gated action.
  }

  function handleShopifyAuthSuccess() {
    const pending = shopifyPendingRef.current;
    shopifyPendingRef.current = null;
    setShopifyLoginTaskStatus('completed');
    setShopifyAuthSuccess(true);
    setShopifyAuthOverlay(null);
    window.setTimeout(() => setShopifyAuthSuccess(false), 3500);
    void syncShopifyBindingStatus(true).then((status) => {
      if (status?.connected) {
        scheduleShopifyResume(pending?.resume);
      }
    });
  }

  // 任意「Claim now」：未登录时每次 soft gate，Skip 后接上领取确认弹窗（PRD §13.3）
  function requestClaim(onConfirm, discount) {
    if (needsShopifyAuth()) {
      showShopifyAuth('claim', () => openClaimConfirm(onConfirm, discount));
      return;
    }
    openClaimConfirm(onConfirm, discount);
  }

  function cancelClaim() {
    setClaimConfirm(null);
    setDrawerOpen(false); // 兜底关闭可能残留的券码抽屉，避免取消后底部冒出抽屉

    // 首次登录时如果用户取消领取，标记首登欢迎流程完成，进入真正的钱包首页
    if (welcomeStep < 3) {
      setWelcomeStep(3);
      writeWelcomeCompleted(touchId);
      setForceWalletView(true);
      if (pendingTapRewardRef.current > 0) {
        playPendingTapRewardRef.current();
      } else {
        tweenPointsTo(welcomeTargetPoints);
      }
    }

    if (showReceipt) {
      handleAccumulateMore(true);
    } else {
      scrollToEarnSection();
    }
  }

  async function confirmClaim() {
    const onConfirm = claimConfirm?.onConfirm;
    if (!onConfirm) {
      setClaimConfirm(null);
      return;
    }
    try {
      await onConfirm();
      setClaimConfirm(null);
    } catch {
      // onConfirm 已展示错误提示;保持弹窗可重试
    }
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
  function creditPoints(pts, duration = 600, absoluteTarget) {
    if (!pts && absoluteTarget == null) return;
    setForceWalletView(false);
    if (pointsTweenRef.current) {
      cancelAnimationFrame(pointsTweenRef.current);
      pointsTweenRef.current = null;
    }

    const from = points;
    const to = absoluteTarget ?? from + pts;

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
    const unlocked = resolveUnlockedCoupon(discounts, currentStepIndex);
    if (rewardPlanId && unlocked?.tier != null) {
      sessionStorage.setItem(tierReceiptSessionKey(touchId, rewardPlanId, unlocked.tier), '1');
    }
    setTargetPulse('ready unlocking');
    startConfetti();
    setReceiptCoupon(unlocked);
    setReceiptColors(readCouponTokens(targetCouponRef.current));
    setPendingPoints(updatedPoints);
    setShowReceipt(true);
    setTargetPulse('');
  }

  const handleTargetClick = () => {
    const unlocked = resolveUnlockedCoupon(discounts, currentStepIndex);
    setReceiptCoupon(unlocked);
    setReceiptColors(readCouponTokens(targetCouponRef.current));
    setPendingPoints(points);
    setShowReceipt(true);
  };

  async function handleUseReceiptCoupon() {
    const nextCoupon = receiptCoupon ?? resolveUnlockedCoupon(discounts, currentStepIndex);
    if (!nextCoupon) {
      showNotification('Coupon unavailable', 'No coupon tier available to claim.', '⚠️');
      throw new Error('No coupon tier available');
    }
    let result;
    try {
      setRedeemingCoupon(true);
      result = await issueClaimedCoupon(nextCoupon);
    } catch (err) {
      showNotification('Coupon unavailable', formatFcError(err, 'Could not issue coupon'), '⚠️');
      throw err;
    } finally {
      setRedeemingCoupon(false);
    }
    setShowReceipt(false);
    setReceiptCoupon(null);
    reloadPlan().catch((err) => {
      dbgError('[FCDBG][App] reload after receipt claim failed', err);
    });
    
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

    openCenteredZoomFlip(result.coupon);
  }

  function handleAccumulateMore(force = false) {
    const run = () => {
      closeReceipt();
      reloadPlan().catch((err) => {
        dbgError('[FCDBG][App] reload after accumulate failed', err);
      });
      setCurrentSwap(true);
      window.setTimeout(() => setCurrentSwap(false), 800);
    };

    if (!force && needsShopifyAuth() && !getMoreOffAuthPromptSeen) {
      showShopifyAuth('get_more_off', run);
      return;
    }
    run();
  }

  async function handleCopyCode() {
    const code = claimedCode || current.code;
    try {
      await copyText(code);
      setCopyState('Copied!');
      setTimeout(() => setCopyState('Copy'), 2000);
    } catch {
      setCopyState(code);
      setTimeout(() => setCopyState('Copy'), 3000);
    }
  }

  async function handleUseCoupon() {
    if (isExpired || isTearingCoupon || redeemingCoupon) return;

    setRedeemingCoupon(true);
    let result;
    try {
      result = await issueClaimedCoupon(current);
    } catch (err) {
      showNotification('Coupon unavailable', formatFcError(err, 'Could not issue coupon'), '⚠️');
      throw err;
    } finally {
      setRedeemingCoupon(false);
    }

    openCenteredZoomFlip(result.coupon);
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
      const unlocked = resolveUnlockedCoupon(discounts, currentStepIndex);
      setReceiptCoupon(unlocked);
      setReceiptColors(readCouponTokens(targetCouponRef.current));
      setPendingPoints(settlement.pointsBalance ?? points + pts);
      setShowReceipt(true);
      startConfetti();
      refreshPlan();
      return;
    }

    if (pts > 0) {
      const balanceAfter = settlement.pointsBalance ?? points + pts;
      const timing = getPointsEffectTiming(pts);
      const startPos = {
        x: (viewportRef.current?.clientWidth ?? 360) / 2,
        y: (viewportRef.current?.clientHeight ?? 640) * 0.42,
      };
      spawnGainCallout(pts);
      flyCoins(
        timing.count,
        () => {
          creditPoints(pts, timing.creditDuration, balanceAfter);
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
    let result;
    try {
      setRedeemingCoupon(true);
      result = await issueClaimedCoupon(current);
    } catch (err) {
      clearWelcomeCompleted(touchId);
      setWelcomeStep(prevStep);
      dbgError('[FCDBG][App] welcome claim failed', err);
      showNotification('Coupon unavailable', formatFcError(err, 'Please try again'), '⚠️');
      throw err;
    } finally {
      setRedeemingCoupon(false);
    }

    openCenteredZoomFlip(result.coupon);
    zoomAfterCloseRef.current = () => {
      window.setTimeout(() => playPendingTapRewardRef.current(), 400);
    };
  }, [current, issueClaimedCoupon, touchId, welcomeStep]);

  // Claim 成功后居中展示刮刮卡（与 dev scene=zoom 一致）
  function openCenteredZoomFlip(coupon) {
    const viewport = viewportRef.current;
    if (!viewport || !coupon) return false;

    const vpRect = viewport.getBoundingClientRect();
    const cardW = Math.min(vpRect.width * 0.82, 320);
    const cardH = cardW * 1.58;
    const faceEl = couponFaceRef.current;

    setZoomCoupon(coupon);
    setZoomColors(faceEl ? readCouponTokens(faceEl.closest('.coupon')) : null);
    setZoomCopyState('Copy');
    setZoomRect({
      left: vpRect.left + (vpRect.width - cardW) / 2,
      top: vpRect.top + (vpRect.height - cardH) / 2,
      width: cardW,
      height: cardH,
    });
    zoomCenteredOpenRef.current = true;
    setZoomPhase('flipped');
    setZoomActive(true);
    return true;
  }

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
    const afterClose = zoomAfterCloseRef.current;

    if (zoomCenteredOpenRef.current) {
      setZoomPhase('init');
      window.setTimeout(() => {
        setZoomActive(false);
        zoomCenteredOpenRef.current = false;
        zoomAfterCloseRef.current = null;
        afterClose?.();
      }, 380);
      return;
    }

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
        zoomAfterCloseRef.current = null;
        afterClose?.();
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
    if (challenge.type === 'shopify_connect') {
      showShopifyAuth('task_card');
      return;
    }

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

    // 动效不等接口：答完立即关弹窗，播放与 Tap +5 相同的金币动效。
    setActiveModal(null);
    setSurveyStep(0);
    setSurveyAnswers([]);

    const surveyReward = 10;
    const balanceBefore = pointsRef.current;
    triggerLoginBonusAnimation(surveyReward, balanceBefore + surveyReward);

    completeSurvey(touchId, rewardPlanId, nextAnswers)
      .then((settlement) => {
        if (settlement?.pointsAwarded === 0 && settlement?.pointsBalance != null) {
          setPoints(settlement.pointsBalance);
        }
        return reloadPlan();
      })
      .catch((err) => {
        dbgError('[FCDBG][App] background completeSurvey failed', err);
      });
  }

  playPendingTapRewardRef.current = playPendingTapReward;
  devSceneRef.current = devScene;
  devPreviewActiveRef.current = Boolean(devScene);

  const isReturnIntro = introActive && welcomeStep >= 3 && !renewGiftIntro && !renewFlowActive;
  const showBrandIntro =
    (introActive || renewGiftIntro) &&
    (renewGiftIntro || (!renewFlowActive && hasInitialDiscount) || isReturnIntro);
  const brandIntroIsWelcome = renewGiftIntro || welcomeStep < 3;
  const showHome = !introActive && !planLoading && !returnIntroGate && !renewGiftIntro;

  return (
    <div
      className="mobile-viewport"
      data-screen-label="优惠券首页"
      ref={viewportRef}
      style={brand.primaryColor ? { '--brand-primary': brand.primaryColor } : undefined}
    >
      <canvas id="confetti-canvas" ref={canvasRef} />
      {isWelcomeVideoActive && (
        <div 
          className="gift-video-container"
          style={{
            opacity: welcomeVideoFading ? 0 : 1,
            pointerEvents: welcomeVideoFading ? 'none' : 'auto'
          }}
          onClick={handleWelcomeVideoEnd}
        >
          <video
            ref={welcomeVideoRef}
            src="/打开礼包开场动画/首次开场动画.mov"
            playsInline
            webkit-playsinline="true"
            muted
            onEnded={handleWelcomeVideoEnd}
            onError={handleWelcomeVideoEnd}
            autoPlay
          />
        </div>
      )}
      {showBrandIntro && !isWelcomeVideoActive && (
        <BrandIntro 
          onComplete={brandIntroIsWelcome ? closeIntro : finishReturnIntro}
          brand={brand} 
          isWelcome={brandIntroIsWelcome}
          onOpenPackage={() => {
            if (renewFlowActive) {
              void applyRenewPlanAfterGift();
              return;
            }
            setWelcomeStep(1);
            setIntroActive(false);
          }}
        />
      )}

      {(planLoading || planError) && !introActive && !returnIntroGate && (
        <div className={`reward-sync-status ${planError ? 'error' : ''}`} role="status">
          {planError ? 'Using saved rewards. Refresh failed.' : 'Refreshing rewards…'}
        </div>
      )}

      {showHome && (
      <>
      <Header brand={brand} shopifyStatus={shopifyAuthStatus} onOpenShopifyAccount={openShopifyAccountEntry} />

      <main className="content-area">
        {showBestOffer ? (
          <BestCouponLockedPage
            coupon={lockedCoupon}
            time={time}
            expiryDate={expiryDate}
            tick={tick}
            countdownSeconds={countdownSeconds}
            isExpired={isExpired}
            couponFaceRef={couponFaceRef}
            claimed={showClaimedScreen}
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
              isClaimed={isCurrentCouponClaimed}
              onUse={isCurrentCouponClaimed ? handleShopNowDirect : () => requestClaim(handleUseCoupon, current.num)}
              onTearComplete={handleTearComplete}
              countdownSeconds={countdownSeconds}
              confirmOpen={!!claimConfirm}
              onTargetClick={handleTargetClick}
            />

            <Challenges challenges={displayChallenges} dailyCapReached={dailyCapReached} onOpen={openChallenge} />
            <RulesFooter rulesOpen={rulesOpen} onToggle={() => setRulesOpen((value) => !value)} />
          </>
        )}
      </main>
      </>
      )}

      {showHome && (
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
      )}

      <PlatformGameModal
        open={activeModal === 'platform-game'}
        title={gameModalTitle}
        gameStart={gameStart}
        brand={brand}
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
        <NewChallengeUnlocked
          reason={newChallenge.reason}
          onStart={handleStartNewChallenge}
          onDismiss={() => setNewChallenge(null)}
          prevCoupon={lockedCoupon}
        />
      )}

      {shopifyAuthOverlay && (
        <ShopifyAuthorizationPage
          brand={brand}
          source={shopifyAuthOverlay.source}
          onContinue={handleShopifyContinue}
          onSkip={handleShopifySkip}
        />
      )}

      {shopifyAccountOpen && (
        <ShopifyAccountPage
          brand={brand}
          binding={shopifyBinding}
          onClose={() => setShopifyAccountOpen(false)}
          onDisconnect={disconnectShopifyAccount}
        />
      )}

      {shopifyAuthSuccess && (
        <div className="shopify-auth-toast" role="status" aria-label="Shopify connected">
          <div className="shopify-auth-toast-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div className="shopify-auth-toast-text">
            <strong>Shopify connected</strong>
            <span>+500 pts earned</span>
          </div>
        </div>
      )}

      {isDevPreviewEnabled() && (
        <DevToolbar
          activeScene={devScene}
          onSelectScene={(sceneId) => {
            navigateToDevScene(sceneId);
            setDevScene(sceneId);
          }}
          onResetFirstLogin={() => {
            if (devScene) {
              navigateToDevScene('intro');
              setDevScene('intro');
            } else {
              resetToFirstLogin();
            }
          }}
        />
      )}

      {showReceipt && (
        <ReceiptPrinter
          unlockedCoupon={receiptCoupon ?? resolveUnlockedCoupon(discounts, currentStepIndex)}
          colors={receiptColors}
          brand={brand}
          expiryDate={expiryDate}
          onUse={() => requestClaim(handleUseReceiptCoupon, (receiptCoupon ?? resolveUnlockedCoupon(discounts, currentStepIndex))?.num)}
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
            if (renewFlowActiveRef.current) {
              renewFlowActiveRef.current = false;
              setRenewFlowActive(false);
              setRenewPlanReady(false);
              renewPlanRef.current = null;
              returnIntroShownRef.current = true;
              returnIntroPendingRef.current = false;
            }
            if (pendingTapRewardRef.current > 0) {
              playPendingTapReward();
            } else {
              tweenPointsTo(welcomeTargetPoints);
            }
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
                Get More OFF
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BrandIntro() {
  return null;
}

function HeaderBase({ brand, shopifyStatus, onOpenShopifyAccount }) {
  const connected = shopifyStatus === 'connected';
  return (
    <header className="brand-header">
      <div className="brand-info">
        {brand?.logoUrl ? (
          <img className="brand-logo-img" src={brand.logoUrl} alt={`${brand.name} logo`} />
        ) : null}
        {brand?.name && <span className="brand-name">{brand.name}</span>}
      </div>
      <div className="header-actions">
        <button
          className={`account-entry-btn ${connected ? 'is-connected' : ''}`}
          type="button"
          aria-label={connected ? 'View connected Shopify account' : 'Connect Shopify account'}
          title={connected ? 'Shopify account' : 'Connect Shopify'}
          onClick={onOpenShopifyAccount}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21a8 8 0 0 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {connected && <span className="account-entry-dot" aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

function UrgencyBanner({ isExpired, time, tick, urgent, isBestOffer }) {
  return (
    <section className={`urgency-banner ${urgent ? 'urgent' : ''}`} data-screen-label="倒计时">
      <div className="ub-label">
        <span className="live-pulse" />
        <span>{isExpired ? 'This round has ended' : urgent ? "Ends today - don't lose it" : 'LIMITED CHALLENGE ENDS IN'}</span>
      </div>
      <div className="clock">
        {['Days', 'Hours', 'Min', 'Sec'].map((label, index) => (
          <ClockUnit key={label} label={label} value={time.digits[index]} tick={index === 3 && tick} isLast={index === 3} />
        ))}
      </div>
      {isBestOffer && (
        <p className="ub-round-note">A new discount challenge starts when the countdown ends.</p>
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

function CompactChallengeTimer({ time }) {
  return (
    <div className="compact-challenge-timer" aria-label={`Challenge ends in ${time.days} days ${time.hours} hours ${time.mins} minutes ${time.secs} seconds`}>
      <span className="compact-challenge-timer-label">Challenge ends in</span>
      <span className="compact-challenge-timer-value">{time.digits[0]}d {time.digits[1]}h {time.digits[2]}m {time.digits[3]}s</span>
    </div>
  );
}

function LargeCouponTicket({
  coupon,
  expiryDate,
  isExpired,
  claimed = false,
  variant = 'best',
  copyState,
  onCopy,
  onAction,
}) {
  return (
    <div className="coupon-wrap current voucher-large-coupon-wrap" data-coupon-theme={COUPON_THEME}>
      <div className={`coupon coupon-current voucher-large-coupon is-${variant} ${claimed ? 'is-claimed' : ''} ${isExpired ? 'expired' : ''}`} data-tier={tierForDiscount(coupon.num)}>
        <div className="coupon-face">
          <span className="coupon-kicker">{claimed ? 'Your Coupon' : 'Best offer this round'}</span>
          <span className="stub-value">{coupon.num}<small>%</small></span>
          <span className="stub-off">OFF</span>
          <span className="coupon-title">Sitewide · No minimum</span>
          {claimed ? (
            <button className="voucher-large-code-chip" type="button" onClick={onCopy}>
              <span className="voucher-large-code-copy-text">
                <span className="voucher-large-code-label">Your Code</span>
                <span className="voucher-large-code-value">{copyState === 'Copied!' ? 'Copied!' : coupon.code}</span>
              </span>
              <span className="voucher-large-code-copy-icon" aria-hidden="true">
                {copyState === 'Copied!' ? (
                  <span className="voucher-large-code-copy-check">✓</span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </span>
            </button>
          ) : null}
          <span className="coupon-expire">Expires on <b>{expiryDate}</b></span>
        </div>
        <button className="btn-use" id="use-now-btn" aria-label={claimed ? 'Redeem coupon' : 'Claim coupon'} disabled={isExpired} onClick={onAction}>
          <span>{isExpired ? 'Expired' : (claimed ? 'Redeem' : 'Claim Now')}</span>
          <svg className="use-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4.5V19" />
            <path d="M6 13l6 6 6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function BestCouponLockedPage({ 
  coupon, time, expiryDate, tick, isExpired, couponFaceRef, claimed, copyState, onClaim, onShop, onCopy,
  points, targetPoints, challenges, dailyCapReached, onOpenChallenge 
}) {
  if (claimed) {
    return (
      <section className="best-locked-page voucher-ready" data-screen-label="券已领取">
        <div className="voucher-coupon-card-container">
          <LargeCouponTicket
            coupon={coupon}
            expiryDate={expiryDate}
            isExpired={isExpired}
            claimed
            copyState={copyState}
            onCopy={onCopy}
            onAction={onShop}
          />
        </div>

        <CompactChallengeTimer time={time} />

        <p className="voucher-footnote">
          Use this code at checkout. We&apos;ll check whether it&apos;s been used or expired — then unlock your next challenge.
        </p>

      </section>
    );
  }

  return (
    <section className="best-locked-page voucher-ready" data-screen-label="最佳优惠券">
      <div className="voucher-coupon-card-container">
        <LargeCouponTicket
          coupon={coupon}
          expiryDate={expiryDate}
          isExpired={isExpired}
          onAction={onClaim}
        />
      </div>

      <CompactChallengeTimer time={time} />

      <p className="voucher-footnote">
        Use this coupon to finish this round and unlock the next challenge.<br />
        Not ready yet? You can keep playing until the countdown ends — the next round will start automatically.
      </p>
    </section>
  );
}

function NewChallengeUnlocked({ reason, onStart, onDismiss, prevCoupon }) {
  const redeemed = reason === 'redeemed';
  const expired = reason === 'expired';
  const settlementCoupon = prevCoupon || { num: expired ? '15' : '20', value: `${expired ? '15' : '20'}% OFF` };
  const stamp = redeemed ? 'USED' : 'EARNED';

  return (
    <div className={`new-challenge-overlay nc-settlement ${redeemed ? 'is-redeemed' : 'is-expired'}`} role="dialog" aria-label={redeemed ? 'Reward used' : 'Round complete'} data-screen-label={redeemed ? '奖励已使用' : '回合已结束'}>
      <div className="nc-settlement-scroll">
        <div className="nc-settlement-hero">
          {redeemed ? (
            <div className="nc-hero-check" aria-hidden="true">
              <svg viewBox="0 0 90 90" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M24 46 39 61 67 30" />
              </svg>
            </div>
          ) : (
            <div className="nc-hero-flag-small" aria-hidden="true">
              <div className="nc-flag-pole" />
              <div className="nc-flag-banner">
                <span>★</span>
              </div>
            </div>
          )}
        </div>

        <section className="nc-copy-block">
          <h1>{expired ? 'Round Complete' : 'Reward Used!'}</h1>
          <p>
            {expired
              ? 'This challenge period has ended.'
              : 'You used your reward from this round.'}
          </p>
        </section>

        <div className="nc-settlement-coupon-wrap coupon-wrap current" data-coupon-theme={COUPON_THEME}>
          <div
            className={`coupon coupon-current nc-settlement-wallet-coupon ${redeemed ? 'is-used' : 'is-earned'}`}
            data-tier={tierForDiscount(settlementCoupon.num)}
          >
            <div className="coupon-face">
              <span className="coupon-kicker">Your Reward</span>
              <span className="stub-value">{settlementCoupon.num}<small>%</small></span>
              <span className="stub-off">OFF</span>
              <span className="coupon-title">Sitewide · No minimum</span>
            </div>
            <div className="nc-settlement-coupon-stamp">{stamp}</div>
          </div>
        </div>

        <div className="nc-footer">
          <button className="nc-btn-start" type="button" onClick={onStart}>
            <span>Start Next Challenge</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m13 5 7 7-7 7" />
            </svg>
          </button>
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
  onTargetClick,
  isClaimed = false
}) {
  return (
    <section className={`wallet ${isBestOffer ? 'best-offer' : ''}`} data-screen-label="优惠券">
      <div className="section-head">
        <span className="section-tag">{isBestOffer ? 'Best offer unlocked' : 'Your coupon'}</span>
      </div>

      {isBestOffer && (
        <div className="best-offer-note">
          <span>Exclusive reward unlocked</span>
          <p>Congratulations, you unlocked the best offer this round. Your exclusive reward is reserved, so start shopping.</p>
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

      <div className="coupon-pair" data-coupon-theme={COUPON_THEME}>
        <div className={`coupon-wrap current ${currentSwap ? 'swap' : ''} ${isTearingCoupon ? 'tearing' : ''}`}>
          <div className={`coupon coupon-current ${isExpired ? 'expired' : ''} ${confirmOpen ? 'confirm-open-zoom' : ''}`} data-tier={tierForDiscount(current.num)}>
            <div className="coupon-face" ref={couponFaceRef}>
              {isClaimed && (
                <div className="wallet-coupon-claimed-badge">• CLAIMED ✓</div>
              )}
              <span className="coupon-kicker">{isBestOffer ? 'Current Coupon' : 'Unlocked Offer'}</span>
              <span className="stub-value">{current.num}<small>%</small></span>
              {isBestOffer ? (
                <>
                  <span className="max-discount-label">Best offer this round</span>
                </>
              ) : (
                <>
                  <span className="stub-off">OFF</span>
                  <span className="coupon-title">Sitewide · No minimum</span>
                </>
              )}
            </div>
            <button className="btn-use" id="use-now-btn" aria-label="Use current coupon" disabled={isExpired || isTearingCoupon} onClick={onUse}>
              <span>{isExpired ? 'Expired' : (isClaimed ? 'Redeem' : 'Claim')}</span>
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
          const isShopifyConnect = challenge.type === 'shopify_connect';
          return (
            <div className="challenge-card" key={challenge.id} style={isShopifyConnect ? { background: 'linear-gradient(135deg, #f6f9f4 0%, #eaf0e6 100%)', borderColor: 'rgba(94, 128, 62, 0.18)' } : undefined}>
              <span className="challenge-badge">{challenge.badge}</span>
              <div className="challenge-icon-wrapper">
                {isShopifyConnect ? (
                  <img className="challenge-shopify-icon" src="/打开礼包开场动画/shopify-icon.png" alt="" aria-hidden="true" />
                ) : (
                  challenge.icon
                )}
              </div>
              <h4 className="challenge-title">{challenge.title}</h4>
              <p className="challenge-desc">{challenge.desc}</p>
              <button
                className={isShopifyConnect ? 'btn btn-play shopify-connect-btn' : 'btn btn-outline btn-play'}
                id={challenge.type === 'survey' ? 'take-survey-btn' : `play-${challenge.id}-btn`}
                disabled={dailyCapReached && !isShopifyConnect}
                onClick={() => onOpen(challenge)}
              >
                {dailyCapReached && !isShopifyConnect ? (
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

  const handleConfirm = async () => {
    if (isClaiming) return;
    setIsClaiming(true);
    try {
      await onConfirm();
    } finally {
      setIsClaiming(false);
    }
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
          <div className="claim-confirm-reward-value">
            <span>{discount}%</span>
            <span className="claim-confirm-reward-off">OFF</span>
          </div>
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

const ReceiptPrinter = memo(function ReceiptPrinter({ unlockedCoupon, colors, brand, expiryDate, onUse, onAccumulate }) {
  const discountNum =
    unlockedCoupon?.num ??
    ((unlockedCoupon?.value ? String(unlockedCoupon.value).replace(/\D/g, '') : '') || '—');

  return (
    <div className="printer-overlay" data-coupon-theme={COUPON_THEME} style={couponColorVars(colors)}>
      <div className="printer-machine">
        <div className="printer-slot" />
        <div className="receipt-paper-wrap">
          {/* 小票 1:1 复用首页 coupon 结构：CLAIM 按钮直接长在券底部 */}
          <div className="coupon coupon-current receipt-coupon" data-tier={tierForDiscount(discountNum)}>
            <div className="coupon-face">
              <div className="receipt-brand">
                {brand?.logoUrl ? (
                  <img className="receipt-brand-logo" src={brand.logoUrl} alt={`${brand.name || 'Brand'} logo`} />
                ) : null}
                <span className="receipt-brand-name">{brand?.name || 'Ritual'}</span>
              </div>
              <span className="coupon-kicker">Unlocked Offer</span>
              <span className="stub-value">{discountNum}<small>%</small></span>
              <span className="stub-off">OFF</span>
              <span className="coupon-title">Sitewide · No minimum</span>
              <span className="coupon-expire">Expires on <b>{expiryDate}</b></span>
            </div>
            <button className="btn-use" aria-label="Claim coupon" onClick={onUse}>
              <span>Claim Now</span>
            </button>
          </div>
        </div>
      </div>

      <div className="printer-buttons">
        <button className="btn-printer-secondary" id="btn-receipt-accumulate" onClick={onAccumulate}>
          Get More OFF
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

    // 灰色金属待刮材质（与 confirm 弹窗的刮刮卡遮罩同色同质感）
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#a3a3a3');
    grad.addColorStop(0.35, '#e0e0e0');
    grad.addColorStop(0.65, '#b8b8b8');
    grad.addColorStop(1, '#858585');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // 45° 斜纹高光，呼应 confirm 弹窗待刮表面的纹理
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 4;
    for (let i = -height; i < width; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    // 手动刮开：监听指针事件，用 destination-out 擦除金箔；
    // 刮开面积超过阈值后自动揭示完整 code。
    let drawing = false;
    let revealed = false;
    let lastPos = null;

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (canvas.width / r.width),
        y: (e.clientY - r.top) * (canvas.height / r.height),
      };
    };

    const scratch = (x, y) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 38;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (lastPos) {
        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.fill();
      lastPos = { x, y };
    };

    // 采样 alpha 通道，估算已刮开比例（步长大一点以省开销）。
    const clearedRatio = () => {
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let cleared = 0;
      let total = 0;
      for (let i = 3; i < data.length; i += 4 * 20) {
        total++;
        if (data[i] === 0) cleared++;
      }
      return total ? cleared / total : 0;
    };

    const maybeReveal = () => {
      if (revealed) return;
      if (clearedRatio() > 0.5) {
        revealed = true;
        setScratched(true);
      }
    };

    const onDown = (e) => {
      drawing = true;
      lastPos = null;
      const p = getPos(e);
      scratch(p.x, p.y);
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!drawing) return;
      const p = getPos(e);
      scratch(p.x, p.y);
      maybeReveal();
      e.preventDefault();
    };
    const onUp = () => {
      if (!drawing) return;
      drawing = false;
      lastPos = null;
      maybeReveal();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onUp);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onUp);
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

function ShopifyAccountPage({ brand, binding, onClose, onDisconnect }) {
  const accountLabel = shopifyAccountLabel(binding);
  const brandName = brand?.name || 'Your brand';

  return (
    <section className="shopify-account-page" aria-label="Connected Shopify account">
      <header className="shopify-account-header">
        <div className="shopify-account-brand">
          {brand?.logoUrl ? (
            <img className="shopify-account-brand-logo" src={brand.logoUrl} alt={`${brandName} logo`} />
          ) : (
            <span className="shopify-account-brand-initial" aria-hidden="true">{brandName.trim().charAt(0).toUpperCase() || 'Y'}</span>
          )}
          <span className="shopify-account-brand-name">{brandName}</span>
        </div>
        <button className="shopify-account-close" type="button" onClick={onClose} aria-label="Close Shopify account">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>

      <main className="shopify-account-body">
        <div className="shopify-account-icon" aria-hidden="true">
          <img src="/打开礼包开场动画/shopify-icon.png" alt="" />
        </div>
        <span className="shopify-account-kicker">Shopify Connected</span>
        <h1>Shopify account</h1>

        <div className="shopify-account-card">
          <span>Connected account</span>
          <strong>{accountLabel}</strong>
          {binding?.email && <p>{binding.email}</p>}
          {binding?.shop && binding.shop !== accountLabel && <p>{binding.shop}</p>}
        </div>

        <button className="shopify-account-disconnect" type="button" onClick={onDisconnect}>
          Disconnect Shopify
        </button>
      </main>
    </section>
  );
}

function ShopifyAuthorizationPage({ brand, source, onContinue, onSkip }) {
  const brandName = brand?.name || 'Your brand';
  const brandInitial = brandName.trim().charAt(0).toUpperCase() || 'Y';

  return (
    <section className="shopify-auth-overlay" aria-label="Shopify authorization" data-auth-source={source}>
      <div className="shopify-auth-card">
        <div className="shopify-auth-brand-lockup" aria-label={brandName}>
          {brand?.logoUrl ? (
            <img className="shopify-auth-brand-logo" src={brand.logoUrl} alt={`${brandName} logo`} />
          ) : (
            <span className="shopify-auth-brand-icon" aria-hidden="true">{brandInitial}</span>
          )}
          <span className="shopify-auth-brand-name">{brandName}</span>
        </div>

        <p className="shopify-auth-desc">
          Log in with Shopify to sync rewards and earn more points.
        </p>

        <button className="shopify-auth-cta" type="button" onClick={onContinue}>
          <img className="shopify-auth-cta-icon" src="/打开礼包开场动画/shopify-icon.png" alt="" aria-hidden="true" />
          Connect your Shopify
        </button>

        <button className="shopify-auth-skip" type="button" onClick={onSkip}>
          Skip
        </button>
      </div>
    </section>
  );
}
