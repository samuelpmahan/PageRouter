import {captureConfig} from './runtime.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const {root,out,dir,pw,executable,referenceOrigin,previewBaseUrl,previewLeafUrl,integratedUrl}=captureConfig(import.meta.url);
const {chromium}=await import(pathToFileURL(pw));
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const evidence={schema:'homeroom-reference-interactions.v1',capturedAt:new Date().toISOString(),actions:[],pages:[]};
try {
  for (const [name,url,viewport] of [
    ['home-mobile-nav',`${referenceOrigin}/pages/homepage.html`,{width:390,height:844}],
    ['home-desktop-nav',`${referenceOrigin}/pages/homepage.html`,{width:1440,height:1000}],
    ['register-terms',`${referenceOrigin}/pages/register.html`,{width:1440,height:1000}],
    ['contact-counter',`${referenceOrigin}/pages/contact.html`,{width:390,height:844}],
  ]) {
    const page=await browser.newPage({viewport,deviceScaleFactor:1});
    const requests=[];
    page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1800);
    const before=await page.evaluate(()=>({
      url:location.href,
      buttons:[...document.querySelectorAll('button')].map((e,i)=>({index:i,text:e.innerText.trim(),aria:e.getAttribute('aria-label'),expanded:e.getAttribute('aria-expanded'),class:e.className})),
      links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href,visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)})),
      forms:[...document.forms].map(f=>({id:f.id,method:f.method,action:f.action,fields:[...f.elements].map(e=>({tag:e.tagName,name:e.name,type:e.type}))})),
      selects:[...document.querySelectorAll('select')].map(e=>({name:e.name,disabled:e.disabled,options:[...e.options].map(o=>({text:o.text,value:o.value,disabled:o.disabled}))})),
    }));
    let action=null;
    if(name.includes('nav')) {
      const button=page.getByRole('button',{name:'☰'});
      await button.click();
      await page.waitForTimeout(250);
      action='clicked hamburger once; no link followed';
    } else if(name==='register-terms') {
      await page.getByRole('button',{name:/Terms and Conditions/i}).click();
      await page.waitForTimeout(250);
      action='opened terms dialog; no acceptance checkbox changed';
    } else {
      await page.locator('textarea[name="message"]').fill('Reference-only draft');
      await page.waitForTimeout(100);
      action='typed unsent sample text in message field; submit not clicked';
    }
    const after=await page.evaluate(()=>({
      url:location.href,title:document.title,
      headings:[...document.querySelectorAll('h1,h2,h3,[role=dialog]')].map(e=>({tag:e.tagName,role:e.getAttribute('role'),text:e.innerText.trim().slice(0,1000)})),
      links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href,visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)})),
      controls:[...document.querySelectorAll('input,select,textarea,button')].map(e=>({tag:e.tagName.toLowerCase(),name:e.name||'',text:e.innerText?.trim()||'',value:e.value||'',ariaExpanded:e.getAttribute('aria-expanded'),checked:e.checked})),
      visibleText:document.body.innerText.slice(0,12000),
    }));
    const screenshot=join(dir,name+'.png');
    await page.screenshot({path:screenshot,fullPage:true});
    evidence.actions.push({name,action,screenshot,before,after,requests:requests.map(r=>({method:r.method,url:r.url.split('?')[0]}))});
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(join(out,'INTERACTION-EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({captures:evidence.actions.map(x=>({name:x.name,screenshot:x.screenshot,beforeButtons:x.before.buttons,afterVisibleText:x.after.visibleText.slice(0,500),links:x.after.links.filter(l=>l.visible)})),evidence:join(out,'INTERACTION-EVIDENCE.json')},null,2));
