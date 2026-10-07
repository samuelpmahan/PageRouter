# Executable capability ladder flow

`src/atlas-view.mjs` keeps the existing Atlas session and a separate capability protocol as owning controllers across DOM mounts. A pure helper creates the original six-node motion/Beta/Boolean definition and literal seeds. It supplies editor data without running composition.

Explicit actions are:

1. Parse the definition text into a Part.
2. Validate JSON source structure, fixed known Calculations and DAG wiring using the retained Parse Part.
3. Interpret the retained Validate Part into a deterministic bound plan.
4. Execute the retained Interpret Part in the existing domain runtime.

Run ladder invokes the protocol's composed action, retains the actual reached rung Parts and parent Part, and uses the same execution machinery. Replay passes the retained interpreted handle to Execute. Success reports domain algorithm bodies and cache hits separately; full inspection also reports protocol bodies and kernel receipts. Failure Parts are inspectable and downloadable, and downstream UI actions remain disabled.

Definition edits invalidate displayed rung/result handles but retain draft and protocol cache. Repeating a rung invalidates descendants. Reset clears only ladder protocol/domain state and retains draft. Nothing runs on mount, remount, inspection, sample load, edit or download. Draft/pending work/results survive route navigation within the same page. Browser reload starts a new local controller.

Downloads are editable raw definition text, latest success/failure Part and complete inspection. Downloaded Part copies are inert evidence; the controller uses only returned authentic handles for stage authority. The language stays a fixed Atlas recipe registry; user-defined contract semantics remain unspecified.

`npm test` includes lifecycle, invalidation, escaping, guard and authentic replay checks. After assembly `npm run test:ladder:browser` checks staged/composed execution, replay, fresh definition reconstruction, changed-policy cache reuse, JSON/DAG failures, exports, navigation and narrow mobile layouts. `node --test scripts/atlas-built-imports.test.mjs` verifies built runtime closure and exact source hashes.
