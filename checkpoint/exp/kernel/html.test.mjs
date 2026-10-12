import {test} from 'node:test';
import assert from 'node:assert/strict';
import {esc} from './html.mjs';

const entity = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};

// The cases of escape-html 1.0.3's own suite for the five characters.
test('each HTML-special character becomes its entity, alone, first, last, in the middle and repeated', () => {
  for (const [character, replacement] of Object.entries(entity)) {
    assert.equal(esc(character), replacement);
    assert.equal(esc(`${character}bar`), `${replacement}bar`);
    assert.equal(esc(`foo${character}`), `foo${replacement}`);
    assert.equal(esc(`foo${character}bar`), `foo${replacement}bar`);
    assert.equal(esc(`foo${character}${character}bar`), `foo${replacement}${replacement}bar`);
  }
  assert.equal(esc('&foo <> bar "fizz" l\'a'), '&amp;foo &lt;&gt; bar &quot;fizz&quot; l&#39;a');
});

test('every other ASCII character, and Unicode beyond it, passes through unchanged', () => {
  const others = [...Array(128).keys()].map(code => String.fromCharCode(code)).filter(character => !(character in entity));
  others.push('Ω', 'é', '中', ' ', '﻿', '😀', '\uD800', '＜');
  for (const character of others) assert.equal(esc(character), character);
  assert.equal(esc(others.join('')), others.join(''));
});

test('text that is already escaped is escaped again', () => {
  assert.equal(esc('&amp; &lt;'), '&amp;amp; &amp;lt;');
});

test('null and undefined become empty text, where escape-html 1.0.3 writes null and undefined', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('every other value is converted with String() before escaping', () => {
  assert.equal(esc(0), '0');
  assert.equal(esc(false), 'false');
  assert.equal(esc(42), '42');
  assert.equal(esc({}), '[object Object]');
  assert.equal(esc(['<a>', 1]), '&lt;a&gt;,1');
  // String() asks for toString first and prints a Symbol; escape-html 1.0.3's
  // '' + value asks for valueOf first and throws on a Symbol.
  assert.equal(esc({valueOf: () => 1, toString: () => '<x>'}), '&lt;x&gt;');
  assert.equal(esc(Symbol('s')), 'Symbol(s)');
});
