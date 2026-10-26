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
  return { nodes, edges: edges.length, dangling: dangling.length, danglingExamples: dangling.slice(0, 3), components: comps.size, largestComponent: sizes[0] ?? 0, smallestComponent: sizes[sizes.length - 1] ?? 0, avgDegree: Math.round(avgDegree * 1000) / 1000 };
}
export { discLabel, prettyDate };
