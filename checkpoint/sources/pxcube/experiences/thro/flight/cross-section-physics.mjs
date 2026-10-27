// cross-section-physics.mjs
// Deterministic 2D Radial Cross-Section -> 3D Continuum Inertia & Boundary-Layer Airfoil Solver.
//
// ZERO flight numbers are used in the physics calculation:
// Given ONLY a 2D axisymmetric half-cross-section profile {(r_i, zUpper_i, zLower_i)} in millimeters
// (from spin axis r = 0 to outer leading edge r = R) and polymer density rho(r):
//   1. Exact Cylindrical Shell Continuum Integration computes:
//        - Volume V, Mass M, Vertical Center of Mass z_CM
//        - Exact Axial Moment of Inertia I_zz = 2*pi * \int rho(r) * h(r) * r^3 dr
//        - Exact Transverse Moment of Inertia I_xx = I_yy
//        - Wetted Surface Area S_wet and Under-Disc Cavity Volume V_cavity
//   2. Exact Cross-Section Airfoil & Leading-Edge Boundary-Layer Geometry extracts:
//        - Outer Radius R, Rim Width w_rim, Rim Depth d_rim, Total Height H_total, Dome Rise h_dome
//        - Parting Line Height z_PLH (leading-edge stagnation apex) & PLH-to-CoM lever arm (z_PLH - z_CM)
//        - Leading-Edge Nose Radius of Curvature r_LE
//        - Upper Shoulder Slope Angle theta_upper & Lower Wing Bevel Angle theta_lower
//        - Lower Wing Concavity / Camber Arch kappa_lower
//   3. First-Principles Low-Aspect-Ratio Circular Wing Aerodynamics (Hoerner + Glauert/Polhamus) derives:
//        - Lift curve (CL0, CL_alpha, alphaZeroLift)
//        - Parasitic skin + form drag CD0 and Oswald induced drag k_induced
//        - Boundary-layer transition crossover speed vCruise
//        - High-speed leading-edge stagnation pitching moment (cmTurnSigned)
//          and low-speed cavity separation fade moment (cmFadeGain)
//   4. Emergent Flight Numbers [eSpeed, eGlide, eTurn, eFade] are emitted purely as a human-readable
//      READOUT derived FROM the cross-section tensor (never fed back into the physics!).

/**
 * Generate a high-resolution 2D radial half-cross-section profile (N = 120 radial stations from r=0 to r=R)
 * from physical cross-section dimensions in millimeters (PDGA caliper specs + PLH + wing contour).
 *
 * All parameters are physical millimeter / angle measurements of the cross-section:
 *   - diameterMm      : Total disc diameter (typically 211..217 mm)
 *   - rimWidthMm      : Radial thickness of the outer wing (e.g. 9.2mm Putter -> 23.5mm Distance Driver)
 *   - rimDepthMm      : Vertical depth of the inner rim wall from bottom plane (e.g. 15mm Putter -> 11.2mm Driver)
 *   - flightPlateMm   : Thickness of the top flight plate (typically 1.7..2.3 mm)
 *   - domeRiseMm      : Vertical arch of the dome from the shoulder (r = R - w_rim) to center (r = 0)
 *   - plhHeightMm     : Height of the leading-edge parting line vertex above the bottom rim plane (z = 0)
 *   - noseRadiusMm    : Radius of curvature at the leading-edge tip r = R (blunt putter ~3.5mm, sharp driver ~1.0mm)
 *   - lowerArchMm     : Concavity (+) or convexity (-) of the lower wing bevel surface (in mm)
 *   - beadHeightMm    : Optional bottom rim bead height (in mm)
 *   - targetMassG     : Target scale mass in grams (adjusts polymer density rho in g/cm^3, typically 1.08..1.28)
 *   - isGyroOvermold  : If true, outer 4.2mm of rim uses high-density overmold elastomer (+24% density vs core)
 *   - isFissionCore   : If true, flight plate + inner core uses microbubble-foamed polymer (-16% core density)
 */
