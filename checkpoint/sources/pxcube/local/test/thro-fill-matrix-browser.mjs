// thro under every fill: the forward pass over the whole decision tree (rung 1 of the PxC roadmap, Sam 22 Oct 2026).
// Enumerates every combination of the decisions in thro-world.mjs, loads the real site under each one, and checks what a
// person would notice. Sam's rule runs in the world (thro.rule) on every Single card layout. Then, for each decision, it
// compares the site's own fill with the same fill where only that decision is switched: which checks flip (the discrete
// gradient). Writes experiences/thro/fill-matrix.html (a page) and fill-matrix.json. Exits 1 if the site's own fill fails.
// Usage: node thro-fill-matrix-browser.mjs http://localhost:8766/   Env: PLAYWRIGHT_MODULE, CHROMIUM_PATH.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createThroWorld, decide, SITE_FILL, OPEN } from '../../experiences/thro/thro-world.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = new URL(process.argv[2] ?? 'http://localhost:8766/');
const outDir = path.resolve(here, '../../experiences/thro');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// ---- Every fill of the decisions (the kernel says which contracts have alternatives).
const world = createThroWorld();
const decisions = Object.keys(SITE_FILL).map(id => ({ id, question: world.contracts().find(c => c.id === id).description, impls: world.implementationsOf(id).map(i => i.id) }));
const fills = decisions.reduce((all, d) => all.flatMap(f => d.impls.map(impl => ({ ...f, [d.id]: impl }))), [{}]);
const short = impl => impl.split('/')[1];
const key = fill => decisions.map(d => short(fill[d.id])).join(' · ');
const isSite = fill => decisions.every(d => fill[d.id] === SITE_FILL[d.id]);

const CHECKS = [
  ['opens', 'Opens', 'The site loads and says Ready, with no page errors.'],
  ['single', 'Single offers', 'Single offers exactly what the world decided (11 cards from one renderer, or the vector compositions).'],
  ['download', 'First-tap download', 'The first tap on Download PNG downloads a 1920 × 1080 file.'],
  ['bag', 'Bag lineup', 'Bag offers what the world decided, renders three discs, and Keep keeps it.'],
  ['battle', 'Battle', 'Battle is the engine the world decided: layouts with points, or the formats editor (which passes the rule).'],
  ['rule', 'Rule on Single cards', 'thro.rule, run in the world, on every Single card layout (Servo).'],
];

