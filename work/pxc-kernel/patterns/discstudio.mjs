// DiscStudio through the two pattern pieces: a flip book of the photo-to-card flow, and a matrix of card layouts × sample discs.
// The app runs from Sam's unchanged 6.5.7 source (built byte-identical to the live site) at DISCSTUDIO_URL (default http://localhost:4173/).
// Run: node patterns/discstudio.mjs [flow] [matrix]   → patterns/out/discstudio-flow.png, patterns/out/discstudio-matrix.png
import { shootFlow, problems, snap } from './flipbook.mjs';
import { matrix } from './matrix.mjs';

const URL = process.env.DISCSTUDIO_URL ?? 'http://localhost:4173/';
const VERSION = process.env.DISCSTUDIO_VERSION ?? '6.6.0'; // the version the running build must show
const SAMPLES = ['Discraft · Buzzz SS', 'MVP · Servo', 'Latitude 64 · Anchor'];

// ---------------------------------------------------------------- the person's steps, shared by the flow and the matrix
const ok = (page) => page.getByRole('button', { name: 'OK', exact: true });
const step = {
  chooseSample: async (page, sample) => { await page.locator('button', { hasText: sample }).first().click(); await ok(page).waitFor({ state: 'visible', timeout: 30000 }); await page.waitForTimeout(800); },
  acceptCrop: async (page) => { await ok(page).click(); await page.waitForTimeout(1200); },
  save: async (page) => { await page.getByRole('button', { name: 'Save to Today’s Bag ↗' }).click(); await page.waitForTimeout(2000); },
  layout: async (page, orientation, preset) => {
    await page.selectOption('#card-orientation', orientation); await page.waitForTimeout(300);
    await page.selectOption('#card-preset', preset); await page.waitForTimeout(900);
  },
};
const read = {
  version: (page) => page.locator('header button').first().innerText().then((t) => t.replace(/\s+/g, ' ').trim()),
  edgeDots: (page) => page.locator('button[aria-label^="Adjust "][aria-label*="edge"]').count(),
  details: (page) => page.evaluate(() => ({ mold: document.querySelector('input[placeholder*="manufacturer"]').value, plastic: document.querySelector('#plastic').value })),
  bag: (page) => page.locator('#bag-export-list .bag-export-disc').allInnerTexts().then((ts) => ts.map((t) => t.replace(/\s+/g, ' ').trim())),
  preset: (page) => page.evaluate(() => document.querySelector('#card-preset').selectedOptions[0].text),
  approved: (page) => page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((e) => e.innerText.trim() === 'Approved output'); return h.parentElement.innerText.replace(/\s+/g, ' ').slice(0, 160); }),
};

// ---------------------------------------------------------------- flip book: one disc from sample photo to approved card
export const flow = {
  title: `DiscStudio ${VERSION}: sample photo to approved card, one step at a time`,
  url: URL,
  steps: [
    { label: (v) => `${v}: home`, read: read.version, mark: 'header button', expect: (v) => v === `DiscStudio ${VERSION}` },
    { label: (n) => `+ tap "MVP · Servo": crop opens, ${n} edge dots`, act: (p) => step.chooseSample(p, 'MVP · Servo'), read: read.edgeDots, mark: 'dialog[open] .photo-stage, dialog[open] canvas, dialog[open] svg', expect: (n) => n === 8 },
    { label: (v) => `+ OK: mold "${v.mold}", plastic "${v.plastic}"`, act: step.acceptCrop, read: read.details, focus: 'input[placeholder*="manufacturer"]', mark: 'input[placeholder*="manufacturer"]', expect: (v) => v.mold === 'MVP · Servo' && v.plastic === 'Neutron' },
    { label: (v) => `+ type your own plastic: box "${v.value}", ${v.suggestions} MVP suggestions offered`,
      act: async (p) => { await p.fill('#plastic', 'Neutron · Sam’s backup'); await p.waitForTimeout(300); },
      read: (p) => p.evaluate(() => { const el = document.querySelector('#plastic'); return { value: el.value, suggestions: el.list ? el.list.options.length : 0 }; }),
      focus: '#plastic', mark: '#plastic', expect: (v) => v.value === 'Neutron · Sam’s backup' && v.suggestions === 10 },
    { label: (v) => `+ Save: bag holds ${JSON.stringify(v)}`, act: step.save, read: read.bag, focus: '#todays-bag', mark: '#bag-export-list .bag-export-disc', expect: (v) => v.length === 1 && v[0].startsWith('Servo') && v[0].includes('Sam’s backup') },
    { label: (v) => `+ layout "${v}"`, act: (p) => step.layout(p, 'vertical', 'u01'), read: read.preset, focus: '#placement-canvas', mark: '#placement-canvas', expect: (v) => v.startsWith('U01') },
    { label: (v) => `+ Add to Export: "${v.slice(0, 60)}"`, act: (p) => p.getByRole('button', { name: 'Add to Export' }).click().then(() => p.waitForTimeout(1500)), read: read.approved, focus: 'section.output-queue', mark: 'section.output-queue', expect: (v) => !/Nothing approved yet/.test(v) },
    { label: (w) => `+ check: page is ${w} px wide on a 430 px phone`, read: (p) => p.evaluate(() => document.documentElement.scrollWidth), mark: 'section.output-queue p.subtle', expect: (w) => w <= 430 },
  ],
};

