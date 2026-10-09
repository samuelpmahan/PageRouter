import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserConfig} from './browser-config.mjs';
const config=browserConfig(import.meta.url),{chromium}=await import(pathToFileURL(config.playwrightPath).href),browser=await chromium.launch(config.launch),page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
try{await page.goto(`${config.leaf||`${config.preview}/compiled/hh/index.html`}#/`,{waitUntil:'networkidle'});await page.getByRole('link',{name:/view.*(?:teacher|profile)/i}).first().click();await page.waitForURL(/reference-sarah/);
 const frames=await page.evaluate(async()=>{const readings=[];function snapshot(frame){readings.push({frame,url:location.href,page:document.querySelector('.hh-public-site')?.dataset.publicPage,route:window.hhPreview?.state.route,scrollY,activeId:document.activeElement?.id,headings:[...document.querySelectorAll('h1,h3')].map(e=>({tag:e.tagName,text:e.textContent.trim()}))})}snapshot(0);for(let i=1;i<=5;i++){await new Promise(requestAnimationFrame);snapshot(i)}return readings});
 await mkdir(config.output,{recursive:true});const out=resolve(config.output,`navigation-probe-${new Date().toISOString().replace(/[^0-9TZ]/g,'')}.json`);await writeFile(out,JSON.stringify({schema:'hh-route-frame-probe.v1',frames},null,2)+'\n');console.log(JSON.stringify({output:out,frames}));
}finally{await browser.close()}
