import config from './config.mjs';
import { openDemo, captureIdentity } from './model.mjs';
import { drawCompetition } from './competition-ui.mjs';
import { currentLayout, allCardStudies, defaultStudy, compositionSizeStudies, compositionScaleNudges, compositionOffsetNudges } from './graphics.mjs';
import { createMockMounts } from './local/mock-mounts.mjs';
import { localAddress } from './local/experience-mount.mjs';
import { archiveStorage } from './archive-storage.mjs';
import { esc } from './renderer/src/presentation.js';
import { pngFromSvg, sha256, downloadBlob } from './renderer/src/media.js';
import { Part } from './studio/part-first-kernel/src/pxc.mjs';
import { createExperience } from './studio/upload-disc-to-shelf/model.js';
import { defaultPresets, composeCard, composeOverlay, materializeOverlay } from './renderer/src/presentation.js';
import { createPartFirstHandler, createSceneHost } from './local/scene-host.mjs';
import { discStudioPhotoCardScene, installDiscStudioSceneCalculations } from './local/scenes/discstudio-photo-card.mjs';

const $=id=>document.getElementById(id),contexts=new Map();
const storageRoot=`pxcube.demo.v1:${config.id}`;
const mailbox='pxcube.demo.v1:handoff:creategraphics-to-exportgraphics';
const owner=createMockMounts({storage:localStorage,key:storageRoot+':mounts',seedIdentity:config.seedIdentity});
let previewBackground='scene';
const shelfHandoffKey='pxcube.demo.v1:handoff:your-shelf-to-on-course';
let shelfHandoff=null;
function readShelfHandoff(){try{const value=JSON.parse(localStorage.getItem(shelfHandoffKey)??'null');if(!value||value.version!==1||value.source!=='your-shelf'||(value.selectedDisc!==null&&typeof value.selectedDisc!=='string')||(value.bag!==null&&(typeof value.bag!=='object'||typeof value.bag.name!=='string'||!Array.isArray(value.bag.discIds)||!Array.isArray(value.bag.versions))))return null;return value;}catch{return null;}}
function shelfContextNote(){if(config.mode!=='course'||!shelfHandoff)return '';const bag=shelfHandoff.bag;return `<p class="notice">From Your Shelf · ${bag?`Bag “${esc(bag.name)}” · ${bag.discIds.length} exact copies`:'No bag selected'}${shelfHandoff.selectedDisc?' · current disc ready':''}</p>`;}
let active,model,result,query='',chosenCapture=null,busy=false,queue=Promise.resolve(),createStep='choose',studySelection=null;
let sceneWorlds=[],sceneWorldUrls=[];
const pretty=value=>JSON.stringify(value,(_key,item)=>typeof item==='function'?'[Calculation]':item,2);
const say=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'error':'';};
function run(action){queue=queue.then(async()=>{busy=true;try{await action();}catch(error){say(String(error),true);}finally{busy=false;}});return queue;}
function fixturePhotoDataUrl(bytes) {
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
async function composeSceneWorlds() {
  const button=$('scene-worlds-run'),status=$('scene-worlds-status'),results=$('scene-worlds-results');
  button.disabled=true;status.textContent='Composing…';results.replaceChildren();
  try {
    for(const url of sceneWorldUrls)URL.revokeObjectURL(url);sceneWorldUrls=[];
    await Promise.all(sceneWorlds.map(world=>world.close()));sceneWorlds=[];
    const response=await fetch('./assets/tee-shot-original.jpg');if(!response.ok)throw Error(`Photo fixture unavailable (${response.status}).`);
    const photo=fixturePhotoDataUrl(new Uint8Array(await response.arrayBuffer()));
    const handler=createPartFirstHandler({id:'discstudio-part-first',storeFor({id}){
      const experience=createExperience(()=>{});installDiscStudioSceneCalculations(experience,{Part,composeCard,composeOverlay,materializeOverlay});
      return {id,pxc:experience.pxc,sceneService:{save:experience.save.bind(experience)}};
    },storeOf:world=>world.pxc,serviceFor:(world,name)=>name==='discstudio.experience'?world.sceneService:undefined,
      makePart:value=>new Part(value),isPart:value=>value instanceof Part});
    const host=createSceneHost({handler}),scene=discStudioPhotoCardScene();
    const common=[
      {address:'ds.px.scene.photo-card-placement.photo-input',value:photo},
      {address:'ds.px.scene.photo-card-placement.preset',value:defaultPresets().spotlight},
      {address:'ds.px.scene.photo-card-placement.frame',value:null},
    ];
    for(const [id,placement] of [['baseline','bottom-left'],['candidate','bottom-right']]){
      sceneWorlds.push(await host.composeWorld({id,scenes:[scene],inputs:[...common,
        {address:'ds.px.scene.photo-card-placement.design',value:{orientation:'portrait',placement,scale:1}}]}));
    }
    for(const world of sceneWorlds){
      const report=world.scene('photo-card-placement'),graphic=await world.read(report.result.graphic),article=document.createElement('article');
      article.className='scene-world-card';const title=document.createElement('h3');title.textContent=`${world.id} · ${world.id==='baseline'?'bottom left':'bottom right'}`;
      const image=document.createElement('img');image.alt=`${world.id} rendered DiscStudio card and placement`;const url=URL.createObjectURL(new Blob([graphic.svg],{type:'image/svg+xml'}));sceneWorldUrls.push(url);image.src=url;
      const facts=document.createElement('p');facts.className='caption';facts.textContent=`${report.result.dimensions[0]} × ${report.result.dimensions[1]} · ${report.receipts.length} actual Calculation receipts · separate PxC world`;
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Inspect Parts and Calculation receipts';
      const pre=document.createElement('pre');pre.textContent=JSON.stringify({world:world.inspect(),scene:report},null,2);details.append(summary,pre);article.append(title,image,facts,details);results.append(article);
    }
    status.textContent='Two fresh worlds composed. Their source photo and native saved Disc use separate Part stores; only the placement design differs.';
  } catch(error){
    await Promise.all(sceneWorlds.map(world=>world.close().catch(()=>{})));sceneWorlds=[];
    status.textContent=`Stopped: ${error.message}`;
  } finally {button.disabled=false;}
}
const rows=()=>model.shelfForDisplay();
const art=row=>`<img src="${esc(row.art)}" alt="${esc(row.seed.manufacturer+' '+row.seed.name)}">`;
const facts=row=>`${esc(row.disc.plastic||'Plastic unknown')} · ${row.disc.weight===null?'Weight unknown':esc(row.disc.weight)+' g'}`;
function selectionCards(items,selection){return items.map(row=>`<button class="disc ${selection.includes(row.address)?'selected':''}" data-disc="${esc(row.address)}" aria-pressed="${selection.includes(row.address)}"><span class="check">${selection.includes(row.address)?'✓':'+'}</span><span class="art">${art(row)}</span><span class="maker">${esc(row.seed.manufacturer)}</span><h3>${esc(row.seed.name)}</h3><span class="facts">${facts(row)}</span></button>`).join('');}
function intro(title,description){return `<div class="intro"><span class="eyebrow">${config.mode==='bag'?'YOUR NEXT ROUND':config.mode==='export'?'ON THE COURSE':'ON THE COURSE · DISCSPOTLIGHT'}</span><h1>${title}</h1><p class="muted">${description}</p></div>`;}
function inspect(){return {mount:active.name,kind:active.inspect().kind,...model.inspect()};}
async function open(name){
  const next=owner.handle(name);
  if(next.inspect().seedIdentity!==config.seedIdentity)throw Error('The retained seed differs; migration requires review. Original data preserved.');
  if(!contexts.has(name))contexts.set(name,await openDemo(await archiveStorage(localStorage,`${storageRoot}:${name}:archive`)));
  active=next;
  model=contexts.get(name);query='';chosenCapture=null;
  shelfHandoff=readShelfHandoff();
  if(config.mode==='course'&&shelfHandoff?.selectedDisc){const shelfRows=model.experience.shelf();const selected=shelfRows.find(row=>row.address===shelfHandoff.selectedDisc||row.disc.id===shelfHandoff.selectedDisc);if(selected&&model.context.selectedDisc!==selected.address)await model.patch({selectedDisc:selected.address});}createStep='choose';
  $('mount').textContent=name+'.*';$('session').replaceChildren(...owner.list().map(item=>new Option(item.kind==='interactive'?'Interactive · resume':`Test ${item.iteration}`,item.name)));$('session').value=name;
  await draw();say(active.inspect().kind==='test'?'Fresh numbered sandbox · changes stay in this run.':'Ready · saved changes stay in this sandbox.');
}
function courseTabs(active){return `<nav class="course-tabs" aria-label="On Course views"><button id="course-create" aria-pressed="${active==='create'}">Create graphics</button><button id="course-export" aria-pressed="${active==='export'}">Export graphics</button></nav>`;}
let courseView='create';
async function draw(){
  if(config.mode==='bag')await drawBag();
  else if(config.mode==='create')await drawCreate();
  else if(config.mode==='course'){if(courseView==='create')await drawCreate();else await drawExport();}
  else await drawExport();
}
async function drawBag(){
  const context=model.context,view=await model.queryShelf({query}),all=await rows();
  const visibleRows=view.groups.flatMap(group=>group.rows.map(row=>all.find(candidate=>candidate.address===row.address)));
  const selected=context.selection.map(address=>{const row=all.find(row=>row.address===address);if(!row)throw Error('Selected copy no longer exists.');return row;});
  $('app').innerHTML=intro('What are you carrying?','Choose the exact copies, arrange your lineup, then keep a named bag.')+`<div class="workspace"><aside class="panel"><h2>Find a disc</h2><form id="search-form"><label>Manufacturer, mold or plastic<input id="query" value="${esc(query)}" placeholder="Buzzz · ESP"></label><button class="full">Search</button></form><button id="clear-search" class="full">Show all</button><p class="notice">Eight seeded specimens, three existing painters. Your Upload and Shelf sandboxes stay separate.</p><span class="pill">${view.shown} of ${view.total} copies</span></aside><section class="panel"><h2>Your available copies</h2><div class="grid">${selectionCards(visibleRows,context.selection)||'<p class="empty">No matches. Try another mold or clear the search.</p>'}</div></section><aside class="panel"><h2>Your bag · ${selected.length}</h2><ol class="selection">${selected.map((row,i)=>`<li><span class="art">${art(row)}</span><div><strong>${esc(row.seed.name)}</strong><br><small>${facts(row)}</small><div class="controls"><button data-up="${i}" aria-label="Move ${esc(row.seed.name)} up" ${i===0?'disabled':''}>↑</button><button data-down="${i}" aria-label="Move ${esc(row.seed.name)} down" ${i===selected.length-1?'disabled':''}>↓</button><button data-remove="${i}" aria-label="Remove ${esc(row.seed.name)}">Remove</button></div></div></li>`).join('')||'<li>Choose a copy to start.</li>'}</ol><form id="bag-form"><label>Bag name<input id="draft-name" value="${esc(context.name)}" placeholder="Windy afternoon" required maxlength="80"></label><button class="primary full" id="create-bag" ${selected.length?'':'disabled'}>Create bag</button></form><button id="save-draft" class="full">Save draft</button><div class="saved"><h3>Saved bags</h3>${model.experience.bags().map(({address,bag})=>`<button data-bag="${esc(address)}"><strong>${esc(bag.name)}</strong><br><small>${bag.discIds.length} exact copies · open</small></button>`).join('')||'<small>No saved bags yet.</small>'}</div></aside></div>`;
  $('search-form').onsubmit=event=>{event.preventDefault();query=$('query').value;run(drawBag);};
  $('clear-search').onclick=()=>run(async()=>{query='';await drawBag();});
  const edit=async(selection)=>{await model.patch({selection,name:$('draft-name').value});await drawBag();};
  document.querySelectorAll('[data-disc]').forEach(button=>button.onclick=()=>run(async()=>{const a=button.dataset.disc,selection=model.context.selection;await edit(selection.includes(a)?selection.filter(x=>x!==a):[...selection,a]);}));
  document.querySelectorAll('[data-up],[data-down],[data-remove]').forEach(button=>button.onclick=()=>run(async()=>{
    const selection=[...model.context.selection],key=Object.hasOwn(button.dataset,'up')?'up':Object.hasOwn(button.dataset,'down')?'down':'remove',i=Number(button.dataset[key]);
    if(key==='remove'){selection.splice(i,1);await edit(selection);}else await edit(await model.reorder(i,i+(key==='up'?-1:1)));
  }));
  $('save-draft').onclick=()=>{const name=$('draft-name').value;run(async()=>{await model.patch({name});say('Draft saved · no Bag created.');});};
  $('bag-form').onsubmit=event=>{event.preventDefault();const button=$('create-bag');if(button.disabled)return;button.disabled=true;const name=$('draft-name').value;run(async()=>{try{await model.patch({name});const address=await model.createBag();await drawBag();say(`Saved “${name.trim()}” · ${model.value(address).discIds.length} exact copies. Reopen it below or reload.`);}finally{button.disabled=false;}});};
  document.querySelectorAll('[data-bag]').forEach(button=>button.onclick=()=>run(async()=>{const bag=model.value(button.dataset.bag);await model.patch({name:bag.name,selection:bag.versions.map(v=>v.address)});await drawBag();say(`Opened “${bag.name}”. Creating again keeps a new bag; the saved one stays unchanged.`);}));
}
function graphicPreview(graphic){
  const content=graphic?.svg??'<p class="empty">Your next exported graphic goes here.<br>Import a kept version or try the seeded example.</p>';
  return `<div id="preview" class="preview ${graphic&&previewBackground==='scene'?'preview-scene':''}">${content}</div>${graphic?`<label class="preview-setting">Preview background<select id="preview-background"><option value="scene" ${previewBackground==='scene'?'selected':''}>Newspaper tee shot</option><option value="grid" ${previewBackground==='grid'?'selected':''}>Transparency grid</option></select><span>Illustrative background — not to scale. Graphic dimensions are exact. Photo: <a href="https://commons.wikimedia.org/wiki/File:DSC_5610_(4526926931).jpg" target="_blank" rel="noopener noreferrer">bradleypjohnson</a> · <a href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noopener noreferrer">CC BY 2.0</a> · newsprint treatment · preview only</span></label>`:''}`;
}
function bindPreview(){
  const select=$('preview-background');
  if(select)select.onchange=()=>{previewBackground=select.value;$('preview').classList.toggle('preview-scene',previewBackground==='scene');};
}
async function drawCreate(){
  if(config.mode==='course')queueMicrotask(()=>{ $('course-create').onclick=()=>run(async()=>{courseView='create';await draw();}); $('course-export').onclick=()=>run(async()=>{courseView='export';await draw();}); });
  const competition=model.context.graphicsPurpose==='competition';
  $('app').innerHTML=(config.mode==='course'?courseTabs('create'):'')+`<nav class="purpose-tabs" aria-label="Graphic purpose"><button id="purpose-spotlight" aria-pressed="${!competition}">DiscSpotlight</button><button id="purpose-competition" aria-pressed="${competition}">DiscCompetition</button></nav><div id="competition-body"></div>`;
  for(const [id,purpose] of [['purpose-spotlight','spotlight'],['purpose-competition','competition']])$(id).onclick=()=>run(async()=>{await model.patch({graphicsPurpose:purpose});await drawCreate();});
  if(competition)return drawCompetition({model,run,say,preview:graphicPreview,bindPreview,redraw:drawCreate,publish:{mount:()=>active.name,offer:offerCapture,order:offerOrder}});
  await drawSpotlight();
}
async function offerCapture(capture){
  if(active.inspect().kind!=='interactive')return;
  const offers=JSON.parse(localStorage.getItem(mailbox)??'[]');
  if(!offers.some(c=>captureIdentity(c)===captureIdentity(capture)))localStorage.setItem(mailbox,JSON.stringify([...offers,capture]));
}
async function offerOrder(captures){
  if(active.inspect().kind!=='interactive')return;
  const offers=JSON.parse(localStorage.getItem(mailbox)??'[]'),ids=new Set(captures.map(captureIdentity));let index=0;
  localStorage.setItem(mailbox,JSON.stringify(offers.map(c=>ids.has(captureIdentity(c))?captures[index++]:c)));
}
async function drawSpotlightLegacy(){
  const context=model.context,design=context.design;
  result=await model.render(context.selectedDisc,design);
  const all=await rows(),selected=all.find(row=>row.address===context.selectedDisc);
  $('competition-body').innerHTML=intro('Give this disc a corner.','Choose a real composition, verify it over the video, then keep the exact graphic.')+`<nav class="mobile-step-nav" role="tablist" aria-label="Create graphic steps"><button type="button" role="tab" data-create-step="choose" aria-selected="${createStep==='choose'}" aria-expanded="${createStep==='choose'}">01 · Choose</button><button type="button" role="tab" data-create-step="verify" aria-selected="${createStep==='verify'}" aria-expanded="${createStep==='verify'}">02 · Verify</button><button type="button" role="tab" data-create-step="finish" aria-selected="${createStep==='finish'}" aria-expanded="${createStep==='finish'}">03 · Finish</button></nav><div class="workspace two create-workspace"><aside class="panel create-material" data-create-panel="choose" role="tabpanel"><div class="step-kicker">01 · choose</div><h2>Choose the material</h2><button id="compare-cards" class="full primary">Compare 9 compositions</button><p class="choice-summary"><strong>${esc(allCardStudies.find(item=>item.id===(design.study??defaultStudy)).name)}</strong><br><small>Current composition</small></p><label>Physical copy<select id="graphic-disc">${all.map(row=>`<option value="${esc(row.address)}" ${row.address===context.selectedDisc?'selected':''}>${esc(row.seed.manufacturer+' · '+row.seed.name+' · '+row.disc.plastic+' · '+row.disc.weight+' g')}</option>`).join('')}</select></label><div class="material-art"><div class="art">${art(selected)}</div></div><p class="notice">The retained disc and renderer stay intact. You’re only shaping this graphic.</p><details class="create-geometry" open><summary>Composition geometry · exact</summary><div class="geometry-grid"><label>Anchor<select id="placement">${[['bottom-left','Bottom left'],['bottom-center','Bottom center · lower third'],['bottom-right','Bottom right'],['top-left','Top left'],['top-right','Top right']].map(([v,label])=>`<option value="${v}" ${v===(design.placement??'bottom-left')?'selected':''}>${label}</option>`).join('')}</select></label><label>Width preset<select id="composition-size">${compositionSizeStudies.map(item=>`<option value="${item.id}" ${item.id===(design.compositionSize??'balanced')?'selected':''}>${item.name}</option>`).join('')}</select></label><label>Scale nudge<select id="composition-scale-nudge">${compositionScaleNudges.map(value=>`<option value="${value}" ${Number(value)===(Number(design.compositionScaleNudge)||0)?'selected':''}>${value>0?'+':''}${value}%</option>`).join('')}</select></label><label>X offset<select id="composition-offset-x">${compositionOffsetNudges.map(value=>`<option value="${value}" ${Number(value)===(Number(design.compositionOffsetX)||0)?'selected':''}>${value>0?'+':''}${value} px</option>`).join('')}</select></label><label>Y offset<select id="composition-offset-y">${compositionOffsetNudges.map(value=>`<option value="${value}" ${Number(value)===(Number(design.compositionOffsetY)||0)?'selected':''}>${value>0?'+':''}${value} px</option>`).join('')}</select></label></div><p class="caption geometry-help">Assisted preset first; exact percentage and export-pixel nudges stay reversible until Keep.</p></details><details class="create-advanced"><summary>Canvas</summary><div class="advanced-grid"><label>Canvas<select id="orientation"><option value="landscape" ${design.orientation==='landscape'?'selected':''}>Landscape · 1920 × 1080</option><option value="portrait" ${design.orientation==='portrait'?'selected':''}>Portrait · 1080 × 1920</option></select></label><label>Canvas background<select id="frame"><option value="filled" ${design.frame==='filled'?'selected':''}>Solid background</option><option value="none" ${design.frame==='none'?'selected':''}>Transparent overlay</option></select></label></div></details></aside><section class="create-preview" data-create-panel="verify" role="tabpanel"><div class="step-kicker">02 · verify</div>${graphicPreview(result.graphic)}<p class="caption">${result.graphic.width} × ${result.graphic.height} · actual rendered SVG · ${design.frame==='none'?'transparent canvas · preview background will not export':'solid canvas background'} · ${esc((design.placement??'bottom-left').replaceAll('-',' '))} · ${esc(design.compositionSize??'balanced')} · ${Number(design.compositionScaleNudge)||0}% · X ${Number(design.compositionOffsetX)||0} / Y ${Number(design.compositionOffsetY)||0} px</p></section><aside class="panel create-finish" data-create-panel="finish" role="tabpanel"><div class="step-kicker">03 · finish</div><h2>Make it yours</h2><label>Title<input id="graphic-title" maxlength="80" value="${esc(design.title)}" placeholder="On the course"></label><div class="color-grid"><label>Accent<input id="accent" type="color" value="${design.accent}"></label><label>Background<input id="background" type="color" value="${design.background}"></label><label>Text<input id="foreground" type="color" value="${design.foreground}"></label></div><button id="keep-graphic" class="primary full">Keep for ExportGraphics</button><p class="caption">Keeps this exact graphic. Live edits stay reversible until you keep it.</p><h3>${context.graphics.length} kept versions</h3><div class="saved">${context.graphics.map(address=>{const c=model.value(address);return `<button data-version="${esc(address)}">${esc(c.title)}<br><small>${c.graphic.width} × ${c.graphic.height} · ${c.hash.slice(0,8)}</small></button>`;}).join('')}</div></aside></div>`;
  const applyCreateStep=step=>{createStep=['choose','verify','finish'].includes(step)?step:'choose';document.querySelectorAll('[data-create-step]').forEach(button=>{const selected=button.dataset.createStep===createStep;button.setAttribute('aria-selected',String(selected));button.setAttribute('aria-expanded',String(selected));button.setAttribute('aria-controls',`create-panel-${button.dataset.createStep}`);});document.querySelectorAll('[data-create-panel]').forEach(panel=>{const selected=panel.dataset.createPanel===createStep;panel.classList.toggle('is-active',selected);panel.id=`create-panel-${panel.dataset.createPanel}`;panel.setAttribute('aria-hidden',String(!selected));});};
  document.querySelectorAll('[data-create-step]').forEach(button=>button.onclick=()=>applyCreateStep(button.dataset.createStep));
  applyCreateStep(createStep);
  bindPreview();
  $('compare-cards').onclick=()=>run(async()=>{
    say('Composing nine directions from this disc…');
    const candidates=await model.studyCards();
    studySelection=model.context.design.study??defaultStudy;
    const renderStudySelection=()=>{const study=allCardStudies.find(item=>item.id===studySelection);$('study-cards').querySelectorAll('[data-study]').forEach(button=>{const selected=button.dataset.study===studySelection;button.setAttribute('aria-pressed',String(selected));const preview=candidates.find(item=>item.study.id===button.dataset.study);if(preview)button.querySelector('.study-choice').textContent=`${preview.graphic.width} × ${preview.graphic.height} · ${selected?'Selected':'Select this layout'}`;});if(study)$('study-detail-copy').textContent=`${study.name}: ${study.note}`;};
    $('study-cards').innerHTML=candidates.map(({study,graphic},i)=>`<button type="button" class="study-card" data-study="${esc(study.id)}" aria-label="Use ${esc(study.name)}. ${esc(study.note)}" aria-pressed="${study.id===studySelection}"><span class="study-name">${i+1} · ${esc(study.name)}</span><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(graphic.svg)}" alt="${esc(study.name)} card"><span class="study-choice">${graphic.width} × ${graphic.height} · ${study.id===studySelection?'Selected':'Select this layout'}</span></button>`).join('');
    renderStudySelection();
    $('study-cards').querySelectorAll('[data-study]').forEach(button=>{button.onfocus=()=>{studySelection=button.dataset.study;renderStudySelection();};button.onclick=()=>{studySelection=button.dataset.study;renderStudySelection();};});
    $('use-study').onclick=()=>run(async()=>{const nextStudy=allCardStudies.find(item=>item.id===studySelection);if(!nextStudy)return;await model.patch({design:{...model.context.design,study:nextStudy.id,...(nextStudy?.preferredSize?{compositionSize:nextStudy.preferredSize}:{})}});createStep='verify';$('card-study').close();await drawCreate();say(`Trying ${nextStudy.name}. Keep it when you like it.`);});
    $('card-study').showModal();
    say('Nine compositions ready. Choose a silhouette and try it over the video.');
  });
  $('graphic-disc').onchange=()=>{const selectedDisc=$('graphic-disc').value;run(async()=>{await model.patch({selectedDisc});await drawCreate();});};
  for(const id of ['orientation','frame','placement','composition-size','composition-scale-nudge','composition-offset-x','composition-offset-y','accent','background','foreground','graphic-title'])$(id).onchange=()=>{const key=id==='graphic-title'?'title':id==='composition-size'?'compositionSize':id==='composition-scale-nudge'?'compositionScaleNudge':id==='composition-offset-x'?'compositionOffsetX':id==='composition-offset-y'?'compositionOffsetY':id,next=$(id).value;run(async()=>{await model.patch({design:{...model.context.design,[key]:['compositionScaleNudge','compositionOffsetX','compositionOffsetY'].includes(key)?Number(next):next}});await drawCreate();});};
  $('keep-graphic').onclick=()=>{const chosen=result;run(async()=>{
    const kept=await model.capture(chosen,active.name);
    if(active.inspect().kind==='interactive') {
      const offers=JSON.parse(localStorage.getItem(mailbox)??'[]');
      if(!offers.some(c=>captureIdentity(c)===captureIdentity(kept.capture)))localStorage.setItem(mailbox,JSON.stringify([...offers,kept.capture]));
      say('Kept. Open ExportGraphics in the Experience list and import your kept graphics.');
    } else say('Kept in this numbered test only; nothing was sent to your interactive export sandbox.');
    await drawCreate();
  });};
  document.querySelectorAll('[data-version]').forEach(button=>button.onclick=()=>run(async()=>{const capture=model.value(button.dataset.version);if(capture.competition){await model.patch({graphicsPurpose:'competition',competitionAddress:capture.source.material,design:capture.design});await drawCreate();return;}await model.patch({selectedDisc:capture.source.disc,design:{...capture.design,layout:currentLayout,placement:capture.design.placement??'bottom-left',frame:capture.design.layout?capture.design.frame:'none'}});await drawCreate();say('Reopened that kept design. Its original capture stays unchanged.');}));
}
async function drawSpotlight(){
  await drawSpotlightLegacy();
  const verify=document.querySelector('[data-create-panel="verify"]'),geometry=document.querySelector('.create-geometry'),grid=geometry?.querySelector('.geometry-grid');
  if(!verify||!geometry||!grid)return;
  const size=$('composition-size'),nudge=$('composition-scale-nudge'),sizeDetails=document.createElement('details');
  sizeDetails.className='verify-size';
  sizeDetails.open=true;
  sizeDetails.innerHTML='<summary>Size · exact export pixels</summary><div class="geometry-grid"></div><p class="caption geometry-help">Preferred 640 × 270 · hard maximum 768 × 324 · exact nudges stay reversible until Keep.</p>';
  const verifyGrid=sizeDetails.querySelector('.geometry-grid');
  if(size)verifyGrid.append(size.parentElement);
  if(nudge)verifyGrid.append(nudge.parentElement);
  verify.insertBefore(sizeDetails,verify.querySelector('.caption'));
  const caption=verify.querySelector(':scope > .caption'),bounds=result?.graphic?.bounds;
  if(caption&&result?.graphic){
    const width=Math.round(Number(bounds?.width)||0),height=Math.round(Number(bounds?.height)||0);
    caption.textContent=`${result.graphic.width} × ${result.graphic.height} · actual rendered SVG · composed footprint ${width} × ${height} export px · Illustrative background — not to scale. Graphic dimensions are exact. · ${designFrameLabel(model.context.design)} · ${String(model.context.design.placement??'bottom-left').replaceAll('-',' ')} · ${model.context.design.compositionSize??'balanced'} · ${Number(model.context.design.compositionScaleNudge)||0}% · X ${Number(model.context.design.compositionOffsetX)||0} / Y ${Number(model.context.design.compositionOffsetY)||0} px`;
  }
}
function designFrameLabel(design){
  return design.frame==='none'?'transparent canvas · preview background will not export':'solid canvas background';
}
function exportFilename(capture,address,format,outputHash=null){
  const index=String(model.context.graphics.indexOf(address)+1).padStart(3,'0');
  const slug=capture.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'graphic';
  const hash=outputHash??(format==='svg'?capture.hash.slice(0,8):'output-hash');
  return `${index}-discstudio-${slug}-${capture.graphic.width}x${capture.graphic.height}-${hash}.${format}`;
}
async function drawExportPolished(){
  if(config.mode==='course')queueMicrotask(()=>{ $('course-create').onclick=()=>run(async()=>{courseView='create';await draw();}); $('course-export').onclick=()=>run(async()=>{courseView='export';await draw();}); });
  const context=model.context,addresses=context.graphics;
  if(!addresses.includes(chosenCapture))chosenCapture=addresses.at(-1)??null;
  const capture=chosenCapture?model.value(chosenCapture):null,index=addresses.indexOf(chosenCapture);
  const title=capture?.title??'No kept graphic selected';
  const filename=capture?exportFilename(capture,chosenCapture,'png'):'';
  const recent=context.exports.at(-1)?model.value(context.exports.at(-1)):null;
  $('app').innerHTML=intro('Export the graphic.','Choose one kept image, verify its exact facts, then make one explicit download.')+`<div class="workspace two export-workspace ${capture?'has-capture':''}"><aside class="panel export-queue"><div class="step-kicker">01 · choose</div><h2>Kept graphics</h2><button id="import-kept" class="primary full" ${active.inspect().kind==='test'?'disabled':''}>Import from CreateGraphics</button><button id="load-example" class="full">Make a new example</button><p class="caption">Each entry is an immutable capture. Previous and next keep this export setup in place.</p><div class="export-count">${addresses.length} kept · ${capture?`${index+1} of ${addresses.length}`:'choose one'}</div><div class="saved export-list">${addresses.map((address,i)=>{const c=model.value(address);return `<button data-capture="${esc(address)}" class="${address===chosenCapture?'selected':''}" aria-pressed="${address===chosenCapture}">${i+1}. ${esc(c.title)}<br><small>${c.graphic.width} × ${c.graphic.height} · ${c.hash.slice(0,8)}</small></button>`;}).join('')||'<small>No kept graphics yet.</small>'}</div></aside><section class="export-preview"><div class="step-kicker">02 · verify</div>${graphicPreview(capture?.graphic)}${capture?`<div class="export-facts"><strong>${esc(title)}</strong><span>${capture.graphic.width} × ${capture.graphic.height}</span><span>${capture.design.frame==='none'?'Transparent overlay':'Filled background'}</span><span>Capture SHA-256 · <code>${esc(capture.hash.slice(0,16))}…</code></span></div>`:'<p class="empty">Keep a graphic in CreateGraphics, then return here to export it.</p>'}</section><aside class="panel export-finish"><div class="step-kicker">03 · export</div><h2>Download this image</h2>${capture?`<p class="export-title"><strong>${esc(title)}</strong><br><small>Capture ${index+1} of ${addresses.length} · immutable source</small></p><div class="export-nav"><button id="previous-capture" ${index<=0?'disabled':''}>← Previous</button><button id="next-capture" ${index>=addresses.length-1?'disabled':''}>Next →</button></div><label>Format<select id="format"><option value="png">PNG · image (recommended)</option><option value="svg">SVG · editable vector</option></select></label><div class="export-facts export-output"><span>Dimensions · ${capture.graphic.width} × ${capture.graphic.height}</span><span>Filename · <code id="filename-preview">${esc(filename)}</code></span><span>Source hash · <code>${esc(capture.hash.slice(0,16))}…</code></span><span id="output-hash">Output hash · calculated on download</span></div><button id="download" class="primary full">Download graphic</button><p class="caption">This asks the browser to download the bytes. The capture remains unchanged; the browser decides where the file is saved.</p>`:'<p class="empty">No export controls until a kept graphic is selected.</p>'}${recent?`<details class="export-result"><summary>Last export result</summary><p><strong>${esc(recent.status)}</strong><br>${esc((recent.format??'').toUpperCase())} · ${recent.byteLength??0} bytes<br><code>${esc(recent.hash??recent.error??'')}</code></p></details>`:''}</aside></div>`;
  bindPreview();
  const format=$('format');
  if(format){
    const updateFilename=()=>{$('filename-preview').textContent=exportFilename(capture,chosenCapture,format.value);};
    format.onchange=updateFilename;
    $('previous-capture').onclick=()=>run(async()=>{chosenCapture=addresses[index-1];await drawExportPolished();});
    $('next-capture').onclick=()=>run(async()=>{chosenCapture=addresses[index+1];await drawExportPolished();});
    $('download').onclick=()=>{const selected=capture,address=chosenCapture,kind=format.value;run(async()=>{
      let record;
      try {
        const blob=kind==='png'?await pngFromSvg(selected.graphic.svg,selected.graphic.width,selected.graphic.height):new Blob([selected.graphic.svg],{type:'image/svg+xml'});
        const hash=await sha256(blob),filename=exportFilename(selected,address,kind,hash.slice(0,8));
        record={status:'Bytes ready · download requested',capture:address,svgHash:selected.hash,format:kind,width:selected.graphic.width,height:selected.graphic.height,byteLength:blob.size,hash,filename};
        downloadBlob(blob,filename);await model.recordExport(record);say(`${kind.toUpperCase()} ready · ${blob.size.toLocaleString()} bytes. Download requested; your browser handles saving.`);
      } catch(error){await model.recordExport({status:'Failed',capture:address,svgHash:selected.hash,format:kind,error:String(error)});throw error;}
      finally{await drawExportPolished();}
    });};
  }
  $('import-kept').onclick=()=>run(async()=>{let count=0;for(const offer of JSON.parse(localStorage.getItem(mailbox)??'[]'))if(await model.importCapture(offer)){count++;chosenCapture=model.context.graphics.at(-1);}const offers=JSON.parse(localStorage.getItem(mailbox)??'[]'),rank=new Map(offers.map((c,i)=>[captureIdentity(c),i]));const ordered=model.context.graphics.filter(a=>rank.has(captureIdentity(model.value(a)))).sort((a,b)=>rank.get(captureIdentity(model.value(a)))-rank.get(captureIdentity(model.value(b))));let i=0;await model.patch({graphics:model.context.graphics.map(a=>rank.has(captureIdentity(model.value(a)))?ordered[i++]:a)});await drawExportPolished();say(`${count} new captured graphic${count===1?'':'s'} imported. Existing versions preserved.`);});
  $('load-example').onclick=()=>run(async()=>{const graphic=await model.render(model.context.selectedDisc,model.context.design);const kept=await model.capture(graphic,active.name);chosenCapture=kept.address;await drawExportPolished();say('Seeded Spotlight example · produced through the same card Calculations.');});
  document.querySelectorAll('[data-capture]').forEach(button=>button.onclick=()=>run(async()=>{chosenCapture=button.dataset.capture;await drawExportPolished();}));
}
async function drawExport(){return drawExportPolished();
  const context=model.context,addresses=context.graphics;
  if(!addresses.includes(chosenCapture))chosenCapture=addresses.at(-1)??null;
  const capture=chosenCapture?model.value(chosenCapture):null;
  $('app').innerHTML=(config.mode==='course'?courseTabs('export'):'')+intro('Take the graphic with you.',shelfContextNote()+'Inspect the captured version, then download those pixels or their SVG source.')+`<div class="workspace two"><aside class="panel"><h2>Kept graphics</h2><button id="import-kept" class="primary full" ${active.inspect().kind==='test'?'disabled':''}>Import from CreateGraphics</button><button id="load-example" class="full">Make a new example</button><p class="caption">Kept graphics are snapshots. To see the current layout, import a new version or make a new example.</p><div class="saved">${addresses.map((address,i)=>{const c=model.value(address);return `<button data-capture="${esc(address)}" class="${address===chosenCapture?'selected':''}">${i+1}. ${esc(c.title)}<br><small>${c.graphic.width} × ${c.graphic.height} · ${c.hash.slice(0,8)}</small></button>`;}).join('')}</div></aside><section>${graphicPreview(capture?.graphic)}<p class="caption">${capture&&capture.design.layout!==currentLayout?'Earlier layout · retained snapshot. ':''}${capture?`${capture.graphic.width} × ${capture.graphic.height} · captured ${esc(capture.design.frame==='none'?'transparent overlay':'filled background')}`:'No graphic selected.'}</p></section><aside class="panel"><h2>Export image ${addresses.indexOf(chosenCapture)+1} of ${addresses.length}</h2><div class="controls"><button id="previous-capture" ${addresses.indexOf(chosenCapture)<=0?'disabled':''}>← Previous</button><button id="next-capture" ${addresses.indexOf(chosenCapture)>=addresses.length-1?'disabled':''}>Next image →</button></div>${capture?`<p><strong>${esc(capture.title)}</strong><br><small>SHA-256 · ${capture.hash.slice(0,16)}…</small></p>`:''}<label>Format<select id="format"><option value="png">PNG · image</option><option value="svg">SVG · editable vector</option></select></label><button id="download" class="primary full" ${capture?'':'disabled'}>Download graphic</button><p class="caption">Uses this capture. PNG is rasterized by this browser at the dimensions above.</p><h3>Export results</h3><div class="history">${context.exports.slice().reverse().map(address=>{const r=model.value(address);return `<article><strong>${esc(r.status)}</strong><br>${esc(r.format.toUpperCase())} · ${r.byteLength??0} bytes<br>${esc(r.filename??r.error)}<br><code>${esc(r.hash??'')}</code></article>`;}).join('')||'<small>No exports yet.</small>'}</div></aside></div>`;
  bindPreview();
  $('previous-capture').onclick=()=>run(async()=>{chosenCapture=addresses[addresses.indexOf(chosenCapture)-1];await drawExport();});
  $('next-capture').onclick=()=>run(async()=>{chosenCapture=addresses[addresses.indexOf(chosenCapture)+1];await drawExport();});
  $('import-kept').onclick=()=>run(async()=>{let count=0;for(const offer of JSON.parse(localStorage.getItem(mailbox)??'[]'))if(await model.importCapture(offer)){count++;chosenCapture=model.context.graphics.at(-1);}const offers=JSON.parse(localStorage.getItem(mailbox)??'[]'),rank=new Map(offers.map((c,i)=>[captureIdentity(c),i]));const ordered=model.context.graphics.filter(a=>rank.has(captureIdentity(model.value(a)))).sort((a,b)=>rank.get(captureIdentity(model.value(a)))-rank.get(captureIdentity(model.value(b))));let i=0;await model.patch({graphics:model.context.graphics.map(a=>rank.has(captureIdentity(model.value(a)))?ordered[i++]:a)});await drawExport();say(`${count} new captured graphic${count===1?'':'s'} imported. Existing versions preserved.`);});
  $('load-example').onclick=()=>run(async()=>{const graphic=await model.render(model.context.selectedDisc,model.context.design);const kept=await model.capture(graphic,active.name);chosenCapture=kept.address;await drawExport();say('Seeded Spotlight example · produced through the same card Calculations.');});
  document.querySelectorAll('[data-capture]').forEach(button=>button.onclick=()=>run(async()=>{chosenCapture=button.dataset.capture;await drawExport();}));
  $('download').onclick=()=>{const selected=capture,address=chosenCapture,format=$('format').value;run(async()=>{
    let record;
    try {
      const blob=format==='png'?await pngFromSvg(selected.graphic.svg,selected.graphic.width,selected.graphic.height):new Blob([selected.graphic.svg],{type:'image/svg+xml'});
      const hash=await sha256(blob),filename=`${String(addresses.indexOf(address)+1).padStart(3,'0')}-discstudio-${selected.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${selected.graphic.width}x${selected.graphic.height}-${hash.slice(0,8)}.${format}`;
      record={status:'Bytes ready · download requested',capture:address,svgHash:selected.hash,format,width:selected.graphic.width,height:selected.graphic.height,byteLength:blob.size,hash,filename};
      downloadBlob(blob,filename);await model.recordExport(record);say(`${format.toUpperCase()} ready · ${blob.size.toLocaleString()} bytes. Download requested; your browser handles saving.`);
    } catch(error){await model.recordExport({status:'Failed',capture:address,svgHash:selected.hash,format,error:String(error)});throw error;}
    finally{await drawExport();}
  });};
}
$('title').textContent=config.title;document.title=config.title+' · sandbox';
$('new-test').onclick=()=>run(()=>open(owner.createTestRun(config.id,'studio').name));
$('session').onchange=()=>{const name=$('session').value;run(()=>open(name));};
$('inspect').onclick=()=>{$('values').textContent=pretty(inspect());$('address').value=active.name+'.'+model.contextAddress.slice(3);$('resolved').textContent='';$('inspection').showModal();};
$('lookup').onsubmit=event=>{event.preventDefault();try{$('resolved').textContent=pretty(model.pxc.get(localAddress(active.name,$('address').value)));}catch(error){$('resolved').textContent=String(error);}};
$('close').onclick=()=>$('inspection').close();
$('close-study').onclick=()=>$('card-study').close();
if(config.mode==='create'){
  $('scene-worlds-button').hidden=false;
  $('scene-worlds-button').onclick=()=>{$('scene-worlds').showModal();};
  $('scene-worlds-close').onclick=()=>$('scene-worlds').close();
  $('scene-worlds-run').onclick=composeSceneWorlds;
}
window.pxCubeExperience=Object.freeze({inspect,list:()=>owner.list(),current:()=>({name:active.name,kind:active.inspect().kind,surface:config.mode}),resolve:address=>model.pxc.get(localAddress(active.name,address))});
window.pxCubeDemo=Object.freeze({get model(){return model;},get busy(){return busy;},settled:()=>queue});
await run(()=>open(owner.openInteractive(config.id,'studio').name));
