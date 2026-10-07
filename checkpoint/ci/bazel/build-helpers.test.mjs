import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertFreshPxCube} from './build-helpers.mjs';
test('a failed crisp package blocks publication', () => {
  assert.throws(() => assertFreshPxCube({site:'/tmp', targets:[{id:'hello'}], report:{results:[{id:'hello',ok:false,error:'broken'}]}}), /hello/);
});
test('a source build requires successful results for every declared target and a live site', () => {
  const site=fs.mkdtempSync(path.join(os.tmpdir(),'pxcube-check-'));
  try {
    assert.throws(() => assertFreshPxCube({site,targets:[{id:'hello'}],report:{results:[]}}), /hello/);
    assert.throws(() => assertFreshPxCube({site:site+'/missing',targets:[{id:'hello'}],report:{results:[{id:'hello',ok:true}]}}), /site/);
    assert.doesNotThrow(() => assertFreshPxCube({site,targets:[{id:'hello'}],report:{results:[{id:'hello',ok:true}]}}));
  } finally { fs.rmSync(site,{recursive:true,force:true}); }
});