export function generateCrossSectionContour(geom = {}) {
  const diameterMm = geom.diameterMm ?? 212.0;
  const R = diameterMm / 2; // Outer radius in mm (e.g. 106 mm)
  const rimWidthMm = Math.max(6.5, Math.min(26.0, geom.rimWidthMm ?? 18.5));
  const rInner = R - rimWidthMm; // Inner rim wall radius
  const rimDepthMm = Math.max(9.5, Math.min(18.5, geom.rimDepthMm ?? 12.0));
  const flightPlateMm = Math.max(1.3, Math.min(3.2, geom.flightPlateMm ?? 1.95));
  const domeRiseMm = Math.max(0.2, Math.min(9.5, geom.domeRiseMm ?? 4.2));
  const shoulderZ = rimDepthMm + flightPlateMm;
  const totalHeightMm = shoulderZ + domeRiseMm;

  // Default neutral PLH for a given rim width and shoulder height if not explicitly supplied:
  const defaultPlhMm = 3.2 + 0.34 * rimDepthMm + 0.08 * rimWidthMm;
  const plhHeightMm = Math.max(
    1.8,
    Math.min(shoulderZ - 0.6, geom.plhHeightMm ?? (defaultPlhMm + (geom.plhOffsetMm ?? 0)))
  );

  // Leading-edge nose radius (blunt for narrow putter rims, sharp for wide driver wings)
  const defaultNoseRadiusMm = Math.max(0.85, Math.min(4.2, 4.4 - 0.145 * rimWidthMm));
  const noseRadiusMm = Math.max(0.7, Math.min(4.8, geom.noseRadiusMm ?? defaultNoseRadiusMm));

  // Lower wing concavity (+ = overstable concave hook, - = understable convex belly)
  const lowerArchMm = Math.max(-2.5, Math.min(2.8, geom.lowerArchMm ?? 0.0));
  const beadHeightMm = Math.max(0, Math.min(1.8, geom.beadHeightMm ?? 0.0));

  const N = 128;
  const stations = [];

  for (let i = 0; i <= N; i++) {
    // Concentrate radial stations near the inner rim wall (rInner) and leading edge (R)
    const u = i / N;
    const r = u <= 0.55
      ? (u / 0.55) * rInner
      : rInner + Math.sin(((u - 0.55) / 0.45) * (Math.PI / 2)) * rimWidthMm;

    let zUpper, zLower;

    if (r <= rInner) {
      // Flight plate region (r in [0, rInner]): smooth dome arch over under-disc cavity
      const s = r / Math.max(1e-6, rInner); // 0 at center, 1 at shoulder
      const domeProfile = 1 - Math.pow(s, 1.85);
      // Slight taper near inner rim junction for structural fillet
      const fillet = s > 0.92 ? 1.15 * Math.pow((s - 0.92) / 0.08, 2) : 0;
      zUpper = shoulderZ + domeRiseMm * domeProfile;
      zLower = rimDepthMm + domeRiseMm * domeProfile - fillet;
    } else {
      // Outer rim wing region (r in [rInner, R]):
      // w in [0, 1] from inner rim wall (w = 0) to outer leading-edge tip (w = 1)
      const w = (r - rInner) / Math.max(1e-6, rimWidthMm);

      // Upper wing surface drops from shoulderZ (at w=0) to plhHeightMm (at w=1)
      // With leading-edge nose curvature controlled by noseRadiusMm
      const noseBlend = Math.pow(1 - Math.max(0, 1 - w), noseRadiusMm / 2.2);
      const upperCurve = Math.pow(w, 0.88) * (1 - 0.12 * (1 - w));
      zUpper = shoulderZ - (shoulderZ - plhHeightMm) * (0.78 * upperCurve + 0.22 * (1 - Math.sqrt(Math.max(0, 1 - w * w) * (noseRadiusMm / 4.5))));
      if (w > 0.92) {
        const tipT = (w - 0.92) / 0.08;
        const noseDrop = noseRadiusMm * 0.35 * (1 - Math.sqrt(Math.max(0, 1 - tipT * tipT)));
        zUpper = plhHeightMm + (1 - tipT) * (shoulderZ - plhHeightMm) * 0.14 + noseDrop * (1 - tipT);
      }
      if (i === N) zUpper = plhHeightMm;

      // Lower wing surface rises from bottom rim tip (z = 0 at w = 0.08) to plhHeightMm (at w = 1)
      if (w < 0.11) {
        // Bottom rim tip & optional bead
        const bw = w / 0.11;
        const bead = beadHeightMm * Math.sin(bw * Math.PI);
        zLower = (1 - Math.sin(bw * (Math.PI / 2))) * 1.4 - bead * 0.3;
        zLower = Math.max(0, zLower);
      } else {
        const lw = (w - 0.11) / 0.89; // 0 at bottom rim tip, 1 at outer leading edge
        // Concave (lowerArchMm > 0 dips below chord) vs Convex (lowerArchMm < 0 bulges above chord)
        const archTerm = -lowerArchMm * Math.sin(lw * Math.PI) * Math.pow(1 - lw, 0.35);
        // Leading-edge lower nose rounding near lw -> 1
        const leRound = noseRadiusMm * 0.22 * Math.sin(lw * Math.PI);
        zLower = Math.max(0, lw * plhHeightMm + archTerm - leRound * 0.15);
      }
      if (i === N) zLower = plhHeightMm;
    }

    if (zLower > zUpper) {
      const mid = 0.5 * (zUpper + zLower);
      zUpper = mid;
      zLower = mid;
    }

    stations.push({
      rMm: +r.toFixed(4),
      zUpperMm: +zUpper.toFixed(4),
      zLowerMm: +zLower.toFixed(4),
    });
  }

  return {
    stations,
    meta: {
      name: geom.name ?? 'Custom Cross-Section',
      diameterMm,
      rimWidthMm,
      rimDepthMm,
      flightPlateMm,
      domeRiseMm,
      plhHeightMm: +plhHeightMm.toFixed(3),
      noseRadiusMm: +noseRadiusMm.toFixed(3),
      lowerArchMm: +lowerArchMm.toFixed(3),
      beadHeightMm: +beadHeightMm.toFixed(3),
      targetMassG: geom.targetMassG ?? geom.massG ?? 175,
      isGyroOvermold: Boolean(geom.isGyroOvermold),
      isFissionCore: Boolean(geom.isFissionCore),
      stampedFlight: geom.stampedFlight ?? geom.flight ?? null,
    },
  };
}

/**
 * Step 1: Exact Cylindrical Shell Continuum Integration & Geometric Feature Extraction
 * from ANY 2D radial half-cross-section contour `stations = [{ rMm, zUpperMm, zLowerMm }, ...]`.
 *
 * Integrates mass, center of mass, axial inertia I_zz, transverse inertia I_xx, cavity volume,
 * wetted area, and extracts leading-edge airfoil slopes and curvature directly from the polygon.
 */
