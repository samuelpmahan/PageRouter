// Verify one Case against the shared season world. Every check is a statement that can fail:
//   world-valid           no hard expectation is violated and every reference/type holds (soft violations are allowed: they select alternates)
//   calculations-pass     all six registered Calculations keep their guarantees in this (possibly changed) world
//   pipeline-equals-oracle the linked results equal an independent recomputation from the raw JSON (oracle.mjs imports nothing)
//   observable-effect     (departures) the change shows up in linked results or in a meaning sentence; a terminal with no effect is rejected
//   locality              (departures) only creators connected to what was changed have different results
//   mismatch-selects      (expectation departures) the failed expectation's own mismatch string selected the frame or transformation it names
//   expect:<kind>         what the Case claims (deal active, release class, offset, quarter, local day, seconds on screen, clamp, click credit)
//   situation-present     (observed) the situation exists in the world and the pipeline agrees with the oracle on those exact entries
//   meaning-numbers       the meaning sentences contain the oracle's numbers
import { oracle } from './oracle.mjs';
import { diffProjections } from './projection.mjs';
import { typeProblems, effectiveTerminals } from './frames.mjs';
import { buildGraph, neighborhood, nodeLabel } from './graph.mjs';
import { creatorOfVideo } from './world.mjs';
import { factsOf, effectOf } from './effect.mjs';
import { fmtAtt } from './util.mjs';

const KINDS = {
  'release-day': ['release-window'], 'window-last-day': ['release-window'], 'custom-window': ['release-window'], 'reissue-day': ['release-window'], 'window-day-after': ['established'],
  'pre-release-day': ['pre-release'], 'pre-release-month': ['pre-release'], 'release-month-first-day': ['release-month'], 'release-month-last-day': ['release-month'],
  'two-runs-one-video': ['release-window', 'established', 'pre-release', 'release-month'],
  'deal-last-day': ['attention', 'sponsor-exposure'], 'deal-first-day': ['attention', 'sponsor-exposure'], 'sponsor-switch': ['brand-switch', 'attention'], 'two-sponsors-one-video': ['attention', 'sponsor-exposure'],
  'other-brand': ['other-brand'], 'no-deal': ['other-brand'], 'mold-not-covered': ['other-brand'],
  'quarter-edge-time-zone': ['attention', 'sponsor-exposure', 'other-brand-exposure'], 'local-day-differs': ['attention', 'sponsor-exposure', 'other-brand-exposure'],
  'chained-frames': ['chained'], 'shown-only': ['shown-only'], 'thrown-no-card': ['thrown-no-card'], 'talked-no-card': ['talked'], 'merged-cards': ['merged-overlap'], 'overlap-different-discs': ['sponsor-exposure'],
  'provisional-mold': ['provisional-mold'], 'resolved-by-name': ['normalized-name'], 'awaiting-views': ['awaiting-views'], 'no-curve': ['no-curve'], 'short-attention': ['short'], 'views-growth': ['views-growth'],
  'retention-dip': ['dip'], 'rewatch-bump': ['dip', 'steady'], 'disc-leaves-and-returns': ['bag-change'], 'bag-no-card': ['bag-no-card'], 'two-discs-one-mold': ['two-plastics'],
  'click-card-last-second': ['click-moment'], 'click-card-gone': ['click-video-level'], 'click-card-first-second': ['click-moment'], 'click-before-card': ['click-video-level'],
  'click-bio-link': ['click-unattributed'], 'click-predates-publish': ['click-unattributed'], 'click-at-publish-instant': ['click-credited', 'click-moment', 'click-video-level'],
  'click-disc-not-in-video': ['click-unattributed'], 'click-video-level': ['click-credited', 'click-video-level'], 'off-brand-link': ['off-brand-link'],
  'link-placements': ['click-credited', 'click-moment', 'click-video-level', 'click-unattributed'], 'cross-creator-mold': ['cross-creator'], 'cross-creator-sponsor': ['sponsor-exposure'], 'unmeasurable-sponsor-row': ['sponsor-exposure', 'other-brand-exposure'], 'clicks-per-thousand': [],
};
export const factKindsFor = (c) => (c.kind === 'observed' || c.kind === 'chained' ? KINDS[c.slug.replace(/^observed:/, '')] ?? (c.factKind ? [c.factKind] : []) : []);

