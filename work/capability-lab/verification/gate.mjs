import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const product = resolve(process.argv[2] ?? join(root, 'outputs/capability-lab'));
const mode = process.argv[3] ?? 'full';
const evidence = join(root, 'outputs/capability-lab/evidence/independent');
const fixtures = JSON.parse(await readFile(join(here, 'fixtures.json'), 'utf8'));
const report = { schema: 'capability-lab.independent.gate.v1', generatedAt: new Date().toISOString(),
  product, mode, fixtureProvenance: fixtures.provenance, checks: [], coverage: {}, sourceFiles: [] };
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
const clone = value => structuredClone(value);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function near(actual, expected, abs = 1e-9, rel = 1e-9) {
  assert.equal(typeof actual, typeof expected);
  if (typeof expected === 'number') {
    assert.ok(Number.isFinite(actual), `nonfinite result ${actual}`);
    assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual)); assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => near(actual[index], value, abs, rel));
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    Object.keys(expected).forEach(key => near(actual[key], expected[key], abs, rel));
  } else assert.equal(actual, expected);
}
const pick = (result, field) => field ? field.split('.').reduce((value, key) => value?.[key], result) : result;
const multiply = (a,b) => a.map(row => b[0].map((_,j) => row.reduce((s,v,k) => s + v*b[k][j],0)));
const transposed = a => a[0].map((_,j) => a.map(row => row[j]));
const eye = n => Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>Number(i===j)));
const matvec = (a,x) => a.map(row=>row.reduce((s,v,j)=>s+v*x[j],0));
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).reverse().map(k=>[k,reverseKeys(value[k])])) : value;
function replaceFirstNumber(value, replacement) {
  let done = false;
  function visit(v) {
    if (!done && typeof v === 'number') { done=true; return replacement; }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));
    return v;
  }
  const result=visit(value); return done ? result : null;
}
async function check(name, family, action, details={}) {
  const started=performance.now();
  try { const observed=await action(); report.checks.push({name,family,status:'pass',elapsedMs:performance.now()-started,...details,...(observed?{observed}:{})}); }
  catch(error) { report.checks.push({name,family,status:'fail',elapsedMs:performance.now()-started,...details,error:error.message}); }
}
async function sourceSnapshot() {
  const files=[];
  const queue=[join(product,'src')];
  while(queue.length) {
    const directory=queue.pop();
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory())queue.push(path);
      else if(entry.name.endsWith('.mjs')) { const bytes=await readFile(path); files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}); }
    }
  }
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
let registry, capabilities, createRegistry;
try {
  const paths=mode==='partial' ? ['statistics/index.mjs','linalg/index.mjs']
    : ['statistics/index.mjs','linalg/index.mjs','composed/index.mjs'];
  const modules=await Promise.all(paths.map(path=>import(pathToFileURL(join(product,'src',path)))));
  ({createRegistry}=await import(pathToFileURL(join(product,'src/runtime/index.mjs'))));
  capabilities=modules.flatMap(module=>module.capabilities);
  registry=createRegistry(capabilities,{source:'independent-fixture-gate',version:'1'});
  report.sourceFiles=await sourceSnapshot();
} catch(error) { report.blocked={message:error.message}; }

