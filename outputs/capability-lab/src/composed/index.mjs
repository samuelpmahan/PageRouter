import { createRegistry } from '../runtime/index.mjs';
import { capabilities as statisticsCapabilities } from '../statistics/index.mjs';
import { capabilities as linalgCapabilities } from '../linalg/index.mjs';

const number = { type: 'number' };
const numberArray = { type: 'array', minItems: 1, items: number };
const matrix = { type: 'array', minItems: 1, items: numberArray };
const denominator = { type: 'string', enum: ['sample', 'population'] };
const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const observationsInput = objectSchema({ observations: matrix, denominator }, ['observations']);
const principalInput = objectSchema({
  observations: matrix,
  denominator,
  tolerance: { type: 'number', minimum: 0, maximum: 0.9999999999999999 },
  maxIterations: { type: 'integer', minimum: 1, maximum: 100000 },
}, ['observations']);
const covarianceOutput = objectSchema({ matrix });
const eigenOutput = objectSchema({
  covarianceMatrix: matrix,
  eigenvalues: numberArray,
  eigenvectors: matrix,
  iterations: { type: 'integer', minimum: 0 },
});
const pcaOutput = objectSchema({
  covarianceMatrix: matrix,
  eigenvalues: numberArray,
  eigenvectors: matrix,
  means: numberArray,
  scores: matrix,
  iterations: { type: 'integer', minimum: 0 },
});
const profileOutput = objectSchema({
  zScores: matrix,
  distances: numberArray,
  featureMeans: numberArray,
  featureStandardDeviations: numberArray,
});
const regressionInput = objectSchema({ matrix, vector: numberArray });
const regressionOutput = objectSchema({
  coefficients: numberArray,
  predictions: numberArray,
  residuals: numberArray,
  residualMean: number,
  residualPopulationVariance: { type: 'number', minimum: 0 },
  solverResidualNorm: { type: 'number', minimum: 0 },
  rank: { type: 'integer', minimum: 0 },
});

const pcaFixture = {
  observations: [[-2, 0], [-1, 0], [1, 0], [2, 0], [0, -1], [0, 1]],
  denominator: 'sample',
};
const pcaExpected = {
  covarianceMatrix: [[2, 0], [0, 0.4]],
  eigenvalues: [2, 0.4],
  eigenvectors: [[1, 0], [0, 1]],
  means: [0, 0],
  scores: [[-2, 0], [-1, 0], [1, 0], [2, 0], [0, -1], [0, 1]],
  iterations: 0,
};

function standalone(id, input) {
  const registry = createRegistry(
    [...statisticsCapabilities, ...linalgCapabilities, ...capabilities],
    { source: 'capability-lab', version: '1' },
  );
  return registry.execute(id, input).result;
}

function invoke(id, input, ctx, implementation) {
  return ctx ? implementation(input, ctx) : standalone(id, input);
}

export function covarianceMatrix(input, ctx) {
  return invoke('composed.covarianceMatrix', input, ctx, (value, context) => {
    if (value.observations.length < 2) throw new RangeError('covariance matrix requires at least two observations');
    const columns = context.call('linalg.transpose', { matrix: value.observations });
    const width = columns.length;
    const mode = value.denominator ?? 'sample';
    const result = Array.from({ length: width }, () => Array(width).fill(0));
    for (let row = 0; row < width; row += 1) {
      for (let column = row; column < width; column += 1) {
        const estimate = context.call('statistics.covariance', {
          x: columns[row], y: columns[column], denominator: mode,
        }).value;
        result[row][column] = estimate;
        result[column][row] = estimate;
      }
    }
    return { matrix: result };
  });
}

