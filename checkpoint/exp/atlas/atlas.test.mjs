import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Tests are written before the executable modules. Missing public exports are the first red signal.
const load = () => import('./atlas-session.mjs');
const calc = () => import('./calculations.mjs');
const adapter = () => import('./runtime-adapter.mjs');
const p = expression => ({expression, bindings:{}});

test('safe interpreter uses literal independent arithmetic and charges all bindings', async () => {
  const {evaluate_program, program_size, canonical_program} = await calc();
  const program = {expression:'(x+2)*action+-1',bindings:{unused:123}};
  assert.deepEqual(evaluate_program(program,{transitions:[{x:3,action:4},{x:-2,action:10}]}).values,[19,-1]);
  assert.equal(program_size(p('x+2*action+1')),43);
  assert.equal(program_size(program),new TextEncoder().encode(canonical_program(program)).length);
  assert.ok(program_size(program)>program_size({...program,bindings:{}}));
});

test('complete parser rejects unsafe syntax, hidden branches, overflow, names and reserved bindings', async () => {
  const {evaluate_program} = await calc();
  for (const expression of ['x;alert(1)','x.constructor','x[0]','f(x)','x-action','x/action','x**2','-x','-(2)','x+unknown','1e999','x+2 garbage','True','x?1:2','x=2']) {
    assert.throws(()=>evaluate_program(p(expression),{transitions:[{x:1,action:2}]}),undefined,expression);
  }
  assert.throws(()=>evaluate_program({expression:'x',bindings:{x:3}},{transitions:[{x:1,action:2}]}));
  assert.throws(()=>evaluate_program(p('1e308*1e308'),{transitions:[{x:1,action:2}]}));
});

test('motion fitting and Beta/Boolean behavior preserve three-piece Python fixture', async () => {
  const {fit_motion,predict_motion,probe_model,probe_predictions,update_beta,probe_decision,evaluate_boolean,trainingFixture} = await calc();
  const model=fit_motion(trainingFixture(),{});
  assert.deepEqual([model.gain,model.bias,model.n,model.training_mse],[2,1,5,0]);
  assert.deepEqual(predict_motion(model,{transitions:[{x:-13,action:1},{x:50,action:10}]}).values,[-10,71]);
  assert.equal(probe_model(model,{expected_gain:2,expected_bias:1,tolerance:1e-9}).passed,true);
  const evidence=probe_predictions({values:[-10,71]},{values:[-10,71],tolerance:1e-9});
  const posterior=update_beta({alpha:1,beta:1},evidence);
  assert.equal(posterior.mean,0.75);
  assert.equal(probe_decision(posterior,{min_cases:2,min_mean:0.7}).accepted,true);
  assert.equal(probe_decision(posterior,{min_cases:2,min_mean:0.95}).accepted,false);
  assert.equal(evaluate_boolean('True or (enough and not reliable)',{enough:true,reliable:false}),true);
  assert.throws(()=>evaluate_boolean('True or unknown',{}));
  assert.throws(()=>evaluate_boolean('True or f()',{}));
  assert.throws(()=>update_beta({alpha:0,beta:1},evidence));
  assert.throws(()=>probe_predictions({values:[1]},{values:[1],tolerance:-1}));
});

