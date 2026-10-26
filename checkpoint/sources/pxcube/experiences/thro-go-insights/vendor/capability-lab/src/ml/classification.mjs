import { dot, matvec } from '../linalg/basics.mjs';

const MODEL_KIND = 'logisticRegression';
const MAX_SAMPLES = 10_000;
const MAX_FEATURES = 100;
const MAX_FEATURE_VALUES = 60_000;
const MAX_ITERATIONS = 10_000;
const MAX_BATCH_ELEMENT_VISITS = 2_000_000;

function objectInput(input, label = 'input') {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  return input;
}

function onlyKeys(input, allowed, label) {
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`unknown ${label} field ${key}`);
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function finiteFeatures(features, label = 'features') {
  if (!Array.isArray(features) || features.length < 1 || features.length > MAX_SAMPLES) {
    throw new RangeError(`${label} must contain 1 to ${MAX_SAMPLES} rows`);
  }
  if (!Array.isArray(features[0]) || features[0].length < 1 || features[0].length > MAX_FEATURES) {
    throw new RangeError(`${label} rows must contain 1 to ${MAX_FEATURES} features`);
  }
  const columns = features[0].length;
  if (features.length * columns > MAX_FEATURE_VALUES) throw new RangeError(`${label} exceeds ${MAX_FEATURE_VALUES} total feature values`);
  for (let row = 0; row < features.length; row += 1) {
    if (!Array.isArray(features[row]) || features[row].length !== columns) throw new RangeError(`${label} must be rectangular with the same feature count per row`);
    for (let column = 0; column < columns; column += 1) finiteNumber(features[row][column], `${label}[${row}][${column}]`);
  }
  return { rows: features.length, columns };
}

function binaryTargets(targets, expectedLength, label = 'targets') {
  if (!Array.isArray(targets) || targets.length !== expectedLength) throw new RangeError(`${label} length must match the number of feature rows`);
  for (let index = 0; index < targets.length; index += 1) {
    if (targets[index] !== 0 && targets[index] !== 1) throw new RangeError(`${label}[${index}] must be binary 0 or 1`);
  }
  return targets;
}

