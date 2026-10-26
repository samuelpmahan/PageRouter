// Scene: builds one self-contained world fragment (a Case) out of frame instances. baseline() fills every terminal with its default;
// a departure then varies terminals away from the defaults with scene.vary(), which records each departure.
import { FRAMES, BASE, makeInstance, rederive, defaultValue } from './frames.mjs';
import { deepEqual, clone } from './util.mjs';

const CREATORS = [['Maren Holt', '@marenholt'], ['Tavi Okonkwo', '@tavidiscs'], ['Jory Lindqvist', '@jorythrows'], ['Beck Alvarado', '@beckfairway'], ['Ines Varga', '@inesonthetee'], ['Pell Ramsey', '@pellrounds']];
const BRANDS = ['Halcyon Discs', 'Brightline Golf', 'Kestrel Disc Co.', 'Tern Discs', 'Ovenbird Golf', 'Fathom Discs', 'Marrow & Reed'];
const MOLDS = ['Comet', 'Lantern', 'Marlin', 'Sparrowhawk', 'Quill', 'Anvil', 'Tamarind', 'Heron'];
const TITLES = ['Bag tour and a full round', 'Every putter I own, ranked', 'Back nine at the old quarry course', 'Why I switched drivers', 'Wind round: three discs only', 'Course vlog: the long par fives'];
const PLASTICS = ['Pro', 'Z-Line', 'Gold Fuse', 'Star', 'Neutron'];

export class Scene {
  constructor(caseId, rng) {
    this.caseId = caseId; this.rng = rng; this.instances = []; this.k = {}; this.departures = []; this.counters = {};
    this.p = {}; // baseline parameters drawn from the seed (departures read these)
  }
  nextId(frame) { this.counters[frame] = (this.counters[frame] ?? 0) + 1; return `${this.caseId}.${frame}${this.counters[frame]}`; }
  add(frame, overrides = {}, key = null) {
    const inst = makeInstance(frame, overrides, { id: this.nextId(frame), caseId: this.caseId });
    this.instances.push(inst);
    if (key) this.k[key] = inst;
    return inst;
  }
  vary(inst, terminal, value) {
    const def = FRAMES[inst.frame].terminals[terminal];
    if (!def) throw new Error(`${inst.frame} has no terminal ${terminal}`);
    if (def.derive) throw new Error(`${inst.frame}.${terminal} is derived; vary what it derives from`);
    const dflt = defaultValue(def);
    if (deepEqual(value, inst.t[terminal])) throw new Error(`${inst.id}.${terminal}: departure equals the current value (${JSON.stringify(value)})`);
    if (!def.type.startsWith('ref') && deepEqual(value, dflt)) throw new Error(`${inst.id}.${terminal}: departure equals the default (${JSON.stringify(dflt)})`);
    this.departures.push({ frame: inst.frame, instanceId: inst.id, terminal, from: clone(inst.t[terminal]), to: clone(value), default: clone(dflt) });
    inst.t[terminal] = clone(value);
    inst.how[terminal] = 'departed';
    rederive(FRAMES[inst.frame], inst.t, inst.how);
    return inst;
  }
  // Remove an instance that the baseline created (a departure of "present" to "absent").
  remove(inst) {
    this.instances = this.instances.filter((i) => i !== inst);
    for (const [k, v] of Object.entries(this.k)) if (v === inst) delete this.k[k];
    this.departures.push({ frame: inst.frame, instanceId: inst.id, terminal: null, from: 'present', to: 'absent', default: 'present' });
  }

