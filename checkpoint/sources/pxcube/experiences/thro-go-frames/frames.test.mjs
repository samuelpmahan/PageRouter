// Fast tests of the frame system itself (no pipeline run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES, makeInstance, effectiveExpect, frameSystem, defaultValue, typeProblems, violationsOf } from './frames.mjs';
import { indexWorld } from './world.mjs';
import { buildSeason } from './season.mjs';
import { selectAlternates } from './minsky.mjs';

const W = indexWorld(buildSeason(20261025));

test('the shared season has no type problems and no violated hard expectation', () => {
  assert.deepEqual(typeProblems(W), []);
  for (const inst of W.instances) if (FRAMES[inst.frame].role === 'input') assert.deepEqual(violationsOf(W, inst).filter((v) => !v.mismatch), [], inst.id);
});

test('frames: terminals have type, default and expectations; abstract frames are only parents', () => {
  for (const [id, f] of Object.entries(FRAMES)) {
    assert.ok(['input', 'abstract', 'alternate'].includes(f.role), id);
    for (const [name, def] of Object.entries(f.terminals)) { assert.ok(def.type, `${id}.${name}`); assert.ok(Array.isArray(def.expect)); for (const e of def.expect) assert.ok(e.id && e.text && typeof e.test === 'function'); }
  }
  for (const [id, f] of Object.entries(FRAMES)) if (f.role === 'alternate') assert.ok(FRAMES[f.inherits], `${id} inherits ${f.inherits}`);
  assert.ok(frameSystem().edges.length > 20);
});

test('an alternate is instantiated from the violating instance\'s terminals and keeps the source frame\'s expectations', () => {
  const sel = selectAlternates(W);
  const alt = sel.alternates.find((a) => a.frame === 'OtherBrandAppearance');
  assert.ok(alt && alt.root && alt.parent);
  const root = W.get(alt.root);
  for (const k of ['videoId', 'discId', 'startSec', 'endSec']) assert.equal(alt.t[k], root.t[k]);
  // the alternate has every expectation of OnScreenDisc.discId, plus its own
  assert.ok(effectiveExpect(alt.frame, 'discId').length >= effectiveExpect('OnScreenDisc', 'discId').length);
  assert.ok(Object.values(FRAMES[alt.frame].terminals).some((d) => d.expect.length), 'and expectations of its own');
});

test('a frame can make a valid default instance of itself', () => {
  for (const [id, f] of Object.entries(FRAMES)) {
    if (f.role === 'abstract') continue;
    const inst = makeInstance(id, {}, { id: `x:${id}` });
    assert.equal(inst.frame, id);
    for (const [name, def] of Object.entries(f.terminals)) if (!def.derive && !(def.type.startsWith('ref'))) assert.deepEqual(inst.t[name], defaultValue(def), `${id}.${name}`);
  }
});
