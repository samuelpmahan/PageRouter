// disc-aerodynamics.mjs
// True 6-DoF Rigid-Body Spinning Oblate Disc Aerodynamics, Physical Geometry (PDGA + PLH + Plastic),
// and Gyroscopic Precession Engine.
//
// Coordinate frame (Right-Handed World Frame, meters internally, feet in UI):
//   +X : Downrange (from Tee toward Pin)
//   +Y : Lateral Left (for RHBH: High-Speed Turn moves toward -Y [Right], Low-Speed Fade moves toward +Y [Left])
//   +Z : Vertical Up (altitude above tee plane)
//
// Bank / Roll Angle (phi, radians):
//   For RHBH (spin chirality sigma = +1, clockwise from above):
//     phi > 0 : Hyzer bank (tilted left, Lift pulls toward +Y [Left])
//     phi < 0 : Anhyzer bank (tilted right, Lift pulls toward -Y [Right])

import {
  generateCrossSectionContour,
  solveAeroTensorFromCrossSection,
} from './cross-section-physics.mjs';

export const FT_TO_M = 0.3048;
export const M_TO_FT = 1 / FT_TO_M;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G_ACCEL = 9.80665; // m/s^2
export const RHO_AIR = 1.225;   // kg/m^3 at sea level

/**
 * Physical injection-molding plastic cooling & stiffness profiles ("Flight Numbers Don't Matter").
 * Explains why identical molds with identical stamped [Speed, Glide, Turn, Fade] fly completely
 * differently across plastic blends due to cooling shrinkage shifting Parting Line Height (PLH)
 * and dome height.
 */
export const PLASTIC_PROFILES = Object.freeze({
  halo_eclipse: {
    id: 'halo_eclipse',
    label: 'Halo Star / Eclipse Glow / Cosmic Neutron',
    plhShiftMm: +0.85,    // Stiff outer rim cools slower/higher -> higher PLH -> much more overstable
    domeShiftMm: -0.35,   // Slightly flatter shoulder, higher torque resistance
    stiffness: 1.15,
    skinDragMult: 0.99,
  },
  champion_proton: {
    id: 'champion_proton',
    label: 'Champion / Proton / Z-Line (Translucent Stiff)',
    plhShiftMm: +0.48,
    domeShiftMm: -0.20,
    stiffness: 1.10,
    skinDragMult: 0.995,
  },
  star_neutron: {
    id: 'star_neutron',
    label: 'Star / Neutron / ESP (Stock Premium Baseline)',
    plhShiftMm: 0.0,
    domeShiftMm: 0.0,
    stiffness: 1.0,
    skinDragMult: 1.0,
  },
  fission_pro: {
    id: 'fission_pro',
    label: 'Fission (Microbubble Core) / Pro / GStar',
    plhShiftMm: -0.52,    // Cools with lower wing parting line + higher dome -> more turn & glide
    domeShiftMm: +0.65,
    stiffness: 0.92,
    isMicrobubbleGyro: true,
    skinDragMult: 1.005,
  },
  base_beatin: {
    id: 'base_beatin',
    label: 'Base (DX / Electron) / Seasoned Beat-In Run',
    plhShiftMm: -1.10,    // Lower PLH + leading-edge tree rash lowers high-speed CoP
    domeShiftMm: +0.40,
    stiffness: 0.84,
    skinDragMult: 1.02,
  },
});

/**
 * Derive physical inertial & aerodynamic tensor from physical PDGA geometry, Parting Line Height (PLH),
 * dome height, plastic cooling profile, mass, and wear state — using stamped [Speed, Glide, Turn, Fade]
 * ONLY as a baseline prior when explicit physical geometry is omitted.
 *
 * Also computes `empiricalFlight: [eSpeed, eGlide, eTurn, eFade]` so callers can inspect how far
 * the real physical disc diverges from its marketing stamp ("Flight Numbers Don't Matter").
 */
