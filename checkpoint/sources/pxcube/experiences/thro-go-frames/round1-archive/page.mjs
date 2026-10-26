// The page: runs the real pipeline in the browser (generate -> enrich -> metrics -> verify every Case) and shows each Case with its frames,
// its links, its computed values with Capability Lab receipts, the generated meaning sentence, and the creator insight panel the display builds.
import { runPipeline, DEFAULT_SEED, fragmentsOf } from './pipeline.mjs';
import { serializeWorld } from './world-json.mjs';
import { FRAMES, frameSystem } from './frames.mjs';
import { DEPARTURES } from './departures.mjs';
import { indexWorld } from './world.mjs';
import { discLabel } from './meaning.mjs';
import { fmt1, fmt2, fmtInt, mmss, prettyDate } from './util.mjs';

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

const KIND_LABEL = { baseline: 'Baseline', 'release-timing': 'Release timing', bag: 'Bags', shelf: 'Shelf', catalog: 'Catalog', sponsor: 'Sponsors', 'appearance-mode': 'Thrown, shown, talked', 'placement-geometry': 'Placement geometry', click: 'Clicks', video: 'Videos', retention: 'Retention', 'cross-creator': 'Cross-creator', combination: 'Seeded combinations' };
const KIND_ORDER = Object.keys(KIND_LABEL);

const state = { run: null, Ws: null, view: 'cases', caseId: null, kind: 'all', failOnly: false, focus: null, tab: 0, seed: DEFAULT_SEED, worldMatch: null };

function load(seed) {
  state.run = runPipeline(seed);
  state.seed = seed;
  state.Ws = Object.fromEntries([...fragmentsOf(state.run.world)].map(([id, inst]) => [id, indexWorld(inst)]));
  if (!state.run.world.cases.some((c) => c.id === state.caseId)) state.caseId = state.run.world.cases[0].id;
  state.focus = null; state.tab = 0;
}

const short = (id) => String(id).replace(/^c\d+\./, '');
const caseOf = (id) => state.run.world.cases.find((c) => c.id === id);

/* ---------------- labels for nodes ---------------- */
function nodeInfo(c, id) {
  const E = state.run.enriched[c.id], W = state.Ws[c.id];
  const app = E.appearances.find((a) => a.id === id);
  if (app) return { frame: 'Appearance', merged: true, label: `appearance · ${E.discs[app.discId].moldName} ${mmss(app.start)}–${mmss(app.end)}`, terms: [['interval', `${mmss(app.start)}–${mmss(app.end)} (${app.seconds} s)`], ['modes', app.modes.join(' + ')], ['evidence', app.evidence.join(' + ')], ['sponsor bucket', app.bucket], ['flags', app.flags.join(', ') || 'none']] };
  const alt = E.alternates.find((a) => a.id === id);
  if (alt) return { frame: alt.frame, alt: true, label: alt.frame, inst: alt };
  const i = W.get(id);
  if (!i) return { frame: '?', label: short(id) };
  const t = i.t;
  const label = {
    Creator: () => t.name, Channel: () => t.title, Manufacturer: () => t.name, Mold: () => `${t.name}`, Shelf: () => `Shelf (${t.discIds.length} discs)`,
    Release: () => `release ${t.datePrecision === 'month' ? t.date : prettyDate(t.date)}${t.runLabel ? ` · ${t.runLabel}` : ''}`,
    SponsorDeal: () => `deal · ${W.get(t.manufacturerId)?.t.name ?? '?'}`,
    Disc: () => (E.discs[i.id] ? discLabel(E, i.id) : t.moldName), Bag: () => `${t.name} \u00b7 ${t.discIds.length} disc${t.discIds.length === 1 ? '' : 's'}`, Video: () => t.title, RetentionCurve: () => `retention curve (${t.fractions.length} pts)`,
    CardPlacement: () => `card ${mmss(t.startSec)}–${mmss(t.endSec)}`, Appearance: () => `marked ${t.mode} ${mmss(t.startSec)}–${mmss(t.endSec)}`,
    Link: () => `link ${t.code}`, Click: () => `click · ${t.refererHost}${t.videoTimestamp != null ? ` @${mmss(t.videoTimestamp)}` : ''}`,
  }[i.frame]?.() ?? short(id);
  return { frame: i.frame, label, inst: i };
}

