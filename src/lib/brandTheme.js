/** Resolve shell + in-game brand display from customerBrand and gameStart.brandTheme. */

function runtimeBaseUrl() {
  return import.meta.env.VITE_RUNTIME_SHELL_BASE_URL || 'http://localhost:8789';
}

/** Prefer same-origin in browser so /api/brand-asset hits the app proxy (BFF), not fc-platform web. */
function assetBaseUrl(fallbackBaseUrl = runtimeBaseUrl()) {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return String(fallbackBaseUrl || '').replace(/\/$/, '');
}

function isBrandAssetProxyUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.pathname.endsWith('/api/brand-asset') && parsed.searchParams.has('url');
  } catch {
    return false;
  }
}

function unwrapBrandAssetProxyUrl(url) {
  let current = url.trim();
  for (let i = 0; i < 4; i += 1) {
    if (!isBrandAssetProxyUrl(current)) return current;
    try {
      const inner = new URL(current).searchParams.get('url')?.trim();
      if (!inner) return current;
      current = inner;
    } catch {
      return current;
    }
  }
  return current;
}

export function normalizeLogoUrl(url, baseUrl = assetBaseUrl()) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) return trimmed;
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (
    trimmed.startsWith('http://')
    || trimmed.startsWith('https://')
  ) {
    const remote = unwrapBrandAssetProxyUrl(trimmed);
    try {
      const parsed = new URL(remote);
      if (parsed.origin === new URL(`${base}/`).origin) return remote;
      return `${base}/api/brand-asset?url=${encodeURIComponent(remote)}`;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith('/')) return `${base}${trimmed}`;
  const file = trimmed === 'clovia_logo.png' ? 'clovia-logo.svg' : trimmed;
  return `${base}/brand-assets/${file}`;
}

/**
 * magnet_brand_param overrides customerBrand when fields are present.
 * Color mapping (magnet_brand_param):
 *   primaryColor (primary_color)   → page background  (--bg-color)
 *   secondaryColor (second_color)  → button background (--brand-primary)
 * When no magnet param is present we fall back to the legacy behavior where
 * customerBrand.primaryColor drives the button color only (no background override).
 */
export function mergeBrand(customerBrand, magnetBrandParam) {
  const customer = customerBrand && typeof customerBrand === 'object' ? customerBrand : {};
  const param = magnetBrandParam && typeof magnetBrandParam === 'object' ? magnetBrandParam : null;
  const baseUrl = assetBaseUrl();

  if (!param) {
    return {
      name: customer.name || null,
      logoUrl: normalizeLogoUrl(customer.logoUrl, baseUrl),
      primaryColor: customer.primaryColor || null, // legacy: → button color
      backgroundColor: null,
      buttonColor: null,
      shopUrl: customer.shopUrl ?? '#',
    };
  }

  return {
    name: param.brandName ?? customer.name ?? null,
    logoUrl: normalizeLogoUrl(param.logoUrl ?? param.brandLogo ?? customer.logoUrl, baseUrl),
    primaryColor: null,
    backgroundColor: param.primaryColor ?? null, // primary_color → page background
    buttonColor: param.secondaryColor ?? null, // second_color → button background
    shopUrl: param.shopUrl ?? param.storeWebsite ?? customer.shopUrl ?? '#',
  };
}

export function brandFromMagnetParam(magnetBrandParam) {
  return mergeBrand(null, magnetBrandParam);
}

/** True when magnet_brand_param marks this magnet as sample/demo. */
export function isSampleMagnetParam(magnetBrandParam) {
  if (!magnetBrandParam || typeof magnetBrandParam !== 'object') return false;
  if (magnetBrandParam.isSample === true) return true;
  const sample = magnetBrandParam.sample;
  return sample === 1 || sample === true || sample === '1';
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** WCAG relative luminance (0 = black, 1 = white). */
function relativeLuminance({ r, g, b }) {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Returns readable foreground (dark or light) for a given background hex. */
function readableTextOn(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return relativeLuminance(rgb) > 0.5 ? '#1d211b' : '#ffffff';
}

/** Darken a hex color by a ratio (0–1) for hover/active states. */
function darken(hex, ratio = 0.12) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const d = (c) => Math.max(0, Math.round(c * (1 - ratio)));
  const hh = (c) => d(c).toString(16).padStart(2, '0');
  return `#${hh(rgb.r)}${hh(rgb.g)}${hh(rgb.b)}`;
}

/**
 * Apply brand colors to document-level CSS variables.
 *  - buttonColor (or legacy primaryColor) → --brand-primary (+ hover + readable text)
 *  - backgroundColor                      → --bg-color (+ readable on-bg text)
 */
export function applyBrandTheme(brand) {
  if (!brand || typeof document === 'undefined') return;
  const root = document.documentElement.style;

  const buttonColor = brand.buttonColor || brand.primaryColor;
  if (buttonColor) {
    root.setProperty('--brand-primary', buttonColor);
    root.setProperty('--brand-primary-hover', darken(buttonColor, 0.12));
    const onButton = readableTextOn(buttonColor);
    if (onButton) root.setProperty('--brand-on-primary', onButton);
  }

  if (brand.backgroundColor) {
    root.setProperty('--bg-color', brand.backgroundColor);
    const onBg = readableTextOn(brand.backgroundColor);
    if (onBg) root.setProperty('--on-bg-color', onBg);
  }
}

/** @deprecated kept for back-compat; prefer applyBrandTheme(brand). */
export function applyBrandCssVar(primaryColor) {
  applyBrandTheme({ buttonColor: primaryColor });
}

export function resolveBrandDisplay(customerBrand, gameBrandTheme) {
  const customer = customerBrand && typeof customerBrand === 'object' ? customerBrand : {};
  const theme = gameBrandTheme && typeof gameBrandTheme === 'object' ? gameBrandTheme : {};
  const baseUrl = assetBaseUrl();

  const rawLogo = theme.logoUrl || theme.logo || customer.logoUrl || null;
  const logoUrl = normalizeLogoUrl(rawLogo, baseUrl);
  const primary = theme.primary || theme.brand_color || customer.primaryColor || null;
  const name = customer.name || theme.name || null;

  return { logoUrl, primary, name };
}

/** Map Tap shell brand (mergeBrand output) to in-game brandTheme fields. */
export function shellBrandToGameTheme(brand) {
  if (!brand || typeof brand !== 'object') return null;
  const accent = brand.buttonColor || brand.primaryColor || null;
  const backgroundColor = brand.backgroundColor || null;
  const logoUrl = brand.logoUrl || null;
  const name = brand.name || null;
  if (!accent && !backgroundColor && !logoUrl && !name) return null;
  return {
    ...(name ? { name } : {}),
    ...(accent ? { primary: accent, brand_color: accent } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(logoUrl ? { logoUrl, logo: logoUrl } : {}),
  };
}

/** Prefer page shell brand over engine payload for logo/colors (same magnet source). */
export function applyShellBrandToGameStart(start, brand) {
  if (!start || typeof start !== 'object') return start;
  const shell = shellBrandToGameTheme(brand);
  if (!shell) return start;
  const engineTheme = start.brandTheme && typeof start.brandTheme === 'object' ? start.brandTheme : {};
  return {
    ...start,
    brandTheme: { ...engineTheme, ...shell },
  };
}
