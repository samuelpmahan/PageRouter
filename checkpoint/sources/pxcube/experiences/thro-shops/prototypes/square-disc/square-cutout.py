# Prototype: cut a square (non-round) disc out of a cluttered product photo by colour key on the disc's own body colour.
import sys, json, numpy as np, cv2
from scipy import ndimage
src, out = sys.argv[1], sys.argv[2]
img = cv2.imread(src); H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
# 1. the body colour: the median HSV in a small centre window that is NOT the stamp (take the most common hue bin in the centre 40%)
cy, cx = H//2, W//2; win = hsv[int(H*0.3):int(H*0.7), int(W*0.3):int(W*0.7)]
sat_ok = (win[...,1] > 150) & (win[...,2] > 150)
hist = np.bincount(win[...,0][sat_ok].ravel(), minlength=180); h0 = int(hist.argmax())
dh = np.minimum(np.abs(hsv[...,0]-h0), 180-np.abs(hsv[...,0]-h0))
# body = the disc's own colour, measured from the plain centre: hue within 4, and saturation/value no more than 40 below the centre's 10th percentile
s10, v10 = np.percentile(win[...,1][sat_ok], 10), np.percentile(win[...,2][sat_ok], 10)
body = (dh <= 4) & (hsv[...,1] >= s10 - 40) & (hsv[...,2] >= v10 - 40)
# 2. keep the component under the centre, fill the stamp holes, smooth
lab, n = ndimage.label(body); sizes = ndimage.sum(body, lab, range(1, n+1)); keep = lab == (1 + int(np.argmax(sizes)))   # the stamp sits at the centre, so take the largest body-colour component, not the one under the centre
keep = ndimage.binary_closing(keep, iterations=4)
keep = ndimage.binary_fill_holes(keep)
# a large opening breaks off anything thin that touches the disc (a bundle label, another disc's edge); the disc itself is a fat square
r = max(8, int(0.04 * np.sqrt(keep.sum()))); disk = (np.add.outer(np.arange(-r, r+1)**2, np.arange(-r, r+1)**2) <= r*r)
keep = ndimage.binary_opening(keep, structure=disk)
lab, n = ndimage.label(keep); sizes = ndimage.sum(keep, lab, range(1, n+1)); keep = lab == (1 + int(np.argmax(sizes)))
if not keep[cy, cx]: sys.exit('largest body-colour region does not contain the centre')
# 2b. deskew from the edges themselves: fit a line to each side's edge pixels over the middle 60% of that side.
# The four slopes are the disc's tilt in the photo (a bowed or slightly perspective edge still has a straight middle).
def edge_tilts(m):
    yy, xx = np.where(m); a0, a1, b0, b1 = yy.min(), yy.max(), xx.min(), xx.max()
    cols = np.arange(int(b0 + 0.2*(b1-b0)), int(b1 - 0.2*(b1-b0)))
    rows = np.arange(int(a0 + 0.2*(a1-a0)), int(a1 - 0.2*(a1-a0)))
    top = np.array([np.argmax(m[:, c]) for c in cols]); bot = np.array([m.shape[0]-1-np.argmax(m[::-1, c]) for c in cols])
    lef = np.array([np.argmax(m[r, :]) for r in rows]); rig = np.array([m.shape[1]-1-np.argmax(m[r, ::-1]) for r in rows])
    deg = lambda u, v: float(np.degrees(np.arctan(np.polyfit(u, v, 1)[0])))
    # image y grows down: a top edge rising to the right has negative slope. Express every side as the clockwise tilt of the square.
    return {'top': deg(cols, top), 'bottom': deg(cols, bot), 'left': -deg(rows, lef), 'right': -deg(rows, rig)}
