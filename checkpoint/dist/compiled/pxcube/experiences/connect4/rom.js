// Baseline cartridge adapter: all playable UI is rendered from model.seek().
(function () {
  'use strict';
  window.ROM = window.GameBoyConnect4UI.createConnect4ROM(function (initialState) {
    return import('./model.mjs').then(function (model) {
      return model.createConnect4PlainRuntime({ initialState: initialState });
    });
  }, document.getElementById('game-status'));
})();
