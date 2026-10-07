// Additive bridge for preview/build callers. Crisp can surface advice before
// activation, but the advisory store never changes package behavior or gates
// an unrelated Experience.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOptimizationStore, selectOptimizations } from '../../browser-optimizations/lib/store.mjs';

export const DEFAULT_BROWSER_OPTIMIZATION_STORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'browser-optimizations', 'registry.json');

export async function crispOptimizationAdvisory({ storePath = DEFAULT_BROWSER_OPTIMIZATION_STORE, scope, tag } = {}) {
  const store = await loadOptimizationStore(storePath);
  return selectOptimizations(store, { lane: 'crisp', scope, tag });
}
