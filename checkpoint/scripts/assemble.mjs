import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {buildSnapshot,createPatch,applyPatch,canonical,hash,packSnapshot} from '../src/compiled-patch.mjs';
import {staticSpec} from '../src/static-compiler.mjs';
import {atlasImplementationIdentity} from './atlas-identity.mjs';
import {preservePxCube} from './preserve-pxcube.mjs';
import {evaluatorClosure,evaluatorImplementationPin} from './evaluator-identity.mjs';
import {relocateHhServiceImports} from './relocate-hh-imports.mjs';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist');
fs.mkdirSync(dist,{recursive:true});
for(const f of ['index.html','app.mjs','session-repl.mjs','justin-site-ide.mjs','styles.css','static-compiler.mjs','compiled-patch.mjs','project-router.mjs','local-store.mjs','sw.js'])fs.copyFileSync(path.join(root,'src',f),path.join(dist,f));
const atlasViewSource=fs.readFileSync(path.join(root,'src/atlas-view.mjs'),'utf8');
let builtAtlasView=atlasViewSource;
for(const module of ['atlas-session.mjs','cross-language.mjs']){
  const sourceImport=`'../exp/atlas/${module}'`;
  if(builtAtlasView.split(sourceImport).length!==2)throw Error(`Unexpected Atlas runtime import mapping: ${module}`);
  builtAtlasView=builtAtlasView.replace(sourceImport,`'./exp/atlas/${module}'`);
}
fs.writeFileSync(path.join(dist,'atlas-view.mjs'),builtAtlasView);
let builtBlock5View=fs.readFileSync(path.join(root,'src/block5-view.mjs'),'utf8');
for(const folder of ['block5/core','compression']){
  const sourceImport=`'../exp/${folder}/`;
  if(!builtBlock5View.includes(sourceImport))throw Error(`Block5 import mapping not found: ${folder}`);
  builtBlock5View=builtBlock5View.replaceAll(sourceImport,`'./exp/${folder}/`);
}
fs.writeFileSync(path.join(dist,'block5-view.mjs'),builtBlock5View);
fs.cpSync(path.join(root,'exp/atlas'),path.join(dist,'exp/atlas'),{recursive:true});
fs.cpSync(path.join(root,'exp/block5'),path.join(dist,'exp/block5'),{recursive:true});
fs.cpSync(path.join(root,'exp/compression'),path.join(dist,'exp/compression'),{recursive:true});
fs.cpSync(path.join(root,'exp/cooperative'),path.join(dist,'exp/cooperative'),{recursive:true});
fs.cpSync(path.join(root,'vendor/hh/services'),path.join(dist,'vendor/hh/services'),{recursive:true});
fs.mkdirSync(path.join(dist,'vendor/hh/src'),{recursive:true});fs.copyFileSync(path.join(root,'vendor/hh/src/teacher-journey.mjs'),path.join(dist,'vendor/hh/src/teacher-journey.mjs'));
fs.mkdirSync(path.join(dist,'data'),{recursive:true});
fs.cpSync(path.join(root,'vendor/hh-geography-review'),path.join(dist,'hh-geography-review'),{recursive:true});
const auditSource=path.join(root,'vendor/justin-audit');if(fs.existsSync(auditSource)){fs.rmSync(path.join(dist,'justin-audit'),{recursive:true,force:true});fs.cpSync(auditSource,path.join(dist,'justin-audit'),{recursive:true});}
fs.mkdirSync(path.join(dist,'compare'),{recursive:true});fs.copyFileSync(path.join(root,'vendor/pagerouter/index.html'),path.join(dist,'compare/index.html'));fs.writeFileSync(path.join(dist,'compare/pagerouter.json'),JSON.stringify({title:'Pinned compiled project comparison',sites:[{label:'PxCube full launcher',url:'../compiled/pxcube/index.html'},{label:'HH C6 fixture preview',url:'../compiled/hh/index.html'},{label:'Justin standalone leaf',url:'../compiled/justin/index.html'}]},null,2));
function files(dir){const o={};function walk(d,p=''){for(const name of fs.readdirSync(d).sort()){const f=path.join(d,name),r=p?`${p}/${name}`:name;const st=fs.lstatSync(f);if(st.isSymbolicLink())throw Error('Symlink prohibited');if(st.isDirectory())walk(f,r);else if(st.isFile())o[r]={encoding:'base64',data:fs.readFileSync(f).toString('base64')};}}walk(dir);return o;}

