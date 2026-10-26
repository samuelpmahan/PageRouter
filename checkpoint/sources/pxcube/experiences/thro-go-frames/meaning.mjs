// Facts are read off the linked data (never off a Case); sentences are templates over facts. What a result means for the creator or the sponsor is
// therefore produced by the enrichment, and a Case only asserts that the right sentence, with the right numbers, exists.
// Units: attention-seconds = viewers still watching x seconds a disc was on screen; viewer-minutes on screen = the same, over a sponsor's discs, / 60.
import { fmt2, fmtInt, fmtAtt, mmss, monthName, prettyDate, pct, plural, dayDiff } from './util.mjs';

export const discLabel = (E, discId) => {
  const d = E.discs[discId];
  return `${d.moldName} (${d.plastic}${d.runLabel ? `, ${d.runLabel}` : ''})`;
};
// Two creators can own the same mold in the same plastic, so anything that crosses creators names the owner too.
export const discOwnerLabel = (W, E, discId) => `${discLabel(E, discId)}, ${W.get(E.discs[discId].creatorId).t.name}`;
const A = (v) => `${fmtAtt(v)} attention-seconds`;
const VM = (v) => `${fmtAtt(v)} viewer-minutes on screen`;
const WHY = { 'other-brand': (n) => `${n.sponsors} is the active sponsor on ${n.day}`, 'no-deal': (n) => `no sponsor deal was active on ${n.day}`, 'mold-not-covered': (n) => `the active ${n.brand} deal does not cover ${n.mold}`, 'unknown-brand': () => 'its brand is not known' };

