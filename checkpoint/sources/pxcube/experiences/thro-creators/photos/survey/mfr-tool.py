#!/usr/bin/env python3
"""Helpers for finding manufacturer disc photos (no third-party packages).
  python3 mfr-tool.py shopify DOMAIN            -> every product on a Shopify store: title<TAB>handle<TAB>product_url<TAB>first_image_url
  python3 mfr-tool.py og URL                    -> og:image / twitter:image / first large <img> on a page
  python3 mfr-tool.py check IMAGE_URL           -> HTTP status, content-type, bytes (an image is usable only if 200 and image/*)
  python3 mfr-tool.py search DOMAIN QUERY       -> Shopify search suggest (products) for a store, title<TAB>url<TAB>image
"""
import sys, json, re, urllib.request, urllib.parse, html
UA = {'User-Agent': 'Mozilla/5.0 (thro manufacturer-image survey)'}
def get(url, raw=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        b = r.read(); return (b, r.status, r.headers.get('content-type', '')) if raw else b.decode('utf-8', 'replace')
def shopify(domain):
    page = 1
    while page < 40:
        try: data = json.loads(get(f'https://{domain}/products.json?limit=250&page={page}'))
        except Exception as e: print(f'ERROR {e}', file=sys.stderr); return
        ps = data.get('products', [])
        if not ps: return
        for p in ps:
            img = (p.get('images') or [{}])[0].get('src', '')
            print(f"{p['title']}\t{p['handle']}\thttps://{domain}/products/{p['handle']}\t{img}")
        page += 1
def og(url):
    s = get(url)
    for pat in [r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)', r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image', r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)']:
        m = re.search(pat, s, re.I)
        if m: print(html.unescape(urllib.parse.urljoin(url, m.group(1)))); return
    for m in re.finditer(r'<img[^>]+src=["\']([^"\']+\.(?:jpe?g|png|webp)[^"\']*)', s, re.I):
        print(urllib.parse.urljoin(url, html.unescape(m.group(1))))
def check(url):
    try:
        b, st, ct = get(url, raw=True); print(st, ct, len(b))
    except Exception as e: print('FAIL', e)
def search(domain, q):
    data = json.loads(get(f'https://{domain}/search/suggest.json?q={urllib.parse.quote(q)}&resources[type]=product&resources[limit]=10'))
    for p in data.get('resources', {}).get('results', {}).get('products', []):
        print(f"{p.get('title')}\thttps://{domain}{p.get('url','').split('?')[0]}\t{p.get('image') or (p.get('featured_image') or {}).get('url','')}")
if __name__ == '__main__':
    cmd, *a = sys.argv[1:]
    {'shopify': shopify, 'og': og, 'check': check, 'search': search}[cmd](*a)