/* ---------------- value formatting ---------------- */
function fmtVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return /^c\d+\./.test(v) ? short(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length > 8 && v.every((x) => typeof x === 'number')) return `${v.length} numbers (${v[0]} … ${v[v.length - 1]})`;
    if (v.every((x) => typeof x === 'string')) return v.length ? `[${v.map(fmtVal).join(', ')}]` : '[]';
    return JSON.stringify(v).replace(/c\d+\./g, '').slice(0, 90);
  }
  return JSON.stringify(v).replace(/c\d+\./g, '').slice(0, 90);
}
const receiptText = (r) => (r ? [...new Set(r.calls.map((c) => c.id))].join(' → ') : null);

/* ---------------- left list ---------------- */
function renderList() {
  const list = $('#list');
  list.replaceChildren();
  const cases = state.run.world.cases;
  const kinds = KIND_ORDER.filter((k) => cases.some((c) => c.kind === k));
  const bar = h('div', { class: 'filters' },
    h('button', { class: state.kind === 'all' ? 'on' : '', onclick: () => { state.kind = 'all'; renderList(); } }, 'all'),
    kinds.map((k) => h('button', { class: state.kind === k ? 'on' : '', onclick: () => { state.kind = k; renderList(); } }, KIND_LABEL[k])),
    h('button', { class: state.failOnly ? 'on' : '', onclick: () => { state.failOnly = !state.failOnly; renderList(); } }, 'failing only'));
  list.append(bar);
  for (const k of kinds) {
    if (state.kind !== 'all' && state.kind !== k) continue;
    const group = cases.filter((c) => c.kind === k && (!state.failOnly || !state.run.verdicts[c.id].pass));
    if (!group.length) continue;
    list.append(h('div', { class: 'group' }, `${KIND_LABEL[k]} · ${group.length}`));
    for (const c of group) {
      const v = state.run.verdicts[c.id];
      list.append(h('button', { class: 'item', 'data-case': c.id, 'aria-current': c.id === state.caseId ? 'true' : 'false', onclick: () => selectCase(c.id) },
        h('span', { class: 'id' }, c.id), h('span', { class: 'slug' }, c.slug.replace(/^baseline$/, 'all defaults').replace(/\+/g, ' + ').replace(/:/g, ' › ')), h('span', { class: `pill ${v.pass ? 'pass' : 'fail'}` }, v.pass ? 'PASS' : 'FAIL'),
        h('span', { class: 't' }, c.title)));
    }
  }
}

function selectCase(id) {
  state.caseId = id; state.focus = null; state.tab = 0; state.view = 'cases';
  syncTabs(); renderList(); renderMain();
  $('#list').classList.remove('open'); updateToggle();
  $('#main').scrollTop = 0; window.scrollTo(0, 0);
}

/* ---------------- case page ---------------- */
function caseHead(c, v) {
  return h('section', { class: 'case-head' },
    h('div', { class: 'kicker' }, h('span', null, `Case ${c.id}`), h('span', null, KIND_LABEL[c.kind]), h('span', { class: `pill ${v.pass ? 'pass' : 'fail'}`, id: 'case-verdict' }, v.pass ? 'PASS' : 'FAIL'), h('span', null, `${v.checks.length} checks`)),
    h('h1', null, c.title),
    h('div', { class: 'departs' }, c.departures.length
      ? c.departures.map((d) => h('span', { class: 'dep' }, d.terminal === null ? `${d.frame} ${short(d.instanceId)} removed` : `${short(d.instanceId)}.${d.terminal}  `, d.terminal === null ? null : [h('span', { class: 'arrow' }, fmtVal(d.from)), ' → ', fmtVal(d.to)]))
      : h('span', { class: 'dep' }, 'no departures: every terminal at its default')));
}

function meaningBlock(c, v) {
  return h('section', { class: 'meaning' },
    h('div', { class: 'label' }, 'What this means for the creator or sponsor · generated from the linked data'),
    v.meaning.map((m) => h('blockquote', null, m ?? '(no sentence produced)')));
}

