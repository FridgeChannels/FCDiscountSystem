import test from 'node:test';
import assert from 'node:assert/strict';
import { isScenarioPreview, resolveScenario } from './reorderService.js';

test('only supported scenarios are routable', () => {
  assert.equal(resolveScenario({ search: '?scenario=landing' }), 'landing');
  assert.equal(resolveScenario({ search: '?scenario=direct-coupon' }), 'direct-coupon');
  assert.equal(resolveScenario({ search: '?scenario=coupon-finder' }), 'landing');
  assert.equal(resolveScenario({ search: '?scenario=linked' }), 'landing');
  assert.equal(resolveScenario({ search: '?scenario=single-coupon' }), 'landing');
  assert.equal(resolveScenario({ search: '?scenario=survey-closed' }), 'landing');
  assert.equal(resolveScenario({ search: '?scenario=coupon-unavailable' }), 'landing');
});

test('scenario links are always treated as preview entries', () => {
  assert.equal(isScenarioPreview({ search: '?scenario=survey-only' }), true);
  assert.equal(isScenarioPreview({ search: '?fc=MORROW-SEA-SALT-001' }), false);
});
