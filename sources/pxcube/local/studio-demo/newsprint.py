"""Repeatable photo-to-newsprint study; Pillow, no model and no randomness.

Like the existing halftone-screen painter, ink coverage is a field of dot radii.
Here the field is sampled photographic luminance rather than the painter's ramp.
The result is a preview asset, never part of the exported overlay.
"""
from pathlib import Path
from math import sqrt
from PIL import Image, ImageDraw, ImageEnhance, ImageOps


def newsprint(image, size=(1920, 1080), cell=5, contrast=1.15):
    gray = ImageOps.grayscale(ImageOps.fit(image, size, method=Image.Resampling.LANCZOS))
    gray = ImageEnhance.Contrast(ImageOps.autocontrast(gray, cutoff=1)).enhance(contrast)
    samples = gray.resize((size[0] // cell, size[1] // cell), Image.Resampling.BOX)
    ink = Image.new('L', size, 247)
    draw = ImageDraw.Draw(ink)
    for y in range(samples.height):
        for x in range(samples.width):
            coverage = 1 - samples.getpixel((x, y)) / 255
            radius = cell * sqrt(coverage / 3.141592653589793)
            cx, cy = (x + .5) * cell, (y + .5) * cell
            draw.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill=18)
    return Image.blend(gray, ink, .52)


if __name__ == '__main__':
    assets = Path(__file__).parent / 'assets'
    newsprint(Image.open(assets / 'tee-shot-original.jpg')).save(assets / 'tee-shot-newsprint-v1.png')
