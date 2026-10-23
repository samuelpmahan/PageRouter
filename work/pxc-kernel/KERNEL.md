# PxC kernel: public API (v0.6, frozen for contest round 6)

Dependency-free ES modules, Node 20+ and browser. Import from `src/kernel.mjs` and `src/view.mjs` only. Every change and the entries that forced it are in `ledger/necessity.jsonl` (v0.2: seq 9–23; v0.3: seq 24–33; v0.4: seq 34–43; v0.5: seq 44–52; v0.6: seq 53–59). `test/kernel-v06.test.mjs` and `verify/render-v06.mjs` show each v0.6 concept working; `verify/V03.md`–`V06.md` record the visual checks, and `verify/AUDIT.md` plus `AUDIT-RESPONSE.md` hold an independent audit of the kernel pictures and what changed because of it.

## Nouns

| Noun | What it is |
|---|---|
| Part | An immutable JSON value, identified by the FNV-1a 64 hash of its canonical JSON. Stored once per world. |
| Ref | One occurrence of a Part inside a run: `{ value, hash, from, run }`. Only the kernel creates Refs. |
| Contract | `{ id, kind?, in, out, examples?, tolerance?, description?, notes? }`. `kind` is `calculation` (default), `check` or `tick`. Ids may not contain `/` or `#`. Port schemas may carry annotations whose keys start with `x-` (v0.4), ignored by validation and visible in `world.contracts()`. |
| Implementation | `{ id, implements, version?, uses?, run(input, ctx), pure?, examples?, description?, origin? }`. Implements exactly one contract. `uses` entries are `'contract'` or `'contract#slot'`. |
| Composition | An Implementation declared as data: `world.compose({ id, implements, steps, returns, pure?, examples? })`. Checked at assembly time. |
| Run | `world.run(contractId, inputs, { fill?, seed?, cache?, maxCalls?, allowUnusedFill? })` returns `{ outputs, refs, trace, receipt }`. |
| Drive | `world.drive(tickContractId, inputs, { ticks? , until?, each?, fill?, seed?, cache? })` returns `{ receipts, final, state, ticks }`. |

## Kinds

- **calculation:** in ports to out ports.
- **check:** must output `accepted: boolean` and `reason: string` (enforced at declaration). The trace node carries `kind: 'check'`; `receipt.verdicts` lists every check in the run with `{ call, contract, impl, accepted, reason }`. A check that returns `accepted:false` is a normal, successful run. Throw only for malformed input.
- **tick:** must have a `state` port on both sides, with `out.state` able to feed `in.state`. `drive` runs it once per tick. Tick k's `state` input is the Ref tick k−1 returned, so its `from` is `{kind:'run', run, from}`. Each receipt has `tick: k` and replays on its own (`world.replay(receipts[k])`), even in a fresh world with the same registrations. `ctx.tick()` returns the current tick inside an implementation. `seed` for a drive becomes `[seed, k]` per tick. `each(k, stateValue, stateRef)` can add per-tick inputs; `until(outputs, k)` stops it. **v0.3:** reading `ctx.tick()` makes the tick a cache dependency of that call (not impurity): its entry is reused only at the same tick, and a drive absorbs its children's tick reads, so the call around a drive stays cacheable.

## Choosing an implementation

Specificity first (v0.5): path fill (longest wins) → `fill['contract#slot']` → `fill['contract#*']` (every slot of the contract) → `select(contract, impl, slot)` → `fill[contract]` → `select(contract, impl)` → the only implementation → otherwise `AMBIGUOUS`. A seat's own select is a pin: a contract-wide fill (including the one `prove` uses) no longer reaches it. Use `contract#*` to reach every slotted seat on purpose.

What landed where:
- `receipt.fillConsulted` lists the fill keys some call actually used.
- `receipt.fillReach` (v0.6) maps each fill key to the call ids it chose for; a cache hit counts as its hit node.
- Every node carries `chosenBy: { rung, key? }` (v0.6). The rung is `path fill`, `slot fill`, `every-slot fill`, `slot select`, `contract fill`, `contract select` or `only implementation`.

**Path fills (v0.4).** A fill key may name a chain of calls: `'adder.ripple4#hi/adder.full#bit2'` fills only the `adder.full#bit2` calls made somewhere beneath an `adder.ripple4#hi` call. Segments match ancestors in order, not necessarily adjacent; a bare contract segment (`'half/leaf#b1'`) matches any slot of it. The longest matching path wins over shorter paths and over flat keys. Two different implementations at the same length are `BAD_FILL`. A path fill must land (v0.5): some call in the run, or anywhere in a drive, must have used it. Otherwise it is `BAD_FILL` ("reached no call"). Flat slot keys stay standing configuration (declared or consulted).

