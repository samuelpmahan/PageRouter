import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserConfig} from './browser-config.mjs';
const config=browserConfig(import.meta.url),{chromium}=await import(pathToFileURL(config.playwrightPath).href),browser=await chromium.launch(config.launch);
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
try{await page.goto(config.leaf||`${config.preview}/compiled/hh/index.html#/`,{waitUntil:'networkidle'});
 const evidence=await page.evaluate(()=>{
  const target=document.querySelector('#hh-public-nav-toggle');const style=getComputedStyle(target),rect=target.getBoundingClientRect(),rules=[];
  function walk(list,href,conditions=[]){for(const rule of list){if(rule.selectorText){try{if(target.matches(rule.selectorText))rules.push({href,selector:rule.selectorText,css:rule.style.cssText,conditions})}catch{}}if(rule.cssRules?.length){const condition=rule.conditionText||'';walk(rule.cssRules,href,[...conditions,...(condition?[{condition,matches:rule instanceof CSSMediaRule?matchMedia(condition).matches:null}]:[])])}}}
  for(const sheet of document.styleSheets)try{walk(sheet.cssRules,sheet.href)}catch(error){rules.push({href:sheet.href,error:String(error)})}
  const ancestors=[];for(let e=target.parentElement;e;e=e.parentElement){const s=getComputedStyle(e),r=e.getBoundingClientRect();ancestors.push({tag:e.tagName,id:e.id,class:e.className,display:s.display,visibility:s.visibility,opacity:s.opacity,rect:{x:r.x,y:r.y,width:r.width,height:r.height}})}
  return {url:location.href,viewport:{width:innerWidth,height:innerHeight},menu:{display:style.display,visibility:style.visibility,opacity:style.opacity,hidden:target.hidden,styleAttribute:target.getAttribute('style'),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}},ancestors,rules};
 });await mkdir(config.output,{recursive:true});const stamp=new Date().toISOString().replace(/[^0-9TZ]/g,'');const out=resolve(config.output,`mobile-layout-probe-${stamp}.json`);await writeFile(out,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({output:out,...evidence}));
}finally{await browser.close()}
