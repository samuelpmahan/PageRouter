import * as watchAPI from '../src/watches/index.mjs';
import { componentDefinitions, componentSources, describeWatchComponent } from '../src/watches/components.mjs';

const { createWatchRun, applyWatchAction, replayWatchRun, watchGeometry, canonicalWatchJson } = watchAPI;
const expandCounterWindow = watchAPI.expandWatchCounterWindow;

const MAX_PACING = 512;
const MAX_EVENTS = 80;
const MAX_MICROSCOPE = 32;
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => typeof value === 'number' ? new Intl.NumberFormat(undefined,{maximumFractionDigits:5}).format(value) : value&&typeof value==='object'&&Number.isSafeInteger(value.numerator)&&Number.isSafeInteger(value.denominator) ? value.denominator===1?String(value.numerator):`${value.numerator}/${value.denominator}` : typeof value==='object' ? JSON.stringify(value) : String(value ?? '—');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value==='object' ? `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const clone = value => structuredClone(value);

export function registerWatchWorkbench(api) {
  const definitions = componentDefinitions();
  const sources = new Map(componentSources().map(item=>[item.id,item]));
  let state = createWatchRun();
  let archivedState = null;
  let selected = 'mechanical.balanceWheel';
  let explode = 0;
  let showEnergy = true;
  let showTiming = true;
  let timer = null;
  let lastCallbackAt = null;
  let pacing = [];
  let pacingSummary = null;
  let renderEpoch = 0;
  let panelRoot = null;
  let currentGeometry = null;
  const callbacks = [];
  const partById = new Map(definitions.map(d=>[d.id,d]));

  function stopAutoplay() { if(timer!==null) clearInterval(timer); timer=null; }
  function apply(action) {
    try {
      state = applyWatchAction(state, action);
      if(action.type==='advance' && action.origin==='autoplay') recordPacing();
      render(); updateStatus(action); return clone(state);
    } catch(error) { stopAutoplay(); render(); setStatus(`Run paused: ${error.message}`,true); throw error; }
  }
  function updateStatus(action){
    const at=`logical ${fmt(state.time)} s`;
    if(action.type==='advance')setStatus(`${action.origin==='autoplay'?'Autoplay':'Manual advance'} to ${at}; ${state.paused?'paused':'running'}.`,action.origin!=='autoplay');
    else if(action.type==='step')setStatus(`Stepped ${action.event} to ${at}; manual stepping works while paused.`,true);
    else if(action.type==='pause')setStatus(`Paused at ${at}; manual steps remain available.`,true);
    else if(action.type==='resume')setStatus(`Resumed at ${at}; logical time changes only through explicit actions.`,true);
    else if(action.type==='reset')setStatus('Run reset. The reset is retained in replay history.',true);
    else if(action.type==='energy')setStatus(`${action.source} energy path ${action.enabled?'enabled':'disabled'} at ${at}.`,true);
    else if(action.type==='rate')setStatus(`${action.model} rate changed to ${fmt(action.hz)} Hz and recorded in this run.`,true);
    else if(action.type==='visibility')setStatus(action.hidden?'Hidden tab: autoplay frozen; it will not restart automatically.':'Tab visible. Autoplay remains stopped until you press Play.',true);
  }
  function recordPacing() {
    const now=performance.now();
    if(lastCallbackAt!==null) { pacing.push(now-lastCallbackAt); if(pacing.length>MAX_PACING) pacing=pacing.slice(-MAX_PACING); }
    lastCallbackAt=now; pacingSummary=null;
  }
  async function summarizePacing() {
    if(pacing.length<2) return null;
    const values=pacing.slice();
    try { pacingSummary=api.execute('statistics.describe',{values,denominator:'population'}).result; }
    catch(error) { pacingSummary={error:`Statistics summary unavailable: ${error.message}`}; }
    renderPacing(); return pacingSummary;
  }
  function startAutoplay() {
    if(timer!==null) return;
    if(document.hidden||state.visibilityHidden){setStatus('Autoplay is frozen while this tab is hidden.',true);return;}
    if(state.paused) apply({type:'resume'});
    lastCallbackAt=null;
    timer=setInterval(()=>{
      if(document.hidden) { stopAutoplay(); apply({type:'visibility',hidden:true}); setStatus('Hidden tab: autoplay frozen. Resume manually when visible.',true); return; }
      try { apply({type:'advance',duration:{numerator:1,denominator:10},origin:'autoplay'}); }
      catch { stopAutoplay(); }
    },100);
    setStatus('Autoplay: fixed 1/10 logical second per callback; callback gaps are measured separately.',true);
  }
  function setStatus(text, announce=false) { const el=document.querySelector('#watch-status'); if(el){el.textContent=text;el.setAttribute('aria-live',announce?'polite':'off');} }

  function ensureMarkup(container) {
    if(panelRoot && panelRoot.isConnected) return;
    container.innerHTML=`<section class="watch-workbench" id="watch-workbench" aria-label="Synchronized watch models">
      <div class="watch-intro"><div><p class="watch-kicker">ONE LOGICAL CLOCK · THREE MODELS</p><h2>What keeps time?</h2><p>Advance one shared rational timeline. Each model converts it into its own events and visible hand steps.</p></div><div class="watch-note"><b>Teaching models</b><span>Illustrative geometry · declared ideal rates · no physical accuracy claim</span></div></div>
      <div class="watch-controls" role="group" aria-label="Watch controls">
        <button id="watch-autoplay" type="button">▶ Play</button><button id="watch-pause" type="button">Ⅱ Pause</button><button id="watch-resume" type="button">Resume</button>
        <label>Step event <select id="watch-step-event"><option value="mechanicalBeat">Mechanical beat</option><option value="quartzCycle">Quartz cycle</option><option value="motorCommand">Motor command</option><option value="softwareUpdate">Software update</option></select></label><button id="watch-step" type="button">Step</button>
        <label>Advance <input id="watch-duration-numerator" type="number" min="0" step="1" value="1" aria-label="Advance numerator"> / <input id="watch-duration-denominator" type="number" min="1" step="1" value="1" aria-label="Advance denominator"> s</label><button id="watch-advance" type="button">Advance</button><button id="watch-reset" type="button">Reset run</button><button id="watch-export-run" type="button">Export run JSON</button><button id="watch-new-run" type="button" title="Keep the previous bounded run in the one-run archive and begin a fresh run">Start new run</button><button id="watch-restore-archive" type="button" disabled>Restore archived run</button>
      </div>
      <div class="watch-status-row"><span id="watch-status" role="status">Paused at the initial state. Manual steps remain available.</span><span class="watch-time" id="watch-time"></span></div>
      <div class="watch-config"><div class="watch-rates"><b>Declared rates</b>${['mechanical','quartz','software'].map(model=>`<label>${model} Hz <input type="number" min="1" step="1" data-rate="${model}" value="${model==='mechanical'?4:model==='quartz'?32768:256}" aria-label="${model} frequency in hertz"><button type="button" data-apply-rate="${model}">Set</button></label>`).join('')}</div><div class="watch-energy"><b>Energy paths</b><label><input id="watch-energy-mainspring" type="checkbox" checked> Mainspring</label><label><input id="watch-energy-battery" type="checkbox" checked> Battery</label></div></div>
      <div class="watch-view-controls"><label>Explosion <input id="watch-explode" type="range" min="0" max="1" step="0.01" value="0"><output id="watch-explode-value">0%</output></label><label><input id="watch-energy-overlay" type="checkbox" checked> Energy paths</label><label><input id="watch-timing-overlay" type="checkbox" checked> Timing paths</label><button id="watch-measure-pacing" type="button">Summarize browser pacing</button><span id="watch-pacing-count">0 callback gaps retained (max ${MAX_PACING})</span></div>
      <div class="watch-grid" id="watch-model-grid"></div>
      <div class="watch-detail-grid"><section class="watch-card component-detail" aria-labelledby="watch-component-title"><div class="watch-card-heading"><div><p class="watch-kicker">SELECTED COMPONENT</p><h3 id="watch-component-title">Component detail</h3></div><span id="watch-component-model"></span></div><div id="watch-component-detail"></div></section><section class="watch-card" aria-labelledby="watch-inspector-title"><div class="watch-card-heading"><div><p class="watch-kicker">BOUNDED INSPECTOR</p><h3 id="watch-inspector-title">Counters & event microscope</h3></div></div><div id="watch-counters" class="watch-counter-grid"></div><details class="watch-microscope"><summary>Recent model events <span id="watch-event-count"></span></summary><div id="watch-trace" class="watch-trace"></div><div class="watch-microscope-tools"><label>Expand compact range <select id="watch-microscope"><option value="-1">Choose a range</option></select></label><label>Start at <input id="watch-microscope-offset" type="number" min="0" step="1" value="0" aria-label="Range page offset"></label><button id="watch-expand-range" type="button">Expand page of ${MAX_MICROSCOPE}</button><div id="watch-expanded-range" aria-live="polite"></div></div></details><details class="watch-microscope"><summary>Latest calculation trace</summary><div id="watch-calculation-trace" class="watch-trace"></div></details><details class="watch-microscope pacing"><summary>Browser callback pacing</summary><p>Scheduling observation only; this does not measure physical watch accuracy or control logical time.</p><div id="watch-pacing-summary" class="watch-counter-grid">No pacing samples yet. Play to collect actual callback gaps.</div></details></section></div>
      <p class="watch-footnote">Source-backed mechanism descriptions are shown separately from simulated values. Geometry is schematic. Hiding this tab freezes autoplay; returning does not resume it automatically. Keyboard: Space pause/resume, period step, R reset (when focus is outside an editor).</p>
    </section>`;
    panelRoot=container.querySelector('#watch-workbench');
    bindControls(panelRoot);
  }
  function bindControls(root) {
    const $=s=>root.querySelector(s);
    $('#watch-autoplay').addEventListener('click',()=>safe(()=>startAutoplay()));
    $('#watch-pause').addEventListener('click',()=>safe(()=>{stopAutoplay();apply({type:'pause'});}));
    $('#watch-resume').addEventListener('click',()=>safe(()=>apply({type:'resume'})));
    $('#watch-step').addEventListener('click',()=>safe(()=>apply({type:'step',event:$('#watch-step-event').value})));
    $('#watch-advance').addEventListener('click',()=>safe(()=>{const n=Number($('#watch-duration-numerator').value),d=Number($('#watch-duration-denominator').value);if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(d)||d<1){setStatus('Enter a non-negative integer numerator and positive integer denominator.',true);return;}apply({type:'advance',duration:{numerator:n,denominator:d},origin:'manual'});}));
    $('#watch-reset').addEventListener('click',()=>safe(()=>{stopAutoplay();apply({type:'reset'});pacing=[];pacingSummary=null;lastCallbackAt=null;render();}));
    $('#watch-export-run').addEventListener('click',()=>safe(exportRun));
    $('#watch-new-run').addEventListener('click',()=>safe(()=>{stopAutoplay();archivedState=clone(state);state=createWatchRun(state.config);pacing=[];pacingSummary=null;lastCallbackAt=null;render();setStatus('Fresh run created. The previous bounded state remains in the one-run archive.',true);}));
    $('#watch-restore-archive').addEventListener('click',()=>safe(()=>{if(!archivedState)return;const current=state;state=archivedState;archivedState=current;render();setStatus('Switched to the archived bounded run; the other run is now archived.',true);}));
    root.querySelectorAll('[data-apply-rate]').forEach(button=>button.addEventListener('click',()=>safe(()=>{const model=button.dataset.applyRate,input=root.querySelector(`[data-rate="${model}"]`),hz=Number(input.value);if(!Number.isSafeInteger(hz)||hz<1){setStatus('Rate must be a positive safe integer in hertz.',true);return;}apply({type:'rate',model,hz:{numerator:hz,denominator:1}});setStatus(`${model} rate changed to ${hz} Hz and recorded in this run.`,true);} )));
    $('#watch-energy-mainspring').addEventListener('change',e=>safe(()=>apply({type:'energy',source:'mainspring',enabled:e.target.checked})));
    $('#watch-energy-battery').addEventListener('change',e=>safe(()=>apply({type:'energy',source:'battery',enabled:e.target.checked})));
    $('#watch-explode').addEventListener('input',e=>{explode=Number(e.target.value);render();});
    $('#watch-energy-overlay').addEventListener('change',e=>{showEnergy=e.target.checked;render();});
    $('#watch-timing-overlay').addEventListener('change',e=>{showTiming=e.target.checked;render();});
    $('#watch-measure-pacing').addEventListener('click',summarizePacing);
    $('#watch-expand-range').addEventListener('click',expandSelectedRange);
    root.addEventListener('click',event=>{const part=event.target.closest('[data-part-id]');if(part){selected=part.dataset.partId;render();}});
    root.addEventListener('keydown',event=>{const part=event.target.closest('[data-part-id]');if(part&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selected=part.dataset.partId;render();}});
    document.addEventListener('visibilitychange',()=>{const hidden=document.hidden;stopAutoplay();safe(()=>apply({type:'visibility',hidden}));setStatus(hidden?'Hidden tab: autoplay frozen; it will not restart automatically.':'Tab visible. Autoplay remains stopped until you press Play.',true);});
    document.addEventListener('keydown',event=>{if(event.defaultPrevented||!panelRoot?.closest('.workspace')?.classList.contains('watches-active'))return;if(event.altKey||event.ctrlKey||event.metaKey)return;const target=event.target;if(target?.matches('input,textarea,select,button,[role="button"],[contenteditable="true"]')||target?.closest?.('[data-part-id]'))return;if(event.code==='Space'){event.preventDefault();if(timer!==null){stopAutoplay();safe(()=>apply({type:'pause'}));}else startAutoplay();}else if(event.key==='.')safe(()=>apply({type:'step',event:$('#watch-step-event').value}));else if(event.key.toLowerCase()==='r')safe(()=>{stopAutoplay();apply({type:'reset'});pacing=[];pacingSummary=null;lastCallbackAt=null;render();});});
  }
  function safe(operation){try{return operation();}catch(error){setStatus(`Action unavailable: ${error.message}`,true);return null;}}
  function expandSelectedRange() {
    const index=Number(panelRoot.querySelector('#watch-microscope').value);const event=(state.history?.events||[])[index];
    if(!event){panelRoot.querySelector('#watch-expanded-range').textContent='Select a compact counter range first.';return;}
    try { if(!expandCounterWindow)throw new Error('bounded range paging is unavailable');const offset=Number(panelRoot.querySelector('#watch-microscope-offset').value);if(!Number.isSafeInteger(offset)||offset<0)throw new Error('page offset must be a non-negative safe integer');const expanded=expandCounterWindow(state,event,{offset,count:Math.min(MAX_MICROSCOPE,event.end-event.start+1-offset),limit:MAX_MICROSCOPE});panelRoot.querySelector('#watch-expanded-range').textContent=JSON.stringify(expanded,null,2).slice(0,12000); }
    catch(error){panelRoot.querySelector('#watch-expanded-range').textContent=`Range was not expanded: ${error.message}`;}
  }
  function exportRun(){const payload=JSON.stringify({schema:'capability-lab.watch-export.v1',exportedAt:new Date().toISOString(),state},null,2);const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([payload],{type:'application/json'}));link.download=`watch-run-${state.history.session||'local'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);setStatus('Export initiated; the current run remains open.',true);}
  function svg(tag,attrs={},text='') {const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));if(text)node.textContent=text;return node;}
  function point(value) {if(Array.isArray(value))return{x:Number(value[0]),y:Number(value[1])};return{x:Number(value?.x??value?.[0]),y:Number(value?.y??value?.[1])};}
  function drawModel(host,model,geometry) {
    const watch=geometry.watches?.find(item=>item.id===model);if(!watch)return;
    const bounds=watch.bounds||{x:0,y:0,width:300,height:300};const vb=[bounds.x??bounds.minX??0,bounds.y??bounds.minY??0,bounds.width??((bounds.maxX??300)-(bounds.minX??0)),bounds.height??((bounds.maxY??300)-(bounds.minY??0))].join(' ');
    const card=document.createElement('article');card.className='watch-card watch-model-card';card.dataset.watchModel=model;
    const title=document.createElement('div');title.className='watch-card-heading';title.innerHTML=`<div><p class="watch-kicker">${model==='software'?'LOGICAL REFERENCE':'MECHANISM MODEL'}</p><h3>${esc(watch.title||model)}</h3></div><span class="model-rate" id="watch-rate-${model}"></span>`;card.append(title);
    const svgRoot=svg('svg',{viewBox:vb,role:'group','aria-label':`${watch.title||model} schematic; select a component`,'data-watch-model':model,class:'watch-model-svg'});
    const addPath=(path,kind)=>{for(const segment of path||[]){const find=id=>watch.parts?.find(p=>p.id===id);const a=typeof segment.from==='string'?point(find(segment.from)?.center):point(segment.from),b=typeof segment.to==='string'?point(find(segment.to)?.center):point(segment.to);if(!Number.isFinite(a.x)||!Number.isFinite(b.x))continue;const line=svg('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:`watch-path ${kind}-path`,'data-path-kind':kind});if(kind==='energy'?!showEnergy:!showTiming)line.setAttribute('hidden','');svgRoot.append(line);}};
    addPath(watch.energyPath,'energy');addPath(watch.timingPath,'timing');
    for(const part of watch.parts||[]){
      const def=partById.get(part.id);const group=svg('g',{class:`watch-part ${part.id===selected?'selected':''}`,tabindex:'0',role:'button','aria-label':def?.name||part.id,'data-part-id':part.id});
      const pts=part.points||[];if(pts.length){const attributes={points:pts.map(p=>{const v=point(p);return`${v.x},${v.y}`}).join(' '),class:`part-shape kind-${part.kind||'part'}`};group.append(svg(['coil','hairspring'].includes(part.kind)?'polyline':'polygon',attributes));}
      else {const c=point(part.center);group.append(svg('circle',{cx:c.x,cy:c.y,r:part.radius||10,class:`part-shape kind-${part.kind||'part'}`}));}
      for(const stroke of part.strokes||[]){if(Array.isArray(stroke)&&stroke.length>1)group.append(svg('polyline',{points:stroke.map(p=>{const v=point(p);return`${v.x},${v.y}`}).join(' '),class:'part-stroke'}));}
      if(part.label?.leader){const [a,b]=part.label.leader.map(point);group.append(svg('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'watch-leader'}));}
      const anchor=point(part.label?.anchor||part.center);const text=shortName(part.id,def?.name||part.id.split('.').at(-1));
      group.append(svg('text',{x:anchor.x,y:anchor.y,class:'part-label'},text));group.append(svg('title',{},def?.name||part.id));
      svgRoot.append(group);
    }
    card.append(svgRoot);
    const list=document.createElement('div');list.className='watch-part-list';for(const part of watch.parts||[]){const def=partById.get(part.id);const button=document.createElement('button');button.type='button';button.dataset.partId=part.id;button.textContent=def?.name||part.id;button.setAttribute('aria-pressed',String(part.id===selected));list.append(button);}card.append(list);
    host.append(card);
  }
  function shortName(id,name){const key=id.split('.').at(-1);const names={support:'plate',crown:'crown',barrel:'barrel',mainspring:'spring',goingTrain:'train',escapeWheel:'escape',palletFork:'pallet',balanceWheel:'balance',hairspring:'hair',secondHand:'sec',minuteHand:'min',hourHand:'hour',battery:'battery',crystal:'crystal',oscillator:'oscillator',divider:'divider',motorDriver:'driver',coil:'coil',rotor:'rotor',gears:'gears',logicalTime:'logical time',scheduler:'scheduler',updateCounter:'updates',renderer:'renderer'};return names[key]||name.slice(0,12);}
  function renderCounters() {
    const c=state.counters||{},r=state.rates||{},e=state.energy||{},h=state.history||{},limits=h.limits||{};
    const metrics=[['Mechanical beats',c.mechanicalBeats],['Quartz cycles',c.quartzCycles],['Motor commands',c.motorCommands],['Software updates',c.softwareUpdates],['Logical time',state.time],['Mainspring',e.mainspring],['Battery',e.battery],['Action history',`${h.actions?.length??0} / ${limits.maxActions??'—'}`],['History bytes',`${h.bytes??0} / ${limits.maxBytes??'—'}`],['Range expansion cap',limits.maxExpandEvents??'—']];
    panelRoot.querySelector('#watch-counters').innerHTML=metrics.map(([name,value])=>`<div class="watch-counter"><span>${esc(name)}</span><strong>${esc(fmt(value))}</strong></div>`).join('');
    panelRoot.querySelector('#watch-time').textContent=`Logical ${fmt(state.time)} s · mechanical display ${fmt(state.displayTime?.mechanical)} s · quartz display ${fmt(state.displayTime?.quartz)} s`;
    for(const m of ['mechanical','quartz','software']){const input=panelRoot.querySelector(`[data-rate="${m}"]`);if(document.activeElement!==input&&r[`${m}Hz`])input.value=typeof r[`${m}Hz`]==='object'?r[`${m}Hz`].numerator/r[`${m}Hz`].denominator:r[`${m}Hz`];panelRoot.querySelector(`#watch-rate-${m}`)?.replaceChildren(document.createTextNode(`${fmt(r[`${m}Hz`]??state.models?.[m]?.timingHz)} Hz`));}
    for(const [id,key] of [['watch-energy-mainspring','mainspring'],['watch-energy-battery','battery']]){const input=panelRoot.querySelector(`#${id}`);if(document.activeElement!==input)input.checked=Boolean(e[key]);}
    const events=Array.isArray(state.history?.events)?state.history.events:[];const shown=events.slice(-MAX_EVENTS);
    panelRoot.querySelector('#watch-event-count').textContent=`(${shown.length}/${events.length}; max ${MAX_EVENTS} shown)`;
    panelRoot.querySelector('#watch-trace').innerHTML=shown.map((event,i)=>`<details><summary>${esc(event.event||event.type||event.kind||'event')} · ${esc(event.model||'shared')} · ${esc(event.end!==undefined?`${event.start}–${event.end}`:event.count??'')}</summary><pre>${esc(JSON.stringify(event,null,2).slice(0,1600))}</pre></details>`).join('')||'<p>No events recorded yet. High-frequency ticks are retained as compact ranges.</p>';
    const select=panelRoot.querySelector('#watch-microscope'),previous=select.value,offset=events.length-shown.length;select.innerHTML='<option value="-1">Choose a range</option>'+shown.map((event,i)=>`<option value="${offset+i}">${esc(event.event||event.type||event.kind||'event')} · ${esc(event.model||'shared')} · ${esc(event.end!==undefined?`${event.start}–${event.end}`:event.count??'range')}</option>`).join('');if([...select.options].some(option=>option.value===previous))select.value=previous;else select.value='-1';
    const calls=state.calculationTrace?.calls||[];panelRoot.querySelector('#watch-calculation-trace').innerHTML=calls.slice(0,16).map(call=>`<details><summary>${esc(call.id||'calculation')} · ${esc(call.source||'local')} v${esc(call.version||'')}</summary><pre>${esc(JSON.stringify({input:call.input,result:call.result},null,2).slice(0,2200))}</pre></details>`).join('')||'<p>No calculation trace recorded yet.</p>';
    panelRoot.querySelector('#watch-restore-archive').disabled=!archivedState;
  }
  function renderComponent() {
    const detail=panelRoot.querySelector('#watch-component-detail'),title=panelRoot.querySelector('#watch-component-title'),model=panelRoot.querySelector('#watch-component-model');
    try {const item=describeWatchComponent(state,selected),source=sources.get(item.sourceId),geometryPart=currentGeometry?.watches?.flatMap(w=>w.parts||[]).find(part=>part.id===selected),motion=geometryPart?.motionSource;title.textContent=item.name;model.textContent=item.model.toUpperCase();detail.innerHTML=`<dl class="watch-facts"><div><dt>Current value</dt><dd>${esc(fmt(item.value))} ${esc(item.unit||'')}</dd></div><div><dt>Model role</dt><dd>${esc(item.role)} · source status ${esc(item.roleStatus)} · value status ${esc(item.valueStatus)}</dd></div><div><dt>State binding</dt><dd><code>${esc(item.statePath||'documented, not modeled')}</code></dd></div><div><dt>Formula / limit</dt><dd>${esc(item.formula||'No formula provided.')}</dd></div>${motion?`<div><dt>Illustrative motion mapping</dt><dd><code>${esc(motion.statePath)}</code> · ${esc(motion.formula)} · ${esc(motion.status)}</dd></div>`:''}${source?`<div><dt>Source supports</dt><dd>${esc(source.supports)}</dd></div><div><dt>Source boundary</dt><dd>${esc(source.limits)}</dd></div><div><dt>Reference</dt><dd><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.id)}</a></dd></div>`:''}</dl>`;}
    catch(error){title.textContent=selected;detail.textContent=`Component binding unavailable: ${error.message}`;}
  }
  function renderPacing(){const host=panelRoot?.querySelector('#watch-pacing-summary');if(!host)return;panelRoot.querySelector('#watch-pacing-count').textContent=`${pacing.length} callback gaps retained (max ${MAX_PACING})`;host.innerHTML=pacingSummary?(pacingSummary.error?`<p>${esc(pacingSummary.error)}</p>`:Object.entries(pacingSummary).filter(([,v])=>typeof v==='number').map(([k,v])=>`<div class="watch-counter"><span>${esc(k)}</span><strong>${esc(fmt(v))}${k==='mean'||k==='standardDeviation'?' ms':''}</strong></div>`).join('')):'At least two actual autoplay callback gaps are needed. Logical advance remains fixed at 1/10 s per callback.';}
  function render() {
    if(!panelRoot?.isConnected)return;
    const slider=panelRoot.querySelector('#watch-explode'),output=panelRoot.querySelector('#watch-explode-value'),percentage=`${Math.round(explode*100)}%`;
    slider.value=String(explode);output.value=percentage;output.textContent=percentage;
    const epoch=++renderEpoch,host=panelRoot.querySelector('#watch-model-grid');host.replaceChildren();
    let geometry;try{geometry=watchGeometry(state,explode,selected);currentGeometry=geometry;}catch(error){host.textContent=`Geometry unavailable: ${error.message}`;return;}
    for(const model of ['mechanical','quartz','software'])drawModel(host,model,geometry);
    renderCounters();renderComponent();renderPacing();
    if(epoch!==renderEpoch)return;
    const stateSnapshot=canonical(state);
    // View-only changes must leave state byte-for-byte canonical-equivalent.
    if(window.watchLab)window.watchLab.__lastRenderedState=stateSnapshot;
  }
  function renderPanel(container) { ensureMarkup(container); render(); }

  api.registerPanel({id:'watches',title:'Watches',render:renderPanel});
  window.watchLab={
    getState:()=>clone(state),
    applyAction:action=>apply(action),
    replay:()=>{const report=replayWatchRun(state.config,state.history?.actions||[]),replayed=report.state??report,stateCanonical=report.canonicalState??canonicalWatchJson(replayed),eventsCanonical=report.canonicalEvents??canonicalWatchJson(replayed.history?.events),exact=stateCanonical===canonicalWatchJson(state)&&eventsCanonical===canonicalWatchJson(state.history?.events);return{state:replayed,canonicalState:stateCanonical,canonicalEvents:eventsCanonical,exact,matches:exact};},
    getGeometry:(amount=explode,component=selected)=>watchGeometry(state,amount,component),
    getPacing:()=>({samples:pacing.slice(),count:pacing.length,limit:MAX_PACING,summary:clone(pacingSummary)}),
    setView:({explode:amount=explode,selected:component=selected,energy=showEnergy,timing=showTiming}={})=>{explode=Math.max(0,Math.min(1,Number(amount)||0));selected=partById.has(component)?component:selected;showEnergy=Boolean(energy);showTiming=Boolean(timing);if(panelRoot){panelRoot.querySelector('#watch-energy-overlay').checked=showEnergy;panelRoot.querySelector('#watch-timing-overlay').checked=showTiming;}render();return{state:clone(state),geometry:watchGeometry(state,explode,selected)};},
    startAutoplay,stopAutoplay,getArchivedState:()=>archivedState?clone(archivedState):null
  };
  document.addEventListener('capabilitylab:view',event=>{if(event.detail?.id==='watches'&&!event.detail.active){stopAutoplay();setStatus(`Autoplay stopped while viewing Foundations; watch state retained at logical ${fmt(state.time)} s.`,true);}});
  return window.watchLab;
}
