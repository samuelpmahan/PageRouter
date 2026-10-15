// Domain pictures for contest D: a waterfall of an attribution and a table of claims.
// Pure functions from plain data to SVG / HTML strings (no kernel state).

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => String(Number(Number(n).toPrecision(6)));
const signed = (n) => (Math.abs(n) < 5e-7 ? '0' : `${n > 0 ? '+' : '−'}${num(Math.abs(n))}`);

const POS = '#2a62c9'; // blue: pushes the prediction up
const NEG = '#d9730d'; // orange: pushes the prediction down
const BASE = '#6b7280';
const PRED = '#5b2c8a';
const OK = '#1f8a4c';
const BAD = '#b0302a';

/**
 * Waterfall: baseline bar, one floating bar per feature (signed, coloured by sign), the prediction bar,
 * and the reconstruction (baseline + all contributions) drawn as a marker on the prediction bar.
 * input: { features, baselinePrediction, contributions, prediction, tolerance, detail?: { input, baseline, coefficients } }
 */
export function waterfallSvg({ features, baselinePrediction, contributions, prediction, tolerance = 1e-6, detail }, { title = '' } = {}) {
  const n = features.length;
  const W = 200 + (n + 2) * 112; const H = 470;
  const L = 70; const R = 110; const T = title ? 56 : 30; const B = 150;
  const running = [baselinePrediction];
  contributions.forEach((c) => running.push(running[running.length - 1] + c));
  const reconstructed = running[running.length - 1];
  const residual = prediction - reconstructed;
  const ok = Math.abs(residual) <= tolerance;
  const hi = Math.max(0, baselinePrediction, prediction, ...running);
  const lo = Math.min(0, baselinePrediction, prediction, ...running);
  const step = hi - lo > 150 ? 50 : hi - lo > 60 ? 20 : 10;
  const top = Math.ceil((hi + (hi - lo) * 0.08) / step) * step; const bot = Math.floor(lo / step) * step;
  const y = (v) => T + ((top - v) / (top - bot)) * (H - T - B);
  const slot = (W - L - R) / (n + 2); const bw = slot * 0.62;
  const cx = (i) => L + slot * (i + 0.5);
  const g = [];
  if (title) g.push(`<text x="14" y="26" class="title">${esc(title)}</text>`);
  for (let v = bot; v <= top; v += step) {
    g.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`);
  }
  g.push(`<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`);
  const bar = (i, a, b, cls, label, labelAbove = true) => {
    const y0 = y(Math.max(a, b)); const h = Math.max(Math.abs(y(a) - y(b)), 2);
    g.push(`<rect x="${cx(i) - bw / 2}" y="${y0}" width="${bw}" height="${h}" class="${cls}"/>`);
    g.push(`<text x="${cx(i)}" y="${labelAbove ? y0 - 6 : y0 + h + 15}" class="val" text-anchor="middle">${esc(label)}</text>`);
  };
  bar(0, 0, baselinePrediction, 'b-base', num(baselinePrediction));
  g.push(`<text x="${cx(0)}" y="${H - B + 20}" class="cat" text-anchor="middle">baseline</text><text x="${cx(0)}" y="${H - B + 35}" class="sub" text-anchor="middle">prediction</text>`);
  contributions.forEach((c, i) => {
    const a = running[i]; const b = running[i + 1];
    const zero = Math.abs(c) < tolerance;
    const cls = zero ? 'b-zero' : c > 0 ? 'b-pos' : 'b-neg';
    bar(i + 1, a, b, cls, signed(c), c >= 0);
    g.push(`<line x1="${cx(i) + bw / 2}" x2="${cx(i + 1) - bw / 2}" y1="${y(a)}" y2="${y(a)}" class="link"/>`);
    g.push(`<text x="${cx(i + 1)}" y="${H - B + 20}" class="cat" text-anchor="middle">${esc(features[i])}</text>`);
    if (detail) {
      g.push(`<text x="${cx(i + 1)}" y="${H - B + 35}" class="sub" text-anchor="middle">x ${num(detail.input[i])}, base ${num(detail.baseline[i])}</text>`);
      g.push(`<text x="${cx(i + 1)}" y="${H - B + 49}" class="sub" text-anchor="middle">b ${num(detail.coefficients[i + 1])}</text>`);
    }
    if (zero) g.push(`<text x="${cx(i + 1)}" y="${y(a) + 18}" class="note" text-anchor="middle">no effect</text>`);
  });
  g.push(`<line x1="${cx(n) + bw / 2}" x2="${cx(n + 1) - bw / 2}" y1="${y(reconstructed)}" y2="${y(reconstructed)}" class="link"/>`);
  bar(n + 1, 0, prediction, 'b-pred', '');
  g.push(`<text x="${cx(n + 1)}" y="${y(prediction) + 18}" class="valw" text-anchor="middle">${num(prediction)}</text>`);
  g.push(`<text x="${cx(n + 1)}" y="${H - B + 20}" class="cat" text-anchor="middle">prediction</text>`);
  // the reconstruction marker: where baseline + all contributions ends, drawn across the prediction bar
  const yr = y(reconstructed);
  g.push(`<line x1="${cx(n + 1) - bw / 2 - 8}" x2="${cx(n + 1) + bw / 2 + 8}" y1="${yr}" y2="${yr}" class="${ok ? 'recon-ok' : 'recon-bad'}"/>`);
  if (!ok) {
    const xg = cx(n + 1) + bw / 2 + 14;
    g.push(`<path d="M${xg},${y(prediction)} V${yr}" class="gap"/><text x="${xg + 6}" y="${(y(prediction) + yr) / 2 + 4}" class="gaptext">gap ${signed(residual)}</text>`);
  }
  // reconstruction line
  const terms = contributions.map((c) => ` ${c < 0 ? '−' : '+'} ${num(Math.abs(c))}`).join('');
  const ty = H - 52;
  g.push(`<text x="14" y="${ty}" class="eq">baseline + contributions = ${num(baselinePrediction)}${esc(terms)} = ${num(reconstructed)}</text>`);
  g.push(`<text x="14" y="${ty + 20}" class="eq">prediction = ${num(prediction)}    residual = ${residual === 0 ? '0' : num(residual)}    tolerance = ${tolerance}</text>`);
  g.push(`<rect x="14" y="${ty + 30}" width="${ok ? 112 : 176}" height="22" rx="4" fill="${ok ? OK : BAD}"/><text x="${ok ? 70 : 102}" y="${ty + 46}" class="chip" text-anchor="middle">${ok ? 'RECONSTRUCTS' : 'DOES NOT RECONSTRUCT'}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<style>
  .title{font:700 16px system-ui,sans-serif;fill:#1b1d1c}
  .grid{stroke:#e2e5e3;stroke-width:1} .zero{stroke:#9aa5a1;stroke-width:1.4}
  .tick{font:11px ui-monospace,monospace;fill:#6b7280}
  .val{font:700 13px ui-monospace,monospace;fill:#1b1d1c} .valw{font:700 13px ui-monospace,monospace;fill:#fff}
  .cat{font:700 12.5px system-ui,sans-serif;fill:#1b1d1c} .sub{font:11px ui-monospace,monospace;fill:#55605c}
  .note{font:italic 11px system-ui,sans-serif;fill:#6b7280}
  .b-base{fill:${BASE}} .b-pos{fill:${POS}} .b-neg{fill:${NEG}} .b-zero{fill:#9aa5a1} .b-pred{fill:${PRED}}
  .link{stroke:#55605c;stroke-width:1;stroke-dasharray:3 3}
  .recon-ok{stroke:${OK};stroke-width:3} .recon-bad{stroke:${BAD};stroke-width:3}
  .gap{stroke:${BAD};stroke-width:2;fill:none} .gaptext{font:700 12px ui-monospace,monospace;fill:${BAD}}
  .eq{font:13px ui-monospace,monospace;fill:#1b1d1c} .chip{font:700 12px system-ui,sans-serif;fill:#fff}
</style>
<rect width="100%" height="100%" fill="#fbfbf9"/>
${g.join('\n')}
</svg>`;
}

/**
 * Claims table. rows: { n, text, kind, honest, accepted, reason, residual, claimHash }.
 * "as intended" is true when an honest claim was accepted or a fabricated one rejected.
 */
export function claimsTableHtml(rows, { title = '' } = {}) {
  const body = rows.map((r) => {
    const intended = r.honest === r.accepted;
    return `<tr class="${r.honest ? '' : 'fab'}">
<td class="n">${r.n}</td>
<td>${esc(r.text)}<div class="json">${esc(JSON.stringify(r.claim))}</div></td>
<td><span class="tag ${r.honest ? 'honest' : 'fabricated'}">${r.honest ? 'honest' : 'FABRICATED'}</span></td>
<td><span class="chip ${r.accepted ? 'acc' : 'rej'}">${r.accepted ? 'ACCEPTED' : 'REJECTED'}</span></td>
<td class="reason">${esc(r.reason)}</td>
<td class="mono">${r.residual === null ? '—' : esc(num(r.residual))}</td>
<td class="mono">${esc(r.claimHash)}</td>
<td class="${intended ? 'yes' : 'no'}">${intended ? '✓' : '✗ WRONG'}</td>
</tr>`;
  }).join('\n');
  const accepted = rows.filter((r) => r.accepted).length;
  return `<!doctype html><meta charset="utf-8"><title>claims</title>
<style>
  body{margin:0;background:#fbfbf9;font:14px system-ui,sans-serif;color:#1b1d1c;padding:16px}
  h1{font-size:16px;margin:0 0 4px} p{margin:0 0 12px;color:#55605c;font-size:13px}
  table{border-collapse:collapse;width:100%}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#55605c;border-bottom:2px solid #9aa5a1;padding:6px 8px}
  td{padding:8px;border-bottom:1px solid #e2e5e3;vertical-align:top}
  tr.fab{background:#fdf3f1}
  .n{font-weight:700;width:24px} .mono{font:12px ui-monospace,monospace} .reason{font:12px ui-monospace,monospace;max-width:420px}
  .json{font:11px ui-monospace,monospace;color:#6b7280;margin-top:3px}
  .tag{font-size:11px;font-weight:700;padding:2px 6px;border-radius:3px}
  .honest{background:#e8eef3;color:#2a3b4a} .fabricated{background:#b0302a;color:#fff}
  .chip{font-size:12px;font-weight:700;padding:3px 8px;border-radius:4px;color:#fff;white-space:nowrap}
  .acc{background:${OK}} .rej{background:${BAD}}
  .yes{color:${OK};font-weight:700} .no{color:${BAD};font-weight:700}
</style>
<h1>${esc(title)}</h1>
<p>${rows.length} claims against one attribution (model fitted by lin.leastSquares; input size 4, distance 6, age 9). ${accepted} accepted, ${rows.length - accepted} rejected. "intended" = honest claim accepted, fabricated claim rejected. Residual = claimed − actual. Last-but-one column: first 8 hex digits are the claim Part's hash (full hash in the verdict's judged pointer).</p>
<table><thead><tr><th>#</th><th>claim</th><th>truth</th><th>verdict</th><th>reason</th><th>residual</th><th>claim Part</th><th>intended</th></tr></thead>
<tbody>
${body}
</tbody></table>`;
}

/**
 * Sweep plot (round 3): predictions against step number, with the expected straight line (start + k * expectedStep)
 * drawn dashed. A run that leaves the line is marked at its first off step.
 * runs: [{ name, values, color, offStep? (1-based step of the first change that is off), reason?, accepted }]
 */
export function sweepPlotSvg({ runs, expectedStep, tolerance = 1e-6 }, { title = '' } = {}) {
  const n = Math.max(...runs.map((r) => r.values.length)) - 1;
  const start = runs[0].values[0];
  const expected = Array.from({ length: n + 1 }, (_, k) => start + k * expectedStep);
  const all = [...expected, ...runs.flatMap((r) => r.values)];
  const hi = Math.max(...all); const lo = Math.min(...all);
  const step = hi - lo > 100 ? 20 : 10;
  const top = Math.ceil((hi + 8) / step) * step; const bot = Math.floor((lo - 8) / step) * step;
  const W = 900; const H = 440 + runs.length * 22; const L = 64; const R = 40; const T = title ? 54 : 24; const B = 140 + runs.length * 22;
  const x = (k) => L + (k / n) * (W - L - R);
  const y = (v) => T + ((top - v) / (top - bot)) * (H - T - B);
  const g = [];
  if (title) g.push(`<text x="14" y="26" class="title">${esc(title)}</text>`);
  for (let v = bot; v <= top; v += step) g.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`);
  for (let k = 0; k <= n; k += 1) g.push(`<text x="${x(k)}" y="${H - B + 18}" class="tick" text-anchor="middle">${k}</text>`);
  g.push(`<text x="${(L + W - R) / 2}" y="${H - B + 38}" class="cat" text-anchor="middle">step k (= tick @k of explain.sweepStep; step 0 is the start)</text>`);
  g.push(`<polyline points="${expected.map((v, k) => `${x(k)},${y(v)}`).join(' ')}" class="expected"/>`);
  runs.forEach((r, ri) => {
    g.push(`<polyline points="${r.values.map((v, k) => `${x(k)},${y(v)}`).join(' ')}" fill="none" stroke="${r.color}" stroke-width="2.5"/>`);
    r.values.forEach((v, k) => {
      const off = Math.abs(v - expected[k]) > tolerance * Math.max(1, Math.abs(v));
      g.push(`<circle cx="${x(k)}" cy="${y(v)}" r="${off ? 5 : 4}" fill="${off ? BAD : r.color}" stroke="#fbfbf9" stroke-width="1.5"/>`);
      if (ri === 0 || off) g.push(`<text x="${x(k) + (k === 0 ? 10 : 0)}" y="${y(v) + (ri === 0 ? (k === 0 ? 20 : -10) : 18)}" class="val" text-anchor="${k === 0 ? 'start' : 'middle'}" fill="${r.color}">${num(v)}</text>`);
    });
    if (r.offStep) {
      const xa = x(r.offStep); const ya = y(r.values[r.offStep]);
      g.push(`<path d="M${x(r.offStep - 1)},${y(r.values[r.offStep - 1])} L${xa},${ya}" stroke="${BAD}" stroke-width="3.5" fill="none"/>`);
      g.push(`<text x="${xa + 10}" y="${ya - 8}" class="gaptext">step ${r.offStep}: ${signed(r.values[r.offStep] - r.values[r.offStep - 1])}, expected ${signed(expectedStep)}</text>`);
    }
    const ly = H - B + 100 + ri * 24;
    g.push(`<rect x="14" y="${ly - 12}" width="14" height="14" fill="${r.color}"/>`);
    g.push(`<rect x="36" y="${ly - 14}" width="156" height="20" rx="4" fill="${r.accepted ? OK : BAD}"/><text x="114" y="${ly}" class="chip" text-anchor="middle">${r.accepted ? 'CONSTANT STEP ✓' : 'NOT CONSTANT ✕'}</text><text x="204" y="${ly}" class="eq">${esc(r.name)}</text>`);
  });
  g.push(`<line x1="14" x2="28" y1="${H - B + 64}" y2="${H - B + 64}" class="expected"/><text x="36" y="${H - B + 68}" class="eq">dashed: expected ${num(start)} + k·${num(expectedStep)} (a run on the line hides it)</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<style>
  .title{font:700 16px system-ui,sans-serif;fill:#1b1d1c}
  .grid{stroke:#e2e5e3;stroke-width:1} .tick{font:11px ui-monospace,monospace;fill:#6b7280}
  .val{font:700 12px ui-monospace,monospace} .cat{font:700 12.5px system-ui,sans-serif;fill:#1b1d1c}
  .note{font:italic 12px system-ui,sans-serif;fill:#55605c}
  .expected{fill:none;stroke:#55605c;stroke-width:1.5;stroke-dasharray:6 5}
  .gaptext{font:700 12px ui-monospace,monospace;fill:${BAD}}
  .eq{font:13px ui-monospace,monospace;fill:#1b1d1c} .chip{font:700 12px system-ui,sans-serif;fill:#fff}
</style>
<rect width="100%" height="100%" fill="#fbfbf9"/>
${g.join('\n')}
</svg>`;
}

/**
 * Lineage table (round 3): for each input of a check, the chain of recorded calls it came from, outermost first.
 * rows: [{ port, value, chain: [{ run, call, contract, slot, port }] }]
 */
export function lineageHtml(rows, { title = '', note = '' } = {}) {
  const body = rows.map((r) => `<tr><td class="mono">${esc(r.port)}</td><td class="mono">${esc(r.value)}</td><td>${r.chain.map((c, i) => `<span class="step${i === r.chain.length - 1 ? ' leaf' : ''}">run ${c.run} · #${c.call} ${esc(c.contract)}${c.slot ? `<b>#${esc(c.slot)}</b>` : ''}<i>.${esc(c.port)}</i></span>`).join('<span class="arr">computed from</span>')}</td></tr>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>lineage</title>
<style>
  body{margin:0;background:#fbfbf9;font:14px system-ui,sans-serif;color:#1b1d1c;padding:16px}
  h1{font-size:16px;margin:0 0 4px} p{margin:0 0 12px;color:#55605c;font-size:13px;max-width:900px}
  table{border-collapse:collapse;width:100%}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#55605c;border-bottom:2px solid #9aa5a1;padding:6px 8px}
  td{padding:8px;border-bottom:1px solid #e2e5e3;vertical-align:top}
  .mono{font:12px ui-monospace,monospace}
  .step{display:inline-block;font:12px ui-monospace,monospace;background:#e8eef3;border-radius:4px;padding:3px 7px;margin:2px 0}
  .step b{color:#5b2c8a} .step i{color:#2a62c9;font-style:normal} .leaf{background:#1f8a4c;color:#fff} .leaf b,.leaf i{color:#fff}
  .arr{font-size:11px;color:#6b7280;margin:0 8px}
</style>
<h1>${esc(title)}</h1><p>${esc(note)}</p>
<table><thead><tr><th>input of the check</th><th>value</th><th>recorded calls it came from (outermost → the call that computed it)</th></tr></thead><tbody>
${body}
</tbody></table>`;
}
