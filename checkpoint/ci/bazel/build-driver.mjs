import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {assertFreshPxCube} from './build-helpers.mjs';
import {fileURLToPath} from 'node:url';

const expanded = process.argv.slice(2).flatMap(arg => arg.startsWith('@') ? fs.readFileSync(arg.slice(1),'utf8').trimEnd().split('\n') : [arg]);
const [siteArg, evidenceArg, receiptArg, logArg, ...pairs] = expanded;
const [site, evidence, receipt, log] = [siteArg,evidenceArg,receiptArg,logArg].map(arg=>path.resolve(arg));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'pagerouter-build-'));
const root = path.join(scratch,'source'), tools = path.join(scratch,'tools');
const transcript = [], sourceInputs = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function copy(relative, from, to) {
  if (path.isAbsolute(relative) || relative.split('/').some(part=>!part || part==='..' || part==='.')) throw Error(`Invalid declared input: ${relative}`);
  const destination=path.join(to,relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(from,destination);
  fs.chmodSync(destination,fs.statSync(from).mode | 0o200);
}
function run(label,args) {
  console.log(label);
  const result=spawnSync(path.join(tools,'bin/node'),args,{cwd:root,env:{LANG:'C.UTF-8',TZ:'UTC',PATH:path.join(tools,'bin'),HOME:scratch,TMPDIR:scratch},encoding:'utf8',maxBuffer:32*1024*1024,timeout:300000});
  transcript.push(`\n${label}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  if(result.error || result.status!==0) throw Error(`${label} failed: ${result.error?.message ?? result.status}`);
}
try {
  for(let i=0;i<pairs.length;i+=3){
    const [kind,relative,from]=pairs.slice(i,i+3);
    if(kind==='--source') {
      copy(relative,from,root);
      const bytes=fs.readFileSync(from);
      sourceInputs.push({path:relative,bytes:bytes.length,sha256:sha(bytes)});
    } else if(kind==='--tool') copy(relative,from,tools);
    else throw Error(`Unknown input kind ${kind}`);
  }
  fs.cpSync(path.join(tools,'node_modules'),path.join(root,'node_modules'),{recursive:true});
  for(const generated of ['dist','build','sources/pxcube/.pxcube']) {
    if(fs.existsSync(path.join(root,generated))) throw Error(`Generated input forbidden: ${generated}`);
  }
  // The original scripts own all application compilation and packaging.
  run('Self-host fast-check',['scripts/build-fast-check-bundle.mjs']);
  run('Compile PxCube/neat and crisp-package every experience',['scripts/build-pxcube.mjs']);
  const pxc=JSON.parse(fs.readFileSync(path.join(root,'evidence/pxcube-build.json')));
  assertFreshPxCube(pxc);
  run('Assemble PageRouter',['scripts/assemble.mjs']);
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'dist/data/catalog.json')));
  if(catalog.portability.pxcube!==null) throw Error('Assembly used historical shipped-byte relocation');
  run('Verify crisp changed-source/cache/clean equality',['scripts/verify-crisp-delta.mjs']);
  const proof=JSON.parse(fs.readFileSync(path.join(root,'evidence/crisp-delta-proof.json')));
  if(proof.exactCompiledEquality!==true) throw Error('Crisp clean-build proof missing');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
  const testArgs=pkg.scripts.test.split(/\s+/);
  if(testArgs.shift()!=='node' || testArgs.shift()!=='--test') throw Error('Review changed npm test command before updating Bazel driver');
  const files=testArgs.flatMap(pattern=>pattern.includes('*') ? fs.readdirSync(path.join(root,path.dirname(pattern))).filter(name=>name.endsWith('.test.mjs')).map(name=>path.join(path.dirname(pattern),name)) : [pattern]);
  // Executes exactly the current npm test suite with declared Node, without npm's shell.
  run('npm test suite against freshly assembled site',['--test',...files]);
  run('Built Atlas import closure',['--test','scripts/atlas-built-imports.test.mjs']);
  fs.mkdirSync(path.dirname(site),{recursive:true});
  fs.cpSync(path.join(root,'dist'),site,{recursive:true});
  fs.cpSync(path.join(root,'evidence'),evidence,{recursive:true});
  const outputFiles=[];
  function walk(dir,prefix='') {
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const rel=prefix?`${prefix}/${entry.name}`:entry.name, file=path.join(dir,entry.name);
      if(entry.isSymbolicLink()) throw Error(`Output symlink: ${rel}`);
      if(entry.isDirectory()) walk(file,rel);
      else {const bytes=fs.readFileSync(file);outputFiles.push({path:rel,bytes:bytes.length,sha256:sha(bytes)});}
    }
  }
  walk(site);sourceInputs.sort((a,b)=>a.path.localeCompare(b.path));
  const record={schema:'pagerouter-source-build@1',node:process.version,recipe:{driverSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),helpersSha256:sha(fs.readFileSync(new URL('./build-helpers.mjs',import.meta.url)))},toolchain:JSON.parse(fs.readFileSync(path.join(tools,'toolchain.json'))),sourceInputs,sourceDigest:sha(JSON.stringify(sourceInputs)),siteFiles:outputFiles,siteDigest:sha(JSON.stringify(outputFiles)),siteBuildId:catalog.release.siteBuildId,pxcube:{rebuilt:true,packages:pxc.report.results.length,relocated:false},crispExactCompiledEquality:true};
  fs.writeFileSync(receipt,JSON.stringify(record,null,2)+'\n');
  transcript.push(`Built ${outputFiles.length} files; all ${record.pxcube.packages} PxCube packages succeeded; fresh output siteBuildId ${record.siteBuildId}`);
  fs.writeFileSync(log,transcript.join('\n')+'\n');
  console.log(transcript.at(-1));
} catch(error) {
  console.error(transcript.join('\n'));
  throw error;
} finally {
  fs.rmSync(scratch,{recursive:true,force:true});
}
