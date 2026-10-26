// Data preparation (no statistics here). Reads data/*.json, classifies each appearance row, matches releases,
// writes data/prepared.json. Every number shown on the page is computed later in insights.mjs through Capability Lab.
import { readFileSync, writeFileSync } from 'node:fs';
const rd = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const appearances = Object.values(rd('./data/appearances.json'));
const { videos, channels } = rd('./data/videos.json');
const { rows: releases } = rd('./data/releases.json');
const { rows: links } = rd('./data/description_links.json');
const vById = Object.fromEntries(videos.map((v) => [v.video_id, v]));

const MOLD_ALIAS = { buzz: 'buzzz' };           // transcript spelling vs catalogue spelling
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
const moldBase = (m) => (/^Unreleased/.test(m) ? 'Unreleased (name withheld)' : String(m).split(/[,;]/)[0].trim());
const moldKey = (m) => { const k = norm(moldBase(m)); return MOLD_ALIAS[k] ?? k; };
const epochDay = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
const MERGE_SECONDS = 30;

// Reasons a row is not counted, in precedence order. Each row gets exactly one.
function classify(a) {
  if (a.mode === 'candidate') return { counted: false, reason: 'candidate' };          // video-level note, start_seconds 0, no timestamp
  if (/^Unreleased/i.test(a.mold)) return { counted: false, reason: 'withheld' };      // unreleased disc: never named on the page
  if (/quote from a friend/i.test(a.evidence ?? '')) return { counted: false, reason: 'quoted from a friend' }; // id 111: someone else's words, two brands in one row
  if (a.manufacturer === 'unknown') return { counted: false, reason: 'manufacturer unknown' };
  if (/guessed/i.test(a.evidence ?? '')) return { counted: false, reason: 'manufacturer guessed' };
  return { counted: true, reason: null };
}

const prepared = appearances.map((a) => {
  const c = classify(a);
  const v = vById[a.video_id];
  return {
    id: a.id, video_id: a.video_id, channel_id: a.channel_id,
    manufacturer: a.manufacturer, mold: moldBase(a.mold), mold_full: a.mold,
    start_seconds: a.start_seconds, mode: a.mode, evidence: a.evidence, confidence: a.confidence,
    guessed: /guessed/i.test(a.evidence ?? ''),
    onCamera: a.mode === 'thrown' || a.mode === 'shown',
    counted: c.counted, reason: c.reason,
    url: `https://youtu.be/${a.video_id}?t=${a.start_seconds}`,
  };
});

// Release matches: same manufacturer + same mold name, exact-date releases only (YYYY-MM-DD).
// Same video + brand + cleaned mold within MERGE_SECONDS of an earlier counted row = the same moment; keep the first.
{
  const last = {};
  for (const a of [...prepared].filter((x) => x.counted).sort((x, y) => x.video_id.localeCompare(y.video_id) || x.start_seconds - y.start_seconds)) {
    const key = [a.video_id, a.manufacturer, moldKey(a.mold)].join('|');
    if (last[key] && a.start_seconds - last[key].start_seconds <= MERGE_SECONDS) { a.counted = false; a.reason = 'same moment'; a.mergedInto = last[key].id; }
    else last[key] = a;
  }
}
const exact = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const releaseMatches = [];
const coarseSkipped = [];
const seen = new Set();
for (const a of prepared) {
  if (a.mode === 'candidate') continue;
  for (const r of releases) {
    if (norm(a.manufacturer) !== norm(r.manufacturer) || moldKey(a.mold) !== moldKey(r.mold)) continue;
    const key = [a.video_id, a.manufacturer, moldKey(a.mold), r.release_date, r.plastic_or_run].join('|');
    if (seen.has(key)) continue; seen.add(key);
    const v = vById[a.video_id];
    const moldOld = releases.some((q) => norm(q.manufacturer) === norm(r.manufacturer) && moldKey(q.mold) === moldKey(r.mold) && q.kind === 'new mold' && q.release_date < r.release_date);
    const row = { moldOld, appearance_id: a.id, video_id: a.video_id, channel_id: a.channel_id, manufacturer: a.manufacturer, mold: a.mold,
      counted: a.counted, guessed: a.guessed, url: a.url, release_date: r.release_date, plastic_or_run: r.plastic_or_run,
      release_kind: r.kind, source_url: r.source_url, published_at: v.published_at };
    if (exact(r.release_date)) { row.release_day = epochDay(r.release_date); row.published_day = epochDay(v.published_at); releaseMatches.push(row); }
    else coarseSkipped.push(row);
  }
}

// Brands that have a release row at all (so "no release rows for this brand" can be told apart from "no match").
const releaseBrands = [...new Set(releases.map((r) => r.manufacturer))];

writeFileSync(new URL('./data/prepared.json', import.meta.url), JSON.stringify({
  built_from: ['appearances.json', 'videos.json', 'releases.json', 'description_links.json'],
  channels, videos, appearances: prepared, releaseCount: releases.length, releaseMatches, coarseSkipped, releaseBrands,
  links: links.map(({ video_id, position, destination_host, kind, thro_code }) => ({ video_id, position, destination_host, kind, thro_code })),
  window: { daysBefore: 14, daysAfter: 90 },
}, null, 1));
const n = (f) => prepared.filter(f).length;
console.log({ rows: prepared.length, counted: n((a) => a.counted), ...Object.fromEntries(['candidate','withheld','quoted from a friend','manufacturer unknown','manufacturer guessed','same moment'].map((r) => [r, n((a) => a.reason === r)])), releaseMatches: releaseMatches.length, coarseSkipped: coarseSkipped.length });
console.log(releaseMatches.map((m) => `${m.manufacturer} ${m.mold} counted=${m.counted} guessed=${m.guessed} vid=${m.published_at} rel=${m.release_date}`));
