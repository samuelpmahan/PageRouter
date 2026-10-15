# Scores world.mjs's receipts against the hand-traced truth, and checks the "app 6.6.0" selection
# against the fits measured in the real page (fixtures/app-browser-results.json).
import json, math, os, numpy as np, cv2
from collections import Counter, defaultdict
HERE=os.path.dirname(os.path.abspath(__file__)); FIX=os.path.join(HERE,'fixtures')
WORK=os.environ.get('RIMFIT_WORK',os.path.join(HERE,'.work'))
D=json.load(open(os.path.join(WORK,'receipts.json'))); C={c['name']:c for c in json.load(open(os.path.join(FIX,'cases.json')))}
def mask(f,W,H,k,pad):
    m=np.zeros((int((H+2*pad)*k)+2,int((W+2*pad)*k)+2),np.uint8)
    cv2.ellipse(m,(((f['cx']+pad)*k,(f['cy']+pad)*k),(2*abs(f['rx'])*k,2*abs(f['ry'])*k),f['angle']),1,-1); return m.astype(bool)
rows=[]
for r in D['receipts']:
    c=C[r['photo']]; t=c['truth']; W,H=c['width'],c['height']; e=r['ellipse']
    row=dict(photo=r['photo'],selection=r['selection'],status=r['status'],ellipse=e,stage=r['evidence'].get('stage'),evidence=r['evidence'],ms=r.get('ms'))
    if e:
        k=500/max(W,H); pad=int(.35*max(W,H)); mt=mask(t,W,H,k,pad); ma=mask(e,W,H,k,pad)
        u=(mt|ma).sum(); row.update(iou=round(float((mt&ma).sum()/u),4),cut=round(float((mt&~ma).sum()/mt.sum()),4),bleed=round(float((ma&~mt).sum()/ma.sum()),4),
            radius_err=round(((abs(e['rx'])+abs(e['ry']))/2-(t['rx']+t['ry'])/2)/((t['rx']+t['ry'])/2),4))
        row['grade']='good' if row['iou']>=.97 and row['cut']<=.02 and row['bleed']<=.02 else 'usable' if row['iou']>=.93 else 'bad'
        if r['status']!='MAYBE': row['grade']='abstain'  # the app would not use an abstained shape; its metrics are kept for inspection
    else: row.update(iou=None,cut=None,bleed=None,grade='abstain')
    rows.append(row)
json.dump(rows,open(os.path.join(WORK,'scores.json'),'w'),indent=1)
# parity: app selection vs browser measurement (first run)
br={r['name']:r for r in json.load(open(os.path.join(FIX,'app-browser-results.json')))}
worst=0
for r in rows:
    if r['selection']!='app 6.6.0 (today)': continue
    b=br[r['photo']]; c=C[r['photo']]; W,H=c['width'],c['height']; s=min(W,H)
    if b['choice']=='ellipse': g=b['ellipse']; be=dict(cx=g['cx']*W,cy=g['cy']*H,rx=g['rx']*s,ry=g['ry']*s)
    else: g=b['circle']; rr=(g['rx']*W+g['ry']*H)/2; be=dict(cx=g['cx']*W,cy=g['cy']*H,rx=rr,ry=rr)
    e=r['ellipse']; d=max(abs(e['cx']-be['cx']),abs(e['cy']-be['cy']),abs(max(e['rx'],e['ry'])-max(be['rx'],be['ry'])),abs(min(e['rx'],e['ry'])-min(be['rx'],be['ry'])))
    worst=max(worst,d)
    if d>1.5: print('PARITY MISS',r['photo'],round(d,2),b['choice'])
print('parity worst difference px:',round(worst,3))
by=defaultdict(Counter)
for r in rows: by[r['selection']][r['grade']]+=1
for s,c in by.items(): print(f"{s:38s} good {c['good']:2d}  usable {c['usable']:2d}  bad {c['bad']:2d}  abstain {c['abstain']:2d}")
for d in ['servo','anchor','buzzz']:
    print(d, {s:round(float(np.mean([x['iou'] or 0 for x in rows if x['selection']==s and x['photo'].startswith(d)])),3) for s in by})
