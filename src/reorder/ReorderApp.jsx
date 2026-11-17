import { useCallback, useEffect, useRef, useState } from 'react';
import { composeConsumerModules, getCouponCode, isSafeAmazonUrl } from './domain.js';
import { SHIPPING_ADDRESS } from './fixtures.js';
import { clearSurveyProgress, emitTelemetry, markClaimCodeCopied, readSurveyProgress, resolveFcConfiguration, resolveFcId, resolveScenario, startReorderSurvey, submitReorderSurvey, writeSurveyProgress, writeSurveyResponse } from './reorderService.js';
import './reorder.css';

const PREVIEW_VIEWS = new Set(['landing', 'coupon-list', 'survey', 'survey-thanks', 'amazon-product', 'amazon-success']);
const LIVE_VIEWS = new Set(['landing', 'coupon-list', 'survey', 'survey-thanks']);
const PRODUCT_PRICE = 59.99;
const DEMO_ADDRESS_KEY = 'fc-reorder:demo-shipping-address-selected';
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
    // Keep neutral white cap highlights intact; only unmix visibly colored
    // anti-aliased edges where the white matte is identifiable.
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

function readView(allowedViews) {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('view') || 'landing';
  const requestedDiscount = params.get('discount');
  const discount = ['code', 'coupon', 'price'].includes(requestedDiscount) ? requestedDiscount : 'code';
  return { name: allowedViews.has(name) ? name : 'landing', step: Math.max(0, Number(params.get('step') || 0)), coupon: params.get('coupon') || '', discount };
}

function Icon({ name, size = 24 }) {
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

function MarketplaceIcon({ name, size = 24 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'menu') return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === 'search') return <svg {...common}><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></svg>;
  if (name === 'star') return <svg {...common} fill="currentColor" stroke="none"><path d="m12 3 2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8Z" /></svg>;
  return null;
}

function BrandWordmark({ brand }) {
  if (brand.logoImage) return <img className="brand-logo" src={brand.logoImage} alt={brand.name} />;
  return <div className="wordmark">{brand.logoText}</div>;
}

function BrandHeader({ brand, onBack }) {
  return <header className="brand-header">{onBack ? <button className="back-button" type="button" onClick={onBack} aria-label="Back"><Icon name="back" size={30} /></button> : <span className="brand-header__spacer" />}<BrandWordmark brand={brand} /><span className="brand-header__spacer" /></header>;
}

function ProductArt({ product, size = 'hero' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product?.image]);
  if (failed || !product?.image) return <div className={`product-art product-art--${size} product-placeholder`} role="img" aria-label="Product image unavailable"><span className="placeholder-leaf">◇</span></div>;
  return <div className={`product-art product-art--${size} product-art--${product.id}`}><img src={product.image} alt={`${product.name}, ${product.variant}`} onError={() => setFailed(true)} /></div>;
}

function MarketplaceProductHero({ product, brand }) {
  const [cutoutUrl, setCutoutUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [cutoutFailed, setCutoutFailed] = useState(false);
  const [cutoutError, setCutoutError] = useState('');
  const imageUrl = product?.image || '';
  const preparedCutout = product?.visualAssets?.cutout || product?.heroImage || '';
  const scene = product?.visualAssets?.scene || product?.heroScene || {};
  const background = scene.background || brand?.colors?.background || '#0b251a';
  const surface = scene.surface || '#153b2a';
  const accent = scene.accent || brand?.colors?.accent || '#c9a276';

  useEffect(() => {
    let active = true;
    let cutoutWorker;
    let cutoutObjectUrl = '';
    let quickCutoutReady = false;
    let aiCutoutReady = false;
    setCutoutUrl('');
    setCutoutFailed(false);
    setCutoutError('');
    setProcessingMessage('');
    if (preparedCutout) {
      setCutoutUrl(preparedCutout);
      setProcessing(false);
      setProcessingMessage('');
      return undefined;
    }

    const cacheKey = preparedCutout || imageUrl;
    const cached = productVisualCache.get(cacheKey);
    if (cached) {
      cutoutObjectUrl = URL.createObjectURL(cached);
      setCutoutUrl(cutoutObjectUrl);
      setProcessing(false);
      return () => URL.revokeObjectURL(cutoutObjectUrl);
    }

    const reportError = (error) => {
      if (!active) return;
      setCutoutFailed(!quickCutoutReady);
      setCutoutError(error || 'Could not prepare this product image.');
      setProcessing(false);
      setProcessingMessage('');
    };
    setProcessing(true);
    if (!preparedCutout && imageUrl) {
      setProcessingMessage('Preparing product cutout…');
      const requestId = `${Date.now()}-${Math.random()}`;
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
          setProcessing(false);
          setProcessingMessage('');
          cutoutWorker.terminate();
        } else if (event.data.type === 'error') {
          reportError(event.data.message);
          cutoutWorker.terminate();
        }
      };
      cutoutWorker.onerror = () => { reportError('Could not prepare this product image.'); cutoutWorker?.terminate(); };
      fetchProductImageBlob(imageUrl).then((blob) => {
        if (!active) return;
        cutoutWorker?.postMessage({ id: requestId, blob });
        makeQuickWhiteCutout(blob).then((previewBlob) => {
          if (!active || aiCutoutReady) return;
          quickCutoutReady = true;
          cutoutObjectUrl = URL.createObjectURL(previewBlob);
          setCutoutUrl(cutoutObjectUrl);
        }).catch(() => {});
      }).catch((error) => reportError(error.message));
    } else {
      setProcessing(false);
      setProcessingMessage('');
    }
    return () => {
      active = false;
      cutoutWorker?.terminate();
      if (cutoutObjectUrl) URL.revokeObjectURL(cutoutObjectUrl);
    };
  }, [imageUrl, preparedCutout]);

  return (
    <div className="marketplace-hero__stage" style={{ '--hero-bg': background, '--hero-surface': surface, '--hero-accent': accent }}>
      <span className="marketplace-hero__wash" />
      <span className="marketplace-hero__floor" />
      <span className="marketplace-hero__contact" />
      {cutoutUrl && <img className="marketplace-hero__bottle" src={cutoutUrl} alt={`${product.name}, ${product.variant}`} />}
      {cutoutFailed && !cutoutUrl && imageUrl && <img className="marketplace-hero__source-image" src={imageUrl} alt={`${product.name}, ${product.variant}`} />}
      {(processing || cutoutFailed) && <span className={`marketplace-hero__status${cutoutFailed ? ' marketplace-hero__status--error' : ''}`} role="status" title={cutoutError}>{cutoutFailed ? 'Showing original product image' : processingMessage}</span>}
    </div>
  );
}

