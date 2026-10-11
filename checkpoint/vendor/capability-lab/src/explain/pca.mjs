import { transformPCA } from '../ml/pca.mjs';
import { dot, vectorSubtract } from '../linalg/basics.mjs';
import { prepareExplanationFeatures } from './regression.mjs';

const MAX_IDENTIFIER_BYTES = 256;
const MAX_OUTPUT_BYTES = 1_048_576;

function failType(message) { throw new TypeError(message); }
function failRange(message) { throw new RangeError(message); }

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) failType(`${label} must be an object`);
  return value;
}

function onlyKeys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.has(key)) failType(`unknown ${label} field ${key}`);
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) failType(`${label} must be finite`);
  return value;
}

function utf8Bytes(value, stopAfter = Infinity) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}
function jsonIdentifierBytes(value) { return utf8Bytes(JSON.stringify(value)); }

function validateArtifactIdentifiers(experiment) {
  const names = experiment.dataset?.featureNames;
  if (!Array.isArray(names)) failType('experiment.dataset.featureNames must be an array');
  for (const [index, name] of names.entries()) {
    if (typeof name !== 'string') failType(`experiment.dataset.featureNames[${index}] must be a string`);
    if (utf8Bytes(name, MAX_IDENTIFIER_BYTES) > MAX_IDENTIFIER_BYTES) failRange(`experiment.dataset.featureNames[${index}] exceeds ${MAX_IDENTIFIER_BYTES} UTF-8 bytes`);
  }
  for (const [field, values] of [['selectedFeatures.names', experiment.selectedFeatures?.names], ['config.featureNames', experiment.config?.featureNames]]) {
    for (const [index, name] of (values ?? []).entries()) {
      if (typeof name !== 'string') failType(`experiment.${field}[${index}] must be a string`);
      if (utf8Bytes(name, MAX_IDENTIFIER_BYTES) > MAX_IDENTIFIER_BYTES) failRange(`experiment.${field}[${index}] exceeds ${MAX_IDENTIFIER_BYTES} UTF-8 bytes`);
    }
  }
  const kind = experiment.sourceIdentity?.kind;
  if (typeof kind !== 'string') failType('experiment.sourceIdentity.kind must be a string');
  if (utf8Bytes(kind, MAX_IDENTIFIER_BYTES) > MAX_IDENTIFIER_BYTES) failRange(`experiment.sourceIdentity.kind exceeds ${MAX_IDENTIFIER_BYTES} UTF-8 bytes`);
}

function estimateOutputBytes(featureCount, componentCount, names, kind) {
  const longestName = names.reduce((largest, name) => Math.max(largest, jsonIdentifierBytes(name)), 0);
  const estimate = 36_864 + jsonIdentifierBytes(kind) + componentCount * featureCount * (longestName + 512);
  if (estimate > MAX_OUTPUT_BYTES) failRange(`PCA explanation estimated output ${estimate} exceeds ${MAX_OUTPUT_BYTES} bytes`);
}

function exactDataKeys(value, expected, label) {
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) failType(`${label} must not have symbol keys`);
  keys.sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) failType(`${label} must contain exactly ${wanted.join(', ')}`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) failType(`${label}.${key} must be a plain data property`);
  }
}

function validateIdentityShape(experiment) {
  const identity = object(experiment.sourceIdentity, 'experiment.sourceIdentity');
  exactDataKeys(identity, ['kind', 'declaredByCaller', 'dataFingerprint'], 'experiment.sourceIdentity');
  if (typeof identity.declaredByCaller !== 'boolean') failType('experiment.sourceIdentity.declaredByCaller must be boolean');
  const fingerprint = object(identity.dataFingerprint, 'experiment.sourceIdentity.dataFingerprint');
  exactDataKeys(fingerprint, ['algorithm', 'hash', 'bytes'], 'experiment.sourceIdentity.dataFingerprint');
  if (fingerprint.algorithm !== 'fnv1a32' || typeof fingerprint.hash !== 'string' || !/^[0-9a-f]{8}$/.test(fingerprint.hash) ||
      !Number.isSafeInteger(fingerprint.bytes) || fingerprint.bytes < 0 || fingerprint.bytes > 8 * 1024 * 1024) {
    failRange('experiment.sourceIdentity.dataFingerprint is outside the supported format or byte bound');
  }
}

function checkOutputSize(value) {
  const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (size > MAX_OUTPUT_BYTES) failRange(`PCA explanation output ${size} exceeds ${MAX_OUTPUT_BYTES} bytes`);
  return value;
}

function identityCopy(value) {
  object(value, 'experiment.sourceIdentity');
  return {
    kind: value.kind,
    declaredByCaller: value.declaredByCaller,
    dataFingerprint: { ...value.dataFingerprint },
  };
}

function traceBytes(trace) {
  let bytes = 0;
  for (let index = 0; index < 4; index += 1) {
    trace.bytes = bytes;
    bytes = new TextEncoder().encode(JSON.stringify(trace)).byteLength;
  }
  trace.bytes = bytes;
  return bytes;
}