  newCreator(key, who) {
    const creator = this.add('Creator', { name: who[0], handle: who[1] }, key);
    const channel = this.add('Channel', { creatorId: creator.id, title: `${who[0].split(' ')[1]} Disc Golf` }, `${key}Channel`);
    const shelf = this.add('Shelf', { creatorId: creator.id }, `${key}Shelf`);
    return { creator, channel, shelf };
  }
  newBrand(key, name, country = 'US') { return this.add('Manufacturer', { name, country }, key); }
  newMold(key, brand, name, kind = 'distance driver') { return this.add('Mold', { manufacturerId: brand.id, name, kind }, key); }
  newRelease(key, mold, date, extra = {}) { return this.add('Release', { moldId: mold.id, date, ...extra }, key); }
  newDeal(key, creator, brand, start, end, molds = 'all') { return this.add('SponsorDeal', { creatorId: creator.id, manufacturerId: brand.id, start, end, moldsCovered: molds }, key); }
  newDisc(key, creator, shelf, mold, extra = {}, { record = false } = {}) {
    const disc = this.add('Disc', { creatorId: creator.id, shelfId: shelf.id, moldId: mold.id, moldName: mold.t.name, ...extra }, key);
    const before = [...shelf.t.discIds];
    shelf.t.discIds.push(disc.id);
    shelf.how.discIds = 'wired';
    if (record) { this.departures.push({ frame: 'Shelf', instanceId: shelf.id, terminal: 'discIds', from: before, to: [...shelf.t.discIds], default: [] }); shelf.how.discIds = 'departed'; }
    return disc;
  }
  // Mark a terminal of an instance that was created already holding its non-default value (a deliberate departure, recorded).
  mark(inst, terminal) {
    const def = FRAMES[inst.frame].terminals[terminal];
    const dflt = defaultValue(def);
    if (deepEqual(inst.t[terminal], dflt)) throw new Error(`${inst.id}.${terminal}: marked as departure but equals the default`);
    this.departures.push({ frame: inst.frame, instanceId: inst.id, terminal, from: clone(dflt), to: clone(inst.t[terminal]), default: clone(dflt) });
    inst.how[terminal] = 'departed';
    return inst;
  }
  newVideo(key, channel, extra = {}, { curve = true, curveOver = {} } = {}) {
    const video = this.add('Video', { channelId: channel.id, ...extra }, key);
    let c = null;
    if (curve) c = this.add('RetentionCurve', { videoId: video.id, seconds: video.t.durationSeconds, endLevel: this.p.endLevel, ...curveOver }, `${key}Curve`);
    return { video, curve: c };
  }
  newBag(key, creator, discs, videos, extra = {}) { return this.add('Bag', { creatorId: creator.id, discIds: discs.map((d) => d.id), appliedToVideoIds: videos.map((v) => v.id), ...extra }, key); }
  newCard(key, video, disc, a, b, extra = {}) { return this.add('CardPlacement', { videoId: video.id, discId: disc.id, startSec: a, endSec: b, ...extra }, key); }
  newThrow(key, video, disc, a, b, extra = {}) { return this.add('Appearance', { videoId: video.id, discId: disc.id, startSec: a, endSec: b, ...extra }, key); }
  newLink(key, creator, disc, video, extra = {}) { return this.add('Link', { creatorId: creator.id, discId: disc.id, videoId: video ? video.id : null, code: `${disc.t.moldName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${creator.t.handle.slice(1, 5)}`, ...extra }, key); }
  newClick(key, link, extra = {}) { return this.add('Click', { linkId: link.id, ...extra }, key); }

  finish() {
    return { instances: this.instances, departures: this.departures, keys: Object.fromEntries(Object.entries(this.k).map(([k, v]) => [k, v.id])) };
  }
}

// Every terminal at its default: the ordinary situation. One creator, one sponsored mold, one disc, one video, one card
// (with a matching throw marked by the creator), one link in the description, one click.
export function baseline(s) {
  const { rng } = s;
  const who = rng.pick(CREATORS);
  const brandName = rng.pick(BRANDS);
  const moldName = rng.pick(MOLDS);
  s.p = {
    views: rng.int(8, 16) * 100, endLevel: rng.pick([0.4, 0.45, 0.5, 0.55, 0.6]),
    a: rng.int(21, 35), len: rng.int(15, 35), title: rng.pick(TITLES), plastic: rng.pick(PLASTICS),
    brandName, moldName, who,
  };
  s.p.b = s.p.a + s.p.len;
  const { creator, channel, shelf } = s.newCreator('creator', who);
  const brand = s.newBrand('brand', brandName);
  const mold = s.newMold('mold', brand, moldName);
  s.newRelease('release', mold, BASE.releaseDate);
  s.newDeal('deal', creator, brand, BASE.dealStart, BASE.dealEnd);
  const disc = s.newDisc('disc', creator, shelf, mold, { plastic: s.p.plastic });
  const { video } = s.newVideo('video', channel, { title: s.p.title, viewSnapshots: [{ at: BASE.snapshotAt, views: s.p.views }] });
  s.newBag('bag', creator, [disc], [video]);
  s.newCard('card', video, disc, s.p.a, s.p.b);
  s.newThrow('throw', video, disc, s.p.a, s.p.b);
  const link = s.newLink('link', creator, disc, video);
  s.newClick('click', link);
  return s;
}
export const NAME_POOLS = { CREATORS, BRANDS, MOLDS, PLASTICS, TITLES };
