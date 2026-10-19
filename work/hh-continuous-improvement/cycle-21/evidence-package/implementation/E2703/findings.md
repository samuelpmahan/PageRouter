# E2703 findings

The public controller now retains the bounded, non-secret title, category, and body draft only when teacher topic creation is rejected. The community renderer projects that draft into both dedicated and inline compose forms. The controller still delegates acceptance to `community.createThread`; a correction requires a fresh explicit submit. One-over-limit inputs remain invalid when resubmitted, rather than becoming accepted through truncation.

The draft stays in volatile controller state, not forum storage or service calls. It clears after successful creation, forum reset, leaving the teacher role, successful logout, or public app reset. No live keystroke state wiring or automatic retry was added.

Tests-first regression cases failed on baseline as expected. All 98 HH source tests pass after the change, and `git diff --check` passes. `npm test` is not green: its seven failures are two missing `fast-check` dependencies, four missing generated `dist/compiled` outputs, and one stale-dist/source equality check. No build, Git mutation, account, email, or network action was performed. The pre-existing `hh-cycle13/` and `hh-cycle15/` untracked paths were left untouched.
