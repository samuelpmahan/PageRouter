// Host-owned scenario conveyor. Experiences opt in by accepting these query
// parameters; production URLs remain unchanged when no scenario is selected.
export const SCENARIOS = Object.freeze([
  Object.freeze({ id: 'empty', label: 'Empty', count: 0 }),
  Object.freeze({ id: 'minimal', label: 'Minimal', count: 3 }),
  Object.freeze({ id: 'typical', label: 'Typical', count: 50 }),
  Object.freeze({ id: 'dense', label: 'Dense', count: 250 }),
  Object.freeze({ id: 'mobile', label: 'Mobile / narrow', viewport: 'narrow' }),
  Object.freeze({ id: 'resumed', label: 'Persisted / resumed', persistence: 'resume' }),
]);
const ids = new Set(SCENARIOS.map(s => s.id));
export const scenarioById = id => SCENARIOS.find(s => s.id === id) ?? null;
export function scenarioUrl(path, scenario, base = globalThis.location?.href ?? 'http://pxcube.local/') {
  const url = new URL(path, base);
  if (scenario && ids.has(typeof scenario === 'string' ? scenario : scenario.id)) {
    url.searchParams.set('scenario', typeof scenario === 'string' ? scenario : scenario.id);
    url.searchParams.set('testRun', '1');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
export function scenarioMatrix(experienceIds) {
  return experienceIds.flatMap(experience => SCENARIOS.map(scenario => ({ experience, scenario: scenario.id, stages: ['load', 'implementation', 'browser-test', 'human-test'] })));
}
