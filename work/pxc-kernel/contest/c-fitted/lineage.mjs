// Questions about fitted models, answered from traces and receipts. Round 2 (kernel v0.2): a model Ref carried into
// another run arrives as from {kind:'run', run, from}, so the producing fit is found by FOLLOWING EDGES, not by scanning.
// Only a model that arrives as a plain value (loaded from storage, typed in) still needs the hash scan at the bottom.
// Round 3 (kernel v0.3): edges are followed with world.node(run, call) instead of finding a run in world.runs(), and
// fieldOrigins reads a cache hit's gather pieces from the original node (node.cachedFrom) instead of giving up on `cached`.
// Nothing here changes the kernel; it only reads trace nodes ({id, contract, in, out, calls}).
// Round 4 (kernel v0.4): fits, applies and row selections are found by the 'x-role' annotation on their ports ('model',
// 'data', 'rows', 'selection') read from world.contracts(), not by contract name; k-means (a fit that contains a drive) and
// the regression targets are covered by the same tables. trainOnly is tri-state: true, false, or null when no fit was
// recognised (an unannotated pair is invisible, and 'nothing found' is not 'clean'). decisionsOf reads node.decisions,
// which now carry the relation (eq, gt, ...) with its operands, and node.drives for the drive row.

export function walk(trace, fn) { fn(trace); for (const c of trace.calls) walk(c, fn); }

export function index(trace) { const m = new Map(); walk(trace, (n) => m.set(n.id, n)); return m; }

/** Follow `at` projections down to the origin of a value. */
export function origin(from) {
  let f = from; const path = [];
  while (f && f.kind === 'at') { path.unshift(...f.path); f = f.of; }
  return { ...f, path };
}

/** Which call produced the value on `port` of `node`? { node, port, path } or { origin: kind } when it came from outside. (same-run only) */
export function producerOf(node, port, byId) {
  const o = origin(node.in[port].from);
  if (o.kind === 'call' && byId.has(o.call)) return { node: byId.get(o.call), port: o.port, path: o.path };
  return { origin: o.kind, call: o.call, port: o.port };
}

const runTrace = (world, run) => world?.node(run, 1) ?? null; // call 1 is a run's root node

/**
 * Round 4 (kernel v0.4): lineage reads port annotations instead of matching contract names. A port schema may carry
 * `'x-role'`: 'model' (holds a fitted model), 'data' (rows a fit learns from, or an apply passes through), 'rows' (row indices),
 * 'selection' (a subset of data picked by rows). roles(world) turns world.contracts() into the tables below.
 *   fit      = a contract with an `x-role: model` OUT port           (it makes a model)
 *   apply    = a contract with an `x-role: model` IN port, no model out
 *   training = the `x-role: data` IN ports of a fit                  (what it learns from)
 *   through  = an apply's `data` out port, with its `data` in port   (data transformed by a model)
 *   select   = a contract with an `x-role: selection` out port       (its `rows` in port says which rows)
 * A contract without the annotations is invisible to every function below, which is why trainOnly answers null (unknown),
 * not true, when it found no fit at all.
 */
export function roles(world) {
  const by = (ports, role) => Object.entries(ports).filter(([, sc]) => sc?.['x-role'] === role).map(([k]) => k);
  const fit = new Map(); const apply = new Map(); const select = new Map();
  for (const c of world.contracts()) {
    const modelOut = by(c.out, 'model'); const modelIn = by(c.in, 'model');
    if (modelOut.length) fit.set(c.id, { modelOut, training: by(c.in, 'data') });
    else if (modelIn.length) apply.set(c.id, { modelIn, dataIn: by(c.in, 'data')[0] ?? null, dataOut: by(c.out, 'data')[0] ?? null });
    const sel = by(c.out, 'selection');
    if (sel.length) select.set(c.id, { out: sel, rows: by(c.in, 'rows')[0] ?? null });
  }
  return { fit, apply, select };
}

