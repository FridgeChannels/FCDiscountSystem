import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const RUNTIME_CATALOG = [
  {
    runtimeComponent: 'MatchGameRuntime',
    moduleSpecifier: '@fc/game-templates/match/MatchGameRuntime.js',
    sourceFile: 'packages/game-templates/src/match/MatchGameRuntime.tsx',
  },
  {
    runtimeComponent: 'MemoryMatchRuntime',
    moduleSpecifier: '@fc/game-templates/memory/MemoryMatchRuntime.js',
    sourceFile: 'packages/game-templates/src/memory/MemoryMatchRuntime.tsx',
  },
  {
    runtimeComponent: 'RpsChoiceRuntime',
    moduleSpecifier: '@fc/game-templates/rps/RpsChoiceRuntime.js',
    sourceFile: 'packages/game-templates/src/rps/RpsChoiceRuntime.tsx',
  },
  {
    runtimeComponent: 'Merge2048Runtime',
    moduleSpecifier: '@fc/game-templates/merge2048/Merge2048Runtime.js',
    sourceFile: 'packages/game-templates/src/merge2048/Merge2048Runtime.tsx',
  },
  {
    runtimeComponent: 'SliceBlocksRuntime',
    moduleSpecifier: '@fc/game-templates/slice/SliceBlocksRuntime.js',
    sourceFile: 'packages/game-templates/src/slice/SliceBlocksRuntime.tsx',
  },
  {
    runtimeComponent: 'DodgePlaneRuntime',
    moduleSpecifier: '@fc/game-templates/dodge/DodgePlaneRuntime.js',
    sourceFile: 'packages/game-templates/src/dodge/DodgePlaneRuntime.tsx',
  },
  {
    runtimeComponent: 'BridgeCrossRuntime',
    moduleSpecifier: '@fc/game-templates/bridge/BridgeCrossRuntime.js',
    sourceFile: 'packages/game-templates/src/bridge/BridgeCrossRuntime.tsx',
  },
];

const manifestCache = new Map();

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function normalizePem(value) {
  return value ? value.replace(/\\n/g, '\n').trim() : '';
}

function resolveFcRoot() {
  if (process.env.FC_PLATFORM_ROOT) return path.resolve(process.env.FC_PLATFORM_ROOT);
  const candidates = [
    path.resolve(projectRoot, '../fc-platform'),
    path.resolve(projectRoot, '../../Downloads/fc-platform'),
    path.resolve(projectRoot, '../../fc-platform'),
  ];
  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'packages/game-templates/src')),
  );
  if (!found) {
    throw new Error(
      'Cannot locate fc-platform. Set FC_PLATFORM_ROOT=/absolute/path/to/fc-platform',
    );
  }
  return found;
}

function hashTouchId(touchId) {
  const digest = sha256Hex(String(touchId || 'anonymous'));
  return Number.parseInt(digest.slice(0, 8), 16) % 100;
}

