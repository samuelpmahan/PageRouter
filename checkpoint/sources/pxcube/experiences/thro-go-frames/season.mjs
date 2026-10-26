// The shared toy world: one season (February to October 2026) of three creators, five manufacturers, fifteen molds, eighteen releases,
// shelves of discs, bags that change from video to video, links in every placement, and clicks spread over the days after each publish.
// Everything is built through the frames (makeInstance), so every terminal holds a frame-valid value.
//
// The STRUCTURE is fixed on purpose: the creators, brands, molds, release dates, deals and the day and time of every video are chosen so that
// the situations a thro-go reader must handle actually happen in this world (a deal's last day, a release day, the 29th/30th/31st day of a window,
// the first and last day of a month-precision release, a quarter edge, a time-zone edge, a click at a card's last second ...).
// The seed varies the NUMBERS (views, retention curves, click days and times, snapshot growth), never the structure.
import { makeInstance } from './frames.mjs';
import { mulberry32, fnv32, instantAt, addDays, dayDiff } from './util.mjs';

export const SEASON_END = '2026-10-25';
const NOW = '2026-10-25T12:00:00Z';

const MAKERS = [
  { key: 'halcyon', name: 'Halcyon Discs', country: 'US', host: 'halcyondiscs.example', molds: [['comet', 'Comet', 'distance driver'], ['lantern', 'Lantern', 'fairway driver'], ['marlin', 'Marlin', 'midrange']] },
  { key: 'brightline', name: 'Brightline Golf', country: 'US', host: 'brightlinegolf.example', molds: [['anvil', 'Anvil', 'putter'], ['tamarind', 'Tamarind', 'fairway driver'], ['heron', 'Heron', 'distance driver']] },
  { key: 'kestrel', name: 'Kestrel Disc Co.', country: 'CA', host: 'kestreldisc.example', molds: [['sparrowhawk', 'Sparrowhawk', 'distance driver'], ['quill', 'Quill', 'putter'], ['merlin', 'Merlin', 'midrange']] },
  { key: 'tern', name: 'Tern Discs', country: 'FI', host: 'ternshop.example', molds: [['skerry', 'Skerry', 'putter'], ['halyard', 'Halyard', 'midrange'], ['gannet', 'Gannet', 'distance driver']] },
  { key: 'ovenbird', name: 'Ovenbird Golf', country: 'US', host: 'ovenbirdgolf.example', molds: [['wren', 'Wren', 'putter'], ['pipit', 'Pipit', 'fairway driver'], ['kittiwake', 'Kittiwake', 'distance driver']] },
];
// [mold, runLabel, kind, date, precision, windowDays]
const RELEASES = [
  ['comet', null, 'new-mold', '2026-03-06', 'day', 30], ['comet', 'Founders Run', 'new-run', '2026-05-22', 'day', 30],
  ['lantern', null, 'new-mold', '2025-09-12', 'day', 30], ['marlin', null, 'new-mold', '2026-07', 'month', 30],
  ['anvil', null, 'new-mold', '2025-11-01', 'day', 30], ['tamarind', null, 'new-mold', '2026-04-10', 'day', 30], ['tamarind', 'Tour Series', 'new-run', '2026-08-14', 'day', 21],
  ['heron', null, 'new-mold', '2026-05', 'month', 30],
  ['sparrowhawk', null, 'new-mold', '2026-01-24', 'day', 30], ['quill', null, 'new-mold', '2025-06-20', 'day', 30], ['merlin', null, 'new-mold', '2026-09-04', 'day', 30],
  ['skerry', null, 'new-mold', '2025-10-15', 'day', 30], ['halyard', null, 'new-mold', '2026-02-27', 'day', 30], ['gannet', null, 'new-mold', '2026-06-18', 'day', 30], ['gannet', 'Reissue 2026', 'reissue', '2026-09-30', 'day', 30],
  ['wren', null, 'new-mold', '2025-12-05', 'day', 30], ['pipit', null, 'new-mold', '2026-04-24', 'day', 30], ['kittiwake', null, 'new-mold', '2026-08', 'month', 30],
];

