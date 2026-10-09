import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureProvider,createServiceRuntime} from '../../vendor/hh/services/index.mjs';
import {createPublicController,normalizePublicRoute} from '../../vendor/hh/src/public-controller.mjs';
import {createCommunity} from '../../vendor/hh/src/community.mjs';

// Fixture school rows are declared local teaching data, not production results.
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}}
function setup(wrap=x=>x){const local=storage();const runtime=createServiceRuntime(createFixtureProvider({fixture:true,storage:local}));const controller=createPublicController({runtime:wrap(runtime),storage:local,community:createCommunity({storage:local})});return {controller,runtime,local}}
async function choose(c){await c.selectSchool('state','Demo Washington');await c.selectSchool('county','Demo King');await c.selectSchool('district','Demo District');await c.selectSchool('school','Demo Academy')}
const identity={name:'Jordan Rivera',email:'jordan.rivera@example.test',phone:'555-0108'};
const password='Independent-Ephemeral-Password-83';
function request(extra={}){return {...identity,password,confirmPassword:password,...extra}}
function noPassword(c,runtime,local){assert.equal(JSON.stringify(c.state).includes(password),false);assert.equal(JSON.stringify(runtime.inspect()).includes(password),false);assert.equal(JSON.stringify(runtime.pxc.entries().map(([,part])=>part.value)).includes(password),false);assert.equal([...local.values.values()].join('\n').includes(password),false)}

