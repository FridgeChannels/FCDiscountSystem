import test from 'node:test';
import assert from 'node:assert/strict';
import { mapConsumerExperienceToConfig } from './reorderService.js';

test('T5 maps single saving to one coupon and product CTA', () => {
  const config = mapConsumerExperienceToConfig({
    state: 'ready',
    brand: { name: 'Pura', logoUrl: null },
    product: {
      id: 'p1',
      name: 'Juice',
      imageUrl: 'https://cdn.example.com/a.png',
      asin: 'B0FCSEA001',
      attributionUrl: 'https://www.amazon.com/dp/B0FCSEA001?tag=fc',
    },
    amazon: { sellerId: 'A1', sellerLabel: 'Pura', storefrontUrl: 'https://www.amazon.com/s?me=A1' },
    primaryCta: 'https://www.amazon.com/dp/B0FCSEA001?tag=fc',
    availableSavings: [{
      id: 'd1',
      benefitSummary: '10% off',
      title: '10% off',
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2027-01-01T00:00:00.000Z',
      eligibleAsins: ['B0FCSEA001'],
      claimCode: 'PURA10',
      claimCodeMode: 'group',
      isFeatured: true,
    }],
    survey: null,
    fallback: { url: 'https://www.amazon.com/s?me=A1' },
  }, 'FC001');

  assert.equal(config.status, 'ready');
  assert.equal(config.coupons.length, 1);
  assert.equal(config.coupons[0].claimCode, 'PURA10');
  assert.equal(config.products[0].amazonUrl, 'https://www.amazon.com/dp/B0FCSEA001?tag=fc');
});

test('maps magnet_brand_param payload without asin to product CTA', () => {
  const config = mapConsumerExperienceToConfig({
    state: 'ready',
    source: 'magnet_brand_param',
    brand: { name: 'PURA JUICE', logoUrl: null },
    product: {
      id: 'magnet-brand-99',
      name: 'PURA Orange Juice',
      imageUrl: 'https://cdn.example.com/product.png',
      asin: '',
      attributionUrl: 'https://www.amazon.com/dp/B0FCSEA001?tag=fc',
    },
    amazon: { sellerId: null, sellerLabel: 'PURA JUICE', storefrontUrl: 'https://www.amazon.com/stores/PURA' },
    primaryCta: 'https://www.amazon.com/dp/B0FCSEA001?tag=fc',
    availableSavings: [],
    survey: null,
    fallback: { type: 'seller_storefront', url: 'https://www.amazon.com/stores/PURA' },
  }, '15VZQSHR7R');

  assert.equal(config.status, 'ready');
  assert.equal(config.coupons.length, 0);
  assert.equal(config.products[0].name, 'PURA Orange Juice');
  assert.equal(config.products[0].image, 'https://cdn.example.com/product.png');
  assert.equal(config.products[0].amazonUrl, 'https://www.amazon.com/dp/B0FCSEA001?tag=fc');
  assert.equal(config.brand.amazonStoreUrl, 'https://www.amazon.com/stores/PURA');
});

test('T5 maps multi savings without demo routes in config', () => {
  const config = mapConsumerExperienceToConfig({
    state: 'ready',
    brand: { name: 'Pura' },
    product: { id: 'p1', name: 'Juice', asin: 'B0FCSEA001', attributionUrl: 'https://www.amazon.com/dp/B0FCSEA001' },
    amazon: { sellerId: 'A1' },
    primaryCta: 'https://www.amazon.com/dp/B0FCSEA001',
    availableSavings: [
      { id: 'd1', benefitSummary: 'A', startAt: '2026-01-01T00:00:00.000Z', endAt: '2027-01-01T00:00:00.000Z', eligibleAsins: ['B0FCSEA001'], isFeatured: true },
      { id: 'd2', benefitSummary: 'B', startAt: '2026-01-01T00:00:00.000Z', endAt: '2027-01-01T00:00:00.000Z', eligibleAsins: ['B0FCSEA001'], isFeatured: false },
    ],
    survey: {
      id: 's1',
      title: 'Quick',
      description: 'Thanks',
      questions: [{ id: 'q1', prompt: 'One?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
    },
  }, 'FC002');

  assert.equal(config.coupons.length, 2);
  assert.equal(config.survey.id, 's1');
  assert.equal(config.survey.questions[0].title, 'One?');
});
