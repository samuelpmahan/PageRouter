import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const compositions = fs.readFileSync('local/studio-demo/compositions.mjs', 'utf8');
const graphics = fs.readFileSync('local/studio-demo/graphics.mjs', 'utf8');
const app = fs.readFileSync('local/studio-demo/app.mjs', 'utf8');
const index = fs.readFileSync('local/studio-demo/index.html', 'utf8');
const css = fs.readFileSync('local/studio-demo/style.css', 'utf8');
const buildStudio = fs.readFileSync('local/build-studio.mjs', 'utf8');

test('CreateGraphics exposes nine authored compositions and real rendered output', () => {
  const ids = [...compositions.matchAll(/\{id:'([^']+)',name:/g)].map(match => match[1]);
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, 9);
  assert.match(app, /Compare 9 compositions/);
  assert.match(app, /actual rendered SVG/);
  assert.match(app, /Illustrative background — not to scale\. Graphic dimensions are exact\./);
  assert.doesNotMatch(app, /Add image|image placeholder/i);
  assert.doesNotMatch(compositions, /Add image|image placeholder/i);
});

test('CreateGraphics keeps selection, reversible controls, and explicit Keep in the task viewport', () => {
  for (const id of ['graphic-title', 'accent', 'background', 'foreground', 'orientation', 'placement', 'frame']) {
    assert.match(app, new RegExp(`id="${id}"`));
  }
  assert.match(app, /id="keep-graphic"[^>]*>Keep for ExportGraphics/);
  assert.match(app, /Live edits stay reversible until you keep it/);
  assert.match(app, /class="workspace two create-workspace"/);
  assert.match(app, /class="step-kicker">01 · choose/);
  assert.match(app, /class="step-kicker">02 · verify/);
  assert.match(app, /class="step-kicker">03 · finish/);
  assert.match(app, /class="mobile-step-nav"[^>]*role="tablist"/);
  assert.match(app, /data-create-step="choose"[^>]*aria-selected/);
  assert.match(app, /data-create-step="verify"[^>]*aria-selected/);
  assert.match(app, /data-create-step="finish"[^>]*aria-selected/);
  assert.match(app, /data-create-step="choose"[^>]*aria-expanded/);
  assert.match(app, /applyCreateStep=step=>/);
  assert.match(css, /\.create-workspace>\[data-create-panel\]\{display:none!important\}/);
  assert.match(css, /\.create-workspace>\[data-create-panel\]\.is-active\{display:flex!important/);
  assert.match(css, /\.mobile-step-nav button\{min-height:44px/);
  assert.match(css, /\.create-workspace\{[^}]*grid-template-columns/);
  assert.match(css, /#card-study\{[^}]*overflow:hidden/);
  assert.match(css, /#study-cards\{[^}]*grid-template-rows:repeat\(3/);
  assert.match(css, /\.study-card\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(index, /id="study-detail-copy"/);
  assert.doesNotMatch(app, /class="study-note"/);
  assert.match(css, /\.study-card\[aria-pressed=true\]/);
  assert.match(app, /className='verify-size'/);
});

test('CreateGraphics exposes discrete geometry tuning in the shared render calculation', () => {
  for (const id of ['composition-size', 'composition-scale-nudge', 'composition-offset-x', 'composition-offset-y']) {
    assert.match(app, new RegExp(`id="${id}"`));
  }
  assert.match(app, /Bottom center · lower third/);
  assert.match(app, /Assisted preset first; exact percentage and export-pixel nudges/);
  assert.doesNotMatch(compositions, /id:'crest',[^\n]*preferredSize:'full-width'/);
  assert.match(graphics, /compositionSizeStudies/);
  assert.match(graphics, /compositionScaleNudges/);
  assert.match(graphics, /compositionOffsetNudges/);
  assert.match(graphics, /envelopeWidth:640,envelopeHeight:270/);
  assert.match(graphics, /envelopeWidth:768,envelopeHeight:324/);
  assert.match(compositions, /compositionHardMax/);
  assert.match(graphics, /anchor==='bottom-center'\?'bottom-left':anchor/);
  assert.match(graphics, /Number\(design\.compositionOffsetX\)\|\|0/);
  assert.doesNotMatch(app, /type="range"[^>]*composition/);
  assert.match(index, /id="use-study"[^>]*>Use this composition/);
  assert.match(app, /renderStudySelection/);
});

test('ExportGraphics keeps one immutable capture and one explicit browser download decision visible', () => {
  assert.match(app, /function drawExportPolished\(\)/);
  assert.match(app, /class="workspace two export-workspace/);
  assert.match(app, /Capture SHA-256/);
  assert.match(app, /Filename ·/);
  assert.match(app, /Download this image/);
  assert.match(app, /browser decides where the file is saved/);
  assert.match(app, /← Previous/);
  assert.match(app, /Next →/);
  assert.match(css, /\.export-workspace\{[^}]*height:min/);
  assert.match(css, /\.export-facts\{[^}]*display:grid/);
  assert.match(css, /\.export-result\{[^}]*margin-top:auto/);
});

test('retained calculation drift has explicit working and frozen restore policies', () => {
  assert.match(buildStudio, /mode\?: .*working/);
  assert.match(buildStudio, /const working = options\.mode/);
  assert.match(buildStudio, /immutableCalculations\?: string\[\]/);
  assert.match(fs.readFileSync('local/studio-demo/model.mjs', 'utf8'), /immutableCalculations:\['fn\.studio\.capture','fn\.studio\.competitionCapture'\]/);
  assert.match(buildStudio, /!working/);
  assert.match(buildStudio, /parts\.set\(node\.id, result\)/);
  assert.match(fs.readFileSync('local/studio-demo/model.mjs', 'utf8'), /mode:\'working\'/);
});
