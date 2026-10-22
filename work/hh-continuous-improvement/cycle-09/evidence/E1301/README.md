# E1301 — H1 registration draft integration probe

## Disposition

The proposed stale non-secret draft loss is falsified at the source/controller/render-projection level, and a narrow ephemeral fixture probe reaches the expected mismatch, missing-terms, and valid-control outcomes. The requested mounted-DOM confirmation could not be completed in this environment: the local Playwright package has no browser executable, and the supported cloud browser cannot connect to the local fixture server (`ERR_CONNECTION_REFUSED`). This report therefore does not claim mounted-browser evidence or visual QA. No source or test files were changed.

## Candidate identity

- Repository: `PageRouter`, branch `codex/hh-continuous-improvement`
- HEAD: `46d1f32aca87919abceecf8b0c53454173cd574f`
- Tree: `b80f1408d3c21c23e058989ce79fcfc60a0ba674`
- Main: `7adf7e74a85c4310a5704a4c42808e85a1a82d71`
- Coordinator-provided fresh remote candidate: `220374f7b8fd2818829063fcd4ec045e47e951ee`
- Starting/final worktree status: clean; source identity unchanged.
- `app.mjs` SHA-256: `bde60c7db3393a57c8d1936b149c7ca0181dc90bdb16f846635f4110d6b8a5c3`
- `public-controller.mjs` SHA-256: `8faad923a2e4721f1cc1059f902c54f97759ef32b57d36fe4fa8523205011a0b`
- `public-site.mjs` SHA-256: `96d930a2e6fc8c712dea5a593105071de217069d8f8313c4d531f0c4cf400ef4`
- Cycle spec SHA-256: `92e763723b1ca749f66832b6ec5482e612df1c86cbbf3c5f6ed4a770a62d0e21`

## Source path

`checkpoint/vendor/hh/src/app.mjs` installs a delegated root `input` listener. For each named field it calls `controller.updateDraft(target.name, target.value)`. The controller stores only registration name, email, and phone; password-like names are rejected, and a successful draft update invokes the host's `onChange` render callback. The delegated submit listener validates the form, collects `FormData`, clears password inputs, and dispatches `public:register`. `render()` preserves password values only in a synchronous same-route DOM handoff; they are not controller state.

In `public-controller.mjs`, local mismatch and terms validation each call `notify()` before returning, so the host rerenders from the already-updated non-secret draft. On a valid control the normalized identity is retained while the request reaches the fixture provider. The application form is produced from that identity by `public-site.mjs`.

## Probe record

- Read-only source inspection: `sed`/`rg` over `app.mjs`, `public-controller.mjs`, `public-site.mjs`, the current cycle-08 `README.md`, `POST-REVIEW.md`, and `NEXT.md`.
- Mounted preview attempt: `python3 -m http.server 4189 --directory checkpoint/vendor/hh/src`; Playwright launch failed because its browser executable is absent. Opening the local URL in the supported cloud Chrome failed with `net::ERR_CONNECTION_REFUSED`. No screenshot, DOM observation, or browser acceptance is claimed.
- Ephemeral non-file controller/render-projection probe: `node --input-type=module -e ...` using `createFixtureProvider({fixture:true})`, `createServiceRuntime`, `createPublicController`, and `renderPublicSite`; generated ephemeral password values at runtime; output was restricted to booleans/status, never the values.
- Mismatch control: valid synthetic non-secret name/email/phone and a fixture school; mismatch reached local validation; rendered form projection retained all three non-secret drafts; no password was found in controller state.
- Missing-terms control: same valid non-secret draft and school with matching ephemeral passwords but no accepted terms; local terms validation occurred; rendered form projection retained all three drafts; no password was found in controller state.
- Valid control: matching ephemeral passwords and accepted terms reached `pending`; identity remained in controller state; no password was found in controller state.
- Direct dispatch without prior `updateDraft` was not claimed as mounted evidence. Static source confirms the actual host does call `updateDraft` on input before submission.
- No backend/HTTP calls, production account or data, externally shared content, or browser screenshot was used.

## Adjacent follow-up hypothesis (not a confirmed defect)

A fresh, source-supported UI hypothesis is stale validation feedback: after a mismatched-password submission renders the mismatch message, a user corrects the passwords but unticks the required terms checkbox. `app.mjs` calls `reportValidity()` before dispatch, so the unchecked required checkbox blocks `public:register`; the checkbox `change` event does dispatch `public:terms-consent`, but that handler only updates consent and notifies, while `updateDraft` does not clear the prior outcome. A controller/render-projection probe confirmed the old mismatch text remains visible after consent is unchecked. This is distinct from draft loss and may be intentional coexistence with native browser validation; it needs mounted UI review before any repair.

## Conclusion

The cycle-08 suggestion assumed direct-dispatch semantics without accounting for the mounted host's pre-submit input binding. The actual source path already retains the ordinary draft fields during local validation, so a correction here would repeat existing behavior. The stale-feedback scenario above is the single fresh adjacent hypothesis for a future mounted probe; no defect or correction is established by this read-only cycle.
