import { defaultPresets, composeCard, cardSvg, composeOverlay, materializeOverlay } from './renderer/src/presentation.js';
import { cardsEffective, cardsApply, defaultCards } from './renderer/src/cards.js';
import { composeFrame } from './renderer/src/frames.js';
import { sha256 } from './renderer/src/media.js';
import { createBag, reorderBag } from './studio/upload-disc-to-shelf/bags.js';
import { compositionStudies, defaultComposition, compositionDefinition, compositionFields, layeredCompositionDefinition, compositionLayers, layeredCompositionScene, layeredCompositionPreview } from './compositions.mjs';
export { compositionStudies } from './compositions.mjs';

export const designs = defaultPresets();
export const currentLayout='corner@4';
export const defaultStudy='balanced-bold';
export const spacingStudies=Object.freeze([
  {id:'close',name:'Close',image:224,imageX:8,textX:248,right:18,top:14,moldY:42,numberY:100},
  {id:'balanced',name:'Balanced',image:208,imageX:10,textX:236,right:22,top:20,moldY:50,numberY:108},
  {id:'open',name:'Open',image:176,imageX:22,textX:222,right:30,top:28,moldY:62,numberY:120},
]);
export const typeStudies=Object.freeze([
  {id:'bold',name:'Bold',maker:17,mold:34,meta:22,number:98,moldFont:'sans',numberFont:'sans',metaFont:'sans'},
  {id:'editorial',name:'Editorial',maker:16,mold:36,meta:22,number:98,moldFont:'serif',numberFont:'serif',metaFont:'sans'},
  {id:'technical',name:'Technical',maker:17,mold:32,meta:22,number:90,moldFont:'mono',numberFont:'mono',metaFont:'mono'},
]);
export const cardStudies=Object.freeze(spacingStudies.flatMap(spacing=>typeStudies.map(type=>({
  id:`${spacing.id}-${type.id}`,name:`${spacing.name} · ${type.name}`,spacing,type,
}))));
export const allCardStudies=[...compositionStudies,...cardStudies];
export const defaultDesign = Object.freeze({layout:currentLayout,study:defaultComposition,preset:'spotlight',orientation:'landscape',frame:'none',placement:'bottom-left',compositionSize:'balanced',compositionScaleNudge:0,compositionOffsetX:0,compositionOffsetY:0,accent:'#a6edda',background:'#162c39',foreground:'#f6f3e9',title:''});
export const compositionSizeStudies=Object.freeze([
  {id:'compact',name:'Compact · 576 × 243',scale:1,envelopeWidth:576,envelopeHeight:243,note:'Keeps the scene open around the graphic.'},
  {id:'balanced',name:'Preferred · 640 × 270',scale:1,envelopeWidth:640,envelopeHeight:270,note:'Assisted starting point for a clear, useful overlay.'},
  {id:'full-width',name:'Maximum · 768 × 324',scale:1,envelopeWidth:768,envelopeHeight:324,note:'The largest allowed export footprint.'},
]);
export const compositionScaleNudges=Object.freeze([-10,-5,-3,-1,0,1,3,5,10]);
export const compositionOffsetNudges=Object.freeze([-120,-60,-20,0,20,60,120]);
export function graphicFields({disc, resolved}) {
  const fields = [
    {path:'disc.photo',type:'image',label:'Depiction',value:disc.depiction.src},
    {path:'disc.mold.manufacturer.name',label:'Manufacturer',value:resolved.manufacturer},
    {path:'disc.mold.name',label:'Mold',value:resolved.name},
    {path:'disc.nickname',label:'Nickname',value:disc.nickname},
  ];
  for(const key of ['speed','glide','turn','fade']) fields.push({path:`disc.mold.flight.${key}`,label:key,value:resolved[key],type:'number'});
  return fields;
}
export function graphicArt({disc,art}) {
  // The legacy card renderer calls its data-URL image carrier 'photo'. Studio's
  // retained art is already a self-contained URL, including nested palette SVGs.
  // Keep the actual depiction kind; do not repaint it or feed it to artInner().
  return {kind:'photo',src:art,sourceKind:disc.depiction.kind};
}
export function unlabelledArt({disc,art}) {
  const result=graphicArt({disc,art});
  if(disc.depiction.kind!=='painted')return result;
  const prefix='data:image/svg+xml;charset=utf-8,';
  if(!art.startsWith(prefix))throw Error('Expected retained painter SVG.');
  // The existing painters already separate name plaques into a text group.
  // Hide that layer (including both palette halves), preserving the source Part.
  const svg=decodeURIComponent(art.slice(prefix.length)).replace(/<svg\b[^>]*>/, '$&<style>g#text,g#primary-text,g#secondary-text{display:none}</style>');
  return {...result,src:prefix+encodeURIComponent(svg)};
}
export function graphicDesign({design}) {
  if(!['spotlight','showcase','broadcast'].includes(design.preset)) throw Error('Choose a known design.');
  if(!['landscape','portrait'].includes(design.orientation)||!['filled','none'].includes(design.frame)) throw Error('Choose a known frame.');
  for(const color of ['accent','background','foreground']) if(!/^#[0-9a-f]{6}$/i.test(design[color])) throw Error('Design colors must be #rrggbb.');
  return {preset:designs[design.preset],tokens:{...defaultCards().global,accent:design.accent,background:design.background,foreground:design.foreground,sponsor:''}};
}

// Layout is preset data over the existing field bindings and card renderer.
// Keep the earlier Calculation names intact so captured versions still replay.
export function canvasDesign({design}) {
  const definition=graphicDesign({design}), source=designs.spotlight;
  const original=id=>source.nodes.find(node=>node.id===id);
  const text=(id,binding,x,y,w,h,size,extra={})=>({...original('maker'),id,binding,x,y,w,h,size,...extra});
  const flipped=design.preset==='showcase', imageX=flipped?402:10, textX=flipped?24:236;
  const nodes=[
    {...original('photo'),x:imageX,y:16,w:208,h:208},
    text('maker','disc.mold.manufacturer.name',textX,20,350,24,18),
    text('mold','disc.mold.name',textX,50,350,55,40,{bold:true,font:'sans'}),
    ...['speed','glide','turn','fade'].flatMap((key,i)=>[
      {...original(key),x:textX+i*88,y:116,w:78,h:38,size:30,showLabel:false,align:'left'},
      text(key+'-label',`graphic.labels.${key}`,textX+i*88,156,78,22,14,{color:design.accent}),
    ]),
    text('plastic','disc.plastic',textX,198,240,24,17,{hideEmpty:true}),
    text('weight','disc.weight',textX+254,198,92,24,17,{align:'right',hideEmpty:true,suffix:' g'}),
  ];
  if(design.title.trim())nodes.push(text('title','graphic.title',24,252,570,28,20,{color:design.accent,bold:true}));
  return {...definition,preset:{...source,id:`corner-${design.preset}`,width:620,height:design.title.trim()?296:244,
    name:'DiscSpotlight · corner overlay',radius:16,border:'transparent',font:'sans',nodes}};
}
export function canvasFrame({design,definition}) {
  const frame=composeFrame({spec:{orientation:design.orientation,presetId:'none'},tokens:definition.tokens});
  return {...frame,presetId:design.frame,fill:design.frame==='filled'?definition.tokens.background:'none'};
}
export function cornerMetadata({definition}) {
  const preset=definition.preset,textX=preset.nodes.find(node=>node.id==='maker').x;
  return {...definition,preset:{...preset,nodes:preset.nodes.map(node=>{
    if(node.id==='plastic'||node.id==='weight')return {...node,x:textX+278,y:node.id==='plastic'?20:50,w:84,h:26,size:20,align:'right'};
    if(node.id==='maker'||node.id==='mold')return {...node,w:252};
    return node;
  })}};
}
export function cornerTypography({definition}) {
  const preset=definition.preset,textX=preset.nodes.find(node=>node.id==='maker').x;
  const flights=['speed','glide','turn','fade'];
  return {...definition,preset:{...preset,nodes:preset.nodes
    .filter(node=>!flights.some(key=>node.id===key+'-label'))
    .map(node=>{
      if(node.id==='maker')return {...node,size:16,h:24};
      if(node.id==='mold')return {...node,size:34,h:44};
      if(node.id==='plastic'||node.id==='weight')return {...node,size:20,h:26};
      const index=flights.indexOf(node.id);
      // The lower 108px are for numbers alone. Wider text boxes keep signed
      // values at the same size; the four centers remain evenly spaced.
      if(index!==-1)return {...node,x:textX-15+index*88,y:108,w:118,h:108,size:98,align:'center',showLabel:false};
      return node;
    })}};
}
export function cornerStudy({definition,study}) {
  const {spacing:s,type:t}=study,preset=definition.preset;
  const flipped=preset.id==='corner-showcase';
  const textX=flipped?s.right:s.textX,edge=flipped?620-s.textX:620-s.right;
  const width=edge-textX,flights=['speed','glide','turn','fade'];
  return {...definition,preset:{...preset,nodes:preset.nodes.map(node=>{
    if(node.id==='photo')return {...node,x:flipped?620-s.imageX-s.image:s.imageX,y:(244-s.image)/2,w:s.image,h:s.image};
    if(node.id==='maker')return {...node,x:textX,y:s.top,w:width-126,h:26,size:t.maker,font:t.metaFont};
    if(node.id==='mold')return {...node,x:textX,y:s.moldY,w:width-126,h:46,size:t.mold,font:t.moldFont};
    if(node.id==='plastic'||node.id==='weight')return {...node,x:edge-118,y:node.id==='plastic'?s.top:s.moldY,w:118,h:28,size:t.meta,font:t.metaFont,align:'right'};
    const i=flights.indexOf(node.id),numberWidth=t.number*1.2+1;
    if(i!==-1)return {...node,x:textX+(i+.5)*width/4-numberWidth/2,y:s.numberY,w:numberWidth,h:108,size:t.number,font:t.numberFont};
    return node;
  })}};
}
export function moldHeading({definition}) {
  const nodes=definition.preset.nodes,top=nodes.find(node=>node.id==='maker')?.y;
  return {...definition,preset:{...definition.preset,nodes:nodes.filter(node=>node.id!=='maker').map(node=>
    node.id==='mold'?{...node,y:(top??node.y)+2,h:56,size:Math.round(node.size*1.4)}:node
  )}};
}
export function canvasScene({card,frame,design}) {
  const anchor=design.placement??'bottom-left';
  if(!['bottom-left','bottom-center','bottom-right','top-left','top-right'].includes(anchor))throw Error('Choose a known anchor.');
  const size=compositionSizeStudies.find(item=>item.id===design.compositionSize)??compositionSizeStudies[1];
  const nudge=Number(design.compositionScaleNudge)||0;
  const scale=size.scale*(1+nudge/100);
  const base=composeOverlay({cards:{single:card},frame,layout:{orientation:design.orientation,arrangement:'row',anchor:anchor==='bottom-center'?'bottom-left':anchor,scale,gap:0}});
  // composeOverlay owns safe-area fitting and corner placement. Center only
  // the horizontal axis for the lower-third anchor, then apply exact export
  // pixel nudges as a final reversible geometry transform.
  const centerShift=anchor==='bottom-center'?(base.safe.x+(base.safe.width-base.bounds.width)/2-base.bounds.x):0;
  const dx=centerShift+(Number(design.compositionOffsetX)||0),dy=Number(design.compositionOffsetY)||0;
  const placements=base.placements.map(item=>({...item,x:item.x+dx,y:item.y+dy}));
  return {...base,compositionAnchor:anchor,compositionOffsetX:Number(design.compositionOffsetX)||0,compositionOffsetY:Number(design.compositionOffsetY)||0,compositionEnvelope:{width:size.envelopeWidth,height:size.envelopeHeight},compositionHardMax:{width:768,height:324},placements,bounds:{...base.bounds,x:base.bounds.x+dx,y:base.bounds.y+dy}};
}
export const calculations = {
  'fn.studio.reorderSelection':({context,view,from,to})=>reorderBag({bag:createBag({id:'draft',name:context.name||'Draft',selection:context.selection,rows:view.rows}),discId:view.rows.find(row=>row.address===context.selection[from]).disc.id,toIndex:to}).versions.map(v=>v.address),
  'fn.studio.graphicFields':graphicFields,
  'fn.studio.graphicArt':graphicArt,
  'fn.studio.unlabelledArt':unlabelledArt,
  'fn.studio.unlabelledCard':({preset})=>({...preset,nodes:preset.nodes.filter(node=>node.binding!=='disc.nickname')}),
  'fn.studio.graphicDesign':graphicDesign,
  'fn.studio.canvasDesign':canvasDesign,
  'fn.studio.cornerMetadata':cornerMetadata,
  'fn.studio.cornerTypography':cornerTypography,
  'fn.studio.cornerStudy':cornerStudy,
  'fn.studio.moldHeading':moldHeading,
  'fn.studio.cardPreview':cardSvg,
  'fn.studio.compositionDefinition':compositionDefinition,
  'fn.studio.compositionFields':compositionFields,
  'fn.studio.layeredCompositionDefinition':layeredCompositionDefinition,
  'fn.studio.compositionLayers':compositionLayers,
  'fn.studio.layeredCompositionScene':layeredCompositionScene,
  'fn.studio.layeredCompositionPreview':layeredCompositionPreview,
  'fn.studio.canvasFields':({disc,resolved,design})=>[...graphicFields({disc,resolved}).filter(field=>field.path!=='disc.nickname'),
    {path:'disc.plastic',label:'Plastic',value:disc.plastic},{path:'disc.weight',label:'Weight',value:disc.weight},
    ...['speed','glide','turn','fade'].map(key=>({path:`graphic.labels.${key}`,label:key,value:key.toUpperCase()})),
    {path:'graphic.title',label:'Title',value:design.title.trim()}],
  'fn.studio.canvasFrame':canvasFrame,
  'fn.studio.canvasScene':canvasScene,
  'fn.studio.cardTokens':({design,disc})=>cardsEffective({global:design.tokens,preset:design.preset,projectionName:'single',discId:disc.id}),
  'fn.studio.cardPreset':({design,effective})=>cardsApply({preset:design.preset,effective}),
  'fn.studio.card':composeCard,
  'fn.studio.frame':({design,tokens})=>composeFrame({spec:{orientation:design.orientation,presetId:design.frame,title:design.title},tokens:tokens.tokens}),
  'fn.studio.scene':({card,frame,design})=>composeOverlay({cards:{single:card},frame,layout:{orientation:design.orientation,arrangement:'row',anchor:'center',scale:1.5,gap:0}}),
  'fn.studio.graphic':materializeOverlay,
  'fn.studio.svgDigest':({graphic})=>sha256(graphic.svg),
  'fn.studio.capture':({graphic,design,disc,resolved,hash,source})=>({schema:'studio-graphic@1',hash,source,title:`${resolved.manufacturer} · ${resolved.name}`,graphic,design,specimen:{disc,resolved}}),
  'fn.studio.exportRecord':({capture,measurement})=>{if(capture.hash!==measurement.svgHash)throw Error('Export measurement names a different capture.');return measurement;},
};