function probabilityThreshold(value, label = 'threshold') {
  finiteNumber(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1`);
  return value;
}

function finiteVector(values, label, expectedLength) {
  if (!Array.isArray(values) || values.length !== expectedLength) throw new RangeError(`${label} length must match the feature count`);
  for (let index = 0; index < values.length; index += 1) finiteNumber(values[index], `${label}[${index}]`);
  return values;
}

function softplus(value) {
  return Math.max(value, 0) + Math.log1p(Math.exp(-Math.abs(value)));
}

/** Stable sigmoid probability for one finite logit (pre-probability score). */
export function logisticSigmoid(input) {
  objectInput(input);
  onlyKeys(input, new Set(['score']), 'sigmoid input');
  const score = finiteNumber(input.score, 'score');
  if (score >= 0) return 1 / (1 + Math.exp(-score));
  const exp = Math.exp(score);
  return exp / (1 + exp);
}

/** Raw linear scores Xβ + intercept, before applying the sigmoid. */
export function logisticScores(input) {
  objectInput(input);
  onlyKeys(input, new Set(['features', 'coefficients', 'intercept']), 'score input');
  const shape = finiteFeatures(input.features);
  const coefficients = finiteVector(input.coefficients, 'coefficients', shape.columns);
  const intercept = finiteNumber(input.intercept ?? 0, 'intercept');
  const products = matvec(input.features, coefficients);
  return products.map((value, index) => {
    const score = value + intercept;
    if (!Number.isFinite(score)) throw new RangeError(`score[${index}] is outside the finite double range`);
    return score;
  });
}

/** Mean binary cross-entropy from targets and raw logits, evaluated with softplus. */
export function binaryCrossEntropy(input) {
  objectInput(input);
  onlyKeys(input, new Set(['targets', 'scores']), 'loss input');
  if (!Array.isArray(input.scores) || input.scores.length < 1 || input.scores.length > MAX_SAMPLES) throw new RangeError(`scores must contain 1 to ${MAX_SAMPLES} values`);
  const targets = binaryTargets(input.targets, input.scores.length);
  let mean = 0;
  for (let index = 0; index < input.scores.length; index += 1) {
    const score = finiteNumber(input.scores[index], `scores[${index}]`);
    const loss = targets[index] === 1 ? softplus(-score) : softplus(score);
    mean += (loss - mean) / (index + 1);
    if (!Number.isFinite(mean)) throw new RangeError('binary cross-entropy is outside the finite double range');
  }
  return mean;
}

function checkedRegularization(value) {
  finiteNumber(value, 'l2');
  if (value < 0) throw new RangeError('l2 must be nonnegative');
  return value;
}

function gradientFromScores(features, targets, coefficients, intercept, fitIntercept, l2, scores) {
  const residuals = scores.map((score, index) => logisticSigmoid({ score }) - targets[index]);
  const n = features.length;
  const columns = Array.from({ length: coefficients.length }, (_, column) => features.map((row) => row[column]));
  const coefficientGradient = columns.map((column, index) => {
    const gradient = dot(column, residuals) / n + l2 * coefficients[index];
    if (!Number.isFinite(gradient)) throw new RangeError(`coefficient gradient[${index}] is outside the finite double range`);
    return gradient;
  });
  let interceptGradient = 0;
  if (fitIntercept) {
    interceptGradient = dot(Array(n).fill(1), residuals) / n;
    if (!Number.isFinite(interceptGradient)) throw new RangeError('intercept gradient is outside the finite double range');
  }
  return { coefficients: coefficientGradient, intercept: interceptGradient };
}

/** Full-batch mean-loss gradient plus L2 coefficient penalty (intercept excluded). */
export function logisticGradient(input) {
  objectInput(input);
  onlyKeys(input, new Set(['features', 'targets', 'coefficients', 'intercept', 'fitIntercept', 'l2']), 'gradient input');
  const shape = finiteFeatures(input.features);
  const targets = binaryTargets(input.targets, shape.rows);
  const coefficients = finiteVector(input.coefficients, 'coefficients', shape.columns);
  const intercept = finiteNumber(input.intercept ?? 0, 'intercept');
  const fitIntercept = input.fitIntercept ?? true;
  if (typeof fitIntercept !== 'boolean') throw new TypeError('fitIntercept must be boolean');
  const l2 = checkedRegularization(input.l2 ?? 0);
  const scores = logisticScores({ features: input.features, coefficients, intercept });
  return gradientFromScores(input.features, targets, coefficients, intercept, fitIntercept, l2, scores);
}

function optimizerOptions(input) {
  const fitIntercept = input.fitIntercept ?? true;
  if (typeof fitIntercept !== 'boolean') throw new TypeError('fitIntercept must be boolean');
  const learningRate = finiteNumber(input.learningRate ?? 0.1, 'learningRate');
  if (learningRate <= 0 || learningRate > 10) throw new RangeError('learningRate must be greater than 0 and at most 10');
  const maxIterations = input.maxIterations ?? 1000;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
    throw new RangeError(`maxIterations must be from 1 to ${MAX_ITERATIONS}`);
  }
  const tolerance = finiteNumber(input.tolerance ?? 1e-8, 'tolerance');
  if (tolerance < 0 || tolerance > 1) throw new RangeError('tolerance must be between 0 and 1');
  const l2 = checkedRegularization(input.l2 ?? 0);
  const threshold = probabilityThreshold(input.threshold ?? 0.5);
  return { fitIntercept, learningRate, maxIterations, tolerance, l2, threshold };
}

function objectiveParts(targets, coefficients, scores, l2) {
  const binaryCrossEntropyValue = binaryCrossEntropy({ targets, scores });
  let l2Penalty = 0;
  if (l2 !== 0) {
    let squaredSum = 0;
    for (const coefficient of coefficients) {
      const squared = coefficient * coefficient;
      if (!Number.isFinite(squared)) throw new RangeError('L2 penalty is outside the finite double range');
      squaredSum += squared;
      if (!Number.isFinite(squaredSum)) throw new RangeError('L2 penalty is outside the finite double range');
    }
    l2Penalty = (l2 * squaredSum) / 2;
    if (!Number.isFinite(l2Penalty)) throw new RangeError('L2 penalty is outside the finite double range');
  }
  const objective = binaryCrossEntropyValue + l2Penalty;
  if (!Number.isFinite(objective)) throw new RangeError('objective is outside the finite double range');
  return { binaryCrossEntropy: binaryCrossEntropyValue, l2Penalty, objective };
}

function fitLogistic(input, withTrace) {
  objectInput(input);
  onlyKeys(input, new Set(['features', 'targets', 'fitIntercept', 'learningRate', 'maxIterations', 'tolerance', 'l2', 'threshold']), 'fit input');
  const shape = finiteFeatures(input.features);
  const targets = binaryTargets(input.targets, shape.rows);
  const options = optimizerOptions(input);
  const worstCaseVisits = shape.rows * (2 * shape.columns + 1) * (options.maxIterations + 1);
  if (!Number.isSafeInteger(worstCaseVisits) || worstCaseVisits > MAX_BATCH_ELEMENT_VISITS) {
    throw new RangeError(`requested batch work ${worstCaseVisits} exceeds bound ${MAX_BATCH_ELEMENT_VISITS}`);
  }

  let coefficients = Array(shape.columns).fill(0);
  let intercept = 0;
  let iterations = 0;
  let converged = false;
  let initialTrace = null;
  let loopGradientEvaluations = 0;
  for (let update = 0; update < options.maxIterations; update += 1) {
    const scores = logisticScores({ features: input.features, coefficients, intercept });
    const gradient = gradientFromScores(input.features, targets, coefficients, intercept, options.fitIntercept, options.l2, scores);
    loopGradientEvaluations += 1;
    const gradientNorm = Math.hypot(...gradient.coefficients, ...(options.fitIntercept ? [gradient.intercept] : []));
    if (withTrace && update === 0) {
      initialTrace = { scores, objective: objectiveParts(targets, coefficients, scores, options.l2), gradient, gradientNorm };
    }
    if (!Number.isFinite(gradientNorm)) throw new RangeError('gradient norm is outside the finite double range');
    if (gradientNorm <= options.tolerance) {
      converged = true;
      break;
    }
    coefficients = coefficients.map((coefficient, index) => {
      const updated = coefficient - options.learningRate * gradient.coefficients[index];
      if (!Number.isFinite(updated)) throw new RangeError(`coefficient[${index}] update is outside the finite double range`);
      return updated;
    });
    if (options.fitIntercept) {
      intercept -= options.learningRate * gradient.intercept;
      if (!Number.isFinite(intercept)) throw new RangeError('intercept update is outside the finite double range');
    }
    iterations += 1;
  }

  const finalScores = logisticScores({ features: input.features, coefficients, intercept });
  const finalObjective = objectiveParts(targets, coefficients, finalScores, options.l2);
  const finalLoss = finalObjective.objective;
  const finalGradient = gradientFromScores(input.features, targets, coefficients, intercept, options.fitIntercept, options.l2, finalScores);
  const finalGradientNorm = Math.hypot(...finalGradient.coefficients, ...(options.fitIntercept ? [finalGradient.intercept] : []));
  if (!Number.isFinite(finalGradientNorm)) throw new RangeError('gradient norm is outside the finite double range');
  if (finalGradientNorm <= options.tolerance) converged = true;

  const model = {
    kind: MODEL_KIND,
    version: 1,
    coefficients,
    intercept,
    fitIntercept: options.fitIntercept,
    threshold: options.threshold,
    training: {
      sampleCount: shape.rows,
      featureCount: shape.columns,
      initialization: 'zeros',
    },
    optimizer: {
      method: 'fullBatchGradientDescent',
      learningRate: options.learningRate,
      maxIterations: options.maxIterations,
      tolerance: options.tolerance,
      l2: options.l2,
      iterations,
      converged,
      finalLoss,
      finalBinaryCrossEntropy: finalObjective.binaryCrossEntropy,
      maxBatchElementVisits: MAX_BATCH_ELEMENT_VISITS,
      worstCaseElementVisits: worstCaseVisits,
    },
  };
  if (!withTrace) return { model };
  const gradientDependencies = [
    { sourceId: 'linalg.dot', calls: shape.columns + (options.fitIntercept ? 1 : 0) },
    { sourceId: 'ml.logisticSigmoid', calls: shape.rows },
  ];
  const calls = [
    scoreTraceCall('initial', shape, initialTrace.scores),
    { sourceId: 'ml.binaryCrossEntropy', phase: 'initial', inputSummary: { targets: shape.rows, scoreSource: 'linalg.matvec' }, outputSummary: { loss: initialTrace.objective.binaryCrossEntropy } },
    { sourceId: 'src/ml/classification.mjs#objectiveParts', operationId: 'ml.regularizedObjective', phase: 'initial', inputSummary: { l2: options.l2, coefficients: shape.columns }, outputSummary: { binaryCrossEntropy: initialTrace.objective.binaryCrossEntropy, l2Penalty: initialTrace.objective.l2Penalty, objective: initialTrace.objective.objective } },
    gradientTraceCall('initial', shape, initialTrace.gradient, initialTrace.gradientNorm, gradientDependencies),
    scoreTraceCall('final', shape, finalScores),
    { sourceId: 'ml.binaryCrossEntropy', phase: 'final', inputSummary: { targets: shape.rows, scoreSource: 'linalg.matvec' }, outputSummary: { loss: finalObjective.binaryCrossEntropy } },
    { sourceId: 'src/ml/classification.mjs#objectiveParts', operationId: 'ml.regularizedObjective', phase: 'final', inputSummary: { l2: options.l2, coefficients: shape.columns }, outputSummary: { binaryCrossEntropy: finalObjective.binaryCrossEntropy, l2Penalty: finalObjective.l2Penalty, objective: finalObjective.objective } },
    gradientTraceCall('final', shape, finalGradient, finalGradientNorm, gradientDependencies),
  ];
  return {
    model,
    trace: {
      kind: 'logisticTrainingTrace',
      version: 1,
      inputSummary: { sampleCount: shape.rows, featureCount: shape.columns },
      calls,
      optimizerSummary: { ...model.optimizer },
      aggregate: {
        gradientEvaluations: loopGradientEvaluations + 1,
        logisticScoreEvaluations: loopGradientEvaluations + 1,
        matvecEvaluations: loopGradientEvaluations + 1,
        scoreDotEvaluations: (loopGradientEvaluations + 1) * shape.rows,
        gradientDotEvaluations: (loopGradientEvaluations + 1) * (shape.columns + (options.fitIntercept ? 1 : 0)),
        dotEvaluations: (loopGradientEvaluations + 1) * (shape.rows + shape.columns + (options.fitIntercept ? 1 : 0)),
        sigmoidEvaluations: (loopGradientEvaluations + 1) * shape.rows,
        lossEvaluations: 2,
        omittedIntermediateGradientEvaluations: Math.max(0, loopGradientEvaluations - 1),
      },
      policy: 'records actual initial/final calculations and summarizes omitted intermediate gradient updates',
    },
  };
}

function scoreTraceCall(phase, shape, scores) {
  let minimum = Infinity, maximum = -Infinity;
  for (const score of scores) { minimum = Math.min(minimum, score); maximum = Math.max(maximum, score); }
  return { sourceId: 'src/ml/classification.mjs#logisticScores', operationId: 'ml.logisticScores', phase, inputSummary: { rows: shape.rows, columns: shape.columns, includesIntercept: true }, outputSummary: { count: scores.length, minimum, maximum }, dependencies: [{ sourceId: 'linalg.matvec', calls: 1 }] };
}

function gradientTraceCall(phase, shape, gradient, norm, dependencies) {
  return {
    sourceId: 'src/ml/classification.mjs#gradientFromScores', operationId: 'ml.logisticGradient', phase,
    inputSummary: { rows: shape.rows, columns: shape.columns },
    outputSummary: { coefficients: [...gradient.coefficients], intercept: gradient.intercept, norm },
    dependencies: dependencies.map((item) => ({ ...item })),
  };
}

/** Fit and return a deterministic zero-initialized binary logistic regression model. */
export function fitLogisticRegression(input) {
  return fitLogistic(input, false).model;
}

/** Fit the same model and return a bounded initial/final calculation trace. */
export function fitLogisticRegressionWithTrace(input) {
  return fitLogistic(input, true);
}

function validateModel(model) {
  objectInput(model, 'model');
  if (model.kind !== MODEL_KIND || model.version !== 1) throw new TypeError(`model must be a ${MODEL_KIND} version 1`);
  if (!Array.isArray(model.coefficients) || model.coefficients.length < 1 || model.coefficients.length > MAX_FEATURES) {
    throw new RangeError(`model coefficients must contain 1 to ${MAX_FEATURES} values`);
  }
  for (let index = 0; index < model.coefficients.length; index += 1) finiteNumber(model.coefficients[index], `model.coefficients[${index}]`);
  const intercept = finiteNumber(model.intercept, 'model.intercept');
  if (typeof model.fitIntercept !== 'boolean') throw new TypeError('model.fitIntercept must be boolean');
  const threshold = probabilityThreshold(model.threshold, 'model.threshold');
  objectInput(model.training, 'model.training');
  if (!Number.isSafeInteger(model.training.sampleCount) || model.training.sampleCount < 1 || model.training.sampleCount > MAX_SAMPLES) throw new RangeError('model.training.sampleCount must be a positive bounded integer');
  if (!Number.isSafeInteger(model.training.featureCount) || model.training.featureCount !== model.coefficients.length) throw new RangeError('model.training.featureCount must match model coefficient count');
  if (model.training.initialization !== 'zeros') throw new TypeError('model.training.initialization must be zeros');
  if (!model.fitIntercept && intercept !== 0) throw new RangeError('model intercept must be zero when fitIntercept is false');
  return { coefficients: model.coefficients, intercept, threshold };
}

/** Predict from a fitted model. Targets are not accepted or read. */
export function predictLogisticRegression(input) {
  objectInput(input);
  onlyKeys(input, new Set(['model', 'features']), 'prediction input');
  const model = validateModel(input.model);
  const shape = finiteFeatures(input.features);
  if (shape.columns !== model.coefficients.length) throw new RangeError('feature count must match model coefficient count');
  const scores = logisticScores({ features: input.features, coefficients: model.coefficients, intercept: model.intercept });
  const probabilities = scores.map((score) => logisticSigmoid({ score }));
  const labels = probabilities.map((probability) => probability >= model.threshold ? 1 : 0);
  return { probabilities, labels, scores };
}
