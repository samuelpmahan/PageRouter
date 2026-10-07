// Run the actual packaged model in isolated memory. No browser storage changes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const latest=JSON.parse(fs.readFileSync(path.join(root,'.pxcube/latest.json')));
const built=path.join(root,latest.site,'experiences/create-graphics');
const {openDemo}=await import(pathToFileURL(path.join(built,'model.mjs')));
const {archiveStorage}=await import(pathToFileURL(path.join(built,'archive-storage.mjs')));
const bytes=text=>Buffer.byteLength(text,'utf8');
const backing=new Map(),host={getItem:key=>backing.get(key)??null,setItem:(key,value)=>backing.set(key,value)};
const storage=await archiveStorage(host,'capacity:create');
const demo=await openDemo(storage),rows=demo.experience.shelf();
// The live recipe id comes from source, not a second benchmark implementation.
const {compositionStudies}=await import(pathToFileURL(path.join(built,'graphics.mjs')));
await demo.patch({design:{...demo.context.design,study:compositionStudies.find(s=>s.name==='Paper score slip').id}});
await demo.startCompetition([rows[0].address,rows[3].address,rows[4].address]);
const baseRaw=bytes(storage.getItem('')),basePacked=bytes([...backing.values()][0]);
const offers=[],samples=[],started=performance.now();
let stop='100 images reached';
for(let n=1;n<=100;n++){
  const t=performance.now(),m=demo.value(demo.context.competitionAddress),e=m.entries[(n-1)%3];
  await demo.editCompetition({kind:'turn',id:e.id});
  await demo.editCompetition({kind:'points',id:e.id,points:Math.floor((n-1)/3)});
  const editMs=performance.now()-t,tRender=performance.now(),render=await demo.renderCompetition(),renderMs=performance.now()-tRender;
  const tQueue=performance.now(),kept=await demo.captureCompetition(render,'mock.capacity');
  offers.push(kept.capture);const handoff=JSON.stringify(offers),queueMs=performance.now()-tQueue;
  const rawBytes=bytes(storage.getItem('')),packed=[...backing.values()][0],heap=process.memoryUsage();
  const sample={images:n,editMs,renderMs,queueMs,totalMs:performance.now()-t,svgBytes:bytes(render.graphic.svg),captureBytes:bytes(JSON.stringify(kept.capture)),rawArchiveBytes:rawBytes,packedArchiveBytes:bytes(packed),handoffBytes:bytes(handoff),localStorageUtf16Bytes:2*(packed.length+handoff.length),namedParts:demo.pxc.entries().length,rssBytes:heap.rss};
  samples.push(sample);
  if([1,2,5,10,20,25,50,75,100].includes(n))console.log(JSON.stringify(sample));
  if(rawBytes>64*1024*1024||heap.rss>512*1024*1024||performance.now()-started>45000){stop='Bounded measurement stopped to limit memory/time on this Mac';console.log(JSON.stringify({stop,last:sample}));break;}
}
const report={runId:latest.runId,environment:'Node on this Mac, isolated in-memory localStorage adapter; browser paint and Safari quota enforcement are not measured',scenario:'Three painted discs; each image changes turn and points; paper score slip; current build and exact archive/compression/handoff paths',baseRaw,basePacked,stop,samples};
fs.writeFileSync(path.join(root,'evidence/competition-queue/capacity.json'),JSON.stringify(report,null,2)+'\n');
