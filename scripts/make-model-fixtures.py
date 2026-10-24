#!/usr/bin/env python3
"""Writes the fictional 3D models used to test the import of user models (and to try it).

    python3 scripts/make-model-fixtures.py

Every model is invented and built here from primitives. The output is deterministic, so the
files only change when this script does.

- examples/models/stool.glb     a bar stool, binary glTF (Y up, metres): a wooden seat, metal legs
- examples/models/stool.obj     the same stool without colours, OBJ (Y up, centimetres)
- examples/models/stool.stl     the same stool, binary STL (Z up, millimetres)
- examples/models/stool.3mf     the same stool, 3MF (Z up, millimetres) with base materials
- examples/models/lamp.gltf     a floor lamp, glTF with embedded data (Y up, metres): a base painted
                                with a picture (a 2 x 2 PNG), a pole and an emissive shade, double
                                sided
"""

from __future__ import annotations

import base64
import json
import math
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "examples" / "models"

# A part: (name, triangles) with triangles as three (x, y, z) points in metres, Y up, front +z,
# counter-clockwise seen from outside.
Point = tuple[float, float, float]
Triangle = tuple[Point, Point, Point]


def cylinder(radius: float, y0: float, y1: float, top_radius: float | None = None,
             segments: int = 16, x: float = 0.0, z: float = 0.0, caps: bool = True) -> list[Triangle]:
    """A vertical cylinder (or cone frustum) around (x, z)."""
    top = radius if top_radius is None else top_radius
    tris: list[Triangle] = []
    ring = [(math.cos(2 * math.pi * i / segments), math.sin(2 * math.pi * i / segments)) for i in range(segments)]
    for i in range(segments):
        (c0, s0), (c1, s1) = ring[i], ring[(i + 1) % segments]
        a = (x + radius * c0, y0, z + radius * s0)
        b = (x + radius * c1, y0, z + radius * s1)
        c = (x + top * c1, y1, z + top * s1)
        d = (x + top * c0, y1, z + top * s0)
        # Outward: seen from outside, a -> d -> c is counter-clockwise.
        tris.append((a, d, c))
        tris.append((a, c, b))
        if caps:
            tris.append(((x, y1, z), c, d))
            tris.append(((x, y0, z), a, b))
    return tris


def box(x0: float, y0: float, z0: float, x1: float, y1: float, z1: float) -> list[Triangle]:
    """An axis-aligned box."""
    p = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    # Corner index: x + 2y + 4z.
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    tris: list[Triangle] = []
    for q in quads:
        tris.append((p[q[0]], p[q[1]], p[q[2]]))
        tris.append((p[q[0]], p[q[2]], p[q[3]]))
    return tris


def stool() -> list[tuple[str, list[Triangle]]]:
    """A bar stool 38 cm wide and 71 cm high."""
    legs: list[Triangle] = []
    for i in range(3):
        a = 2 * math.pi * i / 3 + math.pi / 2
        legs += cylinder(0.012, 0.0, 0.67, segments=8, x=0.15 * math.cos(a), z=0.15 * math.sin(a))
    ring = cylinder(0.14, 0.25, 0.265, segments=16, caps=False)
    return [
        ("seat", cylinder(0.19, 0.67, 0.71, top_radius=0.185, segments=24)),
        ("legs", legs + ring),
    ]


def lamp() -> list[tuple[str, list[Triangle]]]:
    """A floor lamp 40 cm wide and 1.6 m high."""
    return [
        ("base", cylinder(0.14, 0.0, 0.025, top_radius=0.13, segments=24)),
        ("pole", cylinder(0.01, 0.025, 1.3, segments=8)),
        ("shade", cylinder(0.2, 1.22, 1.6, top_radius=0.13, segments=24, caps=False)),
    ]


