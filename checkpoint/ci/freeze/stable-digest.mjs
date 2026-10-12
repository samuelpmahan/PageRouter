#!/usr/bin/env node
// Stable digest of a built PageRouter site (bazel-bin/site.site).
//
// The Bazel build is reproducible in content but not in bytes: the pinned
// PxCube packager stamps wall-clock fields (packagedAt, runId, durationMs and
// run identifiers built from timestamps), and those bytes cascade into the
// embedded compiled snapshot and the catalog's siteBuildId and pxcube digest.
// Two cold builds of the same commit differed in 34 of 829 files, all for
// these reasons only.
//
// This tool masks exactly those fields and nothing else, so equal stable
// digests mean "same site apart from build clocks". It never edits the site.
//
//   node ci/freeze/stable-digest.mjs bazel-bin/site.site [--files]
//
// Prints JSON: stableDigest, file counts, and which files needed masking.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, relative, sep } from 'node:path';

const [, , siteRoot, flag] = process.argv;
if (!siteRoot) {
  console.error('usage: node ci/freeze/stable-digest.mjs <site.site> [--files]');
  process.exit(2);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Wall-clock values only. Each pattern was observed differing between two
// cold builds of the same commit; nothing broader is masked.
const CLOCK_PATTERNS = [
  // ISO instants and run identifiers derived from them, e.g.
  // 2026-10-12T06:33:05.895Z and 2026-10-12T06-33-04-360Z-05eadcbe
  [/\d{4}-\d\d-\d\dT\d\d[:-]\d\d[:-]\d\d[.-]\d{3}Z(?:-[0-9a-f]{8})?/g, '<clock>'],
  [/("durationMs"\s*:\s*)\d+/g, '$1<duration>'],
  [/(&quot;durationMs&quot;:\s*)\d+/g, '$1<duration>'],
];

function maskClock(text) {
  let out = text;
  for (const [pattern, replacement] of CLOCK_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return files;
}

// compiled-snapshot@1 stores each file as base64 payload keyed by its sha256.
// Re-express it as path -> sha256(masked content), dropping the raw hashes.
function canonicalSnapshot(json) {
  const snapshot = JSON.parse(json);
  const files = {};
  for (const [path, entry] of Object.entries(snapshot.snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
    const content = Buffer.from(snapshot.payloads[entry.sha256], entry.encoding).toString('latin1');
    files[path] = sha256(Buffer.from(maskClock(content), 'latin1'));
  }
  return JSON.stringify({ schema: snapshot.schema, project: snapshot.snapshot.project, files });
}

// The catalog's siteBuildId and the pxcube project's digest/bytes are derived
// from the stamped bytes above; the stable digest already covers what they hash.
function canonicalCatalog(json) {
  const catalog = JSON.parse(json);
  if (catalog.release && 'siteBuildId' in catalog.release) catalog.release.siteBuildId = '<derived>';
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === 'object') {
      if (node.id === 'pxcube' && 'digest' in node) {
        node.digest = '<derived>';
        node.bytes = '<derived>';
      }
      Object.values(node).forEach(visit);
    }
  };
  visit(catalog);
  return maskClock(JSON.stringify(catalog));
}

const records = [];
const masked = [];
for (const path of listFiles(siteRoot)) {
  const raw = readFileSync(join(siteRoot, path));
  let canonical;
  if (path === 'data/pxcube.snapshot.json.gz') {
    canonical = Buffer.from(canonicalSnapshot(gunzipSync(raw).toString('utf8')), 'utf8').toString('latin1');
  } else if (path === 'data/catalog.json') {
    canonical = Buffer.from(canonicalCatalog(raw.toString('utf8')), 'utf8').toString('latin1');
  } else {
    const text = raw.toString('latin1');
    canonical = maskClock(text);
  }
  const canonicalBytes = Buffer.from(canonical, 'latin1');
  if (!canonicalBytes.equals(raw)) masked.push(path);
  records.push({ path, sha256: sha256(canonicalBytes) });
}

const stableDigest = sha256(records.map((r) => `${r.sha256}  ${r.path}\n`).join(''));
const result = {
  schema: 'pagerouter-stable-digest@1',
  stableDigest,
  files: records.length,
  exactFiles: records.length - masked.length,
  maskedFiles: masked,
};
if (flag === '--files') result.records = records;
console.log(JSON.stringify(result, null, 2));
