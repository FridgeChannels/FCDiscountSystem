const CLICK_TARGET = 5;
const WINDOW_MS = 2000;

/**
 * 演示用隐藏开关：在窗口期内连续点击 logo 达到次数后触发回调。
 */
export function createLogoTapDetector({ onTrigger, clickTarget = CLICK_TARGET, windowMs = WINDOW_MS } = {}) {
  let count = 0;
  let timer = null;

  return function handleLogoTap() {
    count += 1;
    if (timer) window.clearTimeout(timer);
    if (count >= clickTarget) {
      count = 0;
      onTrigger?.();
      return;
    }
    timer = window.setTimeout(() => {
      count = 0;
      timer = null;
    }, windowMs);
  };
}

export function isDemoForceRenewEnabled() {
  return (import.meta.env.VITE_DEMO_FORCE_RENEW_ENABLED ?? 'false') === 'true';
}
