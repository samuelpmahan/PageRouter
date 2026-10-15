// Domain pictures for contest F: Gantt chart, per-tick count lines, allocation score matrix.
// Everything is derived from the event log / counts / part values of a real run; nothing is hard-coded.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Reference palette (dataviz skill): categorical slots 1-4, light / dark steps. Streams A,B,C take slots 1-3.
export const CSS = `
:root{color-scheme:light;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#8a8984;--grid:#e6e5e1;--axis:#bdbcb6;
  --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--hatch:#d9d8d3;--bar-ink:#0b0b0b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8d8c85;--grid:#2f2f2d;--axis:#4a4a47;
  --s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--hatch:#3a3a37;--bar-ink:#0b0b0b}}
:root[data-theme="dark"]{color-scheme:dark;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8d8c85;--grid:#2f2f2d;--axis:#4a4a47;
  --s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--hatch:#3a3a37;--bar-ink:#0b0b0b}
body{margin:0;background:var(--surface);color:var(--ink);font:13px system-ui,sans-serif}
svg text{font-family:system-ui,sans-serif;fill:var(--ink)}
.mono{font-family:ui-monospace,monospace}
.sec{margin:0 0 22px}
`;

export const pageHtml = (sections, title = 'f-agents') => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${sections.map((s) => `<div class="sec">${s}</div>`).join('')}</body></html>`;

const STREAM_VAR = { A: 'var(--s1)', B: 'var(--s2)', C: 'var(--s3)' };
const KIND_RANK = { strong: 0, helper: 1, orchestrator: 2 };

/** Pair events into work bars, integration bars and reveal markers. */
export function intervals(events) {
  const open = new Map(); const work = []; const integ = []; const iopen = new Map(); const completes = new Map(); const reveals = new Map();
  for (const e of events) {
    if (e.kind === 'assign') open.set(e.task, e);
    else if (e.kind === 'complete') { const a = open.get(e.task); work.push({ task: e.task, agent: a.agent, from: a.t, to: e.t, score: a.score }); completes.set(e.task, e); }
    else if (e.kind === 'integrateStart') iopen.set(e.task, e.t);
    else if (e.kind === 'integrated') integ.push({ task: e.task, from: iopen.get(e.task), to: e.t });
    else if (e.kind === 'reveal') { const k = `${e.t}|${e.by}`; if (!reveals.has(k)) reveals.set(k, { t: e.t, by: e.by, tasks: [] }); reveals.get(k).tasks.push(e.task); }
  }
  const marks = [...reveals.values()].map((r) => ({ ...r, agent: completes.get(r.by).agent }));
  return { work, integ, marks };
}

/** One row per agent, bars per task coloured by stream, tick axis labelled, diamonds where tasks were revealed. */
export function ganttSvg({ events, agents, streamOf, title, ppt = 16, width = null }) {
  const { work, integ, marks } = intervals(events);
  const end = Math.max(...work.map((b) => b.to), ...integ.map((b) => b.to)) + 1;
  const rows = [...agents].sort((x, y) => KIND_RANK[x.kind] - KIND_RANK[y.kind] || (x.id < y.id ? -1 : 1));
  const L = 150; const top = 70; const rowH = 30; const W = L + end * ppt + 118;
  const H = top + (rows.length + 1) * rowH + 78;
  const rowOf = new Map(rows.map((r, i) => [r.id, i]));
  const x = (t) => L + t * ppt;
  const out = [];
  out.push(`<text x="14" y="24" font-size="16" font-weight="700">${esc(title)}</text>`);
  // legend: stream colours + marker meaning
  let lx = 14;
  for (const s of ['A', 'B', 'C']) { out.push(`<rect x="${lx}" y="38" width="14" height="10" rx="2" fill="${STREAM_VAR[s]}"/><text x="${lx + 19}" y="47" font-size="12" fill="var(--ink2)">stream ${s}</text>`); lx += 84; }
  out.push(`<rect x="${lx}" y="38" width="14" height="10" rx="2" fill="url(#hatchF)" stroke="var(--axis)"/><text x="${lx + 19}" y="47" font-size="12" fill="var(--ink2)">integration</text>`); lx += 100;
  out.push(`<path d="M${lx + 6},37 l5,5 l-5,5 l-5,-5 z" fill="var(--ink)"/><text x="${lx + 17}" y="47" font-size="12" fill="var(--ink2)">tasks revealed by that completion</text>`);
  // grid + axis
  for (let t = 0; t <= end; t += 1) {
    const major = t % 5 === 0;
    out.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${top + (rows.length + 1) * rowH}" stroke="${major ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>`);
  }
  const axisY = top + (rows.length + 1) * rowH;
  out.push(`<line x1="${L}" x2="${x(end)}" y1="${axisY}" y2="${axisY}" stroke="var(--axis)"/>`);
  for (let t = 0; t <= end; t += 1) {
    if (t % 5 === 0 || end <= 40) out.push(`<text x="${x(t)}" y="${axisY + 16}" font-size="11" text-anchor="middle" fill="var(--ink2)">${t}</text>`);
  }
  out.push(`<text x="${x(end / 2)}" y="${axisY + 36}" font-size="12" text-anchor="middle" fill="var(--ink2)">tick (a bar from t to t' means assigned at t, completed at t')</text>`);
  // row labels
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    out.push(`<text x="14" y="${y + 20}" font-size="12" class="mono">${esc(r.id)}</text><text x="40" y="${y + 20}" font-size="11" fill="var(--ink2)">${esc(r.kind)} ${esc(r.stream)}</text>`);
    out.push(`<line x1="14" x2="${x(end)}" y1="${y + rowH}" y2="${y + rowH}" stroke="var(--grid)"/>`);
  });
  const iy = top + rows.length * rowH;
  out.push(`<text x="14" y="${iy + 20}" font-size="12" class="mono">integrator</text>`);
  // busy ticks per row (sum of bar lengths), right margin; derived from the same intervals
  out.push(`<text x="${x(end) + 10}" y="${top - 12}" font-size="11" style="fill:var(--ink2)">busy ticks</text>`);
  rows.forEach((r, i) => {
    const busy = work.filter((b) => b.agent === r.id).reduce((n, b) => n + b.to - b.from, 0);
    out.push(`<text x="${x(end) + 10}" y="${top + i * rowH + 20}" font-size="12" class="mono" style="fill:${busy ? 'var(--ink)' : 'var(--muted)'}">${busy}</text>`);
  });
  const ibusy = integ.reduce((n, b) => n + b.to - b.from, 0);
  const sorted = [...integ].sort((a, b) => a.from - b.from);
  const gaps = sorted.slice(1).filter((b, i) => b.from > sorted[i].to).length;
  out.push(`<text x="${x(end) + 10}" y="${iy + 20}" font-size="12" class="mono">${ibusy}</text>`);
  out.push(`<text x="${x(sorted[0].from)}" y="${axisY + 58}" font-size="12" font-weight="600">integrator busy ${sorted[0].from} to ${sorted.at(-1).to}: ${ibusy} ticks, ${gaps === 0 ? 'no idle gap' : `${gaps} idle gaps`}</text>`);
  // bars
  for (const b of work) {
    const y = top + rowOf.get(b.agent) * rowH + 10;
    const s = streamOf(b.task); const w = (b.to - b.from) * ppt - 2;
    out.push(`<g><title>${esc(`${b.task} (stream ${s}) on ${b.agent}: ticks ${b.from} to ${b.to}`)}</title><rect x="${x(b.from) + 1}" y="${y}" width="${w}" height="16" rx="3" fill="${STREAM_VAR[s]}"/>`
      + `<text x="${x(b.from) + 1 + w / 2}" y="${y + 12}" font-size="10.5" text-anchor="middle" class="mono" style="fill:var(--bar-ink)">${esc(b.task)}</text></g>`);
  }
  for (const b of integ) {
    const w = (b.to - b.from) * ppt - 2; const y = iy + 10;
    out.push(`<g><title>${esc(`integrate ${b.task}: ticks ${b.from} to ${b.to}`)}</title><rect x="${x(b.from) + 1}" y="${y}" width="${w}" height="16" rx="3" fill="url(#hatchF)" stroke="${STREAM_VAR[streamOf(b.task)]}" stroke-width="2"/>`
      + `<text x="${x(b.from) + 1 + w / 2}" y="${y + 12}" font-size="10.5" text-anchor="middle" class="mono">${esc(b.task)}</text></g>`);
  }
  for (const m of marks) {
    const y = top + rowOf.get(m.agent) * rowH; const cx = x(m.t);
    out.push(`<g><title>${esc(`${m.by} completed at ${m.t} and revealed ${m.tasks.join(', ')}`)}</title><path d="M${cx},${y + 1} l4.5,4.5 l-4.5,4.5 l-4.5,-4.5 z" fill="var(--ink)" stroke="var(--surface)" stroke-width="1.5"/>`
      + `<text x="${cx + 7}" y="${y + 8}" font-size="9.5" class="mono" fill="var(--ink2)" style="fill:var(--ink2)">+${esc(m.tasks.join(' +'))}</text></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(W, width ?? 0)} ${H}" width="${Math.max(W, width ?? 0)}" height="${H}"><defs><pattern id="hatchF" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" stroke-width="3"/></pattern></defs>${out.join('')}</svg>`;
}

/** Side-by-side step lines of ready / running / done-unintegrated / integrated per tick; shared axes. */
export function countsSvg({ panels, title }) {
  const SER = [['ready', 'ready', 'var(--s1)'], ['running', 'running', 'var(--s2)'], ['done', 'done, unintegrated', 'var(--s3)'], ['integrated', 'integrated', 'var(--s4)']];
  const maxT = Math.max(...panels.map((p) => p.series.length));
  const maxY = Math.max(...panels.flatMap((p) => p.series.flatMap((c) => [c.ready, c.running, c.done, c.integrated, p.capacity ?? 0])));
  const pw = 560; const ph = 300; const gx = 70; const top = 96; const pad = 40;
  const W = panels.length * (pw + gx) + pad; const H = top + ph + 70;
  const out = [`<text x="14" y="24" font-size="16" font-weight="700">${esc(title)}</text>`];
  let lx = 14;
  for (const [, label, col] of SER) { out.push(`<line x1="${lx}" x2="${lx + 18}" y1="43" y2="43" stroke="${col}" stroke-width="2.5"/><text x="${lx + 24}" y="47" font-size="12" fill="var(--ink2)" style="fill:var(--ink2)">${label}</text>`); lx += 24 + label.length * 7 + 28; }
  out.push(`<line x1="${lx}" x2="${lx + 18}" y1="43" y2="43" stroke="var(--ink2)" stroke-dasharray="4 3"/><text x="${lx + 24}" y="47" font-size="12" style="fill:var(--ink2)">capacity N (limit on done, unintegrated)</text>`);
  panels.forEach((p, k) => {
    const ox = 14 + 36 + k * (pw + gx); const sx = (t) => ox + (t / (maxT)) * pw; const sy = (v) => top + ph - (v / maxY) * ph;
    out.push(`<text x="${ox}" y="${top - 20}" font-size="14" font-weight="600">${esc(p.label)}  <tspan font-weight="400" style="fill:var(--ink2)">finished after ${p.series.length} ticks, peak done-unintegrated ${Math.max(...p.series.map((c) => c.done))}</tspan></text>`);
    for (let v = 0; v <= maxY; v += 1) {
      out.push(`<line x1="${ox}" x2="${ox + pw}" y1="${sy(v)}" y2="${sy(v)}" stroke="${v === 0 ? 'var(--axis)' : 'var(--grid)'}"/>`);
      out.push(`<text x="${ox - 8}" y="${sy(v) + 4}" font-size="11" text-anchor="end" style="fill:var(--ink2)">${v}</text>`);
    }
    for (let t = 0; t <= maxT; t += 5) {
      out.push(`<line x1="${sx(t)}" x2="${sx(t)}" y1="${top + ph}" y2="${top + ph + 4}" stroke="var(--axis)"/><text x="${sx(t)}" y="${top + ph + 18}" font-size="11" text-anchor="middle" style="fill:var(--ink2)">${t}</text>`);
    }
    out.push(`<text x="${ox + pw / 2}" y="${top + ph + 40}" font-size="12" text-anchor="middle" style="fill:var(--ink2)">tick</text>`);
    if (k === 0) out.push(`<text x="${ox - 30}" y="${top + ph / 2}" font-size="12" text-anchor="middle" transform="rotate(-90 ${ox - 30} ${top + ph / 2})" style="fill:var(--ink2)">tasks</text>`);
    if (p.capacity) out.push(`<line x1="${ox}" x2="${ox + pw}" y1="${sy(p.capacity)}" y2="${sy(p.capacity)}" stroke="var(--ink2)" stroke-dasharray="4 3"/><text x="${ox + pw - 4}" y="${sy(p.capacity) - 5}" font-size="11" text-anchor="end" style="fill:var(--ink2)">N = ${p.capacity}</text>`);
    for (const [key, label, col] of SER) {
      // step-after line: value at tick t holds until tick t+1
      let d = '';
      p.series.forEach((c, t) => { d += `${t === 0 ? 'M' : 'L'}${sx(t)},${sy(c[key])} L${sx(t + 1)},${sy(c[key])} `; });
      out.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="2.25" stroke-linejoin="round"><title>${label}</title></path>`);
    }
    // direct labels at the right end of the integrated line and at the running/ready peaks would collide; label integrated only
    const last = p.series[p.series.length - 1];
    out.push(`<text x="${sx(p.series.length) - 4}" y="${sy(last.integrated) - 7}" font-size="11" text-anchor="end" style="fill:var(--ink2)">integrated ${last.integrated}</text>`);
    p.series.forEach((c, t) => out.push(`<rect x="${sx(t)}" y="${top}" width="${pw / maxT}" height="${ph}" fill="transparent"><title>${esc(`tick ${t}: ready ${c.ready}, running ${c.running}, done ${c.done}, integrated ${c.integrated}`)}</title></rect>`));
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${out.join('')}</svg>`;
}

/** The allocation decision as a score matrix: rows = ready tasks, columns = idle agents, ringed = chosen. */
export function decisionSvg({ idle, ready, scores, assignments, constraints, title }) {
  const cw = 64; const rh = 26; const L = 196; const top = 112; const R = 190;
  const W = Math.max(L + idle.length * cw + R, 960); const H = top + ready.length * rh + 40;
  const chosen = new Map(assignments.map((a) => [`${a.task}|${a.agent}`, a]));
  const asg = new Map(assignments.map((a) => [a.task, a]));
  const out = [`<text x="14" y="24" font-size="16" font-weight="700">${esc(title)}</text>`];
  out.push(`<text x="14" y="46" font-size="12" style="fill:var(--ink2)" class="mono">constraints: maxStarts ${constraints.maxStarts} (demand), orchestrators busy ${constraints.orchestratorsBusy} of ${constraints.maxOrchestratorsBusy}; one task per agent; strong agents only on their own stream</text>`);
  out.push(`<text x="14" y="64" font-size="12" style="fill:var(--ink2)">cell = score(task on agent) = 1000 - 300 if orchestrator + 100 if stream matches + 10 if strong + task cost; grey n/a = strong agent off its stream</text>`);
  idle.forEach((a, j) => {
    const cx = L + j * cw + cw / 2;
    out.push(`<text x="${cx}" y="${top - 30}" font-size="12" text-anchor="middle" class="mono">${esc(a.id)}</text><text x="${cx}" y="${top - 17}" font-size="10" text-anchor="middle" style="fill:var(--ink2)">${esc(a.kind)}</text>`);
    out.push(`<rect x="${cx - 9}" y="${top - 12}" width="18" height="6" rx="2" fill="${STREAM_VAR[a.stream]}"/>`);
  });
  out.push(`<text x="${L + idle.length * cw + 12}" y="${top - 17}" font-size="12" font-weight="600">decision</text>`);
  ready.forEach((t, i) => {
    const y = top + i * rh;
    out.push(`<rect x="14" y="${y + 6}" width="14" height="12" rx="2" fill="${STREAM_VAR[t.stream]}"/><text x="36" y="${y + 17}" font-size="12" class="mono">${esc(t.id)}</text><text x="68" y="${y + 17}" font-size="11" style="fill:var(--ink2)">stream ${t.stream}, cost ${t.cost}</text>`);
    idle.forEach((a, j) => {
      const v = scores[i][j]; const cx = L + j * cw; const pick = chosen.has(`${t.id}|${a.id}`);
      out.push(`<rect x="${cx + 2}" y="${y + 2}" width="${cw - 4}" height="${rh - 4}" rx="3" fill="${pick ? 'var(--s4)' : 'none'}" fill-opacity="${pick ? 0.38 : 0}" stroke="${pick ? 'var(--ink)' : 'var(--grid)'}" stroke-width="${pick ? 2.5 : 1}"/>`);
      out.push(`<text x="${cx + cw / 2}" y="${y + 17}" font-size="11.5" text-anchor="middle" class="mono" style="fill:${v === null ? 'var(--muted)' : 'var(--ink)'};font-weight:${pick ? 700 : 400}">${v === null ? 'n/a' : v}</text>`);
    });
    const a = asg.get(t.id);
    out.push(`<text x="${L + idle.length * cw + 12}" y="${y + 17}" font-size="12" class="mono" style="fill:${a ? 'var(--ink)' : 'var(--muted)'}">${a ? `${esc(t.id)} -> ${esc(a.agent)}  (${a.score})` : 'not started'}</text>`);
  });
  const total = assignments.reduce((s, a) => s + a.score, 0);
  out.push(`<text x="14" y="${top + ready.length * rh + 26}" font-size="12.5" font-weight="600">${assignments.length} of ${ready.length} ready tasks started, total score ${total}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${out.join('')}</svg>`;
}
