const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch(); const p = await b.newPage();
p.on('console', (m) => console.log('console', m.type(), m.text())); p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:8765/index.html#bodanza'); await p.waitForTimeout(2500);
console.log((await p.locator('#app').innerText()).slice(0, 300)); await b.close();
