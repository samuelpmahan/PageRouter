// Each test here pins a behaviour that a mutant of the Round 1 code got away with (the Critic's ten survivors) or that Round 2 added
// (time zone, window as a terminal, Short split). They run on the shared season with one small change and compare with ground truth stated in the test,
// not with the code under test. Fast: no Case derivation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeason } from './season.mjs';
import { analyzeWorld } from './analysis.mjs';
import { applyPatches, set, retimeVideo } from './patches.mjs';
import { oracle } from './oracle.mjs';
import { diffProjections } from './projection.mjs';
import { instantAt, quarterOf, monthLast, monthFirst, addDays } from './util.mjs';
import { exec } from './registry.mjs';

const INST = buildSeason(20261025);
const base = analyzeWorld(INST, 'base');
const run = (patches) => analyzeWorld(applyPatches(INST, patches), 'changed');
const raw = (A) => JSON.parse(JSON.stringify(A.W.instances.map((i) => ({ id: i.id, frame: i.frame, t: i.t }))));
const agree = (A) => assert.deepEqual(diffProjections(oracle(raw(A)), A.P), []);
const offsetOf = (A, videoId) => A.W.get(A.W.get(videoId).t.channelId).t.utcOffsetHours;
const moveTo = (A, videoId, day, hhmm = '12:00') => retimeVideo(A.W, A.W.get(videoId), instantAt(day, hhmm, offsetOf(A, videoId)));
const appearance = (A, discId, videoId) => A.E.appearances.find((a) => a.discId === discId && a.videoId === videoId);
const relRow = (A, appId) => A.M.releases.releases.flatMap((r) => r.videos).find((v) => v.appearanceId === appId);

test('the pipeline equals the oracle on three seeds (kills any mutant that changes a number the oracle derives independently)', () => {
  for (const seed of [20261025, 7, 99]) agree(analyzeWorld(buildSeason(seed), 's'));
});

test('survivor: a deal\'s last day and first day are inside the deal (deal end and start off-by-one)', () => {
  const deal = base.W.get('deal:tavi-brightline');   // 2026-01-01 .. 2026-06-30
  const lastDayVideos = base.W.all('Video').filter((v) => v.t.channelId === 'channel:tavi');
  const v = lastDayVideos.find((x) => base.E.videos[x.id].publishDay === deal.t.end);
  assert.ok(v, 'the season has a Tavi video on the deal\'s last day (local time zone UTC-8: it is already July 1 in UTC)');
  assert.ok(base.E.videos[v.id].dealIds.includes(deal.id), 'last day counts');
  const A = run([set(deal.id, 'end', addDays(deal.t.end, -1))]);
  assert.ok(!A.E.videos[v.id].dealIds.includes(deal.id), 'one day shorter: out');
  agree(A);
  const B = run([set('deal:tavi-halcyon', 'start', addDays('2026-07-01', 1))]);   // starts the day after the first Halcyon video
  const first = base.W.all('Video').find((x) => x.t.channelId === 'channel:tavi' && base.E.videos[x.id].publishDay === '2026-07-01');
  assert.ok(first, 'the season has a Tavi video on the first day of the Halcyon deal');
  assert.ok(base.E.videos[first.id].dealIds.includes('deal:tavi-halcyon')); assert.ok(!B.E.videos[first.id].dealIds.includes('deal:tavi-halcyon'));
  agree(B);
});

test('survivor: a video published on the release day is release support at offset 0, not pre-release (release-day-is-prerelease)', () => {
  const a = appearance(base, 'disc:maren-comet-pro', 'video:maren-03');
  const row = relRow(base, a.id);
  assert.equal(base.E.videos['video:maren-03'].publishDay, base.W.get('release:comet').t.date);
  assert.equal(row.class, 'release-window'); assert.equal(row.offsetDays, 0);
  assert.equal(a.releaseState, null);
  const A = run(moveTo(base, 'video:maren-03', addDays('2026-03-06', -1)));
  const b = appearance(A, 'disc:maren-comet-pro', 'video:maren-03');
  assert.equal(relRow(A, b.id).class, 'pre-release'); assert.equal(relRow(A, b.id).offsetDays, -1);
  agree(A);
});

test('survivors: window edges 29, 30, 31 for the default window, and a release with its own window (release-window-29 / -31, window hard-coded)', () => {
  for (const k of [29, 30, 31]) {
    const A = run(moveTo(base, 'video:maren-03', addDays('2026-03-06', k)));
    const row = relRow(A, appearance(A, 'disc:maren-comet-pro', 'video:maren-03').id);
    assert.equal(row.offsetDays, k);
    assert.equal(row.class, k <= 30 ? 'release-window' : 'established', `day ${k}`);
    agree(A);
  }
  const tam = base.E.appearances.find((a) => base.E.discs[a.discId].releaseId === 'release:tamarind-tour-series' && relRow(base, a.id));
  assert.ok(tam, 'a Tour Series appearance exists');
  const rel = base.W.get('release:tamarind-tour-series');
  assert.equal(rel.t.windowDays, 21);
  for (const k of [20, 21, 22]) {
    const A = run(moveTo(base, tam.videoId, addDays(rel.t.date, k)));
    const t = A.E.appearances.find((a) => a.discId === tam.discId && a.videoId === tam.videoId);
    assert.equal(relRow(A, t.id).class, k <= 21 ? 'release-window' : 'established', `Tour Series day ${k}`);
  }
  // the window is a terminal: stretch it and a 31-day-old appearance becomes release support
  const stretched = run([...moveTo(base, 'video:maren-03', addDays('2026-03-06', 31)), set('release:comet', 'windowDays', 31)]);
  assert.equal(relRow(stretched, appearance(stretched, 'disc:maren-comet-pro', 'video:maren-03').id).class, 'release-window');
});

