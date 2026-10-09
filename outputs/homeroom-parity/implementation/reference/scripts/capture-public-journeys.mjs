import {captureConfig} from './runtime.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const {root,out,dir,pw,executable,referenceOrigin,previewBaseUrl,previewLeafUrl,integratedUrl}=captureConfig(import.meta.url);
const {chromium}=await import(pathToFileURL(pw));
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const records=[];
async function snapshot(page,name,action) {
  await page.waitForTimeout(300);
  const dom=await page.evaluate(()=>({
    url:location.href,title:document.title,
    headings:[...document.querySelectorAll('h1,h2,h3')].map(x=>x.innerText.trim()),
    controls:[...document.querySelectorAll('input,select,textarea,button')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height;}).map(e=>({tag:e.tagName.toLowerCase(),name:e.name||'',text:e.innerText.trim(),type:e.type||'',href:e.getAttribute('href')||'',disabled:e.disabled,placeholder:e.placeholder||''})),
    links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href})),
    text:document.body.innerText.slice(0,12000)
  }));
  const path=join(dir,name+'.png');
  await page.screenshot({path,fullPage:true});
  records.push({name,action,url:dom.url,screenshot:path,dom});
}
try {
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  const network=[];
  page.on('request',r=>network.push({method:r.method(),url:r.url().split('?')[0]}));
  await page.goto(`${referenceOrigin}/pages/homepage.html`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(2000);
  await page.getByRole('button',{name:'☰'}).click();
  await snapshot(page,'home-mobile-menu-expanded','opened public navigation menu; did not follow link');
  const menu=await page.evaluate(()=>[...document.querySelectorAll('button')].map(e=>({text:e.innerText.trim(),visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length),class:e.className})));
  const visibleLogin=page.getByRole('button',{name:'Login',exact:true});
  await visibleLogin.click();
  await snapshot(page,'live-login-shell','opened the public sign-in entry; entered no identity and did not authenticate');
  const loginForms=await page.locator('form').evaluateAll(fs=>fs.map(f=>({method:f.method,action:f.action,fields:[...f.elements].map(e=>({tag:e.tagName,name:e.name,type:e.type}))})));
  records.at(-1).loginForms=loginForms;
  records.at(-1).menuButtons=menu;
  records.at(-1).network=network.map(r=>({method:r.method,url:r.url}));
  await page.close();

  const teacher=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const teacherNetwork=[];
  teacher.on('request',r=>teacherNetwork.push({method:r.method(),url:r.url().split('?')[0]}));
  await teacher.goto(`${referenceOrigin}/pages/homepage.html`,{waitUntil:'domcontentloaded',timeout:30000});
  await teacher.waitForTimeout(2000);
  const candidate=teacher.getByRole('button',{name:'View Teacher of the Day',exact:true});
  const exists=await candidate.count();
  let clicked=false;
  if(exists){await candidate.click();clicked=true;}
  await teacher.waitForTimeout(2000);
  await snapshot(teacher,'teacher-of-day-public-route',clicked?'opened featured teacher public destination without auth or write':'CTA absent after load');
  records.at(-1).network=teacherNetwork.map(r=>({method:r.method,url:r.url}));
  await teacher.close();
} finally { await browser.close(); }
const result={
  schema:'homeroom-public-journey-evidence.v1',capturedAt:new Date().toISOString(),
  limits:['No live form was submitted.','No sign-in/authentication was completed.','No donation or contact was initiated.','Only public UI entry controls were opened.'],
  pages:records
};
await writeFile(join(out,'PUBLIC-JOURNEY-EVIDENCE.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pages:records.map(r=>({name:r.name,url:r.url,screenshot:r.screenshot,headings:r.dom.headings,text:r.dom.text.slice(0,900),loginForms:r.loginForms})),evidence:join(out,'PUBLIC-JOURNEY-EVIDENCE.json')},null,2));
