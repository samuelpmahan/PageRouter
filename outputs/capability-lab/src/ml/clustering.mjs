import { distance } from '../linalg/basics.mjs';
import { mean } from '../statistics/core.mjs';

const MAX_SAMPLES = 500;
const MAX_FEATURES = 32;
const MAX_VALUES = 8_192;
const MAX_CLUSTERS = 16;
const MAX_ITERATIONS = 100;
const MAX_EXPANDED_CALLS = 20_000;
const MAX_TRACE_BYTES = 32_768;
const DEFAULT_TOLERANCE = 1e-6;
const INITIALIZATION = 'k-means++';
const TIE_BREAK = 'lowest-index';
const EMPTY_CLUSTER = 'retain-previous-centroid';

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

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    failType(`${label} must contain exactly ${wanted.join(', ')}`);
  }
}

function array(value, label, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) failType(`${label} must be a plain array`);
  if (value.length < min || value.length > max) failRange(`${label} must contain ${min} through ${max} entries`);
  if (Object.getOwnPropertySymbols(value).length > 0) failType(`${label} must not have symbol properties`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) failType(`${label} has a non-index property`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) failType(`${label}[${index}] is missing`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) failType(`${label}[${index}] must be a plain data value`);
  }
  return value;
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) failType(`${label} must be finite`);
  return value;
}

function featureMatrix(value, label, minimumRows = 1) {
  array(value, label, minimumRows, MAX_SAMPLES);
  const first = array(value[0], `${label}[0]`, 1, MAX_FEATURES);
  const columns = first.length;
  if (value.length * columns > MAX_VALUES) failRange(`${label} exceeds the ${MAX_VALUES} feature-value bound`);
  const rows = [];
  for (let row = 0; row < value.length; row += 1) {
    const source = array(value[row], `${label}[${row}]`, 1, MAX_FEATURES);
    if (source.length !== columns) failRange(`${label} must be rectangular; row ${row} has ${source.length} columns, expected ${columns}`);
    const copy = [];
    for (let column = 0; column < columns; column += 1) copy.push(finite(source[column], `${label}[${row}][${column}]`));
    rows.push(copy);
  }
  return { rows, rowCount: rows.length, columnCount: columns };
}

function scalarSquared(distanceValue, label) {
  const squared = distanceValue * distanceValue;
  if (!Number.isFinite(squared)) failRange(`${label} squared distance exceeds the finite number range`);
  return squared;
}

function squaredEuclidean(a, b, label) {
  let squared = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index] - b[index];
    if (!Number.isFinite(delta)) failRange(`${label} coordinate difference is outside the finite number range`);
    const term = delta * delta;
    if (!Number.isFinite(term) || !Number.isFinite(squared + term)) failRange(`${label} squared distance exceeds the finite number range`);
    squared += term;
  }
  return squared;
}

function localCall(id, input) {
  switch (id) {
    case 'linalg.distance': return distance(input.a, input.b);
    case 'statistics.mean': return mean(input);
    default: failRange(`no standalone k-means dependency is available for ${id}`);
  }
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function validateFitInput(input) {
  onlyKeys(input, new Set(['features', 'k', 'seed', 'maxIterations', 'tolerance']), 'k-means fit input');
  const { rows, rowCount, columnCount } = featureMatrix(input.features, 'features', 2);
  if (!Number.isSafeInteger(input.k) || input.k < 1 || input.k > Math.min(MAX_CLUSTERS, rowCount)) {
    failRange(`k must be an integer from 1 to min(${MAX_CLUSTERS}, sampleCount)`);
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff) {
    failRange('seed must be an unsigned 32-bit integer');
  }
  const maxIterations = input.maxIterations ?? MAX_ITERATIONS;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
    failRange(`maxIterations must be an integer from 1 to ${MAX_ITERATIONS}`);
  }
  const tol = input.tolerance ?? DEFAULT_TOLERANCE;
  finite(tol, 'tolerance');
  if (tol < 0) failRange('tolerance must be nonnegative');

  // A distance call expands to distance -> vectorSubtract + norm in the runtime.
  // Bound the configured worst case before starting so an adversarial fit cannot exhaust tracing.
  const distanceCalls = rowCount * (input.k - 1)
    + rowCount * input.k * maxIterations
    + rowCount * input.k
    + input.k * maxIterations;
  const meanCalls = input.k * columnCount * maxIterations;
  const expandedCalls = distanceCalls * 3 + meanCalls;
  if (expandedCalls > MAX_EXPANDED_CALLS) {
    failRange(`k-means worst-case work/trace estimate ${expandedCalls} exceeds ${MAX_EXPANDED_CALLS} calls`);
  }
  return { rows, rowCount, columnCount, k: input.k, seed: input.seed, maxIterations, tolerance: tol };
}

