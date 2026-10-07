# Persistence · six reload Cases

Local candidate, 2026-09-13. Kernel unchanged. No cloud sync.

## Implementation

- `persistence.ts`: versioned Part graph, selected shelf and current mold references.
  Retains own values, embedded Part references, aliases and producing compositions.
- `persistent-experience.ts`: browser storage adapter, recovery guard and status.
- `model.ts`: Save/Keep/review write the proposed archive before publishing the
  new selection. Rejected writes leave the previous selected shelf intact.
- `app.ts`: restores before mounting UI and displays persistence/recovery status.
- `shelf-ui.ts`: artist-owned; consumes `experience.persistenceStatus`.

Storage key: `discstudio.pxc.shelf.v1`. Stored locally in this browser/origin;
clearing site data removes it. Photos occupy storage too; quota failures are visible.
Unkept previews are not promised durable until a later successful checkpoint.

Restore uses only locally registered Calculations, verifies their outputs against
the archive, and then exposes the restored store. Original semantic addresses and
Part identity links survive. New kernel execution receipts describe **restore-time
verification**, not original execution timestamps. This is an application-specific
format, not arbitrary JS serialization, kernel persistence or automatic migration.
Unsupported material, incompatible output, unknown links or corrupt JSON cause
recovery status and block overwriting the existing archive. No automatic reset.

## Repeatable browser Cases

Open `http://127.0.0.1:4317/exp/upload-disc-to-shelf/persistence-cases.html`
and click **Run six Cases**. Source: `persistence-cases.ts`.

Each Case starts its own fixture, drives the actual Experience API, reloads the
document, then asserts ending PxC. It is browser/storage integration coverage,
not an automated click-through of every shelf control. Existing UI verification
and the artist's visual pass remain separate evidence.

| Case | Starting material / actions | Ending assertion |
| --- | --- | --- |
| Retain | Empty → upload two discs → reload | Same two selected references |
| Specialize | Two discs → set one turn=0 → Keep → reload | Override survives; sibling and mold unchanged |
| Inherit | Override → remove own turn → Keep → reload | Original mold supplies turn |
| Inspect | Kept edit → reload | Disc → `oc.update` → original Disc → `oc.create`; receipt resolves |
| Recover | Replace test archive with corrupt bytes → reload → attempt Save | Recovery status, rejected write, identical corrupt bytes |
| Failed save | Existing shelf → injected quota failure → reload | Failure status, no success event, original shelf and bytes |

Runner keys are `discstudio.pxc.e2e.fixture.v1` (localStorage) and
`discstudio.pxc.e2e.progress.v1` (sessionStorage). Only those disposable test keys
are reset. The user's production shelf key is never written by this runner.
Synthetic photo material tests retention, not image decoding.

## Evidence

Final browser rerun: all six passed across real document reloads, including
the refinement retaining original semantic addresses in restore receipts.
Automated suite: 67 tests pass, including five persistence tests for graph
restoration, failure isolation, modified output rejection, painted art and corrected
mold defaults. TypeScript no-emit passes. See the live runner for fresh browser
results after edits; historical evidence does not attest subsequently changed bytes.

No blanket claim that every ExploreShelf m Case is closed: displayed general
CaseRun comparison, richer recovery tooling and product-level durability choices
remain separate. Replay can reject an older archive after implementation changes;
the original stored bytes remain available for a deliberate migration.
