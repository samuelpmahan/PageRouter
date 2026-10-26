// Minskyan frames for thro-go. A frame is a stereotyped situation with terminals (slots). Each terminal has
//   type         what may fill it (a primitive, an enum, or a reference to another frame: that is how frames link into a frame system)
//   default      the assignment used when nothing else is said (the "ordinary" situation)
//   expect[]     expectations the filler should meet; { id, text, test(value, instance, world), mismatch }
//                mismatch = null  -> a hard expectation (a violation is a bug in the data, the generator must never produce one)
//                mismatch = 'frame:X' -> the mismatch selects the alternate frame X; 'transform:Y' / 'resolve:Z' -> it selects a transformation
// Cases are made by deliberately varying terminals away from their defaults (departures.mjs).
import { clone, deepEqual, round4 } from './util.mjs';
import { resolveMold, releaseOf, releaseInterval, sponsorBucket, creatorOfVideo, placementsOf, givenAppearancesOf, latestViews, curveOf } from './world.mjs';

export const BASE = Object.freeze({
  releaseDate: '2026-02-01', publishedAt: '2026-05-10', dealStart: '2026-01-01', dealEnd: '2026-12-31',
  durationSeconds: 120, views: 1000, snapshotAt: '2026-05-17', placementStart: 20, placementEnd: 50, endLevel: 0.5,
});

const T = (type, def, expect = [], extra = {}) => ({ type, default: def, expect, ...extra });
const X = (id, text, test, mismatch = null) => ({ id, text, test, mismatch });

export function curveValues(shape, endLevel, dip, seconds) {
  const out = [];
  for (let s = 0; s < seconds; s++) {
    let v = shape === 'flat' ? endLevel : 1 - (1 - endLevel) * (s / seconds);
    if (dip && s >= dip.from && s < dip.to) v *= 1 - dip.depth;
    out.push(round4(v));
  }
  return out;
}

const overlapsIv = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

