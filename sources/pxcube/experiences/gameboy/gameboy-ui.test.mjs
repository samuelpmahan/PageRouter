import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8');
const player = readFileSync(fileURLToPath(new URL('./player.js', import.meta.url)), 'utf8');

function createPlayerHarness() {
  const windowListeners = new Map();
  const buttonListeners = new Map();
  const frames = [];
  const timers = new Map();
  const inputs = [];
  let now = 0;
  let nextTimerId = 1;
  const button = {
    getAttribute(name) { return name === 'data-btn' ? 'left' : null; },
    addEventListener(type, listener) { buttonListeners.set(type, listener); },
  };
  const canvas = { getContext() { return {}; } };
  const document = {
    getElementById(id) { return id === 'screen' ? canvas : null; },
    querySelectorAll() { return [button]; },
  };
  const window = {
    ROM: {
      tick(input) { inputs.push({ ...input }); },
      draw() {},
    },
  };
  const sandbox = {
    window,
    document,
    location: { pathname: '/compiled/pxcube/experiences/gameboy/index.html' },
    performance: { now: () => now },
    requestAnimationFrame(callback) { frames.push(callback); },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    setTimeout(callback, delay) { const id = nextTimerId++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(player, sandbox, { filename: 'player.js' });
  return {
    buttonListeners, windowListeners, inputs, timers,
    frame(time) {
      now = time;
      const callback = frames.shift();
      assert.equal(typeof callback, 'function', 'the player schedules another frame');
      callback(time);
    },
  };
}

test('Game Boy shell exposes a labeled in-cartridge picker and accessible screen status', () => {
  assert.match(html, /<select[^>]*id="cartridge-select"[^>]*aria-label="Choose cartridge"/);
  assert.match(html, /<button[^>]*id="load-cartridge"[^>]*disabled/);
  assert.match(html, /id="cartridge-picker-status"[^>]*role="status"/);
  assert.match(html, /id="game-status"[^>]*aria-live="polite"/);
});

test('Game Boy shell loads its shared renderer before the selected ROM', () => {
  const rendererAt = html.indexOf('<script src="./connect4-ui.js"></script>');
  const playerAt = html.indexOf('<script src="./player.js"></script>');
  const romAt = html.indexOf('<script src="./rom.js"></script>');
  assert.ok(rendererAt >= 0 && playerAt > rendererAt && romAt > playerAt);
});

test('a short d-pad click remains pressed long enough for one 60 Hz Game Boy tick', () => {
  const harness = createPlayerHarness();
  const event = { preventDefault() {} };
  harness.buttonListeners.get('pointerdown')(event);
  harness.buttonListeners.get('pointerup')(event);

  harness.frame(17);

  assert.equal(harness.inputs[0].left, true, 'the immediate click press must reach the next emulated tick');
  const release = [...harness.timers.values()][0];
  assert.ok(release.delay >= 1000 / 60, 'a click stays pressed through at least one fixed-step frame');
  release.callback();
  harness.frame(34);
  assert.equal(harness.inputs[1].left, false, 'the transient press is released after the next tick window');
});

test('a short keyboard tap remains pressed long enough for one 60 Hz Game Boy tick', () => {
  const harness = createPlayerHarness();
  const event = { code: 'ArrowLeft', target: { closest() { return null; } }, preventDefault() {} };
  harness.windowListeners.get('keydown')(event);
  harness.windowListeners.get('keyup')(event);

  harness.frame(17);

  assert.equal(harness.inputs[0].left, true, 'the keydown edge reaches the next emulated tick');
});
