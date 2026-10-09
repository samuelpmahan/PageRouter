import {captureConfig} from './runtime.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const {root,out,dir,pw,executable,referenceOrigin,previewBaseUrl,previewLeafUrl,integratedUrl}=captureConfig(import.meta.url);
const {chromium}=await import(pathToFileURL(pw));
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const requests=[];
page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
const steps=[];
async function record(name,action) {
  await page.waitForTimeout(200);
  const dom=await page.evaluate(()=>({
    url:location.href,title:document.title,
    headings:[...document.querySelectorAll('h1,h2,h3')].filter(e=>e.getBoundingClientRect().height>0).map(e=>e.innerText.trim()),
    buttons:[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height;}).map(e=>e.innerText.trim()),
    fields:[...document.querySelectorAll('input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height;}).map(e=>({tag:e.tagName.toLowerCase(),name:e.name,value:e.value,disabled:e.disabled,checked:e.checked,options:e.tagName==='SELECT'?[...e.options].map(o=>({text:o.text,value:o.value})):undefined})),
    links:[...document.querySelectorAll('a[href]')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height;}).map(e=>({text:e.innerText.trim(),href:e.href})),
    text:document.body.innerText.slice(0,12000),
    storage:sessionStorage.getItem('hh.teacher-journey.fixture.v1')
  }));
  const screenshot=join(dir,name+'.png');
  await page.screenshot({path:screenshot,fullPage:true});
  steps.push({name,action,screenshot,dom,requestCount:requests.length});
}
try {
  await page.goto(`${previewLeafUrl}#/register`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#state');
  await record('local-flow-01-register','Fresh synthetic register view; no input changes.');
  await page.locator('#state').selectOption({label:'Demo California'});
  await page.waitForFunction(()=>document.querySelector('#county').options.length>1);
  await record('local-flow-02-state-selected','Selected local fixture state Demo California; downstream county choices became available.');
  const countyLabels=await page.locator('#county option').allTextContents();
  const county=countyLabels.find(x=>!x.startsWith('Choose'));
  await page.locator('#county').selectOption({label:county});
  await page.waitForFunction(()=>document.querySelector('#district').options.length>1);
  const districtLabels=await page.locator('#district option').allTextContents();
  const district=districtLabels.find(x=>!x.startsWith('Choose'));
  await page.locator('#district').selectOption({label:district});
  await page.waitForFunction(()=>document.querySelector('#school').options.length>1);
  const schoolLabels=await page.locator('#school option').allTextContents();
  const school=schoolLabels.find(x=>!x.startsWith('Choose'));
  await page.locator('#school').selectOption({label:school});
  await record('local-flow-03-school-selected','Selected one fixture county, district, and school; no production service called.');
  await page.locator('#demoConsent').check();
  await page.getByRole('button',{name:'Submit demo registration'}).click();
  await page.getByRole('button',{name:'Simulate demo approval'}).waitFor();
  await record('local-flow-04-pending','Submitted the explicitly synthetic registration to its in-tab fixture; pending approval state displayed.');
  await page.getByRole('button',{name:'Simulate demo approval'}).click();
  await page.getByRole('button',{name:'Log in to demo'}).waitFor();
  await record('local-flow-05-approved','Used local-only simulate approval; no real approval or account action.');
  await record('local-flow-06-demo-login','Approved fixture now presents the passwordless demo login form; no authentication action yet.');
  await page.getByRole('button',{name:'Log in to demo'}).click();
  await page.getByRole('heading',{name:'Create Teacher Profile'}).waitFor();
  await record('local-flow-07-profile-create','Entered synthetic authenticated fixture state and profile-creation form.');
  await page.getByRole('button',{name:'Create demo profile'}).click();
  await page.getByRole('heading',{name:'Demo Teacher'}).waitFor();
  await record('local-flow-08-own-profile','Created a synthetic teacher profile in per-tab sessionStorage.');
  await page.getByRole('link',{name:'Teachers',exact:true}).click();
  await page.getByRole('heading',{name:'Meet the demo teachers'}).waitFor();
  await page.getByText('Demo Teacher',{exact:true}).waitFor();
  await record('local-flow-09-directory','Opened the fixture directory after profile creation; the new tab-local profile appears beside seeded profiles.');
  const created=page.locator('article[data-profile-id]').filter({hasText:'Demo Teacher'}).getByRole('link',{name:'View classroom'});
  await created.click();
  await page.getByText('Public demo profile',{exact:true}).waitFor();
  await page.waitForTimeout(250);
  await record('local-flow-10-public-profile','Opened the new synthetic public profile route from the local directory.');
  await page.getByRole('button',{name:'Reset demo'}).click();
  await page.waitForFunction(()=>sessionStorage.getItem('hh.teacher-journey.fixture.v1')===null);
  await record('local-flow-11-reset','Reset local fixture; verified its per-tab sessionStorage record was removed.');
  const external=requests.filter(r=>!r.url.startsWith(`${previewBaseUrl}/`));
  if(external.length) throw new Error('Unexpected non-local request: '+JSON.stringify(external));
} finally { await browser.close(); }
const evidence={
  schema:'homeroom-local-fixture-flow.v1',capturedAt:new Date().toISOString(),
  limits:['All actions used the assembled local fixture provider and one disposable browser tab.','No production login, real account, email, or external request occurred.','Fixture state reset was verified at end.'],
  networkRequests:requests.map(r=>({method:r.method,url:r.url.split('?')[0]})),
  externalRequests:requests.filter(r=>!r.url.startsWith(`${previewBaseUrl}/`)).map(r=>r.url),
  steps
};
await writeFile(join(out,'LOCAL-FIXTURE-FLOW.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({steps:steps.map(s=>({name:s.name,url:s.dom.url,screenshot:s.screenshot,headings:s.dom.headings,requestCount:s.requestCount,storagePresent:!!s.dom.storage})),networkRequests:requests.map(r=>({method:r.method,url:r.url.split('?')[0]})),evidence:join(out,'LOCAL-FIXTURE-FLOW.json')},null,2));
