/**
 * Investor deck embed (sample-proposal /p/{sn}?experience=…, framed with ?fc_embed=investor).
 * Joins the host page's PostHog person + session so the replay and events stitch together.
 * Normal NFC taps never load PostHog.
 */

const EVENT_PREFIX = 'investor_iframe_';
const INTERACTION_THROTTLE_MS = 1500;
const IDLE_TIMEOUT_MS = 2000;

const API_EVENTS = {
  '/api/fc/session/start': 'game_started',
  '/api/fc/session/complete': 'game_completed',
  '/api/fc/coupons/redeem': 'coupon_claimed',
  '/api/fc/coupons/observe': 'coupon_observed',
  '/api/fc/rewards/claim-initial': 'initial_reward_claimed',
  '/api/fc/rewards/claim-target-pack': 'target_reward_claimed',
  '/api/fc/survey/complete': 'survey_completed',
  '/api/fc/survey/answers': 'survey_answers_submitted',
  '/api/fc/cycle/renew': 'cycle_renewed',
  '/api/fc/player-profile': 'profile_updated',
};
const SAFE_BODY_KEYS = ['rewardPlanId', 'gameInstanceId', 'couponId', 'campaignId', 'score', 'result', 'reason'];

let embed;
let client = null;
let bootStarted = false;
const pending = [];

function readEmbed() {
  if (embed !== undefined) return embed;
  embed = null;
  if (typeof window === 'undefined') return embed;
  const params = new URLSearchParams(window.location.search);
  if (params.get('fc_embed') !== 'investor') return embed;
  embed = {
    distinctId: params.get('ph_did') || null,
    sessionId: params.get('ph_sid') || null,
    visitId: params.get('iv') || null,
    channel: params.get('experience') || null,
  };
  return embed;
}

export function isInvestorEmbed() {
  return Boolean(readEmbed());
}

function hostOrigin() {
  try {
    return document.referrer ? new URL(document.referrer).origin : '*';
  } catch {
    return '*';
  }
}

function postToHost(message) {
  if (window.parent === window) return;
  window.parent.postMessage({ v: 1, ...message }, hostOrigin());
}

function capture(event, properties) {
  if (!readEmbed()) return;
  if (!client) {
    pending.push([event, properties]);
    return;
  }
  client.capture(`${EVENT_PREFIX}${event}`, properties);
}

let lastInteractionAt = 0;
function notifyInteraction(event) {
  const now = Date.now();
  if (event === 'click' && now - lastInteractionAt < INTERACTION_THROTTLE_MS) return;
  lastInteractionAt = now;
  postToHost({ type: 'fc.embed.interaction', event });
}

function whenBrowserIdle(timeoutMs = IDLE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const schedule = () => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout: timeoutMs });
      } else {
        window.setTimeout(() => resolve(), Math.min(timeoutMs, 200));
      }
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
  });
}

/** Load PostHog once content is ready or the browser is idle — never race experience assets. */
function bootPosthog() {
  const info = readEmbed();
  if (!info || bootStarted) return;
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  if (!token) return;
  bootStarted = true;

  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(token, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
      defaults: '2026-05-30',
      // Third-party iframe: the host owns identity, so keep nothing on this origin.
      persistence: 'memory',
      bootstrap: info.distinctId
        ? { distinctID: info.distinctId, ...(info.sessionId ? { sessionID: info.sessionId } : {}) }
        : undefined,
      disable_surveys: true,
      capture_dead_clicks: false,
      capture_performance: false,
      disable_session_recording: false,
      session_recording: {
        recordCrossOriginIframes: true,
        slimDOMOptions: 'all',
      },
    });
    posthog.register({
      fc_embed: 'investor',
      investor_visit_id: info.visitId,
      embed_channel: info.channel,
      magnet_sn: window.location.pathname.match(/\/p\/([^/?#]+)/i)?.[1]?.toUpperCase() ?? null,
    });
    client = posthog;
    while (pending.length) {
      const [event, properties] = pending.shift();
      posthog.capture(`${EVENT_PREFIX}${event}`, properties);
    }
  }).catch(() => {
    bootStarted = false;
  });
}

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, label, summary, [contenteditable="true"], [role="button"], [role="slider"], [role="textbox"]';
const DRAG_THRESHOLD_PX = 6;

