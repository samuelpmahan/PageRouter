import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserConfig} from './browser-config.mjs';
const config=browserConfig(import.meta.url),{chromium}=await import(pathToFileURL(config.playwrightPath).href),browser=await chromium.launch(config.launch);
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
try{await page.goto(`${config.leaf||`${config.preview}/compiled/hh/index.html`}#/posts/topic-official-bug-forum`,{waitUntil:'networkidle'});await page.locator('.community-reply-body').first().waitFor();
 const readings=await page.evaluate(()=>['.community-reply-body','.community-reply-meta','.community-detail-meta','.community-detail-body'].flatMap(selector=>[...document.querySelectorAll(selector)].slice(0,3).map(e=>{
  const style=getComputedStyle(e),backgrounds=[];for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.backgroundColor!=='rgba(0, 0, 0, 0)')backgrounds.push({tag:p.tagName,class:p.className,color:s.backgroundColor,image:s.backgroundImage})}
  return {selector,text:e.textContent.trim().slice(0,100),color:style.color,fontSize:style.fontSize,backgrounds};
 })));
 const cssPath=resolve(config.builtRoot,'community.css'),cssHash=createHash('sha256').update(await readFile(cssPath)).digest('hex');
 await mkdir(config.output,{recursive:true});const stamp=new Date().toISOString().replace(/[^0-9TZ]/g,'');const out=resolve(config.output,`forum-readability-${stamp}`);await page.screenshot({path:`${out}.png`,fullPage:true});await writeFile(`${out}.json`,JSON.stringify({schema:'hh-readability-probe.v1',url:page.url(),compiledCssSha256:cssHash,readings},null,2)+'\n');console.log(JSON.stringify({output:`${out}.json`,compiledCssSha256:cssHash,readings}));
}finally{await browser.close()}
