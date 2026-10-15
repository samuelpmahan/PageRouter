import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, KernelError } from '../src/kernel.mjs';
import { register, DATA, CLAIMS, resolvePointer, checkNodes, findCall, judgedCalls } from '../contest/d-explain/index.mjs';

const fresh = () => { const w = createWorld({ name: 'd-explain' }); register(w); return w; };
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);

// The worked example, derived from the generating definition price = 50 + 20*size - 4*distance + 0*age:
// column means (2.625, 2.375, 2.625); baseline prediction = mean of targets = 744/8 = 93;
// input (4, 6, 9): contributions 20*1.375 = 27.5, -4*3.625 = -14.5, 0*6.375 = 0; prediction 106.
function story(w = fresh()) {
  const fit = w.run('explain.fit', { features: DATA.features, rows: DATA.rows, targets: DATA.targets });
  const base = w.run('explain.baselineMeans', { rows: DATA.rows });
  const model = fit.outputs.model; const baseline = base.outputs.baseline;
  const exp = w.run('explain.explain', { model, input: DATA.input, baseline, tolerance: DATA.tolerance });
  return { w, fit, base, model, baseline, exp };
}
const claimInputs = (s, claim, over = {}) => ({ claim, model: s.model, input: DATA.input, baseline: s.baseline,
  prediction: s.exp.outputs.prediction, contributions: s.exp.outputs.contributions, tolerance: DATA.tolerance, ...over });

test('every example proves; only the deliberately wrong and the throwing implementations fail, and only where expected', () => {
  const w = fresh();
  const failing = w.contracts().flatMap((c) => w.prove(c.id)).filter((p) => !p.ok).map((p) => `${p.impl}#${p.example}`);
  assert.deepEqual(failing, ['explain.contributions/no-baseline#0', 'explain.contributions/no-baseline#1', 'explain.checkReconstruction/throwing#1', 'explain.sweepStep/saturating#three ticks, every prediction']);
});

test('fit recovers the generating coefficients through lin.leastSquares; baseline is the column means', () => {
  const { fit, base, w } = story();
  [50, 20, -4, 0].forEach((b, i) => near(fit.outputs.model.coefficients[i], b, 1e-9));
  assert.deepEqual(fit.outputs.model.features, ['size', 'distance', 'age']);
  assert.deepEqual(base.outputs.baseline, [2.625, 2.375, 2.625]);
  const ls = fit.trace.calls.find((c) => c.contract === 'lin.leastSquares');
  assert.ok(ls, 'the fit went through contest A, visible in the trace');
  assert.equal(ls.in.matrix.from.kind, 'call', 'design matrix reaches leastSquares by exact binding');
  assert.equal(w.stats().runs, 3, 'fit, baselineMeans and explain');
});

test('attribution: contributions are b_i (x_i - baseline_i), and baseline + sum reconstructs the prediction', () => {
  const { exp } = story();
  near(exp.outputs.baselinePrediction, 93);
  near(exp.outputs.prediction, 106);
  [27.5, -14.5, 0].forEach((c, i) => near(exp.outputs.contributions[i], c));
  assert.equal(exp.outputs.accepted, true);
  assert.ok(Math.abs(exp.outputs.residual) < 1e-9);
  assert.match(exp.outputs.reason, /^reconstructs:/);
  // exact wiring: the check reads the attribution's own outputs, not copies
  const [attr, rec] = exp.trace.calls;
  assert.deepEqual(rec.in.contributions.from, { kind: 'call', call: attr.id, port: 'contributions' });
  assert.deepEqual(rec.in.prediction.from, { kind: 'call', call: attr.id, port: 'prediction' });
  assert.deepEqual(rec.in.tolerance.from, { kind: 'input', call: exp.trace.id, port: 'tolerance' });
});

test('a tampered attribution is rejected by the reconstruction check, and the run still completes (a verdict is a value)', () => {
  const { w, exp } = story();
  const before = w.runs().length;
  const r = w.run('explain.checkReconstruction', { baselinePrediction: exp.outputs.baselinePrediction, contributions: [27.5, -14.5, 3], prediction: exp.outputs.prediction, tolerance: DATA.tolerance });
  assert.equal(r.outputs.accepted, false);
  near(r.outputs.residual, -3, 1e-9);
  assert.match(r.outputs.reason, /^does not reconstruct:/);
  assert.equal(w.runs().length, before + 1, 'the rejecting run is recorded like any other');
});

test('perturbation: changing one feature changes the prediction by exactly that feature\'s change in contribution', () => {
  const { w, model, baseline } = story();
  const expected = { size: 20, distance: -4, age: 0 }; // b_k * delta with delta = 1
  for (const f of DATA.features) {
    const r = w.run('explain.perturbAndCheck', { model, input: DATA.input, baseline, feature: f, delta: 1, tolerance: DATA.tolerance });
    assert.equal(r.outputs.accepted, true, f);
    near(r.outputs.predictionChange, expected[f], 1e-9);
    near(r.outputs.contributionChange, expected[f], 1e-9);
  }
});

test('"feature k does not matter" is rejected for distance and accepted for age, with the real change in the reason', () => {
  const s = story();
  const distance = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'distance', delta: 2, expectedChange: 0 }));
  assert.equal(distance.outputs.accepted, false);
  near(distance.outputs.residual, 8, 1e-9); // claimed 0 minus actual -8
  assert.match(distance.outputs.reason, /claimed 0, actual -8, difference 8 exceeds tolerance/);
  const age = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'age', delta: 5, expectedChange: 0 }));
  assert.equal(age.outputs.accepted, true);
});

test('claim table: every honest claim is accepted and every fabricated claim is rejected, each with a reason', () => {
  const s = story();
  assert.ok(CLAIMS.filter((c) => !c.honest).length >= 3);
  for (const entry of CLAIMS) {
    const r = s.w.run('explain.checkClaim', claimInputs(s, entry.claim));
    assert.equal(r.outputs.accepted, entry.honest, `${entry.text}: ${r.outputs.reason}`);
    assert.ok(r.outputs.reason.length > 10);
  }
});

test('rejection reasons are specific: wrong sign, wrong feature name, value that belongs to another feature, vacuous', () => {
  const s = story();
  const why = (claim) => s.w.run('explain.checkClaim', claimInputs(s, claim)).outputs.reason;
  assert.match(why({ kind: 'contribution', feature: 'distance', value: 14.5 }), /\(wrong sign\)/);
  assert.match(why({ kind: 'contribution', feature: 'weight', value: 3 }), /unknown feature 'weight'; the model has size, distance, age/);
  assert.match(why({ kind: 'contribution', feature: 'distance', value: 27.5 }), /contribution of 'size', not 'distance'/);
  assert.match(why({ kind: 'effect', feature: 'age', delta: 0, expectedChange: 0 }), /^vacuous/);
  assert.match(why({ kind: 'effect', feature: 'size', delta: 1, expectedChange: -20 }), /\(wrong sign\)/);
});

test('mutation: dropping the baseline is caught by the reconstruction check but NOT by the perturbation check', () => {
  const s = story();
  const fill = { 'explain.contributions': 'explain.contributions/no-baseline' };
  const bad = s.w.run('explain.explain', { model: s.model, input: DATA.input, baseline: s.baseline, tolerance: DATA.tolerance }, { fill, cache: false });
  assert.equal(bad.outputs.accepted, false);
  assert.equal(bad.trace.calls[0].calls[2].impl, 'explain.contributions/no-baseline');
  const pert = s.w.run('explain.perturbAndCheck', { model: s.model, input: DATA.input, baseline: s.baseline, feature: 'size', delta: 1, tolerance: DATA.tolerance }, { fill, cache: false });
  assert.equal(pert.outputs.accepted, true, 'the baseline term cancels in a difference, so this check is blind to the bug');
});

