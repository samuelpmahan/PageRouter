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
// A long numeric array (a retention curve) is keyed by a 64-bit content hash, computed once per array object, instead of by its printed digits.
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer), hashes = new WeakMap();
function arrayHash(arr) {
  let h = hashes.get(arr);
  if (h) return h;
  let a = 2166136261, b = 5381;
  for (const x of arr) { f64[0] = x; a = Math.imul(a ^ u32[0], 16777619); a = Math.imul(a ^ u32[1], 16777619); b = Math.imul(b ^ u32[0], 33) + u32[1] | 0; }
  h = `H${arr.length}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
  hashes.set(arr, h);
  return h;
}
const replacer = (k, v) => (Array.isArray(v) && v.length > 16 && typeof v[0] === 'number' ? arrayHash(v) : v);
export function exec(id, input) {
  const key = `${id}|${JSON.stringify(input, replacer)}`;
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
