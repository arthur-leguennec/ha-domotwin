#!/usr/bin/env python3
"""Writes the fictional files used to test the import of other apps' plans (D-040).

    python3 scripts/make-import-fixtures.py

Every file describes an invented home; nothing comes from a real building or a real scan. The
output is deterministic, so the files only change when this script does.

- crates/domotwin-import/tests/fixtures/cottage.sh3d  a Sweet Home 3D home of two levels: a living
  room, a kitchen, a bathroom and a hall on the ground floor (rooms drawn inside the walls, doors,
  windows, furniture, a lamp, a furniture group), a bedroom and an office upstairs drawn with
  walls only.
- crates/domotwin-import/tests/fixtures/studio.dxf    an ASCII DXF studio in millimetres: walls
  drawn with two lines on a wall layer, door blocks with their swing, window blocks, furniture
  blocks, room names as texts, dimensions to leave out.
- crates/domotwin-import/tests/fixtures/scan.json     a room scan as RoomPlan's JSON
  (`CapturedRoom`, iOS 17): a living room turned by 25° from where the phone started, its walls,
  a door, a window, an opening, its floor and furniture, in metres, y up.
- crates/domotwin-import/tests/fixtures/scan.usdz     the same scan as RoomPlan's USDZ (parametric):
  a root layer grouping one text layer per element.
- crates/domotwin-import/tests/fixtures/structure.json  a scan of several rooms
  (`CapturedStructure`): a living room and a bedroom side by side on the ground floor, an office
  upstairs with its walls only.
- crates/domotwin-import/tests/fixtures/structure.usdz  the same structure as its USDZ.

And for the imports of D-057:

- crates/domotwin-import/tests/fixtures/robot.json    a robot vacuum's map as Valetudo's REST API
  gives it: a flat of four rooms (segments, named, two with their floor), the walls the robot's
  laser saw, a table's legs and a kitchen island it went round, its dock; turned by 4°.
- crates/domotwin-import/tests/fixtures/robot.png     the same map as Home Assistant's camera
  receives it from Valetudo over MQTT: a small PNG, the map deflated in its `zTXt` chunk.
- crates/domotwin-import/tests/fixtures/roborock.gz   the same flat as Roborock's own map (`rr`,
  5 cm a pixel, `y` up), gzipped as Valetudo RE serves it: its image with the rooms' ids, its
  dock, a path.
- crates/domotwin-import/tests/fixtures/apartment.fml  a Floorplanner project (FML 3.0): a ground
  floor of four rooms (areas, one named by a label), its doors and windows in its walls, its
  furniture, a terrace; an attic drawn with walls only.
- crates/domotwin-import/tests/fixtures/house.obj     a house of two storeys scanned as a mesh
  (in metres, `y` up, turned by 12°, its surfaces a little uneven): what a scan sees of its
  floors, ceilings, walls, door and window reveals, and its furniture, including a tall wardrobe
  and wall cabinets.
- crates/domotwin-import/tests/fixtures/house.glb     the same house as a GLB, a node a storey.
- crates/domotwin-import/tests/fixtures/house.ply     its ground floor as a binary PLY, `z` up, in
  centimetres.
"""

from __future__ import annotations

import gzip
import json
import math
import struct
import zipfile
import zlib
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "crates" / "domotwin-import" / "tests" / "fixtures"

# --- Sweet Home 3D ---------------------------------------------------------------------------


def wall(i: int, level: str, a: tuple[float, float], b: tuple[float, float], t: float) -> str:
    return (
        f"  <wall id='wall-{i}' level='{level}' xStart='{a[0]}' yStart='{a[1]}' "
        f"xEnd='{b[0]}' yEnd='{b[1]}' height='250.0' thickness='{t}' pattern='hatchUp'/>\n"
    )


def room(i: int, level: str, name: str, points: list[tuple[float, float]]) -> str:
    corners = "".join(f"<point x='{x}' y='{y}'/>" for x, y in points)
    return (
        f"  <room id='room-{i}' level='{level}' name='{name}' areaVisible='true'>{corners}</room>\n"
    )


def piece(tag: str, i: int, level: str | None, catalog: str, name: str, x: float, y: float,
          w: float, d: float, h: float, angle: float = 0.0, elevation: float = 0.0,
          extra: str = "", inner: str = "") -> str:
    at = f" level='{level}'" if level else ""
    head = (
        f"  <{tag} id='{tag}-{i}'{at} catalogId='{catalog}' name='{name}' x='{x}' y='{y}' "
        f"elevation='{elevation}' angle='{angle}' width='{w}' depth='{d}' height='{h}'{extra}"
    )
    return f"{head}>{inner}</{tag}>\n" if inner else f"{head}/>\n"


def sash(x_axis: float, end: float) -> str:
    return f"<sash xAxis='{x_axis}' yAxis='5.0' width='80.0' startAngle='0.0' endAngle='{end}'/>"


