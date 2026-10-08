import {
  classificationMetrics,
  fitMeanBaseline,
  fitStandardizer,
  predictMeanBaseline,
  regressionMetrics,
  selectFeatures,
  splitByGroup,
  transformStandardizer,
} from './data.mjs';
import { predictLinearRegression } from './regression.mjs';
import { buildWatchCalibrationDataset, predictAnalyticalWatchBaseline } from './watch-data.mjs';
import { fitLogisticRegressionWithTrace, predictLogisticRegression } from './classification.mjs';
import { fitKMeansWithTrace, predictKMeans } from './clustering.mjs';
import { fitPCAWithTrace, transformPCA } from './pca.mjs';
import { createRegistry } from '../runtime/index.mjs';
import { capabilities as statisticsCapabilities } from '../statistics/index.mjs';
import { capabilities as linalgCapabilities } from '../linalg/index.mjs';
import { capabilities as composedCapabilities } from '../composed/index.mjs';
import { capabilities as regressionCapabilities } from './regression.mjs';

const linearRegistry = createRegistry([
  ...statisticsCapabilities,
  ...linalgCapabilities,
  ...composedCapabilities,
  ...regressionCapabilities,
], { source: 'capability-lab-ml', version: '1' });

const MAX_ROWS = 10_000;
const MAX_FEATURES = 100;
const MAX_FEATURE_VALUES = 60_000;
const MAX_DATASET_BYTES = 4 * 1024 * 1024;
const MAX_EXPERIMENT_BYTES = 8 * 1024 * 1024;
const MAX_TRACE_CALLS = 64;
const MAX_TRACE_BYTES = 16 * 1024;
const utf8 = new TextEncoder();

