import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';

const repo=resolve('/workspace/scratch/8528bb251845/PageRouter');
const pkg=join(repo,'work/hh-continuous-improvement/cycle-07');
const out=resolve('/workspace/scratch/8528bb251845/hh-cycle07/H2/R1005');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>readFile(p);
async function listFiles(dir){let all=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())all.push(...await listFiles(p));else if(e.isFile())all.push(relative(pkg,p).split('\\').join('/'));}return all;}
async function main(){
  const manifest=JSON.parse(await read(join(pkg,'evidence/manifest.json')));
  const entries=Object.entries(manifest.files), problems=[];
  for(const [path,expected] of entries){try{const bytes=await read(join(pkg,path));if(hash(bytes)!==expected)problems.push({path,kind:'sha256',expected,actual:hash(bytes)});}catch(error){problems.push({path,kind:'missing',error:String(error)});}}
  const actualFiles=(await listFiles(pkg)).filter(p=>p!=='evidence/manifest.json').sort();
  const expectedFiles=entries.map(([p])=>p).sort();
  const extra=actualFiles.filter(p=>!expectedFiles.includes(p)),missing=expectedFiles.filter(p=>!actualFiles.includes(p));
  const source=JSON.parse(await read(join(pkg,'evidence/native/source-freeze.json')));
  const e1005Bytes=await read('/workspace/scratch/8528bb251845/hh-cycle07/H1/E1005/result.json');
  const e1005=JSON.parse(e1005Bytes);
  const e1004=JSON.parse(await read(join(pkg,'evidence/E1004/result.json')));
  const receipt=JSON.parse(await read(join(pkg,'evidence/E1004/site.receipt.json')));
  const bindings=JSON.parse(await read(join(pkg,'evidence/E1004/source-input-bindings.json')));
  const sourceHashes={};for(const [p,expected] of Object.entries(source.productInputs)){const b=await read(join(repo,p));sourceHashes[p]={expected,actual:hash(b),bytes:b.length,manifestMatched:expected===hash(b)};}
  const receiptInputs={};for(const input of receipt.sourceInputs.filter(x=>x.path.startsWith('vendor/hh/src/public-controller'))){const b=await read(join(repo,'checkpoint',input.path));receiptInputs[input.path]={expected:input.sha256,actual:hash(b),expectedBytes:input.bytes,actualBytes:b.length,match:hash(b)===input.sha256&&b.length===input.bytes};}
  const narrativePath=join(pkg,'evidence/E1004/result.json'),nativePath=join(pkg,'evidence/native/receipts/E1004.json'),clarPath=join(pkg,'evidence/E1004/clarification.json');
  const provenance={narrativeSha:hash(await read(narrativePath)),narrativeExpected:e1005.provenance_notes[0].match(/narrative SHA-256 ([0-9a-f]+)/)?.[1]||null,
    nativeSha:hash(await read(nativePath)),nativeExpected:e1005.provenance_notes[0].match(/native receipt SHA-256 ([0-9a-f]+)/)?.[1]||null,
    clarificationNarrativeSha:JSON.parse(await read(clarPath)).worker_and_native_records.worker_narrative.match(/SHA-256 ([0-9a-f]+)/)?.[1]||null,
    clarificationNativeSha:JSON.parse(await read(clarPath)).worker_and_native_records.native_finish_envelope.match(/SHA-256 ([0-9a-f]+)/)?.[1]||null,
    nativeAssignmentStart:JSON.parse(await read(clarPath)).canonical_build_timing.native_assignment_started_at,
    workerApproxStart:JSON.parse(await read(clarPath)).canonical_build_timing.worker_report_started_at_approx};
  const logs={site:await read(join(pkg,'evidence/E1004/site.log')),build:await read(join(pkg,'evidence/E1004/build.log'))};
  const logFacts={preflight2:logs.build.toString().includes('✔ a failed crisp package blocks publication')&&logs.build.toString().includes('ℹ tests 2')&&logs.build.toString().includes('ℹ pass 2'),targeted121:logs.site.toString().includes('ℹ tests 121')&&logs.site.toString().includes('ℹ pass 121'),full276:logs.site.toString().includes('ℹ tests 276')&&logs.site.toString().includes('ℹ pass 276'),atlas1:logs.site.toString().includes('built Atlas renderer resolves its complete local runtime import closure'),pxcube14:logs.build.toString().includes('all 14 PxCube packages succeeded'),site843:logs.build.toString().includes('Built 843 files')};
  const r1003=JSON.parse(await read(join(pkg,'evidence/R1003/result.json'))),r1003probe=await read(join(pkg,'evidence/R1003/probe.mjs'));
  const mismatchProbe=await read(join(pkg,'evidence/R1003/stdout.log'));
  const portable=JSON.parse(await read(join(out,'portable-replay/result.json'))),portableStdout=await read(join(out,'portable-replay.stdout.log'));
  const result={schema:'hh-cycle07-H2-R1005/package-audit/v1',job_id:'R1005',worker:'H2',decision:'amend',summary:'All 68 frozen package entries and canonical source bindings/counts match. The audit finds one administrative E1005 provenance-note SHA typo outside the frozen package: its E1004 narrative hash omits the final 1. The underlying narrative, native receipt, and clarification are distinct and byte-exact; preserve the originals and issue a separate erratum.',
    manifest:{expectedSha:'b32ad5849211a5fda61b1f74f9df96298b1a834703271a7559149807dc75109f',actualSha:hash(await read(join(pkg,'evidence/manifest.json'))),entryCount:entries.length,checkedCount:entries.length,mismatches:problems,extra,missing},
    source:{head:source.localHeadAtCycleStart,tree:source.localTreeAtCycleStart,productInputs:sourceHashes,currentSourceTree:{head:'7feded8819db87026a8f35f6aa515bda513ab541',tree:'1cdcf9bfb34b680ed198eb7e750486ecfd1887cc'},worktreeStatus:'expected two frozen source paths modified; package untracked before audit'},
    canonicalBuild:{receiptShaExpected:e1005.canonical_build.receipt_sha256,receiptShaActual:hash(await read(join(pkg,'evidence/E1004/site.receipt.json'))),receiptInputs:receiptInputs,bindingsInputs:bindings.sourceInputs,
      sourceInputsMatchBinding:JSON.stringify(receiptInputs)===JSON.stringify(Object.fromEntries(bindings.sourceInputs.map(x=>[x.path,{expected:x.sha256,actual:x.sha256,expectedBytes:x.bytes,actualBytes:x.bytes,match:true}]))),
      sourceDigest:receipt.sourceDigest,sourceInputBindingDigest:bindings.sourceDigest,sourceDigestMatchesBinding:receipt.sourceDigest===bindings.sourceDigest,sourceInputCount:receipt.sourceInputs.length,siteBuildId:receipt.siteBuildId,siteDigest:receipt.siteDigest,crispExactCompiledEquality:receipt.crispExactCompiledEquality,pxcube:receipt.pxcube,siteFiles:receipt.siteFiles.length,logFacts,
      reportedCounts:e1005.canonical_build.fresh_counts_from_actual_site_log_and_build_log,verdict:e1004.outcome},
    provenance:{...provenance,e1005ResultSha:hash(e1005Bytes),e1005ExpectedResultSha:'fb238b10bcc27bdb664b1c065df02237fe6565c7655bef1c556cc246f9aa907a',e1005ResultHashMatches:hash(e1005Bytes)==='fb238b10bcc27bdb664b1c065df02237fe6565c7655bef1c556cc246f9aa907a',e1005NarrativeReferenceMissingFinal1:provenance.narrativeSha===`${provenance.narrativeExpected}1`,clarificationMatchesBoth:provenance.clarificationNarrativeSha===provenance.narrativeSha&&provenance.clarificationNativeSha===provenance.nativeSha,interpretation:'E1005 provenance_notes[0] cites a 63-character narrative SHA ending ...f46a; the actual and clarified narrative SHA is 64 characters ending ...f46a1. This is an administrative transcription typo outside the frozen 68-entry package. The original E1005 result, E1004 narrative, native receipt, and clarification remain byte-for-byte preserved; do not normalize or rewrite them.'},
    r1003:{outcome:r1003.decision,summary:r1003.summary,probeSha:hash(r1003probe),manifestProbeSha:manifest.files['evidence/R1003/probe.mjs'],probeMatchesManifest:hash(r1003probe)===manifest.files['evidence/R1003/probe.mjs'],stdoutSha:hash(mismatchProbe),rawStdoutExcerpt:mismatchProbe.toString().slice(0,800),initialScriptPreserved:false,scope:'Packaged final probe is present; initial wrong-constant script bytes are explicitly not retained.'},
    portableR1003Replay:{resultSha:hash(await read(join(out,'portable-replay/result.json'))),stdoutSha:hash(portableStdout),outcome:portable.decision,allAssertionsPassed:portable.allAssertionsPassed,cases:portable.cases.map(x=>x.case),sourceHashes:portable.sourceHashes,originalScriptSha:hash(r1003probe),pathOnlyCompanionSha:hash(await read(join(out,'portable-probe.mjs'))),diffSha:hash(await read(join(out,'portable-probe.diff'))),scriptAdaptation:'Scratch path-only companion copied from packaged final probe; exactly one line changes const out from R1003 to R1005/portable-replay. Diff retained. No package/source write.'},
    limits:{noRepositoryOrPackageMutation:true,noCommitOrPublication:true,historicalVerificationNotCurrentBrowserQA:true,noBrowserVisualQAClaim:true,sourceRedGreenLogsAreEvidenceNotIndependentlyReexecuted:true,preflightCountEvidence:'2/2 visible at start of actual build.log',initialR1003ScriptBytes:'not preserved; do not reconstruct or claim otherwise'},
    commands:['node /workspace/scratch/8528bb251845/hh-cycle07/H2/R1005/audit.mjs','node /workspace/scratch/8528bb251845/hh-cycle07/H2/R1005/portable-probe.mjs','diff -u work/hh-continuous-improvement/cycle-07/evidence/R1003/probe.mjs /workspace/scratch/8528bb251845/hh-cycle07/H2/R1005/portable-probe.mjs']};
  result.allAssertionsPassed=problems.length===0&&extra.length===0&&missing.length===0&&Object.values(sourceHashes).every(x=>x.manifestMatched)&&Object.values(receiptInputs).every(x=>x.match)&&logFacts.preflight2&&logFacts.targeted121&&logFacts.full276&&logFacts.atlas1&&logFacts.pxcube14&&logFacts.site843&&provenance.clarificationNarrativeSha===provenance.narrativeSha&&provenance.clarificationNativeSha===provenance.nativeSha&&hash(e1005Bytes)==='fb238b10bcc27bdb664b1c065df02237fe6565c7655bef1c556cc246f9aa907a'&&result.canonicalBuild.receiptShaExpected===result.canonicalBuild.receiptShaActual&&result.canonicalBuild.sourceInputsMatchBinding&&result.canonicalBuild.sourceDigestMatchesBinding&&portable.allAssertionsPassed;
  result.packageIntegrityPassed=result.allAssertionsPassed;
  result.administrativeIssues=[{location:'H1 E1005 result.json provenance_notes[0]',issue:'narrative SHA is 63 hex chars and omits trailing 1',actualSha:provenance.narrativeSha,clarifiedSha:provenance.clarificationNarrativeSha,scope:'outside frozen 68-entry package',requiredAction:'separate administrative erratum; preserve frozen E1005 and package bytes'}];
  result.decision='amend';
  await writeFile(join(out,'result.json'),`${JSON.stringify(result,null,2)}\n`);
  return result;
}
try{const r=await main();console.log(JSON.stringify({job_id:r.job_id,worker:r.worker,decision:r.decision,summary:r.summary,allAssertionsPassed:r.allAssertionsPassed,manifest:r.manifest,source:r.source,canonicalBuild:{...r.canonicalBuild,bindingsInputs:`${r.canonicalBuild.bindingsInputs.length} records`},provenance:r.provenance,r1003:r.r1003},null,2));}catch(e){const r={schema:'hh-cycle07-H2-R1005/package-audit/v1',job_id:'R1005',worker:'H2',decision:'rejected',error:{name:e?.name||'Error',message:String(e?.message||e),stack:String(e?.stack||'')}};await writeFile(join(out,'result.json'),`${JSON.stringify(r,null,2)}\n`);console.log(JSON.stringify(r,null,2));process.exitCode=1;}
