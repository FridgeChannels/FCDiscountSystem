import { useCallback, useEffect, useRef, useState } from 'react';
import { composeConsumerModules } from './domain.js';
import { clearSurveyProgress, emitTelemetry, readSurveyProgress, resolveFcConfiguration, resolveFcId, resolveScenario, startReorderSurvey, submitReorderSurvey, writeSurveyProgress, writeSurveyResponse } from './reorderService.js';
import AsinMarketplaceProductScreen from './AsinMarketplaceProductScreen.jsx';
import {
  AmazonCta,
  BrandWordmark,
  CopyIconButton,
  CouponTerms,
  Icon,
  MarketplaceProductHero,
  VoluntarySurveyCard,
  useCouponCopy,
} from './marketplaceUi.jsx';
import './reorder.css';

const PREVIEW_VIEWS = new Set(['landing', 'coupon-list', 'survey', 'survey-thanks', 'amazon-product', 'amazon-success']);
const LIVE_VIEWS = new Set(['asin-product', 'landing', 'coupon-list', 'survey', 'survey-thanks']);
const PRODUCT_PRICE = 59.99;

function readView(allowedViews) {
  const params = new URLSearchParams(window.location.search);
  const defaultName = allowedViews.has('asin-product') ? 'asin-product' : 'landing';
  const requested = params.get('view') || defaultName;
  const name = allowedViews.has(requested) ? requested : defaultName;
  const requestedDiscount = params.get('discount');
  const discount = ['code', 'coupon', 'price'].includes(requestedDiscount) ? requestedDiscount : 'code';
  return { name, step: Math.max(0, Number(params.get('step') || 0)), coupon: params.get('coupon') || '', discount };
}

function BrandHeader({ brand, onBack }) {
  return <header className="brand-header">{onBack ? <button className="back-button" type="button" onClick={onBack} aria-label="Back"><Icon name="back" size={30} /></button> : <span className="brand-header__spacer" />}<BrandWordmark brand={brand} /><span className="brand-header__spacer" /></header>;
}

function surveyThemeStyle(brand) {
  return {
    '--survey-primary': brand.colors?.primary || '#004d3d',
    '--survey-secondary': brand.colors?.secondary || brand.colors?.accent || '#fff2db',
  };
}

function ProductArt({ product, size = 'hero' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product?.image]);
  if (failed || !product?.image) return <div className={`product-art product-art--${size} product-placeholder`} role="img" aria-label="Product image unavailable"><span className="placeholder-leaf">◇</span></div>;
  return <div className={`product-art product-art--${size} product-art--${product.id}`}><img src={product.image} alt={`${product.name}, ${product.variant}`} onError={() => setFailed(true)} /></div>;
}

function ImmediateCouponOffer({ coupon, product, fcId, live = false }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { code, copied, copy } = useCouponCopy(coupon, fcId, product.id, { live });
  return <section className="direct-coupon-card" aria-label="Available coupon"><button className="direct-coupon-card__summary" type="button" aria-expanded={detailsOpen} aria-controls={`coupon-details-${coupon.id}`} onClick={() => setDetailsOpen((open) => !open)}><strong>{coupon.benefit}</strong><span>{detailsOpen ? 'Hide' : 'Details'} <span className={detailsOpen ? 'direct-coupon-card__chevron direct-coupon-card__chevron--open' : 'direct-coupon-card__chevron'}><Icon name="chevron" size={18} /></span></span></button>{code && <div className="direct-coupon-card__code"><span>Code <b>{code}</b></span><CopyIconButton copied={copied} onCopy={copy} /></div>}{detailsOpen && <div className="direct-coupon-card__details" id={`coupon-details-${coupon.id}`}><span className="coupon-claim-card__applies">For this {product.variant} only</span><CouponTerms coupon={coupon} product={product} /></div>}</section>;
}

