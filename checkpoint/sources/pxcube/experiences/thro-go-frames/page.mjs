// The page. It loads the build (data/toy-world.json = the one shared season and its Cases, data/results.json = verdicts and deltas from the
// node build, which is where the verification happens), re-runs the real analysis on the season in the browser as a SMOKE check only, and draws
// five views: Cases, Sponsors, Links (walk the graph), Frames, Pipeline.
import { analyzeWorld } from './analysis.mjs';
import { FRAMES, effectiveTerminals, effectiveExpect, frameSystem } from './frames.mjs';
import { sponsorView, viewerMinutesText } from './display.mjs';
import { buildGraph, nodeLabel } from './graph.mjs';
import { deriveFacts, discLabel } from './meaning.mjs';
import { fnv32, fmt1, fmt2, fmtInt, fmtAtt, mmss, prettyDate } from './util.mjs';

const $ = (sel) => document.querySelector(sel);
const NS = 'http://www.w3.org/2000/svg';
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const KIND_LABEL = { observed: 'Observed in the season', chained: 'Chain of frames', expectation: 'Expectation fails', boundary: 'Boundary value', variant: 'Declared variant', relink: 'Re-pointed link', rename: 'Renamed label', enum: 'Other enum value' };
const KIND_HELP = {
  observed: 'A situation the season already contains. The Case asserts how it is handled.',
  chained: 'One frame replaced by the next, then that one by another.',
  expectation: 'One soft expectation of a frame is broken on purpose; its mismatch rule must pick the next frame or a transformation.',
  boundary: 'A value at the edge a terminal declares (deal first or last day, window day 29, 30 or 31, click at a card\'s last second, quarter edge, time zone).',
  variant: 'A situation the frame names for one of its terminals.',
  relink: 'A reference re-pointed at another instance of the same frame.',
  rename: 'A label renamed: every sentence that names it must change with it.',
  enum: 'Every other value of an enum terminal.',
};
const SECTION_LABEL = { appearances: 'Appearance', discVideo: 'Disc in video', disc: 'Disc total', discs: 'Disc', mold: 'Mold total, all creators', sponsorRows: 'Sponsor row', clicks: 'Click credit', perThousand: 'Clicks per 1,000 attention-seconds', videos: 'Video' };
const FIELD_LABEL = { attention: 'attention-seconds', viewerMinutes: 'viewer-minutes on screen', seconds: 'seconds on screen', start: 'starts at', end: 'ends at', bucket: 'counts as', dealId: 'under deal', kind: 'credited as', reason: 'reason', appearanceKey: 'credited to', releaseClass: 'release class', offsetMin: 'days from release (nearest)', offsetMax: 'days from release (farthest)', quarter: 'quarter', day: 'local day', views: 'views', state: 'state', dealIds: 'deals', creators: 'creators', videos: 'videos', long: 'from long videos', short: 'from Shorts', cards: 'cards merged', hasCard: 'has a card', thrown: 'thrown', moldId: 'mold', releaseId: 'release', hasMold: 'mold in catalog', resolvedBy: 'mold found by', manufacturerId: 'brand', pre: 'before release', host: 'referrer', country: 'country', perCreator: 'by creator', byCreator: 'by creator', overlapped: 'overlap counted once' };

const state = { world: null, results: null, run: null, view: 'cases', caseId: null, entityId: null, trail: [], theme: 'all', kind: 'all', q: '', failOnly: false, brand: 'all', quarter: 'all', entQ: '', entFrame: 'all', smoke: null };
const mobile = () => matchMedia('(max-width: 800px)').matches;