const ALGORITHMS = new Set(['linearRegression', 'logisticRegression', 'kMeans', 'pca']);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain JSON object`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${label} must not contain symbol properties`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label}.${key} must be an enumerable plain data value`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown ${label} field ${key}`);
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function canonicalJson(value, path = '$', ancestors = new Set(), depth = 0) {
  if (depth > 64) throw new RangeError(`${path} exceeds maximum ML JSON depth 64`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a nonfinite number`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError(`${path} is not a JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${path} must be a plain JSON array`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length))) {
      throw new TypeError(`${path} contains a non-index array property`);
    }
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is a sparse array entry`);
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}[${index}] must be a plain data value`);
      entries.push(canonicalJson(value[index], `${path}[${index}]`, ancestors, depth + 1));
    }
    ancestors.delete(value);
    return `[${entries.join(',')}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${path} must contain only plain JSON objects`);
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}.${key} must be an enumerable plain data value`);
  }
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    if (value[key] === undefined) throw new TypeError(`${path}.${key} is undefined, not JSON`);
  }
  const result = `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], `${path}.${key}`, ancestors, depth + 1)}`).join(',')}}`;
  ancestors.delete(value);
  return result;
}

function cloneJson(value, label = 'value') {
  return JSON.parse(canonicalJson(value, label));
}

function fingerprint(value) {
  const canonical = canonicalJson(value);
  const bytes = utf8.encode(canonical);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { bytes: bytes.byteLength, algorithm: 'fnv1a32', hash: hash.toString(16).padStart(8, '0') };
}

function summarize(value) {
  const compact = item => Array.isArray(item)
    ? item.length > 0 && Array.isArray(item[0])
      ? { count: item.length, preview: item.slice(0, 3).map(row => row.slice(0, 6)) }
      : { count: item.length, preview: item.slice(0, 6) }
    : item;
  if (Array.isArray(value)) return compact(value);
  if (value === null || typeof value !== 'object') return { value };
  const summary = { kind: value.kind ?? value.schema ?? 'object', keys: Object.keys(value).sort() };
  for (const key of ['count', 'sampleCount', 'featureCount', 'iterations', 'converged', 'rank', 'inertia', 'residualNorm']) {
    if (Object.hasOwn(value, key) && (typeof value[key] !== 'object' || value[key] === null)) summary[key] = value[key];
  }
  for (const key of ['coefficients', 'means', 'scales', 'centroids', 'eigenvalues', 'directions', 'intercept']) {
    if (Object.hasOwn(value, key)) {
      const item = value[key];
      summary[key] = compact(item);
    }
  }
  return summary;
}

function createTrace() {
  const calls = [];
  const record = (id, input, output, summary = summarize(output)) => {
    if (calls.length >= MAX_TRACE_CALLS) throw new RangeError(`ML trace call limit ${MAX_TRACE_CALLS} exceeded`);
    const entry = {
      sequence: calls.length,
      id,
      input: fingerprint(input),
      output: fingerprint(output),
      summary,
    };
    calls.push(entry);
    const bytes = utf8.encode(canonicalJson(calls)).byteLength;
    if (bytes > MAX_TRACE_BYTES) {
      calls.pop();
      throw new RangeError(`ML trace byte limit ${MAX_TRACE_BYTES} exceeded while recording ${id}`);
    }
    return output;
  };
  return {
    record,
    result() {
      return { schema: 'ml-call-ledger.v1', limits: { maxCalls: MAX_TRACE_CALLS, maxBytes: MAX_TRACE_BYTES }, calls, bytes: utf8.encode(canonicalJson(calls)).byteLength };
    },
  };
}

function parseDataset(rawDataset) {
  const dataset = cloneJson(object(rawDataset, 'dataset'), 'dataset');
  if (dataset.schema !== undefined && dataset.schema !== 'ml-dataset.v1') throw new TypeError('dataset.schema must be ml-dataset.v1 when supplied');
  dataset.schema = 'ml-dataset.v1';
  if (typeof dataset.sourceKind !== 'string' || dataset.sourceKind.trim() === '') throw new TypeError('dataset.sourceKind must be a non-empty string');
  if (!Array.isArray(dataset.featureNames) || dataset.featureNames.length < 1 || dataset.featureNames.length > MAX_FEATURES) {
    throw new RangeError(`dataset.featureNames must contain 1 to ${MAX_FEATURES} names`);
  }
  if (dataset.featureNames.some(name => typeof name !== 'string' || name.length === 0) || new Set(dataset.featureNames).size !== dataset.featureNames.length) {
    throw new TypeError('dataset.featureNames must contain unique non-empty strings');
  }
  if (!Array.isArray(dataset.records) || dataset.records.length < 2 || dataset.records.length > MAX_ROWS) {
    throw new RangeError(`dataset.records must contain 2 to ${MAX_ROWS} records`);
  }
  if (dataset.records.length * dataset.featureNames.length > MAX_FEATURE_VALUES) {
    throw new RangeError(`dataset exceeds ${MAX_FEATURE_VALUES} feature values`);
  }
  const bytes = fingerprint(dataset).bytes;
  if (bytes > MAX_DATASET_BYTES) throw new RangeError(`dataset byte limit ${MAX_DATASET_BYTES} exceeded`);
  dataset.records.forEach((record, index) => {
    object(record, `dataset.records[${index}]`);
    if (!Array.isArray(record.features) || record.features.length !== dataset.featureNames.length) {
      throw new RangeError(`dataset.records[${index}].features must match featureNames`);
    }
    record.features.forEach((value, column) => finite(value, `dataset.records[${index}].features[${column}]`));
    if (Object.hasOwn(record, 'target')) finite(record.target, `dataset.records[${index}].target`);
  });
  return dataset;
}

function selectFeatureColumns(records, featureIndices) {
  return records.map((record, row) => {
    const values = featureIndices.map(index => record.features[index]);
    values.forEach((value, column) => finite(value, `selected features[${row}][${column}]`));
    return values;
  });
}

function modelInputConfig(modelConfig, seed, algorithm) {
  const normalized = cloneJson(object(modelConfig, 'modelConfig'), 'modelConfig');
  if (algorithm === 'kMeans' && normalized.seed === undefined) normalized.seed = seed;
  return normalized;
}

function compactCapabilityTrace(node) {
  return {
    id: node.id,
    order: node.order,
    identity: node.identity,
    seed: node.seed,
    inputHash: node.inputHash,
    resultHash: node.resultHash,
    randomDraws: node.randomDraws,
    calls: node.calls.map(compactCapabilityTrace),
  };
}

function labelsFor(records, label) {
  const targets = records.map((record, index) => {
    if (!Object.hasOwn(record, 'target')) throw new TypeError(`${label} record ${index} is missing target`);
    return finite(record.target, `${label} record ${index} target`);
  });
  return targets;
}

function fitMajorityBaseline(targets) {
  if (targets.length < 1) throw new RangeError('majority baseline requires training labels');
  const counts = new Map();
  for (const target of targets) counts.set(target, (counts.get(target) ?? 0) + 1);
  const label = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return { kind: 'majorityBaseline', label, sampleCount: targets.length };
}

function predictMajority({ model, count }) {
  object(model, 'model');
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_ROWS) throw new RangeError(`count must be an integer from 1 to ${MAX_ROWS}`);
  if (model.kind !== 'majorityBaseline' || !Number.isSafeInteger(model.label)) throw new TypeError('model must be a majority baseline');
  return { labels: Array(count).fill(model.label) };
}

function makeEvaluation({ algorithm, model, preprocessing, baseline, featureSelection, records, trace, includeBaselineResults = true, includeMetrics = true }) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_ROWS) throw new RangeError(`records must contain 1 to ${MAX_ROWS} entries`);
  const checked = cloneJson(records, 'records');
  checked.forEach((record, index) => {
    object(record, `records[${index}]`);
    if (typeof record.runId !== 'string' || record.runId.length === 0) throw new TypeError(`records[${index}].runId must be a non-empty string`);
    if (typeof record.conditionId !== 'string' || record.conditionId.length === 0) throw new TypeError(`records[${index}].conditionId must be a non-empty string`);
    if (!Array.isArray(record.features) || record.features.length !== featureSelection.sourceFeatureNames.length) {
      throw new RangeError(`records[${index}].features must match the source feature schema`);
    }
    record.features.forEach((value, column) => finite(value, `records[${index}].features[${column}]`));
  });
  const rawSelected = selectFeatureColumns(checked, featureSelection.indices);
  const selected = trace.record('ml.selectFeatureColumns', { rows: checked.length, indices: featureSelection.indices }, rawSelected);
  let features = selected;
  if (preprocessing) {
    const transformed = transformStandardizer({ model: preprocessing, features: selected });
    trace.record('ml.transformStandardizer', { model: preprocessing, features: selected }, transformed);
    features = transformed.features;
  }
  const predict = predictionFunction(algorithm);
  const prediction = trace.record(predictionId(algorithm), { model, features }, predict({ model, features }));
  let metrics = null;
  const baselines = {};
  if (algorithm === 'linearRegression' && includeMetrics) {
    const actual = labelsFor(checked, 'evaluation');
    metrics = trace.record('ml.regressionMetrics', { actual, predicted: prediction.predictions }, regressionMetrics({ actual, predicted: prediction.predictions }));
    if (includeBaselineResults && baseline.meanModel) {
      const baselinePrediction = trace.record('ml.predictMeanBaseline', { model: baseline.meanModel, count: checked.length }, predictMeanBaseline({ model: baseline.meanModel, count: checked.length }));
      baselines.mean = {
        model: baseline.meanModel,
        prediction: baselinePrediction,
        metrics: trace.record('ml.regressionMetrics', { actual, predicted: baselinePrediction.predictions }, regressionMetrics({ actual, predicted: baselinePrediction.predictions })),
      };
    }
    if (includeBaselineResults && baseline.analyticalModel) {
      const namedIndex = featureSelection.names.indexOf('earlyObservedMechanicalHz');
      if (namedIndex < 0) throw new RangeError('synthetic-watch analytical baseline requires the earlyObservedMechanicalHz feature');
      const rateFeatures = rawSelected.map(row => [row[namedIndex]]);
      const analyticalPrediction = trace.record('ml.predictAnalyticalWatchBaseline', {
        model: baseline.analyticalModel,
        features: rateFeatures,
      }, predictAnalyticalWatchBaseline({
        features: rateFeatures,
        nominalMechanicalHz: baseline.analyticalModel.nominalMechanicalHz,
        horizonSeconds: baseline.analyticalModel.horizonSeconds,
      }));
      baselines.analytical = {
        model: baseline.analyticalModel,
        prediction: analyticalPrediction,
        metrics: trace.record('ml.regressionMetrics', { actual, predicted: analyticalPrediction.predictions }, regressionMetrics({ actual, predicted: analyticalPrediction.predictions })),
      };
    }
  } else if (algorithm === 'logisticRegression' && includeMetrics) {
    const actual = labelsFor(checked, 'evaluation');
    if (actual.some(target => target !== 0 && target !== 1)) throw new RangeError('logisticRegression evaluation targets must be binary 0 or 1');
    metrics = trace.record('ml.classificationMetrics', { actual, predicted: prediction.labels }, classificationMetrics({ actual, predicted: prediction.labels }));
    if (includeBaselineResults && baseline.majorityModel) {
      const baselinePrediction = trace.record('ml.predictMajorityBaseline', { model: baseline.majorityModel, count: checked.length }, predictMajority({ model: baseline.majorityModel, count: checked.length }));
      baselines.majority = {
        model: baseline.majorityModel,
        prediction: baselinePrediction,
        metrics: trace.record('ml.classificationMetrics', { actual, predicted: baselinePrediction.labels }, classificationMetrics({ actual, predicted: baselinePrediction.labels })),
      };
    }
  }
  return { records: checked, prediction, metrics, baselines, trace: trace.result() };
}

function predictionFunction(algorithm) {
  if (algorithm === 'linearRegression') return predictLinearRegression;
  if (algorithm === 'logisticRegression') return predictLogisticRegression;
  if (algorithm === 'kMeans') return predictKMeans;
  return transformPCA;
}

function predictionId(algorithm) {
  if (algorithm === 'linearRegression') return 'ml.predictLinearRegression';
  if (algorithm === 'logisticRegression') return 'ml.predictLogisticRegression';
  if (algorithm === 'kMeans') return 'ml.predictKMeans';
  return 'ml.transformPCA';
}

function trainAlgorithm({ algorithm, modelConfig, trainFeatures, trainTargets, trace }) {
  if (algorithm === 'linearRegression') {
    const input = { features: trainFeatures, targets: trainTargets, ...modelConfig };
    const execution = linearRegistry.execute('ml.fitLinearRegression', input);
    trace.record('ml.fitLinearRegression', input, execution.result);
    return { model: execution.result.model, diagnostics: execution.result.diagnostics, calculationTrace: compactCapabilityTrace(execution.trace) };
  }
  if (algorithm === 'logisticRegression') {
    const input = { features: trainFeatures, targets: trainTargets, ...modelConfig };
    const fitted = fitLogisticRegressionWithTrace(input);
    trace.record('ml.fitLogisticRegressionWithTrace', input, fitted.model);
    return { model: fitted.model, diagnostics: null, calculationTrace: fitted.trace };
  }
  if (algorithm === 'kMeans') {
    const input = { features: trainFeatures, ...modelConfig };
    const fitted = fitKMeansWithTrace(input);
    trace.record('ml.fitKMeansWithTrace', input, fitted.model);
    return { model: fitted.model, diagnostics: null, calculationTrace: fitted.trace };
  }
  const input = { features: trainFeatures, ...modelConfig };
  const fitted = fitPCAWithTrace(input);
  trace.record('ml.fitPCAWithTrace', input, fitted.model);
  if (fitted.model.converged === false) throw new RangeError('PCA refused an unconverged eigensystem');
  return { model: fitted.model, diagnostics: null, calculationTrace: fitted.trace };
}

/** Fit one bounded, grouped experiment and retain raw data, fitted state and a compact call ledger. */
export function runMLExperiment(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['dataset', 'algorithm', 'featureNames', 'targetName', 'groupBy', 'testFraction', 'seed', 'standardize', 'modelConfig']), 'experiment input');
  if (!ALGORITHMS.has(input.algorithm)) throw new RangeError(`algorithm must be one of ${[...ALGORITHMS].join(', ')}`);
  const algorithm = input.algorithm;
  const dataset = parseDataset(input.dataset);
  const targetName = input.targetName ?? dataset.targetName;
  if (input.targetName !== undefined && input.targetName !== dataset.targetName) {
    throw new RangeError('targetName must match dataset.targetName');
  }
  if ((algorithm === 'linearRegression' || algorithm === 'logisticRegression') && (!targetName || dataset.records.some(record => !Object.hasOwn(record, 'target')))) {
    throw new TypeError(`${algorithm} requires dataset.targetName and a finite target on every record`);
  }
  const seed = input.seed ?? 0;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new RangeError('seed must be an unsigned 32-bit integer');
  const standardize = input.standardize ?? true;
  if (typeof standardize !== 'boolean') throw new TypeError('standardize must be boolean');
  const requestedFeatureNames = input.featureNames ?? dataset.featureNames;
  const trace = createTrace();
  const selectedFeatures = trace.record('ml.selectFeatures', { dataset, featureNames: requestedFeatureNames }, selectFeatures({ dataset, featureNames: requestedFeatureNames }));
  const splitResult = trace.record('ml.splitByGroup', {
    records: dataset.records,
    groupBy: input.groupBy ?? 'conditionId',
    testFraction: input.testFraction ?? 0.2,
    seed,
  }, splitByGroup({
    records: dataset.records,
    groupBy: input.groupBy ?? 'conditionId',
    testFraction: input.testFraction ?? 0.2,
    seed,
  }));
  const modelConfig = modelInputConfig(input.modelConfig ?? {}, seed, algorithm);
  const rawTrain = trace.record('ml.selectFeatureColumns', { rows: splitResult.train.length, indices: selectedFeatures.featureIndices }, selectFeatureColumns(splitResult.train, selectedFeatures.featureIndices));
  const preprocessing = standardize ? trace.record('ml.fitStandardizer', { features: rawTrain }, fitStandardizer({ features: rawTrain })) : null;
  let trainFeatures = rawTrain;
  if (preprocessing) {
    const transformedTrain = transformStandardizer({ model: preprocessing, features: rawTrain });
    trace.record('ml.transformStandardizer', { model: preprocessing, features: rawTrain }, transformedTrain);
    trainFeatures = transformedTrain.features;
  }
  const needsTargets = algorithm === 'linearRegression' || algorithm === 'logisticRegression';
  const trainTargets = needsTargets ? labelsFor(splitResult.train, 'training') : undefined;
  if (algorithm === 'logisticRegression' && trainTargets.some(target => target !== 0 && target !== 1)) {
    throw new RangeError('logisticRegression targets must be binary 0 or 1');
  }
  const fit = trainAlgorithm({ algorithm, modelConfig, trainFeatures, trainTargets, trace });
  const model = fit.model;
  const baseline = {};
  if (algorithm === 'linearRegression') {
    baseline.meanModel = trace.record('ml.fitMeanBaseline', { targets: trainTargets }, fitMeanBaseline({ targets: trainTargets }));
    if (dataset.sourceKind === 'synthetic-watch') {
      const provenance = object(dataset.provenance, 'dataset.provenance');
      const nominalRate = provenance.nominalMechanicalHz;
      const horizonSeconds = finite(provenance.horizonSeconds, 'dataset.provenance.horizonSeconds');
      baseline.analyticalModel = {
        kind: 'analyticalWatchRateBaseline',
        nominalMechanicalHz: cloneJson(nominalRate, 'nominalMechanicalHz'),
        horizonSeconds,
        formula: '(earlyObservedMechanicalHz / nominalMechanicalHz - 1) * horizonSeconds',
        sourceKind: 'synthetic-watch',
      };
    }
  } else if (algorithm === 'logisticRegression') {
    baseline.majorityModel = trace.record('ml.fitMajorityBaseline', { targets: trainTargets }, fitMajorityBaseline(trainTargets));
  }
  const prediction = predictionFunction(algorithm);
  const trainingPrediction = trace.record(predictionId(algorithm), { model, features: trainFeatures }, prediction({ model, features: trainFeatures }));
  const trainingMetrics = needsTargets
    ? algorithm === 'linearRegression'
      ? trace.record('ml.regressionMetrics', { actual: trainTargets, predicted: trainingPrediction.predictions }, regressionMetrics({ actual: trainTargets, predicted: trainingPrediction.predictions }))
      : trace.record('ml.classificationMetrics', { actual: trainTargets, predicted: trainingPrediction.labels }, classificationMetrics({ actual: trainTargets, predicted: trainingPrediction.labels }))
    : null;
  const featureSelection = {
    sourceFeatureNames: dataset.featureNames,
    names: selectedFeatures.featureNames,
    indices: selectedFeatures.featureIndices,
  };
  const config = {
    algorithm,
    featureNames: selectedFeatures.featureNames,
    groupBy: splitResult.groupBy,
    testFraction: splitResult.testFraction,
    seed,
    standardize,
    modelConfig,
  };
  if (targetName !== undefined) config.targetName = targetName;
  const experiment = {
    schema: 'ml-experiment.v1',
    sourceIdentity: {
      kind: dataset.sourceKind,
      declaredByCaller: true,
      dataFingerprint: fingerprint(dataset),
    },
    dataset,
    config,
    selectedFeatures: featureSelection,
    split: splitResult,
    preprocessing,
    model,
    diagnostics: fit.diagnostics,
    baseline,
    training: { prediction: trainingPrediction, metrics: trainingMetrics, calculationTrace: fit.calculationTrace },
    holdout: null,
    trace: null,
  };
  experiment.holdout = makeEvaluation({
    algorithm,
    model,
    preprocessing,
    baseline,
    featureSelection,
    records: splitResult.test,
    trace,
  });
  experiment.trace = trace.result();
  const experimentBytes = fingerprint(experiment).bytes;
  if (experimentBytes > MAX_EXPERIMENT_BYTES) throw new RangeError(`ML experiment byte limit ${MAX_EXPERIMENT_BYTES} exceeded`);
  return experiment;
}

/** Apply only the stored feature selection, preprocessing, and model to new raw-schema records. */
export function predictMLModel(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['experiment', 'records']), 'prediction input');
  const experiment = object(input.experiment, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') throw new TypeError('experiment.schema must be ml-experiment.v1');
  if (!ALGORITHMS.has(experiment.config?.algorithm)) throw new TypeError('experiment.config.algorithm is unsupported');
  const trace = createTrace();
  const result = makeEvaluation({
    algorithm: experiment.config.algorithm,
    model: experiment.model,
    preprocessing: experiment.preprocessing,
    baseline: experiment.baseline,
    featureSelection: experiment.selectedFeatures,
    records: input.records,
    trace,
    includeBaselineResults: false,
    includeMetrics: false,
  });
  return result.prediction;
}

/** Evaluate supplied raw-schema records without refitting model, preprocessing, or baselines. */
export function evaluateMLExperiment(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['experiment', 'records']), 'evaluation input');
  const experiment = object(input.experiment, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') throw new TypeError('experiment.schema must be ml-experiment.v1');
  if (!ALGORITHMS.has(experiment.config?.algorithm)) throw new TypeError('experiment.config.algorithm is unsupported');
  return makeEvaluation({
    algorithm: experiment.config.algorithm,
    model: experiment.model,
    preprocessing: experiment.preprocessing,
    baseline: experiment.baseline,
    featureSelection: experiment.selectedFeatures,
    records: input.records,
    trace: createTrace(),
  });
}

/** Refit from retained inputs and compare the complete canonical experiment, including heldout results and trace. */
export function replayMLExperiment(input) {
  object(input, 'input');
  onlyKeys(input, new Set(['experiment']), 'replay input');
  const experiment = object(input.experiment, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') throw new TypeError('experiment.schema must be ml-experiment.v1');
  const fresh = runMLExperiment({ ...cloneJson(experiment.config, 'experiment.config'), dataset: cloneJson(experiment.dataset, 'experiment.dataset') });
  const canonicalState = canonicalJson(experiment);
  const canonicalFresh = canonicalJson(fresh);
  const matches = canonicalState === canonicalFresh;
  return {
    fresh,
    canonicalState,
    canonicalFresh,
    matches,
    mismatches: matches ? [] : mismatchPaths(experiment, fresh),
  };
}

function mismatchPaths(expected, actual) {
  const mismatches = [];
  const visit = (left, right, path) => {
    if (mismatches.length >= 32) return;
    if (left === right) return;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) {
      mismatches.push(path);
      return;
    }
    const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
    if (canonicalJson(leftKeys) !== canonicalJson(rightKeys)) {
      mismatches.push(path);
      return;
    }
    for (const key of leftKeys) visit(left[key], right[key], path ? `${path}.${key}` : key);
  };
  visit(expected, actual, '');
  return mismatches;
}

export { buildWatchCalibrationDataset };

export const limits = Object.freeze({
  maxRows: MAX_ROWS,
  maxFeatures: MAX_FEATURES,
  maxFeatureValues: MAX_FEATURE_VALUES,
  maxDatasetBytes: MAX_DATASET_BYTES,
  maxExperimentBytes: MAX_EXPERIMENT_BYTES,
  maxTraceCalls: MAX_TRACE_CALLS,
  maxTraceBytes: MAX_TRACE_BYTES,
});