def cottage() -> bytes:
    g, u = "level-0", "level-1"
    xml = [
        "<?xml version='1.0'?>\n",
        "<home version='7200' name='cottage.sh3d' camera='topCamera' wallHeight='250.0'>\n",
        f"  <level id='{g}' name='Ground floor' elevation='0.0' floorThickness='12.0' "
        "height='250.0' elevationIndex='0'/>\n",
        f"  <level id='{u}' name='Upstairs' elevation='262.0' floorThickness='12.0' "
        "height='250.0' elevationIndex='0'/>\n",
    ]
    # Ground floor: façades 20 cm on centre lines 0..900 × 0..700, partitions 10 cm.
    walls = [
        ((0, 0), (900, 0), 20), ((900, 0), (900, 700), 20), ((900, 700), (0, 700), 20),
        ((0, 700), (0, 0), 20), ((500, 0), (500, 700), 10), ((500, 400), (900, 400), 10),
        ((0, 450), (500, 450), 10),
    ]
    for i, (a, b, t) in enumerate(walls):
        xml.append(wall(i, g, a, b, t))
    xml.append(room(1, g, "Living room", [(10, 10), (495, 10), (495, 445), (10, 445)]))
    xml.append(room(2, g, "Kitchen", [(505, 10), (890, 10), (890, 395), (505, 395)]))
    xml.append(room(3, g, "Bathroom", [(505, 405), (890, 405), (890, 690), (505, 690)]))
    xml.append(room(4, g, "Hall", [(10, 455), (495, 455), (495, 690), (10, 690)]))
    half = math.pi / 2
    # Doors: the entrance in the façade, three inside; windows in the façades.
    xml.append(piece("doorOrWindow", 1, g, "eTeks#frontDoor", "Front door", 250, 700, 100, 20,
                     210, 0.0, inner=sash(5, -half)))
    xml.append(piece("doorOrWindow", 2, g, "eTeks#door", "Door", 250, 450, 80, 10, 210, 0.0,
                     inner=sash(5, half)))
    xml.append(piece("doorOrWindow", 3, g, "eTeks#door", "Door", 500, 250, 80, 10, 210, half,
                     inner=sash(75, -half)))
    xml.append(piece("doorOrWindow", 4, g, "eTeks#door", "Door", 700, 400, 80, 10, 210, 0.0,
                     extra=" modelMirrored='true'", inner=sash(5, half)))
    xml.append(piece("doorOrWindow", 5, g, "eTeks#window", "Window", 200, 0, 140, 20, 120,
                     0.0, 90.0))
    xml.append(piece("doorOrWindow", 6, g, "eTeks#window", "Window", 700, 0, 120, 20, 120,
                     0.0, 90.0))
    xml.append(piece("doorOrWindow", 7, g, "eTeks#doubleWindow", "Fenêtre double", 0, 220,
                     160, 20, 120, half, 90.0))
    # Furniture, a lamp, and a group of a table and its chairs.
    xml.append(piece("pieceOfFurniture", 1, g, "eTeks#sofa", "Sofa", 250, 360, 200, 90, 85))
    xml.append(piece("pieceOfFurniture", 2, g, "eTeks#coffeeTable", "Coffee table", 250, 250,
                     100, 60, 40))
    xml.append(piece("pieceOfFurniture", 3, g, "eTeks#tv", "TV", 250, 40, 120, 40, 70,
                     math.pi))
    xml.append(piece("light", 1, g, "eTeks#floorLamp", "Floor lamp", 60, 400, 40, 40, 165,
                     extra=" power='0.5'"))
    xml.append(piece("pieceOfFurniture", 4, g, "eTeks#fridge", "Refrigerator", 860, 60, 60,
                     65, 180, half))
    xml.append(piece("pieceOfFurniture", 5, g, "eTeks#cooker", "Cooker", 860, 160, 60, 60, 85,
                     half))
    xml.append(piece("pieceOfFurniture", 6, g, "eTeks#bathtub", "Bathtub", 820, 600, 170, 75,
                     55, half))
    xml.append(piece("pieceOfFurniture", 7, g, "eTeks#washbasin", "Washbasin", 560, 660, 60,
                     45, 85, math.pi))
    xml.append(piece("pieceOfFurniture", 8, g, "eTeks#toilet", "Toilet", 640, 660, 40, 65,
                     40, math.pi))
    xml.append(
        f"  <furnitureGroup id='group-1' level='{g}' name='Dining' x='700' y='230' "
        "width='200' depth='160' height='75'>\n"
        + piece("pieceOfFurniture", 9, None, "eTeks#table", "Dining table", 700, 230, 160, 90,
                75)
        + piece("pieceOfFurniture", 10, None, "eTeks#chair", "Chair", 700, 160, 45, 50, 90)
        + piece("pieceOfFurniture", 11, None, "eTeks#chair", "Chair", 700, 300, 45, 50, 90,
                math.pi)
        + "  </furnitureGroup>\n"
    )
    # Upstairs, walls only: a bedroom and an office.
    up = [
        ((0, 0), (900, 0), 20), ((900, 0), (900, 500), 20), ((900, 500), (0, 500), 20),
        ((0, 500), (0, 0), 20), ((550, 0), (550, 500), 10),
    ]
    for i, (a, b, t) in enumerate(up):
        xml.append(wall(100 + i, u, a, b, t))
    xml.append(piece("pieceOfFurniture", 20, u, "eTeks#bed140x190", "Double bed", 300, 250,
                     140, 190, 70))
    xml.append(piece("pieceOfFurniture", 21, u, "eTeks#desk", "Desk", 720, 80, 140, 70, 75))
    xml.append(piece("doorOrWindow", 20, u, "eTeks#door", "Door", 550, 400, 80, 10, 210,
                     half, inner=sash(5, half)))
    xml.append("</home>\n")
    data = "".join(xml).encode("utf-8")
    info = zipfile.ZipInfo("Home.xml", date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(info, data)
        # The Java-serialised home every file also has: a few bytes the import never reads.
        home = zipfile.ZipInfo("Home", date_time=(2026, 1, 1, 0, 0, 0))
        archive.writestr(home, b"\xac\xed\x00\x05")
    return buffer.getvalue()


# --- DXF -------------------------------------------------------------------------------------


class Dxf:
    """An ASCII DXF writer: just the groups the import reads."""

    def __init__(self) -> None:
        self.blocks: list[str] = []
        self.entities: list[str] = []

    @staticmethod
    def pairs(*items: object) -> str:
        return "".join(f"{code}\n{value}\n" for code, value in zip(items[::2], items[1::2]))

    def line(self, layer: str, a: tuple[float, float], b: tuple[float, float],
             out: list[str] | None = None) -> None:
        (out if out is not None else self.entities).append(
            self.pairs(0, "LINE", 8, layer, 10, a[0], 20, a[1], 11, b[0], 21, b[1]))

    def block(self, name: str, body: list[str]) -> None:
        self.blocks.append(self.pairs(0, "BLOCK", 2, name, 70, 0, 10, 0, 20, 0) + "".join(body)
                           + self.pairs(0, "ENDBLK"))

    def insert(self, layer: str, name: str, at: tuple[float, float], rotation: float = 0.0,
               scale: float = 1.0) -> None:
        self.entities.append(self.pairs(0, "INSERT", 8, layer, 2, name, 10, at[0], 20, at[1],
                                        41, scale, 42, scale, 50, rotation))

    def text(self, layer: str, at: tuple[float, float], text: str) -> None:
        self.entities.append(self.pairs(0, "TEXT", 8, layer, 10, at[0], 20, at[1], 40, 200,
                                        1, text))

    def write(self) -> str:
        return (
            self.pairs(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1015", 9, "$INSUNITS",
                       70, 4)
            + self.pairs(0, "ENDSEC")
            + self.pairs(0, "SECTION", 2, "BLOCKS") + "".join(self.blocks)
            + self.pairs(0, "ENDSEC")
            + self.pairs(0, "SECTION", 2, "ENTITIES") + "".join(self.entities)
            + self.pairs(0, "ENDSEC", 0, "EOF")
        )


def rectangle(d: Dxf, layer: str, lo: tuple[float, float], hi: tuple[float, float],
              gaps: dict[str, list[tuple[float, float]]] | None = None) -> None:
    """A rectangle of lines, its sides cut where `gaps` says (`bottom`/`top` along x, `left`/
    `right` along y)."""
    gaps = gaps or {}

    def side(name: str, a: tuple[float, float], b: tuple[float, float], along: int) -> None:
        cuts = sorted(gaps.get(name, []))
        start = a[along]
        for g0, g1 in cuts:
            if along == 0:
                d.line(layer, (start, a[1]), (g0, a[1]))
            else:
                d.line(layer, (a[0], start), (a[0], g0))
            start = g1
        if along == 0:
            d.line(layer, (start, a[1]), (b[0], a[1]))
        else:
            d.line(layer, (a[0], start), (a[0], b[1]))

    side("bottom", (lo[0], lo[1]), (hi[0], lo[1]), 0)
    side("top", (lo[0], hi[1]), (hi[0], hi[1]), 0)
    side("left", (lo[0], lo[1]), (lo[0], hi[1]), 1)
    side("right", (hi[0], lo[1]), (hi[0], hi[1]), 1)


def studio() -> str:
    d = Dxf()
    w = "A-WALL"
    # Blocks, in millimetres: a 900 door (leaf open along y, swing arc), a 1200 window, a bed,
    # a sofa, a table, a fridge.
    d.block("DOOR-900", [
        d.pairs(0, "LINE", 8, "0", 10, 0, 20, 0, 11, 0, 21, 900),
        d.pairs(0, "ARC", 8, "0", 10, 0, 20, 0, 40, 900, 50, 0, 51, 90),
    ])
    d.block("WINDOW-1200", [
        d.pairs(0, "LWPOLYLINE", 8, "0", 90, 4, 70, 1, 10, 0, 20, 0, 10, 1200, 20, 0, 10, 1200,
                20, 200, 10, 0, 20, 200),
    ])
    for name, (bw, bd) in {"Double bed": (1400, 1900), "SOFA 3P": (2100, 900),
                          "Dining table": (1600, 900), "FRIDGE": (600, 650)}.items():
        d.block(name, [d.pairs(0, "LWPOLYLINE", 8, "0", 90, 4, 70, 1, 10, 0, 20, 0, 10, bw, 20,
                               0, 10, bw, 20, bd, 10, 0, 20, bd)])
    # Walls, double lines: outside 0..8400 × 0..6200, façades 200, inner faces at 200.
    rectangle(d, w, (0, 0), (8400, 6200))
    # The main room (living and kitchen) 200..5000 × 200..6000, its door to the bedroom in the
    # partition at x 5000..5100, y 2000..2900, and windows on the façades (lines not cut: a
    # window keeps the wall).
    rectangle(d, w, (200, 200), (5000, 6000), {"right": [(2000, 2900)]})
    rectangle(d, w, (5100, 200), (8200, 6000), {"left": [(2000, 2900)]})
    d.line(w, (5000, 2000), (5100, 2000))
    d.line(w, (5000, 2900), (5100, 2900))
    # The door: hinge at (5100, 2900), closed along −y, opening into the bedroom.
    d.insert("A-DOOR", "DOOR-900", (5100, 2900), 270)
    d.insert("A-GLAZ", "WINDOW-1200", (1500, 0), 0)
    d.insert("A-GLAZ", "WINDOW-1200", (6000, 0), 0)
    d.insert("A-FURN", "Double bed", (6000, 3500), 0)
    d.insert("A-FURN", "SOFA 3P", (1000, 4800), 0)
    d.insert("A-FURN", "Dining table", (2600, 1200), 90)
    d.insert("A-FURN", "FRIDGE", (4300, 300), 0)
    d.text("A-ANNO-ROOM", (2000, 3000), "Séjour")
    d.text("A-ANNO-ROOM", (6200, 1200), "Chambre")
    d.text("A-ANNO-ROOM", (6200, 900), "12,5 m²")
    # A dimension line, on a layer to leave out.
    d.line("A-DIMS", (0, -800), (8400, -800))
    return d.write()


# --- Room scans (RoomPlan) ---------------------------------------------------------------------


def yaw(angle: float, at: tuple[float, float, float]) -> list[float]:
    """A pose turned by `angle` (degrees) about y and placed at `at`: USD's rows, the JSON's
    columns."""
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, at[0], at[1], at[2], 1]


