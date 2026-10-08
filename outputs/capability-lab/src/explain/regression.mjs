import { transformStandardizer } from '../ml/data.mjs';
import { predictMLModel } from '../ml/index.mjs';

const MAX_SOURCE_FEATURES = 256;
const MAX_SELECTED_FEATURES = 100;
const MAX_DATASET_BYTES = 4 * 1024 * 1024;
const MAX_EXPERIMENT_BYTES = 8 * 1024 * 1024;
const MAX_IDENTITY_NODES = 3_000_000;
const MAX_IDENTITY_DEPTH = 64;
const ALGORITHMS = new Set(['linearRegression', 'logisticRegression', 'kMeans', 'pca']);
const ROUNDING_FACTOR = 64 * Number.EPSILON;

export const EXPLANATION_LIMITS = Object.freeze({
  maxSourceFeatures: MAX_SOURCE_FEATURES,
  maxSelectedFeatures: MAX_SELECTED_FEATURES,
  maxDatasetBytes: MAX_DATASET_BYTES,
  maxExperimentBytes: MAX_EXPERIMENT_BYTES,
  maxIdentityNodes: MAX_IDENTITY_NODES,
  maxIdentityDepth: MAX_IDENTITY_DEPTH,
});

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${label} cannot contain symbol properties`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${label}.${String(key)} must be an enumerable data property`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`unknown ${label} field ${key}`);
  }
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function safeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function vector(value, length, label, maximum = MAX_SOURCE_FEATURES) {
  if (!Array.isArray(value) || value.length !== length || value.length > maximum) {
    throw new RangeError(`${label} must contain exactly ${length} source features`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${label} cannot contain symbol properties`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length))) {
    throw new TypeError(`${label} contains a non-index array property`);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${label}[${index}] is missing`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set) throw new TypeError(`${label}[${index}] must be a data property`);
    result.push(finite(value[index], `${label}[${index}]`));
  }
  return result;
}

