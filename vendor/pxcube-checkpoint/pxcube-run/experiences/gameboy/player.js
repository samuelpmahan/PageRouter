// The Game Boy cartridge player: input, fixed-step loop, save RAM.
//
// A ROM is window.ROM = { tick(input, save), draw(ctx, save) }.
//   input: { up, down, left, right, a, b, start, select } — booleans.
//   save:  { get(key), set(key, value) } — JSON values in save RAM,
//          namespaced per cartridge so one game's saves never touch another's.
//   ctx:   2D context on the 160x144 screen.
//
// The cartridge is immutable (content-addressed chunks, precached offline);
// only save RAM persists. That is the whole Game Boy contract.
(function () {
  'use strict';
  var canvas = document.getElementById('screen');
  var ctx = canvas.getContext('2d');
  var match = location.pathname.match(/experiences\/([^/]+)/);
  var game = (match && match[1]) || 'cartridge';
  var prefix = 'pxcube:cartridge:' + game + ':';
  var save = {
    get: function (k) {
      try { return JSON.parse(localStorage.getItem(prefix + k) || 'null'); }
      catch (e) { return null; }
    },
    set: function (k, v) {
      try { localStorage.setItem(prefix + k, JSON.stringify(v)); }
      catch (e) { /* save RAM full or unavailable; the game plays on */ }
    },
  };

  var input = { up: false, down: false, left: false, right: false, a: false, b: false, start: false, select: false };
  var keymap = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    KeyX: 'a', KeyZ: 'b', Enter: 'start', ShiftLeft: 'select', ShiftRight: 'select',
  };
  addEventListener('keydown', function (e) {
    var k = keymap[e.code];
    if (k) { input[k] = true; e.preventDefault(); }
  });
  addEventListener('keyup', function (e) {
    var k = keymap[e.code];
    if (k) input[k] = false;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-btn]'), function (el) {
    var k = el.getAttribute('data-btn');
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); input[k] = true; });
    var off = function (e) { e.preventDefault(); input[k] = false; };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  });

  var acc = 0, last = performance.now(), STEP = 1000 / 60;
  function frame(now) {
    acc += Math.min(now - last, 250);
    last = now;
    // Resolved lazily so the ROM registers whenever its script runs,
    // regardless of tag order. A missing ROM just idles the console.
    var rom = window.ROM;
    if (rom) {
      while (acc >= STEP) { rom.tick(input, save); acc -= STEP; }
      rom.draw(ctx, save);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
