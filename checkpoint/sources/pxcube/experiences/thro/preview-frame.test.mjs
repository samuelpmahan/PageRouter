import test from 'node:test';
import assert from 'node:assert/strict';
const preview = await import('./preview-frame.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
test('alpha bounds use actual nontransparent pixels, including translucent edges', () => {
  assert.equal(typeof preview.alphaBounds, 'function', 'alpha bounds helper is implemented');
  const data = new Uint8ClampedArray(4 * 5 * 4);
  data[(1 * 4 + 1) * 4 + 3] = 1;
  data[(3 * 4 + 2) * 4 + 3] = 255;
  assert.deepEqual(preview.alphaBounds({ width:4, height:5, data }), { x:1, y:1, width:2, height:3 });
  assert.equal(preview.alphaBounds({ width:4, height:5, data:new Uint8ClampedArray(data.length) }), null);
});
test('artwork fit centers the real bounds while preserving scale and the complete artwork', () => {
  assert.equal(typeof preview.fitArtwork, 'function', 'artwork fit helper is implemented');
  const bounds={ x:48, y:712, width:304, height:458 };
  const fit=preview.fitArtwork({canvasWidth:1080,canvasHeight:1920,bounds,width:326,height:240,padding:12});
  assert.equal(fit.scale,216/458);
  assert.equal(fit.y+bounds.y*fit.scale,12);
  assert.equal(fit.x+(bounds.x+bounds.width/2)*fit.scale,163);
  assert.ok(bounds.width*fit.scale>=120);
  assert.ok(bounds.height*fit.scale>=180);
});
test('invalid or out-of-canvas geometry cannot silently frame another image', () => {
  assert.equal(typeof preview.fitArtwork, 'function', 'artwork fit helper is implemented');
  for(const bounds of [{x:-1,y:0,width:1,height:1},{x:0,y:0,width:1081,height:1},{x:0,y:0,width:0,height:1}]){
    assert.throws(()=>preview.fitArtwork({canvasWidth:1080,canvasHeight:1920,bounds,width:326,height:240,padding:12}));
  }
});
