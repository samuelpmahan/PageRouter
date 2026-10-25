// Argon's rim fit (KAN coarse rim band + fine fork-join), ported from run-thro-discs.mjs (D:/HomeServer/garth/hub/rimfit) to run
// in the browser: the only change is that pixels come from the caller (photo.working.data, RGBA) instead of fs. Everything between
// the median helper and runThroDiscItem is Argon's code as written.
// photo = { name, width, height, working: { width, height, data: Uint8ClampedArray RGBA } }; ellipses come back in photo.width space.
const DEG = Math.PI / 180;
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const medianLab = (list) => [0, 1, 2].map((k) => median(list.map((c) => c[k])));
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Chroma-weighted Lab distance: weights Δa, Δb by 1.65x so pastel/colored discs in shadow (where ΔL≈0) retain strong rim contrast while neutral shadow folds (Δa≈0, Δb≈0) are not amplified
const labChromaDist = (a, b) => Math.hypot(a[0] - b[0], 1.65 * (a[1] - b[1]), 1.65 * (a[2] - b[2]));
// Cast-shadow-aware background distance: a cast shadow on the background has L < L_bg but matches (a_bg, b_bg).
// Down-weighting negative ΔL (darker than localBg) prevents cast shadows outside the rim from being mistaken for the disc.
const shadowAwareBgDist = (px, bg) => {
  const dL = px[0] < bg[0] ? (px[0] - bg[0]) * 0.42 : px[0] - bg[0];
  return Math.hypot(dL, 1.65 * (px[1] - bg[1]), 1.65 * (px[2] - bg[2]));
};

function rgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const X = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const Y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const Z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;
  const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X / 0.95047) - f(Y)), 200 * (f(Y) - f(Z / 1.08883))];
}

function boxBlur(arr, w, h) {
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w) { s += arr[y * w + xx]; c++; }
      }
      tmp[y * w + x] = s / c;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; c++; }
      }
      out[y * w + x] = s / c;
    }
  }
  return out;
}

const workCache = new Map();
function getWorkPixels(photo) {
  if (!workCache.has(photo.name)) workCache.set(photo.name, { width: photo.working.width, height: photo.working.height, data: photo.working.data });
  return workCache.get(photo.name);
}

const labCache = new Map();
function getLab(photo, maxDim = 720) {
  const key = `${photo.name}@${maxDim}`;
  if (labCache.has(key)) return labCache.get(key);
  const work = getWorkPixels(photo);
  const sWork = Math.min(1, maxDim / Math.max(work.width, work.height));
  const w = Math.max(16, Math.round(work.width * sWork));
  const h = Math.max(16, Math.round(work.height * sWork));
  const s = w / photo.width;
  const L = new Float64Array(w * h);
  const A = new Float64Array(w * h);
  const B = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / sWork), y1 = Math.max(y0 + 1, Math.min(work.height, Math.floor((y + 1) / sWork)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / sWork), x1 = Math.max(x0 + 1, Math.min(work.width, Math.floor((x + 1) / sWork)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * work.width + xx) * 4;
          r += work.data[i]; g += work.data[i + 1]; b += work.data[i + 2]; n++;
        }
      }
      const [l, a, bb] = rgbToLab(r / n, g / n, b / n);
      const idx = y * w + x;
      L[idx] = l; A[idx] = a; B[idx] = bb;
    }
  }
  let yTopValid = 0;
  for (let y = 0; y < Math.floor(h * 0.25); y++) {
    let meanL = 0;
    for (let x = 0; x < w; x++) meanL += L[y * w + x];
    meanL /= w;
    if (meanL < 6.0) yTopValid = y + 1;
    else break;
  }
  let yBotValid = h - 1;
  for (let y = h - 1; y > Math.floor(h * 0.65); y--) {
    let meanL = 0;
    for (let x = 0; x < w; x++) meanL += L[y * w + x];
    meanL /= w;
    if (meanL < 8.0) yBotValid = y - 1;
    else break;
  }
  const letterboxDetected = yTopValid > Math.floor(h * 0.04) || (h - 1 - yBotValid) > Math.floor(h * 0.08);
  const out = {
    w, h, s,
    yTopValid: letterboxDetected ? yTopValid : 0,
    yBotValid: letterboxDetected ? yBotValid : h - 1,
    letterboxDetected,
    topBarPct: +((yTopValid / h) * 100).toFixed(1),
    botBarPct: +(((h - 1 - yBotValid) / h) * 100).toFixed(1),
    ch: [boxBlur(L, w, h), boxBlur(A, w, h), boxBlur(B, w, h)],
  };
  labCache.set(key, out);
  return out;
}

function labAt(L, x, y) {
  const xc = Math.max(0, Math.min(L.w - 1.001, x));
  const yc = Math.max(0, Math.min(L.h - 1.001, y));
  const x0 = Math.floor(xc), y0 = Math.floor(yc), fx = xc - x0, fy = yc - y0;
  const i = y0 * L.w + x0;
  return [
    (L.ch[0][i] * (1 - fx) + L.ch[0][i + 1] * fx) * (1 - fy) + (L.ch[0][i + L.w] * (1 - fx) + L.ch[0][i + L.w + 1] * fx) * fy,
    (L.ch[1][i] * (1 - fx) + L.ch[1][i + 1] * fx) * (1 - fy) + (L.ch[1][i + L.w] * (1 - fx) + L.ch[1][i + L.w + 1] * fx) * fy,
    (L.ch[2][i] * (1 - fx) + L.ch[2][i + 1] * fx) * (1 - fy) + (L.ch[2][i + L.w] * (1 - fx) + L.ch[2][i + L.w + 1] * fx) * fy,
  ];
}

function radiusAlong(e, theta) {
  const a = e.angle * DEG;
  const u = Math.cos(theta - a), v = Math.sin(theta - a);
  return 1 / Math.sqrt((u / e.rx) ** 2 + (v / e.ry) ** 2);
}

function computeFoci(ellipse) {
  const major = Math.max(ellipse.rx, ellipse.ry);
  const minor = Math.min(ellipse.rx, ellipse.ry);
  const axisRad = (ellipse.rx >= ellipse.ry ? ellipse.angle : ellipse.angle + 90) * DEG;
  const f = Math.sqrt(Math.max(0, major * major - minor * minor));
  const dx = f * Math.cos(axisRad), dy = f * Math.sin(axisRad);
  return {
    f: +f.toFixed(2),
    fOverR1: +(f / major).toFixed(4),
    F1: { x: +(ellipse.cx - dx).toFixed(2), y: +(ellipse.cy - dy).toFixed(2) },
    F2: { x: +(ellipse.cx + dx).toFixed(2), y: +(ellipse.cy + dy).toFixed(2) },
  };
}

