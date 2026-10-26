const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const root = new URL('../', import.meta.url).pathname;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('http://localhost:8742/index.html'); await p.waitForSelector('body[data-ready="true"]');
await p.click('#mobile-toggle'); await p.click('#list .item[data-case="c05"]');
await p.screenshot({ path: root + 'shots/critic-mobile-c05-top.png' });
await p.evaluate(() => window.scrollTo(0, 900)); await p.screenshot({ path: root + 'shots/critic-mobile-c05-mid.png' });
const h = await p.evaluate(() => document.documentElement.scrollHeight); console.log('mobile c05 page height', h);
await b.close();
