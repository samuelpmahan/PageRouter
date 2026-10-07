import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileHash, safePath } from '../facts.mjs';
import { kompozeMergeQueue } from '../policies/kompoze.mjs';
import { crispMergeQueue } from '../policies/crisp.mjs';
import { completeMergeBatch } from '../policies/neat.mjs';
import { recordBuild, validateBuild } from '../policies/tidy.mjs';
import { integrationFiles, validateMergeRelease } from '../transport/localci_merge.mjs';

/** Use the canonical tree: Kompoze selects, Crisp materializes, Tidy/LocalCI check, Neat records. */
export async function runMergeQueue(root, recipePath, workItems, source, runtime,
  overrides = { runArgs: {}, viewArgs: {} }, { promote = true } = {}) {
  const selected = await kompozeMergeQueue(root, recipePath, workItems, overrides);
  if (await fileHash(source.path) !== source.sha256 ||
      selected.resolved.source.contract.sha256 && selected.resolved.source.contract.sha256 !== source.sha256) throw Error('Merge source differs from selected Part declaration');
  const build = await validateBuild(root, await integrationFiles(root, selected.resolved));
  const crisp = await crispMergeQueue(root, selected, source, runtime);
  const directory = join(root, 'work/merge-runs');
  await mkdir(directory, { recursive: true });
  const tidyPath = `work/merge-runs/tidy-${randomUUID()}.json`;
  await writeFile(safePath(root, tidyPath), JSON.stringify(build, null, 2) + '\n');
  const bindings = { plan: { path: selected.path, sha256: selected.sha256 },
    crisp: { path: crisp.path, sha256: crisp.sha256 },
    tidy: { path: tidyPath, sha256: await fileHash(safePath(root, tidyPath)) } };
  const localci = await validateMergeRelease(root, bindings);
  const entries = localci.receipt.entries;
  const receipt = { schema: 'neat-promotion-batch@2', status: 'PROMOTED', target: recipePath,
    entries, targetContentId: build.contentId,
    validation: { ...bindings, localci: { path: localci.path, sha256: localci.sha256 } } };
  const receiptPath = `work/merge-runs/promotion-${randomUUID()}.json`;
  await writeFile(safePath(root, receiptPath), JSON.stringify(receipt, null, 2) + '\n');
  const receiptSha256 = await fileHash(safePath(root, receiptPath));
  if (promote) {
    await completeMergeBatch(root, { receiptPath, receiptSha256 });
    await recordBuild(root, build);
  }
  return { receiptPath, receiptSha256, receipt, plan: selected.path, crisp: crisp.path,
    localci: localci.path, targetOutputs: crisp.testimony.target.outputs };
}
