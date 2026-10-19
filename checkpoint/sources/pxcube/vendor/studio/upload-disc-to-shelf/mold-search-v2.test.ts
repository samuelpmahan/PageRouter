import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMoldOptions, rankMoldOptions, normalizeMoldText } from './mold-search.ts';
import { catalog } from './catalog.ts';

// Floors come from work/mold-search-bench/bench.mjs on the 724-mold catalog (2026-10-15):
// v1 → v2: never first when fully typed 30 → 0; mold-only top-1 95.7% → 99.7%; one-typo top-1 88.6% → 91.4%;
// special-character queries top-1 40.9% → 95.5%.
const rows = catalog.map(row => ({ id: row.id, manufacturer: row.manufacturer, mold: row.mold }));
const v2 = (query: string) => rankMoldOptions(rows, query, row => row);
const v1 = (query: string) => fuzzyMoldOptions(rows, query, row => `${row.manufacturer} · ${row.mold}`);
const rank = (result: { id: string }[], id: string) => result.findIndex(row => row.id === id) + 1 || Infinity;

test('v2 keeps v1 behaviour on the original fixtures', () => {
  const molds = [
    { manufacturer: 'Discraft', mold: 'Buzzz' }, { manufacturer: 'Innova', mold: 'Roc' }, { manufacturer: 'Kastaplast', mold: 'Berg' },
    { manufacturer: 'Discraft', mold: 'Buzzz OS' }, { manufacturer: 'ABC', mold: 'Flying Squirrel' },
  ];
  const find = (query: string) => rankMoldOptions(molds, query, row => row);
  assert.deepEqual(find('buz disc').map(row => row.mold), ['Buzzz', 'Buzzz OS']);
  assert.equal(find('Kast Berg')[0], molds[2]);
  assert.equal(find('Discraft Buzx')[0], molds[0]);
  assert.equal(find('flyng squrrel')[0], molds[4]);
  assert.deepEqual(find('totally absent'), []);
});

test('every catalog mold reaches first place by the time it is fully typed (v1: 30 never did)', () => {
  const never = rows.filter(row => ![...row.mold].some((_, i) => rank(v2(row.mold.slice(0, i + 1)), row.id) === 1));
  assert.deepEqual(never.map(row => row.id), []);
});

test('a whole word beats a word that only contains it', () => {
  assert.equal(v2('zone')[0].id, 'discraft--zone', 'not Ozone Discs');
  assert.equal(v2('hawk')[0].id, 'discraft--hawk', 'not Hawkeye');
  assert.equal(v2('Innova Nova')[0].id, 'innova--nova', 'v1 did not show Nova at all');
  assert.equal(v2('serpent')[0].id, 'reptilian-disc-golf--serpent', 'mold words decide, not manufacturer length');
  assert.equal(rank(v1('Innova Nova'), 'innova--nova'), Infinity, 'v1 stays as it was');
});

test('special characters typed the way people type them', () => {
  const cases: [string, string][] = [
    ['roc+', 'innova--roc-plus'], ['roc plus', 'innova--roc-plus'], ['teebird+', 'innova--teebird-plus'], ['xd plus', 'innova--xd-plus'],
    ["putt'r", 'discraft--putt-r'], ['puttr', 'discraft--putt-r'], ['x caliber', 'innova--x-caliber'], ['mx3', 'prodigy--mx-3'], ['mx-3', 'prodigy--mx-3'],
    ['alva', 'kastaplast--alva'], ['gote', 'kastaplast--gote'], ['jarn', 'kastaplast--jarn'], ['stal', 'kastaplast--stal'],
    ['#1 hyzer', 'lightning-discs--1-hyzer'], ['1 hyzer', 'lightning-discs--1-hyzer'], ['talon claws', 'yikun--talon-claws'], ['aviar x', 'innova--aviar-x-jk'],
  ];
  for (const [query, id] of cases) assert.equal(v2(query)[0]?.id, id, query);
  // The catalog lists both XCaliber and X-Caliber; either may lead, both must show.
  assert.ok(rank(v2('xcaliber'), 'innova--x-caliber') <= 2);
  assert.equal(normalizeMoldText('Roc+'), 'roc plus');
  assert.equal(normalizeMoldText('X-Caliber'), 'x caliber xcaliber');
});

test('floors on the whole catalog', () => {
  const moldOnly = rows.filter(row => rank(v2(row.mold), row.id) === 1).length / rows.length;
  assert.ok(moldOnly >= 0.99, `mold-only top-1 ${moldOnly}`);
  // One deterministic typo per mold of 4+ letters (same generator as the benchmark).
  let seed = 20261015;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const letters = 'abcdefghijklmnopqrstuvwxyz', pick = () => letters[Math.floor(rand() * 26)];
  const typo = (word: string) => {
    const i = Math.floor(rand() * word.length);
    switch (Math.floor(rand() * 4)) {
      case 0: return word.slice(0, i) + pick() + word.slice(i + 1);
      case 1: return word.slice(0, i) + word.slice(i + 1);
      case 2: return word.slice(0, i) + pick() + word.slice(i);
      default: return i < word.length - 1 ? word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2) : word.slice(0, -1);
    }
  };
  const long = rows.filter(row => row.mold.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').length >= 4);
  const typed = long.filter(row => rank(v2(typo(row.mold.toLowerCase())), row.id) === 1).length / long.length;
  assert.ok(typed >= 0.9, `one-typo top-1 ${typed}`);
});
