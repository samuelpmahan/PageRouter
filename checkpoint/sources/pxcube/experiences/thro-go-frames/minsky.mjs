// The Minsky machinery. A frame instance whose terminals break one of the frame's own expectations is not an error: the expectation's
// `mismatch` string names what to do, and this module does it. Nothing here knows about any particular rule; the rules are in frames.mjs.
//
//   'frame:X'      replace the violating instance by alternate frame X, instantiated from the violating instance's own terminals
//                  (X inherits its parent frame, so every terminal and expectation comes along) and then keep evaluating the alternate:
//                  its own and inherited expectations may fail in turn and select the next alternate. That is a CHAIN.
//   'transform:Y'  call the named transformation (TRANSFORMS[Y]); it returns data the enrichment obeys (drop, clamp, range offsets, credit level)
//   'resolve:Z'    call the named resolver; it returns either a transformation result or { frame: 'X' }
import { FRAMES, effectiveTerminals, violationsOf, defaultValue } from './frames.mjs';
import { resolveMold } from './world.mjs';
import { clone } from './util.mjs';

const durationOf = (W, videoId) => W.get(videoId)?.t.durationSeconds ?? Infinity;

export const TRANSFORMS = {
  'transform:drop-inverted': ({ inst }) => ({ name: 'drop-inverted', drop: 'inverted', detail: `ends at ${inst.t.endSec} s, before it starts at ${inst.t.startSec} s: dropped and listed as a data issue` }),
  'transform:drop-zero-length': ({ inst }) => ({ name: 'drop-zero-length', drop: 'zero-length', detail: `starts and ends at ${inst.t.startSec} s: ignored and listed as a data issue` }),
  'transform:drop-beyond-end': ({ inst, W }) => ({ name: 'drop-beyond-end', drop: 'beyond-end', detail: `starts at ${inst.t.startSec} s but the video is ${durationOf(W, inst.t.videoId)} s long: dropped` }),
  'transform:clamp-to-video-end': ({ inst, W }) => ({ name: 'clamp-to-video-end', clampEndTo: durationOf(W, inst.t.videoId), from: inst.t.endSec, detail: `end ${inst.t.endSec} s clamped to the video end ${durationOf(W, inst.t.videoId)} s` }),
  'transform:interval-offsets': ({ inst }) => ({ name: 'interval-offsets', offsets: 'range', detail: `release known to ${inst.t.date} only: offsets reported as ranges` }),
  'transform:attribute-to-video': ({ inst }) => ({ name: 'attribute-to-video', credit: 'video', detail: `timestamp ${inst.t.videoTimestamp} s is outside every card of the disc: credited to the video, not a moment` }),
  'resolve:name-or-provisional': ({ inst, W }) => {
    const r = resolveMold(W, inst);
    return r ? { name: 'resolve-by-name', resolvedMoldId: r.mold.id, detail: `typed “${inst.t.moldName}” resolved to catalog mold “${r.mold.t.name}” by normalised spelling` } : { frame: 'ProvisionalMoldDisc', detail: `“${inst.t.moldName}” is not in the catalog: a provisional mold stands in, brand unknown` };
  },
};

// The handler for a mismatch string. 'frame:X' is generic; the others are looked up by their full string.
export function handlerFor(mismatch) {
  if (mismatch.startsWith('frame:')) return ({ inst, v }) => ({ frame: mismatch.slice(6), detail: `${v.text.replace(/\.$/, '')} — not so here, so frame ${mismatch.slice(6)} applies` });
  const h = TRANSFORMS[mismatch];
  if (!h) throw new Error(`no handler for mismatch “${mismatch}”`);
  return h;
}
export const allMismatches = () => {
  const out = new Set();
  for (const f of Object.values(FRAMES)) for (const def of Object.values(f.terminals)) for (const e of def.expect) if (e.mismatch) out.add(e.mismatch);
  return [...out].sort();
};

// Build alternate frame X from a violating instance: copy every terminal X shares with it, fill X's own terminals, keep the link back.
export function instantiate(frameId, from, W, ctx) {
  // the alternate keeps every slot of the instance it replaces (so the source frame's expectations can still be read), then fills its own
  const t = clone(from.t), how = Object.fromEntries(Object.keys(from.t).map((k) => [k, 'inherited']));
  for (const [name, def] of Object.entries(effectiveTerminals(frameId))) {
    if (name in from.t && !def.fill) continue;
    if (def.fill) { t[name] = def.fill(from, W, ctx); how[name] = 'filled'; }
    else { t[name] = defaultValue(def); how[name] = 'default'; }
  }
  return { frame: frameId, t, how };
}

// Evaluate every input instance, follow its mismatches, and return what was selected.
//   alternates   every alternate instance (id `${root}~${Frame}`), each with parent / root / vias
//   chains       rootId -> [alternate ids in order]
//   transforms   rootId -> [{ expectationId, name, ...effect }]
//   notes        one line per handled mismatch (what the page shows as "the expectation failed, so ...")
//   violations   every violated expectation of the input instances, hard ones included
export function selectAlternates(W) {
  const alternates = [], chains = {}, transforms = {}, notes = [], violations = [];
  for (const root of W.instances) {
    if (FRAMES[root.frame].role !== 'input') continue;
    const first = violationsOf(W, root);
    if (!first.length) continue;
    violations.push(...first);
    if (!first.some((v) => v.mismatch)) continue;
    const consumed = new Set(), chain = [];
    let cur = root;
    for (let guard = 0; guard < 16; guard++) {
      const viol = (cur === root ? first : violationsOf(W, cur, consumed)).filter((v) => v.mismatch && !consumed.has(`${v.terminal}#${v.expectationId}`));
      let next = null;
      for (const v of viol) {
        const key = `${v.terminal}#${v.expectationId}`;
        const r = handlerFor(v.mismatch)({ W, inst: cur, root, v });
        if (r.frame) {
          const existing = chain.find((a) => a.frame === r.frame);
          if (existing) { existing.vias.push(v.expectationId); consumed.add(key); notes.push({ instanceId: root.id, onAlternate: cur === root ? null : cur.id, terminal: v.terminal, expectationId: v.expectationId, mismatch: v.mismatch, action: `frame:${r.frame}`, detail: `${r.detail} (already in the chain: reason added)` }); continue; }
          if (next) continue; // one frame change per step; the other violations stay unconsumed and are re-evaluated on the alternate
          consumed.add(key);
          next = { frame: r.frame, vias: [v.expectationId], detail: r.detail, v };
        } else {
          consumed.add(key);
          (transforms[root.id] ??= []).push({ expectationId: v.expectationId, ...r });
          notes.push({ instanceId: root.id, onAlternate: cur === root ? null : cur.id, terminal: v.terminal, expectationId: v.expectationId, mismatch: v.mismatch, action: v.mismatch, detail: r.detail });
        }
      }
      if (!next) break;
      const ctx = { vias: next.vias, root };
      const alt = instantiate(next.frame, cur, W, ctx);
      alt.id = `${root.id}~${next.frame}`;
      alt.root = root.id; alt.rootFrame = root.frame; alt.parent = cur.id; alt.vias = next.vias; alt.depth = chain.length + 1;
      notes.push({ instanceId: root.id, onAlternate: cur === root ? null : cur.id, terminal: next.v.terminal, expectationId: next.v.expectationId, mismatch: next.v.mismatch, action: `frame:${next.frame}`, detail: next.detail, alternateId: alt.id });
      chain.push(alt); alternates.push(alt);
      cur = alt;
    }
    if (chain.length) chains[root.id] = chain.map((a) => a.id);
  }
  return { alternates, chains, transforms, notes, violations };
}
