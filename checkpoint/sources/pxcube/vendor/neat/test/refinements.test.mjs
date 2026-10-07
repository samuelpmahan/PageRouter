import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeBoard } from '../dist/board.js';
import { snapshotProblems } from '../dist/io.js';
import { renderReport } from '../dist/report.js';

const item = (id, status = 'queued', refinement) => ({
  schemaVersion: 1, id, outcome: id, location: { component: `example/${id}` },
  target: { kind: 'pcr', identity: `pcr.example.${id}` },
  requirements: [{ id: 'inspect', text: 'Inspect real execution' }], dependencies: [],
  status, blockers: [], checkpoints: [], acceptanceRefs: [], promotionRefs: [], resume: '',
  ...(refinement ? { refinement } : {}),
});
const board = (items) => materializeBoard({ items, facts: { availableSurfaces: items.map((i) => i.location.component) } });
const at = (result, id) => result.assessments.find((i) => i.itemId === id);

test('Combine derives reviewable substates through a nested Compare without inheriting evidence', () => {
  const candidates = item('candidates', 'active', {
    mode: 'compare', children: ['browser', 'mobile', 'alternate'],
    selections: { browser: 'browser', mobile: 'mobile' },
  });
  const parts = [item('root', 'queued', { mode: 'combine', children: ['ingest', 'candidates'] }),
    item('ingest', 'review'), candidates, item('browser', 'review'), item('mobile', 'active'), item('alternate')];
  let result = board(parts);
  assert.equal(at(result, 'root').substate.state, 'incomplete');
  assert.equal(at(result, 'candidates').substate.state, 'incomplete');
  assert.equal(at(result, 'root').verified, false);
  parts[4] = item('mobile', 'review');
  result = board(parts);
  assert.equal(at(result, 'candidates').substate.state, 'reviewable');
  assert.equal(at(result, 'root').substate.state, 'reviewable');
  assert.equal(at(result, 'root').activity, 'queued');
  assert.equal(at(result, 'root').verified, false);
  assert.equal(at(result, 'root').accepted, false);
  assert.equal(at(result, 'root').promoted, false);
  assert.equal(at(result, 'candidates').substate.children.find((c) => c.id === 'alternate').state, 'incomplete');
  assert.match(result.markdown, /combine=reviewable/);
});

test('Compare remains incomplete without selection and never ranks a candidate', () => {
  const result = board([item('choice', 'active', { mode: 'compare', children: ['a', 'b'] }), item('a', 'review'), item('b', 'review')]);
  assert.equal(at(result, 'choice').substate.state, 'incomplete');
  assert.deepEqual(at(result, 'choice').substate.selections, {});
});

test('check rejects bad modes, missing references, cycles and illegal selections', () => {
  const cases = [
    [[item('bad', 'active', { mode: 'merge', children: ['a'] }), item('a')], /unknown refinement mode/],
    [[item('bad', 'active', { mode: 'combine', children: ['absent'] })], /missing refinement child absent/],
    [[item('a', 'active', { mode: 'combine', children: ['b'] }), item('b', 'active', { mode: 'combine', children: ['a'] })], /refinement cycle/],
    [[item('bad', 'active', { mode: 'compare', children: ['a', 'b'], selections: { browser: 'c' } }), item('a'), item('b')], /selections must name declared children/],
    [[item('bad', 'active', { mode: 'combine', children: ['a'], selections: { browser: 'a' } }), item('a')], /combine cannot select candidates/],
  ];
  for (const [items, expected] of cases) assert.match(snapshotProblems({ items, facts: {} }).join('\n'), expected);
  assert.match(at(board(cases[1][0]), 'bad').blockers.join('\n'), /missing refinement child/);
});

test('flat work item keeps its current assessment and has no substate', () => {
  const result = board([item('flat', 'active')]);
  assert.equal(at(result, 'flat').substate, undefined);
  assert.equal(at(result, 'flat').bucket, 'active');
});

test('HTML board displays derived child progress and escapes context labels', () => {
  const items = [item('comparison', 'active', {
    mode: 'compare', children: ['a', 'b'], selections: { 'mobile<&': 'a' },
  }), item('a', 'review'), item('b', 'active')];
  const html = renderReport(board(items), items);
  assert.match(html, /compare: reviewable/);
  assert.match(html, /<code>a<\/code>: reviewable/);
  assert.match(html, /<code>b<\/code>: incomplete/);
  assert.match(html, /mobile&lt;&amp;: <code>a<\/code>/);
  assert.doesNotMatch(html, /mobile<&/);
});
