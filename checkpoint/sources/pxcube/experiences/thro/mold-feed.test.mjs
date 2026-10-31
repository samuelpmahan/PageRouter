import test from 'node:test';
import assert from 'node:assert/strict';
import { packedMoldIndex } from '../../vendor/discstudio-cards/mold-runtime-index.js';
import { moldFeed } from './mold-feed.mjs';

const drain = (feed, query, limit) => {
  const seen = []; let cursor = null, pages = 0;
  do { const page = feed.search(query, { limit, cursor }); seen.push(...page.items.map(m => m.id)); cursor = page.nextCursor; pages++; } while (cursor !== null);
  return { seen, pages };
};

test('a maker prefix pages through every one of its molds once, twelve at a time', () => {
  const feed = moldFeed(packedMoldIndex);
  const first = feed.search('inn');
  assert.equal(first.items.length, 12);
  assert.equal(first.nextCursor, '12');
  assert.ok(first.items.every(m => m.manufacturer === 'Innova' && m.match === 'maker starts with it'));
  const innova = packedMoldIndex.stableIds.filter(id => packedMoldIndex.recordForId(id).manufacturer === 'Innova');
  const { seen, pages } = drain(feed, 'inn', 12);
  assert.equal(new Set(seen).size, seen.length, 'no mold appears twice across pages');
  assert.deepEqual([...seen].sort(), [...innova].sort());
  assert.equal(pages, Math.ceil(innova.length / 12));
});

test('match kind ranks first: an exact name, then names that start with it, then makers', () => {
  const feed = moldFeed(packedMoldIndex);
  assert.equal(feed.search('destroyer').items[0].id, 'destroyer');
  assert.equal(feed.search('destroyer').items[0].match, 'exact name');
  const d = feed.search('d', { limit: 400 }).items;
  const order = d.map(m => feed.tiers.indexOf(m.match));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'tiers never go backwards down the feed');
  assert.equal(feed.search('innova des').items[0].mold, 'Destroyer');
  assert.equal(feed.search('squirrel').items[0].match, 'a word in the name starts with it');
});

test('within a match kind, molds more videos name come first, then shorter names', () => {
  const ids = packedMoldIndex.stableIds.filter(id => packedMoldIndex.recordForId(id).manufacturer === 'Innova');
  const heard = { [ids[40]]: 9, [ids[41]]: 3 };
  const page = moldFeed(packedMoldIndex, heard).search('inn', { limit: 4 }).items;
  assert.deepEqual(page.slice(0, 2).map(m => m.id), [ids[40], ids[41]]);
  assert.deepEqual(page.slice(0, 2).map(m => m.heard), [9, 3]);
  const rest = page.slice(2).map(m => m.mold.length);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b));
});

test('the same query gives the same order on every call and in a fresh feed', () => {
  const a = drain(moldFeed(packedMoldIndex), 'a', 7).seen, b = drain(moldFeed(packedMoldIndex), 'a', 50).seen;
  assert.deepEqual(a, b);
});

test('the limit contract holds: nonnegative whole numbers only, zero returns nothing', () => {
  const feed = moldFeed(packedMoldIndex);
  assert.deepEqual(feed.search('inn', { limit: 0 }).items, []);
  assert.equal(feed.search('inn', { limit: 0 }).nextCursor, null);
  assert.equal(feed.search('inn', { limit: 5 }).items.length, 5);
  assert.throws(() => feed.search('inn', { limit: -1 }), /limit/);
  assert.throws(() => feed.search('inn', { limit: 1.5 }), /limit/);
  assert.throws(() => feed.search('inn', { cursor: 'x' }), /cursor/);
  assert.throws(() => feed.search('inn', { cursor: '100000' }), /past the end/);
  assert.equal(feed.search('zzzzqq').total, 0);
});

test('interior wildcards keep the packed index pattern rules', () => {
  const feed = moldFeed(packedMoldIndex);
  const wild = new Set(feed.search('b*zz', { limit: 1000 }).items.map(m => m.id));
  assert.deepEqual(wild, new Set(packedMoldIndex.search('b*zz', packedMoldIndex.recordCount).map(m => m.id)));
});