function createTraceCollector() {
  const summaries = new Map();
  const iterations = [];
  const record = (id, stage, iteration, value) => {
    const key = `${id}\0${stage}\0${iteration ?? ''}`;
    let summary = summaries.get(key);
    if (!summary) {
      summary = { id, stage, iteration: iteration ?? null, count: 0, min: Infinity, max: -Infinity };
      summaries.set(key, summary);
    }
    const scalar = typeof value === 'number' ? value : null;
    summary.count += 1;
    if (scalar !== null) {
      summary.min = Math.min(summary.min, scalar);
      summary.max = Math.max(summary.max, scalar);
    }
  };
  const iteration = (value) => { iterations.push(value); };
  const finish = () => {
    const calls = [...summaries.values()].map(({ min, max, ...summary }) => ({
      ...summary,
      output: { count: summary.count, ...(summary.count > 0 && Number.isFinite(min) ? { min, max } : {}) },
    }));
    const trace = { schema: 'ml.training-trace.v1', operation: 'fitKMeans', calls, iterations, bytes: 0 };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const measured = new TextEncoder().encode(JSON.stringify(trace)).byteLength;
      if (trace.bytes === measured) break;
      trace.bytes = measured;
    }
    if (trace.bytes > MAX_TRACE_BYTES) failRange(`k-means trace exceeds ${MAX_TRACE_BYTES} bytes`);
    return trace;
  };
  return { record, iteration, finish };
}

