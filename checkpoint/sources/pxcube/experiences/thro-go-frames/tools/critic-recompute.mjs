// Critic: independent recomputation from data/toy-world.json (raw instances only; imports nothing from the Builder).
import fs from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const w = JSON.parse(fs.readFileSync(root + 'data/toy-world.json'));
const res = JSON.parse(fs.readFileSync(root + 'data/results.json'));
const I = new Map(w.instances.map((i) => [i.id, i]));
const of = (c, f) => w.instances.filter((i) => i.caseId === c && i.frame === f);
const D = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
const views = (v) => v.t.viewSnapshots.length ? [...v.t.viewSnapshots].sort((a, b) => (a.at < b.at ? -1 : 1)).at(-1).views : 0;
const curve = (vid) => of(I.get(vid).caseId, 'RetentionCurve').find((c) => c.t.videoId === vid);
// seconds on screen for a SET of discs in a video: boolean array, cards + marked throws, clamped to [0,dur)
function seconds(vid, discs) {
  const v = I.get(vid), dur = v.t.durationSeconds, on = Array(dur).fill(0);
  for (const f of ['CardPlacement', 'Appearance']) for (const p of of(v.caseId, f)) if (p.t.videoId === vid && discs.includes(p.t.discId)) for (let s = p.t.startSec; s < p.t.endSec; s++) if (s >= 0 && s < dur) on[s] = 1;
  return on;
}
function att(vid, discs) {
  const v = I.get(vid), ch = I.get(v.t.channelId), c = curve(vid), n = views(v), on = seconds(vid, discs);
  if (!ch.t.studioConnected || n === 0 || !c) return { value: null, secs: on.reduce((a, b) => a + b, 0) };
  return { value: on.reduce((a, b, s) => a + (b ? n * c.t.fractions[s] : 0), 0), secs: on.reduce((a, b) => a + b, 0) };
}
const close = (a, b) => (a == null || b == null ? a == b : Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a)));
let fails = 0;
const cmp = (label, mine, theirs) => { const ok = close(mine, theirs); if (!ok) fails++; console.log(ok ? 'MATCH ' : 'DIFFER', label, '| mine', mine, '| builder', theirs); };

// 1. c24 overlapping cards, two different discs, same sponsor: union vs sum
{ const c = 'c24', vid = of(c, 'Video')[0].id, discs = of(c, 'Disc').map((d) => d.id);
  const u = att(vid, discs).value, s = discs.reduce((t, d) => t + att(vid, [d]).value, 0);
  const row = res.metrics[c].exposure.rows.find((r) => r.kind === 'sponsor');
  console.log('c24 cards', of(c, 'CardPlacement').map((p) => `${p.t.discId.split('.')[1]} ${p.t.startSec}-${p.t.endSec}`).join(', '));
  cmp('c24 union attention-seconds (overlap counted once)', u, row.entries[0].unionAttention);
  cmp('c24 sum of per-disc attention (what double counting would give)', s, row.entries[0].sumAttention);
  cmp('c24 sponsor exposure minutes = union/60', u / 60, row.minutes); }
// 2. c05 brand switch: Q2 minutes per brand and bucket per video
{ const c = 'c05', deals = of(c, 'SponsorDeal'), vids = of(c, 'Video'), rows = res.metrics[c].exposure.rows;
  console.log('c05 deals', deals.map((d) => `${d.t.manufacturerId.split('.')[1]} ${d.t.start}..${d.t.end}`).join(' | '), 'videos', vids.map((v) => v.t.publishedAt).join(','));
  for (const v of vids) {
    const bucket = (disc) => { const m = I.get(I.get(disc).t.moldId); const dl = deals.find((d) => d.t.start <= v.t.publishedAt && v.t.publishedAt <= d.t.end); return !dl ? 'no-deal' : dl.t.manufacturerId === m.t.manufacturerId ? 'sponsor' : 'other'; };
    for (const d of of(c, 'Disc')) { const o = att(v.id, [d.id]); if (!o.secs) continue; const b = bucket(d.id); const brand = I.get(I.get(d.id).t.moldId).t.manufacturerId; const row = rows.find((r) => r.kind === (b === 'sponsor' ? 'sponsor' : 'other') && r.manufacturerId === brand); const e = row?.entries.find((x) => x.videoId === v.id); cmp(`c05 ${d.id.split('.')[1]} in ${v.t.publishedAt} bucket=${b} minutes`, o.value / 60, e?.minutes); }
  } }
