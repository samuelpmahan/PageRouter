// Minskyan frames for thro-go. A frame is a stereotyped situation with terminals (slots). Each terminal has
//   type         what may fill it (a primitive, an enum, or a reference to another frame: that is how frames link into a frame system)
//   default      the assignment used when nothing else is said (the "ordinary" situation)
//   expect[]     expectations the filler should meet:  { id, text, test(value, instance, world), mismatch, violate(instance, world) }
//                mismatch = null          a HARD expectation: a violation is bad data, the generator must never produce one
//                mismatch = 'frame:X'     the violating instance is replaced by alternate frame X (built from its own terminals)
//                mismatch = 'transform:Y' / 'resolve:Z'   a named transformation is applied (minsky.mjs holds the handler table)
//                violate(instance, world) returns the departures that would break this expectation: [{ label, patches }]  (patches.mjs)
//   boundaries   (instance, world) -> [{ label, patches, expect }]  values at the edge of a rule (a deal's last day, a release day, a card's last second)
//   variants     (instance, world) -> [{ label, patches }]  further deliberate departures of this terminal (rewiring a reference, swapping a brand)
// An alternate frame INHERITS a parent frame (inherits: 'CardPlacement'): it has all the parent's terminals and expectations, plus its own.
// cases.mjs derives every Case from FRAMES x terminals x expectations x boundaries; nothing here is a Case.
import { clone, deepEqual, round4, addDays, dayDiff, monthFirst, monthLast, instantAt, localTime, localDay, hostOf, instantMs } from './util.mjs';
import { resolveMold, releaseOf, releaseInterval, sponsorBucket, publishDay, releaseState, latestViews, creatorOfVideo, placementsOf, givenAppearancesOf, curveOf } from './world.mjs';
import { set, remove, retimeVideo } from './patches.mjs';

export const BASE = Object.freeze({
  releaseDate: '2026-03-06', publishedAt: '2026-05-10T23:00:00Z', dealStart: '2026-01-01', dealEnd: '2026-12-31',
  durationSeconds: 420, views: 1000, snapshotAt: '2026-05-17', endLevel: 0.5,
});

const T = (type, def, expect = [], extra = {}) => ({ type, default: def, expect, ...extra });
const X = (id, text, test, mismatch = null, violate = null) => ({ id, text, test, mismatch, violate });
const V = (label, ...patches) => ({ label, patches });

export function curveValues(shape, endLevel, dip, bump, seconds) {
  const out = [];
  for (let s = 0; s < seconds; s++) {
    const u = s / seconds;
    let v;
    if (shape === 'flat') v = endLevel;
    else if (shape === 'early-drop') { const tau = Math.max(3, 0.06 * seconds); v = 1 - (1 - endLevel) * (0.65 * (1 - Math.exp(-s / tau)) + 0.35 * u); }
    else if (shape === 'exp-decay') v = endLevel + (1 - endLevel) * Math.exp(-3 * u);
    else if (shape === 'loop') v = 1 - 0.3 * u + (endLevel - 0.7) * u ** 3;
    else v = 1 - (1 - endLevel) * u;
    if (bump) v += bump.height * Math.max(0, 1 - Math.abs(s - bump.at) / bump.width);
    if (dip && s >= dip.from && s < dip.to) v *= 1 - dip.depth;
    if (shape !== 'loop') v = Math.min(1, v);
    out.push(round4(Math.max(0, v)));
  }
  return out;
}

// other instances of a frame, not counting the instance itself or (for an alternate) the instance it was selected from
const others = (W, frame, i) => W.all(frame).filter((x) => x.id !== i.id && x.id !== i.root);
const overlapsIv = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
const noun = (i) => (i.frame === 'CardPlacement' ? 'card' : 'mark');
const durationOf = (W, videoId) => W.get(videoId)?.t.durationSeconds ?? Infinity;
const sameCreator = (W, id) => W.get(id)?.t.creatorId;
const otherBrandHost = (W, host) => W.all('Manufacturer').map((m) => m.t.shopHost).find((h) => h !== host);
// Move a video so that its local publish day is `day`, keeping its local time of day.
const videoToDay = (W, video, day) => {
  const off = W.get(video.t.channelId).t.utcOffsetHours;
  return retimeVideo(W, video, instantAt(day, localTime(video.t.publishedAt, off), off));
};

