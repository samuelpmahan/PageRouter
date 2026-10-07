import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtlasCompositionDefinition} from './atlas-session.mjs';
import {atlasFGAssociations} from './atlas-fg.mjs';

test('decision closure is derived from typed FG links over the pinned Atlas recipe',()=>{
  const definition=createAtlasCompositionDefinition();
  const result=atlasFGAssociations(definition);
  assert.deepEqual(result.decision.closure.nodeIds,['fit','predict','prediction_probe','posterior','decision']);
  assert.deepEqual(result.parameter_probe.closure.nodeIds,['fit','parameter_probe']);
  assert.ok(result.decision.edges.some(edge=>edge.from.node==='posterior'&&edge.to.node==='decision'&&edge.type==='beta-posterior'));
  assert.equal(result.decision.output.type,'policy-decision');
  assert.deepEqual(Object.keys(definition.sources).sort(),Object.keys(createAtlasCompositionDefinition().sources).sort());
});

test('FG association rejects wiring drift before calculation execution',()=>{
  const definition=createAtlasCompositionDefinition();
  definition.recipe.nodes.find(node=>node.id==='decision').inputs[0]='/parts/prior';
  assert.throws(()=>atlasFGAssociations(definition),/decision.*input|wiring|recipe/i);
});
