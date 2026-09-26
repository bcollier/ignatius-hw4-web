"""Draw the app icon: a single candle flame on the parchment background.

Run with PyMuPDF available (e.g. the API repo's venv):
  ../ignatius-hw4-api/.venv/bin/python tools/make_icons.py
"""

from pathlib import Path

import pymupdf

OUT = Path(__file__).parent.parent / "icons"
PARCHMENT = (0xF7 / 255, 0xF4 / 255, 0xEE / 255)
BROWN = (0x7A / 255, 0x4B / 255, 0x2A / 255)
GOLD = (0xE2 / 255, 0xB0 / 255, 0x5A / 255)


def draw(size: int, path: Path, maskable: bool = False) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=512, height=512)
    page.draw_rect(page.rect, color=None, fill=PARCHMENT)
    s = 0.8 if maskable else 1.0  # keep the mark inside the safe zone for maskable icons
    cx, top = 256, 256 - 200 * s

    def flame(scale: float, color):
        h, w = 230 * s * scale, 92 * s * scale
        base = top + 230 * s  # bottom of the flame
        tip = base - h
        shape = page.new_shape()
        shape.draw_bezier((cx, tip), (cx + w * 0.15, tip + h * 0.35), (cx + w, base - h * 0.35), (cx, base))
        shape.draw_bezier((cx, base), (cx - w, base - h * 0.35), (cx - w * 0.15, tip + h * 0.35), (cx, tip))
        shape.finish(color=None, fill=color, closePath=True)
        shape.commit()

    flame(1.0, BROWN)
    flame(0.52, GOLD)
    # the candle
    body_top = top + 250 * s
    page.draw_rect(pymupdf.Rect(cx - 46 * s, body_top, cx + 46 * s, body_top + 130 * s), color=None, fill=BROWN)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(size / 512, size / 512))
    pix.save(str(path))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    draw(192, OUT / "icon-192.png")
    draw(512, OUT / "icon-512.png")
    draw(512, OUT / "icon-maskable-512.png", maskable=True)
    draw(180, OUT / "apple-touch-icon.png")
    print(sorted(p.name for p in OUT.iterdir()))
