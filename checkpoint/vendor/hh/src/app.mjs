import {createFixtureProvider,createServiceRuntime} from './services/index.mjs';
import {seek} from './teacher-journey.mjs';
import {createController} from './controller.mjs';
import {registerWebMcp} from './webmcp.mjs';
import {mountDevTools} from './pxc-devtools/devtools.mjs';
import {createStyleInspectionBoard, registerBrowserStylePlayground} from './style-playground.mjs';
const root=document.getElementById('app');
let devTools;
let storage;
try{storage=window.sessionStorage;}catch{storage={getItem(){throw new Error('Session storage is unavailable');},setItem(){throw new Error('Session storage is unavailable');},removeItem(){throw new Error('Session storage is unavailable');}};}
const provider=createFixtureProvider({fixture:true,storage});
const runtime=createServiceRuntime(provider);
const controller=createController(runtime,{onChange:render,onNavigate:path=>{if(location.hash===`#${path}`)controller.navigate(location.hash);else location.hash=path;}});
function createElement(tree) {
  if(typeof tree!=='object')return document.createTextNode(String(tree));
  const element=document.createElement(tree.tag);
  for(const [key,value] of Object.entries(tree.attrs)){if(value===false||value===null||value===undefined)continue;if(['value','checked','selected','disabled','readonly'].includes(key)){if(key==='readonly')element.readOnly=!!value;else element[key]=value;}else element.setAttribute(key,String(value));}
  for(const child of tree.children)element.append(createElement(child));return element;
}
function render(state,route) {
  const focused=document.activeElement?.id;
  root.replaceChildren(createElement(seek(route,state,provider.capabilities,{width:innerWidth,height:innerHeight})));
  if(controller.canRetry&&['failed','rejected'].includes(state.request.status)){
    const notice=root.querySelector('.notice');if(notice){const retry=document.createElement('button');retry.type='button';retry.dataset.event='retry';retry.className='retry-button';retry.textContent='Retry demo request';notice.append(retry);}
  }
  document.title=`Homeroom Heroes · ${route.page==='public'?'Public demo profile':route.page==='profile'?'Teacher profile':route.page==='login'?'Demo login':route.page==='teachers'?'Demo teachers':'Register'}`;
  if(focused)document.getElementById(focused)?.focus({preventScroll:true});
}
root.addEventListener('click',async event=>{if(event.target.closest('a[href="#main"]')){event.preventDefault();document.getElementById('main')?.focus();return;}const button=event.target.closest('[data-event]');if(!button)return;await controller.dispatch(button.dataset.event);});
root.addEventListener('submit',async event=>{const form=event.target.closest('[data-submit]');if(!form)return;event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form);await controller.dispatch(form.dataset.submit,{demoConsent:data.has('demoConsent'),bio:data.get('bio'),wishlistUrl:data.get('wishlistUrl')});});
root.addEventListener('input',event=>{const el=event.target;if(el.name==='bio')controller.state.form.bio=el.value;if(el.name==='demoConsent')controller.state.form.demoConsent=el.checked;});
root.addEventListener('change',async event=>{if(event.target.dataset.school)await controller.selectSchool(event.target.dataset.school,event.target.value);});
root.addEventListener('dblclick', event => { const heading=event.target.closest('[data-pxc-devtools]'); if(heading){event.preventDefault();devTools?.open(undefined,heading);} });
root.addEventListener('keydown', event => { const heading=event.target.closest('[data-pxc-devtools]'); if(heading&&['Enter',' '].includes(event.key)){event.preventDefault();devTools?.open(undefined,heading);} });
window.addEventListener('hashchange',()=>controller.navigate(location.hash));
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>render(controller.state,controller.route),100);});
try {
  await controller.initialize(location.hash);
  const stylePlayground = runtime.fixture === true ? registerBrowserStylePlayground(runtime.pxc) : null;
  const inspectionBoard = stylePlayground ? createStyleInspectionBoard(runtime.pxc, runtime.devtoolsBoard) : runtime.devtoolsBoard;
  devTools=mountDevTools(inspectionBoard,{label:'Teacher journey',readOnly:true,app:root,storage,getContext:()=>{const journey=runtime.snapshot();return {session:journey.session.status,registration:journey.registration.status,currentTeacherName:journey.demo?.selectedTeacher?.name||null,hasCurrentProfile:(journey.demo?.publicProfiles||[]).some(p=>p.teacherId===journey.registration.teacherId),publicProfiles:journey.demo?.publicProfiles||[]};},stylePlayground});
  registerWebMcp(controller, {navigate:async path=>{location.hash=path;await controller.navigate(`#${path}`);}});
} catch(error) {
  root.replaceChildren(createElement({tag:'main',attrs:{class:'page-shell'},children:[{tag:'section',attrs:{class:'card'},children:[{tag:'h1',attrs:{},children:['The demo could not open']},{tag:'p',attrs:{},children:['Reload this page to retry. No production request was sent.']}]}]}));
  console.error('HH preview initialization failed',error);
}
