import { Part } from './studio/part-first-kernel/src/pxc.mjs';
import { createExperience, initialDraft, paintings } from './studio/upload-disc-to-shelf/model.js';
import { archive, restore } from './studio/upload-disc-to-shelf/persistence.js';
import { inspectExperience } from './studio/upload-disc-to-shelf/experience-fixtures.js';
import { calculations, defaultDesign, currentLayout, allCardStudies, compositionStudies, defaultStudy } from './graphics.mjs';
import { competitionCalculations } from './competition.mjs';
import { sha256 } from './renderer/src/media.js';

const prefix='ds.px.studio.demo.';
export const captureIdentity=capture=>JSON.stringify([capture.source.mount,capture.source.graphic,capture.hash,...(capture.source.queueItem?[capture.source.queueItem]:[])]);
const frozen=value=>Object.freeze(structuredClone(value));
const install=pxc=>{for(const [name,fn] of Object.entries({...calculations,...competitionCalculations})) if(!pxc.entries().some(([address])=>address===name))pxc.set(name,new Part(fn));};

export async function openDemo(storage) {
  const known=createExperience(()=>{}); install(known.pxc);
  const raw=storage.getItem('');
  let savedState=raw===null?null:await restore(raw,known.pxc,{mode:'working',immutableCalculations:['fn.studio.capture','fn.studio.competitionCapture']});
  const experience=createExperience(()=>{}, {state:savedState??undefined,persist(state){storage.setItem('',archive(state));savedState=state;}});
  const pxc=experience.pxc; install(pxc);
  if(raw===null) {
    const specimens=[
      ['buzzz','ESP',175,'#f7bd72','#693550'],['buzzz','ESP',170,'#a5ead7','#225a69'],
      ['buzzz','Z',172,'#f994b5','#542b64'],['zone','ESP',173,'#d9e875','#335d43'],
      ['river','Opto',174,'#8cdfe6','#284684'],['escape','Lucid',171,'#fab797','#874450'],
      ['leopard','Star',168,'#bbaaf4','#493469'],['teebird','Champion',175,'#9fe3c7','#285452'],
    ];
    for(const [index,[id,plastic,weight,Color1,Color2]] of specimens.entries()) {
      const seed=experience.seedOptions().find(row=>row.seed.id===id || row.seed.name.toLowerCase()===id);
      if(!seed) throw Error(`Demo seed missing: ${id}`);
      await experience.save({...initialDraft(),mold:seed.address,plastic,weight,Color1,Color2,colorPainting:true},paintings[index%3]);
    }
  }
  let serial=Math.max(0,...pxc.entries().map(([name])=>Number(/^ds\.px\.studio\.demo\.(\d+)\./.exec(name)?.[1]??0)));
  let contextAddress=pxc.entries().map(([name])=>name).filter(name=>/^ds\.px\.studio\.demo\.\d+\.context$/.test(name)).sort((a,b)=>Number(a.split('.')[4])-Number(b.split('.')[4])).at(-1);
  const fresh=()=>`${prefix}${++serial}.`;
  const put=(name,value)=>{pxc.set(name,new Part(frozen(value)));return name;};
  const value=name=>pxc.get(name).value;
  const compose=async(into,calculation,inputs)=>{await pxc.compose({into,calculation,inputs});return into;};
  let writeFailure=null;
  const persist=async()=>{if(writeFailure)throw writeFailure;if(!savedState)throw Error('No retained shelf state.');try{storage.setItem('',archive({...savedState,pxc,shelfAddress:experience.shelfAddress,bagsAddress:experience.bagsAddress}));await storage.flush?.();}catch(error){writeFailure=Error(`Not saved. Reload before more changes. Previous stored bytes preserved. ${error}`);throw writeFailure;}};
  if(!contextAddress){contextAddress=put(fresh()+'context',{name:'',selection:[],design:defaultDesign,selectedDisc:experience.shelf()[0].address,graphics:[],exports:[],imported:[]});await persist();}
  async function patch(changes){if(writeFailure)throw writeFailure;const base=fresh(),address=await compose(base+'context','oc.update',{value:contextAddress,patch:put(base+'change',changes)});await persist();contextAddress=address;return value(address);}
  if(value(contextAddress).design.layout!==currentLayout) {
    const design=value(contextAddress).design;
    await patch({design:{...design,...(design.layout?.startsWith('corner@')?{}:{frame:'none',placement:'bottom-left'}),layout:currentLayout}});
  }
  const rendered=new Map(),queries=new Map(),displayArts=new Map();
  async function displayArt(discAddress) {
    if(!displayArts.has(discAddress)) {
      const disc=value(discAddress);
      displayArts.set(discAddress,await compose(fresh()+'displayArt','fn.studio.unlabelledArt',{disc:discAddress,art:disc.art??`ds.px.art.${disc.id}`}));
    }
    return displayArts.get(discAddress);
  }
  async function render(discAddress,design) {
    const key=JSON.stringify([discAddress,design]);if(rendered.has(key))return rendered.get(key);
    const disc=value(discAddress),base=fresh();
    const request=put(base+'design',design);
    const resolved=await compose(base+'resolved','fn.read',{base:disc.mold,own:discAddress});
    const fields=await compose(base+'fields','fn.studio.canvasFields',{disc:discAddress,resolved,design:request});
    const art=await displayArt(discAddress);
    const baseDefinition=await compose(base+'definition','fn.studio.canvasDesign',{design:request});
    const metadataDefinition=await compose(base+'metadataDefinition','fn.studio.cornerMetadata',{definition:baseDefinition});
    const typographyDefinition=await compose(base+'typographyDefinition','fn.studio.cornerTypography',{definition:metadataDefinition});
    const study=allCardStudies.find(item=>item.id===(design.study??defaultStudy));
    if(!study)throw Error('Choose a known card study.');
    const studyAddress=put(base+'study',study);
    const studyDefinition=await compose(base+'studyDefinition',study.composition?'fn.studio.layeredCompositionDefinition':'fn.studio.cornerStudy',{definition:typographyDefinition,study:studyAddress});
    const definition=await compose(base+'headingDefinition','fn.studio.moldHeading',{definition:studyDefinition});
    const layersAddress=study.composition?await compose(base+'layers','fn.studio.compositionLayers',{definition}):null;
    const effective=await compose(base+'effective','fn.studio.cardTokens',{design:definition,disc:discAddress});
    const originalPreset=await compose(base+'preset','fn.studio.cardPreset',{design:definition,effective});
    const preset=await compose(base+'unlabelledPreset','fn.studio.unlabelledCard',{preset:originalPreset});
    const card=await compose(base+'card','fn.studio.card',{fields,art,preset});
    const frame=await compose(base+'frame','fn.studio.canvasFrame',{design:request,definition});
    const baseScene=await compose(base+'scene','fn.studio.canvasScene',{card,frame,design:request});
    const scene=layersAddress?await compose(base+'layeredScene','fn.studio.layeredCompositionScene',{scene:baseScene,layers:layersAddress}):baseScene;
    const address=await compose(base+'graphic','fn.studio.graphic',{scene,frame});
    const result={address,cardAddress:card,layersAddress,studyAddress,discAddress,designAddress:request,fieldsAddress:fields,resolvedAddress:resolved,presetAddress:preset,artAddress:art,frameAddress:frame,graphic:value(address)};
    rendered.set(key,result);return result;
  }
  async function capture(result,sourceMount) {
    const base=fresh(),hash=await compose(base+'digest','fn.studio.svgDigest',{graphic:result.address});
    const source=put(base+'source',{mount:sourceMount,graphic:result.address,disc:result.discAddress,design:result.designAddress});
    const address=await compose(base+'capture','fn.studio.capture',{graphic:result.address,design:result.designAddress,disc:result.discAddress,resolved:result.resolvedAddress,hash,source});
    await patch({graphics:[...value(contextAddress).graphics,address]});
    return {address,capture:value(address)};
  }
  async function importCapture(capture) {
    if(capture?.schema!=='studio-graphic@1'||typeof capture.graphic?.svg!=='string'||typeof capture.source?.mount!=='string'||typeof capture.source?.graphic!=='string'||capture.hash!==await sha256(capture.graphic.svg))throw Error('Graphic capture hash or source identity does not match its SVG.');
    const {width,height}=capture.graphic;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw Error('Unsupported captured dimensions.');
    const context=value(contextAddress);
    const identity=captureIdentity(capture);
    if(context.imported.includes(identity))return false;
    const address=put(fresh()+'capture',capture);
    await patch({graphics:[...context.graphics,address],imported:[...context.imported,identity]});
    return true;
  }
  const competitionRenders=new Map();
  async function startCompetition(selection) {
    const base=fresh(),inputs={selection:put(base+'competitionSelection',selection)};
    for(const [i,address] of selection.entries()) {const disc=value(address);inputs[`disc${i}`]=address;inputs[`mold${i}`]=await compose(fresh()+'competitionMold','fn.read',{base:disc.mold,own:address});}
    const address=await compose(base+'competition','fn.studio.competitionDraft',inputs);
    await patch({competitionAddress:address,graphicsPurpose:'competition'});return address;
  }
  async function editCompetition(edit) {
    if(edit.kind==='points'&&!Number.isFinite(edit.points))throw Error('Use a finite number of points.');
    if(edit.kind==='style'&&!Number.isFinite(edit.style?.scale))throw Error('Use a finite card size.');
    const base=fresh(),address=await compose(base+'competition','fn.studio.competitionEdit',{material:value(contextAddress).competitionAddress,edit:put(base+'competitionEdit',edit)});
    await patch({competitionAddress:address});return value(address);
  }
  async function renderCompetition(design=value(contextAddress).design,materialAddress=value(contextAddress).competitionAddress) {
    const key=JSON.stringify([materialAddress,design]);if(competitionRenders.has(key))return competitionRenders.get(key);
    const base=fresh(),material=value(materialAddress),request=put(base+'design',design);
    const standings=await compose(base+'standings','fn.battle.standings',{material:materialAddress,rules:put(base+'rules',material.constraints)});
    const inputs={material:materialAddress,design:request};
    let frame;
    for(const [i,e] of material.entries.entries()) {
      const entryId=put(fresh()+'entryId',e.id);
      const appearance=await compose(fresh()+'appearance','fn.studio.competitionAppearance',{design:request,material:materialAddress,entryId});
      const entryDesign=await compose(fresh()+'entryDesign','fn.studio.competitionDesign',{appearance});
      const rendered=await render(e.address,value(entryDesign));frame??=rendered.frameAddress;
      const entry=await compose(fresh()+'entry','fn.battle.entry',{standings,battle:materialAddress,entryId,stateId:put(fresh()+'stateId',material.currentStateId)});
      const preset=await compose(fresh()+'competitionPreset','fn.studio.competitionPresetPanel',{card:rendered.cardAddress,entry,appearance});
      const fields=await compose(fresh()+'competitionFields','fn.studio.competitionFields',{fields:rendered.fieldsAddress,entry});
      const card=await compose(fresh()+'competitionCard','fn.studio.card',{fields,art:rendered.artAddress,preset,entry});
      inputs[`treatment${i}`]=await compose(fresh()+'treatment','fn.studio.competitionTreatmentPanel',{card,layers:rendered.layersAddress??put(fresh()+'layers',[]),appearance});
    }
    inputs.frame=frame;
    const scene=await compose(base+'competitionScene','fn.studio.competitionScene',inputs);
    const address=await compose(base+'competitionGraphic','fn.studio.graphic',{scene,frame});
    const rendered={address,designAddress:request,materialAddress,standingsAddress:standings,sceneAddress:scene,graphic:value(address)};
    competitionRenders.set(key,rendered);return rendered;
  }
  async function captureCompetition(result,sourceMount) {
    const base=fresh(),hash=await compose(base+'digest','fn.studio.svgDigest',{graphic:result.address});
    const source=put(base+'source',{mount:sourceMount,graphic:result.address,material:result.materialAddress,design:result.designAddress,queueItem:base+'capture'});
    const address=await compose(base+'capture','fn.studio.competitionCapture',{graphic:result.address,design:result.designAddress,material:result.materialAddress,hash,source});
    await patch({graphics:[...value(contextAddress).graphics,address]});return {address,capture:value(address)};
  }
  return {
    experience,pxc,value,render,capture,importCapture,patch,startCompetition,editCompetition,renderCompetition,captureCompetition,
    async studyCards(){
      const previews=[];
      for(const study of compositionStudies){
        const result=await render(value(contextAddress).selectedDisc,{...value(contextAddress).design,study:study.id});
        const preview=await compose(fresh()+'cardPreview',result.layersAddress?'fn.studio.layeredCompositionPreview':'fn.studio.cardPreview',{card:result.cardAddress,...(result.layersAddress?{layers:result.layersAddress}:{})});
        previews.push({study,address:preview,graphic:value(preview)});
      }
      return previews;
    },
    async shelfForDisplay(){const rows=[];for(const row of experience.shelf())rows.push({...row,art:value(await displayArt(row.address)).src});return rows;},
    get context(){return value(contextAddress);},get contextAddress(){return contextAddress;},
    async queryShelf(request){const key=JSON.stringify([experience.shelfAddress,request]);if(!queries.has(key))queries.set(key,await experience.queryShelf(request));return queries.get(key);},
    async reorder(from,to){const view=await this.queryShelf({}),base=fresh();const address=await compose(base+'order','fn.studio.reorderSelection',{context:contextAddress,view:view.address,from:put(base+'from',from),to:put(base+'to',to)});return value(address);},
    async createBag(){if(writeFailure)throw writeFailure;const context=value(contextAddress),address=await experience.createBag(context.name,[...context.selection]);await persist();return address;},
    async recordExport(record){const base=fresh(),address=await compose(base+'export','fn.studio.exportRecord',{capture:record.capture,measurement:put(base+'measurement',record)});await patch({exports:[...value(contextAddress).exports,address]});return address;},
    inspect(){const names=new Map(pxc.entries().map(([address,part])=>[part,address]));return {modelKind:'Studio live Parts',...inspectExperience(experience),contextAddress,context:value(contextAddress),
      compositions:pxc.receipts().map(r=>({status:r.status,into:r.into,calculation:names.get(r.composition.calculation),inputs:Object.fromEntries(Object.entries(r.composition.inputs).map(([key,part])=>[key,names.get(part)??{inline:part.value}])),...(r.error?{error:String(r.error)}:{})})),
      captures:value(contextAddress).graphics.map(address=>({address,value:value(address)})),exports:value(contextAddress).exports.map(address=>({address,value:value(address)}))};},
  };
}