function panelNode(p) {
  const el = h('div', { class: 'panel' },
    h('div', { class: 'who' }, p.creator.name, h('span', null, p.creator.handle)));
  for (const v of p.videos) {
    el.append(h('div', { class: 'video' },
      h('h3', null, v.title, h('span', { class: 'tag' }, v.format === 'short' ? 'Short · vertical' : 'long'), v.retentionState !== 'ok' ? h('span', { class: 'tag' }, v.retentionState.replace('-', ' ')) : null),
      h('div', { class: 'meta' }, h('span', null, `published ${prettyDate(v.publishedAt)}`), h('span', null, `${v.duration} s`), h('span', null, v.viewsText), h('span', null, `sponsor: ${v.sponsorText}`), v.bag ? h('span', null, `bag: ${v.bag.discs.join(', ')}`) : null),
      v.discs.length ? v.discs.map((d) => h('div', { class: 'disc' },
        h('div', { class: 'name' }, d.label, h('small', null, `${d.brand} · ${d.span} · ${d.seconds} s`)),
        h('div', { class: `att${d.attention.value == null ? ' na' : ''}` }, d.attention.value == null ? d.attention.text : [fmt1(d.attention.value), h('small', null, 'attention-seconds')]),
        h('div', { class: 'chips' }, d.chips.map((c) => h('span', { class: `chip ${c.kind}`, 'data-code': c.code }, c.text)), d.clicksCredited ? h('span', { class: 'chip' }, `${d.clicksCredited} click${d.clicksCredited === 1 ? '' : 's'} credited`) : null)))
        : h('div', { class: 'notice' }, 'No card or marked appearance in this video.'),
      v.issues.length ? h('ul', { class: 'issues' }, v.issues.map((i) => h('li', null, `data issue: ${i.text}`))) : null,
      v.clicks.length ? h('ul', { class: 'clicklist' }, v.clicks.map((k) => h('li', null, h('span', { class: 'k' }, `${k.host} · ${k.country}${k.timestamp != null ? ` · @${mmss(k.timestamp)}` : ''}`), ` — ${k.text}`))) : null));
  }
  if (!p.videos.length) el.append(h('div', { class: 'notice' }, 'No videos for this creator.'));
  if (p.sponsorRows.length) el.append(h('div', { class: 'sub-h' }, 'Sponsor exposure per quarter'), h('table', { class: 'mini' }, h('tbody', null, p.sponsorRows.map((r) => h('tr', null,
    h('td', null, r.brand, r.kind === 'other' ? h('small', { class: 'cov' }, ` · not a sponsor (${r.reasons.join(', ')})`) : null), h('td', null, r.quarter), h('td', { class: 'num' }, r.kind === 'sponsor' ? r.minutesText : `${fmt2(r.minutes)} min, other brand`), h('td', { style: 'white-space:nowrap' }, r.creators > 1 ? `${r.creators} creators` : '1 creator'))))));
  if (p.releaseRows.length) el.append(h('div', { class: 'sub-h' }, 'Release support'), h('table', { class: 'mini' }, h('tbody', null, p.releaseRows.flatMap((r) => r.items.map((i) => h('tr', null, h('td', null, `${r.dateText}${r.runLabel ? ` · ${r.runLabel}` : ''}`), h('td', null, i.title), h('td', { class: 'num' }, i.chip.text)))))));
  if (p.moldRollups.length) el.append(h('div', { class: 'sub-h' }, 'Mold rollup'), h('table', { class: 'mini' }, h('tbody', null, p.moldRollups.map((m) => h('tr', null, h('td', null, `${m.moldName} · ${m.discCount} disc${m.discCount === 1 ? '' : 's'}`), h('td', { class: 'num' }, m.ownText), h('td', null, m.otherCreators ? `${m.otherCreators} other creator shares this mold` : ''))))));
  for (const n of p.notices) el.append(h('div', { class: 'notice' }, n));
  el.append(h('div', { class: 'foot' }, p.footnote));
  return el;
}
function panelSection(c, v) {
  const ids = Object.keys(v.panels);
  const tab = Math.min(state.tab, ids.length - 1);
  const sec = h('section', { class: 'sec' }, h('h2', null, 'How the display renders it ', h('small', null, 'creator insight panel, built from the linked data')));
  if (ids.length > 1) sec.append(h('div', { class: 'ptabs' }, ids.map((id, i) => h('button', { class: i === tab ? 'on' : '', onclick: () => { state.tab = i; renderMain(true); } }, v.panels[id].creator.name))));
  sec.append(panelNode(v.panels[ids[tab]]));
  return sec;
}

