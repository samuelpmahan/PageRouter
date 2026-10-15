# Contest round 1: shared brief for every entry

You are implementing one contest entry against the PxC kernel in `/root/pxc-kernel`. The kernel is genuinely new code; read `KERNEL.md`, `src/kernel.mjs`, `src/view.mjs`, and contest A (`contest/a-numeric/index.mjs`, `test/kernel-a.test.mjs`, `verify/render-a.mjs`, `contest/a-numeric/EXPLAIN.md`) before writing anything.

## The point of the contest

The kernel grows only when an implementation needs something it cannot express (an interface), or when two implementations need different shapes at the same boundary (a union-typed interface). Your entry is evidence. A clean workaround that hides a missing concept is worse than an honest friction report.

## Hard rules

1. **Do not edit anything in `src/`, `KERNEL.md`, `ledger/`, `test/kernel-a.test.mjs`, `contest/a-numeric/`, or any other contest's folder.** Other agents are working in parallel. Only write inside your own folders and files listed below.
2. Every computation that belongs to your domain goes through the kernel: contracts, implementations, compositions, `ctx.call`. Do not import one implementation's function directly into another. If you have to, record it as friction.
3. Pass Refs (not `.value`) when forwarding values, so bindings are exact. Use `ctx.at` for pieces of values.
4. Every contract gets at least one example whose expected output you derived independently (by hand or from a definition), never by running your implementation.
5. No dependencies. Node 20+ built-ins only. Synchronous `run`.

## What to deliver (your folder is `contest/<entry>/`)

- `contest/<entry>/index.mjs` exporting `register(world)` (plus anything else your tests need).
- `test/contest-<entry>.test.mjs` (node:test). `cd /root/pxc-kernel && node --test test/*.test.mjs` must pass for everything, including contest A.
- `verify/render-<entry>.mjs` that writes HTML renders into `verify/out/<entry>-*.html` from **real runs** (use `traceToSvg`; add your own domain picture in `contest/<entry>/view.mjs` when a trace alone can't show the claim, e.g. a circuit, a plot, a board).
- Screenshot every render: `python3 verify/shoot.py /root/pxc-kernel/verify/out/<file>.html /root/pxc-kernel/verify/out/<file>.png 1200`, then **look at each PNG with your Read tool**.
- `contest/<entry>/EXPLAIN.md`: a table of numbered claims in the same shape as contest A's. Each claim names the PNG and exactly where to look (box number, row, colour, position), so it can be checked like calling a pool shot. Mark each PASS or FAIL from what you actually saw. If a picture did not show what you expected, say what it showed, then fix the code or the view and re-shoot. Record that history in the claim.
- `contest/<entry>/FRICTION.md`: one section per friction point:
  - **Needed:** what the implementation needed to express.
  - **Kernel today:** what the API offered and why it fell short (quote the line or behaviour).
  - **Workaround:** what you did instead, with file and line.
  - **Proposed shape:** the smallest kernel addition that would remove the workaround (a type or function signature, not prose).
  - **Severity:** blocks / distorts the trace / ergonomic only.
  - **Evidence:** a test name or PNG that shows it.
  Also list what fitted cleanly with no friction. That is evidence too.

## Final message

Reply with: files written; test summary line; a list of claims with PASS/FAIL; the friction points by title and severity; and anything you suspect about the kernel itself (bugs, surprises). Keep it factual and specific.
