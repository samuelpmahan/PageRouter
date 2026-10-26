// thro/crop/silhouette: on a plain product-shot background, the disc's outline is where the pixels become background — not the
// strongest colour edge. Argon's rim fit snaps to the strongest band, which on an MVP-style overmold (a light grey rim on a white
// background) is the inner edge of the rim: the card loses the rim (Sam, 26 Oct 09:51: Fission Orbital and Neutron Impulse on
// /anotherround, and the Falk; the FX-4 fit landed on an inner ring and failed). Nothing checked that what lies OUTSIDE the fit is
// background. This Calculation does, and refits outward when it isn't.
// Applies only when the background is uniform (the four corners agree). Then, on 120 rays from the fit's centre, it walks out from
// 0.9 R (up to 3 R, or the image edge) and takes the last sample that is clearly not background before a run of background; those points are the
// silhouette. A face-on photo gets a trimmed circle through them; otherwise the fitted ellipse is scaled to them (same shape/angle).
import { register } from './thro-calculations.mjs';
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const T_DISC = 40, T_BG = 14, RUN = 4;
function fitCircle(P) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = P.length;
  for (const [x, y] of P) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [sxz, syz, sz];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), col = j => M.map((r, i) => r.map((v, c) => c === j ? b[i] : v));
  const cx = det(col(0)) / D / 2, cy = det(col(1)) / D / 2; return { cx, cy, r: Math.sqrt(det(col(2)) / D + cx * cx + cy * cy) };
}
function trimmed(P) {
  let pts = P, c = fitCircle(pts);
  for (let k = 0; k < 3; k++) {
    const res = pts.map(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r)).sort((a, b) => a - b), cut = res[Math.floor(res.length * 0.8)];
    pts = pts.filter(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) <= cut); c = fitCircle(pts);
  }
  const res = P.map(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r)).sort((a, b) => a - b);
  return { ...c, medianResidual: res[Math.floor(res.length / 2)] };
}
const onEllipse = (e, t) => { const a = e.angle * DEG, u = e.rx * Math.cos(t), v = e.ry * Math.sin(t); return [e.cx + u * Math.cos(a) - v * Math.sin(a), e.cy + u * Math.sin(a) + v * Math.cos(a)]; };

export function findSilhouette({ width, height, working, ellipse: e }) {
  const k = working.width / width;
  const px = (x, y) => { const X = Math.round(x * k), Y = Math.round(y * k); if (X < 0 || Y < 0 || X >= working.width || Y >= working.height) return null; const i = (Y * working.width + X) * 4; return [working.data[i], working.data[i + 1], working.data[i + 2]]; };
  const m = Math.max(3, Math.round(Math.min(width, height) * 0.01));
  const corners = [[m, m], [width - 1 - m, m], [m, height - 1 - m], [width - 1 - m, height - 1 - m]].map(([x, y]) => px(x, y));
  const bg = [0, 1, 2].map(c => corners.map(p => p[c]).sort((a, b) => a - b)[1]);
  const d = p => p ? Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) : null;
  const uniform = Math.max(...corners.map(d)) < 18;
  const base = { silhouette: null, fit: e, bg, uniform };
  if (!uniform) return { ...base, applied: false, reason: 'background not uniform: nothing to compare against', ellipse: e, outsideBg: null };
  const steps = []; for (let f = 0.9; f <= 3.0001; f += 0.005) steps.push(f);   // far enough for a fit that landed on an inner ring (FX-4: 1.4x)
  const P = [], ratios = [];
  for (let i = 0; i < 120; i++) {
    const t = i / 120 * TAU, [ex, ey] = onEllipse(e, t), vx = ex - e.cx, vy = ey - e.cy;
    let last = -1, bgRun = 0;
    for (let j = 0; j < steps.length; j++) {
      const v = d(px(e.cx + steps[j] * vx, e.cy + steps[j] * vy));
      if (v == null) { bgRun = RUN; break; }               // left the image: treat as background
      if (v > T_DISC) { last = j; bgRun = 0; } else if (v < T_BG && ++bgRun >= RUN) break;
    }
    if (last >= 0 && bgRun >= RUN) { P.push([e.cx + steps[last] * vx, e.cy + steps[last] * vy]); ratios.push(steps[last]); }
  }
  const outsideBg = ringBg(e, 1.06, px, d);
  if (P.length < 80) return { ...base, applied: false, reason: 'silhouette not found all the way round', ellipse: e, outsideBg, coverage: P.length / 120 };
  ratios.sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)], iqr = ratios[Math.floor(ratios.length * 0.75)] - ratios[Math.floor(ratios.length * 0.25)];
  if (med < 1.03) return { ...base, applied: false, reason: 'fit already reaches the background', ellipse: e, outsideBg, coverage: P.length / 120, ratio: med };
  const c = trimmed(P), R = Math.max(e.rx, e.ry) * med;
  let sil, how;
  if (c.medianResidual / c.r < 0.012) { sil = { cx: c.cx, cy: c.cy, rx: c.r, ry: c.r, angle: 0 }; how = 'circle'; }
  else if (iqr < 0.03) { sil = { ...e, rx: e.rx * med, ry: e.ry * med }; how = 'scaled ellipse'; }
  else return { ...base, applied: false, reason: 'silhouette too irregular to refit (shadow or clutter?)', ellipse: e, outsideBg, coverage: P.length / 120, ratio: med, iqr };
  return { ...base, applied: true, reason: `fit sat inside the disc (outline at ${med.toFixed(2)}x): refit to the silhouette (${how})`, silhouette: sil, ellipse: sil,
    outsideBg: ringBg(sil, 1.06, px, d), outsideBgBefore: outsideBg, coverage: P.length / 120, ratio: med, iqr, relResidual: c.medianResidual / c.r, R };
}
function ringBg(e, f, px, d) { const v = []; for (let i = 0; i < 72; i++) { const [x, y] = onEllipse({ ...e, rx: e.rx * f, ry: e.ry * f }, i / 72 * TAU); const q = d(px(x, y)); if (q != null) v.push(q); } v.sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; }

register({
  id: 'thro/crop/silhouette', description: 'on a plain background, make sure the crop reaches the disc\'s outline (refit outward when the rim fit stopped at an inner edge)',
  calculate: photo => findSilhouette(photo),
  witnessItem: (photo, out, ms) => ({ name: photo.name, ms, ...out, metrics: { maxRelExcursion: out.outsideBg == null ? 0 : out.outsideBg / 255 } }),
  guarantees: [
    { id: 'G1_BackgroundOutside', description: 'on a uniform background, just outside the final crop (1.06x, past a product shot\'s soft shadow) is not disc (median distance below the disc threshold, 40)', check: items => tally(items, x => !x.uniform || x.outsideBg == null || x.outsideBg < T_DISC, x => x.uniform ? `outside ${Math.round(x.outsideBg ?? 0)}${x.applied ? ` (was ${Math.round(x.outsideBgBefore)})` : ''}` : 'no uniform background') },
    { id: 'G2_RefitIsOutward', description: 'a refit only ever grows the crop to the outline (1.03x to 3x), never shrinks it', check: items => tally(items, x => !x.applied || (x.ratio >= 1.03 && x.ratio <= 3), x => x.applied ? `x${x.ratio.toFixed(2)}` : 'kept') },
  ],
});
function tally(items, test, show) { const f = items.filter(x => !test(x)); return { passed: !f.length, passCount: items.length - f.length, totalCount: items.length, metric: items.map(x => `${x.name}: ${show(x)}`).join('; '), failures: f.map(x => x.name) }; }
