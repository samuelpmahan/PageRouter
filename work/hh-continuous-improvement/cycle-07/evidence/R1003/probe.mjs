import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const repo = resolve('/workspace/scratch/8528bb251845/PageRouter');
const out = resolve('/workspace/scratch/8528bb251845/hh-cycle07/H2/R1003');
const files = ['checkpoint/vendor/hh/src/public-controller.mjs','checkpoint/vendor/hh/src/public-controller.test.mjs',
  'checkpoint/vendor/hh/src/public-site.mjs','checkpoint/vendor/hh/services/fixture-provider.mjs','checkpoint/vendor/hh/services/runtime.mjs'];
const sha = async file => createHash('sha256').update(await readFile(resolve(repo,file))).digest('hex');
const shaAbsolute = async file => createHash('sha256').update(await readFile(file)).digest('hex');

function treeDetails(node, elements = [], text = []) {
  if (typeof node === 'string' || typeof node === 'number') text.push(String(node));
  else if (Array.isArray(node)) for (const child of node) treeDetails(child,elements,text);
  else if (node && typeof node === 'object') { elements.push({tag:node.tag,attrs:node.attrs||{}}); for (const child of node.children||[]) treeDetails(child,elements,text); }
  return {elements,text:text.join(' ')};
}
function snap(c) {
  const t=treeDetails(renderPublicSite({route:c.route,state:c.state})), p=c.state.journey.profile, w=c.state.journey.wishlist;
  return {route:{path:c.route.path,page:c.route.page,profileId:c.route.profileId||null},session:{status:c.state.journey.session.status,teacherId:c.state.journey.session.teacherId||null,communityRole:c.state.journey.communityRole},
    profile:{status:p.status,id:p.value?.id||null,teacherId:p.value?.teacherId||null,name:p.value?.name||null,source:p.source||null,readOnly:p.readOnly===true||p.value?.readOnly===true},
    handoff:{intent:w.intent===true,profileId:w.profileId||null,destination:w.destination||null,choiceRequired:w.choiceRequired===true,confirmed:w.confirmed===true,opened:w.opened===true},
    rendered:{confirmButtons:t.elements.filter(e=>e.attrs?.['data-event']==='public:confirm-wishlist').map(e=>e.attrs.id||null),anchors:t.elements.filter(e=>['hh-profile-wishlist-open','hh-reference-wishlist'].includes(e.attrs?.id)).map(e=>({id:e.attrs.id,href:e.attrs.href||null})),
      loading:t.text.includes('Loading profile…'),unavailable:t.text.includes('Profile unavailable'),jordan:t.text.includes('Demo Jordan'),avery:t.text.includes('Demo Avery'),sarah:t.text.includes('Sarah Endsley')}};
}
function env() {
  const base=createFixtureProvider({fixture:true}); assert.equal(base.capabilities.persistence,'volatile-memory');
  let announce, release; const started=new Promise(r=>announce=r), gate=new Promise(r=>release=r); const calls=[]; const control={holdRead:false,failRead:false};
  const services=Object.fromEntries(Object.entries(base.services).map(([port,invoke])=>[port,async input=>{
    if(port==='TeacherProfile.openPublicProfile') {calls.push(input.profileId); if(control.holdRead){announce(); await gate;} if(control.failRead)return {ok:false,message:'Synthetic read failure.',error:{code:'transport_failure',retryable:false}};}
    return invoke(input);
  }]));
  const runtime=createServiceRuntime({...base,services});
  return {runtime,controller:createPublicController({runtime}),calls,started,release,control};
}
async function start({login=true}={}) {const e=env(); const c=e.controller; await c.initialize('#/'); assert.equal(e.runtime.mode,'fixture');assert.equal(e.runtime.capabilities.productionAuthority,false);assert.equal(e.runtime.capabilities.persistence,'volatile-memory');
  if(login){assert.equal((await c.dispatch('public:login',{email:'avery@fixture.test',password:'synthetic-only'})).ok,true);}
  await c.navigate('#/public-profile/demo-avery');assert.equal(c.state.journey.profile.value?.id,'demo-avery');return e;}