function boundedFingerprint(value, maxBytes, label) {
  const encoder = new TextEncoder();
  const ancestors = new Set();
  let nodeCount = 0;
  let byteCount = 0;
  let hash = 0x811c9dc5;
  const emit = text => {
    const bytes = encoder.encode(text);
    byteCount += bytes.byteLength;
    if (byteCount > maxBytes) throw new RangeError(`${label} exceeds the ${maxBytes}-byte identity limit`);
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  const visit = (item, path, depth) => {
    if (depth > MAX_IDENTITY_DEPTH) throw new RangeError(`retained dataset identity exceeds maximum depth ${MAX_IDENTITY_DEPTH}`);
    nodeCount += 1;
    if (nodeCount > MAX_IDENTITY_NODES) throw new RangeError(`retained dataset identity exceeds ${MAX_IDENTITY_NODES} values`);
    if (item === null) { emit('null'); return; }
    if (typeof item === 'string') {
      if (item.length > maxBytes) throw new RangeError(`${path} exceeds the ${label} identity byte limit`);
      emit(JSON.stringify(item));
      return;
    }
    if (typeof item === 'boolean') { emit(item ? 'true' : 'false'); return; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError(`${path} must contain only finite numbers`);
      emit(JSON.stringify(item));
      return;
    }
    if (typeof item !== 'object') throw new TypeError(`${path} must contain only JSON values`);
    if (ancestors.has(item)) throw new TypeError(`${path} contains a cycle in the retained dataset`);
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (item.length > MAX_IDENTITY_NODES) throw new RangeError(`${path} exceeds the retained dataset identity value limit`);
      const ownKeys = Reflect.ownKeys(item);
      if (ownKeys.some(key => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length))) {
        throw new TypeError(`${path} contains a non-index array property`);
      }
      emit('[');
      for (let index = 0; index < item.length; index += 1) {
        if (index > 0) emit(',');
        if (!Object.hasOwn(item, index)) throw new TypeError(`${path}[${index}] is a sparse array entry`);
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || descriptor.get || descriptor.set) throw new TypeError(`${path}[${index}] must be a data property`);
        visit(item[index], `${path}[${index}]`, depth + 1);
      }
      emit(']');
    } else {
      plainObject(item, path);
      if (Object.getOwnPropertySymbols(item).length > 0) throw new TypeError(`${path} cannot contain symbol properties`);
      const keys = Object.keys(item).sort();
      if (keys.length > MAX_IDENTITY_NODES) throw new RangeError(`${path} exceeds the retained dataset identity value limit`);
      emit('{');
      keys.forEach((key, index) => {
        if (index > 0) emit(',');
        if (key.length > maxBytes) throw new RangeError(`${path} contains a property name over the identity limit`);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}.${key} must be an enumerable data property`);
        emit(`${JSON.stringify(key)}:`);
        if (item[key] === undefined) throw new TypeError(`${path}.${key} cannot be undefined`);
        visit(item[key], `${path}.${key}`, depth + 1);
      });
      emit('}');
    }
    ancestors.delete(item);
  };
  visit(value, '$', 0);
  return {
    bytes: byteCount,
    algorithm: 'fnv1a32',
    hash: hash.toString(16).padStart(8, '0'),
  };
}

function fingerprint(value) {
  return boundedFingerprint(value, MAX_DATASET_BYTES, 'retained dataset');
}

function cloneIdentity(identity) {
  return {
    kind: identity.kind,
    declaredByCaller: identity.declaredByCaller,
    dataFingerprint: { ...identity.dataFingerprint },
  };
}

function validateIdentity(experiment, dataset) {
  const identity = plainObject(experiment.sourceIdentity, 'experiment.sourceIdentity');
  if (typeof identity.kind !== 'string' || identity.kind.length === 0 || identity.kind !== dataset.sourceKind) {
    throw new TypeError('source identity kind must match experiment.dataset.sourceKind');
  }
  if (typeof identity.declaredByCaller !== 'boolean') throw new TypeError('source identity declaredByCaller must be boolean');
  const expected = fingerprint(dataset);
  const supplied = plainObject(identity.dataFingerprint, 'experiment.sourceIdentity.dataFingerprint');
  if (supplied.algorithm !== expected.algorithm || supplied.hash !== expected.hash || supplied.bytes !== expected.bytes) {
    throw new RangeError('source identity fingerprint does not match the retained dataset');
  }
  return cloneIdentity(identity);
}

function validateExperiment(value) {
  const experiment = plainObject(value, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') throw new TypeError('experiment.schema must be ml-experiment.v1');
  boundedFingerprint(experiment, MAX_EXPERIMENT_BYTES, 'retained experiment');
  const config = plainObject(experiment.config, 'experiment.config');
  if (!ALGORITHMS.has(config.algorithm)) throw new TypeError('experiment.config.algorithm is unsupported');
  const dataset = plainObject(experiment.dataset, 'experiment.dataset');
  if (dataset.schema !== 'ml-dataset.v1' || typeof dataset.sourceKind !== 'string' || !Array.isArray(dataset.featureNames)) {
    throw new TypeError('experiment.dataset must retain the ml-dataset.v1 source schema');
  }
  const sourceFeatureNames = dataset.featureNames;
  if (sourceFeatureNames.length < 1 || sourceFeatureNames.length > MAX_SOURCE_FEATURES ||
      sourceFeatureNames.some(name => typeof name !== 'string' || name.length === 0) ||
      new Set(sourceFeatureNames).size !== sourceFeatureNames.length) {
    throw new RangeError(`experiment.dataset.featureNames must contain 1 to ${MAX_SOURCE_FEATURES} unique names`);
  }
  const selected = plainObject(experiment.selectedFeatures, 'experiment.selectedFeatures');
  if (!Array.isArray(selected.sourceFeatureNames) || !Array.isArray(selected.names) || !Array.isArray(selected.indices)) {
    throw new TypeError('experiment.selectedFeatures must retain sourceFeatureNames, names, and indices');
  }
  if (selected.sourceFeatureNames.length !== sourceFeatureNames.length || selected.sourceFeatureNames.some((name, index) => name !== sourceFeatureNames[index])) {
    throw new RangeError('selected feature source schema does not match the retained dataset');
  }
  if (selected.names.length < 1 || selected.names.length > MAX_SELECTED_FEATURES || selected.names.length !== selected.indices.length) {
    throw new RangeError(`selected features must contain 1 to ${MAX_SELECTED_FEATURES} names and matching indices`);
  }
  const seen = new Set();
  selected.indices.forEach((index, position) => {
    safeInteger(index, `selectedFeatures.indices[${position}]`, 0, sourceFeatureNames.length - 1);
    if (seen.has(index)) throw new RangeError('selected feature indices must be unique');
    seen.add(index);
    if (selected.names[position] !== sourceFeatureNames[index]) throw new RangeError('selected feature name/index mapping is inconsistent');
  });
  if (!Array.isArray(config.featureNames) || config.featureNames.length !== selected.names.length ||
      config.featureNames.some((name, index) => name !== selected.names[index])) {
    throw new RangeError('experiment config feature names do not match retained selected features');
  }
  const identity = validateIdentity(experiment, dataset);
  const preprocessing = experiment.preprocessing;
  if (preprocessing !== null) {
    plainObject(preprocessing, 'experiment.preprocessing');
    if (preprocessing.kind !== 'standardizer' || preprocessing.featureCount !== selected.names.length ||
        !Array.isArray(preprocessing.means) || !Array.isArray(preprocessing.scales) ||
        preprocessing.means.length !== selected.names.length || preprocessing.scales.length !== selected.names.length) {
      throw new RangeError('retained standardizer dimensions must match selected features');
    }
    preprocessing.means.forEach((mean, index) => finite(mean, `preprocessing.means[${index}]`));
    preprocessing.scales.forEach((scale, index) => {
      finite(scale, `preprocessing.scales[${index}]`);
      if (scale <= 0) throw new RangeError(`preprocessing.scales[${index}] must be positive`);
    });
  }
  if (typeof config.standardize !== 'boolean' || config.standardize !== (preprocessing !== null)) {
    throw new RangeError('retained preprocessing does not match the experiment standardize setting');
  }
  const model = plainObject(experiment.model, 'experiment.model');
  if (model.featureCount !== undefined && model.featureCount !== selected.names.length) {
    throw new RangeError('retained model feature count does not match selected feature dimensions');
  }
  return { experiment, config, dataset, sourceFeatureNames, selected, indices: [...selected.indices], names: [...selected.names], preprocessing, model, sourceIdentity: identity };
}

function compensatedMean(values, label) {
  if (!Array.isArray(values) || values.length < 1) throw new RangeError(`${label} needs at least one retained training row`);
  const maximum = values.reduce((largest, value, index) => Math.max(largest, Math.abs(finite(value, `${label}[${index}]`))), 0);
  if (maximum === 0) return 0;
  let sum = 0;
  let correction = 0;
  for (let index = 0; index < values.length; index += 1) {
    const normalized = values[index] / maximum;
    const adjusted = normalized - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  const result = (sum / values.length) * maximum;
  return finite(result, `${label} mean`);
}

function trainingMeans(artifact, indices) {
  if (artifact.preprocessing) return [...artifact.preprocessing.means];
  const train = artifact.experiment.split?.train;
  if (!Array.isArray(train) || train.length < 1) throw new RangeError('trainingMean reference requires retained experiment.split.train rows');
  const columns = indices.map((sourceIndex, selectedIndex) => {
    const values = train.map((record, rowIndex) => {
      plainObject(record, `experiment.split.train[${rowIndex}]`);
      return vector(record.features, artifact.sourceFeatureNames.length, `experiment.split.train[${rowIndex}].features`)[sourceIndex];
    });
    return compensatedMean(values, `training feature ${artifact.selected.names[selectedIndex]}`);
  });
  return columns;
}

function transformSelected(artifact, selectedFeatures) {
  if (!artifact.preprocessing) return [...selectedFeatures];
  const transformed = transformStandardizer({ model: artifact.preprocessing, features: [selectedFeatures] });
  if (!Array.isArray(transformed.features) || transformed.features.length !== 1) throw new RangeError('retained standardizer returned an invalid feature row');
  return vector(transformed.features[0], artifact.indices.length, 'transformed features', MAX_SELECTED_FEATURES);
}

/** Validate and map raw-schema values with the exact selection/scaler stored in an ML artifact. */
export function prepareExplanationFeatures(input) {
  plainObject(input, 'input');
  onlyKeys(input, new Set(['experiment', 'features', 'baseline']), 'feature preparation input');
  const artifact = validateExperiment(input.experiment);
  const rawInput = vector(input.features, artifact.sourceFeatureNames.length, 'features');
  let referenceKind = input.baseline ?? 'trainingMean';
  let rawReference;
  if (referenceKind === 'trainingMean') {
    rawReference = [...rawInput];
    const means = trainingMeans(artifact, artifact.indices);
    artifact.indices.forEach((sourceIndex, index) => { rawReference[sourceIndex] = means[index]; });
  } else if (referenceKind === 'zero') {
    rawReference = [...rawInput];
    artifact.indices.forEach(sourceIndex => { rawReference[sourceIndex] = 0; });
  } else if (Array.isArray(referenceKind)) {
    rawReference = vector(referenceKind, artifact.sourceFeatureNames.length, 'baseline');
    referenceKind = 'explicit';
  } else {
    throw new TypeError("baseline must be 'trainingMean', 'zero', or a full source-schema feature vector");
  }
  const selectedInput = artifact.indices.map(index => rawInput[index]);
  const selectedReference = artifact.indices.map(index => rawReference[index]);
  const modelInput = transformSelected(artifact, selectedInput);
  const modelReference = transformSelected(artifact, selectedReference);
  const scales = artifact.preprocessing ? [...artifact.preprocessing.scales] : artifact.indices.map(() => 1);
  return {
    rawInput,
    rawReference,
    selectedInput,
    selectedReference,
    modelInput,
    modelReference,
    names: artifact.names,
    indices: artifact.indices,
    scales,
    sourceIdentity: artifact.sourceIdentity,
    referenceKind,
  };
}

function validateLinearExperiment(experiment) {
  const artifact = validateExperiment(experiment);
  if (artifact.config.algorithm !== 'linearRegression' || artifact.model.kind !== 'linearRegression') {
    throw new TypeError('explainLinearRegression requires a linearRegression experiment and model');
  }
  if (!Array.isArray(artifact.model.coefficients) || artifact.model.coefficients.length !== artifact.indices.length ||
      typeof artifact.model.intercept !== 'number' || !Number.isFinite(artifact.model.intercept)) {
    throw new RangeError('linear model coefficients/intercept do not match selected feature dimensions');
  }
  artifact.model.coefficients.forEach((value, index) => finite(value, `model.coefficients[${index}]`));
  if (typeof artifact.model.fitIntercept !== 'boolean') throw new TypeError('linear model fitIntercept must be boolean');
  return artifact;
}

function sourcePrediction(experiment, features) {
  const result = predictMLModel({
    experiment,
    records: [{ runId: 'linear-explanation-input', conditionId: 'linear-explanation-input', features: [...features] }],
  });
  if (!Array.isArray(result.predictions) || result.predictions.length !== 1) throw new RangeError('actual linear predictor returned an invalid prediction result');
  return finite(result.predictions[0], 'actual model prediction');
}

function rawParameters(artifact) {
  const coefficients = artifact.model.coefficients.map((coefficient, index) => {
    const raw = coefficient / (artifact.preprocessing ? artifact.preprocessing.scales[index] : 1);
    return finite(raw, `original-unit coefficient[${index}]`);
  });
  let intercept = artifact.model.intercept;
  if (artifact.preprocessing) {
    const shifts = coefficients.map((coefficient, index) => coefficient * artifact.preprocessing.means[index]);
    shifts.forEach((value, index) => finite(value, `intercept shift[${index}]`));
    intercept -= compensatedSum(shifts);
  }
  return { coefficients, intercept: finite(intercept, 'original-unit intercept') };
}

function compensatedSum(values) {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  return finite(sum, 'reconstructed prediction sum');
}

function assertInputObject(input, allowed, label) {
  plainObject(input, label);
  onlyKeys(input, allowed, label);
  return input;
}

/** Attribute one saved linear-model prediction in its original feature units. */
export function explainLinearRegression(input) {
  assertInputObject(input, new Set(['experiment', 'features', 'baseline']), 'linear explanation input');
  const artifact = validateLinearExperiment(input.experiment);
  const prepared = prepareExplanationFeatures(input);
  const parameters = rawParameters(artifact);
  const referencePrediction = sourcePrediction(artifact.experiment, prepared.rawReference);
  const prediction = sourcePrediction(artifact.experiment, prepared.rawInput);
  const contributions = prepared.indices.map((sourceIndex, index) => {
    const contribution = parameters.coefficients[index] * (prepared.selectedInput[index] - prepared.selectedReference[index]);
    return {
      name: prepared.names[index],
      index: sourceIndex,
      inputValue: prepared.selectedInput[index],
      referenceValue: prepared.selectedReference[index],
      coefficient: parameters.coefficients[index],
      contribution: finite(contribution, `contribution[${index}]`),
    };
  });
  const reconstructedPrediction = compensatedSum([referencePrediction, ...contributions.map(item => item.contribution)]);
  const absoluteError = Math.abs(prediction - reconstructedPrediction);
  const largestTerm = Math.max(0, Math.abs(referencePrediction), ...contributions.map(item => Math.abs(item.contribution)));
  const scale = Math.max(1, Math.abs(prediction), Math.abs(reconstructedPrediction), largestTerm);
  const tolerance = ROUNDING_FACTOR * (contributions.length + 2) * scale;
  const withinTolerance = absoluteError <= tolerance;
  if (!withinTolerance) throw new RangeError(`linear contributions do not reconstruct the actual prediction within roundoff tolerance ${tolerance}`);
  return {
    schema: 'linear-prediction-explanation.v1',
    sourceIdentity: prepared.sourceIdentity,
    reference: {
      kind: prepared.referenceKind,
      featureValues: [...prepared.selectedReference],
      prediction: referencePrediction,
    },
    contributions,
    prediction,
    reconstructedPrediction,
    roundoff: { absoluteError, tolerance, withinTolerance },
  };
}

/** Apply named raw-unit deltas and compare actual predictions from the unchanged fitted artifact. */
export function perturbLinearRegression(input) {
  assertInputObject(input, new Set(['experiment', 'features', 'changes']), 'linear perturbation input');
  const artifact = validateLinearExperiment(input.experiment);
  const rawInput = vector(input.features, artifact.sourceFeatureNames.length, 'features');
  const changes = plainObject(input.changes, 'changes');
  const changeEntries = Object.entries(changes);
  if (changeEntries.length < 1) throw new RangeError('at least one feature change is required');
  const changedFeatures = [...rawInput];
  const selected = new Set(artifact.indices);
  const normalizedChanges = changeEntries.map(([name, rawDelta], changeIndex) => {
    const sourceIndex = artifact.sourceFeatureNames.indexOf(name);
    if (sourceIndex < 0) throw new RangeError(`unknown source feature ${name}`);
    const delta = finite(rawDelta, `changes.${name}`);
    const to = finite(rawInput[sourceIndex] + delta, `changed feature ${name}`);
    changedFeatures[sourceIndex] = to;
    return { name, index: sourceIndex, from: rawInput[sourceIndex], to, delta, selected: selected.has(sourceIndex), changeIndex };
  }).map(({ changeIndex, ...entry }) => entry);
  const originalPrediction = sourcePrediction(artifact.experiment, rawInput);
  const changedPrediction = sourcePrediction(artifact.experiment, changedFeatures);
  const predictionDelta = finite(changedPrediction - originalPrediction, 'predictionDelta');
  return {
    schema: 'linear-prediction-perturbation.v1',
    sourceIdentity: cloneIdentity(artifact.sourceIdentity),
    originalFeatures: rawInput,
    changedFeatures,
    changes: normalizedChanges,
    originalPrediction,
    changedPrediction,
    predictionDelta,
    modelUnchanged: true,
    preprocessingRefit: false,
  };
}