def floor_pose(angle: float, at: tuple[float, float, float]) -> list[float]:
    """A floor's pose: its own x along the room, its y across it, its z up."""
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return [c, 0, -s, 0, s, 0, c, 0, 0, 1, 0, 0, at[0], at[1], at[2], 1]


def r(values: list[float]) -> list[float]:
    return [round(v, 6) + 0.0 for v in values]


class Scan:
    """A fictional scan: rooms as rectangles turned by `angle`, in a frame whose origin is where
    the phone started."""

    def __init__(self, angle: float, origin: tuple[float, float], floor: float) -> None:
        self.angle = angle
        self.origin = origin
        self.floor = floor
        self.items: dict[str, list[dict]] = {k: [] for k in
                                             ("walls", "doors", "windows", "openings", "floors",
                                              "objects")}
        self.sections: list[dict] = []
        self.count = 0

    def at(self, x: float, z: float, y: float = 0.0) -> tuple[float, float, float]:
        """A point of the room's own frame (x, z on the floor, y above it) in the scan's."""
        c, s = math.cos(math.radians(self.angle)), math.sin(math.radians(self.angle))
        return (self.origin[0] + x * c + z * s, self.floor + y, self.origin[1] - x * s + z * c)

    def uuid(self) -> str:
        self.count += 1
        return f"00000000-0000-4000-8000-{self.count:012d}"

    def add(self, kind: str, category: dict, angle: float, at: tuple[float, float, float],
            dims: list[float], story: int = 0, parent: str | None = None,
            **extra: object) -> str:
        ident = self.uuid()
        entry = {"identifier": ident, "category": category, "transform": r(yaw(angle, at)),
                 "dimensions": r(dims), "story": story, "confidence": {"high": {}},
                 "parentIdentifier": parent, "curve": None, "completedEdges": [],
                 "polygonCorners": []}
        entry.update(extra)
        self.items[kind].append(entry)
        return ident

    def room(self, x0: float, z0: float, w: float, d: float, height: float, story: int = 0,
             floor: bool = True, label: str | None = None) -> list[str]:
        """A rectangular room: its four walls (inside faces), its floor, its section."""
        a = self.angle
        walls = [
            self.add("walls", {"wall": {}}, a, self.at(x0 + w / 2, z0, height / 2), [w, height, 0],
                     story),
            self.add("walls", {"wall": {}}, a + 90, self.at(x0 + w, z0 + d / 2, height / 2),
                     [d, height, 0], story),
            self.add("walls", {"wall": {}}, a + 180, self.at(x0 + w / 2, z0 + d, height / 2),
                     [w, height, 0], story),
            self.add("walls", {"wall": {}}, a + 270, self.at(x0, z0 + d / 2, height / 2),
                     [d, height, 0], story),
        ]
        if floor:
            ident = self.uuid()
            self.items["floors"].append({
                "identifier": ident, "category": {"floor": {}},
                "transform": r(floor_pose(a, self.at(x0 + w / 2, z0 + d / 2))),
                "dimensions": r([w, d, 0]), "story": story, "confidence": {"high": {}},
                "parentIdentifier": None, "curve": None, "completedEdges": [],
                "polygonCorners": [r([-w / 2, -d / 2, 0]), r([w / 2, -d / 2, 0]),
                                   r([w / 2, d / 2, 0]), r([-w / 2, d / 2, 0])]})
        if label:
            self.sections.append({"label": label, "story": story,
                                  "center": r(list(self.at(x0 + w / 2, z0 + d / 2)))})
        return walls

    def json(self) -> dict:
        return {"version": 2, "story": 0, "coreModel": "", **self.items, "sections": self.sections}


