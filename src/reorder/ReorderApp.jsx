import { useCallback, useEffect, useState } from 'react';
import { composeConsumerModules, getCouponCode, isSafeAmazonUrl } from './domain.js';
import { clearSurveyProgress, emitTelemetry, readSurveyProgress, resolveFcConfiguration, resolveFcId, resolveScenario, writeSurveyProgress, writeSurveyResponse } from './reorderService.js';
import './reorder.css';

const VALID_VIEWS = new Set(['landing', 'coupon-list', 'survey', 'coupon-survey', 'coupon-reveal', 'survey-thanks']);

function readView() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('view') || 'landing';
  return { name: VALID_VIEWS.has(name) ? name : 'landing', step: Math.max(0, Number(params.get('step') || 0)), coupon: params.get('coupon') || '' };
}

function Icon({ name, size = 24 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (name === 'check') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
  if (name === 'calendar') return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
  if (name === 'box') return <svg {...common}><path d="m4 7 8-4 8 4v10l-8 4-8-4Z" /><path d="m4 7 8 4 8-4M12 11v10" /></svg>;
  if (name === 'person') return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>;
  if (name === 'ticket') return <svg {...common}><path d="M4 7a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4Z" /><path d="M12 8v8" /></svg>;
  if (name === 'store') return <svg {...common}><path d="M4 10h16v10H4Z" /><path d="M3 10 5 4h14l2 6M7 14h4v6H7Z" /></svg>;
  if (name === 'lock') return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === 'amazon') return <svg width={size + 8} height={size} viewBox="0 0 34 24" fill="none" aria-hidden="true"><text x="2" y="16" fill="currentColor" fontSize="17" fontFamily="Arial, sans-serif" fontWeight="700">a</text><path d="M3 18c7 5 18 5 27-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="m26 15 5 2-4 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return null;
}

function BrandHeader({ brand, onBack }) {
  return <header className="brand-header">{onBack ? <button className="back-button" type="button" onClick={onBack} aria-label="Back"><Icon name="back" size={30} /></button> : <span className="brand-header__spacer" />}<div className="wordmark">{brand.logoText}</div><span className="brand-header__spacer" /></header>;
}

function ProductArt({ product, size = 'hero' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product?.image]);
  if (failed || !product?.image) return <div className={`product-art product-art--${size} product-placeholder`} role="img" aria-label="Product image unavailable"><span className="placeholder-leaf">◇</span></div>;
  return <div className={`product-art product-art--${size} product-art--${product.id}`}><img src={product.image} alt={`${product.name}, ${product.variant}`} onError={() => setFailed(true)} /></div>;
}

function AmazonCta({ product, brand, children, onBeforeOpen }) {
  const [opening, setOpening] = useState(false);
  const valid = isSafeAmazonUrl(product?.amazonUrl);
  const open = async () => {
    if (!valid || opening) return;
    setOpening(true);
    if (onBeforeOpen) await onBeforeOpen();
    emitTelemetry('amazon_navigation_started', { productId: product.id, destination: product.amazonUrl });
    window.setTimeout(() => window.location.assign(product.amazonUrl), 420);
  };
  if (!valid) return <button className="amazon-button amazon-button--disabled" type="button" disabled>This purchase link is temporarily unavailable</button>;
  return <button className="amazon-button" type="button" onClick={open} disabled={opening}><span>{opening ? 'Opening Amazon…' : children}</span>{!opening && <span className="amazon-button__icon"><Icon name="amazon" size={24} /></span>}</button>;
}

function useCouponCopy(coupon, fcId, productId) {
  const [copied, setCopied] = useState(false);
  const code = getCouponCode(coupon, fcId);
  const copy = async () => {
    if (!code) return false;
    try { await navigator.clipboard.writeText(code); }
    catch {
      const field = document.createElement('textarea');
      field.value = code; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.appendChild(field); field.select(); const didCopy = document.execCommand?.('copy'); field.remove();
      if (!didCopy) return false;
    }
    setCopied(true); emitTelemetry('coupon_code_copied', { couponId: coupon.id, productId });
    return true;
  };
  return { code, copied, copy };
}

