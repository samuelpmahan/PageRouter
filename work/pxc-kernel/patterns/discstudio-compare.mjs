// DiscStudio standalone (standalone) against the DiscStudio implementations inside PageRouter's PxCube.
// Needs: DiscStudio standalone served at DISCSTUDIO_URL (default :4173), PageRouter checkpoint/dist served at PAGEROUTER_URL (default :4400),
// and the source trees at the paths below. Run: node patterns/discstudio-compare.mjs [screens] [code] [flow]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { shootFlow, problems, snap } from './flipbook.mjs';
import { matrix } from './matrix.mjs';

const DS = process.env.DISCSTUDIO_URL ?? 'http://localhost:4173/';
const PR = process.env.PAGEROUTER_URL ?? 'http://localhost:4400/';
const SUFFIX = process.env.OUT_SUFFIX ?? ''; // keep a before and an after side by side
const PR_ROOT = process.env.PAGEROUTER_ROOT ?? '/home/claude/samuelpmahan/PageRouter/checkpoint';
const TREES = {
  'DiscStudio standalone': '/home/claude/ds657/source/vendor/discstudio/disc',
  'DiscStudio 6.1.0 in PageRouter (nctk snapshot)': `${PR_ROOT}/vendor/pxcube-checkpoint/nctk-source/vendor/discstudio/disc`,
  'PxCube UploadDiscToShelf (PageRouter source)': `${PR_ROOT}/sources/pxcube/vendor/studio/upload-disc-to-shelf`,
  'DiscStudio-demo on GitHub (source as of 2026-09-29)': '/home/claude/samuelpmahan/discstudio-demo/demo-scratch/new-ship/upload-disc-to-shelf',
};
const EXPERIENCES = [['upload-disc-to-shelf', 'UploadDiscToShelf'], ['upload-disc-to-shelf-delta', 'UploadDiscToShelf Delta'], ['your-shelf', 'Your Shelf'], ['explore-shelf', 'ExploreShelf'], ['build-bag', 'BuildBag'], ['create-graphics', 'CreateGraphics'], ['export-graphics', 'ExportGraphics'], ['on-course', 'On Course']];

