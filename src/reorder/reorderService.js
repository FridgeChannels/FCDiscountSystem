import { buildScenario, SCENARIO_NAMES } from './fixtures.js';
import { surveyProgressKey, surveyResponseKey } from './domain.js';

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function readJson(storage, key, fallback = null) {
  try { return JSON.parse(storage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function resolveFcId(location = window.location) {
  const pathMatch = location.pathname.match(/\/(?:r|p|t)\/([^/?#]+)/i);
  return decodeURIComponent(pathMatch?.[1] || new URLSearchParams(location.search).get('fc') || 'PURA-SEA-SALT-001');
}

export function resolveScenario(location = window.location) {
  const params = new URLSearchParams(location.search);
  const legacy = params.get('screen');
  if (legacy === 'invalid') return 'invalid';
  if (legacy === 'replacement') return 'discontinued';
  const scenario = params.get('scenario');
  return SCENARIO_NAMES.includes(scenario) ? scenario : 'landing';
}

export function isScenarioPreview(location = window.location) {
  return new URLSearchParams(location.search).has('scenario');
}

export function mapConsumerExperienceToConfig(experience, fcId) {
  if (!experience || experience.state === 'invalid_fc') {
    return { status: 'invalid', fcId, brand: experience?.brand || null };
  }

  const product = experience.product || {};
  const brand = experience.brand || {};
  const amazon = experience.amazon || {};
  const savings = Array.isArray(experience.availableSavings) ? experience.availableSavings : [];
  const survey = experience.survey || null;

  const mappedProduct = {
    id: product.id || 'product',
    sellerId: amazon.sellerId || amazon.sellingAccountId || 'seller',
    sku: product.asin || '',
    asin: product.asin || '',
    name: product.name || 'Product',
    variant: product.variant || '',
    image: product.imageUrl || '',
    amazonUrl: experience.primaryCta || product.attributionUrl || '',
  };

  const coupons = savings.map((discount, index) => ({
    id: discount.id,
    sellerId: mappedProduct.sellerId,
    title: discount.title || discount.benefitSummary,
    benefit: discount.benefitSummary || discount.title || 'Saving',
    status: 'active',
    startsAt: discount.startAt,
    endsAt: discount.endAt,
    eligibleProductIds: [mappedProduct.id],
    eligibleAsins: discount.eligibleAsins || [mappedProduct.asin].filter(Boolean),
    amazonUrl: mappedProduct.amazonUrl,
    requiresCode: Boolean(discount.claimCode) || discount.claimCodeMode === 'group' || discount.claimCodeMode === 'single_use',
    codePoolAvailable: true,
    codes: discount.claimCode ? [discount.claimCode] : [],
    claimCode: discount.claimCode || null,
    requiresSurvey: false,
    priority: discount.isFeatured ? 0 : index + 1,
    isFeatured: Boolean(discount.isFeatured),
    terms: {
      validThrough: discount.endAt ? new Date(discount.endAt).toLocaleDateString() : '',
      usageLimit: '',
      stackingRule: '',
      sellerName: amazon.sellerLabel || brand.name || '',
    },
  }));

  const mappedSurvey = survey
    ? {
        id: survey.id,
        version: 'live',
        enabled: true,
        title: survey.title,
        description: survey.description,
        completionMessage: survey.description || 'Thanks for sharing your feedback.',
        questions: (survey.questions || []).map((question) => ({
          id: question.id,
          title: question.prompt || question.title,
          help: '',
          options: (question.options || []).map((option) => ({
            id: option.id,
            label: option.label,
          })),
        })),
      }
    : null;

  return {
    status: experience.state === 'product_unavailable' ? 'ready' : (experience.state || 'ready'),
    productUnavailable: experience.state === 'product_unavailable',
    fcId,
    brand: {
      id: amazon.sellingAccountId || 'brand',
      name: brand.name || 'Brand',
      logoText: brand.name || 'Brand',
      logoImage: brand.logoUrl || '',
      amazonStoreUrl: experience.fallback?.url || amazon.storefrontUrl || '',
      contactUrl: '',
      colors: { primary: '#004d3d', accent: '#ff8a00' },
    },
    currentProductId: mappedProduct.id,
    products: [mappedProduct],
    survey: mappedSurvey,
    coupons,
    primaryCta: experience.primaryCta || null,
    fallbackToVoluntarySurvey: false,
    fallbackToDirectCoupon: false,
  };
}

export async function fetchReorderConsumerExperience(fcId, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`/api/reorder/consumer/${encodeURIComponent(fcId)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`consumer_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function resolveFcConfiguration({ fcId, scenario, mode = 'preview' }) {
  if (mode === 'live' || (!isScenarioPreview() && mode !== 'preview')) {
    const experience = await fetchReorderConsumerExperience(fcId);
    if (!experience) return { status: 'invalid', fcId, brand: null };
    return mapConsumerExperienceToConfig(experience, fcId);
  }
  await wait(420);
  return { ...buildScenario(scenario), fcId };
}

export async function startReorderSurvey(fcId, surveyId, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`/api/reorder/consumer/${encodeURIComponent(fcId)}/surveys/${encodeURIComponent(surveyId)}/start`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(`survey_start_${response.status}`);
  return response.json();
}

export async function submitReorderSurvey(fcId, surveyId, body, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`/api/reorder/consumer/${encodeURIComponent(fcId)}/surveys/${encodeURIComponent(surveyId)}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`survey_submit_${response.status}`);
  return response.json();
}

export async function markClaimCodeCopied(fcId, discountId, { fetchImpl = fetch } = {}) {
  await fetchImpl(`/api/reorder/consumer/${encodeURIComponent(fcId)}/discounts/${encodeURIComponent(discountId)}/copied`, {
    method: 'POST',
  }).catch(() => {});
}

export function emitTelemetry(eventType, payload = {}) {
  const key = 'fc-reorder:telemetry';
  const events = readJson(sessionStorage, key, []);
  events.push({ eventType, payload, occurredAt: new Date().toISOString() });
  writeJson(sessionStorage, key, events.slice(-100));
}

export const readSurveyProgress = (fcId, surveyId) => readJson(sessionStorage, surveyProgressKey(fcId, surveyId), null);
export const readSurveyResponse = (fcId, surveyId) => readJson(localStorage, surveyResponseKey(fcId, surveyId), null);
export const writeSurveyProgress = (fcId, surveyId, progress) => writeJson(sessionStorage, surveyProgressKey(fcId, surveyId), progress);
export const clearSurveyProgress = (fcId, surveyId) => sessionStorage.removeItem(surveyProgressKey(fcId, surveyId));
export const writeSurveyResponse = (fcId, surveyId, response) => writeJson(localStorage, surveyResponseKey(fcId, surveyId), response);
