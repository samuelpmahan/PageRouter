// Enrichment: link a flat fragment of frame instances into a heavily cross-linked graph.
//   appearance -> disc -> mold -> manufacturer -> release; placement <-> appearance; link -> disc; click -> link -> video -> placement (via timestamp);
//   video -> bag snapshot -> sponsor deal active at publish day. Every expectation violation selects an alternate frame or a transformation (recorded).
import { FRAMES, makeInstance, checkExpectations } from './frames.mjs';
import { indexWorld, resolveMold, releaseOf, releaseInterval, sponsorBucket, activeDeals, latestViews, curveOf, bagOf, creatorOfVideo, placementsOf, givenAppearancesOf } from './world.mjs';
import { dayDiff } from './util.mjs';

const overlapsIv = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

export function releaseState(W, disc, video) {
  const r = resolveMold(W, disc), rel = r && releaseOf(W, disc, r.mold);
  if (!rel) return null;
  const [r0, r1] = releaseInterval(rel), p = video.t.publishedAt, month = rel.t.datePrecision === 'month';
  if (month ? p > r1 : p >= r0) return null;
  return { releaseId: rel.id, certainty: p < r0 ? 'certain' : 'possible', daysBeforeMin: Math.max(0, dayDiff(r0, p)), daysBeforeMax: Math.max(0, dayDiff(r1, p)) };
}

