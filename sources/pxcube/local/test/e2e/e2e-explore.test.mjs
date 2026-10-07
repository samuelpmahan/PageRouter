// E2E: ExploreShelf, driven in Node against the shipped Studio modules.
// No DOM, no browser. The shopping seed is extracted from the actual
// accepted-shelf.html that ships (same molds/names/colors and the same
// 50-disc factory the UI runs); shelfQuery and createBag are the pure
// modules the UI calls. Flows mirror the browser checks: the accepted
// mold/plastic/weight shelf, strict search with nickname exclusion,
// specimen ordering, and bag creation. The live shelf runs through
// startSandbox/inspectExperience like the upload suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { siteFile, sitePath } from './e2e-site.mjs';

const studio = 'experiences/explore-shelf/studio/upload-disc-to-shelf';
const { shelfQuery } = await import(siteFile(studio, 'shelf-query.js'));
const { createBag } = await import(siteFile(studio, 'bags.js'));
const { startSandbox, inspectExperience } = await import(siteFile(studio, 'experience-fixtures.js'));

// Extract the shopping seed from the HTML that actually ships, so the E2E
// runs the UI's own 50-disc factory, not a copy of it.
function extractConst(source, name) {
  const start = source.indexOf(`const ${name}=`);
  assert.ok(start >= 0, `seed declares const ${name}`);
  let i = source.indexOf('=', start) + 1, depth = 0, inString = null;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === inString) inString = null;
    } else if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      if (depth === 0) {
        const end = source.indexOf(';', i);
        return source.slice(start, end);
      }
    }
  }
  throw Error(`could not extract const ${name}`);
}

const html = fs.readFileSync(sitePath(studio, 'accepted-shelf.html'), 'utf8');
const seedFactory = new Function(
  `${extractConst(html, 'molds')};${extractConst(html, 'names')};${extractConst(html, 'colors')};` +
  `const art=['a','b','c'];const discCount=50;${extractConst(html, 'discs')};return discs;`
);
const discs = seedFactory();
assert.equal(discs.length, 50);

// Adapt the flat UI discs to the {seed, disc} rows shelfQuery reads.
const rows = discs.map(d => ({
  seed: { id: d.mold, manufacturer: d.manufacturer, name: d.mold, speed: d.speed },
  disc: { id: `disc-${d.id}`, plastic: d.plastic, weight: d.weight },
  nickname: d.nickname,
}));

test('the accepted shelf holds 50 fairway discs at speed 7-8', () => {
  const result = shelfQuery({ rows, request: { speedRange: [7, 8] } });
  assert.equal(result.total, 50);
  assert.ok(result.rows.length > 0);
  assert.ok(result.rows.every(row => row.seed.speed >= 7 && row.seed.speed <= 8));
});

test('strict search finds Passion ESP and excludes nicknames', () => {
  const found = shelfQuery({ rows, request: { query: 'Passion ESP' } });
  assert.ok(found.rows.length > 0, 'Passion ESP matches');
  assert.ok(found.rows.every(row => row.seed.name === 'Passion' && row.disc.plastic === 'ESP'));
  const nicknamed = shelfQuery({ rows, request: { query: rows[0].nickname } });
  assert.equal(nicknamed.rows.length, 0, 'nicknames are not searchable');
});

test('specimens order by plastic, then weight descending', () => {
  const result = shelfQuery({ rows, request: {} });
  const group = result.groups.find(g => g.mold === 'Passion');
  assert.ok(group && group.rows.length > 1, 'Passion has several specimens');
  const expected = [...group.rows].sort(
    (a, b) => a.disc.plastic.localeCompare(b.disc.plastic) || b.disc.weight - a.disc.weight
  );
  assert.deepEqual(group.rows.map(r => r.disc.id), expected.map(r => r.disc.id));
});

test('checkout creates a bag of the exact selected versions', () => {
  const result = shelfQuery({ rows, request: {} });
  const group = result.groups.find(g => g.mold === 'Passion');
  const shelfRows = group.rows.map((row, i) => ({ address: `ds.px.disc.${i}`, disc: row.disc, seed: row.seed }));
  const selection = [shelfRows[0].address, shelfRows[1].address];
  const bag = createBag({ id: 'bag-1', name: 'Sandbox fairways', selection, rows: shelfRows });
  assert.equal(bag.name, 'Sandbox fairways');
  assert.deepEqual(bag.discIds, [shelfRows[0].disc.id, shelfRows[1].disc.id]);
  assert.throws(() => createBag({ id: 'bag-2', name: 'Empty', selection: [], rows: shelfRows }), /at least one/);
});

test('the live shelf seeds discs and the shelf query runs against real Parts', async () => {
  const experience = await startSandbox('shelf', () => {});
  const snap = inspectExperience(experience);
  assert.equal(snap.discs.length, 3);
  const result = await experience.queryShelf({});
  assert.equal(result.total, 3);
  assert.ok(result.rows.every(row => row.disc && row.seed), 'rows carry disc and seed Parts');
});
