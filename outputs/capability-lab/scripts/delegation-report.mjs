#!/usr/bin/env node
// Summarize delegation logs without inferring model quality from a small sample.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const labRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const [key,...parts]=arg.replace(/^--/,'').split('=');
  return [key,parts.join('=')||true];
}));
const docsDir=resolve(args.dir||join(labRoot,'docs'));
const outputPath=args.out ? resolve(String(args.out)) : null;

const aliases={
  timestamp:['timestamp','timeStamp','createdAt','created_at','date'],
  phase:['phase','status','stage'],
  task:['task','title','assignment'],
  owner:['owner','assignee','worker'],
  complexity:['predictedComplexity','predicted_complexity','complexity'],
  modelReason:['reasonForModelChoice','reason_for_model_choice','modelReason','model_reason'],
  expectedEvidence:['expectedEvidence','expected_evidence'],
  observedOutcome:['observedOutcome','observed_outcome','observedResult','observed_result','outcome','result'],
  adjustment:['nextDelegationAdjustment','next_delegation_adjustment','nextAdjustment','next_adjustment'],
  rework:['rework','reworkNotes','rework_notes'],
  timing:['reworkOrBlockedTime','rework_or_blocked_time','blockedTime','blocked_time','timeSpent','time_spent','elapsedTime','elapsed_time','duration'],
  userCanDo:['whatUserCanDo','what_user_can_do'],
  changedExpectations:['whatChangedTheModel','what_changed_the_model'],
  wrongAssumptions:['wrongAssumptions','wrong_assumptions'],
  uncheckedClaims:['uncheckedClaims','unchecked_claims'],
  decisions:['decisions','decision'],
};
const explicitNoTime=/\bnot\s+measured\b|\bno\s+(?:measured\s+)?(?:time|duration|measurement)\b|\bunknown\b|\bnot\s+recorded\b/i;
function firstValue(record,keys){for(const key of keys){if(Object.hasOwn(record,key)&&record[key]!==null&&record[key]!==undefined&&String(record[key]).trim()!=='')return record[key];}return null;}
function text(value){if(value===null||value===undefined)return null;if(typeof value==='string')return value.trim()||null;if(typeof value==='number'||typeof value==='boolean')return String(value);return JSON.stringify(value);}
function normalized(record,key){return text(firstValue(record,aliases[key]||[key]));}
function splitLines(source,file){
  const records=[],errors=[];
  source.split(/\r?\n/).forEach((line,index)=>{
    if(!line.trim())return;
    try {const parsed=JSON.parse(line);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('entry must be a JSON object');records.push({record:parsed,line:index+1});}
    catch(error){errors.push({line:index+1,message:error.message});}
  });
  return {records,errors};
}
function isObserved(record){
  const phase=(normalized(record,'phase')||'').toLowerCase();
  return ['observed','complete','completed','result','outcome'].includes(phase)||Boolean(normalized(record,'observedOutcome'));
}
function timingState(record){
  const value=normalized(record,'timing');
  if(!value)return {status:'not-recorded',value:null};
  if(explicitNoTime.test(value))return {status:'explicitly-unmeasured',value};
  return {status:'recorded-as-text',value};
}
function summarizeEntry(record,line,file){
  const observed=isObserved(record), timing=timingState(record);
  return {
    source:file,
    line,
    phase:normalized(record,'phase')||(observed?'observed':'planned-or-unspecified'),
    timestamp:normalized(record,'timestamp'),
    task:normalized(record,'task'),
    owner:normalized(record,'owner'),
    predictedComplexity:normalized(record,'complexity'),
    modelChoiceReason:normalized(record,'modelReason'),
    expectedEvidence:normalized(record,'expectedEvidence'),
    observed,
    observedOutcome:normalized(record,'observedOutcome'),
    rework:normalized(record,'rework'),
    timing,
    nextDelegationAdjustment:normalized(record,'adjustment'),
    whatUserCanDo:normalized(record,'userCanDo'),
    whatChangedExpectations:normalized(record,'changedExpectations'),
    wrongAssumptions:normalized(record,'wrongAssumptions'),
    decisions:normalized(record,'decisions'),
    uncheckedClaims:normalized(record,'uncheckedClaims'),
  };
}

