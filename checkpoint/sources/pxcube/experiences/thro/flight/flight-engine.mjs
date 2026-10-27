// flight-engine.mjs
// Deterministic 2D Cross-Section Airfoil -> 6-DoF Flight & BVP Constraint Engine Studio (v1.2.0).
// Supports:
//   - Mode 'bvp'       : Single-Disc Constrained BVP Solver + Live 2D Cross-Section Airfoil Editor
//   - Mode 'matrix-12' : Simultaneous 12-Disc Class (Putter/Mid/Fairway/Driver) x Stability (US/S/OS) Matrix
//   - Mode 'putter'    : Simultaneous Putters (Understable vs Neutral-Stable vs Overstable)
//   - Mode 'midrange'  : Simultaneous Midranges (Understable vs Neutral-Stable vs Overstable)
//   - Mode 'fairway'   : Simultaneous Fairway Drivers (Understable vs Neutral-Stable vs Overstable)
//   - Mode 'driver'    : Simultaneous Distance Drivers (Understable vs Neutral-Stable vs Overstable)
//   - Mode 'fndm-4'    : "Flight Numbers Don't Matter" (4 physical cross-sections of stamped 12|5|-1|3 + Inverse PLH)

import {
  PHYSICS_SOLVER_BENCHMARK_CORPUS,
  solveConstrainedFlight,
  simulateArchetypeSquad,
  generateCrossSectionContour,
  solveAeroTensorFromCrossSection,
  runFlightPhysicsWitness,
} from './flight-constraint-solver.mjs';

const DEG = Math.PI / 180;
const $ = id => document.getElementById(id);

const startupWitness = runFlightPhysicsWitness();
window.__throFlightWitness = startupWitness;

function renderWitnessPills(report) {
  const wrap = $('witness-pills');
  wrap.innerHTML = '';
  for (const [id, g] of Object.entries(report.guarantees)) {
    const s = document.createElement('span');
    const shortName = id.split('_')[0];
    // G1 compares the integrator's acceleration with Fx/m from the same function call, so it cannot fail: shown as open, not PASS.
    const tautology = id === 'G1_NewtonEuler6DoFConservation';
    s.className = `wpill ${tautology ? 'open' : g.passed ? '' : 'fail'}`;
    s.title = tautology ? `${g.description}\nNot a test yet: it compares the derivative with the same force it was computed from (always 0). A real check would compare against an independent step (e.g. half-step RK4) or an energy budget.` : `${g.description}\n${g.metric}`;
    s.textContent = tautology ? `${shortName}: not a test yet` : `${shortName}: ${g.passed ? 'PASS' : 'FAIL'}`;
    wrap.appendChild(s);
  }
}
renderWitnessPills(startupWitness);

const cutoutImages = new Map();
async function getCutoutImage(url) {
  if (!url) return null;
  if (cutoutImages.has(url)) return cutoutImages.get(url);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cutoutImages.set(url, p);
  return p;
}

// Add default cross-section geometry to each BVP preset so every single shot can be edited via its 2D cross-section!
const BVP_PRESETS = PHYSICS_SOLVER_BENCHMARK_CORPUS.map(item => {
  const [spd, gld, trn, fad] = item.mold.flight;
  return {
    ...item,
    mold: {
      ...item.mold,
      crossSection: {
        diameterMm: spd <= 5.5 ? 214.0 : 211.5,
        rimWidthMm: +(6.0 + 1.28 * spd).toFixed(1),
        rimDepthMm: +(14.6 - 0.26 * spd).toFixed(1),
        flightPlateMm: 1.9,
        domeRiseMm: +(3.2 + 0.35 * (gld - 3)).toFixed(1),
        plhOffsetMm: +((trn + 1.2) * 0.42 + (fad - 2.0) * 0.28).toFixed(2),
        lowerArchMm: +((fad - 1.8) * 0.35).toFixed(2),
        targetMassG: 175,
        isGyroOvermold: item.mold.isGyroOvermold,
        stampedFlight: item.mold.flight,
      },
    },
  };
});

let engineMode = 'bvp'; // 'bvp' | 'matrix-12' | 'putter' | 'midrange' | 'fairway' | 'driver' | 'fndm-4'
let activeIdx = 0;
let activeSpec = structuredClone(BVP_PRESETS[0]);
let solved = solveConstrainedFlight(activeSpec);
let squadRuns = [];
let activeSquadFocusIdx = 0;
let activeCutoutImg = null;
let camMode = 'chase';
let orbitYaw = -0.38;
let orbitPitch = 0.30;
let playing = true;
let animProgress = 0.65;
let lastFrameTs = performance.now();

function setEngineMode(mode) {
  engineMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });

  if (mode === 'bvp') {
    $('ctrl-bvp-constraints').style.display = '';
    $('map-sub-label').innerHTML = 'Drag <b style="color:var(--amber)">Gate</b> or <b style="color:var(--lime)">Pin</b>';
    camMode = 'chase';
    recomputeAndRender();
  } else {
    $('ctrl-bvp-constraints').style.display = 'none';
    $('map-sub-label').textContent = 'Deterministic from 2D Cross-Section Contour (Zero Flight-Number Inputs)';
    squadRuns = simulateArchetypeSquad(mode);
    activeSquadFocusIdx = Math.min(activeSquadFocusIdx, Math.max(0, squadRuns.length - 1));
    camMode = 'tee';
    animProgress = 0.88;
    syncCrossSectionSlidersFromSquadItem(squadRuns[activeSquadFocusIdx]);
    updateSquadDOM();
  }

  document.querySelectorAll('.cam-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cam === camMode);
  });
  renderPresets();
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => setEngineMode(btn.dataset.mode));
});

