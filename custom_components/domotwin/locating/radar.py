"""Presence radars (mmWave) on the plans, merged with Bluetooth (docs/DECISIONS.md, D-080).

A radar is a piece of the plans linked to its Home Assistant device: it stands where the piece is
and looks the way its front faces, as a linked camera does (D-024). Each says what it can, no
more: where its targets are (across and ahead of it: an LD2450, an Everything Presence Lite), how
far its target is (an LD2410), or only whether someone is there (a zone, an Aqara FP2 through
HomeKit: a presence sensor of its room, weighed as D-035 weighs them). Its targets, turned into the
plan's own coordinates and merged across radars, say where someone is; Bluetooth says who. Pure.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
import math
import re
from typing import Final

from .cells import Cell, Cells
from .filter import PRESENCE_ON
from .geometry import Home, Point

# A radar's field when its link does not say: an LD2450's (degrees across, cm ahead).
FIELD: Final = 120.0
REACH: Final = 600.0
# Two targets this close (cm) on one storey, seen by two radars, are one person.
SAME_PERSON: Final = 60.0
# How sure a target's place is (cm), and a distance's (an LD2410's, a ring around it).
TARGET_SPREAD: Final = 40.0
DISTANCE_SPREAD: Final = 60.0
# A cell where a radar sees someone is this much likelier than one it says nothing of; in the
# field of a radar that says nobody is there (its presence off), this likely.
SEEN: Final = 3.0
UNSEEN: Final = 0.3
# A room a radar sees someone in: as likely as a presence sensor on makes it.
TARGET_ON: Final = PRESENCE_ON
# A carried device told in a room is the person a radar sees there when this near their spot (cm).
MATCH_REACH: Final = 250.0
# A target seen again this near (cm) is the one seen before (it keeps its number in the views):
# someone walking briskly between two readings of the radars.
FOLLOW: Final = 200.0
# The person a target was before stays it against another this much nearer their Bluetooth spot
# (cm), which is a metre or two off: their figure does not jump from one to the other.
STICK: Final = 100.0

# What a radar's entities say, read from their ids and names: a target's place across and ahead
# of it, how far someone is, whether someone is there.
_TARGET = re.compile(r"\btarget (\d+) (x|y)\b")
_DISTANCE = re.compile(r"\b(detection|moving|still|presence|target) distance\b")
_NOT_DISTANCE = re.compile(r"\b(max|min|maximum|minimum|resolution|gate|threshold|timeout)\b")
_PRESENCE = re.compile(r"\b(presence|occupancy|occupied|has target)\b")
# The distance said best first.
_DISTANCES: Final = ("detection", "presence", "target", "moving", "still")
# A length's unit, in cm (Home Assistant shows lengths in the units the user chose).
_UNITS: Final = {
    "mm": 0.1,
    "cm": 1.0,
    "m": 100.0,
    "km": 100_000.0,
    "in": 2.54,
    "ft": 30.48,
    "yd": 91.44,
    "mi": 160_934.4,
}


def words(text: str) -> str:
    """An id or a name as plain words: lower case, anything not a letter or a digit a space."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


@dataclass(frozen=True)
class Signals:
    """The entities of a radar that say something: its targets' places, a distance, a presence."""

    # Each target's entities across (X) and ahead (Y), by its number.
    targets: tuple[tuple[str, str], ...] = ()
    distance: str | None = None
    presence: str | None = None

    @property
    def kind(self) -> str | None:
        """What it says: where its targets are, how far its target is; None, nothing of use.

        A distance says someone's only beside a presence of the radar's own (not a tank's level).
        """
        if self.targets:
            return "targets"
        return "distance" if self.distance and self.presence else None

    @property
    def entities(self) -> list[str]:
        """The entities it reads."""
        found = [e for pair in self.targets for e in pair]
        return found + [e for e in (self.distance, self.presence) if e is not None]


def signals(entities: Iterable[tuple[str, str]]) -> Signals:
    """What a radar's entities say, from each one's id and name (`(entity_id, name)`).

    A sensor `target 1 x` and `target 1 y` give a target; a sensor of a detection, moving or still
    distance (not a setting: no maximum, gate or threshold) how far; a binary sensor of presence
    (not a zone's) whether someone is there.
    """
    axes: dict[int, dict[str, str]] = {}
    distances: dict[str, str] = {}
    presence: str | None = None
    for entity_id, name in sorted(entities):
        domain, _, object_id = entity_id.partition(".")
        said = f"{words(object_id)} | {words(name)}"
        if domain == "sensor":
            if found := _TARGET.search(said):
                axes.setdefault(int(found[1]), {}).setdefault(found[2], entity_id)
            elif (found := _DISTANCE.search(said)) and not _NOT_DISTANCE.search(said):
                distances.setdefault(found[1], entity_id)
        elif (
            domain == "binary_sensor"
            and presence is None
            and _PRESENCE.search(said)
            and "zone" not in said
        ):
            presence = entity_id
    targets = tuple(
        (pair["x"], pair["y"]) for _, pair in sorted(axes.items()) if "x" in pair and "y" in pair
    )
    distance = next((distances[k] for k in _DISTANCES if k in distances), None)
    return Signals(targets, distance, presence)


