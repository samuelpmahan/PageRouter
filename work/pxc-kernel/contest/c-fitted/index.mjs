// Contest C: fitted models. A model is learned from training data in one call (fit)
// and used on new inputs in another call (apply / predict).
// Representation: a fitted model is a plain Part (JSON value), passed as a Ref between a `*.fit` contract and a
// `*.apply` contract. Every model is a tagged object ({kind, ...}) so the input schema of apply refuses a model of
// the wrong family. Kernel v0.2: models are BUILT with gather (composition {gather} or ctx.gather), so each field
// of a model keeps the provenance of the call that produced it, and the kind tag is a literal, not `computed`.
// Kernel v0.3 (round 3): k-means fit is `ctx.call(init)` + `ctx.drive(step)` (no hand loop); a step decides with `ctx.when`;
// linear.fit declares ridge and OLS as a conditional step (`when` + `first`); ridge.augment assembles rows with `ctx.concat`;
// the audit's reference refit declares its slot in `uses`; examples carry `ticks`, `fill`, and implementation-level `examples`.
// Kernel v0.4 (round 4): conditions are relations (`{gt: ['$in.penalty', 0]}`, `ctx.test({eq: [a, b]})`), so the two helper contracts that only
// emitted a boolean are gone; ridge vs ordinary least squares is `{one: [...]}`; k-means fit `collect`s its per-tick state into `history`;
// port schemas carry `x-role` annotations (model, data, rows, selection) that lineage.mjs reads instead of matching contract names.
import { register as registerA } from '../a-numeric/index.mjs';

const num = { type: 'number' };
const int = { type: 'integer' };
const vec = { type: 'array', minItems: 1, items: num };
const mat = { type: 'array', minItems: 1, items: vec };
const ints = { type: 'array', minItems: 1, items: int };

const tagged = (kind, fields) => ({
  type: 'object',
  required: ['kind', ...Object.keys(fields)],
  properties: { kind: { type: 'string', enum: [kind] }, ...fields },
});
// v0.4 port annotations (ignored by validation, read by lineage.mjs): model = holds a fitted model; data = rows a fit learns from
// (or an apply passes through); rows = row indices; selection = a subset of data picked by rows.
const role = (schema, r) => ({ ...schema, 'x-role': r });
export const standardizerModel = tagged('standardizer', { means: vec, sds: vec });
export const linearModel = tagged('linear', { coefficients: vec });
export const kmeansModel = tagged('kmeans', { centroids: mat });
export const constantModel = tagged('constant', { value: num });
const kmeansState = { type: 'object', required: ['centroids', 'labels'], properties: { centroids: mat, labels: ints } };


