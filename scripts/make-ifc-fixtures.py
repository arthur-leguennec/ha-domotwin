#!/usr/bin/env python3
"""Writes the fictional IFC files used to test the IFC import (and the example to try it).

    python3 scripts/make-ifc-fixtures.py

Every file describes an invented home; nothing comes from a real building. The output is
deterministic (fixed ids and timestamp), so the files only change when this script does.

- crates/domotwin-import/tests/fixtures/apartment-ifc4.ifc   IFC4, millimetres, one storey: spaces
  with polyline, rectangle and indexed outlines, walls with material layers, doors filling
  openings (single, double, sliding, folding), windows, furniture with shared mapped geometry, an
  outside space and a gross-area space to leave out, an unknown proxy.
- crates/domotwin-import/tests/fixtures/house-ifc2x3.ifc     IFC2x3, metres, two storeys, the
  building turned by 30° far from the origin, footprint curves, a brep, door styles, names only.
  The fridge carries what IFC2x3 says of its warranty (a calendar date and a period in seconds).
- crates/domotwin-import/tests/fixtures/studio-feet-ifc4.ifc IFC4 in feet.
- crates/domotwin-import/tests/fixtures/utility-ifc4.ifc     IFC4, a kitchen and a utility room whose
  appliances carry what is needed to look after them (D-033): manufacturer, model and serial
  number, installation, warranty and service life, on the piece, on its type and in an asset.
- crates/domotwin-import/tests/fixtures/no-spaces-ifc4.ifc   walls only.
- examples/demo-apartment.ifc                            the IFC4 apartment, to try the import.
"""

from __future__ import annotations

import hashlib
import math
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "crates" / "domotwin-import" / "tests" / "fixtures"
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def guid(name: str) -> str:
    """A stable 22-character IFC GlobalId made from a name."""
    n = int.from_bytes(hashlib.sha256(name.encode()).digest()[:16], "big")
    chars = []
    for i in range(22):
        chars.append(ALPHABET[n % 64] if i < 21 else ALPHABET[n % 4])
        n //= 64
    return "".join(reversed(chars))


def text(s: str) -> str:
    """A STEP string: quotes doubled, non-ASCII as \\X2\\ UTF-16."""
    out = []
    for c in s:
        if c == "'":
            out.append("''")
        elif c == "\\":
            out.append("\\\\")
        elif ord(c) < 128:
            out.append(c)
        else:
            out.append("\\X2\\%04X\\X0\\" % ord(c))
    return "'" + "".join(out) + "'"


def num(x: float) -> str:
    s = repr(round(float(x), 6))
    return s if "." in s or "e" in s else s + "."


class Ifc:
    """A STEP file being written; lengths are given in metres and written in the file's unit."""

    def __init__(self, schema: str, unit: float):
        self.schema = schema
        self.unit = unit  # metres per file unit
        self.lines: list[str] = []
        self.owner = None

    def add(self, entity: str) -> str:
        self.lines.append(entity)
        return f"#{len(self.lines)}"

    def length(self, metres: float) -> str:
        return num(metres / self.unit)

    def point(self, *coords: float) -> str:
        return self.add(f"IFCCARTESIANPOINT(({','.join(self.length(c) for c in coords)}))")

    def direction(self, *coords: float) -> str:
        return self.add(f"IFCDIRECTION(({','.join(num(c) for c in coords)}))")

    def axis3(self, x=0.0, y=0.0, z=0.0, angle=0.0) -> str:
        """A placement at (x, y, z) turned by `angle` degrees about Z."""
        a = math.radians(angle)
        ref = self.direction(math.cos(a), math.sin(a), 0.0) if angle else "$"
        axis = self.direction(0.0, 0.0, 1.0) if angle else "$"
        return self.add(f"IFCAXIS2PLACEMENT3D({self.point(x, y, z)},{axis},{ref})")

    def local(self, parent: str | None, x=0.0, y=0.0, z=0.0, angle=0.0) -> str:
        return self.add(f"IFCLOCALPLACEMENT({parent or '$'},{self.axis3(x, y, z, angle)})")

    def polyline(self, points) -> str:
        refs = [self.point(*p) for p in points]
        return self.add(f"IFCPOLYLINE(({','.join(refs + refs[:1])}))")

    def extrusion(self, profile: str, height: float, position: str | None = None) -> str:
        return self.add(
            f"IFCEXTRUDEDAREASOLID({profile},{position or self.axis3()},"
            f"{self.direction(0.0, 0.0, 1.0)},{self.length(height)})"
        )

    def box(self, x0, y0, z0, x1, y1, z1) -> str:
        """An extruded rectangle from (x0, y0, z0) to (x1, y1, z1)."""
        position = self.add(
            f"IFCAXIS2PLACEMENT2D({self.point((x0 + x1) / 2, (y0 + y1) / 2)},$)"
        )
        profile = self.add(
            f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{position},{self.length(x1 - x0)},{self.length(y1 - y0)})"
        )
        return self.extrusion(profile, z1 - z0, self.axis3(0.0, 0.0, z0))

    def shape(self, context: str, items: list[str], identifier="Body", kind="SweptSolid") -> str:
        representation = self.add(
            f"IFCSHAPEREPRESENTATION({context},'{identifier}','{kind}',({','.join(items)}))"
        )
        return self.add(f"IFCPRODUCTDEFINITIONSHAPE($,$,({representation}))")

    def write(self, path: Path, name: str) -> None:
        head = [
            "ISO-10303-21;",
            "HEADER;",
            "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
            f"FILE_NAME({text(name)},'2026-01-01T00:00:00',(''),(''),'DomoTwin fixtures','DomoTwin fixtures','');",
            f"FILE_SCHEMA(('{self.schema}'));",
            "ENDSEC;",
            "DATA;",
        ]
        body = [f"#{i + 1}={line};" for i, line in enumerate(self.lines)]
        tail = ["ENDSEC;", "END-ISO-10303-21;", ""]
        path.write_text("\n".join(head + body + tail), encoding="ascii")


