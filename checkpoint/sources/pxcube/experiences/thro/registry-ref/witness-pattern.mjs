// Calculation: WitnessPattern Runner & Formatter
// Inputs: Calculation { id, description, guarantees, calculate }, Corpus (array of items with truth)
// Outputs: WitnessReport { calculationId, guarantees, assumptions, summary, items, humanTail }

export function evaluateRayContainment(truthEllipse, coarseEllipse, angles = 360) {
  const deg = Math.PI / 180;
  const radiusFromCenter = (ell, cx, cy, theta) => {
    // Ray p(r) = (cx + r cos theta, cy + r sin theta) intersecting truth ellipse
    const ux = Math.cos(theta), uy = Math.sin(theta);
    const dx = cx - ell.cx, dy = cy - ell.cy;
    const ca = Math.cos(ell.angle * deg), sa = Math.sin(ell.angle * deg);
    const x0 = dx * ca + dy * sa, y0 = -dx * sa + dy * ca;
    const vx = ux * ca + uy * sa, vy = -ux * sa + uy * ca;
    const rx = Math.max(1e-6, Math.abs(ell.rx)), ry = Math.max(1e-6, Math.abs(ell.ry));
    const A = (vx * vx) / (rx * rx) + (vy * vy) / (ry * ry);
    const B = 2 * ((x0 * vx) / (rx * rx) + (y0 * vy) / (ry * ry));
    const C = (x0 * x0) / (rx * rx) + (y0 * y0) / (ry * ry) - 1;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return NaN;
    const r = (-B + Math.sqrt(disc)) / (2 * A);
    return r > 0 ? r : NaN;
  };
  const radiusAlongSelf = (ell, theta) => {
    const a = ell.angle * deg;
    const u = Math.cos(theta - a), v = Math.sin(theta - a);
    return 1 / Math.sqrt((u / Math.max(1e-6, Math.abs(ell.rx))) ** 2 + (v / Math.max(1e-6, Math.abs(ell.ry))) ** 2);
  };

  const R1Truth = Math.max(Math.abs(truthEllipse.rx), Math.abs(truthEllipse.ry));
  let maxRelExcursion = 0;
  let maxPxExcursion = 0;
  let sumSqPx = 0;
  let minRatio = Infinity;
  let maxRatio = -Infinity;
  let validRays = 0;
  const arcMaxRel = new Array(8).fill(0);

  for (let k = 0; k < angles; k++) {
    const theta = (2 * Math.PI * k) / angles;
    const rCoarse = radiusAlongSelf(coarseEllipse, theta);
    const rTruthFromCoarseCenter = radiusFromCenter(truthEllipse, coarseEllipse.cx, coarseEllipse.cy, theta);
    if (!Number.isFinite(rTruthFromCoarseCenter) || !Number.isFinite(rCoarse) || rCoarse <= 0) {
      maxRelExcursion = Infinity;
      maxPxExcursion = Infinity;
      minRatio = 0;
      maxRatio = Infinity;
      break;
    }
    const diffPx = Math.abs(rTruthFromCoarseCenter - rCoarse);
    const relErr = diffPx / R1Truth;
    const ratio = rTruthFromCoarseCenter / rCoarse;
    if (relErr > maxRelExcursion) maxRelExcursion = relErr;
    if (diffPx > maxPxExcursion) maxPxExcursion = diffPx;
    if (ratio < minRatio) minRatio = ratio;
    if (ratio > maxRatio) maxRatio = ratio;
    sumSqPx += diffPx * diffPx;
    validRays++;
    const octant = Math.min(7, Math.floor((k / angles) * 8));
    if (relErr > arcMaxRel[octant]) arcMaxRel[octant] = relErr;
  }

  const centerErrPx = Math.hypot(coarseEllipse.cx - truthEllipse.cx, coarseEllipse.cy - truthEllipse.cy);
  const centerErrRel = centerErrPx / R1Truth;
  const rCoarseMajor = Math.max(Math.abs(coarseEllipse.rx), Math.abs(coarseEllipse.ry));
  const rCoarseMinor = Math.min(Math.abs(coarseEllipse.rx), Math.abs(coarseEllipse.ry));
  const rTruthMinor = Math.min(Math.abs(truthEllipse.rx), Math.abs(truthEllipse.ry));

  return {
    validRays,
    centerErrPx: round(centerErrPx, 2),
    centerErrRel: round(centerErrRel, 4),
    r1ErrRel: round(Math.abs(rCoarseMajor - R1Truth) / R1Truth, 4),
    r2ErrRel: round(Math.abs(rCoarseMinor - rTruthMinor) / R1Truth, 4),
    rmsRayPx: validRays ? round(Math.sqrt(sumSqPx / validRays), 2) : null,
    maxPxExcursion: Number.isFinite(maxPxExcursion) ? round(maxPxExcursion, 2) : null,
    maxRelExcursion: Number.isFinite(maxRelExcursion) ? round(maxRelExcursion, 4) : null,
    requiredBandLo: Number.isFinite(minRatio) ? round(minRatio, 4) : null,
    requiredBandHi: Number.isFinite(maxRatio) ? round(maxRatio, 4) : null,
    octantMaxRel: arcMaxRel.map((v) => round(v, 4)),
  };
}

