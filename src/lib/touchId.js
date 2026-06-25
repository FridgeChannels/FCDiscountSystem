/** magnet.sn / touchId in URL — alphanumeric serial from NFC magnet. */
export const TOUCH_ID_VALUE_PATTERN = /^[A-Z0-9]{6,16}$/i;

const TOUCH_ID_PATH_PATTERN = /^\/(?:p|t)\/([^/]+)\/?$/i;

const RESERVED_SINGLE_SEGMENTS = new Set([
  'api',
  'admin',
  'uploaded-games',
  'brand-assets',
  'runtime-shell',
  '_next',
]);

export const TOUCH_ID_INVALID_REASON = {
  MISSING: 'missing',
  MALFORMED_PATH: 'malformed_path',
  INVALID_FORMAT: 'invalid_format',
};

export function isValidTouchIdValue(value) {
  return TOUCH_ID_VALUE_PATTERN.test(String(value ?? '').trim());
}

/**
 * Resolve touchId strictly from the current URL.
 * Does not read cookies or other persisted fallbacks.
 */
export function parseTouchIdFromUrl(location = typeof window !== 'undefined' ? window.location : { pathname: '/', search: '' }) {
  const params = new URLSearchParams(location.search ?? '');
  const fromQuery = params.get('touchId')?.trim();
  if (fromQuery) {
    if (isValidTouchIdValue(fromQuery)) {
      return { touchId: fromQuery, source: 'query' };
    }
    return { touchId: null, reason: TOUCH_ID_INVALID_REASON.INVALID_FORMAT, detail: fromQuery };
  }

  const pathMatch = String(location.pathname ?? '').match(TOUCH_ID_PATH_PATTERN);
  if (pathMatch?.[1]) {
    const id = decodeURIComponent(pathMatch[1]).trim();
    if (isValidTouchIdValue(id)) {
      return { touchId: id, source: 'path' };
    }
    return { touchId: null, reason: TOUCH_ID_INVALID_REASON.INVALID_FORMAT, detail: id };
  }

  const pathname = String(location.pathname ?? '/');
  const shortMatch = pathname.match(/^\/([^/]+)\/?$/);
  if (shortMatch?.[1]) {
    const segment = decodeURIComponent(shortMatch[1]).trim();
    const reserved = RESERVED_SINGLE_SEGMENTS.has(segment.toLowerCase());
    if (!reserved && isValidTouchIdValue(segment)) {
      return {
        touchId: null,
        reason: TOUCH_ID_INVALID_REASON.MALFORMED_PATH,
        detail: segment,
      };
    }
  }

  if (pathname === '/' || pathname === '') {
    return { touchId: null, reason: TOUCH_ID_INVALID_REASON.MISSING };
  }

  return { touchId: null, reason: TOUCH_ID_INVALID_REASON.MALFORMED_PATH };
}

export function getTouchIdErrorMessage(reason, detail) {
  switch (reason) {
    case TOUCH_ID_INVALID_REASON.MISSING:
      return 'Open this page by tapping your FridgeChannel magnet. A valid magnet link is required to start.';
    case TOUCH_ID_INVALID_REASON.MALFORMED_PATH:
      if (detail) {
        return `This link is missing the required path prefix. Use /t/${detail} or scan your magnet again.`;
      }
      return 'Invalid link. Open this page by tapping your FridgeChannel magnet.';
    case TOUCH_ID_INVALID_REASON.INVALID_FORMAT:
      return 'The magnet code in this link is invalid. Please scan your magnet again.';
    default:
      return 'Unable to start without a valid magnet link.';
  }
}

export function resolveTouchIdFromUrl(location, { devFallbackId = '' } = {}) {
  const parsed = parseTouchIdFromUrl(location);
  if (parsed.touchId) return parsed;
  if (devFallbackId && isValidTouchIdValue(devFallbackId)) {
    return { touchId: devFallbackId, source: 'dev_fallback' };
  }
  return parsed;
}