function solve(M, b) {
  const n = b.length, A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-11) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) {
      if (r !== c) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
      }
    }
  }
  return A.map((r, i) => r[n] / r[i]);
}

function fitEllipseRobust(pts, seed, rounds = 4, minAspect = 0.86) {
  if (pts.length < 16) return seed;
  let p = [seed.cx, seed.cy, seed.rx, seed.ry, seed.angle * DEG];
  let active = pts;
  const maxShift = seed.rx * 0.15;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const resid = (q, list) =>
    list.map(([x, y]) => {
      const dx = x - q[0], dy = y - q[1], c = Math.cos(q[4]), s = Math.sin(q[4]);
      const u = dx * c + dy * s, v = -dx * s + dy * c;
      return (Math.sqrt((u / q[2]) ** 2 + (v / q[3]) ** 2) - 1) * Math.sqrt(q[2] * q[3]);
    });

  for (let r = 0; r < rounds; r++) {
    for (let it = 0; it < 18; it++) {
      const f0 = resid(p, active);
      const e0 = f0.reduce((s, v) => s + v * v, 0);
      const J = [];
      for (let k = 0; k < 5; k++) {
        const h = k === 4 ? 1e-4 : 0.2;
        const q = [...p]; q[k] += h;
        const fk = resid(q, active);
        J.push(fk.map((v, i) => (v - f0[i]) / h));
      }
      const A = Array.from({ length: 5 }, (_, i) =>
        Array.from({ length: 5 }, (__, j) => J[i].reduce((s, v, n) => s + v * J[j][n], 0) + (i === j ? 1e-2 * active.length : 0))
      );
      const b = Array.from({ length: 5 }, (_, i) => -J[i].reduce((s, v, n) => s + v * f0[n], 0));
      const step = solve(A, b);
      if (!step) break;
      const q = [
        clamp(p[0] + step[0], seed.cx - maxShift, seed.cx + maxShift),
        clamp(p[1] + step[1], seed.cy - maxShift, seed.cy + maxShift),
        clamp(p[2] + step[2], seed.rx * 0.85, seed.rx * 1.16),
        clamp(p[3] + step[3], seed.ry * 0.85, seed.rx * 1.16),
        p[4] + clamp(step[4], -0.25, 0.25),
      ];
      const rMaj = Math.max(q[2], q[3]), rMin = Math.min(q[2], q[3]);
      if (rMin / rMaj < minAspect) {
        if (q[2] >= q[3]) q[3] = q[2] * minAspect;
        else q[2] = q[3] * minAspect;
      }
      const e1 = resid(q, active).reduce((s, v) => s + v * v, 0);
      if (e1 <= e0) p = q;
      else break;
    }
    if (r < rounds - 1) {
      const f = resid(p, active).map(Math.abs);
      const cut = [...f].sort((a, b) => a - b)[Math.floor(f.length * 0.80)];
      const next = active.filter((_, i) => f[i] <= Math.max(cut, 1.2));
      if (next.length >= 18) active = next;
    }
  }
  let [cx, cy, rx, ry, ang] = p;
  let deg = ((ang / DEG) % 180 + 180) % 180;
  if (rx < ry) { [rx, ry] = [ry, rx]; deg = (deg + 90) % 180; }
  return { cx, cy, rx, ry, angle: deg };
}

// ---------------------------------------------------------------------------
// DATA LAYER: Serial Feature Detector Suite (F1..F6) measured on every photo
// ---------------------------------------------------------------------------
function extractSerialFeatures(L, ell, innerEll) {
  const octBgL = [], octBgLab = [];
  const octFgLab = [];
  const octDeltaL = [], octDeltaChroma = [], octDeltaLab = [];

  for (let o = 0; o < 8; o++) {
    const bgSamples = [], fgSamples = [];
    for (let j = 0; j < 6; j++) {
      const th = ((o * 6 + j) * 2 * Math.PI) / 48;
      const ux = Math.cos(th), uy = Math.sin(th), r = radiusAlong(ell, th);
      const xb = ell.cx + 1.12 * r * ux, yb = ell.cy + 1.12 * r * uy;
      const xf = ell.cx + 0.92 * r * ux, yf = ell.cy + 0.92 * r * uy;
      if (xb >= 2 && yb >= L.yTopValid + 2 && xb < L.w - 2 && yb < L.yBotValid - 2) bgSamples.push(labAt(L, xb, yb));
      if (xf >= 2 && yf >= L.yTopValid + 2 && xf < L.w - 2 && yf < L.yBotValid - 2) fgSamples.push(labAt(L, xf, yf));
    }
    const bgMed = bgSamples.length ? medianLab(bgSamples) : [50, 0, 0];
    const fgMed = fgSamples.length ? medianLab(fgSamples) : [50, 0, 0];
    octBgL.push(bgMed[0]);
    octBgLab.push(bgMed);
    octFgLab.push(fgMed);
    octDeltaL.push(Math.abs(fgMed[0] - bgMed[0]));
    octDeltaChroma.push(Math.hypot(fgMed[1] - bgMed[1], fgMed[2] - bgMed[2]));
    octDeltaLab.push(labDist(fgMed, bgMed));
  }

  // F2: Background Illumination Dipole (difference between brightest and darkest background octant)
  const bgIllumDipole = +(Math.max(...octBgL) - Math.min(...octBgL)).toFixed(1);

  // F3: Border vs Local Background Drop-off (e.g. countertop edge on IMG_6576 or corner intruder discs)
  const borderSamples = [];
  for (let x = 2; x < L.w - 2; x += 6) {
    borderSamples.push(labAt(L, x, L.yTopValid + 2), labAt(L, x, L.yBotValid - 2));
  }
  const localBgMed = medianLab(octBgLab);
  const borderOutliers = borderSamples.filter((c) => labDist(c, localBgMed) > 22.0).length / Math.max(1, borderSamples.length);

  // F4: Chroma-Dominant Shadow Octants (octants where |ΔL| < 4.5 but ΔChroma >= 6.0, like IMG_6161 bottom-left)
  const chromaDominantOctants = [];
  for (let o = 0; o < 8; o++) {
    if (octDeltaL[o] < 5.0 && octDeltaChroma[o] >= 5.5) chromaDominantOctants.push(o);
  }

  // F5: Concentric Dual-Ring Ratio & Inner/Outer Contrast Ratio
  let dualRingRatio = null;
  let innerVsOuterContrast = null;
  if (innerEll) {
    const rOut = 0.5 * (ell.rx + ell.ry);
    const rIn = 0.5 * (innerEll.rx + innerEll.ry);
    dualRingRatio = +(rIn / rOut).toFixed(3);
    const innerSteps = [];
    for (let k = 0; k < 48; k++) {
      const th = (2 * Math.PI * k) / 48, ux = Math.cos(th), uy = Math.sin(th);
      const rI = radiusAlong(innerEll, th);
      const c1 = labAt(L, innerEll.cx + (rI - 3) * ux, innerEll.cy + (rI - 3) * uy);
      const c2 = labAt(L, innerEll.cx + (rI + 3) * ux, innerEll.cy + (rI + 3) * uy);
      innerSteps.push(labDist(c1, c2));
    }
    innerVsOuterContrast = +(median(innerSteps) / Math.max(1, median(octDeltaLab))).toFixed(2);
  }

  // F6: Foreground Interior Ringiness / Dye Complexity (radial gradient energy inside 0.35..0.82 R)
  const fgGrads = [];
  for (let k = 0; k < 36; k++) {
    const th = (2 * Math.PI * k) / 36, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(ell, th);
    for (let f = 0.40; f <= 0.78; f += 0.04) {
      const c1 = labAt(L, ell.cx + (f - 0.02) * r0 * ux, ell.cy + (f - 0.02) * r0 * uy);
      const c2 = labAt(L, ell.cx + (f + 0.02) * r0 * ux, ell.cy + (f + 0.02) * r0 * uy);
      fgGrads.push(labDist(c1, c2));
    }
  }
  fgGrads.sort((a, b) => a - b);
  const fgInteriorGradientP90 = +(fgGrads[Math.floor(fgGrads.length * 0.9)] ?? 0).toFixed(1);

  return {
    F1_letterbox: L.letterboxDetected ? `${L.topBarPct}%/${L.botBarPct}%` : 'none',
    F2_bgIllumDipoleL: bgIllumDipole,
    F3_borderAnomalyFrac: +borderOutliers.toFixed(2),
    F4_chromaShadowOctants: chromaDominantOctants,
    F5_dualRingRatio: dualRingRatio,
    F5_innerVsOuterContrast: innerVsOuterContrast,
    F6_fgInteriorGradP90: fgInteriorGradientP90,
    minOctantDeltaL: +Math.min(...octDeltaL).toFixed(1),
    minOctantDeltaChroma: +Math.min(...octDeltaChroma).toFixed(1),
  };
}

