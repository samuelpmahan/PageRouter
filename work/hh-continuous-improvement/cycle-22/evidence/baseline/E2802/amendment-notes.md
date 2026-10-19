# E2802 evidence amendment

These are source captures made after the original executions, not reruns. `volatile-probe.mjs.txt` and `focused-probe.mjs.txt` copy the exact JavaScript `-e` bodies from the executed calls; `probe-cap.mjs` is the separately saved, actually executed capacity probe.

Exact recorded invocations:

- Inline capacity setup: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --input-type=module -e <contents of volatile-probe.mjs.txt>`; exit 0; stdout/stderr: `volatile-stdout.raw` / `volatile-stderr.raw`. The shell-captured inline argument is represented byte-for-byte in the inert source capture. This was the first valid-body cap probe; later formalized as `probe-cap.mjs`.
- Whitespace/correction secondary check: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --input-type=module -e <contents of focused-probe.mjs.txt>`; exit 0; stdout/stderr: `focused-stdout.raw` / `focused-stderr.raw`.
- Saved formal cap check: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node /workspace/scratch/86659bbafcce/hh22/H2/E2802/probe-cap.mjs`; exit 0; stdout/stderr: `cap.stdout.raw` / `cap.stderr.raw`.

The primary evidence is the formal cap run: seed replies 2 plus 498 synthetic setup replies reach the declared cap 500; the valid 79-character reply receives `reply_limit_reached`, total remains 500 (zero new replies), the thread-detail route still renders the separate `forum-reply` form with an empty textarea, storage status is `memory_only`, and runtime account-service receipt count is 2 before and after. No browser, server, network, email, account, or production service was used.

Formal cap raw hashes: probe script `4eae77372e07e1d1feade1244e3f31a1c75307ea98dc8c1c1d88dfcf63573ad7`; stdout `9adadf2a2f1cef44a36703740d15f495f0a62f7e891092a1f5a34160c39bd4b3`; stderr is empty (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`); exit file `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`. Inline-source captures: volatile `75919cad7a4ad8d23ca2942cefeea913c7c4109e821b4e2d5444a0a029aa62ab`; focused `a2e23fdbbac9a6befa369d4140920830a16a9133e91cdbfc885311fc9c1188b2`.
