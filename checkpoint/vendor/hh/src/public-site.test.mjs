import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPublicSite,renderPreviewControls} from './public-site.mjs';

function inspect(tree){const nodes=[];const visit=value=>{if(!value||typeof value!=='object')return;nodes.push(value);for(const child of value.children||[])visit(child)};visit(tree);return nodes;}
function byId(tree,id){return inspect(tree).find(node=>node.attrs?.id===id);}
function text(tree){return inspect(tree).flatMap(node=>node.children||[]).filter(value=>typeof value==='string').join(' ');}

test('public route tree binds nav state, exposes accessible stable controls, and avoids inline styling',()=>{
  const closed=renderPublicSite({route:{page:'home'},journey:{navOpen:false}});
  const open=renderPublicSite({route:{page:'home'},journey:{navOpen:true}});
  assert.equal(byId(closed,'hh-public-nav-toggle').attrs['aria-expanded'],'false');
  assert.equal(byId(closed,'hh-mobile-nav').attrs.hidden,true);
  assert.equal(byId(open,'hh-public-nav-toggle').attrs['aria-expanded'],'true');
  assert.equal(byId(open,'hh-mobile-nav').attrs.hidden,false);
  const desktopNav=inspect(open).find(node=>node.tag==='nav'&&node.attrs?.class==='hh-nav');
  assert.ok(desktopNav);
  assert.equal(desktopNav.children.includes(byId(open,'hh-public-nav-toggle')),false,'mobile toggle must not be inside the desktop nav hidden at narrow widths');
  for(const id of ['hh-home-find-teachers','hh-home-register','hh-home-donate','hh-home-random-teacher'])assert.ok(byId(open,id),`missing ${id}`);
  const ids=inspect(open).map(node=>node.attrs?.id).filter(Boolean);
  assert.equal(new Set(ids).size,ids.length,'all DOM IDs must be unique');
  assert.ok(inspect(open).every(node=>!Object.hasOwn(node.attrs||{},'style')),'CSP-safe renderer does not emit inline styles');
  const community=renderPublicSite({route:{page:'community',communityRoute:{page:'forum'}},state:{community:{threads:[]}}});
  assert.equal(inspect(community).find(node=>node.tag==='main')?.attrs.tabindex,'-1','skip-link target must accept programmatic focus');
});

test('registration exposes the school cascade, password confirmation, Terms, and local approval',()=>{
  const state={journey:{lookups:{states:['WA'],counties:['King'],districts:['Seattle'],schools:['North']},school:{state:'WA',county:'King',district:'Seattle',school:'North'},terms:{open:true,accepted:true},registration:{status:'none'}}};
  const form=renderPublicSite({route:{page:'register'},...state});
  for(const id of ['hh-register-form','hh-register-name','hh-register-email','hh-register-phone','hh-register-password','hh-register-confirm','hh-terms-open','hh-terms-modal','hh-terms-consent','hh-register-submit'])assert.ok(byId(form,id),`missing ${id}`);
  for(const key of ['state','county','district','school'])assert.ok(inspect(form).some(node=>node.attrs?.['data-public-select']===key));
  for(const label of ['Name:','Email:','Phone Number:','Password:','Confirm Password:','State:','County:','School District:','School:'])assert.ok(inspect(form).some(node=>node.tag==='span'&&node.children?.includes(label)),`registration exposes ${label}`);
  assert.equal(inspect(form).some(node=>node.attrs?.['data-public-select']==='grade'),false,'captured registration form has no invented grade selector');
  assert.ok(inspect(form).find(node=>node.tag==='h1'&&node.children?.includes('User Registration')),'registration heading is rendered inside its paper card');
  const pending=renderPublicSite({route:{page:'register'},journey:{registration:{status:'pending'}}});
  assert.ok(byId(pending,'hh-register-approve'));
});

