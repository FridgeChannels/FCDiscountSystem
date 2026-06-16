function resolvePublicIframeUrl(iframeUrl) {
  if (!iframeUrl || typeof iframeUrl !== 'string') return iframeUrl;

  const shellBase = (import.meta.env.VITE_RUNTIME_SHELL_BASE_URL || '').replace(/\/$/, '');
  const pageOrigin = (
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
  ).replace(/\/$/, '');

  try {
    const parsed = new URL(iframeUrl, shellBase || pageOrigin || undefined);
    const pathWithSearch = `${parsed.pathname}${parsed.search}`;

    // Paths proxied by nginx / vite dev server — load same-origin to avoid cross-origin iframe sizing bugs.
    const sameOriginPaths = ['/runtime-shell/', '/uploaded-games/', '/brand-assets/', '/_next/'];
    if (pageOrigin && sameOriginPaths.some((prefix) => parsed.pathname.startsWith(prefix))) {
      return `${pageOrigin}${pathWithSearch}`;
    }

    // Production: runtime shell is reverse-proxied on the same public host as the coupon app.
    if (shellBase && pageOrigin && shellBase === pageOrigin) {
      return `${pageOrigin}${pathWithSearch}`;
    }

    // Dev / explicit shell host (e.g. platform-web on :8789).
    if (shellBase) {
      return `${shellBase}${pathWithSearch}`;
    }

    // Fallback: same-origin path (requires dev proxy for /runtime-shell/).
    if (pageOrigin) {
      return `${pageOrigin}${pathWithSearch}`;
    }

    return iframeUrl;
  } catch {
    return iframeUrl;
  }
}

export function getRuntimeLoadConfig(_runtimeComponent, manifestEntry) {
  if (manifestEntry?.loadMode === 'iframe' && manifestEntry.iframeUrl && manifestEntry.allowedOrigin) {
    const iframeUrl = resolvePublicIframeUrl(manifestEntry.iframeUrl);
    return {
      loadMode: 'iframe',
      iframeUrl,
      allowedOrigin: new URL(iframeUrl).origin,
    };
  }

  return { loadMode: 'inline' };
}
