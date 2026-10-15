// Contest D (round 3, kernel v0.3): explanations that must be checkable, and claims that must be rejected when unsupported.
// A linear model is fitted with contest A's lin.leastSquares; every explanation and every check is a
// contract run through the kernel. Checks are ordinary contracts (kind: 'check') whose output ports are
// { accepted, reason, residual, judged }.
import { register as registerA } from '../a-numeric/index.mjs';

const num = { type: 'number' };
const vec = { type: 'array', minItems: 1, items: num };
const mat = { type: 'array', minItems: 1, items: vec };
const names = { type: 'array', minItems: 1, items: { type: 'string' } };
const tol = { type: 'number', minimum: 0 };
const model = {
  type: 'object', required: ['features', 'coefficients'], additionalProperties: false,
  properties: { features: names, coefficients: vec }, // coefficients[0] is the intercept b0
};
const claim = {
  oneOf: [
    { type: 'object', required: ['kind', 'feature', 'value'], additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['contribution'] }, feature: { type: 'string' }, value: num } },
    { type: 'object', required: ['kind', 'value'], additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['prediction'] }, value: num } },
    { type: 'object', required: ['kind', 'feature', 'delta', 'expectedChange'], additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['effect'] }, feature: { type: 'string' }, delta: num, expectedChange: num } },
  ],
};
// Every check returns the same four ports (kind:'check' enforces accepted + reason; residual and judged are mine).
// `judged` maps a port name to { hash, path? }: the content hash of the Part judged, and where inside it.
// residual is number-or-null because a rejection can have nothing to subtract (unknown feature, vacuous claim).
// Round 2: forwarding this oneOf through compositions now lints (round-1 F-8), so one shape serves every check.
const verdict = {
  accepted: { type: 'boolean' }, reason: { type: 'string' },
  residual: { oneOf: [num, { type: 'null' }] }, judged: { type: 'object' },
};

const fmt = (n) => (Object.is(n, -0) ? '0' : String(Number(n.toPrecision(10))));
const point = (ref, path) => (path ? { hash: ref.hash, path } : { hash: ref.hash });