test('directory and contact reflect saved state, error/loading status, and remaining characters',()=>{
  const journey={filters:{query:'Ada',sort:'name'},lookups:{states:['WA'],counties:[],districts:[],schools:[]},school:{state:'WA'},matches:{status:'error',items:[],error:'Fixture lookup failed'},contact:{remaining:230,form:{message:'x'.repeat(20)}}};
  const directory=renderPublicSite({route:{page:'directory'},journey});
  assert.equal(byId(directory,'hh-query').attrs.value,'Ada');
  assert.match(text(directory),/Could not load results|Fixture lookup failed/);
  assert.equal(byId(directory,'hh-directory-retry').attrs['data-event'],'public:retry');
  const contact=renderPublicSite({route:{page:'contact'},journey});
  assert.ok(byId(contact,'hh-contact-subject'));
  assert.equal(text({children:[byId(contact,'hh-contact-counter')]}).trim(),'230 characters remaining');
});

test('profile error can retry and editable profile drafts survive renderer replacement',()=>{
  const failed=renderPublicSite({route:{page:'profile'},journey:{session:{status:'authenticated'},profile:{status:'error',error:'Temporary profile read failed'}}});
  assert.equal(byId(failed,'hh-profile-retry').attrs['data-event'],'public:retry');
  const editing=renderPublicSite({route:{page:'profile'},journey:{session:{status:'authenticated'},profile:{status:'present',editOpen:true,value:{id:'teacher-a',name:'Saved name',bio:'Saved bio',wishlistUrl:'https://example.test'},editDraft:{name:'Typed name',bio:'Typed bio',wishlistUrl:'https://example.test/new'}}}});
  assert.equal(byId(editing,'hh-profile-name').attrs.value,'Typed name');
  assert.equal(byId(editing,'hh-profile-bio').attrs.value,'Typed bio');
  assert.equal(byId(editing,'hh-profile-wishlist-url').attrs.value,'https://example.test/new');
  assert.equal(byId(editing,'hh-profile-public-view').attrs.href,'#/public-profile/teacher-a');
  const creating=renderPublicSite({route:{page:'profile'},journey:{session:{status:'authenticated'},profile:{status:'absent',createDraft:{name:'New name',bio:'New bio',wishlistUrl:'https://example.test/new'}}}});
  assert.equal(byId(creating,'hh-profile-name').attrs.value,'New name');
  assert.equal(byId(creating,'hh-profile-bio').attrs.value,'New bio');
  assert.equal(byId(creating,'hh-profile-wishlist-url').attrs.value,'https://example.test/new');
});

test('public profile formats structured school and scalar location fields without object coercion',()=>{
  const demo=renderPublicSite({route:{page:'profile',profileId:'demo-school-profile'},journey:{profile:{status:'present',value:{name:'Demo Teacher',school:{school:'Demo Academy',county:'Demo King',state:'Demo Washington',district:'Demo District'},bio:'Demo bio'}}}});
  const demoText=text(demo);
  assert.match(demoText,/Demo Academy/);
  assert.match(demoText,/Demo King, Demo Washington/);
  assert.doesNotMatch(demoText,/\[object Object\]/);
  const captured=renderPublicSite({route:{page:'profile',profileId:'reference-sarah'},journey:{}});
  const capturedText=text(captured);
  assert.match(capturedText,/ROCHESTER PRIMARY SCHOOL/);
  assert.match(capturedText,/School:/);
  assert.match(capturedText,/THURSTON COUNTY, Washington/);
  assert.ok(inspect(captured).some(node=>node.tag==='strong'&&node.children?.includes('THURSTON COUNTY, Washington')),'captured school and location values remain visually emphasized');
  assert.doesNotMatch(capturedText,/\[object Object\]/);
});

test('Terms displays the complete captured section set and public profiles require an explicit wishlist choice',()=>{
  const terms=renderPublicSite({route:{page:'register'},journey:{terms:{open:true}}});
  assert.match(text(terms),/Charitable Mission & Board Discretion/);
  assert.match(text(terms),/Third-Party Links/);
  assert.match(text(terms),/Last Updated: September 26, 2026/);
  const profile=renderPublicSite({route:{page:'profile',profileId:'teacher-a'},journey:{session:{status:'authenticated'},profile:{status:'present',value:{id:'teacher-a',name:'A Teacher',wishlistUrl:'https://example.test/wishlist'}},wishlist:{intent:true,choiceRequired:true}}});
  assert.ok(byId(profile,'hh-profile-wishlist-confirm'));
  assert.equal(byId(profile,'hh-profile-wishlist-open'),undefined);
});

