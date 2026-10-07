import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'vendor/studio/upload-disc-to-shelf';
const html = fs.readFileSync(`${root}/index.html`, 'utf8');
const ui = fs.readFileSync(`${root}/upload-ui.ts`, 'utf8');
const paintRecipe = fs.readFileSync(`${root}/paint-recipe.ts`, 'utf8');
const view = fs.readFileSync(`${root}/disc-view.ts`, 'utf8');

test('UploadDiscToShelf keeps the photo affordance at the top compose controls', () => {
  assert.match(html, /label class="file-button add-photo">＋ Add photo<input id="photo"/);
  assert.match(html, /accept="image\/\*" capture="environment"/);
  assert.match(html, /id="photo-crop"/);
  assert.match(html, /id="crop-center-x"/);
  assert.match(html, /id="crop-center-y"/);
  assert.match(html, /id="crop-radius-x"/);
  assert.match(html, /id="crop-radius-y"/);
  assert.match(html, /id="crop-scale-x"/);
  assert.match(html, /id="crop-scale-y"/);
  assert.match(html, /id="crop-apply"[^>]*>Use photo/);
  assert.match(html, /id="crop-cancel"/);
  assert.match(html, /id="crop-auto"[^>]*>Auto-fit/);
  assert.match(html, /class="crop-fine"><summary>Fine tune ellipse/);
  assert.match(html, /id="crop-preview"[^>]*canvas|<canvas id="crop-preview"/);
});

test('crop interaction stays transient and frame-coalesced until confirmation', () => {
  assert.match(ui, /requestAnimationFrame/);
  assert.match(ui, /cropWorking/);
  assert.match(ui, /cropStage\.addEventListener\('pointermove'/);
  assert.match(ui, /detectDiscCircle/);
  assert.match(ui, /crop-apply[\s\S]*photo = \{ kind: 'photo'/);
});

test('photo preparation enters photo mode and protects the original file', () => {
  assert.match(ui, /photo = \{ kind: 'photo', name: fileName, src:/);
  assert.match(ui, /depiction = photo/);
  assert.match(ui, /Photo cropped locally\. The original file is unchanged\./);
  assert.match(ui, /input\('color-painting'\)\.disabled = depiction\.kind === 'photo'/);
});

test('photo mode explains that flight numbers remain available while photo art stays untouched', () => {
  assert.match(ui, /FLIGHT  \$\{flightFields\.map/);
  assert.match(ui, /Photos stay untouched; mode changes the backing only\./);
  assert.match(paintRecipe, /const photoPattern = \/\^data:image/);
  assert.match(paintRecipe, /if \(choice === 'photo'\).*?return photo\.src/s);
});

test('photo depiction is labeled as a photo and does not invoke the painting renderer', () => {
  assert.match(view, /image\.kind === 'photo' \? 'Photo' : 'Painting'/);
  assert.match(view, /savedArt \?\? renderDiscPainting/);
  assert.match(view, /image\.kind === 'photo' \? ' photo-art' : ''/);
});

test('applying enters photo mode while cancelling discards only pending crop state', () => {
  assert.match(ui, /photo = \{ kind: 'photo'/);
  assert.match(ui, /depiction = photo/);
  assert.match(ui, /crop-cancel[\s\S]*discardPendingPhoto/);
  assert.doesNotMatch(ui.match(/crop-cancel[\s\S]{0,500}/)?.[0] ?? '', /photo\s*=\s*null/);
});

test('photo export is circular and the photo view drops the decorative backing', () => {
  assert.match(ui, /ctx\.ellipse\(size \/ 2, size \/ 2, size \/ 2/);
  assert.match(ui, /mapping\.sourceWidth/);
  assert.match(ui, /mapping\.sourceHeight/);
  assert.match(ui, /ctx\.clip\(\)/);
  assert.match(view, /if \(image\.kind !== 'photo'\) art\.style\.background/);
});

test('photo mode keeps underglow available while structurally hiding painting controls', () => {
  assert.match(html, /class="pair colors painting-only"/);
  assert.match(html, /class="pair painting-only"><label>Paint mode/);
  assert.match(html, /class="painting-only">Painted rim/);
  assert.match(html, /class="pair painting-only"><label>Stamp left \/ right/);
  assert.match(html, /class="pair painting-only"><button id="shuffle"/);
  assert.match(html, /class="painting-only">Painting seed/);
  assert.match(html, /class="check label-toggle painting-only"/);
  assert.match(html, /<label>Underglow<input id="underglow"/);
  assert.match(ui, /const paintingControls = \[\.\.\.root\.querySelectorAll<HTMLElement>\('\.painting-only'\)\]/);
  assert.match(ui, /const photoMode = depiction\.kind === 'photo'/);
  assert.match(ui, /control\.hidden = photoMode/);
  assert.match(ui, /root\.classList\.toggle\('photo-mode', photoMode\)/);
});
