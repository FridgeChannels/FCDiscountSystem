/**
 * Investor deck embed (sample-proposal /p/{sn}?experience=…, framed with ?fc_embed=investor).
 * Joins the host page's PostHog person + session so the replay and events stitch together.
 * Normal NFC taps never load PostHog.
 */

const EVENT_PREFIX = 'investor_iframe_';
const INTERACTION_THROTTLE_MS = 1500;

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

export function initInvestorEmbedAnalytics() {
  const info = readEmbed();
  if (!info) return;

  document.addEventListener('click', () => notifyInteraction('click'), true);

  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  if (!token) return;

  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(token, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
      defaults: '2026-05-30',
      // Third-party iframe: the host owns identity, so keep nothing on this origin.
      persistence: 'memory',
      bootstrap: info.distinctId
        ? { distinctID: info.distinctId, ...(info.sessionId ? { sessionID: info.sessionId } : {}) }
        : undefined,
      disable_session_recording: false,
      session_recording: { recordCrossOriginIframes: true },
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
  }).catch(() => {});
}

/** Business event inside the framed experience (also nudges the host's engagement counter). */
export function trackEmbed(event, properties = {}) {
  if (!readEmbed()) return;
  capture(event, properties);
  notifyInteraction(event);
}

export function notifyEmbedReady(experience) {
  if (!readEmbed()) return;
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