test('survivors: month-precision edges (month-last-day-off): first and last day of the month are release-month, the day before is pre-release', () => {
  const rel = base.W.get('release:marlin'); // 2026-07, month precision
  const disc = base.E.appearances.find((a) => base.E.discs[a.discId].releaseId === rel.id);
  assert.ok(disc);
  for (const [day, cls] of [[monthFirst(rel.t.date), 'release-month'], [monthLast(rel.t.date), 'release-month'], [addDays(monthFirst(rel.t.date), -1), 'pre-release'], [addDays(monthLast(rel.t.date), 1), 'release-window']]) {
    const A = run(moveTo(base, disc.videoId, day));
    const a = A.E.appearances.find((x) => x.discId === disc.discId && x.videoId === disc.videoId);
    const row = relRow(A, a.id);
    assert.equal(row.class, cls, day);
    agree(A);
  }
  assert.equal(monthLast('2026-02'), '2026-02-28'); assert.equal(monthLast('2026-12'), '2026-12-31'); assert.equal(monthLast('2028-02'), '2028-02-29');
});

test('survivor: a click at a card\'s last second is credited to the moment, at the second the card goes away to the video (click-ts-end-inclusive)', () => {
  // choose a click whose card ends strictly inside the video with nothing else of that disc on screen at that second, so the end second is the only thing that decides
  const cardsOf = (link) => base.W.all('CardPlacement').filter((p) => p.t.videoId === link.t.videoId && p.t.discId === link.t.discId);
  const pick = base.W.all('Click').map((c) => ({ click: c, link: base.W.get(c.t.linkId) })).filter((x) => x.link.t.videoId && x.link.t.discId).map((x) => ({ ...x, card: cardsOf(x.link).find((p) => p.t.endSec < base.W.get(p.t.videoId).t.durationSeconds && p.t.endSec - p.t.startSec > 2 && !cardsOf(x.link).some((q) => q !== p && q.t.startSec <= p.t.endSec && p.t.endSec < q.t.endSec)) })).find((x) => x.card && base.E.appearances.some((a) => a.discId === x.link.t.discId && a.videoId === x.link.t.videoId && a.end === x.card.t.endSec && a.hasCard));
  assert.ok(pick, 'a click on a disc whose card ends inside the video exists');
  const { click, card } = pick;
  const last = run([set(click.id, 'videoTimestamp', card.t.endSec - 1)]), gone = run([set(click.id, 'videoTimestamp', card.t.endSec)]);
  assert.equal(last.E.clicks.find((c) => c.id === click.id).attribution.kind, 'moment');
  assert.equal(gone.E.clicks.find((c) => c.id === click.id).attribution.kind, 'video');
  const first = run([set(click.id, 'videoTimestamp', card.t.startSec)]), before = run([set(click.id, 'videoTimestamp', card.t.startSec - 1)]);
  assert.equal(first.E.clicks.find((c) => c.id === click.id).attribution.kind, 'moment');
  assert.equal(before.E.clicks.find((c) => c.id === click.id).attribution.kind, 'video');
  for (const A of [last, gone, first, before]) agree(A);
});

test('survivor: a mark the creator made past the end of the video is clamped like a card is (ignore-given-clamp)', () => {
  const mark = base.W.all('Appearance').find((m) => base.W.get(m.t.videoId).t.durationSeconds > m.t.endSec);
  const video = base.W.get(mark.t.videoId), dur = video.t.durationSeconds;
  const A = run([set(mark.id, 'endSec', dur + 20)]);
  const a = A.E.appearances.find((x) => x.givenIds.includes(mark.id));
  assert.equal(a.end, dur, `ends at ${a.end}, video is ${dur} s`);
  assert.ok(A.E.issues.some((i) => i.instanceId === mark.id && /clamped/.test(i.type)));
  const card = base.W.all('CardPlacement').find((m) => base.W.get(m.t.videoId).t.durationSeconds > m.t.endSec);
  const B = run([set(card.id, 'endSec', base.W.get(card.t.videoId).t.durationSeconds + 20)]);
  assert.ok(B.E.appearances.find((x) => x.placementIds.includes(card.id)).end <= base.W.get(card.t.videoId).t.durationSeconds);
  agree(A); agree(B);
});