// ---------------------------------------------------------------- matrix: every card layout × every sample disc
const LAYOUTS = [
  ['vertical', 'u01'], ['vertical', 'u02'], ['vertical', 'u03-front'], ['vertical', 'u03-behind'], ['vertical', 'u04'], ['vertical', 'u05'],
  ['horizontal', 'b01'], ['horizontal', 'b02'], ['horizontal', 'b03'], ['horizontal', 'b04'], ['horizontal', 'b05'],
];
async function renderAll() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const cards = {};
  try {
    for (const sample of SAMPLES) {
      const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
      await page.goto(URL);
      await step.chooseSample(page, sample); await step.acceptCrop(page); await step.save(page);
      await page.selectOption('#canvas-background', 'none'); await page.waitForTimeout(500);
      for (const [orientation, preset] of LAYOUTS) {
        await step.layout(page, orientation, preset);
        cards[`${preset}|${sample}`] = await page.evaluate(() => {
          const c = document.querySelector('canvas.placement-canvas, #placement-canvas');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let ink = 0, x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { ink += 1; const p = (i - 3) / 4, x = p % c.width, y = (p - x) / c.width; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          // the sticker: the card cropped to its own pixels, as the export says it does
          const sw = x1 - x0 + 1, sh = y1 - y0 + 1, s = document.createElement('canvas'); s.width = Math.max(1, sw); s.height = Math.max(1, sh);
          if (ink) s.getContext('2d').drawImage(c, x0, y0, sw, sh, 0, 0, sw, sh);
          return { url: s.toDataURL('image/png'), w: sw, h: sh, ink, total: c.width * c.height, canvas: [c.width, c.height],
            chosen: document.querySelector('#card-preset').value, details: document.querySelector('input[placeholder*="manufacturer"]').value,
            size: [...document.querySelectorAll('label')].find((l) => l.innerText.startsWith('Card size'))?.innerText.replace(/\s+/g, ' ').trim() };
        });
      }
      await page.close();
    }
  } finally { await browser.close(); }
  return cards;
}

export async function layoutMatrix() {
  const cards = await renderAll();
  return matrix({
    title: `DiscStudio ${VERSION}: every card layout × every sample disc (preview canvas, no background)`,
    rows: { name: 'layout', values: LAYOUTS.map(([, p]) => p), label: (p) => p.toUpperCase() },
    cols: { name: 'disc', values: SAMPLES },
    run: (at) => ({ value: cards[`${at.layout}|${at.disc}`], runs: [] }),
    show: (v) => ({ html: `<img src="${v.url}" style="height:150px;width:${Math.round(150 * v.w / v.h)}px;display:block;margin:4px auto;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/10px 10px"><div style="font-size:10px">${v.w} × ${v.h} drawn · label says ${(v.size ?? '').replace(/^Card size /, '')}</div>` }),
    shows: 'the card cropped to its own pixels from the preview canvas (checkerboard = transparent), its drawn size, and the size the page label claims',
    checks: {
      'the layout asked for is the layout chosen': (v, at) => v.chosen === at.layout,
      'the card drew something': (v) => v.ink > 0.01 * v.total,
      'the card leaves some canvas transparent (it is a sticker, not a full frame)': (v) => v.ink < v.total,
      'drawn size matches the "Card size … pixels" label (within 2 px)': (v) => { const m = /(\d+) × (\d+) pixels/.exec(v.size ?? ''); return !!m && Math.abs(+m[1] - v.w) <= 2 && Math.abs(+m[2] - v.h) <= 2; },
    },
  });
}

const pick = process.argv.slice(2);
if (!pick.length || pick.includes('flow')) {
  const report = await shootFlow(flow, 'patterns/out/discstudio-flow');
  const bad = problems(report);
  console.log(`flow: ${report.length} frames, ${bad.length ? bad.join('; ') : 'every claim holds'}${report.at(-1).pageErrors?.length ? `; page errors: ${report.at(-1).pageErrors.join(' | ')}` : ''}`);
  report.forEach((r) => console.log(`  ${r.frame} ${r.claim ? '✓' : '✗'} ${r.label}`));
}
if (!pick.length || pick.includes('matrix')) {
  const m = await layoutMatrix();
  snap(m.html, 'patterns/out/discstudio-matrix', { width: 900 });
  console.log(`matrix: ${m.cells.length} cells, ${m.failures.length} fail, ${m.surprises.length} surprises`);
  m.failures.forEach((c) => console.log(`  ${c.at.layout} × ${c.at.disc}: failed ${c.failed.join(', ')}`));
}
