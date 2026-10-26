import fs from 'node:fs';
import { enter } from '/home/claude/pagerouter/checkpoint/sources/pxcube/experiences/thro/thro-calculations.mjs';
import { defineReleases, learnPlayers, fieldsOf, claimDate, plastics, topSeries } from '/home/claude/pagerouter/checkpoint/sources/pxcube/experiences/thro/thro-release.mjs';
// Usage: node release-check.mjs CATALOG_DIR   (CATALOG_DIR holds <shop>-catalog.json from kit/shopkit.py and molds.json)
const S = process.argv[2];
const shops = JSON.parse(fs.readFileSync('/home/claude/pagerouter/checkpoint/sources/pxcube/experiences/thro-shops/data/shops.json'));
const catFiles = { icebergtv: `${S}/thro-shops/icebergtv-catalog.json`, premiumdg: `${S}/thro-shops/premiumdg-catalog.json`, raredg: `${S}/thro-shops/raredg-catalog.json` };
for (const k of ['anotherround', 'armory', 'dynamic', 'foundation', 'mvpproshop', 'sixsided', 'trashpanda', 'doomsday']) catFiles[k] = `${S}/new/${k}-catalog.json`;
const catalogs = {}, listings = [];
for (const [k, f] of Object.entries(catFiles)) { const c = JSON.parse(fs.readFileSync(f)); catalogs[k] = new Map(c.map(p => [p.handle, p]));
  for (const p of c) listings.push({ shop: k, title: p.title, tags: Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(','), image: p.image }); }
const players = learnPlayers(listings);
const libMolds = JSON.parse(fs.readFileSync(`${S}/molds.json`)).map(m => m.mold);
const cardMolds = [...new Set(Object.values(shops).flatMap(o => [...o.videos, ...o.drops].flatMap(v => v.discs.map(d => d.mold))))];
const molds = [...new Set([...cardMolds, ...libMolds])].filter(m => m.length >= 3).sort((a, b) => b.length - a.length);
const defs = defineReleases(listings, players, molds);
console.log(listings.length, 'listings,', players.length, 'players learned,', defs.length, 'release definitions');
const items = [];
for (const [k, o] of Object.entries(shops)) for (const v of [...o.videos, ...o.drops]) for (const d of v.discs) {
  const claimText = d.productTitle || '', yr = +String(v.published).slice(0, 4);
  const c = fieldsOf(claimText, players); const claims = c.series.size > 0 || c.player.size > 0;
  const handle = d.linkKind === 'product' ? d.link.split('/products/')[1]?.split(/[?#]/)[0] : null;
  const shopCat = catalogs[k];
  const listing = handle && shopCat?.get(handle) || (shopCat && [...shopCat.values()].find(p => p.title === d.imageFrom)) || null;
  const evText = listing ? `${listing.title} ${(Array.isArray(listing.tags) ? listing.tags : []).join(' ')}` : '';
  const date = claimDate(claimText, yr), year = [...c.year][0] ?? (date ? yr : null);   // a year only when the claim states one (or a date)
  let def = null;
  // a claim names a RELEASE only through a series word (Halloween, tour series, USDGC...); a player-only claim is checked as itself.
  // Without a stated year, the release nearest the video's date wins (Armory's Conrad Halloween Trail is 2026, not 2025).
  if (claims) { const ts = topSeries(c.series); const cand = ts ? defs.filter(x => x.mold.toLowerCase() === d.mold.toLowerCase() && x.id.split(' · ')[1].split(' ')[0] === ts && (!year || !x.year || x.year === year)) : [];
    cand.sort((a, b) => Math.abs((a.year ?? yr) - yr) - Math.abs((b.year ?? yr) - yr) || ([...c.player].some(p => b.player.has(p)) - [...c.player].some(p => a.player.has(p))));
    def = cand[0] ?? null; }
  const pattern = def ? { mold: d.mold, plastic: def.plastic, player: def.player, series: def.series, year: year ?? def.year, date }
                      : { mold: d.mold, plastic: c.plastic, player: c.player, series: c.series, year, date };
  items.push({ name: `${k}/${d.cardBase ?? d.mold}`, shop: k, video: v.title, mold: d.mold, card: d.cardBase, claimText, claims, def: def?.id ?? null, defShops: def?.shops ?? [], defListings: def?.listings ?? [],
    evidenceText: evText, photo: d.image, pattern: { ...pattern, plastic: [...(pattern.plastic ?? [])], player: [...(pattern.player ?? [])], series: [...(pattern.series ?? [])] },
    input: { pattern, evidence: { text: evText, photo: d.image }, players } });
}
const claimed = items.filter(x => x.claims);
const rep = enter('thro/release/match', claimed.map(x => ({ name: x.name, claims: true, pattern: x.input.pattern, evidence: x.input.evidence, players })));
const byName = new Map(rep.items.map(i => [i.name, i]));
const out = claimed.map(x => ({ ...x, input: undefined, verdict: byName.get(x.name).verdict, fields: byName.get(x.name).fields }));
fs.writeFileSync(`${S}/release-results.json`, JSON.stringify({ guarantee: Object.values(rep.guarantees).map(g => ({ id: g.id, passed: g.passed, metric: g.metric })), status: rep.selfGuaranteeStatus,
  totals: { cards: items.length, claimingRelease: claimed.length }, defs: defs.map(d => ({ ...d, series: [...d.series], plastic: [...d.plastic], player: [...d.player] })), players, results: out }, null, 1));
console.log('cards', items.length, '| claiming a release', claimed.length, '| guarantee', rep.selfGuaranteeStatus);
const tally = {}; for (const x of out) tally[`${x.shop} ${x.verdict}`] = (tally[`${x.shop} ${x.verdict}`] ?? 0) + 1; console.log(tally);
for (const x of out) console.log(x.verdict.padEnd(12), x.shop.padEnd(12), x.claimText.slice(0, 60).padEnd(61), '| def:', (x.def ?? 'own claim').padEnd(28), '|', Object.entries(x.fields).map(([f, r]) => `${f}:${r.status[0]}${r.status !== 'Proven' && r.by.length ? '[' + r.by.join(';') + ']' : ''}`).join(' '));
