// bar.html: renderThroBar over the tee shot for every shelf disc; fails unless every thro/card/bar report is PASS. Usage: node local/test/thro-bar-browser.mjs SITE SCREENSHOT.png
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const [site, shot] = process.argv.slice(2);
const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on('pageerror', e => console.log('pageerror', String(e)));
await p.goto(new URL('bar.html', site).href, { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.querySelector('#main').getAttribute('aria-busy') === 'false', null, { timeout: 60000 });
const r = await p.evaluate(() => window.__barReports.map(x => ({ status: x.selfGuaranteeStatus, g: Object.fromEntries(Object.values(x.guarantees).map(g => [g.id, g.metric])) })));
console.log(JSON.stringify(r)); await p.screenshot({ path: shot, fullPage: true }); await b.close();
if (!r.length || r.some(x => x.status !== 'PASS')) process.exitCode = 1;