const rawOf = (A) => JSON.parse(JSON.stringify(A.W.instances.map((i) => ({ id: i.id, frame: i.frame, t: i.t }))));
const hardProblems = (A) => [...typeProblems(A.W).map((p) => (typeof p === 'string' ? p : JSON.stringify(p))), ...A.E.violations.filter((v) => !v.mismatch).map((v) => `${v.instanceId}#${v.expectationId}`)];
const chk = (id, ok, detail) => ({ id, ok: !!ok, detail });

// creators whose results an entry carries (from either side of the departure)
function creatorsOfEntry(A, section, key, before, after) {
  const out = new Set(), W = A.W;
  const take = (v) => { if (v) out.add(v); };
  const differing = (x, y) => [...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])].filter((k) => !(k in (x ?? {})) || !(k in (y ?? {})) || Math.abs((x[k] ?? 0) - (y[k] ?? 0)) > 1e-9 * Math.max(1, Math.abs(x[k] ?? 0)) || (x[k] == null) !== (y[k] == null));
  for (const side of [before, after]) {
    if (!side) continue;
    if (section === 'appearances' || section === 'discs') take(side.creatorId);
  }
  // a shared entry (a mold or a sponsor row) belongs to the creators whose own part of it changed, not to everyone who contributes
  if (section === 'mold') differing(before?.perCreator, after?.perCreator).forEach(take);
  if (section === 'sponsorRows') differing(before?.byCreator, after?.byCreator).forEach(take);
  if (section === 'discVideo' || section === 'disc') take(W.get(key.split('@')[0])?.t.creatorId);
  if (section === 'videos') take(W.get(key) && creatorOfVideo(W, W.get(key))?.id);
  if (section === 'clicks') { const c = W.get(key), l = c && W.get(c.t.linkId); take(l && W.get(l.t.discId)?.t.creatorId); }
  if (section === 'perThousand') take(W.get(W.get(key)?.t.discId)?.t.creatorId);
  return out;
}

