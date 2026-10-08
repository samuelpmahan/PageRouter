# Grid engine provenance

`grid-engine.mjs` is a byte-for-byte local copy of the existing deterministic rule engine. The source engine remains unchanged.

- Source: `/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/rule-engine/engine.mjs`
- Source SHA-256: `a15f005f2b6bc38e8cf3e9d45910a63a6363a8a67c9b61a428933cc79a1f659a`
- Copy SHA-256 at import: `a15f005f2b6bc38e8cf3e9d45910a63a6363a8a67c9b61a428933cc79a1f659a`
- Reused exports: `parseRules`, `step`, `replay`, and `hash`

Block5 wraps `step` as the registered `grid.step.v1` calculation. It does not alter the source engine's movement or rule interpretation.

At module startup Block5 reads the copied engine bytes and computes the SHA-256 digest from those bytes. Browser modules use a same-origin `fetch` with caching disabled; Node uses a conditional file read. A source-read or digest failure stops module startup. `PROVIDER_SETUP` reports the byte count, method, and one-time elapsed milliseconds; that timing is startup metadata, not part of event streams or replay timings.

The provider implementation ID includes this computed full-file digest plus explicit physics provider/helper source. This pins the Block5 calculation source closure described above; it is not a digest of the complete application, runtime, or PxC package.
