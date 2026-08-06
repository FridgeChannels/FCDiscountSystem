import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { claimCoupon, claimInitialReward, claimTargetRewardPack, completeSurvey, fetchCouponWallet, fetchMagnetBrandParam, fetchPlayerProfile, fetchRewardPlan, fetchShopifyStatus, fetchSurveyQuestions, fetchTodayLeaderboard, observeCoupon, redeemCoupon, renewCycle, sampleResetCycle, startGameSession, submitSurveyAnswers, updatePlayerProfile, uploadPlayerAvatar } from './api/client.js';
import {
  readCachedRewardPlan,
  clearCachedMagnetBrandParam,
  readCachedShopifyStatus,
  rememberTouchId,
  writeCachedRewardPlan,
  patchCachedRewardPlanPoints,
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
  clearMagnetClientSession,
  readWelcomeCycleId,
  clearLegacyMagnetStorage,
  readCachedProfile,
  writeCachedProfile,
  readCouponWallet,
  writeCouponWallet,
  upsertCouponsToWallet,
  syncWalletForCycle,
  clearCouponWallet,
  walletCouponKey,
  setWalletCouponStatus,
} from './api/cache.js';
import {
  applyClaimToDiscounts,
  buildPacksFromDiscounts,
  buildWalletEntriesFromPacks,
  couponWithCode,
  isInitialPackIssued,
  isSingleCouponReward,
  isTargetPackIssued,
  mapPlanToViewModel,
  resolveRewardPacks,
  nextTierThresholdFromDiscounts,
  resolveSettlementCoupon,
} from './api/mapPlan.js';
import { mapApiWalletToLocal } from './api/mapWallet.js';
import { couponDisplayMode, couponPercentNum, couponPaletteTierFor, enrichCouponDisplay } from './api/couponDisplay.js';
import {
  dedupeWalletCoupons,
  enrichWalletCoupons,
  selectCompletedAvailableCoupons,
  selectSettlementCouponsForCycle,
  selectWalletArchiveCoupons,
  isWalletCouponUsable,
  walletHasCouponForCycle,
  selectPackRevealCoupons,
} from './api/walletCoupons.js';
import PlatformGameModal from './components/PlatformGameModal.jsx';
import DevToolbar from './components/DevToolbar.jsx';
import {
  applyDevSceneUi,
  getDevScene,
  isDevPreviewEnabled,
  navigateToDevScene,
  resolveDevScene,
  shouldShowDevToolbar,
} from './dev/index.js';
import {
  MOCK_CURRENT_PACK,
  MOCK_TARGET_PACK,
  mockPackWalletEntries,
  walletHasPack,
  MOCK_DEV_ACTIVE_COUPONS,
  MOCK_USED_COUPONS,
  MOCK_EXPIRED_COUPONS,
} from './dev/couponPacks.js';
import { dbg, dbgError } from './lib/debug.js';
import { createLogoTapDetector, isDemoForceRenewEnabled } from './lib/demoForceRenew.js';
import { applyBrandTheme, applyShellBrandToGameStart, brandFromMagnetParam, isSampleMagnetParam } from './lib/brandTheme.js';
import { preloadRuntimeManifest } from './lib/runtimeRegistry.js';
import { normalizeLeaderboardView, FALLBACK_RANK } from './lib/leaderboard.js';
import {
  formatLeaderboardId,
  isValidDisplayCode,
  parseDisplayCodeFromLeaderboardId,
  sanitizeDisplayCodeInput,
} from './lib/leaderboardIdentity.js';
import { getTouchIdErrorMessage, resolveTouchIdFromUrl } from './lib/touchId.js';

// 阶段4:对不依赖每秒倒计时的叶子组件做 memo,
// 避免倒计时每秒触发它们跟着整棵树一起重渲染。
const Header = memo(HeaderBase);
const Challenges = memo(
  ChallengesBase,
  (prev, next) =>
    prev.challenges === next.challenges &&
    prev.dailyCapReached === next.dailyCapReached &&
    prev.pointsNeeded === next.pointsNeeded,
);
const RulesFooter = memo(
  RulesFooterBase,
  (prev, next) => prev.rulesOpen === next.rulesOpen,
);

const INITIAL_SECONDS = 2 * 24 * 3600 + 4 * 3600 + 55 * 60;
const DEFAULT_TOUCH_ID = 'A8SQN3V2OW';
const GIFT_OPENING_VIDEO_SRC = '/gift-opening/opening-intro-2.mp4';
const GIFT_OPENING_VIDEO_POSTER = '/gift-opening/opening-intro-2-poster.jpg';
/** Skip if the first decoded frame never arrives (stall / decode failure). */
const GIFT_VIDEO_FIRST_FRAME_TIMEOUT_MS = 2000;
/** Hard ceiling slightly above clip length (~6.5s). */
const GIFT_VIDEO_HARD_FALLBACK_MS = 8500;
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
  if (msg.includes('SAMPLE_RESET_FORBIDDEN') || msg.includes('sample reset is only allowed')) {
    return 'Reset is only available on sample magnets.';
  }
  if (msg.includes('manual cycle renew is disabled') || msg.includes('demo force expire is disabled')) {
    return 'Demo cycle reset is not enabled on this environment.';
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
  if (msg.includes('PACK_PREISSUE_INCOMPLETE')) {
    return 'Rewards are still being prepared. Please wait a moment and try again.';
  }
  return msg.includes(':') ? msg.split(':').slice(1).join(':').trim() || msg : msg;
}

function isRecoverableClaimError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('fetch failed') ||
    msg.includes('aborted due to timeout') ||
    msg.includes('AbortError') ||
    msg.includes('Request failed: 504')
  );
}

function resolveTouchIdState(allowDevFallback = false) {
  const parsed = resolveTouchIdFromUrl(window.location, {
    devFallbackId: allowDevFallback ? DEFAULT_TOUCH_ID : '',
  });
  if (parsed.touchId) {
    return { touchId: parsed.touchId, touchIdValid: true, touchIdError: null };
  }
  return {
    touchId: null,
    touchIdValid: false,
    touchIdError: getTouchIdErrorMessage(parsed.reason, parsed.detail),
  };
}

const SHOPIFY_TAP_AUTH_BASE = 'https://dtc-dashboard.fridgechannels.com/tap';

function buildShopifyAuthUrl(touchId) {
  if (!touchId) return SHOPIFY_TAP_AUTH_BASE;
  const redirectedFrom = encodeURIComponent(window.location.href);
  return `${SHOPIFY_TAP_AUTH_BASE}/${encodeURIComponent(touchId)}?redirectedFrom=${redirectedFrom}`;
}

function buildShopifyUnlinkUrl(touchId) {
  if (!touchId) return SHOPIFY_TAP_AUTH_BASE;
  const redirectedFrom = encodeURIComponent(window.location.href);
  return `${SHOPIFY_TAP_AUTH_BASE}/${encodeURIComponent(touchId)}?action=unlink&redirectedFrom=${redirectedFrom}`;
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

const PROFILE_AVATAR_OPTIONS = ['#a08447', '#5c6e58', '#b89855', '#6b7e65', '#8b6b3d', '#7a8c75'];
const DEFAULT_PROFILE = {
  nickname: 'You',
  avatarColor: '#a08447',
  avatarImageUrl: '',
};

function normalizeProfile(profile) {
  const brandName = String(profile?.brandName ?? '').trim();
  const displayCode = sanitizeDisplayCodeInput(
    profile?.displayCode ?? parseDisplayCodeFromLeaderboardId(brandName, profile?.nickname),
  );
  const rawNickname = String(profile?.nickname ?? '').trim();
  const nickname = rawNickname.slice(0, 32)
    || (displayCode ? formatLeaderboardId(brandName || 'Player', displayCode) : DEFAULT_PROFILE.nickname);
  const avatarColor = PROFILE_AVATAR_OPTIONS.includes(profile?.avatarColor)
    ? profile.avatarColor
    : DEFAULT_PROFILE.avatarColor;
  return {
    nickname,
    displayCode,
    avatarColor,
    avatarImageUrl: typeof profile?.avatarImageUrl === 'string' ? profile.avatarImageUrl : '',
  };
}

function profileInitial(profile) {
  return (profile?.nickname || DEFAULT_PROFILE.nickname).trim().charAt(0).toUpperCase() || 'Y';
}

function tierReceiptSessionKey(touchId, cycleId, tier) {
  return `fc_receipt_tier_${touchId}_${cycleId ?? 'none'}_${tier ?? 'unknown'}`;
}

const TAP_ENTRY_DISPLAY_POINTS = 5;

/** 非首次回访:有 welcome 标记、已领券缓存、或历史 plan 缓存 */
function isReturnVisitor(touchId) {
  if (!touchId) return false;
  return (
    readWelcomeCompleted(touchId) ||
    !!readClaimRecord(touchId)?.code ||
    !!readCachedRewardPlan(touchId)
  );
}

/** 随 URL /p/:touchId 或 /t/:touchId 变化更新(含 bfcache 返回);无效 URL 不进入业务流程 */
function useTouchIdFromUrl() {
  const allowDevFallback = isDevPreviewEnabled();
  const [state, setState] = useState(() => resolveTouchIdState(allowDevFallback));

  useEffect(() => {
    clearLegacyMagnetStorage();
    const sync = () => {
      setState((prev) => {
        const next = resolveTouchIdState(allowDevFallback);
        if (
          prev.touchId === next.touchId &&
          prev.touchIdValid === next.touchIdValid &&
          prev.touchIdError === next.touchIdError
        ) {
          return prev;
        }
        return next;
      });
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, [allowDevFallback]);

  return state;
}

const INITIAL_DISCOUNTS = [
  { num: '15', value: '15% OFF', target: 0, code: 'FC15RITUAL' },
  { num: '20', value: '20% OFF', target: 80, code: 'FC20RITUAL' },
  { num: '30', value: '30% OFF', target: 20, code: 'FC30RITUAL' }
];

const REWARD_LADDER_PERCENTAGES = [5, 10, 15, 20, 25, 30];

const COUPON_THEME = 'dtc'; // Premium beauty / skincare coupon palette from fc-tiers.css.

const LOCAL_PREVIEW_CHALLENGES = [
  {
    id: 'dev_memory_match',
    type: 'game',
    badge: 'Game',
    icon: '🃏',
    title: 'Card Match',
    desc: '',
    reward: '+pts',
    difficultyLevel: 1,
    rewardPotentialLevel: 1,
    cta: 'Play Now',
    gameInstanceId: 'dev_memory_match',
    templateKey: 'memory_match',
  },
  {
    id: 'dev_bridge_cross',
    type: 'game',
    badge: 'Game',
    icon: '🌉',
    title: 'Bridge Cross',
    desc: '',
    reward: '+pts',
    difficultyLevel: 2,
    rewardPotentialLevel: 2,
    cta: 'Play Now',
    gameInstanceId: 'dev_bridge_cross',
    templateKey: 'bridge_cross',
  },
];

// 本地设计预览不能因为远端活动尚未配置好就留下整块空白。
// 生产环境仍以服务端任务为准；若为空，Challenges 会展示明确的空状态。
const FALLBACK_CHALLENGES = import.meta.env.DEV ? LOCAL_PREVIEW_CHALLENGES : [];

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

// 打开外部链接(品牌商店等)。
function openExternalLink(url) {
  if (!url) return;
  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened && import.meta.env?.DEV) {
      console.info('[dev] window.open blocked; navigate manually:', url);
    }
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.info('[dev] failed to open external link:', url, err);
    }
  }
}

function couponPaletteTier(coupon) {
  return couponPaletteTierFor(coupon);
}

function tierForDiscount(num) {
  const n = parseInt(num, 10);
  if (Number.isNaN(n) || n <= 0) return couponPaletteTierFor({ couponType: 'percentage' });
  return Math.max(0, Math.min(5, Math.round((n - 15) / 5)));
}

function assignCouponPaletteTiers(coupons = []) {
  return coupons.map((coupon) => enrichCouponDisplay(coupon));
}

function couponPaletteProps(coupon) {
  const type = coupon?.couponType ?? coupon?.discountType ?? 'percentage';
  return {
    'data-coupon-theme': COUPON_THEME,
    'data-tier': String(couponPaletteTier(coupon)),
    'data-coupon-type': type,
  };
}