def living_scan() -> Scan:
    scan = Scan(25.0, (0.4, -1.1), -1.42)
    walls = scan.room(0, 0, 5.2, 4.0, 2.5, label="livingRoom")
    a = scan.angle
    scan.add("windows", {"window": {}}, a, scan.at(1.6, 0, 1.5), [1.4, 1.2, 0], parent=walls[0])
    scan.add("doors", {"door": {"isOpen": False}}, a + 180, scan.at(4.2, 4.0, 1.025),
             [0.9, 2.05, 0], parent=walls[2])
    scan.add("openings", {"opening": {}}, a + 270, scan.at(0, 2.8, 1.0), [1.0, 2.0, 0],
             parent=walls[3])
    scan.add("objects", {"sofa": {}}, a + 180, scan.at(2.4, 3.4, 0.425), [2.1, 0.85, 0.9],
             attributes={"SofaType": "rectangular"})
    scan.add("objects", {"table": {}}, a, scan.at(2.4, 2.3, 0.2), [1.0, 0.4, 0.6],
             attributes={"TableType": "coffee", "TableShapeType": "rectangular"})
    scan.add("objects", {"television": {}}, a, scan.at(2.4, 0.1, 1.375), [1.2, 0.75, 0.1])
    storage = scan.add("objects", {"storage": {}}, a + 90, scan.at(4.9, 1.2, 0.45),
                       [1.6, 0.9, 0.45], attributes={"StorageType": "cabinet"})
    scan.add("objects", {"sink": {}}, a + 90, scan.at(4.9, 1.2, 0.85), [0.6, 0.2, 0.45],
             parent=storage)
    scan.add("objects", {"chair": {}}, a, scan.at(0.8, 1.0, 0.45), [0.5, 0.9, 0.55],
             attributes={"ChairType": "dining"})
    return scan


def structure_scan() -> Scan:
    scan = Scan(-12.0, (1.0, 0.5), 0.0)
    living = scan.room(0, 0, 4.0, 3.5, 2.5, label="livingRoom")
    # The bedroom beside it, across a wall 12 cm thick: its own face of the wall.
    scan.room(4.12, 0, 3.5, 3.5, 2.5, label="bedroom")
    a = scan.angle
    scan.add("doors", {"door": {"isOpen": True}}, a + 90, scan.at(4.0, 1.0, 1.025),
             [0.85, 2.05, 0], parent=living[1])
    scan.add("objects", {"bed": {}}, a, scan.at(5.9, 2.2, 0.25), [1.6, 0.5, 2.0])
    # Upstairs, 2.7 m higher: an office scanned without its floor.
    up = Scan(-12.0, (1.0, 0.5), 2.7)
    up.count = scan.count
    up.room(0, 0, 4.0, 3.0, 2.4, story=1, floor=False, label="unidentified")
    up.add("objects", {"table": {}}, a, up.at(2.0, 0.6, 0.375), [1.4, 0.75, 0.7], story=1,
           attributes={"TableType": "unidentified"})
    for kind in scan.items:
        scan.items[kind] += up.items[kind]
    scan.sections += up.sections
    return scan


def structure_json(scan: Scan) -> dict:
    """A structure's JSON (`CapturedStructure`): its rooms, and every element in its lists."""
    rooms = [{"story": 0, "version": 2}, {"story": 1, "version": 2}]
    return {"version": 2, "rooms": rooms, **scan.items, "sections": scan.sections}


def usda_header(prim: str) -> str:
    return f'#usda 1.0\n(\n    defaultPrim = "{prim}"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n\n'


def matrix_text(m: list[float]) -> str:
    rows = [m[i:i + 4] for i in range(0, 16, 4)]
    return "( " + ", ".join("(" + ", ".join(repr(float(v)) for v in row) + ")" for row in rows) + " )"


def element_layer(name: str, category: str, uuid: str, m: list[float], dims: list[float]) -> str:
    return usda_header(name) + f"""def Xform "{name}" (
    assetInfo = {{
        asset identifier = @./{name}.usda@
        string name = "{name}"
    }}
    customData = {{
        string Category = "{category}"
        string UUID = "{uuid}"
    }}
    kind = "component"
)
{{
    def Cube "{name}"
    {{
        rel material:binding = </{name}/{name}_color>
        double size = 1
        double3 xformOp:scale = ({", ".join(repr(float(v)) for v in dims)})
        matrix4d xformOp:transform = {matrix_text(m)}
        uniform token[] xformOpOrder = ["xformOp:transform", "xformOp:scale"]
    }}
    def Material "{name}_color"
    {{
        token outputs:surface.connect = </{name}/{name}_color/surfaceShader.outputs:surface>
        def Shader "surfaceShader"
        {{
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0.33, 0.33, 0.33)
            token outputs:surface
        }}
    }}
}}
"""


def floor_layer(name: str, uuid: str, m: list[float], corners: list[list[float]]) -> str:
    """A floor as RoomPlan writes it, even in the parametric export: a slab 16 cm thick."""
    top = [(c[0], c[1], 0.0) for c in corners]
    bottom = [(c[0], c[1], -0.16) for c in corners]
    points = ", ".join(f"({x}, {y}, {z})" for x, y, z in top + bottom)
    n = len(corners)
    faces = [(0, 1, 2), (0, 2, 3), (4, 6, 5), (4, 7, 6)]
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, j, n + j), (i, n + j, n + i)]
    counts = ", ".join("3" for _ in faces)
    indices = ", ".join(str(k) for f in faces for k in f)
    return usda_header(name) + f"""def Xform "{name}" (
    customData = {{
        string Category = "Floor"
        string UUID = "{uuid}"
    }}
    kind = "component"
)
{{
    def Mesh "{name}"
    {{
        int[] faceVertexCounts = [{counts}]
        int[] faceVertexIndices = [{indices}]
        point3f[] points = [{points}]
        uniform token subdivisionScheme = "none"
        matrix4d xformOp:transform = {matrix_text(m)}
        uniform token[] xformOpOrder = ["xformOp:transform"]
    }}
}}
"""


