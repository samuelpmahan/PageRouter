// Facts are read off the linked data (not per case); sentences are templates over facts. The Case's expected meaning sentence is
// the sentence of its focus fact, so "what it means for the creator or sponsor" is produced from the enrichment, never hand-written per case.
import { fmt1, fmt2, fmtInt, mmss, monthName, prettyDate, pct, plural, dayDiff } from './util.mjs';

export const discLabel = (E, discId) => {
  const d = E.discs[discId];
  return `${d.moldName} (${d.plastic}${d.runLabel ? `, ${d.runLabel}` : ''})`;
};
const A = (v) => `${fmt1(v)} attention-seconds`;

export function deriveFacts(W, E, M) {
  const facts = [];
  const push = (f) => facts.push(f);
  const vtitle = (id) => `“${E.videos[id].title}”`;
  const att = (id) => M.attention.attention[id];
  const relRow = (id) => { for (const r of M.releases.releases) for (const v of r.videos) if (v.appearanceId === id) return { r, v }; return null; };

  for (const a of E.appearances) {
    const v = E.videos[a.videoId], at = att(a.id), disc = discLabel(E, a.discId), base = { appearanceId: a.id, discId: a.discId, videoId: a.videoId, creatorId: v.creatorId };
    if (at.value != null) {
      push({ ...base, kind: 'attention', value: at.value, sentence: `${disc} got ${A(at.value)} in ${vtitle(v.id)}: ${fmtInt(v.views)} views, ${a.seconds} s on screen, ${pct(at.meanRetention)} of viewers still watching on average.` });
      if (v.format === 'short') push({ ...base, kind: 'short', value: at.value, sentence: `This Short (${v.orientation}, ${v.duration} s) gave ${disc} ${A(at.value)}; Shorts are reported apart from long videos so a 40-second vertical clip is never averaged into long-form attention.` });
    } else if (at.state === 'awaiting-views') push({ ...base, kind: 'awaiting-views', sentence: `${disc} appeared in ${vtitle(v.id)} for ${a.seconds} s but the video has no views yet: attention is not measurable yet, which is not the same as zero.` });
    else if (at.state === 'not-connected') push({ ...base, kind: 'not-connected', sentence: `YouTube Studio is not connected, so ${disc} in ${vtitle(v.id)} has no attention-seconds; its clicks are still counted.` });
    const rr = relRow(a.id);
    if (rr) {
      const { v: row } = rr, d = E.discs[a.discId];
      if (row.class === 'pre-release') {
        const when = row.precision === 'month' ? `${-row.offsetMax} to ${-row.offsetMin} days before` : `${-row.offsetDays} days before`;
        const relWord = row.precision === 'month' ? `${monthName(rr.r.date)} release` : 'release';
        push({ ...base, kind: 'pre-release', offset: row.offsetDays, sentence: at.value != null
          ? `${disc} got ${A(at.value)} ${when} its ${relWord}: pre-release hype${d.brand ? ` ${d.brand} can see` : ''}.`
          : `${disc} appeared ${when} its ${relWord}, but attention is not measurable yet.` });
      } else if (row.class === 'release-window') push({ ...base, kind: 'release-window', offset: row.offsetDays, sentence: at.value != null ? `${disc} got ${A(at.value)} ${row.offsetDays} days after its release, inside the 30-day release window.` : `${disc} appeared ${row.offsetDays} days after its release, inside the 30-day release window; attention is not measurable yet.` });
      else if (row.class === 'release-month') push({ ...base, kind: 'release-month', sentence: `${disc} ${at.value != null ? `got ${A(at.value)} ` : 'appeared '}in ${monthName(rr.r.date)}, the month of its release; the release day is unknown, so it counts as release support with the order inside the month undecided.` });
    }
    if (a.bucket !== 'sponsor') {
      const d = E.discs[a.discId], day = prettyDate(v.publishedAt);
      const sponsorNames = v.dealIds.map((id) => W.get(W.get(id).t.manufacturerId).t.name);
      const why = { 'other-brand': `${sponsorNames.join(' and ')} is the active sponsor on ${day}`, 'no-deal': `no sponsor deal was active on ${day}`, 'mold-not-covered': `the active ${d.brand} deal does not cover ${d.moldName}`, 'unknown-brand': 'its brand is not known' }[a.bucket];
      push({ ...base, kind: 'other-brand', reason: a.bucket, sentence: `${d.brand ?? 'An unknown-brand'} ${disc} ${at.value != null ? `got ${A(at.value)}` : 'appeared'}, but ${why}: counted as other-brand attention, not sponsor exposure.` });
    }
    const modes = a.modes.join('+');
    if (a.hasCard && !a.modes.includes('thrown')) push({ ...base, kind: 'shown-only', sentence: `The ${disc} card was on screen for ${a.seconds} s but the creator never marked the disc as thrown: shown, not thrown.` });
    if (!a.hasCard && a.modes.includes('thrown')) push({ ...base, kind: 'thrown-no-card', sentence: `${disc} was thrown for ${a.seconds} s with no card on screen${at.value != null ? `, so its ${A(at.value)} reached viewers with no link prompt` : ''}.` });
    if (!a.hasCard && modes === 'talked') push({ ...base, kind: 'talked', sentence: `${disc} was only talked about for ${a.seconds} s with no card and no throw: it counts as an appearance, flagged cardless.` });
    if (a.flags.includes('merged-overlapping-cards')) push({ ...base, kind: 'merged-overlap', sentence: `${plural(a.placementIds.length, 'overlapping card')} for ${disc} were merged into one ${a.seconds} s appearance, so no second is counted twice.` });
    const dip = M.dips.dips[a.id];
    if (dip) push({ ...base, kind: dip.dipped ? 'dip' : 'steady', drop: dip.drop, sentence: dip.dipped
      ? `Retention fell from ${fmt2(dip.surroundMean)} to ${fmt2(dip.windowMean)} while the ${disc} card was up: viewers left during the card (a correlation, not proof the card caused it).`
      : `Retention held steady through the ${disc} card (${fmt2(dip.windowMean)} inside, ${fmt2(dip.surroundMean)} around it): the card did not coincide with viewers leaving.` });
  }
  for (const i of E.issues) {
    const p = W.get(i.instanceId), video = E.videos[p.t.videoId], disc = discLabel(E, p.t.discId), base = { discId: p.t.discId, videoId: p.t.videoId, creatorId: video.creatorId, instanceId: i.instanceId };
    if (i.type === 'clamped-placement') push({ ...base, kind: 'clamped', over: i.from - i.to, sentence: `The ${disc} card ran ${i.from - i.to} s past the end of ${vtitle(video.id)}; only the ${i.to - p.t.startSec} s inside the video count.` });
    if (i.type === 'zero-length-placement') push({ ...base, kind: 'zero-length', sentence: `A zero-length ${disc} card in ${vtitle(video.id)} was ignored: it adds no appearance and no attention, and it is listed as a data issue.` });
    if (i.type === 'inverted-placement') push({ ...base, kind: 'inverted', sentence: `A ${disc} card in ${vtitle(video.id)} ends (${p.t.endSec} s) before it starts (${p.t.startSec} s): dropped and listed as a data issue, not guessed at.` });
  }
  for (const d of Object.values(E.discs)) {
    if (d.resolvedBy === 'provisional') {
      const at = Object.values(E.appearances).filter((a) => a.discId === d.id).map((a) => att(a.id).value).filter((x) => x != null).reduce((s, x) => s + x, 0);
      push({ kind: 'provisional-mold', discId: d.id, creatorId: d.creatorId, sentence: `“${W.get(d.id).t.moldName}” is not in the mold catalog: kept as a provisional mold with the brand unknown. Its ${A(at)} still count, but no sponsor or release can be attached until it is cataloged.` });
    }
    if (d.resolvedBy === 'normalized') push({ kind: 'normalized-name', discId: d.id, creatorId: d.creatorId, sentence: `The typed mold name “${W.get(d.id).t.moldName}” matched catalog mold ${d.moldName} by normalised spelling, so its release and sponsor links resolve.` });
  }
  for (const c of E.clicks) {
    const l = E.links[c.linkId], disc = discLabel(E, c.discId), at = c.attribution;
    const base = { clickId: c.id, discId: c.discId, videoId: c.videoId, creatorId: E.discs[c.discId].creatorId };
    if (at.kind === 'unattributed') {
      const why = { 'disc-not-in-video': `${disc} has no usable appearance in ${c.videoId ? vtitle(c.videoId) : 'that video'}`, 'no-video': 'the link is a bio link, not tied to any video', 'predates-publish': `the click is dated before ${c.videoId ? vtitle(c.videoId) : 'the video'} was published` }[at.reason];
      push({ ...base, kind: 'click-unattributed', reason: at.reason, sentence: `1 click was counted on link ${l.code} but ${why}: counted for the link, credited to no appearance.` });
    } else if (at.kind === 'moment') {
      const a = E.appearances.find((x) => x.id === at.appearanceId);
      push({ ...base, kind: 'click-moment', sentence: `A click at ${mmss(c.videoTimestamp)} landed inside the ${disc} card (${mmss(a.start)}–${mmss(a.end)}): credited to that on-screen moment.` });
    } else if (c.videoTimestamp != null) push({ ...base, kind: 'click-video-level', sentence: `A click at ${mmss(c.videoTimestamp)} fell outside every ${disc} card: credited to the disc in the video as a whole, not to a moment.` });
    else push({ ...base, kind: 'click-credited', sentence: `1 click on ${l.code} is credited to ${disc} in ${vtitle(c.videoId)} (clicks, not people, sales or revenue).` });
  }
  // exposure rows
  for (const r of M.exposure.rows) {
    const overlapSaved = r.entries.reduce((s, e) => s + (e.sumAttention - e.unionAttention), 0);
    if (r.kind === 'sponsor') push({ kind: 'sponsor-exposure', manufacturerId: r.manufacturerId, quarter: r.quarter, minutes: r.minutes, creators: r.creators, sentence: `${r.brand} earned ${fmt2(r.minutes)} exposure minutes in ${r.quarter}${r.creators.length > 1 ? ` across ${r.creators.length} creators` : ''}${overlapSaved > 1e-9 ? `; overlapping cards were counted once (${fmt1(overlapSaved)} attention-seconds not double counted)` : ''}.` });
  }
  // bags
  const bagIds = [...new Set(Object.values(E.videos).map((v) => v.bagId).filter(Boolean))];
  const bagDiscs = (id) => W.get(id).t.discIds;
  const byCreator = {};
  for (const v of Object.values(E.videos)) if (v.bagId) (byCreator[v.creatorId] ??= []).push(v);
  for (const [cid, vids] of Object.entries(byCreator)) {
    vids.sort((x, y) => x.publishedAt.localeCompare(y.publishedAt));
    for (let i = 1; i < vids.length; i++) {
      const p = vids[i - 1], q = vids[i];
      if (p.bagId === q.bagId) continue;
      const before = bagDiscs(p.bagId), after = bagDiscs(q.bagId);
      const added = after.filter((d) => !before.includes(d)), removed = before.filter((d) => !after.includes(d));
      push({ kind: 'bag-change', creatorId: cid, added, removed, sentence: `The bag changed between ${vtitle(p.id)} and ${vtitle(q.id)}: ${added.map((d) => discLabel(E, d)).join(', ') || 'nothing'} added, ${removed.map((d) => discLabel(E, d)).join(', ') || 'nothing'} removed; each disc is credited only to the videos whose bag held it.` });
    }
  }
  for (const v of Object.values(E.videos)) {
    if (!v.bagId) continue;
    for (const did of bagDiscs(v.bagId)) if (!E.appearances.some((a) => a.videoId === v.id && a.discId === did)) push({ kind: 'bag-no-card', discId: did, videoId: v.id, creatorId: v.creatorId, sentence: `${discLabel(E, did)} was in the bag for ${vtitle(v.id)} but never had a card or a marked throw: being in the bag is not being on screen, so it has 0 appearances there.` });
  }
  for (const [did, a] of Object.entries(M.attention.byDisc)) if (a.videoIds.length > 1) push({ kind: 'multi-video', discId: did, creatorId: E.discs[did].creatorId, value: a.value, sentence: `${discLabel(E, did)} appears in ${a.videoIds.length} videos through the same bag: ${A(a.value)} in total across them.` });
  const byMoldDiscs = {};
  for (const d of Object.values(E.discs)) if (d.moldId) (byMoldDiscs[`${d.creatorId}|${d.moldId}`] ??= []).push(d);
  for (const list of Object.values(byMoldDiscs)) if (list.length > 1) {
    const vals = list.map((d) => M.attention.byDisc[d.id]?.value ?? 0);
    const tot = M.attention.byMold[list[0].moldId]?.perCreator[list[0].creatorId] ?? 0;
    push({ kind: 'two-plastics', discIds: list.map((d) => d.id), creatorId: list[0].creatorId, sentence: `Two ${list[0].moldName} discs (${list.map((d) => d.plastic + (d.runLabel ? `, ${d.runLabel}` : '')).join(' and ')}) are separate physical discs: ${vals.map(fmt1).join(' and ')} attention-seconds, ${fmt1(tot)} together for the mold.` });
  }
  for (const [mid, m] of Object.entries(M.attention.byMold)) if (m.creators.length > 1) {
    const brand = E.discs[m.discIds[0]].brand;
    push({ kind: 'cross-creator', moldId: mid, value: m.value, creators: m.creators, sentence: `${E.discs[m.discIds[0]].moldName} appears with ${m.creators.length} creators: ${A(m.value)} combined (${m.creators.map((c) => `${W.get(c).t.name} ${fmt1(m.perCreator[c])}`).join(', ')}), which ${brand ?? 'the brand'} sees as one sponsor total while each creator sees only their own.` });
  }
  const deals = W.all('SponsorDeal').slice().sort((x, y) => x.t.start.localeCompare(y.t.start));
  for (let i = 1; i < deals.length; i++) if (deals[i].t.creatorId === deals[i - 1].t.creatorId && deals[i].t.manufacturerId !== deals[i - 1].t.manufacturerId && dayDiff(deals[i].t.start, deals[i - 1].t.end) <= 1) {
    const p = deals[i - 1], q = deals[i];
    push({ kind: 'brand-switch', creatorId: p.t.creatorId, from: p.t.manufacturerId, to: q.t.manufacturerId, sentence: `Sponsor switched from ${W.get(p.t.manufacturerId).t.name} to ${W.get(q.t.manufacturerId).t.name} on ${prettyDate(q.t.start)}: videos before it count toward ${W.get(p.t.manufacturerId).t.name}, videos after it toward ${W.get(q.t.manufacturerId).t.name}, even inside one quarter.` });
  }
  const growth = Object.values(E.videos).filter((v) => v.viewSnapshots.length > 1);
  for (const v of growth) for (const a of E.appearances.filter((x) => x.videoId === v.id)) { const s = att(a.id).series; if (s && s.length > 1) push({ kind: 'views-growth', appearanceId: a.id, discId: a.discId, videoId: v.id, creatorId: v.creatorId, sentence: `Views grew ${s.map((x) => fmtInt(x.views)).join(' → ')} across snapshots, and ${discLabel(E, a.discId)}'s attention grew with them: ${s.map((x) => fmt1(x.value)).join(' → ')} attention-seconds.` }); }
  return facts;
}

export function focusSentence(facts, focus, keys, W) {
  if (!focus) return null;
  const subj = focus.subject ? keys[focus.subject] : null;
  const hit = facts.find((f) => f.kind === focus.kind && (!subj || f.discId === subj || f.videoId === subj || f.appearanceId === subj || f.clickId === subj || f.creatorId === subj || f.manufacturerId === subj || f.moldId === subj));
  return hit ?? null;
}
