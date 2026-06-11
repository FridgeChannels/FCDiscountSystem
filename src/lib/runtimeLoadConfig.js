export function getRuntimeLoadConfig(_runtimeComponent, manifestEntry) {
  if (manifestEntry?.loadMode === 'iframe' && manifestEntry.iframeUrl && manifestEntry.allowedOrigin) {
    return {
      loadMode: 'iframe',
      iframeUrl: manifestEntry.iframeUrl,
      allowedOrigin: manifestEntry.allowedOrigin,
    };
  }

  return { loadMode: 'inline' };
}
