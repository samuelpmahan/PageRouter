import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
const leaf=path.join(root,'dist/compiled/capability-lab');
const pin=JSON.parse(fs.readFileSync(path.join(root,'vendor/capability-lab/SOURCE-PIN.json'),'utf8'));
const gitBlobSha=bytes=>createHash('sha1').update('blob '+bytes.length+String.fromCharCode(0)).update(bytes).digest('hex');

test('Capability Lab source copy matches its exact repository pin',()=>{
  assert.equal(pin.sourceCommit,'c9214c9db53b6d8c550df516ef6553bc7f7bfa70');
  assert.equal(Object.keys(pin.files).length,40);
  for(const [relative,sha] of Object.entries(pin.files)){
    const bytes=fs.readFileSync(path.join(root,'vendor/capability-lab',relative));
    assert.equal(gitBlobSha(bytes),sha,relative);
  }
});

test('published Capability Lab catalog and browser import closure',()=>{
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'dist/data/catalog.json'),'utf8'));
  const project=catalog.projects.find(p=>p.id==='capability-lab');
  assert.ok(project,'Capability Lab belongs in the PageRouter catalog');
  assert.equal(project.entry,'index.html');
  assert.match(project.digest,/^[0-9a-f]{64}$/);
  const html=fs.readFileSync(path.join(leaf,'index.html'),'utf8');
  assert.match(html,/ui\/app\.mjs/);
  assert.match(html,/ui\/style\.css/);
  assert.match(html,/Replay/);
  for(const relative of Object.keys(pin.files)){
    const destination=path.join(leaf,relative);
    assert.ok(fs.existsSync(destination),`missing published ${relative}`);
    if(!relative.endsWith('.mjs'))continue;
    const source=fs.readFileSync(destination,'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)){
      if(!match[1].startsWith('.'))continue;
      const target=path.resolve(path.dirname(destination),match[1]);
      assert.ok(target.startsWith(leaf+path.sep),`escaped Lab import ${relative}: ${match[1]}`);
      assert.ok(fs.existsSync(target),`missing Lab import ${relative}: ${match[1]}`);
    }
  }
});
