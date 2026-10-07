import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(new URL('./connect4-ui.js', import.meta.url));

function loadUI() {
  assert.ok(existsSync(modulePath), 'shared Game Boy Connect Four renderer should exist');
  const window = {};
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), { window });
  return window.GameBoyConnect4UI;
}

function screenTree(overrides = {}) {
  const rows = Array.from({ length: 6 }, (_, row) => ({
    tag: 'row', attrs: { row }, children: Array.from({ length: 7 }, (_, column) => ({
      tag: 'cell', attrs: { row, column, player: null, preview: false }, children: [],
    })),
  }));
  rows[5].children[0].attrs.player = 'red';
  rows[5].children[6].attrs.player = 'yellow';
  rows[4].children[3].attrs.preview = true;
  return {
    tag: 'connect4-screen',
    attrs: {
      phase: 'playing', currentPlayer: 'red', winner: null, cursorColumn: 3,
      statusText: 'RED TO MOVE', hintText: 'LEFT / RIGHT · A DROP', ...overrides,
    },
    children: [{ tag: 'board', attrs: { rows: 6, columns: 7 }, children: rows }],
  };
}

function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function recordingContext() {
  const calls = { rects: [], arcs: [], texts: [], fills: [], filledPaths: [], strokes: [] };
  let currentArc = null;
  const ctx = {
    calls, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    fillRect(...args) { calls.rects.push({ args, fillStyle: this.fillStyle }); },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc(...args) { currentArc = { args }; calls.arcs.push(currentArc); },
    fill() { calls.fills.push(this.fillStyle); calls.filledPaths.push({ args: currentArc?.args, fillStyle: this.fillStyle }); },
    stroke() { calls.strokes.push({ args: currentArc?.args, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
    fillText(text, ...args) { calls.texts.push([String(text), ...args]); },
  };
  return ctx;
}

test('Game Boy seek-tree renderer draws 42 cells, both players, cursor, and tree text', () => {
  const ui = loadUI();
  assert.equal(typeof ui?.drawConnect4Tree, 'function', 'shared renderer should be exposed');

  const ctx = recordingContext();
  ui.drawConnect4Tree(ctx, screenTree());

  assert.equal(ctx.calls.arcs.length, 42, 'each of the 42 board cells is drawn from the tree');
  assert.ok(ctx.calls.fills.includes('#0f380f'), 'red tokens use the dark Game Boy shade');
  assert.ok(ctx.calls.fills.includes('#7a4b00'), 'yellow tokens use a dark warm ochre with clear contrast from the green wells');
  const yellowDiscFill = ctx.calls.filledPaths.find(({ args }) => args?.[0] === 131 && args?.[1] === 112);
  assert.equal(yellowDiscFill?.fillStyle, '#7a4b00', 'yellow disc uses the gold player color');
  assert.ok(contrastRatio(yellowDiscFill.fillStyle, '#9bbc0f') >= 3, 'yellow disc fill has at least 3:1 luminance contrast against the green wells');
  const yellowDiscStroke = ctx.calls.strokes.find(({ args }) => args?.[0] === 131 && args?.[1] === 112);
  assert.ok(yellowDiscStroke?.lineWidth >= 2, 'yellow disc keeps a bold outline against the green wells');
  assert.ok(ctx.calls.texts.some(([text]) => text === 'RED TO MOVE'));
  assert.ok(ctx.calls.texts.some(([text]) => text === 'LEFT / RIGHT · A DROP'));
});

test('Game Boy seek-tree renderer rejects a malformed board instead of silently drawing stale state', () => {
  const ui = loadUI();
  assert.equal(typeof ui?.drawConnect4Tree, 'function', 'shared renderer should be exposed');
  const ctx = recordingContext();
  const malformed = screenTree();
  malformed.children[0].children[0].children.pop();
  assert.throws(() => ui.drawConnect4Tree(ctx, malformed), /6|7|board|cell/i);
  assert.equal(ctx.calls.arcs.length, 0);
});

test('Game Boy seek-tree renderer removes the live cursor after a finished game', () => {
  const ui = loadUI();
  const ctx = recordingContext();
  ui.drawConnect4Tree(ctx, screenTree({
    phase: 'won', currentPlayer: null, winner: 'red', statusText: 'RED WINS', hintText: 'PRESS START TO RESET',
  }));
  assert.equal(ctx.calls.texts.some(([text]) => text === '▼'), false);
  assert.ok(ctx.calls.texts.some(([text]) => text === 'RED WINS'));
});

test('cartridge picker accepts only distinct registered ids and labels', () => {
  const ui = loadUI();
  assert.equal(typeof ui?.normalizeCartridgeCatalog, 'function', 'catalog validator should be exposed');
  const result = ui.normalizeCartridgeCatalog({ cartridges: [
    { id: 'snake', title: 'Snake' },
    { id: 'connect4', title: 'Connect Four' },
    { id: '../other', title: 'Untrusted path' },
    { id: 'snake', title: 'Duplicate' },
    { id: 'empty-title', title: '  ' },
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { id: 'snake', title: 'Snake' },
    { id: 'connect4', title: 'Connect Four' },
  ]);
});

test('cartridge picker makes a sibling experience URL only for a catalog entry', () => {
  const ui = loadUI();
  assert.equal(typeof ui?.cartridgePath, 'function', 'catalog path helper should be exposed');
  const catalog = [{ id: 'snake', title: 'Snake' }];
  assert.equal(ui.cartridgePath('snake', catalog), '../snake/index.html');
  assert.equal(ui.cartridgePath('../admin', catalog), null);
  assert.equal(ui.cartridgePath('connect4', catalog), null);
});

test('Connect Four ROM maps held A to one drop and draws only the latest seek tree', async () => {
  const ui = loadUI();
  assert.equal(typeof ui?.createConnect4ROM, 'function', 'ROM adapter should be exposed');
  let seekCount = 0;
  let stateCalls = 0;
  let currentPlayer = 'red';
  const events = [];
  const runtime = {
    async dispatch(event) {
      events.push(event);
      if (event.type === 'drop') currentPlayer = currentPlayer === 'red' ? 'yellow' : 'red';
    },
    async seek() {
      seekCount++;
      return screenTree({ currentPlayer, statusText: currentPlayer.toUpperCase() + ' TO MOVE' });
    },
    state() { stateCalls++; return { currentPlayer }; },
  };
  const attrs = {};
  const status = {
    textContent: '',
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
  };
  let initialState;
  const saved = { value: null, get(key) { assert.equal(key, 'connect4'); return this.value; }, set(key, value) { assert.equal(key, 'connect4'); this.value = value; } };
  const rom = ui.createConnect4ROM(snapshot => { initialState = snapshot; return runtime; }, status);
  rom.tick({ a: false }, saved);
  for (let i = 0; i < 12 && seekCount === 0; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(seekCount, 1, 'startup projects once');
  assert.equal(initialState, null, 'saved state is supplied to the runtime factory');

  for (let i = 0; i < 60; i++) rom.tick({ a: true, start: false, left: false, right: false });
  for (let i = 0; i < 12 && seekCount < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ type: 'drop' }], 'a held A button produces one drop');
  assert.equal(seekCount, 2, 'draw loop does not seek repeatedly');
  assert.equal(attrs['data-current-player'], 'yellow', 'accessible screen status comes from the seek result');
  assert.equal(saved.value.currentPlayer, 'yellow', 'completed actions persist the runtime snapshot');

  const ctx = recordingContext();
  const beforeDrawStateCalls = stateCalls;
  rom.draw(ctx);
  assert.equal(stateCalls, beforeDrawStateCalls, 'draw uses the cached projection instead of reading runtime state');
  assert.equal(ctx.calls.arcs.length, 42);
  assert.ok(ctx.calls.texts.some(([text]) => text === 'YELLOW TO MOVE'));
});

test('Connect Four ROM drops a second held-button edge while an async dispatch is pending', async () => {
  const ui = loadUI();
  assert.equal(typeof ui?.createConnect4ROM, 'function', 'ROM adapter should be exposed');
  let seekCount = 0;
  let releaseDispatch;
  const events = [];
  const runtime = {
    dispatch(event) {
      events.push(event);
      if (event.type === 'drop') return new Promise(resolve => { releaseDispatch = resolve; });
      return Promise.resolve();
    },
    async seek() { seekCount++; return screenTree(); },
    state() { return {}; },
  };
  const saved = { get() { return null; }, set() {} };
  const rom = ui.createConnect4ROM(() => runtime, null);
  rom.tick({ a: false }, saved);
  for (let i = 0; i < 12 && seekCount === 0; i++) await new Promise(resolve => setImmediate(resolve));
  rom.tick({ a: true });
  rom.tick({ a: false });
  rom.tick({ a: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ type: 'drop' }], 'overlapping drop presses do not start concurrent dispatches');
  releaseDispatch();
  for (let i = 0; i < 12 && seekCount < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(seekCount, 2, 'one projection follows the completed dispatch');
});
