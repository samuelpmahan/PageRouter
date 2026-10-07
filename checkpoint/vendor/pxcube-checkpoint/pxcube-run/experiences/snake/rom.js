// Snake ROM for the Game Boy cartridge base. This file shadows the base's
// rom.js at package time: base + overlay compose into one cartridge.
window.ROM = (function () {
  'use strict';
  var W = 20, H = 16, CELL = 8, TOP = 16; // HUD strip on top, field below
  var LIGHT = '#9bbc0f', MID = '#8bac0f', DARK = '#306230', DARKEST = '#0f380f';
  var STEP_EVERY = 8; // player ticks at 60Hz; the snake moves ~7.5 cells/sec

  var snake, dir, pending, food, alive, score, best, clock;

  function placeFood() {
    for (;;) {
      var f = { x: (Math.random() * W) | 0, y: (Math.random() * H) | 0 };
      var hit = false;
      for (var i = 0; i < snake.length; i++) {
        if (snake[i].x === f.x && snake[i].y === f.y) { hit = true; break; }
      }
      if (!hit) { food = f; return; }
    }
  }
  function reset() {
    snake = [{ x: 10, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 8 }];
    dir = { x: 1, y: 0 };
    pending = { x: 1, y: 0 };
    score = 0;
    clock = 0;
    alive = true;
    placeFood();
  }
  reset();

  function step() {
    dir = pending;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    var crashed = head.x < 0 || head.y < 0 || head.x >= W || head.y >= H;
    for (var i = 0; !crashed && i < snake.length; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) crashed = true;
    }
    if (crashed) { alive = false; return; }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) { score++; placeFood(); }
    else snake.pop();
  }

  return {
    tick: function (input, save) {
      if (best === undefined) best = save.get('high') || 0;
      if (!alive) {
        if (score > best) { best = score; save.set('high', best); }
        if (input.start || input.a) reset();
        return;
      }
      if (input.up && dir.y !== 1) pending = { x: 0, y: -1 };
      else if (input.down && dir.y !== -1) pending = { x: 0, y: 1 };
      else if (input.left && dir.x !== 1) pending = { x: -1, y: 0 };
      else if (input.right && dir.x !== -1) pending = { x: 1, y: 0 };
      if (++clock >= STEP_EVERY) { clock = 0; step(); }
    },
    draw: function (ctx, save) {
      if (best === undefined) best = save.get('high') || 0;
      ctx.fillStyle = LIGHT;
      ctx.fillRect(0, 0, 160, 144);
      ctx.fillStyle = DARKEST;
      var i;
      for (i = 0; i < snake.length; i++) {
        ctx.fillRect(snake[i].x * CELL, TOP + snake[i].y * CELL, CELL, CELL);
      }
      ctx.fillStyle = DARK;
      ctx.fillRect(food.x * CELL + 2, TOP + food.y * CELL + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = DARKEST;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('SCORE ' + score + ' BEST ' + Math.max(best, score), 4, 11);
      if (!alive) {
        ctx.fillStyle = MID;
        ctx.fillRect(28, 58, 104, 34);
        ctx.fillStyle = DARKEST;
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', 80, 72);
        ctx.fillText('START TO RETRY', 80, 84);
      }
    },
  };
})();