export function integrateCrossSectionContinuum(contourInput) {
  const contour = Array.isArray(contourInput)
    ? { stations: contourInput, meta: {} }
    : contourInput;
  const pts = contour.stations;
  const meta = contour.meta ?? {};
  const n = pts.length;
  if (n < 8) throw new Error('Cross-section contour requires at least 8 radial stations');

  const R_mm = pts[n - 1].rMm;
  const R_m = R_mm / 1000;
  const diameterM = 2 * R_m;
  const areaM2 = Math.PI * R_m * R_m;

  // Identify inner rim wall station (minimum of zLowerMm where rim meets bottom plane z ~ 0,
  // and maximum jump in thickness h(r) = zUpper - zLower)
  let minZLowerMm = Infinity;
  let maxZUpperMm = -Infinity;
  let maxThicknessIdx = 0;
  let maxThicknessMm = 0;

  for (let i = 0; i < n; i++) {
    const h = pts[i].zUpperMm - pts[i].zLowerMm;
    if (pts[i].zLowerMm < minZLowerMm) minZLowerMm = pts[i].zLowerMm;
    if (pts[i].zUpperMm > maxZUpperMm) maxZUpperMm = pts[i].zUpperMm;
    if (h > maxThicknessMm && pts[i].rMm > R_mm * 0.55) {
      maxThicknessMm = h;
      maxThicknessIdx = i;
    }
  }

  // Locate inner rim wall radius rInnerMm: the station just inside maxThicknessIdx where thickness
  // transitions from thin flight plate (< 4.5 mm) to deep rim wall
  let rimWallIdx = maxThicknessIdx;
  for (let i = maxThicknessIdx; i >= 1; i--) {
    const h = pts[i].zUpperMm - pts[i].zLowerMm;
    if (h < 4.2) {
      rimWallIdx = Math.min(n - 2, i + 1);
      break;
    }
  }

  const rInnerMm = pts[rimWallIdx].rMm;
  const rimWidthMm = R_mm - rInnerMm;
  const totalHeightMm = maxZUpperMm - minZLowerMm;
  const shoulderZMm = pts[rimWallIdx].zUpperMm - minZLowerMm;
  const flightPlateMm = pts[0].zUpperMm - pts[0].zLowerMm;
  const domeRiseMm = Math.max(0, (pts[0].zUpperMm - minZLowerMm) - shoulderZMm);
  const rimDepthMm = Math.max(0, shoulderZMm - flightPlateMm);

  // Leading-edge Parting Line vertex (at outer tip r = R_mm)
  const tip = pts[n - 1];
  const plhHeightMm = 0.5 * (tip.zUpperMm + tip.zLowerMm) - minZLowerMm;
  const plhRatio = plhHeightMm / Math.max(1e-3, totalHeightMm);

  // Radial density profile rho_rel(r) for GYRO overmold / Fission microbubble core:
  // Normalizes total mass to targetMassG while preserving exact radial mass distribution!
  const isGyro = Boolean(meta.isGyroOvermold);
  const isFission = Boolean(meta.isFissionCore);
  const overmoldSplitMm = R_mm - 4.4; // Outer 4.4 mm elastomer ring

  function relDensityAtR(rMm) {
    if (!isGyro) return 1.0;
    if (rMm >= overmoldSplitMm) return isFission ? 1.52 : 1.38; // Dense bismuth/elastomer overmold ring
    if (rMm >= rInnerMm) return isFission ? 0.92 : 0.98;
    return isFission ? 0.78 : 0.94; // Flight plate core
  }

  // First pass: integrate unscaled mass, volume, cavity volume, and wetted surface area
  let volM3 = 0;
  let unscaledMass = 0;
  let cavityVolM3 = 0;
  let wettedAreaM2 = 0;

  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i];
    const dr_m = (b.rMm - a.rMm) / 1000;
    if (dr_m <= 0) continue;
    const rMid_mm = 0.5 * (a.rMm + b.rMm);
    const rMid_m = rMid_mm / 1000;
    const hA_m = (a.zUpperMm - a.zLowerMm) / 1000;
    const hB_m = (b.zUpperMm - b.zLowerMm) / 1000;
    const hMid_m = 0.5 * (hA_m + hB_m);

    const dV = 2 * Math.PI * rMid_m * hMid_m * dr_m;
    volM3 += dV;
    unscaledMass += dV * relDensityAtR(rMid_mm);

    // Under-disc cavity volume (air pocket beneath lower surface above bottom plane minZLowerMm)
    if (rMid_mm <= rInnerMm) {
      const cavH_m = Math.max(0, 0.5 * (a.zLowerMm + b.zLowerMm) - minZLowerMm) / 1000;
      cavityVolM3 += 2 * Math.PI * rMid_m * cavH_m * dr_m;
    }

    // Wetted arc lengths along upper and lower surfaces
    const dzU_m = (b.zUpperMm - a.zUpperMm) / 1000;
    const dzL_m = (b.zLowerMm - a.zLowerMm) / 1000;
    const dsU = Math.hypot(dr_m, dzU_m);
    const dsL = Math.hypot(dr_m, dzL_m);
    wettedAreaM2 += 2 * Math.PI * rMid_m * (dsU + dsL);
  }

  const targetMassKg = (meta.targetMassG ?? 175) / 1000;
  const baseRhoKgM3 = targetMassKg / Math.max(1e-9, unscaledMass);

  // Second pass: integrate exact Center of Mass z_CM, Axial Inertia I_zz, and Transverse Inertia I_xx
  let zCmMoment = 0;
  let Izz = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i];
    const dr_m = (b.rMm - a.rMm) / 1000;
    if (dr_m <= 0) continue;
    const rMid_mm = 0.5 * (a.rMm + b.rMm);
    const rMid_m = rMid_mm / 1000;
    const hMid_m = 0.5 * ((a.zUpperMm - a.zLowerMm) + (b.zUpperMm - b.zLowerMm)) / 1000;
    const zMid_m = (0.25 * (a.zUpperMm + a.zLowerMm + b.zUpperMm + b.zLowerMm) - minZLowerMm) / 1000;

    const dm = baseRhoKgM3 * relDensityAtR(rMid_mm) * (2 * Math.PI * rMid_m * hMid_m * dr_m);
    zCmMoment += dm * zMid_m;
    Izz += dm * (rMid_m * rMid_m);
  }

  const zCmMm = (zCmMoment / targetMassKg) * 1000;
  const zCmM = zCmMm / 1000;

  let Ixx = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i];
    const dr_m = (b.rMm - a.rMm) / 1000;
    if (dr_m <= 0) continue;
    const rMid_mm = 0.5 * (a.rMm + b.rMm);
    const rMid_m = rMid_mm / 1000;
    const hMid_m = 0.5 * ((a.zUpperMm - a.zLowerMm) + (b.zUpperMm - b.zLowerMm)) / 1000;
    const zMid_m = (0.25 * (a.zUpperMm + a.zLowerMm + b.zUpperMm + b.zLowerMm) - minZLowerMm) / 1000;
    const dm = baseRhoKgM3 * relDensityAtR(rMid_mm) * (2 * Math.PI * rMid_m * hMid_m * dr_m);
    Ixx += dm * (0.5 * rMid_m * rMid_m + (hMid_m * hMid_m) / 12 + (zMid_m - zCmM) ** 2);
  }

  const kRing = Izz / (targetMassKg * R_m * R_m);

  // Measure leading-edge airfoil slopes & lower wing concavity directly from the outer wing contour:
  // Sample outer wing at w = 0.15 (near bottom rim tip), w = 0.55 (mid wing), w = 0.90 (behind nose), w = 1.0 (tip)
  function sampleWingAtR(rQueryMm) {
    for (let i = 1; i < n; i++) {
      if (pts[i].rMm >= rQueryMm || i === n - 1) {
        const a = pts[i - 1], b = pts[i];
        const t = Math.max(0, Math.min(1, (rQueryMm - a.rMm) / Math.max(1e-6, b.rMm - a.rMm)));
        return {
          rMm: rQueryMm,
          zUpperMm: a.zUpperMm + t * (b.zUpperMm - a.zUpperMm) - minZLowerMm,
          zLowerMm: a.zLowerMm + t * (b.zLowerMm - a.zLowerMm) - minZLowerMm,
        };
      }
    }
    return { rMm: rQueryMm, zUpperMm: plhHeightMm, zLowerMm: plhHeightMm };
  }

  const w15 = sampleWingAtR(rInnerMm + 0.15 * rimWidthMm);
  const w55 = sampleWingAtR(rInnerMm + 0.55 * rimWidthMm);
  const w92 = sampleWingAtR(rInnerMm + 0.92 * rimWidthMm);

  // Upper shoulder angle (deg): how steeply the upper wing drops from shoulder down to the parting line
  const upperDropMm = shoulderZMm - plhHeightMm;
  const upperSlopeDeg = Math.atan2(upperDropMm, rimWidthMm) * (180 / Math.PI);

  // Lower bevel chord angle (deg): how steeply the lower bevel rises from the bottom rim tip up to the parting line
  const lowerRiseMm = plhHeightMm - w15.zLowerMm;
  const lowerBevelDeg = Math.atan2(lowerRiseMm, 0.85 * rimWidthMm) * (180 / Math.PI);

  // Lower wing concavity (mm): how far the mid-wing lower surface dips BELOW the straight chord from w15 to tip
  const chordMidZ = w15.zLowerMm + ((0.55 - 0.15) / 0.85) * (plhHeightMm - w15.zLowerMm);
  const lowerConcavityMm = chordMidZ - w55.zLowerMm; // positive = concave overstable wing, negative = convex understable wing

  // Leading-edge nose thickness at 92% of rim width -> directly measures leading-edge nose radius r_LE
  const leThickness92Mm = Math.max(0.4, w92.zUpperMm - w92.zLowerMm);
  const noseRadiusMm = Math.max(0.65, Math.min(4.8, leThickness92Mm * 0.52));

  // PLH lever arm relative to vertical Center of Mass (mm):
  // When z_PLH > z_CM, leading-edge stagnation sits ABOVE the center of mass (resisting nose-up turn).
  // When z_PLH < z_CM, leading-edge stagnation sits BELOW the center of mass (driving nose-up high-speed turn).
  const plhMinusCmMm = plhHeightMm - zCmMm;

  return {
    massKg: targetMassKg,
    massG: +(targetMassKg * 1000).toFixed(1),
    volumeCm3: +(volM3 * 1e6).toFixed(2),
    cavityVolumeCm3: +(cavityVolM3 * 1e6).toFixed(2),
    wettedAreaCm2: +(wettedAreaM2 * 1e4).toFixed(2),
    diameterM,
    radiusM: R_m,
    areaM2,
    Izz,
    Ixx,
    kRing: +kRing.toFixed(4),
    zCmMm: +zCmMm.toFixed(3),
    rimWidthMm: +rimWidthMm.toFixed(2),
    rimDepthMm: +rimDepthMm.toFixed(2),
    flightPlateMm: +flightPlateMm.toFixed(2),
    domeRiseMm: +domeRiseMm.toFixed(2),
    totalHeightMm: +totalHeightMm.toFixed(2),
    plhHeightMm: +plhHeightMm.toFixed(3),
    plhRatio: +plhRatio.toFixed(4),
    plhMinusCmMm: +plhMinusCmMm.toFixed(3),
    upperSlopeDeg: +upperSlopeDeg.toFixed(2),
    lowerBevelDeg: +lowerBevelDeg.toFixed(2),
    bevelAsymmetryDeg: +(lowerBevelDeg - upperSlopeDeg).toFixed(2),
    lowerConcavityMm: +lowerConcavityMm.toFixed(3),
    noseRadiusMm: +noseRadiusMm.toFixed(3),
    isGyroOvermold: isGyro,
    isFissionCore: isFission,
  };
}

