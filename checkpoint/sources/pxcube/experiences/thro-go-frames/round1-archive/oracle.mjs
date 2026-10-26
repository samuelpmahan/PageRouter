// Independent oracle: expected values computed from the RAW frame instances with plain per-second loops (no merging, no capabilities),
// so a Case's expectation does not share code with the enrichment it is checking.
import { latestViews, curveOf, placementsOf, givenAppearancesOf } from './world.mjs';

export function secondsOn(W, videoId, discIds) {
  const video = W.get(videoId), dur = video.t.durationSeconds, on = new Array(dur).fill(false);
  const mark = (a, b) => { for (let s = Math.max(0, a); s < Math.min(b, dur); s++) on[s] = true; };
  for (const d of discIds) {
    for (const p of placementsOf(W, videoId, d)) if (p.t.endSec > p.t.startSec) mark(p.t.startSec, p.t.endSec);
    for (const g of givenAppearancesOf(W, videoId, d)) mark(g.t.startSec, g.t.endSec);
  }
  return on;
}
export function expectedAttention(W, videoId, discIds) {
  discIds = Array.isArray(discIds) ? discIds : [discIds];
  const video = W.get(videoId), channel = W.get(video.t.channelId), views = latestViews(video), curve = curveOf(W, videoId);
  const on = secondsOn(W, videoId, discIds);
  const seconds = on.filter(Boolean).length;
  if (!channel.t.studioConnected || views === 0 || !curve) return { value: null, seconds, views };
  let sum = 0;
  on.forEach((flag, s) => { if (flag) sum += curve.t.fractions[s]; });
  return { value: views * sum, seconds, views, retentionSum: sum };
}
export function naiveMean(list) { let s = 0; for (const x of list) s += x; return s / list.length; }
