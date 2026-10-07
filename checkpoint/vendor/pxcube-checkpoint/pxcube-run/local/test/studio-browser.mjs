import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {root} from '../run.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});
const evidence=path.join(root,process.env.PXCUBE_EVIDENCE_DIR ?? 'evidence/studio-sandboxes');fs.mkdirSync(evidence,{recursive:true});
const checks=[],errors=[],requests=[];
const latest=JSON.parse(fs.readFileSync(path.join(root,'.pxcube/latest.json'))),site=path.join(root,latest.site);
const server=http.createServer((req,res)=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname;if(!pathname.startsWith('/PxCube/'))throw Error('prefix');const file=path.resolve(site,decodeURIComponent(pathname.slice(8))||'index.html');if(!file.startsWith(site+path.sep))throw Error('path');const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};const bytes=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
function record(mode,text){checks.push({mode,text});console.log('PASS',mode,text)}
try{
 const localUrl=process.env.PXCUBE_BASE_URL ?? 'http://127.0.0.1:4321/';
 for(const [mode,url] of [['local',localUrl],['pages-prefix',`http://127.0.0.1:${server.address().port}/PxCube/`]]){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push({mode,message:e.message}));page.on('request',r=>requests.push({mode,url:r.url(),method:r.method()}));
  const host=()=>page.frameLocator('#thing'), surface=()=>host().frameLocator('#surfaces iframe:not([hidden])');
  const model=()=>page.locator('#thing').evaluate(f=>f.contentWindow.pxCubeExperience.inspect());
  const open=async id=>{await page.locator(`button.card[data-id="${id}"]`).click();await page.waitForFunction(()=>!!document.querySelector('#thing')?.contentWindow?.pxCubeExperience?.inspect()?.modelKind);};
  const openSandboxControls=async()=>{if(await host().locator('#sandbox-drawer').isHidden())await host().locator('#sandbox-drawer-toggle').click();};
  await page.goto(url);await page.evaluate(()=>localStorage.setItem('discstudio.pxc.shelf.v1','real user data untouched'));
  await open('upload-disc-to-shelf');
  assert.equal(await host().locator('#sandbox-drawer').isHidden(),true);assert.equal(await host().locator('#sandbox-drawer-toggle').getAttribute('aria-expanded'),'false');
  assert.deepEqual(await host().locator('#surfaces').evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})),{width:1440,height:1000});
  await page.locator('#thing').evaluate(f=>{f.contentWindow.drawerIdentityWitness=f.contentDocument.querySelector('#surfaces iframe:not([hidden])').contentWindow;});
  await openSandboxControls();assert.equal(await host().locator('#sandbox-drawer-toggle').getAttribute('aria-label'),'Hide sandbox controls');
  assert.equal(await page.locator('#thing').evaluate(f=>f.contentWindow.drawerIdentityWitness===f.contentDocument.querySelector('#surfaces iframe:not([hidden])').contentWindow),true);
  record(mode,'Studio sandbox controls default to a discoverable collapsed drawer and opening it preserves the owning frame');
  assert.equal((await model()).discs.length,0);assert.equal(await surface().locator('#case-next').count(),0);
  const moldSearch=surface().locator('#mold-search');assert.equal(await moldSearch.getAttribute('role'),'combobox');assert.equal(await moldSearch.inputValue(),'');assert.equal(await moldSearch.isEnabled(),true);assert.equal(await surface().locator('#plastic').isEnabled(),false);assert.equal(await surface().locator('#save').isEnabled(),false);
  await moldSearch.fill('Flying Squirrel');assert.equal(await surface().locator('#seed').inputValue(),'');assert.equal(await surface().locator('#plastic').isEnabled(),false);assert.equal(await surface().locator('#save').isEnabled(),false);
  await moldSearch.fill('flyng squrrel');assert.equal(await surface().locator('#mold-options [role="option"]').first().textContent(),'ABC · Flying Squirrel');await surface().locator('#mold-options [role="option"]').first().click();assert.equal(await surface().locator('#nickname').inputValue(),'Flying Squirrel');
  assert.equal(await surface().locator('#plastic').isEnabled(),false);assert.equal(await surface().locator('#plastic option').first().textContent(),'Plastics not loaded for ABC');assert.equal(await surface().locator('#save').isEnabled(),false);
  await moldSearch.fill('buz disc');assert.ok(await surface().locator('#mold-options [role="option"]').count()>0);await surface().locator('#mold-options [role="option"]').first().click();
  assert.equal(await surface().locator('#plastic option').evaluateAll(options=>options.some(option=>option.textContent==='ESP')),true);assert.equal(await surface().locator('#save').isEnabled(),false);assert.equal(await surface().locator('#nickname').inputValue(),'Buzzz');assert.ok(Number(await surface().locator('#paint-seed').inputValue())>=40);
  assert.equal(await surface().locator('#mold-search').evaluate(node=>node.compareDocumentPosition(node.ownerDocument.querySelector('#preview')) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false),true);assert.equal(await surface().locator('#preview figure').evaluate(node=>node.firstElementChild?.tagName==='H3'),true);
  await moldSearch.fill('buz');assert.equal(await surface().locator('#plastic option').first().textContent(),'Choose a mold first');assert.equal(await surface().locator('#plastic').isEnabled(),false);assert.equal(await surface().locator('#save').isEnabled(),false);
  await surface().locator('#nickname').fill('');await moldSearch.fill('flyng squrrel');await surface().locator('#mold-options [role="option"]').first().click();assert.equal(await surface().locator('#nickname').inputValue(),'');await moldSearch.fill('buz disc');await surface().locator('#mold-options [role="option"]').first().click();assert.equal(await surface().locator('#nickname').inputValue(),'');
  await surface().locator('#nickname').fill('My first disc');await moldSearch.fill('buz disc');await surface().locator('#mold-options [role="option"]').first().click();assert.equal(await surface().locator('#nickname').inputValue(),'My first disc');
  assert.equal(await surface().locator('#paint-label-controls').isHidden(),true);await surface().locator('#customize-label').check();assert.equal(await surface().locator('#paint-label-controls').isVisible(),true);
  await surface().locator('#customize-label').uncheck();await surface().locator('#plastic').selectOption('ESP');assert.equal(await surface().locator('#save').isEnabled(),true);await surface().locator('#weight').fill('174');await surface().locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#thing').contentWindow.pxCubeExperience.inspect().discs?.length===1);
  const saved=await model();assert.equal(saved.discs[0].own.depiction.kind,'painted');assert.equal(saved.discs[0].own.weight,174);
  assert.equal(await page.locator('#thing').evaluate(f=>{const h=f.contentWindow.pxCubeExperience,p=f.contentDocument.querySelector('#surfaces iframe').contentWindow.pxCubeModel;f.contentWindow.identityWitness=p.pxc;return h.resolve(h.current().name+'.'+p.experience.shelfAddress.slice(3))===p.pxc.get(p.experience.shelfAddress);}),true);
  record(mode,'photo-free Upload save produces a real Disc; mounted resolution returns the exact Part');
  await host().locator('#inspect').click();assert.match(await host().locator('#values').textContent(),/Studio live Parts/);await host().locator('#close').click();
  await host().locator('#new-test').click();await surface().locator('#case-next').waitFor();assert.equal((await model()).discs.length,0);assert.equal((await model()).mount,'mock.upload-disc-to-shelf.1');
  await surface().locator('#case-next').click();await surface().locator('#case-next').click();
  await page.waitForFunction(()=>document.querySelector('#thing').contentWindow.pxCubeExperience.inspect().case?.state.done);
  const test=await model();assert.equal(test.case.state.failed,false);assert.equal(test.discs.length,1);assert.ok(test.case.records.every(r=>r.value.passed));
  record(mode,'numbered Upload Case uses actual controls and all declared checks pass');
  await host().locator('#new-test').click();await surface().locator('#case-next').waitFor();assert.equal((await model()).discs.length,0);assert.equal((await model()).mount,'mock.upload-disc-to-shelf.2');
  await host().locator('#session').selectOption('mock.upload-disc-to-shelf');assert.deepEqual((await model()).discs,saved.discs);
  assert.equal(await page.locator('#thing').evaluate(f=>f.contentWindow.identityWitness===f.contentDocument.querySelector('#surfaces iframe:not([hidden])').contentWindow.pxCubeModel.pxc),true);
  assert.equal(await page.locator('#thing').evaluate(f=>{try{f.contentWindow.pxCubeExperience.resolve('mock.upload-disc-to-shelf.1.px.shelf.0');return false;}catch{return true;}}),true);
  record(mode,'fresh test iterators preserve the interactive Part identity and reject cross-run addresses');
  if(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded')==='false')await page.locator('#control-drawer-toggle').click();await page.locator('#back').click();await open('explore-shelf');let shopping=await model();assert.equal(shopping.discs.length,50);assert.equal(shopping.modelKind,'shopping prototype objects');
  assert.equal(await host().locator('#sandbox-drawer').isHidden(),true);await openSandboxControls();
  assert.equal(await page.locator('#thing').evaluate(f=>localStorage.getItem('pxcube.studio.v1:upload-disc-to-shelf:controls-collapsed')),'false');
  assert.equal(await page.locator('#thing').evaluate(f=>localStorage.getItem('pxcube.studio.v1:explore-shelf:controls-collapsed')),'false');
  record(mode,'drawer preferences are scoped per Experience rather than leaking through the Studio host');
  await surface().locator('#fs-speed-range').selectOption('7-8');shopping=await model();assert.ok(shopping.matching.every(id=>shopping.discs[id].speed>=7&&shopping.discs[id].speed<=8));
  await surface().locator('#fs-query').fill('Passion ESP');shopping=await model();assert.ok(shopping.matching.length>0);assert.ok(shopping.matching.every(id=>shopping.discs[id].mold==='Passion'&&shopping.discs[id].plastic==='ESP'));
  await surface().locator('#fs-query').fill(shopping.discs[0].nickname);assert.equal((await model()).matching.length,0);await surface().locator('#fs-query').fill('');
  await surface().locator('[data-manufacturer]').first().click();await surface().locator('[data-mold]').first().click();
  const specimenIds=await surface().locator('[data-disc]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.disc)));
  shopping=await model();const expected=[...specimenIds].sort((a,b)=>shopping.discs[a].plastic.localeCompare(shopping.discs[b].plastic)||shopping.discs[b].weight-shopping.discs[a].weight);assert.deepEqual(specimenIds,expected);
  for(const id of specimenIds){await surface().locator(`[data-disc="${id}"]`).click();await surface().locator('#fs-hold').click();}
  await surface().locator('#fs-review').click();await surface().locator('#fs-bag-name').fill('Sandbox fairways');await surface().locator('#fs-confirm-bag').click();
  shopping=await model();assert.equal(shopping.ui.bags.length,1);assert.deepEqual(shopping.ui.bags[0].discIds,specimenIds);
  assert.equal(await page.locator('#thing').evaluate(f=>{const host=f.contentWindow.pxCubeExperience,child=f.contentDocument.querySelector('#surfaces iframe:not([hidden])').contentWindow.pxCubeModel;return host.resolve('mock.explore-shelf.px.ui')===child.ui;}),true);
  record(mode,'accepted mold/plastic/weight shopping, strict search, nickname exclusion, checkout and direct object inspection work');
  await host().locator('#new-test').click();await surface().locator('#fs-results').waitFor();await page.waitForFunction(()=>document.querySelector('#thing').contentWindow.pxCubeExperience.inspect().modelKind);assert.equal((await model()).ui.bags.length,0);
  await host().locator('#session').selectOption('mock.explore-shelf');assert.deepEqual((await model()).ui.bags,shopping.ui.bags);
  await host().locator('#surface').selectOption('live');await surface().locator('#shelf').waitFor();await page.waitForFunction(()=>document.querySelector('#thing').contentWindow.pxCubeExperience.inspect().modelKind==='Studio live Parts');assert.equal((await model()).discs.length,3);
  await host().locator('#new-test').click();await surface().locator('#case-next').waitFor();
  for(let i=0;i<4;i++) {await surface().locator('#case-next').click();await page.waitForFunction(i=>document.querySelector('#thing').contentWindow.pxCubeExperience.inspect().case?.state.next===i+1,i);}
  const shelfTest=await model();assert.equal(shelfTest.case.state.failed,false);assert.equal(shelfTest.bags.length,1);assert.ok(shelfTest.case.records.every(r=>r.value.passed));
  record(mode,'live Shelf Case previews, keeps and bags the exact physical copy; shopping stays independent');
  if(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded')==='false')await page.locator('#control-drawer-toggle').click();await page.locator('#back').click();await open('upload-disc-to-shelf');assert.deepEqual((await model()).discs,saved.discs);
  assert.equal(await page.locator('#thing').evaluate(f=>f.contentWindow.identityWitness===f.contentDocument.querySelector('#surfaces iframe:not([hidden])').contentWindow.pxCubeModel.pxc),true);
  await page.reload();await open('upload-disc-to-shelf');assert.deepEqual((await model()).discs,saved.discs);
  await host().locator('#session').selectOption('mock.upload-disc-to-shelf.1');assert.equal(await host().locator('.retained:not([hidden])').count(),1);assert.deepEqual((await model()).case,test.case);
  record(mode,'Back preserves owning contexts; reload verifies saved compositions and retains test observations without re-executing');
  if(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded')==='false')await page.locator('#control-drawer-toggle').click();await page.locator('#back').click();await open('explore-shelf');assert.deepEqual((await model()).ui.bags,shopping.ui.bags);
  await host().locator('#surface').selectOption('live');await page.waitForFunction(()=>document.querySelector('#thing').contentWindow.pxCubeExperience.inspect().modelKind==='Studio live Parts');assert.equal((await model()).discs.length,3);assert.equal((await model()).bags.length,0);
  await host().locator('#session').selectOption('mock.explore-shelf.2');assert.deepEqual((await model()).case,shelfTest.case);
  assert.equal(await page.evaluate(()=>localStorage.getItem('discstudio.pxc.shelf.v1')),'real user data untouched');
  record(mode,'reload restores both interactive surfaces, keeps numbered Shelf evidence, and never writes the real Studio shelf');
  const report=await (await page.request.get(new URL('pxcube-run.json',url).href)).json();for(const id of ['hello','mock-smoke','upload-disc-to-shelf','explore-shelf'])assert.ok(report.results.some(r=>r.id===id&&r.ok));assert.ok(report.results.every(r=>r.ok));
  const imported=await (await page.request.get(new URL('experiences/explore-shelf/studio-import.json',url).href)).json();assert.equal(imported.source.commit,'6f7937bc1eebd22bf3135f50c9edf714b122902a');assert.equal(imported.compatibility.status,'legacy adapter; not full MockPxC integration');
  await page.screenshot({path:path.join(evidence,mode+'-retained.png')});await page.close();
 }
 assert.deepEqual(errors,[]);
 const unexpected=requests.filter(r=>r.method!=='GET'||(!r.url.startsWith('http://127.0.0.1:')&&!r.url.startsWith('data:')&&!r.url.startsWith('blob:')));assert.deepEqual(unexpected,[]);
 record('network','all runtime requests are local GETs; no source-server dependency or event POST');
 fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({runId:latest.runId,checks,errors},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,errors}));
}catch(error){fs.writeFileSync(path.join(evidence,'browser-failure.json'),JSON.stringify({checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
