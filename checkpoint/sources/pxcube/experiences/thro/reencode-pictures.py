# Re-encodes a built site's pictures (Sam, 30 Oct, on "Resize and re-encode the pictures": "good, do"). The originals stay the
# source: this runs on a built site, after its build, and writes the smaller copies beside them. A plan file says which pictures,
# how wide at most, which built files name them (each named exactly as many times as the plan says, or nothing is written) and
# which built files pin their SHA-256. The receipt records every input and output hash, the bytes saved, and how far the pixels
# moved (PSNR of each encoding against the original at the shipped size, in decibels; higher is closer), and, with --compare-avif, AVIF at the same quality and at the same pixel error alongside; AVIF is measured, not shipped.
# Usage: python3 reencode-pictures.py SITE_DIR PLAN.json RECEIPT.json [--compare-avif]
#   --compare-avif also encodes AVIF (slow: it searches for the AVIF quality that matches the WebP's pixels); builds leave it off.
import hashlib, io, json, math, os, sys
from PIL import Image, ImageOps, features, __version__ as pillow

site, plan_file, receipt_file = sys.argv[1:4]
compare_avif = '--compare-avif' in sys.argv[4:]
plan = json.load(open(plan_file))
sha = lambda b: hashlib.sha256(b).hexdigest()

def decode(data):
    image = Image.open(io.BytesIO(data))
    image.load()
    return image

def psnr(a, b):
    # Compares what a browser shows: both decoded and flattened onto white at the shipped size.
    flat = lambda im: Image.alpha_composite(Image.new('RGBA', im.size, 'white'), im.convert('RGBA')).convert('RGB')
    a, b = flat(a), flat(b)
    diff = [abs(x - y) for x, y in zip(a.tobytes(), b.tobytes())]
    mse = sum(d * d for d in diff) / len(diff)
    return None if mse == 0 else round(10 * math.log10(255 * 255 / mse), 2)

def encode(image, kind, quality, icc):
    out = io.BytesIO()
    options = {'quality': quality}
    if icc: options['icc_profile'] = icc
    if kind == 'webp': image.save(out, 'WEBP', method=6, **options)
    else: image.save(out, 'AVIF', speed=4, **options)
    return out.getvalue()

pictures, writes = [], {}
for p in plan['pictures']:
    source = os.path.join(site, p['from'])
    original = open(source, 'rb').read()
    if p.get('sha256') and sha(original) != p['sha256']:
        raise SystemExit(f"{p['from']}: expected SHA-256 {p['sha256']}, got {sha(original)}")
    image = decode(original)
    icc = image.info.get('icc_profile')
    # Browsers turn a JPEG by its EXIF orientation; the re-encoded copy carries no EXIF, so turn the pixels instead.
    shown = ImageOps.exif_transpose(image)
    if shown.mode not in ('RGB', 'RGBA'): shown = shown.convert('RGBA' if 'A' in shown.getbands() else 'RGB')
    width, height = shown.size
    if p.get('maxWidth') and width > p['maxWidth']:
        shown = shown.resize((p['maxWidth'], round(height * p['maxWidth'] / width)), Image.LANCZOS)
    q = p.get('quality', 80)
    webp = encode(shown, 'webp', q, icc)
    webp_psnr = psnr(shown, decode(webp))
    avif = encode(shown, 'avif', q, icc) if compare_avif else None
    # AVIF at the same quality number is not the same quality, so also find the lowest AVIF quality whose pixels are at least as
    # close to the original as the WebP's, and report its bytes: that is the fair comparison.
    low, high, matched = 0, 100 if compare_avif else -1, None
    while low <= high:
        mid = (low + high) // 2
        trial = encode(shown, 'avif', mid, icc)
        if psnr(shown, decode(trial)) >= webp_psnr: matched, high = (mid, trial), mid - 1
        else: low = mid + 1
    writes[os.path.join(site, p['to'])] = webp
    pictures.append({'from': p['from'], 'to': p['to'], 'bytesBefore': len(original), 'sha256Before': sha(original),
        'sizeBefore': list(image.size), 'size': list(shown.size), 'quality': q,
        'webp': {'bytes': len(webp), 'sha256': sha(webp), 'psnr': webp_psnr},
        'avif': {'bytes': len(avif), 'sha256': sha(avif), 'psnr': psnr(shown, decode(avif))} if avif else None,
        'avifAtWebpPixels': {'quality': matched[0], 'bytes': len(matched[1]), 'sha256': sha(matched[1]), 'psnr': psnr(shown, decode(matched[1]))} if matched else None,
        'replacesInPlace': p['from'] == p['to']})

new_hash = {x['from']: x['webp']['sha256'] for x in pictures}
edited = {}
def text(relative):
    if relative not in edited: edited[relative] = open(os.path.join(site, relative), encoding='utf-8').read()
    return edited[relative]
for r in plan.get('references', []):
    t = text(r['file'])
    found = t.count(r['before'])
    if found != r['count']: raise SystemExit(f"{r['file']}: expected {r['count']} of {r['before']!r}, found {found}")
    edited[r['file']] = t.replace(r['before'], r['after'])
for h in plan.get('pinnedHashes', []):
    picture = next(x for x in pictures if x['from'] == h['picture'])
    t = text(h['file'])
    found = t.count(picture['sha256Before'])
    if found != h['count']: raise SystemExit(f"{h['file']}: expected {h['count']} of {picture['sha256Before']}, found {found}")
    edited[h['file']] = t.replace(picture['sha256Before'], new_hash[h['picture']])

# Every check passed, so write.
for path, data in writes.items(): open(path, 'wb').write(data)
for relative, t in edited.items(): open(os.path.join(site, relative), 'w', encoding='utf-8').write(t)
for p in plan['pictures']:
    if p.get('removeOriginal') and p['from'] != p['to']: os.remove(os.path.join(site, p['from']))
total = lambda key: sum(x[key]['bytes'] for x in pictures)
receipt = {'plan': os.path.basename(plan_file), 'planSha256': sha(open(plan_file, 'rb').read()), 'pillow': pillow,
    'libwebp': features.version('webp'), 'libavif': features.version_module('avif') if hasattr(features, 'version_module') else features.version('avif'),
    'bytesBefore': sum(x['bytesBefore'] for x in pictures), 'webpBytes': total('webp'), 'avifBytes': total('avif') if compare_avif else None,
    'avifAtWebpPixelsBytes': sum(x['avifAtWebpPixels']['bytes'] for x in pictures if x['avifAtWebpPixels']),
    'pictures': pictures, 'edited': sorted(edited)}
json.dump(receipt, open(receipt_file, 'w'), indent=1)
open(receipt_file, 'a').write('\n')
print(f"{len(pictures)} pictures: {receipt['bytesBefore']:,} -> WebP {receipt['webpBytes']:,} {f"(AVIF at the same pixel error {receipt['avifAtWebpPixelsBytes']:,})" if compare_avif else ''}; edited {', '.join(sorted(edited)) or 'nothing'}")
