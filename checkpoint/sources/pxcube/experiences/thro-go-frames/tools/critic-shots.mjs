const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const base = 'http://localhost:8742/index.html';
const browser = await chromium.launch();
const root = new URL('../', import.meta.url).pathname;
for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: size });
  const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base); await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  await page.screenshot({ path: `${root}shots/critic-${name}-landing.png` });
  for (const id of ['c00', 'c05', 'c08', 'c19', 'c24', 'c32']) {
    if (name === 'mobile') await page.click('#mobile-toggle');
    await page.click(`#list .item[data-case="${id}"]`);
    await page.screenshot({ path: `${root}shots/critic-${name}-${id}-full.png`, fullPage: true });
  }
  for (const v of ['frames', 'pipeline']) { await page.click(`#tabs [data-view="${v}"]`); await page.screenshot({ path: `${root}shots/critic-${name}-${v}.png`, fullPage: true }); }
  // text-size / overflow audit
  const audit = await page.evaluate(() => {
    const small = new Map(); for (const el of document.querySelectorAll('body *')) { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 11 && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) small.set(fs, (small.get(fs) ?? 0) + 1); }
    const clipped = [...document.querySelectorAll('body *')].filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible' && el.clientWidth > 0).slice(0, 8).map((el) => el.className + ':' + el.scrollWidth + '>' + el.clientWidth);
    return { smallFonts: [...small], clipped };
  });
  console.log(name, JSON.stringify(audit), 'console errors', errors.length);
  await page.close();
}
await browser.close();
