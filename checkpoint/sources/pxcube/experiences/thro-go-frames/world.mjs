// World index and the linking lookups that the frame expectations, the enrichment and the Case generator all use.
// A "world" is a flat list of frame instances { id, frame, t:{terminal:value}, how:{terminal:'default'|'given'|'wired'|'derived'|'departed'} }.
// One world is shared by every creator, so every lookup here is by id, never by display name.
import { dayNum, monthFirst, monthLast, dayDiff, localDay } from './util.mjs';

export function indexWorld(instances) {
  const byId = new Map();
  const byFrame = {};
  const lookups = new Map();
  for (const inst of instances) {
    byId.set(inst.id, inst);
    (byFrame[inst.frame] ??= []).push(inst);
  }
  const W = {
    instances,
    get: (id) => byId.get(id) ?? null,
    all: (frame) => byFrame[frame] ?? [],
    has: (id) => byId.has(id),
    // W.where('CardPlacement', 'videoId', id): the instances of a frame whose terminal equals (or, for lists, contains) a value, via a cached map.
    where(frame, terminal, value) {
      const key = `${frame}.${terminal}`;
      let m = lookups.get(key);
      if (!m) {
        m = new Map();
        for (const inst of byFrame[frame] ?? []) {
          const v = inst.t[terminal];
          for (const one of Array.isArray(v) ? v : [v]) if (one != null) (m.get(one) ?? m.set(one, []).get(one)).push(inst);
        }
        lookups.set(key, m);
      }
      return m.get(value) ?? [];
    },
  };
  return W;
}

export const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Disc -> Mold: by id, else by normalised typed name, else null (the Disc then needs a ProvisionalMoldDisc).
export function resolveMold(W, disc) {
  if (disc.t.moldId && W.get(disc.t.moldId)) return { mold: W.get(disc.t.moldId), how: 'id' };
  const want = normName(disc.t.moldName);
  const hit = want && W.all('Mold').find((m) => normName(m.t.name) === want);
  return hit ? { mold: hit, how: 'normalized' } : null;
}

// Disc + Mold -> Release: the release of the same run if the Disc names a run, else the mold's original (run-less) release.
export function releaseOf(W, disc, mold) {
  if (!mold) return null;
  const rels = W.where('Release', 'moldId', mold.id).slice().sort((a, b) => a.t.date.localeCompare(b.t.date) || a.id.localeCompare(b.id));
  if (disc.t.runLabel) {
    const same = rels.find((r) => r.t.runLabel === disc.t.runLabel);
    if (same) return same;
  }
  return rels.find((r) => r.t.runLabel === null) ?? rels[0] ?? null;
}
export const releaseInterval = (rel) => (rel.t.datePrecision === 'month'
  ? [monthFirst(rel.t.date), monthLast(rel.t.date)]
  : [rel.t.date, rel.t.date]);

export const channelOfVideo = (W, video) => W.get(video.t.channelId);
export const creatorOfVideo = (W, video) => W.get(W.get(video.t.channelId)?.t.creatorId) ?? null;
// The day a video counts for: its publish instant in the channel's own UTC offset. Deals, releases and quarters all use this day.
export const publishDay = (W, video) => localDay(video.t.publishedAt, W.get(video.t.channelId)?.t.utcOffsetHours ?? 0);

export function activeDeals(W, creatorId, day) {
  return W.where('SponsorDeal', 'creatorId', creatorId).filter((d) => d.t.start <= day && day <= d.t.end);
}
// Which sponsor bucket does a (creator, publish day, mold) fall in?
export function sponsorBucket(W, creatorId, day, mold) {
  const deals = activeDeals(W, creatorId, day);
  if (!deals.length) return { bucket: 'no-deal', dealId: null };
  if (!mold || !mold.t.manufacturerId) return { bucket: 'unknown-brand', dealId: null };
  const same = deals.filter((d) => d.t.manufacturerId === mold.t.manufacturerId);
  if (!same.length) return { bucket: 'other-brand', dealId: null };
  const covering = same.find((d) => d.t.moldsCovered === 'all' || d.t.moldsCovered.includes(mold.id));
  return covering ? { bucket: 'sponsor', dealId: covering.id } : { bucket: 'mold-not-covered', dealId: same[0].id };
}

// Is a video before (or possibly before) the release of the disc's mold? null when it is not.
export function releaseState(W, disc, video) {
  const r = resolveMold(W, disc), rel = r && releaseOf(W, disc, r.mold);
  if (!rel) return null;
  const [r0, r1] = releaseInterval(rel), p = publishDay(W, video), month = rel.t.datePrecision === 'month';
  if (month ? p > r1 : p >= r0) return null;
  return { releaseId: rel.id, certainty: p < r0 ? 'certain' : 'possible', daysBeforeMin: Math.max(0, dayDiff(r0, p)), daysBeforeMax: Math.max(0, dayDiff(r1, p)) };
}

export const latestViews = (video) => {
  const snaps = [...video.t.viewSnapshots].sort((a, b) => a.at.localeCompare(b.at));
  return snaps.length ? snaps[snaps.length - 1].views : 0;
};
export const curveOf = (W, videoId) => W.where('RetentionCurve', 'videoId', videoId)[0] ?? null;
export const bagOf = (W, videoId) => W.where('Bag', 'appliedToVideoIds', videoId)[0] ?? null;
export const placementsOf = (W, videoId, discId) => {
  const list = W.where('CardPlacement', 'videoId', videoId);
  return discId == null ? list : list.filter((p) => p.t.discId === discId);
};
export const givenAppearancesOf = (W, videoId, discId) => {
  const list = W.where('Appearance', 'videoId', videoId);
  return discId == null ? list : list.filter((a) => a.t.discId === discId);
};
export const linksOfVideo = (W, videoId) => W.where('Link', 'videoId', videoId);
export const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
export { dayNum, dayDiff };
