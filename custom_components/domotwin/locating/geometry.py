"""The home as Bluetooth sees it (docs/DECISIONS.md, D-035).

Where the rooms are, how many walls stand between two places, which rooms lead to which. Pure: the
storeys as stored (their plans and overlays), no Home Assistant objects. Lengths are in cm, points
on a storey's plan as in the plan format.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
import itertools
import math
from typing import Any, Final

type Point = tuple[float, float]

# Where a device is held, and a receiver stands when only its room is known (cm above the floor).
HELD_AT: Final = 110.0
RECEIVER_AT: Final = 120.0
# A room is looked at from this many points at most, kept this far from its sides.
MAX_POINTS: Final = 12
POINT_MARGIN: Final = 25.0
# A gap between two rooms narrower than this is the wall between them.
WALL_GAP: Final = 60.0
# A door at the crossing: the wall is mostly not there.
DOOR_NEAR: Final = 25.0
DOOR_WALL: Final = 0.4
# How far across a side or a door the room beyond is looked for.
ACROSS: Final = 25.0
# A side shorter than this does not join two rooms without a door.
SHARED_SIDE: Final = 60.0
STAIRS: Final = "stairs"


@dataclass(frozen=True)
class Spot:
    """A place in the home: a storey (lowest first), a point on its plan and a height."""

    storey: int
    x: float
    y: float
    z: float


@dataclass(frozen=True)
class Room:
    """A room of a storey."""

    id: str
    storey: int
    outline: tuple[Point, ...]


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def _point(value: Any) -> Point | None:
    if not isinstance(value, list | tuple) or len(value) != 2:
        return None
    x, y = _number(value[0]), _number(value[1])
    return None if x is None or y is None else (x, y)


def inside(outline: tuple[Point, ...], p: Point) -> bool:
    """Whether `p` is inside a polygon (on a side counts either way)."""
    x, y = p
    found = False
    j = len(outline) - 1
    for i, (xi, yi) in enumerate(outline):
        xj, yj = outline[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            found = not found
        j = i
    return found


def _segment_distance(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    along = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy
    t = 0.0 if length == 0 else max(0.0, min(1.0, along / length))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def _crossing(a: Point, b: Point, p: Point, q: Point) -> float | None:
    """Where along a-b (0 to 1) it crosses the side p-q, if it does."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = q[0] - p[0], q[1] - p[1]
    denominator = rx * sy - ry * sx
    if abs(denominator) < 1e-12:
        return None
    t = ((p[0] - a[0]) * sy - (p[1] - a[1]) * sx) / denominator
    u = ((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / denominator
    return t if 0.0 < t < 1.0 and 0.0 <= u <= 1.0 else None


def _edge_distance(outline: tuple[Point, ...], p: Point) -> float:
    return min(_segment_distance(p, outline[i - 1], outline[i]) for i in range(len(outline)))


def _across(a: Point, b: Point) -> tuple[Point, Point]:
    """The points either side of the middle of a-b, `ACROSS` away from it."""
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    length = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    nx, ny = -(b[1] - a[1]) / length * ACROSS, (b[0] - a[0]) / length * ACROSS
    return (mx + nx, my + ny), (mx - nx, my - ny)


class Home:
    """The rooms, doors, stairs and pieces of every storey, read from the stored storeys."""

    def __init__(self, storeys: Iterable[Mapping[str, Any]]) -> None:
        """Read the storeys (lowest first, as stored): rooms, doors, open sides, stairs, pieces."""
        self.rooms: dict[str, Room] = {}
        self.elevations: list[float] = []
        self.storey_ids: list[str] = []
        self._doors: list[list[tuple[Point, Point]]] = []
        self._open: set[frozenset[str]] = set()
        self._stairs: list[tuple[int, Point]] = []
        self.pieces: dict[str, Spot] = {}
        open_sides: list[tuple[int, str, Point, Point]] = []
        for index, storey in enumerate(storeys):
            self.storey_ids.append(str(storey.get("id", "")))
            self.elevations.append(_number(storey.get("elevation")) or 0.0)
            plan = storey.get("plan")
            plan = plan if isinstance(plan, Mapping) else {}
            layout = storey.get("layout")
            layout = layout if isinstance(layout, Mapping) else {}
            doors: list[tuple[Point, Point]] = []
            for room in _listed(plan, "rooms"):
                outline = tuple(p for p in map(_point, room.get("outline") or []) if p is not None)
                if not isinstance(room.get("id"), str) or len(outline) < 3 or _flat(outline):
                    continue
                self.rooms[room["id"]] = Room(room["id"], index, outline)
                sides = room.get("sides")
                for k, side in enumerate(sides if isinstance(sides, list) else []):
                    if isinstance(side, Mapping) and side.get("open") is True and k < len(outline):
                        open_sides.append(
                            (index, room["id"], outline[k], outline[(k + 1) % len(outline)])
                        )
            for door in _listed(plan, "doors"):
                ends = _point(door.get("from")), _point(door.get("to"))
                if ends[0] is not None and ends[1] is not None and door.get("style") != "sealed":
                    doors.append((ends[0], ends[1]))
            self._doors.append(doors)
            self._read_pieces(index, plan, layout)
        self._room_list = list(self.rooms.values())
        for storey_index, room_id, a, b in open_sides:
            for p in _across(a, b):
                other = self.room_at(storey_index, p)
                if other is not None and other != room_id:
                    self._open.add(frozenset((room_id, other)))
        self.neighbours = self._link()

    def _read_pieces(self, storey: int, plan: Mapping[str, Any], layout: Mapping[str, Any]) -> None:
        """The pieces' centres, moved, lifted, removed or added by the overlay."""
        floor = self.elevations[storey]
        items: list[tuple[str, Mapping[str, Any]]] = [
            (item["id"], item) for item in _listed(plan, "items") if isinstance(item.get("id"), str)
        ]
        known = {key for key, _ in items}
        items += [
            (key, {**entry["add"], **entry})
            for key, entry in layout.items()
            if key not in known
            and isinstance(entry, Mapping)
            and isinstance(entry.get("add"), Mapping)
        ]
        for key, item in items:
            moved = layout.get(key)
            moved = moved if isinstance(moved, Mapping) else {}
            if moved.get("removed") is True:
                continue
            at = _point(moved.get("at")) or _point(item.get("at"))
            if at is None:
                continue
            size = item.get("size")
            height = _number(size[2]) if isinstance(size, list) and len(size) == 3 else None
            lift = _number(moved.get("lift"))
            lift = lift if lift is not None else _number(item.get("lift")) or 0.0
            self.pieces[key] = Spot(storey, at[0], at[1], floor + lift + (height or 0.0) / 2)
            if item.get("kind") == STAIRS:
                self._stairs.append((storey, at))

    def room_at(self, storey: int, p: Point) -> str | None:
        """The room a point of a storey is in."""
        for room in self._room_list:
            if room.storey == storey and inside(room.outline, p):
                return room.id
        return None

    def points(self, room_id: str) -> list[Spot]:
        """Places a device may be held in a room: a grid inside it, clear of its sides."""
        room = self.rooms[room_id]
        xs = [p[0] for p in room.outline]
        ys = [p[1] for p in room.outline]
        width, depth = max(xs) - min(xs), max(ys) - min(ys)
        z = self.elevations[room.storey] + HELD_AT
        for step in (max(width, depth) / k for k in (3, 4, 6, 8, 12)):
            found = [
                (x, y)
                for i in range(int(width // step) + 1)
                for j in range(int(depth // step) + 1)
                if inside(
                    room.outline,
                    (x := min(xs) + step / 2 + i * step, y := min(ys) + step / 2 + j * step),
                )
                and _edge_distance(room.outline, (x, y)) >= POINT_MARGIN
            ]
            if len(found) >= MAX_POINTS // 2 or step < 2 * POINT_MARGIN:
                break
        if not found:
            # A narrow room: the middle of its corners, or a corner's neighbourhood.
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            found = [(cx, cy)] if inside(room.outline, (cx, cy)) else [room.outline[0]]
        found = found[:: max(1, math.ceil(len(found) / MAX_POINTS))]
        return [Spot(room.storey, x, y, z) for x, y in found]

    def middle(self, room_id: str) -> Spot:
        """Where a receiver stands when only its room is known: the room's middle point."""
        points = self.points(room_id)
        cx = sum(p.x for p in points) / len(points)
        cy = sum(p.y for p in points) / len(points)
        best = min(points, key=lambda p: math.hypot(p.x - cx, p.y - cy))
        room = self.rooms[room_id]
        return Spot(room.storey, best.x, best.y, self.elevations[room.storey] + RECEIVER_AT)

    def walls(self, a: Spot, b: Spot) -> float:
        """The walls between two places, counted on the plan of `a`'s storey.

        Each change of room along the line is a wall; a side left open is none, a door in the way
        less than one. A line out of the home and back in crosses two façades; a gap between two
        rooms no wider than a wall is the wall between them.
        """
        storey = a.storey
        length = math.hypot(b.x - a.x, b.y - a.y)
        if length < 1e-6:
            return 0.0
        # Where the line crosses a side of a room: the room changes there, nowhere else.
        cuts = {0.0, 1.0}
        for listed in self._room_list:
            if listed.storey == storey:
                outline = listed.outline
                for k in range(len(outline)):
                    t = _crossing((a.x, a.y), (b.x, b.y), outline[k - 1], outline[k])
                    if t is not None:
                        cuts.add(round(t, 9))
        ordered = sorted(cuts)

        def point(t: float) -> Point:
            return (a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)

        runs: list[tuple[str | None, float, float]] = []
        for t0, t1 in itertools.pairwise(ordered):
            room = self.room_at(storey, point((t0 + t1) / 2))
            if runs and runs[-1][0] == room:
                runs[-1] = (room, runs[-1][1], t1)
            else:
                runs.append((room, t0, t1))
        total = 0.0
        i = 0
        while i < len(runs) - 1:
            here, _, end = runs[i]
            there, start, gap_end = runs[i + 1]
            if (
                there is None
                and here is not None
                and i + 2 < len(runs)
                and (gap_end - start) * length <= WALL_GAP
            ):
                beyond = runs[i + 2][0]
                total += self._wall(storey, here, beyond, point((start + gap_end) / 2))
                i += 2
                continue
            if here is None or there is None:
                total += 1.0
            else:
                total += self._wall(storey, here, there, point(end))
            i += 1
        return total

    def _wall(self, storey: int, a: str | None, b: str | None, at: Point) -> float:
        if a is not None and b is not None and frozenset((a, b)) in self._open:
            return 0.0
        if any(_segment_distance(at, d[0], d[1]) <= DOOR_NEAR for d in self._doors[storey]):
            return DOOR_WALL
        return 1.0

    def floors(self, a: Spot, b: Spot) -> int:
        """The floors between two places' storeys."""
        return abs(a.storey - b.storey)

    def _link(self) -> dict[str, frozenset[str]]:
        """Which rooms lead to which: through a door, a side left open or stairs.

        A room no door leads to is joined to the rooms it shares a side with, so that a plan drawn
        without doors still has its ways.
        """
        links: dict[str, set[str]] = {room: set() for room in self.rooms}

        def join(a: str | None, b: str | None) -> None:
            if a is not None and b is not None and a != b:
                links[a].add(b)
                links[b].add(a)

        for pair in self._open:
            join(*sorted(pair))
        for storey, doors in enumerate(self._doors):
            for d in doors:
                p, q = _across(*d)
                join(self.room_at(storey, p), self.room_at(storey, q))
        for room in self._room_list:
            if links[room.id]:
                continue
            outline = room.outline
            for k in range(len(outline)):
                a, b = outline[k], outline[(k + 1) % len(outline)]
                if math.hypot(b[0] - a[0], b[1] - a[1]) >= SHARED_SIDE:
                    for p in _across(a, b):
                        join(room.id, self.room_at(room.storey, p))
        self._link_stairs(join)
        return {room: frozenset(found) for room, found in links.items()}

    def _link_stairs(self, join: Callable[[str | None, str | None], None]) -> None:
        """Stairs join their room to the room above or below them (else the stairs' rooms there)."""
        stairs_rooms: dict[int, list[str]] = {}
        for storey, at in self._stairs:
            if (room_id := self.room_at(storey, at)) is not None:
                stairs_rooms.setdefault(storey, []).append(room_id)
        for storey, at in self._stairs:
            here = self.room_at(storey, at)
            for other in (storey - 1, storey + 1):
                if not 0 <= other < len(self.elevations):
                    continue
                above = self.room_at(other, at)
                for there in [above] if above is not None else stairs_rooms.get(other, []):
                    join(here, there)


def _flat(outline: tuple[Point, ...]) -> bool:
    """Whether an outline has no room in it (its corners on one line or one point)."""
    area = sum(
        outline[k - 1][0] * outline[k][1] - outline[k][0] * outline[k - 1][1]
        for k in range(len(outline))
    )
    return abs(area) < 2.0


def _listed(plan: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    found = plan.get(key)
    return [item for item in found if isinstance(item, Mapping)] if isinstance(found, list) else []