def png(pixels: list[list[tuple[int, int, int]]]) -> bytes:
    """A small RGB PNG."""
    height, width = len(pixels), len(pixels[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def gltf(parts: list[tuple[str, list[Triangle]]], materials: list[dict], texture: bytes | None) -> tuple[dict, bytes]:
    """A glTF document and its binary buffer: one primitive per part, indexed, with normals."""
    data = bytearray()
    views: list[dict] = []
    accessors: list[dict] = []
    primitives: list[dict] = []

    def add(blob: bytes, target: int | None) -> int:
        while len(data) % 4:
            data.append(0)
        view = {"buffer": 0, "byteOffset": len(data), "byteLength": len(blob)}
        if target is not None:
            view["target"] = target
        data.extend(blob)
        views.append(view)
        return len(views) - 1

    for m, (_, tris) in enumerate(parts):
        vertices: list[tuple[Point, Point, tuple[float, float]]] = []
        for t in tris:
            ux, uy, uz = (t[1][k] - t[0][k] for k in range(3))
            vx, vy, vz = (t[2][k] - t[0][k] for k in range(3))
            n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
            length = math.sqrt(sum(c * c for c in n)) or 1.0
            n = tuple(c / length for c in n)
            for p in t:
                vertices.append((p, n, (p[0] * 2 + 0.5, p[2] * 2 + 0.5)))
        positions = b"".join(struct.pack("<3f", *v[0]) for v in vertices)
        normals = b"".join(struct.pack("<3f", *v[1]) for v in vertices)
        uvs = b"".join(struct.pack("<2f", *v[2]) for v in vertices)
        indices = b"".join(struct.pack("<H", i) for i in range(len(vertices)))
        lo = [min(v[0][k] for v in vertices) for k in range(3)]
        hi = [max(v[0][k] for v in vertices) for k in range(3)]
        attributes = {
            "POSITION": len(accessors),
            "NORMAL": len(accessors) + 1,
        }
        accessors.append({"bufferView": add(positions, 34962), "componentType": 5126, "count": len(vertices), "type": "VEC3", "min": lo, "max": hi})
        accessors.append({"bufferView": add(normals, 34962), "componentType": 5126, "count": len(vertices), "type": "VEC3"})
        if texture is not None and "pbrMetallicRoughness" in materials[m] and "baseColorTexture" in materials[m]["pbrMetallicRoughness"]:
            attributes["TEXCOORD_0"] = len(accessors)
            accessors.append({"bufferView": add(uvs, 34962), "componentType": 5126, "count": len(vertices), "type": "VEC2"})
        accessors.append({"bufferView": add(indices, 34963), "componentType": 5123, "count": len(vertices), "type": "SCALAR"})
        primitives.append({"attributes": attributes, "indices": len(accessors) - 1, "material": m})
    doc: dict = {
        "asset": {"version": "2.0", "generator": "DomoTwin fixtures"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "model", "mesh": 0}],
        "meshes": [{"primitives": primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
    }
    if texture is not None:
        doc["images"] = [{"bufferView": add(texture, None), "mimeType": "image/png"}]
        doc["textures"] = [{"source": 0}]
    while len(data) % 4:
        data.append(0)
    doc["buffers"] = [{"byteLength": len(data)}]
    return doc, bytes(data)


def glb(doc: dict, data: bytes) -> bytes:
    text = json.dumps(doc, separators=(",", ":")).encode()
    while len(text) % 4:
        text += b" "
    body = struct.pack("<II", len(text), 0x4E4F534A) + text + struct.pack("<II", len(data), 0x004E4942) + data
    return b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body


def to_z_up_mm(p: Point) -> Point:
    """Y up, front +z, metres -> Z up, front -y, millimetres."""
    return (round(p[0] * 1000, 3), round(-p[2] * 1000, 3), round(p[1] * 1000, 3))


def obj(parts: list[tuple[str, list[Triangle]]]) -> str:
    lines = ["# A fictional bar stool made by scripts/make-model-fixtures.py (centimetres, Y up).", "mtllib stool.mtl"]
    index: dict[Point, int] = {}
    faces: list[str] = []
    for name, tris in parts:
        faces.append(f"g {name}")
        faces.append(f"usemtl {name}")
        for t in tris:
            ids = []
            for p in t:
                key = tuple(round(c * 100, 4) for c in p)
                if key not in index:
                    index[key] = len(index) + 1
                    lines.append("v {:g} {:g} {:g}".format(*key))
                ids.append(str(index[key]))
            faces.append("f " + " ".join(ids))
    return "\n".join(lines + faces) + "\n"


def stl(parts: list[tuple[str, list[Triangle]]]) -> bytes:
    tris = [tuple(to_z_up_mm(p) for p in t) for _, part in parts for t in part]
    out = bytearray(b"Fictional bar stool, DomoTwin fixtures".ljust(80, b" "))
    out += struct.pack("<I", len(tris))
    for t in tris:
        out += struct.pack("<3f", 0.0, 0.0, 0.0)
        for p in t:
            out += struct.pack("<3f", *p)
        out += b"\x00\x00"
    return bytes(out)


def three_mf(parts: list[tuple[str, list[Triangle]]], colors: list[str]) -> bytes:
    index: dict[Point, int] = {}
    vertices: list[str] = []
    triangles: list[str] = []
    for m, (_, tris) in enumerate(parts):
        for t in tris:
            ids = []
            for p in t:
                key = to_z_up_mm(p)
                if key not in index:
                    index[key] = len(index)
                    vertices.append('<vertex x="{:g}" y="{:g}" z="{:g}"/>'.format(*key))
                ids.append(index[key])
            triangles.append(f'<triangle v1="{ids[0]}" v2="{ids[1]}" v3="{ids[2]}" pid="1" p1="{m}"/>')
    bases = "".join(f'<base name="part {i}" displaycolor="{c}"/>' for i, c in enumerate(colors))
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
        '<metadata name="Title">Fictional bar stool</metadata>\n'
        f'<resources><basematerials id="1">{bases}</basematerials>\n'
        '<object id="2" type="model" pid="1" pindex="0"><mesh>\n'
        f'<vertices>{"".join(vertices)}</vertices>\n'
        f'<triangles>{"".join(triangles)}</triangles>\n'
        '</mesh></object></resources>\n'
        '<build><item objectid="2"/></build>\n'
        '</model>\n'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n'
    )
    types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '</Types>\n'
    )
    path = OUT / "stool.3mf"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, text in (("[Content_Types].xml", types), ("_rels/.rels", rels), ("3D/3dmodel.model", model)):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, text)
    return path.read_bytes()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    parts = stool()
    wood = {"name": "wood", "pbrMetallicRoughness": {"baseColorFactor": [0.42, 0.2, 0.08, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.6}}
    metal = {"name": "metal", "pbrMetallicRoughness": {"baseColorFactor": [0.55, 0.56, 0.57, 1.0], "metallicFactor": 1.0, "roughnessFactor": 0.35}}
    doc, data = gltf(parts, [wood, metal], None)
    (OUT / "stool.glb").write_bytes(glb(doc, data))
    (OUT / "stool.obj").write_text(obj(parts))
    (OUT / "stool.stl").write_bytes(stl(parts))
    three_mf(parts, ["#A0714A", "#8C8F91"])

    checker = png([[(214, 196, 160), (150, 122, 84)], [(150, 122, 84), (214, 196, 160)]])
    base = {"name": "stone", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 0.8}}
    pole = {"name": "brass", "pbrMetallicRoughness": {"baseColorFactor": [0.6, 0.45, 0.2, 1.0], "metallicFactor": 1.0, "roughnessFactor": 0.3}}
    shade = {"name": "shade", "pbrMetallicRoughness": {"baseColorFactor": [0.95, 0.9, 0.8, 1.0], "metallicFactor": 0.0}, "emissiveFactor": [1.0, 0.85, 0.6], "doubleSided": True}
    doc, data = gltf(lamp(), [base, pole, shade], checker)
    doc["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(data).decode()
    (OUT / "lamp.gltf").write_text(json.dumps(doc, indent=1) + "\n")
    for f in sorted(OUT.iterdir()):
        print(f"{f.relative_to(ROOT)}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