class Builder:
    """Project, context, site, building and storeys, with the relations kept until the end."""

    def __init__(self, ifc: Ifc, project: str, building: str, unit_entities: list[str], placement=(0.0, 0.0, 0.0, 0.0)):
        self.ifc = ifc
        self.n = 0
        person = ifc.add("IFCPERSON($,$,'',$,$,$,$,$)")
        org = ifc.add("IFCORGANIZATION($,'Fictional',$,$,$)")
        po = ifc.add(f"IFCPERSONANDORGANIZATION({person},{org},$)")
        app = ifc.add(f"IFCAPPLICATION({org},'1.0','DomoTwin fixtures','fixtures')")
        if ifc.schema == "IFC2X3":
            self.owner = ifc.add(f"IFCOWNERHISTORY({po},{app},$,.ADDED.,$,$,$,0)")
        else:
            self.owner = ifc.add(f"IFCOWNERHISTORY({po},{app},$,.ADDED.,$,$,$,0)")
        units = ifc.add(f"IFCUNITASSIGNMENT(({','.join(unit_entities)}))")
        world = ifc.axis3()
        self.context = ifc.add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,{world},$)")
        self.project = ifc.add(
            f"IFCPROJECT('{guid(project)}',{self.owner},{text(project)},$,$,$,$,({self.context}),{units})"
        )
        x, y, z, angle = placement
        site_place = ifc.local(None, x, y, z, angle)
        self.site = ifc.add(
            f"IFCSITE('{guid(project + 'site')}',{self.owner},'Site',$,$,{site_place},$,$,.ELEMENT.,$,$,$,$,$)"
        )
        self.building_place = ifc.local(site_place)
        self.building = ifc.add(
            f"IFCBUILDING('{guid(project + 'building')}',{self.owner},{text(building)},$,$,{self.building_place},$,$,.ELEMENT.,$,$,$)"
        )
        self.aggregate(self.project, [self.site])
        self.aggregate(self.site, [self.building])
        self.storeys: list[str] = []
        self.contained: dict[str, list[str]] = {}
        self.spaces: dict[str, list[str]] = {}

    def gid(self, label: str) -> str:
        self.n += 1
        return guid(f"{self.ifc.schema}-{label}-{self.n}")

    def aggregate(self, whole: str, parts: list[str]) -> None:
        self.ifc.add(f"IFCRELAGGREGATES('{self.gid('agg')}',{self.owner},$,$,{whole},({','.join(parts)}))")

    def storey(self, name: str, elevation: float) -> tuple[str, str]:
        place = self.ifc.local(self.building_place, 0.0, 0.0, elevation)
        storey = self.ifc.add(
            f"IFCBUILDINGSTOREY('{self.gid(name)}',{self.owner},{text(name)},$,$,{place},$,$,.ELEMENT.,{self.ifc.length(elevation)})"
        )
        self.storeys.append(storey)
        self.contained[storey] = []
        self.spaces[storey] = []
        return storey, place

    def space(self, storey: str, place: str, name: str, long_name: str, outline: str, x=0.0, y=0.0,
              external=False, identifier="Body", height=2.5) -> str:
        ifc = self.ifc
        local = ifc.local(place, x, y, 0.0)
        if identifier == "FootPrint":
            item = outline
            shape = ifc.shape(self.context, [item], "FootPrint", "Curve2D")
        else:
            shape = ifc.shape(self.context, [outline])
        if ifc.schema == "IFC2X3":
            kind = ".EXTERNAL." if external else ".INTERNAL."
            space = ifc.add(
                f"IFCSPACE('{self.gid(name)}',{self.owner},{text(name)},$,$,{local},{shape},{text(long_name)},.ELEMENT.,{kind},$)"
            )
        else:
            kind = ".EXTERNAL." if external else ".INTERNAL."
            space = ifc.add(
                f"IFCSPACE('{self.gid(name)}',{self.owner},{text(name)},$,$,{local},{shape},{text(long_name)},.ELEMENT.,{kind},$)"
            )
        self.spaces[storey].append(space)
        return space

    def finish(self) -> None:
        ifc = self.ifc
        self.aggregate(self.building, self.storeys)
        for storey in self.storeys:
            if self.spaces[storey]:
                self.aggregate(storey, self.spaces[storey])
            if self.contained[storey]:
                ifc.add(
                    f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{self.gid('contained')}',{self.owner},$,$,({','.join(self.contained[storey])}),{storey})"
                )

    def wall(self, storey: str, place: str, name: str, a, b, thickness: float, external: bool,
             height=2.6, standard=False) -> str:
        """A straight wall from a to b (its axis), with a material layer and IsExternal."""
        ifc = self.ifc
        (x0, y0), (x1, y1) = a, b
        angle = math.degrees(math.atan2(y1 - y0, x1 - x0))
        length = math.hypot(x1 - x0, y1 - y0)
        local = ifc.local(place, x0, y0, 0.0, angle)
        body = ifc.box(0.0, -thickness / 2, 0.0, length, thickness / 2, height)
        shape = ifc.shape(self.context, [body])
        cls = "IFCWALLSTANDARDCASE" if standard else "IFCWALL"
        if ifc.schema == "IFC2X3":
            wall = ifc.add(f"{cls}('{self.gid(name)}',{self.owner},{text(name)},$,$,{local},{shape},$)")
        else:
            wall = ifc.add(f"{cls}('{self.gid(name)}',{self.owner},{text(name)},$,$,{local},{shape},$,.STANDARD.)")
        material = ifc.add("IFCMATERIAL('Plaster',$,$)" if ifc.schema != "IFC2X3" else "IFCMATERIAL('Plaster')")
        layer = ifc.add(
            f"IFCMATERIALLAYER({material},{ifc.length(thickness)},$,$,$,$,$)"
            if ifc.schema != "IFC2X3"
            else f"IFCMATERIALLAYER({material},{ifc.length(thickness)},$)"
        )
        layers = ifc.add(
            f"IFCMATERIALLAYERSET(({layer}),'Wall {int(round(thickness * 100))} cm',$)"
            if ifc.schema != "IFC2X3"
            else f"IFCMATERIALLAYERSET(({layer}),'Wall {int(round(thickness * 100))} cm')"
        )
        usage = ifc.add(
            f"IFCMATERIALLAYERSETUSAGE({layers},.AXIS2.,.POSITIVE.,{ifc.length(-thickness / 2)},$)"
            if ifc.schema != "IFC2X3"
            else f"IFCMATERIALLAYERSETUSAGE({layers},.AXIS2.,.POSITIVE.,{ifc.length(-thickness / 2)})"
        )
        ifc.add(f"IFCRELASSOCIATESMATERIAL('{self.gid('mat')}',{self.owner},$,$,({wall}),{usage})")
        value = ifc.add(f"IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN({'.T.' if external else '.F.'}),$)")
        pset = ifc.add(f"IFCPROPERTYSET('{self.gid('pset')}',{self.owner},'Pset_WallCommon',$,({value}))")
        ifc.add(f"IFCRELDEFINESBYPROPERTIES('{self.gid('defines')}',{self.owner},$,$,({wall}),{pset})")
        self.contained[storey].append(wall)
        return wall

    def opening_in(self, storey: str, place: str, wall: str, kind: str, name: str, origin, angle: float,
                   width: float, height: float, sill: float, operation: str | None = None,
                   depth: float = 0.1, contained: bool = True, style: str | None = None) -> str:
        """A door or window in an opening of `wall`: `origin` is its lining corner on the wall's
        axis, x along the wall by `angle`, y the opening direction."""
        ifc = self.ifc
        x, y = origin
        opening_place = ifc.local(place, x, y, sill, angle)
        opening_body = ifc.box(0.0, -depth, 0.0, width, depth, height)
        opening = ifc.add(
            f"IFCOPENINGELEMENT('{self.gid('opening')}',{self.owner},'Opening',$,$,{opening_place},{ifc.shape(self.context, [opening_body])},$"
            + ("" if ifc.schema == "IFC2X3" else ",.OPENING.")
            + ")"
        )
        ifc.add(f"IFCRELVOIDSELEMENT('{self.gid('voids')}',{self.owner},$,$,{wall},{opening})")
        place_el = ifc.local(opening_place)
        body = ifc.box(0.0, -0.03, 0.0, width, 0.03, height)
        shape = ifc.shape(self.context, [body])
        cls = "IFCDOOR" if kind == "door" else "IFCWINDOW"
        if ifc.schema == "IFC2X3":
            element = ifc.add(
                f"{cls}('{self.gid(name)}',{self.owner},{text(name)},$,$,{place_el},{shape},$,{ifc.length(height)},{ifc.length(width)})"
            )
            if style:
                ifc.add(f"IFCRELDEFINESBYTYPE('{self.gid('type')}',{self.owner},$,$,({element}),{style})")
        else:
            if kind == "door":
                tail = f",.DOOR.,.{operation or 'SINGLE_SWING_LEFT'}.,$"
            else:
                tail = ",.WINDOW.,.SINGLE_PANEL.,$"
            element = ifc.add(
                f"{cls}('{self.gid(name)}',{self.owner},{text(name)},$,$,{place_el},{shape},$,{ifc.length(height)},{ifc.length(width)}{tail})"
            )
        ifc.add(f"IFCRELFILLSELEMENT('{self.gid('fills')}',{self.owner},$,$,{opening},{element})")
        if contained:
            self.contained[storey].append(element)
        return element