function couponTicketHeadline(coupon) {
  return coupon?.headline ?? coupon?.value ?? 'Reward';
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

// 按券面档位解析配色 token:当页面上没有可读取的 .coupon 元素时(例如 best offer /
// 已锁定流程),用一个隐藏探针元素套用 fc-tiers.css 的 [data-coupon-theme][data-tier]
// 级联,拿到与该档位券面完全一致的 --coupon-* 值。
function readCouponTokensForTier(tier) {
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('div');
  probe.setAttribute('data-coupon-theme', COUPON_THEME);
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:-9999px;';
  const inner = document.createElement('div');
  inner.className = 'coupon';
  inner.setAttribute('data-tier', String(tier));
  probe.appendChild(inner);
  document.body.appendChild(probe);
  const tokens = readCouponTokens(inner);
  document.body.removeChild(probe);
  return tokens;
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

function mergeIssuedCoupon(baseCoupon, issuedCoupon, fallbackExpiresAt) {
  if (!baseCoupon && !issuedCoupon) return null;
  const code = issuedCoupon?.couponCode ?? issuedCoupon?.code ?? baseCoupon?.code ?? '';
  const rawNum = issuedCoupon?.discountValue ?? issuedCoupon?.num ?? baseCoupon?.num ?? '';
  const normalizedNum = rawNum == null ? '' : String(rawNum).replace('%', '').replace('Free Ship', '0');
  return {
    ...(baseCoupon ?? {}),
    ...(issuedCoupon ?? {}),
    couponId: issuedCoupon?.couponId ?? issuedCoupon?.campaignId ?? baseCoupon?.couponId ?? baseCoupon?.campaignId,
    num: normalizedNum || baseCoupon?.num || '',
    value: issuedCoupon?.label ?? issuedCoupon?.value ?? baseCoupon?.value ?? '',
    conditions: issuedCoupon?.conditions ?? baseCoupon?.conditions,
    expiresAt: issuedCoupon?.expiresAt ?? baseCoupon?.expiresAt ?? fallbackExpiresAt,
    code,
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
  const lastSettlementBalanceRef = useRef(null);
  const prevCountdownRef = useRef(null);
  const pendingTapRewardRef = useRef(0);
  const pendingTapTargetRef = useRef(0);
  const pendingRewardKindRef = useRef('tap');
  const playPendingTapRewardRef = useRef(() => {});
  const returnIntroShownRef = useRef(false);
  const returnIntroPendingRef = useRef(false);
  const autoClaimInitialRef = useRef(null);
  const currentPackClaimedRef = useRef(false);
  const singleCouponOnlyRef = useRef(false);
  const solePackClaimedRef = useRef(false);
  const startRenewFlowRef = useRef(() => {});
  const startSampleResetFlowRef = useRef(() => {});
  const logoTapDetectorRef = useRef(null);
  const newChallengeRenewRef = useRef(null);
  const renewPlanRef = useRef(null);
  const renewFlowActiveRef = useRef(false);
  const giftEndedPendingRenewRef = useRef(false);
  const renewPlanAppliedRef = useRef(false);
  const applyRenewPlanAfterGiftRef = useRef(null);
  const zoomCenteredOpenRef = useRef(false);
  const zoomAfterCloseRef = useRef(null);
  const settlementCouponRef = useRef(null);
  const autoIssuedPackRef = useRef(null);
  const pendingPackUnlockAfterSettlementRef = useRef(false);
  const inlineErrorTimerRef = useRef(null);
  const unlockedPreviewShownRef = useRef(false);
  const shopifyPendingRef = useRef(null);
  const devPreviewActiveRef = useRef(false);
  const devSceneRef = useRef('');
  const magnetBrandParamRef = useRef(null);
  // 仅在 bootstrap 成功结束后标记，避免 StrictMode 二次挂载时跳过 plan 请求导致一直 loading
  const sessionBootstrapCompleteRef = useRef(null);
  const entryTapFxRequestedRef = useRef(false);
  const entryTapFxPlayedRef = useRef(false);
  const entryTapHomeReadyRef = useRef(false);
  const welcomeAfterEntryFxRef = useRef(false);

  const { touchId, touchIdValid, touchIdError } = useTouchIdFromUrl();
  const [devScene, setDevScene] = useState(() => getDevScene());
  const [planLoading, setPlanLoading] = useState(true);
  const [rewardPlanFetched, setRewardPlanFetched] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [rewardPlanId, setRewardPlanId] = useState(null);
  const rewardPlanIdRef = useRef(rewardPlanId);
  const [brand, setBrand] = useState({ name: null, logoUrl: null, primaryColor: null, shopUrl: '#' });
  const [isSampleMagnet, setIsSampleMagnet] = useState(false);
  const [challenges, setChallenges] = useState(FALLBACK_CHALLENGES);
  const [gameStart, setGameStart] = useState(null);
  const [gameModalTitle, setGameModalTitle] = useState('Play & Earn');
  const [gameLoadingMessage, setGameLoadingMessage] = useState('Preparing game…');
  const [surveyAnswers, setSurveyAnswers] = useState([]);
  const [surveyQuestions, setSurveyQuestions] = useState([]);
  const [activeSurveyTask, setActiveSurveyTask] = useState(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [welcomeStep, setWelcomeStep] = useState(3);
  const welcomeStepRef = useRef(welcomeStep);
  const [welcomeCoupon, setWelcomeCoupon] = useState(null);
  const [welcomeTargetPoints, setWelcomeTargetPoints] = useState(67);
  const [points, setPoints] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(INITIAL_SECONDS);
  const [tick, setTick] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rewardLadderOpen, setRewardLadderOpen] = useState(false);
  const [copyState, setCopyState] = useState('Copy');
  const [activeModal, setActiveModal] = useState(null);
  const [notification, setNotification] = useState(null);
  const [inlineError, setInlineError] = useState(null);
  const [dailyCapReached, setDailyCapReached] = useState(false);
  const [targetPulse, setTargetPulse] = useState('');
  const [crediting, setCrediting] = useState(false);
  const [currentSwap, setCurrentSwap] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptCoupon, setReceiptCoupon] = useState(null);
  const [forceWalletView, setForceWalletView] = useState(false);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);
  const [introActive, setIntroActive] = useState(true);
  const [returnIntroGate, setReturnIntroGate] = useState(true);
  const [renewGiftIntro, setRenewGiftIntro] = useState(false);
  const [renewFlowActive, setRenewFlowActive] = useState(false);
  const [renewPlanReady, setRenewPlanReady] = useState(false);
  const [renewIssueAutoAdvance, setRenewIssueAutoAdvance] = useState(false);
  const [pendingRewardSignal, setPendingRewardSignal] = useState(0);
  const closeIntro = useCallback(() => setIntroActive(false), []);
  const [hasInitialDiscount, setHasInitialDiscount] = useState(false);

  const [shopifyAuthStatus, setShopifyAuthStatus] = useState('unconnected');
  const [shopifyBinding, setShopifyBinding] = useState(null);
  const [shopifyAuthSkipCount, setShopifyAuthSkipCount] = useState(0);
  const [shopifyAuthLastSkippedAt, setShopifyAuthLastSkippedAt] = useState(null);
  const [getMoreOffAuthPromptSeen, setGetMoreOffAuthPromptSeen] = useState(false);
  const [shopifyLoginTaskStatus, setShopifyLoginTaskStatus] = useState('incomplete');
  const [shopifyAuthOverlay, setShopifyAuthOverlay] = useState(null);
  const [shopifyAccountOpen, setShopifyAccountOpen] = useState(false);
  const [shopifyAuthSuccess, setShopifyAuthSuccess] = useState(false);
  const [userProfile, setUserProfile] = useState(() => normalizeProfile(DEFAULT_PROFILE));
  const [playerProfile, setPlayerProfile] = useState(null);

  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletNavDirection, setWalletNavDirection] = useState('forward');
  const [couponWallet, setCouponWallet] = useState([]);
  const [walletCopiedCode, setWalletCopiedCode] = useState(null);
  // 礼包领取结果:null | { pack, coupons }
  const [giftReveal, setGiftReveal] = useState(null);
  // target 礼包解锁弹窗已确认(Continue / View my coupons)的 cycleId；仅对当前周期生效。
  const [targetUnlockAckCycleId, setTargetUnlockAckCycleId] = useState(null);
  // 从解锁弹窗进券包时暂存已签发券,避免 wallet state 尚未刷新导致空列表。
  const [walletRevealCoupons, setWalletRevealCoupons] = useState([]);
  const [coinGainSignal, setCoinGainSignal] = useState(0);
  const [lastGainAmount, setLastGainAmount] = useState(0);
  const [unlockToastSignal, setUnlockToastSignal] = useState(0);

  const prevLeaderboardRankRef = useRef(FALLBACK_RANK);

  useEffect(() => {
    if (!touchId) return;
    setUserProfile(normalizeProfile(readCachedProfile(touchId)));
    setPlayerProfile(null);
    setLeaderboardData(null);
    setCouponWallet(readCouponWallet(touchId));
    const cachedShopify = readCachedShopifyStatus(touchId);
    setShopifyBinding(cachedShopify);
    setShopifyAuthStatus(shopifyAuthStatusFromBinding(cachedShopify));
  }, [touchId]);

  useEffect(() => () => {
    if (inlineErrorTimerRef.current) {
      clearTimeout(inlineErrorTimerRef.current);
      inlineErrorTimerRef.current = null;
    }
  }, []);

  const refreshCouponWallet = useCallback(async () => {
    if (!touchId || devScene) return;
    try {
      const payload = await fetchCouponWallet(touchId);
      const rows = Array.isArray(payload) ? payload : (payload?.coupons ?? []);
      const entries = dedupeWalletCoupons(mapApiWalletToLocal(rows));
      writeCouponWallet(touchId, entries);
      setCouponWallet(entries);
    } catch (err) {
      dbgError('[FCDBG][App] wallet sync failed', err);
    }
  }, [touchId, devScene]);

  useEffect(() => {
    void refreshCouponWallet();
  }, [refreshCouponWallet]);

  const displayProfile = useMemo(() => {
    if (playerProfile) {
      return normalizeProfile({
        nickname: playerProfile.displayName,
        displayCode: playerProfile.displayCode,
        brandName: playerProfile.brandName,
        avatarColor: playerProfile.avatarColor,
        avatarImageUrl: playerProfile.avatarImageUrl || '',
      });
    }
    return normalizeProfile({ ...userProfile, brandName: brand?.name });
  }, [playerProfile, userProfile, brand?.name]);

  const syncPlayerProfile = useCallback(async (forceRefresh = false) => {
    if (devPreviewActiveRef.current) return null;
    try {
      const profile = await fetchPlayerProfile(touchId, { refresh: forceRefresh });
      setPlayerProfile(profile);
      writeCachedProfile(touchId, {
        nickname: profile.displayName,
        displayCode: profile.displayCode,
        avatarColor: profile.avatarColor,
        avatarImageUrl: profile.avatarImageUrl || '',
      });
      return profile;
    } catch (err) {
      dbgError('[FCDBG][App] fetch player profile failed', err);
      return null;
    }
  }, [touchId]);

  const syncLeaderboard = useCallback(async (forceRefresh = false) => {
    if (devPreviewActiveRef.current) return null;
    try {
      const raw = await fetchTodayLeaderboard(touchId, { refresh: forceRefresh });
      const view = normalizeLeaderboardView(
        raw,
        displayProfile.nickname,
        raw?.currentUserCoins ?? 0,
      );
      prevLeaderboardRankRef.current = view.currentUserRank;
      setLeaderboardData(view);
      return view;
    } catch (err) {
      dbgError('[FCDBG][App] fetch leaderboard failed', err);
      const fallback = normalizeLeaderboardView(null, displayProfile.nickname, 0);
      setLeaderboardData(fallback);
      return fallback;
    }
  }, [touchId, displayProfile.nickname]);

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
    if (!param) {
      setIsSampleMagnet(false);
      return;
    }
    const nextBrand = brandFromMagnetParam(param);
    setBrand((prev) => ({
      ...prev,
      ...nextBrand,
    }));
    setIsSampleMagnet(isSampleMagnetParam(param));
    applyBrandTheme(nextBrand);
  }, []);

  const syncMagnetBrandParam = useCallback(async () => {
    try {
      const param = await fetchMagnetBrandParam(touchId);
      if (param) {
        magnetBrandParamRef.current = param;
        applyMagnetBrandParam(param);
      } else {
        magnetBrandParamRef.current = null;
        setIsSampleMagnet(false);
      }
      return param;
    } catch (err) {
      dbgError('[FCDBG][App] fetch magnet brand param failed', err);
      return magnetBrandParamRef.current;
    }
  }, [applyMagnetBrandParam, touchId]);

  useEffect(() => {
    welcomeStepRef.current = welcomeStep;
  }, [welcomeStep]);

  useEffect(() => {
    rewardPlanIdRef.current = rewardPlanId;
  }, [rewardPlanId]);

  const [isWelcomeVideoActive, setIsWelcomeVideoActive] = useState(false);
  const [welcomeVideoFading, setWelcomeVideoFading] = useState(false);
  const [welcomeVideoHasFrame, setWelcomeVideoHasFrame] = useState(false);
  const [giftVideoLockedHeight, setGiftVideoLockedHeight] = useState(null);
  const welcomeVideoRef = useRef(null);
  const welcomeVideoFadingRef = useRef(false);
  const welcomeVideoFirstFrameTimerRef = useRef(null);
  const welcomeVideoHardFallbackTimerRef = useRef(null);
  const handleWelcomeVideoEndRef = useRef(() => {});
  const giftEndPendingRef = useRef(false);
  const rewardPlanFetchedRef = useRef(false);
  const renewPlanReadyRef = useRef(false);

  const [giftWaitingPlan, setGiftWaitingPlan] = useState(false);

  const clearWelcomeVideoTimers = useCallback(() => {
    if (welcomeVideoFirstFrameTimerRef.current) {
      window.clearTimeout(welcomeVideoFirstFrameTimerRef.current);
      welcomeVideoFirstFrameTimerRef.current = null;
    }
    if (welcomeVideoHardFallbackTimerRef.current) {
      window.clearTimeout(welcomeVideoHardFallbackTimerRef.current);
      welcomeVideoHardFallbackTimerRef.current = null;
    }
  }, []);

  const completeGiftVideoTransition = useCallback((fromUserGesture = false) => {
    giftEndPendingRef.current = false;
    setGiftWaitingPlan(false);

    if (renewFlowActiveRef.current) {
      giftEndedPendingRenewRef.current = true;
      setIntroActive(false);
      setRenewGiftIntro(false);
      void applyRenewPlanAfterGiftRef.current?.();
    } else if (welcomeStepRef.current >= 3) {
      const needsWelcome =
        (singleCouponOnlyRef.current && !solePackClaimedRef.current && !currentPackClaimedRef.current)
        || (!singleCouponOnlyRef.current && !currentPackClaimedRef.current);
      welcomeAfterEntryFxRef.current = needsWelcome;
      returnIntroShownRef.current = true;
      returnIntroPendingRef.current = false;
      setReturnIntroGate(false);
      setIntroActive(false);
      setPendingRewardSignal((value) => value + 1);
      if (!planLoading) {
        window.setTimeout(() => playPendingTapRewardRef.current(), 760);
      } else if (!needsWelcome) {
        welcomeAfterEntryFxRef.current = false;
      }
    } else {
      setWelcomeStep(1);
      setIntroActive(false);
    }

    // Vibration API requires a recent user gesture; video onEnded alone is not enough.
    if (fromUserGesture === true && navigator.vibrate) {
      try {
        navigator.vibrate(60);
      } catch {
        // Silently ignore when the browser blocks haptics.
      }
    }
  }, [planLoading]);

  const handleWelcomeVideoEnd = useCallback((fromUserGesture = false) => {
    if (welcomeVideoFadingRef.current) return;
    clearWelcomeVideoTimers();
    welcomeVideoFadingRef.current = true;
    welcomeVideoRef.current?.pause();
    setWelcomeVideoHasFrame(false);
    setWelcomeVideoFading(true);

    const planReady = renewFlowActiveRef.current
      ? renewPlanReadyRef.current
      : rewardPlanFetchedRef.current;

    setTimeout(() => {
      setIsWelcomeVideoActive(false);
      welcomeVideoFadingRef.current = false;
      setWelcomeVideoFading(false);
      if (planReady) {
        completeGiftVideoTransition(fromUserGesture === true);
      } else {
        giftEndPendingRef.current = true;
        setGiftWaitingPlan(true);
      }
    }, 500);
  }, [clearWelcomeVideoTimers, completeGiftVideoTransition]);

  useEffect(() => {
    handleWelcomeVideoEndRef.current = handleWelcomeVideoEnd;
  }, [handleWelcomeVideoEnd]);

  const canSkipGiftVideo = renewFlowActive ? renewPlanReady : rewardPlanFetched;

  const handleGiftVideoClick = useCallback(() => {
    if (!canSkipGiftVideo) return;
    handleWelcomeVideoEnd(true);
  }, [canSkipGiftVideo, handleWelcomeVideoEnd]);

  useEffect(() => {
    rewardPlanFetchedRef.current = rewardPlanFetched;
  }, [rewardPlanFetched]);

  useEffect(() => {
    renewPlanReadyRef.current = renewPlanReady;
  }, [renewPlanReady]);

  useEffect(() => {
    if (!giftEndPendingRef.current || !canSkipGiftVideo) return;
    completeGiftVideoTransition();
  }, [canSkipGiftVideo, giftWaitingPlan, completeGiftVideoTransition]);

  // Keep the gift video mounted so the browser can warm the HTTP cache / decoder early.
  useEffect(() => {
    const video = welcomeVideoRef.current;
    if (!video) return undefined;
    try {
      video.preload = 'auto';
      if (video.readyState < 2) video.load();
    } catch {
      // Ignore preload failures; playback path still has timeouts.
    }
    return undefined;
  }, []);

  // 同步礼盒视频状态:首登和回访礼盒都直接播放同一段开场动画。
  useEffect(() => {
    if (giftWaitingPlan) return;
    if ((welcomeStep === 0 || welcomeStep >= 3) && introActive) {
      welcomeVideoFadingRef.current = false;
      setIsWelcomeVideoActive(true);
      setWelcomeVideoFading(false);
    } else {
      // 如果是非渐淡退出的切换，立即关闭视频
      setIsWelcomeVideoActive((prev) => (welcomeVideoFading ? prev : false));
    }
  }, [welcomeStep, introActive, welcomeVideoFading, giftWaitingPlan]);

  // Freeze gift-video layer height while playing to avoid Android dvh-driven stretching.
  useEffect(() => {
    if (!isWelcomeVideoActive) {
      setGiftVideoLockedHeight(null);
      return undefined;
    }

    const viewport = viewportRef.current;
    const height = Math.round(
      window.visualViewport?.height
      || viewport?.clientHeight
      || window.innerHeight
      || 0
    );
    setGiftVideoLockedHeight(height > 0 ? `${height}px` : null);

    const handleOrientationChange = () => {
      const nextHeight = Math.round(
        window.visualViewport?.height
        || viewport?.clientHeight
        || window.innerHeight
        || 0
      );
      setGiftVideoLockedHeight(nextHeight > 0 ? `${nextHeight}px` : null);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      setGiftVideoLockedHeight(null);
    };
  }, [isWelcomeVideoActive]);

  // Play only after data is ready; reveal frames on first paint; fail fast on stall.
  useEffect(() => {
    if (!isWelcomeVideoActive || welcomeVideoFadingRef.current) return undefined;

    const video = welcomeVideoRef.current;
    if (!video) return undefined;

    let cancelled = false;
    let playRetryTimer = null;
    setWelcomeVideoHasFrame(false);
    clearWelcomeVideoTimers();

    const markFirstFrame = () => {
      if (cancelled || welcomeVideoFadingRef.current) return;
      setWelcomeVideoHasFrame(true);
      if (welcomeVideoFirstFrameTimerRef.current) {
        window.clearTimeout(welcomeVideoFirstFrameTimerRef.current);
        welcomeVideoFirstFrameTimerRef.current = null;
      }
    };

    const onPlaying = () => markFirstFrame();
    const onTimeUpdate = () => {
      if (video.currentTime > 0.04) markFirstFrame();
    };
    const onLoadedData = () => {
      if (video.readyState >= 2 && !video.paused && video.currentTime > 0) markFirstFrame();
    };

    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadeddata', onLoadedData);

    welcomeVideoFirstFrameTimerRef.current = window.setTimeout(() => {
      handleWelcomeVideoEndRef.current(false);
    }, GIFT_VIDEO_FIRST_FRAME_TIMEOUT_MS);

    welcomeVideoHardFallbackTimerRef.current = window.setTimeout(() => {
      handleWelcomeVideoEndRef.current(false);
    }, GIFT_VIDEO_HARD_FALLBACK_MS);

    const tryPlay = () => {
      if (cancelled || welcomeVideoFadingRef.current) return;
      video.play().catch((err) => {
        console.log('React welcome video play error:', err);
        if (cancelled) return;
        playRetryTimer = window.setTimeout(() => {
          handleWelcomeVideoEndRef.current(false);
        }, 400);
      });
    };

    const seekToStartIfPossible = () => {
      if (video.readyState < 1) return;
      try {
        if (video.currentTime > 0.01) video.currentTime = 0;
      } catch {
        // Some WebViews reject seek before enough media is buffered.
      }
    };

    let onCanPlay = null;
    const startPlayback = () => {
      if (cancelled) return;
      seekToStartIfPossible();
      if (video.readyState >= 2) {
        tryPlay();
        return;
      }
      onCanPlay = () => {
        video.removeEventListener('canplay', onCanPlay);
        onCanPlay = null;
        seekToStartIfPossible();
        tryPlay();
      };
      video.addEventListener('canplay', onCanPlay);
      try {
        if (video.readyState === 0) video.load();
      } catch {
        // load() can throw on transient network errors; timeouts still cover us.
      }
    };

    startPlayback();

    return () => {
      cancelled = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadeddata', onLoadedData);
      if (onCanPlay) video.removeEventListener('canplay', onCanPlay);
      if (playRetryTimer) window.clearTimeout(playRetryTimer);
      clearWelcomeVideoTimers();
    };
  }, [clearWelcomeVideoTimers, isWelcomeVideoActive]);

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
  const [planCurrentTier, setPlanCurrentTier] = useState(0);
  const [rewardPacks, setRewardPacks] = useState({ startPack: null, targetPack: null });
  const [activePlan, setActivePlan] = useState(null);
  // 已领取但后端未核销的券码。存在时,每次登录都强制停留在最低折扣页,直到后端标记核销。
  const [claimedCode, setClaimedCode] = useState(null);
  // 确认领取弹窗:{ onConfirm } —— 点击「确认领取」后执行的领取动作。
  // 状态D · 新挑战开启过渡页:null | { reason: 'redeemed' | 'expired', coupon?: object }
  const [newChallenge, setNewChallenge] = useState(null);

  // 礼包模型下券码由 plan / claim API 写入；勿再把 ladder discounts 灌进券包。
  useEffect(() => {
    if (rewardPacks.startPack || activePlan?.initialReward) return;
    const coded = (discounts ?? []).filter((d) => d.code);
    if (!coded.length) return;
    const expiresAt = countdownSeconds > 0
      ? new Date(Date.now() + countdownSeconds * 1000).toISOString()
      : undefined;
    const entries = coded.map((d) => ({
      code: d.code,
      num: d.num != null ? String(d.num) : undefined,
      value: d.value,
      conditions: d.conditions,
      expiresAt,
      status: 'active',
      source: (d.target ?? 0) > 0 ? 'target' : 'start',
      couponId: d.couponId ?? d.campaignId,
      cycleId: rewardPlanId,
    }));
    setCouponWallet(upsertCouponsToWallet(touchId, entries));
    // countdownSeconds 仅用于推导过期时间,不入依赖以免每秒重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlan?.initialReward, discounts, rewardPacks.startPack, touchId]);

  // 过期标记:expiresAt 已过的活跃券标记为 'expired'(随 tick 每秒复查)。
  useEffect(() => {
    if (!touchId) return;
    const now = Date.now();
    const stale = couponWallet.filter(
      (coupon) => coupon.status === 'active' && coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= now,
    );
    if (!stale.length) return;
    let next = couponWallet;
    for (const coupon of stale) next = setWalletCouponStatus(touchId, coupon.code, 'expired');
    setCouponWallet(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couponWallet, touchId, tick]);

  const upsertIssuedPackCoupons = useCallback((pack, coupons, { reveal = false } = {}) => {
    if (!pack?.id || !Array.isArray(coupons) || !coupons.length) return [];
    const fallbackExpiresAt = countdownSeconds > 0
      ? new Date(Date.now() + countdownSeconds * 1000).toISOString()
      : undefined;
    const entries = coupons
      .filter((coupon) => coupon?.code)
      .map((coupon) => enrichCouponDisplay({
        packId: pack.id,
        paletteTier: coupon.paletteTier,
        code: coupon.code,
        num: coupon.num,
        value: coupon.value,
        headline: coupon.headline,
        conditions: coupon.conditions,
        couponType: coupon.couponType,
        displayMode: coupon.displayMode,
        restrictions: coupon.restrictions,
        currencyCode: coupon.currencyCode,
        expiresAt: coupon.expiresAt ?? fallbackExpiresAt,
        status: 'active',
        source: pack.type === 'target' ? 'target' : 'start',
        couponId: coupon.couponId ?? coupon.campaignId,
        cycleId: activePlan?.cycleId ?? rewardPlanId ?? undefined,
        addedAt: new Date().toISOString(),
      }));
    if (!entries.length) return [];
    setCouponWallet(upsertCouponsToWallet(touchId, entries));
    if (reveal) {
      const revealCoupons = selectPackRevealCoupons(pack, entries, { requireCode: true });
      if (revealCoupons.length) setGiftReveal({ pack, coupons: revealCoupons });
    }
    void refreshCouponWallet();
    return entries;
  }, [activePlan?.cycleId, countdownSeconds, refreshCouponWallet, rewardPlanId, touchId]);

  const syncFromPlan = useCallback((plan, { fromCache = false, devPreview = false, fromNewChallengeRenew = false, previousCycleId = null } = {}) => {
    const renewInProgress = Boolean(newChallengeRenewRef.current || renewFlowActiveRef.current);
    let claimRecord = readClaimRecord(touchId);
    const planCycleId = plan.cycleId ?? plan.rewardPlanId ?? null;
    const claimCycleMismatch =
      Boolean(claimRecord?.cycleId) &&
      Boolean(planCycleId) &&
      claimRecord.cycleId !== planCycleId;
    const localWalletHasStaleCycle = readCouponWallet(touchId).some(
      (row) => row.cycleId && planCycleId && row.cycleId !== planCycleId,
    );
    const welcomeDoneEarly = readWelcomeCompleted(touchId);
    const welcomeCycleId = readWelcomeCycleId(touchId);
    const cachedCycleId = previousCycleId || null;
    const cycleChangedFromCache =
      Boolean(cachedCycleId) &&
      Boolean(planCycleId) &&
      cachedCycleId !== planCycleId;
    const sampleNeedsWelcomeReplay =
      isSampleMagnetParam(magnetBrandParamRef.current) &&
      welcomeDoneEarly &&
      !welcomeCycleId &&
      typeof window !== 'undefined' &&
      !window.sessionStorage.getItem(`fc.welcome_replay.${touchId}`);
    const welcomeBoundToOtherCycle =
      welcomeDoneEarly &&
      Boolean(planCycleId) &&
      (
        (welcomeCycleId && welcomeCycleId !== planCycleId) ||
        (!welcomeCycleId && cycleChangedFromCache) ||
        (!welcomeCycleId && (claimCycleMismatch || localWalletHasStaleCycle)) ||
        sampleNeedsWelcomeReplay
      );
    const mappedPreview = mapPlanToViewModel(plan, claimRecord, magnetBrandParamRef.current);
    const shouldRestartFirstWelcome =
      !fromCache &&
      !devPreview &&
      !fromNewChallengeRenew &&
      !renewInProgress &&
      !mappedPreview.cycleExpired &&
      !mappedPreview.couponRedeemed &&
      (mappedPreview.currentStepIndex ?? 0) === 0 &&
      welcomeBoundToOtherCycle;

    if (shouldRestartFirstWelcome) {
      dbg('[FCDBG][App] server reset detected — restart first-round welcome', {
        planCycleId,
        previousCycleId: cachedCycleId,
        welcomeCycleId,
        claimCycleId: claimRecord?.cycleId,
        welcomeDone: welcomeDoneEarly,
      });
      clearMagnetClientSession(touchId);
      try {
        window.sessionStorage.setItem(`fc.welcome_replay.${touchId}`, '1');
      } catch {
        // ignore
      }
      claimRecord = null;
      setClaimedCode(null);
      setCouponWallet([]);
      const vm = mapPlanToViewModel(plan, null, magnetBrandParamRef.current);
      setActivePlan(plan);
      setRewardPlanId(vm.rewardPlanId);
      setDiscounts(vm.discounts.length ? vm.discounts : (import.meta.env.DEV ? INITIAL_DISCOUNTS : []));
      setPlanCurrentTier(plan.currentTier ?? 0);
      setRewardPacks(resolveRewardPacks(plan, vm.discounts, vm.rewardPlanId ?? touchId));
      setCurrentStepIndex(vm.currentStepIndex);
      setCountdownSeconds(vm.countdownSeconds);
      setBrand(vm.brand);
      setChallenges(vm.challenges.length ? vm.challenges : (import.meta.env.DEV ? FALLBACK_CHALLENGES : []));
      setDailyCapReached(vm.dailyCapReached);
      setHasInitialDiscount(vm.hasInitialDiscount);
      setWelcomeTargetPoints(vm.points);
      setPoints(Math.max(0, (vm.points ?? 0) - (vm.tapReward?.awarded ?? 0) - (vm.shopifyReward?.awarded ?? 0)));
      setWelcomeCoupon(
        vm.startPack?.coupons?.[0]
          ?? vm.discounts?.[vm.currentStepIndex]
          ?? vm.discounts?.[0]
          ?? null,
      );
      setWelcomeStep(0);
      setIntroActive(true);
      setReturnIntroGate(true);
      setRenewGiftIntro(true);
      renewFlowActiveRef.current = true;
      setRenewFlowActive(true);
      renewPlanRef.current = plan;
      setRenewPlanReady(true);
      renewPlanAppliedRef.current = false;
      giftEndedPendingRenewRef.current = false;
      newChallengeRenewRef.current = { promise: Promise.resolve(plan), reason: 'server-reset' };
      returnIntroPendingRef.current = false;
      returnIntroShownRef.current = true;
      applyBrandTheme(vm.brand);
      return vm;
    }

    if (claimCycleMismatch) {
      clearClaimedCode(touchId);
      claimRecord = null;
    }
    const vm = mapPlanToViewModel(plan, claimRecord, magnetBrandParamRef.current);
    setActivePlan(plan);
    setRewardPlanId(vm.rewardPlanId);
    setDiscounts(vm.discounts.length ? vm.discounts : (import.meta.env.DEV ? INITIAL_DISCOUNTS : []));
    setPlanCurrentTier(plan.currentTier ?? 0);
    setRewardPacks(resolveRewardPacks(plan, vm.discounts, vm.rewardPlanId ?? touchId));
    setCurrentStepIndex(vm.currentStepIndex);
    setCountdownSeconds(vm.countdownSeconds);
    setBrand(vm.brand);
    setChallenges(vm.challenges.length ? vm.challenges : (import.meta.env.DEV ? FALLBACK_CHALLENGES : []));
    setDailyCapReached(vm.dailyCapReached);
    setHasInitialDiscount(vm.hasInitialDiscount);
    setWelcomeTargetPoints(vm.points);

    if (!devPreview) {
      const packExpiresAt = vm.countdownSeconds > 0
        ? new Date(Date.now() + vm.countdownSeconds * 1000).toISOString()
        : undefined;
      // Only sync coupons the user has actually received — never locked target preissues.
      const walletEntries = buildWalletEntriesFromPacks({
        rewardPlanId: vm.rewardPlanId,
        cycleId: plan.cycleId ?? plan.rewardPlanId,
        startPack: vm.initialPackIssued ? vm.startPack : null,
        targetPack: vm.targetPackIssued ? vm.targetPack : null,
        expiresAt: packExpiresAt,
      });
      const cycleId = plan.cycleId ?? plan.rewardPlanId;
      if (cycleId) {
        setCouponWallet(syncWalletForCycle(touchId, cycleId, walletEntries, {
          // Renew/reset opens a fresh round — drop prior-cycle local wallet rows.
          pruneOtherCycles: fromNewChallengeRenew,
        }));
      } else if (walletEntries.length) {
        setCouponWallet(upsertCouponsToWallet(touchId, walletEntries));
      }
    }

    if (devPreview) {
      setPoints(vm.points);
      applyBrandTheme(vm.brand);
      return vm;
    }

    const welcomeDone = readWelcomeCompleted(touchId);
    if (welcomeDone && planCycleId && !readWelcomeCycleId(touchId)) {
      writeWelcomeCompleted(touchId, true, planCycleId);
    }
    const welcomeInProgress = vm.hasInitialDiscount && !welcomeDone;
    const storedClaim = claimRecord?.code ?? null;
    const redeemedMatch =
      (vm.recentlyRedeemedCoupon &&
        storedClaim &&
        vm.recentlyRedeemedCoupon.couponCode === storedClaim) ||
      vm.couponRedeemed;
    const tapAwarded = vm.tapReward?.awarded ?? 0;
    const shopifyAwarded = vm.shopifyReward?.awarded ?? 0;
    const serverEntryAwarded = shopifyAwarded > 0 ? shopifyAwarded : tapAwarded;
    const entryKind = shopifyAwarded > 0 ? 'shopify' : 'tap';
    const entryTapFxOnVisit = entryTapFxRequestedRef.current && !renewInProgress && !fromNewChallengeRenew;
    const displayEntryPts = serverEntryAwarded > 0
      ? serverEntryAwarded
      : (entryTapFxOnVisit ? TAP_ENTRY_DISPLAY_POINTS : 0);
    const blocksEntryReward =
      displayEntryPts <= 0 ||
      vm.cycleExpired ||
      redeemedMatch;
    const deferEntryFx = !blocksEntryReward;
    const entryBasePoints = Math.max(0, vm.points - displayEntryPts);
    const shouldDeferEntryFx =
      deferEntryFx &&
      (returnIntroPendingRef.current || welcomeInProgress || pointsRef.current < entryBasePoints);

    const resolveSyncedPoints = (planPoints) => {
      const settlementAnchor = lastSettlementBalanceRef.current;
      if (
        settlementAnchor != null
        && tapAwarded > 0
        && planPoints === settlementAnchor + tapAwarded
      ) {
        patchCachedRewardPlanPoints(touchId, settlementAnchor);
        dbg('[FCDBG][App] ignore spurious tap bump on plan sync', {
          planPoints,
          settlementAnchor,
          tapAwarded,
        });
        return settlementAnchor;
      }
      if (settlementAnchor != null && planPoints === settlementAnchor) {
        lastSettlementBalanceRef.current = null;
      }
      return planPoints;
    };

    if (!renewInProgress) {
      pendingTapTargetRef.current = vm.points;
      if (shopifyAwarded > 0) {
        setShopifyLoginTaskStatus('completed');
      }
      const sameCycle = !plan.cycleId || !rewardPlanIdRef.current || plan.cycleId === rewardPlanIdRef.current;
      const stalePlanPoints = sameCycle && vm.points < pointsRef.current;
      if (shouldDeferEntryFx) {
        pendingRewardKindRef.current = entryKind;
        pendingTapRewardRef.current = displayEntryPts;
        setPendingRewardSignal((value) => value + 1);
        setPoints(entryBasePoints);
      } else if (deferEntryFx && displayEntryPts > 0) {
        pendingTapRewardRef.current = 0;
        pendingRewardKindRef.current = 'tap';
        if (!stalePlanPoints) setPoints(resolveSyncedPoints(vm.points));
      } else if (stalePlanPoints) {
        pendingTapRewardRef.current = 0;
        pendingRewardKindRef.current = 'tap';
        dbg('[FCDBG][App] skip stale plan points regression', {
          incoming: vm.points,
          displayed: pointsRef.current,
          cycleId: plan.cycleId,
        });
      } else {
        pendingTapRewardRef.current = 0;
        pendingRewardKindRef.current = 'tap';
        setPoints(resolveSyncedPoints(vm.points));
      }
    }

    const isReturnVisit =
      welcomeDone ||
      !!storedClaim ||
      returnIntroPendingRef.current;
    const packRewardFlow = Boolean(vm.startPack?.coupons?.length);
    const shouldShowReturnIntro =
      isReturnVisit &&
      !welcomeInProgress &&
      !fromCache &&
      !vm.cycleExpired &&
      !redeemedMatch &&
      !returnIntroShownRef.current &&
      !renewFlowActiveRef.current;
    const singleCouponPlan = isSingleCouponReward(vm.startPack, vm.targetPack);
    const singleCouponIssued = singleCouponPlan && (vm.couponClaimed || Boolean(vm.claimedCouponCode));
    const initialPackCoupon = vm.startPack?.coupons?.[0] ?? null;
    const initialRewardIssued =
      vm.initialPackIssued ||
      Boolean(initialPackCoupon?.code) ||
      vm.couponClaimed ||
      Boolean(vm.claimedCouponCode);

    if (!fromNewChallengeRenew && !renewInProgress) {
      if (packRewardFlow && !initialRewardIssued) {
        if (welcomeDone) {
          setWelcomeStep(1);
          setIntroActive(false);
          setReturnIntroGate(false);
          returnIntroPendingRef.current = false;
          returnIntroShownRef.current = true;
        } else if (welcomeInProgress) {
          setIntroActive(welcomeStepRef.current === 0);
        }
      } else if (packRewardFlow && initialRewardIssued) {
        if (!welcomeDone) writeWelcomeCompleted(touchId, true, planCycleId);
        if (!returnIntroPendingRef.current) {
          setWelcomeStep(3);
          setIntroActive(false);
          setReturnIntroGate(false);
          returnIntroPendingRef.current = false;
          returnIntroShownRef.current = true;
        }
      } else if (singleCouponPlan && singleCouponIssued) {
        if (!welcomeDone) writeWelcomeCompleted(touchId, true, planCycleId);
        if (!returnIntroPendingRef.current) {
          setWelcomeStep(3);
          setIntroActive(false);
          setReturnIntroGate(false);
          returnIntroShownRef.current = true;
          returnIntroPendingRef.current = false;
        }
      } else if (welcomeInProgress) {
        setIntroActive(welcomeStepRef.current === 0);
      } else if (shouldShowReturnIntro || returnIntroPendingRef.current) {
        // 非首次回访:礼盒与 plan 并行,结束后再进首页
        if (!welcomeDone) writeWelcomeCompleted(touchId, true, planCycleId);
        setWelcomeStep(3);
        setIntroActive(true);
        setReturnIntroGate(true);
        returnIntroPendingRef.current = true;
      } else if (!returnIntroPendingRef.current) {
        setIntroActive(false);
        setReturnIntroGate(false);
        if (!vm.hasInitialDiscount) {
          setWelcomeStep(3);
          if (!welcomeDone) writeWelcomeCompleted(touchId, true, planCycleId);
        }
      }
    }

    applyBrandTheme(vm.brand);

    // 活动周期仅按 cycleExpiresAt 结束；券核销不再触发新挑战过渡页。
    if (!fromNewChallengeRenew && !renewInProgress) {
      if (!fromCache) {
        if (vm.cycleExpired && !welcomeInProgress) {
          const settlementCoupon = resolveSettlementCoupon({
            discounts: vm.discounts,
            claimRecord,
            observedCoupon: plan.observedCoupon,
            fallbackCoupon: vm.discounts[vm.currentStepIndex] ?? vm.discounts[vm.discounts.length - 1],
          });
          setNewChallenge((prev) => prev ?? { reason: 'expired', coupon: settlementCoupon });
          setIntroActive(false);
          setReturnIntroGate(false);
          returnIntroPendingRef.current = false;
        } else {
          setNewChallenge((prev) => {
            if (!vm.cycleExpired && prev?.reason === 'expired') return null;
            return prev;
          });
          if (vm.couponClaimed && vm.claimedCouponCode) {
            const cycleId = plan.cycleId ?? plan.rewardPlanId;
            const matchedDiscount = vm.discounts.find(
              (d) => d.code === vm.claimedCouponCode
                || d.couponId === plan.observedCoupon?.couponId
                || d.tier === plan.observedCoupon?.tier,
            );
            writeClaimRecord(touchId, {
              code: vm.claimedCouponCode,
              couponId: plan.observedCoupon?.couponId,
              tier: plan.observedCoupon?.tier,
              cycleId,
              num: matchedDiscount?.num ?? plan.observedCoupon?.discountValue?.replace('%', ''),
              value: matchedDiscount?.value,
            });
            setClaimedCode(vm.claimedCouponCode);
          }
        }
      } else if (vm.couponClaimed && vm.claimedCouponCode) {
        const cycleId = plan.cycleId ?? plan.rewardPlanId;
        const matchedDiscount = vm.discounts.find(
          (d) => d.code === vm.claimedCouponCode
            || d.couponId === plan.observedCoupon?.couponId
            || d.tier === plan.observedCoupon?.tier,
        );
        writeClaimRecord(touchId, {
          code: vm.claimedCouponCode,
          couponId: plan.observedCoupon?.couponId,
          tier: plan.observedCoupon?.tier,
          cycleId,
          num: matchedDiscount?.num ?? plan.observedCoupon?.discountValue?.replace('%', ''),
          value: matchedDiscount?.value,
        });
        setClaimedCode(vm.claimedCouponCode);
      }
    }

    if (claimRecord?.code && !(redeemedMatch && storedClaim)) {
      setClaimedCode(claimRecord.code);
    }

    if (!fromNewChallengeRenew && !renewInProgress && vm.awaitingNewChallenge) {
      setNewChallenge((prev) => {
        if (prev?.coupon) return prev;
        const settlementCoupon = resolveSettlementCoupon({
          discounts: vm.discounts,
          claimRecord,
          observedCoupon: plan.observedCoupon,
        });
        settlementCouponRef.current = settlementCoupon ?? settlementCouponRef.current;
        return { reason: 'expired', coupon: settlementCoupon };
      });
      setIntroActive(false);
      setReturnIntroGate(false);
    }

    return vm;
  }, [touchId]);

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
    setRewardPlanFetched(true);
    setNewChallenge(null);
    setShowReceipt(false);
    setReceiptCoupon(null);
    setZoomActive(false);
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
        readCouponTokensForTier,
        tierForDiscount,
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
      entryTapFxRequestedRef.current = true;
      entryTapFxPlayedRef.current = false;
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

  const reloadPlan = useCallback(async ({ refresh = false, background = false, skipTapReward = false } = {}) => {
    if (devPreviewActiveRef.current) {
      const resolved = resolveDevScene(devSceneRef.current || 'home');
      if (resolved) {
        syncFromPlan(resolved.plan, { devPreview: true });
        return resolved.plan;
      }
    }

    if (!background) setPlanLoading(true);
    try {
      const plan = await fetchRewardPlan(touchId, { refresh, skipTapReward });
      clearGameSessionCache();
      writeCachedRewardPlan(touchId, plan);
      if (newChallengeRenewRef.current || renewFlowActiveRef.current) {
        syncFromPlan(plan, { fromNewChallengeRenew: true });
      } else {
        syncFromPlan(plan);
      }
      return plan;
    } finally {
      if (!background) setPlanLoading(false);
    }
  }, [clearGameSessionCache, syncFromPlan, touchId]);

  // 领取:调用 redeem 发券,持久化本周期券码,返回带 code 的 coupon 供 Zoom 展示。
  const issueClaimedCoupon = useCallback(async (coupon) => {
    const issueLocalClaim = () => {
      const code = coupon?.code || `FC${coupon?.num ?? '15'}RITUAL`;
      const withCode = couponWithCode(coupon, code);
      writeClaimRecord(touchId, { code, couponId: coupon?.couponId, tier: coupon?.tier, num: coupon?.num, value: coupon?.value });
      setClaimedCode(code);
      setDiscounts((prev) => applyClaimToDiscounts(prev, { code, couponId: coupon?.couponId, tier: coupon?.tier }));
      settlementCouponRef.current = withCode;
      return { code, cycleClosed: false, coupon: withCode };
    };

    if (devPreviewActiveRef.current) {
      return issueLocalClaim();
    }

    if (!rewardPlanId && coupon?.code) {
      return issueLocalClaim();
    }
    if (!rewardPlanId) throw new Error('Reward plan is not ready yet');
    const couponId = coupon?.couponId ?? coupon?.campaignId;
    if (!couponId) throw new Error('No coupon for this tier');

    let issued;
    try {
      issued = await claimCoupon(touchId, rewardPlanId, couponId);
    } catch (err) {
      if (isRecoverableClaimError(err)) {
        return issueLocalClaim();
      }
      throw err;
    }
    const code = issued?.couponCode ?? coupon?.code;
    if (!code) throw new Error('No coupon code returned');

    const claim = {
      code,
      couponId: issued.couponId ?? couponId,
      tier: coupon?.tier,
      cycleId: rewardPlanId,
      num: coupon?.num,
      value: coupon?.value,
    };
    writeClaimRecord(touchId, claim);
    clearCachedRewardPlan(touchId);
    setClaimedCode(code);
    setDiscounts((prev) => applyClaimToDiscounts(prev, claim));
    const claimedCoupon = couponWithCode(coupon, code);
    settlementCouponRef.current = claimedCoupon;
    return {
      code,
      cycleClosed: Boolean(issued.cycleClosed),
      coupon: claimedCoupon,
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
      if (!renewFlowActiveRef.current) {
        reloadPlan({ background: true }).catch((err) => {
          dbgError('[FCDBG][App] welcome earn more reload failed', err);
        });
      }
    };

    if (needsShopifyAuth() && !getMoreOffAuthPromptSeen) {
      showShopifyAuth('get_more_off', advanceWelcome);
      return;
    }
    advanceWelcome();
  }, [reloadPlan, shopifyAuthStatus, getMoreOffAuthPromptSeen]);

  const withShellBrand = useCallback((start) => applyShellBrandToGameStart(start, brand), [brand]);

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
    if (!rewardPlanId || !touchId) return undefined;
    const gameChallenges = challenges
      .filter((challenge) => challenge.type !== 'survey' && challenge.gameInstanceId);
    if (!gameChallenges.length) return undefined;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      preloadRuntimeManifest(touchId).catch((err) => {
        dbgError('[FCDBG][App] manifest preload during warm-up failed', err);
      });
      gameChallenges.forEach((challenge) => {
        preloadGameStart(challenge)?.catch(() => {
          // Preloading is an optimization; click-time fallback will surface errors.
        });
      });
    };

    const idleId = window.requestIdleCallback
      ? window.requestIdleCallback(run, { timeout: 600 })
      : window.setTimeout(run, 120);

    return () => {
      cancelled = true;
      if (window.cancelIdleCallback && typeof idleId === 'number') {
        window.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [challenges, preloadGameStart, rewardPlanId, touchId]);

  useEffect(() => {
    if (!isDevPreviewEnabled()) return;
    const syncSceneFromUrl = () => setDevScene(getDevScene());
    window.addEventListener('popstate', syncSceneFromUrl);
    return () => window.removeEventListener('popstate', syncSceneFromUrl);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!touchIdValid || !touchId) {
      setPlanLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (isDevPreviewEnabled() && devScene) {
      applyDevPreviewScene(devScene);
      return () => {
        cancelled = true;
      };
    }

    // renew / welcome 流程进行中时，禁止重跑整段 session 初始化（否则会重置 intro 导致 gift 重播）
    if (renewFlowActiveRef.current || newChallengeRenewRef.current) {
      return () => {
        cancelled = true;
      };
    }

    if (sessionBootstrapCompleteRef.current === touchId) {
      return () => {
        cancelled = true;
      };
    }

    setWelcomeStep(3);
    setClaimedCode(readClaimRecord(touchId)?.code ?? null);
    setNewChallenge(null);
    const hadCachedPlan = Boolean(readCachedRewardPlan(touchId));
    setPlanLoading(!hadCachedPlan);
    setPlanError(null);
    setRewardPlanId(null);
    setActivePlan(null);
    clearGameSessionCache();
    setRewardPlanFetched(false);
    giftEndPendingRef.current = false;
    setGiftWaitingPlan(false);

    rememberTouchId(touchId);
    returnIntroShownRef.current = false;
    returnIntroPendingRef.current = false;
    entryTapFxRequestedRef.current = false;
    entryTapFxPlayedRef.current = false;

    const shopifyOAuthReturn = isShopifyOAuthPending(touchId);

    // 每次 Tap 进入都播礼盒视频（OAuth 回流 / renew 流程除外）
    if (!shopifyOAuthReturn && !renewFlowActiveRef.current && !newChallengeRenewRef.current) {
      if (!readWelcomeCompleted(touchId) && isReturnVisitor(touchId)) {
        writeWelcomeCompleted(touchId);
      }
      entryTapFxRequestedRef.current = true;
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
      setIntroActive(true);
      setWelcomeStep(3);
    }

    preloadRuntimeManifest(touchId).catch((err) => {
      dbgError('[FCDBG][App] runtime manifest preload failed', err);
    });

    clearCachedMagnetBrandParam(touchId);

    const cached = readCachedRewardPlan(touchId);

    (async () => {
      try {
        await syncMagnetBrandParam();
        if (cancelled) return;

        if (cached && !shopifyOAuthReturn) {
          syncFromPlan(cached, { fromCache: true });
          setPlanLoading(false);
        }

        void syncPlayerProfile();
        void syncLeaderboard();

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
          const previousCycleId = cached?.cycleId ?? cached?.rewardPlanId ?? null;
          writeCachedRewardPlan(touchId, plan);
          if (newChallengeRenewRef.current || renewFlowActiveRef.current) {
            syncFromPlan(plan, { fromNewChallengeRenew: true, previousCycleId });
          } else {
            syncFromPlan(plan, { previousCycleId });
          }
        }
      } catch (err) {
        if (!cancelled) setPlanError(err instanceof Error ? err.message : 'Failed to load rewards');
      } finally {
        if (!cancelled) {
          setPlanLoading(false);
          setRewardPlanFetched(true);
          sessionBootstrapCompleteRef.current = touchId;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDevPreviewScene, applyMagnetBrandParam, clearGameSessionCache, devScene, syncFromPlan, syncMagnetBrandParam, syncShopifyBindingStatus, touchId, touchIdValid]);

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

  const ladderCurrent = discounts[currentStepIndex] || discounts[discounts.length - 1] || { num: '15', target: 0, tier: 1 };
  const realDiscountTargets = discounts.filter((discount) => (rewardPercent(discount) ?? 0) > 0);
  const singleTargetCoupon = !hasInitialDiscount && realDiscountTargets.length === 1 ? realDiscountTargets[0] : null;
  // 单档券:积分达到该档门槛即具备领取资格,需立即切到 best offer 待领页,
  // 不能再等后端 currentTier 刷新(否则达标后仍停留在进度页)。
  const reachedSingleTarget = singleTargetCoupon != null && points >= (singleTargetCoupon.target ?? 0);
  const singleTargetMode = Boolean(
    singleTargetCoupon &&
    !reachedSingleTarget &&
    (currentStepIndex === 0 || (rewardPercent(ladderCurrent) ?? 0) === 0)
  );
  const current = singleTargetMode
    ? { num: '0', value: '0% OFF', target: 0, tier: 0 }
    : (reachedSingleTarget ? singleTargetCoupon : ladderCurrent);
  const currentTier = current.tier ?? currentStepIndex + 1;
  const nextThreshold = singleTargetMode
    ? singleTargetCoupon.target
    : nextTierThresholdFromDiscounts(discounts, currentTier);
  const targetPoints = nextThreshold ?? current?.target ?? 0;
  const next = singleTargetMode
    ? singleTargetCoupon
    : (nextThreshold != null ? discounts.find((d) => d.tier === currentTier + 1) ?? null : null);
  const progressPct = nextThreshold != null && targetPoints > 0 ? Math.min((points / targetPoints) * 100, 100) : 100;
  const delta = nextThreshold != null ? Math.max(targetPoints - points, 0) : 0;

  // ——— 礼包模型(新):首页只关心 target 礼包的解锁进度,所有券进券包 ———
  const derivedPacks = rewardPacks;
  const currentPack = useMemo(() => {
    if (devScene) return { ...MOCK_CURRENT_PACK, coupons: assignCouponPaletteTiers(MOCK_CURRENT_PACK.coupons) };
    if (!derivedPacks.startPack) return null;
    return {
      id: `start-${rewardPlanId ?? 'local'}`,
      type: 'start',
      title: 'Your welcome gift',
      subtitle: 'Your current discounts are ready to claim.',
      coupons: assignCouponPaletteTiers(derivedPacks.startPack.coupons),
    };
  }, [derivedPacks.startPack, devScene, rewardPlanId]);
  const targetPack = useMemo(() => {
    if (devScene) return { ...MOCK_TARGET_PACK, coupons: assignCouponPaletteTiers(MOCK_TARGET_PACK.coupons) };
    if (!derivedPacks.targetPack) return null;
    return {
      id: `target-${rewardPlanId ?? 'local'}`,
      type: 'target',
      title: 'Your target gift',
      subtitle: 'Your bonus coupons, ready to use.',
      ...derivedPacks.targetPack,
      coupons: assignCouponPaletteTiers(derivedPacks.targetPack.coupons),
    };
  }, [derivedPacks.targetPack, devScene, rewardPlanId]);
  const targetThreshold = targetPack?.threshold ?? null;
  const targetCoupons = targetPack?.coupons ?? [];
  const targetCouponCount = targetCoupons.length;
  const targetUnlocked = !targetPack
    || planCurrentTier >= 1
    || (targetThreshold != null && targetThreshold > 0 && points >= targetThreshold);
  const initialPackIssued = devScene
    ? walletHasPack(couponWallet, currentPack?.id)
    : isInitialPackIssued(activePlan, derivedPacks.startPack) || walletHasPack(couponWallet, currentPack?.id);
  const targetPackIssued = devScene
    ? walletHasPack(couponWallet, targetPack?.id)
    : isTargetPackIssued(activePlan, derivedPacks.targetPack) || walletHasPack(couponWallet, targetPack?.id);
  const currentPackClaimed = initialPackIssued;
  const targetClaimed = targetPackIssued;
  const currentPackIssuedCoupons = useMemo(() => {
    if (!currentPack) return [];
    const issued = couponWallet.filter((coupon) => coupon.packId === currentPack.id);
    return currentPack.coupons.map((coupon) => {
      const matched = issued.find((entry) => entry.couponId === coupon.couponId);
      return matched
        ? enrichCouponDisplay({ ...matched, ...coupon, code: matched.code ?? coupon.code })
        : enrichCouponDisplay(coupon);
    });
  }, [couponWallet, currentPack]);
  const packCouponsForDisplay = useMemo(
    () => [...(currentPack?.coupons ?? []), ...(targetPack?.coupons ?? [])],
    [currentPack, targetPack],
  );

  const enrichedCouponWallet = useMemo(() => {
    const completedPreviewWallet = devScene === 'completed'
      ? [
          ...mockPackWalletEntries(currentPack),
          ...mockPackWalletEntries(targetPack),
        ]
      : [];
    const devMockCoupons = import.meta.env.DEV && devScene
      ? [
          ...MOCK_DEV_ACTIVE_COUPONS,
          ...MOCK_USED_COUPONS,
          ...MOCK_EXPIRED_COUPONS,
        ]
      : [];
    const revealBoost = walletRevealCoupons.filter((coupon) => coupon?.code);
    const walletByKey = new Map(
      dedupeWalletCoupons([...couponWallet, ...completedPreviewWallet, ...devMockCoupons, ...revealBoost])
        .filter((coupon) => coupon?.code)
        .map((coupon) => {
          const key = walletCouponKey(coupon) ?? coupon.code;
          return [key, coupon];
        }),
    );
    return enrichWalletCoupons([...walletByKey.values()], packCouponsForDisplay);
  }, [couponWallet, currentPack, targetPack, devScene, packCouponsForDisplay, walletRevealCoupons]);

  const completedAvailableCoupons = useMemo(
    () => selectCompletedAvailableCoupons(enrichedCouponWallet),
    [enrichedCouponWallet],
  );

  const walletArchiveCoupons = useMemo(
    () => selectWalletArchiveCoupons(enrichedCouponWallet),
    [enrichedCouponWallet],
  );

  const walletBadgeCount = useMemo(
    () => enrichedCouponWallet.filter((coupon) => isWalletCouponUsable(coupon)).length,
    [enrichedCouponWallet],
  );
  const targetProgressPct = targetThreshold ? Math.min((points / targetThreshold) * 100, 100) : 100;
  const targetDelta = targetThreshold ? Math.max(targetThreshold - points, 0) : 0;
  const singleCouponOnlyMode = useMemo(
    () => !devScene && isSingleCouponReward(derivedPacks.startPack, derivedPacks.targetPack),
    [derivedPacks.startPack, derivedPacks.targetPack, devScene],
  );
  const packTargetMode = Boolean(
    targetPack?.coupons?.length && targetThreshold > 0 && !singleCouponOnlyMode,
  );
  const soleRewardPack = useMemo(() => {
    if (!singleCouponOnlyMode) return null;
    if (currentPack?.coupons?.length === 1) return currentPack;
    if (targetPack?.coupons?.length === 1) return targetPack;
    return null;
  }, [singleCouponOnlyMode, currentPack, targetPack]);
  const solePackClaimed = soleRewardPack ? walletHasPack(couponWallet, soleRewardPack.id) : false;

  useEffect(() => {
    singleCouponOnlyRef.current = singleCouponOnlyMode;
    solePackClaimedRef.current = solePackClaimed;
    currentPackClaimedRef.current = currentPackClaimed;
  }, [singleCouponOnlyMode, solePackClaimed, currentPackClaimed]);
  const solePackIssuedCoupons = useMemo(() => {
    if (!soleRewardPack) return [];
    const issued = couponWallet.filter((coupon) => coupon.packId === soleRewardPack.id);
    return soleRewardPack.coupons.map((coupon) => {
      const matched = issued.find((entry) => entry.couponId === coupon.couponId);
      return matched
        ? enrichCouponDisplay({ ...matched, ...coupon, code: matched.code ?? coupon.code })
        : enrichCouponDisplay(coupon);
    });
  }, [couponWallet, soleRewardPack]);
  const welcomeCoupons = useMemo(() => {
    if (singleCouponOnlyMode) {
      const issued = solePackIssuedCoupons.filter((coupon) => coupon?.code);
      return issued.length ? solePackIssuedCoupons : (soleRewardPack?.coupons ?? []);
    }
    const issued = currentPackIssuedCoupons.filter((coupon) => coupon?.code);
    return issued.length ? currentPackIssuedCoupons : (currentPack?.coupons ?? []);
  }, [
    singleCouponOnlyMode,
    solePackIssuedCoupons,
    soleRewardPack,
    currentPackIssuedCoupons,
    currentPack,
  ]);
  const planBlocksHome = planLoading && !rewardPlanId;
  const welcomePackPending = Boolean(currentPack || soleRewardPack) && !readWelcomeCompleted(touchId);
  // Keep the welcome ritual only until welcome is completed — do not keep it open
  // solely because wallet packId sync lagged (that made Get More OFF look dead).
  const initialPackPending = welcomePackPending;
  const showWelcomeRitual = !introActive
    && !returnIntroGate
    && !renewGiftIntro
    && !planBlocksHome
    && initialPackPending;
  const targetUnlockAcknowledged = Boolean(rewardPlanId) && targetUnlockAckCycleId === rewardPlanId;
  const allRewardsClaimed = singleCouponOnlyMode
    ? solePackClaimed
    : currentPackClaimed && (!targetPack || targetClaimed);
  const completedMode = devScene === 'completed'
    || (
      !devScene
      && !giftReveal
      && !renewFlowActive
      && !newChallenge
      && !showWelcomeRitual
      && (allRewardsClaimed || targetUnlockAcknowledged)
    );
  const showRewardsPage = walletOpen || completedMode;
  const showRenewWelcomeLoading = renewFlowActive && !introActive && welcomeStep < 1;

  useEffect(() => {
    if (devScene || !singleCouponOnlyMode || !soleRewardPack || solePackClaimed) return;
    if (renewFlowActive) return;
    const coded = soleRewardPack.coupons.filter((coupon) => coupon?.code);
    if (coded.length) upsertIssuedPackCoupons(soleRewardPack, coded);
  }, [devScene, singleCouponOnlyMode, solePackClaimed, soleRewardPack, upsertIssuedPackCoupons, renewFlowActive]);

  useEffect(() => {
    if (devScene || renewFlowActive || !allRewardsClaimed) return;
    if (!readWelcomeCompleted(touchId)) writeWelcomeCompleted(touchId);
    setWelcomeStep(3);
    setIntroActive(false);
    setReturnIntroGate(false);
    returnIntroShownRef.current = true;
    returnIntroPendingRef.current = false;
  }, [allRewardsClaimed, devScene, touchId, renewFlowActive]);

  useEffect(() => {
    if (devScene || renewFlowActive || !allRewardsClaimed || !rewardPlanId) return;
    const packExpiresAt = countdownSeconds > 0
      ? new Date(Date.now() + countdownSeconds * 1000).toISOString()
      : undefined;
    const cycleId = activePlan?.cycleId ?? rewardPlanId;
    const entries = buildWalletEntriesFromPacks({
      rewardPlanId,
      cycleId,
      startPack: initialPackIssued ? derivedPacks.startPack : null,
      targetPack: targetPackIssued ? derivedPacks.targetPack : null,
      expiresAt: packExpiresAt,
    });
    if (!entries.length) return;
    setCouponWallet(upsertCouponsToWallet(touchId, entries));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRewardsClaimed, renewFlowActive, devScene, activePlan?.cycleId, rewardPlanId, derivedPacks.startPack, derivedPacks.targetPack, initialPackIssued, targetPackIssued]);

  useEffect(() => {
    if (!targetPack?.id || !walletRevealCoupons.length) return;
    if (walletHasPack(couponWallet, targetPack.id)) {
      setWalletRevealCoupons([]);
    }
  }, [couponWallet, targetPack?.id, walletRevealCoupons.length]);

  useEffect(() => {
    if (devScene !== 'unlocked') {
      unlockedPreviewShownRef.current = false;
      return;
    }
    if (unlockedPreviewShownRef.current || !targetPack) return;
    unlockedPreviewShownRef.current = true;
    setWalletOpen(false);
    setGiftReveal({
      pack: targetPack,
      coupons: mockPackWalletEntries(targetPack),
    });
  }, [devScene, targetPack]);

  // 最高档:后端 currentTier 已是顶级,或积分已达到阶梯最高门槛(currentTier 可能尚未刷新)
  const topTierStep = discounts[discounts.length - 1];
  const reachedTopByPoints = topTierStep != null && points >= (topTierStep.target ?? 0);
  const isBestOffer = !singleTargetMode && (nextThreshold == null || reachedTopByPoints);
  // 已领取未核销:强制展示待核销页,直到后端确认已使用或过期。
  const claimRecord = readClaimRecord(touchId);
  const claimMatchesCurrentCycle = rewardPlanId
    ? !claimRecord?.cycleId || claimRecord.cycleId === rewardPlanId
    : true;
  const showClaimedScreen = Boolean(
    !newChallenge &&
    claimedCode &&
    claimRecord?.code === claimedCode &&
    claimMatchesCurrentCycle,
  );
  const entryTapHomeBlocked = Boolean(
    showWelcomeRitual ||
    newChallenge ||
    showClaimedScreen ||
    completedMode ||
    walletOpen ||
    renewFlowActive ||
    showRenewWelcomeLoading ||
    showReceipt ||
    zoomActive ||
    giftReveal ||
    shopifyAuthOverlay,
  );
  entryTapHomeReadyRef.current = (
    !introActive &&
    !returnIntroGate &&
    !renewGiftIntro &&
    !planLoading &&
    !giftWaitingPlan &&
    !isWelcomeVideoActive &&
    !welcomeVideoFading &&
    (welcomeStep >= 3 || readWelcomeCompleted(touchId)) &&
    returnIntroShownRef.current &&
    !entryTapHomeBlocked
  );
  const showBestOffer = (showClaimedScreen || isBestOffer) && !forceWalletView;
  const lockedCoupon = claimedCode
    ? (discounts.find((d) => d.code === claimedCode) || current)
    : current;
  const settlementDisplayCoupon = newChallenge?.coupon ?? settlementCouponRef.current ?? (newChallenge?.reason === 'redeemed' ? lockedCoupon : current);
  const settlementDisplayCoupons = useMemo(() => {
    if (devScene === 'redeemed') {
      return [
        { num: '30', value: '30% OFF', code: 'FC30RITUAL', status: 'used', paletteTier: 3 },
        { num: '15', value: '15% OFF', code: 'WELCOME15', status: 'used', paletteTier: 1 },
        { value: 'Free Shipping', code: 'SHIPFREE', status: 'used', paletteTier: 2 },
      ];
    }
    if (devScene === 'expired') {
      return [
        { num: '15', value: '15% OFF', code: 'WELCOME15', status: 'expired', paletteTier: 1 },
        { value: 'Free Shipping', code: 'SHIPFREE', status: 'expired', paletteTier: 2 },
      ];
    }

    if (rewardPlanId) {
      const fromWallet = selectSettlementCouponsForCycle(couponWallet, rewardPlanId, {
        reason: newChallenge?.reason ?? 'expired',
      });
      if (fromWallet.length > 0) {
        return enrichWalletCoupons(fromWallet, packCouponsForDisplay);
      }
    }

    const fromPacks = [
      ...currentPackIssuedCoupons.filter((coupon) => coupon?.code),
      ...(targetClaimed
        ? (targetPack?.coupons ?? []).map((coupon) => {
            const issued = couponWallet.find(
              (entry) => entry.couponId === coupon.couponId && entry.code,
            );
            return issued
              ? enrichCouponDisplay({ ...coupon, ...issued, code: issued.code })
              : enrichCouponDisplay(coupon);
          }).filter((coupon) => coupon?.code)
        : []),
    ];
    if (fromPacks.length > 0) return fromPacks;

    const single = newChallenge?.coupon ?? settlementCouponRef.current;
    return single ? [single] : [];
  }, [
    couponWallet,
    currentPackIssuedCoupons,
    devScene,
    newChallenge,
    packCouponsForDisplay,
    rewardPlanId,
    targetClaimed,
    targetPack,
  ]);
  const isCurrentCouponClaimed = showClaimedScreen;
  const isExpired = countdownSeconds <= 0;
  const time = useMemo(() => formatCountdown(countdownSeconds), [countdownSeconds]);
  const expiryDate = useMemo(() => formatExpiryDate(countdownSeconds), [countdownSeconds]);
  const urgent = countdownSeconds < 86400 && countdownSeconds > 0;
  const gameProgressLadder = useMemo(() => {
    if (packTargetMode && targetThreshold > 0) {
      return [{ percent: 0, threshold: targetThreshold }];
    }
    const byTier = (discounts ?? [])
      .map((step) => ({
        tier: Math.max(0, Number(step?.tier) || 0),
        percent: Math.max(0, Number(step?.num) || 0),
        threshold: Math.max(0, Number(step?.target) || 0),
      }))
      .filter((step) => step.percent > 0)
      .sort((a, b) => a.tier - b.tier);
    if (!byTier.length) return null;
    let floor = 0;
    const normalized = byTier.map((step) => {
      floor = Math.max(floor, step.threshold);
      return { percent: step.percent, threshold: floor };
    });
    return normalized;
  }, [discounts, packTargetMode, targetThreshold]);
  const gameProgressView = useMemo(() => ({
    currentPoints: points,
    targetPoints: packTargetMode ? targetThreshold : targetPoints,
    progressPct: packTargetMode ? targetProgressPct : progressPct,
    label: packTargetMode
      ? `${points} / ${targetThreshold}`
      : `${points} / ${targetPoints}`,
    ladder: gameProgressLadder,
    giftReward: packTargetMode
      ? { couponCount: targetCouponCount }
      : null,
  }), [
    gameProgressLadder,
    packTargetMode,
    points,
    progressPct,
    targetCouponCount,
    targetPoints,
    targetProgressPct,
    targetThreshold,
  ]);

  // 预留“游戏内实时进度”事件通道:产品确认埋点后,可在这里接入实时积分变更。
  const handleGameRuntimeEvent = useCallback((event) => {
    dbg('[FCDBG][App] game runtime event channel', event);
  }, []);

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
  }

  // 完整重置回首登起点(开场礼盒 + 欢迎流)。
  function resetToFirstLogin() {
    clearWelcomeCompleted(touchId);
    clearClaimedCode(touchId);
    clearCouponWallet(touchId);
    setCouponWallet([]);
    setClaimedCode(null);
    setTargetUnlockAckCycleId(null);
    setWalletRevealCoupons([]);
    resetRound();                       // 刷新折扣档位 / 倒计时 / 清各类卡片
    setPoints(0);                       // 首登从 0 金币开始累积
    setWelcomeStep(0);                  // 回到欢迎流起点
    setIntroActive(true);               // 重新播放开场礼盒
    giftEndPendingRef.current = false;
    setGiftWaitingPlan(false);
    setNewChallenge(null);
  }

  // 「新挑战开启页」CTA 或演示隐藏开关：先播礼盒,并行 renew → 欢迎流(如需) → 首页 → +5
  function beginGiftIntroChallengeFlow({
    promise,
    reason,
    onFailTitle,
    onFailRestoreChallenge = true,
  }) {
    if (renewFlowActiveRef.current || newChallengeRenewRef.current) return;

    const tracked = promise
      .then((plan) => {
        clearCachedRewardPlan(touchId);
        writeCachedRewardPlan(touchId, plan);
        renewPlanRef.current = plan;
        setRenewPlanReady(true);
        if (giftEndedPendingRenewRef.current) {
          void applyRenewPlanAfterGiftRef.current?.();
        }
        return plan;
      })
      .catch((err) => {
        dbgError('[FCDBG][App] challenge intro flow failed', { reason, err });
        giftEndedPendingRenewRef.current = false;
        newChallengeRenewRef.current = null;
        renewPlanRef.current = null;
        renewFlowActiveRef.current = false;
        setRenewFlowActive(false);
        setRenewPlanReady(false);
        setRenewIssueAutoAdvance(false);
        setRenewGiftIntro(false);
        if (onFailRestoreChallenge) {
          setNewChallenge({ reason: 'expired', coupon: newChallenge?.coupon ?? null });
        }
        setIntroActive(false);
        setReturnIntroGate(false);
        // Recover plan after wiping local state for the intro shell.
        void reloadPlan({ refresh: true, background: false }).catch(() => {});
        showNotification(
          onFailTitle,
          formatFcError(err, 'Please check your connection and try again.'),
          '⚠️',
        );
        throw err;
      });

    newChallengeRenewRef.current = { promise: tracked, reason };
    renewPlanRef.current = null;
    renewFlowActiveRef.current = true;
    setRenewFlowActive(true);
    setRenewPlanReady(false);
    setRenewIssueAutoAdvance(false);
    autoIssuedPackRef.current = null;
    autoClaimInitialRef.current = null;
    renewPlanAppliedRef.current = false;
    giftEndedPendingRenewRef.current = false;

    // Drop completed/wallet overlays and stale plan so allRewardsClaimed cannot kill the gift intro.
    setNewChallenge(null);
    setShowReceipt(false);
    setZoomActive(false);
    setGiftReveal(null);
    setWalletOpen(false);
    setWalletRevealCoupons([]);
    clearClaimedCode(touchId);
    setClaimedCode(null);
    setTargetUnlockAckCycleId(null);
    clearCouponWallet(touchId);
    setCouponWallet([]);
    setActivePlan(null);
    setRewardPlanId(null);
    setRewardPacks({ startPack: null, targetPack: null });
    setDiscounts([]);

    entryTapFxRequestedRef.current = true;
    entryTapFxPlayedRef.current = false;
    clearWelcomeCompleted(touchId);
    sessionStorage.removeItem(`fc_tap_fx_${touchId}`);
    pendingTapRewardRef.current = 0;
    returnIntroShownRef.current = true;
    returnIntroPendingRef.current = false;

    setWelcomeStep(0);
    setPoints(0);
    setWelcomeCoupon(null);
    giftEndPendingRef.current = false;
    setGiftWaitingPlan(false);
    setRenewGiftIntro(true);
    setReturnIntroGate(true);
    setIntroActive(true);
  }

  function startRenewFlow(reason = 'expired') {
    beginGiftIntroChallengeFlow({
      promise: renewCycle(touchId, reason),
      reason,
      onFailTitle: 'Could not start new challenge',
      onFailRestoreChallenge: true,
    });
  }

  startRenewFlowRef.current = startRenewFlow;

  function handleStartNewChallenge() {
    startRenewFlow('expired');
  }

  /** Sample magnet: clear wallet + first-round plan (same gift/welcome shell as renew). */
  function startSampleResetFlow() {
    beginGiftIntroChallengeFlow({
      promise: sampleResetCycle(touchId),
      reason: 'sample-reset',
      onFailTitle: 'Could not reset magnet',
      // Stay on completed/home if reset fails — do not force settlement overlay.
      onFailRestoreChallenge: false,
    });
  }

  function handleSampleReset() {
    startSampleResetFlow();
  }

  startSampleResetFlowRef.current = startSampleResetFlow;

  const logoSecretEnabled = isDemoForceRenewEnabled() || isSampleMagnet;

  const handleLogoSecretTap = useCallback(() => {
    logoTapDetectorRef.current?.();
  }, []);

  useEffect(() => {
    if (!logoSecretEnabled) {
      logoTapDetectorRef.current = null;
      return undefined;
    }
    // 5× logo tap → same sample-reset + gift intro path as the Reset button.
    logoTapDetectorRef.current = createLogoTapDetector({
      onTrigger: () => {
        startSampleResetFlowRef.current?.();
      },
    });
    return () => {
      logoTapDetectorRef.current = null;
    };
  }, [logoSecretEnabled]);

  useEffect(() => {
    // 客户端倒计时归零时的兜底（主路径为 plan.cycleExpired）。
    const prev = prevCountdownRef.current;
    prevCountdownRef.current = countdownSeconds;
    if (
      prev > 0 &&
      countdownSeconds === 0 &&
      !newChallenge &&
      readWelcomeCompleted(touchId)
    ) {
      setNewChallenge({
        reason: 'expired',
        coupon: resolveSettlementCoupon({
          discounts,
          claimRecord: readClaimRecord(touchId),
        }),
      });
    }
  }, [countdownSeconds, discounts, newChallenge, touchId]);

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
          const settlementCoupon = resolveSettlementCoupon({
            discounts,
            claimRecord: readClaimRecord(touchId),
          });
          settlementCouponRef.current = settlementCoupon ?? settlementCouponRef.current;
          // 券系统判定已核销/过期 → 同步「我的券包」里这张券的状态。
          const closedCode = settlementCoupon?.code ?? readClaimRecord(touchId)?.code;
          if (closedCode) {
            setCouponWallet(setWalletCouponStatus(touchId, closedCode, reason === 'expired' ? 'expired' : 'used'));
          }
          void refreshCouponWallet();
          clearCachedRewardPlan(touchId);
          setNewChallenge({ reason, coupon: settlementCoupon });
          clearClaimedCode(touchId);
          setClaimedCode(null);
          await reloadPlan();
          if (newChallengeRenewRef.current || renewFlowActiveRef.current) return;
        } else if (result.couponStatus) {
          const record = readClaimRecord(touchId);
          if (record?.code) {
            writeClaimRecord(touchId, { ...record, observedStatus: result.couponStatus });
            if (result.couponStatus === 'redeemed') {
              setCouponWallet(setWalletCouponStatus(touchId, record.code, 'used'));
            } else if (result.couponStatus === 'expired') {
              setCouponWallet(setWalletCouponStatus(touchId, record.code, 'expired'));
            }
          }
        }
      } catch (err) {
        dbgError('[FCDBG][App] coupon observe failed', err);
      }
    };

    poll();
    const id = window.setInterval(poll, 45_000);
    return () => window.clearInterval(id);
  }, [reloadPlan, showClaimedScreen, touchId, discounts]);

  useEffect(() => () => {
    if (tearTimerRef.current) window.clearTimeout(tearTimerRef.current);
  }, []);

    const playPendingTapReward = useCallback(() => {
    const pts = pendingTapRewardRef.current;
    if (!pts || pts <= 0) return;
    if (entryTapFxPlayedRef.current) {
      pendingTapRewardRef.current = 0;
      pendingRewardKindRef.current = 'tap';
      setPoints(pendingTapTargetRef.current || pointsRef.current);
      return;
    }
    if (!entryTapHomeReadyRef.current) return;
    entryTapFxPlayedRef.current = true;
    entryTapFxRequestedRef.current = false;
    pendingTapRewardRef.current = 0;
    pendingRewardKindRef.current = 'tap';
    triggerLoginBonusAnimation(pts, pendingTapTargetRef.current || pointsRef.current + pts);
  }, [touchId]);

  const finishRenewFlowToHome = useCallback((vm) => {
    renewFlowActiveRef.current = false;
    setRenewFlowActive(false);
    setRenewPlanReady(false);
    setRenewIssueAutoAdvance(false);
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
    if (renewPlanAppliedRef.current) return;
    renewPlanAppliedRef.current = true;

    giftEndedPendingRenewRef.current = false;
    newChallengeRenewRef.current = null;
    setRenewGiftIntro(false);
    setIntroActive(false);
    setReturnIntroGate(false);

    const vm = syncFromPlan(plan, { fromNewChallengeRenew: true });
    setPlanLoading(false);
    const packRewardFlow = Boolean(vm.startPack?.coupons?.length);
    const welcomeNeeded = packRewardFlow || (vm.discounts?.length ?? 0) > 0;

    const cycleId = plan.cycleId ?? plan.rewardPlanId;
    const packExpiresAt = vm.countdownSeconds > 0
      ? new Date(Date.now() + vm.countdownSeconds * 1000).toISOString()
      : undefined;
    // Welcome / first-round wallet: only the initial gift, never the locked target pack.
    const initialWalletEntries = buildWalletEntriesFromPacks({
      rewardPlanId: vm.rewardPlanId,
      cycleId,
      startPack: vm.initialPackIssued ? vm.startPack : null,
      targetPack: null,
      expiresAt: packExpiresAt,
    });
    if (cycleId) {
      setCouponWallet(syncWalletForCycle(touchId, cycleId, initialWalletEntries, { pruneOtherCycles: true }));
    } else if (initialWalletEntries.length) {
      setCouponWallet(upsertCouponsToWallet(touchId, initialWalletEntries));
    }
    // Server wallet is authoritative after sample-reset / renew (cleared + re-issued).
    void refreshCouponWallet();

    if (welcomeNeeded) {
      const tapAwarded = vm.tapReward?.awarded ?? 0;
      pendingTapTargetRef.current = vm.points;
      if (tapAwarded > 0) {
        pendingTapRewardRef.current = tapAwarded;
        setPoints(Math.max(0, vm.points - tapAwarded));
      } else {
        setPoints(vm.points);
      }
      setRenewIssueAutoAdvance(false);
      const displayCoupon = vm.startPack?.coupons?.[0]
        ?? vm.discounts[vm.currentStepIndex]
        ?? vm.discounts[0]
        ?? null;
      setWelcomeCoupon(displayCoupon);
      setWelcomeStep(1);
      setIntroActive(false);
      setRenewGiftIntro(false);
      return;
    }

    writeWelcomeCompleted(touchId);
    setRenewIssueAutoAdvance(false);
    setWelcomeStep(3);
    finishRenewFlowToHome(vm);
  }, [finishRenewFlowToHome, refreshCouponWallet, syncFromPlan, touchId]);

  useEffect(() => {
    applyRenewPlanAfterGiftRef.current = applyRenewPlanAfterGift;
  }, [applyRenewPlanAfterGift]);

  const finishReturnIntro = useCallback(() => {
    returnIntroShownRef.current = true;
    returnIntroPendingRef.current = false;
    setReturnIntroGate(false);
    setIntroActive(false);
  }, []);

  // 礼盒结束且首页就绪后再播 +5/Shopify(不在 intro / 欢迎页 / 券包页等非首页触发)
  useEffect(() => {
    if (!entryTapHomeReadyRef.current) return undefined;
    if (!pendingTapRewardRef.current) return undefined;
    if (entryTapFxPlayedRef.current) return undefined;

    const timer = window.setTimeout(() => playPendingTapReward(), 220);
    return () => window.clearTimeout(timer);
  }, [
    completedMode,
    giftReveal,
    giftWaitingPlan,
    introActive,
    isWelcomeVideoActive,
    newChallenge,
    pendingRewardSignal,
    planLoading,
    playPendingTapReward,
    renewFlowActive,
    renewGiftIntro,
    returnIntroGate,
    shopifyAuthOverlay,
    showClaimedScreen,
    showReceipt,
    showWelcomeRitual,
    touchId,
    walletOpen,
    welcomeStep,
    welcomeVideoFading,
    zoomActive,
  ]);

  // 非首页且不会再进入首页时,静默入账 tap 奖励(不播动效)
  useEffect(() => {
    if (!completedMode && !showClaimedScreen) return;
    if (!pendingTapRewardRef.current || entryTapFxPlayedRef.current) return;
    entryTapFxPlayedRef.current = true;
    entryTapFxRequestedRef.current = false;
    pendingTapRewardRef.current = 0;
    pendingRewardKindRef.current = 'tap';
    setPoints(pendingTapTargetRef.current || pointsRef.current);
  }, [completedMode, pendingRewardSignal, showClaimedScreen]);

  // 进页时积分已够下一档门槛 → 补触发 receipt(不仅依赖 creditPoints 动画)
  useEffect(() => {
    if (introActive || planLoading || isWelcomeVideoActive || welcomeVideoFading) return undefined;
    if (returnIntroPendingRef.current && !returnIntroShownRef.current) return undefined;
    if (welcomeStep < 3 && !readWelcomeCompleted(touchId)) return undefined;
    if (targetPack || showReceipt || newChallenge || showClaimedScreen) return undefined;
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

  function triggerLoginBonusAnimation(pts, targetBalance, onComplete) {
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
          creditPoints(pts, 600, targetBalance, onComplete);
          if (welcomeAfterEntryFxRef.current) {
            welcomeAfterEntryFxRef.current = false;
            setWelcomeStep(1);
          }
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
    if (singleTargetMode) return singleTargetCoupon ?? discountList[0] ?? null;
    return discountList[stepIndex + 1] ?? discountList[stepIndex] ?? discountList[0] ?? null;
  }

  function closeReceipt() {
    setShowReceipt(false);
    setReceiptCoupon(null);
  }

  function clearInlineError() {
    setInlineError(null);
    if (inlineErrorTimerRef.current) {
      clearTimeout(inlineErrorTimerRef.current);
      inlineErrorTimerRef.current = null;
    }
  }

  function showInlineError(title, message, timeoutMs = 3600) {
    setInlineError({ title, message });
    if (inlineErrorTimerRef.current) {
      clearTimeout(inlineErrorTimerRef.current);
    }
    inlineErrorTimerRef.current = window.setTimeout(() => {
      setInlineError(null);
      inlineErrorTimerRef.current = null;
    }, timeoutMs);
  }

  function showNotification(title, message, icon = '✨', onConfirm = null) {
    if (icon === '⚠️') {
      showInlineError(title, message);
      return;
    }
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
    if (cached?.connected && !shopifyBinding?.connected) {
      setShopifyBinding(cached);
      setShopifyAuthStatus('connected');
    }
    setShopifyAccountOpen(true);
  }

  function saveUserProfile(nextProfile) {
    const normalized = normalizeProfile({
      ...nextProfile,
      brandName: brand?.name,
    });
    const displayName = normalized.nickname.trim();
    if (!displayName) {
      showNotification('Invalid name', 'Enter a display name (1–32 characters).', '⚠️');
      return;
    }
    const codeFromName = parseDisplayCodeFromLeaderboardId(brand?.name, displayName);
    const displayCode = isValidDisplayCode(codeFromName) ? codeFromName : normalized.displayCode;
    if (!isValidDisplayCode(displayCode)) {
      showNotification(
        'Invalid Leaderboard ID',
        'Use 5 characters (A–Z, 2–9). Avoid 0, O, 1, I, and L.',
        '⚠️',
      );
      return;
    }
    const avatarUrl = normalized.avatarImageUrl || '';
    const isLocalPreview = avatarUrl.startsWith('blob:') || avatarUrl.startsWith('data:');
    // Explicit clear from Profile (color picker). Do not infer from empty URL — that used to
    // wipe a just-uploaded avatar when Save raced ahead of the upload response.
    const clearAvatarImage = Boolean(nextProfile?.clearAvatarImage);
    setUserProfile(normalized);
    void updatePlayerProfile(touchId, {
      displayName,
      displayCode,
      avatarColor: normalized.avatarColor,
      clearAvatarImage,
    })
      .then((updated) => {
        const avatarImageUrl =
          isLocalPreview && !updated.avatarImageUrl
            ? avatarUrl
            : (updated.avatarImageUrl || '');
        setPlayerProfile({ ...updated, avatarImageUrl: avatarImageUrl || null });
        writeCachedProfile(touchId, {
          nickname: updated.displayName,
          displayCode: updated.displayCode,
          avatarColor: updated.avatarColor,
          avatarImageUrl,
        });
        if (!isLocalPreview) {
          setUserProfile(
            normalizeProfile({
              nickname: updated.displayName,
              displayCode: updated.displayCode,
              brandName: updated.brandName,
              avatarColor: updated.avatarColor,
              avatarImageUrl,
            }),
          );
        }
        void syncLeaderboard(true);
      })
      .catch((err) => {
        dbgError('[FCDBG][App] update player profile failed', err);
        const message = err instanceof Error ? err.message : 'Could not save profile';
        showNotification('Save failed', message, '⚠️');
        writeCachedProfile(touchId, normalized);
      });
  }

  function uploadUserAvatar(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showNotification('Upload failed', 'Image must be 2MB or smaller.', '⚠️');
      return;
    }
    void uploadPlayerAvatar(touchId, file)
      .then((updated) => {
        setPlayerProfile(updated);
        const normalized = normalizeProfile({
          nickname: updated.displayName,
          displayCode: updated.displayCode,
          brandName: updated.brandName,
          avatarColor: updated.avatarColor,
          avatarImageUrl: updated.avatarImageUrl || '',
        });
        setUserProfile(normalized);
        writeCachedProfile(touchId, normalized);
        void syncLeaderboard(true);
      })
      .catch((err) => {
        dbgError('[FCDBG][App] upload player avatar failed', err);
        showNotification('Upload failed', err instanceof Error ? err.message : 'Could not upload avatar', '⚠️');
      });
  }

  function disconnectShopifyAccount() {
    clearCachedShopifyStatus(touchId);
    clearCachedRewardPlan(touchId);
    setShopifyAccountOpen(false);
    window.location.href = buildShopifyUnlinkUrl(touchId);
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
    const resume = pending?.resume ?? null;

    setShopifyAuthSkipCount((c) => c + 1);
    setShopifyAuthLastSkippedAt(new Date().toISOString());
    setShopifyAuthOverlay(null);
    shopifyPendingRef.current = null;

    if (source === 'get_more_off') {
      setGetMoreOffAuthPromptSeen(true);
    }

    // 首页 Shopify 任务卡：Skip 后留在首页；其余场景继续被拦截的原操作。
    if (source === 'task_card') return;

    scheduleShopifyResume(resume);
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
        clearCachedRewardPlan(touchId);
        void reloadPlan({ refresh: true });
        scheduleShopifyResume(pending?.resume);
      }
    });
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

    const prevCoins = points;
    const newCoins = points + pts;
    setLastGainAmount(pts);
    setCoinGainSignal((s) => s + 1);

    flyCoins(timing.count, () => {
      creditPoints(pts, timing.creditDuration);
    }, null, { staggerMs: timing.staggerMs, coinDuration: timing.coinDuration });
  }

  // 🅓 Roll the points counter up to the new total (instead of a hard jump),
  // highlighting the counter while it credits; celebrate once at the end.
  function creditPoints(pts, duration = 600, absoluteTarget, onComplete) {
    if (!pts && absoluteTarget == null) {
      onComplete?.();
      return;
    }
    setForceWalletView(false);
    if (pointsTweenRef.current) {
      cancelAnimationFrame(pointsTweenRef.current);
      pointsTweenRef.current = null;
    }

    const from = points;
    const to = absoluteTarget ?? from + pts;

    if (prefersReducedMotion()) {
      setPoints(to);
      if (next && to >= targetPoints && !packTargetMode) triggerCelebration(to);
      onComplete?.();
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
        if (next && to >= targetPoints && !packTargetMode) triggerCelebration(to);
        onComplete?.();
      }
    };
    pointsTweenRef.current = requestAnimationFrame(step);
  }

  function triggerCelebration(updatedPoints) {
    const unlocked = resolveUnlockedCoupon(discounts, currentStepIndex);
    if (rewardPlanId && unlocked?.tier != null) {
      sessionStorage.setItem(tierReceiptSessionKey(touchId, rewardPlanId, unlocked.tier), '1');
    }
    setUnlockToastSignal((s) => s + 1);
    setTargetPulse('ready unlocking');
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
    if (isExpired || redeemingCoupon) return;

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

  function handleShopNowDirect() {
    const shopUrl = (brand.shopUrl && brand.shopUrl !== '#') ? brand.shopUrl : 'https://ritual.com';
    openExternalLink(shopUrl);
  }

  async function handleWalletCopy(code) {
    if (!code) return;
    try {
      await copyText(code);
    } catch {
      // 复制失败时静默,用户仍可手动选择券码。
    }
    setWalletCopiedCode(code);
    setTimeout(() => setWalletCopiedCode((prev) => (prev === code ? null : prev)), 2000);
  }

  function claimMockPack(pack, { reveal = true } = {}) {
    if (!pack?.coupons?.length) return [];
    const expiresAt = countdownSeconds > 0
      ? new Date(Date.now() + countdownSeconds * 1000).toISOString()
      : undefined;
    const entries = mockPackWalletEntries(pack, expiresAt);
    setCouponWallet(upsertCouponsToWallet(touchId, entries));
    if (reveal) {
      const revealCoupons = selectPackRevealCoupons(pack, entries, { requireCode: true });
      if (revealCoupons.length) setGiftReveal({ pack, coupons: revealCoupons });
    }
    return entries;
  }

  async function autoClaimInitialPack() {
    const packToClaim = singleCouponOnlyMode ? soleRewardPack : currentPack;
    if (!packToClaim?.coupons?.length) return;
    const cycleId = activePlan?.cycleId ?? rewardPlanId;
    const initialCouponId = packToClaim.coupons[0]?.couponId;
    if (initialCouponId && walletHasCouponForCycle(couponWallet, cycleId, initialCouponId)) {
      writeWelcomeCompleted(touchId);
      return;
    }
    if (walletHasPack(couponWallet, packToClaim.id)) return;
    if (!devScene && activePlan?.initialReward?.couponCode) {
      const merged = mergeIssuedCoupon(
        packToClaim.coupons[0] ?? null,
        activePlan.initialReward,
        packToClaim?.expiresAt,
      );
      if (merged?.code) {
        upsertIssuedPackCoupons(packToClaim, [merged]);
        writeWelcomeCompleted(touchId);
        return;
      }
    }
    if (!devScene && isInitialPackIssued(activePlan, derivedPacks.startPack)) {
      const coded = packToClaim.coupons.filter((coupon) => coupon?.code);
      if (coded.length) upsertIssuedPackCoupons(packToClaim, coded);
      writeWelcomeCompleted(touchId);
      return;
    }
    if (devScene && devScene !== 'welcome') {
      claimMockPack(packToClaim, { reveal: false });
      return;
    }
    if (devScene === 'welcome') {
      claimMockPack(packToClaim, { reveal: false });
      return;
    }

    const issuedCoupons = packToClaim.coupons.filter((coupon) => coupon?.code);
    if (issuedCoupons.length) {
      upsertIssuedPackCoupons(packToClaim, issuedCoupons);
      writeWelcomeCompleted(touchId);
      return;
    }
    if (!rewardPlanId || redeemingCoupon) return;
    if (planLoading && !activePlan?.initialReward?.couponCode) return;

    setRedeemingCoupon(true);
    try {
      const issued = await claimInitialReward(touchId, rewardPlanId);
      const merged = mergeIssuedCoupon(
        packToClaim.coupons[0] ?? null,
        issued?.coupon,
        packToClaim?.expiresAt,
      );
      if (!merged?.code) throw new Error('No coupon code returned');
      upsertIssuedPackCoupons(packToClaim, [merged]);
      writeWelcomeCompleted(touchId);
      clearCachedRewardPlan(touchId);
      void reloadPlan({ background: true, refresh: true }).catch((err) => {
        dbgError('[FCDBG][App] reload after initial reward claim failed', err);
      });
    } catch (err) {
      showNotification('Coupon unavailable', formatFcError(err, 'Could not issue coupon'), '⚠️');
      autoClaimInitialRef.current = null;
    } finally {
      setRedeemingCoupon(false);
    }
  }

  async function handleContinueWelcomePack() {
    const packToClaim = soleRewardPack ?? currentPack;
    if (!packToClaim?.coupons?.length) {
      handleWelcomeRitualComplete();
      return;
    }
    if (redeemingCoupon) return;
    if (walletHasPack(couponWallet, packToClaim.id)) {
      handleWelcomeRitualComplete();
      return;
    }
    if (devScene) {
      claimMockPack(packToClaim, { reveal: false });
      handleWelcomeRitualComplete();
      return;
    }

    const issuedCoupons = packToClaim.coupons.filter((coupon) => coupon?.code);
    if (issuedCoupons.length) {
      upsertIssuedPackCoupons(packToClaim, issuedCoupons);
      handleWelcomeRitualComplete();
      return;
    }
    if (!rewardPlanId) {
      showNotification('Rewards not ready', 'Please wait a moment and try again.', '⚠️');
      return;
    }

    setRedeemingCoupon(true);
    try {
      let merged = null;
      if (packToClaim.type === 'target') {
        const issued = await claimTargetRewardPack(touchId, rewardPlanId);
        merged = mergeIssuedCoupon(
          packToClaim.coupons[0] ?? null,
          issued?.pack?.coupons?.[0],
          packToClaim?.expiresAt,
        );
      } else {
        const issued = await claimInitialReward(touchId, rewardPlanId);
        merged = mergeIssuedCoupon(packToClaim.coupons[0] ?? null, issued?.coupon, packToClaim?.expiresAt);
      }
      if (!merged?.code) throw new Error('No coupon code returned');
      upsertIssuedPackCoupons(packToClaim, [merged]);
      clearCachedRewardPlan(touchId);
      handleWelcomeRitualComplete();
      void reloadPlan({ background: true, refresh: true }).catch((err) => {
        dbgError('[FCDBG][App] reload after sole reward claim failed', err);
      });
    } catch (err) {
      showNotification('Coupon unavailable', formatFcError(err, 'Could not issue coupon'), '⚠️');
    } finally {
      setRedeemingCoupon(false);
    }
  }

  // 领取 target 礼包:签发券码 → 把礼包内的券写进券包 → 弹"获得 N 张券"小结算。
  // 注:当前后端为单券签发,整包发码需后端支持;此处已按"整包写入"组织,后端就绪后自动生效。
  async function issueTargetPack({ optimisticReveal = true } = {}) {
    if (redeemingCoupon) return false;
    if (devScene && targetPack) {
      claimMockPack(targetPack);
      return true;
    }
    if (!targetPack?.coupons?.length) return false;
    if (targetClaimed) return true;
    const alreadyIssued = targetPack.coupons.filter((coupon) => coupon?.code);
    if (alreadyIssued.length === targetPack.coupons.length) {
      const entries = upsertIssuedPackCoupons(targetPack, alreadyIssued, { reveal: false });
      const revealCoupons = selectPackRevealCoupons(targetPack, entries, { requireCode: true });
      if (optimisticReveal && revealCoupons.length) {
        setGiftReveal({ pack: targetPack, coupons: revealCoupons });
      }
      return true;
    }
    if (!rewardPlanId) {
      if (!optimisticReveal) {
        showNotification('Rewards not ready', 'Please wait a moment and try again.', '⚠️');
      }
      return false;
    }

    if (optimisticReveal) {
      // 仅展示礼包内已出码券，避免无 code 占位券与后续回填重复出现。
      const codedPreview = selectPackRevealCoupons(targetPack, targetPack.coupons, { requireCode: true });
      if (codedPreview.length) {
        setGiftReveal({ pack: targetPack, coupons: codedPreview });
      }
    }

    setRedeemingCoupon(true);
    try {
      const issued = await claimTargetRewardPack(touchId, rewardPlanId);
      const issuedById = new Map(
        (issued?.pack?.coupons ?? [])
          .filter((coupon) => coupon?.couponId)
          .map((coupon) => [String(coupon.couponId), coupon]),
      );
      const mergedCoupons = targetPack.coupons.map((coupon) =>
        mergeIssuedCoupon(
          coupon,
          issuedById.get(String(coupon.couponId ?? coupon.campaignId)),
          targetPack?.expiresAt,
        ))
        .filter(Boolean);
      if (!mergedCoupons.length || !mergedCoupons.every((coupon) => coupon?.code)) {
        throw new Error('Target reward pack response was incomplete');
      }
      const entries = upsertIssuedPackCoupons(targetPack, mergedCoupons, { reveal: false });
      const revealCoupons = selectPackRevealCoupons(targetPack, entries, { requireCode: true });
      if (revealCoupons.length) {
        setGiftReveal({ pack: targetPack, coupons: revealCoupons });
      }
      clearCachedRewardPlan(touchId);
      void reloadPlan({ background: true, refresh: true }).catch((err) => {
        dbgError('[FCDBG][App] reload after target reward claim failed', err);
      });
      return true;
    } catch (err) {
      showNotification('Coupon unavailable', formatFcError(err, 'Could not issue target reward pack'), '⚠️');
      return false;
    } finally {
      setRedeemingCoupon(false);
      pendingPackUnlockAfterSettlementRef.current = false;
    }
  }

  function beginTargetPackUnlock() {
    if (!targetPack?.id || singleCouponOnlyMode || targetClaimed) return;
    if (autoIssuedPackRef.current === targetPack.id) return;
    autoIssuedPackRef.current = targetPack.id;
    void issueTargetPack().then((issued) => {
      if (!issued) autoIssuedPackRef.current = null;
    });
  }

  useEffect(() => {
    if (devScene === 'home') return;
    // Block only during gift intro; allow claim while renew welcome ritual is showing.
    if (renewGiftIntro) return;
    if (renewFlowActive && welcomeStep < 1) return;
    const pack = singleCouponOnlyMode ? soleRewardPack : currentPack;
    const serverIssued = !devScene && isInitialPackIssued(activePlan, derivedPacks.startPack);
    if (!pack?.id || walletHasPack(couponWallet, pack.id) || serverIssued) {
      autoClaimInitialRef.current = null;
      return;
    }
    if (planLoading && !activePlan?.initialReward?.couponCode && !rewardPlanFetched) return;
    if (autoClaimInitialRef.current === pack.id) return;
    autoClaimInitialRef.current = pack.id;
    void autoClaimInitialPack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activePlan,
    derivedPacks.startPack,
    renewGiftIntro,
    renewFlowActive,
    welcomeStep,
    singleCouponOnlyMode,
    soleRewardPack,
    currentPack,
    couponWallet,
    devScene,
    planLoading,
    rewardPlanId,
    rewardPlanFetched,
  ]);

  useEffect(() => {
    if (devScene === 'completed' || devScene === 'home' || singleCouponOnlyMode) return;
    if (renewFlowActive || renewGiftIntro) return;
    if (pendingPackUnlockAfterSettlementRef.current) return;
    if (!currentPackClaimed || !targetUnlocked || targetClaimed || !targetPack?.id) return;
    if (!devScene && isTargetPackIssued(activePlan, derivedPacks.targetPack)) return;
    if (autoIssuedPackRef.current === targetPack.id) return;
    autoIssuedPackRef.current = targetPack.id;
    void issueTargetPack().then((issued) => {
      if (!issued) autoIssuedPackRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPackClaimed, targetUnlocked, targetClaimed, targetPack?.id, devScene, singleCouponOnlyMode, renewFlowActive, renewGiftIntro]);

  function dismissTargetGiftReveal({ openWallet = false } = {}) {
    const coded = (giftReveal?.coupons ?? []).filter((coupon) => coupon?.code);
    if (rewardPlanId) setTargetUnlockAckCycleId(rewardPlanId);
    setGiftReveal(null);
    if (coded.length) setWalletRevealCoupons(coded);
    if (openWallet) {
      setWalletNavDirection('forward');
      setWalletOpen(true);
    }
  }

  async function handleSettlementComplete(settlement) {
    dbg('[FCDBG][App] settlement received', settlement);
    clearGameSessionCache();
    setActiveModal(null);
    setGameStart(null);
    if (Number.isFinite(Number(settlement?.currentTier))) {
      setPlanCurrentTier(Math.max(0, Number(settlement.currentTier)));
    }
    const pts = settlement.pointsAwarded ?? 0;
    const balanceAfter = Number.isFinite(Number(settlement?.pointsBalance))
      ? Math.max(0, Math.round(Number(settlement.pointsBalance)))
      : points + pts;

    if (balanceAfter > 0) {
      patchCachedRewardPlanPoints(touchId, balanceAfter);
    }
    lastSettlementBalanceRef.current = balanceAfter;
    // 游戏结算后 plan 刷新不再重复播放入场 +5
    entryTapFxPlayedRef.current = true;
    entryTapFxRequestedRef.current = false;
    pendingTapRewardRef.current = 0;

    const refreshPlan = () => {
      reloadPlan({ refresh: true, background: true, skipTapReward: true }).catch((err) => {
        dbgError('[FCDBG][App] background reloadPlan failed', err);
        setPlanError(err instanceof Error ? err.message : 'Could not refresh rewards');
      });
    };

    const willUnlockTarget = packTargetMode
      && targetThreshold > 0
      && balanceAfter >= targetThreshold
      && !targetClaimed
      && currentPackClaimed;
    if (willUnlockTarget) {
      pendingPackUnlockAfterSettlementRef.current = true;
    }
    const openTargetUnlockAfterProgress = willUnlockTarget
      ? () => beginTargetPackUnlock()
      : undefined;

    if (settlement.couponWon && !targetPack) {
      const unlocked = resolveUnlockedCoupon(discounts, currentStepIndex);
      const showUnlockedReceipt = () => {
        setReceiptCoupon(unlocked);
        setReceiptColors(readCouponTokens(targetCouponRef.current));
        setPendingPoints(balanceAfter);
        setShowReceipt(true);
        refreshPlan();
      };

      if (pts > 0) {
        triggerLoginBonusAnimation(pts, balanceAfter);
        window.setTimeout(() => {
          refreshPlan();
          void syncLeaderboard(true);
        }, 1900);
      } else {
        showUnlockedReceipt();
        void syncLeaderboard(true);
      }
      return;
    }

    if (pts > 0) {
      triggerLoginBonusAnimation(pts, balanceAfter, openTargetUnlockAfterProgress);
      window.setTimeout(() => {
        refreshPlan();
        void syncLeaderboard(true);
      }, 1900);
      return;
    }

    if (willUnlockTarget) {
      beginTargetPackUnlock();
    }

    refreshPlan();
    void syncLeaderboard(true);
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
    const liveTokens = faceEl ? readCouponTokens(faceEl.closest('.coupon')) : null;
    // faceEl 不在当前视图时(best offer / 已锁定流程)按券面档位回退,保证刮刮卡背景与券面一致。
    setZoomColors(liveTokens ?? readCouponTokensForTier(couponPaletteTier(coupon)));
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

  function handleZoomClose() {
    const afterClose = zoomAfterCloseRef.current;

    setZoomActive(false);
    zoomCenteredOpenRef.current = false;
    zoomAfterCloseRef.current = null;
    afterClose?.();
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

  async function openChallenge(challenge) {
    dbg('[FCDBG][App] openChallenge', challenge);
    if (challenge.type === 'shopify_connect') {
      showShopifyAuth('task_card');
      return;
    }

    if (challenge.type === 'survey' || challenge.id?.startsWith('survey')) {
      setActiveSurveyTask(challenge);
      setSurveyStep(0);
      setSurveyAnswers([]);
      setSurveyQuestions([]);
      setSurveyLoading(true);
      setActiveModal('survey');
      fetchSurveyQuestions(touchId)
        .then((payload) => {
          const questions = payload?.questions ?? [];
          setSurveyQuestions(questions);
          if (!questions.length) {
            setActiveModal(null);
            showNotification('Survey unavailable', 'No questions are available right now.', '⚠️');
          }
        })
        .catch((err) => {
          setActiveModal(null);
          showNotification('Survey unavailable', err instanceof Error ? err.message : 'Could not load survey', '⚠️');
        })
        .finally(() => setSurveyLoading(false));
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

    const key = `${rewardPlanId}:${challenge.gameInstanceId}`;
    const cachedStart = preloadedGameStartsRef.current.get(key);
    if (cachedStart) {
      dbg('[FCDBG][App] using preloaded game start', {
        key,
        sessionId: cachedStart.sessionId,
        templateKey: cachedStart.templateKey,
      });
      setGameStart(withShellBrand(cachedStart));
      setGameLoadingMessage('');
      preloadRuntimeManifest(touchId).catch((err) => {
        dbgError('[FCDBG][App] manifest preload on cached start failed', err);
      });
      return;
    }

    setGameStart(null);
    setGameLoadingMessage('Loading game…');

    try {
      const inflightStart = preloadingGameStartsRef.current.get(key) ?? preloadGameStart(challenge);
      const [start] = await Promise.all([
        inflightStart,
        preloadRuntimeManifest(touchId),
      ]);
      if (activeGameRequestRef.current === requestToken) {
        dbg('[FCDBG][App] game start ready for modal', {
          key,
          sessionId: start.sessionId,
          templateKey: start.templateKey,
          runtimeComponent: start.runtimeComponent,
        });
        setGameStart(withShellBrand(start));
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

  async function handleSurveyOption(option, meta = {}) {
    const question = surveyQuestions[surveyStep];
    if (!question) return;

    const startedAt = meta.startedAt ?? Date.now();
    const responseTimeMs = Math.max(0, Date.now() - startedAt);
    const isSkip = meta.action === 'skipped';
    const answerRecord = {
      questionId: question.id,
      value: isSkip ? '' : (option?.value ?? option?.label ?? String(option)),
      action: isSkip ? 'skipped' : 'answered',
      optionId: isSkip ? undefined : option?.id,
      otherText: meta.otherText,
    };
    const nextAnswers = [...surveyAnswers, answerRecord];
    setSurveyAnswers(nextAnswers);

    const externalAnswer = {
      survey_campaign_id: activeSurveyTask?.campaignId,
      survey_question_id: question.id,
      action: isSkip ? 'skipped' : 'answered',
      ...(isSkip ? {} : { survey_option_id: option?.id }),
      ...(meta.otherText ? { other_text: meta.otherText } : {}),
      response_time_ms: responseTimeMs,
    };

    if (surveyStep < surveyQuestions.length - 1) {
      try {
        await submitSurveyAnswers(touchId, { answer: externalAnswer });
      } catch (err) {
        dbgError('[FCDBG][App] survey answer submit failed', err);
      }
      setSurveyStep((step) => step + 1);
      return;
    }

    const surveyReward = activeSurveyTask?.pointsOffered ?? 0;
    const balanceBefore = pointsRef.current;

    setActiveModal(null);
    setSurveyStep(0);
    setSurveyAnswers([]);
    setSurveyQuestions([]);
    setActiveSurveyTask(null);

    if (surveyReward > 0) {
      window.setTimeout(() => {
        triggerLoginBonusAnimation(surveyReward, balanceBefore + surveyReward);
      }, 260);
    }

    try {
      await submitSurveyAnswers(touchId, { answer: externalAnswer });
    } catch (err) {
      dbgError('[FCDBG][App] final survey answer submit failed', err);
    }

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

  const handleRenewIssueAutoAdvance = useCallback(() => {
    setRenewIssueAutoAdvance(false);
    setWelcomeStep(2);
  }, []);

  const handleWelcomeRitualComplete = useCallback(() => {
    const cycleId = activePlan?.cycleId ?? rewardPlanId;
    setWelcomeStep(3);
    writeWelcomeCompleted(touchId, true, cycleId);
    setRenewIssueAutoAdvance(false);
    setWelcomeCoupon(null);
    setPlanLoading(false);
    setIntroActive(false);
    setReturnIntroGate(false);
    if (renewFlowActiveRef.current) {
      renewFlowActiveRef.current = false;
      setRenewFlowActive(false);
      setRenewPlanReady(false);
      setRenewGiftIntro(false);
      renewPlanRef.current = null;
      newChallengeRenewRef.current = null;
      returnIntroShownRef.current = true;
      returnIntroPendingRef.current = false;
      if (pendingTapRewardRef.current > 0) {
        window.setTimeout(() => playPendingTapRewardRef.current(), 280);
      }
      return;
    }
    if (singleCouponOnlyMode || !devScene) {
      return;
    }
    if (pendingTapRewardRef.current > 0) {
      playPendingTapReward();
    } else {
      tweenPointsTo(welcomeTargetPoints);
    }
  }, [activePlan?.cycleId, playPendingTapReward, rewardPlanId, singleCouponOnlyMode, touchId, tweenPointsTo, welcomeTargetPoints, devScene]);

  const isReturnIntro = introActive && welcomeStep >= 3 && !renewGiftIntro && !renewFlowActive;
  const showBrandIntro =
    (introActive || renewGiftIntro) &&
    (renewGiftIntro || (!renewFlowActive && hasInitialDiscount) || isReturnIntro);
  const brandIntroIsWelcome = renewGiftIntro || welcomeStep < 3;
  const showHome = !devScene || devScene === 'home' || devScene === 'completed';

  if (!touchIdValid) {
    return (
      <div className="mobile-viewport" data-screen-label="Invalid magnet link">
        <div className="loading-screen touch-id-error-screen" role="alert">
          <strong>Unable to open rewards</strong>
          <p className="loading-hint">{touchIdError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mobile-viewport"
      data-screen-label="优惠券首页"
      ref={viewportRef}
      style={{
        ...((brand.buttonColor || brand.primaryColor)
          ? { '--brand-primary': brand.buttonColor || brand.primaryColor }
          : {}),
        ...(brand.backgroundColor ? { '--bg-color': brand.backgroundColor } : {}),
        ...(brand.logoUrl ? { '--brand-logo-url': `url("${brand.logoUrl}")` } : {}),
      }}
    >
      <canvas id="confetti-canvas" ref={canvasRef} />
      <div
        className={[
          'gift-video-container',
          isWelcomeVideoActive ? 'is-active' : '',
          welcomeVideoFading ? 'is-fading' : '',
          welcomeVideoHasFrame ? 'has-frame' : '',
        ].filter(Boolean).join(' ')}
        style={{
          ...(giftVideoLockedHeight ? { '--gift-video-lock-height': giftVideoLockedHeight } : {}),
          cursor: isWelcomeVideoActive && canSkipGiftVideo ? 'pointer' : 'default',
        }}
        aria-hidden={!isWelcomeVideoActive}
        onClick={isWelcomeVideoActive ? handleGiftVideoClick : undefined}
      >
        <video
          ref={welcomeVideoRef}
          src={GIFT_OPENING_VIDEO_SRC}
          poster={GIFT_OPENING_VIDEO_POSTER}
          playsInline
          webkit-playsinline="true"
          muted
          preload="auto"
          onEnded={() => handleWelcomeVideoEnd(false)}
          onError={() => handleWelcomeVideoEnd(false)}
        />
      </div>
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

      {giftWaitingPlan && (
        <div className="gift-plan-loading" role="status">
          Refreshing rewards…
        </div>
      )}

      {(showRenewWelcomeLoading || (planLoading && !introActive && !returnIntroGate && !showWelcomeRitual && !giftWaitingPlan)) && (
        <div className="reward-sync-status" role="status">
          Refreshing rewards…
        </div>
      )}
      {inlineError && (
        <div className="inline-error-notice" role="status" aria-live="polite">
          <div className="inline-error-notice__text">
            <strong>{inlineError.title}</strong>
            <span>{inlineError.message}</span>
          </div>
          <button type="button" className="inline-error-notice__dismiss" onClick={clearInlineError}>
            Dismiss
          </button>
        </div>
      )}

      {showHome && (
      <>
      <Header
        brand={brand}
        profile={displayProfile}
        shopifyStatus={shopifyAuthStatus}
        onOpenShopifyAccount={openShopifyAccountEntry}
        onOpenWallet={() => {
          setWalletNavDirection('forward');
          setWalletOpen(true);
        }}
        onBackFromWallet={() => {
          setWalletNavDirection('back');
          setWalletOpen(false);
        }}
        walletOpen={walletOpen}
        rewardsCompleted={completedMode}
        walletCount={walletBadgeCount}
        onLogoSecretTap={logoSecretEnabled ? handleLogoSecretTap : undefined}
      />

      {showRewardsPage ? (
        <CouponWalletPage
          key={walletOpen ? 'wallet-archive' : completedMode ? 'completed-rewards' : 'wallet-active'}
          coupons={walletOpen ? walletArchiveCoupons : completedAvailableCoupons}
          copiedCode={walletCopiedCode}
          onCopy={handleWalletCopy}
          onClaim={handleShopNowDirect}
          completed={completedMode && !walletOpen}
          navDirection={walletNavDirection}
          time={time}
          isExpired={isExpired}
          urgent={urgent}
          isSample={isSampleMagnet}
          onReset={handleSampleReset}
        />
      ) : (
        <>
          <main className="content-area">
            <div className="reward-journey-shell">
              <img
                className="reward-journey-gift"
                src="/rewards/target-gift.png"
                alt=""
                aria-hidden="true"
              />
              <div className={`reward-journey ${urgent ? 'is-urgent' : ''}`}>
              <TargetProgress
                points={points}
                threshold={targetThreshold}
                progressPct={targetProgressPct}
                delta={targetDelta}
                couponCount={targetCouponCount}
                coupons={targetCoupons}
                unlocked={targetUnlocked}
                claimed={targetClaimed}
                time={time}
                tick={tick}
                urgent={urgent}
                isExpired={isExpired}
                coinGainSignal={coinGainSignal}
                lastGainAmount={lastGainAmount}
                onOpenWallet={() => setWalletOpen(true)}
              />

              <Challenges
                challenges={challenges}
                dailyCapReached={dailyCapReached}
                pointsNeeded={targetUnlocked ? 0 : targetDelta}
                upgradeMaxPoints={targetUnlocked ? 0 : (targetThreshold ?? 0)}
                onOpen={openChallenge}
                onOpenLeaderboard={() => { void syncLeaderboard(true); setLeaderboardOpen(true); }}
              />
            </div>
            </div>
            <RulesFooter rulesOpen={rulesOpen} onToggle={() => setRulesOpen((value) => !value)} />
          </main>
          <LeaderboardSheet
            open={leaderboardOpen}
            leaderboard={leaderboardData}
            profile={displayProfile}
            onClose={() => setLeaderboardOpen(false)}
          />
        </>
      )}
      </>
      )}

      <PlatformGameModal
        open={activeModal === 'platform-game'}
        title={gameModalTitle}
        gameStart={gameStart}
        brand={brand}
        progressView={gameProgressView}
        loadingMessage={gameLoadingMessage}
        leaderboard={leaderboardData}
        onClose={() => {
          activeGameRequestRef.current += 1;
          clearGameSessionCache();
          setActiveModal(null);
          setGameStart(null);
        }}
        onDone={handleSettlementComplete}
        onError={(message) => showNotification('Game error', message, '⚠️')}
        onRuntimeEvent={handleGameRuntimeEvent}
      />

      <SurveyModal
        open={activeModal === 'survey'}
        step={surveyStep}
        questions={surveyQuestions}
        loading={surveyLoading}
        reward={activeSurveyTask?.pointsOffered}
        onClose={() => {
          setActiveModal(null);
          setSurveyQuestions([]);
          setActiveSurveyTask(null);
        }}
        onOption={handleSurveyOption}
      />

      <NotificationModal notification={notification} onConfirm={confirmNotification} />

      {newChallenge && (
        <NewChallengeUnlocked
          reason={newChallenge.reason}
          coupon={settlementDisplayCoupon}
          coupons={settlementDisplayCoupons}
          isSample={isSampleMagnet}
          onStart={handleStartNewChallenge}
          onReset={handleSampleReset}
          onDismiss={() => setNewChallenge(null)}
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
        <ProfilePage
          brand={brand}
          profile={displayProfile}
          binding={shopifyBinding}
          shopifyStatus={shopifyAuthStatus}
          onSave={saveUserProfile}
          onUploadAvatar={uploadUserAvatar}
          onClose={() => setShopifyAccountOpen(false)}
          onConnect={() => showShopifyAuth('profile')}
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

      {shouldShowDevToolbar() && (
        <DevToolbar
          activeScene={devScene}
          activeShortcut={walletOpen ? 'wallet' : ''}
          onSelectScene={(sceneId) => {
            setGiftReveal(null);
            setWalletOpen(false);
            setTargetUnlockAckCycleId(null);
            setWalletRevealCoupons([]);
            navigateToDevScene(sceneId);
            setDevScene(sceneId);
          }}
          onOpenWalletPreview={() => {
            navigateToDevScene('home');
            setDevScene('home');
            setGiftReveal(null);
            setTargetUnlockAckCycleId(null);
            setWalletRevealCoupons([]);
            setWalletOpen(true);
          }}
          onResetFirstLogin={() => {
            setGiftReveal(null);
            setWalletOpen(false);
            setTargetUnlockAckCycleId(null);
            setWalletRevealCoupons([]);
            clearCouponWallet(touchId);
            setCouponWallet([]);
            if (devScene) {
              navigateToDevScene('intro');
              setDevScene('intro');
            } else {
              resetToFirstLogin();
            }
          }}
        />
      )}

      {giftReveal && (
        <GiftRevealModal
          pack={giftReveal.pack}
          coupons={giftReveal.coupons}
          brand={brand}
          copiedCode={walletCopiedCode}
          onCopy={handleWalletCopy}
          onShop={handleShopNowDirect}
          onOpenWallet={() => dismissTargetGiftReveal({ openWallet: true })}
          onClose={() => dismissTargetGiftReveal()}
        />
      )}

      {showWelcomeRitual && (
        <WelcomeRitual
          pack={soleRewardPack ?? currentPack}
          coupons={welcomeCoupons}
          brand={brand}
          claimed={singleCouponOnlyMode ? solePackClaimed : currentPackClaimed}
          copiedCode={walletCopiedCode}
          onCopy={handleWalletCopy}
          onContinue={() => {
            if (devScene) {
              void handleContinueWelcomePack();
              return;
            }
            const welcomeClaimed = singleCouponOnlyMode ? solePackClaimed : currentPackClaimed;
            // Server-preissued / renew paths may show codes before wallet packId sync.
            // Still allow continue when codes are visible on the ritual.
            const hasVisibleCodes = welcomeCoupons.some((coupon) => coupon?.code || coupon?.mockCode);
            if (!welcomeClaimed && !hasVisibleCodes) return;
            setWalletOpen(false);
            handleWelcomeRitualComplete();
          }}
          onShop={handleShopNowDirect}
          singleCoupon={singleCouponOnlyMode}
          issuing={redeemingCoupon}
          autoIssue={!devScene}
        />
      )}
    </div>
  );
}

function BrandMark({ className = 'brand-logo' }) {
  return (
    <svg className={className} viewBox="0 0 40 40" role="img" aria-label="Aurelia Skin logo">
      <defs>
        <linearGradient id="aureliaMark" x1="7" y1="5" x2="33" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8f5962" />
          <stop offset="0.52" stopColor="#663740" />
          <stop offset="1" stopColor="#3f2027" />
        </linearGradient>
        <linearGradient id="aureliaLeaf" x1="13" y1="10" x2="29" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f4df9f" />
          <stop offset="1" stopColor="#c59b58" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#aureliaMark)" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="#f1e2b4" strokeOpacity="0.38" strokeWidth="1.2" />
      <path d="M15.3 12.4c8.1.2 13.2 5.4 13.4 13.5-8-.2-13.2-5.4-13.4-13.5Z" fill="url(#aureliaLeaf)" />
      <path d="M25.6 15.2c-3.6 2.6-6.1 6-7.6 10.3" fill="none" stroke="#fff4ce" strokeWidth="1.35" strokeLinecap="round" />
      <text x="20" y="25.2" textAnchor="middle" className="brand-logo-letter">A</text>
    </svg>
  );
}

function PackCouponSummary({ coupon, compact = false, showCondition = true, showCode = false, copied = false, onCopy }) {
  const mode = couponDisplayMode(coupon);
  const title = couponTicketHeadline(coupon);
  return (
    <div
      className={`pack-ticket is-type-${mode} ${compact ? 'is-compact' : ''} ${compact && !showCode ? 'is-unclaimed-preview' : ''}`}
      {...couponPaletteProps(coupon)}
    >
      <div className="pack-ticket-main">
        <div className="pack-coupon-copy">
          <span className={`pack-coupon-value is-${mode}`}>{title}</span>
          {showCondition && (
            <span className="pack-coupon-condition">{coupon.conditions || 'No minimum'}</span>
          )}
        </div>
        {showCode && coupon.code && (
          <div className="pack-coupon-code">
            <span>{coupon.code}</span>
            <button
              type="button"
              className={copied ? 'is-copied' : ''}
              onClick={() => onCopy?.(coupon.code)}
              aria-label={copied ? `${coupon.code} copied` : `Copy ${coupon.code}`}
              title={copied ? 'Copied' : 'Copy code'}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
      <div className="pack-ticket-stub" aria-hidden="true">
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9Z" />
            <path d="M15 7v10" strokeDasharray="2 2" />
          </svg>
        </span>
      </div>
    </div>
  );
}

function TargetBundleTicket({ coupons }) {
  const list = (coupons ?? []).filter(Boolean);
  if (!list.length) return null;
  const countLabel = `${list.length} coupon${list.length === 1 ? '' : 's'} in target gift`;
  return (
    <div
      className="target-coupon-scroll"
      tabIndex={0}
      role="region"
      aria-label={countLabel}
    >
      <div
        className="target-coupon-row"
        data-coupon-count={list.length <= 2 ? list.length : 3}
      >
        {list.map((coupon, index) => (
          <CouponTicket
            key={coupon.couponId ? `${coupon.couponId}-${index}` : `${coupon.value}-${index}`}
            coupon={coupon}
            className="is-target-preview"
            showDetails={false}
            showCode={false}
            showShop={false}
          />
        ))}
      </div>
    </div>
  );
}

function WelcomeRitual({
  pack,
  coupons,
  brand,
  claimed,
  copiedCode,
  onCopy,
  onContinue,
  onShop,
  singleCoupon = false,
  issuing = false,
  autoIssue = true,
}) {
  const list = coupons?.length ? coupons : (pack?.coupons ?? []);
  const brandName = brand?.name || 'FridgeChannel';
  const hasCodes = list.some((coupon) => coupon?.code || coupon?.mockCode);
  return (
    <div className="welcome-pack-overlay" role="dialog" aria-label="Welcome gift">
      <section className="welcome-pack-card">
        <div className="welcome-rewards-hero-shell">
          <div className="welcome-rewards-hero">
            <div className="welcome-pack-brand">
              {brand?.logoUrl ? <img src={brand.logoUrl} alt={`${brandName} logo`} /> : <BrandMark className="welcome-pack-logo" />}
              <span>{brandName}</span>
            </div>
            <img
              className="welcome-rewards-gift"
              src="/rewards/welcome-rewards-hero-final-small.png"
              alt=""
              aria-hidden="true"
            />
            <p className="welcome-pack-eyebrow">Rewards unlocked</p>
            <h1>{singleCoupon ? 'Your reward is ready!' : 'Your first reward is ready!'}</h1>
            <p className="welcome-pack-subtitle">
              {issuing && !hasCodes ? (
                <>Preparing your coupon code…</>
              ) : singleCoupon ? (
                <>Your exclusive offer is ready.<br />Copy the code below and start shopping.</>
              ) : (
                <>
                  Here’s your starter coupon.<br />
                  More coupons are on the way.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="welcome-pack-list">
          {list.map((coupon) => (
            <CouponTicket
              key={coupon.couponId ?? coupon.value}
              coupon={coupon}
              className="is-welcome-ticket"
              featured
              brand={brand}
              showDetails
              showCode={hasCodes || Boolean(coupon?.mockCode)}
              copied={copiedCode === coupon.code}
              onCopy={onCopy}
              showShop={hasCodes || Boolean(coupon?.mockCode)}
              onShop={onShop}
            />
          ))}
        </div>

        <div className="welcome-pack-actions">
          {!autoIssue && (
            <button className="welcome-pack-claim" type="button" onClick={onContinue}>
              {singleCoupon ? 'View my coupons' : 'Get More OFF'}
            </button>
          )}
          {autoIssue && (claimed || hasCodes) && (
            <button className="welcome-pack-claim" type="button" onClick={onContinue}>
              {singleCoupon ? 'View my coupons' : 'Get More OFF'}
            </button>
          )}
        </div>
        {(claimed || hasCodes) && <p className="welcome-pack-saved">Already saved in My coupons</p>}
      </section>
    </div>
  );
}

function BrandIntro() {
  return null;
}

function HeaderBase({
  brand,
  profile,
  shopifyStatus,
  onOpenShopifyAccount,
  onOpenWallet,
  onBackFromWallet,
  walletOpen = false,
  rewardsCompleted = false,
  walletCount = 0,
  onLogoSecretTap,
}) {
  const connected = shopifyStatus === 'connected';
  const brandName = brand?.name?.trim() || 'FridgeChannel';
  const brandInitial = brandName.charAt(0).toUpperCase();
  const userInitial = profileInitial(profile);

  if (walletOpen) {
    return (
      <header className="brand-header is-wallet-header">
        <button
          className="cwallet-back"
          type="button"
          onClick={onBackFromWallet}
          aria-label={rewardsCompleted ? 'Back to your rewards' : 'Back to rewards'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="cwallet-head-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9Z" />
            <path d="M15 7v10" strokeDasharray="2 2" />
          </svg>
          <div>
            <h1>My coupons</h1>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="brand-header">
      <div
        className={`brand-info${onLogoSecretTap ? ' brand-info--secret-tap' : ''}`}
        onClick={onLogoSecretTap}
      >
        {brand?.logoUrl ? (
          <img className="brand-logo-img" src={brand.logoUrl} alt={`${brandName} logo`} />
        ) : (
          <span className="brand-logo-fallback" aria-hidden="true">{brandInitial}</span>
        )}
        <span className="brand-name">{brandName}</span>
      </div>
      <div className="header-actions">
        <button
          className="wallet-entry-btn"
          type="button"
          aria-label={`My coupons${walletCount ? ` (${walletCount} available)` : ''}`}
          title="My coupons"
          onClick={onOpenWallet}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9Z" />
            <path d="M15 7v10" strokeDasharray="2 2" />
          </svg>
          {walletCount > 0 && <span className="wallet-entry-badge">{walletCount}</span>}
        </button>
        <button
          className={`account-entry-btn ${connected ? 'is-connected' : ''}`}
          type="button"
          aria-label="Open profile"
          title="Profile"
          onClick={onOpenShopifyAccount}
        >
          {profile?.avatarImageUrl ? (
            <img className="account-entry-avatar-img" src={profile.avatarImageUrl} alt="" aria-hidden="true" />
          ) : (
            <span className="account-entry-avatar" style={{ background: profile?.avatarColor || DEFAULT_PROFILE.avatarColor }}>
              {userInitial}
            </span>
          )}
          {connected && <span className="account-entry-dot" aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

function NewChallengeUnlocked({ reason, onStart, onReset, onDismiss, coupon, coupons, isSample = false }) {
  const redeemed = reason === 'redeemed';
  const expired = reason === 'expired';

  const settlementCoupons = Array.isArray(coupons)
    ? coupons.filter(Boolean)
    : coupon
    ? [coupon]
    : [];

  return (
    <div className="new-challenge-overlay nc-settlement is-expired" role="dialog" aria-label="Round complete" data-screen-label="回合已结束">
      <div className="nc-settlement-scroll">
        <div className="nc-settlement-hero">
          <div className="nc-hero-flag-small" aria-hidden="true">
            <div className="nc-flag-pole" />
            <div className="nc-flag-banner">
              <span>★</span>
            </div>
          </div>
        </div>

        <section className="nc-copy-block">
          <h1>Round Complete</h1>
          <p>
            {isSample
              ? 'This sample round has ended. Reset to start again from the first visit.'
              : 'This reward period has ended. Start the next one to unlock fresh offers.'}
          </p>
        </section>

        {settlementCoupons.length > 0 && (
          <div className="nc-settlement-coupons-list">
            {settlementCoupons.map((c) => (
              <SettlementTicket
                key={c.code || c.mockCode || c.couponId || c.value}
                coupon={c}
                status={redeemed ? 'used' : 'earned'}
              />
            ))}
          </div>
        )}

        <div className="nc-footer">
          {isSample ? (
            <button className="nc-btn-start" type="button" onClick={onReset}>
              <span>Reset</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9" />
                <path d="M3 4v5h5" />
              </svg>
            </button>
          ) : (
            <button className="nc-btn-start" type="button" onClick={onStart}>
              <span>Start Next Challenge</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m13 5 7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TargetProgress({
  points,
  threshold,
  progressPct,
  delta,
  couponCount,
  coupons,
  unlocked,
  claimed,
  time,
  tick,
  urgent,
  isExpired,
  coinGainSignal,
  lastGainAmount,
  onOpenWallet,
}) {
  const hasTarget = threshold != null;
  const couponLabel = `${couponCount} coupon${couponCount === 1 ? '' : 's'}`;

  return (
    <section className="wallet target-progress" data-screen-label="奖励进度">
      <div className="section-head">
        <div>
          <span className="section-tag">{unlocked ? 'Gift unlocked' : 'Target gift challenge'}</span>
          <div className={`tg-countdown ${urgent ? 'is-urgent' : ''}`}>
            <span className="tg-countdown-label">{isExpired ? 'Challenge ended' : 'Time left'}</span>
            {!isExpired && (
              <span className={`tg-countdown-value ${tick ? 'is-ticking' : ''}`}>
                {time.digits[0]}d&nbsp; {time.digits[1]}h&nbsp; {time.digits[2]}m&nbsp; {time.digits[3]}s
              </span>
            )}
          </div>
        </div>
      </div>

      {!hasTarget ? (
        <p className="tg-note">Your coupons are saved in your wallet — open them anytime.</p>
      ) : (
        <div className={`tg-card ${unlocked ? 'is-unlocked' : ''}`}>
          <div className="tg-gift-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" />
              <path d="M2 7h20v5H2z" />
              <path d="M12 22V7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
          </div>

          <p className="tg-card-title">
            {!unlocked
              ? 'Unlock more rewards'
              : `Unlocked · ${couponLabel} saved to My coupons`}
          </p>

          <div className="tg-coupon-list">
            <TargetBundleTicket coupons={coupons} />
          </div>

          <div className="tg-bar">
            <div className="tg-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="tg-bar-meta">
            <span className="tg-points">{points} / {threshold} pts</span>
            {!unlocked && <span className="tg-remain">Need {delta} more</span>}
          </div>

          {unlocked && claimed && (
            <button className="tg-claim-btn is-secondary" type="button" onClick={onOpenWallet}>Open my coupons</button>
          )}
        </div>
      )}
    </section>
  );
}

function rewardPercent(coupon) {
  const value = coupon?.num ?? coupon?.value;
  const parsed = parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function RatingIcons({ count, type }) {
  const safeCount = Math.max(1, Math.min(3, Number.parseInt(count, 10) || 1));
  return (
    <span className={`challenge-rating-icons is-${type}`} aria-hidden="true">
      {Array.from({ length: safeCount }).map((_, index) => (
        type === 'reward'
          ? <i className="coin-ic challenge-rating-coin" key={index} />
          : <i className="challenge-rating-bolt" key={index} />
      ))}
    </span>
  );
}

function ChallengeCardIcon({ challenge, isShopifyConnect }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (isShopifyConnect) {
    return (
      <img
        className="challenge-card-icon"
        src="/gift-opening/shopify-icon.png"
        alt=""
        aria-hidden="true"
      />
    );
  }

  if (challenge.iconUrl && !imgFailed) {
    return (
      <img
        className="challenge-card-icon"
        src={challenge.iconUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => setImgFailed(true)}
      />
    );
  }

  return challenge.icon;
}

function ChallengesBase({ challenges, dailyCapReached, pointsNeeded, upgradeMaxPoints, onOpen, onOpenLeaderboard }) {
  return (
    <section className="earn-progress-section" data-screen-label="挑战任务">
      <div className="section-head stacked">
        <div className="section-head-with-lb">
          <span className="section-tag">{pointsNeeded > 0 ? 'Choose a challenge' : 'Keep playing & earning'}</span>
          <button className="leaderboard-entry-btn" type="button" onClick={onOpenLeaderboard}>
            <span className="leaderboard-entry-icon" aria-hidden="true" />
            <span>Leaderboard</span>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4l6 6-6 6" />
            </svg>
          </button>
        </div>
        <span className="section-note">
          {pointsNeeded > 0
            ? `Every challenge moves you closer to your gift · ${pointsNeeded} pts left`
            : 'Updated daily · New challenges every day'}
        </span>
      </div>
      <div className="challenges-list">
        {challenges.length === 0 ? (
          <div className="challenges-empty" role="status">
            <span className="challenges-empty-icon" aria-hidden="true">🎮</span>
            <div>
              <strong>New challenges are on the way</strong>
              <p>Check back shortly for the next games and rewards.</p>
            </div>
          </div>
        ) : challenges.map((challenge) => {
          const pts = challenge.reward.replace(/[^0-9]/g, '');
          const ptsValue = Number.parseInt(pts, 10);
          const showRewardPill = Number.isFinite(ptsValue) && ptsValue > 0;
          const isShopifyConnect = challenge.type === 'shopify_connect';
          const isGame = challenge.type === 'game';
          const badgeLabel = isGame ? 'Game' : challenge.badge;
          const isDisabled = dailyCapReached && !isShopifyConnect;
          const gameRewardCap = Number.isFinite(Number(upgradeMaxPoints))
            ? Math.max(5, Math.round(Number(upgradeMaxPoints)))
            : 5;
          const gameRewardAmount = `5~${gameRewardCap}`;
          const rewardPillAmount = isShopifyConnect ? gameRewardCap : gameRewardAmount;
          const openCurrentChallenge = () => {
            if (isDisabled) return;
            onOpen(challenge);
          };
          return (
            <div
              className={`challenge-card ${isGame ? 'is-game-card' : ''} ${isShopifyConnect ? 'is-shopify-card' : ''} ${isDisabled ? 'is-disabled' : ''}`}
              key={challenge.id}
              style={isShopifyConnect ? { background: 'linear-gradient(135deg, #f6f9f4 0%, #eaf0e6 100%)', borderColor: 'rgba(94, 128, 62, 0.18)' } : undefined}
              onClick={openCurrentChallenge}
              role="button"
              tabIndex={isDisabled ? -1 : 0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openCurrentChallenge();
                }
              }}
            >
              <div className="challenge-icon-wrapper">
                <ChallengeCardIcon challenge={challenge} isShopifyConnect={isShopifyConnect} />
              </div>
              <div className="challenge-card-body">
                <span className="challenge-badge">{badgeLabel}</span>
                <h4 className="challenge-title">{challenge.title}</h4>
                {isGame ? (
                  <div className="challenge-game-meta">
                    <div className="challenge-rating-row" aria-label={`Difficulty ${challenge.difficultyLevel} of 3`}>
                      <span>Difficulty</span>
                      <RatingIcons count={challenge.difficultyLevel} type="difficulty" />
                    </div>
                  </div>
                ) : (
                  <p className="challenge-desc">{challenge.desc}</p>
                )}
              </div>
              <button
                className={
                  isGame
                    ? 'btn btn-play shopify-connect-btn game-reward-btn'
                    : (isShopifyConnect ? 'btn btn-play shopify-connect-btn' : 'btn btn-outline btn-play')
                }
                id={challenge.type === 'survey' ? 'take-survey-btn' : `play-${challenge.id}-btn`}
                disabled={isDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  openCurrentChallenge();
                }}
              >
                {isDisabled ? (
                  <span>Cap Reached</span>
                ) : isGame ? (
                  <span className="btn-play-reward game-reward-pill">
                    +{gameRewardAmount}<i className="coin-ic" aria-hidden="true" />
                  </span>
                ) : isShopifyConnect ? (
                  <>
                    <span className="btn-play-reward game-reward-pill">
                      +{rewardPillAmount}<i className="coin-ic" aria-hidden="true" />
                    </span>
                    <span className="btn-play-label">{challenge.cta}</span>
                  </>
                ) : (
                  <>
                    {showRewardPill && <span className="btn-play-reward">+{pts}<i className="coin-ic" aria-hidden="true" /></span>}
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
            <li>Reach the single target to unlock the complete coupon gift.</li>
            <li>When you reach the target, every coupon is automatically saved to My coupons.</li>
            <li>Your coupons stay organized in My coupons until used or expired.</li>
          </ol>
        </div>
      </div>
    </footer>
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

function SurveyModal({ open, step, questions, loading, reward, onClose, onOption }) {
  const currentQuestion = questions?.[step];
  const total = questions?.length ?? 0;
  const startedAtRef = useRef(Date.now());
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    if (open) startedAtRef.current = Date.now();
  }, [open, step]);

  // 关闭弹窗时重置二次确认状态
  useEffect(() => {
    if (!open) setConfirmExit(false);
  }, [open]);

  // 点击右上角叉:进行中且未完成时先弹二次确认,否则直接关闭
  const requestExit = () => {
    if (loading || !currentQuestion) {
      onClose();
    } else {
      setConfirmExit(true);
    }
  };

  const coinReward = reward ?? 30;

  return (
    <Modal id="survey-modal" open={open} title="Quick Preferences Survey" onClose={requestExit}>
      {loading ? (
        <p className="survey-loading">Loading questions…</p>
      ) : currentQuestion ? (
        <>
          <div className="survey-progress-header">
            <span className="survey-step-indicator">{step + 1}/{total}</span>
            <div className="survey-progress-bar">
              <div className="survey-progress-fill" style={{ width: `${((step + 1) / Math.max(total, 1)) * 100}%` }} />
            </div>
          </div>
          <div className="survey-questions">
            <div className="survey-question-step active">
              <h4>{currentQuestion.text}</h4>
              <div className="survey-options">
                {currentQuestion.options?.map((option) => (
                  <button
                    className="survey-option-btn"
                    key={option.id}
                    onClick={() => onOption(option, { startedAt: startedAtRef.current })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {confirmExit && (
            <div className="survey-exit-confirm">
              <div className="survey-exit-confirm-card">
                <h4 className="survey-exit-confirm-title">You're close to a bigger discount</h4>
                <p className="survey-exit-confirm-desc">
                  Complete this survey and earn <strong>+{coinReward} Coins</strong>.
                  <br />
                  Keep going to get closer to your next reward.
                </p>
                <div className="survey-exit-confirm-actions">
                  <button
                    className="survey-exit-confirm-keep"
                    onClick={() => setConfirmExit(false)}
                  >
                    Keep Going
                  </button>
                  <button
                    className="survey-exit-confirm-exit"
                    onClick={() => {
                      setConfirmExit(false);
                      onClose();
                    }}
                  >
                    Exit Anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="survey-loading">No questions available.</p>
      )}
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


function ProfilePage({ brand, profile, binding, shopifyStatus, onSave, onUploadAvatar, onClose, onConnect, onDisconnect }) {
  const [draft, setDraft] = useState(() => normalizeProfile({ ...profile, brandName: brand?.name }));
  const [clearAvatarImage, setClearAvatarImage] = useState(false);
  const avatarInputRef = useRef(null);
  const brandName = brand?.name || 'Your brand';
  const connected = binding?.connected || shopifyStatus === 'connected';
  const accountLabel = connected ? shopifyAccountLabel(binding?.connected ? binding : { connected: true }) : 'Not connected';
  const draftInitial = profileInitial(draft);

  useEffect(() => {
    setDraft(normalizeProfile({ ...profile, brandName: brand?.name }));
    setClearAvatarImage(false);
  }, [profile, brand?.name]);

  function handleSubmit(event) {
    event.preventDefault();
    onSave({ ...draft, clearAvatarImage });
    onClose();
  }

  return (
    <section className="shopify-account-page profile-page" aria-label="Profile settings">
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

      <form className="shopify-account-body profile-body" onSubmit={handleSubmit}>
        <div className="profile-hero">
          <button
            className="profile-avatar-preview"
            type="button"
            style={{ background: draft.avatarColor }}
            aria-label="Upload profile photo"
            onClick={() => avatarInputRef.current?.click()}
          >
            {draft.avatarImageUrl ? <img src={draft.avatarImageUrl} alt="" /> : draftInitial}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                onUploadAvatar?.(file);
                return;
              }
              const previewUrl = URL.createObjectURL(file);
              setClearAvatarImage(false);
              setDraft((value) => ({ ...value, avatarImageUrl: previewUrl }));
              onUploadAvatar?.(file);
            }}
          />
          <h1>Profile</h1>
        </div>

        <section className="profile-panel" aria-labelledby="leaderboard-identity-title">
          <div className="profile-panel-head">
            <span id="leaderboard-identity-title">Leaderboard identity</span>
          </div>

          <div className="profile-field">
            <span>Leaderboard ID</span>
            <input
              className="profile-leaderboard-id-input"
              value={draft.nickname}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="leaderboard-id-hint"
              onChange={(event) => {
                setDraft((value) => ({
                  ...value,
                  nickname: event.target.value.slice(0, 32),
                }));
              }}
            />
            <small className="profile-field-hint" id="leaderboard-id-hint">
              Shown on the leaderboard. Up to 32 characters.
            </small>
          </div>

          <div className="profile-field">
            <span>Avatar color</span>
            <div className="profile-avatar-options" role="radiogroup" aria-label="Avatar color">
              {PROFILE_AVATAR_OPTIONS.map((color) => (
                <button
                  className={`profile-avatar-option ${draft.avatarColor === color ? 'is-selected' : ''}`}
                  key={color}
                  type="button"
                  style={{ background: color }}
                  aria-label={`Use avatar color ${color}`}
                  aria-pressed={draft.avatarColor === color}
                  onClick={() => {
                    if (draft.avatarColor === color && draft.avatarImageUrl) return;
                    if (draft.avatarImageUrl) setClearAvatarImage(true);
                    setDraft((value) => ({ ...value, avatarColor: color, avatarImageUrl: '' }));
                  }}
                >
                  {draft.avatarColor === color && <span>{draftInitial}</span>}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={`profile-panel shopify-profile-panel ${connected ? 'is-connected' : 'is-unconnected'}`} aria-labelledby="shopify-profile-title">
          <div className="profile-panel-head">
            <span id="shopify-profile-title">Shopify account</span>
            <small>{connected ? 'Connected' : 'Not connected'}</small>
          </div>

          <div className="profile-shopify-row">
            <div className="profile-shopify-icon" aria-hidden="true">
              <img src="/gift-opening/shopify-icon.png" alt="" />
            </div>
            <div className="profile-shopify-copy">
              <strong>{connected ? accountLabel : 'Connect Shopify'}</strong>
              {connected ? (
                <>
                  {binding?.email && <p>{binding.email}</p>}
                </>
              ) : (
                null
              )}
            </div>
          </div>

          {connected ? (
            <button className="shopify-account-disconnect profile-secondary-action" type="button" onClick={onDisconnect}>
              Disconnect Shopify
            </button>
          ) : (
            <button
              className="profile-connect-shopify"
              type="button"
              onClick={onConnect}
            >
              <img src="/gift-opening/shopify-icon.png" alt="" aria-hidden="true" />
              Connect Shopify
            </button>
          )}
        </section>

        <button className="profile-save-btn" type="submit">
          Save changes
        </button>
      </form>
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
          <img className="shopify-auth-cta-icon" src="/gift-opening/shopify-icon.png" alt="" aria-hidden="true" />
          Connect your Shopify
        </button>

        <button className="shopify-auth-skip" type="button" onClick={onSkip}>
          Skip
        </button>
      </div>
    </section>
  );
}

function LeaderboardSheet({ open, leaderboard, profile, onClose }) {
  const displayProfile = normalizeProfile(profile);
  const view = normalizeLeaderboardView(leaderboard, displayProfile.nickname, leaderboard?.currentUserCoins ?? 0);
  const { topPlayers, aroundYou, currentUserRank } = view;
  const topPodium = topPlayers.length ? topPlayers : view.players.slice(0, 3);
  const aroundPlayers = aroundYou.length ? aroundYou : view.players.slice(
    Math.max(0, currentUserRank - 3),
    Math.min(view.players.length, currentUserRank + 2),
  );

  const avatarColors = ['#5c6e58', '#b89855', '#a08447', '#6b7e65', '#7a8c75', '#8b6b3d'];
  const getAvatarColor = (player) => {
    if (player.isCurrentUser) return displayProfile.avatarColor;
    if (player.avatarColor) return player.avatarColor;
    return avatarColors[player.name.charCodeAt(0) % avatarColors.length];
  };
  const playerAvatarImage = (player) => {
    if (player.isCurrentUser && displayProfile.avatarImageUrl) return displayProfile.avatarImageUrl;
    return player.avatarImageUrl || '';
  };
  const playerInitial = (player) => (
    player.isCurrentUser ? profileInitial(displayProfile) : player.name.charAt(0)
  );

  if (!open) return null;

  return (
    <div className="leaderboard-overlay" onClick={onClose}>
      <div className="leaderboard-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="leaderboard-handle" />
        <div className="leaderboard-head">
          <div>
            <h3>Today's Game Leaderboard</h3>
            <p>Ranked by coins earned from games today.</p>
          </div>
          <button className="leaderboard-close" onClick={onClose}>&times;</button>
        </div>

        <div className="lb-section-title lb-podium-title">Top Players</div>
        <div className="lb-podium-section">
          <div className="lb-podium">
            {[topPodium[1], topPodium[0], topPodium[2]].filter(Boolean).map((player, idx) => (
              <div className="lb-podium-player" key={`${player.rank}-${player.name}`}>
                <div className="lb-podium-avatar" style={{ background: getAvatarColor(player) }}>
                  {playerAvatarImage(player) ? (
                    <img src={playerAvatarImage(player)} alt="" />
                  ) : (
                    playerInitial(player)
                  )}
                </div>
                <span className="lb-podium-rank">#{player.rank}</span>
                <span className="lb-podium-name">{player.name}</span>
                <span className="lb-podium-coins">{player.coins}</span>
                <div className="lb-podium-bar">{idx === 0 ? '🥈' : idx === 1 ? '🥇' : '🥉'}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="lb-around-section">
          <div className="lb-section-title">Around You</div>
          <div className="lb-around-list">
            {aroundPlayers.map((player) => (
              <div className={`lb-row ${player.isCurrentUser ? 'is-current-user' : ''}`} key={`${player.rank}-${player.name}`}>
                <span className="lb-row-rank">#{player.rank}</span>
                <div className="lb-row-avatar" style={{ background: getAvatarColor(player) }}>
                  {playerAvatarImage(player) ? (
                    <img src={playerAvatarImage(player)} alt="" />
                  ) : (
                    playerInitial(player)
                  )}
                </div>
                <div className="lb-row-info">
                  <div className="lb-row-name">{player.name}</div>
                </div>
                <span className="lb-row-coins">{player.coins}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatWalletExpiry(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function couponDiscountNum(coupon) {
  return couponPercentNum(coupon);
}

function CouponValueFace({ coupon, featured = false }) {
  const mode = couponDisplayMode(coupon);
  const num = couponPercentNum(coupon);
  const headline = couponTicketHeadline(coupon);
  const amountMatch = String(headline).match(/^(.+?)\s+OFF$/i);
  const percentValue = Number(num);
  if (featured) {
    if (mode === 'percent' && num && percentValue > 0) {
      return (
        <>
          <b>{num}</b>
          <span className="cwticket-disc-unit">
            <span className="cwticket-disc-pct">%</span>
            <span className="cwticket-disc-off">OFF</span>
          </span>
        </>
      );
    }
    return <span className="cwticket-disc-text">{headline}</span>;
  }
  if (mode === 'percent' && num && percentValue > 0) {
    return (
      <>
        <b>{num}%</b>
        <span>OFF</span>
      </>
    );
  }
  if (mode === 'amount' && amountMatch) {
    return (
      <>
        <b>{amountMatch[1]}</b>
        <span>OFF</span>
      </>
    );
  }
  return <b className={`cwticket-headline is-${mode}`}>{headline}</b>;
}

function CouponTicketArt({ coupon }) {
  const mode = couponDisplayMode(coupon);
  if (mode === 'free-shipping') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 7.5h11v8h-11z" />
        <path d="M13.5 10h4l3 3v2.5h-7z" />
        <circle cx="7" cy="17.5" r="1.7" />
        <circle cx="17.5" cy="17.5" r="1.7" />
        <path d="M21 5.5l.6-1.4.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6z" />
      </svg>
    );
  }
  if (mode === 'bogo') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8v13" />
        <path d="M19 12H5" />
        <path d="M12 8a4 4 0 0 0 0-8 4 4 0 0 0 0 8z" />
        <path d="M20 6l.6-1.4.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8h12l-1.1 11.2a1 1 0 0 1-1 .8H8.1a1 1 0 0 1-1-.8L6 8z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      <path d="M20 6l.6-1.4.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6z" />
    </svg>
  );
}

function CouponTicket({
  coupon,
  copied = false,
  onCopy,
  onShop,
  className = '',
  showDetails = true,
  showCode = true,
  showShop = true,
  featured = false,
  brand = null,
}) {
  const expiry = formatWalletExpiry(coupon.expiresAt);
  const conditions = coupon.conditions || 'No minimum';
  const displayCode = coupon.code || coupon.mockCode;
  const mode = couponDisplayMode(coupon);

  if (featured) {
    return (
      <div className={`cwticket is-colored is-featured is-type-${mode} ${className}`.trim()} {...couponPaletteProps(coupon)}>
        <div className="cwticket-main">
          <div className="cwticket-disc">
            <CouponValueFace coupon={coupon} featured />
          </div>
          <div className="cwticket-info">
            <div className="cwticket-cond">{conditions}</div>
            {expiry && <div className="cwticket-expire">Expires {expiry}</div>}
            {showCode && displayCode && (
              <div className="cwticket-code">
                <span className="cwticket-code-label">CODE</span>
                <span className="cwticket-code-value">{displayCode}</span>
                <button
                  className={`cwticket-copy ${copied ? 'is-copied' : ''}`}
                  type="button"
                  onClick={() => onCopy?.(displayCode)}
                  aria-label={copied ? `${displayCode} copied` : `Copy ${displayCode}`}
                  title={copied ? 'Copied' : 'Copy code'}
                >
                  {copied ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  )}
                </button>
              </div>
            )}
          </div>
          <span className="cwticket-art" aria-hidden="true">
            <CouponTicketArt coupon={coupon} />
          </span>
        </div>
        {showShop && (
          <button className="cwticket-stub" type="button" aria-label="Shop with coupon" onClick={onShop}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 5 7 7-7 7" /></svg>
            <span className="cwticket-stub-text">Shop now</span>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={`cwticket is-colored is-type-${mode} ${className}`.trim()} {...couponPaletteProps(coupon)}>
      <div className="cwticket-main">
        <div className="cwticket-value">
          <CouponValueFace coupon={coupon} />
        </div>
        {showDetails && <div className="cwticket-cond">{conditions}</div>}
        {showDetails && expiry && <div className="cwticket-expire">Expires {expiry}</div>}
        {showCode && displayCode && (
          <div className="cwticket-code">
            <span className="cwticket-code-label">CODE</span>
            <span className="cwticket-code-value">{displayCode}</span>
            <button
              className={`cwticket-copy ${copied ? 'is-copied' : ''}`}
              type="button"
              onClick={() => onCopy?.(displayCode)}
              aria-label={copied ? `${displayCode} copied` : `Copy ${displayCode}`}
              title={copied ? 'Copied' : 'Copy code'}
            >
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  Copied
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  Copy
                </>
              )}
            </button>
          </div>
        )}
      </div>
      {showShop && (
        <button className="cwticket-stub" type="button" aria-label="Shop with coupon" onClick={onShop}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 5 7 7-7 7" /></svg>
          <span className="cwticket-stub-text">Shop now</span>
        </button>
      )}
    </div>
  );
}

function WalletTicket({ coupon, copiedCode, onCopy, onClaim }) {
  return (
    <CouponTicket
      coupon={coupon}
      copied={copiedCode === coupon.code}
      onCopy={onCopy}
      onShop={onClaim}
    />
  );
}

function InactiveTicket({ coupon, label }) {
  const conditions = coupon.conditions || 'No minimum';
  const labelLower = (label || '').toLowerCase();
  const displayCode = coupon.code || coupon.mockCode || 'DEVCODE';

  return (
    <div className={`cwticket is-inactive is-${labelLower}`} {...couponPaletteProps(coupon)}>
      <div className="cwticket-main">
        <div className="cwticket-value">
          <CouponValueFace coupon={coupon} />
        </div>
        <div className="cwticket-details">
          <div className="cwticket-code-lbl">CODE: {displayCode}</div>
          <div className="cwticket-cond-lbl">{conditions}</div>
        </div>
        <div className="cwticket-stamp-wrapper">
          <div className={`cwticket-stamp is-${labelLower}`}>{label}</div>
        </div>
      </div>
      <div className="cwticket-stub is-inactive">
        <span className="cwticket-stub-text">{label}</span>
      </div>
    </div>
  );
}

function SettlementTicket({ coupon, status }) {
  const conditions = coupon.conditions || 'No minimum';
  const displayCode = coupon.code || coupon.mockCode || 'DEVCODE';
  const isUsed = status === 'used';

  return (
    <div className={`cwticket ${isUsed ? 'is-settlement-used' : 'is-settlement-earned is-colored'}`} {...couponPaletteProps(coupon)}>
      <div className="cwticket-main">
        <div className="cwticket-value">
          <CouponValueFace coupon={coupon} />
        </div>
        <div className="cwticket-details">
          <div className="cwticket-code-lbl">CODE: {displayCode}</div>
          <div className="cwticket-cond-lbl">{conditions}</div>
        </div>
        <div className="cwticket-stamp-wrapper">
          <div className={`cwticket-stamp is-${status}`}>{isUsed ? 'Used' : 'Earned'}</div>
        </div>
      </div>
      <div className="cwticket-stub">
        <span className="cwticket-stub-text">{isUsed ? 'Used' : 'Earned'}</span>
      </div>
    </div>
  );
}

function GiftOpeningHero({ brand }) {
  const brandName = brand?.name || 'FridgeChannel';
  return (
    <div className="gift-opening-hero" aria-hidden="true">
      <div className="gift-opening-brand">
        {brand?.logoUrl ? <img src={brand.logoUrl} alt="" /> : <BrandMark className="gift-opening-logo" />}
        <span>{brandName}</span>
      </div>
      <div className="gift-opening-stage">
        <div className="gift-opening-glow" />
        <img
          className="gift-opening-box"
          src="/rewards/welcome-rewards-hero-final-small.png"
          alt=""
        />
      </div>
    </div>
  );
}

function GiftRevealModal({ pack, coupons, brand, copiedCode, onCopy, onShop, onOpenWallet, onClose }) {
  const list = useMemo(
    () => selectPackRevealCoupons(pack, coupons, { requireCode: true }),
    [pack, coupons],
  );
  if (!list.length) return null;
  const count = list.length;
  const label = `${count} coupon${count === 1 ? '' : 's'}`;
  const confetti = Array.from({ length: 42 }, (_, index) => ({
    id: index,
    left: `${4 + ((index * 37) % 92)}%`,
    delay: `${(index % 9) * 0.055}s`,
    duration: `${1.8 + (index % 7) * 0.12}s`,
    drift: `${-42 + ((index * 29) % 84)}px`,
    rotation: `${180 + ((index * 73) % 420)}deg`,
    color: ['#7b3f4b', '#b9964d', '#ead9a0', '#9d3445', '#d4af62'][index % 5],
  }));
  return (
    <div className="gift-reveal-overlay">
      <div className="gift-reveal-confetti" aria-hidden="true">
        {confetti.map((piece) => (
          <i
            key={piece.id}
            style={{
              '--confetti-left': piece.left,
              '--confetti-delay': piece.delay,
              '--confetti-duration': piece.duration,
              '--confetti-drift': piece.drift,
              '--confetti-rotation': piece.rotation,
              '--confetti-color': piece.color,
            }}
          />
        ))}
      </div>
      <main className="gift-reveal-card" role="dialog" aria-label="Gift unlocked">
        <GiftOpeningHero brand={brand} />
        <h2 className="gift-reveal-title">Gift unlocked!</h2>
        <p className="gift-reveal-desc">
          <b>{pack?.title || 'Your gift'}</b> added {label} to My coupons.
        </p>
        <div className="gift-reveal-coupons">
          {list.map((coupon) => {
            const copied = copiedCode === coupon.code;
            return (
              <CouponTicket
                key={coupon.code ?? coupon.couponId ?? coupon.value}
                coupon={coupon}
                featured
                brand={brand}
                showDetails
                showCode
                copied={copied}
                onCopy={onCopy}
                onShop={onShop}
              />
            );
          })}
        </div>
        <button className="gift-reveal-btn" type="button" onClick={onOpenWallet}>View my coupons</button>
        <button className="gift-reveal-close" type="button" onClick={onClose}>Continue</button>
      </main>
    </div>
  );
}

function CompletedRewardsIntro({ couponCount, time, isExpired, urgent }) {
  return (
    <div className={`completed-rewards-shell ${urgent ? 'is-urgent' : ''}`}>
      <img
        className="completed-rewards-gift"
        src="/rewards/target-gift.png"
        alt=""
        aria-hidden="true"
      />
      <section className={`completed-rewards-intro ${urgent ? 'is-urgent' : ''}`}>
        <div className="completed-rewards-copy-block">
          <p className="completed-rewards-eyebrow">All rewards unlocked</p>
          <h2>You earned the full reward set.</h2>
          <p className="completed-rewards-copy">
            All {couponCount} coupons are ready to use. Pick your favorites before the event ends.
          </p>
        </div>
        <div className="completed-rewards-timer">
          <span>{isExpired ? 'Event ended' : 'Time left to use'}</span>
          {!isExpired && (
            <strong>
              {time.digits[0]}d&nbsp; {time.digits[1]}h&nbsp; {time.digits[2]}m&nbsp; {time.digits[3]}s
            </strong>
          )}
        </div>
      </section>
    </div>
  );
}

function CouponWalletPage({
  coupons,
  copiedCode,
  onCopy,
  onClaim,
  completed = false,
  navDirection = 'forward',
  time,
  isExpired = false,
  urgent = false,
  isSample = false,
  onReset,
}) {
  const list = coupons ?? [];
  const active = completed
    ? list
    : list.filter((coupon) => coupon.status === 'active' && isWalletCouponUsable(coupon));
  const used = completed ? [] : list.filter((coupon) => coupon.status === 'used');
  const expired = completed
    ? []
    : list.filter((coupon) => coupon.status === 'expired' || (coupon.status === 'active' && !isWalletCouponUsable(coupon)));
  const showSampleReset = completed && isSample && typeof onReset === 'function';

  return (
    <main
      className={`content-area cwallet-page ${completed ? 'is-completed' : ''} ${navDirection === 'back' ? 'is-nav-back' : 'is-nav-forward'}`}
      data-screen-label={completed ? '全部奖励' : '我的优惠券'}
    >
      {completed && (
        <CompletedRewardsIntro
          couponCount={active.length}
          time={time}
          isExpired={isExpired}
          urgent={urgent}
        />
      )}
      {list.length === 0 ? (
        <div className="cwallet-empty">No coupons yet.<br />Claim a reward to add it here.</div>
      ) : (
        <>
          {active.length > 0 && (
            <>
              {!completed && <div className="cwallet-section-label">Available · {active.length}</div>}
              <div className="cwallet-ticket-grid">
                {active.map((coupon) => (
                  <WalletTicket key={walletCouponKey(coupon) ?? coupon.code} coupon={coupon} copiedCode={copiedCode} onCopy={onCopy} onClaim={onClaim} />
                ))}
              </div>
            </>
          )}
          {used.length > 0 && (
            <>
              <div className="cwallet-section-label">Used · {used.length}</div>
              <div className="cwallet-ticket-grid">
                {used.map((coupon) => (
                  <InactiveTicket key={walletCouponKey(coupon) ?? coupon.code} coupon={coupon} label="Used" />
                ))}
              </div>
            </>
          )}
          {expired.length > 0 && (
            <>
              <div className="cwallet-section-label">Expired · {expired.length}</div>
              <div className="cwallet-ticket-grid">
                {expired.map((coupon) => (
                  <InactiveTicket key={walletCouponKey(coupon) ?? coupon.code} coupon={coupon} label="Expired" />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {showSampleReset && (
        <div className="completed-rewards-reset">
          <button className="completed-rewards-reset-btn" type="button" onClick={onReset}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            <span>Reset</span>
          </button>
        </div>
      )}
    </main>
  );
}

function CouponFeedbackToasts({ coinGainSignal, lastGainAmount, unlockToastSignal, next }) {
  const [showCoinGain, setShowCoinGain] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);

  useEffect(() => {
    if (coinGainSignal > 0 && lastGainAmount > 0) {
      setShowCoinGain(true);
      const t = setTimeout(() => setShowCoinGain(false), 1600);
      return () => clearTimeout(t);
    }
  }, [coinGainSignal, lastGainAmount]);

  useEffect(() => {
    if (unlockToastSignal > 0) {
      setShowUnlock(true);
      const t = setTimeout(() => setShowUnlock(false), 2400);
      return () => clearTimeout(t);
    }
  }, [unlockToastSignal]);

  if (!showCoinGain && !(showUnlock && next)) return null;

  return (
    <div className="wallet-feedback-row">
      {showCoinGain && <span className="coin-gain-toast">+{lastGainAmount} ¢</span>}
      {showUnlock && next && <span className="coupon-unlock-toast">🎉 {next.num}% OFF Unlocked</span>}
    </div>
  );
}
