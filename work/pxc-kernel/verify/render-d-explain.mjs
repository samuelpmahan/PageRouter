// Render contest D (round 6, kernel v0.6) from real runs. Pictures: d1 d1b d2 d2d d3 d4 d4b d5 d5b d5c d6 d7 d8 d9 d10 d10b d11 d12.
import fs from 'node:fs';
import path from 'node:path';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, traceHtml } from '../src/view.mjs';
import { register, DATA, CLAIMS, findCall, judgedCalls } from '../contest/d-explain/index.mjs';
import { waterfallSvg, claimsTableHtml, sweepPlotSvg, lineageHtml } from '../contest/d-explain/view.mjs';

const POS_COLOR = '#2a62c9'; const NEG_COLOR = '#d9730d';
const outDir = process.argv[2] ?? 'verify/out';
fs.mkdirSync(outDir, { recursive: true });
const w = createWorld({ name: 'd-explain' });
register(w);

const fit = w.run('explain.fit', { features: DATA.features, rows: DATA.rows, targets: DATA.targets });
const base = w.run('explain.baselineMeans', { rows: DATA.rows });
const model = fit.outputs.model; const baseline = base.outputs.baseline;
const exp = w.run('explain.explain', { model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline, tolerance: DATA.tolerance });
const detail = { input: DATA.input, baseline, coefficients: model.coefficients };
const T = (t, tr) => traceToSvg(tr, w.part, { title: t });
// v0.5: a run whose fill matters prints it under the title, and marks keys no call consulted
const TR = (t, run, extra = {}) => traceToSvg(run.trace, w.part, { title: t, receipt: run.receipt, ...extra });

// d1: the explain-and-check trace (the reconstruction check is a green box; model and baseline arrive from runs 1 and 2)
fs.writeFileSync(path.join(outDir, 'd1-explain-trace.html'),
  traceHtml([T('D1  explain.explain: attribute, then check that baseline + contributions reconstructs the prediction', exp.trace)]));
// d1b: the fit, to show the gathered model
fs.writeFileSync(path.join(outDir, 'd1b-fit-trace.html'),
  traceHtml([traceToSvg(fit.trace, w.part, { title: 'D1b  explain.fit: model = gather(features, coefficients)', maxDepth: 2 })]));

// d2: waterfalls. The mutant now runs in THE SAME world, before the claims (round 1 needed a separate world).
const tampered = [exp.outputs.contributions[0], exp.outputs.contributions[1], 3];
const tamperRun = w.run('explain.checkReconstruction', { baselinePrediction: exp.outputs.baselinePrediction, contributions: tampered, prediction: exp.outputs.prediction, tolerance: DATA.tolerance });
const mutant = w.run('explain.explain', { model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline, tolerance: DATA.tolerance },
  { fill: { 'explain.contributions': 'explain.contributions/no-baseline' } });
const wf = (o, t) => waterfallSvg({ features: model.features, baselinePrediction: o.baselinePrediction, contributions: o.contributions, prediction: o.prediction, tolerance: DATA.tolerance, detail }, { title: t });
fs.writeFileSync(path.join(outDir, 'd2-waterfall.html'), traceHtml([
  wf(exp.outputs, 'D2a  waterfall of the honest attribution (explain.explain, run #3)'),
  wf({ ...exp.outputs, contributions: tampered }, `D2b  age contribution tampered to +3: checkReconstruction accepted=${tamperRun.outputs.accepted}`),
  wf(mutant.outputs, `D2c  no-baseline contributions swapped in: explain.explain accepted=${mutant.outputs.accepted}`),
]));
fs.writeFileSync(path.join(outDir, 'd2d-mutant-trace.html'),
  traceHtml([TR('D2d  mutant run: no-baseline contributions, reconstruction box red', mutant)]));

// d3: claims table. Every claim is checked against run #3's own outputs through cross-run Refs.
const rows = CLAIMS.map((entry, i) => {
  const r = w.run('explain.checkClaim', { claim: entry.claim, model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline,
    prediction: exp.refs.prediction, contributions: exp.refs.contributions, tolerance: DATA.tolerance });
  return { n: i + 1, text: entry.text, claim: entry.claim, honest: entry.honest, accepted: r.outputs.accepted, reason: r.outputs.reason,
    residual: r.outputs.residual, claimHash: r.trace.in.claim.hash.slice(0, 8), run: r };
});
fs.writeFileSync(path.join(outDir, 'd3-claims.html'), claimsTableHtml(rows, { title: 'D3  explain.checkClaim over 12 claims (5 honest, 7 fabricated), judged against run #3 by cross-run Refs' }));