/* ---------------- links ---------------- */
const COLS = [
  { name: 'who and deals', frames: ['Creator', 'Channel', 'Shelf', 'Bag', 'SponsorDeal'] },
  { name: 'video', frames: ['Video', 'RetentionCurve'] },
  { name: 'on screen', frames: ['CardPlacement', 'Appearance'] },
  { name: 'links', frames: ['Link', 'Click'] },
  { name: 'disc', frames: ['Disc'] },
  { name: 'catalog', frames: ['Mold', 'Manufacturer', 'Release'] },
  { name: 'selected by mismatch', frames: ['*'] },
];
function colOf(info) {
  if (info.alt || info.frame === 'ProvisionalMold') return info.frame === 'ProvisionalMold' ? 5 : 6;
  const i = COLS.findIndex((c) => c.frames.includes(info.frame));
  return i < 0 ? 6 : i;
}
function linkSection(c) {
  const E = state.run.enriched[c.id];
  const ids = [...new Set(E.edges.flatMap((e) => [e.from, e.to]))];
  const infos = Object.fromEntries(ids.map((id) => [id, nodeInfo(c, id)]));
  if (!state.focus || !infos[state.focus]) state.focus = E.appearances[0]?.id ?? ids[0];
  const focus = state.focus;
  const near = new Set(E.edges.filter((e) => e.from === focus || e.to === focus).flatMap((e) => [e.from, e.to]));
  const W_ = 142, GAP = 24, ROW = 27, TOP = 26;
  const cols = COLS.map(() => []);
  for (const id of ids) cols[colOf(infos[id])].push(id);
  const order = (id) => { const f = infos[id].frame; return Object.keys(FRAMES).indexOf(f) * 1000 + (infos[id].merged ? 500 : 0); };
  cols.forEach((col) => col.sort((a, b) => order(a) - order(b) || a.localeCompare(b)));
  const pos = {};
  cols.forEach((col, ci) => col.forEach((id, ri) => { pos[id] = { x: ci * (W_ + GAP), y: TOP + ri * ROW }; }));
  const usedCols = cols.map((col, i) => (col.length ? i : -1)).filter((i) => i >= 0);
  const width = COLS.length * (W_ + GAP) - GAP, height = TOP + Math.max(...cols.map((c2) => c2.length)) * ROW + 6;
  const svg = sv('svg', { class: `graph${focus ? ' has-focus' : ''}`, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Cross-links of this Case' });
  usedCols.forEach((ci) => svg.append(sv('text', { class: 'colhead', x: ci * (W_ + GAP), y: 12 }, COLS[ci].name)));
  for (const e of E.edges) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) continue;
    const fwd = a.x < b.x, same = a.x === b.x;
    const x1 = same ? a.x + W_ : fwd ? a.x + W_ : a.x, x2 = same ? b.x + W_ : fwd ? b.x : b.x + W_, y1 = a.y + 10, y2 = b.y + 10;
    const dx = same ? 40 : (x2 - x1) / 2;
    const path = same ? `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 + dx} ${y2} ${x2} ${y2}` : `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
    const hot = e.from === focus || e.to === focus;
    svg.append(sv('path', { class: `edge${hot ? ' hot' : ''}`, d: path }, sv('title', null, `${infos[e.from].label} —${e.rel}→ ${infos[e.to].label}`)));
  }
  for (const id of ids) {
    const p = pos[id], lab = infos[id].label;
    const g = sv('g', { class: `node${id === focus ? ' focus' : near.has(id) ? ' near' : ''}`, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': lab, 'data-node': id },
      sv('rect', { width: W_, height: 20, rx: 2 }), sv('text', { x: 6, y: 14 }, lab.length > 24 ? `${lab.slice(0, 23)}…` : lab), sv('title', null, `${infos[id].frame}: ${lab}`));
    g.addEventListener('click', () => { state.focus = id; renderMain(true); });
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); state.focus = id; renderMain(true); } });
    svg.append(g);
  }
  const outs = E.edges.filter((e) => e.from === focus), ins = E.edges.filter((e) => e.to === focus);
  const li = (e, other, dir) => h('li', null, h('span', { class: 'rel' }, dir === 'out' ? `${e.rel} →` : `← ${e.rel}`), h('button', { onclick: () => { state.focus = other; renderMain(true); } }, infos[other].label), h('small', { class: 'cov' }, ` ${infos[other].frame}`));
  const fi = infos[focus];
  const card = h('div', { class: 'focuscard', id: 'focus-card' },
    h('div', { class: 'fr' }, fi.frame + (fi.merged ? ' (merged from cards and marks)' : '')), h('h3', null, fi.label),
    h('div', { class: 'rels' }, h('div', null, h('h4', null, `links out (${outs.length})`), h('ul', null, outs.map((e) => li(e, e.to, 'out')))), h('div', null, h('h4', null, `links in (${ins.length})`), h('ul', null, ins.map((e) => li(e, e.from, 'in'))))));
  return h('section', { class: 'sec' }, h('h2', null, 'Linked data ', h('small', null, `${ids.length} things, ${E.edges.length} links · click any node or name to follow the links`)), h('div', { class: 'graph-wrap' }, svg), card);
}

/* ---------------- frames of the case ---------------- */
function framesSection(c) {
  const W = state.Ws[c.id], E = state.run.enriched[c.id];
  const dep = (id, term) => c.departures.find((d) => d.instanceId === id && d.terminal === term);
  const order = Object.keys(FRAMES);
  const groups = order.map((f) => ({ f, list: [...W.instances.filter((i) => i.frame === f), ...E.alternates.filter((a) => a.frame === f)] })).filter((g) => g.list.length);
  const card = (i) => {
    const frame = FRAMES[i.frame];
    const rows = Object.keys(frame.terminals).map((name) => ({ name, how: i.how[name] ?? 'default', v: i.t[name], d: dep(i.id, name) }));
    const n = (k) => rows.filter((r) => r.how === k).length;
    return h('div', { class: 'inst', id: `inst-${i.id}` },
      h('h4', null, h('span', { class: 'fr' }, i.frame), h('button', { onclick: () => { state.focus = i.id; renderMain(true); document.getElementById('focus-card')?.scrollIntoView({ block: 'center' }); } }, short(i.id))),
      h('div', { class: 'sum' }, `${n('default')} default · ${n('given')} filled · ${n('wired')} wired · ${n('derived')} derived · ${n('departed')} departed`),
      h('table', { class: 'terms' }, h('tbody', null, rows.map((r) => h('tr', { class: r.how }, h('td', { class: 'n' }, r.name), h('td', { class: 'v' }, fmtVal(r.v), r.d ? h('span', { class: 'was' }, `was ${fmtVal(r.d.from)} (default ${fmtVal(r.d.default)})`) : null), h('td', { class: 's' }, r.how === 'given' ? 'filled' : r.how))))));
  };
  return h('section', { class: 'sec' }, h('h2', null, 'Frames in this Case ', h('small', null, `${W.instances.length} instances, ${E.alternates.length} alternate-frame instances selected by mismatches`)),
    h('div', { class: 'legend' }, h('span', null, h('i', null, 'default'), ' the frame\'s default assignment'), h('span', null, h('i', { style: 'color:var(--blue)' }, 'filled'), ' set by the scene'), h('span', null, h('i', { style: 'color:var(--teal)' }, 'wired'), ' a reference to another frame'), h('span', null, h('i', { style: 'color:var(--violet)' }, 'derived'), ' computed from other terminals'), h('span', null, h('i', { style: 'color:var(--amber)' }, 'departed'), ' deliberately varied away from the default')),
    h('div', { class: 'frames' }, groups.flatMap((g) => g.list.map(card))));
}

function mismatchSection(c) {
  const E = state.run.enriched[c.id];
  const exp = {};
  for (const e of E.violations) exp[`${e.instanceId}#${e.expectationId}`] = e;
  const section = h('section', { class: 'sec' }, h('h2', null, 'Expectations that were violated ', h('small', null, 'each mismatch selects an alternate frame or a transformation')));
  if (!E.transformations.length) { section.append(h('div', { class: 'rows' }, h('div', { class: 'row' }, h('div', { class: 'l' }, 'No expectation was violated.'), h('div', { class: 'r' }, 'Every filler met its terminal\'s expectations.')))); return section; }
  section.append(h('div', { class: 'rows' }, E.transformations.map((t) => {
    const v = exp[`${t.instanceId}#${t.expectationId}`];
    return h('div', { class: 'row' }, h('div', { class: 'l' }, h('code', null, `${v?.frame ?? ''}.${v?.terminal ?? ''} › ${t.expectationId}`), h('small', { class: 'cov', style: 'display:block' }, `${short(t.instanceId)}: ${v?.text ?? ''}`)),
      h('div', { class: 'r' }, t.action, h('small', null, t.detail)));
  })));
  return section;
}

function valuesOf(c) {
  const E = state.run.enriched[c.id], M = state.run.metrics[c.id], W = state.Ws[c.id];
  const out = [];
  for (const a of E.appearances) {
    const at = M.attention.attention[a.id], v = E.videos[a.videoId];
    out.push({ label: `attention-seconds · ${discLabel(E, a.discId)} in “${v.title}”`, num: at.value == null ? null : fmt1(at.value), na: at.value == null ? (at.state === 'awaiting-views' ? 'not measurable yet (no views)' : 'unavailable (Studio not connected)') : null,
      formula: at.value == null ? 'null, never a silent zero' : `${fmtInt(at.views)} views × Σ retention over ${at.seconds} s (${at.retentionSum.toFixed(4)})`, receipt: at.receipt });
    const d = M.dips.dips[a.id];
    if (d) out.push({ label: `retention inside vs around · ${discLabel(E, a.discId)}`, num: `${d.windowMean.toFixed(3)} vs ${d.surroundMean.toFixed(3)}`, formula: d.dipped ? `dip of ${d.drop.toFixed(3)} (threshold 0.05)` : `no dip (drop ${d.drop.toFixed(3)}, threshold 0.05)`, receipt: d.receipt });
  }
  for (const r of M.releases.releases) for (const x of r.videos) out.push({ label: `release offset · ${discLabel(E, E.appearances.find((a) => a.id === x.appearanceId).discId)}`, num: x.precision === 'month' ? `${x.offsetMin} to ${x.offsetMax} d` : `${x.offsetDays > 0 ? '+' : ''}${x.offsetDays} d`, formula: `${x.class}; published ${prettyDate(x.publishedAt)} minus release ${r.precision === 'month' ? r.date : prettyDate(r.date)} (calendar days; no capability needed)`, receipt: null });
  for (const [id, m] of Object.entries(M.attention.byMold)) if (m.discIds.length > 1 || m.creators.length > 1) out.push({ label: `mold rollup · ${E.discs[m.discIds[0]].moldName}`, num: fmt1(m.value), formula: `statistics.sum over ${m.discIds.length} discs, ${m.creators.length} creator${m.creators.length > 1 ? 's' : ''}`, receipt: m.receipt });
  for (const [id, d] of Object.entries(M.attention.byDisc)) if (d.videoIds.length > 1) out.push({ label: `disc total · ${discLabel(E, id)}`, num: fmt1(d.value), formula: `statistics.sum over ${d.videoIds.length} videos`, receipt: d.receipt });
  for (const r of M.exposure.rows) out.push({ label: `${r.kind === 'sponsor' ? 'sponsor' : 'other brand'} exposure · ${r.brand} · ${r.quarter}`, num: `${fmt2(r.minutes)} min`, formula: r.entries.map((e) => `${fmt1(e.unionAttention)} union attention-seconds / 60${e.sumAttention - e.unionAttention > 1e-9 ? ` (cards summed separately: ${fmt1(e.sumAttention)})` : ''}`).join(' + ') || 'no measurable video', receipt: r.receipt });
  for (const [k, p] of Object.entries(M.clicks.perThousand)) out.push({ label: `credited clicks per 1,000 attention-seconds · ${short(k.split('@')[0])}`, num: fmt2(p.value), formula: `${p.clicks} credited click${p.clicks === 1 ? '' : 's'} / ${fmt1(p.attention)} attention-seconds × 1000 (clicks, not people or sales)`, receipt: p.receipt });
  return out;
}
function valuesSection(c) {
  const vals = valuesOf(c);
  return h('section', { class: 'sec' }, h('h2', null, 'Computed values ', h('small', null, 'every number comes from a registered capability; the receipt shows which and its hashes')),
    h('div', { class: 'rows' }, vals.map((v) => h('div', { class: 'val' }, h('div', { class: 'l' }, v.label), h('div', { class: `n${v.num == null ? ' na' : ''}` }, v.num ?? v.na),
      h('div', { class: 'rc' }, v.receipt ? [h('b', null, receiptText(v.receipt)), ` · in ${v.receipt.inputHash.slice(0, 8)} → out ${v.receipt.resultHash.slice(0, 8)}`] : 'no receipt (date arithmetic or null)'), h('div', { class: 'f' }, v.formula)))));
}
function checksSection(c, v) {
  return h('section', { class: 'sec' }, h('h2', null, 'Executable expectation ', h('small', null, `${v.checks.filter((k) => k.pass).length} of ${v.checks.length} checks pass · expected values come from an independent oracle over the raw instances`)),
    h('div', { class: 'rows' }, v.checks.map((k) => h('div', { class: `check${k.pass ? '' : ' bad'}` }, h('span', { class: k.pass ? 'ok' : 'no' }, k.pass ? '✓' : '✗'), h('span', null, k.label), h('span', { class: 'ev' }, k.pass ? `= ${JSON.stringify(k.actual)}` : `expected ${JSON.stringify(k.expected)}, got ${JSON.stringify(k.actual)}`)))));
}

function renderCase() {
  const c = caseOf(state.caseId), v = state.run.verdicts[c.id];
  const main = $('#main');
  main.replaceChildren(caseHead(c, v), meaningBlock(c, v), h('div', { class: 'two' }, panelSection(c, v), valuesSection(c)), linkSection(c), framesSection(c), mismatchSection(c), checksSection(c, v));
}

/* ---------------- frames view ---------------- */
function renderFrames() {
  const cov = {};
  for (const key of Object.keys(DEPARTURES)) cov[key] = DEPARTURES[key].length;
  const sys = frameSystem();
  const main = $('#main');
  const el = h('div', { class: 'page-pad' }, h('h1', null, 'Frames'),
    h('p', { class: 'lead' }, `${sys.nodes.filter((n) => n.role === 'input').length} input frames and ${sys.nodes.filter((n) => n.role === 'alternate').length} alternate frames, ${sys.nodes.reduce((s, n) => s + n.terminals, 0)} terminals, ${sys.edges.length} reference terminals that link frames into a frame system. Each terminal has a type, a default and expectations; a violated expectation selects an alternate frame or a transformation. Cases are made by varying terminals away from their defaults.`));
  for (const [id, f] of Object.entries(FRAMES)) {
    el.append(h('div', { class: 'frame-def', id: `frame-${id}` }, h('h3', null, id, h('span', { class: 'role' }, f.role === 'alternate' ? `alternate frame · selected by ${f.selectedBy}` : 'input frame')), h('p', null, f.description),
      h('table', { class: 'defs' }, h('thead', null, h('tr', null, ['terminal', 'type', 'default', 'expectations → on mismatch', 'Cases'].map((x) => h('th', null, x)))),
        h('tbody', null, Object.entries(f.terminals).map(([name, t]) => h('tr', null, h('td', { class: 't' }, name), h('td', null, t.type), h('td', null, t.derive ? 'derived' : fmtVal(typeof t.default === 'function' ? t.default() : t.default)),
          h('td', null, t.expect.length ? t.expect.map((e) => h('span', { class: 'exp' }, h('i', null, e.id), ` ${e.text} `, e.mismatch ? h('span', { class: 'mm' }, `→ ${e.mismatch}`) : h('span', { class: 'hard' }, '(hard: never violated)'))) : h('span', { class: 'cov' }, '—')),
          h('td', { class: 'cov' }, cov[`${id}.${name}`] ? h('b', null, `${cov[`${id}.${name}`]} departure${cov[`${id}.${name}`] > 1 ? 's' : ''}`) : '—')))))));
  }
  main.replaceChildren(el);
}

/* ---------------- pipeline view ---------------- */
function renderPipeline() {
  const r = state.run, cases = r.world.cases;
  const byKind = KIND_ORDER.map((k) => [k, cases.filter((c) => c.kind === k).length]).filter(([, n]) => n);
  const seedInput = h('input', { type: 'number', id: 'seed', value: state.seed, 'aria-label': 'seed', style: 'background:var(--bg2);color:var(--ink);border:1px solid var(--rule);padding:4px 8px;width:140px;font:inherit' });
  const el = h('div', { class: 'page-pad' }, h('h1', null, 'Pipeline'),
    h('p', { class: 'lead' }, `Generation, linking and every metric are registered Calculations run through the witness runner; numbers come from ${r.capabilityCount} registered capabilities (Capability Lab statistics, thro.ratio, and two thro-go capabilities). The same seed always gives the same bytes. Change the seed to generate a different world: every Case is checked again.`),
    h('div', { style: 'display:flex;gap:10px;align-items:center;margin:0 0 22px;flex-wrap:wrap' }, h('label', { for: 'seed', class: 'cov' }, 'seed'), seedInput,
      h('button', { class: 'pill pass', id: 'run-seed', onclick: () => { load(Number(seedInput.value) || DEFAULT_SEED); updateStatus(); renderAll(); } }, 'RUN SEED'), h('span', { class: 'cov' }, state.worldMatch == null ? '' : state.worldMatch)),
    h('div', { class: 'sub-h' }, `${cases.length} Cases by kind`), h('table', { class: 'mini' }, h('tbody', null, byKind.map(([k, n]) => h('tr', null, h('td', null, KIND_LABEL[k]), h('td', { class: 'num' }, n))))),
    h('div', { class: 'sub-h', style: 'margin-top:22px' }, 'Registered Calculations'),
    r.reports.map((rep) => h('div', { class: 'calc' }, h('h3', null, rep.calculationId, h('span', { class: `pill ${rep.status === 'PASS' ? 'pass' : 'fail'}` }, rep.status), h('span', { class: 'cov' }, `${rep.corpusSize} items`)), h('p', null, rep.description),
      h('ul', null, rep.guarantees.map((g) => h('li', { class: g.passed ? '' : 'f' }, h('b', null, g.passed ? '✓' : '✗'), `${g.description} `, h('span', { class: 'cov' }, `${g.passCount}/${g.totalCount}`)))))));
  $('#main').replaceChildren(el);
}

/* ---------------- shell ---------------- */
function renderMain(keepScroll) {
  const main = $('#main'), top = main.scrollTop, wtop = window.scrollY;
  if (state.view === 'frames') renderFrames(); else if (state.view === 'pipeline') renderPipeline(); else renderCase();
  if (keepScroll) { main.scrollTop = top; window.scrollTo(0, wtop); }
}
function syncTabs() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#shell').classList.toggle('nolist', state.view !== 'cases');
}
function updateToggle() {
  const t = $('#mobile-toggle');
  if (t) t.innerHTML = `<span>Cases</span><b>${state.caseId} ▾</b>`;
}
function updateStatus() {
  const r = state.run, pass = Object.values(r.verdicts).filter((v) => v.pass).length, total = r.world.cases.length;
  const calcs = r.reports.filter((x) => x.status === 'PASS').length;
  const ok = pass === total && calcs === r.reports.length;
  $('#status').innerHTML = `<b class="${ok ? '' : 'bad'}" id="summary">${pass} / ${total} Cases PASS</b> · ${calcs} / ${r.reports.length} Calculations PASS · seed ${state.seed}${state.worldMatch ? ` · ${state.worldMatch}` : ''}`;
}
function renderAll() { syncTabs(); renderList(); renderMain(); updateToggle(); }

async function start() {
  const t0 = performance.now();
  load(DEFAULT_SEED);
  try {
    const res = await fetch('data/toy-world.json', { cache: 'no-store' });
    const text = await res.text();
    state.worldMatch = text === serializeWorld(state.run.world) ? 'regenerated world = data/toy-world.json, byte for byte' : 'data/toy-world.json differs from the regenerated world';
  } catch { state.worldMatch = null; }
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; renderAll(); $('#main').scrollTop = 0; window.scrollTo(0, 0); }));
  const toggle = h('button', { class: 'mobile-toggle', id: 'mobile-toggle', 'aria-label': 'Choose a Case', onclick: () => $('#list').classList.toggle('open') });
  $('#shell').before(toggle);
  new MutationObserver(() => { toggle.style.display = state.view === 'cases' && matchMedia('(max-width: 800px)').matches ? 'flex' : 'none'; }).observe($('#shell'), { attributes: true });
  updateStatus(); renderAll();
  toggle.style.display = matchMedia('(max-width: 800px)').matches ? 'flex' : 'none';
  document.body.dataset.ready = 'true';
  console.info(`pipeline ran in ${Math.round(performance.now() - t0)} ms`);
}
start();
