// PARKED, not wired into any build or page: renders Instagram carousel (1080x1350) and Story (1080x1920) graphics from a shop's ThroCards.
// Sam rejected putting these on the shop page (31 Oct); kept here only as a suggestion for social posts.
// Ready-to-post social graphics for a shop page (Sam, 31 Oct: Another Round is social-first): per video, an Instagram
// carousel (4:5, 1080x1350: a cover + 4 cards a slide) and a Story (9:16, 1080x1920), built from the shop's own ThroCards
// (cards/<base>-card.png) and its colours. Rendered by headless Chromium (playwright) into OUT/<handle>/social/*.png plus
// one zip per video. Build output, not source. Usage: node social.mjs OUT_DIR [handle]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { zipStore } from '../thro/editor-zip.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(root, 'out'));
const only = process.argv[3] ?? 'anotherround';
const shops = JSON.parse(fs.readFileSync(path.join(root, 'data/shops.json'), 'utf8'));
const LOGO = fs.readFileSync(path.join(root, '../thro/brand/thro-logo.svg'), 'utf8').replace(/ width="\d+" height="\d+"/, '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const date = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const card = d => 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'cards', `${d.cardBase}-card.png`)).toString('base64');
const burst = (c = '#2b2420') => `<svg class="burst" viewBox="-100 -100 200 200">${Array.from({ length: 16 }, (_, i) => `<line x1="0" y1="0" x2="${(Math.cos(i * Math.PI / 8) * (i % 2 ? 62 : 96)).toFixed(1)}" y2="${(Math.sin(i * Math.PI / 8) * (i % 2 ? 62 : 96)).toFixed(1)}" stroke="${c}" stroke-width="${i % 2 ? 3 : 5}" stroke-linecap="round"/>`).join('')}<circle r="22" fill="#f3e8d2" stroke="${c}" stroke-width="5"/><circle r="7" fill="${c}"/></svg>`;
const base = (s, w, h) => `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&display=block" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0}html,body{width:${w}px;height:${h}px;overflow:hidden}
body{background:${s.signal};color:#2b2420;font-family:Jost,sans-serif;position:relative}
.burst{position:absolute;width:560px;height:560px;right:-230px;top:-230px;opacity:.9}
.pad{position:absolute;inset:0;padding:72px 72px 64px;display:flex;flex-direction:column}
.eyebrow{font:800 30px/1 Jost;letter-spacing:.2em;text-transform:uppercase;max-width:760px}
h1{font:800 84px/.98 Jost;letter-spacing:-.025em;margin-top:22px;max-width:760px}
.sub{font:500 30px/1.25 Jost;margin-top:16px;max-width:760px}
.cards{display:flex;gap:22px;align-items:flex-end;justify-content:center;margin-top:auto}
.cards img{display:block;height:auto;filter:drop-shadow(0 18px 24px rgba(43,36,32,.35))}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:26px 30px;margin-top:auto;margin-bottom:auto;justify-items:center}
.grid figure{display:grid;gap:10px;justify-items:center}.grid img{height:420px;width:auto;filter:drop-shadow(0 14px 20px rgba(43,36,32,.3))}
.grid figcaption{font:600 24px/1.2 Jost;text-align:center;max-width:420px;background:#f3e8d2;padding:8px 14px;border-radius:4px}
.foot{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:28px;padding-top:22px;border-top:4px solid #2b2420;font:600 28px/1.2 Jost}
.foot b{font-weight:800}.foot svg{height:46px;width:auto}
.no{position:absolute;right:72px;top:72px;font:800 30px/1 Jost;letter-spacing:.14em;background:#2b2420;color:${s.signal};padding:10px 16px;border-radius:4px}
</style></head><body>`;
const foot = s => `<div class="foot"><span>Every disc in this video at <b>${esc(s.domain)}</b></span>${LOGO}</div>`;
function slides(s, v) {
  const ds = v.discs.filter(d => d.cardBase);
  const W = 1080, H = 1350, out = [];
  const hero = ds.slice(0, 3);
  out.push({ name: 'post-1-cover', w: W, h: H, html: base(s, W, H) + `${burst()}<div class="pad"><p class="eyebrow">${esc(s.name)} · ${date(v.published)}</p><h1>${esc(v.title)}</h1><p class="sub">${ds.length === 1 ? 'The disc' : `All ${ds.length} discs`} from the video${ds.length > 3 ? ', swipe →' : ''}</p><div class="cards">${hero.map((d, i) => `<img src="${card(d)}" style="width:${hero.length === 1 ? 470 : hero.length === 2 ? 410 : 300}px;height:auto;transform:rotate(${hero.length === 3 ? [-5, 0, 5][i] : 0}deg) translateY(${hero.length === 3 && i !== 1 ? 18 : 0}px)">`).join('')}</div>${foot(s)}</div></body></html>` });
  for (let i = 0; i * 4 < ds.length && ds.length > 1; i++) {
    const page = ds.slice(i * 4, i * 4 + 4);
    out.push({ name: `post-${i + 2}`, w: W, h: H, html: base(s, W, H) + `<div class="pad"><p class="eyebrow">${esc(s.name)}</p><span class="no">${i + 2}/${Math.ceil(ds.length / 4) + 1}</span><div class="grid">${page.map(d => `<figure><img src="${card(d)}"><figcaption>${esc(d.productTitle || `${d.manufacturer} ${d.mold}`)}</figcaption></figure>`).join('')}</div>${foot(s)}</div></body></html>` });
  }
  const SH = 1920, st = ds.slice(0, 4);
  out.push({ name: 'story', w: W, h: SH, html: base(s, W, SH) + `${burst()}<div class="pad" style="padding:150px 72px 170px"><p class="eyebrow">${esc(s.name)}</p><h1 style="font-size:78px">${esc(v.title)}</h1><div class="grid" style="margin-top:60px">${st.map(d => `<figure><img src="${card(d)}" style="height:${st.length === 1 ? 900 : 520}px"></figure>`).join('')}</div>${foot(s)}</div></body></html>` });
  return out;
}
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [handle, s] of Object.entries(shops)) {
  if (handle !== only) continue;
  const dir = path.join(out, handle, 'social'); fs.mkdirSync(dir, { recursive: true });
  const index = [];
  for (const [n, v] of s.videos.entries()) {
    const files = [];
    for (const sl of slides(s, v)) {
      await page.setViewportSize({ width: sl.w, height: sl.h });
      await page.setContent(sl.html, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const file = `${String(n + 1).padStart(2, '0')}-${sl.name}.png`;
      fs.writeFileSync(path.join(dir, file), await page.screenshot({ type: 'png' }));
      files.push(file);
    }
    const zip = `${String(n + 1).padStart(2, '0')}-instagram.zip`;
    fs.writeFileSync(path.join(dir, zip), zipStore(files.map(f => ({ name: f, data: new Uint8Array(fs.readFileSync(path.join(dir, f))) }))));
    index.push({ video: v.url, title: v.title, files, zip });
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 1));
  console.log(handle, index.reduce((k, x) => k + x.files.length, 0), 'graphics');
}
await browser.close();
