// Shared helpers for the crisp CLI tests.
// Every test copies its fixture into a fresh unique tmp dir before
// running the CLI, so tests stay independent of each other.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CRISP_BIN = path.join(ROOT, 'crisp', 'bin', 'crisp');
const FIXTURES = path.join(ROOT, 'fixtures');

export function freshTmp(fixtureName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-test-'));
  fs.cpSync(path.join(FIXTURES, fixtureName), dir, { recursive: true });
  return dir;
}

export function crisp(...args) {
  return spawnSync('node', [CRISP_BIN, ...args], { encoding: 'utf8', timeout: 180000 });
}