// Creators. discs: key -> [mold, plastic, runLabel]  (mold null = a mold the creator typed that may not be in the catalog)
const CREATORS = [
  { key: 'maren', name: 'Maren Holt', handle: '@marenholt', channel: 'Holt Disc Golf', tz: -5, scale: 2400,
    discs: { 'comet-pro': ['comet', 'Pro'], 'comet-star': ['comet', 'Star', 'Founders Run'], 'lantern-zline': ['lantern', 'Z-Line'], 'marlin-pro': ['marlin', 'Pro'], 'skerry-pro': ['skerry', 'Pro'], 'halyard-pro': ['halyard', 'Pro'], 'sparrowhawk-neutron': ['sparrowhawk', 'Neutron'], 'anvil-pro': ['anvil', 'Pro'], 'wren-pro': ['wren', 'Pro'] },
    bags: { B1: ['Early-season bag', '2026-02-10', ['lantern-zline', 'sparrowhawk-neutron', 'anvil-pro', 'wren-pro']], B2: ['Comet launch bag', '2026-02-18', ['comet-pro', 'lantern-zline', 'anvil-pro', 'wren-pro']],
      B3: ['Putter-focus bag', '2026-04-10', ['comet-pro', 'skerry-pro', 'halyard-pro', 'wren-pro']], B4: ['Founders bag', '2026-05-20', ['comet-pro', 'comet-star', 'lantern-zline', 'skerry-pro']],
      B5: ['Summer bag', '2026-06-25', ['comet-star', 'marlin-pro', 'lantern-zline']], B6: ['Fall bag', '2026-09-20', ['comet-star', 'skerry-pro', 'halyard-pro', 'lantern-zline']] },
    bio: ['comet-pro'],
    videos: [
      ['01', '2026-02-14', '19:30', 'long', 420, 'Opening the season: every disc in my bag', 'B1', ['early-drop', 0.40], 1,
        [['lantern-zline', 30, 95, 'cd'], ['sparrowhawk-neutron', 150, 210, 'cd'], ['anvil-pro', 250, 300, 'c'], ['wren-pro', 330, 380, 't']], [['lantern-zline', 'description'], ['sparrowhawk-neutron', 'description'], ['anvil-pro', 'pinned-comment']]],
      ['02', '2026-02-20', '20:00', 'short', 38, 'Something new from Halcyon #shorts', 'B2', ['loop', 1.08], 3,
        [['comet-pro', 4, 34, 'cd']], [['comet-pro', 'pinned-comment']]],
      ['03', '2026-03-06', '18:00', 'long', 480, 'Comet day one: the first full round', 'B2', ['exp-decay', 0.45, { dip: [200, 240, 0.14] }], 1.3,
        [['comet-pro', 40, 150, 'cd'], ['lantern-zline', 200, 240, 'cd']], [['comet-pro', 'description'], ['comet-pro', 'card'], ['lantern-zline', 'description']]],
      ['04', '2026-04-05', '20:00', 'long', 360, 'Thirty days of Comet', 'B2', ['early-drop', 0.42], 1,
        [['comet-pro', 30, 120, 'cd'], ['wren-pro', 200, 250, 'cd']], [['comet-pro', 'description'], ['wren-pro', 'description']]],
      ['05', '2026-04-18', '15:00', 'long', 540, 'Putter deep dive: Skerry and Halyard', 'B3', ['linear-decay', 0.38], 1.2,
        [['skerry-pro', 60, 160, 'cd'], ['halyard-pro', 140, 260, 'cd'], ['comet-pro', 400, 450, 'cd']], [['skerry-pro', 'description'], ['halyard-pro', 'description'], ['halyard-pro', 'card'], ['comet-pro', 'pinned-comment']]],
      ['06', '2026-05-22', '12:00', 'long', 450, 'Comet Founders Run unboxing', 'B4', ['early-drop', 0.46, { bump: [60, 0.10, 30] }], 1.4,
        [['comet-star', 20, 140, 'cd'], ['comet-pro', 200, 260, 'cd'], ['lantern-zline', 300, 330, 'd']], [['comet-star', 'description'], ['comet-star', 'card'], ['comet-pro', 'description']]],
      ['07', '2026-06-12', '17:00', 'long', 400, 'Wind round: three discs only', 'B4', ['linear-decay', 0.5], 0.9,
        [['comet-pro', 30, 100, 'cd'], ['comet-pro', 90, 140, 'c'], ['skerry-pro', 150, 210, 'cd'], ['comet-star', 250, 300, 'cd']], [['comet-pro', 'description'], ['skerry-pro', 'description'], ['comet-star', 'pinned-comment']]],
      ['08', '2026-06-30', '21:00', 'long', 380, 'Mid-season bag check', 'B5', ['exp-decay', 0.5], 1,
        [['comet-star', 20, 90, 'cd'], ['marlin-pro', 120, 200, 'cd'], ['lantern-zline', 250, 300, 'cd']], [['comet-star', 'description'], ['marlin-pro', 'description'], ['lantern-zline', 'pinned-comment']]],
      ['09', '2026-07-01', '08:00', 'short', 45, 'Marlin is here, almost #shorts', 'B5', ['loop', 1.1], 3,
        [['marlin-pro', 3, 43, 'cd']], [['marlin-pro', 'pinned-comment']]],
      ['10', '2026-07-31', '22:30', 'long', 470, 'Marlin month one: how does it fly', 'B5', ['early-drop', 0.44], 1.1,
        [['marlin-pro', 50, 200, 'cd'], ['comet-star', 250, 330, 'cd']], [['marlin-pro', 'description'], ['marlin-pro', 'card'], ['comet-star', 'description']]],
      ['11', '2026-09-30', '14:00', 'long', 400, 'Season wrap: the Tern putters', 'B6', ['linear-decay', 0.45], 1,
        [['skerry-pro', 30, 110, 'cd'], ['halyard-pro', 150, 230, 'cd'], ['comet-star', 300, 350, 'cd']], [['skerry-pro', 'description'], ['halyard-pro', 'description'], ['comet-star', 'pinned-comment']]],
      ['12', '2026-10-24', '10:00', 'long', 360, 'New season bag: first look', 'B6', ['early-drop', 0.5], 0,
        [['comet-star', 20, 80, 'cd']], [['comet-star', 'description']]],
    ],
    deals: [['halcyon', '2026-01-01', '2026-12-31', ['comet', 'marlin']], ['tern', '2026-04-01', '2026-09-30', ['skerry', 'halyard']]] },

  { key: 'tavi', name: 'Tavi Okonkwo', handle: '@tavidiscs', channel: 'Tavi Throws', tz: -8, scale: 4000,
    discs: { 'anvil-zline': ['anvil', 'Z-Line'], 'tamarind-pro': ['tamarind', 'Pro'], 'tamarind-tour': ['tamarind', 'Z-Line', 'Tour Series'], 'heron-pro': ['heron', 'Pro'], 'comet-pro': ['comet', 'Pro'], 'marlin-star': ['marlin', 'Star'], 'lantern-pro': ['lantern', 'Pro'], 'gannet-star': ['gannet', 'Star'], 'sparrowhawk-pro': ['sparrowhawk', 'Pro'], 'kittiwake-pro': ['kittiwake', 'Pro'] },
    bags: { T1: ['New-year bag', '2026-01-10', ['anvil-zline', 'sparrowhawk-pro', 'lantern-pro']], T2: ['Spring bag', '2026-03-10', ['anvil-zline', 'heron-pro', 'comet-pro', 'tamarind-pro', 'sparrowhawk-pro']],
      T3: ['Switch bag', '2026-06-27', ['anvil-zline', 'tamarind-pro', 'comet-pro', 'lantern-pro']], T4: ['Halcyon bag', '2026-07-05', ['comet-pro', 'marlin-star', 'lantern-pro', 'tamarind-pro', 'tamarind-tour', 'gannet-star', 'sparrowhawk-pro']] },
    bio: ['anvil-zline'],
    videos: [
      ['01', '2026-01-17', '10:00', 'long', 480, 'New year, new bag', 'T1', ['early-drop', 0.41], 1,
        [['anvil-zline', 40, 140, 'cd'], ['sparrowhawk-pro', 200, 260, 'cd'], ['lantern-pro', 320, 360, 'c']], [['anvil-zline', 'description'], ['sparrowhawk-pro', 'description'], ['lantern-pro', 'pinned-comment']]],
      ['02', '2026-02-08', '12:00', 'short', 32, 'One disc, one hole #shorts', 'T1', ['loop', 1.04], 3,
        [['anvil-zline', 2, 30, 'cd']], [['anvil-zline', 'pinned-comment']]],
      ['03', '2026-03-14', '09:00', 'long', 500, 'Spring bag: Heron is coming', 'T2', ['linear-decay', 0.43, { dip: [220, 300, 0.12] }], 1.2,
        [['heron-pro', 60, 180, 'cd'], ['anvil-zline', 220, 300, 'cd'], ['comet-pro', 350, 400, 'cd']], [['heron-pro', 'description'], ['anvil-zline', 'description'], ['comet-pro', 'description', 'kestrel']]],
      ['04', '2026-04-04', '11:00', 'long', 440, 'Comet against everything', 'T2', ['early-drop', 0.47], 1,
        [['comet-pro', 30, 150, 'cd'], ['tamarind-pro', 220, 280, 'cd']], [['comet-pro', 'description'], ['tamarind-pro', 'description']]],
      ['05', '2026-04-10', '00:30', 'long', 400, 'Tamarind release night', 'T2', ['exp-decay', 0.5], 1.1,
        [['tamarind-pro', 20, 130, 'cd'], ['anvil-zline', 200, 260, 'cd']], [['tamarind-pro', 'description'], ['tamarind-pro', 'card'], ['anvil-zline', 'pinned-comment']]],
      ['06', '2026-05-01', '07:00', 'long', 380, 'Heron month, day one', 'T2', ['early-drop', 0.4], 1,
        [['heron-pro', 50, 170, 'cd']], [['heron-pro', 'description'], ['heron-pro', 'card']]],
      ['07', '2026-05-31', '20:00', 'long', 420, 'Heron month, last night', 'T2', ['linear-decay', 0.46], 0.9,
        [['heron-pro', 30, 150, 'cd']], [['heron-pro', 'description']]],
      ['08', '2026-06-30', '22:00', 'long', 460, 'The last Brightline video', 'T3', ['early-drop', 0.44, { bump: [330, 0.08, 20] }], 1.2,
        [['anvil-zline', 30, 120, 'cd'], ['comet-pro', 200, 260, 'cd'], ['tamarind-pro', 300, 360, 'cd']], [['anvil-zline', 'description'], ['comet-pro', 'description'], ['lantern-pro', 'description']]],
      ['09', '2026-07-01', '09:00', 'short', 40, 'Switching sides: Halcyon #shorts', 'T3', ['loop', 1.12], 3,
        [['comet-pro', 3, 38, 'cd']], [['comet-pro', 'pinned-comment']]],
      ['10', '2026-08-14', '16:00', 'long', 430, 'Tamarind Tour Series is out', 'T4', ['early-drop', 0.42], 1.1,
        [['tamarind-tour', 30, 150, 'cd'], ['tamarind-pro', 220, 280, 'cd'], ['comet-pro', 330, 390, 'cd']], [['tamarind-tour', 'description'], ['tamarind-tour', 'card'], ['comet-pro', 'description']]],
      ['11', '2026-09-12', '13:00', 'short', 36, 'Quick Gannet look #shorts', 'T4', ['loop', 1.02], 3,
        [['gannet-star', 3, 33, 'cd']], [['gannet-star', 'pinned-comment']]],
      ['12', '2026-10-03', '11:00', 'long', 410, 'Fall bag, same sponsor', 'T4', ['flat', 0.62], 1,
        [['comet-pro', 30, 100, 'cd'], ['marlin-star', 150, 230, 'cd'], ['lantern-pro', 280, 330, 'cd'], ['tamarind-tour', 350, 390, 'cd']], [['comet-pro', 'description'], ['marlin-star', 'description'], ['lantern-pro', 'description']]],
    ],
    deals: [['brightline', '2026-01-01', '2026-06-30', 'all'], ['halcyon', '2026-07-01', '2026-12-31', 'all']] },

  { key: 'jory', name: 'Jory Lindqvist', handle: '@jorythrows', channel: 'Jory Plays Everything', tz: 1, scale: 1500,
    discs: { 'comet-pro': ['comet', 'Pro'], 'sparrowhawk-neutron': ['sparrowhawk', 'Neutron'], 'sparrowhawk-typed': [null, 'Neutron', null, 'sparrow hawk'], 'quill-pro': ['quill', 'Pro'], 'merlin-pro': ['merlin', 'Pro'], 'skerry-pro': ['skerry', 'Pro'], 'halyard-pro': ['halyard', 'Pro'], 'gannet-pro': ['gannet', 'Pro'], 'gannet-reissue': ['gannet', 'Pro', 'Reissue 2026'], 'pipit-pro': ['pipit', 'Pro'], 'wren-pro': ['wren', 'Pro'], 'tamarind-pro': ['tamarind', 'Pro'], 'kittiwake-pro': ['kittiwake', 'Pro'], 'prototype': [null, 'Prototype', null, 'Kestrel Prototype 7'] },
    bags: { J1: ['Everyday bag', '2026-01-25', ['sparrowhawk-neutron', 'quill-pro', 'skerry-pro', 'wren-pro']], J2: ['Early Comet bag', '2026-02-26', ['comet-pro', 'quill-pro', 'halyard-pro', 'sparrowhawk-neutron']],
      J3: ['Midsummer bag', '2026-06-05', ['gannet-pro', 'pipit-pro', 'quill-pro', 'tamarind-pro']], J4: ['Late-summer bag', '2026-07-25', ['kittiwake-pro', 'merlin-pro', 'gannet-pro', 'skerry-pro']],
      J5: ['Reissue bag', '2026-09-28', ['gannet-reissue', 'gannet-pro', 'prototype', 'sparrowhawk-typed', 'quill-pro']] },
    bio: ['sparrowhawk-neutron'],
    videos: [
      ['01', '2026-01-31', '10:00', 'long', 400, 'Everyday bag, no sponsors', 'J1', ['early-drop', 0.38], 1,
        [['sparrowhawk-neutron', 30, 120, 'cd'], ['quill-pro', 200, 260, 'cd'], ['skerry-pro', 300, 350, 'cd']], [['sparrowhawk-neutron', 'description'], ['quill-pro', 'description'], ['skerry-pro', 'pinned-comment']]],
      ['02', '2026-03-01', '14:00', 'long', 360, 'An early look at the Comet', 'J2', ['exp-decay', 0.42, { bump: [150, 0.09, 25] }], 1.2,
        [['comet-pro', 30, 120, 'cd'], ['halyard-pro', 200, 260, 'cd']], [['comet-pro', 'description'], ['comet-pro', 'card'], ['halyard-pro', 'description']]],
      ['03', '2026-04-06', '20:00', 'long', 420, 'Comet, a month on', 'J2', ['linear-decay', 0.47], 1,
        [['comet-pro', 50, 160, 'cd'], ['quill-pro', 250, 300, 'cd']], [['comet-pro', 'description'], ['quill-pro', 'description']]],
      ['04', '2026-05-15', '12:00', 'short', 30, 'Putter or midrange? #shorts', 'J2', ['loop', 1.06], 3,
        [['halyard-pro', 2, 28, 'cd']], [['halyard-pro', 'pinned-comment']]],
      ['05', '2026-06-12', '18:00', 'long', 380, 'Gannet before anyone has one', 'J3', ['early-drop', 0.4], 1,
        [['gannet-pro', 40, 130, 'cd'], ['pipit-pro', 200, 260, 'cd']], [['gannet-pro', 'description'], ['pipit-pro', 'description']]],
      ['06', '2026-07-01', '00:30', 'long', 410, 'Midnight upload: Tamarind', 'J3', ['linear-decay', 0.5, { dip: [150, 230, 0.1] }], 0.9,
        [['tamarind-pro', 30, 110, 'cd']], [['tamarind-pro', 'description']]],
      ['07', '2026-08-01', '09:00', 'long', 390, 'Kittiwake month, day one', 'J4', ['early-drop', 0.45], 1,
        [['kittiwake-pro', 40, 150, 'cd']], [['kittiwake-pro', 'description'], ['kittiwake-pro', 'card']]],
      ['08', '2026-09-05', '15:00', 'long', 400, 'Merlin, one day after release', 'J4', ['exp-decay', 0.44], 1,
        [['merlin-pro', 30, 110, 'cd'], ['skerry-pro', 200, 250, 'cd']], [['merlin-pro', 'description'], ['skerry-pro', 'description']]],
      ['09', '2026-09-30', '16:00', 'long', 430, 'Gannet reissue day', 'J5', ['linear-decay', 0.41], 1,
        [['gannet-reissue', 30, 120, 'cd'], ['gannet-pro', 200, 260, 'cd']], [['gannet-reissue', 'description'], ['gannet-reissue', 'card'], ['gannet-pro', 'description']]],
      ['10', '2026-10-10', '11:00', 'short', 28, 'What is this prototype? #shorts', 'J5', ['loop', 1.05], 3,
        [['prototype', 2, 26, 'cd']], [['prototype', 'pinned-comment']]],
      ['11', '2026-10-20', '10:00', 'long', 350, 'Typed it wrong, still counts', 'J5', null, 0.5,
        [['sparrowhawk-typed', 30, 110, 'cd'], ['quill-pro', 200, 250, 'cd']], [['sparrowhawk-typed', 'description'], ['quill-pro', 'description']]],
    ],
    deals: [] },
];

