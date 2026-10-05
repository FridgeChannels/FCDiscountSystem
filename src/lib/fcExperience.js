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

export async function fetchFcExperience(sn, { fetchImpl = fetch, experience } = {}) {
  const params = new URLSearchParams();
  const wanted = experience
    || preferredExperienceFromSearch(typeof window !== 'undefined' ? window.location.search : '');
  if (wanted) params.set('experience', wanted);
  const query = params.toString();
  const response = await fetchImpl(
    `/api/fc/experience/${encodeURIComponent(sn)}${query ? `?${query}` : ''}`,
  );
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
