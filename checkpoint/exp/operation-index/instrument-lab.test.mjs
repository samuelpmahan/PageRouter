import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instrumentLabApp } from './instrument-lab.mjs';

const vendorPath = new URL('../../vendor/capability-lab/ui/app.mjs', import.meta.url);

test('instrumentLabApp wraps the exact vendored execute and replay boundaries', async () => {
  const original = await readFile(vendorPath, 'utf8');
  const instrumented = instrumentLabApp(original);
  assert.equal((instrumented.match(/observeLabRun\(/g) || []).length, 2);
  assert.match(instrumented, /import \{ observeLabRun \} from '\.\.\/references\/operations\/lab-bridge\.mjs';/);
  assert.match(instrumented, /action: 'execute', id: selectedId, run: \(\) => \{ const input = parseInput\(\); return registry\.execute\(selectedId, input\); \}/);
  assert.match(instrumented, /action: 'replay', id: prior\.id, prior, run: \(\) => registry\.replay\(prior\)/);
  assert.match(instrumented, /renderExecution\(output\)/);
  assert.match(instrumented, /renderExecution\(report\.receipt, \{replay:true\}\)/);
  assert.throws(() => instrumentLabApp(instrumented), /already instrumented/);
});

test('instrumentLabApp fails closed when a guarded source block drifts or repeats', async () => {
  const original = await readFile(vendorPath, 'utf8');
  assert.throws(() => instrumentLabApp(original.replace('const input = parseInput();', 'const input = parseInput();\n  const changed = true;')), /execute\(\)/);
  assert.throws(() => instrumentLabApp(`${original}\n${original.slice(original.indexOf('function execute()'), original.indexOf('function replay()'))}`), /execute\(\)/);
  assert.throws(() => instrumentLabApp('export const app = true;'), /unexpected UI module header/);
});
