import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFlightCorrections, withFlightCorrections } from './prepared-fixture.mjs';

const base = new URL('./', import.meta.url);
const fetcher = async url => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL(url.pathname, 'file:///').pathname)) });
const corrections = await loadFlightCorrections({ fetcher, base });

test('the prepared manifest\'s cited correction is found by mold', () => {
  const servo = corrections.get('mvp--servo');
  assert.equal(servo.flightOverrides.speed, 6.5);
  assert.equal(servo.flightCitation.sourceKind, 'manufacturer');
  assert.match(servo.flightCitation.url, /^https:\/\/mvpdiscsports\.com\//);
  assert.equal(corrections.has('discraft--buzzz-ss'), false, 'a mold without a citation is left to the catalog');
});

test('a photo-cropped disc of that mold gets the same correction as the prepared sample', () => {
  const photo = { id: 'IMG_1', mold: 'mvp--servo', name: 'Servo', manufacturer: 'MVP', plastic: 'Neutron', weight: null, depiction: { kind: 'photo', src: 'data:image/webp;base64,AA==', name: 'Servo' } };
  const other = { ...photo, id: 'IMG_2', mold: 'discraft--buzzz-ss', name: 'Buzzz SS' };
  const [a, b] = withFlightCorrections([photo, other], corrections);
  assert.deepEqual(a.flightOverrides, { speed: 6.5 });
  assert.equal(a.flightCitation.sourceKind, 'manufacturer');
  assert.equal(Object.hasOwn(b, 'flightOverrides'), false);
  assert.equal(Object.hasOwn(photo, 'flightOverrides'), false, 'the input is not changed');
});

test('a disc that already carries its own correction keeps it', () => {
  const own = { id: 'x', mold: 'mvp--servo', flightOverrides: { speed: 7 }, flightCitation: corrections.get('mvp--servo').flightCitation };
  assert.equal(withFlightCorrections([own], corrections)[0].flightOverrides.speed, 7);
});
