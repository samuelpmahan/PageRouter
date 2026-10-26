// The analysis chain for ANY world (the shared season, or the season after a Case's departure): every step is a registered Calculation run through
// runWitnessedCalculation, so every numbers-producing step has guarantees and every number has a Capability Lab receipt.
//   enrich (link) -> attention -> retention dip -> release support -> clicks -> sponsor exposure
import { enrichWorld } from './enrich.mjs';
import { attentionMetrics, dipMetrics, releaseMetrics, clickMetrics, exposureMetrics } from './metrics.mjs';
import { indexWorld, sponsorBucket, publishDay, resolveMold } from './world.mjs';
import { checkExpectations, typeProblems, expectationsFor } from './frames.mjs';
import { projectResults } from './projection.mjs';
import { calculation, guarantee, runCalculation } from './calc.mjs';

const EPS = 1e-6;
const rel = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

export const enrichCalc = calculation({
  id: 'thro.go.enrich',
  description: 'Cross-link the whole world: card/mark→appearance→disc→mold→manufacturer→release, click→link→video→card, video→bag→sponsor deal. Mismatches are resolved by the frames\' own alternate frames and transformations.',
  calculate: (entry) => ({ output: enrichWorld(entry.instances) }),
  guarantees: [
    guarantee('every-soft-violation-selected-something', 'Every violated soft expectation was handled by the alternate frame or transformation its mismatch names, and every handler fired because of a violation.', (it) => {
      const soft = it.output.violations.filter((v) => v.mismatch);
      const noted = new Set(it.output.transformations.map((n) => `${n.instanceId}#${n.expectationId}`));
      const missing = soft.filter((v) => !noted.has(`${v.instanceId}#${v.expectationId}`));
      const spurious = it.output.transformations.filter((n) => n.onAlternate == null && !soft.some((v) => v.instanceId === n.instanceId && v.expectationId === n.expectationId));
      return missing.length || spurious.length ? `unhandled ${missing.slice(0, 2).map((v) => `${v.instanceId}#${v.expectationId}`).join(',')} spurious ${spurious.slice(0, 2).map((n) => `${n.instanceId}#${n.expectationId}`).join(',')}` : true;
    }),
    guarantee('no-hard-violations', 'No hard expectation (mismatch = null) is violated anywhere in the world: bad data is rejected, never explained away.', (it) => { const v = it.output.violations.filter((x) => !x.mismatch); return v.length ? v.slice(0, 3).map((x) => `${x.instanceId}#${x.expectationId}`).join(', ') : true; }),
    guarantee('types-and-references', 'Every terminal value has its declared type and every reference resolves to an instance of the right frame.', (it) => { const p = typeProblems(it.input.W); return p.length ? p.slice(0, 2).join('; ') : true; }),
    guarantee('alternates-satisfy-their-own-hard-expectations', 'Every alternate frame instance meets its own (inherited and added) hard expectations: inheriting did not break the invariants.', (it) => {
      for (const a of it.output.alternates) for (const { terminal, e } of expectationsFor(a)) if (!e.mismatch && !e.test(a.t[terminal], a, it.input.W)) return `${a.id}#${e.id}`;
      return true;
    }),
    guarantee('no-dangling-links', 'Every edge joins two things that exist (instances, appearances or alternate-frame instances).', (it) => {
      const ids = new Set([...it.input.instances.map((i) => i.id), ...it.output.appearances.map((a) => a.id), ...it.output.alternates.map((a) => a.id)]);
      const bad = it.output.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
      return bad.length ? `${bad[0].from} -${bad[0].rel}-> ${bad[0].to}` : true;
    }),
    guarantee('every-appearance-fully-linked', 'Every appearance links to a disc, a video, and (if it has a card) a card; every disc links to a mold or a provisional mold.', (it) => {
      for (const a of it.output.appearances) {
        const has = (rel) => it.output.edges.some((e) => e.from === a.id && e.rel === rel);
        if (!has('of') || !has('in')) return `${a.id} not linked to disc/video`;
        if (a.hasCard && !has('shownBy')) return `${a.id} has a card but no shownBy`;
        const d = it.output.discs[a.discId];
        if (!d.moldId && !d.provisionalMoldId) return `${a.discId} has no mold`;
      }
      return true;
    }),
    guarantee('sponsor-bucket-agrees-with-deal-lookup', 'The sponsor bucket the OtherBrandAppearance frame carried equals a direct lookup of the deals active on the video\'s local publish day.', (it) => {
      const W = it.input.W;
      for (const a of it.output.appearances) {
        const v = W.get(a.videoId), creator = W.get(W.get(v.t.channelId).t.creatorId), mold = resolveMold(W, W.get(a.discId))?.mold ?? null;
        const want = sponsorBucket(W, creator.id, publishDay(W, v), mold).bucket;
        if (want !== a.bucket) return `${a.id}: frame says ${a.bucket}, deals say ${want}`;
      }
      return true;
    }),
    guarantee('every-click-has-one-attribution', 'Every click is credited to one moment, to the disc in the video, or explicitly to nothing (with a reason), never two at once.', (it) => {
      for (const c of it.output.clicks) {
        const k = c.attribution.kind;
        if (!['moment', 'video', 'unattributed'].includes(k)) return `${c.id}: ${k}`;
        if (k === 'unattributed' && (!c.attribution.reason || c.attribution.appearanceIds.length)) return `${c.id} unattributed without a reason or with credit`;
        if (k === 'moment' && (!c.attribution.appearanceId || c.attribution.appearanceIds.length !== 1)) return `${c.id} moment credit must name exactly one appearance`;
        if (k === 'video' && (c.attribution.appearanceId !== null || !c.attribution.appearanceIds.length)) return `${c.id} video credit must name the disc in the video, not one appearance`;
      }
      return true;
    }),
    guarantee('appearance-seconds-inside-video', 'Every appearance lies inside its video and has positive length.', (it) => { const bad = it.output.appearances.find((a) => a.start < 0 || a.end > it.output.videos[a.videoId].duration || a.end <= a.start); return bad ? bad.id : true; }),
  ],
});
const metricCalc = (id, description, fn, guarantees) => calculation({ id, description, calculate: (entry) => ({ output: fn(entry) }), guarantees });
export const attentionCalc = metricCalc('thro.go.attention', 'Attention-seconds per appearance, disc-in-video, disc and mold (Shorts and long videos reported apart), through thro.attentionSeconds and statistics.sum.', (e) => attentionMetrics(e.W, e.E), [
  guarantee('bounded-by-views-times-seconds', 'Attention is between 0 and views x seconds on screen x the largest retention fraction (a looping Short can pass 1).', (it) => { for (const [id, a] of Object.entries(it.output.attention)) if (a.value != null && (a.value < 0 || a.value > a.views * a.seconds * 1.5 + EPS)) return id; return true; }),
  guarantee('null-exactly-when-unmeasurable', 'Attention is null exactly when retention is unavailable (no views / no Studio / no curve), and never a silent zero.', (it) => { for (const [id, a] of Object.entries(it.output.attention)) if ((a.value == null) !== (a.state !== 'ok')) return id; return true; }),
  guarantee('every-number-has-a-receipt', 'Every computed attention value carries a Capability Lab receipt rooted at thro.attentionSeconds.', (it) => { for (const [id, a] of Object.entries(it.output.attention)) if (a.value != null && a.receipt?.capability !== 'thro.attentionSeconds') return id; return true; }),
  guarantee('rollups-add-up', 'Disc totals equal the sum of their disc-in-video totals, and Short + long equals the total.', (it) => {
    for (const [d, v] of Object.entries(it.output.byDisc)) {
      const s = Object.entries(it.output.byDiscVideo).filter(([k]) => k.startsWith(`${d}@`)).reduce((t, [, x]) => t + x.value, 0);
      if (!rel(s, v.value)) return d;
      const f = (v.byFormat.long?.value ?? 0) + (v.byFormat.short?.value ?? 0);
      if (!rel(f, v.value)) return `${d} format split`;
    }
    for (const [m, v] of Object.entries(it.output.byMold)) { const f = (v.byFormat.long?.value ?? 0) + (v.byFormat.short?.value ?? 0); const c = Object.values(v.perCreator).reduce((t, x) => t + x, 0); if (!rel(f, v.value) || !rel(c, v.value)) return m; }
    return true;
  }),
]);
export const dipCalc = metricCalc('thro.go.retentionDip', 'Retention inside each card vs the seconds around it, through thro.retentionDip (statistics.mean).', (e) => dipMetrics(e.W, e.E), [
  guarantee('dip-flag-matches-drop', 'dipped is true exactly when the drop exceeds 0.05.', (it) => { for (const [id, d] of Object.entries(it.output.dips)) if (d && d.dipped !== (d.drop > 0.05)) return id; return true; }),
]);
export const releaseCalc = metricCalc('thro.go.releaseSupport', 'Which videos sit around a release date, and at what offset (a range when the date is only a month), using each release\'s own window length.', (e) => releaseMetrics(e.W, e.E, e.att), [
  guarantee('classes-consistent-with-offsets', 'pre-release ⇔ offsets negative; release-window ⇔ 0..windowDays; established ⇔ over windowDays.', (it) => {
    for (const r of it.output.releases) for (const v of r.videos) {
      const ok = v.class === 'pre-release' ? v.offsetMax < 0 : v.class === 'release-month' ? v.offsetMin <= 0 && v.offsetMax >= 0 : v.class === 'release-window' ? v.offsetMin >= 0 && v.offsetMin <= v.windowDays : v.offsetMin > v.windowDays;
      if (!ok) return `${v.appearanceId} ${v.class} ${v.offsetMin}..${v.offsetMax} window ${v.windowDays}`;
    }
    return true;
  }),
]);
export const clickCalc = metricCalc('thro.go.clicks', 'Clicks per link/disc, how each is credited, days after publish, and clicks per 1,000 attention-seconds (thro.ratio).', (e) => clickMetrics(e.W, e.E, e.att), [
  guarantee('click-counts-add-up', 'Per-link counts add up to the number of clicks; moment + video + unattributed = total.', (it) => { const sum = Object.values(it.output.byLink).reduce((s, l) => s + l.total, 0); const parts = Object.values(it.output.byLink).every((l) => l.moment + l.video + l.unattributed === l.total); return sum === it.output.total && parts ? true : 'mismatch'; }),
]);
export const exposureCalc = metricCalc('thro.go.sponsorExposure', 'Viewer-minutes on screen per sponsor (or other brand) per quarter across creators (overlapping cards counted once), through thro.attentionSeconds and thro.ratio.', (e) => exposureMetrics(e.W, e.E, e.att), [
  guarantee('union-never-exceeds-sum', 'Counting overlapping cards once never gives more than adding the cards\' attention separately.', (it) => { for (const r of it.output.rows) for (const e of r.entries) if (e.unionAttention > e.sumAttention + EPS) return `${r.key} ${e.videoId}`; return true; }),
  guarantee('minutes-are-attention-over-sixty', 'Each entry\'s viewer-minutes equal its union attention-seconds / 60.', (it) => { for (const r of it.output.rows) for (const e of r.entries) if (Math.abs(e.viewerMinutes - e.unionAttention / 60) > EPS) return r.key; return true; }),
  guarantee('unmeasurable-is-null-not-zero', 'A row with nothing measurable has viewer-minutes null (never 0); a measurable row has a number; a partial row says so.', (it) => {
    for (const r of it.output.rows) {
      if (r.state === 'unmeasurable' && r.viewerMinutes !== null) return `${r.key}: unmeasurable but ${r.viewerMinutes}`;
      if (r.state !== 'unmeasurable' && typeof r.viewerMinutes !== 'number') return `${r.key}: ${r.state} without a number`;
      if (r.state === 'measured' && r.unmeasuredVideoIds.length) return `${r.key}: measured yet has unmeasured videos`;
    }
    return true;
  }),
  guarantee('short-plus-long-equals-total', 'Short and long viewer-minutes add up to the row total.', (it) => { for (const r of it.output.rows) if (r.state !== 'unmeasurable' && !rel((r.byFormat.long ?? 0) + (r.byFormat.short ?? 0), r.viewerMinutes)) return r.key; return true; }),
]);

// Run the whole chain on a list of instances. Returns the indexed world, the enriched model, the metrics, the projection and the Calculation reports.
export function analyzeWorld(instances, name = 'world') {
  const W = indexWorld(instances);
  const enr = runCalculation(enrichCalc, [{ name, instances, W }]);
  const E = enr.outputs[name];
  const items = (extra = {}) => [{ name, W, E, ...extra }];
  const att = runCalculation(attentionCalc, items());
  const A = att.outputs[name];
  const dip = runCalculation(dipCalc, items());
  const rel2 = runCalculation(releaseCalc, items({ att: A }));
  const clk = runCalculation(clickCalc, items({ att: A }));
  const exp = runCalculation(exposureCalc, items({ att: A }));
  const M = { attention: A, dips: dip.outputs[name], releases: rel2.outputs[name], clicks: clk.outputs[name], exposure: exp.outputs[name] };
  const reports = [enr, att, dip, rel2, clk, exp].map(({ outputs, ...r }) => r);
  return { W, E, M, P: projectResults(W, E, M), reports };
}
export const reportsPass = (reports) => reports.every((r) => r.status === 'PASS');
export { checkExpectations };
