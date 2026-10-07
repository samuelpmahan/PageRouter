/**
 * Additive references for neat work/evidence. The reusable store is JSON and
 * remains advisory; neat's existing item schema and board are unchanged.
 */
export type OptimizationId = "BO-0001" | "BO-0002" | "BO-0006" | "BO-0007" | (string & {});

export interface OptimizationReference {
  id: OptimizationId;
  reason?: string;
  evidenceRefs?: string[];
}

export function optimizationReference(id: OptimizationId, reason?: string): OptimizationReference {
  return { id, ...(reason ? { reason } : {}) };
}
