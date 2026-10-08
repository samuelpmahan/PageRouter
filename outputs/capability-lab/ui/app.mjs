import { createRegistry } from '../src/runtime/index.mjs';
import * as statisticsModule from '../src/statistics/index.mjs';
import * as linalgModule from '../src/linalg/index.mjs';
import * as composedModule from '../src/composed/index.mjs';

const domainModules = [statisticsModule, linalgModule, composedModule];
const capabilities = domainModules.flatMap(module => Array.isArray(module.capabilities) ? module.capabilities : []);
const registry = createRegistry(capabilities, { source: 'capability-lab-browser', version: '0.1.0' });
const byId = new Map(registry.list().map(item => [item.id, item]));
const $ = selector => document.querySelector(selector);
const els = {
  status: $('#system-status'), count: $('#capability-count'), list: $('#capability-list'), search: $('#search-capabilities'), select: $('#capability-select'),
  title: $('#selected-title'), desc: $('#selected-description'), badge: $('#kind-badge'), def: $('#definition'), editor: $('#input-editor'),
  jsonStatus: $('#json-status'), examples: $('#examples'), run: $('#run-button'), replay: $('#replay-button'), runStatus: $('#run-status'),
  graph: $('#dependency-graph'), result: $('#result'), trace: $('#execution-trace'), traceCount: $('#trace-count'), visual: $('#data-view'),
  executionBadge: $('#execution-badge'), meta: $('#run-meta'), format: $('#format-button')
};
let selectedId = null, lastExecution = null, lastReceipt = null, filter = 'all', lastReplay = null, renderEpoch = 0, currentExample = null;
let activeOutputView='result';
const extensionPanels = new Map();
const limits = { inputChars: 250_000, outputChars: 160_000, traceRows: 80, vectorCells: 100, matrixRows: 30, matrixCols: 30, chartPoints: 160, graphNodes: 40, graphEdges: 80 };

const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const label = id => byId.get(id)?.title || id;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const pretty = value => JSON.stringify(value, null, 2);
const num = value => Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(value) : String(value);