test('a check result points at the Parts it judged: hashes equal the trace input hashes, and resolve to the values', () => {
  const s = story();
  const r = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'distance', value: -14.5 }));
  const j = r.outputs.judged;
  assert.equal(j.claim.hash, r.trace.in.claim.hash);
  assert.equal(j.contributions.hash, r.trace.in.contributions.hash);
  assert.deepEqual(j.contributions.path, [1]);
  assert.equal(resolvePointer(s.w, j.contributions), r.outputs.accepted && s.exp.outputs.contributions[1]);
  assert.deepEqual(resolvePointer(s.w, j.claim), { kind: 'contribution', feature: 'distance', value: -14.5 });
  assert.equal(j.model, undefined, 'a contribution claim does not judge the model, so the model is not listed');
  const eff = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'size', delta: 1, expectedChange: 20 }));
  assert.deepEqual(Object.keys(eff.outputs.judged).sort(), ['baseline', 'claim', 'input', 'model']);
});

test('a check attaches to an earlier run EXACTLY: a cross-run Ref records run and call, where round 1 could only match hashes', () => {
  const s = story();
  const r = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'prediction', value: 106 }, { prediction: s.exp.refs.prediction, contributions: s.exp.refs.contributions, model: s.fit.refs.model, baseline: s.base.refs.baseline }));
  const runOf = (x) => x.receipt.runId;
  assert.deepEqual(r.trace.in.prediction.from, { kind: 'run', run: runOf(s.exp), from: { kind: 'call', call: 1, port: 'prediction' } });
  assert.deepEqual(r.trace.in.contributions.from, { kind: 'run', run: runOf(s.exp), from: { kind: 'call', call: 1, port: 'contributions' } });
  assert.deepEqual(r.trace.in.model.from, { kind: 'run', run: runOf(s.fit), from: { kind: 'call', call: 1, port: 'model' } });
  assert.deepEqual(r.trace.in.baseline.from, { kind: 'run', run: runOf(s.base), from: { kind: 'call', call: 1, port: 'baseline' } });
  assert.deepEqual(r.trace.in.claim.from, { kind: 'input', call: 0, port: 'claim' }, 'a plain value is still just an input');
  assert.equal(r.outputs.accepted, true);
  // the one remaining ambiguity: 106 was also produced by inner calls of that run, but the Ref names the root output
  assert.equal(r.trace.in.prediction.hash, s.exp.trace.out.prediction.hash);
});

test('passing a Ref from an earlier run keeps its origin as a run edge, so call ids no longer collide between runs', () => {
  const s = story();
  const r = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'prediction', value: 106 }, { model: s.fit.refs.model }));
  assert.deepEqual(r.trace.in.model.from, { kind: 'run', run: s.fit.receipt.runId, from: { kind: 'call', call: 1, port: 'model' } });
  assert.equal(r.trace.id, 1, 'call 1 of this run is still the checker; the run tag is what tells the two apart');
  const agree = findCall(r.trace, (c) => c.contract === 'explain.checkAgreement');
  assert.equal(agree.in.claimed.from.kind, 'at', 'inside the run the child sees a path into the claim input');
  assert.equal(agree.in.claimed.from.of.kind, 'input');
});

test('failure policy: a throwing check leaves a partial trace, a named node.error and a failed receipt that now HAS a verdicts field (empty: no check finished); a returning check leaves a verdict', () => {
  const s = story();
  const args = { baselinePrediction: 93, contributions: [27.5, -14.5, 3], prediction: 106, tolerance: 1e-6 };
  const n = s.w.runs().length;
  let caught;
  try { s.w.run('explain.checkReconstruction', args, { fill: { 'explain.checkReconstruction': 'explain.checkReconstruction/throwing' } }); } catch (e) { caught = e; }
  assert.equal(caught.code, 'CHECK_REJECTED', 'ctx.fault names the throw (round 2: IMPL_ERROR)');
  assert.match(caught.message, /^does not reconstruct/);
  assert.equal(caught.trace.error.code, 'CHECK_REJECTED');
  assert.match(caught.trace.error.message, /does not reconstruct/);
  assert.equal(caught.receipt.status, 'failed');
  assert.equal(s.w.runs().length, n + 1, 'the failed run is in the history');
  assert.equal(s.w.runs().at(-1).status, 'failed');
  assert.deepEqual(s.w.runs().at(-1).verdicts, [], 'F-10 flipped: a failed receipt has a verdicts field; it is empty because the only check in this run is the one that threw');
  assert.deepEqual(caught.receipt.verdicts, [], 'the receipt on the error says the same');
  assert.equal(caught.trace.kind, 'check', 'the failed node still says it was a check');
  const ok = s.w.run('explain.checkReconstruction', args);
  assert.equal(s.w.runs().length, n + 2);
  assert.deepEqual(ok.receipt.verdicts.map((v) => v.accepted), [false], 'returning keeps the verdict in the receipt');
});

test('a malformed claim is still an exception (not a rejection); it leaves a failed receipt with the schema message and an empty verdicts array (round 2: the field was missing)', () => {
  const s = story();
  let caught;
  try { s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'size' })); } catch (e) { caught = e; }
  assert.equal(caught.code, 'INPUT_SCHEMA');
  assert.equal(caught.trace.error.code, 'INPUT_SCHEMA');
  assert.match(caught.trace.error.message, /matches 0 of 3 oneOf branches/);
  assert.equal(caught.receipt.status, 'failed');
  assert.deepEqual(caught.receipt.verdicts, [], 'F-10 flipped: not undefined; no check had started, so none finished');
});

test('verdicts are cached like any pure call; judged pointers are hashes, so cached verdicts stay correct', () => {
  const s = story();
  const a = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'prediction', value: 106 }));
  const b = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'prediction', value: 106 }));
  assert.equal(b.trace.cached, true);
  assert.deepEqual(a.outputs.judged, b.outputs.judged);
});

test('a cached call still replays the callee\'s old call id inside a Part, so judged pointers keep carrying hashes (this part of F-2 remains)', () => {
  const w = createWorld();
  const n = { type: 'number' };
  w.contract({ id: 'cite', in: { v: n }, out: { from: { type: 'object' } } });
  w.implement({ id: 'cite/from', implements: 'cite', run: ({ v }) => ({ from: v.from }) });
  w.contract({ id: 'wrap', in: { v: n }, out: { from: { type: 'object' } } });
  w.implement({ id: 'wrap/1', implements: 'wrap', uses: ['cite'], run: ({ v }, ctx) => ({ from: ctx.call('cite', { v }).from }) });
  const direct = w.run('cite', { v: 1 });
  const viaWrap = w.run('wrap', { v: 1 });
  assert.equal(direct.outputs.from.call, 1);
  assert.equal(viaWrap.trace.calls[0].cached, true);
  assert.equal(viaWrap.trace.calls[0].id, 2);
  assert.equal(viaWrap.outputs.from.call, 1, 'call id 1 is the numbering of the run that filled the cache; in this run the call is #2');
});

test('assembly lint: a oneOf output can now be forwarded into an identical oneOf port', () => {
  const w = createWorld();
  const u = { oneOf: [{ type: 'number' }, { type: 'null' }] };
  w.contract({ id: 'p', in: {}, out: { r: u } });
  w.implement({ id: 'p/1', implements: 'p', run: () => ({ r: null }) });
  w.contract({ id: 'q', in: {}, out: { r: u } });
  assert.doesNotThrow(() => w.compose({ id: 'q/c', implements: 'q', steps: [{ name: 's', call: 'p', bind: {} }], returns: { r: 's.r' } }));
  assert.equal(w.run('q', {}).outputs.r, null);
});

