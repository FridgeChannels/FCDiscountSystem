const AMAZON_BASE = 'https://www.amazon.com';

export const BASE_BRAND = {
  id: 'morrow', name: 'MORROW', logoText: 'MORROW',
  amazonStoreUrl: `${AMAZON_BASE}/stores/MORROW`, contactUrl: 'mailto:hello@morrow.example',
  colors: { primary: '#004d3d', accent: '#ff8a00' },
};

export const BASE_PRODUCTS = [
  { id: 'sea-salt-crackers', sku: 'MSC-SEA-6', asin: 'B0FCSEA001', name: 'Sea Salt Protein Crackers', variant: '6-pack', image: '/reorder/sea-salt-crackers.png', amazonUrl: `${AMAZON_BASE}/dp/B0FCSEA001?tag=fc-reorder-20` },
  { id: 'smoky-chili-crisps', sku: 'MSC-CHILI-6', asin: 'B0FCCHI002', name: 'Smoky Chili Protein Crisps', variant: '6-pack', image: '/reorder/smoky-chili-crisps.png', amazonUrl: `${AMAZON_BASE}/dp/B0FCCHI002?tag=fc-reorder-20` },
  { id: 'classic-sea-salt-crisps', sku: 'MSC-CLASSIC-6', asin: 'B0FCCLA003', name: 'Classic Sea Salt Protein Crisps', variant: '6-pack', image: '/reorder/classic-sea-salt-crisps.png', amazonUrl: `${AMAZON_BASE}/dp/B0FCCLA003?tag=fc-reorder-20` },
];

export const BASE_SURVEY = {
  id: 'morrow-product-feedback', version: '2026-08-v2', enabled: true,
  title: 'Help shape what’s next',
  description: 'Tell MORROW what matters most when you use this product.',
  completionMessage: 'Your response will help inform future product decisions.',
  questions: [
    { id: 'usage', title: 'When do you usually use this product?', help: 'Choose the answer that fits you best.', options: [{ id: 'breakfast', label: 'At breakfast' }, { id: 'daytime', label: 'During the day' }, { id: 'exercise', label: 'After exercise' }, { id: 'whenever', label: 'Whenever I need it' }] },
    { id: 'priority', title: 'What matters most when choosing it?', help: 'Choose one priority.', options: [{ id: 'taste', label: 'Taste' }, { id: 'ingredients', label: 'Ingredients' }, { id: 'convenience', label: 'Convenience' }, { id: 'price', label: 'Price' }] },
    { id: 'reorder-frequency', title: 'How often do you reorder it?', help: 'Choose the answer that best describes you.', options: [{ id: 'weekly', label: 'About once a week' }, { id: 'monthly', label: 'About once a month' }, { id: 'occasionally', label: 'Every now and then' }, { id: 'first-time', label: 'This is my first time' }] },
  ],
};

const TERMS = {
  validThrough: 'Sep 30, 2026', usageLimit: 'One use per customer', stackingRule: 'Cannot be combined with other coupons', sellerName: 'MORROW Foods',
};

const LINKED_COUPON = {
  id: 'sea-salt-linked-15', title: 'Save 15%', benefit: 'Save 15%', status: 'active',
  startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z',
  eligibleProductIds: ['sea-salt-crackers'], amazonUrl: `${AMAZON_BASE}/dp/B0FCSEA001?tag=fc-reorder-20`,
  requiresCode: true, codePoolAvailable: true, codes: ['SAVE15NOW', 'SAVE15NEXT'], requiresSurvey: true, priority: 1, terms: TERMS,
};

const DIRECT_COUPON = {
  ...LINKED_COUPON, id: 'sea-salt-direct-10', title: '10% off this product', benefit: '10% off this product',
  codes: ['MORROW10', 'MORROW10B'], requiresSurvey: false, priority: 1,
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const baseConfig = () => ({
  status: 'ready', batchId: 'MORROW-2026-08-A', brand: clone(BASE_BRAND), currentProductId: 'sea-salt-crackers',
  products: clone(BASE_PRODUCTS), survey: null, coupons: [], fallbackToVoluntarySurvey: false, fallbackToDirectCoupon: false,
});

export function buildScenario(name = 'linked') {
  const config = baseConfig();
  config.scenario = name;
  if (name === 'survey-only') config.survey = clone(BASE_SURVEY);
  else if (name === 'coupon-only' || name === 'direct-coupon' || name === 'single-coupon') config.coupons = [clone(DIRECT_COUPON)];
  else if (name === 'coupon-survey') { config.survey = clone(BASE_SURVEY); config.coupons = [clone(DIRECT_COUPON)]; }
  else if (name === 'linked' || name === 'coupon-finder') { config.survey = clone(BASE_SURVEY); config.coupons = [clone(LINKED_COUPON)]; }
  else if (name === 'multi-coupon') {
    config.coupons = [
      clone(DIRECT_COUPON),
      { ...clone(DIRECT_COUPON), id: 'sea-salt-direct-5', benefit: '$5 off 2 packs', codes: ['SAVE5PACKS'], priority: 2 },
      { ...clone(DIRECT_COUPON), id: 'sea-salt-direct-15', benefit: 'Save 15% on 3', codes: ['SAVE15ON3'], priority: 3 },
    ];
  }
  else if (name === 'linked-fallback-survey') { config.survey = clone(BASE_SURVEY); config.coupons = [{ ...clone(LINKED_COUPON), status: 'ended' }]; config.fallbackToVoluntarySurvey = true; }
  else if (name === 'linked-fallback-direct') { config.coupons = [clone(LINKED_COUPON)]; config.fallbackToDirectCoupon = true; }
  else if (name === 'coupon-unavailable') config.couponLoadError = true;
  else if (name === 'survey-closed') { config.survey = { ...clone(BASE_SURVEY), enabled: false }; }
  else if (name === 'discontinued') { config.status = 'discontinued'; config.replacementProductId = 'classic-sea-salt-crisps'; }
  else if (name === 'invalid') return { status: 'invalid', brand: clone(BASE_BRAND) };
  return config;
}
