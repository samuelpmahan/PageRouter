// One test matrix per domain, on patterns/matrix.mjs. Each `expect` is the prediction, written before the matrix was first run.
// Run: node patterns/matrices.mjs [name...]  → patterns/out/matrix-<name>.png; exits non-zero when any cell surprises its prediction.
import { createWorld } from '../src/kernel.mjs';
import { matrix } from './matrix.mjs';
import { snap } from './flipbook.mjs';
import { register as numeric } from '../contest/a-numeric/index.mjs';
import { register as circuits, registerFaults, bitsOf, intOf } from '../contest/b-circuits/index.mjs';
import { register as fitted } from '../contest/c-fitted/index.mjs';
import { regressionData } from '../contest/c-fitted/data.mjs';
import { register as explain, DATA } from '../contest/d-explain/index.mjs';
import { register as game, playMatch, POLICY_NAMES } from '../contest/e-game/index.mjs';
import { register as agents, runDrive, initialState, config } from '../contest/f-agents/index.mjs';

const world = (...registers) => { const w = createWorld(); registers.forEach((r) => r(w)); return w; };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const previous = (values, v) => values[values.indexOf(v) - 1];
const M = {};

// ---- numeric: least squares of y = 1 + slope·x over n points, with and without a fixed noise pattern.
{
  const w = world(numeric);
  const ns = [3, 4, 5, 6, 8]; const slopes = [-2, -1, 0, 1, 2];
  M.numeric = () => matrix({
    title: 'lin.leastSquares: fit y = 1 + slope·x through n points',
    rows: { name: 'n', values: ns }, cols: { name: 'slope', values: slopes }, panels: { name: 'noise', values: [0, 0.3] },
    run: ({ n, slope, noise }) => {
      const xs = [...Array(n).keys()];
      const ys = xs.map((x) => 1 + slope * x + noise * ((((x * 37) % 11) - 5) / 5));
      const X = xs.map((x) => [1, x]);
      const r = w.run('lin.leastSquares', { matrix: X, vector: ys });
      return { value: { beta: r.outputs.coefficients, X, ys }, runs: [r.receipt.runId] };
    },
    show: ({ beta }) => `${beta[0].toFixed(2)}, ${beta[1].toFixed(2)}`, shows: 'intercept, slope as fitted',
    checks: {
      'residual is perpendicular to every column (normal equations)': ({ beta, X, ys }) => [0, 1].every((j) => near(X.reduce((s, row, i) => s + row[j] * (ys[i] - row[0] * beta[0] - row[1] * beta[1]), 0), 0)),
      'recovers intercept 1 and the true slope': ({ beta }, { slope }) => near(beta[0], 1) && near(beta[1], slope),
    },
    expect: ({ noise }) => noise === 0, // noise moves the fit off the truth; the normal equations hold either way
  });
}

// ---- circuits: the 4-bit adder over every a × b, real and with bit 2's carry stuck at 0.
{
  const w = world(circuits, registerFaults);
  const nib = [...Array(16).keys()];
  M.circuits = () => matrix({
    title: 'adder.ripple4: a + b (carry in 0)',
    rows: { name: 'a', values: nib }, cols: { name: 'b', values: nib },
    panels: { name: 'full adder at bit 2', values: ['adder.full/two-half', 'adder.full/carry-stuck-0'] },
    run: ({ a, b, 'full adder at bit 2': impl }) => {
      const r = w.run('adder.ripple4', { a: bitsOf(a, 4), b: bitsOf(b, 4), cin: 0 }, { fill: { 'adder.full#bit2': impl } });
      return { value: intOf(r.outputs.sum) + 16 * r.outputs.cout, runs: [r.receipt.runId] };
    },
    shows: 'sum as a number (sum bits + 16 × carry out)',
    checks: { 'equals a + b': (got, { a, b }) => got === a + b },
    // stuck carry is wrong exactly when bits 0..2 carry out of bit 2: (a mod 8) + (b mod 8) ≥ 8, which is 28 of 64 low pairs × 4 = 112 cells
    expect: ({ a, b, 'full adder at bit 2': impl }) => impl === 'adder.full/two-half' || (a % 8) + (b % 8) < 8,
  });
}

// ---- fitted models: ridge regression, penalty against training-set size.
{
  const w = world(fitted);
  const penalties = [0, 0.5, 2, 8, 32]; const sizes = [12, 24, 48];
  M.fitted = () => matrix({
    title: 'fitted.linear.fit: ridge penalty against training rows (true weight 0.75)',
    rows: { name: 'penalty', values: penalties }, cols: { name: 'rows', values: sizes },
    run: ({ penalty, rows }) => {
      const { matrix: X, targets } = regressionData({ rows });
      const fit = w.run('fitted.linear.fit', { matrix: X, targets, penalty });
      const pred = w.run('fitted.linear.apply', { model: fit.outputs.model, matrix: X });
      const err = w.run('fitted.error.mse', { predicted: pred.outputs.values, actual: targets });
      return { value: { weight: fit.outputs.model.coefficients[1], error: err.outputs.value }, runs: [fit, pred, err].map((r) => r.receipt.runId) };
    },
    show: ({ weight, error }) => `${weight.toFixed(3)} / ${error.toFixed(3)}`, shows: 'fitted weight / training error',
    checks: {
      'weight shrinks as the penalty grows': ({ weight }, { penalty }, get) => penalty === 0 || Math.abs(weight) <= Math.abs(get({ penalty: previous(penalties, penalty) }).weight) + 1e-12,
      'training error grows as the penalty grows': ({ error }, { penalty }, get) => penalty === 0 || error >= get({ penalty: previous(penalties, penalty) }).error - 1e-12,
      'no penalty: weight within 0.05 of 0.75': ({ weight }, { penalty }) => penalty !== 0 || near(weight, 0.75, 0.05),
    },
  });
}

