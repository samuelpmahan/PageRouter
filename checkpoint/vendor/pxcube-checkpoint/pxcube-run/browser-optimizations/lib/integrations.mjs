import { DEFAULT_STORE_PATH, loadOptimizationStore, selectOptimizations } from './store.mjs';

/**
 * Narrow lane integration: all three lanes may consult the same advisory
 * store, but none of them is required to run it as a build or deployment gate.
 */
export const LANE_INTEGRATION = Object.freeze({
  neat: Object.freeze({ role: 'link work/evidence to reusable browser patterns', mode: 'advisory' }),
  tidy: Object.freeze({ role: 'retain optimization references beside lineage', mode: 'advisory' }),
  crisp: Object.freeze({ role: 'offer artifact/runtime checks before preview activation', mode: 'advisory' }),
});

export async function optimizationAdvisory({ lane, storePath = DEFAULT_STORE_PATH, scope, tag } = {}) {
  if (!Object.hasOwn(LANE_INTEGRATION, lane)) throw new Error(`unknown PxCube lane "${lane}"`);
  const store = await loadOptimizationStore(storePath);
  return {
    lane,
    mode: LANE_INTEGRATION[lane].mode,
    role: LANE_INTEGRATION[lane].role,
    records: selectOptimizations(store, { scope, lane, tag }),
  };
}
