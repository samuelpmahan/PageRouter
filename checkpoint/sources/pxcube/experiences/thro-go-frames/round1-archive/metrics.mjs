// Metrics over the enriched, linked fragment. Every number is produced by a registered capability (exec) and carries its receipt.
import { exec } from './registry.mjs';
import { curveOf } from './world.mjs';
import { dayDiff, mergeIntervals, quarterOf, monthFirst, monthLast } from './util.mjs';

const sum = (values) => (values.length ? exec('statistics.sum', { values }) : { out: { value: 0 }, receipt: null });

export function attentionMetrics(W, E) {
  const attention = {};
  for (const a of E.appearances) {
    const v = E.videos[a.videoId];
    if (v.retentionState !== 'ok') { attention[a.id] = { value: null, state: v.retentionState, seconds: a.seconds, receipt: null }; continue; }
    const fractions = curveOf(W, v.id).t.fractions;
    const r = exec('thro.attentionSeconds', { retention: fractions, intervals: [[a.start, a.end]], views: v.views });
    const mean = r.out.seconds > 0 ? exec('thro.ratio', { numerator: [r.out.retentionSum], denominator: [r.out.seconds], scale: 1 }).out.value : null;
    const series = [...v.viewSnapshots].sort((x, y) => x.at.localeCompare(y.at)).map((s) => ({ at: s.at, views: s.views, value: exec('thro.attentionSeconds', { retention: fractions, intervals: [[a.start, a.end]], views: s.views }).out.value }));
    attention[a.id] = { value: r.out.value, state: 'ok', seconds: r.out.seconds, retentionSum: r.out.retentionSum, meanRetention: mean, views: v.views, series, receipt: r.receipt };
  }
  const byDiscVideo = {}, byDisc = {}, byMold = {};
  const group = (keyOf) => {
    const g = {};
    for (const a of E.appearances) if (attention[a.id].value != null) (g[keyOf(a)] ??= []).push(a);
    return g;
  };
  for (const [k, list] of Object.entries(group((a) => `${a.discId}@${a.videoId}`))) { const s = sum(list.map((a) => attention[a.id].value)); byDiscVideo[k] = { value: s.out.value, appearanceIds: list.map((a) => a.id), receipt: s.receipt }; }
  for (const [k, list] of Object.entries(group((a) => a.discId))) { const s = sum(list.map((a) => attention[a.id].value)); byDisc[k] = { value: s.out.value, videoIds: [...new Set(list.map((a) => a.videoId))], appearanceIds: list.map((a) => a.id), receipt: s.receipt }; }
  const moldKey = (a) => E.discs[a.discId].moldId ?? E.discs[a.discId].provisionalMoldId;
  for (const [k, list] of Object.entries(group(moldKey))) {
    const s = sum(list.map((a) => attention[a.id].value));
    const creators = [...new Set(list.map((a) => E.discs[a.discId].creatorId))].sort();
    const perCreator = Object.fromEntries(creators.map((c) => [c, sum(list.filter((a) => E.discs[a.discId].creatorId === c).map((a) => attention[a.id].value)).out.value]));
    byMold[k] = { value: s.out.value, creators, perCreator, discIds: [...new Set(list.map((a) => a.discId))], receipt: s.receipt };
  }
  const unmeasured = E.appearances.filter((a) => attention[a.id].value == null).map((a) => a.id);
  return { attention, byDiscVideo, byDisc, byMold, unmeasured };
}

export function dipMetrics(W, E) {
  const dips = {};
  for (const a of E.appearances) {
    const v = E.videos[a.videoId];
    if (v.retentionState !== 'ok') { dips[a.id] = null; continue; }
    const f = curveOf(W, v.id).t.fractions;
    const window = f.slice(a.start, a.end), surround = [...f.slice(Math.max(0, a.start - 5), a.start), ...f.slice(a.end, Math.min(f.length, a.end + 5))];
    if (!window.length || !surround.length) { dips[a.id] = null; continue; }
    const r = exec('thro.retentionDip', { window, surround, threshold: 0.05 });
    dips[a.id] = { ...r.out, receipt: r.receipt };
  }
  return { dips };
}

// Where does a video sit relative to a release? Day precision gives one offset; month precision gives a range.
export function classifyRelease(rel, publishedAt) {
  const month = rel.t.datePrecision === 'month';
  const r0 = month ? monthFirst(rel.t.date) : rel.t.date, r1 = month ? monthLast(rel.t.date) : rel.t.date;
  const hi = dayDiff(publishedAt, r0), lo = dayDiff(publishedAt, r1); // lo <= hi
  let cls;
  if (publishedAt < r0) cls = 'pre-release';
  else if (publishedAt <= r1 && month) cls = 'release-month';
  else cls = lo <= 30 ? 'release-window' : 'established';
  return { class: cls, precision: rel.t.datePrecision, offsetDays: month ? null : hi, offsetMin: lo, offsetMax: hi };
}
export function releaseMetrics(W, E, att) {
  const rows = {};
  for (const a of E.appearances) {
    const d = E.discs[a.discId];
    if (!d.releaseId) continue;
    const rel = W.get(d.releaseId), v = E.videos[a.videoId];
    const c = classifyRelease(rel, v.publishedAt);
    (rows[rel.id] ??= { releaseId: rel.id, moldId: d.moldId, date: rel.t.date, precision: rel.t.datePrecision, runLabel: rel.t.runLabel, videos: [] }).videos.push({ appearanceId: a.id, discId: a.discId, videoId: a.videoId, publishedAt: v.publishedAt, ...c, attention: att.attention[a.id].value });
  }
  const out = Object.values(rows).sort((x, y) => x.releaseId.localeCompare(y.releaseId));
  for (const r of out) {
    r.videos.sort((x, y) => x.offsetMin - y.offsetMin || x.appearanceId.localeCompare(y.appearanceId));
    const support = r.videos.filter((x) => x.class !== 'established');
    r.support = support;
    const pre = support.filter((x) => x.class === 'pre-release' && x.attention != null);
    r.preReleaseAttention = pre.length ? sum(pre.map((x) => x.attention)) : null;
    r.preReleaseAttentionValue = r.preReleaseAttention ? r.preReleaseAttention.out.value : 0;
    r.preReleaseAttention = r.preReleaseAttention ? r.preReleaseAttention.receipt : null;
  }
  return { releases: out };
}

