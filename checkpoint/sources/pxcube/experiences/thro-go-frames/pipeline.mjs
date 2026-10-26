// The whole pipeline, every step a registered Calculation run through runWitnessedCalculation:
//   generate -> enrich/link -> attention, retention dips, release support, clicks, sponsor exposure -> verify every Case.
import { generateWorld } from './generate.mjs';
import { enrichFragment } from './enrich.mjs';
import { attentionMetrics, dipMetrics, releaseMetrics, clickMetrics, exposureMetrics } from './metrics.mjs';
import { deriveFacts, focusSentence } from './meaning.mjs';
import { creatorPanel } from './display.mjs';
import { makeContext } from './context.mjs';
import { DEPARTURES, BASELINE } from './departures.mjs';
import { indexWorld } from './world.mjs';
import { typeProblems, frameSystem, FRAMES } from './frames.mjs';
import { calculation, guarantee, runCalculation } from './calc.mjs';
import { capabilityCount, registry } from './registry.mjs';

export const DEFAULT_SEED = 20261025;

const enrichCalc = calculation({
  id: 'thro.go.enrich',
  description: 'Cross-link a fragment: appearance→disc→mold→manufacturer→release, placement↔appearance, link→disc, click→link→video→placement, video→bag→sponsor deal.',
  calculate: (entry) => ({ output: enrichFragment(entry.instances, entry.name) }),
  guarantees: [
    guarantee('every-violation-selects-something', 'Every violated expectation selected an alternate frame or a transformation, and nothing was transformed without a violation.', (it) => (it.output.unhandled.length || it.output.spurious.length ? `unhandled ${it.output.unhandled.join(',')} spurious ${it.output.spurious.join(',')}` : true)),
    guarantee('no-dangling-links', 'Every edge joins two things that exist (instances, appearances or alternate-frame instances).', (it) => {
      const ids = new Set([...it.input.instances.map((i) => i.id), ...it.output.appearances.map((a) => a.id), ...it.output.alternates.map((a) => a.id)]);
      const bad = it.output.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
      return bad.length ? `${bad[0].from} -${bad[0].rel}-> ${bad[0].to}` : true;
    }),
    guarantee('every-appearance-fully-linked', 'Every appearance links to a disc, a video, and (if it has a card) a card placement; every disc links to a mold or a provisional mold.', (it) => {
      for (const a of it.output.appearances) {
        const has = (rel) => it.output.edges.some((e) => e.from === a.id && e.rel === rel);
        if (!has('of') || !has('in')) return `${a.id} not linked to disc/video`;
        if (a.hasCard && !has('shownBy')) return `${a.id} has a card but no shownBy`;
        const d = it.output.discs[a.discId];
        if (!d.moldId && !d.provisionalMoldId) return `${a.discId} has no mold`;
      }
      return true;
    }),
    guarantee('every-click-has-one-attribution', 'Every click is credited to a moment, to the video, or explicitly to nothing (with a reason), never two at once.', (it) => {
      for (const c of it.output.clicks) { const k = c.attribution.kind; if (!['moment', 'video', 'unattributed'].includes(k)) return `${c.id}: ${k}`; if (k === 'unattributed' && !c.attribution.reason) return `${c.id} unattributed without reason`; if (k !== 'unattributed' && !c.attribution.appearanceId) return `${c.id} credited to nothing`; }
      return true;
    }),
    guarantee('appearance-seconds-inside-video', 'Every appearance lies inside its video and has positive length.', (it) => { const bad = it.output.appearances.find((a) => a.start < 0 || a.end > it.output.videos[a.videoId].duration || a.end <= a.start); return bad ? bad.id : true; }),
  ],
});

