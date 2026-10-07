# Adversarial verification plan

This directory is owned by the adversarial tester. These checks are intentionally black-box and must not mutate shared source, commits, or deployments.

## Acceptance matrix

- Snapshot determinism across repeated runs, independent of filesystem enumeration order and timestamps; canonical digest must bind sorted normalized output paths, bytes, executable bits where meaningful, and project/source identity.
- Dependency closure: declared source graph only; missing nodes, cycles, duplicate producers, path aliases, and undeclared edges fail closed. Editing a leaf rebuilds exactly its transitive dependents; unrelated generated outputs remain byte-for-byte reusable.
- Patch integrity: exact baseline digest binding; clean build of target equals patched output tree; addition, deletion, UTF-8, binary/NUL, empty files, and multi-hop patch chains round-trip.
- Validation-before-mutation: wrong base, malformed schema, duplicate operations/paths, traversal/absolute paths, symlink tricks, invalid hashes, and tampered payload all reject while input snapshot remains unchanged.
- Project composition/import: original sample projects and pins survive export/import; route state and project selection persist across refresh/back/forward; import errors leave current project/selection untouched; browser import executes no user HTML script/module.
- Scope evidence: per-project provenance and byte hashes stay attached through compose/export/import; no claim that imported executable content is trusted or sandboxed beyond the actual browser boundary.

## Browser security checklist

Use an ephemeral browser context and synthetic projects only. Exercise a malicious imported HTML file containing script execution markers, inline handlers, module scripts, data URLs, forms, top-navigation attempts, popups, storage writes, and fetch/beacon attempts. Assert none execute in the parent origin, app controls remain responsive, CSP/network policy is effective, and the imported file is rendered/downloaded only as an inert sandboxed leaf. Check route selection, history, hash/base routing, path encodings, and malformed imports at desktop and narrow viewport sizes.

## Executable checks

Run Node-only checks from the workbench root:

```sh
node --test exp/adversarial/*.test.mjs
```

For browser QA, build/assemble `dist` first, then generate a synthetic HH patch that changes only `index.html` to a hostile canary page and run the in-process local server + Playwright script:

```sh
node exp/adversarial/make_hostile_patch.mjs
python3 exp/adversarial/browser_qa.py
```

The browser script uses the bundled local Chromium headless shell, not remote services. It writes JSON results and screenshots under `evidence/`. It validates three real project pins, recovered PageRouter comparison, project history, HH receipts and composition, clean/delta equality, exact-pin execution policy, unknown HTML script/network sandboxing including direct navigation, and mobile overflow.

## Visual session REPL adversarial checks

The supplemental session lane should be tested after the live Calculation adapter arrives:

- Define and run a named Calculation through visible node/stage controls; inspect it as a real function-valued Part and verify its receipts remain separate from source graph/interface metadata
- Change caller input state, run, and verify the selected function receives the live caller port without source editing
- Add a larger stage that reuses the defined Calculation, discover compatible prior outputs, bind one through a visible typed select, and run the nested composition
- Save a session and verify it contains exact implementation pins, node identities/operations, typed input/output ports, bindings, caller parameters, and separate interface data, while receipt/output evidence remains a distinct section
- Import/reopen the exact saved session in a fresh app context, ensure definitions and graph display persist without auto-execution, then run explicitly
- Reject a wrong-pin session and malformed/cyclic/duplicate/credential-bearing definition; assert rejection is atomic and leaves the current Parts, definitions, selection, and last invocation unchanged

Run the visual REPL/session lane on the assembled local candidate:

```sh
python3 exp/adversarial/session_browser_qa.py
```

This opens a fresh in-process static server and an isolated browser context, defines/invokes a named Calculation, rewires a typed prior output, runs a larger graph with the pinned Calculation nested, exports an exact-pin session, reopens it in a fresh tab, and checks wrong-pin/cyclic import rejection. Screenshots and the machine-readable session are written to `evidence/`.

## Justin site IDE adversarial checks

After assembling the IDE and annotation runtime into `dist`, run:

```sh
python3 exp/adversarial/justin_site_ide_qa.py
```

This checks hidden/visible/hidden annotation transitions against the real mapped preview geometry and PxC receipts, page-scoped issue lists, reversible mobile-navigation CSS and contact-destination attribute prototypes, exact-base export with secret/receipt exclusions, mobile shell overflow, acceptance of the previous HH session after an audit-only build, and atomic rejection under the dependency-derived changed implementation pin. Evidence and screenshots go under `evidence/`.
