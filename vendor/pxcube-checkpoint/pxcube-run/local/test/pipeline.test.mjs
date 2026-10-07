import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build, root } from '../run.mjs';
import { resolveTargets } from '../affected-targets.mjs';
import { hashSources } from '../../crisp/lib/hasher.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pxcube-local-'));
const fixture=(name,dir=temp())=>{fs.cpSync(path.join(root,'crisp/fixtures',name),dir,{recursive:true});return dir};
const cli=(...args)=>spawnSync(process.execPath,[path.join(root,'crisp/bin/crisp'),...args],{encoding:'utf8'});

test('actual crisp CLI: six fixture intentions, with explicit negative mutations', async t => {
  const rows=[['hello',0],['sneaky',1],['broken',2],['leaky',1],['drift',0],['unknown-world',1]];
  for(const [name,expected] of rows) await t.test(name,async()=>{
    const dir=fixture(name);
    try {
      if(name==='leaky') fs.appendFileSync(path.join(dir,'src/index.html'),'\n<script>persist("shelf.px.discs", []);</script>');
      if(name==='unknown-world'){const file=path.join(dir,'experience.json'),m=read(file);m.mounts=['absent'];write(file,m)}
      if(name==='drift'){const file=path.join(dir,'experience.json'),m=read(file);m.sourceHash=await hashSources(dir,['dist','.crisp']);write(file,m);fs.appendFileSync(path.join(dir,'src/index.html'),'changed');}
      const result=cli('package',dir); assert.equal(result.status,expected,result.stdout+result.stderr);
      if(expected===0) assert.ok(read(path.join(dir,'.crisp/receipt.json')).sourceHash);
      else assert.equal(fs.existsSync(path.join(dir,'.crisp/receipt.json')),false);
    } finally {fs.rmSync(dir,{recursive:true,force:true})}
  });
});

test('shared pipeline retains attempts, isolates failed builds, shows drift and refuses stale output',async()=>{
  const repo=temp();
  try {
    for(const name of ['local','tidy','vendor','crisp','kompoze','mock-pxc','launcher']) fs.cpSync(path.join(root,name),path.join(repo,name),{recursive:true});
    fs.mkdirSync(path.join(repo,'experiences'));
    fixture('hello',path.join(repo,'experiences/hello')); fixture('broken',path.join(repo,'experiences/broken'));
    const first=await build(repo); assert.deepEqual(first.report.results.map(r=>[r.id,r.ok]),[['broken',false],['hello',true]]);
    const firstPage=fs.readFileSync(path.join(first.site,'index.html'),'utf8'); assert.match(firstPage,/build failed, not shipped/);
    const output=fs.readFileSync(path.join(first.site,'experiences/hello/index.html'));
    const hash=createHash('sha256').update(output).digest('hex');assert.equal(first.report.results[1].outputHashes['index.html'],hash);
    const manifest=path.join(repo,'experiences/hello/experience.json'),m=read(manifest);m.track='clean';write(manifest,m);
    const second=await build(repo); assert.equal(second.report.results[1].drift,true);
    assert.equal(read(path.join(repo,'.tidy/pxcube.json')).apps.hello.track,'exp');
    assert.equal(fs.readFileSync(path.join(first.site,'index.html'),'utf8'),firstPage);
    const registrationPath=path.join(repo,'.tidy/pxcube.json'), registration=read(registrationPath);
    registration.apps.hello.sourceHash=second.report.results[1].sourceHash;registration.apps.hello.sharedToolsHash=second.report.sharedToolsHash;write(registrationPath,registration);
    fs.appendFileSync(path.join(repo,'mock-pxc/mock-pxc.mjs'),'\n// dependency changed\n');
    const third=await build(repo);assert.notEqual(second.report.sharedToolsHash,third.report.sharedToolsHash);assert.equal(third.report.results[1].drift,true);assert.equal(third.report.results[1].sourceHash,registration.apps.hello.sourceHash);
    // A successful no-op build with a stale original dist must not ship.
    fs.mkdirSync(path.join(repo,'experiences/hello/dist'));fs.writeFileSync(path.join(repo,'experiences/hello/dist/index.html'),'stale');
    m.build='node -e "process.exit(0)"';write(manifest,m);
    const fourth=await build(repo);assert.equal(fourth.report.results[1].ok,false);assert.match(fourth.report.results[1].error,/output dir/);
    assert.equal(fs.readdirSync(path.join(repo,'.pxcube/runs')).length,4);
    assert.equal(read(path.join(repo,'.pxcube/latest.json')).runId,fourth.report.runId);
    for(const file of fs.readdirSync(path.join(repo,'.neat/items'))) { const item=read(path.join(repo,'.neat/items',file));assert.deepEqual(item.acceptanceRefs,[]);assert.deepEqual(item.promotionRefs,[]); }
  } finally {fs.rmSync(repo,{recursive:true,force:true})}
});

test('a dirty subcommit source snapshot invalidates a warm package cache without a Git commit', async () => {
  const repo = temp();
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    for (const name of ['local', 'tidy', 'vendor', 'crisp', 'kompoze', 'mock-pxc', 'launcher']) fs.cpSync(path.join(root, name), path.join(repo, name), { recursive: true });
    fs.mkdirSync(path.join(repo, 'experiences'));
    fixture('hello', path.join(repo, 'experiences/hello'));
    git('init', '-q'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
    git('add', '.'); git('commit', '-qm', 'base');
    await build(repo); // creates the retained NTC metadata alongside a warm package cache
    git('add', '.neat', '.tidy'); git('commit', '-qm', 'retain snapshot');
    const warm = await build(repo);
    const source = path.join(repo, 'experiences/hello/src/index.html');
    const original = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(source, `${original}\n<!-- dirty subcommit marker -->\n`);
    const head = git('rev-parse', 'HEAD');
    const targets = await resolveTargets(repo, { base: head, head });
    assert.match(targets.find(target => target.id === 'hello').reasons.join('\n'), /experience source changed/);
    const dirty = await build(repo);
    assert.notEqual(dirty.report.results[0].sourceHash, warm.report.results[0].sourceHash);
    assert.notEqual(dirty.report.sourceSnapshot.packageKeys.hello, warm.report.sourceSnapshot.packageKeys.hello);
    assert.deepEqual(dirty.report.sourceSnapshot.transport, process.env.GITHUB_SHA
      ? { kind: 'git-commit', commit: process.env.GITHUB_SHA }
      : { kind: 'working-tree', commit: null });
    assert.ok(dirty.report.sourceSnapshot.dirtyFiles.includes('experiences/hello/src/index.html'));
    assert.match(fs.readFileSync(path.join(dirty.site, 'experiences/hello/index.html'), 'utf8'), /dirty subcommit marker/);
    fs.writeFileSync(source, original);
    const restored = await build(repo);
    assert.equal(restored.report.sourceSnapshot.packageKeys.hello, warm.report.sourceSnapshot.packageKeys.hello);
    assert.doesNotMatch(fs.readFileSync(path.join(restored.site, 'experiences/hello/index.html'), 'utf8'), /dirty subcommit marker/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('vendored original source identities match their recorded commits',()=>{
  for(const [file,identity] of Object.entries(read(path.join(root,'vendor/SOURCES.json')))) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),identity.sha256,file);
});
