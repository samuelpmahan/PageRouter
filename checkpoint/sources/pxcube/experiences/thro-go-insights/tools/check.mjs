import { readFileSync } from 'node:fs';
import { computeInsights } from '../insights.mjs';
const p = JSON.parse(readFileSync(new URL('../data/prepared.json', import.meta.url)));
const t = Date.now(); const m = computeInsights(p);
console.log('ms', Date.now() - t, 'facts', Object.keys(m.facts).length, m.capabilityUse);
for (const c of m.creators) {
  console.log('==', c.short, 'rows', c.rowsTotal.v, 'counted', c.counted.v, 'excl', Object.fromEntries(Object.entries(c.excluded).map(([k, v]) => [k, v.v])), 'views', c.totalViews.v, 'reach', c.reachCeiling.v);
  console.log(c.brands.map((b) => `#${b.rank.v} ${b.label} n=${b.n.v} cam=${b.onCam.v} vids=${b.nVideos.v} reach=${b.reach.v} share=${b.share.v.toFixed(1)}`).join('\n'));
  console.log('molds', c.molds.slice(0, 5).map((b) => `${b.label} ${b.n.v}`).join(' | '));
  console.log('pos', c.position.r.bins.map((b) => b.count).join(','), 'viewsCI', JSON.stringify(c.viewsCI.r), 'rateCI', JSON.stringify(c.rateCI.r), 'rates', c.videos.map((v) => v.rate.v.toFixed(2)).join(','));
  console.log('linked', c.linkedBrands, c.linkedCI && JSON.stringify(c.linkedCI.r), c.linkedMeans?.map((x) => x.r.value));
  console.log('links', c.links.total.v, c.links.paying.v, c.links.tracked.v, 'release', c.releaseMatches.map((r) => [r.mold, r.offsetDays.v, r.inWindow]), c.releaseSupportedVideos?.v, c.releaseSupportedViews?.v);
  console.log('evidence', c.evidence.map((e) => e.n.v), 'modes', c.modes.map((e) => e.n.v), 'noRelease', c.brandsWithoutReleaseRows);
}
console.log('welch', JSON.stringify(m.welch.r));