export function register(world) {
  registerA(world);
  const C = (def) => world.contract(def);
  const I = (def) => world.implement(def);

  // ---------------------------------------------------------------- fitting
  C({ id: 'explain.design', in: { rows: mat }, out: { matrix: mat },
    description: 'prepend a column of ones (the intercept column)',
    examples: [{ in: { rows: [[2, 3], [4, 5]] }, out: { matrix: [[1, 2, 3], [1, 4, 5]] } }] });
  // v0.3: each row is concat([1], row) and the matrix is a gather of those rows, so every design-matrix element
  // records whether it is the literal 1 or element [j] of input row [i] (round 2 built plain arrays: all `computed`).
  I({ id: 'explain.design/ones', implements: 'explain.design',
    run: ({ rows }, ctx) => ({ matrix: ctx.gather(rows.value.map((_, i) => ctx.concat([1], ctx.at(rows, i)))) }) });

  C({ id: 'explain.withIntercept', in: { values: vec }, out: { values: vec },
    examples: [{ in: { values: [4, 5] }, out: { values: [1, 4, 5] } }] });
  I({ id: 'explain.withIntercept/prepend', implements: 'explain.withIntercept', run: ({ values }, ctx) => ({ values: ctx.concat([1], values) }) });

  // Hand derivation: y = 1 + 2a - 3b on (0,0)(1,0)(0,1)(1,1)(2,1) gives 1, 3, -2, 0, 2 exactly.
  C({ id: 'explain.fit', in: { features: names, rows: mat, targets: vec }, out: { model }, tolerance: 1e-9,
    examples: [{ in: { features: ['a', 'b'], rows: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]], targets: [1, 3, -2, 0, 2] },
      out: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] } } }] });
  I({ id: 'explain.fit/least-squares', implements: 'explain.fit', uses: ['explain.design', 'lin.leastSquares'],
    run: ({ features, rows, targets }, ctx) => {
      if (rows.value.length !== targets.value.length) ctx.fault(`fit: ${rows.value.length} rows vs ${targets.value.length} targets`, 'FIT_SHAPE');
      if (rows.value.some((r) => r.length !== features.value.length)) ctx.fault('fit: a row does not have one value per feature', 'FIT_SHAPE');
      const d = ctx.call('explain.design', { rows });
      const ls = ctx.call('lin.leastSquares', { matrix: d.matrix, vector: targets });
      // gather (v0.2) replaces a plain object: the model Part now records that `features` is this run's input
      // and `coefficients` is lin.leastSquares' output, instead of one opaque `computed` blob.
      return { model: ctx.gather({ features, coefficients: ls.coefficients }) };
    } });

  C({ id: 'explain.baselineMeans', in: { rows: mat }, out: { baseline: vec }, tolerance: 1e-12,
    description: 'the baseline input: the mean of every feature column',
    examples: [{ in: { rows: [[1, 10], [3, 20]] }, out: { baseline: [2, 15] } }] });
  I({ id: 'explain.baselineMeans/column-mean', implements: 'explain.baselineMeans', uses: ['lin.transpose', 'stat.mean'],
    run: ({ rows }, ctx) => {
      const t = ctx.call('lin.transpose', { matrix: rows });
      // gather (not a plain array): each baseline element records the stat.mean call that produced it
      return { baseline: ctx.gather(t.matrix.value.map((_, j) => ctx.call('stat.mean', { values: ctx.at(t.matrix, j) }).value)) };
    } });

  // ---------------------------------------------------------------- prediction and attribution
  C({ id: 'explain.predict', in: { model, input: vec }, out: { value: num }, tolerance: 1e-12,
    examples: [{ in: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5] }, out: { value: -6 } }] });
  I({ id: 'explain.predict/dot', implements: 'explain.predict', uses: ['explain.withIntercept', 'lin.dot'],
    run: ({ model: m, input }, ctx) => {
      if (input.value.length !== m.value.features.length) ctx.fault(`predict: ${input.value.length} values for ${m.value.features.length} features`, 'PREDICT_SHAPE');
      const row = ctx.call('explain.withIntercept', { values: input });
      return { value: ctx.call('lin.dot', { a: ctx.at(m, 'coefficients'), b: row.values }).value };
    } });

  // A second predictor that is wrong only far from the examples: it caps the prediction at 130. The contract's examples
  // never reach 130, so `prove` passes it; only a check that walks a range (explain.checkSweep) can see the cap.
  I({ id: 'explain.predict/capped', implements: 'explain.predict', uses: ['explain.withIntercept', 'lin.dot'],
    description: 'WRONG far away: min(130, b0 + b.x)',
    run: ({ model: m, input }, ctx) => {
      const row = ctx.call('explain.withIntercept', { values: input });
      const raw = ctx.call('lin.dot', { a: ctx.at(m, 'coefficients'), b: row.values }).value;
      return { value: raw.value > 130 ? 130 : raw };
    } });
  world.select('explain.predict', 'explain.predict/dot');

  C({ id: 'explain.contributions', in: { coefficients: vec, input: vec, baseline: vec }, out: { values: vec }, tolerance: 1e-12,
    description: 'b_i * (x_i - baseline_i) for each feature; coefficients[0] is the intercept and is not a contribution',
    examples: [
      { in: { coefficients: [1, 2, -3], input: [4, 5], baseline: [1, 2] }, out: { values: [6, -9] } },
      { in: { coefficients: [0, 1], input: [3], baseline: [3] }, out: { values: [0] } },
    ] });
  I({ id: 'explain.contributions/product', implements: 'explain.contributions', run: ({ coefficients: b, input: x, baseline: x0 }, ctx) => {
    if (b.value.length !== x.value.length + 1 || x0.value.length !== x.value.length) ctx.fault('contributions: coefficients need one intercept plus one value per feature', 'CONTRIBUTION_SHAPE');
    return { values: x.value.map((xi, i) => b.value[i + 1] * (xi - x0.value[i])) };
  } });
  // A deliberately wrong implementation (drops the baseline). It exists so the checks have something to catch.
  I({ id: 'explain.contributions/no-baseline', implements: 'explain.contributions', description: 'WRONG on purpose: b_i * x_i',
    run: ({ coefficients: b, input: x }) => ({ values: x.value.map((xi, i) => b.value[i + 1] * xi) }) });
  world.select('explain.contributions', 'explain.contributions/product');

  C({ id: 'explain.attribute', in: { model, input: vec, baseline: vec }, out: { baselinePrediction: num, prediction: num, contributions: vec }, tolerance: 1e-12,
    examples: [{ in: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2] },
      out: { baselinePrediction: -3, prediction: -6, contributions: [6, -9] } }] });
  world.compose({ id: 'explain.attribute/baseline-contrast', implements: 'explain.attribute',
    steps: [
      { name: 'base', slot: 'baseline', call: 'explain.predict', bind: { model: '$in.model', input: '$in.baseline' } },
      { name: 'now', slot: 'input', call: 'explain.predict', bind: { model: '$in.model', input: '$in.input' } },
      { name: 'parts', call: 'explain.contributions', bind: { coefficients: { at: ['$in.model', 'coefficients'] }, input: '$in.input', baseline: '$in.baseline' } },
    ],
    returns: { baselinePrediction: 'base.value', prediction: 'now.value', contributions: 'parts.values' } });

  // ---------------------------------------------------------------- checks
  // Hand derivation (reconstruction): -3 + (6 - 9) = -6 so residual 0; with [6, -8] the sum is -5, prediction - sum = -1.
  C({ id: 'explain.checkReconstruction', kind: 'check',
    in: { baselinePrediction: num, contributions: vec, prediction: num, tolerance: tol }, out: verdict,
    description: 'baseline prediction + sum of contributions must reconstruct the prediction (|residual| <= tolerance)',
    examples: [
      { in: { baselinePrediction: -3, contributions: [6, -9], prediction: -6, tolerance: 1e-9 }, out: { accepted: true, residual: 0 } },
      { in: { baselinePrediction: -3, contributions: [6, -8], prediction: -6, tolerance: 1e-9 }, out: { accepted: false, residual: -1 } },
    ] });
  const reconstruct = ({ baselinePrediction: b, contributions: c, prediction: p, tolerance: t }) => {
    const sum = c.value.reduce((a, x) => a + x, 0);
    const rec = b.value + sum;
    const residual = p.value - rec;
    const ok = Math.abs(residual) <= t.value;
    const reason = `${ok ? 'reconstructs' : 'does not reconstruct'}: baseline ${fmt(b.value)} + contributions ${fmt(sum)} = ${fmt(rec)}; prediction ${fmt(p.value)}; residual ${fmt(residual)} ${ok ? 'within' : 'exceeds'} tolerance ${t.value}`;
    return { ok, residual, reason, judged: { baselinePrediction: point(b), contributions: point(c), prediction: point(p) } };
  };
  I({ id: 'explain.checkReconstruction/returning', implements: 'explain.checkReconstruction', run: (inp) => {
    const r = reconstruct(inp);
    return { accepted: r.ok, reason: r.reason, residual: r.residual, judged: r.judged };
  } });
  // Same contract, other failure policy: a rejection is an exception. Its own rejecting example cannot pass (see tests).
  I({ id: 'explain.checkReconstruction/throwing', implements: 'explain.checkReconstruction', run: (inp, ctx) => {
    const r = reconstruct(inp);
    if (!r.ok) ctx.fault(r.reason, 'CHECK_REJECTED'); // v0.3: the throw carries a name, round 2 saw IMPL_ERROR
    return { accepted: true, reason: r.reason, residual: r.residual, judged: r.judged };
  } });
  world.select('explain.checkReconstruction', 'explain.checkReconstruction/returning');

  C({ id: 'explain.checkAgreement', kind: 'check',
    in: { claimed: num, actual: num, tolerance: tol, subject: { type: 'string' } }, out: verdict,
    description: 'a claimed number must equal the actual number within an absolute tolerance; residual = claimed - actual',
    examples: [
      { in: { claimed: 3, actual: 3, tolerance: 1e-9, subject: 'x' }, out: { accepted: true, residual: 0, reason: 'x: claimed 3, actual 3, difference 0 within tolerance 1e-9' } },
      { in: { claimed: 3, actual: -3, tolerance: 1e-9, subject: 'x' }, out: { accepted: false, residual: 6, reason: 'x: claimed 3, actual -3, difference 6 exceeds tolerance 1e-9 (wrong sign)' } },
      { in: { claimed: 0, actual: 2, tolerance: 1e-9, subject: 'x' }, out: { accepted: false, residual: -2, reason: 'x: claimed 0, actual 2, difference -2 exceeds tolerance 1e-9' } },
    ] });
  I({ id: 'explain.checkAgreement/absolute', implements: 'explain.checkAgreement', run: ({ claimed, actual, tolerance, subject }) => {
    const diff = claimed.value - actual.value;
    const ok = Math.abs(diff) <= tolerance.value;
    const flip = !ok && claimed.value * actual.value < 0;
    return {
      accepted: ok,
      reason: `${subject.value}: claimed ${fmt(claimed.value)}, actual ${fmt(actual.value)}, difference ${fmt(diff)} ${ok ? 'within' : 'exceeds'} tolerance ${tolerance.value}${flip ? ' (wrong sign)' : ''}`,
      residual: diff,
      judged: { claimed: point(claimed), actual: point(actual) },
    };
  } });

  // ---------------------------------------------------------------- perturbation
  C({ id: 'explain.difference', in: { before: num, after: num }, out: { value: num },
    examples: [{ in: { before: 3, after: 5 }, out: { value: 2 } }] });
  I({ id: 'explain.difference/subtract', implements: 'explain.difference', run: ({ before, after }) => ({ value: after.value - before.value }) });

  C({ id: 'explain.featureIndex', in: { model, feature: { type: 'string' } }, out: { index: { type: 'integer' } },
    description: 'position of a feature in the model, -1 when the model has no such feature',
    examples: [{ in: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, feature: 'b' }, out: { index: 1 } },
               { in: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, feature: 'zzz' }, out: { index: -1 } }] });
  I({ id: 'explain.featureIndex/indexOf', implements: 'explain.featureIndex', run: ({ model: m, feature }) => ({ index: m.value.features.indexOf(feature.value) }) });

  C({ id: 'explain.nudge', in: { input: vec, index: { type: 'integer' }, delta: num }, out: { input: vec },
    examples: [{ in: { input: [1, 2, 3], index: 1, delta: 0.5 }, out: { input: [1, 2.5, 3] } }] });
  I({ id: 'explain.nudge/add', implements: 'explain.nudge', run: ({ input, index, delta }, ctx) => {
    if (index.value < 0 || index.value >= input.value.length) ctx.fault(`nudge: index ${index.value} outside 0..${input.value.length - 1}`, 'INDEX_RANGE');
    // gather: the elements that did not move keep their provenance (path back into the input); only the nudged one is computed
    return { input: ctx.gather(input.value.map((x, i) => (i === index.value ? x + delta.value : ctx.at(input, i)))) };
  } });

  // Hand derivation: b = [1, 2, -3]; input [4,5] -> -6; changing b (index 1) by +2 gives [4,7] -> 1 + 8 - 21 = -12.
  // Contribution of b: -3*(5-2) = -9 before, -3*(7-2) = -15 after. Both changes are -6.
  C({ id: 'explain.effect', in: { model, input: vec, baseline: vec, feature: { type: 'string' }, delta: num },
    out: { predictionBefore: num, predictionAfter: num, predictionChange: num, contributionBefore: num, contributionAfter: num, contributionChange: num },
    tolerance: 1e-12,
    description: 'change one feature by delta, re-predict, and report the change in prediction and in that feature\'s contribution',
    examples: [{ in: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], feature: 'b', delta: 2 },
      out: { predictionBefore: -6, predictionAfter: -12, predictionChange: -6, contributionBefore: -9, contributionAfter: -15, contributionChange: -6 } }] });
  I({ id: 'explain.effect/nudge-and-repredict', implements: 'explain.effect',
    // v0.3: the slots are declared, so a fill for 'explain.attribute#befor' is BAD_FILL and a call to an undeclared slot is UNDECLARED_SLOT
    uses: ['explain.featureIndex', 'explain.attribute#before', 'explain.attribute#after', 'explain.nudge', 'explain.difference#prediction', 'explain.difference#contribution'],
    run: ({ model: m, input, baseline, feature, delta }, ctx) => {
      const idx = ctx.call('explain.featureIndex', { model: m, feature }).index;
      // v0.4: the test names its operands (the index Ref and the literal 0); round 3 had a computed boolean here
      if (ctx.when({ lt: [idx, 0] }, 'the model has no such feature', { true: 'fault', false: 'continue' })) ctx.fault(`effect: model has no feature '${feature.value}'`, 'UNKNOWN_FEATURE');
      const before = ctx.call('explain.attribute', { model: m, input, baseline }, { slot: 'before' });
      const nudged = ctx.call('explain.nudge', { input, index: idx, delta });
      const after = ctx.call('explain.attribute', { model: m, input: nudged.input, baseline }, { slot: 'after' });
      const cb = ctx.at(before.contributions, idx.value);
      const ca = ctx.at(after.contributions, idx.value);
      const dp = ctx.call('explain.difference', { before: before.prediction, after: after.prediction }, { slot: 'prediction' });
      const dc = ctx.call('explain.difference', { before: cb, after: ca }, { slot: 'contribution' });
      return { predictionBefore: before.prediction, predictionAfter: after.prediction, predictionChange: dp.value,
        contributionBefore: cb, contributionAfter: ca, contributionChange: dc.value };
    } });

  // The perturbation check proper: for a linear model the prediction change must equal the contribution change.
  C({ id: 'explain.perturbAndCheck', kind: 'check',
    in: { model, input: vec, baseline: vec, feature: { type: 'string' }, delta: num, tolerance: tol },
    out: { predictionChange: num, contributionChange: num, ...verdict }, tolerance: 1e-12,
    description: 'perturb one feature and check that the change in prediction equals the change in that feature\'s contribution',
    examples: [{ in: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], feature: 'b', delta: 2, tolerance: 1e-9 },
      out: { predictionChange: -6, contributionChange: -6, accepted: true, residual: 0 } }] });
  world.compose({ id: 'explain.perturbAndCheck/composed', implements: 'explain.perturbAndCheck',
    steps: [
      { name: 'eff', call: 'explain.effect', bind: { model: '$in.model', input: '$in.input', baseline: '$in.baseline', feature: '$in.feature', delta: '$in.delta' } },
      { name: 'chk', call: 'explain.checkAgreement', bind: { claimed: 'eff.predictionChange', actual: 'eff.contributionChange', tolerance: '$in.tolerance', subject: { literal: 'prediction change vs contribution change' } } },
    ],
    returns: { predictionChange: 'eff.predictionChange', contributionChange: 'eff.contributionChange',
      accepted: 'chk.accepted', reason: 'chk.reason', residual: 'chk.residual', judged: 'chk.judged' } });

  // ---------------------------------------------------------------- the explain-and-check composition
  // kind is per contract, and this one both produces (attribution) and judges (reconstruction). I declared it a
  // check so the root box is red/green and receipt.verdicts lists it; see FRICTION F-11 for why that is a choice
  // the kernel forces rather than a fact about the contract.
  C({ id: 'explain.explain', kind: 'check', in: { model, input: vec, baseline: vec, tolerance: tol },
    out: { baselinePrediction: num, prediction: num, contributions: vec, ...verdict }, tolerance: 1e-12,
    examples: [{ in: { model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], tolerance: 1e-9 },
      out: { baselinePrediction: -3, prediction: -6, contributions: [6, -9], accepted: true, residual: 0 } }] });
  world.compose({ id: 'explain.explain/attribute-then-reconstruct', implements: 'explain.explain',
    steps: [
      { name: 'attr', call: 'explain.attribute', bind: { model: '$in.model', input: '$in.input', baseline: '$in.baseline' } },
      { name: 'rec', call: 'explain.checkReconstruction', bind: { baselinePrediction: 'attr.baselinePrediction', contributions: 'attr.contributions', prediction: 'attr.prediction', tolerance: '$in.tolerance' } },
    ],
    returns: { baselinePrediction: 'attr.baselinePrediction', prediction: 'attr.prediction', contributions: 'attr.contributions',
      accepted: 'rec.accepted', reason: 'rec.reason', residual: 'rec.residual', judged: 'rec.judged' } });

  // ---------------------------------------------------------------- the claim checker
  // The checker is given the actual Parts (prediction, contributions, model, input, baseline). It trusts them:
  // whether they are themselves consistent is the reconstruction check's business.
  C({ id: 'explain.checkClaim', kind: 'check',
    in: { claim, model, input: vec, baseline: vec, prediction: num, contributions: vec, tolerance: tol }, out: verdict,
    description: 'judge a structured claim against the actual Parts; accepted only when the Parts support it',
    examples: [
      { in: { claim: { kind: 'contribution', feature: 'b', value: -9 }, model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], prediction: -6, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: true, residual: 0 } },
      { in: { claim: { kind: 'contribution', feature: 'b', value: 9 }, model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], prediction: -6, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: false, residual: 18 } },
      { in: { claim: { kind: 'prediction', value: -6 }, model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], prediction: -6, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: true, residual: 0 } },
      { in: { claim: { kind: 'effect', feature: 'a', delta: 1, expectedChange: 0 }, model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], prediction: -6, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: false, residual: -2 } },
      { in: { claim: { kind: 'contribution', feature: 'zzz', value: 1 }, model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], prediction: -6, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: false, residual: null } },
    ] });
  I({ id: 'explain.checkClaim/dispatch', implements: 'explain.checkClaim',
    uses: ['explain.featureIndex', 'explain.checkAgreement', 'explain.effect'],
    run: ({ claim: cl, model: m, input, baseline, prediction, contributions, tolerance }, ctx) => {
      const c = cl.value;
      const features = m.value.features;
      const reject = (reason, judged) => ({ accepted: false, reason, residual: null, judged });
      if (c.kind === 'prediction') {
        const r = ctx.call('explain.checkAgreement', { claimed: ctx.at(cl, 'value'), actual: prediction, tolerance, subject: 'prediction' });
        return { ...r, judged: { claim: point(cl), prediction: point(prediction) } };
      }
      const idx = ctx.call('explain.featureIndex', { model: m, feature: ctx.at(cl, 'feature') }).index;
      if (idx.value < 0) return reject(`unknown feature '${c.feature}'; the model has ${features.join(', ')}`, { claim: point(cl), model: point(m) });
      if (c.kind === 'contribution') {
        if (contributions.value.length !== features.length) return reject('contributions do not have one value per model feature', { claim: point(cl), model: point(m), contributions: point(contributions) });
        const actual = ctx.at(contributions, idx.value);
        const r = ctx.call('explain.checkAgreement', { claimed: ctx.at(cl, 'value'), actual, tolerance, subject: `contribution of ${c.feature}` });
        const judged = { claim: point(cl), contributions: point(contributions, [idx.value]) };
        if (r.accepted.value) return { ...r, judged };
        const other = contributions.value.findIndex((v, i) => i !== idx.value && Math.abs(v - c.value) <= tolerance.value);
        const hint = other >= 0 ? ` — the claimed value is the contribution of '${features[other]}', not '${c.feature}'` : '';
        return { accepted: r.accepted, reason: r.reason.value + hint, residual: r.residual, judged };
      }
      // c.kind === 'effect'
      if (c.delta === 0) return reject(`vacuous: delta is 0, so no feature could change the prediction; the claim cannot be supported or refuted`, { claim: point(cl) });
      const eff = ctx.call('explain.effect', { model: m, input, baseline, feature: ctx.at(cl, 'feature'), delta: ctx.at(cl, 'delta') });
      const r = ctx.call('explain.checkAgreement', { claimed: ctx.at(cl, 'expectedChange'), actual: eff.predictionChange, tolerance,
        subject: `effect on prediction of changing ${c.feature} by ${fmt(c.delta)}` });
      return { ...r, judged: { claim: point(cl), model: point(m), input: point(input), baseline: point(baseline) } };
    } });

  // ---- round 3: the same checker as a composition with `when` (v0.3), so the trace says which branch applied.
  // Round 4 (v0.4): the conditions are tests over the claim and the feature index (`eq`, `ne`, `lt`, `ge`, `and`), the
  // alternatives are `{ one }`, and the router contract of round 3 (five helper booleans) is gone.
  // `explain.checkClaim/dispatch` above is the round-2 imperative version. It stays as a differential oracle: a test
  // runs both over all 12 claims and demands identical verdicts, reasons, residuals and judged pointers.
  const claimIn = { claim, model, index: { type: 'integer' }, input: vec, baseline: vec, prediction: num, contributions: vec, tolerance: tol };
  const pick = (...names) => Object.fromEntries(names.map((n) => [n, claimIn[n]]));
  const M = { features: ['a', 'b'], coefficients: [1, 2, -3] };

  C({ id: 'explain.checkPredictionClaim', kind: 'check', in: pick('claim', 'prediction', 'tolerance'), out: verdict,
    description: 'a claim about the prediction: its value must equal the actual prediction',
    examples: [
      { in: { claim: { kind: 'prediction', value: -6 }, prediction: -6, tolerance: 1e-9 }, out: { accepted: true, residual: 0 } },
      { in: { claim: { kind: 'prediction', value: -5 }, prediction: -6, tolerance: 1e-9 }, out: { accepted: false, residual: 1 } },
    ] });
  I({ id: 'explain.checkPredictionClaim/agreement', implements: 'explain.checkPredictionClaim', uses: ['explain.checkAgreement'],
    run: ({ claim: cl, prediction, tolerance }, ctx) => {
      const r = ctx.call('explain.checkAgreement', { claimed: ctx.at(cl, 'value'), actual: prediction, tolerance, subject: 'prediction' });
      return { ...r, judged: { claim: point(cl), prediction: point(prediction) } };
    } });

  C({ id: 'explain.rejectUnknownFeature', kind: 'check', in: pick('claim', 'model'), out: verdict,
    description: 'always rejects: the claim names a feature the model does not have (the router has already decided that)',
    examples: [{ in: { claim: { kind: 'contribution', feature: 'zz', value: 1 }, model: M }, out: { accepted: false, residual: null, reason: "unknown feature 'zz'; the model has a, b" } }] });
  I({ id: 'explain.rejectUnknownFeature/names', implements: 'explain.rejectUnknownFeature', run: ({ claim: cl, model: m }) => ({
    accepted: false, reason: `unknown feature '${cl.value.feature}'; the model has ${m.value.features.join(', ')}`, residual: null, judged: { claim: point(cl), model: point(m) } }) });

  C({ id: 'explain.rejectVacuousClaim', kind: 'check', in: pick('claim'), out: verdict,
    description: 'always rejects: an effect claim with delta 0 cannot be supported or refuted',
    examples: [{ in: { claim: { kind: 'effect', feature: 'a', delta: 0, expectedChange: 0 } }, out: { accepted: false, residual: null } }] });
  I({ id: 'explain.rejectVacuousClaim/delta-zero', implements: 'explain.rejectVacuousClaim', run: ({ claim: cl }) => ({
    accepted: false, reason: 'vacuous: delta is 0, so no feature could change the prediction; the claim cannot be supported or refuted', residual: null, judged: { claim: point(cl) } }) });

  // Counting and scanning are not relations between Refs, so this helper stays, but it now emits numbers and the
  // decisions are tests over them (`eq(featureCount, contributionCount)`, `ge(owner, 0)`), no longer booleans I computed.
  // Hand derivation: contributions [6, -9], claimed 6 for index 1: index 0 holds 6, so owner = 0. Claimed 7: nobody, owner = -1.
  C({ id: 'explain.diagnoseContributions', in: { model, contributions: vec, index: { type: 'integer' }, claimed: num, tolerance: tol },
    out: { featureCount: { type: 'integer' }, contributionCount: { type: 'integer' }, owner: { type: 'integer' } },
    description: 'the two counts that must agree, and the position of another feature (not index) whose contribution equals the claimed value, -1 when none',
    examples: [
      { in: { model: M, contributions: [6, -9], index: 1, claimed: 6, tolerance: 1e-9 }, out: { featureCount: 2, contributionCount: 2, owner: 0 } },
      { in: { model: M, contributions: [6, -9], index: 1, claimed: 7, tolerance: 1e-9 }, out: { featureCount: 2, contributionCount: 2, owner: -1 } },
      { in: { model: M, contributions: [6], index: 0, claimed: 6, tolerance: 1e-9 }, out: { featureCount: 2, contributionCount: 1, owner: -1 } },
    ] });
  I({ id: 'explain.diagnoseContributions/scan', implements: 'explain.diagnoseContributions', run: ({ model: m, contributions, index, claimed, tolerance }) => ({
    featureCount: m.value.features.length, contributionCount: contributions.value.length,
    owner: contributions.value.findIndex((v, i) => i !== index.value && Math.abs(v - claimed.value) <= tolerance.value) }) });

  C({ id: 'explain.checkContributionClaim', kind: 'check', in: pick('claim', 'model', 'index', 'contributions', 'tolerance'), out: verdict,
    description: 'a claim about one feature\'s contribution: its value must equal the actual contribution; a wrong value that is another feature\'s contribution says so',
    examples: [
      { in: { claim: { kind: 'contribution', feature: 'b', value: -9 }, model: M, index: 1, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: true, residual: 0 } },
      { in: { claim: { kind: 'contribution', feature: 'b', value: 6 }, model: M, index: 1, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: false, residual: 15, reason: "contribution of b: claimed 6, actual -9, difference 15 exceeds tolerance 1e-9 (wrong sign) — the claimed value is the contribution of 'a', not 'b'" } },
      { in: { claim: { kind: 'contribution', feature: 'b', value: 7 }, model: M, index: 1, contributions: [6, -9], tolerance: 1e-9 }, out: { accepted: false, residual: 16 } },
    ] });
  I({ id: 'explain.checkContributionClaim/by-feature', implements: 'explain.checkContributionClaim',
    uses: ['explain.diagnoseContributions', 'explain.checkAgreement'],
    run: ({ claim: cl, model: m, index: idx, contributions, tolerance }, ctx) => {
      const dg = ctx.call('explain.diagnoseContributions', { model: m, contributions, index: idx, claimed: ctx.at(cl, 'value'), tolerance });
      // ctx.when with a test records each decision on this node, naming both operands (v0.4)
      if (!ctx.when({ eq: [dg.featureCount, dg.contributionCount] }, 'contributions have one value per model feature', { true: 'compare', false: 'reject' })) {
        return { accepted: false, reason: 'contributions do not have one value per model feature', residual: null, judged: { claim: point(cl), model: point(m), contributions: point(contributions) } };
      }
      const r = ctx.call('explain.checkAgreement', { claimed: ctx.at(cl, 'value'), actual: ctx.at(contributions, idx.value), tolerance, subject: `contribution of ${cl.value.feature}` });
      const judged = { claim: point(cl), contributions: point(contributions, [idx.value]) };
      if (r.accepted.value) return { ...r, judged };
      const hint = ctx.when({ ge: [dg.owner, 0] }, 'the claimed value is another feature\'s contribution', { true: 'name the owner', false: 'no hint' })
        ? ` — the claimed value is the contribution of '${m.value.features[dg.owner.value]}', not '${cl.value.feature}'` : '';
      return { accepted: r.accepted, reason: r.reason.value + hint, residual: r.residual, judged };
    } });

  C({ id: 'explain.checkEffectClaim', kind: 'check', in: pick('claim', 'model', 'input', 'baseline', 'tolerance'), out: verdict,
    description: 'an effect claim: changing the feature by delta must change the prediction by expectedChange (re-predicted by explain.effect)',
    examples: [
      { in: { claim: { kind: 'effect', feature: 'b', delta: 2, expectedChange: -6 }, model: M, input: [4, 5], baseline: [1, 2], tolerance: 1e-9 }, out: { accepted: true, residual: 0 } },
      { in: { claim: { kind: 'effect', feature: 'b', delta: 2, expectedChange: 0 }, model: M, input: [4, 5], baseline: [1, 2], tolerance: 1e-9 }, out: { accepted: false, residual: 6 } },
    ] });
  I({ id: 'explain.checkEffectClaim/repredict', implements: 'explain.checkEffectClaim', uses: ['explain.effect', 'explain.checkAgreement'],
    run: ({ claim: cl, model: m, input, baseline, tolerance }, ctx) => {
      const c = cl.value;
      const eff = ctx.call('explain.effect', { model: m, input, baseline, feature: ctx.at(cl, 'feature'), delta: ctx.at(cl, 'delta') });
      const r = ctx.call('explain.checkAgreement', { claimed: ctx.at(cl, 'expectedChange'), actual: eff.predictionChange, tolerance,
        subject: `effect on prediction of changing ${c.feature} by ${fmt(c.delta)}` });
      return { ...r, judged: { claim: point(cl), model: point(m), input: point(input), baseline: point(baseline) } };
    } });

  // The routed checker (v0.4). The conditions are tests over the claim and over the feature index; the alternatives are
  // `{ one }`, so two live branches would be AMBIGUOUS_BRANCH instead of a silent first. No router contract.
  const kind = { at: ['$in.claim', 'kind'] };
  const isKind = (k) => ({ eq: [kind, { literal: k }] });
  const delta = { at: ['$in.claim', 'delta'] };
  // Round 5 (v0.5): every guard is written once. A step that reads a skipped step is skipped too (inherited), so only `pred`
  // names the prediction kind, and `idx` is its `else`; everything that reads `idx.index` inherits idx's skip. The complements
  // (not a prediction, index >= 0, delta != 0) are derived by `else`, not typed.
  world.compose({ id: 'explain.checkClaim/routed', implements: 'explain.checkClaim',
    steps: [
      { name: 'pred', call: 'explain.checkPredictionClaim', when: isKind('prediction'), bind: { claim: '$in.claim', prediction: '$in.prediction', tolerance: '$in.tolerance' } },
      { name: 'idx', call: 'explain.featureIndex', when: { else: ['pred'] }, bind: { model: '$in.model', feature: { at: ['$in.claim', 'feature'] } } },
      { name: 'unknown', call: 'explain.rejectUnknownFeature', when: { lt: ['idx.index', 0] }, bind: { claim: '$in.claim', model: '$in.model' } },
      { name: 'contrib', call: 'explain.checkContributionClaim', when: { and: [isKind('contribution'), { else: ['unknown'] }] },
        bind: { claim: '$in.claim', model: '$in.model', index: 'idx.index', contributions: '$in.contributions', tolerance: '$in.tolerance' } },
      { name: 'vacuous', call: 'explain.rejectVacuousClaim', when: { and: [isKind('effect'), { else: ['unknown'] }, { eq: [delta, 0] }] }, bind: { claim: '$in.claim' } },
      { name: 'effect', call: 'explain.checkEffectClaim', when: { and: [isKind('effect'), { else: ['unknown', 'vacuous'] }] },
        bind: { claim: '$in.claim', model: '$in.model', input: '$in.input', baseline: '$in.baseline', tolerance: '$in.tolerance' } },
    ],
    returns: Object.fromEntries(['accepted', 'reason', 'residual', 'judged'].map((p) => [p, { one: ['pred', 'unknown', 'contrib', 'vacuous', 'effect'].map((st) => `${st}.${p}`) }])) });
  world.select('explain.checkClaim', 'explain.checkClaim/routed');

  // ---------------------------------------------------------------- combining verdicts (round-1 F-7, second half)
  // A check over verdicts: input is an array of { accepted, reason } objects, built by gather so each element's
  // accepted and reason keep their provenance. Hand derivation: [true, true] -> accepted; [true, false] -> rejected, failed [1].
  const vd = { type: 'object', required: ['accepted', 'reason'], properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } } };
  C({ id: 'explain.allAccepted', kind: 'check', in: { verdicts: { type: 'array', minItems: 1, items: vd } },
    out: { accepted: { type: 'boolean' }, reason: { type: 'string' }, failed: { type: 'array', items: { type: 'integer' } } },
    description: 'accepted only when every verdict in the list is accepted; failed lists the positions that were not',
    examples: [
      { in: { verdicts: [{ accepted: true, reason: 'a' }, { accepted: true, reason: 'b' }] }, out: { accepted: true, failed: [] } },
      { in: { verdicts: [{ accepted: true, reason: 'a' }, { accepted: false, reason: 'b' }] }, out: { accepted: false, failed: [1] } },
    ] });
  I({ id: 'explain.allAccepted/every', implements: 'explain.allAccepted', run: ({ verdicts }) => {
    const failed = verdicts.value.flatMap((v, i) => (v.accepted ? [] : [i]));
    return { accepted: failed.length === 0, failed,
      reason: failed.length === 0 ? `all ${verdicts.value.length} verdicts accepted` : `${failed.length} of ${verdicts.value.length} rejected: ${failed.map((i) => `[${i}] ${verdicts.value[i].reason}`).join(' | ')}` };
  } });

  // Judge a claim and the attribution it is judged against in one composition. The claim is checked against the
  // attribution this composition just made, and the attribution itself must reconstruct.
  C({ id: 'explain.checkedClaim', kind: 'check',
    in: { claim, model, input: vec, baseline: vec, tolerance: tol },
    out: { accepted: { type: 'boolean' }, reason: { type: 'string' }, failed: { type: 'array', items: { type: 'integer' } }, claimResidual: verdict.residual },
    description: 'a claim is accepted only if the claim holds AND the attribution it was judged against reconstructs',
    examples: [{ in: { claim: { kind: 'contribution', feature: 'b', value: -9 }, model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], tolerance: 1e-9 },
      out: { accepted: true, failed: [], claimResidual: 0 } },
    { in: { claim: { kind: 'contribution', feature: 'b', value: 9 }, model: { features: ['a', 'b'], coefficients: [1, 2, -3] }, input: [4, 5], baseline: [1, 2], tolerance: 1e-9 },
      out: { accepted: false, failed: [1], claimResidual: 18 } }] });
  world.compose({ id: 'explain.checkedClaim/both', implements: 'explain.checkedClaim',
    steps: [
      { name: 'attr', call: 'explain.attribute', bind: { model: '$in.model', input: '$in.input', baseline: '$in.baseline' } },
      { name: 'rec', call: 'explain.checkReconstruction', bind: { baselinePrediction: 'attr.baselinePrediction', contributions: 'attr.contributions', prediction: 'attr.prediction', tolerance: '$in.tolerance' } },
      { name: 'clm', call: 'explain.checkClaim', bind: { claim: '$in.claim', model: '$in.model', input: '$in.input', baseline: '$in.baseline', prediction: 'attr.prediction', contributions: 'attr.contributions', tolerance: '$in.tolerance' } },
      { name: 'all', call: 'explain.allAccepted', bind: { verdicts: { gather: [{ gather: { accepted: 'rec.accepted', reason: 'rec.reason' } }, { gather: { accepted: 'clm.accepted', reason: 'clm.reason' } }] } } },
    ],
    returns: { accepted: 'all.accepted', reason: 'all.reason', failed: 'all.failed', claimResidual: 'clm.residual' } });

  // ---------------------------------------------------------------- round 3: a claim over a range (ctx.drive)
  // The effect claim above compares two points. A sweep walks a feature through `steps` equal increments and the check
  // demands the same change at every step. Each step is one tick of explain.sweepStep, folded by ctx.drive inside
  // explain.sweep. Round 4 (v0.4): the ticks are numbered from 1 (`startTick: 1`), so tick @k IS step k, and
  // `collect: ['prediction']` gathers the per-tick predictions with each element pointing at its tick's call: round 3 carried
  // a `trail` in the tick state only to collect them.
  C({ id: 'explain.sweepStep', kind: 'tick', in: { state: vec, model, index: { type: 'integer' }, delta: num }, out: { state: vec, prediction: num },
    description: 'one tick of a sweep: the state is the current input; nudge the swept feature by delta and predict',
    // Round 5 (v0.5): a trajectory example. A sweep's specification is the sequence of predictions, not its last value:
    // each tick is checked (-9, -12, -15), so an implementation that agrees at tick 2 and saturates at tick 3 is caught by prove.
    examples: [{ name: 'two ticks, last output', in: { state: [4, 5], model: M, index: 1, delta: 1 }, ticks: 2, out: { state: [4, 7], prediction: -12 } },
      { name: 'three ticks, every prediction', in: { state: [4, 5], model: M, index: 1, delta: 0 }, each: [{ delta: 1 }, { delta: 1 }, { delta: 1 }], trajectory: [{ prediction: -9 }, { prediction: -12 }, { prediction: -15 }] }] });
  I({ id: 'explain.sweepStep/nudge-predict', implements: 'explain.sweepStep', uses: ['explain.nudge', 'explain.predict#sweep'],
    run: ({ state, model: m, index, delta }, ctx) => {
      const nudged = ctx.call('explain.nudge', { input: state, index, delta });
      const p = ctx.call('explain.predict', { model: m, input: nudged.input }, { slot: 'sweep' });
      return { state: nudged.input, prediction: p.value };
    } });

  I({ id: 'explain.sweepStep/saturating', implements: 'explain.sweepStep', uses: ['explain.nudge', 'explain.predict#sweep'], description: 'WRONG on purpose: the prediction saturates at -12 (agrees with the old tick-2 example, not with the trajectory)',
    run: ({ state, model: m, index, delta }, ctx) => {
      const nudged = ctx.call('explain.nudge', { input: state, index, delta });
      const p = ctx.call('explain.predict', { model: m, input: nudged.input }, { slot: 'sweep' });
      return { state: nudged.input, prediction: Math.max(p.value.value, -12) };
    } });

  world.select('explain.sweepStep', 'explain.sweepStep/nudge-predict');

  C({ id: 'explain.sweep', in: { model, input: vec, feature: { type: 'string' }, delta: num, steps: { type: 'integer', minimum: 0 } }, out: { predictions: vec }, tolerance: 1e-12,
    description: 'predictions at the input and after each of `steps` increments of `delta` in one feature (steps + 1 values); steps 0 is just the start',
    examples: [{ in: { model: M, input: [4, 5], feature: 'b', delta: 1, steps: 3 }, out: { predictions: [-6, -9, -12, -15] } },
      { in: { model: M, input: [4, 5], feature: 'b', delta: 1, steps: 0 }, out: { predictions: [-6] } }] });
  I({ id: 'explain.sweep/drive', implements: 'explain.sweep', uses: ['explain.featureIndex', 'explain.predict#start', 'explain.sweepStep'],
    run: ({ model: m, input, feature, delta, steps }, ctx) => {
      const idx = ctx.call('explain.featureIndex', { model: m, feature }).index;
      if (ctx.when({ lt: [idx, 0] }, 'the model has no such feature', { true: 'fault', false: 'continue' })) ctx.fault(`sweep: model has no feature '${feature.value}'`, 'UNKNOWN_FEATURE');
      const p0 = ctx.call('explain.predict', { model: m, input }, { slot: 'start' });
      const d = ctx.drive('explain.sweepStep', { state: input, model: m, index: idx, delta }, { ticks: steps.value, startTick: 1, collect: ['prediction'] });
      return { predictions: ctx.concat([p0.value], d.collected.prediction) };
    } });

  // Hand derivation: [0,2,4,6] with expectedStep 2 -> every change is 2, residual 0. [0,2,5,6]: changes 2, 3, 1; the first
  // that is off is step 2 (change 3, deviation +1), so residual 1 and the reason names step 2.
  C({ id: 'explain.checkConstantStep', kind: 'check', in: { predictions: { type: 'array', minItems: 2, items: num }, expectedStep: num, tolerance: tol }, out: verdict,
    description: 'every consecutive change in the predictions must equal expectedStep (a constant effect over the whole range)',
    examples: [
      { in: { predictions: [0, 2, 4, 6], expectedStep: 2, tolerance: 1e-9 }, out: { accepted: true, residual: 0 } },
      { in: { predictions: [0, 2, 5, 6], expectedStep: 2, tolerance: 1e-9 }, out: { accepted: false, residual: 1 } },
    ] });
  I({ id: 'explain.checkConstantStep/differences', implements: 'explain.checkConstantStep', run: ({ predictions, expectedStep, tolerance }) => {
    const p = predictions.value;
    const diffs = p.slice(1).map((v, i) => v - p[i]);
    const bad = diffs.findIndex((d) => Math.abs(d - expectedStep.value) > tolerance.value);
    const reason = bad < 0
      ? `every one of ${diffs.length} steps changes the prediction by ${fmt(expectedStep.value)} (within ${tolerance.value})`
      : `step ${bad + 1} (${fmt(p[bad])} to ${fmt(p[bad + 1])}) changes the prediction by ${fmt(diffs[bad])}, expected ${fmt(expectedStep.value)}; ${diffs.filter((d) => Math.abs(d - expectedStep.value) > tolerance.value).length} of ${diffs.length} steps are off`;
    return { accepted: bad < 0, reason, residual: bad < 0 ? 0 : diffs[bad] - expectedStep.value, judged: { predictions: point(predictions), ...(bad < 0 ? {} : { firstOffStep: point(predictions, [bad + 1]) }) } };
  } });

  C({ id: 'explain.checkSweep', kind: 'check',
    in: { model, input: vec, feature: { type: 'string' }, delta: num, steps: { type: 'integer', minimum: 1 }, expectedStep: num, tolerance: tol },
    out: { predictions: vec, ...verdict }, tolerance: 1e-12,
    description: 'claim: each increment of `delta` in `feature` changes the prediction by `expectedStep`, at every one of `steps` increments',
    examples: [{ in: { model: M, input: [4, 5], feature: 'b', delta: 1, steps: 3, expectedStep: -3, tolerance: 1e-9 }, out: { predictions: [-6, -9, -12, -15], accepted: true, residual: 0 } }] });
  world.compose({ id: 'explain.checkSweep/composed', implements: 'explain.checkSweep',
    steps: [
      { name: 'sw', call: 'explain.sweep', bind: { model: '$in.model', input: '$in.input', feature: '$in.feature', delta: '$in.delta', steps: '$in.steps' } },
      { name: 'chk', call: 'explain.checkConstantStep', bind: { predictions: 'sw.predictions', expectedStep: '$in.expectedStep', tolerance: '$in.tolerance' } },
    ],
    returns: { predictions: 'sw.predictions', accepted: 'chk.accepted', reason: 'chk.reason', residual: 'chk.residual', judged: 'chk.judged' } });
}