test('DAG preflight permits multiple roots and rejects cycles, reference and namespace mistakes before bodies', async () => {
  const {AtlasRuntime,compileRecipe}=await adapter();
  let bodies=0;
  const runtime=new AtlasRuntime({add:(a,b)=>{bodies++;return a+b;}});
  const sources={'/a':1,'/b':2};
  const node=(id,inputs,output)=>({id,calculation:'add',inputs,output});
  const recipe={nodes:[node('two',['/a','/b'],'/d'),node('one',['/a','/b'],'/c')],outputs:{first:'/c',second:'/d'}};
  assert.equal(compileRecipe(recipe,runtime.registry,Object.keys(sources)).order.length,2);
  for(const bad of [
    {nodes:[node('cycle',['/c','/a'],'/c')],outputs:{}},
    {nodes:[node('missing',['/a','/missing'],'/c')],outputs:{}},
    {nodes:[node('path',['/a','/b'],'/bad/../c')],outputs:{}},
    {...recipe,outputs:{missing:'/gone'}},
    {nodes:[node('dup',['/a','/b'],'/c'),node('dup',['/a','/b'],'/d')],outputs:{}}
  ]) await assert.rejects(runtime.execute(bad,sources));
  assert.equal(bodies,0);
  const result=await runtime.execute(recipe,sources);
  assert.equal(result.outputs.first.value,3);
  assert.equal(result.outputs.second.value,3);
  assert.equal(bodies,1,'identical deterministic calls at multiple roots share one real execution');
});

test('live bounded search matches Python fixture behavior and genuinely prunes retained failures', async () => {
  const {createAtlasSession}=await load();
  const report=await createAtlasSession().run();
  // Golden fixture behavior is pinned from the unchanged search-summary.json, not browser byte claims.
  const fixture=JSON.parse(await readFile(new URL('./python-search-golden.json',import.meta.url)));
  assert.deepEqual(report.rounds.map(r=>r.program),fixture.rounds.map(r=>r.program));
  assert.deepEqual(report.rounds.map(r=>r.full_check.failed),[23,22,20,0]);
  assert.deepEqual(report.rounds.map(r=>r.pruned_count),[0,31,39,40]);
  assert.equal(report.accepted.program.expression,'x+2*action+1');
  assert.equal(report.accepted.size_bytes,43);
  assert.equal(report.reference.size_bytes,66);
  assert.equal(report.reference_crosscheck.failed,0);
  for(const round of report.rounds){
    assert.equal(round.full_check.n,25);
    assert.equal(round.constraint_count,round.round);
    assert.ok(round.receipt.executed_count>0);
  }
  assert.equal(report.rounds.at(-1).acceptance.accepted,true);
  assert.match(report.scope.claim,/finite grid/);
});

test('acceptance requires strict size, zero failures and all declared cases without Beta', async () => {
  const {accept_candidate}=await calc();
  const sizes={size_bytes:43,reference_size_bytes:66};
  assert.equal(accept_candidate({failed:0,n:25},sizes).accepted,true);
  assert.equal(accept_candidate({failed:1,n:25},sizes).accepted,false);
  assert.equal(accept_candidate({failed:0,n:24},sizes).accepted,false);
  assert.equal(accept_candidate({failed:0,n:25},{size_bytes:66,reference_size_bytes:66}).accepted,false);
});

test('counterexamples and final composition close over actual inputs and implementation Parts', async () => {
  const session=(await load()).createAtlasSession();
  const report=await session.run();
  const inspection=session.inspect();
  const parts=inspection.parts;
  for(const address of report.counterexample_addresses){
    const part=parts[address];
    assert.equal(part.producer.calculation,'retain_counterexample');
    assert.equal(part.value.producer.calculation,'evaluate_program');
    assert.equal(part.value.producer.output_address,part.value.prediction_address);
    assert.ok(parts[part.value.program_address]);
    assert.ok(parts[part.value.prediction_address]);
    for(const input of part.inputs)assert.ok(parts[input]);
  }
  const composition=parts[report.final_composition.composition_part.address];
  for(const address of report.final_composition.part_addresses)assert.ok(composition.inputs.includes(address),address);
  assert.ok(composition.inputs.includes('/calculations/fit_motion'));
  assert.ok(composition.inputs.includes('/implementations/calculations'));
  for(const part of Object.values(parts))for(const input of part.inputs)assert.ok(parts[input],input);
  assert.doesNotThrow(()=>JSON.stringify(inspection));
});