// d4: a rejected effect claim, routed by `when`: the root records five decisions (one ran, four skipped).
// d4b: a rejected contribution claim whose wrong value belongs to another feature: ctx.when decisions inside the branch.
// d5: a claim attached to run #3 after the fact (look for the "← run k" tags).
fs.writeFileSync(path.join(outDir, 'd4-rejected-effect-trace.html'),
  traceHtml([T('D4  explain.checkClaim: "distance does not matter" (claim 10), rejected; routed by tests, else and one', rows[9].run.trace)]));
fs.writeFileSync(path.join(outDir, 'd4b-contribution-hint-trace.html'),
  traceHtml([T('D4b  explain.checkClaim: "distance contributes +27.5" (claim 8): ctx.when decides the hint', rows[7].run.trace)]));
fs.writeFileSync(path.join(outDir, 'd5-attach.html'),
  traceHtml([T('D5  claim 3 checked after the fact, inputs from runs 1, 2, 3', rows[2].run.trace)]));

// d5b: attach to an INNER call of run 3 with world.ref (round 2 could only attach root outputs)
const baseCall = findCall(w.node(exp.receipt.runId, 1), (c) => c.contract === 'explain.predict' && c.slot === 'baseline');
const inner = w.run('explain.checkAgreement', { claimed: 93, actual: w.ref(exp.receipt.runId, baseCall.id, 'value'), tolerance: DATA.tolerance, subject: 'baseline prediction' });
fs.writeFileSync(path.join(outDir, 'd5b-inner-call-attach.html'),
  traceHtml([T(`D5b  actual ← run ${exp.receipt.runId} inner call`, inner.trace)]));
// d5c: where the judged values came from, by world.node
const lin = judgedCalls(w, rows[7].run.trace);
fs.writeFileSync(path.join(outDir, 'd5c-lineage.html'), lineageHtml(
  ['model', 'baseline', 'prediction', 'contributions'].map((port) => ({ port, value: JSON.stringify(rows[7].run.trace.in[port] && w.part(rows[7].run.trace.in[port].hash)).slice(0, 40), chain: lin[port] })),
  { title: 'D5c  claim 8 ("distance contributes +27.5"): the recorded calls behind each judged input', note: 'Built by judgedCalls(world, node): each input that arrived from another run is followed through world.node to the call that computed it. Green = the call whose implementation computed the value.' }));

// d6: combining verdicts: checkedClaim = attribute + reconstruction + claim + allAccepted over gathered verdicts
const checked = (claim, opts) => w.run('explain.checkedClaim', { claim, model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline, tolerance: DATA.tolerance }, opts);
const honest = checked({ kind: 'contribution', feature: 'size', value: 27.5 });
const bad = checked({ kind: 'contribution', feature: 'size', value: 80 }, { fill: { 'explain.contributions': 'explain.contributions/no-baseline' } });
fs.writeFileSync(path.join(outDir, 'd6-checked-claim.html'), traceHtml([
  traceToSvg(honest.trace, w.part, { title: 'D6a  checkedClaim: "size +27.5", every verdict accepted (4 boxes + 2 in cached rows)', maxDepth: 2 }),
  traceToSvg(bad.trace, w.part, { title: 'D6b  checkedClaim: "size +80" vs the no-baseline attribution', maxDepth: 2 }),
]));

// d7: slots in the effect check
const eff = w.run('explain.effect', { model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline, feature: 'size', delta: 1 }, { cache: false });
fs.writeFileSync(path.join(outDir, 'd7-effect-slots.html'), traceHtml([traceToSvg(eff.trace, w.part, { title: 'D7  explain.effect: calls named by slot', maxDepth: 1 })]));


// d8: a repeated claim is one cache hit at the root; the receipt still lists the verdicts of the whole cached subtree,
// and expand draws the original subtree as ghost boxes (world.node(cachedFrom.run, cachedFrom.call)).
const again = w.run('explain.checkClaim', { claim: CLAIMS[3].claim, model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline,
  prediction: exp.refs.prediction, contributions: exp.refs.contributions, tolerance: DATA.tolerance });