async function runFill(fill) {
  const s = decide(createThroWorld(), fill).site, result = {}, errors = []; // s: what this fill makes the site show
  const diff = Object.fromEntries(Object.entries(fill).filter(([k, v]) => SITE_FILL[k] !== v));
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.addInitScript(f => { try { localStorage.setItem('thro-fill', f); } catch {} }, JSON.stringify(diff));
  const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  const settle = (ms = 1500) => p.waitForTimeout(ms);
  const record = (id, ok, note) => { result[id] = { ok, note }; };
  try {
    await p.goto(base.href, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => /Ready|Saved/.test(document.getElementById('status')?.textContent ?? '') && document.querySelector('#graphic-preview svg'), null, { timeout: 30000 });
    record('opens', !errors.length, errors.length ? errors.join(' | ') : 'Ready');
  } catch (e) { record('opens', false, String(e).split('\n')[0]); await context.close(); return { shows: s, result }; }

  // Single offers what the world decided.
  const single = await p.locator('[data-study]').evaluateAll(els => els.map(e => e.dataset.study));
  const wantCards = s.single === 'cards';
  record('single', wantCards ? single.length === 11 && single.every(x => x.startsWith('discstudio:')) : single.length > 0 && single.every(x => !x.startsWith('discstudio')),
    `${single.length} layouts, ${wantCards ? 'all cards' : 'all vector compositions'} expected`);

  try {
    if (await p.locator('#native-side').count()) await p.selectOption('#native-side', (await p.inputValue('#native-side')) === 'left' ? 'right' : 'left');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.locator('#download-png').click()]);
    record('download', /1920x1080/.test(dl.suggestedFilename()), dl.suggestedFilename());
  } catch (e) { record('download', false, String(e).split('\n')[0]); }

  // The rule on every Single card layout, run in the world on the layout the renderer recorded.
  if (wantCards) {
    const fails = [];
    for (const study of single) {
      await p.locator(`[data-study="${study}"]`).click(); await settle(900);
      await p.waitForFunction(id => document.getElementById('composition')?.value === id && document.querySelector('#graphic-preview svg image'), study, { timeout: 15000 }).catch(() => {});
      const v = await p.evaluate(async () => {
        const { cardLayout } = await import(new URL('./native-cards.mjs', location.href).href);
        const href = document.querySelector('#graphic-preview svg image')?.getAttribute('href'), layout = href && cardLayout(href);
        if (!layout) return { accepted: false, reason: 'no recorded layout' };
        return window.__thro.world.run('thro.rule', { layout }, { fill: { 'thro.rule': 'thro.rule/hierarchy' } }).outputs;
      });
      if (!v.accepted) fails.push(`${study.replace('discstudio:', '').toUpperCase()}: ${v.reason}`);
    }
    record('rule', !fails.length, fails.length ? fails.join(' · ') : `${single.length}/${single.length} cards pass`);
  } else record('rule', null, 'Not measured: vector compositions have no recorded card layout.');

  // Bag lineup.
  try {
    await p.locator('[data-mode="bag"]').click(); await settle();
    const n = await p.locator('[data-disc]').count();
    for (let i = 0; i < n; i++) if (await p.locator('[data-disc]').nth(i).getAttribute('aria-pressed') !== 'true') { await p.locator('[data-disc]').nth(i).click(); await settle(1200); }
    await settle(2500);
    const bag = await p.locator('[data-study]').evaluateAll(els => els.map(e => e.dataset.study));
    const offers = s.bag === 'lineups' ? bag.length === 5 && bag.every(x => x.startsWith('discstudio-lineup:')) : bag.length > 0 && bag.every(x => !x.startsWith('discstudio'));
    const drawn = await p.locator('#graphic-preview svg').count();
    const before = await p.locator('.capture-choice').count(); await p.locator('#keep-graphic').click(); await settle();
    const kept = await p.locator('.capture-choice').count() === before + 1;
    record('bag', offers && drawn > 0 && kept, `${bag.length} layouts (${s.bag}), ${drawn ? 'drawn' : 'not drawn'}, ${kept ? 'kept' : 'not kept'}`);
  } catch (e) { record('bag', false, String(e).split('\n')[0]); }

  // Battle.
  try {
    await p.locator('[data-mode="battle"]').click(); await settle(3000);
    if (s.battle === 'formats') {
      const frame = await p.locator('.battle-formats iframe').count();
      const lab = p.frames().find(f => f.url().includes('battle-lab'));
      if (lab) await lab.waitForFunction(() => document.body.dataset.done === 'true', null, { timeout: 30000 });
      const rule = lab ? await lab.evaluate(() => document.body.dataset.rule) : null;
      record('battle', frame === 1 && rule === 'true', `formats editor ${frame ? 'in the site' : 'missing'}, rule ${rule}`);
    } else {
      const studies = await p.locator('[data-study]').count(), points = await p.locator('[data-points]').count();
      record('battle', studies > 0 && points >= 2, `${studies} layouts, ${points} points fields`);
    }
  } catch (e) { record('battle', false, String(e).split('\n')[0]); }
  if (errors.length && result.opens.ok) result.opens = { ok: false, note: errors.join(' | ') };
  await context.close();
  return { shows: s, result };
}

const rows = [];
for (const fill of fills) { const t = Date.now(); const r = await runFill(fill); rows.push({ fill, key: key(fill), site: isSite(fill), ...r }); console.log(`${isSite(fill) ? '* ' : '  '}${key(fill).padEnd(78)} ${CHECKS.map(([id]) => r.result[id]?.ok === true ? '✓' : r.result[id]?.ok === null ? '–' : '✗').join(' ')}  ${Math.round((Date.now() - t) / 1000)} s`); }
await browser.close();

// ---- The discrete gradient: from the site's own fill, switch one decision at a time; which checks flip?
const siteRow = rows.find(r => r.site), verdict = (row, id) => row.result[id]?.ok;
const gradient = decisions.flatMap(d => d.impls.filter(i => i !== SITE_FILL[d.id]).map(alt => {
  const row = rows.find(r => r.key === key({ ...SITE_FILL, [d.id]: alt }));
  return { decision: d.id, question: d.question, from: SITE_FILL[d.id], to: alt, flips: CHECKS.filter(([id]) => verdict(row, id) !== verdict(siteRow, id)).map(([id, label]) => ({ id, label, from: verdict(siteRow, id), to: verdict(row, id), note: row.result[id]?.note })) };
}));

