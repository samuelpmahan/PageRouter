import { predictMLModel, replayMLExperiment } from '../ml/index.mjs';
import { mean as statisticsMean } from '../statistics/core.mjs';
import { canonicalWatchJson } from '../watches/index.mjs';
import { buildEvidenceContext as buildTypedEvidenceContext, checkExplanationClaims as checkTypedClaims } from './grounding.mjs';
import { explainLinearRegression, perturbLinearRegression, EXPLANATION_LIMITS } from './regression.mjs';
import { explainLogisticRegression, perturbLogisticRegression } from './classification.mjs';
import { explainKMeans } from './clustering.mjs';
import { explainPCA } from './pca.mjs';
import { explainWatch as explainWatchState } from './watch.mjs';

const TRACE_VERSION = 'explain-workbench-1';
const MAX_TRACE_BYTES = 64 * 1024;
const MAX_CANONICAL_BYTES = 8 * 1024 * 1024;
const MAX_CANONICAL_NODES = 250_000;
const validAlgorithms = new Set(['linearRegression', 'logisticRegression', 'kMeans', 'pca']);
const contextRecipes = new WeakMap();
const encoder = new TextEncoder();

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label}.${key} must be an enumerable plain value`);
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${label} cannot contain symbol properties`);
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown ${label} field ${key}`);
}

function canonicalStringBytes(value) {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index += 1; }
      else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

function canonical(value, path = '$', ancestors = new Set(), depth = 0, budget = { bytes: 0, nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > MAX_CANONICAL_NODES) throw new RangeError(`${path} exceeds ${MAX_CANONICAL_NODES} JSON nodes`);
  if (depth > 64) throw new RangeError(`${path} exceeds maximum explanation JSON depth 64`);
  const charge = amount => {
    budget.bytes += amount;
    if (budget.bytes > MAX_CANONICAL_BYTES) throw new RangeError(`${path} exceeds ${MAX_CANONICAL_BYTES} canonical JSON bytes`);
  };
  if (value === null || typeof value === 'boolean') {
    const result = JSON.stringify(value);
    charge(result.length);
    return result;
  }
  if (typeof value === 'string') {
    charge(canonicalStringBytes(value));
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a nonfinite number`);
    const result = JSON.stringify(value);
    charge(result.length);
    return result;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} is not a JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path} must be a plain JSON array`);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length))) throw new TypeError(`${path} contains a non-index array property`);
    charge(2 + Math.max(0, value.length - 1));
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is sparse`);
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}[${index}] must be a plain data value`);
      entries.push(canonical(value[index], `${path}[${index}]`, ancestors, depth + 1, budget));
    }
    result = `[${entries.join(',')}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must contain only plain JSON objects`);
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path} cannot contain symbol properties`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}.${key} must be a plain data value`);
    }
    const keys = Object.keys(value).sort();
    charge(2 + Math.max(0, keys.length - 1));
    result = `{${keys.map(key => {
      charge(canonicalStringBytes(key) + 1);
      return `${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`, ancestors, depth + 1, budget)}`;
    }).join(',')}}`;
  }
  ancestors.delete(value);
  return result;
}

function clone(value, label = 'value') {
  return JSON.parse(canonical(value, label));
}

