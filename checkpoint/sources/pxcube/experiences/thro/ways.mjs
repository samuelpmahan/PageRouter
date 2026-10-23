// Every way this disc could be a card (rung 7; Sam, 23 Oct: "constraint lab is literally defining another way? Each card style
// and option defines outputs in another way"). The second use of Capability Lab's semiring capabilities (vendored in ./lab).
//
// The card for this disc is a sum over layouts: Σ_L (layout L × L keeps your order). One polynomial, evaluated in five semirings
// by the Lab's own provenance.evaluate, answers five questions without drawing anything new (every layout's measurements come
// from the thumbnails the renderer already drew):
//   boolean   can this disc be a card that keeps your order at all
//   counting  how many layouts do
//   viterbi   which keeps it most comfortably (comfort = 1 − 1/margin, margin = the smallest size ratio between neighbours)
//   tropical  which keeps it with the quietest extras (cost = the largest other text, in px)
//   lineage   which layouts, and which order, the answer rests on
// It reads; it changes nothing on the card, and it never says what you should pick.
import { createRegistry } from './lab/runtime.mjs';
import { capabilities as semiringCapabilities } from './lab/semiring.mjs';
import { PARTS, readingOf, orderFit } from './thro-world.mjs';

let registry = null;
const lab = () => (registry ??= createRegistry(semiringCapabilities, { source: 'capability-lab (vendored in thro/lab, PIN.json)', version: '1' }));
const orderLabel = order => `order ${order.map(p => ({ disc: 'disc', name: 'name', numbers: 'numbers', other: 'rest' })[p]).join(' > ')}`;

/** layouts: [{ study, name, layout }] for one disc; disc: { name, flights }; intended: the person's order (or the scaffold). */
export function everyWay({ layouts, disc, intended = PARTS }) {
  const ways = layouts.filter(l => l.layout).map(l => {
    const reading = readingOf(l.layout, disc.name, disc.flights), fit = orderFit(reading, intended);
    return { study: l.study, name: l.name, keeps: fit.keeps, margin: fit.margin, quiet: Math.round(reading.other.size * 10) / 10, comfort: fit.keeps ? 1 - 1 / fit.margin : 0 };
  });
  const polynomial = ways.map(w => [`layout:${w.study}`, `keeps:${w.study}`]);
  const values = {
    boolean: ways.flatMap(w => [{ variable: `layout:${w.study}` }, ...(w.keeps ? [{ variable: `keeps:${w.study}` }] : [])]),
    counting: ways.flatMap(w => [{ variable: `layout:${w.study}`, weight: 1 }, ...(w.keeps ? [{ variable: `keeps:${w.study}`, weight: 1 }] : [])]),
    viterbi: ways.flatMap(w => [{ variable: `layout:${w.study}`, weight: 1 }, ...(w.keeps ? [{ variable: `keeps:${w.study}`, weight: w.comfort }] : [])]),
    tropical: ways.flatMap(w => [{ variable: `layout:${w.study}`, weight: w.quiet }, ...(w.keeps ? [{ variable: `keeps:${w.study}`, weight: 0 }] : [])]),
    lineage: ways.flatMap(w => [{ variable: `layout:${w.study}`, labels: [w.name] }, ...(w.keeps ? [{ variable: `keeps:${w.study}`, labels: [orderLabel(intended)] }] : [])]),
  };
  if (!polynomial.length) return { ways, polynomial, answers: null };
  const evaluate = semiring => lab().execute('provenance.evaluate', { semiring, polynomial, values: values[semiring] });
  const runs = Object.fromEntries(Object.keys(values).map(s => [s, evaluate(s)]));
  const winner = semiring => { const r = runs[semiring].result; if (!r.value.present) return null; const i = r.terms.findIndex(t => t.value.present && t.value.weight === r.value.weight); return i < 0 ? null : ways[i].study; };
  const answers = {
    possible: runs.boolean.result.value.present,
    count: runs.counting.result.value.weight ?? 0,
    of: ways.length,
    mostComfortable: winner('viterbi'),
    comfort: runs.viterbi.result.value.weight ?? 0,
    quietest: winner('tropical'),
    quiet: runs.tropical.result.value.weight ?? null,
    restsOn: runs.lineage.result.value.labels ?? [],
    calls: Object.values(runs).reduce((n, r) => n + countCalls(r.trace), 0),
  };
  return { ways, polynomial, answers };
}
const countCalls = trace => (trace?.calls ?? []).reduce((n, c) => n + 1 + countCalls(c), 0);
