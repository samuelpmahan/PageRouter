import { componentDefinitions, componentSources } from '../watches/components.mjs';

const SCHEMA = 'explain.evidence-context.v1';
const MAX_EVIDENCE = 256;
const MAX_SOURCES = 64;
const MAX_CLAIMS = 64;
const MAX_TEXT = 4_096;
const MAX_BYTES = 1_000_000;
const MAX_DEPTH = 16;
const MAX_NODES = 100_000;
const SCOPES = new Set([
  'model.prediction', 'model.contribution', 'model.baseline', 'model.perturbation',
  'watch.energyRole', 'watch.timingRole', 'watch.currentRate', 'watch.nominalRate',
  'watch.counter', 'watch.gearRatio', 'watch.displayAngle', 'watch.renderingInvariant',
  'watch.syntheticObservation', 'source.mechanismFact',
]);
const KINDS = new Set(['fact', 'simulation', 'derived', 'illustrative', 'observed', 'measurement']);
const SOURCE_KINDS = new Set(['model-derived', 'synthetic-watch', 'browser-observed', 'physical-measured', 'curated-source']);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${label} must be a plain JSON object`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_TEXT) throw new TypeError(`${label} must be nonempty text of at most ${MAX_TEXT} characters`);
  return value;
}
function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown ${label} field ${key}`);
}
function jsonClone(value, label = 'value', depth = 0, seen = new Set(), budget = { bytes: 0 }) {
  budget.nodes = (budget.nodes ?? 0) + 1;
  if (budget.nodes > MAX_NODES) throw new RangeError(`${label} exceeds maximum JSON node count ${MAX_NODES}`);
  const charge = amount => {
    budget.bytes += amount;
    if (budget.bytes > MAX_BYTES) throw new RangeError(`${label} exceeds ${MAX_BYTES} bytes`);
  };
  if (depth > MAX_DEPTH) throw new RangeError(`${label} exceeds maximum JSON depth ${MAX_DEPTH}`);
  if (value === null || typeof value === 'boolean') { charge(8); return value; }
  if (typeof value === 'string') {
    const length = byteLength(value);
    if (length > MAX_TEXT) throw new RangeError(`${label} text exceeds ${MAX_TEXT} characters`);
    charge(length + 2);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) { charge(24); return value; }
  if (typeof value !== 'object') throw new TypeError(`${label} must contain only finite JSON values`);
  if (seen.has(value)) throw new TypeError(`${label} cannot contain cycles`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new RangeError(`${label} array exceeds 10000 entries`);
    result = value.map(item => jsonClone(item, label, depth + 1, seen, budget));
  }
  else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError(`${label} must contain only plain JSON objects`);
    const entries = Object.entries(value);
    if (entries.length > 10_000) throw new RangeError(`${label} object exceeds 10000 properties`);
    result = Object.fromEntries(entries.map(([key, item]) => {
      charge(byteLength(key) + 4);
      return [key, jsonClone(item, label, depth + 1, seen, budget)];
    }));
  }
  seen.delete(value);
  return result;
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function byteLength(value) { return new TextEncoder().encode(value).length; }
function isRational(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2 && Number.isSafeInteger(value.numerator)
    && Number.isSafeInteger(value.denominator) && value.denominator > 0;
}
function isNumericEvidence(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (isRational(value)) return true;
  return Array.isArray(value) && value.length <= 10_000 && value.every(item => typeof item === 'number' ? Number.isFinite(item) : isRational(item));
}
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value, required, optional = []) {
  return plainObject(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function numericArray(value) { return Array.isArray(value) && value.length <= 10_000 && value.every(item => typeof item === 'number' && Number.isFinite(item)); }
function numericMatrix(value) { return Array.isArray(value) && value.length <= 10_000 && value.every(numericArray); }
function nativePrediction(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (!plainObject(value)) return false;
  if (exactKeys(value, ['predictions'])) return numericArray(value.predictions);
  if (exactKeys(value, ['scores', 'probabilities', 'labels'])) return numericArray(value.scores) && numericArray(value.probabilities) && Array.isArray(value.labels) && value.labels.every(label => label === 0 || label === 1);
  if (exactKeys(value, ['assignments', 'distances', 'squaredDistances'])) return Array.isArray(value.assignments) && value.assignments.every(Number.isSafeInteger) && numericArray(value.distances) && numericArray(value.squaredDistances);
  if (exactKeys(value, ['projected'])) return numericMatrix(value.projected);
  return false;
}
function safeIdentifier(value) { return typeof value === 'string' && value.length <= 80 && /^[A-Za-z0-9_.:-]+$/.test(value); }
function validModelContributions(value) {
  if (isNumericEvidence(value)) return true;
  if (!Array.isArray(value) || value.length > 10_000) return false;
  return value.every(item => exactKeys(item, ['name', 'index', 'inputValue', 'referenceValue', 'coefficient', 'contribution'])
    && safeIdentifier(item.name) && Number.isSafeInteger(item.index)
    && ['inputValue', 'referenceValue', 'coefficient', 'contribution'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key])));
}
function validBaseline(value) {
  return exactKeys(value, ['featureValues', 'prediction'], ['kind']) && numericArray(value.featureValues)
    && nativePrediction(value.prediction)
    && (value.kind === undefined || ['trainingMean', 'training-mean', 'zero', 'explicit'].includes(value.kind));
}
function validPerturbation(value) {
  const changeListOkay = value?.changes === undefined || (Array.isArray(value.changes) && value.changes.length <= 10_000 && value.changes.every(item =>
    exactKeys(item, ['name', 'index', 'from', 'to', 'delta', 'selected']) && safeIdentifier(item.name)
    && Number.isSafeInteger(item.index) && ['from', 'to', 'delta'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
    && typeof item.selected === 'boolean'));
  return exactKeys(value, ['originalFeatures', 'changedFeatures', 'originalPrediction', 'changedPrediction'], ['predictionDelta', 'delta', 'namedDeltas', 'changes', 'modelUnchanged', 'preprocessingRefit'])
    && numericArray(value.originalFeatures) && numericArray(value.changedFeatures)
    && value.originalFeatures.length === value.changedFeatures.length
    && typeof value.originalPrediction === 'number' && Number.isFinite(value.originalPrediction)
    && typeof value.changedPrediction === 'number' && Number.isFinite(value.changedPrediction)
    && (value.predictionDelta === undefined || (typeof value.predictionDelta === 'number' && Number.isFinite(value.predictionDelta)))
    && (value.delta === undefined || (typeof value.delta === 'number' && Number.isFinite(value.delta)))
    && changeListOkay
    && (value.namedDeltas === undefined || (Array.isArray(value.namedDeltas) && value.namedDeltas.length <= 10_000 && value.namedDeltas.every(item => exactKeys(item, ['name', 'delta']) && safeIdentifier(item.name) && typeof item.delta === 'number' && Number.isFinite(item.delta))))
    && (value.modelUnchanged === undefined || value.modelUnchanged === true)
    && (value.preprocessingRefit === undefined || value.preprocessingRefit === false);
}
function validGearPair(pair) {
  return exactKeys(pair, ['driverTurns', 'drivenTurns', 'teethRatio', 'driverTeeth', 'drivenTeeth', 'direction'])
    && ['driverTurns', 'drivenTurns', 'teethRatio'].every(key => isRational(pair[key]))
    && Number.isSafeInteger(pair.driverTeeth) && pair.driverTeeth > 0
    && Number.isSafeInteger(pair.drivenTeeth) && pair.drivenTeeth > 0 && pair.direction === 'opposite';
}
function validGearTrain(value) {
  if (!exactKeys(value, ['handTurns', 'gearPairs'], ['handAnglesDegrees'])) return false;
  const turns = value.handTurns;
  const pairs = value.gearPairs;
  if (!exactKeys(turns, ['second', 'minute', 'hour']) || !Object.values(turns).every(isRational)) return false;
  if (!exactKeys(pairs, ['secondToMinute', 'minuteToHour']) || ![pairs.secondToMinute, pairs.minuteToHour].every(list => Array.isArray(list) && list.length === 2 && list.every(validGearPair))) return false;
  return value.handAnglesDegrees === undefined || (exactKeys(value.handAnglesDegrees, ['second', 'minute', 'hour']) && Object.values(value.handAnglesDegrees).every(angle => typeof angle === 'number' && Number.isFinite(angle)));
}
function validCounter(value) {
  if (Number.isSafeInteger(value) && value >= 0) return true;
  if (isRational(value) && value.numerator >= 0) return true;
  if (Array.isArray(value) && value.length <= 10_000 && value.every(item => (Number.isSafeInteger(item) && item >= 0) || (isRational(item) && item.numerator >= 0))) return true;
  const enums = { event: ['mechanicalBeat', 'quartzCycle', 'motorCommand', 'softwareUpdate'], model: ['mechanical', 'quartz', 'software'] };
  return exactKeys(value, ['event', 'model', 'start', 'end', 'timeStart', 'timeEnd', 'session', 'sequence'])
    && enums.event.includes(value.event) && enums.model.includes(value.model)
    && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && value.start >= 0 && value.end >= value.start
    && isRational(value.timeStart) && isRational(value.timeEnd)
    && Number.isSafeInteger(value.session) && value.session > 0 && Number.isSafeInteger(value.sequence) && value.sequence > 0;
}
function validRenderingInvariant(value) {
  if (typeof value === 'boolean') return true;
  if (!exactKeys(value, ['stateUnchanged', 'countersBefore', 'countersAfter', 'geometryChanged'])) return false;
  const countKeys = ['mechanicalBeats', 'quartzCycles', 'motorCommands', 'updates'];
  const countsOkay = counts => plainObject(counts) && Object.keys(counts).length > 0
    && Object.keys(counts).every(key => countKeys.includes(key) && Number.isSafeInteger(counts[key]));
  return typeof value.stateUnchanged === 'boolean' && typeof value.geometryChanged === 'boolean'
    && countsOkay(value.countersBefore) && countsOkay(value.countersAfter);
}
function validSyntheticObservation(value) {
  if (isNumericEvidence(value)) return true;
  return exactKeys(value, ['runId', 'conditionId', 'feature', 'target', 'kind'])
    && safeIdentifier(value.runId) && safeIdentifier(value.conditionId)
    && typeof value.feature === 'number' && Number.isFinite(value.feature)
    && typeof value.target === 'number' && Number.isFinite(value.target)
    && value.kind === 'synthetic-teaching-phase-observation';
}
function componentRoleValue(definition, value) {
  if (!definition) return false;
  if (definition.unit === 'boolean') return typeof value === 'boolean';
  if (['commands', 'events', 'beats', 'updates'].includes(definition.unit)) return Number.isSafeInteger(value);
  if (definition.unit === 'cycles') return Number.isSafeInteger(value) || isRational(value);
  if (definition.unit === 'phase') return isRational(value) || (definition.id === 'mechanical.palletFork' && ['lock', 'release', 'impulse'].includes(value));
  if (definition.unit === 'stage counts') {
    return Array.isArray(value) && value.length <= 32 && value.every(stage => exactKeys(stage, ['stage', 'divisor', 'outputCount'])
      && Number.isSafeInteger(stage.stage) && Number.isSafeInteger(stage.divisor) && stage.divisor > 1
      && (Number.isSafeInteger(stage.outputCount) || (isRational(stage.outputCount) && stage.outputCount.numerator >= 0)));
  }
  if (definition.unit === 'turns and degrees') return validGearTrain(value);
  return isNumericEvidence(value);
}
function validateScopeValue(id, scope, kind, unit, value) {
  if (scope === 'source.mechanismFact') return;
  if (scope === 'model.prediction' && !nativePrediction(value)) throw new TypeError(`evidence ${id} model.prediction must use a recognized numeric prediction shape`);
  if (scope === 'model.contribution' && !validModelContributions(value)) throw new TypeError(`evidence ${id} model.contribution must contain numeric contributions and fixed feature identifiers`);
  if (scope === 'model.baseline' && !(isNumericEvidence(value) || validBaseline(value))) throw new TypeError(`evidence ${id} model.baseline must contain numeric baseline values`);
  if (scope === 'model.perturbation' && !(isNumericEvidence(value) || validPerturbation(value))) throw new TypeError(`evidence ${id} model.perturbation must contain numeric original and changed predictions`);
  if (scope === 'watch.energyRole') {
    const definition = watchComponents.get(id);
    if (!definition || !componentRoleValue(definition, value)) throw new TypeError(`evidence ${id} watch.energyRole value must match its declared component type`);
    if (definition.unit !== unit) throw new TypeError(`evidence ${id} watch.energyRole unit must match its component definition`);
  }
  if (scope === 'watch.timingRole') {
    const definition = watchComponents.get(id);
    if (!definition || !componentRoleValue(definition, value)) throw new TypeError(`evidence ${id} watch.timingRole value must match its declared component type`);
    if (definition.unit !== unit) throw new TypeError(`evidence ${id} watch.timingRole unit must match its component definition`);
  }
  if (scope === 'watch.currentRate' || scope === 'watch.nominalRate') {
    if (!isRational(value) || value.numerator < 0) throw new TypeError(`evidence ${id} ${scope} value must be an exact nonnegative rational rate`);
  }
  if (scope === 'watch.counter' && !validCounter(value)) throw new TypeError(`evidence ${id} watch.counter value must be a bounded counter or retained event shape`);
  if (scope === 'watch.gearRatio' && !(isRational(value) || (typeof value === 'number' && Number.isFinite(value)) || validGearTrain(value))) throw new TypeError(`evidence ${id} watch.gearRatio value must be a finite ratio or teaching train shape`);
  if (scope === 'watch.displayAngle' && !(typeof value === 'number' && Number.isFinite(value))) throw new TypeError(`evidence ${id} watch.displayAngle value must be finite degrees`);
  if (scope === 'watch.renderingInvariant' && !validRenderingInvariant(value)) throw new TypeError(`evidence ${id} watch.renderingInvariant value must be a boolean or fixed invariance proof`);
  if (scope === 'watch.syntheticObservation' && !validSyntheticObservation(value)) throw new TypeError(`evidence ${id} watch.syntheticObservation value must be numeric or a fixed synthetic record`);
  if (kind === 'measurement' && scope !== 'source.mechanismFact') throw new TypeError(`evidence ${id} cannot label a model or watch value as a physical measurement`);
  const declaredPhase = scope === 'watch.timingRole' && id === 'mechanical.palletFork' && ['lock', 'release', 'impulse'].includes(value);
  if (typeof value === 'string' && scope !== 'source.mechanismFact' && !declaredPhase) throw new TypeError(`evidence ${id} cannot place free text in a typed ${scope} value`);
  if (unit.length > MAX_TEXT) throw new TypeError(`evidence ${id} unit is too long`);
}
function uniqueStrings(values, label, max) {
  if (!Array.isArray(values) || values.length < 1 || values.length > max) throw new RangeError(`${label} must contain 1 to ${max} entries`);
  const copy = values.map((item, i) => text(item, `${label}[${i}]`));
  if (new Set(copy).size !== copy.length) throw new RangeError(`${label} entries must be unique`);
  return copy;
}

const trustedWatchSources = new Map(componentSources().map(source => [source.id, source]));
const watchComponents = new Map(componentDefinitions().map(definition => [definition.id, definition]));

function normalizeSource(source, index, stateIdentity, modelIdentity) {
  object(source, `sources[${index}]`);
  const id = text(source.id, `sources[${index}].id`);
  // External mechanism facts must match the repository's curated primary-source records.
  if (trustedWatchSources.has(id)) {
    const canonical = trustedWatchSources.get(id);
    if (source.url !== canonical.url || source.supports !== canonical.supports || source.limits !== canonical.limits) {
      throw new TypeError(`source ${id} does not match its curated source record`);
    }
    onlyKeys(source, new Set(['id', 'url', 'supports', 'limits', 'title', 'identity']), `sources[${index}]`);
    if (source.identity !== undefined && source.identity !== 'watch-sources-v1') throw new TypeError(`source ${id} has an unknown source identity`);
    return { ...canonical, ...(source.title === undefined ? {} : { title: text(source.title, `sources[${index}].title`) }), ...(source.identity === undefined ? {} : { identity: source.identity }) };
  }
  // Local artifacts are identities, not external references; their identity binds them to this context.
  const isDatasetSource = id === 'dataset-lineage' || /^dataset:[A-Za-z0-9_.-]{1,64}$/.test(id);
  if (id === 'fitted-model' || isDatasetSource || id === 'watch-state') {
    onlyKeys(source, new Set(['id', 'title', 'scope', 'identity', 'url']), `sources[${index}]`);
    const identity = text(source.identity, `sources[${index}].identity`);
    if (source.url !== undefined && source.url !== null) throw new TypeError(`${id} local source url must be null`);
    const expected = id === 'fitted-model' ? modelIdentity : stateIdentity;
    if (identity !== expected) throw new TypeError(`${id} source identity does not match the context identity`);
    return { id, title: text(source.title, `sources[${index}].title`), scope: text(source.scope, `sources[${index}].scope`), identity, url: null };
  }
  throw new TypeError(`source ${id} is not in the curated source registry`);
}

function normalizeEvidence(item, index, sourcesById, stateIdentity, modelIdentity, sourceKind, valueBudget) {
  object(item, `evidence[${index}]`);
  onlyKeys(item, new Set(['id', 'value', 'unit', 'kind', 'permittedScopes', 'citationIds', 'stateIdentity', 'modelIdentity']), `evidence[${index}]`);
  const id = text(item.id, `evidence[${index}].id`);
  const unit = text(item.unit, `evidence[${index}].unit`);
  if (!KINDS.has(item.kind)) throw new TypeError(`evidence ${id} kind must be one of ${[...KINDS].join(', ')}`);
  if (item.kind === 'observed' && sourceKind !== 'browser-observed') throw new TypeError(`evidence ${id} kind observed requires sourceKind browser-observed`);
  const permittedScopes = uniqueStrings(item.permittedScopes, `evidence ${id} permittedScopes`, SCOPES.size);
  for (const scope of permittedScopes) if (!SCOPES.has(scope)) throw new TypeError(`evidence ${id} has unsupported scope ${scope}`);
  const citationIds = uniqueStrings(item.citationIds, `evidence ${id} citationIds`, MAX_SOURCES);
  for (const citationId of citationIds) if (!sourcesById.has(citationId)) throw new TypeError(`evidence ${id} cites unknown source ${citationId}`);
  if (item.stateIdentity !== undefined && item.stateIdentity !== stateIdentity) throw new TypeError(`evidence ${id} has stale state identity`);
  if (item.modelIdentity !== undefined && item.modelIdentity !== modelIdentity) throw new TypeError(`evidence ${id} has stale model identity`);
  const value = jsonClone(item.value, `evidence ${id} value`, 0, new Set(), valueBudget);
  if (item.kind === 'measurement' && !permittedScopes.includes('source.mechanismFact')) throw new TypeError(`evidence ${id} cannot label a model or watch value as a physical measurement`);
  if (permittedScopes.includes('source.mechanismFact')) {
    if (item.kind !== 'fact' || citationIds.length !== 1) throw new TypeError(`source mechanism fact ${id} must be a single-source fact`);
    const cited = trustedWatchSources.get(citationIds[0]);
    if (!cited || (value !== cited.supports && value !== cited.limits)) throw new TypeError(`source mechanism fact ${id} must exactly match its cited curated supports or limits text`);
    const expectedUnit = value === cited.supports ? 'source note' : 'scope limitation';
    if (unit !== expectedUnit) throw new TypeError(`source mechanism fact ${id} unit must be ${expectedUnit}`);
  }
  for (const scope of ['watch.energyRole', 'watch.timingRole']) {
    if (permittedScopes.includes(scope)) {
      const definition = watchComponents.get(id);
      if (!definition || definition.roleStatus !== 'fact' || (scope === 'watch.energyRole' && definition.role !== 'energy') || (scope === 'watch.timingRole' && definition.role !== 'timing')) {
        throw new TypeError(`evidence ${id} does not identify a curated ${scope === 'watch.energyRole' ? 'energy' : 'timing'} component role`);
      }
      if (item.kind !== definition.valueStatus || citationIds.length !== 1 || citationIds[0] !== 'watch-state') throw new TypeError(`evidence ${id} ${scope} kind must match its component and cite identity-bound watch-state`);
    }
  }
  for (const scope of permittedScopes) validateScopeValue(id, scope, item.kind, unit, value);
  for (const scope of permittedScopes) {
    const expectedKinds = scope === 'source.mechanismFact' ? ['fact']
      : scope.startsWith('model.') ? ['derived']
        : scope === 'watch.gearRatio' || scope === 'watch.displayAngle' || scope === 'watch.renderingInvariant' || scope === 'watch.syntheticObservation' ? ['derived', 'simulation', 'observed']
          : ['simulation', 'derived', 'observed'];
    if (!expectedKinds.includes(item.kind)) throw new TypeError(`evidence ${id} kind ${item.kind} is not valid for scope ${scope}`);
  }
  return {
    id, value, unit, kind: item.kind,
    permittedScopes, citationIds,
    ...(item.stateIdentity === undefined ? {} : { stateIdentity: item.stateIdentity }),
    ...(item.modelIdentity === undefined ? {} : { modelIdentity: item.modelIdentity }),
  };
}

/** Build a bounded, JSON-safe context. Citation sources must be curated or identity-bound local artifacts. */
export function buildEvidenceContext(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['contextId', 'stateIdentity', 'modelIdentity', 'sourceKind', 'sources', 'evidence']), 'context input');
  const contextId = text(input.contextId, 'contextId');
  const stateIdentity = text(input.stateIdentity, 'stateIdentity');
  const modelIdentity = text(input.modelIdentity, 'modelIdentity');
  if (!SOURCE_KINDS.has(input.sourceKind)) throw new TypeError(`sourceKind must be one of ${[...SOURCE_KINDS].join(', ')}`);
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > MAX_SOURCES) throw new RangeError(`sources must contain 1 to ${MAX_SOURCES} records`);
  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > MAX_EVIDENCE) throw new RangeError(`evidence must contain 1 to ${MAX_EVIDENCE} records`);
  const sources = input.sources.map((source, index) => normalizeSource(source, index, stateIdentity, modelIdentity));
  const sourcesById = new Map(sources.map(source => [source.id, source]));
  if (sourcesById.size !== sources.length) throw new RangeError('source IDs must be unique');
  const valueBudget = { bytes: 0 };
  const evidence = input.evidence.map((item, index) => normalizeEvidence(item, index, sourcesById, stateIdentity, modelIdentity, input.sourceKind, valueBudget));
  if (new Set(evidence.map(item => item.id)).size !== evidence.length) throw new RangeError('evidence IDs must be unique');
  const context = { schema: SCHEMA, contextId, stateIdentity, modelIdentity, sourceKind: input.sourceKind, sources, evidence };
  const bounded = jsonClone(context, 'context');
  if (byteLength(stableJson(bounded)) > MAX_BYTES) throw new RangeError(`evidence context exceeds ${MAX_BYTES} bytes`);
  return bounded;
}

