#!/usr/bin/env python3
"""Writes the places and walls the placement advisor is checked against (D-066).

    python3 scripts/make-coverage-fixture.py

The placement advisor counts walls in the page (`domotwin_core::coverage::home`) as the
integration's Bluetooth locating counts them (`custom_components/domotwin/locating/geometry.py`,
D-035). This script reads the fictional demo apartment and its upper floor with the integration's
own code and writes, to `tests/fixtures/coverage-walls.json`, what it finds: the points of each
room, each room's middle, a few pieces (one moved and lifted, one removed, one added by the
overlay), and the walls and floors (D-078) between every two of the places looked at; then
the same of the fictional split-level house (`split`). The Rust tests and the Python
tests both read it: when one side counts differently, its test fails. The output is
deterministic, so the file only changes when the geometry does.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "coverage-walls.json"
GEOMETRY = ROOT / "custom_components" / "domotwin" / "locating" / "geometry.py"

# The storeys as stored: the plans are the examples', the overlays move, lift, remove and add.
STOREYS = [
    {
        "id": "ground",
        "elevation": 0,
        "plan": "examples/demo-apartment.domotwin.json",
        "layout": {
            "sofa": {"at": [400, 200], "lift": 10},
            "tv": {"removed": True},
            "reading-lamp": {
                "add": {"kind": "floor-lamp", "size": [30, 30, 150], "at": [700, 600]},
            },
        },
    },
    {
        "id": "upper",
        "elevation": 280,
        "plan": "examples/demo-upper-floor.domotwin.json",
        "layout": {},
    },
]
PIECES = ["sofa", "tv", "washer", "floor-lamp", "reading-lamp"]
# The fictional split-level house (D-078): a half level down beside the entry level, one up over it.
SPLIT = [
    {"id": "lower", "elevation": -140, "plan": "examples/split-level-lower.domotwin.json"},
    {"id": "entry", "elevation": 0, "plan": "examples/split-level-entry.domotwin.json"},
    {"id": "upper", "elevation": 140, "plan": "examples/split-level-upper.domotwin.json"},
]
# Of each room, its middle and these of its points are looked at.
POINTS_LOOKED_AT = (0, 3)


def _geometry():  # type: ignore[no-untyped-def]
    """The integration's geometry module, read alone (it needs nothing of Home Assistant)."""
    spec = importlib.util.spec_from_file_location("domotwin_geometry", GEOMETRY)
    if spec is None or spec.loader is None:
        raise ImportError(GEOMETRY)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _spot(spot) -> list[float]:  # type: ignore[no-untyped-def]
    return [spot.storey, round(spot.x, 6), round(spot.y, 6), round(spot.z, 6)]


def _written(value: object, indent: str = "") -> str:
    """JSON with a list of numbers (a place, a row of walls) on one line."""
    inner = indent + "  "
    if isinstance(value, dict):
        items = [f"{inner}{json.dumps(k)}: {_written(v, inner)}" for k, v in value.items()]
        return "{\n" + ",\n".join(items) + "\n" + indent + "}" if items else "{}"
    if isinstance(value, list) and any(isinstance(v, dict | list) for v in value):
        items = [inner + _written(v, inner) for v in value]
        return "[\n" + ",\n".join(items) + "\n" + indent + "]"
    return json.dumps(value, ensure_ascii=False)


def _read(storeys: list[dict]) -> list[dict]:  # type: ignore[type-arg]
    return [
        {**storey, "plan": json.loads((ROOT / storey["plan"]).read_text(encoding="utf-8"))}
        for storey in storeys
    ]


def _split(geometry) -> dict:  # type: ignore[no-untyped-def, type-arg]
    """The split-level house's places (each room's middle and first point), walls and floors."""
    home = geometry.Home(_read(SPLIT))
    spots = []
    for room in home.rooms:
        spots.append(home.middle(room))
        spots += home.points(room)[:1]
    return {
        "storeys": SPLIT,
        "spots": [_spot(spot) for spot in spots],
        "walls": [[home.walls(a, b) for b in spots] for a in spots],
        "floors": [[home.floors(a, b) for b in spots] for a in spots],
    }


def main() -> None:
    """Write the fixture."""
    geometry = _geometry()
    storeys = [
        {**storey, "plan": json.loads((ROOT / storey["plan"]).read_text(encoding="utf-8"))}
        for storey in STOREYS
    ]
    home = geometry.Home(storeys)
    points = {room: home.points(room) for room in home.rooms}
    middles = {room: home.middle(room) for room in home.rooms}
    spots = []
    for room in home.rooms:
        spots.append(middles[room])
        spots += [points[room][k] for k in POINTS_LOOKED_AT if k < len(points[room])]
    walls = [[home.walls(a, b) for b in spots] for a in spots]
    floors = [[home.floors(a, b) for b in spots] for a in spots]
    fixture = {
        "about": "Written by scripts/make-coverage-fixture.py from the integration's geometry "
        "(D-035): the advisor's (D-066) must be the same.",
        "storeys": STOREYS,
        "rooms": list(home.rooms),
        "points": {room: [_spot(p) for p in found] for room, found in points.items()},
        "middles": {room: _spot(spot) for room, spot in middles.items()},
        "pieces": {
            piece: _spot(home.pieces[piece]) if piece in home.pieces else None for piece in PIECES
        },
        "spots": [_spot(spot) for spot in spots],
        "walls": walls,
        "floors": floors,
        "split": _split(geometry),
    }
    FIXTURE.write_text(_written(fixture) + "\n", encoding="utf-8")
    print(FIXTURE.relative_to(ROOT))  # noqa: T201


if __name__ == "__main__":
    main()
