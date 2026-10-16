// Controls: trusted libraries' own tests, run against PageRouter's kernels.
//
// For every family the trusted library runs its own suite first. If it does
// not pass, the harness is wrong and the family's other results do not count.
// Then each PageRouter subject runs the same suite, and subjects whose results
// are identical form one behavior class.
//
//   bash ci/controls/fetch-trusted.sh <trusted>
//   node ci/controls/harness.mjs <trusted> [out.json]          (from checkpoint/)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const checkpoint = path.resolve(import.meta.dirname, '../..');
const [trusted, outFile] = process.argv.slice(2);
if (!trusted) { console.error('usage: node ci/controls/harness.mjs <trusted dir> [out.json]'); process.exit(2); }
const T = path.resolve(trusted);
const require = createRequire(path.join(checkpoint, '../actions/called-shot/package.json'));
const Parser = require('web-tree-sitter');
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Parser.Language.load(require.resolve('tree-sitter-wasms/out/tree-sitter-javascript.wasm')));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'controls-'));
const unique = () => crypto.randomBytes(4).toString('hex');

// A module whose default export is a named function: exported, or a private,
// self-contained top-level declaration lifted out with tree-sitter.
function subject(file, name, { exported = true } = {}) {
  const module = path.join(scratch, `subject-${unique()}.mjs`);
  const full = path.join(checkpoint, file);
  if (exported) fs.writeFileSync(module, `export { ${name} as default } from ${JSON.stringify(pathToFileURL(full).href)};\n`);
  else {
    const root = parser.parse(fs.readFileSync(full, 'utf8')).rootNode;
    const decl = root.namedChildren.map(s => s.type === 'export_statement' ? (s.childForFieldName('declaration') ?? s) : s).find(d =>
      d.type === 'function_declaration' ? d.childForFieldName('name')?.text === name
        : d.type === 'lexical_declaration' && d.namedChildren.some(v => v.childForFieldName?.('name')?.text === name));
    if (!decl) throw Error(`${name} not found in ${file}`);
    fs.writeFileSync(module, `${decl.text}\nexport default ${name};\n`);
  }
  return module;
}
const load = async module => (await import(pathToFileURL(module).href)).default;

// node --test with a JUnit report; results keyed by suite path and test name.
function runSuite(files, imports = []) {
  const junit = path.join(scratch, `junit-${unique()}.xml`);
  spawnSync(process.execPath, ['--test', ...imports.flatMap(i => ['--import', i]), '--test-reporter=junit', `--test-reporter-destination=${junit}`, ...files], { encoding: 'utf8' });
  const xml = fs.existsSync(junit) ? fs.readFileSync(junit, 'utf8') : '';
  const unescape = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const results = {}, stack = [];
  for (const m of xml.matchAll(/<testsuite name="([^"]*)"[^>]*>|<\/testsuite>|<testcase name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    if (m[0].startsWith('<testsuite')) stack.push(unescape(m[1]));
    else if (m[0] === '</testsuite>') stack.pop();
    else results[[...stack, unescape(m[2])].join(' > ')] = /<failure/.test(m[4] ?? '') ? 'fail' : 'pass';
  }
  return results;
}
const score = results => ({ pass: Object.values(results).filter(v => v === 'pass').length, total: Object.keys(results).length, failing: Object.keys(results).filter(k => results[k] !== 'pass') });

