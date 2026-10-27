# Trace Sam's logo PNG (1080x1080) into one SVG: ink paths and orange arrow paths, potrace curves, tight viewBox.
import numpy as np, potrace
from PIL import Image
a = np.array(Image.open('thro-logo-source.png').convert('RGB')).astype(int)
bg = np.array([243, 232, 210]); ink = np.array([43, 36, 32]); orange = np.array([224, 99, 46])
d = lambda c: np.sqrt(((a - c) ** 2).sum(-1))
# assign each pixel to the nearest of the three colours; antialiased edges split at the midpoint
lum = a @ np.array([0.299, 0.587, 0.114])
near_or = d(orange) < 90                                      # the arrow and its own antialiased edge, nothing else
m_or = near_or & (d(orange) < d(bg))
m_ink = ~near_or & (lum < (lum[20, 20] + 37) / 2)            # luminance midpoint between paper and ink
def trace(mask):
    bm = potrace.Bitmap(mask)
    pl = bm.trace(turdsize=4, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.2)
    out = []
    for c in pl:
        s = c.start_point; seg = [f"M{s.x:.2f} {s.y:.2f}"]
        for g in c.segments:
            if g.is_corner: seg.append(f"L{g.c.x:.2f} {g.c.y:.2f}L{g.end_point.x:.2f} {g.end_point.y:.2f}")
            else: seg.append(f"C{g.c1.x:.2f} {g.c1.y:.2f} {g.c2.x:.2f} {g.c2.y:.2f} {g.end_point.x:.2f} {g.end_point.y:.2f}")
        xsv = [s.x] + [g.end_point.x for g in c.segments]; ysv = [s.y] + [g.end_point.y for g in c.segments]
        if min(xsv) <= 0.5 and min(ysv) <= 0.5 and max(xsv) >= mask.shape[1] - 0.5 and max(ysv) >= mask.shape[0] - 0.5: continue   # the image frame
        out.append(''.join(seg) + 'Z')
    return ''.join(out)
ys, xs = np.where(m_ink | m_or); pad = 8
x0, y0, x1, y1 = xs.min() - pad, ys.min() - pad, xs.max() + 1 + pad, ys.max() + 1 + pad
w, h = x1 - x0, y1 - y0
p_ink, p_or = trace(m_ink), trace(m_or)
def svg(inkc, orc, bgc=None):
    rect = f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" fill="{bgc}"/>' if bgc else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {w} {h}" width="{w}" height="{h}" role="img" aria-label="thro">'
            f'{rect}<path fill="{inkc}" fill-rule="evenodd" d="{p_ink}"/><path fill="{orc}" fill-rule="evenodd" d="{p_or}"/></svg>')
open('thro-logo.svg', 'w').write(svg('#2b2420', '#e0632e'))                 # on light grounds
open('thro-logo-light.svg', 'w').write(svg('#f0f0e7', '#c8f49d'))           # on thro's dark green: ink -> light, arrow -> lime
open('thro-logo-currentcolor.svg', 'w').write(svg('currentColor', 'var(--logo-accent,#e0632e)'))
print('viewBox', x0, y0, w, h, 'bytes', len(svg('#2b2420', '#e0632e')))
