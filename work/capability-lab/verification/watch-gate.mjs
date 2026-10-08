import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const product=resolve(process.argv[2]??join(root,'outputs/capability-lab')),evidence=join(root,'outputs/capability-lab/evidence/independent');
const fixtures=JSON.parse(await readFile(join(here,'watch-fixtures.json'),'utf8'));
const report={schema:'capability-lab.independent.watch-gate.v1',generatedAt:new Date().toISOString(),fixtureProvenance:fixtures.provenance,checks:[],sourceFiles:[]};
const canonical=value=>JSON.stringify(sorted(value));
function sorted(value){return Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const copy=value=>structuredClone(value);
function near(a,b){if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>near(a[i],v));}else if(b&&typeof b==='object'){Object.keys(b).forEach(k=>near(a[k],b[k]));}else{assert.ok(Number.isFinite(a),`nonfinite ${a}`);assert.ok(Math.abs(a-b)<=1e-10+Math.abs(b)*1e-10,`${a} != ${b}`);}}
const rationalEqual=(a,b)=>{assert.ok(a&&Number.isSafeInteger(a.numerator)&&Number.isSafeInteger(a.denominator)&&a.denominator>0,'invalid public rational');assert.equal(BigInt(a.numerator)*BigInt(b.denominator),BigInt(b.numerator)*BigInt(a.denominator));};
function assertJson(value,path='$'){if(typeof value==='number')assert.ok(Number.isFinite(value),`nonfinite at ${path}`);else if(Array.isArray(value))value.forEach((v,i)=>assertJson(v,`${path}[${i}]`));else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>assertJson(v,`${path}.${k}`));else assert.ok(value===null||['boolean','string'].includes(typeof value),`non-JSON ${typeof value} at ${path}`);}
async function check(name,family,action,reproduce){const start=performance.now();try{const observed=await action();report.checks.push({name,family,status:'pass',elapsedMs:performance.now()-start,...(observed?{observed}:{}),...(reproduce?{reproduce}:{})});}catch(error){report.checks.push({name,family,status:'fail',elapsedMs:performance.now()-start,error:error.message,...(reproduce?{reproduce}:{})});}}
async function sources(){const result=[];for(const name of await readdir(join(product,'src/watches'))){if(name.endsWith('.mjs')){const path=join(product,'src/watches',name),bytes=await readFile(path);result.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}return result.sort((a,b)=>a.path.localeCompare(b.path));}
let api,components,mechanisms;
try{api=await import(pathToFileURL(join(product,'src/watches/index.mjs')));components=await import(pathToFileURL(join(product,'src/watches/components.mjs')));mechanisms=await import(pathToFileURL(join(product,'src/watches/mechanisms.mjs')));
  for(const name of ['createWatchRun','applyWatchAction','replayWatchRun','watchStateAt','watchGeometry'])assert.equal(typeof api[name],'function',`missing API ${name}`);
  report.sourceFiles=await sources();
}catch(error){report.blocked={message:error.message};}
if(api&&!report.blocked){
  const stateAt=(config,time,energy)=>{const result=api.watchStateAt(freeze(copy(config)),freeze(copy(time)),energy?freeze(copy(energy)):undefined);assertJson(result);return result;};
  const apply=(state,action)=>{const before=canonical(state),result=api.applyWatchAction(freeze(state),freeze(copy(action)));assert.equal(canonical(state),before,'action mutated prior state');assertJson(result);return result;};
  const sequence=(actions,config={})=>actions.reduce(apply,api.createWatchRun(freeze(copy(config))));
  const replayState=receipt=>receipt.state??receipt;
  const counts=(state,expected)=>{assert.deepEqual(state.counters,expected);Object.values(state.counters).forEach(v=>assert.ok(Number.isSafeInteger(v)&&v>=0));};
  function dividerCounts(state){const stages=state.models.quartz.dividerStages;assert.equal(stages.length,15);stages.forEach((stage,i)=>assert.equal(stage.outputCount,Math.floor(state.counters.quartzCycles/(2**(i+1)))));}
  for(const fixture of fixtures.defaultCounts)await check(fixture.name,'contract-count-boundary',()=>{
    const state=stateAt({},fixture.time);counts(state,fixture.counts);rationalEqual(state.time,fixture.time);dividerCounts(state);
    if(fixture.handAngles)for(const model of Object.keys(fixture.handAngles))near(state.models[model].handAnglesDegrees,fixture.handAngles[model]);
    return {time:state.time,counters:state.counters,...(fixture.handAngles?{handAngles:Object.fromEntries(Object.keys(fixture.handAngles).map(model=>[model,state.models[model].handAnglesDegrees]))}:{})};
  },fixture);
  for(const fixture of fixtures.changedConfiguration)await check(fixture.name,'changed-configuration',()=>{const state=stateAt(fixture.config,fixture.time);counts(state,fixture.counts);return {config:state.config,counters:state.counters};},fixture);
  for(const fixture of fixtures.selectedSteps)await check(`paused selected step ${fixture.event}`,'selected-event-step',()=>{
    let state=apply(api.createWatchRun(),{type:'pause'});state=apply(state,{type:'step',event:fixture.event});counts(state,fixture.counts);rationalEqual(state.time,fixture.time);assert.equal(state.paused,true);return {time:state.time,counters:state.counters};
  },fixture);
  await check('selected steps advance to next boundary from existing phase','selected-event-step',()=>{
    let state=apply(api.createWatchRun(),{type:'step',event:'quartzCycle'});rationalEqual(state.time,{numerator:1,denominator:32768});
    state=apply(state,{type:'step',event:'mechanicalBeat'});rationalEqual(state.time,{numerator:1,denominator:8});counts(state,{mechanicalBeats:1,quartzCycles:4096,motorCommands:0,softwareUpdates:32});
    state=apply(state,{type:'step',event:'motorCommand'});rationalEqual(state.time,{numerator:1,denominator:1});counts(state,{mechanicalBeats:8,quartzCycles:32768,motorCommands:1,softwareUpdates:256});
    state=apply(state,{type:'step',event:'softwareUpdate'});rationalEqual(state.time,{numerator:257,denominator:256});counts(state,{mechanicalBeats:8,quartzCycles:32896,motorCommands:1,softwareUpdates:257});
    return {time:state.time,counters:state.counters};
  });
  for(const fixture of fixtures.powerSegments)await check(fixture.name,'powered-phase-retention',()=>{
    const state=sequence(fixture.actions);counts(state,fixture.counts);rationalEqual(state.time,fixture.time);
    if(fixture.operatingMechanical)rationalEqual(state.operatingTime.mechanical,fixture.operatingMechanical);
    if(fixture.operatingQuartz)rationalEqual(state.operatingTime.quartz,fixture.operatingQuartz);
    const replay=replayState(api.replayWatchRun({},fixture.actions));assert.equal(canonical(replay),canonical(state));return {time:state.time,counters:state.counters,operatingTime:state.operatingTime};
  },fixture);
  await check('paused/hidden autoplay fails without admitting evidence','transport-control',()=>{
    const paused=apply(api.createWatchRun(),{type:'pause'}),before=canonical(paused);assert.throws(()=>apply(paused,{type:'advance',duration:{numerator:1,denominator:1},origin:'autoplay'}));assert.equal(canonical(paused),before);
    let hidden=apply(apply(api.createWatchRun(),{type:'resume'}),{type:'visibility',hidden:true});const old=canonical(hidden);assert.throws(()=>apply(hidden,{type:'advance',duration:{numerator:1,denominator:1},origin:'autoplay'}));assert.equal(canonical(hidden),old);
  });
  await check('selected powered-off event fails without common-time advance','transport-control',()=>{
    for(const [source,event]of [['mainspring','mechanicalBeat'],['battery','quartzCycle'],['battery','motorCommand']]){
      const state=apply(api.createWatchRun(),{type:'energy',source,enabled:false}),old=canonical(state);assert.throws(()=>apply(state,{type:'step',event}));assert.equal(canonical(state),old);
    }
  });
  await check('rate action preserves accrued phase and produces nominal-gearing drift','rate-fault',()=>{
    const first=sequence([{type:'advance',duration:{numerator:1,denominator:16}}]);
    const changed=apply(first,{type:'rate',model:'mechanical',hz:8});assert.deepEqual(changed.counters,first.counters);assert.equal(canonical(changed.models.mechanical.handAnglesDegrees),canonical(first.models.mechanical.handAnglesDegrees));
    const state=apply(changed,{type:'advance',duration:{numerator:1,denominator:32}});rationalEqual(state.time,{numerator:3,denominator:32});assert.equal(state.counters.mechanicalBeats,1);rationalEqual(state.displayTime.mechanical,{numerator:1,denominator:8});near(state.models.mechanical.handAnglesDegrees.second,0.75);rationalEqual(state.models.mechanical.frequencyHz,{numerator:8,denominator:1});
    assert.equal(canonical(state.config),canonical(first.config));return {time:state.time,displayTime:state.displayTime,frequencyHz:state.models.mechanical.frequencyHz};
  });
  await check('zero live mechanical rate stops timing while energy remains distinct','rate-fault',()=>{
    let state=sequence([{type:'advance',duration:{numerator:1,denominator:16}},{type:'rate',model:'mechanical',hz:0},{type:'advance',duration:{numerator:1,denominator:1}}]);
    assert.equal(state.counters.mechanicalBeats,0);assert.equal(state.models.mechanical.energy.available,true);assert.equal(state.models.mechanical.timing.available,false);rationalEqual(state.cycles.mechanicalBeats,{numerator:1,denominator:2});
    state=apply(state,{type:'rate',model:'mechanical',hz:4});state=apply(state,{type:'advance',duration:{numerator:1,denominator:16}});assert.equal(state.counters.mechanicalBeats,1);
  });
  await check('reset retains explicit session boundary and exact replay','reset-replay',()=>{
    const actions=[{type:'advance',duration:{numerator:60,denominator:1}},{type:'rate',model:'software',hz:512},{type:'energy',source:'battery',enabled:false},{type:'reset'},{type:'step',event:'softwareUpdate'}];
    const initial=api.createWatchRun(),state=sequence(actions),receipt=api.replayWatchRun({},actions);assert.equal(canonical(replayState(receipt)),canonical(state));
    counts(state,{mechanicalBeats:0,quartzCycles:128,motorCommands:0,softwareUpdates:1});rationalEqual(state.time,{numerator:1,denominator:256});assert.equal(state.history.session,initial.history.session+1);assert.equal(state.history.actions.length,actions.length);
    return {time:state.time,counters:state.counters,session:state.history.session};
  });
  await check('omitted configuration and reduced rational aliases replay complete state exactly','normalized-replay',()=>{
    const initial=api.createWatchRun();assert.equal(canonical(initial),canonical(api.createWatchRun({})));assert.equal(canonical(initial),canonical(api.createWatchRun({mechanicalHz:{numerator:8,denominator:2}})));
    let state=apply(initial,{type:'advance',duration:{numerator:2,denominator:4}});state=apply(state,{type:'rate',model:'mechanical',hz:8});state=apply(state,{type:'step',event:'mechanicalBeat'});
    const replay=api.replayWatchRun(state.config,state.history.actions);assert.equal(canonical(replayState(replay)),canonical(state));assert.equal(replay.canonicalState,canonical(state));assert.equal(replay.canonicalEvents,canonical(state.history.events));
    return{config:state.config,retainedNormalizedActions:state.history.actions,time:state.time};
  });
  await check('compact accelerated history keeps exact quartz ranges','bounded-retention',()=>{
    const state=sequence([{type:'advance',duration:{numerator:86400,denominator:1}}]);counts(state,fixtures.defaultCounts.find(f=>f.time.numerator===86400).counts);
    assert.ok(state.history.events.length<=16,'one-day advance expanded high-frequency events');assert.equal(state.history.actions.length,1);assert.ok(state.history.bytes<=state.history.limits.maxBytes);
    assert.ok(JSON.stringify(state).length<100000,'one-day state unexpectedly large');return {events:state.history.events.length,actions:state.history.actions.length,recordedBytes:state.history.bytes,stateChars:JSON.stringify(state).length};
  });
  await check('action count quota failure preserves last complete state','bounded-retention',()=>{
    let state=api.createWatchRun({limits:{maxActions:2,maxBytes:10000,maxExpandEvents:5}});state=apply(state,{type:'step',event:'quartzCycle'});state=apply(state,{type:'step',event:'quartzCycle'});const old=canonical(state);
    assert.throws(()=>apply(state,{type:'pause'}),/limit|quota|history|record|action/i);assert.equal(canonical(state),old);assert.equal(state.history.actions.length,2);
  });
  await check('byte quota failure preserves prior input and counters','bounded-retention',()=>{
    const state=api.createWatchRun({limits:{maxActions:20,maxBytes:64,maxExpandEvents:5}}),old=canonical(state);assert.throws(()=>apply(state,{type:'advance',duration:{numerator:1,denominator:1}}),/byte|limit|quota|history/i);assert.equal(canonical(state),old);
  });
  await check('retained quartz range supports exact bounded prefix and tail windows','bounded-microscope',()=>{
    assert.equal(typeof api.expandWatchCounterWindow,'function');const state=stateAt({}, {numerator:86400,denominator:1}),range=state.history.events.find(e=>e.event==='quartzCycle');assert.ok(range);
    const prefix=api.expandWatchCounterWindow(state,range,{offset:0,count:5,limit:5});assert.equal(prefix.events.length,5);assert.equal(prefix.total,2831155200);assert.equal(prefix.events[0].index,1);assert.equal(prefix.events[4].index,5);rationalEqual(prefix.events[4].time,{numerator:5,denominator:32768});
    const tail=api.expandWatchCounterWindow(state,range,{offset:2831155199,count:1,limit:5});assert.equal(tail.events[0].index,2831155200);rationalEqual(tail.events[0].time,{numerator:86400,denominator:1});assert.equal(tail.clippedBefore,true);assert.equal(tail.clippedAfter,false);
    assert.throws(()=>api.expandCounterRange(range,5),/limit|expan/i);assert.throws(()=>api.expandWatchCounterWindow(state,{...range,end:range.end-1},{offset:0,count:1,limit:5}),/retain|range/i);
    return{prefix,tail};
  });
  await check('run-specific microscope cap overrides larger caller limit','bounded-microscope',()=>{
    const state=sequence([{type:'advance',duration:{numerator:1,denominator:1}}],{limits:{maxActions:20,maxBytes:10000,maxExpandEvents:5}}),range=state.history.events.find(e=>e.event==='quartzCycle');
    assert.throws(()=>api.expandWatchCounterWindow(state,range,{offset:0,count:6,limit:6}),/limit|maximum|expan/i);
  });
  await check('forged counters and history cannot become replay state','state-integrity',()=>{
    const state=api.createWatchRun(),counterForgery=copy(state),historyForgery=copy(state);counterForgery.counters.mechanicalBeats=10;historyForgery.history.bytes+=1;
    assert.throws(()=>apply(counterForgery,{type:'pause'}),/state|counter|history/i);assert.throws(()=>apply(historyForgery,{type:'pause'}),/state|history|byte/i);
  });
  await check('counter beyond safe JSON integer refuses clearly','numeric-bounds',()=>assert.throws(()=>stateAt({}, {numerator:Number.MAX_SAFE_INTEGER,denominator:1}),/safe|range|integer|counter|overflow/i));
  await check('negative duration and invalid rate refused','numeric-bounds',()=>{
    assert.throws(()=>apply(api.createWatchRun(),{type:'advance',duration:{numerator:-1,denominator:1}}));assert.throws(()=>api.createWatchRun({quartzHz:NaN}));assert.throws(()=>api.createWatchRun({mechanicalHz:0}));assert.throws(()=>stateAt({}, {numerator:1,denominator:0}));
  });
  for(const fixture of fixtures.gearPairs)await check('external gear magnitude and opposite sign','gear-teaching-arithmetic',()=>{
    assert.equal(typeof mechanisms.externalGearPair,'function');const result=mechanisms.externalGearPair(freeze(copy(fixture.input)));rationalEqual(result.drivenTurns,fixture.expectedDrivenTurns);assert.equal(result.direction,'opposite');return result;
  },fixture);
  await check('all three real schematic models and required parts exist','geometry-model-coverage',()=>{
    const state=stateAt({}, {numerator:3,denominator:16}),geometry=api.watchGeometry(freeze(state),0,null);assert.deepEqual(geometry.watches.map(w=>w.id).sort(),['mechanical','quartz','software']);
    for(const watch of geometry.watches){const ids=new Set(watch.parts.map(p=>p.id));assert.equal(ids.size,watch.parts.length);fixtures.requiredPartIds[watch.id].forEach(id=>assert.ok(ids.has(id),`missing schematic ${id}`));watch.parts.forEach(p=>assert.ok((p.points.length>0||Number.isFinite(p.radius)&&p.radius>0)&&p.transform.length===3));}
    return {models:geometry.watches.map(w=>({id:w.id,parts:w.parts.length}))};
  });
  await check('mechanical phase and actual beat drive internal poses','state-driven-geometry',()=>{
    const initial=api.watchGeometry(stateAt({}, {numerator:0,denominator:1}),0,null),quarter=api.watchGeometry(stateAt({}, {numerator:1,denominator:16}),0,null),beat=api.watchGeometry(stateAt({}, {numerator:1,denominator:8}),0,null);
    const part=(geometry,id)=>geometry.watches.flatMap(w=>w.parts).find(p=>p.id===id),pose=p=>canonical({points:p.points,rotation:p.rotation,transform:p.transform});
    for(const id of ['mechanical.balanceWheel','mechanical.hairspring'])assert.notEqual(pose(part(initial,id)),pose(part(quarter,id)),`${id} quarter-phase pose unchanged`);
    for(const id of ['mechanical.escapeWheel','mechanical.goingTrain'])assert.notEqual(pose(part(initial,id)),pose(part(beat,id)),`${id} beat-driven pose unchanged`);
    return {poses:['balance/hairspring: t=0 vs 1/16','escape/train: t=0 vs 1/8'],geometry:'illustrative kinematics only'};
  });
  await check('quartz motor command drives rotor and display gearing poses','state-driven-geometry',()=>{
    const initial=api.watchGeometry(stateAt({}, {numerator:0,denominator:1}),0,null),stepped=api.watchGeometry(stateAt({}, {numerator:1,denominator:1}),0,null);
    const part=(g,id)=>g.watches.flatMap(w=>w.parts).find(p=>p.id===id),pose=p=>canonical({points:p.points,rotation:p.rotation,transform:p.transform});
    for(const id of ['quartz.rotor','quartz.gears'])assert.notEqual(pose(part(initial,id)),pose(part(stepped,id)),`${id} motor-step pose unchanged`);
  });
  function matrixInverse3(a){const [[x,y,z],[u,v,w],[p,q,r]]=a,d=x*(v*r-w*q)-y*(u*r-w*p)+z*(u*q-v*p);assert.ok(Math.abs(d)>1e-20);return [[v*r-w*q,z*q-y*r,y*w-z*v],[w*p-u*r,x*r-z*p,z*u-x*w],[u*q-v*p,y*p-x*q,x*v-y*u]].map(row=>row.map(n=>n/d));}
  const matrixMultiply=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((s,v,k)=>s+v*b[k][j],0)));
  const pointApply=(a,p)=>{const v=Array.isArray(p)?p:[p.x,p.y],w=a[2][0]*v[0]+a[2][1]*v[1]+a[2][2];return [(a[0][0]*v[0]+a[0][1]*v[1]+a[0][2])/w,(a[1][0]*v[0]+a[1][1]*v[1]+a[1][2])/w];};
  const pointArray=p=>Array.isArray(p)?p:[p.x,p.y];
  await check('explosion/selection preserves complete state and transforms every leader','explosion-invariant',()=>{
    const state=stateAt({}, {numerator:3,denominator:16}),before=canonical(state),a=api.watchGeometry(freeze(state),0,'mechanical.palletFork'),b=api.watchGeometry(state,1,'mechanical.palletFork'),assembledAgain=api.watchGeometry(state,0,'mechanical.palletFork');
    assert.equal(canonical(state),before);assert.equal(canonical(a),canonical(assembledAgain));assert.ok(b.illustrative);
    a.watches.forEach((watch,i)=>watch.parts.forEach((part,j)=>{const exploded=b.watches[i].parts[j];assert.equal(exploded.id,part.id);const relative=matrixMultiply(exploded.transform,matrixInverse3(part.transform));
      part.points.forEach((p,k)=>near(pointApply(relative,p),pointArray(exploded.points[k])));near(pointApply(relative,part.center),pointArray(exploded.center));near(pointApply(relative,part.label.anchor),pointArray(exploded.label.anchor));
      part.label.leader.forEach((p,k)=>near(pointApply(relative,p),pointArray(exploded.label.leader[k])));
      for(let line=0;line<(part.strokes??[]).length;line++)part.strokes[line].forEach((p,k)=>near(pointApply(relative,p),pointArray(exploded.strokes[line][k])));
    }));return {stateUnchanged:true,parts:a.watches.reduce((s,w)=>s+w.parts.length,0)};
  });
  await check('visible part labels resolve source, claim status, unit and state path','component-label-binding',()=>{
    assert.equal(typeof components.describeWatchComponent,'function');assert.equal(typeof components.componentDefinitions,'function');
    const state=stateAt({}, {numerator:1,denominator:1});const geometry=api.watchGeometry(state,0,null),labels=[];
    for(const watch of geometry.watches)for(const part of watch.parts){const label=components.describeWatchComponent(state,part.id);assert.equal(label.id,part.id);assert.ok(label.roleStatus&&label.valueStatus&&label.sourceId&&label.formula&&label.unit,`incomplete label ${part.id}`);
      if(label.statePath){const bound=label.statePath.split('.').reduce((v,k)=>v?.[k],state);assert.notEqual(bound,undefined,`missing state path ${label.statePath}`);assert.equal(canonical(label.value),canonical(bound),`stale value ${part.id}`);}
      labels.push({id:part.id,statePath:label.statePath,roleStatus:label.roleStatus,valueStatus:label.valueStatus,sourceId:label.sourceId,value:label.value,unit:label.unit});}
    return {labels};
  });
  await check('component source roles and path branches match independent primary references','source-role-grounding',()=>{
    const defs=new Map(components.componentDefinitions().map(d=>[d.id,d])),sourceMap=new Map(components.componentSources().map(s=>[s.id,s]));
    for(const [id,role]of [['mechanical.mainspring','energy'],['mechanical.balanceWheel','timing'],['mechanical.hairspring','timing'],['quartz.battery','energy'],['quartz.crystal','timing']])assert.equal(defs.get(id).role,role);
    assert.equal(sourceMap.get('grand-seiko-mechanical').url,'https://www.grand-seiko.com/uk-en/collections/movement/mechanical');assert.equal(sourceMap.get('seiko-quartz-education').url,'https://www.seiko.co.jp/csr/toki-iku/tokiq-nazotoki/');
    assert.ok(/9F|twin.?pulse/i.test(sourceMap.get('grand-seiko-quartz').limits),'generic quartz exception missing');
    const state=stateAt({}, {numerator:1,denominator:1}),geometry=api.watchGeometry(state,0,null),mechanical=geometry.watches.find(w=>w.id==='mechanical'),quartz=geometry.watches.find(w=>w.id==='quartz');
    assert.ok(mechanical.energyPath.some(edge=>edge.from==='mechanical.mainspring'));assert.ok(quartz.energyPath.some(edge=>edge.from==='quartz.battery'&&edge.to==='quartz.oscillator'));assert.ok(quartz.energyPath.some(edge=>edge.from==='quartz.battery'&&edge.to==='quartz.motorDriver'));assert.ok(!quartz.energyPath.some(edge=>edge.from==='quartz.crystal'));
    assert.ok(quartz.timingPath.some(edge=>edge.from==='quartz.crystal'));assert.equal(state.models.mechanical.escapement.modelKind,'illustrative-schematic');
    return{primarySourceMap:'watch-sources.md',claimLayers:'source-backed roles, simulated state, derived gears, illustrative contact/geometry'};
  });
  await check('source files stable throughout watch gate','source-provenance',async()=>assert.equal(canonical(await sources()),canonical(report.sourceFiles)));
}
report.summary={pass:report.checks.filter(c=>c.status==='pass').length,fail:report.checks.filter(c=>c.status==='fail').length,blocked:Boolean(report.blocked),families:[...new Set(report.checks.map(c=>c.family))]};
await mkdir(evidence,{recursive:true});const stamp=report.generatedAt.replace(/[:.]/g,'-');await writeFile(join(evidence,`watch-gate-${stamp}.json`),JSON.stringify(report,null,2)+'\n');await writeFile(join(evidence,'watch-gate-latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,blocked:report.blocked,failures:report.checks.filter(c=>c.status==='fail'),receipt:join(evidence,'watch-gate-latest.json')},null,2));process.exitCode=report.summary.fail||report.summary.blocked?1:0;
