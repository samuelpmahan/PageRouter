// Case derivation. A Case is a situation INSIDE the shared season world, asserted against it. Two families:
//   observed   a situation the world already contains (a release day, a deal's last day, a click at a card's last second, a chain of alternate frames ...),
//              found by scanning the raw world with the independent oracle; the Case asserts how it is handled.
//   departure  a situation made by one deliberate change to the world, derived from FRAMES x terminals x expectations x boundaries (variants.mjs): each
//              soft expectation's violating value, each boundary a terminal declares, each declared variant, each enum value. The Case applies the change
//              (patches.mjs), re-runs the whole linked analysis, and asserts what changed in the linked results (a before/after delta).
// Nothing here is hand-written per Case: observed Cases are predicates over the world, departures come from the frames.
import { analyzeWorld } from './analysis.mjs';
import { indexWorld } from './world.mjs';
import { allCandidates, pickPerSlot } from './variants.mjs';
import { applyPatches, describePatches } from './patches.mjs';
import { violationsOf, typeProblems, effectiveTerminals, refFrame, FRAMES } from './frames.mjs';
import { effectOf } from './effect.mjs';
import { oracle } from './oracle.mjs';
import { nodeLabel } from './graph.mjs';
import { quarterOf } from './util.mjs';

const THEME_OF_FRAME = { Release: 'Release timing', Video: 'Videos and views', RetentionCurve: 'Retention', CardPlacement: 'Cards on screen', Appearance: 'Cards on screen', SponsorDeal: 'Sponsor deals', Channel: 'Time zones and Studio', Bag: 'Bags and shelves', Disc: 'Bags and shelves', Link: 'Links and clicks', Click: 'Links and clicks', Mold: 'Catalog', Manufacturer: 'Catalog', Creator: 'Catalog' };
const THEME_OF_EXPECT = { dealActive: 'Sponsor deals', releaseClass: 'Release timing', releaseOffset: 'Release timing', quarter: 'Time zones and quarters', localDay: 'Time zones and quarters', clickCredit: 'Links and clicks', secondsOn: 'Cards on screen', clampedSeconds: 'Cards on screen' };
export const THEMES = ['Release timing', 'Sponsor deals', 'Time zones and quarters', 'Time zones and Studio', 'Cards on screen', 'Links and clicks', 'Bags and shelves', 'Videos and views', 'Retention', 'Catalog', 'Cross-creator', 'Chains of frames'];
export const KIND_ORDER = ['observed', 'chained', 'expectation', 'boundary', 'variant', 'enum'];

