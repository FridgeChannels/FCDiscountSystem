import { measureVisibleHeight } from './visibleViewport.js';

/** Post playable iframe size into the embedded game (excludes host top chrome). */
export function bindIframeHostViewport(iframe, targetOrigin) {
  if (!iframe || typeof targetOrigin !== 'string' || !targetOrigin) {
    return () => {};
  }

  let lastPayload = '';

  function resolveLayoutNodes() {
    const stageRoot = iframe.closest('.iframe-game-host')
      || iframe.closest('.platform-game-stage');
    const overlay = stageRoot?.closest('.platform-game-overlay')
      || iframe.closest('.platform-game-overlay');
    const topbarEl = overlay?.querySelector('.platform-game-topbar') ?? null;
    return { stageRoot, overlay, topbarEl };
  }

  function measureGameViewport() {
    const { stageRoot, overlay, topbarEl } = resolveLayoutNodes();

    const chromeHeight = topbarEl
      ? Math.round(topbarEl.getBoundingClientRect().height)
      : 0;

    const measureEl = stageRoot instanceof HTMLElement ? stageRoot : iframe;

    let width = Math.round(measureEl.clientWidth || iframe.clientWidth || 0);
    let height = measureVisibleHeight(measureEl);

    if (height <= 0) {
      height = Math.round(measureEl.clientHeight || iframe.clientHeight || 0);
    }

    // Progress rail, coins, rank, and Exit sit above the game stage.
    if (overlay instanceof HTMLElement && chromeHeight > 0) {
      const overlayVisibleHeight = measureVisibleHeight(overlay);
      const maxGameHeight = overlayVisibleHeight > chromeHeight
        ? overlayVisibleHeight - chromeHeight
        : 0;
      if (maxGameHeight > 0 && (height <= 0 || height > maxGameHeight)) {
        height = maxGameHeight;
      }
    }

    return { width, height, chromeHeight };
  }

  function postViewport() {
    const win = iframe.contentWindow;
    if (!win) return;

    const { width, height, chromeHeight } = measureGameViewport();
    if (width <= 0 || height <= 0) return;

    const payload = `${width}x${height}@${chromeHeight}`;
    if (payload === lastPayload) return;
    lastPayload = payload;

    win.postMessage(
      {
        v: 1,
        type: 'fc.host.viewport',
        width,
        height,
        chromeHeight,
      },
      targetOrigin,
    );
  }

  postViewport();

  const observed = new Set();
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
      postViewport();
    })
    : null;

  function observe(el) {
    if (!el || !(el instanceof Element) || observed.has(el)) return;
    observed.add(el);
    ro?.observe(el);
  }

  observe(iframe);
  const { stageRoot, overlay, topbarEl } = resolveLayoutNodes();
  observe(stageRoot);
  observe(overlay);
  observe(topbarEl);

  const rafId = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(postViewport);
  });

  window.addEventListener('resize', postViewport);
  window.visualViewport?.addEventListener('resize', postViewport);
  window.visualViewport?.addEventListener('scroll', postViewport);

  return () => {
    window.cancelAnimationFrame(rafId);
    ro?.disconnect();
    window.removeEventListener('resize', postViewport);
    window.visualViewport?.removeEventListener('resize', postViewport);
    window.visualViewport?.removeEventListener('scroll', postViewport);
  };
}
