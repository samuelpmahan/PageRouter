import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTransform, transform2D } from '../../src/linalg/basics.mjs';
import { watchGeometry } from '../../src/watches/geometry.mjs';
import { componentDefinitions } from '../../src/watches/components.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};
const pointClose = (actual, expected) => {
  close(actual[0], expected[0]);
  close(actual[1], expected[1]);
};
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(frozen);
  }
  return value;
}

function stateFixture() {
  return frozen({
    models: {
      mechanical: {
        handAnglesDegrees: { second: 90, minute: 180, hour: 270 },
        oscillator: { phase: { numerator: 0, denominator: 1 } },
        counts: { beats: 0 },
        gearTrain: { handTurns: { second: { numerator: 0, denominator: 1 } } },
      },
      quartz: {
        handAnglesDegrees: { second: 45, minute: 90, hour: 180 },
        counts: { motorCommands: 0 },
        gearTrain: { handTurns: { second: { numerator: 0, denominator: 1 } } },
      },
      software: { handAnglesDegrees: { second: 30, minute: 60, hour: 120 } },
    },
  });
}

test('geometry returns all three labelled schematic watches with stable path IDs', () => {
  const result = watchGeometry(stateFixture(), 0);
  assert.equal(result.schema, 'watch-geometry.v1');
  assert.equal(result.illustrative, true);
  assert.deepEqual(result.watches.map((watch) => watch.id), ['mechanical', 'quartz', 'software']);
  const ids = result.watches.flatMap((watch) => watch.parts.map((part) => part.id));
  assert.equal(new Set(ids).size, ids.length, 'part IDs must be unique');
  assert.deepEqual([...ids].sort(), componentDefinitions().map((definition) => definition.id).sort(), 'geometry IDs must match canonical label metadata IDs');
  for (const watch of result.watches) {
    const partIds = new Set(watch.parts.map((part) => part.id));
    for (const edge of [...watch.energyPath, ...watch.timingPath]) {
      assert.ok(partIds.has(edge.from), `${watch.id} path missing ${edge.from}`);
      assert.ok(partIds.has(edge.to), `${watch.id} path missing ${edge.to}`);
    }
    for (const part of watch.parts) {
      assert.ok(part.kind && part.points.length >= 2, `${part.id} needs an original drawable shape`);
      assert.equal(part.transform.length, 3);
      assert.equal(part.transform[0].length, 3);
      assert.equal(part.label.leader.length, 2);
    }
  }
  assert.ok(result.watches[0].parts.some((part) => part.kind === 'coil'));
  assert.ok(result.watches[0].parts.some((part) => part.kind === 'gear'));
  assert.ok(result.watches[0].parts.some((part) => part.kind === 'palletFork'));
  assert.ok(result.watches[1].parts.some((part) => part.kind === 'crystal'));
  assert.ok(result.watches[2].parts.some((part) => part.kind === 'scheduler'));
  assert.ok(result.watches.every((watch) => watch.timingPath.length > 0));
  assert.ok(result.watches[0].energyPath.length > 0 && result.watches[1].energyPath.length > 0);
  for (const hand of ['secondHand', 'minuteHand', 'hourHand']) {
    assert.ok(result.watches[0].energyPath.some(({ from, to }) => from === 'mechanical.goingTrain' && to === `mechanical.${hand}`));
  }
  assert.deepEqual(result.watches[2].energyPath, [], 'software has no modeled watch-energy path');
});

test('explosion and hand rotation use homogeneous linalg transforms for every coordinate', () => {
  const state = stateFixture();
  const assembled = watchGeometry(state, 0);
  const exploded = watchGeometry(state, 1);
  const find = (geometry, id) => geometry.watches.flatMap((watch) => watch.parts).find((part) => part.id === id);
  const assembledSupport = find(assembled, 'mechanical.support');
  const explodedSupport = find(exploded, 'mechanical.support');
  assert.deepEqual(assembledSupport.transform, transform2D([166.67,250], 0, [1,1]));
  pointClose(assembledSupport.center, applyTransform(assembledSupport.transform, [0,0]));
  pointClose(explodedSupport.center, applyTransform(explodedSupport.transform, [0,0]));

  // These local fixture points and label coordinates independently exercise the same transform.
  pointClose(assembledSupport.points[0], applyTransform(assembledSupport.transform, [-116,-155]));
  pointClose(assembledSupport.label.anchor, applyTransform(assembledSupport.transform, [125,-112]));
  pointClose(assembledSupport.label.leader[0], applyTransform(assembledSupport.transform, [86,-72]));
  pointClose(assembledSupport.label.leader[1], applyTransform(assembledSupport.transform, [125,-112]));
  const assembledBarrel = find(assembled, 'mechanical.barrel');
  const explodedBarrel = find(exploded, 'mechanical.barrel');
  assert.notDeepEqual(assembledBarrel.center, explodedBarrel.center);

  const secondHand = find(assembled, 'mechanical.secondHand');
  assert.equal(secondHand.rotation, Math.PI / 2);
  const end = secondHand.points[3];
  assert.ok(end[0] > secondHand.center[0], '90 degrees clockwise should point right in the rendered coordinate system');
  assert.ok(Math.abs(end[1] - secondHand.center[1]) < 1e-9);
});