function setStatus(message, ready = false) { els.status.textContent = message; document.querySelector('.live-dot').classList.toggle('ready', ready); }
function visibleCapabilities() {
  const query = els.search.value.trim().toLowerCase();
  return [...byId.values()].filter(item => (filter === 'all' || item.kind === filter) && (!query || `${item.id} ${item.title} ${item.description}`.toLowerCase().includes(query)));
}
function renderList() {
  const rows = visibleCapabilities();
  els.count.textContent = `${rows.length}`;
  els.list.innerHTML = rows.length ? rows.map(item => `<button class="capability-item" role="option" aria-selected="${item.id === selectedId}" data-id="${escapeHTML(item.id)}"><span class="item-top"><strong>${escapeHTML(item.title || item.id)}</strong><span class="item-order">O${item.order ?? 0}</span></span><small>${escapeHTML(item.id)}</small></button>`).join('') : '<div class="empty-state">No matching capabilities.</div>';
  els.select.innerHTML = rows.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.title || item.id)}</option>`).join('');
  els.select.value = selectedId || '';
}
function schemaExample(descriptor) { return descriptor.examples?.[0]?.input ?? {}; }
function learningNote(descriptor) {
  const id=`${descriptor.id} ${descriptor.title}`.toLowerCase();
  if (/norm|distance/.test(id)) return ['Norm (vector length)','A norm gives a vector’s size. The Euclidean norm is the square root of the sum of squared components.','Example: vector (3, 4) has length √(3² + 4²) = 5.'];
  if (/covariance|correlation/.test(id)) return ['Covariance','Covariance describes whether two quantities move together: positive means they tend to rise together; negative means one tends to rise as the other falls.','Example: pair each person’s study hours with their score before computing it.'];
  if (/standardiz|zscore|z.score/.test(id)) return ['Standardization','Standardization subtracts the data mean and divides by its standard deviation, so values are expressed in standard-deviation units.','Formula: z = (x − mean) / standard deviation.'];
  if (/eigenvector|eigenvalue/.test(id)) return ['Eigenvector and eigenvalue','An eigenvector is a direction a matrix scales without turning. Its eigenvalue is the scale factor.','Formula: A v = λ v.'];
  if (/principalcomponents|pca|principal component/.test(id)) return ['Principal component analysis (PCA)','PCA rotates data into perpendicular directions, ordered from greatest to least variation. Scores are each observation’s coordinates in those directions.','For a centered observation x, a component score is its projection onto that component direction.'];
  if (/(^|[._\s])qr([._\s]|$)|qr factor/.test(id)) return ['QR factorization','QR writes a matrix as Q times R. Q contains perpendicular unit directions; R stores the coefficients in an upper-triangular matrix.','Formula: A = Q R.'];
  if (/variance|standarddeviation/.test(id)) return ['Variance and standard deviation','Variance is the average squared distance from the mean. Standard deviation is its square root, which returns to the data’s units.','Population divides by n; sample variance divides by n − 1.'];
  if (/quantile|median|percentile/.test(id)) return ['Quantile','A quantile marks a position in sorted data. The median is the 50th percentile; quartiles divide the data into four parts.','The definition shows this capability’s convention and its boundary behavior.'];
  return null;
}
function renderExamples(descriptor) {
  const examples = descriptor.examples || [];
  els.examples.innerHTML = examples.map((example, index) => `<button class="example-chip" type="button" data-example-index="${index}" title="Load example ${index + 1}">Example ${index + 1}${example.title ? ` · ${escapeHTML(example.title)}` : ''}</button>`).join('');
}
function graphData() {
  if (typeof registry.graph === 'function') return registry.graph();
  return { nodes: registry.list().map(x => ({ id: x.id, order: x.order ?? 0, dependsOn: x.dependsOn || [] })) };
}
function renderGraph(visited = []) {
  if (!selectedId) { els.graph.innerHTML = '<div class="empty-state">Select a capability to see its dependencies.</div>'; return; }
  const graph = graphData();
  const relevant = new Set();
  const visit = id => { if (relevant.has(id)) return; relevant.add(id); for (const dep of byId.get(id)?.dependsOn || []) visit(dep); };
  visit(selectedId);
  const orders = [...new Set([...relevant].map(id => byId.get(id)?.order ?? 0))].sort((a,b) => a-b);
  const allEdges = (graph.edges || []).filter(edge=>relevant.has(edge.from)&&relevant.has(edge.to));
  const edges = allEdges.slice(0, limits.graphEdges);
  const values = graph.orderValues || [];
  const nodes = [...relevant].slice(0, limits.graphNodes);
  els.graph.innerHTML = `<div class="graph-levels">${orders.map(order => `<div class="graph-level"><span class="graph-level-label">Order ${order}</span>${nodes.filter(id => (byId.get(id)?.order ?? 0) === order).map(id => `<div class="graph-node ${id === selectedId ? 'selected' : ''} ${visited.includes(id) ? 'visited' : ''}"><strong>${escapeHTML(label(id))}</strong><small>${escapeHTML(id)}</small></div>`).join('')}</div>`).join('')}</div>${edges.length ? `<div class="edge-list"><span class="graph-level-label">Declared call edges${allEdges.length>edges.length?` · first ${edges.length} of ${allEdges.length}`:''}</span>${edges.map(edge=>`<div class="edge-row"><span>${escapeHTML(label(edge.from))}</span><b aria-label="calls into">→</b><strong>${escapeHTML(label(edge.to))}</strong></div>`).join('')}</div>` : '<div class="edge-list"><span class="graph-level-label">No dependency edges · direct execution</span></div>'}${values.length ? `<div class="edge-list"><span class="graph-level-label">Declared order preference</span><span class="section-hint">${values.map(value=>`order ${escapeHTML(value.order)} = ${escapeHTML(value.value)}`).join(' · ')} · preference only</span></div>` : ''}`;
}
function selectCapability(id) {
  const descriptor = byId.get(id); if (!descriptor) return;
  selectedId = id; lastExecution = lastReceipt = null; renderEpoch += 1; currentExample=descriptor.examples?.[0] || null;
  els.title.textContent = descriptor.title || descriptor.id; els.desc.textContent = descriptor.description || 'No description provided.';
  els.badge.textContent = descriptor.kind || 'capability'; els.badge.className = `kind-badge ${descriptor.kind === 'composed' ? 'composed' : ''}`;
  const note=learningNote(descriptor);
  els.def.hidden = !(descriptor.formula || descriptor.caveats || descriptor.units || note);
  els.def.innerHTML = [descriptor.formula && `<div><strong>Definition:</strong> ${escapeHTML(descriptor.formula)}</div>`, descriptor.units && `<div><strong>Units:</strong> ${escapeHTML(descriptor.units)}</div>`, descriptor.caveats && `<div><strong>Notes:</strong> ${escapeHTML(Array.isArray(descriptor.caveats) ? descriptor.caveats.join(' ') : descriptor.caveats)}</div>`, note && `<div><strong>${escapeHTML(note[0])}:</strong> ${escapeHTML(note[1])}<br><strong>Example:</strong> ${escapeHTML(note[2])}</div>`].filter(Boolean).join('');
  els.editor.disabled = false; els.editor.value = pretty(schemaExample(descriptor)); els.run.disabled = false; els.replay.disabled = true; els.runStatus.textContent = '';
  renderExamples(descriptor); updateJsonStatus(); renderList(); renderGraph(); resetOutput();
  for (const panel of extensionPanels.values()) renderExtensionPanel(panel, null, descriptor);
}
function resetOutput() {
  els.executionBadge.className = 'execution-badge'; els.executionBadge.textContent = 'Ready';
  els.result.innerHTML = '<div class="empty-result"><span class="empty-glyph">ƒ</span><strong>No execution yet</strong><span>Run a capability to see its result and explanation.</span></div>';
  els.trace.innerHTML = '<div class="empty-state">Composed calls will appear here in execution order.</div>'; els.traceCount.textContent = '0';
  els.visual.innerHTML = '<div class="empty-state">Structured values and small charts appear after a run.</div>'; els.meta.hidden = true;
}
function parseInput() {
  if (els.editor.value.length > limits.inputChars) throw new Error(`Input is larger than the ${limits.inputChars.toLocaleString()} character workbench limit.`);
  let input;
  try { input = JSON.parse(els.editor.value); }
  catch (error) { throw new Error(`Input is not valid JSON: ${error.message}`); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object.');
  return input;
}
function updateJsonStatus() {
  if (!selectedId) return;
  try {
    const input=parseInput(); els.jsonStatus.textContent = 'Valid JSON object'; els.jsonStatus.className = 'json-status valid'; els.run.disabled = false;
    currentExample=byId.get(selectedId)?.examples?.find(example=>canonical(example.input)===canonical(input)) || null;
    const changed=lastExecution && canonical(input)!==canonical(lastExecution.input);
    els.replay.disabled=!lastReceipt || Boolean(changed);
    if(changed){els.executionBadge.className='execution-badge';els.executionBadge.textContent='Input changed';els.runStatus.textContent='Input changed — run again to update the result';els.runStatus.className='run-status';}
    else if(lastExecution){els.executionBadge.className='execution-badge success';els.executionBadge.textContent='Complete';els.runStatus.textContent='';els.runStatus.className='run-status';}
  }
  catch (error) { els.jsonStatus.textContent = error.message.replace(/^Input is not valid JSON: /, 'JSON: '); els.jsonStatus.className = 'json-status invalid'; els.run.disabled = true; els.replay.disabled=true; if(lastExecution){els.executionBadge.className='execution-badge';els.executionBadge.textContent='Input changed';} }
}
function flattenTrace(node, depth = 0, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach(item => flattenTrace(item, depth, out)); return out; }
  if (typeof node !== 'object') return out;
  const calls = node.calls || node.children || node.trace || [];
  if (node.id || node.capabilityId) out.push({ node, depth });
  for (const child of Array.isArray(calls) ? calls : []) flattenTrace(child, depth + 1, out);
  return out;
}
function renderTrace(execution) {
  const allRows = flattenTrace(execution.trace);
  const rows = allRows.slice(0, limits.traceRows);
  els.traceCount.textContent = `${rows.length}`;
  if (!rows.length) { els.trace.innerHTML = '<div class="empty-state">This capability ran directly without nested calls.</div>'; return; }
  els.trace.innerHTML = `${allRows.length>rows.length?`<div class="section-hint">Showing first ${rows.length} of ${allRows.length} nested calls.</div>`:''}${rows.map(({node, depth}, index) => {
    const id = node.id || node.capabilityId || 'call';
    const input = node.input ?? node.inputCanonical; const result = node.result ?? node.resultCanonical;
    const details = { order: node.order, identity: node.identity, seed: node.seed, randomDraws: node.randomDraws, input, result, inputHash: node.inputHash, resultHash: node.resultHash };
    return `<details class="trace-node" ${index === 0 ? 'open' : ''} style="margin-left:${Math.min(depth * 10, 40)}px"><summary class="trace-summary"><strong>${escapeHTML(id)}</strong><small>Order ${escapeHTML(node.order ?? '—')}</small></summary><pre class="trace-detail">${escapeHTML(pretty(details))}</pre></details>`;
  }).join('')}`;
}
function primitiveSummary(result, descriptor) {
  const explanation = descriptor.formula || descriptor.description;
  const caveat = descriptor.caveats;
  const serialized = pretty(result);
  const display = serialized.length > limits.outputChars ? `${serialized.slice(0,limits.outputChars)}\n… output view clipped at ${limits.outputChars.toLocaleString()} characters` : serialized;
  const expectedMatches=canonical(result)===canonical(currentExample?.expected);
  const expected=currentExample && canonical(currentExample.input)===canonical(lastExecution?.input) ? `<div class="explanation-card"><h4>Independent example: ${expectedMatches?'exact JSON match':'exact JSON differs'}</h4><p>Strict canonical JSON comparison. Floating-point examples may require a documented numeric tolerance; see the capability notes.</p><pre>${escapeHTML(pretty(currentExample.expected).slice(0,limits.outputChars))}</pre></div>` : '';
  return `<div class="result-value"><pre>${escapeHTML(display)}</pre></div>${expected}${explanation ? `<div class="explanation-card"><h4>What this means</h4><p>${escapeHTML(explanation)}</p></div>` : ''}${caveat ? `<div class="caveat-card"><h4>Assumptions and limits</h4><p>${escapeHTML(Array.isArray(caveat) ? caveat.join(' ') : caveat)}</p></div>` : ''}`;
}
function metricGrid(obj) {
  return `<div class="metric-grid">${Object.entries(obj).filter(([,v]) => typeof v === 'number' || typeof v === 'string').map(([key,value]) => `<div class="metric"><span>${escapeHTML(key)}</span><strong>${escapeHTML(typeof value === 'number' ? num(value) : value)}</strong></div>`).join('')}</div>`;
}
function eigenvalueChart(values) {
  const shown=values.slice(0,limits.chartPoints),W=400,H=150,p=24,max=Math.max(1,...shown.map(Math.abs)),slot=(W-2*p)/shown.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Principal component eigenvalues"><line class="axis" x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}"/>${shown.map((value,index)=>{const h=(H-2*p)*value/max;return `<rect class="bar" x="${p+index*slot+2}" y="${H-p-h}" width="${Math.max(1,slot-4)}" height="${h}" rx="2"><title>Component ${index+1}: ${num(value)}</title></rect>`}).join('')}</svg><p class="section-hint">Variance captured per principal component · first ${shown.length} values</p>`;
}
function scoreChart(rows) {
  const shown=rows.length>limits.chartPoints?rows.filter((_,i)=>i%(Math.ceil(rows.length/limits.chartPoints))===0).slice(0,limits.chartPoints):rows;
  const first=shown.map(row=>Number(row[0])),second=shown.map(row=>Number(row[1] ?? row[0]));
  const W=400,H=150,p=25,xmin=Math.min(...first),xmax=Math.max(...first),ymin=Math.min(...second),ymax=Math.max(...second),px=x=>p+(x-xmin)/(xmax-xmin||1)*(W-2*p),py=y=>H-p-(y-ymin)/(ymax-ymin||1)*(H-2*p);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Principal component scores for ${shown.length} observations"><line class="axis" x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}"/><line class="axis" x1="${p}" y1="${p}" x2="${p}" y2="${H-p}"/>${shown.map(row=>`<circle class="point" cx="${px(row[0])}" cy="${py(row[1] ?? row[0])}" r="3"><title>(${num(row[0])}, ${num(row[1] ?? row[0])})</title></circle>`).join('')}</svg><p class="section-hint">${shown[0]?.length > 1 ? 'Component 1 versus component 2' : 'Component score by observation'} · showing ${shown.length} of ${rows.length}</p>`;
}
function chartFor(result) {
  if (!result || typeof result !== 'object') return '<div class="empty-state">No chartable structured values.</div>';
  const points = result.points;
  const bins = result.bins;
  if (Array.isArray(bins) && bins.length && bins.every(x => x && Number.isFinite(x.count))) {
    const W=400,H=145,p=20,max=Math.max(1,...bins.map(x=>x.count)),w=(W-2*p)/bins.length;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram showing ${bins.length} bins"><line class="axis" x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}"/>${bins.map((b,i)=>{const h=(H-2*p)*b.count/max;return `<rect class="bar" x="${p+i*w+1}" y="${H-p-h}" width="${Math.max(1,w-3)}" height="${h}" rx="2"><title>${escapeHTML(`${b.x0} to ${b.x1}: ${b.count}`)}</title></rect>`}).join('')}</svg><p class="section-hint">Bin counts · hover bars for ranges</p>`;
  }
  if (Array.isArray(points) && points.length && points.every(x=>x&&Number.isFinite(x.x)&&Number.isFinite(x.y))) {
    const shown=points.length>limits.chartPoints?points.filter((_,i)=>i%(Math.ceil(points.length/limits.chartPoints))===0).slice(0,limits.chartPoints):points;
    const W=400,H=145,p=22,xs=shown.map(x=>x.x),ys=shown.map(x=>x.y),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),px=x=>p+(x-xmin)/(xmax-xmin||1)*(W-2*p),py=y=>H-p-(y-ymin)/(ymax-ymin||1)*(H-2*p);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plot of ${shown.length} sampled points"><line class="axis" x1="${p}" y1="${H-p}" x2="${W-p}" y2="${H-p}"/><path class="line-path" d="${shown.map((v,i)=>`${i?'L':'M'}${px(v.x)},${py(v.y)}`).join(' ')}"/>${shown.map(v=>`<circle class="point" cx="${px(v.x)}" cy="${py(v.y)}" r="3"><title>(${num(v.x)}, ${num(v.y)})</title></circle>`).join('')}</svg><p class="section-hint">x versus y · showing ${shown.length} of ${points.length} observations</p>`;
  }
  if (Array.isArray(result) && result.length && result.every(Number.isFinite)) return `<div class="vector-row">${result.slice(0,limits.vectorCells).map((v,i)=>`<span class="vector-cell">${i}: ${num(v)}</span>`).join('')}${result.length>limits.vectorCells?`<span class="section-hint">… ${result.length-limits.vectorCells} more values</span>`:''}</div>`;
  if (Array.isArray(result) && result.length && result.every(row=>Array.isArray(row)&&row.every(Number.isFinite))) return matrixView(result);
  const vectors = Object.entries(result).filter(([,v])=>Array.isArray(v)&&v.length&&v.every(Number.isFinite));
  const matrices = Object.entries(result).filter(([,v])=>Array.isArray(v)&&v.length&&v.every(row=>Array.isArray(row)&&row.every(Number.isFinite)));
  const sections = [];
  for(const [key,v] of vectors) sections.push(`<div class="data-card"><h4>${escapeHTML(key)} · vector (${v.length})</h4><div class="vector-row">${v.slice(0,limits.vectorCells).map((n,i)=>`<span class="vector-cell">${i}: ${num(n)}</span>`).join('')}${v.length>limits.vectorCells?`<span class="section-hint">… first ${limits.vectorCells} of ${v.length} values</span>`:''}</div></div>`);
  for(const [key,v] of matrices) sections.push(`<div class="data-card"><h4>${escapeHTML(key)} · matrix (${v.length} × ${v[0].length})</h4>${matrixView(v)}</div>`);
  if(Array.isArray(result.eigenvalues)&&result.eigenvalues.length&&result.eigenvalues.every(Number.isFinite)) sections.unshift(`<div class="data-card"><h4>Principal component strength</h4>${eigenvalueChart(result.eigenvalues)}</div>`);
  if(Array.isArray(result.scores)&&result.scores.length&&result.scores.every(row=>Array.isArray(row)&&row.every(Number.isFinite))) sections.unshift(`<div class="data-card"><h4>Principal component scores</h4>${scoreChart(result.scores)}</div>`);
  if (result.count !== undefined && (result.mean !== undefined || result.median !== undefined)) sections.unshift(`<div class="data-card"><h4>Summary statistics</h4>${metricGrid(result)}</div>`);
  return sections.length ? sections.join('') : '<div class="empty-state">This result has no vector, matrix, or chart view. See the Result tab for all values.</div>';
}
function matrixView(matrix) { const rows=matrix.slice(0,limits.matrixRows),cols=matrix[0]?.slice(0,limits.matrixCols)||[]; return `<div class="matrix-grid">${rows.map(row=>`<div class="matrix-row" style="grid-template-columns:repeat(${cols.length||1},max-content)">${row.slice(0,limits.matrixCols).map(value=>`<span class="matrix-cell">${num(value)}</span>`).join('')}</div>`).join('')}</div>${matrix.length>limits.matrixRows||cols.length<(matrix[0]?.length||0)?`<p class="section-hint">Matrix view capped at ${limits.matrixRows} × ${limits.matrixCols} cells; full values remain in Result.</p>`:''}`; }
async function renderExecution(execution, {replay=false}={}) {
  const epoch = ++renderEpoch;
  lastExecution = execution; lastReceipt = execution;
  els.executionBadge.className = 'execution-badge success'; els.executionBadge.textContent = replay ? 'Replayed' : 'Complete';
  const descriptor = byId.get(execution.id || selectedId);
  els.result.innerHTML = primitiveSummary(execution.result, descriptor || {});
  els.trace.innerHTML = '';
  renderTrace(execution); renderGraph(flattenTrace(execution.trace).map(x=>x.node.id));
  els.visual.innerHTML = chartFor(execution.result);
  // A domain renderer can add a richer distribution or linear-algebra view without changing this shell.
  try {
    if (descriptor?.id.startsWith('statistics.')) { const {renderStatistics}=await import('./statistics.mjs'); if(epoch===renderEpoch && renderStatistics) renderStatistics(els.visual,execution,descriptor); }
    if (descriptor?.id.startsWith('linalg.')) { const {renderLinalg}=await import('./linalg.mjs'); if(epoch===renderEpoch && renderLinalg) renderLinalg(els.visual,execution,descriptor); }
  } catch (error) { console.warn('Optional domain visualization unavailable:', error); }
  if(epoch===renderEpoch) for (const panel of extensionPanels.values()) renderExtensionPanel(panel, execution, descriptor);
  els.meta.hidden = false;
  const replayInfo = execution.replay || {};
  els.meta.textContent = `${execution.identity?.source || 'local'} · ${execution.identity?.version || ''}${replayInfo.resultHash ? ` · result ${replayInfo.resultHash}` : ''}${replayInfo.seed !== undefined ? ` · seed ${replayInfo.seed}` : ''}`;
  els.replay.disabled = !lastReceipt; els.runStatus.textContent = replay ? `Replay ${lastReplay?.matches ? 'matches' : 'differs'}` : 'Execution completed'; els.runStatus.className = 'run-status success';
  document.dispatchEvent(new CustomEvent('capabilitylab:execution', { detail: { execution, descriptor } }));
}
function fail(error) {
  const message = error?.message || String(error);
  renderEpoch += 1; lastExecution = lastReceipt = null; els.replay.disabled = true; els.meta.hidden = true;
  els.executionBadge.className = 'execution-badge error'; els.executionBadge.textContent = 'Failed';
  els.result.innerHTML = `<div class="caveat-card"><h4>Execution stopped</h4><p>${escapeHTML(message)}</p></div>`;
  els.trace.innerHTML = '<div class="empty-state">No trace was produced for this failed execution.</div>'; els.traceCount.textContent = '0';
  els.visual.innerHTML = '<div class="empty-state">No data view is available for a failed execution.</div>';
  renderGraph([]);
  els.runStatus.textContent = message; els.runStatus.className = 'run-status error';
}
function execute() {
  if (!selectedId) return;
  try { const input = parseInput(); const output = registry.execute(selectedId, input); renderExecution(output); }
  catch (error) { fail(error); }
}
function replay() {
  if (!lastReceipt) return;
  try { const report = registry.replay(lastReceipt); lastReplay = report; renderExecution(report.receipt, {replay:true}); els.runStatus.textContent = report.matches ? 'Replay matches prior result' : `Replay differs: ${(report.mismatches||[]).join(', ') || 'unreported mismatch'}; exact=${report.exact}, hash=${report.hash}`; els.runStatus.className = `run-status ${report.matches ? 'success' : 'error'}`; if(!report.matches){els.executionBadge.className='execution-badge error';els.executionBadge.textContent='Replay differs';} }
  catch (error) { fail(error); }
}