function checkExpect(c, A, O, baseO) {
  const e = c.expect, W = A.W;
  if (!e) return null;
  const id = `expect:${e.kind}`;
  switch (e.kind) {
    case 'dealActive': {
      const v = O.videos[e.videoId];
      return chk(id, v && v.dealIds.includes(e.dealId) === e.active, `video ${e.videoId} is ${e.active ? '' : 'not '}under ${e.dealId} (oracle: ${v ? v.dealIds.join(',') || 'no deal' : 'missing'}; pipeline: ${A.E.videos[e.videoId]?.dealIds.join(',') || 'no deal'})`);
    }
    case 'releaseClass': {
      const rows = Object.values(O.appearances).filter((a) => a.videoId === e.videoId && a.discId === e.discId);
      const ok = rows.length && rows.every((a) => a.releaseClass === e.releaseClass && (e.offset === undefined || a.offsetMin === e.offset));
      return chk(id, ok, `${e.discId} in ${e.videoId}: class ${rows.map((a) => a.releaseClass).join(',')} offset ${rows.map((a) => a.offsetMin).join(',')}, expected ${e.releaseClass}${e.offset === undefined ? '' : ` at ${e.offset}`}`);
    }
    case 'releaseOffset': {
      const rows = Object.values(O.appearances).filter((a) => a.videoId === e.videoId && a.releaseId === e.releaseId);
      return chk(id, rows.length && rows.every((a) => a.offsetMin === e.offset), `offsets ${rows.map((a) => a.offsetMin).join(',')}, expected ${e.offset}`);
    }
    case 'quarter': return chk(id, O.videos[e.videoId]?.quarter === e.quarter, `video quarter ${O.videos[e.videoId]?.quarter}, expected ${e.quarter}`);
    case 'localDay': return chk(id, O.videos[e.videoId].day !== baseO.videos[e.videoId].day, `local day ${baseO.videos[e.videoId].day} -> ${O.videos[e.videoId].day}`);
    case 'secondsOn': {
      const on = W.get(e.onScreenId);
      const rows = Object.values(O.appearances).filter((a) => a.videoId === on.t.videoId && a.discId === on.t.discId);
      const dur = W.get(on.t.videoId).t.durationSeconds;
      const lo = Math.max(0, on.t.startSec), hi = Math.min(dur, on.t.endSec);
      const cover = rows.filter((a) => a.start <= lo && a.end >= hi);
      const alone = !W.instances.some((i) => i.id !== on.id && (i.frame === 'CardPlacement' || i.frame === 'Appearance') && i.t.videoId === on.t.videoId && i.t.discId === on.t.discId && i.t.startSec < hi && lo < i.t.endSec);
      const ok = cover.length === 1 && (alone ? cover[0].seconds === e.seconds : cover[0].seconds >= e.seconds);
      return chk(id, ok, `${cover.length ? cover[0].seconds : 'no covering appearance'} s on screen, expected ${alone ? '' : 'at least '}${e.seconds}`);
    }
    case 'clampedSeconds': {
      const dur = W.get(e.videoId).t.durationSeconds;
      const rows = Object.values(O.appearances).filter((a) => a.videoId === e.videoId && a.discId === e.discId);
      return chk(id, rows.length && rows.every((a) => a.end <= dur), `appearance ends ${rows.map((a) => a.end).join(',')}, video is ${dur} s`);
    }
    case 'clickCredit': {
      const k = O.clicks[e.clickId];
      let ok = e.credited ? k.kind !== 'unattributed' : k.kind === 'unattributed' && (!e.reason || k.reason === e.reason);
      if (e.credited && e.moment !== undefined) ok = ok && (k.kind === 'moment') === e.moment;
      return chk(id, ok, `click credited as ${k.kind}${k.reason ? ` (${k.reason})` : ''}`);
    }
    default: return chk(id, false, `unknown expect kind ${e.kind}`);
  }
}

// facts that belong to the Case, newest wording only
function factsForCase(c, A) {
  const kinds = new Set(factKindsFor(c));
  const facts = factsOf(A).filter((f) => kinds.has(f.kind));
  const keys = new Set((c.entries ?? []).map((e) => e.key));
  const subj = new Set(c.subjectIds);
  const direct = facts.filter((f) => keys.has(f.appearanceId) || keys.has(f.clickId) || keys.has(f.rowKey) || keys.has(f.moldId));
  if (direct.length) return direct;
  return facts.filter((f) => [f.discId, f.videoId, f.linkId, f.clickId, f.moldId, f.instanceId, f.appearanceId, f.rowKey].some((x) => x && subj.has(x)) || (f.discIds ?? []).some((d) => subj.has(d)));
}

// the sponsor row an appearance feeds (the cross-link the Sponsor view shows)
export function rowOfAppearance(A, key) {
  const a = A.E.appearances.find((x) => x.id === key);
  if (!a) return null;
  const d = A.E.discs[a.discId], v = A.E.videos[a.videoId];
  const rk = `${a.bucket === 'sponsor' ? 'sponsor' : 'other'}|${d.manufacturerId}|${v.quarter}`;
  return A.M.exposure.rows.find((r) => r.key === rk) ?? null;
}