const pxcEvidence=JSON.parse(fs.readFileSync(path.join(root,'evidence/pxcube-build.json')));
const pxcRelocation=await preservePxCube(root,pxcEvidence,files);
// The public HH page ships without the PxC devtools and the fast-check style playground (Sam, 30 Oct: "We don't need fast-check or
// devtools"); their sources stay in vendor/hh/src for anyone who wants to read them.
const hh=path.join(root,'build/hh');fs.rmSync(hh,{recursive:true,force:true});fs.mkdirSync(hh,{recursive:true});
const hhLeftOut=['pxc-devtools','style-playground.mjs','vendor'].map(name=>path.join(root,'vendor/hh/src',name));
fs.cpSync(path.join(root,'vendor/hh/src'),hh,{recursive:true,filter:source=>!source.endsWith('.test.mjs')&&!hhLeftOut.some(left=>source===left||source.startsWith(left+path.sep))});fs.cpSync(path.join(root,'vendor/hh/services'),path.join(hh,'services'),{recursive:true});relocateHhServiceImports(hh);
// The homepage photographs ship as WebP; vendor/hh/src keeps the captured JPEGs as the source. The receipt records every hash and encoder version.
execFileSync(process.env.PYTHON??'python3',[path.join(root,'scripts/reencode-pictures.py'),hh,path.join(root,'scripts/hh-pictures.json'),path.join(root,'build/hh-pictures-receipt.json')],{stdio:'inherit'});
const justin=path.join(root,'build/justin');fs.mkdirSync(justin,{recursive:true});fs.cpSync(path.join(root,'vendor/justin'),justin,{recursive:true});
const capabilityLab=path.join(root,'vendor/capability-lab');
// Technical portability fixes only. Original prose/links preserved.
for(const f of fs.readdirSync(justin).filter(f=>f.endsWith('.html'))){let html=fs.readFileSync(path.join(justin,f),'utf8');html=html.replace('https://cdn.tailwindcss.com','./dependencies/tailwind.js');html=html.replace('static/pictures/hero.jpg','static/pictures/jbrundage.jpg');fs.writeFileSync(path.join(justin,f),html);}
const projectDefs=[{id:'pxcube',title:'PxCube',subtitle:'14 actual crisp-packaged experiences including Connect Four baseline and PxC migration',dir:pxcRelocation.directory,pin:'Connect Four baseline → PxC + seek-tree migration',source:'https://drive.google.com/drive/folders/1kalwzut63qJEQLiy0OC9aVuDbrEdcXKb',entry:'index.html',trusted:true},{id:'hh',title:'Homeroom Heroes',subtitle:'C6 browser PxC + synthetic fixture DI',dir:hh,pin:'C6 • 7462b8a200a6',source:'https://drive.google.com/file/d/1U1YBFvEOmJG-ZHVZnBr7TogjsLmWXoNz/view',entry:'index.html',trusted:true},{id:'justin',title:'Justin’s standalone site',subtitle:'Pinned leaf • technical portability fixes only',dir:justin,pin:'9fccd18d3077 • local technical patch',source:'https://github.com/EngSmallz/BrundageForCommunity/tree/9fccd18d3077a30f70c26824981fd11718bd761b',entry:'index.html',trusted:true},{id:'capability-lab',title:'Capability Lab',subtitle:'Statistics, linear algebra, watches, ML and explanations · browser-local candidate',dir:capabilityLab,pin:'2026-10-08 independent candidate · 271/271',source:'https://github.com/samuelpmahan/PageRouter/tree/c9214c9db53b6d8c550df516ef6553bc7f7bfa70/outputs/capability-lab',entry:'index.html',trusted:true}];
projectDefs.push({id:'thro',title:'thro',subtitle:'Prepared discs to transparent video graphics · browser-local fixture',dir:path.join(pxcRelocation.directory,'experiences/thro'),pin:'Prepared fixture candidate · human acceptance pending',source:'https://github.com/samuelpmahan/PageRouter',entry:'index.html',trusted:true});
const catalog=[];
for(const p of projectDefs){
  const compiledDir=path.join(dist,'compiled',p.id);
  fs.rmSync(compiledDir,{recursive:true,force:true});
  fs.cpSync(p.dir,compiledDir,{recursive:true});
  if(p.id==='capability-lab'){
    const competitionRoot=path.join(root,'exp/capability-competitions');
    const references=path.join(compiledDir,'references');
    fs.mkdirSync(references,{recursive:true});
    fs.copyFileSync(path.join(competitionRoot,'capabilities.mjs'),path.join(references,'capabilities.mjs'));
    let capabilitySource=fs.readFileSync(path.join(references,'capabilities.mjs'),'utf8');
    const vendorPrefix='../../vendor/capability-lab/src/';
    if(!capabilitySource.includes(vendorPrefix))throw Error('Capability competition vendor import prefix not found');
    capabilitySource=capabilitySource.replaceAll(vendorPrefix,'../src/');
    fs.writeFileSync(path.join(references,'capabilities.mjs'),capabilitySource);
    const browserSource=path.join(competitionRoot,'browser');
    if(!fs.existsSync(path.join(browserSource,'entry.mjs')))throw Error('Capability competition browser entry is missing');
    fs.cpSync(browserSource,path.join(references,'browser'),{recursive:true,filter:source=>!source.endsWith('.test.mjs')});
    const entryPath=path.join(references,'browser/entry.mjs');
    let entrySource=fs.readFileSync(entryPath,'utf8');
    const entryVendorPrefix='../../../vendor/capability-lab/';
    if(!entrySource.includes(entryVendorPrefix))throw Error('Capability competition browser entry vendor prefix not found');
    entrySource=entrySource.replaceAll(entryVendorPrefix,'../../');
    fs.writeFileSync(entryPath,entrySource);
    const indexPath=path.join(compiledDir,'index.html');
    let html=fs.readFileSync(indexPath,'utf8');
    if(html.includes('./references/browser/entry.mjs'))throw Error('Capability competition browser entry was already injected');
    if(!html.includes('</body>'))throw Error('Capability Lab HTML has no body insertion point');
    html=html.replace('</body>','    <script type="module" src="./references/browser/entry.mjs"></script>\n  </body>');
    fs.writeFileSync(indexPath,html);
    const stylesheet=path.join(references,'browser/panel.css');
    if(!fs.existsSync(stylesheet))throw Error('Capability competition browser stylesheet is missing');
    if(html.includes('./references/browser/panel.css'))throw Error('Capability competition stylesheet was already injected');
    if(!html.includes('</head>'))throw Error('Capability Lab HTML has no stylesheet insertion point');
    const stylesheetVersion=(await hash(fs.readFileSync(stylesheet))).slice(0,12);
    html=html.replace('</head>',`    <link rel="stylesheet" href="./references/browser/panel.css?v=${stylesheetVersion}">\n  </head>`);
    fs.writeFileSync(indexPath,html);
  }
  const snapshot=await buildSnapshot(staticSpec(p.id,files(compiledDir)));
  if(p.id==='hh')fs.writeFileSync(path.join(dist,'data',`${p.id}.snapshot.json`),JSON.stringify(snapshot));else fs.writeFileSync(path.join(dist,'data',`${p.id}.snapshot.json.gz`),gzipSync(JSON.stringify(packSnapshot(snapshot)),{level:9}));
  catalog.push({...p,dir:undefined,digest:snapshot.digest,fileCount:Object.keys(snapshot.files).length,bytes:Object.values(snapshot.files).reduce((n,x)=>n+x.bytes,0)});
}
// Preserve the captured source-site URLs on static hosts that do not provide
// server-side rewrites. The compiled HH app normalizes these hash routes.
const hhPageAliases=['homepage.html','index.html','find_teachers.html','forum.html','create_post.html',
  'post.html','teacher.html','about.html','contact.html','partners.html','login.html','forgot.html',
  'register.html','terms_conditions.html'];