def length(value: str | None, unit: object, default: str) -> float | None:
    """A length an entity's state says, in cm (in its unit, else `default`).

    None when it is not a number, or in a unit that is not a length's.
    """
    try:
        number = float(value) if value is not None else math.nan
    except ValueError:
        return None
    scale = _UNITS.get(unit if isinstance(unit, str) and unit else default)
    return number * scale if scale is not None and math.isfinite(number) else None


@dataclass(frozen=True)
class Radar:
    """A radar on the plans: where it stands (cm), which way its front faces, what it sees."""

    id: str
    storey: int
    x: float
    y: float
    # The piece's turn (degrees): its front, its own +y, turned by it (as a camera's, D-024).
    turn: float
    room: str | None
    fov: float = FIELD
    reach: float = REACH
    # Its targets across it the other way (a radar that counts them from its other side).
    mirror: bool = False

    @property
    def front(self) -> Point:
        """Which way it looks, on the plan."""
        s, c = math.sin(math.radians(self.turn)), math.cos(math.radians(self.turn))
        return (-s, c)

    def place(self, across: float, ahead: float) -> Point:
        """Where on the plan a target is, `across` it (cm, to its right as it looks) and `ahead`."""
        fx, fy = self.front
        # Its right as it looks out, the plan's y going down as drawn.
        rx, ry = -fy, fx
        if self.mirror:
            across = -across
        return (self.x + fx * ahead + rx * across, self.y + fy * ahead + ry * across)

    def sees(self, p: Point) -> bool:
        """Whether a point of its storey is in its field: within its reach and its angle."""
        dx, dy = p[0] - self.x, p[1] - self.y
        distance = math.hypot(dx, dy)
        if distance > self.reach:
            return False
        if distance < 1.0:
            return True
        fx, fy = self.front
        cosine = (dx * fx + dy * fy) / distance
        return cosine >= math.cos(math.radians(self.fov / 2)) - 1e-9


@dataclass(frozen=True)
class Reading:
    """What a radar says now.

    Its targets (cm across and ahead), how far its target is, and whether its presence is on
    (None: it has none, or says nothing now).
    """

    targets: tuple[tuple[float, float], ...] = ()
    distance: float | None = None
    present: bool | None = None


@dataclass(frozen=True)
class Target:
    """Someone the radars see, on the plans: storey, place (cm), room, the radars that see them."""

    storey: int
    x: float
    y: float
    room: str
    radars: tuple[str, ...] = field(default=())


def _sees_into(home: Home, radar: Radar, room: str) -> bool:
    """Whether a radar sees into a room: its own, or one a side left open joins to it."""
    return radar.room is not None and (room == radar.room or home.open_between(radar.room, room))


def seen(home: Home, radars: Iterable[Radar], readings: Mapping[str, Reading]) -> list[Target]:
    """Where the people the radars see are: their targets on the plans, one for each person.

    A target out of the radar's field, out of every room, or in a room the radar does not see
    into (behind a wall: a reflection, or someone next door) is left out; two targets of two radars
    as near as one person on a storey are that person, between the two.
    """
    found: list[list[tuple[str, float, float, int, str]]] = []
    for radar in radars:
        reading = readings.get(radar.id)
        for across, ahead in reading.targets if reading is not None else ():
            p = radar.place(across, ahead)
            room = home.room_at(radar.storey, p)
            if not radar.sees(p) or room is None or not _sees_into(home, radar, room):
                continue
            near = min(
                (
                    group
                    for group in found
                    if group[0][3] == radar.storey
                    and all(r != radar.id for r, *_ in group)
                    and math.dist(_middle(group), p) <= SAME_PERSON
                ),
                key=lambda group: math.dist(_middle(group), p),
                default=None,
            )
            if near is None:
                found.append([(radar.id, p[0], p[1], radar.storey, room)])
            else:
                near.append((radar.id, p[0], p[1], radar.storey, room))
    targets = []
    for group in found:
        x, y = _middle(group)
        storey = group[0][3]
        room = home.room_at(storey, (x, y)) or group[0][4]
        targets.append(Target(storey, x, y, room, tuple(r for r, *_ in group)))
    return targets


