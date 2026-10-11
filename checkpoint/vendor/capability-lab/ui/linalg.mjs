const SVG = 'http://www.w3.org/2000/svg';
const MAX_VECTOR_CELLS = 64;
const MAX_MATRIX_ROWS = 30;
const MAX_MATRIX_COLUMNS = 30;
const MAX_TRACE_ROWS = 80;

function node(document, tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function format(value) {
  if (typeof value === 'number') return Number(value.toPrecision(6)).toString();
  return JSON.stringify(value);
}

function renderVector(document, values) {
  const wrapper = node(document, 'div', undefined, 'linalg-vector-view');
  const shown = values.slice(0, MAX_VECTOR_CELLS);
  wrapper.setAttribute('aria-label', `Vector values ${shown.map(format).join(', ')}${values.length > shown.length ? `; first ${shown.length} of ${values.length}` : ''}`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 360 180');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', values.length === 2 ? '2D vector from the origin to its signed endpoint' : 'Vector components shown as signed bars');
  const axis = document.createElementNS(SVG, 'line');
  axis.setAttribute('x1', '12'); axis.setAttribute('x2', '348'); axis.setAttribute('y1', '90'); axis.setAttribute('y2', '90');
  axis.setAttribute('stroke', '#64748b'); svg.append(axis);
  if (values.length === 2) {
    const vertical = document.createElementNS(SVG, 'line');
    vertical.setAttribute('x1', '180'); vertical.setAttribute('x2', '180'); vertical.setAttribute('y1', '18'); vertical.setAttribute('y2', '158');
    vertical.setAttribute('stroke', '#cbd5e1'); svg.append(vertical);
    const magnitude = values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 1);
    const endX = 180 + values[0] / magnitude * 60, endY = 90 - values[1] / magnitude * 60;
    const arrow = document.createElementNS(SVG, 'line');
    arrow.setAttribute('x1', '180'); arrow.setAttribute('y1', '90'); arrow.setAttribute('x2', String(endX)); arrow.setAttribute('y2', String(endY));
    arrow.setAttribute('stroke', '#0e7490'); arrow.setAttribute('stroke-width', '3'); svg.append(arrow);
    const endpoint = document.createElementNS(SVG, 'circle');
    endpoint.setAttribute('cx', String(endX)); endpoint.setAttribute('cy', String(endY)); endpoint.setAttribute('r', '5'); endpoint.setAttribute('fill', '#0e7490'); svg.append(endpoint);
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('x', '180'); label.setAttribute('y', '174'); label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '11');
    label.textContent = `direction (${format(values[0])}, ${format(values[1])})`;
    svg.append(label);
    wrapper.append(svg, node(document, 'pre', format(values), 'linalg-values'));
    return wrapper;
  }
  const max = shown.reduce((largest, value) => Math.max(largest, Math.abs(value)), 1);
  const width = Math.min(40, 300 / shown.length);
  shown.forEach((value, index) => {
    const height = Math.abs(value) / max * 68;
    const rect = document.createElementNS(SVG, 'rect');
    rect.setAttribute('x', String(30 + index * (300 / shown.length)));
    rect.setAttribute('y', String(value >= 0 ? 90 - height : 90));
    rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
    rect.setAttribute('fill', value >= 0 ? '#0e7490' : '#c2410c');
    const title = document.createElementNS(SVG, 'title'); title.textContent = `component ${index}: ${format(value)}`;
    rect.append(title); svg.append(rect);
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('x', String(30 + index * (300 / shown.length) + width / 2)); label.setAttribute('y', '169');
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '11'); label.textContent = String(index);
    svg.append(label);
  });
  wrapper.append(svg, node(document, 'pre', format(shown), 'linalg-values'));
  if (shown.length < values.length) wrapper.append(node(document, 'p', `Vector view shows the first ${shown.length} of ${values.length} components; the full result remains in the Result view.`));
  return wrapper;
}