test('Teacher of the Day uses the captured Sarah profile and keeps it separate from runtime-owned demo profiles',()=>{
  const home=renderPublicSite({route:{page:'home'},journey:{}});
  assert.equal(byId(home,'hh-home-teacher-of-day').attrs.href,'#/public-profile/reference-sarah');
  assert.equal(byId(home,'hh-home-teacher-of-day').children[0],'View Teacher of the Day');
  const teacherTile=inspect(home).find(node=>node.attrs?.['data-tile']==='one');
  assert.equal(teacherTile.children.find(node=>node.tag==='h2').children[0],'Teacher of the Day');
  assert.ok(inspect(teacherTile).some(node=>node.attrs?.class==='hh-tile-teacher'));
  assert.equal(byId(teacherTile,'hh-home-teacher-of-day').attrs.href,'#/public-profile/reference-sarah');
  assert.equal(inspect(home).find(node=>node.attrs?.['data-tile']==='two').children.find(node=>node.tag==='h2').children[0],'Are You a Teacher?');
  assert.equal(inspect(home).find(node=>node.attrs?.['data-tile']==='three').children.find(node=>node.tag==='h2').children[0],'Donate Directly to Us');
  assert.equal(inspect(home).find(node=>node.attrs?.['data-tile']==='four').children.find(node=>node.tag==='h2').children[0],'Find a Random Teacher');
  const metrics=inspect(home).filter(node=>node.attrs?.class?.startsWith('hh-metric hh-metric-'));
  assert.equal(metrics.length,3);
  for(const metric of metrics){assert.ok(inspect(metric).some(node=>node.tag==='svg'),'each metric has its captured icon');assert.ok(metric.children.some(node=>node.attrs?.class?.includes('hh-metric-divider-')),'each metric has its colored divider');}
  const profile=renderPublicSite({route:{page:'profile',profileId:'reference-sarah'},journey:{session:{status:'authenticated'},profile:{status:'present',value:{name:'Demo Avery'}}}});
  assert.match(text(profile),/Sarah Endsley/);
  assert.match(text(profile),/Rochester Primary School/);
  assert.match(text(profile),/I am a Kindergarten teacher in the dual language program/);
  assert.equal(byId(profile,'hh-reference-wishlist').attrs.href,'https://www.amazon.com/hz/wishlist/ls/3F27WJHJEBAXN?ref_=wl_share&tag=h0mer00mher0-20');
  assert.ok(byId(profile,'hh-reference-share'));
  assert.equal(byId(profile,'hh-profile-edit'),undefined,'captured reference profile is read-only');
});