els.list.addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) selectCapability(button.dataset.id); });
els.select.addEventListener('change', () => { if (els.select.value) selectCapability(els.select.value); });
els.search.addEventListener('input', renderList);
document.querySelectorAll('.filter-chip').forEach(button => button.addEventListener('click', () => { filter=button.dataset.filter; document.querySelectorAll('.filter-chip').forEach(item=>item.classList.toggle('active',item===button)); renderList(); }));
  els.examples.addEventListener('click', event => { const button=event.target.closest('[data-example-index]'); if (!button) return; const sample=byId.get(selectedId)?.examples?.[Number(button.dataset.exampleIndex)]; if(sample){currentExample=sample;els.editor.value=pretty(sample.input);updateJsonStatus();} });
els.editor.addEventListener('input', updateJsonStatus); els.run.addEventListener('click', execute); els.replay.addEventListener('click', replay);
els.format.addEventListener('click', () => { try { els.editor.value=pretty(parseInput()); updateJsonStatus(); } catch {} });
function activateOutputTab(button) {
  document.querySelectorAll('.output-tab').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-selected',String(item===button));});
  document.querySelectorAll('.output-view').forEach(view=>{const active=view.id===`${button.dataset.view}-view`;view.classList.toggle('active',active);view.hidden=!active;});
  const watchView=button.dataset.view==='extension-watches';
  const mlView=button.dataset.view==='extension-ml';
  const explainView=button.dataset.view==='extension-explain';
  const nextView=button.dataset.view.replace(/^extension-/, '');
  $('.workspace').classList.toggle('watches-active',watchView);
  $('.shell').classList.toggle('watches-active',watchView);
  $('.workspace').classList.toggle('ml-active',mlView);
  $('.shell').classList.toggle('ml-active',mlView);
  $('.workspace').classList.toggle('explain-active',explainView);
  $('.shell').classList.toggle('explain-active',explainView);
  $('.output-panel .panel-heading h2').textContent=watchView?'Synchronized watches':mlView?'Model experiments':explainView?'Model explanations':'Execution';
  $('.output-panel .panel-heading .eyebrow').textContent=watchView?'TICK / THREE MODELS':mlView?'FIT / PREDICT / EVALUATE':explainView?'ATTRIBUTE / GROUND / CHECK':'03 / Inspect';
  $('.version-tag').textContent=watchView?'WATCHES':mlView?'MACHINE LEARNING':explainView?'EXPLAIN':'FOUNDATIONS';
  const activeMode=watchView?'watches':mlView?'ml':explainView?'explain':'foundations';
  document.querySelectorAll('[data-workspace-mode]').forEach(item=>{const active=item.dataset.workspaceMode===activeMode;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});
  if(activeOutputView!==nextView) document.dispatchEvent(new CustomEvent('capabilitylab:view',{detail:{id:activeOutputView,active:false}}));
  activeOutputView=nextView;
  document.dispatchEvent(new CustomEvent('capabilitylab:view',{detail:{id:nextView,active:true}}));
}
document.querySelectorAll('.output-tab').forEach(button => button.addEventListener('click', () => activateOutputTab(button)));
document.querySelectorAll('[data-workspace-mode]').forEach(button=>button.addEventListener('click',()=>{
  if(button.dataset.workspaceMode==='foundations') document.querySelector('[data-view="result"]')?.click();
  else {
    const id=button.dataset.workspaceMode;
    const target=document.querySelector(`[data-view="extension-${id}"]`);
    if(target) target.click(); else {els.runStatus.textContent=`${id==='ml'?'ML':id==='explain'?'Explain':'Watch'} workbench is loading.`;els.runStatus.className='run-status';}
  }
}));
function renderExtensionPanel(panel, execution, descriptor) {
  if (!panel.element.isConnected) return;
  try { panel.render(panel.element, execution, descriptor, extensionApi); }
  catch (error) { panel.element.textContent=`Panel failed to render: ${error?.message||String(error)}`; }
}
function registerPanel({id,title,render}) {
  if (typeof id!=='string'||! /^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError('panel id must use lowercase letters, numbers, and dashes');
  if (typeof title!=='string'||!title.trim()||typeof render!=='function') throw new TypeError('panel requires a title and render callback');
  if (extensionPanels.has(id)) throw new Error(`panel already registered: ${id}`);
  const viewId=`extension-${id}`;
  const button=document.createElement('button'); button.type='button'; button.className='output-tab'; button.dataset.view=viewId; button.setAttribute('role','tab'); button.setAttribute('aria-selected','false'); button.textContent=title;
  button.addEventListener('click',()=>activateOutputTab(button)); document.querySelector('.output-tabs').append(button);
  const element=document.createElement('div'); element.id=`${viewId}-view`; element.className='output-view'; element.setAttribute('role','tabpanel'); element.hidden=true; $('#extension-views').append(element);
  const panel={id,button,element,render}; extensionPanels.set(id,panel); renderExtensionPanel(panel,lastExecution,byId.get(selectedId));
  return ()=>{if(!extensionPanels.delete(id))return;if(button.classList.contains('active'))activateOutputTab(document.querySelector('[data-view="result"]'));button.remove();element.remove();};
}

const extensionApi = {
  registry, capabilities: registry.list(),
  execute(id, input, options) { return registry.execute(id, input, options); },
  registerPanel,
  onExecution(callback) { const listener=event=>callback(event.detail); document.addEventListener('capabilitylab:execution',listener); return ()=>document.removeEventListener('capabilitylab:execution',listener); }
};
window.capabilityLab = extensionApi;
import('./watches.mjs').then(module=>module.registerWatchWorkbench(extensionApi)).catch(error=>{
  console.error('Watch workbench unavailable:',error);
  const button=document.querySelector('[data-workspace-mode="watches"]');
  if(button) button.disabled=true;
});
import('./ml.mjs').then(module=>module.registerMLWorkbench(extensionApi)).catch(error=>{
  console.error('ML workbench unavailable:',error);
  const button=document.querySelector('[data-workspace-mode="ml"]');
  if(button) button.disabled=true;
});
import('./explain.mjs').then(module=>module.registerExplainWorkbench(extensionApi)).catch(error=>{
  console.error('Explain workbench unavailable:',error);
  const button=document.querySelector('[data-workspace-mode="explain"]');
  if(button) button.disabled=true;
});
setStatus(`${capabilities.length} capabilities loaded`, true); renderList();
const preference=registry.orderPreference?.() || graphData().orderValues;
if(preference?.values?.length) document.querySelector('.order-note div span').textContent=preference.values.map(({order,value})=>`Order ${order} → ${value}`).join(' · ');
if (capabilities.length) selectCapability(capabilities[0].id);