// ---------------------------------------------------------------------------
// STRUCTURE LAYER: Chained Witnessed Calculations
//   Stage 1: CoarseRimBand (with Chroma-aware step + In-Frame Completeness Guard)
//   Stage 2: Concentric Dual-Ring Separator (prevents split-ring fits on Defy/Servo/Cloudbreaker)
//   Stage 3: Local-Background ForkJoin (3 branches + 8-octant arc join)
// ---------------------------------------------------------------------------
function runCoarseRimBand(photo) {
  const L = getLab(photo, 270);
  const w = L.w, h = L.h, s = Math.min(w, h);
  const yTop = L.yTopValid + 2, yBot = L.yBotValid - 2;
  const ch0 = L.ch[0], ch1 = L.ch[1], ch2 = L.ch[2];

  const borderSamples = [];
  for (let x = 2; x < w - 2; x += 3) {
    borderSamples.push(labAt(L, x, yTop), labAt(L, x, yBot));
  }
  for (let y = yTop; y <= yBot; y += 3) {
    borderSamples.push(labAt(L, 2, y), labAt(L, w - 3, y));
  }
  const bgMed = medianLab(borderSamples);

  const N_RAYS = 48;
  const cosT = new Float64Array(N_RAYS);
  const sinT = new Float64Array(N_RAYS);
  for (let k = 0; k < N_RAYS; k++) {
    cosT[k] = Math.cos((2 * Math.PI * k) / N_RAYS);
    sinT[k] = Math.sin((2 * Math.PI * k) / N_RAYS);
  }
  const octantHits = new Uint8Array(8);
  const octantTotal = new Uint8Array(8);

  function scoreCircle(cx, cy, r) {
    octantHits.fill(0);
    octantTotal.fill(0);
    let inFrameCount = 0;
    let sumIn0 = 0, sumIn1 = 0, sumIn2 = 0;
    let sumOut0 = 0, sumOut1 = 0, sumOut2 = 0;
    let sumOutFar0 = 0, sumOutFar1 = 0, sumOutFar2 = 0;
    let sumFar0 = 0, sumFar1 = 0, sumFar2 = 0, farCount = 0;
    let sumStep = 0;
    let sumSqIn = 0;

    for (let k = 0; k < N_RAYS; k++) {
      const ux = cosT[k], uy = sinT[k];
      const xOut = Math.round(cx + ux * (r * 1.045)), yOut = Math.round(cy + uy * (r * 1.045));
      if (xOut < 1 || yOut < yTop || xOut >= w - 1 || yOut > yBot) continue;
      const xIn = Math.round(cx + ux * (r * 0.955)), yIn = Math.round(cy + uy * (r * 0.955));
      const xPlate = Math.round(cx + ux * (r * 0.82)), yPlate = Math.round(cy + uy * (r * 0.82));
      if (xIn < 1 || yIn < yTop || xIn >= w - 1 || yIn > yBot) continue;

      const iOut = yOut * w + xOut;
      const iIn = yIn * w + xIn;
      const iPlate = Math.max(0, Math.min(w * h - 1, yPlate * w + xPlate));

      const o0 = ch0[iOut], o1 = ch1[iOut], o2 = ch2[iOut];
      const n0 = ch0[iIn], n1 = ch1[iIn], n2 = ch2[iIn];
      const p0 = ch0[iPlate], p1 = ch1[iPlate], p2 = ch2[iPlate];

      // Chroma-boosted Lab step across the tight [0.955r, 1.045r] rim straddle
      const d1 = Math.hypot(n0 - o0, 1.65 * (n1 - o1), 1.65 * (n2 - o2));
      const d2 = Math.hypot(p0 - o0, 1.65 * (p1 - o1), 1.65 * (p2 - o2));
      let dStep = 0.75 * d1 + 0.25 * Math.max(d1, d2);

      const oct8 = Math.floor((k * 8) / N_RAYS);
      inFrameCount++;
      octantTotal[oct8]++;
      if (dStep >= 5.5) octantHits[oct8]++;

      sumStep += dStep;
      const m0 = 0.5 * (n0 + p0), m1 = 0.5 * (n1 + p1), m2 = 0.5 * (n2 + p2);
      sumIn0 += m0; sumIn1 += m1; sumIn2 += m2;
      sumSqIn += m0 * m0 + m1 * m1 + m2 * m2;
      sumOut0 += o0; sumOut1 += o1; sumOut2 += o2;

      const xFar = Math.round(cx + ux * (r * 1.28)), yFar = Math.round(cy + uy * (r * 1.28));
      if (xFar >= 1 && xFar < w - 1 && yFar >= yTop && yFar <= yBot) {
        const iFar = yFar * w + xFar;
        sumOutFar0 += o0; sumOutFar1 += o1; sumOutFar2 += o2;
        sumFar0 += ch0[iFar]; sumFar1 += ch1[iFar]; sumFar2 += ch2[iFar];
        farCount++;
      }
    }

    const inFrameFrac = inFrameCount / N_RAYS;
    if (inFrameFrac < 0.51) return -1;

    let supportedOctants = 0;
    let validOctants = 0;
    for (let o = 0; o < 8; o++) {
      if (octantTotal[o] >= 2) {
        validOctants++;
        if (octantHits[o] >= Math.ceil(octantTotal[o] * 0.5)) supportedOctants++;
      }
    }
    const octantFrac = validOctants > 0 ? supportedOctants / Math.max(validOctants, 7) : 0;
    if (octantFrac < 0.62) return -1;

    const invN = 1 / inFrameCount;
    const meanIn = [sumIn0 * invN, sumIn1 * invN, sumIn2 * invN];
    const meanOut = [sumOut0 * invN, sumOut1 * invN, sumOut2 * invN];
    const globalSep = labChromaDist(meanIn, meanOut);
    const bgSep = labChromaDist(meanIn, bgMed);
    const inVar = Math.max(0, sumSqIn * invN - (meanIn[0] ** 2 + meanIn[1] ** 2 + meanIn[2] ** 2));
    const inStd = Math.sqrt(inVar);

    // Compare matched-ray meanOutFar vs meanFar (only on rays where 1.28r is also in-frame!)
    // so off-center discs with lighting dipoles are never penalized for rays that leave the frame at 1.28r!
    let outerBgPenalty = 1.0;
    if (farCount >= 24) {
      const meanOutMatched = [sumOutFar0 / farCount, sumOutFar1 / farCount, sumOutFar2 / farCount];
      const meanFar = [sumFar0 / farCount, sumFar1 / farCount, sumFar2 / farCount];
      const outToBg = labChromaDist(meanOutMatched, bgMed);
      const farToBg = labChromaDist(meanFar, bgMed);
      const outToFar = labChromaDist(meanOutMatched, meanFar);
      if (outToBg > farToBg + 12 && outToFar > 14) {
        outerBgPenalty = 0.52;
      }
    }

    const avgStep = sumStep * invN;
    const coherenceFactor = 1 / (1 + Math.max(0, inStd - 8) / 16);
    const fgFactor = Math.min(1.35, Math.max(0.5, bgSep / 12));

    return avgStep * (0.65 + 0.35 * Math.min(1.4, globalSep / 12)) * (octantFrac ** 1.5) * coherenceFactor * fgFactor * (inFrameFrac ** 0.95) * outerBgPenalty;
  }

  const activeH = yBot - yTop;
  let best = { cx: w * 0.5, cy: yTop + activeH * 0.5, r: s * 0.43, score: -1 };
  const rMin = s * 0.168, rMax = s * 0.50, rStep = Math.max(1.5, s * 0.022);
  for (let r = rMin; r <= rMax + 0.01; r += rStep) {
    const xyStep = Math.max(2.0, r * 0.075);
    const xLo = Math.max(r * 0.55, w * 0.28), xHi = Math.min(w - r * 0.55, w * 0.72);
    const yLo = Math.max(yTop + r * 0.55, yTop + activeH * 0.24);
    const yHi = Math.min(yBot - r * 0.55, yTop + activeH * 0.66);
    for (let cy = yLo; cy <= yHi + 0.01; cy += xyStep) {
      for (let cx = xLo; cx <= xHi + 0.01; cx += xyStep) {
        const sc = scoreCircle(cx, cy, r);
        if (sc > best.score) best = { cx, cy, r, score: sc };
      }
    }
  }

  let fine = best;
  for (const frac of [0.06, 0.025, 0.01]) {
    const stepXY = Math.max(0.5, fine.r * frac);
    const stepR = Math.max(0.5, fine.r * frac * 0.8);
    let next = fine;
    for (let dr = -2 * stepR; dr <= 2 * stepR + 1e-4; dr += stepR) {
      const rr = fine.r + dr;
      if (rr < s * 0.16 || rr > s * 0.52) continue;
      for (let dy = -2 * stepXY; dy <= 2 * stepXY + 1e-4; dy += stepXY) {
        for (let dx = -2 * stepXY; dx <= 2 * stepXY + 1e-4; dx += stepXY) {
          const sc = scoreCircle(fine.cx + dx, fine.cy + dy, rr);
          if (sc > next.score) next = { cx: fine.cx + dx, cy: fine.cy + dy, r: rr, score: sc };
        }
      }
    }
    fine = next;
  }

  // Pass 1b: 72-ray radial transition detection across [0.83 r, 1.15 r] on 540px Lab
  const L2 = getLab(photo, 540);
  const scale = L2.s / L.s;
  const seed2 = { cx: fine.cx * scale, cy: fine.cy * scale, rx: fine.r * scale, ry: fine.r * scale, angle: 0 };

  const discColors = [], extColors = [];
  for (let k = 0; k < 72; k++) {
    const th = (2 * Math.PI * k) / 72, ux = Math.cos(th), uy = Math.sin(th);
    for (const f of [0.68, 0.75, 0.82]) {
      const x = seed2.cx + f * seed2.rx * ux, y = seed2.cy + f * seed2.rx * uy;
      if (x >= 1 && y >= L2.yTopValid + 1 && x < L2.w - 1 && y < L2.yBotValid - 1) discColors.push(labAt(L2, x, y));
    }
    for (const f of [1.15, 1.22, 1.28]) {
      const x = seed2.cx + f * seed2.rx * ux, y = seed2.cy + f * seed2.rx * uy;
      if (x >= 1 && y >= L2.yTopValid + 1 && x < L2.w - 1 && y < L2.yBotValid - 1) extColors.push(labAt(L2, x, y));
    }
  }
  const discProto = medianLab(discColors);
  const extProto = extColors.length >= 12 ? medianLab(extColors) : bgMed;
  const protoSep = Math.max(4, labChromaDist(discProto, extProto));

  const rimPts = [];
  const outerOvermoldPts = [];
  const outerOvermoldOctants = new Set();
  const innerWallPts = [];
  const RAYS = 72;
  for (let k = 0; k < RAYS; k++) {
    const th = (2 * Math.PI * k) / RAYS, ux = Math.cos(th), uy = Math.sin(th);
    const localBgList = [];
    for (const f of [1.10, 1.15, 1.20]) {
      const xb = Math.max(2, Math.min(L2.w - 2.01, seed2.cx + f * seed2.rx * ux));
      const yb = Math.max(L2.yTopValid + 2, Math.min(L2.yBotValid - 2.01, seed2.cy + f * seed2.rx * uy));
      localBgList.push(labAt(L2, xb, yb));
    }
    const localBg = medianLab(localBgList);

    const prof = [];
    let maxRReached = 0;
    for (let r = seed2.rx * 0.83; r <= seed2.rx * 1.15; r += 0.5) {
      const x = seed2.cx + r * ux, y = seed2.cy + r * uy;
      if (x < 1.5 || y < L2.yTopValid + 1.5 || x >= L2.w - 1.5 || y >= L2.yBotValid - 1.5) {
        break;
      }
      maxRReached = r;
      prof.push([r, labAt(L2, x, y)]);
    }
    if (maxRReached < seed2.rx * 0.99 || prof.length < 12) continue;

    const grads = prof.map((_, i) => (i >= 2 && i < prof.length - 2 ? labChromaDist(prof[i - 2][1], prof[i + 2][1]) : 0));
    const maxGrad = Math.max(...grads);
    if (maxGrad < Math.max(4.0, protoSep * 0.16)) continue;

    let switchIdx = -1;
    let bgRun = 0;
    for (let i = 0; i < prof.length; i++) {
      if (labChromaDist(prof[i][1], discProto) < shadowAwareBgDist(prof[i][1], localBg)) {
        switchIdx = i;
        bgRun = 0;
      } else {
        bgRun++;
        if (switchIdx >= 0 && bgRun >= 5) break;
      }
    }
    let bestIdx = switchIdx;
    let bestScore = -1;
    for (let i = 2; i < prof.length - 2; i++) {
      if (grads[i] >= grads[i - 1] && grads[i] >= grads[i + 1] && grads[i] >= 0.38 * maxGrad) {
        const prox = switchIdx >= 0 ? Math.exp(-((i - switchIdx) ** 2) / (2 * 7 ** 2)) : 0.7;
        const sc = grads[i] * (0.40 + 0.60 * prox);
        if (sc > bestScore) {
          bestScore = sc;
          bestIdx = i;
        }
      }
    }
    if (bestIdx >= 2 && bestIdx < prof.length - 2) {
      const rInner = prof[bestIdx][0];
      rimPts.push({ k, r: rInner, pt: [seed2.cx + rInner * ux, seed2.cy + rInner * uy] });

      let overmoldIdx = -1;
      for (let i = bestIdx + 3; i < prof.length - 2; i++) {
        const ratio = prof[i][0] / rInner;
        if (ratio >= 1.035 && ratio <= 1.115 && grads[i] >= grads[i - 1] && grads[i] >= grads[i + 1] && grads[i] >= 10.5) {
          if (labDist(prof[i - 2][1], localBg) > labDist(prof[i + 2][1], localBg) + 5.0) {
            overmoldIdx = i;
          }
        }
      }
      if (overmoldIdx >= 0) {
        const rOuter = prof[overmoldIdx][0];
        outerOvermoldOctants.add(Math.floor((k * 8) / RAYS));
        outerOvermoldPts.push({ k, rOuter, rInner, ptOuter: [seed2.cx + rOuter * ux, seed2.cy + rOuter * uy], ptInner: [seed2.cx + rInner * ux, seed2.cy + rInner * uy] });
      }
    }

    const innerProf = [];
    for (let r = seed2.rx * 0.68; r <= seed2.rx * 0.88; r += 0.6) {
      const x = seed2.cx + r * ux, y = seed2.cy + r * uy;
      if (x >= 1.5 && y >= L2.yTopValid + 1.5 && x < L2.w - 1.5 && y < L2.yBotValid - 1.5) {
        innerProf.push([r, labAt(L2, x, y)]);
      }
    }
    if (innerProf.length >= 8) {
      const ig = innerProf.map((_, i) => (i >= 2 && i < innerProf.length - 2 ? labChromaDist(innerProf[i - 2][1], innerProf[i + 2][1]) : 0));
      let iBest = -1, iMax = 8.5;
      for (let i = 2; i < innerProf.length - 2; i++) {
        if (ig[i] > iMax && ig[i] >= ig[i - 1] && ig[i] >= ig[i + 1]) {
          iMax = ig[i]; iBest = i;
        }
      }
      if (iBest >= 0) {
        const rW = innerProf[iBest][0];
        innerWallPts.push([seed2.cx + rW * ux, seed2.cy + rW * uy]);
      }
    }
  }

  // Only promote an outer overmold ring when it spans >= 5/8 octants and >= 24 rays (distinguishes true 360° Gyro overmold from one-sided cast shadow!)
  const hasConcentricOvermold = outerOvermoldOctants.size >= 5 && outerOvermoldPts.length >= Math.max(20, rimPts.length * 0.35);
  let chosenPts = rimPts.map((x) => x.pt);
  if (hasConcentricOvermold) {
    const medRatio = median(outerOvermoldPts.map((o) => o.rOuter / o.rInner));
    const outerByK = new Map(outerOvermoldPts.map((o) => [o.k, o.ptOuter]));
    const medRInner = median(outerOvermoldPts.map((o) => o.rInner));
    chosenPts = rimPts.map((item) => {
      if (outerByK.has(item.k)) return outerByK.get(item.k);
      if (Math.abs(item.r - medRInner) / medRInner < 0.045) {
        const th = (2 * Math.PI * item.k) / RAYS;
        const rPromoted = item.r * medRatio;
        return [seed2.cx + rPromoted * Math.cos(th), seed2.cy + rPromoted * Math.sin(th)];
      }
      return item.pt;
    });
    if (innerWallPts.length < 28) {
      for (const o of outerOvermoldPts) innerWallPts.push(o.ptInner);
    }
  }

  const fitted2 = chosenPts.length >= 18 ? fitEllipseRobust(chosenPts, seed2, 4, 0.86) : seed2;
  const invS = 1 / L2.s;
  const toSource = (e) => ({
    cx: +(e.cx * invS).toFixed(2),
    cy: +(e.cy * invS).toFixed(2),
    rx: +(e.rx * invS).toFixed(2),
    ry: +(e.ry * invS).toFixed(2),
    angle: +e.angle.toFixed(2),
  });
  const ell = toSource(fitted2);

  let innerEll = null;
  let innerEllWork = null;
  if (innerWallPts.length >= 20) {
    const rMed = median(innerWallPts.map(([x, y]) => Math.hypot(x - fitted2.cx, y - fitted2.cy)));
    if (rMed < Math.min(fitted2.rx, fitted2.ry) * 0.94) {
      const innerSeed = { cx: fitted2.cx, cy: fitted2.cy, rx: rMed, ry: rMed * (fitted2.ry / fitted2.rx), angle: fitted2.angle };
      innerEllWork = fitEllipseRobust(innerWallPts, innerSeed, 3, 0.86);
      innerEll = toSource(innerEllWork);
    }
  }

  return {
    coarse: ell,
    foci: computeFoci(ell),
    innerRimRing: innerEll,
    innerFoci: innerEll ? computeFoci(innerEll) : null,
    hasConcentricOvermold,
    letterboxDetected: L.letterboxDetected,
  };
}

