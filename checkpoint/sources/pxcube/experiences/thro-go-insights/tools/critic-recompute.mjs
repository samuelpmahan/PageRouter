import fs from 'node:fs';
const rd=p=>JSON.parse(fs.readFileSync(p));
const A=Object.values(rd('data/appearances.json')); const V=rd('data/videos.json'); const R=rd('data/releases.json').rows; const L=rd('data/description_links.json').rows;
const vid=Object.fromEntries(V.videos.map(v=>[v.video_id,v]));
console.log('rows',A.length,'modes',A.reduce((m,a)=>(m[a.mode]=(m[a.mode]||0)+1,m),{}));
const ok=a=>a.mode!=='candidate'&&a.manufacturer!=='unknown'&&!/and /.test(a.manufacturer)&&!/guessed/i.test(a.evidence||'');
for(const ch of Object.keys(V.channels)){
 const rows=A.filter(a=>a.channel_id===ch); const c=rows.filter(ok);
 console.log('\n',V.channels[ch].handle,'rows',rows.length,'counted',c.length);
 const by={};c.forEach(a=>by[a.manufacturer]=(by[a.manufacturer]||0)+1);console.log(by);
 const vids=V.videos.filter(v=>v.channel_id===ch);
 const reach={};for(const b in by)reach[b]=vids.filter(v=>c.some(a=>a.video_id===v.video_id&&a.manufacturer===b)).reduce((s,v)=>s+v.views,0);console.log('reach',reach);
 console.log('ceiling',vids.filter(v=>c.some(a=>a.video_id===v.video_id)).reduce((s,v)=>s+v.views,0),'total',vids.reduce((s,v)=>s+v.views,0));
 const rates=vids.map(v=>c.filter(a=>a.video_id===v.video_id).length/v.duration_seconds*600);console.log('rates',rates.map(x=>x.toFixed(2)),'mean',(rates.reduce((a,b)=>a+b)/5).toFixed(2));
 console.log('pooled rate',(c.length/vids.reduce((s,v)=>s+v.duration_seconds,0)*600).toFixed(2));
 const views=vids.map(v=>v.views);console.log('meanviews',views.reduce((a,b)=>a+b)/5);
 // bootstrap sanity
 let seed=1;const rnd=()=>Math.random();const bs=[];for(let i=0;i<20000;i++){let s=0;for(let j=0;j<5;j++)s+=rates[Math.floor(rnd()*5)];bs.push(s/5)}bs.sort((a,b)=>a-b);console.log('rate CI',bs[500].toFixed(2),bs[19500].toFixed(2));
 const bv=[];for(let i=0;i<20000;i++){let s=0;for(let j=0;j<5;j++)s+=views[Math.floor(rnd()*5)];bv.push(s/5)}bv.sort((a,b)=>a-b);console.log('views CI',bv[500].toFixed(0),bv[19500].toFixed(0));
 // evidence
 const ev={};rows.forEach(a=>{const e=a.evidence;ev[e]=(ev[e]||0)+1});console.log('evidence raw',ev);
 const ex={cand:rows.filter(a=>a.mode==='candidate').length,guessedTS:rows.filter(a=>a.mode!=='candidate'&&/guessed/i.test(a.evidence)).length,unk:rows.filter(a=>a.mode!=='candidate'&&a.manufacturer==='unknown').length};console.log(ex);
 console.log('guessed among candidates',rows.filter(a=>a.mode==='candidate'&&/guessed/i.test(a.evidence)).length);
}
// welch
const rate=ch=>V.videos.filter(v=>v.channel_id===ch).map(v=>A.filter(a=>a.video_id===v.video_id&&ok(a)).length/v.duration_seconds*600);
const [c1,c2]=Object.keys(V.channels);const x=rate(c1),y=rate(c2);const m=a=>a.reduce((s,t)=>s+t)/a.length,vr=a=>{const mm=m(a);return a.reduce((s,t)=>s+(t-mm)**2,0)/(a.length-1)};
const se=Math.sqrt(vr(x)/5+vr(y)/5);console.log('welch diff',m(x)-m(y),'t',(m(x)-m(y))/se,'df',(vr(x)/5+vr(y)/5)**2/((vr(x)/5)**2/4+(vr(y)/5)**2/4));
// modes of all counted
const odd=A.filter(a=>a.mode!=='candidate').map(a=>a.manufacturer);console.log([...new Set(odd)]);
console.log('manufacturers in releases',[...new Set(R.map(r=>r.manufacturer))]);
// release matches for mania
for(const a of A.filter(a=>a.mode!=='candidate')){for(const r of R){if(a.manufacturer===r.manufacturer&&a.mold.split(/[,;]/)[0].trim().toLowerCase().replace(/buzz$/,'buzzz')===r.mold.toLowerCase().replace(/buzz$/,'buzzz')){console.log('MATCH',a.id,a.manufacturer,a.mold,'|',a.mode,a.evidence,'|',vid[a.video_id].published_at,vid[a.video_id].title,'| rel',r.release_date,r.plastic_or_run,r.kind,'ok',ok(a))}}}
// near-miss: same mold name any manufacturer, or mold substring match, for counted rows
for(const a of A.filter(ok)){const mk=a.mold.split(/[,;]/)[0].trim().toLowerCase();const hits=R.filter(r=>r.mold.toLowerCase()===mk&&r.manufacturer!==a.manufacturer);if(hits.length)console.log('XMANUF',a.id,a.manufacturer,a.mold,hits.map(h=>h.manufacturer+' '+h.release_date))}
