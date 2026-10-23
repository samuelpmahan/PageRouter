// PxC kernel v0.6, plus sum and evaluate (seq 62, branch claude/pxc-kernel-sum; a proposal until Sam merges it).
//
// Nouns (each one's reason is in ledger/necessity.jsonl):
//   Part            content-addressed immutable value (hash of canonical JSON)
//   Ref             one occurrence of a Part inside a run, carrying where it came from (and which run)
//   Contract        named ports with schemas, examples, and a kind: calculation | check | tick
//   Implementation  implements exactly one Contract; declares which Contracts it uses; may carry its own examples
//   Composition     an Implementation assembled from declared steps (data, linted before running); steps may be conditional
//   Run             one subscription: executes, records a trace with exact bindings, caches, replays
//   Drive           a fold of a tick contract: across runs (world.drive) or inside one run (ctx.drive)
//
// Rebalancer's lesson: the problem is a declarative value; solvers are pluggable.
// Reactor's lesson: assembly (compose) is separate from subscription (run, drive).

import { canonical, deepFreeze, fail, hashString, seededRandom, KernelError } from './canonical.mjs';
import { checkSchema, compatible, validate } from './schema.mjs';
// Semirings come from Capability Lab, byte-identical (src/lab/PIN.json): the kernel evaluates provenance with the Lab's own
// provenance.evaluate rather than a second implementation of the algebra (seq 62).
import { createRegistry as createLabRegistry } from './lab/runtime.mjs';
import { capabilities as semiringCapabilities, semirings as SEMIRINGS } from './lab/semiring.mjs';

export { KernelError };

const REF = Symbol('pxc.ref');
const SKIPPED = Symbol('pxc.skipped');
const INTERNAL = Symbol('pxc.internal'); // compositions reach a few kernel hooks through ctx[INTERNAL]

/** A Ref is a Part occurrence: value + hash + provenance + the run it belongs to. Only the kernel mints them. */
class Ref {
  constructor(value, hash, from, run) {
    this.value = value;
    this.hash = hash;
    this.from = from;
    this.run = run;
    this[REF] = true;
    Object.freeze(this);
  }
}

export const isRef = (x) => x !== null && typeof x === 'object' && x[REF] === true;

const KINDS = new Set(['calculation', 'check', 'tick']);
const DEFAULT_LIMITS = Object.freeze({ maxCalls: 200_000, maxDepth: 256 });
const CONTRACT_FIELDS = new Set(['id', 'kind', 'in', 'out', 'examples', 'tolerance', 'description', 'notes']);
const IMPL_FIELDS = new Set(['id', 'implements', 'version', 'uses', 'run', 'pure', 'description', 'assembly', 'origin', 'examples']);
const TICK_DEP = '@tick';
const SUM_DEP = '\u0000sum:'; // ctx.sum depends on the set of implementations of its contract, not on one choice (seq 62)
const CONFLICT = '\u0000conflict'; // a flat dependency that resolved two ways in one subtree never validates

// Relational conditions (v0.4): a condition is a relation over Refs already present, not a contract.
const TESTS = {
  not: { arity: [1, 1], bool: true, f: ([a]) => !a },
  and: { arity: [1, Infinity], bool: true, f: (xs) => xs.every(Boolean) },
  or: { arity: [1, Infinity], bool: true, f: (xs) => xs.some(Boolean) },
  eq: { arity: [2, 2], f: ([a, b]) => canonical(a) === canonical(b) },
  ne: { arity: [2, 2], f: ([a, b]) => canonical(a) !== canonical(b) },
  lt: { arity: [2, 2], ord: true, f: ([a, b]) => a < b },
  le: { arity: [2, 2], ord: true, f: ([a, b]) => a <= b },
  gt: { arity: [2, 2], ord: true, f: ([a, b]) => a > b },
  ge: { arity: [2, 2], ord: true, f: ([a, b]) => a >= b },
};
/** The operator of a test object ({ eq: [a, b] }), or null. */
const testOp = (x) => {
  if (!x || typeof x !== 'object' || Array.isArray(x) || x[REF]) return null;
  const keys = Object.keys(x);
  return keys.length === 1 && Object.hasOwn(TESTS, keys[0]) && Array.isArray(x[keys[0]]) ? keys[0] : null;
};
const testArgs = (x, op) => x[op];
function applyTest(op, values) {
  const t = TESTS[op];
  if (values.length < t.arity[0] || values.length > t.arity[1]) return { error: `${op} takes ${t.arity[0] === t.arity[1] ? t.arity[0] : `${t.arity[0]}+`} operands, got ${values.length}` };
  if (t.bool && values.some((v) => typeof v !== 'boolean')) return { error: `${op} needs booleans` };
  if (t.ord && !(values.every((v) => typeof v === 'number') || values.every((v) => typeof v === 'string'))) return { error: `${op} needs two numbers or two strings` };
  return { value: t.f(values) };
}
/** Step names a spec reads, outside { first } / { one } (inside those, a skipped alternative is handled, not inherited). */
function stepRefs(spec, out = []) {
  if (typeof spec === 'string') { const s = spec.split('.')[0]; if (s !== '$in' && !out.includes(s)) out.push(s); return out; }
  if (!spec || typeof spec !== 'object') return out;
  if (Array.isArray(spec.first) || Array.isArray(spec.one) || Array.isArray(spec.else)) return out;
  const op = testOp(spec);
  if (op) { spec[op].forEach((a) => stepRefs(a, out)); return out; }
  if ('literal' in spec) return out;
  if (spec.gather) { Object.values(spec.gather).forEach((a) => stepRefs(a, out)); return out; }
  if (spec.concat) { spec.concat.forEach((a) => stepRefs(a, out)); return out; }
  if (spec.at) return stepRefs(spec.at[0], out);
  return out;
}
/** Every step a spec mentions, including inside alternatives and else (used to find the cause of an inherited skip). */
function stepRefsAll(spec, out = []) {
  if (typeof spec === 'string') { const s = spec.split('.')[0]; if (s !== '$in' && !out.includes(s)) out.push(s); return out; }
  if (!spec || typeof spec !== 'object') return out;
  if (Array.isArray(spec.else)) { spec.else.forEach((n) => { if (!out.includes(n)) out.push(n); }); return out; }
  for (const k of ['first', 'one', 'concat']) if (Array.isArray(spec[k])) { spec[k].forEach((a) => stepRefsAll(a, out)); return out; }
  const op = testOp(spec);
  if (op) { spec[op].forEach((a) => stepRefsAll(a, out)); return out; }
  if ('literal' in spec) return out;
  if (spec.gather) { Object.values(spec.gather).forEach((a) => stepRefsAll(a, out)); return out; }
  if (spec.at) return stepRefsAll(spec.at[0], out);
  return out;
}
/** Steps named by else anywhere in a condition. */
function elseNames(spec, out = []) {
  if (!spec || typeof spec !== 'object') return out;
  if (Array.isArray(spec.else)) { out.push(...spec.else); return out; }
  const op = testOp(spec);
  if (op) spec[op].forEach((a) => elseNames(a, out));
  return out;
}
/** and of the given conditions, deduplicated; null for none, the condition itself for one. */
function conj(conds) {
  const seen = new Map();
  for (const c of conds) {
    if (c === null) continue;
    for (const x of testOp(c) === 'and' ? c.and : [c]) seen.set(canonical(x), x);
  }
  const xs = [...seen.values()];
  return xs.length === 0 ? null : xs.length === 1 ? xs[0] : { and: xs };
}
const reachOf = (state, key) => { if (!state.reach.has(key)) state.reach.set(key, []); return state.reach.get(key); };
/** Record a dependency; one that resolved two ways in a subtree becomes a conflict that never validates. */
function setDep(map, key, value) {
  if (map.has(key) && map.get(key) !== value) map.set(key, CONFLICT); else if (!map.has(key)) map.set(key, value);
}
/** Does condition c (canonical spec) guarantee condition p? Equal, or c is an and containing something that does. */
function implies(c, p) {
  if (canonical(c) === canonical(p)) return true;
  if (testOp(p) === 'and') return p.and.every((x) => implies(c, x));
  return testOp(c) === 'and' && c.and.some((x) => implies(x, p));
}
const slotKey = (contract, slot) => (slot ? `${contract}#${slot}` : contract);