function renderPresets() {
  const list = $('preset-list');
  list.innerHTML = '';
  if (engineMode === 'bvp') {
    $('left-head-title').textContent = '1. Constraint Spec & 2D Cross-Section';
    BVP_PRESETS.forEach((item, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `preset-btn ${idx === activeIdx ? 'active' : ''}`;
      const f = item.mold.flight.join('|');
      b.innerHTML = `<span><b>${item.mold.name}</b> · ${item.target.xFt}ft</span><small>[${f}]</small>`;
      b.onclick = () => selectBvpPreset(idx);
      list.appendChild(b);
    });
  } else {
    $('left-head-title').textContent = `1. Active Cohort (${squadRuns.length} Cross-Sections)`;
    squadRuns.forEach((run, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `preset-btn ${idx === activeSquadFocusIdx ? 'active' : ''}`;
      const ef = run.tensor.empiricalFlight.map(n => n.toFixed(1)).join('|');
      b.innerHTML = `<span><i class="dot" style="background:${run.color}"></i><b>${run.name}</b></span><small>PLH ${run.tensor.plhHeightMm.toFixed(1)}mm → [${ef}]</small>`;
      b.onclick = () => {
        activeSquadFocusIdx = idx;
        syncCrossSectionSlidersFromSquadItem(squadRuns[idx]);
        renderPresets();
        updateSquadDOM();
      };
      list.appendChild(b);
    });
  }
}

async function selectBvpPreset(idx) {
  activeIdx = idx;
  activeSpec = structuredClone(BVP_PRESETS[idx]);
  syncSlidersFromSpec();
  renderPresets();
  await recomputeAndRender();
}

function syncSlidersFromSpec() {
  $('sl-pin-x').value = activeSpec.target.xFt;
  $('val-pin-x').textContent = `${Math.round(activeSpec.target.xFt)} ft`;
  $('sl-pin-y').value = activeSpec.target.yFt;
  $('val-pin-y').textContent = `${Math.round(activeSpec.target.yFt)} ft`;
  $('sl-gate-y').value = activeSpec.gate.yFt;
  $('val-gate-y').textContent = `${Math.round(activeSpec.gate.yFt)} ft`;
  $('sl-gate-zmax').value = activeSpec.gate.zMaxFt;
  $('val-gate-zmax').textContent = `${Math.round(activeSpec.gate.zMaxFt)} ft`;

  const cs = activeSpec.mold.crossSection;
  if (cs) {
    $('sl-cs-plh').value = cs.plhOffsetMm ?? 0;
    $('val-cs-plh').textContent = `${(cs.plhOffsetMm >= 0 ? '+' : '')}${(cs.plhOffsetMm ?? 0).toFixed(2)} mm`;
    $('sl-cs-rim').value = cs.rimWidthMm ?? 18.8;
    $('val-cs-rim').textContent = `${(cs.rimWidthMm ?? 18.8).toFixed(1)} mm`;
    $('sl-cs-dome').value = cs.domeRiseMm ?? 4.2;
    $('val-cs-dome').textContent = `${(cs.domeRiseMm ?? 4.2).toFixed(1)} mm`;
  }
}

function syncCrossSectionSlidersFromSquadItem(run) {
  if (!run) return;
  const cs = run.crossSection;
  $('sl-cs-plh').value = cs.plhOffsetMm ?? 0;
  $('val-cs-plh').textContent = `${(cs.plhOffsetMm >= 0 ? '+' : '')}${(cs.plhOffsetMm ?? 0).toFixed(2)} mm`;
  $('sl-cs-rim').value = cs.rimWidthMm ?? 18.8;
  $('val-cs-rim').textContent = `${(cs.rimWidthMm ?? 18.8).toFixed(1)} mm`;
  $('sl-cs-dome').value = cs.domeRiseMm ?? 4.2;
  $('val-cs-dome').textContent = `${(cs.domeRiseMm ?? 4.2).toFixed(1)} mm`;
}

async function recomputeAndRender() {
  solved = solveConstrainedFlight(activeSpec);
  activeCutoutImg = await getCutoutImage(activeSpec.mold.cutoutUrl);
  updateSolvedDOM();
}

function updateSolvedDOM() {
  $('solve-ms').textContent = `${solved.solveMs} ms · ${solved.iterations} iters`;
  $('sol-box-title').textContent = 'Solved 6-DoF Release Vector u*';
  $('land-err-badge').textContent = `pin err: ${solved.landingErrorFt.toFixed(3)} ft`;
  $('land-err-badge').style.color = solved.landingErrorFt < 0.25 ? '#2f7a4a' : '#2b2420';

  $('sol-speed').textContent = `${solved.release.speedMph.toFixed(1)} mph`;
  $('sol-hyzer').textContent = `${solved.release.hyzerDeg >= 0 ? '+' : ''}${solved.release.hyzerDeg.toFixed(1)}°`;
  $('sol-launch').textContent = `${solved.release.launchDeg.toFixed(1)}°`;
  $('sol-aim').textContent = `${solved.release.aimDeg >= 0 ? '+' : ''}${solved.release.aimDeg.toFixed(1)}°`;
  $('sol-nose').textContent = `${solved.release.noseDeg >= 0 ? '+' : ''}${solved.release.noseDeg.toFixed(1)}°`;
  $('sol-spin').textContent = `${solved.release.spinRpm} rpm`;

  const ef = solved.tensor.empiricalFlight.map(n => n.toFixed(1)).join(' | ');
  $('lbl-emergent-fn').textContent = `Emergent: ${ef}`;
  $('elev-summary').textContent = `Apex: ${solved.metrics.apexFt.toFixed(1)} ft · Carry: ${solved.landing.xFt.toFixed(0)} ft`;
  $('prec-summary').textContent = `ω_p: ${solved.metrics.earlyPrecessionRadS.toFixed(2)} → +${solved.metrics.latePrecessionRadS.toFixed(2)} rad/s`;

  const c = solved.tensor.continuum;
  if (c) {
    $('cs-badge').textContent = `PLH=${c.plhHeightMm.toFixed(2)}mm · z_CM=${c.zCmMm.toFixed(2)}mm · I_zz=${solved.tensor.Izz.toFixed(5)}`;
  }
}

