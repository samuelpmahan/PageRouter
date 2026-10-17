const OBSERVER_IMPORT = "import { observeLabRun } from '../references/operations/lab-bridge.mjs';";

const EXECUTE_BODY = `function execute() {
  if (!selectedId) return;
  try { const input = parseInput(); const output = registry.execute(selectedId, input); renderExecution(output); }
  catch (error) { fail(error); }
}`;

const REPLAY_BODY = `function replay() {
  if (!lastReceipt) return;
  try { const report = registry.replay(lastReceipt); lastReplay = report; renderExecution(report.receipt, {replay:true}); els.runStatus.textContent = report.matches ? 'Replay matches prior result' : \`Replay differs: \${(report.mismatches||[]).join(', ') || 'unreported mismatch'}; exact=\${report.exact}, hash=\${report.hash}\`; els.runStatus.className = \`run-status \${report.matches ? 'success' : 'error'}\`; if(!report.matches){els.executionBadge.className='execution-badge error';els.executionBadge.textContent='Replay differs';} }
  catch (error) { fail(error); }
}`;

const INSTRUMENTED_EXECUTE_BODY = `function execute() {
  if (!selectedId) return;
  try { const output = observeLabRun({ action: 'execute', id: selectedId, run: () => { const input = parseInput(); return registry.execute(selectedId, input); } }); renderExecution(output); }
  catch (error) { fail(error); }
}`;

const INSTRUMENTED_REPLAY_BODY = `function replay() {
  if (!lastReceipt) return;
  try { const prior = lastReceipt; const report = observeLabRun({ action: 'replay', id: prior.id, prior, run: () => registry.replay(prior) }); lastReplay = report; renderExecution(report.receipt, {replay:true}); els.runStatus.textContent = report.matches ? 'Replay matches prior result' : \`Replay differs: \${(report.mismatches||[]).join(', ') || 'unreported mismatch'}; exact=\${report.exact}, hash=\${report.hash}\`; els.runStatus.className = \`run-status \${report.matches ? 'success' : 'error'}\`; if(!report.matches){els.executionBadge.className='execution-badge error';els.executionBadge.textContent='Replay differs';} }
  catch (error) { fail(error); }
}`;

function replaceExactlyOnce(source, before, after, description) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Capability Lab instrumentation stopped: expected exactly one ${description} source pattern.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

/** Instrument the vendored Capability Lab UI source for a compiled build overlay. */
export function instrumentLabApp(source) {
  if (typeof source !== 'string') throw new TypeError('instrumentLabApp expects source text');
  if (source.includes(OBSERVER_IMPORT) || source.includes('observeLabRun(')) {
    throw new Error('Capability Lab instrumentation stopped: source is already instrumented.');
  }
  if (!source.includes("import { createRegistry } from '../src/runtime/index.mjs';")) {
    throw new Error('Capability Lab instrumentation stopped: unexpected UI module header.');
  }
  let output = replaceExactlyOnce(source, EXECUTE_BODY, INSTRUMENTED_EXECUTE_BODY, 'execute()');
  output = replaceExactlyOnce(output, REPLAY_BODY, INSTRUMENTED_REPLAY_BODY, 'replay()');
  const importAnchor = "import { createRegistry } from '../src/runtime/index.mjs';";
  output = replaceExactlyOnce(output, importAnchor, `${importAnchor}\n${OBSERVER_IMPORT}`, 'runtime import');
  return output;
}