const expand = (n) => w.node(n.cachedFrom.run, n.cachedFrom.call);
fs.writeFileSync(path.join(outDir, 'd8-cached-ghosts.html'), traceHtml([
  traceToSvg(again.trace, w.part, { title: `D8  claim 4 run again (run ${again.receipt.runId}): a cache hit at the root, original subtree as ghosts`, expand, maxDepth: 3 }),
]));

// d9: a sweep: ctx.drive makes one child per tick (@k); a longer sweep reuses the first ticks from the cache (ghosts show where from)
const sweepArgs = (steps, over = {}) => ({ model: fit.refs.model, input: DATA.input, feature: 'size', delta: 1, steps, expectedStep: 20, tolerance: DATA.tolerance, ...over });
const sw3 = w.run('explain.checkSweep', sweepArgs(3));
const sw5 = w.run('explain.checkSweep', sweepArgs(5));
fs.writeFileSync(path.join(outDir, 'd9-sweep-trace.html'), traceHtml([
  traceToSvg(sw3.trace, w.part, { title: `D9a  checkSweep, size +1 x 3 (run ${sw3.receipt.runId}): ticks @1..@3 of explain.sweepStep, collected`, maxDepth: 3 }),
  traceToSvg(sw5.trace, w.part, { title: `D9b  the same, 5 steps (run ${sw5.receipt.runId}): ticks @1..@3 are cache hits, ghosts show their origin`, expand, maxDepth: 3 }),
]));

// d10: the capped predictor: every other check accepts it, only the sweep rejects it
const capped = { 'explain.predict': 'explain.predict/capped' };
const cap = w.run('explain.checkSweep', sweepArgs(4), { fill: capped });
const honest4 = w.run('explain.checkSweep', sweepArgs(4));
const capPoint = w.run('explain.checkClaim', { claim: CLAIMS[3].claim, model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline,
  prediction: exp.refs.prediction, contributions: exp.refs.contributions, tolerance: DATA.tolerance }, { fill: capped });
const capRec = w.run('explain.explain', { model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline, tolerance: DATA.tolerance }, { fill: capped });
const offStep = (o) => (o.accepted ? undefined : Number(/^step (\d+)/.exec(o.reason)[1]));
fs.writeFileSync(path.join(outDir, 'd10-sweep-plot.html'), traceHtml([sweepPlotSvg({ expectedStep: 20, tolerance: 1e-6, runs: [
  { name: `predict/dot: sweep accepted=${honest4.outputs.accepted}`, values: honest4.outputs.predictions, color: POS_COLOR, accepted: honest4.outputs.accepted },
  { name: `predict/capped: sweep accepted=${cap.outputs.accepted}, claim 4 accepted=${capPoint.outputs.accepted}, reconstruction accepted=${capRec.outputs.accepted}`, values: cap.outputs.predictions, color: NEG_COLOR, accepted: cap.outputs.accepted, offStep: offStep(cap.outputs) },
] }, { title: 'D10  size +1 four times: only the sweep sees the cap' })]));
fs.writeFileSync(path.join(outDir, 'd10b-capped-trace.html'),
  traceHtml([TR(`D10b  checkSweep with explain.predict/capped (run ${cap.receipt.runId}): tick @2 (step 2) is the first to predict 130, the check rejects`, cap, { maxDepth: 3 })]));


// d11: a path slot fill reaches ONE call site: only the nudged prediction of the effect check is capped
const bigClaim = { kind: 'effect', feature: 'size', delta: 3, expectedChange: 60 };
const pathRun = w.run('explain.checkClaim', { claim: bigClaim, model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline,
  prediction: exp.refs.prediction, contributions: exp.refs.contributions, tolerance: DATA.tolerance },
  { fill: { 'explain.attribute#after/explain.predict#input': 'explain.predict/capped' }, cache: false });
fs.writeFileSync(path.join(outDir, 'd11-path-slot.html'),
  traceHtml([TR('D11  effect claim size +3 with one path fill', pathRun)]));