export function principalComponents(input, ctx) {
  return invoke('composed.principalComponents', input, ctx, (value, context) => {
    const covarianceInput = { observations: value.observations };
    if (value.denominator !== undefined) covarianceInput.denominator = value.denominator;
    const covariance = context.call('composed.covarianceMatrix', covarianceInput).matrix;
    const eigensystemInput = { matrix: covariance };
    if (value.tolerance !== undefined) eigensystemInput.tolerance = value.tolerance;
    if (value.maxIterations !== undefined) eigensystemInput.maxIterations = value.maxIterations;
    const eigensystem = context.call('linalg.symmetricEigen', eigensystemInput);
    if (!eigensystem.converged) {
      throw new RangeError(`principal components refused an unconverged eigensystem; Jacobi solver stopped after ${eigensystem.iterations} iterations`);
    }
    return {
      covarianceMatrix: covariance,
      eigenvalues: eigensystem.eigenvalues,
      eigenvectors: eigensystem.eigenvectors,
      iterations: eigensystem.iterations,
    };
  });
}

export function pcaScores(input, ctx) {
  return invoke('composed.pcaScores', input, ctx, (value, context) => {
    const components = context.call('composed.principalComponents', value);
    const columns = context.call('linalg.transpose', { matrix: value.observations });
    const means = columns.map((column) => context.call('statistics.mean', { values: column }).value);
    const axes = context.call('linalg.transpose', { matrix: components.eigenvectors });
    const scores = value.observations.map((row) => {
      const centered = context.call('linalg.vectorSubtract', { a: row, b: means });
      return axes.map((axis) => context.call('linalg.dot', { a: centered, b: axis }));
    });
    return { ...components, means, scores };
  });
}

export function standardizedEuclideanProfiles(input, ctx) {
  return invoke('composed.standardizedEuclideanProfiles', input, ctx, (value, context) => {
    const columns = context.call('linalg.transpose', { matrix: value.observations });
    const summaries = columns.map((column) => context.call('statistics.zScores', {
      values: column, denominator: value.denominator ?? 'sample',
    }));
    const zScores = context.call('linalg.transpose', { matrix: summaries.map(({ values }) => values) });
    const distances = zScores.map((row) => context.call('linalg.norm', { vector: row }));
    return {
      zScores,
      distances,
      featureMeans: summaries.map(({ mean }) => mean),
      featureStandardDeviations: summaries.map(({ standardDeviation }) => standardDeviation),
    };
  });
}

export function regressionDiagnostics(input, ctx) {
  return invoke('composed.regressionDiagnostics', input, ctx, (value, context) => {
    if (value.matrix.length !== value.vector.length) {
      throw new RangeError('design matrix and outcome vector must have the same number of rows');
    }
    const fit = context.call('linalg.leastSquares', { matrix: value.matrix, vector: value.vector });
    const predictions = context.call('linalg.matvec', { matrix: value.matrix, vector: fit.solution });
    const residuals = context.call('linalg.vectorSubtract', { a: value.vector, b: predictions });
    const residualMean = context.call('statistics.mean', { values: residuals }).value;
    const residualPopulationVariance = context.call('statistics.variance', {
      values: residuals, denominator: 'population',
    }).value;
    return {
      coefficients: fit.solution,
      predictions,
      residuals,
      residualMean,
      residualPopulationVariance,
      solverResidualNorm: fit.residualNorm,
      rank: fit.rank,
    };
  });
}

