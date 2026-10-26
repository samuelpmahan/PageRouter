// insights.mjs - every statistic on the page is produced here by calling a registered capability through the runtime registry
// (registry.execute): the statistics.* capabilities of the vendored Capability Lab plus the two registered composed capabilities in
// thro-capabilities/ (thro.ratio, thro.positionHistogram), which themselves call statistics.* through ctx.call.
// Outside the registry this file only builds input arrays and picks which row goes in which group.
import { createRegistry } from './vendor/capability-lab/src/runtime/index.mjs';
import { capabilities as statisticsCapabilities } from './vendor/capability-lab/src/statistics/index.mjs';
import { capabilities as throCapabilities } from './thro-capabilities/index.mjs';

export const registry = createRegistry([...statisticsCapabilities, ...throCapabilities], { source: 'thro-go-insights over capability-lab', version: '2' });

const SEED = 20261025;
const REPLICATES = 1000; // maximum the bootstrap capability accepts
const CONFIDENCE = 0.95;
const LINKED_BRAND_HOSTS = { 'Infinite Discs': /(^|\.)infinitediscs\.com$/, 'Trash Panda Disc Golf': /(^|\.)trashpandadiscgolf\.com$/ };
const MONEY_LINK_KINDS = ['retailer', 'affiliate', 'sponsor', 'manufacturer'];
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const rowText = (a) => `#${a.id} ${a.manufacturer} ${a.mold} at ${mmss(a.start_seconds)} (${a.mode})`;
const f1 = (n) => (Math.round(n * 10) / 10).toString();

