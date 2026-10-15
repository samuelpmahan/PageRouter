"""Screenshot an HTML file at full page size. Usage: python3 shoot.py in.html out.png [width]"""
import sys
from playwright.sync_api import sync_playwright

src, out = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 1400
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': width, 'height': 900}, device_scale_factor=1)
    page.goto('file://' + src)
    page.screenshot(path=out, full_page=True)
    b.close()
print(out)
