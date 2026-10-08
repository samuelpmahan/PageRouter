#!/usr/bin/env node
// Browser acceptance: edit training data, fit, predict, evaluate, and compare raw receipts.
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWatchCalibrationDataset } from '../src/ml/watch-data.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...rest]=arg.replace(/^--/,'').split('=');return[key,rest.join('=')||true];}));
const url=args.url||'http://127.0.0.1:4173';
const out=resolve(args.out||'/mnt/d/somefile/capability-lab/ml-browser-evidence');
const evidenceDir=resolve(args.evidence||resolve(dirname(fileURLToPath(import.meta.url)),'../evidence/ml-workbench/ui'));
await mkdir(out,{recursive:true});await mkdir(evidenceDir,{recursive:true});
const playwrightModule=process.env.CAPABILITY_LAB_PLAYWRIGHT_MODULE||'/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/browser/node_modules/playwright/index.mjs';
const browsersPath=process.env.CAPABILITY_LAB_BROWSERS_PATH||'/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/browser/browsers';
const browserDeps=process.env.CAPABILITY_LAB_LD_LIBRARY_DIR||'/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/browser/deps/usr/lib/x86_64-linux-gnu';
const chromiumExecutable=process.env.CAPABILITY_LAB_CHROMIUM_EXECUTABLE;
for(const [label,path,variable] of [['Playwright module',playwrightModule,'CAPABILITY_LAB_PLAYWRIGHT_MODULE'],['Playwright browser cache',browsersPath,'CAPABILITY_LAB_BROWSERS_PATH'],['browser shared-library directory',browserDeps,'CAPABILITY_LAB_LD_LIBRARY_DIR'],...(chromiumExecutable?[['Chromium executable',chromiumExecutable,'CAPABILITY_LAB_CHROMIUM_EXECUTABLE']]:[])])try{await access(path);}catch{throw new Error(`Browser verification prerequisite missing: ${label} at ${path}. Set ${variable} to an existing path; do not install dependencies.`);}
process.env.PLAYWRIGHT_BROWSERS_PATH=browsersPath;process.env.LD_LIBRARY_PATH=[browserDeps,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const {chromium}=await import(playwrightModule);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`:JSON.stringify(value);
let browser,page;const errors=[];
try{
  browser=await chromium.launch({headless:true,...(chromiumExecutable?{executablePath:chromiumExecutable}:{})});
  page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>{window.canonicalForBrowser=value=>Array.isArray(value)?`[${value.map(window.canonicalForBrowser).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${window.canonicalForBrowser(value[k])}`).join(',')}}`:JSON.stringify(value);});
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.mlLab?.fit&&window.mlLab?.getExperiment&&document.querySelector('#ml-training-input'),{timeout:25000});
  await page.locator('[data-workspace-mode="ml"]').click();
  await page.waitForFunction(()=>document.querySelector('.workspace')?.classList.contains('ml-active'));
  async function waitForFit(algorithm){const deadline=Date.now()+15000;while(Date.now()<deadline){const status=await page.locator('#ml-status').innerText().catch(()=> '');const outcome=await page.evaluate(()=>window.mlLab?.getExperiment?.());if(outcome?.config?.algorithm===algorithm)return outcome;const error=await page.locator('#ml-status').evaluate(el=>el.classList.contains('error')).catch(()=>false);if(error)throw new Error(`Fit stopped with visible UI error: ${status}`);await page.waitForTimeout(80);}const status=await page.locator('#ml-status').innerText().catch(()=> 'no status');throw new Error(`Fit did not finish within 15 seconds; last visible status: ${status}`); }
  assert.equal(await page.locator('#ml-algorithm').inputValue(),'linearRegression','Default task is regression');
  const input=page.locator('#ml-training-input');
  const firstDataset=JSON.parse(await input.inputValue());
  assert.ok(firstDataset.records.length>=16,'Training example has enough grouped records');
  assert.equal(firstDataset.sourceKind,'synthetic','Teaching records disclose synthetic provenance');
  await page.locator('#ml-fit-button').click();
  const first=await waitForFit('linearRegression');
  assert.ok(first.split.train.length>0&&first.split.test.length>0,'Experiment retains train and whole-group holdout rows');
  const trainGroups=new Set(first.split.groups.train),testGroups=new Set(first.split.groups.test);
  assert.ok([...trainGroups].every(group=>!testGroups.has(group)),'No group crosses the train/holdout split');
  assert.ok(first.preprocessing,'Train-only preprocessing parameters are retained');
  assert.equal(first.training.calculationTrace?.id,'ml.fitLinearRegression','Actual lower-level fit trace is retained');
  assert.ok(first.training.calculationTrace.calls.some(call=>call.id==='linalg.leastSquares'),'Regression trace exposes its real QR least-squares call');
  assert.ok(await page.locator('#ml-plot-wrap .ml-plot circle').count()>0,'Regression plot renders actual held-out points');
  assert.ok(first.baseline,'An explicit baseline is retained for comparison');
  assert.ok(first.holdout.metrics,'Holdout metrics are available');
  const firstModel=canonical(first.model),firstPred=canonical(first.holdout.prediction);
  await page.screenshot({path:resolve(out,'ml-regression-fitted.png'),fullPage:true});
  const changed=JSON.parse(await input.inputValue());
  changed.records=changed.records.map(row=>({...row,target:row.target+7}));
  await input.fill(JSON.stringify(changed,null,2));
  await page.locator('#ml-fit-button').click();
  const second=await waitForFit('linearRegression');
  assert.notEqual(canonical(second.model),firstModel,'Editing training targets changes learned model parameters');
  assert.notEqual(canonical(second.holdout.prediction),firstPred,'Changed training labels change raw held-out predictions');
  const predInput=page.locator('#ml-prediction-input');
  await predInput.fill(JSON.stringify(second.holdout.records,null,2));
  await page.locator('#ml-predict-button').click();
  await page.waitForFunction(()=>document.querySelector('#ml-prediction-result pre')?.textContent.length>2);
  const predictions=await page.evaluate(()=>window.mlLab.predict(JSON.parse(document.querySelector('#ml-prediction-input').value)));
  assert.ok(predictions.predictions.length===second.holdout.records.length,'Predict runs for supplied raw holdout records');
  await page.locator('#ml-evaluate-button').click();
  const evaluation=await page.evaluate(()=>window.mlLab.evaluate(JSON.parse(document.querySelector('#ml-prediction-input').value)));
  assert.ok(evaluation.metrics,'Evaluate reports actual metrics for supplied records');
  const replay=await page.evaluate(()=>window.mlLab.replay());
  await page.screenshot({path:resolve(out,'ml-regression-evaluated.png'),fullPage:true});
  assert.equal(replay.matches,true,'Replay matches the retained training/evaluation result');
  assert.equal(typeof replay.canonicalState,'string','Replay exposes canonical state for review');assert.equal(typeof replay.canonicalFresh,'string','Replay exposes canonical refit for comparison');
  const exportDownload=page.waitForEvent('download');await page.locator('#ml-export-button').click();const download=await exportDownload;await download.saveAs(resolve(out,'ml-experiment-export.json'));
  const taskEvidence={};
  for(const [algorithm,name] of [['logisticRegression','logistic'],['kMeans','clusters'],['pca','pca']]){
    await page.locator('#ml-algorithm').selectOption(algorithm);await page.locator('#ml-load-example').click();await page.locator('#ml-fit-button').click();
    const run=await waitForFit(algorithm);
    assert.ok(run.model,'Each model task retains learned parameters');assert.ok(run.holdout.prediction,'Each model task predicts holdout rows');
    assert.ok(await page.locator('#ml-plot-wrap .ml-plot').count(),'Each task has an actual result visualization');
    if(algorithm==='logisticRegression')assert.equal(run.holdout.prediction.probabilities.length,run.holdout.records.length,'Classifier exposes holdout probabilities');
    if(algorithm==='kMeans'){
      assert.equal(run.holdout.prediction.assignments.length,run.holdout.records.length,'Clustering exposes holdout assignments');
      const trainingClusters=new Set(run.model.assignments);assert.ok(trainingClusters.size>1,'Training chart includes multiple actual fitted cluster IDs');
      assert.equal(await page.locator('#ml-plot-wrap .centroid-marker').count(),run.model.centroids.length,'Each fitted centroid is drawn as a cross');
      assert.ok(await page.locator('#ml-plot-wrap .ml-legend').innerText().then(text=>text.includes('Cluster 0')),'Cluster legend uses fitted cluster IDs');
      assert.equal(await page.locator('#ml-plot-wrap circle[data-kind="training"]').count(),run.split.train.length,'Training markers are explicitly identified');
      assert.equal(await page.locator('#ml-plot-wrap circle[data-kind="holdout"]').count(),run.split.test.length,'Holdout markers are explicitly identified');
      const trainingFill=await page.locator('#ml-plot-wrap circle[data-kind="training"]').first().evaluate(el=>getComputedStyle(el).fill),holdoutFill=await page.locator('#ml-plot-wrap circle[data-kind="holdout"]').first().evaluate(el=>getComputedStyle(el).fill);
      assert.equal(trainingFill,'rgb(255, 255, 255)','Training markers are visibly hollow');assert.notEqual(holdoutFill,'rgb(255, 255, 255)','Holdout markers are visibly filled with their cluster color');
      assert.match(await page.locator('#ml-model-summary').innerText(),/Centroids \(training-standardized coordinates\)/,'Displayed centroid parameters disclose their standardized coordinate system');
    }
    if(algorithm==='pca'){
      assert.equal(run.holdout.prediction.projected.length,run.holdout.records.length,'PCA projects holdout records with the fitted directions');
      assert.equal(await page.locator('#ml-plot-wrap .variance-bar').count(),Math.min(20,run.model.explainedVarianceRatio.length),'PCA chart draws fitted explained-variance values');
      assert.match(await page.locator('#ml-model-summary').innerText(),/Component directions/,'Fitted PCA directions are summarized beside the score view');
    }
    await page.screenshot({path:resolve(out,`ml-${name}-fitted.png`),fullPage:true});
    taskEvidence[algorithm]={sourceKind:run.dataset.sourceKind,modelKind:run.model.kind,parameters:{intercept:run.model.intercept,coefficients:run.model.coefficients,threshold:run.model.threshold,centroids:run.model.centroids,eigenvalues:run.model.eigenvalues,explainedVarianceRatio:run.model.explainedVarianceRatio,iterations:run.model.iterations,converged:run.model.converged},holdoutMetrics:run.holdout.metrics,predictionCount:run.holdout.records.length};
    if(algorithm==='kMeans'){
      await page.locator('#ml-predict-button').click();
      await page.waitForFunction(()=>document.querySelector('#ml-plot-wrap .ml-legend')?.textContent.includes('New input'));
      assert.equal(await page.locator('#ml-plot-wrap circle[data-kind="new"]').count(),run.holdout.records.length,'New predictions receive a distinct marker kind');
    }
  }
  const oneFeature=JSON.parse(await page.locator('#ml-training-input').inputValue());oneFeature.featureNames=oneFeature.featureNames.slice(0,1);oneFeature.records=oneFeature.records.map(row=>({...row,features:row.features.slice(0,1)}));
  await page.locator('#ml-algorithm').selectOption('pca');await page.locator('#ml-training-input').fill(JSON.stringify(oneFeature));await page.locator('#ml-fit-button').click();const oneComponent=await waitForFit('pca');
  assert.ok(oneComponent.model.directions.length===1,'One-feature PCA keeps its actual single fitted component');assert.ok(await page.locator('#ml-plot-wrap .ml-plot circle').count()>0,'One-component PCA renders scores without inventing a second component');
  const oneDimLabels=await page.locator('#ml-plot-wrap .ml-plot').first().evaluate(el=>el.textContent);assert.match(oneDimLabels,/Component 1 score/);assert.match(oneDimLabels,/Display order/,'A one-dimensional score plot labels display order rather than inventing a second model component');
  taskEvidence.pcaOneFeature={componentCount:oneComponent.model.directions.length,scoreCount:oneComponent.holdout.prediction.projected.length,plotPoints:await page.locator('#ml-plot-wrap .ml-plot circle').count()};
  await page.locator('#ml-algorithm').selectOption('kMeans');await page.locator('#ml-model-config').fill(JSON.stringify({k:3,maxIterations:20}));await page.locator('#ml-fit-button').click();const oneFeatureClusters=await waitForFit('kMeans');
  assert.ok(await page.locator('#ml-plot-wrap .ml-plot circle').count()>0,'One-feature clustering renders with a display-order axis');assert.match(await page.locator('#ml-plot-wrap .ml-plot').first().evaluate(el=>el.textContent),/Display row order/);assert.equal(await page.locator('#ml-plot-wrap .centroid-marker').count(),oneFeatureClusters.model.centroids.length,'One-feature centroids remain visible');
  taskEvidence.kMeansOneFeature={featureCount:oneFeatureClusters.model.featureCount,centroidCount:oneFeatureClusters.model.centroids.length,plotPoints:await page.locator('#ml-plot-wrap .ml-plot circle').count()};
  await page.locator('#ml-load-watch-data').click();await page.locator('#ml-fit-button').click();
  const watchFit=await waitForFit('linearRegression');assert.equal(watchFit.dataset.sourceKind,'synthetic-watch');
  assert.ok(watchFit.holdout.baselines.analytical,'Watch calibration reports the analytical rate baseline');
  const observationFormula='earlyMechanicalCycles/(2*earlyOperatingTime)';
  for(const record of watchFit.dataset.records){
    const observation=record.observations,cycles=observation?.earlyMechanicalCycles,time=observation?.earlyOperatingTime;
    assert.equal(observation?.readoutKind,'synthetic-teaching-phase-observation','Watch rate readout is explicitly identified as a synthetic teaching phase observation');
    assert.equal(observation?.formula,observationFormula,'Watch readout retains its exact derivation formula');
    assert.ok(Number.isSafeInteger(cycles?.numerator)&&Number.isSafeInteger(cycles?.denominator)&&cycles.denominator>0,'Retained early mechanical cycles are rational');
    assert.ok(Number.isSafeInteger(time?.numerator)&&Number.isSafeInteger(time?.denominator)&&time.denominator>0,'Retained early powered time is rational');
    assert.equal(record.features[0],cycles.numerator/cycles.denominator/(2*time.numerator/time.denominator),'Observed rate reconstructs exactly from retained cycle and powered-time rationals');
  }
  const watchReplay=await page.evaluate(()=>window.mlLab.replay());assert.equal(watchReplay.matches,true,'The fitted synthetic watch lesson replays from its retained experiment');
  const fractionalWatch=buildWatchCalibrationDataset({seed:1,conditions:[
    {conditionId:'phase-3.75',mechanicalHz:{numerator:15,denominator:4}},
    {conditionId:'phase-3.8',mechanicalHz:{numerator:19,denominator:5}},
    {conditionId:'phase-4.0',mechanicalHz:{numerator:4,denominator:1}},
    {conditionId:'phase-4.1',mechanicalHz:{numerator:41,denominator:10}},
  ]});
  const fractionalRecord=fractionalWatch.records[0];assert.deepEqual(fractionalRecord.observations.earlyMechanicalCycles,{numerator:75,denominator:2},'A 3.75 Hz five-second observation retains its 75/2 phase count');assert.equal(fractionalRecord.features[0],3.75,'Fractional phase count reconstructs the intended observed rate');
  const watchResidualPixels=await page.locator('#ml-plot-wrap .residual').first().evaluate(el=>Math.abs(Number(el.getAttribute('y1'))-Number(el.getAttribute('y2'))));
  assert.ok(watchResidualPixels<3,'Tiny floating-point residuals are not magnified into a large visual error');
  assert.deepEqual(watchFit.selectedFeatures.names,['earlyObservedMechanicalHz'],'Watch model uses the one declared observable feature');
  await page.screenshot({path:resolve(out,'ml-watch-calibration.png'),fullPage:true});
  const leaked=JSON.parse(await page.locator('#ml-training-input').inputValue());leaked.featureNames=['hiddenConfiguredFaultRate'];
  await page.locator('#ml-training-input').fill(JSON.stringify(leaked,null,2));await page.locator('#ml-fit-button').click();
  assert.match(await page.locator('#ml-status').innerText(),/hidden fault|configured fault/i,'Known hidden fault feature is rejected with an actionable UI error');
  assert.equal(await page.evaluate(()=>window.mlLab.getExperiment()),null,'Rejected known leakage does not retain a stale prior experiment');
  const report={url,task:'linearRegression',provenance:first.sourceIdentity.kind,records:firstDataset.records.length,groups:{train:first.split.groups.train,holdout:first.split.groups.test,disjoint:true},learnedModelChanged:canonical(second.model)!==firstModel,holdoutPredictionsChanged:canonical(second.holdout.prediction)!==firstPred,predictionCount:predictions.predictions.length,evaluationMetrics:evaluation.metrics,replay:{matches:replay.matches,mismatches:replay.mismatches,canonicalStateBytes:replay.canonicalState.length,canonicalFreshBytes:replay.canonicalFresh.length},baseline:Object.fromEntries(Object.entries(first.holdout.baselines).map(([key,value])=>[key,value.metrics])),calculationTrace:{fitId:first.training.calculationTrace.id,firstNestedCall:first.training.calculationTrace.calls[0]?.id},additionalTasks:taskEvidence,watchCalibration:{sourceKind:watchFit.dataset.sourceKind,features:watchFit.selectedFeatures.names,retainedObservationCount:watchFit.dataset.records.length,formula:observationFormula,allRatesReconstructed:true,replayMatches:watchReplay.matches,fractionalPhase:{rate:3.75,cycles:fractionalRecord.observations.earlyMechanicalCycles,poweredTime:fractionalRecord.observations.earlyOperatingTime,formula:fractionalRecord.observations.formula},residualPixels:watchResidualPixels,analyticalBaseline:watchFit.holdout.baselines.analytical},knownLeakageRejected:true,consoleErrors:errors,screenshots:['ml-regression-fitted.png','ml-regression-evaluated.png','ml-logistic-fitted.png','ml-clusters-fitted.png','ml-pca-fitted.png','ml-watch-calibration.png'].map(file=>resolve(out,file))};
  assert.deepEqual(errors,[],'No browser page or console errors');
  await writeFile(resolve(out,'ml-browser-report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(out,'ml-raw-evidence.json'),JSON.stringify({initial:first,changed:second,predictions,evaluation,replay,additionalTasks:taskEvidence,watchFit,knownLeakageRejected:true},null,2)+'\n');
  for(const name of ['ml-regression-fitted.png','ml-regression-evaluated.png','ml-logistic-fitted.png','ml-clusters-fitted.png','ml-pca-fitted.png','ml-watch-calibration.png','ml-browser-report.json','ml-raw-evidence.json','ml-experiment-export.json'])await copyFile(resolve(out,name),resolve(evidenceDir,name));
  console.log(JSON.stringify(report,null,2));
}catch(error){const report={url,error:error?.stack||String(error),consoleErrors:errors};try{if(page&&page.url()!=='about:blank')await page.screenshot({path:resolve(out,'ml-browser-failed.png'),fullPage:true});}catch{}await writeFile(resolve(out,'ml-browser-failure.json'),JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify(report,null,2));throw error;}finally{await browser?.close();}
