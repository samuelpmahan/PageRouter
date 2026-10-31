// KAN 2.0 Live Disc Cropper & Upload Modal for Thro
// Architecture: Data -> Structure -> Legibility
//   Stage 1: ViewportLetterboxCrop + CoarseRimBand (270px chroma-boosted Lab + 8-octant completeness guard)
//   Stage 2: Concentric Dual-Ring Separator (540px Lab, separates Gyro overmold R_outer from flight plate R_inner)
//   Stage 3: Shadow-Aware ForkJoin (720px Lab, 3 branches + 8-octant arc join + ScopeLive Witness)

import { initialDraft } from './studio/upload-disc-to-shelf/model.js';
import { enter, record } from './thro-calculations.mjs';

// The crop is thro's own (photos.html): Argon's CoarseRimBand + FineRimForkJoin as the registered Calculation thro/crop/live, run
// off the main thread, then thro/crop/unwarp (one affine map, ellipse -> face-on circle) and thro/crop/cutout.
const DEG = Math.PI / 180;
let rimWorker = null; const rimWaiting = new Map(); let rimSeq = 0;
function rimFit(img, name) {
  rimWorker ??= Object.assign(new Worker(new URL('./rimfit-worker.mjs', import.meta.url), { type: 'module' }), {
    onmessage: ({ data }) => {
      const w = rimWaiting.get(data.name);
      rimWaiting.delete(data.name);
      if (!w) return;
      if (data.error) w.no(Error(data.error));
      else { record(data.report); w.ok(data.report); }
    },
  });
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, k = Math.min(1, 1080 / Math.max(W, H));
  const c = Object.assign(document.createElement('canvas'), { width: Math.max(16, Math.round(W * k)), height: Math.max(16, Math.round(H * k)) });
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
  const data = x.getImageData(0, 0, c.width, c.height).data, key = `${name}#${++rimSeq}`;
  return new Promise((ok, no) => { rimWaiting.set(key, { ok, no }); rimWorker.postMessage({ name: key, width: W, height: H, reference: null, working: { width: c.width, height: c.height, data } }, [data.buffer]); });
}

