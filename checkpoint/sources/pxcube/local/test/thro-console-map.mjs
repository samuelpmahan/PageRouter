// Measures the thro editor's phone page (390 × 844) for ?console: every control, where it sits, and how much of the card is on
// screen while a finger is on it. Writes experiences/thro/console-map/phone.json and phone.webp. Usage: node thro-console-map.mjs SITE_URL
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const site = process.argv[2] ?? 'http://localhost:8766/', out = new URL('../../experiences/thro/console-map/', import.meta.url);
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }), p = await ctx.newPage();
await p.goto(new URL('./?scratch', site).href, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  const H = innerHeight, card = document.querySelector('#graphic-preview');
  const rows = window.__consoleControls().map(({ el, key, label }) => {
    el.scrollIntoView({ block: 'center' }); const k = card.getBoundingClientRect();
    const shown = Math.max(0, Math.min(H, k.bottom) - Math.max(0, k.top)) / k.height; scrollTo(0, 0); const bx = el.getBoundingClientRect();
    return { key, label, x: Math.round(bx.x), y: Math.round(bx.y + scrollY), w: Math.round(bx.width), h: Math.round(bx.height), shown: Math.round(shown * 100) };
  });
  scrollTo(0, 0); const k = card.getBoundingClientRect();
  return { measured: new Date().toISOString(), width: innerWidth, screen: H, page: document.documentElement.scrollHeight, card: { x: Math.round(k.x), y: Math.round(k.y + scrollY), w: Math.round(k.width), h: Math.round(k.height) }, rows };
});
const png = await p.screenshot({ fullPage: true });
const q = await ctx.newPage(); // encode as WebP in the browser, so no image library is needed
const webp = await q.evaluate(async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = Object.assign(document.createElement('canvas'), { width: i.width, height: i.height }); c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/webp', 0.72).split(',')[1]; }, png.toString('base64'));
fs.writeFileSync(new URL('phone.webp', out), Buffer.from(webp, 'base64'));
fs.writeFileSync(new URL('phone.json', out), JSON.stringify(r));
console.log(`${r.rows.length} controls, page ${(r.page / r.screen).toFixed(1)} screens, ${Math.round(webp.length * 0.75 / 1024)} KB image`);
await b.close();
