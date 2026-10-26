// frames.html: Argon's two acceptance frames built from raw photos through registered Calculations; fails unless all 8 reports PASS. Usage: node local/test/thro-frames-browser.mjs SITE SCREENSHOT.png
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const [site, shot] = process.argv.slice(2);
const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on('pageerror', e => console.log('pageerror', String(e)));
await p.goto(new URL('frames.html', site).href, { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.querySelector('#main').getAttribute('aria-busy') === 'false', null, { timeout: 90000 });
const r = await p.evaluate(() => window.__frameReports); console.log(JSON.stringify(r));
await p.screenshot({ path: shot }); await b.close();
if (r.length !== 2 || r.some(f => f.statuses.some(s => !s.endsWith('PASS')))) process.exitCode = 1;