tilts = edge_tilts(keep); tilt = float(np.median(list(tilts.values())))
if abs(tilt) > 0.15:
    # cv2 rotates counter-clockwise for positive angles; a clockwise tilt t (positive slope) is undone by rotating counter-clockwise by t
    R = cv2.getRotationMatrix2D((W/2, H/2), tilt, 1.0)
    img = cv2.warpAffine(img, R, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    keep = cv2.warpAffine(keep.astype(np.uint8)*255, R, (W, H), flags=cv2.INTER_LINEAR) > 127
tiltsAfter = edge_tilts(keep)
# 3. receipts: fill ratio vs its bounding box (a square disc ~0.9+), aspect, size
ys, xs = np.where(keep); y0,y1,x0,x1 = ys.min(), ys.max(), xs.min(), xs.max()
bw, bh = x1-x0+1, y1-y0+1; fill = keep.sum()/(bw*bh); aspect = bw/bh
cnt,_ = cv2.findContours(keep.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = max(cnt, key=cv2.contourArea); peri = cv2.arcLength(c, True); approx = cv2.approxPolyDP(c, 0.02*peri, True)
# 4. cutout 800x800: scale the bounding box into 92% of the frame, alpha = feathered mask
# the card frame is round and clips to a circle: scale so the farthest disc pixel from the centroid sits at 97% of the frame radius
# the card's square frame rings the disc at 97.8% of the frame (r=180 of 184): fit the bounding box to 96% so the edge sits on the ring
# the card's frame ring (7 px, centred on the frame edge) should sit ON the disc's edge: fit the bounding box to the full frame
S = 800; cyc, cxc = (y0+y1)/2, (x0+x1)/2; maxd = float(np.sqrt(((ys-cyc)**2 + (xs-cxc)**2).max())); scale = 0.98*S/max(bw,bh)   # the whole disc inside the frame; the card's ring follows the disc's own outline (below), not a circle or square
# corner radius measured, not inferred: walk in from each bounding-box corner along the diagonal to the first disc pixel.
# For a rounded square of corner radius r that gap is r*(sqrt2 - 1)*sqrt2 along the diagonal (r*(sqrt2-1) per axis step).
gaps = []
for (cy0, cx0, dy, dx) in [(y0, x0, 1, 1), (y0, x1, 1, -1), (y1, x0, -1, 1), (y1, x1, -1, -1)]:
    k = 0
    while k < min(bw, bh)//2 and not keep[cy0 + dy*k, cx0 + dx*k]: k += 1
    gaps.append(k)
side = (bw + bh) / 2; rs = [g / (np.sqrt(2) - 1) / side for g in gaps]
cornerFrac = float(np.median(rs))
alpha = ndimage.gaussian_filter(keep.astype(float), 1.0)
rgba = np.dstack([img, (alpha*255).astype(np.uint8)])
crop = rgba[y0:y1+1, x0:x1+1]
nw, nh = int(round(bw*scale)), int(round(bh*scale))
small = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
canvas = np.zeros((S, S, 4), np.uint8); ox, oy = max(0, (S-nw)//2), max(0, (S-nh)//2)   # bounding-box centre at the frame centre
canvas[oy:oy+min(nh, S-oy), ox:ox+min(nw, S-ox)] = small[:min(nh, S-oy), :min(nw, S-ox)]
cv2.imwrite(out, canvas)
# the disc's outline in the cutout's own coordinates (0..1 of the frame): contour of the alpha, resampled to 128 points evenly by
# arc length and lightly smoothed (circular 5-point mean). The card clips the photo to this path and strokes its ring along it.
ca = (canvas[..., 3] > 127).astype(np.uint8)
cc, _ = cv2.findContours(ca, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); P = max(cc, key=cv2.contourArea)[:, 0, :].astype(float)
seg = np.r_[0, np.cumsum(np.hypot(*np.diff(np.vstack([P, P[:1]]), axis=0).T))]; L = seg[-1]
t = np.linspace(0, L, 128, endpoint=False); Q = np.vstack([P, P[:1]])
pts = np.c_[np.interp(t, seg, Q[:, 0]), np.interp(t, seg, Q[:, 1])]
k = 2; pts = np.mean([np.roll(pts, j, axis=0) for j in range(-k, k+1)], axis=0)
outline = [[round(float(x)/S, 4), round(float(y)/S, 4)] for x, y in pts]
json.dump({'shape': 'outline', 'points': outline, 'from': src, 'frame': S}, open(out.replace('.png', '-outline.json'), 'w'))
print(json.dumps({'bodyHue': h0, 'bbox': [int(x0),int(y0),int(bw),int(bh)], 'fill': round(float(fill),3), 'aspect': round(float(aspect),3), 'corners': int(len(approx)), 'areaFrac': round(float(keep.sum()/(H*W)),3), 'maxRadiusPx': round(maxd,1), 'scale': round(scale,4), 'cornerFrac': round(cornerFrac,3), 'cornerGapsPx': [int(g) for g in gaps], 'tiltDeg': round(tilt,2), 'edgeTilts': {k: round(v,2) for k,v in tilts.items()}, 'edgeTiltsAfter': {k: round(v,2) for k,v in tiltsAfter.items()}}))
