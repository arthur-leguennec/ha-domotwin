"""Draw the README banner: an isometric "open dollhouse" of the fictional demo apartment.

Reads examples/demo-apartment.plan.json and writes docs/figures/src/hero.svg (then run
`node scripts/render-figures.mjs`). A placeholder until real screenshots of the renderer exist.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PLAN = json.loads((ROOT / "examples" / "demo-apartment.plan.json").read_text(encoding="utf-8"))
OUT = Path(__file__).with_name("hero.svg")

WIDTH, HEIGHT = 1600, 760
SCALE = 0.58
ORIGIN = (1010.0, 205.0)
COS30, SIN30 = math.cos(math.radians(30)), 0.5
WALL, CUT = 265.0, 38.0
LIGHT_KINDS = {
    "pendant", "lamp", "tablelamp", "ceilinglight", "spot", "nightstand", "fan", "chandelier",
}
SKIP = {"curtain", "spot", "mirror", "frame", "gallery", "backsplash"}


def iso(x: float, y: float, z: float = 0.0) -> tuple[float, float]:
    """Plan cm (x right, y down, z up) to screen pixels."""
    return (
        ORIGIN[0] + (x - y) * COS30 * SCALE,
        ORIGIN[1] + (x + y) * SIN30 * SCALE - z * SCALE,
    )


def points(pts: list[tuple[float, float]]) -> str:
    return " ".join(f"{px:.1f},{py:.1f}" for px, py in pts)


def shade(color: str, factor: float) -> str:
    r, g, b = (int(color[i : i + 2], 16) for i in (1, 3, 5))
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, round(c * factor))) for c in (r, g, b)))


def box(x0: float, y0: float, x1: float, y1: float, z0: float, z1: float, color: str) -> str:
    """An axis-aligned box: top, south (+y) and east (+x) faces."""
    top = [iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)]
    south = [iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1)]
    east = [iso(x1, y0, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x1, y0, z1)]
    return (
        f'<polygon points="{points(south)}" fill="{shade(color, 0.78)}"/>'
        f'<polygon points="{points(east)}" fill="{shade(color, 0.9)}"/>'
        f'<polygon points="{points(top)}" fill="{shade(color, 1.04)}"/>'
    )


def prism(a: tuple[float, float], b: tuple[float, float], thickness: float, height: float, color: str) -> str:
    """A wall of any direction: its top and the side faces that look towards the camera."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length * thickness / 2, dx / length * thickness / 2
    corners = [(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)]
    faces = []
    for i in range(4):
        p, q = corners[i], corners[(i + 1) % 4]
        # Outward normal of this side; the camera looks from +x, +y.
        ex, ey = q[0] - p[0], q[1] - p[1]
        cx = sum(c[0] for c in corners) / 4
        cy = sum(c[1] for c in corners) / 4
        ox, oy = ey, -ex
        if ox * ((p[0] + q[0]) / 2 - cx) + oy * ((p[1] + q[1]) / 2 - cy) < 0:
            ox, oy = -ox, -oy
        facing = ox + oy
        if facing <= 0:
            continue
        light = 0.78 if abs(oy) >= abs(ox) else 0.9
        quad = [iso(p[0], p[1], 0), iso(q[0], q[1], 0), iso(q[0], q[1], height), iso(p[0], p[1], height)]
        faces.append(f'<polygon points="{points(quad)}" fill="{shade(color, light)}"/>')
    top = [iso(x, y, height) for x, y in corners]
    faces.append(f'<polygon points="{points(top)}" fill="{shade(color, 1.04)}"/>')
    return "".join(faces)


def footprint(element: dict) -> tuple[float, float, float, float]:
    """Axis-aligned bounds of a furniture footprint (angles of the demo are multiples of 90°)."""
    x, y, w, h = element["x"], element["y"], element["w"], element["h"]
    angle = element.get("angle", 0) % 180
    cx, cy = x + w / 2, y + h / 2
    if 45 <= angle < 135:
        w, h = h, w
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2


rooms = [e for e in PLAN["elements"] if e["type"] == "room"]
furniture = [e for e in PLAN["elements"] if e["type"] == "furniture"]
floor_colors = {
    "bois-chene": "#c89b6d",
    "bois-gris": "#a99c8c",
    "bois-peint": "#b9b1a6",
    "carrelage-beige": "#d9cbb3",
    "carrelage-blanc": "#e3e6e6",
}

shapes: list[tuple[float, str]] = []
# Floors first (always behind).
for room in rooms:
    vertices = room.get("vertices", [[0, 0], [1, 0], [1, 1], [0, 1]])
    pts = [iso(room["x"] + u * room["w"], room["y"] + v * room["h"]) for u, v in vertices]
    color = floor_colors.get(room.get("floor", ""), "#d6d1c4")
    shapes.append((-1e9, f'<polygon points="{points(pts)}" fill="{color}" stroke="#8a7f70" stroke-width="0.6"/>'))

