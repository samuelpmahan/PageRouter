import { runMLExperiment } from '../src/ml/index.mjs';
import { componentDefinitions } from '../src/watches/components.mjs';
import { explainPrediction, perturbPrediction, explainWatch, buildExplanationContext, checkExplanationClaims } from '../src/explain/index.mjs';

const $=(root,selector)=>root.querySelector(selector);
const clone=value=>JSON.parse(JSON.stringify(value));
const pretty=value=>JSON.stringify(value,null,2);
const safe=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fmt=value=>finite(value)?Number(value.toPrecision(7)).toString():String(value);
const MAX_TEXT=80_000;
const MAX_BARS=40;
function scalar(value,algorithm){
  if(finite(value))return value;
  if(algorithm==='linearRegression')return value?.predictions?.[0];
  if(algorithm==='logisticRegression')return value?.scores?.[0];
  if(algorithm==='kMeans')return value?.squaredDistances?.[0];
  if(algorithm==='pca')return value?.projected?.[0]?.[0];
  return undefined;
}
function rational(value){return value&&Number.isSafeInteger(value.numerator)&&Number.isSafeInteger(value.denominator)?`${value.numerator}/${value.denominator}`:String(value??'—');}
function gearSummary(train){
  if(!train)return 'unavailable';
  const sets=train.gearPairs||{};
  const pairs=Object.entries(sets).flatMap(([path,items])=>(items||[]).map(pair=>`${path}: ${pair.driverTeeth}/${pair.drivenTeeth} teeth, ratio ${rational(pair.teethRatio)}, ${pair.direction}`));
  const angles=train.handAnglesDegrees||{};
  return `${pairs.length} teaching gear pairs (${pairs.join('; ')}); hand angles ${Object.entries(angles).map(([hand,value])=>`${hand} ${fmt(value)}°`).join(', ')}`;
}
function watchSummary(state){
  const energy=Object.entries(state.energy||{}).map(([name,value])=>`${name} ${value?'on':'off'}`).join(' · ');
  const counts=Object.entries(state.counters||{}).map(([name,value])=>`${name} ${value}`).join(' · ');
  return `${state.paused?'Paused':'Running'}${state.visibilityHidden?' · hidden':''} · time ${rational(state.time)} s · ${energy||'energy state unavailable'} · ${counts||'counters unavailable'}`;
}

