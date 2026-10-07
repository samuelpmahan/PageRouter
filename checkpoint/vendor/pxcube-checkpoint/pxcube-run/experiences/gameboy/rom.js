// The bare cartridge: no game inserted. An overlay's rom.js shadows this file,
// which is exactly how a Game Boy behaves when you slot a game in.
window.ROM = {
  tick: function () {},
  draw: function (ctx) {
    ctx.fillStyle = '#9bbc0f';
    ctx.fillRect(0, 0, 160, 144);
    ctx.fillStyle = '#0f380f';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NO CARTRIDGE', 80, 64);
    ctx.fillText('compose a ROM over', 80, 82);
    ctx.fillText('this base to play', 80, 92);
  },
};