// ---------- observed situations: predicates over the raw world, found with the oracle ----------
export function observedSituations(instances, O) {
  const byId = new Map(instances.map((i) => [i.id, i]));
  const of = (frame) => instances.filter((i) => i.frame === frame);
  const apps = Object.entries(O.appearances).sort(([a], [b]) => (a < b ? -1 : 1));
  const rel = (a) => (a.releaseId ? byId.get(a.releaseId) : null);
  const utcDate = (videoId) => byId.get(videoId).t.publishedAt.slice(0, 10);
  const A = (pred) => { const hit = apps.find(([k, a]) => pred(a, k)); return hit ? { entries: [{ section: 'appearances', key: hit[0] }], subject: [hit[1].discId, hit[1].videoId] } : null; };
  const withApps = (keys) => ({ entries: keys.map((k) => ({ section: 'appearances', key: k })), subject: [...new Set(keys.flatMap((k) => [O.appearances[k].discId, O.appearances[k].videoId]))] });
  const clickCase = (pred) => {
    for (const c of of('Click').sort((x, y) => (x.id < y.id ? -1 : 1))) {
      const link = byId.get(c.t.linkId), v = link.t.videoId && byId.get(link.t.videoId);
      const cards = v ? of('CardPlacement').filter((p) => p.t.videoId === v.id && p.t.discId === link.t.discId && p.t.endSec > p.t.startSec) : [];
      if (pred(c, link, v, cards)) return { entries: [{ section: 'clicks', key: c.id }], subject: [c.id, link.id] };
    }
    return null;
  };
  const rowCase = (pred) => { const hit = Object.entries(O.sponsorRows).sort(([a], [b]) => (a < b ? -1 : 1)).find(([k, r]) => pred(r, k)); return hit ? { entries: [{ section: 'sponsorRows', key: hit[0] }], subject: [hit[0].split('|')[1], ...hit[1].videos] } : null; };
  const S = [];
  const sit = (slug, theme, title, find) => S.push({ slug, theme, title, find });

  // release timing
  sit('release-day', 'Release timing', 'A video published on the release day of the disc it shows', () => A((a) => a.releaseClass === 'release-window' && rel(a).t.datePrecision === 'day' && a.offsetMin === 0));
  sit('window-last-day', 'Release timing', 'A video published on the last day of the release window', () => A((a) => a.releaseClass === 'release-window' && rel(a).t.datePrecision === 'day' && a.offsetMin === rel(a).t.windowDays));
  sit('window-day-after', 'Release timing', 'A video published the day after the release window closed', () => A((a) => a.releaseClass === 'established' && rel(a).t.datePrecision === 'day' && a.offsetMin === rel(a).t.windowDays + 1));
  sit('pre-release-day', 'Release timing', 'A video published days before the release day (pre-release)', () => A((a) => a.releaseClass === 'pre-release' && rel(a).t.datePrecision === 'day' && a.bucket === 'sponsor'));
  sit('pre-release-month', 'Release timing', 'A video published before a release known only to its month (a range of days)', () => A((a) => a.releaseClass === 'pre-release' && rel(a).t.datePrecision === 'month'));
  sit('release-month-first-day', 'Release timing', 'A video published on the first day of the month a release is dated to', () => A((a) => a.releaseClass === 'release-month' && a.offsetMax === 0));
  sit('release-month-last-day', 'Release timing', 'A video published on the last day of the month a release is dated to', () => A((a) => a.releaseClass === 'release-month' && a.offsetMin === 0));
  sit('custom-window', 'Release timing', 'A release with its own window length (not 30 days)', () => A((a) => a.releaseClass && rel(a).t.windowDays !== 30 && a.offsetMin >= 0));
  sit('reissue-day', 'Release timing', 'A reissue run released on the day of the video', () => A((a) => a.releaseClass && rel(a).t.kind === 'reissue' && a.offsetMin === 0));
  sit('two-runs-one-video', 'Release timing', 'The same mold in two runs in one video: each judged against its own run\'s release', () => {
    for (const [, a] of apps) for (const [, b] of apps) if (a.videoId === b.videoId && a.discId < b.discId && discMold(a) === discMold(b) && a.releaseId !== b.releaseId && a.releaseId && b.releaseId) return withApps(apps.filter(([, x]) => x.videoId === a.videoId && (x.discId === a.discId || x.discId === b.discId)).map(([k]) => k));
    return null;
  });
  function discMold(a) { return O.discs[a.discId].moldId; }

  // sponsor deals, quarters, time zones
  sit('deal-last-day', 'Sponsor deals', 'A video published on the last day of the sponsor deal', () => A((a) => a.bucket === 'sponsor' && of('SponsorDeal').some((d) => d.id === a.dealId && d.t.end === O.videos[a.videoId].day)));
  sit('deal-first-day', 'Sponsor deals', 'A video published on the first day of a new sponsor deal', () => A((a) => a.bucket === 'sponsor' && of('SponsorDeal').some((d) => d.id === a.dealId && d.t.start === O.videos[a.videoId].day && d.t.start !== '2026-01-01')));
  sit('sponsor-switch', 'Sponsor deals', 'Sponsor switch: the last video for one brand and the first for the next', () => {
    const deals = of('SponsorDeal');
    for (const d1 of deals) for (const d2 of deals) if (d1.t.creatorId === d2.t.creatorId && d1.t.manufacturerId !== d2.t.manufacturerId && d1.t.end < d2.t.start) {
      const k1 = apps.find(([, a]) => a.dealId === d1.id && O.videos[a.videoId].day === d1.t.end), k2 = apps.find(([, a]) => a.dealId === d2.id && O.videos[a.videoId].day === d2.t.start);
      if (k1 && k2) return withApps([k1[0], k2[0]]);
    }
    return null;
  });
  sit('two-sponsors-one-video', 'Sponsor deals', 'One video showing discs of two different sponsors, each under its own deal', () => {
    const byVideo = {};
    for (const [k, a] of apps) if (a.bucket === 'sponsor') (byVideo[a.videoId] ??= []).push([k, a]);
    for (const list of Object.values(byVideo).sort((x, y) => (x[0][1].videoId < y[0][1].videoId ? -1 : 1))) { const deals = new Set(list.map(([, a]) => a.dealId)); if (deals.size > 1) return withApps(list.map(([k]) => k)); }
    return null;
  });
  sit('other-brand', 'Sponsor deals', 'A disc from a brand that is not the creator\'s sponsor, while a sponsor deal is active', () => A((a) => a.bucket === 'other-brand'));
  sit('no-deal', 'Sponsor deals', 'A creator with no sponsor deal at all (an open bag)', () => A((a) => a.bucket === 'no-deal'));
  sit('mold-not-covered', 'Sponsor deals', 'The sponsor\'s brand, but a mold the deal does not cover', () => A((a) => a.bucket === 'mold-not-covered'));
  sit('quarter-edge-time-zone', 'Time zones and quarters', 'Published in one quarter in the channel\'s own time zone but another in UTC', () => {
    for (const [vid, v] of Object.entries(O.videos).sort(([a], [b]) => (a < b ? -1 : 1))) if (v.quarter !== quarterOf(utcDate(vid))) { const keys = apps.filter(([, a]) => a.videoId === vid).map(([k]) => k); if (keys.length) return withApps(keys.slice(0, 3)); }
    return null;
  });
  sit('local-day-differs', 'Time zones and quarters', 'Published on a different calendar day in the channel\'s time zone than in UTC', () => {
    for (const [vid, v] of Object.entries(O.videos).sort(([a], [b]) => (a < b ? -1 : 1))) if (v.day !== utcDate(vid) && v.quarter === quarterOf(utcDate(vid))) { const keys = apps.filter(([, a]) => a.videoId === vid).map(([k]) => k); if (keys.length) return withApps(keys.slice(0, 3)); }
    return null;
  });

  // alternate frames, chains, transformations
  sit('chained-frames', 'Chains of frames', 'A card before its release from a brand that is not the sponsor: one frame replaced by the next', () => A((a) => a.pre && a.bucket !== 'sponsor'));
  sit('shown-only', 'Cards on screen', 'A card on screen that the creator never marked as thrown', () => A((a) => a.hasCard && !a.thrown));
  sit('thrown-no-card', 'Cards on screen', 'A disc thrown with no card on screen', () => A((a) => !a.hasCard && a.thrown));
  sit('talked-no-card', 'Cards on screen', 'A disc only talked about, with no card', () => A((a) => !a.hasCard && !a.thrown));
  sit('merged-cards', 'Cards on screen', 'Two overlapping cards for one disc merged into one appearance', () => A((a) => a.cards >= 2));
  sit('overlap-different-discs', 'Cards on screen', 'Cards of two discs of one sponsor overlapping: the shared seconds count once', () => rowCase((r) => r.overlapped && r.state === 'measured' && r.creators.length === 1));
  sit('provisional-mold', 'Bags and shelves', 'A disc whose mold is not in the catalog (a provisional mold)', () => A((a) => !O.discs[a.discId].hasMold));
  sit('resolved-by-name', 'Bags and shelves', 'A disc typed with different spelling that still resolves to the catalog mold', () => A((a) => O.discs[a.discId].resolvedBy === 'normalized'));
  sit('awaiting-views', 'Videos and views', 'A video published but with no views yet: not measurable, not zero', () => A((a) => a.state === 'awaiting-views'));
  sit('no-curve', 'Videos and views', 'A video with views but no retention curve yet', () => A((a) => a.state === 'no-curve'));
  sit('short-attention', 'Videos and views', 'A Short: its attention is added to the disc\'s total and reported apart', () => A((a) => a.format === 'short' && a.attention != null && O.disc[a.discId] && O.disc[a.discId].long != null && O.disc[a.discId].short != null) ?? A((a) => a.format === 'short' && a.attention != null));
  sit('views-growth', 'Videos and views', 'A video whose view count grew across snapshots', () => { const v = of('Video').find((x) => x.t.viewSnapshots.length > 2 && apps.some(([, a]) => a.videoId === x.id && a.attention != null)); return v ? withApps(apps.filter(([, a]) => a.videoId === v.id).map(([k]) => k).slice(0, 2)) : null; });
  sit('retention-dip', 'Retention', 'A retention dip while a card was on screen', () => {
    for (const c of of('RetentionCurve').sort((x, y) => (x.id < y.id ? -1 : 1))) if (c.t.dip) { const hit = apps.find(([, a]) => a.videoId === c.t.videoId && a.start < c.t.dip.to && c.t.dip.from < a.end); if (hit) return withApps([hit[0]]); }
    return null;
  });
  sit('rewatch-bump', 'Retention', 'A rewatch bump in the retention curve during a card', () => {
    for (const c of of('RetentionCurve').sort((x, y) => (x.id < y.id ? -1 : 1))) if (c.t.bump) { const hit = apps.find(([, a]) => a.videoId === c.t.videoId && a.start <= c.t.bump.at && c.t.bump.at < a.end); if (hit) return withApps([hit[0]]); }
    return null;
  });

  // bags and shelves
  sit('disc-leaves-and-returns', 'Bags and shelves', 'A disc that leaves the bag for a stretch and comes back', () => {
    const bags = of('Bag');
    for (const c of of('Creator')) {
      const mine = bags.filter((b) => b.t.creatorId === c.id).sort((x, y) => (x.t.takenAt < y.t.takenAt ? -1 : 1));
      for (const did of of('Disc').filter((d) => d.t.creatorId === c.id).map((d) => d.id)) {
        const inBag = mine.map((b) => b.t.discIds.includes(did));
        const first = inBag.indexOf(true), gap = inBag.indexOf(false, first), back = gap > 0 ? inBag.indexOf(true, gap) : -1;
        if (first >= 0 && gap > first && back > gap) { const vids = mine[gap].t.appliedToVideoIds.concat(mine[back].t.appliedToVideoIds); return { entries: [], videos: vids, subject: [did, mine[first].id, mine[gap].id, mine[back].id], factKind: 'bag-change' }; }
      }
    }
    return null;
  });
  sit('bag-no-card', 'Bags and shelves', 'A disc in the bag that never got a card or a mark in that video', () => {
    for (const b of of('Bag').sort((x, y) => (x.id < y.id ? -1 : 1))) for (const vid of b.t.appliedToVideoIds) for (const did of b.t.discIds) if (!apps.some(([, a]) => a.videoId === vid && a.discId === did)) return { entries: [], subject: [did, vid, b.id], factKind: 'bag-no-card' };
    return null;
  });
  sit('two-discs-one-mold', 'Bags and shelves', 'Two discs of the same mold on one shelf (two plastics or two runs): separate discs, one mold total', () => {
    for (const c of of('Creator')) {
      const discs = of('Disc').filter((d) => d.t.creatorId === c.id), by = {};
      for (const d of discs) (by[O.discs[d.id].moldId] ??= []).push(d.id);
      const hit = Object.values(by).find((l) => l.length > 1 && l.every((d) => Object.keys(O.disc).includes(d)));
      if (hit) return { entries: [], subject: hit, factKind: 'two-plastics' };
    }
    return null;
  });

  // clicks and links
  const cardEdge = (which) => clickCase((c, link, v, cards) => { const ts = c.t.videoTimestamp; if (ts == null || !cards.length) return false; const k = cards[0]; return which === 'last' ? ts === k.t.endSec - 1 : which === 'gone' ? ts === k.t.endSec : which === 'first' ? ts === k.t.startSec : ts === k.t.startSec - 1; });
  sit('click-card-last-second', 'Links and clicks', 'A click at a card\'s last second: credited to the on-screen moment', () => cardEdge('last'));
  sit('click-card-gone', 'Links and clicks', 'A click at the second the card went away: credited to the video, not the moment', () => cardEdge('gone'));
  sit('click-card-first-second', 'Links and clicks', 'A click at a card\'s first second: credited to the moment', () => cardEdge('first'));
  sit('click-before-card', 'Links and clicks', 'A click one second before the card appeared: credited to the video, not the moment', () => cardEdge('before'));
  sit('click-bio-link', 'Links and clicks', 'A click on a channel-bio link: counted for the link, credited to no video', () => clickCase((c, link) => link.t.placement === 'bio'));
  sit('click-predates-publish', 'Links and clicks', 'A click dated one second before the video was published', () => clickCase((c, link, v) => v && Date.parse(c.t.at) < Date.parse(v.t.publishedAt)));
  sit('click-at-publish-instant', 'Links and clicks', 'A click in the very second the video was published: credited', () => clickCase((c, link, v) => v && Date.parse(c.t.at) === Date.parse(v.t.publishedAt)));
  sit('click-disc-not-in-video', 'Links and clicks', 'Clicks on a link whose disc never appeared in its video', () => clickCase((c, link, v) => v && O.clicks[c.id].reason === 'disc-not-in-video'));
  sit('click-video-level', 'Links and clicks', 'A click on a description link: credited to the disc in the video', () => clickCase((c, link, v) => v && link.t.placement === 'description' && O.clicks[c.id].kind === 'video' && c.t.videoTimestamp == null));
  sit('off-brand-link', 'Links and clicks', 'A link whose destination is another brand\'s shop', () => { const l = of('Link').find((x) => x.t.placement !== 'bio' && byId.get(x.t.discId) && !x.t.destination.includes(brandHost(x))); return l ? { entries: [], subject: [l.id, l.t.discId], factKind: 'off-brand-link' } : null; });
  function brandHost(link) { const d = O.discs[link.t.discId], m = d.manufacturerId ? byId.get(d.manufacturerId) : null; return m ? m.t.shopHost : ''; }
  sit('link-placements', 'Links and clicks', 'One video with links in the description, a pinned comment and a YouTube card', () => {
    for (const v of of('Video').sort((x, y) => (x.id < y.id ? -1 : 1))) { const pl = new Set(of('Link').filter((l) => l.t.videoId === v.id).map((l) => l.t.placement)); if (pl.has('description') && pl.has('card')) return { entries: [], subject: [v.id, ...of('Link').filter((l) => l.t.videoId === v.id).map((l) => l.id)], factKind: null, links: true }; }
    return null;
  });

  // across creators
  sit('cross-creator-mold', 'Cross-creator', 'One mold carried by several creators: each sees their own total, the brand sees one', () => {
    const hit = Object.entries(O.mold).sort(([a], [b]) => (a < b ? -1 : 1)).find(([, m]) => Object.keys(m.perCreator).length > 1);
    return hit ? { entries: [{ section: 'mold', key: hit[0] }], subject: [hit[0], ...Object.keys(hit[1].perCreator)], factKind: 'cross-creator' } : null;
  });
  sit('cross-creator-sponsor', 'Cross-creator', 'One sponsor across several creators in one quarter: the Sponsor view adds them up', () => rowCase((r, k) => k.startsWith('sponsor|') && r.creators.length > 1));
  sit('unmeasurable-sponsor-row', 'Cross-creator', 'A brand quarter that cannot be measured yet: null viewer-minutes, never zero', () => rowCase((r) => r.state === 'unmeasurable'));
  sit('clicks-per-thousand', 'Links and clicks', 'Clicks per 1,000 attention-seconds for a disc in a video', () => { const k = Object.keys(O.perThousand).sort()[0]; return k ? { entries: [{ section: 'perThousand', key: k }], subject: [k] } : null; });
  return S;
}

