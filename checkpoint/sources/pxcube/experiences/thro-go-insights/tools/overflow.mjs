const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
for (const t of ['jmilly','bodanza']) { await p.goto('http://localhost:8765/index.html#'+t); await p.waitForFunction(() => window.__ready);
console.log(t, await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > 391 && !e.closest('.pitch-scroll')).slice(0, 8).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + (e.textContent||'').slice(0, 40))));}
await b.close();