// d12 (round 5): a flat slot fill nobody consulted. A prediction claim never reaches explain.predict#input; the path key of d11 would be BAD_FILL here (v0.5), the flat key is standing configuration and the receipt line marks it unconsulted
const idle = w.run('explain.checkClaim', { claim: CLAIMS[2].claim, model: fit.refs.model, input: DATA.input, baseline: base.refs.baseline,
  prediction: exp.refs.prediction, contributions: exp.refs.contributions, tolerance: DATA.tolerance },
  { fill: { 'explain.predict#input': 'explain.predict/capped' }, cache: false });
fs.writeFileSync(path.join(outDir, 'd12-unconsulted-fill.html'),
  traceHtml([TR('D12  prediction claim 3 with the flat fill explain.predict#input: accepted, and nothing consulted it', idle)]));
const reachNodes = (run, key) => run.receipt.fillReach[key].map((id) => { const n = w.node(run.receipt.runId, id); return `#${id} ${n.contract}#${n.slot} ${n.impl} by ${n.chosenBy.rung}`; });

fs.writeFileSync(path.join(outDir, 'd-facts.json'), JSON.stringify({
  model, baseline, attribution: exp.outputs, tamperVerdict: tamperRun.outputs, mutantVerdict: mutant.outputs.accepted,
  checkedHonest: honest.outputs, checkedBad: bad.outputs, verdictsHonest: honest.receipt.verdicts.map((v) => [v.call, v.contract, v.accepted]),
  verdictsBad: bad.receipt.verdicts.map((v) => [v.call, v.contract, v.accepted]),
  claims: rows.map(({ run, ...r }) => r), stats: w.stats(),
  pictures: {
    d4: { root: rows[9].run.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: rows[9].run.trace.decisions.map((d) => `${d.label}=${d.value}${d.ran ? ' ran' : ' skipped'}`),
      ops: rows[9].run.trace.decisions.map((d) => `${d.label}:${d.from.op}`) },
    d5: { decisions: rows[2].run.trace.decisions.map((d) => `${d.label}:${d.from.op}`) },
    d4b: { branch: findCall(rows[7].run.trace, (c) => c.contract === 'explain.checkContributionClaim').decisions.map((d) => `${d.label}=${d.value}`), reason: rows[7].outputs_reason ?? rows[7].reason },
    d5b: { accepted: inner.outputs.accepted, from: inner.trace.in.actual.from, baseCall: baseCall.id },
    d5c: Object.fromEntries(Object.entries(lin).map(([k, v]) => [k, v.map((c) => `#${c.call} ${c.contract}${c.slot ? '#' + c.slot : ''}.${c.port}`)])),
    d6: { honest: honest.receipt.verdicts.map((v) => `#${v.call} ${v.contract}${v.cached ? ' (cached)' : ''}`) },
    d8: { cached: again.trace.cached, cachedFrom: again.trace.cachedFrom, verdicts: again.receipt.verdicts.map((v) => `${v.contract}${v.cached ? ' cached' : ''}`) },
    d9: { a: sw3.trace.calls[0].calls.map((c) => `#${c.id} ${c.contract}${c.tick !== undefined ? '@' + c.tick : ''}${c.cached ? ' cached' : ''}`),
      b: sw5.trace.calls[0].calls.map((c) => `#${c.id} ${c.contract}${c.tick !== undefined ? '@' + c.tick : ''}${c.cached ? ' cached' : ''}`),
      predictionsA: sw3.outputs.predictions, predictionsB: sw5.outputs.predictions },
    d12: { accepted: idle.outputs.accepted, fill: idle.receipt.fill, fillConsulted: idle.receipt.fillConsulted, reach: idle.receipt.fillReach },
    d11: { fillConsulted: pathRun.receipt.fillConsulted, fill: pathRun.receipt.fill, accepted: pathRun.outputs.accepted, reason: pathRun.outputs.reason, reach: pathRun.receipt.fillReach, landed: reachNodes(pathRun, 'explain.attribute#after/explain.predict#input') },
    d10: { honest: honest4.outputs.predictions, capped: cap.outputs.predictions, cappedReason: cap.outputs.reason,
      acceptedBy: { sweep: cap.outputs.accepted, pointwiseClaim4: capPoint.outputs.accepted, reconstruction: capRec.outputs.accepted } },
  },
}, null, 1));
console.log('d1 d1b d2 d2d d3 d4 d4b d5 d5b d5c d6 d7 d8 d9 d10 d10b d11 d12');