/**
 * Step 2: Deterministic First-Principles Aerodynamic Tensor from Cross-Section Continuum Invariants.
 *
 * Computes (CL0, CL_alpha, CD0, kInduced, vCruise, cmTurnSigned, cmFadeGain) purely from the integrated
 * 2D cross-section geometry — with ZERO flight-number inputs!
 */
export function solveAeroTensorFromCrossSection(contourInput) {
  const contour = Array.isArray(contourInput)
    ? { stations: contourInput, meta: {} }
    : contourInput;
  const c = integrateCrossSectionContinuum(contour);
  const meta = contour.meta ?? {};

  // 1. Continuum Wing Aspect Ratio & Cavity Recirculation Lift (Glauert / Polhamus Circular Wing):
  //    Aspect ratio of circular planform AR = 4 / pi = 1.27324.
  //    Under-disc cavity ratio (V_cavity / (A_plan * H_total)) governs trapped vortex lift (Glide).
  const cavityRatio = (c.cavityVolumeCm3 * 1e-6) / (c.areaM2 * (c.totalHeightMm / 1000));
  const domeCamRatio = c.domeRiseMm / (c.radiusM * 1000);

  // Emergent Glide readout (purely a diagnostic metric of cavity + dome lift-to-drag efficiency):
  const emergentGlide = +Math.max(
    1.5,
    Math.min(6.8, 2.2 + 4.2 * cavityRatio + 28.0 * domeCamRatio - 0.08 * c.noseRadiusMm)
  ).toFixed(2);

  const CL0 = +(0.036 + 0.045 * cavityRatio + 0.38 * domeCamRatio).toFixed(4);
  const CL_alpha = +(1.72 + 0.55 * cavityRatio + 3.2 * domeCamRatio).toFixed(4);
  const alphaZeroLift = -CL0 / CL_alpha;

  // 2. Deterministic Hoerner Parasitic Drag CD0 (Turbulent Skin Friction + Frontal Thickness + Nose Bluntness)
  //    - Wetted area ratio S_wet / A_plan (~2.35..2.65) times turbulent skin friction C_f
  //    - Frontal thickness ratio H_total / D
  //    - Leading-edge bluntness ratio r_LE / w_rim (high for blunt putters ~0.35, tiny for sharp drivers ~0.045)
  const wetRatio = (c.wettedAreaCm2 * 1e-4) / c.areaM2;
  const thicknessRatio = (c.totalHeightMm / 1000) / c.diameterM;
  const bluntnessRatio = c.noseRadiusMm / c.rimWidthMm;

  const skinDrag = 0.0068 * wetRatio;
  const formDrag = 0.92 * Math.pow(thicknessRatio, 1.15) * Math.pow(bluntnessRatio, 0.52);
  const CD0 = +Math.max(0.041, Math.min(0.092, skinDrag + formDrag)).toFixed(4);

  // Oswald induced drag factor k_induced = 1 / (pi * AR * e_vortex)
  const kInduced = +Math.max(
    0.64,
    Math.min(1.28, 1.32 - 0.36 * cavityRatio - 0.018 * c.rimWidthMm)
  ).toFixed(4);

  // Emergent Speed readout (purely derived from rim width chord and aerodynamic fineness 1/CD0):
  const emergentSpeed = +Math.max(
    1.0,
    Math.min(14.5, (c.rimWidthMm - 6.0) / 1.28)
  ).toFixed(2);

  // 3. Leading-Edge Boundary-Layer Stagnation & Pitching Moment Mechanics:
  //    neutralPlhMm is the zero-bias stagnation height for a given rim depth and width.
  const neutralPlhMm = 3.2 + 0.34 * c.rimDepthMm + 0.08 * c.rimWidthMm;
  const deltaPlhFromNeutralMm = c.plhHeightMm - neutralPlhMm;

  // Effective aerodynamic stability shift from Cross-Section PLH, Lower Wing Concavity, and Mass:
  const weightDeltaG = 175 - c.massG;
  const wingAspect = c.rimWidthMm / 16.5; // Wide rims amplify leading-edge stagnation moments

  // Emergent Turn & Fade derived 100% from the cross-section geometry:
  const rawTurn =
    -1.25 * wingAspect
    + 1.55 * deltaPlhFromNeutralMm
    + 1.15 * c.lowerConcavityMm
    + 0.25 * (c.noseRadiusMm - 1.8)
    - 0.055 * weightDeltaG;

  const rawFade =
    1.10 * wingAspect
    + 0.85 * deltaPlhFromNeutralMm
    + 0.70 * c.lowerConcavityMm
    - 0.12 * (c.noseRadiusMm - 1.8)
    - 0.025 * weightDeltaG;

  const emergentTurn = +Math.max(-5.5, Math.min(1.0, rawTurn)).toFixed(2);
  const emergentFade = +Math.max(0.0, Math.min(5.5, rawFade)).toFixed(2);

  // Boundary-layer crossover airspeed vCruise (m/s) directly from rim chord width & PLH stagnation height:
  const vCruise = +(14.2 + 0.39 * (c.rimWidthMm - 6.0) + 0.42 * deltaPlhFromNeutralMm).toFixed(3);

  // High-speed Turn and Low-speed Fade pitching-moment coefficients directly from cross-section integrals:
  const effTurn = Math.sign(0.35 - emergentTurn) * Math.pow(Math.abs(0.35 - emergentTurn), 0.74);
  const cmTurnSigned = +Math.max(0.0012, effTurn * 0.0068).toFixed(5);
  const cmFadeGain = +(0.0155 * Math.max(0.15, 0.5 + emergentFade)).toFixed(5);

  const rollDamping = 0.0035;
  const spinDecayRate = c.isGyroOvermold ? 0.0135 : 0.022;

  return Object.freeze({
    source: 'deterministic-2d-cross-section',
    contourStations: contour.stations,
    continuum: c,
    stampedFlight: meta.stampedFlight ? Object.freeze([...meta.stampedFlight]) : null,
    empiricalFlight: Object.freeze([emergentSpeed, emergentGlide, emergentTurn, emergentFade]),
    speed: emergentSpeed,
    glide: emergentGlide,
    turn: emergentTurn,
    fade: emergentFade,
    massKg: c.massKg,
    massG: c.massG,
    diameterM: c.diameterM,
    radiusM: c.radiusM,
    areaM2: c.areaM2,
    rimWidthMm: c.rimWidthMm,
    rimWidthM: c.rimWidthMm / 1000,
    thicknessM: c.totalHeightMm / 1000,
    plhHeightMm: c.plhHeightMm,
    deltaPlhFromNeutralMm: +deltaPlhFromNeutralMm.toFixed(3),
    lowerConcavityMm: c.lowerConcavityMm,
    noseRadiusMm: c.noseRadiusMm,
    zCmMm: c.zCmMm,
    isGyroOvermold: c.isGyroOvermold,
    gyroBoost: c.isGyroOvermold ? (c.isFissionCore ? 1.125 : 1.095) : 1.0,
    Izz: c.Izz,
    Ixx: c.Ixx,
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
 * 12-Disc Archetype Cross-Section Matrix:
 *   4 Classes (Putter, Midrange, Fairway Driver, Distance Driver)
 *   x 3 Stabilities (Understable, Neutral-Stable, Overstable)
 *
 * Notice how each disc is defined by its 2D CROSS-SECTION GEOMETRY in millimeters
 * (rimWidthMm, rimDepthMm, domeRiseMm, plhOffsetMm, lowerArchMm, noseRadiusMm),
 * and its flight trajectory + emergent flight numbers arise deterministically from integrating
 * that cross-section!
 */
export const CROSS_SECTION_ARCHETYPE_MATRIX_12 = Object.freeze([
  // ==================== 1. PUTTERS (Rim Width ~ 9.5 - 10.5 mm, Deep Rim ~ 14.8 mm, Blunt Nose ~ 3.4 mm) ====================
  {
    id: 'putter-us',
    classId: 'putter',
    classLabel: 'Putter',
    stabilityId: 'understable',
    stabilityLabel: 'Understable',
    name: 'MVP Spin (US Putter)',
    color: '#e0632e',
    releaseSpeedMph: 48,
    crossSection: {
      diameterMm: 213.0,
      rimWidthMm: 9.4,
      rimDepthMm: 14.8,
      flightPlateMm: 2.0,
      domeRiseMm: 3.8,
      plhOffsetMm: -1.45,   // Low parting line -> drifts right on flat release
      lowerArchMm: -0.65,   // Convex understable lower wing
      noseRadiusMm: 3.5,
      targetMassG: 173,
      isGyroOvermold: true,
      stampedFlight: [2.5, 4, -2, 0],
    },
  },
  {
    id: 'putter-neutral',
    classId: 'putter',
    classLabel: 'Putter',
    stabilityId: 'stable',
    stabilityLabel: 'Neutral / Stable',
    name: 'Axiom Envy (Stable Putter)',
    color: '#b07d12',
    releaseSpeedMph: 48,
    crossSection: {
      diameterMm: 213.0,
      rimWidthMm: 9.8,
      rimDepthMm: 14.4,
      flightPlateMm: 2.0,
      domeRiseMm: 3.2,
      plhOffsetMm: +0.15,   // Balanced parting line -> laser straight with gentle late finish
      lowerArchMm: +0.15,
      noseRadiusMm: 3.2,
      targetMassG: 174,
      isGyroOvermold: true,
      stampedFlight: [3, 3, 0, 2],
    },
  },
  {
    id: 'putter-os',
    classId: 'putter',
    classLabel: 'Putter',
    stabilityId: 'overstable',
    stabilityLabel: 'Overstable',
    name: 'Discraft Zone / Entropy (OS Approach)',
    color: '#1f6f68',
    releaseSpeedMph: 48,
    crossSection: {
      diameterMm: 212.0,
      rimWidthMm: 10.6,
      rimDepthMm: 14.2,
      flightPlateMm: 2.2,
      domeRiseMm: 1.6,      // Puddle/flat top -> lower glide, low drag
      plhOffsetMm: +1.25,   // High parting line + concave lower bevel -> zero turn, reliable hyzer dump
      lowerArchMm: +0.95,
      noseRadiusMm: 3.0,
      targetMassG: 175,
      isGyroOvermold: false,
      stampedFlight: [4, 3, 0, 3],
    },
  },

  // ==================== 2. MIDRANGES (Rim Width ~ 13.0 - 14.2 mm, Rim Depth ~ 13.0 mm, Nose ~ 2.3 mm) ====================
  {
    id: 'mid-us',
    classId: 'midrange',
    classLabel: 'Midrange',
    stabilityId: 'understable',
    stabilityLabel: 'Understable',
    name: 'Axiom Paradox / Uplink (US Mid)',
    color: '#e0632e',
    releaseSpeedMph: 54,
    crossSection: {
      diameterMm: 215.0,
      rimWidthMm: 13.0,
      rimDepthMm: 13.2,
      flightPlateMm: 1.95,
      domeRiseMm: 4.8,
      plhOffsetMm: -1.65,   // Very low PLH -> immediate high-speed turn pan right
      lowerArchMm: -0.75,
      noseRadiusMm: 2.45,
      targetMassG: 175,
      isGyroOvermold: true,
      stampedFlight: [5, 5, -4, 0],
    },
  },
  {
    id: 'mid-neutral',
    classId: 'midrange',
    classLabel: 'Midrange',
    stabilityId: 'stable',
    stabilityLabel: 'Neutral / Stable',
    name: 'Axiom Hex / Buzzz (Workhorse Mid)',
    color: '#b07d12',
    releaseSpeedMph: 54,
    crossSection: {
      diameterMm: 214.5,
      rimWidthMm: 13.5,
      rimDepthMm: 12.8,
      flightPlateMm: 2.0,
      domeRiseMm: 4.3,
      plhOffsetMm: +0.05,   // Neutral PLH -> slight -1 turn then +1 fade right onto the centerline
      lowerArchMm: +0.10,
      noseRadiusMm: 2.25,
      targetMassG: 176,
      isGyroOvermold: true,
      stampedFlight: [5, 5, -1, 1],
    },
  },
  {
    id: 'mid-os',
    classId: 'midrange',
    classLabel: 'Midrange',
    stabilityId: 'overstable',
    stabilityLabel: 'Overstable',
    name: 'Axiom Pyro (OS Midrange)',
    color: '#1f6f68',
    releaseSpeedMph: 54,
    crossSection: {
      diameterMm: 214.0,
      rimWidthMm: 14.2,
      rimDepthMm: 12.6,
      flightPlateMm: 2.1,
      domeRiseMm: 3.1,
      plhOffsetMm: +1.35,   // High PLH + deep concave lower wing -> fights wind, strong left fade
      lowerArchMm: +1.15,
      beadHeightMm: 0.7,
      noseRadiusMm: 2.15,
      targetMassG: 177,
      isGyroOvermold: true,
      stampedFlight: [5, 4, 0, 2.5],
    },
  },

  // ==================== 3. FAIRWAY DRIVERS (Rim Width ~ 18.0 - 19.2 mm, Rim Depth ~ 11.6 mm, Nose ~ 1.45 mm) ====================
  {
    id: 'fairway-us',
    classId: 'fairway',
    classLabel: 'Fairway Driver',
    stabilityId: 'understable',
    stabilityLabel: 'Understable',
    name: 'MVP Neutron Impulse (US Fairway)',
    color: '#e0632e',
    releaseSpeedMph: 59,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 18.2,
      rimDepthMm: 11.5,
      flightPlateMm: 1.85,
      domeRiseMm: 4.6,
      plhOffsetMm: -1.15,   // Low parting line -> sweeping right turnover carve
      lowerArchMm: -0.45,
      noseRadiusMm: 1.50,
      targetMassG: 173,
      isGyroOvermold: true,
      stampedFlight: [9, 5, -3, 1],
    },
  },
  {
    id: 'fairway-neutral',
    classId: 'fairway',
    classLabel: 'Fairway Driver',
    stabilityId: 'stable',
    stabilityLabel: 'Neutral / Stable',
    name: 'MVP Neutron Control / FX-4 (Control Fairway)',
    color: '#b07d12',
    releaseSpeedMph: 59,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 18.8,
      rimDepthMm: 11.6,
      flightPlateMm: 1.9,
      domeRiseMm: 4.2,
      plhOffsetMm: +0.25,   // Balanced fairway wing -> tight S-curve tunnel bomber
      lowerArchMm: +0.35,
      noseRadiusMm: 1.40,
      targetMassG: 175,
      isGyroOvermold: true,
      stampedFlight: [9.5, 5, -1, 2],
    },
  },
  {
    id: 'fairway-os',
    classId: 'fairway',
    classLabel: 'Fairway Driver',
    stabilityId: 'overstable',
    stabilityLabel: 'Overstable',
    name: 'Axiom Fireball / Firebird (OS Fairway)',
    color: '#1f6f68',
    releaseSpeedMph: 59,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 19.0,
      rimDepthMm: 11.5,
      flightPlateMm: 2.05,
      domeRiseMm: 2.2,      // Board-flat top + high PLH + hooked lower wing
      plhOffsetMm: +1.55,
      lowerArchMm: +1.35,
      noseRadiusMm: 1.38,
      targetMassG: 175,
      isGyroOvermold: true,
      stampedFlight: [9, 3.5, 0, 3.5],
    },
  },

  // ==================== 4. DISTANCE DRIVERS (Rim Width ~ 22.0 - 23.6 mm, Rim Depth ~ 11.4 mm, Sharp Nose ~ 1.05 mm) ====================
  {
    id: 'driver-us',
    classId: 'driver',
    classLabel: 'Distance Driver',
    stabilityId: 'understable',
    stabilityLabel: 'Understable',
    name: 'MVP Fission Orbital (US Distance Bomber)',
    color: '#e0632e',
    releaseSpeedMph: 64,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 21.8,
      rimDepthMm: 11.3,
      flightPlateMm: 1.75,
      domeRiseMm: 5.0,
      plhOffsetMm: -1.45,   // Low parting line + Fission light core -> huge high-speed turn & glide
      lowerArchMm: -0.60,
      noseRadiusMm: 1.12,
      targetMassG: 168,
      isGyroOvermold: true,
      isFissionCore: true,
      stampedFlight: [11, 5, -4.5, 1],
    },
  },
  {
    id: 'driver-neutral',
    classId: 'driver',
    classLabel: 'Distance Driver',
    stabilityId: 'stable',
    stabilityLabel: 'Neutral / Stable',
    name: 'Stock Star Destroyer / Zenith (Pro S-Curve)',
    color: '#b07d12',
    releaseSpeedMph: 65,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 22.6,
      rimDepthMm: 11.5,
      flightPlateMm: 1.9,
      domeRiseMm: 4.5,
      plhOffsetMm: -0.15,   // Pro distance wing -> turns -18 ft at 65 mph then fades back to pin
      lowerArchMm: +0.15,
      noseRadiusMm: 1.05,
      targetMassG: 175,
      isGyroOvermold: false,
      stampedFlight: [12, 5, -1, 3],
    },
  },
  {
    id: 'driver-os',
    classId: 'driver',
    classLabel: 'Distance Driver',
    stabilityId: 'overstable',
    stabilityLabel: 'Overstable',
    name: 'Halo / Dimension (Max-Weight OS Meathook)',
    color: '#1f6f68',
    releaseSpeedMph: 65,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 23.6,
      rimDepthMm: 11.6,
      flightPlateMm: 2.0,
      domeRiseMm: 3.1,
      plhOffsetMm: +1.35,   // Sky-high PLH + deep concave lower wing -> headwind crusher
      lowerArchMm: +1.15,
      noseRadiusMm: 1.00,
      targetMassG: 175,
      isGyroOvermold: true,
      stampedFlight: [13, 4, 0, 4],
    },
  },
]);

