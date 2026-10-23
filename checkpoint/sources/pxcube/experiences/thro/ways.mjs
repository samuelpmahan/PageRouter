// Every way this disc could be a card (rung 7, on the kernel since rung 8; Sam, 23 Oct: "constraint lab is literally defining
// another way? Each card style and option defines outputs in another way").
//
// Each Single layout is an implementation of thro.card.way, so world.sum runs them all and records the provenance polynomial:
// one term per layout that was measured (kernel seq 62, sublated from Capability Lab's semirings). The polynomial is computed
// once; world.evaluate maps it into five semirings afterwards, running nothing:
//   boolean   can this disc be a card that keeps your order at all
//   counting  how many layouts do
//   viterbi   which keeps it most comfortably (comfort = 1 − 1/margin, margin = the smallest size ratio between neighbours)
//   tropical  which keeps it with the quietest extras (cost = the largest other text, in px)
//   lineage   which layouts, and which order, the answer rests on
// It reads; it changes nothing on the card, and it never says what you should pick.
import { PARTS } from './thro-world.mjs';

const orderLabel = order => `order ${order.map(p => ({ disc: 'disc', name: 'name', numbers: 'numbers', other: 'rest' })[p]).join(' > ')}`;

/** world: a thro world; layouts: [{ study, name, layout }] for one disc; disc: { name, flights }; intended: the person's order. */
export function everyWay({ world, layouts, disc, intended = PARTS }) {
  const measured = Object.fromEntries(layouts.filter(l => l.layout).map(l => [l.study, l.layout]));
  const names = Object.fromEntries(layouts.map(l => [l.study, l.name]));
  const { polynomial, terms } = world.sum('thro.card.way', { layouts: measured, disc: { name: disc.name, flights: disc.flights }, intended: [...intended] });
  const studyOf = impl => `discstudio:${impl.replace('thro.card.way/', '')}`;
  const ways = terms.filter(t => t.monomial).map(t => {
    const { keeps, margin, quiet } = t.outputs;
    return { study: studyOf(t.impl), impl: t.impl, name: names[studyOf(t.impl)] ?? t.impl, keeps, margin, quiet, comfort: keeps ? 1 - 1 / margin : 0 };
  });
  if (!polynomial.length) return { ways, polynomial, answers: null };
  // The valuation says what each way is worth in each semiring; a way that does not keep the order is left out: the semiring's zero.
  const keeping = ways.filter(w => w.keeps);
  const valuation = {
    boolean: Object.fromEntries(keeping.map(w => [w.impl, true])),
    counting: Object.fromEntries(keeping.map(w => [w.impl, { weight: 1 }])),
    viterbi: Object.fromEntries(keeping.map(w => [w.impl, { weight: w.comfort }])),
    tropical: Object.fromEntries(keeping.map(w => [w.impl, { weight: w.quiet }])),
    lineage: Object.fromEntries(keeping.map(w => [w.impl, { labels: [w.name, orderLabel(intended)] }])),
  };
  const result = Object.fromEntries(Object.entries(valuation).map(([semiring, v]) => [semiring, world.evaluate(polynomial, semiring, v)]));
  const winner = semiring => { const r = result[semiring]; if (!r.value.present) return null; const i = r.terms.findIndex(t => t.value.present && t.value.weight === r.value.weight); return i < 0 ? null : ways[i].study; };
  const answers = {
    possible: result.boolean.value.present,
    count: result.counting.value.weight ?? 0,
    of: ways.length,
    mostComfortable: winner('viterbi'),
    comfort: result.viterbi.value.weight ?? 0,
    quietest: winner('tropical'),
    quiet: result.tropical.value.weight ?? null,
    restsOn: (result.lineage.value.labels ?? []).filter(l => !l.startsWith('order ')).concat((result.lineage.value.labels ?? []).filter(l => l.startsWith('order '))),
    polynomial: polynomial.length,
  };
  return { ways, polynomial, answers };
}