function renderMatrix(document, rows, caption) {
  const wrapper = node(document, 'div', undefined, 'linalg-matrix-view');
  if (caption) wrapper.append(node(document, 'p', caption));
  const shownRows = rows.slice(0, MAX_MATRIX_ROWS);
  const shownColumns = rows[0].slice(0, MAX_MATRIX_COLUMNS).length;
  const table = node(document, 'table');
  table.setAttribute('aria-label', 'Matrix result');
  const body = node(document, 'tbody');
  let maxAbs = 0;
  for (const row of shownRows) for (const value of row.slice(0, MAX_MATRIX_COLUMNS)) maxAbs = Math.max(maxAbs, Math.abs(value));
  maxAbs ||= 1;
  shownRows.forEach((row, r) => {
    const tr = node(document, 'tr');
    row.slice(0, MAX_MATRIX_COLUMNS).forEach((value, c) => {
      const td = node(document, 'td', format(value));
      td.setAttribute('aria-label', `row ${r + 1}, column ${c + 1}: ${format(value)}`);
      const intensity = Math.round(20 + 60 * ((value / maxAbs + 1) / 2));
      td.style.backgroundColor = `hsl(190 55% ${100 - intensity / 2}%)`;
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body); wrapper.append(table);
  if (shownRows.length < rows.length || shownColumns < rows[0].length) {
    wrapper.append(node(document, 'p', `Matrix view shows ${shownRows.length} of ${rows.length} rows and ${shownColumns} of ${rows[0].length} columns; the full result remains in the Result view.`));
  }
  return wrapper;
}

function resultView(document, result, fieldName) {
  if (typeof result === 'number') return node(document, 'output', format(result), 'linalg-scalar-view');
  if (Array.isArray(result) && result.every((value) => typeof value === 'number')) return renderVector(document, result);
  if (Array.isArray(result) && result.every((row) => Array.isArray(row) && row.every((value) => typeof value === 'number'))) {
    const caption = fieldName === 'eigenvectors' ? 'Each column is one eigenvector, in the same order as the eigenvalues.' : undefined;
    return renderMatrix(document, result, caption);
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const wrapper = node(document, 'div', undefined, 'linalg-object-view');
    for (const [key, value] of Object.entries(result)) {
      const field = node(document, 'section', undefined, 'linalg-result-field');
      field.append(node(document, 'h3', key), resultView(document, value, key));
      wrapper.append(field);
    }
    return wrapper;
  }
  return node(document, 'pre', format(result), 'linalg-structured-view');
}

function flattenCalls(calls, depth = 0, output = []) {
  if (!Array.isArray(calls)) return output;
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue;
    const id = call.id ?? call.capabilityId ?? call.node?.id;
    if (id) output.push({ id, depth });
    flattenCalls(call.calls ?? call.trace?.calls ?? call.children, depth + 1, output);
  }
  return output;
}

export function renderLinalg(container, execution, descriptor) {
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  const heading = node(document, 'h2', descriptor?.title ?? execution?.id ?? 'Linear algebra result');
  const explanation = node(document, 'p', descriptor?.formula ?? descriptor?.description ?? 'Result from the linear algebra capability.');
  const rawCaveats = descriptor?.caveats ?? [];
  const caveats = Array.isArray(rawCaveats) ? rawCaveats : [rawCaveats];
  fragment.append(heading, explanation, resultView(document, execution.result));
  if (caveats.length) {
    const list = node(document, 'ul', undefined, 'linalg-caveats');
    caveats.forEach((caveat) => list.append(node(document, 'li', caveat)));
    fragment.append(list);
  }
  const calls = flattenCalls(execution.trace?.calls ?? []);
  const traceSection = node(document, 'section', undefined, 'linalg-trace');
  const shownCalls = calls.slice(0, MAX_TRACE_ROWS);
  traceSection.append(node(document, 'h3', `Execution trace (${calls.length} calls)`));
  if (calls.length) {
    const list = node(document, 'ol');
    shownCalls.forEach((call) => list.append(node(document, 'li', `${'· '.repeat(call.depth)}${call.id}`)));
    traceSection.append(list);
    if (shownCalls.length < calls.length) traceSection.append(node(document, 'p', `Showing the first ${shownCalls.length} calls.`));
  } else traceSection.append(node(document, 'p', 'Atomic capability; no nested calls.'));
  fragment.append(traceSection);
  container.replaceChildren(fragment);
}
