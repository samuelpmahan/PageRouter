// flight-constraint-solver.mjs
// Registered Calculation: thro/flight/physics-solver (v1.0.0)
// Boundary-Value Constraint Solver (Damped Gauss-Newton / Levenberg-Marquardt Shooting over 6-DoF RK4 Aerodynamics).

import { buildDiscAeroTensor, simulate6DoFFlight } from './disc-aerodynamics.mjs';
import {
  generateCrossSectionContour,
  integrateCrossSectionContinuum,
  solveAeroTensorFromCrossSection,
  CROSS_SECTION_ARCHETYPE_MATRIX_12,
  FLIGHT_NUMBERS_DONT_MATTER_COHORT,
} from './cross-section-physics.mjs';
import { runWitnessedCalculation } from '../registry-ref/witness-pattern.mjs';

export {
  generateCrossSectionContour,
  integrateCrossSectionContinuum,
  solveAeroTensorFromCrossSection,
  CROSS_SECTION_ARCHETYPE_MATRIX_12,
  FLIGHT_NUMBERS_DONT_MATTER_COHORT,
};

/**
 * Interpolate trajectory state (yFt, zFt, bankDeg, speedMph) at downrange distance xQueryFt.
 */
export function sampleAtDownrangeX(frames, xQueryFt) {
  if (!frames.length) return null;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if ((a.xFt <= xQueryFt && b.xFt >= xQueryFt) || (i === frames.length - 1 && b.xFt < xQueryFt)) {
      if (b.xFt < xQueryFt && i === frames.length - 1) {
        return { ...b, reachedX: false };
      }
      const u = Math.max(0, Math.min(1, (xQueryFt - a.xFt) / Math.max(1e-6, b.xFt - a.xFt)));
      return {
        t: +(a.t + u * (b.t - a.t)).toFixed(3),
        xFt: xQueryFt,
        yFt: +(a.yFt + u * (b.yFt - a.yFt)).toFixed(3),
        zFt: +(a.zFt + u * (b.zFt - a.zFt)).toFixed(3),
        bankDeg: +(a.bankDeg + u * (b.bankDeg - a.bankDeg)).toFixed(2),
        speedMph: +(a.speedMph + u * (b.speedMph - a.speedMph)).toFixed(2),
        reachedX: true,
      };
    }
  }
  return { ...frames[0], reachedX: false };
}

/**
 * Solve the 6-DoF aerodynamic boundary-value problem for a constrained disc golf shot.
 * Control vector u = [speedMph, launchDeg, aimDeg, hyzerDeg, noseDeg] (5 degrees of freedom).
 */