function getPrototypes(L, e) {
  const discC = [], extC = [];
  for (let k = 0; k < 72; k++) {
    const th = (2 * Math.PI * k) / 72, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(e, th);
    for (const f of [0.76, 0.84, 0.90]) {
      const x = e.cx + f * r0 * ux, y = e.cy + f * r0 * uy;
      if (x >= 2 && y >= L.yTopValid + 2 && x < L.w - 2 && y < L.yBotValid - 2) discC.push(labAt(L, x, y));
    }
    for (const f of [1.14, 1.20, 1.26]) {
      const x = e.cx + f * r0 * ux, y = e.cy + f * r0 * uy;
      if (x >= 2 && y >= L.yTopValid + 2 && x < L.w - 2 && y < L.yBotValid - 2) extC.push(labAt(L, x, y));
    }
  }
  if (extC.length < 16) {
    for (let x = 2; x < L.w - 2; x += 4) extC.push(labAt(L, x, L.yTopValid + 2), labAt(L, x, L.yBotValid - 3));
  }
  return { discProto: medianLab(discC), extProto: medianLab(extC) };
}

function scoreCandidateArcs(L, eSeed, candEll, extProto) {
  const N_OCT = 8, RAYS_PER_OCT = 16, N = N_OCT * RAYS_PER_OCT;
  const arcScores = new Array(N_OCT).fill(0);
  const arcRawSteps = new Array(N_OCT).fill(0);
  const arcBgGain = new Array(N_OCT).fill(0);
  const arcPoints = Array.from({ length: N_OCT }, () => []);

  for (let o = 0; o < N_OCT; o++) {
    const steps = [], rawSteps = [], bgGains = [];
    for (let j = 0; j < RAYS_PER_OCT; j++) {
      const k = o * RAYS_PER_OCT + j;
      const th = (2 * Math.PI * k) / N, ux = Math.cos(th), uy = Math.sin(th);
      const r = radiusAlong(candEll, th);
      const x = candEll.cx + r * ux, y = candEll.cy + r * uy;
      arcPoints[o].push([x, y]);
      const xIn = candEll.cx + (r - 2.5) * ux, yIn = candEll.cy + (r - 2.5) * uy;
      const xOut = candEll.cx + (r + 2.5) * ux, yOut = candEll.cy + (r + 2.5) * uy;
      const xFar = Math.max(2, Math.min(L.w - 2.01, candEll.cx + (r + 14.0) * ux));
      const yFar = Math.max(L.yTopValid + 2, Math.min(L.yBotValid - 2.01, candEll.cy + (r + 14.0) * uy));
      if (xOut < 2 || yOut < L.yTopValid + 2 || xOut >= L.w - 2 || yOut >= L.yBotValid - 2) continue;

      const cIn = labAt(L, xIn, yIn);
      const cOut = labAt(L, xOut, yOut);
      const cFar = labAt(L, xFar, yFar);
      const step = labChromaDist(cIn, cOut);
      const outToFar = shadowAwareBgDist(cOut, cFar);
      const bgDrop = shadowAwareBgDist(cIn, cFar) - outToFar;
      const exteriorStability = 1 / (1 + Math.max(0, outToFar - 4) / 8);
      rawSteps.push(step);
      bgGains.push(bgDrop);
      steps.push(step * exteriorStability * (bgDrop > 1.5 ? 1.15 : 0.65));
    }
    arcScores[o] = steps.length >= 4 ? +(median(steps)).toFixed(2) : 0.01;
    arcRawSteps[o] = rawSteps.length >= 4 ? +(median(rawSteps)).toFixed(2) : 0;
    arcBgGain[o] = bgGains.length >= 4 ? +(median(bgGains)).toFixed(2) : 0;
  }
  const validOcts = arcRawSteps.filter((v) => v > 0);
  const strongOcts = arcRawSteps.filter((v, i) => v >= 5.5 && arcBgGain[i] >= 1.5).length;
  const octantSupport = validOcts.length ? +(strongOcts / validOcts.length).toFixed(3) : 0;
  const totalScore = +(arcScores.reduce((s, v) => s + v, 0) / N_OCT * (0.5 + 0.5 * octantSupport)).toFixed(2);
  const meanR = 0.5 * (candEll.rx + candEll.ry);
  return { arcScores, arcRawSteps, arcBgGain, octantSupport, arcPoints, totalScore, meanR };
}