export const FRAMES = {
  Creator: { role: 'input', description: 'A disc golf YouTube creator who uses thro (free) and thro-go (paid attribution).', terminals: {
    name: T('string', 'Maren Holt'),
    handle: T('string', '@marenholt'),
    plan: T('enum:thro|thro-go', 'thro-go'),
  } },
  Channel: { role: 'input', description: 'The creator\'s YouTube channel, optionally connected to YouTube Studio for retention data.', terminals: {
    creatorId: T('ref:Creator', null),
    title: T('string', 'Holt Disc Golf'),
    studioConnected: T('bool', true, [X('retentionAvailable', 'YouTube Studio is connected, so retention curves can be read.', (v) => v === true, 'frame:ClicksOnlyChannel')]),
  } },
  Manufacturer: { role: 'input', description: 'A disc brand.', terminals: {
    name: T('string', 'Halcyon Discs'),
    country: T('string', 'US'),
  } },
  Mold: { role: 'input', description: 'A disc design in the catalog (not a physical disc).', terminals: {
    manufacturerId: T('ref:Manufacturer', null),
    name: T('string', 'Comet'),
    kind: T('enum:putter|midrange|fairway driver|distance driver', 'distance driver'),
    catalogStatus: T('enum:cataloged', 'cataloged'),
  } },
  Release: { role: 'input', description: 'A dated release of a mold or of a new run (plastic/stamp) of it.', terminals: {
    moldId: T('ref:Mold', null),
    runLabel: T('string?', null),
    date: T('date|month', '2026-02-01'),
    datePrecision: T('enum:day|month', 'day', [X('dayPrecision', 'The release date is known to the day.', (v) => v === 'day', 'transform:interval-offsets')]),
    kind: T('enum:new-mold|new-run|reissue', 'new-mold'),
  } },
  SponsorDeal: { role: 'input', description: 'A sponsorship term between one creator and one manufacturer, covering all or some molds.', terminals: {
    creatorId: T('ref:Creator', null),
    manufacturerId: T('ref:Manufacturer', null),
    start: T('date', '2026-01-01'),
    end: T('date', '2026-12-31', [X('endsAfterStart', 'A deal ends on or after the day it starts.', (v, i) => v >= i.t.start)]),
    moldsCovered: T('any', 'all'),
  } },
  Disc: { role: 'input', description: 'One physical disc on a creator\'s Shelf: a mold in a plastic, maybe from a particular run.', terminals: {
    creatorId: T('ref:Creator', null),
    shelfId: T('ref:Shelf', null),
    moldId: T('ref:Mold?', null, [X('moldResolved', 'The disc\'s mold is in the catalog.', (v, i, W) => !!(v && W.get(v)), 'resolve:name-or-provisional')]),
    moldName: T('string', 'Comet'),
    plastic: T('string', 'Pro'),
    runLabel: T('string?', null),
    photo: T('string', 'photo:slate'),
  } },
  Shelf: { role: 'input', description: 'Every disc a creator owns.', terminals: {
    creatorId: T('ref:Creator', null),
    discIds: T('refs:Disc', []),
  } },
  Bag: { role: 'input', description: 'A snapshot of discs a creator carried, applied to one or more videos.', terminals: {
    creatorId: T('ref:Creator', null),
    name: T('string', 'Tournament bag'),
    takenAt: T('date', '2026-05-01'),
    discIds: T('refs:Disc', [], [X('onShelf', 'Every disc in a bag is on the creator\'s own Shelf.', (v, i, W) => v.every((d) => W.get(d)?.t.creatorId === i.t.creatorId))]),
    appliedToVideoIds: T('refs:Video', []),
  } },
  Video: { role: 'input', description: 'A published YouTube video (long or Short) with view counts over time.', terminals: {
    channelId: T('ref:Channel', null),
    title: T('string', 'Bag tour and a full round'),
    publishedAt: T('date', '2026-05-10'),
    kind: T('enum:long|short', 'long'),
    orientation: T('enum:horizontal|vertical', 'horizontal', [X('shortIsVertical', 'A Short is vertical.', (v, i) => i.t.kind === 'long' || v === 'vertical')]),
    durationSeconds: T('int', 120, [X('shortUnderSixty', 'A Short is under 60 seconds.', (v, i) => i.t.kind === 'long' || v < 60)]),
    viewSnapshots: T('array:object', [{ at: '2026-05-17', views: 1000 }], [
      X('hasViews', 'The video has at least one view.', (v) => v.length > 0 && v[v.length - 1].views > 0, 'frame:AwaitingViewsVideo'),
      X('viewsNonDecreasing', 'Cumulative views never go down between snapshots.', (v) => v.every((s, k) => k === 0 || s.views >= v[k - 1].views)),
    ]),
  } },
  RetentionCurve: { role: 'input', description: 'Audience retention from YouTube Studio: the fraction of viewers still watching at each second.', terminals: {
    videoId: T('ref:Video', null),
    seconds: T('int', 120),
    shape: T('enum:linear-decay|flat', 'linear-decay'),
    endLevel: T('number', 0.5),
    dip: T('object?', null),
    fractions: T('array:number', null, [
      X('coversVideo', 'The curve has one point per second of the video.', (v, i, W) => v.length >= (W.get(i.t.videoId)?.t.durationSeconds ?? 0)),
      X('unitInterval', 'Every point is between 0 and 1.', (v) => v.every((f) => f >= 0 && f <= 1)),
    ], { derive: (t) => curveValues(t.shape, t.endLevel, t.dip, t.seconds) }),
  } },
  CardPlacement: { role: 'input', description: 'A thro disc card on screen in a video, from second a to second b.', terminals: {
    videoId: T('ref:Video', null),
    discId: T('ref:Disc', null, [
      X('releasedByPublish', 'The disc\'s mold was released by the day the video was published.', (v, i, W) => {
        const video = W.get(i.t.videoId), disc = W.get(v), r = disc && resolveMold(W, disc), rel = r && releaseOf(W, disc, r.mold);
        if (!rel || !video) return true;
        const [r0, r1] = releaseInterval(rel);
        return rel.t.datePrecision === 'month' ? video.t.publishedAt > r1 : video.t.publishedAt >= r0;
      }, 'frame:PreReleaseAppearance'),
      X('underActiveSponsor', 'The disc\'s brand is the creator\'s sponsor, with the mold covered, on the publish day.', (v, i, W) => {
        const video = W.get(i.t.videoId), disc = W.get(v), creator = video && creatorOfVideo(W, video), r = disc && resolveMold(W, disc);
        return !!creator && sponsorBucket(W, creator.id, video.t.publishedAt, r?.mold ?? null).bucket === 'sponsor';
      }, 'frame:OtherBrandAppearance'),
      X('confirmedThrown', 'The creator also marked the disc as thrown while the card was up.', (v, i, W) => givenAppearancesOf(W, i.t.videoId, v).some((a) => a.t.mode === 'thrown' && overlapsIv(a.t.startSec, a.t.endSec, i.t.startSec, i.t.endSec)), 'frame:ShownOnlyAppearance'),
    ]),
    startSec: T('int', 20, [X('startInsideVideo', 'The card starts inside the video.', (v, i, W) => v < (W.get(i.t.videoId)?.t.durationSeconds ?? Infinity))]),
    endSec: T('int', 50, [
      X('notInverted', 'The card ends at or after the second it starts.', (v, i) => v >= i.t.startSec, 'transform:drop-inverted'),
      X('hasLength', 'The card is on screen for more than zero seconds.', (v, i) => v !== i.t.startSec, 'transform:drop-zero-length'),
      X('withinVideo', 'The card ends before the video does.', (v, i, W) => v <= (W.get(i.t.videoId)?.t.durationSeconds ?? Infinity), 'transform:clamp-to-video-end'),
    ]),
    layout: T('enum:lower-third|corner|full|vertical-stack', 'lower-third'),
  } },
  Appearance: { role: 'input', description: 'The atom: this disc, in this video, from second a to b, and how we know (a card, a throw marked by the creator, a mention).', terminals: {
    videoId: T('ref:Video', null),
    discId: T('ref:Disc', null, [X('hasCard', 'A thro card was on screen for the disc over this interval.', (v, i, W) => placementsOf(W, i.t.videoId, v).some((p) => overlapsIv(p.t.startSec, p.t.endSec, i.t.startSec, i.t.endSec)), 'frame:CardlessAppearance')]),
    startSec: T('int', 20),
    endSec: T('int', 50),
    mode: T('enum:thrown|shown|talked', 'thrown'),
    evidence: T('enum:throw-log|card|creator-marked', 'throw-log'),
  } },
  Link: { role: 'input', description: 'A per-disc link the creator owns, placed in a video description, pinned comment, YouTube card, or bio.', terminals: {
    creatorId: T('ref:Creator', null),
    code: T('string', 'comet-holt'),
    discId: T('ref:Disc', null, [X('discBelongsToCreator', 'The link\'s disc is on the same creator\'s Shelf.', (v, i, W) => W.get(v)?.t.creatorId === i.t.creatorId)]),
    destination: T('string', 'https://shop.example/halcyon/comet'),
    placement: T('enum:description|pinned-comment|card|bio', 'description'),
    videoId: T('ref:Video?', null),
  } },
  Click: { role: 'input', description: 'One recorded click on a link. A click is a click: not a person, a sale or revenue.', terminals: {
    linkId: T('ref:Link', null, [
      X('linkIsVideoScoped', 'The link belongs to one video.', (v, i, W) => W.get(v)?.t.videoId != null, 'frame:UnattributedClick'),
      X('discAppearedInVideo', 'The link\'s disc appeared in the link\'s video.', (v, i, W) => {
        const link = W.get(v);
        if (!link || link.t.videoId == null) return true;
        return placementsOf(W, link.t.videoId, link.t.discId).length + givenAppearancesOf(W, link.t.videoId, link.t.discId).length > 0;
      }, 'frame:UnattributedClick'),
    ]),
    at: T('datetime', '2026-05-12T18:04:00Z', [X('notBeforePublish', 'The click is not earlier than the video\'s publish day.', (v, i, W) => {
      const link = W.get(i.t.linkId), video = link && link.t.videoId && W.get(link.t.videoId);
      return !video || v.slice(0, 10) >= video.t.publishedAt;
    }, 'frame:UnattributedClick')]),
    refererHost: T('string', 'youtube.com'),
    country: T('string', 'US'),
    videoTimestamp: T('int?', null, [X('insidePlacement', 'A click carrying a video timestamp falls inside a card placement of that disc.', (v, i, W) => {
      const link = W.get(i.t.linkId);
      if (v == null || !link || link.t.videoId == null) return true;
      return placementsOf(W, link.t.videoId, link.t.discId).some((p) => p.t.startSec <= v && v < p.t.endSec);
    }, 'transform:attribute-to-video')]),
  } },

  // Alternate frames: selected by an expectation mismatch. The enrichment instantiates these.
  ProvisionalMold: { role: 'alternate', selectedBy: 'Disc.moldId moldResolved', description: 'A mold we do not have in the catalog: kept as a placeholder so the disc still links to something.', terminals: {
    discId: T('ref:Disc', null), typedName: T('string', ''), manufacturerKnown: T('bool', false),
  } },
  PreReleaseAppearance: { role: 'alternate', selectedBy: 'CardPlacement.discId releasedByPublish', description: 'A card shown before (or possibly before) its mold\'s release date: pre-release hype.', terminals: {
    appearanceId: T('ref:Appearance', null), releaseId: T('ref:Release', null), certainty: T('enum:certain|possible', 'certain'), daysBeforeMin: T('int', 0), daysBeforeMax: T('int', 0),
  } },
  OtherBrandAppearance: { role: 'alternate', selectedBy: 'CardPlacement.discId underActiveSponsor', description: 'A disc whose brand is not the creator\'s active sponsor (or whose mold is not covered): counted, but not as sponsor exposure.', terminals: {
    appearanceId: T('ref:Appearance', null), reason: T('enum:no-deal|other-brand|mold-not-covered|unknown-brand', 'other-brand'), manufacturerId: T('ref:Manufacturer?', null),
  } },
  ShownOnlyAppearance: { role: 'alternate', selectedBy: 'CardPlacement.discId confirmedThrown', description: 'A card was on screen but the creator never marked the disc as thrown.', terminals: { appearanceId: T('ref:Appearance', null) } },
  CardlessAppearance: { role: 'alternate', selectedBy: 'Appearance.discId hasCard', description: 'The disc was in the video (thrown or mentioned) but no thro card was up, so no link prompt was shown.', terminals: {
    appearanceId: T('ref:Appearance', null), modes: T('array:string', []),
  } },
  AwaitingViewsVideo: { role: 'alternate', selectedBy: 'Video.viewSnapshots hasViews', description: 'A published video with no views yet: attention is "not measurable yet", not zero.', terminals: { videoId: T('ref:Video', null) } },
  ClicksOnlyChannel: { role: 'alternate', selectedBy: 'Channel.studioConnected retentionAvailable', description: 'A channel without YouTube Studio: clicks are counted, attention-seconds are not available.', terminals: { channelId: T('ref:Channel', null) } },
  UnattributedClick: { role: 'alternate', selectedBy: 'Click.linkId linkIsVideoScoped / discAppearedInVideo; Click.at notBeforePublish', description: 'A click counted for its link and disc but not credited to any appearance.', terminals: {
    clickId: T('ref:Click', null), reason: T('enum:no-video|disc-not-in-video|predates-publish', 'disc-not-in-video'),
  } },
};

