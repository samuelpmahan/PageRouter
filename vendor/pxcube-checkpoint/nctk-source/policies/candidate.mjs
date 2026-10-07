import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonical, fileHash, safePath } from '../facts.mjs';
import { candidateFiles } from './tidy.mjs';

export async function captureCandidate(root, checkpointPath, { workItem, target, affectedAddresses, dependsOn = [] }) {
  if (!workItem || !target || !Array.isArray(dependsOn)) throw Error('Invalid candidate identity');
  await readFile(safePath(root, workItem));
  await readFile(safePath(root, target));
  const checkpoint = { schema: 'nctk-merge-candidate@1', workItem, target,
    affectedAddresses: [...affectedAddresses].sort(), dependsOn,
    claims: await candidateFiles(root, affectedAddresses) };
  const path = safePath(root, checkpointPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(checkpoint, null, 2) + '\n', { flag: 'wx' });
  return { checkpointPath, candidateSha256: await fileHash(path), checkpoint };
}

export async function verifyCandidate(root, checkpointPath, expected = {}) {
  const path = safePath(root, checkpointPath), checkpoint = JSON.parse(await readFile(path, 'utf8'));
  if (checkpoint.schema !== 'nctk-merge-candidate@1' || !checkpoint.workItem || !checkpoint.target ||
      !Array.isArray(checkpoint.affectedAddresses) || !checkpoint.affectedAddresses.length || !Array.isArray(checkpoint.dependsOn)) throw Error('Invalid managed candidate checkpoint');
  if (expected.workItem && checkpoint.workItem !== expected.workItem || expected.target && checkpoint.target !== expected.target ||
      expected.candidateSha256 && await fileHash(path) !== expected.candidateSha256) throw Error('Candidate checkpoint identity differs');
  const actual = await candidateFiles(root, checkpoint.affectedAddresses);
  if (canonical(actual) !== canonical(checkpoint.claims)) throw Error('Candidate managed authored bytes changed');
  return { checkpoint, candidateSha256: await fileHash(path) };
}