if(registry) {
  const byId=new Map(capabilities.map(c=>[c.id,c]));
  // This executor is independent of the product runtime. Frozen input catches writes;
  // ctx.call records and enforces real direct dependency use.
  function independentCall(id,input,ancestors=[]) {
    const descriptor=byId.get(id); assert.ok(descriptor,`missing descriptor ${id}`);
    assert.ok(!ancestors.includes(id),`recursive descriptor ${id}`);
    const used=new Set();
    const actual=descriptor.run(freeze(clone(input)), { seed:771, random:()=>{throw Error('Use runtime for seeded random descriptor');},
      call(child,childInput) { assert.ok(descriptor.dependsOn.includes(child),`undeclared call ${id} -> ${child}`); used.add(child); return independentCall(child,childInput,[...ancestors,id]); } });
    assert.ok(!actual || typeof actual.then!=='function','async descriptor');
    for(const child of descriptor.dependsOn)assert.ok(used.has(child),`unused dependency ${id} -> ${child}`);
    return actual;
  }
  for(const fixture of fixtures.numeric) await check(fixture.name,'hand-numeric',()=>{
    const result=independentCall(fixture.id,fixture.input); near(pick(result,fixture.select),fixture.expected); return {id:fixture.id,input:fixture.input,result};
  },{reproduce:{id:fixture.id,input:fixture.input,expected:fixture.expected,select:fixture.select}});
  for(const fixture of fixtures.reject) await check(fixture.name,'degenerate-rejection',()=>{
    assert.ok(byId.has(fixture.id),`missing descriptor ${fixture.id}`);
    assert.throws(()=>independentCall(fixture.id,fixture.input)); return {id:fixture.id,input:fixture.input,rejected:true};
  },{reproduce:{id:fixture.id,input:fixture.input}});

  function traceCheck(node, path=[]) {
    const descriptor=byId.get(node.id); assert.ok(descriptor,`unknown trace id ${node.id}`);
    const children=node.calls??[]; const used=new Set(children.map(child=>child.id));
    assert.deepEqual([...used].sort(),[...descriptor.dependsOn].sort(),`direct trace dependencies at ${[...path,node.id].join(' -> ')}`);
    assert.ok(typeof node.order==='number','trace order absent');
    children.forEach(child=>traceCheck(child,[...path,node.id]));
  }
  for(const capability of capabilities) {
    assert.ok(Array.isArray(capability.examples));
    for(let index=0;index<capability.examples.length;index++) {
      const example=capability.examples[index]; const label=`${capability.id} example ${index}`;
      await check(label,'descriptor-example',()=>{
        const input=freeze(clone(example.input)), before=canonical(input);
        const receipt=registry.execute(capability.id,input,{seed:771});
        near(receipt.result,example.expected); assert.equal(canonical(input),before); traceCheck(receipt.trace);
        const replay=registry.replay(receipt); assert.equal(replay.matches,true); assert.equal(replay.exact,true); assert.equal(replay.hash,true);
        assert.equal(receipt.replay.resultCanonical,canonical(receipt.result));
        return {id:capability.id,order:registry.get(capability.id).order,trace:receipt.trace,replay:receipt.replay};
      },{reproduce:{id:capability.id,input:example.input,expected:example.expected}});
      await check(`${label} property order independence`,'property-order',()=>{
        const first=registry.execute(capability.id,example.input,{seed:771});
        const second=registry.execute(capability.id,reverseKeys(example.input),{seed:771});
        assert.equal(canonical(first.result),canonical(second.result));
      },{reproduce:{id:capability.id,input:reverseKeys(example.input)}});
      for(const bad of [NaN,Infinity,-Infinity]) {
        const invalid=replaceFirstNumber(example.input,bad);
        if(invalid) await check(`${label} nonfinite ${String(bad)}`,'nonfinite-rejection',()=>assert.throws(()=>registry.execute(capability.id,invalid,{seed:771})));
      }
    }
  }
  const execute=(id,input)=>registry.execute(id,input,{seed:771}).result;
  await check('pivoted solve exact hand solution','solve-invariant',()=>near(execute('linalg.solve',{matrix:[[0,1],[1,1]],vector:[2,3]}),[1,2]));
  await check('inverse reconstruction','inverse-invariant',()=>{const a=[[4,7],[2,6]];const r=execute('linalg.inverse',{matrix:a});near(multiply(a,r),eye(2));});
  await check('pivoted LU independent reconstruction','factorization-invariant',()=>{
    const a=[[0,2,1],[3,4,2],[1,0,5]],r=execute('linalg.luDecompose',{matrix:a});
    assert.deepEqual([...r.permutation].sort(),[0,1,2]);near(multiply(r.lower,r.upper),r.permutation.map(i=>a[i]));
    r.lower.forEach((row,i)=>row.forEach((v,j)=>{if(j>i)near(v,0);if(i===j)near(v,1);}));
    r.upper.forEach((row,i)=>row.forEach((v,j)=>{if(j<i)near(v,0);}));near(execute('linalg.determinant',{matrix:a}),-30);
  });
  await check('Cholesky hand lower factor and independent reconstruction','factorization-invariant',()=>{
    const a=[[25,15,-5],[15,18,0],[-5,0,11]],{lower}=execute('linalg.cholesky',{matrix:a});
    near(lower,[[5,0,0],[3,3,0],[-1,1,3]]);near(multiply(lower,transposed(lower)),a);
    assert.throws(()=>execute('linalg.cholesky',{matrix:[[1,2],[2,1]]}));
  });
  await check('QR reconstruction and independent column orthogonality','factorization-invariant',()=>{
    const a=[[1,1],[1,0],[0,1]],{q,r,rank}=execute('linalg.qr',{matrix:a}); assert.equal(rank,2);near(multiply(q,r),a);near(multiply(transposed(q),q),eye(2));
  });
  await check('QR rank with a zero leading column','factorization-degenerate',()=>{
    const a=[[0,1],[0,0]],{q,r,rank}=execute('linalg.qr',{matrix:a});assert.equal(rank,1);near(multiply(q,r),a);
  },{reproduce:{id:'linalg.qr',input:{matrix:[[0,1],[0,0]]},expectedRank:1}});
  await check('least squares normal-equation residual orthogonality','least-squares-invariant',()=>{
    const a=[[1,0],[1,1],[1,2]],b=[1,2,2],r=execute('linalg.leastSquares',{matrix:a,vector:b});
    near(r.solution,[1.1666666666666667,0.5]);
    const fitted=matvec(a,r.solution),residual=b.map((v,i)=>v-fitted[i]);near(matvec(transposed(a),residual),[0,0]);
  });
  await check('symmetric eigen residual and independent orthonormality','eigen-invariant',()=>{
    const a=[[2,1],[1,2]],r=execute('linalg.symmetricEigen',{matrix:a}); near(r.eigenvalues,[3,1]);near(multiply(transposed(r.eigenvectors),r.eigenvectors),eye(2));
    transposed(r.eigenvectors).forEach((v,i)=>near(matvec(a,v),v.map(x=>x*r.eigenvalues[i])));
  });
  for(const scale of [1e-12,1e12]) await check(`well conditioned solve scale ${scale}`,'scale-invariant',()=>{
    const a=[[2,1],[1,3]],b=[4,7];near(execute('linalg.solve',{matrix:a.map(row=>row.map(v=>v*scale)),vector:b.map(v=>v*scale)}),[1,2]);
  });
  await check('minimum subnormal vector normalization','numeric-extremes',()=>near(execute('linalg.normalize',{vector:[5e-324,0]}),[1,0],0,0));
  await check('opposite-sign extreme median interpolation','numeric-extremes',()=>near(execute('statistics.quantile',{values:[-1e308,1e308],probability:0.5}).value,0,0,0));
  await check('sum overflows but mean remains representable','numeric-extremes',()=>near(execute('statistics.mean',{values:[1e308,1e308]}).value,1e308,0,1e-14));
  await check('moment invariance under observation permutation','statistical-invariant',()=>{
    for(const id of ['statistics.mean','statistics.variance','statistics.onlineMoments','statistics.robustSummary']) {
      const a=execute(id,{values:[1,2,3,4]}),b=execute(id,{values:[4,2,1,3]});near(a,b);
    }
  });
  await check('unequal-group Welch hand degrees of freedom','group-comparison-hand',()=>{
    near(execute('statistics.welchMeanDifference',{a:[0,2],b:[0,0,3]}),
      {meanA:1,meanB:1,difference:0,standardError:Math.sqrt(2),degreesOfFreedom:8/3,testStatistic:0});
  });
  await check('online result reused as next retained state','streaming-integration',()=>{
    let state={count:0,mean:0,m2:0};for(const value of [1,2,3,4])state=execute('statistics.onlineUpdate',{state,value});
    near(state,{count:4,mean:2.5,m2:5,variance:1.25});
  });
  await check('projection residual independently orthogonal','vector-invariant',()=>{
    const v=[2,4,6],onto=[1,2,0],p=execute('linalg.project',{vector:v,onto});
    near(v.reduce((sum,x,i)=>sum+(x-p[i])*onto[i],0),0);
  });
  await check('rotation preserves Euclidean length','transform-invariant',()=>{
    for(const angle of [0,Math.PI/2,Math.PI,-0.37]) {
      const r=execute('linalg.rotate2D',{vector:[3,4],angle});near(Math.hypot(...r),5);
    }
  });
  await check('affine origin maps to declared translation','transform-invariant',()=>{
    const matrix=execute('linalg.transform2D',{translation:[3,-7],rotation:0.7,scale:[2,4]});
    near(execute('linalg.applyTransform',{matrix,vector:[0,0]}),[3,-7]);
  });
  await check('seeded resampling deterministic and changed seed effective','resampling-invariant',()=>{
    const input={values:[10,20,30,40],sampleSize:128,seed:17};
    const a=execute('statistics.resampleWithReplacement',input),b=execute('statistics.resampleWithReplacement',input),c=execute('statistics.resampleWithReplacement',{...input,seed:18});
    assert.equal(canonical(a),canonical(b));assert.notEqual(canonical(a.values),canonical(c.values));assert.equal(a.seed,17);
    assert.equal(a.values.length,128);assert.ok(a.values.every(x=>input.values.includes(x)));
  });
  await check('constant-data bootstrap confidence bounds are exact','confidence-invariant',()=>{
    near(execute('statistics.bootstrapMeanCI',{values:[7,7,7],replicates:50,seed:17,confidence:0.95}),
      {estimate:7,lower:7,upper:7,replicates:50,seed:17,confidence:0.95});
  });
  await check('two-value bootstrap retains analytical support','resampling-quality',()=>{
    const input={values:[0,10],replicates:1000,seed:1,confidence:0.95},r=execute('statistics.bootstrapMeanCI',input);
    // Exact bootstrap sample means are 0,5,10 with probabilities 1/4,1/2,1/4.
    // A .95 percentile interval must represent both tails at this sample size;
    // systematic missing support from adjacent re-seeding is unacceptable.
    near(r.estimate,5);near(r.lower,0);near(r.upper,10);
    return {input,result:r,analyticalMeanProbabilities:{0:0.25,5:0.5,10:0.25}};
  },{reproduce:{id:'statistics.bootstrapMeanCI',input:{values:[0,10],replicates:1000,seed:1,confidence:0.95},expected:{lower:0,upper:10},rationale:'Seeded statistical-quality probe against exact two-observation bootstrap distribution; not a universal finite-replicate guarantee'}});
  await check('paired bootstrap reverses sign for constant paired effect','confidence-invariant',()=>{
    const parameters={replicates:25,seed:17,confidence:0.95};
    const a=execute('statistics.bootstrapPairedDifferenceCI',{x:[4,7,10],y:[1,4,7],...parameters}),b=execute('statistics.bootstrapPairedDifferenceCI',{x:[1,4,7],y:[4,7,10],...parameters});
    near([a.estimate,a.lower,a.upper],[3,3,3]);near([b.estimate,b.lower,b.upper],[-3,-3,-3]);
  });
  for(const [label,id,input] of [
    ['resample output count','statistics.resampleWithReplacement',{values:[1,2],sampleSize:100001,seed:1}],
    ['bootstrap replicate count','statistics.bootstrapMeanCI',{values:[1,2],replicates:1001,seed:1,confidence:0.95}],
    ['bootstrap sample work','statistics.bootstrapMeanCI',{values:Array.from({length:101},(_,i)=>i),replicates:1000,seed:1,confidence:0.95}],
    ['confidence zero','statistics.bootstrapMeanCI',{values:[1,2],replicates:10,seed:1,confidence:0}],
    ['confidence one','statistics.bootstrapMeanCI',{values:[1,2],replicates:10,seed:1,confidence:1}],
    ['negative seed','statistics.resampleWithReplacement',{values:[1,2],sampleSize:2,seed:-1}]
  ]) await check(`statistics bounded ${label}`,'statistical-resource-limits',()=>assert.throws(()=>execute(id,input)));
  if(mode==='full') {
    await check('shifted PCA hand covariance, axes and scores','cross-domain-hand',()=>{
      const observations=[[8,20],[10,19],[10,21],[12,20]],r=execute('composed.pcaScores',{observations});
      near(r.means,[10,20]);near(r.covarianceMatrix,[[8/3,0],[0,2/3]]);near(r.eigenvalues,[8/3,2/3]);
      near(r.scores,[[-2,0],[0,-1],[0,1],[2,0]]);
      const reconstructed=multiply(r.scores,transposed(r.eigenvectors)).map(row=>row.map((v,j)=>v+r.means[j]));near(reconstructed,observations);
      return {input:{observations},result:r};
    });
    await check('noisy regression hand residuals and changed outcome','cross-domain-hand',()=>{
      const matrix=[[1,0],[1,1],[1,2]],vector=[1,2,2],a=registry.execute('composed.regressionDiagnostics',{matrix,vector});
      near(a.result.coefficients,[7/6,0.5]);near(a.result.residuals,[-1/6,1/3,-1/6]);near(a.result.residualPopulationVariance,1/18);near(a.result.solverResidualNorm,Math.sqrt(1/6));
      const changed=registry.execute('composed.regressionDiagnostics',{matrix,vector:vector.map(v=>v+10)});
      near(changed.result.coefficients,[67/6,0.5]);near(changed.result.residuals,a.result.residuals);assert.notEqual(changed.replay.resultHash,a.replay.resultHash);
      assert.equal(registry.replay(changed).matches,true);return {base:a.result,changed:changed.result};
    });
    await check('cross-domain standardized profiles reject constant feature','cross-domain-degenerate',()=>
      assert.throws(()=>execute('composed.standardizedEuclideanProfiles',{observations:[[1,2],[1,3],[1,4]]})));
    await check('PCA refuses nonconverged eigensystem','cross-domain-degenerate',()=>
      assert.throws(()=>execute('composed.pcaScores',{observations:[[1,2,3],[2,0,1],[0,4,2],[3,1,0]],maxIterations:1}),/unconverged|nonconverged/i));
    await check('zero covariance PCA retains honest degenerate zeros','cross-domain-degenerate',()=>{
      const r=execute('composed.pcaScores',{observations:[[2,3],[2,3],[2,3]]});near(r.eigenvalues,[0,0]);near(r.scores,[[0,0],[0,0],[0,0]]);
    });
  }

  const numberSchema={type:'object',properties:{x:{type:'number'}},required:['x'],additionalProperties:false};
  const scalarSchema={type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false};
  const atom={id:'probe.atom',title:'Probe',description:'Hand fixture',kind:'atomic',dependsOn:[],inputSchema:numberSchema,outputSchema:scalarSchema,examples:[{input:{x:2},expected:{value:2}}],run:({x})=>({value:x})};
  const composed=(id,child)=>({...atom,id,kind:'composed',dependsOn:[child],run:({x},ctx)=>({value:ctx.call(child,{x}).value+1})});
  await check('runtime derives three real composition levels','runtime-contract',()=>{
    const r=createRegistry([atom,composed('probe.one','probe.atom'),composed('probe.two','probe.one'),composed('probe.three','probe.two')],{source:'hand-fixture',version:'1'});
    assert.equal(r.get('probe.three').order,3); assert.equal(r.execute('probe.three',{x:2}).result.value,5);
  });
  await check('runtime duplicate ID rejected','runtime-contract',()=>assert.throws(()=>createRegistry([atom,atom])));
  await check('runtime unknown dependency rejected','runtime-contract',()=>assert.throws(()=>createRegistry([composed('probe.one','missing')])));
  await check('runtime cycle rejected','runtime-contract',()=>assert.throws(()=>createRegistry([composed('probe.one','probe.two'),composed('probe.two','probe.one')])));
  await check('runtime undeclared direct call rejected','runtime-contract',()=>{
    const bad={...atom,id:'probe.bad',run:(input,ctx)=>ctx.call('probe.atom',input)}; assert.throws(()=>createRegistry([atom,bad]).execute(bad.id,{x:2}));
  });
  await check('runtime unused declared dependency rejected','runtime-contract',()=>{
    const bad={...atom,id:'probe.bad',kind:'composed',dependsOn:['probe.atom']}; assert.throws(()=>createRegistry([atom,bad]).execute(bad.id,{x:2}));
  });
  await check('runtime invalid input rejected','runtime-contract',()=>assert.throws(()=>createRegistry([atom]).execute(atom.id,{x:'2'})));
  await check('runtime invalid output rejected','runtime-contract',()=>{
    const bad={...atom,run:()=>({value:Infinity})}; assert.throws(()=>createRegistry([bad]).execute(bad.id,{x:2}));
  });
  await check('runtime thenable rejected','runtime-contract',()=>{
    const bad={...atom,run:()=>Promise.resolve({value:2})}; assert.throws(()=>createRegistry([bad]).execute(bad.id,{x:2}));
  });
  await check('unseeded deterministic runtime replay','replay-integrity',()=>{
    const r=createRegistry([atom]);assert.equal(r.replay(r.execute(atom.id,{x:2})).matches,true);
  });
  const chain=[atom,composed('probe.one','probe.atom'),composed('probe.two','probe.one'),composed('probe.three','probe.two')];
  for(const [name,limits,expectedCode] of [
    ['call depth',{maxCallDepth:2},'CALL_DEPTH_LIMIT'],
    ['call count',{maxCalls:2},'CALL_COUNT_LIMIT'],
    ['trace payload',{maxTracePayloadBytes:100},'TRACE_PAYLOAD_LIMIT'],
    ['canonical value bytes',{maxValueBytes:5},'VALUE_SIZE_LIMIT']
  ]) await check(`runtime bounded ${name}`,'runtime-resource-limits',()=>{
    const r=createRegistry(chain,{limits});assert.throws(()=>r.execute('probe.three',{x:2}),error=>error.code===expectedCode);
  });
  await check('runtime nested value depth bounded','runtime-resource-limits',()=>{
    const loose={...atom,inputSchema:{type:'object',additionalProperties:true},examples:[]};
    const r=createRegistry([loose],{limits:{maxValueDepth:2}});
    assert.throws(()=>r.execute(loose.id,{x:2,nested:{a:{b:1}}}),error=>error.code==='VALUE_DEPTH_LIMIT');
  });
  await check('runtime execution accounting does not accumulate history','runtime-resource-limits',()=>{
    const r=createRegistry(chain,{limits:{maxCalls:4}});let baseline;
    for(let i=0;i<50;i++){const receipt=r.execute('probe.three',{x:2});const counters={calls:receipt.replay.calls,bytes:receipt.replay.tracePayloadBytes};
      assert.equal(counters.calls,4);if(baseline)assert.deepEqual(counters,baseline);else baseline=counters;}
    return {executions:50,perExecution:baseline,claim:'constant per-execution trace accounting; no heap retention proof'};
  });
  for(const variant of ['result','input','version','seed','canonical','hash','trace']) await check(`replay rejects ${variant} tamper`,'replay-integrity',()=>{
    const r=createRegistry([atom],{source:'hand-fixture',version:'1'}), receipt=r.execute(atom.id,{x:2},{seed:3}),changed=clone(receipt);
    if(variant==='result')changed.result.value=9;
    if(variant==='input')changed.input.x=9;
    if(variant==='version')changed.identity.version='tampered';
    if(variant==='seed')changed.replay.seed=999;
    if(variant==='canonical')changed.replay.resultCanonical='{"value":9}';
    if(variant==='hash')changed.replay.resultHash='wrong';
    if(variant==='trace')changed.trace.id='wrong';
    let rejected=false;
    try { const replay=r.replay(changed); rejected=replay.matches===false; } catch { rejected=true; }
    assert.ok(rejected,`tampered ${variant} was accepted`);
  });
  const graph=registry.graph();
  report.coverage={capabilities:capabilities.length,atoms:graph.nodes.filter(n=>n.order===0).length,
    maximumOrder:Math.max(...graph.nodes.map(n=>n.order)),orders:Object.fromEntries([...new Set(graph.nodes.map(n=>n.order))].sort().map(order=>[order,graph.nodes.filter(n=>n.order===order).map(n=>n.id)])),
    crossDomain:capabilities.filter(c=>new Set([c.id,...c.dependsOn].map(id=>id.split('.')[0])).size>1).map(c=>({id:c.id,dependsOn:c.dependsOn})),
    ids:capabilities.map(c=>c.id),graph};
}
if(registry)await check('source files stable throughout independent gate','source-provenance',async()=>{
  assert.equal(canonical(await sourceSnapshot()),canonical(report.sourceFiles));return {sourceFiles:report.sourceFiles.length,unchanged:true};
});
report.summary={pass:report.checks.filter(c=>c.status==='pass').length,fail:report.checks.filter(c=>c.status==='fail').length,
  blocked:Boolean(report.blocked),families:[...new Set(report.checks.map(c=>c.family))]};
await mkdir(evidence,{recursive:true});
const stamp=report.generatedAt.replace(/[:.]/g,'-');
await writeFile(join(evidence,`gate-${stamp}.json`),JSON.stringify(report,null,2)+'\n');
await writeFile(join(evidence,'gate-latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,blocked:report.blocked,coverage:{capabilities:report.coverage.capabilities,
  atoms:report.coverage.atoms,maximumOrder:report.coverage.maximumOrder,crossDomain:report.coverage.crossDomain},
  failures:report.checks.filter(c=>c.status==='fail'),receipt:join(evidence,'gate-latest.json')},null,2));
process.exitCode=report.summary.fail||report.summary.blocked ? 1 : 0;
