const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/i;

const DEFAULT_ALLOWED_HOSTS = ['amzn-s3-fc-bucket.s3.sa-east-1.amazonaws.com', 's3.sa-east-1.amazonaws.com'];

export function allowedBrandAssetHosts() {
  const fromEnv = process.env.BRAND_ASSET_PROXY_HOSTS?.trim();
  if (!fromEnv) return DEFAULT_ALLOWED_HOSTS;
  return fromEnv
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function isBrandAssetProxyUrl(raw) {
  try {
    const parsed = new URL(raw.trim());
    return parsed.pathname.endsWith('/api/brand-asset') && parsed.searchParams.has('url');
  } catch {
    return false;
  }
}

export function unwrapBrandAssetProxyUrl(raw) {
  let current = raw.trim();
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

export function isAllowedBrandAssetUrl(raw) {
  const target = unwrapBrandAssetProxyUrl(raw);
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(hostname)) return false;
  const allowed = allowedBrandAssetHosts();
  return allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export async function fetchBrandAsset(targetUrl) {
  const upstream = await fetch(targetUrl, {
    headers: { accept: 'image/*,*/*;q=0.8' },
    cache: 'no-store',
  });
  if (!upstream.ok) {
    const err = new Error(`upstream responded ${upstream.status}`);
    err.statusCode = 502;
    throw err;
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const body = Buffer.from(await upstream.arrayBuffer());
  return { contentType, body };
}
