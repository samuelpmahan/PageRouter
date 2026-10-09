import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {browserConfig} from './browser-config.mjs';
const config=browserConfig(import.meta.url),stamp=new Date().toISOString().replace(/[^0-9TZ]/g,'');
const output=resolve(config.output,process.env.HH_VERIFY_RUN||`focus-${stamp}`),leaf=config.leaf||`${config.preview}/compiled/hh/index.html`;
await mkdir(output,{recursive:true});
const receipt={schema:'hh-independent-focus-capture.v1',leaf,builtRoot:config.builtRoot,createdAt:new Date().toISOString(),states:[],console:[],requests:[],failures:[]};
async function pin(){const result={};for(const [kind,base] of [['source',resolve(config.root,'checkpoint/vendor/hh/src')],['built',config.builtRoot]])for(const name of ['app.mjs','public-site.mjs','public-site.css'])result[`${kind}/${name}`]=createHash('sha256').update(await readFile(resolve(base,name))).digest('hex');return result}
receipt.before=await pin();
const {chromium}=await import(pathToFileURL(config.playwrightPath).href),browser=await chromium.launch(config.launch);
try{
 for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce'});context.setDefaultTimeout(8000);
  for(const state of ['menu','terms']){const page=await context.newPage(),label=`${state}-${device}`;
   page.on('console',m=>receipt.console.push({label,type:m.type(),text:m.text().slice(0,2000)}));page.on('pageerror',e=>receipt.console.push({label,type:'pageerror',text:String(e)}));page.on('request',r=>receipt.requests.push({label,url:r.url(),method:r.method()}));
   try{
    await page.goto(`${leaf}#/${state==='menu'?'':'register'}`,{waitUntil:'networkidle'});await page.locator('.hh-public-site').waitFor();await page.evaluate(()=>document.fonts.ready);
    if(state==='menu'){await page.locator('#hh-public-nav-toggle').click();assert.equal(await page.locator('#hh-public-nav-toggle').getAttribute('aria-expanded'),'true');}
    else {await page.locator('#hh-terms-open').click();await page.locator('[role=dialog]').waitFor();assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role=dialog]')),true);}
    const metadata=await page.evaluate(()=>({url:location.href,viewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,active:document.activeElement?.id,dialog:[...document.querySelectorAll('[role=dialog]')].map(e=>({id:e.id,text:e.textContent.slice(0,200),rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}))}));
    await page.screenshot({path:resolve(output,`${label}.png`),fullPage:true});await page.screenshot({path:resolve(output,`${label}-viewport.png`)});
    receipt.states.push({label,...metadata});assert.ok(metadata.scrollWidth<=viewport.width+1);
   }catch(error){receipt.failures.push({label,error:String(error.stack).slice(0,2500)})}finally{await page.close()}
  }await context.close();
 }
}finally{await browser.close();receipt.after=await pin();receipt.sourceStable=JSON.stringify(receipt.before)===JSON.stringify(receipt.after);receipt.externalRuntimeRequests=receipt.requests.filter(r=>!r.url.startsWith('data:')&&!r.url.startsWith('blob:')&&new URL(r.url).origin!==new URL(leaf).origin);receipt.completedAt=new Date().toISOString();receipt.passed=receipt.sourceStable&&!receipt.failures.length&&!receipt.externalRuntimeRequests.length&&!receipt.console.some(x=>['error','pageerror'].includes(x.type));await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({output,passed:receipt.passed,sourceStable:receipt.sourceStable,failures:receipt.failures}));}
process.exitCode=receipt.passed?0:1;
