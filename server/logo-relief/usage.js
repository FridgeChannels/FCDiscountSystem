import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = fileURLToPath(new URL('../../data/logo-usage/', import.meta.url));
const PRICING = {
  model: 'gpt-image-2.5-sunburst', verifiedOn: '2026-11-20', currency: 'USD',
  textInputPerMillion: 5, imageInputPerMillion: 8, imageOutputPerMillion: 30,
  source: 'https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst',
};
const count = value => Number.isSafeInteger(value) && value >= 0;

export function estimateImageCost(model, usage) {
  const text = usage?.input_tokens_details?.text_tokens;
  const image = usage?.input_tokens_details?.image_tokens;
  const output = usage?.output_tokens;
  // Images Edit uses uncached Standard prices. Unknown or incomplete usage is
  // unknown spend, never zero. Retain raw usage so rates can be revised later.
  if (model !== PRICING.model || ![text, image, output, usage?.input_tokens].every(count)
      || text + image !== usage.input_tokens
      || (usage.input_tokens_details.cached_tokens ?? 0) !== 0) return null;
  return {
    amount: Number(((text * 5 + image * 8 + output * 30) / 1_000_000).toFixed(8)),
    currency: 'USD', kind: 'estimate_not_invoice', pricing: PRICING,
  };
}

export async function appendUsageEvent(event) {
  const dir = process.env.LOGO_USAGE_LOG_DIR || DEFAULT_DIR;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await appendFile(join(dir, 'usage.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600, flush: true });
}

export async function beginImageUsage(model, sourceSha256) {
  const started = Date.now();
  const base = {
    schemaVersion: 1, id: randomUUID(), startedAt: new Date(started).toISOString(),
    endpoint: '/api/fc/brand-assets/logo-2p5d', model, sourceSha256,
    quality: 'high', size: '1024x1024', imageCount: 1,
  };
  // Refuse to start a paid request if its audit trail cannot be created.
  await appendUsageEvent({ ...base, event: 'started', usage: null, estimatedCost: null });
  return async details => {
    const event = { ...base, recordedAt: new Date().toISOString(), elapsedMs: Date.now() - started, ...details };
    try {
      await appendUsageEvent(event);
    } catch {
      // Preserve the accounting record in service logs and still deliver an
      // already-paid image if the disk becomes unavailable during generation.
      console.error('[logo-usage-persist-failed]', JSON.stringify(event));
    }
  };
}