test('published public routes normalize while unknown and hostile destinations remain local',()=>{
 for(const [url,page] of [['#/','home'],['#/about','about'],['#/contact','contact'],['#/partners','partners'],['#/login','login'],['#/forgot-password','forgot'],['#/register','register'],['#/find-teachers','directory'],['#/teachers','directory'],['#/profile','profile'],['#/forum','community']])assert.equal(normalizePublicRoute(url).page,page,url);
 assert.equal(normalizePublicRoute('#/teachers/demo-jordan').profileId,'demo-jordan');
 assert.equal(normalizePublicRoute('#/posts/topic-local-1').communityRoute.threadId,'topic-local-1');
 for(const bad of ['javascript:alert(1)','https://outside.invalid/','#/does-not-exist'])assert.equal(normalizePublicRoute(bad).page,'not-found',bad);
 assert.doesNotThrow(()=>normalizePublicRoute('#/teachers/%E0%A4%A'));
});
test('observed reference page aliases preserve their actual route and query identity',()=>{
 for(const [file,page] of [['homepage.html','home'],['index.html','directory'],['register.html','register'],['login.html','login'],['forgot.html','forgot'],['about.html','about'],['contact.html','contact'],['partners.html','partners'],['forum.html','community']])assert.equal(normalizePublicRoute(`#/pages/${file}`).page,page,file);
 assert.equal(normalizePublicRoute('#/pages/teacher.html?id=demo-jordan').profileId,'demo-jordan');
 assert.equal(normalizePublicRoute('#/pages/post.html?id=topic-local-1').communityRoute.threadId,'topic-local-1');
});
test('school cascade clears dependent values and choices before selecting a new state',async()=>{
 const {controller:c}=setup();await c.initialize('#/directory');await choose(c);
 await c.selectSchool('state','Demo California');
 assert.deepEqual([c.state.journey.school.county,c.state.journey.school.district,c.state.journey.school.school],['','','']);
 assert.deepEqual(c.state.journey.lookups.counties,['Demo Alameda']);assert.deepEqual(c.state.journey.lookups.districts,[]);assert.deepEqual(c.state.journey.lookups.schools,[]);
 await c.selectSchool('county','Demo Alameda');await c.selectSchool('district','Demo Bay District');await c.selectSchool('school','Demo Bay School');
 const result=await c.dispatch('public:directory-search',{query:'Jordan'});assert.equal(result.ok,true);
 assert.deepEqual(c.state.journey.matches.items.map(p=>p.id),['demo-jordan']);
 await c.dispatch('public:directory-search',{query:'A certainly nonexistent classroom'});assert.deepEqual(c.state.journey.matches.items,[]);
});
test('late county responses cannot overwrite the latest selected state',async()=>{
 const pending=[];const {controller:c}=setup(runtime=>({...runtime,invoke:async(port,input,...rest)=>{
  if(port==='SchoolData.getCounties')await new Promise(resolve=>pending.push({state:input.state,resolve}));
  return runtime.invoke(port,input,...rest);
 }}));
 await c.initialize('#/register');const first=c.selectSchool('state','Demo Washington');const second=c.selectSchool('state','Demo California');
 assert.equal(c.state.journey.school.state,'Demo California');assert.equal(pending.length,2);
 pending[1].resolve();await second;pending[0].resolve();await first;
 assert.equal(c.state.journey.school.state,'Demo California');assert.deepEqual(c.state.journey.lookups.counties,['Demo Alameda']);
});
test('clearing the upstream selection removes every dependent selected value and option list',async()=>{
 const {controller:c}=setup();await c.initialize('#/register');await choose(c);await c.selectSchool('state','');
 assert.deepEqual([c.state.journey.school.county,c.state.journey.school.district,c.state.journey.school.school],['','','']);
 assert.deepEqual(c.state.journey.lookups.counties,[]);assert.deepEqual(c.state.journey.lookups.districts,[]);assert.deepEqual(c.state.journey.lookups.schools,[]);
});
test('lookup loading/failure/retry is observable and preserves the chosen upstream state',async()=>{
 const changes=[];let fail=true;const {controller:c}=setup(runtime=>({...runtime,invoke:async(port,input,...rest)=>{
  if(port==='SchoolData.getCounties'&&fail){fail=false;return {ok:false,error:{code:'transport_failure',message:'Independent local read failed',retryable:true},message:'Independent local read failed'}}
  return runtime.invoke(port,input,...rest);
 }}));
 await c.initialize('#/register');const action=c.selectSchool('state','Demo Washington');changes.push(c.state.journey.loading);const result=await action;
 assert.equal(result.ok,false);assert.equal(changes[0],true);assert.equal(c.state.journey.loading,false);assert.match(c.state.journey.lookupError,/Independent local read failed/);assert.equal(c.canRetry,true);
 assert.equal((await c.dispatch('public:retry')).ok,true);assert.deepEqual(c.state.journey.lookups.counties,['Demo King']);assert.equal(c.state.journey.lookupError,'');assert.equal(c.state.journey.school.state,'Demo Washington');
});
test('remembered filters retain the latest submitted empty query outcome and reject cross-row school storage',async()=>{
 const {controller:c,local}=setup();await c.initialize('#/directory');await choose(c);
 await c.dispatch('public:directory-search',{query:'Avery'});await c.dispatch('public:directory-search',{query:'No matching independent classroom'});
 await c.dispatch('public:directory-restore');assert.equal(c.state.journey.filters.query,'No matching independent classroom');assert.deepEqual(c.state.journey.matches.items,[]);
 local.setItem('hh-public-directory-filters.v1',JSON.stringify({version:1,school:{state:'Demo Washington',county:'Demo King',district:'Demo District',school:'Demo Bay School',grade:''},query:'Literal corrupted row',sort:'date-newest'}));
 const restored=createPublicController({runtime:createServiceRuntime(createFixtureProvider({fixture:true,storage:local})),storage:local,community:createCommunity({storage:local})});await restored.initialize('#/directory');
 assert.equal(restored.state.journey.rememberedFilters,null,'Each field exists independently, but school belongs to a different state/county/district row');
 assert.equal(local.getItem('hh-public-directory-filters.v1'),null);
});
test('confirmation, consent and complete school are validated without retaining credentials',async()=>{
 const {controller:c,runtime,local}=setup();await c.initialize('#/register');
 assert.equal((await c.dispatch('public:register',request())).ok,false);await choose(c);
 assert.equal((await c.dispatch('public:register',request())).ok,false);await c.dispatch('public:accept-terms');
 assert.equal((await c.dispatch('public:register',request({confirmPassword:'Different-password'}))).ok,false);
 assert.equal(runtime.snapshot().registration.status,'none');noPassword(c,runtime,local);
 assert.equal((await c.dispatch('public:register',request())).ok,true);assert.equal(runtime.snapshot().registration.status,'pending');
 assert.equal(c.state.journey.registration.identity.name,identity.name);assert.equal(c.state.journey.registration.identity.email,identity.email);
 noPassword(c,runtime,local);
});
test('pending login, separate approval, actual credential boundary, profile edit/public view and reset compose',async()=>{
 const {controller:c,runtime,local}=setup();await c.initialize('#/register');await choose(c);await c.dispatch('public:accept-terms');await c.dispatch('public:register',request());
 assert.equal((await c.dispatch('public:login',{email:identity.email,password})).ok,false);assert.equal(runtime.snapshot().session.status,'anonymous');
 assert.equal((await c.dispatch('public:approve')).ok,true);assert.equal(runtime.snapshot().session.status,'anonymous');
 assert.equal((await c.dispatch('public:login',{email:identity.email,password})).ok,true);assert.equal(runtime.snapshot().session.status,'authenticated');
 assert.equal((await c.dispatch('public:profile-create',{name:identity.name,bio:'Independent classroom introduction.',wishlistUrl:'https://www.amazon.com/hz/wishlist/ls/INDEPENDENT'})).ok,true);
 const own=c.state.journey.profile.value;assert.ok(own.id);const id=own.id;
 assert.equal((await c.dispatch('public:profile-edit',{name:'Jordan Edited',bio:'Changed public introduction.',wishlistUrl:'https://www.amazon.com/hz/wishlist/ls/INDEPENDENT'})).ok,true);
 await c.navigate(`#/teachers/${id}`);assert.equal(c.state.journey.profile.value.name,'Jordan Edited');assert.equal(c.state.journey.profile.value.bio,'Changed public introduction.');
 await c.dispatch('public:wishlist');assert.equal(c.state.journey.wishlist.remote,false);assert.equal(c.state.journey.wishlist.intent,true);
 await c.dispatch('public:share');assert.equal(c.state.journey.share.intent,true);
 noPassword(c,runtime,local);await c.dispatch('public:reset');assert.equal(runtime.snapshot().session.status,'anonymous');assert.equal(runtime.snapshot().registration.status,'none');assert.equal(c.state.journey.terms.accepted,false);
 assert.equal(c.state.journey.registration.identity.name,'');assert.equal(c.state.journey.school.school,'');
});
test('contact and reset are local; text length and email validation do not claim remote effects',async()=>{
 const {controller:c}=setup();await c.initialize('#/contact');
 assert.equal((await c.dispatch('public:contact',{name:'Guest',email:'invalid',subject:'Question',message:'Local note'})).ok,false);
 assert.equal((await c.dispatch('public:contact',{name:'Guest',email:'guest@example.test',subject:'Question',message:'x'.repeat(251)})).ok,false);
 assert.equal((await c.dispatch('public:contact',{name:'Guest',email:'guest@example.test',subject:'Question',message:'A literal local note'})).ok,true);
 assert.equal(c.state.journey.outcome.remote,false);assert.match(c.state.journey.outcome.message,/nothing was sent|not sent/i);
 assert.equal((await c.dispatch('public:forgot',{email:'guest@example.test'})).ok,true);assert.equal(c.state.journey.outcome.remote,false);
});
test('unsafe wishlist replacements cannot survive in retained profile or handoff destinations',async()=>{
 const {controller:c}=setup();await c.initialize('#/login');await c.dispatch('public:login',{email:'avery@fixture.test',password});
 const urls=['javascript:alert(1)','https://www.amazon.com.evil.invalid/hz/wishlist/ls/ABC','https://user:secret@www.amazon.com/hz/wishlist/ls/ABC','https://www.amazon.com/hz/wishlist/ls/ABC?token=unsafe'];
 for(const wishlistUrl of urls){await c.dispatch('public:profile-edit',{name:'Demo Avery',bio:'Safe retained introduction',wishlistUrl});await c.dispatch('public:wishlist');
  assert.notEqual(c.state.journey.profile.value?.wishlistUrl,wishlistUrl);assert.notEqual(c.state.journey.wishlist.destination,wishlistUrl);
 }
});
test('explicit forum preview role never creates an HH account or session',async()=>{
 const {controller:c,runtime}=setup();await c.initialize('#/forum');await c.dispatch('forum-role',{role:'teacher'});
 const created=await c.dispatch('forum-topic',{title:'Independent new post',content:'This is local discussion content.',category:'Questions'});assert.equal(created.ok,true);
 assert.equal(runtime.snapshot().session.status,'anonymous');assert.equal(runtime.snapshot().registration.status,'none');
 assert.equal(c.state.journey.communityRole,'teacher');await c.dispatch('forum-role',{role:'anonymous'});
 assert.equal((await c.dispatch('forum-reply',{threadId:created.value.id,body:'Anonymous blocked reply'})).ok,false);
});
test('captured Teacher-of-Day reference is readonly even when a sample teacher is logged in',async()=>{
 const calls=[];const {controller:c,runtime}=setup(actual=>({...actual,invoke:(port,...args)=>{calls.push(port);return actual.invoke(port,...args)}}));
 await c.initialize('#/login');await c.dispatch('public:login',{email:'avery@fixture.test',password});const before=runtime.snapshot();calls.length=0;
 await c.navigate('#/public-profile/reference-sarah');assert.equal(c.state.journey.profile.value.name,'Sarah Endsley');assert.match(c.state.journey.profile.source,/captured|reference/i);
 assert.deepEqual(runtime.snapshot(),before);assert.deepEqual(calls,[],'Reference display reads retained public snapshot, not teacher services');
 const edited=await c.dispatch('public:profile-edit',{name:'An unauthorized replacement',bio:'This must not replace captured reference content.',wishlistUrl:''});assert.equal(edited.ok,false);
 assert.equal(c.state.journey.profile.value.name,'Sarah Endsley');assert.deepEqual(runtime.snapshot(),before);assert.deepEqual(calls,[]);
});
