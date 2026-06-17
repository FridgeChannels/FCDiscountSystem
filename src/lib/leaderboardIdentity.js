/**
 * Leaderboard identity allocation.
 *
 * When a user first enters a brand challenge the system assigns a unique,
 * stable leaderboard identity in the form `{BrandName} {4-char code}`
 * (e.g. "Ritual 7K9Q").
 *
 * Rules (V1):
 *  - Code is 4 uppercase chars drawn from CODE_POOL.
 *  - Confusing characters (0/O/1/I/L) are excluded from the pool.
 *  - Codes are case-insensitive and always stored/displayed uppercase.
 *  - The identity is stable across challenge rounds for the same brand,
 *    so it is persisted per brand and never regenerated once assigned.
 *  - The 4-char code suffix is editable in Profile (avatar color too).
 *  - The full leaderboard display name is also editable in Profile.
 *
 * NOTE: true cross-user uniqueness ("unique under the same brand_id, never
 * reassigned") must be enforced by the backend. This client module owns the
 * format, the exclusion pool, and per-brand persistence/stability only.
 */

// Uppercase letters + digits, excluding the confusing set 0 O 1 I L.
export const CODE_POOL = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const STORAGE_PREFIX = 'fc.lbid.';

function canUseBrowserStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Stable storage key for a brand. Prefers an explicit id, falls back to name. */
function brandKey(brandName, brandId) {
  const raw = String(brandId ?? brandName ?? '').trim().toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'default';
}

/** Generate a random 4-char code from the (confusion-free) pool, uppercase. */
export function generateCode(length = CODE_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_POOL[Math.floor(Math.random() * CODE_POOL.length)];
  }
  return code;
}

/** Compose the displayed identity: `{BrandName} {CODE}`. */
export function formatLeaderboardId(brandName, code) {
  const name = String(brandName ?? '').trim() || 'Player';
  return `${name} ${code}`;
}

/** True when `code` is exactly 4 chars from the allowed pool. */
export function isValidDisplayCode(code) {
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/i.test(String(code ?? '').trim());
}

/** Keep only allowed pool characters, uppercase, max 4 chars. */
export function sanitizeDisplayCodeInput(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .split('')
    .filter((char) => CODE_POOL.includes(char))
    .join('')
    .slice(0, 4);
}

/** Extract the code suffix from a full leaderboard ID or trailing token. */
export function parseDisplayCodeFromLeaderboardId(brandName, value) {
  const raw = String(value ?? '').trim();
  const name = String(brandName ?? '').trim();
  if (name && raw.toLowerCase().startsWith(name.toLowerCase())) {
    return sanitizeDisplayCodeInput(raw.slice(name.length));
  }
  const parts = raw.split(/\s+/);
  return sanitizeDisplayCodeInput(parts[parts.length - 1] ?? '');
}

/**
 * Return the stable leaderboard identity for a brand, creating and persisting
 * one on first use. Returns `{ code, displayId, brandName }`.
 */
export function getOrCreateLeaderboardIdentity(brandName, brandId) {
  const name = String(brandName ?? '').trim();
  const key = `${STORAGE_PREFIX}${brandKey(name, brandId)}`;

  let code = null;
  if (canUseBrowserStorage()) {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) code = String(stored).trim().toUpperCase();
    } catch {
      // ignore read failures; fall through to generation
    }
  }

  if (!code) {
    code = generateCode();
    if (canUseBrowserStorage()) {
      try {
        window.localStorage.setItem(key, code);
      } catch {
        // persistence is best-effort; identity still usable this session
      }
    }
  }

  return {
    code,
    displayId: formatLeaderboardId(name, code),
    brandName: name,
  };
}
