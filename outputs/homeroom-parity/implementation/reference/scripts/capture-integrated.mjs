import {captureConfig} from './runtime.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {root,out,dir,pw,executable,referenceOrigin,previewBaseUrl,previewLeafUrl,integratedUrl}=captureConfig(import.meta.url);
const {chromium}=await import(pathToFileURL(pw)); await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const results=[];
try {
 for(const [size,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
   const page=await browser.newPage({viewport,deviceScaleFactor:1});
   const errors=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
   const url=integratedUrl;
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForTimeout(1200);
   const dom=await page.evaluate(()=>({
     url:location.href,title:document.title,
     headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim()),
     links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href})),
     iframes:[...document.querySelectorAll('iframe')].map(e=>({src:e.src,title:e.title,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),
     text:document.body.innerText.slice(0,12000),
     viewport:{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight}
   }));
   const screenshot=join(dir,'integrated-hh-run-'+size+'.png'); await page.screenshot({path:screenshot,fullPage:true});
   results.push({size,url,responseStatus:response.status(),screenshot,dom,errors,requests:requests.map(r=>({method:r.method,url:r.url.split('?')[0]}))});
   await page.close();
 }
} finally {await browser.close();}
const evidence={schema:'homeroom-pagerouter-integrated.v1',capturedAt:new Date().toISOString(),preview:integratedUrl,results};
await writeFile(join(out,'INTEGRATED-ROUTE-EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({results:results.map(r=>({size:r.size,status:r.responseStatus,screenshot:r.screenshot,headings:r.dom.headings,iframes:r.dom.iframes,errors:r.errors})),evidence:join(out,'INTEGRATED-ROUTE-EVIDENCE.json')},null,2));
