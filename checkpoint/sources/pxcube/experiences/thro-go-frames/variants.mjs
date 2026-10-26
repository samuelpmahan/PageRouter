// Candidate departures, derived from the frames: for every instance of every input frame and every terminal of it,
//   * each soft expectation's own violating value          (kind 'expectation')
//   * each boundary the terminal declares                   (kind 'boundary')
//   * each variant the terminal declares                    (kind 'variant')
//   * every other value of an enum terminal that has none   (kind 'enum')
// A candidate is { frame, terminal, instanceId, kind, expectationId, slot, label, patches, expect }. Candidates with the same slot are the same
// KIND of situation on different instances; the Case generator takes one of each slot.
import { FRAMES, effectiveTerminals } from './frames.mjs';
import { set } from './patches.mjs';
import { fnv32 } from './util.mjs';

// A label with names, quoted titles and numbers blanked: two labels with the same shape describe the same kind of departure.
export const shapeOf = (label) => label.replace(/“[^”]*”/g, '“_”').replace(/\d+/g, '#').replace(/\b[A-Z][A-Za-z.&-]*(?: [A-Z][A-Za-z.&-]*)*\b/g, '_').replace(/\s+/g, ' ');

export function candidatesFor(W, inst) {
  const frame = FRAMES[inst.frame];
  if (frame.role !== 'input') return [];
  const out = [];
  const add = (terminal, kind, expectationId, v) => out.push({ frame: inst.frame, terminal, instanceId: inst.id, kind, expectationId, slot: `${inst.frame}.${terminal}|${kind}|${expectationId ?? ''}|${kind === 'enum' ? '' : shapeOf(v.label)}`, label: v.label, patches: v.patches, expect: v.expect ?? null });
  for (const [name, def] of Object.entries(effectiveTerminals(inst.frame))) {
    if (def.derive) continue;
    for (const e of def.expect) if (e.mismatch && e.violate) for (const v of e.violate(inst, W)) add(name, 'expectation', e.id, v);
    if (def.boundaries) for (const v of def.boundaries(inst, W)) add(name, 'boundary', null, v);
    if (def.variants) for (const v of def.variants(inst, W)) add(name, 'variant', null, v);
    if (!def.variants && def.type.startsWith('enum:')) {
      for (const val of def.type.slice(5).split('|')) {
        if (val === inst.t[name]) continue;
        const patches = [set(inst.id, name, val)];
        if (inst.frame === 'Appearance' && name === 'mode' && val === 'talked') patches.push(set(inst.id, 'evidence', 'creator-marked'));
        add(name, 'enum', null, { label: `${name} is ${val} instead of ${inst.t[name]}`, patches });
      }
    }
  }
  return out;
}

export function allCandidates(W) {
  const out = [];
  for (const inst of W.instances) out.push(...candidatesFor(W, inst));
  return out;
}

// One candidate per slot, picked by a seeded rotation over the slot's candidates (so different slots land on different creators, videos and discs).
export function pickPerSlot(candidates, seed) {
  const slots = new Map();
  for (const c of candidates) (slots.get(c.slot) ?? slots.set(c.slot, []).get(c.slot)).push(c);
  return [...slots.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([slot, list]) => {
    list.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
    const start = fnv32(`${seed}|${slot}`) % list.length;
    return { slot, ordered: [...list.slice(start), ...list.slice(0, start)] };
  });
}