/* ---------- small helpers ---------- */
const caseOf = (id) => state.world.cases.find((c) => c.id === id);
const verdictOf = (id) => state.results.verdicts[id];
const W = () => state.run.W, E = () => state.run.E;
const label = (id) => { try { return nodeLabel(W(), E(), id); } catch { return id; } };
const fmtNum = (n) => (Number.isInteger(n) ? fmtInt(n) : Math.abs(n) >= 100 ? fmtInt(n) : fmt2(n));
function fmtVal(v, field) {
  if (v === null || v === undefined) return h('i', { class: 'none' }, field === 'viewerMinutes' || field === 'attention' ? 'not measurable' : 'none');
  if (typeof v === 'number') return field === 'viewerMinutes' || field === 'attention' || field === 'long' || field === 'short' ? fmtAtt(v) : field === 'offsetMin' || field === 'offsetMax' ? (v > 0 ? `+${v}` : String(v)) : fmtNum(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'string' && W().get(x) ? label(x) : String(x))).join(', ') : 'none';
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${W().get(k) ? label(k) : k}: ${typeof x === 'number' ? fmtAtt(x) : x}`).join('; ');
  const s = String(v);
  return W().get(s) ? label(s) : s;
}
const unitOf = (field) => (field === 'attention' ? 'attention-seconds' : field === 'viewerMinutes' ? 'viewer-minutes on screen' : field === 'seconds' ? 's' : '');
function pathGet(o, path) { let x = o; for (const k of path.split('.')) x = x == null ? x : x[k]; return x; }
function keyLabel(section, key) {
  try {
    if (section === 'appearances' || section === 'discVideo') { const [d, rest] = key.split('@'); const v = rest.split('#')[0]; return `${label(d)} in “${W().get(v).t.title}”`; }
    if (section === 'sponsorRows') { const [k, m, q] = key.split('|'); return `${W().get(m)?.t.name ?? m} · ${q} · ${k === 'sponsor' ? 'as sponsor' : 'not the sponsor'}`; }
    if (section === 'perThousand') return label(key);
    if (section === 'mold') return label(key);
    if (section === 'clicks') return label(key);
    return label(key);
  } catch { return key; }
}
function chipFor(id, text) {
  return h('button', { class: 'ent', title: id, onclick: () => goEntity(id) }, text ?? label(id));
}

/* ---------- navigation ---------- */
function setHash() {
  const p = new URLSearchParams();
  p.set('view', state.view);
  if (state.view === 'cases' && state.caseId) p.set('case', state.caseId);
  if (state.view === 'links' && state.entityId) p.set('entity', state.entityId);
  history.replaceState(null, '', `#${p.toString()}`);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('view')) state.view = p.get('view');
  if (p.get('case') && caseOf(p.get('case'))) state.caseId = p.get('case');
  if (p.get('entity')) state.entityId = p.get('entity');
}
function goView(v) { state.view = v; renderAll(); window.scrollTo(0, 0); }
function goEntity(id) { if (state.entityId && state.entityId !== id) state.trail.push(state.entityId); state.entityId = id; state.view = 'links'; renderAll(); window.scrollTo(0, 0); }
function goCase(id) { state.caseId = id; state.view = 'cases'; renderAll(); window.scrollTo(0, 0); }

