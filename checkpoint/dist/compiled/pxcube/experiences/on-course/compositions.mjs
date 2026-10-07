import { composeCard, materializeOverlay } from './renderer/src/presentation.js';
// Authored layout Parts. One projection below interprets every composition.
// Coordinates are export pixels; these are not alternate DOM card templates.
const panel=(x,y,w,h,fill='background',radius=12,extra={})=>({x,y,w,h,fill,radius,...extra});
const header=(x,y,w,extra={})=>({x,y,w,maker:17,mold:34,meta:22,gap:30,...extra});
const numbers=(x,y,w,size,extra={})=>({x,y,w,size,h:108,...extra});
export const compositionStudies=Object.freeze([
  {id:'broadcast-rail',name:'Broadcast rail',note:'A long, low bar. The disc anchors a ruled header and one clear number row.',composition:{
    width:720,height:190,art:{x:12,y:12,w:166,h:166},header:header(198,12,498,{mold:32,gap:26}),numbers:numbers(196,86,500,78,{h:88}),
    surfaces:[panel(0,0,720,190),panel(184,18,3,154,'accent',0),panel(198,78,498,2,'accent',0)]}},
  {id:'split-ticket',name:'Split ticket',note:'Two separate blocks: an accent-colored disc tile and a dark information ticket.',composition:{
    width:620,height:250,art:{x:12,y:23,w:202,h:202},header:header(250,20,346),numbers:numbers(248,130,348,84),
    surfaces:[panel(0,0,226,250,'accent',20),panel(238,0,382,250,'background',6)]}},
  {id:'score-slip',name:'Paper score slip',note:'A small specimen above a full-width score row. Light paper, dark ink, thin rules.',composition:{
    width:600,height:246,ink:'background',font:'serif',art:{x:18,y:12,w:86,h:86},header:header(124,14,454,{font:'serif',mold:36}),numbers:numbers(16,118,568,96,{font:'serif'}),
    surfaces:[panel(0,0,600,246,'foreground',2),panel(16,108,568,2,'background',0),...[1,2,3].map(i=>panel(16+i*142,130,1,90,'background',0))]}},
  {id:'floating-orbit',name:'Floating orbit',note:'The disc floats outside the boxes. Four detached number tiles leave the video visible between them.',composition:{
    width:650,height:264,art:{x:0,y:10,w:244,h:244},header:header(280,20,346),numbers:numbers(258,156,380,76,{h:90}),
    surfaces:[panel(256,0,394,124,'background',20),...[0,1,2,3].map(i=>panel(258+i*95,154,85,106,'background',18))]}},
  {id:'caption-ribbon',name:'Caption ribbon',note:'The shallowest option: a broad strip that keeps more of the video unobstructed.',composition:{
    width:740,height:154,art:{x:7,y:7,w:140,h:140},header:header(168,8,546,{maker:15,mold:29,meta:20,gap:25}),numbers:numbers(166,77,552,62,{h:68}),
    surfaces:[panel(0,0,740,154,'background',0),panel(162,68,560,3,'accent',0)]}},
  {id:'upright-tag',name:'Upright tag',note:'A compact vertical tag: grouped facts, centered specimen, then the four numbers across its foot.',composition:{
    width:380,height:350,art:{x:115,y:98,w:150,h:150},header:header(22,18,336,{mold:32,meta:21}),numbers:numbers(18,254,344,74,{h:86}),
    surfaces:[panel(0,0,380,350,'background',24),panel(22,90,336,2,'accent',0)]}},
  {id:'crest',name:'Crest',note:'The disc rises above the card silhouette. A wide pedestal carries the shared header and numbers.',composition:{
    width:650,height:350,art:{x:240,y:0,w:170,h:170},header:header(22,170,606,{mold:34}),numbers:numbers(18,242,614,74,{h:78}),
    surfaces:[panel(0,150,650,200,'background',18),{shape:'circle',cx:325,cy:85,r:85,fill:'accent'},panel(22,232,606,2,'accent',0)]}},
  {id:'edge-crop',name:'Edge crop',note:'The artwork becomes a close crop along the edge, giving the pattern more presence than the disc outline.',composition:{
    width:620,height:260,art:{x:0,y:0,w:218,h:260,fit:'cover',radius:8},header:header(254,24,344,{mold:36}),numbers:numbers(240,136,364,88),
    surfaces:[panel(0,0,620,260,'background',8),panel(232,20,3,220,'accent',0)]}},
  {id:'number-plate',name:'Number plate',note:'A specimen-and-name header sits above a contrasting full-width number plate. Numbers lead.',composition:{
    width:620,height:244,art:{x:16,y:12,w:90,h:90},header:header(128,14,466,{font:'mono',maker:16,mold:30,meta:22}),numbers:numbers(12,124,596,94,{ink:'background'}),
    surfaces:[panel(0,0,620,244,'background',14),panel(0,114,620,130,'accent',14)]}},
]);
export const defaultComposition='broadcast-rail';