// ---------- departures derived from the frames ----------
const hardProblems = (W2, ids) => {
  const insts = [...ids].map((id) => W2.get(id)).filter(Boolean);
  const out = [...typeProblems(W2, insts)];
  for (const inst of insts) if (FRAMES[inst.frame].role === 'input') out.push(...violationsOf(W2, inst).filter((v) => !v.mismatch).map((v) => `${v.instanceId}#${v.expectationId}`));
  return out;
};
function refsOf(inst) {
  const out = [];
  for (const [name, def] of Object.entries(effectiveTerminals(inst.frame))) if (refFrame(def.type)) { const v = inst.t[name]; for (const to of Array.isArray(v) ? v : v == null ? [] : [v]) out.push(to); }
  return out;
}
export function patchIsValid(base, patches) {
  const instances = applyPatches(base.W.instances, patches);
  const W2 = indexWorld(instances);
  const touched = new Set();
  for (const p of patches) {
    touched.add(p.id);
    for (const r of base.refBy.get(p.id) ?? []) touched.add(r);
    const i2 = W2.get(p.id);
    if (i2) for (const t of refsOf(i2)) touched.add(t);
  }
  const problems = hardProblems(W2, touched);
  return { instances, problems };
}
export function refIndex(W) {
  const m = new Map();
  for (const inst of W.instances) if (FRAMES[inst.frame].role === 'input') for (const to of refsOf(inst)) (m.get(to) ?? m.set(to, []).get(to)).push(inst.id);
  return m;
}

