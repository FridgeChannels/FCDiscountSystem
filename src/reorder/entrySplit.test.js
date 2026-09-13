import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('T4/T5 live entry uses ExperienceRoot and dedicated experience API', () => {
  const main = readFileSync(resolve('src/main.jsx'), 'utf8');
  const root = readFileSync(resolve('src/ExperienceRoot.jsx'), 'utf8');
  const vite = readFileSync(resolve('vite.config.js'), 'utf8');
  const app = readFileSync(resolve('src/reorder/ReorderApp.jsx'), 'utf8');
  const dtcApp = readFileSync(resolve('src/App.jsx'), 'utf8');

  assert.match(main, /ExperienceRoot/);
  assert.match(root, /fetchFcExperience/);
  assert.match(root, /fc-logo\.svg/);
  assert.match(root, /resolveFcConfiguration/);
  assert.match(root, /skipEntryGiftIntro/);
  assert.doesNotMatch(root, /\/api\/reorder\/consumer/);
  assert.match(vite, /\/api\/fc\/experience/);
  assert.match(vite, /\/api\/reorder/);
  assert.match(app, /LIVE_VIEWS/);
  assert.match(app, /initialResolved/);
  assert.match(dtcApp, /skipEntryGiftIntro/);
  assert.doesNotMatch(app, /onOpenDemo=\{\(\) => navigate\('amazon-product'\)\}/);
});