test('the forwarded oneOf is used for real: checkedClaim returns checkClaim.residual, which is null for an unknown feature', () => {
  const s = story();
  const r = s.w.run('explain.checkedClaim', { claim: { kind: 'contribution', feature: 'weight', value: 3 }, model: s.fit.refs.model, input: DATA.input, baseline: s.base.refs.baseline, tolerance: DATA.tolerance });
  assert.equal(r.outputs.accepted, false);
  assert.equal(r.outputs.claimResidual, null);
});

test('checks are first-class: trace nodes carry kind check, and the receipt lists every verdict', () => {
  const s = story();
  assert.equal(s.exp.trace.calls[1].kind, 'check');
  assert.equal(s.exp.trace.kind, 'check', 'explain.explain both produces and judges; declared a check so its root box carries the verdict');
  assert.deepEqual(checkNodes(s.exp.receipt).map((c) => [c.contract, c.accepted]), [['explain.explain', true], ['explain.checkReconstruction', true]]);
  const eff = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'size', delta: 1, expectedChange: 20 }));
  assert.deepEqual(checkNodes(eff.receipt).map((c) => c.contract), ['explain.checkClaim', 'explain.checkEffectClaim', 'explain.checkAgreement']);
  assert.ok(checkNodes(eff.receipt).every((c) => c.reason.length > 10));
});

test('declaring a check without accepted:boolean and reason:string is refused at declaration', () => {
  const w = createWorld();
  assert.throws(() => w.contract({ id: 'bad', kind: 'check', in: {}, out: { ok: { type: 'boolean' } } }));
});

test('dispatching on claim.kind (v0.5): every guard is written once; the complements are derived by else and the skips are inherited, and the record still has six decisions', () => {
  const s = story();
  const r = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'prediction', value: 106 }));
  assert.deepEqual(r.trace.notes ?? [], []);
  assert.equal(r.trace.impl, 'explain.checkClaim/routed');
  assert.deepEqual(r.trace.calls.map((c) => c.contract), ['explain.checkPredictionClaim'], 'the feature lookup, four branches and the router are all absent: one node');
  assert.deepEqual(r.trace.decisions.map((d) => [d.label, d.value, d.ran ? 'ran' : 'skipped']),
    [['pred', true, 'ran'], ['idx', false, 'skipped'], ['unknown', false, 'skipped'], ['contrib', false, 'skipped'], ['vacuous', false, 'skipped'], ['effect', false, 'skipped']]);
  // pred is the only step that names the prediction kind: an eq whose operands are the claim's own kind (a path into the input) and a literal that keeps its value
  const pred = r.trace.decisions[0].from;
  assert.deepEqual([pred.kind, pred.op], ['test', 'eq']);
  assert.deepEqual(pred.args[0], { kind: 'at', of: { kind: 'input', call: r.trace.id, port: 'claim' }, path: ['kind'] });
  assert.deepEqual(pred.args[1], { kind: 'literal', value: 'prediction' }, 'v0.5: the literal keeps its value (round 4: no value)');
  // idx is the derived complement, and unknown (which only reads idx.index) inherits idx's skip: same original cause
  const idx = r.trace.decisions[1].from;
  assert.deepEqual([idx.op, idx.steps], ['else', ['pred']]);
  assert.deepEqual(r.trace.decisions[2].from, idx, 'unknown is skipped because idx was; its recorded cause is idx\'s cause, not a restated guard');
  const eff = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'size', delta: 1, expectedChange: 20 }));
  const effD = eff.trace.decisions.find((d) => d.label === 'effect').from;
  assert.equal(effD.op, 'and');
  assert.deepEqual(effD.args.map((a) => a.op), ['eq', 'else'], 'effect: kind is effect, and neither unknown nor vacuous ran; no typed ge/ne');
  assert.deepEqual(effD.args[1].steps, ['unknown', 'vacuous']);
  const unk = eff.trace.decisions.find((d) => d.label === 'unknown').from;
  assert.deepEqual([unk.op, unk.args[1]], ['lt', { kind: 'literal', value: 0 }]);
  assert.deepEqual(unk.args[0], { kind: 'call', call: eff.trace.calls[0].id, port: 'index' }, 'the index test points at the lookup call');
  // the vacuous case: its own typed test is the delta, not a complement
  const vac = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'age', delta: 0, expectedChange: 0 }));
  assert.deepEqual(vac.trace.decisions.filter((d) => d.ran).map((d) => d.label), ['idx', 'vacuous']);
  assert.equal(vac.trace.decisions.find((d) => d.label === 'effect').from.args[1].op, 'else', 'effect is skipped by else([unknown, vacuous]): vacuous ran');
});

test('v0.5 guard accounting: across all 12 claims the decisions use eq, lt, and and else only: no ne, ge, le, gt, not (the complements are derived)', () => {
  const s = story();
  const ops = new Set();
  const walk = (f) => { if (f && f.kind === 'test') { ops.add(f.op); f.args?.forEach(walk); } };
  for (const entry of CLAIMS) s.w.run('explain.checkClaim', claimInputs(s, entry.claim)).trace.decisions.forEach((d) => walk(d.from));
  assert.deepEqual([...ops].sort(), ['and', 'else', 'eq', 'lt'], 'round 4 used ne, eq, ge, lt and and');
});

test('the routed checkClaim equals the round-2 imperative one on all 12 claims: accepted, reason, residual and judged (differential oracle)', () => {
  const s = story();
  for (const entry of CLAIMS) {
    const routed = s.w.run('explain.checkClaim', claimInputs(s, entry.claim));
    const imperative = s.w.run('explain.checkClaim', claimInputs(s, entry.claim), { fill: { 'explain.checkClaim': 'explain.checkClaim/dispatch' } });
    assert.equal(imperative.trace.impl, 'explain.checkClaim/dispatch');
    assert.deepEqual(routed.outputs, imperative.outputs, entry.text);
  }
});

test('every claim kind takes exactly one branch (`one` would fail on two); the branch names why a rejection happened (unknown feature, vacuous) as a node of its own', () => {
  const s = story();
  const branch = (claim) => s.w.run('explain.checkClaim', claimInputs(s, claim)).trace.calls.map((c) => c.contract).filter((c) => c !== 'explain.featureIndex')[0];
  assert.equal(branch({ kind: 'prediction', value: 106 }), 'explain.checkPredictionClaim');
  assert.equal(branch({ kind: 'contribution', feature: 'size', value: 27.5 }), 'explain.checkContributionClaim');
  assert.equal(branch({ kind: 'contribution', feature: 'weight', value: 3 }), 'explain.rejectUnknownFeature');
  assert.equal(branch({ kind: 'effect', feature: 'weight', delta: 1, expectedChange: 3 }), 'explain.rejectUnknownFeature', 'an effect claim about a missing feature is unknown before it is vacuous');
  assert.equal(branch({ kind: 'effect', feature: 'age', delta: 0, expectedChange: 0 }), 'explain.rejectVacuousClaim');
  assert.equal(branch({ kind: 'effect', feature: 'size', delta: 1, expectedChange: 20 }), 'explain.checkEffectClaim');
  const rej = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'weight', value: 3 }));
  assert.deepEqual(rej.receipt.verdicts.map((v) => [v.contract, v.accepted]), [['explain.checkClaim', false], ['explain.rejectUnknownFeature', false]]);
});