export const FRAMES = {
  Creator: { role: 'input', description: 'A disc golf YouTube creator who uses thro (free) and thro-go (paid attribution).', terminals: {
    name: T('string', 'Maren Holt', [X('nameUnique', 'No two creators share a display name.', (v, i, W) => others(W, 'Creator', i).every((c) => c.t.name !== v))]),
    handle: T('string', '@marenholt', [X('handleUnique', 'No two creators share a handle.', (v, i, W) => others(W, 'Creator', i).every((c) => c.t.handle !== v))]),
  } },
  Channel: { role: 'input', description: 'The creator\'s YouTube channel: its time zone decides which day a video counts for, and Studio decides whether retention can be read.', terminals: {
    creatorId: T('ref:Creator', null),
    title: T('string', 'Holt Disc Golf', [X('titleUnique', 'No two channels share a title.', (v, i, W) => others(W, 'Channel', i).every((c) => c.t.title !== v))]),
    studioConnected: T('bool', true, [X('retentionAvailable', 'YouTube Studio is connected, so retention curves can be read.', (v) => v === true, 'frame:ClicksOnlyChannel',
      (i) => (i.t.studioConnected ? [V('YouTube Studio is disconnected from the channel', set(i.id, 'studioConnected', false))] : []))]),
    utcOffsetHours: T('int', -5, [X('plausibleOffset', 'The channel time zone is a real UTC offset (−12 to +14 hours).', (v) => v >= -12 && v <= 14)], {
      boundaries: (i, W) => {
        // flip the local day of the video closest to a local midnight, by moving the time zone one step the way that crosses midnight
        const vids = W.where('Video', 'channelId', i.id);
        let best = null;
        for (const v of vids) {
          const [h, m] = localTime(v.t.publishedAt, i.t.utcOffsetHours).split(':').map(Number), mins = h * 60 + m;
          const toNext = (1440 - mins) / 60, toPrev = mins / 60 + 1e-9;
          const cand = toNext <= toPrev ? { v, delta: Math.ceil(toNext), dir: 1 } : { v, delta: Math.ceil(toPrev), dir: -1 };
          if (!best || cand.delta < best.delta) best = cand;
        }
        if (!best || best.delta > 14) return [];
        const next = i.t.utcOffsetHours + best.dir * best.delta;
        if (next < -12 || next > 14) return [];
        return [{ label: `the channel time zone moves ${best.dir > 0 ? '+' : '−'}${best.delta} h, so “${best.v.t.title}” lands on another local day`, patches: [set(i.id, 'utcOffsetHours', next)], expect: { kind: 'localDay', videoId: best.v.id } }];
      },
    }),
  } },
  Manufacturer: { role: 'input', description: 'A disc brand.', terminals: {
    name: T('string', 'Halcyon Discs', [X('nameUnique', 'No two manufacturers share a name.', (v, i, W) => others(W, 'Manufacturer', i).every((m) => m.t.name !== v))]),
    shopHost: T('string', 'halcyondiscs.example', [X('shopHostUnique', 'Each manufacturer has its own shop host.', (v, i, W) => others(W, 'Manufacturer', i).every((m) => m.t.shopHost !== v))]),
  } },
  Mold: { role: 'input', description: 'A disc design in the catalog (not a physical disc).', terminals: {
    manufacturerId: T('ref:Manufacturer', null),
    name: T('string', 'Comet', [X('nameUnique', 'No two molds in the catalog share a name.', (v, i, W) => others(W, 'Mold', i).every((m) => m.t.name !== v))]),
    kind: T('enum:putter|midrange|fairway driver|distance driver', 'distance driver'),
  } },
  Release: { role: 'input', description: 'A dated release of a mold or of a new run (plastic/stamp) of it. The release window is a terminal: how many days after release still count as release support.', terminals: {
    moldId: T('ref:Mold', null),
    runLabel: T('string?', null, [X('runLabelMatchesKind', 'A new mold has no run label; a new run or reissue has one.', (v, i) => (i.t.kind === 'new-mold') === (v === null))]),
    date: T('date|month', '2026-03-06', [X('dateMatchesPrecision', 'The date is written to the precision the release declares (a day, or only a month).', (v, i) => (i.t.datePrecision === 'month' ? /^\d{4}-\d{2}$/.test(v) : /^\d{4}-\d{2}-\d{2}$/.test(v)))], {
      boundaries: (i, W) => {
        if (i.t.datePrecision !== 'day') return [];
        // the release date lands exactly on, a day after, or a day before the local publish day of a video that shows this release's disc
        const out = [];
        const vids = videosShowingRelease(W, i);
        if (!vids.length) return out;
        const v = vids[0], day = publishDay(W, v);
        out.push({ label: `the release date moves to the day “${v.t.title}” was published`, patches: [set(i.id, 'date', day)], expect: { kind: 'releaseOffset', videoId: v.id, releaseId: i.id, offset: 0 } });
        out.push({ label: `the release date moves one day after “${v.t.title}” was published`, patches: [set(i.id, 'date', addDays(day, 1))], expect: { kind: 'releaseOffset', videoId: v.id, releaseId: i.id, offset: -1 } });
        return out;
      },
    }),
    datePrecision: T('enum:day|month', 'day', [X('dayPrecision', 'The release date is known to the day.', (v) => v === 'day', 'transform:interval-offsets',
      (i) => (i.t.datePrecision === 'day' ? [V('the release is only known to its month', set(i.id, 'datePrecision', 'month'), set(i.id, 'date', i.t.date.slice(0, 7)))] : []))]),
    kind: T('enum:new-mold|new-run|reissue', 'new-mold', [], {
      variants: (i) => ['new-mold', 'new-run', 'reissue'].filter((k) => k !== i.t.kind).map((k) => V(`the release is a ${k} instead of a ${i.t.kind}`, set(i.id, 'kind', k), set(i.id, 'runLabel', k === 'new-mold' ? null : i.t.runLabel ?? 'Special Run'))),
    }),
    windowDays: T('int', 30, [X('windowIsPositive', 'The release window is between 1 and 120 days.', (v) => Number.isInteger(v) && v >= 1 && v <= 120)], {
      boundaries: (i, W) => {
        // set the window so an appearance sits exactly on its last day (inside) and one day outside it
        const rows = appearancesOfRelease(W, i).filter((a) => a.offset >= 0).sort((x, y) => x.offset - y.offset);
        const out = [];
        for (const a of rows) {
          if (a.offset >= 1 && a.offset !== i.t.windowDays) out.push({ label: `the release window is ${a.offset} days, so “${a.title}” (published ${a.offset} days after release) is on its last day`, patches: [set(i.id, 'windowDays', a.offset)], expect: { kind: 'releaseClass', videoId: a.videoId, discId: a.discId, releaseClass: 'release-window' } });
          if (a.offset >= 2 && a.offset - 1 !== i.t.windowDays) out.push({ label: `the release window is ${a.offset - 1} days, so “${a.title}” falls one day outside it`, patches: [set(i.id, 'windowDays', a.offset - 1)], expect: { kind: 'releaseClass', videoId: a.videoId, discId: a.discId, releaseClass: 'established' } });
        }
        return out.slice(0, 4);
      },
    }),
  } },
  SponsorDeal: { role: 'input', description: 'A sponsorship term between one creator and one manufacturer, covering all or some molds. Both end days count.', terminals: {
    creatorId: T('ref:Creator', null),
    manufacturerId: T('ref:Manufacturer', null, [], {
      variants: (i, W) => {
        const other = W.all('Manufacturer').find((m) => m.id !== i.t.manufacturerId && !W.where('SponsorDeal', 'creatorId', i.t.creatorId).some((d) => d.t.manufacturerId === m.id));
        return other ? [V(`the sponsor is ${other.t.name} instead of ${W.get(i.t.manufacturerId).t.name}`, set(i.id, 'manufacturerId', other.id), set(i.id, 'moldsCovered', 'all'))] : [];
      },
    }),
    start: T('date', '2026-01-01', [], { boundaries: (i, W) => dealEdges(W, i, 'start') }),
    end: T('date', '2026-12-31', [X('endsAfterStart', 'A deal ends on or after the day it starts.', (v, i) => v >= i.t.start)], { boundaries: (i, W) => dealEdges(W, i, 'end') }),
    moldsCovered: T('any', 'all', [X('coveredMoldsBelongToBrand', 'Every mold a deal covers is made by the deal\'s manufacturer.', (v, i, W) => v === 'all' || v.every((m) => W.get(m)?.t.manufacturerId === i.t.manufacturerId))], {
      variants: (i, W) => {
        const molds = W.where('Mold', 'manufacturerId', i.t.manufacturerId);
        if (i.t.moldsCovered === 'all' && molds.length > 1) return [V(`the deal covers only ${molds.slice(1).map((m) => m.t.name).join(' and ')}, not ${molds[0].t.name}`, set(i.id, 'moldsCovered', molds.slice(1).map((m) => m.id)))];
        if (i.t.moldsCovered !== 'all') return [V('the deal covers every mold of the brand', set(i.id, 'moldsCovered', 'all'))];
        return [];
      },
    }),
  } },
  Shelf: { role: 'input', description: 'Every disc a creator owns (each Disc points to its Shelf).', terminals: {
    creatorId: T('ref:Creator', null),
  } },
  Disc: { role: 'input', description: 'One physical disc on a creator\'s Shelf: a mold in a plastic, maybe from a particular run.', terminals: {
    creatorId: T('ref:Creator', null),
    shelfId: T('ref:Shelf', null, [X('onOwnersShelf', 'A disc sits on its owner\'s own Shelf.', (v, i, W) => W.get(v)?.t.creatorId === i.t.creatorId)]),
    moldId: T('ref:Mold?', null, [X('moldResolved', 'The disc\'s mold is in the catalog.', (v, i, W) => !!(v && W.get(v)), 'resolve:name-or-provisional', (i, W) => {
      const mold = W.get(i.t.moldId);
      if (!mold) return [];
      const spaced = `${mold.t.name.slice(0, 3)} ${mold.t.name.slice(3)}`.toLowerCase();
      return [
        V(`the creator typed “${spaced}” and the disc has no catalog mold (spelling resolves it)`, set(i.id, 'moldId', null), set(i.id, 'moldName', spaced)),
        V(`the creator typed “${mold.t.name} Prototype”, which is not in the catalog`, set(i.id, 'moldId', null), set(i.id, 'moldName', `${mold.t.name} Prototype`)),
      ];
    })], {
      variants: (i, W) => {
        const mold = W.get(i.t.moldId);
        const other = mold && W.all('Mold').find((m) => m.t.manufacturerId !== mold.t.manufacturerId && m.t.kind === mold.t.kind);
        return other ? [V(`the disc is a “${other.t.name}” by “${W.get(other.t.manufacturerId).t.name}” instead of a “${mold.t.name}”`, set(i.id, 'moldId', other.id), set(i.id, 'moldName', other.t.name), set(i.id, 'runLabel', null))] : [];
      },
    }),
    moldName: T('string', 'Comet'),
    plastic: T('string', 'Pro'),
    runLabel: T('string?', null, [], {
      variants: (i, W) => {
        const mold = resolveMold(W, i)?.mold;
        const runs = mold ? W.where('Release', 'moldId', mold.id).filter((r) => r.t.runLabel) : [];
        if (i.t.runLabel) return [V(`the disc is from the original run, not “${i.t.runLabel}”`, set(i.id, 'runLabel', null))];
        return runs.length ? [V(`the disc is from the “${runs[0].t.runLabel}” run`, set(i.id, 'runLabel', runs[0].t.runLabel))] : [];
      },
    }),
  } },
  Bag: { role: 'input', description: 'A snapshot of discs a creator carried, applied to one or more videos.', terminals: {
    creatorId: T('ref:Creator', null),
    name: T('string', 'Tournament bag', [X('nameUnique', 'No two bags share a name.', (v, i, W) => others(W, 'Bag', i).every((b) => b.t.name !== v))]),
    takenAt: T('date', '2026-05-01', [X('takenBeforeVideos', 'A bag is taken before the first video it is applied to.', (v, i, W) => i.t.appliedToVideoIds.every((id) => !W.get(id) || v <= publishDay(W, W.get(id))))]),
    discIds: T('refs:Disc', [], [X('onShelf', 'Every disc in a bag is on the creator\'s own Shelf.', (v, i, W) => v.every((d) => W.get(d)?.t.creatorId === i.t.creatorId))], {
      variants: (i, W) => {
        const out = [];
        const shown = new Set(i.t.appliedToVideoIds.flatMap((vid) => placementsOf(W, vid).map((p) => p.t.discId)));
        const carriedShown = i.t.discIds.find((d) => shown.has(d));
        if (carriedShown) out.push(V(`“${W.get(carriedShown).t.moldName}” is taken out of the bag snapshot although its card is on screen`, set(i.id, 'discIds', i.t.discIds.filter((d) => d !== carriedShown))));
        const spare = W.all('Disc').find((d) => d.t.creatorId === i.t.creatorId && !i.t.discIds.includes(d.id) && !shown.has(d.id));
        if (spare) out.push(V(`“${spare.t.moldName}” is added to the bag but never gets a card`, set(i.id, 'discIds', [...i.t.discIds, spare.id])));
        return out;
      },
    }),
    appliedToVideoIds: T('refs:Video', [], [
      X('videosAreTheCreators', 'A bag is applied only to its creator\'s own videos.', (v, i, W) => v.every((id) => creatorOfVideo(W, W.get(id))?.id === i.t.creatorId)),
      X('oneBagPerVideo', 'A video is covered by at most one bag.', (v, i, W) => v.every((id) => W.where('Bag', 'appliedToVideoIds', id).length === 1)),
    ], {
      variants: (i, W) => {
        const out = [];
        const sibling = W.where('Bag', 'creatorId', i.t.creatorId).find((b) => b.id !== i.id);
        if (i.t.appliedToVideoIds.length && sibling) {
          const vid = i.t.appliedToVideoIds[i.t.appliedToVideoIds.length - 1];
          out.push(V(`“${W.get(vid).t.title}” is covered by “${sibling.t.name}” instead of “${i.t.name}”`, set(i.id, 'appliedToVideoIds', i.t.appliedToVideoIds.filter((x) => x !== vid)), set(sibling.id, 'appliedToVideoIds', [...sibling.t.appliedToVideoIds, vid])));
        }
        if (i.t.appliedToVideoIds.length > 1) out.push(V(`“${W.get(i.t.appliedToVideoIds[0]).t.title}” is not covered by any bag`, set(i.id, 'appliedToVideoIds', i.t.appliedToVideoIds.slice(1))));
        return out;
      },
    }),
  } },
  Video: { role: 'input', description: 'A published YouTube video (long or Short) with view counts over time. A Short is vertical and under a minute.', terminals: {
    channelId: T('ref:Channel', null),
    title: T('string', 'Bag tour and a full round', [X('titleUnique', 'No two videos share a title.', (v, i, W) => others(W, 'Video', i).every((x) => x.t.title !== v))]),
    publishedAt: T('datetime', '2026-05-10T23:00:00Z', [], { boundaries: (i, W) => publishBoundaries(W, i) }),
    kind: T('enum:long|short', 'long', [], {
      variants: (i, W) => (i.t.kind === 'long'
        ? [V('the video is a Short (55 seconds, vertical)', set(i.id, 'kind', 'short'), set(i.id, 'durationSeconds', 55))]
        : [V('the video is a long video, not a Short', set(i.id, 'kind', 'long'))]),
    }),
    durationSeconds: T('int', 420, [X('shortUnderSixty', 'A Short is under 60 seconds.', (v, i) => i.t.kind === 'long' || v < 60), X('durationPositive', 'A video lasts at least one second.', (v) => v >= 1)], {
      boundaries: (i, W) => {
        const cards = placementsOf(W, i.id).filter((p) => p.t.endSec > p.t.startSec);
        if (!cards.length) return [];
        const last = cards.reduce((m, p) => (p.t.endSec > m.t.endSec ? p : m));
        const out = [];
        if (last.t.endSec - 1 > last.t.startSec && last.t.endSec - 1 !== i.t.durationSeconds) out.push({ label: `the video ends one second before its last card does (${last.t.endSec - 1} s)`, patches: [set(i.id, 'durationSeconds', last.t.endSec - 1)], expect: { kind: 'clampedSeconds', videoId: i.id, discId: last.t.discId } });
        return out;
      },
    }),
    viewSnapshots: T('array:object', [{ at: '2026-05-17', views: 1000 }], [
      X('hasViews', 'The video has at least one view.', (v) => v.length > 0 && v[v.length - 1].views > 0, 'frame:AwaitingViewsVideo',
        (i) => (latestViews(i) > 0 ? [V('the video has no views yet', set(i.id, 'viewSnapshots', i.t.viewSnapshots.map((s) => ({ at: s.at, views: 0 }))))] : [])),
      X('viewsNonDecreasing', 'Cumulative views never go down between snapshots.', (v) => v.every((s, k) => k === 0 || s.views >= v[k - 1].views)),
      X('snapshotsAfterPublish', 'No view snapshot is dated before the video was published.', (v, i, W) => v.every((s) => s.at >= publishDay(W, i))),
    ], {
      variants: (i) => {
        if (latestViews(i) === 0) return [];
        const snaps = i.t.viewSnapshots;
        const last = snaps[snaps.length - 1];
        return [V(`the latest snapshot shows ${last.views * 2} views instead of ${last.views}`, set(i.id, 'viewSnapshots', [...snaps.slice(0, -1), { at: last.at, views: last.views * 2 }]))];
      },
    }),
  } },
  RetentionCurve: { role: 'input', description: 'Audience retention from YouTube Studio: the fraction of viewers still watching at each second.', terminals: {
    videoId: T('ref:Video', null, [X('coversVideo', 'The curve has one point per second of the video.', (v, i, W) => i.t.seconds >= (W.get(v)?.t.durationSeconds ?? 0))]),
    seconds: T('int', 420),
    shape: T('enum:linear-decay|flat|early-drop|exp-decay|loop', 'linear-decay'),
    endLevel: T('number', 0.5, [], {
      variants: (i) => [
        V(`viewers leave faster: the curve ends at ${Math.round(i.t.endLevel * 60) / 100} instead of ${i.t.endLevel}`, set(i.id, 'endLevel', Math.round(i.t.endLevel * 60) / 100)),
        V(`viewers stay: the curve ends at 0.95 instead of ${i.t.endLevel}`, set(i.id, 'endLevel', 0.95)),
      ].filter((v) => v.patches[0].to !== i.t.endLevel),
    }),
    dip: T('object?', null, [], {
      variants: (i, W) => {
        if (i.t.dip) return [V('the retention dip is gone', set(i.id, 'dip', null))];
        const card = placementsOf(W, i.t.videoId).filter((p) => p.t.endSec > p.t.startSec).sort((a, b) => a.t.startSec - b.t.startSec)[0];
        return card ? [V(`viewers leave while the first card is up (seconds ${card.t.startSec} to ${card.t.endSec})`, set(i.id, 'dip', { from: card.t.startSec, to: Math.min(card.t.endSec, i.t.seconds), depth: 0.2 }))] : [];
      },
    }),
    bump: T('object?', null, [], {
      variants: (i, W) => {
        if (i.t.bump) return [V('the rewatch bump is gone', set(i.id, 'bump', null))];
        const card = placementsOf(W, i.t.videoId).filter((p) => p.t.endSec > p.t.startSec).sort((a, b) => a.t.startSec - b.t.startSec)[0];
        return card ? [V(`viewers rewatch the part where the first card is up (second ${card.t.startSec})`, set(i.id, 'bump', { at: card.t.startSec, height: 0.1, width: 20 }))] : [];
      },
    }),
    fractions: T('array:number', null, [
      X('unitInterval', 'Every point is between 0 and 1 (a Short that loops may rise to 1.5).', (v, i, W) => v.every((f) => f >= 0 && f <= (W.get(i.t.videoId)?.t.kind === 'short' ? 1.5 : 1))),
    ], { derive: (t) => curveValues(t.shape, t.endLevel, t.dip, t.bump, t.seconds) }),
  } },
  // The parent of a thro card and of a mark by the creator. Both are "this disc is on screen from second a to b", so they share the rules below
  // (published after release? under the sponsor? inside the video?) and the alternate frames those rules select.
  OnScreenDisc: { role: 'abstract', description: 'Any moment a disc is on screen in a video, from second a to second b (b is the first second it is no longer shown): the parent of a thro card and of a mark by the creator.', terminals: {
    videoId: T('ref:Video', null),
    discId: T('ref:Disc', null, [
      X('discOwnerPublishes', 'The disc on screen is owned by the channel\'s own creator.', (v, i, W) => W.get(v)?.t.creatorId === creatorOfVideo(W, W.get(i.t.videoId))?.id),
      X('releasedByPublish', 'The disc\'s mold was released by the day the video was published.', (v, i, W) => {
        const video = W.get(i.t.videoId), disc = W.get(v);
        return !video || !disc || !releaseState(W, disc, video);
      }, 'frame:PreReleaseAppearance', (i, W) => {
        const video = W.get(i.t.videoId), disc = W.get(i.t.discId), r = disc && resolveMold(W, disc), rel = r && releaseOf(W, disc, r.mold);
        if (!video || !rel || rel.t.datePrecision !== 'day' || publishDay(W, video) < rel.t.date) return [];
        return [V(`“${video.t.title}” moves to 12 days before the ${r.mold.t.name} release`, ...videoToDay(W, video, addDays(rel.t.date, -12)))];
      }),
      X('underActiveSponsor', 'The disc\'s brand is the creator\'s sponsor, with the mold covered, on the publish day.', (v, i, W) => {
        const video = W.get(i.t.videoId), disc = W.get(v), creator = video && creatorOfVideo(W, video), r = disc && resolveMold(W, disc);
        return !!creator && sponsorBucket(W, creator.id, publishDay(W, video), r?.mold ?? null).bucket === 'sponsor';
      }, 'frame:OtherBrandAppearance', (i, W) => {
        const video = W.get(i.t.videoId), disc = W.get(i.t.discId), creator = video && creatorOfVideo(W, video), r = disc && resolveMold(W, disc);
        if (!creator || !r || sponsorBucket(W, creator.id, publishDay(W, video), r.mold).bucket !== 'sponsor') return [];
        const deal = W.get(sponsorBucket(W, creator.id, publishDay(W, video), r.mold).dealId);
        return [V(`the ${W.get(deal.t.manufacturerId).t.name} deal ends the day before “${video.t.title}”`, set(deal.id, 'end', addDays(publishDay(W, video), -1)))];
      }),
    ]),
    startSec: T('int', 20, [
      X('startNonNegative', 'It starts at second 0 or later.', (v) => v >= 0),
      X('startInsideVideo', 'It starts inside the video.', (v, i, W) => v < durationOf(W, i.t.videoId), 'transform:drop-beyond-end', (i, W) => [V(`the ${noun(i)} starts after the video has ended`, set(i.id, 'startSec', durationOf(W, i.t.videoId)), set(i.id, 'endSec', durationOf(W, i.t.videoId) + 10))]),
    ], {
      boundaries: (i, W) => {
        const dur = durationOf(W, i.t.videoId), out = [];
        if (i.t.startSec !== 0) out.push({ label: `the ${noun(i)} starts at second 0`, patches: [set(i.id, 'startSec', 0)], expect: { kind: 'secondsOn', onScreenId: i.id, seconds: i.t.endSec } });
        if (dur - 1 > i.t.startSec && i.t.endSec <= dur) out.push({ label: `the ${noun(i)} starts at the video's last second (${dur - 1} s)`, patches: [set(i.id, 'startSec', dur - 1), set(i.id, 'endSec', dur)], expect: { kind: 'secondsOn', onScreenId: i.id, seconds: 1 } });
        return out;
      },
    }),
    endSec: T('int', 50, [
      X('notInverted', 'It ends at or after the second it starts.', (v, i) => v >= i.t.startSec, 'transform:drop-inverted', (i) => (i.t.startSec >= 1 ? [V(`the ${noun(i)} ends one second before it starts`, set(i.id, 'endSec', i.t.startSec - 1))] : [])),
      X('hasLength', 'It is on screen for more than zero seconds.', (v, i) => v !== i.t.startSec, 'transform:drop-zero-length', (i) => [V(`the ${noun(i)} has zero length`, set(i.id, 'endSec', i.t.startSec))]),
      X('withinVideo', 'It ends before the video does.', (v, i, W) => v <= durationOf(W, i.t.videoId), 'transform:clamp-to-video-end', (i, W) => [V(`the ${noun(i)} runs 15 seconds past the end of the video`, set(i.id, 'endSec', durationOf(W, i.t.videoId) + 15))]),
    ], {
      boundaries: (i, W) => {
        const dur = durationOf(W, i.t.videoId), out = [];
        if (i.t.endSec !== dur && i.t.startSec < dur) out.push({ label: `the ${noun(i)} ends exactly when the video does`, patches: [set(i.id, 'endSec', dur)], expect: { kind: 'secondsOn', onScreenId: i.id, seconds: dur - i.t.startSec } });
        if (i.t.endSec !== dur + 1) out.push({ label: `the ${noun(i)} ends one second after the video does`, patches: [set(i.id, 'endSec', dur + 1)], expect: { kind: 'secondsOn', onScreenId: i.id, seconds: dur - i.t.startSec } });
        if (i.t.endSec !== i.t.startSec + 1) out.push({ label: `the ${noun(i)} is on screen for exactly one second`, patches: [set(i.id, 'endSec', i.t.startSec + 1)], expect: { kind: 'secondsOn', onScreenId: i.id, seconds: 1 } });
        return out;
      },
    }),
  } },
  CardPlacement: { role: 'input', inherits: 'OnScreenDisc', description: 'A thro disc card on screen in a video, from second a to second b.', terminals: {
    discId: T('ref:Disc', null, [
      X('confirmedThrown', 'The creator also marked the disc as thrown while the card was up.', (v, i, W) => givenAppearancesOf(W, i.t.videoId, v).some((a) => a.t.mode === 'thrown' && overlapsIv(a.t.startSec, a.t.endSec, i.t.startSec, i.t.endSec)), 'frame:ShownOnlyCard', (i, W) => {
        const marks = givenAppearancesOf(W, i.t.videoId, i.t.discId).filter((a) => a.t.mode === 'thrown' && overlapsIv(a.t.startSec, a.t.endSec, i.t.startSec, i.t.endSec));
        return marks.length ? [V('the creator never marks the disc as thrown', ...marks.flatMap((m) => [set(m.id, 'mode', 'talked'), set(m.id, 'evidence', 'creator-marked')]))] : [];
      }),
    ]),
  } },
  Appearance: { role: 'input', inherits: 'OnScreenDisc', description: 'The atom: this disc, in this video, from second a to b, and how we know (a throw logged or marked by the creator, or a mention).', terminals: {
    discId: T('ref:Disc', null, [X('hasCard', 'A thro card was on screen for the disc over this interval.', (v, i, W) => placementsOf(W, i.t.videoId, v).some((p) => overlapsIv(p.t.startSec, p.t.endSec, i.t.startSec, i.t.endSec)), 'frame:CardlessAppearance', (i, W) => {
      const cards = placementsOf(W, i.t.videoId, i.t.discId).filter((p) => overlapsIv(p.t.startSec, p.t.endSec, i.t.startSec, i.t.endSec));
      return cards.length ? [V('the card is removed, so no link prompt was shown', ...cards.map((c) => remove(c.id)))] : [];
    })]),
    mode: T('enum:thrown|shown|talked', 'thrown'),
    evidence: T('enum:throw-log|creator-marked', 'throw-log', [X('evidenceMatchesMode', 'A mention can only be marked by the creator; a throw may be logged or marked.', (v, i) => i.t.mode !== 'talked' || v === 'creator-marked')]),
  } },
  Link: { role: 'input', description: 'A per-disc link the creator owns, placed in a video description, pinned comment, YouTube card, or bio. The destination is the disc\'s own brand shop.', terminals: {
    creatorId: T('ref:Creator', null),
    code: T('string', 'comet-holt', [X('codeUnique', 'No two links share a code.', (v, i, W) => others(W, 'Link', i).every((l) => l.t.code !== v))]),
    discId: T('ref:Disc', null, [X('discBelongsToCreator', 'The link\'s disc is on the same creator\'s Shelf.', (v, i, W) => W.get(v)?.t.creatorId === i.t.creatorId)], {
      variants: (i, W) => {
        const other = W.all('Disc').find((d) => d.t.creatorId === i.t.creatorId && d.id !== i.t.discId && !placementsOf(W, i.t.videoId, d.id).length && !givenAppearancesOf(W, i.t.videoId, d.id).length);
        return i.t.videoId && other ? [V(`the link now points at “${other.t.moldName}”, which never appears in that video`, set(i.id, 'discId', other.id))] : [];
      },
    }),
    destination: T('string', 'https://halcyondiscs.example/shop/comet', [X('destinationMatchesBrand', 'The link goes to the shop of the disc\'s own brand.', (v, i, W) => {
      const disc = W.get(i.t.discId), r = disc && resolveMold(W, disc), brand = r && W.get(r.mold.t.manufacturerId);
      return !brand || hostOf(v) === brand.t.shopHost;
    }, 'frame:OffBrandLink', (i, W) => {
      const disc = W.get(i.t.discId), r = disc && resolveMold(W, disc), brand = r && W.get(r.mold.t.manufacturerId);
      const host = brand && otherBrandHost(W, brand.t.shopHost);
      return brand && host && hostOf(i.t.destination) === brand.t.shopHost ? [V(`the link goes to “${host}”, not “${brand.t.shopHost}”`, set(i.id, 'destination', i.t.destination.replace(brand.t.shopHost, host)))] : [];
    })]),
    placement: T('enum:description|pinned-comment|card|bio', 'description', [X('bioHasNoVideo', 'A bio link belongs to the creator, any other placement belongs to one video.', (v, i) => (v === 'bio') === (i.t.videoId === null))], {
      variants: (i, W) => {
        const clicks = W.where('Click', 'linkId', i.id);
        const noStamp = clicks.filter((c) => c.t.videoTimestamp != null).map((c) => set(c.id, 'videoTimestamp', null));
        if (i.t.placement === 'bio') return [];
        const out = [];
        if (i.t.placement === 'card') out.push(V('the link sits in the description, not a YouTube card', set(i.id, 'placement', 'description'), ...noStamp));
        else out.push(V(`the link sits in a YouTube card, not the ${i.t.placement.replace('-', ' ')}`, set(i.id, 'placement', 'card')));
        out.push(V('the link moves to the channel bio, so it belongs to no single video', set(i.id, 'placement', 'bio'), set(i.id, 'videoId', null), ...noStamp));
        return out;
      },
    }),
    videoId: T('ref:Video?', null, [X('linkVideoIsCreators', 'A link\'s video is the same creator\'s video.', (v, i, W) => v === null || creatorOfVideo(W, W.get(v))?.id === i.t.creatorId)]),
  } },
  Click: { role: 'input', description: 'One recorded click on a link. A click is a click: not a person, a sale or revenue.', terminals: {
    linkId: T('ref:Link', null, [
      X('linkIsVideoScoped', 'The link belongs to one video.', (v, i, W) => W.get(v)?.t.videoId != null, 'frame:UnattributedClick', (i, W) => {
        const link = W.get(i.t.linkId), bio = link && W.where('Link', 'creatorId', link.t.creatorId).find((l) => l.t.placement === 'bio');
        return bio && bio.id !== link.id ? [V(`the click is on the channel-bio link “${bio.t.code}”, which belongs to no video`, set(i.id, 'linkId', bio.id), set(i.id, 'videoTimestamp', null))] : [];
      }),
      X('discAppearedInVideo', 'The link\'s disc appeared in the link\'s video.', (v, i, W) => {
        const link = W.get(v);
        if (!link || link.t.videoId == null) return true;
        return placementsOf(W, link.t.videoId, link.t.discId).length + givenAppearancesOf(W, link.t.videoId, link.t.discId).length > 0;
      }, 'frame:UnattributedClick', (i, W) => {
        const link = W.get(i.t.linkId);
        if (!link || link.t.videoId == null) return [];
        const marks = [...placementsOf(W, link.t.videoId, link.t.discId), ...givenAppearancesOf(W, link.t.videoId, link.t.discId)];
        return marks.length ? [V(`“${W.get(link.t.discId).t.moldName}” is cut from the video, but its link and clicks remain`, ...marks.map((m) => remove(m.id)))] : [];
      }),
    ]),
    at: T('datetime', '2026-05-12T18:04:00Z', [X('notBeforePublish', 'The click is not earlier than the moment the video was published.', (v, i, W) => {
      const link = W.get(i.t.linkId), video = link && link.t.videoId && W.get(link.t.videoId);
      return !video || instantMs(v) >= instantMs(video.t.publishedAt);
    }, 'frame:UnattributedClick', (i, W) => {
      const link = W.get(i.t.linkId), video = link && link.t.videoId && W.get(link.t.videoId);
      return video && instantMs(i.t.at) >= instantMs(video.t.publishedAt) ? [V('the click is dated three days before the video was published', set(i.id, 'at', new Date(instantMs(video.t.publishedAt) - 3 * 864e5).toISOString().replace('.000Z', 'Z')))] : [];
    })], {
      boundaries: (i, W) => {
        const link = W.get(i.t.linkId), video = link && link.t.videoId && W.get(link.t.videoId);
        if (!video) return [];
        const p = instantMs(video.t.publishedAt), iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
        return [
          { label: 'the click happens one second before the video is published', patches: [set(i.id, 'at', iso(p - 1000))], expect: { kind: 'clickCredit', clickId: i.id, credited: false, reason: 'predates-publish' } },
          { label: 'the click happens in the very second the video is published', patches: [set(i.id, 'at', iso(p))], expect: { kind: 'clickCredit', clickId: i.id, credited: true } },
        ];
      },
    }),
    refererHost: T('string', 'youtube.com', [], { variants: (i) => [V(i.t.refererHost === 'instagram.com' ? 'the click came from reddit.com' : 'the click came from instagram.com', set(i.id, 'refererHost', i.t.refererHost === 'instagram.com' ? 'reddit.com' : 'instagram.com'))] }),
    country: T('string', 'US', [], { variants: (i) => [V(i.t.country === 'DE' ? 'the click came from Brazil' : 'the click came from Germany', set(i.id, 'country', i.t.country === 'DE' ? 'BR' : 'DE'))] }),
    videoTimestamp: T('int?', null, [
      X('timestampFromCardsOnly', 'Only a click on a YouTube card link carries a video timestamp.', (v, i, W) => v === null || W.get(i.t.linkId)?.t.placement === 'card'),
      X('timestampInsideVideo', 'A video timestamp is a second inside the video.', (v, i, W) => {
        const link = W.get(i.t.linkId);
        return v === null || !link?.t.videoId || (v >= 0 && v < durationOf(W, link.t.videoId));
      }),
      X('insidePlacement', 'A click carrying a video timestamp falls inside a card placement of that disc.', (v, i, W) => {
        const link = W.get(i.t.linkId);
        if (v == null || !link || link.t.videoId == null) return true;
        return placementsOf(W, link.t.videoId, link.t.discId).some((p) => p.t.startSec <= v && v < p.t.endSec);
      }, 'transform:attribute-to-video', (i, W) => {
        const link = W.get(i.t.linkId);
        if (i.t.videoTimestamp == null || !link || !link.t.videoId) return [];
        const dur = durationOf(W, link.t.videoId), cards = placementsOf(W, link.t.videoId, link.t.discId);
        const free = [...Array(dur).keys()].find((s) => !cards.some((p) => p.t.startSec <= s && s < p.t.endSec));
        return free === undefined ? [] : [V(`the click is stamped at second ${free}, when no card of this disc is up`, set(i.id, 'videoTimestamp', free))];
      }),
    ], {
      boundaries: (i, W) => {
        const link = W.get(i.t.linkId);
        if (!link || link.t.placement !== 'card' || !link.t.videoId) return [];
        const cards = placementsOf(W, link.t.videoId, link.t.discId).filter((p) => p.t.endSec > p.t.startSec).sort((a, b) => a.t.startSec - b.t.startSec);
        if (!cards.length) return [];
        const c = cards[0], out = [];
        const ev = (label, s, moment) => out.push({ label, patches: [set(i.id, 'videoTimestamp', s)], expect: { kind: 'clickCredit', clickId: i.id, credited: true, moment } });
        if (c.t.endSec - 1 !== i.t.videoTimestamp) ev(`the click is stamped at the card's last second (${c.t.endSec - 1} s)`, c.t.endSec - 1, true);
        if (c.t.endSec !== i.t.videoTimestamp) ev(`the click is stamped at the second the card goes away (${c.t.endSec} s)`, c.t.endSec, false);
        if (c.t.startSec !== i.t.videoTimestamp) ev(`the click is stamped at the card's first second (${c.t.startSec} s)`, c.t.startSec, true);
        if (c.t.startSec >= 1) ev(`the click is stamped one second before the card appears (${c.t.startSec - 1} s)`, c.t.startSec - 1, false);
        return out;
      },
    }),
  } },

  // Alternate frames. Each INHERITS a parent frame: all its terminals and expectations come with it. The enrichment (minsky.mjs) builds an alternate
  // from the violating instance's own terminals, fills the alternate's own terminals, and then evaluates the alternate's expectations in turn (a chain).
  ProvisionalMoldDisc: { role: 'alternate', inherits: 'Disc', description: 'A disc whose mold is not in the catalog: kept as a placeholder mold so the disc still links to something; brand and release stay unknown.', terminals: {
    brandKnown: T('bool', false, [X('noBrandNoRelease', 'Without a brand no release or sponsor can be attached.', (v) => v === false)], { fill: () => false }),
  } },
  PreReleaseAppearance: { role: 'alternate', inherits: 'OnScreenDisc', description: 'A disc on screen before (or possibly before) its mold\'s release day: attention that came before the disc could be bought.', terminals: {
    releaseId: T('ref:Release', null, [], { fill: (from, W) => releaseState(W, W.get(from.t.discId), W.get(from.t.videoId)).releaseId }),
    certainty: T('enum:certain|possible', 'certain', [X('certaintyMatchesRange', 'A pre-release card is certain exactly when even the latest possible release day is after the video.', (v, i) => (v === 'certain') === (i.t.daysBeforeMin > 0))], { fill: (from, W) => releaseState(W, W.get(from.t.discId), W.get(from.t.videoId)).certainty }),
    daysBeforeMin: T('int', 0, [X('rangeOrdered', 'The nearest possible release day is not after the farthest.', (v, i) => v <= i.t.daysBeforeMax)], { fill: (from, W) => releaseState(W, W.get(from.t.discId), W.get(from.t.videoId)).daysBeforeMin }),
    daysBeforeMax: T('int', 0, [], { fill: (from, W) => releaseState(W, W.get(from.t.discId), W.get(from.t.videoId)).daysBeforeMax }),
  } },
  OtherBrandAppearance: { role: 'alternate', inherits: 'OnScreenDisc', description: 'A disc on screen whose brand is not the creator\'s active sponsor (or whose mold the deal does not cover): counted, but not as sponsor exposure.', terminals: {
    reason: T('enum:no-deal|other-brand|mold-not-covered|unknown-brand', 'other-brand', [X('reasonIsNotSponsor', 'An other-brand appearance is never under the active sponsor.', (v) => v !== 'sponsor')], { fill: (from, W) => {
      const video = W.get(from.t.videoId), disc = W.get(from.t.discId);
      return sponsorBucket(W, creatorOfVideo(W, video).id, publishDay(W, video), resolveMold(W, disc)?.mold ?? null).bucket;
    } }),
    manufacturerId: T('ref:Manufacturer?', null, [], { fill: (from, W) => resolveMold(W, W.get(from.t.discId))?.mold.t.manufacturerId ?? null }),
  } },
  ShownOnlyCard: { role: 'alternate', inherits: 'CardPlacement', description: 'A card was on screen but the creator never marked the disc as thrown: shown, not thrown.', terminals: {
    thrownMarks: T('int', 0, [X('noThrownMark', 'A shown-only card has no thrown mark for its disc over its seconds.', (v) => v === 0)], { fill: (from, W) => W.where('Appearance', 'videoId', from.t.videoId).filter((m) => m.t.discId === from.t.discId && m.t.mode === 'thrown' && m.t.startSec < from.t.endSec && from.t.startSec < m.t.endSec).length }),
  } },
  CardlessAppearance: { role: 'alternate', inherits: 'Appearance', description: 'The disc was in the video (thrown or mentioned) but no thro card was up, so no link prompt was shown.', terminals: {
    overlappingCards: T('int', 0, [X('noCardUp', 'No thro card of the disc is up during a cardless appearance.', (v) => v === 0)], { fill: (from, W) => W.where('CardPlacement', 'videoId', from.t.videoId).filter((p) => p.t.discId === from.t.discId && p.t.startSec < from.t.endSec && from.t.startSec < p.t.endSec).length }),
  } },
  AwaitingViewsVideo: { role: 'alternate', inherits: 'Video', description: 'A published video with no views yet: attention is "not measurable yet", not zero.', terminals: {
    viewsSoFar: T('int', 0, [X('zeroViewsSoFar', 'An awaiting-views video has no views yet.', (v) => v === 0)], { fill: (from) => latestViews(from) }),
  } },
  ClicksOnlyChannel: { role: 'alternate', inherits: 'Channel', description: 'A channel without YouTube Studio: clicks are counted, attention-seconds are not available.', terminals: {
    attentionAvailable: T('bool', false, [X('noAttentionWithoutStudio', 'Without YouTube Studio no attention-seconds are available.', (v) => v === false)], { fill: () => false }),
  } },
  UnattributedClick: { role: 'alternate', inherits: 'Click', description: 'A click counted for its link and disc but not credited to any appearance.', terminals: {
    reason: T('enum:no-video|disc-not-in-video|predates-publish', 'disc-not-in-video', [X('reasonIsTrue', 'The reason an unattributed click gives is true of the world: no video on the link, a video the disc never usefully appears in, or a click before the publish instant.', (v, i, W) => {
      const link = W.get(i.t.linkId), video = link?.t.videoId ? W.get(link.t.videoId) : null;
      if (v === 'no-video') return !video;
      if (!video) return false;
      if (v === 'predates-publish') return instantMs(i.t.at) < instantMs(video.t.publishedAt);
      const usable = (p) => p.t.endSec > p.t.startSec && p.t.startSec < video.t.durationSeconds && p.t.endSec >= p.t.startSec;
      return ![...placementsOf(W, video.id, link.t.discId), ...givenAppearancesOf(W, video.id, link.t.discId)].some(usable);
    })], { fill: (from, W, ctx) => ({ linkIsVideoScoped: 'no-video', discAppearedInVideo: 'disc-not-in-video', notBeforePublish: 'predates-publish' })[ctx.vias[0]] }),
  } },
  OffBrandLink: { role: 'alternate', inherits: 'Link', description: 'A link whose destination is not the shop of the disc\'s brand: the click lands on another brand.', terminals: {
    expectedHost: T('string', '', [X('hostsDiffer', 'An off-brand link\'s actual host is not the shop of the disc\'s brand.', (v, i) => v !== i.t.actualHost)], { fill: (from, W) => W.get(resolveMold(W, W.get(from.t.discId)).mold.t.manufacturerId).t.shopHost }),
    actualHost: T('string', '', [], { fill: (from) => hostOf(from.t.destination) }),
  } },
};

