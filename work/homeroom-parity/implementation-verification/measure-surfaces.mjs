import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserConfig} from './browser-config.mjs';
const config=browserConfig(import.meta.url),leaf=config.leaf||`${config.preview}/compiled/hh/index.html`,stamp=new Date().toISOString().replace(/[^0-9TZ]/g,'');
const receipt={schema:'hh-independent-surface-measurements.v1',leaf,builtRoot:config.builtRoot,createdAt:new Date().toISOString(),snapshots:[]};
const cssPath=resolve(config.builtRoot,'public-site.css');receipt.cssSha256=createHash('sha256').update(await readFile(cssPath)).digest('hex');
const {chromium}=await import(pathToFileURL(config.playwrightPath).href),browser=await chromium.launch(config.launch);
try{for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
 const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce'});
 for(const route of ['home','register','about','contact','partners','profile','forum','forum-detail']){
  const page=await context.newPage();await page.goto(`${leaf}#/${route==='profile'?'':route==='forum-detail'?'posts/topic-forum-styling-guide':route==='home'?'':route}`,{waitUntil:'networkidle'});await page.locator('.hh-public-site').waitFor();
  if(route==='profile'){await page.locator('#hh-home-teacher-of-day').click();await page.waitForFunction(()=>document.querySelector('.hh-public-site')?.dataset.publicPage==='profile')}
  await page.evaluate(()=>document.fonts.ready);
  const readings=await page.evaluate(()=>{
   const selectors=['.hh-header','.hh-header-inner','.hh-logo','.hh-hero','.hh-hero-copy','.hh-impact','.hh-home-tiles','.hh-tile','.hh-tile h2','.hh-tile h3','.hh-tile p','.hh-tile a','.hh-tile button','.hh-registration-card','#hh-register-form','.hh-card','.hh-card>h1','.hh-card>h2','.hh-field','.hh-field input','.hh-field select','.hh-person','.hh-person img','.hh-person p','.hh-partner-grid','.hh-partner','.hh-partner img','.hh-social-list','.hh-social-list tr','.hh-social-list a','.hh-social-list i','.hh-reference-profile-image','.hh-reference-profile-head h1','.hh-reference-profile-head p','.hh-reference-profile .hh-intro','.community-detail-title','.community-topic h2','button[type=submit]','.hh-footer','.hh-footer p'];
   return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].slice(0,8).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {selector,tag:e.tagName,id:e.id,className:e.className,text:e.textContent.trim().slice(0,160),rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:{fontFamily:s.fontFamily,fontSize:s.fontSize,lineHeight:s.lineHeight,fontWeight:s.fontWeight,color:s.color,backgroundColor:s.backgroundColor,padding:s.padding,margin:s.margin,textAlign:s.textAlign,display:s.display,gridTemplateColumns:s.gridTemplateColumns,gap:s.gap,objectFit:s.objectFit}}}));
  });receipt.snapshots.push({route,device,viewport,url:page.url(),readings});await page.close();
 }await context.close();
}}finally{await browser.close();receipt.afterCssSha256=createHash('sha256').update(await readFile(cssPath)).digest('hex');receipt.builtStable=receipt.cssSha256===receipt.afterCssSha256;receipt.completedAt=new Date().toISOString();await mkdir(config.output,{recursive:true});const out=resolve(config.output,`surface-measurements-${stamp}.json`);await writeFile(out,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({output:out,builtStable:receipt.builtStable,snapshots:receipt.snapshots.length}));}