// ---------------------------------------------------------------- 1. screens: every DiscStudio surface, first screen, same size
export const screens = {
  title: 'DiscStudio standalone and the eight DiscStudio Experiences in PageRouter\'s PxCube, first screen at 1280 × 900',
  url: DS,
  steps: [
    { label: (v) => `DiscStudio standalone (standalone): "${v}"`, read: (p) => p.locator('h1').first().innerText(), expect: (v) => v.length > 0 },
    ...EXPERIENCES.map(([name, title]) => ({
      label: (v) => `PxCube ${title}: "${v.heading}" · shows ${v.page}`,
      // An Experience renders inside the PxCube shell (opened directly it waits for its host), so open it the way a person does.
      act: async (p) => {
        await p.goto(`${PR}compiled/pxcube/index.html`); await p.waitForTimeout(1500);
        await p.locator('button').filter({ hasText: new RegExp(`^${title}(?!\\s*Delta)`) }).first().click(); await p.waitForTimeout(4000);
      },
      // the page actually showing is the innermost frame (some Experiences wrap the studio app in a second iframe)
      read: async (p) => { const f = p.frames().at(-1); const h = await f.evaluate(() => (document.querySelector('h1,h2')?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)); return { page: f.url().replace(/^.*\/experiences\//, ''), heading: h }; },
      expect: (v) => v.heading.length > 0,
    })),
  ],
};

// ---------------------------------------------------------------- 2. code: every source file of 6.5.8 against the other trees
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n');
function lineDelta(a, b) { // lines only in a, lines only in b (multiset), enough to say "how different"
  const count = new Map(); for (const l of lines(a)) count.set(l, (count.get(l) ?? 0) + 1);
  let onlyB = 0; for (const l of lines(b)) { const c = count.get(l) ?? 0; if (c > 0) count.set(l, c - 1); else onlyB += 1; }
  let onlyA = 0; for (const c of count.values()) onlyA += c; return { onlyA, onlyB };
}
export function codeMatrix() {
  const base = TREES['DiscStudio standalone'];
  const files = fs.readdirSync(base).filter((f) => /\.(ts|mjs|css|html)$/.test(f) && !/\.test\./.test(f)).sort()
    .map((f) => ({ f, n: lines(path.join(base, f)).length })).filter(({ n }) => n >= 40).map(({ f }) => f);
  const others = Object.keys(TREES).filter((k) => k !== 'DiscStudio standalone');
  return matrix({
    title: 'Source files of DiscStudio standalone (40 lines or more, tests excluded): the same file in each other implementation',
    rows: { name: 'file', values: files, label: (f) => `${f} (${lines(path.join(base, f)).length})` },
    cols: { name: 'implementation', values: others },
    run: ({ file, implementation }) => {
      const a = path.join(base, file); const b = path.join(TREES[implementation], file);
      if (!fs.existsSync(b)) return { value: { status: 'absent' } };
      if (sha(a) === sha(b)) return { value: { status: 'same' } };
      return { value: { status: 'changed', ...lineDelta(a, b), size: lines(b).length } };
    },
    show: (v) => (v.status === 'same' ? 'identical' : v.status === 'absent' ? 'absent' : `${v.size} lines · −${v.onlyA} +${v.onlyB}`),
    shows: 'identical to 6.5.8, absent, or that tree\'s line count with lines only in 6.5.8 (−) and only in that tree (+)',
    checks: { 'identical to 6.5.8': (v) => v.status === 'same' },
    expect: () => undefined, // a comparison, not a test: no cell is predicted
  });
}

// ---------------------------------------------------------------- 3. the same person's task in each photo-to-disc implementation
// "Pick MVP Servo, add its photo, save it": the steps are the same; the controls are each implementation's own.
const SERVO = '/home/claude/ds657/source/vendor/discstudio/disc/sample-discs/servo.jpg';
const inner = (p) => p.frames().at(-1); // the studio app runs in the innermost frame of the PxCube shell
export const pxcubeFlow = {
  title: 'PxCube UploadDiscToShelf (opened in the PxCube shell): MVP Servo with a photo, saved',
  url: `${PR}compiled/pxcube/index.html`,
  steps: [
    { label: (v) => `open UploadDiscToShelf: "${v}"`,
      act: async (p) => { await p.waitForTimeout(1500); await p.locator('button').filter({ hasText: /^UploadDiscToShelf(?!\s*Delta)/ }).first().click(); await p.waitForTimeout(4000); },
      read: (p) => inner(p).locator('h1').first().innerText().then((t) => t.replace(/\s+/g, ' ')), expect: (v) => v.length > 0 },
    { label: (v) => `+ search "servo": options ${JSON.stringify(v)}`,
      act: async (p) => { await inner(p).locator('#mold-search').fill('servo'); await p.waitForTimeout(800); },
      read: (p) => inner(p).locator('#mold-options [role=option]').allInnerTexts(), mark: (p) => inner(p).locator('#mold-options'), expect: (v) => v[0] === 'MVP · Servo' },
    { label: (v) => `+ choose the first: mold field "${v.mold}", flights ${v.flights}`,
      act: async (p) => { await inner(p).locator('#mold-option-0').click(); await p.waitForTimeout(800); },
      read: (p) => inner(p).evaluate(() => ({ mold: document.querySelector('#mold-search').value, flights: (document.body.innerText.match(/FLIGHT[^\n]*/i) ?? ['(no flight line)'])[0] })),
      mark: (p) => inner(p).locator('#mold-search'), expect: (v) => v.mold === 'MVP · Servo' },
    { label: (v) => `+ add photo servo.jpg: ${v}`,
      act: async (p) => { await inner(p).locator('input[type=file]').first().setInputFiles(SERVO); await p.waitForTimeout(3500); },
      read: (p) => inner(p).evaluate(() => { const d = document.querySelector('dialog[open]'); if (d) return `dialog "${(d.querySelector('h2,h3')?.innerText ?? '').trim()}" opens`; const im = [...document.querySelectorAll('img')].filter((i) => /^(data|blob):/.test(i.src) && i.getBoundingClientRect().width > 60); return im.length ? `photo shown (${im.length} image${im.length > 1 ? 's' : ''})` : 'no photo shown'; }),
      expect: (v) => v !== 'no photo shown' },
    { name: '+ Use photo', label: (v) => `+ Use photo: ${v}`,
      act: async (p) => { await inner(p).getByRole('button', { name: 'Use photo' }).click(); await p.waitForTimeout(2000); },
      read: (p) => inner(p).evaluate(() => (document.querySelector('dialog[open]') ? 'dialog still open' : `photo in preview; plastic "${(() => { const el = document.querySelector('#plastic'); return el.tagName === 'SELECT' ? el.options[0]?.text : el.value || el.placeholder; })()}"; Save ${document.querySelector('#save').disabled ? 'disabled' : 'enabled'}`)),
      mark: (p) => inner(p).locator('#plastic'), expect: (v) => /Save enabled/.test(v) },
    { name: '+ type your own plastic', label: (v) => `+ type your own plastic: box "${v.value}", ${v.suggestions} MVP suggestions offered`,
      act: async (p) => { await inner(p).locator('#plastic').fill('Neutron · Sam’s backup'); await p.waitForTimeout(300); },
      read: (p) => inner(p).evaluate(() => { const el = document.querySelector('#plastic'); return { value: el.value, suggestions: el.list ? el.list.options.length : 0 }; }),
      mark: (p) => inner(p).locator('#plastic'), expect: (v) => v.value === 'Neutron · Sam’s backup' && v.suggestions === 10 },
    { name: '+ Save', label: (v) => `+ Save: "${v}"`,
      act: async (p) => { if (await inner(p).locator('#save').isDisabled()) throw new Error('Save to shelf is disabled'); await inner(p).getByRole('button', { name: /^Save to shelf/ }).click(); await p.waitForTimeout(2500); },
      read: (p) => inner(p).evaluate(() => document.querySelector('#status')?.innerText.trim().slice(0, 80) ?? ''),
      mark: (p) => inner(p).locator('#status'), expect: (v) => /^Saved and read back/.test(v) },
  ],
};

// ---------------------------------------------------------------- 4. can a disc from each manufacturer be saved? (one mold per manufacturer)
const CATALOG = `${TREES['DiscStudio standalone']}/catalog.ts`;
function firstMoldPerManufacturer() {
  const text = fs.readFileSync(CATALOG, 'utf8'); const seen = new Map();
  for (const m of text.matchAll(/"manufacturer": "([^"]+)",\s*\n\s*"mold": "([^"]+)"/g)) if (!seen.has(m[1])) seen.set(m[1], m[2]);
  return [...seen].sort((a, b) => a[0].localeCompare(b[0]));
}
async function chooseMold(f, manufacturer, mold) {
  const box = f.locator('input[placeholder*="manufacturer"]').first();
  await box.fill(''); await box.fill(mold); await f.waitForTimeout(350);
  const opt = f.locator('[role=option]').filter({ hasText: `${manufacturer} · ${mold}` }).first();
  if (!(await opt.count())) return false; await opt.click(); await f.waitForTimeout(350); return true;
}
// Each cell presses Save and reads the app's own confirmation: an enabled button is not a saved disc
// (the first run of this matrix counted enabled buttons; the flow then showed the browser refusing the form).
async function saveabilityAll() {
  const { chromium } = await import('playwright'); const browser = await chromium.launch(); const out = {};
  const pairs = firstMoldPerManufacturer();
  const status = (f) => f.evaluate(() => document.querySelector('#status')?.innerText.trim() ?? '');
  const invalid = (f) => f.evaluate(() => [...document.querySelectorAll('select:invalid, input:invalid')].map((e) => e.id));
  try {
    // PxCube UploadDiscToShelf: a painting is the default depiction, so no photo is needed
    { const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${PR}compiled/pxcube/index.html`); await p.waitForTimeout(1500);
      await p.locator('button').filter({ hasText: /^UploadDiscToShelf(?!\s*Delta)/ }).first().click(); await p.waitForTimeout(4000);
      const f = p.frames().at(-1);
      for (const [man, mold] of pairs) {
        const found = await chooseMold(f, man, mold);
        const plastics = await f.evaluate(() => { const el = document.querySelector('#plastic'); return [...(el.list ?? el).options].map((o) => o.value).filter(Boolean); });
        const listed = plastics.filter((x) => x !== 'Unknown / not listed'); // a person picks a listed plastic when the guide has one
        if (listed.length) { if (await f.evaluate(() => document.querySelector('#plastic').tagName === 'SELECT')) await f.selectOption('#plastic', listed[0]); else await f.fill('#plastic', listed[0]); await f.waitForTimeout(150); }
        const saveEnabled = await f.evaluate(() => !document.querySelector('#save').disabled);
        const before = await status(f);
        if (saveEnabled) { await f.locator('#save').click(); await p.waitForTimeout(1200); }
        const after = await status(f);
        out[`${man}|PxCube UploadDiscToShelf`] = { found, plastics: plastics.length, saveEnabled, invalid: await invalid(f), status: after, saved: after !== before && /^Saved/.test(after) };
      }
      await p.close(); }
    // DiscStudio standalone: Save needs a photo, so each disc gets servo.jpg through the crop dialog
    { const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }); await p.goto(DS); await p.waitForTimeout(1500);
      for (const [man, mold] of pairs) {
        const found = await chooseMold(p, man, mold);
        await p.locator('input[type=file]').first().setInputFiles(SERVO);
        await p.getByRole('button', { name: 'OK', exact: true }).waitFor({ state: 'visible', timeout: 30000 }); await p.waitForTimeout(600);
        await p.getByRole('button', { name: 'OK', exact: true }).click(); await p.waitForTimeout(800);
        const plastics = await p.evaluate(() => { const el = document.querySelector('#plastic'); return [...(el.list ?? el).options].map((o) => o.value).filter(Boolean); });
        const saveEnabled = await p.evaluate(() => !document.querySelector('#save').disabled);
        const before = await status(p);
        if (saveEnabled) { await p.locator('#save').click(); await p.waitForTimeout(1500); }
        const after = await status(p);
        out[`${man}|DiscStudio standalone`] = { found, plastics: plastics.length, saveEnabled, invalid: await invalid(p), status: after, saved: /Today’s Bag/.test(after) && (after !== before || /Saved/.test(after)) };
      }
      await p.close(); }
  } finally { await browser.close(); }
  return { out, pairs };
}
export async function saveMatrix() {
  const { out, pairs } = await saveabilityAll();
  const molds = Object.fromEntries(pairs);
  const guided = new Set(['Discraft', 'Innova', 'Kastaplast']); // the three manufacturers in plastics.ts (identical file in both)
  return matrix({
    title: 'Choose one mold from each of the catalog\'s 42 manufacturers: can the disc be saved?',
    rows: { name: 'manufacturer', values: pairs.map(([m]) => m), label: (m) => `${m} · ${molds[m]}` },
    cols: { name: 'implementation', values: ['DiscStudio standalone', 'PxCube UploadDiscToShelf'] },
    run: (at) => ({ value: out[`${at.manufacturer}|${at.implementation}`] }),
    show: (v) => `${v.saved ? 'saved' : v.saveEnabled ? 'Save pressed, not saved' : 'Save disabled'} · ${v.plastics} plastic${v.plastics === 1 ? '' : 's'}`,
    shows: 'Save pressed after choosing the mold (6.5.8 with servo.jpg added; PxCube with its default painting), then the app\'s own confirmation read back · plastic choices offered',
    checks: { 'the mold was found in search': (v) => v.found, 'Save can be pressed': (v) => v.saveEnabled, 'the app confirms the disc was saved': (v) => v.saved },
    // prediction from the code: 6.5.8 always offers "Unknown / not listed" and never requires plastic; PxCube requires a plastic and has guides for three manufacturers
    // after the port (PXCUBE_PLASTIC=optional) PxCube should save every manufacturer too
    expect: (at) => at.implementation === 'DiscStudio standalone' || ['optional', 'free-text'].includes(process.env.PXCUBE_PLASTIC) || guided.has(at.manufacturer),
  });
}

const pick = process.argv.slice(2);
const want = (k) => !pick.length || pick.includes(k);
if (want('screens')) {
  const r = await shootFlow(screens, 'patterns/out/discstudio-compare-screens', { width: 1280, height: 900 });
  console.log(`screens: ${problems(r).length ? problems(r).join('; ') : 'all loaded'}`); r.forEach((x) => console.log(`  ${x.claim ? '✓' : '✗'} ${x.label}`));
}
if (want('code')) {
  const m = codeMatrix();
  snap(m.html, 'patterns/out/discstudio-compare-code', { width: 1100 });
  const byCol = (c) => { const xs = m.cells.filter((x) => x.at.implementation === c); return `${xs.filter((x) => x.value.status === 'same').length} identical, ${xs.filter((x) => x.value.status === 'changed').length} changed, ${xs.filter((x) => x.value.status === 'absent').length} absent of ${xs.length}`; };
  Object.keys(TREES).slice(1).forEach((c) => console.log(`code · ${c}: ${byCol(c)}`));
}
if (want('save')) {
  const m = await saveMatrix();
  snap(m.html, `patterns/out/discstudio-compare-save${SUFFIX}`, { width: 900 });
  const col = (c) => m.cells.filter((x) => x.at.implementation === c && x.value.saved).length;
  console.log(`save: DiscStudio standalone ${col('DiscStudio standalone')} of 42 saved, PxCube ${col('PxCube UploadDiscToShelf')} of 42; ${m.surprises.length} surprises`);
  m.surprises.forEach((c) => console.log(`  surprise ${c.at.manufacturer} × ${c.at.implementation}: ${JSON.stringify(c.value)}`));
}
if (want('flow')) {
  const r = await shootFlow(pxcubeFlow, `patterns/out/discstudio-compare-pxcube-flow${SUFFIX}`, { width: 1280, height: 900 });
  console.log(`pxcube flow: ${problems(r).length ? problems(r).join('; ') : 'every claim holds'}`); r.forEach((x) => console.log(`  ${x.claim ? '✓' : '✗'} ${x.label}`));
}