function CouponTerms({ coupon, product, detailed = false }) {
  const terms = coupon.terms;
  if (!detailed) return <><span className="coupon-claim-card__terms">Valid through {terms.validThrough} · {terms.usageLimit}</span><span className="coupon-claim-card__terms">{terms.stackingRule}</span></>;
  return <ul className="coupon-detail-list"><li><Icon name="calendar" size={28} /><span>Valid through {terms.validThrough}</span></li><li><Icon name="box" size={28} /><span>{product.name} · {product.variant} only</span></li><li><Icon name="person" size={28} /><span>{terms.usageLimit}</span></li><li><Icon name="ticket" size={28} /><span>{terms.stackingRule}</span></li><li><Icon name="store" size={28} /><span>Sold by {terms.sellerName}</span></li></ul>;
}

function LinkedCouponCard({ coupon, product, questionCount, navigate }) {
  const seconds = Math.max(10, questionCount * 5);
  return <button className="coupon-claim-card" type="button" onClick={() => navigate('coupon-survey', { coupon: coupon.id, step: 0 })}><span className="coupon-claim-card__benefit">{coupon.benefit} on Amazon</span><span className="coupon-claim-card__applies">Applies to this {product.variant} only</span><CouponTerms coupon={coupon} product={product} /><span className="coupon-claim-card__rule" /><span className="coupon-claim-card__guidance"><span className="coupon-claim-card__time"><Icon name="clock" size={28} /><span>Answer {questionCount} quick questions to get your coupon code.<small>About {seconds} seconds</small></span></span><span className="coupon-claim-card__action">Get coupon <Icon name="chevron" size={26} /></span></span></button>;
}

function DirectCouponCard({ coupon, product, fcId }) {
  const { code, copied, copy } = useCouponCopy(coupon, fcId, product.id);
  return <section className="direct-coupon-card" aria-label="Available coupon"><span className="coupon-claim-card__benefit">{coupon.benefit} on Amazon</span><span className="coupon-claim-card__applies">Applies to this {product.variant} only</span>{code && <div className="direct-coupon-card__code"><span>Code: <b>{code}</b></span><button type="button" onClick={copy}>{copied ? 'Code copied' : 'Copy code'}</button></div>}<CouponTerms coupon={coupon} product={product} /></section>;
}

function CouponSummary({ coupons, navigate }) {
  return <button className="coupon-summary" type="button" onClick={() => navigate('coupon-list')}><span><strong>{coupons.length} coupons available</strong><small>Choose the coupon that fits your order.</small></span><span className="coupon-summary__action">View coupons <Icon name="chevron" size={24} /></span></button>;
}

function VoluntarySurveyCard({ survey, navigate }) {
  const seconds = Math.max(10, survey.questions.length * 5);
  return <button className="voluntary-survey-card" type="button" onClick={() => navigate('survey', { step: 0 })}><span>Help shape what’s next</span><small>{survey.description}</small><em>{survey.questions.length} quick questions · About {seconds} seconds</em><strong>Share your preferences <Icon name="chevron" size={22} /></strong></button>;
}

function LandingScreen({ config, navigate }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  const modules = composeConsumerModules({ ...config, now: new Date() });
  const coupon = modules.coupons[0];
  return <main className="screen landing-screen"><BrandHeader brand={config.brand} /><ProductArt product={product} /><div className="product-info"><p className="product-name">{product.name}</p><p className="product-variant">{product.variant}</p></div><section className="reorder-copy"><h1>Need more?</h1></section>{modules.coupons.length === 1 && (coupon.requiresSurvey ? <LinkedCouponCard coupon={coupon} product={product} questionCount={config.survey.questions.length} navigate={navigate} /> : <DirectCouponCard coupon={coupon} product={product} fcId={config.fcId} />)}{modules.coupons.length > 1 && <CouponSummary coupons={modules.coupons} navigate={navigate} />}{config.couponLoadError && <p className="coupon-load-error">Couldn’t load the coupon. You can still buy on Amazon.</p>}<AmazonCta product={product} brand={config.brand}>Buy again on Amazon</AmazonCta><p className="amazon-reassurance"><Icon name="lock" size={18} /> Opens Amazon</p>{modules.showVoluntarySurvey && <VoluntarySurveyCard survey={config.survey} navigate={navigate} />}<a className="explore-brand-link" href={config.brand.amazonStoreUrl}>Explore more from {config.brand.name} <Icon name="chevron" size={22} /></a></main>;
}