const logFiles=(await readdir(docsDir,{withFileTypes:true}))
  .filter(entry=>entry.isFile()&&/^team-.+-delegation\.jsonl$/.test(entry.name))
  .map(entry=>entry.name).sort();
const teams=[];
const allEntries=[];
const parseErrors=[];
for(const file of logFiles){
  const source=await readFile(join(docsDir,file),'utf8');
  const parsed=splitLines(source,file);
  parseErrors.push(...parsed.errors.map(error=>({source:file,...error})));
  const entries=parsed.records.map(({record,line})=>summarizeEntry(record,line,file));
  allEntries.push(...entries);
  const observed=entries.filter(entry=>entry.observed);
  teams.push({
    team:file.replace(/^team-/,'').replace(/-delegation\.jsonl$/,''),
    source:file,
    entryCount:entries.length,
    plannedOrUnclassifiedCount:entries.filter(entry=>!entry.observed).length,
    observedCount:observed.length,
    observedOutcomeMissingCount:observed.filter(entry=>!entry.observedOutcome).length,
    adjustmentRecordedCount:observed.filter(entry=>entry.nextDelegationAdjustment).length,
    timingRecordedAsTextCount:observed.filter(entry=>entry.timing.status==='recorded-as-text').length,
    timingExplicitlyUnmeasuredCount:observed.filter(entry=>entry.timing.status==='explicitly-unmeasured').length,
    timingNotRecordedCount:observed.filter(entry=>entry.timing.status==='not-recorded').length,
  });
}
const observedEntries=allEntries.filter(entry=>entry.observed);
const report={
  title:'Delegation log report',
  scope:{directory:docsDir,files:logFiles.length,entries:allEntries.length},
  interpretation:'This report summarizes fields recorded in the logs. It does not rank models or infer model superiority, training, or causal effects from these few tasks.',
  coverage:{
    teams:teams.length,
    plannedOrUnclassifiedEntries:allEntries.filter(entry=>!entry.observed).length,
    observedEntries:observedEntries.length,
    observedEntriesMissingOutcome:observedEntries.filter(entry=>!entry.observedOutcome).length,
    observedEntriesWithNextAdjustment:observedEntries.filter(entry=>entry.nextDelegationAdjustment).length,
    timingRecordedAsText:observedEntries.filter(entry=>entry.timing.status==='recorded-as-text').length,
    timingExplicitlyUnmeasured:observedEntries.filter(entry=>entry.timing.status==='explicitly-unmeasured').length,
    timingNotRecorded:observedEntries.filter(entry=>entry.timing.status==='not-recorded').length,
    parseErrors:parseErrors.length,
  },
  teams,
  observedAdjustments:observedEntries.filter(entry=>entry.nextDelegationAdjustment).map(entry=>({
    team:entry.source.replace(/^team-/,'').replace(/-delegation\.jsonl$/,''),
    task:entry.task,
    owner:entry.owner,
    observedOutcome:entry.observedOutcome,
    adjustment:entry.nextDelegationAdjustment,
  })),
  missingMeasurements:observedEntries.filter(entry=>entry.timing.status!=='recorded-as-text').map(entry=>({
    team:entry.source.replace(/^team-/,'').replace(/-delegation\.jsonl$/,''),
    task:entry.task,
    timingStatus:entry.timing.status,
    recordedValue:entry.timing.value,
  })),
  observedEntries,
  parseErrors,
};
const json=JSON.stringify(report,null,2)+'\n';
if(outputPath){
  await mkdir(dirname(outputPath),{recursive:true});
  await writeFile(outputPath,json,'utf8');
  process.stdout.write(`${outputPath}\n`);
} else process.stdout.write(json);
if(parseErrors.length)process.exitCode=1;
