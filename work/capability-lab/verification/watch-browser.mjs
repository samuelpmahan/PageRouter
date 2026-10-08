import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),product=resolve(process.env.CAPABILITY_PRODUCT_ROOT??process.argv[2]??join(root,'outputs/capability-lab')),evidence=resolve(process.env.CAPABILITY_EVIDENCE_ROOT??join(root,'outputs/capability-lab/evidence/independent'));
const cache=resolve(process.env.CAPABILITY_BROWSER_CACHE??join(root,'work/toolteam/browser')),{chromium}=await import(pathToFileURL(process.env.CAPABILITY_PLAYWRIGHT_MODULE??join(cache,'node_modules/playwright/index.mjs')));
const executable=process.env.CAPABILITY_CHROMIUM_PATH??join(cache,'browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
const libraries=process.env.CAPABILITY_CHROMIUM_LIBS??['usr/lib/x86_64-linux-gnu','lib/x86_64-linux-gnu','usr/lib','lib'].map(p=>join(cache,'deps',p)).join(':');
const url=process.env.CAPABILITY_PREVIEW_URL??'http://127.0.0.1:4173',servicePid=Number(process.env.CAPABILITY_SERVICE_PID)||27734;
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),report={schema:'capability-lab.independent.watch-browser.v1',generatedAt:new Date().toISOString(),url,checks:[],errors:[],screenshots:[],resourceSnapshots:[]};
const canonical=v=>JSON.stringify(sort(v));function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
const rationalEqual=(a,b)=>assert.equal(BigInt(a.numerator)*BigInt(b.denominator),BigInt(b.numerator)*BigInt(a.denominator));
async function fingerprints(){const names=['index.html','ui/app.mjs','ui/style.css','ui/watches.mjs',...(await readdir(join(product,'src/watches'))).filter(n=>n.endsWith('.mjs')).map(n=>`src/watches/${n}`)];return Promise.all(names.sort().map(async path=>{const bytes=await readFile(join(product,path));return{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));}
async function check(name,action){try{const observed=await action();report.checks.push({name,status:'pass',...(observed?{observed}:{})});}catch(error){report.checks.push({name,status:'fail',error:error.message.slice(0,2400)});}}
await mkdir(evidence,{recursive:true});let browser,page;
const state=()=>page.evaluate(()=>window.watchLab.getState());
const geometry=()=>page.evaluate(()=>window.watchLab.getGeometry());
async function screenshot(label){await page.locator('#watch-workbench').scrollIntoViewIfNeeded();const path=join(evidence,`watch-browser-${stamp}-${label}.png`);await page.screenshot({path,fullPage:false});report.screenshots.push({label,path});}
async function advance(n,d=1){await page.locator('#watch-duration-numerator').fill(String(n));await page.locator('#watch-duration-denominator').fill(String(d));await page.locator('#watch-advance').click();return state();}
async function reset(){await page.locator('#watch-reset').click();const result=await state();rationalEqual(result.time,{numerator:0,denominator:1});return result;}
function snapshot(label){const path=join(evidence,`watch-browser-resource-${stamp}-${label}.json`),raw=JSON.parse(execFileSync('python3',[join(here,'preflight.py'),'--output',path,'--managed-pid',String(process.pid),'--managed-pid',String(servicePid)],{encoding:'utf8',timeout:10000,maxBuffer:250000}));assert.ok(raw.managedObservation.groups.every(g=>g.present),'configured managed root PID absent');assert.ok(raw.managedObservation.belowBudgetAtSnapshot);report.resourceSnapshots.push({label,path,managedObservation:raw.managedObservation});}
try{
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:libraries}});
  page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const response=await page.goto(url,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  await page.locator('[data-workspace-mode="watches"]').click();await page.waitForFunction(()=>window.watchLab?.getState);
  report.sourceFiles=await fingerprints();
  await check('managed service/browser resource snapshot',()=>snapshot('loaded'));
  await check('exactly three actual SVG watch models with selectable geometry',async()=>{
    assert.equal(await page.locator('.watch-model-svg').count(),3);
    for(const model of ['mechanical','quartz','software']){const svg=page.locator(`.watch-model-svg[data-watch-model="${model}"]`);assert.ok(await svg.isVisible());assert.ok(await svg.locator('g[data-part-id]').count()>=7);assert.ok(await svg.locator('polygon,polyline,circle').count()>=7);}
    await screenshot('assembled');return{models:(await geometry()).watches.map(w=>({id:w.id,parts:w.parts.length}))};
  });
  await check('mouse SVG selection binds crystal role/source/value without state change',async()=>{
    const before=await state();await page.locator('.watch-model-svg [data-part-id="quartz.crystal"]').click();assert.equal(canonical(await state()),canonical(before));
    const detail=await page.locator('#watch-component-detail').textContent();assert.ok(/frequency|reference|timing/i.test(detail));assert.ok(detail.includes('32768')||detail.includes('32,768'));assert.ok(await page.locator('#watch-component-detail a[href^="https://"]').count()>0);
    return{detail,selectedSvg:await page.locator('.watch-model-svg [data-part-id="quartz.crystal"]').getAttribute('class')};
  });
  await check('keyboard SVG component selection adds no transport action',async()=>{
    const before=await state(),part=page.locator('.watch-model-svg [data-part-id="mechanical.palletFork"]');await part.focus();await part.press('Space');const after=await state();assert.ok(canonical(after)===canonical(before),`component Space selection changed state: ${JSON.stringify({before:{paused:before.paused,actions:before.history.actions.length,time:before.time},after:{paused:after.paused,actions:after.history.actions.length,lastAction:after.history.actions.at(-1),time:after.time}})}`);
    assert.ok((await page.locator('#watch-component-title').textContent()).toLowerCase().includes('pallet'));
  });
  await page.locator('#watch-pause').click();await reset();
  await check('state-driven internal motion reaches actual SVG geometry',async()=>{
    const markup=async id=>page.locator(`.watch-model-svg [data-part-id="${id}"]`).evaluate(el=>el.outerHTML);
    await reset();const mechanicalInitial=Object.fromEntries(await Promise.all(['mechanical.balanceWheel','mechanical.hairspring','mechanical.escapeWheel','mechanical.goingTrain'].map(async id=>[id,await markup(id)])));
    await advance(1,16);for(const id of ['mechanical.balanceWheel','mechanical.hairspring'])assert.notEqual(await markup(id),mechanicalInitial[id],`${id} quarter-phase not drawn`);await screenshot('quarter-phase');
    await reset();await advance(1,8);for(const id of ['mechanical.escapeWheel','mechanical.goingTrain'])assert.notEqual(await markup(id),mechanicalInitial[id],`${id} beat pose not drawn`);
    await reset();const rotor=await markup('quartz.rotor'),gears=await markup('quartz.gears');await advance(1);assert.notEqual(await markup('quartz.rotor'),rotor,'motor rotor pose not drawn');assert.notEqual(await markup('quartz.gears'),gears,'motor-driven gears pose not drawn');
    return{geometry:'actual SVG primitives changed with declared phase/beat/motor state; illustrative kinematics'};
  });
  await reset();
  await check('mixed selected steps hit next common boundary',async()=>{
    await page.locator('#watch-step-event').selectOption('quartzCycle');await page.locator('#watch-step').click();let s=await state();rationalEqual(s.time,{numerator:1,denominator:32768});assert.equal(s.counters.quartzCycles,1);
    await page.locator('#watch-step-event').selectOption('mechanicalBeat');await page.locator('#watch-step').click();s=await state();rationalEqual(s.time,{numerator:1,denominator:8});assert.deepEqual(s.counters,{mechanicalBeats:1,quartzCycles:4096,motorCommands:0,softwareUpdates:32});assert.equal(s.paused,true);
    return{time:s.time,counters:s.counters};
  });
  await check('period keyboard shortcut steps outside interactive controls',async()=>{
    await reset();await page.locator('#watch-step-event').selectOption('mechanicalBeat');await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('.');const s=await state();rationalEqual(s.time,{numerator:1,denominator:8});assert.deepEqual(s.counters,{mechanicalBeats:1,quartzCycles:4096,motorCommands:0,softwareUpdates:32});return{time:s.time,counters:s.counters};
  });
  await check('exploded slider and independent overlays leave complete state unchanged',async()=>{
    const before=await state(),assembled=await geometry();await screenshot('assembled-pair');await page.locator('#watch-explode').fill('1');await page.locator('#watch-explode').dispatchEvent('input');const exploded=await geometry();assert.equal(canonical(await state()),canonical(before));assert.notEqual(canonical(exploded),canonical(assembled));assert.equal(await page.locator('#watch-explode-value').textContent(),'100%');
    await page.locator('#watch-energy-overlay').uncheck();assert.equal(canonical(await state()),canonical(before));assert.ok(await page.locator('[data-path-kind="energy"][hidden]').count()>0);assert.ok(await page.locator('[data-path-kind="timing"]:not([hidden])').count()>0);
    await page.locator('#watch-energy-overlay').check();await page.locator('#watch-timing-overlay').uncheck();assert.equal(canonical(await state()),canonical(before));assert.ok(await page.locator('[data-path-kind="timing"][hidden]').count()>0);
    await page.locator('#watch-timing-overlay').check();await screenshot('exploded');await page.locator('#watch-explode').fill('0');await page.locator('#watch-explode').dispatchEvent('input');assert.equal(canonical(await geometry()),canonical(assembled));
    await page.evaluate(()=>window.watchLab.setView({explode:1}));assert.equal(await page.locator('#watch-explode-value').textContent(),'100%');assert.equal(canonical(await state()),canonical(before));await page.evaluate(()=>window.watchLab.setView({explode:0}));assert.equal(await page.locator('#watch-explode-value').textContent(),'0%');
    return{pairedTime:before.time,pairedCounters:before.counters,canonicalStateSha256:createHash('sha256').update(canonical(before)).digest('hex'),selectionAndExplosionStateInvariant:true};
  });
  await check('powered-off interval preserves mechanical phase and other watches continue',async()=>{
    await reset();await advance(1,16);await page.locator('#watch-energy-mainspring').uncheck();await advance(2);await page.locator('#watch-energy-mainspring').check();const s=await advance(1,16);
    rationalEqual(s.time,{numerator:17,denominator:8});assert.deepEqual(s.counters,{mechanicalBeats:1,quartzCycles:69632,motorCommands:2,softwareUpdates:544});return{time:s.time,counters:s.counters};
  });
  await check('edited live frequency is retained and causes declared nominal-gearing drift',async()=>{
    await reset();await page.locator('[data-rate="mechanical"]').fill('8');await page.locator('[data-apply-rate="mechanical"]').click();const s=await advance(1);
    assert.equal(s.counters.mechanicalBeats,16);rationalEqual(s.displayTime.mechanical,{numerator:2,denominator:1});rationalEqual(s.time,{numerator:1,denominator:1});assert.ok(s.history.actions.some(a=>a.type==='rate'));return{time:s.time,displayTime:s.displayTime,counters:s.counters};
  });
  await check('full state/events replay exactly through public browser seam',async()=>{const current=await state(),replay=await page.evaluate(()=>window.watchLab.replay());assert.equal(replay.exact,true);assert.equal(replay.matches,true);assert.equal(replay.canonicalState,canonical(current));assert.equal(replay.canonicalEvents,canonical(current.history.events));return{actions:current.history.actions.length,events:current.history.events.length};});
  await check('one-day compact counter microscope expands bounded real records',async()=>{
    const prior=await reset(),s=await advance(86400);assert.equal(s.counters.quartzCycles,2831155200);assert.equal(s.history.events.length-prior.history.events.length,4,'one-day advance must add four compact ranges; reset intentionally retains prior sessions');
    await page.locator('.watch-microscope').first().locator(':scope > summary').click();const options=await page.locator('#watch-microscope option').evaluateAll(items=>items.map(x=>({value:x.value,text:x.textContent})));
    const rangeIndex=s.history.events.findIndex(e=>e.model==='quartz'&&e.end-e.start+1>1000000),quartz=options.find(x=>Number(x.value)===rangeIndex);assert.ok(rangeIndex>=0&&quartz,'no retained large quartz range in microscope');await page.locator('#watch-microscope').selectOption(quartz.value);await page.locator('#watch-expand-range').click();
    const text=await page.locator('#watch-expanded-range').textContent();assert.ok(!/not expanded|unavailable|error/i.test(text),text);const records=JSON.parse(text);const array=Array.isArray(records)?records:records.events??records.items??records.records;assert.ok(Array.isArray(array)&&array.length===32,'range expansion missing or unbounded');assert.equal(array[0].index,s.history.events[rangeIndex].start);assert.equal(array.at(-1).index,s.history.events[rangeIndex].start+31);
    await page.locator('#watch-microscope-offset').fill(String(s.history.events[rangeIndex].end-s.history.events[rangeIndex].start));await page.locator('#watch-expand-range').click();const tail=JSON.parse(await page.locator('#watch-expanded-range').textContent());assert.equal(tail.events.length,1);assert.equal(tail.events[0].index,s.counters.quartzCycles);rationalEqual(tail.events[0].time,{numerator:86400,denominator:1});
    return{range:quartz,expanded:array.length,tailEvent:tail.events[0],quartzCycles:s.counters.quartzCycles};
  });
  await check('browser pacing uses actual bounded samples and statistics call traces',async()=>{
    await reset();await page.evaluate(()=>{window.__watchStats=[];const original=window.capabilityLab.execute;window.capabilityLab.execute=function(id,input,...rest){const receipt=original.call(this,id,input,...rest);window.__watchStats.push({id,input,receipt});return receipt;};});
    await page.locator('#watch-autoplay').click();await page.waitForFunction(()=>window.watchLab.getPacing().count>=3);await page.locator('#watch-pause').click();const paused=await state();await page.waitForTimeout(250);assert.equal(canonical(await state()),canonical(paused));
    await page.locator('#watch-measure-pacing').click();await page.waitForFunction(()=>window.watchLab.getPacing().summary!==null);
    const pacing=await page.evaluate(()=>window.watchLab.getPacing()),calls=await page.evaluate(()=>window.__watchStats);assert.ok(pacing.count>=3&&pacing.count<=pacing.limit);assert.ok(pacing.samples.every(v=>Number.isFinite(v)&&v>=0));
    const described=calls.find(c=>c.id==='statistics.describe');assert.ok(described,'pacing did not invoke statistics descriptor');assert.equal(canonical(described.input.values),canonical(pacing.samples));assert.equal(canonical(described.receipt.result),canonical(pacing.summary));assert.ok(described.receipt.trace.calls.some(c=>c.id==='statistics.variance'));
    assert.ok((await page.locator('.pacing').textContent()).includes('does not measure physical watch accuracy'));return{raw:pacing,statisticsTrace:described.receipt.trace,pausedTime:paused.time};
  });
  await check('explicit simulated visibility transition freezes autoplay without catch-up',async()=>{
    await page.locator('#watch-autoplay').click();await page.waitForFunction(()=>window.watchLab.getState().paused===false);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    const hidden=await state();assert.equal(hidden.visibilityHidden,true);await page.waitForTimeout(250);assert.equal(canonical(await state()),canonical(hidden));
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});const visible=await state();assert.equal(visible.visibilityHidden,false);rationalEqual(visible.time,hidden.time);await page.waitForTimeout(250);assert.equal(canonical(await state()),canonical(visible));return{simulation:true,nativeTabSuspensionProven:false,time:visible.time,retainedVisibilityActions:visible.history.actions.filter(a=>a.type==='visibility')};
  });
  await check('reduced-motion SVGs and component keyboard detail remain meaningful',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'});const before=await state(),part=page.locator('.watch-model-svg [data-part-id="software.updateCounter"]');await part.focus();await part.press('Enter');assert.equal(canonical(await state()),canonical(before));assert.ok(await page.locator('.watch-model-svg').count()===3);assert.ok((await page.locator('#watch-component-detail').textContent()).includes('models.software.counts.updates'));
    await screenshot('reduced-motion');await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('desktop core controls and all three schematics fit one viewport',async()=>{
    await page.setViewportSize({width:1600,height:1000});await page.locator('#watch-workbench').scrollIntoViewIfNeeded();const boxes=await page.locator('.watch-model-svg').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};}));
    assert.ok(boxes.every(b=>b.top>=0&&b.bottom<=1000&&b.left>=0&&b.right<=1600),'core watch schematics exceed desktop viewport');assert.ok(await page.locator('#watch-step').isVisible());assert.ok(await page.locator('#watch-explode').isVisible());return{viewport:{width:1600,height:1000},svgBounds:boxes};
  });
  await check('managed resources after interactions',()=>snapshot('exercised'));
  await check('watch source bytes remained unchanged during browser run',async()=>assert.equal(canonical(await fingerprints()),canonical(report.sourceFiles)));
  await check('no browser console/page errors',()=>assert.deepEqual(report.errors,[]));
}catch(error){report.checks.push({name:'browser startup/watch registration',status:'fail',error:error.message});}
finally{await browser?.close();}
report.summary={pass:report.checks.filter(c=>c.status==='pass').length,fail:report.checks.filter(c=>c.status==='fail').length,budgetObservationOnly:true,osHardLimitEstablished:false};await writeFile(join(evidence,`watch-browser-${stamp}.json`),JSON.stringify(report,null,2)+'\n');await writeFile(join(evidence,'watch-browser-latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,failures:report.checks.filter(c=>c.status==='fail'),screenshots:report.screenshots,resources:report.resourceSnapshots.map(s=>({label:s.label,rssBytes:s.managedObservation.combinedRssBytes,budgetBytes:s.managedObservation.budgetBytes})),receipt:join(evidence,'watch-browser-latest.json')},null,2));process.exitCode=report.summary.fail?1:0;
