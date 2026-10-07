# neat

`neat` is a small repo-local project ledger for agent-assisted work. Git owns history; Tidy owns lineage and promotion; product PCRs own detailed execution. Neat stores declared work and references those facts without copying or inventing them.

Install it in a project, then keep one JSON item at `.neat/items/<id>.json` and optional resolved facts at `.neat/facts.json`.

```sh
neat check
neat next
neat board
neat update EX-04 --expect <item-content-fingerprint> --patch claim.json
```

`check` validates local item shape. `next` reports locally available queued work and active claims. `board` writes one Markdown board and Mermaid graph from one PxC/PQL run. `update` locks and rereads only the addressed item, checks its content fingerprint, writes a sibling temporary file, then atomically replaces that item. It cannot edit requirements, checkpoints, execution, acceptance, or promotion records.

An item targets an existing Calculation (`fn.*`), Tick (`tick.*` plus its composition/name), or PCR (`pcr.*`). It is not a second task hierarchy. A shared Calculation’s board impact is derived from the named composition’s `Ticks[].Calculations[]`.

## Local PxCube refinement extension

An optional `refinement` links a WorkItem to existing item IDs. Flat items continue to work unchanged. This is a PxCube-local extension to the pinned neat source snapshot; `../../vendor/SOURCES.json` retains the upstream origin commit and hashes the exact locally extended bytes.

```json
{"mode":"combine","children":["piece-a","piece-b"]}
{"mode":"compare","children":["candidate-a","candidate-b"],"selections":{"browser":"candidate-a","mobile":"candidate-b"}}
```

Combine is `reviewable` when all its pieces are reviewable; otherwise it is `incomplete`. Compare is `reviewable` when each named context selects a reviewable candidate. It may leave other candidates active. Without a selection it stays `incomplete`; neat does not rank candidates. Nested Compare and Combine links work recursively. The board displays every direct child's derived state and named selections. `neat check` rejects missing children, cycles, duplicate child IDs, invalid modes, and invalid selections.

A leaf becomes **reviewable** when its declared activity is `review`. This only describes work progress: no parent's verification, acceptance, promotion, or checkpoint is inferred from its children. The real PxCube `PXCUBE-upload-refinement-compare` item names the baseline and typed delta as alternatives and intentionally has no selected winner.

The checked-in `fixtures/generic-project` fixture is intentionally synthetic. Run only the ordinary unit tests to inspect it; it proves the board buckets, guarded updates, independent acceptance, dependency blockers, cycles, and shared-calculation fanout without claiming execution, human acceptance, or Tidy promotion for a real project.

Concrete project examples belong on their own implementation branch. The DiscStudio example is developed on `impl/DiscStudio`, branched from `main`, so it can be copied or yoinked into a project without making the reusable neat foundation project-specific.

After this checkpoint is accepted, its runnable board command is:

```sh
node dist/src/cli.js board --root fixtures/generic-project
```

## Browser optimization advice

The optional `optimization-links` export can attach a `BO-*` reference to
work/evidence. The shared registry lives at `../../browser-optimizations`; it
is advisory and is not part of `neat check` or the board's readiness rules.

## Boundaries

- Execution/inspection, verification, human acceptance, and Tidy promotion are separate predicates.
- A human acceptance must be explicitly recorded with its source; tests and agents cannot create it.
- Neat does not run product tests, render product output, or call Tidy promotion.
- The standalone Tidy promotion receipt is not available yet, so neat only preserves external promotion references.