function prepare(input) {
  onlyKeys(input, new Set(['experiment', 'features']), 'PCA explanation input');
  const experiment = object(input.experiment, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') failType('experiment.schema must be ml-experiment.v1');
  if (experiment.config?.algorithm !== 'pca') failType('experiment.config.algorithm must be pca');
  validateArtifactIdentifiers(experiment);
  validateIdentityShape(experiment);
  const prepared = prepareExplanationFeatures({ experiment, features: input.features, baseline: 'trainingMean' });
  const { names, indices, selectedInput, modelInput, scales, sourceIdentity } = prepared;
  if (![names, indices, selectedInput, modelInput, scales].every(Array.isArray)) failType('prepared selected-feature values are malformed');
  const featureCount = experiment.model?.featureCount;
  if (!Number.isSafeInteger(featureCount) || names.length !== featureCount || modelInput.length !== featureCount) {
    failRange('selected feature dimensions do not match the fitted PCA model');
  }
  const preprocessingMeans = experiment.preprocessing?.means ?? Array(featureCount).fill(0);
  if (!Array.isArray(preprocessingMeans) || preprocessingMeans.length !== featureCount) failRange('retained preprocessing means do not match selected features');
  const modelMeans = experiment.model.means;
  if (!Array.isArray(modelMeans) || modelMeans.length !== featureCount) failRange('fitted PCA means do not match selected features');
  const componentCount = Array.isArray(experiment.model?.directions) ? experiment.model.directions.length : 0;
  if (componentCount < 1 || componentCount > 32) failRange('fitted PCA model must contain 1 to 32 retained components');
  estimateOutputBytes(featureCount, componentCount, names, experiment.sourceIdentity.kind);
  return { experiment, names, indices, selectedInput, modelInput, scales, preprocessingMeans, modelMeans, sourceIdentity };
}

/** Explain fitted PCA scores using the retained centering, directions, and preprocessing. */
export function explainPCA(input) {
  const { experiment, names, indices, selectedInput, modelInput, scales, preprocessingMeans, modelMeans, sourceIdentity } = prepare(input);
  const model = experiment.model;
  const dependencyCalls = [];
  const actual = transformPCA({ model, features: [modelInput] }, (id, args) => {
    let output;
    if (id === 'linalg.vectorSubtract') output = vectorSubtract(args.a, args.b);
    else if (id === 'linalg.dot') output = dot(args.a, args.b);
    else failRange(`unexpected PCA transform dependency ${id}`);
    dependencyCalls.push({
      sourceId: 'src/ml/pca.mjs#transformPCA', operationId: id,
      input: { dimensions: args.a.length },
      output: Array.isArray(output)
        ? { dimensions: output.length, min: Math.min(...output), max: Math.max(...output) }
        : { value: output },
    });
    return output;
  }).projected[0];
  if (!Array.isArray(actual) || actual.length !== model.directions.length) failRange('saved PCA model returned an inconsistent score vector');
  const trace = {
    schema: 'explanation-trace.v1', operationId: 'ml.transformPCA',
    calls: [{
      sourceId: 'src/ml/pca.mjs#transformPCA', operationId: 'ml.transformPCA',
      input: { modelKind: model.kind, rows: 1, dimensions: modelInput.length }, output: { projected: [actual.slice()] },
    }, ...dependencyCalls],
  };
  trace.bytes = traceBytes(trace);
  if (trace.bytes > 32_768) failRange('PCA explanation trace exceeds 32768 bytes');
  const components = model.directions.map((directionModel, componentIndex) => {
    const centeredModelValues = modelInput.map((value, position) => finite(value - modelMeans[position], `component ${componentIndex} centered feature ${position}`));
    const contributions = directionModel.map((loadingModel, position) => ({
      index: indices[position],
      name: names[position],
      centeredModelValue: centeredModelValues[position],
      loadingModel,
      contribution: finite(centeredModelValues[position] * loadingModel, `component ${componentIndex} contribution ${position}`),
    }));
    const score = contributions.reduce((sum, item) => finite(sum + item.contribution, `component ${componentIndex} reconstructed score`), 0);
    const expected = actual[componentIndex];
    const contributionMagnitude = contributions.reduce((sum, item) => Math.min(Number.MAX_VALUE, sum + Math.abs(item.contribution)), 0);
    const reconstructionTolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(expected), contributionMagnitude);
    const residual = score - expected;
    if (Math.abs(residual) > reconstructionTolerance) {
      failRange(`component ${componentIndex} contributions do not reconstruct the fitted PCA score`);
    }
    return {
      componentIndex,
      directionModel: directionModel.slice(),
      eigenvalue: model.eigenvalues[componentIndex],
      explainedVarianceRatio: model.explainedVarianceRatio[componentIndex],
      centeredModelValues,
      contributions,
      score: expected,
      reconstruction: {
        reconstructedScore: score,
        actualModelScore: expected,
        residual,
        tolerance: reconstructionTolerance,
        withinTolerance: true,
      },
      rawEffectiveCenter: modelMeans.map((center, position) => finite(preprocessingMeans[position] + center * scales[position], `component ${componentIndex} raw effective center ${position}`)),
      rawLoadings: directionModel.map((loading, position) => finite(loading / scales[position], `component ${componentIndex} raw loading ${position}`)),
    };
  });
  return checkOutputSize({
    kind: 'pcaExplanation',
    sourceIdentity: identityCopy(sourceIdentity ?? experiment.sourceIdentity),
    algorithm: 'pca',
    trace,
    selectedFeatures: names.map((name, position) => ({
      index: indices[position], name, rawValue: selectedInput[position], modelValue: modelInput[position],
      mean: preprocessingMeans[position], scale: scales[position],
    })),
    components,
    caveats: [
      'Each loading-weighted contribution reconstructs the saved component score; a contribution describes this projection, not a causal effect.',
      'Eigenvalues are fitted variance in model feature units; explained-variance ratios use the complete fitted covariance spectrum.',
      'A component direction can be multiplied by −1 without changing the PCA subspace; repeated eigenvalues can make individual axes non-unique.',
      'Only directions retained in the fitted model are shown; no additional component is inferred.',
    ],
  });
}
