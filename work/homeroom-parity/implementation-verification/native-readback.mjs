import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {browserConfig} from './browser-config.mjs';

// Delivery binding, not another visual acceptance gate. No account/session injection.
const config=browserConfig(import.meta.url);
if(!process.env.HH_BUILT_ROOT||!process.env.HH_PREVIEW_BASE_URL)throw Error('Explicit native HH_BUILT_ROOT and HH_PREVIEW_BASE_URL are required');
const acceptedPath=resolve(config.root,process.env.HH_ACCEPTED_CAPTURE||'outputs/homeroom-parity/implementation/verification/public-20261009T025104881Z/capture.json');
const accepted=JSON.parse(await readFile(acceptedPath,'utf8'));
assert.equal(accepted.sourceStable,true);assert.equal(accepted.builtStable,true);
const leaf=config.leaf||`${config.preview}/compiled/hh/index.html`;
const output=resolve(config.output,process.env.HH_VERIFY_RUN||`native-${new Date().toISOString().replace(/[^0-9TZ]/g,'')}`);await mkdir(output,{recursive:true});
const receipt={schema:'hh-independent-native-readback.v1',createdAt:new Date().toISOString(),leaf,builtRoot:config.builtRoot,acceptedCapture:relative(config.root,acceptedPath),boundary:'Native delivery binding to reviewed code/assets; production services are not invoked.',checks:[],differences:[],additionalFiles:[],console:[],requests:[],failures:[]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function pin(){const map={};async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,item.name);if(item.isDirectory())await walk(p);else map[relative(config.builtRoot,p)]=sha(await readFile(p));}}await walk(config.builtRoot);return Object.fromEntries(Object.entries(map).sort());}
function check(name,fn){return Promise.resolve().then(fn).then(details=>receipt.checks.push({name,passed:true,details:details??null})).catch(error=>{receipt.checks.push({name,passed:false,error:String(error.stack).slice(0,3000)});receipt.failures.push({name,error:String(error.message)})});}
receipt.before=await pin();
const expected={};for(const [path,hash] of Object.entries(accepted.builtHashes)){const prefix='checkpoint/dist/compiled/hh/';assert.ok(path.startsWith(prefix),'Accepted built pin prefix changed');expected[path.slice(prefix.length)]=hash;}
for(const [path,hash] of Object.entries(expected))if(receipt.before[path]!==hash)receipt.differences.push({path,acceptedHash:hash,nativeHash:receipt.before[path]??null});
receipt.additionalFiles=Object.keys(receipt.before).filter(p=>!(p in expected));
const allowedMetadata=new Set((process.env.HH_ALLOWED_METADATA_VARIANCE||'').split(',').filter(Boolean));
for(const p of allowedMetadata)assert.ok(['vendor/fast-check-4.10.2.meta.mjs','vendor/fast-check-4.10.2.provenance.json'].includes(p),'Unsupported metadata variance');
await check('reviewed-runtime-and-asset-byte-binding',()=>{assert.deepEqual(receipt.differences.filter(d=>!allowedMetadata.has(d.path)),[]);assert.deepEqual(receipt.additionalFiles.filter(p=>/\.(mjs|js|css|html)$/.test(p)),[]);return{reviewedPins:Object.keys(expected).length,metadataDifferences:receipt.differences.filter(d=>allowedMetadata.has(d.path)),additionalFiles:receipt.additionalFiles}});
for(const name of ['index.html','app.mjs','public-controller.mjs','services/index.mjs','public-site.css'])await check(`native-http-bytes-${name}`,async()=>{const response=await fetch(new URL(name,leaf));assert.equal(response.status,200);const body=Buffer.from(await response.arrayBuffer());assert.equal(sha(body),receipt.before[name]);return {status:response.status,sha256:sha(body)}});
const {chromium}=await import(pathToFileURL(config.playwrightPath).href);const browser=await chromium.launch(config.launch);
try{
 for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce'});const page=await context.newPage();
  page.on('console',m=>receipt.console.push({device,type:m.type(),text:m.text().slice(0,2000)}));page.on('pageerror',e=>receipt.console.push({device,type:'pageerror',text:String(e).slice(0,2000)}));page.on('request',r=>receipt.requests.push({device,url:r.url(),method:r.method(),type:r.resourceType()}));page.on('response',r=>{if(r.status()>=400)receipt.failures.push({device,status:r.status(),url:r.url()})});
  await check(`${device}-native-menu-terms-navigation`,async()=>{
   await page.goto(`${leaf}#/`,{waitUntil:'networkidle',timeout:15000});await page.locator('#hh-home-register').waitFor();assert.ok(await page.locator('.hh-public-site').isVisible());
   await page.locator('#hh-public-nav-toggle').click();assert.equal(await page.locator('#hh-public-nav-toggle').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('#hh-public-nav-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#hh-public-nav-toggle').evaluate(e=>e===document.activeElement),true);
   await page.locator('#hh-home-register').click();await page.locator('#hh-register-form').waitFor();await page.locator('#hh-terms-open').click();const dialog=page.locator('#hh-terms-modal');await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('#hh-terms-open').evaluate(e=>e===document.activeElement),true);await page.locator('#hh-terms-open').click();await dialog.locator('.hh-modal-close').click();await dialog.waitFor({state:'hidden'});
   assert.equal(await page.locator('summary').filter({hasText:/^Preview tools$/}).count(),1);assert.equal(await page.locator('body').evaluate(e=>(e.innerText.match(/© 2024 Homeroom Heroes/g)||[]).length),1);assert.ok(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,`native-register-${device}.png`)});return{route:page.url(),width:viewport.width};
  });
  if(device==='mobile')await check('native-pagerouter-iframe-controls',async()=>{
   await page.goto(process.env.HH_INTEGRATED_URL||`${config.preview}/#/hh/run`,{waitUntil:'networkidle',timeout:15000});const iframe=page.locator('iframe').first();await iframe.waitFor();const frame=page.frameLocator('iframe').first();await frame.locator('.hh-public-site').waitFor({timeout:10000});await frame.locator('#hh-public-nav-toggle').click();await frame.locator('#hh-mobile-nav a[data-public-route=register]').click();await frame.locator('#hh-register-form').waitFor();await frame.locator('#hh-terms-open').click();await frame.locator('#hh-terms-modal').waitFor();await page.keyboard.press('Escape');await frame.locator('#hh-terms-modal').waitFor({state:'hidden'});assert.ok(await frame.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:resolve(output,'native-integrated-mobile.png')});return {iframe:await iframe.boundingBox(),url:page.url()};
  });await context.close();
 }
}finally{await browser.close();receipt.after=await pin();receipt.builtStable=JSON.stringify(receipt.before)===JSON.stringify(receipt.after);if(!receipt.builtStable)receipt.failures.push({name:'native-artifact-stability'});receipt.externalRuntimeRequests=receipt.requests.filter(r=>!r.url.startsWith('data:')&&!r.url.startsWith('blob:')&&new URL(r.url).origin!==new URL(leaf).origin);if(receipt.externalRuntimeRequests.length)receipt.failures.push({name:'external-runtime-requests',requests:receipt.externalRuntimeRequests});const errors=receipt.console.filter(e=>['error','pageerror'].includes(e.type));if(errors.length)receipt.failures.push({name:'console-errors',errors});receipt.completedAt=new Date().toISOString();receipt.passed=receipt.failures.length===0;await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({output,passed:receipt.passed,builtStable:receipt.builtStable,differences:receipt.differences,failures:receipt.failures}));process.exitCode=receipt.passed?0:1;}
