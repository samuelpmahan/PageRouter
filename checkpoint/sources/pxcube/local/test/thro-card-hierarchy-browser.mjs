// Executable rule (Sam, 22 Oct 2026): DISC IMAGE >>>> MOLD NAME >>>> FLIGHT NUMBERS >>>> everything else.
// Disc size is the photo's diameter; type size is the drawn font size. Flight numbers carry no labels,
// and the disc photo is never squashed or skewed. Measured from the layout the DiscStudio card
// renderer records as it draws (thro-adapter.mjs), for every Single card on three discs.
// Usage: node thro-card-hierarchy-browser.mjs http://localhost:8766/index.html   (exits 1 on any failure)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = process.argv[2];
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
const studies = await p.locator('[data-study]').evaluateAll(els => els.map(e => e.dataset.study));
const rows = [];
for (const discIndex of [0, 1, 2]) {
  await p.locator('[data-disc]').nth(discIndex).click(); await p.waitForTimeout(1500);
  for (const study of studies) {
    await p.locator(`[data-study="${study}"]`).click(); await p.waitForTimeout(900);
    await p.waitForFunction(() => document.querySelector('#graphic-preview svg image'), null, { timeout: 15000 });
    rows.push(await p.evaluate(async ({ study, discIndex }) => {
      const { cardLayout } = await import(new URL('./native-cards.mjs', location.href).href);
      const svg = document.querySelector('#graphic-preview svg');
      const layout = cardLayout(svg.querySelector('image').getAttribute('href'));
      if (!layout) return { disc: discIndex, study, note: 'no layout recorded' };
      const d = layout.photo?.w ?? 0, n = layout.name?.size ?? 0, f = layout.numbers?.size ?? 0, o = Math.max(0, ...layout.other.map(x => x.size));
      const labels = layout.other.filter(x => /^(speed|glide|turn|fade)$/i.test(x.text.trim()));
      const r = { disc: discIndex, study: study.replace('discstudio:', ''), discPx: Math.round(d), namePx: Math.round(n), numbersPx: Math.round(f), otherPx: Math.round(o), otherText: layout.other.map(x => x.text).join(' · ').slice(0, 30), tiltDeg: Math.round(layout.photo?.angle ?? 0),
        'disc>name': d > n, 'name>numbers': n > f, 'numbers>other': f > o, unsquashed: !layout.photo?.skewed, unlabelled: labels.length === 0 };
      r.pass = r['disc>name'] && r['name>numbers'] && r['numbers>other'] && r.unsquashed && r.unlabelled;
      return r;
    }, { study, discIndex }));
  }
}
console.table(rows);
const fails = rows.filter(r => !r.pass);
console.log(`${rows.length - fails.length}/${rows.length} pass.`, fails.length ? 'Failing: ' + [...new Set(fails.map(r => `${r.study} (${['disc>name', 'name>numbers', 'numbers>other', 'unsquashed', 'unlabelled'].filter(k => !r[k]).join(', ')})`))].join('; ') : '');
await b.close();
process.exitCode = fails.length ? 1 : 0;
