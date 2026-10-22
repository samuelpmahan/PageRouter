# E2701 H1 baseline probe

Source pin: PageRouter commit `0d52cde4f2a502b6ee0d4b188bfc3b10c376daa4`, tree `8e8b71932d59f13be4b3dd92bc9c7cd8f91b9d51`.
Source SHA-256 pins are in `source-pins.json`.

The exact controller, community service, renderer and public-site tree were run with an in-memory fixture provider and volatile `Map`-backed forum storage. The flow selected Teacher, opened `/create-post`, used the form field names/payload and controller calls mirrored from `app.mjs`, submitted whitespace-only title/body, inspected the emitted tree/status, then corrected and explicitly retried.

The invalid attempt used a whitespace-only title with a meaningful nonempty body, so it passed native `required`'s non-trimming semantics but was rejected by `createCommunity` after trimming. It returned `title_and_body_required`; visible status became “title and body required”; thread count stayed 3 and forum storage was unchanged. The emitted compose tree still contained the form but no values for title, category or content, including the valid body. `updateDraft` returned false for all three names. Correcting only the title and explicitly retrying created `topic-local-1`, added exactly one thread and opened its detail route. Fixture-service receipt delta: 0.

This confirms a lost-draft behavior in the source/controller/renderer flow, not a browser-native run. Playwright lacked a browser binary; the connected extension was unavailable. A local server was briefly started on `127.0.0.1:4188`; the cloud browser returned `ERR_CONNECTION_REFUSED`, and that exact server process was stopped. No alternative route or bypass was used. No repo files, tests, Git state, accounts or external services were changed. The first probe's harness-only assertion-format mismatch and passing rerun are retained as raw captures.

Run: `node /workspace/scratch/afc0d51965a8/hh21/H1/E2701/probe.mjs` (exit 0; raw streams: `stdout.raw`, `stderr.raw`).

The passing run was captured between `2026-10-19T08:47:22Z` and `2026-10-19T08:47:33Z`; exact exit is 0. `stderr.raw` is empty. `attempt1.stderr.raw` is a harness-only status-string assertion mismatch (underscore code versus human-readable spaces), not a product failure; the rerun asserts the emitted human-readable status.

Proposed bounded change/test shape for a later packet (not implemented): keep input typing DOM-local so it does not rerender each keystroke or introduce focus loss. On rejected `forum-topic`, retain bounded `title/category/content` as a teacher-only submit draft, render those values back on the next compose render, and clear on accepted create/reset/role leave. Add renderer coverage for value projection and controller coverage for invalid-submit retention, unchanged storage/thread count, corrected explicit retry clearing draft + creating once, and role/reset cleanup. Do not add live-keystroke wiring; do not claim browser-level coverage from this probe.
