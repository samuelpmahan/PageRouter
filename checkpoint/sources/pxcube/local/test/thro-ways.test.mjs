// Every way this disc could be a card (rung 7): the second use of Capability Lab's semirings. The sum over layouts goes through
// the Lab's provenance.evaluate (vendored, pinned); each answer is checked against a plain recount done without semirings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { everyWay } from '../../experiences/thro/ways.mjs';
import { readingOf, orderFit, PARTS } from '../../experiences/thro/thro-world.mjs';

// Measured by the renderer for the Servo in all 11 Single layouts (thumbnails, iter-34).
const measured = { u01: [251, 63.4, 25.1, 18.5], u02: [264, 66, 26.4, 19.8], 'u03-front': [238, 50.2, 27.7, 0], 'u03-behind': [238, 50.2, 27.7, 0], u04: [238, 73.9, 29, 19.8], u05: [251, 60.7, 25.1, 19.8], b01: [277, 68.6, 29, 22.4], b02: [251, 79.2, 29, 22.4], b03: [224, 66, 29, 22.4], b04: [185, 58.1, 23.8, 0], b05: [224, 63.4, 22.4, 21.1] };
const layouts = Object.entries(measured).map(([id, [photo, name, numbers, other]]) => ({ study: `discstudio:${id}`, name: id, layout: { photo: { w: photo }, name: { size: name }, numbers: { size: numbers }, other: other ? [{ text: 'MVP', size: other }] : [] } }));
const disc = { name: 'Servo', flights: [6.5, 5, -1, 2] };
const recount = intended => layouts.map(l => ({ study: l.study, ...orderFit(readingOf(l.layout, disc.name, disc.flights), intended), quiet: l.layout.other[0]?.size ?? 0 }));

test('the vendored Lab files are byte-identical to their pins', () => {
  const dir = new URL('../../experiences/thro/lab/', import.meta.url), pin = JSON.parse(fs.readFileSync(new URL('PIN.json', dir)));
  for (const [file, { sha256 }] of Object.entries(pin.files)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(file, dir))).digest('hex'), sha256, file);
});

test('under the scaffold order, every answer matches a plain recount', () => {
  const { answers, ways } = everyWay({ layouts, disc });
  const plain = recount(PARTS), keeping = plain.filter(w => w.keeps);
  assert.equal(answers.of, 11);
  assert.equal(answers.count, keeping.length);
  assert.equal(answers.possible, keeping.length > 0);
  const best = keeping.reduce((a, b) => (b.margin > a.margin ? b : a));
  assert.equal(answers.mostComfortable, best.study);
  assert.ok(Math.abs(1 / (1 - answers.comfort) - best.margin) < 1e-9);
  assert.equal(answers.quiet, Math.min(...keeping.map(w => w.quiet)));
  assert.deepEqual(ways.map(w => w.keeps), plain.map(w => w.keeps));
  assert.ok(answers.calls > 0, 'the answers came through the Lab registry');
  assert.ok(answers.restsOn.includes('order disc > name > numbers > rest'));
});

test('the person\'s order changes the sum: name first is unsatisfiable with these layouts', () => {
  const { answers } = everyWay({ layouts, disc, intended: ['name', 'disc', 'numbers', 'other'] });
  assert.deepEqual([answers.possible, answers.count, answers.mostComfortable, answers.restsOn], [false, 0, null, []]);
  const quietFirst = everyWay({ layouts, disc, intended: ['disc', 'name', 'other', 'numbers'] }).answers;
  assert.equal(quietFirst.count, recount(['disc', 'name', 'other', 'numbers']).filter(w => w.keeps).length);
});
