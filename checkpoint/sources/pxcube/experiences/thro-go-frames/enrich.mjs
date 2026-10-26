// Enrichment: link the whole shared world into one cross-linked model.
//   appearance -> disc -> mold -> manufacturer -> release; card/mark <-> appearance; link -> disc; click -> link -> video -> card (via timestamp);
//   video -> bag -> sponsor deal active on its local publish day.
// Which special handling applies is NOT decided here: minsky.selectAlternates evaluates the frames' own expectations and returns the alternate-frame
// chains and the transformations; this module only reads them (a PreReleaseAppearance in a chain means "pre-release", a clamp transformation means "clamp").
import { FRAMES } from './frames.mjs';
import { selectAlternates } from './minsky.mjs';
import { indexWorld, resolveMold, releaseOf, sponsorBucket, activeDeals, latestViews, curveOf, bagOf, creatorOfVideo, placementsOf, givenAppearancesOf, publishDay } from './world.mjs';
import { quarterOf, dayDiff } from './util.mjs';

const hasIntervalAt = (list, s) => list.some((p) => p.t.startSec <= s && s < p.t.endSec);

export function enrichWorld(instances) {
  const W = indexWorld(instances);
  const sel = selectAlternates(W);
  const altById = new Map(sel.alternates.map((a) => [a.id, a]));
  const chainOf = (id) => (sel.chains[id] ?? []).map((x) => altById.get(x));
  const altOf = (id, frame) => chainOf(id).find((a) => a.frame === frame) ?? null;
  const tfOf = (id, key) => (sel.transforms[id] ?? []).find((x) => x[key] !== undefined) ?? null;
  const edges = [], issues = [];
  const edge = (from, rel, to) => edges.push({ from, rel, to });

  // creators, channels, shelves, deals
  for (const ch of W.all('Channel')) edge(ch.t.creatorId, 'owns', ch.id);
  for (const sh of W.all('Shelf')) edge(sh.t.creatorId, 'owns', sh.id);
  for (const d of W.all('SponsorDeal')) { edge(d.t.creatorId, 'sponsoredBy', d.id); edge(d.id, 'with', d.t.manufacturerId); }
  for (const m of W.all('Mold')) edge(m.id, 'madeBy', m.t.manufacturerId);

  // discs -> molds -> manufacturers -> releases
  const discs = {};
  for (const disc of W.all('Disc')) {
    const res = resolveMold(W, disc), prov = altOf(disc.id, 'ProvisionalMoldDisc'), byName = tfOf(disc.id, 'resolvedMoldId');
    const mold = res?.mold ?? null;
    const how = prov ? 'provisional' : byName ? 'normalized' : 'id';
    const manufacturer = mold ? W.get(mold.t.manufacturerId) : null;
    const rel = releaseOf(W, disc, mold);
    discs[disc.id] = {
      id: disc.id, creatorId: disc.t.creatorId, shelfId: disc.t.shelfId, moldId: mold?.id ?? null, provisionalMoldId: prov?.id ?? null, moldName: mold ? mold.t.name : disc.t.moldName,
      typedName: disc.t.moldName, resolvedBy: how, manufacturerId: manufacturer?.id ?? null, brand: manufacturer ? manufacturer.t.name : null, releaseId: rel?.id ?? null,
      plastic: disc.t.plastic, runLabel: disc.t.runLabel,
    };
    edge(disc.t.creatorId, 'owns', disc.id);
    edge(disc.id, 'onShelf', disc.t.shelfId);
    edge(disc.id, how === 'provisional' ? 'guessedMold' : 'isMold', mold ? mold.id : prov.id);
    if (rel) edge(disc.id, 'releasedAs', rel.id);
  }

  // videos
  const videos = {};
  for (const video of W.all('Video')) {
    const channel = W.get(video.t.channelId), creator = creatorOfVideo(W, video), bag = bagOf(W, video.id), curve = curveOf(W, video.id);
    const views = latestViews(video), day = publishDay(W, video);
    const retentionState = altOf(channel.id, 'ClicksOnlyChannel') ? 'not-connected' : altOf(video.id, 'AwaitingViewsVideo') ? 'awaiting-views' : curve ? 'ok' : 'no-curve';
    const deals = activeDeals(W, creator.id, day);
    videos[video.id] = {
      id: video.id, creatorId: creator.id, channelId: channel.id, title: video.t.title, publishedAt: video.t.publishedAt, publishDay: day, quarter: quarterOf(day),
      format: video.t.kind, duration: video.t.durationSeconds, views, viewSnapshots: video.t.viewSnapshots, retentionState, curveId: curve?.id ?? null, bagId: bag?.id ?? null, dealIds: deals.map((d) => d.id),
    };
    edge(channel.id, 'published', video.id);
    if (bag) edge(bag.id, 'appliedTo', video.id);
    for (const d of deals) edge(video.id, 'underDeal', d.id);
    if (curve) edge(curve.id, 'retentionOf', video.id);
  }

  // cards + marks -> merged appearances (the atom)
  const appearances = [];
  for (const video of W.all('Video')) {
    const dur = video.t.durationSeconds, creator = creatorOfVideo(W, video), bag = bagOf(W, video.id);
    const items = [];
    for (const p of [...placementsOf(W, video.id), ...givenAppearancesOf(W, video.id)]) {
      const card = p.frame === 'CardPlacement';
      let a = p.t.startSec, b = p.t.endSec;
      const drop = tfOf(p.id, 'drop');
      if (drop) { issues.push({ type: `${drop.drop}-${card ? 'placement' : 'mark'}`, instanceId: p.id }); continue; }
      const clamp = tfOf(p.id, 'clampEndTo');
      if (clamp) { issues.push({ type: `clamped-${card ? 'placement' : 'mark'}`, instanceId: p.id, from: b, to: clamp.clampEndTo }); b = clamp.clampEndTo; }
      items.push({ discId: p.t.discId, a, b, mode: card ? 'shown' : p.t.mode, evidence: card ? 'card' : p.t.evidence, placementId: card ? p.id : null, givenId: card ? null : p.id, rootId: p.id });
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
      const disc = W.get(discId), mold = resolveMold(W, disc)?.mold ?? null;
      const lookup = sponsorBucket(W, creator.id, publishDay(W, video), mold);
      groups.forEach((g, n) => {
        const id = `${discId}@${video.id}#${n + 1}`;
        const chains = g.items.map((it) => chainOf(it.rootId));
        const find = (frame) => chains.map((c) => c.find((x) => x.frame === frame)).find(Boolean) ?? null;
        const other = find('OtherBrandAppearance'), pre = find('PreReleaseAppearance');
        const a = {
          id, discId, videoId: video.id, start: g.a, end: g.b, seconds: g.b - g.a,
          modes: [...new Set(g.items.map((i) => i.mode))].sort(), evidence: [...new Set(g.items.map((i) => i.evidence))].sort(),
          placementIds: g.items.filter((i) => i.placementId).map((i) => i.placementId), givenIds: g.items.filter((i) => i.givenId).map((i) => i.givenId),
          flags: [], bucket: other ? other.t.reason : 'sponsor', dealId: other ? null : lookup.dealId,
          releaseState: pre ? { releaseId: pre.t.releaseId, certainty: pre.t.certainty, daysBeforeMin: pre.t.daysBeforeMin, daysBeforeMax: pre.t.daysBeforeMax } : null,
          inBag: bag ? bag.t.discIds.includes(discId) : null,
          altIds: [...new Set(chains.flat().map((x) => x.id))].sort(),
        };
        a.hasCard = a.placementIds.length > 0;
        a.shownOnly = a.hasCard && !a.modes.includes('thrown');
        a.chain = [...new Set(chains.flat().map((x) => x.frame))];
        if (a.placementIds.length > 1) a.flags.push('merged-overlapping-cards');
        if (!a.hasCard) a.flags.push('no-card');
        if (a.inBag === false) a.flags.push('disc-not-in-bag-snapshot');
        appearances.push(a);
        edge(id, 'of', discId); edge(id, 'in', video.id);
        for (const pid of a.placementIds) edge(id, 'shownBy', pid);
        for (const gid of a.givenIds) edge(id, 'markedBy', gid);
        for (const altId of a.altIds) edge(id, 'selects', altId);
        if (a.dealId) edge(id, 'countsFor', a.dealId);
      });
    }
  }
  appearances.sort((x, y) => x.videoId.localeCompare(y.videoId) || x.discId.localeCompare(y.discId) || x.start - y.start);
  for (const v of Object.values(videos)) v.appearanceIds = appearances.filter((a) => a.videoId === v.id).map((a) => a.id);
  const appsByDiscVideo = {};
  for (const a of appearances) (appsByDiscVideo[`${a.discId}@${a.videoId}`] ??= []).push(a);

  // links and clicks
  const links = {};
  for (const l of W.all('Link')) {
    const off = altOf(l.id, 'OffBrandLink');
    links[l.id] = { id: l.id, code: l.t.code, discId: l.t.discId, creatorId: l.t.creatorId, videoId: l.t.videoId, placement: l.t.placement, destination: l.t.destination, offBrand: off ? { expectedHost: off.t.expectedHost, actualHost: off.t.actualHost } : null, clickIds: [] };
    edge(l.id, 'for', l.t.discId);
    if (l.t.videoId) edge(l.id, 'placedIn', l.t.videoId);
  }
  const clicks = [];
  for (const c of W.all('Click')) {
    const link = W.get(c.t.linkId), video = link.t.videoId ? W.get(link.t.videoId) : null, ts = c.t.videoTimestamp;
    const apps = video ? appsByDiscVideo[`${link.t.discId}@${video.id}`] ?? [] : [];
    const un = altOf(c.id, 'UnattributedClick');
    let attribution;
    if (un || (video && apps.length === 0)) {
      attribution = { kind: 'unattributed', reason: un ? un.t.reason : 'disc-not-in-video', appearanceId: null, appearanceIds: [], alternateId: un?.id ?? null };
      if (un) edge(c.id, 'selects', un.id);
    } else {
      const moment = ts != null && !tfOf(c.id, 'credit') ? apps.find((a) => a.start <= ts && ts < a.end && a.hasCard && hasIntervalAt(placementsOf(W, video.id, link.t.discId), ts)) : null;
      attribution = moment
        ? { kind: 'moment', reason: null, appearanceId: moment.id, appearanceIds: [moment.id], timestamp: ts }
        : { kind: 'video', reason: null, appearanceId: null, appearanceIds: apps.map((a) => a.id), discVideo: `${link.t.discId}@${video.id}` };
      for (const id of attribution.appearanceIds) edge(c.id, moment ? 'creditedToMoment' : 'creditedTo', id);
    }
    edge(c.id, 'via', link.id);
    links[link.id].clickIds.push(c.id);
    clicks.push({ id: c.id, linkId: link.id, discId: link.t.discId, videoId: link.t.videoId, at: c.t.at, refererHost: c.t.refererHost, country: c.t.country, videoTimestamp: ts, attribution });
  }
  for (const a of sel.alternates) edge(a.parent, 'becomes', a.id);

  const known = new Set(Object.keys(FRAMES));
  return {
    creators: W.all('Creator').map((c) => c.id), discs, videos, appearances, links, clicks, edges, issues,
    transformations: sel.notes, alternates: sel.alternates, chains: sel.chains, transforms: sel.transforms, violations: sel.violations,
    alternateFramesKnown: sel.alternates.every((a) => known.has(a.frame)),
  };
}
export { indexWorld, dayDiff };
