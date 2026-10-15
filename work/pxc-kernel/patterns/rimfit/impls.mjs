// RimFit candidates as implementations of one contract, disc.rimfit.
// Input: photo = { name, path, width, height, working: { path, width, height }, sha256 } (raw RGBA decoded by the browser).
// Output: { status: 'MAYBE' | 'ABSTAIN', ellipse: { cx, cy, rx, ry, angle } | null, evidence: {...} }.
// Ellipse convention (shared with the truth set): source pixels, angle in degrees, point(t) =
//   (cx + rx cos t cos a - ry sin t sin a, cy + rx cos t sin a + ry sin t cos a).
// The DiscStudio sources are imported unchanged from the vendored 6.6.0 tree.
import fs from 'node:fs';
import { requireDiscStudio, WORK, FIXTURES } from './paths.mjs';
const DS = requireDiscStudio();
const { recoverRimEllipseV3 } = await import(`${DS}/rimfit-v3/recover.mjs`);
const { adaptRimFitResult } = await import(`${DS}/experimental/ellipse-fit-fix/fit-adapter.mjs`);
const { refineEllipseWithRimEvidence } = await import(`${DS}/experimental/ellipse-fit-fix/rim-aware-refinement.mjs`);
const { validateEllipseBounds } = await import(`${DS}/experimental/ellipse-fit-fix/ellipse-geometry.mjs`);
const { findInitialCircleCandidates } = await import(`${DS}/circle-candidates.ts`);
const { cropForSourceSamples } = await import(`${DS}/crop-geometry.ts`);
const { gaussianBlur } = await import(`${DS}/rimfit-v3/numeric.mjs`);

// ---------------------------------------------------------------- pixels (read once per photo)
const cache = new Map();
export function pixels(photo) {
  if (!cache.has(photo.path)) {
    const full = new Uint8ClampedArray(fs.readFileSync(photo.path));
    const work = new Uint8ClampedArray(fs.readFileSync(photo.working.path));
    cache.set(photo.path, { full: { width: photo.width, height: photo.height, data: full }, work: { width: photo.working.width, height: photo.working.height, data: work } });
  }
  return cache.get(photo.path);
}

// ---------------------------------------------------------------- shared geometry
const D = Math.PI / 180;
export const fromApp = (e) => e && ({ cx: e.centerX, cy: e.centerY, rx: e.radiusX, ry: e.radiusY, angle: e.axisAngle / D });
const toApp = (e) => ({ centerX: e.cx, centerY: e.cy, radiusX: Math.max(e.rx, e.ry), radiusY: Math.min(e.rx, e.ry), axisAngle: (e.rx >= e.ry ? e.angle : e.angle + 90) * D });
const round = (e) => e && Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Math.round(v * 100) / 100]));
export function radiusAlong(e, theta) { const a = e.angle * D, u = Math.cos(theta - a), v = Math.sin(theta - a); return 1 / Math.sqrt((u / e.rx) ** 2 + (v / e.ry) ** 2); }
export function pointAt(e, t) { const a = e.angle * D; return [e.cx + e.rx * Math.cos(t) * Math.cos(a) - e.ry * Math.sin(t) * Math.sin(a), e.cy + e.rx * Math.cos(t) * Math.sin(a) + e.ry * Math.sin(t) * Math.cos(a)]; }
function insideFrame(e, w, h) { return validateEllipseBounds(w, h, toApp(e), 0); }