function fitKMeansInternal(input, call, trace) {
  const { rows, rowCount, columnCount, k, seed, maxIterations, tolerance } = validateFitInput(input);
  const invokeDistance = (a, b, stage, iteration) => {
    const value = call('linalg.distance', { a, b });
    finite(value, 'Euclidean distance');
    if (value < 0) failRange('Euclidean distance must be nonnegative');
    if (trace) trace.record('linalg.distance', stage, iteration, value);
    return value;
  };
  const invokeMean = (values, stage, iteration) => {
    const value = call('statistics.mean', { values }).value;
    finite(value, 'cluster centroid mean');
    if (trace) trace.record('statistics.mean', stage, iteration, value);
    return value;
  };

  const random = randomGenerator(seed);
  const selected = [Math.floor(random() * rowCount)];
  const nearestSquared = Array(rowCount).fill(Infinity);
  for (let center = 1; center < k; center += 1) {
    const lastCenter = rows[selected.at(-1)];
    for (let row = 0; row < rowCount; row += 1) {
      const distanceValue = invokeDistance(rows[row], lastCenter, 'kmeans++-selection', center);
      nearestSquared[row] = Math.min(nearestSquared[row], scalarSquared(distanceValue, 'k-means++'));
    }
    const largest = Math.max(...nearestSquared.filter(Number.isFinite));
    const scaledTotal = largest === 0 ? 0 : nearestSquared.reduce((sum, value) => sum + (value / largest), 0);
    let chosen;
    if (scaledTotal === 0) {
      chosen = Array.from({ length: rowCount }, (_, index) => index).find(index => !selected.includes(index));
    } else {
      let target = random() * scaledTotal;
      for (let row = 0; row < rowCount; row += 1) {
        target -= nearestSquared[row] / largest;
        if (target < 0) { chosen = row; break; }
      }
      chosen ??= rowCount - 1;
    }
    selected.push(chosen);
  }
  let centroids = selected.map(index => rows[index].slice());
  let assignments = Array(rowCount).fill(0);
  let converged = false;
  let completedIterations = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    completedIterations = iteration;
    const distances = Array.from({ length: rowCount }, () => Array(k));
    assignments = rows.map((row, rowIndex) => {
      let bestCluster = 0;
      let bestDistance = Infinity;
      for (let cluster = 0; cluster < k; cluster += 1) {
        const value = invokeDistance(row, centroids[cluster], 'assignment', iteration);
        distances[rowIndex][cluster] = value;
        if (value < bestDistance) { bestDistance = value; bestCluster = cluster; }
      }
      return bestCluster;
    });

    const nextCentroids = centroids.map(center => center.slice());
    const clusterSizes = Array(k).fill(0);
    const groupedRows = Array.from({ length: k }, () => []);
    assignments.forEach((cluster, rowIndex) => {
      clusterSizes[cluster] += 1;
      groupedRows[cluster].push(rows[rowIndex]);
    });
    for (let cluster = 0; cluster < k; cluster += 1) {
      if (clusterSizes[cluster] === 0) continue;
      nextCentroids[cluster] = Array.from({ length: columnCount }, (_, column) => invokeMean(
        groupedRows[cluster].map(row => row[column]),
        'centroid-coordinate-mean',
        iteration,
      ));
    }
    let maximumMovement = 0;
    for (let cluster = 0; cluster < k; cluster += 1) {
      maximumMovement = Math.max(maximumMovement, invokeDistance(centroids[cluster], nextCentroids[cluster], 'centroid-movement', iteration));
    }
    const emptyClusterCount = clusterSizes.reduce((count, size) => count + Number(size === 0), 0);
    trace?.iteration({ iteration, maximumMovement, emptyClusterCount });
    centroids = nextCentroids;
    if (maximumMovement <= tolerance) {
      converged = true;
      break;
    }
  }

  const finalSquaredDistances = [];
  assignments = rows.map((row, rowIndex) => {
    let bestCluster = 0;
    let bestDistance = Infinity;
    for (let cluster = 0; cluster < k; cluster += 1) {
      const value = invokeDistance(row, centroids[cluster], 'final-assignment', completedIterations);
      if (value < bestDistance) { bestDistance = value; bestCluster = cluster; }
    }
    finalSquaredDistances[rowIndex] = squaredEuclidean(row, centroids[bestCluster], `final assignment[${rowIndex}]`);
    return bestCluster;
  });
  const inertia = finalSquaredDistances.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isFinite(next)) failRange('k-means inertia exceeds the finite number range');
    return next;
  }, 0);
  return {
    kind: 'kmeans',
    featureCount: columnCount,
    centroids,
    assignments,
    inertia,
    iterations: completedIterations,
    converged,
    seed,
    config: {
      k,
      maxIterations,
      tolerance,
      initialization: INITIALIZATION,
      tieBreak: TIE_BREAK,
      emptyCluster: EMPTY_CLUSTER,
    },
  };
}

/** Fit deterministic k-means++ and return the JSON model only. */
export function fitKMeans(input, call = localCall) {
  return fitKMeansInternal(input, call, null);
}

/** Fit k-means and retain bounded aggregate summaries of its actual primitive calls. */
export function fitKMeansWithTrace(input, call = localCall) {
  const trace = createTraceCollector();
  const model = fitKMeansInternal(input, call, trace);
  return { model, trace: trace.finish() };
}

