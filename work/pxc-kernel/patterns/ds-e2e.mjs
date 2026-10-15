// A real person's path through DiscStudio with their own photo: upload -> edge check -> OK -> mold -> plastic -> save -> card -> approve -> download PNG + ZIP.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.DS_URL || 'http://localhost:4173/';
const OUT = '/home/claude/fitlab/e2e';
const P = '/tmp/claude-0/-home-claude-pagerouter/adbf74e1-6a48-5043-871f-fbb76434eb80/scratchpad/photos';
const ALL = [
  { key: 'servo', file: `${P}/servo.jpg`, search: 'Servo', pick: 'MVP · Servo', plastic: 'Neutron' },
  { key: 'anchor', file: `${P}/anchor.jpg`, search: 'Anchor', pick: 'Latitude 64 · Anchor', plastic: 'Opto Air' },
  { key: 'buzzz', file: `${P}/buzzz-ss.jpg`, search: 'Buzzz SS', pick: 'Discraft · Buzzz SS', plastic: 'Z FLX' },
];
const DISCS = process.env.ONLY ? ALL.filter(d=>d.key===process.env.ONLY) : ALL;
const browser = await chromium.launch();
const all = [];
for (const d of DISCS) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const frames = []; let n = 0;
  const shot = async (label, sel, data = {}) => { const f = `${OUT}/${d.key}-${String(++n).padStart(2, '0')}.png`; try { await (sel ? page.locator(sel).first().screenshot({ path: f }) : page.screenshot({ path: f })); } catch (e) { data.shotError = String(e).slice(0, 120); } frames.push({ n, label, file: f, ...data }); console.log(d.key, n, label, JSON.stringify(data).slice(0, 160)); };
  const t0 = Date.now();
  try {
    await page.goto(URL); await page.waitForFunction(() => !document.getElementById('photo').disabled, null, { timeout: 30000 });
    await page.setInputFiles('#photo', d.file);
    await page.waitForFunction(() => ['ellipse', 'circle', 'manual'].includes(document.getElementById('crop-stage')?.dataset.automaticFit), null, { timeout: 90000 });
    await page.waitForTimeout(500);
    await shot('Upload: the edge check opens', '#photo-crop', { fit: await page.evaluate(() => document.getElementById('crop-stage').dataset.automaticFit) });
    await page.click('#crop-apply'); await page.waitForFunction(() => !document.getElementById('photo-crop').open); await page.waitForTimeout(800);
    await shot('OK: the prepared photo', '#preview');
    await page.click('#mold-search'); await page.fill('#mold-search', d.search); await page.waitForTimeout(600);
    const opts = await page.locator('#mold-options [role="option"]').allInnerTexts();
    await shot('Type the mold: the catalog offers', null, { options: opts.slice(0, 5) });
    await page.locator('#mold-options [role="option"]', { hasText: d.pick }).first().click(); await page.waitForTimeout(600);
    const flight = await page.locator('#flight').innerText();
    await page.fill('#plastic', d.plastic); await page.waitForTimeout(300);
    await shot('Pick it: flight numbers fill in; plastic typed', null, { flight, plastic: d.plastic });
    const saveOn = await page.evaluate(() => !document.getElementById('save').disabled);
    await page.click('#save'); await page.waitForTimeout(2000);
    await shot("Save to Today's Bag", '#todays-bag', { saveEnabled: saveOn, status: await page.locator('#status').innerText() });
    await page.selectOption('#card-orientation', 'vertical'); await page.selectOption('#card-preset', 'u01'); await page.waitForTimeout(900);
    await page.locator('#placement-canvas').scrollIntoViewIfNeeded();
    await shot('Card preview (U01) over the sample scene', '#placement-canvas');
    await page.getByRole('button', { name: 'Add to Export' }).click(); await page.waitForTimeout(1500);
    await shot('Add to Export: approved', 'section.output-queue');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Download sticker PNG' }).first().click()]);
    const png = `${OUT}/${d.key}-sticker.png`; await dl.saveAs(png);
    const [dz] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Export sticker ZIP' }).first().click()]);
    const zip = `${OUT}/${d.key}-stickers.zip`; await dz.saveAs(zip);
    const [dc] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Export combined PNG' }).first().click()]);
    const comb = `${OUT}/${d.key}-combined.png`; await dc.saveAs(comb);
    await shot('Downloads: sticker PNG, ZIP, combined PNG', 'section.output-queue', { png: dl.suggestedFilename(), zip: dz.suggestedFilename(), combined: dc.suggestedFilename() });
  } catch (e) { frames.push({ n: ++n, label: 'FAILED', error: String(e).slice(0, 400) }); console.log(d.key, 'FAILED', String(e).slice(0, 300)); await page.screenshot({ path: `${OUT}/${d.key}-failed.png`, fullPage: true }); }
  all.push({ disc: d.key, seconds: (Date.now() - t0) / 1000, frames, pageErrors: errors });
  await ctx.close();
}
fs.writeFileSync(`${OUT}/e2e.json`, JSON.stringify(all, null, 1));
await browser.close();
