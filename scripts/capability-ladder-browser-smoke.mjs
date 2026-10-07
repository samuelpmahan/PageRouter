import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createAtlasCompositionDefinition,createCapabilityProtocol} from '../exp/atlas/atlas-session.mjs';

// Run only after building dist and accepting the implementation checkpoint.
const root=path.resolve(import.meta.dirname,'..');
const dist=path.join(root,'dist');
const require=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??path.join(root,'node_modules'),'package.json'));
const {chromium}=require('playwright');
const server=http.createServer(async(request,response)=>{
  try{
    const relative=decodeURIComponent(new URL(request.url,'http://local').pathname);
    const file=path.resolve(dist,'.'+relative,relative.endsWith('/')?'index.html':'');
    if(!file.startsWith(dist+path.sep))throw Error('Outside built site');
    const bytes=await fs.readFile(file);
    response.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'application/octet-stream');
    response.end(bytes);
  }catch{response.statusCode=404;response.end('Unavailable');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const evidence=path.join(path.dirname(root),'capability-ladder-browser-smoke');
await fs.mkdir(evidence,{recursive:true});
const checks=[],errors=[];
let browser;
const check=(name,ok,detail)=>{
  checks.push({name,ok,...(detail===undefined?{}:{detail})});
  assert.ok(ok,name);
};
const same=(left,right)=>{
  try{assert.deepEqual(left,right);return true;}catch{return false;}
};
const stages=['parse','validate','interpret','execute'];
function checkExecution(name,part,{executed=6,hits=0}={}){
  const execution=part?.value?.execution;
  check(name+' has a successful result Part',part?.value?.ok===true&&!!part.address&&!!part.producer&&!!part.kernel_composition);
  check(name+' retains actual six-node domain body/cache counts',execution?.receipt?.executed_count===executed&&execution?.receipt?.cache_hit_count===hits&&execution?.receipt?.kernel_receipt_count===7);
  check(name+' produces the original motion, Beta and Boolean fixture outputs',
    execution?.outputs?.model?.value?.gain===2&&execution?.outputs?.model?.value?.bias===1&&
    execution?.outputs?.prediction_probe?.value?.passed===10&&execution?.outputs?.prediction_probe?.value?.failed===0&&
    execution?.outputs?.posterior?.value?.alpha===11&&execution?.outputs?.posterior?.value?.beta===1&&
    execution?.outputs?.decision?.value?.accepted===true);
  return execution;
}
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  const base=`http://127.0.0.1:${server.address().port}/`;
  const states=async()=>Promise.all(stages.map(stage=>page.locator('#atlas-ladder-rung-'+stage).getAttribute('data-state')));
  const inspection=async()=>{
    const summary=page.locator('#atlas-ladder-inspect summary');
    if(!await page.locator('#atlas-ladder-inspect').evaluate(element=>element.open))await summary.click();
    await page.waitForFunction(()=>document.querySelector('#atlas-ladder-inspection')?.textContent.trim().startsWith('{'));
    return JSON.parse(await page.locator('#atlas-ladder-inspection').textContent());
  };
  const download=async(id,filename)=>{
    const pending=page.waitForEvent('download');
    await page.locator(id).click();
    const artifact=await pending,file=path.join(evidence,filename);
    await artifact.saveAs(file);
    return JSON.parse(await fs.readFile(file,'utf8'));
  };
  const clickStage=async(stage,state='ok')=>{
    await page.locator('#atlas-ladder-'+stage).click();
    await page.locator(`#atlas-ladder-rung-${stage}[data-state="${state}"]`).waitFor({timeout:30000});
  };
  const run=async()=>{
    await page.locator('#atlas-ladder-run').click();
    await page.locator('#atlas-ladder-rung-execute[data-state="ok"]').waitFor({timeout:30000});
    await page.waitForFunction(()=>!document.querySelector('#atlas-ladder-run')?.disabled);
  };
  const reset=async()=>{
    await page.locator('#atlas-ladder-reset').click();
    check('reset clears every rung',same(await states(),stages.map(()=> 'waiting')));
    const data=await inspection();
    check('reset clears domain and protocol execution evidence',data.counts.domain_body_executions===0&&data.counts.protocol_body_executions===0&&data.counts.domain_invocations===0);
  };

  await page.goto(base+'#/pxcube/overview');
  await page.locator('a[href="#/pxcube/atlas"]').first().click();
  await page.locator('#atlas-ladder-definition').waitFor();
  check('Atlas route mounts an inert capability ladder',same(await states(),stages.map(()=> 'waiting'))&&await page.locator('#atlas-ladder-download-result').isDisabled());
  check('ladder status is available to assistive technology',await page.locator('#atlas-ladder-status').getAttribute('role')==='status'&&(await page.locator('#atlas-ladder-status').textContent()).trim().length>0);
  const initialInspection=await inspection();
  check('mount and inspection execute neither protocol nor domain bodies',initialInspection.counts.protocol_body_executions===0&&initialInspection.counts.domain_body_executions===0&&initialInspection.counts.domain_invocations===0);
  check('staged downstream actions start guarded',await page.locator('#atlas-ladder-validate').isDisabled()&&await page.locator('#atlas-ladder-interpret').isDisabled()&&await page.locator('#atlas-ladder-execute').isDisabled()&&await page.locator('#atlas-ladder-replay').isDisabled());

  const catalog=await (await page.request.get(base+'data/catalog.json')).json();
  const sample=createAtlasCompositionDefinition({implementationIdentity:catalog.release.atlasIdentity});
  const sampleText=await page.locator('#atlas-ladder-definition').inputValue();
  check('editor sample comes from the pure original six-node definition',same(JSON.parse(sampleText),sample)&&sample.recipe.nodes.length===6&&Object.keys(sample.sources).length===7);
  const definition=await download('#atlas-ladder-download-definition','definition.json');
  check('definition download is the recipe envelope with literal sources and current identity',same(definition,sample)&&definition.format==='kompozed.atlas.recipe.v1'&&!!definition.implementationIdentity?.digest&&!JSON.stringify(definition).includes('kernel_receipt_count'));

  for(const [index,stage]of stages.entries()){
    await clickStage(stage);
    const expected=stages.map((_,position)=>position<=index?'ok':'waiting');
    check(stage+' updates only its completed rung and prior rungs',same(await states(),expected));
    const data=await inspection();
    check(stage+' is an actual composed protocol Part',Object.values(data.parts).some(part=>part.value?.rung===stage&&part.value?.ok===true&&part.kernel_composition?.calculation_address.startsWith('/protocol/calculations/')&&part.inputs.includes('/protocol/implementations/source')));
    if(stage!=='execute')check(stage+' does not invoke a domain body',data.counts.domain_body_executions===0&&data.counts.domain_invocations===0);
  }
  const staged=await download('#atlas-ladder-download-result','staged-result.json');
  const stagedExecution=checkExecution('staged execution',staged);
  check('staged cache readout describes domain algorithm bodies',(await page.locator('#atlas-ladder-cache').textContent()).includes('6 calculation bodies executed')&&(await page.locator('#atlas-ladder-cache').textContent()).includes('0 cache hits'));
  check('execution enables explicit replay',!await page.locator('#atlas-ladder-replay').isDisabled());

  await reset();
  await run();
  const composed=await download('#atlas-ladder-download-result','composed-result.json');
  const composedExecution=checkExecution('composed run',composed);
  check('composed run retains all four authentic rung Parts',same(Object.keys(composed.value.stages).sort(),[...stages].sort())&&stages.every(stage=>composed.value.stages[stage].kernel_composition?.calculation_address.startsWith('/protocol/calculations/')));
  check('staged and composed execution agree on actual outputs',same(stagedExecution.outputs,composedExecution.outputs));
  const composedInspection=await inspection();
  check('full run separates protocol bodies, domain bodies and kernel receipts',composedInspection.counts.protocol_body_executions===6&&composedInspection.counts.protocol_kernel_receipts===6&&composedInspection.counts.domain_body_executions===6&&composedInspection.counts.domain_invocations===1&&composedInspection.counts.domain_kernel_receipts===7);
  check('composed parent Part is visibly inspectable',(await page.locator('#atlas-ladder-composed-part').textContent()).includes(composed.address));
  await page.evaluate(()=>{location.hash='#/hh/overview';});
  await page.getByRole('heading',{name:'Homeroom Heroes',exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='#/pxcube/atlas';});
  await page.locator('#atlas-ladder-definition').waitFor();
  check('successful rung state and composed parent survive navigation',same(await states(),stages.map(()=> 'ok'))&&(await page.locator('#atlas-ladder-composed-part').textContent()).includes(composed.address));
  check('successful remount performs no additional execution',same((await inspection()).counts,composedInspection.counts));

  await page.locator('#atlas-ladder-replay').click();
  await page.waitForFunction(()=>document.querySelector('#atlas-ladder-cache')?.textContent.includes('0 calculation bodies executed')&&document.querySelector('#atlas-ladder-cache')?.textContent.includes('6 cache hits'));
  const replay=await download('#atlas-ladder-download-result','replay-result.json');
  const replayExecution=checkExecution('explicit replay',replay,{executed:0,hits:6});
  check('replay preserves the domain outputs',same(replayExecution.outputs,composedExecution.outputs));
  const replayInspection=await download('#atlas-ladder-download-inspection','inspection.json');
  check('inspection download contains authentic Part inputs and both receipt scopes',replayInspection.counts.domain_body_executions===6&&replayInspection.counts.domain_cache_hits===6&&replayInspection.counts.domain_invocations===2&&replayInspection.counts.domain_kernel_receipts===14&&Object.values(replayInspection.parts).some(part=>part.inputs?.length>0&&part.producer&&part.kernel_composition));

  // A downloaded definition must also run through a newly owned protocol, rather
  // than depending on a live browser's previous handles or result Parts.
  const fresh=createCapabilityProtocol({implementationIdentity:catalog.release.atlasIdentity});
  const imported=await fresh.run(definition);
  const importedExecution=checkExecution('fresh protocol definition import',imported);
  check('fresh protocol import reproduces the downloaded browser outputs',same(importedExecution.outputs,composedExecution.outputs));

  const edited=structuredClone(sample);
  edited.sources['/parts/policy'].min_mean=0.99;
  const editedText=JSON.stringify(edited,null,2);
  await page.locator('#atlas-ladder-definition').fill(editedText);
  check('editing a definition invalidates all rung handles and displayed result',same(await states(),stages.map(()=> 'waiting'))&&await page.locator('#atlas-ladder-download-result').isDisabled()&&await page.locator('#atlas-ladder-replay').isDisabled());
  const beforeNavigation=await inspection();
  check('draft editing does not execute a protocol or domain body',same(beforeNavigation.counts,replayInspection.counts));
  await page.evaluate(()=>{location.hash='#/hh/overview';});
  await page.getByRole('heading',{name:'Homeroom Heroes',exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='#/pxcube/atlas';});
  await page.locator('#atlas-ladder-definition').waitFor();
  check('draft and invalidation state survive route navigation',await page.locator('#atlas-ladder-definition').inputValue()===editedText&&same(await states(),stages.map(()=> 'waiting')));
  check('remount does not autorun the retained draft',same((await inspection()).counts,beforeNavigation.counts));
  await run();
  const changed=await download('#atlas-ladder-download-result','edited-result.json');
  check('a changed policy is interpreted and executed rather than retaining an earlier result',changed.value.execution.outputs.decision.value.accepted===false&&changed.value.execution.receipt.executed_count===1&&changed.value.execution.receipt.cache_hit_count===5);

  await reset();
  await page.locator('#atlas-ladder-definition').fill('{');
  await clickStage('parse','failed');
  check('malformed JSON fails only the parse rung',same(await states(),['failed','waiting','waiting','waiting'])&&await page.locator('#atlas-ladder-validate').isDisabled()&&await page.locator('#atlas-ladder-execute').isDisabled()&&await page.locator('#atlas-ladder-replay').isDisabled());
  check('parse failure appears in the live status',/parse|json/i.test(await page.locator('#atlas-ladder-status').textContent()));
  const failedParse=await download('#atlas-ladder-download-result','parse-failure-part.json');
  check('failed parse Part remains downloadable with structured evidence',failedParse.value.ok===false&&failedParse.value.error.code==='PARSE_FAILED'&&!!failedParse.kernel_composition);
  const parseFailure=await inspection();
  check('malformed JSON retains a structured failure without domain execution',parseFailure.counts.domain_body_executions===0&&Object.values(parseFailure.parts).some(part=>part.value?.error?.code==='PARSE_FAILED'&&part.kernel_composition));

  await reset();
  const cyclic=structuredClone(sample),fit=cyclic.recipe.nodes.find(node=>node.id==='fit');
  fit.inputs[0]=fit.output;
  await page.locator('#atlas-ladder-definition').fill(JSON.stringify(cyclic,null,2));
  await clickStage('parse');
  await clickStage('validate','failed');
  check('a dependency cycle is parsed but rejected before interpretation',same(await states(),['ok','failed','waiting','waiting'])&&await page.locator('#atlas-ladder-interpret').isDisabled()&&await page.locator('#atlas-ladder-execute').isDisabled());
  check('dependency failure appears in the live status',/valid|cycle|dependency/i.test(await page.locator('#atlas-ladder-status').textContent()));
  const dagFailure=await inspection();
  check('bad DAG validation retains a structured failure without domain execution',dagFailure.counts.domain_body_executions===0&&dagFailure.counts.domain_invocations===0&&Object.values(dagFailure.parts).some(part=>part.value?.error?.code==='VALIDATION_FAILED'));
  await page.locator('#atlas-ladder-run').click();
  await page.locator('#atlas-ladder-rung-validate[data-state="failed"]').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#atlas-ladder-run')?.disabled);
  check('composed run stops at the invalid DAG rung',same(await states(),['ok','failed','waiting','waiting'])&&(await inspection()).counts.domain_invocations===0);

  await page.locator('#atlas-ladder-sample').click();
  check('sample restores the pure original definition without autorun',same(JSON.parse(await page.locator('#atlas-ladder-definition').inputValue()),sample)&&same(await states(),stages.map(()=> 'waiting'))&&(await inspection()).counts.domain_invocations===0);
  await run();
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    await inspection();
    check(width+'px mobile viewport has no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(evidence,`ladder-${width}px.png`),fullPage:true});
  }

  // The new surface shares the Atlas route with the existing bounded search.
  await page.locator('#atlas-run').click();
  await page.locator('#atlas-outcome').filter({hasText:'Accepted'}).waitFor({timeout:30000});
  check('existing Atlas search still produces measured acceptance',/Accepted \d+ B program · reference \d+ B/.test(await page.locator('#atlas-outcome').textContent()));
  check('existing search retains its rejected rounds',(await page.locator('.atlas-table').textContent()).includes('REJECTED'));
  check('existing search leaves the capability-ladder result intact',same(await states(),stages.map(()=> 'ok'))&&JSON.parse(await page.locator('#atlas-ladder-definition').inputValue()).recipe.nodes.length===6);
  check('no browser module or runtime errors',errors.length===0);
}catch(error){
  checks.push({name:'smoke completion',ok:false,error:error.stack??error.message});
  throw error;
}finally{
  await fs.writeFile(path.join(evidence,'smoke.json'),JSON.stringify({checks,errors},null,2)+'\n');
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  console.log(JSON.stringify({checks,errors,evidence},null,2));
}
