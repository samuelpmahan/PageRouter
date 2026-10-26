// node verify-page.mjs [port] [round]  (serve this folder first: python3 -m http.server <port>)
// Playwright at 1440x900 and 390x844: zero console errors, no sideways scroll on any view, every Case shows PASS, the Sponsors, Links, Frames and
// Pipeline views draw, walking the link graph works, and the mobile Case page is short. Writes shots/<round>-*.png
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const port = process.argv[2] ?? '8731', round = process.argv[3] ?? 'round2';
const base = `http://localhost:${port}/index.html`;
const browser = await chromium.launch();
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL', m); };
const SHOT = new Set(['c001', 'c010', 'c021', 'c051', 'c070', 'c090', 'c120', 'c150']);
for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: size });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  console.log(name, 'summary:', (await page.textContent('#summary')).trim(), '|', (await page.textContent('#smoke')).trim());
  const sideways = () => page.evaluate(() => [document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth]);
  const overflowing = () => page.evaluate(() => [...document.querySelectorAll('#main *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('svg'); }).slice(0, 3).map((el) => `${el.tagName}.${el.className}`));
  const ids = await page.evaluate(() => [...document.querySelectorAll('#list .item')].map((b) => b.dataset.case));
  console.log(name, ids.length, 'Cases in the list');
  const pills = await page.evaluate(() => [...document.querySelectorAll('#list .item .pill')].map((p) => p.textContent));
  if (pills.some((p) => p !== 'PASS')) fail(`${name}: list has non-PASS pills`);
  let longest = 0, longestId = '';
  for (const id of ids) {
    if (name === 'mobile') await page.click('#mobile-toggle');
    await page.click(`#list .item[data-case="${id}"]`);
    const verdict = (await page.textContent('#case-verdict')).trim();
    if (verdict !== 'PASS') fail(`${name} ${id}: header says ${verdict}`);
    const sw = await sideways();
    if (sw.some((x) => x > 1)) fail(`${name} ${id}: sideways scroll ${sw}`);
    const no = await page.evaluate(() => document.querySelectorAll('#main .check .no').length);
    if (no) fail(`${name} ${id}: failing checks shown`);
    if (name === 'mobile') { const hgt = await page.evaluate(() => document.documentElement.scrollHeight); if (hgt > longest) { longest = hgt; longestId = id; } }
    if (SHOT.has(id)) await page.screenshot({ path: `shots/${round}-${name}-case-${id}.png`, fullPage: name === 'mobile' });
  }
  if (name === 'mobile') console.log('mobile: tallest Case page', longest, 'px (', longestId, ')');
  for (const view of ['sponsors', 'links', 'frames', 'pipeline']) {
    await page.click(`#tabs [data-view="${view}"]`);
    await page.waitForTimeout(150);
    if (view === 'links') {
      await page.click('.eitem >> nth=3');
      const walked = await page.evaluate(() => document.querySelector('.ent-detail h1')?.textContent);
      await page.click('.ent-detail .ent >> nth=0');
      const walked2 = await page.evaluate(() => document.querySelector('.ent-detail h1')?.textContent);
      console.log(name, 'links: walked', JSON.stringify(walked), '→', JSON.stringify(walked2));
      if (!walked || !walked2 || walked === walked2) fail(`${name}: walking links did not move`);
      await page.goto(`${base}#view=links&entity=video:maren-03`); await page.reload(); await page.waitForSelector('body[data-ready="true"]');
    }
    if (view === 'sponsors') { const n = await page.evaluate(() => document.querySelectorAll('.qrow').length); console.log(name, 'sponsor rows drawn:', n); if (n < 10) fail(`${name}: only ${n} sponsor rows`); await page.screenshot({ path: `shots/${round}-${name}-sponsors.png`, fullPage: name === 'mobile' }); }
    const sw = await sideways(), ov = await overflowing();
    if (sw.some((x) => x > 1)) fail(`${name}: sideways scroll on ${view} ${sw}`);
    if (ov.length) fail(`${name}: ${view} has elements wider than the screen: ${ov.join(', ')}`);
    await page.screenshot({ path: `shots/${round}-${name}-${view}.png`, fullPage: name === 'mobile' });
  }
  if (errors.length) fail(`${name}: console errors: ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
console.log(bad ? `${bad} problem(s)` : 'page verification clean');
process.exit(bad ? 1 : 0);