export function buildDiscAeroTensor(mold) {
  if (mold?.source === 'deterministic-2d-cross-section' && mold?.Izz) {
    return mold;
  }
  if (mold?.contourStations) {
    return solveAeroTensorFromCrossSection({ stations: mold.contourStations, meta: mold.meta ?? mold });
  }
  if (mold?.crossSection) {
    const contour = generateCrossSectionContour({
      ...mold.crossSection,
      name: mold.name ?? mold.crossSection.name,
      isGyroOvermold: mold.isGyroOvermold ?? mold.crossSection.isGyroOvermold,
      stampedFlight: mold.flight ?? mold.crossSection.stampedFlight,
    });
    return solveAeroTensorFromCrossSection(contour);
  }
  const [stampedSpeed, stampedGlide, stampedTurn, stampedFade] = mold.flight ?? [9, 5, -1, 2];
  const plasticKey = mold.plastic && PLASTIC_PROFILES[mold.plastic] ? mold.plastic : 'star_neutron';
  const plasticProf = PLASTIC_PROFILES[plasticKey];

  const massKg = (mold.massG ?? 175) / 1000;
  const wearScore = Math.max(0, Math.min(1, mold.wearScore ?? 0)); // 0 = fresh out of box, 1 = heavily beat-in

  // Physical rim width (mm) -> continuous aerodynamic Speed rating
  // PDGA mapping: Putters ~9-11mm (Spd 2-4), Mids ~12-14.5mm (Spd 5-6), Fairways ~16-19.5mm (Spd 7-9), Distance ~20-25mm (Spd 10-14)
  const rimWidthMm = mold.rimWidthMm ?? (6.0 + 1.28 * stampedSpeed);
  const rimWidthM = rimWidthMm / 1000;
  const empiricalSpeed = +Math.max(1, Math.min(14.5, (rimWidthMm - 6.0) / 1.28)).toFixed(2);

  const diameterM = mold.diameterCm ? mold.diameterCm / 100 : (empiricalSpeed <= 5.5 ? 0.214 : 0.2115);
  const radiusM = diameterM / 2;
  const areaM2 = Math.PI * radiusM * radiusM;
  const thicknessM = 0.020 - 0.00045 * empiricalSpeed;

  // Effective Parting Line Height (PLH) shift in mm and Dome shift in mm:
  // Combines run-specific mold warp (plhOffsetMm), plastic cooling shrinkage (plasticProf.plhShiftMm),
  // and leading-edge downward deformation from tree impacts (-1.25 mm at wearScore=1).
  const plhOffsetMm = (mold.plhOffsetMm ?? 0) + plasticProf.plhShiftMm - 1.25 * wearScore;
  const domeOffsetMm = (mold.domeOffsetMm ?? 0) + plasticProf.domeShiftMm;

  // Empirical Glide, Turn, Fade shifted by physical PLH, Dome, Weight, and Wear:
  // - Dome increases the low-pressure cavity lift (+0.45 glide per mm dome); high PLH flattens glide slightly
  // - Lightweight discs (<175g) experience higher accelerations from the same aerodynamic forces and reach turn speed easier
  const weightDeltaG = 175 - massKg * 1000; // positive for lighter discs
  const empiricalGlide = +Math.max(1, Math.min(7, stampedGlide + 0.48 * domeOffsetMm - 0.22 * plhOffsetMm + 0.15 * wearScore)).toFixed(2);

  // Every +1.0 mm of PLH raises the wing stagnation line, reducing high-speed turn by ~1.35 numbers
  // and increasing low-speed fade by ~0.95 numbers. Lighter weight (-10g) adds ~-0.45 effective turn.
  const empiricalTurn = +Math.max(-6, Math.min(1.5, stampedTurn + 1.35 * plhOffsetMm - 0.045 * weightDeltaG - 0.95 * wearScore)).toFixed(2);
  const empiricalFade = +Math.max(0, Math.min(6, stampedFade + 0.95 * plhOffsetMm - 0.025 * weightDeltaG - 0.55 * wearScore)).toFixed(2);

  // Axial moment of inertia I_zz = k_ring * m * R^2
  // MVP GYRO overmold (+9.5% I_zz) or Fission microbubble core (+12.5% I_zz) concentrates mass in the outer ring
  const gyroBoost = mold.isGyroOvermold
    ? (plasticProf.isMicrobubbleGyro ? 1.125 : 1.095)
    : 1.0;
  const kRing = (0.58 + 0.0045 * empiricalSpeed) * gyroBoost;
  const Izz = kRing * massKg * radiusM * radiusM;
  const Ixx = 0.51 * (0.58 + 0.0045 * empiricalSpeed) * massKg * radiusM * radiusM;

  // Potts & Crowther (2002) / Hummel (2003) wind-tunnel aerodynamic coefficients driven by empirical geometry:
  // 1. Lift: CL(alpha) = CL0 + CL_alpha * alpha
  const CL0 = 0.052 + 0.0085 * (empiricalGlide - 4);
  const CL_alpha = 1.95 + 0.125 * (empiricalGlide - 4);
  const alphaZeroLift = -CL0 / CL_alpha;

  // 2. Drag: CD(alpha) = CD0 + k_induced * (alpha - alpha0)^2
  // Blunt putter rims (Speed 2-3) have higher profile drag CD0 than sharp 23mm driver wings (Speed 12-13)
  const CD0 = Math.max(
    0.042,
    (0.084 - 0.0027 * empiricalSpeed - 0.0018 * (empiricalGlide - 4)) * plasticProf.skinDragMult
  );
  const kInduced = Math.max(0.66, 1.16 - 0.045 * (empiricalGlide - 4) - 0.015 * empiricalSpeed);

  // 3. Crossover airspeed vCruise (m/s) where Center of Pressure passes through Center of Mass:
  // Higher PLH shifts CoP transition slightly higher in speed (so fade starts earlier); lower PLH delays fade.
  const vCruise = 14.5 + 0.55 * empiricalSpeed + 0.45 * plhOffsetMm;

  // 4. Pitching moment coefficients for Turn (high-speed) and Fade (low-speed)
  const effTurn = Math.sign(0.35 - empiricalTurn) * Math.pow(Math.abs(0.35 - empiricalTurn), 0.74);
  const cmTurnSigned = Math.max(0.0012, effTurn * 0.0068);
  const cmFadeGain = 0.0155 * Math.max(0.15, 0.5 + empiricalFade);
  const rollDamping = 0.0035;
  const spinDecayRate = mold.isGyroOvermold ? 0.014 : 0.022;

  return Object.freeze({
    // Stamped marketing numbers vs. True Physical/Empirical Flight Numbers
    stampedFlight: Object.freeze([stampedSpeed, stampedGlide, stampedTurn, stampedFade]),
    empiricalFlight: Object.freeze([empiricalSpeed, empiricalGlide, empiricalTurn, empiricalFade]),
    speed: empiricalSpeed,
    glide: empiricalGlide,
    turn: empiricalTurn,
    fade: empiricalFade,
    plastic: plasticKey,
    plasticLabel: plasticProf.label,
    plhOffsetMm: +plhOffsetMm.toFixed(2),
    domeOffsetMm: +domeOffsetMm.toFixed(2),
    wearScore: +wearScore.toFixed(2),
    rimWidthMm: +rimWidthMm.toFixed(1),
    massG: +(massKg * 1000).toFixed(1),
    massKg,
    diameterM,
    radiusM,
    areaM2,
    rimWidthM,
    thicknessM,
    isGyroOvermold: Boolean(mold.isGyroOvermold),
    gyroBoost,
    Izz,
    Ixx,
    CL0,
    CL_alpha,
    alphaZeroLift,
    CD0,
    kInduced,
    vCruise,
    cmTurnSigned,
    cmFadeGain,
    rollDamping,
    spinDecayRate,
  });
}

