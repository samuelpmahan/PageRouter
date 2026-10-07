import test from 'node:test';
import assert from 'node:assert/strict';
import {atlasImplementationIdentity} from '../../scripts/atlas-identity.mjs';
import {fileURLToPath} from 'node:url';

const currentIdentity=()=>atlasImplementationIdentity(fileURLToPath(new URL('../../',import.meta.url)));
async function protocol(options){
  const module=await import('./atlas-session.mjs');
  assert.equal(typeof module.createCapabilityProtocol,'function','the session must export the executable capability protocol');
  return module.createCapabilityProtocol(options);
}
async function sample(options){
  const module=await import('./atlas-session.mjs');
  assert.equal(typeof module.createSampleDefinition,'function','the session must export a pure six-node sample definition');
  return module.createSampleDefinition(options);
}
function envelope(recipe,sources,implementationIdentity=null){return {format:'kompozed.atlas.recipe.v1',recipe,sources,implementationIdentity};}
const oneNode=(calculation='predict_motion')=>envelope({nodes:[{id:'prediction',calculation,inputs:['/model','/queries'],output:'/prediction'}],outputs:{prediction:'/prediction'}},{'/model':{gain:2,bias:1},'/queries':{transitions:[{x:3,action:4}]}});

// Break caught: absent stage factory or eager domain execution during syntax parsing.
test('parse is independently callable, accepts syntax alone, and never executes a domain body',async()=>{
  const p=await protocol();
  assert.deepEqual(p.capabilities().map(row=>row.name),['parse','validate','interpret','execute']);
  const parsed=await p.parse('{"not_a_recipe":true}');
  assert.equal(parsed.value.status,'ok');assert.deepEqual(parsed.value.envelope,{not_a_recipe:true});
  assert.equal(p.inspect().counts.domain_body_executions,0);
  assert.equal(p.inspect().counts.protocol_body_executions,1);
  const broken=await p.parse('{');assert.equal(broken.value.ok,false);assert.equal(broken.value.error.code,'PARSE_FAILED');
  assert.ok(broken.kernel_composition);assert.equal(p.inspect().counts.domain_body_executions,0);
});

// Break caught: validation executes the fixture or incorrectly rejects independent roots.
test('validation compiles multiple roots and interpretation binds fixed Calculations without domain work',async()=>{
  const p=await protocol();
  const def=envelope({nodes:[
    {id:'z',calculation:'predict_motion',inputs:['/model','/queries'],output:'/z'},
    {id:'a',calculation:'probe_model',inputs:['/model','/spec'],output:'/a'}
  ],outputs:{z:'/z',a:'/a'}},{'/model':{gain:2,bias:1},'/queries':{transitions:[{x:3,action:4}]},'/spec':{expected_gain:2,expected_bias:1,tolerance:0}});
  const parsed=await p.parse(def),validated=await p.validate(parsed),interpreted=await p.interpret(validated);
  assert.equal(validated.value.ok,true);assert.equal(interpreted.value.ok,true);
  assert.deepEqual(interpreted.value.plan.order.map(row=>row.id),['a','z']);
  assert.equal(interpreted.value.plan.bindings[0].calculation_address,'/calculations/probe_model');
  assert.equal(interpreted.value.plan.bindings[0].implementation.file,'exp/atlas/calculations.mjs');
  assert.equal(p.inspect().counts.domain_body_executions,0);
});

// Break caught: missing preflight checks or algorithm execution following invalid dependencies.
test('bad references, cycles, registry names and addresses fail validation before execution',async()=>{
  for(const change of [
    def=>{def.recipe.nodes[0].inputs[0]='/missing';},
    def=>{def.recipe.nodes[0].inputs[0]='/prediction';},
    def=>{def.recipe.nodes[0].calculation='constructor';},
    def=>{def.recipe.nodes[0].output='/bad/../prediction';},
    def=>{def.sources['/calculations/occupied']=1;},
    def=>{def.recipe.outputs.prediction='/missing';}
  ]){
    const p=await protocol(),def=oneNode();change(def);
    const result=await p.run(def);assert.equal(result.value.ok,false);assert.equal(result.value.stages.validate.value.error.code,'VALIDATION_FAILED');
    assert.equal(result.value.stages.interpret,undefined);assert.equal(result.value.stages.execute,undefined);
    assert.equal(p.inspect().counts.domain_body_executions,0);
  }
});

