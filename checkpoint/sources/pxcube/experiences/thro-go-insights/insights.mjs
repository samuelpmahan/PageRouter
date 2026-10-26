// insights.mjs - every statistic on the page is produced here by calling a registered Capability Lab capability
// through the runtime registry (registry.execute). Two small composed capabilities (thro.ratio, thro.positionHistogram)
// are registered next to the statistics.* ones; each of them calls statistics.* capabilities through ctx.call.
// Nothing is computed with bare arithmetic except: building the input arrays, and the thin arithmetic that lives
// INSIDE the two registered thro.* capabilities.
import { createRegistry } from './vendor/capability-lab/src/runtime/index.mjs';
import { capabilities as statisticsCapabilities } from './vendor/capability-lab/src/statistics/index.mjs';

const numArray = { type: 'array', items: { type: 'number' } };
const throCapabilities = [
  {
    id: 'thro.ratio',
    title: 'Scaled ratio of two sums',
    description: 'scale x sum(numerator) / sum(denominator), both sums taken with statistics.sum.',
    kind: 'composed',
    dependsOn: ['statistics.sum'],
    inputSchema: { type: 'object', properties: { numerator: numArray, denominator: { ...numArray, minItems: 1 }, scale: { type: 'number' } }, required: ['numerator', 'denominator', 'scale'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false },
    examples: [{ input: { numerator: [1, 1], denominator: [10, 10], scale: 100 }, expected: { value: 10 } }],
    run: (input, ctx) => {
      const n = ctx.call('statistics.sum', { values: input.numerator }).value;
      const d = ctx.call('statistics.sum', { values: input.denominator }).value;
      if (d === 0) throw new RangeError('denominator sums to zero');
      return { value: (input.scale * n) / d };
    },
    formula: 'scale * sum(numerator) / sum(denominator)',
    caveats: 'Used for shares (scale 100) and appearance rates per ten minutes of runtime (scale 600, runtime in seconds).',
  },
  {
    id: 'thro.positionHistogram',
    title: 'Where in the runtime events start',
    description: 'Histogram of start_seconds / duration_seconds over equal-width bins on [0,1], via statistics.histogram.',
    kind: 'composed',
    dependsOn: ['statistics.histogram'],
    inputSchema: { type: 'object', properties: { starts: numArray, durations: numArray, bins: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['starts', 'durations', 'bins'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { bins: { type: 'array', items: { type: 'object', properties: { x0: { type: 'number' }, x1: { type: 'number' }, count: { type: 'integer', minimum: 0 } }, required: ['x0', 'x1', 'count'] } } }, required: ['bins'], additionalProperties: false },
    examples: [{ input: { starts: [0, 50], durations: [100, 100], bins: 2 }, expected: { bins: [{ x0: 0, x1: 0.5, count: 1 }, { x0: 0.5, x1: 1, count: 1 }] } }],
    run: (input, ctx) => {
      const values = input.starts.map((s, i) => Math.min(1, s / input.durations[i]));
      const edges = Array.from({ length: input.bins + 1 }, (_, i) => i / input.bins);
      return ctx.call('statistics.histogram', { values, edges });
    },
    formula: 'fraction = min(1, start / duration); statistics.histogram over equal-width edges',
    caveats: 'starts and durations are matched by index.',
  },
];

export const registry = createRegistry([...statisticsCapabilities, ...throCapabilities], { source: 'thro-go-insights over capability-lab', version: '1' });

const SEED = 20261025;
const REPLICATES = 2000;
const CONFIDENCE = 0.95;
const MODE_ORDER = ['talked', 'thrown', 'shown'];
const LINKED_BRAND_HOSTS = { 'Infinite Discs': /(^|\.)infinitediscs\.com$/, 'Trash Panda Disc Golf': /(^|\.)trashpandadiscgolf\.com$/ };
const MONEY_LINK_KINDS = ['retailer', 'affiliate', 'sponsor', 'manufacturer'];

export function computeInsights(prepared) {
  const facts = {};
  let counter = 0;
  const short = (v, n = 150) => { const s = JSON.stringify(v); return s.length > n ? s.slice(0, n) + `... (${s.length} chars)` : s; };

  /** Runs one capability and records a receipt so the page can say what produced a number. */
  function call(id, input, label) {
    const rec = registry.execute(id, input, {});
    const k = 'f' + (++counter);
    facts[k] = { k, id, label, input: short(input), result: short(rec.result), hash: rec.replay.resultHash, inputHash: rec.replay.inputHash, calls: rec.replay.calls };
    return { r: rec.result, k };
  }
  const sum = (values, label) => { const { r, k } = call('statistics.sum', { values }, label); return { v: r.value, k }; };
  const count = (values, label) => { const { r, k } = call('statistics.count', { values }, label); return { v: r.value, k }; };
  const ratio = (numerator, denominator, scale, label) => { const { r, k } = call('thro.ratio', { numerator, denominator, scale }, label); return { v: r.value, k }; };
  const ind = (arr, f) => arr.map((x) => (f(x) ? 1 : 0));

  const { videos, appearances, channels, releaseMatches, links, window: win } = prepared;
  const out = { creators: [], facts, window: win, seed: SEED, replicates: REPLICATES, confidence: CONFIDENCE };

  // Per-creator pass 1: per-video appearance rate (needed for the Welch comparison across creators).
  const byChannel = {};
  for (const v of videos) (byChannel[v.channel_id] ??= []).push(v);
  for (const list of Object.values(byChannel)) list.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

  const videoRates = {};
  for (const [cid, vids] of Object.entries(byChannel)) {
    videoRates[cid] = vids.map((v) => {
      const rows = appearances.filter((a) => a.video_id === v.video_id);
      const counted = sum(ind(rows, (a) => a.counted), `counted appearances in "${v.title}"`);
      const rate = ratio([counted.v], [v.duration_seconds], 600, `counted appearances per 10 minutes of runtime, "${v.title}"`);
      return { counted, rate };
    });
  }

  for (const [cid, vids] of Object.entries(byChannel)) {
    const ch = channels[cid];
    const rows = appearances.filter((a) => a.channel_id === cid);
    const cRows = rows.filter((a) => a.counted);
    const vidIndex = Object.fromEntries(vids.map((v, i) => [v.video_id, i]));
    const views = vids.map((v) => v.views);
    const c = { channelId: cid, handle: ch.handle, title: ch.title, short: ch.handle === '@jmillydg' ? 'J-Milly' : 'Bodanza' };

    // headline counts
    c.rowsTotal = count(rows.map((a) => a.id), `all appearance rows for ${c.short}`);
    c.counted = sum(ind(rows, (a) => a.counted), `counted appearances for ${c.short}`);
    c.excluded = {
      candidate: sum(ind(rows, (a) => a.reason === 'candidate'), 'candidate rows (video-level, no timestamp)'),
      guessed: sum(ind(rows, (a) => a.reason === 'manufacturer guessed'), 'timestamped rows with manufacturer guessed'),
      unknown: sum(ind(rows, (a) => a.reason === 'manufacturer unknown'), 'timestamped rows with manufacturer unknown'),
      multi: sum(ind(rows, (a) => a.reason === 'two brands in one row'), 'timestamped rows naming two brands'),
    };
    c.videoCount = count(views, `videos for ${c.short} (counting their view totals)`);
    c.totalViews = sum(views, `views across ${c.short}'s ${vids.length} videos (snapshot 2026-10-21)`);
    const videosWithBrand = vids.map((v) => (cRows.some((a) => a.video_id === v.video_id) ? 1 : 0));
    c.reachCeiling = sum(vids.filter((_, i) => videosWithBrand[i]).map((v) => v.views), `views of videos with at least one counted appearance (ceiling)`);

    // brands and molds ledgers
    const ledger = (keyOf, labelOf) => {
      const keys = [...new Set(cRows.map(keyOf))];
      const items = keys.map((key) => {
        const mine = cRows.filter((a) => keyOf(a) === key);
        const label = labelOf(mine[0]);
        const n = sum(ind(cRows, (a) => keyOf(a) === key), `counted appearances of ${label}`);
        const onCam = sum(ind(cRows, (a) => keyOf(a) === key && a.onCamera), `thrown or shown (on camera) counted appearances of ${label}`);
        const inVid = vids.map((v) => (mine.some((a) => a.video_id === v.video_id) ? 1 : 0));
        const nVideos = sum(inVid, `videos containing ${label}`);
        const reach = sum(vids.filter((_, i) => inVid[i]).map((v) => v.views), `views of the ${nVideos.v} videos containing ${label} (ceiling, not viewers who saw it)`);
        const share = ratio([n.v], [c.counted.v], 100, `${label} share of counted appearances, percent`);
        return { key, label, brand: mine[0].manufacturer, n, onCam, nVideos, reach, share, videoFlags: inVid };
      });
      items.sort((a, b) => b.n.v - a.n.v || b.reach.v - a.reach.v || a.label.localeCompare(b.label));
      const rk = call('statistics.rank', { values: items.map((i) => -i.n.v), method: 'min' }, `rank of ${items.length} by counted appearances (ties share the lower rank)`);
      items.forEach((it, i) => { it.rank = { v: rk.r.ranks[i], k: rk.k }; });
      return items;
    };
    c.brands = ledger((a) => a.manufacturer, (a) => a.manufacturer);
    c.molds = ledger((a) => a.manufacturer + '|' + a.mold, (a) => `${a.manufacturer} ${a.mold}`);

    // modes and evidence
    c.modes = MODE_ORDER.map((m) => ({ mode: m, n: sum(ind(cRows, (a) => a.mode === m), `counted appearances with mode ${m}`) }));
    const evCat = (a) => (a.guessed ? 'guessed' : /retailer listing/.test(a.evidence) ? 'retailer' : /description|visible/.test(a.evidence) && /said aloud/.test(a.evidence) ? 'corroborated' : /said aloud/.test(a.evidence) ? 'aloud' : 'description');
    c.evidence = [
      ['aloud', 'Said aloud, nothing else'], ['corroborated', 'Said aloud + description or visible'], ['retailer', 'Said aloud + retailer listing'],
      ['guessed', 'Manufacturer guessed'], ['description', 'Description only'],
    ].map(([key, label]) => ({ key, label, n: sum(ind(rows, (a) => evCat(a) === key), `${c.short} rows with evidence class "${label}"`) }));

    // per-video
    c.videos = vids.map((v, i) => {
      const vr = appearances.filter((a) => a.video_id === v.video_id && a.mode !== 'candidate');
      return {
        ...v, counted: videoRates[cid][i].counted, rate: videoRates[cid][i].rate,
        marks: vr.map((a) => ({ id: a.id, brand: a.manufacturer, mold: a.mold, start: a.start_seconds, mode: a.mode, guessed: a.guessed, counted: a.counted, reason: a.reason, url: a.url })),
      };
    });

    // position histogram over counted appearances
    c.position = call('thro.positionHistogram', {
      starts: cRows.map((a) => a.start_seconds), durations: cRows.map((a) => vids[vidIndex[a.video_id]].duration_seconds), bins: 10,
    }, `where in the runtime counted appearances start, 10 equal bins, ${c.short}`);

    // uncertainty on a 5-video sample
    const ratesArr = c.videos.map((v) => v.rate.v);
    c.viewsCI = call('statistics.bootstrapMeanCI', { values: views, replicates: REPLICATES, seed: SEED, confidence: CONFIDENCE }, `${c.short} mean views per video, percentile bootstrap`);
    c.rateCI = call('statistics.bootstrapMeanCI', { values: ratesArr, replicates: REPLICATES, seed: SEED, confidence: CONFIDENCE }, `${c.short} mean counted appearances per 10 minutes, percentile bootstrap`);
    c.viewsSummary = call('statistics.robustSummary', { values: views }, `${c.short} median views per video`);
    c.rateSummary = call('statistics.robustSummary', { values: ratesArr }, `${c.short} median counted appearances per 10 minutes`);

    // brands that carry a link in this creator's descriptions vs brands that do not (paired by video)
    const myLinks = links.filter((l) => vids.some((v) => v.video_id === l.video_id));
    const linkedBrands = c.brands.filter((b) => LINKED_BRAND_HOSTS[b.brand] && myLinks.some((l) => LINKED_BRAND_HOSTS[b.brand].test(l.destination_host))).map((b) => b.brand);
    c.linkedBrands = linkedBrands;
    if (linkedBrands.length) {
      const perVideo = (pred, who) => vids.map((v) => ratio([sum(ind(cRows, (a) => a.video_id === v.video_id && pred(a)), `counted appearances of ${who} in "${v.title}"`).v], [v.duration_seconds], 600, `${who} appearances per 10 minutes, "${v.title}"`).v);
      const linkedRates = perVideo((a) => linkedBrands.includes(a.manufacturer), 'linked brands');
      const otherRates = perVideo((a) => !linkedBrands.includes(a.manufacturer), 'other brands');
      c.linkedRates = linkedRates; c.otherRates = otherRates;
      c.linkedCI = call('statistics.bootstrapPairedDifferenceCI', { x: linkedRates, y: otherRates, replicates: REPLICATES, seed: SEED, confidence: CONFIDENCE },
        `${c.short}: mean per-video difference in counted appearances per 10 minutes, brands linked in descriptions (${linkedBrands.join(', ')}) minus other brands`);
      c.linkedMeans = [call('statistics.mean', { values: linkedRates }, 'mean per-10-minute rate, linked brands'), call('statistics.mean', { values: otherRates }, 'mean per-10-minute rate, other brands')];
    }

    // description links
    c.links = {
      total: count(myLinks.map((l) => l.position), `links in the ${vids.length} video descriptions`),
      paying: sum(ind(myLinks, (l) => MONEY_LINK_KINDS.includes(l.kind)), 'links to retailers, affiliates, sponsors or manufacturers'),
      tracked: sum(myLinks.map((l) => (l.thro_code ? 1 : 0)), 'links carrying a per-disc thro code'),
    };

    // release support: signed day offsets (video published minus release date) through statistics.pairedDifferences
    const ms = releaseMatches.filter((m) => m.channel_id === cid);
    c.releaseMatches = ms;
    if (ms.length >= 1) {
      const pd = call('statistics.pairedDifferences', { x: ms.map((m) => m.published_day), y: ms.map((m) => m.release_day) },
        `days from release date to video publish date for ${ms.length} manufacturer+mold matches`);
      ms.forEach((m, i) => { m.offsetDays = { v: pd.r.values[i], k: pd.k }; m.inWindow = m.counted && pd.r.values[i] >= -win.daysBefore && pd.r.values[i] <= win.daysAfter; });
      const supportedVideos = [...new Set(ms.filter((m) => m.inWindow).map((m) => m.video_id))];
      c.releaseSupportedVideos = count(vids.filter((v) => supportedVideos.includes(v.video_id)).map((v) => v.views), `videos with a counted appearance of a mold published ${win.daysBefore} days before to ${win.daysAfter} days after its release`);
      c.releaseSupportedViews = sum(vids.filter((v) => supportedVideos.includes(v.video_id)).map((v) => v.views), 'views of those release-supported videos (ceiling)');
    }
    const releaseBrandSet = new Set(prepared.releaseBrands);
    c.brandsWithoutReleaseRows = c.brands.filter((b) => !releaseBrandSet.has(b.brand)).map((b) => b.brand);
    out.creators.push(c);
  }

  // Welch comparison of per-video appearance rate, J-Milly vs Bodanza, 5 vs 5 videos.
  const [a, b] = out.creators;
  if (a && b) {
    const A = a.videos.map((v) => v.rate.v), B = b.videos.map((v) => v.rate.v);
    const w = call('statistics.welchMeanDifference', { a: A, b: B }, `${a.short} minus ${b.short}: mean counted appearances per 10 minutes, ${A.length} vs ${B.length} videos`);
    out.welch = { ...w, a: a.short, b: b.short, nA: count(A, `${a.short} videos in comparison`), nB: count(B, `${b.short} videos in comparison`) };
  }
  out.capabilityUse = Object.entries(Object.values(facts).reduce((m, f) => ((m[f.id] = (m[f.id] ?? 0) + 1), m), {})).sort((x, y) => y[1] - x[1]);
  return out;
}