test('survivor: views are the LATEST snapshot, and attention follows (views-first-snapshot)', () => {
  const v = base.W.all('Video').find((x) => x.t.viewSnapshots.length > 2 && base.E.videos[x.id].retentionState === 'ok');
  const latest = [...v.t.viewSnapshots].sort((a, b) => (a.at < b.at ? -1 : 1)).pop().views;
  assert.equal(base.E.videos[v.id].views, latest);
  const a = base.E.appearances.find((x) => x.videoId === v.id);
  const curve = base.W.where('RetentionCurve', 'videoId', v.id)[0].t.fractions;
  let s = 0; for (let t = a.start; t < Math.min(a.end, curve.length); t++) s += curve[t];
  assert.ok(Math.abs(base.M.attention.attention[a.id].value - latest * s) < 1e-6 * Math.max(1, latest * s));
  assert.ok(base.M.attention.attention[a.id].series.length === v.t.viewSnapshots.length);
});

test('survivor: June belongs to Q2, July to Q3, in the channel\'s own time zone (quarter-wrong, tz ignored)', () => {
  assert.equal(quarterOf('2026-06-30'), '2026-Q2'); assert.equal(quarterOf('2026-07-01'), '2026-Q3'); assert.equal(quarterOf('2026-03-31'), '2026-Q1'); assert.equal(quarterOf('2026-12-31'), '2026-Q4');
  // video:tavi-08 is published 2026-07-01T06:00Z = 2026-06-30 22:00 in UTC-8: Q2 locally, Q3 in UTC
  assert.equal(base.E.videos['video:tavi-08'].publishDay, '2026-06-30');
  assert.equal(base.E.videos['video:tavi-08'].quarter, '2026-Q2');
  assert.ok(base.E.videos['video:tavi-08'].dealIds.includes('deal:tavi-brightline'));
  const A = run([set('channel:tavi', 'utcOffsetHours', 0)]);
  assert.equal(A.E.videos['video:tavi-08'].quarter, '2026-Q3'); assert.ok(!A.E.videos['video:tavi-08'].dealIds.includes('deal:tavi-brightline'));
  agree(A);
  // video:jory-06 is 2026-06-30T23:30Z = 2026-07-01 00:30 in UTC+1: Q3 locally, Q2 in UTC
  assert.equal(base.E.videos['video:jory-06'].quarter, '2026-Q3');
});

test('survivor: clicks per 1,000 attention-seconds is credited clicks / attention x 1000 (per-thousand-scale)', () => {
  const [linkId, x] = Object.entries(base.M.clicks.perThousand)[0];
  const credited = base.E.clicks.filter((c) => c.linkId === linkId && c.attribution.kind !== 'unattributed').length;
  const attn = base.M.attention.byDiscVideo[x.discVideo].value;
  assert.ok(Math.abs(x.value - (credited / attn) * 1000) < 1e-9 * Math.max(1, x.value));
  assert.ok(x.value > 0 && x.value < 1000);
  assert.equal(exec('thro.ratio', { numerator: [3], denominator: [1500], scale: 1000 }).out.value, 2);
});

test('Round 2: Shorts are reported apart and added into the total; unmeasurable is null never zero', () => {
  const sd = Object.entries(base.M.attention.byDisc).filter(([, d]) => d.byFormat.short);
  assert.ok(sd.length > 0);
  for (const [, d] of sd) assert.ok(Math.abs((d.byFormat.long?.value ?? 0) + d.byFormat.short.value - d.value) < 1e-6 * d.value);
  const awaiting = base.E.appearances.find((a) => base.E.videos[a.videoId].retentionState === 'awaiting-views');
  assert.equal(base.M.attention.attention[awaiting.id].value, null);
  assert.ok(base.M.exposure.rows.some((r) => r.state === 'unmeasurable' && r.viewerMinutes === null));
});

test('Round 2: overlapping cards of one sponsor count their shared seconds once (no-union-across-discs)', () => {
  const rows = base.M.exposure.rows.filter((r) => r.entries.some((e) => e.sumAttention - e.unionAttention > 1e-9));
  assert.ok(rows.length > 0, 'the season has two discs of one brand overlapping in a video');
  for (const r of rows) for (const e of r.entries) assert.ok(e.unionAttention <= e.sumAttention + 1e-9);
  agree(base);
});

test('Round 2: a sponsor with a second concurrent deal for other molds is judged per mold (first-deal-only, mold-not-covered-ignored)', () => {
  const maren = base.E.appearances.filter((a) => base.E.videos[a.videoId].creatorId === 'creator:maren');
  assert.ok(maren.some((a) => a.bucket === 'sponsor' && a.dealId === 'deal:maren-tern'), 'Tern molds count under the Tern deal while the Halcyon deal is also active');
  assert.ok(maren.some((a) => a.bucket === 'sponsor' && a.dealId === 'deal:maren-halcyon'));
  assert.ok(maren.some((a) => a.bucket === 'mold-not-covered'), 'a Halcyon mold the deal does not cover');
});
