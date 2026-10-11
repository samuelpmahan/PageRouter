/** Render a small result summary and a domain-appropriate SVG view. Does not alter execution state. */
export function renderStatistics(container, execution, descriptor) {
  if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('container must be a DOM element');
  const doc = container.ownerDocument ?? globalThis.document;
  const result = execution?.result ?? {};
  const title = doc.createElement('h3'); title.textContent = descriptor?.title ?? descriptor?.id ?? 'Statistics result';
  const summary = doc.createElement('pre');
  const serialized = JSON.stringify(result, null, 2);
  summary.textContent = serialized.length > 12000 ? `${serialized.slice(0, 12000)}\n… result summary truncated for display` : serialized;
  const trace = doc.createElement('p'); trace.textContent = `Capability calls: ${countCalls(execution?.trace)}`;
  const children = [title, summary, trace];
  const id = descriptor?.id ?? '';
  if (id === 'statistics.histogram' && Array.isArray(result.bins)) children.push(renderBars(doc, result.bins.map(b => b.count), result.bins.map(b => `${format(b.x0)}–${format(b.x1)}`), 'Bin counts', true));
  else if (id === 'statistics.empiricalCdf' && Array.isArray(result.points)) children.push(renderCdf(doc, result.points));
  else if (Array.isArray(result.ranks)) children.push(renderBars(doc, result.ranks, result.ranks.map((_, i) => String(i + 1)), 'Ranks by input position'));
  else if (Array.isArray(result.zScores) || Array.isArray(result.zScores?.values)) children.push(renderSignedBars(doc, result.zScores.values ?? result.zScores, 'Standardized values (z scores)'));
  else if (Array.isArray(result.values) && /zScores|standardized/i.test(id)) children.push(renderSignedBars(doc, result.values, 'Standardized values (z scores)'));
  container.replaceChildren(...children);
  return container;
}

function countCalls(trace) {
  if (!trace) return 0;
  if (Array.isArray(trace)) return trace.reduce((n, x) => n + 1 + countCalls(x?.calls ?? x?.children), 0);
  if (typeof trace === 'object') return 1 + countCalls(trace.calls ?? trace.children);
  return 0;
}
const format = x => Number.isFinite(x) ? Number(x.toPrecision(5)).toString() : String(x);

function renderBars(doc, values, labels, description, aggregate = false) {
  const svg = svgElement(doc, 'svg', { viewBox: `0 0 640 230`, role: 'img', 'aria-label': description });
  const maxBars = 80, stride = Math.max(1, Math.ceil(values.length / maxBars));
  let shown = values.map((value, i) => ({ value, label: labels[i] }));
  if (aggregate && stride > 1) shown = Array.from({ length: Math.ceil(values.length / stride) }, (_, i) => {
    const start = i * stride, end = Math.min(values.length, start + stride);
    return { value: values.slice(start, end).reduce((a, b) => a + b, 0), label: `${labels[start]}…${labels[end - 1]}` };
  });
  else if (stride > 1) shown = shown.filter((_, i) => i % stride === 0);
  const max = Math.max(1, ...shown.map(x => x.value)), gap = 8, width = Math.max(2, (600 - gap * shown.length) / shown.length);
  shown.forEach(({ value, label }, i) => {
    const x = 28 + i * (width + gap), h = 160 * value / max;
    svg.append(svgElement(doc, 'rect', { x, y: 180 - h, width, height: h, fill: '#2563eb', rx: 2 }));
    const labelNode = svgElement(doc, 'text', { x: x + width / 2, y: 201, 'text-anchor': 'middle', 'font-size': 10 }); labelNode.textContent = label; svg.append(labelNode);
    const count = svgElement(doc, 'text', { x: x + width / 2, y: 174 - h, 'text-anchor': 'middle', 'font-size': 10 }); count.textContent = String(value); svg.append(count);
  });
  svg.append(svgElement(doc, 'line', { x1: 24, y1: 180, x2: 624, y2: 180, stroke: '#64748b' }));
  if (stride > 1) { const note = svgElement(doc, 'text', { x: 28, y: 222, 'font-size': 10 }); note.textContent = aggregate ? `Displayed as ${stride}-bin totals` : `Showing every ${stride}th of ${values.length} values`; svg.append(note); }
  return svg;
}

function renderCdf(doc, points) {
  // These are evaluations at query values, not enough information to infer jumps between them.
  const ordered = [...points].sort((a, b) => a.x - b.x);
  const stride = Math.max(1, Math.ceil(ordered.length / 100));
  const shown = ordered.filter((_, i) => i % stride === 0 || i === ordered.length - 1);
  const svg = svgElement(doc, 'svg', { viewBox: '0 0 640 230', role: 'img', 'aria-label': 'Empirical cumulative probability step plot' });
  if (!shown.length) return svg;
  const xs = shown.map(p => p.x), min = Math.min(...xs), max = Math.max(...xs), span = max - min;
  const position = x => span === 0 ? 0.5 : Number.isFinite(span) ? (x - min) / span : (x / 2 - min / 2) / (max / 2 - min / 2);
  const xy = p => [30 + 580 * position(p.x), 190 - 160 * p.y];
  const axis = svgElement(doc, 'line', { x1: 24, y1: 190, x2: 624, y2: 190, stroke: '#64748b' }); svg.append(axis);
  shown.forEach(p => { const [cx, cy] = xy(p); svg.append(svgElement(doc, 'circle', { cx, cy, r: 3, fill: '#1d4ed8' })); });
  const note = svgElement(doc, 'text', { x: 28, y: 220, 'font-size': 10 }); note.textContent = stride > 1 ? `CDF markers at ${shown.length} ordered query values (sampled)` : 'CDF markers at query values'; svg.append(note);
  return svg;
}

function renderSignedBars(doc, values, description) {
  const svg = svgElement(doc, 'svg', { viewBox: '0 0 640 230', role: 'img', 'aria-label': description });
  if (!values.length) return svg;
  const stride = Math.max(1, Math.ceil(values.length / 80)), shown = values.filter((_, i) => i % stride === 0);
  const max = Math.max(1, ...shown.map(Math.abs)), gap = 8, width = Math.max(2, (600 - gap * shown.length) / shown.length), baseline = 110;
  shown.forEach((value, i) => { const x = 28 + i * (width + gap), h = 80 * value / max; svg.append(svgElement(doc, 'rect', { x, y: baseline - Math.max(0, h), width, height: Math.abs(h), fill: value < 0 ? '#d97706' : '#2563eb', rx: 2 })); });
  svg.append(svgElement(doc, 'line', { x1: 24, y1: baseline, x2: 624, y2: baseline, stroke: '#64748b' }));
  if (stride > 1) { const note = svgElement(doc, 'text', { x: 28, y: 220, 'font-size': 10 }); note.textContent = `Showing every ${stride}th of ${values.length} standardized values`; svg.append(note); }
  return svg;
}
function svgElement(doc, tag, attrs) { const node = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; }