export function register(world) {
  if (!world.contracts().some((c) => c.id === 'lin.leastSquares')) registerA(world);
  const C = (def) => world.contract(def);
  const I = (def) => world.implement(def);

  // ------------------------------------------------------------------ small matrix helpers
  C({ id: 'fitted.matrix.withIntercept', in: { matrix: mat }, out: { matrix: mat },
    description: 'Prepend a column of ones.',
    examples: [{ in: { matrix: [[5], [6]] }, out: { matrix: [[1, 5], [1, 6]] } }] });
  I({ id: 'fitted.matrix.withIntercept/map', implements: 'fitted.matrix.withIntercept',
    run: ({ matrix }) => ({ matrix: matrix.value.map((row) => [1, ...row]) }) });

  C({ id: 'fitted.rows.select', in: { matrix: mat, rows: role(ints, 'rows') }, out: { matrix: role(mat, 'selection') },
    examples: [{ in: { matrix: [[1, 2], [3, 4], [5, 6]], rows: [2, 0] }, out: { matrix: [[5, 6], [1, 2]] } }] });
  I({ id: 'fitted.rows.select/index', implements: 'fitted.rows.select', run: ({ matrix, rows }) => ({
    matrix: rows.value.map((r) => {
      if (r < 0 || r >= matrix.value.length) throw new Error(`row ${r} out of range 0..${matrix.value.length - 1}`);
      return matrix.value[r];
    }) }) });

  C({ id: 'fitted.values.select', in: { values: vec, rows: role(ints, 'rows') }, out: { values: role(vec, 'selection') },
    examples: [{ in: { values: [10, 20, 30], rows: [1, 2] }, out: { values: [20, 30] } }] });
  I({ id: 'fitted.values.select/index', implements: 'fitted.values.select', run: ({ values, rows }) => ({
    values: rows.value.map((r) => {
      if (r < 0 || r >= values.value.length) throw new Error(`row ${r} out of range 0..${values.value.length - 1}`);
      return values.value[r];
    }) }) });

  C({ id: 'fitted.ridge.augment', in: { matrix: mat, vector: vec, penalty: { type: 'number', minimum: 0 } }, out: { matrix: mat, vector: vec },
    description: 'Ridge as data rows: for a matrix whose column 0 is the intercept column, append sqrt(penalty) times each non-intercept unit row, with target 0. Least squares on the result minimises squared error + penalty * sum(weights^2), intercept unpenalised.',
    examples: [{ in: { matrix: [[1, 5], [1, 6]], vector: [7, 8], penalty: 4 }, out: { matrix: [[1, 5], [1, 6], [0, 2]], vector: [7, 8, 0] } }] });
  I({ id: 'fitted.ridge.augment/rows', implements: 'fitted.ridge.augment', run: ({ matrix, vector, penalty }, ctx) => {
    if (matrix.value.length !== vector.value.length) throw new Error(`${matrix.value.length} rows vs ${vector.value.length} targets`);
    const p = matrix.value[0].length - 1;
    const s = Math.sqrt(penalty.value);
    const extra = Array.from({ length: p }, (_, j) => Array.from({ length: p + 1 }, (_, c) => (c === j + 1 ? s : 0)));
    // v0.3 concat: the first rows/targets keep a path into the input arrays; only the penalty rows are `computed`
    return { matrix: ctx.concat(matrix, extra), vector: ctx.concat(vector, new Array(p).fill(0)) };
  } });

  // ------------------------------------------------------------------ standardizer (fit on columns, apply to rows)
  C({ id: 'fitted.standardizer.fit', in: { matrix: role(mat, 'data') }, out: { model: role(standardizerModel, 'model') }, tolerance: 1e-12,
    description: 'Column means and population standard deviations of the rows given. A constant column is refused.',
    examples: [{ in: { matrix: [[1, 0], [3, 4]] }, out: { model: { kind: 'standardizer', means: [2, 2], sds: [1, 2] } } }] });
  I({ id: 'fitted.standardizer.fit/columns', implements: 'fitted.standardizer.fit',
    uses: ['lin.transpose', 'stat.mean', 'stat.standardDeviation'],
    run: ({ matrix }, ctx) => {
      const cols = ctx.call('lin.transpose', { matrix }).matrix;
      const means = []; const sds = [];
      cols.value.forEach((_, j) => {
        const col = ctx.at(cols, j);
        means.push(ctx.call('stat.mean', { values: col }).value);
        const sd = ctx.call('stat.standardDeviation', { values: col, denominator: ctx.literal('population') }).value;
        if (sd.value === 0) throw new Error(`column ${j} is constant in the rows given to fit; it has no standard score`);
        sds.push(sd);
      });
      return { model: ctx.gather({ kind: ctx.literal('standardizer'), means, sds }) };
    } });

  // DELIBERATELY WRONG: the sample standard deviation (n-1) where the contract says population (n). Carries its own example
  // (v0.3 implementation examples) that pins what it computes, so the bug is an executable fact and not a comment.
  I({ id: 'fitted.standardizer.fit/sample-sd', implements: 'fitted.standardizer.fit', uses: ['lin.transpose', 'stat.mean', 'stat.standardDeviation'],
    description: 'WRONG on purpose: divides by n-1. Exists so that a contract-wide fill can break every standardizer fit at once, to see which audits notice.',
    examples: [{ in: { matrix: [[1], [3]] }, out: { model: { kind: 'standardizer', means: [2], sds: [Math.SQRT2] } } }],
    run: ({ matrix }, ctx) => {
      const cols = ctx.call('lin.transpose', { matrix }).matrix;
      const means = []; const sds = [];
      cols.value.forEach((_, j) => {
        const col = ctx.at(cols, j);
        means.push(ctx.call('stat.mean', { values: col }).value);
        sds.push(ctx.call('stat.standardDeviation', { values: col, denominator: ctx.literal('sample') }).value);
      });
      return { model: ctx.gather({ kind: ctx.literal('standardizer'), means, sds }) };
    } });

  world.select('fitted.standardizer.fit', 'fitted.standardizer.fit/columns');
  world.select('fitted.standardizer.fit', 'fitted.standardizer.fit/columns', 'reference'); // v0.5: a slot select is a pin; a contract-wide fill no longer reaches it (only a path fill, a slot fill or `#*` does)

  C({ id: 'fitted.standardizer.apply', in: { model: role(standardizerModel, 'model'), matrix: role(mat, 'data') }, out: { matrix: role(mat, 'data') }, tolerance: 1e-12,
    examples: [{ in: { model: { kind: 'standardizer', means: [2, 2], sds: [1, 2] }, matrix: [[3, 6], [2, 2]] }, out: { matrix: [[1, 2], [0, 0]] } }] });
  I({ id: 'fitted.standardizer.apply/columns', implements: 'fitted.standardizer.apply',
    uses: ['lin.transpose', 'vec.standardize'],
    run: ({ model, matrix }, ctx) => {
      const cols = ctx.call('lin.transpose', { matrix }).matrix;
      if (cols.value.length !== model.value.means.length) throw new Error(`model has ${model.value.means.length} columns, matrix has ${cols.value.length}`);
      const z = cols.value.map((_, j) => ctx.call('vec.standardize', {
        values: ctx.at(cols, j), center: ctx.at(model, 'means', j), scale: ctx.at(model, 'sds', j),
      }).values);
      return { matrix: ctx.call('lin.transpose', { matrix: ctx.gather(z) }).matrix }; // gather: the transposed rows keep their producers (was `.value`, i.e. `computed`)
    } });

  // DELIBERATELY WRONG: ignores the model it is handed and standardizes with the statistics of the rows it is applying to.
  // Exists so that a slot fill ('fitted.standardizer.apply#test') can inject it at exactly one call site.
  I({ id: 'fitted.standardizer.apply/self-stats', implements: 'fitted.standardizer.apply', uses: ['lin.transpose', 'stat.mean', 'stat.standardDeviation', 'vec.standardize'],
    description: 'WRONG on purpose: refits the statistics on the matrix it is given (a test-time leak) and ignores the model.',
    examples: [{ in: { model: { kind: 'standardizer', means: [2], sds: [1] }, matrix: [[5], [0]] }, out: { matrix: [[1], [-1]] } }], // its own statistics: mean 2.5, sd 2.5
    run: ({ matrix }, ctx) => {
      const cols = ctx.call('lin.transpose', { matrix }).matrix;
      const z = cols.value.map((_, j) => {
        const col = ctx.at(cols, j);
        const mean = ctx.call('stat.mean', { values: col }).value;
        const sd = ctx.call('stat.standardDeviation', { values: col, denominator: ctx.literal('population') }).value;
        return ctx.call('vec.standardize', { values: col, center: mean, scale: sd }).values;
      });
      return { matrix: ctx.call('lin.transpose', { matrix: ctx.gather(z) }).matrix };
    } });
  world.select('fitted.standardizer.apply', 'fitted.standardizer.apply/columns');

  // ------------------------------------------------------------------ linear regression with intercept (penalty 0 = ordinary least squares)
  C({ id: 'fitted.linear.fit', in: { matrix: role(mat, 'data'), targets: role(vec, 'data'), penalty: { type: 'number', minimum: 0 } }, out: { model: role(linearModel, 'model') }, tolerance: 1e-9,
    description: 'Least squares of targets on [1, features]. penalty > 0 adds a ridge penalty on the weights (not the intercept). Model coefficients are [intercept, ...weights].',
    examples: [
      { in: { matrix: [[1], [2], [3]], targets: [2, 4, 6], penalty: 0 }, out: { model: { kind: 'linear', coefficients: [0, 2] } } },
      { in: { matrix: [[1], [2], [3]], targets: [2, 4, 6], penalty: 2 }, out: { model: { kind: 'linear', coefficients: [2, 1] } } },
    ] });
  // v0.5: the guard is written ONCE, on aug. betaRidge reads aug, so it inherits aug's skip (its decision records aug's cause),
  // and betaPlain says `else: ['aug']`, a derived complement. v0.4 needed the same `gt` on aug and betaRidge and a typed `le` on betaPlain.
  world.compose({ id: 'fitted.linear.fit/leastSquares', implements: 'fitted.linear.fit',
    steps: [
      { name: 'x1', call: 'fitted.matrix.withIntercept', bind: { matrix: '$in.matrix' } },
      { name: 'aug', call: 'fitted.ridge.augment', when: { gt: ['$in.penalty', 0] }, bind: { matrix: 'x1.matrix', vector: '$in.targets', penalty: '$in.penalty' } },
      { name: 'betaRidge', call: 'lin.leastSquares', bind: { matrix: 'aug.matrix', vector: 'aug.vector' } },
      { name: 'betaPlain', call: 'lin.leastSquares', when: { else: ['aug'] }, bind: { matrix: 'x1.matrix', vector: '$in.targets' } },
    ],
    returns: { model: { gather: { kind: { literal: 'linear' }, coefficients: { one: ['betaRidge.coefficients', 'betaPlain.coefficients'] } } } } });

  C({ id: 'fitted.linear.apply', in: { model: role(linearModel, 'model'), matrix: mat }, out: { values: vec }, tolerance: 1e-12,
    examples: [{ in: { model: { kind: 'linear', coefficients: [1, 2, 3] }, matrix: [[1, 1], [0, 2]] }, out: { values: [6, 7] } }] });
  world.compose({ id: 'fitted.linear.apply/matvec', implements: 'fitted.linear.apply',
    steps: [
      { name: 'x1', call: 'fitted.matrix.withIntercept', bind: { matrix: '$in.matrix' } },
      { name: 'mv', call: 'lin.matvec', bind: { matrix: 'x1.matrix', vector: { at: ['$in.model', 'coefficients'] } } },
    ],
    returns: { values: 'mv.vector' } });

  // ------------------------------------------------------------------ constant baseline: model is a bare number
  C({ id: 'fitted.constant.fit', in: { values: role(vec, 'data') }, out: { model: role(constantModel, 'model') },
    description: 'The mean of the training targets, as {kind:constant, value}.',
    examples: [{ in: { values: [2, 4, 6] }, out: { model: { kind: 'constant', value: 4 } } }] });
  world.compose({ id: 'fitted.constant.fit/mean', implements: 'fitted.constant.fit',
    steps: [{ name: 'm', call: 'stat.mean', bind: { values: '$in.values' } }],
    returns: { model: { gather: { kind: { literal: 'constant' }, value: 'm.value' } } } });

  C({ id: 'fitted.constant.apply', in: { model: role(constantModel, 'model'), matrix: mat }, out: { values: vec },
    description: 'One copy of the model value per row of matrix. Only the row count of matrix is used.',
    examples: [{ in: { model: { kind: 'constant', value: 4 }, matrix: [[1], [2], [3]] }, out: { values: [4, 4, 4] } }] });
  I({ id: 'fitted.constant.apply/repeat', implements: 'fitted.constant.apply',
    run: ({ model, matrix }) => ({ values: new Array(matrix.value.length).fill(model.value.value) }) });

  // ------------------------------------------------------------------ error measure
  C({ id: 'fitted.vector.squaredErrors', in: { predicted: vec, actual: vec }, out: { values: vec },
    examples: [{ in: { predicted: [1, 2, 3], actual: [1, 4, 0] }, out: { values: [0, 4, 9] } }] });
  I({ id: 'fitted.vector.squaredErrors/map', implements: 'fitted.vector.squaredErrors', run: ({ predicted, actual }) => {
    if (predicted.value.length !== actual.value.length) throw new Error(`${predicted.value.length} predictions vs ${actual.value.length} actuals`);
    return { values: predicted.value.map((p, i) => (p - actual.value[i]) ** 2) };
  } });

  C({ id: 'fitted.error.mse', in: { predicted: vec, actual: vec }, out: { value: num }, tolerance: 1e-12,
    examples: [{ in: { predicted: [1, 2, 3], actual: [1, 4, 0] }, out: { value: 13 / 3 } }] });
  world.compose({ id: 'fitted.error.mse/mean-of-squares', implements: 'fitted.error.mse',
    steps: [
      { name: 'se', call: 'fitted.vector.squaredErrors', bind: { predicted: '$in.predicted', actual: '$in.actual' } },
      { name: 'm', call: 'stat.mean', bind: { values: 'se.values' } },
    ],
    returns: { value: 'm.value' } });

  // ------------------------------------------------------------------ split by group
  C({ id: 'fitted.split.byGroup', in: { groups: ints, period: { type: 'integer', minimum: 2 } },
    out: { trainRows: ints, testRows: ints, testGroups: ints },
    description: 'Whole groups go to one side. Distinct group ids are sorted ascending; those at positions period-1, 2*period-1, ... are test groups. Rows come back in ascending order.',
    examples: [
      { in: { groups: [1, 1, 2, 2, 3, 3], period: 3 }, out: { trainRows: [0, 1, 2, 3], testRows: [4, 5], testGroups: [3] } },
      { in: { groups: [5, 3, 5, 9, 3, 9, 7], period: 2 }, out: { trainRows: [1, 4, 6], testRows: [0, 2, 3, 5], testGroups: [5, 9] } },
    ] });
  I({ id: 'fitted.split.byGroup/sorted-positions', implements: 'fitted.split.byGroup', run: ({ groups, period }) => {
    const distinct = [...new Set(groups.value)].sort((a, b) => a - b);
    const testGroups = distinct.filter((_, i) => i % period.value === period.value - 1);
    if (testGroups.length === 0) throw new Error(`${distinct.length} groups is too few for period ${period.value}: no test group`);
    const isTest = new Set(testGroups);
    const trainRows = []; const testRows = [];
    groups.value.forEach((g, i) => (isTest.has(g) ? testRows : trainRows).push(i));
    return { trainRows, testRows, testGroups };
  } });

  // ------------------------------------------------------------------ k-means
  C({ id: 'fitted.kmeans.assign', in: { matrix: mat, centroids: mat }, out: { labels: ints },
    description: 'Index of the nearest centroid by squared Euclidean distance; ties go to the lower index.',
    examples: [
      { in: { matrix: [[0, 0], [9, 9], [1, 0]], centroids: [[0, 0], [10, 10]] }, out: { labels: [0, 1, 0] } },
      { in: { matrix: [[5, 5]], centroids: [[0, 0], [10, 10]] }, out: { labels: [0] } },
    ] });
  I({ id: 'fitted.kmeans.assign/nearest', implements: 'fitted.kmeans.assign', run: ({ matrix, centroids }) => {
    if (matrix.value[0].length !== centroids.value[0].length) throw new Error('points and centroids differ in dimension');
    return { labels: matrix.value.map((pt) => {
      let best = 0; let bestD = Infinity;
      centroids.value.forEach((c, ci) => {
        const d = c.reduce((s, cv, j) => s + (cv - pt[j]) ** 2, 0);
        if (d < bestD) { bestD = d; best = ci; }
      });
      return best;
    }) };
  } });

  C({ id: 'fitted.kmeans.update', in: { matrix: mat, labels: ints, centroids: mat }, out: { centroids: mat }, tolerance: 1e-12,
    description: 'Each centroid becomes the mean of its members; an empty cluster keeps its previous centroid.',
    examples: [
      { in: { matrix: [[0, 0], [0, 2], [10, 10], [10, 12]], labels: [0, 0, 1, 1], centroids: [[9, 9], [9, 9]] }, out: { centroids: [[0, 1], [10, 11]] } },
      { in: { matrix: [[0, 0], [2, 2]], labels: [0, 0], centroids: [[9, 9], [7, 7]] }, out: { centroids: [[1, 1], [7, 7]] } },
    ] });
  I({ id: 'fitted.kmeans.update/mean', implements: 'fitted.kmeans.update', run: ({ matrix, labels, centroids }) => {
    if (matrix.value.length !== labels.value.length) throw new Error('labels and rows differ in length');
    return { centroids: centroids.value.map((old, ci) => {
      const members = matrix.value.filter((_, i) => labels.value[i] === ci);
      if (members.length === 0) return old;
      return old.map((_, j) => members.reduce((s, m) => s + m[j], 0) / members.length);
    }) };
  } });

  const lexicographic = (a, b) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  C({ id: 'fitted.kmeans.fit', in: { matrix: role(mat, 'data'), k: { type: 'integer', minimum: 1 }, maxIterations: { type: 'integer', minimum: 1 } },
    out: { model: role(kmeansModel, 'model'), iterations: int, converged: { type: 'boolean' }, history: { type: 'array', minItems: 1, items: kmeansState } }, tolerance: 1e-12,
    description: 'Lloyd iterations from k distinct rows drawn with ctx.random. Stops when labels repeat or after maxIterations assignments. The returned centroids are sorted lexicographically so the model does not depend on which row was drawn first.',
    examples: [{ seed: 7, in: { matrix: [[0, 0], [0, 1], [10, 10], [10, 11]], k: 2, maxIterations: 20 },
      out: { model: { kind: 'kmeans', centroids: [[0, 0.5], [10, 10.5]] }, converged: true } }] });
  // ---- k-means as a fold over ticks (kind 'tick'): the same iteration, one run per tick, driven from outside
  C({ id: 'fitted.kmeans.init', in: { matrix: mat, k: { type: 'integer', minimum: 1 } }, out: { state: kmeansState },
    description: 'State before the first tick: k distinct rows drawn with ctx.random as centroids, labels all -1 (not yet assigned).',
    examples: [{ seed: 1, in: { matrix: [[4, 2]], k: 1 }, out: { state: { centroids: [[4, 2]], labels: [-1] } } }] });
  I({ id: 'fitted.kmeans.init/draw', implements: 'fitted.kmeans.init', run: ({ matrix, k }, ctx) => {
    const n = matrix.value.length;
    if (k.value > n) throw new Error(`k=${k.value} but only ${n} rows`);
    const chosen = [];
    while (chosen.length < k.value) { const i = Math.floor(ctx.random() * n); if (!chosen.includes(i)) chosen.push(i); }
    return { state: ctx.gather({ centroids: ctx.gather(chosen.map((i) => ctx.at(matrix, i))), labels: ctx.literal(new Array(n).fill(-1)) }) };
  } });

  C({ id: 'fitted.kmeans.step', kind: 'tick', in: { matrix: mat, state: kmeansState }, out: { state: kmeansState, converged: { type: 'boolean' } }, tolerance: 1e-12,
    description: 'One Lloyd iteration: assign every row to its nearest centroid; if the labels equal the previous labels the state is unchanged and converged is true, otherwise the centroids move to the cluster means.',
    examples: [
      { in: { matrix: [[0, 0], [0, 2], [10, 10], [10, 12]], state: { centroids: [[0, 0], [10, 10]], labels: [-1, -1, -1, -1] } },
        out: { state: { centroids: [[0, 1], [10, 11]], labels: [0, 0, 1, 1] }, converged: false } },
      { in: { matrix: [[0, 0], [0, 2], [10, 10], [10, 12]], state: { centroids: [[0, 1], [10, 11]], labels: [0, 0, 1, 1] } },
        out: { state: { centroids: [[0, 1], [10, 11]], labels: [0, 0, 1, 1] }, converged: true } },
      // v0.5: a trajectory is checked tick by tick inside prove: tick 0 moves the centroids and says not converged, tick 1 sees the labels repeat
      { in: { matrix: [[0, 0], [0, 2], [10, 10], [10, 12]], state: { centroids: [[0, 0], [10, 10]], labels: [-1, -1, -1, -1] } },
        trajectory: [
          { state: { centroids: [[0, 1], [10, 11]], labels: [0, 0, 1, 1] }, converged: false },
          { state: { centroids: [[0, 1], [10, 11]], labels: [0, 0, 1, 1] }, converged: true },
        ] },
    ] });
  // v0.4: "did the assignment change?" is a relation (`eq`) on two Refs, not a contract; the decision names both branches and `converged`
  // forwards the test's own Ref (provenance: eq(assign.labels, state.labels)).
  I({ id: 'fitted.kmeans.step/lloyd', implements: 'fitted.kmeans.step', uses: ['fitted.kmeans.assign', 'fitted.kmeans.update'],
    run: ({ matrix, state }, ctx) => {
      const centroids = ctx.at(state, 'centroids');
      const a = ctx.call('fitted.kmeans.assign', { matrix, centroids });
      const same = ctx.test({ eq: [a.labels, ctx.at(state, 'labels')] });
      const next = ctx.when(same, 'labels unchanged?', { true: 'keep centroids', false: 'update' }) ? centroids : ctx.call('fitted.kmeans.update', { matrix, labels: a.labels, centroids }).centroids;
      return { state: ctx.gather({ centroids: next, labels: a.labels }), converged: same };
    } });

  // v0.3: no hand loop and no duplicated draw. fit = init (seeded) + ctx.drive over the step tick; every iteration is a child node
  // tagged @k, the stop test is `until`, the cap is maxTicks, and `converged` is forwarded as the Ref the last tick made.
  I({ id: 'fitted.kmeans.fit/lloyd', implements: 'fitted.kmeans.fit',
    uses: ['fitted.kmeans.init', 'fitted.kmeans.step'],
    run: ({ matrix, k, maxIterations }, ctx) => {
      const start = ctx.call('fitted.kmeans.init', { matrix, k }).state;
      const d = ctx.drive('fitted.kmeans.step', { matrix, state: start }, { until: (o) => o.converged, maxTicks: maxIterations.value, collect: ['state'] });
      // sort the centroid Refs (each an `at` into the last tick's state) and gather them back
      const sorted = d.state.value.centroids.map((_, ci) => ctx.at(d.state, 'centroids', ci)).sort((x, y) => lexicographic(x.value, y.value));
      return { model: ctx.gather({ kind: ctx.literal('kmeans'), centroids: ctx.gather(sorted) }), iterations: d.ticks, converged: d.converged, history: d.collected.state };
    } });

  C({ id: 'fitted.kmeans.predict', in: { model: role(kmeansModel, 'model'), matrix: mat }, out: { labels: ints },
    examples: [{ in: { model: { kind: 'kmeans', centroids: [[0, 0], [10, 10]] }, matrix: [[1, 1], [9, 8]] }, out: { labels: [0, 1] } }] });
  world.compose({ id: 'fitted.kmeans.predict/nearest', implements: 'fitted.kmeans.predict',
    steps: [{ name: 'a', call: 'fitted.kmeans.assign', bind: { matrix: '$in.matrix', centroids: { at: ['$in.model', 'centroids'] } } }],
    returns: { labels: 'a.labels' } });

  // ------------------------------------------------------------------ pipelines
  const pipelineIn = { matrix: mat, targets: vec, groups: ints, period: { type: 'integer', minimum: 2 }, penalty: { type: 'number', minimum: 0 } };
  C({ id: 'fitted.pipeline.regression', in: pipelineIn,
    out: { predictions: vec, mse: num, baselineMse: num, testRows: ints, standardizer: standardizerModel, regression: linearModel },
    tolerance: 1e-9,
    description: 'split by group -> fit standardizer on TRAIN rows -> standardize train and test -> fit regression on standardized train -> predict standardized test -> mean squared error, with the train-mean constant as baseline.',
    examples: [
      { // x = 0,2,4,6 | 8,10 ; y = 2x+1 ; train mean 3, population sd sqrt(5); y = 7 + 2 sqrt(5) z ; test predictions are exact
        in: { matrix: [[0], [2], [4], [6], [8], [10]], targets: [1, 5, 9, 13, 17, 21], groups: [1, 1, 2, 2, 3, 3], period: 3, penalty: 0 },
        out: { predictions: [17, 21], mse: 0, baselineMse: 148, testRows: [4, 5],
          standardizer: { kind: 'standardizer', means: [3], sds: [Math.sqrt(5)] }, regression: { kind: 'linear', coefficients: [7, 2 * Math.sqrt(5)] } } },
      { // train x = 1,1,3,3 (mean 2, sd 1), y = 3,3,7,7; ridge penalty 4: weight = 8/(4+4) = 1, intercept 5; test x = 5,0 -> z = 3,-2 -> 8,3 ; actual 11,1
        in: { matrix: [[1], [1], [3], [3], [5], [0]], targets: [3, 3, 7, 7, 11, 1], groups: [1, 1, 2, 2, 3, 3], period: 3, penalty: 4 },
        out: { predictions: [8, 3], mse: 6.5, baselineMse: 26, testRows: [4, 5],
          standardizer: { kind: 'standardizer', means: [2], sds: [1] }, regression: { kind: 'linear', coefficients: [5, 1] } } },
    ] });

  // ------------------------------------------------------------------ audit as a check (kernel v0.2 kind 'check')
  C({ id: 'fitted.audit.standardizer', kind: 'check', in: { model: standardizerModel, matrix: mat }, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
    description: 'Accepts when the standardizer model equals the column means and population standard deviations of the rows given (compared to 1e-9). A model fitted on other rows is rejected.',
    examples: [
      { in: { model: { kind: 'standardizer', means: [2], sds: [1] }, matrix: [[1], [1], [3], [3]] }, out: { accepted: true, reason: 'standardizer matches the statistics of the 4 rows given' } },
      { in: { model: { kind: 'standardizer', means: [0], sds: [1] }, matrix: [[1], [1], [3], [3]] }, out: { accepted: false, reason: 'column 0: model has mean 0 sd 1, the rows have mean 2 sd 1' } },
    ] });
  // v0.3: the refit is a REFERENCE computation, so it calls the standardizer fit at a declared slot. A fill can then pin that one
  // call site ('fitted.standardizer.fit#reference') while another fill breaks every other fit. Calling it with no slot is UNDECLARED_SLOT.
  I({ id: 'fitted.audit.standardizer/refit', implements: 'fitted.audit.standardizer', uses: ['fitted.standardizer.fit#reference'],
    run: ({ model, matrix }, ctx) => {
      const own = ctx.call('fitted.standardizer.fit', { matrix }, { slot: 'reference' }).model.value;
      const f = (v) => Number(v.toPrecision(6)); // six significant digits: a reason string has no tolerance, so it must not carry last-digit noise
      for (let j = 0; j < own.means.length; j += 1) {
        const m = model.value.means[j]; const sd = model.value.sds[j];
        if (m === undefined || Math.abs(m - own.means[j]) > 1e-9 || Math.abs(sd - own.sds[j]) > 1e-9) {
          return { accepted: false, reason: `column ${j}: model has mean ${f(m)} sd ${f(sd)}, the rows have mean ${f(own.means[j])} sd ${f(own.sds[j])}` };
        }
      }
      if (model.value.means.length !== own.means.length) return { accepted: false, reason: `model has ${model.value.means.length} columns, the rows have ${own.means.length}` };
      return { accepted: true, reason: `standardizer matches the statistics of the ${matrix.value.length} rows given` };
    } });

  world.select('fitted.audit.standardizer', 'fitted.audit.standardizer/refit');

  C({ id: 'fitted.audit.pipeline', kind: 'check', in: pipelineIn, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
    description: 'Runs the regression pipeline, then checks that the standardizer it fitted equals the statistics of the TRAIN rows. Same inputs as the pipeline; fill the pipeline contract to audit another implementation.',
    examples: [
      { in: { matrix: [[1], [1], [3], [3], [5], [0]], targets: [3, 3, 7, 7, 11, 1], groups: [1, 1, 2, 2, 3, 3], period: 3, penalty: 4 },
        out: { accepted: true, reason: 'standardizer matches the statistics of the 4 rows given' } },
      // v0.3: an example may carry a fill. Hand derivation: all six rows [1,1,3,3,5,0] have mean 13/6 and variance 45/6 - (13/6)^2, so the leaky
      // standardizer has mean 2.16667 and sd 1.67498 (2.8056 = 7.5 - 4.6944, square root 1.67498); the train rows [1,1,3,3] have mean 2 and sd 1.
      { in: { matrix: [[1], [1], [3], [3], [5], [0]], targets: [3, 3, 7, 7, 11, 1], groups: [1, 1, 2, 2, 3, 3], period: 3, penalty: 4 },
        fill: { 'fitted.pipeline.regression': 'fitted.pipeline.regression/leaky' },
        out: { accepted: false, reason: 'column 0: model has mean 2.16667 sd 1.67498, the rows have mean 2 sd 1' } },
    ] });
  world.compose({ id: 'fitted.audit.pipeline/train-rows', implements: 'fitted.audit.pipeline',
    steps: [
      { name: 'run', call: 'fitted.pipeline.regression', bind: { matrix: '$in.matrix', targets: '$in.targets', groups: '$in.groups', period: '$in.period', penalty: '$in.penalty' } },
      { name: 'split', call: 'fitted.split.byGroup', bind: { groups: '$in.groups', period: '$in.period' } },
      { name: 'xTrain', slot: 'train', call: 'fitted.rows.select', bind: { matrix: '$in.matrix', rows: 'split.trainRows' } },
      { name: 'audit', call: 'fitted.audit.standardizer', bind: { model: 'run.standardizer', matrix: 'xTrain.matrix' } },
    ],
    returns: { accepted: 'audit.accepted', reason: 'audit.reason' } });

  const pipeline = (id, stdSource, description) => world.compose({ id, implements: 'fitted.pipeline.regression', description,
    steps: [
      { name: 'split', call: 'fitted.split.byGroup', bind: { groups: '$in.groups', period: '$in.period' } },
      { name: 'xTrain', slot: 'train', call: 'fitted.rows.select', bind: { matrix: '$in.matrix', rows: 'split.trainRows' } },
      { name: 'xTest', slot: 'test', call: 'fitted.rows.select', bind: { matrix: '$in.matrix', rows: 'split.testRows' } },
      { name: 'yTrain', slot: 'train', call: 'fitted.values.select', bind: { values: '$in.targets', rows: 'split.trainRows' } },
      { name: 'yTest', slot: 'test', call: 'fitted.values.select', bind: { values: '$in.targets', rows: 'split.testRows' } },
      { name: 'std', call: 'fitted.standardizer.fit', bind: { matrix: stdSource } },
      { name: 'zTrain', slot: 'train', call: 'fitted.standardizer.apply', bind: { model: 'std.model', matrix: 'xTrain.matrix' } },
      { name: 'zTest', slot: 'test', call: 'fitted.standardizer.apply', bind: { model: 'std.model', matrix: 'xTest.matrix' } },
      { name: 'reg', call: 'fitted.linear.fit', bind: { matrix: 'zTrain.matrix', targets: 'yTrain.values', penalty: '$in.penalty' } },
      { name: 'pred', call: 'fitted.linear.apply', bind: { model: 'reg.model', matrix: 'zTest.matrix' } },
      { name: 'err', slot: 'model', call: 'fitted.error.mse', bind: { predicted: 'pred.values', actual: 'yTest.values' } },
      { name: 'base', call: 'fitted.constant.fit', bind: { values: 'yTrain.values' } },
      { name: 'basePred', call: 'fitted.constant.apply', bind: { model: 'base.model', matrix: 'xTest.matrix' } },
      { name: 'baseErr', slot: 'baseline', call: 'fitted.error.mse', bind: { predicted: 'basePred.values', actual: 'yTest.values' } },
    ],
    returns: { predictions: 'pred.values', mse: 'err.value', baselineMse: 'baseErr.value', testRows: 'split.testRows', standardizer: 'std.model', regression: 'reg.model' } });
  pipeline('fitted.pipeline.regression/train-only', 'xTrain.matrix', 'Standardizer fitted on the train rows only.');
  pipeline('fitted.pipeline.regression/leaky', '$in.matrix', 'DELIBERATELY WRONG: standardizer fitted on all rows, test rows included. Exists to show that the contract examples and the trace can catch it.');
  world.select('fitted.pipeline.regression', 'fitted.pipeline.regression/train-only');
}
