import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const repo=resolve('/workspace/scratch/8528bb251845/PageRouter');
const pkg=resolve(repo,'work/hh-continuous-improvement/cycle-07');
const out=resolve('/workspace/scratch/8528bb251845/hh-cycle07/H2/R1007');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=path=>readFile(path);

async function main(){
  const [erratumBytes,e1005Bytes,e1004NarrativeBytes,nativeReceiptBytes,r1005Bytes,manifestBytes,controllerBytes,testBytes]=await Promise.all([
    read(resolve(pkg,'post-review-admin/E1005-hash-erratum.json')),
    read('/workspace/scratch/8528bb251845/hh-cycle07/H1/E1005/result.json'),
    read(resolve(pkg,'evidence/E1004/result.json')),
    read(resolve(pkg,'evidence/native/receipts/E1004.json')),
    read('/workspace/scratch/8528bb251845/hh-cycle07/H2/R1005/result.json'),
    read(resolve(pkg,'evidence/manifest.json')),
    read(resolve(repo,'checkpoint/vendor/hh/src/public-controller.mjs')),
    read(resolve(repo,'checkpoint/vendor/hh/src/public-controller.test.mjs')),
  ]);
  const e=JSON.parse(erratumBytes), h1=JSON.parse(e1005Bytes), receipt=JSON.parse(nativeReceiptBytes), r5=JSON.parse(r1005Bytes), manifest=JSON.parse(manifestBytes);
  const actualNarrative=sha(e1004NarrativeBytes), actualNative=sha(nativeReceiptBytes), actualE1005=sha(e1005Bytes), actualR1005=sha(r1005Bytes), actualManifest=sha(manifestBytes);
  const checks={
    erratumHashMatchesAssignment:sha(erratumBytes)==='ac22e4ffbedfddc0b55f0dc146be4bdd5b2887165bfcca6608de44a4d5fc3d5f',
    erratumQuotesExactBadField:e.binding.quoted_bad_value_exact===h1.provenance_notes[0],
    rawE1005HashUnchanged:actualE1005===e.binding.raw_E1005_result_sha256&&actualE1005==='fb238b10bcc27bdb664b1c065df02237fe6565c7655bef1c556cc246f9aa907a',
    rawE1005FieldNotEdited:h1.provenance_notes[0]===e.binding.quoted_bad_value_exact,
    correctedDigestIsFull64Hex:/^[0-9a-f]{64}$/.test(e.binding.corrected_narrative_sha256),
    correctedDigestMatchesNarrative:actualNarrative===e.binding.corrected_narrative_sha256&&actualNarrative===e.correction.actual_E1004_worker_narrative_sha256,
    erratumCorrectedNoteMatchesReplacement:e.correction.corrected_note===h1.provenance_notes[0].replace(/narrative SHA-256 [0-9a-f]{63}(?=; native receipt)/,`narrative SHA-256 ${actualNarrative}`),
    nativeReceiptUnchanged:actualNative===e.binding.native_E1004_receipt_sha256,
    nativeDigestMatchesE1005Citation:h1.provenance_notes[0].includes(`native receipt SHA-256 ${actualNative}`)&&receipt.job_id==='E1004',
    r1005AmendmentBinding:actualR1005===e.binding.R1005_final_amendment_sha256&&r5.job_id==='R1005'&&r5.worker==='H2'&&r5.decision==='amend',
    manifestUnchanged:actualManifest===e.unchanged_freeze.manifest_sha256&&actualManifest==='b32ad5849211a5fda61b1f74f9df96298b1a834703271a7559149807dc75109f',
    frozenManifestHas68Entries:Object.keys(manifest.files).length===68&&e.unchanged_freeze.manifest_entry_count===68,
    productSourceHashesUnchanged:sha(controllerBytes)==='df2765c4b8eee83236d90e9c4380222561956252a0c2cc9a3d63a8a870be046c'&&sha(testBytes)==='9732658d1e0eaca0d7344d4ba3626540b72e954b55424ec5f1a01572e1028f04',
    erratumIsSeparatelyLabeled: e.purpose.includes('without changing the frozen package or its manifest')&&e.provenance.includes('separately labeled post-review admin file'),
  };
  const result={schema:'hh-cycle07-H2-R1007/erratum-review/v1',job_id:'R1007',worker:'H2',decision:Object.values(checks).every(Boolean)?'accepted':'amend',summary:Object.values(checks).every(Boolean)?'The append-only admin erratum exactly quotes the unchanged E1005 field, binds its unchanged result hash and prior R1005 amend, supplies the full 64-character E1004 narrative SHA and unchanged native receipt hash, and leaves the frozen manifest and source hashes unchanged.':'The erratum binding or frozen-state checks did not all match.',checks,hashes:{erratum:sha(erratumBytes),rawE1005:actualE1005,e1004Narrative:actualNarrative,e1004NativeReceipt:actualNative,r1005:actualR1005,manifest:actualManifest,controller:sha(controllerBytes),controllerTests:sha(testBytes)},boundValues:{badNarrativeReference:e.binding.quoted_bad_value_exact.match(/narrative SHA-256 ([0-9a-f]+)/)?.[1],actualNarrativeSha:actualNarrative,correctedNarrativeSha:e.binding.corrected_narrative_sha256,nativeReceiptSha:actualNative,r1005Decision:r5.decision,r1005Sha:actualR1005,manifestEntryCount:Object.keys(manifest.files).length},limits:{appendOnlyErratumReview:true,noTestsOrBuildRun:true,noSourceOrGitWrite:true,noFrozenManifestWrite:true,priorR1005AmendmentNotRelabeled:true,erratumLocatedOutsideFrozenManifestEntries:true},commands:['node /workspace/scratch/8528bb251845/hh-cycle07/H2/R1007/audit.mjs']};
  await writeFile(resolve(out,'result.json'),`${JSON.stringify(result,null,2)}\n`);
  return result;
}
try{const r=await main();console.log(JSON.stringify(r,null,2));}catch(error){const r={schema:'hh-cycle07-H2-R1007/erratum-review/v1',job_id:'R1007',worker:'H2',decision:'rejected',error:{name:error?.name||'Error',message:String(error?.message||error),stack:String(error?.stack||'')}};await writeFile(resolve(out,'result.json'),`${JSON.stringify(r,null,2)}\n`);console.log(JSON.stringify(r,null,2));process.exitCode=1;}