const metricCalc = (id, description, fn, guarantees) => calculation({ id, description, calculate: (entry) => ({ output: fn(entry) }), guarantees });
const EPS = 1e-6;
const attentionCalc = metricCalc('thro.go.attention', 'Attention-seconds per appearance, disc-in-video, disc and mold, through thro.attentionSeconds and statistics.sum.', (e) => attentionMetrics(e.W, e.E), [
  guarantee('bounded-by-views-times-seconds', 'Attention is between 0 and views x seconds on screen.', (it) => { for (const [id, a] of Object.entries(it.output.attention)) if (a.value != null && (a.value < 0 || a.value > a.views * a.seconds + EPS)) return id; return true; }),
  guarantee('null-exactly-when-unmeasurable', 'Attention is null exactly when retention is unavailable (no views / Studio not connected), and never a silent zero.', (it) => { for (const [id, a] of Object.entries(it.output.attention)) if ((a.value == null) !== (a.state !== 'ok')) return id; return true; }),
  guarantee('every-number-has-a-receipt', 'Every computed attention value carries a Capability Lab receipt rooted at thro.attentionSeconds.', (it) => { for (const [id, a] of Object.entries(it.output.attention)) if (a.value != null && a.receipt?.capability !== 'thro.attentionSeconds') return id; return true; }),
  guarantee('rollups-add-up', 'Disc totals equal the sum of their disc-in-video totals.', (it) => { for (const [d, v] of Object.entries(it.output.byDisc)) { const s = Object.entries(it.output.byDiscVideo).filter(([k]) => k.startsWith(`${d}@`)).reduce((t, [, x]) => t + x.value, 0); if (Math.abs(s - v.value) > EPS * Math.max(1, s)) return d; } return true; }),
]);
const dipCalc = metricCalc('thro.go.retentionDip', 'Retention inside each placement vs the seconds around it, through thro.retentionDip (statistics.mean).', (e) => dipMetrics(e.W, e.E), [
  guarantee('dip-flag-matches-drop', 'dipped is true exactly when the drop exceeds 0.05.', (it) => { for (const [id, d] of Object.entries(it.output.dips)) if (d && d.dipped !== (d.drop > 0.05)) return id; return true; }),
]);
const releaseCalc = metricCalc('thro.go.releaseSupport', 'Which videos sit around a release date, and at what offset (a range when the date is only a month).', (e) => releaseMetrics(e.W, e.E, e.att), [
  guarantee('classes-consistent-with-offsets', 'pre-release ⇔ offsets negative; release-window ⇔ 0..30 days; established ⇔ over 30 days.', (it) => { for (const r of it.output.releases) for (const v of r.videos) { const ok = v.class === 'pre-release' ? v.offsetMax < 0 : v.class === 'release-month' ? v.offsetMin < 0 && v.offsetMax >= 0 : v.class === 'release-window' ? v.offsetMin >= 0 && v.offsetMin <= 30 : v.offsetMin > 30; if (!ok) return `${v.appearanceId} ${v.class} ${v.offsetMin}..${v.offsetMax}`; } return true; }),
]);
const clickCalc = metricCalc('thro.go.clicks', 'Clicks per link/disc, how each is credited, and clicks per 1,000 attention-seconds (thro.ratio).', (e) => clickMetrics(e.W, e.E, e.att), [
  guarantee('click-counts-add-up', 'Per-link counts add up to the number of clicks; moment + video + unattributed = total.', (it) => { const sum = Object.values(it.output.byLink).reduce((s, l) => s + l.total, 0); const parts = Object.values(it.output.byLink).every((l) => l.moment + l.video + l.unattributed === l.total); return sum === it.output.total && parts ? true : 'mismatch'; }),
]);
const exposureCalc = metricCalc('thro.go.sponsorExposure', 'Exposure minutes per sponsor per quarter (overlapping cards counted once), through thro.attentionSeconds and thro.ratio.', (e) => exposureMetrics(e.W, e.E, e.att), [
  guarantee('union-never-exceeds-sum', 'Counting overlapping cards once never gives more than adding the cards\' attention separately.', (it) => { for (const r of it.output.rows) for (const e of r.entries) if (e.unionAttention > e.sumAttention + EPS) return `${r.key} ${e.videoId}`; return true; }),
  guarantee('minutes-are-attention-over-sixty', 'Each entry\'s minutes equal its union attention-seconds / 60.', (it) => { for (const r of it.output.rows) for (const e of r.entries) if (Math.abs(e.minutes - e.unionAttention / 60) > EPS) return r.key; return true; }),
]);

