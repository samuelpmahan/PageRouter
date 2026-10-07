// Reuses local/test/studio-browser.mjs assertions at d02e7a7 against actual Pages.
// Each newPage uses a fresh isolated browser context; user browser storage is untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {root} from '../../../local/run.mjs';
import {checkShell} from './check-shell.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{})});
const evidence=path.join(root,process.env.PXCUBE_EVIDENCE_DIR ?? 'evidence/local-pages-parity/d02e7a7');fs.mkdirSync(evidence,{recursive:true});
const checks=[],errors=[],requests=[];
const latest=JSON.parse(fs.readFileSync(path.join(root,'.pxcube/latest.json'))),site=path.join(root,latest.site);
const server=http.createServer((req,res)=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname;if(!pathname.startsWith('/PxCube/'))throw Error('prefix');const file=path.resolve(site,decodeURIComponent(pathname.slice(8))||'index.html');if(!file.startsWith(site+path.sep))throw Error('path');const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};const bytes=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
function record(mode,text){checks.push({mode,text});console.log('PASS',mode,text)}
try{
 for(const [mode,url] of [['local','http://127.0.0.1:4321/'],['pages','https://samuelpmahan.github.io/PxCube/']].filter(([mode])=>!process.env.PARITY_MODE||mode===process.env.PARITY_MODE)){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push({mode,message:e.message}));page.on('request',r=>requests.push({mode,url:r.url(),method:r.method()}));
  const host=()=>page.frameLocator('#thing'), surface=()=>host().frameLocator('#surfaces iframe:not([hidden])');
  const model=()=>page.locator('#thing').evaluate(f=>f.contentWindow.pxCubeExperience.inspect());
  const open=async id=>{await page.locator(`button.card[data-id="${id}"]`).click();await page.waitForFunction(()=>!!document.querySelector('#thing')?.contentWindow?.pxCubeExperience?.inspect()?.modelKind);};
  await page.goto(url);await checkShell(page,mode,evidence,record);await page.evaluate(()=>localStorage.setItem('discstudio.pxc.shelf.v1','real user data untouched'));
  await open('upload-disc-to-shelf');
  assert.equal((await model()).discs.length,0);assert.equal(await surface().locator('#case-next').count(),0);
  await surface().locator('#plastic').fill('ESP');await surface().locator('#weight').fill('174');await surface().locator('#save').click();
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
  await page.locator('#back').click();await open('explore-shelf');let shopping=await model();assert.equal(shopping.discs.length,50);assert.equal(shopping.modelKind,'shopping prototype objects');
  assert.ok(shopping.matching.every(id=>shopping.discs[id].speed>=7&&shopping.discs[id].speed<=8));
  await surface().locator('#fs-query').fill('Passion ESP');shopping=await model();assert.ok(shopping.matching.length>0);assert.ok(shopping.matching.every(id=>shopping.discs[id].mold==='Passion'&&shopping.discs[id].plastic==='ESP'));
  await surface().locator('#fs-query').fill(shopping.discs[0].nickname);assert.equal((await model()).matching.length,0);await surface().locator('#fs-query').fill('');
  await surface().locator('[data-mold]').first().click();
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
  await page.locator('#back').click();await open('upload-disc-to-shelf');assert.deepEqual((await model()).discs,saved.discs);
  assert.equal(await page.locator('#thing').evaluate(f=>f.contentWindow.identityWitness===f.contentDocument.querySelector('#surfaces iframe:not([hidden])').contentWindow.pxCubeModel.pxc),true);
  await page.reload();await open('upload-disc-to-shelf');assert.deepEqual((await model()).discs,saved.discs);
  await host().locator('#session').selectOption('mock.upload-disc-to-shelf.1');assert.equal(await host().locator('.retained:not([hidden])').count(),1);assert.deepEqual((await model()).case,test.case);
  record(mode,'Back preserves owning contexts; reload verifies saved compositions and retains test observations without re-executing');
  await page.locator('#back').click();await open('explore-shelf');assert.deepEqual((await model()).ui.bags,shopping.ui.bags);
  await host().locator('#surface').selectOption('live');await page.waitForFunction(()=>document.querySelector('#thing').contentWindow.pxCubeExperience.inspect().modelKind==='Studio live Parts');assert.equal((await model()).discs.length,3);assert.equal((await model()).bags.length,0);
  await host().locator('#session').selectOption('mock.explore-shelf.2');assert.deepEqual((await model()).case,shelfTest.case);
  assert.equal(await page.evaluate(()=>localStorage.getItem('discstudio.pxc.shelf.v1')),'real user data untouched');
  record(mode,'reload restores both interactive surfaces, keeps numbered Shelf evidence, and never writes the real Studio shelf');
  const reportResponse=await page.request.get(new URL('pxcube-run.json',url).href);if(mode==='local'){assert.equal(reportResponse.status(),200);assert.ok((await reportResponse.json()).results.every(r=>r.ok));}else{fs.writeFileSync(path.join(evidence,'pages-run-record-status.json'),JSON.stringify({url:reportResponse.url(),status:reportResponse.status()}));}
  const imported=await (await page.request.get(new URL('experiences/explore-shelf/studio-import.json',url).href)).json();assert.equal(imported.source.commit,'6f7937bc1eebd22bf3135f50c9edf714b122902a');assert.equal(imported.compatibility.status,'legacy adapter; not full MockPxC integration');
  await page.screenshot({path:path.join(evidence,mode+'-retained.png')});await page.close();
 }
 assert.deepEqual(errors,[]);
 const unexpected=requests.filter(r=>r.method!=='GET'||(!r.url.startsWith('http://127.0.0.1:')&&!r.url.startsWith('https://samuelpmahan.github.io/PxCube/')&&!r.url.startsWith('data:')&&!r.url.startsWith('blob:')));assert.deepEqual(unexpected,[]);
 record('network','runtime requests stay on their tested origin; no event POST or external source-server dependency');
 fs.writeFileSync(path.join(evidence,(process.env.PARITY_MODE?process.env.PARITY_MODE+'-':'')+'browser-results.json'),JSON.stringify({runId:latest.runId,checks,errors},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,errors}));
}catch(error){fs.writeFileSync(path.join(evidence,(process.env.PARITY_MODE?process.env.PARITY_MODE+'-':'')+'browser-failure.json'),JSON.stringify({checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
