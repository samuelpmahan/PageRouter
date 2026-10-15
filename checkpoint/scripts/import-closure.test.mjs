import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hashImportClosure, importSpecifiers, sha256Hex} from './import-closure.mjs';

// FIPS 180-2, Appendix B: the SHA-256 examples.
const FIPS_180_2 = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
];

test('sha256Hex gives the FIPS 180-2 SHA-256 digests, for a string and for its bytes', () => {
  for (const [message, digest] of FIPS_180_2) {
    assert.equal(sha256Hex(message), digest);
    assert.equal(sha256Hex(Buffer.from(message)), digest);
  }
});

test('importSpecifiers reads static imports and re-exports, then literal dynamic imports', () => {
  const source = [
    "import a from './a.mjs';",
    'import {b, c} from "./b.mjs";',
    "import * as d from './d.mjs';",
    "import './side-effect.mjs';",
    "export {e} from './e.mjs';",
    "export * from './f.mjs';",
    "export const g = 1;",
    "const lazy = () => import( './lazy.mjs' );",
  ].join('\n');
  assert.deepEqual(importSpecifiers(source), {
    specifiers: ['./a.mjs', './b.mjs', './d.mjs', './side-effect.mjs', './e.mjs', './f.mjs', './lazy.mjs'],
    followable: true,
  });
  assert.deepEqual(importSpecifiers("import a from './a.mjs';\nconst m = name => import(name);"), {specifiers: ['./a.mjs'], followable: false});
});

const refuse = {
  outsideOrLinked: 'outside or linked', dynamicImport: 'dynamic import', externalImport: 'external import',
};
function fixture(files) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-closure-')));
  const root = path.join(parent, 'root');
  for (const [relative, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(parent, relative)), {recursive: true});
    fs.writeFileSync(path.join(parent, relative), text);
  }
  fs.mkdirSync(root, {recursive: true});
  return {parent, root};
}
const remove = ({parent}) => fs.rmSync(parent, {recursive: true, force: true});

test('hashImportClosure records each reached file once, depth first and last import first', () => {
  const tree = fixture({
    'root/a.mjs': "import './b.mjs';\nimport './c.mjs';\n",
    'root/b.mjs': "import {e} from './d/e.mjs';\n",
    'root/c.mjs': "import './a.mjs';\n",
    'root/d/e.mjs': "export const e = () => import('../c.mjs');\n",
    'root/unreached.mjs': '',
  });
  try {
    const files = hashImportClosure(tree.root, ['a.mjs'], refuse);
    assert.deepEqual(Object.keys(files), ['a.mjs', 'c.mjs', 'b.mjs', 'd/e.mjs']);
    for (const [relative, record] of Object.entries(files)) {
      const bytes = fs.readFileSync(path.join(tree.root, relative));
      assert.deepEqual(record, {sha256: sha256Hex(bytes), bytes: bytes.length});
    }
  } finally { remove(tree); }
});

test('hashImportClosure refuses external and undeclared dynamic imports, files outside root and symbolic links', () => {
  const tree = fixture({
    'root/external.mjs': "import fs from 'node:fs';\n",
    'root/dynamic.mjs': 'export const load = name => import(name);\n',
    'root/leaves.mjs': "import '../outside.mjs';\n",
    'outside.mjs': '',
    'root/real.mjs': '',
    'root/linked.mjs': "import './link.mjs';\n",
  });
  try {
    fs.symlinkSync(path.join(tree.root, 'real.mjs'), path.join(tree.root, 'link.mjs'));
    assert.throws(() => hashImportClosure(tree.root, ['external.mjs'], refuse), {message: 'external import'});
    assert.throws(() => hashImportClosure(tree.root, ['dynamic.mjs'], refuse), {message: 'dynamic import'});
    assert.throws(() => hashImportClosure(tree.root, ['leaves.mjs'], refuse), {message: 'outside or linked'});
    assert.throws(() => hashImportClosure(tree.root, ['linked.mjs'], refuse), {message: 'outside or linked'});
    assert.throws(() => hashImportClosure(tree.root, ['missing.mjs'], refuse), {code: 'ENOENT'});
  } finally { remove(tree); }
});

test('hashImportClosure makes the notRegularFile and importLeavesRoot checks only when their message is given', () => {
  const tree = fixture({
    'root/directory.mjs': "import './folder';\n",
    'root/folder/index.mjs': '',
    'root/leaves.mjs': "import '../outside.mjs';\nimport 'node:fs';\n",
    'outside.mjs': '',
  });
  try {
    assert.throws(() => hashImportClosure(tree.root, ['directory.mjs'], refuse), {code: 'EISDIR'});
    assert.throws(() => hashImportClosure(tree.root, ['directory.mjs'], {...refuse, notRegularFile: 'not a regular file'}), {message: 'not a regular file'});
    // Without importLeavesRoot the walk reads on and refuses the external import first.
    assert.throws(() => hashImportClosure(tree.root, ['leaves.mjs'], refuse), {message: 'external import'});
    assert.throws(() => hashImportClosure(tree.root, ['leaves.mjs'], {...refuse, importLeavesRoot: 'import leaves root'}), {message: 'import leaves root'});
  } finally { remove(tree); }
});
