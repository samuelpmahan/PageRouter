/** Pure TeacherJourney projection. This module imports no provider or DOM API. */
export const node = (tag, attrs = {}, ...children) => ({tag, attrs, children:children.flat().filter(x=>x!==null&&x!==undefined&&x!==false)});
const h = node;
const link = (label, route, attrs={}) => h('a',{href:`#${route}`,...attrs},label);
const button = (label,event,attrs={}) => h('button',{type:'button','data-event':event,...attrs},label);
const para = (text,cls='intro') => h('p',{class:cls},text);
const field = (label,name,value,attrs={}) => h('label',{class:'field',for:name},h('span',{},label),h('input',{id:name,name,value,'aria-label':label,...attrs}));
const demo = {name:'Demo Teacher',email:'demo.teacher@fixture.test',phoneNumber:'DEMO'};
export function parseRoute(hash) {
  const value = String(hash || '#/register').replace(/^#/,'');
  if (/^\/teachers\/[a-z0-9-]+$/.test(value)) return {page:'public',profileId:value.split('/')[2],path:value};
  if (['/register','/login','/profile','/teachers'].includes(value)) return {page:value.slice(1),path:value};
  return {page:'not-found',path:value};
}
export function project(route, state, capabilities, viewport) {
  const session = state.journey.session.status;
  const registration = state.journey.registration.status;
  const profile = state.journey.ownProfile.status;
  return Object.freeze({kind:'TeacherJourney', route, session, registration, profile,
    request:state.request.status, compact:viewport.width<760,
    canRegister:registration==='none',canApprove:registration==='pending',
    canLogin:registration==='approved'&&session==='anonymous',
    canCreate:session==='authenticated'&&profile==='absent',
    mode:state.journey.mode,capabilities});
}
function notice(state) {
  if (!state.request.message) return null;
  return h('div',{class:'notice','data-kind':state.request.status==='failed'||state.request.status==='rejected'||state.request.status==='outcome_unknown'?'error':'success',role:'status','aria-live':'polite'},state.request.message);
}
function registrationView(view,state) {
  if (view.registration==='pending') return h('section',{class:'card state-card'},h('div',{class:'eyebrow'},'Teacher community'),h('span',{class:'status-label pending'},'Pending approval'),h('h1',{id:'page-title'},'Your request is pending'),para('Your demo registration is saved. In Homeroom Heroes, a teacher must be approved before they can log in.'),notice(state),h('div',{class:'approval-box'},h('h2',{},'Try the next step'),para('Simulate approval for this synthetic teacher. This does not log you in or approve anyone in the real app.'),button('Simulate demo approval','approve',{disabled:state.request.status==='busy'})),link('See public demo teachers','/teachers',{class:'text-link'}));
  if (view.registration==='approved') return h('section',{class:'card state-card'},h('div',{class:'eyebrow'},'Teacher community'),h('span',{class:'status-label'},'Demo approval complete'),h('h1',{id:'page-title'},'You’re ready for demo login'),para('The approval step is complete. Your session is still logged out until you choose demo login.'),notice(state),link(view.session==='authenticated'?'Continue to your profile':'Continue to demo login',view.session==='authenticated'?'/profile':'/login',{class:'button-link'}));
  const schoolField=(label,key,values,disabled=false)=>h('label',{class:'field',for:key},h('span',{},label),h('select',{name:key,id:key,'aria-label':label,'data-school':key,required:true,disabled},h('option',{value:''},`Choose ${label.toLowerCase()}`),values.map(value=>h('option',{value,selected:state.school[key]===value},value))));
  return h('section',{class:'card'},h('div',{class:'eyebrow'},'Teacher community'),h('h1',{id:'page-title'},'Create your account'),para('Share your school details to request a Homeroom Heroes account. Your registration stays pending until it is confirmed.'),notice(state),h('form',{'data-submit':'register',id:'registration-form'},h('div',{class:'grid-two'},field('Name','name',demo.name,{readonly:true}),field('Email','email',demo.email,{type:'email',readonly:true})),field('Phone number','phoneNumber',demo.phoneNumber,{readonly:true}),para('Synthetic details are locked for this preview. Demo login does not use a real password.','small-note left-note'),h('div',{class:'divider'},h('span',{},'School information')),h('div',{class:'grid-two'},schoolField('State','state',state.lookups.states),schoolField('County','county',state.lookups.counties,!state.school.state),schoolField('School district','district',state.lookups.districts,!state.school.county),schoolField('School','school',state.lookups.schools,!state.school.district)),h('label',{class:'terms',for:'demoConsent'},h('input',{type:'checkbox',id:'demoConsent',name:'demoConsent',required:true,checked:state.form.demoConsent}),h('span',{},'I confirm this is a synthetic demo request. No real account or terms acceptance is created.')),h('button',{type:'submit',disabled:state.request.status==='busy'},state.request.status==='busy'?'Saving demo request…':'Submit demo registration')));
}
function loginView(view,state) {
  if(view.session==='authenticated') return h('section',{class:'card state-card'},h('h1',{id:'page-title'},'You’re logged in to the demo'),para('Continue to your teacher profile.'),link('Open my profile','/profile',{class:'button-link'}),notice(state));
  return h('section',{class:'card state-card'},h('div',{class:'eyebrow'},'Teacher community'),h('h1',{id:'page-title'},'Demo login'),para('Log in as the synthetic teacher after demo approval. This is a simulated session, with no real authentication or stored password.'),notice(state),h('form',{'data-submit':'login'},field('Demo email','loginEmail',state.journey.registration.email||demo.email,{readonly:true,type:'email'}),h('button',{type:'submit',disabled:state.request.status==='busy'},state.request.status==='busy'?'Opening demo session…':'Log in to demo')),view.registration!=='approved'?h('p',{class:'small-note'},view.registration==='pending'?'Approval is still pending.': 'Create a demo registration first.', ' ',link('Open registration','/register')):null);
}
function publicCard(profile,own=false) {
  return h('section',{class:'card profile-card'},h('div',{class:'profile-heading'},h('img',{src:'./assets/apple.jpg',alt:'Homeroom Heroes apple placeholder',class:'teacher-image'}),h('div',{},h('span',{class:'status-label'},own?'Your synthetic profile':'Public demo profile'),h('h1',{id:'page-title'},profile.displayName||profile.name),h('p',{class:'school-name'},profile.school?.school||profile.schoolName||'Demo Academy'),h('p',{class:'muted'},[profile.school?.county,profile.school?.state].filter(Boolean).join(', ')))),h('div',{class:'profile-divider'}),h('h2',{},'About me'),para(profile.bio||'A synthetic classroom profile for exploring the Homeroom Heroes journey.'),h('h2',{},'Classroom wishlist'),field('Amazon Wishlist URL (synthetic)','publicWishlistUrl',profile.wishlistUrl||'Unavailable in this preview',{readonly:true,type:'url'}),para('Synthetic preview link only. Opening Amazon, wishlist items and purchases are deferred.','small-note left-note'),h('div',{class:'profile-divider'}),link('Browse demo teachers','/teachers',{class:'text-link'}));
}
function profileView(view,state) {
  if(view.session!=='authenticated') return h('section',{class:'card state-card'},h('h1',{id:'page-title'},'Log in to create your profile'),para('The profile step requires an approved teacher and an active demo session.'),link('Open demo login','/login',{class:'button-link'}));
  if(view.profile==='present') { const p=state.journey.ownProfile.profile; return h('div',{},notice(state),publicCard(p,true),h('section',{class:'card compact-card'},h('h2',{},'Open the public view'),link('View my public demo profile',`/teachers/${p.id}`,{class:'button-link'}),para('Your new profile stays in this tab’s demo session. It survives reload here; it is not a shareable, saved teacher record. Profile editing is deferred.','small-note left-note'))); }
  return h('section',{class:'card'},h('div',{class:'eyebrow'},'Teacher community'),h('h1',{id:'page-title'},'Create Teacher Profile'),para('Add a classroom introduction and wishlist for the synthetic teacher.'),notice(state),h('form',{'data-submit':'create-profile'},field('Full name','displayName','Demo Teacher',{readonly:true}),field('School','profileSchool',state.journey.demo?.selectedSchool?.school||state.school.school||'Demo school',{readonly:true}),h('label',{class:'field',for:'bio'},h('span',{},'About Me'),h('textarea',{name:'bio',id:'bio','aria-label':'About Me',rows:'4',maxlength:'500',required:true},state.form.bio)),field('Amazon Wishlist URL (synthetic)','wishlistUrl',state.form.wishlistUrl,{readonly:true,type:'url'}),para('This locked URL has a demo identifier and is displayed only. No Amazon request, wishlist item model or purchase flow runs.','small-note left-note'),h('button',{type:'submit',disabled:state.request.status==='busy'},state.request.status==='busy'?'Saving demo profile…':'Create demo profile')));
}
function teachersView(state) {
  const profiles=state.journey.demo?.publicProfiles||[];
  return h('section',{class:'card'},h('div',{class:'eyebrow'},'Support teachers'),h('h1',{id:'page-title'},'Meet the demo teachers'),para('Explore synthetic classroom profiles. New profiles stay in this tab’s demo session.'),notice(state),h('div',{class:'teacher-list'},profiles.map(p=>h('article',{class:'teacher-tile','data-profile-id':p.id},h('img',{src:'./assets/apple.jpg',alt:'Homeroom Heroes apple placeholder'}),h('h2',{},p.displayName),h('p',{class:'muted'},p.seeded?'Stable demo profile':'This tab only'),link('View classroom',`/teachers/${p.id}`,{class:'button-link secondary'})))));
}
export function seek(route,state,capabilities={},viewport={width:1280,height:800}) {
  const view=project(route,state,capabilities,viewport);
  const stage=view.profile==='present'?4:view.session==='authenticated'?3:view.registration==='approved'?2:view.registration==='pending'?1:0;
  let content;
  if(route.page==='register') content=registrationView(view,state);
  else if(route.page==='login') content=loginView(view,state);
  else if(route.page==='profile') content=profileView(view,state);
  else if(route.page==='teachers') content=teachersView(state);
  else if(route.page==='public') content=state.publicProfile?publicCard(state.publicProfile):h('section',{class:'card state-card'},h('h1',{id:'page-title'},state.publicRead==='busy'?'Opening public profile…':'This demo profile is unavailable'),notice(state),para(state.publicRead==='busy'?'Reading the selected synthetic classroom.':'New profiles only exist in their original tab. The seeded demo teachers are always available.'),link('Browse demo teachers','/teachers',{class:'button-link'}));
  else content=h('section',{class:'card state-card'},h('h1',{id:'page-title'},'That preview page isn’t here'),link('Open registration','/register',{class:'button-link'}));
  return h('div',{'data-journey':'TeacherJourney','data-session':view.session,'data-registration':view.registration,'data-profile':view.profile},
    h('a',{href:'#main',class:'skip-link'},'Skip to content'),
    h('header',{class:'topbar'},link(h('img',{src:'./assets/logo_transparent.png',alt:'Homeroom Heroes',class:'brand-logo'}),'/register',{class:'brand'}),h('nav',{'aria-label':'Preview navigation'},link('Register','/register',{'aria-current':route.page==='register'?'page':null}),link('Teachers','/teachers',{'aria-current':route.page==='teachers'?'page':null}),link(view.session==='authenticated'?'My profile':'Log in',view.session==='authenticated'?'/profile':'/login',{'aria-current':route.page==='login'||route.page==='profile'?'page':null}),view.session==='authenticated'?button('Log out','logout',{class:'nav-button',disabled:state.request.status==='busy'}):null)),
    h('div',{class:'demo-banner'},h('strong',{},'DEMO ONLY'),h('span',{},'Synthetic data · this tab only · no real email, login, or payments')),
    h('main',{id:'main',tabindex:'-1',class:`page-shell journey-shell ${view.compact?'compact':''}`},h('aside',{class:'journey-rail','aria-label':'Teacher journey'},h('p',{id:'journey-inspect-heading',class:'eyebrow inspect-heading',tabindex:'0',role:'button','data-pxc-devtools':'true',title:'Double-click to open PxC DevTools'},'Teacher journey'),h('ol',{class:'journey-steps'},['Register','Approval','Demo login','Create profile','Public view'].map((label,index)=>h('li',{class:index<stage?'done':index===stage?'current':''},h('span',{class:'step-number'},index<stage?'✓':String(index+1)),h('span',{},label)))),h('section',{class:'demo-controls'},h('h2',{},'Preview controls'),para('Try the flow, then reset to start again.','small-note left-note'),button('Reset demo','reset',{class:'secondary',disabled:state.request.status==='busy'}),button(state.failNext?'Failure is armed':'Fail next request','arm-failure',{class:'text-button','aria-pressed':state.failNext}),h('p',{class:'small-note left-note'},state.failNext?'The next service request will fail before saving. Retry it to recover.':'New records stay only in this tab’s session.')),h('p',{class:'provenance-note'},'A bounded preview from the surviving HH registration and teacher UI.')),
    h('div',{class:'journey-content'},content)),h('footer',{},'Homeroom Heroes · Synthetic teacher journey preview'));
}
export const TeacherJourney = Object.freeze({project,seek});
