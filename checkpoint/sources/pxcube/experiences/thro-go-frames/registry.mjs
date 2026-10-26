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
// Results are memoised by (capability, input): the same input always gives the same result and the same receipt, so a Case that changes one video
// only pays for the numbers that really changed. Callers must treat the returned objects as read-only.
const memo = new Map();
export function exec(id, input) {
  const key = `${id}|${JSON.stringify(input)}`;
  let hit = memo.get(key);
  if (!hit) {
    const r = registry.execute(id, input);
    hit = { out: r.result, receipt: { capability: id, inputHash: r.replay.inputHash, resultHash: r.replay.resultHash, calls: flatten(r.trace) } };
    memo.set(key, hit);
  }
  return hit;
}
export const execMemoSize = () => memo.size;
export const capabilityCount = () => registry.list().length;
