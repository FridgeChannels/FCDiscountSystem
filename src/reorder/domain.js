function asDate(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isSafeAmazonUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'amazon.com' || host.endsWith('.amazon.com'));
  } catch { return false; }
}

export function amazonAsin(value) {
  if (!isSafeAmazonUrl(value)) return '';
  const pathname = new URL(value).pathname;
  return pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase() || '';
}

export function isCouponBoundToProduct(coupon, product) {
  if (!coupon || !product) return false;
  const productAsin = String(product.asin || '').toUpperCase();
  return coupon.sellerId === product.sellerId
    && coupon.eligibleProductIds?.includes(product.id)
    && coupon.eligibleAsins?.map((asin) => String(asin).toUpperCase()).includes(productAsin)
    && amazonAsin(coupon.amazonUrl) === productAsin
    && amazonAsin(product.amazonUrl) === productAsin;
}

export function isSurveyConfigured(survey) {
  if (!survey?.enabled || !survey.id || !survey.version) return false;
  const questions = Array.isArray(survey.questions) ? survey.questions : [];
  return questions.length >= 1 && questions.length <= 3 && questions.every((question) => (
    question.id && question.title && Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 5
  ));
}

export function isCouponEligible(coupon, product, now = new Date()) {
  if (!coupon || coupon.status !== 'active' || !isCouponBoundToProduct(coupon, product)) return false;
  if (coupon.requiresCode && (!coupon.codePoolAvailable || !(coupon.codes || []).length)) return false;
  const current = asDate(now);
  const startsAt = asDate(coupon.startsAt);
  const endsAt = asDate(coupon.endsAt);
  return Boolean(current && startsAt && endsAt && current >= startsAt && current <= endsAt);
}

export function selectEligibleCoupons(coupons, product, now = new Date()) {
  return (coupons || [])
    .filter((coupon) => isCouponEligible(coupon, product, now))
    .sort((left, right) => (left.priority ?? 999) - (right.priority ?? 999));
}

export function getCouponCode(coupon, fcId = '') {
  if (!coupon?.requiresCode) return '';
  const codes = coupon.codes || [];
  if (!codes.length) return '';
  const index = [...String(fcId)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % codes.length;
  return codes[index];
}

export function couponMode(coupon, survey) {
  if (!coupon?.requiresSurvey) return 'direct';
  return isSurveyConfigured(survey) ? 'linked' : 'unavailable';
}

export function composeConsumerModules({ survey, coupons, products = [], currentProductId, fallbackToVoluntarySurvey = false, fallbackToDirectCoupon = false, now = new Date() }) {
  const product = products.find((item) => item.id === currentProductId);
  const eligible = selectEligibleCoupons(coupons, product, now);
  const surveyActive = isSurveyConfigured(survey);
  const hasConfiguredLinkedCoupon = (coupons || []).some((coupon) => coupon.requiresSurvey && isCouponBoundToProduct(coupon, product));
  const directCoupons = eligible.filter((coupon) => couponMode(coupon, survey) === 'direct');
  const linkedCoupons = eligible.filter((coupon) => couponMode(coupon, survey) === 'linked');
  const fallbackCoupons = !surveyActive && fallbackToDirectCoupon
    ? eligible.filter((coupon) => coupon.requiresSurvey)
    : [];
  const immediateCoupons = [...directCoupons, ...fallbackCoupons].map((coupon) => (
    fallbackCoupons.includes(coupon) ? { ...coupon, requiresSurvey: false } : coupon
  ));
  return {
    immediateCoupons,
    gatedCoupons: linkedCoupons,
    showVoluntarySurvey: surveyActive && (directCoupons.length > 0 || !hasConfiguredLinkedCoupon || fallbackToVoluntarySurvey),
    surveyActive,
  };
}

export function surveyProgressKey(fcId, surveyId) {
  return `fc-reorder:survey-progress:${fcId}:${surveyId}`;
}

export function surveyResponseKey(fcId, surveyId) {
  return `fc-reorder:survey-response:${fcId}:${surveyId}`;
}