function updateSquadDOM() {
  const run = squadRuns[activeSquadFocusIdx] ?? squadRuns[0];
  if (!run) return;
  $('solve-ms').textContent = `${squadRuns.length} Cross-Sections Integrated`;
  $('sol-box-title').textContent = `${run.name} Telemetry`;
  $('land-err-badge').textContent = `Carry: ${run.sim.landing.xFt.toFixed(0)}ft (${run.sim.landing.yFt >= 0 ? '+' : ''}${run.sim.landing.yFt.toFixed(0)}ft lat)`;
  $('land-err-badge').style.color = '#b07d12';

  $('sol-speed').textContent = `${run.sim.release.speedMph.toFixed(1)} mph`;
  $('sol-hyzer').textContent = `+${run.sim.release.hyzerDeg.toFixed(1)}°`;
  $('sol-launch').textContent = `${run.sim.release.launchDeg.toFixed(1)}°`;
  $('sol-aim').textContent = `${run.sim.release.aimDeg.toFixed(1)}°`;
  $('sol-nose').textContent = `+${run.sim.release.noseDeg.toFixed(1)}°`;
  $('sol-spin').textContent = `${run.sim.release.spinRpm} rpm`;

  const ef = run.tensor.empiricalFlight.map(n => n.toFixed(1)).join(' | ');
  $('lbl-emergent-fn').textContent = `Emergent: ${ef}`;
  const minX = Math.min(...squadRuns.map(r => r.sim.landing.xFt));
  const maxX = Math.max(...squadRuns.map(r => r.sim.landing.xFt));
  const minY = Math.min(...squadRuns.map(r => r.sim.landing.yFt));
  const maxY = Math.max(...squadRuns.map(r => r.sim.landing.yFt));
  $('elev-summary').textContent = `Carry Range: ${minX.toFixed(0)} ft → ${maxX.toFixed(0)} ft`;
  $('prec-summary').textContent = `Lateral Spread: ${minY.toFixed(0)} ft (R) → +${maxY.toFixed(0)} ft (L)`;

  const c = run.tensor.continuum;
  if (c) {
    $('cs-badge').textContent = `PLH=${c.plhHeightMm.toFixed(2)}mm · w_rim=${c.rimWidthMm.toFixed(1)}mm · C_D0=${run.tensor.CD0.toFixed(3)}`;
  }
}

// Bind 2D Cross-Section sliders
for (const [id, apply] of [
  ['sl-cs-plh', v => {
    const val = +v;
    $('val-cs-plh').textContent = `${val >= 0 ? '+' : ''}${val.toFixed(2)} mm`;
    if (engineMode === 'bvp') {
      activeSpec.mold.crossSection.plhOffsetMm = val;
      recomputeAndRender();
    } else if (squadRuns[activeSquadFocusIdx]) {
      const item = squadRuns[activeSquadFocusIdx];
      item.crossSection.plhOffsetMm = val;
      item.contour = generateCrossSectionContour({ ...item.crossSection, name: item.name });
      item.tensor = solveAeroTensorFromCrossSection(item.contour);
      squadRuns = simulateArchetypeSquad(engineMode);
      squadRuns[activeSquadFocusIdx].crossSection.plhOffsetMm = val;
      renderPresets();
      updateSquadDOM();
    }
  }],
  ['sl-cs-rim', v => {
    const val = +v;
    $('val-cs-rim').textContent = `${val.toFixed(1)} mm`;
    if (engineMode === 'bvp') {
      activeSpec.mold.crossSection.rimWidthMm = val;
      recomputeAndRender();
    }
  }],
  ['sl-cs-dome', v => {
    const val = +v;
    $('val-cs-dome').textContent = `${val.toFixed(1)} mm`;
    if (engineMode === 'bvp') {
      activeSpec.mold.crossSection.domeRiseMm = val;
      recomputeAndRender();
    }
  }],
  ['sl-pin-x', v => { activeSpec.target.xFt = +v; $('val-pin-x').textContent = `${v} ft`; recomputeAndRender(); }],
  ['sl-pin-y', v => { activeSpec.target.yFt = +v; $('val-pin-y').textContent = `${v} ft`; recomputeAndRender(); }],
  ['sl-gate-y', v => { activeSpec.gate.yFt = +v; $('val-gate-y').textContent = `${v} ft`; recomputeAndRender(); }],
  ['sl-gate-zmax', v => { activeSpec.gate.zMaxFt = +v; $('val-gate-zmax').textContent = `${v} ft`; recomputeAndRender(); }],
]) {
  $(id).addEventListener('input', e => apply(e.target.value));
}

document.querySelectorAll('.cam-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    camMode = btn.dataset.cam;
  });
});

$('btn-play').onclick = () => {
  playing = !playing;
  $('btn-play').textContent = playing ? 'Pause' : 'Play';
};
$('sl-time').addEventListener('input', e => {
  playing = false;
  $('btn-play').textContent = 'Play';
  animProgress = +e.target.value / 1000;
});

// Interactive drag of Gate and Pin on Top-Down Fairway Map (in BVP mode)
let mapDragTarget = null;
function mapTransform(cv) {
  const W = cv.width, H = cv.height;
  const padX = 32;
  const scaleX = (W - padX * 2) / 485;
  const scaleY = (H * 0.42) / 130;
  return {
    toScreen: (xFt, yFt) => [padX + xFt * scaleX, H / 2 - yFt * scaleY],
    toWorld: (sx, sy) => [
      Math.max(80, Math.min(475, (sx - padX) / scaleX)),
      Math.max(-95, Math.min(95, (H / 2 - sy) / scaleY)),
    ],
    scaleX,
    scaleY,
  };
}

$('cv-map').addEventListener('pointerdown', e => {
  if (engineMode !== 'bvp') return;
  const cv = $('cv-map');
  const rect = cv.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (cv.width / rect.width);
  const sy = (e.clientY - rect.top) * (cv.height / rect.height);
  const { toScreen } = mapTransform(cv);
  const [gx, gy] = toScreen(activeSpec.gate.xFt, activeSpec.gate.yFt);
  const [px, py] = toScreen(activeSpec.target.xFt, activeSpec.target.yFt);
  if (Math.hypot(sx - gx, sy - gy) < 22) mapDragTarget = 'gate';
  else if (Math.hypot(sx - px, sy - py) < 22) mapDragTarget = 'pin';
});
window.addEventListener('pointermove', e => {
  if (!mapDragTarget || engineMode !== 'bvp') return;
  const cv = $('cv-map');
  const rect = cv.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (cv.width / rect.width);
  const sy = (e.clientY - rect.top) * (cv.height / rect.height);
  const { toWorld } = mapTransform(cv);
  const [wx, wy] = toWorld(sx, sy);
  if (mapDragTarget === 'gate') {
    activeSpec.gate.xFt = Math.round(Math.max(100, Math.min(activeSpec.target.xFt - 40, wx)));
    activeSpec.gate.yFt = Math.round(Math.max(-45, Math.min(45, wy)));
  } else if (mapDragTarget === 'pin') {
    activeSpec.target.xFt = Math.round(Math.max(220, Math.min(475, wx)));
    activeSpec.target.yFt = Math.round(Math.max(-65, Math.min(65, wy)));
  }
  syncSlidersFromSpec();
  recomputeAndRender();
});
window.addEventListener('pointerup', () => { mapDragTarget = null; });