export function fragmentsOf(world) {
  const byCase = new Map(world.cases.map((c) => [c.id, []]));
  for (const i of world.instances) byCase.get(i.caseId).push(i);
  return byCase;
}

export function runPipeline(seed = DEFAULT_SEED) {
  const { world, report: generateReport } = generateWorld(seed);
  const frags = fragmentsOf(world);
  const Ws = Object.fromEntries([...frags].map(([id, inst]) => [id, indexWorld(inst)]));
  const corpus = world.cases.map((c) => ({ name: c.id, instances: frags.get(c.id), world: Ws[c.id] }));
  const enrichReport = runCalculation(enrichCalc, corpus.map((e) => ({ ...e })));
  // guarantees above read it.world, so attach for the runner by wrapping witnessItem output
  const enriched = enrichReport.outputs;
  const mk = (extra) => world.cases.map((c) => ({ name: c.id, W: Ws[c.id], E: enriched[c.id], ...extra(c) }));
  const att = runCalculation(attentionCalc, mk(() => ({})));
  const dip = runCalculation(dipCalc, mk(() => ({})));
  const rel = runCalculation(releaseCalc, mk((c) => ({ att: att.outputs[c.id] })));
  const clk = runCalculation(clickCalc, mk((c) => ({ att: att.outputs[c.id] })));
  const exp = runCalculation(exposureCalc, mk((c) => ({ att: att.outputs[c.id] })));
  const metrics = Object.fromEntries(world.cases.map((c) => [c.id, { attention: att.outputs[c.id], dips: dip.outputs[c.id], releases: rel.outputs[c.id], clicks: clk.outputs[c.id], exposure: exp.outputs[c.id] }]));

  const depIndex = Object.fromEntries([...Object.values(DEPARTURES).flat(), BASELINE].map((d) => [d.id, d]));
  const verifyCalc = calculation({
    id: 'thro.go.verifyCase',
    description: 'Run each Case\'s executable expectation against the enriched, linked result and the page view model; produce the meaning sentence from the linked data.',
    calculate: (entry) => {
      const c = entry.meta, W = Ws[c.id], E = enriched[c.id], M = metrics[c.id];
      const facts = deriveFacts(W, E, M);
      const x = makeContext({ meta: c, W, E, M, facts });
      const checks = [];
      for (const part of c.parts) {
        try { checks.push(...depIndex[part.departure].expect(x).flat()); }
        catch (err) { checks.push({ label: `expectation of ${part.departure} could not be evaluated`, expected: 'no error', actual: String(err.message), pass: false }); }
      }
      checks.push(x.check('no dangling references anywhere in the fragment', [], typeProblems(W)));
      checks.push(x.check('every violated expectation selected an alternate frame or a transformation', [], [...E.unhandled, ...E.spurious]));
      const meaning = c.parts.map((p) => { const f = focusSentence(facts, p.focus, c.keys, W); return f ? f.sentence : null; });
      checks.push(x.check('a meaning sentence was produced from the linked data for every focus', true, meaning.every(Boolean)));
      const panels = Object.fromEntries(E.creators.map((id) => [id, creatorPanel(W, E, M, id)]));
      return { output: { id: c.id, pass: checks.every((k) => k.pass), checks, meaning, focusKinds: c.parts.map((p) => p.focus?.kind ?? null), panels, facts } };
    },
    guarantees: [guarantee('every-case-expectation-passes', 'Every Case\'s executable expectation passes.', (it) => (it.output.pass ? true : it.output.checks.filter((k) => !k.pass).map((k) => k.label).join(' | ')))],
  });
  const verifyReport = runCalculation(verifyCalc, world.cases.map((c) => ({ name: c.id, meta: c })));
  const verdicts = verifyReport.outputs;
  const reports = [generateReport, enrichReport, att, dip, rel, clk, exp, verifyReport].map(({ outputs, ...r }) => r);
  return { seed, world, enriched, metrics, verdicts, reports, frames: frameSystem(), capabilityCount: capabilityCount() };
}
