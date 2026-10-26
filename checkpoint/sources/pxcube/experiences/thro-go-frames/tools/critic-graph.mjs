// Critic: entity-link graph of data/toy-world.json (raw instances; edges = every ref/refs terminal value).
import fs from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const w = JSON.parse(fs.readFileSync(root + 'data/toy-world.json'));
const { FRAMES } = await import(root + 'frames.mjs');
const byId = new Map(w.instances.map((i) => [i.id, i]));
const edges = [];
for (const i of w.instances) for (const [t, def] of Object.entries(FRAMES[i.frame].terminals)) {
  if (!/^refs?:/.test(def.type)) continue;
  const v = i.t[t]; if (v == null) continue;
  for (const to of Array.isArray(v) ? v : [v]) edges.push([i.id, to, `${i.frame}.${t}`]);
}
// Click-> (no direct) fine. Union-find
const parent = new Map(w.instances.map((i) => [i.id, i.id]));
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
let dangling = 0;
for (const [a, b] of edges) { if (!byId.has(b)) { dangling++; continue; } parent.set(find(a), find(b)); }
const comps = new Map();
for (const i of w.instances) { const r = find(i.id); (comps.get(r) ?? comps.set(r, []).get(r)).push(i); }
const N = w.instances.length, E = edges.length;
console.log('nodes', N, 'edges', E, 'dangling', dangling, 'components', comps.size, 'avg degree (2E/N)', (2 * E / N).toFixed(3), 'edges per node', (E / N).toFixed(3));
const sizes = [...comps.values()].map((c) => c.length).sort((a, b) => b - a);
console.log('component sizes: largest', sizes[0], 'smallest', sizes[sizes.length - 1], 'median', sizes[sizes.length >> 1]);
const multiCase = [...comps.values()].filter((c) => new Set(c.map((i) => i.caseId)).size > 1);
console.log('components spanning >1 Case:', multiCase.length, multiCase.map((c) => [...new Set(c.map((i) => i.caseId))].join('+') + ' size ' + c.length));
// entities (instances) referenced from a different Case than their own
const crossCaseEdges = edges.filter(([a, b]) => byId.get(a)?.caseId !== byId.get(b)?.caseId);
console.log('edges crossing Case boundaries', crossCaseEdges.length);
// per-frame in/out degree
const deg = {}; for (const [a, b] of edges) { deg[a] = (deg[a] ?? 0) + 1; deg[b] = (deg[b] ?? 0) + 1; }
const byFrameDeg = {}; for (const i of w.instances) (byFrameDeg[i.frame] ??= []).push(deg[i.id] ?? 0);
for (const [f, l] of Object.entries(byFrameDeg)) console.log(f.padEnd(14), 'n', String(l.length).padStart(3), 'avg degree', (l.reduce((s, x) => s + x, 0) / l.length).toFixed(2), 'max', Math.max(...l));
// How many molds / manufacturers / discs are referenced by > 1 video (through placements/appearances/links)?
const videosOfDisc = {}, videosOfMold = {}, videosOfBrand = {};
const add = (m, k, v) => (m[k] ??= new Set()).add(v);
const discMold = (d) => byId.get(d)?.t.moldId;
for (const i of w.instances) if (i.frame === 'CardPlacement' || i.frame === 'Appearance') {
  const d = i.t.discId, m = discMold(d), b = m && byId.get(m)?.t.manufacturerId;
  add(videosOfDisc, d, i.t.videoId); if (m) add(videosOfMold, m, i.t.videoId); if (b) add(videosOfBrand, b, i.t.videoId);
}
const gt1 = (m) => Object.values(m).filter((s) => s.size > 1).length;
console.log('discs on >1 video', gt1(videosOfDisc), '/', Object.keys(videosOfDisc).length, '| molds on >1 video', gt1(videosOfMold), '/', Object.keys(videosOfMold).length, '| manufacturers on >1 video', gt1(videosOfBrand), '/', Object.keys(videosOfBrand).length);
// molds referenced by discs of >1 creator; manufacturers with deals with >1 creator
const creatorsOfMold = {}; for (const d of w.instances.filter((i) => i.frame === 'Disc')) if (d.t.moldId) add(creatorsOfMold, d.t.moldId, d.t.creatorId);
console.log('molds held by >1 creator', gt1(creatorsOfMold));
const creatorsOfBrand = {}; for (const d of w.instances.filter((i) => i.frame === 'SponsorDeal')) add(creatorsOfBrand, d.t.manufacturerId, d.t.creatorId);
console.log('manufacturers with deals with >1 creator', gt1(creatorsOfBrand));
// videos with >1 distinct brand's discs
const brandsOfVideo = {}; for (const i of w.instances) if (i.frame === 'CardPlacement' || i.frame === 'Appearance') { const m = discMold(i.t.discId), b = m && byId.get(m)?.t.manufacturerId; if (b) add(brandsOfVideo, i.t.videoId, b); }
console.log('videos with discs of >1 brand', gt1(brandsOfVideo));
// Name-level collisions: same display name, separate identities (no link)
const names = (frame, t) => { const m = {}; for (const i of w.instances.filter((x) => x.frame === frame)) (m[i.t[t]] ??= []).push(i.id); return m; };
for (const [f, t] of [['Creator', 'name'], ['Manufacturer', 'name'], ['Mold', 'name']]) { const m = names(f, t); const dup = Object.entries(m).filter(([, l]) => l.length > 1); console.log(f, 'distinct names', Object.keys(m).length, 'of', Object.values(m).flat().length, 'instances; names used by >1 separate instance:', dup.length, dup.slice(0, 4).map(([n, l]) => `${n}x${l.length}`).join(', ')); }
// Cases per entity
const caseOf = {}; for (const i of w.instances) add(caseOf, i.id, i.caseId);
console.log('entities in >1 Case (by id):', Object.values(caseOf).filter((s) => s.size > 1).length);
// c08
const c08 = w.instances.filter((i) => i.caseId === 'c08'); console.log('c08 creators', c08.filter((i) => i.frame === 'Creator').length, 'molds', c08.filter((i) => i.frame === 'Mold').length, 'discs', c08.filter((i) => i.frame === 'Disc').length);
// links per disc, bag overlap
const bags = w.instances.filter((i) => i.frame === 'Bag'); console.log('bags', bags.length, 'bags with >1 video', bags.filter((b) => b.t.appliedToVideoIds.length > 1).length, 'creators with >1 bag', Object.values(bags.reduce((m, b) => ((m[b.t.creatorId] = (m[b.t.creatorId] ?? 0) + 1), m), {})).filter((n) => n > 1).length);
const vids = w.instances.filter((i) => i.frame === 'Video'); const vpc = {}; for (const v of vids) { const ch = byId.get(v.t.channelId); vpc[ch.t.creatorId] = (vpc[ch.t.creatorId] ?? 0) + 1; }
console.log('videos', vids.length, 'creators with >1 video', Object.values(vpc).filter((n) => n > 1).length, 'max videos for one creator', Math.max(...Object.values(vpc)));
const clicks = w.instances.filter((i) => i.frame === 'Click'); console.log('clicks', clicks.length, 'distinct timestamps/dates', new Set(clicks.map((c) => c.t.at.slice(0, 10))).size);
