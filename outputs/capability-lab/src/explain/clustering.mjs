import { predictKMeans } from '../ml/clustering.mjs';
import { distance } from '../linalg/basics.mjs';
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

function estimateOutputBytes(featureCount, centerCount, names, kind) {
  const longestName = names.reduce((largest, name) => Math.max(largest, jsonIdentifierBytes(name)), 0);
  const estimate = 36_864 + jsonIdentifierBytes(kind) + centerCount * featureCount * (longestName + 512);
  if (estimate > MAX_OUTPUT_BYTES) failRange(`k-means explanation estimated output ${estimate} exceeds ${MAX_OUTPUT_BYTES} bytes`);
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
  const identity = experiment.sourceIdentity;
  object(identity, 'experiment.sourceIdentity');
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
  if (size > MAX_OUTPUT_BYTES) failRange(`k-means explanation output ${size} exceeds ${MAX_OUTPUT_BYTES} bytes`);
  return value;
}

function sourceIdentity(value) {
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

function prepExperiment(input) {
  onlyKeys(input, new Set(['experiment', 'features']), 'k-means explanation input');
  const experiment = object(input.experiment, 'experiment');
  if (experiment.schema !== 'ml-experiment.v1') failType('experiment.schema must be ml-experiment.v1');
  if (experiment.config?.algorithm !== 'kMeans') failType('experiment.config.algorithm must be kMeans');
  validateArtifactIdentifiers(experiment);
  validateIdentityShape(experiment);
  const prepared = prepareExplanationFeatures({ experiment, features: input.features, baseline: 'trainingMean' });
  const { names, indices, selectedInput, modelInput, scales, sourceIdentity: identity } = prepared;
  if (!Array.isArray(names) || !Array.isArray(indices) || !Array.isArray(selectedInput) || !Array.isArray(modelInput) || !Array.isArray(scales)) {
    failType('prepared selected-feature values are malformed');
  }
  const featureCount = experiment.model?.featureCount;
  if (!Number.isSafeInteger(featureCount) || featureCount !== names.length || featureCount !== modelInput.length) {
    failRange('selected feature dimensions do not match the fitted k-means model');
  }
  const means = experiment.preprocessing?.means ?? Array(names.length).fill(0);
  if (!Array.isArray(means) || means.length !== names.length) failRange('retained preprocessing means do not match selected features');
  const centerCount = Array.isArray(experiment.model?.centroids) ? experiment.model.centroids.length : 0;
  if (centerCount < 1 || centerCount > 16) failRange('fitted k-means model must contain 1 to 16 centroids');
  estimateOutputBytes(featureCount, centerCount, names, experiment.sourceIdentity.kind);
  return { experiment, prepared, names, indices, selectedInput, modelInput, scales, means, identity };
}

/** Explain a fitted k-means prediction in the exact feature space used by its saved model. */
export function explainKMeans(input) {
  const { experiment, names, indices, selectedInput, modelInput, scales, means, identity } = prepExperiment(input);
  const calls = [];
  const prediction = predictKMeans({ model: experiment.model, features: [modelInput] }, (id, args) => {
    if (id !== 'linalg.distance') failRange(`unexpected k-means prediction dependency ${id}`);
    const value = distance(args.a, args.b);
    calls.push({ sourceId: 'src/ml/clustering.mjs#predictKMeans', operationId: id, input: { dimensions: args.a.length }, output: { value } });
    return value;
  });
  const chosen = prediction.assignments[0];
  const centers = experiment.model.centroids.map((centroidModel, clusterIndex) => {
    const selectedCoordinates = centroidModel.map((centerValue, position) => {
      const inputValue = modelInput[position];
      const difference = inputValue - centerValue;
      const squaredContribution = difference * difference;
      finite(difference, `centroid ${clusterIndex} coordinate ${position} difference`);
      finite(squaredContribution, `centroid ${clusterIndex} coordinate ${position} squared contribution`);
      return {
        index: indices[position], name: names[position], inputValue, centerValue,
        difference, squaredContribution,
      };
    });
    const squaredDistance = selectedCoordinates.reduce((sum, coordinate) => {
      const result = sum + coordinate.squaredContribution;
      finite(result, `centroid ${clusterIndex} squared distance`);
      return result;
    }, 0);
    const actualDistance = distance(modelInput, centroidModel);
    finite(actualDistance, `centroid ${clusterIndex} distance`);
    return {
      clusterIndex,
      centroidModel: centroidModel.slice(),
      centroidRaw: centroidModel.map((value, index) => finite(means[index] + value * scales[index], `centroid ${clusterIndex} raw coordinate ${index}`)),
      selectedCoordinates,
      squaredDistance,
      distance: actualDistance,
      selected: clusterIndex === chosen,
    };
  });
  // Match predictKMeans: distance is compared first and exact ties go to the lowest cluster ID.
  const ranked = centers.slice().sort((left, right) => left.distance - right.distance || left.clusterIndex - right.clusterIndex);
  const winner = centers[chosen];
  if (!winner) failRange('saved k-means predictor returned an unknown cluster index');
  const squaredTolerance = 64 * Number.EPSILON * Math.max(1, winner.squaredDistance, prediction.squaredDistances[0]);
  if (Math.abs(winner.squaredDistance - prediction.squaredDistances[0]) > squaredTolerance) {
    failRange('explained k-means distance does not match the saved model prediction');
  }
  const alternative = ranked.find(center => center.clusterIndex !== chosen) ?? null;
  const rawMargin = alternative ? alternative.squaredDistance - winner.squaredDistance : null;
  const marginTolerance = alternative
    ? 64 * Number.EPSILON * Math.max(1, alternative.squaredDistance, winner.squaredDistance)
    : null;
  if (rawMargin !== null && rawMargin < -marginTolerance) failRange('squared-distance ordering conflicts with the actual k-means predictor beyond roundoff');
  const margin = rawMargin === null || rawMargin <= 0 ? rawMargin === null ? null : 0 : rawMargin;
  const trace = {
    schema: 'explanation-trace.v1', operationId: 'ml.predictKMeans',
    calls: [{ sourceId: 'src/ml/clustering.mjs#predictKMeans', operationId: 'ml.predictKMeans', input: { rows: 1, dimensions: modelInput.length }, output: { assignments: prediction.assignments.slice(), distances: prediction.distances.slice(), squaredDistances: prediction.squaredDistances.slice() } }, ...calls],
  };
  trace.bytes = traceBytes(trace);
  if (trace.bytes > 32_768) failRange('k-means explanation trace exceeds 32768 bytes');
  const selectedFeatures = names.map((name, position) => ({
    index: indices[position], name, rawValue: selectedInput[position], modelValue: modelInput[position],
    mean: means[position], scale: scales[position],
  }));
  return checkOutputSize({
    kind: 'kmeansExplanation',
    sourceIdentity: identity ?? sourceIdentity(experiment.sourceIdentity),
    algorithm: 'kMeans',
    trace,
    selectedFeatures,
    distanceSpace: experiment.preprocessing ? 'standardized-model-feature-units' : 'raw-selected-feature-units',
    distanceUnitPolicy: experiment.preprocessing
      ? 'Euclidean distances combine retained standardized feature coordinates.'
      : 'Squared contributions use raw selected coordinates; if their physical units differ, their sum is a mixed-unit model distance.',
    prediction: {
      clusterIndex: chosen,
      centroidModel: winner.centroidModel.slice(),
      squaredDistance: prediction.squaredDistances[0],
      distance: prediction.distances[0],
      nearestAlternativeIndex: alternative?.clusterIndex ?? null,
      nearestAlternativeSquaredDistance: alternative?.squaredDistance ?? null,
      margin: margin === null ? null : finite(margin, 'squared-distance margin'),
      marginMeaning: 'alternative squared distance minus chosen squared distance',
      exactDistanceTie: alternative ? alternative.distance === winner.distance : false,
      roundoffTolerance: squaredTolerance,
      distanceReconstruction: {
        coordinateTermsSquared: winner.squaredDistance,
        predictorSquaredDistance: prediction.squaredDistances[0],
        residual: winner.squaredDistance - prediction.squaredDistances[0],
        tolerance: squaredTolerance,
        withinTolerance: true,
      },
      tieBreak: 'lowest-index',
    },
    centers,
    caveats: [
      'Coordinate contributions are squared differences in the saved model feature space; they sum to squared Euclidean distance, not Euclidean distance.',
      'When preprocessing is retained, centroidRaw is an inverse-scaled display coordinate; assignment and distances still use standardized model feature units.',
      'An exact distance tie follows lowest-index selection. A tiny negative squared-distance difference within the reported roundoff tolerance is shown as a zero margin.',
      'Cluster IDs describe fitted groups, not semantic classes. Contributions explain model arithmetic, not causes.',
    ],
  });
}
