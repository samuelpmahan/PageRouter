import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverCalculations} from './feedback.mjs';
import {executeComposedCalculation} from '../block5/core/composed.mjs';
import {resolveProvider} from '../block5/core/providers.mjs';
import {createGridWorld, DEFAULT_GRID_RECIPE, editGridObject} from '../block5/core/grid-world.mjs';
import {runGridRecipe} from '../block5/core/runtime.mjs';

async function gridTraining() {
  return runGridRecipe({initialState: createGridWorld(), recipe: DEFAULT_GRID_RECIPE, ticks: 4, mode: 'uncached'});
}

test('feedback discovers a recurring calculation chain and executes it on changed state and direction', async () => {
  const training = await gridTraining();
  const programs = discoverCalculations(training.stream);
  const program = programs.find(candidate => candidate.nodes.length === 2 && candidate.training.occurrenceCount >= 2);

  assert.ok(program, 'a repeated two-event dependency chain should become an executable candidate');
  assert.equal(program.format, 'pagerouter.composed-calculation.v1');
  assert.deepEqual(program.providerIdentity, training.stream.events[0].provider);
  assert.equal(program.inputs.length, 3, 'state and each distinct card parameter reference remain separate inputs');
  assert.deepEqual(program.nodes.map(node => node.id), ['n0', 'n1']);
  assert.deepEqual(program.nodes[1].inputs[0], {kind: 'node', nodeId: 'n0'});
  assert.deepEqual(program.outputs, [{port: 'o0', nodeId: 'n0'}, {port: 'o1', nodeId: 'n1'}]);
  assert.deepEqual(program.training.eventIds.map(id => training.stream.events.find(event => event.id === id)?.id), program.training.eventIds);

  const changedInitial = editGridObject(createGridWorld(), 'baba', {x: 1});
  const changedInputs = Object.fromEntries(program.inputs.map(input => [input.port,
    input.sourceRef === 'input:state' ? changedInitial : {direction: 'L'}]));
  const execution = await executeComposedCalculation({program, inputs: changedInputs});
  const provider = resolveProvider(training.stream.events[0].calculation, program.providerIdentity);
  const expected = [];
  for (const node of program.nodes) {
    const args = node.inputs.map(binding => binding.kind === 'node'
      ? expected[Number(binding.nodeId.slice(1))]
      : changedInputs[binding.port]);
    expected.push(await provider.run(...args));
  }

  assert.deepEqual(execution.outputs.map(output => output.value), expected);
  assert.notDeepEqual(execution.outputs[1].value, training.stream.events.find(event => event.id === program.training.eventIds[1]).output,
    'changed execution must not return the retained training output');
});

test('feedback discards a motif when an internal source reference value disagrees with its parent output', async () => {
  const training = await gridTraining();
  const corrupted = structuredClone(training.stream);
  corrupted.events[1].inputs[0] = editGridObject(corrupted.events[1].inputs[0], 'baba', {x: 0});

  assert.deepEqual(discoverCalculations(corrupted), []);
});

test('feedback discards a motif when one external source reference carries conflicting values', async () => {
  const training = await gridTraining();
  const [first, second] = training.stream.events.filter(event => event.kind === 'calculation').slice(0, 2).map(event => structuredClone(event));
  const third = structuredClone(first);
  const fourth = structuredClone(second);
  const pair = [first, second, third, fourth];
  pair.forEach((event, index) => {
    const pairStart = Math.floor(index / 2) * 2;
    const firstId = `synthetic-${pairStart}`;
    const secondId = `synthetic-${pairStart + 1}`;
    event.id = index % 2 === 0 ? firstId : secondId;
    event.seq = index;
    event.outputRef = `event:${event.id}:output`;
    if (index % 2 === 0) {
      event.dependencies = [];
      event.inputRefs[0] = `input:state:${pairStart}`;
      event.inputRefs[1] = 'input:parameters:shared';
    } else {
      event.dependencies = [firstId];
      event.inputRefs[0] = `event:${firstId}:output`;
      event.inputRefs[1] = 'input:parameters:shared';
      event.inputs[1] = {direction: 'L'};
    }
  });
  const conflicting = {...training.stream, events: pair, diagnosticEvents: []};
  assert.deepEqual(discoverCalculations(conflicting, {maxNodes: 2}), []);
});
