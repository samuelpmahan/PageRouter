# E2302 H2 — source-only probe proposal

## Boundaries

- Repository read target: `/workspace/scratch/8528bb251845/PageRouter` at local HEAD `86301f84a9b08f40b76de9b64026befe6b0081a5`, tree `c685c5267235fc460c4147592a483dd40d44d3fd`.
- This package is only prospective/source-read work until root separately authorizes execution. Do not run this script, import HH modules, run tests, render outside the script, or use a browser before that authorization.
- If later authorized, run only `probe.mjs` once with Node from the repo checkpoint root. It uses a fresh synthetic fixture provider, in-memory storage, public controller, and `renderPublicSite` emitted tree. No source, Git, real account, external email, backend, real provider, browser DOM, native keyboard, or visual claims.

## Hypothesis and falsifier

Hypothesis: the existing directory empty-result path may be hard to recover from in the local integration even though isolated tests cover empty guidance and controller searches. The bounded falsifier is a single controller/render-tree sequence: submit a unique synthetic no-match query; verify explicit empty guidance and retained query; submit a known seeded teacher query; verify the expected teacher card/link replaces the empty result without changing provider service-call counts after initialization.

If the known-teacher query recovers and the form query projection updates, this does not support a product defect. Existing tests already cover directory filtering, no-match, restoring remembered filters, rendered no-results, and retry/error status, so do not infer a feature request from this characterization.

Independent emitted-tree observation: render closed/open public navigation from the controller. Record only the toggle's literal text/tag/explicit attrs and controlled navigation's explicit label/hidden state. Source has `aria-expanded`, `aria-controls`, a labelled target nav, and literal `☰` text but no explicit `aria-label` on the toggle. This can support only a source-level naming question; it cannot establish computed accessible name, keyboard activation, visible focus, responsive visibility, or user reachability. A real accessibility claim needs separately authorized mounted-browser/assistive-tech evidence.

## Predeclared flow

1. Construct an isolated in-memory Storage-like object and wrap every provider service with a call counter; use only the fixture provider (`fixture: true`) and runtime.
2. Initialize controller directly on `#/find-teachers`; retain initial provider-call counts and emit current directory tree.
3. Submit `__hh17_no_synthetic_match__` via `public:directory-search`; capture result status, rendered guidance/status/query, and provider-call counts.
4. Submit `Jordan`, a seeded fixture teacher; capture loaded match IDs, rendered card/profile link, query projection, and provider-call counts. The expected falsifier is one `demo-jordan` result and empty guidance absent.
5. Dispatch `public:toggle-nav` twice, capturing closed and open emitted tree fields for `hh-public-nav-toggle` and `hh-mobile-nav`; report only literal emitted fields.
6. Emit one JSON record. No retry, reset, cross-route sequence, storage restore, password, provider mutation, or unrelated journey is exercised.

## Evidence limits

Controller dispatch is an explicit event-level proxy, not mounted form submission; no native `FormData`/`reportValidity`, DOM, browser keyboard or screen-reader behavior is executed. Provider invocation counts include the initialization window baseline and are not claims about runtime snapshot calls. `runtime.snapshot()` is synchronous projection, not a provider service call. The name/status of the toggle are reported as renderer source attributes only.
