import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function storage() { const m = new Map(); return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}; }
function walk(node, out=[]) { if (!node || typeof node !== 'object') return out; out.push(node); for (const child of node.children||[]) walk(child,out); return out; }
function uiProjection(controller) {
  const nodes = walk(renderPublicSite({route:controller.route,state:controller.state,journey:controller.state.journey,community:controller.state.community}));
  const byId = id => nodes.find(n=>n.attrs?.id===id);
  const formId = controller.route.page === 'register' ? 'hh-register-form' : 'hh-login-form';
  const submitId = controller.route.page === 'register' ? 'hh-register-submit' : 'hh-login-submit';
  const form = byId(formId), submit = byId(submitId);
  return {page:controller.route.page,formId:form?.attrs?.id||null,submitId:submit?.attrs?.id||null,
    submitType:submit?.attrs?.type||null,submitDisabled:submit?.attrs?.disabled===true,
    inputIds:nodes.filter(n=>n.tag==='input').map(n=>n.attrs?.id).filter(Boolean),
    statusTexts:nodes.filter(n=>n.attrs?.['aria-live']==='polite').flatMap(n=>n.children||[]).filter(x=>typeof x==='string')};
}
async function scenario(target, resolution) {
  const storageArea=storage();
  const base=createFixtureProvider({fixture:true,storage:storageArea});
  let release, entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const requested=new Promise(resolve=>{entered=resolve;});
  const original=base.services['TeacherProfile.openPublicProfile'];
  const services={...base.services,'TeacherProfile.openPublicProfile':async input=>{entered(input); await gate; if(resolution==='failure') return {ok:false,mode:'fixture',port:'TeacherProfile.openPublicProfile',status:'not_found',error:{code:'not_found'},message:'Synthetic delayed read failed.'}; return original(input);}};
  const provider={mode:base.mode,fixture:base.fixture,capabilities:base.capabilities,services,snapshot:base.snapshot};
  const runtime=createServiceRuntime(provider);
  const controller=createPublicController({runtime,storage:storageArea});
  await controller.initialize('#/');
  const pendingProfile=controller.navigate('#/public-profile/demo-jordan');
  const request=await requested;
  assert.deepEqual(request,{profileId:'demo-jordan'});
  const pendingAtProfile={route:controller.route.page,loading:controller.state.journey.loading,profileStatus:controller.state.journey.profile.status};
  assert.equal(pendingAtProfile.loading,false,'profile read does not set the shared journey.loading flag');
  assert.equal(pendingAtProfile.profileStatus,'loading');
  await controller.navigate(`#/${target}`);
  const atTargetBefore={route:controller.route.page,loading:controller.state.journey.loading,profileStatus:controller.state.journey.profile.status,ui:uiProjection(controller)};
  assert.equal(atTargetBefore.route,target);
  assert.ok(atTargetBefore.ui.formId && atTargetBefore.ui.submitId,'target form is projected');
  assert.equal(atTargetBefore.ui.submitDisabled,false,'projected submit button is enabled');
  const dispatchResult=target==='register'
    ? await controller.dispatch('public:register',{})
    : await controller.dispatch('public:login',{email:'',password:''});
  assert.equal(dispatchResult.ok,false);
  assert.equal(dispatchResult.error?.code,'validation_failed');
  const outcomeAfterDispatch=controller.state.journey.outcome?.kind;
  release();
  const staleReadResult=await pendingProfile;
  const after={route:controller.route.page,routeProfileId:controller.route.profileId||null,
    loading:controller.state.journey.loading,profileStatus:controller.state.journey.profile.status,
    profileId:controller.state.journey.profile.value?.id||null,profileSource:controller.state.journey.profile.source||null,
    outcome:controller.state.journey.outcome?.kind||null,ui:uiProjection(controller),
    dispatch:{ok:dispatchResult.ok,errorCode:dispatchResult.error?.code,outcomeAfterDispatch}};
  assert.deepEqual(staleReadResult,{ok:true,route:{page:target,path:`/${target}`}},'navigate returns the current route after the stale loader is suppressed');
  assert.equal(after.route,target,'current auth route remains current');
  assert.equal(after.loading,atTargetBefore.loading,'stale completion must not change route loading');
  assert.equal(after.profileStatus,'loading','stale completion must not replace profile state');
  assert.deepEqual({...after.ui,statusTexts:[]},{...atTargetBefore.ui,statusTexts:[]},'auth form controls remain structurally usable');
  assert.deepEqual(runtime.snapshot().demo.publicProfiles.map(p=>p.id),['demo-avery','demo-jordan']);
  return {target,resolution,request,pendingAtProfile,atTargetBefore,after,staleReadResult,
    sideEffectBoundary:{mode:runtime.mode,fixture:runtime.fixture,persistence:base.capabilities.persistence,profileDataIds:runtime.snapshot().demo.publicProfiles.map(p=>p.id),remoteOrBackend:false}};
}
const cases=[];
for (const target of ['register','login']) for (const resolution of ['success','failure']) cases.push(await scenario(target,resolution));
console.log(JSON.stringify({schema:'hh-cycle04-E601-probe/v1',cases},null,2));
