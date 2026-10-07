// Additive bridge for consumers that want to inspect browser optimization
// advice alongside Tidy lineage. Tidy does not gate registration or promotion
// on this store.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOptimizationStore, selectOptimizations } from '../../browser-optimizations/lib/store.mjs';

export const DEFAULT_BROWSER_OPTIMIZATION_STORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'browser-optimizations', 'registry.json');

export async function tidyOptimizationAdvisory({ storePath = DEFAULT_BROWSER_OPTIMIZATION_STORE, scope, tag } = {}) {
  const store = await loadOptimizationStore(storePath);
  return selectOptimizations(store, { lane: 'tidy', scope, tag });
}