// Least-squares ellipse through points, minimising radial misfit; a few Levenberg–Marquardt steps from a seed, with
// trimming of the worst 20% each round. Returns { ellipse, rms, kept }.
export function fitEllipse(points, seed, rounds = 3) {
  let p = [seed.cx, seed.cy, seed.rx, seed.ry, seed.angle * D], pts = points;
  const resid = (q, list) => list.map(([x, y]) => { const dx = x - q[0], dy = y - q[1], c = Math.cos(q[4]), s = Math.sin(q[4]), u = dx * c + dy * s, v = -dx * s + dy * c; return (Math.sqrt((u / q[2]) ** 2 + (v / q[3]) ** 2) - 1) * Math.sqrt(q[2] * q[3]); });
  for (let r = 0; r < rounds; r++) {
    let lambda = 1e-2;
    for (let it = 0; it < 25; it++) {
      const f0 = resid(p, pts), e0 = f0.reduce((s, v) => s + v * v, 0), J = [];
      for (let k = 0; k < 5; k++) { const h = k === 4 ? 1e-4 : 1e-3 * Math.max(1, Math.abs(p[k])); const q = [...p]; q[k] += h; J.push(resid(q, pts).map((v, i) => (v - f0[i]) / h)); }
      const A = [...Array(5)].map((_, i) => [...Array(5)].map((_, j) => J[i].reduce((s, v, n) => s + v * J[j][n], 0)));
      const g = [...Array(5)].map((_, i) => J[i].reduce((s, v, n) => s + v * f0[n], 0));
      let improved = false;
      for (let tries = 0; tries < 6 && !improved; tries++) {
        const top = Math.max(...A.map((row, i) => row[i])), M = A.map((row, i) => row.map((v, j) => v + (i === j ? lambda * Math.max(v, 1e-3 * top) : 0)));
        const step = solve(M, g.map((v) => -v)); if (!step) { lambda *= 10; continue; }
        const q = p.map((v, i) => v + step[i]); if (q[2] <= 2 || q[3] <= 2) { lambda *= 10; continue; }
        const e1 = resid(q, pts).reduce((s, v) => s + v * v, 0);
        if (e1 < e0) { p = q; lambda = Math.max(lambda / 3, 1e-6); improved = true; } else lambda *= 10;
      }
      if (!improved) break;
    }
    if (r < rounds - 1) { const f = resid(p, pts).map(Math.abs); const cut = [...f].sort((a, b) => a - b)[Math.floor(f.length * .8)]; pts = pts.filter((_, i) => f[i] <= Math.max(cut, 1.5)); }
  }
  const f = resid(p, pts); return { ellipse: { cx: p[0], cy: p[1], rx: p[2], ry: p[3], angle: ((p[4] / D) % 180 + 180) % 180 }, rms: Math.sqrt(f.reduce((s, v) => s + v * v, 0) / f.length), kept: pts.length };
}
function solve(M, b) {
  const n = b.length, A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; if (Math.abs(A[piv][c]) < 1e-12) return null; [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; } }
  return A.map((r, i) => r[n] / r[i]);
}