function CouponListItem({ config, coupon, product, navigate }) {
  const { code, copied, copy } = useCouponCopy(coupon, config.fcId, product.id);
  if (coupon.requiresSurvey) return <button className="coupon-choice" type="button" onClick={() => navigate('coupon-survey', { coupon: coupon.id, step: 0 })}><span><strong>{coupon.benefit}</strong><small>Answer {config.survey.questions.length} questions to get the code</small></span><Icon name="chevron" size={28} /></button>;
  return <section className="coupon-choice coupon-choice--direct" aria-label={`${coupon.benefit} coupon`}><div className="coupon-choice__heading"><strong>{coupon.benefit}</strong><span>Available now</span></div>{code && <div className="coupon-choice__code"><code>{code}</code><button type="button" onClick={copy}>{copied ? 'Code copied' : 'Copy code'}</button></div>}<div className="coupon-choice__terms"><CouponTerms coupon={coupon} product={product} /></div></section>;
}

function CouponListScreen({ config, coupons, navigate }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  return <main className="screen coupon-list-screen"><BrandHeader brand={config.brand} onBack={() => navigate('landing')} /><section className="coupon-list-heading"><h1>Available coupons</h1></section><div className="coupon-product-row"><ProductArt product={product} size="thumb" /><p><strong>{product.name}</strong><span>{product.variant}</span></p></div><div className="coupon-list">{coupons.map((coupon) => <CouponListItem key={coupon.id} config={config} coupon={coupon} product={product} navigate={navigate} />)}</div><div className="coupon-list-shop"><AmazonCta product={product} brand={config.brand}>Shop on Amazon</AmazonCta><p className="amazon-reassurance"><Icon name="lock" size={18} /> Opens Amazon</p></div></main>;
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
    if (safeStep < survey.questions.length - 1) { writeSurveyProgress(config.fcId, survey.id, { answers: nextAnswers, step: safeStep + 1 }); window.setTimeout(() => navigate(routeName, { coupon: coupon?.id, step: safeStep + 1 }), 130); }
    else { clearSurveyProgress(config.fcId, survey.id); window.setTimeout(() => onComplete(nextAnswers), 130); }
  };
  const back = () => safeStep === 0 ? navigate('landing') : navigate(routeName, { coupon: coupon?.id, step: safeStep - 1 });
  return <main className="screen survey-screen"><header className="survey-header"><button className="icon-back" type="button" onClick={back} aria-label="Back"><Icon name="back" size={34} /></button><div className="wordmark">{config.brand.logoText}</div><span className="survey-count">{safeStep + 1} of {survey.questions.length}</span></header><div className="progress-track"><span style={{ width: `${((safeStep + 1) / survey.questions.length) * 100}%` }} /></div><section className="question-copy"><h1>{question.title}</h1>{question.help && <p>{question.help}</p>}</section><div className="answer-list">{question.options.map((option) => <button className={answers[question.id] === option.id ? 'answer-option answer-option--selected' : 'answer-option'} key={option.id} type="button" onClick={() => choose(option)}><span>{option.label}</span><Icon name="chevron" size={28} /></button>)}</div><p className="survey-hint">Tap one answer to continue</p></main>;
}

function CouponRevealScreen({ config, coupon, navigate }) {
  const product = config.products.find((item) => coupon.eligibleProductIds.includes(item.id));
  const { code, copied, copy } = useCouponCopy(coupon, config.fcId, product.id);
  const copyThenShop = async () => { await copy(); await new Promise((resolve) => window.setTimeout(resolve, 450)); };
  return <main className="screen coupon-reveal-screen"><BrandHeader brand={config.brand} onBack={() => navigate('landing')} /><section className="coupon-reveal-hero"><Icon name="check" size={64} /><p>Your coupon is ready</p><h1>{coupon.benefit}</h1></section><div className="coupon-reveal-product"><ProductArt product={product} size="thumb" /><p>{product.name} · {product.variant}</p></div><h2 className="coupon-reveal-section-title">Your code</h2>{code ? <section className="coupon-reveal-code"><code>{code}</code><button type="button" onClick={copy}>{copied ? 'Code copied' : 'Copy code'}</button></section> : <p className="coupon-reveal-auto">Amazon applies this coupon automatically at checkout.</p>}{code && <p className="coupon-reveal-instruction">Apply this code at Amazon checkout.</p>}<h2 className="coupon-reveal-section-title">Coupon details</h2><CouponTerms coupon={coupon} product={product} detailed /><AmazonCta product={product} brand={config.brand} onBeforeOpen={copyThenShop}>{code ? 'Copy code & shop on Amazon' : 'Shop on Amazon'}</AmazonCta><p className="coupon-shop-note"><Icon name="lock" size={22} />{code ? 'Copies your code, then opens Amazon.' : 'Opens Amazon.'}</p></main>;
}

