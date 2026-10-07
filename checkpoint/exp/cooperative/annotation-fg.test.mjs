import test from 'node:test';
import assert from 'node:assert/strict';
import {Part} from '../../vendor/hh/services/pxc.mjs';
import {AnnotationFG, createAnnotationRuntime} from './annotation-fg.mjs';

const issues = Object.freeze([{id: 'issue-7', number: 7, title: 'Missing alt text'}]);
const geometry = Object.freeze({markers: Object.freeze([
  Object.freeze({id: 'issue-7', number: 7, title: 'Missing alt text', x: 11, y: 22, width: 33, height: 44}),
])});

test('enable dispatch transitions hidden to visible and emits a geometry-backed marker tree', async () => {
  const runtime = createAnnotationRuntime({issues});
  const tree = await runtime.dispatch({type: 'enable'}, geometry);
  assert.equal(tree.tag, 'div');
  assert.equal(tree.attrs['data-annotation-state'], 'visible');
  assert.equal(tree.children.length, 1);
  const marker = tree.children[0];
  assert.equal(marker.tag, 'span');
  assert.equal(marker.attrs['data-annotation-marker'], 'issue-7');
  assert.equal(marker.attrs.style, 'left:11px;top:22px;width:33px;height:44px;');
  assert.equal(marker.children[0], '7');
  assert.ok(Object.isFrozen(tree));
});

test('disable dispatch transitions visible to hidden and hides all issue markers', async () => {
  const runtime = createAnnotationRuntime({issues});
  await runtime.dispatch({type: 'enable'}, geometry);
  const tree = await runtime.dispatch({type: 'disable'}, geometry);
  assert.equal(runtime.state().tag, 'hidden');
  assert.equal(tree.attrs['data-annotation-state'], 'hidden');
  assert.equal(tree.children.length, 0);
});

test('seek is a pure projection over current state and creates only a projection receipt', async () => {
  const runtime = createAnnotationRuntime({issues});
  await runtime.dispatch({type: 'enable'}, geometry);
  const before = runtime.inspect().receipts.length;
  const tree = await runtime.seek(geometry);
  const after = runtime.inspect();
  assert.equal(tree.attrs['data-annotation-state'], 'visible');
  assert.equal(after.state.tag, 'visible');
  assert.equal(after.receipts.length, before + 1);
  assert.equal(after.receipts.at(-1).kind, 'projection');
  assert.equal(after.parts.find((part) => part.address === after.receipts.at(-1).into).part, 'actual');
});

test('events, transitions, projection and the composed wrapper are real PxC function Parts', async () => {
  const runtime = createAnnotationRuntime({issues});
  assert.ok(runtime.pxc instanceof Object);
  const tree = await runtime.dispatch({type: 'enable'}, geometry);
  assert.equal(tree.tag, 'div');
  const inspection = runtime.inspect();
  assert.deepEqual(inspection.receipts.map((receipt) => receipt.kind), ['event', 'transition', 'projection', 'composed-wrapper']);
  for (const name of ['annotation.event', 'annotation.transition', 'annotation.seek', 'annotation.composed']) {
    const part = runtime.pxc.get(name);
    assert.ok(part instanceof Part);
    assert.equal(typeof part.value, 'function');
  }
  assert.equal(inspection.definition.kind, 'composed');
  assert.ok(inspection.definition.internalGraph.bindings.length >= 2);
  assert.doesNotThrow(() => JSON.stringify(inspection.definition));
});

test('contract composition accepts nested same-shape FGs and rejects incompatible tagged ports', async () => {
  const runtime = createAnnotationRuntime({issues});
  const nested = AnnotationFG.compose({id: 'nested', children: [{id: 'inner', fg: runtime.fg}],
    consumes: runtime.fg.consumes.map((port) => ({...port, target: {node: 'inner', port: port.name}})),
    emits: runtime.fg.emits.map((port) => ({...port, source: {node: 'inner', port: port.name}})), guarantees: runtime.fg.guarantees});
  assert.equal(nested.kind, 'composed');
  assert.deepEqual(nested.consumes.map(({name, type}) => [name, type]), runtime.fg.consumes.map(({name, type}) => [name, type]));
  assert.equal(nested.internalGraph.nodes[0].fg.kind, 'composed');
  const nestedRuntime = createAnnotationRuntime({issues, fg: nested});
  const nestedTree = await nestedRuntime.dispatch({type: 'enable'}, geometry);
  assert.equal(nestedTree.attrs['data-annotation-state'], 'visible');
  assert.ok(nestedRuntime.inspect().parts.some((part) => part.kind === 'nested-wrapper'));

  const producer = AnnotationFG.leaf({id: 'producer', consumes: [],
    emits: [{name: 'event', type: 'annotation-event', tags: ['enable']}], guarantees: []});
  const consumer = AnnotationFG.leaf({id: 'consumer',
    consumes: [{name: 'event', type: 'annotation-event', tags: ['disable']}], emits: [], guarantees: []});
  assert.throws(() => AnnotationFG.compose({id: 'incompatible', children: [producer, consumer],
    bindings: [{from: {node: 'producer', port: 'event'}, to: {node: 'consumer', port: 'event'}}],
    consumes: [], emits: [], guarantees: []}), /tag/i);
});

test('dispatch rejects unsupported event tags and unknown measured issue IDs', async () => {
  const runtime = createAnnotationRuntime({issues});
  await assert.rejects(runtime.dispatch({type: 'toggle'}, geometry), /enable|disable/i);
  const unknown = {markers: [{id: 'unknown', number: 2, title: 'No issue', x: 1, y: 2, width: 3, height: 4}]};
  await assert.rejects(runtime.dispatch({type: 'enable'}, unknown), /unknown issue/i);
  assert.equal(runtime.state().tag, 'hidden');
});