// ---- helpers the boundary generators above use (they only read the world) ----
function videosShowingRelease(W, rel) {
  const out = [];
  for (const d of W.all('Disc')) {
    const r = resolveMold(W, d);
    if (!r || releaseOf(W, d, r.mold)?.id !== rel.id) continue;
    for (const p of W.where('CardPlacement', 'discId', d.id)) { const v = W.get(p.t.videoId); if (v && !out.includes(v)) out.push(v); }
  }
  return out.sort((a, b) => a.t.publishedAt.localeCompare(b.t.publishedAt));
}
function appearancesOfRelease(W, rel) {
  const rows = [];
  for (const v of videosShowingRelease(W, rel)) {
    const day = publishDay(W, v);
    for (const p of W.where('CardPlacement', 'videoId', v.id)) {
      const d = W.get(p.t.discId), r = resolveMold(W, d);
      if (r && releaseOf(W, d, r.mold)?.id === rel.id && !rows.some((x) => x.videoId === v.id && x.discId === d.id)) rows.push({ videoId: v.id, discId: d.id, title: v.t.title, offset: dayDiff(day, rel.t.date) });
    }
  }
  return rows;
}
function dealEdges(W, deal, side) {
  // Two edge situations per side, each against a real video of the creator: the deal is stretched so its edge falls ON the publish day of the nearest
  // video outside it (the edge day still counts), and shrunk so its edge falls the day BEFORE (after, for a start) the nearest video inside it.
  const vids = W.all('Video').filter((v) => creatorOfVideo(W, v)?.id === deal.t.creatorId).map((v) => ({ v, day: publishDay(W, v) }));
  const edge = deal.t[side], brand = W.get(deal.t.manufacturerId).t.name, out = [];
  const nearest = (list) => list.sort((a, b) => Math.abs(dayDiff(a.day, edge)) - Math.abs(dayDiff(b.day, edge)) || a.v.id.localeCompare(b.v.id))[0];
  const inside = vids.filter((x) => x.day >= deal.t.start && x.day <= deal.t.end);
  const outside = vids.filter((x) => (side === 'end' ? x.day > deal.t.end : x.day < deal.t.start));
  const mk = (label, day, near, active) => {
    if (side === 'end' && day < deal.t.start) return;
    if (side === 'start' && day > deal.t.end) return;
    if (day === deal.t[side]) return;
    out.push({ label, patches: [set(deal.id, side, day)], expect: { kind: 'dealActive', dealId: deal.id, videoId: near.v.id, active } });
  };
  const o = outside.length ? nearest(outside) : null, n = inside.length ? nearest(inside) : null;
  if (side === 'end') {
    if (o) mk(`the ${brand} deal ends on the day “${o.v.t.title}” was published (the last day still counts)`, o.day, o, true);
    if (n) mk(`the ${brand} deal ends the day before “${n.v.t.title}” was published`, addDays(n.day, -1), n, false);
  } else {
    if (o) mk(`the ${brand} deal starts on the day “${o.v.t.title}” was published (the first day counts)`, o.day, o, true);
    if (n) mk(`the ${brand} deal starts the day after “${n.v.t.title}” was published`, addDays(n.day, 1), n, false);
  }
  return out;
}
function publishBoundaries(W, video) {
  const off = W.get(video.t.channelId).t.utcOffsetHours, creator = creatorOfVideo(W, video), out = [];
  const to = (label, day, expect) => { if (day !== publishDay(W, video)) out.push({ label, patches: videoToDay(W, video, day), expect }); };
  const discs = [...new Set(placementsOf(W, video.id).map((p) => p.t.discId))];
  // the last day and the day after each deal of this creator, and the day before its start
  for (const d of W.where('SponsorDeal', 'creatorId', creator.id)) {
    const brand = W.get(d.t.manufacturerId).t.name;
    to(`published on the last day of the ${brand} deal`, d.t.end, { kind: 'dealActive', dealId: d.id, videoId: video.id, active: true });
    to(`published the day after the ${brand} deal ends`, addDays(d.t.end, 1), { kind: 'dealActive', dealId: d.id, videoId: video.id, active: false });
    to(`published on the first day of the ${brand} deal`, d.t.start, { kind: 'dealActive', dealId: d.id, videoId: video.id, active: true });
    to(`published the day before the ${brand} deal starts`, addDays(d.t.start, -1), { kind: 'dealActive', dealId: d.id, videoId: video.id, active: false });
  }
  // the release day, the day before it, and the window edges for the first disc with a day-precision release
  for (const did of discs) {
    const disc = W.get(did), r = resolveMold(W, disc), rel = r && releaseOf(W, disc, r.mold);
    if (!rel) continue;
    const w = rel.t.windowDays, name = r.mold.t.name;
    if (rel.t.datePrecision === 'day') {
      to(`published on the release day of ${name}`, rel.t.date, { kind: 'releaseClass', videoId: video.id, discId: did, releaseClass: 'release-window', offset: 0 });
      to(`published the day before ${name} is released`, addDays(rel.t.date, -1), { kind: 'releaseClass', videoId: video.id, discId: did, releaseClass: 'pre-release', offset: -1 });
      for (const k of [w - 1, w, w + 1]) to(`published ${k} days after ${name} is released (the window is ${w} days)`, addDays(rel.t.date, k), { kind: 'releaseClass', videoId: video.id, discId: did, releaseClass: k <= w ? 'release-window' : 'established', offset: k });
    } else {
      const m0 = monthFirst(rel.t.date), m1 = monthLast(rel.t.date);
      to(`published on the first day of the month ${name} is released`, m0, { kind: 'releaseClass', videoId: video.id, discId: did, releaseClass: 'release-month' });
      to(`published on the last day of the month ${name} is released`, m1, { kind: 'releaseClass', videoId: video.id, discId: did, releaseClass: 'release-month' });
      to(`published the day before the month ${name} is released`, addDays(m0, -1), { kind: 'releaseClass', videoId: video.id, discId: did, releaseClass: 'pre-release' });
      to(`published the day after the month ${name} is released`, addDays(m1, 1), { kind: 'releaseClass', videoId: video.id, discId: did, releaseClass: 'release-window' });
    }
    break;
  }
  // quarter edges and the time-zone edge
  const day = publishDay(W, video), year = day.slice(0, 4);
  for (const [a, b] of [[`${year}-03-31`, `${year}-04-01`], [`${year}-06-30`, `${year}-07-01`], [`${year}-09-30`, `${year}-10-01`]]) {
    if (day === a || day === b) { to(`published on ${day === a ? b : a} instead, the other side of the quarter edge`, day === a ? b : a, { kind: 'quarter', videoId: video.id, quarter: `${(day === a ? b : a).slice(0, 4)}-Q${Math.ceil(+(day === a ? b : a).slice(5, 7) / 3)}` }); }
  }
  return out;
}

