#!/usr/bin/env python3
"""Draws the ReelForge UI images the Roku app needs (SceneGraph has no gradients or rounded corners).

Run from anywhere: python3 tv/roku/scripts/make-assets.py   (needs Pillow). Output: tv/roku/images/rf/.
White shapes are tinted at runtime with blendColor, so one image serves every color.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "images" / "rf"
OUT.mkdir(parents=True, exist_ok=True)
BASE = (23, 32, 42)  # --base #17202A
SS = 4  # supersampling for smooth edges


def nine_patch(img: Image.Image, stretch_x: tuple[int, int], stretch_y: tuple[int, int], name: str) -> None:
    """Adds the 1px 9-patch border: black marks on the top/left edges say which middle part stretches."""
    w, h = img.size
    out = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(img, (1, 1))
    px = out.load()
    for x in range(stretch_x[0], stretch_x[1]):
        px[x + 1, 0] = (0, 0, 0, 255)
    for y in range(stretch_y[0], stretch_y[1]):
        px[0, y + 1] = (0, 0, 0, 255)
    out.save(OUT / f"{name}.9.png")


def rounded(size: int, radius: int, fill=None, outline=None, width=0) -> Image.Image:
    big = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    half = width * SS / 2
    d.rounded_rectangle([half, half, size * SS - 1 - half, size * SS - 1 - half], radius=radius * SS, fill=fill, outline=outline, width=width * SS)
    return big.resize((size, size), Image.LANCZOS)


# Buttons and panels: a white rounded rectangle, radius 10
r = 10
pill = rounded(2 * r + 4, r, fill=(255, 255, 255, 255))
nine_patch(pill, (r, r + 4), (r, r + 4), "rf-round")

# Focus ring for cards: 5px white outline, radius 12 (tinted ember)
r = 14
ring = rounded(2 * r + 4, r, outline=(255, 255, 255, 255), width=5)
nine_patch(ring, (r, r + 4), (r, r + 4), "rf-ring")

# Fully round pill (for small chips / dots), radius 18
r = 18
chip = rounded(2 * r + 2, r, fill=(255, 255, 255, 255))
nine_patch(chip, (r, r + 2), (r, r + 2), "rf-pill")


def gradient(w: int, h: int, horizontal: bool, stops: list[tuple[float, float]], color=BASE, name="") -> None:
    """stops: (position 0-1, alpha 0-1) pairs, eased between them."""
    img = Image.new("RGBA", (w, h))
    px = img.load()
    n = w if horizontal else h
    for i in range(n):
        t = i / (n - 1)
        for (p0, a0), (p1, a1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                k = (t - p0) / (p1 - p0) if p1 > p0 else 0
                k = k * k * (3 - 2 * k)  # smoothstep: no visible edge
                a = a0 + (a1 - a0) * k
                break
        else:
            a = stops[-1][1]
        rgba = (*color, round(a * 255))
        for j in range(h if horizontal else w):
            px[(i, j) if horizontal else (j, i)] = rgba
    img.save(OUT / f"{name}.png")


# Billboard: dark on the left where the text sits, fading to the picture on the right
gradient(512, 8, True, [(0, 0.97), (0.35, 0.85), (0.75, 0.25), (1, 0)], name="rf-fade-left")
# Billboard: picture fading into the page background at the bottom
gradient(8, 512, False, [(0, 0), (0.45, 0.15), (0.8, 0.85), (1, 1)], name="rf-fade-bottom")
# Top bar: slight darkening behind the navigation so it reads over bright pictures
gradient(8, 256, False, [(0, 0.75), (1, 0)], color=(10, 14, 20), name="rf-fade-top")
# Cards: dark at the bottom so the title on top of the picture stays readable
gradient(8, 256, False, [(0, 0), (0.35, 0.05), (1, 0.88)], color=(8, 11, 15), name="rf-card-shade")


def icon(name: str, draw_fn, size=64) -> None:
    big = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(big), size * SS)
    big.resize((size, size), Image.LANCZOS).save(OUT / f"{name}.png")


W = (255, 255, 255, 255)
icon("rf-play", lambda d, s: d.polygon([(s * 0.26, s * 0.16), (s * 0.84, s * 0.5), (s * 0.26, s * 0.84)], fill=W))


def info(d, s):
    d.ellipse([s * 0.08, s * 0.08, s * 0.92, s * 0.92], outline=W, width=round(s * 0.085))
    d.rounded_rectangle([s * 0.45, s * 0.42, s * 0.55, s * 0.74], radius=s * 0.04, fill=W)
    d.ellipse([s * 0.44, s * 0.24, s * 0.56, s * 0.36], fill=W)


icon("rf-info", info)


def plus(d, s):
    t = s * 0.085
    d.rounded_rectangle([s * 0.5 - t / 2, s * 0.2, s * 0.5 + t / 2, s * 0.8], radius=t / 2, fill=W)
    d.rounded_rectangle([s * 0.2, s * 0.5 - t / 2, s * 0.8, s * 0.5 + t / 2], radius=t / 2, fill=W)


icon("rf-plus", plus)
icon("rf-check", lambda d, s: d.line([(s * 0.2, s * 0.53), (s * 0.42, s * 0.74), (s * 0.82, s * 0.3)], fill=W, width=round(s * 0.09), joint="curve"))


def search(d, s):
    d.ellipse([s * 0.14, s * 0.14, s * 0.66, s * 0.66], outline=W, width=round(s * 0.09))
    d.line([(s * 0.6, s * 0.6), (s * 0.86, s * 0.86)], fill=W, width=round(s * 0.1))


icon("rf-search", search)


def gear(d, s):
    import math
    cx = cy = s / 2
    for k in range(8):
        a = k * math.pi / 4
        d.line([(cx + math.cos(a) * s * 0.22, cy + math.sin(a) * s * 0.22), (cx + math.cos(a) * s * 0.42, cy + math.sin(a) * s * 0.42)], fill=W, width=round(s * 0.13))
    d.ellipse([s * 0.22, s * 0.22, s * 0.78, s * 0.78], fill=W)
    d.ellipse([s * 0.38, s * 0.38, s * 0.62, s * 0.62], fill=(0, 0, 0, 0))


icon("rf-gear", gear)
icon("rf-dot", lambda d, s: d.ellipse([0, 0, s - 1, s - 1], fill=W), size=24)
print(f"Wrote {len(list(OUT.iterdir()))} images to {OUT}")
