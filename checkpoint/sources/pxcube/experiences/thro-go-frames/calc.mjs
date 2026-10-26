// Registered Calculations: every generation / enrichment / metric step is a calcDef run through Argon's runWitnessedCalculation.
import { runWitnessedCalculation } from './witness-pattern.mjs';

export function calculation({ id, description, guarantees, calculate }) {
  return {
    id, description, guarantees, calculate,
    witnessItem: (entry, produced) => ({ name: entry.name, output: produced.output, input: entry, metrics: { maxRelExcursion: 0 } }),
  };
}
// Guarantee helper: pred(item) returns true or a failure string. Items are { name, output }.
export function guarantee(id, description, pred, metricText = '') {
  return {
    id, description,
    check: (items) => {
      const failures = [];
      for (const it of items) { const r = pred(it); if (r !== true) failures.push(`${it.name}: ${r}`); }
      return { passed: failures.length === 0, passCount: items.length - failures.length, totalCount: items.length, metric: metricText || 'all items', failures: failures.slice(0, 12) };
    },
  };
}
// Run and keep only the deterministic parts (no timings), so the same seed gives the same bytes.
export function runCalculation(calcDef, corpus) {
  const report = runWitnessedCalculation(calcDef, corpus);
  const outputs = {};
  for (const it of report.items) outputs[it.name] = it.output;
  return {
    calculationId: calcDef.id, description: calcDef.description, status: report.selfGuaranteeStatus, corpusSize: report.items.length,
    guarantees: Object.values(report.guarantees).map((g) => ({ id: g.id, description: g.description, passed: g.passed, passCount: g.passCount, totalCount: g.totalCount, metric: g.metric, failures: g.failures })),
    outputs,
  };
}
