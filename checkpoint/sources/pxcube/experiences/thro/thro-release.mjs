// thro/release/match: does a card's photo and listing actually show the RELEASE the video advertised?
// Sam, 26 Oct 11:16-11:32: "we'll eventually need to resolve releases against photos. Infinite puts EVERY disc in a mold under
// the same link" ... "Guarantee idea: I like it. We could even design a pattern matched predicate maybe?"
//
// A Release is a pattern of fields: { mold, plastic, player, series, year, date }.
//   - Definitions come from agreement: a field enters a release's definition only when listings at >= 2 different shops agree.
//   - A card's CLAIM is what its page says (the video's line or the listing title); the claim picks the release definition.
//   - A card's EVIDENCE is only what the shop shows: listing title + tags, the photo's filename, the photo's upload date
//     (Shopify CDN ?v= epoch; Infinite's yyyymmdd filename prefix).
// The predicate is three-valued per field: Proven, Contradicted, Unknown. A card claiming a release fails the guarantee on
// ANY Contradicted field (Neutron photo for an Eclipse 2.0 Glow release; a 2023 photo for a 2026 release). Unknowns pass but
// the card may not call itself that release.
import { register } from './thro-calculations.mjs';

// ---- vocabulary -------------------------------------------------------------------------------------------------------
// Plastics: canonical token -> family. Longer phrases first. A release's plastic is a SET of families; overlap = proven.
const PLASTICS = [
  ['eclipse 2.0 glow', 'eclipse'], ['eclipse 2.0', 'eclipse'], ['eclipse glow', 'eclipse'], ['eclipse rim', 'eclipse-rim'], ['eclipse', 'eclipse'],
  ['particle proton', 'proton'], ['prism proton', 'proton'], ['proton', 'proton'], ['cosmic neutron', 'neutron'], ['prism neutron', 'neutron'], ['neutron', 'neutron'],
  ['plasma', 'plasma'], ['fission', 'fission'], ['electron', 'electron'], ['total eclipse', 'eclipse'],
  ['big z', 'z'], ['z flx', 'z'], ['esp flx', 'esp'], ['esp', 'esp'], ['titanium', 'titanium'], ['jawbreaker', 'jawbreaker'], ['mega glo', 'glo'], ['superglow', 'glo'], ['colorshift', 'colorshift'], ['cryztal', 'cryztal'], ['x swirl', 'x'],
  ['halo star', 'star'], ['gstar', 'gstar'], ['star', 'star'], ['champion proto glow', 'champion'], ['proto glow', 'champion'], ['champion', 'champion'], ['halo s-blend', 's-blend'], ['s-blend', 's-blend'], ['i-blend', 'i-blend'], ['c-blend', 'c-blend'], ['dx', 'dx'], ['xt', 'xt'],
  ['lucid-ice', 'lucid'], ['lucid ice', 'lucid'], ['lucid', 'lucid'], ['biofuzion', 'fuzion'], ['fuzion', 'fuzion'], ['fluid', 'fluid'], ['moonshine', 'moonshine'],
  ['opto', 'opto'], ['gold', 'gold'], ['vip', 'vip'], ['tournament', 'tournament'], ['k1 glow', 'k1'], ['k1', 'k1'], ['k3', 'k3'],
  ['c-line', 'c-line'], ['s-line', 's-line'], ['d-line', 'd-line'], ['p-line', 'p-line'], ['q-line', 'q-line'], ['neo', 'neo'], ['evolution', 'neo'], ['lux', 'lux'], ['vapor', 'vapor'], ['horizon', 'horizon'],
  ['750 glimmer', '750'], ['750 spectrum', '750'], ['750', '750'], ['500', '500'], ['400 spectrum', '400'], ['400 glow', '400'], ['400', '400'], ['350g', '350g'], ['300', '300'],
  ['eraser', 'eraser'], ['apex', 'apex'], ['eternal', 'eternal'], ['sublime', 'sublime'], ['moondust', 'moondust'], ['proline', 'proline'], ['ethos', 'ethos'], ['nerve', 'nerve'], ['aura', 'aura'],
];
// most specific event first: a release is keyed by its most specific series word (a Halloween Team Series disc is a Halloween release)
// a mold whose name is also a plastic word (the library has a disc called "Particle") must not claim "Particle Proton Trail"
const PLASTIC_WORDS = new Set(PLASTICS.flatMap(([p]) => p.split(' ')));
const SERIES = [['halloween', 'halloween'], ['usdgc', 'usdgc'], ['world championship', 'worlds'], ['world champion', 'worlds'], ['otb open', 'otb'], ['ledgestone', 'ledgestone'],
  ['tour series', 'tour'], ['team series', 'team'], ['signature series', 'signature'], ['first run', 'first-run'], ['prototype', 'proto'], ['collab', 'collab'], ['exclusive', 'exclusive']];