// ---- inheritance ----
export const parentOf = (frameId) => FRAMES[frameId].inherits ?? null;
export const lineage = (frameId) => { const out = []; for (let f = frameId; f; f = parentOf(f)) out.unshift(f); return out; };
// Own terminals plus everything inherited: the parent's terminals first, the alternate's own after.
export function effectiveTerminals(frameId) {
  const out = {};
  for (const f of lineage(frameId)) Object.assign(out, FRAMES[f].terminals);
  return out;
}
// Parent expectations are inherited; an own terminal of the same name adds to them.
export function effectiveExpect(frameId, terminal) {
  const out = [];
  for (const f of lineage(frameId)) out.push(...(FRAMES[f].terminals[terminal]?.expect ?? []));
  return out;
}

export const defaultValue = (def) => clone(typeof def.default === 'function' ? def.default() : def.default);
const isRef = (def) => def.type.startsWith('ref');

export function makeInstance(frameId, overrides, { id }) {
  const frame = FRAMES[frameId];
  if (!frame) throw new Error(`unknown frame ${frameId}`);
  const terminals = effectiveTerminals(frameId);
  for (const k of Object.keys(overrides)) if (!(k in terminals)) throw new Error(`${frameId} has no terminal ${k}`);
  const t = {}, how = {};
  for (const [name, def] of Object.entries(terminals)) {
    if (def.derive) continue;
    const dflt = defaultValue(def);
    if (name in overrides) { t[name] = clone(overrides[name]); how[name] = isRef(def) ? 'wired' : deepEqual(t[name], dflt) ? 'default' : 'given'; }
    else { t[name] = dflt; how[name] = isRef(def) ? 'wired' : 'default'; }
  }
  rederive(frame, t, how, terminals);
  return { id, frame: frameId, t, how };
}
export function rederive(frame, t, how, terminals = frame.terminals) {
  for (const [name, def] of Object.entries(terminals)) if (def.derive) { t[name] = def.derive(t); how[name] = 'derived'; }
}