def usdz(scan: Scan) -> bytes:
    """The scan as RoomPlan's parametric USDZ: stored entries, the root layer first."""
    files: list[tuple[str, str]] = []
    groups: list[str] = []
    numbers: dict[str, int] = {}

    def number(kind: str) -> int:
        numbers[kind] = numbers.get(kind, -1) + 1
        return numbers[kind]

    walls = scan.items["walls"]
    for w, wall in enumerate(walls):
        refs = [f"./assets/Parametric/Walls/Wall{w}/Wall{w}.usda"]
        files.append((refs[0][2:], element_layer(f"Wall{w}", "Wall", wall["identifier"],
                                                 wall["transform"], wall["dimensions"])))
        for kind, category in (("doors", None), ("windows", "Window"), ("openings", "Opening")):
            for e in scan.items[kind]:
                if e["parentIdentifier"] != wall["identifier"]:
                    continue
                if kind == "doors":
                    title, cat = "Door", "Door(Isopen: %s)" % e["category"]["door"]["isOpen"]
                else:
                    title, cat = category, category
                name = f"{title}{number(title)}"
                path = f"assets/Parametric/Walls/Wall{w}/{name}.usda"
                refs.append("./" + path)
                files.append((path, element_layer(name, cat, e["identifier"], e["transform"],
                                                  e["dimensions"])))
        listed = ",\n                    ".join(f"@{ref}@" for ref in refs)
        groups.append(f"""            def Xform "Wall_{w}_grp" (
                kind = "group"
                prepend references = [
                    {listed}
                ]
            )
            {{
            }}
""")
    floors = []
    for f, floor in enumerate(scan.items["floors"]):
        path = f"assets/Parametric/Floors/Floor{f}.usda"
        floors.append(f"@./{path}@")
        files.append((path, floor_layer(f"Floor{f}", floor["identifier"], floor["transform"],
                                        floor["polygonCorners"])))
    objects: dict[str, list[str]] = {}
    for o in scan.items["objects"]:
        key = next(iter(o["category"]))
        title = key[0].upper() + key[1:].lower()
        name = f"{title}{number(title)}"
        path = f"assets/Parametric/{title}/{name}.usda"
        objects.setdefault(title, []).append(f"@./{path}@")
        files.append((path, element_layer(name, title, o["identifier"], o["transform"],
                                          o["dimensions"])))
    sections = "".join(
        f"""        def Xform "{s["label"]}{k}" ( kind = "assembly" )
        {{
            matrix4d xformOp:transform = {matrix_text([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, *s["center"], 1])}
            uniform token[] xformOpOrder = ["xformOp:transform"]
        }}
""" for k, s in enumerate(scan.sections))
    object_groups = "".join(
        f"""            def Xform "{title}_grp" ( kind = "group"  prepend references = [ {", ".join(refs)} ] ) {{ }}
""" for title, refs in objects.items())
    root = usda_header("Room") + f"""def Xform "Room" ( kind = "assembly" )
{{
    def Xform "Section_grp" ( kind = "group" )
    {{
{sections}    }}
    def Xform "Parametric_grp" ( kind = "group" )
    {{
        def Xform "Arch_grp" ( kind = "group" )
        {{
{"".join(groups)}        }}
        def Xform "Floor_grp" ( kind = "group"  prepend references = [ {", ".join(floors)} ] ) {{ }}
        def Xform "Object_grp" ( kind = "group" )
        {{
{object_groups}        }}
    }}
}}
"""
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for name, text in [("Room.usda", root), *files]:
            archive.writestr(zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)), text)
    return buffer.getvalue()


# --- Robot vacuum maps (D-057) ---------------------------------------------------------------

# A flat in centimetres, `y` down: the rooms inside their walls, the walls 10 cm thick, the
# doors as gaps in them (x0, y0, x1, y1).
FLAT_ROOMS = [
    ("16", "Living room", "wood", (0, 0, 500, 400)),
    ("17", "Kitchen", "tile", (510, 0, 800, 400)),
    ("18", "Hall", None, (510, 410, 800, 600)),
    ("19", "Bedroom", None, (0, 410, 500, 700)),
]
# Gaps through the 10 cm walls: the living room to the kitchen (wide, an opening), the kitchen
# to the hall, the hall to the bedroom.
FLAT_DOORS = [(500, 150, 510, 330), (600, 400, 680, 410), (500, 450, 510, 540)]
# What the robot goes round: a table's legs and a kitchen island.
FLAT_OBSTACLES = [(200, 180, 205, 185), (300, 180, 305, 185), (200, 260, 205, 265),
                  (300, 260, 305, 265), (620, 160, 720, 230)]
FLAT_DOCK = (790, 500)
FLAT_TURN = 4.0
FLAT_OFFSET = (1210, 1630)


def flat_place(x: float, y: float) -> tuple[float, float]:
    """A point of the flat on the map: turned and moved where the robot's map has it."""
    c, s = math.cos(math.radians(FLAT_TURN)), math.sin(math.radians(FLAT_TURN))
    return (FLAT_OFFSET[0] + x * c - y * s, FLAT_OFFSET[1] + x * s + y * c)


def flat_local(x: float, y: float) -> tuple[float, float]:
    c, s = math.cos(math.radians(FLAT_TURN)), math.sin(math.radians(FLAT_TURN))
    x, y = x - FLAT_OFFSET[0], y - FLAT_OFFSET[1]
    return (x * c + y * s, -x * s + y * c)


def inside(p: tuple[float, float], box: tuple[float, float, float, float]) -> bool:
    return box[0] <= p[0] < box[2] and box[1] <= p[1] < box[3]


def flat_cells(pixel: float) -> tuple[dict[str, list[tuple[int, int]]], list[tuple[int, int]]]:
    """The flat drawn in cells of `pixel` cm on the map: each room's cells (a doorway split
    between its rooms at the middle of its wall) and the walls' cells the laser saw."""
    corners = [flat_place(x, y) for x, y in ((-30, -30), (830, -30), (830, 730), (-30, 730))]
    lo = [math.floor(min(c[k] for c in corners) / pixel) for k in (0, 1)]
    hi = [math.ceil(max(c[k] for c in corners) / pixel) for k in (0, 1)]
    rooms: dict[str, list[tuple[int, int]]] = {r[0]: [] for r in FLAT_ROOMS}
    walls: list[tuple[int, int]] = []
    for py in range(lo[1], hi[1]):
        for px in range(lo[0], hi[0]):
            p = flat_local((px + 0.5) * pixel, (py + 0.5) * pixel)
            if any(inside(p, o) for o in FLAT_OBSTACLES):
                walls.append((px, py))
                continue
            room = next((r[0] for r in FLAT_ROOMS if inside(p, r[3])), None)
            if room is None:
                for d in FLAT_DOORS:
                    if inside(p, d):
                        # The doorway, each half to the room on its side.
                        mid = ((d[0] + d[2]) / 2, (d[1] + d[3]) / 2)
                        wide = d[2] - d[0] > d[3] - d[1]
                        q = (p[0], p[1] - 10) if (wide and p[1] < mid[1]) else \
                            (p[0], p[1] + 10) if wide else \
                            (p[0] - 10, p[1]) if p[0] < mid[0] else (p[0] + 10, p[1])
                        room = next((r[0] for r in FLAT_ROOMS if inside(q, r[3])), None)
            if room is not None:
                rooms[room].append((px, py))
                continue
            # A wall where it is within a cell of a room: what the laser sees.
            near = any(inside((p[0] + dx, p[1] + dy), r[3]) for r in FLAT_ROOMS
                       for dx, dy in ((pixel, 0), (-pixel, 0), (0, pixel), (0, -pixel)))
            if near:
                walls.append((px, py))
    return rooms, walls


def runs(cells: list[tuple[int, int]]) -> list[int]:
    """Valetudo's `compressedPixels`: rows of cells as `x, y, count`."""
    out: list[int] = []
    for x, y in sorted(cells, key=lambda c: (c[1], c[0])):
        if out and out[-2] == y and out[-3] + out[-1] == x:
            out[-1] += 1
        else:
            out += [x, y, 1]
    return out


