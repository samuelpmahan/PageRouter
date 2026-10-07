import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../run.mjs';

export const spec = (id = 'build-bag') => ({
  version: '0.1.0', root: `experiences/${id}`, clean: 'clean', experiments: 'exp', tests: [],
  experience: {
    title: id === 'build-bag' ? 'BuildBag' : 'Another experience',
    description: 'A generated sandbox frame; domain calculations are still to come.',
    mounts: ['shelf'], build: 'node build.mjs', outDir: 'dist', entry: 'index.html',
    sandbox: ['allow-scripts', 'allow-same-origin', 'allow-forms'],
    scaffold: {
      template: 'sandbox@1', world: 'shelf',
      inputs: [{ address: 'px.discs', label: 'Owned discs', for: 'Choose physical copies from the shelf.' }],
      outputs: [{ address: 'px.bags', label: 'Created bag', for: 'Retain the selected copies in order.' }],
      steps: ['Choose discs', 'Arrange the bag', 'Create the bag'],
      draft: { address: 'sc.draft', field: 'name', label: 'Bag name' },
    },
  },
});

export function workspace() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pxcube-scaffold-'));
  for (const folder of ['local', 'tidy', 'vendor', 'crisp', 'kompoze', 'mock-pxc', 'launcher']) {
    fs.cpSync(path.join(root, folder), path.join(repo, folder), { recursive: true });
  }
  fs.mkdirSync(path.join(repo, '.tidy'));
  fs.mkdirSync(path.join(repo, 'experiences'));
  setManifest(repo, { 'pxcube-build-bag': spec() });
  return repo;
}
export function setManifest(repo, types) {
  fs.writeFileSync(path.join(repo, '.tidy/manifest.json'), JSON.stringify({ schemaVersion: 1, types }, null, 2) + '\n');
}
export const cli = (repo, ...args) => spawnSync(process.execPath, [path.join(repo, 'crisp/bin/crisp'), ...args], { cwd: repo, encoding: 'utf8' });
