import { prepareExplanationFeatures } from './regression.mjs';
import { predictMLModel } from '../ml/index.mjs';

const MAX_SOURCE_FEATURES = 256;
const MAX_SELECTED_FEATURES = 100;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
const MAX_TRACE_BYTES = 32_768;
const MAX_CANONICAL_NODES = 100_000;
const MAX_CANONICAL_ENTRIES = 100_000;
const ROUNDING_FACTOR = 64 * Number.EPSILON;
const SERIALIZATION_BUDGETS = Object.freeze({
  input: Object.freeze({ label: 'explanation input', maxBytes: MAX_INPUT_BYTES, maxNodes: MAX_CANONICAL_NODES, maxEntries: MAX_CANONICAL_ENTRIES }),
  output: Object.freeze({ label: 'explanation output', maxBytes: MAX_OUTPUT_BYTES, maxNodes: MAX_CANONICAL_NODES, maxEntries: MAX_CANONICAL_ENTRIES }),
  trace: Object.freeze({ label: 'explanation trace', maxBytes: MAX_TRACE_BYTES, maxNodes: 4_096, maxEntries: 4_096 }),
});

function failType(message) { throw new TypeError(message); }
function failRange(message) { throw new RangeError(message); }

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) failType(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) failType(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) failType(`${label} must not have symbol properties`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) failType(`${label}.${key} must be a plain data property`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  plainObject(value, label);
  for (const key of Object.keys(value)) if (!allowed.has(key)) failType(`unknown ${label} field ${key}`);
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) failType(`${label} must be finite`);
  return value;
}

function jsonStringByteLength(value, maximum, path, label) {
  let count = 2;
  const add = amount => {
    count += amount;
    if (count > maximum) failRange(`${label} exceeds its byte budget at ${path}`);
  };
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) add(2);
    else if (code < 0x20) add(code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6);
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        add(4);
        index += 1;
      } else add(6);
    } else if (code >= 0xdc00 && code <= 0xdfff) add(6);
    else if (code <= 0x7f) add(1);
    else if (code <= 0x7ff) add(2);
    else add(3);
  }
  return count;
}

