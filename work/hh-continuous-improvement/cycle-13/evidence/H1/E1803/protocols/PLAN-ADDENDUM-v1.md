# E1803 proposal handoff correction

Prepared before the first E1803 test command. Preserve `PLAN.md` unchanged as the original unexecuted proposal.

- Independent H2 evidence reference is `hh-cycle13/H2/E1802/result-v2.json` (not `result.json`).
- The correct focused-test command from `PageRouter/checkpoint` is `node --test --test-name-pattern='login draft' vendor/hh/src/public-controller.test.mjs`; Node options precede the test file.
- The implementation remains limited to the plan's three product paths. Tests must run RED before the controller or renderer is edited.
- The successful `public:reset` draft-cleanup behavior listed in the plan must have an assertion in the success/authority test before implementation.

No product/source/test file has been modified or executed as of this addendum.