test('same session replay memoizes real bodies while kernel still makes receipts; changed model invalidates', async () => {
  const session=(await load()).createAtlasSession();
  await session.run();
  const replay=await session.replay();
  assert.equal(replay.receipt.executed_count,0);
  assert.equal(replay.receipt.cache_hit_count,42);
  assert.equal(replay.receipt.kernel_receipt_count,43);
  assert.equal(replay.receipt.composition_cache_hit_count,1);
  assert.ok(replay.inspection.cache.entries>0);
  const changed=await session.run({gain:-2,bias:-1});
  assert.equal(changed.model.gain,-2);
  assert.equal(changed.model.bias,-1);
  assert.notEqual(changed.accepted.program.expression,'x+2*action+1');
  assert.equal(changed.rounds.at(-1).full_check.failed,0);
  assert.ok(changed.bootstrap_receipt.executed_count>0);
  session.reset();
  assert.equal(session.inspect().cache.entries,0);
  await assert.rejects(session.replay());
});

test('registry replacement invalidates cached implementation bodies and export snapshots are isolated', async () => {
  const {AtlasRuntime}=await adapter();
  const runtime=new AtlasRuntime({add:(a,b)=>a+b});
  const recipe={nodes:[{id:'a',calculation:'add',inputs:['/a','/b'],output:'/c'}],outputs:{answer:'/c'}};
  const first=await runtime.execute(recipe,{'/a':2,'/b':3});
  assert.equal(first.outputs.answer.value,5);
  runtime.registry.add=(a,b)=>a*b;
  const second=await runtime.execute(recipe,{'/a':2,'/b':3});
  assert.equal(second.outputs.answer.value,6);
  assert.equal(second.receipt.executed_count,1);
  second.parts['/c'].value=999;
  assert.equal(runtime.inspect().parts['/c'].value,6);
});


test('optional live composition distinguishes good model, wrong model and policy-only cache invalidation', async () => {
  const session=(await load()).createAtlasSession();
  const good=await session.runComposition();
  assert.equal(good.outputs.posterior.value.mean,11/12);
  assert.equal(good.outputs.decision.value.accepted,true);
  assert.equal(good.outputs.prediction_probe.value.failed,0);
  const strict=await session.runComposition({min_mean:0.95});
  assert.equal(strict.outputs.decision.value.accepted,false);
  assert.equal(strict.receipt.executed_count,1);
  const wrong=await session.runComposition({gain:-2,bias:-1});
  assert.equal(wrong.outputs.prediction_probe.value.failed,10);
  assert.equal(wrong.outputs.decision.value.accepted,false);
});


test('actual computed source identities bind implementation Parts and every calculation producer', async () => {
  const {createHash}=await import('node:crypto');
  const files={};
  for(const file of ['exp/atlas/atlas-session.mjs','exp/atlas/calculations.mjs','exp/atlas/runtime-adapter.mjs','vendor/hh/services/pxc.mjs']){
    const bytes=await readFile(new URL('../../'+file,import.meta.url));
    files[file]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  }
  const implementationIdentity={schema:'atlas-implementation-closure@1',roots:['exp/atlas/atlas-session.mjs'],files};
  implementationIdentity.digest=createHash('sha256').update(JSON.stringify(implementationIdentity)).digest('hex');
  const session=(await load()).createAtlasSession({implementationIdentity});
  const report=await session.run();
  const parts=session.inspect().parts;
  assert.deepEqual(parts['/implementations/source'].value,implementationIdentity);
  assert.ok(report.final_composition.part_addresses.includes('/implementations/source'));
  assert.equal(parts['/models/fitted'].producer.implementation.source_digest,files['exp/atlas/calculations.mjs'].sha256);
  assert.equal(parts['/models/fitted'].producer.kernel.source_digest,files['vendor/hh/services/pxc.mjs'].sha256);
  assert.equal(parts['/models/fitted'].producer.adapter.source_digest,files['exp/atlas/runtime-adapter.mjs'].sha256);
  assert.equal(parts['/models/fitted'].producer.implementation.identity_address,'/implementations/source');
});

