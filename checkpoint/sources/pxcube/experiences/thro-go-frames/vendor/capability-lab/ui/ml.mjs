import { runMLExperiment, predictMLModel, evaluateMLExperiment, replayMLExperiment } from '../src/ml/index.mjs';

const $ = (root, selector) => root.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const pretty = value => JSON.stringify(value, null, 2);
const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fmt = value => finite(value) ? Number(value.toPrecision(6)).toString() : String(value);
const limitText = (value, cap = 24000) => { const text = pretty(value); return text.length > cap ? `${text.slice(0, cap)}\n… display capped at ${cap} characters` : text; };
const MAX_RECORDS = 5000;
const MAX_TEXT = 250_000;
const MAX_PLOT = 180;
function report(container,message,kind='') {const status=container&&$(container,'#ml-status');if(status){status.textContent=message;status.className=`ml-status ${kind}`;}}
function clearExperimentView(container) {
  if(!container?.querySelector('#ml-summary'))return;
  container.querySelectorAll('.ml-warning').forEach(node=>node.remove());
  for(const id of ['#ml-predict-button','#ml-evaluate-button','#ml-replay-button','#ml-export-button'])$(container,id).disabled=true;
  $(container,'#ml-summary').innerHTML='<div class="ml-help">Fit the updated data and settings to show results.</div>';
  $(container,'#ml-model').textContent='No fitted model.';$(container,'#ml-model-summary').innerHTML='<p class="ml-help">Model parameters appear after fitting.</p>';$(container,'#ml-trace').textContent='No experiment yet.';
  $(container,'#ml-plot-wrap').innerHTML='<div class="ml-help">Charts appear after fitting.</div>';
  $(container,'#ml-evaluation').innerHTML='<div class="ml-help">No current evaluation. Fit the updated experiment first.</div>';
  $(container,'#ml-prediction-result').textContent='';$(container,'#ml-provenance-detail').textContent='No current fitted run.';
}

// Small synthetic lesson fixtures: records are grouped so the split can hold out whole groups.
const datasets = {
  linear: {
    schema: 'ml-dataset.v1', sourceKind: 'synthetic', featureNames: ['early drift (ms)', 'temperature (°C)'], targetName: 'later drift (ms)',
    records: Array.from({length: 32}, (_, i) => {
      const run = Math.floor(i / 4), condition = i % 4;
      const early = -5 + run * 1.1 + condition * .45;
      const temperature = 18 + (run % 5) * 1.3 + condition * .2;
      return {runId:`run-${String(run+1).padStart(2,'0')}`,conditionId:`run-${String(run+1).padStart(2,'0')}`,features:[early,temperature],target:1.8*early + .12*temperature + 2 + ((run+condition)%3-.9)*.16};
    })
  },
  logistic: {
    schema: 'ml-dataset.v1', sourceKind: 'synthetic', featureNames: ['signal A', 'signal B'], targetName: 'class',
    records: Array.from({length: 40}, (_, i) => {
      const run=Math.floor(i/4),condition=i%4,x=(run%5)-2+(condition-1.5)*.2,y=Math.floor(run/5)-1.5+(condition-1.5)*.25;
      return {runId:`run-${String(run+1).padStart(2,'0')}`,conditionId:`run-${String(run+1).padStart(2,'0')}`,features:[x,y],target:(x+.7*y>0)?1:0};
    })
  },
  clusters: {
    schema:'ml-dataset.v1',sourceKind:'synthetic',featureNames:['measurement A','measurement B'],
    records:Array.from({length:36},(_,i)=>{const group=Math.floor(i/12),local=i%12,run=Math.floor(i/3);const centers=[[-3,-2],[3,2],[-3,3]];const c=centers[group];return {runId:`run-${String(run+1).padStart(2,'0')}`,conditionId:`run-${String(run+1).padStart(2,'0')}`,features:[c[0]+((local*7)%9-4)*.15,c[1]+((local*5)%9-4)*.14]};})
  },
  pca: {
    schema:'ml-dataset.v1',sourceKind:'synthetic',featureNames:['measurement A','measurement B','measurement C'],
    records:Array.from({length:32},(_,i)=>{const run=Math.floor(i/4),condition=i%4,t=run*.32+condition*.08;return {runId:`run-${String(run+1).padStart(2,'0')}`,conditionId:`run-${String(run+1).padStart(2,'0')}`,features:[t+Math.sin(i)*.12,2*t+Math.cos(i*.7)*.2,-t+Math.sin(i*.3)*.09]};})
  }
};
const explanations = {
  linearRegression: {title:'Linear regression',text:'Fitting means choosing coefficients that make training predictions close to known targets. A residual is actual − predicted. The holdout contains entire groups the fit did not see.'},
  logisticRegression: {title:'Logistic regression',text:'The model first computes a logit (a weighted score), then the sigmoid maps that score to a probability between 0 and 1. A decision threshold turns the probability into a class.'},
  kMeans: {title:'K-means clustering',text:'K-means groups nearby feature vectors around learned centroids. There is no target label: cluster numbers are identifiers, not meaningful class names.'},
  pca: {title:'Principal component analysis',text:'PCA finds perpendicular directions that capture the greatest variation in training data. A score is an observation’s coordinate along one of those learned directions.'}
};

