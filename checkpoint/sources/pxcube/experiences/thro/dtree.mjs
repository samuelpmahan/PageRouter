// DTree: thro's decision tree, on the site itself (Sam, 22 Oct 2026).
// One site; every decision is a node held in place by its parent. Open the tree with the DTree button
// (or ?dtree), hover or focus a decision to outline what it changed on this page.
// Data: dtree.json. This file only reads it; nothing here changes the graphic or the workspace.
const STATUS = { active: 'In the site', open: 'Open', subsumed: 'Subsumed' };
const css = `
.dtree-button{position:fixed;left:16px;bottom:16px;z-index:60;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid #3d5141;background:#101812;color:#e9f1e4;font:700 14px/1 system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 6px 20px #0008;cursor:pointer}
.dtree-button b{color:#c8f49d}
@media (max-width:760px){.dtree-button{bottom:104px}}
.dtree{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:70;background:#0f1611;color:#e9f1e4;border-left:1px solid #2a3a30;box-shadow:-12px 0 40px #000a;display:flex;flex-direction:column;font:14px/1.45 system-ui,sans-serif}
.dtree[hidden]{display:none}
.dtree header{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #2a3a30}
.dtree header h2{font-size:18px;margin:0;flex:1}
.dtree header button,.dtree .dt-filter button,.dtree .dt-act{min-height:36px;border-radius:9px;border:1px solid #2a3a30;background:#18221b;color:#e9f1e4;font:inherit;font-weight:600;padding:0 10px;cursor:pointer}
.dtree .dt-filter{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #2a3a30}
.dtree .dt-filter button[aria-pressed="true"]{background:#c8f49d;color:#10180f;border-color:#c8f49d}
.dtree .dt-about{color:#9fb0a3;font-size:12px;padding:8px 16px 0;margin:0}
.dtree ol{list-style:none;margin:0;padding:0}
.dtree .dt-body{overflow:auto;padding:8px 10px 24px}
.dtree li>ol{margin-left:14px;border-left:1px dashed #2f4234;padding-left:8px}
.dtree .dt-node{margin:6px 0;padding:9px 10px;border-radius:10px;background:#151f18;border:1px solid #223027;outline:none}
.dtree .dt-node:hover,.dtree .dt-node:focus-visible,.dtree .dt-node.is-lit{border-color:#c8f49d}
.dtree .dt-node.subsumed{opacity:.62}
.dtree .dt-q{color:#9fb0a3;font-size:12px;margin:0 0 3px}
.dtree .dt-c{margin:0;font-weight:600}
.dtree .dt-meta{margin:6px 0 0;color:#9fb0a3;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 10px}
.dtree .dt-meta a{color:#c8f49d}
.dtree code{font-size:11px;color:#cfe3c9}
.dtree .dt-chip{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-radius:6px;padding:2px 6px;margin-right:6px;vertical-align:1px}
.dtree .dt-chip.active{background:#c8f49d;color:#10180f}.dtree .dt-chip.open{background:#ffd166;color:#1d1600}.dtree .dt-chip.subsumed{background:#2d3a31;color:#b8c4ba}
.dtree .dt-wait{margin:6px 0 0;color:#ffd166;font-size:12px}
.dtree .dt-alts{margin:6px 0 0;display:grid;gap:4px}
.dtree .dt-alt{font-size:12px;color:#cfe3c9}.dtree .dt-alt a{color:#c8f49d}
.dtree .dt-alt em{font-style:normal;color:#10180f;background:#c8f49d;border-radius:5px;padding:0 5px;margin-left:4px;font-size:10px;font-weight:800}
.dtree .dt-act{margin-top:6px;min-height:32px;font-size:12px}
.dtree-lit{position:absolute;z-index:65;pointer-events:none;border:3px solid #c8f49d;border-radius:12px;box-shadow:0 0 0 9999px #0006,0 0 24px #c8f49d88}
.dtree-lit span{position:absolute;left:-3px;top:-28px;background:#c8f49d;color:#10180f;font:700 12px/1 system-ui,sans-serif;padding:6px 8px;border-radius:7px;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis}
`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const iterLink = n => `<a href="https://iter-${n}.thro.pages.dev/" target="_blank" rel="noopener">iter-${n}</a>`;