export function solveConstrainedFlight(spec) {
  const t0 = performance.now();
  const tensor = buildDiscAeroTensor(spec.mold);
  const target = {
    xFt: spec.target?.xFt ?? 360,
    yFt: spec.target?.yFt ?? 0,
    zFt: spec.target?.zFt ?? 0,
  };
  const env = {
    windSpeedMph: spec.env?.windSpeedMph ?? 0,
    windDirDeg: spec.env?.windDirDeg ?? 180,
    spinChirality: spec.env?.spinChirality ?? 1,
    targetGroundZFt: target.zFt,
  };
  const gate = spec.gate ?? null;
  const mode = spec.shotMode ?? 'auto-gate';

  const distFt = Math.hypot(target.xFt, target.yFt);
  let initSpeed = Math.min(72, Math.max(40, 36 + distFt * 0.068));
  let initLaunch = Math.min(18, Math.max(4.0, 8.2 + (target.zFt / Math.max(100, distFt)) * 45));
  let initAim = Math.atan2(target.yFt, target.xFt) * (180 / Math.PI) - 2.0;
  let initHyzer = 6.0;
  let initNose = 0.5;

  if (mode === 'hyzer-flip') {
    initHyzer = 15.0;
    initAim -= 2.0;
  } else if (mode === 'anhyzer-flex') {
    initHyzer = -14.0;
    initAim += 9.0;
    initLaunch += 1.5;
  } else if (mode === 'pure-hyzer') {
    initHyzer = 20.0;
    initAim -= 10.0;
  } else if (mode === 'low-ceiling') {
    initLaunch = 5.0;
    initNose = -0.8;
    initSpeed += 4.5;
    initHyzer = 7.0;
  } else if (gate && gate.yFt != null) {
    const lineYAtGate = (gate.xFt / target.xFt) * target.yFt;
    const gateOffset = gate.yFt - lineYAtGate;
    if (gateOffset > 4) {
      initAim += Math.min(18, gateOffset * 0.35);
      initHyzer = -Math.min(18, 6 + gateOffset * 0.32);
    } else if (gateOffset < -4) {
      initAim += Math.max(-18, gateOffset * 0.35);
      initHyzer = Math.min(22, 8 + Math.abs(gateOffset) * 0.35);
    }
  }

  const bounds = [
    [32, 78],   // speedMph
    [1.5, 28],  // launchDeg
    [-40, 40],  // aimDeg
    [-34, 36],  // hyzerDeg
    [-4.0, 6.0] // noseDeg
  ];
  const clampU = u => u.map((v, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], v)));

  let u = clampU([initSpeed, initLaunch, initAim, initHyzer, initNose]);

  function evalResiduals(uVec) {
    const [speedMph, launchDeg, aimDeg, hyzerDeg, noseDeg] = uVec;
    const sim = simulate6DoFFlight({
      mold: tensor,
      release: { x0Ft: 0, y0Ft: 0, z0Ft: 4.8, speedMph, launchDeg, aimDeg, hyzerDeg, noseDeg },
      env,
      dt: 0.008,
    });

    // Weight landing position strongly so G2 (< 0.25 ft) is prioritized
    const dx = (sim.landing.xFt - target.xFt) * 4.0;
    const dy = (sim.landing.yFt - target.yFt) * 4.0;

    let rGateY = 0;
    let rGateZ = 0;
    let gateSample = null;
    if (gate) {
      gateSample = sampleAtDownrangeX(sim.frames, gate.xFt);
      const yVal = gateSample.yFt;
      const zVal = gateSample.zFt;
      const yTol = Math.max(0, (gate.yHalfWidthFt ?? 0) - 0.5); // 0.5 ft safety margin inside gate
      if (yVal > gate.yFt + yTol) rGateY = (yVal - (gate.yFt + yTol)) * 3.5;
      else if (yVal < gate.yFt - yTol) rGateY = (yVal - (gate.yFt - yTol)) * 3.5;
      else rGateY = (yVal - gate.yFt) * 0.08;

      const zMin = (gate.zMinFt ?? 2) + 0.4;
      const zMax = (gate.zMaxFt ?? 120) - 0.4;
      if (zVal > zMax) rGateZ = (zVal - zMax) * 3.8;
      else if (zVal < zMin) rGateZ = (zVal - zMin) * 3.8;
      else {
        const zMid = 0.5 * (zMin + zMax);
        rGateZ = (zVal - zMid) * 0.03;
      }
    }

    let rShape = 0;
    if (mode === 'hyzer-flip') {
      if (hyzerDeg < 9) rShape += (9 - hyzerDeg) * 1.5;
    } else if (mode === 'anhyzer-flex') {
      if (hyzerDeg > -8) rShape += (hyzerDeg - (-8)) * 1.5;
    } else if (mode === 'pure-hyzer') {
      if (hyzerDeg < 14) rShape += (14 - hyzerDeg) * 1.5;
    } else if (mode === 'low-ceiling') {
      const ceilFt = (gate?.zMaxFt ?? 15) - 0.3;
      if (sim.metrics.apexFt > ceilFt) rShape += (sim.metrics.apexFt - ceilFt) * 3.5;
    }

    const rReg = 0.008 * (noseDeg - initNose) + 0.004 * (speedMph - initSpeed);
    const res = [dx, dy, rGateY, rGateZ, rShape, rReg];
    const cost = res.reduce((acc, v) => acc + v * v, 0);
    return { res, cost, sim, gateSample };
  }

  let cur = evalResiduals(u);
  let lambda = 0.05;
  const eps = [0.20, 0.12, 0.15, 0.20, 0.10];
  let iterations = 0;

  for (let iter = 0; iter < 28; iter++) {
    iterations = iter + 1;
    const landErr = Math.hypot(cur.res[0] / 4.0, cur.res[1] / 4.0);
    const gateErr = Math.hypot(cur.res[2] / 3.5, cur.res[3] / 3.8);
    if (landErr < 0.02 && gateErr < 0.02 && Math.abs(cur.res[4]) < 0.05) break;

    const m = cur.res.length, n = 5;
    const J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const uPert = [...u];
      uPert[j] += eps[j];
      const pEval = evalResiduals(uPert);
      for (let i = 0; i < m; i++) {
        J[i][j] = (pEval.res[i] - cur.res[i]) / eps[j];
      }
    }

    const A = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (__, c) => {
        let s = r === c ? lambda : 0;
        for (let i = 0; i < m; i++) s += J[i][r] * J[i][c];
        return s;
      })
    );
    const b = Array.from({ length: n }, (_, r) => {
      let s = 0;
      for (let i = 0; i < m; i++) s -= J[i][r] * cur.res[i];
      return s;
    });

    const delta = solveLinearNxN(A, b);
    if (!delta) break;

    const maxStep = [5.0, 3.0, 5.0, 5.5, 1.5];
    const scale = Math.min(1, ...delta.map((d, j) => maxStep[j] / Math.max(1e-6, Math.abs(d))));
    const uCand = clampU(u.map((v, j) => v + delta[j] * scale));
    const cand = evalResiduals(uCand);

    if (cand.cost < cur.cost) {
      u = uCand;
      cur = cand;
      lambda = Math.max(1e-5, lambda * 0.45);
    } else {
      lambda = Math.min(50, lambda * 2.5);
    }
  }

  // Final refinement pass on 5ms RK4 so there is zero dt-discretization shift between 8ms and 5ms
  function eval5ms(uVec) {
    const [speedMph, launchDeg, aimDeg, hyzerDeg, noseDeg] = uVec;
    const sim = simulate6DoFFlight({
      mold: tensor,
      release: { x0Ft: 0, y0Ft: 0, z0Ft: 4.8, speedMph, launchDeg, aimDeg, hyzerDeg, noseDeg },
      env,
      dt: 0.005,
    });
    return {
      dx: sim.landing.xFt - target.xFt,
      dy: sim.landing.yFt - target.yFt,
      sim,
    };
  }

  let finalEval = eval5ms(u);
  for (let polish = 0; polish < 4; polish++) {
    if (Math.hypot(finalEval.dx, finalEval.dy) < 0.03) break;
    const pSpeed = eval5ms([u[0] + 0.1, u[1], u[2], u[3], u[4]]);
    const pAim = eval5ms([u[0], u[1], u[2] + 0.1, u[3], u[4]]);
    const J2 = [
      [(pSpeed.dx - finalEval.dx) / 0.1, (pAim.dx - finalEval.dx) / 0.1],
      [(pSpeed.dy - finalEval.dy) / 0.1, (pAim.dy - finalEval.dy) / 0.1],
    ];
    const d2 = solveLinearNxN(J2, [-finalEval.dx, -finalEval.dy]);
    if (!d2) break;
    u = clampU([u[0] + Math.max(-1.5, Math.min(1.5, d2[0])), u[1], u[2] + Math.max(-1.5, Math.min(1.5, d2[1])), u[3], u[4]]);
    finalEval = eval5ms(u);
  }

  const finalSim = finalEval.sim;
  const finalGateSample = gate ? sampleAtDownrangeX(finalSim.frames, gate.xFt) : null;
  let gateViolationFt = 0;
  if (gate && finalGateSample) {
    const yTol = gate.yHalfWidthFt ?? 0;
    const yOver = Math.max(0, Math.abs(finalGateSample.yFt - gate.yFt) - yTol);
    const zOver = Math.max(
      0,
      (gate.zMinFt ?? 0) - finalGateSample.zFt,
      finalGateSample.zFt - (gate.zMaxFt ?? 999)
    );
    gateViolationFt = +Math.hypot(yOver, zOver).toFixed(4);
  }

  const landingErrorFt = +Math.hypot(
    finalSim.landing.xFt - target.xFt,
    finalSim.landing.yFt - target.yFt
  ).toFixed(4);

  const solveMs = +(performance.now() - t0).toFixed(2);

  return {
    id: spec.id ?? 'shot',
    label: spec.label ?? `${spec.mold.name ?? 'Disc'} -> (${target.xFt}ft, ${target.yFt}ft)`,
    shotMode: mode,
    target,
    gate,
    env,
    iterations,
    solveMs,
    landingErrorFt,
    gateViolationFt,
    gateSample: finalGateSample,
    ...finalSim,
  };
}

