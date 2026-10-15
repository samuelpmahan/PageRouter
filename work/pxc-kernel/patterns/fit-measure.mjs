// Upload each case photo into DiscStudio, wait for the automatic fit, read the geometry it proposes, screenshot the edge check.
import { chromium } from 'playwright';
import fs from 'node:fs';
const cases = JSON.parse(fs.readFileSync('/home/claude/fitlab/cases.json', 'utf8'));
const URL = process.env.DS_URL || 'http://localhost:4173/?instrument=1';
const OUT = process.env.OUT || '/home/claude/fitlab/run';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const browser = await chromium.launch();
const results = [];
for (const c of cases) {
  if (only && !only.test(c.name)) continue;
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const row = { name: c.name };
  try {
    await page.goto(URL);
    await page.waitForFunction(() => !document.getElementById('photo').disabled, null, { timeout: 30000 });
    const t0 = Date.now();
    await page.setInputFiles('#photo', c.file);
    await page.waitForFunction(() => ['ellipse', 'circle', 'manual'].includes(document.getElementById('crop-stage')?.dataset.automaticFit), null, { timeout: 90000 });
    row.waitMs = Date.now() - t0;
    Object.assign(row, await page.evaluate(() => {
      const v = id => Number(document.getElementById(id).value), st = document.getElementById('crop-stage').dataset;
      return { choice: st.automaticFit, elapsedMs: Number(st.automaticFitElapsedMs), instrument: window.__dsAutomaticFit ?? null,
        ellipse: { cx: v('crop-ellipse-center-x'), cy: v('crop-ellipse-center-y'), rx: v('crop-ellipse-radius-x'), ry: v('crop-ellipse-radius-y'), angle: v('crop-ellipse-axis-angle') },
        circle: { cx: v('crop-center-x'), cy: v('crop-center-y'), rx: v('crop-radius-x'), ry: v('crop-radius-y') },
        status: document.getElementById('crop-ellipse-status')?.textContent, applyDisabled: document.getElementById('crop-apply').disabled,
        candidates: document.querySelectorAll('#circle-candidates > *').length };
    }));
    await page.waitForTimeout(400);
    await page.locator('#photo-crop').screenshot({ path: `${OUT}/${c.name}-check.png` });
    if (!row.applyDisabled) {
      await page.click('#crop-apply');
      await page.waitForFunction(() => !document.getElementById('photo-crop').open, null, { timeout: 30000 });
      await page.waitForTimeout(600);
      const prep = await page.evaluate(() => { const img = [...document.querySelectorAll('#preview img, #preview canvas')][0]; return img ? { tag: img.tagName, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, src: img.src?.slice(0, 30) } : null; });
      row.prepared = prep;
      await page.locator('#preview').screenshot({ path: `${OUT}/${c.name}-preview.png` });
    }
  } catch (e) { row.error = String(e).slice(0, 300); }
  results.push(row); console.log(JSON.stringify(row).slice(0, 260));
  await ctx.close();
}
fs.writeFileSync(`${OUT}/results${process.env.ONLY ? '-' + process.env.ONLY.replace(/\W/g, '') : ''}.json`, JSON.stringify(results, null, 1));
await browser.close();
