// Minimal DOM shim: just enough for the thin PxCube experience apps
// (mock-smoke, build-bag) to boot and run their flows in Node, with no
// browser. The apps' real behavior goes through createMockMounts (pure JS);
// this shim only stands in for rendering and event wiring.
import fs from 'node:fs';
import path from 'node:path';

const allElements = [];

function matchesTag(node, selector) {
  return selector.split(',').some(part => part.trim().toLowerCase() === node.tagName.toLowerCase());
}

class ShimElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this._text = '';
    this._value = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.className = '';
    this.onclick = null;
    this.onchange = null;
    this.onsubmit = null;
    this.parent = null;
    allElements.push(this);
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get value() { return this._value; }
  set value(v) { this._value = String(v ?? ''); }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    return this.append(...nodes);
  }
  setAttribute() {}
  getAttribute() { return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (matchesTag(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  click() {
    if (typeof this.onclick === 'function') return this.onclick();
    return undefined;
  }
}

const byId = new Map();

export function installDomShim({ baseDir, search = '' } = {}) {
  const storageData = new Map();
  const localStorage = {
    getItem: key => (storageData.has(key) ? storageData.get(key) : null),
    setItem: (key, value) => storageData.set(key, String(value)),
    removeItem: key => storageData.delete(key),
    clear: () => storageData.clear(),
  };
  const document = {
    createElement: tag => new ShimElement(tag),
    getElementById: id => {
      if (!byId.has(id)) {
        const el = new ShimElement('div');
        el.id = id;
        byId.set(id, el);
      }
      return byId.get(id);
    },
    querySelectorAll: selector => allElements.filter(el => matchesTag(el, selector)),
    querySelector: selector => document.querySelectorAll(selector)[0] ?? null,
    addEventListener() {},
  };
  const location = { search, href: 'http://localhost/' };
  const fetch = async url => {
    const file = path.resolve(baseDir, String(url).replace(/^\.\//, '').split('?')[0]);
    try {
      const text = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
    } catch {
      return { ok: false, status: 404, json: async () => { throw Error(`fetch ${url}: 404`); }, text: async () => { throw Error(`fetch ${url}: 404`); } };
    }
  };
  const window = globalThis;
  Object.assign(globalThis, { window, document, localStorage, location, fetch });
  return { document, localStorage, location, window, ShimElement };
}
