function resolvePublicIframeUrl(iframeUrl) {
  if (!iframeUrl || typeof iframeUrl !== 'string') return iframeUrl;

  const runtimeBase = (
    (typeof window !== 'undefined' && window.location?.origin)
    || import.meta.env.VITE_RUNTIME_SHELL_BASE_URL
    || ''
  ).replace(/\/$/, '');

  if (!runtimeBase) return iframeUrl;

  try {
    const { pathname, search } = new URL(iframeUrl, runtimeBase);
    return `${runtimeBase}${pathname}${search}`;
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
