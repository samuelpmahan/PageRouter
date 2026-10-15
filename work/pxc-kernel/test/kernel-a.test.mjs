import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';
import { register } from '../contest/a-numeric/index.mjs';

const fresh = () => { const w = createWorld({ name: 'a' }); register(w); return w; };

test('every contract example proves against every implementation', () => {
  const w = fresh();
  const proofs = w.contracts().flatMap((c) => w.prove(c.id));
  const failing = proofs.filter((p) => !p.ok);
  assert.deepEqual(failing, []);
  assert.ok(proofs.some((p) => p.impl === 'stat.variance/welford'), 'second variance implementation is proven too');
});

test('composition records exact bindings, including literals and paths', () => {
  const w = fresh();
  const r = w.run('stat.zScores', { values: [2, 4, 6] });
  const [mean, sd, z] = r.trace.calls;
  assert.equal(mean.contract, 'stat.mean');
  assert.deepEqual(mean.in.values.from, { kind: 'input', call: r.trace.id, port: 'values' });
  assert.deepEqual(sd.in.denominator.from, { kind: 'literal' });
  assert.deepEqual(z.in.center.from, { kind: 'call', call: mean.id, port: 'value' });
  assert.deepEqual(z.in.scale.from, { kind: 'call', call: sd.id, port: 'value' });
  const rows = w.run('lin.matvec', { matrix: [[1, 2], [3, 4]], vector: [1, 1] }).trace.calls;
  assert.deepEqual(rows[1].in.a.from, { kind: 'at', of: { kind: 'input', call: rows[1].id - 2, port: 'matrix' }, path: [1] });
});

test('assembly lint rejects bad wiring before anything runs', () => {
  const w = fresh();
  assert.throws(() => w.compose({ id: 'bad', implements: 'stat.zScores', steps: [
    { name: 'm', call: 'stat.mean', bind: { values: 'later.values' } },
  ], returns: { values: 'm.value' } }), (e) => e.code === 'ASSEMBLY_LINT' && e.detail.length >= 3);
});

test('undeclared calls fail and ambiguous contracts refuse to guess', () => {
  const w = createWorld();
  w.contract({ id: 'x', in: {}, out: { v: { type: 'number' } } });
  w.contract({ id: 'y', in: {}, out: { v: { type: 'number' } } });
  w.implement({ id: 'y/1', implements: 'y', run: () => ({ v: 1 }) });
  w.implement({ id: 'x/sneaky', implements: 'x', run: (_, ctx) => ({ v: ctx.call('y', {}).v.value }) });
  assert.throws(() => w.run('x', {}), (e) => e.code === 'UNDECLARED_CALL');
  w.implement({ id: 'y/2', implements: 'y', run: () => ({ v: 2 }) });
  assert.throws(() => w.run('y', {}), (e) => e.code === 'AMBIGUOUS');
  assert.equal(w.run('y', {}, { fill: { y: 'y/2' } }).outputs.v, 2);
});

test('cache reuses identical sub-calls and replay is exact', () => {
  const w = fresh();
  const a = w.run('lin.leastSquares', { matrix: [[1, 0], [1, 1], [1, 2], [1, 3]], vector: [1, 3, 5, 7] });
  assert.ok(Math.abs(a.outputs.coefficients[0] - 1) < 1e-9 && Math.abs(a.outputs.coefficients[1] - 2) < 1e-9);
  const b = w.run('lin.leastSquares', { matrix: [[1, 0], [1, 1], [1, 2], [1, 3]], vector: [1, 3, 5, 7] });
  assert.equal(b.trace.cached, true);
  const rep = w.replay(a.receipt);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
});

test('ablation: swapping the variance implementation changes the trace, not the answer', () => {
  const w = fresh();
  const two = w.run('stat.zScores', { values: [1, 2, 3, 4] }, { cache: false });
  const wel = w.run('stat.zScores', { values: [1, 2, 3, 4] }, { cache: false, fill: { 'stat.variance': 'stat.variance/welford' } });
  assert.equal(two.trace.calls[1].calls[0].impl, 'stat.variance/two-pass');
  assert.equal(wel.trace.calls[1].calls[0].impl, 'stat.variance/welford');
  two.outputs.values.forEach((v, i) => assert.ok(Math.abs(v - wel.outputs.values[i]) < 1e-12));
});