async function start() {
  let tree;
  try { tree = await (await fetch(new URL('./dtree.json', import.meta.url))).json(); } catch { return; } // no tree: the site is unchanged
  const nodes = tree.nodes, byId = new Map(nodes.map(n => [n.id, n])), kids = id => nodes.filter(n => n.parent === id);
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const open = nodes.filter(n => n.status === 'open').length;
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'dtree-button' });
  button.innerHTML = `DTree <b>${open} open</b>`; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'dtree');
  const panel = Object.assign(document.createElement('aside'), { id: 'dtree', className: 'dtree', hidden: true });
  panel.setAttribute('aria-label', 'Decision tree');
  document.body.append(button, panel);
  let filter = 'all';

  const node = n => {
    const parts = [];
    if (n.by) parts.push(esc(n.by));
    if (n.iters?.length) parts.push(n.iters.map(iterLink).join(' '));
    if (n.commits?.length) parts.push(n.commits.map(c => `<code>${esc(c)}</code>`).join(' '));
    if (n.subsumedBy) parts.push(`subsumed by <a href="#dt-${esc(n.subsumedBy)}">${esc(byId.get(n.subsumedBy)?.question ?? n.subsumedBy)}</a>`);
    if (n.checks?.length) parts.push(`checked by ${n.checks.map(c => `<code>${esc(c.split('/').pop())}</code>`).join(', ')}`);
    (n.links ?? []).forEach(l => parts.push(`<a href="${esc(l.href)}">${esc(l.label)}</a>`));
    const alts = n.alternatives?.length ? `<div class="dt-alts">${n.alternatives.map(a => `<div class="dt-alt">${a.href ? `<a href="${esc(a.href)}">${esc(a.label)}</a>` : esc(a.label)}${a.current ? '<em>LIVE HERE</em>' : ''}</div>`).join('')}</div>` : '';
    const show = n.affects?.length ? `<button type="button" class="dt-act" data-show="${esc(n.id)}">Show on the page${n.mode ? ` (${esc(n.mode)})` : ''}</button>` : '';
    return `<div class="dt-node ${esc(n.status)}" id="dt-${esc(n.id)}" tabindex="0" data-node="${esc(n.id)}"><p class="dt-q"><span class="dt-chip ${esc(n.status)}">${esc(STATUS[n.status] ?? n.status)}</span>${esc(n.question)}</p><p class="dt-c">${esc(n.choice)}</p>${n.waitingOn ? `<p class="dt-wait">Waiting on ${esc(n.waitingOn)}</p>` : ''}${alts}${parts.length ? `<p class="dt-meta">${parts.map(p => `<span>${p}</span>`).join('')}</p>` : ''}${show}</div>`;
  };
  // A node is shown if it matches the filter or has a descendant that does, so the path to it stays visible.
  const matches = n => filter === 'all' || n.status === filter;
  const visible = n => matches(n) || kids(n.id).some(visible);
  const branch = id => { const list = kids(id).filter(visible); return list.length ? `<ol>${list.map(n => `<li>${node(n)}${branch(n.id)}</li>`).join('')}</ol>` : ''; };
  const count = s => nodes.filter(n => s === 'all' || n.status === s).length;
  function paint() {
    panel.innerHTML = `<header><h2>DTree</h2><button type="button" data-close aria-label="Close the decision tree">Close</button></header><p class="dt-about">Every decision in this site, held in place by the one above it. Hover or focus one to see what it changed here.</p><div class="dt-filter" role="group" aria-label="Show">${['all', 'open', 'active', 'subsumed'].map(s => `<button type="button" data-filter="${s}" aria-pressed="${filter === s}">${s === 'all' ? 'All' : STATUS[s]} ${count(s)}</button>`).join('')}</div><div class="dt-body">${branch(null)}</div>`;
    panel.querySelector('[data-close]').onclick = () => toggle(false);
    panel.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; paint(); });
    panel.querySelectorAll('[data-node]').forEach(el => {
      const n = byId.get(el.dataset.node);
      el.addEventListener('mouseenter', () => { if (!showing) light(n, false); }); el.addEventListener('focus', () => { if (!showing) light(n, false); });
      el.addEventListener('mouseleave', () => { if (!showing) unlight(); }); el.addEventListener('blur', () => { if (!showing) unlight(); });
    });
    panel.querySelectorAll('[data-show]').forEach(b => b.onclick = event => { event.stopPropagation(); light(byId.get(b.dataset.show), true); });
  }
  // Outline what a decision changed. If it lives in another mode (Bag, Battle), switch there first.
  const lights = []; let showing = null; // while a 'Show on the page' runs, hover changes nothing
  function unlight() { panel.style.visibility = ''; while (lights.length) lights.pop().remove(); panel.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit')); }
  async function light(n, go) {
    unlight(); if (!n?.affects?.length) return;
    const run = go ? (showing = {}) : null;
    document.getElementById(`dt-${n.id}`)?.classList.add('is-lit');
    if (go && n.mode && document.querySelector(`[data-mode="${n.mode}"]`)?.getAttribute('aria-pressed') !== 'true') {
      document.querySelector(`[data-mode="${n.mode}"]`)?.click(); await new Promise(r => setTimeout(r, 1500));
    }
    const targets = n.affects.flatMap(sel => [...document.querySelectorAll(sel)]).filter(el => el.getClientRects().length);
    if (go && targets[0]) { targets[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); await new Promise(r => setTimeout(r, 450)); }
    if (go && targets.length) panel.style.visibility = 'hidden'; // step aside so the outlined parts are visible
    for (const el of targets) {
      const r = el.getBoundingClientRect(), box = document.createElement('div');
      box.className = 'dtree-lit'; Object.assign(box.style, { left: `${r.left + scrollX - 4}px`, top: `${r.top + scrollY - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
      box.innerHTML = `<span>${esc(n.question)}</span>`; document.body.append(box); lights.push(box);
    }
    if (go && !targets.length) document.getElementById(`dt-${n.id}`)?.insertAdjacentHTML('beforeend', '<p class="dt-wait">Not on this screen right now.</p>');
    if (go) setTimeout(() => { if (showing !== run) return; showing = null; unlight(); document.getElementById(`dt-${n.id}`)?.focus(); }, 3500);
  }
  function toggle(on = panel.hidden) {
    panel.hidden = !on; button.setAttribute('aria-expanded', String(on)); if (!on) unlight();
    if (on) { paint(); panel.querySelector('[data-close]')?.focus(); }
  }
  button.onclick = () => toggle();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { toggle(false); button.focus(); } });
  addEventListener('resize', unlight);
  if (new URLSearchParams(location.search).has('dtree')) toggle(true);
  window.__dtree = { nodes: nodes.length, open, toggle };
}
start();
