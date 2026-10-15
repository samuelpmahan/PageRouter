import { chromium } from 'playwright'; import fs from 'node:fs';
const URL='http://localhost:4173/', OUT='/home/claude/fitlab/cards';
const SAMPLES=[['servo','MVP · Servo'],['anchor','Latitude 64 · Anchor'],['buzzz','Discraft · Buzzz SS']];
const LAYOUTS=[['vertical','u01'],['vertical','u02'],['vertical','u03-front'],['vertical','u03-behind'],['vertical','u04'],['vertical','u05'],['horizontal','b01'],['horizontal','b02'],['horizontal','b03'],['horizontal','b04'],['horizontal','b05']];
const ok=(p)=>p.getByRole('button',{name:'OK',exact:true});
const b=await chromium.launch(); const meta=[];
for (const [key,s] of SAMPLES){
  const p=await b.newPage({viewport:{width:430,height:900},deviceScaleFactor:1});
  await p.goto(URL); await p.locator('button',{hasText:s}).first().click(); await ok(p).waitFor({state:'visible',timeout:60000}); await p.waitForTimeout(800);
  await ok(p).click(); await p.waitForTimeout(1200); await p.getByRole('button',{name:'Save to Today’s Bag ↗'}).click(); await p.waitForTimeout(2000);
  await p.selectOption('#canvas-background','none'); await p.waitForTimeout(500);
  const fonts=await p.evaluate(()=>[...document.fonts].map(f=>f.family+':'+f.status).slice(0,12));
  for (const [o,pr] of LAYOUTS){
    await p.selectOption('#card-orientation',o); await p.waitForTimeout(300); await p.selectOption('#card-preset',pr); await p.waitForTimeout(900);
    const r=await p.evaluate(()=>{const c=document.querySelector('#placement-canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=-1,y1=-1;for(let i=3;i<d.length;i+=4)if(d[i]>0){const q=(i-3)/4,x=q%c.width,y=(q-x)/c.width;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
      const w=x1-x0+1,h=y1-y0+1,s=document.createElement('canvas');s.width=w;s.height=h;s.getContext('2d').drawImage(c,x0,y0,w,h,0,0,w,h);return {url:s.toDataURL('image/png'),w,h,canvas:[c.width,c.height],name:document.querySelector('#card-preset').selectedOptions[0].text};});
    fs.writeFileSync(`${OUT}/${key}-${pr}.png`,Buffer.from(r.url.split(',')[1],'base64')); meta.push({disc:key,layout:pr,w:r.w,h:r.h,canvas:r.canvas,name:r.name});
  }
  meta.push({disc:key,fonts}); await p.close();
}
fs.writeFileSync(`${OUT}/meta.json`,JSON.stringify(meta,null,1)); await b.close();