// A smoothed Lab copy of the photo at ≤ maxDim, for the new implementations.
const labCache = new Map();
function labOf(photo, maxDim = 720) {
  const key = photo.path + maxDim;
  if (labCache.has(key)) return labCache.get(key);
  const { full } = pixels(photo), s = Math.min(1, maxDim / Math.max(full.width, full.height));
  const w = Math.max(8, Math.round(full.width * s)), h = Math.max(8, Math.round(full.height * s));
  const ch = [new Float64Array(w * h), new Float64Array(w * h), new Float64Array(w * h)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // area-average downscale
    const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.floor((x + 1) / s)), y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.floor((y + 1) / s));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < Math.min(y1, full.height); yy++) for (let xx = x0; xx < Math.min(x1, full.width); xx++) { const i = (yy * full.width + xx) * 4; r += full.data[i]; g += full.data[i + 1]; b += full.data[i + 2]; n++; }
    const [L, A, B] = lab(r / n, g / n, b / n); ch[0][y * w + x] = L; ch[1][y * w + x] = A; ch[2][y * w + x] = B;
  }
  const out = { w, h, s, ch: ch.map((c) => gaussianBlur(c, w, h, 1.2)) };
  labCache.set(key, out); return out;
}
function lab(r, g, b) {
  const lin = [r, g, b].map((c) => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const X = .4124564 * lin[0] + .3575761 * lin[1] + .1804375 * lin[2], Y = .2126729 * lin[0] + .7151522 * lin[1] + .072175 * lin[2], Z = .0193339 * lin[0] + .119192 * lin[1] + .9503041 * lin[2];
  const f = (v) => (v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116), fx = f(X / .95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labAt(L, x, y) {
  x = Math.max(0, Math.min(L.w - 1.001, x)); y = Math.max(0, Math.min(L.h - 1.001, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * L.w + x0;
  return L.ch.map((c) => (c[i] * (1 - fx) + c[i + 1] * fx) * (1 - fy) + (c[i + L.w] * (1 - fx) + c[i + L.w + 1] * fx) * fy);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const medianColor = (cs) => [0, 1, 2].map((k) => median(cs.map((c) => c[k])));

// ---------------------------------------------------------------- 1. rimfit/v3 — exactly the app's ellipse review, run in Node
export function v3(photo) {
  const { full } = pixels(photo), t0 = Date.now();
  const result = recoverRimEllipseV3(full, { maxRefinementDimension: 384 });
  const proposal = adaptRimFitResult(result, { data: full.data, width: full.width, height: full.height, maxRefinementDimension: 384 });
  const quality = result?.algorithm?.quality ?? {};
  const base = { v3Status: result.status, abstainReasons: quality.abstainReasons ?? [], supportFraction: quality.supportFraction, supportedOctants: quality.supportedOctants };
  if (proposal.status !== 'MAYBE' || !proposal.ellipse) {
    const diag = proposal.diagnostics?.unacceptedDiagnosticEllipse ?? null;
    return { status: 'ABSTAIN', ellipse: null, evidence: { ...base, stage: 'v3', proposalStatus: proposal.status, reason: proposal.reason ?? null, diagnostic: diag ? round(fromApp(diag)) : null, ms: Date.now() - t0 } };
  }
  let refinement;
  try { refinement = refineEllipseWithRimEvidence(full, proposal, { enabled: true }); } catch { refinement = { status: 'ABSTAIN', reason: 'rim-refinement-unavailable' }; }
  const refined = refinement?.status === 'MAYBE' && refinement.ellipse && validateEllipseBounds(full.width, full.height, refinement.ellipse, 0);
  const ellipse = fromApp(refined ? refinement.ellipse : proposal.ellipse);
  // the app only uses the v3 ellipse when the refinement also says MAYBE (usableAutomaticEllipse)
  return { status: refined ? 'MAYBE' : 'ABSTAIN', ellipse: round(ellipse), evidence: { ...base, stage: refined ? 'v3+refinement' : 'v3 (refinement abstained)', refinement: refinement?.status, refinementReason: refinement?.reason ?? null, ms: Date.now() - t0 } };
}

// ---------------------------------------------------------------- 2. rimfit/candidate-circle — the app's circle search, top candidate
const clamp01 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function clampCircleCrop(width, height, crop) {   // upload-ui clampCropSelection with rotation 0
  const minimum = .03, rx = Math.max(minimum, crop.radiusX), ry = Math.max(minimum, crop.radiusY);
  const scale = Math.min(1, .5 / rx, .5 / ry), radiusX = rx * scale, radiusY = ry * scale;
  return { centerX: clamp01(crop.centerX, radiusX, 1 - radiusX), centerY: clamp01(crop.centerY, radiusY, 1 - radiusY), radiusX, radiusY };
}
export function candidateCircle(photo, which = 0) {
  const { full, work } = pixels(photo), t0 = Date.now();
  const rows = findInitialCircleCandidates({ width: work.width, height: work.height, rgba: work.data }, { width: full.width, height: full.height, rgba: full.data });
  if (!rows.length) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'circle-candidates', candidates: 0, ms: Date.now() - t0 } };
  const c = rows[Math.min(which, rows.length - 1)].circle, crop = clampCircleCrop(full.width, full.height, cropForSourceSamples(full.width, full.height, c));
  const r = (crop.radiusX * full.width + crop.radiusY * full.height) / 2;
  return { status: 'MAYBE', ellipse: round({ cx: crop.centerX * full.width, cy: crop.centerY * full.height, rx: r, ry: r, angle: 0 }),
    evidence: { stage: 'circle-candidates', candidates: rows.length, raw: rows.map((x) => round({ cx: x.circle.x, cy: x.circle.y, r: x.circle.radius, score: x.score })), clamped: Math.abs(r - c.radius) > .5, ms: Date.now() - t0 } };
}

// ---------------------------------------------------------------- 3. the app's decision, with its control rounding
export function appQuantize(photo, e) {
  const W = photo.width, H = photo.height, s = Math.min(W, H), q = (v, lo, hi, step) => Math.round((clamp01(v, lo, hi) - lo) / step) * step + lo;
  const a = toApp(e), major = Math.max(W, H) / (2 * s);
  return { cx: q(a.centerX / W, 0, 1, .001) * W, cy: q(a.centerY / H, 0, 1, .001) * H, rx: q(a.radiusX / s, .03, major, .001) * s, ry: q(a.radiusY / s, .03, .5, .001) * s, angle: q(a.axisAngle / D, -90, 90, 1) };
}

// ---------------------------------------------------------------- 4. rimfit/outward-snap — move any seed out to the disc/background boundary
// For 180 rays: estimate the disc colour (inside the seed) and the background colour (outside); walk outward through a
// band and take the last radius whose colour is still closer to the disc than to the background, but only where the
// colour change there is a real edge. Rays that leave the photo before reaching background are dropped.
export function outwardSnap(photo, seed, { lo = .9, hi = 1.18, rays = 180 } = {}) {
  const L = labOf(photo), t0 = Date.now(), s = L.s, e = { cx: seed.cx * s, cy: seed.cy * s, rx: seed.rx * s, ry: seed.ry * s, angle: seed.angle };
  const discC = [], bgC = [];
  for (let k = 0; k < 72; k++) { const th = 2 * Math.PI * k / 72, r = radiusAlong(e, th);
    for (const f of [.72, .8, .86]) discC.push(labAt(L, e.cx + f * r * Math.cos(th), e.cy + f * r * Math.sin(th)));
    for (const f of [1.25, 1.32, 1.4]) { const x = e.cx + f * r * Math.cos(th), y = e.cy + f * r * Math.sin(th); if (x > 1 && y > 1 && x < L.w - 2 && y < L.h - 2) bgC.push(labAt(L, x, y)); } }
  const disc = medianColor(discC), bg = medianColor(bgC), sep = dist(disc, bg);
  const pts = [], strength = [];
  for (let k = 0; k < rays; k++) {
    const th = 2 * Math.PI * k / rays, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(e, th);
    let last = -1, best = 0, leftFrame = false; const prof = [];
    for (let r = r0 * lo; r <= r0 * hi; r += .5) { const x = e.cx + r * ux, y = e.cy + r * uy; if (x < 1 || y < 1 || x > L.w - 2 || y > L.h - 2) { leftFrame = true; break; } prof.push([r, labAt(L, x, y)]); }
    if (leftFrame || prof.length < 8) continue;
    for (let i = 0; i < prof.length; i++) if (dist(prof[i][1], disc) < dist(prof[i][1], bg)) last = i;
    if (last < 0 || last >= prof.length - 2) continue;
    // edge strength at the switch: colour change over ±1.5 px
    const a = prof[Math.max(0, last - 3)][1], b = prof[Math.min(prof.length - 1, last + 3)][1]; best = dist(a, b);
    if (best < Math.max(4, .25 * sep)) continue;
    const r = prof[last][0] + .25; pts.push([e.cx + r * ux, e.cy + r * uy]); strength.push(best);
  }
  if (pts.length < rays * .25) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'outward-snap', rays: pts.length, of: rays, separation: Math.round(sep), ms: Date.now() - t0 } };
  const fit = fitEllipse(pts, e), f = fit.ellipse, out = { cx: f.cx / s, cy: f.cy / s, rx: f.rx / s, ry: f.ry / s, angle: f.angle };
  return { status: 'MAYBE', ellipse: round(out), evidence: { stage: 'outward-snap', rays: pts.length, of: rays, rms: Math.round(fit.rms / s * 10) / 10, separation: Math.round(sep),
    points: pts.filter((_, i) => i % 3 === 0).map(([x, y]) => [Math.round(x / s), Math.round(y / s)]), insideFrame: insideFrame(out, photo.width, photo.height), ms: Date.now() - t0 } };
}

// ---------------------------------------------------------------- 5. rimfit/past-frame — v3 on a padded photo, so a disc touching the edge can still close
export function pastFrame(photo, padFrac = .18) {
  const { full } = pixels(photo), t0 = Date.now(), W = full.width, H = full.height, P = Math.round(padFrac * Math.max(W, H));
  const PW = W + 2 * P, PH = H + 2 * P, data = new Uint8ClampedArray(PW * PH * 4);
  const border = []; for (let x = 0; x < W; x += 4) for (const y of [2, H - 3]) border.push((y * W + x) * 4); for (let y = 0; y < H; y += 4) for (const x of [2, W - 3]) border.push((y * W + x) * 4);
  const fill = [0, 1, 2].map((k) => median(border.map((i) => full.data[i + k])));
  for (let i = 0; i < PW * PH; i++) { data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255; }
  for (let y = 0; y < H; y++) data.set(full.data.subarray(y * W * 4, (y + 1) * W * 4), ((y + P) * PW + P) * 4);
  const padded = { width: PW, height: PH, data };
  const result = recoverRimEllipseV3(padded, { maxRefinementDimension: 384 });
  const proposal = adaptRimFitResult(result, { data, width: PW, height: PH, maxRefinementDimension: 384 });
  const q = result?.algorithm?.quality ?? {};
  if (proposal.status !== 'MAYBE' || !proposal.ellipse) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'past-frame v3', v3Status: result.status, abstainReasons: q.abstainReasons ?? [], pad: P, ms: Date.now() - t0 } };
  let refinement; try { refinement = refineEllipseWithRimEvidence(padded, proposal, { enabled: true }); } catch { refinement = { status: 'ABSTAIN' }; }
  const use = refinement?.status === 'MAYBE' && refinement.ellipse ? refinement.ellipse : proposal.ellipse, e = fromApp(use);
  const out = { ...e, cx: e.cx - P, cy: e.cy - P };
  return { status: 'MAYBE', ellipse: round(out), evidence: { stage: 'past-frame v3', v3Status: result.status, refinement: refinement?.status, pad: P, insideFrame: insideFrame(out, W, H), ms: Date.now() - t0 } };
}