function meaningNumbers(sentences, O) {
  const bad = [];
  for (const f of sentences) {
    if (f.appearanceId && O.appearances[f.appearanceId] && ['attention', 'release-window', 'pre-release', 'release-month', 'established', 'other-brand', 'thrown-no-card', 'short'].includes(f.kind)) {
      const att = O.appearances[f.appearanceId].attention;
      if (att != null && !f.sentence.includes(fmtAtt(att))) bad.push(`${f.kind}: “${fmtAtt(att)}” missing`);
      if (att == null && /got [\d,.]+ attention/.test(f.sentence)) bad.push(`${f.kind}: number for an unmeasurable appearance`);
    }
    if (f.rowKey && O.sponsorRows[f.rowKey] && f.kind.endsWith('exposure')) {
      const r = O.sponsorRows[f.rowKey];
      if (r.viewerMinutes == null ? !/could not be measured/.test(f.sentence) : !f.sentence.includes(fmtAtt(r.viewerMinutes))) bad.push(`${f.kind} ${f.rowKey}`);
    }
    if (f.kind === 'cross-creator' && O.mold[f.moldId] && !f.sentence.includes(fmtAtt(O.mold[f.moldId].attention))) bad.push(`cross-creator ${f.moldId}`);
  }
  return bad;
}

