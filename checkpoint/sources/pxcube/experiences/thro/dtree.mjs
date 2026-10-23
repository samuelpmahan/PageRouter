// DTree: thro's decisions, read from its PxC world (Sam, 22 Oct 2026).
// The site is one run of 'thro.site' under a fill (thro-world.mjs). Its receipt's trace is the tree: each node is a
// decision (a contract call), the implementation the run chose, and why (decided by the fill, or the only one).
// Switching an alternative changes the fill for this browser and re-runs the site. Sam's rule is a check contract:
// its proofs, and its verdict on the card on screen, come from the world too.
// Decisions made before the world existed are listed from dtree.json until each becomes a contract.
import { OPEN, SITE_FILL } from './thro-world.mjs';
import { cardLayout } from './native-cards.mjs';
import { traceToSvg } from './pxc/view.mjs';

const css = `
.dtree-button{position:fixed;left:16px;bottom:16px;z-index:60;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid #3d5141;background:#101812;color:#e9f1e4;font:700 14px/1 system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 6px 20px #0008;cursor:pointer}
.dtree-button b{color:#ffd166}
@media (max-width:760px){.dtree-button{bottom:104px}}
.dtree{position:fixed;top:0;right:0;bottom:0;width:min(460px,100vw);z-index:70;background:#0f1611;color:#e9f1e4;border-left:1px solid #2a3a30;box-shadow:-12px 0 40px #000a;display:flex;flex-direction:column;font:14px/1.45 system-ui,sans-serif}
.dtree[hidden]{display:none}
.dtree header{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #2a3a30}
.dtree header h2{font-size:18px;margin:0;flex:1}
.dtree button{min-height:36px;border-radius:9px;border:1px solid #2a3a30;background:#18221b;color:#e9f1e4;font:inherit;font-weight:600;padding:0 10px;cursor:pointer}
.dtree .dt-body{overflow:auto;padding:8px 12px 28px}
.dtree h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9fb0a3;margin:16px 4px 6px}
.dtree .dt-about{color:#9fb0a3;font-size:12px;margin:4px 4px 8px}
.dtree ol{list-style:none;margin:0;padding:0}
.dtree li>ol{margin-left:14px;border-left:1px dashed #2f4234;padding-left:8px}
.dtree .dt-node{margin:6px 0;padding:10px;border-radius:10px;background:#151f18;border:1px solid #223027}
.dtree .dt-q{color:#9fb0a3;font-size:12px;margin:0 0 3px}
.dtree .dt-c{margin:0;font-weight:600}
.dtree .dt-why{margin:4px 0 0;color:#cfe3c9;font-size:12px}
.dtree .dt-meta{margin:6px 0 0;color:#9fb0a3;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 10px}
.dtree .dt-meta a{color:#c8f49d}
.dtree code{font-size:11px;color:#cfe3c9}
.dtree .dt-chip{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-radius:6px;padding:2px 6px;margin-right:6px;vertical-align:1px}
.dtree .dt-chip.active{background:#c8f49d;color:#10180f}.dtree .dt-chip.open{background:#ffd166;color:#1d1600}.dtree .dt-chip.subsumed{background:#2d3a31;color:#b8c4ba}.dtree .dt-chip.mine{background:#7cc4ff;color:#06121d}
.dtree .dt-wait{margin:6px 0 0;color:#ffd166;font-size:12px}
.dtree .dt-alts{margin:8px 0 0;display:grid;gap:6px}
.dtree .dt-alt{font-size:12px;color:#cfe3c9;border-top:1px solid #223027;padding-top:6px}
.dtree .dt-alt.chosen{color:#e9f1e4}
.dtree .dt-alt em{font-style:normal;font-size:10px;font-weight:800;border-radius:5px;padding:1px 5px;margin-right:6px;background:#2d3a31;color:#b8c4ba}
.dtree .dt-alt.chosen em{background:#c8f49d;color:#10180f}
.dtree .dt-alt button{margin-top:4px;min-height:32px;font-size:12px}
.dtree .dt-verdict{margin:6px 0 0;font-size:12px}.dtree .dt-verdict b.ok{color:#c8f49d}.dtree .dt-verdict b.no{color:#ff9e80}
.dtree .dt-show{margin-top:8px;min-height:32px;font-size:12px}
.dtree .dt-reset{margin:8px 4px 0}
.dtree details{margin-top:8px}.dtree summary{cursor:pointer;color:#c8f49d;font-size:12px}.dtree .dt-trace{overflow:auto;background:#fff;border-radius:8px;margin-top:6px;max-height:60vh}.dtree .dt-trace svg{display:block}
.dtree .dt-ev{margin:4px 0 0;font-size:11px;color:#9fb0a3}.dtree .dt-ev span{display:inline-block;background:#2d3a31;color:#e9f1e4;border-radius:5px;padding:1px 6px;margin:2px 4px 0 0}
.dtree .dt-blame{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:#2a1a14;border:1px solid #ff9e80;font-size:12px}.dtree .dt-blame b{color:#ff9e80}.dtree .dt-blame button{margin-top:6px;min-height:32px;font-size:12px}
.dtree-lit{position:absolute;z-index:65;pointer-events:none;border:3px solid #c8f49d;border-radius:12px;box-shadow:0 0 0 9999px #0006,0 0 24px #c8f49d88}
.dtree-lit span{position:absolute;left:-3px;top:-28px;background:#c8f49d;color:#10180f;font:700 12px/1 system-ui,sans-serif;padding:6px 8px;border-radius:7px;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis}
`;
// Where each decision shows on this page (a page concern, not the world's).
const AFFECTS = {
  'thro.rule': { mode: 'single', sel: ['#graphic-preview'] },
  'thro.single.layouts': { mode: 'single', sel: ['.composition-field'] },
  'thro.bag.layouts': { mode: 'bag', sel: ['.composition-field', '.battle-controls'] },
  'thro.battle.engine': { mode: 'battle', sel: ['.battle-formats', '.composition-field', '.battle-controls'] },
  'thro.card.revision': { mode: 'single', sel: ['#graphic-preview'] },
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const iterLink = n => `<a href="https://iter-${n}.thro.pages.dev/" target="_blank" rel="noopener">iter-${n}</a>`;
const history = o => [o?.by && esc(o.by), o?.iters?.length && o.iters.map(iterLink).join(' '), o?.commits?.length && o.commits.map(c => `<code>${esc(c)}</code>`).join(' ')].filter(Boolean);
const meta = o => history(o).length ? `<p class="dt-meta">${history(o).map(h => `<span>${h}</span>`).join('')}</p>` : '';

async function start() {
  for (let i = 0; i < 100 && !window.__thro; i++) await new Promise(r => setTimeout(r, 100)); // the app builds the world
  const thro = window.__thro; if (!thro) return;
  const { world, decided } = thro, fill = thro.fill;
  let past = { nodes: [] }; try { past = await (await fetch(new URL('./dtree.json', import.meta.url))).json(); } catch { /* history is optional */ }
  // Evidence: every fill of the site, checked in a browser (local/test/thro-fill-matrix-browser.mjs → fill-matrix.json).
  let matrix = null; try { matrix = await (await fetch(new URL('./fill-matrix.json', import.meta.url))).json(); } catch { /* no evidence yet */ }
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const openCount = Object.keys(OPEN).length + past.nodes.filter(n => n.status === 'open').length;
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'dtree-button' });
  button.innerHTML = `DTree <b>${openCount} open</b>`; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'dtree');
  const panel = Object.assign(document.createElement('aside'), { id: 'dtree', className: 'dtree', hidden: true });
  panel.setAttribute('aria-label', 'Decision tree'); document.body.append(button, panel);
  const proofs = world.prove('thro.rule');
  const mine = Object.keys(fill).filter(k => fill[k] !== SITE_FILL[k]);

  // The rule's verdict on the card on screen, run in the world (a check is a normal run).
  function verdict() {
    const href = document.querySelector('#graphic-preview svg image')?.getAttribute('href'), layout = href && cardLayout(href);
    if (!layout || Array.isArray(layout)) return null;
    try { return world.run('thro.rule', { layout }, { fill: { 'thro.rule': 'thro.rule/hierarchy' } }).outputs; } catch { return null; }
  }
  // ---- Blame (the backward pass), from the evidence: compare where this viewer is with the same fill switched one decision.
  const sameFill = (a, b) => Object.keys(SITE_FILL).every(k => a?.[k] === b?.[k]);
  const rowOf = f => matrix?.rows.find(r => sameFill(r.fill, f));
  const tick = v => v === true ? '✓' : v === null || v === undefined ? '–' : '✗';
  const evidenceWhen = () => matrix ? `checked in a browser, ${esc(matrix.when)}` : '';
  function switchEvidence(contract, impl) {
    const now = rowOf(fill), there = rowOf({ ...fill, [contract]: impl });
    if (!now || !there) return null;
    return matrix.checks.filter(c => now.result[c.id]?.ok !== there.result[c.id]?.ok).map(c => ({ id: c.id, label: c.label, from: now.result[c.id]?.ok, to: there.result[c.id]?.ok, note: there.result[c.id]?.note }));
  }
  const evidenceLine = (contract, impl) => {
    const flips = switchEvidence(contract, impl);
    if (!flips) return `<p class="dt-ev">Not checked for this combination yet.</p>`;
    return `<p class="dt-ev">Switching to this (${evidenceWhen()}): ${flips.length ? flips.map(f => `<span>${esc(f.label)} ${tick(f.from)} → ${tick(f.to)}</span>`).join('') : 'no check changes.'}</p>`;
  };
  // Which single decision, switched from where this viewer is, makes the failing rule pass?
  function blame(v) {
    const card = (document.getElementById('composition')?.value ?? '').replace('discstudio:', '').toUpperCase();
    const now = rowOf(fill), fails = now?.result.rule?.ok === false && now.result.rule.note.includes(`${card}:`);
    const fixes = Object.keys(SITE_FILL).flatMap(contract => world.implementationsOf(contract).filter(i => i.id !== fill[contract]).map(i => ({ contract, impl: i, flips: switchEvidence(contract, i.id) })))
      .filter(x => x.flips?.some(f => f.id === 'rule' && f.from === false && f.to === true));
    if (!fixes.length) {
      // A saved card keeps the drawing it was made with (no silent upgrade); the editor offers the fixed drawing as a choice.
      const fixed = [...document.querySelectorAll('.ce-strip button')].find(b => /Use the fixed card/.test(b.textContent));
      if (fixed) return `<div class="dt-blame"><b>Responsible: this card was saved with the old drawing.</b> The site already draws new cards with the fix; saved cards keep their drawing until you choose.<br><button type="button" data-fixcard>✦ Use the fixed card for this one</button></div>`;
      return `<div class="dt-blame"><b>No single switch fixes this.</b> It's in the card itself: keep it as a deliberate exception, or change the card. That call is yours.</div>`;
    }
    return fixes.map(x => {
      const contract = world.contracts().find(c => c.id === x.contract), current = world.implementationsOf(x.contract).find(i => i.id === fill[x.contract]);
      return `<div class="dt-blame"><b>Responsible: ${esc(contract.description)}</b> <code>${esc(x.contract)}</code><br>Now: ${esc(current?.description)}${fails ? ` The evidence agrees: ${esc(card)} fails under this fill.` : ''}<br>Switching to <b style="color:#c8f49d">${esc(x.impl.description)}</b> makes every Single card pass (${evidenceWhen()}).<br><button type="button" data-switch="${esc(x.contract)}" data-impl="${esc(x.impl.id)}">Switch to the passing alternative (your browser)</button></div>`;
    }).join('');
  }
  // One decision node: a contract call from the site's trace.
  function decisionNode(node) {
    const contract = world.contracts().find(c => c.id === node.contract), impls = world.implementationsOf(node.contract);
    const chosen = impls.find(i => i.id === node.impl), open = OPEN[node.contract], switched = mine.includes(node.contract);
    const status = switched ? 'mine' : open ? 'open' : 'active';
    const label = { active: 'In the site', open: 'Open', mine: 'Your switch' }[status];
    const why = node.chosenBy?.rung === 'only implementation' ? 'the only implementation so far' : switched ? 'your switch (this browser)' : 'decided by the site\'s fill';
    const alts = impls.length > 1 ? `<div class="dt-alts">${impls.map(impl => {
      const isChosen = impl.id === node.impl, gone = !isChosen && impl.origin?.subsumedBy;
      return `<div class="dt-alt ${isChosen ? 'chosen' : ''}"><em>${isChosen ? 'LIVE HERE' : gone ? 'SUBSUMED' : 'ALTERNATIVE'}</em>${esc(impl.description)}${meta(impl.origin)}${isChosen ? '' : evidenceLine(node.contract, impl.id)}${isChosen ? '' : `<button type="button" data-switch="${esc(node.contract)}" data-impl="${esc(impl.id)}">Switch the site to this (your browser)</button>`}</div>`;
    }).join('')}</div>` : '';
    const show = AFFECTS[node.contract] ? `<button type="button" class="dt-show" data-show="${esc(node.contract)}">Show on the page</button>` : '';
    return `<div class="dt-node" id="dt-${esc(node.contract)}"><p class="dt-q"><span class="dt-chip ${status}">${label}</span>${esc(contract?.description)} <code>${esc(node.contract)}#${esc(node.slot)}</code></p><p class="dt-c">${esc(chosen?.description)}</p><p class="dt-why">Chosen: ${why}.</p>${contract?.notes ? `<p class="dt-why">${esc(contract.notes)}</p>` : ''}${open ? `<p class="dt-wait">Waiting on ${esc(open)}</p>` : ''}${impls.length > 1 ? '' : meta(chosen?.origin)}${alts}${show}</div>`;
  }
  // The screen: one PxC run from the site's decisions down to the card on screen and the rule on its measured layout (thro-app runScreen).
  function screenNode() {
    const sc = window.__thro?.screen;
    if (!sc) return `<div class="dt-node"><p class="dt-q"><span class="dt-chip active">Run</span>What is on screen <code>thro.screen</code></p><p class="dt-why">Runs for a Single card; switch to Single to see it.</p></div>`;
    if (sc.error) return `<div class="dt-node"><p class="dt-q"><span class="dt-chip open">Run</span>What is on screen <code>thro.screen</code></p><p class="dt-wait">${esc(sc.error)}</p></div>`;
    const o = sc.outputs, r = sc.receipt, st = sc.stats;
    let picture = '';
    try { picture = traceToSvg(r.trace, world.part, { title: `thro.screen, run ${r.runId}: the site's decisions, this card's recipe, the rule on what was drawn`, receipt: r, valueChars: 52, expand: n => world.node(n.cachedFrom.run, n.cachedFrom.call) }); } catch (e) { picture = `<p class="dt-wait">${esc(e.message)}</p>`; }
    return `<div class="dt-node" id="dt-screen"><p class="dt-q"><span class="dt-chip active">Run ${esc(r.runId)}</span>What is on screen, and does it keep the rule? <code>thro.screen</code></p>
      <p class="dt-c">${esc(o.recipe.preset.toUpperCase())} · ${esc(o.recipe.disc.manufacturer)} ${esc(o.recipe.disc.name)}${o.recipe.revision ? ` · revision ${o.recipe.revision}` : ''}</p>
      <p class="dt-why">Recipe Part <code>${esc(sc.recipeHash)}</code>: the same recipe always draws the same pixels.</p>
      <p class="dt-verdict">Rule on what was drawn: <b class="${o.accepted ? 'ok' : 'no'}">${o.accepted ? 'passes' : 'fails'}</b>. ${esc(o.reason)}</p>
      <p class="dt-ev">Card pixels this session: <span>${sc.pixels.drawn} drawn</span><span>${sc.pixels.reused} reused by recipe hash</span> · kernel: <span>${st.cacheHits} reused</span><span>${st.cacheMisses} computed</span><span>${st.parts} Parts</span></p>
      <details><summary>The kernel's picture of this run</summary><div class="dt-trace">${picture}</div></details></div>`;
  }
  function ruleNode() {
    const rule = world.contracts().find(c => c.id === 'thro.rule'), v = verdict();
    return `<div class="dt-node" id="dt-thro.rule"><p class="dt-q"><span class="dt-chip active">Check</span>${esc(rule.description)} <code>thro.rule</code></p><p class="dt-c">${esc(rule.notes)}</p>
      <p class="dt-verdict">Proven by its examples: ${proofs.map(p => `${esc(p.example)} <b class="${p.ok ? 'ok' : 'no'}">${p.ok ? '✓' : '✗'}</b>`).join(' · ')}</p>
      <p class="dt-verdict">The card on screen: ${v ? `<b class="${v.accepted ? 'ok' : 'no'}">${v.accepted ? 'passes' : 'fails'}</b>. ${esc(v.reason)}` : 'not a single card right now.'}</p>${v && !v.accepted ? blame(v) : ''}
      <button type="button" class="dt-show" data-show="thro.rule">Show on the page</button></div>`;
  }
  const pastNode = n => `<div class="dt-node"><p class="dt-q"><span class="dt-chip ${esc(n.status)}">${n.status === 'open' ? 'Open' : n.status === 'subsumed' ? 'Subsumed' : 'In the site'}</span>${esc(n.question)}</p><p class="dt-c">${esc(n.choice)}</p>${n.waitingOn ? `<p class="dt-wait">Waiting on ${esc(n.waitingOn)}</p>` : ''}${meta(n)}</div>`;
  const pastBranch = parent => { const kids = past.nodes.filter(n => n.parent === parent); return kids.length ? `<ol>${kids.map(n => `<li>${pastNode(n)}${pastBranch(n.id)}</li>`).join('')}</ol>` : ''; };

  function paint() {
    const site = decided.receipt.trace;
    panel.innerHTML = `<header><h2>DTree</h2><button type="button" data-close aria-label="Close the decision tree">Close</button></header><div class="dt-body">
      <h3>The site, decided in PxC</h3><p class="dt-about">One run of <code>${esc(site.contract)}</code> (run ${esc(decided.receipt.runId)}, ${decided.receipt.calls} calls). Each decision is a contract; its alternatives are implementations; the site's choices are its fill.</p>
      <p class="dt-about"><a href="./fill-matrix.html" style="color:#c8f49d">Every fill, checked in a browser →</a> what each switch changes, and which checks it breaks.</p>
      <ol><li>${screenNode()}</li><li>${ruleNode()}<ol>${site.calls.map(node => `<li>${decisionNode(node)}</li>`).join('')}</ol></li></ol>
      ${mine.length ? `<button type="button" class="dt-reset" data-reset>Back to the site's decisions (${mine.length} switched here)</button>` : ''}
      <h3>Not in the world yet</h3><p class="dt-about">${esc(past.about ?? '')}</p>${pastBranch(null)}</div>`;
    panel.querySelector('[data-close]').onclick = () => toggle(false);
    panel.querySelectorAll('[data-switch]').forEach(b => b.onclick = () => setFill({ ...fill, [b.dataset.switch]: b.dataset.impl }));
    panel.querySelector('[data-reset]')?.addEventListener('click', () => setFill({ ...SITE_FILL }));
    panel.querySelectorAll('[data-show]').forEach(b => b.onclick = () => light(b.dataset.show));
    panel.querySelector('[data-fixcard]')?.addEventListener('click', () => { [...document.querySelectorAll('.ce-strip button')].find(b => /Use the fixed card/.test(b.textContent))?.click(); toggle(false); });
  }
  function setFill(next) {
    const diff = Object.fromEntries(Object.entries(next).filter(([k, v]) => SITE_FILL[k] !== v));
    try { Object.keys(diff).length ? localStorage.setItem('thro-fill', JSON.stringify(diff)) : localStorage.removeItem('thro-fill'); } catch { /* storage unavailable */ }
    const url = new URL(location.href); url.searchParams.set('dtree', ''); location.href = url.href; // re-run the site under the new fill
  }
  const lights = [];
  function unlight() { panel.style.visibility = ''; while (lights.length) lights.pop().remove(); }
  async function light(id) {
    unlight(); const where = AFFECTS[id]; if (!where) return;
    const tab = document.querySelector(`[data-mode="${where.mode}"]`);
    if (tab && tab.getAttribute('aria-pressed') !== 'true') { tab.click(); await new Promise(r => setTimeout(r, 1600)); }
    const targets = where.sel.flatMap(sel => [...document.querySelectorAll(sel)]).filter(el => el.getClientRects().length);
    if (!targets.length) return;
    targets[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); await new Promise(r => setTimeout(r, 450));
    panel.style.visibility = 'hidden';
    const label = world.contracts().find(c => c.id === id)?.description ?? id;
    for (const el of targets) {
      const r = el.getBoundingClientRect(), box = document.createElement('div'); box.className = 'dtree-lit';
      Object.assign(box.style, { left: `${r.left + scrollX - 4}px`, top: `${r.top + scrollY - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
      box.innerHTML = `<span>${esc(label)}</span>`; document.body.append(box); lights.push(box);
    }
    setTimeout(() => { unlight(); paint(); }, 3500);
  }
  function toggle(on = panel.hidden) { panel.hidden = !on; button.setAttribute('aria-expanded', String(on)); if (!on) unlight(); if (on) { paint(); panel.querySelector('[data-close]')?.focus(); } }
  button.onclick = () => toggle();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { toggle(false); button.focus(); } });
  addEventListener('resize', unlight);
  if (new URLSearchParams(location.search).has('dtree')) setTimeout(() => toggle(true), 600);
  window.__dtree = { open: openCount, toggle, blame: () => { const v = verdict(); return v && !v.accepted ? blame(v) : null; }, decisions: decided.receipt.trace.calls.map(n => ({ contract: n.contract, impl: n.impl, rung: n.chosenBy?.rung })), verdict };
}
start();
