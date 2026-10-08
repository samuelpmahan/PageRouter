#!/usr/bin/env node
// Reusable real-browser interaction check; uses the pre-provisioned Playwright cache.
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key,...rest]=arg.replace(/^--/,'').split('='); return [key,rest.join('=') || true]; }));
const baseURL = args.url || 'http://127.0.0.1:4173';
const outputDir = resolve(args.out || '/mnt/d/somefile/capability-lab/browser-evidence');
await mkdir(outputDir,{recursive:true});
const playwrightModule=process.env.CAPABILITY_LAB_PLAYWRIGHT_MODULE||'/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/browser/node_modules/playwright/index.mjs';
const browsersPath=process.env.CAPABILITY_LAB_BROWSERS_PATH||'/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/browser/browsers';
const browserDeps=process.env.CAPABILITY_LAB_LD_LIBRARY_DIR||'/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/browser/deps/usr/lib/x86_64-linux-gnu';
const chromiumExecutable=process.env.CAPABILITY_LAB_CHROMIUM_EXECUTABLE;
for(const [label,path,variable] of [['Playwright module',playwrightModule,'CAPABILITY_LAB_PLAYWRIGHT_MODULE'],['Playwright browser cache',browsersPath,'CAPABILITY_LAB_BROWSERS_PATH'],['browser shared-library directory',browserDeps,'CAPABILITY_LAB_LD_LIBRARY_DIR'],...(chromiumExecutable?[['Chromium executable',chromiumExecutable,'CAPABILITY_LAB_CHROMIUM_EXECUTABLE']]:[])])try{await access(path);}catch{throw new Error(`Browser verification prerequisite missing: ${label} at ${path}. Set ${variable} to an existing path; do not install dependencies for this check.`);}
process.env.PLAYWRIGHT_BROWSERS_PATH=browsersPath;
process.env.LD_LIBRARY_PATH=[browserDeps,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const {chromium}=await import(playwrightModule);
let browser=null,page=null;
const errors=[];
try {
  browser=await chromium.launch({headless:true,...(chromiumExecutable?{executablePath:chromiumExecutable}:{})});
  page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(baseURL,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.capabilityLab?.capabilities?.length>0,{timeout:15000});
  await page.evaluate(()=>{window.__labExecutions=[];window.capabilityLab.onExecution(({execution})=>window.__labExecutions.push(execution));});
  const capabilities=await page.evaluate(()=>window.capabilityLab.capabilities.map(({id,title,kind,order,dependsOn})=>({id,title,kind,order,dependsOn})));
  const chosen=args.capability || capabilities.find(item=>item.kind==='composed')?.id || capabilities[0].id;
  const descriptor=capabilities.find(item=>item.id===chosen);
  assert.ok(descriptor,`Unknown capability: ${chosen}`);
  await page.locator('#capability-select').selectOption(chosen);
  let initial=args.input ? JSON.parse(args.input) : JSON.parse(await page.locator('#input-editor').inputValue());
  if(args.input) await page.locator('#input-editor').fill(JSON.stringify(initial,null,2));
  await page.locator('#run-button').click();
  await page.waitForFunction(()=>document.querySelector('#execution-badge')?.textContent==='Complete');
  await page.waitForFunction(()=>window.__labExecutions.length>=1);
  const firstReceipt=await page.evaluate(()=>window.__labExecutions[0]);
  const firstResult=await page.locator('#result').innerText();
  const graph=await page.locator('#dependency-graph').innerText();
  const traceCount=Number(await page.locator('#trace-count').innerText());
  const fresh=await page.evaluate(()=>window.capabilityLab.registry.list().find(item=>item.id===document.querySelector('#capability-select').value));
  for(const dep of fresh.dependsOn||[]) assert.ok(graph.includes(dep),`Dependency graph omits declared dependency ${dep}`);
  assert.ok(graph.includes(chosen),`Dependency graph omits selected capability ${chosen}`);
  if(descriptor.kind==='composed') assert.ok(traceCount>1,`Composed capability ${chosen} did not show nested calls`);

  await page.locator('#replay-button').click();
  await page.waitForFunction(()=>document.querySelector('#execution-badge')?.textContent==='Replayed');
  await page.waitForFunction(()=>window.__labExecutions.length>=2);
  const replayStatus=await page.locator('#run-status').innerText();
  assert.match(replayStatus,/matches/i,'Deterministic replay must match the original output');

  let changedInput=args['changed-input'] ? JSON.parse(args['changed-input']) : structuredClone(initial);
  if(!args['changed-input']) {
    const path=[];
    const find=value=>{
      if(Array.isArray(value)){for(let i=0;i<value.length;i++){path.push(i);if(find(value[i]))return true;path.pop();}return false;}
      if(value&&typeof value==='object'){for(const key of Object.keys(value)){path.push(key);if(find(value[key]))return true;path.pop();}return false;}
      return typeof value==='number';
    };
    assert.ok(find(changedInput),'Input has no numeric value to change; pass --changed-input={...} explicitly');
    let cursor=changedInput;for(const part of path.slice(0,-1))cursor=cursor[part];cursor[path.at(-1)]+=1;
  }
  await page.locator('#input-editor').fill(JSON.stringify(changedInput,null,2));
  await page.locator('#run-button').click();
  await page.waitForFunction(()=>document.querySelector('#execution-badge')?.textContent==='Complete');
  await page.waitForFunction(()=>window.__labExecutions.length>=3);
  const changedReceipt=await page.evaluate(()=>window.__labExecutions[2]);
  const changedResult=await page.locator('#result').innerText();
  assert.notEqual(changedReceipt.replay.resultCanonical,firstReceipt.replay.resultCanonical,'Changed input should produce a different actual execution result');
  await page.locator('[data-view="visual"]').click();
  const visualCount=await page.locator('#data-view svg, #data-view table, #data-view .matrix-grid, #data-view .vector-cell').count();
  assert.ok(visualCount>0,'Selected capability should provide a useful data visualization');
  await page.locator('#input-editor').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:resolve(outputDir,'workbench.png'),fullPage:true});
  const report={url:baseURL,capability:chosen,kind:descriptor.kind,capabilities:capabilities.length,initialInput:initial,changedInput,firstResult,firstResultCanonical:firstReceipt.replay.resultCanonical,changedResult,changedResultCanonical:changedReceipt.replay.resultCanonical,changedResultDifferent:true,visualCount,graph,traceCount,replayStatus,consoleErrors:errors,screenshot:resolve(outputDir,'workbench.png')};
  assert.deepEqual(errors,[],'Browser reported console or page errors');
  await writeFile(resolve(outputDir,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  const screenshot=resolve(outputDir,'workbench-failed.png');
  try { if(page && page.url()!=='about:blank') await page.screenshot({path:screenshot,fullPage:true}); } catch {}
  const report={url:baseURL,error:error?.stack||String(error),consoleErrors:errors,screenshot};
  await writeFile(resolve(outputDir,'browser-failure.json'),JSON.stringify(report,null,2)+'\n');
  console.error(JSON.stringify(report,null,2));
  throw error;
} finally { await browser?.close(); }