export function verifyCase(c, base, baseO, opts = {}) {
  const A = c.kind === 'observed' || c.kind === 'chained' ? base : c._after;
  const checks = [];
  const O = A === base ? baseO : oracle(rawOf(A));
  checks.push(chk('world-valid', hardProblems(A).length === 0, hardProblems(A).slice(0, 3).join('; ') || 'no hard expectation violated, every reference resolves'));
  checks.push(chk('calculations-pass', A.reports.every((r) => r.status === 'PASS'), A.reports.map((r) => `${r.calculationId.replace('thro.go.', '')} ${r.status}`).join(', ')));
  const diffs = diffProjections(O, A.P);
  checks.push(chk('pipeline-equals-oracle', diffs.length === 0, diffs.length ? `${diffs.length} differences, first ${diffs[0].path}: oracle ${JSON.stringify(diffs[0].a)} vs pipeline ${JSON.stringify(diffs[0].b)}` : `${Object.values(O).reduce((n, s) => n + Object.keys(s).length, 0)} entries equal`));
  let eff = { changed: [], sentences: [], observable: false };
  if (A !== base) {
    eff = c._effect ?? effectOf(base, A);
    checks.push(chk('observable-effect', eff.observable, `${eff.changed.length} linked results and ${eff.sentences.length} sentences differ`));
    // locality: creators whose results changed must be connected (within 5 reference hops) to what was patched
    const G = buildGraph(A.W, A.E), G0 = buildGraph(base.W, base.E);
    const seeds = c.patches.map((p) => p.id);
    const near = new Set([...neighborhood(G, seeds.filter((s) => G.nodes.has(s)), 5), ...neighborhood(G0, seeds.filter((s) => G0.nodes.has(s)), 5)]);
    const nearCreators = new Set([...near].filter((id) => A.W.get(id)?.frame === 'Creator' || base.W.get(id)?.frame === 'Creator'));
    const far = [];
    for (const e of eff.changed) for (const cr of creatorsOfEntry(A, e.section, e.key, e.before, e.after)) if (!nearCreators.has(cr)) far.push(`${e.section}:${e.key} (${cr})`);
    checks.push(chk('locality', far.length === 0, far.length ? `changed outside the neighbourhood: ${far.slice(0, 3).join(', ')}` : `all changes within ${nearCreators.size} connected creator${nearCreators.size === 1 ? '' : 's'}`));
    if (c.kind === 'expectation') {
      const inst = base.W.get(c.instanceId), term = effectiveTerminals(inst.frame)[c.frameTerminal.split('.')[1]];
      const ex = term.expect.find((e) => e.id === c.expectationId);
      const note = A.E.transformations.find((n) => n.instanceId === c.instanceId && n.expectationId === c.expectationId);
      const wasBefore = base.E.transformations.some((n) => n.instanceId === c.instanceId && n.expectationId === c.expectationId);
      const named = ex.mismatch.startsWith('resolve:') ? note && (note.action === ex.mismatch || note.action.startsWith('frame:')) : ex.mismatch.startsWith('frame:') ? (A.E.chains[c.instanceId] ?? []).some((aid) => aid.endsWith(`~${ex.mismatch.slice(6)}`)) : note && note.action === ex.mismatch;
      checks.push(chk('mismatch-selects', !!note && !wasBefore && !!named, note ? `“${ex.mismatch}” fired → ${note.action}${note.alternateId ? ` (${note.alternateId})` : ''}${wasBefore ? ' (already fired before: not caused by this change)' : ''}` : 'the mismatch rule did not fire'));
    }
    const ex = checkExpect(c, A, O, baseO);
    if (ex) checks.push(ex);
  } else {
    const missing = (c.entries ?? []).filter((e) => !(e.key in (O[e.section] ?? {})) || !(e.key in (A.P[e.section] ?? {})));
    const subjectsOk = c.subjectIds.every((id) => A.W.get(id) || A.E.appearances.some((a) => a.id === id) || id in O.appearances || id in O.sponsorRows || id in O.perThousand);
    checks.push(chk('situation-present', !missing.length && subjectsOk && (c.entries.length > 0 || c.subjectIds.length > 0), missing.length ? `missing ${missing[0].section}:${missing[0].key}` : !subjectsOk ? 'a subject id does not resolve' : `${c.entries.length} entries and ${c.subjectIds.length} linked ids found in both the oracle and the pipeline`));
    if (c.kind === 'chained') {
      const root = A.E.appearances.find((a) => a.id === c.entries[0]?.key)?.placementIds[0] ?? null;
      const chain = A.E.chains[root] ?? [];
      const alts = chain.map((id) => A.E.alternates.find((a) => a.id === id));
      const linked = alts.every((alt, n) => alt.parent === (n ? chain[n - 1] : root) && A.E.transformations.some((t) => t.alternateId === alt.id && t.mismatch === `frame:${alt.frame}`));
      checks.push(chk('chain-selected-by-own-expectations', chain.length >= 2 && linked, `${root} → ${alts.map((a) => `${a.frame} (via ${a.vias.join(', ')})`).join(' → ')}`));
    }
  }
  let meaning = [];
  if (c.kind === 'observed' || c.kind === 'chained') {
    meaning = factsForCase(c, A);
    const rowFacts = [];
    for (const e of c.entries ?? []) if (e.section === 'appearances') { const r = rowOfAppearance(A, e.key); if (r) rowFacts.push(...factsOf(A).filter((f) => f.rowKey === r.key)); }
    meaning = [...new Map([...meaning, ...rowFacts].map((f) => [f.sentence, f])).values()];
    if (factKindsFor(c).length) checks.push(chk('has-meaning-sentence', meaning.length > 0, `${meaning.length} sentence${meaning.length === 1 ? '' : 's'} (kinds ${[...new Set(meaning.map((f) => f.kind))].join(', ')})`));
  } else {
    meaning = eff.sentences.flatMap((s) => s.after).slice(0, 8);
  }
  const bad = meaningNumbers(meaning, O);
  checks.push(chk('meaning-numbers', bad.length === 0, bad.length ? bad.slice(0, 3).join('; ') : `${meaning.length} sentence${meaning.length === 1 ? '' : 's'} carry the oracle's numbers`));
  return {
    id: c.id, pass: checks.every((k) => k.ok), checks,
    meaning: meaning.slice(0, 8).map((f) => ({ kind: f.kind, sentence: f.sentence })),
    delta: eff.changed.slice(0, 14).map((e) => ({ section: e.section, key: e.key, fields: e.fields, before: e.before, after: e.after })),
    deltaCount: eff.changed.length,
    sentenceDelta: eff.sentences.slice(0, 6).map((s) => ({ key: s.key, before: s.before.map((f) => f.sentence), after: s.after.map((f) => f.sentence) })),
    chainLength: Math.max((A.E.chains[c.instanceId] ?? []).length, c.kind === 'chained' ? 2 : 0),
  };
}
export { nodeLabel };
