import {captureConfig} from './runtime.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {root,out,dir,pw,executable,referenceOrigin,previewBaseUrl,previewLeafUrl,integratedUrl}=captureConfig(import.meta.url);
const {chromium}=await import(pathToFileURL(pw)); await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const pages=[];
try {
 const login=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 await login.goto(`${referenceOrigin}/pages/login.html`,{waitUntil:'domcontentloaded',timeout:30000});
 await login.waitForTimeout(1000);
 const before=await login.evaluate(()=>({
   url:location.href,title:document.title,body:document.body.innerText.slice(0,3000),
   controls:[...document.querySelectorAll('input,button')].map(e=>({tag:e.tagName,text:e.innerText.trim(),name:e.name,type:e.type,onclick:e.getAttribute('onclick')})),
   forms:[...document.forms].map(f=>({method:f.method,action:f.action,fields:[...f.elements].map(e=>({name:e.name,type:e.type}))})),
   links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href,onclick:e.getAttribute('onclick')}))
 }));
 await login.getByRole('button',{name:/Forgot Password/i}).click();
 await login.waitForTimeout(500);
 const forgot=await login.evaluate(()=>({
   url:location.href,title:document.title,body:document.body.innerText.slice(0,5000),
   headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim()),
   controls:[...document.querySelectorAll('input,button')].map(e=>({tag:e.tagName,text:e.innerText.trim(),name:e.name,type:e.type})),
   forms:[...document.forms].map(f=>({method:f.method,action:f.action,fields:[...f.elements].map(e=>({name:e.name,type:e.type}))})),
   links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href}))
 }));
 const forgotShot=join(dir,'live-forgot-password.png'); await login.screenshot({path:forgotShot,fullPage:true});
 pages.push({name:'forgot-password-shell',url:forgot.url,screenshot:forgotShot,before,after:forgot});
 await login.close();

 const home=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await home.goto(`${referenceOrigin}/pages/homepage.html`,{waitUntil:'domcontentloaded',timeout:30000});
 await home.waitForTimeout(1500);
 const data=await home.evaluate(()=>({
   route:location.href,title:document.title,
   scripts:[...document.scripts].map(e=>e.src||'inline'),
   styles:[...document.querySelectorAll('link[rel=stylesheet]')].map(e=>e.href),
   buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText.trim(),type:e.type,href:e.getAttribute('href'),onclick:e.getAttribute('onclick'),parent:e.parentElement?.outerHTML.slice(0,500)})),
   allLinks:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href,hidden:!e.getClientRects().length})),
   forms:[...document.forms].map(f=>({method:f.method,action:f.action})),
   images:[...document.images].map(e=>({src:e.currentSrc.startsWith('data:')?'data:image/*':e.currentSrc,alt:e.alt,loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight})),
   fonts:{body:getComputedStyle(document.body).fontFamily,bodySize:getComputedStyle(document.body).fontSize,bodyBg:getComputedStyle(document.body).backgroundColor},
   pageWidth:{viewport:innerWidth,document:document.documentElement.scrollWidth}
 }));
 const homeShot=join(dir,'home-brand-assets.png'); await home.screenshot({path:homeShot,fullPage:true});
 pages.push({name:'homepage-route-and-asset-inventory',url:data.route,screenshot:homeShot,data});
 await home.close();

 const profile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 await profile.goto(`${referenceOrigin}/pages/teacher.html`,{waitUntil:'domcontentloaded',timeout:30000});
 await profile.waitForTimeout(1000);
 const profileShot=join(dir,'teacher-of-day-public-route-mobile.png'); await profile.screenshot({path:profileShot,fullPage:true});
 const publicProfile=await profile.evaluate(()=>({
   url:location.href,title:document.title,
   headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim()),
   buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText.trim(),type:e.type,onclick:e.getAttribute('onclick')})),
   links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href,target:e.target})),
   images:[...document.images].map(e=>({src:e.currentSrc.startsWith('data:')?'data:image/*':e.currentSrc,alt:e.alt,loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight})),
   text:document.body.innerText.slice(0,8000)
 }));
 pages.push({name:'featured-teacher-public-profile-mobile',url:publicProfile.url,screenshot:profileShot,data:publicProfile});
 await profile.close();
} finally {await browser.close();}
const evidence={schema:'homeroom-discoverability.v1',capturedAt:new Date().toISOString(),limits:['Navigation-only; no login, password recovery submit, or external wishlist/share action.','Donation, random-teacher action, forum/validation, and form POSTs were not activated.'],pages};
await writeFile(join(out,'DISCOVERABILITY-EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({pages:pages.map(p=>({name:p.name,url:p.url,screenshot:p.screenshot,headings:p.after?.headings||p.data?.headings,links:p.after?.links||p.data?.links})),evidence:join(out,'DISCOVERABILITY-EVIDENCE.json')},null,2));