function branchBandSnap(L, eSeed, discProto, extProto, bandLoFrac = 0.92) {
  const sep = Math.max(4, labChromaDist(discProto, extProto));
  const pts = [];
  const RAYS = 180;
  for (let k = 0; k < RAYS; k++) {
    const th = (2 * Math.PI * k) / RAYS, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(eSeed, th);
    const rayBgList = [];
    for (const f of [1.10, 1.14, 1.18]) {
      const xb = Math.max(2, Math.min(L.w - 2.01, eSeed.cx + f * r0 * ux));
      const yb = Math.max(L.yTopValid + 2, Math.min(L.yBotValid - 2.01, eSeed.cy + f * r0 * uy));
      rayBgList.push(labAt(L, xb, yb));
    }
    const localBg = medianLab(rayBgList);
    const localRimIn = labAt(L, eSeed.cx + 0.955 * r0 * ux, eSeed.cy + 0.955 * r0 * uy);

    const prof = [];
    let maxRReached = 0;
    for (let r = r0 * bandLoFrac; r <= r0 * 1.075; r += 0.4) {
      const x = eSeed.cx + r * ux, y = eSeed.cy + r * uy;
      if (x < 1.5 || y < L.yTopValid + 1.5 || x >= L.w - 1.5 || y >= L.yBotValid - 1.5) break;
      maxRReached = r;
      prof.push([r, labAt(L, x, y)]);
    }
    if (maxRReached < r0 * 0.99 || prof.length < 8) continue;
    let last = -1;
    let bgRun = 0;
    for (let i = 0; i < prof.length; i++) {
      const dDisc = Math.min(labChromaDist(prof[i][1], discProto), labChromaDist(prof[i][1], localRimIn));
      if (dDisc < shadowAwareBgDist(prof[i][1], localBg)) {
        last = i;
        bgRun = 0;
      } else {
        bgRun++;
        if (last >= 0 && bgRun >= 5) break;
      }
    }
    if (last < 1 || last >= prof.length - 2) continue;
    const grad = labChromaDist(prof[Math.max(0, last - 2)][1], prof[Math.min(prof.length - 1, last + 2)][1]);
    if (grad < Math.max(3.5, 0.14 * sep)) continue;
    const r = prof[last][0] + 0.2;
    pts.push([eSeed.cx + r * ux, eSeed.cy + r * uy]);
  }
  return fitEllipseRobust(pts, eSeed, 4, 0.86);
}

