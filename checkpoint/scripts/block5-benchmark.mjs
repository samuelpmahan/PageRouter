import os from 'node:os';
import {createGridWorld,DEFAULT_GRID_RECIPE,runGridRecipe,createPixelCache,canonicalJson,hashState,selectComposedCalculation,PROVIDER_IDENTITY,PROVIDER_SETUP} from '../exp/block5/core/index.mjs';
import {buildEventGraph,discoverCalculations,compressStream} from '../exp/compression/index.mjs';

const samples=Math.max(3,Math.min(100,Number(process.env.BLOCK5_SAMPLES??12)));
const warmups=Math.max(1,Math.min(30,Number(process.env.BLOCK5_WARMUPS??3)));
const now=()=>performance.now();
const clone=value=>structuredClone(value);
const stateObjects=[
  {id:'baba',x:1,y:6,kind:'baba'},{id:'rock',x:7,y:4,kind:'rock'},{id:'flag',x:10,y:6,kind:'flag'},
  ...[['baba-word',1,1,'BABA'],['baba-is',2,1,'IS'],['baba-you',3,1,'YOU'],['rock-word',1,3,'ROCK'],['rock-is',2,3,'IS'],['rock-push',3,3,'PUSH'],['flag-word',1,5,'FLAG'],['flag-is',2,5,'IS'],['flag-win',3,5,'WIN']].map(([id,x,y,word])=>({id,x,y,kind:'text',word})),
];
const initialState=createGridWorld({width:12,height:8,objects:stateObjects});
const recipe=clone(DEFAULT_GRID_RECIPE);
while(recipe.rules.length<8){const source=recipe.rules[(recipe.rules.length)%Math.max(1,DEFAULT_GRID_RECIPE.rules.length)];recipe.rules.push({...clone(source),id:`bench-${recipe.rules.length}`,parameters:{...source.parameters}});}
recipe.rules.length=8;
const cacheFactory=createPixelCache;
const same=(left,right)=>canonicalJson({state:left.state,events:left.stream.events})===canonicalJson({state:right.state,events:right.stream.events});
const run=(mode,world,stack,cache,previousRun,program)=>runGridRecipe({initialState:clone(world),recipe:clone(stack),mode,cache,previousRun,program});
const measure=async task=>{const started=now();const result=await task();return {result,ms:now()-started};};
const trainingMeasure=await measure(()=>run('uncached',initialState,recipe,null,null,null));
const training=trainingMeasure.result;
const discoveryStarted=now();
const graph=buildEventGraph(training.stream);
const programs=discoverCalculations(training.stream);
const discoveryMs=now()-discoveryStarted;
const program=selectComposedCalculation(programs,recipe);
const compressionStarted=now();const compressed=compressStream(training.stream);const compressionMs=now()-compressionStarted;

