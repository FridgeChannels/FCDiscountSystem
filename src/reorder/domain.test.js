import test from 'node:test';
import assert from 'node:assert/strict';
import { composeConsumerModules, couponMode, getCouponCode, isCouponEligible, isSafeAmazonUrl, isSurveyConfigured, selectEligibleCoupons } from './domain.js';

const NOW = new Date('2026-08-31T08:00:00.000Z');
const survey = { id: 'survey-1', version: 'v1', enabled: true, questions: [{ id: 'one', title: 'One', options: [{ id: 'a' }, { id: 'b' }] }, { id: 'two', title: 'Two', options: [{ id: 'a' }, { id: 'b' }] }] };
const coupon = (extra = {}) => ({ id: 'coupon-1', status: 'active', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-30T23:59:59.000Z', eligibleProductIds: ['original'], amazonUrl: 'https://www.amazon.com/dp/coupon', requiresCode: true, codePoolAvailable: true, codes: ['SAVE10'], requiresSurvey: false, priority: 1, ...extra });
const base = { currentProductId: 'original', now: NOW, fallbackToVoluntarySurvey: false, fallbackToDirectCoupon: false };

test('Amazon destination accepts configured Amazon HTTPS URLs only', () => {
  assert.equal(isSafeAmazonUrl('https://www.amazon.com/dp/B001?tag=fc'), true);
  assert.equal(isSafeAmazonUrl('http://www.amazon.com/dp/B001'), false);
  assert.equal(isSafeAmazonUrl('https://amazon.example.com/dp/B001'), false);
});

test('Survey is a standalone module with one to three questions', () => {
  assert.equal(isSurveyConfigured(survey), true);
  assert.equal(isSurveyConfigured({ ...survey, questions: [] }), false);
  assert.equal(isSurveyConfigured({ ...survey, questions: [...survey.questions, { id: '3', title: '3', options: [{ id: 'a' }, { id: 'b' }] }, { id: '4', title: '4', options: [{ id: 'a' }, { id: 'b' }] }] }), false);
  assert.equal(isSurveyConfigured({ ...survey, enabled: false }), false);
});

test('Coupon eligibility checks dates, destination, product and code pool', () => {
  assert.equal(isCouponEligible(coupon(), 'original', NOW), true);
  assert.equal(isCouponEligible(coupon({ eligibleProductIds: ['other'] }), 'original', NOW), false);
  assert.equal(isCouponEligible(coupon({ codes: [] }), 'original', NOW), false);
  assert.equal(isCouponEligible(coupon({ status: 'ended' }), 'original', NOW), false);
});

test('five consumer module states compose correctly', () => {
  assert.deepEqual(composeConsumerModules({ ...base, survey: null, coupons: [] }), { coupons: [], showVoluntarySurvey: false, surveyActive: false });
  const couponOnly = composeConsumerModules({ ...base, survey: null, coupons: [coupon()] });
  assert.equal(couponOnly.coupons[0].requiresSurvey, false);
  assert.equal(couponOnly.showVoluntarySurvey, false);
  const surveyOnly = composeConsumerModules({ ...base, survey, coupons: [] });
  assert.equal(surveyOnly.showVoluntarySurvey, true);
  const combined = composeConsumerModules({ ...base, survey, coupons: [coupon()] });
  assert.equal(combined.coupons.length, 1);
  assert.equal(combined.showVoluntarySurvey, true);
  const linked = composeConsumerModules({ ...base, survey, coupons: [coupon({ requiresSurvey: true })] });
  assert.equal(linked.coupons[0].requiresSurvey, true);
  assert.equal(linked.showVoluntarySurvey, false);
});

test('linked Coupon can use configured fallbacks when Survey closes', () => {
  const linked = coupon({ requiresSurvey: true });
  assert.equal(couponMode(linked, null), 'unavailable');
  const fallback = composeConsumerModules({ ...base, survey: null, coupons: [linked], fallbackToDirectCoupon: true });
  assert.equal(fallback.coupons[0].requiresSurvey, false);
  assert.equal(getCouponCode(linked, 'FC-1'), 'SAVE10');
});

test('an unavailable linked Coupon does not turn into a voluntary Survey without explicit fallback', () => {
  const expiredLinked = coupon({ requiresSurvey: true, status: 'ended' });
  assert.equal(composeConsumerModules({ ...base, survey, coupons: [expiredLinked] }).showVoluntarySurvey, false);
  assert.equal(composeConsumerModules({ ...base, survey, coupons: [expiredLinked], fallbackToVoluntarySurvey: true }).showVoluntarySurvey, true);
});

test('multiple Coupons retain deterministic priority order', () => {
  const result = selectEligibleCoupons([coupon({ id: 'low', priority: 2 }), coupon({ id: 'high', priority: 1, codes: ['SAVE15'] })], 'original', NOW);
  assert.deepEqual(result.map((item) => item.id), ['high', 'low']);
});
