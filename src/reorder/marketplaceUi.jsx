import { useEffect, useRef, useState } from 'react';
import { getCouponCode, isSafeAmazonUrl } from './domain.js';
import { emitTelemetry, markClaimCodeCopied } from './reorderService.js';

const productVisualCache = new Map();

async function fetchProductImageBlob(imageUrl) {
  const readImage = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Product image request failed (${response.status}).`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('The product image URL did not return an image.');
    return blob;
  };
  const target = new URL(imageUrl, window.location.href);
  if (target.origin === window.location.origin) return readImage(target.href, { credentials: 'same-origin' });
  const proxyUrl = `/api/brand-asset?url=${encodeURIComponent(target.href)}`;
  const isAwsS3 = target.hostname === 'amazonaws.com' || target.hostname.endsWith('.amazonaws.com');
  const readProxy = () => readImage(proxyUrl, { credentials: 'same-origin' });
  const readDirect = () => readImage(target.href, { mode: 'cors', credentials: 'omit' });

  if (isAwsS3) {
    try { return await readProxy(); }
    catch { return readDirect(); }
  }
  try { return await readDirect(); }
  catch (directError) {
    try { return await readProxy(); }
    catch { throw directError; }
  }
}

async function makeQuickWhiteCutout(blob) {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const count = width * height;
  const candidates = new Uint8Array(count);
  const background = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let index = 0; index < count; index += 1) {
    const pixel = index * 4;
    const red = pixels[pixel];
    const green = pixels[pixel + 1];
    const blue = pixels[pixel + 2];
    if (Math.min(red, green, blue) >= 252 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 12) candidates[index] = 1;
  }

  let read = 0;
  let write = 0;
  const enqueue = (index) => {
    if (!background[index] && candidates[index]) {
      background[index] = 1;
      queue[write++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (read < write) {
    const index = queue[read++];
    const x = index % width;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index + width < count) enqueue(index + width);
  }

  for (let index = 0; index < count; index += 1) {
    const pixel = index * 4;
    if (background[index]) {
      pixels[pixel + 3] = 0;
      continue;
    }
    const x = index % width;
    const touchesBackground = (x > 0 && background[index - 1])
      || (x + 1 < width && background[index + 1])
      || (index >= width && background[index - width])
      || (index + width < count && background[index + width]);
    if (!touchesBackground) continue;
    const colorSpread = Math.max(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]) - Math.min(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]);
    if (colorSpread < 18) continue;
    const coverage = (255 - Math.min(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2])) / 255;
    if (coverage < 0.08) {
      pixels[pixel + 3] = 0;
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[pixel + channel] = Math.max(0, Math.min(255, Math.round((pixels[pixel + channel] - 255 * (1 - coverage)) / coverage)));
    }
    pixels[pixel + 3] = Math.round(coverage * 255);
  }
  context.putImageData(image, 0, 0);
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 12) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right <= left || bottom <= top) throw new Error('No product subject was detected in this image.');
  const padding = Math.round(Math.max(right - left, bottom - top) * 0.035);
  const cropX = Math.max(0, left - padding);
  const cropY = Math.max(0, top - padding);
  const cropRight = Math.min(width, right + padding + 1);
  const cropBottom = Math.min(height, bottom + padding + 1);
  const cropped = document.createElement('canvas');
  cropped.width = cropRight - cropX;
  cropped.height = cropBottom - cropY;
  cropped.getContext('2d').drawImage(canvas, cropX, cropY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return new Promise((resolve, reject) => cropped.toBlob((result) => result ? resolve(result) : reject(new Error('Could not prepare the product preview.')), 'image/png'));
}

export function Icon({ name, size = 24 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === 'copy') return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
  if (name === 'location') return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (name === 'check') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
  if (name === 'calendar') return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
  if (name === 'box') return <svg {...common}><path d="m4 7 8-4 8 4v10l-8 4-8-4Z" /><path d="m4 7 8 4 8-4M12 11v10" /></svg>;
  if (name === 'person') return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>;
  if (name === 'ticket') return <svg {...common}><path d="M4 7a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4Z" /><path d="M12 8v8" /></svg>;
  if (name === 'store') return <svg {...common}><path d="M4 10h16v10H4Z" /><path d="M3 10 5 4h14l2 6M7 14h4v6H7Z" /></svg>;
  if (name === 'lock') return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  return null;
}

export function BrandWordmark({ brand }) {
  if (brand.logoImage) return <img data-entry-logo="" className="brand-logo" src={brand.logoImage} alt={brand.name} />;
  return <div className="wordmark">{brand.logoText}</div>;
}

export function MarketplaceProductHero({ product, enableAiCutout = true }) {
  const [cutoutUrl, setCutoutUrl] = useState('');
  const [cutoutFailed, setCutoutFailed] = useState(false);
  const imageUrl = product?.image || '';
  const preparedCutout = product?.visualAssets?.cutout || product?.heroImage || '';
  const scene = product?.visualAssets?.scene || product?.heroScene || {};
  useEffect(() => {
    let active = true;
    let cutoutWorker;
    let cutoutObjectUrl = '';
    let quickCutoutReady = false;
    let aiCutoutReady = false;
    setCutoutUrl('');
    setCutoutFailed(false);
    if (preparedCutout) {
      setCutoutUrl(preparedCutout);
      return undefined;
    }

    // Live marketplace skips AI/quick cutout and shows the product image as-is
    // (preview already ships prepared cutouts via visualAssets.cutout).
    if (!enableAiCutout) {
      if (imageUrl) setCutoutUrl(imageUrl);
      else setCutoutFailed(true);
      return undefined;
    }

    const cacheKey = preparedCutout || imageUrl;
    const cached = productVisualCache.get(cacheKey);
    if (cached) {
      cutoutObjectUrl = URL.createObjectURL(cached);
      setCutoutUrl(cutoutObjectUrl);
      return () => URL.revokeObjectURL(cutoutObjectUrl);
    }

    const reportError = () => {
      if (!active) return;
      setCutoutFailed(!quickCutoutReady);
    };
    if (imageUrl) {
      const requestId = `${Date.now()}-${Math.random()}`;
      if (enableAiCutout) {
        try {
          cutoutWorker = new Worker(new URL('./productCutout.worker.js', import.meta.url), { type: 'module' });
          cutoutWorker.onmessage = (event) => {
            if (!active) return;
            if (event.data?.type === 'progress') return;
            if (event.data?.id !== requestId) return;
            if (event.data.type === 'result' && event.data.blob) {
              aiCutoutReady = true;
              productVisualCache.set(cacheKey, event.data.blob);
              if (cutoutObjectUrl) URL.revokeObjectURL(cutoutObjectUrl);
              cutoutObjectUrl = URL.createObjectURL(event.data.blob);
              setCutoutUrl(cutoutObjectUrl);
              cutoutWorker.terminate();
            } else if (event.data.type === 'error') {
              reportError();
              cutoutWorker.terminate();
            }
          };
          cutoutWorker.onerror = () => { reportError(); cutoutWorker?.terminate(); };
        } catch {
          cutoutWorker = null;
          reportError();
        }
      }
      fetchProductImageBlob(imageUrl).then((blob) => {
        if (!active) return;
        if (cutoutWorker) cutoutWorker.postMessage({ id: requestId, blob });
        makeQuickWhiteCutout(blob).then((previewBlob) => {
          if (!active || aiCutoutReady) return;
          quickCutoutReady = true;
          cutoutObjectUrl = URL.createObjectURL(previewBlob);
          setCutoutUrl(cutoutObjectUrl);
        }).catch(reportError);
      }).catch(reportError);
    }
    return () => {
      active = false;
      cutoutWorker?.terminate();
      if (cutoutObjectUrl) URL.revokeObjectURL(cutoutObjectUrl);
    };
  }, [imageUrl, preparedCutout, enableAiCutout]);

  return (
    <div className="marketplace-hero__stage" style={{ '--poster-color': scene.background, '--poster-light': scene.accent }}>
      <span className="marketplace-hero__contact" aria-hidden="true" />
      {cutoutUrl && <img className="marketplace-hero__bottle" src={cutoutUrl} alt={`${product.name}, ${product.variant}`} />}
      {cutoutFailed && !cutoutUrl && imageUrl && <img className="marketplace-hero__source-image" src={imageUrl} alt={`${product.name}, ${product.variant}`} />}
    </div>
  );
}

/**
 * Amazon refuses iframe embedding (X-Frame-Options: sameorigin).
 * When this app is framed (e.g. sample.fridgechannels.com live demo), open Amazon
 * in a new tab. Standalone NFC taps keep same-tab navigation.
 */
export function openAmazonUrl(url) {
  if (!url) return;
  let inIframe = false;
  try {
    inIframe = window.self !== window.top;
  } catch {
    inIframe = true;
  }
  if (!inIframe) {
    window.location.assign(url);
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function AmazonCta({ product, brand, children, onBeforeOpen, onOpenDemo }) {
  const [opening, setOpening] = useState(false);
  const valid = isSafeAmazonUrl(product?.amazonUrl);
  const open = async () => {
    if (!valid || opening) return;
    setOpening(true);
    if (onBeforeOpen) await onBeforeOpen();
    emitTelemetry('amazon_navigation_started', { productId: product.id, destination: product.amazonUrl });
    if (onOpenDemo) {
      onOpenDemo();
      setOpening(false);
      return;
    }
    openAmazonUrl(product.amazonUrl);
    setOpening(false);
  };
  if (!valid) return <button className="amazon-button amazon-button--disabled" type="button" disabled>This purchase link is temporarily unavailable</button>;
  return <button className="amazon-button" type="button" onClick={open} disabled={opening}>{opening ? 'Opening Amazon…' : children}</button>;
}

export function useCouponCopy(coupon, fcId, productId, { live = false, feedbackDuration = 0 } = {}) {
  const [copied, setCopied] = useState(false);
  const feedbackTimer = useRef(null);
  const code = getCouponCode(coupon, fcId);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const copy = async () => {
    if (!code) return false;
    try { await navigator.clipboard.writeText(code); }
    catch {
      const field = document.createElement('textarea');
      field.value = code; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.appendChild(field); field.select(); const didCopy = document.execCommand?.('copy'); field.remove();
      if (!didCopy) return false;
    }
    setCopied(true);
    if (feedbackDuration > 0) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setCopied(false), feedbackDuration);
    }
    emitTelemetry('coupon_code_copied', { couponId: coupon.id, productId });
    if (live) markClaimCodeCopied(fcId, coupon.id);
    return true;
  };
  return { code, copied, copy };
}

export function CopyIconButton({ copied, onCopy, showLabel = false }) {
  return (
    <button
      className={copied ? 'copy-icon-button copy-icon-button--copied' : 'copy-icon-button'}
      type="button"
      aria-label={showLabel ? undefined : (copied ? 'Code copied' : 'Copy code')}
      aria-live={showLabel ? undefined : 'polite'}
      onClick={onCopy}
    >
      <Icon name={copied ? 'check' : 'copy'} size={showLabel ? 18 : 21} />
      {showLabel && <span>{copied ? 'Copied' : 'Copy code'}</span>}
    </button>
  );
}

export function CouponTerms({ coupon, product, detailed = false }) {
  const terms = coupon.terms || {};
  const validThrough = String(terms.validThrough || '').trim();
  const usageLimit = String(terms.usageLimit || '').trim();
  const stackingRule = String(terms.stackingRule || '').trim();
  const sellerName = String(terms.sellerName || '').trim();
  const productName = String(product?.name || '').trim();
  const productVariant = String(product?.variant || '').trim();
  const productScope = productName
    ? (productVariant ? `${productName} · ${productVariant} only` : `${productName} only`)
    : '';

  if (!detailed) {
    const summary = [validThrough ? `Valid through ${validThrough}` : '', usageLimit].filter(Boolean).join(' · ');
    return (
      <>
        {summary ? <span className="coupon-claim-card__terms">{summary}</span> : null}
        {stackingRule ? <span className="coupon-claim-card__terms">{stackingRule}</span> : null}
      </>
    );
  }

  const rows = [
    validThrough ? { icon: 'calendar', text: `Valid through ${validThrough}` } : null,
    productScope ? { icon: 'box', text: productScope } : null,
    usageLimit ? { icon: 'person', text: usageLimit } : null,
    stackingRule ? { icon: 'ticket', text: stackingRule } : null,
    sellerName ? { icon: 'store', text: `Sold by ${sellerName}` } : null,
  ].filter(Boolean);

  if (!rows.length) return null;
  return (
    <ul className="coupon-detail-list">
      {rows.map((row) => (
        <li key={`${row.icon}-${row.text}`}>
          <Icon name={row.icon} size={28} />
          <span>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function VoluntarySurveyCard({ survey, navigate, marketplace = false }) {
  const seconds = Math.max(10, survey.questions.length * 5);
  return <button className={`voluntary-survey-card${marketplace ? ' voluntary-survey-card--marketplace' : ''}`} type="button" onClick={() => navigate('survey', { step: 0 })}>{marketplace ? <strong>Share feedback · {survey.questions.length} questions · ~{seconds} sec</strong> : <span><strong>Quick survey</strong><small>{survey.questions.length} questions · About {seconds} seconds</small></span>}<Icon name="chevron" size={18} /></button>;
}
