// thro/crop/face: when a product photo is shot slightly from above and in front, the disc's side wall shows as a crescent on the
// near side. Argon's rim fit correctly finds the outer silhouette, but that silhouette is the face PLUS the wall, so the flattened
// disc comes out lopsided (Sam's bug report, 26 Oct 01:37: the MVP Control on thro.pages.dev/raredg). This Calculation detects
// that case and, only then, refits to the edge of the face itself.
// Detection: the rim fit's own witness already says it (octant support below 8/8 and/or a squash over 2% on a photo that should be
// face-on); then the face edge must be found all the way round, fit a circle tightly, sit inside the silhouette, and be offset
// from the silhouette centre the way a wall crescent is.
import { register } from './thro-calculations.mjs';
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const radiusAlong = (e, th) => { const a = e.angle * DEG, u = Math.cos(th - a), v = Math.sin(th - a); return 1 / Math.sqrt((u / e.rx) ** 2 + (v / e.ry) ** 2); };

function sampler({ width, height, data }, k) {
  return (x, y) => { // nearest pixel, x/y in photo px
    const i = (Math.min(height - 1, Math.max(0, Math.round(y * k))) * width + Math.min(width - 1, Math.max(0, Math.round(x * k)))) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function fitCircle(P) { // algebraic least squares
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = P.length;
  for (const [x, y] of P) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [sxz, syz, sz];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), col = (j) => M.map((r, i) => r.map((v, c) => c === j ? b[i] : v));
  const A = det(col(0)) / D, B = det(col(1)) / D, C = det(col(2)) / D;
  const cx = A / 2, cy = B / 2; return { cx, cy, r: Math.sqrt(C + cx * cx + cy * cy) };
}
function trimmedCircle(P) {
  let pts = P, c = fitCircle(pts);
  for (let round = 0; round < 3; round++) {
    const res = pts.map(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r)).sort((a, b) => a - b);
    const cut = res[Math.floor(res.length * 0.8)];
    pts = pts.filter(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) <= cut); c = fitCircle(pts);
  }
  const res = P.map(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r)).sort((a, b) => a - b);
  return { ...c, medianResidual: res[Math.floor(res.length / 2)], kept: pts.length };
}

export function findFace({ width, working, ellipse: e, support, squash }) {
  const k = working.width / width, at = sampler(working, k), R = Math.max(e.rx, e.ry);
  const signature = support < 1 || squash > 0.02;
  const pts = [];
  for (let i = 0; i < 120; i++) {
    const th = i / 120 * TAU, r0 = radiusAlong(e, th), c = Math.cos(th), s = Math.sin(th);
    const steps = []; for (let f = 1.04; f >= 0.84; f -= 0.004) steps.push(f);
    const cols = steps.map(f => at(e.cx + f * r0 * c, e.cy + f * r0 * s));
    let inner = -1;
    for (let j = 1; j < cols.length - 3; j++) {
      // a real edge: a big step that stays changed for the next few samples (not a thin stamp line)
      if (dist(cols[j], cols[j - 1]) > 55 && dist(cols[j + 3], cols[j - 1]) > 45) inner = j;
    }
    if (inner >= 0) { const f = steps[inner]; pts.push([e.cx + f * r0 * c, e.cy + f * r0 * s]); }
  }
  const coverage = pts.length / 120;
  if (pts.length < 60) return { applied: false, reason: 'face edge not found all the way round', signature, coverage, face: null, silhouette: e };
  const circ = trimmedCircle(pts), offset = Math.hypot(circ.cx - e.cx, circ.cy - e.cy) / R, relResidual = circ.medianResidual / R, relRadius = circ.r / R;
  const face = { cx: circ.cx, cy: circ.cy, rx: circ.r, ry: circ.r, angle: 0 };
  const wall = signature && relResidual < 0.012 && offset > 0.015 && relRadius > 0.85 && relRadius < 0.995;
  return { applied: wall, reason: wall ? 'side wall visible: refit to the face' : signature ? 'no wall crescent found' : 'face-on photo', signature, coverage, offset, relResidual, relRadius, face: wall ? face : null, silhouette: e };
}

register({
  id: 'thro/crop/face', description: "refit to the disc's face when an angled product photo shows the side wall (otherwise keep the silhouette)",
  calculate: photo => findFace(photo),
  witnessItem: (photo, out, ms) => {
    let insideWorst = 0;
    if (out.face) for (let i = 0; i < 72; i++) { // every face point must sit inside the silhouette
      const th = i / 72 * TAU, x = out.face.cx + out.face.rx * Math.cos(th), y = out.face.cy + out.face.rx * Math.sin(th);
      const ang = Math.atan2(y - out.silhouette.cy, x - out.silhouette.cx), d = Math.hypot(x - out.silhouette.cx, y - out.silhouette.cy);
      insideWorst = Math.max(insideWorst, d / radiusAlong(out.silhouette, ang) - 1);
    }
    return { name: photo.name, ms, ...out, ellipse: out.face ?? out.silhouette, insideWorst, metrics: { maxRelExcursion: insideWorst } };
  },
  guarantees: [
    { id: 'G1_FaceInsideSilhouette', description: 'a refit face never reaches outside the silhouette (within 1%)', check: items => tally(items, x => !x.applied || x.insideWorst <= 0.01, x => x.applied ? `${(x.insideWorst * 100).toFixed(2)}% beyond` : 'not refit') },
    { id: 'G2_TightFaceFit', description: 'a refit face edge fits a circle within 1.2% of the radius', check: items => tally(items, x => !x.applied || x.relResidual < 0.012, x => x.relResidual != null ? `residual ${(x.relResidual * 100).toFixed(2)}%` : 'no face edge') },
    { id: 'G3_OnlyWithSignature', description: "refit only when the rim fit's own witness shows an angled photo", check: items => tally(items, x => !x.applied || x.signature, x => x.reason) },
  ],
});
function tally(items, test, show) {
  const fails = items.filter(x => !test(x));
  return { passed: !fails.length, passCount: items.length - fails.length, totalCount: items.length, metric: items.map(x => `${x.name}: ${show(x)}`).join('; '), failures: fails.map(x => x.name) };
}