**Landing (v0.6).** `run`/`drive` take `landing`:
- `'path'` (the default, as above).
- `'all'`: every fill key must land, for an experiment that aims.
- `'none'`: a sweep that reuses one fill table across different runs may miss.

In every mode, a slot nobody declares or consults, or a contract that doesn't exist, is still `BAD_FILL`. The cache stays correct: entries made under path fills record each choice at its relative call path, and entries made without them are never served to a run that has them.

Fill keys are validated: an unknown contract or an implementation of the wrong contract fails with `BAD_FILL` before the run. **v0.3:** a slot key is valid only if that slot is *declared* (a composition step's `slot`, or `'contract#slot'` in some implementation's `uses`) or was *consulted* in this run, or anywhere in this drive. Anything else is a typo: `BAD_FILL` after the run, with the run recorded as failed. `allowUnusedFill: true` turns this off. An implementation that declares any slot of a contract may call only its declared slots (`UNDECLARED_SLOT`); one that lists the bare contract may call any slot.

## Inside `run(input, ctx)`

- `input` is `{ port: Ref }`. Read values with `input.port.value`.
- `ctx.call(contractId, { port: Ref | value }, { slot? })` returns `{ port: Ref }`. Must be listed in `uses`. `slot` names the call site; the trace node shows `contract#slot` and fills can target it.
- `ctx.at(ref, ...path)` a Ref for a piece of a value (recorded as a path).
- `ctx.gather(arrayOrObject)` a Ref for a value built from Refs (and plain values), recording each piece's provenance. The inverse of `at`.
- `ctx.concat(...arrays)` (v0.3): concatenate arrays of Refs or values; each element keeps a path into the array it came from.
- `ctx.test({ op: [a, b] })` (v0.4): a relation over Refs or plain values, as a boolean Ref whose provenance is `{ kind: 'test', op, args: [from, …] }`; literal operands appear as `{ kind: 'literal', value }`. Operators: `not`, `and`, `or` (booleans; and/or take one or more), `eq`, `ne` (deep equality), `lt`, `le`, `gt`, `ge` (two numbers or two strings). Tests nest.
- `ctx.when(cond, label, branches?)`: `cond` is a boolean Ref or (v0.4) a test object. Returns the boolean and records `{ label, value, from }` on `node.decisions`. With `branches = { true: 'name', false: 'name' }` the decision also records `ran` and `skipped`. Use it for every branch you want the trace to explain.
- `ctx.drive(tickContract, args, { ticks? | until?, each?, maxTicks?, slot?, startTick?, collect? })`: fold a tick inside this call. Each tick is a child node with `node.tick = k`, counting from `startTick` (default 0). Returns the last outputs plus `ticks`. With `collect: ['port']` (v0.4) it also returns `collected: { port: Ref }`, an array of that port's value at every tick, gathered so each element points at its tick's call. Zero ticks returns `{ state: <input state>, ticks: 0 }`. The node records `drives: [{ contract, slot, startTick, ticks, stopped: 'ticks' | 'until' | 'maxTicks', calls }]`.
- `ctx.fault(message, code)` (v0.3): fail with a named code, recorded on this node.
- `ctx.literal(value)`, `ctx.random()` (needs a run seed; marks the call impure), `ctx.value(x)`, `ctx.tick()` (a cache dependency, see Kinds).
- Forward Refs, not `.value`, whenever you can. A plain value is recorded as `computed`.
- Return `{ port: Ref | value }` for every output port. Synchronous.
- A Ref from another run is accepted anywhere and recorded as `{kind:'run', run, from}`.

## Composition specs

`'$in.port'`, `'step.port'`, `{ at: [spec, ...path] }`, `{ literal: value }`, `{ gather: [spec, ...] | { key: spec } }`, `{ concat: [spec, ...] }`, `{ first: [spec, ...] }`, `{ one: [spec, ...] }` (v0.4), and tests (v0.4): `{ not: [spec] }`, `{ and | or: [spec, ...] }`, `{ eq | ne | lt | le | gt | ge: [spec, spec] }`. A test operand may be a bare number, boolean or null; strings go in `{ literal }`. A test is a spec like any other: it can be a `when`, or be bound to a boolean port. Steps may carry `slot` (which declares it) and `when` (v0.3). `compose({ pure: false })` marks a composition uncacheable.

**Inherited skips (v0.5) and runs (v0.6).** A step that reads the output of a skipped step, in its bindings or its `when`, is skipped too. It records a decision `{ label: step, value: false, skipped: step, from }` whose `from` is the original cause, so the view merges it with the decision that caused it. A step with no `when` of its own that runs because what it reads ran records `{ label: step, value: true, ran: step, from }` with the same cause (v0.6), so both sides of a condition leave the same rows. A step whose binding has an unconditional fallback (`{ first: ['a.y', '$in.x'] }`) is not conditional and records nothing. Its effective condition, for the lint, is the `and` of its own `when` and the conditions of the conditional steps it reads. So a guard is written once. The composition's boundary still holds: `returns` may read a conditional output only inside `{ first }` or `{ one }`.

**`else` (v0.5).** `when: { else: ['a', 'b'] }` is true when every named step was skipped by its own condition: a derived complement, never a typed one. If a named step was skipped by inheritance (its context did not happen), the `else` step is skipped too (v0.6): a finished game does not forfeit. A `first` or `one` inside a step binding whose every option was skipped skips the step instead of failing (v0.6); in `returns` it is still `NO_BRANCH`. Its provenance is `{ kind: 'test', op: 'else', steps, args: [cause of each step] }`. The named steps must be earlier conditional steps. `{ one }` fails at assembly if an alternative is unconditional, or if one alternative's condition implies another's.

**Conditional steps (v0.3).** A step with `when: <boolean spec>` runs only if the spec reads true. Otherwise it is skipped: no node is created, and the composition's node records the decision as `{ label: step, value: false, from, skipped: step }` (or `ran: step` when true). The outputs of a conditional step may be used only inside `{ first: [...] }` (the first alternative not skipped) or `{ one: [...] }` (exactly one alternative may be live, otherwise `AMBIGUOUS_BRANCH`), or by steps whose `when` is the same condition or an `{ and: [...] }` containing it. A step's own `when` may read the steps its `and` guarantees. `and`/`or` short-circuit, so a false guard decides the condition before a skipped operand is read. A gather, concat, at or test with a skipped piece is itself skipped, so `first` falls through it. The lint enforces all of this at assembly. If every alternative is skipped, the run fails with `NO_BRANCH`. Check steps need not have their outputs consumed.

## Cache

Pure calls are cached by implementation, version and input hashes. An entry records every implementation choice made beneath it (and the tick, if read) and is reused only if those choices still resolve the same under the current fill. A cache hit node carries `cachedFrom: { run, call }` and the `verdicts` its subtree produced; `receipt.verdicts` includes them marked `cached: true`. Anything that calls `ctx.random()` or has `pure: false`, and everything above it, is never cached. `cache: false` neither reads nor writes.

## Errors

Every throw records `node.error = { code, message, via? }` on the node where it happened (`via` on callers it passed through), attaches `error.trace` and `error.receipt`, and appends a `status: 'failed'` receipt to `runs()`. A failed receipt keeps the verdicts of checks that finished before the throw.

## Receipts

`{ runId, contract, tick, seed, fill, inputs (hashes), inputValues, status, outputs, calls, randomDraws, impure, verdicts, trace }`. `replay(receipt, { maxCalls? })` re-executes with the cache off, compares outputs and trace, and does not append to `runs()`. A cache-heavy run may need a higher `maxCalls` to replay.

## Addressing (v0.3)

`world.node(runId, callId)` returns a recorded trace node (or `null`); it is indexed per run (v0.4). `world.ref(runId, callId, port)` returns that output as a Ref; passing it into a later run records `{ kind: 'run', run, from }`.

## Examples

Contract and implementation examples are `{ name?, in, out?, fill?, seed?, ticks?, each?, trajectory?, startTick?, tick? }`. A `name` (v0.6) labels the proof. A failing trajectory tick ends with `(inputs …)`.
- `ticks` (tick contracts only) drives that many ticks and compares the final outputs.
- `each` (v0.5) is an array of extra inputs, one per tick, and sets the tick count if `ticks` is absent.
- `trajectory` (v0.5) is an array of expected outputs, one per tick. Each entry names only the ports it checks, and each tick is checked; a miss reports `tick k: expected … got …`.
- `tick` (v0.5) runs a calculation at that tick, for implementations that read `ctx.tick()`. `prove(contract, impl?)` runs the contract's examples (labelled `0, 1, …`) and the implementation's own (labelled `impl:0, …`).

## Trace node

`{ id, kind, contract, slot, impl, version, in: {port: {hash, from}}, out: {port: {hash, from}}, calls, cached, cachedFrom?, verdicts? (cache hits), tick? (nodes a drive created), decisions? (also carried by cache hits, v0.4), drives?, impure?, error? }`. `from` kinds add `test` (v0.4; `op: 'else'` with `steps` in v0.5). Literal operands keep their value (v0.5).

`from` kinds: `input` (`call: 0` means the run's caller), `call`, `at`, `gather` (`pieces: [{path, from}]`), `run` (cross-run), `literal`, `computed`, `cached` (on outputs of a cache hit).

## Views

`traceToSvg(trace, world.part, { title, maxDepth, valueChars, groupOver, expand })`. v0.3 draws ◇ decision rows with amber edges from the output that decided them, `@k` on drive-created nodes, grouped pieces (`pieces ×8`) when a gather or concat has more than `groupOver` pieces, a cached-verdict row on cache hits, and with `expand: (n) => world.node(n.cachedFrom.run, n.cachedFrom.call)` the original subtree of a cache hit as faded ghost boxes. Rows wrap inside their box. Pass `receipt` to print the run's fill under the title: `key → impl @ #ids`, or `(not consulted)`.

v0.6:
- `else(a, b)` prints its steps, with the causes drawn as edges;
- one line per cached verdict;
- collected pieces name their tick (`gather[2]←@2`);
- the precedence rung shows on the implementation line (`by pin pick#model`), or as a `⚑` row when the line is full;
- every edge in a gutter has its own lane (the `gap` option, default 54 px).

v0.5:
- an `at` into a gathered value draws only the pieces it selects, labelled with their path;
- long expressions and errors break across lines;
- test expressions show short operand values (`lt($in.x=3, 0)`).

v0.4 additions:
- decision rows print test expressions (`lt($in.x, 0)`) with amber edges from every operand;
- identical decisions merge into one row;
- `⟳` rows show drives;
- headers and titles stay inside the box;
- a cached check keeps its colour under the hatch;
- cross-run tags name the call (`← run 3 #5`);
- labels read target ← source (`gather[log][0]←[log][0]`);
- cached verdicts name their check;
- `driveToSvg` shows `cached ← run r` and ✓/✗ counts per tick., `driveToSvg(receipts, world.part, { title, describe })`, `traceHtml([svg, ...])`. Output provenance is drawn as purple brackets in the right gutter. Screenshot with `python3 verify/shoot.py <abs.html> <abs.png> [width]`.

## Sum and evaluate (seq 62, proposed on branch claude/pxc-kernel-sum)

`world.sum(contractId, inputs, { fill?, … })` runs every implementation of the contract, each pinned by a fill so each has its own receipt and cache entries, and returns `{ polynomial, terms: [{ impl, monomial, outputs, receipt } | { impl, monomial: null, error, receipt }], receipt: { kind: 'sum', contract, polynomial, terms } }`. A term's monomial is its implementation followed by every implementation its trace called (cache hits are read through the node they came from, so the polynomial is the same cached or not). Inputs are shared by every term and factor out. A way that throws contributes no term.

`world.evaluate(polynomial, semiring, valuation)` maps the polynomial into one of Capability Lab's semirings: `boolean` (can it), `counting` (how many ways), `tropical` (cheapest; weights are costs), `viterbi` (most reliable; weights in [0, 1]), `lineage` (which inputs; labels). `valuation` maps a variable to `true`, `{ weight }` or `{ labels }`; an unnamed variable is the semiring's zero, so leaving a variable out is deleting it. It returns `{ value, terms }` and runs nothing in the world. The algebra is the Lab's (`src/lab/`, byte-identical, `src/lab/PIN.json`). `ctx.sum` inside an implementation is not here yet.

## Still not in the kernel (deliberately)

Demand / `request(n)`, async completion, a fitted-model kind (use an `x-role` annotation; a second entry using it promotes it), objectives on contracts, named shared schemas, implementation parameters, slices, a clock binding for compositions, nested clocks, graded checks, collect with initial state or a count Ref, a tick segment in paths, filters over arrays, looping compositions. Merging identical decisions in the record was declined (seq 51). Each has one requesting entry so far. If your migration shows a second real need for one, record it in FRICTION.md.
