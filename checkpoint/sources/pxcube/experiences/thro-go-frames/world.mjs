// World index and the linking lookups that both the frame expectations and the enrichment use.
// A "world" is a flat list of frame instances { id, frame, caseId, t:{terminal:value}, how:{terminal:'default'|'given'|'wired'|'derived'|'departed'} }.
import { dayNum, monthFirst, monthLast, dayDiff } from './util.mjs';

export function indexWorld(instances) {
  const byId = new Map();
  const byFrame = {};
  for (const inst of instances) {
    byId.set(inst.id, inst);
    (byFrame[inst.frame] ??= []).push(inst);
  }
  return {
    instances,
    get: (id) => byId.get(id) ?? null,
    all: (frame) => byFrame[frame] ?? [],
    has: (id) => byId.has(id),
  };
}

export const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Disc -> Mold: by id, else by normalised typed name, else null (the Disc then needs a ProvisionalMold).
export function resolveMold(W, disc) {
  if (disc.t.moldId && W.get(disc.t.moldId)) return { mold: W.get(disc.t.moldId), how: 'id' };
  const want = normName(disc.t.moldName);
  const hit = want && W.all('Mold').find((m) => normName(m.t.name) === want);
  return hit ? { mold: hit, how: 'normalized' } : null;
}

// Disc + Mold -> Release: the release of the same run if the Disc names a run, else the mold's original (run-less) release.
export function releaseOf(W, disc, mold) {
  if (!mold) return null;
  const rels = W.all('Release').filter((r) => r.t.moldId === mold.id).sort((a, b) => a.t.date.localeCompare(b.t.date));
  if (disc.t.runLabel) {
    const same = rels.find((r) => r.t.runLabel === disc.t.runLabel);
    if (same) return same;
  }
  return rels.find((r) => r.t.runLabel === null) ?? rels[0] ?? null;
}
export const releaseInterval = (rel) => (rel.t.datePrecision === 'month'
  ? [monthFirst(rel.t.date), monthLast(rel.t.date)]
  : [rel.t.date, rel.t.date]);

export function activeDeals(W, creatorId, iso) {
  return W.all('SponsorDeal').filter((d) => d.t.creatorId === creatorId && d.t.start <= iso && iso <= d.t.end);
}
// Which sponsor bucket does a (creator, publish day, mold) fall in?
export function sponsorBucket(W, creatorId, iso, mold) {
  const deals = activeDeals(W, creatorId, iso);
  if (!deals.length) return { bucket: 'no-deal', dealId: null };
  if (!mold || !mold.t.manufacturerId) return { bucket: 'unknown-brand', dealId: null };
  const same = deals.find((d) => d.t.manufacturerId === mold.t.manufacturerId);
  if (!same) return { bucket: 'other-brand', dealId: null };
  const covers = same.t.moldsCovered === 'all' || same.t.moldsCovered.includes(mold.id);
  return covers ? { bucket: 'sponsor', dealId: same.id } : { bucket: 'mold-not-covered', dealId: same.id };
}

export const latestViews = (video) => {
  const snaps = [...video.t.viewSnapshots].sort((a, b) => a.at.localeCompare(b.at));
  return snaps.length ? snaps[snaps.length - 1].views : 0;
};
export const creatorOfVideo = (W, video) => W.get(W.get(video.t.channelId)?.t.creatorId) ?? null;
export const curveOf = (W, videoId) => W.all('RetentionCurve').find((c) => c.t.videoId === videoId) ?? null;
export const bagOf = (W, videoId) => W.all('Bag').find((b) => b.t.appliedToVideoIds.includes(videoId)) ?? null;
export const placementsOf = (W, videoId, discId) => W.all('CardPlacement').filter((p) => p.t.videoId === videoId && (discId == null || p.t.discId === discId));
export const givenAppearancesOf = (W, videoId, discId) => W.all('Appearance').filter((a) => a.t.videoId === videoId && (discId == null || a.t.discId === discId));
export const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1 || (a0 === a1 && a0 >= b0 && a0 <= b1);
export { dayNum, dayDiff };
