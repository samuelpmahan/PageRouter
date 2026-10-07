import fs from 'node:fs';
export function assertFreshPxCube(evidence) {
  if (!Array.isArray(evidence.targets) || !evidence.targets.length || !Array.isArray(evidence.report?.results)) throw Error('Missing fresh PxCube build results');
  for (const target of evidence.targets) {
    const result = evidence.report.results.find(row => row.id === target.id);
    if (result?.ok !== true) throw Error(`PxCube package failed: ${target.id}: ${result?.error ?? 'missing result'}`);
  }
  for (const result of evidence.report.results) {
    if (result.ok !== true) throw Error(`PxCube package failed: ${result.id}: ${result.error}`);
  }
  if (!evidence.site || !fs.existsSync(evidence.site) || !fs.statSync(evidence.site).isDirectory()) throw Error('Fresh PxCube site is missing; shipped-byte relocation is forbidden');
}
