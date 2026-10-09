import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureConfig} from './runtime.mjs';

const {outputRoot:out,screenshotsDir:shots,playwrightPath,executable,referenceOrigin}=captureConfig(import.meta.url);
const evidenceDir=join(out,'public-forum');
await mkdir(shots,{recursive:true});
await mkdir(evidenceDir,{recursive:true});
const {chromium}=await import(pathToFileURL(playwrightPath));
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const routes=[
  ['forum-list','/pages/forum.html'],
  ['create-post','/pages/create_post.html'],
  ['post-detail-no-id','/pages/post.html'],
];
const results=[];
const blockedActions=[];
const runId=new Date().toISOString().replace(/[-:.]/g,'').replace('T','-').replace('Z','');
try {
  for(const [name,path] of routes) for(const [size,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const page=await browser.newPage({viewport,deviceScaleFactor:1});
    const requests=[],responses=[],errors=[],interceptedRequests=[];
    await page.route('**/*',route=>{const req=route.request(),url=req.url();if(req.method()!=='GET'||/google\.com|doubleclick|googlesyndication|googleadservices|adtrafficquality/.test(url)){interceptedRequests.push({method:req.method(),url:url.split('?')[0]});return route.abort();}return route.continue();});
    page.on('request',r=>requests.push({method:r.method(),url:r.url().split('?')[0]}));
    page.on('response',r=>responses.push({status:r.status(),url:r.url().split('?')[0]}));
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const requestedUrl=`${referenceOrigin}${path}`;
    let status=null,navigationError=null;
    try {
      const resp=await page.goto(requestedUrl,{waitUntil:'domcontentloaded',timeout:30000});
      status=resp?.status()??null;
      await page.waitForTimeout(2400);
      await page.evaluate(()=>document.fonts?.ready);
    } catch(e) {navigationError=e.message;}
    const inspect=async()=>page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      const short=e=>e.innerText?.trim().replace(/\s+/g,' ').slice(0,300)||'';
      return {
        url:location.href,title:document.title,
        headings:[...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(e=>({tag:e.tagName,text:short(e)})),
        bodyText:document.body.innerText.slice(0,10000),
        controls:[...document.querySelectorAll('input,textarea,select,button')].filter(visible).map(e=>({tag:e.tagName.toLowerCase(),type:e.type||'',id:e.id||'',name:e.name||'',placeholder:e.placeholder||'',text:short(e),value:e.value||'',required:!!e.required,disabled:!!e.disabled,ariaExpanded:e.getAttribute('aria-expanded'),ariaLabel:e.getAttribute('aria-label')})),
        forms:[...document.forms].filter(visible).map(f=>({id:f.id||'',method:f.method,action:f.action,fields:[...f.elements].map(e=>({tag:e.tagName.toLowerCase(),id:e.id||'',name:e.name||'',type:e.type||'',required:!!e.required,maxlength:e.maxLength>=0?e.maxLength:null}))})),
        links:[...document.querySelectorAll('a[href]')].filter(visible).map(a=>({text:short(a),href:a.href,target:a.target||''})),
        classes:{loading:[...document.querySelectorAll('[id*=loading],[class*=loading]')].filter(visible).map(short),empty:[...document.querySelectorAll('[id*=empty],[id*=no-],[class*=empty]')].filter(visible).map(short)},
        dimensions:{viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],scrollY},
      };
    });
    const dom=await inspect();
    const screenshot=join(shots,`forum-${runId}-${name}-${size}.png`);
    await page.screenshot({path:screenshot,fullPage:true});
    results.push({name,size,requestedUrl,status,navigationError,finalUrl:dom.url,screenshot,dom,requests,responses,errors,interceptedRequests});
    if(name==='forum-list') {
      try {
        const menu=page.getByRole('button',{name:'☰'});
        if(await menu.count()) {
          await menu.first().click(); await page.waitForTimeout(250);
          const menuDom=await inspect();
          const menuShot=join(shots,`forum-${runId}-menu-open-${size}.png`);
          await page.screenshot({path:menuShot,fullPage:true});
          results.push({name:'forum-menu-open',size,requestedUrl,status,finalUrl:page.url(),screenshot:menuShot,action:'Opened hamburger; no menu link followed.',dom:menuDom,errors});
        }
      } catch(e) {blockedActions.push({name:'forum-menu-open',size,error:e.message});}
    }
    await page.close();
  }
} finally {await browser.close();}
const report={schema:'homeroom-public-forum-browser-capture.v1',capturedAt:new Date().toISOString(),referenceOrigin,viewports:{desktop:{width:1440,height:1000},mobile:{width:390,height:844}},limits:['Fresh unauthenticated browser context; no login/session supplied.','Public page scripts were allowed to load; only observed requests are listed. No forms submitted, no votes/comments/deletes/posts, no authenticated actions.','A 200 public HTML shell does not prove server-backed data, role permissions, or authenticated UI behavior.'],routes:results,blockedActions};
const file=join(evidenceDir,`FORUM-PUBLIC-CAPTURE-${runId}.json`);
await writeFile(file,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({evidence:file,routes:results.map(x=>({name:x.name,size:x.size,status:x.status,finalUrl:x.finalUrl,screenshot:x.screenshot,headings:x.dom?.headings,forms:x.dom?.forms?.map(f=>({id:f.id,method:f.method,action:f.action,fields:f.fields})) ,errors:x.errors,requests:x.requests?.map(r=>r.method+' '+r.url)})),blockedActions},null,2));
