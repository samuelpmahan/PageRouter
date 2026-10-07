import test from 'node:test';
import assert from 'node:assert/strict';
import { createHHWorkbench } from '../cooperative/hh-workbench.mjs';

const inputSchema = {type:'object',required:['state'],properties:{state:{type:'string'}},example:{state:'Demo Washington'}};
const statePlan = {name:'Counties for state',stages:[
  {id:'states',operation:'school.states',inputs:{}},
  {id:'counties',operation:'school.counties',inputs:{state:{$input:'state'}}},
]};
const fresh = () => createHHWorkbench({storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
const addresses = async (hh) => (await hh.listParts()).map(x=>x.address).sort();

test('named Calculation is a real pinned function Part with inspectable source graph and actual output receipts', async () => {
  const hh=fresh();
  const result=await hh.defineCalculation({id:'countiesForState',plan:statePlan,inputSchema,outputs:[{path:'outcomes.1.result.data.values',type:'array'}]});
  assert.equal(result.ok,true);
  const definition=result.definition;
  assert.equal(definition.operation,'calculation.countiesForState');
  assert.equal(definition.operationVersion,'calculation.countiesForState@1');
  assert.equal(definition.version,1);
  assert.ok(definition.address);
  assert.equal(definition.sourceGraph.format,'pxcube-composition-graph/1');
  assert.deepEqual(definition.sourceGraph.bindings.find(x=>x.kind==='parameter')?.path,'state');
  const functionPart=await hh.inspectPart(definition.address);
  assert.equal(functionPart.kind,'definedCalculationPart');
  assert.equal(functionPart.calculation.version,1);
  assert.equal(functionPart.calculation.operation,'calculation.countiesForState');
  assert.equal(functionPart.value.executable,true);
  const run=await hh.invoke(definition.operationVersion,{state:'Demo Washington'});
  assert.equal(run.ok,true);
  assert.equal(run.receipt.status,'produced');
  assert.ok(run.receipt.into);
  assert.ok(run.result.outcomes.some(x=>x.operation==='school.counties' && x.ok));
  assert.deepEqual(run.result.outcomes[1].result.data.values,['Demo King']);
  const parts=await hh.listParts();
  assert.ok(parts.some(x=>x.address===definition.address && x.kind==='definedCalculationPart'));
});

test('nested composed Calculations pin dependency versions and execute through the same PxC', async () => {
  const hh=fresh();
  const inner=await hh.defineCalculation({id:'inner',plan:statePlan,inputSchema,
    outputs:[{path:'outcomes.1.result.data.values',type:'array'}]});
  assert.ok(inner.ok);
  const outerPlan={name:'Outer calls inner',stages:[
    {id:'invokeInner',operation:inner.definition.operationVersion,inputs:{state:{$input:'state'}}},
  ]};
  const outer=await hh.defineCalculation({id:'outer',plan:outerPlan,inputSchema,
    outputs:[{path:'outcomes.0.result.outcomes.1.result.data.values',type:'array'}]});
  assert.ok(outer.ok,outer.error?.message);
  assert.equal(outer.definition.plan.stages[0].operation,'calculation.inner@1');
  assert.ok(outer.definition.sourceGraph.nodes[0].operation==='calculation.inner@1');
  const run=await hh.invoke(outer.definition.operationVersion,{state:'Demo Washington'});
  assert.equal(run.ok,true);
  assert.equal(run.result.outcomes[0].operation,'calculation.inner@1');
  assert.deepEqual(run.result.outcomes[0].result.outcomes[1].result.data.values,['Demo King']);
  const receiptList=hh.inspect().kernel.receipts;
  assert.ok(receiptList.some(r=>r.into===run.receipt.into));
  assert.ok(receiptList.some(r=>r.into.startsWith('hh.result.')));
});

test('replacement creates a new version while older nested callers stay pinned to v1', async () => {
  const hh=fresh();
  const v1=await hh.defineCalculation({id:'stableLookup',plan:statePlan,inputSchema});
  const caller=await hh.defineCalculation({id:'caller',plan:{name:'Calls pinned v1',stages:[
    {id:'call',operation:v1.definition.operationVersion,inputs:{state:{$input:'state'}}},
  ]},inputSchema});
  const v2=await hh.defineCalculation({id:'stableLookup',replace:true,plan:{name:'States only',stages:[
    {id:'states',operation:'school.states',inputs:{}},
  ]},inputSchema:{type:'object',properties:{}}});
  assert.equal(v2.ok,true);
  assert.equal(v2.definition.version,2);
  assert.equal(v2.definition.operationVersion,'calculation.stableLookup@2');
  assert.equal((await hh.listCalculationVersions('stableLookup')).length,2);
  assert.equal(hh.listDefinedCalculations().find(x=>x.id==='stableLookup').version,2);
  assert.equal(caller.definition.plan.stages[0].operation,'calculation.stableLookup@1');
  const run=await hh.invoke(caller.definition.operationVersion,{state:'Demo Washington'});
  assert.equal(run.ok,true);
  assert.deepEqual(run.result.outcomes[0].result.outcomes[1].result.data.values,['Demo King']);
});

test('session export/import round-trip restores definitions without executing them, then explicit invocation works', async () => {
  const origin=fresh();
  const inner=await origin.defineCalculation({id:'inner',plan:statePlan,inputSchema});
  await origin.defineCalculation({id:'outer',plan:{name:'Outer',stages:[
    {id:'callInner',operation:inner.definition.operationVersion,inputs:{state:{$input:'state'}}},
  ]},inputSchema});
  const exportBefore=origin.exportSession();
  assert.equal(exportBefore.format,'hh-workbench-session');
  assert.equal(exportBefore.version,1);
  assert.equal(exportBefore.definitions.length,2);
  assert.ok(!JSON.stringify(exportBefore).includes('receipt'));
  const restored=fresh();
  const partsBefore=await addresses(restored);
  const receiptsBefore=restored.inspect().kernel.receipts.length;
  const imported=await restored.importSession(exportBefore);
  assert.equal(imported.ok,true,imported.error?.message);
  assert.deepEqual([...imported.imported].sort(),['calculation.inner@1','calculation.outer@1']);
  assert.equal(restored.inspect().kernel.receipts.length,receiptsBefore,'loading definitions alone must not run them');
  assert.ok((await addresses(restored)).length>partsBefore.length);
  const outer=restored.listDefinedCalculations().find(x=>x.id==='outer');
  const run=await restored.invoke(outer.operationVersion,{state:'Demo Washington'});
  assert.equal(run.ok,true);
  assert.deepEqual(run.result.outcomes[0].result.outcomes[1].result.data.values,['Demo King']);
});

test('invalid cyclic, unresolved, duplicate, credential-bearing, and wrong-shape sessions reject atomically', async () => {
  const hh=fresh();
  const baseline=await hh.defineCalculation({id:'baseline',plan:statePlan,inputSchema});
  assert.ok(baseline.ok);
  const originalParts=await addresses(hh);
  const originalNames=hh.listDefinedCalculations().map(d=>`${d.id}@${d.version}`);
  const originalReceipts=hh.inspect().kernel.receipts.length;
  const session=(definitions)=>({format:'hh-workbench-session',version:1,definitions});
  const schema={type:'object',properties:{}};
  const cycle=session([
    {id:'cycleA',version:1,active:true,inputSchema:schema,plan:{stages:[{id:'callB',operation:'calculation.cycleB@1',inputs:{}}]}},
    {id:'cycleB',version:1,active:true,inputSchema:schema,plan:{stages:[{id:'callA',operation:'calculation.cycleA@1',inputs:{}}]}},
  ]);
  const unresolved=session([{id:'missingRef',version:1,active:true,inputSchema:schema,plan:{stages:[{id:'call',operation:'calculation.noSuch@8',inputs:{}}]}}]);
  const duplicate=session([
    {id:'dupe',version:1,active:true,inputSchema:schema,plan:{stages:[{id:'x',operation:'school.states',inputs:{}}]}},
    {id:'dupe',version:1,active:true,inputSchema:schema,plan:{stages:[{id:'y',operation:'school.states',inputs:{}}]}},
  ]);
  const secret=session([{id:'withSecret',version:1,active:true,inputSchema:{type:'object',properties:{state:{type:'string'}}},plan:{stages:[{id:'x',operation:'school.counties',inputs:{state:{$input:'state'},apiToken:'not-a-real-token'}}]}}]);
  const malformed={format:'hh-workbench-session',version:1,definitions:{bad:true}};
  const wrongSchema=session([{id:'badField',version:1,active:true,inputSchema:JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),plan:{stages:[{id:'x',operation:'school.states',inputs:{}}]}}]);
  for (const candidate of [cycle,unresolved,duplicate,secret,malformed,wrongSchema]) {
    const result=await hh.importSession(candidate);
    assert.equal(result.ok,false,JSON.stringify(candidate));
    assert.deepEqual(await addresses(hh),originalParts,'failed import must not add Parts');
    assert.deepEqual(hh.listDefinedCalculations().map(d=>`${d.id}@${d.version}`),originalNames,'failed import must not mutate definitions');
    assert.equal(hh.inspect().kernel.receipts.length,originalReceipts,'failed import must not execute operations');
  }
  assert.equal((await hh.invoke('calculation.baseline@1',{state:'Demo Washington'})).ok,true,'preexisting definition stays usable after all failures');
});

test('unsafe credential-shaped definition parameters are rejected before adding a function Part', async () => {
  const hh=fresh();
  const before=await addresses(hh);
  const result=await hh.defineCalculation({id:'credentialProbe',inputSchema:{type:'object',properties:{state:{type:'string'}}},plan:{stages:[
    {id:'counties',operation:'school.counties',inputs:{state:{$input:'state'},password:'not-a-real-password'}},
  ]}});
  assert.equal(result.ok,false);
  assert.deepEqual(await addresses(hh),before);
  assert.deepEqual(hh.listDefinedCalculations(),[]);
});
