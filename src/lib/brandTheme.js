/** Resolve shell + in-game brand display from customerBrand and gameStart.brandTheme. */

function runtimeBaseUrl() {
  return import.meta.env.VITE_RUNTIME_SHELL_BASE_URL || 'http://localhost:8789';
}

export function normalizeLogoUrl(url, baseUrl = runtimeBaseUrl()) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (
    trimmed.startsWith('http://')
    || trimmed.startsWith('https://')
    || trimmed.startsWith('data:')
  ) {
    return trimmed;
  }
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (trimmed.startsWith('/')) return `${base}${trimmed}`;
  const file = trimmed === 'clovia_logo.png' ? 'clovia-logo.svg' : trimmed;
  return `${base}/brand-assets/${file}`;
}

/** magnet_brand_param overrides customerBrand when fields are present. */
export function mergeBrand(customerBrand, magnetBrandParam) {
  const customer = customerBrand && typeof customerBrand === 'object' ? customerBrand : {};
  const param = magnetBrandParam && typeof magnetBrandParam === 'object' ? magnetBrandParam : null;
  const baseUrl = runtimeBaseUrl();

  if (!param) {
    return {
      name: customer.name || null,
      logoUrl: normalizeLogoUrl(customer.logoUrl, baseUrl),
      primaryColor: customer.primaryColor || null,
      shopUrl: customer.shopUrl ?? '#',
    };
  }

  return {
    name: param.brandName ?? customer.name ?? null,
    logoUrl: normalizeLogoUrl(param.logoUrl ?? param.brandLogo ?? customer.logoUrl, baseUrl),
    primaryColor: param.primaryColor ?? customer.primaryColor ?? null,
    shopUrl: param.shopUrl ?? param.storeWebsite ?? customer.shopUrl ?? '#',
  };
}

export function brandFromMagnetParam(magnetBrandParam) {
  return mergeBrand(null, magnetBrandParam);
}

export function applyBrandCssVar(primaryColor) {
  if (primaryColor) {
    document.documentElement.style.setProperty('--brand-primary', primaryColor);
  }
}

export function resolveBrandDisplay(customerBrand, gameBrandTheme) {
  const customer = customerBrand && typeof customerBrand === 'object' ? customerBrand : {};
  const theme = gameBrandTheme && typeof gameBrandTheme === 'object' ? gameBrandTheme : {};
  const baseUrl = runtimeBaseUrl();

  const rawLogo = theme.logoUrl || theme.logo || customer.logoUrl || null;
  const logoUrl = normalizeLogoUrl(rawLogo, baseUrl);
  const primary = theme.primary || theme.brand_color || customer.primaryColor || null;
  const name = customer.name || theme.name || null;

  return { logoUrl, primary, name };
}