function makeDemoExperiment(){
  const records=Array.from({length:24},(_,i)=>{const group=Math.floor(i/4),within=i%4,drift=-2+group*.42+within*.14,temp=18+(group%4)*.8+within*.25;return{runId:`demo-${group+1}`,conditionId:`demo-${group+1}`,features:[drift,temp],target:1.7*drift+.23*temp+1.4+((group+within)%3-.8)*.06};});
  return runMLExperiment({dataset:{schema:'ml-dataset.v1',sourceKind:'synthetic',featureNames:['early drift (ms)','temperature (°C)'],targetName:'later drift (ms)',records},algorithm:'linearRegression',featureNames:['early drift (ms)','temperature (°C)'],targetName:'later drift (ms)',groupBy:'conditionId',testFraction:.2,seed:7,standardize:true,modelConfig:{}});
}
function visibleJSON(value,cap=16_000){const text=pretty(value);return text.length>cap?`${text.slice(0,cap)}\n… bounded display at ${cap} characters`:text;}
function renderBars(container,values){
  if(!Array.isArray(values)||!values.length)return '<p class="explain-help">No additive contribution series is available for this model view.</p>';
  const rows=values.slice(0,MAX_BARS).map((item,index)=>{const label=item.featureName??item.name??item.label??`Term ${index+1}`,amount=item.contribution??item.logitContribution??item.value??item.squaredContribution??item.score;return finite(amount)?{label:String(label),amount}:null;}).filter(Boolean);
  if(!rows.length)return '<p class="explain-help">The model-specific attribution is included in the structured result below.</p>';
  const extent=Math.max(1e-12,...rows.map(row=>Math.abs(row.amount)));
  return `<div class="explain-bars" role="img" aria-label="Signed model contributions from the returned explanation">${rows.map(row=>`<div class="explain-bar-row"><span>${safe(row.label)}</span><div class="explain-bar-track"><div class="explain-bar-fill ${row.amount<0?'negative':''}" style="width:${Math.max(1,100*Math.abs(row.amount)/extent)}%"></div></div><strong>${fmt(row.amount)}</strong></div>`).join('')}</div><p class="explain-help">Bar length shows magnitude; teal means positive and rust means negative.</p>`;
}
function terms(){return '<div class="explain-definitions"><div><strong>Attribution</strong> means the part of a model’s calculation assigned to an input feature; it does not prove physical cause.</div><div><strong>Logit</strong> is a classifier score before the sigmoid maps it to a probability. Contributions sum to the score, not to the probability.</div><div><strong>Counterfactual</strong> here means a changed input evaluated with the same fitted model and saved scaler.</div><div><strong>Squared distance</strong> adds squared coordinate differences; Euclidean distance is its square root.</div><div><strong>PCA loading</strong> is a feature’s weight in a fitted direction; the weighted terms reconstruct that component score.</div></div>';}
function renderWatchMath(question){
  if(!question)return '';
  const q=question;
  if(q.id==='energy-path'&&q.currentPath){
    const m=q.currentPath.mechanical,x=q.currentPath.quartz,c=q.counterexample;
    const stageCount=x.dividerStages.length,lastStage=x.dividerStages.at(-1);
    return `<h4>Current path arithmetic · modeled values</h4><p><strong>Mechanical:</strong> energy ${safe(m.energyAvailable)} → timing ${safe(m.timingAvailable)} → ${safe(m.beats)} beats → ${safe(gearSummary(m.gearTrain))}.</p><p><strong>Quartz:</strong> energy ${safe(x.energyAvailable)} → timing ${safe(x.timingAvailable)} → ${safe(x.referenceCycles)} reference cycles → ${safe(stageCount)} divide-by-two stages (last output ${safe(lastStage?.outputCount??'—')}) → ${safe(x.motorCommands)} motor commands → hand angles ${safe(Object.entries(x.handAnglesDegrees||{}).map(([hand,value])=>`${hand} ${fmt(value)}°`).join(', '))}.</p><p><strong>Power-off counterexample:</strong> mechanical beats ${safe(c.beforeCounts.mechanicalBeats)} → ${safe(c.afterCounts.mechanicalBeats)} after the mainspring path is disabled for one modeled second.</p>`;
  }
  if(q.id==='timing-path')return `<h4>Current timing and counterexample</h4><p>Mechanical oscillator cycles ${safe(visibleJSON(q.mechanical?.oscillatorCycles,250))}; quartz reference cycles ${safe(q.quartz?.referenceCycles)}; software updates ${safe(visibleJSON(q.software?.updates,250))}.</p><p>With the mechanical rate changed to ${safe(visibleJSON(q.counterexample?.changedRate,200))}, beats over one modeled second change from ${safe(q.counterexample?.beforeMechanicalBeats)} to ${safe(q.counterexample?.afterMechanicalBeats)}.</p>`;
  if(q.id==='divider')return `<h4>Retained divider values</h4><p>${safe(q.referenceCycleCount)} reference cycles pass through ${safe(q.stageCount)} configured divide-by-two stages. First: ${safe(visibleJSON(q.firstStage,250))}; last: ${safe(visibleJSON(q.lastStage,250))}.</p>`;
  if(q.id==='current-vs-nominal-rate')return `<h4>Current versus nominal rates</h4><pre>${safe(visibleJSON({mechanical:q.mechanical,quartz:q.quartz,software:q.software},1200))}</pre>`;
  if(q.id==='gear-ratio')return `<h4>Teaching gear values</h4><pre>${safe(visibleJSON(q.trains,1600))}</pre>`;
  if(q.id==='tick-boundary')return `<h4>Selected retained event</h4><p>${q.event?safe(`${q.event.event} · ${visibleJSON(q.event,500)}`):'No matching explicit step was retained; no event is inferred.'}</p>`;
  if(q.id==='view-invariance')return `<h4>Render-only check</h4><p>State unchanged: ${safe(q.stateUnchanged)} · geometry changed: ${safe(q.geometryChanged)} · counters before/after: ${safe(visibleJSON(q.countersBefore,300))} / ${safe(visibleJSON(q.countersAfter,300))}.</p>`;
  return '';
}
function renderWatchEvidence(evidence){
  const stateFacts=evidence.filter(item=>!item.id.startsWith('source:'));
  const sourceFacts=evidence.filter(item=>item.id.startsWith('source:'));
  const cards=stateFacts.map(item=>`<div class="explain-claim accepted"><strong>${safe(item.id)}</strong> · ${safe(item.kind)} · ${safe(item.unit)}<br>${safe(JSON.stringify(item.value))}</div>`).join('');
  const notes=sourceFacts.length?`<details><summary>Retrieved source notes (${sourceFacts.length})</summary>${sourceFacts.map(item=>`<div class="explain-claim"><strong>${safe(item.id)}</strong><br>${safe(JSON.stringify(item.value))}</div>`).join('')}</details>`:'';
  return `${cards||'<p class="explain-help">No state values support this question.</p>'}${notes}`;
}
function resultSummary(result,algorithm,experiment){
  const attribution=result.attribution??result;
  const contributions=attribution.contributions??attribution.features??attribution.terms;
  const targetLabel=experiment?.dataset?.targetName?safe(experiment.dataset.targetName):'target units';
  if(algorithm==='linearRegression'){
    const ref=attribution.reference??result.reference??{};
    return `<div class="explain-metrics"><div class="explain-metric"><small>Reference prediction · ${targetLabel}</small><strong>${fmt(ref.prediction)}</strong></div><div class="explain-metric"><small>Actual fitted prediction · ${targetLabel}</small><strong>${fmt(attribution.prediction)}</strong></div><div class="explain-metric"><small>Reconstruction error / tolerance</small><strong>${fmt(attribution.roundoff?.absoluteError??result.verification?.absoluteError)} / ${fmt(attribution.roundoff?.tolerance??result.verification?.tolerance)}</strong></div></div><h4>Feature contributions · ${targetLabel}</h4>${renderBars(null,contributions)}<p class="explain-help">Reference plus signed contributions reconstructs the model prediction within the displayed floating-point tolerance. Coefficients and contributions describe model arithmetic, not causes.</p>`;
  }
  if(algorithm==='logisticRegression'){
    const score=attribution.logit??attribution.score??attribution.logitScore??attribution.prediction?.logit??result.prediction?.logit??result.logit;
    const probability=attribution.probability??attribution.prediction?.probability??result.prediction?.probability??result.probability;
    return `<div class="explain-metrics"><div class="explain-metric"><small>Logit · score before sigmoid</small><strong>${fmt(score)}</strong></div><div class="explain-metric"><small>Probability · sigmoid applied once</small><strong>${fmt(probability)}</strong></div><div class="explain-metric"><small>Decision threshold</small><strong>${fmt(attribution.threshold??attribution.prediction?.threshold??result.prediction?.threshold??result.threshold)}</strong></div><div class="explain-metric"><small>Predicted class</small><strong>${safe(attribution.label??attribution.prediction?.label??result.prediction?.label??result.label??'—')}</strong></div></div><h4>Signed logit contributions</h4>${renderBars(null,contributions)}<p class="explain-help">The signed terms reconstruct the logit, the score before the sigmoid. Probability is computed from that score once; probabilities are not additive contributions.</p>`;
  }
  if(algorithm==='kMeans'){
    const winner=attribution.prediction??result.prediction??{};
    const center=attribution.centers?.find(item=>item.selected)??{};
    const terms=center.selectedCoordinates??[];
    return `<div class="explain-metrics"><div class="explain-metric"><small>Chosen cluster ID</small><strong>${safe(winner.clusterIndex??'—')}</strong></div><div class="explain-metric"><small>Squared distance · model feature units²</small><strong>${fmt(winner.squaredDistance??center.squaredDistance)}</strong></div><div class="explain-metric"><small>Euclidean distance · model feature units</small><strong>${fmt(winner.distance??center.distance)}</strong></div><div class="explain-metric"><small>Nearest alternative cluster</small><strong>${safe(winner.nearestAlternativeIndex??'—')}</strong></div></div><h4>Chosen-centroid squared terms</h4>${renderBars(null,terms.map(item=>({...item,value:item.squaredContribution})))}<p class="explain-help">Coordinate squared terms sum to squared distance; the shown Euclidean distance is its square root. Cluster IDs are arbitrary labels.</p>`;
  }
  if(algorithm==='pca'){
    const components=attribution.components??result.components??[];const component=components[0]||{};
    return `<div class="explain-metrics"><div class="explain-metric"><small>Component 1 score</small><strong>${fmt(component.score)}</strong></div><div class="explain-metric"><small>Eigenvalue · model feature units²</small><strong>${fmt(component.eigenvalue)}</strong></div><div class="explain-metric"><small>Explained variance share</small><strong>${fmt(component.explainedVarianceRatio)}</strong></div></div><h4>Loading-weighted terms for component 1</h4>${renderBars(null,component.contributions)}<p class="explain-help">The returned loading-weighted terms reconstruct the fitted score. No extra component or causal interpretation is inferred.</p>`;
  }
  return `<p class="explain-help">The source module did not provide a known plotting shape; inspect its bounded structured result.</p>`;
}
function renderWatchAnswer(result){
  const sources=result.sources||[];const evidence=result.evidence||[];
  return `<div class="explain-metrics"><div class="explain-metric"><small>Selected component</small><strong>${safe(result.component?.name??result.component?.id??'—')}</strong></div><div class="explain-metric"><small>Question</small><strong>${safe(result.question?.title??result.question?.id??'—')}</strong></div><div class="explain-metric"><small>State identity</small><strong>${safe(result.stateIdentity??'—')}</strong></div></div><h4>Explanation and limits</h4><p>${safe(result.question?.explanation??result.limitation??'No narrative answer is supported for this question.')}</p>${renderWatchMath(result.question)}${result.limitation?`<p><strong>Limit:</strong> ${safe(result.limitation)}</p>`:''}<h4>Evidence-backed details</h4>${renderWatchEvidence(evidence)}<details><summary>Source records</summary><div class="explain-source-list">${sources.map(source=>`<p><a href="${safe(source.url)}" target="_blank" rel="noreferrer">${safe(source.title||source.id)}</a><br><span>${safe(source.supports||'')}</span><br><em>Limit: ${safe(source.limits||'Not stated')}</em></p>`).join('')||'<p>No source records were attached.</p>'}</div></details><details><summary>Selected model variables, question calculations, trace, and grounded context</summary><pre>${safe(visibleJSON({component:result.component,question:result.question,calculationTrace:result.calculationTrace,context:result.context}))}</pre></details>`;
}
function makeMarkup(){return `<section class="explain-workbench" aria-label="Explain model and watch calculations">
  <header class="explain-hero"><div><p class="ml-kicker">TRACE THE RESULT</p><h2>Explain a prediction or mechanism</h2><p>Inspect returned numerical evidence from the current fitted model and synchronized watch state. Deterministic templates only; there is no live language-model provider.</p></div><div id="explain-source-badge" class="explain-source-badge">Loading current model and watch state…</div></header>
  <div id="explain-status" class="explain-status" role="status"></div>
  <section class="explain-grid">
    <section class="explain-card"><h3>Fitted model</h3><p>Use the current ML artifact when present. A clearly labelled synthetic demo fit is created only when no current fit is available.</p><div class="explain-controls"><label>Model source<select id="explain-model-select"><option value="current">Current fitted ML model</option><option value="demo">Synthetic demonstration fit</option></select></label><button type="button" id="explain-refresh-button">Refresh current state</button></div><label>Raw feature vector <span id="explain-feature-order"></span><textarea id="explain-input-json" spellcheck="false" aria-label="Raw model feature vector"></textarea></label><div class="explain-controls"><label>Reference baseline<select id="explain-reference-select"><option value="trainingMean">Training mean (default)</option><option value="zero">All-zero raw vector</option><option value="custom">Custom raw vector</option></select></label></div><label id="explain-custom-reference-label" hidden>Custom reference vector<textarea id="explain-reference-json" spellcheck="false" aria-label="Custom reference vector"></textarea></label><button id="explain-predict-button" class="explain-primary" type="button">Explain prediction</button><h4>Controlled input change</h4><p>A counterfactual changes raw input values and reevaluates the same saved model and scaler. It does not refit.</p><div class="explain-controls"><label>Feature<select id="explain-change-feature"></select></label><label>Change by this raw-unit amount<input id="explain-change-delta" type="number" step="any" value="1"></label><button id="explain-perturb-button" type="button">Calculate changed prediction</button></div><div id="explain-perturb-output" class="explain-output"></div>
    </section>
    <section class="explain-card"><h3>Numerical attribution</h3><p>Attribution is the part of a model calculation assigned to an input. It explains the fitted model’s arithmetic, not a real-world cause.</p><div id="explain-output" class="explain-output"><p class="explain-help">Fit or select a model, then explain one input vector.</p></div><details><summary>Complete returned explanation</summary><pre id="explain-raw-result">No explanation yet.</pre></details><h4>Terms</h4>${terms()}</section>
    <section class="explain-card"><h3>Ask about the current watch state</h3><p>Answers bind to the current run state and curated mechanism sources. Model state, illustrative geometry, and physical facts are kept separate.</p><div class="explain-watch-layout"><div><div class="explain-controls"><label>Component<select id="explain-watch-part"></select></label><label>Question<select id="explain-watch-question"><option value="selected-component">What does this part read?</option><option value="energy-path">What supplies the modeled energy path?</option><option value="timing-path">What sets this model’s timing?</option><option value="current-vs-nominal-rate">How does current rate compare to nominal?</option><option value="divider">How does the quartz divider work here?</option><option value="gear-ratio">How do the teaching gear ratios affect the hands?</option><option value="tick-boundary">What does one selected tick count mean?</option><option value="view-invariance">Does explosion or selection change time?</option><option value="physical-accuracy">What does this establish about physical accuracy?</option><option value="unsupported-question">Ask an unsupported question (expected limitation)</option></select></label><button id="explain-watch-button" type="button">Explain selected watch question</button></div><div id="explain-watch-output" class="explain-output"><p class="explain-help">Choose a component and question to inspect the actual retained watch state.</p></div></div><aside><h4>Current watch state</h4><pre id="explain-watch-state">No watch state is available.</pre><details><summary>Full bounded state snapshot</summary><pre id="explain-watch-state-detail">No watch state is available.</pre></details></aside></div>
    </section>
    <section class="explain-card"><h3>Check a structured explanation draft</h3><p>Only accepted claim statements are rendered from matching evidence. Arbitrary prose stays an unverified draft.</p><div class="explain-controls"><button id="explain-prepare-draft" type="button">Prepare a claim from current evidence</button><button id="explain-stale-fixture" type="button">Challenge with stale identity</button></div><label>Structured draft JSON<textarea id="explain-draft" spellcheck="false" aria-label="Structured claim draft"></textarea></label><button id="explain-check-button" type="button">Check claims against evidence</button><div id="explain-claim-results" class="explain-output"></div><details><summary>Current evidence context and sources</summary><div id="explain-evidence-sources" class="explain-source-list"><p>No evidence context yet.</p></div></details></section>
  </section></section>`;}