function branchOvermoldOuter(L, eSeed, discProto, extProto, bandLoFrac = 0.92) {
  const pts = [];
  const RAYS = 180;
  for (let k = 0; k < RAYS; k++) {
    const th = (2 * Math.PI * k) / RAYS, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(eSeed, th);
    const rayBgList = [];
    for (const f of [1.10, 1.14, 1.18]) {
      const xb = Math.max(2, Math.min(L.w - 2.01, eSeed.cx + f * r0 * ux));
      const yb = Math.max(L.yTopValid + 2, Math.min(L.yBotValid - 2.01, eSeed.cy + f * r0 * uy));
      rayBgList.push(labAt(L, xb, yb));
    }
    const localBg = medianLab(rayBgList);

    const prof = [];
    let maxRReached = 0;
    for (let r = r0 * bandLoFrac; r <= r0 * 1.08; r += 0.4) {
      const x = eSeed.cx + r * ux, y = eSeed.cy + r * uy;
      if (x < 1.5 || y < L.yTopValid + 1.5 || x >= L.w - 1.5 || y >= L.yBotValid - 1.5) break;
      maxRReached = r;
      prof.push([r, labAt(L, x, y)]);
    }
    if (maxRReached < r0 * 0.99 || prof.length < 8) continue;
    const grads = prof.map((_, i) => (i >= 2 && i < prof.length - 2 ? labChromaDist(prof[i - 2][1], prof[i + 2][1]) : 0));
    const top = Math.max(...grads);
    if (top < 4.5) continue;

    let pick = -1;
    for (let i = prof.length - 3; i >= 2; i--) {
      if (grads[i] >= 0.42 * top && grads[i] >= grads[i - 1] && grads[i] >= grads[i + 1]) {
        const dIn = shadowAwareBgDist(prof[i - 2][1], localBg);
        const dOut = shadowAwareBgDist(prof[i + 2][1], localBg);
        if (dIn > dOut + 2.5 && dIn >= 5.5) {
          pick = i;
          break;
        }
      }
    }
    if (pick >= 2) {
      const r = prof[pick][0];
      pts.push([eSeed.cx + r * ux, eSeed.cy + r * uy]);
    }
  }
  return fitEllipseRobust(pts, eSeed, 4, 0.86);
}