test('ctx.when with a test inside the contribution check: the hint "belongs to another feature" is a recorded relation, ge(owner, 0), naming its operand', () => {
  const s = story();
  const wrongOwner = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'distance', value: 27.5 }));
  const node = findCall(wrongOwner.trace, (c) => c.contract === 'explain.checkContributionClaim');
  const dg = findCall(node, (c) => c.contract === 'explain.diagnoseContributions');
  assert.deepEqual(node.decisions.map((d) => [d.label, d.value, d.from.op, d.ran ?? d.skipped]),
    [['contributions have one value per model feature', true, 'eq', 'compare'], ["the claimed value is another feature's contribution", true, 'ge', 'name the owner']]);
  assert.deepEqual(node.decisions[0].from.args, [{ kind: 'call', call: dg.id, port: 'featureCount' }, { kind: 'call', call: dg.id, port: 'contributionCount' }], 'the decision names both counts it compared');
  assert.deepEqual(node.decisions[1].from.args[0], { kind: 'call', call: dg.id, port: 'owner' });
  assert.match(wrongOwner.outputs.reason, /contribution of 'size', not 'distance'/);
  const nobody = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'distance', value: 3 }));
  const n2 = findCall(nobody.trace, (c) => c.contract === 'explain.checkContributionClaim');
  assert.deepEqual(n2.decisions.map((d) => [d.value, d.ran ?? d.skipped]), [[true, 'compare'], [false, 'no hint']], 'the second decision is false: no hint, and the row says which branch was skipped');
  assert.doesNotMatch(nobody.outputs.reason, /not 'distance'/);
  const honest = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'size', value: 27.5 }));
  assert.equal(findCall(honest.trace, (c) => c.contract === 'explain.checkContributionClaim').decisions.length, 1, 'an accepted claim never asks for a hint, so no second decision');
  const short = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'size', value: 27.5 }, { contributions: [27.5] }));
  assert.equal(short.outputs.accepted, false);
  assert.match(short.outputs.reason, /one value per model feature/);
  assert.deepEqual(findCall(short.trace, (c) => c.contract === 'explain.checkContributionClaim').decisions.map((d) => d.value), [false]);
});

test('replay of the explain-and-check run is exact', () => {
  const s = story();
  const rep = s.w.replay(s.exp.receipt);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
});

test('a run filled with another implementation no longer poisons later default runs (cache entries remember nested choices)', () => {
  const w = fresh();
  const A = { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2] };
  const mutant = w.run('explain.attribute', A, { fill: { 'explain.contributions': 'explain.contributions/no-baseline' } });
  assert.deepEqual(mutant.outputs.contributions, [8, -15]);
  const later = w.run('explain.attribute', A);
  assert.deepEqual(later.outputs.contributions, [6, -9], 'the default run is right in the same world');
  assert.equal(later.trace.cached, false, 'the mutant entry was rejected for this fill');
  assert.ok(w.stats().cacheRejectedByDeps >= 1);
  const again = w.run('explain.attribute', A, { fill: { 'explain.contributions': 'explain.contributions/no-baseline' } });
  assert.equal(again.trace.cached, true, 'the mutant entry is still valid for the mutant fill');
  const noWrite = fresh();
  noWrite.run('explain.attribute', A, { cache: false });
  assert.equal(noWrite.stats().cacheEntries, 0, 'cache:false neither reads nor writes');
});

test('F-7 second half: verdicts can be combined with gather plus a check over the gathered verdicts', () => {
  const s = story();
  const ok = s.w.run('explain.checkedClaim', { claim: { kind: 'contribution', feature: 'size', value: 27.5 }, model: s.fit.refs.model, input: DATA.input, baseline: s.base.refs.baseline, tolerance: DATA.tolerance });
  assert.equal(ok.outputs.accepted, true);
  assert.deepEqual(ok.receipt.verdicts.map((v) => [v.contract, v.accepted]),
    [['explain.checkedClaim', true], ['explain.checkReconstruction', true], ['explain.checkClaim', true], ['explain.checkContributionClaim', true], ['explain.checkAgreement', true], ['explain.allAccepted', true]]);
  // the combining check's input records which two checks it combined, exactly
  const all = ok.trace.calls[3];
  assert.equal(all.contract, 'explain.allAccepted');
  const pieces = all.in.verdicts.from.pieces;
  assert.deepEqual(pieces.map((p) => p.path), [[0], [1]]);
  assert.deepEqual(pieces.map((p) => p.from.pieces.map((q) => q.from.call)), [[3, 3], [4, 4]]);
  assert.deepEqual(pieces.flatMap((p) => p.from.pieces.map((q) => q.from.port)), ['accepted', 'reason', 'accepted', 'reason']);
  // and a rejection in either member fails the whole
  const bad = s.w.run('explain.checkedClaim', { claim: { kind: 'contribution', feature: 'size', value: -27.5 }, model: s.fit.refs.model, input: DATA.input, baseline: s.base.refs.baseline, tolerance: DATA.tolerance });
  assert.equal(bad.outputs.accepted, false);
  assert.deepEqual(bad.outputs.failed, [1]);
  assert.match(bad.outputs.reason, /^1 of 2 rejected: \[1\] contribution of size/);
});

test('combined verdict when the attribution itself is wrong: the claim is true of the wrong Parts, and the combination rejects it', () => {
  const s = story();
  const fill = { 'explain.contributions': 'explain.contributions/no-baseline' };
  // with the mutant, contributions are [80,-24,0]; claiming 80 for size agrees with those Parts but they do not reconstruct
  const r = s.w.run('explain.checkedClaim', { claim: { kind: 'contribution', feature: 'size', value: 80 }, model: s.fit.refs.model, input: DATA.input, baseline: s.base.refs.baseline, tolerance: DATA.tolerance }, { fill });
  assert.deepEqual(r.receipt.verdicts.filter((v) => v.contract === 'explain.checkClaim').map((v) => v.accepted), [true]);
  assert.equal(r.outputs.accepted, false);
  assert.deepEqual(r.outputs.failed, [0]);
});

test('slots name the two predictions and two attributions in the trace (round 1 had two identical-looking boxes)', () => {
  const s = story();
  assert.deepEqual(s.exp.trace.calls[0].calls.map((c) => `${c.contract}${c.slot ? '#' + c.slot : ''}`),
    ['explain.predict#baseline', 'explain.predict#input', 'explain.contributions']);
  const eff = s.w.run('explain.effect', { model: s.fit.refs.model, input: DATA.input, baseline: s.base.refs.baseline, feature: 'size', delta: 1 });
  assert.deepEqual(eff.trace.calls.filter((c) => c.slot).map((c) => `${c.contract}#${c.slot}`),
    ['explain.attribute#before', 'explain.attribute#after', 'explain.difference#prediction', 'explain.difference#contribution']);
});

test('slot fill: the baseline prediction alone can be filled with a different predictor, leaving the input prediction alone', () => {
  const w = fresh();
  w.implement({ id: 'explain.predict/zero', implements: 'explain.predict', run: () => ({ value: 0 }) });
  // no w.select here any more: register() selects explain.predict/dot once (F-13), so a third implementation never makes a slot ambiguous
  const A = { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2] };
  const r = w.run('explain.attribute', A, { fill: { 'explain.predict#baseline': 'explain.predict/zero' } });
  assert.equal(r.outputs.baselinePrediction, 0);
  assert.equal(r.outputs.prediction, -6);
});

test('the model gathered in fit records where each half came from', () => {
  const s = story();
  const from = s.fit.trace.out.model.from;
  assert.equal(from.kind, 'gather');
  assert.deepEqual(from.pieces.map((p) => [p.path[0], p.from.kind]), [['features', 'input'], ['coefficients', 'call']]);
  const ls = s.fit.trace.calls.find((c) => c.contract === 'lin.leastSquares');
  assert.equal(from.pieces[1].from.call, ls.id);
});

