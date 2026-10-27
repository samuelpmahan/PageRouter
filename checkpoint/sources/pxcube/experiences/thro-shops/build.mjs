// thro shop pages: thro.pages.dev/<handle> for three shops (Sam, 26 Oct 00:44: evidence, not a pitch).
// Each page = the shop's recent videos and the discs featured in them, each disc a ThroCard that links to the product page on the
// shop's own website. Data: data/shops.json, built from public video titles/descriptions/captions and the shop's public catalog;
// cards rendered by thro's own pipeline (thro/crop/live -> unwarp -> cutout through registered Calculations, then the card
// renderer, layout u02). No views, clicks or prices. Usage: node build.mjs OUT_DIR
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipStore } from '../thro/editor-zip.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(root, 'out'));
const shops = JSON.parse(fs.readFileSync(path.join(root, 'data/shops.json'), 'utf8'));
// The thro logo, traced from Sam's logo PNG (experiences/thro/brand): ink + orange arrow, sized by CSS.
const LOGO = fs.readFileSync(path.join(root, '../thro/brand/thro-logo.svg'), 'utf8').replace(/ width="\d+" height="\d+"/, '').replace('<svg ', '<svg class="logo" ');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const date = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const flight = f => f ? f.map(n => Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, '')).join(' | ') : '';
function evidence(d, v) {
  if (d.at != null && v.id) return `<a href="https://www.youtube.com/watch?v=${v.id}&t=${Math.floor(d.at)}s" rel="noopener">said at ${clock(d.at)}</a>`;
  if (/^title/.test(d.evidence)) return 'named in the title';
  if (/^description/.test(d.evidence)) return 'named in the description';
  if (d.evidence === 'blog') return 'in the release post';
  if (/^linked/.test(d.evidence)) { const what = d.evidence.replace(/^linked:?\s*/, ''); return what && what !== 'product' ? `linked in the description <small>(${esc(what)})</small>` : 'linked in the description'; }
  if (d.evidence === 'title') return 'named in the title';
  return '';
}
function tile(d, v, handle, shop) {
  const name = `${esc(d.vendorFromShop || d.manufacturer)} ${esc(d.mold)}`;
  const card = d.cardBase ? `cards/${d.cardBase}-u02.webp` : null;
  const crop = d.cropOk ?? d.statuses?.every(s => s.endsWith('PASS'));  // cropOk: the final crop is witnessed (a silhouette refit may replace a failed first fit)
  let art;
  if (card && crop) art = `<img src="${card}" alt="${name} ThroCard" loading="lazy" width="460" height="694">`;
  else if (d.photoTile) art = `<div class="photo"><img src="cards/${esc(d.photoTile)}" alt="${name}" loading="lazy"><span>${esc(d.photoNote ?? "Not round, so no ThroCard: the shop's own photo.")}</span></div>`;
  else art = `<div class="missing"><b>${esc(d.mold)}</b><span>Not listed at ${esc(shop)} right now</span></div>`;
  const label = d.linkKind === 'product' ? esc(d.productTitle) : `Search ${esc(shop)} for “${esc(d.mold)}”`;
  const status = d.linkKind === 'product' && d.available === false ? '<em>sold out</em>' : '';
  const href = d.image || d.linkKind === 'product' ? d.link : d.link;
  return `<li><a class="card" href="${esc(href)}" rel="noopener">${art}<span class="what">${label} ${status}</span></a><span class="how">${evidence(d, v)}</span></li>`;
}
let sectionNo = 0;
const slug = t => { const w = String(t).replace(/[^A-Za-z0-9]+/g, ' ').trim(); return w.length <= 60 ? w : w.slice(0, 60).replace(/ \S*$/, ''); };
const kb = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
// The download Sam offers in the DM: every card in a section as a transparent PNG (690x1041, drop straight into CapCut or Premiere)
// plus the round disc cutout on its own (800x800), one zip per video or drop.
function packEntries(v, num) {
  const e = [];
  v.discs.forEach((d, i) => {
    if (!d.cardBase || !(d.cropOk ?? d.statuses?.every(x => x.endsWith('PASS')))) return;
    const n = `${String(i + 1).padStart(2, '0')} ${slug(d.mold)}`;
    e.push({ name: `${n} - card.png`, data: new Uint8Array(fs.readFileSync(path.join(root, 'cards', `${d.cardBase}-card.png`))) });
    e.push({ name: `${n} - disc.png`, data: new Uint8Array(fs.readFileSync(path.join(root, 'cards', `${d.cardBase}-cut.png`))) });
  });
  return e;
}
let pageDir = null;
function download(v, num) {
  const entries = packEntries(v, num);
  if (!entries.length) return '';
  const file = `downloads/${String(num).padStart(2, '0')}-${slug(v.title).replace(/ /g, '-').toLowerCase()}.zip`;
  const bytes = zipStore(entries);
  fs.mkdirSync(path.join(pageDir, 'downloads'), { recursive: true });
  fs.writeFileSync(path.join(pageDir, file), bytes);
  return `<a class="dl" href="${file}" download>${entries.length === 2 ? 'Download this card' : `Download these ${entries.length / 2} cards`} <small>transparent PNG · ${kb(bytes.length)}</small></a>`;
}
function section(v, handle, shop, kind) {
  sectionNo++;
  const names = v.discs.map(d => esc(d.mold)).join(', ');
  const head = kind === 'video'
    ? `<a class="vt" href="${esc(v.url)}" rel="noopener">${esc(v.title)}</a>`
    : `<a class="vt" href="${esc(v.url)}" rel="noopener">${esc(v.title)}</a>`;
  return `<section><header><span class="no">No. ${String(sectionNo).padStart(2, '0')}</span><span class="kind">${kind === 'video' ? 'Video' : 'Release post'} · ${date(v.published)}</span>${head}<p class="bag">${kind !== 'video' ? 'In the drop' : v.discs.every(d => /^linked/.test(d.evidence)) ? 'Linked in the description' : 'Featured'}: ${names}</p>${download(v, sectionNo)}</header><ol class="grid">${v.discs.map(d => tile(d, v, handle, shop)).join('')}</ol></section>`;
}
const css = fs.readFileSync(path.join(root, 'page.css'), 'utf8');
for (const [handle, s] of Object.entries(shops)) {
  sectionNo = 0;
  const dir = path.join(out, handle); pageDir = dir;
  fs.mkdirSync(path.join(dir, 'cards'), { recursive: true });
  for (const v of [...s.videos, ...s.drops]) for (const d of v.discs) if (d.cardBase) fs.copyFileSync(path.join(root, 'cards', `${d.cardBase}-u02.webp`), path.join(dir, 'cards', `${d.cardBase}-u02.webp`));
  for (const v of [...s.videos, ...s.drops]) for (const d of v.discs) if (d.photoTile) fs.copyFileSync(path.join(root, 'cards', d.photoTile), path.join(dir, 'cards', d.photoTile));
  const title = s.name === s.shopName ? s.name : `${s.name} × ${s.shopName}`;
  const main = s.videos.map(v => section(v, handle, s.shopName, 'video')).join('') + s.drops.map(v => section(v, handle, s.shopName, 'drop')).join('');
  const all = '';
  const vars = s.signal ? ` style="--signal:${esc(s.signal)};--signal2:${esc(s.signal2 ?? '#1f6f68')}"` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · featured discs</title>
<meta name="description" content="The discs from ${esc(s.name)}'s recent videos, each linking to ${esc(s.domain)}.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' stroke='%23c8f49d' stroke-width='3'%3E%3Ccircle cx='16' cy='16' r='13'/%3E%3Ccircle cx='16' cy='16' r='5.75'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style></head><body class="${handle}"${vars}>
<nav class="brandbar"><a href="https://thro.pages.dev/" aria-label="thro">${LOGO}</a><span>Show what you thro</span></nav><header class="top"><svg class="burst" viewBox="-100 -100 200 200" aria-hidden="true">${Array.from({length:16},(_, i)=>`<line x1="0" y1="0" x2="${(Math.cos(i*Math.PI/8)*(i%2?62:96)).toFixed(1)}" y2="${(Math.sin(i*Math.PI/8)*(i%2?62:96)).toFixed(1)}" stroke="#2b2420" stroke-width="${i%2?3:5}" stroke-linecap="round"/>`).join('')}<circle r="22" fill="#f3e8d2" stroke="#2b2420" stroke-width="5"/><circle r="7" fill="#2b2420"/></svg><div class="inner"><p class="eyebrow">From the camera of</p><h1>${esc(s.name)}</h1><p class="sub">${s.name === s.shopName ? '' : `with ${esc(s.shopName)} · `}every disc from these videos, one tap from <a href="https://${esc(s.domain)}" rel="noopener">${esc(s.domain)}</a></p>${all}</div></header>
<main>${main}</main>
<footer><a class="foot-logo" href="https://thro.pages.dev/" aria-label="thro">${LOGO}</a> A prototype made with thro. Not affiliated with ${esc(s.shopName)}${s.name === s.shopName ? '' : ` or ${esc(s.name)}`}. Discs come from the public videos (the title, the description and the shop links in it, or what's said on camera); every card links to ${esc(s.domain)}.</footer>
</body></html>`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(handle, [...s.videos, ...s.drops].reduce((n, v) => n + v.discs.length, 0), 'discs');
}
// Parked shops (data/parked.json): their old URLs get a plain "taken down" page, so nobody lands on a stale copy.
const parkedFile = path.join(root, 'data/parked.json');
if (fs.existsSync(parkedFile)) for (const [handle, p] of Object.entries(JSON.parse(fs.readFileSync(parkedFile, 'utf8')))) {
  fs.mkdirSync(path.join(out, handle), { recursive: true });
  fs.writeFileSync(path.join(out, handle, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Taken down · thro</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3e8d2;color:#2b2420;font:16px/1.5 system-ui,sans-serif;padding:24px}main{max-width:36ch}a{color:#1f6f68}</style></head><body><main><h1 style="margin:0 0 8px;font-size:24px">This demo page has been taken down.</h1><p style="margin:0">It showed discs from ${esc(p.name)}'s public videos. <a href="https://thro.pages.dev/">thro</a></p></main></body></html>`);
  console.log(handle, 'parked: taken-down page');
}
