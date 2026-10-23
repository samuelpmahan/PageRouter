// What the person on this page has set for themselves (Sam, 22 Oct, 23:27): their own reading order for a card and their own
// words for what it is for. Kept in this browser only; absent means the site's purpose and Sam's scaffold order.
// Every change announces 'thro:viewer' so the handles and the DTree re-derive from it. No agent is involved.
import { PARTS } from './thro-world.mjs';

const ORDER = 'thro-reading-order', PURPOSE = 'thro-purpose';
const read = key => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: kept for this page only */ } };
let memory = { order: read(ORDER), purpose: read(PURPOSE) };

const validOrder = order => Array.isArray(order) && order.length === PARTS.length && PARTS.every(p => order.includes(p));
export function viewer() {
  return { order: validOrder(memory.order) ? [...memory.order] : null, purpose: memory.purpose && typeof memory.purpose === 'object' ? { ...memory.purpose } : null };
}
const announce = () => dispatchEvent(new CustomEvent('thro:viewer'));
/** Swap two parts in the person's order (what dragging one handle onto another part does). */
export function swapParts(a, b) {
  if (a === b) return;
  // Through the world (thro.reading.order), as a script would: the handle is one caller of the capability, not its own logic.
  const world = window.__thro?.world, before = viewer().order;
  const order = world ? world.run('thro.reading.order', { order: before, swap: [a, b] }).outputs.order : null;
  if (!order) return;
  memory.order = order.join() === PARTS.join() ? null : order; write(ORDER, memory.order); announce();
}
export function resetOrder() { memory.order = null; write(ORDER, null); announce(); }
/** The person's own words for what a card (or a lineup) is for; empty text goes back to the site's. */
export function setPurpose(kind, text) {
  const next = { ...(memory.purpose ?? {}) }, clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean) next[kind] = clean; else delete next[kind];
  memory.purpose = Object.keys(next).length ? next : null; write(PURPOSE, memory.purpose); announce();
}