/**
 * Evaluate exact instantaneous 6-DoF aerodynamic forces, torques, and state derivatives.
 * State vector s = [x, y, z, vx, vy, vz, phi, theta, omegaZ]
 */
export function evaluateAeroDerivatives(s, tensor, env = {}) {
  const [x, y, z, vx, vy, vz, phi, theta, omegaZ] = s;
  const spinHand = env.spinChirality ?? 1; // +1 = RHBH / LHFH

  const windShear = z > 0.2 ? Math.pow(Math.min(Math.max(0.2, z), 30) / 10, 0.14) : 0.55;
  const wx = (env.windVx ?? 0) * windShear;
  const wy = (env.windVy ?? 0) * windShear;
  const wz = env.windVz ?? 0;

  const rvx = vx - wx;
  const rvy = vy - wy;
  const rvz = vz - wz;
  const vRelSq = rvx * rvx + rvy * rvy + rvz * rvz;
  const vRel = Math.sqrt(Math.max(1e-6, vRelSq));
  const vHoriz = Math.sqrt(Math.max(1e-6, rvx * rvx + rvy * rvy));

  const gamma = Math.atan2(rvz, vHoriz);
  const psi = Math.atan2(rvy, rvx);
  const alpha = theta - gamma;

  const q = 0.5 * RHO_AIR * vRelSq;
  const qA = q * tensor.areaM2;

  const stallFactor = 1 / (1 + Math.pow(Math.max(0, Math.abs(alpha) - 0.45) / 0.18, 2));
  const CL = (tensor.CL0 + tensor.CL_alpha * alpha) * stallFactor;

  const dAlpha = alpha - tensor.alphaZeroLift;
  const CD = tensor.CD0 + tensor.kInduced * dAlpha * dAlpha;

  const liftMag = qA * CL;
  const dragMag = qA * CD;

  const cosPsi = rvx / vHoriz;
  const sinPsi = rvy / vHoriz;
  const cosGamma = vHoriz / vRel;
  const sinGamma = rvz / vRel;

  const eUpX = -sinGamma * cosPsi;
  const eUpY = -sinGamma * sinPsi;
  const eUpZ = cosGamma;

  const eLatX = -sinPsi;
  const eLatY = cosPsi;
  const eLatZ = 0;

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const liftDirX = cosPhi * eUpX + sinPhi * eLatX;
  const liftDirY = cosPhi * eUpY + sinPhi * eLatY;
  const liftDirZ = cosPhi * eUpZ + sinPhi * eLatZ;

  const Fx = liftMag * liftDirX - dragMag * (rvx / vRel);
  const Fy = liftMag * liftDirY - dragMag * (rvy / vRel);
  const Fz = liftMag * liftDirZ - dragMag * (rvz / vRel) - tensor.massKg * G_ACCEL;

  const ax = Fx / tensor.massKg;
  const ay = Fy / tensor.massKg;
  const az = Fz / tensor.massKg;

  // Center-of-Pressure longitudinal migration across vCruise:
  //   speedRatio > 1.0 -> High-Speed Turn regime (Cm > 0 -> dPhi/dt < 0)
  //   speedRatio < 1.0 -> Low-Speed Fade regime (Cm < 0 -> dPhi/dt > 0)
  const speedRatioSq = (vRel / tensor.vCruise) ** 2;
  const turnRegime = Math.max(0, speedRatioSq - 0.95);
  const fadeRegime = Math.max(0, 1.08 - speedRatioSq) * (1 + 1.6 * Math.max(0, alpha));

  const Cm_turn = tensor.cmTurnSigned * turnRegime;
  const Cm_fade = -tensor.cmFadeGain * fadeRegime;
  const Cm = Cm_turn + Cm_fade;

  const M_pitch = qA * tensor.diameterM * Cm;

  const Lz = Math.max(0.04, tensor.Izz * Math.abs(omegaZ));
  const dPhiPrecession = -spinHand * (M_pitch / Lz);
  const dPhiDamp = -tensor.rollDamping * (qA * tensor.diameterM / Lz) * phi;
  const dPhi = dPhiPrecession + dPhiDamp;

  // Gyroscopically stabilized pitch attitude theta: slowly tracks flight path gamma so AoA stays in realistic 2..12 deg glide window
  const dGamma = (az * cosGamma - (ax * cosPsi + ay * sinPsi) * sinGamma) / Math.max(2.5, vRel);
  const dTheta = 0.48 * dGamma - 0.25 * (alpha - 0.085);

  const dOmegaZ = -tensor.spinDecayRate * (vRel / 20) * omegaZ;

  return {
    deriv: [vx, vy, vz, ax, ay, az, dPhi, dTheta, dOmegaZ],
    telemetry: {
      vRel,
      vHoriz,
      alpha,
      gamma,
      psi,
      CL,
      CD,
      liftMag,
      dragMag,
      Fx,
      Fy,
      Fz,
      Cm,
      Cm_turn,
      Cm_fade,
      M_pitch,
      dPhi,
      dPhiPrecession,
      liftVec: [liftMag * liftDirX, liftMag * liftDirY, liftMag * liftDirZ],
      dragVec: [-dragMag * (rvx / vRel), -dragMag * (rvy / vRel), -dragMag * (rvz / vRel)],
    },
  };
}

