// The test matrix piece: neighbour checks, predictions (including "no prediction"), and a grid that can be shot row by row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matrix } from '../patterns/matrix.mjs';
import { shoot, problems } from '../patterns/flipbook.mjs';

const square = (expect) => matrix({
  title: 'x × y', rows: { name: 'x', values: [1, 2, 3] }, cols: { name: 'y', values: [1, 2] },
  run: ({ x, y }) => ({ value: x * y - (x === 3 && y === 2 ? 1 : 0), runs: [`r${x}${y}`] }), // one planted mistake at x 3, y 2
  checks: { 'equals x·y': (v, { x, y }) => v === x * y, 'grows with x': (v, { x }, get) => x === 1 || v > get({ x: x - 1 }) },
  ...(expect ? { expect } : {}),
});

test('cells keep their runs, neighbour checks read the neighbour, failures name their checks', () => {
  const m = square();
  assert.equal(m.cells.length, 6);
  assert.deepEqual(m.cells.find((c) => c.at.x === 2 && c.at.y === 1).runs, ['r21']);
  const bad = m.failures.map((c) => [c.at, c.failed]);
  assert.deepEqual(bad, [[{ x: 3, y: 2 }, ['equals x·y']]]); // 5 > 4 still grows, so only the first check fails
  assert.equal(m.surprises.length, 1); // the default prediction is "every cell passes"
});

test('a prediction turns an expected failure into no surprise; undefined makes no prediction', () => {
  assert.equal(square(({ x, y }) => !(x === 3 && y === 2)).surprises.length, 0);
  assert.equal(square(({ x }) => (x === 3 ? undefined : true)).surprises.length, 0);
  assert.equal(square(() => false).surprises.length, 5);
});

test('the grid is a flip book: adding a row moves nothing already drawn', { timeout: 120000 }, () => {
  const m = square();
  const report = shoot({ title: 'rows', steps: [0, 1, 2].map((k) => ({ label: `rows ≤ ${k}`, state: k })), render: (k) => m.upToRow(k) }, 'patterns/out/test-matrix-rows', { width: 400 });
  assert.deepEqual(problems(report), []);
});