const BASIC = { string: (v) => typeof v === 'string', int: Number.isInteger, number: (v) => typeof v === 'number' && Number.isFinite(v), bool: (v) => typeof v === 'boolean', any: () => true,
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'date|month': (v) => /^\d{4}-\d{2}(-\d{2})?$/.test(v), datetime: (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v) };
export function typeOk(type, v) {
  if (type.endsWith('?') && v === null) return true;
  const t = type.replace(/\?$/, '');
  if (t.startsWith('enum:')) return t.slice(5).split('|').includes(v);
  if (t.startsWith('ref:')) return typeof v === 'string';
  if (t.startsWith('refs:')) return Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (t.startsWith('array:')) return Array.isArray(v) && (t === 'array:object' || v.every((x) => typeof x === 'number'));
  return (BASIC[t] ?? (() => false))(v);
}
export const refFrame = (type) => { const m = /^refs?:([A-Za-z]+)/.exec(type); return m ? m[1] : null; };

// Hard type + reference check of a world (a list of instances indexed as W).
export function typeProblems(W, instances = W.instances) {
  const problems = [];
  for (const inst of instances) {
    for (const [name, def] of Object.entries(effectiveTerminals(inst.frame))) {
      const v = inst.t[name];
      if (v === undefined || !typeOk(def.type, v)) problems.push(`${inst.id}.${name}: ${JSON.stringify(v)?.slice(0, 40)} is not ${def.type}`);
      const rf = refFrame(def.type);
      if (rf && v != null) for (const id of Array.isArray(v) ? v : [v]) {
        if (!W.get(id)) problems.push(`${inst.id}.${name}: ${id} does not exist`);
        else if (W.get(id).frame !== rf) problems.push(`${inst.id}.${name}: ${id} is a ${W.get(id).frame}, not a ${rf}`);
      }
    }
  }
  return problems;
}

