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

export function isSurveyConfigured(survey) {
  if (!survey?.enabled || !survey.id || !survey.version) return false;
  const questions = Array.isArray(survey.questions) ? survey.questions : [];
  return questions.length >= 1 && questions.length <= 3 && questions.every((question) => (
    question.id && question.title && Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 5
  ));
}

export function isCouponEligible(coupon, productId, now = new Date()) {
  if (!coupon || coupon.status !== 'active' || !coupon.eligibleProductIds?.includes(productId)) return false;
  if (!isSafeAmazonUrl(coupon.amazonUrl)) return false;
  if (coupon.requiresCode && (!coupon.codePoolAvailable || !(coupon.codes || []).length)) return false;
  const current = asDate(now);
  const startsAt = asDate(coupon.startsAt);
  const endsAt = asDate(coupon.endsAt);
  return Boolean(current && startsAt && endsAt && current >= startsAt && current <= endsAt);
}

export function selectEligibleCoupons(coupons, productId, now = new Date()) {
  return (coupons || [])
    .filter((coupon) => isCouponEligible(coupon, productId, now))
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

export function composeConsumerModules({ survey, coupons, currentProductId, fallbackToVoluntarySurvey = false, fallbackToDirectCoupon = false, now = new Date() }) {
  const eligible = selectEligibleCoupons(coupons, currentProductId, now);
  const surveyActive = isSurveyConfigured(survey);
  const hasConfiguredLinkedCoupon = (coupons || []).some((coupon) => coupon.requiresSurvey && coupon.eligibleProductIds?.includes(currentProductId));
  const directCoupons = eligible.filter((coupon) => couponMode(coupon, survey) === 'direct');
  const linkedCoupons = eligible.filter((coupon) => couponMode(coupon, survey) === 'linked');
  const fallbackCoupons = !surveyActive && fallbackToDirectCoupon
    ? eligible.filter((coupon) => coupon.requiresSurvey)
    : [];
  const visibleCoupons = [...directCoupons, ...linkedCoupons, ...fallbackCoupons].map((coupon) => (
    fallbackCoupons.includes(coupon) ? { ...coupon, requiresSurvey: false } : coupon
  ));
  return {
    coupons: visibleCoupons,
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
