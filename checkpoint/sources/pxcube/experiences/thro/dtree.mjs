// DTree: thro's decisions, read from its PxC world (Sam, 22 Oct 2026).
// The site is one run of 'thro.site' under a fill (thro-world.mjs). Its receipt's trace is the tree: each node is a
// decision (a contract call), the implementation the run chose, and why (decided by the fill, or the only one).
// Switching an alternative changes the fill for this browser and re-runs the site. Sam's rule is a check contract:
// its proofs, and its verdict on the card on screen, come from the world too.
// Decisions made before the world existed are listed from dtree.json until each becomes a contract.
import { OPEN, SITE_FILL } from './thro-world.mjs';
import { cardLayout } from './native-cards.mjs';

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
  // One decision node: a contract call from the site's trace.
  function decisionNode(node) {
    const contract = world.contracts().find(c => c.id === node.contract), impls = world.implementationsOf(node.contract);
    const chosen = impls.find(i => i.id === node.impl), open = OPEN[node.contract], switched = mine.includes(node.contract);
    const status = switched ? 'mine' : open ? 'open' : 'active';
    const label = { active: 'In the site', open: 'Open', mine: 'Your switch' }[status];
    const why = node.chosenBy?.rung === 'only implementation' ? 'the only implementation so far' : switched ? 'your switch (this browser)' : 'decided by the site\'s fill';
    const alts = impls.length > 1 ? `<div class="dt-alts">${impls.map(impl => {
      const isChosen = impl.id === node.impl, gone = !isChosen && impl.origin?.subsumedBy;
      return `<div class="dt-alt ${isChosen ? 'chosen' : ''}"><em>${isChosen ? 'LIVE HERE' : gone ? 'SUBSUMED' : 'ALTERNATIVE'}</em>${esc(impl.description)}${meta(impl.origin)}${isChosen ? '' : `<button type="button" data-switch="${esc(node.contract)}" data-impl="${esc(impl.id)}">Switch the site to this (your browser)</button>`}</div>`;
    }).join('')}</div>` : '';
    const show = AFFECTS[node.contract] ? `<button type="button" class="dt-show" data-show="${esc(node.contract)}">Show on the page</button>` : '';
    return `<div class="dt-node" id="dt-${esc(node.contract)}"><p class="dt-q"><span class="dt-chip ${status}">${label}</span>${esc(contract?.description)} <code>${esc(node.contract)}#${esc(node.slot)}</code></p><p class="dt-c">${esc(chosen?.description)}</p><p class="dt-why">Chosen: ${why}.</p>${contract?.notes ? `<p class="dt-why">${esc(contract.notes)}</p>` : ''}${open ? `<p class="dt-wait">Waiting on ${esc(open)}</p>` : ''}${impls.length > 1 ? '' : meta(chosen?.origin)}${alts}${show}</div>`;
  }
  function ruleNode() {
    const rule = world.contracts().find(c => c.id === 'thro.rule'), v = verdict();
    return `<div class="dt-node" id="dt-thro.rule"><p class="dt-q"><span class="dt-chip active">Check</span>${esc(rule.description)} <code>thro.rule</code></p><p class="dt-c">${esc(rule.notes)}</p>
      <p class="dt-verdict">Proven by its examples: ${proofs.map(p => `${esc(p.example)} <b class="${p.ok ? 'ok' : 'no'}">${p.ok ? '✓' : '✗'}</b>`).join(' · ')}</p>
      <p class="dt-verdict">The card on screen: ${v ? `<b class="${v.accepted ? 'ok' : 'no'}">${v.accepted ? 'passes' : 'fails'}</b>. ${esc(v.reason)}` : 'not a single card right now.'}</p>
      <button type="button" class="dt-show" data-show="thro.rule">Show on the page</button></div>`;
  }
  const pastNode = n => `<div class="dt-node"><p class="dt-q"><span class="dt-chip ${esc(n.status)}">${n.status === 'open' ? 'Open' : n.status === 'subsumed' ? 'Subsumed' : 'In the site'}</span>${esc(n.question)}</p><p class="dt-c">${esc(n.choice)}</p>${n.waitingOn ? `<p class="dt-wait">Waiting on ${esc(n.waitingOn)}</p>` : ''}${meta(n)}</div>`;
  const pastBranch = parent => { const kids = past.nodes.filter(n => n.parent === parent); return kids.length ? `<ol>${kids.map(n => `<li>${pastNode(n)}${pastBranch(n.id)}</li>`).join('')}</ol>` : ''; };

  function paint() {
    const site = decided.receipt.trace;
    panel.innerHTML = `<header><h2>DTree</h2><button type="button" data-close aria-label="Close the decision tree">Close</button></header><div class="dt-body">
      <h3>The site, decided in PxC</h3><p class="dt-about">One run of <code>${esc(site.contract)}</code> (run ${esc(decided.receipt.runId)}, ${decided.receipt.calls} calls). Each decision is a contract; its alternatives are implementations; the site's choices are its fill.</p>
      <ol><li>${ruleNode()}<ol>${site.calls.map(node => `<li>${decisionNode(node)}</li>`).join('')}</ol></li></ol>
      ${mine.length ? `<button type="button" class="dt-reset" data-reset>Back to the site's decisions (${mine.length} switched here)</button>` : ''}
      <h3>Not in the world yet</h3><p class="dt-about">${esc(past.about ?? '')}</p>${pastBranch(null)}</div>`;
    panel.querySelector('[data-close]').onclick = () => toggle(false);
    panel.querySelectorAll('[data-switch]').forEach(b => b.onclick = () => setFill({ ...fill, [b.dataset.switch]: b.dataset.impl }));
    panel.querySelector('[data-reset]')?.addEventListener('click', () => setFill({ ...SITE_FILL }));
    panel.querySelectorAll('[data-show]').forEach(b => b.onclick = () => light(b.dataset.show));
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
  window.__dtree = { open: openCount, toggle, decisions: decided.receipt.trace.calls.map(n => ({ contract: n.contract, impl: n.impl, rung: n.chosenBy?.rung })), verdict };
}
start();