// ------------------------------------------------------------------ round 3 (kernel v0.3)

test('F-10 flipped, the case that matters: a throw AFTER two checks finished keeps their verdicts on the failed receipt', () => {
  const s = story();
  s.w.implement({ id: 'explain.allAccepted/broken', implements: 'explain.allAccepted', run: (_, ctx) => ctx.fault('combiner broke', 'COMBINER_BROKE') });
  s.w.select('explain.allAccepted', 'explain.allAccepted/every');
  let caught;
  try {
    s.w.run('explain.checkedClaim', { claim: { kind: 'contribution', feature: 'size', value: 27.5 }, model: s.fit.refs.model, input: DATA.input, baseline: s.base.refs.baseline, tolerance: DATA.tolerance },
      { fill: { 'explain.allAccepted': 'explain.allAccepted/broken' } });
  } catch (e) { caught = e; }
  assert.equal(caught.code, 'COMBINER_BROKE');
  assert.equal(caught.receipt.status, 'failed');
  assert.deepEqual(caught.receipt.verdicts.map((v) => [v.contract, v.accepted]),
    [['explain.checkReconstruction', true], ['explain.checkClaim', true], ['explain.checkContributionClaim', true], ['explain.checkAgreement', true]],
    'the reconstruction check, the claim check and its two inner checks finished; the root check and the combiner did not');
  assert.equal(s.w.runs().at(-1).verdicts.length, 4, 'the same list is in runs()');
});

test('cached verdicts: a repeated claim is one cache hit at the root, and the receipt still lists the verdicts of the whole cached subtree, marked cached', () => {
  const s = story();
  const claim = { kind: 'effect', feature: 'size', delta: 1, expectedChange: 20 };
  const first = s.w.run('explain.checkClaim', claimInputs(s, claim));
  const second = s.w.run('explain.checkClaim', claimInputs(s, claim));
  assert.equal(second.trace.cached, true);
  assert.deepEqual(second.trace.cachedFrom, { run: first.receipt.runId, call: 1 });
  assert.deepEqual(first.receipt.verdicts.map((v) => v.contract), ['explain.checkClaim', 'explain.checkEffectClaim', 'explain.checkAgreement']);
  assert.deepEqual(second.receipt.verdicts.map((v) => [v.contract, v.accepted, Boolean(v.cached)]),
    [['explain.checkClaim', true, true], ['explain.checkEffectClaim', true, true], ['explain.checkAgreement', true, true]], 'round 2 lost the inner two here');
  assert.ok(second.receipt.verdicts.every((v) => v.cachedFrom.run === first.receipt.runId));
  assert.deepEqual(second.trace.verdicts.map((v) => v.contract), ['explain.checkClaim', 'explain.checkEffectClaim', 'explain.checkAgreement'], 'the hit node carries them');
});

test('slots are declared: the effect check lists its four slots in uses, a typo in a fill is BAD_FILL, a call to an undeclared slot is UNDECLARED_SLOT', () => {
  const w = fresh();
  const eff = w.implementationsOf('explain.effect')[0];
  assert.deepEqual(eff.slots, { 'explain.attribute': ['before', 'after'], 'explain.difference': ['prediction', 'contribution'] }, 'the slot list is part of the implementation\'s interface');
  const A = { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2] };
  assert.throws(() => w.run('explain.attribute', A, { fill: { 'explain.predict#basline': 'explain.predict/capped' } }), (e) => e.code === 'BAD_FILL' && /explain.predict#basline/.test(e.message));
  const ok = w.run('explain.attribute', A, { fill: { 'explain.predict#baseline': 'explain.predict/capped' } });
  assert.equal(ok.outputs.prediction, -6, 'the declared slot name is accepted');
  w.contract({ id: 'probe.slots', in: {}, out: { v: { type: 'number' } } });
  w.implement({ id: 'probe.slots/1', implements: 'probe.slots', uses: ['explain.difference#prediction'],
    run: (_, ctx) => ({ v: ctx.call('explain.difference', { before: 1, after: 3 }, { slot: 'contribution' }).value }) });
  assert.throws(() => w.run('probe.slots', {}), (e) => e.code === 'UNDECLARED_SLOT');
});

test('slot fill keeps working on a composition step: only the input prediction is capped, the baseline prediction stays', () => {
  const w = fresh();
  const A = { model: { features: ['a'], coefficients: [0, 1000] }, input: [1], baseline: [0] };
  const r = w.run('explain.attribute', A, { fill: { 'explain.predict#input': 'explain.predict/capped' }, cache: false });
  assert.equal(r.outputs.baselinePrediction, 0);
  assert.equal(r.outputs.prediction, 130, 'the input prediction was filled with the capped predictor');
});

test('world.ref attaches a check to an INNER call of an earlier run, and judgedCalls follows the recorded provenance to the call that computed the value', () => {
  const s = story();
  const base = findCall(s.w.node(s.exp.receipt.runId, 1), (c) => c.contract === 'explain.predict' && c.slot === 'baseline');
  assert.ok(base, 'the baseline prediction is an inner call of the explain run, never a root output');
  const actual = s.w.ref(s.exp.receipt.runId, base.id, 'value');
  assert.equal(actual.value, 93);
  const r = s.w.run('explain.checkAgreement', { claimed: 93, actual, tolerance: DATA.tolerance, subject: 'baseline prediction' });
  assert.equal(r.outputs.accepted, true);
  assert.deepEqual(r.trace.in.actual.from, { kind: 'run', run: s.exp.receipt.runId, from: { kind: 'call', call: base.id, port: 'value' } });
  const chain = judgedCalls(s.w, r.trace).actual;
  assert.deepEqual(chain.map((c) => [c.contract, c.slot]), [['explain.predict', 'baseline'], ['lin.dot', null]], 'predict#baseline re-exports what lin.dot computed');
  assert.equal(chain[0].call, base.id);
});

test('judgedCalls for a claim checked after the fact: the prediction was computed by lin.dot, the contributions by explain.contributions, both inside run 3', () => {
  const s = story();
  const r = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'contribution', feature: 'distance', value: -14.5 },
    { model: s.fit.refs.model, baseline: s.base.refs.baseline, prediction: s.exp.refs.prediction, contributions: s.exp.refs.contributions }));
  const j = judgedCalls(s.w, r.trace);
  assert.deepEqual(Object.keys(j).sort(), ['baseline', 'contributions', 'model', 'prediction']);
  assert.deepEqual(j.prediction.map((c) => c.contract), ['explain.explain', 'explain.attribute', 'explain.predict', 'lin.dot']);
  assert.deepEqual(j.contributions.map((c) => c.contract), ['explain.explain', 'explain.attribute', 'explain.contributions']);
  assert.deepEqual(j.model.map((c) => c.contract), ['explain.fit']);
  assert.ok([...j.prediction, ...j.contributions].every((c) => c.run === s.exp.receipt.runId));
  assert.equal(s.w.node(j.prediction.at(-1).run, j.prediction.at(-1).call).contract, 'lin.dot');
});

