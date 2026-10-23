// Someone in Sweden with no English hears about thro and tries it (Sam, 22 Oct, 23:31).
// Loads thro in a Swedish browser (locale sv-SE, Accept-Language sv), makes a Single card and downloads it, and counts the English
// words a first visitor has to read along that path: everything visible on the page at arrival, plus what appears after Download.
// This is a measure, not a pass/fail: the number is recorded so later rungs can make it fall. Brand, disc and plastic names,
// numbers and file names are not counted (they are the same in any language).
// Usage: node thro-swedish-browser.mjs http://localhost:8766/ [out.json]. Env: PLAYWRIGHT_MODULE, CHROMIUM_PATH.
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/'), out = process.argv[3];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
// Proper names a Swede reads as-is: brands, molds, plastics, the product.
const names = new Set(['thro', 'thr', 'mvp', 'servo', 'neutron', 'discraft', 'buzzz', 'ss', 'z', 'flx', 'latitude', 'anchor', 'opto', 'png', 'svg', 'webp', 'jpg']);
const visibleText = p => p.evaluate(() => {
  const seen = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement, text = n.textContent.replace(/\s+/g, ' ').trim();
    if (!text || !el || el.closest('script,style,#dtree,[hidden],[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    seen.push(text);
  }
  // Labels a screen reader would also read are words to someone too; buttons' visible text is already above.
  return seen;
});
const english = texts => texts.flatMap(t => t.split(/[^A-Za-zÅÄÖåäö'’]+/)).filter(w => w.length > 1 && !names.has(w.toLowerCase()));

for (const width of [1280, 390]) {
  const phone = width < 500;
  const context = await browser.newContext({ locale: 'sv-SE', extraHTTPHeaders: { 'Accept-Language': 'sv-SE,sv;q=0.9' }, viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone, isMobile: phone, acceptDownloads: true });
  const p = await context.newPage();
  await p.goto(base.href, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => /Ready|Saved/.test(document.getElementById('status')?.textContent ?? '') && document.querySelector('#graphic-preview svg'), null, { timeout: 30000 });
  const arrival = await visibleText(p);
  const download = p.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await (phone ? p.locator('#download-png').tap() : p.locator('#download-png').click());
  const file = await download; await p.waitForTimeout(800);
  const after = await visibleText(p), added = after.filter(t => !arrival.includes(t));
  const words = english([...arrival, ...added]);
  const lang = await p.evaluate(() => ({ html: document.documentElement.lang || null, navigator: navigator.language }));
  results.push({ width, browserLanguage: lang.navigator, pageLanguage: lang.html, downloaded: Boolean(file), englishWords: words.length, distinctEnglishWords: new Set(words.map(w => w.toLowerCase())).size,
    sample: [...arrival, ...added].filter(t => english([t]).length).slice(0, 12) });
  await context.close();
}
await browser.close();
for (const r of results) console.log(`${r.width}: browser ${r.browserLanguage}, page lang ${r.pageLanguage}; downloaded ${r.downloaded}; English words a first visitor reads: ${r.englishWords} (${r.distinctEnglishWords} distinct)\n  e.g. ${r.sample.slice(0, 6).map(t => JSON.stringify(t.slice(0, 60))).join(' · ')}`);
if (out) fs.writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), base: base.href, results }, null, 1));
process.exit(results.every(r => r.downloaded) ? 0 : 1); // the path itself must work; the word count is the measure