function parseCanaryRuntimeSet() {
  const raw = process.env.MANIFEST_CANARY_RUNTIMES ?? 'DodgePlaneRuntime,BridgeCrossRuntime';
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseRolloutOverrides() {
  const raw = process.env.MANIFEST_CANARY_ROLLOUTS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildVariant(runtime, channel, version, rolloutPercent, fileSha256) {
  const integrityPayload = `${runtime.runtimeComponent}|${runtime.moduleSpecifier}|${version}|${fileSha256}`;
  return {
    channel,
    version,
    rolloutPercent,
    moduleSpecifier: runtime.moduleSpecifier,
    fileSha256,
    integrity: sha256Hex(integrityPayload),
  };
}

function buildRuntimeEntry(runtime, fcRoot) {
  const stableVersion = process.env.MANIFEST_STABLE_VERSION ?? '1.0.0';
  const canaryVersion = process.env.MANIFEST_CANARY_VERSION ?? '1.1.0';
  const defaultCanaryPercent = Number.parseInt(
    process.env.MANIFEST_CANARY_DEFAULT_PERCENT ?? '20',
    10,
  );
  const rolloutOverrides = parseRolloutOverrides();
  const canaryRuntimes = parseCanaryRuntimeSet();
  const sourcePath = path.join(fcRoot, runtime.sourceFile);
  const fileSha256 = sha256Hex(fs.readFileSync(sourcePath));

  const variants = [];
  variants.push(buildVariant(runtime, 'stable', stableVersion, 100, fileSha256));

  if (canaryRuntimes.has(runtime.runtimeComponent)) {
    const rolloutPercent = Math.max(
      0,
      Math.min(
        100,
        Number.parseInt(
          String(rolloutOverrides[runtime.runtimeComponent] ?? defaultCanaryPercent),
          10,
        ) || 0,
      ),
    );
    if (rolloutPercent > 0) {
      variants.push(buildVariant(runtime, 'canary', canaryVersion, rolloutPercent, fileSha256));
    }
  }

  return {
    runtimeComponent: runtime.runtimeComponent,
    fallbackVersion: stableVersion,
    variants,
  };
}

function pickVariant(entry, touchId) {
  const bucket = hashTouchId(touchId);
  const canary = entry.variants.find((variant) => variant.channel === 'canary');
  const stable = entry.variants.find((variant) => variant.channel === 'stable');
  if (canary && bucket < canary.rolloutPercent) {
    return {
      selected: canary,
      selectedBy: `canary(${canary.rolloutPercent}%)`,
      fallback: stable ?? canary,
    };
  }
  return {
    selected: stable ?? canary,
    selectedBy: 'stable',
    fallback: stable ?? canary,
  };
}

function signPayload(canonicalPayload) {
  const privateKeyPem = normalizePem(process.env.MANIFEST_PRIVATE_KEY_PEM ?? '');
  if (!privateKeyPem) {
    return {
      algorithm: 'none',
      keyId: process.env.MANIFEST_SIGNING_KEY_ID ?? 'none',
      value: '',
    };
  }
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(canonicalPayload), privateKeyPem)
    .toString('base64');
  return {
    algorithm: 'rsa-sha256',
    keyId: process.env.MANIFEST_SIGNING_KEY_ID ?? 'local-rsa',
    value: signature,
  };
}

function buildManifestDocument(touchId) {
  const fcRoot = resolveFcRoot();
  const entries = RUNTIME_CATALOG.map((runtime) => buildRuntimeEntry(runtime, fcRoot)).map((entry) => {
    const pick = pickVariant(entry, touchId);
    return {
      runtimeComponent: entry.runtimeComponent,
      fallbackVersion: entry.fallbackVersion,
      selectedBy: pick.selectedBy,
      selected: pick.selected,
      fallback: pick.fallback,
      variants: entry.variants,
    };
  });

  const payload = {
    schemaVersion: 1,
    issuedAt: new Date().toISOString(),
    ttlSeconds: Number.parseInt(process.env.MANIFEST_TTL_SECONDS ?? '30', 10),
    touchId,
    entries,
  };
  const canonicalPayload = stableStringify(payload);
  const signature = signPayload(canonicalPayload);
  const etag = `"${sha256Hex(`${canonicalPayload}:${signature.value}`).slice(0, 32)}"`;
  return { payload, signature, etag };
}

export function getRuntimeManifest(touchId) {
  const key = String(touchId || 'anonymous');
  const now = Date.now();
  const cached = manifestCache.get(key);
  if (cached && cached.expiresAt > now) return cached.document;

  const document = buildManifestDocument(key);
  const ttlMs =
    Math.max(5, Number.parseInt(String(document.payload.ttlSeconds || 30), 10)) * 1000;
  manifestCache.set(key, { document, expiresAt: now + ttlMs });
  return document;
}

export function validateManifestEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.runtimeComponent || !entry.selected || !entry.fallback) return false;
  for (const target of [entry.selected, entry.fallback]) {
    if (!target.version || !target.moduleSpecifier || !target.fileSha256 || !target.integrity) {
      return false;
    }
    const recalculated = sha256Hex(
      `${entry.runtimeComponent}|${target.moduleSpecifier}|${target.version}|${target.fileSha256}`,
    );
    if (target.integrity !== recalculated) return false;
  }
  return true;
}

