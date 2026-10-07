import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('vendor/studio/upload-disc-to-shelf/accepted-shelf.html','utf8');
test('accepted shelf scenario adapter is deterministic and test-run scoped',()=>{
  assert.match(source,/scenarioParams\.get\('testRun'\)==='1'/);
  assert.match(source,/empty:0,one:1,normal:50,tons:250/);
  assert.match(source,/discstudio\.accepted-shelf\.bags\.v1\$\{scenario\?/);
  assert.match(source,/fs-filter\{display:grid;grid-template-columns:1fr/);
});
test('accepted shelf preserves the interactive mailbox while scoping scenario state by run',()=>{
  assert.match(source,/if\(!scenario\)/);
  assert.match(source,/pxcube\.demo\.v1:handoff:your-shelf-to-on-course/);
  assert.match(source,/scenarioParams\.get\('run'\)\|\|'unbound'/);
});
test('accepted shelf coalesces ResizeObserver layout work outside its callback',()=>{
  assert.match(source,/let resizeFrame=0;new ResizeObserver\(\(\)=>\{if\(resizeFrame\)return;resizeFrame=requestAnimationFrame\(/);
  assert.match(source,/resizeFrame=0;const next=Number\(getComputedStyle\(root\)/);
});
test('accepted shelf has mobile-safe context and explicit upload actions',()=>{
  assert.match(source,/\.fs-context\{grid-template-columns:1fr\}/);
  assert.match(source,/id="fs-add-disc">Add a disc/);
  assert.match(source,/Add your first disc/);
  assert.match(source,/type:'pxcube:your-shelf:navigate',surface:'upload'/);
});
