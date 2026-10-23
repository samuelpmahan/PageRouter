// Every way this disc could be a card: the kernel's world.sum over thro.card.way (one implementation per layout) and world.evaluate
// (kernel seq 62, sublated from Capability Lab). Each answer is checked against rung 7's Lab-only path and a plain recount.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { everyWay } from '../../experiences/thro/ways.mjs';
import { readingOf, orderFit, PARTS, createThroWorld } from '../../experiences/thro/thro-world.mjs';
import { createRegistry } from '../../experiences/thro/pxc/lab/runtime.mjs';
import { capabilities as labSemirings } from '../../experiences/thro/pxc/lab/semiring.mjs';

// Measured by the renderer for the Servo in all 11 Single layouts (thumbnails, iter-34).
const measured = { u01: [251, 63.4, 25.1, 18.5], u02: [264, 66, 26.4, 19.8], 'u03-front': [238, 50.2, 27.7, 0], 'u03-behind': [238, 50.2, 27.7, 0], u04: [238, 73.9, 29, 19.8], u05: [251, 60.7, 25.1, 19.8], b01: [277, 68.6, 29, 22.4], b02: [251, 79.2, 29, 22.4], b03: [224, 66, 29, 22.4], b04: [185, 58.1, 23.8, 0], b05: [224, 63.4, 22.4, 21.1] };
const layouts = Object.entries(measured).map(([id, [photo, name, numbers, other]]) => ({ study: `discstudio:${id}`, name: id, layout: { photo: { w: photo }, name: { size: name }, numbers: { size: numbers }, other: other ? [{ text: 'MVP', size: other }] : [] } }));
const disc = { name: 'Servo', flights: [6.5, 5, -1, 2] };
const world = createThroWorld();
const recount = intended => layouts.map(l => ({ study: l.study, ...orderFit(readingOf(l.layout, disc.name, disc.flights), intended), quiet: l.layout.other[0]?.size ?? 0 }));

test('the vendored kernel (with its Lab copies) is byte-identical to its pin', () => {
  const dir = new URL('../../experiences/thro/pxc/', import.meta.url), pin = JSON.parse(fs.readFileSync(new URL('PIN.json', dir)));
  for (const { path, sha256 } of pin.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(path, dir))).digest('hex'), sha256, path);
  assert.ok(pin.files.some(f => f.path === 'lab/semiring.mjs'));
});

// Rung 7's path, kept here as the reference: the same sum built by hand and evaluated by the Lab's provenance.evaluate directly.
function rung7(intended) {
  const lab = createRegistry(labSemirings, { source: 'capability-lab', version: '1' });
  const ways = layouts.map(l => { const r = readingOf(l.layout, disc.name, disc.flights), fit = orderFit(r, intended); return { study: l.study, keeps: fit.keeps, comfort: fit.keeps ? 1 - 1 / fit.margin : 0, quiet: Math.round(r.other.size * 10) / 10 }; });
  const polynomial = ways.map(w => [`layout:${w.study}`, `keeps:${w.study}`]);
  const vals = f => ways.flatMap(w => [{ variable: `layout:${w.study}`, ...f(w, 'layout') }, ...(w.keeps ? [{ variable: `keeps:${w.study}`, ...f(w, 'keeps') }] : [])]);
  const ev = (semiring, f) => lab.execute('provenance.evaluate', { semiring, polynomial, values: vals(f) }).result.value;
  return { possible: ev('boolean', () => ({})).present, count: ev('counting', () => ({ weight: 1 })).weight ?? 0,
    comfort: ev('viterbi', (w, k) => ({ weight: k === 'keeps' ? w.comfort : 1 })).weight ?? 0, quiet: ev('tropical', (w, k) => ({ weight: k === 'layout' ? w.quiet : 0 })).weight ?? null };
}

test('parity: the kernel\'s world.sum + world.evaluate give rung 7\'s Lab answers for the same measurements', () => {
  for (const intended of [PARTS, ['name', 'disc', 'numbers', 'other'], ['disc', 'name', 'other', 'numbers']]) {
    const { answers } = everyWay({ world, layouts, disc, intended });
    const expected = rung7(intended);
    assert.deepEqual({ possible: answers.possible, count: answers.count, comfort: answers.comfort, quiet: answers.quiet }, expected, intended.join(' > '));
  }
});

test('under the scaffold order, every answer matches a plain recount', () => {
  const { answers, ways } = everyWay({ world, layouts, disc });
  const plain = recount(PARTS), keeping = plain.filter(w => w.keeps);
  assert.equal(answers.of, 11);
  assert.equal(answers.count, keeping.length);
  assert.equal(answers.possible, keeping.length > 0);
  const best = keeping.reduce((a, b) => (b.margin > a.margin ? b : a));
  assert.equal(answers.mostComfortable, best.study);
  assert.ok(Math.abs(1 / (1 - answers.comfort) - best.margin) < 1e-9);
  assert.equal(answers.quiet, Math.min(...keeping.map(w => w.quiet)));
  assert.deepEqual(ways.map(w => w.keeps), plain.map(w => w.keeps));
  assert.equal(answers.polynomial, 11, 'one term per measured layout, from world.sum');
  assert.ok(answers.restsOn.includes('order disc > name > numbers > rest'));
});

test('the person\'s order changes the sum: name first is unsatisfiable with these layouts', () => {
  const { answers } = everyWay({ world, layouts, disc, intended: ['name', 'disc', 'numbers', 'other'] });
  assert.deepEqual([answers.possible, answers.count, answers.mostComfortable, answers.restsOn], [false, 0, null, []]);
  const quietFirst = everyWay({ world, layouts, disc, intended: ['disc', 'name', 'other', 'numbers'] }).answers;
  assert.equal(quietFirst.count, recount(['disc', 'name', 'other', 'numbers']).filter(w => w.keeps).length);
});

test('a layout that was not measured is a missing term, not a guess', () => {
  const some = layouts.slice(0, 4);
  const { polynomial, answers } = everyWay({ world, layouts: some, disc });
  assert.equal(polynomial.length, 4);
  assert.equal(answers.of, 4);
});
