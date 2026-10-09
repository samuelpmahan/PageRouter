import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {browserConfig} from './browser-config.mjs';

// Capture is evidence, not a pixel-parity verdict. Review the equalviewport pairs.
const config=browserConfig(import.meta.url);
const stamp=new Date().toISOString().replace(/[^0-9TZ]/g,'');
const output=resolve(config.output,process.env.HH_VERIFY_RUN||`public-${stamp}`);
await mkdir(resolve(output,'screenshots'),{recursive:true});
const leaf=config.leaf||`${config.preview}/compiled/hh/index.html`;
const {chromium}=await import(pathToFileURL(config.playwrightPath).href);
const routes=[['home','/'],['directory','/directory'],['register','/register'],['login','/login'],['forgot','/forgot'],['about','/about'],['contact','/contact'],['partners','/partners'],['teacher-of-day-public-route','/public-profile/reference-sarah'],['forum','/forum'],['forum-create','/pages/create_post.html'],['forum-post-missing','/pages/post.html'],['forum-post-detail','/forum']];
const selectedNames=process.env.HH_VERIFY_ROUTES?.split(',').filter(Boolean);if(selectedNames?.some(name=>!routes.some(([known])=>name===known)))throw new Error('Unknown capture route filter');const selectedRoutes=selectedNames?routes.filter(([name])=>selectedNames.includes(name)):routes;
const viewports=[['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]];
const receipt={schema:'hh-independent-public-capture.v1',createdAt:new Date().toISOString(),leaf,builtRoot:config.builtRoot,viewports:Object.fromEntries(viewports),screenshotState:'Initial route after a neutral pointer click; keyboard focus behavior is checked separately in browser-flows.mjs.',sourceHashes:{},builtHashes:{},routes:[],console:[],requests:[],failures:[],sourceStable:false,visualVerdict:'pending combined-image inspection'};
async function pin(folder){const map={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())await walk(path);else if(['.mjs','.css','.html','.json','.woff2','.png','.jpg','.ico'].includes(extname(path))){const bytes=await readFile(path);map[relative(config.root,path)]=createHash('sha256').update(bytes).digest('hex')}}}try{await walk(resolve(config.root,folder))}catch(error){receipt.failures.push({phase:'pin',folder,error:String(error.message)})}return map}
receipt.sourceHashes=await pin('checkpoint/vendor/hh/src');receipt.builtHashes=await pin(config.builtRoot);
const browser=await chromium.launch(config.launch);
try{
 for(const [device,viewport] of viewports){const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce'});
  for(const [name,hash] of selectedRoutes){const page=await context.newPage();const label=`${name}-${device}`;
   page.on('console',message=>receipt.console.push({label,type:message.type(),text:message.text().slice(0,2000)}));
   page.on('pageerror',error=>receipt.console.push({label,type:'pageerror',text:String(error).slice(0,2000)}));
   page.on('request',request=>receipt.requests.push({label,url:request.url(),method:request.method(),resourceType:request.resourceType()}));
   page.on('response',response=>{if(response.status()>=400)receipt.failures.push({label,phase:'http',status:response.status(),url:response.url()})});
   try{await page.goto(`${leaf}#${name==='teacher-of-day-public-route'?'/':hash}`,{waitUntil:'networkidle',timeout:15000});await page.locator('.hh-public-site').waitFor({timeout:8000});
    if(name==='teacher-of-day-public-route'){await page.getByRole('link',{name:/view.*(?:teacher|profile)/i}).first().click();await page.waitForURL(/reference-sarah/,{timeout:8000});await page.getByRole('heading',{name:'Sarah Endsley',exact:true}).waitFor({timeout:8000})}
    if(name==='forum-post-detail'){await page.locator('.community-topic h2 a').first().click();await page.getByRole('heading',{name:'Discussion Detail',exact:true}).waitFor({timeout:8000})}
    await page.evaluate(()=>document.fonts.ready);
    const images=page.locator('img');if(await images.count()>100)throw Error('Bounded route capture image count exceeded');for(const img of await images.all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode().catch(()=>{}))}await page.evaluate(()=>scrollTo(0,0));
    await page.mouse.click(1,viewport.height-1);await page.evaluate(()=>scrollTo(0,0));
    const metadata=await page.evaluate(()=>({url:location.href,title:document.title,page:document.querySelector('.hh-public-site')?.dataset.publicPage,headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent.trim()).slice(0,30),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,fontStatus:document.fonts.status,focusVisible:document.activeElement?.matches(':focus-visible'),brokenImages:[...document.images].filter(e=>!e.complete||e.naturalWidth===0).map(e=>e.src),links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.textContent.trim().slice(0,100),href:e.getAttribute('href')})).slice(0,100)}));
    const screenshot=resolve(output,'screenshots',`${label}.png`);await page.screenshot({path:screenshot,fullPage:true});await page.screenshot({path:resolve(output,'screenshots',`${label}-viewport.png`)});
    receipt.routes.push({label,requestedHash:hash,...metadata,screenshot:relative(config.root,screenshot)});
    if(metadata.scrollWidth>viewport.width+1)receipt.failures.push({label,phase:'overflow',expectedWidth:viewport.width,actualWidth:metadata.scrollWidth});
    if(metadata.brokenImages.length)receipt.failures.push({label,phase:'images',urls:metadata.brokenImages});
   }catch(error){receipt.failures.push({label,phase:'route',error:String(error.stack).slice(0,2500)});await page.screenshot({path:resolve(output,'screenshots',`${label}-failed.png`)}).catch(()=>{});}finally{await page.close()}
  }await context.close();
 }
}finally{await browser.close();receipt.afterSourceHashes=await pin('checkpoint/vendor/hh/src');receipt.afterBuiltHashes=await pin(config.builtRoot);receipt.completedAt=new Date().toISOString();receipt.sourceStable=JSON.stringify(receipt.sourceHashes)===JSON.stringify(receipt.afterSourceHashes);receipt.builtStable=JSON.stringify(receipt.builtHashes)===JSON.stringify(receipt.afterBuiltHashes);if(!receipt.sourceStable||!receipt.builtStable)receipt.failures.push({phase:'source-stability',error:'Source or assembled bytes changed during capture'});
 receipt.externalRuntimeRequests=receipt.requests.filter(r=>!['data:','blob:'].some(prefix=>r.url.startsWith(prefix))&&new URL(r.url).origin!==new URL(leaf).origin);
 if(receipt.externalRuntimeRequests.length)receipt.failures.push({phase:'external-runtime-network',requests:receipt.externalRuntimeRequests});
 await writeFile(resolve(output,'capture.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({output,routeCount:receipt.routes.length,failures:receipt.failures.length,sourceStable:receipt.sourceStable,visualVerdict:receipt.visualVerdict}));
}
process.exitCode=receipt.failures.length?1:0;
