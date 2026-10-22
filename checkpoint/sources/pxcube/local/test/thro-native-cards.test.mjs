import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// A missing module is reported as the missing production API, not an import
// error. The first RED run establishes this contract before implementation.
const api = await import('../../experiences/thro/native-cards.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const requireAPI = name => { assert.equal(typeof api[name], 'function', `${name} must implement native Single dispatch`); return api[name]; };
const legacy = { study: 'broadcast-rail', orientation: 'landscape', accent: '#a6edda', frame: 'none' };
const input = () => ({ discAddress: 'ds.px.disc.copy-17', designAddress: 'design.17', resolvedAddress: 'resolved.17', disc: { id: 'physical-17', mold: 'ds.px.seed.mvp--servo', plastic: 'Neutron', weight: 173, depiction: { kind: 'photo', src: 'data:image/webp;base64,Y3JvcA==', name: 'prepared' } }, resolved: { name: 'Servo', manufacturer: 'MVP', speed: 6.5, glide: 5, turn: null, fade: 2 }, design: { ...legacy, study: 'discstudio:b01', rendererBuild: '28ac2b39fab85255', nativeScale: 0.66 } });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><image href="data:image/png;base64,cGl4ZWxz" width="1920" height="1080"/></svg>';

test('legacy requests return before importing or invoking the native renderer', async () => {
  const create = requireAPI('createNativeRenderer');
  let calls = 0;
  const render = create(async () => { calls++; throw Error('Native renderer must stay lazy'); });
  assert.equal(await render({ ...input(), design: legacy }), null);
  assert.equal(calls, 0);
});

test('native request preserves prepared pixels, physical id, addressed mold and explicit unknown flights', () => {
  const request = requireAPI('nativeCardRequest')(input());
  assert.equal(request.disc.id, 'physical-17');
  assert.equal(request.disc.mold, 'ds.px.seed.mvp--servo');
  assert.equal(request.disc.name, 'Servo');
  assert.equal(request.disc.manufacturer, 'MVP');
  assert.equal(request.photoSrc, input().disc.depiction.src);
  assert.deepEqual(request.flights, [6.5, 5, null, 2]);
  assert.equal(request.preset, 'b01');
  assert.equal(request.placement, 'panel-default');
  assert.equal(request.scale, 0.66);
});

test('native layout selection binds the pinned build and correct orientation', () => {
  const select = requireAPI('nativeDesign');
  const portrait = select(legacy, 'discstudio:u02');
  assert.equal(portrait.orientation, 'portrait');
  assert.equal(portrait.rendererBuild, '28ac2b39fab85255');
  assert.equal(portrait.nativeScale, 0.66);
  assert.equal(portrait.nativeSide, 'left');
  assert.equal(select(portrait, 'discstudio:b03').orientation, 'landscape');
  assert.throws(() => select(legacy, 'discstudio:missing'), /layout|study/i);
});

test('native renderer drops Blob output and retains exact version/build/crop provenance', async () => {
  let requested;
  const render = requireAPI('createNativeRenderer')(async request => {
    requested = request;
    return { svg, width: 1920, height: 1080, png: new Blob(['pixels']), build: '28ac2b39fab85255', preset: 'b01', placement: { scale: 0.66, dx: 0.1, dy: 0.2 }, appearance: request.appearance };
  });
  const result = await render(input());
  assert.deepEqual(Object.keys(result).sort(), ['height', 'provenance', 'svg', 'width']);
  assert.equal(requested.disc.id, 'physical-17');
  assert.equal(result.provenance.discAddress, input().discAddress);
  assert.equal(result.provenance.physicalDiscId, 'physical-17');
  assert.equal(result.provenance.designAddress, input().designAddress);
  assert.equal(result.provenance.resolvedAddress, input().resolvedAddress);
  assert.equal(result.provenance.rendererBuild, '28ac2b39fab85255');
  assert.equal(result.provenance.preparedPhotoSha256, createHash('sha256').update(Buffer.from(input().disc.depiction.src.split(',')[1], 'base64')).digest('hex'));
  assert.equal(JSON.stringify(result).includes('"png"'), false);
  assert.deepEqual(structuredClone(result), result);
});

test('native validation rejects another renderer build, wrong dimensions and invalid source/scale', async () => {
  const request = requireAPI('nativeCardRequest');
  assert.throws(() => request({ ...input(), design: { ...input().design, rendererBuild: 'another-build' } }), /build/i);
  assert.throws(() => request({ ...input(), design: { ...input().design, nativeScale: 0.4 } }), /size|scale/i);
  assert.throws(() => request({ ...input(), disc: { ...input().disc, depiction: { kind: 'painted', src: 'data:image/svg+xml,...' } } }), /prepared photo/i);
  const render = requireAPI('createNativeRenderer')(async () => ({ svg, width: 1080, height: 1920, build: '28ac2b39fab85255' }));
  await assert.rejects(render(input()), /dimensions/i);
});

test('mode changes keep native Single and legacy lineup designs separately without overwriting either', () => {
  const change = requireAPI('workspaceDesignChange');
  const native = input().design;
  const context = { throMode: 'single', design: native, singleDesign: native, legacyDesign: legacy };
  const battle = change(context, { throMode: 'battle' }, legacy);
  assert.deepEqual(battle.design, legacy);
  assert.deepEqual(battle.singleDesign, native);
  const back = change({ ...context, ...battle }, { throMode: 'single' }, legacy);
  assert.deepEqual(back.design, native);
  assert.deepEqual(back.legacyDesign, legacy);
});

test('changing native preset discards the previous controls side/highlight but keeps size and accent intent', () => {
  const read = requireAPI('nativeControlDesign'), select = requireAPI('nativeDesign');
  const u01 = select(legacy, 'discstudio:u01');
  const u02 = read(u01, { study: 'discstudio:u02', side: 'right', highlight: 'digits', scale: 0.8, accent: '#11aa88' });
  assert.equal(u02.nativeSide, 'left', 'U01 controls must not override the new U02 default');
  assert.equal(u02.nativeHighlight, 'digits');
  assert.equal(u02.nativeScale, 0.8);
  assert.equal(u02.accent, '#11aa88');
  const u03 = read(u02, { study: 'discstudio:u03-front', side: 'left', highlight: 'digits', scale: 0.8, accent: '#11aa88' });
  assert.equal(u03.nativeSide, 'right');
  assert.equal(u03.nativeHighlight, 'tiles', 'U02 controls must not override the new U03 default');
  assert.equal(u03.orientation, 'portrait');
});

test('editing controls on the same native preset retains the explicit side and highlight choices', () => {
  const read = requireAPI('nativeControlDesign'), selected = requireAPI('nativeDesign')(legacy, 'discstudio:u03-front');
  const edited = read(selected, { study: selected.study, side: 'left', highlight: 'digits', scale: 1.1, accent: '#336699' });
  assert.equal(edited.nativeSide, 'left');
  assert.equal(edited.nativeHighlight, 'digits');
  assert.equal(edited.nativeScale, 1.1);
  assert.equal(edited.accent, '#336699');
});