test('concat and gather keep provenance: withIntercept elements, baseline elements, the nudged vector and the design matrix', () => {
  const s = story();
  const wi = s.w.run('explain.withIntercept', { values: [4, 5] });
  const pieces = wi.trace.out.values.from.pieces;
  assert.deepEqual(pieces.map((p) => [p.path[0], p.from.kind, p.from.path?.[0]]), [[0, 'computed', undefined], [1, 'at', 0], [2, 'at', 1]]);
  assert.equal(pieces[1].from.of.kind, 'input');
  const bm = s.base.trace.out.baseline.from;
  assert.equal(bm.kind, 'gather');
  assert.deepEqual(bm.pieces.map((p) => p.from.kind), ['call', 'call', 'call']);
  assert.deepEqual(bm.pieces.map((p) => s.base.trace.calls.find((c) => c.id === p.from.call).contract), ['stat.mean', 'stat.mean', 'stat.mean']);
  const nd = s.w.run('explain.nudge', { input: [1, 2, 3], index: 1, delta: 0.5 });
  assert.deepEqual(nd.outputs.input, [1, 2.5, 3]);
  assert.deepEqual(nd.trace.out.input.from.pieces.map((p) => p.from.kind), ['at', 'computed', 'at'], 'only the nudged element is computed');
  const design = s.fit.trace.calls.find((c) => c.contract === 'explain.design');
  assert.equal(design.out.matrix.from.kind, 'gather');
  const rowsFrom = design.out.matrix.from.pieces;
  assert.equal(rowsFrom.length, DATA.rows.length, 'one piece per row, and each row is itself a concat');
  assert.ok(rowsFrom.every((p) => p.from.kind === 'gather' && p.from.pieces.length === DATA.features.length + 1));
  assert.deepEqual(rowsFrom[3].from.pieces.map((p) => p.from.kind), ['computed', 'at', 'at', 'at'], 'a literal 1, then elements 0..2 of input row 3');
  assert.deepEqual(rowsFrom[3].from.pieces.slice(1).map((p) => [p.from.of.path[0], p.from.path[0]]), [[3, 0], [3, 1], [3, 2]]);
});

test('ctx.fault names the failures that used to be IMPL_ERROR: effect on a missing feature leaves a failed receipt with UNKNOWN_FEATURE', () => {
  const s = story();
  let caught;
  try { s.w.run('explain.effect', { model: s.model, input: DATA.input, baseline: s.baseline, feature: 'weight', delta: 1 }); } catch (e) { caught = e; }
  assert.equal(caught.code, 'UNKNOWN_FEATURE');
  assert.equal(caught.receipt.status, 'failed');
  assert.equal(caught.trace.error.code, 'UNKNOWN_FEATURE');
  let shape;
  try { s.w.run('explain.fit', { features: ['a', 'b'], rows: [[1, 2], [3, 4]], targets: [1] }); } catch (e) { shape = e; }
  assert.equal(shape.code, 'FIT_SHAPE');
});

// A sweep walks one feature through equal increments by ctx.drive; the check demands the same change at every step.
const sweepInputs = (s, steps, over = {}) => ({ model: s.fit.refs.model, input: DATA.input, feature: 'size', delta: 1, steps, expectedStep: 20, tolerance: DATA.tolerance, ...over });

test('sweep: ticks are numbered from 1 so @k is step k; collect gathers the predictions, each element pointing at its own tick\'s predict call', () => {
  const s = story();
  const r = s.w.run('explain.checkSweep', sweepInputs(s, 3));
  near(r.outputs.predictions[0], 106, 1e-9);
  r.outputs.predictions.forEach((p, k) => near(p, 106 + 20 * k, 1e-9));
  assert.equal(r.outputs.accepted, true);
  const sw = r.trace.calls[0];
  const ticks = sw.calls.filter((c) => c.contract === 'explain.sweepStep');
  assert.deepEqual(ticks.map((c) => c.tick), [1, 2, 3], 'startTick 1: tick @k is the k-th increment, the number the check\'s reason uses');
  assert.deepEqual(sw.drives.map((d) => [d.contract, d.startTick, d.ticks, d.stopped]), [['explain.sweepStep', 1, 3, 'ticks']], 'the drive records why it stopped');
  assert.equal(ticks[0].in.state.from.kind, 'input', 'no trail in the state: tick 1 reads the sweep input directly');
  const pieces = sw.out.predictions.from.pieces;
  assert.equal(sw.out.predictions.from.kind, 'gather');
  assert.equal(pieces.length, 4);
  assert.equal(pieces[0].from.kind, 'call', 'element 0 is the start prediction');
  assert.equal(pieces[0].from.call, sw.calls.find((c) => c.slot === 'start').id);
  const predictOf = (t) => t.calls.find((c) => c.contract === 'explain.predict');
  // one hop: element k of predictions is element k-1 of the collected gather, whose pieces are the tick nodes' own prediction outputs
  assert.deepEqual(pieces.slice(1).map((p) => [p.from.kind, p.from.of.kind, p.from.path[0]]), [['at', 'gather', 0], ['at', 'gather', 1], ['at', 'gather', 2]]);
  assert.deepEqual(pieces[1].from.of.pieces.map((q) => [q.from.call, q.from.port]), ticks.map((t) => [t.id, 'prediction']), 'the collected pieces point at the tick nodes directly, not through earlier states (round 3: a three-hop at chain)');
  assert.equal(predictOf(ticks[0]).slot, 'sweep');
  assert.deepEqual(r.trace.out.predictions.from, { kind: 'call', call: sw.id, port: 'predictions' });
});

test('sweep: zero steps returns the start alone; replay is exact, the call around the drive is cacheable, and a longer sweep reuses the first ticks as cache hits', () => {
  const s = story();
  const base = { model: s.fit.refs.model, input: DATA.input, feature: 'size', delta: 1 };
  const zero = s.w.run('explain.sweep', { ...base, steps: 0 });
  assert.equal(zero.outputs.predictions.length, 1);
  assert.deepEqual(zero.trace.calls.filter((c) => c.contract === 'explain.sweepStep'), []);
  assert.equal(zero.trace.drives[0].ticks, 0);
  const a = s.w.run('explain.sweep', { ...base, steps: 3 });
  assert.equal(s.w.replay(a.receipt).exact, true);
  const again = s.w.run('explain.sweep', { ...base, steps: 3 });
  assert.equal(again.trace.cached, true, 'a drive absorbs its children\'s tick reads: the call around it is still cacheable');
  const longer = s.w.run('explain.sweep', { ...base, steps: 5 });
  const ticks = longer.trace.calls.filter((c) => c.contract === 'explain.sweepStep');
  assert.deepEqual(ticks.map((c) => [c.tick, c.cached]), [[1, true], [2, true], [3, true], [4, false], [5, false]]);
  assert.deepEqual(ticks[0].cachedFrom, { run: a.receipt.runId, call: a.trace.calls.find((c) => c.tick === 1).id });
  assert.deepEqual(longer.outputs.predictions.slice(0, 4), a.outputs.predictions);
});

test('the capped predictor passes every example (prove) and the pointwise effect claim, and only the sweep check rejects it, naming step 2', () => {
  const s = story();
  const capped = { 'explain.predict': 'explain.predict/capped' };
  assert.ok(s.w.prove('explain.predict', 'explain.predict/capped').every((p) => p.ok), 'the contract example never reaches 130');
  const pointwise = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'size', delta: 1, expectedChange: 20 }), { fill: capped });
  assert.equal(pointwise.outputs.accepted, true, 'one step from 106 stays under the cap');
  assert.ok(findCall(pointwise.trace, (c) => c.contract === 'explain.checkEffectClaim'), 'the filled run really ran the effect check');
  const rec = s.w.run('explain.explain', { model: s.model, input: DATA.input, baseline: s.baseline, tolerance: DATA.tolerance }, { fill: capped });
  assert.equal(rec.outputs.accepted, true, 'the reconstruction check cannot see it either: 93 and 106 are under the cap');
  const sweep = s.w.run('explain.checkSweep', sweepInputs(s, 4), { fill: capped });
  assert.equal(sweep.outputs.accepted, false);
  assert.match(sweep.outputs.reason, /^step 2 \(126 to 130\) changes the prediction by 4, expected 20; 3 of 4 steps are off/);
  near(sweep.outputs.residual, -16, 1e-9);
  near(sweep.outputs.predictions[2], 130, 0);
  assert.deepEqual(sweep.receipt.verdicts.map((v) => [v.contract, v.accepted]), [['explain.checkSweep', false], ['explain.checkConstantStep', false]]);
  // the verdict points at the predictions it judged, and at the first one that was off
  assert.equal(resolvePointer(s.w, sweep.outputs.judged.firstOffStep), 130);
});

