import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The honest check: re-hash the deployed chunks and compare them to the
// receipt's wiring manifest. This verifies the artifact itself, not the source
// tree it was built from. There is no source-drift gate because exp work is a
// live pointer; content hashes exist only on frozen builds, recorded by tidy
// at promotion. Anyone can run this against the live Page.
export async function verifyReceipt(receiptPath, chunksDir) {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const expected = receipt.chunks ?? [];
  const mismatches = [];
  for (const chunk of expected) {
    let bytes;
    try {
      bytes = await readFile(join(chunksDir, chunk.path));
    } catch {
      mismatches.push({ path: chunk.path, reason: 'missing' });
      continue;
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== chunk.sha256) {
      mismatches.push({ path: chunk.path, reason: 'hash mismatch', expected: chunk.sha256, actual });
    }
  }
  return {
    ok: mismatches.length === 0,
    chunks: expected.length,
    mismatches,
    app: receipt.app ?? null,
  };
}