export const topSeries = set => SERIES.map(x => x[1]).find(s => set.has(s)) ?? null;
const lc = s => String(s ?? '').toLowerCase().replace(/[‐-―]/g, '-');
// split a filename into words: "NeutronControl-Blue-1k" -> "neutron control blue 1k"
export const filenameWords = u => lc(decodeURIComponent(String(u ?? '').split('/').pop().split('?')[0]).replace(/\.[a-z0-9]+$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' '));
function find(list, text) { const t = ` ${lc(text).replace(/[^a-z0-9.\- ]+/g, ' ')} `, out = new Set(); let rest = t;
  for (const [phrase, fam] of list) { const re = new RegExp(`(?<=[ ])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[ ])`, 'g'); if (re.test(rest)) { out.add(fam); rest = rest.replace(re, ' '); } }
  return out; }
export const plastics = text => find(PLASTICS, text);
export const series = text => find(SERIES, text);
export const years = text => new Set((String(text ?? '').match(/\b20[12]\d\b/g) ?? []).map(Number));
// Players: learned from catalogs (a capitalised name directly before a series word, seen at >= 2 listings).
export function learnPlayers(listings) {
  // a person's name: 2-3 capitalised words (McMahon, O'Brien allowed) right before a release word; brand, plastic and release
  // words are never part of a name ("Team Series", "Mega Glo", "Special Edition" were learned as players before this list)
  const STOP = new Set(['Halloween', 'Team', 'Series', 'Tour', 'Special', 'Edition', 'Mega', 'Glo', 'Glow', 'Disc', 'Discs', 'Golf', 'Used', 'Swirl', 'Swirled', 'Seasonal',
    'Signature', 'Limited', 'First', 'Run', 'Proto', 'Prototype', 'Collab', 'Exclusive', 'Champion', 'Championship', 'World', 'Worlds', 'Edition', 'Stamp', 'Open', 'Preserve',
    'MVP', 'Axiom', 'Streamline', 'Discraft', 'Innova', 'Discmania', 'Kastaplast', 'Dynamic', 'Prodigy', 'Latitude', 'Westside', 'Halo', 'Star', 'Eclipse', 'Neutron', 'Proton',
    'Plasma', 'Electron', 'Cosmic', 'Particle', 'Prism', 'Lucid', 'Fuzion', 'Big', 'Neo', 'Evolution', 'Fission', 'Climo', 'SE', 'LE', 'ESP', 'Z', 'Rim', 'Lab', 'Coat', 'Project']);
  const count = new Map();
  for (const l of listings) for (const m of String(l.title).matchAll(/((?:[A-Z][a-zA-Z'’]+ ){1,3})(?:'s )?(?:\d{4} )?(?:Halloween|Tour Series|Team Series|Signature|World Champ|Collab|Takeover|"|“)/g)) {
    const words = m[1].trim().split(' ').filter(w => !STOP.has(w));
    const n = words.slice(-3).join(' ');
    if (words.length >= 2 && words.length <= 3) count.set(n, (count.get(n) ?? 0) + 1);
  }
  return [...count].filter(([, c]) => c >= 2).map(([n]) => n).sort((a, b) => b.length - a.length);
}
export const playersIn = (text, players) => new Set(players.filter(p => lc(text).includes(lc(p))));
// photo upload date: Shopify CDN ?v=<epoch seconds>; Infinite filename prefix yyyymmdd
export function photoDate(url) {
  const v = String(url ?? '').match(/[?&]v=(\d{10})\b/); if (v) return new Date(+v[1] * 1000);
  const f = String(url ?? '').split('/').pop().match(/^(20\d\d)(\d\d)(\d\d)/); if (f) return new Date(`${f[1]}-${f[2]}-${f[3]}T12:00:00Z`);
  return null;
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function claimDate(text, defaultYear) { const m = lc(text).match(new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)); return m && defaultYear ? new Date(Date.UTC(defaultYear, MONTHS.indexOf(m[1]), +m[2], 12)) : null; }

// ---- fields of a text (title + tags) ----------------------------------------------------------------------------------
export function fieldsOf(text, players) { return { plastic: plastics(text), series: series(text), player: playersIn(text, players), year: years(text) }; }

// ---- release definitions by cross-shop agreement ----------------------------------------------------------------------
// key: mold + series family (+ year when stated). A field value enters the definition when >= 2 shops show it.
export function defineReleases(listings, players, molds) {
  const groups = new Map();
  for (const l of listings) {
    const text = `${l.title} ${(l.tags ?? []).join(' ')}`, f = fieldsOf(text, players);
    if (!f.series.size && !f.player.size) continue;                       // not a release listing
    const mold = molds.find(m => !PLASTIC_WORDS.has(m.toLowerCase()) && new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l.title)); if (!mold) continue;
    const yr = [...f.year][0] ?? photoDate(l.image)?.getUTCFullYear() ?? null;
    const top = SERIES.map(x => x[1]).find(s => f.series.has(s));
    for (const s of top ? [top] : []) {
      const key = `${lc(mold)}|${s}|${yr ?? '?'}`;
      if (!groups.has(key)) groups.set(key, { mold, series: s, year: yr, listings: [] });
      groups.get(key).listings.push({ shop: l.shop, title: l.title, f });
    }
  }
  const defs = [];
  for (const g of groups.values()) {
    const shops = new Set(g.listings.map(x => x.shop)); if (shops.size < 2) continue;
    const agree = field => { const by = new Map(); for (const x of g.listings) for (const v of x.f[field]) { if (!by.has(v)) by.set(v, new Set()); by.get(v).add(x.shop); } return new Set([...by].filter(([, s]) => s.size >= 2).map(([v]) => v)); };
    defs.push({ id: `${g.mold} · ${g.series}${g.year ? ' ' + g.year : ''}`, mold: g.mold, series: new Set([g.series, ...agree('series')]), year: g.year,
      plastic: agree('plastic'), player: agree('player'), shops: [...shops], listings: g.listings.map(x => `${x.shop}: ${x.title}`) });
  }
  return defs;
}

// ---- the predicate -----------------------------------------------------------------------------------------------------
// pattern: { mold, plastic:Set, player:Set, series:Set, year, date }  evidence: { text (listing title+tags), photo (url) }
export function matchRelease(pattern, ev, players) {
  const listing = fieldsOf(ev.text ?? '', players), file = fieldsOf(filenameWords(ev.photo), players);
  const pd = photoDate(ev.photo), out = {};
  const setField = (name, want, sources) => {
    if (!want || !want.size) return;
    const seen = new Map(); for (const [src, vals] of sources) for (const v of vals) (seen.get(v) ?? seen.set(v, []).get(v)).push(src);
    const hit = [...want].filter(v => seen.has(v));
    if (hit.length) out[name] = { status: 'Proven', want: [...want], by: hit.map(v => `${v} (${seen.get(v).join(', ')})`) };
    else if (seen.size) out[name] = { status: 'Contradicted', want: [...want], by: [...seen].map(([v, s]) => `${v} (${s.join(', ')})`) };
    else out[name] = { status: 'Unknown', want: [...want], by: [] };
  };
  setField('plastic', pattern.plastic, [['listing', listing.plastic], ['photo filename', file.plastic]]);
  setField('player', pattern.player, [['listing', listing.player], ['photo filename', file.player]]);
  // series: another event's series word is not a contradiction by itself (a Halloween disc can also be Team Series), only proof
  if (pattern.series?.size) { const hit = [...pattern.series].filter(s => listing.series.has(s) || file.series.has(s));
    out.series = hit.length ? { status: 'Proven', want: [...pattern.series], by: hit.map(s => `${s} (${listing.series.has(s) ? 'listing' : 'photo filename'})`) } : { status: 'Unknown', want: [...pattern.series], by: [] }; }
  // time: a photo uploaded long before the release cannot show it. 60 days: preorder photos go up days or weeks early (Rare and
  // Armory photographed the Halloween 2026 discs the day before release); a June photo for a September release is a stock photo.
  if (pattern.date || pattern.year) {
    const rel = pattern.date ?? new Date(Date.UTC(pattern.year, 0, 1));
    const yrs = new Set([...listing.year, ...file.year]);
    if (pd && pd < new Date(rel.getTime() - 60 * 864e5)) out.time = { status: 'Contradicted', want: [rel.toISOString().slice(0, 10)], by: [`photo uploaded ${pd.toISOString().slice(0, 10)}`] };
    else if (pattern.year && yrs.size && !yrs.has(pattern.year)) out.time = { status: 'Contradicted', want: [String(pattern.year)], by: [...yrs].map(y => `${y} (listing/photo)`) };
    else if (pd || yrs.has(pattern.year)) out.time = { status: 'Proven', want: [rel.toISOString().slice(0, 10)], by: [pd ? `photo uploaded ${pd.toISOString().slice(0, 10)}` : `${pattern.year} (listing)`] };
    else out.time = { status: 'Unknown', want: [rel.toISOString().slice(0, 10)], by: [] };
  }
  const st = Object.values(out).map(x => x.status);
  return { fields: out, verdict: st.includes('Contradicted') ? 'Contradicted' : st.length && st.every(s => s === 'Proven') ? 'Proven' : 'Unknown' };
}

register({
  id: 'thro/release/match', description: 'a card that claims a release (Halloween, a tour series, a player edition) must not show a photo/listing that contradicts it',
  calculate: ({ pattern, evidence, players }) => matchRelease(pattern, evidence, players),
  witnessItem: (item, out, ms) => ({ name: item.name, ms, claims: item.claims, verdict: out.verdict, fields: out.fields, metrics: { maxRelExcursion: out.verdict === 'Contradicted' ? 1 : 0 } }),
  guarantees: [
    { id: 'G1_NoContradiction', description: 'no card that claims a release shows a contradicting plastic, player or photo date', check: items => { const f = items.filter(x => x.claims && x.verdict === 'Contradicted'); return { passed: !f.length, passCount: items.length - f.length, totalCount: items.length, metric: `${f.length} contradicted`, failures: f.map(x => x.name) }; } },
  ],
});