function digest(value, prefix) {
  const text = typeof value === 'string' ? value : canonical(value);
  let hash = 0xcbf29ce484222325n;
  for (const byte of encoder.encode(text)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return `${prefix}:${hash.toString(16).padStart(16, '0')}`;
}

function close(actual, expected, tolerance) {
  return Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function rawVector(experiment, input, label = 'features') {
  if (!Array.isArray(input) || input.length !== experiment.selectedFeatures.sourceFeatureNames.length || input.length > EXPLANATION_LIMITS.maxSourceFeatures) {
    throw new RangeError(`${label} must contain exactly ${experiment.selectedFeatures.sourceFeatureNames.length} values in source-schema order`);
  }
  input.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label}[${index}] must be finite`);
  });
  return input.slice();
}

function validateExperiment(experiment) {
  object(experiment, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') throw new TypeError('experiment.schema must be ml-experiment.v1');
  const algorithm = experiment.config?.algorithm;
  if (!validAlgorithms.has(algorithm)) throw new TypeError('experiment.config.algorithm is unsupported');
  const selection = experiment.selectedFeatures;
  object(selection, 'experiment.selectedFeatures');
  if (!Array.isArray(selection.sourceFeatureNames) || !Array.isArray(selection.names) || !Array.isArray(selection.indices)
      || selection.sourceFeatureNames.length < 1 || selection.sourceFeatureNames.length > EXPLANATION_LIMITS.maxSourceFeatures
      || selection.names.length < 1 || selection.names.length > EXPLANATION_LIMITS.maxSelectedFeatures
      || selection.names.length !== selection.indices.length) {
    throw new RangeError('saved selected feature schema is malformed or exceeds explanation bounds');
  }
  if (new Set(selection.sourceFeatureNames).size !== selection.sourceFeatureNames.length || new Set(selection.indices).size !== selection.indices.length) {
    throw new TypeError('saved source feature names and selected indices must be unique');
  }
  for (const [index, name] of selection.sourceFeatureNames.entries()) {
    if (typeof name !== 'string' || name.length === 0 || encoder.encode(name).length > 256) {
      throw new RangeError(`saved source feature name ${index} must be nonempty and at most 256 UTF-8 bytes`);
    }
  }
  for (let index = 0; index < selection.indices.length; index += 1) {
    const sourceIndex = selection.indices[index];
    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= selection.sourceFeatureNames.length
        || selection.sourceFeatureNames[sourceIndex] !== selection.names[index]) {
      throw new TypeError(`saved feature selection index ${index} does not match the source schema`);
    }
  }
  if (!Array.isArray(experiment.dataset?.records) || experiment.dataset.records.length > 10_000) throw new RangeError('saved experiment dataset is missing or exceeds explanation bounds');
  const size = encoder.encode(canonical(experiment, 'experiment')).length;
  if (size > EXPLANATION_LIMITS.maxExperimentBytes) throw new RangeError(`saved experiment exceeds ${EXPLANATION_LIMITS.maxExperimentBytes} bytes`);
  const replay = replayMLExperiment({ experiment });
  if (!replay.matches) throw new TypeError(`saved experiment does not match a fresh replay${replay.mismatches.length ? `: ${replay.mismatches.join(', ')}` : ''}`);
  return {
    algorithm,
    replayTrace: {
      id: 'src/ml/index.mjs#replayMLExperiment',
      source: 'capability-lab',
      version: 'capability-lab-ml-1',
      input: {
        configIdentity: digest(experiment.config, 'ml-config'),
        datasetIdentity: digest(experiment.dataset, 'ml-dataset'),
        retainedArtifactIdentity: digest(replay.canonicalState, 'ml-artifact'),
      },
      result: {
        exactCanonicalMatch: replay.matches,
        canonicalBytes: encoder.encode(replay.canonicalFresh).length,
        mismatchCount: replay.mismatches.length,
      },
    },
  };
}

function modelIdentity(experiment) {
  return digest({
    algorithm: experiment.config.algorithm,
    sourceIdentity: experiment.sourceIdentity,
    config: experiment.config,
    selectedFeatures: experiment.selectedFeatures,
    preprocessing: experiment.preprocessing,
    model: experiment.model,
  }, 'ml-model');
}

function stateIdentity(experiment, features) {
  return digest({ sourceIdentity: experiment.sourceIdentity, features }, 'ml-input');
}

function modelSources({ stateId, modelId }) {
  return [
    { id: 'fitted-model', title: 'Retained fitted model and preprocessing', scope: 'model arithmetic', identity: modelId, url: null },
    { id: 'dataset-lineage', title: 'Caller-declared dataset lineage for this input', scope: 'model input lineage', identity: stateId, url: null },
  ];
}

function predictionFor(experiment, features) {
  return predictMLModel({
    experiment,
    records: [{ runId: 'explanation-input', conditionId: 'explanation-input', features }],
  });
}

function trainingMeanBaseline(experiment) {
  const names = experiment.selectedFeatures.sourceFeatureNames;
  const selected = experiment.selectedFeatures.indices;
  const training = experiment.split?.train;
  if (!Array.isArray(training) || training.length < 1) throw new TypeError('saved experiment has no retained training rows for a training-mean reference');
  const baseline = Array(names.length).fill(0);
  const actualCalls = [];
  for (const sourceIndex of selected) {
    const values = training.map((record, row) => {
      const value = record?.features?.[sourceIndex];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`saved training feature ${row}.${sourceIndex} is not finite`);
      return value;
    });
    const result = statisticsMean({ values });
    baseline[sourceIndex] = result.value;
    actualCalls.push({ sourceIndex, rowCount: values.length, mean: result.value });
  }
  return { features: baseline, calls: actualCalls };
}

function resolveBaseline(experiment, algorithm, attribution, inputFeatures, requestedBaseline) {
  let baselineKind = requestedBaseline ?? 'trainingMean';
  if (typeof baselineKind === 'string') {
    if (baselineKind !== 'trainingMean' && baselineKind !== 'zero') throw new RangeError("baseline must be 'trainingMean', 'zero', or a full source-schema vector");
    if (baselineKind === 'zero') return { kind: 'zero', features: Array(inputFeatures.length).fill(0), meanCalls: [] };
    if (algorithm === 'linearRegression') {
      const features = Array(inputFeatures.length).fill(0);
      attribution.reference.featureValues.forEach((value, index) => { features[experiment.selectedFeatures.indices[index]] = value; });
      return { kind: 'trainingMean', features, meanCalls: [] };
    }
    if (algorithm === 'logisticRegression') {
      const features = Array(inputFeatures.length).fill(0);
      attribution.baseline.rawSelectedFeatures.forEach((value, index) => { features[experiment.selectedFeatures.indices[index]] = value; });
      return { kind: 'trainingMean', features, meanCalls: [] };
    }
    const means = trainingMeanBaseline(experiment);
    return { kind: 'trainingMean', features: means.features, meanCalls: means.calls };
  }
  const features = rawVector(experiment, baselineKind, 'baseline');
  return { kind: 'explicit', features, meanCalls: [] };
}

function nativeSummary(algorithm, prediction) {
  if (algorithm === 'linearRegression') return { value: prediction.predictions[0], unit: 'target units' };
  if (algorithm === 'logisticRegression') return { value: prediction.scores[0], unit: 'logit' };
  if (algorithm === 'kMeans') return { value: prediction.squaredDistances[0], unit: 'squared model-feature distance' };
  return { value: prediction.projected[0][0], unit: 'component-1 score' };
}

function attributionContributions(algorithm, attribution) {
  if (algorithm === 'linearRegression') return attribution.contributions.map(item => ({
    name: `feature-${item.index}`, index: item.index, inputValue: item.inputValue,
    referenceValue: item.referenceValue, coefficient: item.coefficient, contribution: item.contribution,
  }));
  if (algorithm === 'logisticRegression') return attribution.contributions.map(item => ({
    name: `feature-${item.sourceIndex}`, index: item.sourceIndex, inputValue: item.inputRawValue,
    referenceValue: item.referenceRawValue, coefficient: item.rawCoefficient, contribution: item.logitContribution,
  }));
  if (algorithm === 'kMeans') {
    const chosen = attribution.centers.find(center => center.selected);
    return chosen.selectedCoordinates.map(item => ({
      name: `feature-${item.index}`, index: item.index, inputValue: item.inputValue,
      referenceValue: item.centerValue, coefficient: item.difference, contribution: item.squaredContribution,
    }));
  }
  return attribution.components.flatMap(component => component.contributions.map(item => ({
    name: `component-${component.componentIndex}-feature-${item.index}`, index: item.index,
    inputValue: item.centeredModelValue, referenceValue: 0, coefficient: item.loadingModel,
    contribution: item.contribution,
  })));
}

function verifyAttribution(algorithm, attribution, prediction) {
  if (algorithm === 'linearRegression') {
    const error = Math.abs(attribution.prediction - prediction.predictions[0]);
    const tolerance = Math.max(attribution.roundoff.tolerance, 64 * Number.EPSILON * Math.max(1, Math.abs(prediction.predictions[0])));
    if (error > tolerance || !attribution.roundoff.withinTolerance) throw new RangeError('linear attribution does not match the retained predictor within roundoff tolerance');
    return { matchesNativePrediction: true, absoluteError: error, tolerance, reconstructed: attribution.reconstructedPrediction };
  }
  if (algorithm === 'logisticRegression') {
    const error = Math.abs(attribution.prediction.logit - prediction.scores[0]);
    const probabilityError = Math.abs(attribution.prediction.probability - prediction.probabilities[0]);
    const tolerance = Math.max(attribution.reconstruction.tolerance, 64 * Number.EPSILON);
    if (error > tolerance || probabilityError > 64 * Number.EPSILON || attribution.prediction.label !== prediction.labels[0]) throw new RangeError('logistic explanation does not match the retained predictor');
    return { matchesNativePrediction: true, logitError: error, probabilityError, tolerance, reconstructedLogit: attribution.reconstruction.reconstructedLogit };
  }
  if (algorithm === 'kMeans') {
    const squaredError = Math.abs(attribution.prediction.squaredDistance - prediction.squaredDistances[0]);
    const tolerance = attribution.prediction.roundoffTolerance;
    if (attribution.prediction.clusterIndex !== prediction.assignments[0] || squaredError > tolerance || !attribution.prediction.distanceReconstruction.withinTolerance) throw new RangeError('k-means distance attribution does not match the retained predictor');
    return { matchesNativePrediction: true, squaredDistanceError: squaredError, tolerance, clusterIndex: prediction.assignments[0] };
  }
  const errors = attribution.components.map((component, index) => Math.abs(component.score - prediction.projected[0][index]));
  const tolerance = Math.max(...attribution.components.map(component => component.reconstruction.tolerance));
  if (errors.some(error => error > tolerance) || attribution.components.some(component => !component.reconstruction.withinTolerance)) throw new RangeError('PCA loading contributions do not match the retained projection');
  return { matchesNativePrediction: true, componentErrors: errors, tolerance, projected: prediction.projected[0] };
}

function helperFor(algorithm) {
  if (algorithm === 'linearRegression') return { id: 'src/explain/regression.mjs#explainLinearRegression', run: explainLinearRegression };
  if (algorithm === 'logisticRegression') return { id: 'src/explain/classification.mjs#explainLogisticRegression', run: explainLogisticRegression };
  if (algorithm === 'kMeans') return { id: 'src/explain/clustering.mjs#explainKMeans', run: explainKMeans };
  return { id: 'src/explain/pca.mjs#explainPCA', run: explainPCA };
}

function makeTrace(algorithm, experiment, features, attribution, prediction, meanCalls = [], replayTrace = null) {
  const helper = helperFor(algorithm);
  const attributionJson = canonical(attribution, 'attribution');
  const predictionJson = canonical(prediction, 'prediction');
  const calls = [
    ...(replayTrace ? [replayTrace] : []),
    {
      id: helper.id,
      source: 'capability-lab',
      version: TRACE_VERSION,
      input: { algorithm, featureCount: features.length, selectedIndices: experiment.selectedFeatures.indices, sourceIdentity: experiment.sourceIdentity },
      result: { identity: digest(attributionJson, 'explanation-result'), canonicalBytes: encoder.encode(attributionJson).length },
    },
    {
      id: 'src/ml/index.mjs#predictMLModel',
      source: 'capability-lab',
      version: 'capability-lab-ml-1',
      input: { algorithm, features },
      result: { identity: digest(predictionJson, 'prediction-result'), canonicalBytes: encoder.encode(predictionJson).length, summary: nativeSummary(algorithm, prediction) },
    },
  ];
  if (meanCalls.length) calls.push({
    id: 'src/statistics/core.mjs#mean', source: 'capability-lab', version: 'statistics-1',
    input: { trainingRows: experiment.split.train.length, selectedSourceIndices: meanCalls.map(item => item.sourceIndex) },
    result: { count: meanCalls.length, values: meanCalls },
  });
  const directTrace = attribution.trace ?? null;
  const output = { schema: 'explain.calculation-trace.v1', calls, attributionTrace: directTrace };
  output.bytes = encoder.encode(canonical(output)).length;
  if (output.bytes > MAX_TRACE_BYTES) throw new RangeError(`explanation trace exceeds ${MAX_TRACE_BYTES} bytes`);
  return output;
}

function modelContext({ experiment, features, baseline, prediction, baselinePrediction, attribution, algorithm, stateId, modelId, trace }) {
  const sourceIdentity = clone(experiment.sourceIdentity, 'experiment.sourceIdentity');
  const localSources = modelSources({ stateId, modelId });
  const evidence = [];
  const add = (id, value, unit, scope, citationIds = ['fitted-model']) => evidence.push({
    id, value, unit, kind: 'derived', permittedScopes: [scope], citationIds,
    stateIdentity: stateId, modelIdentity: modelId,
  });
  add('prediction:input', prediction, algorithm === 'logisticRegression' ? 'scores in logits, probabilities in [0,1], and threshold labels' : 'native model prediction', 'model.prediction');
  if (baseline) add('prediction:baseline', {
    kind: baseline.kind === 'trainingMean' ? 'training-mean' : baseline.kind,
    featureValues: experiment.selectedFeatures.indices.map(index => baseline.features[index]),
    prediction: baselinePrediction,
  }, 'raw selected feature values and native prediction', 'model.baseline', ['fitted-model', 'dataset-lineage']);
  const contributions = attributionContributions(algorithm, attribution);
  if (contributions.length) add('prediction:contributions', contributions, algorithm === 'logisticRegression' ? 'logit contributions' : algorithm === 'kMeans' ? 'squared-distance contributions' : algorithm === 'pca' ? 'component-score contributions' : 'target-unit contributions', 'model.contribution');
  const context = buildTypedEvidenceContext({
    contextId: `model-explanation:${algorithm}:${stateId}:${modelId}`,
    stateIdentity: stateId,
    modelIdentity: modelId,
    sourceKind: experiment.dataset.sourceKind === 'synthetic-watch' ? 'synthetic-watch'
      : experiment.dataset.sourceKind === 'browser-observed' ? 'browser-observed' : 'model-derived',
    sources: localSources,
    evidence,
  });
  return context;
}

function registerContext(context, recipe) {
  contextRecipes.set(context, recipe);
  return context;
}

/** Explain one saved model prediction from one raw source-schema feature vector. */
export function explainPrediction(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['experiment', 'features', 'baseline']), 'explainPrediction input');
  const experiment = input.experiment;
  const { algorithm, replayTrace } = validateExperiment(experiment);
  const features = rawVector(experiment, input.features);
  const helper = helperFor(algorithm);
  const baselineArgument = input.baseline;
  let attribution;
  if (algorithm === 'linearRegression' || algorithm === 'logisticRegression') {
    attribution = helper.run({ experiment, features, ...(baselineArgument === undefined ? {} : { baseline: baselineArgument }) });
  } else {
    if (baselineArgument !== undefined && !['trainingMean', 'zero'].includes(baselineArgument) && !Array.isArray(baselineArgument)) {
      throw new RangeError("baseline must be 'trainingMean', 'zero', or a full source-schema vector");
    }
    attribution = helper.run({ experiment, features });
  }
  const baseline = resolveBaseline(experiment, algorithm, attribution, features, baselineArgument);
  const prediction = predictionFor(experiment, features);
  const baselinePrediction = predictionFor(experiment, baseline.features);
  const verification = verifyAttribution(algorithm, attribution, prediction);
  const stateId = stateIdentity(experiment, features);
  const modelId = modelIdentity(experiment);
  const calculationTrace = makeTrace(algorithm, experiment, features, attribution, prediction, baseline.meanCalls, replayTrace);
  const context = modelContext({ experiment, features, baseline, prediction, baselinePrediction, attribution, algorithm, stateId, modelId, trace: calculationTrace });
  const result = {
    schema: 'explain.prediction.v1',
    algorithm,
    sourceIdentity: clone(experiment.sourceIdentity, 'experiment.sourceIdentity'),
    stateIdentity: stateId,
    modelIdentity: modelId,
    sourceFeatureNames: [...experiment.selectedFeatures.sourceFeatureNames],
    selectedFeatures: clone(experiment.selectedFeatures),
    features,
    baseline: {
      kind: baseline.kind === 'trainingMean' ? 'training-mean' : baseline.kind,
      featureValues: baseline.features,
      selectedFeatureValues: experiment.selectedFeatures.indices.map(index => baseline.features[index]),
      prediction: baselinePrediction,
    },
    prediction,
    attribution,
    verification,
    calculationTrace,
    limitations: [
      'These contributions explain fitted-model arithmetic; they do not establish real-world causation.',
      experiment.sourceIdentity?.declaredByCaller === true ? 'Dataset sourceKind is caller-declared provenance and is not independently authenticated.' : 'Source provenance is limited to the retained experiment artifact.',
      algorithm === 'logisticRegression' ? 'Feature contributions sum to the pre-sigmoid logit; probability is computed once from that score and is not an additive contribution sum.' : '',
      algorithm === 'kMeans' ? 'Coordinate terms add to squared Euclidean distance in the saved model feature space; they do not add to Euclidean distance.' : '',
      algorithm === 'pca' ? 'Projection contributions explain retained component scores; directions are not causal effects.' : '',
    ].filter(Boolean),
    context,
  };
  registerContext(context, { experiment, features, ...(baselineArgument === undefined ? {} : { baseline: baselineArgument }) });
  return result;
}

function changedPredictionDelta(algorithm, before, after) {
  if (algorithm === 'linearRegression') return after.predictions[0] - before.predictions[0];
  if (algorithm === 'logisticRegression') return after.scores[0] - before.scores[0];
  if (algorithm === 'kMeans') return after.squaredDistances[0] - before.squaredDistances[0];
  return after.projected[0][0] - before.projected[0][0];
}

function namedChanges(experiment, features, changes) {
  object(changes, 'changes');
  const keys = Object.keys(changes);
  if (keys.length < 1 || keys.length > experiment.selectedFeatures.sourceFeatureNames.length) throw new RangeError('changes must contain at least one source feature delta');
  const records = [];
  const changedFeatures = features.slice();
  const selected = new Set(experiment.selectedFeatures.indices);
  for (const [name, delta] of Object.entries(changes)) {
    const index = experiment.selectedFeatures.sourceFeatureNames.indexOf(name);
    if (index < 0) throw new RangeError(`unknown source feature ${name}`);
    if (typeof delta !== 'number' || !Number.isFinite(delta)) throw new TypeError(`changes.${name} must be a finite raw-unit delta`);
    const next = features[index] + delta;
    if (!Number.isFinite(next)) throw new RangeError(`changed feature ${name} is outside the finite numeric range`);
    changedFeatures[index] = next;
    records.push({ name, index, from: features[index], to: next, delta, selected: selected.has(index) });
  }
  return { changedFeatures, records };
}

function perturbScalar(algorithm, prediction) {
  return nativeSummary(algorithm, prediction).value;
}

/** Perturb raw selected inputs by signed deltas and run the same retained model again. */
export function perturbPrediction(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['experiment', 'features', 'changes', 'baseline']), 'perturbPrediction input');
  const experiment = input.experiment;
  const { algorithm, replayTrace } = validateExperiment(experiment);
  const features = rawVector(experiment, input.features);
  const { changedFeatures, records } = namedChanges(experiment, features, input.changes);
  const modelBefore = canonical({ model: experiment.model, preprocessing: experiment.preprocessing, selectedFeatures: experiment.selectedFeatures });
  const beforePrediction = predictionFor(experiment, features);
  const afterPrediction = predictionFor(experiment, changedFeatures);
  let directPerturbation = null;
  const allSelected = records.every(change => change.selected);
  if (algorithm === 'linearRegression') {
    directPerturbation = perturbLinearRegression({ experiment, features, changes: input.changes });
  } else if (algorithm === 'logisticRegression' && allSelected) {
    const replacements = Object.fromEntries(records.map(change => [change.name, change.to]));
    directPerturbation = perturbLogisticRegression({
      experiment, features, changes: replacements,
      ...(input.baseline === undefined ? {} : { baseline: input.baseline }),
    });
  }
  const originalExplanation = explainPrediction({ experiment, features, ...(input.baseline === undefined ? {} : { baseline: input.baseline }) });
  const changedExplanation = explainPrediction({ experiment, features: changedFeatures, ...(input.baseline === undefined ? {} : { baseline: input.baseline }) });
  const predictionDelta = changedPredictionDelta(algorithm, beforePrediction, afterPrediction);
  if (!Number.isFinite(predictionDelta)) throw new RangeError('counterfactual prediction delta is outside the finite range');
  const unchanged = modelBefore === canonical({ model: experiment.model, preprocessing: experiment.preprocessing, selectedFeatures: experiment.selectedFeatures });
  if (!unchanged) throw new Error('counterfactual explanation mutated the fitted model or preprocessing');
  const effects = algorithm === 'linearRegression'
    ? { predictionDelta }
    : algorithm === 'logisticRegression'
      ? { logitDelta: predictionDelta, probabilityDelta: afterPrediction.probabilities[0] - beforePrediction.probabilities[0], labelChanged: afterPrediction.labels[0] !== beforePrediction.labels[0] }
      : algorithm === 'kMeans'
        ? { squaredDistanceDelta: predictionDelta, clusterChanged: afterPrediction.assignments[0] !== beforePrediction.assignments[0] }
        : { firstComponentScoreDelta: predictionDelta, projectedDeltas: afterPrediction.projected[0].map((score, index) => score - beforePrediction.projected[0][index]) };
  const stateId = digest({ sourceIdentity: experiment.sourceIdentity, before: features, after: changedFeatures }, 'ml-perturbation');
  const modelId = modelIdentity(experiment);
  const scalarBefore = perturbScalar(algorithm, beforePrediction);
  const scalarAfter = perturbScalar(algorithm, afterPrediction);
  const localSources = modelSources({ stateId, modelId });
  const sourceFeatures = experiment.selectedFeatures.indices;
  const perturbEvidence = {
    originalFeatures: sourceFeatures.map(index => features[index]),
    changedFeatures: sourceFeatures.map(index => changedFeatures[index]),
    originalPrediction: scalarBefore,
    changedPrediction: scalarAfter,
    predictionDelta,
    delta: predictionDelta,
    namedDeltas: records.map(change => ({ name: `feature-${change.index}`, delta: change.delta })),
  };
  const attributionRows = attributionContributions(algorithm, originalExplanation.attribution);
  const evidence = [
    { id: 'prediction:before', value: beforePrediction, unit: 'native model prediction', kind: 'derived', permittedScopes: ['model.prediction'], citationIds: ['fitted-model'], stateIdentity: stateId, modelIdentity: modelId },
    { id: 'prediction:after', value: afterPrediction, unit: 'native model prediction after raw input deltas', kind: 'derived', permittedScopes: ['model.prediction'], citationIds: ['fitted-model'], stateIdentity: stateId, modelIdentity: modelId },
    { id: 'prediction:perturbation', value: perturbEvidence, unit: nativeSummary(algorithm, beforePrediction).unit, kind: 'derived', permittedScopes: ['model.perturbation'], citationIds: ['fitted-model', 'dataset-lineage'], stateIdentity: stateId, modelIdentity: modelId },
  ];
  if (attributionRows.length) evidence.push({
    id: 'prediction:contributions', value: attributionRows, unit: 'contributions at the original input', kind: 'derived',
    permittedScopes: ['model.contribution'], citationIds: ['fitted-model'], stateIdentity: stateId, modelIdentity: modelId,
  });
  const context = buildTypedEvidenceContext({
    contextId: `model-perturbation:${algorithm}:${stateId}:${modelId}`,
    stateIdentity: stateId,
    modelIdentity: modelId,
    sourceKind: experiment.dataset.sourceKind === 'synthetic-watch' ? 'synthetic-watch'
      : experiment.dataset.sourceKind === 'browser-observed' ? 'browser-observed' : 'model-derived',
    sources: localSources,
    evidence,
  });
  const calculationTrace = {
    schema: 'explain.calculation-trace.v1',
    calls: [
      replayTrace,
      { id: 'src/ml/index.mjs#predictMLModel', source: 'capability-lab', version: 'capability-lab-ml-1', input: { features }, result: beforePrediction },
      { id: 'src/ml/index.mjs#predictMLModel', source: 'capability-lab', version: 'capability-lab-ml-1', input: { features: changedFeatures }, result: afterPrediction },
      ...(directPerturbation ? [{ id: algorithm === 'linearRegression' ? 'src/explain/regression.mjs#perturbLinearRegression' : 'src/explain/classification.mjs#perturbLogisticRegression', source: 'capability-lab', version: TRACE_VERSION, input: { changes: records }, result: { predictionDelta } }] : []),
    ],
    beforeAttributionTrace: originalExplanation.calculationTrace,
    afterAttributionTrace: changedExplanation.calculationTrace,
  };
  calculationTrace.bytes = encoder.encode(canonical(calculationTrace)).length;
  if (calculationTrace.bytes > MAX_TRACE_BYTES) throw new RangeError(`perturbation trace exceeds ${MAX_TRACE_BYTES} bytes`);
  const result = {
    schema: 'explain.perturbation.v1',
    algorithm,
    sourceIdentity: clone(experiment.sourceIdentity),
    stateIdentity: stateId,
    modelIdentity: modelId,
    originalFeatures: features,
    changedFeatures,
    changes: records,
    originalPrediction: beforePrediction,
    changedPrediction: afterPrediction,
    delta: effects,
    predictionDelta,
    originalAttribution: originalExplanation.attribution,
    changedAttribution: changedExplanation.attribution,
    modelUnchanged: unchanged,
    preprocessingRefit: false,
    calculationTrace,
    context,
  };
  registerContext(context, { experiment, features, changes: input.changes, ...(input.baseline === undefined ? {} : { baseline: input.baseline }) });
  return result;
}

/** Explain a question by retrieving evidence from a saved experiment or actual watch state. */
export function buildExplanationContext(input) {
  object(input, 'input');
  if (Object.hasOwn(input, 'experiment')) {
    onlyKeys(input, new Set(['experiment', 'features', 'baseline', 'changes']), 'model context selector');
    if (Object.hasOwn(input, 'changes')) return perturbPrediction(input).context;
    return explainPrediction(input).context;
  }
  onlyKeys(input, new Set(['state', 'componentId', 'questionId']), 'watch context selector');
  return explainWatch(input).context;
}

function staleFailure(message) {
  return { accepted: false, errors: [{ code: 'stale-context', message }], claims: [], renderedText: '' };
}

/** Regenerate current retrieved evidence before accepting a structured draft. */
export function checkExplanationClaims(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['context', 'draft', 'current']), 'claim checker input');
  const context = object(input.context, 'context');
  const recipe = input.current === undefined ? contextRecipes.get(context) : input.current;
  if (!recipe) return staleFailure('context was not produced by the high-level retrieval wrapper; supply current saved model/watch inputs');
  let currentContext;
  try {
    if (Object.hasOwn(recipe, 'experiment')) {
      onlyKeys(recipe, new Set(['experiment', 'features', 'baseline', 'changes']), 'current model selector');
      currentContext = Object.hasOwn(recipe, 'changes') ? perturbPrediction(recipe).context : explainPrediction(recipe).context;
    } else {
      onlyKeys(recipe, new Set(['state', 'componentId', 'questionId']), 'current watch selector');
      currentContext = explainWatch(recipe).context;
    }
  } catch (error) {
    return staleFailure(`current evidence could not be regenerated: ${error.message}`);
  }
  if (canonical(currentContext, 'current context') !== canonical(context, 'submitted context')) {
    return staleFailure('submitted context does not match the current saved model or watch state');
  }
  return checkTypedClaims({ context: currentContext, draft: input.draft });
}

/** Checked watch explanation backed by actual state, mechanism functions, and curated references. */
export function explainWatch(input) {
  const result = explainWatchState(input);
  if (result.context) registerContext(result.context, {
    state: input.state,
    ...(input.componentId === undefined ? {} : { componentId: input.componentId }),
    questionId: input.questionId,
  });
  return result;
}

export const explanationLimits = Object.freeze({
  ...EXPLANATION_LIMITS,
  maxTraceBytes: MAX_TRACE_BYTES,
});
