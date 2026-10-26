// The creator insight panel as a plain view model. page.mjs only draws this; cases.test.mjs asserts on it, so "what the page should display" is executable.
import { fmt1, fmt2, fmtInt, mmss, signed, prettyDate, monthName } from './util.mjs';
import { discLabel } from './meaning.mjs';

const RELEASE_CHIP = { 'pre-release': 'PRE-RELEASE', 'release-window': 'RELEASE WINDOW', 'release-month': 'RELEASE MONTH', established: 'RELEASED' };
const SPONSOR_CHIP = { sponsor: 'SPONSOR', 'other-brand': 'OTHER BRAND', 'no-deal': 'NO DEAL', 'mold-not-covered': 'MOLD NOT COVERED', 'unknown-brand': 'BRAND UNKNOWN' };

export function attentionText(at) {
  if (at.value != null) return `${fmt1(at.value)} attention-seconds`;
  return at.state === 'awaiting-views' ? 'not measurable yet (no views)' : at.state === 'not-connected' ? 'unavailable (Studio not connected)' : 'unavailable';
}
export function releaseChip(row) {
  if (row.class === 'release-month') return { kind: 'release', code: row.class, text: `${RELEASE_CHIP[row.class]} (day unknown)` };
  if (row.precision === 'month') return { kind: 'release', code: row.class, text: row.class === 'pre-release' ? `${RELEASE_CHIP[row.class]} ${signed(row.offsetMax)} to ${signed(row.offsetMin)} d` : `${RELEASE_CHIP[row.class]} ${signed(row.offsetMin)} to ${signed(row.offsetMax)} d` };
  return { kind: 'release', code: row.class, text: `${RELEASE_CHIP[row.class]} ${signed(row.offsetDays)} d` };
}