export function deriveCases(instances, seed, base = analyzeWorld(instances, 'season')) {
  base.refBy = base.refBy ?? refIndex(base.W);
  const O = oracle(JSON.parse(JSON.stringify(instances)));
  const cases = [], rejected = [];
  const noteKey = (n) => `${n.instanceId}#${n.expectationId}`;
  const baseNotes = new Set(base.E.transformations.filter((n) => n.onAlternate == null).map(noteKey));

  // observed
  for (const s of observedSituations(instances, O)) {
    const hit = s.find();
    if (!hit) { rejected.push({ slug: s.slug, reason: 'the season world contains no such situation' }); continue; }
    cases.push({ slug: `observed:${s.slug}`, kind: s.slug === 'chained-frames' ? 'chained' : 'observed', theme: s.theme, title: s.title, frameTerminal: null, expectationId: null, patches: [], departures: [], instanceId: null, entries: hit.entries, subjectIds: [...new Set([...hit.subject, ...(hit.videos ?? [])])], factKind: hit.factKind ?? null, videos: hit.videos ?? null, expect: null });
  }

  // departures
  const picked = pickPerSlot(allCandidates(base.W), seed);
  const cache = new Map();
  for (const { slot, ordered } of picked) {
    const enumSlot = slot.includes('|enum|');
    const want = enumSlot ? 2 : 1;
    let got = 0, tries = 0;
    const why = {};
    const bump = (k) => { why[k] = (why[k] ?? 0) + 1; };
    const seen = new Set();
    for (const cand of ordered) {
      if (got >= want || (got && tries >= 40)) break;
      const sig = `${cand.instanceId}|${cand.patches.map((p) => `${p.id}.${p.terminal}`).join(',')}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (enumSlot && got === 1 && cases.some((c) => c.slot === slot && c.instanceId === cand.instanceId)) continue;
      tries++;
      const { instances: inst2, problems } = patchIsValid(base, cand.patches);
      if (problems.length) { bump(`invalid: ${problems[0].replace(/^[^#]*#/, '')}`); continue; }
      const after = analyzeWorld(inst2, 'after');
      if (!after.reports.every((r) => r.status === 'PASS')) { bump('a Calculation guarantee failed'); continue; }
      const eff = effectOf(base, after);
      if (!eff.observable) { bump('no observable effect'); continue; }
      if (cand.kind === 'expectation') {
        const fired = after.E.transformations.some((n) => n.instanceId === cand.instanceId && n.expectationId === cand.expectationId && n.onAlternate == null);
        if (!fired || baseNotes.has(`${cand.instanceId}#${cand.expectationId}`)) { bump('the mismatch rule did not fire'); continue; }
      }
      got++;
      const theme = cand.expect ? THEME_OF_EXPECT[cand.expect.kind] ?? THEME_OF_FRAME[cand.frame] : THEME_OF_FRAME[cand.frame];
      const caseObj = {
        slug: `${slot}@${cand.instanceId}${enumSlot ? `:${cand.label}` : ''}`, slot, kind: cand.kind, theme, title: cand.label[0].toUpperCase() + cand.label.slice(1), where: nodeLabel(base.W, base.E, cand.instanceId),
        frameTerminal: `${cand.frame}.${cand.terminal}`, expectationId: cand.expectationId, patches: cand.patches, departures: describePatches(base.W, cand.patches), instanceId: cand.instanceId,
        entries: [], subjectIds: [...new Set([cand.instanceId, ...cand.patches.map((p) => p.id)])], factKind: null, videos: null, expect: cand.expect,
      };
      Object.defineProperty(caseObj, '_after', { value: after, enumerable: false });
      Object.defineProperty(caseObj, '_effect', { value: eff, enumerable: false });
      cases.push(caseObj);
    }
    if (!got) rejected.push({ slot, reason: `no candidate qualified (${Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} x ${k}`).join('; ')})` });
  }
  void cache;
  const order = (c) => KIND_ORDER.indexOf(c.kind);
  cases.sort((a, b) => order(a) - order(b) || THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  cases.forEach((c, n) => { c.id = `c${String(n + 1).padStart(3, '0')}`; });
  return { cases, rejected, oracleBase: O };
}