function canonicalJson(value, budgetName = 'input') {
  const limits = SERIALIZATION_BUDGETS[budgetName];
  if (!limits) failType(`unknown canonical JSON budget ${budgetName}`);
  const state = { bytes: 0, nodes: 0, entries: 0 };
  const addBytes = (amount, path) => {
    state.bytes += amount;
    if (state.bytes > limits.maxBytes) failRange(`${limits.label} exceeds ${limits.maxBytes} bytes at ${path}`);
  };
  const addNode = path => {
    state.nodes += 1;
    if (state.nodes > limits.maxNodes) failRange(`${limits.label} exceeds maximum JSON node count ${limits.maxNodes} at ${path}`);
  };
  const addEntry = path => {
    state.entries += 1;
    if (state.entries > limits.maxEntries) failRange(`${limits.label} exceeds maximum JSON entry count ${limits.maxEntries} at ${path}`);
  };
  const stringLiteral = (item, path) => {
    const length = jsonStringByteLength(item, limits.maxBytes - state.bytes, path, limits.label);
    addBytes(length, path);
    return JSON.stringify(item);
  };
  const visit = (item, path, ancestors, depth) => {
    if (depth > 32) failRange(`${path} exceeds the maximum JSON depth`);
    addNode(path);
    if (item === null) { addBytes(4, path); return 'null'; }
    if (typeof item === 'string') return stringLiteral(item, path);
    if (typeof item === 'boolean') {
      const text = item ? 'true' : 'false';
      addBytes(text.length, path);
      return text;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) failType(`${path} must contain only finite numbers`);
      const text = JSON.stringify(item);
      addBytes(text.length, path);
      return text;
    }
    if (typeof item !== 'object') failType(`${path} must contain only JSON values`);
    if (ancestors.has(item)) failType(`${path} must not contain a cycle`);
    ancestors.add(item);
    let output;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) failType(`${path} must be a plain JSON array`);
      if (item.length > limits.maxEntries - state.entries || item.length > limits.maxNodes - state.nodes) {
        failRange(`${limits.label} exceeds maximum JSON node or entry count ${Math.min(limits.maxNodes, limits.maxEntries)} at ${path}`);
      }
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) || keys.length !== item.length + 1) {
        failType(`${path} must not be sparse or have custom properties`);
      }
      const parts = ['['];
      addBytes(1, path);
      for (let index = 0; index < item.length; index += 1) {
        if (index > 0) { addBytes(1, path); parts.push(','); }
        addEntry(`${path}[${index}]`);
        if (!Object.hasOwn(item, index)) failType(`${path}[${index}] is missing`);
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor?.enumerable || descriptor.get || descriptor.set) failType(`${path}[${index}] must be a plain data value`);
        parts.push(visit(descriptor.value, `${path}[${index}]`, ancestors, depth + 1));
      }
      addBytes(1, path);
      parts.push(']');
      output = parts.join('');
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) failType(`${path} must be a plain JSON object`);
      const ownKeys = Reflect.ownKeys(item);
      if (ownKeys.length > limits.maxEntries - state.entries || ownKeys.length > limits.maxNodes - state.nodes) {
        failRange(`${limits.label} exceeds maximum JSON node or entry count ${Math.min(limits.maxNodes, limits.maxEntries)} at ${path}`);
      }
      if (ownKeys.some(key => typeof key !== 'string')) failType(`${path} must not have symbol properties`);
      for (const key of ownKeys) jsonStringByteLength(key, limits.maxBytes - state.bytes, `${path} property name`, limits.label);
      const keys = ownKeys.sort();
      const parts = ['{'];
      addBytes(1, path);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (index > 0) { addBytes(1, path); parts.push(','); }
        addEntry(path);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor?.enumerable || descriptor.get || descriptor.set) failType(`${path} contains a non-data property`);
        if (descriptor.value === undefined) failType(`${path} contains an undefined value, not JSON`);
        parts.push(stringLiteral(key, `${path} property name`), ':');
        const childPath = `${path}.${key}`;
        addBytes(1, childPath);
        parts.push(visit(descriptor.value, childPath, ancestors, depth + 1));
      }
      addBytes(1, path);
      parts.push('}');
      output = parts.join('');
    }
    ancestors.delete(item);
    return output;
  };
  return visit(value, '$', new Set(), 0);
}

function bytes(value) { return new TextEncoder().encode(value).byteLength; }

function fingerprint(value) {
  const canonical = canonicalJson(value, 'input');
  const encoded = new TextEncoder().encode(canonical);
  let hash = 0x811c9dc5;
  for (const byte of encoded) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { algorithm: 'fnv1a32', hash: hash.toString(16).padStart(8, '0'), bytes: encoded.byteLength };
}

function cloneJson(value) { return JSON.parse(canonicalJson(value, 'input')); }

