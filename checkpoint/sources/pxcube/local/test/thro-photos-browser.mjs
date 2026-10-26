// photos.html end to end: crop all ten raw photos live (Argon's rim fit in a worker), check each fit against Argon's own run
// (kept in assets/photos/photos.json), then Make cards and check the editor opens with the cropped discs as its shelf.
// Usage: node local/test/thro-photos-browser.mjs http://localhost:PORT/   (serving experiences/thro/dist)
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const site = process.argv[2] ?? 'http://localhost:8767/';
const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto(new URL('photos.html', site).href, { waitUntil: 'networkidle' });
await p.click('#all');
await p.waitForFunction(() => [...document.querySelectorAll('.thumb .tag')].every(t => t.textContent !== 'raw'), null, { timeout: 120000 });
const status = await p.textContent('#status');
const devs = await p.evaluate(() => window.__photoFits);
const worst = Math.max(...Object.values(devs));
console.log('off Argon\'s run, % of radius:', JSON.stringify(devs));
if (worst > 1.5) { console.error('a live fit is far from Argon\'s run'); process.exitCode = 1; }
await p.screenshot({ path: process.argv[3] ?? '/tmp/thro-photos-witness.png' });
const ran = await p.evaluate(() => window.__throWitness);
const byId = {}; for (const r of ran) (byId[r.id] ??= []).push(r.status);
console.log('registered Calculations that ran:', JSON.stringify(Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, `${v.filter(x => x === 'PASS').length}/${v.length} PASS`]))));
if (ran.some(r => r.status !== 'PASS')) { console.error('a guarantee failed:', JSON.stringify(ran.filter(r => r.status !== 'PASS'))); process.exitCode = 1; }
await p.click('#make');
const handoff = await p.evaluate(() => (window.__throWitness ?? []).length);
await p.waitForSelector('[data-testid=prepared-shelf]', { timeout: 30000 });
const shelf = await p.$$eval('[data-testid=prepared-shelf] button, [data-testid=prepared-shelf] [role=button], [data-testid=prepared-shelf] li', els => els.length);
console.log(status, '| editor shelf items:', shelf, '| url:', p.url());
if (errors.length) { console.error(errors); process.exitCode = 1; }
if (!/10 of 10/.test(status)) { console.error('not every photo cropped'); process.exitCode = 1; }
await b.close();