export function createWorld({ name = 'world', limits = {} } = {}) {
  const contracts = new Map();
  const impls = new Map();
  const selected = new Map();   // 'contract' or 'contract#slot' -> implId
  const declaredSlots = new Set(); // 'contract#slot' declared by a composition step or an implementation's uses
  const parts = new Map();      // hash -> frozen value
  const cache = new Map();      // key -> [{ out, run, call, deps: [[resolution, value]], verdicts }]
  const runs = [];
  const proofs = [];
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const stats = { cacheHits: 0, cacheMisses: 0, cacheRejectedByDeps: 0 };

  function intern(value, path) {
    const text = canonical(value, path);
    const hash = hashString(text);
    if (!parts.has(hash)) parts.set(hash, deepFreeze(JSON.parse(text)));
    return { hash, value: parts.get(hash) };
  }

  /** Make a Ref belonging to `run`. A Ref from another run keeps its origin as a cross-run edge. */
  function mint(value, from, run, path = '$') {
    if (isRef(value)) {
      if (value.run === run) return value;
      return new Ref(value.value, value.hash, { kind: 'run', run: value.run, from: value.from }, run);
    }
    const { hash, value: frozen } = intern(value, path);
    return new Ref(frozen, hash, from, run);
  }

  // ---------------------------------------------------------------- declare
  function contract(def) {
    for (const k of Object.keys(def)) if (!CONTRACT_FIELDS.has(k)) fail(`contract ${def.id}: unknown field ${k}`, 'BAD_CONTRACT');
    if (typeof def.id !== 'string' || !def.id || def.id.includes('#')) fail('contract needs an id without "#"', 'BAD_CONTRACT');
    if (contracts.has(def.id)) fail(`contract ${def.id} already declared`, 'DUPLICATE');
    const c = { kind: 'calculation', examples: [], tolerance: 0, ...def };
    if (!KINDS.has(c.kind)) fail(`contract ${c.id}: kind must be one of ${[...KINDS].join(', ')}`, 'BAD_CONTRACT');
    for (const side of ['in', 'out']) {
      if (!c[side] || typeof c[side] !== 'object') fail(`contract ${c.id} needs ${side} ports`, 'BAD_CONTRACT');
      for (const [port, schema] of Object.entries(c[side])) checkSchema(schema, `${c.id}.${side}.${port}`);
    }
    if (Object.keys(c.out).length === 0) fail(`contract ${c.id} has no outputs`, 'BAD_CONTRACT');
    if (c.kind === 'check') {
      if (c.out.accepted?.type !== 'boolean') fail(`check ${c.id} must output accepted: boolean`, 'BAD_CONTRACT');
      if (c.out.reason?.type !== 'string') fail(`check ${c.id} must output reason: string`, 'BAD_CONTRACT');
    }
    if (c.kind === 'tick') {
      if (!c.in.state || !c.out.state) fail(`tick ${c.id} must have a state port on both sides`, 'BAD_CONTRACT');
      if (!compatible(c.out.state, c.in.state)) fail(`tick ${c.id}: out.state cannot feed in.state`, 'BAD_CONTRACT');
    }
    if (/[/#]/.test(c.id)) fail(`contract id ${c.id} may not contain / or # (they address slots and paths)`, 'BAD_CONTRACT');
    contracts.set(c.id, deepFreeze(clone(c)));
    return contracts.get(c.id);
  }

  function implement(def) {
    for (const k of Object.keys(def)) if (!IMPL_FIELDS.has(k)) fail(`implementation ${def.id}: unknown field ${k}`, 'BAD_IMPL');
    if (!contracts.has(def.implements)) fail(`${def.id} implements unknown contract ${def.implements}`, 'UNKNOWN_CONTRACT');
    if (impls.has(def.id)) fail(`implementation ${def.id} already registered`, 'DUPLICATE');
    if (typeof def.run !== 'function') fail(`${def.id} needs run(input, ctx)`, 'BAD_IMPL');
    // uses entries are 'contract' or 'contract#slot'. Declaring any slot of a contract restricts calls to declared slots.
    const slots = {};
    for (const u of def.uses ?? []) {
      const [cid, sl] = u.split('#');
      if (!contracts.has(cid)) fail(`${def.id} uses unknown contract ${cid}`, 'UNKNOWN_CONTRACT');
      if (sl !== undefined) { (slots[cid] ??= []).push(sl); declaredSlots.add(u); }
    }
    for (const step of def.assembly?.steps ?? []) if (step.slot) declaredSlots.add(slotKey(step.call, step.slot));
    const uses = [...new Set((def.uses ?? []).map((u) => u.split('#')[0]))];
    const impl = Object.freeze({ version: '1', pure: true, ...def, examples: def.examples ?? [], uses: Object.freeze(uses), slots: deepFreeze(slots) });
    impls.set(impl.id, impl);
    return impl;
  }

  /** Default filler for a contract, or for one slot of it. */
  function select(contractId, implId, slot) {
    const impl = impls.get(implId);
    if (!impl || impl.implements !== contractId) fail(`${implId} does not implement ${contractId}`, 'BAD_FILL');
    selected.set(slotKey(contractId, slot), implId);
  }

  function implementationsOf(contractId) {
    return [...impls.values()].filter((i) => i.implements === contractId);
  }

  function checkFill(fill) {
    for (const [key, implId] of Object.entries(fill ?? {})) {
      const segs = key.split('/');
      for (const seg of segs) if (!contracts.has(seg.split('#')[0])) fail(`fill key ${key} names no contract ${seg.split('#')[0]}`, 'BAD_FILL');
      const contractId = segs[segs.length - 1].split('#')[0];
      const impl = impls.get(implId);
      if (!impl || impl.implements !== contractId) fail(`fill ${key} = ${implId} does not implement ${contractId}`, 'BAD_FILL');
    }
  }

  /** A slot fill key is meaningful if some implementation declares that slot or some call in this run (or drive) consulted it. */
  function checkUnknownSlots(fill, consulted, landing = 'path', slotsSeen = new Set()) {
    if (!['path', 'all', 'none'].includes(landing)) fail(`landing must be 'path', 'all' or 'none', got ${landing}`, 'BAD_OPTION');
    // A flat slot key is standing configuration: valid if declared somewhere or consulted. A path key targets one place,
    // so it must land: consulted by some call in this run (or drive), otherwise it reached nothing (v0.5).
    const known = (k) => consulted.has(k) || k.split('#')[1] === '*' || declaredSlots.has(k);
    // A misspelt slot inside a path is a typo in every landing mode (v0.6 fix): each slotted segment must name a slot
    // some implementation declares or some call in this run (or drive) used.
    const segKnown = (seg) => !seg.includes('#') || seg.endsWith('#*') || declaredSlots.has(seg) || slotsSeen.has(seg);
    const unknown = Object.keys(fill ?? {}).filter((k) => (k.includes('/') ? !k.split('/').every(segKnown) : k.includes('#') && !known(k)));
    if (unknown.length) fail(`fill names slots that no implementation declares and no call consulted: ${unknown.join(', ')} (typo? declare it in uses as 'contract#slot', or pass allowUnusedFill)`, 'BAD_FILL', unknown);
    // landing (v0.6): 'path' (default) path keys must land; 'all' every key must land; 'none' a sweep may miss (typos still fail).
    const dead = Object.keys(fill ?? {}).filter((k) => !consulted.has(k) && (landing === 'all' || (landing === 'path' && k.includes('/'))));
    if (dead.length) fail(`fill reached no call in this run: ${dead.join(', ')} (no call matched, or a more specific key always won; landing: '${landing}')`, 'BAD_FILL', dead);
  }

  const pathKeyCache = new WeakMap();
  /** Path fill keys of a fill, parsed once: 'outer#s/inner#t' -> segments. */
  function pathKeysOf(fill) {
    if (!fill) return [];
    if (!pathKeyCache.has(fill)) pathKeyCache.set(fill, Object.keys(fill).filter((k) => k.includes('/')).map((key) => ({ key, segs: key.split('/') })));
    return pathKeyCache.get(fill);
  }
  /** Do the segments appear in order among the ancestor call keys? A bare contract segment matches any slot of it. */
  function along(segs, ancestors) {
    let i = 0;
    for (const a of ancestors) {
      if (i === segs.length) break;
      const seg = segs[i];
      if (seg === a || ((!seg.includes('#') || seg.endsWith('#*')) && a.split('#')[0] === seg.split('#')[0])) i += 1;
    }
    return i === segs.length;
  }

  /**
   * Path fill (longest matching path wins), slot fill, contract#* fill, slot select, contract fill, contract select, the only implementation.
   * Never a silent guess. `ancestors` are the call keys from the run's root down to the caller.
   */
  function choose(contractId, fill, slot, consulted, ancestors = null, info = null) {
    const by = (rung, key) => { if (info) { info.rung = rung; if (key) info.key = key; } };
    const sk = slot ? slotKey(contractId, slot) : null;
    let id;
    const paths = ancestors ? pathKeysOf(fill) : [];
    if (paths.length) {
      let best = null;
      for (const { key, segs } of paths) {
        const last = segs[segs.length - 1];
        if (!(last === sk || last === contractId || (sk && last === `${contractId}#*`)) || !along(segs.slice(0, -1), ancestors)) continue;
        const score = segs.length * 2 + (last === sk ? 1 : 0);
        if (!best || score > best.score) best = { score, key, id: fill[key] };
        else if (score === best.score && fill[key] !== best.id) fail(`fill keys ${best.key} and ${key} both match ${[...ancestors, sk ?? contractId].join('/')} with different implementations`, 'BAD_FILL');
      }
      if (best) { consulted?.add(best.key); by('path fill', best.key); return impls.get(best.id); }
    }
    // Specificity first (v0.5): a slot's own fill or select beats anything said about the whole contract.
    const any = sk ? `${contractId}#*` : null;
    if (sk && fill?.[sk]) { id = fill[sk]; consulted?.add(sk); by('slot fill', sk); }
    else if (any && fill?.[any]) { id = fill[any]; consulted?.add(any); by('every-slot fill', any); }
    else if (sk && selected.has(sk)) { id = selected.get(sk); by('slot select', sk); }
    else if (fill?.[contractId]) { id = fill[contractId]; consulted?.add(contractId); by('contract fill', contractId); }
    else if (selected.has(contractId)) { id = selected.get(contractId); by('contract select', contractId); }
    if (id) return impls.get(id);
    const all = implementationsOf(contractId);
    if (all.length === 1) { by('only implementation'); return all[0]; }
    if (all.length === 0) fail(`no implementation of ${contractId}`, 'UNIMPLEMENTED');
    fail(`${contractId}${slot ? `#${slot}` : ''} has ${all.length} implementations and none selected (${all.map((i) => i.id).join(', ')})`, 'AMBIGUOUS');
  }

  // ---------------------------------------------------------------- assembly
  /**
   * compose({ id, implements, steps: [{ name, call, slot?, when?, bind: { port: spec } }], returns: { port: spec }, pure?, examples? })
   * spec: '$in.port' | 'step.port' | { at: [spec, ...path] } | { literal: value }
   *     | { gather: [spec...] | { key: spec } } | { concat: [spec...] }
   *     | { first: [spec...] } | { one: [spec...] }
   *     | a test: { not: [spec] } | { and | or: [spec...] } | { eq | ne | lt | le | gt | ge: [spec, spec] }
   *       (a test operand may also be a bare number, boolean or null; strings go in { literal })
   * A step with `when` (a boolean spec, usually a test) runs only if it reads true. Its outputs may be used only inside
   * { first } / { one }, or by steps whose `when` is the same condition or an { and } containing it.
   * A piece that comes from a skipped step makes the whole gather, concat, at or test skipped.
   * All of this is checked before anything runs.
   */
  function compose(def) {
    const c = contracts.get(def.implements) ?? fail(`${def.id} implements unknown contract ${def.implements}`, 'UNKNOWN_CONTRACT');
    const problems = [];
    const produced = new Map([['$in', { ports: c.in, when: null }]]);
    const consumed = new Set();
    const names = new Set();
    const BOOL = { type: 'boolean' };
    const specSchema = (spec, where, ctxWhen, inFirst = false) => {
      if (typeof spec === 'string') {
        const [step, port] = spec.split('.');
        if (!produced.has(step)) { problems.push(`${where}: ${spec} refers to unknown or later step ${step}`); return null; }
        const { ports, when } = produced.get(step);
        if (!(port in ports)) { problems.push(`${where}: ${step} has no port ${port}`); return null; }
        if (when !== null && !inFirst && !(ctxWhen !== null && implies(ctxWhen, when))) {
          problems.push(`${where}: ${spec} comes from conditional step ${step}; use it inside { first } or { one }, or in a step whose when is the same condition or an { and } containing it`);
        }
        consumed.add(`${step}.${port}`);
        return ports[port];
      }
      if (spec === null || typeof spec === 'number' || typeof spec === 'boolean') { problems.push(`${where}: bare ${JSON.stringify(spec)} is only allowed as a test operand; use { literal }`); return null; }
      const op = testOp(spec);
      if (op) {
        const args = testArgs(spec, op);
        const t = TESTS[op];
        if (args.length < t.arity[0] || args.length > t.arity[1]) problems.push(`${where}: ${op} takes ${t.arity[0] === t.arity[1] ? t.arity[0] : `${t.arity[0]}+`} operands, got ${args.length}`);
        const types = args.map((a, i) => (a === null || typeof a === 'number' || typeof a === 'boolean') ? { type: a === null ? 'null' : typeof a === 'boolean' ? 'boolean' : 'number' } : specSchema(a, `${where}.${op}[${i}]`, ctxWhen, inFirst));
        types.forEach((ty, i) => {
          if (!ty || ty.type === 'any' || ty.oneOf) return;
          if (t.bool && ty.type !== 'boolean') problems.push(`${where}.${op}[${i}] must be a boolean, got ${ty.type}`);
          if (t.ord && !['number', 'integer', 'string'].includes(ty.type)) problems.push(`${where}.${op}[${i}] must be a number or string, got ${ty.type}`);
        });
        return BOOL;
      }
      if (spec && typeof spec === 'object' && 'literal' in spec) { canonical(spec.literal, where); return null; }
      if (spec && Array.isArray(spec.else)) {
        if (!spec.else.length) problems.push(`${where}: else needs at least one step`);
        for (const n of spec.else) {
          if (!produced.has(n) || n === '$in') problems.push(`${where}: else names unknown or later step ${n}`);
          else if (produced.get(n).when === null) problems.push(`${where}: else names ${n}, which is not conditional (it always runs)`);
        }
        return BOOL;
      }
      if (spec && Array.isArray(spec.at)) { specSchema(spec.at[0], where, ctxWhen, inFirst); return null; }
      if (spec && spec.gather && typeof spec.gather === 'object') {
        for (const [k, s] of Object.entries(spec.gather)) specSchema(s, `${where}.gather.${k}`, ctxWhen, inFirst);
        return Array.isArray(spec.gather) ? { type: 'array' } : { type: 'object' };
      }
      if (spec && Array.isArray(spec.concat)) {
        spec.concat.forEach((s, i) => { const t = specSchema(s, `${where}.concat[${i}]`, ctxWhen, inFirst); if (t && t.type !== 'array' && t.type !== 'any') problems.push(`${where}.concat[${i}] is not an array`); });
        return { type: 'array' };
      }
      for (const alt of ['first', 'one']) {
        if (spec && Array.isArray(spec[alt])) {
          if (spec[alt].length < 1) problems.push(`${where}: ${alt} needs at least one alternative`);
          const types = spec[alt].map((s, i) => specSchema(s, `${where}.${alt}[${i}]`, ctxWhen, true));
          if (alt === 'one') {
            // Provable overlap is an assembly error: an unconditional alternative, or one condition implying another.
            const conds = spec.one.map((s) => (typeof s === 'string' ? (produced.get(s.split('.')[0])?.when ?? null) : undefined));
            conds.forEach((ci, i) => conds.forEach((cj, j) => {
              if (j <= i || ci === undefined || cj === undefined) return;
              if (ci === null || cj === null) problems.push(`${where}: one alternatives ${spec.one[i]} and ${spec.one[j]} can both be live (${ci === null ? spec.one[i] : spec.one[j]} is unconditional)`);
              else if (implies(ci, cj) || implies(cj, ci)) problems.push(`${where}: one alternatives ${spec.one[i]} and ${spec.one[j]} can both be live (one condition implies the other)`);
            }));
          }
          return types.find(Boolean) ?? null;
        }
      }
      problems.push(`${where}: unrecognised binding ${JSON.stringify(spec)}`);
      return null;
    };
    for (const step of def.steps ?? []) {
      if (!step.name || step.name.startsWith('$') || names.has(step.name)) problems.push(`step name ${step.name} missing, reserved or duplicate`);
      names.add(step.name);
      const callee = contracts.get(step.call);
      if (!callee) { problems.push(`step ${step.name} calls unknown contract ${step.call}`); continue; }
      // Effective condition: the step's own when, and the conditions of every conditional step it reads (v0.5).
      // What depends on something that did not happen does not happen either, so the guard is written once.
      const reads = [...stepRefs(step.when)];
      for (const spec of Object.values(step.bind ?? {})) stepRefs(spec, reads);
      const inherited = reads.filter((n) => produced.has(n)).map((n) => produced.get(n).when);
      // v0.6: else(A) holds only inside A's own context (what A inherited), so it inherits that context too.
      for (const n of elseNames(step.when)) if (produced.has(n)) inherited.push(produced.get(n).inh ?? null);
      // v0.6: an alternative in a binding whose every option is conditional can be wholly skipped; then the step is skipped.
      for (const spec of Object.values(step.bind ?? {})) {
        for (const alt of ['first', 'one']) {
          if (!spec || !Array.isArray(spec[alt])) continue;
          const conds = spec[alt].map((a) => (typeof a === 'string' ? (produced.get(a.split('.')[0])?.when ?? null) : null));
          if (conds.length && conds.every((x) => x !== null)) inherited.push(conds.length === 1 ? conds[0] : { or: conds });
        }
      }
      const inh = conj(inherited);
      const whenSpec = conj([step.when === undefined ? null : step.when, ...inherited]);
      if (step.when !== undefined) {
        const t = specSchema(step.when, `step ${step.name}.when`, whenSpec);
        if (t && t.type !== 'boolean') problems.push(`step ${step.name}.when must be a boolean, got ${t.type}`);
      }
      const bind = step.bind ?? {};
      for (const port of Object.keys(callee.in)) if (!(port in bind)) problems.push(`step ${step.name}: ${step.call}.${port} is unbound`);
      for (const [port, spec] of Object.entries(bind)) {
        if (!(port in callee.in)) { problems.push(`step ${step.name}: ${step.call} has no input ${port}`); continue; }
        const src = specSchema(spec, `step ${step.name}.${port}`, whenSpec);
        if (src && !compatible(src, callee.in[port])) problems.push(`step ${step.name}.${port}: ${JSON.stringify(spec)} is ${src.type ?? 'oneOf'}, ${step.call}.${port} needs ${callee.in[port].type ?? 'oneOf'}`);
      }
      produced.set(step.name, { ports: callee.out, when: whenSpec, inh });
    }
    for (const port of Object.keys(c.out)) if (!(port in (def.returns ?? {}))) problems.push(`returns is missing ${port}`);
    for (const [port, spec] of Object.entries(def.returns ?? {})) {
      if (!(port in c.out)) { problems.push(`returns has extra port ${port}`); continue; }
      const src = specSchema(spec, `returns.${port}`, null);
      if (src && !compatible(src, c.out[port])) problems.push(`returns.${port} type mismatch`);
    }
    // A check is used for its verdict (collected on the receipt), so its outputs need not be consumed.
    const unused = (def.steps ?? []).filter((s) => contracts.has(s.call) && contracts.get(s.call).kind !== 'check'
      && !Object.keys(contracts.get(s.call).out).some((p) => consumed.has(`${s.name}.${p}`))).map((s) => s.name);
    if (unused.length) problems.push(`steps whose outputs are never used: ${unused.join(', ')}`);
    if (problems.length) fail(`composition ${def.id} failed assembly lint:\n- ${problems.join('\n- ')}`, 'ASSEMBLY_LINT', problems);

    const assembly = deepFreeze(clone({ steps: def.steps, returns: def.returns }));
    return implement({
      id: def.id,
      implements: def.implements,
      version: def.version ?? '1',
      pure: def.pure ?? true,
      description: def.description,
      examples: def.examples ?? [],
      uses: def.steps.map((s) => s.call),
      assembly,
      run(input, ctx) {
        const env = { $in: input };
        const cause = {}; // step -> provenance of the condition that decided whether it ran
        const skippedBy = {}; // step -> 'own' (its condition read false) | 'inherited' (something it reads was skipped)
        let inBinding = false; // inside a step binding, a wholly skipped alternative skips the step instead of failing
        const resolve = (spec) => {
          if (typeof spec === 'string') {
            const [s, p] = spec.split('.');
            return env[s] === SKIPPED ? SKIPPED : env[s][p];
          }
          if (spec === null || typeof spec !== 'object') return spec; // bare test operand
          const op = testOp(spec);
          if (op) {
            const args = [];
            for (const a of testArgs(spec, op)) {
              const r = resolve(a);
              args.push(r);
              // and/or short-circuit: a decided operand makes later (possibly skipped) operands irrelevant
              if ((op === 'and' && isRef(r) && r.value === false) || (op === 'or' && isRef(r) && r.value === true)) return ctx.test({ [op]: args });
            }
            return args.includes(SKIPPED) ? SKIPPED : ctx.test({ [op]: args });
          }
          if ('literal' in spec) return ctx.literal(spec.literal);
          if (Array.isArray(spec.else)) {
            // true when every named step was skipped by its own condition; provenance names what decided each of them.
            // If a named step was skipped because its context did not happen, the else is outside that context too (v0.6).
            if (spec.else.some((n) => skippedBy[n] === 'inherited')) return SKIPPED;
            const value = spec.else.every((n) => env[n] === SKIPPED);
            return ctx[INTERNAL].mint(value, { kind: 'test', op: 'else', steps: [...spec.else], args: spec.else.map((n) => cause[n] ?? { kind: 'computed' }) });
          }
          if (spec.gather) {
            const parts = Array.isArray(spec.gather) ? spec.gather.map(resolve) : Object.fromEntries(Object.entries(spec.gather).map(([k, s]) => [k, resolve(s)]));
            return Object.values(parts).includes(SKIPPED) ? SKIPPED : ctx.gather(parts);
          }
          if (spec.concat) {
            const parts = spec.concat.map(resolve);
            return parts.includes(SKIPPED) ? SKIPPED : ctx.concat(...parts);
          }
          if (spec.first) {
            for (const s of spec.first) { const r = resolve(s); if (r !== SKIPPED) return r; }
            if (inBinding) return SKIPPED;
            return ctx.fault('every alternative of a first binding was skipped', 'NO_BRANCH');
          }
          if (spec.one) {
            const live = spec.one.map(resolve).filter((r) => r !== SKIPPED);
            if (live.length === 0 && inBinding) return SKIPPED;
            if (live.length === 0) return ctx.fault('every alternative of a one binding was skipped', 'NO_BRANCH');
            if (live.length > 1) return ctx.fault(`${live.length} alternatives of a one binding were live; exactly one may be`, 'AMBIGUOUS_BRANCH');
            return live[0];
          }
          const base = resolve(spec.at[0]);
          return base === SKIPPED ? SKIPPED : ctx.at(base, ...spec.at.slice(1));
        };
        // reads: every step mentioned (to find the cause of a skip). inheritsFrom: steps whose skip this step inherits
        // (plain reads outside alternatives, else-named steps' context is handled by else itself).
        const reads = Object.fromEntries(def.steps.map((st) => {
          const r = [...stepRefsAll(st.when)];
          for (const sp of Object.values(st.bind ?? {})) stepRefsAll(sp, r);
          return [st.name, r];
        }));
        const inheritsFrom = Object.fromEntries(def.steps.map((st) => {
          const r = [...stepRefs(st.when)];
          for (const sp of Object.values(st.bind ?? {})) stepRefs(sp, r);
          return [st.name, r];
        }));
        // A step that reads a skipped step is skipped too, with the cause of the step it read (recorded as a decision).
        const inheritSkip = (step) => {
          const from = reads[step.name].map((n) => env[n] === SKIPPED && cause[n]).find(Boolean) ?? { kind: 'computed' };
          cause[step.name] = from;
          env[step.name] = SKIPPED;
          skippedBy[step.name] = 'inherited';
          ctx[INTERNAL].decide(step.name, false, from, { skipped: step.name });
        };
        for (const step of def.steps) {
          const inheritedFrom = inheritsFrom[step.name].map((n) => cause[n]).find(Boolean);
          if (step.when !== undefined) {
            const cond = resolve(step.when);
            if (cond === SKIPPED) { inheritSkip(step); continue; }
            const ran = ctx.when(cond, step.name, step.name);
            cause[step.name] = isRef(cond) ? cond.from : { kind: 'computed' };
            if (!ran) { env[step.name] = SKIPPED; skippedBy[step.name] = 'own'; continue; }
          } else if (inheritedFrom) cause[step.name] = inheritedFrom;
          inBinding = true;
          const args = Object.fromEntries(Object.entries(step.bind).map(([p, s]) => [p, resolve(s)]));
          inBinding = false;
          if (Object.values(args).includes(SKIPPED)) { inheritSkip(step); continue; }
          // v0.6: a step that runs because what it reads ran records that, with the same cause (both sides are recorded).
          if (step.when === undefined && inheritedFrom) ctx[INTERNAL].decide(step.name, true, inheritedFrom, { ran: step.name });
          env[step.name] = ctx.call(step.call, args, step.slot ? { slot: step.slot } : undefined);
        }
        return Object.fromEntries(Object.entries(def.returns).map(([p, s]) => [p, resolve(s)]));
      },
    });
  }

  // ---------------------------------------------------------------- subscription
  function run(contractId, inputs, options = {}) {
    checkFill(options.fill);
    const record = options.record !== false;
    const runId = record ? runs.length + 1 : `replay:${runs.length + 1}`;
    const state = {
      seq: 0, calls: 0, cacheOn: options.cache !== false,
      maxCalls: options.maxCalls ?? lim.maxCalls,
      random: options.seed === undefined ? null : seededRandom(options.seed),
      consulted: options.consulted ?? new Set(),
      pathFill: Object.keys(options.fill ?? {}).some((k) => k.includes('/')),
      reach: options.reach ?? new Map(),
      slotsSeen: options.slotsSeen ?? new Set(),
    };
    const root = { calls: [], deps: new Map(), pdeps: null, path: [], impure: false, tick: options.tick ?? null, decisions: [] };
    if (state.pathFill) root.pdeps = new Map();
    const rootRefs = Object.fromEntries(Object.entries(inputs ?? {}).map(([p, v]) => [p, mint(v, { kind: 'input', call: 0, port: p }, runId, `$in.${p}`)]));
    const head = {
      runId, contract: contractId, tick: options.tick ?? null, seed: options.seed ?? null, fill: options.fill ?? null,
      inputs: Object.fromEntries(Object.entries(rootRefs).map(([p, r]) => [p, r.hash])),
      inputValues: Object.fromEntries(Object.entries(rootRefs).map(([p, r]) => [p, r.value])),
    };
    let refs;
    try {
      refs = invoke(contractId, rootRefs, root, 0, state, options.fill, runId, undefined, false);
      if (!options.allowUnusedFill) checkUnknownSlots(options.fill, state.consulted, options.landing, state.slotsSeen);
    } catch (error) {
      const failed = deepFreeze({ ...head, status: 'failed', error: { code: error.code ?? 'IMPL_ERROR', message: error.message }, calls: state.calls, verdicts: collectVerdicts(root.calls[0]), trace: root.calls[0] ?? null });
      if (record) runs.push(failed);
      error.trace = root.calls[0] ?? null;
      error.receipt = failed;
      throw error;
    }
    const trace = root.calls[0];
    const outputs = Object.fromEntries(Object.entries(refs).map(([p, r]) => [p, r.value]));
    const receipt = deepFreeze({
      ...head, status: 'ok',
      outputs: Object.fromEntries(Object.entries(refs).map(([p, r]) => [p, r.hash])),
      calls: state.calls, randomDraws: state.random?.draws() ?? 0, impure: root.impure,
      fillConsulted: Object.keys(options.fill ?? {}).filter((k) => state.consulted.has(k)),
      fillReach: Object.fromEntries(Object.keys(options.fill ?? {}).map((k) => [k, [...(state.reach.get(k) ?? [])]])),
      verdicts: collectVerdicts(trace), trace,
    });
    if (record) runs.push(receipt);
    // Observation (v0.6): an opt-in subscriber sees every recorded receipt, from any world in the process (used by the flow miner).
    if (record && typeof globalThis.__pxcObserve === 'function') globalThis.__pxcObserve({ world: name, receipt, implementations: () => [...impls.values()] });
    return { outputs, refs, trace, receipt };
  }

  // ---------------------------------------------------------------- sum (seq 62)
  // Every registered implementation of a contract is another way to the same output. sum runs each one (pinned by a fill, so each
  // has its own receipt and cache entries, exactly as run) and records the provenance polynomial: one term per way that ran, each
  // term the product of the implementation and every implementation its trace called. Inputs are shared by every term, so they
  // factor out. A way that throws contributes no term; its error stays in its own failed receipt. ℕ[X] is the free semiring, so the
  // polynomial is the master record: evaluate maps it into any semiring afterwards without running anything again.
  function sum(contractId, inputs, options = {}) {
    if (!contracts.has(contractId)) fail(`unknown contract ${contractId}`, 'UNKNOWN_CONTRACT');
    const ways = implementationsOf(contractId);
    if (!ways.length) fail(`${contractId} has no implementations to sum`, 'NO_IMPLEMENTATION');
    const terms = ways.map((impl) => {
      try {
        const r = run(contractId, inputs, { ...options, fill: { ...(options.fill ?? {}), [contractId]: impl.id } });
        return { impl: impl.id, monomials: polynomialOf(r.trace), outputs: r.outputs, receipt: r.receipt };
      } catch (error) {
        return { impl: impl.id, monomials: [], error: { code: error.code ?? 'IMPL_ERROR', message: error.message }, receipt: error.receipt ?? null };
      }
    });
    const polynomial = terms.flatMap((t) => t.monomials);
    const receipt = deepFreeze({ kind: 'sum', contract: contractId, polynomial,
      terms: terms.map((t) => ({ impl: t.impl, runId: t.receipt?.runId ?? null, status: t.error ? 'failed' : 'ok', monomials: t.monomials.length, ...(t.error ? { error: t.error } : {}) })) });
    return { polynomial, terms, receipt };
  }
  /**
   * The provenance polynomial of a trace node, expanded (seq 62): its implementation × the polynomial of each ordinary call ×
   * Σ over each ctx.sum's ways. A monomial is a set of implementation ids, the node's own first (a variable used twice counts
   * once). A cache hit is read through the node it came from, so the polynomial is the same cached or not.
   */
  function polynomialOf(trace) {
    const full = (n) => { let m = n; for (let i = 0; m.cached && m.cachedFrom && i < 64; i++) m = node(m.cachedFrom.run, m.cachedFrom.call) ?? { ...m, cached: false }; return m; };
    const times = (A, B) => A.flatMap((a) => B.map((b) => [...new Set([...a, ...b])]));
    const tidy = (m, head) => [head, ...m.filter((v) => v !== head).sort()];
    const of = (n) => {
      const src = full(n), inSum = new Set((src.sums ?? []).flatMap((s) => s.terms.map((t) => t.call)));
      let poly = [[n.impl]];
      for (const c of src.calls ?? []) if (!inSum.has(c.id) && !c.error) poly = times(poly, of(c));
      for (const s of src.sums ?? []) poly = times(poly, s.terms.filter((t) => !t.error && t.call !== null).flatMap((t) => of((src.calls ?? []).find((c) => c.id === t.call))));
      return poly.map((m) => tidy(m, n.impl));
    };
    return of(trace);
  }
  let labRegistry = null;
  /** Evaluate a provenance polynomial in one of the Lab's semirings (a homomorphism out of ℕ[X]). valuation maps a variable to
   *  true (present), { weight } or { labels }; a variable it does not name is the semiring's zero. Runs nothing in this world. */
  function evaluate(polynomial, semiring, valuation = {}) {
    if (!SEMIRINGS.includes(semiring)) fail(`unknown semiring ${semiring}; one of ${SEMIRINGS.join(', ')}`, 'UNKNOWN_SEMIRING');
    if (!Array.isArray(polynomial) || polynomial.some((m) => !Array.isArray(m) || !m.length)) fail('a polynomial is a list of non-empty monomials', 'BAD_POLYNOMIAL');
    if (!polynomial.length) return { value: { present: false }, terms: [] };
    const values = Object.entries(valuation).filter(([, v]) => v !== false && v !== undefined && v !== null)
      .map(([variable, v]) => ({ variable, ...(v === true ? {} : v) }));
    labRegistry ??= createLabRegistry(semiringCapabilities, { source: 'capability-lab (pxc-kernel src/lab, PIN.json)', version: '1' });
    return labRegistry.execute('provenance.evaluate', { semiring, polynomial, values }).result;
  }

  /** Every check in a trace, including those inside cache hits (stored on the entry when it was made). */
  function collectVerdicts(trace) {
    const out = [];
    (function walk(n) {
      if (!n) return;
      if (n.cached) { for (const v of n.verdicts ?? []) out.push({ ...v, cached: true, cachedFrom: n.cachedFrom }); return; }
      if (n.kind === 'check' && n.out.accepted && n.out.reason) out.push({ call: n.id, contract: n.contract, impl: n.impl, accepted: parts.get(n.out.accepted.hash), reason: parts.get(n.out.reason.hash) });
      n.calls.forEach(walk);
    })(trace);
    return out;
  }

  function invoke(contractId, inRefs, parent, depth, state, fill, runId, slot, tickOverride) {
    if (depth > lim.maxDepth) fail(`call depth exceeds ${lim.maxDepth}`, 'DEPTH_LIMIT');
    const c = contracts.get(contractId) ?? fail(`unknown contract ${contractId}`, 'UNKNOWN_CONTRACT');
    const myKey = slotKey(contractId, slot);
    const chosen = {};
    const impl = choose(contractId, fill, slot, state.consulted, parent.path, chosen);
    setDep(parent.deps, myKey, impl.id);
    if (parent.pdeps) setDep(parent.pdeps, myKey, impl.id);
    const nodePath = [...parent.path, myKey];
    if (slot) state.slotsSeen.add(myKey);
    const tick = tickOverride === false ? parent.tick : tickOverride;
    const id = ++state.seq;
    const node = { id, kind: c.kind, contract: contractId, slot: slot ?? null, impl: impl.id, version: impl.version, in: {}, out: {}, calls: [], cached: false };
    if (tickOverride !== false) node.tick = tick;
    node.chosenBy = chosen; // which precedence rung chose the implementation (v0.6)
    if (chosen.key && fill && Object.hasOwn(fill, chosen.key)) reachOf(state, chosen.key).push(id);
    for (const [port, ref] of Object.entries(inRefs)) node.in[port] = { hash: ref.hash, from: ref.from };
    parent.calls.push(node);
    const fault = (message, code, detail) => {
      node.error = { code, message };
      try { fail(message, code, detail); } catch (e) { e.originCall = id; throw e; }
    };
    for (const port of Object.keys(c.in)) if (!(port in inRefs)) fault(`${contractId}: missing input ${port}`, 'MISSING_INPUT');
    for (const port of Object.keys(inRefs)) if (!(port in c.in)) fault(`${contractId}: unexpected input ${port}`, 'EXTRA_INPUT');
    for (const [port, ref] of Object.entries(inRefs)) {
      const problems = validate(ref.value, c.in[port], `${contractId}.in.${port}`);
      if (problems.length) fault(problems.join('; '), 'INPUT_SCHEMA', problems);
    }

    const frame = { deps: new Map(), pdeps: state.pathFill ? new Map() : null, path: nodePath, impure: impl.pure === false, calls: node.calls, tick, decisions: [] };
    const key = `${impl.id}@${impl.version}|${Object.keys(inRefs).sort().map((p) => `${p}=${inRefs[p].hash}`).join('&')}`;
    const outFrom = (port) => ({ kind: 'call', call: id, port });
    // Merge a finished subtree's dependencies into the parent. A tick read beneath a drive belongs to the drive, not above it.
    const mergeUp = (deps, pdeps) => {
      for (const [res, v] of deps) if (!(res === TICK_DEP && tickOverride !== false)) setDep(parent.deps, res, v);
      if (parent.pdeps && pdeps) for (const [rel, v] of pdeps) setDep(parent.pdeps, `${myKey}/${rel}`, v);
    };

    // Cache lookup: valid only if every implementation choice (and tick read) the entry depended on still holds.
    if (state.cacheOn && impl.pure !== false && cache.has(key)) {
      const tickOk = (e) => e.deps.every(([res, v]) => res !== TICK_DEP || String(tick) === v);
      let seen = new Set(); // fill keys this entry's validation consulted; they count as used only if the entry is served
      const flatOk = (e) => e.deps.every(([res, v]) => {
        if (res === TICK_DEP) return true;
        if (res.startsWith(SUM_DEP)) return implementationsOf(res.slice(SUM_DEP.length).split('#')[0]).map((i) => i.id).join(',') === v;
        const [cid, sl] = res.split('#');
        try { return choose(cid, fill, sl, seen).id === v; } catch { return false; }
      });
      // Under a path fill only path-aware entries qualify: each choice is re-made at its own relative call path.
      const pathOk = (e) => e.pdeps !== null && e.pdeps.every(([rel, v]) => {
        const segs = rel.split('/'); const [cid, sl] = segs.pop().split('#');
        try { return choose(cid, fill, sl, seen, [...nodePath, ...segs]).id === v; } catch { return false; }
      });
      const hit = cache.get(key).find((e) => { seen = new Set(); return tickOk(e) && (state.pathFill ? pathOk(e) : flatOk(e)); });
      if (hit) for (const k of seen) { state.consulted.add(k); if (!reachOf(state, k).includes(id)) reachOf(state, k).push(id); }
      if (hit) {
        stats.cacheHits += 1;
        if (++state.calls > state.maxCalls) fault(`call count exceeds ${state.maxCalls}`, 'CALL_LIMIT');
        node.cached = true;
        node.cachedFrom = { run: hit.run, call: hit.call };
        if (hit.verdicts.length) node.verdicts = hit.verdicts;
        if (hit.decisions?.length) node.decisions = hit.decisions;
        mergeUp(hit.deps, hit.pdeps);
        const refs = {};
        for (const [port, hash] of Object.entries(hit.out)) {
          node.out[port] = { hash, from: { kind: 'cached' } };
          refs[port] = new Ref(parts.get(hash), hash, outFrom(port), runId);
        }
        return Object.freeze(refs);
      }
      stats.cacheRejectedByDeps += 1;
    }
    stats.cacheMisses += 1;
    if (++state.calls > state.maxCalls) fault(`call count exceeds ${state.maxCalls}`, 'CALL_LIMIT');

    const inputs = Object.fromEntries(Object.entries(inRefs).map(([p, r]) => [p, new Ref(r.value, r.hash, { kind: 'input', call: id, port: p }, runId)]));
    const local = (x) => mint(x, null, runId);
    const checkSlot = (target, sl) => {
      const declared = impl.slots[target];
      if (declared && !declared.includes(sl ?? null)) fault(`${impl.id} called ${target}${sl ? `#${sl}` : ' without a slot'}; it declares only ${declared.map((d) => `${target}#${d}`).join(', ')}`, 'UNDECLARED_SLOT');
    };
    const ctx = Object.freeze({
      call(target, args, opts) {
        if (!impl.uses.includes(target)) fault(`${impl.id} called undeclared contract ${target}`, 'UNDECLARED_CALL');
        checkSlot(target, opts?.slot);
        const normalized = Object.fromEntries(Object.entries(args ?? {}).map(([p, v]) => [p, mint(v, { kind: 'computed' }, runId, `${target}.in.${p}`)]));
        return invoke(target, normalized, frame, depth + 1, state, fill, runId, opts?.slot, false);
      },
      /**
       * ctx.sum(contract, args, { slot }) (seq 62): every implementation of the contract, each as its own child call (pinned by
       * extending the fill), as another way to the same output. Returns [{ impl, outputs } | { impl, error }]; a throwing way is
       * recorded, not thrown. The node records the sum, so the provenance polynomial multiplies through it: this node's
       * polynomial is its implementation × its other calls × Σ over each sum's ways. The node's cache entry depends on the set of
       * implementations, so it stays valid until one is added or removed.
       */
      sum(target, args, opts) {
        if (!impl.uses.includes(target)) fault(`${impl.id} summed undeclared contract ${target}`, 'UNDECLARED_CALL');
        checkSlot(target, opts?.slot);
        const normalized = Object.fromEntries(Object.entries(args ?? {}).map(([p, v]) => [p, mint(v, { kind: 'computed' }, runId, `${target}.in.${p}`)]));
        const key = slotKey(target, opts?.slot), ways = implementationsOf(target);
        const had = frame.deps.has(key), before = frame.deps.get(key), hadP = frame.pdeps?.has(key), beforeP = frame.pdeps?.get(key);
        const terms = ways.map((way) => {
          const at = node.calls.length;
          try {
            const outputs = invoke(target, normalized, frame, depth + 1, state, { ...(fill ?? {}), [key]: way.id }, runId, opts?.slot, false);
            return { impl: way.id, call: node.calls[at].id, outputs };
          } catch (error) {
            return { impl: way.id, call: node.calls[at]?.id ?? null, error: { code: error.code ?? 'IMPL_ERROR', message: error.message } };
          }
        });
        // The sum used every way on purpose: record that, instead of a conflict between the ways' individual choices.
        if (had) frame.deps.set(key, before); else frame.deps.delete(key);
        if (frame.pdeps) { if (hadP) frame.pdeps.set(key, beforeP); else frame.pdeps.delete(key); }
        setDep(frame.deps, `${SUM_DEP}${key}`, ways.map((w) => w.id).join(','));
        (node.sums ??= []).push({ contract: target, slot: opts?.slot ?? null, terms: terms.map(({ impl: i, call, error }) => ({ impl: i, call, ...(error ? { error } : {}) })) });
        return terms.map(({ impl: i, outputs, error }) => (error ? { impl: i, error } : { impl: i, outputs }));
      },
      at(ref, ...path) {
        if (!isRef(ref)) fault('ctx.at needs a Ref', 'NOT_A_REF');
        const r = local(ref);
        let v = r.value;
        for (const k of path) {
          if (v === null || typeof v !== 'object' || !(k in v)) fault(`ctx.at: path ${path.join('.')} missing`, 'BAD_PATH');
          v = v[k];
        }
        return mint(v, { kind: 'at', of: r.from, path }, runId, 'at');
      },
      /** Inverse of at: build an array or object from Refs (and plain values) with each piece's provenance kept. */
      gather(structure) {
        const pieces = [];
        const build = (x, path) => {
          if (isRef(x)) { const r = local(x); pieces.push({ path, from: r.from }); return r.value; }
          if (Array.isArray(x)) return x.map((v, i) => build(v, [...path, i]));
          if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, build(v, [...path, k])]));
          pieces.push({ path, from: { kind: 'computed' } });
          return x;
        };
        return mint(build(structure, []), { kind: 'gather', pieces }, runId, 'gather');
      },
      /** Concatenate arrays (Refs or plain); every element keeps a path back into the array it came from. */
      concat(...arrays) {
        const pieces = []; const value = [];
        for (const a of arrays) {
          if (isRef(a)) {
            const r = local(a);
            if (!Array.isArray(r.value)) fault('ctx.concat: a Ref is not an array', 'NOT_AN_ARRAY');
            r.value.forEach((v, i) => { pieces.push({ path: [value.length], from: { kind: 'at', of: r.from, path: [i] } }); value.push(v); });
          } else if (Array.isArray(a)) {
            for (const v of a) {
              if (isRef(v)) { const r = local(v); pieces.push({ path: [value.length], from: r.from }); value.push(r.value); }
              else { pieces.push({ path: [value.length], from: { kind: 'computed' } }); value.push(v); }
            }
          } else fault('ctx.concat takes arrays', 'NOT_AN_ARRAY');
        }
        return mint(value, { kind: 'gather', pieces }, runId, 'concat');
      },
      /**
       * A relation over Refs (or plain values) as a boolean Ref whose provenance names every operand:
       * ctx.test({ gt: [penaltyRef, 0] }) -> Ref(true) from { kind: 'test', op: 'gt', args: [from of penalty, { kind: 'literal', value: 0 }] }.
       */
      test(t) {
        const op = testOp(t);
        if (!op) fault(`ctx.test needs one of ${Object.keys(TESTS).join(', ')}`, 'BAD_TEST');
        const operands = testArgs(t, op).map((a) => {
          if (testOp(a)) return ctx.test(a);
          if (isRef(a)) { const r = local(a); return r.from.kind === 'literal' ? { value: r.value, from: { kind: 'literal', value: r.value } } : r; }
          return { value: a, from: { kind: 'literal', value: a } };
        });
        const r = applyTest(op, operands.map((o) => o.value));
        if (r.error) fault(`ctx.test: ${r.error}`, op === 'not' || op === 'and' || op === 'or' ? 'NOT_A_BOOLEAN' : 'BAD_TEST');
        return mint(r.value, { kind: 'test', op, args: operands.map((o) => o.from) }, runId, 'test');
      },
      /**
       * Read a boolean (a Ref, or a test object as for ctx.test) and record the decision with the provenance of what decided it.
       * branches: { true: name, false: name } (or one name, guarded by true) records which named side ran and which was skipped.
       */
      when(cond, label = null, branches = null) {
        const r = testOp(cond) ? ctx.test(cond) : isRef(cond) ? local(cond) : null;
        const value = r ? r.value : cond;
        if (typeof value !== 'boolean') fault(`ctx.when needs a boolean, got ${typeof value}`, 'NOT_A_BOOLEAN');
        const d = { label, value, from: r ? r.from : { kind: 'computed' } };
        const b = typeof branches === 'string' ? { true: branches } : branches;
        if (b) {
          if (b[value] !== undefined) d.ran = b[value];
          if (b[!value] !== undefined) d.skipped = b[!value];
        }
        (node.decisions ??= []).push(d);
        return value;
      },
      /**
       * Fold a tick contract inside this call: each tick is a child call with its own tick index (startTick, startTick+1, ...).
       * opts: { ticks? | until?(outputs, tick), maxTicks?, each?(tick, stateValue, stateRef), slot?, startTick?, collect?: [port] }
       * Returns the last tick's output Refs, `ticks` (how many ran) and, with collect, `collected: { port: Ref }`: an array of
       * that port's value at every tick, gathered so each element points at its tick's call. Zero ticks returns the input state.
       * The drive is recorded on this node: node.drives = [{ contract, slot, startTick, ticks, stopped, calls: [ids] }].
       */
      drive(target, args, opts = {}) {
        if (!impl.uses.includes(target)) fault(`${impl.id} called undeclared contract ${target}`, 'UNDECLARED_CALL');
        if (contracts.get(target).kind !== 'tick') fault(`${target} is not a tick`, 'NOT_A_TICK');
        checkSlot(target, opts.slot);
        if (opts.ticks === undefined && typeof opts.until !== 'function') fault('ctx.drive needs ticks or until', 'UNBOUNDED_DRIVE');
        const max = opts.ticks ?? opts.maxTicks ?? 10_000;
        const start = opts.startTick ?? 0;
        const collect = opts.collect ?? [];
        for (const p of collect) if (!(p in contracts.get(target).out)) fault(`ctx.drive collect: ${target} has no output ${p}`, 'BAD_COLLECT');
        let current = Object.fromEntries(Object.entries(args).map(([p, v]) => [p, mint(v, { kind: 'computed' }, runId, `${target}.in.${p}`)]));
        let last = null; let n = 0; let stopped = 'ticks';
        const calls = []; const series = Object.fromEntries(collect.map((p) => [p, []]));
        for (; n < max; n += 1) {
          const k = start + n;
          const extra = opts.each ? opts.each(k, current.state.value, current.state) : {};
          const normalized = { ...current, ...Object.fromEntries(Object.entries(extra).map(([p, v]) => [p, mint(v, { kind: 'computed' }, runId)])) };
          last = invoke(target, normalized, frame, depth + 1, state, fill, runId, opts.slot, k);
          calls.push(node.calls[node.calls.length - 1].id);
          for (const p of collect) series[p].push(last[p]);
          current = { ...current, state: last.state };
          if (opts.until && opts.until(Object.fromEntries(Object.entries(last).map(([p, r]) => [p, r.value])), k)) { n += 1; stopped = 'until'; break; }
        }
        if (stopped !== 'until' && n === max && opts.ticks === undefined) stopped = 'maxTicks';
        (node.drives ??= []).push({ contract: target, slot: opts.slot ?? null, startTick: start, ticks: n, stopped, calls });
        const result = last ? { ...last } : { state: current.state };
        result.ticks = n;
        if (collect.length) result.collected = Object.fromEntries(collect.map((p) => [p, ctx.gather(series[p])]));
        return result;
      },
      literal: (value) => mint(value, { kind: 'literal' }, runId, 'literal'),
      random() {
        if (!state.random) fault(`${impl.id} needs randomness but the run has no seed`, 'SEED_REQUIRED');
        frame.impure = true;
        return state.random();
      },
      /** The current tick. Reading it makes this call's cache entry valid only at the same tick. */
      tick() {
        frame.deps.set(TICK_DEP, String(frame.tick));
        return frame.tick;
      },
      value: (x) => (isRef(x) ? x.value : x),
      fault: (message, code = 'IMPL_FAULT') => fault(message, code),
      [INTERNAL]: Object.freeze({
        mint: (value, from) => mint(value, from, runId, 'internal'),
        decide: (label, value, from, names) => { (node.decisions ??= []).push({ label, value, from, ...names }); },
      }),
    });

    let result;
    try {
      result = impl.run(inputs, ctx);
    } catch (error) {
      if (!node.error) {
        node.error = error.originCall === undefined
          ? { code: error.code ?? 'IMPL_ERROR', message: error.message }
          : { code: error.code ?? 'IMPL_ERROR', message: error.message, via: error.originCall };
      }
      if (error.originCall === undefined) error.originCall = id;
      throw error;
    }
    if (result && typeof result.then === 'function') fault(`${impl.id} returned a Promise; run is synchronous`, 'ASYNC_RUN');
    if (!result || typeof result !== 'object') fault(`${impl.id} must return an object of output ports`, 'BAD_OUTPUT');
    const refs = {};
    for (const port of Object.keys(c.out)) {
      if (!(port in result)) fault(`${impl.id} did not return ${port}`, 'MISSING_OUTPUT');
      const raw = result[port];
      if (raw === SKIPPED) fault(`${impl.id} returned ${port} from a skipped step`, 'SKIPPED_OUTPUT');
      const value = isRef(raw) ? raw.value : raw;
      const problems = validate(value, c.out[port], `${contractId}.out.${port}`);
      if (problems.length) fault(problems.join('; '), 'OUTPUT_SCHEMA', problems);
      const { hash, value: frozen } = intern(value, `${contractId}.out.${port}`);
      node.out[port] = { hash, from: isRef(raw) ? local(raw).from : { kind: 'computed' } };
      refs[port] = new Ref(frozen, hash, outFrom(port), runId);
    }
    for (const port of Object.keys(result)) if (!(port in c.out)) fault(`${impl.id} returned extra port ${port}`, 'EXTRA_OUTPUT');

    // Propagate implementation choices, tick reads and impurity upward, then cache if this subtree is pure.
    mergeUp(frame.deps, frame.pdeps);
    if (frame.impure) { parent.impure = true; node.impure = true; }
    if (state.cacheOn && !frame.impure) {
      const entry = { out: Object.fromEntries(Object.entries(node.out).map(([p, o]) => [p, o.hash])), run: runId, call: id, deps: [...frame.deps],
        pdeps: frame.pdeps ? [...frame.pdeps] : null, verdicts: collectVerdicts(node), decisions: node.decisions ?? [] };
      if (!cache.has(key)) cache.set(key, []);
      cache.get(key).push(entry);
    }
    return Object.freeze(refs);
  }

  // ---------------------------------------------------------------- time
  /**
   * drive(contractId, inputs, { ticks?, until?(outputs, tick), each?(tick, stateValue, stateRef) -> extra inputs, fill?, seed?, cache?, maxCalls? })
   * Runs a tick contract once per tick, each tick its own run. Tick k's state input is the Ref tick k-1 returned,
   * so consecutive ticks are linked by a cross-run edge. Each receipt carries its tick and replays on its own.
   */
  function drive(contractId, inputs, options = {}) {
    const c = contracts.get(contractId) ?? fail(`unknown contract ${contractId}`, 'UNKNOWN_CONTRACT');
    if (c.kind !== 'tick') fail(`${contractId} is a ${c.kind}, not a tick`, 'NOT_A_TICK');
    if (options.ticks === undefined && typeof options.until !== 'function') fail('drive needs ticks or until', 'UNBOUNDED_DRIVE');
    const max = options.ticks ?? options.maxTicks ?? 100_000;
    checkFill(options.fill);
    const receipts = [];
    const consulted = new Set(); const reach = new Map(); const slotsSeen = new Set();
    let stateRef = inputs.state;
    let last = null;
    const start = options.startTick ?? 0;
    for (let k = start; k < start + max; k += 1) {
      const extra = options.each ? options.each(k, isRef(stateRef) ? stateRef.value : stateRef, isRef(stateRef) ? stateRef : null) : {};
      const r = run(contractId, { ...inputs, ...extra, state: stateRef }, {
        fill: options.fill, cache: options.cache, tick: k, maxCalls: options.maxCalls, allowUnusedFill: true, consulted, reach, slotsSeen,
        seed: options.seed === undefined ? undefined : [options.seed, k],
      });
      receipts.push(r.receipt);
      stateRef = r.refs.state;
      last = r;
      if (options.until && options.until(r.outputs, k)) break;
    }
    // A fill is standing configuration for the whole drive, so it is validated across every tick, not per tick.
    if (!options.allowUnusedFill) checkUnknownSlots(options.fill, consulted, options.landing, slotsSeen);
    return { receipts, final: last?.outputs ?? null, state: stateRef, ticks: receipts.length };
  }

  // ---------------------------------------------------------------- addressing
  /** Look up a recorded trace node by run and call id. */
  const nodeIndex = new Map(); // runId -> Map(callId -> node), built once per run on first lookup (runs are immutable)
  function node(runId, callId) {
    if (!nodeIndex.has(runId)) {
      const rec = typeof runId === 'number' ? runs[runId - 1] : null;
      if (!rec || rec.runId !== runId || !rec.trace) return null;
      const m = new Map();
      (function walk(n) { m.set(n.id, n); n.calls.forEach(walk); })(rec.trace);
      nodeIndex.set(runId, m);
    }
    return nodeIndex.get(runId).get(callId) ?? null;
  }

  /** A Ref to any output of any recorded call, usable in another run (it arrives as a cross-run edge). */
  function ref(runId, callId, port) {
    const n = node(runId, callId) ?? fail(`no call ${callId} in run ${runId}`, 'NO_SUCH_CALL');
    const out = n.out[port] ?? fail(`call ${callId} in run ${runId} has no output ${port}`, 'NO_SUCH_PORT');
    return new Ref(parts.get(out.hash), out.hash, { kind: 'call', call: callId, port }, runId);
  }

  // ---------------------------------------------------------------- verification
  function sameTrace(a, b, path = 'trace') {
    if (!a || !b) return a === b ? [] : [`${path}: missing node`];
    const out = [];
    for (const k of ['contract', 'impl', 'version', 'slot']) if (a[k] !== b[k]) out.push(`${path}.${k}: ${a[k]} vs ${b[k]}`);
    const h = (ports) => canonical(Object.fromEntries(Object.entries(ports).map(([p, v]) => [p, v.hash])));
    if (h(a.in) !== h(b.in)) out.push(`${path}.in hashes differ`);
    if (h(a.out) !== h(b.out)) out.push(`${path}.out hashes differ`);
    if (a.cached || b.cached) return out;
    if (a.calls.length !== b.calls.length) return [...out, `${path}: ${a.calls.length} vs ${b.calls.length} calls`];
    a.calls.forEach((child, i) => out.push(...sameTrace(child, b.calls[i], `${path}.calls[${i}]`)));
    return out;
  }

  /**
   * Re-execute a recorded run with the cache off and compare outputs and trace. Not recorded in runs().
   * Uses the receipt's own input values, so it works in a fresh world with the same registrations.
   */
  function replay(receipt, { maxCalls } = {}) {
    const fresh = run(receipt.contract, receipt.inputValues, {
      seed: receipt.seed ?? undefined, fill: receipt.fill ?? undefined, cache: false, record: false,
      tick: receipt.tick ?? undefined, maxCalls, allowUnusedFill: true,
    });
    const mismatches = [];
    if (canonical(receipt.outputs) !== canonical(fresh.receipt.outputs)) mismatches.push('outputs differ');
    mismatches.push(...sameTrace(receipt.trace, fresh.trace));
    return { exact: mismatches.length === 0, mismatches, fresh: fresh.receipt };
  }

  function close(a, b, tol) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => close(x, b[i], tol));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
      return canonical(ka) === canonical(kb) && ka.every((k) => close(a[k], b[k], tol));
    }
    return a === b;
  }

  /**
   * Run the contract's examples (and each implementation's own examples) against every implementation (or one).
   * Example: { in, out, fill?, seed?, ticks? }. With ticks (tick contracts only) the example drives that many ticks
   * and compares the final tick's outputs. Each result is a proof.
   */
  function prove(contractId, implId) {
    const c = contracts.get(contractId) ?? fail(`unknown contract ${contractId}`, 'UNKNOWN_CONTRACT');
    const targets = implId ? [impls.get(implId)] : implementationsOf(contractId);
    const results = [];
    for (const impl of targets) {
      const examples = [...c.examples.map((ex, i) => ({ ex, label: ex.name ?? i })), ...impl.examples.map((ex, i) => ({ ex, label: ex.name ?? `impl:${i}` }))];
      for (const { ex, label } of examples) {
        let ok = false; let detail = null;
        try {
          const fill = { [contractId]: impl.id, ...(ex.fill ?? {}) };
          let outputs;
          const temporal = ex.ticks !== undefined || Array.isArray(ex.each) || Array.isArray(ex.trajectory);
          const misses = [];
          if (temporal) {
            if (c.kind !== 'tick') fail(`example with ticks, each or trajectory on non-tick ${contractId}`, 'BAD_EXAMPLE');
            const start = ex.startTick ?? 0;
            const n = ex.ticks ?? ex.each?.length ?? ex.trajectory.length;
            const d = drive(contractId, ex.in, { ticks: n, fill, seed: ex.seed, startTick: ex.startTick, allowUnusedFill: true,
              each: ex.each ? (k) => ex.each[k - start] ?? {} : undefined });
            outputs = d.final;
            // A trajectory states the outputs tick by tick (only the ports it names).
            (ex.trajectory ?? []).forEach((want, i) => {
              const got = d.receipts[i] ? Object.fromEntries(Object.keys(want).map((p) => [p, parts.get(d.receipts[i].outputs[p])])) : null;
              if (!got || !Object.keys(want).every((p) => close(got[p], want[p], c.tolerance))) misses.push(`tick ${start + i}: expected ${canonical(want)} got ${got ? canonical(got) : 'nothing'}${ex.each?.[i] && Object.keys(ex.each[i]).length ? ` (inputs ${canonical(ex.each[i])})` : ''}`);
            });
          } else {
            outputs = run(contractId, ex.in, { fill, seed: ex.seed, tick: ex.tick, allowUnusedFill: true }).outputs;
          }
          const want = ex.out ?? {};
          if (!Object.keys(want).every((p) => close(outputs[p], want[p], c.tolerance))) misses.push(`expected ${canonical(want)} got ${canonical(Object.fromEntries(Object.keys(want).map((p) => [p, outputs[p]])))}`);
          ok = misses.length === 0;
          if (!ok) detail = misses.join('; ');
        } catch (e) { detail = `${e.code ?? 'ERROR'}: ${e.message}`; }
        const proof = deepFreeze({ contract: contractId, impl: impl.id, example: label, ok, detail });
        proofs.push(proof); results.push(proof);
      }
    }
    return results;
  }

  function ledger() {
    return [...contracts.values()].map((c) => ({
      contract: c.id, kind: c.kind, in: Object.keys(c.in), out: Object.keys(c.out), examples: c.examples.length,
      implementations: implementationsOf(c.id).map((i) => {
        const ps = proofs.filter((p) => p.impl === i.id);
        return { id: i.id, uses: [...i.uses], composed: Boolean(i.assembly), pure: i.pure, ownExamples: i.examples.length,
          status: ps.length === 0 ? 'unproven' : ps.every((p) => p.ok) ? 'proven' : 'failing' };
      }),
    }));
  }

  return Object.freeze({
    name, contract, implement, compose, select, implementationsOf, run, sum, evaluate, drive, replay, prove, ledger, node, ref,
    contracts: () => [...contracts.values()],
    implementations: () => [...impls.values()],
    runs: () => [...runs],
    part: (hash) => parts.get(hash),
    stats: () => ({ ...stats, parts: parts.size, cacheEntries: [...cache.values()].reduce((a, l) => a + l.length, 0), runs: runs.length }),
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