function fail(errors) { return { accepted: false, errors, claims: [], renderedText: '' }; }
function sameArray(a, b) { return Array.isArray(a) && stableJson(a) === stableJson(b); }
function renderClaim(evidence, scope) {
  const renderedValue = typeof evidence.value === 'string' ? evidence.value : stableJson(evidence.value);
  const scopeLabels = {
    'model.prediction': 'The fitted model predicts', 'model.contribution': 'The model contribution is',
    'model.baseline': 'The stated model baseline is', 'model.perturbation': 'Under the stated input change, the fitted model reports',
    'watch.energyRole': 'The modeled energy-role evidence is', 'watch.timingRole': 'The modeled timing-role evidence is',
    'watch.currentRate': 'The current modeled rate is', 'watch.nominalRate': 'The nominal model rate is',
    'watch.counter': 'The modeled counter value is', 'watch.gearRatio': 'The teaching gear-ratio result is',
    'watch.displayAngle': 'The modeled hand angle is', 'watch.renderingInvariant': 'The rendering-invariance evidence is',
    'watch.syntheticObservation': 'The synthetic watch observation is', 'source.mechanismFact': 'The cited source supports this bounded mechanism fact:',
  };
  return `${scopeLabels[scope]} ${renderedValue} ${evidence.unit} [${evidence.citationIds.join(', ')}].`;
}