function validateInput(input, operation, allowed) {
  onlyKeys(input, allowed, `${operation} input`);
  const inputSize = bytes(canonicalJson(input, 'input'));
  if (inputSize > MAX_INPUT_BYTES) failRange(`explanation input exceeds ${MAX_INPUT_BYTES} bytes`);
  const experiment = plainObject(input.experiment, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') failType('experiment.schema must be ml-experiment.v1');
  if (experiment.config?.algorithm !== 'logisticRegression') failType(`${operation} requires a saved logisticRegression experiment`);
  const model = plainObject(experiment.model, 'experiment.model');
  if (model.kind !== 'logisticRegression' || model.version !== 1) failType('experiment.model must be logisticRegression version 1');
  if (!Array.isArray(model.coefficients) || model.coefficients.length < 1 || model.coefficients.length > MAX_SELECTED_FEATURES) {
    failRange(`model.coefficients must contain 1 to ${MAX_SELECTED_FEATURES} selected-feature values`);
  }
  model.coefficients.forEach((value, index) => finite(value, `model.coefficients[${index}]`));
  finite(model.intercept, 'model.intercept');
  if (typeof model.fitIntercept !== 'boolean') failType('model.fitIntercept must be boolean');
  finite(model.threshold, 'model.threshold');
  if (model.threshold < 0 || model.threshold > 1) failRange('model.threshold must be in [0, 1]');
  const training = plainObject(model.training, 'model.training');
  if (!Number.isSafeInteger(training.sampleCount) || training.sampleCount < 1 || training.sampleCount > 10_000) failRange('model.training.sampleCount is outside the supported bound');
  if (training.featureCount !== model.coefficients.length || training.initialization !== 'zeros') failRange('model.training metadata does not match its coefficients');
  if (Object.hasOwn(model, 'optimizer')) {
    const optimizer = plainObject(model.optimizer, 'model.optimizer');
    if (Object.hasOwn(optimizer, 'l2')) {
      finite(optimizer.l2, 'model.optimizer.l2');
      if (optimizer.l2 < 0) failRange('model.optimizer.l2 must be nonnegative');
    }
  }
  if (Object.hasOwn(input, 'baseline') && input.baseline !== 'trainingMean' && input.baseline !== 'zero' && !Array.isArray(input.baseline)) {
    failType("baseline must be 'trainingMean', 'zero', or a full source-schema feature vector");
  }
  const preparedInput = { experiment, features: input.features };
  if (Object.hasOwn(input, 'baseline')) preparedInput.baseline = input.baseline;
  const prepared = prepareExplanationFeatures(preparedInput);
  if (prepared.names.length !== model.coefficients.length || prepared.indices.length > MAX_SELECTED_FEATURES || prepared.indices.length === 0) {
    failRange('selected feature dimensions do not match the logistic coefficients');
  }
  if (prepared.sourceIdentity.kind !== experiment.dataset.sourceKind) failRange('source identity does not match retained data provenance');
  const modelIdentity = fingerprint({
    model,
    preprocessing: experiment.preprocessing,
    selectedFeatures: experiment.selectedFeatures,
  });
  const experimentIdentity = {
    schema: experiment.schema,
    sourceIdentity: cloneJson(prepared.sourceIdentity),
    modelIdentity,
  };
  return { experiment, model, prepared, experimentIdentity };
}

function actualPrediction(experiment, fullRawFeatures, stage, calls) {
  const result = predictMLModel({
    experiment,
    records: [{ runId: `explain-${stage}`, conditionId: `explain-${stage}`, features: [...fullRawFeatures] }],
  });
  if (!Array.isArray(result.scores) || result.scores.length !== 1 ||
      !Array.isArray(result.probabilities) || result.probabilities.length !== 1 ||
      !Array.isArray(result.labels) || result.labels.length !== 1) {
    failRange('shared ML predictor returned an invalid single-row result');
  }
  const logit = finite(result.scores[0], `${stage} logit`);
  const probability = finite(result.probabilities[0], `${stage} probability`);
  if (probability < 0 || probability > 1) failRange(`${stage} probability must be in [0, 1]`);
  const label = result.labels[0];
  if (label !== 0 && label !== 1) failRange(`${stage} label must be 0 or 1`);
  const prediction = { logit, probability, threshold: experiment.model.threshold, label };
  calls.push({
    sourceId: 'src/ml/index.mjs#predictMLModel',
    stage: `${stage}-prediction`,
    inputSummary: { rows: 1, sourceFeatureCount: fullRawFeatures.length },
    outputSummary: { ...prediction },
  });
  return prediction;
}

function compensatedSum(values, label) {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const adjusted = finite(value - correction, `${label} adjusted term`);
    const next = finite(sum + adjusted, label);
    correction = finite((next - sum) - adjusted, `${label} correction`);
    sum = next;
  }
  return sum;
}