// ---------------------------------------------------------------- canonical JSON
function canonicalizeSuite(module) {
  const dir = fs.mkdtempSync(path.join(scratch, 'canon-'));
  fs.cpSync(path.join(T, 'canonicalize/test'), path.join(dir, 'test'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/canonicalize.js'), `export { default } from ${JSON.stringify(pathToFileURL(module).href)};\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
  // exports.js tests npm packaging, not behavior.
  return runSuite(fs.readdirSync(path.join(dir, 'test')).filter(f => f.endsWith('.js') && f !== 'exports.js').map(f => path.join(dir, 'test', f)));
}
async function rfc8785(module) {
  const fn = await load(module), out = {};
  for (const f of fs.readdirSync(path.join(T, 'json-canonicalization/testdata/input')).sort()) {
    const input = JSON.parse(fs.readFileSync(path.join(T, 'json-canonicalization/testdata/input', f), 'utf8'));
    const expected = fs.readFileSync(path.join(T, 'json-canonicalization/testdata/output', f), 'utf8').replace(/\n$/, '');
    try { out[f] = fn(input) === expected ? 'pass' : 'fail'; } catch { out[f] = 'fail'; }
  }
  return out;
}
const EDGES = {
  'undefined': () => undefined, '{a:undefined}': () => ({ a: undefined }), '[undefined]': () => [undefined], 'sparse [,1]': () => [, 1],
  'NaN': () => NaN, 'Infinity': () => Infinity, '-0': () => -0, '1e21': () => 1e21, 'function': () => () => 1, 'Symbol': () => Symbol('s'),
  'BigInt': () => 1n, 'Date(0)': () => new Date(0), 'Map': () => new Map([[1, 2]]), 'class instance': () => new (class P { constructor() { this.a = 1; } })(),
  'null-prototype {a:1}': () => Object.assign(Object.create(null), { a: 1 }), 'cycle': () => { const o = {}; o.self = o; return o; },
  'toJSON': () => ({ toJSON: () => 'x' }), 'lone surrogate key': () => ({ '\uD800': 1 }),
};
async function edges(module) {
  const fn = await load(module), out = {};
  for (const [label, make] of Object.entries(EDGES)) {
    try { const r = fn(make()); out[label] = r === undefined ? 'undefined' : JSON.stringify(r); } catch (e) { out[label] = `throws ${e.constructor.name}`; }
  }
  return out;
}

// ---------------------------------------------------------------- HTML escaping
function escapeSuite(module) {
  const dir = fs.mkdtempSync(path.join(scratch, 'esc-'));
  fs.cpSync(path.join(T, 'escape-html/test'), path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), `const m = require(${JSON.stringify(module)});\nmodule.exports = m.default ?? m;\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}\n');
  const shim = path.join(dir, 'shim.mjs');
  fs.writeFileSync(shim, "import { describe, it } from 'node:test';\nglobalThis.describe = describe; globalThis.it = it;\n");
  return runSuite([path.join(dir, 'test/index.js')], [pathToFileURL(shim).href]);
}

// ---------------------------------------------------------------- deep equality
async function equalTable(module) {
  const fn = await load(module), table = require(path.join(T, 'fast-deep-equal/spec/tests.js')), out = {};
  for (const suite of table) for (const t of suite.tests) for (const [label, a, b] of [['', t.value1, t.value2], [' (reversed)', t.value2, t.value1]]) {
    let r; try { r = fn(a, b); } catch { r = 'throws'; }
    out[`${suite.description} > ${t.description}${label}`] = r === t.equal ? 'pass' : 'fail';
  }
  return out;
}

// ---------------------------------------------------------------- deep freeze
// deep-freeze 0.0.1's own test (it freezes the global Buffer), each run in its own process.
function freezeSuite(module) {
  const dir = fs.mkdtempSync(path.join(scratch, 'freeze-'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.copyFileSync(path.join(T, 'df/package/test/deep.js'), path.join(dir, 'test/deep.js'));
  fs.writeFileSync(path.join(dir, 'index.js'), `const m = require(${JSON.stringify(module)});\nmodule.exports = m.default ?? m;\n`);
  fs.mkdirSync(path.join(dir, 'node_modules/tap'), { recursive: true });
  // A minimal stand-in for the `tap` it requires: test(name, fn) with plan and equal.
  fs.writeFileSync(path.join(dir, 'node_modules/tap/index.js'), 'exports.test=(n,f)=>{let ok=0,all=0;f({plan(){},equal(a,b){all++;if(a===b)ok++;}});console.log(JSON.stringify({ok,all}));};\n');
  const run = spawnSync(process.execPath, [path.join(dir, 'test/deep.js')], { encoding: 'utf8', cwd: dir });
  const { ok = 0, all = 2 } = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}');
  return Object.fromEntries(Array.from({ length: all }, (_, i) => [`deep freeze > assertion ${i + 1}`, i < ok ? 'pass' : 'fail']));
}

// ---------------------------------------------------------------- SHA-256
const NIST = { '': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'abc': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq': '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', [`a x 1000000`]: 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0' };
async function shaVectors(fn) {
  const out = {};
  for (const [label, digest] of Object.entries(NIST)) out[`FIPS 180-2 "${label}"`] = fn(label === 'a x 1000000' ? 'a'.repeat(1e6) : label) === digest ? 'pass' : 'fail';
  return out;
}

// ---------------------------------------------------------------- run
const families = {
  'canonical JSON': {
    trusted: ['canonicalize 5.1.0', path.join(T, 'canonicalize/lib/canonicalize.js')],
    subjects: {
      'exp/kernel/canonical.mjs canonicalLax': subject('exp/kernel/canonical.mjs', 'canonicalLax'),
      'exp/kernel/canonical.mjs canonicalJson': subject('exp/kernel/canonical.mjs', 'canonicalJson'),
      'exp/atlas/calculations.mjs canonical (kept)': subject('exp/atlas/calculations.mjs', 'canonical'),
      'exp/block5/core/grid-engine.mjs canonical (kept, external copy)': subject('exp/block5/core/grid-engine.mjs', 'canonical', { exported: false }),
      'exp/compression/canonical.mjs canonical (kept)': subject('exp/compression/canonical.mjs', 'canonical'),
    },
    run: async m => ({ suite: canonicalizeSuite(m), rfc8785: await rfc8785(m), edges: await edges(m) }),
  },
  'HTML escaping': {
    trusted: ['escape-html 1.0.3', path.join(T, 'escape-html/index.js')],
    subjects: { 'exp/kernel/html.mjs esc': subject('exp/kernel/html.mjs', 'esc'), 'src/session-repl.mjs escape (frozen)': subject('src/session-repl.mjs', 'escape', { exported: false }) },
    run: async m => ({ suite: escapeSuite(m) }),
  },
  'deep equality': {
    trusted: ['fast-deep-equal 3.1.3', path.join(T, 'fde-pkg/package/index.js')],
    subjects: { 'exp/kernel/equal-json.mjs equalJson': subject('exp/kernel/equal-json.mjs', 'equalJson') },
    run: async m => ({ suite: await equalTable(m) }),
  },
  'deep freeze': {
    trusted: ['deep-freeze 0.0.1', path.join(T, 'df/package/index.js')],
    subjects: Object.fromEntries(['freezeTree', 'freeze', 'freezeTreeParentFirst'].map(n => [`exp/kernel/freeze.mjs ${n}`, subject('exp/kernel/freeze.mjs', n)])),
    run: async m => ({ suite: freezeSuite(m) }),
  },
  'SHA-256': {
    trusted: ['node:crypto', null],
    subjects: { 'scripts/import-closure.mjs sha256Hex': subject('scripts/import-closure.mjs', 'sha256Hex') },
    run: async m => ({ suite: await shaVectors(m ? await load(m) : s => crypto.createHash('sha256').update(s).digest('hex')) }),
  },
};
const report = { trustedDir: T, families: {} };
for (const [family, spec] of Object.entries(families)) {
  const [trustedName, trustedModule] = spec.trusted;
  const trustedResult = await spec.run(trustedModule);
  const control = Object.values(trustedResult).every(r => typeof r !== 'object' || Object.values(r).every(v => v === 'pass' || !/^(pass|fail)$/.test(v)));
  const out = { control: { library: trustedName, passesItsOwnTests: control, ...Object.fromEntries(Object.entries(trustedResult).filter(([k]) => k !== 'edges').map(([k, v]) => [k, score(v)])) }, subjects: {} };
  for (const [label, module] of Object.entries(spec.subjects)) {
    const r = await spec.run(module);
    out.subjects[label] = { ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'edges').map(([k, v]) => [k, score(v)])), ...(r.edges ? { edges: r.edges } : {}), signature: crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0, 12) };
  }
  const classes = {};
  for (const [label, r] of Object.entries(out.subjects)) (classes[r.signature] ??= []).push(label);
  out.behaviorClasses = Object.values(classes);
  report.families[family] = out;
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
for (const [family, f] of Object.entries(report.families)) {
  const c = f.control;
  console.log(`\n${family}: control ${c.library} ${c.passesItsOwnTests ? 'passes its own tests' : 'FAILS ITS OWN TESTS: results below do not count'} (${Object.entries(c).filter(([k]) => !['library', 'passesItsOwnTests'].includes(k)).map(([k, v]) => `${k} ${v.pass}/${v.total}`).join(', ')})`);
  for (const [label, s] of Object.entries(f.subjects)) console.log(`  ${label.padEnd(64)} ${Object.entries(s).filter(([k]) => !['edges', 'signature'].includes(k)).map(([k, v]) => `${k} ${v.pass}/${v.total}`).join(', ')}`);
  console.log(`  behavior classes: ${f.behaviorClasses.length}`);
}
