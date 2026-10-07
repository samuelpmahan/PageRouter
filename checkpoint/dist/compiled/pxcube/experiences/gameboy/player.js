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

  // The loader is driven by the package's registration-derived catalog. It
  // never guesses sibling paths or lets a free-form value become navigation.
  var cartSelect = document.getElementById('cartridge-select');
  var loadCart = document.getElementById('load-cartridge');
  var cartStatus = document.getElementById('cartridge-picker-status');
  var cartridges = [];
  function cartMessage(message) {
    if (cartStatus) cartStatus.textContent = message;
  }
  function selectedCartPath() {
    var ui = window.GameBoyConnect4UI;
    return ui && typeof ui.cartridgePath === 'function' ? ui.cartridgePath(cartSelect && cartSelect.value, cartridges) : null;
  }
  function loadCartridgeCatalog() {
    if (!cartSelect || !loadCart || typeof fetch !== 'function') {
      cartMessage('Cartridge loading is unavailable in this browser.');
      return;
    }
    fetch('./cartridges.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('Cartridge catalog unavailable');
        return response.json();
      })
      .then(function (catalog) {
        var ui = window.GameBoyConnect4UI;
        if (!ui || typeof ui.normalizeCartridgeCatalog !== 'function') throw new Error('Cartridge catalog validator unavailable');
        cartridges = ui.normalizeCartridgeCatalog(catalog);
        cartSelect.replaceChildren();
        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = cartridges.length ? 'Choose a cartridge…' : 'No registered cartridges';
        placeholder.disabled = true;
        placeholder.selected = true;
        cartSelect.appendChild(placeholder);
        cartridges.forEach(function (cart) {
          var option = document.createElement('option');
          option.value = cart.id;
          option.textContent = cart.title;
          cartSelect.appendChild(option);
        });
        cartSelect.disabled = cartridges.length === 0;
        if (cartridges.some(function (cart) { return cart.id === game; })) cartSelect.value = game;
        loadCart.disabled = !selectedCartPath();
        cartMessage(cartridges.length ? cartridges.length + ' registered cartridges. Choose one to switch.' : 'No registered cartridges are available.');
      })
      .catch(function () {
        if (cartSelect) cartSelect.disabled = true;
        if (loadCart) loadCart.disabled = true;
        cartMessage('Could not load the registered cartridge list.');
      });
  }
  if (cartSelect && loadCart) {
    cartSelect.addEventListener('change', function () { loadCart.disabled = !selectedCartPath(); });
    loadCart.addEventListener('click', function () {
      var path = selectedCartPath();
      if (!path) {
        cartMessage('Choose a registered cartridge first.');
        return;
      }
      var selected = cartridges.find(function (cart) { return cart.id === cartSelect.value; });
      cartMessage('Loading ' + (selected ? selected.title : 'cartridge') + '…');
      location.assign(new URL(path, location.href).href);
    });
  }
  loadCartridgeCatalog();

  var input = { up: false, down: false, left: false, right: false, a: false, b: false, start: false, select: false };
  var inputReleaseTimers = Object.create(null);
  // A click can begin and end between two 60 Hz frames. Keep it visible to
  // the next fixed-step tick, while preserving held-input behavior.
  var MIN_PRESS_MS = 34;
  function pressInput(key) {
    if (inputReleaseTimers[key]) {
      clearTimeout(inputReleaseTimers[key]);
      delete inputReleaseTimers[key];
    }
    input[key] = true;
  }
  function releaseInput(key) {
    if (inputReleaseTimers[key]) clearTimeout(inputReleaseTimers[key]);
    inputReleaseTimers[key] = setTimeout(function () {
      input[key] = false;
      delete inputReleaseTimers[key];
    }, MIN_PRESS_MS);
  }
  var keymap = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    KeyX: 'a', KeyZ: 'b', Enter: 'start', ShiftLeft: 'select', ShiftRight: 'select',
  };
  addEventListener('keydown', function (e) {
    if (e.target && e.target.closest && e.target.closest('#cartridge-picker')) return;
    var k = keymap[e.code];
    if (k) { pressInput(k); e.preventDefault(); }
  });
  addEventListener('keyup', function (e) {
    var k = keymap[e.code];
    if (k) releaseInput(k);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-btn]'), function (el) {
    var k = el.getAttribute('data-btn');
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); pressInput(k); });
    var off = function (e) { e.preventDefault(); releaseInput(k); };
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
