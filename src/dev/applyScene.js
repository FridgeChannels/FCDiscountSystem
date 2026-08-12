import { couponPaletteTierFor } from '../api/couponDisplay.js';
import {
  clearClaimedCode,
  clearWelcomeCompleted,
  writeClaimRecord,
  writeWelcomeCompleted,
} from '../api/cache.js';
import { getSceneConfig } from './scenes.js';

export function isDevPreviewEnabled() {
  return (
    import.meta.env.DEV &&
    (import.meta.env.VITE_DEV_TOOLBAR_ENABLED ?? 'false') === 'true'
  );
}

export function shouldShowDevToolbar() {
  return isDevPreviewEnabled();
}

export function getDevScene() {
  if (!isDevPreviewEnabled()) return '';
  const params = new URLSearchParams(window.location.search);
  const scene = params.get('scene')?.trim() ?? '';
  if (scene === 'best' || scene === 'claimed' || scene === 'claim') {
    params.set('scene', 'home');
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState({}, '', url);
    return 'home';
  }
  return scene;
}

export function navigateToDevScene(sceneId) {
  if (!isDevPreviewEnabled()) return;
  const url = new URL(window.location.href);
  if (sceneId) {
    url.searchParams.set('scene', sceneId);
  } else {
    url.searchParams.delete('scene');
  }
  window.history.replaceState({}, '', url);
}

/**
 * Apply immediate UI flags after syncFromPlan in dev preview mode.
 * @param {import('./scenes.js').DevSceneUi} ui
 * @param {object} ctx
 */
export function applyDevSceneUi(ui, ctx) {
  const { touchId, rewardPlanId, planCycleId, setters } = ctx;
  const {
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
    points,
    discounts,
    currentStepIndex,
    readCouponTokens,
    readCouponTokensForTier,
    tierForDiscount,
    targetCouponRef,
    viewportRef,
  } = setters;

  if (ui.clearWelcome) clearWelcomeCompleted(touchId);
  if (ui.setWelcomeCompleted) writeWelcomeCompleted(touchId, true);
  if (ui.clearClaimed) {
    clearClaimedCode(touchId);
    setClaimedCode(null);
  }
  if (ui.claimedCode) {
    setClaimedCode(ui.claimedCode);
    const cycleId = planCycleId || rewardPlanId;
    if (cycleId) {
      writeClaimRecord(touchId, { code: ui.claimedCode, cycleId });
    }
  }
  if (ui.welcomeStep != null) setWelcomeStep(ui.welcomeStep);
  if (ui.introActive != null) setIntroActive(ui.introActive);

  setNewChallenge(ui.newChallenge ?? null);
  setActiveModal(ui.activeModal ?? null);
  setSurveyStep(ui.surveyStep ?? 0);
  setNotification(ui.notification ?? null);
  setGameStart(null);
  setGameModalTitle('Play & Earn');

  if (setters.setShopifyAuthOverlay) {
    setters.setShopifyAuthOverlay(ui.shopifyAuthOverlay ?? null);
  }
  if (ui.shopifyStatus) {
    setters.setShopifyBinding?.(ui.shopifyStatus);
    setters.setShopifyAuthStatus?.(ui.shopifyStatus.connected ? 'connected' : 'unconnected');
    setters.writeCachedShopifyStatus?.(touchId, ui.shopifyStatus);
  } else {
    setters.setShopifyBinding?.(null);
    setters.setShopifyAuthStatus?.('unconnected');
    setters.clearCachedShopifyStatus?.(touchId);
  }

  setShowReceipt(false);
  if (setReceiptCoupon) setReceiptCoupon(null);
  setZoomActive(false);

  const openDomOverlays = () => {
    if (ui.openReceipt) {
      const unlocked =
        discounts[currentStepIndex + 1] || discounts[currentStepIndex] || discounts[0];
      const targetEl = targetCouponRef?.current;
      setReceiptCoupon(unlocked);
      const liveTokens = targetEl ? readCouponTokens(targetEl.closest('.coupon')) : null;
      setReceiptColors(
        liveTokens ?? readCouponTokensForTier?.(couponPaletteTierFor(unlocked) ?? 0) ?? null,
      );
      setPendingPoints(points);
      setShowReceipt(true);
    }

    if (ui.openZoomFlip) {
      const coupon = ui.claimedCode
        ? (discounts.find((item) => item.code === ui.claimedCode) ||
          discounts[currentStepIndex] ||
          discounts[0])
        : (discounts[currentStepIndex + 1] || discounts[currentStepIndex] || discounts[0]);
      const targetEl = targetCouponRef?.current;
      setZoomCoupon(coupon);
      const liveTokens = targetEl ? readCouponTokens(targetEl.closest('.coupon')) : null;
      // 无可读券面时按档位回退,保证刮刮卡背景与券面一致
      setZoomColors(
        liveTokens ?? readCouponTokensForTier?.(couponPaletteTierFor(coupon) ?? 0) ?? null,
      );
      setZoomCopyState('Copy');
      setZoomPhase(ui.zoomPhase ?? 'flipped');

      const viewport = viewportRef?.current;
      if (viewport) {
        const vpRect = viewport.getBoundingClientRect();
        const cardW = Math.min(vpRect.width * 0.82, 320);
        const cardH = cardW * 1.58;
        setZoomRect({
          left: vpRect.left + (vpRect.width - cardW) / 2,
          top: vpRect.top + (vpRect.height - cardH) / 2,
          width: cardW,
          height: cardH,
        });
      }
      setZoomActive(true);
    }
  };

  if (ui.openReceipt || ui.openZoomFlip) {
    window.requestAnimationFrame(openDomOverlays);
  }
}

/**
 * Load plan + UI for a dev scene.
 * @returns {{ plan: object, ui: import('./scenes.js').DevSceneUi } | null}
 */
export function resolveDevScene(sceneId) {
  const config = getSceneConfig(sceneId);
  if (!config) return null;
  return { plan: config.fixture(), ui: config.ui };
}