async function prep(c,payload={}) {return c.dispatch('public:wishlist',payload);}
function cont(c) {return snap(c).rendered.anchors.find(a=>a.id==='hh-profile-wishlist-open')?.href||null;}

async function foreignPrepared() {
  const e=await start(),c=e.controller; const prepared=await prep(c,{profileId:'demo-jordan',teacherId:'demo-seed-jordan'});
  assert.equal(prepared.handoff.profileId,'demo-avery'); assert.equal(prepared.handoff.destination,'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  const before=await c.navigate('#/public-profile/demo-jordan'); const s=snap(c);const confirm=await c.dispatch('public:confirm-wishlist',{profileId:'demo-jordan',teacherId:'demo-seed-jordan'});
  assert.equal(s.profile.teacherId,'demo-seed-jordan');assert.equal(s.handoff.intent,false);assert.equal(s.rendered.confirmButtons.length,0);
  assert.equal(confirm.ok,false);assert.equal(confirm.error.code,'no_wishlist_handoff');assert.equal(cont(c),null);
  return {case:'prepared_avery_then_foreign_jordan',prepared:prepared.handoff,navigation:before,snapshot:s,confirm:{ok:confirm.ok,error:confirm.error},continuation:cont(c)};
}
async function foreignConfirmed() {
  const e=await start(),c=e.controller;await prep(c);const confirmed=await c.dispatch('public:confirm-wishlist');assert.equal(confirmed.ok,true);
  await c.navigate('#/public-profile/demo-jordan');const s=snap(c);const confirm=await c.dispatch('public:confirm-wishlist');
  assert.equal(s.profile.teacherId,'demo-seed-jordan');assert.equal(s.handoff.intent,false);assert.equal(cont(c),null);assert.equal(confirm.ok,false);
  return {case:'already_confirmed_avery_then_foreign_jordan',snapshot:s,confirm:{ok:confirm.ok,error:confirm.error},continuation:cont(c)};
}
async function freshJordan() {
  const e=await start(),c=e.controller;await c.navigate('#/public-profile/demo-jordan');const prepResult=await prep(c,{profileId:'demo-avery',teacherId:'demo-seed-avery',destination:'https://attacker.invalid/'});
  assert.equal(prepResult.ok,true);assert.equal(prepResult.handoff.profileId,'demo-jordan');assert.equal(prepResult.handoff.destination,'https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN');
  const confirmed=await c.dispatch('public:confirm-wishlist',{profileId:'demo-avery',teacherId:'demo-seed-avery'});assert.equal(confirmed.ok,true);assert.equal(cont(c),'https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN');
  return {case:'fresh_jordan_and_forged_payload_ids',prepared:prepResult.handoff,confirmed:{ok:confirmed.ok,destination:confirmed.handoff.destination},snapshot:snap(c),serviceCalls:e.calls};
}
async function aliases() {
  const e=await start(),c=e.controller;await prep(c);await c.navigate('#/teachers/demo-avery');const s=snap(c);assert.equal(s.handoff.intent,true);assert.equal(s.handoff.profileId,'demo-avery');
  const confirm=await c.dispatch('public:confirm-wishlist');assert.equal(confirm.ok,true);assert.equal(cont(c),'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  return {case:'same_identity_alias',snapshot:snap(c),confirmed:confirm.ok,continuation:cont(c)};
}
async function sameIdPendingFailure() {
  const e=await start(),c=e.controller;await prep(c);e.control.holdRead=true;const pending=c.navigate('#/public-profile/demo-avery');await e.started;
  const loading=snap(c),blocked=await c.dispatch('public:confirm-wishlist');assert.equal(loading.profile.status,'loading');assert.equal(loading.handoff.intent,true);assert.equal(blocked.ok,false);assert.equal(blocked.error.code,'wishlist_profile_changed');e.release();await pending;
  const good=snap(c);assert.equal((await c.dispatch('public:confirm-wishlist')).ok,true);
  const e2=await start(),c2=e2.controller;await prep(c2);e2.control.failRead=true;await c2.navigate('#/public-profile/demo-avery');const failed=snap(c2),failedConfirm=await c2.dispatch('public:confirm-wishlist');
  assert.equal(failed.profile.status,'error');assert.equal(failedConfirm.ok,false);assert.equal(failedConfirm.error.code,'wishlist_profile_changed');assert.equal(cont(c2),null);
  return {case:'same_id_pending_then_recovered_and_failed',loading,blocked:{ok:blocked.ok,error:blocked.error},loaded:good,failed,failedConfirm:{ok:failedConfirm.ok,error:failedConfirm.error},failureContinuation:cont(c2)};
}
async function missingProfile() {const e=await start(),c=e.controller;await prep(c);await c.navigate('#/public-profile/no-such-profile');const s=snap(c),confirm=await c.dispatch('public:confirm-wishlist');assert.equal(s.profile.status,'error');assert.equal(s.handoff.intent,false);assert.equal(confirm.ok,false);assert.equal(cont(c),null);return {case:'not_found',snapshot:s,confirm:{ok:confirm.ok,error:confirm.error},continuation:cont(c)};}
async function anonymousSupporter() {const e=await start({login:false}),c=e.controller;await c.navigate('#/public-profile/demo-jordan');assert.equal(c.state.journey.session.status,'anonymous');const prepared=await prep(c),confirmed=await c.dispatch('public:confirm-wishlist');assert.equal(prepared.handoff.profileId,'demo-jordan');assert.equal(confirmed.ok,true);assert.equal(cont(c),'https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN');return {case:'anonymous_public_supporter',snapshot:snap(c),confirmed:{ok:confirmed.ok,destination:confirmed.handoff.destination}};}
async function capturedAndDirect() {const e=await start(),c=e.controller;await prep(c);await c.navigate('#/public-profile/reference-sarah');const s=snap(c),wishlist=await c.dispatch('public:wishlist',{profileId:'demo-avery'}),confirm=await c.dispatch('public:confirm-wishlist',{profileId:'demo-avery'});assert.equal(s.profile.source,'captured-readonly');assert.equal(s.rendered.anchors.find(a=>a.id==='hh-reference-wishlist')?.href,'https://www.amazon.com/hz/wishlist/ls/3F27WJHJEBAXN?ref_=wl_share&tag=h0mer00mher0-20');assert.equal(wishlist.ok,false);assert.equal(wishlist.error.code,'read_only_reference');assert.equal(confirm.ok,false);assert.equal(cont(c),null);return {case:'captured_sarah_priority_and_direct_handlers',snapshot:s,wishlist:{ok:wishlist.ok,error:wishlist.error},confirm:{ok:confirm.ok,error:confirm.error}};}
async function genericCompatibility() {const e=env(),c=e.controller;await c.initialize('#/');const p=await prep(c,{profileId:'demo-avery',destination:'https://attacker.invalid/'});const conf=await c.dispatch('public:confirm-wishlist',{profileId:'demo-avery',destination:'https://attacker.invalid/'});assert.equal(c.route.page,'home');assert.equal(p.handoff.profileId,null);assert.equal(p.handoff.destination,'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW');assert.equal(conf.ok,true);assert.equal(cont(c),null);return {case:'generic_home_compatibility_payload_ids_ignored',prepared:p.handoff,confirmed:{ok:conf.ok,destination:conf.handoff.destination},snapshot:snap(c)};}

async function main(){
  const cases=[await foreignPrepared(),await foreignConfirmed(),await freshJordan(),await aliases(),await sameIdPendingFailure(),await missingProfile(),await anonymousSupporter(),await capturedAndDirect(),await genericCompatibility()];
  const hashes={};for(const f of files)hashes[f]=await sha(f);
  const expected={foreignPreparedRejected:cases[0].confirm.error.code==='no_wishlist_handoff',foreignPreparedHidden:cases[0].continuation===null,
    confirmedAveryHiddenOnJordan:cases[1].continuation===null&&cases[1].confirm.ok===false,freshJordanCorrect:cases[2].confirmed.destination==='https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN',
    sameAliasRetained:cases[3].confirmed&&cases[3].continuation==='https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY',pendingBlocked:cases[4].blocked.error.code==='wishlist_profile_changed',
    failedReloadBlocked:cases[4].failedConfirm.error.code==='wishlist_profile_changed',missingBlocked:cases[5].confirm.ok===false&&cases[5].continuation===null,
    anonymousSupporterWorks:cases[6].confirmed.ok&&cases[6].snapshot.session.status==='anonymous',capturedReadonlyWins:cases[7].snapshot.rendered.anchors.some(a=>a.id==='hh-reference-wishlist')&&cases[7].confirm.ok===false,
    genericCompatibilityRetained:cases[8].confirmed.ok&&cases[8].prepared.profileId===null,genericPayloadCannotSetDestination:cases[8].confirmed.destination==='https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW',
    forgedProfilePayloadCannotSetIdentity:cases[2].prepared.profileId==='demo-jordan'&&cases[2].prepared.destination==='https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN'};
  const all=Object.values(expected).every(Boolean);
  const evidenceLogs={};for(const name of ['stdout.log','rerun.stdout.log','focused-test.stdout.log','controller-test.stdout.log']){const path=resolve(out,name);try{evidenceLogs[name]=await shaAbsolute(path);}catch{}}
  return {schema:'hh-cycle07-H2-R1003/wishlist-identity-review/v1',job_id:'R1003',worker:'H2',decision:all?'accepted':'amend',summary:all?'Independent adversarial fixture/runtime/renderPublicSite probes found the correction rejects stale prepared and already-confirmed Avery handoffs on Jordan, binds fresh Jordan continuation to Jordan, and preserves expected alias, anonymous, captured-reference, pending/failure, not-found, and generic-home compatibility behavior.':'At least one independent adversarial assertion did not match the intended behavior.',repository:{head:'7feded8819db87026a8f35f6aa515bda513ab541',tree:'1cdcf9bfb34b680ed198eb7e750486ecfd1887cc'},sourceHashes:hashes,commands:['node /workspace/scratch/8528bb251845/hh-cycle07/H2/R1003/probe.mjs','node --test --test-name-pattern=\'wishlist handoff|failed profile navigation clears|confirmed wishlist destination|same-profile wishlist handoff\' checkpoint/vendor/hh/src/public-controller.test.mjs','node --test checkpoint/vendor/hh/src/public-controller.test.mjs'],evidenceLogs,cases,assertions:expected,allAssertionsPassed:all,limits:{syntheticFixtureOnly:true,backendOrProduction:false,network:false,externalOpenSharePayment:false,realTeacherData:false,browserVisualQA:false,sourceOrGitMutation:false,rendering:'renderPublicSite returned tree inspection only'},next:all?'The source correction passed this independent bounded review; this does not claim browser QA, canonical build, deployment, or human acceptance.':'Investigate the failed assertion before accepting the correction.'};
}
try{const result=await main();await writeFile(resolve(out,'result.json'),`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));}catch(error){const result={schema:'hh-cycle07-H2-R1003/wishlist-identity-review/v1',job_id:'R1003',worker:'H2',decision:'rejected',error:{name:error?.name||'Error',message:String(error?.message||error),stack:String(error?.stack||'')}};await writeFile(resolve(out,'result.json'),`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exitCode=1;}
