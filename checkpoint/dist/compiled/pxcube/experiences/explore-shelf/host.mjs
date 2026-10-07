import config from './config.mjs';
import { createMockMounts } from './local/mock-mounts.mjs';
import { scopedStorage, localAddress } from './local/experience-mount.mjs';
import { scenarioFor } from './local/scenarios.mjs';

const $ = id => document.getElementById(id), frames = new Map();
const storageRoot = `pxcube.studio.v1:${config.id}`;
const drawerPreferenceKey = `${storageRoot}:controls-collapsed`;
let owner, selected, current;
const surfaces = config.mode === 'upload' ? [['live','Paint / photo · live Parts']] : config.mode === 'your-shelf' ? [['shopping','Your collection · browse and bag'],['upload','Add / import disc · live Parts'],['live','Inspect Parts · live']] : [['shopping','Shopping shelf · 50 discs'],['live','Edit a disc · live Parts']];
const pretty = value => JSON.stringify(value, (_key,item)=>typeof item === 'function' ? '[Calculation function — inspect in owning DevTools]' : item, 2);
function stop(error) { $('status').textContent = `Stopped: ${error.message ?? error}`; $('status').className='error'; }
function guarded(fn) { return (...args)=>{try { return fn(...args); } catch(error) {stop(error);} }; }
function setDrawerCollapsed(collapsed, {remember=true}={}) {
  const isCollapsed=Boolean(collapsed), toggle=$('sandbox-drawer-toggle');
  $('sandbox-drawer').hidden=isCollapsed;
  toggle.setAttribute('aria-expanded',String(!isCollapsed));
  toggle.setAttribute('aria-label',isCollapsed?'Show sandbox controls':'Hide sandbox controls');
  toggle.querySelector('.drawer-label').textContent=isCollapsed?'Sandbox':'Close';
  if(remember) try { localStorage.setItem(drawerPreferenceKey,String(isCollapsed)); } catch { /* The drawer still works without persistence. */ }
}
function entryFor(source) {
  const entry = [...frames.values()].find(entry=>entry.frame?.contentWindow === source);
  if (!entry) throw Error('The caller does not own a mounted surface.');
  return entry;
}
function navigateFromChild(event) {
  if (event.data?.type !== 'pxcube:your-shelf:navigate' || event.data.surface !== 'upload') return;
  const entry = entryFor(event.source);
  if (entry !== current) return;
  const ownerName = entry.kind === 'scenario' ? owner.openInteractive(config.id,'studio').name : entry.name;
  open(ownerName,'upload');
}
function snapshot(entry) {
  return {schemaVersion:1,mount:entry.name,kind:entry.kind,surface:entry.surface,source:config.source,
    ...(entry.bridge ? entry.bridge.inspect() : entry.observation ?? {status:'Loading'})};
}
function retain(entry) {
  if (!entry.bridge) return;
  const value = snapshot(entry);
  // Test observations are independent of the domain archive and never overwrite
  // another iterator. The original model is still the source while it is live.
  if (entry.kind === 'test') entry.observationStorage.setItem('',pretty(value));
  entry.observation = value;
}
function contextFor(source) {
  const entry = entryFor(source);
  return Object.freeze({name:entry.name,kind:entry.kind,surface:entry.surface,mode:config.mode,
    storage:entry.storage,
    localAddress: address=>localAddress(entry.name,address),
    checkpoint:guarded(()=>retain(entry)),
    stopped:stop,
    ready(bridge) {
      if (entry.bridge) throw Error('A model already owns this surface.');
      entry.bridge=bridge; retain(entry);
      if (entry === current) { const metadata=owner.handle(entry.name).inspect(); $('status').textContent=entry.kind === 'scenario' ? `Scenario · ${metadata.scenarioId} · disposable` : entry.kind === 'test' ? 'Fresh test fixture · actions stay in this numbered sandbox.' : 'Interactive · saved domain changes stay in this sandbox.'; }
    },
  });
}
function inspection() { return snapshot(current); }
function refreshSessions() {
  $('session').replaceChildren(...owner.list().map(run=>new Option(run.kind === 'interactive' ? 'Interactive · resume' : run.kind === 'scenario' ? `Scenario · ${run.scenarioId} · disposable` : `Test ${run.iteration} · ${run.name}`,run.name)));
  $('session').value=selected;
}
function open(name, surface) {
  const record=owner.handle(name).inspect();
  if(record.kind === 'test') surface=record.value.sc.surface.variant;
  if (!surfaces.some(([key])=>key === surface)) throw Error('Unknown Experience surface.');
  if(record.seedIdentity !== config.source) throw Error('This retained mount belongs to a different source; migration needs review. Stored data preserved.');
  selected=name; $('surface').value=surface; $('surface').disabled=record.kind !== 'interactive';
  const scenarioMode=surface==='shopping';$('scenario').disabled=!scenarioMode;$('launch-scenario').disabled=!scenarioMode;$('reset-scenario').disabled=!scenarioMode||record.kind!=='scenario';$('return-workspace').disabled=record.kind!=='scenario';
  $('mount').textContent=name+'.*'; refreshSessions();
  const key=`${name}|${surface}`;
  if(!frames.has(key)) {
    const storage=scopedStorage(localStorage,`${storageRoot}:${key}:archive`);
    const observationStorage=scopedStorage(localStorage,`${storageRoot}:${key}:observation`);
    const entry={name,kind:record.kind,surface,storage,observationStorage}; frames.set(key,entry);
    const retained=record.kind === 'test' && observationStorage.getItem('');
    if(retained) {
      entry.observation=JSON.parse(retained);
      const view=document.createElement('section');view.className='retained';
      const heading=document.createElement('h2');heading.textContent='Retained test observation';
      const explanation=document.createElement('p');explanation.textContent='This run’s page was closed. Its saved observations remain here; start a new test run to execute from the seed again.';
      const pre=document.createElement('pre');pre.textContent=pretty(entry.observation);view.append(heading,explanation,pre);entry.view=view;
    } else {
      const frame=document.createElement('iframe');frame.title=`${config.title} · ${name} · ${surface}`;
      frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-modals allow-forms');
      entry.frame=entry.view=frame;
      const scenario=record.kind==='scenario'&&record.sourceSurface===surface&&scenarioFor(record.scenarioId);const params=scenario?`?scenario=${encodeURIComponent(scenario.id)}&testRun=1&run=${encodeURIComponent(name)}&surface=${encodeURIComponent(surface)}`:'';
      frame.src=(surface === 'shopping' ? './studio/upload-disc-to-shelf/accepted-shelf.html' : './studio/upload-disc-to-shelf/index.html')+params;
    }
    $('surfaces').append(entry.view);
  }
  current=frames.get(key);for(const entry of frames.values())entry.view.hidden=entry!==current;
  $('boundary').textContent=surface === 'shopping' ? 'Accepted shopping prototype · its actual 50-disc model is inspectable. Live Part integration is available separately under Surface.' : 'Live Studio Parts and composition receipts · the mount resolves into this frame’s own store. Internal Studio names are preserved.';
  $('status').textContent=current.bridge ? (record.kind === 'interactive' ? 'Interactive · resumed in the same owning context.' : record.kind === 'scenario' ? `Scenario · ${record.scenarioId} · disposable` : 'Test run · retained in its own context.') : current.observation ? 'Saved test observation · read-only after reload.' : 'Opening owning context…';
}
window.pxCubeExperience=Object.freeze({contextFor,inspect:inspection,list:()=>owner.list(),
  resolve(address) { if(!current.bridge) throw Error('Only saved observations are available; no live model to resolve.');localAddress(current.name,address);return current.bridge.resolve(address); },
  current:()=>({name:current.name,surface:current.surface,kind:current.kind}),
});
window.addEventListener('message',guarded(navigateFromChild));
$('title').textContent=config.title;document.title=config.title+' · sandbox';
$('sandbox-drawer-toggle').onclick=()=>setDrawerCollapsed(!$('sandbox-drawer').hidden);
document.addEventListener('keydown',event=>{
  if(event.key === 'Escape' && !$('sandbox-drawer').hidden && !$('inspection').open) {
    setDrawerCollapsed(true);$('sandbox-drawer-toggle').focus();
  }
});
let drawerCollapsed=true;
try { const saved=localStorage.getItem(drawerPreferenceKey);if(saved !== null) drawerCollapsed=saved === 'true'; } catch { /* Default to the review-first collapsed state. */ }
setDrawerCollapsed(drawerCollapsed,{remember:false});
$('surface').replaceChildren(...surfaces.map(([key,label])=>new Option(label,key)));
$('surface').onchange=guarded(()=>open(selected,$('surface').value));
$('session').onchange=guarded(()=>open($('session').value,$('surface').value));
$('new-test').onclick=guarded(()=>{
  const run=owner.createTestRun(config.id,'studio');
  run.writeScratch('sc.surface',{variant:$('surface').value});
  open(run.name,$('surface').value);
});
$('launch-scenario').onclick=guarded(()=>{
  const run=owner.createTestRun(config.id,'studio',{scenario:$('scenario').value,sourceSurface:$('surface').value,kind:'scenario'});
  run.writeScratch('sc.surface',{variant:$('surface').value});
  open(run.name,$('surface').value);
});
$('reset-scenario').onclick=guarded(()=>{$('launch-scenario').click();});
$('return-workspace').onclick=guarded(()=>{open(owner.openInteractive(config.id,'studio').name,surfaces[0][0]);});
$('inspect').onclick=guarded(()=>{
  $('values').textContent=pretty(inspection());$('resolved').textContent='';
  $('inspection-kind').textContent=current.bridge ? 'Live inspection — reads the model in the visible surface.' : 'Saved observation — the original execution context is no longer running.';
  $('lookup').hidden=!current.bridge;
  $('address').value=current.name+(current.surface === 'shopping'?'.px.shelf':'.px.shelf.0');
  $('inspection').showModal();
});
$('lookup').onsubmit=event=>{event.preventDefault();try{$('resolved').textContent=pretty(window.pxCubeExperience.resolve($('address').value));}catch(error){$('resolved').textContent=String(error);}};
$('close').onclick=()=>$('inspection').close();
$('export').onclick=guarded(()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([pretty(inspection())],{type:'application/json'}));a.href=url;a.download=current.name+'.inspection.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try {
  owner=createMockMounts({storage:localStorage,key:storageRoot+':mounts',seedIdentity:config.source});
  open(owner.openInteractive(config.id,'studio').name,surfaces[0][0]);
} catch(error) {stop(error);for(const id of ['new-test','surface','session','inspect'])$(id).disabled=true;}