function renderModelSummary(experiment) {
  const model=experiment.model||{}, prep=experiment.preprocessing;
  const rows=[];
  const add=(name,value)=>{if(value!==undefined&&value!==null)rows.push(`<div class="ml-metric"><span>${safe(name)}</span><strong>${safe(Array.isArray(value)?value.map(item=>finite(item)?fmt(item):JSON.stringify(item)).join(', '):typeof value==='object'?JSON.stringify(value):fmt(value))}</strong></div>`);};
  add('Model',model.kind);if(model.intercept!==undefined)add('Intercept',model.intercept);if(model.coefficients)add(prep?'Coefficients (training-standardized inputs)':'Coefficients',model.coefficients);if(model.threshold!==undefined)add('Decision threshold',model.threshold);if(model.optimizer){add('Optimizer converged',model.optimizer.converged);add('Optimizer iterations',model.optimizer.iterations);add('Final loss',model.optimizer.finalLoss);}if(model.inertia!==undefined)add('Within-cluster squared distance',model.inertia);if(model.iterations!==undefined)add('Iterations',model.iterations);if(model.converged!==undefined)add('Converged',model.converged);if(model.eigenvalues)add('Eigenvalues',model.eigenvalues);if(model.explainedVarianceRatio)add('Explained variance ratio',model.explainedVarianceRatio);if(model.directions)add('Component directions (feature weights)',model.directions.slice(0,3).map(row=>row.slice(0,8).map(fmt)));if(model.centroids)add(prep?'Centroids (training-standardized coordinates)':'Centroids',model.centroids.map(row=>row.map(fmt).join(', ')));if(prep){add('Training means',prep.means);add('Training scales',prep.scales);add('Constant columns',prep.constantColumns?.map(Boolean));}
  return rows.length?`<div class="ml-columns">${rows.join('')}</div>`:'<p class="ml-help">No scalar model summary is available; inspect the complete JSON.</p>';
}
function renderPredictionRows(algorithm, records, prediction) {
  const count=Math.min(records.length,100);let head, cells;
  if(algorithm==='linearRegression'){head=['run','condition','actual','predicted','residual'];cells=i=>[records[i].runId,records[i].conditionId,records[i].target, prediction.predictions?.[i], finite(records[i].target)&&finite(prediction.predictions?.[i])?records[i].target-prediction.predictions[i]:null];}
  else if(algorithm==='logisticRegression'){head=['run','condition','actual class','P(class 1)','predicted class'];cells=i=>[records[i].runId,records[i].conditionId,records[i].target,prediction.probabilities?.[i],prediction.labels?.[i]];}
  else if(algorithm==='kMeans'){head=['run','condition','cluster','distance','squared distance'];cells=i=>[records[i].runId,records[i].conditionId,prediction.assignments?.[i],prediction.distances?.[i],prediction.squaredDistances?.[i]];}
  else {head=['run','condition','projected scores'];cells=i=>[records[i].runId,records[i].conditionId,prediction.projected?.[i]];}
  const value=v=>v===null||v===undefined?'—':typeof v==='number'?fmt(v):Array.isArray(v)?v.map(fmt).join(', '):String(v);
  return `<div class="ml-table-wrap"><table class="ml-prediction-table"><thead><tr>${head.map(x=>`<th scope="col">${safe(x)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:count},(_,i)=>`<tr>${cells(i).map(v=>`<td>${safe(value(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${records.length>count?`<p class="ml-help">Showing first ${count} of ${records.length} rows; raw prediction JSON remains available below.</p>`:''}`;
}
function renderMetricsOrNote(metrics, algorithm) { return metrics ? renderMetricObject(metrics) : `<p class="ml-help">${algorithm==='kMeans'?'No target labels: inspect cluster assignments, centroids, convergence, and within-cluster distance instead of supervised prediction metrics.':'No target labels: PCA is evaluated through its fitted directions and explained variance, not target prediction metrics.'}</p>`; }
function renderBaselines(baselines) { if(!baselines||typeof baselines!=='object')return '<p>No baseline supplied for this task.</p>'; return Object.entries(baselines).map(([name,item])=>`<h4>${safe(name)}</h4>${renderMetricObject(item?.metrics??item)}`).join('')||'<p>No baseline supplied for this task.</p>'; }
function renderMetricObject(obj) {
  if (!obj || typeof obj !== 'object') return `<pre>${safe(fmt(obj))}</pre>`;
  const rows=Object.entries(obj).filter(([,v])=>typeof v==='number'||typeof v==='string'||typeof v==='boolean');
  return rows.length?`<div class="ml-columns">${rows.map(([k,v])=>`<div class="ml-metric"><span>${safe(k)}</span><strong>${safe(fmt(v))}</strong></div>`).join('')}</div>`:`<pre>${safe(limitText(obj,8000))}</pre>`;
}
function plotFor(experiment, predictionResult=null, inputRows=null) {
  const algorithm=experiment.config.algorithm, rows=inputRows||experiment.holdout?.records||[], native=predictionResult||experiment.holdout?.prediction||{};
  const preds=algorithm==='linearRegression'?native.predictions:algorithm==='logisticRegression'?native.probabilities:algorithm==='kMeans'?native.assignments: native.projected;
  const pair=rows.map((row,i)=>({row,pred:Array.isArray(preds?.[i])?preds[i]:preds?.[i],index:i})).filter(item=>item.row&&Array.isArray(item.row.features));
  if(algorithm==='linearRegression'&&pair.some(x=>finite(x.row.target)&&finite(x.pred))){
    const points=pair.filter(x=>finite(x.row.target)&&finite(x.pred));const W=620,H=260,p=42;const actual=points.map(x=>x.row.target),predicted=points.map(x=>x.pred);const lo=Math.min(...actual,...predicted),hi=Math.max(...actual,...predicted),center=(lo+hi)/2,magnitude=Math.max(Math.abs(lo),Math.abs(hi),1),span=Math.max(hi-lo,magnitude*.2),axisMin=center-span/2,axisMax=center+span/2,scale=x=>p+(x-axisMin)/(axisMax-axisMin)*(W-2*p),sy=x=>H-p-(x-axisMin)/(axisMax-axisMin)*(H-2*p),targetName=experiment.dataset?.targetName||'target';
    return `<svg class="ml-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Held-out actual versus predicted values and residuals"><line class="axis" x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}"/><line class="axis" x1="${p}" y1="${p}" x2="${p}" y2="${H-p}"/><path class="fit-line" d="M${scale(axisMin)} ${sy(axisMin)} L${scale(axisMax)} ${sy(axisMax)}"/><text x="${W/2}" y="${H-7}" text-anchor="middle">Predicted ${safe(targetName)} · ${fmt(axisMin)} to ${fmt(axisMax)}</text><text x="8" y="14">Actual ${safe(targetName)} · ${fmt(axisMin)} to ${fmt(axisMax)}</text>${points.slice(0,MAX_PLOT).map(x=>`<line class="residual" x1="${scale(x.pred)}" y1="${sy(x.pred)}" x2="${scale(x.pred)}" y2="${sy(x.row.target)}"/><circle class="${x.row.runId?'holdout-point':'data-point'}" cx="${scale(x.pred)}" cy="${sy(x.row.target)}" r="4"><title>actual ${fmt(x.row.target)}, predicted ${fmt(x.pred)}, residual ${fmt(x.row.target-x.pred)}</title></circle>`).join('')}</svg><p class="ml-help">Orange segments show residuals (actual − predicted) for held-out records. Axes are padded when the observed range is extremely small, so floating-point roundoff is not magnified into a large apparent error. The diagonal is perfect prediction.</p>`;
  }
  if(algorithm==='logisticRegression'&&pair.length){
    const f=experiment.selectedFeatures?.indices?.[0]??0, vals=pair.map(x=>x.row.features[f]),lo=Math.min(...vals),hi=Math.max(...vals),W=620,H=250,p=34,threshold=finite(experiment.model?.threshold)?experiment.model.threshold:.5;const sx=x=>p+(x-lo)/(hi-lo||1)*(W-2*p),sy=y=>H-p-y*(H-2*p);
    return `<svg class="ml-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Held-out class probability by first feature"><line class="axis" x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}"/><line class="axis" x1="${p}" y1="${p}" x2="${p}" y2="${H-p}"/><line class="residual" x1="${p}" y1="${sy(threshold)}" x2="${W-p}" y2="${sy(threshold)}"/><text x="${W/2}" y="${H-7}" text-anchor="middle">${safe(experiment.selectedFeatures?.names?.[0]||'Feature')}</text><text x="8" y="14">P(class 1)</text>${pair.slice(0,MAX_PLOT).map(x=>{const probability=Array.isArray(native.probabilities?.[x.index])?native.probabilities[x.index][1]:native.probabilities?.[x.index];const y=finite(probability)?Math.max(0,Math.min(1,probability)):0.5;return `<circle class="${x.row.runId?'holdout-point':'data-point'}" cx="${sx(x.row.features[f])}" cy="${sy(y)}" r="5"><title>class ${safe(x.row.target)}, predicted probability ${fmt(y)}</title></circle>`}).join('')}</svg><p class="ml-help">Each point is a held-out row; the dashed line marks the fitted model's ${fmt(threshold)} decision threshold.</p>`;
  }
  if(algorithm==='kMeans'||algorithm==='pca'){
    let plotted;
    if(algorithm==='kMeans'){
      const trainRows=experiment.split?.train||[],trainAssignments=experiment.model?.assignments||[];
      plotted=trainRows.map((row,index)=>({point:row.features,cluster:trainAssignments[index],kind:'training'}));
      plotted.push(...rows.map((row,index)=>({point:row.features,cluster:native.assignments?.[index],kind:inputRows?'new':'holdout'})));
    } else {
      const trainRows=experiment.split?.train||[],trainScores=experiment.training?.prediction?.projected||[];
      plotted=trainRows.map((row,index)=>({point:trainScores[index],kind:'training'}));
      plotted.push(...rows.map((row,index)=>({point:native.projected?.[index],kind:inputRows?'new':'holdout'})));
    }
    const points=plotted.filter(item=>(Array.isArray(item.point)||finite(item.point))&&(Array.isArray(item.point)?item.point.length>0&&item.point.every(finite):finite(item.point))).map(item=>({ ...item, point:Array.isArray(item.point)?(item.point.length===1?[item.point[0],plotted.indexOf(item)]:item.point):[item.point,plotted.indexOf(item)] }));
    if(points.length){
      const W=620,H=260,p=34,xs=points.map(item=>item.point[0]),ys=points.map(item=>item.point[1]),pcaDimension=algorithm==='pca'?Math.max(...plotted.map(item=>Array.isArray(item.point)?item.point.length:1)):0,featureDimension=experiment.dataset?.featureNames?.length||2;let centroids=[];
      if(algorithm==='kMeans'){
        const means=experiment.preprocessing?.means||[],scales=experiment.preprocessing?.scales||[];
        centroids=(experiment.model?.centroids||[]).map((point,cluster)=>({cluster,point:point.map((value,index)=>finite(means[index])&&finite(scales[index])?value*scales[index]+means[index]:value)})).filter(item=>item.point.length>0&&item.point.every(finite));
        for(const item of centroids){xs.push(item.point[0]);ys.push(item.point[1]??0);}
      }
      const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),sx=x=>p+(x-xmin)/(xmax-xmin||1)*(W-2*p),sy=y=>H-p-(y-ymin)/(ymax-ymin||1)*(H-2*p);
      const scatter=`<svg class="ml-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${algorithm==='pca'?'Training and held-out scores on fitted principal component directions':'Training and held-out records colored by fitted cluster'}"><line class="axis" x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}"/><line class="axis" x1="${p}" y1="${p}" x2="${p}" y2="${H-p}"/><text x="${W/2}" y="${H-7}" text-anchor="middle">${algorithm==='pca'?`Component 1 score${pcaDimension===1?' (1D)':''}`:'Feature 1'}</text>${algorithm==='pca'&&pcaDimension===1?`<text transform="translate(12 ${H/2}) rotate(-90)" text-anchor="middle">Display order</text>`:`<text transform="translate(12 ${H/2}) rotate(-90)" text-anchor="middle">${algorithm==='pca'?'Component 2 score':featureDimension>1?'Feature 2':'Display row order'}</text>`}${points.slice(0,MAX_PLOT).map(item=>{const clusterClass=`cluster-${Math.max(0,Math.min(3,Number(item.cluster)||0))}`,kindClass=item.kind==='training'?'point-training':item.kind==='new'?'point-new':'point-holdout';return `<circle class="${algorithm==='kMeans'?`${clusterClass} ${kindClass}`:item.kind==='training'?'data-point':'holdout-point'}" ${algorithm==='kMeans'?`data-kind="${item.kind}" data-cluster="${safe(item.cluster)}"`:''} cx="${sx(item.point[0])}" cy="${sy(item.point[1])}" r="${item.kind==='training'?4.5:5}"><title>${safe(item.kind)}${algorithm==='kMeans'?', cluster '+safe(item.cluster):''}: ${safe(fmt(item.point[0]))}${algorithm==='pca'?' score':''}</title></circle>`}).join('')}${centroids.map(item=>`<g class="centroid-marker" data-centroid="${item.cluster}" transform="translate(${sx(item.point[0])} ${sy(item.point[1]??0)})"><path d="M-7 0 H7 M0 -7 V7"/><title>Fitted centroid for cluster ${item.cluster}: (${item.point.map(fmt).join(', ')}) in original feature units</title></g>`).join('')}</svg>`;
      if(algorithm==='pca'){
        const ratios=experiment.model?.explainedVarianceRatio||[],barW=560,barH=90,barPad=18,shown=ratios.slice(0,20),slot=(barW-2*barPad)/Math.max(1,shown.length),max=Math.max(...shown,1e-12);
        const bars=`<svg class="ml-variance-plot" viewBox="0 0 ${barW} ${barH}" role="img" aria-label="Fitted explained variance ratio by principal component">${shown.map((value,index)=>{const height=56*Math.max(0,value)/max,x=barPad+index*slot;return `<rect class="variance-bar" data-component="${index+1}" x="${x+slot*.18}" y="${66-height}" width="${Math.max(2,slot*.64)}" height="${height}" rx="2"><title>Component ${index+1}: ${(100*value).toPrecision(4)}% of explained variance</title></rect><text x="${x+slot/2}" y="82" text-anchor="middle">${index+1}</text>`}).join('')}</svg><p class="ml-help">Fitted variance share by component (first ${shown.length} of ${ratios.length}); component directions are feature-weight vectors shown in the parameter summary.</p>`;
        return `${scatter}${bars}<p class="ml-help">Training and held-out observations projected onto the fitted directions; blue is training and orange is holdout. ${pcaDimension===1?'The vertical axis is display order because only one component was fitted.':'The axes are the first two fitted component scores.'}</p>`;
      }
      const clusters=[...new Set(points.filter(item=>item.kind==='training').map(item=>Number(item.cluster)))].sort((a,b)=>a-b),hasNew=points.some(item=>item.kind==='new'),legend=`<div class="ml-legend" aria-label="Plot legend"><span><i class="legend-record legend-training"></i>Training · hollow</span><span><i class="legend-record legend-holdout"></i>Holdout · filled</span>${hasNew?'<span><i class="legend-record legend-new"></i>New input · outlined</span>':''}${clusters.map(cluster=>`<span><i class="legend-cluster cluster-${Math.max(0,Math.min(3,cluster))}"></i>Cluster ${cluster}</span>`).join('')}<span><i class="legend-centroid">×</i>Fitted centroid</span></div>`;
      return `${scatter}${legend}<p class="ml-help">Color identifies the fitted cluster ID; these are arbitrary group numbers, not true classes. Marker fill identifies training versus holdout${hasNew?' or new prediction input':''}; crosses are fitted centroids. Axes show original feature values; centroid coordinates are converted from retained training-standardized space.</p>`;
    }
  }
  return '<div class="ml-help">No compatible plot values are available for this result. The bounded raw model and predictions remain inspectable below.</div>';
}
function renderExperiment(container, state) {
  const exp=state.experiment;
  const title=state.algorithm in explanations?explanations[state.algorithm]:explanations[exp?.config?.algorithm]||explanations.linearRegression;
  const source=exp?.sourceIdentity?.kind||exp?.dataset?.sourceKind||'not yet fitted';
  const groups=exp?.split?.groups||{};
  const defaultStatus=exp?`Fit complete · ${exp.split?.train?.length??0} training rows and ${exp.split?.test?.length??0} held-out rows.`:'Edit the data, then fit.';
  const trainCount=exp?.split?.train?.length||0,holdCount=exp?.split?.test?.length||0;
  container.innerHTML=`<section class="ml-workbench">
    <header class="ml-intro"><div><p class="ml-kicker">Learn by running the model</p><h2>Fit, predict, evaluate</h2><p>Change the training records or settings, fit a real model, then inspect its learned parameters and predictions on groups held out from training.</p></div><aside class="ml-provenance"><strong>Data source: ${safe(source)}</strong><span>The source kind is declared by the dataset; it is not proof of real-world provenance. Synthetic fixtures are not physical measurements. Browser timing observations must be labeled separately.</span></aside></header>
    <div class="ml-toolbar"><label>Task<select id="ml-algorithm"><option value="linearRegression">Linear regression</option><option value="logisticRegression">Logistic regression</option><option value="kMeans">K-means clustering</option><option value="pca">Principal components (PCA)</option></select></label><label>Split whole groups by<select id="ml-group-by"><option value="runId">Run</option><option value="conditionId">Condition</option></select></label><label>Holdout fraction<input id="ml-test-fraction" type="number" min="0.1" max="0.5" step="0.05" value="0.2"></label><label>Seed<input id="ml-seed" type="number" step="1" value="0"></label><label class="ml-check"><input id="ml-standardize" type="checkbox" checked> Standardize using training rows only</label></div>
    <div class="ml-grid"><section class="ml-card"><h3>Training dataset</h3><p class="ml-help"><strong>Feature</strong> means an input number used to predict or organize a row. The selected target is the answer used during supervised fitting. The split keeps all records from a group together.</p><textarea id="ml-training-input" spellcheck="false" aria-label="Editable training dataset JSON"></textarea><div class="ml-config-row"><label>Model settings · JSON<textarea id="ml-model-config" aria-label="Model settings JSON" rows="2">{}</textarea></label><button id="ml-load-example" type="button">Load example for task</button><button id="ml-load-watch-data" type="button">Load watch-rate lesson</button><button id="ml-fit-button" type="button" class="ml-primary">Fit model</button><span id="ml-status" class="ml-status" role="status">${safe(defaultStatus)}</span></div></section>
      <section class="ml-card"><h3 id="ml-explanation-title">${safe(title.title)}</h3><p id="ml-explanation">${safe(title.text)}</p><div id="ml-summary"><div class="ml-help">Fit a model to show training/holdout groups, metrics, and the baseline comparison.</div></div></section></div>
    <section class="ml-grid"><section class="ml-card"><h3>New prediction inputs</h3><p class="ml-help">Prediction uses the training means and scales retained by the fitted model. It does not refit preprocessing. Outputs below stay aligned row by row with the inputs.</p><textarea id="ml-prediction-input" spellcheck="false" aria-label="Prediction records JSON"></textarea><div class="ml-action-row"><button id="ml-predict-button" type="button" disabled>Predict</button><button id="ml-evaluate-button" type="button" disabled>Evaluate these rows</button><button id="ml-replay-button" type="button" disabled>Replay fit</button><button id="ml-export-button" type="button" disabled>Export experiment JSON</button></div><div id="ml-prediction-result" class="ml-output"></div></section><section class="ml-card"><h3>Model view</h3><div id="ml-plot-wrap" class="ml-plot-wrap"><div class="ml-help">Charts appear after fitting.</div></div><h4>Learned parameters and retained preprocessing</h4><div id="ml-model-summary"><p class="ml-help">Model parameters appear after fitting.</p></div><details><summary>Complete model and preprocessing JSON</summary><pre id="ml-model">No model yet.</pre></details></section></section>
    <section class="ml-grid"><section class="ml-card"><h3>Evaluation</h3><div id="ml-evaluation"><div class="ml-help">Evaluation compares held-out predictions with a simpler baseline. Lower error is not guaranteed; the baseline can win.</div></div></section><section class="ml-card"><h3>Provenance and limits</h3><div id="ml-provenance-detail" class="ml-help">No fitted run yet.</div><details><summary>Bounded trace and complete retained experiment</summary><pre id="ml-trace">No experiment yet.</pre></details></section></section>
  </section>`;
  const algorithm=$(container,'#ml-algorithm'), editor=$(container,'#ml-training-input'), predEditor=$(container,'#ml-prediction-input');
  const savedConfig=state.config||{groupBy:'runId',testFraction:.2,seed:0,standardize:true,modelConfig:{}};
  algorithm.value=state.algorithm||'linearRegression';
  $(container,'#ml-group-by').value=savedConfig.groupBy;$(container,'#ml-test-fraction').value=String(savedConfig.testFraction);$(container,'#ml-seed').value=String(savedConfig.seed);$(container,'#ml-standardize').checked=savedConfig.standardize;$(container,'#ml-model-config').value=pretty(savedConfig.modelConfig);
  editor.value=pretty(exp?.dataset||datasets.linear);
  if(exp){predEditor.value=pretty(exp.holdout?.records||[]);$(container,'#ml-predict-button').disabled=false;$(container,'#ml-evaluate-button').disabled=false;$(container,'#ml-replay-button').disabled=false;$(container,'#ml-export-button').disabled=false;$(container,'#ml-model').textContent=limitText({model:exp.model,preprocessing:exp.preprocessing,baseline:exp.baseline});$(container,'#ml-model-summary').innerHTML=renderModelSummary(exp);const fitWarnings=[];if(exp.config.algorithm==='logisticRegression'&&exp.model.optimizer?.converged!==true)fitWarnings.push('Logistic optimizer did not report convergence; interpret probabilities cautiously.');if(exp.config.algorithm==='kMeans'&&exp.model.converged===false)fitWarnings.push('K-means did not converge within its iteration limit.');if(fitWarnings.length)$(container,'#ml-model').insertAdjacentHTML('beforebegin',`<p class="ml-warning">${safe(fitWarnings.join(' '))}</p>`);$(container,'#ml-trace').textContent=limitText({trainingCalculationTrace:exp.training?.calculationTrace,holdoutEvaluationTrace:exp.holdout?.trace,wrapperLedger:exp.trace,split:exp.split});$(container,'#ml-plot-wrap').innerHTML=plotFor(exp);$(container,'#ml-summary').innerHTML=`<div class="ml-columns">${[['Training rows',trainCount],['Holdout rows',holdCount],['Training groups',groups.train?.length??'—'],['Held-out groups',groups.test?.length??'—']].map(([k,v])=>`<div class="ml-metric"><span>${safe(k)}</span><strong>${safe(v)}</strong></div>`).join('')}</div><h4>Training metrics</h4>${renderMetricsOrNote(exp.training?.metrics,exp.config.algorithm)}<h4>Holdout metrics</h4>${renderMetricsOrNote(exp.holdout?.metrics,exp.config.algorithm)}`;$(container,'#ml-evaluation').innerHTML=`<h4>Model</h4>${renderMetricsOrNote(exp.holdout?.metrics,exp.config.algorithm)}<h4>Baselines</h4>${renderBaselines(exp.holdout?.baselines)}<p>Baselines are simpler comparisons fitted only from training data. Their results are reported as measured by this run; a baseline can win.</p>`;$(container,'#ml-provenance-detail').innerHTML=`Source kind: <strong>${safe(source)}</strong>. Training groups: ${safe(JSON.stringify(groups.train||[]))}. Held-out groups: ${safe(JSON.stringify(groups.test||[]))}. Selected observable features: ${safe(JSON.stringify(exp.selectedFeatures?.names||[]))}. These group IDs do not cross the split. The holdout is used for evaluation, not parameter fitting.`;}
  const loaded=()=>{const key=algorithm.value==='linearRegression'?'linear':algorithm.value==='logisticRegression'?'logistic':algorithm.value==='kMeans'?'clusters':'pca';editor.value=pretty(datasets[key]);state.algorithm=algorithm.value;$(container,'#ml-model-config').value=pretty(algorithm.value==='kMeans'?{k:3,maxIterations:20}:{});refreshTarget();};
  $(container,'#ml-load-watch-data').addEventListener('click',async()=>{try{const {buildWatchCalibrationDataset}=await import('../src/ml/watch-data.mjs');const data=buildWatchCalibrationDataset({seed:1});algorithm.value='linearRegression';selection();$(container,'#ml-model-config').value='{}';editor.value=pretty(data);refreshTarget();invalidate('Watch lesson loaded. Fit it to create a new experiment.');report(container,'Loaded actual watch-API calibration observations with configured synthetic faults. These are simulated watch outputs, not physical measurements.');}catch(error){report(container,`Watch calibration data unavailable: ${error?.message||String(error)}`,'error');}});
  function refreshTarget(){ /* Dataset feature and target names remain directly editable in the JSON above. */ }
  const selection=()=>{state.algorithm=algorithm.value;const t=explanations[state.algorithm];$(container,'#ml-explanation-title').textContent=t.title;$(container,'#ml-explanation').textContent=t.text;};
  algorithm.addEventListener('change',()=>{selection();invalidate('Task changed. Fit the model again to update results.');});$(container,'#ml-load-example').addEventListener('click',()=>{loaded();invalidate('Example loaded. Fit it to create a new experiment.');});
  editor.addEventListener('input',()=>{refreshTarget();invalidate('Training data changed. Previous results cleared; fit again.');});
  for(const selector of ['#ml-group-by','#ml-test-fraction','#ml-seed','#ml-standardize','#ml-model-config'])$(container,selector).addEventListener('change',()=>invalidate('Fit settings changed. Previous results cleared; fit again.'));
  function invalidate(message){if(!state.experiment)return;state.experiment=null;state.lastPrediction=state.lastEvaluation=null;clearExperimentView(container);report(container,message);}

  const fitButton=$(container,'#ml-fit-button');fitButton.addEventListener('click',()=>{try{state.fit(editor.value,algorithm.value,container);}catch{}});
  $(container,'#ml-predict-button').addEventListener('click',()=>{try{state.predict(predEditor.value,container);}catch{}});
  $(container,'#ml-evaluate-button').addEventListener('click',()=>{try{state.evaluate(predEditor.value,container);}catch{}});
  $(container,'#ml-replay-button').addEventListener('click',()=>{try{state.replay(container);}catch{}});
  $(container,'#ml-export-button').addEventListener('click',()=>state.export());
  refreshTarget();selection();
}

