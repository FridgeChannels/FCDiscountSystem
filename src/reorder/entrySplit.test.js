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
  assert.match(root, /brandLogo/);
  assert.match(root, /waitingForLogo|logoSettled/);
  assert.match(root, /ExperienceLoading/);
  assert.match(root, /resolveFcConfiguration/);
  assert.match(root, /skipEntryGiftIntro/);
  assert.doesNotMatch(root, /\/api\/reorder\/consumer/);
  const loading = readFileSync(resolve('src/ExperienceLoading.jsx'), 'utf8');
  assert.match(loading, /logoUrl/);
  assert.match(loading, /onLogoReady/);
  assert.doesNotMatch(loading, /logo-cutout|LOADING_LOGO_FALLBACK|fc-logo/);
  assert.match(vite, /\/api\/fc\/experience/);
  assert.match(vite, /\/api\/reorder/);
  const nginx = readFileSync(resolve('docker/nginx.conf'), 'utf8');
  const bff = readFileSync(resolve('server/index.js'), 'utf8');
  assert.match(nginx, /\/api\/reorder\//);
  assert.match(bff, /DASHBOARD_API_BASE_URL/);
  assert.match(bff, /proxyDashboard/);
  assert.match(bff, /experienceMatch/);
  assert.match(app, /LIVE_VIEWS/);
  assert.match(app, /initialResolved/);
  assert.match(dtcApp, /skipEntryGiftIntro/);
  assert.match(dtcApp, /skipEntryGiftIntroRef/);
  assert.match(dtcApp, /Gift-drop intro is globally cancelled|Gift-drop intro cancelled globally|never reopen intro from plan sync/);
  assert.doesNotMatch(app, /onOpenDemo=\{\(\) => navigate\('amazon-product'\)\}/);
});
