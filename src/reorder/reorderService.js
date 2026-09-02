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
  return decodeURIComponent(pathMatch?.[1] || new URLSearchParams(location.search).get('fc') || 'MORROW-SEA-SALT-001');
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

export async function resolveFcConfiguration({ fcId, scenario }) {
  await wait(420);
  return { ...buildScenario(scenario), fcId };
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