def valetudo_map() -> dict:
    rooms, walls = flat_cells(5)
    layers = []
    for ident, name, material, _ in FLAT_ROOMS:
        meta: dict = {"segmentId": ident, "active": False, "name": name,
                      "area": len(rooms[ident]) * 25}
        if material:
            meta["material"] = material
        layers.append({"__class": "MapLayer", "metaData": meta, "type": "segment", "pixels": [],
                       "compressedPixels": runs(rooms[ident])})
    layers.append({"__class": "MapLayer", "metaData": {"area": len(walls) * 25}, "type": "wall",
                   "pixels": [], "compressedPixels": runs(walls)})
    dock = [round(v) for v in flat_place(*FLAT_DOCK)]
    path = [round(v) for x, y in ((700, 500), (400, 300), (250, 220)) for v in flat_place(x, y)]
    entities = [
        {"__class": "PointMapEntity", "metaData": {}, "type": "charger_location", "points": dock},
        {"__class": "PointMapEntity", "metaData": {"angle": 270}, "type": "robot_position",
         "points": dock},
        {"__class": "PathMapEntity", "metaData": {}, "type": "path", "points": path},
    ]
    return {"__class": "ValetudoMap", "metaData": {
        "version": 2, "nonce": "00000000-0000-4000-8000-000000000057",
        "totalLayerArea": sum(layer["metaData"]["area"] for layer in layers)},
        "size": {"x": 5120, "y": 5120}, "pixelSize": 5, "layers": layers, "entities": entities}


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def valetudo_png(text: bytes) -> bytes:
    """A 1 × 1 grey picture holding the map as Valetudo publishes it for Home Assistant."""
    head = png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
    pixels = png_chunk(b"IDAT", zlib.compress(b"\x00\x80", 9))
    map_text = png_chunk(b"zTXt", b"ValetudoMap\x00\x00" + zlib.compress(text, 9))
    return b"\x89PNG\r\n\x1a\n" + head + pixels + map_text + png_chunk(b"IEND", b"")


def roborock_map() -> bytes:
    """The flat as Roborock's own map: 5 cm a pixel, rows going up, the rooms' ids in the upper
    five bits of each floor pixel (`id << 3 | 7`), walls `1`; the dock in millimetres."""
    rooms, walls = flat_cells(5)
    every = [c for cells in rooms.values() for c in cells] + walls
    left = min(x for x, _ in every)
    # Rows go up: the map's y is the negated row, so the image starts at the lowest y.
    bottom = max(y for _, y in every)
    top_row = min(y for _, y in every)
    width = max(x for x, _ in every) - left + 1
    height = bottom - top_row + 1
    top = 300
    image = bytearray(width * height)
    for ident, cells in rooms.items():
        for x, y in cells:
            image[(bottom - y) * width + (x - left)] = (int(ident) << 3) | 7
    for x, y in walls:
        image[(bottom - y) * width + (x - left)] = 1
    def block(kind: int, head: bytes, data: bytes) -> bytes:
        return struct.pack("<HHI", kind, 8 + len(head), len(data)) + head + data
    # The dock: x in millimetres, y up, from the image's frame (rows from `top`).
    dx, dy = flat_place(*FLAT_DOCK)
    dock_x = round(dx * 10)
    dock_y = round(((top + (bottom - dy / 5)) * 5) * 10)
    blocks = block(1, b"", struct.pack("<III", dock_x, dock_y, 0))
    blocks += block(3, struct.pack("<III", 2, 4, 0), struct.pack("<HHHH", dock_x, dock_y,
                                                                  dock_x + 100, dock_y))
    blocks += block(2, struct.pack("<iiiii", len(FLAT_ROOMS), top, left, height, width),
                    bytes(image))
    header = b"rr" + struct.pack("<HIHHHHI", 0x14, len(blocks), 1, 1, 0, 0, 1)
    return gzip.compress(header + blocks, 9, mtime=0)


# --- Floorplanner (D-057) ----------------------------------------------------------------------


def fml_point(x: float, y: float) -> dict:
    return {"x": x, "y": y}


def fml_wall(a: tuple[float, float], b: tuple[float, float], thickness: float,
             openings: list[dict] | None = None) -> dict:
    return {"a": fml_point(*a), "b": fml_point(*b), "c": None, "az": {"z": 0, "h": 270},
            "bz": {"z": 0, "h": 270}, "thickness": thickness, "balance": 0.5,
            "decor": {"left": None, "right": None, "top": None, "outline": 0},
            "openings": openings or []}


def fml_opening(t: float, kind: str, width: float, mirrored: tuple[int, int] = (0, 0)) -> dict:
    window = kind == "window"
    return {"refid": f"fp-{kind}-{int(width)}", "t": t, "type": kind, "width": width,
            "z": 90 if window else 0, "z_height": 120 if window else 205,
            "mirrored": list(mirrored), "frameColor": "#FFFFFF"}


def fml_area(points: list[tuple[float, float]], name: str | None, color: str) -> dict:
    area = {"color": color, "showAreaLabel": True, "poly": [fml_point(*p) for p in points]}
    if name:
        area["name"] = name
    return area