// ---------------------------------------------------------------- 6. rimfit/segment-band — classify disc vs background pixels, then trace the region's edge
// Two colour clusters (k-means in Lab, seeded from inside and outside the seed circle) inside a window around the seed;
// per ray, the outer edge of the longest disc-class run that starts inside the seed; then an ellipse fit.
export function segmentBand(photo, seed) {
  const L = labOf(photo, 480), t0 = Date.now(), s = L.s, e = { cx: seed.cx * s, cy: seed.cy * s, rx: seed.rx * s, ry: seed.ry * s, angle: seed.angle };
  const R = Math.max(e.rx, e.ry), x0 = Math.max(0, Math.floor(e.cx - 1.5 * R)), x1 = Math.min(L.w - 1, Math.ceil(e.cx + 1.5 * R)), y0 = Math.max(0, Math.floor(e.cy - 1.5 * R)), y1 = Math.min(L.h - 1, Math.ceil(e.cy + 1.5 * R));
  const samples = [];
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) samples.push([x, y, labAt(L, x, y)]);
  // k-means with k = 4: two seeded from inside, two from outside, so a rim colour and a flight-plate colour can both count as disc
  const insideOf = (x, y) => { const dx = x - e.cx, dy = y - e.cy, th = Math.atan2(dy, dx); return Math.hypot(dx, dy) / radiusAlong(e, th); };
  const ins = samples.filter(([x, y]) => insideOf(x, y) < .8), outs = samples.filter(([x, y]) => insideOf(x, y) > 1.25);
  if (ins.length < 20 || outs.length < 20) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'segment-band', reason: 'window too small', ms: Date.now() - t0 } };
  let C = [medianColor(ins.map((v) => v[2])), medianColor(ins.filter(([x, y]) => insideOf(x, y) > .6).map((v) => v[2])), medianColor(outs.map((v) => v[2])), medianColor(outs.filter(([x, y]) => insideOf(x, y) > 1.4).map((v) => v[2]))];
  const isDiscCluster = [true, true, false, false];
  for (let it = 0; it < 8; it++) { const acc = C.map(() => [0, 0, 0, 0]); for (const [, , c] of samples) { let b = 0; for (let k = 1; k < 4; k++) if (dist(c, C[k]) < dist(c, C[b])) b = k; acc[b][0] += c[0]; acc[b][1] += c[1]; acc[b][2] += c[2]; acc[b][3]++; } C = C.map((c, k) => (acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c)); }
  const discLike = (c) => { let b = 0; for (let k = 1; k < 4; k++) if (dist(c, C[k]) < dist(c, C[b])) b = k; return isDiscCluster[b]; };
  const pts = [];
  for (let k = 0; k < 180; k++) {
    const th = 2 * Math.PI * k / 180, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(e, th); let edge = -1, miss = 0, left = false;
    for (let r = r0 * .6; r <= r0 * 1.3; r += .5) { const x = e.cx + r * ux, y = e.cy + r * uy; if (x < 1 || y < 1 || x > L.w - 2 || y > L.h - 2) { left = true; break; }
      if (discLike(labAt(L, x, y))) { edge = r; miss = 0; } else if (++miss > 6 && edge > 0) break; }
    if (left || edge < r0 * .75) continue; pts.push([e.cx + edge * ux, e.cy + edge * uy]);
  }
  if (pts.length < 45) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'segment-band', rays: pts.length, of: 180, ms: Date.now() - t0 } };
  const fit = fitEllipse(pts, e), f = fit.ellipse, out = { cx: f.cx / s, cy: f.cy / s, rx: f.rx / s, ry: f.ry / s, angle: f.angle };
  return { status: 'MAYBE', ellipse: round(out), evidence: { stage: 'segment-band', rays: pts.length, of: 180, rms: Math.round(fit.rms / s * 10) / 10, points: pts.filter((_, i) => i % 3 === 0).map(([x, y]) => [Math.round(x / s), Math.round(y / s)]), insideFrame: insideFrame(out, photo.width, photo.height), ms: Date.now() - t0 } };
}

