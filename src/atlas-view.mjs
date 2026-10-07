import {createAtlasSession,createCapabilityProtocol,createAtlasCompositionDefinition} from '../exp/atlas/atlas-session.mjs';
import {captureAtlasCase,runAtlasJs,compareAtlasObservations} from '../exp/atlas/cross-language.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = value => JSON.stringify(value, null, 2);
function download(name, value) {
  const url = URL.createObjectURL(new Blob([pretty(value)], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// This controller belongs to the app, rather than any particular mounted DOM.
// Navigation detaches its view; pending work, errors, and the owning session survive.
export function createAtlasView({session, protocol, sampleDefinition, implementationIdentity, crossLanguage={captureAtlasCase,runAtlasJs,compareAtlasObservations}} = {}) {
  session ??= createAtlasSession({implementationIdentity});
  const ladder = createCapabilityLadderView({protocol, sampleDefinition, implementationIdentity});
  let root = null, busy = false, report = null, composition = null, receipt = null, error = '', message = '';
  let draft = {gain:2, bias:1};
  let crossCase=null,jsObservation=null,pythonObservation=null,comparison=null,crossBusy=false,crossError='',crossMessage='';
  const current = () => root?.isConnected;
  async function crossAction(kind,file) {
    if(crossBusy)return;
    crossBusy=true;crossError='';crossMessage=kind==='capture'?'Capturing the pinned Atlas case and running JavaScript.':'Checking the imported Python observation through FG.';paint();
    try {
      if(kind==='capture') {
        const gain=Number(draft.gain),bias=Number(draft.bias);
        if(!Number.isFinite(gain)||!Number.isFinite(bias)||gain < -10||gain > 10||bias < -10||bias > 10)throw new TypeError('Choose a finite gain and bias between -10 and 10.');
        const nextCase=await crossLanguage.captureAtlasCase({gain,bias,implementationIdentity});
        const nextJs=await crossLanguage.runAtlasJs(nextCase);
        crossCase=nextCase;jsObservation=nextJs;pythonObservation=null;comparison=null;
        download('atlas-cross-language-case.json',crossCase);
        crossMessage='Case and JavaScript observation captured. Run the Python command below, then import its result.';
      } else {
        if(!crossCase||!jsObservation)throw new Error('Capture a case before importing a Python result.');
        if(file) {
          if(file.size>1000000)throw new TypeError('Python result exceeds the 1 MB import limit.');
          pythonObservation=JSON.parse(await file.text());
        }
        if(!pythonObservation)throw new Error('Choose a Python result JSON file.');
        comparison=await crossLanguage.compareAtlasObservations(crossCase,jsObservation,pythonObservation);
        crossMessage=comparison.agreement.accepted?'FG agrees on the declared observable results.':'FG rejected the first disagreement shown below.';
      }
    }catch(failure){crossError=failure?.message??String(failure);crossMessage='';comparison=null;}
    finally{crossBusy=false;paint();}
  }
  async function perform(kind) {
    if (busy) return;
    busy = true; error = ''; message = kind === 'run' ? 'Searching the declared cases…' : kind === 'composition' ? 'Running the original motion, Beta and Boolean composition…' : 'Replaying the retained recipe…';
    paint();
    try {
      const value = kind === 'run' ? await session.run({...draft}) : kind === 'composition' ? await session.runComposition({...draft}) : await session.replay();
      if (kind === 'run') { report = value; composition = null; receipt = value.final_composition?.receipt ?? value.rounds.at(-1)?.receipt; }
      else { if (kind === 'composition') {composition = value; report = null;} receipt = value.receipt; }
      message = kind === 'run' ? 'Search complete. Every accepted candidate passed the full declared grid.' : kind === 'composition' ? 'Original composition complete. The Boolean policy and its Beta estimate are scoped fixture outputs.' : 'Replay complete. Execution and cache counts are shown below.';
    } catch (failure) {
      error = failure?.message ?? String(failure); message = '';
    } finally { busy = false; paint(); }
  }
  function crossPanel(){
    const state=comparison?.agreement;
    return `<div class="panel" id="atlas-cross-language"><div class="row spread"><div><div class="kicker">Independent implementations</div><h2>Cross-language FG check</h2></div><span class="badge">JS + PYTHON</span></div><p>Capture this six-node motion recipe and its literal inputs. JavaScript runs here through Atlas/PxC. Run Python locally against the downloaded case, then import its JSON observation for an outside FG comparison.</p><div class="row"><button id="atlas-cross-capture" ${crossBusy?'disabled':''}>Capture case and run JS</button><label class="field" for="atlas-cross-import">Import Python result<input id="atlas-cross-import" type="file" accept=".json,application/json" ${crossBusy||!crossCase?'disabled':''}></label><button id="atlas-cross-repeat" ${crossBusy||!pythonObservation?'disabled':''}>Compare again</button><button id="atlas-cross-download" ${crossBusy||!comparison?'disabled':''}>Download FG result</button></div><div id="atlas-cross-status" role="status" aria-live="polite" class="notice ${crossError?'error':''}">${esc(crossError||crossMessage||'Capture a case to begin.')}</div>${crossCase?`<p class="mono">Case ${esc(crossCase.case_id)}</p><pre class="atlas-cross-command">python exp/atlas/cross_language.py atlas-cross-language-case.json atlas-python-result.json</pre>`:''}${state?`<div id="atlas-cross-verdict" class="notice ${state.accepted?'':'error'}">${state.accepted?'AGREEMENT':'DISAGREEMENT'} · ${esc(state.compared_case_count)} declared cases${state.first_difference?` · ${esc(state.first_difference.path)}: ${esc(state.first_difference.reason)}`:''}</div><details><summary>FG inputs, producer and observations</summary><pre>${esc(pretty(comparison))}</pre></details>`:''}</div>`;
  }
  function paint() {
    if (!current()) return;
    const accepted = report?.accepted, result = report ?? composition;
    const outcome = composition ? `Original composition · ${composition.outputs.decision.value.accepted?'fixture policy passed':'fixture policy rejected'}` : accepted ? `Accepted ${accepted.size_bytes} B program · reference ${report.reference.size_bytes} B` : 'Run a live search to compare executable programs';
    root.innerHTML = `<div id="atlas-view"><div id="atlas-ladder-mount"></div><div class="panel"><div class="row spread"><div><div class="kicker">Executable atlas · candidate 0.0.0</div><h2 id="atlas-outcome">${esc(outcome)}</h2></div><span class="badge">BROWSER LOCAL</span></div><p>Fit a five-transition linear motion model, search a bounded program family, and keep concrete failures to prune later candidates. Acceptance applies only to the declared grid and tolerance.</p><div class="atlas-controls"><label class="field">Gain<input id="atlas-gain" type="number" min="-10" max="10" step="0.25" value="${esc(draft.gain)}" ${busy?'disabled':''}></label><label class="field">Bias<input id="atlas-bias" type="number" min="-10" max="10" step="0.25" value="${esc(draft.bias)}" ${busy?'disabled':''}></label></div><div class="row"><button class="primary" id="atlas-run" ${busy?'disabled':''}>Run search</button><button id="atlas-composition" ${busy?'disabled':''}>Run original composition</button><button id="atlas-replay" ${busy||!result?'disabled':''}>Replay / cache check</button><button id="atlas-reset" ${busy?'disabled':''}>Reset Atlas</button></div><div id="atlas-status" role="status" aria-live="polite" class="notice ${error?'error':''}">${esc(error || message || 'Ready. Nothing runs until you choose Run search.')}</div>${receipt?`<p id="atlas-cache">${esc(receipt.executed_count)} calculation bodies executed · ${esc(receipt.cache_hit_count)} cache hits</p><p>Kernel receipts may also be produced on cache reads; they are separate from calculation execution.</p>`:''}</div>${report ? renderReport(report) : composition ? renderComposition(composition) : ''}${crossPanel()}<div class="panel atlas-inspect-panel"><details id="atlas-inspect"><summary>Inspect Parts, input references, producers and cache</summary><pre id="atlas-inspection">Open to inspect current Atlas state.</pre></details><div class="row atlas-downloads"><button id="atlas-download-recipe" ${!result?'disabled':''}>Download recipe</button><button id="atlas-download-result" ${!result?'disabled':''}>Download result</button><button id="atlas-download-inspection">Download inspection</button></div></div></div>`;
    ladder.mount(root.querySelector('#atlas-ladder-mount'));
    const $ = selector => root.querySelector(selector);
    $('#atlas-run').onclick = () => {
      if (['gain','bias'].some(key => {const input = $(`#atlas-${key}`); return !input.value.trim() || !input.checkValidity();})) {
        error = 'Choose a gain and bias between −10 and 10, in steps of 0.25.'; paint(); return;
      }
      return perform('run');
    };
    $('#atlas-composition').onclick = () => {
      if (['gain','bias'].some(key => {const input = $(`#atlas-${key}`); return !input.value.trim() || !input.checkValidity();})) {error = 'Choose a gain and bias between −10 and 10, in steps of 0.25.'; paint(); return;}
      return perform('composition');
    };
    $('#atlas-replay').onclick = () => perform('replay');
    $('#atlas-cross-capture').onclick = () => crossAction('capture');
    $('#atlas-cross-import').onchange = event => {const file=event.target.files?.[0];if(file)return crossAction('compare',file);};
    $('#atlas-cross-repeat').onclick = () => crossAction('compare');
    $('#atlas-cross-download').onclick = () => {if(comparison)download('atlas-cross-language-fg-result.json',comparison);};
    $('#atlas-reset').onclick = () => {session.reset(); report = null; composition = null; receipt = null; error = ''; message = 'Atlas-local Parts and cache reset.';crossCase=null;jsObservation=null;pythonObservation=null;comparison=null;crossError='';crossMessage='';paint();};
    for (const key of ['gain','bias']) $(`#atlas-${key}`).oninput = event => {draft[key] = Number(event.target.value);};
    $('#atlas-inspect').ontoggle = event => {if (current() && event.target === $('#atlas-inspect') && event.target.open) $('#atlas-inspection').textContent = pretty(session.inspect());};
    $('#atlas-download-recipe').onclick = () => download('atlas-recipe.json', session.exportRecipe());
    $('#atlas-download-result').onclick = () => download('atlas-result.json', result);
    $('#atlas-download-inspection').onclick = () => download('atlas-inspection.json', session.inspect());
  }
  return {
    mount(element) {root = element; paint();},
    unmount() {root = null; ladder.unmount();},
  };
}

function renderReport(report) {
  const program = (label, value) => `<div class="panel"><h2>${label} · ${esc(value.size_bytes)} B</h2><pre>${esc(pretty(value.program))}</pre><details class="details"><summary>Program Part reference</summary><pre>${esc(value.program_address)}</pre></details></div>`;
  const failures = report.rounds.filter(round => round.counterexample);
  return `<div class="notice" id="atlas-scope">${esc(report.scope.claim)}<br>Positions ${esc(pretty(report.scope.positions))} · actions ${esc(pretty(report.scope.actions))} · ${esc(report.scope.case_count)} cases · tolerance ${esc(report.scope.tolerance)}<br>Gain ${esc(report.scope.gain)} · bias ${esc(report.scope.bias)}</div><div class="two atlas-programs">${program('Reference program',report.reference)}${program('Accepted program',report.accepted)}</div><p class="mono atlas-metric">${esc(report.metric)}</p><div class="panel"><details><summary>Search composition outputs and references</summary><pre>${esc(pretty(report.final_composition))}</pre></details></div><div class="panel"><h2>Search rounds</h2><p>Retained failures are checked first. Candidates pruned by that feedback do not receive another full grid check.</p><div class="atlas-table-scroll"><table class="atlas-table"><thead><tr><th>Round / outcome</th><th>Executable program</th><th>Grid checks</th><th>Feedback / search</th></tr></thead><tbody>${report.rounds.map(round => `<tr><td>${esc(round.round)} · <strong>${round.acceptance.accepted?'ACCEPTED':'REJECTED'}</strong><br>${esc(round.size_bytes)} B</td><td><code>${esc(pretty(round.program))}</code><details><summary>Probes and program references</summary><pre>${esc(pretty({probeInputs:round.probe_inputs,probes:round.predictions,program:round.program_address,prediction:round.prediction_address,fullCheck:round.full_check}))}</pre></details></td><td>${esc(round.full_check.passed)} / ${esc(round.full_check.n)} passed<br>${esc(round.full_check.failed)} failed</td><td>${esc(round.constraint_count)} retained constraints<br>${esc(round.pruned_count)} / ${esc(round.considered_count)} candidates pruned</td></tr>`).join('')}</tbody></table></div></div><div class="panel atlas-failures"><h2>Retained concrete counterexamples · ${failures.length}</h2><p>Each failure retains its actual input, comparison values, tolerance and producer reference.</p>${failures.map(round=>`<details class="details"><summary>Round ${esc(round.round)} · rejected ${esc(round.size_bytes)} B program</summary><pre>${esc(pretty({part:round.counterexample_address,...round.counterexample}))}</pre></details>`).join('') || '<p>No counterexample retained for this model.</p>'}</div>`;
}

function renderComposition(result) {
  const probe = result.outputs.prediction_probe.value, posterior = result.outputs.posterior.value;
  return `<div class="notice" id="atlas-scope">${esc(result.scope.claim)}<br>Fit gain ${esc(result.scope.gain)} · bias ${esc(result.scope.bias)}; observed fixture gain ${esc(result.scope.reference_gain)} · bias ${esc(result.scope.reference_bias)}; ${esc(result.scope.case_count)} cases · tolerance ${esc(result.scope.tolerance)}</div><div class="panel"><h2>Motion → Beta estimate → Boolean policy</h2><p>${esc(probe.passed)} / ${esc(probe.n)} prediction cases passed · ${esc(probe.failed)} failed · Beta posterior mean ${esc(posterior.mean)}</p><details class="details"><summary>Actual six-node recipe, outputs and Part references</summary><pre>${esc(pretty(result))}</pre></details></div>`;
}

const rungs = ['parse','validate','interpret','execute'];
const rungDescription = {
  parse:'Read JSON into a definition Part.',
  validate:'Check JSON source structure, known Calculations and DAG wiring.',
  interpret:'Bind a deterministic plan with exact input and output references.',
  execute:'Run that plan through the existing domain runtime.'
};

// Owning protocol and draft live beyond a DOM mount, just like the original Atlas.
export function createCapabilityLadderView({protocol, sampleDefinition, implementationIdentity} = {}) {
  protocol ??= createCapabilityProtocol({implementationIdentity});
  const sample = () => sampleDefinition ?? createAtlasCompositionDefinition({implementationIdentity});
  let root = null, draft = pretty(sample()), revision = 0, busy = false, active = '';
  let stages = {}, composed = null, latest = null, message = '', error = '', inspectionOpen = false;
  const current = () => root?.isConnected;
  const success = rung => stages[rung]?.value?.ok === true;
  const receipt = () => latest?.value?.execution?.receipt;
  function invalidate(from = 0) {
    for(const rung of rungs.slice(from)) delete stages[rung];
    composed = null; latest = null;
  }
  async function perform(kind) {
    if(busy) return;
    const index = rungs.indexOf(kind);
    if(index > 0 && !success(rungs[index-1])) return;
    if(kind === 'replay' && !success('interpret')) return;
    const started = revision, predecessor = index > 0 ? stages[rungs[index-1]] : stages.interpret;
    if(kind === 'run') invalidate();
    else if(index >= 0) invalidate(index);
    busy = true; active = kind; error = ''; message = kind === 'run' ? 'Running Parse → Validate → Interpret → Execute…' : kind === 'replay' ? 'Replaying the retained interpreted Part…' : `${kind[0].toUpperCase()+kind.slice(1)} is running…`;
    paint();
    try {
      const result = kind === 'run' ? await protocol.run(draft) : kind === 'parse' ? await protocol.parse(draft) : kind === 'replay' ? await protocol.execute(predecessor) : await protocol[kind](predecessor);
      if(started !== revision) {message = 'Definition changed; run Parse again for this draft.';return;}
      if(kind === 'run') {stages = {...result.value.stages};composed = result;}
      else stages[kind === 'replay' ? 'execute' : kind] = result;
      latest = result;
      if(result.value.ok) message = kind === 'run' ? 'Ladder complete. All four capability Parts and their composed Part are inspectable.' : kind === 'replay' ? 'Replay complete. Last execution counts are shown below.' : `${kind[0].toUpperCase()+kind.slice(1)} complete. Its Part is retained for the next rung.`;
      else {const failure = result.value.error;error = `${failure?.code ?? 'CAPABILITY_FAILED'}: ${failure?.message ?? 'Capability failed'}`;message = '';}
    } catch(failure) {if(started === revision) {error = failure?.message ?? String(failure);message = '';}}
    finally {busy = false;active = '';paint();}
  }
  function paint(focus) {
    if(!current()) return;
    const lastReceipt = receipt(), inspection = inspectionOpen ? pretty(protocol.inspect()) : 'Open to inspect capability Parts, kernel receipts and domain cache.';
    root.innerHTML = `<div class="panel atlas-ladder-panel" id="atlas-capability-ladder"><div class="row spread"><div><div class="kicker">Discrete executable capabilities</div><h2>Capability ladder</h2></div><span class="badge">EXPLICIT ACTIONS</span></div><p>Edit a JSON recipe with literal seed Parts. Each rung is independently callable and yields its own Part; Run ladder composes the same four capabilities. Edit the sample’s named Calculations, wiring and seed values.</p><label class="field" for="atlas-ladder-definition">Definition JSON</label><textarea id="atlas-ladder-definition" spellcheck="false" ${busy?'disabled':''}>${esc(draft)}</textarea><div class="row atlas-ladder-actions"><button class="primary" id="atlas-ladder-run" ${busy?'disabled':''}>Run ladder</button><button id="atlas-ladder-replay" ${busy||!success('interpret')?'disabled':''}>Replay execution / cache</button><button id="atlas-ladder-sample" ${busy?'disabled':''}>Load six-node sample</button><button id="atlas-ladder-reset" ${busy?'disabled':''}>Reset ladder</button></div><div id="atlas-ladder-status" role="status" aria-live="polite" class="notice ${error?'error':''}">${esc(error || message || 'Ready. No capability runs until you choose a rung or Run ladder.')}</div>${lastReceipt?`<p id="atlas-ladder-cache">${esc(lastReceipt.executed_count)} calculation bodies executed · ${esc(lastReceipt.cache_hit_count)} cache hits</p>`:''}<div class="atlas-capability-rungs">${rungs.map((rung,index)=>{
      const record=stages[rung],state=record ? record.value.ok?'ok':'failed' : 'waiting';
      return `<section class="atlas-capability-rung" id="atlas-ladder-rung-${rung}" data-state="${state}"><div class="row spread"><h3>${index+1}. ${rung[0].toUpperCase()+rung.slice(1)}</h3><span class="badge ${state==='failed'?'amber':''}">${active===rung?'RUNNING':state.toUpperCase()}</span></div><p>${esc(rungDescription[rung])}</p><button id="atlas-ladder-${rung}" ${busy||(index>0&&!success(rungs[index-1]))?'disabled':''}>${rung[0].toUpperCase()+rung.slice(1)}</button>${record?`<p class="mono atlas-part-address">${esc(record.address)}</p>${record.value.error?`<p class="atlas-rung-failure">${esc(record.value.error.code)}: ${esc(record.value.error.message)}</p>`:''}<details><summary>Inspect ${esc(rung)} Part, inputs and producer</summary><pre>${esc(pretty(record))}</pre></details>`:'<p class="atlas-rung-waiting">No Part for the current definition.</p>'}</section>`;
    }).join('')}</div>${composed?`<details id="atlas-ladder-composed-part" class="details"><summary>Inspect composed ladder Part and reached stage Parts</summary><pre>${esc(pretty(composed))}</pre></details>`:''}${latest?.value.execution?`<details id="atlas-ladder-outputs" class="details"><summary>Execution outputs and domain composition</summary><pre>${esc(pretty({outputs:latest.value.execution.outputs,composition_part:latest.value.execution.composition_part,receipt:lastReceipt}))}</pre></details>`:''}<details id="atlas-ladder-inspect" class="details" ${inspectionOpen?'open':''}><summary>Inspect protocol Parts, receipts and execution/cache counts</summary><pre id="atlas-ladder-inspection">${esc(inspection)}</pre></details><div class="row atlas-downloads"><button id="atlas-ladder-download-definition" ${busy?'disabled':''}>Download definition</button><button id="atlas-ladder-download-result" ${busy||!latest?'disabled':''}>Download result Part</button><button id="atlas-ladder-download-inspection" ${busy?'disabled':''}>Download ladder inspection</button></div></div>`;
    const $ = selector => root.querySelector(selector);
    $('#atlas-ladder-definition').oninput = event => {
      const input=event.target,restore=root.ownerDocument?.activeElement===input ? {start:input.selectionStart,end:input.selectionEnd,scrollTop:input.scrollTop} : null;
      draft=input.value;revision++;invalidate();error='';message='Definition edited. Previous rung results were invalidated; start with Parse.';paint(restore);
    };
    for(const rung of [...rungs,'run','replay']) $(`#atlas-ladder-${rung}`).onclick=()=>perform(rung);
    $('#atlas-ladder-sample').onclick=()=>{if(busy)return;draft=pretty(sample());revision++;invalidate();error='';message='Six-node sample loaded. Nothing has executed.';paint();};
    $('#atlas-ladder-reset').onclick=()=>{if(busy)return;protocol.reset();revision++;invalidate();error='';message='Ladder-local Parts and domain cache reset. Definition draft retained.';paint();};
    $('#atlas-ladder-inspect').ontoggle=event=>{if(!current() || event.target !== $('#atlas-ladder-inspect'))return;inspectionOpen=event.target.open;if(inspectionOpen)$('#atlas-ladder-inspection').textContent=pretty(protocol.inspect());};
    $('#atlas-ladder-download-definition').onclick=()=>{if(busy)return;downloadText('atlas-capability-definition.json',draft);};
    $('#atlas-ladder-download-result').onclick=()=>{if(!busy&&latest)download('atlas-capability-result-part.json',latest);};
    $('#atlas-ladder-download-inspection').onclick=()=>{if(!busy)download('atlas-capability-inspection.json',protocol.inspect());};
    if(focus) {const input=$('#atlas-ladder-definition');input.focus({preventScroll:true});input.setSelectionRange(focus.start,focus.end);input.scrollTop=focus.scrollTop;}
  }
  return {mount(element){root=element;paint();},unmount(){root=null;}};
}
function downloadText(name,text) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
