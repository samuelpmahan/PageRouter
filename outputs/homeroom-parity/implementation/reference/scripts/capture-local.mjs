import {captureConfig} from './runtime.mjs';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const {root,out,dir,pw,executable,referenceOrigin,previewBaseUrl,previewLeafUrl,integratedUrl}=captureConfig(import.meta.url);
const {chromium}=await import(pathToFileURL(pw));
await mkdir(dir,{recursive:true});
const base=previewLeafUrl;
const routes=[['local-register','#/register'],['local-login','#/login'],['local-teachers','#/teachers']];
const sizes=[['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]];
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const results=[];
try {
  for(const [name,route] of routes) for(const [size,viewport] of sizes) {
    const page=await browser.newPage({viewport,deviceScaleFactor:1});
    const errors=[],failed=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
    const url=base+route;
    let response=null,error=null;
    try {
      response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>!document.body.innerText.includes('Opening the synthetic teacher preview'),{timeout:15000});
      await page.waitForTimeout(300);
    } catch(e) { error=e.message; }
    const dom=await page.evaluate(()=>({
      url:location.href,title:document.title,
      headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>({level:e.tagName,text:e.innerText.trim()})),
      links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href})),
      controls:[...document.querySelectorAll('input,select,textarea,button')].map(e=>({
        tag:e.tagName.toLowerCase(),type:e.type||'',name:e.name||'',id:e.id||'',text:e.innerText?.trim()||'',
        label:e.labels?[...e.labels].map(x=>x.innerText.trim()).join(' '):'',disabled:!!e.disabled,required:!!e.required,
        options:e.tagName==='SELECT'?[...e.options].map(o=>o.text):undefined
      })),
      images:[...document.images].map(e=>({src:e.currentSrc.startsWith('data:')?'data:image/*':e.currentSrc,alt:e.alt,loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight})),
      fonts:{body:getComputedStyle(document.body).fontFamily,h1:document.querySelector('h1')?getComputedStyle(document.querySelector('h1')).fontFamily:null},
      viewport:{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight},
      visibleText:document.body.innerText.slice(0,12000)
    })).catch(e=>({inspectionError:e.message}));
    const screenshot=join(dir,name+'-'+size+'.png');
    if(!error) await page.screenshot({path:screenshot,fullPage:true});
    results.push({name,size,requestedUrl:url,finalUrl:dom.url||null,status:response?.status()??null,error,screenshot:error?null:screenshot,dom,errors,failedRequests:failed});
    await page.close();
  }
} finally { await browser.close(); }
const evidence={
  schema:'homeroom-local-browser-comparison.v1',capturedAt:new Date().toISOString(),
  note:'Assembled local page; no form submit, simulated approval, login action, profile creation or persistent write was performed.',
  browser:{name:'Chromium headless shell',version:browser.version(),executable},
  viewport:{desktop:{width:1440,height:1000},mobile:{width:390,height:844}},
  results
};
await writeFile(join(out,'LOCAL-BROWSER-EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({results:results.map(({name,size,status,error,screenshot,finalUrl})=>({name,size,status,error,screenshot,finalUrl})),evidence:join(out,'LOCAL-BROWSER-EVIDENCE.json')},null,2));
