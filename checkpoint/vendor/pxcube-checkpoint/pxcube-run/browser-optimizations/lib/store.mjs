import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_STORE_PATH = join(ROOT, 'registry.json');
export const STORE_ID = 'pxcube-browser-optimizations';
export const STORE_SCHEMA_VERSION = 1;
export const SEEDED_IDS = Object.freeze(['BO-0001', 'BO-0002', 'BO-0006', 'BO-0007', 'BO-0008']);

export class BrowserOptimizationStoreError extends Error {
  constructor(code, message, problems = []) {
    super(message);
    this.name = 'BrowserOptimizationStoreError';
    this.code = code;
    this.problems = problems;
  }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const oneOf = (value, choices) => choices.includes(value);
const hasSafeRelativePath = value => nonEmpty(value) && !value.startsWith('/') && !value.includes('..') && !/^[a-z][a-z0-9+.-]*:/i.test(value);

function checkStringArray(value, label, problems, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some(item => !nonEmpty(item))) {
    problems.push(`${label} must be an array of non-empty strings${min ? ` (at least ${min})` : ''}`);
  }
}

function checkRecord(record, index, problems) {
  const label = `records[${index}]`;
  if (!isRecord(record)) {
    problems.push(`${label} must be an object`);
    return;
  }
  if (typeof record.id !== 'string' || !/^BO-\d{4}$/.test(record.id)) problems.push(`${label}.id must match BO-0000`);
  for (const field of ['title', 'problem']) if (!nonEmpty(record[field])) problems.push(`${label}.${field} must be a non-empty string`);
  if (!oneOf(record.status, ['seeded', 'active', 'retired'])) problems.push(`${label}.status is invalid`);
  if (!oneOf(record.scope, ['browser-runtime', 'local-development', 'all-experiences'])) problems.push(`${label}.scope is invalid`);
  checkStringArray(record.tags, `${label}.tags`, problems, { min: 1 });

  if (!Array.isArray(record.signals) || record.signals.length === 0) problems.push(`${label}.signals must contain at least one signal`);
  else for (const [signalIndex, signal] of record.signals.entries()) {
    if (!isRecord(signal) || !nonEmpty(signal.id) || !nonEmpty(signal.event) || !nonEmpty(signal.observation)) {
      problems.push(`${label}.signals[${signalIndex}] needs id, event, and observation`);
    }
  }

  const recommendation = record.recommendation;
  if (!isRecord(recommendation) || !nonEmpty(recommendation.summary)) problems.push(`${label}.recommendation needs a summary`);
  else {
    checkStringArray(recommendation.actions, `${label}.recommendation.actions`, problems, { min: 1 });
    checkStringArray(recommendation.avoid, `${label}.recommendation.avoid`, problems);
  }

  const guard = record.guard;
  if (!isRecord(guard) || !oneOf(guard.kind, ['static', 'unit', 'browser']) || !nonEmpty(guard.assertion) || !hasSafeRelativePath(guard.testRef)) {
    problems.push(`${label}.guard needs kind, assertion, and a safe relative testRef`);
  }

  if (!isRecord(record.appliesTo)) problems.push(`${label}.appliesTo must be an object`);
  else {
    checkStringArray(record.appliesTo.lanes, `${label}.appliesTo.lanes`, problems, { min: 1 });
    if (Array.isArray(record.appliesTo.lanes) && record.appliesTo.lanes.some(lane => !oneOf(lane, ['neat', 'tidy', 'crisp']))) problems.push(`${label}.appliesTo.lanes contains an unknown lane`);
    checkStringArray(record.appliesTo.surfaces, `${label}.appliesTo.surfaces`, problems, { min: 1 });
  }

  if (!Array.isArray(record.evidence)) problems.push(`${label}.evidence must be an array`);
  else for (const [evidenceIndex, evidence] of record.evidence.entries()) {
    if (!isRecord(evidence) || !oneOf(evidence.kind, ['local-observation', 'unit-test', 'browser-test', 'design-note']) || !hasSafeRelativePath(evidence.ref) || !nonEmpty(evidence.note)) {
      problems.push(`${label}.evidence[${evidenceIndex}] needs kind, safe ref, and note`);
    }
  }

  if (record.examples !== undefined) {
    if (!Array.isArray(record.examples)) problems.push(`${label}.examples must be an array`);
    else for (const [exampleIndex, example] of record.examples.entries()) {
      const expected = [-10, -5, -3, -1, 1, 3, 5, 10];
      if (!isRecord(example) || example.kind !== 'crop-correction-strip' || example.verification !== 'same-viewport' || JSON.stringify(example.increments) !== JSON.stringify(expected)) {
        problems.push(`${label}.examples[${exampleIndex}] must declare the exact crop correction strip and same-viewport verification`);
      }
    }
  }
}

/** Return all validation problems without throwing, suitable for CI/static guards. */
export function validateOptimizationStore(store, { requireSeededRecords = true } = {}) {
  const problems = [];
  if (!isRecord(store)) return ['store must be a JSON object'];
  if (store.schemaVersion !== STORE_SCHEMA_VERSION) problems.push(`schemaVersion must be ${STORE_SCHEMA_VERSION}`);
  if (store.storeId !== STORE_ID) problems.push(`storeId must be ${STORE_ID}`);
  if (!Array.isArray(store.records)) return [...problems, 'records must be an array'];

  const ids = new Set();
  for (const [index, record] of store.records.entries()) {
    checkRecord(record, index, problems);
    if (record?.id) {
      if (ids.has(record.id)) problems.push(`duplicate optimization id ${record.id}`);
      ids.add(record.id);
    }
  }
  if (requireSeededRecords) {
    for (const id of SEEDED_IDS) if (!ids.has(id)) problems.push(`missing seeded optimization ${id}`);
  }
  return problems;
}

export function assertValidOptimizationStore(store, options = {}) {
  const problems = validateOptimizationStore(store, options);
  if (problems.length) throw new BrowserOptimizationStoreError('validation', problems.join('; '), problems);
  return store;
}

export async function loadOptimizationStore(storePath = DEFAULT_STORE_PATH, options = {}) {
  let store;
  try {
    store = JSON.parse(await readFile(storePath, 'utf8'));
  } catch (error) {
    throw new BrowserOptimizationStoreError('read', `cannot read optimization store ${storePath}: ${error.message}`);
  }
  return assertValidOptimizationStore(store, options);
}

export const loadRegistry = loadOptimizationStore;

export function getOptimization(store, id) {
  assertValidOptimizationStore(store);
  return store.records.find(record => record.id === id) ?? null;
}

export function selectOptimizations(store, { scope, lane, tag } = {}) {
  assertValidOptimizationStore(store);
  return store.records.filter(record =>
    (!scope || record.scope === scope) &&
    (!lane || record.appliesTo.lanes.includes(lane)) &&
    (!tag || record.tags.includes(tag)) &&
    record.status !== 'retired',
  );
}

export function summarizeOptimizationStore(store) {
  assertValidOptimizationStore(store);
  return {
    storeId: store.storeId,
    schemaVersion: store.schemaVersion,
    recordCount: store.records.length,
    ids: store.records.map(record => record.id),
    scopes: [...new Set(store.records.map(record => record.scope))].sort(),
  };
}

// Registry terminology is kept as a compatibility alias for lane callers;
// "store" is the preferred name in new code.
export const validateRegistry = validateOptimizationStore;
export const assertValidRegistry = assertValidOptimizationStore;
export const getRecord = getOptimization;
export const listRecords = selectOptimizations;