/* ---------- Cases ---------- */
function visibleCases() {
  const q = state.q.trim().toLowerCase();
  return state.world.cases.filter((c) => (state.theme === 'all' || c.theme === state.theme) && (state.kind === 'all' || c.kind === state.kind) && (!state.failOnly || !verdictOf(c.id).pass)
    && (!q || `${c.id} ${c.title} ${c.theme} ${c.frameTerminal ?? ''} ${c.where ?? ''}`.toLowerCase().includes(q)));
}
function renderList() {
  const list = $('#list');
  const cases = state.world.cases;
  const themes = [...new Set(cases.map((c) => c.theme))];
  const kinds = [...new Set(cases.map((c) => c.kind))];
  const vis = visibleCases();
  const kids = [
    h('div', { class: 'filters' },
      h('input', { type: 'search', id: 'q', placeholder: 'Search Cases', 'aria-label': 'Search Cases', value: state.q, oninput: (e) => { state.q = e.target.value; renderList(); $('#q').focus(); } }),
      h('select', { id: 'kind', 'aria-label': 'Kind of Case', onchange: (e) => { state.kind = e.target.value; renderList(); } }, h('option', { value: 'all' }, `All kinds (${cases.length})`), kinds.map((k) => h('option', { value: k, selected: state.kind === k }, `${KIND_LABEL[k]} (${cases.filter((c) => c.kind === k).length})`))),
      h('select', { id: 'theme', 'aria-label': 'Theme', onchange: (e) => { state.theme = e.target.value; renderList(); } }, h('option', { value: 'all' }, 'All themes'), themes.map((t) => h('option', { value: t, selected: state.theme === t }, `${t} (${cases.filter((c) => c.theme === t).length})`))),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: state.failOnly, onchange: (e) => { state.failOnly = e.target.checked; renderList(); } }), ' failing only'),
      h('div', { class: 'count' }, `${vis.length} of ${cases.length} Cases`)),
  ];
  let lastTheme = null;
  for (const c of vis) {
    if (c.theme !== lastTheme) { kids.push(h('div', { class: 'group' }, c.theme)); lastTheme = c.theme; }
    const v = verdictOf(c.id);
    kids.push(h('button', { class: 'item', 'data-case': c.id, 'aria-current': c.id === state.caseId ? 'true' : 'false', onclick: () => { state.caseId = c.id; $('#list').classList.remove('open'); renderAll(); window.scrollTo(0, 0); } },
      h('span', { class: 'id' }, c.id), h('span', { class: 'slug' }, c.title), h('span', { class: `pill ${v.pass ? 'pass' : 'fail'}` }, v.pass ? 'PASS' : 'FAIL'),
      h('span', { class: 't' }, KIND_LABEL[c.kind])));
  }
  list.replaceChildren(...kids);
}
function expectText(e) {
  if (!e) return null;
  const vt = (id) => `“${W().get(id)?.t.title ?? id}”`;
  switch (e.kind) {
    case 'dealActive': return `${vt(e.videoId)} is ${e.active ? '' : 'not '}under the ${label(W().get(e.dealId).t.manufacturerId)} deal.`;
    case 'releaseClass': return `${label(e.discId)} in ${vt(e.videoId)} counts as ${e.releaseClass}${e.offset !== undefined ? ` at day ${e.offset}` : ''}.`;
    case 'releaseOffset': return `${vt(e.videoId)} sits ${e.offset} day${Math.abs(e.offset) === 1 ? '' : 's'} from the release day.`;
    case 'quarter': return `${vt(e.videoId)} belongs to ${e.quarter}.`;
    case 'localDay': return `${vt(e.videoId)} lands on another local day.`;
    case 'secondsOn': return `${e.seconds} second${e.seconds === 1 ? '' : 's'} on screen.`;
    case 'clampedSeconds': return `The appearance ends at the video's end, not after it.`;
    case 'clickCredit': return e.credited ? (e.moment === undefined ? 'The click is credited.' : e.moment ? 'The click is credited to the on-screen moment.' : 'The click is credited to the video, not to a moment.') : `The click is credited to nothing (${e.reason}).`;
    case 'renamed': return `Every sentence that names it now says “${e.to}”.`;
    default: return null;
  }
}
const details = (title, open, ...kids) => h('details', { class: 'sec', open: open ? '' : null }, h('summary', null, title), h('div', { class: 'body' }, kids));
function deltaView(v) {
  if (!v.delta.length) return h('p', { class: 'mute' }, 'No linked result changed; the change shows only in the sentences.');
  const rows = v.delta.map((d) => {
    const fields = d.fields.filter((f, n, a) => a.indexOf(f) === n).map((f) => f.split('.')[0]).filter((f, n, a) => a.indexOf(f) === n).slice(0, 5);
    return h('div', { class: 'drow' },
      h('div', { class: 'dk' }, h('span', { class: 'sect' }, SECTION_LABEL[d.section] ?? d.section), ' ', keyLabel(d.section, d.key)),
      d.before === null ? h('div', { class: 'df' }, h('span', { class: 'new' }, 'new'), ' now in the results') : d.after === null ? h('div', { class: 'df' }, h('span', { class: 'gone' }, 'gone'), ' from the results') : fields.map((f) => h('div', { class: 'df' }, h('span', { class: 'fn' }, FIELD_LABEL[f] ?? f), h('span', { class: 'b' }, fmtVal(d.before[f], f)), h('span', { class: 'ar' }, '→'), h('span', { class: 'a' }, fmtVal(d.after[f], f)), unitOf(f) && h('span', { class: 'un' }, unitOf(f)))));
  });
  return h('div', { class: 'delta' }, rows.slice(0, 6), rows.length > 6 && h('details', { class: 'more' }, h('summary', null, `${rows.length - 6} more changed entries`), rows.slice(6)), v.deltaCount > v.delta.length && h('p', { class: 'mute' }, `…and ${v.deltaCount - v.delta.length} more entries changed.`));
}
function renderCase() {
  const c = caseOf(state.caseId), v = verdictOf(c.id), o = c.kind === 'observed' || c.kind === 'chained';
  const exp = expectText(c.expect);
  const kids = [
    h('header', { class: 'case-head' },
      h('div', { class: 'kicker' }, h('span', null, c.id), h('span', null, KIND_LABEL[c.kind]), h('span', null, c.theme), h('span', { id: 'case-verdict', class: `pill ${v.pass ? 'pass' : 'fail'}` }, v.pass ? 'PASS' : 'FAIL'), h('span', { class: 'mute' }, `${v.checks.filter((k) => k.ok).length} of ${v.checks.length} checks`)),
      h('h1', null, c.title),
      c.where && h('p', { class: 'where' }, h('span', null, 'Where: '), c.where),
      h('p', { class: 'help' }, o ? KIND_HELP[c.kind] : `${KIND_HELP[c.kind]} Change applied to the shared season, then the whole linked analysis runs again.`)),
  ];
  if (v.meaning.length) kids.push(details('What it means', true, v.meaning.slice(0, 3).map((m) => h('p', { class: 'sentence' }, m.sentence)), v.meaning.length > 3 && h('details', { class: 'more' }, h('summary', null, `${v.meaning.length - 3} more sentence${v.meaning.length - 3 === 1 ? '' : 's'}`), v.meaning.slice(3).map((m) => h('p', { class: 'sentence' }, m.sentence)))));
  if (!o) {
    kids.push(details(`What changes in the season (${c.departures.length})`, true,
      groupDepartures(c.departures).map(({ first, more }) => h('div', { class: 'dep' }, h('span', { class: 'who' }, chipFor(first.id)), first.terminal ? [h('span', { class: 'term' }, `${first.frame}.${first.terminal}`), h('span', { class: 'b' }, fmtShort(first.from)), h('span', { class: 'ar' }, '→'), h('span', { class: 'a' }, fmtShort(first.to))] : h('span', { class: 'term' }, 'removed'), more > 0 && h('span', { class: 'mute' }, `and ${more} more ${first.frame}.${first.terminal} change${more === 1 ? '' : 's'} of the same kind, moved with it`))),
      exp && h('p', { class: 'expect' }, h('b', null, 'Expected: '), exp)));
    kids.push(details(`Linked results before → after (${v.deltaCount})`, !mobile(), deltaView(v)));
    if (v.sentenceDelta.length && !v.meaning.length) kids.push(details('Sentences that changed', true, v.sentenceDelta.map((s) => h('p', { class: 'sentence' }, s.after.join(' ')))));
  } else {
    kids.push(details(`Where it is in the season (${v.entities.length} linked things)`, !mobile(), entBlock(v.entities)));
  }
  if (v.selected.length || c.kind === 'chained') kids.push(details(`How the frames chose (${v.selected.length || 'chain'})`, !mobile(), selectedView(c, v)));
  kids.push(details(`Checks (${v.checks.filter((k) => k.ok).length} of ${v.checks.length} pass)`, !mobile(), h('div', { class: 'checks' }, v.checks.map((k) => h('div', { class: `check${k.ok ? '' : ' bad'}` }, h('span', { class: k.ok ? 'ok' : 'no' }, k.ok ? '✓' : '✗'), h('b', null, k.id), h('span', { class: 'ev' }, k.detail))))));
  if (!o) kids.push(details(`Linked things this Case touches (${v.entities.length})`, false, entBlock(v.entities)));
  $('#main').replaceChildren(h('div', { class: 'case' }, ...kids));
}
function groupDepartures(deps) {
  const groups = new Map();
  for (const d of deps) { const k = `${d.frame}.${d.terminal}`; if (!groups.has(k)) groups.set(k, { first: d, more: 0 }); else groups.get(k).more++; }
  return [...groups.values()];
}
const entBlock = (ids, cap = 14) => { const box = h('div', { class: 'ents' }, ids.slice(0, cap).map((id) => chipFor(id))); if (ids.length > cap) box.append(h('button', { class: 'ent showall', onclick: (e) => { e.target.remove(); box.append(...ids.slice(cap).map((id) => chipFor(id))); } }, `show all ${ids.length}`)); return box; };
function fmtShort(v) {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'object') return JSON.stringify(v).length > 60 ? `${JSON.stringify(v).slice(0, 57)}…` : JSON.stringify(v);
  const s = String(v);
  return W().get(s) ? label(s) : s.length > 50 ? `${s.slice(0, 47)}…` : s;
}
function selectedView(c, v) {
  const rows = v.selected.map((n) => h('div', { class: 'sel' },
    h('div', null, chipFor(n.instanceId), ' ', h('code', null, n.expectationId)),
    h('div', { class: 'step' }, h('span', { class: 'lbl' }, 'expectation failed'), n.detail),
    h('div', { class: 'step' }, h('span', { class: 'lbl' }, 'its mismatch string says'), h('code', null, n.mismatch), ' → ', h('b', null, n.action), n.alternateId && h('span', { class: 'mute' }, ` (${n.alternateId.split('~')[1]})`))));
  if (c.kind === 'chained') {
    const aid = c.entries[0]?.key;
    const a = E().appearances.find((x) => x.id === aid);
    if (a) {
      const chain = state.run.E.chains[a.placementIds[0]] ?? [];
      rows.unshift(h('div', { class: 'sel' }, h('div', { class: 'step' }, h('span', { class: 'lbl' }, 'chain'), chain.map((id, n) => [n ? ' → ' : '', h('b', null, E().alternates.find((x) => x.id === id).frame)])),
        E().alternates.filter((x) => chain.includes(x.id)).map((alt) => h('div', { class: 'step' }, h('span', { class: 'lbl' }, alt.frame), `inherits ${FRAMES[alt.frame].inherits}; selected by ${alt.vias.join(', ')}; its own expectations may fail in turn`))));
    }
  }
  return rows;
}