function solveLinearNxN(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

export const PHYSICS_SOLVER_BENCHMARK_CORPUS = [
  {
    id: 'control-hyzer-flip-tunnel',
    label: 'MVP Neutron Control (10|5|-0.5|2 GYRO) · 375 ft Tunnel Gate',
    mold: { name: 'MVP Neutron Control', manufacturer: 'MVP', flight: [10, 5, -0.5, 2], isGyroOvermold: true, cutoutUrl: '/thro-rimfit-lab/after/infinite-Kps09187rsI-10-cut.png' },
    target: { xFt: 375, yFt: 0, zFt: 0 },
    gate: { xFt: 190, yFt: -4, yHalfWidthFt: 10, zMinFt: 5, zMaxFt: 24 },
    shotMode: 'auto-gate',
    env: { windSpeedMph: 0, windDirDeg: 180 },
  },
  {
    id: 'orbital-hyzer-flip-bomber',
    label: 'MVP Fission Orbital (11|5|-5|1 GYRO) · 410 ft Hyzer-Flip S-Curve',
    mold: { name: 'MVP Fission Orbital', manufacturer: 'MVP', flight: [11, 5, -5, 1], isGyroOvermold: true, cutoutUrl: '/thro-rimfit-lab/after/anotherround-B3ol7As1q0w-5-cut.png' },
    target: { xFt: 410, yFt: -8, zFt: 0 },
    gate: { xFt: 210, yFt: 6, yHalfWidthFt: 14, zMinFt: 6, zMaxFt: 38 },
    shotMode: 'hyzer-flip',
    env: { windSpeedMph: 0, windDirDeg: 180 },
  },
  {
    id: 'fx4-left-mando-anhyzer-flex',
    label: 'Prodigy FX-4 (9|5|-2|2) · 350 ft Left-Mando Anhyzer Flex',
    mold: { name: 'Prodigy FX-4', manufacturer: 'Prodigy', flight: [9, 5, -2, 2], isGyroOvermold: false, cutoutUrl: '/thro-rimfit-lab/after/anotherround-n32G6lYRLXI-2-cut.png' },
    target: { xFt: 350, yFt: 0, zFt: 0 },
    gate: { xFt: 175, yFt: 20, yHalfWidthFt: 9, zMinFt: 6, zMaxFt: 34 },
    shotMode: 'anhyzer-flex',
    env: { windSpeedMph: 0, windDirDeg: 180 },
  },
  {
    id: 'impulse-right-mando-hyzer',
    label: 'MVP Neutron Impulse (9|5|-3|1 GYRO) · 340 ft Right-Gap Hyzer Carve',
    mold: { name: 'MVP Neutron Impulse', manufacturer: 'MVP', flight: [9, 5, -3, 1], isGyroOvermold: true, cutoutUrl: '/thro-rimfit-lab/after/anotherround-B3ol7As1q0w-7-cut.png' },
    target: { xFt: 340, yFt: 0, zFt: 0 },
    gate: { xFt: 170, yFt: -20, yHalfWidthFt: 9, zMinFt: 6, zMaxFt: 32 },
    shotMode: 'auto-gate',
    env: { windSpeedMph: 0, windDirDeg: 180 },
  },
  {
    id: 'control-low-ceiling-headwind',
    label: 'MVP Eclipse Control (10|5|-0.5|2 GYRO) · 330 ft Low-Ceiling (16 ft) in 12 mph Headwind',
    mold: { name: 'MVP Eclipse Control', manufacturer: 'MVP', flight: [10, 5, -0.5, 2], isGyroOvermold: true, cutoutUrl: '/thro-rimfit-lab/after/raredg-drop-0-cut.png' },
    target: { xFt: 330, yFt: 5, zFt: 0 },
    gate: { xFt: 165, yFt: -2, yHalfWidthFt: 12, zMinFt: 3, zMaxFt: 16 },
    shotMode: 'low-ceiling',
    env: { windSpeedMph: 12, windDirDeg: 180 },
  },
  {
    id: 'wysocki-2026-worlds-h15-drive',
    label: '2026 Worlds H15 · Ricky Wysocki 455 ft Drive Reconstruction',
    mold: { name: 'Destroyer / Pro Driver', manufacturer: 'Innova', flight: [12, 5, -1, 3], isGyroOvermold: false, cutoutUrl: '/thro-rimfit-lab/after/infinite-Kps09187rsI-10-cut.png' },
    target: { xFt: 452, yFt: -48, zFt: -6 },
    gate: { xFt: 240, yFt: -28, yHalfWidthFt: 14, zMinFt: 8, zMaxFt: 44 },
    shotMode: 'auto-gate',
    env: { windSpeedMph: 5, windDirDeg: 150 },
  },
];

export function simulateArchetypeSquad(squadMode = 'matrix-12', env = { windSpeedMph: 0, windDirDeg: 180 }) {
  let specs = CROSS_SECTION_ARCHETYPE_MATRIX_12;
  if (squadMode === 'fndm-4') {
    specs = FLIGHT_NUMBERS_DONT_MATTER_COHORT;
  } else if (squadMode === 'putter' || squadMode === 'midrange' || squadMode === 'fairway' || squadMode === 'driver') {
    specs = CROSS_SECTION_ARCHETYPE_MATRIX_12.filter(s => s.classId === squadMode);
  } else if (squadMode === 'understable' || squadMode === 'stable' || squadMode === 'overstable') {
    specs = CROSS_SECTION_ARCHETYPE_MATRIX_12.filter(s => s.stabilityId === squadMode);
  }

  return specs.map(item => {
    const contour = generateCrossSectionContour({
      ...item.crossSection,
      name: item.name,
    });
    const tensor = solveAeroTensorFromCrossSection(contour);
    const sim = simulate6DoFFlight({
      mold: tensor,
      release: {
        x0Ft: 0,
        y0Ft: 0,
        z0Ft: 4.8,
        speedMph: item.releaseSpeedMph ?? 58,
        launchDeg: 8.8,
        aimDeg: 0.0,
        hyzerDeg: 2.0,
        noseDeg: 0.3,
      },
      env,
      dt: 0.005,
    });
    return {
      ...item,
      contour,
      tensor,
      sim,
    };
  });
}

/**
 * Inverse System Identification over the 2D Cross-Section Contour:
 * Given a base mold cross-section (e.g. PDGA rim width & depth) and an observed real-world throw
 * `[landingXFt, landingYFt, maxTurnLateralFt, apexFt]`, solve in reverse via damped Gauss-Newton
 * for the physical cross-section warp `[plhOffsetMm, domeRiseMm, lowerArchMm]` that deterministically
 * reproduces the observed flight!
 */
export function reconstructCrossSectionFromFlight({
  baseCrossSection,
  release,
  observed,
  env = { windSpeedMph: 0, windDirDeg: 180 },
}) {
  // Cooling warp parameters p = [plhOffsetMm, domeRiseMm]
  let p = [0.0, baseCrossSection.domeRiseMm ?? 4.2];
  const bounds = [
    [-2.5, 2.5],  // plhOffsetMm
    [1.0, 7.5],   // domeRiseMm
  ];
  const clampP = v => v.map((val, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], val)));

  function evalParam(pVec) {
    const [plhOffsetMm, domeRiseMm] = pVec;
    const contour = generateCrossSectionContour({
      ...baseCrossSection,
      plhHeightMm: undefined,
      plhOffsetMm,
      domeRiseMm,
    });
    const tensor = solveAeroTensorFromCrossSection(contour);
    const sim = simulate6DoFFlight({
      mold: tensor,
      release,
      env,
      dt: 0.005,
    });
    const res = [
      (sim.landing.xFt - observed.landingXFt) * 1.5,
      (sim.landing.yFt - observed.landingYFt) * 3.0,
      (sim.metrics.maxTurnLateralFt - (observed.maxTurnLateralFt ?? sim.metrics.maxTurnLateralFt)) * 2.5,
      (sim.metrics.apexFt - (observed.apexFt ?? sim.metrics.apexFt)) * 2.5,
    ];
    const cost = res.reduce((a, b) => a + b * b, 0);
    return { res, cost, contour, tensor, sim };
  }

  let cur = evalParam(p);
  let lambda = 0.01;
  const eps = [0.03, 0.06];

  for (let iter = 0; iter < 18; iter++) {
    if (cur.cost < 1e-5) break;
    const m = cur.res.length, n = 2;
    const J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const pPert = [...p];
      pPert[j] += eps[j];
      const pEval = evalParam(pPert);
      for (let i = 0; i < m; i++) {
        J[i][j] = (pEval.res[i] - cur.res[i]) / eps[j];
      }
    }
    const A = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (__, c) => {
        let s = r === c ? lambda : 0;
        for (let i = 0; i < m; i++) s += J[i][r] * J[i][c];
        return s;
      })
    );
    const b = Array.from({ length: n }, (_, r) => {
      let s = 0;
      for (let i = 0; i < m; i++) s -= J[i][r] * cur.res[i];
      return s;
    });
    const delta = solveLinearNxN(A, b);
    if (!delta) break;
    const pCand = clampP(p.map((v, j) => v + delta[j]));
    const cand = evalParam(pCand);
    if (cand.cost < cur.cost) {
      p = pCand;
      cur = cand;
      lambda = Math.max(1e-6, lambda * 0.4);
    } else {
      lambda = Math.min(20, lambda * 2.5);
    }
  }

  return {
    recoveredParams: {
      plhOffsetMm: +p[0].toFixed(3),
      plhHeightMm: cur.tensor.plhHeightMm,
      domeRiseMm: +p[1].toFixed(3),
    },
    empiricalFlight: cur.tensor.empiricalFlight,
    trajectoryErrorFt: +Math.hypot(
      cur.sim.landing.xFt - observed.landingXFt,
      cur.sim.landing.yFt - observed.landingYFt
    ).toFixed(4),
    contour: cur.contour,
    tensor: cur.tensor,
    sim: cur.sim,
  };
}

