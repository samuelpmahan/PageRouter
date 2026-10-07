// Critical journeys live with the typed Experience definition. A journey is
// executable release policy: every declared viewport runs the listed native
// controls against the assembled artifact before Pages may go green.
import fs from 'node:fs';
import path from 'node:path';

export const requiredViewports = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 1000 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});

const actions = new Set(['click']);
const selectorOK = value => typeof value === 'string' && value.trim().length > 0;
const assertionOK = value => selectorOK(value?.selector) && selectorOK(value?.attribute) && typeof value?.value === 'string';

export function declaredCriticalJourneys(root) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, '.tidy', 'manifest.json'), 'utf8'));
  if (registry.schemaVersion !== 1 || !registry.types || Array.isArray(registry.types)) throw Error('critical journeys: unsupported tidy manifest');
  return Object.entries(registry.types).flatMap(([type, spec]) => {
    const journey = spec?.experience?.criticalJourney;
    if (!journey) return [];
    const id = spec.root?.split('/')[1];
    if (!id) throw Error(`critical journeys: ${type} has no experience root`);
    return [{ id, type, journey }];
  });
}

export function validateCriticalJourney({ id, journey }) {
  const prefix = `critical journeys: ${id}`;
  if (journey.contract !== 'OTOV2/#PROcision') throw Error(`${prefix} must name its executable interaction contract`);
  if (!Array.isArray(journey.scenarios) || !journey.scenarios.includes('mobile')) throw Error(`${prefix} must register the mobile scenario`);
  if (!selectorOK(journey?.start?.selector)) throw Error(`${prefix} start.selector is required`);
  if (!assertionOK(journey.initial)) throw Error(`${prefix} needs a verifiable fresh initial state`);
  if (!selectorOK(journey.activePanelSelector)) throw Error(`${prefix} needs an active panel selector`);
  if (!Array.isArray(journey?.viewports) || journey.viewports.length < 2) throw Error(`${prefix} must declare desktop and mobile viewports`);
  for (const viewport of ['desktop', 'mobile']) if (!journey.viewports.includes(viewport)) throw Error(`${prefix} must include ${viewport}`);
  for (const viewport of journey.viewports) if (!Object.hasOwn(requiredViewports, viewport)) throw Error(`${prefix} has unknown viewport ${viewport}`);
  if (!journey.actions || typeof journey.actions !== 'object' || Array.isArray(journey.actions)) throw Error(`${prefix} actions must be grouped by viewport`);
  for (const viewport of journey.viewports) {
    const steps = journey.actions[viewport];
    if (!Array.isArray(steps) || !steps.length) throw Error(`${prefix} ${viewport} needs executable steps`);
    for (const step of steps) {
      if (!actions.has(step?.action) || !selectorOK(step?.selector)) throw Error(`${prefix} ${viewport} has an invalid action`);
      if (step.expect !== undefined && !selectorOK(step.expect)) throw Error(`${prefix} ${viewport} has an invalid expectation`);
      if (step.attribute !== undefined && (!selectorOK(step.attribute) || typeof step.value !== 'string')) throw Error(`${prefix} ${viewport} has an invalid attribute expectation`);
    }
  }
}

export function criticalJourneyPlans(root) {
  return declaredCriticalJourneys(root).map(entry => {
    validateCriticalJourney(entry);
    return entry;
  });
}