// ---------------------------------------------------------------- 7. referee — boundary evidence for any ellipse, no truth involved
// 128 points round the ellipse: colour difference between 3 px inside and 3 px outside along the normal. Score = median
// contrast × share of in-frame points whose contrast clears 8, × share of the ellipse inside the frame (a fit that
// hangs off the photo is less trustworthy, not disqualified).
export function boundaryScore(photo, ell) {
  if (!ell) return { score: 0 };
  const L = labOf(photo), s = L.s, e = { cx: ell.cx * s, cy: ell.cy * s, rx: ell.rx * s, ry: ell.ry * s, angle: ell.angle }, a = e.angle * D, vals = []; let inFrame = 0;
  for (let i = 0; i < 128; i++) {
    const t = 2 * Math.PI * i / 128, [x, y] = pointAt(e, t); let nx = Math.cos(a) * Math.cos(t) / e.rx - Math.sin(a) * Math.sin(t) / e.ry, ny = Math.sin(a) * Math.cos(t) / e.rx + Math.cos(a) * Math.sin(t) / e.ry; const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
    if (x < 4 || y < 4 || x > L.w - 5 || y > L.h - 5) continue; inFrame++;
    vals.push(dist(labAt(L, x - 3 * nx, y - 3 * ny), labAt(L, x + 3 * nx, y + 3 * ny)));
  }
  if (!vals.length) return { score: 0 };
  const med = median(vals), cover = vals.filter((v) => v >= 8).length / vals.length, frame = inFrame / 128;
  return { score: Math.round(med * cover * frame * 100) / 100, medianContrast: Math.round(med * 10) / 10, coverage: Math.round(cover * 100) / 100, inFrame: Math.round(frame * 100) / 100 };
}

