import { parseTouchIdFromUrl, resolveTouchIdFromUrl } from '../lib/touchId.js';

export function resolveSnFromUrl(location = window.location) {
  const parsed = resolveTouchIdFromUrl(location);
  if (parsed.touchId) return parsed.touchId.toUpperCase();
  const pathMatch = String(location.pathname ?? '').match(/\/(?:r|p|t)\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim().toUpperCase();
  const fc = new URLSearchParams(location.search).get('fc');
  if (fc) return fc.trim().toUpperCase();
  return null;
}

/**
 * Dedicated experience router. Must not call /api/reorder/consumer.
 */
function preferredExperienceFromSearch(search) {
  const wanted = new URLSearchParams(search || '').get('experience');
  return wanted === 'dtc' || wanted === 'asin_plus' ? wanted : null;
}

/** One-shot: a Response body can only be read once, so retries fall back to a fresh fetch. */
function takePrefetchedExperience(url, fetchImpl) {
  if (typeof window === 'undefined' || fetchImpl !== fetch) return null;
  const prefetch = window.__FC_EXPERIENCE_PREFETCH__;
  if (!prefetch || prefetch.url !== url) return null;
  window.__FC_EXPERIENCE_PREFETCH__ = null;
  return prefetch.response.catch(() => fetchImpl(url));
}

export async function fetchFcExperience(sn, { fetchImpl = fetch, experience } = {}) {
  const params = new URLSearchParams();
  const wanted = experience
    || preferredExperienceFromSearch(typeof window !== 'undefined' ? window.location.search : '');
  if (wanted) params.set('experience', wanted);
  const query = params.toString();
  const url = `/api/fc/experience/${encodeURIComponent(sn)}${query ? `?${query}` : ''}`;
  const response = await (takePrefetchedExperience(url, fetchImpl) ?? fetchImpl(url));
  if (!response.ok) {
    const error = new Error(`experience_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function parseTouchIdOrNull(location = window.location) {
  return parseTouchIdFromUrl(location);
}