// Every expectation of every terminal of every input instance. Returns the violations.
export function checkExpectations(W) {
  const out = [];
  for (const inst of W.instances) {
    if (FRAMES[inst.frame].role !== 'input') continue;
    out.push(...violationsOf(W, inst));
  }
  return out;
}
// Every (terminal, expectation) that applies to an instance: its own frame's and everything that frame inherits. An alternate-frame instance also keeps the
// expectations of the frame it was selected from (`rootFrame`): replacing a frame changes its slots, it does not forget what the original situation asserted.
export function expectationsFor(inst) {
  const frames = [...lineage(inst.frame), ...(inst.rootFrame ? lineage(inst.rootFrame) : [])];
  const seen = new Set(), out = [];
  for (const f of frames) for (const [name, def] of Object.entries(FRAMES[f].terminals)) for (const e of def.expect) {
    const key = `${name}#${e.id}`;
    if (!seen.has(key)) { seen.add(key); out.push({ terminal: name, e }); }
  }
  return out;
}
// The violated expectations of ONE instance, skipping a set of already-consumed "terminal#expectation" keys.
export function violationsOf(W, inst, consumed = new Set()) {
  const out = [];
  for (const { terminal, e } of expectationsFor(inst)) {
    if (consumed.has(`${terminal}#${e.id}`)) continue;
    if (!e.test(inst.t[terminal], inst, W)) out.push({ instanceId: inst.id, frame: inst.frame, terminal, expectationId: e.id, text: e.text, mismatch: e.mismatch });
  }
  return out;
}

export const frameSystem = () => {
  const nodes = Object.entries(FRAMES).map(([id, f]) => ({ id, role: f.role, inherits: f.inherits ?? null, terminals: Object.keys(effectiveTerminals(id)).length, ownTerminals: Object.keys(f.terminals).length }));
  const edges = [];
  for (const [id, f] of Object.entries(FRAMES)) {
    for (const [name, def] of Object.entries(f.terminals)) { const to = refFrame(def.type); if (to) edges.push({ from: id, terminal: name, to, many: def.type.startsWith('refs') }); }
    if (f.inherits) edges.push({ from: id, terminal: '(inherits)', to: f.inherits, many: false });
  }
  return { nodes, edges };
};
// Which alternate frames does an expectation select? (derived from the mismatch strings, so the "selectedBy" text can never drift from the rules)
export function selectedBy(altId) {
  const out = [];
  for (const [fid, f] of Object.entries(FRAMES)) for (const [tn, def] of Object.entries(f.terminals)) for (const e of def.expect) if (e.mismatch === `frame:${altId}`) out.push(`${fid}.${tn} ${e.id}`);
  return out;
}
export { curveOf, latestViews };