// Calculation: runWitnessedCalculation
// Inputs: calcDef { id, description, guarantees, calculate, witnessItem }, corpus
// Outputs: WitnessReport (machine-readable JSON + compressed humanTail string)
export function runWitnessedCalculation(calcDef, corpus) {
  const items = [];
  const assumptionCounts = {};
  const tStart = Date.now();

  for (const entry of corpus) {
    const t0 = Date.now();
    const produced = calcDef.calculate(entry);
    const ms = Date.now() - t0;
    const witnessed = calcDef.witnessItem(entry, produced, ms);
    for (const [k, v] of Object.entries(produced.assumptions ?? {})) {
      if (!assumptionCounts[k]) assumptionCounts[k] = { pass: 0, fail: 0, violatedOn: [] };
      if (v) assumptionCounts[k].pass++;
      else {
        assumptionCounts[k].fail++;
        assumptionCounts[k].violatedOn.push(entry.name);
      }
    }
    items.push(witnessed);
  }

  const totalMs = Date.now() - tStart;
  const guaranteeResults = {};
  for (const g of calcDef.guarantees) {
    const verdict = g.check(items, assumptionCounts);
    guaranteeResults[g.id] = {
      id: g.id,
      description: g.description,
      passed: verdict.passed,
      passCount: verdict.passCount,
      totalCount: verdict.totalCount,
      metric: verdict.metric,
      failures: verdict.failures ?? [],
    };
  }

  const allGuaranteesPassed = Object.values(guaranteeResults).every((g) => g.passed);
  const sortedByWorst = [...items].sort((a, b) => (b.metrics?.maxRelExcursion ?? 999) - (a.metrics?.maxRelExcursion ?? 999));
  const rels = items.map((x) => x.metrics?.maxRelExcursion ?? 999).sort((a, b) => a - b);
  const centers = items.map((x) => x.metrics?.centerErrRel ?? 999).sort((a, b) => a - b);

  const summary = {
    calculationId: calcDef.id,
    description: calcDef.description,
    selfGuaranteeStatus: allGuaranteesPassed ? 'PASS' : 'FAIL',
    corpusSize: items.length,
    totalMs,
    medianMaxRelExcursion: round(percentile(rels, 0.5), 4),
    p90MaxRelExcursion: round(percentile(rels, 0.9), 4),
    worstMaxRelExcursion: round(rels[rels.length - 1] ?? 999, 4),
    medianCenterErrRel: round(percentile(centers, 0.5), 4),
    worstCenterErrRel: round(centers[centers.length - 1] ?? 999, 4),
    globalBandEnvelope: {
      lo: round(Math.min(...items.map((x) => x.metrics?.requiredBandLo ?? 0)), 4),
      hi: round(Math.max(...items.map((x) => x.metrics?.requiredBandHi ?? 999)), 4),
    },
    worstCases: sortedByWorst.slice(0, 5).map((x) => ({
      name: x.name,
      maxRelExcursion: x.metrics?.maxRelExcursion,
      centerErrPx: x.metrics?.centerErrPx,
      requiredBand: [x.metrics?.requiredBandLo, x.metrics?.requiredBandHi],
    })),
  };

  const report = {
    schema: 'WitnessReport@1',
    calculationId: calcDef.id,
    description: calcDef.description,
    selfGuaranteeStatus: summary.selfGuaranteeStatus,
    guarantees: guaranteeResults,
    assumptions: assumptionCounts,
    summary,
    items,
  };

  report.humanTail = formatCompressedWitnessTail(report);
  return report;
}

export function formatCompressedWitnessTail(report) {
  const s = report.summary;
  const gLines = Object.values(report.guarantees).map(
    (g) => `  [${g.passed ? 'PASS' : 'FAIL'}] ${g.id.padEnd(24)} ${String(g.passCount).padStart(2)}/${g.totalCount}  (${g.metric})`
  );
  const aLines = Object.entries(report.assumptions).map(
    ([k, v]) => `${k}:${v.fail === 0 ? 'OK' : `FAIL(${v.fail})`}`
  );
  const wLines = s.worstCases
    .map((w) => `${w.name}(±${(w.maxRelExcursion * 100).toFixed(1)}%, dc=${w.centerErrPx}px)`)
    .join(', ');

  return [
    `=== WITNESS: ${report.calculationId} [${report.selfGuaranteeStatus}] (${s.totalMs}ms / ${s.corpusSize} items) ===`,
    ...gLines,
    `  BandTightness (max|r_GT-r0|/R1): med ${(s.medianMaxRelExcursion * 100).toFixed(1)}% | p90 ${(s.p90MaxRelExcursion * 100).toFixed(1)}% | max ${(s.worstMaxRelExcursion * 100).toFixed(1)}% | 36-disc envelope [${s.globalBandEnvelope.lo.toFixed(2)}, ${s.globalBandEnvelope.hi.toFixed(2)}]`,
    `  Assumptions: ${aLines.join(' | ')}`,
    `  Worst 5: ${wLines}`,
  ].join('\n');
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