/* ---------- Sponsors ---------- */
function renderSponsors() {
  const brands = sponsorView(W(), E(), state.run.M);
  const quarters = [...new Set(brands.flatMap((b) => b.quarters.map((q) => q.quarter)))].sort();
  const el = h('div', { class: 'page-pad' },
    h('h1', null, 'Sponsors'),
    h('p', { class: 'lead' }, 'Per manufacturer, per quarter, across creators. Every number lists the videos and discs behind it. Numbers are viewer-minutes on screen: viewers still watching, times minutes a disc was on screen, overlapping cards counted once. A quarter nothing could be measured for shows “not measurable”, never zero.'),
    h('div', { class: 'filters inline' },
      h('select', { id: 'brand', 'aria-label': 'Manufacturer', onchange: (e) => { state.brand = e.target.value; renderSponsors(); } }, h('option', { value: 'all' }, 'All manufacturers'), brands.map((b) => h('option', { value: b.manufacturerId ?? 'unknown', selected: state.brand === (b.manufacturerId ?? 'unknown') }, b.name))),
      h('select', { id: 'quarter', 'aria-label': 'Quarter', onchange: (e) => { state.quarter = e.target.value; renderSponsors(); } }, h('option', { value: 'all' }, 'All quarters'), quarters.map((q) => h('option', { value: q, selected: state.quarter === q }, q)))));
  for (const b of brands) {
    if (state.brand !== 'all' && (b.manufacturerId ?? 'unknown') !== state.brand) continue;
    const qs = b.quarters.filter((q) => state.quarter === 'all' || q.quarter === state.quarter);
    if (!qs.length) continue;
    el.append(h('section', { class: 'brandblock' },
      h('h2', null, b.manufacturerId ? chipFor(b.manufacturerId, b.name) : b.name),
      b.deals.length ? h('ul', { class: 'deals' }, b.deals.map((d) => h('li', null, h('b', null, d.creator), ` ${prettyDate(d.start)} – ${prettyDate(d.end)}, ${d.covers}`))) : h('p', { class: 'mute' }, b.manufacturerId ? 'No sponsor deal.' : ''),
      qs.map((q) => [q.sponsor && rowView(b, q.quarter, q.sponsor), q.other && rowView(b, q.quarter, q.other)])));
  }
  $('#main').replaceChildren(el);
}
function rowView(b, quarter, r) {
  const sponsor = r.kind === 'sponsor';
  const vmText = r.viewerMinutes == null ? h('span', { class: 'none' }, 'not measurable') : h('span', null, h('b', null, fmtAtt(r.viewerMinutes)), h('span', { class: 'un' }, ' viewer-minutes on screen'));
  return h('div', { class: `qrow ${sponsor ? 'sp' : 'ot'}`, 'data-row': r.key },
    h('div', { class: 'qh' }, h('span', { class: 'q' }, quarter), h('span', { class: `tag ${sponsor ? 'sp' : 'ot'}` }, sponsor ? 'As sponsor' : 'Not the sponsor'), vmText,
      r.state === 'partial' && h('span', { class: 'tag part' }, 'some videos not measurable')),
    h('div', { class: 'qc' }, r.creators.map((c) => h('span', { class: 'cr' }, chipFor(c.id, c.name), ' ', c.viewerMinutes == null ? h('i', { class: 'none' }, 'not measurable') : fmtAtt(c.viewerMinutes)))),
    (r.byFormat.long != null && r.byFormat.short != null) && h('p', { class: 'mute' }, `${fmtAtt(r.byFormat.short)} from Shorts, ${fmtAtt(r.byFormat.long)} from long videos`),
    r.reasons?.length ? h('p', { class: 'mute' }, `Why not sponsor exposure: ${r.reasons.join(', ')}`) : null,
    h('details', { class: 'vids' }, h('summary', null, `${r.videos.length} video${r.videos.length === 1 ? '' : 's'} behind this number`),
      h('div', { class: 'vlist' }, r.videos.map((v) => h('div', { class: 'vrow' },
        h('div', { class: 'vt' }, chipFor(v.videoId, v.title), h('span', { class: 'mute' }, ` ${v.creator} · ${v.format} · ${prettyDate(v.publishDay)} · ${fmtInt(v.views)} views`)),
        h('div', { class: 'vn' }, v.viewerMinutes == null ? h('i', { class: 'none' }, 'not measurable') : [h('b', null, fmtAtt(v.viewerMinutes)), h('span', { class: 'un' }, ` viewer-minutes · ${v.onScreenSeconds} s on screen`)]),
        h('div', { class: 'vd mute' }, v.discs.join(' · ')))))));
}