def ifc4_units(ifc: Ifc, length_prefix: str | None) -> list[str]:
    prefix = f".{length_prefix}." if length_prefix else "$"
    return [
        ifc.add(f"IFCSIUNIT(*,.LENGTHUNIT.,{prefix},.METRE.)"),
        ifc.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
        ifc.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
    ]


def rectangle(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def apartment_ifc4() -> Ifc:
    """A fictional two-bedroom-less flat: living room, kitchen, bedroom, bathroom, hall, storage."""
    ifc = Ifc("IFC4", 0.001)
    units = ifc4_units(ifc, "MILLI")
    b = Builder(ifc, "Fictional apartment", "Fictional building", units)
    storey, place = b.storey("Level 0", 0.0)
    ctx = b.context

    # Spaces (net areas): exterior walls 30 cm, partitions 10 cm.
    living = b.space(storey, place, "001", "Living room", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(0.3, 0.3, 5.3, 4.3))})"), 2.5))
    kitchen_profile = ifc.add(
        f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{ifc.add(f'IFCAXIS2PLACEMENT2D({ifc.point(1.5, 2.0)},$)')},{ifc.length(3.0)},{ifc.length(4.0)})"
    )
    b.space(storey, place, "002", "Kitchen", ifc.extrusion(kitchen_profile, 2.5), x=5.4, y=0.3)
    coords = ",".join(f"({ifc.length(x)},{ifc.length(y)})" for x, y in rectangle(0.0, 0.0, 4.0, 3.6))
    points = ifc.add(f"IFCCARTESIANPOINTLIST2D(({coords}),$)")
    curve = ifc.add(f"IFCINDEXEDPOLYCURVE({points},(IFCLINEINDEX((1,2,3,4,1))),.F.)")
    b.space(storey, place, "003", "Bedroom", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{curve})"), 2.5), x=0.3, y=4.4)
    b.space(storey, place, "004", "Bathroom", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(0.0, 0.0, 2.0, 2.0))})"), 2.5), x=4.4, y=4.4)
    b.space(storey, place, "005", "Hall", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(6.5, 4.4, 8.4, 8.0))})"), 2.5))
    b.space(storey, place, "006", "Storage", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(4.4, 6.5, 6.4, 8.0))})"), 2.5))
    # Left out: a balcony outside, and the gross area of the whole flat.
    b.space(storey, place, "B01", "Balcony", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(1.0, -1.5, 4.0, -0.0))})"), 2.5),
        external=True)
    b.space(storey, place, "GFA", "Gross floor area", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(0.0, 0.0, 8.7, 8.3))})"), 2.5))

    # Walls (axes).
    north = b.wall(storey, place, "Exterior wall N", (0.0, 0.15), (8.7, 0.15), 0.3, True)
    south = b.wall(storey, place, "Exterior wall S", (0.0, 8.15), (8.7, 8.15), 0.3, True)
    west = b.wall(storey, place, "Exterior wall W", (0.15, 0.0), (0.15, 8.3), 0.3, True)
    b.wall(storey, place, "Exterior wall E", (8.55, 0.0), (8.55, 8.3), 0.3, True)
    living_kitchen = b.wall(storey, place, "Partition 1", (5.35, 0.3), (5.35, 4.3), 0.1, False)
    middle = b.wall(storey, place, "Partition 2", (0.3, 4.35), (8.4, 4.35), 0.1, False)
    bath_hall = b.wall(storey, place, "Partition 3", (6.45, 4.4), (6.45, 8.0), 0.1, False)
    b.wall(storey, place, "Partition 4", (4.35, 4.4), (4.35, 8.0), 0.1, False)
    b.wall(storey, place, "Partition 5", (4.4, 6.45), (6.4, 6.45), 0.1, False)

    # Doors: the lining corner on the wall axis, x along the wall, y the side the door opens to.
    b.opening_in(storey, place, south, "door", "Entrance door", (7.9, 8.15), 180.0, 0.9, 2.1, 0.0, "SINGLE_SWING_LEFT", 0.15)
    b.opening_in(storey, place, middle, "door", "Kitchen door", (7.0, 4.35), 0.0, 0.8, 2.1, 0.0, "SINGLE_SWING_RIGHT")
    b.opening_in(storey, place, living_kitchen, "door", "Glazed double door", (5.35, 1.0), 90.0, 1.4, 2.1, 0.0, "DOUBLE_DOOR_SINGLE_SWING")
    b.opening_in(storey, place, middle, "door", "Bedroom door", (3.0, 4.35), 0.0, 0.8, 2.1, 0.0, "SLIDING_TO_LEFT")
    b.opening_in(storey, place, bath_hall, "door", "Bathroom door", (6.45, 5.0), 90.0, 0.7, 2.1, 0.0, "SINGLE_SWING_LEFT")
    b.opening_in(storey, place, bath_hall, "door", "Storage door", (6.45, 6.8), 90.0, 0.8, 2.1, 0.0, "FOLDING_TO_LEFT")
    # Windows.
    b.opening_in(storey, place, north, "window", "Living window 1", (1.0, 0.15), 0.0, 1.6, 1.3, 0.9, depth=0.15)
    b.opening_in(storey, place, north, "window", "Living window 2", (3.2, 0.15), 0.0, 1.4, 1.3, 0.9, depth=0.15)
    b.opening_in(storey, place, north, "window", "Kitchen window", (6.2, 0.15), 0.0, 1.2, 1.1, 1.0, depth=0.15)
    b.opening_in(storey, place, west, "window", "Bedroom window", (0.15, 5.5), 90.0, 1.5, 1.3, 0.9, depth=0.15)

    # Furniture: shared shapes (representation maps) placed by mapped items.
    def shared(size, name):
        w, d, h = size
        body = ifc.box(-w / 2, -d / 2, 0.0, w / 2, d / 2, h)
        rep = ifc.add(f"IFCSHAPEREPRESENTATION({ctx},'Body','SweptSolid',({body}))")
        return ifc.add(f"IFCREPRESENTATIONMAP({ifc.axis3()},{rep})")

    def piece(cls, name, mapping, x, y, angle=0.0, z=0.0, predefined=None, object_type=None):
        local = ifc.local(place, x, y, z, angle)
        operator = ifc.add(f"IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,{ifc.point(0.0, 0.0, 0.0)},1.,$)")
        item = ifc.add(f"IFCMAPPEDITEM({mapping},{operator})")
        rep = ifc.add(f"IFCSHAPEREPRESENTATION({ctx},'Body','MappedRepresentation',({item}))")
        shape = ifc.add(f"IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))")
        pre = f".{predefined}." if predefined else "$"
        ot = text(object_type) if object_type else "$"
        if cls == "IFCBUILDINGELEMENTPROXY":
            element = ifc.add(f"{cls}('{b.gid(name)}',{b.owner},{text(name)},$,{ot},{local},{shape},$,$)")
        else:
            element = ifc.add(f"{cls}('{b.gid(name)}',{b.owner},{text(name)},$,{ot},{local},{shape},$,{pre})")
        b.contained[storey].append(element)
        return element

    piece("IFCFURNITURE", "Sofa", shared((2.1, 0.9, 0.85), "sofa"), 4.6, 2.3, 90.0, predefined="SOFA")
    piece("IFCFURNITURE", "Coffee table", shared((1.1, 0.6, 0.42), "coffee"), 3.4, 2.3, 90.0, predefined="TABLE")
    piece("IFCAUDIOVISUALAPPLIANCE", "Television", shared((1.4, 0.3, 0.55), "tv"), 0.6, 2.3, -90.0, predefined="DISPLAY")
    piece("IFCLIGHTFIXTURE", "Pendant lamp", shared((0.45, 0.45, 0.45), "pendant"), 3.4, 2.3, z=1.6, predefined="DIRECTIONSOURCE")
    piece("IFCLIGHTFIXTURE", "Floor lamp", shared((0.35, 0.35, 1.6), "floorlamp"), 5.0, 0.7, predefined="POINTSOURCE")
    piece("IFCFURNITURE", "Kitchen worktop", shared((2.4, 0.6, 0.9), "worktop"), 7.0, 0.65, predefined="NOTDEFINED")
    piece("IFCELECTRICAPPLIANCE", "Appliance 1", shared((0.7, 0.7, 1.85), "fridge"), 8.0, 3.6, -90.0, predefined="FRIDGE_FREEZER")
    piece("IFCSANITARYTERMINAL", "Sink", shared((0.8, 0.55, 0.9), "sink"), 6.6, 0.6, predefined="SINK")
    piece("IFCELECTRICAPPLIANCE", "Appliance 2", shared((0.6, 0.6, 0.9), "cooker"), 7.8, 0.6, predefined="ELECTRICCOOKER")
    piece("IFCFURNITURE", "Table", shared((1.4, 0.8, 0.75), "dining"), 6.6, 2.6, predefined="TABLE")
    chair = shared((0.45, 0.45, 0.85), "chair")
    for i, (x, y, a) in enumerate([(6.3, 2.0, 0.0), (6.9, 2.0, 0.0), (6.3, 3.2, 180.0), (6.9, 3.2, 180.0)]):
        piece("IFCFURNITURE", f"Chair {i + 1}", chair, x, y, a, predefined="CHAIR")
    piece("IFCFURNITURE", "Double bed", shared((1.6, 2.0, 0.5), "bed"), 2.3, 6.9, predefined="BED")
    nightstand = shared((0.4, 0.4, 0.48), "nightstand")
    piece("IFCFURNITURE", "Nightstand", nightstand, 1.25, 7.7)
    piece("IFCFURNITURE", "Nightstand", nightstand, 3.35, 7.7)
    piece("IFCFURNITURE", "Wardrobe", shared((1.2, 0.6, 2.0), "wardrobe"), 1.1, 4.75, 180.0)
    piece("IFCSANITARYTERMINAL", "Bath", shared((1.7, 0.75, 0.6), "bath"), 5.4, 6.0, predefined="BATH")
    piece("IFCSANITARYTERMINAL", "Basin", shared((0.6, 0.45, 0.85), "basin"), 4.8, 4.7, predefined="WASHHANDBASIN")
    piece("IFCSANITARYTERMINAL", "WC", shared((0.4, 0.7, 0.75), "wc"), 6.1, 4.8, predefined="TOILETPAN")
    piece("IFCELECTRICAPPLIANCE", "Washing machine", shared((0.6, 0.6, 0.85), "washer"), 5.4, 4.75, predefined="WASHINGMACHINE")
    piece("IFCFURNITURE", "Shoe cabinet", shared((0.8, 0.3, 1.0), "shoes"), 8.2, 6.0, 90.0, object_type="Cabinet")
    piece("IFCLIGHTFIXTURE", "Luminaire", shared((0.3, 0.3, 0.1), "ceiling"), 7.4, 6.2, z=2.4)
    piece("IFCBUILDINGELEMENTPROXY", "Column cover", shared((0.3, 0.3, 2.5), "column"), 8.2, 4.6)
    b.finish()
    return ifc