/** Check structured claims and render only deterministic text derived from matching evidence. */
export function checkExplanationClaims(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['context', 'draft']), 'checker input');
  const rawContext = object(input.context, 'context');
  const rawDraft = object(input.draft, 'draft');
  const errors = [];
  let context;
  let draft;
  try {
    if (!Array.isArray(rawContext.sources) || rawContext.sources.length < 1 || rawContext.sources.length > MAX_SOURCES) return fail([{ code: 'invalid-context', message: `context sources must contain 1 to ${MAX_SOURCES} records` }]);
    if (!Array.isArray(rawContext.evidence) || rawContext.evidence.length < 1 || rawContext.evidence.length > MAX_EVIDENCE) return fail([{ code: 'invalid-context', message: `context evidence must contain 1 to ${MAX_EVIDENCE} records` }]);
    // Bound traversal and reject cycles before canonical serialization; stringify alone can
    // allocate without limit or recurse indefinitely on caller-provided objects.
    context = jsonClone(rawContext, 'context');
    if (context.schema !== SCHEMA) return fail([{ code: 'invalid-context', message: `context schema must be ${SCHEMA}` }]);
    if (byteLength(stableJson(context)) > MAX_BYTES) return fail([{ code: 'context-too-large', message: `context exceeds ${MAX_BYTES} bytes` }]);
    onlyKeys(context, new Set(['schema', 'contextId', 'stateIdentity', 'modelIdentity', 'sourceKind', 'sources', 'evidence']), 'context');
    const rebuilt = buildEvidenceContext({
      contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
      sourceKind: context.sourceKind, sources: context.sources, evidence: context.evidence,
    });
    if (stableJson(rebuilt) !== stableJson(context)) return fail([{ code: 'invalid-context', message: 'context is not in canonical validated form' }]);
  } catch (error) {
    return fail([{ code: 'invalid-context', message: error.message }]);
  }
  try {
    if (Array.isArray(rawDraft.claims) && (rawDraft.claims.length < 1 || rawDraft.claims.length > MAX_CLAIMS)) {
      return fail([{ code: 'claim-count', message: `claims must contain 1 to ${MAX_CLAIMS} structured claims` }]);
    }
    draft = jsonClone(rawDraft, 'draft');
    onlyKeys(draft, new Set(['contextId', 'stateIdentity', 'modelIdentity', 'claims']), 'draft');
  } catch (error) {
    return fail([{ code: 'invalid-draft', message: error.message }]);
  }
  for (const key of ['contextId', 'stateIdentity', 'modelIdentity']) {
    if (draft[key] !== context[key]) errors.push({ code: key === 'contextId' ? 'stale-context' : `stale-${key.replace('Identity', '')}`, message: `draft ${key} does not match the checked context` });
  }
  // A caller-provided declaration is not provenance for a physical measurement.
  if (context.sourceKind === 'physical-measured') errors.push({ code: 'unverified-physical-provenance', message: 'sourceKind physical-measured is only a caller label; no trusted instrument provenance is attached' });
  if (!Array.isArray(draft.claims) || draft.claims.length < 1 || draft.claims.length > MAX_CLAIMS) {
    errors.push({ code: 'claim-count', message: `claims must contain 1 to ${MAX_CLAIMS} structured claims` });
    return fail(errors);
  }
  const evidenceById = new Map(context.evidence.map(item => [item.id, item]));
  const sourceIds = new Set(context.sources.map(source => source.id));
  const accepted = [];
  for (let index = 0; index < draft.claims.length; index += 1) {
    const claim = draft.claims[index];
    try {
      object(claim, `claims[${index}]`);
      onlyKeys(claim, new Set(['evidenceId', 'value', 'unit', 'kind', 'scope', 'citationIds']), `claims[${index}]`);
      jsonClone(claim, `claims[${index}]`);
      const evidence = evidenceById.get(claim.evidenceId);
      if (!evidence) throw Object.assign(new Error(`unknown evidence ID ${String(claim.evidenceId)}`), { code: 'unknown-evidence' });
      if (!sameArray(claim.value === undefined ? [] : [claim.value], [evidence.value])) throw Object.assign(new Error(`claim value does not match evidence ${evidence.id}`), { code: 'wrong-value' });
      if (claim.unit !== evidence.unit) throw Object.assign(new Error(`claim unit does not match evidence ${evidence.id} (${evidence.unit})`), { code: 'wrong-unit' });
      if (claim.kind !== evidence.kind) throw Object.assign(new Error(`claim kind does not match evidence ${evidence.id} (${evidence.kind})`), { code: 'wrong-kind' });
      if (!SCOPES.has(claim.scope) || !evidence.permittedScopes.includes(claim.scope)) throw Object.assign(new Error(`scope ${String(claim.scope)} is not permitted by evidence ${evidence.id}`), { code: 'wrong-scope' });
      if (!Array.isArray(claim.citationIds) || claim.citationIds.length === 0 || !sameArray(claim.citationIds, evidence.citationIds)) throw Object.assign(new Error(`citations must exactly match the relevant source IDs for evidence ${evidence.id}`), { code: 'irrelevant-citation' });
      if (claim.citationIds.some(id => !sourceIds.has(id))) throw Object.assign(new Error(`claim cites a source outside the context`), { code: 'irrelevant-citation' });
      if (claim.scope.startsWith('model.') && !claim.citationIds.includes('fitted-model')) throw Object.assign(new Error('model arithmetic claims must cite the retained fitted model artifact'), { code: 'irrelevant-citation' });
      if (claim.scope === 'source.mechanismFact' && !claim.citationIds.some(id => trustedWatchSources.has(id))) throw Object.assign(new Error('mechanism facts require a relevant curated watch source citation'), { code: 'irrelevant-citation' });
      if ((claim.scope === 'watch.energyRole' || claim.scope === 'watch.timingRole') && !claim.citationIds.includes('watch-state')) throw Object.assign(new Error('modeled energy and timing values require an identity-bound watch-state citation'), { code: 'irrelevant-citation' });
      if (claim.scope.startsWith('watch.') && !claim.citationIds.some(id => trustedWatchSources.has(id) || id === 'watch-state' || (context.sourceKind === 'synthetic-watch' && (id === 'dataset-lineage' || id.startsWith('dataset:'))))) throw Object.assign(new Error('watch claims require a curated component source or identity-bound watch-state citation'), { code: 'irrelevant-citation' });
      if (claim.kind === 'measurement' || (context.sourceKind === 'physical-measured' && claim.kind !== 'fact')) throw Object.assign(new Error('physical measurement is unsupported without independently verified instrument provenance'), { code: 'unverified-physical-provenance' });
      accepted.push({ evidenceId: evidence.id, value: jsonClone(evidence.value), unit: evidence.unit, kind: evidence.kind, scope: claim.scope, citationIds: [...evidence.citationIds], statement: renderClaim(evidence, claim.scope) });
    } catch (error) {
      errors.push({ claimIndex: index, ...(claim && typeof claim.evidenceId === 'string' ? { evidenceId: claim.evidenceId } : {}), code: error.code ?? 'invalid-claim', message: error.message });
    }
  }
  if (errors.length) return fail(errors);
  return {
    accepted: true,
    contextId: context.contextId,
    stateIdentity: context.stateIdentity,
    modelIdentity: context.modelIdentity,
    claims: accepted,
    renderedText: accepted.map(claim => claim.statement).join('\n'),
  };
}

export const groundingLimits = Object.freeze({ maxEvidence: MAX_EVIDENCE, maxSources: MAX_SOURCES, maxClaims: MAX_CLAIMS, maxTextCharacters: MAX_TEXT, maxContextBytes: MAX_BYTES, maxDepth: MAX_DEPTH, maxNodes: MAX_NODES });
