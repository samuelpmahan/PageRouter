# Proposal: what the second use sublates into the PxC kernel

Sam's rule: everything starts as a reference implementation in Capability Lab; a second use sublates the piece into the kernel.

| Use | Where | Evidence |
|---|---|---|
| First | Capability Lab `src/semiring/index.mjs`: `semiring.add`, `semiring.product`, `semiring.power`, `semiring.closure`, `provenance.evaluate` | Lab grade 277/277 on Sam's PC; brute-force walk enumeration in all five semirings; semiring laws on seeded random graphs; four source mutations each fail the tests |
| Second | thro `experiences/thro/ways.mjs` (vendored Lab copies pinned in `thro/lab/PIN.json`): "every way this disc could be a card" = Σ over 11 layouts of (layout × keeps your order) | Node tests; browser check at 1280 and 390 (11/11 under the scaffold order, 0/11 with the name first, live as the person reorders) |
| Third (pending) | ChainSpot: the tee pad pose and the 5-second phone budget | the handoff brief beside this file |

## What moves into the kernel

Today `ctx.call(contract, inputs)` resolves exactly one implementation (the fill's choice, or the only one; otherwise `AMBIGUOUS`). That is phronesis: pick one way. The second use shows the other reading of the same registry: every implementation is another way to the same output, and the ways combine.

```js
// New, beside run / call; nothing existing changes meaning.
world.sum(contract, inputs)            // and ctx.sum(...) inside an implementation
// → { polynomial, terms: [{ impl, receipt }], receipt }
world.evaluate(polynomial, semiring, valuation)   // a homomorphism out of the polynomial, applied afterwards
// → { value, terms: [{ monomial, value }] }
```

The fundamental theorem of provenance (Green, Karvounarakis & Tannen 2007) decides the shape: polynomials over the inputs, ℕ[X], are the free semiring, so any other semiring is reached by a homomorphism from the polynomial. Compute the polynomial once, keep it in the receipt as the master record, and evaluate it in whatever semiring a question needs, later, without re-running anything (the same thing `ways.mjs` already does: one sum, five evaluations).

- Every registered implementation of `contract` runs on `inputs` (each with its own receipt and cache entries, as `run` does today). Each is one monomial: the product of the named inputs and calls its trace used (× from the trace the kernel already records); the implementations are the terms of the sum (+). A failed implementation contributes no term, and its error stays in its receipt.
- `world.evaluate` takes one of the Lab's semirings (boolean, counting, tropical, viterbi, lineage, from the Lab's table, not re-implemented) and a valuation: what each input is worth in that semiring (thro: does this layout keep your order, and by what margin; ChainSpot: a detector's confidence and its milliseconds).
- Deletion and delta debugging come from the polynomial with no reruns: removing an input deletes exactly the monomials that use it; the smallest set of inputs whose removal kills a fact is a minimal hitting set of its monomials.
- `ctx.call` is the special case that keeps one term, the one the fill names, so a fill remains what it is today: the person's choice among the ways.

## Kernel tests that would come with it

1. Two implementations, five semirings: `evaluate(sum(...).polynomial, s, v)` equals the Lab's `provenance.evaluate` on the same polynomial and values, for every s.
2. One polynomial, many semirings: evaluating the stored polynomial in a second semiring runs no implementation again (call counts unchanged).
3. Deletion propagation: removing one input removes exactly the terms that used it (boolean stays true while another way remains).
4. A throwing implementation is a missing term with its error in the receipt; the others still sum.
5. Cache: summing twice reuses every term (`cachedFrom` per term), as `run` does.
6. `call` under a fill equals the fill's term of `sum`; `AMBIGUOUS` is still raised by `call`, never by `sum`.

## Not proposed

No change to `ctx.call`, fills or Part hashing; receipts gain one field, the polynomial, and only on a `sum`. No new semirings beyond the Lab's five until a use needs one (the Lab first, then a second use).