// Break caught: unsuccessful rungs accepted downstream or parsing failures omit parent provenance.
test('failed previous rungs compose structured failures and run stops at the failed rung',async()=>{
  const p=await protocol(),parsed=await p.parse('{');
  const validation=await p.validate(parsed);assert.equal(validation.value.error.code,'PRIOR_RUNG_FAILED');
  const interpretation=await p.interpret(validation);assert.equal(interpretation.value.error.code,'PRIOR_RUNG_FAILED');
  const execution=await p.execute(interpretation);assert.equal(execution.value.error.code,'PRIOR_RUNG_FAILED');
  assert.equal(p.inspect().counts.domain_body_executions,0);
  const run=await p.run('{');assert.equal(run.value.ok,false);assert.deepEqual(Object.keys(run.value.stages),['parse']);
  assert.ok(run.inputs.includes(run.value.stages.parse.address));assert.ok(run.kernel_composition);
});

// Break caught: rungs are wrappers without actual HH composition/implementation dependencies.
test('individual ladder and composed ladder give identical outputs with actual HH provenance',async()=>{
  const def=await sample(),p=await protocol();
  const parsed=await p.parse(def),validated=await p.validate(parsed),interpreted=await p.interpret(validated),executed=await p.execute(interpreted);
  const q=await protocol(),run=await q.run(def);
  assert.equal(executed.value.ok,true);assert.equal(run.value.ok,true);
  assert.deepEqual(executed.value.execution.outputs,run.value.execution.outputs);
  assert.equal(run.value.execution.outputs.decision.value.accepted,true);
  assert.deepEqual([run.value.execution.outputs.model.value.gain,run.value.execution.outputs.model.value.bias],[2,1]);
  for(const part of [...Object.values(run.value.stages),run]){
    assert.ok(part.kernel_composition.calculation_address.startsWith('/protocol/calculations/'));
    assert.ok(part.inputs.includes('/protocol/implementations/source'));
    assert.equal(part.producer.kernel.file,'vendor/hh/services/pxc.mjs');
    const receipt=q.inspect().receipts.find(row=>row.into===part.address);assert.equal(receipt.status,'produced');assert.deepEqual(receipt.value,part.value);
    assert.deepEqual(receipt.input_addresses.sort(),Object.values(part.kernel_composition.inputs).sort());
  }
  assert.ok(run.inputs.includes(run.value.domain_evidence_address));
  assert.equal(q.inspect().parts[run.value.domain_evidence_address].domain_address,run.value.execution.composition_part.address);
  assert.ok(run.value.stages.execute.inputs.includes(run.value.stages.execute.value.domain_evidence_address));
  assert.equal(q.inspect().counts.protocol_kernel_receipts,6);
  assert.equal(q.inspect().counts.domain_kernel_receipts,7);
});

// Break caught: returning a cached execute result without invoking AtlasRuntime or losing memoization.
test('execute replay invokes real runtime receipts while reusing all six domain algorithm bodies',async()=>{
  const p=await protocol(),def=await sample();
  const interpreted=await p.interpret(await p.validate(await p.parse(def)));
  const first=await p.execute(interpreted),second=await p.execute(interpreted);
  assert.equal(first.value.execution.receipt.executed_count,6);
  assert.equal(second.value.execution.receipt.executed_count,0);
  assert.equal(second.value.execution.receipt.cache_hit_count,6);
  assert.equal(second.value.execution.receipt.kernel_receipt_count,7);
  assert.deepEqual(first.value.execution.outputs,second.value.execution.outputs);
  const counts=p.inspect().counts;assert.equal(counts.domain_body_executions,6);assert.equal(counts.domain_cache_hits,6);assert.equal(counts.domain_invocations,2);assert.equal(counts.domain_kernel_receipts,14);
});

// Break caught: imported identity relabels the authoritative local calculation implementation.
test('imported identity must exactly match the authoritative current identity',async()=>{
  const implementationIdentity=currentIdentity(),p=await protocol({implementationIdentity}),def=await sample({implementationIdentity});
  const okay=await p.run(def);assert.equal(okay.value.ok,true);
  assert.equal(okay.producer.implementation.source_digest,implementationIdentity.files['exp/atlas/capability-protocol.mjs'].sha256);
  def.implementationIdentity.files['exp/atlas/calculations.mjs'].sha256='a'.repeat(64);
  const mismatched=await p.run(def);assert.equal(mismatched.value.stages.validate.value.error.code,'IMPLEMENTATION_IDENTITY_MISMATCH');
  assert.equal(p.inspect().counts.domain_invocations,1);
  const unbound=await protocol();assert.equal((await unbound.run(def)).value.stages.validate.value.error.code,'IMPLEMENTATION_IDENTITY_MISMATCH');
});

