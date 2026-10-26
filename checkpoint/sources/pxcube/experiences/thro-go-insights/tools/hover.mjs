const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
await p.goto('http://localhost:8765/index.html#bodanza'); await p.waitForFunction(() => window.__ready);
await p.locator('.ledger tbody tr').first().locator('.n').nth(1).click();
console.log((await p.locator('#how').innerText()));
await b.close();
