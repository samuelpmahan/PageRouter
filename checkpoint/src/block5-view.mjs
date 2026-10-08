import {
  createGridWorld,
  editGridObject,
  DEFAULT_GRID_RECIPE,
  runGridRecipe,
  canonicalJson,
  hashState,
  createPixelCache,
  executeComposedCalculation,
  PROVIDER_IDENTITY,
  PROVIDER_SETUP,
  selectComposedCalculation,
} from '../exp/block5/core/index.mjs';
import {buildEventGraph, compressStream, decompress, discoverCalculations, canonical as canonicalCompression} from '../exp/compression/index.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json = value => JSON.stringify(value, null, 2);
const clone = value => structuredClone(value);
const directions = ['U','D','L','R'];
const words = ['BABA','ROCK','FLAG','WALL','IS','YOU','STOP','PUSH','WIN'];

// A small, readable level that uses the unchanged outer rule-engine contract.
function download(name, value) {
  const url=URL.createObjectURL(new Blob([canonicalCompression(value)],{type:'application/json'}));
  const link=document.createElement('a'); link.href=url; link.download=name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function sameOutput(left,right,api) {
  return api.canonicalJson({state:left.state,events:left.stream.events})===api.canonicalJson({state:right.state,events:right.stream.events});
}
function board(state,selectedId=null,compact=false) {
  if(!state) return '<div class="b5-board-empty">Create or edit a board, then replay the card stack.</div>';
  const cells=[];
  for(let y=0;y<state.height;y++) for(let x=0;x<state.width;x++) {
    const items=state.objects.filter(item=>item.x===x&&item.y===y);
    const content=items.map(item=>`<button type="button" class="b5-piece ${item.kind==='text'?'text-piece':esc(item.kind)} ${item.id===selectedId?'selected':''}" data-select-object="${esc(item.id)}" title="${esc(item.id)} · ${esc(item.kind)}${item.word?` · ${esc(item.word)}`:''}">${item.kind==='text'?esc(item.word):esc(item.kind[0].toUpperCase())}</button>`).join('');
    cells.push(`<div class="b5-cell" data-x="${x}" data-y="${y}">${content}</div>`);
  }
  return `<div class="b5-board ${compact?'compact':''}" style="grid-template-columns:repeat(${state.width},minmax(0,1fr))" role="grid" aria-label="${state.width} by ${state.height} puzzle board">${cells.join('')}</div>`;
}
function ruleLines(rules=[]) { return rules.length?rules.map(rule=>`<span class="b5-parsed-rule">${esc(rule)}</span>`).join(''):'<span class="b5-no-rules">No active word rules</span>'; }

export function createBlock5View({core={},compression={},now=()=>globalThis.performance.now()}={}) {
  const api={
    createGridWorld:core.createGridWorld??createGridWorld, editGridObject:core.editGridObject??editGridObject,
    DEFAULT_GRID_RECIPE:core.DEFAULT_GRID_RECIPE??DEFAULT_GRID_RECIPE, runGridRecipe:core.runGridRecipe??runGridRecipe,
    canonicalJson:core.canonicalJson??canonicalJson,hashState:core.hashState??hashState,
    createPixelCache:core.createPixelCache??createPixelCache,executeComposedCalculation:core.executeComposedCalculation??executeComposedCalculation,
    PROVIDER_SETUP:core.PROVIDER_SETUP??PROVIDER_SETUP,
    PROVIDER_IDENTITY:core.PROVIDER_IDENTITY??PROVIDER_IDENTITY,
    selectComposedCalculation:core.selectComposedCalculation??selectComposedCalculation,
    buildEventGraph:compression.buildEventGraph??buildEventGraph,compressStream:compression.compressStream??compressStream,
    decompress:compression.decompress??decompress,discoverCalculations:compression.discoverCalculations??discoverCalculations,
  };
  let root=null, initialState=api.createGridWorld(),boardView='start';
  let recipe=clone(api.DEFAULT_GRID_RECIPE), selectedId='baba';
  let caches={atomic:api.createPixelCache(),composed:api.createPixelCache()};
  let latest=null,previous=null,candidates=[],activeProgram=null,importedProgram=null,manualProgramSelection=false;
  let compressed=null,reconstructed=null,graph=null,programExecution=null,busy=false,error='',status='Move the BABA piece or edit words, then run the ordered cards.';
  const attached=()=>root?.isConnected;
  const activeCandidate=()=>importedProgram??activeProgram??null;
  // Discovery and provider provenance are immutable evidence. Never rewrite a program's
  // provider identity or training event IDs to make it fit the current run.
  const currentProgram=()=>activeCandidate();

  async function runAll(label='Replay ordered cards') {
    if(busy)return; busy=true;error='';status=`${label}: running uncached, atomic cache, and discovered-composed cache…`;paint();
    const before=previous;
    // A program used here must have been discovered from an earlier completed stream.
    const trainingProgram=activeCandidate();
    try {
      const t0=now();
      const uncached=await api.runGridRecipe({initialState:clone(initialState),recipe:clone(recipe),mode:'uncached',previousRun:before??undefined});
      const uncachedMs=now()-t0;
      const newlyDiscovered=api.discoverCalculations(uncached.stream);graph=api.buildEventGraph(uncached.stream);
      compressed=api.compressStream(uncached.stream);reconstructed=api.decompress(compressed.bundle);
      const streamEqual=api.canonicalJson(uncached.stream)===api.canonicalJson(reconstructed);
      if(!streamEqual)throw new Error('Compression reconstruction changed the event stream.');
      const program=trainingProgram;
      const atomicStart=now();
      const atomic=await api.runGridRecipe({initialState:clone(initialState),recipe:clone(recipe),mode:'atomic',cache:caches.atomic,previousRun:before??uncached});
      const atomicMs=now()-atomicStart;
      const composedStart=now();
      const composed=program?await api.runGridRecipe({initialState:clone(initialState),recipe:clone(recipe),mode:'composed',cache:caches.composed,previousRun:before??uncached,program}):null;
      const composedMs=composed?now()-composedStart:null;
      latest={uncached,atomic,composed,program,uncachedMs,atomicMs,composedMs,streamEqual};previous=uncached;boardView='result';
      candidates=newlyDiscovered;
      if(!importedProgram&&!manualProgramSelection)activeProgram=api.selectComposedCalculation(candidates,recipe);
      const equal=[uncached,atomic,composed].filter(Boolean).every(result=>sameOutput(uncached,result,api));
      status=equal?`${label} complete. State and semantic events match across available modes.${program?'':' Replay once to execute a program discovered from this completed stream.'}`:'Equality gate failed: inspect mode outputs.';
      if(!equal)error='At least one mode changed the state or semantic event sequence.';
    } catch(failure) {error=failure?.message??String(failure);status='Run stopped; previous evidence remains visible.';}
    finally{busy=false;paint();}
  }

  async function moveOnce(direction) {
    if(busy)return;busy=true;error='';paint();
    try {
      const source=recipe.rules[0];
      const oneMove={id:`manual-${direction}`,rules:[{...clone(source),id:`manual-${direction}`,enabled:true,parameters:{...source.parameters,direction}}]};
      const result=await api.runGridRecipe({initialState:clone(initialState),recipe:oneMove,mode:'uncached',previousRun:previous??undefined});
      initialState=result.state;boardView='start';status=`Moved ${direction}. Active word rules were reparsed on the board.`;
    } catch(failure) {error=failure?.message??String(failure);status='Move could not be applied.';}
    finally {busy=false;paint();}
  }

  function renderCards() {
    return recipe.rules.map((rule,index)=>`<article class="b5-rule"><div class="b5-rule-head"><label><input type="checkbox" data-rule-index="${index}" data-field="enabled" ${rule.enabled===false?'':'checked'}> ${index+1}. ${esc(rule.id)}</label><span class="b5-stack"><button data-order="${index}" data-delta="-1" ${index===0?'disabled':''} aria-label="Move card up">↑</button><button data-order="${index}" data-delta="1" ${index===recipe.rules.length-1?'disabled':''} aria-label="Move card down">↓</button></span></div><label class="b5-direction">Direction <select data-rule-index="${index}" data-field="direction">${directions.map(dir=>`<option ${rule.parameters.direction===dir?'selected':''}>${dir}</option>`).join('')}</select></label><small>Calculation <code>${esc(rule.calculation)}</code> · applies a real game step in this position.</small></article>`).join('');
  }
  function resultCard(title,result,ms,reference) {
    if(!result)return `<article class="b5-result"><h3>${esc(title)}</h3><p>No earlier completed replay has trained a composed Calculation yet. Replay after discovery to validate it.</p></article>`;
    const matched=sameOutput(reference,result,api),hits=result.ledger.filter(row=>row.cacheHit).length;
    return `<article class="b5-result"><div class="b5-result-title"><h3>${esc(title)}</h3><span class="b5-pill ${matched?'pass':'fail'}">${matched?'MATCH':'MISMATCH'}</span></div><p>State <code>${esc(result.finalStateHash??api.hashState(result.state))}</code></p><p>${hits}/${result.ledger.length} cache hits · ${Number(ms??0).toFixed(3)} ms</p><details><summary>Provider setup and PxC receipts</summary><pre>${esc(json({providerIdentity:result.providerIdentity,expectedProviderIdentity:api.PROVIDER_IDENTITY,providerSetup:api.PROVIDER_SETUP,receipts:result.receipts,hashes:result.hashes}))}</pre></details></article>`;
  }
  function impactTable() {
    const rows=latest?.uncached?.ledger??[];
    if(!rows.length)return '<p>Replay to compare changed inputs with changed outputs.</p>';
    const modes=[['baseline',latest.uncached],['atomic',latest.atomic],['composed',latest.composed]];
    return `<div class="b5-table-wrap"><table class="b5-table"><thead><tr><th>Card</th><th>Cache B/A/C</th><th>May</th><th>Did</th></tr></thead><tbody>${rows.map((row,index)=>{const cardId=decodeURIComponent(row.eventId?.split(':').at(-1)??'card');return `<tr><td title="${esc(row.calculation)}">${index+1}. ${esc(cardId)}</td><td>${modes.map(([,result])=>result?(result.ledger[index]?.cacheHit?'hit':'run'):'—').join(' / ')}</td><td>${row.mayAffect?'yes':'no'}${row.firstExecution?' · first':''}</td><td>${row.didAffect?'yes':'no'}</td></tr>`;}).join('')}</tbody></table></div><p class="b5-help">Cache columns: baseline / atomic / composed. May affect = input or provider changed; did affect = result changed.</p>`;
  }
  function paint() {
    if(!attached())return;
    const selected=initialState.objects.find(item=>item.id===selectedId)??null;
    const visibleState=boardView==='result'&&latest?latest.uncached.state:initialState;
    const equal=latest&&[latest.uncached,latest.atomic,latest.composed].filter(Boolean).every(result=>sameOutput(latest.uncached,result,api));
    const stats=compressed?.stats, selectedCandidate=activeCandidate();
    const programOptions=[...candidates];
    if(selectedCandidate&&!programOptions.includes(selectedCandidate))programOptions.push(selectedCandidate);
    root.innerHTML=`<style>
      .b5{display:grid;gap:8px}.b5 .panel{min-width:0;padding:12px}.b5-intro{display:flex;justify-content:space-between;gap:14px}.b5-intro h2{margin:2px 0}.b5-muted,.b5-help,.b5-intro p{font-size:11px;line-height:1.4;color:var(--muted);margin:4px 0}.b5-grid{display:grid;grid-template-columns:minmax(340px,1.05fr) minmax(320px,.95fr);gap:9px}.b5-board{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));aspect-ratio:1.65;min-height:225px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0b141c}.b5-board.compact{min-height:125px;aspect-ratio:1.5}.b5-cell{min-width:0;min-height:0;border-right:1px solid #ffffff0d;border-bottom:1px solid #ffffff0d;display:grid;place-items:center}.b5-piece{border:1px solid #54707e;border-radius:5px;background:#172633;color:#b9d7ea;min-width:25px;min-height:24px;padding:2px 3px;font:700 9px ui-monospace,monospace;cursor:pointer}.b5-piece.text-piece{background:#c5a763;color:#201b10;border-color:#f4dfa0}.b5-piece.baba{background:#6ccdb2;color:#062c23}.b5-piece.rock{background:#798b99;color:#111820}.b5-piece.flag{background:#e9a866;color:#281608}.b5-piece.wall{background:#45505b;color:#eee}.b5-piece.selected{outline:2px solid #81ddff;outline-offset:2px;z-index:2}.b5-board-empty{display:grid;place-items:center;min-height:160px;color:var(--muted)}.b5-rules{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0}.b5-parsed-rule{padding:4px 7px;border-radius:14px;background:#19362f;color:#95efc5;font:10px ui-monospace,monospace}.b5-no-rules{color:#f5bd91;font-size:12px}.b5-controls,.b5-fields,.b5-metrics{display:flex;gap:6px;flex-wrap:wrap;align-items:end}.b5-control-group{display:flex;gap:4px}.b5-control-group button{min-width:36px;min-height:29px;padding:3px}.b5-inspector{display:flex;gap:6px;align-items:end;flex-wrap:wrap;margin-top:6px}.b5-inspector label,.b5-direction{display:grid;gap:3px;color:var(--muted);font-size:10px}.b5-inspector input,.b5-inspector select{width:84px}.b5-rule-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.b5-rule{padding:6px 7px;border:1px solid var(--line);border-radius:8px;background:#0d1721}.b5-rule-head,.b5-result-title{display:flex;justify-content:space-between;align-items:center;gap:6px}.b5-rule-head label{font-size:11px}.b5-rule small{display:block;color:var(--muted);margin-top:3px;font-size:9px}.b5-rule code,.b5-table code{color:#9cd7ee}.b5-stack{display:flex;gap:3px}.b5-stack button{padding:1px 7px;min-height:24px}.b5-direction{margin-top:4px}.b5-direction select{width:72px;padding:3px}.b5-results{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.b5-result{min-width:0;padding:7px;border:1px solid var(--line);border-radius:9px;background:#0d1721}.b5-result h3{font-size:11px;margin:0}.b5-result p{font-size:9px;color:var(--muted);overflow-wrap:anywhere;margin:4px 0}.b5-result code{font-size:9px;overflow-wrap:anywhere}.b5-pill{border-radius:12px;padding:3px 6px;font:9px ui-monospace,monospace}.b5-pill.pass{background:#17372e;color:#8cf2c8}.b5-pill.fail{background:#491e28;color:#ffbdc8}.b5-table-wrap{overflow:auto}.b5-table{width:100%;border-collapse:collapse;font-size:10px}.b5-table th,.b5-table td{text-align:left;padding:4px;border-bottom:1px solid var(--line)}.b5-metric{padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:#0d1721;font-size:10px}.b5-metric strong{display:block;color:var(--mint);font:14px ui-monospace,monospace}.b5-status{color:#b9d7ea}.b5-error{color:#ffbdc8}.b5-program{width:100%;min-height:90px}.b5-input{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.b5-input label{display:grid;gap:4px;font-size:11px;color:var(--muted)}
      @media(max-width:900px){.b5-grid,.b5-results{grid-template-columns:1fr}.b5-rule-list{grid-template-columns:1fr}.b5-board.compact{min-height:180px}}@media(max-width:560px){.b5-intro{display:block}.b5-board{min-height:280px}.b5-piece{min-width:21px;min-height:22px;padding:1px;font-size:8px}}
    </style><div class="b5">
      <section class="panel b5-intro"><div><div class="kicker">Block5 · editable word-rule puzzle</div><h2>Move words. Change the rules. Replay the cards.</h2><p>Text pieces create rules when they form “NOUN IS PROPERTY.” The ordered cards perform actual game moves. A card can push text; the next card uses the newly parsed rules.</p></div><span class="badge">LOCAL · RULE ENGINE · PxC</span></section>
      <section class="panel"><div class="b5-controls"><div class="b5-control-group"><button data-move="U" aria-label="Move up">↑</button><button data-move="L" aria-label="Move left">←</button><button data-move="D" aria-label="Move down">↓</button><button data-move="R" aria-label="Move right">→</button></div><button class="primary" id="b5-run" ${busy?'disabled':''}>Run ordered cards</button><button id="b5-replay" ${busy||!latest?'disabled':''}>Replay card stack</button><button id="b5-reset" ${busy?'disabled':''}>Reset puzzle</button><span class="b5-muted">Arrows move Baba now. The ordered cards replay as a separate recipe.</span></div><p class="b5-status" role="status" aria-live="polite">${esc(error||status)}</p>${error?`<p class="b5-error">${esc(error)}</p>`:''}</section>
      <div class="b5-grid"><section class="panel"><div class="row spread"><div><h3>${boardView==='result'&&latest?'Result board':'Starting board'}</h3><p class="b5-muted">Select a piece to edit the starting board; result view is read-only.</p></div><div class="b5-stack"><button data-board-view="start" ${boardView==='start'?'disabled':''}>Start</button><button data-board-view="result" ${!latest||boardView==='result'?'disabled':''}>Result</button></div></div>${board(visibleState,boardView==='start'?selectedId:null)}<div class="b5-rules"><strong>Active rules:</strong>${ruleLines(visibleState.rules)}</div><p class="b5-muted">${visibleState.won?'YOU WIN':visibleState.lost?'No YOU object remains':boardView==='result'?'No win yet':'Edit words to change YOU, STOP, PUSH, or WIN.'}</p>${boardView==='start'&&selected?`<div class="b5-inspector"><strong>${esc(selected.id)}</strong><label>Kind<select id="b5-kind">${['baba','rock','flag','wall','text'].map(kind=>`<option ${selected.kind===kind?'selected':''}>${kind}</option>`).join('')}</select></label><label>Word<select id="b5-word" ${selected.kind!=='text'?'disabled':''}>${words.map(word=>`<option ${selected.word===word?'selected':''}>${word}</option>`).join('')}</select></label><label>Column<input id="b5-x" type="number" min="0" max="${initialState.width-1}" value="${selected.x}"></label><label>Row<input id="b5-y" type="number" min="0" max="${initialState.height-1}" value="${selected.y}"></label><button id="b5-apply-object">Apply piece edit</button></div>`:''}</section>
      <section class="panel"><div class="row spread"><div><h3>Ordered card recipe</h3><p class="b5-muted">Each enabled card calls the same grid-step Calculation in stack order.</p></div><div class="b5-stack"><button id="b5-add-card" ${recipe.rules.length>=12?'disabled':''}>Add card</button><button id="b5-remove-card" ${recipe.rules.length<=1?'disabled':''}>Remove last</button><button id="b5-reset-recipe">Reset stack</button></div></div><div class="b5-rule-list">${renderCards()}</div><div class="row spread"><strong>Replay evidence</strong><button id="b5-export-stream" ${busy||!latest?'disabled':''}>Export event stream</button></div><p class="b5-muted">${latest?.uncached.stream.events.length??0} calculations · May affect = input/provider changed; Did affect = result changed.</p>${impactTable()}</section></div>
      <section class="panel"><div class="row spread"><div><h3>Same board and cards, three execution modes</h3><p class="b5-muted">Composed mode uses a program discovered from an earlier complete stream. First replay trains the next one. State match means exact canonical JSON equality.</p></div><span class="b5-pill ${equal?'pass':'fail'}">${latest?(equal?'ALL MATCH':'MISMATCH'):'NOT RUN'}</span></div><div class="b5-results">${resultCard('Uncached baseline',latest?.uncached,latest?.uncachedMs,latest?.uncached)}${resultCard('Atomic cache',latest?.atomic,latest?.atomicMs,latest?.uncached)}${resultCard('Discovered composed Calculation',latest?.composed,latest?.composedMs,latest?.uncached)}</div></section>
      <section class="panel"><div class="row spread"><div><h3>Exact stream compression and executable recipes</h3><p class="b5-muted">Discovery trains from a completed replay. Compression must reconstruct every stream field.</p></div><div class="b5-stack"><button id="b5-export-bundle" ${busy||!compressed?'disabled':''}>Export compressed bundle</button><button id="b5-export-program" ${busy||!currentProgram()?'disabled':''}>Export composed program</button></div></div><div class="b5-metrics">${stats?`<div class="b5-metric">Stream bytes<strong>${stats.rawBytes}</strong></div><div class="b5-metric">Bundle bytes<strong>${stats.encodedBytes}</strong></div><div class="b5-metric">Saved bytes<strong>${stats.savedBytes}</strong></div><div class="b5-metric">Bundle / stream<strong>${Number(stats.ratio).toFixed(3)}</strong></div><div class="b5-metric">Exact reconstruction<strong>${latest?.streamEqual?'PASS':'FAIL'}</strong></div>`:'<p>Run the cards to measure compression and discover programs.</p>'}</div><p class="b5-help">Byte counts compare canonical UTF-8 JSON for the complete stream and bundle, including metadata and model.</p><div class="b5-input"><label>Discovered or imported program<select id="b5-program">${programOptions.map((item,index)=>`<option value="${index}" ${selectedCandidate===item?'selected':''}>${esc(item.id??`Calculation ${index+1}`)}${item===activeProgram&&!candidates.includes(item)?' · retained':''}</option>`).join('')}${importedProgram?`<option value="imported" selected>${esc(importedProgram.id)} · imported</option>`:''}</select></label><label>Import program<input id="b5-import" type="file" accept="application/json,.json"></label><button id="b5-execute" ${busy||!selectedCandidate?'disabled':''}>Execute discovered program</button></div>${selectedCandidate?`<details><summary>Program, actual inputs, provider identity</summary><pre>${esc(json(currentProgram()))}</pre></details>`:'<p>No program selected yet. Run a complete stream before discovery.</p>'}${programExecution?`<details><summary>Program execution and receipt</summary><pre>${esc(json(programExecution))}</pre></details>`:''}<details><summary>Event graph (${graph?.nodes?.length??0} nodes, ${graph?.edges?.length??0} links)</summary><pre>${esc(json(graph??{}))}</pre></details></section>
    </div>`;

    const $=selector=>root.querySelector(selector);
    $('#b5-run').onclick=()=>void runAll();$('#b5-replay').onclick=()=>void runAll('Replay');
    $('#b5-reset').onclick=()=>{initialState=api.createGridWorld();recipe=clone(api.DEFAULT_GRID_RECIPE);selectedId='baba';boardView='start';caches={atomic:api.createPixelCache(),composed:api.createPixelCache()};latest=null;previous=null;candidates=[];activeProgram=null;importedProgram=null;manualProgramSelection=false;compressed=null;reconstructed=null;graph=null;programExecution=null;error='';status='Puzzle reset.';paint();};
    $('#b5-reset-recipe').onclick=()=>{recipe=clone(api.DEFAULT_GRID_RECIPE);status='Default ordered card recipe restored.';paint();};
    $('#b5-add-card').onclick=()=>{if(recipe.rules.length>=12)return;const source=recipe.rules.at(-1);recipe.rules.push({...clone(source),id:`move-${recipe.rules.length+1}`,parameters:{...source.parameters}});status='A new move card was added to the end of the stack.';paint();};
    $('#b5-remove-card').onclick=()=>{if(recipe.rules.length<=1)return;recipe.rules.pop();status='Last move card removed.';paint();};
    root.querySelectorAll('[data-board-view]').forEach(button=>button.onclick=()=>{boardView=button.dataset.boardView;paint();});
    root.querySelectorAll('[data-select-object]').forEach(button=>button.onclick=()=>{selectedId=button.dataset.selectObject;paint();});
    $('#b5-apply-object')?.addEventListener('click',()=>{try{const kind=$('#b5-kind').value,patch={kind,x:Number($('#b5-x').value),y:Number($('#b5-y').value)};if(kind==='text')patch.word=$('#b5-word').value;initialState=api.editGridObject(initialState,selectedId,patch);boardView='start';status='Piece edit applied and active rules reparsed.';error='';paint();}catch(failure){error=failure.message;paint();}});
    root.querySelectorAll('[data-rule-index]').forEach(control=>control.onchange=()=>{const index=Number(control.dataset.ruleIndex);if(control.dataset.field==='enabled')recipe.rules[index].enabled=control.checked;else recipe.rules[index].parameters.direction=control.value;status='Card edit saved. Run the stack to replay.';paint();});
    root.querySelectorAll('[data-order]').forEach(button=>button.onclick=()=>{const index=Number(button.dataset.order),next=index+Number(button.dataset.delta);if(next<0||next>=recipe.rules.length)return;[recipe.rules[index],recipe.rules[next]]=[recipe.rules[next],recipe.rules[index]];status='Card order changed; execution follows the new order.';paint();});
    root.querySelectorAll('[data-move]').forEach(button=>button.onclick=()=>void moveOnce(button.dataset.move));
    root.onkeydown=event=>{if(event.target?.matches?.('input,select,textarea,[contenteditable="true"]'))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const dir={'ArrowUp':'U','ArrowDown':'D','ArrowLeft':'L','ArrowRight':'R'}[event.key];void moveOnce(dir);}};
    $('#b5-export-stream').onclick=()=>latest&&download('block5-grid-event-stream.json',latest.uncached.stream);
    $('#b5-export-bundle').onclick=()=>compressed&&download('block5-grid-compressed-bundle.json',compressed.bundle);
    $('#b5-export-program').onclick=()=>currentProgram()&&download('block5-grid-composed-calculation.json',currentProgram());
    $('#b5-program').onchange=event=>{const value=event.target.value;if(value==='imported'){activeProgram=importedProgram;manualProgramSelection=true;}else{importedProgram=null;activeProgram=programOptions[Number(value)]??null;manualProgramSelection=true;}programExecution=null;paint();};
    $('#b5-import').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>1_000_000)throw new Error('Program file exceeds 1 MB.');const program=JSON.parse(await file.text());if(program.format!=='pagerouter.composed-calculation.v1')throw new Error('Expected a composed Calculation program.');importedProgram=program;activeProgram=program;manualProgramSelection=true;status='Program imported. Execution remains validated by the local provider.';error='';paint();}catch(failure){error=failure.message;paint();}};
    $('#b5-execute').onclick=async()=>{const program=currentProgram();if(!program){error='Run the stack to discover a program first.';paint();return;}busy=true;paint();try{programExecution=await api.executeComposedCalculation({program,inputs:Object.fromEntries(program.inputs.map(input=>[input.port,input.defaultValue]))});status='Composed program executed by the local PxC provider.';}catch(failure){error=failure.message;}finally{busy=false;paint();}};
  }
  return {mount(element){root=element;paint();},unmount(){root=null;}};
}