export function enrichFragment(instances, caseId) {
  const W = indexWorld(instances);
  const violations = checkExpectations(W);
  const transformations = [], alternates = [], edges = [], issues = [];
  let altN = 0;
  const alt = (frame, overrides) => { const i = makeInstance(frame, overrides, { id: `${caseId}.alt.${frame}${++altN}`, caseId }); alternates.push(i); return i; };
  const note = (expectationId, instanceId, action, detail) => transformations.push({ expectationId, instanceId, action, detail });
  const edge = (from, rel, to) => edges.push({ from, rel, to });

  // creators / channels / shelves
  for (const ch of W.all('Channel')) {
    edge(ch.t.creatorId, 'owns', ch.id);
    if (!ch.t.studioConnected) { alt('ClicksOnlyChannel', { channelId: ch.id }); note('retentionAvailable', ch.id, 'frame:ClicksOnlyChannel', 'YouTube Studio not connected: clicks counted, no attention-seconds'); }
  }

  // discs -> molds -> manufacturers -> releases
  const discs = {};
  for (const rel of W.all('Release')) if (rel.t.datePrecision === 'month') note('dayPrecision', rel.id, 'transform:interval-offsets', `release known to ${rel.t.date} only: offsets reported as ranges`);
  for (const disc of W.all('Disc')) {
    const res = resolveMold(W, disc);
    const mold = res?.mold ?? null;
    const how = res ? res.how : 'provisional';
    let provisionalId = null;
    if (how === 'normalized') note('moldResolved', disc.id, 'resolve:name-or-provisional', `typed "${disc.t.moldName}" resolved to catalog mold "${mold.t.name}" by normalised name`);
    if (how === 'provisional') {
      const p = alt('ProvisionalMold', { discId: disc.id, typedName: disc.t.moldName });
      provisionalId = p.id;
      note('moldResolved', disc.id, 'frame:ProvisionalMold', `"${disc.t.moldName}" is not in the catalog: provisional mold created, brand unknown`);
    }
    const manufacturer = mold ? W.get(mold.t.manufacturerId) : null;
    const rel = releaseOf(W, disc, mold);
    discs[disc.id] = {
      id: disc.id, creatorId: disc.t.creatorId, moldId: mold?.id ?? null, provisionalMoldId: provisionalId, moldName: mold ? mold.t.name : disc.t.moldName,
      resolvedBy: how, manufacturerId: manufacturer?.id ?? null, brand: manufacturer ? manufacturer.t.name : null, releaseId: rel?.id ?? null,
      plastic: disc.t.plastic, runLabel: disc.t.runLabel,
    };
    edge(disc.t.creatorId, 'owns', disc.id);
    edge(disc.id, 'onShelf', disc.t.shelfId);
    edge(disc.id, how === 'provisional' ? 'guessedMold' : 'isMold', mold ? mold.id : provisionalId);
    if (mold && manufacturer) edge(mold.id, 'madeBy', manufacturer.id);
    if (rel) edge(mold ? mold.id : disc.id, 'releasedAs', rel.id);
  }
  for (const d of W.all('SponsorDeal')) { edge(d.t.creatorId, 'sponsoredBy', d.id); edge(d.id, 'with', d.t.manufacturerId); }

  // videos
  const videos = {};
  for (const video of W.all('Video')) {
    const channel = W.get(video.t.channelId), creator = creatorOfVideo(W, video), bag = bagOf(W, video.id), curve = curveOf(W, video.id);
    const views = latestViews(video);
    if (views === 0) { alt('AwaitingViewsVideo', { videoId: video.id }); note('hasViews', video.id, 'frame:AwaitingViewsVideo', 'no views yet: attention not measurable, not zero'); }
    const retentionState = !channel.t.studioConnected ? 'not-connected' : views === 0 ? 'awaiting-views' : curve ? 'ok' : 'no-curve';
    const deals = activeDeals(W, creator.id, video.t.publishedAt);
    videos[video.id] = {
      id: video.id, creatorId: creator.id, title: video.t.title, publishedAt: video.t.publishedAt, format: video.t.kind === 'short' ? 'short' : 'long',
      orientation: video.t.orientation, duration: video.t.durationSeconds, views, viewSnapshots: video.t.viewSnapshots, retentionState, curveId: curve?.id ?? null,
      bagId: bag?.id ?? null, dealIds: deals.map((d) => d.id),
    };
    edge(channel.id, 'published', video.id);
    if (bag) edge(bag.id, 'appliedTo', video.id);
    for (const d of deals) edge(video.id, 'underDeal', d.id);
    if (curve) edge(curve.id, 'retentionOf', video.id);
  }

  // placements + marked appearances -> merged appearances (the atom)
  const appearances = [];
  const byPlacement = {}, byGiven = {};
  for (const video of W.all('Video')) {
    const dur = video.t.durationSeconds, creator = creatorOfVideo(W, video), bag = bagOf(W, video.id);
    const items = [];
    for (const p of placementsOf(W, video.id)) {
      let { startSec: a, endSec: b } = p.t;
      const d = W.get(p.t.discId);
      // alternate-frame / transformation selection that depends only on the placement (parity with the expectations)
      const bucket = sponsorBucket(W, creator.id, video.t.publishedAt, resolveMold(W, d)?.mold ?? null);
      if (bucket.bucket !== 'sponsor') note('underActiveSponsor', p.id, 'frame:OtherBrandAppearance', `bucket ${bucket.bucket}`);
      const rs = releaseState(W, d, video);
      if (rs) note('releasedByPublish', p.id, 'frame:PreReleaseAppearance', `${rs.certainty}, ${rs.daysBeforeMin}..${rs.daysBeforeMax} days before release`);
      const confirmed = givenAppearancesOf(W, video.id, d.id).some((g) => g.t.mode === 'thrown' && overlapsIv(g.t.startSec, g.t.endSec, a, b));
      if (!confirmed) note('confirmedThrown', p.id, 'frame:ShownOnlyAppearance', 'card on screen, disc never marked thrown');
      if (b < a) { note('notInverted', p.id, 'transform:drop-inverted', `end ${b} before start ${a}: placement dropped`); issues.push({ type: 'inverted-placement', instanceId: p.id }); continue; }
      if (b === a) { note('hasLength', p.id, 'transform:drop-zero-length', 'zero-length placement dropped'); issues.push({ type: 'zero-length-placement', instanceId: p.id }); continue; }
      if (b > dur) { note('withinVideo', p.id, 'transform:clamp-to-video-end', `end ${b} clamped to video end ${dur}`); issues.push({ type: 'clamped-placement', instanceId: p.id, from: b, to: dur }); b = dur; }
      if (a >= b) { issues.push({ type: 'beyond-end-placement', instanceId: p.id }); continue; }
      items.push({ discId: p.t.discId, a, b, mode: 'shown', evidence: 'card', placementId: p.id });
    }
    for (const g of givenAppearancesOf(W, video.id)) {
      const a = g.t.startSec, b = Math.min(g.t.endSec, dur);
      if (!placementsOf(W, video.id, g.t.discId).some((p) => overlapsIv(p.t.startSec, p.t.endSec, g.t.startSec, g.t.endSec))) note('hasCard', g.id, 'frame:CardlessAppearance', `${g.t.mode} with no card on screen`);
      if (b <= a) continue;
      items.push({ discId: g.t.discId, a, b, mode: g.t.mode, evidence: g.t.evidence, givenId: g.id });
    }
    const byDisc = {};
    for (const it of items) (byDisc[it.discId] ??= []).push(it);
    for (const discId of Object.keys(byDisc).sort()) {
      const list = byDisc[discId].sort((x, y) => x.a - y.a || x.b - y.b);
      const groups = [];
      for (const it of list) {
        const g = groups[groups.length - 1];
        if (g && it.a <= g.b) { g.b = Math.max(g.b, it.b); g.items.push(it); } else groups.push({ a: it.a, b: it.b, items: [it] });
      }
      const d = W.get(discId), mold = resolveMold(W, d)?.mold ?? null;
      const bucket = sponsorBucket(W, creator.id, video.t.publishedAt, mold);
      const rs = releaseState(W, d, video);
      groups.forEach((g, n) => {
        const id = `${discId}@${video.id}#${n + 1}`;
        const a = {
          id, discId, videoId: video.id, start: g.a, end: g.b, seconds: g.b - g.a,
          modes: [...new Set(g.items.map((i) => i.mode))].sort(), evidence: [...new Set(g.items.map((i) => i.evidence))].sort(),
          placementIds: g.items.filter((i) => i.placementId).map((i) => i.placementId), givenIds: g.items.filter((i) => i.givenId).map((i) => i.givenId),
          flags: [], bucket: bucket.bucket, dealId: bucket.dealId, releaseState: rs, inBag: bag ? bag.t.discIds.includes(discId) : null,
        };
        a.hasCard = a.placementIds.length > 0;
        if (a.placementIds.length > 1) a.flags.push('merged-overlapping-cards');
        if (!a.hasCard) a.flags.push('no-card');
        if (a.inBag === false) a.flags.push('disc-not-in-bag-snapshot');
        appearances.push(a);
        edge(id, 'of', discId); edge(id, 'in', video.id);
        for (const pid of a.placementIds) { edge(id, 'shownBy', pid); byPlacement[pid] = id; }
        for (const gid of a.givenIds) { edge(id, 'markedBy', gid); byGiven[gid] = id; }
        if (rs) { const pr = alt('PreReleaseAppearance', { appearanceId: id, releaseId: rs.releaseId, certainty: rs.certainty, daysBeforeMin: rs.daysBeforeMin, daysBeforeMax: rs.daysBeforeMax }); edge(id, 'selects', pr.id); }
        if (bucket.bucket !== 'sponsor') { const ob = alt('OtherBrandAppearance', { appearanceId: id, reason: bucket.bucket, manufacturerId: discs[discId].manufacturerId }); edge(id, 'selects', ob.id); }
        if (!a.givenIds.length || !a.modes.includes('thrown')) { const so = a.hasCard ? alt('ShownOnlyAppearance', { appearanceId: id }) : null; if (so) edge(id, 'selects', so.id); }
        if (!a.hasCard) { const cl = alt('CardlessAppearance', { appearanceId: id, modes: a.modes }); edge(id, 'selects', cl.id); }
        if (bucket.dealId) edge(id, 'countsFor', bucket.dealId);
      });
    }
  }
  appearances.sort((x, y) => x.videoId.localeCompare(y.videoId) || x.discId.localeCompare(y.discId) || x.start - y.start);
  for (const v of Object.values(videos)) v.appearanceIds = appearances.filter((a) => a.videoId === v.id).map((a) => a.id);

  // links and clicks
  const links = {};
  for (const l of W.all('Link')) { links[l.id] = { id: l.id, code: l.t.code, discId: l.t.discId, videoId: l.t.videoId, placement: l.t.placement, clickIds: [] }; edge(l.id, 'for', l.t.discId); if (l.t.videoId) edge(l.id, 'placedIn', l.t.videoId); }
  const clicks = [];
  for (const c of W.all('Click')) {
    const link = W.get(c.t.linkId), video = link.t.videoId ? W.get(link.t.videoId) : null, ts = c.t.videoTimestamp;
    const apps = video ? appearances.filter((a) => a.videoId === video.id && a.discId === link.t.discId) : [];
    let reason = null;
    if (!video) { reason = 'no-video'; note('linkIsVideoScoped', c.id, 'frame:UnattributedClick', 'link is not tied to a video (bio link)'); }
    if (video && c.t.at.slice(0, 10) < video.t.publishedAt) { reason ??= 'predates-publish'; note('notBeforePublish', c.id, 'frame:UnattributedClick', `click ${c.t.at.slice(0, 10)} is before publish ${video.t.publishedAt}`); }
    if (video && placementsOf(W, video.id, link.t.discId).length + givenAppearancesOf(W, video.id, link.t.discId).length === 0) { reason ??= 'disc-not-in-video'; note('discAppearedInVideo', c.id, 'frame:UnattributedClick', 'disc never appeared in the link\'s video'); }
    if (video && !reason && apps.length === 0) reason = 'disc-not-in-video';
    if (video && ts != null && !placementsOf(W, video.id, link.t.discId).some((p) => p.t.startSec <= ts && ts < p.t.endSec)) note('insidePlacement', c.id, 'transform:attribute-to-video', `timestamp ${ts}s is outside every card placement of the disc`);
    let attribution;
    if (reason) { const u = alt('UnattributedClick', { clickId: c.id, reason }); attribution = { kind: 'unattributed', reason, appearanceId: null, appearanceIds: [], alternateId: u.id }; edge(c.id, 'selects', u.id); }
    else {
      const moment = ts == null ? null : apps.find((a) => a.start <= ts && ts < a.end && a.hasCard && placementsOf(W, video.id, link.t.discId).some((p) => p.t.startSec <= ts && ts < p.t.endSec));
      attribution = moment
        ? { kind: 'moment', reason: null, appearanceId: moment.id, appearanceIds: [moment.id], timestamp: ts }
        : { kind: 'video', reason: null, appearanceId: apps[0].id, appearanceIds: apps.map((a) => a.id) };
      for (const id of attribution.appearanceIds) edge(c.id, moment ? 'creditedToMoment' : 'creditedTo', id);
    }
    edge(c.id, 'via', link.id);
    links[link.id].clickIds.push(c.id);
    clicks.push({ id: c.id, linkId: link.id, discId: link.t.discId, videoId: link.t.videoId, at: c.t.at, refererHost: c.t.refererHost, country: c.t.country, videoTimestamp: ts, attribution });
  }

  // creators with their shelves
  const creators = W.all('Creator').map((c) => c.id);
  // violation <-> transformation parity: every violated expectation must have selected something
  const noted = new Set(transformations.map((t) => `${t.instanceId}#${t.expectationId}`));
  const unhandled = violations.filter((v) => !noted.has(`${v.instanceId}#${v.expectationId}`)).map((v) => `${v.instanceId}#${v.expectationId}`);
  const spurious = [...noted].filter((k) => !violations.some((v) => `${v.instanceId}#${v.expectationId}` === k));
  const known = new Set(Object.keys(FRAMES));
  return { caseId, creators, discs, videos, appearances, links, clicks, edges, transformations, alternates, issues, violations, unhandled, spurious, alternateFramesKnown: alternates.every((a) => known.has(a.frame)) };
}