function injectEmbedInteractionStyles() {
  if (document.getElementById('fc-investor-embed-style')) return;
  const style = document.createElement('style');
  style.id = 'fc-investor-embed-style';
  style.textContent = `
html.fc-investor-embed,
html.fc-investor-embed body {
  -webkit-user-select: none;
  user-select: none;
  cursor: grab;
}
html.fc-investor-embed.is-embed-dragging,
html.fc-investor-embed.is-embed-dragging body {
  cursor: grabbing;
}
html.fc-investor-embed input,
html.fc-investor-embed textarea,
html.fc-investor-embed select,
html.fc-investor-embed [contenteditable="true"],
html.fc-investor-embed .coupon-code b {
  -webkit-user-select: text;
  user-select: text;
  cursor: auto;
}
html.fc-investor-embed img,
html.fc-investor-embed a {
  -webkit-user-drag: none;
  user-drag: none;
}
`;
  document.head.appendChild(style);
}

function isScrollable(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  const overflowY = style.overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
  return el.scrollHeight > el.clientHeight + 1;
}

function findScrollParent(start) {
  let node = start instanceof Element ? start : null;
  while (node && node !== document.documentElement) {
    if (isScrollable(node)) return node;
    node = node.parentElement;
  }
  const root = document.scrollingElement || document.documentElement;
  if (root && root.scrollHeight > root.clientHeight + 1) return root;
  return root;
}

/**
 * Desktop mouse drag → scroll (phone-simulator UX). Touch/pen keep native scrolling.
 * Only active when framed as ?fc_embed=investor.
 */
function enableDesktopDragScroll() {
  if (window.matchMedia('(pointer: coarse)').matches) return;

  let drag = null;
  let suppressClick = false;

  const clearDrag = () => {
    if (!drag) return;
    if (drag.moved) suppressClick = true;
    document.documentElement.classList.remove('is-embed-dragging');
    drag = null;
  };

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return;

    const scrollEl = findScrollParent(event.target);
    if (!scrollEl) return;

    drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startX: event.clientX,
      scrollTop: scrollEl.scrollTop,
      el: scrollEl,
      moved: false,
    };
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dy = event.clientY - drag.startY;
    const dx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // Prefer vertical phone swipe; abandon if the gesture is clearly horizontal.
      if (Math.abs(dx) > Math.abs(dy) * 1.4) {
        clearDrag();
        return;
      }
      drag.moved = true;
      document.documentElement.classList.add('is-embed-dragging');
      try {
        document.body.setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is best-effort; scroll still works without it.
      }
    }

    event.preventDefault();
    drag.el.scrollTop = drag.scrollTop - dy;
  }, { capture: true, passive: false });

  document.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearDrag();
  }, true);

  document.addEventListener('pointercancel', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearDrag();
  }, true);

  document.addEventListener('click', (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Stop native text-selection / image-drag once a swipe is underway.
  document.addEventListener('selectstart', (event) => {
    if (document.documentElement.classList.contains('is-embed-dragging') || drag) {
      event.preventDefault();
    }
  }, true);

  document.addEventListener('dragstart', (event) => {
    if (event.target instanceof HTMLImageElement || document.documentElement.classList.contains('is-embed-dragging')) {
      event.preventDefault();
    }
  }, true);
}

export function initInvestorEmbedAnalytics() {
  const info = readEmbed();
  if (!info) return;

  document.documentElement.classList.add('fc-investor-embed');
  injectEmbedInteractionStyles();
  enableDesktopDragScroll();

  document.addEventListener('click', () => notifyInteraction('click'), true);

  if (!import.meta.env.VITE_POSTHOG_PROJECT_TOKEN) return;
  // Fallback if notifyEmbedReady never fires (error screens still want analytics eventually).
  void whenBrowserIdle().then(() => bootPosthog());
}

/** Business event inside the framed experience (also nudges the host's engagement counter). */
export function trackEmbed(event, properties = {}) {
  if (!readEmbed()) return;
  capture(event, properties);
  notifyInteraction(event);
}

export function notifyEmbedReady(experience) {
  if (!readEmbed()) return;
  // Prefer starting PostHog once the experience UI is ready (earlier than idle fallback).
  bootPosthog();
  capture('experience_ready', { experience });
  postToHost({ type: 'fc.embed.ready', experience });
}

/** Maps DTC write endpoints to named events; GETs and unknown paths are ignored. */
export function trackEmbedApi(method, path, body, ok) {
  if (!readEmbed() || method === 'GET') return;
  const endpoint = String(path).split('?')[0];
  const name = API_EVENTS[endpoint];
  if (!name) return;
  const details = {};
  if (body && typeof body === 'object') {
    SAFE_BODY_KEYS.forEach((key) => {
      if (body[key] != null) details[key] = body[key];
    });
  }
  trackEmbed(ok ? name : `${name}_failed`, { endpoint, ...details });
}