test('Login and password-help content stays inside the single centered account card',()=>{
  const login=renderPublicSite({route:{page:'login'},journey:{session:{status:'anonymous'}}});
  const loginCard=inspect(login).find(node=>node.attrs?.class==='hh-card');
  assert.ok(loginCard);
  assert.ok(inspect(loginCard).some(node=>node.tag==='h1'&&node.children?.includes('Log In to Your Account')));
  assert.equal(byId(login,'hh-login-form').attrs['data-submit'],'public:login');
  assert.equal(byId(login,'hh-login-submit').children[0],'Submit');
  assert.ok(byId(login,'hh-login-forgot'));
  assert.match(text(login),/Register/);
  const forgot=renderPublicSite({route:{page:'forgot'},journey:{}});
  const forgotCard=inspect(forgot).find(node=>node.attrs?.class==='hh-card');
  assert.ok(inspect(forgotCard).some(node=>node.tag==='h1'&&node.children?.includes('Forgot Your Password?')));
  assert.match(text(forgot),/we'll send you instructions on how to reset your password/);
  assert.equal(byId(forgot,'hh-forgot-submit').children[0],'Submit');
  assert.match(text(forgot),/Back to Login/);
});

test('partner and About renders expose source-shaped images and readable team text',()=>{
  const partners=renderPublicSite({route:{page:'partners'},journey:{}});
  assert.ok(inspect(partners).some(node=>node.attrs?.class==='hh-partner-grid'));
  const logos=inspect(partners).filter(node=>node.tag==='img'&&String(node.attrs?.alt).endsWith('logo'));
  assert.ok(logos.length>=5);
  assert.ok(logos.every(node=>!Object.hasOwn(node.attrs||{},'width')&&!Object.hasOwn(node.attrs||{},'height')),'partner images keep intrinsic ratios');
  const about=renderPublicSite({route:{page:'about'},journey:{}});
  assert.equal(inspect(about).filter(node=>node.attrs?.class==='hh-person').length,6);
  assert.ok(inspect(about).every(node=>!Object.hasOwn(node.attrs||{},'style')));
  assert.ok(inspect(about).some(node=>node.attrs?.class==='hh-person-bio'));
});

test('Contact uses the captured local brand font glyphs and footer preview controls bind state',()=>{
  const contact=renderPublicSite({route:{page:'contact'},journey:{}});
  const icons=inspect(contact).filter(node=>node.attrs?.class?.startsWith('hh-social-icon fa-'));
  assert.deepEqual(icons.map(node=>node.attrs.class),['hh-social-icon fa-instagram','hh-social-icon fa-twitter','hh-social-icon fa-linkedin','hh-social-icon fa-facebook','hh-social-icon fa-threads']);
  assert.ok(icons.every(node=>node.attrs['aria-hidden']==='true'));
  const socialItem=inspect(contact).find(node=>node.tag==='li'&&node.children?.some(child=>child.attrs?.class==='hh-social-icon fa-instagram'));
  assert.equal(socialItem.children[0].attrs.class,'hh-social-icon fa-instagram','social icon precedes its label and link');
  assert.equal(socialItem.children[1].children[0],'Instagram:');
  const controls=renderPreviewControls({journey:{failNext:false,matches:{status:'idle'}}});
  assert.equal(byId(controls,'hh-fail-next').attrs['aria-pressed'],'false');
  assert.equal(byId(controls,'hh-read-retry'),undefined);
  const armed=renderPreviewControls({journey:{failNext:true,matches:{status:'error'}}});
  assert.equal(byId(armed,'hh-fail-next').attrs['aria-pressed'],'true');
  assert.equal(byId(armed,'hh-read-retry').attrs['data-event'],'public:retry');
  assert.equal(byId(armed,'hh-reset-local-demo').attrs['data-event'],'public:reset');
  assert.equal(byId(armed,'hh-fail-next').children[0],'Failure armed for next read');
  assert.equal(inspect(renderPublicSite({route:{page:'home'},journey:{}})).filter(node=>node.tag==='details'&&node.attrs?.class==='hh-preview-tools').length,0,'preview tools have one persistent static host, not a route-rendered duplicate');
});

test('Logout is available in the authenticated account menu and absent anonymously',()=>{
  const anonymous=renderPublicSite({route:{page:'home'},journey:{session:{status:'anonymous'}}});
  assert.equal(byId(anonymous,'hh-logout'),undefined);
  const authenticated=renderPublicSite({route:{page:'home'},journey:{session:{status:'authenticated',role:'teacher'}}});
  const logout=byId(authenticated,'hh-logout');
  assert.ok(logout);
  assert.equal(logout.tag,'button');
  assert.equal(logout.attrs['data-event'],'public:logout');
  assert.equal(logout.children[0],'Logout');
});


test('directory Results stays blank until an explicit search and then renders zero-result guidance',()=>{
  const idle=renderPublicSite({route:{page:'directory'},journey:{school:{school:'Demo School'},matches:{status:'loaded',items:[]},searchPerformed:false}});
  assert.ok(inspect(idle).some(node=>node.tag==='section'&&node.attrs?.class==='hh-card hh-directory-results-card'));
  assert.equal(inspect(idle).some(node=>node.attrs?.class==='hh-empty'),false,'background lookup plus selected filter is not a completed search');
  assert.equal(inspect(idle).some(node=>node.attrs?.id==='hh-directory-status'),false);
  const empty=renderPublicSite({route:{page:'directory'},journey:{school:{school:'Demo School'},matches:{status:'loaded',items:[]},searchPerformed:true}});
  assert.match(text(empty),/No teachers found/);
  assert.ok(byId(empty,'hh-directory-status'));
  const loading=renderPublicSite({route:{page:'directory'},journey:{matches:{status:'loading',items:[]},searchPerformed:false}});
  assert.match(text(loading),/Loading/);
  const failed=renderPublicSite({route:{page:'directory'},journey:{matches:{status:'error',items:[]},searchPerformed:false}});
  assert.match(text(failed),/Results could not be loaded/);
});
