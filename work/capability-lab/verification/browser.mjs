import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {get} from 'node:http';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const product=resolve(process.env.CAPABILITY_PRODUCT_ROOT??process.argv[2]??join(root,'outputs/capability-lab')),evidence=resolve(process.env.CAPABILITY_EVIDENCE_ROOT??join(product,'evidence/independent'));
const node=process.env.CAPABILITY_NODE??process.execPath;
const cache=resolve(process.env.CAPABILITY_BROWSER_CACHE??join(root,'work/toolteam/browser'));
const playwright=process.env.CAPABILITY_PLAYWRIGHT_MODULE??join(cache,'node_modules/playwright/index.mjs');
const executable=process.env.CAPABILITY_CHROMIUM_PATH??join(cache,'browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
const libraryPath=process.env.CAPABILITY_CHROMIUM_LIBS??['usr/lib/x86_64-linux-gnu','lib/x86_64-linux-gnu','usr/lib','lib'].map(p=>join(cache,'deps',p)).join(':');
const {chromium}=await import(pathToFileURL(playwright));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const report={schema:'capability-lab.independent.browser.v1',generatedAt:new Date().toISOString(),checks:[],screenshots:[],errors:[],resourceSnapshots:[]};
const sourcePaths=['index.html','ui/app.mjs','ui/style.css','ui/statistics.mjs','ui/linalg.mjs','src/runtime/index.mjs',
  'src/statistics/index.mjs','src/statistics/core.mjs','src/statistics/order.mjs','src/statistics/inference.mjs',
  'src/linalg/index.mjs','src/linalg/basics.mjs','src/linalg/numerics.mjs','src/composed/index.mjs'];
async function fingerprints(){return Promise.all(sourcePaths.map(async path=>{const bytes=await readFile(join(product,path));return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));}
function httpBytes(url){return new Promise((resolve,reject)=>{
  const request=get(url,response=>{const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024)response.destroy(Error('source response exceeds 1MiB verifier bound'));else chunks.push(chunk);});
    response.on('end',()=>resolve({status:response.statusCode,bytes:Buffer.concat(chunks)}));response.on('error',reject);});
  request.setTimeout(10000,()=>request.destroy(Error('source HTTP verification timeout')));request.on('error',reject);
});}
const canonical=value=>JSON.stringify(sort(value));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
function nearNumbers(a,b){if(Array.isArray(b)){assert.equal(a.length,b.length);b.forEach((v,i)=>nearNumbers(a[i],v));}else{assert.ok(Number.isFinite(a));assert.ok(Math.abs(a-b)<=1e-10+1e-10*Math.abs(b),`${a} != ${b}`);}}
let service,browser,page;
let servicePid=Number(process.env.CAPABILITY_SERVICE_PID)||null;
const url=process.env.CAPABILITY_PREVIEW_URL??'http://127.0.0.1:4189';
await mkdir(evidence,{recursive:true});
async function check(name,action){try{const observed=await action();report.checks.push({name,status:'pass',...(observed?{observed}:{})});}catch(error){report.checks.push({name,status:'fail',error:error.message});}}
function snapshot(label){
  const path=join(evidence,`browser-resource-${stamp}-${label}.json`);
  const args=[join(here,'preflight.py'),'--output',path,'--managed-pid',String(process.pid)];
  if(servicePid)args.push('--managed-pid',String(servicePid));
  const snapshot=JSON.parse(execFileSync('python3',args,{encoding:'utf8',timeout:10000,maxBuffer:250000}));
  report.resourceSnapshots.push({label,path,managedObservation:snapshot.managedObservation});
  assert.ok(snapshot.managedObservation.belowBudgetAtSnapshot,'managed service/browser RSS exceeds 2GiB snapshot budget');
}
async function screenshot(label){const path=join(evidence,`browser-${stamp}-${label}.png`);await page.locator('#input-editor').evaluate(element=>element.scrollTop=0);await page.screenshot({path,fullPage:false});report.screenshots.push({label,path});}
async function choose(id){
  await page.locator('#search-capabilities').fill(id);
  await page.locator(`#capability-list [data-id="${id}"]`).click();
  await page.waitForFunction(id=>document.querySelector('#capability-select').value===id,id);
  await page.locator('#search-capabilities').fill('');
}
async function run(input){
  await page.locator('#input-editor').fill(JSON.stringify(input,null,2));
  const before=await page.evaluate(()=>window.__independentExecutions.length);
  await page.locator('#run-button').click();
  await page.waitForFunction(n=>window.__independentExecutions.length>n,before,{timeout:10000});
  return page.evaluate(()=>window.__independentExecutions.at(-1).execution);
}
try{
  if(!process.env.CAPABILITY_PREVIEW_URL){
    service=spawn(node,[join(product,'serve.mjs'),'4189'],{cwd:product,stdio:['ignore','pipe','pipe']});servicePid=service.pid;
    let startup='';service.stdout.on('data',chunk=>startup+=chunk.toString());
    service.stderr.on('data',chunk=>report.errors.push(`service: ${chunk.toString().slice(0,500)}`));
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Service startup timed out')),10000);
      const ready=()=>{if(startup.includes('available at')){clearTimeout(timeout);resolve();}else setTimeout(ready,50);};ready();
      service.once('exit',code=>{clearTimeout(timeout);reject(Error(`Service exited ${code}`));});
    });
  }
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:libraryPath}});
  page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  const response=await page.goto(url,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.capabilityLab?.capabilities?.length>0,{timeout:10000});
  await page.evaluate(()=>{window.__independentExecutions=[];document.addEventListener('capabilitylab:execution',event=>window.__independentExecutions.push(event.detail));});
  report.runtime={url,playwrightModule:playwright,chromiumExecutable:executable,browserVersion:browser.version(),servicePid};
  report.sourceFiles=await fingerprints();
  await check('served sources match recorded local bytes',async()=>{
    for(const source of report.sourceFiles){const response=await httpBytes(new URL(source.path,url));assert.equal(response.status,200);assert.equal(createHash('sha256').update(response.bytes).digest('hex'),source.sha256);}
    return {files:report.sourceFiles.length,identity:'SHA-256 independent file/HTTP evidence; runtime source/version remain declared labels'};
  });
  await check('configured service plus browser budget snapshot',()=>snapshot('loaded'));
  await check('real edited mean input changes answer',async()=>{
    await choose('statistics.mean');const first=await run({values:[1,2,3,4]}),second=await run({values:[10,20,30,40]});
    assert.equal(first.result.value,2.5);assert.equal(second.result.value,25);assert.notEqual(first.replay.resultHash,second.replay.resultHash);
    assert.ok((await page.locator('#result').textContent()).includes('25'));
    assert.ok(await page.locator('.explanation-card').count()>0,'result explanation absent');
    await page.locator('#replay-button').click();await page.waitForFunction(()=>document.querySelector('#run-status').textContent.includes('Replay matches'));
    return {first:first.result,changed:second.result,replayed:true};
  });
  const capabilities=await page.evaluate(()=>window.capabilityLab.capabilities);
  const recipe=capabilities.filter(c=>c.id.startsWith('composed.')&&c.order>=3).sort((a,b)=>b.order-a.order)[0];
  await check('higher-order recipe UI exposes real graph and trace',async()=>{
    assert.ok(recipe,'cross-domain recipe of at least order 3 absent');await choose(recipe.id);
    const receipt=await run(recipe.examples[0].input);
    assert.ok(await page.locator('#dependency-graph .graph-node').count()>=4,'dependency map hides composition');
    await page.locator('[data-view="trace"]').click();
    const rows=await page.locator('#execution-trace .trace-node').count();assert.ok(rows>=4,'actual calls missing from trace');
    await screenshot('recipe-trace');
    await page.locator('[data-view="result"]').click();await screenshot('recipe-result');
    await page.locator('[data-view="visual"]').click();
    assert.ok(await page.locator('#data-view svg,#data-view .vector-cell,#data-view .matrix-cell').count()>0,'recipe data view has no meaningful numeric visual');
    await screenshot('recipe-visual');
    return {id:recipe.id,order:recipe.order,traceRows:rows,receipt};
  });
  await check('Node and browser recipe canonical output agree',async()=>{
    assert.ok(recipe);const modules=await Promise.all(['statistics','linalg','composed'].map(d=>import(pathToFileURL(join(product,`src/${d}/index.mjs`)))));
    const {createRegistry}=await import(pathToFileURL(join(product,'src/runtime/index.mjs')));
    const r=createRegistry(modules.flatMap(m=>m.capabilities),{source:'independent-node-parity',version:'1'});
    const nodeReceipt=r.execute(recipe.id,recipe.examples[0].input);
    const browserReceipt=await page.evaluate(({id,input})=>window.capabilityLab.execute(id,input),{id:recipe.id,input:recipe.examples[0].input});
    assert.equal(canonical(nodeReceipt.result),canonical(browserReceipt.result));assert.equal(nodeReceipt.replay.resultHash,browserReceipt.replay.resultHash);
  });
  await check('PCA changed observations preserve axes and shift means',async()=>{
    await choose('composed.pcaScores');const original=await run({observations:[[-2,0],[0,-1],[0,1],[2,0]]});
    const changed=await run({observations:[[8,20],[10,19],[10,21],[12,20]]});
    assert.deepEqual(changed.result.means,[10,20]);nearNumbers(original.result.covarianceMatrix,changed.result.covarianceMatrix);
    nearNumbers(original.result.covarianceMatrix,[[8/3,0],[0,2/3]]);nearNumbers(changed.result.scores,[[-2,0],[0,-1],[0,1],[2,0]]);
    nearNumbers(original.result.scores,changed.result.scores);assert.notEqual(original.replay.resultHash,changed.replay.resultHash);
    await page.locator('[data-view="visual"]').click();assert.ok(await page.locator('#data-view .matrix-cell').count()>=12,'PCA matrices/scores are not presented');
    await screenshot('pca-visual');await page.locator('#replay-button').click();await page.waitForFunction(()=>document.querySelector('#run-status').textContent.includes('Replay matches'));
    return {original:original.result,changed:changed.result,replayed:true,differentInputTolerance:{absolute:1e-10,relative:1e-10},sameInputReplay:'exact canonical and hash comparison'};
  });
  await check('domain visualization responds to new observations',async()=>{
    await choose('statistics.histogram');await page.locator('[data-example-index="0"]').click();
    const input=JSON.parse(await page.locator('#input-editor').inputValue());await run(input);
    await page.locator('[data-view="visual"]').click();assert.ok(await page.locator('#data-view svg').count()>0,'histogram should render SVG');
    await screenshot('histogram');return {input,chartCount:await page.locator('#data-view svg').count()};
  });
  await check('invalid domain input visibly fails and disables replay',async()=>{
    await choose('statistics.mean');await page.locator('#input-editor').fill('{"values":[]}');await page.locator('#run-button').click();
    await page.waitForFunction(()=>document.querySelector('#execution-badge').textContent==='Failed');
    assert.ok(await page.locator('#replay-button').isDisabled());assert.ok((await page.locator('#result').textContent()).includes('Execution stopped'));
  });
  await check('malformed and oversized editor inputs bounded',async()=>{
    await page.locator('#input-editor').fill('{');assert.ok(await page.locator('#run-button').isDisabled());
    await page.locator('#input-editor').fill('{"values":['+'1,'.repeat(125001)+'1]}');
    assert.ok(await page.locator('#run-button').isDisabled());assert.ok((await page.locator('#json-status').textContent()).includes('limit'));
    await page.locator('#input-editor').fill('{"values":[1,2]}');
  });
  await check('mobile edit-run layout usable',async()=>{
    await page.setViewportSize({width:390,height:844});await choose('statistics.mean');const receipt=await run({values:[2,4,6]});assert.equal(receipt.result.value,4);
    assert.ok(await page.locator('#run-button').isVisible());assert.ok(await page.locator('#input-editor').isVisible());
    const width=await page.evaluate(()=>({body:document.body.scrollWidth,view:innerWidth}));assert.ok(width.body<=width.view+1,`horizontal overflow ${width.body}>${width.view}`);
    await screenshot('mobile');await page.setViewportSize({width:1440,height:1000});return width;
  });
  await check('after interactions combined managed budget snapshot',()=>snapshot('exercised'));
  await check('browser source files remained unchanged',async()=>assert.equal(canonical(await fingerprints()),canonical(report.sourceFiles)));
  await check('browser console/page errors absent',()=>assert.deepEqual(report.errors,[]));
}catch(error){report.checks.push({name:'browser startup/integration',status:'fail',error:error.message});}
finally{await browser?.close();if(service){service.kill('SIGTERM');await new Promise(resolve=>{if(service.exitCode!==null)resolve();else{service.once('exit',resolve);setTimeout(resolve,3000);}});}}
report.summary={pass:report.checks.filter(c=>c.status==='pass').length,fail:report.checks.filter(c=>c.status==='fail').length,
  observedBudgetOnly:true,osHardLimitEstablished:false};
await writeFile(join(evidence,`browser-${stamp}.json`),JSON.stringify(report,null,2)+'\n');await writeFile(join(evidence,'browser-latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,checks:report.checks.map(({observed,...rest})=>rest),screenshots:report.screenshots,
  resourceSnapshots:report.resourceSnapshots.map(s=>({label:s.label,path:s.path,rssBytes:s.managedObservation.combinedRssBytes,budgetBytes:s.managedObservation.budgetBytes})),receipt:join(evidence,'browser-latest.json')},null,2));
process.exitCode=report.summary.fail?1:0;