export const capabilities = [
  {
    id: 'composed.covarianceMatrix',
    title: 'Sample covariance matrix',
    description: 'Build a symmetric feature-by-feature covariance matrix from observations stored in rows.',
    kind: 'composed',
    dependsOn: ['linalg.transpose', 'statistics.covariance'],
    inputSchema: observationsInput,
    outputSchema: covarianceOutput,
    examples: [{ input: pcaFixture, expected: { matrix: [[2, 0], [0, 0.4]] } }],
    run: covarianceMatrix,
    formula: 'Cᵢⱼ = Cov(Xᵢ, Xⱼ), with the selected population n or sample n−1 denominator.',
    caveats: 'Requires at least two observations and a rectangular matrix. The default denominator is sample. Covariance is undefined for a singleton.',
  },
  {
    id: 'composed.principalComponents',
    title: 'Principal component directions',
    description: 'Compose the covariance matrix with a symmetric eigensolver to rank principal directions.',
    kind: 'composed',
    dependsOn: ['composed.covarianceMatrix', 'linalg.symmetricEigen'],
    inputSchema: principalInput,
    outputSchema: eigenOutput,
    examples: [{ input: pcaFixture, expected: {
      covarianceMatrix: pcaExpected.covarianceMatrix,
      eigenvalues: pcaExpected.eigenvalues,
      eigenvectors: pcaExpected.eigenvectors,
      iterations: 0,
    } }],
    run: principalComponents,
    formula: 'C V = V Λ; eigenvectors are columns, ordered by descending eigenvalue.',
    caveats: 'Uses the selected covariance denominator. A nonconverged eigensystem fails; eigenvector signs may differ while describing the same axis.',
  },
  {
    id: 'composed.pcaScores',
    title: 'Principal component scores',
    description: 'Center each row and project it onto the ordered eigenvector axes.',
    kind: 'composed',
    dependsOn: ['composed.principalComponents', 'linalg.transpose', 'statistics.mean', 'linalg.vectorSubtract', 'linalg.dot'],
    inputSchema: principalInput,
    outputSchema: pcaOutput,
    examples: [{ input: pcaFixture, expected: pcaExpected }],
    run: pcaScores,
    formula: 'scoreᵢₖ = (xᵢ − μ) · vₖ, where vₖ is eigenvector column k.',
    caveats: 'Rows are observations and columns are features. Output columns follow descending eigenvalue order; numerical ties can change axis order or signs.',
  },
  {
    id: 'composed.standardizedEuclideanProfiles',
    title: 'Standardized Euclidean profiles',
    description: 'Standardize every feature and measure each observation’s Euclidean distance from the standardized mean.',
    kind: 'composed',
    dependsOn: ['linalg.transpose', 'statistics.zScores', 'linalg.norm'],
    inputSchema: observationsInput,
    outputSchema: profileOutput,
    examples: [{
      input: { observations: [[1, 2], [3, 4], [5, 6]], denominator: 'sample' },
      expected: {
        zScores: [[-1, -1], [0, 0], [1, 1]],
        distances: [Math.SQRT2, 0, Math.SQRT2],
        featureMeans: [3, 4],
        featureStandardDeviations: [2, 2],
      },
    }],
    run: standardizedEuclideanProfiles,
    formula: 'zᵢⱼ = (xᵢⱼ − mean(Xⱼ)) / sd(Xⱼ); dᵢ = ‖zᵢ·‖₂.',
    caveats: 'Each feature uses its marginal mean and selected standard deviation. This Euclidean distance assumes independent features and does not adjust for covariance; constant features are rejected.',
  },
  {
    id: 'composed.regressionDiagnostics',
    title: 'Least-squares residual diagnostics',
    description: 'Fit full-rank least squares, recompute predictions and residuals, and summarize residual location and population spread.',
    kind: 'composed',
    dependsOn: ['linalg.leastSquares', 'linalg.matvec', 'linalg.vectorSubtract', 'statistics.mean', 'statistics.variance'],
    inputSchema: regressionInput,
    outputSchema: regressionOutput,
    examples: [{
      input: { matrix: [[1, 0], [1, 1], [1, 2]], vector: [1, 3, 5] },
      expected: {
        coefficients: [1, 2], predictions: [1, 3, 5], residuals: [0, 0, 0],
        residualMean: 0, residualPopulationVariance: 0, solverResidualNorm: 0, rank: 2,
      },
    }],
    run: regressionDiagnostics,
    formula: 'β = argmin ‖Xβ − y‖₂; residual = y − Xβ; variance uses n.',
    caveats: 'Design matrix rows are observations; include an intercept column when needed. Requires a full-column-rank system with rows ≥ columns. The reported residual variance is descriptive population variance over these residuals, not an inferential degrees-of-freedom estimate.',
  },
];
