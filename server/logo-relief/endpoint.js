import { fork } from 'node:child_process';
import { assertIllustrationAccess, ILLUSTRATION_TIMEOUT_MS, renderIllustration } from './illustration.js';

const MAX_BYTES = 1024 * 1024;
const FORMATS = new Map([
  ['image/svg+xml', 'svg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/jpeg', 'jpeg'],
]);
let active = 0;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function optionsFrom(req, query) {
  const mime = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
  const inputFormat = FORMATS.get(mime);
  if (!inputFormat) throw new RequestError(415, 'Use image/svg+xml, image/png, image/webp or image/jpeg.');
  const format = query.get('format') ?? 'webp';
  const style = query.get('style') ?? 'auto';
  if (!['auto', 'silhouette', 'flat', 'illustration'].includes(style)) {
    throw new RequestError(400, 'style must be auto, silhouette, flat or illustration.');
  }
  const background = query.get('background') ?? 'auto';
  const size = Number(query.get('size') ?? 900);
  const color = query.get('color')?.replace(/^#/, '') ?? null;
  if (!['png', 'webp'].includes(format)) throw new RequestError(400, 'format must be png or webp.');
  if (!Number.isInteger(size) || size < 128 || size > 1200) throw new RequestError(400, 'size must be an integer from 128 to 1200.');
  if (color !== null && !/^[0-9a-f]{6}$/i.test(color)) throw new RequestError(400, 'color must contain six hex digits.');
  if (!['auto', 'keep'].includes(background)) throw new RequestError(400, 'background must be auto or keep.');
  return { inputFormat, format, size, color, background, style };
}

async function readLogo(req) {
  const tooLarge = () => new RequestError(413, 'Maximum upload is 1 MiB.');
  if (Number(req.headers['content-length']) > MAX_BYTES) throw tooLarge();
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  if (!bytes) throw new RequestError(400, 'Send the logo file as the request body.');
  return Buffer.concat(chunks, bytes);
}

function checkType(input, format) {
  if (format === 'svg') {
    const xml = input.toString('utf8').trimStart();
    if (!xml.startsWith('<') || !/<svg[\s>]/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
      throw new RequestError(422, 'Supply a UTF-8 SVG without a DTD.');
    }
    return;
  }
  const valid = format === 'png' ? input.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : format === 'jpeg' ? input[0] === 255 && input[1] === 216
    : input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new RequestError(422, 'Image does not match its Content-Type.');
}

async function runWorker(input, options, signal) {
  signal.throwIfAborted();
  const child = fork(new URL('./worker.js', import.meta.url), [], {
    serialization: 'advanced', execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let timer;
  let cancel;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new RequestError(503, 'Logo render timed out. Try a simpler source.')), 15000);
      cancel = () => reject(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Logo renderer stopped early.')));
      child.on('message', reply => {
        if (!['rendered', 'illustration'].includes(reply?.type)) return;
        if (reply.error) reject(new RequestError(reply.status, reply.error));
        else if (Buffer.isBuffer(reply.image) && reply.image.length) resolve(reply);
        else reject(new Error('Empty logo renderer response.'));
      });
      child.send({ input, options }, error => { if (error) reject(error); });
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    child.kill('SIGKILL');
  }
}

export async function handleLogoRelief(req, res, query, { sendJson, sendBinary }) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Use POST to upload a logo.' }, { allow: 'POST, OPTIONS' });
  }
  if (active >= 2) {
    req.resume();
    return sendJson(res, 429, { error: 'Logo renderer is busy.' }, { 'retry-after': '2' });
  }
  active++;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let aiEdit = false;
  res.once('close', cancel);
  try {
    const options = optionsFrom(req, query);
    const input = await readLogo(req);
    checkType(input, options.inputFormat);
    if (options.style === 'illustration') assertIllustrationAccess(req.headers.authorization);
    let result = await runWorker(input, options, controller.signal);
    if (result.style === 'illustration') {
      assertIllustrationAccess(req.headers.authorization);
      aiEdit = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(ILLUSTRATION_TIMEOUT_MS)]);
      result = await renderIllustration(result.image, options, signal);
    }
    if (res.destroyed) return;
    const { image, style } = result;
    sendBinary(res, 200, image, 'image/' + options.format, {
      'cache-control': 'no-store',
      'x-logo-style': style,
      'x-logo-renderer': result.renderer || 'local',
      ...(result.model ? { 'x-logo-model': result.model } : {}),
      'access-control-expose-headers': 'X-Logo-Style, X-Logo-Renderer, X-Logo-Model',
    });
  } catch (error) {
    req.resume();
    if (res.destroyed) return;
    const timeout = error.name === 'TimeoutError';
    sendJson(res, error.status || (timeout ? 504 : 502), {
      error: error.status ? error.message : timeout ? 'Logo image edit timed out.' : 'Logo rendering failed.',
    }, aiEdit ? {
      'x-logo-style': 'illustration', 'x-logo-renderer': 'ai',
      'access-control-expose-headers': 'X-Logo-Style, X-Logo-Renderer',
    } : {});
  } finally {
    res.removeListener('close', cancel);
    active--;
  }
}
