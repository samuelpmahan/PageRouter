import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('opening an Experience collapses workspace chrome but keeps its trigger', () => {
  const shell = fs.readFileSync('launcher/shell.mjs', 'utf8');
  const css = fs.readFileSync('launcher/shell.css', 'utf8');
  assert.match(shell, /OneStepOneViewport/);
  assert.match(shell, /setControlDrawerCollapsed\(true, \{ remember: false \}\)/);
  assert.match(shell, /showView\('experiences'\);[\s\S]*setControlDrawerCollapsed\(false, \{ remember: false \}\)/);
  assert.match(css, /body\.controls-collapsed #navigation,body\.controls-collapsed #ntc-strip,body\.controls-collapsed #bar\{display:none\}/);
  assert.match(css, /body\.controls-collapsed #control-drawer-toggle\{pointer-events:auto/);
});

test('the review checklist wrapper cannot shield the active Experience', () => {
  const checklist = fs.readFileSync('vendor/neat/tick-part-checklist.js', 'utf8');
  assert.match(checklist, /:host\{pointer-events:none!important\}/);
  assert.match(checklist, /\.w\{pointer-events:none!important\}/);
  assert.match(checklist, /\.w>button,.w>section\{pointer-events:auto!important\}/);
  assert.match(checklist, /\.w\.c\{position:static;left:auto;top:auto;right:auto;bottom:auto\}/);
});

test('the crop step keeps primary controls in one viewport', () => {
  const html = fs.readFileSync('vendor/studio/upload-disc-to-shelf/index.html', 'utf8');
  const css = fs.readFileSync('vendor/studio/upload-disc-to-shelf/style.css', 'utf8');
  assert.match(html, /<div class="crop-quick"/);
  assert.match(html, /<details class="crop-fine">/);
  assert.match(css, /#photo-crop\{[^}]*overflow:hidden/);
  assert.match(css, /\.crop-shell\{[^}]*100dvh/);
  assert.match(css, /\.crop-stage\{[^}]*touch-action:none/);
  assert.match(html, /id="crop-center-x"/);
  assert.match(html, /id="crop-center-y"/);
  assert.match(html, /id="crop-radius-x"/);
  assert.match(html, /id="crop-radius-y"/);
  assert.match(html, /Drag inside the ellipse to move it; drag its edge to resize/);
  assert.match(css, /\.crop-stage::before,\.crop-stage::after\{display:none\}/);
  assert.match(css, /\.crop-stage\{[^}]*width:100%;max-width:100%;height:100%;max-height:100%/);
  assert.doesNotMatch(css, /crop-stage\{width:min\(100%,(?:310px|clamp\([^)]*255px\)\))/);
  for (const delta of ['-10', '-5', '-3', '-1', '1', '3', '5', '10']) assert.match(html, new RegExp(`data-zoom-delta="${delta}"`));
  assert.doesNotMatch(html, /crop-zoom-(?:out|in)/);
  const correctionStrip = html.match(/<div class="crop-quick"[\s\S]*?<\/div><details class="crop-fine">/)?.[0] ?? '';
  assert.doesNotMatch(correctionStrip, /type="range"/);
  assert.match(css, /\.crop-quick\{[^}]*display:flex/);
  assert.match(css, /\.crop-zoom\{[^}]*repeat\(8/);
});

test('the design principle requires same-viewport result verification', () => {
  const principles = fs.readFileSync('docs/design-principles.md', 'utf8');
  assert.match(principles, /OTOV2: One Task, One Viewport, Verifiable/);
  assert.match(principles, /evidence of its result in one viewport/);
  assert.match(principles, /shading the area that will be trimmed/);
});
