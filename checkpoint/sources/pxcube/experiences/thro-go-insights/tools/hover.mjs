const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:8765/index.html#jmilly'); await p.waitForFunction(() => window.__ready);
await p.locator('.stat .n').first().hover();
console.log(await p.locator('#how').innerText());
await p.locator('.s-release .n').first().hover(); console.log(await p.locator('#how').innerText());
await p.screenshot({ path: 'shots/round2-desktop-receipt.png' }); await b.close();
