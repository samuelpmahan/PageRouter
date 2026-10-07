import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { root } from '../run.mjs';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});
const evidence=path.join(root,process.env.PXCUBE_EVIDENCE_DIR ?? 'evidence/local-pages'), checks=[],errors=[];
fs.mkdirSync(evidence,{recursive:true});
const latest=JSON.parse(fs.readFileSync(path.join(root,'.pxcube/latest.json'))), site=path.join(root,latest.site);
// Serve the exact artifact at a Pages-style project prefix, with no local-only CORS.
const staticHost=http.createServer((req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/PxCube/')) {res.writeHead(404).end();return}
  const file=path.resolve(site,pathname.slice('/PxCube/'.length)||'index.html');
  if(!file.startsWith(site+path.sep)){res.writeHead(404).end();return}
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
  const bytes=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'}).end(bytes);
 }catch{res.writeHead(404).end()}
});
await new Promise(resolve=>staticHost.listen(0,'127.0.0.1',resolve));
try {
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 for(const [mode,url] of [['local','http://127.0.0.1:4321/'],['project-prefix',`http://127.0.0.1:${staticHost.address().port}/PxCube/`]]) {
  await page.goto(url);
  const board=await page.request.get(new URL('neat.html',url).href);assert.equal(board.status(),200);assert.match(await board.text(),/PXCUBE-mock-smoke/);
  await page.locator('[data-tab="exp"]').click();
  await page.locator('button.card[data-id="hello"]').click();
  await page.frameLocator('#thing').locator('h1').waitFor();
  if(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded')==='false')await page.locator('#control-drawer-toggle').click();
  await page.locator('#back').click();
  await page.locator('button.card[data-id="mock-smoke"]').click();
  const frame=page.frameLocator('#thing');await frame.locator('article[data-mount="mock.shelf"]').waitFor();
  await frame.locator('article[data-mount="mock.shelf"] input').fill('Morning practice');
  await frame.locator('article[data-mount="mock.shelf"] button').click();
  await frame.locator('#status').filter({hasText:'Saved in mock.shelf. Other'}).waitFor();
  const working=await page.locator('#thing').evaluate(element=>element.contentWindow.pxCubeMocks.inspect());
  await frame.locator('#open-interactive').click();
  assert.deepEqual(await page.locator('#thing').evaluate(element=>element.contentWindow.pxCubeMocks.inspect()),working);
  await frame.locator('#new-run').click();await frame.locator('article[data-mount="mock.shelf.1"]').waitFor();
  await frame.locator('#new-run').click();await frame.locator('article[data-mount="mock.shelf.2"]').waitFor();
  assert.equal(await frame.locator('article[data-mount="mock.shelf"] input').inputValue(),'Morning practice');
  assert.equal(await frame.locator('article[data-mount="mock.shelf.1"] input').inputValue(),'Untitled bag');
  assert.equal(await frame.locator('article[data-mount="mock.shelf.2"] input').inputValue(),'Untitled bag');
  await frame.locator('article[data-mount="mock.shelf.1"] input').fill('Test only');
  await frame.locator('article[data-mount="mock.shelf.1"] button').click();
  await frame.locator('#status').filter({hasText:'Saved in mock.shelf.1. Other'}).waitFor();
  assert.equal(await frame.locator('article[data-mount="mock.shelf"] input').inputValue(),'Morning practice');
  assert.equal(await frame.locator('article[data-mount="mock.shelf.2"] input').inputValue(),'Untitled bag');
  assert.match(await frame.locator('article[data-mount="mock.shelf"] .eyebrow').textContent(),/Interactive/);
  assert.match(await frame.locator('article[data-mount="mock.shelf.1"] .eyebrow').textContent(),/Test run/);
  await frame.locator('#smoke').click();
  await frame.locator('#status').filter({hasText:'3 checks passed'}).waitFor();
  const model=await page.locator('#thing').evaluate(element=>element.contentWindow.pxCubeMocks.inspect());
  assert.equal(model.runs['mock.shelf'].value.sc.draft.name,'Morning practice');
  assert.equal(model.runs['mock.shelf'].kind,'interactive');assert.equal(Object.hasOwn(model.runs['mock.shelf'],'iteration'),false);
  assert.equal(model.runs['mock.shelf.1'].kind,'test');assert.equal(model.runs['mock.shelf.1'].iteration,1);
  assert.deepEqual(await page.locator('#thing').evaluate(element=>element.contentWindow.pxCubeSmoke.checks),[true,true,true]);
  if(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded')==='false')await page.locator('#control-drawer-toggle').click();await page.locator('#back').click();await page.locator('button.card[data-id="mock-smoke"]').click();
  await frame.locator('article[data-mount="mock.shelf.2"]').waitFor();
  const resumed=await page.locator('#thing').evaluate(element=>element.contentWindow.pxCubeMocks.inspect());assert.deepEqual(resumed,model);
  await page.reload();await page.locator('[data-tab="exp"]').click();await page.locator('button.card[data-id="mock-smoke"]').click();
  await frame.locator('article[data-mount="mock.shelf.2"]').waitFor();
  assert.deepEqual(await page.locator('#thing').evaluate(element=>element.contentWindow.pxCubeMocks.inspect()),model);
  const record=await (await page.request.get(new URL('pxcube-run.json',url).href)).json();
  assert.ok(record.results.every(result=>result.ok));
  checks.push({mode,runId:record.runId,checks:['actual neat board is served','hello opens','visible save changes actual mounted value','opening interactive resumes without writing','test runs start seeded beside edited interactive state','test writes preserve interactive and sibling worlds','visible kind matches stored metadata','three visible smoke assertions pass','Back/reopen retains worlds','page reload retains worlds','packaging report names both successful apps']});
 }
 await page.screenshot({path:path.join(evidence,'mock-worlds.png'),fullPage:true});
 const denied=await browser.newPage();denied.on('pageerror',error=>errors.push(error.message));
 await denied.addInitScript(()=>{Storage.prototype.setItem=function(){throw new Error('quota exhausted')}});
 // Storage lives in the shell now: the kernel's commit throws there and the
 // failure crosses the frame boundary to the Experience's status.
 await denied.goto('http://127.0.0.1:4321/');
 await denied.locator('[data-tab="exp"]').click();
 await denied.locator('button.card[data-id="mock-smoke"]').click();
 const deniedFrame=denied.frameLocator('#thing');
 await deniedFrame.locator('#status').filter({hasText:'Stopped: quota exhausted'}).waitFor();assert.equal(await deniedFrame.locator('#new-run').isDisabled(),true);
 checks.push({mode:'storage-failure',checks:['initial storage failure is visible and creation stops']});await denied.close();
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({checks,errors},null,2)+'\n');
 console.log(JSON.stringify({modes:checks.length,checks:checks.reduce((n,r)=>n+r.checks.length,0),errors}));
} finally {await browser.close();await new Promise(resolve=>staticHost.close(resolve));}