def floorplanner() -> dict:
    """A fictional apartment of Floorplanner: façades 20 cm on centre lines 0..900 × 0..600,
    partitions 10 cm at x = 500 and y = 350."""
    def rect(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    ground = {
        "id": 1001, "name": "Ground floor", "level": 0, "height": 270.0,
        "cameras": [{"id": 1, "name": "Camera 1", "type_name": "walkthrough", "fov": 60,
                     "x": 450.0, "y": 300.0, "z": 165.0, "dx": 0.0, "dy": -1.0, "dz": 0.0,
                     "ux": 0.0, "uy": 0.0, "uz": 1.0}],
        "drawing": {"id": 1, "x": 0, "y": 0, "width": 900, "height": 600, "visible": False,
                    "rotation": 0, "alpha": 50, "depth": "LOW"},
        "designs": [{
            "id": 2001, "name": "First design",
            "areas": [
                fml_area(rect(10, 10, 495, 345), "Living room", "#F2D8B0"),
                fml_area(rect(505, 10, 890, 345), None, "#D8E8F2"),
                fml_area(rect(505, 355, 890, 590), "Bathroom", "#E0F0E0"),
                fml_area(rect(10, 355, 495, 590), "Hall", "#F0F0F0"),
            ],
            "labels": [{"x": 700, "y": 180, "text": "Kitchen", "fontFamily": "arial",
                        "fontSize": 20, "letterSpacing": 0, "fontColor": "#000000",
                        "backgroundColor": "#FFFFFF", "align": "center", "rotation": 0},
                       {"x": 700, "y": 210, "text": "12.9 m²", "fontFamily": "arial",
                        "fontSize": 14, "letterSpacing": 0, "fontColor": "#000000",
                        "backgroundColor": "#FFFFFF", "align": "center", "rotation": 0}],
            "walls": [
                fml_wall((0, 0), (900, 0), 20, [fml_opening(0.25, "window", 140),
                                                fml_opening(0.75, "window", 100)]),
                fml_wall((900, 0), (900, 600), 20),
                fml_wall((900, 600), (0, 600), 20, [fml_opening(0.2, "window", 80)]),
                fml_wall((0, 600), (0, 0), 20, [fml_opening(0.25, "door", 90, (1, 0))]),
                fml_wall((500, 0), (500, 600), 10, [fml_opening(0.29, "door", 140),
                                                    fml_opening(0.79, "door", 80, (0, 1))]),
                fml_wall((0, 350), (500, 350), 10, [fml_opening(0.5, "door", 83)]),
                fml_wall((500, 350), (900, 350), 10),
            ],
            "items": [
                {"refid": "5fde815109db6138037f911f48b6fb5578dfcdf1", "name": "Sofa 3 seats",
                 "x": 250.0, "y": 290.0, "z": 0, "width": 210.0, "height": 90.0,
                 "z_height": 85.0, "rotation": 180.0},
                {"refid": "a41c62e40f0b3c0e8f9a3df2c0b5d8a1e7f6c3b2", "x": 250.0, "y": 150.0,
                 "z": 0, "width": 120.0, "height": 60.0, "z_height": 45.0, "rotation": 0.0},
                {"refid": "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00", "name": "Fridge",
                 "x": 860.0, "y": 50.0, "z": 0, "width": 60.0, "height": 65.0,
                 "z_height": 180.0, "rotation": 270.0},
                {"refid": "0badc0de0badc0de0badc0de0badc0de0badc0de", "name": "Bathtub",
                 "x": 815.0, "y": 520.0, "z": 0, "width": 170.0, "height": 75.0,
                 "z_height": 55.0, "rotation": 0.0},
            ],
            "lines": [{"type": "solid_line", "color": 4013372, "thickness": 4,
                       "a": fml_point(-50, -50), "b": fml_point(950, -50)}],
            "dimensions": [{"type": "custom_dimension", "a": fml_point(0, -80),
                            "b": fml_point(900, -80)}],
            "surfaces": [{"color": "#ABABAC", "rotation": 0, "showAreaLabel": True,
                          "poly": [{"x": 0, "y": 610, "z": 0}, {"x": 400, "y": 610, "z": 0},
                                   {"x": 400, "y": 800, "z": 0}, {"x": 0, "y": 800, "z": 0}]}],
        }],
    }
    attic = {
        "id": 1002, "name": "Attic", "level": 1, "height": 240.0, "cameras": [],
        "designs": [{"id": 2002, "name": "First design", "areas": [], "items": [],
                     "labels": [], "walls": [
                         fml_wall((0, 0), (900, 0), 20, [fml_opening(0.5, "window", 100)]),
                         fml_wall((900, 0), (900, 600), 20),
                         fml_wall((900, 600), (0, 600), 20),
                         fml_wall((0, 600), (0, 0), 20),
                     ]}],
    }
    return {"id": 3001, "name": "Fictional apartment", "description": "Made up for the tests.",
            "public": False, "settings": {"wallHeight": 270, "wallThickness": 10,
                                          "wallOuterThickness": 20, "useMetric": True},
            "floors": [ground, attic]}


# --- Mesh scans (D-057) ------------------------------------------------------------------------


class Mesh:
    """A fictional scanned mesh: what a scan sees of boxes (their visible faces), cut in quads
    of at most 50 cm, its vertices a little uneven."""

    def __init__(self) -> None:
        self.points: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, int, int]] = []
        self.seed = 12345

    def jitter(self) -> float:
        # A small linear congruential generator: the same file every time.
        self.seed = (self.seed * 1103515245 + 12345) % (1 << 31)
        return (self.seed / (1 << 31) - 0.5) * 0.008

    def quad(self, a, b, c, d) -> None:
        """A flat quad, cut in a grid of cells at most 50 cm."""
        def lerp(p, q, t):
            return tuple(p[k] + (q[k] - p[k]) * t for k in range(3))
        nu = max(1, math.ceil(math.dist(a, b) / 0.5))
        nv = max(1, math.ceil(math.dist(a, d) / 0.5))
        base = len(self.points)
        for j in range(nv + 1):
            left, right = lerp(a, d, j / nv), lerp(b, c, j / nv)
            for i in range(nu + 1):
                p = lerp(left, right, i / nu)
                self.points.append(tuple(v + self.jitter() for v in p))
        for j in range(nv):
            for i in range(nu):
                k = base + j * (nu + 1) + i
                self.faces.append((k, k + 1, k + nu + 2))
                self.faces.append((k, k + nu + 2, k + nu + 1))

    def box(self, lo, hi, skip: str = "") -> None:
        """A box's faces looking out, but for those named in `skip` (t top, b bottom, the sides
        -x, +x, -z, +z as l, r, k, f)."""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        faces = {
            "t": ((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)),
            "b": ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)),
            "l": ((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)),
            "r": ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)),
            "k": ((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)),
            "f": ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)),
        }
        for name, quad in faces.items():
            if name not in skip:
                self.quad(*quad)

    def placed(self, turn: float, at: tuple[float, float, float], scale: float = 1.0):
        """The points turned about y by `turn` degrees, moved by `at`, scaled."""
        c, s = math.cos(math.radians(turn)), math.sin(math.radians(turn))
        return [((x * c + z * s + at[0]) * scale, (y + at[1]) * scale,
                 (-x * s + z * c + at[2]) * scale) for x, y, z in self.points]


def storey(m: Mesh, floor: float, height: float, rooms: str) -> None:
    """A storey of the house, 8.1 × 5 m inside: façades 20 cm, partitions 10 cm, seen from inside.

    Ground floor (`rooms` = "ground"): a living room (0–5 × 0–5), a kitchen (5.1–8.1 × 0–2.4)
    and a hall (5.1–8.1 × 2.5–5) with the front door; upstairs ("upper"): a bedroom and the
    landing, its bathroom.
    """
    f, h, t = floor, floor + height, 0.2
    W, D = 8.1, 5.0
    m.quad((0, f, 0), (0, f, D), (W, f, D), (W, f, 0))
    m.quad((0, h, 0), (W, h, 0), (W, h, D), (0, h, D))

    def wall(lo, hi, skip=""):
        # Walls stop at the floor and the ceiling: their top and bottom unseen.
        m.box((lo[0], f + lo[1], lo[2]), (hi[0], f + hi[1], hi[2]), "tb" + skip)

    def head(lo, hi, skip=""):
        # Above a door or a window: its underside seen.
        m.box((lo[0], f + lo[1], lo[2]), (hi[0], f + hi[1], hi[2]), "t" + skip)

    def sill(lo, hi, skip=""):
        m.box((lo[0], f + lo[1], lo[2]), (hi[0], f + hi[1], hi[2]), "b" + skip)

    hh = height
    # The back façade (z = 5–5.2) and the side façades, whole but for a window.
    wall((-t, 0, D), (W + t, hh, D + t), "f")
    wall((-t, 0, 0), (0, hh, D), "l")
    if rooms == "ground":
        # The front door into the hall, in the side façade: 95 cm under its head.
        wall((W, 0, 0), (W + t, hh, 3.4), "r")
        head((W, 2.05, 3.4), (W + t, hh, 4.35), "r")
        wall((W, 0, 4.35), (W + t, hh, D), "r")
    else:
        wall((W, 0, 0), (W + t, hh, D), "r")
    # The front façade (z = -0.2–0): a window of the first room (1.5–2.9 m, 0.9–2.1 m high).
    wall((-t, 0, -t), (1.5, hh, 0), "k")
    sill((1.5, 0, -t), (2.9, 0.9, 0), "k")
    head((1.5, 2.1, -t), (2.9, hh, 0), "k")
    if rooms == "ground":
        # The kitchen's window (6.0–7.0), the front door into the hall (side façade at x = W).
        wall((2.9, 0, -t), (6.0, hh, 0), "k")
        sill((6.0, 0, -t), (7.0, 0.9, 0), "k")
        head((6.0, 2.1, -t), (7.0, hh, 0), "k")
        wall((7.0, 0, -t), (W + t, hh, 0), "k")
    else:
        wall((2.9, 0, -t), (W + t, hh, 0), "k")
    # The partition at x = 5.0–5.1, a door from z = 3.2 to 4.1 into the hall or the landing.
    wall((5.0, 0, 0), (5.1, hh, 3.2))
    wall((5.0, 0, 4.1), (5.1, hh, D))
    head((5.0, 2.05, 3.2), (5.1, hh, 4.1))
    # The partition at z = 2.4–2.5 across the right part, a door from x = 6.2 to 7.0.
    wall((5.1, 0, 2.4), (6.2, hh, 2.5))
    wall((7.0, 0, 2.4), (W, hh, 2.5))
    head((6.2, 2.05, 2.4), (7.0, hh, 2.5))
    # Furniture.
    if rooms == "ground":
        m.box((1.0, f, 3.9), (3.2, f + 0.85, 4.8), "b")          # a sofa
        m.box((1.8, f, 1.5), (2.8, f + 0.45, 2.1), "b")          # a coffee table
        m.box((5.1, f, 0.0), (8.1, f + 0.9, 0.6), "bk")          # the kitchen counter
        m.box((5.1, f + 1.5, 0.0), (6.2, f + 2.3, 0.35), "k")    # wall cabinets
        m.box((7.4, f, 0.0), (8.1, f + 2.3, 0.65), "bkr")        # a tall fridge column
    else:
        m.box((0.5, f, 1.0), (2.1, f + 0.5, 3.0), "b")           # a bed
        m.box((0.0, f, 4.4), (2.0, f + 2.3, 5.0), "blf")         # a wardrobe to the ceiling's lintel
        m.box((7.3, f, 0.0), (8.1, f + 0.55, 1.7), "bkr")        # a bathtub


