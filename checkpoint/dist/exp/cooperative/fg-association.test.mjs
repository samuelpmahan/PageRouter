import test from 'node:test';
import assert from 'node:assert/strict';
import {AnnotationFG} from './annotation-fg.mjs';
import {deriveFGAssociations} from './fg-association.mjs';
import {Part, PxC} from '../../vendor/hh/services/pxc.mjs';

const model = AnnotationFG.leaf({id: 'model', emits: [{name: 'value', type: 'motion-model'}], guarantees: [{kind: 'fixed-model'}]});
const predict = AnnotationFG.leaf({id: 'predict', consumes: [{name: 'model', type: 'motion-model'}], emits: [{name: 'prediction', type: 'motion-prediction'}], guarantees: [{kind: 'predict'}]});
const probe = AnnotationFG.leaf({id: 'probe', consumes: [{name: 'prediction', type: 'motion-prediction'}], emits: [{name: 'result', type: 'probe-result'}], guarantees: [{kind: 'probe'}]});

function chain({includeProbe = true} = {}) {
  return AnnotationFG.compose({id: 'motion', children: includeProbe ? [model, predict, probe] : [model, predict],
    bindings: [{from: {node: 'model', port: 'value'}, to: {node: 'predict', port: 'model'}},
      ...(includeProbe ? [{from: {node: 'predict', port: 'prediction'}, to: {node: 'probe', port: 'prediction'}}] : [])],
    emits: includeProbe ? [{name: 'result', type: 'probe-result', source: {node: 'probe', port: 'result'}}]
      : [{name: 'result', type: 'motion-prediction', source: {node: 'predict', port: 'prediction'}}]});
}

test('derives transitive Part closure and typed edges from the composed FG', () => {
  const association = deriveFGAssociations({fg: chain(), output: 'result', addresses: {model: '/model', predict: '/predict', probe: '/probe'}});
  assert.deepEqual(association.closure.nodeIds, ['model', 'predict', 'probe']);
  assert.deepEqual(association.closure.partAddresses, ['/model', '/predict', '/probe']);
  assert.deepEqual(association.edges.map(edge => [edge.from.node, edge.to.node, edge.type]),
    [['model', 'predict', 'motion-model'], ['predict', 'probe', 'motion-prediction']]);
  assert.equal(association.output.type, 'probe-result');
  assert.deepEqual(association.nodes[1].guarantees, [{kind: 'predict'}]);
});

test('same model Part participates in a different closure when the selected FG changes', () => {
  const addresses = {model: '/model', predict: '/predict', probe: '/probe'};
  const full = deriveFGAssociations({fg: chain(), output: 'result', addresses});
  const short = deriveFGAssociations({fg: chain({includeProbe: false}), output: 'result', addresses});
  assert.equal(full.nodes[0].address, short.nodes[0].address);
  assert.deepEqual(short.closure.nodeIds, ['model', 'predict']);
  assert.equal(short.output.type, 'motion-prediction');
});

test('event port feeding a delegate Calculation is an explicit FG association', () => {
  const event = AnnotationFG.leaf({id: 'event', emits: [{name: 'raised', type: 'annotation-event', tags: ['enable']}], guarantees: [{kind: 'event'}]});
  const handler = AnnotationFG.leaf({id: 'handler', consumes: [{name: 'raised', type: 'annotation-event', tags: ['enable', 'disable']}],
    emits: [{name: 'state', type: 'annotation-state'}], guarantees: [{kind: 'delegate', handles: 'annotation-event'}]});
  const fg = AnnotationFG.compose({id: 'dispatch', children: [event, handler],
    bindings: [{from: {node: 'event', port: 'raised'}, to: {node: 'handler', port: 'raised'}}],
    emits: [{name: 'state', type: 'annotation-state', source: {node: 'handler', port: 'state'}}]});
  const association = deriveFGAssociations({fg, output: 'state', addresses: {event: '/event', handler: '/handler'}});
  assert.equal(association.edges[0].type, 'annotation-event');
  assert.deepEqual(association.edges[0].tags, ['enable']);
  assert.deepEqual(association.nodes[1].guarantees, [{kind: 'delegate', handles: 'annotation-event'}]);
});

test('rejects missing binding and incompatible actual Calculation before effects', async () => {
  const disconnected = AnnotationFG.compose({id: 'disconnected', children: [predict],
    emits: [{name: 'result', type: 'motion-prediction', source: {node: 'predict', port: 'prediction'}}]});
  assert.throws(() => deriveFGAssociations({fg: disconnected, output: 'result', addresses: {predict: '/predict'}}), /unbound.*predict\.model/i);
  const pxc = new PxC();
  pxc.set('/model', new Part({gain: 2}));
  pxc.set('/predict', new Part({not: 'a function'}));
  pxc.set('/probe', new Part(() => { throw new Error('effect executed'); }));
  assert.throws(() => deriveFGAssociations({fg: chain(), output: 'result', addresses: {model: '/model', predict: '/predict', probe: '/probe'}, pxc}), /Calculation Part.*predict/i);
  assert.equal(pxc.receipts().length, 0);
});
