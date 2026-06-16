import { fetchGameManifest } from '../api/client.js';
import { dbg, dbgError } from './debug.js';

const REQUIRE_SIGNATURE = (import.meta.env.VITE_MANIFEST_REQUIRE_SIGNATURE ?? 'false') === 'true';

const specifierLoaders = {
  '@fc/game-templates/match/MatchGameRuntime.js': () => import('@fc/game-templates/match/MatchGameRuntime.js'),
  '@fc/game-templates/memory/MemoryMatchRuntime.js': () => import('@fc/game-templates/memory/MemoryMatchRuntime.js'),
  '@fc/game-templates/rps/RpsChoiceRuntime.js': () => import('@fc/game-templates/rps/RpsChoiceRuntime.js'),
  '@fc/game-templates/merge2048/Merge2048Runtime.js': () => import('@fc/game-templates/merge2048/Merge2048Runtime.js'),
  '@fc/game-templates/slice/SliceBlocksRuntime.js': () => import('@fc/game-templates/slice/SliceBlocksRuntime.js'),
  '@fc/game-templates/dodge/DodgePlaneRuntime.js': () => import('@fc/game-templates/dodge/DodgePlaneRuntime.js'),
  '@fc/game-templates/bridge/BridgeCrossRuntime.js': () => import('@fc/game-templates/bridge/BridgeCrossRuntime.js'),
};

const defaultRuntimeSpecifiers = {
  MatchGameRuntime: '@fc/game-templates/match/MatchGameRuntime.js',
  MemoryMatchRuntime: '@fc/game-templates/memory/MemoryMatchRuntime.js',
  RpsChoiceRuntime: '@fc/game-templates/rps/RpsChoiceRuntime.js',
  Merge2048Runtime: '@fc/game-templates/merge2048/Merge2048Runtime.js',
  SliceBlocksRuntime: '@fc/game-templates/slice/SliceBlocksRuntime.js',
  DodgePlaneRuntime: '@fc/game-templates/dodge/DodgePlaneRuntime.js',
  BridgeCrossRuntime: '@fc/game-templates/bridge/BridgeCrossRuntime.js',
};

let manifestReady = false;
let manifestTouchId = null;
let manifestMap = new Map();
let inflightManifest = null;
const manifestListeners = new Set();

function notifyManifestListeners() {
  manifestListeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      dbgError('[FCDBG][RuntimeRegistry] manifest listener failed', err);
    }
  });
}

export function subscribeRuntimeManifest(listener) {
  manifestListeners.add(listener);
  return () => {
    manifestListeners.delete(listener);
  };
}

function resetManifestRegistry() {
  manifestReady = false;
  manifestTouchId = null;
  manifestMap = new Map();
  inflightManifest = null;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hasWebCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

async function sha256Hex(content) {
  if (!hasWebCrypto()) {
    throw new Error('Web Crypto API unavailable (HTTPS required for integrity checks)');
  }
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

function normalizePem(value) {
  return value ? value.replace(/\\n/g, '\n').trim() : '';
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  return decodeBase64(body).buffer;
}

async function verifyManifestSignature(document) {
  const signature = document?.signature;
  if (!signature || signature.algorithm === 'none') return !REQUIRE_SIGNATURE;
  if (!hasWebCrypto()) {
    dbg('[FCDBG][RuntimeRegistry] skipping signature verify (no Web Crypto, HTTP context)');
    return !REQUIRE_SIGNATURE;
  }
  if (signature.algorithm !== 'rsa-sha256') return false;
  const publicKeyPem = normalizePem(import.meta.env.VITE_MANIFEST_PUBLIC_KEY_PEM ?? '');
  if (!publicKeyPem) return !REQUIRE_SIGNATURE;

  const key = await crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(publicKeyPem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  );
  const payload = stableStringify(document.payload);
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64(signature.value),
    new TextEncoder().encode(payload),
  );
}

async function verifyEntryIntegrity(entry) {
  if (!hasWebCrypto()) {
    dbg('[FCDBG][RuntimeRegistry] skipping integrity verify (no Web Crypto, HTTP context)');
    return !REQUIRE_SIGNATURE;
  }
  for (const variant of [entry.selected, entry.fallback]) {
    if (!variant?.moduleSpecifier || !variant?.version || !variant?.fileSha256 || !variant?.integrity) {
      return false;
    }
    const input = `${entry.runtimeComponent}|${variant.moduleSpecifier}|${variant.version}|${variant.fileSha256}`;
    const expected = await sha256Hex(input);
    if (expected !== variant.integrity) return false;
  }
  return true;
}

async function applyManifestDocument(document) {
  const signatureOk = await verifyManifestSignature(document);
  if (!signatureOk) {
    throw new Error('Runtime manifest signature verification failed');
  }

  const next = new Map();
  for (const entry of document?.payload?.entries ?? []) {
    const integrityOk = await verifyEntryIntegrity(entry);
    if (!integrityOk) {
      throw new Error(`Runtime manifest integrity failed: ${entry.runtimeComponent}`);
    }
    next.set(entry.runtimeComponent, entry);
  }
  manifestMap = next;
  manifestReady = true;
  notifyManifestListeners();
}

async function tryLoad(specifier) {
  const loader = specifierLoaders[specifier];
  if (!loader) throw new Error(`Unknown runtime module specifier: ${specifier}`);
  const mod = await loader();
  return { default: mod.default };
}

export async function preloadRuntimeManifest(touchId) {
  if (manifestReady && manifestTouchId === touchId) return;
  if (manifestReady && manifestTouchId !== touchId) {
    resetManifestRegistry();
  }
  if (inflightManifest && manifestTouchId === touchId) return inflightManifest;
  manifestTouchId = touchId;
  inflightManifest = fetchGameManifest(touchId)
    .then((document) => applyManifestDocument(document))
    .then(() => {
      dbg('[FCDBG][RuntimeRegistry] manifest loaded', {
        touchId,
        entries: manifestMap.size,
      });
    })
    .catch((err) => {
      dbgError('[FCDBG][RuntimeRegistry] manifest load failed', err);
      resetManifestRegistry();
      throw err;
    })
    .finally(() => {
      inflightManifest = null;
    });
  return inflightManifest;
}

export function ensureRuntimesRegistered() {
  // 保持向后兼容:新架构按需加载,不再执行全量注册。
}

export function getRuntimeManifestEntry(component) {
  return manifestMap.get(component) ?? null;
}

export function getRuntime(component) {
  return async () => {
    const entry = manifestMap.get(component);
    if (entry) {
      try {
        return await tryLoad(entry.selected.moduleSpecifier);
      } catch (err) {
        dbgError('[FCDBG][RuntimeRegistry] selected runtime load failed, fallback', {
          component,
          version: entry.selected?.version,
          err,
        });
        return tryLoad(entry.fallback.moduleSpecifier);
      }
    }

    const fallbackSpecifier = defaultRuntimeSpecifiers[component];
    if (!fallbackSpecifier) return undefined;
    return tryLoad(fallbackSpecifier);
  };
}