test('a trajectory example (v0.5): prove checks every tick of the sweep step, so the saturating mutant that agrees with the tick-2 example is caught at tick 2 (zero-based) of the trajectory', () => {
  const w = fresh();
  const p = w.prove('explain.sweepStep');
  const mut = p.filter((x) => x.impl === 'explain.sweepStep/saturating');
  assert.deepEqual(mut.map((x) => x.ok), [true, false], 'the old final-tick example (ticks: 2, prediction -12) passes the mutant; the trajectory does not');
  assert.deepEqual(mut.map((x) => x.example), ['two ticks, last output', 'three ticks, every prediction'], 'v0.6: examples carry names, prove reports them (round 5: 0 and 1)');
  assert.match(mut[1].detail, /^tick 2: expected \{"prediction":-15\} got \{"prediction":-12\} \(inputs \{"delta":1\}\)/, 'and the failing tick ends with its inputs');
  assert.deepEqual(p.filter((x) => x.impl === 'explain.sweepStep/nudge-predict').map((x) => x.ok), [true, true]);
});

test('specificity (v0.5, v0.6): explain.predict#* caps every seat of the contract on purpose, and one exact slot fill puts the start seat back; fillReach says which nodes each key chose and chosenBy says by which rung', () => {
  const s = story();
  const args = sweepInputs(s, 4);
  const at = (r, id) => s.w.node(r.receipt.runId, id);
  const all = s.w.run('explain.checkSweep', args, { fill: { 'explain.predict#*': 'explain.predict/capped' }, cache: false });
  const allIds = all.receipt.fillReach['explain.predict#*'];
  assert.equal(allIds.length, 5, 'the start seat and four sweep ticks');
  assert.deepEqual([...new Set(allIds.map((id) => at(all, id).impl))], ['explain.predict/capped']);
  const mixed = s.w.run('explain.checkSweep', args, { fill: { 'explain.predict#*': 'explain.predict/capped', 'explain.predict#start': 'explain.predict/dot' }, cache: false });
  const reach = mixed.receipt.fillReach;
  assert.equal(reach['explain.predict#start'].length, 1, 'the exact slot fill chose the start seat only');
  assert.equal(reach['explain.predict#*'].length, 4, 'the #* fill kept the four sweep ticks: the exact slot beat it at the start seat');
  assert.deepEqual(at(mixed, reach['explain.predict#start'][0]).chosenBy, { rung: 'slot fill', key: 'explain.predict#start' });
  assert.deepEqual([...new Set(reach['explain.predict#*'].map((id) => at(mixed, id).chosenBy.rung))], ['every-slot fill']);
  assert.deepEqual(mixed.receipt.fillConsulted.slice().sort(), ['explain.predict#*', 'explain.predict#start']);
  assert.deepEqual(mixed.outputs.predictions, all.outputs.predictions, 'the start seat was below the cap anyway');
});

test('sweep claims over the range: size +20 per unit holds, age 0 per unit holds, distance +4 per unit is rejected with the true change', () => {
  const s = story();
  const run = (feature, expectedStep, steps = 4) => s.w.run('explain.checkSweep', sweepInputs(s, steps, { feature, expectedStep }));
  assert.equal(run('size', 20).outputs.accepted, true);
  assert.equal(run('age', 0).outputs.accepted, true);
  const bad = run('distance', 4);
  assert.equal(bad.outputs.accepted, false);
  assert.match(bad.outputs.reason, /^step 1 \(106 to 102\) changes the prediction by -4, expected 4; 4 of 4 steps are off/);
  let caught;
  try { run('weight', 1); } catch (e) { caught = e; }
  assert.equal(caught.code, 'UNKNOWN_FEATURE');
  assert.equal(caught.receipt.status, 'failed');
});

test('overlapping `when` conditions: `first` still silently takes the earlier (both branches ran), and `one` now refuses with AMBIGUOUS_BRANCH (round 3 documented only the first)', () => {
  const w = createWorld();
  const b = { type: 'boolean' }; const n = { type: 'number' };
  w.contract({ id: 'flags', in: { x: n }, out: { big: b, even: b } });
  w.implement({ id: 'flags/1', implements: 'flags', run: ({ x }) => ({ big: x.value > 10, even: x.value % 2 === 0 }) });
  w.contract({ id: 'say', in: { x: n }, out: { v: n } });
  w.implement({ id: 'say/big', implements: 'say', run: () => ({ v: 1 }) });
  w.contract({ id: 'pick', in: { x: n }, out: { v: n } });
  const steps = [
    { name: 'f', call: 'flags', bind: { x: '$in.x' } },
    { name: 'a', call: 'say', when: 'f.big', bind: { x: '$in.x' } },
    { name: 'b', call: 'say', when: 'f.even', bind: { x: '$in.x' } },
  ];
  w.compose({ id: 'pick/first', implements: 'pick', steps, returns: { v: { first: ['a.v', 'b.v'] } } });
  const r = w.run('pick', { x: 12 });
  assert.deepEqual(r.trace.calls.map((c) => c.contract), ['flags', 'say', 'say'], 'both overlapping branches ran: one was wasted work and nothing said so');
  w.compose({ id: 'pick/one', implements: 'pick', steps, returns: { v: { one: ['a.v', 'b.v'] } } });
  assert.throws(() => w.run('pick', { x: 12 }, { fill: { pick: 'pick/one' } }), (e) => e.code === 'AMBIGUOUS_BRANCH');
  assert.equal(w.run('pick', { x: 11 }, { fill: { pick: 'pick/one' } }).outputs.v, 1, 'exactly one live branch is fine');
  assert.throws(() => w.run('pick', { x: 7 }, { fill: { pick: 'pick/one' } }), (e) => e.code === 'NO_BRANCH');
});

test('FRICTION (documented): a slot fill that is declared somewhere but cannot apply in this run is accepted silently (declaration is world-wide, not per run)', () => {
  const w = fresh();
  const r = w.run('explain.baselineMeans', { rows: [[1, 10], [3, 20]] }, { fill: { 'explain.predict#baseline': 'explain.predict/capped' } });
  assert.deepEqual(r.outputs.baseline, [2, 15], 'no BAD_FILL: explain.attribute declares the slot, although explain.baselineMeans never reaches it');
  assert.throws(() => w.run('explain.baselineMeans', { rows: [[1, 10], [3, 20]] }, { fill: { 'explain.predict#baselin': 'explain.predict/capped' } }), (e) => e.code === 'BAD_FILL');
});
test('a path fill must land (v0.5, F-22 path half): the d11 key on a claim that never reaches attribute#after is BAD_FILL, while the flat key stays silent', () => {
  const s = story();
  const pathKey = { 'explain.attribute#after/explain.predict#input': 'explain.predict/capped' };
  assert.throws(() => s.w.run('explain.checkClaim', claimInputs(s, { kind: 'prediction', value: 106 }), { fill: pathKey, cache: false }),
    (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message), 'a prediction claim has no nudged attribution: round 4 ran it and nobody was told');
  const flat = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'prediction', value: 106 }), { fill: { 'explain.predict#input': 'explain.predict/capped' }, cache: false });
  assert.equal(flat.outputs.accepted, true, 'the flat key is standing configuration: declared, so accepted, and unused');
  assert.deepEqual(flat.receipt.fillConsulted, [], 'but the receipt now says the key was not consulted');
  const hit = s.w.run('explain.checkClaim', claimInputs(s, { kind: 'effect', feature: 'size', delta: 3, expectedChange: 60 }), { fill: pathKey, cache: false });
  assert.deepEqual(hit.receipt.fillConsulted, ['explain.attribute#after/explain.predict#input']);
});