/**
 * Amazon refuses iframe embedding (X-Frame-Options: sameorigin).
 * When this app is framed (e.g. sample.fridgechannels.com live demo), open Amazon
 * in a new tab. Standalone NFC taps keep same-tab navigation.
 */
function openAmazonUrl(url) {
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

function AmazonCta({ product, brand, children, onBeforeOpen, onOpenDemo }) {
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

function useCouponCopy(coupon, fcId, productId, { live = false, feedbackDuration = 0 } = {}) {
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

function CopyIconButton({ copied, onCopy, showLabel = false }) {
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

function CouponTerms({ coupon, product, detailed = false }) {
  const terms = coupon.terms;
  if (!detailed) return <><span className="coupon-claim-card__terms">Valid through {terms.validThrough} · {terms.usageLimit}</span><span className="coupon-claim-card__terms">{terms.stackingRule}</span></>;
  return <ul className="coupon-detail-list"><li><Icon name="calendar" size={28} /><span>Valid through {terms.validThrough}</span></li><li><Icon name="box" size={28} /><span>{product.name} · {product.variant} only</span></li><li><Icon name="person" size={28} /><span>{terms.usageLimit}</span></li><li><Icon name="ticket" size={28} /><span>{terms.stackingRule}</span></li><li><Icon name="store" size={28} /><span>Sold by {terms.sellerName}</span></li></ul>;
}

/* Disabled: Survey-gated Coupon entry point.
function gatedCouponPrompt(benefit) {
  const percent = String(benefit || '').match(/^Save\s+(\d+%)/i)?.[1];
  if (percent) return `Want ${percent} off?`;
  return `Want ${benefit}?`;
}

function GatedCouponOffer({ coupon, questionCount, navigate }) {
  const seconds = Math.max(10, questionCount * 5);
  return <button className="gated-coupon-offer" type="button" aria-label={`${gatedCouponPrompt(coupon.benefit)} Answer ${questionCount} questions, about ${seconds} seconds.`} onClick={() => navigate('coupon-survey', { coupon: coupon.id, step: 0 })}><span><strong>{gatedCouponPrompt(coupon.benefit)}</strong><small>Answer {questionCount} quick questions · About {seconds} seconds</small></span><Icon name="chevron" size={22} /></button>;
}
*/

function ImmediateCouponOffer({ coupon, product, fcId, live = false }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { code, copied, copy } = useCouponCopy(coupon, fcId, product.id, { live });
  return <section className="direct-coupon-card" aria-label="Available coupon"><button className="direct-coupon-card__summary" type="button" aria-expanded={detailsOpen} aria-controls={`coupon-details-${coupon.id}`} onClick={() => setDetailsOpen((open) => !open)}><strong>{coupon.benefit}</strong><span>{detailsOpen ? 'Hide' : 'Details'} <span className={detailsOpen ? 'direct-coupon-card__chevron direct-coupon-card__chevron--open' : 'direct-coupon-card__chevron'}><Icon name="chevron" size={18} /></span></span></button>{code && <div className="direct-coupon-card__code"><span>Code <b>{code}</b></span><CopyIconButton copied={copied} onCopy={copy} /></div>}{detailsOpen && <div className="direct-coupon-card__details" id={`coupon-details-${coupon.id}`}><span className="coupon-claim-card__applies">For this {product.variant} only</span><CouponTerms coupon={coupon} product={product} /></div>}</section>;
}

function CouponSummary({ coupons, navigate }) {
  return <button className="coupon-summary" type="button" onClick={() => navigate('coupon-list')}><span><strong>{coupons.length} coupons available</strong><small>Choose the coupon that fits your order.</small></span><span className="coupon-summary__action"><Icon name="chevron" size={24} /></span></button>;
}

function VoluntarySurveyCard({ survey, navigate, marketplace = false }) {
  const seconds = Math.max(10, survey.questions.length * 5);
  return <button className={`voluntary-survey-card${marketplace ? ' voluntary-survey-card--marketplace' : ''}`} type="button" onClick={() => navigate('survey', { step: 0 })}>{marketplace ? <strong>Share feedback · {survey.questions.length} questions · ~{seconds} sec</strong> : <span><strong>Quick survey</strong><small>{survey.questions.length} questions · About {seconds} seconds</small></span>}<Icon name="chevron" size={18} /></button>;
}

function PurchaseBlock({ config, modules, product, live = false }) {
  const immediateCoupons = modules.immediateCoupons;
  return <section className="purchase-block" aria-label="Purchase options">{immediateCoupons.length === 1 && <ImmediateCouponOffer coupon={immediateCoupons[0]} product={product} fcId={config.fcId} live={live} />}{immediateCoupons.length > 1 && <CouponSummary coupons={immediateCoupons} navigate={config.navigate} />}<AmazonCta product={product} brand={config.brand}>Buy again on Amazon</AmazonCta></section>;
}

function LandingScreen({ config, modules, navigate, live = false }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  const blockConfig = { ...config, navigate };
  return <main className="screen landing-screen"><BrandHeader brand={config.brand} /><ProductArt product={product} /><div className="product-info"><p className="product-name">{product.name}</p><p className="product-variant">{product.variant}</p></div><section className="reorder-copy"><h1>Need more?</h1></section><PurchaseBlock config={blockConfig} modules={modules} product={product} live={live} /><a className="explore-brand-link" href={config.brand.amazonStoreUrl} target="_blank" rel="noopener noreferrer">Explore more from {config.brand.name}</a>{modules.showVoluntarySurvey && <VoluntarySurveyCard survey={config.survey} navigate={navigate} />}</main>;
}

function CouponListItem({ config, coupon, product, live = false }) {
  const { code, copied, copy } = useCouponCopy(coupon, config.fcId, product.id, { live });
  return <section className="coupon-choice coupon-choice--direct" aria-label={`${coupon.benefit} coupon`}><div className="coupon-choice__heading"><strong>{coupon.benefit}</strong><span>Available now</span></div>{code && <div className="coupon-choice__code"><code>{code}</code><CopyIconButton copied={copied} onCopy={copy} /></div>}<div className="coupon-choice__terms"><CouponTerms coupon={coupon} product={product} /></div></section>;
}

function CouponListScreen({ config, coupons, navigate, live = false }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  return <main className="screen coupon-list-screen" aria-label={`Available coupons for ${product.name}, ${product.variant}`}><BrandHeader brand={config.brand} onBack={() => navigate('landing')} /><section className="coupon-list-heading"><h1>Available coupons</h1></section><div className="coupon-list">{coupons.map((coupon) => <CouponListItem key={coupon.id} config={config} coupon={coupon} product={product} live={live} />)}</div><div className="coupon-list-shop"><AmazonCta product={product} brand={config.brand}>Shop on Amazon</AmazonCta><p className="amazon-reassurance"><Icon name="lock" size={18} /> Opens Amazon</p></div></main>;
}

function DemoShippingAddress() {
  return (
    <div className="marketplace-address__content">
      <Icon name="location" size={21} />
      <div className="marketplace-address__lines">
        {SHIPPING_ADDRESS.map((line) => <span key={line}>{line}</span>)}
      </div>
    </div>
  );
}

function AmazonProductAdditionalInfo({ brand, product, onChangeAddress }) {
  const [deliveryNoticeVisible, setDeliveryNoticeVisible] = useState(true);
  const [selectedPack, setSelectedPack] = useState(0);
  const [saved, setSaved] = useState(false);
  const variantParts = product.variant.split(',').map((part) => part.trim());
  const flavor = variantParts.find((part) => !/\d+\s*[- ]?\s*(bottles?|packs?|count|ct|pieces?|pcs|units?|cans?|bags?)/i.test(part)) || variantParts[0] || 'Original';
  const packageCount = product.variant.match(/\d+\s*[- ]?\s*(?:bottles?|packs?|count|ct|pieces?|pcs|units?|cans?|bags?)/i)?.[0]?.replace(/\s+/g, ' ').trim() || '12 Bottles';

  return (
    <section className="marketplace-extra-info" aria-label="More product information">
      <div className="marketplace-extra-info__intro">
        <h2>Product information</h2>
        <span>Sample data · scroll to explore</span>
      </div>

      {deliveryNoticeVisible && (
        <aside className="marketplace-delivery-notice">
          <p>We’re showing items that ship to Singapore. Change your delivery address to see other available options.</p>
          <div><button type="button" onClick={() => setDeliveryNoticeVisible(false)}>Dismiss</button><button type="button" onClick={onChangeAddress}>Change address</button></div>
        </aside>
      )}

      <details className="marketplace-info-accordion" open>
        <summary>Top highlights</summary>
        <dl className="marketplace-highlights-table">
          <div><dt>Type</dt><dd>Beverage</dd></div>
          <div><dt>Flavor</dt><dd>{flavor}</dd></div>
          <div><dt>Product benefits</dt><dd>Refreshing fruit flavor; a convenient drink for breakfast or on the go.</dd></div>
          <div><dt>Number of items</dt><dd>{packageCount.match(/\d+/)?.[0] || '12'}</dd></div>
          <div><dt>Unit count</dt><dd>{packageCount}</dd></div>
          <div><dt>Brand</dt><dd>{brand.name}</dd></div>
        </dl>
        <ul className="marketplace-feature-list">
          <li>Includes {packageCount} of {product.name}.</li>
          <li>Made for easy serving at home, at breakfast, or while traveling.</li>
          <li>Packaged for convenient storage and everyday use.</li>
          <li>Enjoy chilled as part of a balanced routine.</li>
        </ul>
      </details>

      <section className="marketplace-info-section marketplace-buying-options" aria-labelledby="marketplace-options-title">
        <h3 id="marketplace-options-title">Size options</h3>
        <div className="marketplace-option-list">
          {[
            { label: packageCount, offers: '1 option', price: '$59.99' },
            { label: '24 Bottles', offers: '3 options', price: '$109.99' },
          ].map((option, index) => (
            <button className={'marketplace-option' + (selectedPack === index ? ' marketplace-option--selected' : '')} key={option.label} type="button" aria-pressed={selectedPack === index} onClick={() => setSelectedPack(index)}>
              <span><b>{option.label}</b><small>{option.offers} from {option.price}</small></span>
              {selectedPack === index && <span className="marketplace-option__check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
        <button className="marketplace-buying-options__all" type="button">See all buying options <span aria-hidden="true">›</span></button>
      </section>

      <section className="marketplace-info-section" aria-labelledby="marketplace-details-title">
        <h3 id="marketplace-details-title">Product details</h3>
        <details className="marketplace-info-accordion">
          <summary>Nutritional info</summary>
          <dl className="marketplace-highlights-table marketplace-highlights-table--compact">
            <div><dt>Serving size</dt><dd>1 bottle (240 ml)</dd></div>
            <div><dt>Calories</dt><dd>110</dd></div>
            <div><dt>Total fat</dt><dd>0 g</dd></div>
            <div><dt>Total sugars</dt><dd>22 g</dd></div>
            <div><dt>Vitamin C</dt><dd>100% daily value</dd></div>
          </dl>
        </details>
        <details className="marketplace-info-accordion">
          <summary>Ingredients</summary>
          <p>Orange juice, filtered water, natural flavor. Example copy for layout preview; final ingredients will come from product data.</p>
        </details>
      </section>

      <details className="marketplace-info-accordion marketplace-info-accordion--section">
        <summary>Product specifications</summary>
        <dl className="marketplace-highlights-table">
          <div><dt>Brand</dt><dd>{brand.name}</dd></div>
          <div><dt>Product</dt><dd>{product.name}</dd></div>
          <div><dt>Flavor</dt><dd>{flavor}</dd></div>
          <div><dt>Unit count</dt><dd>{packageCount}</dd></div>
          <div><dt>ASIN</dt><dd>{product.asin || 'B0DEMO1234'}</dd></div>
        </dl>
      </details>

      <details className="marketplace-info-accordion marketplace-info-accordion--section">
        <summary>About the brand</summary>
        <p>{brand.name} makes convenient products for everyday routines. This brand description is sample copy for the product information layout.</p>
      </details>

      <section className="marketplace-info-section" aria-labelledby="marketplace-gallery-title">
        <div className="marketplace-info-section__heading">
          <h3 id="marketplace-gallery-title">Product image gallery</h3>
          <div className="marketplace-gallery-actions"><button type="button" aria-label={saved ? 'Remove from list' : 'Save to list'} onClick={() => setSaved((value) => !value)}>{saved ? '♥' : '♡'}</button><button type="button" aria-label="Share product">↗</button></div>
        </div>
        <div className="marketplace-gallery-grid">
          <div className="marketplace-gallery-tile marketplace-gallery-tile--hero"><span>Product image</span></div>
          <div className="marketplace-gallery-tile marketplace-gallery-tile--facts"><span>Nutrition facts</span></div>
          <div className="marketplace-gallery-tile marketplace-gallery-tile--pack"><span>Package details</span></div>
        </div>
      </section>

      <details className="marketplace-info-accordion marketplace-info-accordion--section">
        <summary>Videos</summary>
        <div className="marketplace-video-preview"><span className="marketplace-video-preview__play" aria-hidden="true">▶</span><span><b>Get to know {product.name}</b><small>Product overview · 0:45</small></span></div>
      </details>

      <details className="marketplace-info-accordion marketplace-info-accordion--section">
        <summary>Additional details</summary>
        <dl className="marketplace-highlights-table">
          <div><dt>Storage</dt><dd>Store in a cool, dry place. Chill before serving.</dd></div>
          <div><dt>Package type</dt><dd>Multi-unit pack</dd></div>
          <div><dt>Seller</dt><dd>{brand.name}</dd></div>
        </dl>
      </details>

      <button className="marketplace-report-link" type="button">⚑ <span>Report an issue with this product or seller</span></button>

      <section className="marketplace-manufacturer" aria-labelledby="marketplace-manufacturer-title">
        <h3 id="marketplace-manufacturer-title">From the manufacturer</h3>
        <h4>Good ingredients, made for everyday moments</h4>
        <div className="marketplace-manufacturer-banner"><b>{brand.name}</b><span>Real ingredients, thoughtfully made</span></div>
        <div className="marketplace-manufacturer-points"><span>Simple to enjoy</span><span>Made for your routine</span><span>A refreshing choice</span></div>
      </section>
    </section>
  );
}

function AmazonProductScreen({ config, coupons, modules, navigate, discountMode = 'code' }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  const productSize = product.variant.match(/\d+\s*[- ]?\s*(?:bottles?|packs?|count|ct|pieces?|pcs|units?|cans?|bags?)/i)?.[0]?.replace(/\s+/g, ' ').trim() || product.variant;
  const coupon = coupons[0];
  const { code, copied, copy } = useCouponCopy(coupon, config.fcId, product.id, { feedbackDuration: 2000 });
  const [quantity, setQuantity] = useState(1);
  const [couponTermsOpen, setCouponTermsOpen] = useState(false);
  const [couponApplied, setCouponApplied] = useState(false);
  const [productInfoTab, setProductInfoTab] = useState(0);
  const addressDialogRef = useRef(null);
  const [demoAddressSelected, setDemoAddressSelected] = useState(() => {
    try { return sessionStorage.getItem(DEMO_ADDRESS_KEY) === 'true'; }
    catch { return false; }
  });
  const discountEligible = discountMode === 'price' || (discountMode === 'coupon' && couponApplied);
  const unitPrice = discountEligible ? Number((PRODUCT_PRICE * 0.9).toFixed(2)) : PRODUCT_PRICE;
  const orderTotal = (unitPrice * quantity).toFixed(2);

  const updateDemoAddress = (selected) => {
    setDemoAddressSelected(selected);
    try {
      if (selected) sessionStorage.setItem(DEMO_ADDRESS_KEY, 'true');
      else sessionStorage.removeItem(DEMO_ADDRESS_KEY);
    } catch { /* The demo still works for the current page. */ }
    addressDialogRef.current?.close();
  };

  const placeDemoOrder = () => {
    const order = { orderNumber: 'Demo-114-20260909', quantity, productId: product.id, total: orderTotal };
    sessionStorage.setItem('fc-reorder:demo-order', JSON.stringify(order));
    emitTelemetry('demo_order_completed', order);
    navigate('amazon-success');
  };
  return (
    <main className="marketplace-screen marketplace-screen--2p5d marketplace-screen--product" aria-label={`${product.name} product page demo`}>
      <section className="marketplace-product marketplace-product--2p5d" aria-label="Product information" tabIndex={0}>
        <header className="marketplace-header marketplace-header--with-account">
          <button className="marketplace-icon-button" type="button" onClick={() => navigate('landing')} aria-label="Back to reorder page"><Icon name="back" size={25} /></button>
          <span className="marketplace-brand" aria-label={config.brand.name}><BrandWordmark brand={config.brand} /></span>
          <button
            className="marketplace-account-button"
            type="button"
            aria-haspopup="dialog"
            aria-controls="marketplace-address-dialog"
            onClick={() => addressDialogRef.current?.showModal()}
          >
            {demoAddressSelected ? 'Delivery address' : 'Link Amazon'}
          </button>
        </header>
        <MarketplaceProductHero product={product} brand={config.brand} />
        <div className="marketplace-product-copy marketplace-product-copy--2p5d">
          <a className="marketplace-store" href={config.brand.amazonStoreUrl} target="_blank" rel="noopener noreferrer">Visit the {config.brand.name} Store</a>
          {productInfoTab === 0 ? (
            <div className="marketplace-info-page" id="marketplace-info-panel-0" role="tabpanel" aria-labelledby="marketplace-info-tab-0">
              <h1>{product.name}, {product.variant}</h1>
              <p className="marketplace-variant"><b>Size:</b> {productSize}</p>
              <div className="marketplace-rating" aria-label="Rated 4.8 out of 5"><span>4.8</span><span className="marketplace-stars"><MarketplaceIcon name="star" size={15} /><MarketplaceIcon name="star" size={15} /><MarketplaceIcon name="star" size={15} /><MarketplaceIcon name="star" size={15} /><MarketplaceIcon name="star" size={15} /></span><button type="button">128 ratings</button></div>
              {discountMode === 'price' ? (
                <div className="marketplace-price marketplace-price--discount" aria-label="Discounted price $53.99, was $59.99, 10% off">
                  <span className="marketplace-price__current"><sup>$</sup>53<span>99</span></span>
                  <del>$59.99</del>
                  <span className="marketplace-price__saving">10% off</span>
                </div>
              ) : (
                <div className="marketplace-price"><sup>$</sup>59<span>99</span></div>
              )}
              {coupon && discountMode === 'code' && (
                <section className="marketplace-coupon marketplace-coupon--compact" aria-label="Available coupon">
                  <strong className="marketplace-coupon__benefit">{coupon.benefit}</strong>
                  {code && <div className="marketplace-coupon__code-row"><span className="marketplace-coupon__code">Code <code>{code}</code></span><CopyIconButton copied={copied} onCopy={copy} /><span className="visually-hidden" role="status">{copied ? 'Code copied' : ''}</span></div>}
                  <button className="marketplace-coupon__details-toggle" type="button" aria-expanded={couponTermsOpen} aria-controls={`marketplace-coupon-terms-${coupon.id}`} onClick={() => setCouponTermsOpen((open) => !open)}><span>{couponTermsOpen ? 'Hide usage conditions' : 'Usage conditions'}</span><Icon name="chevron" size={18} /></button>
                  <div className="marketplace-coupon__details" id={`marketplace-coupon-terms-${coupon.id}`} hidden={!couponTermsOpen}><CouponTerms coupon={coupon} product={product} detailed /></div>
                </section>
              )}
              {discountMode === 'coupon' && (
                <button className={`marketplace-coupon-clip${couponApplied ? ' marketplace-coupon-clip--applied' : ''}`} type="button" aria-pressed={couponApplied} onClick={() => setCouponApplied((applied) => !applied)}>
                  <span className="marketplace-coupon-clip__check" aria-hidden="true">{couponApplied ? '✓' : ''}</span>
                  <span><b>{couponApplied ? 'Coupon applied' : 'Apply coupon'}</b><small>Save 10% at checkout</small></span>
                </button>
              )}
              <div className="marketplace-quantity" aria-label="Quantity"><span>Quantity</span><button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} aria-label="Reduce quantity">−</button><b>{quantity}</b><button type="button" onClick={() => setQuantity((current) => current + 1)} aria-label="Increase quantity">+</button></div>
            </div>
          ) : (
            <div className="marketplace-info-panel" id="marketplace-info-panel-1" role="tabpanel" aria-labelledby="marketplace-info-tab-1">
              <AmazonProductAdditionalInfo brand={config.brand} product={product} onChangeAddress={() => addressDialogRef.current?.showModal()} />
            </div>
          )}
          <footer className="marketplace-action">
            <div className="marketplace-info-dots" role="tablist" aria-label="Product information pages">
              {[0, 1].map((tab) => <button key={tab} id={`marketplace-info-tab-${tab}`} role="tab" type="button" aria-label={`Page ${tab + 1}`} aria-selected={productInfoTab === tab} aria-controls={`marketplace-info-panel-${tab}`} onClick={() => setProductInfoTab(tab)} />)}
            </div>
            <button type="button" onClick={placeDemoOrder}>Place order · ${orderTotal}</button>
            {modules.showVoluntarySurvey && <VoluntarySurveyCard survey={config.survey} navigate={navigate} marketplace />}
          </footer>
        </div>
      </section>
      <dialog
        className="marketplace-address-dialog"
        id="marketplace-address-dialog"
        ref={addressDialogRef}
        aria-labelledby="marketplace-address-dialog-title"
      >
        <h2 id="marketplace-address-dialog-title">Delivery address</h2>
        <p>Choose an address for this order.</p>
        <DemoShippingAddress />
        <form className="marketplace-address-dialog__actions" method="dialog">
          <button className="marketplace-address-dialog__secondary" type="submit">{demoAddressSelected ? 'Close' : 'Cancel'}</button>
          <button className="marketplace-address-dialog__primary" type="button" onClick={() => updateDemoAddress(!demoAddressSelected)}>{demoAddressSelected ? 'Remove address' : 'Use this address'}</button>
        </form>
      </dialog>
    </main>
  );
}

function AmazonOrderSuccessScreen({ config, navigate }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  let order = { orderNumber: 'Demo-114-20260909', quantity: 1, total: PRODUCT_PRICE.toFixed(2) };
  try { order = { ...order, ...JSON.parse(sessionStorage.getItem('fc-reorder:demo-order') || '{}') }; } catch { /* Keep safe demo defaults. */ }
  order.quantity = Math.max(1, Number(order.quantity) || 1);
  order.total = (PRODUCT_PRICE * order.quantity).toFixed(2);
  return <main className="marketplace-screen marketplace-screen--2p5d marketplace-success-screen" aria-label="Demo order confirmation"><header className="marketplace-header"><button className="marketplace-icon-button" type="button" onClick={() => navigate('amazon-product')} aria-label="Back to product page"><Icon name="back" size={25} /></button><span className="marketplace-brand" aria-label={config.brand.name}><BrandWordmark brand={config.brand} /></span></header><section className="order-success"><div className="order-success__check"><Icon name="check" size={48} /></div><h1>Thank you, your demo order is confirmed.</h1><p className="order-success__message">We’ll show a delivery update here when your demo order is ready.</p><div className="order-success__meta"><span>Order number</span><b>{order.orderNumber}</b></div><section className="order-success__delivery"><p>Estimated delivery</p><strong>Within 1–2 days</strong><div className="order-success__product"><img src={product.image} alt="" /><span><b>{product.name}</b><small>{product.variant}</small><small>Quantity: {order.quantity}</small></span></div></section><div className="order-success__total"><span>Order total</span><b>${order.total}</b></div><button className="order-success__primary" type="button" onClick={() => navigate('landing')}>Continue shopping</button><button className="order-success__secondary" type="button" onClick={() => navigate('amazon-product')}>View demo product</button></section></main>;
}

function SurveyScreen({ config, coupon, step, navigate, onComplete }) {
  const survey = config.survey;
  const routeName = coupon ? 'coupon-survey' : 'survey';
  const restored = readSurveyProgress(config.fcId, survey.id) || { answers: {}, step: 0 };
  const [answers, setAnswers] = useState(restored.answers);
  const safeStep = Math.min(step, survey.questions.length - 1);
  const question = survey.questions[safeStep];
  const choose = (option) => {
    const nextAnswers = { ...answers, [question.id]: option.id };
    setAnswers(nextAnswers);
    writeSurveyProgress(config.fcId, survey.id, { answers: nextAnswers, step: safeStep });
  };
  const selectedAnswer = answers[question.id];
  const continueSurvey = () => {
    if (!selectedAnswer) return;
    if (safeStep < survey.questions.length - 1) {
      writeSurveyProgress(config.fcId, survey.id, { answers, step: safeStep + 1 });
      navigate(routeName, { coupon: coupon?.id, step: safeStep + 1 });
      return;
    }
    clearSurveyProgress(config.fcId, survey.id);
    onComplete(answers);
  };
  const back = () => safeStep === 0 ? navigate('landing') : navigate(routeName, { coupon: coupon?.id, step: safeStep - 1 });
  return <main className="screen survey-screen"><header className="survey-header"><button className="icon-back" type="button" onClick={back} aria-label="Back"><Icon name="back" size={34} /></button><BrandWordmark brand={config.brand} /><span className="survey-count">{safeStep + 1} of {survey.questions.length}</span></header><div className="progress-track"><span style={{ width: `${((safeStep + 1) / survey.questions.length) * 100}%` }} /></div><section className="question-copy"><h1>{question.title}</h1></section><fieldset className="answer-list"><legend className="visually-hidden">Choose one answer</legend>{question.options.map((option) => <label className={selectedAnswer === option.id ? 'answer-option answer-option--selected' : 'answer-option'} key={option.id}><input className="answer-option__input" type="radio" name={question.id} value={option.id} checked={selectedAnswer === option.id} onChange={() => choose(option)} /><span className="answer-option__label">{option.label}</span><span className="answer-option__selection" aria-hidden="true">{selectedAnswer === option.id && <span className="answer-option__dot" />}</span></label>)}</fieldset><button className="coupon-primary-button survey-continue" type="button" onClick={continueSurvey} disabled={!selectedAnswer}>{safeStep === survey.questions.length - 1 ? 'Submit response' : 'Continue'}</button></main>;
}

/* Disabled: Survey-gated Coupon reveal and one-step copy-and-shop flow.
function CouponRevealScreen({ config, coupon, navigate }) {
  const product = config.products.find((item) => coupon.eligibleProductIds.includes(item.id));
  const { code, copy } = useCouponCopy(coupon, config.fcId, product.id);
  const copyThenShop = async () => { await copy(); await new Promise((resolve) => window.setTimeout(resolve, 450)); };
  return <main className="screen coupon-reveal-screen"><BrandHeader brand={config.brand} onBack={() => navigate('landing')} /><section className="coupon-reveal-hero"><Icon name="check" size={64} /><p>Your coupon is ready</p><h1>{coupon.benefit}</h1></section><div className="coupon-reveal-product"><ProductArt product={product} size="thumb" /><p>{product.name} · {product.variant}</p></div><h2 className="coupon-reveal-section-title">Your code</h2>{code ? <section className="coupon-reveal-code"><code>{code}</code></section> : <p className="coupon-reveal-auto">Amazon applies this coupon automatically at checkout.</p>}{code && <p className="coupon-reveal-instruction">Apply this code at Amazon checkout.</p>}<h2 className="coupon-reveal-section-title">Coupon details</h2><CouponTerms coupon={coupon} product={product} detailed /><AmazonCta product={product} brand={config.brand} onBeforeOpen={copyThenShop}>{code ? 'Copy code & shop on Amazon' : 'Shop on Amazon'}</AmazonCta><p className="coupon-shop-note"><Icon name="lock" size={22} />{code ? 'Copies your code, then opens Amazon.' : 'Opens Amazon.'}</p></main>;
}
*/

function SurveyThankYouScreen({ config, navigate }) {
  return <main className="screen survey-thanks-screen"><BrandHeader brand={config.brand} /><Icon name="check" size={64} /><h1>Thanks for sharing</h1><p>{config.survey.completionMessage}</p><button className="coupon-primary-button" type="button" onClick={() => navigate('landing')}>Back to FC Reorder</button></main>;
}

function LoadingScreen() { return <main className="screen state-screen loading-screen" aria-busy="true"><BrandHeader brand={{ name: 'PURA JUICE', logoText: 'PURA JUICE', logoImage: '/reorder/pura-juice-logo.svg' }} /><div className="skeleton skeleton-product" /><div className="skeleton skeleton-name" /><div className="skeleton skeleton-button" /><p>Loading product…</p></main>; }
function InvalidScreen({ config }) { const brand = config?.brand || { logoText: 'FC', name: 'Brand' }; return <main className="screen state-screen invalid-screen"><BrandHeader brand={brand} /><h1>We can’t find this product.</h1><p>This FC link may be unavailable.</p><a className="state-secondary" href={brand.amazonStoreUrl} target="_blank" rel="noopener noreferrer">Visit {brand.name} on Amazon</a></main>; }

export default function ReorderApp({
  mode = 'preview',
  sn = null,
  initialResolved = null,
  onEntryReady = null,
  suppressLocalLoading = false,
} = {}) {
  const live = mode === 'live';
  const allowedViews = live ? LIVE_VIEWS : PREVIEW_VIEWS;
  const [view, setView] = useState(() => readView(allowedViews));
  const [resolved, setResolved] = useState(() => (
    initialResolved
      ? { status: initialResolved.status, config: initialResolved.config ?? null }
      : { status: 'resolving', config: null }
  ));
  const entryReadyNotifiedRef = useRef(false);
  const fcId = sn || resolveFcId();
  const scenario = resolveScenario();
  useEffect(() => {
    if (initialResolved) {
      setResolved({ status: initialResolved.status, config: initialResolved.config ?? null });
      return undefined;
    }
    let active = true;
    setResolved({ status: 'resolving', config: null });
    resolveFcConfiguration({ fcId, scenario, mode: live ? 'live' : 'preview' })
      .then((config) => active && setResolved({ status: config.status, config }))
      .catch(() => active && setResolved({ status: 'invalid', config: null }));
    return () => { active = false; };
  }, [fcId, scenario, live, initialResolved]);
  useEffect(() => {
    if (typeof onEntryReady !== 'function' || entryReadyNotifiedRef.current) return;
    if (resolved.status === 'resolving') return;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (entryReadyNotifiedRef.current) return;
        entryReadyNotifiedRef.current = true;
        onEntryReady();
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onEntryReady, resolved.status]);
  useEffect(() => {
    const sync = () => setView(readView(allowedViews));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [allowedViews]);
  const navigate = useCallback((name, values = {}) => {
    if (live && !LIVE_VIEWS.has(name) && name !== 'landing') return;
    const params = new URLSearchParams(window.location.search);
    if (name === 'landing') params.delete('view');
    else params.set('view', name);
    ['step', 'coupon'].forEach((key) => values[key] != null ? params.set(key, String(values[key])) : params.delete(key));
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
    setView(readView(allowedViews));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [allowedViews, live]);
  if (resolved.status === 'resolving') {
    if (suppressLocalLoading || typeof onEntryReady === 'function') return null;
    return <LoadingScreen />;
  }
  if (resolved.status === 'invalid') return <InvalidScreen config={resolved.config} />;
  const config = resolved.config;
  const modules = composeConsumerModules({ ...config, now: new Date() });
  // DEMO: never hide survey after local completion — always show Quick survey on landing.
  // Restore:
  // const surveyCompleted = live
  //   ? Boolean(config.survey && readSurveyResponse(config.fcId, config.survey.id))
  //   : (!isScenarioPreview() && Boolean(config.survey && readSurveyResponse(config.fcId, config.survey.id)));
  // const landingModules = surveyCompleted ? { ...modules, gatedCoupons: [], showVoluntarySurvey: false } : modules;
  const landingModules = modules;
  const coupons = modules.immediateCoupons;
  const completeSurvey = async (answers) => {
    const response = {
      fcId: config.fcId,
      brandId: config.brand.id,
      productId: config.currentProductId,
      surveyId: config.survey.id,
      couponId: null,
      sessionId: window.crypto?.randomUUID?.() || `${Date.now()}`,
      answers,
      completedAt: new Date().toISOString(),
    };
    if (live) {
      try {
        const started = await startReorderSurvey(config.fcId, config.survey.id);
        await submitReorderSurvey(config.fcId, config.survey.id, {
          responseId: started?.responseId || started?.id || response.sessionId,
          answers,
        });
      } catch {
        /* Keep local thank-you even if sync fails in demo. */
      }
    }
    writeSurveyResponse(config.fcId, config.survey.id, response);
    emitTelemetry('survey_completed', response);
    navigate('survey-thanks');
  };
  if (view.name === 'coupon-list') return <CouponListScreen config={config} coupons={coupons} navigate={navigate} live={live} />;
  if (!live && view.name === 'amazon-product') return <AmazonProductScreen config={config} coupons={coupons} modules={modules} navigate={navigate} discountMode={view.discount} />;
  if (!live && view.name === 'amazon-success') return <AmazonOrderSuccessScreen config={config} navigate={navigate} />;
  // DEMO: allow re-entering survey even after a prior completion.
  if (view.name === 'survey' && modules.showVoluntarySurvey) {
    return <SurveyScreen config={config} step={view.step} navigate={navigate} onComplete={completeSurvey} />;
  }
  if (view.name === 'survey-thanks' && config.survey) return <SurveyThankYouScreen config={config} navigate={navigate} />;
  return <LandingScreen config={config} modules={landingModules} navigate={navigate} live={live} />;
}
