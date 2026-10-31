#!/usr/bin/env python3
"""Fetch the provider photos for thro creator pages into a site, as a build step (the photos are build output, not source).
Reads providers.json and each provider's data (manufacturer.jsonl: disc_id, maker, product_page, image_url, match),
downloads each image_url, fits it in a 480 px square (aspect kept), writes SITE/disc-photos/<provider>/<disc_id>.webp, and writes
SITE/disc-photos/manifest.json: {provider: {disc_id: {src, credit, page, match, sha256}}}. Re-runs reuse a download cache.
Usage: python3 fetch.py SITE_DIR [CACHE_DIR]"""
import sys, os, json, hashlib, io, urllib.request, concurrent.futures as cf
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
site = sys.argv[1]; cache = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, '.cache')
os.makedirs(cache, exist_ok=True)
prov = json.load(open(os.path.join(here, 'providers.json')))
UA = {'User-Agent': 'Mozilla/5.0 (thro disc-photo build)'}
def get(url):
    key = os.path.join(cache, hashlib.sha256(url.encode()).hexdigest())
    if os.path.exists(key): return open(key, 'rb').read()
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r: b = r.read()
    open(key, 'wb').write(b); return b
manifest = {}
for pid, p in prov['providers'].items():
    rows = [json.loads(l) for l in open(os.path.join(here, p['data'])) if l.strip()]
    rows = [r for r in rows if r.get('image_url') and r.get('match') in p['kinds']]
    outdir = os.path.join(site, 'disc-photos', pid.replace(':', '-'))
    def one(r):
        try:
            im = Image.open(io.BytesIO(get(r['image_url']))); im.load()
            im = im.convert('RGBA') if im.mode in ('P', 'LA', 'RGBA') else im.convert('RGB')
            im.thumbnail((480, 480), Image.LANCZOS)
            rel = f"disc-photos/{pid.replace(':', '-')}/{r['disc_id']}.webp"
            os.makedirs(os.path.dirname(os.path.join(site, rel)), exist_ok=True)
            buf = io.BytesIO(); im.save(buf, 'WEBP', quality=82, method=6); b = buf.getvalue()
            open(os.path.join(site, rel), 'wb').write(b)
            return r['disc_id'], {'src': '/' + rel, 'credit': p['credit'].replace('{maker}', r['maker']), 'page': r.get('product_page', ''), 'match': r['match'], 'w': im.width, 'h': im.height, 'sha256': hashlib.sha256(b).hexdigest()}
        except Exception as e:
            return r['disc_id'], {'error': str(e)[:160]}
    got = {}
    with cf.ThreadPoolExecutor(12) as ex:
        for did, v in ex.map(one, rows): got[did] = v
    manifest[pid] = {k: v for k, v in sorted(got.items()) if 'error' not in v}
    errs = {k: v['error'] for k, v in got.items() if 'error' in v}
    print(pid, len(manifest[pid]), 'photos,', len(errs), 'failed', list(errs.items())[:5])
json.dump({'default': prov['default'], 'creators': prov['creators'], 'photos': manifest}, open(os.path.join(site, 'disc-photos', 'manifest.json'), 'w'), indent=0)
