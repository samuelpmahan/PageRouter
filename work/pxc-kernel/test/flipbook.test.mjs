// The flip book checker must pass a book that only adds, and catch the two ways a book breaks its promise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { frames, shoot, problems } from '../patterns/flipbook.mjs';

const dots = (n, shift = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80">${Array.from({ length: n }, (_, i) =>
  `<circle cx="${30 + i * 60 + (i < n - 1 ? shift : 0)}" cy="40" r="20" fill="#1b1d1c"/>`).join('')}</svg>`;

test('both shapes become frames that point at their data', () => {
  const a = frames({ steps: [{ label: 'one', points: { i: 1 }, state: 1 }], render: (n) => dots(n) });
  assert.deepEqual(a.map((f) => [f.label, f.points]), [['one', { i: 1 }]]);
  const b = frames({ picture: '<svg class="p"></svg>', layers: [{ label: 'base' }, { label: '+x', hide: ['.x'] }] });
  assert.match(b[0].html, /<style>\.x\{display:none\}<\/style>/);
  assert.doesNotMatch(b[1].html, /<style>/);
  assert.throws(() => frames({ title: 'neither' }), /either/);
});

test('a book that only adds passes; moving earlier content or adding nothing is caught', { timeout: 120000 }, () => {
  const steps = (states) => states.map((s, k) => ({ label: `frame ${k}`, state: s }));
  const good = shoot({ title: 'good', steps: steps([[1, 0], [2, 0], [3, 0]]), render: ([n, s]) => dots(n, s) }, 'patterns/out/test-good', { width: 320 });
  assert.deepEqual(problems(good), []);
  // frame 2 adds a dot but also slides the earlier dots 12 px: the drawing redrew what was already there
  const moved = shoot({ title: 'moved', steps: steps([[1, 0], [2, 0], [3, 12]]), render: ([n, s]) => dots(n, s) }, 'patterns/out/test-moved', { width: 320 });
  assert.equal(problems(moved).length, 1);
  assert.match(problems(moved)[0], /frame 2 .* disturbed/);
  // frame 2 repeats frame 1
  const same = shoot({ title: 'same', steps: steps([[1, 0], [2, 0], [2, 0]]), render: ([n, s]) => dots(n, s) }, 'patterns/out/test-same', { width: 320 });
  assert.deepEqual(problems(same), ['frame 2 (frame 2) added nothing']);
});