def house() -> tuple[Mesh, Mesh]:
    """The house's two storeys (2.5 m high, the upper floor 2.8 m up), each a mesh of its own."""
    ground, upper = Mesh(), Mesh()
    storey(ground, 0.0, 2.5, "ground")
    storey(upper, 2.8, 2.5, "upper")
    upper.seed = 777
    return ground, upper


def obj_text(meshes: list[tuple[Mesh, list]]) -> str:
    lines = ["# A fictional house scanned as a mesh (DomoTwin's tests)", "o house"]
    base = 1
    for mesh, points in meshes:
        lines += [f"v {x:.4f} {y:.4f} {z:.4f}" for x, y, z in points]
    for mesh, points in meshes:
        lines += [f"f {a + base} {b + base} {c + base}" for a, b, c in mesh.faces]
        base += len(points)
    return "\n".join(lines) + "\n"


def glb(meshes: list[tuple[Mesh, list]]) -> bytes:
    """A GLB: a node a storey, under a root node that moves them; its positions and indices in
    one buffer."""
    binary = bytearray()
    accessors, views, primitives = [], [], []
    for mesh, points in meshes:
        lo = [min(p[k] for p in points) for k in range(3)]
        hi = [max(p[k] for p in points) for k in range(3)]
        offset = len(binary)
        for p in points:
            binary += struct.pack("<3f", *p)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(binary) - offset})
        accessors.append({"bufferView": len(views) - 1, "componentType": 5126,
                          "count": len(points), "type": "VEC3", "min": lo, "max": hi})
        offset = len(binary)
        for face in mesh.faces:
            binary += struct.pack("<3I", *face)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(binary) - offset})
        accessors.append({"bufferView": len(views) - 1, "componentType": 5125,
                          "count": 3 * len(mesh.faces), "type": "SCALAR"})
        primitives.append({"attributes": {"POSITION": len(accessors) - 2},
                           "indices": len(accessors) - 1, "mode": 4})
    doc = {
        "asset": {"version": "2.0", "generator": "DomoTwin's tests"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "house", "children": [1, 2], "translation": [-3.0, 0.0, 2.0]},
                  {"name": "ground floor", "mesh": 0}, {"name": "upper floor", "mesh": 1}],
        "meshes": [{"primitives": [primitives[0]]}, {"primitives": [primitives[1]]}],
        "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    text = json.dumps(doc, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    body = struct.pack("<I4s", len(text), b"JSON") + text
    body += struct.pack("<I4s", len(binary), b"BIN\x00") + bytes(binary)
    return struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body


def ply(mesh: Mesh, points: list) -> bytes:
    """A binary PLY, `z` up, in centimetres, with a colour a vertex as scanners write."""
    header = (
        "ply\nformat binary_little_endian 1.0\ncomment a fictional scan\n"
        f"element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        f"element face {len(mesh.faces)}\nproperty list uchar int vertex_indices\nend_header\n"
    ).encode()
    body = bytearray()
    for x, y, z in points:
        # `y` up to `z` up, not mirrored: (x, -z, y).
        body += struct.pack("<3f3B", x * 100, -z * 100, y * 100, 200, 200, 200)
    for face in mesh.faces:
        body += struct.pack("<B3i", 3, *face)
    return header + bytes(body)


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    (FIXTURES / "cottage.sh3d").write_bytes(cottage())
    (FIXTURES / "studio.dxf").write_text(studio(), encoding="utf-8", newline="\n")
    scan = living_scan()
    (FIXTURES / "scan.json").write_text(json.dumps(scan.json(), indent=1) + "\n", encoding="utf-8")
    (FIXTURES / "scan.usdz").write_bytes(usdz(scan))
    structure = structure_scan()
    (FIXTURES / "structure.json").write_text(json.dumps(structure_json(structure), indent=1)
                                             + "\n", encoding="utf-8")
    # The same structure as its USDZ, which does not say the stories.
    (FIXTURES / "structure.usdz").write_bytes(usdz(structure))
    robot = json.dumps(valetudo_map(), separators=(",", ":"))
    (FIXTURES / "robot.json").write_text(robot + "\n", encoding="utf-8")
    (FIXTURES / "robot.png").write_bytes(valetudo_png(robot.encode()))
    (FIXTURES / "roborock.gz").write_bytes(roborock_map())
    (FIXTURES / "apartment.fml").write_text(json.dumps(floorplanner(), indent=1) + "\n",
                                            encoding="utf-8")
    ground, upper = house()
    meshes = [(ground, ground.placed(12.0, (1.3, 0.0, -0.7))),
              (upper, upper.placed(12.0, (1.3, 0.0, -0.7)))]
    (FIXTURES / "house.obj").write_text(obj_text(meshes), encoding="utf-8", newline="\n")
    (FIXTURES / "house.glb").write_bytes(glb(meshes))
    (FIXTURES / "house.ply").write_bytes(ply(ground, ground.placed(-7.0, (0.0, 0.0, 0.0))))
    for name in ("cottage.sh3d", "studio.dxf", "scan.json", "scan.usdz", "structure.json",
                 "structure.usdz", "robot.json", "robot.png", "roborock.gz", "apartment.fml",
                 "house.obj", "house.glb", "house.ply"):
        print(f"crates/domotwin-import/tests/fixtures/{name}")


if __name__ == "__main__":
    main()
