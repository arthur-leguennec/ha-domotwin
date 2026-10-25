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
"""

from __future__ import annotations

import json
import math
import zipfile
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
    for name in ("cottage.sh3d", "studio.dxf", "scan.json", "scan.usdz", "structure.json",
                 "structure.usdz"):
        print(f"crates/domotwin-import/tests/fixtures/{name}")


if __name__ == "__main__":
    main()
