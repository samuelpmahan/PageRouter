// numbers.html: reads ?c=CODE, fetches /api/numbers/CODE, renders a creator-facing report.
// All values go in through textContent; nothing from the API is parsed as HTML.

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const format = new Intl.NumberFormat('en-US');
const SOURCE_NAMES = { youtube: 'YouTube', other: 'Other websites', direct: 'Direct or unknown' };

const show = (id) => {
  for (const section of ['loading', 'ask', 'error', 'report']) $(section).hidden = section !== id;
};

const el = (tag, attrs = {}, text) => {
  const node = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
};

const dayName = (day, opts = { month: 'short', day: 'numeric' }) =>
  new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

function fail(title, message) {
  $('error-title').textContent = title;
  $('error-message').textContent = message;
  show('error');
}

// A bar path with 4px rounded top corners, anchored flat on the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(value) {
  if (value <= 4) return Math.max(1, value);
  const step = Math.pow(10, Math.floor(Math.log10(value)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

function renderChart(byDay) {
  const host = $('chart');
  host.querySelector('svg')?.remove();
  host.querySelector('.chart-empty')?.remove();
  if (!byDay.some((d) => d.clicks)) {
    host.prepend(el('p', { class: 'subtle chart-empty' }, 'No clicks yet. Once people open the tracked link, each day shows up here as a bar.'));
    return;
  }
  const width = Math.max(280, host.clientWidth);
  const height = width < 500 ? 180 : 240;
  const pad = { top: 12, right: 4, bottom: 26, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...byDay.map((d) => d.clicks)));
  const slot = plotW / Math.max(byDay.length, 1);
  const gap = slot > 6 ? 2 : 1;
  const barW = Math.max(1, Math.min(28, slot - gap));

  const svg = el('svg:svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Clicks per day, ${byDay.length} days, highest ${max === 1 && byDay.every((d) => !d.clicks) ? 0 : Math.max(...byDay.map((d) => d.clicks))}` });

  for (const tick of [0, max / 2, max]) {
    if (tick !== Math.round(tick)) continue;
    const y = pad.top + plotH - (tick / max) * plotH;
    svg.append(el('svg:line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y }));
    svg.append(el('svg:text', { x: pad.left - 8, y: y + 4, 'text-anchor': 'end' }, format.format(tick)));
  }

  const tip = $('tip');
  byDay.forEach((d, i) => {
    const x = pad.left + i * slot + (slot - barW) / 2;
    const h = d.clicks ? Math.max(2, (d.clicks / max) * plotH) : 2;
    const y = pad.top + plotH - h;
    const hit = el('svg:rect', { class: 'hit', x: pad.left + i * slot, y: pad.top, width: slot, height: plotH, tabindex: '-1' });
    const bar = el('svg:path', { class: d.clicks ? 'bar' : 'bar zero', d: barPath(x, y, barW, h) });
    bar.append(el('svg:title', {}, `${dayName(d.day)}: ${d.clicks} clicks`));
    const reveal = () => {
      tip.replaceChildren(document.createTextNode(dayName(d.day, { weekday: 'short', month: 'short', day: 'numeric' }) + '  '), el('b', {}, `${format.format(d.clicks)} ${d.clicks === 1 ? 'click' : 'clicks'}`));
      const scale = host.clientWidth / width;
      const left = Math.min(Math.max((x + barW / 2) * scale, 70), host.clientWidth - 70);
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, (y - 6) * scale) + 'px';
      tip.style.display = 'block';
    };
    hit.addEventListener('pointerenter', reveal);
    hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
    svg.append(hit, bar);
  });

  // Date labels: first, middle and last day, so the span is readable at any width.
  const labelAt = byDay.length > 2 ? [0, Math.floor((byDay.length - 1) / 2), byDay.length - 1] : byDay.map((_, i) => i);
  labelAt.forEach((i, n) => {
    const x = pad.left + i * slot + slot / 2;
    const anchor = labelAt.length > 1 && n === 0 ? 'start' : n === labelAt.length - 1 && labelAt.length > 1 ? 'end' : 'middle';
    const lx = anchor === 'start' ? pad.left : anchor === 'end' ? width - pad.right : x;
    svg.append(el('svg:text', { x: lx, y: height - 6, 'text-anchor': anchor }, dayName(byDay[i].day)));
  });
  host.prepend(svg);
}

function render(n) {
  const days = n.byDay || [];
  const windowTotal = n.windowTotal ?? days.reduce((s, d) => s + d.clicks, 0);
  const youtube = n.bySource?.youtube || 0;
  const best = days.reduce((top, d) => (d.clicks > top.clicks ? d : top), { day: null, clicks: 0 });
  const link = `${location.origin}/c/${n.code}`;

  document.title = `${n.label || n.code} - Link Numbers - thro`;
  $('label').textContent = n.label || `Link ${n.code}`;
  $('link-line').textContent = `${location.host}/c/${n.code} · created ${dayName(n.created.slice(0, 10), { year: 'numeric', month: 'short', day: 'numeric' })}`;
  $('total').textContent = format.format(n.total);
  $('total-caption').textContent = n.total === 1 ? 'click, all time' : 'clicks, all time';
  $('asof').textContent = n.asOf ? `As of ${new Date(n.asOf).toUTCString().replace(' GMT', ' UTC')}` : '';
  $('window-total').textContent = format.format(windowTotal);
  $('youtube-share').textContent = windowTotal ? Math.round((youtube / windowTotal) * 100) + '%' : '0%';
  $('youtube-count').textContent = `${format.format(youtube)} of ${format.format(windowTotal)} clicks`;
  $('best-day').textContent = format.format(best.clicks);
  $('best-day-date').textContent = best.day ? dayName(best.day, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No clicks yet';
  $('daily-average').textContent = days.length ? (windowTotal / days.length).toFixed(1) : '0';
  $('daily-average-span').textContent = `over ${days.length} ${days.length === 1 ? 'day' : 'days'}`;
  $('chart-title').textContent = days.length ? `${dayName(days[0].day)} to ${dayName(days.at(-1).day)}` : 'No days yet';

  $('day-table').replaceChildren(...days.slice().reverse().map((d) => {
    const tr = el('tr');
    tr.append(el('td', {}, dayName(d.day, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })), el('td', {}, format.format(d.clicks)));
    return tr;
  }));

  const sourceTotal = Object.values(n.bySource || {}).reduce((s, v) => s + v, 0);
  $('sources').replaceChildren(...['youtube', 'other', 'direct'].map((key) => {
    const value = n.bySource?.[key] || 0;
    const pct = sourceTotal ? Math.round((value / sourceTotal) * 100) : 0;
    const row = el('div');
    const label = el('div', { class: 'row-label' });
    const count = el('span', {}, format.format(value) + ' ');
    count.append(el('small', {}, `(${pct}%)`));
    label.append(el('span', {}, SOURCE_NAMES[key]), count);
    const track = el('div', { class: 'track' });
    const fill = el('div', { class: 'fill' });
    fill.style.width = pct + '%';
    if (!value) fill.style.minWidth = '0';
    track.append(fill);
    row.append(label, track);
    return row;
  }));

  const refs = n.byReferrer || [];
  $('referrers').replaceChildren(...(refs.length ? refs : [{ host: 'No clicks yet', clicks: null }]).map((r) => {
    const li = el('li');
    li.append(el('span', {}, r.host ?? 'No referring site (direct, apps, or private browsers)'), el('span', {}, r.clicks == null ? '' : format.format(r.clicks)));
    return li;
  }));

  const dl = $('details');
  dl.replaceChildren();
  const add = (term, value, href) => {
    dl.append(el('dt', {}, term));
    const dd = el('dd');
    if (href) dd.append(el('a', { href, rel: 'noopener noreferrer', target: '_blank' }, value));
    else dd.textContent = value;
    dl.append(dd);
  };
  add('Goes to', n.destination, n.destination);
  add('Tracked link', link, link);
  if (n.card && typeof n.card === 'object') {
    const names = { layout: 'Card layout', disc: 'Disc' };
    for (const [key, value] of Object.entries(n.card)) {
      add(names[key] || key.replace(/^\w/, (c) => c.toUpperCase()), typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  } else {
    add('Card', 'Not recorded for this link');
  }

  const summary = [
    `${n.label || 'thro link ' + n.code}: ${format.format(n.total)} clicks all time.`,
    `Last ${days.length} days: ${format.format(windowTotal)} clicks, ${windowTotal ? Math.round((youtube / windowTotal) * 100) : 0}% from YouTube, best day ${format.format(best.clicks)}${best.day ? ' on ' + best.day : ''}.`,
    `Counted by thro: one count per visit, no personal data stored. Live numbers: ${location.href}`,
  ].join('\n');
  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      $('copy-status').textContent = done;
    } catch {
      $('copy-status').textContent = 'Copy was blocked by the browser. Select the text and copy it by hand: ' + text;
    }
  };
  $('copy-summary').onclick = () => copy(summary, 'Summary copied. Paste it into your message.');
  $('copy-link').onclick = () => copy(link, 'Tracked link copied.');

  show('report');
  renderChart(days);
  let pending = 0;
  new ResizeObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => renderChart(days)); }).observe($('chart'));
}

async function main() {
  const code = (new URLSearchParams(location.search).get('c') || '').trim().toLowerCase();
  if (!code) {
    show('ask');
    $('ask-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('ask-code').value.trim().replace(/^.*\/c\//, '');
      if (value) location.search = '?c=' + encodeURIComponent(value);
    });
    return;
  }
  let response;
  try {
    response = await fetch('/api/numbers/' + encodeURIComponent(code), { headers: { Accept: 'application/json' } });
  } catch {
    return fail('Could not reach thro', 'Check your connection and reload the page.');
  }
  const body = await response.json().catch(() => null);
  if (response.status === 404) return fail('No link with that code', `There is no thro link "${code}". Check that the code was copied in full.`);
  if (!response.ok || !body) return fail('Could not load numbers', body?.message || `thro answered ${response.status}. Try again in a minute.`);
  render(body);
}

main();
