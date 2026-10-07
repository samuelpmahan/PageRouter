# Persistent NTC console evidence

The control layer now remains visible around Experience frames. The domain
sources and generated BuildBag scaffold are unchanged in this increment.

- `browser-results.json`: seven groups of checks against the real five-Experience
  preview, including actual work/manifest/build values, live owner inspection,
  exact iframe identity, draft retention, narrow layout, and a newer-build offer
  that does not change the current artifact.
- `fixture-browser-results.json`: the same seven groups pass after generating
  BuildBag in an empty temporary workspace and running the shared build/serve
  program. This is the mode wired into GitHub Actions before deployment build.
- `launcher-regression/` and `studio-regression/`: the original browser checks
  exercised under the new shell against local and Pages-style URL paths.
- `unit.txt`: the Node suite, including negative packaging fixtures and retained
  attempts. Failed fixture builds in that log are intentional assertions.
- `../../design-qa.md`: visual comparison and the status-label fix; final result
  passed. Images remain local and are ignored by Git.

The shell embeds a retained work/manifest/build snapshot. It reads mount lists
from the APIs of frames actually opened by the user. Full owner values are read
on explicit inspection, and never copied into a second domain store. Packaged
resources are not counted as opened runtimes.

The remote Actions workflow has been updated, but has not been run remotely.