function validateModel(modelInput) {
  exactKeys(modelInput, ['kind', 'featureCount', 'centroids', 'assignments', 'inertia', 'iterations', 'converged', 'seed', 'config'], 'k-means model');
  const model = modelInput;
  if (model.kind !== 'kmeans') failType('model.kind must be kmeans');
  if (!Number.isSafeInteger(model.featureCount) || model.featureCount < 1 || model.featureCount > MAX_FEATURES) failRange(`model.featureCount must be from 1 to ${MAX_FEATURES}`);
  const centroids = featureMatrix(model.centroids, 'model.centroids');
  if (centroids.columnCount !== model.featureCount || centroids.rowCount > MAX_CLUSTERS) failRange('model centroid dimensions do not match featureCount or cluster limit');
  const k = centroids.rowCount;
  if (!Number.isSafeInteger(model.seed) || model.seed < 0 || model.seed > 0xffff_ffff) failRange('model.seed must be an unsigned 32-bit integer');
  if (typeof model.converged !== 'boolean') failType('model.converged must be boolean');
  if (!Number.isSafeInteger(model.iterations) || model.iterations < 1 || model.iterations > MAX_ITERATIONS) failRange('model.iterations is outside the supported bound');
  finite(model.inertia, 'model.inertia');
  if (model.inertia < 0) failRange('model.inertia must be nonnegative');
  exactKeys(model.config, ['k', 'maxIterations', 'tolerance', 'initialization', 'tieBreak', 'emptyCluster'], 'k-means config');
  if (model.config.k !== k || !Number.isSafeInteger(model.config.maxIterations) || model.config.maxIterations < model.iterations || model.config.maxIterations > MAX_ITERATIONS) failRange('model.config is inconsistent with its clusters or iteration count');
  finite(model.config.tolerance, 'model.config.tolerance');
  if (model.config.tolerance < 0 || model.config.initialization !== INITIALIZATION || model.config.tieBreak !== TIE_BREAK || model.config.emptyCluster !== EMPTY_CLUSTER) failRange('model.config contains unsupported k-means policies');
  const assignments = array(model.assignments, 'model.assignments', 1, MAX_SAMPLES).map((cluster, index) => {
    if (!Number.isSafeInteger(cluster) || cluster < 0 || cluster >= k) failRange(`model.assignments[${index}] must name a cluster in [0, ${k})`);
    return cluster;
  });
  return { centroids: centroids.rows, assignments, featureCount: model.featureCount, k };
}

/** Assign rows to their nearest stored centroid; lower cluster IDs win exact ties. */
export function predictKMeans(input, call = localCall) {
  onlyKeys(input, new Set(['model', 'features']), 'k-means prediction input');
  const model = validateModel(input.model);
  const { rows, columnCount } = featureMatrix(input.features, 'features');
  if (columnCount !== model.featureCount) failRange(`features must have ${model.featureCount} columns to match model.featureCount`);
  const assignments = [];
  const distances = [];
  const squaredDistances = [];
  for (const [rowIndex, row] of rows.entries()) {
    let bestCluster = 0;
    let bestDistance = Infinity;
    for (let cluster = 0; cluster < model.k; cluster += 1) {
      const candidate = call('linalg.distance', { a: row, b: model.centroids[cluster] });
      finite(candidate, `distance[${rowIndex}][${cluster}]`);
      if (candidate < bestDistance) { bestDistance = candidate; bestCluster = cluster; }
    }
    assignments.push(bestCluster);
    distances.push(bestDistance);
    squaredDistances.push(squaredEuclidean(row, model.centroids[bestCluster], `prediction[${rowIndex}]`));
  }
  return { assignments, distances, squaredDistances };
}

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const number = { type: 'number' };
const integer = { type: 'integer' };
const vectorSchema = { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: number };
const rowsSchema = { type: 'array', minItems: 2, maxItems: MAX_SAMPLES, items: vectorSchema };
const modelSchema = obj({
  kind: { type: 'string', enum: ['kmeans'] },
  featureCount: { type: 'integer', minimum: 1, maximum: MAX_FEATURES },
  centroids: { type: 'array', minItems: 1, maxItems: MAX_CLUSTERS, items: vectorSchema },
  assignments: { type: 'array', minItems: 1, maxItems: MAX_SAMPLES, items: { type: 'integer', minimum: 0, maximum: MAX_CLUSTERS - 1 } },
  inertia: { type: 'number', minimum: 0 },
  iterations: { type: 'integer', minimum: 1, maximum: MAX_ITERATIONS },
  converged: { type: 'boolean' },
  seed: { type: 'integer', minimum: 0, maximum: 0xffff_ffff },
  config: obj({
    k: { type: 'integer', minimum: 1, maximum: MAX_CLUSTERS },
    maxIterations: { type: 'integer', minimum: 1, maximum: MAX_ITERATIONS },
    tolerance: number,
    initialization: { type: 'string', enum: [INITIALIZATION] },
    tieBreak: { type: 'string', enum: [TIE_BREAK] },
    emptyCluster: { type: 'string', enum: [EMPTY_CLUSTER] },
  }),
});

