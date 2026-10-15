"""Flip book frames -> screenshots, a per-frame change check, and one contact sheet.

Usage: python3 patterns/flipbook_shoot.py <frames.json> <out-prefix> [width]
frames.json: { "title": str, "promise": "adds" | "claims", "frames": [ { "label": str, "html": str } | { "label": str, "png": path, "ok": bool }, ... ] }
A frame with "png" was already shot (a live page driven by a flow); a frame with "html" is rendered here.

For each frame k > 0 it measures, against frame k-1:
  added      pixels that changed from background to ink (something appeared)
  disturbed  pixels that were already ink and changed (earlier content moved or was redrawn)
  box        the bounding box of every changed pixel (drawn in red on the contact sheet)
A trustworthy flip book adds something in every frame and disturbs (almost) nothing.
Writes <out-prefix>-frames/NN.png, <out-prefix>.png (contact sheet), <out-prefix>.report.json.
"""
import json, os, sys
from contextlib import nullcontext
from PIL import Image, ImageChops, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

src, prefix = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 900
spec = json.load(open(src))
frames_dir = prefix + '-frames'
os.makedirs(frames_dir, exist_ok=True)

paths = []
html_frames = [f for f in spec['frames'] if 'html' in f]
with sync_playwright() if html_frames else nullcontext() as p:
  if html_frames:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': width, 'height': 400})
    # one fixed canvas for every frame: measure the widest frame first, so no frame overflows and gets redrawn differently
    widest = width
    for f in html_frames:
        page.set_content('<!doctype html><meta charset="utf-8"><body style="margin:0">' + f['html'] + '</body>')
        widest = max(widest, page.evaluate('document.documentElement.scrollWidth'))
    page.set_viewport_size({'width': widest + 8, 'height': 400})
    # Pin fonts: a glyph missing from the requested font is borrowed from whichever font the browser picks, and that pick
    # can change with what else is on the page. A flip book must draw the same text the same way in every frame.
    PIN = """for (const el of document.querySelectorAll('text, tspan, div, span, p, td, th')) {
      const f = getComputedStyle(el).fontFamily;
      el.style.fontFamily = /mono/i.test(f) ? "'DejaVu Sans Mono', monospace" : "'DejaVu Sans', sans-serif"; }"""
  for i, f in enumerate(spec['frames']):
    if 'png' in f:
        paths.append(f['png']); continue
    if True:
        page.set_content('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fbfbf9">' + f['html'] + '</body>')
        page.evaluate(PIN)
        path = os.path.join(frames_dir, f'{i:02d}.png')
        page.screenshot(path=path, full_page=True)
        paths.append(path)
  if html_frames: b.close()

imgs = [Image.open(x).convert('RGB') for x in paths]
W = max(i.width for i in imgs); H = max(i.height for i in imgs)
def pad(i):
    c = Image.new('RGB', (W, H), (251, 251, 249)); c.paste(i, (0, 0)); return c
imgs = [pad(i) for i in imgs]
BG = (251, 251, 249)

def ink(img):
    # a pixel is ink when it differs visibly from the page background
    d = ImageChops.difference(img, Image.new('RGB', img.size, BG)).convert('L')
    return d.point(lambda v: 255 if v > 24 else 0)

report = []
for k, img in enumerate(imgs):
    row = {'frame': k, 'label': spec['frames'][k]['label']}
    if k > 0:
        prev = imgs[k - 1]
        diff = ImageChops.difference(prev, img).convert('L').point(lambda v: 255 if v > 24 else 0)
        prev_ink = ink(prev)
        disturbed = ImageChops.multiply(diff, prev_ink)
        row['added'] = int(sum(1 for v in ImageChops.subtract(diff, prev_ink).get_flattened_data() if v))
        row['disturbed'] = int(sum(1 for v in disturbed.get_flattened_data() if v))
        row['box'] = diff.getbbox()
    report.append(row)

