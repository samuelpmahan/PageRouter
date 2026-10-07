import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIdentity, validateDirectoryTree } from '../policies/tidy.mjs';
import { recordObservation, state } from '../policies/neat.mjs';

const manifest = (address, children, kind, source = null, neat = { mode: 'none' }) => ({
  schema: 'nctk-directory@1', address, children, kind, source,
  policies: { neat, crisp: { mode: 'none' }, tidy: { mode: 'local' },
    kompoze: { mode: source ? 'local' : 'none', references: [] } },
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tidy-dir-'));
  await mkdir(join(root, 'recipes/one'), { recursive: true });
  await writeFile(join(root, 'recipes/one.json'), JSON.stringify({ kind: 'item' }));
  await writeFile(join(root, 'nctk.json'), JSON.stringify(manifest('.', ['recipes'], 'group')));
  await writeFile(join(root, 'recipes/nctk.json'), JSON.stringify(manifest('recipes', ['recipes/one'], 'group')));
  await writeFile(join(root, 'recipes/one/nctk.json'), JSON.stringify(manifest('recipes/one', [], 'part', 'recipes/one.json',
    { mode: 'local', state: 'Compare', phase: 'Compare', substates: {}, suggestions: [] })));
  return root;
}

test('a raw directory move fails Tidy address and inventory validation', async () => {
  const root = await fixture();
  assert.equal((await validateDirectoryTree(root)).manifests.size, 3);
  await rename(join(root, 'recipes/one'), join(root, 'recipes/moved'));
  await assert.rejects(validateDirectoryTree(root), /child inventory mismatch/);
});

test('Neat observation persists in the directory manifest without changing Tidy source identity', async () => {
  const root = await fixture(), path = 'recipes/one/nctk.json';
  const before = await sourceIdentity(root, path);
  await recordObservation(root, 'recipes/one.json', 'localci.discstudio-pages@1', { verdict: 'PASS' }, [{ sha256: 'proof' }]);
  const authored = JSON.parse(await readFile(join(root, path)));
  assert.equal(authored.policies.neat.substates['localci.discstudio-pages@1'].facts.verdict, 'PASS');
  assert.equal((await state(root)).items['recipes/one.json'].state, 'Compare');
  assert.equal(await sourceIdentity(root, path), before);
});
