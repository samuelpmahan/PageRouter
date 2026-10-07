# PxCube Browser Optimization Store

This is Phase 1 of a repo-native memory for browser slow paths. It is a small,
reviewable registry of patterns that recur across PxCube Experiences, with a
signal, a recommendation, a guard, and evidence for each pattern.

The checked-in store is deliberately advisory. It does not collect user data,
change an active browser session, restart a server, change the launcher, or gate
an unrelated Experience. Later phases can attach measured observations and
automatic suggestions without changing the seed record shape.

## Seed records

| ID | Pattern | Main protection |
| --- | --- | --- |
| BO-0001 | transient-before-durable | Keep the usable draft when persistence is slow or fails. |
| BO-0002 | catalog-index-once | Build one session index and share it. |
| BO-0006 | never-restart-live-session | Offer a new attempt without destroying the loaded context. |
| BO-0007 | served-preview-only | Serve verified output; keep build/source work outside preview. |
| BO-0008 | #PROcision | Combine automatic help with exact, reversible, same-viewport finishing. |

`registry.json` is the data; `schema.json` documents its stable JSON shape;
`lib/store.mjs` supplies validation, lookup, filtering, and summary helpers;
`lib/integrations.mjs` is the narrow advisory seam shared by neat, tidy, and
crisp. The lane bridges are additive and opt-in.

Run the executable unit/static guards from the PxCube root:

```sh
node browser-optimizations/test/run.mjs
```
