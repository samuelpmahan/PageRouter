import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAtlasCase,runAtlasJs,compareAtlasObservations,validateAtlasCase} from './cross-language.mjs';

function pythonShaped(js){return {...structuredClone(js),language:'python',execution:{implementation:'independent test observation'}};}

test('six-node captured case executes through PxC and matches independently computed motion oracle',async()=>{
  const record=await captureAtlasCase();
  assert.equal(record.recipe.nodes.length,6);
  assert.equal(record.sources['/parts/queries'].transitions.length,10);
  const js=await runAtlasJs(record);
  const oracle=record.sources['/parts/queries'].transitions.map(({x,action})=>x+2*action+1);
  assert.deepEqual(js.observables.predictions,oracle);
  assert.equal(js.observables.model.gain,2);
  assert.equal(js.observables.model.bias,1);
  assert.equal(js.observables.prediction_probe.passed,10);
  assert.deepEqual(js.observables.posterior,{alpha:11,beta:1,mean:11/12,n:10,model_assumption:'conditionally independent Bernoulli cases with one shared pass probability'});
  assert.equal(js.observables.decision.accepted,true);
  assert.equal(js.execution.receipt.kernel_receipt_count,7);
  assert.deepEqual(js.fg_associations.decision.closure.nodeIds,['fit','predict','prediction_probe','posterior','decision']);
  const compared=await compareAtlasObservations(record,js,pythonShaped(js));
  assert.deepEqual(compared.agreement,{accepted:true,compared_case_count:10,first_difference:null});
  assert.equal(compared.producer.calculation,'atlas_cross_language_fg');
});

test('different training gain and stricter policy keep model, probe, posterior, and decision distinctions',async()=>{
  for(const [gain,bias] of [[3,-2],[-1,4],[0,0]]){
    const record=await captureAtlasCase({gain,bias,min_mean:0.95});
    const js=await runAtlasJs(record);
    const oracle=record.sources['/parts/queries'].transitions.map(({x,action})=>x+gain*action+bias);
    assert.deepEqual(js.observables.predictions,oracle);
    assert.equal(js.observables.model.gain,gain);
    assert.equal(js.observables.model.bias,bias);
    assert.equal(js.observables.parameter_probe.passed,gain===2&&bias===1);
    const reference=record.sources['/parts/observed'].values;
    const expectedPasses=oracle.filter((value,index)=>Math.abs(value-reference[index])<=1e-9).length;
    assert.equal(js.observables.prediction_probe.passed,expectedPasses);
    assert.equal(js.observables.posterior.alpha,1+expectedPasses);
    assert.equal(js.observables.posterior.beta,1+10-expectedPasses);
    assert.equal(js.observables.decision.accepted,false);
  }
});

test('FG rejects a corrupted prediction at its first differing path and repeats deterministically',async()=>{
  const record=await captureAtlasCase();
  const js=await runAtlasJs(record);
  const py=pythonShaped(js);
  py.observables.predictions[3]+=1;
  const first=await compareAtlasObservations(record,js,py);
  const repeated=await compareAtlasObservations(record,await runAtlasJs(record),py);
  assert.equal(first.agreement.accepted,false);
  assert.equal(first.agreement.first_difference.path,'predictions[3]');
  assert.match(first.agreement.first_difference.reason,/numeric disagreement/);
  assert.deepEqual(repeated.agreement,first.agreement);
});

test('tampered case identity is rejected before algorithm execution',async()=>{
  const record=await captureAtlasCase();
  record.sources['/parts/observed'].values[0]++;
  await assert.rejects(()=>validateAtlasCase(record),/case identity disagrees/);
  await assert.rejects(()=>runAtlasJs(record),/case identity disagrees/);
});
