// Headless production ThroCard renderer: the harness that rendered every shop-page card (108 cards, 27 Oct).
// Usage: copy render.html (this folder) into a built thro site (node experiences/thro/build.mjs OUT), serve OUT on :8811
// (python3 -m http.server 8811), put a shops.json with discs {mold, imageFile, vendorFromShop|manufacturer, flightFromShop?}
// at <S>/site/shops.json, then: node render.mjs <S> u02[,b01,...] [shopKey,...]. Writes <S>/cards/<shop>-<video>-<i>-{cut.png,card.png,<preset>.webp}.
// The page entry point is window.renderDisc(disc, presets, accent) in render.html, which runs thro/crop/live -> silhouette -> face ->
// unwarp -> cutout and then vendor/discstudio-cards/thro-adapter.mjs renderDiscStudioCard({disc, photoSrc, flights, preset, revision, appearance}).
import fs from 'node:fs';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const S=process.argv[2], presets=process.argv[3].split(','), only=process.argv[4]?process.argv[4].split(','):null;
const shops=JSON.parse(fs.readFileSync(`${S}/site/shops.json`));
const b=await chromium.launch(), p=await b.newPage(); p.on('pageerror',e=>console.log('pageerror',String(e))); p.on('console',m=>m.type()==='error'&&console.log('console',m.text()));
await p.goto('http://localhost:8811/render.html'); await p.waitForFunction(()=>window.ready,null,{timeout:60000});
fs.mkdirSync(`${S}/cards`,{recursive:true});
const report=[];
for(const [k,o] of Object.entries(shops)) if(!only||only.includes(k)) for(const v of [...o.videos,...o.drops]) for(const [i,d] of v.discs.entries()){
  if(!d.imageFile){ report.push([k,d.mold,'NO IMAGE']); continue; }
  const ACC={icebergtv:'#3fb8c4',premiumdg:'#e3a62f',raredg:'#e0632e'}; const r=await p.evaluate(([d,pr,a])=>window.renderDisc(d,pr,a),[d,presets,o.signal||ACC[k]]);
  const base=`${k}-${(v.id||'drop')}-${i}`;
  fs.writeFileSync(`${S}/cards/${base}-cut.png`,Buffer.from(r.cutout.split(',')[1],'base64'));
  for(const [pr,u] of Object.entries(r.cards)) if(u.startsWith('data:')) fs.writeFileSync(`${S}/cards/${base}-${pr}.webp`,Buffer.from(u.split(',')[1],'base64'));
  if(r.png2x?.startsWith('data:')) fs.writeFileSync(`${S}/cards/${base}-card.png`,Buffer.from(r.png2x.split(',')[1],'base64'));
  d.cardBase=base; d.moldId=r.mold; d.flight=r.flight; d.statuses=r.statuses; d.cropOk=r.cropOk; d.silhouetteRefit=r.silhouetteRefit; d.faceApplied=r.faceApplied;
  report.push([k,d.mold,r.mold,JSON.stringify(r.flight),r.statuses.join(' / '),Object.entries(r.cards).map(([a,u])=>a+':'+(u.startsWith('data:')?'ok':u)).join(' ')]);
}
const prev=fs.existsSync(`${S}/shops-rendered.json`)?JSON.parse(fs.readFileSync(`${S}/shops-rendered.json`)):{}; if(only) for(const k of Object.keys(shops)) if(!only.includes(k)&&prev[k]) shops[k]=prev[k];
fs.writeFileSync(`${S}/shops-rendered.json`,JSON.stringify(shops,null,1));
for(const r of report) console.log(r.join(' | '));
await b.close();
