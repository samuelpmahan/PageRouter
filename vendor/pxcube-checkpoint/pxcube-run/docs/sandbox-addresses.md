# Sandbox identity and test executions

Sam's clarification, 2026-09-14:

> Sandboxes just need mock.<id>.* the iterator then explicitly delineates pure unit/e2e sandboxes vs deliberately interactive ones

| Purpose | Mount | Lifecycle |
| --- | --- | --- |
| Deliberately interactive | `mock.<id>` | Open or resume this workspace. |
| Unit/E2E execution | `mock.<id>.<iterator>` | Allocate a fresh seeded run; retain previous runs. |

The fields follow that distinction: `kind: "interactive"` has no iteration;
`kind: "test"` has an iteration. The internal values still live at `px.*`, `fn.*`,
`oc.*`, and `sc.*`. Neither a workspace name nor an iterator becomes a Part prefix
inside the stored world.

The current mock owner supplies `openInteractive(id, world)` and
`createTestRun(id, world)`. Test input comes from the declared seed; editing the
workspace does not silently alter that seed. Reopening an existing interactive
id with a different world is refused, so a caller cannot accidentally replace it.

`mock.shelf` and `mock.shelf.1` are separate owners. The interactive handle does
not gain access to the test's values merely because their string prefixes overlap.
The routing boundary consumes the entire mount before resolving an inner name.

Earlier retained worlds did not record intent. They remain inspectable as
“Earlier sandbox · purpose unrecorded,” with their values and recorded metadata preserved. Allocation counts their existing iterators to avoid collisions.

This changes the mock owner and its demonstration. The upcoming UploadDiscToShelf
and ExploreShelf entries should use the stable mount when a person opens an
Experience, and request a numbered mount when a Case/test runner starts a run.
Their Studio Part-object adapter remains separate work.