export function compositionDefinition({definition,study}){
  const c=study.composition,h=c.header,n=c.numbers,ink=c.ink??'foreground';
  const source=definition.preset.nodes,original=id=>source.find(node=>node.id===id);
  const text=(id,props)=>({...original(id),showLabel:false,color:definition.tokens[ink],font:c.font??'sans',...props});
  const metaWidth=Math.max(112,h.meta*5.4),nameWidth=h.w-metaWidth-16;
  const nodes=[
    {id:'surface',kind:'image',binding:'graphic.surface',x:0,y:0,w:c.width,h:c.height,fit:'contain'},
    {...original('photo'),...c.art},
    text('maker',{x:h.x,y:h.y,w:nameWidth,h:26,size:h.maker,font:h.font??'sans'}),
    text('mold',{x:h.x,y:h.y+h.gap,w:nameWidth,h:46,size:h.mold,font:h.font??c.font??'sans',bold:true}),
    ...['plastic','weight'].map((id,i)=>text(id,{x:h.x+h.w-metaWidth,y:h.y+i*h.gap,w:metaWidth,h:28,size:h.meta,align:'right'})),
    ...['speed','glide','turn','fade'].map((id,i)=>{
      const w=n.size*1.2+1;
      return text(id,{x:n.x+(i+.5)*n.w/4-w/2,y:n.y,w,h:n.h,size:n.size,align:'center',bold:true,font:n.font??c.font??'sans',color:definition.tokens[n.ink??ink]});
    }),
  ];
  const title=original('title');
  if(title)nodes.push({...title,x:20,y:c.height+8,w:c.width-40,h:30,color:definition.tokens[ink]});
  return {...definition,surfaces:c.surfaces,preset:{...definition.preset,id:`composition-${study.id}`,name:study.name,width:c.width,height:c.height+(title?48:0),background:'transparent',border:'transparent',radius:0,nodes}};
}

// The background geometry is another bound image Part, rendered by the same
// existing image-node code as the disc. No post-render SVG or CSS layout patch.
export function compositionFields({fields,definition}){
  const color=key=>key==='none'?'none':definition.tokens[key];
  const shapes=definition.surfaces.map(s=>s.shape==='circle'
    ?`<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${color(s.fill)}"/>`
    :`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.radius??0}" fill="${color(s.fill)}"/>`).join('');
  const {width,height}=definition.preset;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes}</svg>`;
  return [...fields,{path:'graphic.surface',label:'Composition surfaces',type:'image',value:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}];
}

export function layeredCompositionDefinition(inputs){
  const result=compositionDefinition(inputs);
  return {...result,preset:{...result.preset,nodes:result.preset.nodes.filter(node=>node.id!=='surface')}};
}
export function compositionLayers({definition}){
  return definition.surfaces.map((s,i)=>{
    const circle=s.shape==='circle';
    // cardMarkup insets its background by 2px. Compensate here so a 1px
    // divider remains a 1px divider instead of becoming a negative-size rect.
    const width=(circle?s.r*2:s.w)+4,height=(circle?s.r*2:s.h)+4;
    return {x:(circle?s.cx-s.r:s.x)-2,y:(circle?s.cy-s.r:s.y)-2,
      card:composeCard({fields:[],art:null,preset:{
        id:`surface-${i}`,width,height,nodes:[],background:definition.tokens[s.fill],
        border:'transparent',foreground:definition.tokens.foreground,
        radius:circle?s.r:s.radius??0,
      }})};
  });
}
function unionBounds(placements,scale=1){
  if(!placements.length)return {x:0,y:0,width:0,height:0};
  const left=Math.min(...placements.map(({x})=>x)),top=Math.min(...placements.map(({y})=>y));
  const right=Math.max(...placements.map(({x,card})=>x+card.width*scale)),bottom=Math.max(...placements.map(({y,card})=>y+card.height*scale));
  return {x:left,y:top,width:right-left,height:bottom-top};
}
function localLayerEntries(scene,layers){
  const base=scene.placements[0];
  if(!base)return [];
  return [{card:base.card,x:0,y:0},...layers.map(layer=>({card:layer.card,x:layer.x,y:layer.y}))];
}
export function layeredCompositionScene({scene,layers}){
  const origin=scene.placements[0],entries=localLayerEntries(scene,layers);
  if(!origin||!entries.length)return {...scene,layers};
  const local=unionBounds(entries),safe=scene.safe;
  if(safe){
    const requested=Math.max(0,Number(scene.scale)||1),envelope=scene.compositionEnvelope??{width:Infinity,height:Infinity},hardMax=scene.compositionHardMax??{width:768,height:324},target=Math.min(envelope.width/local.width,envelope.height/local.height)*requested,scale=Math.min(target,safe.width/local.width,safe.height/local.height,hardMax.width/local.width,hardMax.height/local.height),anchor=scene.compositionAnchor??'bottom-left';
    const xBase=anchor==='bottom-center'?safe.x+(safe.width-local.width*scale)/2-local.x*scale:anchor.endsWith('right')?safe.x+safe.width-local.x*scale-local.width*scale:safe.x-local.x*scale;
    const yBase=anchor.startsWith('top')?safe.y-local.y*scale:safe.y+safe.height-local.y*scale-local.height*scale;
    const x=xBase+(Number(scene.compositionOffsetX)||0),y=yBase+(Number(scene.compositionOffsetY)||0);
    const placed=entries.map(entry=>({...entry,x:x+entry.x*scale,y:y+entry.y*scale,scale})),placements=[...placed.slice(1),placed[0]];
    return {...scene,layers,scale,placements,bounds:unionBounds(placements,scale)};
  }
  const placed=entries.map(entry=>({...entry,x:origin.x+entry.x*scene.scale,y:origin.y+entry.y*scene.scale,scale:scene.scale})),placements=[...placed.slice(1),placed[0]];
  return {...scene,layers,placements,bounds:unionBounds(placements,scene.scale)};
}
export function layeredCompositionPreview({card,layers}){
  const scene={width:card.width,height:card.height,scale:1,cards:[card],placements:[{card,x:0,y:0}],bounds:{x:0,y:0,width:card.width,height:card.height},warnings:card.warnings};
  const layered=layeredCompositionScene({scene,layers}),padding=8,union=layered.bounds;
  const placements=layered.placements.map(item=>({...item,x:item.x-union.x+padding,y:item.y-union.y+padding}));
  return materializeOverlay({scene:{...layered,width:union.width+padding*2,height:union.height+padding*2,placements,bounds:{x:padding,y:padding,width:union.width,height:union.height}}});
}