function bankColor(bankDeg, alpha = 1) {
  if (bankDeg >= 3) {
    const t = Math.min(1, (bankDeg - 3) / 18);
    const r = Math.round(176 + (31 - 176) * t);
    const g = Math.round(125 + (111 - 125) * t);
    const b = Math.round(18 + (104 - 18) * t);
    return `rgba(${r},${g},${b},${alpha})`;
  } else if (bankDeg <= -3) {
    const t = Math.min(1, (-3 - bankDeg) / 18);
    const r = Math.round(176 + (224 - 176) * t);
    const g = Math.round(125 + (99 - 125) * t);
    const b = Math.round(18 + (46 - 18) * t);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(251,191,36,${alpha})`;
}

function createCamera(W, H, curFrame) {
  let camPos, lookAt;
  const targetX = engineMode === 'bvp' ? activeSpec.target.xFt : 385;
  const targetY = engineMode === 'bvp' ? activeSpec.target.yFt : 5;

  if (camMode === 'chase') {
    const backX = Math.max(-44, curFrame.xFt - 48);
    const backY = curFrame.yFt * 0.7 - 10;
    const backZ = Math.max(12, curFrame.zFt + 11);
    camPos = [backX, backY, backZ];
    lookAt = [
      curFrame.xFt * 0.55 + targetX * 0.45,
      curFrame.yFt * 0.5 + targetY * 0.5,
      Math.max(4, curFrame.zFt * 0.65),
    ];
  } else if (camMode === 'tee') {
    camPos = [-44, -10, 18.5];
    lookAt = [235, 4, 9];
  } else if (camMode === 'gate') {
    const g = activeSpec.gate ?? { xFt: 190, yFt: 0, zMaxFt: 24 };
    camPos = [g.xFt - 65, g.yFt + 26, Math.max(14, (g.zMaxFt ?? 24) * 0.75)];
    lookAt = [g.xFt + 40, g.yFt * 0.5, 12];
  } else {
    const midX = 215;
    const midY = 5;
    const dist = 265;
    camPos = [
      midX - dist * Math.cos(orbitPitch) * Math.cos(orbitYaw),
      midY - dist * Math.cos(orbitPitch) * Math.sin(orbitYaw),
      Math.max(14, 14 + dist * Math.sin(orbitPitch)),
    ];
    lookAt = [midX, midY, 10];
  }

  const fx = lookAt[0] - camPos[0], fy = lookAt[1] - camPos[1], fz = lookAt[2] - camPos[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const F = [fx / fl, fy / fl, fz / fl];

  let rx = F[1], ry = -F[0], rz = 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const R = [rx / rl, ry / rl, rz / rl];

  const U = [
    R[1] * F[2] - R[2] * F[1],
    R[2] * F[0] - R[0] * F[2],
    R[0] * F[1] - R[1] * F[0],
  ];

  const fovScale = Math.min(W, H) * 1.15;

  return {
    camPos,
    project: (wx, wy, wz) => {
      const dx = wx - camPos[0], dy = wy - camPos[1], dz = wz - camPos[2];
      const cz = dx * F[0] + dy * F[1] + dz * F[2];
      if (cz <= 1.5) return null;
      const cx = dx * R[0] + dy * R[1] + dz * R[2];
      const cy = dx * U[0] + dy * U[1] + dz * U[2];
      return {
        sx: W * 0.5 + (cx / cz) * fovScale,
        sy: H * 0.55 - (cy / cz) * fovScale,
        cz,
        scale: fovScale / cz,
      };
    },
  };
}

function resizeCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.round(r.width * dpr));
  const h = Math.max(10, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  return { W: w, H: h, dpr };
}

function drawFairwayGrid3D(ctx, cam, dpr) {
  ctx.lineWidth = 1 * dpr;
  for (let x = 0; x <= 480; x += 50) {
    const pL = cam.project(x, 120, 0);
    const pR = cam.project(x, -90, 0);
    if (pL && pR) {
      ctx.strokeStyle = x % 100 === 0 ? 'rgba(43, 36, 32, 0.25)' : 'rgba(43, 36, 32, 0.09)';
      ctx.beginPath();
      ctx.moveTo(pL.sx, pL.sy);
      ctx.lineTo(pR.sx, pR.sy);
      ctx.stroke();
    }
    if (x > 0 && x % 100 === 0) {
      const pTxt = cam.project(x, -65, 0);
      if (pTxt) {
        ctx.fillStyle = 'rgba(43, 36, 32, 0.65)';
        ctx.font = `600 ${10 * dpr}px ui-monospace, monospace`;
        ctx.fillText(`${x} ft`, pTxt.sx + 3 * dpr, pTxt.sy);
      }
    }
  }
  for (let y = -75; y <= 105; y += 25) {
    ctx.strokeStyle = y === 0 ? 'rgba(176, 125, 18, 0.28)' : 'rgba(43, 36, 32, 0.08)';
    ctx.beginPath();
    let started = false;
    for (let x = 0; x <= 480; x += 20) {
      const p = cam.project(x, y, 0);
      if (!p) continue;
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; }
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }
}

function draw3DViewport(curFrame, frameIdx) {
  const cv = $('cv-3d');
  const { W, H, dpr } = resizeCanvas(cv);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const cam = createCamera(W, H, curFrame);
  drawFairwayGrid3D(ctx, cam, dpr);

  if (engineMode !== 'bvp') {
    // MULTI-DISC SIMULTANEOUS 3D LAUNCH RENDERING
    for (let rIdx = 0; rIdx < squadRuns.length; rIdx++) {
      const run = squadRuns[rIdx];
      const frames = run.sim.frames;
      const fIdx = Math.min(frames.length - 1, Math.floor(animProgress * (frames.length - 1)));
      const fCur = frames[fIdx];
      const isFocused = rIdx === activeSquadFocusIdx;

      // Ground shadow
      ctx.strokeStyle = 'rgba(43, 36, 32, 0.35)';
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      let sStart = false;
      for (let i = 0; i <= fIdx; i += 2) {
        const p = cam.project(frames[i].xFt, frames[i].yFt, 0);
        if (!p) continue;
        if (!sStart) { ctx.moveTo(p.sx, p.sy); sStart = true; }
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();

      // 3D Flight Ribbon
      ctx.strokeStyle = run.color;
      ctx.lineWidth = (isFocused ? 3.6 : 2.3) * dpr;
      ctx.beginPath();
      let rStart = false;
      for (let i = 0; i <= fIdx; i++) {
        const p = cam.project(frames[i].xFt, frames[i].yFt, frames[i].zFt);
        if (!p) continue;
        if (!rStart) { ctx.moveTo(p.sx, p.sy); rStart = true; }
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();

      // Draw 3D Banked Spinning Disc at fCur
      const pDisc = cam.project(fCur.xFt, fCur.yFt, fCur.zFt);
      if (pDisc) {
        const radPx = Math.max(9 * dpr, Math.min(28 * dpr, pDisc.scale * 2.4));
        ctx.save();
        ctx.translate(pDisc.sx, pDisc.sy);
        ctx.rotate(-fCur.bankDeg * DEG);
        ctx.scale(1.0, 0.44);
        ctx.fillStyle = run.color;
        ctx.beginPath();
        ctx.arc(0, 0, radPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2b2420';
        ctx.lineWidth = 1.8 * dpr;
        ctx.stroke();
        ctx.restore();

        // Callout label at disc position (when squad <= 4 or focused or near landing)
        if (squadRuns.length <= 4 || isFocused || animProgress > 0.75) {
          ctx.fillStyle = 'rgba(251, 244, 230, 0.92)';
          const ef = run.tensor.empiricalFlight.map(n => n.toFixed(1)).join('|');
          const lbl = squadRuns.length <= 4
            ? `${run.shortLabel ?? run.name} → [${ef}] (${fCur.xFt.toFixed(0)}ft, ${fCur.yFt >= 0 ? '+' : ''}${fCur.yFt.toFixed(0)}ft)`
            : `${run.classLabel[0]}·${run.stabilityId.toUpperCase().slice(0, 2)} (${fCur.xFt.toFixed(0)}')`;
          ctx.font = `600 ${10 * dpr}px ui-monospace, monospace`;
          const tw = ctx.measureText(lbl).width + 10 * dpr;
          ctx.fillRect(pDisc.sx + 8 * dpr, pDisc.sy - 10 * dpr, tw, 15 * dpr);
          ctx.strokeStyle = run.color;
          ctx.lineWidth = 1 * dpr;
          ctx.strokeRect(pDisc.sx + 8 * dpr, pDisc.sy - 10 * dpr, tw, 15 * dpr);
          ctx.fillStyle = run.color;
          ctx.fillText(lbl, pDisc.sx + 13 * dpr, pDisc.sy + 1 * dpr);
        }
      }
    }
    return;
  }

  // SINGLE-SHOT BVP RENDERING
  if (activeSpec.gate) {
    const g = activeSpec.gate;
    const yL = g.yFt + (g.yHalfWidthFt ?? 10);
    const yR = g.yFt - (g.yHalfWidthFt ?? 10);
    const zMin = g.zMinFt ?? 4;
    const zMax = g.zMaxFt ?? 24;

    const cTL = cam.project(g.xFt, yL, zMax);
    const cTR = cam.project(g.xFt, yR, zMax);
    const cBR = cam.project(g.xFt, yR, zMin);
    const cBL = cam.project(g.xFt, yL, zMin);
    const gL = cam.project(g.xFt, yL, 0);
    const gR = cam.project(g.xFt, yR, 0);

    if (gL && cTL && gR && cTR) {
      ctx.strokeStyle = 'rgba(43, 36, 32, 0.45)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(gL.sx, gL.sy); ctx.lineTo(cTL.sx, cTL.sy);
      ctx.moveTo(gR.sx, gR.sy); ctx.lineTo(cTR.sx, cTR.sy);
      ctx.stroke();
    }
    if (cTL && cTR && cBR && cBL) {
      ctx.fillStyle = 'rgba(43, 36, 32, 0.08)';
      ctx.strokeStyle = '#2b2420';
      ctx.lineWidth = 2.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(cTL.sx, cTL.sy);
      ctx.lineTo(cTR.sx, cTR.sy);
      ctx.lineTo(cBR.sx, cBR.sy);
      ctx.lineTo(cBL.sx, cBL.sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // Target Basket
  {
    const px = activeSpec.target.xFt, py = activeSpec.target.yFt, pz = activeSpec.target.zFt;
    const pBase = cam.project(px, py, pz);
    const pCage = cam.project(px, py, pz + 2.7);
    const pTop = cam.project(px, py, pz + 4.4);
    if (pBase && pTop) {
      ctx.strokeStyle = '#2b2420';
      ctx.lineWidth = 2.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(pBase.sx, pBase.sy);
      ctx.lineTo(pTop.sx, pTop.sy);
      ctx.stroke();
      const rCage = Math.max(4 * dpr, pCage.scale * 1.15);
      ctx.strokeStyle = '#1f6f68';
      ctx.strokeRect(pCage.sx - rCage, pCage.sy - rCage * 0.4, rCage * 2, rCage * 0.8);
      ctx.fillStyle = '#b07d12';
      ctx.fillRect(pTop.sx - rCage * 1.05, pTop.sy - rCage * 0.25, rCage * 2.1, rCage * 0.45);
    }
  }

  const frames = solved.frames;
  for (let i = 1; i <= frameIdx; i++) {
    const f0 = frames[i - 1], f1 = frames[i];
    const p0 = cam.project(f0.xFt, f0.yFt, f0.zFt);
    const p1 = cam.project(f1.xFt, f1.yFt, f1.zFt);
    if (!p0 || !p1) continue;
    ctx.strokeStyle = bankColor(f1.bankDeg, 0.92);
    ctx.lineWidth = Math.max(2.5 * dpr, Math.min(8 * dpr, p1.scale * 0.7));
    ctx.beginPath();
    ctx.moveTo(p0.sx, p0.sy);
    ctx.lineTo(p1.sx, p1.sy);
    ctx.stroke();
  }

  const pDisc = cam.project(curFrame.xFt, curFrame.yFt, curFrame.zFt);
  if (pDisc) {
    const discRadiusPx = Math.max(15 * dpr, Math.min(52 * dpr, pDisc.scale * 3.1));
    const bankRad = curFrame.bankDeg * DEG;
    const spinAngle = curFrame.t * ((curFrame.spinRpm * 2 * Math.PI) / 60) * 0.12;

    ctx.save();
    ctx.translate(pDisc.sx, pDisc.sy);
    ctx.rotate(-bankRad);
    ctx.scale(1.0, 0.42);

    ctx.fillStyle = activeSpec.mold.isGyroOvermold ? '#2b2420' : '#1f6f68';
    ctx.beginPath();
    ctx.arc(0, 6 * dpr, discRadiusPx * 1.02, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(spinAngle);
    ctx.beginPath();
    ctx.arc(0, 0, discRadiusPx, 0, Math.PI * 2);
    ctx.clip();
    if (activeCutoutImg) {
      ctx.drawImage(activeCutoutImg, -discRadiusPx, -discRadiusPx, discRadiusPx * 2, discRadiusPx * 2);
    } else {
      ctx.fillStyle = '#1f6f68';
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = bankColor(curFrame.bankDeg, 1);
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(0, 0, discRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawTopDownMap(curFrame) {
  const cv = $('cv-map');
  const { W, H, dpr } = resizeCanvas(cv);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const { toScreen, scaleY } = mapTransform(cv);

  // Grid & centerline
  ctx.lineWidth = 1 * dpr;
  for (let x = 0; x <= 450; x += 50) {
    const [sx] = toScreen(x, 0);
    ctx.strokeStyle = x % 100 === 0 ? 'rgba(43, 36, 32, 0.22)' : 'rgba(43, 36, 32, 0.08)';
    ctx.beginPath();
    ctx.moveTo(sx, 12 * dpr);
    ctx.lineTo(sx, H - 12 * dpr);
    ctx.stroke();
    if (x > 0 && x % 100 === 0) {
      ctx.fillStyle = 'rgba(43, 36, 32, 0.55)';
      ctx.font = `${9.5 * dpr}px ui-monospace, monospace`;
      ctx.fillText(`${x}'`, sx - 8 * dpr, H - 4 * dpr);
    }
  }
  const [, cy0] = toScreen(0, 0);
  ctx.strokeStyle = 'rgba(176, 125, 18, 0.2)';
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(12 * dpr, cy0);
  ctx.lineTo(W - 12 * dpr, cy0);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(31, 111, 104, 0.55)';
  ctx.font = `${9 * dpr}px ui-monospace, monospace`;
  ctx.fillText('+Y (LEFT / HYZER FADE)', 14 * dpr, 14 * dpr);
  ctx.fillStyle = 'rgba(224, 99, 46, 0.55)';
  ctx.fillText('-Y (RIGHT / TURN)', 14 * dpr, H - 16 * dpr);

  if (engineMode !== 'bvp') {
    for (let rIdx = 0; rIdx < squadRuns.length; rIdx++) {
      const run = squadRuns[rIdx];
      const frames = run.sim.frames;
      const fIdx = Math.min(frames.length - 1, Math.floor(animProgress * (frames.length - 1)));
      ctx.strokeStyle = run.color;
      ctx.lineWidth = (rIdx === activeSquadFocusIdx ? 2.8 : 1.9) * dpr;
      ctx.beginPath();
      for (let i = 0; i <= fIdx; i++) {
        const [sx, sy] = toScreen(frames[i].xFt, frames[i].yFt);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      const fCur = frames[fIdx];
      const [dx, dy] = toScreen(fCur.xFt, fCur.yFt);
      ctx.fillStyle = run.color;
      ctx.beginPath();
      ctx.arc(dx, dy, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#2b2420';
      ctx.font = `600 ${8.8 * dpr}px ui-monospace, monospace`;
      const tag = squadRuns.length <= 4
        ? `${(run.shortLabel ?? run.name).split('(')[0].trim()} (${fCur.xFt.toFixed(0)}', ${fCur.yFt >= 0 ? '+' : ''}${fCur.yFt.toFixed(0)}')`
        : `${run.classLabel.slice(0, 3)}·${run.stabilityId.slice(0, 2).toUpperCase()} ${fCur.xFt.toFixed(0)}'`;
      ctx.fillText(tag, dx + 6 * dpr, dy + 3 * dpr);
    }
    return;
  }

  if (activeSpec.gate) {
    const g = activeSpec.gate;
    const [gx, gy] = toScreen(g.xFt, g.yFt);
    const halfPx = (g.yHalfWidthFt ?? 10) * scaleY;
    ctx.strokeStyle = '#2b2420';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.moveTo(gx, gy - halfPx);
    ctx.lineTo(gx, gy + halfPx);
    ctx.stroke();
  }

  const frames = solved.frames;
  for (let i = 1; i < frames.length; i++) {
    const f0 = frames[i - 1], f1 = frames[i];
    const [x0, y0] = toScreen(f0.xFt, f0.yFt);
    const [x1, y1] = toScreen(f1.xFt, f1.yFt);
    ctx.strokeStyle = bankColor(f1.bankDeg, 0.9);
    ctx.lineWidth = 2.6 * dpr;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  const [px, py] = toScreen(activeSpec.target.xFt, activeSpec.target.yFt);
  ctx.fillStyle = '#b07d12';
  ctx.beginPath();
  ctx.arc(px, py, 5.5 * dpr, 0, Math.PI * 2);
  ctx.fill();

  const [dx, dy] = toScreen(curFrame.xFt, curFrame.yFt);
  ctx.fillStyle = '#2b2420';
  ctx.beginPath();
  ctx.arc(dx, dy, 6 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

function drawElevationChart(curFrame) {
  const cv = $('cv-elev');
  const { W, H, dpr } = resizeCanvas(cv);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const padL = 28 * dpr, padR = 14 * dpr, padT = 14 * dpr, padB = 18 * dpr;
  const maxX = 475;
  const maxZ = 55;
  const toX = x => padL + (x / maxX) * (W - padL - padR);
  const toY = z => (H - padB) - ((z + 6) / (maxZ + 6)) * (H - padT - padB);

  const y0 = toY(0);
  ctx.strokeStyle = 'rgba(43, 36, 32, 0.25)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(padL, y0);
  ctx.lineTo(W - padR, y0);
  ctx.stroke();

  if (engineMode !== 'bvp') {
    for (const run of squadRuns) {
      const frames = run.sim.frames;
      const fIdx = Math.min(frames.length - 1, Math.floor(animProgress * (frames.length - 1)));
      ctx.strokeStyle = run.color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let i = 0; i <= fIdx; i++) {
        const sx = toX(frames[i].xFt), sy = toY(frames[i].zFt);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    return;
  }

  const frames = solved.frames;
  for (let i = 1; i < frames.length; i++) {
    const f0 = frames[i - 1], f1 = frames[i];
    ctx.strokeStyle = bankColor(f1.bankDeg, 0.9);
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(toX(f0.xFt), toY(f0.zFt));
    ctx.lineTo(toX(f1.xFt), toY(f1.zFt));
    ctx.stroke();
  }
}

function drawBankPrecessionChart(curFrame) {
  const cv = $('cv-bank');
  const { W, H, dpr } = resizeCanvas(cv);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const padL = 30 * dpr, padR = 14 * dpr, padT = 14 * dpr, padB = 18 * dpr;
  const maxT = 4.6;
  const toX = t => padL + (t / maxT) * (W - padL - padR);
  const toY = deg => (H - padB) - ((deg + 35) / 70) * (H - padT - padB);

  const yFlat = toY(0);
  ctx.strokeStyle = 'rgba(43, 36, 32, 0.25)';
  ctx.setLineDash([3 * dpr, 3 * dpr]);
  ctx.beginPath();
  ctx.moveTo(padL, yFlat);
  ctx.lineTo(W - padR, yFlat);
  ctx.stroke();
  ctx.setLineDash([]);

  if (engineMode !== 'bvp') {
    for (const run of squadRuns) {
      const frames = run.sim.frames;
      const fIdx = Math.min(frames.length - 1, Math.floor(animProgress * (frames.length - 1)));
      ctx.strokeStyle = run.color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let i = 0; i <= fIdx; i++) {
        const sx = toX(frames[i].t), sy = toY(frames[i].bankDeg);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    return;
  }

  const frames = solved.frames;
  for (let i = 1; i < frames.length; i++) {
    const f0 = frames[i - 1], f1 = frames[i];
    ctx.strokeStyle = bankColor(f1.bankDeg, 0.95);
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(toX(f0.t), toY(f0.bankDeg));
    ctx.lineTo(toX(f1.t), toY(f1.bankDeg));
    ctx.stroke();
  }
}

/**
 * Panel 6: Deterministic 2D Radial Cross-Section Airfoil Inspector `cv-cs`!
 * Renders the physical millimeter contour {(r, zUpper, zLower)} near the outer wing & rim (r in [55mm, 108mm]),
 * showing:
 *   - Flight plate, Under-disc cavity V_cavity, Inner rim wall, Lower bevel arch, Leading-Edge Nose
 *   - Parting Line Height z_PLH (horizontal stagnation line) vs Center of Mass z_CM
 *   - In squad modes, overlays the cross-sections so you can see the exact PLH / rim-width difference!
 */
function drawCrossSectionCanvas() {
  const cv = $('cv-cs');
  const { W, H, dpr } = resizeCanvas(cv);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Zoom onto radial window r in [58 mm, 108 mm], z in [-2 mm, 21 mm] so the wing airfoil & PLH are crystal clear
  const rMin = 56, rMax = 108.5;
  const zMin = -1.8, zMax = 21.5;
  const padL = 28 * dpr, padR = 16 * dpr, padT = 16 * dpr, padB = 20 * dpr;
  const toX = rMm => padL + ((rMm - rMin) / (rMax - rMin)) * (W - padL - padR);
  const toY = zMm => (H - padB) - ((zMm - zMin) / (zMax - zMin)) * (H - padT - padB);

  // Bottom reference plane z = 0 mm
  const yZero = toY(0);
  ctx.strokeStyle = 'rgba(43, 36, 32, 0.3)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(padL, yZero);
  ctx.lineTo(W - padR, yZero);
  ctx.stroke();

  ctx.fillStyle = 'rgba(43, 36, 32, 0.6)';
  ctx.font = `${9 * dpr}px ui-monospace, monospace`;
  ctx.fillText('z=0mm (Bottom Plane)', padL + 4 * dpr, yZero + 11 * dpr);

  const itemsToDraw = engineMode === 'bvp'
    ? [{ tensor: solved.tensor, color: '#1f6f68', name: activeSpec.mold.name, isPrimary: true }]
    : (squadRuns.length <= 4
        ? squadRuns.map((r, idx) => ({ tensor: r.tensor, color: r.color, name: r.shortLabel ?? r.name, isPrimary: idx === activeSquadFocusIdx }))
        : [0, 4, 7, 10].map(idx => ({
            tensor: squadRuns[idx].tensor,
            color: ['#e0632e', '#2b2420', '#b07d12', '#1f6f68'][idx === 0 ? 0 : idx === 4 ? 1 : idx === 7 ? 2 : 3],
            name: squadRuns[idx].classLabel,
            isPrimary: true,
          })));

  for (const item of itemsToDraw) {
    const t = item.tensor;
    const pts = t.contourStations;
    if (!pts || !pts.length) continue;

    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].rMm < rMin) continue;
      const sx = toX(pts[i].rMm), sy = toY(pts[i].zUpperMm);
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].rMm < rMin) continue;
      ctx.lineTo(toX(pts[i].rMm), toY(pts[i].zLowerMm));
    }
    ctx.closePath();

    ctx.fillStyle = item.color + (itemsToDraw.length === 1 ? '38' : '22');
    ctx.fill();
    ctx.strokeStyle = item.color;
    ctx.lineWidth = (item.isPrimary ? 2.2 : 1.5) * dpr;
    ctx.stroke();

    // Draw Parting Line Height (PLH) vertex marker at outer leading edge tip
    const tip = pts[pts.length - 1];
    const tipX = toX(tip.rMm), tipY = toY(t.plhHeightMm);
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3.8 * dpr, 0, Math.PI * 2);
    ctx.fill();

    if (item.isPrimary) {
      // Draw horizontal PLH line and Center of Mass line z_CM
      ctx.strokeStyle = '#2b2420';
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(toX(tip.rMm - 18), tipY);
      ctx.lineTo(W - 4 * dpr, tipY);
      ctx.stroke();

      const yCm = toY(t.zCmMm);
      ctx.strokeStyle = '#b07d12';
      ctx.beginPath();
      ctx.moveTo(padL, yCm);
      ctx.lineTo(toX(tip.rMm - 8), yCm);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#2b2420';
      ctx.font = `600 ${9.5 * dpr}px ui-monospace, monospace`;
      ctx.fillText(`PLH=${t.plhHeightMm.toFixed(2)}mm`, toX(tip.rMm - 23), tipY - 5 * dpr);

      ctx.fillStyle = '#b07d12';
      ctx.fillText(`z_CM=${t.zCmMm.toFixed(2)}mm (I_zz=${(t.Izz * 1e4).toFixed(2)}e-4)`, padL + 4 * dpr, yCm - 5 * dpr);
    }
    ctx.restore();
  }
}

function updateHUD(curFrame) {
  $('hud-t').textContent = `${curFrame.t.toFixed(2)} s`;
  $('hud-pos').textContent = `${curFrame.xFt.toFixed(0)}', ${curFrame.yFt >= 0 ? '+' : ''}${curFrame.yFt.toFixed(1)}', ${curFrame.zFt.toFixed(1)}'`;
  $('hud-speed').textContent = `${curFrame.speedMph.toFixed(1)} mph`;
  $('hud-bank').textContent = `${curFrame.bankDeg >= 0 ? '+' : ''}${curFrame.bankDeg.toFixed(1)}°`;
  $('hud-bank').style.color = bankColor(curFrame.bankDeg, 1);
  $('hud-prec').textContent = `${curFrame.precessionDegPerS >= 0 ? '+' : ''}${curFrame.precessionDegPerS.toFixed(1)}°/s`;

  const activeTensor = engineMode === 'bvp' ? solved.tensor : (squadRuns[activeSquadFocusIdx]?.tensor ?? solved.tensor);
  $('hud-clcd').textContent = `${curFrame.CL.toFixed(2)} / ${activeTensor.CD0.toFixed(3)}`;
  $('hud-emergent').textContent = activeTensor.empiricalFlight.map(n => n.toFixed(1)).join(' | ');

  if (curFrame.precessionDegPerS < -1.0) {
    $('lbl-phase').textContent = 'PHASE: HIGH-SPEED TURN (dφ/dt < 0)';
    $('lbl-phase').style.color = '#e0632e';
  } else if (curFrame.precessionDegPerS > 1.0) {
    $('lbl-phase').textContent = 'PHASE: LOW-SPEED FADE (dφ/dt > 0)';
    $('lbl-phase').style.color = '#1f6f68';
  } else {
    $('lbl-phase').textContent = 'PHASE: GYROSCOPIC CRUISE (v ≈ v_c)';
    $('lbl-phase').style.color = '#2b2420';
  }
}

function renderFrameAtProgress(p) {
  animProgress = Math.max(0, Math.min(1, p));
  $('sl-time').value = Math.round(animProgress * 1000);
  const frames = engineMode === 'bvp'
    ? solved.frames
    : (squadRuns[activeSquadFocusIdx]?.sim.frames ?? solved.frames);
  const frameIdx = Math.min(frames.length - 1, Math.max(0, Math.floor(animProgress * (frames.length - 1))));
  const curFrame = frames[frameIdx];

  updateHUD(curFrame);
  draw3DViewport(curFrame, frameIdx);
  drawTopDownMap(curFrame);
  drawElevationChart(curFrame);
  drawBankPrecessionChart(curFrame);
  drawCrossSectionCanvas();
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrameTs) / 1000);
  lastFrameTs = now;

  if (playing) {
    animProgress += dt / 4.2;
    if (animProgress >= 1.0) animProgress = 0.02;
  }
  renderFrameAtProgress(animProgress);
  requestAnimationFrame(tick);
}

// Deterministic controller hook for automated Playwright video & showcase frame capture
window.__throSetEngineState = async ({ mode, cam, progress, presetIdx, squadFocusIdx }) => {
  playing = false;
  $('btn-play').textContent = 'Play';
  if (mode && mode !== engineMode) {
    setEngineMode(mode);
  }
  if (presetIdx != null && engineMode === 'bvp') {
    await selectBvpPreset(presetIdx);
  }
  if (squadFocusIdx != null && engineMode !== 'bvp') {
    activeSquadFocusIdx = squadFocusIdx;
    syncCrossSectionSlidersFromSquadItem(squadRuns[activeSquadFocusIdx]);
    renderPresets();
    updateSquadDOM();
  }
  if (cam) {
    camMode = cam;
    document.querySelectorAll('.cam-btn').forEach(b => b.classList.toggle('active', b.dataset.cam === cam));
  }
  if (progress != null) {
    renderFrameAtProgress(progress);
  }
};

renderPresets();
syncSlidersFromSpec();
recomputeAndRender().then(() => {
  requestAnimationFrame(tick);
});
