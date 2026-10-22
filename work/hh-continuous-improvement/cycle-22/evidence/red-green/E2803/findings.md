# E2803 H1 implementation checkpoint — teacher reply draft recovery

Baseline source: PageRouter `c4c4ce782fc2669a5c73dcd2a98572e430344124`, tree `975886bebb6c7bf0d0eda6311606ee75684d30da`. The H2 independent valid-body cap rejection evidence is at `/workspace/scratch/86659bbafcce/hh22/H2/E2802/volatile-stdout.raw` and `/workspace/scratch/86659bbafcce/hh22/H2/E2802/cap.stdout.raw`. E2801 independently observed whitespace `reply_required` loss. Exact before/after source pins are in `source-pins.json`.

## Written in

Only the authorized files changed:

- `checkpoint/vendor/hh/src/public-controller.mjs`
- `checkpoint/vendor/hh/src/community.mjs`
- `checkpoint/vendor/hh/src/public-controller.test.mjs`

No implementation was run before root reviewed the source/test diff and the authoritative RED. No build, browser, server, Git stage, or commit was run.

## Actual runtime flow

1. Existing `app.mjs` remains unchanged: it runs `reportValidity()`, reads `FormData`, and dispatches `forum-reply` with the current form's `data-thread-id` and `content`. No keystroke rerender or app event wiring was added.
2. `public-controller.mjs` calls the unchanged `community.reply` first. Its service still owns teacher authorization, thread accessibility, trim/body validation, limits, persistence, and success/failure.
3. Only teacher semantic rejections `reply_required`, `input_too_long`, and `reply_limit_reached` retain one in-memory `{threadId, content}` draft. On success, the matching draft clears; a non-retainable same-thread failure clears stale content. `refreshCommunity()` preserves the draft in controller state.
4. The draft bounder retains ordinary submissions as provided, capped at `COMMUNITY_LIMITS.body + 1`. If an over-limit raw string is longer than that, outer whitespace is removed before the one-over bound. Thus a padded string whose trimmed body is still too long remains over limit after projection/resubmission instead of becoming an accepted truncated body.
5. `community.mjs` renders the retained body only when the visible session role is `teacher` and the composer thread ID matches the stored `threadId`.
6. `navigate()` preserves a same-thread route/alias draft and clears it when leaving or changing thread. Teacher-role exit (including successful logout), forum reset, and successful app reset also clear it. Anon/moderator submissions do not retain body content.
7. Correction is still an explicit submit: an accepted reply is created once by the service, then the matching draft is cleared and the composer rerenders empty.

## RED / GREEN evidence

Authoritative exact-name RED: exit 1; four focused tests failed on missing reply-draft state/projection. Raw stdout/stderr and the exact command are preserved at `red.stdout.raw`, `red.stderr.raw`, and `red-command.txt`. An earlier broad-pattern run's output was truncated, and an intermediate exact raw was later replaced by the final exact-name capture; the first attempts are not represented as complete raw captures. The lifecycle test was corrected before authoritative RED to use a real over-limit rejection, not an invalid expectation that an ordinary valid reply should fail.

Per root review, a whitespace-padded 10,001-trimmed-character test was added after the authoritative RED to guard against truncation into acceptance. No baseline RED is claimed for that newly added subcase; its first execution is part of the focused GREEN and HH source suite.

- Focused exact four tests: 4/4 pass, exit 0.
- HH source suite (`community.test.mjs`, `public-controller.test.mjs`, `public-site.test.mjs`): 102/102 pass, exit 0.
- Both raw stdout/stderr streams and hashes, argv, working directory, bounded UTC timing windows, and exits are in `run-metadata.json`.
- `git diff --check` passed after the source edit; diff remains limited to the three assigned files. Existing `hh-cycle13/` and `hh-cycle15/` untracked files were not modified; their exact initial copy/modes are preserved under E2801 `initial-worktree/`.

No broader build, canonical package, external service, browser, account, email, network, stage, or commit claim is made. Root requested stopping after the focused and relevant HH source suite; implementation is now paused for the next native assignment/review.
