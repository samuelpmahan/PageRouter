import {parseRoute} from './teacher-journey.mjs';
export function createController(runtime, {onChange=()=>{},onNavigate=()=>{}}={}) {
  const state={journey:runtime.snapshot(),request:{status:'idle',message:''},lookups:{states:[],counties:[],districts:[],schools:[]},school:{state:'',county:'',district:'',school:''},form:{demoConsent:false,bio:'I am a synthetic teacher exploring classroom support with Homeroom Heroes.',wishlistUrl:'https://www.amazon.com/hz/wishlist/ls/DEMO-CLASSROOM-ONLY'},publicProfile:null,publicRead:'idle',failNext:false};
  let route=parseRoute('#/register'),routeEpoch=0,mutation=null,schoolEpoch=0,lastRetry=null;
  const notify=()=>onChange(state,route);
  const failureInput=input=>{if(!state.failNext)return input;state.failNext=false;return {...input,failWith:'transport_failure'};};
  const resultStatus=r=>r.ok?'completed':r.error?.outcomeKnown===false?'outcome_unknown':r.error?.code==='denied'||r.error?.code==='pending_denied'?'rejected':'failed';
  function showResult(r) { state.journey=runtime.snapshot();state.request={status:resultStatus(r),message:r.message||r.error?.message||'Request finished.'}; }
  async function readPublic(id,epoch) {
    state.publicRead='busy';state.publicProfile=null;notify();
    const result=await runtime.invoke('TeacherProfile.openPublicProfile',failureInput({profileId:id}));
    if(epoch!==routeEpoch)return {ignored:true};
    state.publicRead=result.ok?'completed':'failed';state.publicProfile=result.ok?result.data.profile:null;
    if(!result.ok){showResult(result);lastRetry=result.error?.retryable?()=>readPublic(id,routeEpoch):null;}
    notify();return result;
  }
  async function navigate(hash) {
    route=parseRoute(hash);const epoch=++routeEpoch;
    if(route.page==='teachers')state.journey=runtime.snapshot();
    state.request={status:mutation?'busy':'idle',message:mutation?'A demo request is still running.':''};state.publicProfile=null;state.publicRead='idle';lastRetry=null;notify();
    if(route.page==='public')return readPublic(route.profileId,epoch);
    return {ok:true};
  }
  async function lookup(port,input,target,epoch) {
    const result=await runtime.invoke(port,failureInput(input));
    if(epoch!==schoolEpoch)return {ignored:true};
    if(result.ok)state.lookups[target]=result.data.values;
    else {showResult(result);lastRetry=result.error?.retryable?()=>lookup(port,input,target,schoolEpoch):null;}
    notify();return result;
  }
  async function initialize(hash) {await runtime.ready;state.journey=runtime.snapshot();await lookup('SchoolData.getStates',{},'states',schoolEpoch);await navigate(hash);return state;}
  async function selectSchool(key,value) {
    const keys=['state','county','district','school'];const index=keys.indexOf(key);if(index<0)throw new Error('Unknown school selection.');
    const epoch=++schoolEpoch;state.school[key]=value;for(let i=index+1;i<keys.length;i++){state.school[keys[i]]='';state.lookups[`${keys[i]}s`==='countys'?'counties':`${keys[i]}s`]=[];}
    state.request={status:'idle',message:''};lastRetry=null;notify();
    if(!value||key==='school')return {ok:true};
    const next=[['SchoolData.getCounties','counties'],['SchoolData.getDistricts','districts'],['SchoolData.getSchools','schools']][index];
    return lookup(next[0],{...state.school},next[1],epoch);
  }
  async function effect(port,input={},nextRoute=null) {
    if(mutation)return {ok:false,ignored:true,error:{code:'request_in_flight'}};
    const startEpoch=routeEpoch;const task=Symbol(port);mutation=task;state.request={status:'busy',message:'Working on the demo request…'};notify();
    const result=await runtime.invoke(port,failureInput(input));
    if(mutation!==task)return {ignored:true};
    mutation=null;showResult(result);lastRetry=!result.ok&&result.error?.retryable&&result.error?.outcomeKnown!==false?()=>effect(port,input,nextRoute):null;
    if(port==='Demo.reset'&&result.ok){schoolEpoch++;routeEpoch++;state.school={state:'',county:'',district:'',school:''};state.lookups.counties=[];state.lookups.districts=[];state.lookups.schools=[];state.form.demoConsent=false;state.publicProfile=null;state.publicRead='idle';state.failNext=false;}
    notify();
    const destination=typeof nextRoute==='function'?nextRoute(result):nextRoute;
    if(result.ok&&destination&&destination!==route.path&&(startEpoch===routeEpoch||port==='Demo.reset'))onNavigate(destination);
    return result;
  }
  async function dispatch(event, payload={}) {
    if(event==='register')return effect('Registration.registerTeacher',{teacher:{name:'Demo Teacher',email:'demo.teacher@fixture.test',phoneNumber:'DEMO'},school:{...state.school},termsAccepted:payload.demoConsent===true,demoAccount:true},'/register');
    if(event==='approve')return effect('Demo.simulateApproval',{},'/login');
    if(event==='login')return effect('Session.login',{email:state.journey.registration.email||'demo.teacher@fixture.test',demoAccount:true},'/profile');
    if(event==='create-profile')return effect('TeacherProfile.createProfile',{displayName:'Demo Teacher',bio:payload.bio,subjects:[],wishlistUrl:payload.wishlistUrl},'/profile');
    if(event==='logout')return effect('Session.logout',{},'/login');
    if(event==='reset')return effect('Demo.reset',{},'/register');
    if(event==='arm-failure'){state.failNext=!state.failNext;notify();return {ok:true};}
    if(event==='retry')return lastRetry?lastRetry():{ok:false,error:{code:'nothing_to_retry'}};
    throw new Error('Unknown demo event.');
  }
  return {state,get route(){return route;},initialize,navigate,selectSchool,dispatch,effect,get canRetry(){return !!lastRetry;}};
}