/** Lineage functions bound to a world (they need the world for roles, and for cross-run edges through world.node). */
export function lineageFor(world) {
  const R = roles(world);
  const isFit = (n) => R.fit.has(n.contract);

  /**
   * Follow a value's provenance back to the fit call that made it, across `input`, `call`, `at`, and cross-run edges.
   * Returns { run, node, port, hops } for the first node whose contract is a fit by role, or { stop: kind, ... } when the chain ends.
   */
  function resolveProducer(trace, from, run = null) {
    let curTrace = trace; let curRun = run; let byId = index(curTrace); let f = from; const hops = [];
    for (let guard = 0; guard < 1000; guard += 1) {
      const o = origin(f);
      if (o.kind === 'run') {
        hops.push({ via: 'run', run: o.run });
        const t = runTrace(world, o.run);
        if (!t) return { stop: 'run-not-held', run: o.run, hops };
        curTrace = t; curRun = o.run; byId = index(t); f = o.from; continue;
      }
      if (o.kind === 'call') {
        const node = byId.get(o.call);
        if (!node) return { stop: 'call-missing', call: o.call, hops };
        if (isFit(node)) return { run: curRun, node, port: o.port, hops };
        const next = node.out[o.port]?.from;
        if (!next || next.kind === 'cached' || next.kind === 'computed' || next.kind === 'literal') return { stop: next?.kind ?? 'none', node, port: o.port, hops };
        if (next.kind === 'gather') return { stop: 'gather', node, port: o.port, hops };
        f = next; continue;
      }
      if (o.kind === 'input') {
        if (o.call === 0) return { stop: 'root-input', port: o.port, run: curRun, hops };
        const node = byId.get(o.call);
        f = node.in[o.port].from; continue;
      }
      return { stop: o.kind, hops };
    }
    return { stop: 'loop', hops };
  }

  /** For every apply call in a trace (by role): which fit call made the model it received. fitRun is null when the fit is in this trace. */
  function fitApplyPairs(trace, run = null) {
    const pairs = [];
    walk(trace, (n) => {
      const ap = R.apply.get(n.contract);
      if (!ap) return;
      const port = ap.modelIn[0];
      const p = resolveProducer(trace, n.in[port].from, run);
      pairs.push({ apply: n.id, applyContract: n.contract, slot: n.slot ?? null, modelHash: n.in[port].hash,
        fit: p.node ? p.node.id : null, fitContract: p.node ? p.node.contract : null, fitCached: p.node ? p.node.cached : null,
        fitRun: p.node ? (p.run === run ? null : p.run) : null, fitInputs: p.node ? Object.fromEntries(Object.entries(p.node.in).map(([k, v]) => [k, v.hash])) : null,
        origin: p.node ? 'call' : p.stop, crossRun: p.hops.some((h) => h.via === 'run') });
    });
    return pairs;
  }

  /**
   * For every fit call (by role): which port of which call selected the rows each of its `data` ports was trained on?
   * Walks back through data passed through an apply (by role) and through selections (by role) to the rows port of the select.
   * rowsFrom is e.g. 'fitted.split.byGroup.trainRows', or 'none: all rows (input)' when a data port read an unselected input.
   * Ports that trace to the same source are reported once.
   */
  function trainingRows(trace) {
    const byId = index(trace); const out = [];
    const back = (node, port) => {
      const p = producerOf(node, port, byId);
      if (!p.node) return 'none: all rows (' + p.origin + ')';
      const sel = R.select.get(p.node.contract);
      if (sel && sel.out.includes(p.port)) {
        const r = producerOf(p.node, sel.rows, byId);
        return r.node ? `${r.node.contract}.${r.port}` : `none (${r.origin})`;
      }
      const ap = R.apply.get(p.node.contract);
      if (ap && ap.dataOut === p.port && ap.dataIn) return back(p.node, ap.dataIn);
      return `unknown producer ${p.node.contract}`;
    };
    walk(trace, (n) => {
      const f = R.fit.get(n.contract);
      if (!f) return;
      const from = [...new Set(f.training.map((port) => back(n, port)))];
      out.push({ fit: n.id, contract: n.contract, rowsFrom: from.join(' + ') });
    });
    return out;
  }

  /** true: every recognised fit read train rows only. false: one did not. null: no fit was recognised, nothing was audited. */
  function trainOnly(trace) {
    const rows = trainingRows(trace);
    if (rows.length === 0) return null;
    return rows.every((r) => r.rowsFrom.split(' + ').every((x) => x.endsWith('.trainRows')));
  }

  /** Staleness through an edge: was the model that `apply` received fitted on exactly these input Parts? */
  function stalenessOfApply(applyTrace, currentInputs, run = null) {
    const port = R.apply.get(applyTrace.contract).modelIn[0];
    const p = resolveProducer(applyTrace, applyTrace.in[port].from, run);
    if (!p.node) return { known: false, stop: p.stop };
    const differs = Object.keys(currentInputs).filter((k) => p.node.in[k]?.hash !== currentInputs[k]);
    return { known: true, fitRun: p.run, fitCall: p.node.id, differs, fresh: differs.length === 0 };
  }

  /** Scan fallback: every fit call, in any run, that emitted a model with this hash. Needed ONLY for a model that arrived as a plain value. */
  function producersAcrossRuns(hash) {
    const found = [];
    for (const run of world.runs()) {
      walk(run.trace, (n) => {
        const f = R.fit.get(n.contract);
        if (f && f.modelOut.some((port) => n.out[port]?.hash === hash)) {
          found.push({ run: run.runId, call: n.id, contract: n.contract, impl: n.impl, cached: n.cached, inputs: Object.fromEntries(Object.entries(n.in).map(([p, v]) => [p, v.hash])) });
        }
      });
    }
    return found;
  }

  function staleness(modelHash, currentInputs) {
    const verdicts = producersAcrossRuns(modelHash).map((p) => ({ ...p, differs: Object.keys(currentInputs).filter((k) => p.inputs[k] !== currentInputs[k]) }));
    return { producers: verdicts, known: verdicts.length > 0, fresh: verdicts.some((v) => v.differs.length === 0) };
  }

  return { roles: R, resolveProducer, fitApplyPairs, trainingRows, trainOnly, stalenessOfApply, producersAcrossRuns, staleness };
}