/* ---------- Links (walk the graph) ---------- */
function entityList() {
  const G = state.run.G, q = state.entQ.trim().toLowerCase();
  const all = [...G.nodes.values()];
  const frames = [...new Set(all.map((n) => n.frame))].sort();
  const match = all.filter((n) => (state.entFrame === 'all' || n.frame === state.entFrame) && (!q || `${n.label} ${n.id}`.toLowerCase().includes(q)));
  return { frames, match, total: all.length };
}
function relPhrase(rel) { return rel.replace(/([A-Z])/g, ' $1').toLowerCase(); }
function renderLinks() {
  const G = state.run.G;
  const { frames, match, total } = entityList();
  const left = h('div', { class: 'elist' },
    h('div', { class: 'filters inline' },
      h('input', { type: 'search', id: 'eq', placeholder: 'Search everything', 'aria-label': 'Search entities', value: state.entQ, oninput: (e) => { state.entQ = e.target.value; renderLinks(); $('#eq').focus(); const x = $('#eq'); x.setSelectionRange(x.value.length, x.value.length); } }),
      h('select', { id: 'ef', 'aria-label': 'Kind of thing', onchange: (e) => { state.entFrame = e.target.value; renderLinks(); } }, h('option', { value: 'all' }, `All kinds (${total})`), frames.map((f) => h('option', { value: f, selected: state.entFrame === f }, `${f} (${[...G.nodes.values()].filter((n) => n.frame === f).length})`)))),
    h('div', { class: 'count' }, `${match.length} shown${match.length > 120 ? ', first 120' : ''}`),
    h('div', { class: 'eitems' }, match.slice(0, 120).map((n) => h('button', { class: 'eitem', 'aria-current': n.id === state.entityId ? 'true' : 'false', onclick: () => goEntity(n.id) }, h('span', { class: 'fr' }, n.frame), h('span', { class: 'lb' }, n.label)))));
  const right = h('div', { class: 'edetail' }, state.entityId && G.nodes.has(state.entityId) ? entityDetail(state.entityId) : h('div', { class: 'empty' }, h('h2', null, 'Walk the links'), h('p', { class: 'lead' }, 'Pick anything: a creator, a disc, a video, a sponsor deal, a click. You see everything linked to it, and every linked thing is a button, so you can keep walking. The dataset is one connected world, so every thing reaches every other.'),
    h('div', { class: 'ents' }, ['creator:maren', 'mold:comet', 'maker:halcyon', 'video:maren-03', 'deal:tavi-halcyon'].filter((id) => G.nodes.has(id)).map((id) => chipFor(id)))));
  $('#main').replaceChildren(h('div', { class: 'links' }, left, right));
}
function entityDetail(id) {
  const G = state.run.G, n = G.nodes.get(id), inst = W().get(id);
  const out = (G.out.get(id) ?? []), inn = (G.inn.get(id) ?? []);
  const group = (edges, pick) => { const m = {}; for (const e of edges) (m[e.rel] ??= []).push(pick(e)); return m; };
  const outG = group(out, (e) => e.to), inG = group(inn, (e) => e.from);
  const cases = state.world.cases.filter((c) => verdictOf(c.id).entities.includes(id)).map((c) => c.id);
  const facts = (state.run.facts ?? []).filter((f) => [f.discId, f.videoId, f.appearanceId, f.clickId, f.creatorId, f.linkId, f.manufacturerId, f.moldId, f.rowKey].includes(id)).slice(0, 5);
  const relBlock = (title, g, dir) => Object.keys(g).length ? h('div', { class: 'rels' }, h('h3', null, title), Object.entries(g).map(([rel, ids]) => h('div', { class: 'rel' }, h('span', { class: 'rl' }, dir === 'out' ? relPhrase(rel) : `${relPhrase(rel)} (from)`, h('span', { class: 'n' }, ids.length)), h('div', { class: 'ents' }, [...new Set(ids)].slice(0, 40).map((x) => chipFor(x)), ids.length > 40 && h('span', { class: 'mute' }, `…${ids.length - 40} more`))))) : null;
  return h('div', { class: 'ent-detail' },
    state.trail.length ? h('button', { class: 'back', onclick: () => { state.entityId = state.trail.pop(); renderAll(); } }, `← back to ${label(state.trail[state.trail.length - 1] ?? state.entityId)}`.replace(/^← back to .*/, '← back')) : null,
    h('div', { class: 'kicker' }, h('span', null, n.frame), h('span', { class: 'mono' }, id)),
    h('h1', null, n.label),
    neighbourhood(id),
    inst && h('div', { class: 'terms' }, h('h3', null, 'Terminals'), Object.entries(inst.t).filter(([k]) => k !== 'fractions').map(([k, v]) => h('div', { class: 'term' }, h('span', { class: 'tn' }, k), h('span', { class: 'tv' }, termValue(v))), ), inst.t.fractions && h('div', { class: 'term' }, h('span', { class: 'tn' }, 'fractions'), h('span', { class: 'tv mute' }, `${inst.t.fractions.length} points, derived`))),
    relBlock('Points at', outG, 'out'), relBlock('Pointed at by', inG, 'in'),
    facts.length ? h('div', { class: 'facts' }, h('h3', null, 'What the data says about it'), facts.map((f) => h('p', { class: 'sentence' }, f.sentence))) : null,
    h('div', { class: 'incases' }, h('h3', null, `In ${cases.length} Case${cases.length === 1 ? '' : 's'}`), h('div', { class: 'ents' }, cases.slice(0, 40).map((cid) => h('button', { class: 'ent case', onclick: () => goCase(cid) }, `${cid} ${caseOf(cid).title.slice(0, 48)}`)), cases.length > 40 && h('span', { class: 'mute' }, `…${cases.length - 40} more`))));
}
function termValue(v) {
  if (Array.isArray(v)) return h('span', null, v.length ? v.slice(0, 12).map((x, n) => [n ? ', ' : '', typeof x === 'string' && state.run.G.nodes.has(x) ? chipFor(x) : typeof x === 'object' ? JSON.stringify(x) : String(x)]) : 'none', v.length > 12 && ` …${v.length - 12} more`);
  if (typeof v === 'string' && state.run.G.nodes.has(v)) return chipFor(v);
  if (v === null) return h('i', { class: 'none' }, 'none');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function neighbourhood(id) {
  const G = state.run.G, ns = G.neighbors(id);
  const seen = new Map();
  for (const x of ns) if (!seen.has(x.id)) seen.set(x.id, x);
  const list = [...seen.values()].slice(0, 22);
  if (!list.length) return null;
  const S = 360, cx = S / 2, cy = S / 2, R = 128;
  const svg = sv('svg', { viewBox: `0 0 ${S} ${S}`, class: 'nb', role: 'img', 'aria-label': `Neighbours of ${label(id)}` });
  list.forEach((x, k) => {
    const a = (k / list.length) * Math.PI * 2 - Math.PI / 2, px = cx + R * Math.cos(a), py = cy + R * Math.sin(a);
    svg.append(sv('line', { x1: cx, y1: cy, x2: px, y2: py, class: x.dir === 'out' ? 'eo' : 'ei' }));
  });
  list.forEach((x, k) => {
    const a = (k / list.length) * Math.PI * 2 - Math.PI / 2, px = cx + R * Math.cos(a), py = cy + R * Math.sin(a);
    const lb = G.nodes.get(x.id)?.label ?? x.id, t = lb.length > 20 ? `${lb.slice(0, 19)}…` : lb;
    const g = sv('g', { class: 'nd', tabindex: 0, role: 'button', 'aria-label': lb }, sv('circle', { cx: px, cy: py, r: 5 }), sv('text', { x: px + (Math.cos(a) >= 0 ? 8 : -8), y: py + 3, 'text-anchor': Math.cos(a) >= 0 ? 'start' : 'end' }, t));
    g.addEventListener('click', () => goEntity(x.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') goEntity(x.id); });
    svg.append(g);
  });
  svg.append(sv('circle', { cx, cy, r: 8, class: 'me' }));
  return h('div', { class: 'nbwrap' }, svg, h('p', { class: 'mute' }, `${ns.length} direct links${ns.length > list.length ? `, ${list.length} drawn` : ''}. Click a dot to walk to it.`));
}

/* ---------- Frames ---------- */
function renderFrames() {
  const sys = frameSystem(), audit = Object.fromEntries(state.results.audit.map((a) => [a.terminal, a]));
  const el = h('div', { class: 'page-pad' }, h('h1', null, 'Frames'),
    h('p', { class: 'lead' }, `${sys.nodes.filter((n) => n.role === 'input').length} input frames, 1 abstract parent, ${sys.nodes.filter((n) => n.role === 'alternate').length} alternate frames. A terminal is a slot with a type, a default and expectations. A soft expectation names (its “mismatch” string) what to do when it fails: instantiate an alternate frame from the failing instance's terminals, or call a named transformation. Alternates inherit their parent frame and carry expectations of their own, so one failure can lead to the next frame (a chain).`));
  for (const [id, f] of Object.entries(FRAMES)) {
    const terms = Object.entries(effectiveTerminals(id));
    el.append(h('details', { class: 'frame-def', id: `frame-${id}` }, h('summary', null, h('b', null, id), h('span', { class: 'role' }, f.role === 'alternate' ? `alternate of ${f.inherits}` : f.role === 'abstract' ? 'abstract parent' : f.inherits ? `input, inherits ${f.inherits}` : 'input'), h('span', { class: 'mute' }, ` ${terms.length} terminals`)),
      h('p', null, f.description),
      h('div', { class: 'tdefs' }, terms.map(([name, t]) => {
        const exps = effectiveExpect(id, name), a = audit[`${id}.${name}`];
        return h('div', { class: 'tdef' }, h('div', { class: 'th' }, h('b', null, name), h('code', null, t.type), t.derive && h('span', { class: 'tag' }, 'derived'), a && (a.cases ? h('span', { class: 'tag ok' }, `${a.cases} Case${a.cases > 1 ? 's' : ''}`) : a.skip ? h('span', { class: 'tag', title: a.skip }, 'no Case: see Pipeline') : null)),
          exps.length ? exps.map((e) => h('div', { class: 'exp' }, h('i', null, e.id), ` ${e.text} `, e.mismatch ? h('span', { class: 'mm' }, `→ ${e.mismatch}`) : h('span', { class: 'hard' }, '(hard: the world must not break it)'))) : null);
      }))));
  }
  $('#main').replaceChildren(el);
}

/* ---------- Pipeline ---------- */
function renderPipeline() {
  const r = state.results, g = r.graph, s = state.smoke;
  const row = (name, a, b) => h('tr', null, h('td', null, name), h('td', { class: 'num' }, a), h('td', { class: 'num' }, b));
  const kinds = Object.entries(r.kinds);
  const el = h('div', { class: 'page-pad' }, h('h1', null, 'Pipeline'),
    h('div', { class: `smoke ${s?.ok ? 'ok' : 'bad'}` }, h('b', null, 'Smoke check in this page: '), s?.ok ? `this page re-ran the real analysis on the season (${s.ms} ms) and got the same linked results as the stored build (digest ${s.digest}).` : `this page's re-run did NOT match the stored build (${s?.digest} vs ${r.baseProjectionDigest}).`,
      h('br'), 'It uses the same code as the build, so it cannot catch a bug in that code. The verification is the build: `node --test` and an independent oracle that imports none of this code.'),
    h('h2', null, 'How cross-linked is the dataset'),
    h('table', { class: 'mini' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Round 1'), h('th', null, 'Now'))), h('tbody', null,
      row('Things (nodes)', g.before.nodes, g.after.nodes), row('References (edges)', g.before.edges, g.after.edges), row('Connected components', g.before.components, g.after.components),
      row('Average references per thing', g.before.avgDegree, `${g.after.avgDegree} (${g.after.avgDegreeNonClick} without ${g.after.clicks} click leaves)`),
      row('Reference edges between Cases', g.before.crossCaseEdges, '(Cases share things instead)'), row('Case pairs sharing a disc, video, mold, release, deal, bag, link or click', 0, g.after.crossCaseEdges),
      row('Things in more than one Case', g.before.entitiesInMoreThanOneCase, g.after.entitiesInMoreThanOneCase), row('Case network components', 'n/a (47 islands)', g.after.caseComponents), row('Sponsor rows adding up several creators', 0, g.rollups.sponsorRowsWithManyCreators), row('Molds with several creators', 1, g.rollups.moldsWithManyCreators))),
    h('p', { class: 'mute' }, 'Round 1 numbers are the Critic\'s measurement of the old data (47 disconnected fragments).'),
    h('h2', null, `${state.world.cases.length} Cases by kind`),
    h('table', { class: 'mini' }, h('tbody', null, kinds.map(([k, n]) => h('tr', null, h('td', null, KIND_LABEL[k]), h('td', { class: 'num' }, n))))),
    h('h2', null, 'Registered Calculations (build)'),
    r.reports.map((rep) => h('details', { class: 'calc' }, h('summary', null, h('b', null, rep.calculationId), h('span', { class: `pill ${rep.status === 'PASS' ? 'pass' : 'fail'}` }, rep.status), h('span', { class: 'mute' }, ` ${rep.corpusSize} item${rep.corpusSize === 1 ? '' : 's'}, ${rep.guarantees.length} guarantees`)),
      h('p', null, rep.description), h('ul', null, rep.guarantees.map((x) => h('li', { class: x.passed ? '' : 'f' }, h('b', null, x.passed ? '✓ ' : '✗ '), x.description, h('span', { class: 'mute' }, ` ${x.passCount}/${x.totalCount}`)))))),
    r.mutants && h('div', null, h('h2', null, 'Mutation test'), h('p', { class: 'lead' }, `${r.mutants.summary.killed} of ${r.mutants.summary.applied} injected bugs were caught by the tests${r.mutants.summary.survived.length ? `; survived: ${r.mutants.summary.survived.join(', ')}` : ''}.`),
      h('details', { class: 'calc' }, h('summary', null, 'The bugs'), h('ul', null, r.mutants.results.map((m) => h('li', null, h('b', null, m.killed ? '✓ ' : m.applied ? '✗ ' : '– '), m.name, h('span', { class: 'mute' }, m.applied ? ` ${m.failedCount} failing test${m.failedCount === 1 ? '' : 's'}` : ` not applied: ${m.note}`)))))),
    h('h2', null, 'Terminals with no Case, and why'),
    h('ul', { class: 'plain' }, r.audit.filter((a) => a.skip).map((a) => h('li', null, h('code', null, a.terminal), ` ${a.skip}`))),
    r.rejected.length ? h('div', null, h('h2', null, 'Derived situations that could not be made'), h('ul', { class: 'plain' }, r.rejected.map((x) => h('li', null, h('code', null, x.slug ?? x.slot.split('|').slice(0, 2).join(' ')), ` ${x.reason}`)))) : null);
  $('#main').replaceChildren(el);
}

/* ---------- shell ---------- */
function syncTabs() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#shell').dataset.view = state.view;
}
function updateStatus() {
  const r = state.results, vs = Object.values(r.verdicts), pass = vs.filter((v) => v.pass).length, calcs = r.reports.filter((x) => x.status === 'PASS').length;
  const ok = pass === vs.length && calcs === r.reports.length;
  $('#status').innerHTML = `<b class="${ok ? '' : 'bad'}" id="summary">${pass} / ${vs.length} Cases PASS</b> in the build · ${calcs} / ${r.reports.length} Calculations PASS · <span id="smoke" class="${state.smoke?.ok ? '' : 'bad'}">page smoke check ${state.smoke?.ok ? 'matches' : 'DIFFERS'}</span>`;
}
function updateToggle() { const t = $('#mobile-toggle'); if (t) { t.innerHTML = `<span>Cases</span><b>${state.caseId} ▾</b>`; t.style.display = state.view === 'cases' && mobile() ? 'flex' : 'none'; } }
function renderAll() {
  syncTabs(); setHash();
  if (state.view === 'cases') { renderList(); renderCase(); } else if (state.view === 'sponsors') renderSponsors(); else if (state.view === 'links') renderLinks(); else if (state.view === 'frames') renderFrames(); else renderPipeline();
  updateToggle();
}

async function start() {
  const [world, results] = await Promise.all([fetch('data/toy-world.json', { cache: 'no-store' }).then((r) => r.json()), fetch('data/results.json', { cache: 'no-store' }).then((r) => r.json())]);
  state.world = world; state.results = results;
  const t0 = performance.now();
  const A = analyzeWorld(world.instances, 'season');
  const digest = fnv32(JSON.stringify(A.P));
  state.run = { ...A, G: buildGraph(A.W, A.E), facts: deriveFacts(A.W, A.E, A.M) };
  state.smoke = { ok: digest === results.baseProjectionDigest, digest, ms: Math.round(performance.now() - t0) };
  state.caseId = world.cases[0].id;
  readHash();
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => goView(b.dataset.view)));
  const toggle = h('button', { class: 'mobile-toggle', id: 'mobile-toggle', 'aria-label': 'Choose a Case', onclick: () => $('#list').classList.toggle('open') });
  $('#shell').before(toggle);
  addEventListener('resize', updateToggle);
  updateStatus(); renderAll();
  document.body.dataset.ready = 'true';
}
start().catch((e) => { document.body.dataset.error = String(e); $('#status').textContent = `failed to start: ${e}`; console.error(e); });
export { discLabel, mmss, fmt1, viewerMinutesText };
