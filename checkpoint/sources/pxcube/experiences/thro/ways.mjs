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
  const ways = terms.filter(t => t.monomials.length).map(t => {
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

/** Every way this lineup could be (rung 10): Σ over lineup layouts (world.sum over thro.lineup.way) of Π over its cards (each card
 *  keeps the order). The kernel gives the ways; each way's product over its cards is written into its monomial as one variable per
 *  card (layout#cardN), so world.evaluate multiplies them: boolean (every card keeps it), counting (how many layouts), viterbi
 *  (product of comforts), tropical (sum of the cards' extras), lineage. layouts: [{ study, name, layout: [one per card] }]. */
export function everyLineupWay({ world, layouts, cards, intended = PARTS }) {
  const measured = Object.fromEntries(layouts.filter(l => Array.isArray(l.layout)).map(l => [l.study, l.layout]));
  const names = Object.fromEntries(layouts.map(l => [l.study, l.name]));
  const { terms } = world.sum('thro.lineup.way', { layouts: measured, cards: cards.map(c => ({ name: c.name, flights: c.flights })), intended: [...intended] });
  const studyOf = impl => `discstudio-lineup:${impl.replace('thro.lineup.way/', '')}`;
  const ways = terms.filter(t => t.monomials.length).map(t => {
    const fits = t.outputs.fits;
    return { study: studyOf(t.impl), impl: t.impl, name: names[studyOf(t.impl)] ?? t.impl, fits, keeps: fits.every(f => f.keeps), keeping: fits.filter(f => f.keeps).length,
      margin: fits.every(f => f.keeps) ? Math.min(...fits.map(f => f.margin)) : 0, cardVars: fits.map((_, i) => `${t.impl}#card${i + 1}`) };
  });
  const polynomial = terms.filter(t => t.monomials.length).flatMap(t => t.monomials.map(m => [...m, ...ways.find(w => w.impl === t.impl).cardVars]));
  if (!polynomial.length) return { ways, polynomial, answers: null };
  const each = (wayValue, cardValue) => Object.fromEntries(ways.flatMap(w => [[w.impl, wayValue(w)], ...w.fits.map((f, i) => [w.cardVars[i], f.keeps ? cardValue(f, i, w) : null])]).filter(([, v]) => v !== null));
  const valuation = {
    boolean: each(() => true, () => true),
    counting: each(() => ({ weight: 1 }), () => ({ weight: 1 })),
    viterbi: each(() => ({ weight: 1 }), f => ({ weight: 1 - 1 / f.margin })),
    tropical: each(() => ({ weight: 0 }), f => ({ weight: f.quiet })),
    lineage: each(w => ({ labels: [w.name] }), (f, i) => ({ labels: [`card ${i + 1}: ${cards[i].name}`] })),
  };
  const result = Object.fromEntries(Object.entries(valuation).map(([semiring, v]) => [semiring, world.evaluate(polynomial, semiring, v)]));
  const winner = semiring => { const r = result[semiring]; if (!r.value.present) return null; const i = r.terms.findIndex(t => t.value.present && t.value.weight === r.value.weight); return i < 0 ? null : ways[i].study; };
  return { ways, polynomial, answers: {
    possible: result.boolean.value.present, count: result.counting.value.weight ?? 0, of: ways.length,
    mostComfortable: winner('viterbi'), comfort: result.viterbi.value.weight ?? 0, quietest: winner('tropical'), quiet: result.tropical.value.weight ?? null,
    restsOn: result.lineage.value.labels ?? [], polynomial: polynomial.length, cards: cards.length } };
}