function CouponSummary({ coupons, navigate }) {
  return <button className="coupon-summary" type="button" onClick={() => navigate('coupon-list')}><span><strong>{coupons.length} coupons available</strong><small>Choose the coupon that fits your order.</small></span><span className="coupon-summary__action"><Icon name="chevron" size={24} /></span></button>;
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

function AmazonProductScreen({ config, coupons, modules, navigate, discountMode = 'code' }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  const useSampleDiscount = new URLSearchParams(window.location.search).get('discountPreview') === 'sample';
  const coupon = useSampleDiscount
    ? {
        id: 'amazon-discount-preview',
        benefit: '10% off this product',
        claimCode: config.brand.id === 'mosh' ? 'MOSH10' : 'PURA10B',
        terms: {
          validThrough: 'Sep 30, 2026',
          usageLimit: 'One use per customer',
          stackingRule: 'Cannot be combined with other coupons',
          sellerName: config.brand.name,
        },
      }
    : coupons[0];
  const { code, copied, copy } = useCouponCopy(coupon, config.fcId, product.id, { feedbackDuration: 2000 });
  const quantity = 1;
  const [couponTermsOpen, setCouponTermsOpen] = useState(false);
  const [couponApplied, setCouponApplied] = useState(false);
  const discountEligible = discountMode === 'price' || (discountMode === 'coupon' && couponApplied);
  const unitPrice = discountEligible ? Number((PRODUCT_PRICE * 0.9).toFixed(2)) : PRODUCT_PRICE;
  const orderTotal = (unitPrice * quantity).toFixed(2);

  const placeDemoOrder = () => {
    const order = { orderNumber: 'Demo-114-20260909', quantity, productId: product.id, total: orderTotal };
    sessionStorage.setItem('fc-reorder:demo-order', JSON.stringify(order));
    emitTelemetry('demo_order_completed', order);
    navigate('amazon-success');
  };
  return (
    <main className="marketplace-screen marketplace-screen--2p5d marketplace-screen--product" data-brand={config.brand.id}
      style={{ '--brand-primary': config.brand.colors?.primary || '#004d3d', '--brand-secondary': config.brand.colors?.secondary || '#fff2db' }}
      aria-label={`${product.name} product page demo`}>
      <section className="marketplace-product marketplace-product--2p5d" aria-label="Product information" tabIndex={0}>
        <header className="marketplace-header">
          <span className="marketplace-brand" aria-label={config.brand.name}><BrandWordmark brand={config.brand} /></span>
        </header>
        <MarketplaceProductHero product={product} brand={config.brand} />
        <div className="marketplace-product-copy marketplace-product-copy--2p5d">
          <a className="marketplace-store" href={config.brand.storeUrl || config.brand.amazonStoreUrl} target="_blank" rel="noopener noreferrer">Visit the {config.brand.name} Store</a>
          <div className="marketplace-info-page">
              <h1>{product.name}, {product.variant}</h1>
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
          </div>
          <footer className="marketplace-action">
            <button type="button" onClick={placeDemoOrder}>Place order</button>
            {modules.showVoluntarySurvey && <VoluntarySurveyCard survey={config.survey} navigate={navigate} marketplace />}
          </footer>
        </div>
      </section>
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

function SurveyScreen({ config, coupon, step, navigate, onComplete, homeView = 'landing' }) {
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
  const back = () => safeStep === 0 ? navigate(homeView) : navigate(routeName, { coupon: coupon?.id, step: safeStep - 1 });
  return <main className="screen survey-screen" style={surveyThemeStyle(config.brand)}><header className="survey-header"><button className="icon-back" type="button" onClick={back} aria-label="Back"><Icon name="back" size={34} /></button><BrandWordmark brand={config.brand} /><span className="survey-count">{safeStep + 1} of {survey.questions.length}</span></header><div className="progress-track"><span style={{ width: `${((safeStep + 1) / survey.questions.length) * 100}%` }} /></div><section className="question-copy"><h1>{question.title}</h1></section><fieldset className="answer-list"><legend className="visually-hidden">Choose one answer</legend>{question.options.map((option) => <label className={selectedAnswer === option.id ? 'answer-option answer-option--selected' : 'answer-option'} key={option.id}><input className="answer-option__input" type="radio" name={question.id} value={option.id} checked={selectedAnswer === option.id} onChange={() => choose(option)} /><span className="answer-option__label">{option.label}</span><span className="answer-option__selection" aria-hidden="true">{selectedAnswer === option.id && <span className="answer-option__dot" />}</span></label>)}</fieldset><button className="coupon-primary-button survey-continue" type="button" onClick={continueSurvey} disabled={!selectedAnswer}>{safeStep === survey.questions.length - 1 ? 'Submit response' : 'Continue'}</button></main>;
}

/* Disabled: Survey-gated Coupon reveal and one-step copy-and-shop flow.
function CouponRevealScreen({ config, coupon, navigate }) {
  const product = config.products.find((item) => coupon.eligibleProductIds.includes(item.id));
  const { code, copy } = useCouponCopy(coupon, config.fcId, product.id);
  const copyThenShop = async () => { await copy(); await new Promise((resolve) => window.setTimeout(resolve, 450)); };
  return <main className="screen coupon-reveal-screen"><BrandHeader brand={config.brand} onBack={() => navigate('landing')} /><section className="coupon-reveal-hero"><Icon name="check" size={64} /><p>Your coupon is ready</p><h1>{coupon.benefit}</h1></section><div className="coupon-reveal-product"><ProductArt product={product} size="thumb" /><p>{product.name} · {product.variant}</p></div><h2 className="coupon-reveal-section-title">Your code</h2>{code ? <section className="coupon-reveal-code"><code>{code}</code></section> : <p className="coupon-reveal-auto">Amazon applies this coupon automatically at checkout.</p>}{code && <p className="coupon-reveal-instruction">Apply this code at Amazon checkout.</p>}<h2 className="coupon-reveal-section-title">Coupon details</h2><CouponTerms coupon={coupon} product={product} detailed /><AmazonCta product={product} brand={config.brand} onBeforeOpen={copyThenShop}>{code ? 'Copy code & shop on Amazon' : 'Shop on Amazon'}</AmazonCta><p className="coupon-shop-note"><Icon name="lock" size={22} />{code ? 'Copies your code, then opens Amazon.' : 'Opens Amazon.'}</p></main>;
}
*/

function SurveyThankYouScreen({ config, navigate, homeView = 'landing' }) {
  return <main className="screen survey-thanks-screen" style={surveyThemeStyle(config.brand)}><BrandHeader brand={config.brand} /><Icon name="check" size={64} /><h1>Thanks for sharing</h1><p>{config.survey.completionMessage}</p><button className="coupon-primary-button" type="button" onClick={() => navigate(homeView)}>Back to FC Reorder</button></main>;
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
    // Notify as soon as live/preview content can paint. Double-rAF was easy to
    // lose under Strict Mode cleanup when the product hero kicked off workers.
    entryReadyNotifiedRef.current = true;
    onEntryReady();
  }, [onEntryReady, resolved.status]);
  useEffect(() => {
    const sync = () => setView(readView(allowedViews));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [allowedViews]);
  const homeView = live ? 'asin-product' : 'landing';
  const navigate = useCallback((name, values = {}) => {
    if (live && !LIVE_VIEWS.has(name)) return;
    const params = new URLSearchParams(window.location.search);
    if (!sn && !live && scenario === 'mosh-product') params.set('scenario', scenario);
    if (name === 'asin-product' || (!live && name === 'landing')) params.delete('view');
    else params.set('view', name);
    ['step', 'coupon'].forEach((key) => values[key] != null ? params.set(key, String(values[key])) : params.delete(key));
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
    setView(readView(allowedViews));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [allowedViews, live, sn, scenario]);
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
    return <SurveyScreen config={config} step={view.step} navigate={navigate} onComplete={completeSurvey} homeView={homeView} />;
  }
  if (view.name === 'survey-thanks' && config.survey) return <SurveyThankYouScreen config={config} navigate={navigate} homeView={homeView} />;
  if (live) {
    return <AsinMarketplaceProductScreen config={config} coupons={coupons} modules={landingModules} navigate={navigate} />;
  }
  return <LandingScreen config={config} modules={landingModules} navigate={navigate} live={live} />;
}
