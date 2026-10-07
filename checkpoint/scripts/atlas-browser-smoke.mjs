import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??path.join(root,'node_modules'),'package.json'));
const {chromium}=require('playwright');
const server=http.createServer(async(request,response)=>{
  try{
    const relative=decodeURIComponent(new URL(request.url,'http://local').pathname),file=path.resolve(root,'dist','.'+relative,relative.endsWith('/')?'index.html':'');
    if(!file.startsWith(path.join(root,'dist')+path.sep))throw Error();
    const bytes=await fs.readFile(file);response.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'application/octet-stream');response.end(bytes);
  }catch{response.statusCode=404;response.end('Unavailable');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const evidence=path.join(path.dirname(root),'browser-smoke');await fs.mkdir(evidence,{recursive:true});
const checks=[],errors=[];let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const base=`http://127.0.0.1:${server.address().port}/`;
  const check=(name,ok)=>{checks.push({name,ok});assert.ok(ok,name);};
  await page.goto(base+'#/pxcube/overview');await page.locator('a[href="#/pxcube/atlas"]').first().click();
  await page.locator('#atlas-run').waitFor();check('Atlas route reachable and initially inert',await page.locator('#atlas-status').textContent()==='Ready. Nothing runs until you choose Run search.');
  await page.locator('#atlas-run').click();await page.locator('#atlas-outcome').filter({hasText:'Accepted'}).waitFor({timeout:30000});
  check('live search produces measured acceptance',/Accepted \d+ B program · reference \d+ B/.test(await page.locator('#atlas-outcome').textContent()));
  check('rejected rounds remain visible',(await page.locator('.atlas-table').textContent()).includes('REJECTED'));
  await page.locator('.atlas-failures summary').first().click();check('retained concrete failure is inspectable',(await page.locator('.atlas-failures pre').first().textContent()).includes('producer'));
  await page.locator('#atlas-inspect summary').click();await page.waitForFunction(()=>document.querySelector('#atlas-inspection')?.textContent.startsWith('{'));check('Part/input/producer inspection is available',(await page.locator('#atlas-inspection').textContent()).includes('parts'));
  const pending=page.waitForEvent('download');await page.locator('#atlas-download-result').click();const resultDownload=await pending;await resultDownload.saveAs(path.join(evidence,'live-result.json'));
  const result=JSON.parse(await fs.readFile(path.join(evidence,'live-result.json'),'utf8'));check('accepted candidate has no scoped failures',result.rounds.at(-1).acceptance.accepted&&result.rounds.at(-1).full_check.failed===0);
  const recipePending=page.waitForEvent('download');await page.locator('#atlas-download-recipe').click();await (await recipePending).saveAs(path.join(evidence,'recipe.json'));
  const recipe=JSON.parse(await fs.readFile(path.join(evidence,'recipe.json'),'utf8'));check('durable recipe carries literal sources and actual implementation identity',recipe.recipe.nodes.length>0&&!!recipe.sources['/parts/training']&&!!recipe.implementationIdentity.digest&&!JSON.stringify(recipe).includes('kernel_receipt_count'));
  await page.locator('#atlas-replay').click();await page.getByText('Replay complete.',{exact:false}).waitFor();check('explicit replay reports body/cache counts',(await page.locator('#atlas-cache').textContent()).startsWith('0 calculation bodies executed'));
  await page.evaluate(()=>{location.hash='#/hh/overview';});await page.getByRole('heading',{name:'Homeroom Heroes',exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='#/pxcube/atlas';});await page.locator('#atlas-run').waitFor();check('session/result survive view navigation',(await page.locator('#atlas-outcome').textContent()).includes('Accepted'));
  check('iPhone viewport has no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(evidence,'atlas-iphone.png'),fullPage:true});
  await page.locator('#atlas-reset').click();check('reset clears Atlas result',(await page.locator('#atlas-status').textContent()).includes('reset')&&await page.locator('.atlas-failures').count()===0);
  await page.locator('#atlas-composition').click();await page.locator('#atlas-outcome').filter({hasText:'fixture policy passed'}).waitFor();
  check('original three-piece composition is executable',(await page.locator('#atlas-view').textContent()).includes('10 / 10 prediction cases passed'));
  await page.locator('#atlas-gain').fill('-2');await page.locator('#atlas-bias').fill('-1');await page.locator('#atlas-composition').click();await page.locator('#atlas-outcome').filter({hasText:'fixture policy rejected'}).waitFor();
  check('changed model retains original composition rejection',(await page.locator('#atlas-view').textContent()).includes('10 failed'));
  check('no browser module/runtime errors',errors.length===0);
}catch(error){checks.push({name:'smoke completion',ok:false,error:error.message});throw error;}
finally{
  await fs.writeFile(path.join(evidence,'smoke.json'),JSON.stringify({checks,errors},null,2)+'\n');
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  console.log(JSON.stringify({checks,errors,evidence},null,2));
}