async function scenario(name,world,stack,{warmCache=false,changed=false}={}){
  const atomicWarm=createPixelCache(),composedWarm=createPixelCache();
  if(warmCache&&!changed){await run('atomic',initialState,recipe,atomicWarm,training,null);if(program)await run('composed',initialState,recipe,composedWarm,training,program);}
  const durations={baseline:[],atomic:[],composed:[]},cacheHits={atomic:[],composed:[]};let finalStateHash=null,compositionUsage=null,impact=null;
  for(let index=-warmups;index<samples;index++){
    // Changed-input samples each start from a cache trained only on the original input.
    // This proves the first changed replay invalidates the earlier entry instead of warming
    // the changed value during an untimed warm-up.
    const atomicCache=warmCache?(changed?cacheFactory():atomicWarm):cacheFactory(),composedCache=warmCache?(changed?cacheFactory():composedWarm):cacheFactory();
    if(warmCache&&changed){await run('atomic',initialState,recipe,atomicCache,training,null);if(program)await run('composed',initialState,recipe,composedCache,training,program);}
    const actions=[['baseline',()=>run('uncached',world,stack,null,training,null)],['atomic',()=>run('atomic',world,stack,atomicCache,training,null)]];
    if(program)actions.push(['composed',()=>run('composed',world,stack,composedCache,training,program)]);
    if(index%2)actions.reverse();
    const results={};
    for(const [mode,action] of actions){const measured=await measure(action);results[mode]=measured.result;if(index>=0){durations[mode].push(measured.ms);if(mode!=='baseline')cacheHits[mode].push(measured.result.ledger.filter(row=>row.cacheHit).length);}}
    const reference=results.baseline;
    if(index===0){finalStateHash=hashState(reference.state);compositionUsage=results.composed?.compositionUsage??null;if(changed)impact=reference.ledger.map(({calculation,mayAffect,didAffect})=>({calculation,mayAffect,didAffect}));}
    for(const mode of ['atomic','composed'])if(results[mode]&&!same(reference,results[mode]))throw new Error(`${name}: ${mode} failed exact semantic/state equality at sample ${index}.`);
    if(index===0&&changed){const row=results.baseline.ledger[0];if(!row||typeof row.mayAffect!=='boolean'||typeof row.didAffect!=='boolean')throw new Error('Changed-input scenario omitted mayAffect/didAffect evidence.');}
  }
  return {name,samples,warmups,scenario:'same workload and input for every timed mode',changedInput:changed,
    medianMs:Object.fromEntries(Object.entries(durations).filter(([,values])=>values.length).map(([key,values])=>[key,median(values)])),
    meanMs:Object.fromEntries(Object.entries(durations).filter(([,values])=>values.length).map(([key,values])=>[key,values.reduce((sum,value)=>sum+value,0)/values.length])),
    cacheHits:Object.fromEntries(Object.entries(cacheHits).map(([key,values])=>[key,values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null])),compositionUsage,impact,
    finalStateHash};
}
function median(values){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}

// Warm-up is separate from timed samples; discovery and compression never enter run timers.
for(let index=0;index<warmups;index++)await run('uncached',initialState,recipe,null,training,null);
const cold=await scenario('cold-cache',initialState,recipe);
const warm=await scenario('warm-cache',initialState,recipe,{warmCache:true});
const changedRecipe=clone(recipe);changedRecipe.rules[0].parameters.direction=changedRecipe.rules[0].parameters.direction==='R'?'L':'R';
const changed=await scenario('changed-input',initialState,changedRecipe,{warmCache:true,changed:true});
const bytes=os.cpus()[0]?.model??'unknown';
console.log(JSON.stringify({schema:'pagerouter.block5.benchmark.v1',runtime:{node:process.version,platform:process.platform,arch:process.arch,os:os.release(),cpu:bytes,logicalCpus:os.cpus().length},workload:{kind:'editable-grid-rule-puzzle',width:initialState.width,height:initialState.height,objects:initialState.objects.length,orderedCards:recipe.rules.length,events:training.stream.events.length},setup:{providerIdentity:PROVIDER_IDENTITY,providerStartup:PROVIDER_SETUP,trainingMs:trainingMeasure.ms,discoveryMs,compressionMs,graphNodes:graph.nodes.length,graphEdges:graph.edges.length,compressedStats:compressed.stats,discoveredCandidateCount:programs.length,selectionPolicy:'longest applicable contiguous chain, then lexical program ID',executableProgramFound:Boolean(program),programId:program?.id??null,programNodes:program?.nodes?.length??null},results:[cold,warm,changed],equalityGate:'PASS for every timed sample; baseline, atomic, and discovered-composed outputs were checked before recording',notes:['Provider source-load and digest setup is reported separately and not charged to replay timings.','Discovery and compression setup are measured separately from execution.','Cold-cache samples create fresh caches; warm-cache samples prepopulate each cache from the identical training workload.','Changed-input samples reuse baseline-trained caches and alter a real recipe direction parameter.','Timing samples alternate execution order and use the same machine and workload.','Atomic cache performance is reported separately from discovered-composed performance.']},null,2));
