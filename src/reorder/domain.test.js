import test from 'node:test';
import assert from 'node:assert/strict';
import { amazonAsin, composeConsumerModules, couponMode, getCouponCode, isCouponBoundToProduct, isCouponEligible, isSafeAmazonUrl, isSurveyConfigured, selectEligibleCoupons } from './domain.js';

const NOW = new Date('2026-08-31T08:00:00.000Z');
const survey = { id: 'survey-1', version: 'v1', enabled: true, questions: [{ id: 'one', title: 'One', options: [{ id: 'a' }, { id: 'b' }] }, { id: 'two', title: 'Two', options: [{ id: 'a' }, { id: 'b' }] }] };
const product = { id: 'original', sellerId: 'seller-morrow', asin: 'B0FCSEA001', amazonUrl: 'https://www.amazon.com/dp/B0FCSEA001?tag=fc' };
const coupon = (extra = {}) => ({ id: 'coupon-1', sellerId: 'seller-morrow', status: 'active', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-30T23:59:59.000Z', eligibleProductIds: ['original'], eligibleAsins: ['B0FCSEA001'], amazonUrl: 'https://www.amazon.com/dp/B0FCSEA001?tag=fc', requiresCode: true, codePoolAvailable: true, codes: ['SAVE10'], requiresSurvey: false, priority: 1, ...extra });
const base = { currentProductId: 'original', products: [product], now: NOW, fallbackToVoluntarySurvey: false, fallbackToDirectCoupon: false };

test('Amazon destination accepts configured Amazon HTTPS URLs only', () => {
  assert.equal(isSafeAmazonUrl('https://www.amazon.com/dp/B001?tag=fc'), true);
  assert.equal(isSafeAmazonUrl('http://www.amazon.com/dp/B001'), false);
  assert.equal(isSafeAmazonUrl('https://amazon.example.com/dp/B001'), false);
});

test('Coupon binding requires the same seller, ASIN and Amazon destination', () => {
  assert.equal(amazonAsin(product.amazonUrl), product.asin);
  assert.equal(isCouponBoundToProduct(coupon(), product), true);
  assert.equal(isCouponBoundToProduct(coupon({ sellerId: 'seller-other' }), product), false);
  assert.equal(isCouponBoundToProduct(coupon({ eligibleAsins: ['B0FCCHI002'] }), product), false);
  assert.equal(isCouponBoundToProduct(coupon({ amazonUrl: 'https://www.amazon.com/dp/B0FCCHI002' }), product), false);
  assert.equal(isCouponBoundToProduct(coupon({ amazonUrl: 'http://www.amazon.com/dp/B0FCSEA001' }), product), false);
});

test('Survey is a standalone module with one to three questions', () => {
  assert.equal(isSurveyConfigured(survey), true);
  assert.equal(isSurveyConfigured({ ...survey, questions: [] }), false);
  assert.equal(isSurveyConfigured({ ...survey, questions: [...survey.questions, { id: '3', title: '3', options: [{ id: 'a' }, { id: 'b' }] }, { id: '4', title: '4', options: [{ id: 'a' }, { id: 'b' }] }] }), false);
  assert.equal(isSurveyConfigured({ ...survey, enabled: false }), false);
});

test('Coupon eligibility checks dates, destination, product and code pool', () => {
  assert.equal(isCouponEligible(coupon(), product, NOW), true);
  assert.equal(isCouponEligible(coupon({ eligibleProductIds: ['other'] }), product, NOW), false);
  assert.equal(isCouponEligible(coupon({ codes: [] }), product, NOW), false);
  assert.equal(isCouponEligible(coupon({ status: 'ended' }), product, NOW), false);
});

test('five consumer module states compose correctly', () => {
  assert.deepEqual(composeConsumerModules({ ...base, survey: null, coupons: [] }), { immediateCoupons: [], gatedCoupons: [], showVoluntarySurvey: false, surveyActive: false });
  const couponOnly = composeConsumerModules({ ...base, survey: null, coupons: [coupon()] });
  assert.equal(couponOnly.immediateCoupons[0].requiresSurvey, false);
  assert.equal(couponOnly.gatedCoupons.length, 0);
  assert.equal(couponOnly.showVoluntarySurvey, false);
  const surveyOnly = composeConsumerModules({ ...base, survey, coupons: [] });
  assert.equal(surveyOnly.showVoluntarySurvey, true);
  const combined = composeConsumerModules({ ...base, survey, coupons: [coupon()] });
  assert.equal(combined.immediateCoupons.length, 1);
  assert.equal(combined.gatedCoupons.length, 0);
  assert.equal(combined.showVoluntarySurvey, true);
  const linked = composeConsumerModules({ ...base, survey, coupons: [coupon({ requiresSurvey: true })] });
  assert.equal(linked.immediateCoupons.length, 0);
  assert.equal(linked.gatedCoupons[0].requiresSurvey, true);
  assert.equal(linked.showVoluntarySurvey, false);
});

test('linked Coupon can use configured fallbacks when Survey closes', () => {
  const linked = coupon({ requiresSurvey: true });
  assert.equal(couponMode(linked, null), 'unavailable');
  const fallback = composeConsumerModules({ ...base, survey: null, coupons: [linked], fallbackToDirectCoupon: true });
  assert.equal(fallback.immediateCoupons[0].requiresSurvey, false);
  assert.equal(fallback.gatedCoupons.length, 0);
  assert.equal(getCouponCode(linked, 'FC-1'), 'SAVE10');
});

test('an unavailable linked Coupon does not turn into a voluntary Survey without explicit fallback', () => {
  const expiredLinked = coupon({ requiresSurvey: true, status: 'ended' });
  assert.equal(composeConsumerModules({ ...base, survey, coupons: [expiredLinked] }).showVoluntarySurvey, false);
  assert.equal(composeConsumerModules({ ...base, survey, coupons: [expiredLinked], fallbackToVoluntarySurvey: true }).showVoluntarySurvey, true);
});

test('a Coupon with a mismatched purchase binding is hidden from both placement groups', () => {
  const result = composeConsumerModules({ ...base, survey, coupons: [coupon({ sellerId: 'seller-other', requiresSurvey: true })] });
  assert.equal(result.immediateCoupons.length, 0);
  assert.equal(result.gatedCoupons.length, 0);
  assert.equal(result.showVoluntarySurvey, true);
});

test('multiple Coupons retain deterministic priority order', () => {
  const result = selectEligibleCoupons([coupon({ id: 'low', priority: 2 }), coupon({ id: 'high', priority: 1, codes: ['SAVE15'] })], product, NOW);
  assert.deepEqual(result.map((item) => item.id), ['high', 'low']);
});