/**
 * Which call made each field of a gathered model? [{ path, kind, call, contract, port, within }] from the gather pieces on the
 * output of `node`. A gather inside a gather is NOT flattened by the kernel (the inner one arrives as one piece with kind 'gather'),
 * so this expands it recursively and prefixes the path.
 */
export function fieldOrigins(trace, node, port = 'model', world = null) {
  let owner = trace;
  // a cache hit's output provenance is `cached`; the original node (world.node via cachedFrom) still holds the gather pieces
  if (world && node.cached && node.cachedFrom && node.out[port].from.kind === 'cached') {
    const { run, call } = node.cachedFrom;
    const orig = world.node(run, call);
    if (orig) { node = orig; owner = runTrace(world, run) ?? trace; } // call ids in the pieces belong to the original run
  }
  const byId = index(owner);
  const expand = (from, prefix) => {
    if (from.kind !== 'gather') return [{ path: prefix, kind: from.kind }];
    return from.pieces.flatMap((pc) => {
      const o = origin(pc.from);
      if (o.kind === 'gather') return expand(o, [...prefix, ...pc.path]);
      const src = o.kind === 'call' ? byId.get(o.call) : null;
      return [{ path: [...prefix, ...pc.path], kind: o.kind, call: o.call ?? null, contract: src?.contract ?? null, port: o.port ?? null, within: o.path }];
    });
  };
  return expand(node.out[port].from, []);
}

/** Every decision recorded in a trace, with the node it sits on: [{ call, contract, tick, label, value, ran, skipped, fromCall }]. */
export function decisionsOf(trace) {
  const out = [];
  walk(trace, (n) => { for (const d of n.decisions ?? []) out.push({ call: n.id, contract: n.contract, tick: n.tick ?? null, label: d.label, value: d.value, ran: d.ran ?? null, skipped: d.skipped ?? null, fromCall: d.from.kind === 'call' ? d.from.call : d.from.kind }); });
  return out;
}