// ------------------------------------------------------------------ helpers around runs (not kernel features)

/** The data of the worked example. Generating definition: price = 50 + 20*size - 4*distance + 0*age (exact). */
export const DATA = {
  features: ['size', 'distance', 'age'],
  rows: [[1, 1, 1], [2, 1, 3], [3, 2, 2], [2, 3, 1], [4, 2, 5], [3, 4, 4], [5, 1, 2], [1, 5, 3]],
  targets: [66, 86, 102, 78, 122, 94, 146, 50],
  input: [4, 6, 9],
  tolerance: 1e-6,
};

/** Resolve a `judged` pointer back to the Part (and the piece of it) that was judged. */
export function resolvePointer(world, pointer) {
  let v = world.part(pointer.hash);
  for (const k of pointer.path ?? []) v = v[k];
  return v;
}

/** The first call under `node` (depth first, node included) for which `match` is true. */
export function findCall(node, match) {
  if (match(node)) return node;
  for (const c of node.calls) { const f = findCall(c, match); if (f) return f; }
  return null;
}

/**
 * Exact pointers from a check's trace node to the calls it judged (v0.3 world.node / world.ref).
 * For every input that arrived from another run, follow that run's recorded provenance down to the call that
 * computed the value: [{ run, call, contract, slot, port }, ...] from the outermost re-export to the innermost producer.
 * Round 2 could only say "run 3, root output"; the verdict Part still points by hash (resolvePointer).
 */
