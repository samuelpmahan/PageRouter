// The link graph: every reference terminal of every instance is an edge, plus the edges the enrichment adds (appearance <-> disc/video/card,
// click credit, alternate-frame chains). The page walks it; the richness Calculation measures it.
import { FRAMES, effectiveTerminals, refFrame } from './frames.mjs';
import { discOwnerLabel, discLabel } from './meaning.mjs';
import { mmss, prettyDate } from './util.mjs';

export function referenceEdges(instances) {
  const edges = [];
  for (const inst of instances) {
    if (FRAMES[inst.frame].role !== 'input') continue;
    for (const [name, def] of Object.entries(effectiveTerminals(inst.frame))) {
      if (!refFrame(def.type)) continue;
      const v = inst.t[name];
      for (const to of Array.isArray(v) ? v : v == null ? [] : [v]) edges.push({ from: inst.id, rel: name, to });
    }
  }
  return edges;
}

export function nodeLabel(W, E, id) {
  const inst = W.get(id);
  if (!inst) {
    const a = E?.appearances.find((x) => x.id === id);
    if (a) return `appearance of ${discOwnerLabel(W, E, a.discId)} in “${E.videos[a.videoId].title}”`;
    const alt = E?.alternates.find((x) => x.id === id);
    return alt ? `${alt.frame} (from ${alt.root})` : id;
  }
  const t = inst.t;
  switch (inst.frame) {
    case 'Creator': return t.name;
    case 'Channel': return t.title;
    case 'Shelf': return `${W.get(t.creatorId).t.name}'s shelf`;
    case 'Manufacturer': return t.name;
    case 'Mold': return `${W.get(t.manufacturerId).t.name} ${t.name}`;
    case 'Release': return `${W.get(t.moldId).t.name} ${t.runLabel ?? 'release'} (${t.date})`;
    case 'SponsorDeal': return `${W.get(t.creatorId).t.name} + ${W.get(t.manufacturerId).t.name}`;
    case 'Disc': return E ? discOwnerLabel(W, E, id) : `${t.moldName} (${t.plastic})`;
    case 'Bag': return `${t.name} (${W.get(t.creatorId).t.name})`;
    case 'Video': return t.title;
    case 'RetentionCurve': return `retention of “${W.get(t.videoId).t.title}”`;
    case 'CardPlacement': return `card for ${W.get(t.discId).t.moldName}, ${mmss(t.startSec)}–${mmss(t.endSec)} in “${W.get(t.videoId).t.title}”`;
    case 'Appearance': return `${t.mode} mark of ${W.get(t.discId).t.moldName}, ${mmss(t.startSec)}–${mmss(t.endSec)} in “${W.get(t.videoId).t.title}”`;
    case 'Link': return `link ${t.code} (${t.placement})`;
    case 'Click': return `click ${t.at.slice(0, 16).replace('T', ' ')} on ${W.get(t.linkId).t.code}`;
    default: return id;
  }
}

export function buildGraph(W, E) {
  const nodes = new Map();
  const edges = [];
  for (const inst of W.instances) nodes.set(inst.id, { id: inst.id, frame: inst.frame, label: nodeLabel(W, E, inst.id) });
  for (const e of referenceEdges(W.instances)) edges.push({ ...e, source: 'reference' });
  if (E) {
    for (const a of E.appearances) nodes.set(a.id, { id: a.id, frame: 'Appearance*', label: nodeLabel(W, E, a.id) });
    for (const alt of E.alternates) nodes.set(alt.id, { id: alt.id, frame: alt.frame, label: nodeLabel(W, E, alt.id) });
    // enrichment edges that only repeat a reference terminal (in the other direction) are left out; the rest are links the enrichment discovered
    const REPEATS = new Set(['owns', 'onShelf', 'madeBy', 'sponsoredBy', 'with', 'published', 'for', 'placedIn', 'retentionOf', 'appliedTo', 'via']);
    for (const e of E.edges) if (!REPEATS.has(e.rel)) edges.push({ ...e, source: 'enrichment' });
  }
  const out = new Map(), inn = new Map();
  for (const e of edges) { (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e); (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)).push(e); }
  return { nodes, edges, out, inn, neighbors: (id) => [...(out.get(id) ?? []).map((e) => ({ id: e.to, rel: e.rel, dir: 'out' })), ...(inn.get(id) ?? []).map((e) => ({ id: e.from, rel: e.rel, dir: 'in' }))] };
}