# contact sheet: frames in a grid, each labelled, the change box outlined in red.
# Crop every frame to the content of the last frame (frames only add, so the last frame holds everything), so thumbnails stay legible.
# Crop to everything any frame drew (for a book that only adds, that is the last frame).
crop = None
for i in imgs:
    bb = ink(i).getbbox()
    if bb: crop = bb if crop is None else (min(crop[0], bb[0]), min(crop[1], bb[1]), max(crop[2], bb[2]), max(crop[3], bb[3]))
crop = crop or (0, 0, W, H)
crop = (max(0, crop[0] - 8), max(0, crop[1] - 8), min(W, crop[2] + 8), min(H, crop[3] + 8))
# a frame may name its own box (a flow marks the element its claim reads); otherwise the box is everything that changed
shown_box = [(b[0] - crop[0], b[1] - crop[1], b[2] - crop[0], b[3] - crop[1]) if (b := spec['frames'][k].get('box') or r.get('box')) else None for k, r in enumerate(report)]
imgs_shown = [i.crop(crop) for i in imgs]
W, H = crop[2] - crop[0], crop[3] - crop[1]
cols = min(3 if W > 300 else 4, len(imgs)); scale = min(1.0, 1200 / (cols * W))
tw, th = int(W * scale), int(H * scale)
TOL = 0.1  # same tolerance as problems() in flipbook.mjs: disturbed above 10% of added means earlier content moved
rows = (len(imgs) + cols - 1) // cols
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)
except OSError:
    font = small = ImageFont.load_default()
def wrap(text, f, width):
    # break a label into lines that fit the column, so labels never run into the next thumbnail
    lines, cur = [], ''
    for w in text.split(' '):
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= width or not cur: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]
sheet = Image.new('RGB', (cols * (tw + 20) + 20, 10), 'white'); d = ImageDraw.Draw(sheet)
labels = [wrap(f"{k}  {r['label']}", font, tw) for k, r in enumerate(report)]
head = max(len(l) for l in labels) * 17 + 20
sheet = Image.new('RGB', (cols * (tw + 20) + 20, 44 + rows * (th + head + 20)), 'white')
d = ImageDraw.Draw(sheet)
d.text((20, 14), spec.get('title', ''), fill='black', font=font)
for k, img in enumerate(imgs_shown):
    x = 20 + (k % cols) * (tw + 20); y = 44 + (k // cols) * (th + head + 20)
    t = img.copy()
    box = shown_box[k]
    if box:
        ImageDraw.Draw(t).rectangle([box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3], outline=(214, 40, 40), width=max(2, int(2 / scale)))
    sheet.paste(t.resize((tw, th)), (x, y + head))
    d.rectangle([x, y + head, x + tw, y + head + th], outline=(190, 196, 194))
    for i, line in enumerate(labels[k]):
        d.text((x, y + i * 17), line, fill='black', font=font)
    if k > 0:
        r = report[k]
        if spec.get('promise') == 'claims':
            bad = not spec['frames'][k].get('ok', False) or (k > 0 and spec['frames'][k].get('acted') and r['added'] + r['disturbed'] == 0)
            d.text((x, y + head - 18), f"changed {r['added'] + r['disturbed']} px · claim {'holds  ✓' if not bad else 'fails  ✗'}", fill=(176, 48, 42) if bad else (31, 138, 76), font=small)
        else:
            bad = r['added'] == 0 or r['disturbed'] > TOL * r['added']
            d.text((x, y + head - 18), f"added {r['added']} px · disturbed {r['disturbed']} px" + ('  ✗' if bad else '  ✓'), fill=(176, 48, 42) if bad else (31, 138, 76), font=small)
sheet.save(prefix + '.png')
json.dump(report, open(prefix + '.report.json', 'w'), indent=1)
print(json.dumps([{k: v for k, v in r.items() if k != 'box'} for r in report]))
