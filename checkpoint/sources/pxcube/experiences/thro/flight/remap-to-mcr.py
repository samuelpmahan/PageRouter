# Exact colour remap of Argon's flight engine (dark slate/neon) to thro's Mid-Century Retro (paper/ink). Physics untouched:
# only colour literals and the page's stylesheet tokens change. Every replacement is listed here.
import re, sys, pathlib
ORANGE, MUSTARD, TEAL, INK, OK = '#e0632e', '#b07d12', '#1f6f68', '#2b2420', '#2f7a4a'
HEX = {  # canvas + inline colours
  '#fb7185': ORANGE, '#c8f49d': MUSTARD, '#38bdf8': TEAL, '#fbbf24': INK, '#34d399': OK, '#0ea5e9': TEAL,
  '#ffffff': INK, '#f8fafc': INK, '#e2e8f0': INK, '#a7f3d0': OK, '#fecdd3': ORANGE, '#475569': INK,
  '#0d131d': '#fbf4e6', '#0e141f': '#fbf4e6', '#0b0e13': '#fff8ee',
}
RGB = {  # rgba(r, g, b, a) triplets: same alpha, new hue
  (200, 244, 157): (176, 125, 18), (56, 189, 248): (31, 111, 104), (251, 191, 36): (43, 36, 32), (251, 113, 133): (224, 99, 46),
  (52, 211, 153): (47, 122, 74), (148, 163, 184): (43, 36, 32), (0, 0, 0): (43, 36, 32), (255, 255, 255): (43, 36, 32),
}
BG_RGBA = {'rgba(11, 14, 19, 0.84)': 'rgba(251, 244, 230, 0.92)', 'rgba(15, 23, 42, 0.65)': 'rgba(251, 244, 230, 0.9)',
  'rgba(18, 23, 33, 0.85)': 'rgba(251, 244, 230, 0.92)', 'rgba(15, 20, 29, 0.88)': 'rgba(251, 244, 230, 0.92)'}
def rgba(m):
    r, g, b, a = m.group(1), m.group(2), m.group(3), m.group(4)
    key = (int(r), int(g), int(b))
    if key not in RGB: return m.group(0)
    nr, ng, nb = RGB[key]; return f'rgba({nr}, {ng}, {nb}, {a})'
for f in sys.argv[1:]:
    p = pathlib.Path(f); s = p.read_text()
    for k, v in BG_RGBA.items(): s = s.replace(k, v)
    s = re.sub(r'rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\s*\)', rgba, s)
    for k, v in HEX.items(): s = re.sub(re.escape(k), v, s, flags=re.I)
    p.write_text(s)