// Break caught: caller mutations affect retained values, or public clones/cross-session handles grant authority.
test('state is immutable and isolated, forged and cross-session handles cannot authorize a rung',async()=>{
  const p=await protocol(),def=oneNode(),parsed=await p.parse(def);def.sources['/model'].gain=99;
  assert.throws(()=>{parsed.value.envelope.sources['/model'].gain=99;},TypeError);
  const inspection=p.inspect();inspection.parts[parsed.address].value.envelope.sources['/model'].gain=99;
  const executed=await p.execute(await p.interpret(await p.validate(parsed)));assert.deepEqual(executed.value.execution.outputs.prediction.value.values,[12]);
  assert.equal((await p.validate(JSON.parse(JSON.stringify(parsed)))).value.error.code,'HANDLE_INVALID');
  const other=await protocol();assert.equal((await other.validate(parsed)).value.error.code,'HANDLE_INVALID');
  assert.equal((await p.execute(parsed)).value.error.code,'HANDLE_WRONG_RUNG');
});

// Break caught: reset races an active protocol or old handles still authorize fresh epoch execution.
test('protocol serializes mutations and reset invalidates earlier handles and domain caches',async()=>{
  const p=await protocol(),def=await sample(),active=p.run(def);
  assert.throws(()=>p.reset(),/running/);await assert.rejects(p.parse(def),/already running/);await active;
  const parsed=await p.parse(def);p.reset();
  assert.equal(p.inspect().counts.domain_body_executions,0);
  assert.equal((await p.validate(parsed)).value.error.code,'HANDLE_STALE');
  const fresh=await p.run(def);assert.equal(fresh.value.execution.receipt.executed_count,6);
});

// Break caught: finite-JSON boundary accepts lossful values or object accessors execute as input.
test('finite JSON rejects overflow, non-JSON host values and accessor input without domain work',async()=>{
  const p=await protocol();let getterCalls=0;
  const accessor={};Object.defineProperty(accessor,'recipe',{enumerable:true,get(){getterCalls++;return {};}});
  for(const input of ['{"overflow":1e999}',{number:Infinity},{missing:undefined},accessor,[,1],{fn(){}}]){
    const parsed=await p.parse(input);assert.equal(parsed.value.ok,false);assert.equal(parsed.value.error.code,'PARSE_FAILED');
  }
  assert.equal(getterCalls,0);assert.equal(p.inspect().counts.domain_body_executions,0);
});

// Break caught: property names mutate prototypes instead of returning selected output Parts.
test('output names such as __proto__ stay own JSON data',async()=>{
  const p=await protocol(),def=oneNode();def.recipe.outputs=JSON.parse('{"__proto__":"/prediction","constructor":"/prediction"}');
  const result=await p.run(def);assert.equal(result.value.ok,true);
  assert.ok(Object.hasOwn(result.value.execution.outputs,'__proto__'));
  assert.deepEqual(result.value.execution.outputs.__proto__.value.values,[12]);
  assert.equal(Object.getPrototypeOf(result.value.execution.outputs),Object.prototype);
});

// Break caught: domain exceptions escape instead of producing composed failure evidence and halt the ladder.
test('execution failures yield composed inspectable failure Parts and preserve real failed receipts',async()=>{
  const p=await protocol(),def=oneNode();def.sources['/model'].gain='bad';
  const result=await p.run(def),failed=result.value.stages.execute;
  assert.equal(result.value.ok,false);assert.equal(failed.value.error.code,'EXECUTION_FAILED');
  assert.ok(failed.kernel_composition);assert.equal(p.inspect().counts.domain_invocations,1);
  assert.equal(p.inspect().domain.kernel_receipts.at(-1).status,'failed');
  assert.equal(p.inspect().domain.kernel_receipts.at(-1).calculation_address,'/calculations/predict_motion');
});

// Break caught: empty/output-only DAGs are incorrectly rejected or execute phantom algorithms.
test('empty DAG can select a seeded Part without running any domain algorithm',async()=>{
  const p=await protocol(),result=await p.run(envelope({nodes:[],outputs:{seed:'/seed'}},{'/seed':{value:7}}));
  assert.equal(result.value.ok,true);assert.deepEqual(result.value.execution.outputs.seed.value,{value:7});
  assert.equal(result.value.execution.receipt.executed_count,0);assert.equal(result.value.execution.receipt.kernel_receipt_count,1);
});

// Break caught: a throwing domain body is reported as zero execution and its failed attempt vanishes.
test('failed Calculation attempts count once, retain failed trace and never enter the cache',async()=>{
  const {AtlasRuntime}=await import('./runtime-adapter.mjs');let actualBodyCalls=0;
  const runtime=new AtlasRuntime({explode(){actualBodyCalls++;throw new Error('fixture failure');}});
  const recipe={nodes:[{id:'failed_node',calculation:'explode',inputs:['/a','/b'],output:'/failed'}],outputs:{failed:'/failed'}};
  await assert.rejects(runtime.execute(recipe,{'/a':1,'/b':2}),/fixture failure/);
  assert.equal(actualBodyCalls,1);const inspection=runtime.inspect();
  assert.equal(inspection.receipt.executed_count,1);
  assert.equal(inspection.cache.body_executions,1);
  assert.equal(inspection.cache.entries,0);
  assert.equal(inspection.receipt.trace[0].status,'failed');
  assert.equal(inspection.receipt.trace[0].node_id,'failed_node');
  assert.equal(inspection.kernel_receipts[0].status,'failed');
});