test('explosion zero reassembles exactly and geometry never mutates mechanism state', () => {
  const state = stateFixture();
  const before = structuredClone(state);
  const assembled = watchGeometry(state, 0);
  const exploded = watchGeometry(state, 0.75, 'mechanical.balanceWheel');
  const reassembled = watchGeometry(state, 0);
  assert.deepEqual(reassembled, assembled);
  assert.deepEqual(state, before);
  const allParts = (geometry) => geometry.watches.flatMap((watch) => watch.parts);
  for (const part of allParts(exploded)) assert.equal(part.selected, part.id === 'mechanical.balanceWheel');
  const explodedParts = new Map(allParts(exploded).map((part) => [part.id, part]));
  for (const part of allParts(assembled)) {
    const view = explodedParts.get(part.id);
    const dx = view.center[0] - part.center[0], dy = view.center[1] - part.center[1];
    pointClose(view.label.anchor, [part.label.anchor[0] + dx, part.label.anchor[1] + dy]);
    for (let i = 0; i < part.label.leader.length; i += 1) {
      pointClose(view.label.leader[i], [part.label.leader[i][0] + dx, part.label.leader[i][1] + dy]);
    }
    for (let i = 0; i < part.points.length; i += 1) {
      pointClose(view.points[i], [part.points[i][0] + dx, part.points[i][1] + dy]);
    }
  }
});


test('internal parts follow model phase and counts with transformed orientation markers', () => {
  const initial = stateFixture();
  const changed = structuredClone(initial);
  changed.models.mechanical.oscillator.phase = { numerator: 1, denominator: 2 };
  changed.models.mechanical.counts.beats = 1;
  changed.models.mechanical.gearTrain.handTurns.second = { numerator: 1, denominator: 60 };
  changed.models.quartz.counts.motorCommands = 1;
  changed.models.quartz.gearTrain.handTurns.second = { numerator: 1, denominator: 60 };
  const before = watchGeometry(initial, 0);
  const after = watchGeometry(changed, 0);
  const find = (geometry, id) => geometry.watches.flatMap((watch) => watch.parts).find((part) => part.id === id);
  for (const id of ['mechanical.balanceWheel', 'mechanical.hairspring', 'mechanical.escapeWheel', 'mechanical.goingTrain', 'quartz.rotor', 'quartz.gears']) {
    assert.notEqual(find(before,id).rotation, find(after,id).rotation, `${id} rotation follows model state`);
    assert.notDeepEqual(find(before,id).points, find(after,id).points, `${id} outline follows model state`);
    assert.ok(find(after,id).strokes.length > 0, `${id} needs a visible orientation marker`);
    assert.ok(find(after,id).motionSource.formula);
    assert.equal(find(after,id).motionSource.status, 'illustrative');
    assert.ok(find(after,id).motionSource.statePath);
  }
  const balance = find(after, 'mechanical.balanceWheel');
  assert.equal(balance.motionSource.statePath, 'models.mechanical.oscillator.phase');
  assert.equal(balance.rotation, -25 * Math.PI / 180);
  const markerFixtures = new Map([
    ['mechanical.balanceWheel', { radius: 38 * 0.88, anchor: [52,24], leader: [[30,4],[52,24]] }],
    ['mechanical.hairspring', { radius: 28 * 0.88, anchor: [48,32], leader: [[16,10],[48,32]] }],
    ['mechanical.escapeWheel', { radius: 25 * 0.88, anchor: [29,-28], leader: [[21,-10],[29,-28]] }],
    ['mechanical.goingTrain', { radius: 35 * 0.88, anchor: [48,-36], leader: [[26,-8],[48,-36]] }],
    ['quartz.rotor', { radius: 22 * 0.88, anchor: [37,17], leader: [[18,6],[37,17]] }],
    ['quartz.gears', { radius: 31 * 0.88, anchor: [42,21], leader: [[26,7],[42,21]] }],
  ]);
  for (const [id, fixture] of markerFixtures) {
    const part = find(after, id);
    assert.equal(part.strokes.length, 1);
    pointClose(part.strokes[0][0], applyTransform(part.transform, [0,0]));
    pointClose(part.strokes[0][1], applyTransform(part.transform, [fixture.radius,0]));
    pointClose(part.label.anchor, applyTransform(part.transform, fixture.anchor));
    for (let i = 0; i < fixture.leader.length; i += 1) {
      pointClose(part.label.leader[i], applyTransform(part.transform, fixture.leader[i]));
    }
  }
  const fresh = watchGeometry(changed, 0);
  const freshParts = new Map(fresh.watches.flatMap((watch) => watch.parts.map((part) => [part.id, part])));
  const wheel = find(after, 'mechanical.balanceWheel');
  const spring = find(after, 'mechanical.hairspring');
  assert.notEqual(wheel.motionSource, spring.motionSource, 'each part gets independent metadata');
  wheel.motionSource.status = 'caller mutation';
  assert.equal(spring.motionSource.status, 'illustrative');
  assert.equal(freshParts.get('mechanical.balanceWheel').motionSource.status, 'illustrative', 'fresh calls do not expose retained metadata');
  assert.deepEqual(initial, stateFixture(), 'geometry must not mutate the original model snapshot');
});

test('hand geometry reads current supplied state angles and rejects invalid view arguments', () => {
  const state = stateFixture();
  const geometry = watchGeometry(state, 0);
  const byId = new Map(geometry.watches.flatMap((watch) => watch.parts.map((part) => [part.id, part])));
  close(byId.get('mechanical.secondHand').rotation, Math.PI / 2);
  close(byId.get('quartz.minuteHand').rotation, Math.PI / 2);
  close(byId.get('software.hourHand').rotation, 2 * Math.PI / 3);
  assert.throws(() => watchGeometry(state, -0.1), /explode.*0 to 1/i);
  assert.throws(() => watchGeometry(state, 0, 'unknown.part'), /unknown.*component/i);
  assert.throws(() => watchGeometry({ models: { mechanical: {} } }, 0), /handAnglesDegrees|hand angle/i);
});
