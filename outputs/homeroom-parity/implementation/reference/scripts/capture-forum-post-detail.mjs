import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureConfig} from './runtime.mjs';
const {outputRoot:out,screenshotsDir:shots,playwrightPath,executable,referenceOrigin}=captureConfig(import.meta.url);
const evidenceDir=join(out,'public-forum');
await mkdir(shots,{recursive:true});await mkdir(evidenceDir,{recursive:true});
const {chromium}=await import(pathToFileURL(playwrightPath));
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const runId=new Date().toISOString().replace(/[-:.]/g,'').replace('T','-').replace('Z','');
const results=[];
try {
 for(const [size,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
  const page=await browser.newPage({viewport,deviceScaleFactor:1});
  const requests=[],responses=[],errors=[],blockedRequests=[];
  await page.route('**/*',route=>{const req=route.request(),url=req.url();if(req.method()!=='GET'||/google\.com|doubleclick|googlesyndication|googleadservices|adtrafficquality/.test(url)){blockedRequests.push({method:req.method(),url:url.split('?')[0]});return route.abort();}return route.continue();});
  page.on('request',r=>requests.push({method:r.method(),url:r.url().split('?')[0]}));
  page.on('response',r=>responses.push({status:r.status(),url:r.url().split('?')[0]}));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${referenceOrigin}/pages/forum.html`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('.post-title',{timeout:20000});
  const first=page.locator('.post-title').first();
  const source=await first.evaluate(e=>({title:e.innerText.trim(),href:e.closest('a')?.href||''}));
  await Promise.all([
   page.waitForURL(/\/pages\/post\.html\?/,{timeout:20000}),
   first.click()
  ]);
  await page.waitForTimeout(1800);
  const dom=await page.evaluate(()=>{
   const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
   const short=e=>e.innerText?.trim().replace(/\s+/g,' ').slice(0,300)||'';
   return {url:location.href,title:document.title,headings:[...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(e=>({tag:e.tagName,text:short(e)})),bodyText:document.body.innerText.slice(0,12000),forms:[...document.forms].filter(vis).map(f=>({id:f.id||'',method:f.method,action:f.action,fields:[...f.elements].map(e=>({tag:e.tagName.toLowerCase(),id:e.id||'',name:e.name||'',type:e.type||'',placeholder:e.placeholder||'',required:!!e.required,maxlength:e.maxLength>=0?e.maxLength:null}))})),controls:[...document.querySelectorAll('input,textarea,select,button')].filter(vis).map(e=>({tag:e.tagName.toLowerCase(),id:e.id||'',name:e.name||'',type:e.type||'',text:short(e),placeholder:e.placeholder||'',value:e.value||'',required:!!e.required,disabled:!!e.disabled,ariaLabel:e.getAttribute('aria-label')||''})),links:[...document.querySelectorAll('a[href]')].filter(vis).map(a=>({text:short(a),href:a.href})),images:[...document.images].filter(vis).map(i=>({alt:i.alt,src:i.currentSrc.startsWith('data:')?'data-image':i.currentSrc,width:i.naturalWidth,height:i.naturalHeight,loaded:i.complete&&i.naturalWidth>0})),viewport:{width:innerWidth,height:innerHeight,docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight}};
  });
  const screenshot=join(shots,`forum-${runId}-post-detail-${size}.png`);await page.screenshot({path:screenshot,fullPage:true});
  results.push({size,viewport,entry:{route:'https://www.helpteachers.net/pages/forum.html',firstCard:source},requestedPostHref:source.href,finalUrl:dom.url,screenshot,dom,requests,responses,blockedRequests,errors});
  await page.close();
 }
} finally {await browser.close();}
const report={schema:'homeroom-public-forum-post-detail.v1',capturedAt:new Date().toISOString(),runId,limits:['Fresh anonymous session; no login or auth cookie.','Navigated by clicking the first public forum card only; no vote, comment, edit, delete or create action was activated.','Non-GET requests and Google/DoubleClick analytics/ad hosts were blocked. Public GET page/data requests were allowed.'],results};
const file=join(evidenceDir,`FORUM-POST-DETAIL-${runId}.json`);await writeFile(file,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({evidence:file,results:results.map(r=>({size:r.size,postHref:r.requestedPostHref,url:r.finalUrl,screenshot:r.screenshot,headings:r.dom.headings,forms:r.dom.forms,controls:r.dom.controls.map(c=>({id:c.id,name:c.name,type:c.type,text:c.text,required:c.required,placeholder:c.placeholder})),requests:r.requests.filter(x=>x.url.includes('/forum/')||x.url.includes('/api/profile/')),responses:r.responses.filter(x=>x.url.includes('/forum/')||x.url.includes('/api/profile/')),blockedRequests:r.blockedRequests}))},null,2));