def _middle(group: list[tuple[str, float, float, int, str]]) -> Point:
    return (
        sum(x for _, x, _, _, _ in group) / len(group),
        sum(y for _, _, y, _, _ in group) / len(group),
    )


@dataclass(frozen=True)
class Sight:
    """What the radars see at a moment: those working, what each says, the people it makes."""

    radars: tuple[Radar, ...] = ()
    readings: Mapping[str, Reading] = field(default_factory=dict)
    targets: tuple[Target, ...] = ()


def look(home: Home, radars: Iterable[Radar], readings: Mapping[str, Reading]) -> Sight:
    """What the radars that are working see now: those with a reading, in a room."""
    working = tuple(r for r in radars if r.id in readings and r.room is not None)
    return Sight(working, dict(readings), tuple(seen(home, working, readings)))


def room_weights(targets: Iterable[Target]) -> dict[str, float]:
    """The rooms a radar sees someone in: as a presence sensor on weighs them."""
    return {target.room: TARGET_ON for target in targets}


def cell_weight(home: Home, cell: Cell, sight: Sight) -> float:
    """How much likelier a cell is from what the radars see (1: they say nothing of it).

    Near someone a working radar sees (or at the distance it sees someone), likelier; in the
    field of one that says nobody is there (its presence off), less likely. A radar that sees
    nobody near but whose presence is on (someone sitting still it lost) says nothing.
    """
    p = (cell.x, cell.y)
    covering = [
        r
        for r in sight.radars
        if r.storey == cell.storey and r.sees(p) and _sees_into(home, r, cell.room)
    ]
    if not covering:
        return 1.0
    near = 0.0
    for target in sight.targets:
        if target.storey == cell.storey:
            near = max(near, _bell(math.dist(p, (target.x, target.y)), TARGET_SPREAD))
    empty = False
    for radar in covering:
        reading = sight.readings[radar.id]
        if reading.distance is not None:
            off = abs(math.dist(p, (radar.x, radar.y)) - reading.distance)
            near = max(near, _bell(off, DISTANCE_SPREAD))
        empty = empty or reading.present is False
    if near < 1e-3 and empty:
        return UNSEEN
    return 1.0 + (SEEN - 1.0) * near


def cell_weights(home: Home, cells: Cells, kept: Iterable[int], sight: Sight) -> dict[int, float]:
    """`cell_weight` of each kept cell (by its index)."""
    return {k: cell_weight(home, cells.cells[k], sight) for k in kept}


def _bell(off: float, spread: float) -> float:
    return math.exp(-0.5 * (off / spread) ** 2)


def match(
    people: Mapping[str, tuple[str, int, Point]],
    targets: list[Target],
    before: Mapping[str, Point] | None = None,
) -> dict[str, Target]:
    """Who each target is: the person nearest to it in its room (`(room, storey, spot)`).

    Nearest first, each person and each target once, within `MATCH_REACH`; a target near the one a
    person was `before` stays theirs (by `STICK`, however far their spot). The others stay
    someone no device names.
    """
    before = before or {}
    pairs = []
    for person, (room, storey, spot) in people.items():
        for k, target in enumerate(targets):
            if target.room != room or target.storey != storey:
                continue
            distance = math.dist(spot, (target.x, target.y))
            last = before.get(person)
            kept = last is not None and math.dist(last, (target.x, target.y)) <= FOLLOW
            if kept or distance <= MATCH_REACH:
                pairs.append((distance - STICK if kept else distance, person, k))
    found: dict[str, Target] = {}
    taken: set[int] = set()
    for _, person, k in sorted(pairs):
        if person in found or k in taken:
            continue
        found[person] = targets[k]
        taken.add(k)
    return found


def follow(
    previous: Mapping[int, Target], targets: Iterable[Target], first: int
) -> dict[int, Target]:
    """Number the targets no device names: as before when seen again near, else anew from `first`.

    Nearest first, so that someone the views show walks on rather than another taking their place.
    """
    targets = list(targets)
    pairs = sorted(
        (math.dist((before.x, before.y), (target.x, target.y)), n, k)
        for n, before in previous.items()
        for k, target in enumerate(targets)
        if before.storey == target.storey
    )
    named: dict[int, Target] = {}
    placed: set[int] = set()
    for distance, n, k in pairs:
        if distance > FOLLOW:
            break
        if n in named or k in placed:
            continue
        named[n] = targets[k]
        placed.add(k)
    fresh = first
    for k, target in enumerate(targets):
        if k not in placed:
            named[fresh] = target
            fresh += 1
    return named
