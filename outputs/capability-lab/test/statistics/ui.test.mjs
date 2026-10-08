import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStatistics } from '../../ui/statistics.mjs';

class Element {
  constructor(tagName, ownerDocument) { this.tagName = tagName; this.ownerDocument = ownerDocument; this.children = []; this.attributes = {}; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
class Document {
  createElement(tag) { return new Element(tag, this); }
  createElementNS(_ns, tag) { return new Element(tag, this); }
}
const flatten = node => [node, ...node.children.flatMap(flatten)];

test('CDF chart sorts a copy, renders query markers without inventing between-query steps', () => {
  const document = new Document(), container = new Element('div', document);
  const execution = { result: { points: [{ x: 3, y: 1 }, { x: 1, y: 0.2 }, { x: 2, y: 0.6 }] }, trace: [] };
  const before = structuredClone(execution.result);
  renderStatistics(container, execution, { id: 'statistics.empiricalCdf', title: 'CDF' });
  const svg = container.children.find(child => child.tagName === 'svg'), nodes = flatten(svg);
  assert.equal(nodes.filter(node => node.tagName === 'circle').length, 3);
  assert.equal(nodes.some(node => node.tagName === 'polyline'), false);
  const positions = nodes.filter(node => node.tagName === 'circle').map(node => Number(node.attributes.cx));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.deepEqual(execution.result, before);
});

test('large histogram view aggregates bars and states the display sampling rule', () => {
  const document = new Document(), container = new Element('div', document);
  const bins = Array.from({ length: 200 }, (_, i) => ({ x0: i, x1: i + 1, count: i % 4 }));
  renderStatistics(container, { result: { bins }, trace: [] }, { id: 'statistics.histogram', title: 'Histogram' });
  const svg = container.children.find(child => child.tagName === 'svg'), nodes = flatten(svg);
  assert.ok(nodes.filter(node => node.tagName === 'rect').length <= 80);
  assert.ok(nodes.some(node => node.tagName === 'text' && /Displayed as .*bin totals/.test(node.textContent)));
  assert.equal(bins.length, 200);
});
