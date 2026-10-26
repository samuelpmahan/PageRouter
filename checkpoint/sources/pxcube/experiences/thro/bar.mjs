// thro · the bar (Brook thro #27, Subagent 2): renderThroBar for every disc on the shelf, over the tee shot, with its WitnessReport.
// The shelf is the discs just cropped on photos.html (if any in this tab), otherwise the three prepared samples.
import { renderThroBar } from './thro-bar.mjs';
import { loadBag } from './photo-bag.mjs';
import { loadFixture } from './prepared-fixture.mjs';
const V = '?v=28ac2b39fab85255';
const molds = await import(`./vendor/discstudio-cards/mold-library.js${V}`);
const $ = id => document.getElementById(id);
const image = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error(src)); i.src = src; });
let shelf; try { shelf = loadBag(); } catch { shelf = await loadFixture(); }
const tee = await image('./assets/tee-shot-original.jpg');
window.__barReports = [];
for (const d of shelf) {
  const fig = document.createElement('figure'), c = Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 }), cap = document.createElement('figcaption');
  cap.innerHTML = `<b>${d.manufacturer} ${d.name}</b><span>drawing…</span>`; fig.append(c, cap); $('main').append(fig);
  const base = molds.moldRecord(d.mold)?.flight ?? [], flights = ['speed', 'glide', 'turn', 'fade'].map((f, i) => d.flightOverrides?.[f] ?? base[i] ?? null);
  try {
    const { frame, report } = await renderThroBar({ disc: d, flights, cutoutSrc: d.depiction.src });
    const x = c.getContext('2d'), s = Math.max(1920 / tee.width, 1080 / tee.height);
    x.drawImage(tee, (1920 - tee.width * s) / 2, (1080 - tee.height * s) / 2, tee.width * s, tee.height * s);
    x.drawImage(await createImageBitmap(frame.png), 0, 0);
    window.__barReports.push(report);
    cap.innerHTML = `<b>${d.manufacturer} ${d.name} · ${flights.join(' | ')}</b><span>thro/card/bar <span class="ok">${report.selfGuaranteeStatus}</span></span>` +
      Object.values(report.guarantees).map(g => `<span title="${g.description}">${g.id} · ${g.metric.replace(`${d.name} `, '')}</span>`).join('');
  } catch (error) { cap.innerHTML += `<span>could not draw: ${error.message}</span>`; console.error(error); }
}
$('main').setAttribute('aria-busy', 'false');