/**
 * Integrate a single 6-DoF disc flight trajectory using 4th-order Runge-Kutta (RK4).
 */
export function simulate6DoFFlight({ mold, release, env = {}, dt = 0.005, maxTimeS = 9.0 }) {
  const tensor = mold.Izz ? mold : buildDiscAeroTensor(mold);

  const x0 = (release.x0Ft ?? 0) * FT_TO_M;
  const y0 = (release.y0Ft ?? 0) * FT_TO_M;
  const z0 = (release.z0Ft ?? 4.8) * FT_TO_M;

  const v0 = (release.speedMph ?? 60) * 0.44704;
  const launchRad = (release.launchDeg ?? 8.5) * DEG;
  const aimRad = (release.aimDeg ?? 0) * DEG;
  const hyzerRad = (release.hyzerDeg ?? 0) * DEG;
  const noseRad = (release.noseDeg ?? 0.5) * DEG;

  const defaultRpm = ((0.68 * v0) / tensor.radiusM) * (60 / (2 * Math.PI));
  const spinRpm = release.spinRpm ?? defaultRpm;
  const omegaZ0 = (spinRpm * 2 * Math.PI) / 60;

  const vx0 = v0 * Math.cos(launchRad) * Math.cos(aimRad);
  const vy0 = v0 * Math.cos(launchRad) * Math.sin(aimRad);
  const vz0 = v0 * Math.sin(launchRad);
  const theta0 = launchRad + noseRad;

  const windSpeedMs = (env.windSpeedMph ?? 0) * 0.44704;
  const windRad = (env.windDirDeg ?? 180) * DEG;
  const aeroEnv = {
    windVx: windSpeedMs * Math.cos(windRad),
    windVy: windSpeedMs * Math.sin(windRad),
    windVz: 0,
    spinChirality: env.spinChirality ?? 1,
  };
  const groundZM = (env.targetGroundZFt ?? 0) * FT_TO_M;

  let s = [x0, y0, z0, vx0, vy0, vz0, hyzerRad, theta0, omegaZ0];
  let t = 0;

  const frames = [];
  let maxNewtonResidual = 0;
  let apexFt = z0 * M_TO_FT;
  let maxTurnLateralFt = 0;
  let maxLeftLateralFt = 0;
  let minBankDeg = hyzerRad * RAD;
  let maxBankDeg = hyzerRad * RAD;
  let minPrecessionRadS = Infinity;
  let maxPrecessionRadS = -Infinity;
  let minPrecessionTimeS = 0;
  let maxPrecessionTimeS = 0;

  const totalSteps = Math.ceil(maxTimeS / dt);
  for (let step = 0; step <= totalSteps; step++) {
    const eval0 = evaluateAeroDerivatives(s, tensor, aeroEnv);
    const k1 = eval0.deriv;
    const tel = eval0.telemetry;

    const newtonErr = Math.hypot(
      k1[3] - tel.Fx / tensor.massKg,
      k1[4] - tel.Fy / tensor.massKg,
      k1[5] - tel.Fz / tensor.massKg
    );
    if (newtonErr > maxNewtonResidual) maxNewtonResidual = newtonErr;

    const xFt = s[0] * M_TO_FT;
    const yFt = s[1] * M_TO_FT;
    const zFt = s[2] * M_TO_FT;
    const bankDeg = s[6] * RAD;
    if (zFt > apexFt) apexFt = zFt;
    if (yFt < maxTurnLateralFt) maxTurnLateralFt = yFt;
    if (yFt > maxLeftLateralFt) maxLeftLateralFt = yFt;
    if (bankDeg < minBankDeg) minBankDeg = bankDeg;
    if (bankDeg > maxBankDeg) maxBankDeg = bankDeg;

    if (tel.dPhiPrecession < minPrecessionRadS) {
      minPrecessionRadS = tel.dPhiPrecession;
      minPrecessionTimeS = t;
    }
    if (tel.dPhiPrecession > maxPrecessionRadS) {
      maxPrecessionRadS = tel.dPhiPrecession;
      maxPrecessionTimeS = t;
    }

    if (step % 4 === 0) {
      frames.push({
        t: +t.toFixed(3),
        xFt: +xFt.toFixed(3),
        yFt: +yFt.toFixed(3),
        zFt: +zFt.toFixed(3),
        vxMs: +s[3].toFixed(3),
        vyMs: +s[4].toFixed(3),
        vzMs: +s[5].toFixed(3),
        speedMph: +(tel.vRel / 0.44704).toFixed(2),
        bankDeg: +bankDeg.toFixed(2),
        pitchDeg: +(s[7] * RAD).toFixed(2),
        aoaDeg: +(tel.alpha * RAD).toFixed(2),
        headingDeg: +(tel.psi * RAD).toFixed(2),
        spinRpm: +((s[8] * 60) / (2 * Math.PI)).toFixed(0),
        CL: +tel.CL.toFixed(3),
        CD: +tel.CD.toFixed(3),
        Cm: +tel.Cm.toFixed(4),
        precessionDegPerS: +(tel.dPhiPrecession * RAD).toFixed(2),
        liftVec: tel.liftVec.map(v => +v.toFixed(3)),
        dragVec: tel.dragVec.map(v => +v.toFixed(3)),
      });
    }

    if (step > 5 && s[2] <= groundZM && s[5] < 0) {
      const frac = Math.max(0, Math.min(1, (0 - (s[2] - groundZM)) / Math.max(1e-6, Math.abs(k1[2] * dt))));
      const landXFt = (s[0] - k1[0] * dt * frac) * M_TO_FT;
      const landYFt = (s[1] - k1[1] * dt * frac) * M_TO_FT;
      const landZFt = groundZM * M_TO_FT;
      const landT = t - dt * frac;
      frames.push({
        ...frames[frames.length - 1],
        t: +landT.toFixed(3),
        xFt: +landXFt.toFixed(3),
        yFt: +landYFt.toFixed(3),
        zFt: +landZFt.toFixed(3),
      });
      break;
    }

    const s2 = s.map((v, i) => v + 0.5 * dt * k1[i]);
    const k2 = evaluateAeroDerivatives(s2, tensor, aeroEnv).deriv;
    const s3 = s.map((v, i) => v + 0.5 * dt * k2[i]);
    const k3 = evaluateAeroDerivatives(s3, tensor, aeroEnv).deriv;
    const s4 = s.map((v, i) => v + dt * k3[i]);
    const k4 = evaluateAeroDerivatives(s4, tensor, aeroEnv).deriv;

    s = s.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    t += dt;
  }

  const last = frames[frames.length - 1];
  return {
    tensor,
    release: {
      x0Ft: release.x0Ft ?? 0,
      y0Ft: release.y0Ft ?? 0,
      z0Ft: release.z0Ft ?? 4.8,
      speedMph: +(v0 / 0.44704).toFixed(2),
      launchDeg: +(launchRad * RAD).toFixed(2),
      aimDeg: +(aimRad * RAD).toFixed(2),
      hyzerDeg: +(hyzerRad * RAD).toFixed(2),
      noseDeg: +(noseRad * RAD).toFixed(2),
      spinRpm: +spinRpm.toFixed(0),
    },
    landing: {
      xFt: last.xFt,
      yFt: last.yFt,
      zFt: last.zFt,
      distanceFt: +Math.hypot(last.xFt - (release.x0Ft ?? 0), last.yFt - (release.y0Ft ?? 0)).toFixed(2),
      hangTimeS: last.t,
    },
    metrics: {
      apexFt: +apexFt.toFixed(2),
      maxTurnLateralFt: +maxTurnLateralFt.toFixed(2),
      maxLeftLateralFt: +maxLeftLateralFt.toFixed(2),
      minBankDeg: +minBankDeg.toFixed(2),
      maxBankDeg: +maxBankDeg.toFixed(2),
      earlyPrecessionRadS: +minPrecessionRadS.toFixed(4),
      latePrecessionRadS: +maxPrecessionRadS.toFixed(4),
      turnBeforeFade: minPrecessionTimeS < maxPrecessionTimeS,
      maxNewtonResidual,
    },
    frames,
  };
}
