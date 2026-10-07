# PxC DevTools

## Live object/runtime update

Inspect actual JS identity, own property descriptors (including symbols and
non-enumerables), lazy prototypes, methods, cycles, Maps/Sets and the Part wrapper.
Plain Disc records remain plain objects; no synthetic class/schema is invented.
Browse/search use descriptors, not ordinary getter calls or `toJSON`. Reflecting
on a Proxy can invoke its traps; this is explicitly not a sandbox.

Open **Create object playground** for a labeled Counter fixture with a getter,
sync/async methods, deliberate failure, cycle, symbol and non-enumerable field.
Expand a getter/method, enable **Allow this live invocation**, then run it against
the actual receiver. Selecting a function-valued Part also exposes a Calculation
runner: named inputs are `{"ref":"address"}` or `{"value":...}`. Observed prior
calls supply suggestions, not an inferred authoritative signature.

Execution goes through the existing `PxC.compose`, preserving callable/receiver
and inputs. `devtools.run.N.started`, `.result`, and `.finished` retain lifecycle
facts (no result on failure). Successful and failed receipts can be opened to
inspect their actual Calculation and inputs. Awaited results retain their real
JS identity. Mutating methods really mutate: refresh/reopen the receiver to inspect
it. Scratch replacement still does not update application selections.

No arbitrary source eval, breakpoints, stepping inside JS functions, rollback,
worker isolation or cancellation. A synchronous infinite loop can block the tab;
an unresolved promise remains running. Private class slots/closure environments
are not exposed by JS reflection. This is a PxC object/execution inspector, not
a replacement for the browser engine's debugger protocol.

Fresh evidence: 52 combined tests passed; app TypeScript no-emit check passed.
Tests cover accessor-safe discovery, identity, descriptors, receiver-bound
methods/getters, async calls, failures, Map receiver semantics, and binding
validation. Browser exercised actual prototype inspection, explicit getter → 4,
and existing `selectPainting` with named ref/literal inputs. Result shared the
original painting object and displayed both bindings. Browser also invoked the
deliberately throwing playground method and showed its failed execution receipt.

## Next: Experience state-transition tests

Contract: **starting PxC + ordered actions → ending PxC + visible assertions**.

| Input / assertion | Required meaning |
| --- | --- |
| Starting PxC | Fixture material, explicit Calculation implementations and active references |
| Actions | User-level fill/select/click steps through the actual UI; await completion |
| Ending PxC | Expected material, relationships, membership and operation outcomes |
| Unchanged | Base molds, unrelated specimens and other protected input material |
| Visible result | What the user sees, including failure and empty states |

Fix or record randomness/time/external inputs. Compare semantically relevant
Parts; bind generated addresses to test aliases rather than hardcode serial IDs.
Capture starting material before actions: retaining the same borrowed objects
does not preserve a before-state after mutation. Arbitrary functions, symbols,
maps and cycles require explicit fixture/comparison support, not JSON round-trip
claims. A failed state assertion should open the expected/actual target in DevTools
from the neat checklist without marking acceptance.

This state-transition runner/checklist integration is a next-layer design,
not implemented by the runtime-inspector update.

## Earlier first-slice evidence

Open the local upload page and choose **PxC DevTools**, or save a disc and click
**Inspect in PxC**. Browse and filter the current store, open a Part, follow its
Calculation/inputs/consumers, inspect receipts, and create scratch alternatives.

This is the same in-memory PxC. Original values are not immutable snapshots.
Scratch output does not update the shelf or catalog. Reload clears session data.
The checklist integration is proposed, not implemented:
[mGM and evidence](../../.neat/ds/experiences/pxc-devtools/pxc-devtools_mGM.md).

Fresh check: `node --test *.test.ts devtools.test.mjs ../part-first-kernel/test/*.test.mjs`
passed 48 checks. Browser smoke test saved a disc, opened its exact Part,
followed its seed, found Destroyer by text, and retained a scratch result with
an execution receipt. No commits, pushes, core changes or human acceptance.