export const clusteringCapabilities = [
  {
    id: 'ml.fitKMeans',
    title: 'Fit k-means clusters',
    description: 'Selects seeded centers, repeatedly assigns the nearest center, and updates nonempty clusters with their coordinate means.',
    kind: 'composed',
    dependsOn: ['linalg.distance', 'statistics.mean'],
    inputSchema: obj({
      features: rowsSchema,
      k: { type: 'integer', minimum: 1, maximum: MAX_CLUSTERS },
      seed: { type: 'integer', minimum: 0, maximum: 0xffff_ffff },
      maxIterations: { type: 'integer', minimum: 1, maximum: MAX_ITERATIONS },
      tolerance: { type: 'number', minimum: 0 },
    }, ['features', 'k', 'seed']),
    outputSchema: modelSchema,
    examples: [{
      input: { features: [[0, 2], [2, 4], [4, 6]], k: 1, seed: 5 },
      expected: {
        kind: 'kmeans', featureCount: 2, centroids: [[2, 4]], assignments: [0, 0, 0], inertia: 16,
        iterations: 2, converged: true, seed: 5,
        config: { k: 1, maxIterations: MAX_ITERATIONS, tolerance: DEFAULT_TOLERANCE, initialization: INITIALIZATION, tieBreak: TIE_BREAK, emptyCluster: EMPTY_CLUSTER },
      },
    }],
    formula: 'cⱼ ← seeded center; aᵢ = argminⱼ ‖xᵢ − cⱼ‖; cⱼ ← coordinate-wise mean of assigned rows.',
    caveats: [
      'Cluster labels are stable numeric identifiers for this fit, not semantic class names.',
      'Exact distance ties choose the lowest cluster index; an empty cluster keeps its previous center.',
      'Tolerance is an absolute Euclidean movement threshold. Reaching maxIterations returns converged:false with the last centers and assignments.',
      'Squared distances and inertia must remain finite; extreme magnitudes that overflow are rejected.',
    ],
    run: (input, ctx) => fitKMeans(input, (id, args) => ctx.call(id, args)),
  },
  {
    id: 'ml.predictKMeans',
    title: 'Assign rows to fitted clusters',
    description: 'Assigns each row to the nearest retained centroid and returns Euclidean and squared distances.',
    kind: 'composed',
    dependsOn: ['linalg.distance'],
    inputSchema: obj({ model: modelSchema, features: { ...rowsSchema, minItems: 1 } }),
    outputSchema: obj({
      assignments: { type: 'array', minItems: 1, maxItems: MAX_SAMPLES, items: integer },
      distances: { type: 'array', minItems: 1, maxItems: MAX_SAMPLES, items: number },
      squaredDistances: { type: 'array', minItems: 1, maxItems: MAX_SAMPLES, items: number },
    }),
    examples: [{
      input: {
        model: {
          kind: 'kmeans', featureCount: 1, centroids: [[0], [2]], assignments: [0, 0], inertia: 0,
          iterations: 1, converged: true, seed: 1,
          config: { k: 2, maxIterations: MAX_ITERATIONS, tolerance: DEFAULT_TOLERANCE, initialization: INITIALIZATION, tieBreak: TIE_BREAK, emptyCluster: EMPTY_CLUSTER },
        },
        features: [[1], [3]],
      },
      expected: { assignments: [0, 1], distances: [1, 1], squaredDistances: [1, 1] },
    }],
    formula: 'aᵢ = argminⱼ dᵢⱼ; dᵢⱼ = ‖xᵢ − cⱼ‖₂.',
    caveats: ['Squared distance is the square of the returned Euclidean distance; ties choose the lowest cluster index.'],
    run: (input, ctx) => predictKMeans(input, (id, args) => ctx.call(id, args)),
  },
];
