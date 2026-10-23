import assert from 'node:assert/strict';
import test from 'node:test';
import {runWitnessFG} from './witness-fg-native.mjs';

test('native PxC produces a supporting WitnessFG evidence Part', async()=>{
  const {first,receipts}=await runWitnessFG();
  assert.equal(first.value.type,'WitnessFGEvidence');
  assert.equal(first.value.verdict,'supported');
  assert.equal(first.value.observed.proofs,2);
  assert.equal(receipts.length,1);
  assert.equal(first.composition.inputs.claim.value.type,'WitnessFG');
});
test('counterexample is retained as a distinct composed Part',async()=>{
  const {pxc,first,receipts}=await runWitnessFG({counterexample:true});
  assert.equal(first.value.verdict,'supported');
  assert.equal(pxc.get('witness/challenged').value.verdict,'challenged');
  assert.equal(receipts.length,2);
  assert.equal(pxc.get('witness/challenged').composition.inputs.observation.value.c,false);
});