function branchPolarDpBand(L, eSeed, discProto, extProto, bandLoFrac = 0.92) {
  const NA = 180, NR = 64, lo = bandLoFrac, hi = 1.075;
  const rel = Array.from({ length: NR }, (_, k) => lo + ((hi - lo) * k) / (NR - 1));
  const cost = new Float64Array(NA * NR);

  for (let a = 0; a < NA; a++) {
    const th = (2 * Math.PI * a) / NA, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(eSeed, th);
    const xb = Math.max(2, Math.min(L.w - 2.01, eSeed.cx + 1.12 * r0 * ux));
    const yb = Math.max(L.yTopValid + 2, Math.min(L.yBotValid - 2.01, eSeed.cy + 1.12 * r0 * uy));
    const localBg = labAt(L, xb, yb);
    for (let k = 2; k < NR - 2; k++) {
      const r = rel[k] * r0;
      const xIn = eSeed.cx + (r - 2.0) * ux, yIn = eSeed.cy + (r - 2.0) * uy;
      const xOut = eSeed.cx + (r + 2.0) * ux, yOut = eSeed.cy + (r + 2.0) * uy;
      if (xOut < 2 || yOut < L.yTopValid + 2 || xOut >= L.w - 2 || yOut >= L.yBotValid - 2) {
        cost[a * NR + k] = 0;
        continue;
      }
      const cIn = labAt(L, xIn, yIn), cOut = labAt(L, xOut, yOut);
      const step = labChromaDist(cIn, cOut);
      const bgDrop = Math.max(0, shadowAwareBgDist(cIn, localBg) - shadowAwareBgDist(cOut, localBg));
      const priorPen = 16 * Math.abs(rel[k] - 1.0);
      cost[a * NR + k] = -(step * 0.65 + bgDrop * 0.55) + priorPen;
    }
  }

  const T = NA * 2, INF = 1e12, lambda = 2.5;
  let cur = new Float64Array(NR);
  const back = new Int8Array(T * NR);
  for (let t = 0; t < T; t++) {
    const a = t % NA;
    const nxt = new Float64Array(NR);
    if (t === 0) {
      for (let k = 0; k < NR; k++) nxt[k] = cost[a * NR + k];
    } else {
      for (let k = 0; k < NR; k++) {
        let best = INF, bd = 0;
        for (let d = -2; d <= 2; d++) {
          const kk = k + d;
          if (kk < 2 || kk >= NR - 2) continue;
          const v = cur[kk] + lambda * Math.abs(d);
          if (v < best) { best = v; bd = d; }
        }
        nxt[k] = best + cost[a * NR + k];
        back[t * NR + k] = bd;
      }
    }
    cur = nxt;
  }
  let bestK = 2;
  for (let k = 2; k < NR - 2; k++) if (cur[k] < cur[bestK]) bestK = k;
  const pathK = new Int16Array(T);
  let k = bestK;
  for (let t = T - 1; t >= 0; t--) {
    pathK[t] = k;
    k += back[t * NR + k];
  }
  const pts = [];
  for (let a = 0; a < NA; a++) {
    const j = pathK[NA + a];
    const th = (2 * Math.PI * a) / NA, r = rel[j] * radiusAlong(eSeed, th);
    const x = eSeed.cx + r * Math.cos(th), y = eSeed.cy + r * Math.sin(th);
    if (x >= 2 && y >= L.yTopValid + 2 && x < L.w - 2 && y < L.yBotValid - 2) pts.push([x, y]);
  }
  return fitEllipseRobust(pts, eSeed, 4, 0.86);
}

