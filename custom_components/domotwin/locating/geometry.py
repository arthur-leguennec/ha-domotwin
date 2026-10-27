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
# A box round a room: its least x and y, its greatest (cm).
type Box = tuple[float, float, float, float]

# Where a device is held, and a receiver stands when only its room is known (cm above the floor).
HELD_AT: Final = 110.0
RECEIVER_AT: Final = 120.0
# A room is looked at from this many points at most, kept this far from its sides.
MAX_POINTS: Final = 12
POINT_MARGIN: Final = 25.0
# A gap between two rooms narrower than this is the wall between them.
WALL_GAP: Final = 60.0
# A point this near two rooms is under the wall between them, on their floor (D-078).
UNDER_WALLS: Final = WALL_GAP / 2
#: A storey at least this much over the one under it is a full storey over it (cm, D-078); twice
#: this, it is over another storey's.
FULL_STOREY: Final = 200.0
#: How far past their end stairs may land beside a storey's rooms (cm): a half flight (D-078).
STAIRS_REACH: Final = 150.0
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
    """A place in the home: a storey (lowest first), a point on its plan and a height.

    The height (cm) is on the storeys' elevations: its storey's elevation and the height above
    that floor.
    """

    storey: int
    x: float
    y: float
    z: float


@dataclass(frozen=True)
class Room:
    """A room of a storey, or a place outside (D-077): no walls, under the rooms around it."""

    id: str
    storey: int
    outline: tuple[Point, ...]
    outside: bool = False


