// DTree: thro's decisions, read from its PxC world (Sam, 22 Oct 2026).
// The site is one run of 'thro.site' under a fill (thro-world.mjs). Its receipt's trace is the tree: each node is a
// decision (a contract call), the implementation the run chose, and why (decided by the fill, or the only one).
// Switching an alternative changes the fill for this browser and re-runs the site. Sam's rule is a check contract:
// its proofs, and its verdict on the card on screen, come from the world too.
// Decisions made before the world existed are listed from dtree.json until each becomes a contract.
// Rung 4: after every change, what the change did in the world: which features of the card changed (its definition, never a
// hash), which contracts recomputed and which were reused, and whether the pixels were drawn or reused. A toast under the
// preview and a short list here. Edges are labelled by kind; what is on screen carries the four guarantees (the four causes).
import { OPEN, SITE_FILL, propagation, guarantees, recipeDefinition, definitionChanges } from './thro-world.mjs';
import { viewer, setPurpose, resetOrder } from './viewer.mjs';
import { everyWay, everyLineupWay } from './ways.mjs';
import { nativeStudies, lineupStudies } from './native-cards.mjs';
import { cardLayout } from './native-cards.mjs';
import { traceToSvg } from './pxc/view.mjs';

const css = `
.dtree-button{position:fixed;left:16px;bottom:16px;z-index:60;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid #3d5141;background:#101812;color:#e9f1e4;font:700 14px/1 system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 6px 20px #0008;cursor:pointer}
.dtree-button b{color:#ffd166}
/* On phones the button sits in the header and scrolls away with it: pinned over the preview it covered the card (Sam's phone, 23 Oct). */
@media (max-width:760px){.dtree-button{position:absolute;top:14px;bottom:auto;left:auto;right:16px;min-height:36px;padding:0 12px;font-size:13px}}
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
.dtree .dt-edge{display:block;margin:8px 0 -2px 4px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#7f9384}
.dtree .dt-legend{margin:2px 4px 8px;color:#7f9384;font-size:11px}.dtree .dt-legend b{color:#9fb0a3}
.dtree .dt-changes{display:grid;gap:6px}
.dtree .dt-change{padding:8px 10px;border-radius:9px;background:#151f18;border:1px solid #223027;font-size:12px}
.dtree .dt-change.latest{border-color:#c8f49d}
.dtree .dt-change p{margin:0}.dtree .dt-change .dt-what{font-weight:700;color:#e9f1e4;font-size:13px}
.dtree .dt-change .dt-n{color:#7f9384;font-weight:700;margin-right:6px}
.dtree .dt-re{color:#ffd166}.dtree .dt-ru{color:#c8f49d}
.dtree .dt-g{display:grid;grid-template-columns:auto 1fr;gap:4px 8px;margin:8px 0 0;font-size:12px;align-items:start}
.dtree .dt-g .dt-chip{margin:1px 0 0}.dtree .dt-chip.cause{background:#2d3a31;color:#e9f1e4}
.dtree .dt-g p{margin:0}.dtree .dt-proof{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:3px}.dtree .dt-proof li{margin:0}.dtree .dt-proof em{font-style:normal;font-weight:800;color:#c8f49d;margin-right:4px}.dtree .dt-scaffold{color:#9fb0a3}.dtree .dt-scaffold em{color:#ffd166!important}.dtree .dt-qed{margin:2px 0 0;font-weight:800;letter-spacing:.12em;color:#c8f49d;font-size:11px}.dtree .dt-g b.ok{color:#c8f49d}.dtree .dt-g b.no{color:#ff9e80}.dtree .dt-g b.unknown{color:#ffd166}
.dtree .dt-def{margin:6px 0 0;font-size:12px;color:#cfe3c9}.dtree .dt-def span{display:inline-block;margin:2px 6px 0 0}.dtree .dt-def em{font-style:normal;color:#7f9384}
.dtree-toast{position:absolute;z-index:58;max-width:min(560px,calc(100vw - 32px));padding:9px 12px;border-radius:10px;background:#101812;color:#e9f1e4;border:1px solid #3d5141;box-shadow:0 8px 24px #0007;font:12px/1.4 system-ui,sans-serif;pointer-events:none;transition:opacity .3s}
.dtree-toast b{display:block;font-size:13px;color:#fff}.dtree-toast .dt-re{color:#ffd166}.dtree-toast .dt-ru{color:#c8f49d}
.dtree-toast[hidden]{display:none}
.dtree .dt-pics,.dtree-toast .dt-pics{display:flex;flex-wrap:wrap;gap:6px 14px;margin:2px 0 4px}
.dt-pic{display:inline-flex;align-items:center;gap:6px}.dt-pic>i{font-style:normal;color:#9fb0a3;font-weight:800}
.pic-sw{display:inline-block;width:26px;height:26px;border-radius:50%;border:2px solid #ffffffcc;box-shadow:0 1px 4px #0008}
.pic-disc{width:34px;height:34px;border-radius:50%;object-fit:cover;box-shadow:0 1px 4px #0008}
.pic-study{display:inline-block;width:64px;height:36px;border-radius:5px;overflow:hidden;background:#0b100c;border:1px solid #ffffff33}.pic-study svg{width:100%;height:100%;display:block}
.dt-cap{font-size:11px;color:#9fb0a3}.dtree-toast .dt-cap{color:#cfe3c9}
.dtree .dt-purpose{border-bottom:1px dashed #c8f49d;outline:none;cursor:text}.dtree .dt-purpose:focus{background:#c8f49d1f;border-bottom-style:solid}
.dtree .dt-undo{min-height:24px!important;padding:0 6px!important;margin-left:6px;font-size:12px!important;vertical-align:1px}
.dtree .dt-ways-sum{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:4px 4px 8px;font-size:12px;color:#cfe3c9}
.dtree .dt-big{font-size:22px;font-weight:800;color:#fff}
.dtree .dt-ways{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:8px;margin:0 4px}
.dtree .dt-way{margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;display:grid;gap:3px;justify-items:center;min-height:0}
.dtree .dt-way .pic-study{width:70px;height:40px}
.dtree .dt-way.off{opacity:.35}
.dtree .dt-way.comfy .pic-study{outline:3px solid #ffd166;outline-offset:1px}
.dtree .dt-way.quiet .pic-study{outline:2px dashed #e9f1e4;outline-offset:1px}
.dtree .dt-way.comfy.quiet .pic-study{outline:3px solid #ffd166}
.dtree .dt-way small{font-size:11px;color:#9fb0a3;font-variant-numeric:tabular-nums}
.dtree .dt-taps{list-style:none;margin:6px 0;padding:0;display:grid;gap:6px}.dtree .dt-taps li{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:center;font-size:12px}
.dtree .dt-tlabel{color:#eef3ea;font-weight:700}.dtree .dt-tms{justify-self:end;color:#cfe3c9;font-variant-numeric:tabular-nums}
.dtree .dt-tbar{grid-column:1/-1;position:relative;height:14px;border-radius:3px;background:#ffffff14;overflow:hidden}.dtree .dt-tbar u{position:absolute;left:0;top:0;bottom:0;background:#ffffff2e}.dtree .dt-tbar i{position:absolute;top:0;bottom:0;min-width:2px}.dtree .dt-tbar b{position:absolute;top:-2px;bottom:-2px;border-left:2px solid #fff}
.dtree .dt-key{display:inline-flex;align-items:center;gap:4px}.dtree .dt-key i{display:inline-block;width:14px;height:9px;border-radius:2px}
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
    const review = node.contract === 'thro.card.revision' ? '<p class="dt-meta"><a href="./revision-review.html">Every card, revision 1 beside revision 2 →</a></p>' : '';
    return `<div class="dt-node" id="dt-${esc(node.contract)}"><p class="dt-q"><span class="dt-chip ${status}">${label}</span>${esc(contract?.description)} <code>${esc(node.contract)}#${esc(node.slot)}</code></p><p class="dt-c">${esc(chosen?.description)}</p><p class="dt-why">Chosen: ${why}.</p>${contract?.notes ? `<p class="dt-why">${esc(contract.notes)}</p>` : ''}${open ? `<p class="dt-wait">Waiting on ${esc(open)}</p>` : ''}${impls.length > 1 ? '' : meta(chosen?.origin)}${alts}${review}${show}</div>`;
  }
  // The screen: one PxC run from the site's decisions down to the card on screen and the rule on its measured layout (thro-app runScreen).
  function screenNode() {
    const sc = window.__thro?.screen;
    if (!sc) return `<div class="dt-node"><p class="dt-q"><span class="dt-chip active">Run</span>What is on screen <code>thro.screen</code></p><p class="dt-why">Runs for a Single card or a Bag lineup; Battle isn't in the world yet.</p></div>`;
    if (sc.error) return `<div class="dt-node"><p class="dt-q"><span class="dt-chip open">Run</span>What is on screen <code>thro.screen</code></p><p class="dt-wait">${esc(sc.error)}</p></div>`;
    const o = sc.outputs, r = sc.receipt, st = sc.stats;
    let picture = '';
    const lineup = Boolean(o.recipe.cards);
    const title = lineup ? `thro.screen.lineup, run ${r.runId}: the site's decisions, one card recipe per disc gathered into the lineup's recipe, the rule on every card drawn`
      : `thro.screen, run ${r.runId}: the site's decisions, this card's recipe, the rule on what was drawn`;
    try { picture = traceToSvg(r.trace, world.part, { title, receipt: r, valueChars: 52, expand: n => world.node(n.cachedFrom.run, n.cachedFrom.call) }); } catch (e) { picture = `<p class="dt-wait">${esc(e.message)}</p>`; }
    const def = recipeDefinition(o.recipe, r.inputValues?.photos).filter(f => f.key !== 'kind');
    const shownDef = lineup ? def.filter(f => !/\.(flights|side|highlight|photo|plate)$/.test(f.key)) : def;
    const gs = guarantees(world, sc, viewer()), mark = ok => ok === true ? '<b class="ok">✓</b>' : ok === false ? '<b class="no">✗</b>' : '<b class="unknown">?</b>';
    // The final cause is a demonstration, not a verdict: what it is for, the premise, what it does, thus.
    const kind = lineup ? 'lineup' : 'card';
    const proof = d => `<ol class="dt-proof"><li><em>This is for</em> <span class="dt-purpose" contenteditable="plaintext-only" spellcheck="false" data-purpose="${kind}" aria-label="What this ${kind} is for (your words)">${esc(d.for)}</span>${d.purposeOwn ? `<button type="button" class="dt-undo" data-purpose-reset="${kind}" aria-label="Back to the site's words">↺</button>` : ''}</li><li><em>Because</em> ${esc(d.because)}${d.own ? '<button type="button" class="dt-undo" data-order-reset aria-label="Back to the scaffold order">↺</button>' : ''}</li>${d.scaffold ? `<li class="dt-scaffold"><em>Scaffold</em> ${esc(d.scaffold)}</li>` : ''}<li><em>It does</em> ${esc(d.does)}</li><li><em>Thus</em> ${esc(d.thus)}</li></ol>`;
    const guaranteeRows = `<div class="dt-g">${gs.map(g => `<span class="dt-chip cause">${esc(g.cause)}</span><div><p>${mark(g.ok)} <b>${esc(g.question)}</b> ${g.demonstration ? '' : esc(g.what)}</p>${g.demonstration ? `${proof(g.demonstration)}${g.ok ? '<p class="dt-qed">QED</p>' : ''}` : ''}</div>`).join('')}</div>`;
    return `<div class="dt-node" id="dt-screen"><p class="dt-q"><span class="dt-chip active">Run ${esc(r.runId)}</span>What is on screen, and does it keep the rule? <code>${o.recipe.cards ? 'thro.screen.lineup' : 'thro.screen'}</code></p>
      <p class="dt-c">${o.recipe.cards ? `Lineup ${esc(recipeDefinition(o.recipe).find(f => f.key === 'layout')?.value)} · ${o.recipe.cards.map(c => esc(c.disc.name)).join(', ')}${o.recipe.featured !== null ? ` · featured: ${esc(o.recipe.cards[o.recipe.featured]?.disc.name)}` : ''}` : `${esc(recipeDefinition(o.recipe).find(f => f.key === 'layout')?.value)} · ${esc(o.recipe.disc.manufacturer)} ${esc(o.recipe.disc.name)}${o.recipe.revision ? ` · revision ${o.recipe.revision}` : ''}`}</p>
      <p class="dt-why">${lineup ? `What this lineup is, built from ${o.recipe.cards.length} card recipes, one per disc` : 'What this card is'}: the same definition always draws the same pixels.</p>
      <p class="dt-def">${shownDef.map(f => `<span><em>${esc(f.label)}</em> ${esc(f.value)}${f.follows ? ' <em>(from the layout)</em>' : ''}</span>`).join('')}</p>
      <span class="dt-edge">Its four guarantees · the four causes</span>${guaranteeRows}
      <p class="dt-verdict">Rule on what was drawn: <b class="${o.accepted ? 'ok' : 'no'}">${o.accepted ? 'passes' : 'fails'}</b>. ${esc(o.reason)}</p>
      <p class="dt-ev">Card pixels this session: <span>${sc.pixels.drawn} drawn</span><span>${sc.pixels.reused} reused by recipe hash</span> · kernel: <span>${st.cacheHits} reused</span><span>${st.cacheMisses} computed</span><span>${st.parts} Parts</span></p>
      <details><summary>The kernel's picture of this run</summary><p class="dt-ev">Index only, not identity: recipe Part <code>${esc(sc.recipeHash)}</code></p><div class="dt-trace">${picture}</div></details></div>`;
  }
  function ruleNode() {
    const rule = world.contracts().find(c => c.id === 'thro.rule'), v = verdict();
    return `<div class="dt-node" id="dt-thro.rule"><p class="dt-q"><span class="dt-chip active">Check</span>${esc(rule.description)} <code>thro.rule</code></p><p class="dt-c">${esc(rule.notes)}</p>
      <p class="dt-verdict">Proven by its examples: ${proofs.map(p => `${esc(p.example)} <b class="${p.ok ? 'ok' : 'no'}">${p.ok ? '✓' : '✗'}</b>`).join(' · ')}</p>
      <p class="dt-verdict">The card on screen: ${v ? `<b class="${v.accepted ? 'ok' : 'no'}">${v.accepted ? 'passes' : 'fails'}</b>. ${esc(v.reason)}` : 'not a single card right now.'}</p>${v && !v.accepted ? blame(v) : ''}
      <button type="button" class="dt-show" data-show="thro.rule">Show on the page</button></div>`;
  }
  // ---- Every way this disc could be a card (rung 7; on the kernel's world.sum and world.evaluate since rung 8).
  function waysNode() {
    const sc = window.__thro?.screen; if (!sc || sc.error) return '';
    seeThumbs();
    if (sc.outputs.recipe.cards) return lineupWaysNode(sc);
    const layouts = [...thumbs].filter(([study]) => study.startsWith('discstudio:')).map(([study, svg]) => ({ study, name: String(nativeStudies.find(n => n.id === study)?.label ?? study).replace(/^[A-Z0-9-]+ · /, ''), layout: cardLayout(svg.outerHTML) }));
    const intended = viewer().order ?? undefined, own = Boolean(viewer().order);
    const { ways, answers } = everyWay({ world, layouts, disc: { name: sc.outputs.recipe.disc.name, flights: sc.outputs.recipe.flights }, intended });
    if (!answers) return '';
    const current = `discstudio:${sc.outputs.recipe.preset}`;
    const tile = w => `<button type="button" class="dt-way ${w.keeps ? '' : 'off'} ${w.study === answers.mostComfortable ? 'comfy' : ''} ${w.study === answers.quietest ? 'quiet' : ''}" data-way="${esc(w.study)}" title="${esc(w.name)}${w.study === current ? ' (on screen)' : ''}"><span class="pic-study" data-pic-study="${esc(w.study)}"></span><small>${w.keeps ? `×${w.margin.toFixed(2)}` : '–'}${w.study === current ? ' ●' : ''}</small></button>`;
    return `<h3>Every way this disc could be a card</h3>
      <p class="dt-about">Σ over the layouts of (layout × keeps ${own ? 'your' : 'the scaffold'} order), one <code>world.sum</code> over ${answers.polynomial} ways, its polynomial evaluated in five semirings by <code>world.evaluate</code> (the kernel's, from Capability Lab). ×n: each part is at least n times the next. ● on screen.</p>
      <div class="dt-ways-sum"><span><span class="dt-big">${answers.count}/${answers.of}</span> keep ${own ? 'your' : 'the scaffold'} order</span>
        ${answers.mostComfortable ? `<span class="dt-key"><i style="outline:3px solid #ffd166"></i> most room ×${(1 / (1 - answers.comfort)).toFixed(2)}</span>` : ''}
        ${answers.quietest ? `<span class="dt-key"><i style="outline:2px dashed #e9f1e4"></i> quietest extras ${answers.quiet} px</span>` : ''}
        ${answers.possible ? '' : '<span>No layout here reads in that order; it would take another layout.</span>'}</div>
      <div class="dt-ways">${ways.map(tile).join('')}</div>
      <details><summary>What the answer rests on (lineage)</summary><p class="dt-ev">${answers.restsOn.map(l => `<span>${esc(nativeStudies.find(n => n.id === l)?.label ?? l)}</span>`).join('')}</p></details>`;
  }
  // Bag: Σ over lineup layouts of Π over the cards (every card keeps the order), on world.sum and world.evaluate.
  function lineupWaysNode(sc) {
    const cards = sc.outputs.recipe.cards.map(c => ({ name: c.disc.name, flights: c.flights }));
    const layouts = [...thumbs].filter(([study]) => study.startsWith('discstudio-lineup:')).map(([study, svg]) => ({ study, name: String(lineupStudies.find(n => n.id === study)?.name ?? study).replace(/^[A-Z0-9-]+ /, ''), layout: cardLayout(svg.outerHTML) }));
    const own = Boolean(viewer().order);
    let result; try { result = everyLineupWay({ world, layouts, cards, intended: viewer().order ?? undefined }); } catch (e) { return `<h3>Every way this lineup could be</h3><p class="dt-wait">${esc(e.message)}</p>`; }
    const { ways, answers } = result; if (!answers) return '';
    const current = `discstudio-lineup:${sc.outputs.recipe.preset}`;
    const tile = w => `<button type="button" class="dt-way ${w.keeps ? '' : 'off'} ${w.study === answers.mostComfortable ? 'comfy' : ''} ${w.study === answers.quietest ? 'quiet' : ''}" data-way="${esc(w.study)}" title="${esc(w.name)}${w.study === current ? ' (on screen)' : ''}"><span class="pic-study" data-pic-study="${esc(w.study)}"></span><small>${w.keeping}/${w.fits.length}${w.keeps ? ` ×${w.margin.toFixed(2)}` : ''}${w.study === current ? ' ●' : ''}</small></button>`;
    return `<h3>Every way this lineup could be</h3>
      <p class="dt-about">Σ over the lineup layouts of Π over the ${answers.cards} cards (each keeps ${own ? 'your' : 'the scaffold'} order): <code>world.sum</code> gives the ways, each way's cards multiply in its monomial, <code>world.evaluate</code> answers. n/${answers.cards}: cards that keep it; ×n: the tightest card's room. ● on screen.</p>
      <div class="dt-ways-sum"><span><span class="dt-big">${answers.count}/${answers.of}</span> keep ${own ? 'your' : 'the scaffold'} order on every card</span>
        ${answers.mostComfortable ? '<span class="dt-key"><i style="outline:3px solid #ffd166"></i> most room</span>' : ''}
        ${answers.quietest ? `<span class="dt-key"><i style="outline:2px dashed #e9f1e4"></i> quietest extras ${Math.round(answers.quiet)} px in all</span>` : ''}
        ${answers.possible ? '' : '<span>No lineup layout here keeps that order on every card.</span>'}</div>
      <div class="dt-ways">${ways.map(tile).join('')}</div>
      <details><summary>What the answer rests on (lineage)</summary><p class="dt-ev">${answers.restsOn.map(l => `<span>${esc(l)}</span>`).join('')}</p></details>`;
  }
  const pastNode = n => `<div class="dt-node"><p class="dt-q"><span class="dt-chip ${esc(n.status)}">${n.status === 'open' ? 'Open' : n.status === 'subsumed' ? 'Subsumed' : 'In the site'}</span>${esc(n.question)}</p><p class="dt-c">${esc(n.choice)}</p>${n.waitingOn ? `<p class="dt-wait">Waiting on ${esc(n.waitingOn)}</p>` : ''}${meta(n)}</div>`;
  const pastBranch = parent => { const kids = past.nodes.filter(n => n.parent === parent); return kids.length ? `<ol>${kids.map(n => `<li>${parent ? '<span class="dt-edge">↑ built on</span>' : ''}${pastNode(n)}${pastBranch(n.id)}</li>`).join('')}</ol>` : ''; };


  // ---- What each change did (rung 4). Names are short forms of the contracts; slots card0–4 read as cards 1–5.
  const SHORT = { 'thro.site': "the site's decisions", 'thro.single.layouts': 'Single layouts', 'thro.bag.layouts': 'Bag layouts', 'thro.battle.engine': 'Battle engine',
    'thro.card.revision': 'card revision', 'thro.card.recipe': 'card recipe', 'thro.rule': 'the rule', 'thro.lineup.recipe': 'lineup recipe', 'thro.lineup.rule': 'the rule on every card',
    'thro.photo.material': 'the photo check', 'thro.screen': 'everything', 'thro.screen.lineup': 'everything' };
  const names = calls => {
    const groups = new Map();
    for (const c of calls) {
      const card = /^card(\d)$/.exec(c.slot ?? ''), base = SHORT[c.contract] ?? c.contract;
      if (!groups.has(base)) groups.set(base, []);
      if (card) groups.get(base).push(Number(card[1]) + 1);
    }
    return [...groups].map(([base, cards]) => cards.length ? `${base === 'the rule' ? 'the rule on card' : base}${cards.length > 1 ? 's' : ''} ${cards.join(', ')}` : base);
  };
  const changes = []; let lastHash = null;
  function record() {
    const sc = window.__thro?.screen; if (!sc || sc.error) return null;
    seeThumbs();
    const def = recipeDefinition(sc.outputs.recipe, sc.receipt.inputValues?.photos), prev = changes[0];
    const calls = propagation(sc.receipt).filter(c => !/^thro\.screen/.test(c.contract) || c.whole);
    const entry = { n: (prev?.n ?? 0) + 1, run: sc.receipt.runId, def, hash: sc.recipeHash, first: !prev,
      parts: prev ? definitionChanges(prev.def, def) : [], recomputed: names(calls.filter(c => !c.cached)), reused: names(calls.filter(c => c.cached)),
      whole: calls.find(c => c.whole)?.cachedFrom?.run ?? null, pixel: sc.pixel, accepted: sc.outputs.accepted, times: 1 };
    entry.diff = entry.parts.map(c => c.line);
    entry.sameAs = prev && entry.hash !== prev.hash ? changes.find(c => c.hash === entry.hash)?.n ?? null : null;
    if (prev && !entry.diff.length && entry.hash === prev.hash) { prev.times++; prev.run = entry.run; return { entry: prev, repeat: true }; }
    changes.unshift(entry); if (changes.length > 6) changes.pop();
    return { entry, repeat: false };
  }
  // Pictures over words (Sam, 23:31: someone in Sweden with no English): a change is shown as what it is of, a colour, a layout,
  // a disc, from → to; the words are a caption. Layout thumbnails are the page's own (cloned in after render).
  const discImg = id => document.querySelector(`[data-disc="ds.px.disc.${CSS.escape(String(id))}"] img`)?.getAttribute('src');
  const pic = p => !p ? '' : p.color ? `<span class="pic-sw" style="background:${esc(p.color)}"></span>` : p.study ? `<span class="pic-study" data-pic-study="${esc(p.study)}"></span>` : p.disc && discImg(p.disc) ? `<img class="pic-disc" alt="" src="${esc(discImg(p.disc))}">` : '';
  const pics = e => { const row = (e.parts ?? []).filter(c => pic(c.fromPicture) || pic(c.toPicture)).filter((c, i, all) => !(c.feature === 'photo' && all.some(d => d.feature === 'disc'))).map(c => `<span class="dt-pic">${pic(c.fromPicture)}<i>→</i>${pic(c.toPicture)}</span>`); return row.length ? `<div class="dt-pics">${row.join('')}</div>` : ''; };
  // The last thumbnail seen for each layout: a change made in Single still shows its layouts after you move to Bag.
  const thumbs = new Map();
  // Kept by reference (a repaint replaces the node, so the old one stays as it was); only a picture actually shown is cloned.
  const seeThumbs = () => document.querySelectorAll('button[data-study] svg').forEach(svg => thumbs.set(svg.closest('[data-study]').dataset.study, svg));
  const fillPics = el => { seeThumbs(); el.querySelectorAll('[data-pic-study]').forEach(slot => { const svg = thumbs.get(slot.dataset.picStudy); if (svg && !slot.firstChild) slot.append(svg.cloneNode(true)); }); };
  const what = e => e.first ? 'First draw on this page' : e.diff.length ? e.diff.join(' · ') : 'Nothing in the card changed';
  const pixelWords = e => e.pixel === 'reused' ? 'pixels reused' : e.pixel === 'drawn' ? 'pixels drawn' : 'pixels not recorded';
  const did = e => `${e.recomputed.length ? `<span class="dt-re">Recomputed: ${esc(e.recomputed.join(', '))}</span> · ` : ''}<span class="dt-ru">Reused: ${e.reused.length ? esc(e.reused.join(', ')) : 'nothing'}${e.whole ? ` (asked before, run ${esc(e.whole)})` : ''}</span> · ${pixelWords(e)}${e.sameAs ? ` · the same card as change ${e.sameAs}` : ''}`;
  const changeItem = (e, i) => `<li class="dt-change ${i === 0 ? 'latest' : ''}">${pics(e)}<p class="dt-what"><span class="dt-n">${e.n}</span>${pics(e) ? `<span class="dt-cap">${esc(what(e))}</span>` : esc(what(e))}${e.times > 1 ? ` <span class="dt-n">×${e.times}</span>` : ''}</p><p>${did(e)}</p><p>Rule: <b class="${e.accepted ? 'ok' : 'no'}" style="color:${e.accepted ? '#c8f49d' : '#ff9e80'}">${e.accepted ? 'passes' : 'fails'}</b> · run ${esc(e.run)}</p></li>`;
  const toast = Object.assign(document.createElement('div'), { className: 'dtree-toast', hidden: true }); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  document.body.append(toast); let toastTimer = 0;
  function showToast(e) {
    const preview = document.getElementById('graphic-preview'); if (!preview) return;
    toast.innerHTML = pics(e) ? `${pics(e)}<p class="dt-cap">${esc(what(e))}</p>${did(e)}` : `<b>${esc(what(e))}</b>${did(e)}`; fillPics(toast); toast.hidden = false; toast.style.opacity = '1';
    // Under the preview when it is in view; otherwise pinned above the bottom of the screen, where the person is working (phones).
    const r = preview.getBoundingClientRect(), inView = r.bottom > 40 && r.bottom + 80 < innerHeight;
    Object.assign(toast.style, inView ? { position: 'absolute', left: `${Math.max(16, r.left + scrollX)}px`, top: `${r.bottom + scrollY + 8}px`, bottom: '' }
      : { position: 'fixed', left: '16px', top: '', bottom: `${innerWidth <= 760 ? 104 : 76}px` });
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => { toast.hidden = true; }, 320); }, 5200);
  }
  function onScreen() {
    const r = record(); if (!r) return;
    if (!r.repeat && !r.entry.first) setTimeout(() => showToast(r.entry), 120); // after the preview settles
    if (!panel.hidden && !lights.length) paint();
  }

  // How long each tap took, finger to pixels (timing.mjs): one bar per tap on the same scale, a block per stage, the frame
  // the eye calls instant (100 ms) marked. Measured on this device, in this browser, each time.
  const STAGE_COLOURS = { 'draw the card': '#ff9e80', 'run the screen through PxC': '#c77dff', 'paint the page': '#4cc9f0', 'put the handles on the card': '#c8f49d', 'find the card pixels': '#ffd166', 'save the change': '#7d8a80' };
  function timingNode() {
    const taps = (window.__thro?.timing ?? []).slice(-5).reverse();
    if (!taps.length) return '<h3>Your last taps, finger to pixels</h3><p class="dt-about">Tap Side, Colour or Plate on the card, or drag it: each tap is timed here, stage by stage, on this device.</p>';
    const scale = Math.max(400, ...taps.map(t => t.end)), pct = ms => `${(100 * ms / scale).toFixed(2)}%`;
    const bar = t => `<div class="dt-tbar" role="img" aria-label="${esc(t.label)}: ${Math.round(t.end)} milliseconds"><u style="width:${pct(t.end)}"></u>${t.stages.filter(st => st.depth === 0 && st.start < t.end && STAGE_COLOURS[st.name]).map(st => `<i title="${esc(st.name)} ${Math.round(st.ms)} ms" style="left:${pct(st.start)};width:${pct(Math.min(st.ms, t.end - st.start))};background:${STAGE_COLOURS[st.name]}"></i>`).join('')}<b style="left:${pct(100)}"></b></div>`;
    const used = [...new Set(taps.flatMap(t => t.stages.filter(st => st.depth === 0 && st.start < t.end && STAGE_COLOURS[st.name]).map(st => st.name)))];
    return `<h3>Your last taps, finger to pixels</h3><ol class="dt-taps">${taps.map(t => `<li><span class="dt-tlabel">${esc(t.label)}</span><span class="dt-tms">${Math.round(t.end)} ms</span>${bar(t)}</li>`).join('')}</ol>
      <p class="dt-ways-sum">${used.map(n => `<span class="dt-key"><i style="background:${STAGE_COLOURS[n]}"></i>${esc(n)}</span>`).join('')}<span class="dt-key"><i style="background:none;border-left:2px solid #fff;width:0"></i>100 ms</span></p>`;
  }

  function paint() {
    const site = decided.receipt.trace;
    panel.innerHTML = `<header><h2>DTree</h2><button type="button" data-close aria-label="Close the decision tree">Close</button></header><div class="dt-body">
      <h3>What your last changes did</h3>${changes.length ? `<ol class="dt-changes">${changes.map(changeItem).join('')}</ol>` : '<p class="dt-about">Change something on a Single card or a Bag lineup: each change shows here, with what it recomputed and what it reused.</p>'}
      ${timingNode()}
      ${waysNode()}
      <h3>The site, decided in PxC</h3><p class="dt-about">One run of <code>${esc(site.contract)}</code> (run ${esc(decided.receipt.runId)}, ${decided.receipt.calls} calls). Each decision is a contract; its alternatives are implementations; the site's choices are its fill.</p>
      <p class="dt-about"><a href="./fill-matrix.html" style="color:#c8f49d">Every fill, checked in a browser →</a> what each switch changes, and which checks it breaks.</p>
      <p class="dt-legend">Edges, by kind: <b>made from</b> (material) · <b>for the sake of</b> (final) · <b>actualized by the fill</b> (potential → actual) · <b>built on</b> (an earlier decision).</p>
      <ol><li>${screenNode()}</li><li><span class="dt-edge">↑ judged for the sake of</span>${ruleNode()}<ol>${site.calls.map(node => `<li><span class="dt-edge">↑ for the sake of the rule · actualized by the fill</span>${decisionNode(node)}</li>`).join('')}</ol></li></ol>
      ${mine.length ? `<button type="button" class="dt-reset" data-reset>Back to the site's decisions (${mine.length} switched here)</button>` : ''}
      <h3>Not in the world yet</h3><p class="dt-about">${esc(past.about ?? '')}</p>${pastBranch(null)}</div>`;
    panel.querySelector('[data-close]').onclick = () => toggle(false);
    panel.querySelectorAll('[data-switch]').forEach(b => b.onclick = () => setFill({ ...fill, [b.dataset.switch]: b.dataset.impl }));
    panel.querySelector('[data-reset]')?.addEventListener('click', () => setFill({ ...SITE_FILL }));
    panel.querySelectorAll('[data-show]').forEach(b => b.onclick = () => light(b.dataset.show));
    panel.querySelector('[data-fixcard]')?.addEventListener('click', () => { [...document.querySelectorAll('.ce-strip button')].find(b => /Use the fixed card/.test(b.textContent))?.click(); toggle(false); });
    fillPics(panel);
    // A way is also a handle: tapping it puts that layout on screen (the same button the layout picker uses).
    panel.querySelectorAll('[data-way]').forEach(b => b.onclick = () => document.querySelector(`button[data-study="${CSS.escape(b.dataset.way)}"]`)?.click());
    // The person's own words for what it is for: edited where they are read; empty goes back to the site's.
    panel.querySelectorAll('[data-purpose]').forEach(el => {
      const before = el.textContent;
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = before; el.blur(); } });
      el.addEventListener('blur', () => { if (el.textContent.trim() !== before.trim()) setPurpose(el.dataset.purpose, el.textContent); });
    });
    panel.querySelectorAll('[data-purpose-reset]').forEach(b => b.onclick = () => setPurpose(b.dataset.purposeReset, ''));
    panel.querySelector('[data-order-reset]')?.addEventListener('click', () => resetOrder());
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
  addEventListener('thro:screen', onScreen);
  addEventListener('thro:timing', () => { if (!panel.hidden && !lights.length) paint(); });
  addEventListener('thro:viewer', () => { if (!panel.hidden && !lights.length && !panel.contains(document.activeElement?.closest?.('[data-purpose]'))) paint(); });
  if (window.__thro.screen) onScreen(); // a run that happened before the DTree started
  window.__dtree = { open: openCount, toggle, changes: () => changes.map(c => ({ n: c.n, what: what(c), recomputed: c.recomputed, reused: c.reused, whole: c.whole, pixel: c.pixel, sameAs: c.sameAs, times: c.times })), toast: () => (toast.hidden ? null : toast.textContent), blame: () => { const v = verdict(); return v && !v.accepted ? blame(v) : null; }, decisions: decided.receipt.trace.calls.map(n => ({ contract: n.contract, impl: n.impl, rung: n.chosenBy?.rung })), verdict };
}
start();
