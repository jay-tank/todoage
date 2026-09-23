#!/usr/bin/env python3
"""Generate icon.png (128x128) for the TodoAge VS Code extension.

Uses the same rounded-gradient-square + 4x supersample/LANCZOS-downsample technique used
across this developer's Firefox extension icons. Design: a warm amber/orange gradient
background, a white clock-face glyph (suggesting "age"/time) overlapping a small stack of
white checklist lines (suggesting "TODO").
"""

from PIL import Image, ImageDraw

SIZE = 128
SCALE = 4
BIG = SIZE * SCALE

TOP_COLOR = (230, 150, 50)
BOTTOM_COLOR = (140, 80, 10)


def rounded_gradient_bg(size, top_color, bottom_color, radius_ratio=0.22):
    """Build a big x big rounded-square image with a vertical gradient fill."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient = Image.new("RGB", (1, size), color=0)
    for y in range(size):
        t = y / (size - 1)
        r = int(top_color[0] + (bottom_color[0] - top_color[0]) * t)
        g = int(top_color[1] + (bottom_color[1] - top_color[1]) * t)
        b = int(top_color[2] + (bottom_color[2] - top_color[2]) * t)
        gradient.putpixel((0, y), (r, g, b))
    gradient = gradient.resize((size, size))

    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    radius = int(size * radius_ratio)
    mdraw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=255)

    img.paste(gradient, (0, 0))
    img.putalpha(mask)
    return img


def draw_glyph(img):
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    white = (255, 255, 255, 255)

    # Checklist lines - three short horizontal bars in the upper-left area.
    line_x0 = int(size * 0.18)
    line_x1 = int(size * 0.55)
    line_thickness = int(size * 0.045)
    line_ys = [int(size * 0.28), int(size * 0.40), int(size * 0.52)]
    for y in line_ys:
        draw.rounded_rectangle(
            [(line_x0, y), (line_x1, y + line_thickness)],
            radius=line_thickness // 2,
            fill=white,
        )

    # Clock face - circle overlapping the bottom-right corner of the checklist.
    clock_cx = int(size * 0.66)
    clock_cy = int(size * 0.66)
    clock_r = int(size * 0.27)
    ring_width = int(size * 0.045)

    draw.ellipse(
        [
            (clock_cx - clock_r, clock_cy - clock_r),
            (clock_cx + clock_r, clock_cy + clock_r),
        ],
        outline=white,
        width=ring_width,
    )

    # Clock hands: one pointing up (12 o'clock), one pointing right-ish (marking time passing).
    hand_width = int(size * 0.035)
    draw.line(
        [(clock_cx, clock_cy), (clock_cx, clock_cy - int(clock_r * 0.7))],
        fill=white,
        width=hand_width,
    )
    draw.line(
        [(clock_cx, clock_cy), (clock_cx + int(clock_r * 0.5), clock_cy + int(clock_r * 0.15))],
        fill=white,
        width=hand_width,
    )
    # Center dot.
    dot_r = int(size * 0.02)
    draw.ellipse(
        [
            (clock_cx - dot_r, clock_cy - dot_r),
            (clock_cx + dot_r, clock_cy + dot_r),
        ],
        fill=white,
    )


def main():
    big = rounded_gradient_bg(BIG, TOP_COLOR, BOTTOM_COLOR)
    draw_glyph(big)
    final = big.resize((SIZE, SIZE), Image.LANCZOS)
    final.save("icon.png")
    print("Wrote icon.png (%dx%d)" % (SIZE, SIZE))


if __name__ == "__main__":
    main()