function runThroDiscItem(photo) {
  const coarseRes = runCoarseRimBand(photo);
  const L = getLab(photo, 720);
  const s = L.s, invS = 1 / s;
  const eSeed = {
    cx: coarseRes.coarse.cx * s,
    cy: coarseRes.coarse.cy * s,
    rx: coarseRes.coarse.rx * s,
    ry: coarseRes.coarse.ry * s,
    angle: coarseRes.coarse.angle,
  };
  const innerWork = coarseRes.innerRimRing
    ? {
        cx: coarseRes.innerRimRing.cx * s,
        cy: coarseRes.innerRimRing.cy * s,
        rx: coarseRes.innerRimRing.rx * s,
        ry: coarseRes.innerRimRing.ry * s,
        angle: coarseRes.innerRimRing.angle,
      }
    : null;

  const { discProto, extProto } = getPrototypes(L, eSeed);
  // If CoarseRimBand already promoted an inner overmold ring (~0.91 R) to the outer overmold rim (1.00 R),
  // keep the fine search band above the inner overmold boundary (bandLoFrac = 0.955)!
  const bandLoFrac = coarseRes.hasConcentricOvermold ? 0.955 : 0.92;

  const b1Ell = branchBandSnap(L, eSeed, discProto, extProto, bandLoFrac);
  const b2Ell = branchOvermoldOuter(L, eSeed, discProto, extProto, bandLoFrac);
  const b3Ell = branchPolarDpBand(L, eSeed, discProto, extProto, bandLoFrac);

  const branches = [
    { id: 'fine/v1-band-snap', ell: b1Ell, ev: scoreCandidateArcs(L, eSeed, b1Ell, extProto) },
    { id: 'fine/v2-overmold-outer', ell: b2Ell, ev: scoreCandidateArcs(L, eSeed, b2Ell, extProto) },
    { id: 'fine/v3-polar-dp-band', ell: b3Ell, ev: scoreCandidateArcs(L, eSeed, b3Ell, extProto) },
  ];

  const minR = Math.min(...branches.map((b) => b.ev.meanR));
  const outerOvermoldBranch = branches.find(
    (b) => b.ev.meanR / minR >= 1.032 && b.ev.meanR / minR <= 1.095 && b.ev.octantSupport >= 0.55
  );
  const eligible = outerOvermoldBranch
    ? branches.filter((b) => Math.abs(b.ev.meanR - outerOvermoldBranch.ev.meanR) / outerOvermoldBranch.ev.meanR <= 0.025)
    : branches;

  const joinedPts = [];
  const pickedPerArc = [];
  const pickedBranches = new Set();
  for (let o = 0; o < 8; o++) {
    let bestB = eligible[0];
    for (const b of eligible) {
      if (b.ev.arcScores[o] > bestB.ev.arcScores[o]) bestB = b;
    }
    pickedPerArc.push(bestB.id.replace('fine/', ''));
    pickedBranches.add(bestB);
    joinedPts.push(...bestB.ev.arcPoints[o]);
  }

  const joinedWork = pickedBranches.size === 1 ? [...pickedBranches][0].ell : fitEllipseRobust(joinedPts, eligible[0].ell, 2, 0.86);
  const joinedEv = scoreCandidateArcs(L, eSeed, joinedWork, extProto);

  let maxBandUsage = 0;
  for (let a = 0; a < 360; a++) {
    const th = a * DEG;
    const r0 = radiusAlong(eSeed, th);
    const dx = joinedWork.cx + radiusAlong(joinedWork, th) * Math.cos(th) - eSeed.cx;
    const dy = joinedWork.cy + radiusAlong(joinedWork, th) * Math.sin(th) - eSeed.cy;
    const rJ = Math.hypot(dx, dy);
    maxBandUsage = Math.max(maxBandUsage, Math.abs(rJ - r0) / r0);
  }

  const octantSpreadPct = [];
  for (let o = 0; o < 8; o++) {
    const th = ((o + 0.5) * Math.PI) / 4;
    const rs = eligible.map((b) => radiusAlong(b.ell, th));
    const rMean = (Math.max(...rs) + Math.min(...rs)) * 0.5;
    octantSpreadPct.push(+(((Math.max(...rs) - Math.min(...rs)) / rMean) * 100).toFixed(2));
  }

  const serialFeatures = extractSerialFeatures(L, joinedWork, innerWork);

  const toSource = (e) => ({
    cx: +(e.cx * invS).toFixed(2),
    cy: +(e.cy * invS).toFixed(2),
    rx: +(e.rx * invS).toFixed(2),
    ry: +(e.ry * invS).toFixed(2),
    angle: +e.angle.toFixed(2),
  });

  const outJoined = toSource(joinedWork);
  const outBranches = Object.fromEntries(branches.map((b) => [b.id, toSource(b.ell)]));

  const needsTestimonyOctants = [];
  for (let o = 0; o < 8; o++) {
    if (joinedEv.arcRawSteps[o] < 6.0 || octantSpreadPct[o] > 3.5) {
      needsTestimonyOctants.push(o);
    }
  }

  return {
    
    serialFeatures,
    coarse: coarseRes.coarse,
    coarseFoci: coarseRes.foci,
    innerRimRing: coarseRes.innerRimRing,
    innerFoci: coarseRes.innerFoci,
    output: outJoined,
    foci: computeFoci(outJoined),
    branches: outBranches,
    pickedPerArc,
    liveWitness: {
      scope: 'live-execution',
      letterboxDetected: coarseRes.letterboxDetected,
      octantSupport: joinedEv.octantSupport,
      meanArcScore: joinedEv.totalScore,
      arcRawSteps: joinedEv.arcRawSteps,
      octantSpreadPct,
      maxBandUsagePct: +(maxBandUsage * 100).toFixed(2),
      zeroBandClip: maxBandUsage < 0.085,
      needsTestimonyOctants,
    },
    assumptions: {
      noBorderClamp: true,
      noTightShrinkHack: true,
      zeroBandClip: maxBandUsage < 0.085,
      octantConsensus75: joinedEv.octantSupport >= 0.75,
    },
  };
}

// ---------------------------------------------------------------------------
// Pure-Node PNG Encoder & Visual Overlay Renderer
// ---------------------------------------------------------------------------

export function forgetRimfit(name) { workCache.delete(name); for (const k of [...labCache.keys()]) if (k.startsWith(name + '@')) labCache.delete(k); }
export { runThroDiscItem, runCoarseRimBand, radiusAlong };
