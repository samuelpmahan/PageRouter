import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureConfig} from './runtime.mjs';
const {outputRoot:out,screenshotsDir:shots,playwrightPath,executable,referenceOrigin}=captureConfig(import.meta.url);
await mkdir(shots,{recursive:true});
const {chromium}=await import(pathToFileURL(playwrightPath));
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const runId=new Date().toISOString().replace(/[-:.]/g,'').replace('T','-').replace('Z','');
const states=[];
const requests=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 // Sorting is client-side. Block every non-GET and suppress passive ad/analytics traffic.
 await page.route('**/*',r=>{
  const req=r.request(),u=req.url();
  if(req.method()!=='GET'||/google\.com|doubleclick|googlesyndication|googleadservices|adtrafficquality/.test(u))return r.abort();
  return r.continue();
 });
 page.on('request',r=>requests.push({method:r.method(),url:r.url().split('?')[0]}));
 await page.goto(`${referenceOrigin}/pages/forum.html`,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>document.querySelectorAll('.post-title').length>0,{timeout:20000});
 for(const [state,selector] of [['default','#sort-date-newest'],['date-oldest','#sort-date-oldest'],['upvotes','#sort-upvotes']]) {
  if(state!=='default') {await page.locator(selector).click();await page.waitForTimeout(150);}
  const dom=await page.evaluate(()=>({url:location.href,title:document.title,order:[...document.querySelectorAll('.post-title')].map(e=>e.textContent.trim()),sortButtons:[...document.querySelectorAll('.sort-btn')].map(e=>({id:e.id,text:e.innerText.trim(),class:e.className,active:e.classList.contains('active-sort')})),cardCount:document.querySelectorAll('.post-title').length}));
  const screenshot=join(shots,`forum-sort-${runId}-${state}-desktop.png`);await page.screenshot({path:screenshot,fullPage:true});
  states.push({state,action:state==='default'?'Initial public list sort; no action.':`Clicked ${selector} (client-side sort only).`,screenshot,dom});
 }
 await page.close();
} finally {await browser.close();}
const report={schema:'homeroom-forum-sort-states.v1',capturedAt:new Date().toISOString(),limits:['Fresh unauthenticated browser; no credentials/session.','Only local in-page sort buttons were clicked; forms, New Post, post cards, votes and writes were not activated.','All non-GET requests and ad/analytics hosts were blocked.'],states,requests};
const file=join(out,'public-forum',`FORUM-SORT-INTERACTIONS-${runId}.json`);await mkdir(join(out,'public-forum'),{recursive:true});await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({evidence:file,states:states.map(s=>({state:s.state,order:s.dom.order,buttons:s.dom.sortButtons.map(b=>({id:b.id,active:b.active})),screenshot:s.screenshot})),requests},null,2));
