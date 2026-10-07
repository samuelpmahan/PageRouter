# Proposed compact queue — Sam's direction, not implemented yet

Persist one immutable initial render recipe and shared source assets, then one
small record per queued image. The recipe contains the named disc values,
painting inputs or retained art references, layout, colors and renderer identity.
Each image records its identity, base/parent identity, explicit changed values,
and the expected SVG digest from its preview. Queue order is a separate list of
image identities. Reordering cannot change what any delta applies to.

Prefer absolute field assignments such as points=3 over operation logs such as
"increment". A points/turn change must not repeat paintings, SVGs, or the complete
execution archive. The existing P&C calculations can materialize a selected
recipe in a temporary store. Retain source/provenance needed to reconstruct the
state; do not serialize all temporary display calculations on every UI edit.

ExportGraphics receives the same recipe references/compact document. Reconstruct
one requested state, render SVG, compare the saved preview digest, generate PNG
as a Blob when requested, download, and release temporary resources. This all
runs in the browser without writing the generated image to localStorage.
Keep only visible thumbnail work active.

Renderer identity and source assets must remain resolvable. A code or asset
change that no longer reproduces a queued preview is surfaced, never silently
substituted. Uploaded photos should be stored once in suitable blob storage;
the queue refers to them. Existing full captures remain preserved during any
migration.

Validation before claiming 100-image support: 100 distinct queued states,
reordered items retain the same SVG, reload reproduces all expected SVG hashes,
individual export succeeds, and measured storage/save/render latency remains
bounded. The current compact shape is a proposal; the running app still saves
full captures and archives.