def house_ifc2x3() -> Ifc:
    """A fictional small house on two storeys, turned by 30° and placed far from the origin."""
    ifc = Ifc("IFC2X3", 1.0)
    units = [
        ifc.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"),
        ifc.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
    ]
    b = Builder(ifc, "Maison fictive", "Maison des Exemples", units, placement=(612_345.0, 4_987_654.0, 120.0, 30.0))
    ctx = b.context
    door_left = ifc.add(f"IFCDOORSTYLE('{b.gid('style')}',{b.owner},'Porte simple',$,$,$,$,$,.SINGLE_SWING_LEFT.,.WOOD.,.F.,.F.)")
    door_double = ifc.add(f"IFCDOORSTYLE('{b.gid('style')}',{b.owner},'Porte double',$,$,$,$,$,.DOUBLE_DOOR_SINGLE_SWING.,.WOOD.,.F.,.F.)")

    ground, gplace = b.storey("Rez-de-chaussée", 0.0)
    # Ground floor: séjour and cuisine share a 15 cm wall; entrée beside them.
    b.space(ground, gplace, "R01", "Séjour", ifc.polyline(rectangle(0.2, 0.2, 5.0, 4.0)), identifier="FootPrint")
    b.space(ground, gplace, "R02", "Cuisine", ifc.polyline(rectangle(5.15, 0.2, 8.0, 4.0)), identifier="FootPrint")
    # The entrée as a faceted brep (a box), as some exporters write spaces.
    def brep_box(x0, y0, x1, y1, h):
        corners = {
            (i, j, k): ifc.point(x, y, z)
            for i, x in enumerate((x0, x1))
            for j, y in enumerate((y0, y1))
            for k, z in enumerate((0.0, h))
        }
        faces = []
        for loop in [
            [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
            [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
            [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
            [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
            [(1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)],
            [(0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1)],
        ]:
            poly = ifc.add(f"IFCPOLYLOOP(({','.join(corners[c] for c in loop)}))")
            bound = ifc.add(f"IFCFACEOUTERBOUND({poly},.T.)")
            faces.append(ifc.add(f"IFCFACE(({bound}))"))
        shell = ifc.add(f"IFCCLOSEDSHELL(({','.join(faces)}))")
        return ifc.add(f"IFCFACETEDBREP({shell})")

    b.space(ground, gplace, "R03", "Entrée", brep_box(0.2, 4.15, 3.0, 6.0, 2.5))
    b.space(ground, gplace, "R04", "WC", ifc.polyline(rectangle(3.15, 4.15, 4.5, 6.0)), identifier="FootPrint")
    south = b.wall(ground, gplace, "Mur sud", (0.0, 0.1), (8.2, 0.1), 0.2, True, standard=True)
    b.wall(ground, gplace, "Mur nord", (0.0, 6.1), (8.2, 6.1), 0.2, True, standard=True)
    split = b.wall(ground, gplace, "Cloison séjour cuisine", (5.075, 0.2), (5.075, 4.0), 0.15, False, standard=True)
    hall_wall = b.wall(ground, gplace, "Cloison entrée", (0.2, 4.075), (8.0, 4.075), 0.15, False, standard=True)
    b.wall(ground, gplace, "Cloison WC", (3.075, 4.15), (3.075, 6.0), 0.15, False, standard=True)
    b.opening_in(ground, gplace, split, "door", "Porte cuisine", (5.075, 1.5), 90.0, 1.2, 2.1, 0.0, style=door_double)
    b.opening_in(ground, gplace, hall_wall, "door", "Porte séjour", (1.0, 4.075), 0.0, 0.9, 2.1, 0.0, style=door_left)
    b.opening_in(ground, gplace, south, "window", "Baie séjour", (1.0, 0.1), 0.0, 2.4, 2.1, 0.0, depth=0.1)

    def named(name, size, x, y, angle=0.0, cls="IFCFURNISHINGELEMENT", typed=None, brep=False):
        w, d, h = size
        local = ifc.local(gplace, x, y, 0.0, angle)
        if brep:
            item = brep_box(-w / 2, -d / 2, w / 2, d / 2, h)
            shape = ifc.shape(ctx, [item], "Body", "Brep")
        else:
            shape = ifc.shape(ctx, [ifc.box(-w / 2, -d / 2, 0.0, w / 2, d / 2, h)])
        element = ifc.add(f"{cls}('{b.gid(name)}',{b.owner},{text(name)},$,$,{local},{shape},$)")
        if typed:
            ifc.add(f"IFCRELDEFINESBYTYPE('{b.gid('type')}',{b.owner},$,$,({element}),{typed})")
        b.contained[ground].append(element)
        return element

    named("Canapé 3 places", (2.0, 0.9, 0.8), 2.6, 3.2, brep=True)
    named("Table basse", (1.0, 0.5, 0.4), 2.6, 2.0)
    fridge = named("Réfrigérateur", (0.6, 0.65, 1.8), 7.6, 3.5)
    wc_type = ifc.add(f"IFCSANITARYTERMINALTYPE('{b.gid('wctype')}',{b.owner},'Cuvette suspendue',$,$,$,$,$,$,.WCSEAT.)")
    named("Sanitary 1", (0.4, 0.55, 0.4), 3.9, 5.6, cls="IFCFLOWTERMINAL", typed=wc_type)

    first, fplace = b.storey("Étage", 2.8)
    b.space(first, fplace, "R11", "Chambre", ifc.polyline(rectangle(0.2, 0.2, 4.0, 4.0)), identifier="FootPrint")
    b.space(first, fplace, "R12", "Salle de bain", ifc.polyline(rectangle(4.15, 0.2, 6.5, 2.5)), identifier="FootPrint")
    bed_local = ifc.local(fplace, 2.0, 2.0, 0.0)
    bed = ifc.add(
        f"IFCFURNISHINGELEMENT('{b.gid('bed')}',{b.owner},'Lit double',$,$,{bed_local},{ifc.shape(ctx, [ifc.box(-0.8, -1.0, 0.0, 0.8, 1.0, 0.5)])},$)"
    )
    b.contained[first].append(bed)
    # The fridge's warranty as IFC2x3 writes it: a calendar date by reference, two years in seconds.
    started = ifc.add("IFCCALENDARDATE(12,6,2022)")
    values = [
        ifc.add("IFCPROPERTYSINGLEVALUE('Manufacturer',$,IFCLABEL('Froid Fictif'),$)"),
    ]
    information = ifc.add(
        f"IFCPROPERTYSET('{b.gid('pset')}',{b.owner},'Pset_ManufacturerTypeInformation',$,({','.join(values)}))"
    )
    warranty = ifc.add(
        f"IFCPROPERTYSET('{b.gid('pset')}',{b.owner},'Pset_Warranty',$,("
        + ifc.add(f"IFCPROPERTYREFERENCEVALUE('WarrantyStartDate',$,$,{started})")
        + ","
        + ifc.add("IFCPROPERTYSINGLEVALUE('WarrantyPeriod',$,IFCTIMEMEASURE(63072000.),$)")
        + "))"
    )
    for pset in (information, warranty):
        ifc.add(f"IFCRELDEFINESBYPROPERTIES('{b.gid('defines')}',{b.owner},$,$,({fridge}),{pset})")
    b.finish()
    return ifc


def utility_ifc4() -> Ifc:
    """A fictional kitchen and utility room whose appliances say how to look after them."""
    ifc = Ifc("IFC4", 1.0)
    b = Builder(ifc, "Fictional utility room", "Fictional house", ifc4_units(ifc, None))
    storey, place = b.storey("Ground floor", 0.0)
    ctx = b.context
    b.space(storey, place, "U1", "Kitchen", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(0.0, 0.0, 3.0, 3.0))})"), 2.5))
    b.space(storey, place, "U2", "Utility room", ifc.extrusion(
        ifc.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{ifc.polyline(rectangle(3.1, 0.0, 6.1, 2.5))})"), 2.5))
    b.wall(storey, place, "Partition", (3.05, 0.0), (3.05, 3.0), 0.1, False)

    def appliance(cls, name, size, x, y, predefined):
        w, d, h = size
        local = ifc.local(place, x, y, 0.0)
        shape = ifc.shape(ctx, [ifc.box(-w / 2, -d / 2, 0.0, w / 2, d / 2, h)])
        element = ifc.add(f"{cls}('{b.gid(name)}',{b.owner},{text(name)},$,$,{local},{shape},$,.{predefined}.)")
        b.contained[storey].append(element)
        return element

    def pset(name, properties, objects=None):
        values = [ifc.add(f"IFCPROPERTYSINGLEVALUE('{key}',$,{value},$)") for key, value in properties]
        found = ifc.add(f"IFCPROPERTYSET('{b.gid('pset')}',{b.owner},'{name}',$,({','.join(values)}))")
        if objects:
            ifc.add(f"IFCRELDEFINESBYPROPERTIES('{b.gid('defines')}',{b.owner},$,$,({','.join(objects)}),{found})")
        return found

    # The washing machine: its make and model on its type; its serial number, purchase and
    # installation dates, warranty (a start and two years) and service life on the piece.
    washer = appliance("IFCELECTRICAPPLIANCE", "Washing machine", (0.6, 0.6, 0.85), 3.5, 0.4, "WASHINGMACHINE")
    information = pset("Pset_ManufacturerTypeInformation", [
        ("Manufacturer", "IFCLABEL('Fictional Appliances')"),
        ("ModelLabel", "IFCLABEL('W-100')"),
        ("ModelReference", "IFCLABEL('W100-EU')"),
    ])
    washer_type = ifc.add(
        f"IFCELECTRICAPPLIANCETYPE('{b.gid('washer type')}',{b.owner},'W-100',$,$,({information}),$,$,$,.WASHINGMACHINE.)"
    )
    ifc.add(f"IFCRELDEFINESBYTYPE('{b.gid('type')}',{b.owner},$,$,({washer}),{washer_type})")
    pset("Pset_ManufacturerOccurrence", [
        ("SerialNumber", "IFCIDENTIFIER('FA-0001')"),
        ("AcquisitionDate", "IFCDATE('2024-03-01')"),
    ], [washer])
    pset("COBie_Component", [("InstallationDate", "IFCDATE('2024-03-15')")], [washer])
    pset("Pset_Warranty", [
        ("WarrantyStartDate", "IFCDATE('2024-03-15')"),
        ("WarrantyPeriod", "IFCDURATION('P2Y')"),
    ], [washer])
    pset("Pset_ServiceLife", [("ServiceLifeDuration", "IFCDURATION('P12Y')")], [washer])
    # The fridge: in an asset incorporated into the works on a date, its warranty's end given.
    fridge = appliance("IFCELECTRICAPPLIANCE", "Fridge", (0.6, 0.65, 1.8), 0.4, 2.5, "FRIDGE_FREEZER")
    pset("Pset_ManufacturerTypeInformation", [("ModelReference", "IFCLABEL('FR-7')")], [fridge])
    pset("Pset_Warranty", [("WarrantyEndDate", "IFCDATE('2028-11-20')")], [fridge])
    asset = ifc.add(
        f"IFCASSET('{b.gid('asset')}',{b.owner},'Kitchen appliances',$,$,'A-1',$,$,$,$,$,$,'2023-11-20',$)"
    )
    ifc.add(f"IFCRELASSIGNSTOGROUP('{b.gid('group')}',{b.owner},$,$,({fridge}),$,{asset})")
    # Nothing said of the dryer: no card.
    appliance("IFCELECTRICAPPLIANCE", "Dryer", (0.6, 0.6, 0.85), 4.2, 0.4, "TUMBLEDRYER")
    b.finish()
    return ifc


def studio_feet() -> Ifc:
    """A fictional studio drawn in feet."""
    ifc = Ifc("IFC4", 0.3048)
    metre = ifc.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)")
    dims = ifc.add("IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)")
    measure = ifc.add(f"IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),{metre})")
    foot = ifc.add(f"IFCCONVERSIONBASEDUNIT({dims},.LENGTHUNIT.,'FOOT',{measure})")
    b = Builder(ifc, "Fictional studio", "Studio", [foot])
    storey, place = b.storey("Ground", 0.0)
    room = ifc.add(
        f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{ifc.add(f'IFCAXIS2PLACEMENT2D({ifc.point(3.0, 2.5)},$)')},{ifc.length(6.0)},{ifc.length(5.0)})"
    )
    b.space(storey, place, "S1", "Studio", ifc.extrusion(room, 2.6))
    bath = ifc.add(
        f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{ifc.add(f'IFCAXIS2PLACEMENT2D({ifc.point(1.0, 1.0)},$)')},{ifc.length(2.0)},{ifc.length(2.0)})"
    )
    b.space(storey, place, "S2", "Shower room", ifc.extrusion(bath, 2.6), x=6.1)
    wall = b.wall(storey, place, "Partition", (6.05, 0.0), (6.05, 2.0), 0.1, False)
    b.opening_in(storey, place, wall, "door", "Shower door", (6.05, 0.5), 90.0, 0.75, 2.0, 0.0, "SINGLE_SWING_RIGHT")
    b.finish()
    return ifc


