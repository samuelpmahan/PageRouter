import { readFileSync } from 'node:fs';
import { computeInsights } from '../insights.mjs';
const p = JSON.parse(readFileSync(new URL('../data/prepared.json', import.meta.url)));
const m = computeInsights(p);
console.log('facts', Object.keys(m.facts).length, m.capabilityUse.map((x) => x.join(' ')).join(', '));
for (const c of m.creators) {
  console.log('==', c.short, 'counted', c.counted.v, 'onCam', c.onCamera.v, 'fates', c.fates.map((f) => f.key + ':' + f.n.v).join(' '), 'pooled', c.pooledRate.v.toFixed(2));
  console.log('busiest', c.busiest.video.title, c.busiest.n.v, c.busiest.share.v.toFixed(0) + '%');
  console.log(c.brands.map((b) => `#${b.rank.v} ${b.label} n=${b.n.v} cam=${b.onCam.v} vids=${b.nVideos.v} reach=${b.reach.v} ${b.share.v.toFixed(0)}%`).join('\n'));
  console.log('molds', c.molds.slice(0, 4).map((b) => `${b.label} ${b.n.v}/${b.nVideos.v}v`).join(' | '), 'ev', c.evidence.map((e) => e.n.v));
  console.log('release', 'H', c.release.headline.length, 'L', c.release.leads.map((r) => r.mold + r.offsetDays.v), 'O', c.release.older.map((r) => r.mold + r.release_date.slice(0, 4)), 'missing', c.release.missingBrands);
}