export function creatorPanel(W, E, M, creatorId) {
  const creator = W.get(creatorId);
  const panel = { creator: { id: creatorId, name: creator.t.name, handle: creator.t.handle }, footnote: 'Clicks are clicks: not people, sales or revenue. Attention-seconds are viewers still watching x seconds a card was on screen.', videos: [], sponsorRows: [], releaseRows: [], moldRollups: [], notices: [] };
  const relIndex = {};
  for (const r of M.releases.releases) for (const v of r.videos) relIndex[v.appearanceId] = v;
  const videos = Object.values(E.videos).filter((v) => v.creatorId === creatorId).sort((x, y) => x.publishedAt.localeCompare(y.publishedAt) || x.id.localeCompare(y.id));
  for (const v of videos) {
    const bag = v.bagId ? W.get(v.bagId) : null;
    const deals = v.dealIds.map((id) => W.get(id));
    const pv = {
      id: v.id, title: v.title, format: v.format, orientation: v.orientation, publishedAt: v.publishedAt, duration: v.duration, views: v.views,
      viewsText: v.views === 0 ? 'no views yet' : `${fmtInt(v.views)} views`, retentionState: v.retentionState,
      bag: bag ? { id: bag.id, name: bag.t.name, discs: bag.t.discIds.map((d) => discLabel(E, d)) } : null,
      sponsorText: deals.length ? deals.map((d) => W.get(d.t.manufacturerId).t.name).join(' + ') : 'no active sponsor deal',
      discs: [], issues: [], clicks: [],
    };
    for (const a of E.appearances.filter((x) => x.videoId === v.id)) {
      const at = M.attention.attention[a.id], d = E.discs[a.discId], chips = [];
      if (relIndex[a.id]) chips.push(releaseChip(relIndex[a.id]));
      chips.push({ kind: 'sponsor', code: a.bucket, text: SPONSOR_CHIP[a.bucket] });
      const mode = a.hasCard ? (a.modes.includes('thrown') ? 'THROWN + SHOWN' : 'SHOWN ONLY') : a.modes.includes('thrown') ? 'THROWN, NO CARD' : 'TALKED, NO CARD';
      chips.push({ kind: 'mode', code: a.hasCard ? (a.modes.includes('thrown') ? 'thrown-shown' : 'shown-only') : a.modes.includes('thrown') ? 'thrown-no-card' : 'talked', text: mode });
      if (a.flags.includes('merged-overlapping-cards')) chips.push({ kind: 'flag', code: 'merged', text: `${a.placementIds.length} CARDS MERGED` });
      const dip = M.dips.dips[a.id];
      if (dip) chips.push({ kind: 'retention', code: dip.dipped ? 'dip' : 'steady', text: dip.dipped ? `RETENTION DIP −${fmt2(dip.drop)}` : 'RETENTION STEADY' });
      if (d.resolvedBy === 'provisional') chips.push({ kind: 'catalog', code: 'provisional', text: 'MOLD NOT IN CATALOG' });
      if (d.resolvedBy === 'normalized') chips.push({ kind: 'catalog', code: 'normalized', text: 'NAME MATCHED' });
      const clicks = E.clicks.filter((c) => c.attribution.appearanceIds.includes(a.id));
      pv.discs.push({
        appearanceId: a.id, discId: a.discId, label: discLabel(E, a.discId), brand: d.brand ?? 'brand unknown', start: a.start, end: a.end, seconds: a.seconds, span: `${mmss(a.start)}–${mmss(a.end)}`,
        attention: { value: at.value, text: attentionText(at), receipt: at.receipt }, chips, clicksCredited: clicks.length,
      });
    }
    for (const c of E.clicks.filter((x) => x.videoId === v.id || (x.videoId == null && E.discs[x.discId].creatorId === creatorId && v === videos[0]))) {
      pv.clicks.push({ clickId: c.id, code: E.links[c.linkId].code, at: c.at, host: c.refererHost, country: c.country, timestamp: c.videoTimestamp, kind: c.attribution.kind, reason: c.attribution.reason, text: c.attribution.kind === 'unattributed' ? `counted for ${E.links[c.linkId].code}, not credited to an appearance (${c.attribution.reason})` : c.attribution.kind === 'moment' ? `credited to the card on screen at ${mmss(c.videoTimestamp)}` : 'credited to the disc in this video' });
    }
    for (const i of E.issues.filter((x) => E.videos[W.get(x.instanceId).t.videoId].id === v.id)) pv.issues.push({ type: i.type, text: { 'clamped-placement': `card end ${i.from}s clamped to the video end ${i.to}s`, 'zero-length-placement': 'zero-length card ignored', 'inverted-placement': 'card ends before it starts: dropped', 'beyond-end-placement': 'card starts after the video ends: dropped' }[i.type] });
    panel.videos.push(pv);
  }
  const mine = (id) => E.creators.includes(id) && id === creatorId;
  for (const r of M.exposure.rows) {
    if (!r.creators.includes(creatorId) && !r.entries.length) continue;
    panel.sponsorRows.push({ kind: r.kind, brand: r.brand, quarter: r.quarter, minutes: r.minutes, minutesText: `${fmt2(r.minutes)} exposure minutes`, ownMinutes: r.byCreator[creatorId] ?? 0, creators: r.creators.length, reasons: r.reasons, sharedWith: r.creators.length - (r.creators.includes(creatorId) ? 1 : 0), unmeasured: r.unmeasuredVideoIds.length });
  }
  for (const r of M.releases.releases) {
    const rows = r.support.filter((s) => E.videos[s.videoId].creatorId === creatorId);
    if (rows.length) panel.releaseRows.push({ releaseId: r.releaseId, date: r.date, precision: r.precision, dateText: r.precision === 'month' ? monthName(r.date) : prettyDate(r.date), runLabel: r.runLabel, items: rows.map((s) => ({ videoId: s.videoId, title: E.videos[s.videoId].title, chip: releaseChip(s), offsetMin: s.offsetMin, offsetMax: s.offsetMax, offsetDays: s.offsetDays, disc: discLabel(E, s.discId) })) });
  }
  for (const [mid, m] of Object.entries(M.attention.byMold)) if (m.creators.includes(creatorId)) panel.moldRollups.push({ moldId: mid, moldName: E.discs[m.discIds[0]].moldName, ownAttention: m.perCreator[creatorId], ownText: `${fmt1(m.perCreator[creatorId])} attention-seconds`, discCount: m.discIds.filter((d) => E.discs[d].creatorId === creatorId).length, otherCreators: m.creators.length - 1 });
  const unattributed = E.clicks.filter((c) => E.discs[c.discId].creatorId === creatorId && c.attribution.kind === 'unattributed').length;
  if (unattributed) panel.notices.push(`${unattributed} click${unattributed === 1 ? '' : 's'} counted but not credited to an appearance.`);
  const cardless = E.appearances.filter((a) => E.videos[a.videoId].creatorId === creatorId && !a.hasCard).length;
  if (cardless) panel.notices.push(`${cardless} appearance${cardless === 1 ? '' : 's'} without a card: no link prompt was shown.`);
  return panel;
}
