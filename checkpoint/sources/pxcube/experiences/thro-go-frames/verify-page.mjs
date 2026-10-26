// node verify-page.mjs [port] [round]  (serve this folder first: python3 -m http.server <port>)
// Playwright check at 1440x900 and 390x844: zero console errors, no sideways scroll, every Case shows PASS in the page; writes shots/<round>-*.png
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const port = process.argv[2] ?? '8731', round = process.argv[3] ?? 'round1';
const base = `http://localhost:${port}/index.html`;
const browser = await chromium.launch();
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL', m); };
for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: size });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  const summary = await page.textContent('#summary');
  console.log(name, 'summary:', summary.trim());
  const sideways = () => page.evaluate(() => [document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth, document.querySelector('#main').scrollWidth - document.querySelector('#main').clientWidth]);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#list .item')].map((b) => b.dataset.case));
  console.log(name, ids.length, 'Cases in the list');
  // every Case shows PASS (in the list and in its own header)
  const pills = await page.evaluate(() => [...document.querySelectorAll('#list .item .pill')].map((p) => p.textContent));
  if (pills.some((p) => p !== 'PASS')) fail(`${name}: list has non-PASS pills`);
  const shotCases = new Set(['c00', 'c05', 'c12', 'c16', 'c24', 'c08', 'c25', 'c35', 'c19', 'c22']);
  for (const id of ids) {
    if (name === 'mobile') { await page.click('#mobile-toggle'); }
    await page.click(`#list .item[data-case="${id}"]`);
    const verdict = (await page.textContent('#case-verdict')).trim();
    if (verdict !== 'PASS') fail(`${name} ${id}: header says ${verdict}`);
    const sw = await sideways();
    if (sw.some((x) => x > 1)) fail(`${name} ${id}: sideways scroll ${sw}`);
    const n = await page.evaluate(() => document.querySelectorAll('#main .check .ok').length + ':' + document.querySelectorAll('#main .check .no').length);
    if (!n.endsWith(':0')) fail(`${name} ${id}: failing checks shown ${n}`);
    if (shotCases.has(id)) await page.screenshot({ path: `shots/${round}-${name}-${id}.png`, fullPage: name === 'mobile' });
  }
  await page.click(`#list .item[data-case="c00"]`).catch(async () => { await page.click('#mobile-toggle'); await page.click('#list .item[data-case="c00"]'); });
  await page.screenshot({ path: `shots/${round}-${name}-top.png` });
  await page.click('#tabs [data-view="frames"]');
  await page.screenshot({ path: `shots/${round}-${name}-frames.png`, fullPage: name === 'mobile' });
  if ((await sideways()).some((x) => x > 1)) fail(`${name}: sideways scroll on Frames`);
  await page.click('#tabs [data-view="pipeline"]');
  await page.screenshot({ path: `shots/${round}-${name}-pipeline.png`, fullPage: name === 'mobile' });
  if ((await sideways()).some((x) => x > 1)) fail(`${name}: sideways scroll on Pipeline`);
  // a different seed regenerates and still passes
  await page.fill('#seed', '4242'); await page.click('#run-seed');
  await page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('47 / 47'));
  console.log(name, 'seed 4242:', (await page.textContent('#summary')).trim());
  if (errors.length) fail(`${name}: console errors: ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
console.log(bad ? `${bad} problem(s)` : 'page verification clean');
process.exit(bad ? 1 : 0);