function SurveyThankYouScreen({ config, navigate }) {
  return <main className="screen survey-thanks-screen"><BrandHeader brand={config.brand} onBack={() => navigate('landing')} /><Icon name="check" size={64} /><h1>Thanks for sharing</h1><p>{config.survey.completionMessage}</p><button className="coupon-primary-button" type="button" onClick={() => navigate('landing')}>Back to FC Reorder</button></main>;
}

function LoadingScreen() { return <main className="screen state-screen loading-screen" aria-busy="true"><BrandHeader brand={{ logoText: 'FC' }} /><div className="skeleton skeleton-product" /><div className="skeleton skeleton-name" /><div className="skeleton skeleton-button" /><p>Loading product…</p></main>; }
function InvalidScreen({ config }) { const brand = config?.brand || { logoText: 'FC', name: 'Brand' }; return <main className="screen state-screen invalid-screen"><BrandHeader brand={brand} /><h1>We can’t find this product.</h1><p>This FC link may be unavailable.</p><a className="state-secondary" href={brand.amazonStoreUrl}>Visit {brand.name} on Amazon</a></main>; }

export default function ReorderApp() {
  const [view, setView] = useState(readView);
  const [resolved, setResolved] = useState({ status: 'resolving', config: null });
  const fcId = resolveFcId(); const scenario = resolveScenario();
  useEffect(() => { let active = true; setResolved({ status: 'resolving', config: null }); resolveFcConfiguration({ fcId, scenario }).then((config) => active && setResolved({ status: config.status, config })).catch(() => active && setResolved({ status: 'invalid', config: null })); return () => { active = false; }; }, [fcId, scenario]);
  useEffect(() => { const sync = () => setView(readView()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  const navigate = useCallback((name, values = {}) => { const params = new URLSearchParams(window.location.search); if (name === 'landing') params.delete('view'); else params.set('view', name); ['step', 'coupon'].forEach((key) => values[key] != null ? params.set(key, String(values[key])) : params.delete(key)); window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`); setView(readView()); window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  if (resolved.status === 'resolving') return <LoadingScreen />;
  if (resolved.status === 'invalid') return <InvalidScreen config={resolved.config} />;
  const config = resolved.config; const modules = composeConsumerModules({ ...config, now: new Date() });
  const selectedCoupon = modules.coupons.find((coupon) => coupon.id === view.coupon) || modules.coupons[0] || null;
  const completeSurvey = (coupon) => (answers) => { const response = { fcId: config.fcId, brandId: config.brand.id, productId: config.currentProductId, surveyId: config.survey.id, couponId: coupon?.id || null, sessionId: window.crypto?.randomUUID?.() || `${Date.now()}`, answers, completedAt: new Date().toISOString() }; writeSurveyResponse(config.fcId, config.survey.id, response); emitTelemetry('survey_completed', response); navigate(coupon ? 'coupon-reveal' : 'survey-thanks', coupon ? { coupon: coupon.id } : {}); };
  if (view.name === 'coupon-list') return <CouponListScreen config={config} coupons={modules.coupons} navigate={navigate} />;
  if (view.name === 'coupon-reveal' && selectedCoupon) return <CouponRevealScreen config={config} coupon={selectedCoupon} navigate={navigate} />;
  if (view.name === 'coupon-survey' && selectedCoupon && selectedCoupon.requiresSurvey && modules.surveyActive) return <SurveyScreen config={config} coupon={selectedCoupon} step={view.step} navigate={navigate} onComplete={completeSurvey(selectedCoupon)} />;
  if (view.name === 'survey' && modules.showVoluntarySurvey) return <SurveyScreen config={config} step={view.step} navigate={navigate} onComplete={completeSurvey(null)} />;
  if (view.name === 'survey-thanks' && config.survey) return <SurveyThankYouScreen config={config} navigate={navigate} />;
  return <LandingScreen config={config} navigate={navigate} />;
}