export function clickMetrics(W, E, att) {
  const byLink = {}, byDisc = {}, perThousand = {};
  for (const l of Object.values(E.links)) byLink[l.id] = { linkId: l.id, code: l.code, discId: l.discId, videoId: l.videoId, total: 0, moment: 0, video: 0, unattributed: 0, hosts: {}, countries: {} };
  for (const c of E.clicks) {
    const r = byLink[c.linkId];
    r.total++; r[c.attribution.kind]++;
    r.hosts[c.refererHost] = (r.hosts[c.refererHost] ?? 0) + 1; r.countries[c.country] = (r.countries[c.country] ?? 0) + 1;
    const d = (byDisc[c.discId] ??= { discId: c.discId, total: 0, attributed: 0, unattributed: 0 });
    d.total++; c.attribution.kind === 'unattributed' ? d.unattributed++ : d.attributed++;
  }
  for (const l of Object.values(E.links)) {
    if (!l.videoId) continue;
    const key = `${l.discId}@${l.videoId}`, attn = att.byDiscVideo[key];
    const credited = E.clicks.filter((c) => c.linkId === l.id && c.attribution.kind !== 'unattributed').length;
    if (attn && attn.value > 0) { const r = exec('thro.ratio', { numerator: [credited], denominator: [attn.value], scale: 1000 }); perThousand[key] = { value: r.out.value, clicks: credited, attention: attn.value, receipt: r.receipt }; }
  }
  return { byLink, byDisc, perThousand, total: E.clicks.length };
}

export function exposureMetrics(W, E, att) {
  const rows = {};
  for (const v of Object.values(E.videos)) {
    const apps = E.appearances.filter((a) => a.videoId === v.id);
    const quarter = quarterOf(v.publishedAt);
    const groups = {};
    for (const a of apps) {
      const d = E.discs[a.discId];
      const kind = a.bucket === 'sponsor' ? 'sponsor' : 'other';
      (groups[`${kind}|${d.manufacturerId ?? 'unknown'}`] ??= { kind, manufacturerId: d.manufacturerId, apps: [] }).apps.push(a);
    }
    for (const [gk, g] of Object.entries(groups)) {
      const key = `${g.kind}|${g.manufacturerId ?? 'unknown'}|${quarter}`;
      const row = (rows[key] ??= { key, kind: g.kind, manufacturerId: g.manufacturerId, brand: g.manufacturerId ? W.get(g.manufacturerId).t.name : 'unknown brand', quarter, entries: [], unmeasuredVideoIds: [], reasons: [] });
      for (const a of g.apps) if (g.kind === 'other' && !row.reasons.includes(a.bucket)) row.reasons.push(a.bucket);
      if (v.retentionState !== 'ok') { if (!row.unmeasuredVideoIds.includes(v.id)) row.unmeasuredVideoIds.push(v.id); continue; }
      const intervals = mergeIntervals(g.apps.map((a) => [a.start, a.end]));
      const u = exec('thro.attentionSeconds', { retention: curveOf(W, v.id).t.fractions, intervals, views: v.views });
      const s = sum(g.apps.map((a) => att.attention[a.id].value));
      const minutes = exec('thro.ratio', { numerator: [u.out.value], denominator: [60], scale: 1 });
      row.entries.push({ videoId: v.id, creatorId: v.creatorId, appearanceIds: g.apps.map((a) => a.id), unionSeconds: u.out.seconds, unionAttention: u.out.value, sumAttention: s.out.value, minutes: minutes.out.value, receipt: minutes.receipt, unionReceipt: u.receipt });
    }
  }
  const out = Object.values(rows).sort((x, y) => x.key.localeCompare(y.key));
  for (const r of out) {
    const s = sum(r.entries.map((e) => e.minutes));
    r.minutes = s.out.value; r.receipt = s.receipt;
    r.creators = [...new Set(r.entries.map((e) => e.creatorId))].sort();
    r.byCreator = Object.fromEntries(r.creators.map((c) => [c, sum(r.entries.filter((e) => e.creatorId === c).map((e) => e.minutes)).out.value]));
    r.videoIds = r.entries.map((e) => e.videoId);
  }
  return { rows: out };
}
