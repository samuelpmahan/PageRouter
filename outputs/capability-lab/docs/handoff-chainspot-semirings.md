# Handoff: + and × for ChainSpot (to the PxC ChainSpot expert agent)

From claude-ed, 23 Oct 2026, at Sam's direction: "figure out how to do both + and × here and we'll transfer this TO the PxC ChainSpot expert agent; we'll give it the tools and then everyone figuring out how to use them and it all generalizing into a PxC kernel ALLOWS this experts-only THING to be understood and built upon."

## The idea in one line

A derived fact carries a polynomial of the inputs it came from: × for inputs used together, + for another way to the same fact. Evaluate that one polynomial in different semirings and the same work answers different questions. ChainSpot's two targets, perfect accuracy and under 5 seconds on a phone, are two semirings over the same derivations.

## Tools you have (all working, all tested)

| Tool | Where | What it gives you |
|---|---|---|
| Semiring capabilities | Capability Lab `src/semiring/index.mjs` | `semiring.product` (paths of a weighted graph in any semiring), `semiring.closure`, `provenance.evaluate` (sum of products of named inputs, every term reported). Its examples already include the tee pad pose |
| A worked second use | PxCube `experiences/thro/ways.mjs` | Σ over 11 card layouts evaluated in five semirings through the Lab registry; live as the person changes their order |
| The kernel proposal | `docs/semiring-sublation.md` (beside this file) | `world.sum(contract, inputs, { semiring, weigh })`: every implementation of a contract as another way |

## thro → ChainSpot

| thro | ChainSpot |
|---|---|
| a card layout (another way to draw the card) | a detector or derivation (another way to the same fact: corner × rectangle, edge × edge × rectangle, anchor × course map) |
| keeps the person's order (a check on what was drawn) | the tee pad pose demonstration: a known rectangle (major premise) and an observed right-angle corner (minor premise) give the pose |
| margin (how comfortably the order holds), viterbi | confidence of a derivation, viterbi (max, ×) |
| quietest extras, tropical | milliseconds of a derivation on the phone, tropical (min, +): the 5-second budget |
| lineage: which layouts and order it rests on | which frames, detectors and annotations a pose rests on: blame when an annotation says it is wrong |
| deletion: name first leaves 0 of 11 ways | a detector failing on a frame: does the pose survive, and through which way |

## Suggested first experiment

1. A PxC world with a `pose` contract and three implementations (corner, two edges, anchor and map), each a Calculation over one annotated frame from `chainspot-corpus`.
2. Weigh each way by confidence (viterbi) and measured milliseconds (tropical); sum with the Lab's `provenance.evaluate` until the kernel has `sum`; keep the polynomial, so confidence, milliseconds, lineage and "what survives losing this detector" all come from one pass over the frame.
3. Anytime evaluation: try ways cheapest first; stop once the boolean value is true at a confidence you accept. That is the principled exit for "under 5 seconds", rather than a timeout.
4. A page, per frame: the polynomial, the way that won inside the budget, its confidence, and what each single detector failure would leave. Show it; do not declare it.

## Sam's working rules that came with this

- Everything is a reference implementation first; a second use sublates it into the kernel. ChainSpot is the third use: please report what the kernel proposal gets wrong.
- Demonstrate, do not assert: "this is for … because … it does … thus", with measured numbers.
- Sam's rules of thumb are scaffolds for agents, not laws; record them as such.
- Convivial: show what could be, never tell the person what they are allowed to do.