const PLACE_CODE = { description: 'd', 'pinned-comment': 'p', card: 'c', bio: 'b' };
const HOSTS = { description: ['youtube.com', 'youtube.com', 'm.youtube.com'], 'pinned-comment': ['youtube.com', 'm.youtube.com'], card: ['youtube.com', 'm.youtube.com'], bio: ['instagram.com', 'linktr.ee', 'youtube.com'] };
const COUNTRIES = ['US', 'US', 'US', 'US', 'US', 'CA', 'GB', 'FI', 'AU', 'DE'];

export function buildSeason(seed) {
  const rng = mulberry32(fnv32(`${seed}:season`));
  const out = [];
  const ids = new Set();
  const add = (frame, id, overrides) => {
    if (ids.has(id)) throw new Error(`duplicate id ${id}`);
    ids.add(id);
    const inst = makeInstance(frame, overrides, { id });
    out.push(inst);
    return inst;
  };
  const jitter = (v, spread) => Math.round((v + (rng.next() * 2 - 1) * spread) * 100) / 100;
  const maker = {}, mold = {}, release = {};
  for (const m of MAKERS) {
    maker[m.key] = add('Manufacturer', `maker:${m.key}`, { name: m.name, country: m.country, shopHost: m.host });
    for (const [k, name, kind] of m.molds) mold[k] = add('Mold', `mold:${k}`, { manufacturerId: maker[m.key].id, name, kind });
  }
  const moldMaker = Object.fromEntries(MAKERS.flatMap((m) => m.molds.map(([k]) => [k, m])));
  for (const [k, run, kind, date, precision, windowDays] of RELEASES) {
    const id = `release:${k}${run ? `-${run.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}`;
    release[id] = add('Release', id, { moldId: mold[k].id, runLabel: run, kind, date, datePrecision: precision, windowDays });
  }

  for (const c of CREATORS) {
    const creator = add('Creator', `creator:${c.key}`, { name: c.name, handle: c.handle });
    const channel = add('Channel', `channel:${c.key}`, { creatorId: creator.id, title: c.channel, studioConnected: true, utcOffsetHours: c.tz });
    const shelf = add('Shelf', `shelf:${c.key}`, { creatorId: creator.id });
    for (const [mk, from, to, covered] of c.deals) {
      const moldsCovered = covered === 'all' ? 'all' : covered.map((k) => mold[k].id);
      add('SponsorDeal', `deal:${c.key}-${mk}`, { creatorId: creator.id, manufacturerId: maker[mk].id, start: from, end: to, moldsCovered });
    }
    const disc = {};
    for (const [dk, spec] of Object.entries(c.discs)) {
      const [mk, plastic, run, typed] = spec;
      disc[dk] = add('Disc', `disc:${c.key}-${dk}`, { creatorId: creator.id, shelfId: shelf.id, moldId: mk ? mold[mk].id : null, moldName: typed ?? mold[mk].t.name, plastic, runLabel: run ?? null });
    }
    const bag = {};
    for (const [bk, [name, takenAt, discKeys]] of Object.entries(c.bags)) bag[bk] = add('Bag', `bag:${c.key}-${bk}`, { creatorId: creator.id, name, takenAt, discIds: discKeys.map((d) => disc[d].id), appliedToVideoIds: [] });

    const linkSeq = {};
    const linkOf = {}; // `${disc}|${placement}|${videoNo}` -> link instance
    const newLink = (dk, placement, videoNo, video, hostOverride) => {
      const d = disc[dk], moldKey = d.t.moldId ? d.t.moldId.slice(5) : dk.startsWith('sparrowhawk') ? 'sparrowhawk' : 'prototype', m = moldMaker[moldKey] ?? MAKERS[2];
      const code = `${dk}-${c.handle.slice(1, 5)}-${PLACE_CODE[placement]}${videoNo ?? 'bio'}`;
      const host = hostOverride ? MAKERS.find((x) => x.key === hostOverride).host : m.host;
      const link = add('Link', `link:${c.key}-${dk}-${PLACE_CODE[placement]}${videoNo ?? 'bio'}`, { creatorId: creator.id, code, discId: d.id, destination: `https://${host}/discs/${moldKey}?ref=${code}`, placement, videoId: video ? video.id : null });
      linkOf[`${dk}|${placement}|${videoNo}`] = link;
      return link;
    };
    const clicksFor = (link, video, cardsOfDisc, publishedMs, count) => {
      // clicks spread over the days after publish, a few exactly on the edges that matter
      const stamps = [];
      const ts = [];
      if (link.t.placement === 'card' && cardsOfDisc.length) {
        const card = cardsOfDisc[0];
        ts.push(card.t.startSec, card.t.endSec - 1, card.t.endSec, Math.floor((card.t.startSec + card.t.endSec) / 2));
        if (card.t.startSec >= 1) ts.push(card.t.startSec - 1);
      }
      const n = link.t.placement === 'card' ? Math.max(count, ts.length + 2) : count;
      for (let k = 0; k < n; k++) {
        const r = rng.next();
        const day = r < 0.4 ? 0 : r < 0.6 ? 1 : r < 0.75 ? rng.int(2, 3) : r < 0.9 ? rng.int(4, 14) : rng.int(15, 60);
        let ms = publishedMs + day * 864e5 + rng.int(0, 86399) * 1000;
        if (ms > Date.parse(NOW)) ms = Date.parse(NOW) - rng.int(0, 40000) * 1000;
        if (ms < publishedMs) ms = publishedMs + rng.int(1, 3600) * 1000;
        const timestamp = link.t.placement === 'card' ? (k < ts.length ? ts[k] : rng.int(0, video.t.durationSeconds - 1)) : null;
        stamps.push({ ms, timestamp });
      }
      return stamps;
    };

    const bagVideos = Object.fromEntries(Object.keys(c.bags).map((k) => [k, []]));
    const videoNos = {};
    for (const spec of c.videos) {
      const [no, day, hhmm, kind, dur, title, bagKey, curveSpec, viewMult, items, linkSpecs] = spec;
      const publishedAt = instantAt(day, hhmm, c.tz);
      const base = Math.round(c.scale * viewMult * (kind === 'short' ? 2.2 : 1) * (0.8 + rng.next() * 0.5));
      const pubMs = Date.parse(publishedAt);
      const snaps = [];
      for (const [d, f] of [[7, 0.55], [30, 0.85], [90, 1]]) {
        const at = addDays(day, d) <= SEASON_END ? addDays(day, d) : SEASON_END;
        if (at < day) continue;
        const views = Math.round(base * f);
        const last = snaps[snaps.length - 1];
        if (last && last.at === at) last.views = views; else snaps.push({ at, views });
      }
      if (viewMult === 0) { snaps.length = 0; snaps.push({ at: SEASON_END, views: 0 }); }
      const video = add('Video', `video:${c.key}-${no}`, { channelId: channel.id, title, publishedAt, kind, durationSeconds: dur, viewSnapshots: snaps });
      videoNos[no] = video;
      bagVideos[bagKey].push(video.id);
      if (curveSpec) {
        const [shape, end, extra = {}] = curveSpec;
        add('RetentionCurve', `curve:${c.key}-${no}`, {
          videoId: video.id, seconds: dur, shape, endLevel: shape === 'loop' ? end : jitter(end, 0.03),
          dip: extra.dip ? { from: extra.dip[0], to: extra.dip[1], depth: extra.dip[2] } : null, bump: extra.bump ? { at: extra.bump[0], height: extra.bump[1], width: extra.bump[2] } : null,
        });
      }
      const cards = {};
      let n = 0;
      for (const [dk, a, b, how] of items) {
        n++;
        const d = disc[dk];
        if (how.includes('c')) cards[dk] = [...(cards[dk] ?? []), add('CardPlacement', `card:${c.key}-${no}-${dk}-${n}`, { videoId: video.id, discId: d.id, startSec: a, endSec: b })];
        if (how.includes('d')) add('Appearance', `mark:${c.key}-${no}-${dk}-${n}`, { videoId: video.id, discId: d.id, startSec: a + 2, endSec: b - 2, mode: 'thrown', evidence: n % 3 === 0 ? 'creator-marked' : 'throw-log' });
        if (how === 't') add('Appearance', `mark:${c.key}-${no}-${dk}-${n}`, { videoId: video.id, discId: d.id, startSec: a, endSec: b, mode: 'talked', evidence: 'creator-marked' });
      }
      for (const [dk, placement, wrongBrand] of linkSpecs) {
        const link = newLink(dk, placement, no, video, wrongBrand);
        const heavy = placement === 'card' ? 8 : placement === 'description' ? 7 : 4;
        const count = viewMult === 0 ? 0 : Math.min(14, Math.max(2, Math.round(heavy * (0.6 + rng.next() * 0.9) * Math.min(1.6, base / 2500 + 0.4))));
        const stamps = clicksFor(link, video, cards[dk] ?? [], pubMs, count);
        stamps.forEach((s, k) => add('Click', `click:${link.id.slice(5)}-${String(k + 1).padStart(2, '0')}`, { linkId: link.id, at: new Date(s.ms).toISOString().replace('.000Z', 'Z'), refererHost: rng.pick(HOSTS[placement]), country: rng.pick(COUNTRIES), videoTimestamp: s.timestamp }));
      }
    }
    for (const [bk, vids] of Object.entries(bagVideos)) bag[bk].t.appliedToVideoIds = vids;
    // bio links belong to the creator, not to a video
    for (const dk of c.bio) {
      const link = newLink(dk, 'bio', null, null);
      const first = Date.parse(instantAt(c.videos[0][1], '12:00', c.tz));
      const count = 9 + rng.int(0, 5);
      for (let k = 0; k < count; k++) {
        const ms = Math.min(Date.parse(NOW) - 1000, first + rng.int(0, 240) * 864e5 + rng.int(0, 86399) * 1000);
        add('Click', `click:${link.id.slice(5)}-${String(k + 1).padStart(2, '0')}`, { linkId: link.id, at: new Date(ms).toISOString().replace('.000Z', 'Z'), refererHost: rng.pick(HOSTS.bio), country: rng.pick(COUNTRIES), videoTimestamp: null });
      }
    }
  }
  // click timing on the publish edge: one second before and exactly at the publish instant of Maren's Comet day-one video
  const video = out.find((i) => i.id === 'video:maren-03'), link = out.find((i) => i.id === 'link:maren-comet-pro-d03');
  const pub = Date.parse(video.t.publishedAt);
  out.push(makeInstance('Click', { linkId: link.id, at: new Date(pub - 1000).toISOString().replace('.000Z', 'Z'), refererHost: 'youtube.com', country: 'US', videoTimestamp: null }, { id: 'click:maren-comet-pro-d03-edge-before' }));
  out.push(makeInstance('Click', { linkId: link.id, at: new Date(pub).toISOString().replace('.000Z', 'Z'), refererHost: 'youtube.com', country: 'US', videoTimestamp: null }, { id: 'click:maren-comet-pro-d03-edge-at' }));
  return out;
}
export const SEASON_SUMMARY = () => ({ creators: CREATORS.map((c) => c.name), makers: MAKERS.length, molds: MAKERS.reduce((s, m) => s + m.molds.length, 0), releases: RELEASES.length });
void dayDiff;
