import { battleStandings, battleEntry } from './renderer/src/battle.js';
import { composeOverlay, composeCard } from './renderer/src/presentation.js';

// A creator edits one live image and keeps it when ready. The queue lives in
// captured graphics, not in an automatically invented tournament or timeline.
export function competitionDraft({selection,...discs}) {
  if(selection.length<2||selection.length>4||new Set(selection).size!==selection.length)throw Error('Choose 2–4 different physical copies.');
  const entries=selection.map((address,i)=>({id:`disc-${i+1}`,discId:discs[`disc${i}`].id,address,name:discs[`mold${i}`].name}));
  return {name:'DiscCompetition',entries,states:[{id:'live',name:'Live image',scores:Object.fromEntries(entries.map(e=>[e.id,0])),highlight:entries[0].id,winners:[]}],currentStateId:'live',constraints:[],styles:{},emphasizeTurn:true};
}
export function competitionEdit({material,edit}) {
  const next=structuredClone(material),state=next.states[0],ids=next.entries.map(e=>e.id);
  if(edit.kind==='turn') {
    if(edit.id!==null&&!ids.includes(edit.id))throw Error('Choose a participant.');
    state.highlight=edit.id;
  } else if(edit.kind==='points') {
    if(!ids.includes(edit.id)||!Number.isFinite(edit.points)||Math.abs(edit.points)>9999)throw Error('Use points between −9999 and 9999.');
    state.scores[edit.id]=edit.points;
  } else if(edit.kind==='style') {
    if(!ids.includes(edit.id)||!Number.isFinite(edit.style.scale)||edit.style.scale<0.45||edit.style.scale>1.5||!/^#[0-9a-f]{6}$/i.test(edit.style.accent))throw Error('Use a 45–150% size and a hex accent.');
    next.styles[edit.id]=edit.style;
  } else if(edit.kind==='auto') {next.styles={};next.emphasizeTurn=true;}
  else if(edit.kind==='equal') {next.styles={};next.emphasizeTurn=false;}
  else throw Error('Unknown competition change.');
  return next;
}
export function competitionAppearance({design,material,entryId}) {
  const active=material.states[0].highlight===entryId,override=material.styles[entryId];
  const emphasize=material.emphasizeTurn&&material.states[0].highlight!==null;
  return {design:{...design,accent:override?.accent??(active&&emphasize?'#ffd166':design.accent)},scale:override?.scale??(emphasize&&!active?0.65:1),active};
}
export function competitionPreset({card,entry,appearance}) {
  const p=card.preset;
  return {...p,border:appearance.active?appearance.design.accent:'transparent',highlight:'stripe',height:p.height+54,nodes:[...p.nodes,
    {id:'competition-points',kind:'text',x:18,y:p.height+8,w:p.width-36,h:40,size:28,font:'sans',color:p.foreground,bold:true,
      binding:'competition.caption'},
  ]};
}
export function competitionTreatment({card,layers,appearance}) {
  const k=appearance.scale;
  const scaleCard=c=>({...c,width:c.width*k,height:c.height*k,preset:{...c.preset,width:c.width*k,height:c.height*k,radius:(c.preset.radius??0)*k},nodes:c.nodes.map(n=>({...n,x:n.x*k,y:n.y*k,w:n.w*k,h:n.h*k,size:(n.size??0)*k,radius:(n.radius??0)*k}))});
  return {card:scaleCard(card),layers:layers.map(layer=>({x:layer.x*k,y:layer.y*k,card:scaleCard(layer.card)}))};
}
export function competitionScene({material,frame,design,...parts}) {
  const cards=Object.fromEntries(material.entries.map((e,i)=>[e.id,parts[`treatment${i}`].card]));
  const scene=composeOverlay({cards,frame,layout:{orientation:design.orientation,arrangement:design.orientation==='portrait'?'stack':'row',anchor:design.placement??'bottom-left',gap:24,scale:1}});
  const maxHeight=Math.max(...scene.cards.map(c=>c.height)),placements=[];
  for(const placement of scene.placements) {
    const index=material.entries.findIndex(e=>e.id===placement.card.entry.id);
    const y=placement.y+(design.orientation==='portrait'?0:(maxHeight-placement.card.height)*scene.scale);
    for(const layer of parts[`treatment${index}`].layers)placements.push({card:layer.card,x:placement.x+layer.x*scene.scale,y:y+layer.y*scene.scale});
    placements.push({...placement,y});
  }
  return {...scene,placements};
}
export const competitionCalculations={
  'fn.studio.competitionDraft':competitionDraft,
  'fn.studio.competitionEdit':competitionEdit,
  'fn.studio.competitionAppearance':competitionAppearance,
  'fn.studio.competitionDesign':({appearance})=>appearance.design,
  'fn.studio.competitionTreatment':competitionTreatment,
  'fn.studio.competitionPresetPanel':inputs=>{const preset=competitionPreset(inputs);return {...preset,nodes:preset.nodes.map(n=>n.id==='competition-points'?{...n,color:'#102b29'}:n)};},
  'fn.studio.competitionTreatmentPanel':({card,layers,appearance})=>competitionTreatment({card,appearance,layers:[...layers,{x:-2,y:card.height-54,card:composeCard({fields:[],art:null,preset:{id:'competition-points-panel',width:card.width+4,height:54,nodes:[],background:appearance.design.accent,border:'transparent',radius:6}})}]}),
  'fn.battle.standings':battleStandings,
  'fn.battle.entry':battleEntry,
  'fn.studio.competitionPreset':competitionPreset,
  'fn.studio.competitionFields':({fields,entry})=>[...fields,{path:'competition.caption',label:'Points',value:`${entry.highlighted?'UP NOW · ':''}${entry.score} PTS`}],
  'fn.studio.competitionScene':competitionScene,
  'fn.studio.competitionCapture':({graphic,design,material,hash,source})=>({schema:'studio-graphic@1',title:material.name+' · '+(material.entries.find(e=>e.id===material.states[0].highlight)?.name??'Lineup'),graphic,design,hash,source,competition:material}),
};
