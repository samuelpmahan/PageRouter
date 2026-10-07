import { openExperience } from './studio/upload-disc-to-shelf/persistent-experience.js';
import { startSandbox, inspectExperience } from './studio/upload-disc-to-shelf/experience-fixtures.js';
import { mountExperiencePage } from './studio/upload-disc-to-shelf/experience-page.js';

const ctx=parent.pxCubeExperience.contextFor(window);
try {
  const log=event=>{const out=document.getElementById('receipts');out.textContent=JSON.stringify(event,null,2);};
  let experience;
  if(ctx.kind === 'interactive') {
    const fresh=ctx.storage.getItem('') === null;
    experience=await openExperience(ctx.storage,log);
    if(experience.persistenceStatus.startsWith('Recovery required')) throw Error(experience.persistenceStatus);
    if(fresh) await startSandbox(ctx.mode,log,experience);
  } else experience=await startSandbox(ctx.mode,log);
  const page=await mountExperiencePage(experience,{sandbox:ctx.mode,testRun:ctx.kind === 'test'});
  const bridge={modelKind:'Studio live Parts',experience,pxc:experience.pxc,devtools:page.devtools,
    resolve:address=>experience.pxc.get(ctx.localAddress(address)),
    inspect:()=>({modelKind:'Studio live Parts',...inspectExperience(experience),bindings:experience.pxc.entries().map(([address])=>({internal:address,mounted:ctx.name+'.'+(address.startsWith('ds.')?address.slice(3):address)})),case:page.sandbox?.runner.report()??null}),
  };
  window.pxCubeModel=bridge;
  if(page.sandbox) {
    const runner=page.sandbox.runner,next=runner.next,review=runner.review;
    runner.next=async()=>{try{return await next();}finally{ctx.checkpoint();}};
    runner.review=(...args)=>{const result=review(...args);ctx.checkpoint();return result;};
  }
  ctx.ready(bridge);
} catch(error) {
  ctx.stopped(error);document.body.replaceChildren();const pre=document.createElement('pre');pre.textContent='Stopped: '+String(error);document.body.append(pre);
}