const pagesDir=path.join(dist,'pages');fs.mkdirSync(pagesDir,{recursive:true});
for(const page of hhPageAliases){
  const target=`../compiled/hh/index.html#/pages/${page}`;
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homeroom Heroes</title><p>Opening Homeroom Heroes… <a href="${target}">Continue</a></p><script>location.replace(${JSON.stringify(target)}+location.search)</script></html>`;
  fs.writeFileSync(path.join(pagesDir,page),html);
}
const base=JSON.parse(fs.readFileSync(path.join(dist,'data/hh.snapshot.json')));const sources=files(hh);const original=Buffer.from(sources['styles.css'].data,'base64').toString();sources['styles.css']={encoding:'utf8',data:original+'\n/* locally compiled delta: inspection accent */\nh1 { color: #38bdf8; }\n'};
const spec=staticSpec('hh',sources);const target=await buildSnapshot(spec,{baseline:base});const clean=await buildSnapshot(spec);const patch=await createPatch(base,target),applied=await applyPatch(base,patch);
if(applied.digest!==clean.digest||canonical(applied.files)!==canonical(clean.files))throw Error('Delta != clean build');
fs.writeFileSync(path.join(dist,'data/hh.delta.json'),JSON.stringify(patch));fs.writeFileSync(path.join(dist,'data/hh.target.json'),JSON.stringify(target));
const proof={kind:'actual-HH-C6-compiled-byte-delta',baseDigest:base.digest,targetDigest:target.digest,cleanDigest:clean.digest,equal:true,rebuilt:target.build.rebuilt,reused:target.build.reused,operations:patch.ops.map(({data,...x})=>({...x,payloadBytes:data?Buffer.from(data,'base64').length:0})),patchBytes:Buffer.byteLength(JSON.stringify(patch)),fullBytes:Buffer.byteLength(JSON.stringify(target)),payloadBytes:patch.ops.reduce((n,x)=>n+(x.data?Buffer.from(x.data,'base64').length:0),0)};
fs.writeFileSync(path.join(root,'evidence/hh-delta-proof.json'),JSON.stringify(proof,null,2));fs.writeFileSync(path.join(dist,'data/delta-proof.json'),JSON.stringify(proof));
const neat=pxcEvidence.report.results.map(r=>({id:r.id,ok:r.ok,error:r.error??null,build:r.build,sourceHash:r.sourceHash,receipt:r.receipt}));
const packageRecord=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const sourceDigests={};for(const folder of ['src','scripts','exp/cooperative','exp/atlas','exp/block5','exp/compression','vendor/hh-geography-review'])for(const [f,v]of Object.entries(files(path.join(root,folder))))sourceDigests[folder+'/'+f]=await hash(Buffer.from(v.data,'base64'));const siteBuildId=await hash(canonical({package:packageRecord,sourceDigests,projectPins:catalog.map(p=>({id:p.id,pin:p.pin,digest:p.digest})),auditFiles:fs.existsSync(auditSource)?Object.fromEntries(await Promise.all(Object.entries(files(auditSource)).map(async([p,v])=>[p,await hash(Buffer.from(v.data,'base64'))]))):null}));
// A deployed review must not keep executing the browser's previous root module.
const entryPath=path.join(dist,'index.html'),entryHtml=fs.readFileSync(entryPath,'utf8');
if(entryHtml.split('src="app.mjs"').length!==2)throw Error('Unexpected PageRouter module entry');
const entryModuleDigest=await hash(fs.readFileSync(path.join(dist,'app.mjs')));
fs.writeFileSync(entryPath,entryHtml.replace('src="app.mjs"',`src="app.mjs?v=${entryModuleDigest}"`));
const atlasIdentity=atlasImplementationIdentity(root);
const evaluatorIdentity=evaluatorClosure(root),buildId=evaluatorImplementationPin(evaluatorIdentity,JSON.parse(fs.readFileSync(path.join(root,'vendor/evaluator-baseline-af0c2e0f.json'))));
const annotationReportFile=path.join(root,'exp/adversarial/evidence/justin-site-ide-qa.json');const annotationReport=fs.existsSync(annotationReportFile)?JSON.parse(fs.readFileSync(annotationReportFile)):null;const annotationProof=annotationReport?{tested:annotationReport.checks.every(c=>c.ok),passed:annotationReport.checks.filter(c=>c.ok).length,failed:annotationReport.checks.filter(c=>!c.ok).length,evidence:'data/annotation-verification.json'}:null;if(annotationReport)fs.writeFileSync(path.join(dist,'data/annotation-verification.json'),JSON.stringify({schema:'annotation-browser-verification@1',checks:annotationReport.checks,pageErrors:annotationReport.pageErrors,evaluatorCompatibility:JSON.parse(fs.readFileSync(path.join(root,'evidence/evaluator-compatibility.json')))},null,2));
fs.writeFileSync(path.join(dist,'data/catalog.json'),JSON.stringify({release:{version:packageRecord.version,channel:packageRecord.releaseChannel,buildId,siteBuildId,evaluatorIdentity,atlasIdentity,notes:packageRecord.releaseNotes,record:'package.json',sourceCheckpoint:packageRecord.sourceCheckpoint??null},annotationProof,projects:catalog,knownTargets:{hh:[target.digest]},pxcubeResults:neat,targets:pxcEvidence.targets,lifecycle:pxcEvidence.report.sourceSnapshot,sourceDiscovery:{pageRouter:'Recovered samuelpmahan/PageRouter @5cc1ae3d8d4d3c14074829c48118d1e70912b6dd; original A/B compare retained, new outer workbench explicitly layered on top'},portability:{pxcube:pxcRelocation.provenance,justin:['CDN Tailwind reference localized to pinned mirrored dependency','Broken hero.jpg reference points to existing pinned portrait jbrundage.jpg','Campaign text and external destinations unchanged']}}));
for(const f of ['pxcube-experiences.snapshot.json']){const p=path.join(dist,'data',f);if(fs.existsSync(p)){fs.writeFileSync(p+'.gz',gzipSync(JSON.stringify(packSnapshot(JSON.parse(fs.readFileSync(p)))),{level:9}));fs.unlinkSync(p);}}
console.log(JSON.stringify({projects:catalog.map(x=>({id:x.id,files:x.fileCount,digest:x.digest})),delta:proof},null,2));