def no_spaces() -> Ifc:
    ifc = Ifc("IFC4", 0.001)
    b = Builder(ifc, "Walls only", "Shell", ifc4_units(ifc, "MILLI"))
    storey, place = b.storey("Level 0", 0.0)
    b.wall(storey, place, "Wall", (0.0, 0.0), (5.0, 0.0), 0.2, True)
    b.finish()
    return ifc


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    outputs = {
        "apartment-ifc4.ifc": (apartment_ifc4, "apartment-ifc4.ifc"),
        "house-ifc2x3.ifc": (house_ifc2x3, "house-ifc2x3.ifc"),
        "studio-feet-ifc4.ifc": (studio_feet, "studio-feet-ifc4.ifc"),
        "utility-ifc4.ifc": (utility_ifc4, "utility-ifc4.ifc"),
        "no-spaces-ifc4.ifc": (no_spaces, "no-spaces-ifc4.ifc"),
    }
    for file, (make, name) in outputs.items():
        make().write(FIXTURES / file, name)
        print(f"crates/domotwin-import/tests/fixtures/{file}")
    shutil.copyfile(FIXTURES / "apartment-ifc4.ifc", ROOT / "examples" / "demo-apartment.ifc")
    print("examples/demo-apartment.ifc")


if __name__ == "__main__":
    main()
