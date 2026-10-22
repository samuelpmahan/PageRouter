# E3403 implementation evidence

## Baseline

Repository `/workspace/scratch/86659bbafcce/PageRouter` starts at commit
`6e58a206bb30deb967f81cfe6214d6ffb581a84b`, tree
`0446ad99d770c61f99ddb1acf8ec53534875dcf1`. Product ownership is limited to
`checkpoint/vendor/hh/src/public-site.mjs`,
`checkpoint/vendor/hh/src/public-controller.mjs`, and
`checkpoint/vendor/hh/src/public-controller.test.mjs` (plus
`public-site.test.mjs` if a pure render test is needed).

## Intended checks

1. Add a fixture-backed test for rendered school-lookup recovery, distinct retry
   ownership when directory and school failures coexist, invalidation, and
   recovered error cleanup.
2. Run only the newly named tests against pre-fix source and preserve the exact
   RED command, timestamps, stdout, stderr, and exit status.
3. Implement the named school-lookup retry action and render gate, leaving the
   generic retry and registration button behavior unchanged.
4. Send the actual code-flow checkpoint to the lead; do not run a post-change
   test until acknowledged.
5. After acknowledgment, run one focused GREEN and one complete HH source test
   suite; preserve each raw run and report exact pass/fail counts.

No build/package/stage/commit/publication is in scope for this worker turn.
