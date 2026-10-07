// Injected inside the pinned prototype's closure. These are its actual objects.
window.addEventListener('error',event=>cubeContext.stopped(event.error??event.message));
const savedShopping=cubeContext.storage.getItem('');
if(savedShopping){
 const saved=JSON.parse(savedShopping);
 if(saved.version!==1||!saved.ui||!saved.setting||!Array.isArray(saved.ui.shortlist)||!Array.isArray(saved.ui.bags))throw Error('Invalid shopping checkpoint; preserved for recovery.');
 Object.assign(ui,saved.ui);Object.assign(setting,saved.setting);
 el('fs-size').value=String(setting.size);
 const lastBag=ui.bags.at(-1);
 if(lastBag){el('fs-created-bag').textContent=`${lastBag.name} · ${lastBag.discIds.length} discs. Restored in this sandbox.`;el('fs-created-bag').hidden=false;}
}
const shoppingBridge={
 modelKind:'shopping prototype objects',ui,setting,discs,
 inspect:()=>({modelKind:'shopping prototype objects',settings:{...setting},ui:structuredClone(ui),discs:discs.map(({art,...disc})=>disc),matching:filtered().map(d=>d.id),note:'Painting bytes omitted from this display; resolve px.shelf to inspect the full actual objects.'}),
 resolve(address){
  const local=cubeContext.localAddress(address),values={'ds.px.shelf':discs,'ds.px.ui':ui,'ds.px.settings':setting,'ds.px.bags':ui.bags};
  if(!Object.hasOwn(values,local))throw Error('Unknown shopping model address');return values[local];
 }
};
window.pxCubeModel=shoppingBridge;
cubeContext.ready(shoppingBridge);
for(const event of ['click','input','change'])root.addEventListener(event,()=>queueMicrotask(()=>{
 try {if(cubeContext.kind==='interactive')cubeContext.storage.setItem('',JSON.stringify({version:1,ui,setting}));cubeContext.checkpoint();}
 catch(error){cubeContext.stopped(error);}
}));
