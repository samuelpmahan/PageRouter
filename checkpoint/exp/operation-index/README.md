# Operation timeline

Open the Atlas page at `#/pxcube/atlas`. Its top panel shares one timeline across Atlas and Capability Lab. **Run CV counterexample** records a synthetic CapabilityLab execution and replay for each ordering: rank then filter, and filter then rank. The fixture demonstrates that a high-scoring candidate outside the radius can hide an acceptable candidate. Its nested ChainSpot commit link is historical context; the fixture implementation has an unbound local identity and does not execute that old TypeScript or a complete CV pipeline.

Atlas records each graph boundary through its runtime callback, including search bootstrap/rounds, compositions, ladder actions and replay. The native Capability Lab page keeps its original Run and Replay actions; the build overlay observes those boundaries and posts bounded records to the host. The host accepts messages only from the designated frame and origin. Its 512 KB message limit protects the bridge. CapabilityLab call-tree edges mean invocation only. Atlas data edges require an actual input Part address to match a producer output address.

Each record retains producer start and finish times, source/build identity, native evidence, and a host-assigned run ID; the index also adds its own observed time and sequence. These clocks and identities describe different things. Atlas cache hits appear as cached operations, while body failures retain their failed trace. A failure before a trace exists is recorded with no operations and is labeled as unavailable; the observer does not invent missing calls.

Browser storage keeps at most 100 runs and 1 MB per run. Storage quota/read failures remain visible in the panel; Export JSON downloads the shared index. Flow candidate keys support comparison only: they ignore incidental names, preserve observed wiring and declared operation, predicate, constants, frame and units, and do not establish behavioral equivalence. The offline PxC kernel-window miner adds a sorted `nameIndependentCandidateKeys` array beside each legacy grouping because one legacy shape may contain multiple candidates; old counts and ranking are unchanged. It is not a live observer of every kernel failure.

From `checkpoint/`, run the focused checks and build:

```sh
node --test exp/operation-index/*.test.mjs scripts/operation-timeline-view.test.mjs exp/atlas/atlas.test.mjs exp/atlas/capability-protocol.test.mjs
npm run build
node --test scripts/operation-index-built.test.mjs
```

Browser visual verification is not claimed here; it requires a local or CI Playwright Chromium installation. The Node tests cover runtime adapters, bridges, bounded storage, the CV fixture, and timeline behavior.
