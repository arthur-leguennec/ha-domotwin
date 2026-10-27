"""The plans cut into half-metre cells, and the ways between them (docs/DECISIONS.md, D-079).

Finer locating (M42) says where a device is in its room, not only which room: on a grid of cells
over each storey's rooms (50 cm, larger for a home too big for that many). A cell leads to the
cells around it in its room, across a side left open, through a door, and up or down the stairs:
never through a wall, never from one storey to another but by the stairs. Pure.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Final

from .geometry import HELD_AT, STAIRS_REACH, Home, Point, Spot, _crossing

# A cell's side (cm), and the most cells of a home: a bigger home gets bigger cells.
CELL: Final = 50.0
MAX_CELLS: Final = 6000
# A step reaches the cells around (diagonals too); through a door, a wall's thickness further.
STEP_REACH: Final = 1.5
DOOR_REACH: Final = 2.5


@dataclass(frozen=True)
class Cell:
    """A cell: its storey, its middle on the plan (cm) and its room."""

    storey: int
    x: float
    y: float
    room: str


class Cells:
    """Every storey's rooms in cells, each cell with the cells a step leads to."""

    def __init__(self, home: Home) -> None:
        """Cut the rooms of `home`: 50 cm cells, larger where there would be too many."""
        # The boxes around each storey's rooms hold no fewer cells than the rooms: a size that
        # fits them fits the rooms.
        area = sum(_box_area(home, storey) for storey in range(len(home.elevations)))
        size = max(CELL, math.sqrt(area / MAX_CELLS))
        cut = _cut(home, size)
        while len(cut) > MAX_CELLS:
            size *= 1.25
            cut = _cut(home, size)
        self.size = size
        self.cells: list[Cell] = [cell for _, cell in cut]
        self.by_room: dict[str, list[int]] = {}
        for index, cell in enumerate(self.cells):
            self.by_room.setdefault(cell.room, []).append(index)
        self._elevations = list(home.elevations)
        keys = [key for key, _ in cut]
        self._at = {key: k for k, key in enumerate(keys)}
        self.moves: list[tuple[int, ...]] = _ways(home, keys, self.cells, size)

    def __len__(self) -> int:
        """How many cells."""
        return len(self.cells)

    def at(self, storey: int, x: float, y: float) -> int | None:
        """The cell a point of a storey is in, if it is in one."""
        return self._at.get((storey, math.floor(x / self.size), math.floor(y / self.size)))

    def spot(self, index: int) -> Spot:
        """Where a device held in a cell is."""
        cell = self.cells[index]
        return Spot(cell.storey, cell.x, cell.y, self._elevations[cell.storey] + HELD_AT)


type _Key = tuple[int, int, int]


def _box_area(home: Home, storey: int) -> float:
    """The area of the box around a storey's rooms (cm²), with a cell's margin round it."""
    points = [p for room in home.rooms.values() if room.storey == storey for p in room.outline]
    if not points:
        return 0.0
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return (max(xs) - min(xs) + CELL) * (max(ys) - min(ys) + CELL)


def _cut(home: Home, size: float) -> list[tuple[_Key, Cell]]:
    """The cells of every storey: a grid of `size` over its rooms, each cell in the room it is in.

    The grid is laid from the plan's origin, so that a cell keeps its place when a room is added.
    """
    found: list[tuple[_Key, Cell]] = []
    for storey in range(len(home.elevations)):
        outlines = [room.outline for room in home.rooms.values() if room.storey == storey]
        if not outlines:
            continue
        xs = [p[0] for outline in outlines for p in outline]
        ys = [p[1] for outline in outlines for p in outline]
        for i in range(math.floor(min(xs) / size), math.ceil(max(xs) / size)):
            for j in range(math.floor(min(ys) / size), math.ceil(max(ys) / size)):
                x, y = (i + 0.5) * size, (j + 0.5) * size
                room = home.room_at(storey, (x, y))
                # A garden drawn round the home is not under its walls.
                if room is None or (home.rooms[room].outside and home.indoors(storey, (x, y))):
                    continue
                found.append(((storey, i, j), Cell(storey, x, y, room)))
    return found


def _ways(home: Home, keys: list[_Key], cells: list[Cell], size: float) -> list[tuple[int, ...]]:
    """The cells a step leads to from each cell: around it, through a door, by the stairs.

    A step into another room goes across a side left open between them, or through the door that
    joins them (a wall's thickness further), or across the side it shares with a room no door
    leads to (as `Home` joins them); and through no other wall on its way.
    """
    index = {key: k for k, key in enumerate(keys)}
    ways: list[set[int]] = [set() for _ in cells]
    reach = math.ceil(DOOR_REACH)
    joined: dict[tuple[str, str], tuple[list[tuple[Point, Point]], ...] | None] = {}

    def how(a: str, b: str) -> tuple[list[tuple[Point, Point]], ...] | None:
        """The sides left open and the doors between two rooms that lead to each other."""
        if (a, b) not in joined:
            near = b in home.neighbours.get(a, frozenset())
            joined[a, b] = (home.open_sides(a, b), home.doors_between(a, b)) if near else None
        return joined[a, b]

    for k, (storey, i, j) in enumerate(keys):
        here = cells[k]
        for di in range(-reach, reach + 1):
            for dj in range(-reach, reach + 1):
                other = index.get((storey, i + di, j + dj))
                if other is None or other == k:
                    continue
                apart = math.hypot(di, dj)
                there = cells[other]
                if there.room == here.room:
                    if apart <= STEP_REACH:
                        ways[k].add(other)
                    continue
                if (joins := how(here.room, there.room)) is None:
                    continue
                sides, doors = joins
                a, b = (here.x, here.y), (there.x, there.y)
                shared = not sides and not doors
                if not (
                    shared
                    or (apart <= STEP_REACH and _through(sides, a, b))
                    or _through(doors, a, b)
                ):
                    continue
                # No other wall on the way: a door's counts less than one, a side left open none.
                walls = home.walls(Spot(storey, *a, 0.0), Spot(storey, *b, 0.0))
                if walls < 1.0 or (shared and walls <= 1.0):
                    ways[k].add(other)
    _stairs(home, cells, size, ways)
    return [tuple(sorted(found)) for found in ways]


def _through(openings: list[tuple[Point, Point]], a: Point, b: Point) -> bool:
    """Whether a step from `a` to `b` goes through one of the openings (doors, sides left open)."""
    return any(_crossing(a, b, p, q) is not None for p, q in openings)


def _stairs(home: Home, cells: list[Cell], size: float, ways: list[set[int]]) -> None:
    """Join the cells at the foot of each stairs to those where they land on the next storey.

    Each cell there to the nearest cell here and back: the stairs carry no more than one cell's
    chance of moving at a time.
    """
    for storey, at, half in home.stairs:
        here = home.room_at(storey, at)
        if here is None:
            continue
        foot = [
            k
            for k, c in enumerate(cells)
            if c.storey == storey and c.room == here and math.dist((c.x, c.y), at) <= half + size
        ]
        linked = home.neighbours.get(here, frozenset())
        for other in (storey - 1, storey + 1):
            landing = [
                k
                for k, c in enumerate(cells)
                if c.storey == other
                and c.room in linked
                and math.dist((c.x, c.y), at) <= STAIRS_REACH + half + size
            ]
            if not foot or not landing:
                continue
            for a, b in ((foot, landing), (landing, foot)):
                for k in a:
                    here_at = (cells[k].x, cells[k].y)
                    nearest = min(b, key=lambda m: math.dist(here_at, (cells[m].x, cells[m].y)))
                    ways[k].add(nearest)
                    ways[nearest].add(k)