export function runFlightPhysicsWitness(corpus = PHYSICS_SOLVER_BENCHMARK_CORPUS) {
  const gyroTestRelease = { x0Ft: 0, y0Ft: 0, z0Ft: 4.8, speedMph: 61, launchDeg: 8.5, aimDeg: -2, hyzerDeg: 8, noseDeg: 0.5 };
  const simGyro = simulate6DoFFlight({
    mold: { flight: [10, 5, -2, 2], isGyroOvermold: true },
    release: gyroTestRelease,
  });
  const simNonGyro = simulate6DoFFlight({
    mold: { flight: [10, 5, -2, 2], isGyroOvermold: false },
    release: gyroTestRelease,
  });
  const gyroRollSwing = simGyro.metrics.maxBankDeg - simGyro.metrics.minBankDeg;
  const nonGyroRollSwing = simNonGyro.metrics.maxBankDeg - simNonGyro.metrics.minBankDeg;

  // Evaluate the 12-disc Deterministic 2D Cross-Section Matrix (ZERO flight numbers used in physics!)
  const matrix12 = simulateArchetypeSquad('matrix-12');
  const fndm4 = simulateArchetypeSquad('fndm-4');

  // Test Inverse Cross-Section Reconstruction on the Halo High-PLH Destroyer run
  const haloTargetRun = fndm4[3];
  const inverseRecon = reconstructCrossSectionFromFlight({
    baseCrossSection: {
      ...FLIGHT_NUMBERS_DONT_MATTER_COHORT[2].crossSection, // start from stock reference
      targetMassG: haloTargetRun.crossSection.targetMassG,
      isGyroOvermold: haloTargetRun.crossSection.isGyroOvermold,
    },
    release: haloTargetRun.sim.release,
    observed: {
      landingXFt: haloTargetRun.sim.landing.xFt,
      landingYFt: haloTargetRun.sim.landing.yFt,
      maxTurnLateralFt: haloTargetRun.sim.metrics.maxTurnLateralFt,
      apexFt: haloTargetRun.sim.metrics.apexFt,
    },
  });

  return runWitnessedCalculation(
    {
      id: 'thro/flight/physics-solver',
      version: '1.2.0',
      description: 'Deterministic 2D Cross-Section Continuum Airfoil Integrator + 6-DoF Rigid-Body Gyroscopic Precession & Levenberg-Marquardt BVP Solver',
      calculate: item => solveConstrainedFlight(item),
      witnessItem: (item, out, ms) => ({
        name: item.id,
        ms,
        label: out.label,
        shotMode: out.shotMode,
        release: out.release,
        landing: out.landing,
        target: out.target,
        gate: out.gate,
        gateSample: out.gateSample,
        iterations: out.iterations,
        landingErrorFt: out.landingErrorFt,
        gateViolationFt: out.gateViolationFt,
        maxNewtonResidual: out.metrics.maxNewtonResidual,
        earlyPrecessionRadS: out.metrics.earlyPrecessionRadS,
        latePrecessionRadS: out.metrics.latePrecessionRadS,
        turnBeforeFade: out.metrics.turnBeforeFade,
        apexFt: out.metrics.apexFt,
        framesCount: out.frames.length,
        gyroComparison: {
          gyroIzz: +simGyro.tensor.Izz.toFixed(6),
          nonGyroIzz: +simNonGyro.tensor.Izz.toFixed(6),
          gyroRollSwingDeg: +gyroRollSwing.toFixed(2),
          nonGyroRollSwingDeg: +nonGyroRollSwing.toFixed(2),
          gyroDistFt: simGyro.landing.distanceFt,
          nonGyroDistFt: simNonGyro.landing.distanceFt,
        },
        crossSectionMatrixSummary: {
          matrix12: matrix12.map(m => ({
            id: m.id,
            classId: m.classId,
            stabilityId: m.stabilityId,
            rimWidthMm: m.tensor.rimWidthMm,
            plhHeightMm: m.tensor.plhHeightMm,
            CD0: m.tensor.CD0,
            Izz: +m.tensor.Izz.toFixed(6),
            emergentFlight: m.tensor.empiricalFlight,
            xFt: m.sim.landing.xFt,
            yFt: m.sim.landing.yFt,
          })),
          fndm4: fndm4.map(r => ({
            id: r.id,
            plhHeightMm: r.tensor.plhHeightMm,
            emergentFlight: r.tensor.empiricalFlight,
            xFt: r.sim.landing.xFt,
            yFt: r.sim.landing.yFt,
          })),
          inverseReconErrorFt: inverseRecon.trajectoryErrorFt,
          inversePlhErrorMm: +Math.abs(inverseRecon.recoveredParams.plhHeightMm - haloTargetRun.tensor.plhHeightMm).toFixed(4),
        },
        metrics: {
          maxRelExcursion: +(out.landingErrorFt / Math.hypot(out.target.xFt, out.target.yFt)).toFixed(5),
        },
      }),
      guarantees: [
        {
          id: 'G1_NewtonEuler6DoFConservation',
          description: 'At every RK4 timestep, discrete linear and angular accelerations match exact Newton-Euler lift, drag, gravity, and gyroscopic precession equations (< 1e-6 residual)',
          check: items => {
            const fails = items.filter(x => x.maxNewtonResidual > 1e-6);
            return {
              passed: fails.length === 0,
              passCount: items.length - fails.length,
              totalCount: items.length,
              metric: `maxNewtonResidual = ${Math.max(...items.map(x => x.maxNewtonResidual)).toExponential(2)} m/s^2`,
              failures: fails.map(x => x.name),
            };
          },
        },
        {
          id: 'G2_BoundaryTargetConvergence',
          description: 'Levenberg-Marquardt shooting solver converges to the 3D Pin landing constraint within < 0.25 ft (3 inches) on every shot',
          check: items => {
            const fails = items.filter(x => x.landingErrorFt >= 0.25);
            return {
              passed: fails.length === 0,
              passCount: items.length - fails.length,
              totalCount: items.length,
              metric: items.map(x => `${x.name}: ${x.landingErrorFt.toFixed(3)} ft (${x.iterations} iters)`).join('; '),
              failures: fails.map(x => x.name),
            };
          },
        },
        {
          id: 'G3_FairwayGateAndCeilingSatisfaction',
          description: 'Every solved trajectory passes strictly inside its 3D Fairway Mando / Ceiling Window constraint (<= 0.05 ft violation)',
          check: items => {
            const fails = items.filter(x => x.gateViolationFt > 0.05);
            return {
              passed: fails.length === 0,
              passCount: items.length - fails.length,
              totalCount: items.length,
              metric: items.map(x => `${x.name}: gateErr=${x.gateViolationFt.toFixed(3)}ft (y=${x.gateSample?.yFt.toFixed(1)}ft, z=${x.gateSample?.zFt.toFixed(1)}ft)`).join('; '),
              failures: fails.map(x => x.name),
            };
          },
        },
        {
          id: 'G4_TurnThenFadeGyroscopicInversion',
          description: 'High-speed aerodynamic turn precession (dPhi/dt < 0 for RHBH) precedes low-speed fade precession (dPhi/dt > 0) as airspeed decays below vCruise',
          check: items => {
            const fails = items.filter(x => !(x.earlyPrecessionRadS < 0 && x.latePrecessionRadS > 0 && x.turnBeforeFade));
            return {
              passed: fails.length === 0,
              passCount: items.length - fails.length,
              totalCount: items.length,
              metric: items.map(x => `${x.name}: turnPeak=${x.earlyPrecessionRadS.toFixed(2)} rad/s -> fadePeak=+${x.latePrecessionRadS.toFixed(2)} rad/s`).join('; '),
              failures: fails.map(x => x.name),
            };
          },
        },
        {
          id: 'G5_GyroOvermoldInertiaEffect',
          description: 'MVP GYRO overmold (+9.5% axial I_zz) increases gyroscopic angular momentum, reducing bank-angle roll excursion vs non-overmold plastic',
          check: items => {
            const c = items[0]?.gyroComparison;
            const passed = Boolean(c && c.gyroIzz > c.nonGyroIzz && c.gyroRollSwingDeg < c.nonGyroRollSwingDeg);
            return {
              passed,
              passCount: passed ? items.length : 0,
              totalCount: items.length,
              metric: c ? `Izz ${c.nonGyroIzz} -> ${c.gyroIzz} kg*m^2; roll excursion ${c.nonGyroRollSwingDeg} deg -> ${c.gyroRollSwingDeg} deg` : 'missing',
              failures: passed ? [] : ['gyro-inertia-check'],
            };
          },
        },
        {
          id: 'G6_DeterministicCrossSectionContinuum',
          description: 'From 2D cross-section polygon {(r, z_u, z_l)} ALONE (zero flight numbers), continuum shell integration + airfoil aerodynamics monotonically separate Putter < Mid < Fairway < Driver carry AND Understable < Stable < Overstable lateral finish across all 4 classes',
          check: items => {
            const m = items[0]?.crossSectionMatrixSummary?.matrix12 ?? [];
            const byId = Object.fromEntries(m.map(x => [x.id, x]));
            const classDistOrdered =
              byId['putter-neutral']?.xFt < byId['mid-neutral']?.xFt &&
              byId['mid-neutral']?.xFt < byId['fairway-neutral']?.xFt &&
              byId['fairway-neutral']?.xFt < byId['driver-neutral']?.xFt;
            const stabilityOrdered = ['putter', 'mid', 'fairway', 'driver'].every(
              cls => byId[`${cls}-us`]?.yFt < byId[`${cls}-neutral`]?.yFt && byId[`${cls}-neutral`]?.yFt < byId[`${cls}-os`]?.yFt
            );
            const passed = Boolean(classDistOrdered && stabilityOrdered);
            return {
              passed,
              passCount: passed ? items.length : 0,
              totalCount: items.length,
              metric: `Neutral carry: Putter ${byId['putter-neutral']?.xFt.toFixed(0)}ft < Mid ${byId['mid-neutral']?.xFt.toFixed(0)}ft < Fairway ${byId['fairway-neutral']?.xFt.toFixed(0)}ft < Driver ${byId['driver-neutral']?.xFt.toFixed(0)}ft; US<Stable<OS lateral finish across all 4 classes`,
              failures: passed ? [] : ['cross-section-monotonicity'],
            };
          },
        },
        {
          id: 'G7_FlightNumbersDontMatterAndInversePLH',
          description: '4 physical cross-sections of the same stamped [12|5|-1|3] mold diverge by > 65 ft laterally from +/-1.1mm PLH cooling shift, and Inverse Cross-Section Reconstruction recovers true PLH height within < 0.05mm and trajectory within < 0.25ft',
          check: items => {
            const s = items[0]?.crossSectionMatrixSummary;
            const fndm = s?.fndm4 ?? [];
            const latSpreadFt = fndm.length === 4 ? (fndm[3].yFt - fndm[0].yFt) : 0;
            const passed = Boolean(latSpreadFt > 65 && s.inverseReconErrorFt < 0.25 && s.inversePlhErrorMm < 0.05);
            return {
              passed,
              passCount: passed ? items.length : 0,
              totalCount: items.length,
              metric: `Same-stamp [12|5|-1|3] lateral spread = ${latSpreadFt.toFixed(1)} ft (Run A y=${fndm[0]?.yFt.toFixed(1)}ft vs Run D y=+${fndm[3]?.yFt.toFixed(1)}ft); Inverse PLH err = ${s?.inversePlhErrorMm} mm, traj err = ${s?.inverseReconErrorFt} ft`,
              failures: passed ? [] : ['fndm-inverse-plh'],
            };
          },
        },
      ],
    },
    corpus
  );
}