// Break caught: execution ignores an interpreted plan instead of rejecting changed bindings/order.
test('runtime rejects a changed interpreted binding before any Calculation execution',async()=>{
  const {AtlasRuntime}=await import('./runtime-adapter.mjs');const runtime=new AtlasRuntime();
  const definition=oneNode(),plan=runtime.plan(definition.recipe,definition.sources);
  plan.bindings[0].input_bindings.left='/queries';
  await assert.rejects(runtime.execute(definition.recipe,definition.sources,{plan}),/authoritative fixed Calculation bindings/);
  assert.equal(runtime.inspect().cache.body_executions,0);
  assert.deepEqual(runtime.inspect().kernel_receipts,[]);
});

// Break caught: composed run stage records lose their authentic authority for explicit replay.
test('run retains authentic nested interpret handles for independent execute replay',async()=>{
  const p=await protocol(),run=await p.run(await sample());
  const replay=await p.execute(run.value.stages.interpret);
  assert.equal(replay.value.ok,true);assert.equal(replay.value.execution.receipt.cache_hit_count,6);
});

// Break caught: provenance points to nonexistent original identity or previous-execution addresses.
test('protocol and imported-domain producer references resolve in their declared inspection namespace',async()=>{
  const p=await protocol(),parsed=await p.parse(oneNode());
  let inspection=p.inspect();assert.ok(Object.hasOwn(inspection.parts,parsed.producer.implementation.identity_address));
  assert.equal(parsed.producer.implementation.export,'createCapabilityProtocol');assert.equal(parsed.producer.implementation.capability,'parse');
  const first=await p.run(await sample()),second=await p.execute(first.value.stages.interpret);
  inspection=p.inspect();
  for(const execution of [first.value.stages.execute,second]){
    const composition=inspection.parts[execution.value.domain_evidence_address];
    for(const address of composition.inputs){
      const record=inspection.parts[address];assert.ok(record);
      const producer=record.producer;
      if(producer.implementation?.identity_address)assert.ok(Object.hasOwn(inspection.parts,producer.implementation.identity_address),producer.implementation.identity_address);
      for(const input of producer.input_addresses??[])assert.ok(Object.hasOwn(inspection.parts,input),input);
      if(producer.output_address)assert.equal(producer.output_address,record.address);
      for(const field of ['kernel','adapter'])if(producer[field]?.identity_address)assert.ok(Object.hasOwn(inspection.parts,producer[field].identity_address),producer[field].identity_address);
    }
    assert.ok(composition.domain_namespace.prefix.startsWith('/protocol/evidence/'));
  }
});

// Break caught: failure provenance is a detached snapshot rather than a composition over actual partial Parts.
test('failed execution evidence composes the actual attempted input and Calculation Parts',async()=>{
  const p=await protocol(),def=oneNode();def.sources['/model'].gain='bad';
  const run=await p.run(def),executed=run.value.stages.execute,inspection=p.inspect();
  const evidence=inspection.parts[executed.value.domain_evidence_address];
  assert.ok(evidence.kernel_composition,'failure evidence must itself be composed by HH');
  assert.ok(run.inputs.includes(evidence.address));assert.ok(executed.inputs.includes(evidence.address));
  const failedReceipt=evidence.value.receipt.kernel_receipts.at(-1);
  assert.equal(failedReceipt.status,'failed');
  assert.ok(evidence.inputs.includes(failedReceipt.calculation_address));
  for(const address of failedReceipt.input_addresses)assert.ok(evidence.inputs.includes(address));
  assert.ok(Object.hasOwn(inspection.parts,evidence.producer.implementation.identity_address));
  assert.equal(evidence.value.domain_provenance.kernel_receipts.at(-1).calculation_address,'/calculations/predict_motion');
  assert.equal(executed.value.execution_failure.receipt.executed_count,1);
});

// Break caught: namespace mapping corrupts opaque IDs that happen to match a Part address.
test('domain aliasing qualifies typed address fields and preserves opaque colliding node IDs',async()=>{
  const p=await protocol(),definition=oneNode();definition.recipe.nodes[0].id='/model';
  const result=await p.run(definition),inspection=p.inspect(),composition=inspection.parts[result.value.domain_evidence_address];
  const prediction=composition.inputs.map(address=>inspection.parts[address]).find(record=>record.domain_address==='/prediction');
  assert.equal(prediction.producer.node_id,'/model');
  assert.equal(prediction.domain_producer.node_id,'/model');
  assert.equal(prediction.producer.output_address,prediction.address);
  assert.notEqual(prediction.producer.input_addresses[0],'/model');
});
