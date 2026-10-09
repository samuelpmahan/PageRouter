import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {captureConfig} from './runtime.mjs';

const {root,outputRoot,playwrightPath,executable,referenceOrigin}=captureConfig(import.meta.url);
const target=resolve(root,'work/PageRouter/checkpoint/vendor/hh/src/assets/reference/static/images/homepage/teacher-of-day.jpg');
await mkdir(dirname(target),{recursive:true});
const {chromium}=await import(pathToFileURL(playwrightPath));
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  // Public GETs only; block telemetry and every non-GET request.
  await page.route('**/*',route=>{
    const req=route.request(),url=req.url();
    if(req.method()!=='GET'||/google\.com|doubleclick|googlesyndication|googleadservices|adtrafficquality/.test(url)) return route.abort();
    return route.continue();
  });
  await page.goto(`${referenceOrigin}/pages/homepage.html`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>[...document.images].some(i=>i.alt==='Teacher Image'&&i.complete&&i.naturalWidth>0),{timeout:20000});
  const image=await page.locator('img[alt="Teacher Image"]').evaluate(async e=>{
    const src=e.currentSrc||e.src;
    const r=await fetch(src);
    const bytes=new Uint8Array(await r.arrayBuffer());
    let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return {alt:e.alt,srcPrefix:src.startsWith('data:')?src.slice(0,src.indexOf(',')+1):src,data:btoa(binary),width:e.naturalWidth,height:e.naturalHeight,loaded:e.complete&&e.naturalWidth>0,context:e.parentElement?.innerText.slice(0,220)};
  });
  const data=image.data; const bytes=Buffer.from(data,'base64');
  await writeFile(target,bytes);
  const result={schema:'homeroom-public-teacher-image.v1',capturedAt:new Date().toISOString(),page:`${referenceOrigin}/pages/homepage.html`,source:image.srcPrefix,alt:image.alt,context:image.context,loaded:image.loaded,dimensions:[image.width,image.height],path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),note:'Extracted only the displayed public homepage img[alt="Teacher Image"] payload. Anonymous GET only; non-GET requests and analytics/ad hosts were blocked. Source is an inline data image in the page response.'};
  const evidencePath=join(outputRoot,'public-forum','TEACHER-OF-DAY-IMAGE.json');
  await mkdir(dirname(evidencePath),{recursive:true}); await writeFile(evidencePath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,source:'data:image/jpeg;base64,[omitted]'},null,2));
} finally {await browser.close();}
