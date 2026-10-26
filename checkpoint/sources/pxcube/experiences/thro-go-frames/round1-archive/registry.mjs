// One registry: the Capability Lab statistics capabilities + thro's + thro-go's. Every number in the pipeline comes through exec().
import { createRegistry } from './vendor/capability-lab/src/runtime/index.mjs';
import { capabilities as statistics } from './vendor/capability-lab/src/statistics/index.mjs';
import { capabilities as thro } from './thro-capabilities/index.mjs';
import { capabilities as go } from './thro-capabilities/go.mjs';

export const registry = createRegistry([...statistics, ...thro, ...go], { source: 'thro-go-frames', version: '1' });

function flatten(trace, depth = 0, out = []) {
  out.push({ id: trace.id, depth, inputHash: trace.inputHash, resultHash: trace.resultHash });
  for (const c of trace.calls) flatten(c, depth + 1, out);
  return out;
}
// Execute a registered capability; returns its result plus a compact receipt (ids and hashes of the whole call tree).
export function exec(id, input) {
  const r = registry.execute(id, input);
  return { out: r.result, receipt: { capability: id, inputHash: r.replay.inputHash, resultHash: r.replay.resultHash, calls: flatten(r.trace) } };
}
export const capabilityCount = () => registry.list().length;