def number(value: Any) -> float | None:
    """A finite number (not a bool) as a float, else None."""
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def _point(value: Any) -> Point | None:
    if not isinstance(value, list | tuple) or len(value) != 2:
        return None
    x, y = number(value[0]), number(value[1])
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
        self._stairs: list[tuple[int, Point, float]] = []
        self.pieces: dict[str, Spot] = {}
        # Each piece's turn (degrees, the overlay's when it turned it) and the room it says it is
        # in (the overlay's when it moved it there and that room is there, else the plan's), D-080.
        self.turns: dict[str, float] = {}
        self.piece_rooms: dict[str, str] = {}
        said_rooms: dict[str, tuple[Any, Any]] = {}
        open_sides: list[tuple[int, str, Point, Point]] = []
        for index, storey in enumerate(storeys):
            self.storey_ids.append(str(storey.get("id", "")))
            self.elevations.append(number(storey.get("elevation")) or 0.0)
            plan = storey.get("plan")
            plan = plan if isinstance(plan, Mapping) else {}
            layout = storey.get("layout")
            layout = layout if isinstance(layout, Mapping) else {}
            doors: list[tuple[Point, Point]] = []
            for room in _listed(plan, "rooms"):
                outline = tuple(p for p in map(_point, room.get("outline") or []) if p is not None)
                if not isinstance(room.get("id"), str) or len(outline) < 3 or _flat(outline):
                    continue
                outside = room.get("outside") is True
                self.rooms[room["id"]] = Room(room["id"], index, outline, outside)
                sides = room.get("sides")
                sides = sides if isinstance(sides, list) else []
                # A place outside has no walls: every side of it is open (to another place
                # outside: a room beside it has its façade).
                for k in range(len(outline)):
                    side = sides[k] if k < len(sides) else None
                    if outside or (isinstance(side, Mapping) and side.get("open") is True):
                        open_sides.append(
                            (index, room["id"], outline[k], outline[(k + 1) % len(outline)])
                        )
            for door in _listed(plan, "doors"):
                ends = _point(door.get("from")), _point(door.get("to"))
                if ends[0] is not None and ends[1] is not None and door.get("style") != "sealed":
                    doors.append((ends[0], ends[1]))
            self._doors.append(doors)
            said_rooms.update(self._read_pieces(index, plan, layout))
        # The rooms before the places outside around them, the smallest of those first (a deck
        # in the garden drawn round it).
        self._room_list = sorted(
            self.rooms.values(),
            key=lambda room: (room.outside, _twice_area(room.outline) if room.outside else 0.0),
        )
        # Each storey's rooms in that order, with the box around each: a point or a line out of the
        # box is out of the room, its sides not crossed.
        self._storey_rooms: list[list[tuple[Box, Room]]] = [
            [(_box(room.outline), room) for room in self._room_list if room.storey == k]
            for k in range(len(self.elevations))
        ]
        # The sides left open between two rooms (D-079: a step between them goes across one).
        self._open_sides: dict[frozenset[str], list[tuple[Point, Point]]] = {}
        for storey_index, room_id, a, b in open_sides:
            for p in _across(a, b):
                other = self.room_at(storey_index, p)
                if (
                    other is not None
                    and other != room_id
                    and (not self.rooms[room_id].outside or self.rooms[other].outside)
                ):
                    pair = frozenset((room_id, other))
                    self._open.add(pair)
                    self._open_sides.setdefault(pair, []).append((a, b))
        self._has_rooms = [bool(rooms) for rooms in self._storey_rooms]
        self._indoor = [
            [room for room in self._room_list if room.storey == k and not room.outside]
            for k in range(len(self.elevations))
        ]
        for piece, said in said_rooms.items():
            if named := next((r for r in said if isinstance(r, str) and r in self.rooms), None):
                self.piece_rooms[piece] = named
        # The doors between two rooms (D-079: a step between them goes through one).
        self._door_pairs: dict[frozenset[str], list[tuple[Point, Point]]] = {}
        self.neighbours = self._link()

    def _read_pieces(
        self, storey: int, plan: Mapping[str, Any], layout: Mapping[str, Any]
    ) -> dict[str, tuple[Any, Any]]:
        """The pieces' centres, moved, lifted, removed or added by the overlay.

        Return the rooms each says it is in: the overlay's, the plan's.
        """
        said: dict[str, tuple[Any, Any]] = {}
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
            height = number(size[2]) if isinstance(size, list) and len(size) == 3 else None
            lift = number(moved.get("lift"))
            lift = lift if lift is not None else number(item.get("lift")) or 0.0
            self.pieces[key] = Spot(storey, at[0], at[1], floor + lift + (height or 0.0) / 2)
            turn = number(moved.get("rotation"))
            self.turns[key] = turn if turn is not None else number(item.get("rotation")) or 0.0
            said[key] = (moved.get("room"), item.get("room"))
            if item.get("kind") == STAIRS:
                # How far from its middle it lands: half its length, the longer of its sides.
                sides = [number(v) or 0.0 for v in size[:2]] if isinstance(size, list) else []
                self._stairs.append((storey, at, max(sides, default=0.0) / 2))
        return said

    def room_at(self, storey: int, p: Point) -> str | None:
        """The room a point of a storey is in."""
        x, y = p
        for (x0, y0, x1, y1), room in self._rooms_of(storey):
            if x0 <= x <= x1 and y0 <= y <= y1 and inside(room.outline, p):
                return room.id
        return None

    def _rooms_of(self, storey: int) -> list[tuple[Box, Room]]:
        return self._storey_rooms[storey] if 0 <= storey < len(self._storey_rooms) else []

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
                # A place outside around the home: not in its rooms.
                and not (room.outside and self.room_at(room.storey, (x, y)) != room.id)
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
        rooms no wider than a wall is the wall between them, in a garden drawn round them or not.
        """
        storey = a.storey
        length = math.hypot(b.x - a.x, b.y - a.y)
        if length < 1e-6:
            return 0.0
        # Where the line crosses a side of a room: the room changes there, nowhere else.
        cuts = {0.0, 1.0}
        low_x, high_x, low_y, high_y = min(a.x, b.x), max(a.x, b.x), min(a.y, b.y), max(a.y, b.y)
        for (x0, y0, x1, y1), listed in self._rooms_of(storey):
            if x1 < low_x or x0 > high_x or y1 < low_y or y0 > high_y:
                continue
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

        def indoors(room: str | None) -> bool:
            return room is not None and not self.rooms[room].outside

        total = 0.0
        i = 0
        while i < len(runs) - 1:
            here, _, end = runs[i]
            there, start, gap_end = runs[i + 1]
            # A gap between rooms, out of the home or in the garden drawn round it.
            gap = there is None or (
                self.rooms[there].outside
                and indoors(here)
                and i + 2 < len(runs)
                and indoors(runs[i + 2][0])
            )
            if (
                gap
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
        """The floors between two places (D-078), as the core counts them.

        The floors of the storeys over the lower place's storey, up to the higher place's, each
        counted where the line between the two places goes through its height under one of that
        storey's rooms (or a wall between two), or over a room of a full storey under it, whose
        ceiling it is (a half level beside another is not over it, nor two storeys over a room); a
        storey without rooms is a floor wherever it is crossed. Storeys at one height are one
        floor.
        """

        def height(spot: Spot) -> float:
            return self.elevations[spot.storey] if spot.storey < len(self.elevations) else 0.0

        lo, hi = (a, b) if (height(a), a.z) <= (height(b), b.z) else (b, a)
        bottom, top = height(lo), height(hi)
        rise = hi.z - lo.z
        count = 0
        for level in sorted({e for e in self.elevations if bottom < e <= top}):
            t = 0.5 if abs(rise) < 1e-9 else min(max((level - lo.z) / rise, 0.0), 1.0)
            p = (lo.x + (hi.x - lo.x) * t, lo.y + (hi.y - lo.y) * t)
            storeys = range(len(self.elevations))
            # A storey at that height without rooms, or with one there.
            here = any(
                self.elevations[k] == level and (not self._has_rooms[k] or self._indoors(k, p))
                for k in storeys
            )
            # The highest storey under it with a room there, a full storey lower (not two): its
            # ceiling.
            under = max(
                (
                    self.elevations[k]
                    for k in storeys
                    if self.elevations[k] < level and self._indoors(k, p)
                ),
                default=None,
            )
            if here or (under is not None and FULL_STOREY <= level - under < 2 * FULL_STOREY):
                count += 1
        return count

    def _indoors(self, storey: int, p: Point) -> bool:
        """Whether `p` is in a storey's room (not outside), or under a wall between two of them."""
        rooms = self._indoor[storey]
        if any(inside(room.outline, p) for room in rooms):
            return True
        return sum(1 for room in rooms if _edge_distance(room.outline, p) <= UNDER_WALLS) >= 2

    def indoors(self, storey: int, p: Point) -> bool:
        """Whether `p` is in a storey's room (not outside), or under a wall between two of them."""
        return 0 <= storey < len(self._indoor) and self._indoors(storey, p)

    def doors_between(self, a: str, b: str) -> list[tuple[Point, Point]]:
        """The doors between two rooms (not the sealed ones), each from end to end."""
        return list(self._door_pairs.get(frozenset((a, b)), []))

    def open_between(self, a: str, b: str) -> bool:
        """Whether two rooms are joined by a side left open (or are two places outside)."""
        return frozenset((a, b)) in self._open

    def open_sides(self, a: str, b: str) -> list[tuple[Point, Point]]:
        """The sides left open between two rooms (every side, between two places outside)."""
        return list(self._open_sides.get(frozenset((a, b)), []))

    @property
    def stairs(self) -> list[tuple[int, Point, float]]:
        """The stairs: their storey, their middle, and how far from it they land (cm)."""
        return list(self._stairs)

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
                one, other = self.room_at(storey, p), self.room_at(storey, q)
                join(one, other)
                if one is not None and other is not None and one != other:
                    self._door_pairs.setdefault(frozenset((one, other)), []).append(d)
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
        """Stairs join their room to the room above or below them.

        Else to the stairs' rooms there, else to the room of that storey they land beside (a split
        level's half flight, D-078).
        """
        stairs_rooms: dict[int, list[str]] = {}
        for storey, at, _ in self._stairs:
            if (room_id := self.room_at(storey, at)) is not None:
                stairs_rooms.setdefault(storey, []).append(room_id)
        for storey, at, half in self._stairs:
            here = self.room_at(storey, at)
            for other in (storey - 1, storey + 1):
                if not 0 <= other < len(self.elevations):
                    continue
                # A room right over (or under) them; a garden there is not where they lead.
                above = self.room_at(other, at)
                if above is not None and self.rooms[above].outside:
                    above = None
                there: list[str | None] = (
                    [above] if above is not None else list(stairs_rooms.get(other, []))
                )
                # Beside them, half a storey up or down only: a full storey's rooms are over them.
                rise = abs(self.elevations[other] - self.elevations[storey])
                if not there and 0 < rise < FULL_STOREY:
                    there = [self._beside(other, at, STAIRS_REACH + half)]
                for room in there:
                    join(here, room)

    def _beside(self, storey: int, at: Point, reach: float) -> str | None:
        """The room of a storey nearest `at` (not a place outside), within `reach`."""
        near = [
            (_edge_distance(room.outline, at), room.id)
            for room in self._room_list
            if room.storey == storey and not room.outside
        ]
        best = min(near, default=None)
        return best[1] if best is not None and best[0] <= reach else None


def _box(outline: tuple[Point, ...]) -> Box:
    xs, ys = [p[0] for p in outline], [p[1] for p in outline]
    return min(xs), min(ys), max(xs), max(ys)


def _twice_area(outline: tuple[Point, ...]) -> float:
    """Twice an outline's area (cm²)."""
    return abs(
        sum(
            outline[k - 1][0] * outline[k][1] - outline[k][0] * outline[k - 1][1]
            for k in range(len(outline))
        )
    )


def _flat(outline: tuple[Point, ...]) -> bool:
    """Whether an outline has no room in it (its corners on one line or one point)."""
    return _twice_area(outline) < 2.0


def _listed(plan: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    found = plan.get(key)
    return [item for item in found if isinstance(item, Mapping)] if isinstance(found, list) else []