function reconstructLogit(baselineLogit, contributions, actualLogit) {
  const contributionSum = compensatedSum(contributions, 'logit contribution sum');
  const reconstructedLogit = compensatedSum([baselineLogit, ...contributions], 'reconstructed logit');
  const residual = finite(actualLogit - reconstructedLogit, 'logit reconstruction residual');
  const magnitude = compensatedSum([Math.abs(baselineLogit), ...contributions.map(Math.abs)], 'logit reconstruction magnitude');
  const scale = Math.max(1, Math.abs(actualLogit), Math.abs(reconstructedLogit), magnitude);
  const tolerance = ROUNDING_FACTOR * (contributions.length + 2) * scale;
  if (!Number.isFinite(tolerance)) failRange('logit reconstruction roundoff bound is outside the finite range');
  const withinTolerance = Math.abs(residual) <= tolerance;
  if (!withinTolerance) failRange(`logit contributions do not reconstruct the actual predictor within roundoff tolerance ${tolerance}`);
  return { baselineLogit, contributionSum, reconstructedLogit, actualLogit, residual, tolerance, withinTolerance };
}

function makeTrace(calls, operation) {
  const trace = { schema: 'explain.logistic-trace.v1', operation, calls, bytes: 0 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const measured = bytes(canonicalJson(trace, 'trace'));
    if (trace.bytes === measured) break;
    trace.bytes = measured;
  }
  if (trace.bytes > MAX_TRACE_BYTES) failRange(`explanation trace exceeds ${MAX_TRACE_BYTES} bytes`);
  return trace;
}

function checkOutputSize(output) {
  const size = bytes(canonicalJson(output, 'output'));
  if (size > MAX_OUTPUT_BYTES) failRange(`explanation output exceeds ${MAX_OUTPUT_BYTES} bytes`);
  return output;
}

/** Explain a saved logistic model in raw feature coordinates; contributions sum to the pre-sigmoid logit. */
export function explainLogisticRegression(input) {
  const { experiment, model, prepared, experimentIdentity } = validateInput(
    input,
    'explainLogisticRegression',
    new Set(['experiment', 'features', 'baseline']),
  );
  const calls = [{
    sourceId: 'src/explain/regression.mjs#prepareExplanationFeatures',
    stage: 'retained-selection-and-reference-preparation',
    inputSummary: { sourceFeatureCount: prepared.rawInput.length, selectedFeatureCount: prepared.names.length, referenceKind: prepared.referenceKind },
    outputSummary: { selectedInputCount: prepared.selectedInput.length, selectedReferenceCount: prepared.selectedReference.length, modelFeatureCount: prepared.modelInput.length },
  }];
  const baselinePrediction = actualPrediction(experiment, prepared.rawReference, 'baseline', calls);
  const prediction = actualPrediction(experiment, prepared.rawInput, 'input', calls);
  const contributions = prepared.indices.map((sourceIndex, index) => {
    const coefficient = model.coefficients[index];
    const scale = prepared.scales[index];
    const rawCoefficient = finite(coefficient / scale, `raw coefficient[${index}]`);
    const rawDelta = finite(prepared.selectedInput[index] - prepared.selectedReference[index], `raw feature delta[${index}]`);
    const transformedDelta = finite(prepared.modelInput[index] - prepared.modelReference[index], `transformed feature delta[${index}]`);
    const logitContribution = finite(rawCoefficient * rawDelta, `logit contribution[${index}]`);
    return {
      featureName: prepared.names[index],
      sourceIndex,
      coefficient,
      rawCoefficient,
      inputRawValue: prepared.selectedInput[index],
      referenceRawValue: prepared.selectedReference[index],
      rawDelta,
      transformedDelta,
      logitContribution,
      unit: 'logit',
    };
  });
  const reconstruction = reconstructLogit(
    baselinePrediction.logit,
    contributions.map(item => item.logitContribution),
    prediction.logit,
  );
  calls.push({
    sourceId: 'src/explain/classification.mjs#reconstructLogit',
    stage: 'additive-logit-reconstruction',
    inputSummary: { featureCount: contributions.length, baselineLogit: reconstruction.baselineLogit },
    outputSummary: { contributionSum: reconstruction.contributionSum, reconstructedLogit: reconstruction.reconstructedLogit, actualLogit: reconstruction.actualLogit, residual: reconstruction.residual, tolerance: reconstruction.tolerance },
  });
  const referenceProvenance = prepared.referenceKind === 'trainingMean'
    ? experiment.preprocessing ? 'retained-standardizer-means' : 'retained-experiment.split.train-rows'
    : prepared.referenceKind === 'zero' ? 'raw-zero-reference' : 'caller-supplied-full-source-row';
  const explanation = {
    kind: 'logisticPredictionExplanation',
    version: 1,
    experimentIdentity,
    featureNames: [...prepared.names],
    selectedFeatureIndices: [...prepared.indices],
    baseline: {
      kind: prepared.referenceKind,
      provenance: referenceProvenance,
      rawSelectedFeatures: [...prepared.selectedReference],
      transformedFeatures: [...prepared.modelReference],
      logit: baselinePrediction.logit,
      probability: baselinePrediction.probability,
      threshold: baselinePrediction.threshold,
      label: baselinePrediction.label,
    },
    input: {
      rawSelectedFeatures: [...prepared.selectedInput],
      transformedFeatures: [...prepared.modelInput],
    },
    prediction: { ...prediction },
    contributions,
    reconstruction,
    trace: makeTrace(calls, 'explainLogisticRegression'),
  };
  return checkOutputSize(explanation);
}