// ---- The page.
const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mark = r => r?.ok === true ? '<b class="ok">✓</b>' : r?.ok === null ? '<b class="na">–</b>' : '<b class="no">✗</b>';
const when = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const passing = rows.filter(r => CHECKS.every(([id]) => r.result[id]?.ok !== false)).length;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>thro under every fill</title>
<style>:root{--bg:#0d140f;--panel:#16201a;--ink:#eef3ea;--muted:#9fb0a3;--lime:#c8f49d;--bad:#ff8a6b;--amber:#ffd166;--line:#2a3a30}*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}main{max-width:1280px;margin:0 auto;padding:20px 16px 56px}h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.lead{color:var(--muted);max-width:80ch;margin:0 0 14px}.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:900px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}th{color:var(--muted);font-weight:600;font-size:12px}td.k{font-size:12px}tr.site{background:#1d2a1f}
tr.site td.k::before{content:'THE SITE  ';color:var(--lime);font-weight:800;font-size:10px;letter-spacing:.08em}b.ok{color:var(--lime)}b.no{color:var(--bad)}b.na{color:var(--muted)}
td small{display:block;color:var(--muted);font-size:11px;max-width:260px}.chip{display:inline-block;font-size:11px;padding:1px 6px;border-radius:5px;background:#2d3a31;margin:1px 2px 1px 0}
.grad{display:grid;gap:8px}.g{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px}.g p{margin:2px 0}.open{color:var(--amber);font-size:12px}code{color:#cfe3c9;font-size:12px}</style></head><body><main>
<h1>thro under every fill</h1><p class="lead">The site is one PxC world. Each of its ${decisions.length} decisions has ${decisions.map(d => d.impls.length).join(' × ')} alternatives, so there are ${fills.length} possible sites. Each was loaded in a real browser (1280 × 900) and checked for what a person would notice. ${passing} of ${fills.length} pass every check that applies. Run ${esc(when)} against <code>${esc(base.href)}</code>.</p>
<h2>What switching one decision changes (from the site's own choices)</h2><div class="grad">${gradient.map(g => `<div class="g"><p><b>${esc(g.question)}</b> <code>${esc(g.decision)}</code></p><p>${esc(short(g.from))} → ${esc(short(g.to))}: ${g.flips.length ? g.flips.map(f => `<span class="chip">${esc(f.label)}: ${f.from === true ? '✓' : f.from === null ? '–' : '✗'} → ${f.to === true ? '✓' : f.to === null ? '–' : '✗'}</span>${f.to === false ? ` <small>${esc(f.note)}</small>` : ''}`).join(' ') : 'no check changes'}</p>${OPEN[g.decision] ? `<p class="open">Open: waiting on ${esc(OPEN[g.decision])}</p>` : ''}</div>`).join('')}</div>
<h2>Every fill</h2><div class="scroll"><table><thead><tr><th>${decisions.map(d => esc(d.question)).join('<br>')}</th>${CHECKS.map(([, label, why]) => `<th title="${esc(why)}">${esc(label)}</th>`).join('')}</tr></thead><tbody>
${rows.map(r => `<tr class="${r.site ? 'site' : ''}"><td class="k">${decisions.map(d => esc(short(r.fill[d.id]))).join('<br>')}</td>${CHECKS.map(([id]) => `<td>${mark(r.result[id])}<small>${esc(r.result[id]?.note)}</small></td>`).join('')}</tr>`).join('\n')}
</tbody></table></div><p class="lead" style="margin-top:12px">${CHECKS.map(([, label, why]) => `<b>${esc(label)}</b>: ${esc(why)}`).join('<br>')}</p></main></body></html>`;
fs.writeFileSync(path.join(outDir, 'fill-matrix.html'), html);
fs.writeFileSync(path.join(outDir, 'fill-matrix.json'), JSON.stringify({ when, base: base.href, decisions, checks: CHECKS.map(([id, label]) => ({ id, label })), rows, gradient }, null, 1));
console.log(`${passing}/${fills.length} fills pass every applicable check; the site's own fill ${CHECKS.every(([id]) => siteRow.result[id]?.ok !== false) ? 'passes' : 'FAILS'}.`);
process.exitCode = CHECKS.every(([id]) => siteRow.result[id]?.ok !== false) ? 0 : 1;