export function deriveFacts(W, E, M) {
  const facts = [];
  const push = (f) => facts.push(f);
  const vtitle = (id) => `“${E.videos[id].title}”`;
  const att = (id) => M.attention.attention[id];
  const relRow = (id) => { for (const r of M.releases.releases) for (const v of r.videos) if (v.appearanceId === id) return { r, v }; return null; };
  const cname = (id) => W.get(id).t.name;

  for (const a of E.appearances) {
    const v = E.videos[a.videoId], at = att(a.id), disc = discLabel(E, a.discId), base = { appearanceId: a.id, discId: a.discId, videoId: a.videoId, creatorId: v.creatorId };
    const onScreen = `${a.seconds} s on screen`;
    if (at.value != null) {
      push({ ...base, kind: 'attention', value: at.value, sentence: `${disc} got ${A(at.value)} in ${vtitle(v.id)}: ${fmtInt(v.views)} views, ${onScreen}, ${pct(at.meanRetention)} of viewers still watching on average.` });
      if (v.format === 'short') {
        const total = M.attention.byDisc[a.discId], f = total.byFormat;
        push({ ...base, kind: 'short', value: at.value, sentence: `This Short (vertical, ${v.duration} s) gave ${disc} ${A(at.value)}. Shorts are added into the disc's total of ${A(total.value)} and also reported apart: ${f.short ? A(f.short.value) : 'none'} from Shorts, ${f.long ? A(f.long.value) : 'none'} from long videos.` });
      }
    } else if (at.state === 'awaiting-views') push({ ...base, kind: 'awaiting-views', sentence: `${disc} appeared in ${vtitle(v.id)} for ${a.seconds} s but the video has no views yet: attention is not measurable yet, which is not the same as zero.` });
    else if (at.state === 'not-connected') push({ ...base, kind: 'not-connected', sentence: `YouTube Studio is not connected, so ${disc} in ${vtitle(v.id)} has no attention-seconds; its clicks are still counted.` });
    else if (at.state === 'no-curve') push({ ...base, kind: 'no-curve', sentence: `${vtitle(v.id)} has ${fmtInt(v.views)} views but no retention curve has been read yet, so ${disc} has no attention-seconds yet (not zero).` });
    const rr = relRow(a.id);
    if (rr) {
      const { v: row } = rr, d = E.discs[a.discId], RW = W.get(rr.r.releaseId).t.kind === 'reissue' ? 'reissue' : W.get(rr.r.releaseId).t.kind === 'new-run' ? 'new-run release' : 'release';
      const range = row.precision === 'month';
      if (row.class === 'pre-release') {
        const when = range ? `${-row.offsetMax} to ${-row.offsetMin} days before` : `${-row.offsetDays} day${row.offsetDays === -1 ? '' : 's'} before`;
        const relWord = range ? `${monthName(rr.r.date)} ${RW}` : RW;
        push({ ...base, kind: 'pre-release', offset: row.offsetDays, sentence: at.value != null
          ? `${disc} got ${A(at.value)} ${when} its ${relWord}: attention that arrived before the disc could be bought${d.brand ? ` from ${d.brand}` : ''}.`
          : `${disc} appeared ${when} its ${relWord}, but attention is not measurable yet.` });
      } else if (row.class === 'release-window') {
        const days = range ? `${row.offsetMin} to ${row.offsetMax}` : `${row.offsetDays}`;
        push({ ...base, kind: 'release-window', offset: row.offsetDays, sentence: `${disc} ${at.value != null ? `got ${A(at.value)} ` : 'appeared '}${days} day${row.offsetDays === 1 ? '' : 's'} after its ${RW}, inside its ${row.windowDays}-day release window${at.value != null ? '' : '; attention is not measurable yet'}.` });
      } else if (row.class === 'release-month') push({ ...base, kind: 'release-month', sentence: `${disc} ${at.value != null ? `got ${A(at.value)} ` : 'appeared '}in ${monthName(rr.r.date)}, the month of its ${RW}; the release day is unknown, so it counts as release support with the order inside the month undecided.` });
      else push({ ...base, kind: 'established', offset: row.offsetDays, sentence: `${disc} ${at.value != null ? `got ${A(at.value)} ` : 'appeared '}${range ? `${row.offsetMin} to ${row.offsetMax}` : row.offsetDays} days after its ${RW}, past its ${row.windowDays}-day release window: an established disc, not release support.` });
    }
    if (a.bucket !== 'sponsor') {
      const d = E.discs[a.discId], day = prettyDate(v.publishDay);
      const sponsors = v.dealIds.map((id) => W.get(W.get(id).t.manufacturerId).t.name).join(' and ');
      const why = WHY[a.bucket]({ day, sponsors, brand: d.brand, mold: d.moldName });
      push({ ...base, kind: 'other-brand', reason: a.bucket, sentence: `${d.brand ?? 'An unknown-brand'} ${disc} ${at.value != null ? `got ${A(at.value)}` : 'appeared'}, but ${why}: counted as other-brand attention, not sponsor exposure.` });
    }
    if (a.chain.includes('PreReleaseAppearance') && a.chain.includes('OtherBrandAppearance')) push({ ...base, kind: 'chained', sentence: `${disc} in ${vtitle(v.id)} was on screen before its release and from a brand that is not the creator's sponsor: the pre-release frame was replaced in turn by the other-brand frame, so it counts as release-timing attention for ${E.discs[a.discId].brand ?? 'its brand'} but never as sponsor exposure.` });
    const modes = a.modes.join('+');
    if (a.hasCard && !a.modes.includes('thrown')) push({ ...base, kind: 'shown-only', sentence: `The ${disc} card was on screen for ${a.seconds} s but the creator never marked the disc as thrown: shown, not thrown.` });
    if (!a.hasCard && a.modes.includes('thrown')) push({ ...base, kind: 'thrown-no-card', sentence: `${disc} was thrown for ${a.seconds} s with no card on screen (${a.evidence.includes('throw-log') ? 'from the throw log' : 'marked by the creator'})${at.value != null ? `, so its ${A(at.value)} reached viewers with no link prompt` : ''}.` });
    if (!a.hasCard && modes === 'talked') push({ ...base, kind: 'talked', sentence: `${disc} was only talked about for ${a.seconds} s with no card and no throw: it counts as an appearance, flagged cardless.` });
    if (a.flags.includes('merged-overlapping-cards')) push({ ...base, kind: 'merged-overlap', sentence: `${plural(a.placementIds.length, 'overlapping card')} for ${disc} were merged into one ${a.seconds} s appearance, so no second is counted twice.` });
    if (a.flags.includes('disc-not-in-bag-snapshot')) push({ ...base, kind: 'not-in-bag', sentence: `${disc} had a card in ${vtitle(v.id)} but is not in that video's bag snapshot: the bag record is missing a disc that was on screen.` });
    const dip = M.dips.dips[a.id];
    if (dip) push({ ...base, kind: dip.dipped ? 'dip' : 'steady', drop: dip.drop, sentence: dip.dipped
      ? `Retention fell from ${fmt2(dip.surroundMean)} to ${fmt2(dip.windowMean)} while the ${disc} card was up: viewers left during the card (a correlation, not proof the card caused it).`
      : `Retention held steady through the ${disc} card (${fmt2(dip.windowMean)} inside, ${fmt2(dip.surroundMean)} around it): the card did not coincide with viewers leaving.` });
  }
  for (const i of E.issues) {
    const p = W.get(i.instanceId), video = E.videos[p.t.videoId], disc = discLabel(E, p.t.discId), card = p.frame === 'CardPlacement', noun = card ? 'card' : 'mark';
    const base = { discId: p.t.discId, videoId: p.t.videoId, creatorId: video.creatorId, instanceId: i.instanceId };
    const kind = i.type.replace(/-(placement|mark)$/, '');
    if (kind === 'clamped') push({ ...base, kind: 'clamped', over: i.from - i.to, sentence: `The ${disc} ${noun} ran ${i.from - i.to} s past the end of ${vtitle(video.id)}; only the ${i.to - p.t.startSec} s inside the video count.` });
    if (kind === 'zero-length') push({ ...base, kind: 'zero-length', sentence: `A zero-length ${disc} ${noun} in ${vtitle(video.id)} was ignored: it adds no appearance and no attention, and it is listed as a data issue.` });
    if (kind === 'inverted') push({ ...base, kind: 'inverted', sentence: `A ${disc} ${noun} in ${vtitle(video.id)} ends (${p.t.endSec} s) before it starts (${p.t.startSec} s): dropped and listed as a data issue, not guessed at.` });
    if (kind === 'beyond-end') push({ ...base, kind: 'beyond-end', sentence: `A ${disc} ${noun} in ${vtitle(video.id)} starts at ${p.t.startSec} s, after the ${video.duration} s video has ended: dropped and listed as a data issue.` });
  }
  for (const d of Object.values(E.discs)) {
    if (d.resolvedBy === 'provisional') {
      const at = E.appearances.filter((a) => a.discId === d.id).map((a) => att(a.id).value).filter((x) => x != null).reduce((s, x) => s + x, 0);
      push({ kind: 'provisional-mold', discId: d.id, creatorId: d.creatorId, sentence: `“${d.typedName}” is not in the mold catalog: kept as a provisional mold with the brand unknown. Its ${A(at)} still count, but no sponsor or release can be attached until it is cataloged.` });
    }
    if (d.resolvedBy === 'normalized') push({ kind: 'normalized-name', discId: d.id, creatorId: d.creatorId, sentence: `The typed mold name “${d.typedName}” matched catalog mold ${d.moldName} by normalised spelling, so its release and sponsor links resolve.` });
  }
  for (const l of Object.values(E.links)) if (l.offBrand) push({ kind: 'off-brand-link', linkId: l.id, discId: l.discId, creatorId: l.creatorId, videoId: l.videoId, sentence: `Link ${l.code} for ${discLabel(E, l.discId)} goes to ${l.offBrand.actualHost}, not ${l.offBrand.expectedHost}: its ${plural(l.clickIds.length, 'click')} land on another brand's shop.` });
  for (const c of E.clicks) {
    const l = E.links[c.linkId], disc = discLabel(E, c.discId), at = c.attribution;
    const base = { clickId: c.id, discId: c.discId, videoId: c.videoId, creatorId: E.discs[c.discId].creatorId, linkId: l.id };
    if (at.kind === 'unattributed') {
      const why = { 'disc-not-in-video': `${disc} has no usable appearance in ${c.videoId ? vtitle(c.videoId) : 'that video'}`, 'no-video': 'the link is a bio link, not tied to any video', 'predates-publish': `the click is dated before ${c.videoId ? vtitle(c.videoId) : 'the video'} was published` }[at.reason];
      push({ ...base, kind: 'click-unattributed', reason: at.reason, sentence: `1 click was counted on ${l.placement} link ${l.code} but ${why}: counted for the link, credited to no appearance.` });
    } else if (at.kind === 'moment') {
      const a = E.appearances.find((x) => x.id === at.appearanceId);
      push({ ...base, kind: 'click-moment', sentence: `A click on the ${l.placement} link at ${mmss(c.videoTimestamp)} landed inside the ${disc} card (${mmss(a.start)}–${mmss(a.end)}): credited to that on-screen moment.` });
    } else if (c.videoTimestamp != null) push({ ...base, kind: 'click-video-level', sentence: `A click on the ${l.placement} link at ${mmss(c.videoTimestamp)} fell outside every ${disc} card: credited to the disc in the video as a whole, not to a moment.` });
    else push({ ...base, kind: 'click-credited', sentence: `1 click on the ${l.placement} link ${l.code} is credited to ${disc} in ${vtitle(c.videoId)} (clicks, not people, sales or revenue).` });
  }
  // sponsor rows (across creators): viewer-minutes on screen, null when nothing could be measured
  for (const r of M.exposure.rows) {
    const names = r.creators.map((c) => `${cname(c)} ${r.byCreator[c] == null ? 'not measurable' : fmtAtt(r.byCreator[c])}`).join(', ');
    const overlapSaved = r.entries.reduce((s, e) => s + (e.sumAttention - e.unionAttention), 0);
    const split = (r.byFormat.short != null && r.byFormat.long != null) ? ` (${fmtAtt(r.byFormat.short)} from Shorts, ${fmtAtt(r.byFormat.long)} from long videos)` : r.byFormat.short != null ? ' (all from Shorts)' : '';
    const base = { kind: r.kind === 'sponsor' ? 'sponsor-exposure' : 'other-brand-exposure', rowKey: r.key, manufacturerId: r.manufacturerId, quarter: r.quarter, creators: r.creators };
    if (r.state === 'unmeasurable') push({ ...base, value: null, sentence: `${r.brand} ${r.kind === 'sponsor' ? 'sponsor airtime' : 'discs'} in ${r.quarter} could not be measured: no view or retention data yet for ${plural(r.unmeasuredVideoIds.length, 'video')}. Viewer-minutes are unavailable, not zero.` });
    else if (r.kind === 'sponsor') push({ ...base, value: r.viewerMinutes, sentence: `${r.brand} earned ${VM(r.viewerMinutes)} in ${r.quarter}${r.creators.length > 1 ? ` across ${r.creators.length} creators (${names})` : ` from ${cname(r.creators[0])}`}${split}${r.state === 'partial' ? `; ${plural(r.unmeasuredVideoIds.length, 'video')} could not be measured yet and ${r.unmeasuredVideoIds.length === 1 ? 'is' : 'are'} left out, not counted as zero` : ''}${overlapSaved > 1e-9 ? `; overlapping cards were counted once` : ''}.` });
    else push({ ...base, value: r.viewerMinutes, sentence: `${r.brand} discs were on screen for ${VM(r.viewerMinutes)} in ${r.quarter} without being the creator's sponsor (${r.reasons.join(', ')})${r.creators.length > 1 ? `, across ${r.creators.length} creators` : ''}: other-brand airtime, not sponsor exposure${r.state === 'partial' ? '; some videos could not be measured yet' : ''}.` });
  }
  // bags
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
      push({ kind: 'bag-change', creatorId: cid, fromVideoId: p.id, videoId: q.id, added, removed, sentence: `The bag changed between ${vtitle(p.id)} and ${vtitle(q.id)}: ${added.map((d) => discLabel(E, d)).join(', ') || 'nothing'} added, ${removed.map((d) => discLabel(E, d)).join(', ') || 'nothing'} removed; each disc is credited only to the videos whose bag held it.` });
    }
  }
  for (const v of Object.values(E.videos)) {
    if (!v.bagId) continue;
    for (const did of bagDiscs(v.bagId)) if (!E.appearances.some((a) => a.videoId === v.id && a.discId === did)) push({ kind: 'bag-no-card', discId: did, videoId: v.id, creatorId: v.creatorId, sentence: `${discLabel(E, did)} was in the bag for ${vtitle(v.id)} but never had a card or a marked throw: being in the bag is not being on screen, so it has 0 appearances there.` });
  }
  for (const [did, a] of Object.entries(M.attention.byDisc)) if (a.videoIds.length > 1) push({ kind: 'multi-video', discId: did, creatorId: E.discs[did].creatorId, value: a.value, sentence: `${discLabel(E, did)} appears in ${a.videoIds.length} videos through its bags: ${A(a.value)} in total across them.` });
  const byMoldDiscs = {};
  for (const d of Object.values(E.discs)) if (d.moldId) (byMoldDiscs[`${d.creatorId}|${d.moldId}`] ??= []).push(d);
  for (const list of Object.values(byMoldDiscs)) if (list.length > 1) {
    const vals = list.map((d) => M.attention.byDisc[d.id]?.value ?? null);
    const tot = M.attention.byMold[list[0].moldId]?.perCreator[list[0].creatorId] ?? null;
    push({ kind: 'two-plastics', discIds: list.map((d) => d.id), creatorId: list[0].creatorId, sentence: `Two ${list[0].moldName} discs, a ${W.get(list[0].moldId).t.kind} (${list.map((d) => d.plastic + (d.runLabel ? `, ${d.runLabel}` : '')).join(' and ')}) are separate physical discs: ${vals.map((x) => (x == null ? 'not measurable' : fmtAtt(x))).join(' and ')} attention-seconds, ${tot == null ? 'not measurable' : fmtAtt(tot)} together for the mold.` });
  }
  for (const [mid, m] of Object.entries(M.attention.byMold)) if (m.creators.length > 1) {
    const brand = E.discs[m.discIds[0]].brand;
    push({ kind: 'cross-creator', moldId: mid, value: m.value, creators: m.creators, sentence: `${E.discs[m.discIds[0]].moldName} (a ${W.get(mid).t.kind}) appears with ${m.creators.length} creators: ${A(m.value)} combined (${m.creators.map((c) => `${cname(c)} ${fmtAtt(m.perCreator[c])}`).join(', ')}), which ${brand ?? 'the brand'} sees as one total in its Sponsor view while each creator sees only their own.` });
  }
  const deals = W.all('SponsorDeal').slice().sort((x, y) => x.t.start.localeCompare(y.t.start));
  for (let i = 1; i < deals.length; i++) {
    const q = deals[i], p = deals.slice(0, i).reverse().find((d) => d.t.creatorId === q.t.creatorId && d.t.manufacturerId !== q.t.manufacturerId && dayDiff(q.t.start, d.t.end) === 1);
    if (p) push({ kind: 'brand-switch', creatorId: q.t.creatorId, from: p.t.manufacturerId, to: q.t.manufacturerId, sentence: `${cname(q.t.creatorId)}'s sponsor switched from ${W.get(p.t.manufacturerId).t.name} to ${W.get(q.t.manufacturerId).t.name} on ${prettyDate(q.t.start)}: videos up to ${prettyDate(p.t.end)} count toward ${W.get(p.t.manufacturerId).t.name}, videos from ${prettyDate(q.t.start)} toward ${W.get(q.t.manufacturerId).t.name}, even inside one quarter.` });
  }
  for (const v of Object.values(E.videos).filter((x) => x.viewSnapshots.length > 1)) for (const a of E.appearances.filter((x) => x.videoId === v.id)) {
    const s = att(a.id).series;
    if (s && s.length > 1) push({ kind: 'views-growth', appearanceId: a.id, discId: a.discId, videoId: v.id, creatorId: v.creatorId, sentence: `Views grew ${s.map((x) => fmtInt(x.views)).join(' → ')} across snapshots, and ${discLabel(E, a.discId)}'s attention grew with them: ${s.map((x) => fmtAtt(x.value)).join(' → ')} attention-seconds.` });
  }
  return facts;
}

// All facts about one entity (an id of a disc, video, appearance, click, creator, link, manufacturer, mold or sponsor row).
export const factsAbout = (facts, id) => facts.filter((f) => [f.discId, f.videoId, f.appearanceId, f.clickId, f.creatorId, f.linkId, f.manufacturerId, f.moldId, f.rowKey].includes(id) || (f.discIds ?? []).includes(id));
