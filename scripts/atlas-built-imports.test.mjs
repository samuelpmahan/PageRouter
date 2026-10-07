import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {atlasImplementationIdentity} from './atlas-identity.mjs';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist');
test('built Atlas renderer resolves its complete local runtime import closure and separate identity',()=>{
  const pending=[path.join(dist,'atlas-view.mjs')],visited=new Set();
  while(pending.length){
    const file=pending.pop();if(visited.has(file))continue;visited.add(file);
    assert.ok(file.startsWith(dist+path.sep),'Built Atlas import stays in dist');assert.ok(fs.existsSync(file),`Missing ${file}`);
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)){
      const target=path.resolve(path.dirname(file),match[1]);assert.ok(fs.existsSync(target),`${file} imports ${match[1]}`);if(/\.(mjs|js)$/.test(target))pending.push(target);
    }
  }
  assert.ok(visited.has(path.join(dist,'exp/atlas/atlas-session.mjs')));
  assert.ok(visited.has(path.join(dist,'exp/atlas/capability-protocol.mjs')), 'The built renderer reaches capability implementations');
  assert.ok(visited.has(path.join(dist,'exp/atlas/cross-language.mjs')), 'The built renderer reaches the cross-language FG workflow');
  const catalog=JSON.parse(fs.readFileSync(path.join(dist,'data/catalog.json')));
  assert.match(catalog.release.atlasIdentity.digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(catalog.release.atlasIdentity,atlasImplementationIdentity(root),'Catalog identity describes the current actual runtime source closure');
  for(const [relative,record] of Object.entries(catalog.release.atlasIdentity.files)){
    const bytes=fs.readFileSync(path.join(dist,relative));
    assert.equal(bytes.length,record.bytes,relative+' compiled runtime length');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,relative+' compiled runtime source bytes');
  }
  assert.notEqual(catalog.release.atlasIdentity.digest,catalog.release.buildId);
  assert.equal(catalog.release.version,'0.0.0');
});