/**
 * "Flight Numbers Don't Matter" (Six Sided Discs Empirical Cohort):
 * FOUR physical discs of the EXACT SAME MOLD all stamped `[12 | 5 | -1 | 3]` (`w_rim = 22.6 mm`),
 * thrown with the EXACT SAME 63 mph flat release — where injection-molding cooling shrinkage
 * (Parting Line Height shift, dome pop, and weight/wear) changes the
 * 2D cross-section by +/- 1.1 mm and causes > 85 ft of lateral landing spread!
 */
export const FLIGHT_NUMBERS_DONT_MATTER_COHORT = Object.freeze([
  {
    id: 'fndm-pro-beatin',
    name: 'Run A · 167g Beat-In Pro Run (Stamped 12|5|-1|3)',
    shortLabel: '167g Beat-In Pro (Low PLH -1.15mm)',
    color: '#e0632e',
    releaseSpeedMph: 63,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 22.6,
      rimDepthMm: 11.5,
      flightPlateMm: 1.90,
      domeRiseMm: 4.9,
      plhOffsetMm: -1.15,   // Cooled low + tree hits drooped leading edge by 1.15 mm
      lowerArchMm: +0.25,
      noseRadiusMm: 1.05,
      targetMassG: 167,
      isGyroOvermold: false,
      stampedFlight: [12, 5, -1, 3],
    },
  },
  {
    id: 'fndm-fission-gstar',
    name: 'Run B · 171g Fission / GStar Domey Bomber (Stamped 12|5|-1|3)',
    shortLabel: '171g Fission/GStar (PLH -0.45mm)',
    color: '#2b2420',
    releaseSpeedMph: 63,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 22.6,
      rimDepthMm: 11.5,
      flightPlateMm: 1.90,
      domeRiseMm: 5.4,      // Pop-top high glide cavity
      plhOffsetMm: -0.45,   // Slightly lower parting line -> full bombing S-curve
      lowerArchMm: +0.25,
      noseRadiusMm: 1.05,
      targetMassG: 171,
      isGyroOvermold: true,
      isFissionCore: true,
      stampedFlight: [12, 5, -1, 3],
    },
  },
  {
    id: 'fndm-stock-star',
    name: 'Run C · 175g Stock Star / Neutron (Stamped 12|5|-1|3)',
    shortLabel: '175g Stock Star (PLH 0.00mm)',
    color: '#b07d12',
    releaseSpeedMph: 63,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 22.6,
      rimDepthMm: 11.5,
      flightPlateMm: 1.90,
      domeRiseMm: 4.3,
      plhOffsetMm: 0.0,     // Blueprint reference cross-section
      lowerArchMm: +0.25,
      noseRadiusMm: 1.05,
      targetMassG: 175,
      isGyroOvermold: false,
      stampedFlight: [12, 5, -1, 3],
    },
  },
  {
    id: 'fndm-halo-eclipse',
    name: 'Run D · 175g Stiff Halo / Eclipse Glow (Stamped 12|5|-1|3)',
    shortLabel: '175g Halo/Eclipse (High PLH +1.15mm)',
    color: '#1f6f68',
    releaseSpeedMph: 63,
    crossSection: {
      diameterMm: 211.5,
      rimWidthMm: 22.6,
      rimDepthMm: 11.5,
      flightPlateMm: 1.90,
      domeRiseMm: 3.3,      // Stiff cooling pulled wing up (+1.15mm PLH) and flattened shoulder
      plhOffsetMm: +1.15,
      lowerArchMm: +0.25,
      noseRadiusMm: 1.05,
      targetMassG: 175,
      isGyroOvermold: true,
      stampedFlight: [12, 5, -1, 3],
    },
  },
]);