test('declared __proto__ output remains an actual own output binding through compilation and execution', async () => {
  const {AtlasRuntime,compileRecipe}=await adapter();
  const runtime=new AtlasRuntime({add:(a,b)=>a+b});
  const recipe={nodes:[{id:'sum',calculation:'add',inputs:['/a','/b'],output:'/sum'}],outputs:JSON.parse('{"__proto__":"/sum"}')};
  const compiled=compileRecipe(recipe,runtime.registry,['/a','/b']);
  assert.equal(Object.hasOwn(compiled.outputs,'__proto__'),true);
  assert.equal(compiled.outputs.__proto__,'/sum');
  const result=await runtime.execute(recipe,{'/a':2,'/b':3});
  assert.equal(Object.hasOwn(result.outputs,'__proto__'),true);
  assert.equal(result.outputs.__proto__.address,'/sum');
  assert.equal(result.outputs.__proto__.value,5);
  assert.equal(result.composition_part.value.outputs.__proto__,'/sum');
});

test('motion fit subtracts each large position before accumulating displacement', async () => {
  const {fit_motion}=await calc();
  const model=fit_motion({transitions:[
    {x:0,action:0,next_x:1},
    {x:1e16,action:1,next_x:1e16+2}
  ]},{});
  assert.equal(model.gain,1);
  assert.equal(model.bias,1);
  assert.equal(model.training_mse,0);
});

test('durable recipe export roundtrips literal source Parts in a fresh runtime without receipts or shared mutation', async () => {
  const {createHash}=await import('node:crypto');
  const files={};
  for(const file of ['exp/atlas/atlas-session.mjs','exp/atlas/calculations.mjs','exp/atlas/runtime-adapter.mjs','vendor/hh/services/pxc.mjs']){
    const bytes=await readFile(new URL('../../'+file,import.meta.url));
    files[file]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  }
  const implementationIdentity={schema:'atlas-implementation-closure@1',roots:['exp/atlas/atlas-session.mjs'],files};
  implementationIdentity.digest=createHash('sha256').update(JSON.stringify(implementationIdentity)).digest('hex');
  const session=(await load()).createAtlasSession({implementationIdentity});
  assert.throws(()=>session.exportRecipe(),/run the atlas before/);
  const report=await session.run();
  const definition=session.exportRecipe();
  assert.deepEqual(Object.keys(definition).sort(),['format','implementationIdentity','recipe','sources']);
  assert.equal(definition.format,'kompozed.atlas.recipe.v1');
  assert.deepEqual(definition.implementationIdentity,implementationIdentity);
  assert.equal(definition.sources['/parts/training'].transitions.length,5);
  assert.equal(definition.sources['/parts/queries'].transitions.length,25);
  const {AtlasRuntime}=await adapter();
  const fresh=new AtlasRuntime(undefined,{implementationIdentity:definition.implementationIdentity});
  const result=await fresh.execute(definition.recipe,definition.sources);
  assert.deepEqual(result.outputs.model.value,report.model);
  assert.deepEqual(result.outputs.reference.value,report.reference.program);
  assert.deepEqual(result.outputs.program.value,report.accepted.program);
  assert.deepEqual(result.outputs.acceptance.value,report.rounds.at(-1).acceptance);
  assert.equal(result.outputs.acceptance.value.accepted,true);
  assert.equal(result.receipt.executed_count,42,'a fresh runtime executes the exported complete graph');
  definition.recipe.nodes[0].calculation='invalid';
  definition.sources['/parts/training'].transitions[0].x=999;
  definition.implementationIdentity.digest='mutated';
  const isolated=session.exportRecipe();
  assert.equal(isolated.recipe.nodes[0].calculation,'fit_motion');
  assert.equal(isolated.sources['/parts/training'].transitions[0].x,-4);
  assert.equal(isolated.implementationIdentity.digest,implementationIdentity.digest);
  session.reset();
  assert.throws(()=>session.exportRecipe(),/run the atlas before/);
});
