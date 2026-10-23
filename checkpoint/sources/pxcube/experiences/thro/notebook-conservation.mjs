// thro engineering notebook, page 2: conservation laws checked over every gesture of the real site (timing.mjs keeps the books).
// thro runs in the frame on a throwaway workspace (?scratch: storage in memory, its own key and lock). The page reads the books the
// site keeps (window.__thro.books, window.__thro.timing) and draws them; the gauge drives the card with the same pointer events a
// finger makes. Nothing is typed in: every number is booked by the site as it runs.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const frame = $('#thro');
const COLOURS = { 'draw the card': '#ff9e80', 'run the screen through PxC': '#c77dff', 'paint the page': '#4cc9f0', 'put the handles on the card': '#c8f49d', 'find the card pixels': '#ffd166', 'save the change': '#7d8a80' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const win = () => frame.contentWindow;
const thro = () => win()?.__thro;

function paint() {
  const t = thro(); if (!t?.books) return;
  const b = t.books, open = b.begun - b.painted - b.superseded - b.unchanged - b.failed;
  const settled = open === 0 && b.staleAfter3s === 0;
  $('#equation').innerHTML = `begun ${b.begun} = painted ${b.painted} + superseded ${b.superseded} + unchanged ${b.unchanged} + failed ${b.failed} + open ${open} <span class="${settled ? 'pass' : open > 0 ? 'muted' : 'fail'}">${settled ? '✓ balanced, nothing open' : open > 0 ? '(a gesture is in flight)' : '✗'}</span>`;
  $('#books tbody').innerHTML = `<tr>${[b.begun, b.painted, b.superseded, b.unchanged, b.failed, open, b.staleAfter3s].map((v, i) => `<td class="num ${i === 6 && v ? 'fail' : ''}">${v}</td>`).join('')}</tr>`;
  const gs = [...(t.timing ?? [])].reverse();
  const withLaw = gs.filter(g => g.paintLaw);
  $('#paints').innerHTML = withLaw.length
    ? `${withLaw.filter(g => g.paintLaw.ofFinal === 1).length} of ${withLaw.length} painted gestures put their final pixels on screen exactly once; ${withLaw.reduce((n, g) => n + g.paintLaw.duplicates, 0)} duplicate repaints. <span class="${withLaw.every(g => g.paintLaw.ofFinal === 1 && !g.paintLaw.duplicates) ? 'pass' : 'fail'}">${withLaw.every(g => g.paintLaw.ofFinal === 1 && !g.paintLaw.duplicates) ? '✓ conserved' : '✗ see the gestures marked below'}</span>`
    : 'No painted gesture has finished its save yet.';
  const scale = Math.max(150, ...gs.map(g => g.end ?? 0));
  $('#ledgers').innerHTML = gs.map(g => {
    const L = g.ledger; if (!L) return '';
    let at = 0;
    const blocks = L.rows.map(r => { const left = at; at += r.ms; return `<i class="${r.remainder ? 'rem' : ''}" title="${esc(r.name)} ${r.ms.toFixed(1)} ms" style="left:${(100 * left / scale).toFixed(2)}%;width:${(100 * r.ms / scale).toFixed(2)}%;${r.remainder ? '' : `background:${COLOURS[r.name] ?? '#9fb0a3'}`}"></i>`; }).join('');
    const law = g.paintLaw ? ` · paints ${g.paintLaw.paints}, of its final pixels ${g.paintLaw.ofFinal}${g.paintLaw.duplicates ? `, <span class="fail">${g.paintLaw.duplicates} duplicate</span>` : ''} <span class="${g.paintLaw.ofFinal === 1 && !g.paintLaw.duplicates ? 'pass' : 'fail'}">${g.paintLaw.ofFinal === 1 && !g.paintLaw.duplicates ? '✓' : '✗'}</span>` : '';
    const rows = L.rows.filter(r => !r.remainder || r.ms >= 0.5).map(r => `<tr><td class="${r.remainder ? 'rem' : ''}">${r.remainder ? 'remainder ' : ''}${esc(r.name)}</td><td class="num">${r.ms.toFixed(1)} ms</td></tr>`).join('');
    return `<div class="g"><div class="head"><b>${esc(g.label)}</b><span class="tag ${g.outcome}">${g.outcome}</span><span>${g.end.toFixed(1)} ms</span><span class="muted">stages + remainders − overlap ${L.overlap.toFixed(1)} = ${(L.total + L.balance).toFixed(1)} ms</span><span class="${Math.abs(L.balance) < 0.01 ? 'pass' : 'fail'}">${Math.abs(L.balance) < 0.01 ? '✓ closes' : `✗ off by ${L.balance.toFixed(2)}`}</span>${law}</div>
      <div class="bar">${blocks}</div><table>${rows}</table></div>`;
  }).join('') || '<p class="muted">No gesture yet.</p>';
}

// The gauge: the same pointer events a finger makes, on the card in the frame.
function pointer(el, type, x, y) {
  const P = win().PointerEvent;
  el.dispatchEvent(new P(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
}
const doc = () => frame.contentDocument;
const badge = text => [...doc().querySelectorAll('.card-editor .ce-badge')].find(b => b.textContent.trim() === text);
async function settle(before) {
  for (let i = 0; i < 100; i++) { const b = thro().books, open = b.begun - b.painted - b.superseded - b.unchanged - b.failed; if (b.begun > before && open === 0) break; await wait(50); }
  await wait(1200); // let the save finish, so law 3 is recorded
}
async function tap(text, quick = false) {
  const b = badge(text); if (!b) throw Error(`no ${text} on the card`);
  b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const before = thro().books.begun;
  pointer(b, 'pointerdown', x, y); pointer(b, 'pointerup', x, y); b.click();
  if (!quick) await settle(before);
}
async function drag(dx, dy, back = false) {
  const box = doc().querySelector('.card-editor .ce-card'); const r = box.getBoundingClientRect(), x = r.left + r.width * 0.3, y = r.top + r.height * 0.5;
  const before = thro().books.begun;
  pointer(box, 'pointerdown', x, y);
  for (let i = 1; i <= 8; i++) { pointer(doc().documentElement, 'pointermove', x + dx * i / 8, y + dy * i / 8); await wait(16); }
  if (back) for (let i = 7; i >= 0; i--) { pointer(doc().documentElement, 'pointermove', x + dx * i / 8, y + dy * i / 8); await wait(16); }
  pointer(doc().documentElement, 'pointerup', x + (back ? 0 : dx), y + (back ? 0 : dy));
  await settle(before);
}
async function keys() {
  const box = doc().querySelector('.card-editor .ce-card'); const before = thro().books.begun;
  box.focus(); box.dispatchEvent(new (win().KeyboardEvent)('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await settle(before);
}
async function gauge() {
  const button = $('#run'), status = $('#status'); button.disabled = true;
  try {
    const steps = [['Side', () => tap('⇄ Side')], ['Colour', () => tap('# Colour')], ['Plate', () => tap('Plate')],
      ['Side twice, fast (the first is superseded)', async () => { await tap('⇄ Side', true); await tap('⇄ Side'); }],
      ['Drag the card', () => drag(90, -30)], ['Drag and bring it back (nothing to redraw)', () => drag(40, 0, true)], ['Arrow key nudge', () => keys()],
      ['Plate back', () => tap('Plate')]];
    for (const [i, [name, step]] of steps.entries()) { status.textContent = `Gauge ${i + 1} of ${steps.length}: ${name}…`; await step(); paint(); }
    status.textContent = 'Gauge done. Use the card yourself: every gesture is booked here.';
  } catch (error) { status.textContent = `The gauge stopped: ${error.message}`; }
  button.disabled = false; window.__conservation = { done: true, books: { ...thro().books }, gestures: thro().timing.map(g => ({ label: g.label, outcome: g.outcome, end: g.end, ledger: g.ledger, paintLaw: g.paintLaw ?? null })) };
}

frame.addEventListener('load', async () => {
  for (let i = 0; i < 200 && !(thro()?.screen && doc().querySelector('.card-editor .ce-badge')); i++) await wait(100);
  if (!thro()?.books) { $('#status').textContent = 'thro opened without its books (an older build?).'; return; }
  for (const type of ['thro:books', 'thro:timing']) win().addEventListener(type, () => paint());
  $('#status').textContent = 'Ready. Run the gauge, or use the card yourself.';
  paint(); window.__conservation = { ready: true };
  if (new URLSearchParams(location.search).has('run')) gauge();
});
$('#run').addEventListener('click', gauge);