# Walls: the back façades stay full height, everything else is cut away (dollhouse view).
T = 10.0
min_x = min(r["x"] for r in rooms)
min_y = min(r["y"] for r in rooms)
max_x = max(r["x"] + r["w"] for r in rooms)
max_y = max(r["y"] + r["h"] for r in rooms)
segments = set()
for room in rooms:
    vertices = room.get("vertices", [[0, 0], [1, 0], [1, 1], [0, 1]])
    pts = [(room["x"] + u * room["w"], room["y"] + v * room["h"]) for u, v in vertices]
    for i, (a, b) in enumerate(zip(pts, pts[1:] + pts[:1], strict=True)):
        if i in room.get("openEdges", []):
            continue
        segments.add((round(a[0]), round(a[1]), round(b[0]), round(b[1])))

wall_color = "#f3efe7"
for x0, y0, x1, y1 in segments:
    if (x1, y1, x0, y0) in segments and (x0, y0) > (x1, y1):
        continue
    back = (y0 == y1 == min_y) or (x0 == x1 == min_x)
    height = WALL if back else CUT
    depth = max(x0 + y0, x1 + y1) + (0 if back else T)
    shapes.append((depth - 1, prism((x0, y0), (x1, y1), T, height, wall_color)))

# Furniture as boxes in their own colours.
lamps: list[tuple[float, float, float, str]] = []
for piece in furniture:
    kind = piece.get("kind", "desk")
    x0, y0, x1, y1 = footprint(piece)
    z0 = piece.get("elevation", 0)
    z1 = z0 + piece["z"]
    if kind in LIGHT_KINDS and not piece.get("lightOff"):
        color = piece.get("lightColor", "#ffc27a")
        # Ceiling lights show as a pool of light on the floor; the others glow where they are.
        z = 0.0 if z0 > 180 else (z0 if kind == "pendant" else z1)
        lamps.append(((x0 + x1) / 2, (y0 + y1) / 2, z, color))
    if kind in SKIP or z0 > 180:
        continue
    color = piece.get("color", "#cfc6b6")
    shapes.append((x1 + y1, box(x0, y0, x1, y1, z0, z1, color)))

shapes.sort(key=lambda item: item[0])

glows = []
for x, y, z, _color in lamps:
    cx, cy = iso(x, y, z)
    if z == 0.0:
        glows.append(
            f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="95" ry="55" fill="url(#glow)" opacity="0.75"/>'
        )
        continue
    glows.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="70" fill="url(#glow)" opacity="0.9"/>')
    glows.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="5" fill="#fff6e0"/>')

svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1324"/>
      <stop offset="1" stop-color="#1b2a4a"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#ffd59a" stop-opacity="0.85"/>
      <stop offset="0.45" stop-color="#ffb35c" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pool" cx="0.62" cy="0.55" r="0.5">
      <stop offset="0" stop-color="#3b82f6" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <style>
      .name {{ font: 800 92px Inter, sans-serif; fill: #ffffff; letter-spacing: -2px; }}
      .tag {{ font: 500 28px Inter, sans-serif; fill: #cbd5e1; }}
      .chip {{ font: 600 19px Inter, sans-serif; fill: #e2e8f0; }}
      .small {{ font: 400 15px Inter, sans-serif; fill: #64748b; }}
    </style>
  </defs>
  <rect width="{WIDTH}" height="{HEIGHT}" fill="url(#sky)"/>
  <rect width="{WIDTH}" height="{HEIGHT}" fill="url(#pool)"/>
  <text x="80" y="250" class="name">DomoTwin</text>
  <text x="84" y="306" class="tag">Your home as a live 3D twin</text>
  <text x="84" y="344" class="tag">in Home Assistant.</text>
  <g>
    <rect x="84" y="396" width="196" height="44" rx="22" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.18"/>
    <text x="182" y="425" class="chip" text-anchor="middle">Tap to control</text>
    <rect x="292" y="396" width="226" height="44" rx="22" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.18"/>
    <text x="405" y="425" class="chip" text-anchor="middle">Live lights &amp; sensors</text>
    <rect x="84" y="452" width="280" height="44" rx="22" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.18"/>
    <text x="224" y="481" class="chip" text-anchor="middle">Local · Rust + WebAssembly</text>
  </g>
  <text x="84" y="700" class="small">Illustration of the fictional demo apartment (examples/), drawn from its plan file.</text>
  <g stroke-linejoin="round">
    {"".join(shape for _, shape in shapes)}
  </g>
  <g style="mix-blend-mode: screen">{"".join(glows)}</g>
</svg>
"""
OUT.write_text(svg, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)}")
