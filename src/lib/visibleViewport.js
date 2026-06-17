/** Lock `.mobile-viewport` to the browser's visible area (avoids 100dvh overflow on mobile). */
export function bindVisibleViewportLock(viewportEl) {
  if (!(viewportEl instanceof HTMLElement)) {
    return () => {};
  }

  const prev = {
    height: viewportEl.style.height,
    minHeight: viewportEl.style.minHeight,
    maxHeight: viewportEl.style.maxHeight,
    visibleVh: viewportEl.style.getPropertyValue('--fc-visible-vh'),
    visibleVw: viewportEl.style.getPropertyValue('--fc-visible-vw'),
  };

  function sync() {
    const vv = window.visualViewport;
    const height = Math.round(vv?.height > 0 ? vv.height : window.innerHeight);
    const width = Math.round(vv?.width > 0 ? vv.width : window.innerWidth);

    viewportEl.style.setProperty('--fc-visible-vh', `${height}px`);
    viewportEl.style.setProperty('--fc-visible-vw', `${width}px`);
    viewportEl.style.height = `${height}px`;
    viewportEl.style.minHeight = `${height}px`;
    viewportEl.style.maxHeight = `${height}px`;
  }

  sync();
  window.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);

  const rafId = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(sync);
  });

  return () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('scroll', sync);

    viewportEl.style.height = prev.height;
    viewportEl.style.minHeight = prev.minHeight;
    viewportEl.style.maxHeight = prev.maxHeight;
    if (prev.visibleVh) {
      viewportEl.style.setProperty('--fc-visible-vh', prev.visibleVh);
    } else {
      viewportEl.style.removeProperty('--fc-visible-vh');
    }
    if (prev.visibleVw) {
      viewportEl.style.setProperty('--fc-visible-vw', prev.visibleVw);
    } else {
      viewportEl.style.removeProperty('--fc-visible-vw');
    }
  };
}

function visibleViewportBottom() {
  const vv = window.visualViewport;
  if (!vv) return window.innerHeight;
  return vv.offsetTop + vv.height;
}

function visibleViewportTop() {
  return window.visualViewport?.offsetTop ?? 0;
}

/** Height of `el` that intersects the visible viewport. */
export function measureVisibleHeight(el) {
  if (!(el instanceof Element)) return 0;
  const rect = el.getBoundingClientRect();
  const top = Math.max(rect.top, visibleViewportTop());
  const bottom = Math.min(rect.bottom, visibleViewportBottom());
  return Math.max(0, Math.round(bottom - top));
}