export const defaultValue = (def) => clone(typeof def.default === 'function' ? def.default() : def.default);
const isRef = (def) => def.type.startsWith('ref');

export function makeInstance(frameId, overrides, { id, caseId }) {
  const frame = FRAMES[frameId];
  if (!frame) throw new Error(`unknown frame ${frameId}`);
  for (const k of Object.keys(overrides)) if (!(k in frame.terminals)) throw new Error(`${frameId} has no terminal ${k}`);
  const t = {}, how = {};
  for (const [name, def] of Object.entries(frame.terminals)) {
    if (def.derive) continue;
    const dflt = defaultValue(def);
    if (name in overrides) { t[name] = clone(overrides[name]); how[name] = isRef(def) ? 'wired' : deepEqual(t[name], dflt) ? 'default' : 'given'; }
    else { t[name] = dflt; how[name] = isRef(def) ? 'wired' : 'default'; }
  }
  rederive(frame, t, how);
  return { id, frame: frameId, caseId, t, how };
}
export function rederive(frame, t, how) {
  for (const [name, def] of Object.entries(frame.terminals)) if (def.derive) { t[name] = def.derive(t); how[name] = 'derived'; }
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
  if (t.startsWith('array:')) return Array.isArray(v) && (t === 'array:object' || v.every((x) => (t === 'array:number' ? typeof x === 'number' : typeof x === 'string')));
  return (BASIC[t] ?? (() => false))(v);
}
export const refFrame = (type) => { const m = /^refs?:([A-Za-z]+)/.exec(type); return m ? m[1] : null; };

