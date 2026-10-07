// Resolves the locally assembled PxCube site (the same output `node
// local/ci.mjs` produces and CI deploys). The E2E suite tests what ships.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../../run.mjs';

let cached = null;

export function siteDir() {
  if (cached) return cached;
  const latestPath = path.join(root, '.pxcube/latest.json');
  if (!fs.existsSync(latestPath)) {
    throw new Error('No assembled site found. Run `node local/ci.mjs` first.');
  }
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const site = path.join(root, latest.site);
  if (!fs.existsSync(site)) {
    throw new Error(`Assembled site missing at ${site}. Run \`node local/ci.mjs\` first.`);
  }
  cached = site;
  return site;
}

export function siteFile(...parts) {
  return pathToFileURL(path.join(siteDir(), ...parts)).href;
}

export function sitePath(...parts) {
  return path.join(siteDir(), ...parts);
}
