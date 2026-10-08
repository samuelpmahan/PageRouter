import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROVIDER_IDENTITY,PROVIDER_SETUP} from '../exp/block5/core/index.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const baseURL=process.env.BLOCK5_PREVIEW_URL??'http://127.0.0.1:4188/#/pxcube/block5';
const screenshot=process.env.BLOCK5_SCREENSHOT_PATH;
const evidence=process.env.BLOCK5_BROWSER_EVIDENCE_PATH;
const playwrightModule=process.env.BLOCK5_PLAYWRIGHT_MODULE??'playwright';
const {chromium}=await import(playwrightModule);
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOCK5_CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
const check=(ok,message)=>{if(!ok)throw new Error(message);};
try {
  const response=await page.goto(baseURL,{waitUntil:'networkidle'});
  check(response?.ok(),`Preview returned ${response?.status()}`);
  await page.getByRole('heading',{name:'Starting board'}).waitFor();
  check(await page.locator('.b5-rule-list .b5-rule').count()===4,'Default recipe should render four ordered cards.');
  const cardNames=async()=>await page.locator('.b5-rule-head label').allTextContents();
  const originalOrder=await cardNames();
  await page.locator('[data-order="2"][data-delta="-1"]').click();
  const reordered=await cardNames();
  check(reordered[1].includes('up-1')&&reordered[2].includes('right-2'),'Moving a card up should change the recipe order.');
  await page.locator('[data-order="1"][data-delta="1"]').click();
  check(JSON.stringify(await cardNames())===JSON.stringify(originalOrder),'Moving the card back should restore the default order.');
  await page.locator('#b5-run').click();
  await page.getByText(/Replay ordered cards complete/).waitFor({timeout:30000});
  check(await page.locator('.b5-results .b5-result').count()===3,'All three comparison slots should render.');
  check(await page.locator('.b5-results .b5-result').nth(2).getByText(/earlier completed replay/).count()===1,'First replay must train a program for a later replay, not evaluate against itself.');
  const resultRules=await page.locator('.b5-grid .b5-rules').first().allTextContents();
  const parsedResultRules=resultRules[0]??'';
  check(!parsedResultRules.includes('FLAG IS WIN'),'Default ordered cards should move WIN and break FLAG IS WIN.');
  await page.locator('#b5-replay').click();
  await page.getByText(/Replay complete/).waitFor({timeout:30000});
  check(await page.locator('.b5-results .b5-result').nth(2).locator('.b5-pill.pass').count()===1,'B-discovered composed output should match the uncached result.');
  const providerDetail=page.locator('.b5-result').first().locator('details').filter({hasText:'Provider setup and PxC receipts'});
  const providerEvidence=JSON.parse(await providerDetail.locator('pre').textContent());
  check(JSON.stringify(providerEvidence.providerIdentity)===JSON.stringify(PROVIDER_IDENTITY),'Browser and Node provider identities must match exactly.');
  check(providerEvidence.providerSetup.method==='same-origin-fetch','Browser must fetch the exact provider source bytes from its own origin.');
  check(providerEvidence.providerSetup.sourceBytes>0&&Number.isFinite(providerEvidence.providerSetup.elapsedMs),'Provider source setup metadata should report bytes and elapsed time.');
  check(providerEvidence.providerSetup.sourceBytes===PROVIDER_SETUP.sourceBytes,'Browser and Node must pin identical provider source bytes.');

  await page.locator('[data-rule-index="0"][data-field="direction"]').selectOption('L');
  await page.locator('#b5-replay').click();
  await page.getByText(/Replay complete/).waitFor({timeout:30000});
  const firstImpactRow=page.locator('.b5-table tbody tr').first();
  const impactCells=await firstImpactRow.locator('td').allTextContents();
  check(impactCells[2]?.includes('yes')&&impactCells[3]?.includes('yes'),'Changed direction should report both may-affect and did-affect for the first card.');
  check(await page.locator('.b5-results .b5-result').nth(2).locator('.b5-pill.pass').count()===1,'Changed-input composed output should still match uncached output.');
  await page.locator('.b5').scrollIntoViewIfNeeded();
  if(screenshot){await fs.mkdir(path.dirname(screenshot),{recursive:true});await page.screenshot({path:screenshot,fullPage:false});}
  const programText=await page.locator('details').filter({has:page.locator('summary', {hasText:'Program, actual inputs, provider identity'})}).locator('pre').first().textContent();
  const badProgram=JSON.parse(programText);
  badProgram.providerIdentity={...badProgram.providerIdentity,id:'wrong-provider'};
  await page.locator('#b5-import').setInputFiles({name:'wrong-provider-program.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(badProgram))});
  await page.getByText(/Program imported/).waitFor();
  await page.locator('#b5-execute').click();
  await page.getByText(/provider identity mismatch/i).first().waitFor({timeout:10000});

  await page.locator('[data-board-view="start"]').click();
  const startingBoard=page.locator('.b5-board').first();
  const start=startingBoard.locator('.b5-cell:has(button[data-select-object="baba"])');
  check(await start.getAttribute('data-x')==='1'&&await start.getAttribute('data-y')==='6','Baba should remain on the editable starting board after stack replay.');
  await page.locator('[data-move="L"]').click();
  const currentBoard=page.locator('.b5-board').first();
  const babaCell=currentBoard.locator('.b5-cell:has(button[data-select-object="baba"])');
  check(await babaCell.getAttribute('data-x')==='0','Directional button should move Baba on the actual board.');
  await page.locator('[data-select-object="text-you"]').first().click();
  await page.locator('#b5-word').selectOption('STOP');
  await page.locator('#b5-apply-object').click();
  check(await page.locator('.b5-rules').first().getByText('BABA IS STOP').count()===1,'Editing YOU to STOP should reparse the active sentence.');
  await page.locator('[data-select-object="text-you"]').first().click();
  await page.locator('#b5-kind').selectOption('rock');
  await page.locator('#b5-apply-object').click();
  check(await page.locator('.b5-board').first().locator('.b5-piece.rock').count()>=1,'Converting a text piece to a game object should remove the word and succeed.');

  const report={schema:'pagerouter.block5.browser-smoke.v1',preview:baseURL,viewport:{width:1440,height:900},result:{httpStatus:response.status(),cards:4,cardReorder:'up-1 moved before right-2 and restored',firstRun:'uncached+atomic; B program reserved for later replay',secondRun:'B-discovered composed matches uncached',changedDirection:'first card changed right to left; may-affect=yes and did-affect=yes; B-composed output still matched',ruleAfterDefaultStack:parsedResultRules,providerIdentity:providerEvidence.providerIdentity,providerSetup:providerEvidence.providerSetup,nodeProviderIdentity:PROVIDER_IDENTITY,nodeProviderSetup:PROVIDER_SETUP,providerIdentityMatchesNode:JSON.stringify(providerEvidence.providerIdentity)===JSON.stringify(PROVIDER_IDENTITY),providerSourceBytesMatchNode:providerEvidence.providerSetup.sourceBytes===PROVIDER_SETUP.sourceBytes,invalidProviderRejected:true,directionalMove:'Baba moved left from x=1 to x=0',textEdit:'BABA IS YOU changed to BABA IS STOP',textToEntity:'text converted to rock without invalid word state',consoleErrors:errors},screenshot:screenshot??null};
  if(evidence){await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.writeFile(evidence,JSON.stringify(report,null,2)+'\n');}
  check(errors.length===0,`Browser reported console errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