// ---- explanations: attribution over a grid of inputs, with the correct predictor and the one capped at 130.
{
  const w = world(explain);
  const model = w.run('explain.fit', { features: DATA.features, rows: DATA.rows, targets: DATA.targets }).outputs.model;
  const baseline = w.run('explain.baselineMeans', { rows: DATA.rows }).outputs.baseline;
  const raw = (input) => model.coefficients[0] + input.reduce((s, x, i) => s + model.coefficients[i + 1] * x, 0);
  const grid = [1, 2, 3, 4, 5, 6, 7, 8];
  M.explain = () => matrix({
    title: `explain.attribute: size × distance (age ${DATA.input[2]}), contributions against the column means`,
    rows: { name: 'size', values: grid }, cols: { name: 'distance', values: grid },
    panels: { name: 'predictor', values: ['explain.predict/dot', 'explain.predict/capped'] },
    run: ({ size, distance, predictor }) => {
      const r = w.run('explain.attribute', { model, input: [size, distance, DATA.input[2]], baseline }, { fill: { 'explain.predict': predictor } });
      return { value: r.outputs, runs: [r.receipt.runId] };
    },
    show: (o) => o.prediction.toFixed(0), shows: 'prediction',
    checks: { 'baseline prediction + contributions = prediction': (o) => near(o.baselinePrediction + o.contributions.reduce((s, c) => s + c, 0), o.prediction, 1e-6) },
    // the cap only bites where the true prediction is above 130 (the baseline prediction is below it)
    expect: ({ size, distance, predictor }) => predictor === 'explain.predict/dot' || raw([size, distance, DATA.input[2]]) <= 130,
  });
}

// ---- game: every policy against every policy; a pairing with random plays seeds 1..8.
{
  const w = world(game);
  M.game = () => matrix({
    title: 'match.play: X policy (rows) against O policy (columns)',
    rows: { name: 'X', values: POLICY_NAMES }, cols: { name: 'O', values: POLICY_NAMES },
    run: ({ X, O }) => {
      const seeds = X === 'random' || O === 'random' ? [1, 2, 3, 4, 5, 6, 7, 8] : [1];
      const games = seeds.map((seed) => playMatch(w, X, O, { seed }));
      const count = (s) => games.filter((g) => g.status === s).length;
      return { value: { x: count('X'), draw: count('draw'), o: count('O'), longest: Math.max(...games.map((g) => g.moves.length)) }, runs: games.map((g) => g.receipt.runId) };
    },
    show: (v) => `${v.x} / ${v.draw} / ${v.o}`, shows: 'X wins / draws / O wins',
    checks: {
      'minimax never loses': (v, { X, O }) => (X !== 'minimax' || v.o === 0) && (O !== 'minimax' || v.x === 0),
      'every game ends within 9 moves': (v) => v.longest <= 9,
    },
  });
}

// ---- agents: frontier N against integration time, for both demand gates.
{
  const w = world(agents);
  const Ns = [1, 2, 3, 4, 6]; const integration = [1, 2, 3, 4];
  M.agents = () => matrix({
    title: 'agents.tick driven to the end: frontier N against integration ticks',
    rows: { name: 'N', values: Ns }, cols: { name: 'integration ticks', values: integration }, panels: { name: 'gate', values: ['reserve', 'literal'] },
    run: ({ N, 'integration ticks': t, gate }) => {
      const d = runDrive(w, initialState(), config(N, { gate, integrationTicks: t }), { allowUnfinished: true });
      return { value: { ticks: d.receipts.length, finished: d.final.finished, backlog: Math.max(...d.series.map((c) => c.done)) }, runs: d.receipts.map((r) => r.runId) };
    },
    show: (v) => `${v.ticks} · ${v.backlog}`, shows: 'ticks to finish · largest backlog of completed, unintegrated tasks',
    checks: { 'finishes': (v) => v.finished, 'backlog never above N': (v, { N }) => v.backlog <= N },
    // reserve counts running tasks against N, so it cannot overshoot; literal starts every ready task while done < N, so no prediction
    expect: ({ gate }) => (gate === 'reserve' ? true : undefined),
  });
}

const pick = process.argv.slice(2);
let surprises = 0;
for (const [name, make] of Object.entries(M)) {
  if (pick.length && !pick.includes(name)) continue;
  const t0 = Date.now();
  const m = make();
  snap(m.html, `patterns/out/matrix-${name}`, { title: name, width: 600 });
  surprises += m.surprises.length;
  console.log(`${name}: ${m.cells.length} cells, ${m.failures.length} fail, ${m.surprises.length} surprise${m.surprises.length === 1 ? '' : 's'} (${Date.now() - t0} ms)`
    + m.surprises.slice(0, 5).map((c) => `\n   surprise at ${JSON.stringify(c.at)}: ${c.ok ? 'passed' : `failed ${c.failed.join(', ')}`}, shows ${c.shown}`).join(''));
}
process.exit(surprises ? 1 : 0);