export function registerMLWorkbench(api) {
  const state={experiment:null,algorithm:'linearRegression',config:null,listeners:[],lastPrediction:null,lastEvaluation:null,fit, predict, evaluate, replay, export:exportRun};
  const dispose=api.registerPanel({id:'ml',title:'Machine learning',render(container){renderExperiment(container,state);}});
  window.mlLab={
    getExperiment:()=>state.experiment?clone(state.experiment):null,
    fit:(datasetText,algorithm=state.algorithm,root=document.querySelector('#extension-ml-view'))=>fit(datasetText,algorithm,root),
    predict:records=>{if(!state.experiment)throw new Error('Fit a model first');return predictMLModel({experiment:state.experiment,records});},
    evaluate:records=>{if(!state.experiment)throw new Error('Fit a model first');return evaluateMLExperiment({experiment:state.experiment,records});},
    replay:()=>{if(!state.experiment)throw new Error('Fit a model first');return replayMLExperiment({experiment:state.experiment});},
    export:()=>state.experiment?clone(state.experiment):null,
    dispose
  };
  return window.mlLab;

  function parseDataset(text) {
    if(typeof text!=='string'||text.length>MAX_TEXT)throw new RangeError(`Dataset JSON is limited to ${MAX_TEXT} characters.`);
    const dataset=JSON.parse(text);
    if(!dataset||typeof dataset!=='object'||!Array.isArray(dataset.records)||dataset.records.length>MAX_RECORDS)throw new TypeError(`Dataset must be an object with at most ${MAX_RECORDS} records.`);
    if(!Array.isArray(dataset.featureNames)||dataset.featureNames.length===0)throw new TypeError('Dataset must list at least one observable numeric feature.');
    const risky=/hidden|fault.?rate|target.?error|future|label.?leak|configured.?rate/i;
    const selected=dataset.featureNames;
    if(selected.some(name=>risky.test(String(name))))throw new TypeError('A selected feature name suggests hidden fault, target error, future information, or configured fault state. Choose only observable inputs.');
    for(const [i,row] of dataset.records.entries())if(!row||!Array.isArray(row.features)||row.features.length!==dataset.featureNames.length||!row.features.every(finite)||((dataset.targetName!=null)&&!finite(row.target)))throw new TypeError(`Record ${i} must have ${dataset.featureNames.length} finite feature values and a finite target when supervised.`);
    return dataset;
  }
  function readConfig(container) {
    const groupBy=$(container,'#ml-group-by').value;
    const testFraction=Number($(container,'#ml-test-fraction').value),seed=Number($(container,'#ml-seed').value);
    if(!Number.isFinite(testFraction)||testFraction<.1||testFraction>.5)throw new RangeError('Holdout fraction must be between 0.1 and 0.5.');
    if(!Number.isSafeInteger(seed))throw new RangeError('Seed must be a safe whole number.');
    return {groupBy,testFraction,seed,standardize:$(container,'#ml-standardize').checked};
  }
  function fit(text,algorithm,container){
    state.experiment=null;state.lastPrediction=state.lastEvaluation=null;clearExperimentView(container);report(container,'Fitting the selected model…');
    try{const dataset=parseDataset(text);const config=readConfig(container);let modelConfig;try{modelConfig=JSON.parse($(container,'#ml-model-config').value);}catch{throw new SyntaxError('Model settings must be valid JSON.');}if(!modelConfig||Array.isArray(modelConfig)||typeof modelConfig!=='object')throw new TypeError('Model settings must be a JSON object.');if(!['linearRegression','logisticRegression','kMeans','pca'].includes(algorithm))throw new TypeError('Choose one of the supported model tasks.');const experiment=runMLExperiment({dataset,algorithm,featureNames:dataset.featureNames,targetName:dataset.targetName,groupBy:config.groupBy,testFraction:config.testFraction,seed:config.seed,standardize:config.standardize,modelConfig});state.experiment=experiment;state.algorithm=algorithm;state.config={...config,modelConfig:clone(modelConfig)};renderExperiment(container,state);report(container,`Fit complete · ${experiment.split?.train?.length??0} training rows and ${experiment.split?.test?.length??0} held-out rows.`,'success');document.dispatchEvent(new CustomEvent('mllab:fit',{detail:{experiment:clone(experiment)}}));return experiment;}catch(error){report(container,error?.message||String(error),'error');throw error;}
  }
  function parseRecords(text){if(typeof text!=='string'||text.length>MAX_TEXT)throw new RangeError(`Input JSON is limited to ${MAX_TEXT} characters.`);const value=JSON.parse(text);const records=Array.isArray(value)?value:value?.records;if(!Array.isArray(records)||records.length>MAX_RECORDS)throw new TypeError(`Provide a JSON array of at most ${MAX_RECORDS} records.`);return records;}
  function predict(text,container){if(!state.experiment)throw new Error('Fit a model first.');try{const records=parseRecords(text);const result=predictMLModel({experiment:state.experiment,records});state.lastPrediction=result;const output=$(container,'#ml-prediction-result');output.innerHTML=`<h4>Predictions for ${records.length} rows</h4>${renderPredictionRows(state.experiment.config.algorithm,records,result)}<details><summary>Raw prediction arrays</summary><pre>${safe(limitText(result))}</pre></details>`;$(container,'#ml-plot-wrap').innerHTML=plotFor(state.experiment,result,records);report(container,'Prediction used the retained training preprocessing.');document.dispatchEvent(new CustomEvent('mllab:predict',{detail:{result:clone(result)}}));return result;}catch(error){report(container,error?.message||String(error),'error');throw error;}}
  function evaluate(text,container){if(!state.experiment)throw new Error('Fit a model first.');try{const records=parseRecords(text);const result=evaluateMLExperiment({experiment:state.experiment,records});state.lastEvaluation=result;$(container,'#ml-evaluation').innerHTML=`<h4>Evaluation on ${records.length} supplied rows</h4>${renderMetricsOrNote(result.metrics,state.experiment.config.algorithm)}<h4>Baseline comparison</h4>${renderBaselines(result.baselines)}<details><summary>Raw evaluation output</summary><pre>${safe(limitText(result,12000))}</pre></details>`;const trainingRows=state.experiment.split?.train||[];const overlapsTraining=records.some(row=>trainingRows.some(train=>row.runId===train.runId||row.conditionId===train.conditionId));report(container,overlapsTraining?'Evaluation complete, but a run/condition group overlaps training; treat these metrics as descriptive, not held-out evidence.':'Evaluation complete. No run/condition IDs overlap training; these metrics are out-of-group, though they still describe this selected model.');document.dispatchEvent(new CustomEvent('mllab:evaluate',{detail:{result:clone(result)}}));return result;}catch(error){report(container,error?.message||String(error),'error');throw error;}}
  function replay(container){if(!state.experiment)throw new Error('Fit a model first.');try{const result=replayMLExperiment({experiment:state.experiment});const matches=Boolean(result.matches);report(container,matches?'Replay matches the retained experiment.':`Replay differs: ${JSON.stringify(result.mismatches||[])}` ,matches?'success':'error');return result;}catch(error){report(container,error?.message||String(error),'error');throw error;}}
  function exportRun(){if(!state.experiment)throw new Error('Fit a model first.');const json=pretty(state.experiment);if(json.length>MAX_TEXT*8)throw new RangeError('Experiment export exceeds the 2 MB display/download limit.');const blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='capability-lab-ml-experiment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return clone(state.experiment);}
}