export function judgedCalls(world, node) {
  const found = {};
  for (const [port, { from }] of Object.entries(node.in)) {
    const origin = from.kind === 'run' ? from : from.kind === 'at' && from.of?.kind === 'run' ? from.of : null;
    if (!origin) continue;
    const chain = [];
    let n = world.node(origin.run, origin.from.call); let p = origin.from.port;
    while (n) {
      chain.push({ run: origin.run, call: n.id, contract: n.contract, slot: n.slot, port: p });
      const f = n.out[p]?.from;
      if (!f || f.kind !== 'call') break;
      n = world.node(origin.run, f.call); p = f.port;
    }
    found[port] = chain;
  }
  return found;
}

/** All check calls of a run, straight from the receipt (v0.2 collects them; round 1 had to walk the trace and look kinds up). */
export const checkNodes = (receipt) => receipt.verdicts;

/**
 * The claim table. `honest` is decided by the generating definition (price = 50 + 20*size - 4*distance + 0*age,
 * baseline = column means 2.625, 2.375, 2.625, input (4, 6, 9)), not by running the checker:
 *   contributions: size 20*(4-2.625) = 27.5; distance -4*(6-2.375) = -14.5; age 0*(9-2.625) = 0; prediction 50+80-24 = 106.
 */
export const CLAIMS = [
  { honest: true, text: 'size contributes +27.5', claim: { kind: 'contribution', feature: 'size', value: 27.5 } },
  { honest: true, text: 'distance contributes -14.5', claim: { kind: 'contribution', feature: 'distance', value: -14.5 } },
  { honest: true, text: 'the prediction is 106', claim: { kind: 'prediction', value: 106 } },
  { honest: true, text: 'one more unit of size raises the prediction by 20', claim: { kind: 'effect', feature: 'size', delta: 1, expectedChange: 20 } },
  { honest: true, text: 'age does not matter: +5 age changes the prediction by 0', claim: { kind: 'effect', feature: 'age', delta: 5, expectedChange: 0 } },
  { honest: false, text: 'distance contributes +14.5 (wrong sign)', claim: { kind: 'contribution', feature: 'distance', value: 14.5 } },
  { honest: false, text: "'weight' contributes 3 (no such feature)", claim: { kind: 'contribution', feature: 'weight', value: 3 } },
  { honest: false, text: 'distance contributes +27.5 (the value belongs to size)', claim: { kind: 'contribution', feature: 'distance', value: 27.5 } },
  { honest: false, text: 'the prediction is 110', claim: { kind: 'prediction', value: 110 } },
  { honest: false, text: 'distance does not matter: +2 distance changes the prediction by 0', claim: { kind: 'effect', feature: 'distance', delta: 2, expectedChange: 0 } },
  { honest: false, text: 'one more unit of size lowers the prediction by 20 (wrong sign)', claim: { kind: 'effect', feature: 'size', delta: 1, expectedChange: -20 } },
  { honest: false, text: 'age does not matter, tested with delta 0 (vacuous)', claim: { kind: 'effect', feature: 'age', delta: 0, expectedChange: 0 } },
];