test('landing (v0.6): all makes the flat key of d12 a BAD_FILL, none lets the path key miss, and a flat typo still fails in every mode', () => {
  const s = story();
  const pred = claimInputs(s, { kind: 'prediction', value: 106 });
  const flat = { 'explain.predict#input': 'explain.predict/capped' };
  const pathKey = { 'explain.attribute#after/explain.predict#input': 'explain.predict/capped' };
  assert.equal(s.w.run('explain.checkClaim', pred, { fill: flat, cache: false }).outputs.accepted, true, 'default: a flat key is standing configuration');
  assert.throws(() => s.w.run('explain.checkClaim', pred, { fill: flat, cache: false, landing: 'all' }), (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message), 'all: the flat key of d12 must land');
  const none = s.w.run('explain.checkClaim', pred, { fill: pathKey, cache: false, landing: 'none' });
  assert.deepEqual(none.receipt.fillReach[Object.keys(pathKey)[0]], [], 'none: the path key missed and the receipt says so with an empty reach');
  assert.throws(() => s.w.run('explain.checkClaim', pred, { fill: { 'explain.predict#inpt': 'explain.predict/capped' }, cache: false, landing: 'none' }), (e) => e.code === 'BAD_FILL', 'a flat typo fails in every mode');
});

test('FRICTION (documented, kernel): under landing none a typo in a path SEGMENT is accepted, although ledger seq 56 says typos still fail in every mode', () => {
  const s = story();
  const pred = claimInputs(s, { kind: 'prediction', value: 106 });
  const typo = { 'explain.attribute#aftr/explain.predict#input': 'explain.predict/capped' };
  assert.throws(() => s.w.run('explain.checkClaim', pred, { fill: typo, cache: false }), (e) => e.code === 'BAD_FILL', 'default: refused');
  assert.throws(() => s.w.run('explain.checkClaim', pred, { fill: typo, cache: false, landing: 'all' }), (e) => e.code === 'BAD_FILL', 'all: refused');
  assert.doesNotThrow(() => s.w.run('explain.checkClaim', pred, { fill: typo, cache: false, landing: 'none' }), 'none: the misspelt segment passes (a flat typo does not)');
});

test('the one lint (v0.5, F-26): a branch added without a guard, or one that provably overlaps another, is refused when the composition is assembled', () => {
  const s = story();
  const steps = [
    { name: 'pred', call: 'explain.checkPredictionClaim', when: { eq: [{ at: ['$in.claim', 'kind'] }, { literal: 'prediction' }] }, bind: { claim: '$in.claim', prediction: '$in.prediction', tolerance: '$in.tolerance' } },
    { name: 'vac', call: 'explain.rejectVacuousClaim', bind: { claim: '$in.claim' } },
  ];
  const ret = { accepted: { one: ['pred.accepted', 'vac.accepted'] }, reason: { one: ['pred.reason', 'vac.reason'] }, residual: { one: ['pred.residual', 'vac.residual'] }, judged: { one: ['pred.judged', 'vac.judged'] } };
  assert.throws(() => s.w.compose({ id: 'explain.checkClaim/bad', implements: 'explain.checkClaim', steps, returns: ret }), (e) => e.code === 'ASSEMBLY_LINT' && /unconditional/.test(e.message));
  const both = [{ ...steps[0], when: { and: [steps[0].when, { eq: [{ at: ['$in.claim', 'kind'] }, { literal: 'prediction' }] }] } },
    { ...steps[1], when: steps[0].when }];
  assert.throws(() => s.w.compose({ id: 'explain.checkClaim/bad2', implements: 'explain.checkClaim', steps: both, returns: ret }), (e) => e.code === 'ASSEMBLY_LINT');
});

test('guards that fault are tests now (v0.4): the effect check records lt(index, 0) naming the lookup\'s index on the node that failed (round 3: computed provenance)', () => {
  const s = story();
  let caught;
  try { s.w.run('explain.effect', { model: s.model, input: DATA.input, baseline: s.baseline, feature: 'weight', delta: 1 }); } catch (e) { caught = e; }
  assert.equal(caught.trace.decisions.length, 1);
  const d = caught.trace.decisions[0];
  assert.deepEqual([d.label, d.value, d.ran, d.from.kind, d.from.op], ['the model has no such feature', true, 'fault', 'test', 'lt']);
  assert.deepEqual(d.from.args, [{ kind: 'call', call: caught.trace.calls[0].id, port: 'index' }, { kind: 'literal', value: 0 }]);
  const ok = s.w.run('explain.effect', { model: s.model, input: DATA.input, baseline: s.baseline, feature: 'size', delta: 1 });
  assert.deepEqual(ok.trace.decisions.map((x) => [x.value, x.skipped, x.from.kind]), [[false, 'fault', 'test']]);
});

test('path slots (v0.4): one key fills the nudged prediction only, so the effect claim for size +3 is rejected while the unnudged attribution stays honest; a flat key would reach both', () => {
  const s = story();
  const claim = { kind: 'effect', feature: 'size', delta: 3, expectedChange: 60 };
  const honest = s.w.run('explain.checkClaim', claimInputs(s, claim));
  assert.equal(honest.outputs.accepted, true, 'uncapped, +3 size is +60');
  const path = { 'explain.attribute#after/explain.predict#input': 'explain.predict/capped' };
  const r = s.w.run('explain.checkClaim', claimInputs(s, claim), { fill: path, cache: false });
  assert.equal(r.outputs.accepted, false);
  assert.match(r.outputs.reason, /claimed 60, actual 24, difference 36/);
  const key = 'explain.attribute#after/explain.predict#input';
  const at = (run, id) => s.w.node(run.receipt.runId, id);
  assert.equal(r.receipt.fillReach[key].length, 1, 'v0.6: the receipt says the path key chose exactly one node (round 5 scanned the trace for the two attribute calls)');
  assert.deepEqual([at(r, r.receipt.fillReach[key][0]).impl, at(r, r.receipt.fillReach[key][0]).chosenBy], ['explain.predict/capped', { rung: 'path fill', key }], 'and which rung chose it');
  const flat = s.w.run('explain.checkClaim', claimInputs(s, claim), { fill: { 'explain.predict#input': 'explain.predict/capped' }, cache: false });
  const flatIds = flat.receipt.fillReach['explain.predict#input'];
  assert.equal(flatIds.length, 2, 'the flat key hits both call sites');
  assert.deepEqual(flatIds.map((id) => at(flat, id).chosenBy.rung), ['slot fill', 'slot fill']);
  assert.ok(flatIds.includes(r.receipt.fillReach[key][0]), 'the path key landed on one of the two sites the flat key chose');
  assert.deepEqual(r.receipt.fillConsulted, ['explain.attribute#after/explain.predict#input'], 'v0.5: the receipt lists the fill keys a call actually used');
  // a typo in a path segment is BAD_FILL like a typo in a flat slot
  assert.throws(() => s.w.run('explain.checkClaim', claimInputs(s, claim), { fill: { 'explain.attribute#aftr/explain.predict#input': 'explain.predict/capped' } }), (e) => e.code === 'BAD_FILL');
});