export function registerExplainWorkbench(api){
  const state={container:null,experiment:null,mode:'current',autoFallback:false,input:null,explanation:null,perturbation:null,watchExplanation:null,context:null,watchContext:null,contextSelector:null,lastCheck:null,watchState:null};
  const panelDispose=api.registerPanel({id:'explain',title:'Explain',render(container){render(container);}});
  window.explainLab={
    getState:()=>({experiment:state.experiment?clone(state.experiment):null,watchState:state.watchState?clone(state.watchState):null,context:state.context?clone(state.context):null,watchContext:state.watchContext?clone(state.watchContext):null,explanation:state.explanation?clone(state.explanation):null,perturbation:state.perturbation?clone(state.perturbation):null,watchExplanation:state.watchExplanation?clone(state.watchExplanation):null,lastCheck:state.lastCheck?clone(state.lastCheck):null}),
    getContext:()=>state.context?clone(state.context):state.watchContext?clone(state.watchContext):null,
    getExperiment:()=>state.experiment?clone(state.experiment):null,
    getWatchState:()=>state.watchState?clone(state.watchState):null,
    explainPrediction:(features,baseline='trainingMean')=>runPrediction(features,baseline),
    perturb:(features,changes)=>runPerturbation(features,changes),
    explainWatch:(componentId,questionId)=>runWatch(componentId,questionId),
    checkDraft:draft=>checkDraft(draft),
    prepareDraft:()=>prepareDraft(),
    refresh:()=>refresh(),
    panelDispose
  };
  document.addEventListener('mllab:fit',()=>{if(state.mode==='current'||state.autoFallback){state.mode='current';state.autoFallback=false;if(state.container)$(state.container,'#explain-model-select').value='current';refresh();}});
  return window.explainLab;

  function currentExperiment(){
    const actual=window.mlLab?.getExperiment?.();
    if(state.mode==='current'&&actual)return actual;
    return makeDemoExperiment();
  }
  function render(container){
    state.container=container;
    if(container.querySelector('.explain-workbench'))return;
    container.innerHTML=makeMarkup();
    const root=container;
    const definitions=componentDefinitions();
    $(root,'#explain-watch-part').innerHTML=definitions.map(item=>`<option value="${safe(item.id)}">${safe(item.name??item.id)}</option>`).join('');
    const current=window.mlLab?.getExperiment?.();const select=$(root,'#explain-model-select');select.value=current?'current':'demo';state.mode=select.value;state.autoFallback=!current;
    $(root,'#explain-refresh-button').addEventListener('click',refresh);
    select.addEventListener('change',()=>{state.mode=select.value;state.autoFallback=false;clearOutputs();refresh();});
    $(root,'#explain-reference-select').addEventListener('change',()=>$(root,'#explain-custom-reference-label').hidden=$(root,'#explain-reference-select').value!=='custom');
    $(root,'#explain-predict-button').addEventListener('click',()=>{try{const features=JSON.parse($(root,'#explain-input-json').value);runPrediction(features,$(root,'#explain-reference-select').value==='custom'?JSON.parse($(root,'#explain-reference-json').value):$(root,'#explain-reference-select').value);}catch(error){status(error.message,'error');}});
    $(root,'#explain-perturb-button').addEventListener('click',()=>{try{const name=$(root,'#explain-change-feature').value,delta=Number($(root,'#explain-change-delta').value);if(!Number.isFinite(delta))throw new TypeError('Change must be a finite number.');const features=JSON.parse($(root,'#explain-input-json').value);runPerturbation(features,{[name]:delta});}catch(error){status(error.message,'error');}});
    $(root,'#explain-watch-button').addEventListener('click',()=>{try{runWatch($(root,'#explain-watch-part').value,$(root,'#explain-watch-question').value);}catch(error){status(error.message,'error');}});
    $(root,'#explain-prepare-draft').addEventListener('click',prepareDraft);
    $(root,'#explain-stale-fixture').addEventListener('click',()=>{const context=state.context??state.watchContext;if(!context){status('Explain a model or watch question first to create an evidence context.','error');return;}const draft=makeDraft(context);draft.stateIdentity='stale-state-fixture';$(root,'#explain-draft').value=pretty(draft);});
    $(root,'#explain-check-button').addEventListener('click',()=>{try{checkDraft(JSON.parse($(root,'#explain-draft').value));}catch(error){status(error.message,'error');}});
    refresh();
  }
  function status(message,kind=''){const element=state.container?.querySelector('#explain-status');if(element){element.textContent=message;element.className=`explain-status ${kind}`;}}
  function clearOutputs(){for(const id of ['#explain-output','#explain-perturb-output','#explain-watch-output','#explain-claim-results'])$(state.container,id).innerHTML='<p class="explain-help">Recompute against the selected current artifact/state.</p>';$(state.container,'#explain-raw-result').textContent='No explanation yet.';state.explanation=state.perturbation=state.watchExplanation=state.context=state.watchContext=state.contextSelector=state.lastCheck=null;}
  function refresh(){
    if(!state.container)return null;
    state.experiment=currentExperiment();
    const names=state.experiment.selectedFeatures.sourceFeatureNames;
    const row=state.experiment.dataset.records?.[0]?.features??Array(names.length).fill(0);
    state.input=row.slice();$(state.container,'#explain-input-json').value=pretty(state.input);$(state.container,'#explain-feature-order').textContent=`(${names.join(', ')})`;
    $(state.container,'#explain-reference-json').value=pretty(Array(names.length).fill(0));
    const featureOptions=state.experiment.selectedFeatures.names;
    $(state.container,'#explain-change-feature').innerHTML=featureOptions.map(name=>`<option value="${safe(name)}">${safe(name)}</option>`).join('');
    const actual=window.mlLab?.getExperiment?.();
    $(state.container,'#explain-source-badge').innerHTML=`<strong>${actual&&state.mode==='current'?'Current fitted model':'Synthetic demo fit'}</strong><span>${safe(state.experiment.config.algorithm)} · ${safe(state.experiment.sourceIdentity?.kind??state.experiment.dataset.sourceKind)} · no physical-causation claim</span>`;
    state.watchState=window.watchLab?.getState?.()??null;$(state.container,'#explain-watch-state').textContent=state.watchState?watchSummary(state.watchState):'No current watch state is available.';$(state.container,'#explain-watch-state-detail').textContent=state.watchState?visibleJSON(state.watchState,8000):'No current watch state is available.';
    clearOutputs();status(actual&&state.mode==='current'?'Using the current fitted ML artifact.':'No current fit selected; using an actual synthetic demonstration fit.');
    return {experiment:clone(state.experiment),watchState:state.watchState?clone(state.watchState):null};
  }
  function runPrediction(features,baseline='trainingMean'){
    state.experiment=currentExperiment();const result=explainPrediction({experiment:state.experiment,features,baseline});
    state.input=features.slice();state.explanation=result;state.contextSelector={experiment:state.experiment,features,baseline};state.context=buildExplanationContext(state.contextSelector);state.watchContext=null;
    $(state.container,'#explain-output').innerHTML=resultSummary(result,state.experiment.config.algorithm,state.experiment);
    $(state.container,'#explain-raw-result').textContent=visibleJSON(result);
    $(state.container,'#explain-claim-results').innerHTML='<p class="explain-help">Prepare a constrained claim from this explanation’s evidence before checking it.</p>';
    renderContextSources(state.context);status(`Model explanation returned for ${state.experiment.config.algorithm}; saved model and preprocessing were not changed.`,'success');return clone(result);
  }
  function runPerturbation(features,changes){
    state.experiment=currentExperiment();const result=perturbPrediction({experiment:state.experiment,features,changes});state.perturbation=result;
    $(state.container,'#explain-perturb-output').innerHTML=`<div class="explain-metrics"><div class="explain-metric"><small>Original prediction</small><strong>${fmt(scalar(result.originalPrediction,state.experiment.config.algorithm))}</strong></div><div class="explain-metric"><small>Changed prediction</small><strong>${fmt(scalar(result.changedPrediction,state.experiment.config.algorithm))}</strong></div><div class="explain-metric"><small>Prediction change</small><strong>${fmt(result.predictionDelta)}</strong></div></div><h4>Raw input changes</h4><pre>${safe(visibleJSON(result.changes??result))}</pre><p class="explain-help">Same model identity: ${safe(JSON.stringify(result.modelIdentity))}. Model unchanged: ${safe(result.modelUnchanged)}. Preprocessing refit: ${safe(result.preprocessingRefit)}.</p>`;
    status('Changed raw input evaluated with the same fitted model and saved preprocessing.','success');return clone(result);
  }
  function runWatch(componentId,questionId){
    state.watchState=window.watchLab?.getState?.()??state.watchState;if(!state.watchState)throw new Error('No watch state is available; open Watches and initialize its model first.');
    $(state.container,'#explain-watch-state').textContent=watchSummary(state.watchState);$(state.container,'#explain-watch-state-detail').textContent=visibleJSON(state.watchState,8000);
    const result=explainWatch({state:state.watchState,componentId,questionId});state.watchExplanation=result;const unsupported=result.supported===false||result.outcome==='unsupported';state.contextSelector=unsupported?null:{state:state.watchState,componentId,questionId};state.watchContext=unsupported?null:buildExplanationContext(state.contextSelector);state.context=null;
    $(state.container,'#explain-watch-output').innerHTML=renderWatchAnswer(result);renderContextSources(state.watchContext);
    status(unsupported?'Unsupported question: the returned answer is limited to available evidence.':'Watch explanation is bound to the current saved watch state and curated source records.',unsupported?'error':'success');return clone(result);
  }
  function renderContextSources(context){
    if(!context){$(state.container,'#explain-evidence-sources').innerHTML='<p>No evidence context has been generated yet.</p>';return;}
    $(state.container,'#explain-evidence-sources').innerHTML=`<p>Context <code>${safe(context.contextId)}</code> · state <code>${safe(context.stateIdentity)}</code> · model <code>${safe(context.modelIdentity)}</code> · declared source kind <strong>${safe(context.sourceKind)}</strong></p><h4>Evidence entries</h4>${(context.evidence||[]).map(item=>`<div class="explain-claim"><strong>Evidence ID: ${safe(item.id)}</strong> · ${safe(item.kind)} · ${safe(item.unit)}<br>Permitted scope: ${safe(item.permittedScopes?.join(', '))}<br>Value: ${safe(JSON.stringify(item.value))}<br>Citation IDs: ${safe(item.citationIds?.join(', ')||'none')}</div>`).join('')}<h4>Sources</h4>${(context.sources||[]).map(source=>`<p><strong>Source ID: ${safe(source.id)}</strong> · ${source.url?`<a href="${safe(source.url)}" target="_blank" rel="noreferrer">${safe(source.title||source.id)}</a>`:safe(source.title||source.id)}<br><span>Scope: ${safe(source.scope??source.supports??'not specified')}</span>${source.limits?`<br><em>Limit: ${safe(source.limits)}</em>`:''}</p>`).join('')}`;
  }
  function makeDraft(context){
    const evidence=context?.evidence?.[0];if(!evidence)throw new Error('No evidence entries are available to ground a claim.');
    return{contextId:context.contextId,stateIdentity:context.stateIdentity,modelIdentity:context.modelIdentity,claims:[{evidenceId:evidence.id,value:evidence.value,unit:evidence.unit,kind:evidence.kind,scope:evidence.permittedScopes[0],citationIds:evidence.citationIds}]};
  }
  function prepareDraft(){const context=state.context??state.watchContext;if(!context){status('Explain a model input or watch question first so the draft uses its real evidence context.','error');return null;}const draft=makeDraft(context);$(state.container,'#explain-draft').value=pretty(draft);status('Prepared a structured claim copied from selected evidence; it remains unverified until checked.');return clone(draft);}
  function checkDraft(draft){let current=state.contextSelector;if(!current)throw new Error('No current model or watch evidence context exists.');if(current.experiment){const live=state.mode==='current'?window.mlLab?.getExperiment?.():state.experiment;if(!live)throw new Error('The current fitted model is no longer available. Fit it again before checking this draft.');current={...current,experiment:live,features:JSON.parse($(state.container,'#explain-input-json').value),baseline:$(state.container,'#explain-reference-select').value==='custom'?JSON.parse($(state.container,'#explain-reference-json').value):$(state.container,'#explain-reference-select').value};state.experiment=current.experiment;}else{const liveState=window.watchLab?.getState?.();if(liveState)current={...current,state:liveState};state.watchState=current.state;}const context=buildExplanationContext(current);state.context=current.experiment?context:null;state.watchContext=current.state?context:null;renderContextSources(context);const result=checkExplanationClaims({context,draft,current});state.lastCheck=result;
    if(result.accepted){$(state.container,'#explain-claim-results').innerHTML=`<div class="explain-claim accepted"><strong>Claims match retrieved evidence</strong><p>${safe(result.renderedText)}</p><small>These sentences were rendered from matching evidence IDs, values, units, scopes, and citations. This does not verify the source's universal truth or caller-declared provenance.</small></div>`;status('Structured claims match the active retrieved evidence; broader truth and provenance are not established.','success');}
    else{$(state.container,'#explain-claim-results').innerHTML=`<div class="explain-claim rejected"><strong>Rejected or limited claims</strong>${(result.errors||[]).map(error=>`<p><code>${safe(error.code)}</code> · ${safe(error.message)}</p>`).join('')||'<p>No claim was accepted.</p>'}</div>${result.claims?.length?`<details><summary>Accepted items only</summary><pre>${safe(visibleJSON(result.claims))}</pre></details>`:''}`;status('The draft did not pass evidence, identity, unit, scope, or source checks. Raw draft text remains unverified.','error');}
    return clone(result);
  }
}