/** Replace selected raw input values and compare actual before/after model predictions. */
export function perturbLogisticRegression(input) {
  onlyKeys(input, new Set(['experiment', 'features', 'changes', 'baseline']), 'perturbLogisticRegression input');
  const beforeExplanation = explainLogisticRegression({
    experiment: input.experiment,
    features: input.features,
    ...(Object.hasOwn(input, 'baseline') ? { baseline: input.baseline } : {}),
  });
  const rawInput = input.features;
  const changes = plainObject(input.changes, 'changes');
  const changeKeys = Object.keys(changes);
  if (changeKeys.length < 1 || changeKeys.length > beforeExplanation.featureNames.length) {
    failRange(`changes must contain 1 to ${beforeExplanation.featureNames.length} selected feature names`);
  }
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(changes))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) failType(`changes.${name} must be a plain data property`);
  }
  const indexByName = new Map(beforeExplanation.featureNames.map((name, index) => [name, beforeExplanation.selectedFeatureIndices[index]]));
  for (const name of changeKeys) {
    if (!indexByName.has(name)) failRange(`changes feature ${name} is unknown or was not selected for this model`);
  }
  const changedFeatures = rawInput.slice();
  const normalizedChanges = [];
  for (const name of beforeExplanation.featureNames) {
    if (!Object.hasOwn(changes, name)) continue;
    const sourceIndex = indexByName.get(name);
    const replacementValue = finite(changes[name], `changes.${name}`);
    const previousValue = finite(rawInput[sourceIndex], `features[${sourceIndex}]`);
    const delta = finite(replacementValue - previousValue, `changes.${name} delta`);
    changedFeatures[sourceIndex] = replacementValue;
    normalizedChanges.push({ featureName: name, sourceIndex, previousValue, replacementValue, delta });
  }
  const afterExplanation = explainLogisticRegression({
    experiment: input.experiment,
    features: changedFeatures,
    ...(Object.hasOwn(input, 'baseline') ? { baseline: input.baseline } : {}),
  });
  const before = {
    logit: beforeExplanation.prediction.logit,
    probability: beforeExplanation.prediction.probability,
    threshold: beforeExplanation.prediction.threshold,
    label: beforeExplanation.prediction.label,
  };
  const after = {
    logit: afterExplanation.prediction.logit,
    probability: afterExplanation.prediction.probability,
    threshold: afterExplanation.prediction.threshold,
    label: afterExplanation.prediction.label,
  };
  const effect = {
    logitDelta: finite(after.logit - before.logit, 'counterfactual logit delta'),
    probabilityDelta: finite(after.probability - before.probability, 'counterfactual probability delta'),
    labelChanged: before.label !== after.label,
  };
  return checkOutputSize({
    kind: 'logisticCounterfactual',
    version: 1,
    experimentIdentity: cloneJson(beforeExplanation.experimentIdentity),
    changes: normalizedChanges,
    before,
    after,
    effect,
    beforeExplanation,
    afterExplanation,
  });
}
