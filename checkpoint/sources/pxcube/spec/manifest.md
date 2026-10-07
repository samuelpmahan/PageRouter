# App manifest contract

Each PxC app ships an `experience.json` (name kept for history; it declares any PxC app, not just Disc Studio experiences) at its root. The manifest is the app's proposal. tidy's registry is the verdict.

## Fields

- `title`, `description`, `version`: shown on the launcher card.
- `track`: `"clean"` or `"exp"` (default `"exp"`). A proposal; tidy decides.
- `mounts`: array of mount names the app needs, e.g. `["shelf"]`. The hypervisor provisions each mount against a real or mock backend. The app addresses them as `{MOUNT}.{px|fn|oc|sc}.*` and cannot tell which is behind the seam.
- `entry`: informational, where a human starts reading the app's source.
- `build`: shell command run in the app dir. Anything goes. Must emit static files.
- `outDir`: build output dir, relative to the app dir. Must contain `index.html` at its root.
- `sandbox`: iframe sandbox tokens. Default `["allow-scripts"]`.
- Anything else: surfaced verbatim in the Manifests accordion. Wiring in whatever you need never requires touching the launcher generator.

## Sandbox model

- Default `allow-scripts` runs the THING with an opaque origin: scripts run, no storage, no cookies, no parent access. Safest for exp builds.
- Clean THINGs may add `allow-same-origin` when they need storage or a shared origin with the shelf.
- `allow-top-navigation` and `allow-top-navigation-by-user-activation` are stripped by the generator even if declared. A THING never navigates the shelf; the back button is the only way home.

## Registration

A Tidy-typed overlay can declare `{ "tidy": { "type": "..." }, "base": "sibling", "patches": [...] }`.
Kompoze resolves the sibling base, merges the selected type's fields, then applies JSON merge patches in order. The selected type's root, id, version, and source digest remain authoritative; patches cannot change identity or resolution metadata. The resolved manifest names its type, version, base, and base type provenance in `composition`. CRISP packages the resolved manifest and records that lineage alongside the base and overlay chunks. A patch-only typed declaration must name a base. Existing typed references with only `tidy.type` keep their original behavior.

`crisp register <app-dir>` snapshots the manifest into tidy's registry with a source hash and hands the caller a receipt. Re-registering updates the snapshot. Drift between the manifest file and the registry snapshot surfaces in the accordion as "changed since registration".

## Failure semantics

- One red app never blocks the others (matrix `fail-fast: false`).
- The assemble step ships what built; failed apps appear as honest "build failed" cards on their track's tab.
