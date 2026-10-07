// Shared Game Boy canvas renderer for the declarative Connect Four seek tree.
(function () {
  'use strict';

  var COLORS = Object.freeze({
    light: '#9bbc0f',
    gold: '#7a4b00',
    dark: '#306230',
    darkest: '#0f380f',
  });
  var BOARD_X = 13, BOARD_Y = 32, CELL_X = 18, CELL_Y = 14;

  function validateTree(tree) {
    var attrs = tree && tree.attrs;
    if (!tree || tree.tag !== 'connect4-screen' || !attrs || !Array.isArray(tree.children)) {
      throw new TypeError('Connect Four seek tree must be a connect4-screen node.');
    }
    if (!['playing', 'won', 'draw'].includes(attrs.phase)) throw new TypeError('Connect Four tree has an invalid phase.');
    if (attrs.currentPlayer !== null && attrs.currentPlayer !== 'red' && attrs.currentPlayer !== 'yellow') {
      throw new TypeError('Connect Four tree has an invalid current player.');
    }
    if (attrs.winner !== null && attrs.winner !== 'red' && attrs.winner !== 'yellow') {
      throw new TypeError('Connect Four tree has an invalid winner.');
    }
    if (!Number.isInteger(attrs.cursorColumn) || attrs.cursorColumn < 0 || attrs.cursorColumn > 6) {
      throw new TypeError('Connect Four tree has an invalid cursor column.');
    }
    if (typeof attrs.statusText !== 'string' || typeof attrs.hintText !== 'string') {
      throw new TypeError('Connect Four tree needs statusText and hintText strings.');
    }
    var board = tree.children.length === 1 ? tree.children[0] : null;
    if (!board || board.tag !== 'board' || !board.attrs || board.attrs.rows !== 6 || board.attrs.columns !== 7 ||
        !Array.isArray(board.children) || board.children.length !== 6) {
      throw new TypeError('Connect Four tree must contain one 6 by 7 board.');
    }
    board.children.forEach(function (row, rowIndex) {
      if (!row || row.tag !== 'row' || !row.attrs || row.attrs.row !== rowIndex || !Array.isArray(row.children) || row.children.length !== 7) {
        throw new TypeError('Connect Four tree must contain 7 cells in each of 6 rows.');
      }
      row.children.forEach(function (cell, columnIndex) {
        var cellAttrs = cell && cell.attrs;
        if (!cell || cell.tag !== 'cell' || !cellAttrs || cellAttrs.row !== rowIndex || cellAttrs.column !== columnIndex ||
            ![null, 'red', 'yellow'].includes(cellAttrs.player) || typeof cellAttrs.preview !== 'boolean') {
          throw new TypeError('Connect Four tree contains an invalid board cell.');
        }
      });
    });
    return { attrs: attrs, board: board };
  }

  function drawConnect4Tree(ctx, tree) {
    var validated = validateTree(tree);
    var attrs = validated.attrs;
    ctx.fillStyle = COLORS.light;
    ctx.fillRect(0, 0, 160, 144);

    ctx.fillStyle = COLORS.darkest;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CONNECT 4', 80, 9);
    ctx.fillStyle = COLORS.dark;
    ctx.font = '7px monospace';
    ctx.fillText(attrs.statusText, 80, 19);

    // The filled cartridge-blue panel frames all 42 wells.
    ctx.fillStyle = COLORS.dark;
    ctx.fillRect(BOARD_X, BOARD_Y, 134, 91);
    if (attrs.phase === 'playing') {
      var cursorX = BOARD_X + 10 + attrs.cursorColumn * CELL_X;
      ctx.fillStyle = COLORS.darkest;
      ctx.font = '8px monospace';
      ctx.fillText('▼', cursorX, 30);
    }

    validated.board.children.forEach(function (row, rowIndex) {
      row.children.forEach(function (cell, columnIndex) {
        var cellAttrs = cell.attrs;
        var x = BOARD_X + 10 + columnIndex * CELL_X;
        var y = BOARD_Y + 10 + rowIndex * CELL_Y;
        var player = cellAttrs.player || (cellAttrs.preview ? attrs.currentPlayer : null);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        if (player === 'red') ctx.fillStyle = COLORS.darkest;
        else if (player === 'yellow') ctx.fillStyle = COLORS.gold;
        else ctx.fillStyle = COLORS.light;
        ctx.fill();
        // A strong outline gives the gold player token a crisp boundary
        // against the light green wells even on a small, scaled canvas.
        ctx.lineWidth = cellAttrs.preview || player === 'yellow' ? 2 : 1;
        ctx.strokeStyle = COLORS.darkest;
        ctx.stroke();

        // A small light glint makes the two monochrome disc colors easier to distinguish.
        if (player === 'yellow') {
          ctx.fillStyle = COLORS.light;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      });
    });

    ctx.fillStyle = COLORS.darkest;
    ctx.font = '6px monospace';
    ctx.fillText(attrs.hintText, 80, 138);
  }

  function updateAccessibleStatus(element, tree) {
    if (!element) return;
    var attrs = validateTree(tree).attrs;
    element.textContent = [attrs.statusText, attrs.hintText].filter(Boolean).join('. ');
    element.setAttribute('data-phase', attrs.phase);
    element.setAttribute('data-cursor-column', String(attrs.cursorColumn));
    if (attrs.currentPlayer) element.setAttribute('data-current-player', attrs.currentPlayer);
    else element.removeAttribute('data-current-player');
  }

  function drawPlaceholder(ctx, message) {
    ctx.fillStyle = COLORS.light;
    ctx.fillRect(0, 0, 160, 144);
    ctx.fillStyle = COLORS.darkest;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CONNECT 4', 80, 62);
    ctx.font = '7px monospace';
    ctx.fillText(message, 80, 80);
  }

  function normalizeCartridgeCatalog(value) {
    var raw = value && value.cartridges;
    if (!Array.isArray(raw)) return Object.freeze([]);
    var seen = Object.create(null);
    var result = [];
    raw.forEach(function (item) {
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(item.id) ||
          typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 || seen[item.id]) return;
      seen[item.id] = true;
      result.push(Object.freeze({ id: item.id, title: item.title.trim() }));
    });
    return Object.freeze(result);
  }

  function cartridgePath(id, catalog) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(id) || !Array.isArray(catalog)) return null;
    return catalog.some(function (item) { return item && item.id === id; }) ? '../' + id + '/index.html' : null;
  }

  function createConnect4ROM(loadRuntime, statusElement) {
    if (typeof loadRuntime !== 'function') throw new TypeError('Connect Four ROM needs a runtime loader.');
    var runtime = null;
    var seekTree = null;
    var saveRam = null;
    var started = false;
    var busy = false;
    var failure = false;
    var previousA = false;
    var previousStart = false;
    var heldDirection = 0;
    var repeatTicks = 0;

    function showError() {
      failure = true;
      if (!statusElement) return;
      statusElement.textContent = 'Connect Four could not continue. Reload to try again.';
      statusElement.setAttribute('data-phase', 'error');
      statusElement.removeAttribute('data-current-player');
    }

    function publish(tree) {
      seekTree = tree;
      updateAccessibleStatus(statusElement, tree);
    }

    function start(save) {
      if (started) return;
      started = true;
      saveRam = save || null;
      var snapshot = null;
      try { if (saveRam && typeof saveRam.get === 'function') snapshot = saveRam.get('connect4'); }
      catch (_) { snapshot = null; }
      Promise.resolve()
        .then(function () { return loadRuntime(snapshot); })
        .then(function (loaded) {
          if (!loaded || typeof loaded.dispatch !== 'function' || typeof loaded.seek !== 'function' || typeof loaded.state !== 'function') {
            throw new TypeError('Connect Four runtime is missing dispatch(), seek(), or state().');
          }
          runtime = loaded;
          return runtime.seek();
        })
        .then(publish)
        .catch(showError);
    }

    function saveState() {
      try {
        if (saveRam && typeof saveRam.set === 'function') saveRam.set('connect4', runtime.state());
      } catch (_) { /* The match remains playable if save RAM is unavailable. */ }
    }

    function dispatchEvents(events) {
      if (!runtime || busy || !events.length) return;
      busy = true;
      Promise.resolve().then(async function () {
        for (var i = 0; i < events.length; i++) {
          await runtime.dispatch(events[i]);
          saveState();
          publish(await runtime.seek());
        }
      }).catch(showError).finally(function () { busy = false; });
    }

    function tick(input, save) {
      input = input || {};
      start(save);
      var left = !!input.left, right = !!input.right;
      var direction = left === right ? 0 : left ? -1 : 1;
      var move = 0;
      if (!direction) {
        heldDirection = 0;
        repeatTicks = 0;
      } else if (direction !== heldDirection) {
        heldDirection = direction;
        repeatTicks = 0;
        move = direction;
      } else if (++repeatTicks >= 8) {
        repeatTicks = 0;
        move = direction;
      }

      var startPressed = !!input.start && !previousStart;
      var dropPressed = !!input.a && !previousA;
      previousStart = !!input.start;
      previousA = !!input.a;
      if (startPressed) dispatchEvents([{ type: 'reset' }]);
      else {
        var events = [];
        if (move) events.push({ type: 'move', delta: move });
        if (dropPressed) events.push({ type: 'drop' });
        dispatchEvents(events);
      }
    }

    function draw(ctx) {
      if (failure) drawPlaceholder(ctx, 'RELOAD TO RETRY');
      else if (seekTree) drawConnect4Tree(ctx, seekTree);
      else drawPlaceholder(ctx, 'LOADING…');
    }

    return Object.freeze({ tick: tick, draw: draw });
  }

  window.GameBoyConnect4UI = Object.freeze({
    drawConnect4Tree: drawConnect4Tree,
    updateAccessibleStatus: updateAccessibleStatus,
    drawPlaceholder: drawPlaceholder,
    normalizeCartridgeCatalog: normalizeCartridgeCatalog,
    cartridgePath: cartridgePath,
    createConnect4ROM: createConnect4ROM,
  });
})();