// Ids within `depth` reference hops of the seed ids, in both directions (used for locality: a departure may only change results linked to what it touched).
export function neighborhood(G, seeds, depth) {
  const seen = new Set(seeds);
  let frontier = [...seeds];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const id of frontier) for (const n of G.neighbors(id)) if (!seen.has(n.id)) { seen.add(n.id); next.push(n.id); }
    frontier = next;
  }
  return seen;
}
// Context of an entity: what it points at, following reference edges outward only (video -> channel -> creator; disc -> mold -> manufacturer).
export function contextOf(G, seeds, depth = 2) {
  const seen = new Set(seeds);
  let frontier = [...seeds];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const id of frontier) for (const e of G.out.get(id) ?? []) if (e.source === 'reference' && !seen.has(e.to)) { seen.add(e.to); next.push(e.to); }
    frontier = next;
  }
  return seen;
}

// Graph measures over the reference edges of the instances (the same measures the Critic computed in round 1).
export function graphMetrics(instances) {
  const ids = new Set(instances.map((i) => i.id));
  const edges = referenceEdges(instances);
  const dangling = edges.filter((e) => !ids.has(e.to));
  const parent = new Map([...ids].map((i) => [i, i]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const e of edges) if (ids.has(e.to)) parent.set(find(e.from), find(e.to));
  const comps = new Map();
  for (const i of ids) { const r = find(i); comps.set(r, (comps.get(r) ?? 0) + 1); }
  const sizes = [...comps.values()].sort((a, b) => b - a);
  const nodes = ids.size, avgDegree = nodes ? (2 * edges.length) / nodes : 0;
  // each Click is one edge by nature (a leaf on its Link), so the density that says something about the world is over everything else
  const deg = new Map([...ids].map((i) => [i, 0]));
  for (const e of edges) { deg.set(e.from, deg.get(e.from) + 1); if (deg.has(e.to)) deg.set(e.to, deg.get(e.to) + 1); }
  const isClick = new Set(instances.filter((i) => i.frame === 'Click').map((i) => i.id));
  const rest = [...ids].filter((i) => !isClick.has(i));
  const avgDegreeNonClick = rest.length ? rest.reduce((s, i) => s + deg.get(i), 0) / rest.length : 0;
  const leavesNonClick = rest.filter((i) => deg.get(i) <= 1).length;
  return { nodes, edges: edges.length, dangling: dangling.length, danglingExamples: dangling.slice(0, 3), components: comps.size, largestComponent: sizes[0] ?? 0, smallestComponent: sizes[sizes.length - 1] ?? 0, avgDegree: Math.round(avgDegree * 1000) / 1000, avgDegreeNonClick: Math.round(avgDegreeNonClick * 1000) / 1000, clicks: isClick.size, leavesNonClick };
}
export { discLabel, prettyDate };

// The entities a Case is about: the things it names (subjects, patched instances, result entries) plus what they point at (video -> channel -> creator,
// disc -> mold -> manufacturer, ...). Two Cases that share one of these are linked through it.
export function caseEntities(c, W, E, G) {
  const seeds = new Set();
  const add = (id) => { if (id && G.nodes.has(id)) seeds.add(id); };
  for (const id of c.subjectIds ?? []) add(id);
  for (const p of c.patches ?? []) add(p.id);
  // the result entries a Case is about (observed) or changed (departure): each names the discs, videos, molds, brands and links it is made of
  for (const e of [...(c.entries ?? []), ...(c._effect?.changed ?? [])]) {
    if (e.section === 'appearances' || e.section === 'discVideo') {
      const [d, v] = e.section === 'discVideo' ? e.key.split('@') : [null, null];
      const a = e.section === 'appearances' ? E.appearances.find((x) => x.id === e.key) ?? { discId: e.key.split('@')[0], videoId: e.key.split('@')[1].split('#')[0] } : { discId: d, videoId: v };
      add(a.discId); add(a.videoId);
    } else if (e.section === 'sponsorRows') { add(e.key.split('|')[1]); for (const v of e.after?.videos ?? e.before?.videos ?? []) add(v); }
    else if (e.section === 'disc' || e.section === 'discs') add(e.key);
    else if (e.section === 'videos') add(e.key);
    else if (e.section === 'mold') add(e.key);
    else if (e.section === 'clicks') { add(e.key); add(W.get(e.key)?.t.linkId); }
    else if (e.section === 'perThousand') add(e.key);
  }
  // and the things named by every sentence the departure reworded
  for (const d of c._effect?.sentences ?? []) for (const f of [...d.before, ...d.after]) { add(f.discId); add(f.videoId); add(f.moldId); add(f.linkId); add(f.clickId); for (const x of f.discIds ?? []) add(x); }
  return [...contextOf(G, [...seeds], 2)].filter((id) => W.get(id)).sort();
}
// A shared entity of these kinds links two Cases for real; creators and manufacturers are hubs that would link nearly everything.
export const STRICT_FRAMES = new Set(['Disc', 'Video', 'Mold', 'Release', 'SponsorDeal', 'Bag', 'Link', 'Click', 'CardPlacement', 'Appearance', 'RetentionCurve']);
