// PxC cartridge adapter. Input is dispatched into actual Parts; pixels come
// only from the cached declarative tree returned by runtime.seek().
(function () {
  'use strict';
  window.ROM = window.GameBoyConnect4UI.createConnect4ROM(function (initialState) {
    return Promise.all([
      import('./model.mjs'),
      import('./pxc.mjs'),
    ]).then(function (modules) {
      return modules[0].createConnect4PxCRuntime({
        initialState: initialState,
        Part: modules[1].Part,
        PxC: modules[1].PxC,
      });
    });
  }, document.getElementById('game-status'));
})();
