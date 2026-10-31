// thro creator pages in the shop-page look (Sam, 31 Oct 09:37: "make the creator page what it was before … these were supposed to
// be user specific like 'insight' pages"; picked: every creator page like /icebergtv/, the clicked video first, analytics only on
// /insights/<creator>). The public /<creator> page shows what was thrown in each video and where to get it; no views, followers,
// trend charts or lift numbers (those stay on the creator's unlinked /insights/<creator> page).
// Data: read from the creator hub pages Argon's bundle already built (each video card carries data-video-id, data-video-title,
// its date badge and one disc-mini-card per disc with mold, brand, flight, source, play second and /out/ buy link), so nothing new
// is scraped here. Usage: node build.mjs SITE_DIR   (rewrites SITE_DIR/<slug>/index.html for every creator hub, in place)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(site)) { console.error('usage: node build.mjs SITE_DIR'); process.exit(2); }
// Disc photos (photos/fetch.py, a build step before this one): SITE/disc-photos/manifest.json lists each provider's photos.
// Like map imagery, a page asks its providers in order (creators[slug] or the default, ['manufacturer']) and shows the first
// photo found, credited on the card ("Photo: Discraft"); with no photo the card is the plate alone.
const manifestFile = path.join(site, 'disc-photos', 'manifest.json');
const photos = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { default: [], creators: {}, photos: {} };
const photoFor = (slug, discId) => { for (const p of photos.creators?.[slug] ?? photos.default ?? []) { const x = photos.photos?.[p]?.[discId]; if (x) return x; } return null; };
const shopCss = fs.readFileSync(path.join(root, '../thro-shops/page.css'), 'utf8');
const ownCss = fs.readFileSync(path.join(root, 'creator.css'), 'utf8');
const LOGO = fs.readFileSync(path.join(root, '../thro/brand/thro-logo.svg'), 'utf8').replace(/ width="\d+" height="\d+"/, '').replace('<svg ', '<svg class="logo" ');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const unesc = s => String(s ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const date = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// Short brand names, as the site's nav and URLs say them (Innova, Axiom, MVP …).
const BRAND = { 'Innova Champion Discs': 'Innova', 'Disc Golf Association': 'DGA', 'Above Ground Level': 'AGL', 'MVP Disc Sports': 'MVP' };
const brand = b => BRAND[b] ?? String(b ?? '').replace(/ (Champion Discs|Disc Sports|Golf Discs|Disc Golf|Discs|Disc|Athletics)$/, '');
const HOW = { title: 'named in the title', description: 'named in the description', chapter: 'in the chapters', transcript: 'said on camera', card: 'on the card', comment: 'in the pinned comment' };
// One bold signal colour per page, as the shop pages have (Mid-Century Retro), picked by the slug so it never changes.
const SIGNALS = [['#3fb8c4', '#c4502b'], ['#e3a62f', '#1f6f68'], ['#e0632e', '#2f6f8f'], ['#7aa95c', '#c4502b'], ['#d98aa0', '#1f6f68'], ['#6f9bd8', '#c4502b'], ['#c9b03c', '#2f6f8f']];
const signal = slug => SIGNALS[[...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SIGNALS.length];
const burst = `<svg class="burst" viewBox="-100 -100 200 200" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => `<line x1="0" y1="0" x2="${(Math.cos(i * Math.PI / 8) * (i % 2 ? 62 : 96)).toFixed(1)}" y2="${(Math.sin(i * Math.PI / 8) * (i % 2 ? 62 : 96)).toFixed(1)}" stroke="#2b2420" stroke-width="${i % 2 ? 3 : 5}" stroke-linecap="round"/>`).join('')}<circle r="22" fill="#f3e8d2" stroke="#2b2420" stroke-width="5"/><circle r="7" fill="#2b2420"/></svg>`;

function read(slug, html) {
  const rawName = unesc((html.match(/<h1 class="page-title">([^<]*)<\/h1>/) ?? [])[1] ?? slug);
  const sub = (html.match(/<p class="page-sub">([\s\S]*?)<\/p>/) ?? [])[1] ?? '';
  const handle = unesc((sub.match(/<strong>(@[^<]+)<\/strong>/) ?? [])[1] ?? '');
  const about = unesc(sub.replace(/<strong>@[^<]+<\/strong>\s*·\s*/, '').replace(/<[^>]+>/g, '')).trim();
  const videos = [];
  for (const m of html.matchAll(/<article id="vid-card-[^"]*" class="video-feed-card[^"]*" data-video-id="([^"]+)" data-creator-slug="([^"]+)"[^>]*?data-video-title="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const [, id, owner, title, body] = m;
    if (owner !== slug) continue;
    const day = (body.match(/class="badge-muted">(\d{4}-\d\d-\d\d)</) ?? [])[1] ?? '';
    const discs = [];
    for (const d of body.matchAll(/<div class="disc-mini-card" data-disc-id="([^"]+)" data-disc-mold="([^"]*)" data-disc-plastic="([^"]*)" data-disc-source="([^"]*)">([\s\S]*?)<\/div>\s*<\/div>(?=\s*(?:<div class="disc-mini-card"|<\/div>))/g)) {
      const [, did, mold, plastic, source, inner] = d;
      const flight = ((inner.match(/<span class="dmc-brand">([-\d.]+ \| [-\d.]+ \| [-\d.]+ \| [-\d.]+)<\/span>/) ?? [])[1] ?? '').split(' | ').filter(Boolean);
      const maker = unesc((inner.match(/<a href="\/[^"]*" style="color:var\(--text-2\)">([^<]*)<\/a>/) ?? [])[1] ?? '');
      const sec = Number((inner.match(/data-play-sec="(\d+(?:\.\d+)?)"/) ?? [])[1] ?? 0);
      const buy = unesc((inner.match(/<a class="buy-mini" href="([^"]+)"/) ?? [])[1] ?? '');
      discs.push({ id: did, mold: unesc(mold), plastic: unesc(plastic), source, flight, maker: brand(maker), sec, buy, page: `/${did}` });
    }
    if (discs.length) videos.push({ id, title: unesc(title), day, discs });
  }
  // A brand that is also a channel keeps its mold list (links to /<brand>/<mold>) at the bottom.
  const molds = [...new Set([...html.matchAll(new RegExp(`href="/${slug}/([a-z0-9-]+)"`, 'g'))].map(x => x[1]))];
  const name = molds.length ? brand(rawName) : rawName;  // only a brand channel goes by its short name (Innova); 'Dang Disc Golf' stays whole
  return { name, handle, about, videos, molds };
}

function tile(d, v) {
  const photo = photoFor(v.slug, d.id);
  const label = `${d.maker} ${d.mold}${d.plastic ? `, ${d.plastic}` : ''}`;
  const how = d.sec > 0 ? `<a href="https://www.youtube.com/watch?v=${esc(v.id)}&amp;t=${Math.floor(d.sec)}s" rel="noopener">▶ said at ${clock(d.sec)}</a>` : esc(HOW[d.source] ?? '');
  // No photo from any provider: an empty ring keeps the row's plates level and says so plainly.
  const pic = photo ? `<span class="tc-photo"><img src="${esc(photo.src)}" alt="" loading="lazy" width="${photo.w}" height="${photo.h}"></span>` : '<span class="tc-photo none"><span>No maker photo yet</span></span>';
  const credit = photo ? `<span class="tc-credit">${esc(photo.credit)}${photo.match === 'special-edition' ? ' · special run' : ''}</span>` : '';
  const card = `${pic}<span class="tc with-photo" aria-hidden="true">${credit}<span class="tc-name" style="--n:${Math.max(5, d.mold.length)}">${esc(d.mold)}</span>${d.flight.length === 4 ? `<span class="tc-flight">${d.flight.map(n => `<i>${esc(n)}</i>`).join('')}</span>` : ''}<span class="tc-brand">${esc(d.maker)}</span></span>`;
  return `<li><a class="card" href="${esc(d.buy || d.page)}" rel="${d.buy ? 'nofollow noopener' : ''}">${card}<span class="what">${d.buy ? 'Get' : 'See'} the ${esc(label)}${d.buy ? ' ↗' : ''}</span></a><span class="how">${how}${how ? ' · ' : ''}<a href="${esc(d.page)}">every video with it</a></span></li>`;
}
function section(v, i) {
  const names = [...new Set(v.discs.map(d => d.mold))].map(esc).join(', ');
  return `<section id="v-${esc(v.id)}" data-video="${esc(v.id)}"><header><span class="no">No. ${String(i + 1).padStart(2, '0')}</span><span class="kind"><span class="sel">Selected video · </span>Video · ${date(v.day)}</span><a class="vt" href="https://www.youtube.com/watch?v=${esc(v.id)}" rel="noopener">${esc(v.title)}</a><p class="bag">Featured: ${names}</p><a class="dl" href="/editor?creator=${encodeURIComponent(v.slug)}">Make these cards <small>in the thro editor</small></a></header><ol class="grid">${v.discs.map(d => tile(d, v)).join('')}</ol></section>`;
}
// ?v=<id> (a card on the front page): that video's section moves to the top, marked "Selected video", and the page starts there.
const PICK = `<script>(()=>{const id=new URLSearchParams(location.search).get('v');if(!id)return;const s=document.getElementById('v-'+id);if(!s)return;const m=s.parentNode;m.prepend(s);s.classList.add('is-selected');})()</script>`;

let n = 0;
for (const slug of fs.readdirSync(site).sort()) {
  const file = path.join(site, slug, 'index.html');
  if (['insights', 'creators', 'editor', 'assets'].includes(slug) || !fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes(`data-creator-slug="${slug}"`) || !html.includes('class="page-title"')) continue;  // creator hubs only (not mold pages, shops, or pages built here already)
  const c = read(slug, html);
  if (!c.videos.length) continue;
  c.videos.sort((a, b) => (b.day || '').localeCompare(a.day || ''));
  c.videos.forEach(v => { v.slug = slug; });
  const [s1, s2] = signal(slug);
  const discCount = c.videos.reduce((k, v) => k + v.discs.length, 0);
  const moldList = c.molds.length ? `<section class="molds"><header><span class="no">Every ${esc(c.name)} mold on thro</span></header><ul class="mold-index">${c.molds.map(m => `<li><a href="/${slug}/${m}">${esc(m.replace(/-/g, ' '))}</a></li>`).join('')}</ul></section>` : '';
  const out = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(c.name)} · thro</title>
<meta name="description" content="Every disc from ${esc(c.name)}'s videos on thro, with where to get it.">
<link rel="canonical" href="https://thro.dev/${slug}/">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' stroke='%23e0632e' stroke-width='3'%3E%3Ccircle cx='16' cy='16' r='13'/%3E%3Ccircle cx='16' cy='16' r='5.75'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${shopCss}${ownCss}</style></head><body class="creator" style="--signal:${s1};--signal2:${s2}">
<nav class="brandbar"><a href="/" aria-label="thro">${LOGO}</a><span>Know what you thro</span></nav><header class="top">${burst}<div class="inner"><p class="eyebrow">From the camera of</p><h1>${esc(c.name)}</h1><p class="sub">${c.handle ? `${esc(c.handle)} · ` : ''}every disc from ${c.videos.length === 1 ? 'this video' : `these ${c.videos.length} videos`}, and where to get it</p></div></header>
<main>${c.videos.map(section).join('')}${moldList}</main>
<footer><a class="foot-logo" href="/" aria-label="thro">${LOGO}</a> Discs come from ${esc(c.name)}'s public videos: the title, the description, the chapters, or what's said on camera. Not affiliated with ${esc(c.name)}.</footer>
${PICK}</body></html>`;
  fs.writeFileSync(file, out);
  n++;
}
console.log(`${n} creator pages written in the shop-page look`);