function resolveEllipsePx(crop, W, H) {
  if (typeof crop?.cx === 'number' && typeof crop?.rx === 'number') {
    return { cx: crop.cx, cy: crop.cy, rx: Math.max(4, crop.rx), ry: Math.max(4, crop.ry), angle: crop.angle || 0 };
  }
  return { cx: crop.centerX * W, cy: crop.centerY * H, rx: Math.max(4, crop.radiusX * W), ry: Math.max(4, crop.radiusY * H), angle: crop.angle || 0 };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const medianLab = (list) => [0, 1, 2].map((k) => median(list.map((c) => c[k])));
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const labChromaDist = (a, b) => Math.hypot(a[0] - b[0], 1.65 * (a[1] - b[1]), 1.65 * (a[2] - b[2]));

const shadowAwareBgDist = (px, bg) => {
  const dL = px[0] < bg[0] ? (px[0] - bg[0]) * 0.42 : px[0] - bg[0];
  return Math.hypot(dL, 1.65 * (px[1] - bg[1]), 1.65 * (px[2] - bg[2]));
};

function rgbToLab(r, g, b) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
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

function buildLabFromRgba(rgba, width, height, maxDim = 720) {
  const s = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(16, Math.round(width * s));
  const h = Math.max(16, Math.round(height * s));
  const L = new Float64Array(w * h);
  const A = new Float64Array(w * h);
  const B = new Float64Array(w * h);

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) / s)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) / s)));
      let r = 0, g = 0, b = 0, n = 0;
      const stepY = Math.max(1, Math.floor((y1 - y0) / 2));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 2));
      for (let yy = y0; yy < y1; yy += stepY) {
        for (let xx = x0; xx < x1; xx += stepX) {
          const i = (yy * width + xx) * 4;
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
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
  return {
    w, h, s,
    yTopValid: letterboxDetected ? yTopValid : 0,
    yBotValid: letterboxDetected ? yBotValid : h - 1,
    letterboxDetected,
    topBarPct: +((yTopValid / h) * 100).toFixed(1),
    botBarPct: +(((h - 1 - yBotValid) / h) * 100).toFixed(1),
    ch: [boxBlur(L, w, h), boxBlur(A, w, h), boxBlur(B, w, h)],
  };
}

function labAt(L, x, y) {
  const xc = clamp(x, 0, L.w - 1.001);
  const yc = clamp(y, 0, L.h - 1.001);
  const x0 = Math.floor(xc), y0 = Math.floor(yc), fx = xc - x0, fy = yc - y0;
  const i = y0 * L.w + x0;
  return [
    (L.ch[0][i] * (1 - fx) + L.ch[0][i + 1] * fx) * (1 - fy) + (L.ch[0][i + L.w] * (1 - fx) + L.ch[0][i + L.w + 1] * fx) * fy,
    (L.ch[1][i] * (1 - fx) + L.ch[1][i + 1] * fx) * (1 - fy) + (L.ch[1][i + L.w] * (1 - fx) + L.ch[1][i + L.w + 1] * fx) * fy,
    (L.ch[2][i] * (1 - fx) + L.ch[2][i + 1] * fx) * (1 - fy) + (L.ch[2][i + L.w] * (1 - fx) + L.ch[2][i + L.w + 1] * fx) * fy,
  ];
}

function radiusAlong(e, theta) {
  const a = (e.angle || 0) * DEG;
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
  let p = [seed.cx, seed.cy, seed.rx, seed.ry, (seed.angle || 0) * DEG];
  let active = pts;
  const maxShift = seed.rx * 0.15;

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

function scoreCandidateArcs(L, candEll) {
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
      const xFar = clamp(candEll.cx + (r + 14.0) * ux, 2, L.w - 2.01);
      const yFar = clamp(candEll.cy + (r + 14.0) * uy, L.yTopValid + 2, L.yBotValid - 2.01);
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
      const xb = clamp(eSeed.cx + f * r0 * ux, 2, L.w - 2.01);
      const yb = clamp(eSeed.cy + f * r0 * uy, L.yTopValid + 2, L.yBotValid - 2.01);
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
    let last = -1, bgRun = 0;
    for (let i = 0; i < prof.length; i++) {
      const dDisc = Math.min(labChromaDist(prof[i][1], discProto), labChromaDist(prof[i][1], localRimIn));
      if (dDisc < shadowAwareBgDist(prof[i][1], localBg)) {
        last = i; bgRun = 0;
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

function branchOvermoldOuter(L, eSeed, bandLoFrac = 0.92) {
  const pts = [];
  const RAYS = 180;
  for (let k = 0; k < RAYS; k++) {
    const th = (2 * Math.PI * k) / RAYS, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(eSeed, th);
    const rayBgList = [];
    for (const f of [1.10, 1.14, 1.18]) {
      const xb = clamp(eSeed.cx + f * r0 * ux, 2, L.w - 2.01);
      const yb = clamp(eSeed.cy + f * r0 * uy, L.yTopValid + 2, L.yBotValid - 2.01);
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

function branchPolarDpBand(L, eSeed, bandLoFrac = 0.92) {
  const NA = 180, NR = 64, lo = bandLoFrac, hi = 1.075;
  const rel = Array.from({ length: NR }, (_, k) => lo + ((hi - lo) * k) / (NR - 1));
  const cost = new Float64Array(NA * NR);

  for (let a = 0; a < NA; a++) {
    const th = (2 * Math.PI * a) / NA, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(eSeed, th);
    const xb = clamp(eSeed.cx + 1.12 * r0 * ux, 2, L.w - 2.01);
    const yb = clamp(eSeed.cy + 1.12 * r0 * uy, L.yTopValid + 2, L.yBotValid - 2.01);
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

/**
 * Runs the 3-stage KAN 2.0 coarse-to-fine disc rim detector on raw RGBA pixels.
 * Returns normalized crop ellipses, candidate branches, and ScopeLive Witness telemetry.
 */
export function detectKanDisc(rgba, width, height) {
  const t0 = performance.now();
  const L = buildLabFromRgba(rgba, width, height, 270);
  const w = L.w, h = L.h, s = Math.min(w, h);
  const yTop = L.yTopValid + 2, yBot = L.yBotValid - 2;
  const ch0 = L.ch[0], ch1 = L.ch[1], ch2 = L.ch[2];

  const borderSamples = [];
  for (let x = 2; x < w - 2; x += 3) borderSamples.push(labAt(L, x, yTop), labAt(L, x, yBot));
  for (let y = yTop; y <= yBot; y += 3) borderSamples.push(labAt(L, 2, y), labAt(L, w - 3, y));
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
    let sumStep = 0, sumSqIn = 0;

    for (let k = 0; k < N_RAYS; k++) {
      const ux = cosT[k], uy = sinT[k];
      const xOut = Math.round(cx + ux * (r * 1.045)), yOut = Math.round(cy + uy * (r * 1.045));
      if (xOut < 1 || yOut < yTop || xOut >= w - 1 || yOut > yBot) continue;
      const xIn = Math.round(cx + ux * (r * 0.955)), yIn = Math.round(cy + uy * (r * 0.955));
      const xPlate = Math.round(cx + ux * (r * 0.82)), yPlate = Math.round(cy + uy * (r * 0.82));
      if (xIn < 1 || yIn < yTop || xIn >= w - 1 || yIn > yBot) continue;

      const iOut = yOut * w + xOut;
      const iIn = yIn * w + xIn;
      const iPlate = clamp(yPlate * w + xPlate, 0, w * h - 1);

      const o0 = ch0[iOut], o1 = ch1[iOut], o2 = ch2[iOut];
      const n0 = ch0[iIn], n1 = ch1[iIn], n2 = ch2[iIn];
      const p0 = ch0[iPlate], p1 = ch1[iPlate], p2 = ch2[iPlate];

      const d1 = Math.hypot(n0 - o0, 1.65 * (n1 - o1), 1.65 * (n2 - o2));
      const d2 = Math.hypot(p0 - o0, 1.65 * (p1 - o1), 1.65 * (p2 - o2));
      const dStep = 0.75 * d1 + 0.25 * Math.max(d1, d2);

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

    let supportedOctants = 0, validOctants = 0;
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

    let outerBgPenalty = 1.0;
    if (farCount >= 24) {
      const meanOutMatched = [sumOutFar0 / farCount, sumOutFar1 / farCount, sumOutFar2 / farCount];
      const meanFar = [sumFar0 / farCount, sumFar1 / farCount, sumFar2 / farCount];
      const outToBg = labChromaDist(meanOutMatched, bgMed);
      const farToBg = labChromaDist(meanFar, bgMed);
      const outToFar = labChromaDist(meanOutMatched, meanFar);
      if (outToBg > farToBg + 12 && outToFar > 14) outerBgPenalty = 0.52;
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

  // Stage 2: 540px Lab radial transition + Concentric Dual-Ring Separator
  const L2 = buildLabFromRgba(rgba, width, height, 540);
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
  const discProto2 = medianLab(discColors);
  const extProto2 = extColors.length >= 12 ? medianLab(extColors) : bgMed;
  const protoSep = Math.max(4, labChromaDist(discProto2, extProto2));

  const rimPts = [];
  const outerOvermoldPts = [];
  const outerOvermoldOctants = new Set();
  const innerWallPts = [];
  const RAYS = 72;

  for (let k = 0; k < RAYS; k++) {
    const th = (2 * Math.PI * k) / RAYS, ux = Math.cos(th), uy = Math.sin(th);
    const localBgList = [];
    for (const f of [1.10, 1.15, 1.20]) {
      const xb = clamp(seed2.cx + f * seed2.rx * ux, 2, L2.w - 2.01);
      const yb = clamp(seed2.cy + f * seed2.rx * uy, L2.yTopValid + 2, L2.yBotValid - 2.01);
      localBgList.push(labAt(L2, xb, yb));
    }
    const localBg = medianLab(localBgList);

    const prof = [];
    let maxRReached = 0;
    for (let r = seed2.rx * 0.83; r <= seed2.rx * 1.15; r += 0.5) {
      const x = seed2.cx + r * ux, y = seed2.cy + r * uy;
      if (x < 1.5 || y < L2.yTopValid + 1.5 || x >= L2.w - 1.5 || y >= L2.yBotValid - 1.5) break;
      maxRReached = r;
      prof.push([r, labAt(L2, x, y)]);
    }
    if (maxRReached < seed2.rx * 0.99 || prof.length < 12) continue;

    const grads = prof.map((_, i) => (i >= 2 && i < prof.length - 2 ? labChromaDist(prof[i - 2][1], prof[i + 2][1]) : 0));
    const maxGrad = Math.max(...grads);
    if (maxGrad < Math.max(4.0, protoSep * 0.16)) continue;

    let switchIdx = -1, bgRun = 0;
    for (let i = 0; i < prof.length; i++) {
      if (labChromaDist(prof[i][1], discProto2) < shadowAwareBgDist(prof[i][1], localBg)) {
        switchIdx = i; bgRun = 0;
      } else {
        bgRun++;
        if (switchIdx >= 0 && bgRun >= 5) break;
      }
    }
    let bestIdx = switchIdx, bestScore = -1;
    for (let i = 2; i < prof.length - 2; i++) {
      if (grads[i] >= grads[i - 1] && grads[i] >= grads[i + 1] && grads[i] >= 0.38 * maxGrad) {
        const prox = switchIdx >= 0 ? Math.exp(-((i - switchIdx) ** 2) / (2 * 7 ** 2)) : 0.7;
        const sc = grads[i] * (0.40 + 0.60 * prox);
        if (sc > bestScore) { bestScore = sc; bestIdx = i; }
      }
    }
    if (bestIdx >= 2 && bestIdx < prof.length - 2) {
      const rInner = prof[bestIdx][0];
      rimPts.push({ k, r: rInner, pt: [seed2.cx + rInner * ux, seed2.cy + rInner * uy] });

      let overmoldIdx = -1;
      for (let i = bestIdx + 3; i < prof.length - 2; i++) {
        const ratio = prof[i][0] / rInner;
        if (ratio >= 1.035 && ratio <= 1.115 && grads[i] >= grads[i - 1] && grads[i] >= grads[i + 1] && grads[i] >= 10.5) {
          if (labDist(prof[i - 2][1], localBg) > labDist(prof[i + 2][1], localBg) + 5.0) overmoldIdx = i;
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
      if (x >= 1.5 && y >= L2.yTopValid + 1.5 && x < L2.w - 1.5 && y < L2.yBotValid - 1.5) innerProf.push([r, labAt(L2, x, y)]);
    }
    if (innerProf.length >= 8) {
      const ig = innerProf.map((_, i) => (i >= 2 && i < innerProf.length - 2 ? labChromaDist(innerProf[i - 2][1], innerProf[i + 2][1]) : 0));
      let iBest = -1, iMax = 8.5;
      for (let i = 2; i < innerProf.length - 2; i++) {
        if (ig[i] > iMax && ig[i] >= ig[i - 1] && ig[i] >= ig[i + 1]) { iMax = ig[i]; iBest = i; }
      }
      if (iBest >= 0) {
        const rW = innerProf[iBest][0];
        innerWallPts.push([seed2.cx + rW * ux, seed2.cy + rW * uy]);
      }
    }
  }

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
  let innerEll2 = null;
  if (innerWallPts.length >= 20) {
    const rMed = median(innerWallPts.map(([x, y]) => Math.hypot(x - fitted2.cx, y - fitted2.cy)));
    if (rMed < Math.min(fitted2.rx, fitted2.ry) * 0.94) {
      const innerSeed = { cx: fitted2.cx, cy: fitted2.cy, rx: rMed, ry: rMed * (fitted2.ry / fitted2.rx), angle: fitted2.angle };
      innerEll2 = fitEllipseRobust(innerWallPts, innerSeed, 3, 0.86);
    }
  }

  // Stage 3: 720px Lab 3-Branch ForkJoin + 8-Octant Arc Join
  const L3 = buildLabFromRgba(rgba, width, height, 720);
  const scale3 = L3.s / L2.s;
  const eSeed3 = {
    cx: fitted2.cx * scale3,
    cy: fitted2.cy * scale3,
    rx: fitted2.rx * scale3,
    ry: fitted2.ry * scale3,
    angle: fitted2.angle,
  };
  const { discProto, extProto } = getPrototypes(L3, eSeed3);
  const bandLoFrac = hasConcentricOvermold ? 0.955 : 0.92;

  const b1Ell = branchBandSnap(L3, eSeed3, discProto, extProto, bandLoFrac);
  const b2Ell = branchOvermoldOuter(L3, eSeed3, bandLoFrac);
  const b3Ell = branchPolarDpBand(L3, eSeed3, bandLoFrac);

  const branches = [
    { id: 'v1-band-snap', label: 'Ignore shadow', ell: b1Ell, ev: scoreCandidateArcs(L3, b1Ell) },
    { id: 'v2-overmold-outer', label: 'Overmold edge', ell: b2Ell, ev: scoreCandidateArcs(L3, b2Ell) },
    { id: 'v3-polar-dp-band', label: 'Traced edge', ell: b3Ell, ev: scoreCandidateArcs(L3, b3Ell) },
  ];

  const minR = Math.min(...branches.map((b) => b.ev.meanR));
  const outerOvermoldBranch = branches.find((b) => b.ev.meanR / minR >= 1.032 && b.ev.meanR / minR <= 1.095 && b.ev.octantSupport >= 0.55);
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
    pickedPerArc.push(bestB.id);
    pickedBranches.add(bestB);
    joinedPts.push(...bestB.ev.arcPoints[o]);
  }

  const joinedWork = pickedBranches.size === 1 ? [...pickedBranches][0].ell : fitEllipseRobust(joinedPts, eligible[0].ell, 2, 0.86);
  const joinedEv = scoreCandidateArcs(L3, joinedWork);

  let maxBandUsage = 0;
  for (let a = 0; a < 360; a++) {
    const th = a * DEG;
    const r0 = radiusAlong(eSeed3, th);
    const dx = joinedWork.cx + radiusAlong(joinedWork, th) * Math.cos(th) - eSeed3.cx;
    const dy = joinedWork.cy + radiusAlong(joinedWork, th) * Math.sin(th) - eSeed3.cy;
    maxBandUsage = Math.max(maxBandUsage, Math.abs(Math.hypot(dx, dy) - r0) / r0);
  }

  const toNormalizedCrop = (ell, sFactor) => {
    const invS = 1 / sFactor;
    const cx = ell.cx * invS;
    const cy = ell.cy * invS;
    const rx = ell.rx * invS;
    const ry = ell.ry * invS;
    const angle = +(ell.angle || 0).toFixed(2);
    return {
      cx: +cx.toFixed(2),
      cy: +cy.toFixed(2),
      rx: +rx.toFixed(2),
      ry: +ry.toFixed(2),
      centerX: clamp(cx / width, 0.05, 0.95),
      centerY: clamp(cy / height, 0.05, 0.95),
      radiusX: rx / width,
      radiusY: ry / height,
      angle,
      foci: computeFoci({ cx, cy, rx, ry, angle }),
    };
  };

  const outerCrop = toNormalizedCrop(joinedWork, L3.s);
  const innerCrop = innerEll2 ? toNormalizedCrop(innerEll2, L2.s) : null;

  const candidates = [
    { id: 'joined-outer', label: 'Outer rim', crop: outerCrop },
  ];
  if (innerCrop) {
    candidates.push({ id: 'flight-plate', label: 'Flight plate', crop: innerCrop });
  }
  for (const b of branches) {
    candidates.push({ id: b.id, label: b.label, crop: toNormalizedCrop(b.ell, L3.s) });
  }

  const g1Pass = outerCrop.centerX >= 0.22 && outerCrop.centerX <= 0.78 && outerCrop.centerY >= 0.18 && outerCrop.centerY <= 0.82;
  const g2Pass = maxBandUsage < 0.085;
  const g3Pass = joinedEv.octantSupport >= 0.75;

  return {
    crop: outerCrop,
    innerCrop,
    candidates,
    witness: {
      passed: g1Pass && g2Pass && g3Pass,
      ms: Math.round(performance.now() - t0),
      pickedPerArc,
      bandUsage: +maxBandUsage.toFixed(4),
      octantSupport: joinedEv.octantSupport,
      isLetterboxed: L3.letterboxDetected,
      letterboxBars: L3.letterboxDetected ? `${L3.topBarPct}% / ${L3.botBarPct}%` : null,
      hasConcentricOvermold,
      guarantees: {
        G1_LivePriorBounds100: g1Pass,
        G2_LiveZeroBandClip100: g2Pass,
        G3_LiveOctantSupport100: g3Pass,
      },
    },
  };
}

/**
 * Renders the elliptical crop from an image/canvas into a square transparent WebP/PNG data URL
 * and computes its SHA-256 hex digest for thro-world's material cause verification.
 */
export async function cropDiscToDataUrl(imageSource, crop, size = 1024) {
  const srcW = imageSource.naturalWidth || imageSource.videoWidth || imageSource.width;
  const srcH = imageSource.naturalHeight || imageSource.videoHeight || imageSource.height;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const ellipse = resolveEllipsePx(crop, srcW, srcH), name = 'added-photo';
  const { matrix } = enter('thro/crop/unwarp', [{ name, ellipse, size }]).items[0];
  ctx.drawImage(enter('thro/crop/cutout', [{ name, img: imageSource, ellipse, size, matrix }]).items[0].canvas, 0, 0);

  let dataUrl = canvas.toDataURL('image/webp', 0.88);
  if (!dataUrl.startsWith('data:image/webp;base64,')) {
    dataUrl = canvas.toDataURL('image/png');
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  return { dataUrl, sha256, width: size, height: size };
}

// The 10 real Thro-discs test photos for 1-click live pipeline demo testing
export const KAN_SAMPLE_PHOTOS = Object.freeze([
  { id: 'IMG_6081', file: './assets/discs/kan-img-6081.jpg', label: 'Stag · iOS Screenshot', moldQuery: 'stag', manufacturer: 'Westside', name: 'Stag', plastic: 'VIP', weight: 173, speed: 8, glide: 6, turn: -1, fade: 2 },
  { id: 'IMG_6161', file: './assets/discs/kan-img-6161.jpg', label: 'Putter · Shadow Dipole', moldQuery: 'luna', manufacturer: 'Discraft', name: 'Luna', plastic: 'Jawbreaker', weight: 174, speed: 3, glide: 3, turn: 0, fade: 3 },
  { id: 'IMG_6162', file: './assets/discs/kan-img-6162.jpg', label: 'Salamander · Tie-Dye', moldQuery: 'leopard', manufacturer: 'Mint', name: 'Salamander', plastic: 'Sublime', weight: 171, speed: 6, glide: 5, turn: -2, fade: 1 },
  { id: 'IMG_6163', file: './assets/discs/kan-img-6163.jpg', label: 'Dojo · Spin-Dye Rings', moldQuery: 'buzzz', manufacturer: 'Discraft', name: 'Buzzz', plastic: 'ESP Spin-Dye', weight: 177, speed: 5, glide: 4, turn: -1, fade: 1 },
  { id: 'IMG_6164', file: './assets/discs/kan-img-6164.jpg', label: 'Defy · Dark Gyro Overmold', moldQuery: 'defy', manufacturer: 'Axiom', name: 'Defy', plastic: 'Fission', weight: 164, speed: 11, glide: 5, turn: -1, fade: 3 },
  { id: 'IMG_6165', file: './assets/discs/kan-img-6165.jpg', label: 'Servo · White Gyro on Fleece', moldQuery: 'servo', manufacturer: 'MVP', name: 'Servo', plastic: 'Neutron', weight: 172, speed: 6.5, glide: 5, turn: -1, fade: 2 },
  { id: 'IMG_6166', file: './assets/discs/kan-img-6166.jpg', label: 'Anchor · Translucent Teal', moldQuery: 'anchor', manufacturer: 'Latitude 64', name: 'Anchor', plastic: 'Opto', weight: 176, speed: 5, glide: 4, turn: 0, fade: 3 },
  { id: 'IMG_6167', file: './assets/discs/kan-img-6167.jpg', label: 'Buzzz SS · Cast Shadow', moldQuery: 'buzzz-ss', manufacturer: 'Discraft', name: 'Buzzz SS', plastic: 'Z FLX', weight: 175, speed: 5, glide: 4, turn: -2, fade: 1 },
  { id: 'IMG_6168', file: './assets/discs/kan-img-6168.jpg', label: 'Big Z Luna · Red Pearl', moldQuery: 'luna', manufacturer: 'Discraft', name: 'Luna', plastic: 'Big Z', weight: 173, speed: 3, glide: 3, turn: 0, fade: 3 },
  { id: 'IMG_6576', file: './assets/discs/kan-img-6576.jpg', label: 'Cloudbreaker · 26% Rim', moldQuery: 'destroyer', manufacturer: 'Discmania', name: 'Cloudbreaker', plastic: 'Creator Horizon', weight: 173, speed: 12, glide: 5, turn: -1, fade: 3 },
]);

/**
 * Opens the interactive KAN 2.0 Disc Upload & Auto-Crop Modal.
 */
export function openKanUploadModal({ workspace, onDiscSaved }) {
  document.getElementById('kan-upload-dialog')?.remove();

  const dialog = document.createElement('dialog');
  dialog.id = 'kan-upload-dialog';
  dialog.className = 'kan-upload-dialog';
  dialog.innerHTML = `
    <div class="kan-modal-shell">
      <header class="kan-modal-header">
        <div>
          <span class="eyebrow">STEP 1 · ADD A DISC</span>
          <h2>Add a disc photo</h2>
        </div>
        <button type="button" id="kan-close-btn" class="text-button" aria-label="Close modal">Close ✕</button>
      </header>

      <div class="kan-sample-strip" role="group" aria-label="Sample disc photos">
        <span class="kan-strip-label">Try a sample:</span>
        ${KAN_SAMPLE_PHOTOS.map((s, idx) => `<button type="button" class="kan-sample-chip" data-sample-idx="${idx}">${s.label}</button>`).join('')}
        <label class="kan-upload-chip">
          <input type="file" id="kan-file-input" accept="image/jpeg,image/png,image/webp" hidden>
          <span>+ Upload your photo</span>
        </label>
      </div>

      <div class="kan-modal-grid">
        <section class="kan-stage-col">
          <div class="kan-canvas-wrap">
            <canvas id="kan-stage-canvas" width="640" height="640"></canvas>
          </div>
          <div id="kan-witness-badge" class="kan-witness-badge">Pick a sample or upload a photo</div>
          <div class="kan-stage-controls">
            <div id="kan-candidate-pills" class="kan-pill-row" role="group" aria-label="Candidate rim branches"></div>
            <div class="kan-nudge-row">
              <span class="subtle">Rim size:</span>
              <button type="button" data-nudge="-0.03">−3%</button>
              <button type="button" data-nudge="-0.01">−1%</button>
              <button type="button" data-nudge="0.01">+1%</button>
              <button type="button" data-nudge="0.03">+3%</button>
              <button type="button" id="kan-reset-crop" class="text-button">Reset auto</button>
            </div>
          </div>
        </section>

        <section class="kan-form-col">
          <div class="kan-cutout-header">
            <div class="kan-cutout-preview-wrap">
              <canvas id="kan-cutout-canvas" width="208" height="208"></canvas>
            </div>
            <div class="kan-cutout-meta">
              <span class="eyebrow">YOUR CUTOUT</span>
              <strong id="kan-cutout-title">Round cutout · 1024 × 1024</strong>
              <p id="kan-cutout-sub" class="subtle">Drag inside the ring to move it · drag the orange rim to resize.</p>
            </div>
          </div>

          <label>Search catalog mold
            <input type="search" id="kan-mold-search" placeholder="Search 800+ molds (e.g. Crave, Servo, Buzzz, Stag)…" autocomplete="off">
          </label>
          <div id="kan-seed-matches" class="kan-seed-matches" role="listbox" aria-label="Catalog mold matches"></div>

          <div class="field-pair">
            <label>Manufacturer
              <input type="text" id="kan-manufacturer" maxlength="40" placeholder="MVP">
            </label>
            <label>Mold name
              <input type="text" id="kan-mold-name" maxlength="40" placeholder="Servo">
            </label>
          </div>

          <div class="field-pair">
            <label>Plastic
              <input type="text" id="kan-plastic" maxlength="40" placeholder="Neutron">
            </label>
            <label>Weight (g)
              <input type="number" id="kan-weight" min="100" max="220" step="1" placeholder="173">
            </label>
          </div>

          <div class="kan-flights-grid">
            <label>Speed<input type="number" id="kan-speed" min="1" max="15" step="0.5" value="7"></label>
            <label>Glide<input type="number" id="kan-glide" min="1" max="7" step="0.5" value="5"></label>
            <label>Turn<input type="number" id="kan-turn" min="-5" max="2" step="0.5" value="-1"></label>
            <label>Fade<input type="number" id="kan-fade" min="0" max="6" step="0.5" value="2"></label>
          </div>

          <div id="kan-error-msg" class="kan-error-msg" hidden></div>

          <div class="kan-modal-actions">
            <button type="button" id="kan-save-disc" class="button-primary" disabled>Add to your discs &amp; build card →</button>
          </div>
        </section>
      </div>
    </div>
  `;

  document.body.append(dialog);
  dialog.showModal();

  const stageCanvas = dialog.querySelector('#kan-stage-canvas');
  const stageCtx = stageCanvas.getContext('2d');
  const cutoutCanvas = dialog.querySelector('#kan-cutout-canvas');
  const cutoutCtx = cutoutCanvas.getContext('2d');
  const witnessBadge = dialog.querySelector('#kan-witness-badge');
  const candidatePills = dialog.querySelector('#kan-candidate-pills');
  const moldSearch = dialog.querySelector('#kan-mold-search');
  const seedMatches = dialog.querySelector('#kan-seed-matches');
  const mfgInput = dialog.querySelector('#kan-manufacturer');
  const nameInput = dialog.querySelector('#kan-mold-name');
  const plasticInput = dialog.querySelector('#kan-plastic');
  const weightInput = dialog.querySelector('#kan-weight');
  const speedInput = dialog.querySelector('#kan-speed');
  const glideInput = dialog.querySelector('#kan-glide');
  const turnInput = dialog.querySelector('#kan-turn');
  const fadeInput = dialog.querySelector('#kan-fade');
  const saveBtn = dialog.querySelector('#kan-save-disc');
  const errorBox = dialog.querySelector('#kan-error-msg');

  let loadedImg = null;
  let sourceName = 'disc-photo.jpg';
  let candidates = [];
  let innerRingEllipse = null;
  let activeEllipse = null;
  let activeCandidateId = 'rim-fit';
  let selectedSeedAddress = 'ds.px.seed.mvp--servo';
  let dragMode = null; // 'move' | 'resize'
  let dragStart = null;
  let loadGeneration = 0;

  function renderSeedMatches(query = '') {
    const matches = workspace.model.experience.seedOptions(query).slice(0, 8);
    if (!matches.length) {
      seedMatches.innerHTML = `<span class="subtle">Custom mold override active (uses base seed ${selectedSeedAddress.replace('ds.px.seed.', '')}).</span>`;
      return;
    }
    seedMatches.innerHTML = matches.map(({ address, seed }) => {
      const chosen = address === selectedSeedAddress;
      const flights = [seed.speed, seed.glide, seed.turn, seed.fade].map((v) => v ?? '–').join(' · ');
      return `<button type="button" class="kan-seed-option ${chosen ? 'is-selected' : ''}" data-seed-addr="${address}">
        <strong>${seed.manufacturer} ${seed.name}</strong>
        <span>${flights}</span>
      </button>`;
    }).join('');
    seedMatches.querySelectorAll('[data-seed-addr]').forEach((btn) => {
      btn.onclick = () => {
        selectedSeedAddress = btn.dataset.seedAddr;
        const seed = workspace.model.experience.seedAt(selectedSeedAddress);
        mfgInput.value = seed.manufacturer || '';
        nameInput.value = seed.name || '';
        if (seed.speed != null) speedInput.value = String(seed.speed);
        if (seed.glide != null) glideInput.value = String(seed.glide);
        if (seed.turn != null) turnInput.value = String(seed.turn);
        if (seed.fade != null) fadeInput.value = String(seed.fade);
        renderSeedMatches(moldSearch.value);
      };
    });
  }

  function paintStage() {
    if (!loadedImg || !activeEllipse) return;
    const sw = loadedImg.naturalWidth || loadedImg.width;
    const sh = loadedImg.naturalHeight || loadedImg.height;
    const cw = stageCanvas.width, ch = stageCanvas.height;
    stageCtx.clearRect(0, 0, cw, ch);

    const scale = Math.min(cw / sw, ch / sh);
    const dw = sw * scale, dh = sh * scale;
    const ox = (cw - dw) * 0.5, oy = (ch - dh) * 0.5;

    stageCtx.imageSmoothingQuality = 'high';
    stageCtx.drawImage(loadedImg, ox, oy, dw, dh);

    const cx = ox + activeEllipse.cx * scale;
    const cy = oy + activeEllipse.cy * scale;
    const rx = activeEllipse.rx * scale;
    const ry = activeEllipse.ry * scale;
    const tilt = (activeEllipse.angle || 0) * DEG, ct = Math.cos(tilt), st = Math.sin(tilt);

    // Darken exterior outside active crop ellipse
    stageCtx.save();
    stageCtx.beginPath();
    stageCtx.rect(0, 0, cw, ch);
    stageCtx.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2, true);
    stageCtx.fillStyle = 'rgba(8, 14, 10, 0.64)';
    stageCtx.fill('evenodd');
    stageCtx.restore();

    // Draw dashed yellow inner ring if concentric dual-ring was detected
    if (innerRingEllipse && activeCandidateId !== 'flight-plate') {
      const ic = innerRingEllipse;
      stageCtx.save();
      stageCtx.beginPath();
      stageCtx.ellipse(ox + ic.cx * scale, oy + ic.cy * scale, ic.rx * scale, ic.ry * scale, (ic.angle || 0) * DEG, 0, Math.PI * 2);
      stageCtx.setLineDash([5, 5]);
      stageCtx.lineWidth = 1.75;
      stageCtx.strokeStyle = '#ffd166cc';
      stageCtx.stroke();
      stageCtx.restore();
    }

    // Draw the active outer crop ellipse (thro orange) + 4 semi-axis handles along rotated axes
    stageCtx.save();
    stageCtx.beginPath();
    stageCtx.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2);
    stageCtx.lineWidth = 2.75;
    stageCtx.strokeStyle = '#e0632e';
    stageCtx.stroke();

    for (const [hx, hy] of [[cx + rx * ct, cy + rx * st], [cx - rx * ct, cy - rx * st], [cx - ry * st, cy + ry * ct], [cx + ry * st, cy - ry * ct]]) {
      stageCtx.beginPath();
      stageCtx.arc(hx, hy, 5.5, 0, Math.PI * 2);
      stageCtx.fillStyle = '#e1d6c2';
      stageCtx.fill();
      stageCtx.lineWidth = 2;
      stageCtx.strokeStyle = '#e0632e';
      stageCtx.stroke();
    }
    stageCtx.restore();

    // Paint live circular cutout preview using the exact same pixel-space ellipse + unwarp matrix as save
    const cSize = cutoutCanvas.width;
    cutoutCtx.clearRect(0, 0, cSize, cSize);
    cutoutCtx.save();
    const { matrix } = enter('thro/crop/unwarp', [{ name: 'preview', ellipse: activeEllipse, size: cSize }]).items[0];
    cutoutCtx.imageSmoothingQuality = 'high';
    cutoutCtx.setTransform(...matrix);
    cutoutCtx.beginPath();
    cutoutCtx.ellipse(activeEllipse.cx, activeEllipse.cy, activeEllipse.rx, activeEllipse.ry, (activeEllipse.angle || 0) * DEG, 0, Math.PI * 2);
    cutoutCtx.clip();
    cutoutCtx.drawImage(loadedImg, 0, 0);
    cutoutCtx.restore();
  }

  function renderCandidatePills() {
    candidatePills.innerHTML = candidates.map((cand) => `
      <button type="button" class="kan-cand-pill ${cand.id === activeCandidateId ? 'is-active' : ''}" data-cand-id="${cand.id}">
        ${cand.label}
      </button>
    `).join('');
    candidatePills.querySelectorAll('[data-cand-id]').forEach((btn) => {
      btn.onclick = () => {
        const found = candidates.find((c) => c.id === btn.dataset.candId);
        if (!found) return;
        activeCandidateId = found.id;
        activeEllipse = structuredClone(found.ellipse);
        renderCandidatePills();
        paintStage();
      };
    });
  }

  async function processImageElement(img, fname, preset = null, gen = loadGeneration) {
    loadedImg = img;
    sourceName = fname;
    saveBtn.disabled = true;
    witnessBadge.textContent = 'Finding the rim…';
    witnessBadge.className = 'kan-witness-badge';

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;

    let liveItem = null;
    let livePassed = false;
    try {
      const report = await rimFit(img, fname || 'photo');
      liveItem = report.items?.[0] ?? null;
      if (liveItem?.output) {
        livePassed = ['G1_LivePriorBounds', 'G2_LiveZeroBandClip', 'G3_LiveOctantSupport'].every(
          (g) => report.guarantees?.[g]?.passed !== false
        );
      }
    } catch (error) {
      console.warn('rim fit worker unavailable; falling back to synchronous detector', error);
    }
    if (gen !== loadGeneration || loadedImg !== img) return;

    if (liveItem?.output) {
      const nextCandidates = [{ id: 'rim-fit', label: 'Rim fit', ellipse: structuredClone(liveItem.output) }];
      if (liveItem.innerRimRing) {
        nextCandidates.push({ id: 'flight-plate', label: 'Flight plate', ellipse: structuredClone(liveItem.innerRimRing) });
      }
      const branchLabels = [
        ['fine/v1-band-snap', 'v1-band-snap', 'Ignore shadow'],
        ['fine/v2-overmold-outer', 'v2-overmold-outer', 'Overmold edge'],
        ['fine/v3-polar-dp-band', 'v3-polar-dp-band', 'Traced edge'],
      ];
      for (const [key, id, label] of branchLabels) {
        const bEll = liveItem.branches?.[key];
        if (bEll) nextCandidates.push({ id, label, ellipse: structuredClone(bEll) });
      }
      candidates = nextCandidates;
      innerRingEllipse = liveItem.innerRimRing ? structuredClone(liveItem.innerRimRing) : null;

      const dev = new URLSearchParams(location.search).has('dev');
      const lw = liveItem.liveWitness || {};
      const parts = !dev
        ? [livePassed ? '✓ Rim found' : 'Check the rim, then drag it to fit']
        : [
            `thro/crop/live ${livePassed ? 'PASS' : 'CHECK'} · ${Math.round(liveItem.ms || 0)} ms`,
            `octants ${Math.round((lw.octantSupport || 0) * 8)}/8`,
            `band ${(lw.maxBandUsagePct ?? 0).toFixed(1)}%`,
            liveItem.innerRimRing ? 'Gyro dual-ring' : null,
            lw.letterboxDetected ? 'Letterbox stripped' : null,
          ].filter(Boolean);
      witnessBadge.textContent = parts.join(' · ');
      witnessBadge.classList.toggle('is-pass', livePassed);
    } else {
      const decodeMax = 960;
      const dScale = Math.min(1, decodeMax / Math.max(sw, sh));
      const dw = Math.max(16, Math.round(sw * dScale));
      const dh = Math.max(16, Math.round(sh * dScale));
      const off = document.createElement('canvas');
      off.width = dw; off.height = dh;
      const octx = off.getContext('2d', { willReadFrequently: true });
      octx.drawImage(img, 0, 0, dw, dh);
      const rgba = octx.getImageData(0, 0, dw, dh).data;
      const detected = detectKanDisc(rgba, dw, dh);
      candidates = detected.candidates.map((c) => ({
        id: c.id,
        label: c.label,
        ellipse: resolveEllipsePx(c.crop, sw, sh),
      }));
      innerRingEllipse = detected.innerCrop ? resolveEllipsePx(detected.innerCrop, sw, sh) : null;
      const dev = new URLSearchParams(location.search).has('dev');
      witnessBadge.textContent = !dev
        ? (detected.witness.passed ? '✓ Rim found' : 'Check the rim, then drag it to fit')
        : `ScopeLive ${detected.witness.passed ? 'PASS' : 'CHECK'} · ${detected.witness.ms} ms`;
      witnessBadge.classList.toggle('is-pass', detected.witness.passed);
    }

    activeCandidateId = candidates[0].id;
    activeEllipse = structuredClone(candidates[0].ellipse);

    if (preset) {
      moldSearch.value = preset.moldQuery;
      const matches = workspace.model.experience.seedOptions(preset.moldQuery);
      if (matches.length) selectedSeedAddress = matches[0].address;
      mfgInput.value = preset.manufacturer;
      nameInput.value = preset.name;
      plasticInput.value = preset.plastic;
      weightInput.value = String(preset.weight ?? '');
      speedInput.value = String(preset.speed);
      glideInput.value = String(preset.glide);
      turnInput.value = String(preset.turn);
      fadeInput.value = String(preset.fade);
      renderSeedMatches(preset.moldQuery);
    } else {
      const stem = String(fname || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const tokenMatches = stem && !/^img\s*\d+$/i.test(stem) ? workspace.model.experience.seedOptions(stem) : [];
      if (tokenMatches.length) {
        selectedSeedAddress = tokenMatches[0].address;
        const seed = tokenMatches[0].seed;
        moldSearch.value = stem;
        mfgInput.value = seed.manufacturer || '';
        nameInput.value = seed.name || '';
        plasticInput.value = '';
        weightInput.value = '';
        if (seed.speed != null) speedInput.value = String(seed.speed);
        if (seed.glide != null) glideInput.value = String(seed.glide);
        if (seed.turn != null) turnInput.value = String(seed.turn);
        if (seed.fade != null) fadeInput.value = String(seed.fade);
        renderSeedMatches(stem);
      } else {
        moldSearch.value = '';
        mfgInput.value = '';
        nameInput.value = '';
        plasticInput.value = '';
        weightInput.value = '';
        renderSeedMatches('');
      }
    }

    renderCandidatePills();
    paintStage();
    saveBtn.disabled = false;
  }

  async function loadSamplePhoto(idx) {
    const preset = KAN_SAMPLE_PHOTOS[idx];
    if (!preset) return;
    const gen = ++loadGeneration;
    dialog.querySelectorAll('[data-sample-idx]').forEach((b, i) => b.classList.toggle('is-active', i === idx));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = preset.file;
    await img.decode();
    if (gen !== loadGeneration) return;
    await processImageElement(img, `${preset.id}.jpg`, preset, gen);
  }

  // Isotropic natural-pixel pointer coordinates + tilt-aware local ellipse norm
  function stageImageCoords(e) {
    const rect = stageCanvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (stageCanvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (stageCanvas.height / rect.height);
    const sw = loadedImg.naturalWidth || loadedImg.width;
    const sh = loadedImg.naturalHeight || loadedImg.height;
    const scale = Math.min(stageCanvas.width / sw, stageCanvas.height / sh);
    const ox = (stageCanvas.width - sw * scale) * 0.5;
    const oy = (stageCanvas.height - sh * scale) * 0.5;
    return { ix: (sx - ox) / scale, iy: (sy - oy) / scale, sw, sh };
  }

  function ellipseLocalNorm(ix, iy, ell) {
    const rad = (ell.angle || 0) * DEG;
    const ct = Math.cos(rad), st = Math.sin(rad);
    const dx = ix - ell.cx, dy = iy - ell.cy;
    const u = dx * ct + dy * st;
    const v = -dx * st + dy * ct;
    return Math.hypot(u / Math.max(4, ell.rx), v / Math.max(4, ell.ry));
  }

  function scaleEllipseOnRim(ell, factor, sw, sh) {
    const minRatio = (Math.min(sw, sh) * 0.06) / Math.max(4, Math.min(ell.rx, ell.ry));
    const maxRatio = (Math.max(sw, sh) * 0.65) / Math.max(4, Math.max(ell.rx, ell.ry));
    const r = clamp(factor, minRatio, maxRatio);
    return {
      ...ell,
      rx: +(ell.rx * r).toFixed(2),
      ry: +(ell.ry * r).toFixed(2),
    };
  }

  stageCanvas.onpointerdown = (e) => {
    if (!loadedImg || !activeEllipse) return;
    stageCanvas.setPointerCapture(e.pointerId);
    const { ix, iy } = stageImageCoords(e);
    const normR = ellipseLocalNorm(ix, iy, activeEllipse);
    dragMode = normR >= 0.85 ? 'resize' : 'move';
    dragStart = { ix, iy, normR: Math.max(0.08, normR), ell: structuredClone(activeEllipse) };
  };

  stageCanvas.onpointermove = (e) => {
    if (!loadedImg || !activeEllipse) return;
    const { ix, iy, sw, sh } = stageImageCoords(e);
    if (!dragMode || !dragStart) {
      const hoverNorm = ellipseLocalNorm(ix, iy, activeEllipse);
      stageCanvas.style.cursor = hoverNorm >= 0.85 && hoverNorm <= 1.18 ? 'nwse-resize' : 'grab';
      return;
    }
    if (dragMode === 'move') {
      activeEllipse.cx = +clamp(dragStart.ell.cx + (ix - dragStart.ix), sw * 0.06, sw * 0.94).toFixed(2);
      activeEllipse.cy = +clamp(dragStart.ell.cy + (iy - dragStart.iy), sh * 0.06, sh * 0.94).toFixed(2);
    } else {
      const curNorm = Math.max(0.08, ellipseLocalNorm(ix, iy, dragStart.ell));
      const scaled = scaleEllipseOnRim(dragStart.ell, curNorm / dragStart.normR, sw, sh);
      activeEllipse.rx = scaled.rx;
      activeEllipse.ry = scaled.ry;
    }
    paintStage();
  };

  stageCanvas.onpointerup = stageCanvas.onpointercancel = () => {
    dragMode = null;
    dragStart = null;
  };

  dialog.querySelectorAll('[data-nudge]').forEach((btn) => {
    btn.onclick = () => {
      if (!loadedImg || !activeEllipse) return;
      const sw = loadedImg.naturalWidth || loadedImg.width;
      const sh = loadedImg.naturalHeight || loadedImg.height;
      activeEllipse = scaleEllipseOnRim(activeEllipse, 1 + Number(btn.dataset.nudge), sw, sh);
      paintStage();
    };
  });

  dialog.querySelector('#kan-reset-crop').onclick = () => {
    if (!candidates.length) return;
    activeCandidateId = candidates[0].id;
    activeEllipse = structuredClone(candidates[0].ellipse);
    renderCandidatePills();
    paintStage();
  };

  dialog.querySelectorAll('[data-sample-idx]').forEach((btn) => {
    btn.onclick = () => loadSamplePhoto(Number(btn.dataset.sampleIdx));
  });

  dialog.querySelector('#kan-file-input').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const gen = ++loadGeneration;
    dialog.querySelectorAll('[data-sample-idx]').forEach((b) => b.classList.remove('is-active'));
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (gen !== loadGeneration) return;
      await processImageElement(img, file.name, null, gen);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  moldSearch.oninput = () => renderSeedMatches(moldSearch.value);

  dialog.querySelector('#kan-close-btn').onclick = () => {
    dialog.close();
    dialog.remove();
  };

  saveBtn.onclick = async () => {
    if (!loadedImg || !activeEllipse) return;
    errorBox.hidden = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Cropping & saving to shelf…';
    try {
      const { dataUrl, sha256, width, height } = await cropDiscToDataUrl(loadedImg, activeEllipse, 1024);
      const mfg = mfgInput.value.trim() || 'Custom';
      const moldName = nameInput.value.trim() || 'Disc';
      const plastic = plasticInput.value.trim();
      const rawWeight = weightInput.value.trim();
      const weight = rawWeight === '' ? null : Number(rawWeight);

      const speed = Number(speedInput.value);
      const glide = Number(glideInput.value);
      const turn = Number(turnInput.value);
      const fade = Number(fadeInput.value);

      const depiction = Object.freeze({
        kind: 'photo',
        src: dataUrl,
        name: moldName,
      });

      const photoDef = Object.freeze({
        disc: `kan-${sha256.slice(0, 8)}`,
        of: `${mfg} ${moldName}${plastic ? `, ${plastic}` : ''}`,
        source: sourceName,
        prepared: 'kan-2.0-live',
        size: `${width} × ${height}`,
        preparation: `${activeCandidateId === 'rim-fit' ? 'thro/crop/live rim fit' : `KAN 2.0 ${activeCandidateId}`} + thro/crop/unwarp`,
        build: 'kan-2.0',
        sha256,
      });

      const draft = {
        ...initialDraft(),
        mold: selectedSeedAddress,
        manufacturer: mfg,
        name: moldName,
        nickname: moldName,
        plastic,
        weight: Number.isFinite(weight) && weight > 0 ? weight : null,
        ...(Number.isFinite(speed) ? { speed } : {}),
        ...(Number.isFinite(glide) ? { glide } : {}),
        ...(Number.isFinite(turn) ? { turn } : {}),
        ...(Number.isFinite(fade) ? { fade } : {}),
        photoDefinition: photoDef,
      };

      const newAddress = await workspace.saveDisc(draft, depiction, { photo: depiction });
      await onDiscSaved?.(newAddress, `${mfg} ${moldName}`);
      dialog.close();
      dialog.remove();
    } catch (err) {
      errorBox.textContent = err?.message || String(err);
      errorBox.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Add to your discs & build card →';
    }
  };

  renderSeedMatches('stag');
  void loadSamplePhoto(0);
}