// 3. c08 cross-creator mold rollup
{ const c = 'c08', mold = of(c, 'Mold')[0], discs = of(c, 'Disc'), per = {}; let tot = 0;
  for (const d of discs) for (const v of of(c, 'Video')) { const a = att(v.id, [d.id]); if (a.value != null) { per[d.t.creatorId] = (per[d.t.creatorId] ?? 0) + a.value; tot += a.value; } }
  const m = res.metrics[c].attention.byMold[mold.id]; cmp('c08 mold total attention across creators', tot, m.value);
  for (const [cr, v] of Object.entries(per)) cmp(`c08 per-creator ${I.get(cr).t.name}`, v, m.perCreator[cr]); }
// 4. pre-release offset: c16 (day) and c02 (month-before range); c03 month-inside
{ for (const c of ['c16', 'c02', 'c03', 'c11']) { const v = of(c, 'Video')[0], disc = of(c, 'Disc')[0];
    const rels = of(c, 'Release').filter((r) => r.t.moldId === disc.t.moldId); const rel = disc.t.runLabel ? rels.find((r) => r.t.runLabel === disc.t.runLabel) : rels.find((r) => !r.t.runLabel);
    const mon = rel.t.datePrecision === 'month'; const r0 = mon ? D(rel.t.date + '-01') : D(rel.t.date); const nextM = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return D(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`) - 1; }; const r1 = mon ? nextM(rel.t.date) : r0; const p = D(v.t.publishedAt);
    const mineMin = p - r1, mineMax = p - r0; const row = res.metrics[c].releases.releases.flatMap((r) => r.videos)[0];
    console.log(c, 'published', v.t.publishedAt, 'release', rel.t.date, rel.t.datePrecision);
    cmp(`${c} offsetMin (published - release last day)`, mineMin, row.offsetMin); cmp(`${c} offsetMax`, mineMax, row.offsetMax); } }
// 5. zero views and clamp
{ const c = 'c19', v = of(c, 'Video')[0], d = of(c, 'Disc')[0]; cmp('c19 zero views -> null attention', null, att(v.id, [d.id]).value);
  const c2 = 'c25', v2 = of(c2, 'Video')[0], d2 = of(c2, 'Disc')[0]; const p = of(c2, 'CardPlacement')[0]; console.log('c25 card', p.t.startSec, p.t.endSec, 'duration', v2.t.durationSeconds);
  const o = att(v2.id, [d2.id]); const e = res.metrics[c2].attention.byDiscVideo[`${d2.id}@${v2.id}`];
  cmp('c25 attention clamped to video end', o.value, e.value); cmp('c25 seconds on screen', o.secs, res.metrics[c2].attention.attention[res.enriched[c2].appearances[0].id].seconds); }
// 6. clicks: c35/c36 attribution kind and per-1000
for (const c of ['c35', 'c36', 'c32', 'c33', 'c31']) { const clk = of(c, 'Click')[0], link = I.get(clk.t.linkId); const e = res.enriched[c].clicks.find((x) => x.id === clk.id);
  console.log(c, 'click ts', clk.t.videoTimestamp, 'at', clk.t.at, 'link video', link.t.videoId, 'placement', link.t.placement, '=> builder:', e.attribution.kind, e.attribution.reason); }
console.log(fails ? `${fails} DIFFERENCES` : 'ALL MATCH');