// Hard type + reference check of an instance list (one fragment).
export function typeProblems(W) {
  const problems = [];
  for (const inst of W.instances) {
    const frame = FRAMES[inst.frame];
    for (const [name, def] of Object.entries(frame.terminals)) {
      const v = inst.t[name];
      if (v === undefined || !typeOk(def.type, v)) problems.push(`${inst.id}.${name}: ${JSON.stringify(v)?.slice(0, 40)} is not ${def.type}`);
      const rf = refFrame(def.type);
      if (rf && v != null) for (const id of Array.isArray(v) ? v : [v]) if (!W.get(id)) problems.push(`${inst.id}.${name}: ${id} does not exist`);
      else if (rf && v != null && W.get(id) && W.get(id).frame !== rf) problems.push(`${inst.id}.${name}: ${id} is a ${W.get(id).frame}, not a ${rf}`);
    }
  }
  return problems;
}

// Every expectation of every terminal of every instance. Returns the violations.
export function checkExpectations(W) {
  const out = [];
  for (const inst of W.instances) {
    const frame = FRAMES[inst.frame];
    if (frame.role !== 'input') continue;
    for (const [name, def] of Object.entries(frame.terminals)) {
      for (const e of def.expect) {
        if (!e.test(inst.t[name], inst, W)) out.push({ instanceId: inst.id, frame: inst.frame, terminal: name, expectationId: e.id, text: e.text, mismatch: e.mismatch });
      }
    }
  }
  return out;
}

export const frameSystem = () => {
  const nodes = Object.entries(FRAMES).map(([id, f]) => ({ id, role: f.role, terminals: Object.keys(f.terminals).length }));
  const edges = [];
  for (const [id, f] of Object.entries(FRAMES)) for (const [name, def] of Object.entries(f.terminals)) { const to = refFrame(def.type); if (to) edges.push({ from: id, terminal: name, to, many: def.type.startsWith('refs') }); }
  return { nodes, edges };
};
export { curveOf, latestViews };