// ---------------------------------------------------------------- 4b. rimfit/outward-edge — the outermost strong edge in a band beyond the seed
// Same rays as outward-snap, but instead of classifying colours it takes the outermost point whose colour change is at
// least half the ray's strongest change. Built for discs whose rim colour differs from the flight plate (white rim on green).
export function outwardEdge(photo, seed, { lo = .97, hi = 1.15, rays = 180 } = {}) {
  const L = labOf(photo), t0 = Date.now(), s = L.s, e = { cx: seed.cx * s, cy: seed.cy * s, rx: seed.rx * s, ry: seed.ry * s, angle: seed.angle };
  const pts = [];
  for (let k = 0; k < rays; k++) {
    const th = 2 * Math.PI * k / rays, ux = Math.cos(th), uy = Math.sin(th), r0 = radiusAlong(e, th), prof = []; let left = false;
    for (let r = r0 * lo; r <= r0 * hi; r += .5) { const x = e.cx + r * ux, y = e.cy + r * uy; if (x < 1 || y < 1 || x > L.w - 2 || y > L.h - 2) { left = true; break; } prof.push([r, labAt(L, x, y)]); }
    if (left || prof.length < 10) continue;
    const d = prof.map((_, i) => (i >= 2 && i < prof.length - 2 ? dist(prof[i - 2][1], prof[i + 2][1]) : 0)), top = Math.max(...d);
    if (top < 6) continue;
    let pick = -1; for (let i = d.length - 3; i >= 2; i--) if (d[i] >= .5 * top && d[i] >= d[i - 1] && d[i] >= d[i + 1]) { pick = i; break; }
    if (pick < 0) continue; const r = prof[pick][0]; pts.push([e.cx + r * ux, e.cy + r * uy]);
  }
  if (pts.length < rays * .25) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'outward-edge', rays: pts.length, of: rays, ms: Date.now() - t0 } };
  const fit = fitEllipse(pts, e), f = fit.ellipse, out = { cx: f.cx / s, cy: f.cy / s, rx: f.rx / s, ry: f.ry / s, angle: f.angle };
  return { status: 'MAYBE', ellipse: round(out), evidence: { stage: 'outward-edge', rays: pts.length, of: rays, rms: Math.round(fit.rms / s * 10) / 10, points: pts.filter((_, i) => i % 3 === 0).map(([x, y]) => [Math.round(x / s), Math.round(y / s)]), insideFrame: insideFrame(out, photo.width, photo.height), ms: Date.now() - t0 } };
}

// ---------------------------------------------------------------- v3 as recorded in Chromium (the app's engine)
const recorded = JSON.parse(fs.readFileSync(`${FIXTURES}/v3-chromium.json`, 'utf8'));
export function v3Chromium(photo) {
  const r = recorded[photo.sha256];
  if (!r) return { status: 'ABSTAIN', ellipse: null, evidence: { stage: 'v3@chromium', reason: 'no recording for this photo' } };
  const base = { stage: 'v3@chromium (recorded)', v3Status: r.v3Status, abstainReasons: r.abstainReasons, refinement: r.refinement, refinementReason: r.refinementReason, ms: r.ms, diagnostic: r.diagnostic ? round(fromApp(r.diagnostic)) : (r.proposalEllipse && !r.ellipse ? round(fromApp(r.proposalEllipse)) : null) };
  return r.ellipse ? { status: 'MAYBE', ellipse: round(fromApp(r.ellipse)), evidence: base } : { status: 'ABSTAIN', ellipse: null, evidence: base };
}