export function computeInsights(prepared) {
  const facts = {};
  let counter = 0;
  const short = (v, n = 160) => { const s = JSON.stringify(v); return s.length > n ? s.slice(0, n) + `... (${s.length} characters)` : s; };

  /** Runs one capability, records a receipt. `items` are human-readable lines saying what went into the input. */
  function call(id, input, label, items = []) {
    const rec = registry.execute(id, input, {});
    const k = 'f' + (++counter);
    const shownItems = items.length > 14 ? [...items.slice(0, 14), `and ${items.length - 14} more`] : items;
    facts[k] = { k, id, label, items: shownItems, input: short(input), result: short(rec.result), hash: rec.replay.resultHash, calls: rec.replay.calls };
    return { r: rec.result, k };
  }
  const sum = (values, label, items) => { const { r, k } = call('statistics.sum', { values }, label, items); return { v: r.value, k }; };
  const count = (values, label, items) => { const { r, k } = call('statistics.count', { values }, label, items); return { v: r.value, k }; };
  const ratio = (numerator, denominator, scale, label, items) => { const { r, k } = call('thro.ratio', { numerator, denominator, scale }, label, items); return { v: r.value, k }; };
  /** Sum of 0/1 over rows; the receipt lists the rows that were 1. */
  const countRows = (rows, pred, label) => { const hit = rows.filter(pred); return sum(rows.map((r) => (pred(r) ? 1 : 0)), label, hit.length ? hit.map(rowText) : ['no rows']); };
  const viewsOf = (vids) => vids.map((v) => `${v.title} (${v.views.toLocaleString('en-US')} views)`);

  const { videos, appearances, channels, releaseMatches, links, window: win } = prepared;
  const out = { creators: [], facts, window: win, seed: SEED, replicates: REPLICATES, confidence: CONFIDENCE };
  const byChannel = {};
  for (const v of videos) (byChannel[v.channel_id] ??= []).push(v);
  for (const list of Object.values(byChannel)) list.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

  // per-video counted appearances and rate (needed by both creators for the method comparison)
  const perVideo = {};
  for (const [cid, vids] of Object.entries(byChannel)) {
    perVideo[cid] = vids.map((v) => {
      const rows = appearances.filter((a) => a.video_id === v.video_id);
      const counted = countRows(rows, (a) => a.counted, `counted rows in "${v.title}"`);
      const rate = ratio([counted.v], [v.duration_seconds], 600, `counted per 10 minutes, "${v.title}"`, [`${counted.v} counted`, `${v.duration_seconds} seconds of runtime (${mmss(v.duration_seconds)})`]);
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

    // what happened to each row (exclusive classes, one number per row)
    c.rowsTotal = count(rows.map((a) => a.id), `rows for ${c.short}`, [`${rows.length} appearance rows`]);
    c.counted = countRows(rows, (a) => a.counted, `counted rows for ${c.short}`);
    const FATES = [['candidate', 'notes without a timestamp'], ['manufacturer guessed', 'manufacturer guessed'], ['manufacturer unknown', 'manufacturer unknown'], ['same moment', 'repeat of a row within 30 seconds'], ['quoted from a friend', 'quoted from a friend'], ['withheld', 'withheld']];
    c.fates = [{ key: 'counted', label: 'counted', n: c.counted }, ...FATES.map(([key, label]) => ({ key, label, n: countRows(rows, (a) => a.reason === key, `${c.short} rows left out: ${label}`) }))].filter((f) => f.key === 'counted' || f.n.v > 0);
    c.onCamera = countRows(cRows, (a) => a.onCamera, `counted rows thrown or shown (on camera) for ${c.short}`);
    c.videoCount = count(views, `videos for ${c.short}`, viewsOf(vids));
    c.totalViews = sum(views, `views of ${c.short}'s ${vids.length} videos (snapshot 2026-10-21)`, viewsOf(vids));
    const flags = vids.map((v) => (cRows.some((a) => a.video_id === v.video_id) ? 1 : 0));
    c.reachCeiling = sum(vids.filter((_, i) => flags[i]).map((v) => v.views), 'views of the videos with a counted appearance (ceiling)', viewsOf(vids.filter((_, i) => flags[i])));

    // brand and disc ledgers
    const ledger = (keyOf, labelOf) => {
      const items = [...new Set(cRows.map(keyOf))].map((key) => {
        const mine = cRows.filter((a) => keyOf(a) === key);
        const label = labelOf(mine[0]);
        const n = countRows(cRows, (a) => keyOf(a) === key, `counted rows of ${label}`);
        const onCam = countRows(cRows, (a) => keyOf(a) === key && a.onCamera, `counted rows of ${label} thrown or shown`);
        const inVid = vids.map((v) => (mine.some((a) => a.video_id === v.video_id) ? 1 : 0));
        const vs = vids.filter((_, i) => inVid[i]);
        const nVideos = sum(inVid, `videos containing ${label}`, vs.map((v) => v.title));
        const reach = sum(vs.map((v) => v.views), `views of the ${vs.length} video${vs.length === 1 ? '' : 's'} containing ${label} (ceiling)`, viewsOf(vs));
        const share = ratio([n.v], [c.counted.v], 100, `${label} share of counted rows, percent`, [`${n.v} of ${c.counted.v} counted rows`]);
        return { key, label, brand: mine[0].manufacturer, mold: mine[0].mold, n, onCam, nVideos, reach, share };
      });
      items.sort((a, b) => b.n.v - a.n.v || b.reach.v - a.reach.v || a.label.localeCompare(b.label));
      const rk = call('statistics.rank', { values: items.map((i) => -i.n.v), method: 'min' }, `rank by counted rows (ties share the lower rank)`, items.map((i) => `${i.label}: ${i.n.v}`));
      items.forEach((it, i) => { it.rank = { v: rk.r.ranks[i], k: rk.k }; });
      return items;
    };
    c.brands = ledger((a) => a.manufacturer, (a) => a.manufacturer);
    c.molds = ledger((a) => a.manufacturer + '|' + a.mold, (a) => `${a.manufacturer} ${a.mold}`);

    // evidence among counted rows
    const evCat = (a) => (/retailer listing/.test(a.evidence) ? 'retailer' : /description|visible/.test(a.evidence) && /said aloud/.test(a.evidence) ? 'corroborated' : /said aloud/.test(a.evidence) ? 'aloud' : 'description');
    c.evidence = [['aloud', 'said aloud only'], ['corroborated', 'said aloud and also in the description or visible'], ['retailer', 'said aloud and found on a retailer listing'], ['description', 'description only']]
      .map(([key, label]) => ({ key, label, n: countRows(cRows, (a) => evCat(a) === key, `counted rows for ${c.short}: ${label}`) })).filter((e) => e.n.v > 0);

    // per video, with marks (rows that are not counted for a reason other than guessed/unknown are not drawn)
    c.videos = vids.map((v, i) => ({
      ...v, counted: perVideo[cid][i].counted, rate: perVideo[cid][i].rate,
      marks: appearances.filter((a) => a.video_id === v.video_id && (a.counted || a.reason === 'manufacturer guessed' || a.reason === 'manufacturer unknown'))
        .map((a) => ({ id: a.id, brand: a.manufacturer, mold: a.mold, start: a.start_seconds, mode: a.mode, counted: a.counted, reason: a.reason, url: a.url })),
      guessedCount: appearances.filter((a) => a.video_id === v.video_id && a.reason === 'manufacturer guessed').length,
    }));

    // concentration: the busiest video
    const counts = c.videos.map((v) => v.counted.v);
    const ex = call('statistics.extrema', { values: counts }, 'most counted rows in any one video', c.videos.map((v) => `${v.title}: ${v.counted.v}`));
    const bi = counts.indexOf(ex.r.max);
    c.busiest = { video: c.videos[bi], n: { v: ex.r.max, k: ex.k }, share: ratio([ex.r.max], [c.counted.v], 100, `share of ${c.short}'s counted rows that sit in "${c.videos[bi].title}"`, [`${ex.r.max} of ${c.counted.v} counted rows`]) };
    c.pooledRate = ratio(counts, vids.map((v) => v.duration_seconds), 600, `counted rows per 10 minutes, all ${vids.length} videos pooled`, [`${c.counted.v} counted rows`, `${vids.reduce((s, v) => s + v.duration_seconds, 0)} seconds of runtime in total`]);

    c.position = call('thro.positionHistogram', { starts: cRows.map((a) => a.start_seconds), durations: cRows.map((a) => vids[vidIndex[a.video_id]].duration_seconds), bins: 10 },
      `where in the runtime counted rows start, ten equal bins, ${c.short}`, cRows.map(rowText));

    // method (small sample)
    const ratesArr = c.videos.map((v) => v.rate.v);
    const rateItems = c.videos.map((v) => `${v.title}: ${f1(v.rate.v)} per 10 minutes`);
    c.viewsCI = call('statistics.bootstrapMeanCI', { values: views, replicates: REPLICATES, seed: SEED, confidence: CONFIDENCE }, `${c.short} mean views per video, percentile bootstrap`, viewsOf(vids));
    c.rateCI = call('statistics.bootstrapMeanCI', { values: ratesArr, replicates: REPLICATES, seed: SEED, confidence: CONFIDENCE }, `${c.short} mean of the per-video rates, percentile bootstrap`, rateItems);
    c.viewsSummary = call('statistics.robustSummary', { values: views }, `${c.short} median views per video`, viewsOf(vids));

    // description links and brands that already sit in them
    const myLinks = links.filter((l) => vids.some((v) => v.video_id === l.video_id));
    const linkText = (l) => `${l.destination_host} (${l.kind}) in "${vids.find((v) => v.video_id === l.video_id).title}"`;
    c.links = {
      total: count(myLinks.map((l) => l.position), `links in the ${vids.length} descriptions`, [`${myLinks.length} links`]),
      paying: (() => { const hit = myLinks.filter((l) => MONEY_LINK_KINDS.includes(l.kind)); return sum(myLinks.map((l) => (MONEY_LINK_KINDS.includes(l.kind) ? 1 : 0)), 'links to retailers, affiliates, sponsors or manufacturers', hit.map(linkText)); })(),
      tracked: sum(myLinks.map((l) => (l.thro_code ? 1 : 0)), 'links carrying a per-disc thro code', ['none of the links carries a thro code']),
    };
    c.linkedBrands = c.brands.filter((b) => LINKED_BRAND_HOSTS[b.brand] && myLinks.some((l) => LINKED_BRAND_HOSTS[b.brand].test(l.destination_host))).map((b) => b.brand);
    if (c.linkedBrands.length) {
      const hit = myLinks.filter((l) => c.linkedBrands.some((b) => LINKED_BRAND_HOSTS[b].test(l.destination_host)));
      c.linkedBrandLinks = sum(myLinks.map((l) => (c.linkedBrands.some((b) => LINKED_BRAND_HOSTS[b].test(l.destination_host)) ? 1 : 0)), `description links to ${c.linkedBrands.join(' and ')}`, hit.map(linkText));
      const rates = (pred, who) => vids.map((v) => ratio([countRows(cRows, (a) => a.video_id === v.video_id && pred(a), `counted rows of ${who} in "${v.title}"`).v], [v.duration_seconds], 600, `${who}: counted per 10 minutes in "${v.title}"`, [`${v.duration_seconds} seconds of runtime`]).v);
      const linkedRates = rates((a) => c.linkedBrands.includes(a.manufacturer), 'brands in the descriptions');
      const otherRates = rates((a) => !c.linkedBrands.includes(a.manufacturer), 'other brands');
      const pairItems = vids.map((v, i) => `${v.title}: ${f1(linkedRates[i])} minus ${f1(otherRates[i])}`);
      c.linkedCI = call('statistics.bootstrapPairedDifferenceCI', { x: linkedRates, y: otherRates, replicates: REPLICATES, seed: SEED, confidence: CONFIDENCE }, `${c.short}: per-video rate of brands that sit in the descriptions minus the rate of other brands`, pairItems);
      c.linkedMeans = [call('statistics.mean', { values: linkedRates }, 'mean per-video rate, brands in the descriptions', linkedRates.map(f1)), call('statistics.mean', { values: otherRates }, 'mean per-video rate, other brands', otherRates.map(f1))];
    }

    // release support (counted rows only; guessed rows never reach this section)
    const ms = releaseMatches.filter((m) => m.channel_id === cid && m.counted);
    c.release = { headline: [], leads: [], older: [] };
    if (ms.length) {
      const pd = call('statistics.pairedDifferences', { x: ms.map((m) => m.published_day), y: ms.map((m) => m.release_day) },
        'days from release date to video publish date', ms.map((m) => `${m.manufacturer} ${m.mold}: video ${m.published_at} minus release ${m.release_date}`));
      ms.forEach((m, i) => {
        m.offsetDays = { v: pd.r.values[i], k: pd.k };
        const inWindow = pd.r.values[i] >= -win.daysBefore && pd.r.values[i] <= win.daysAfter;
        (inWindow ? (m.moldOld ? c.release.leads : c.release.headline) : c.release.older).push(m);
      });
      if (c.release.headline.length) {
        const vs = vids.filter((v) => c.release.headline.some((m) => m.video_id === v.video_id));
        c.release.views = sum(vs.map((v) => v.views), 'views of the release-supported videos (ceiling)', viewsOf(vs));
      }
    }
    const brandsInCalendar = new Set(prepared.releaseBrands);
    c.release.missingBrands = c.brands.filter((b) => !brandsInCalendar.has(b.brand)).map((b) => b.brand);
    c.release.calendar = count(prepared.releaseBrands.map(() => 1), 'manufacturers in the release calendar', prepared.releaseBrands);
    out.creators.push(c);
  }

  const [a, b] = out.creators;
  if (a && b) {
    const A = a.videos.map((v) => v.rate.v), B = b.videos.map((v) => v.rate.v);
    out.welch = {
      ...call('statistics.welchMeanDifference', { a: A, b: B }, `${a.short} minus ${b.short}: mean counted rows per 10 minutes`, [...a.videos.map((v, i) => `${a.short}, ${v.title}: ${f1(A[i])}`), ...b.videos.map((v, i) => `${b.short}, ${v.title}: ${f1(B[i])}`)]),
      a: a.short, b: b.short, nA: count(A, `${a.short} videos in the comparison`, A.map(f1)), nB: count(B, `${b.short} videos in the comparison`, B.map(f1)),
    };
  }
  out.capabilityUse = Object.entries(Object.values(facts).reduce((m, f) => ((m[f.id] = (m[f.id] ?? 0) + 1), m), {})).sort((x, y) => y[1] - x[1]);
  return out;
}
