"""People in their rooms (docs/DECISIONS.md, D-034): which room of the plans each person is in.

Pure logic, no Home Assistant objects: the tracker (`tracker.py`) hands it states as plain values.
A person is placed from the entities linked to them whose state names a room: a room sensor of
Bermuda or ESPresense, a template, anything that says an area's name or a room's. The source that
changed last wins: a watch that just walked into the kitchen says more than a phone left on the
desk since the morning.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
import re
from typing import Any, Final
import unicodedata

# States that say where nobody is: a source that has lost its device, a person away.
NOWHERE: Final = frozenset(
    {"", "unknown", "unavailable", "none", "not home", "not_home", "away", "home", "off"}
)

# Colours of the people (stable for each person, from their entity id), bright enough on the
# night looks and dark enough on the day look.
COLORS: Final = (
    "#e8508a",
    "#2f9fd8",
    "#e3912b",
    "#3fae5a",
    "#8a63d2",
    "#d8573c",
    "#1ba39c",
    "#c9a227",
)
HEX_COLOR: Final = re.compile(r"^#[0-9a-fA-F]{6}$")


def norm(text: str) -> str:
    """Text as compared: no case, accents, punctuation or extra spaces ("Salle_de-Bain")."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    # Anything but letters and digits separates words, as the frontend reads names
    # (`nameWords`): "Bureau (Alex)" is "bureau alex".
    return " ".join(re.sub(r"[\W_]+", " ", plain).split())


def color_of(person: str) -> str:
    """A person's colour, the same on every screen and after every restart."""
    total = 0
    for char in person:
        total = (total * 31 + ord(char)) % 2_147_483_647
    return COLORS[total % len(COLORS)]


@dataclass(frozen=True)
class Room:
    """A room of a storey's plan, with the area it reads (its binding's, else the same name's)."""

    id: str
    name: str
    storey: str
    storey_name: str
    area: str | None


@dataclass(frozen=True)
class Area:
    """A Home Assistant area: its id, name and aliases."""

    id: str
    name: str
    aliases: tuple[str, ...] = ()


def rooms_of(
    storeys: Iterable[Mapping[str, Any]],
    bound: Mapping[str, Any],
    areas: Iterable[Area],
) -> list[Room]:
    """The rooms of every storey, each with its area.

    `bound` is the bindings' `rooms` (room id -> `{"area": id}`); without one, the area named as the
    room is the room's (docs/bindings.md).
    """
    by_name = {norm(area.name): area.id for area in areas}
    rooms: list[Room] = []
    for storey in storeys:
        plan = storey.get("plan")
        listed = plan.get("rooms") if isinstance(plan, dict) else None
        if not isinstance(listed, list):
            continue
        for room in listed:
            if not isinstance(room, dict) or not isinstance(room.get("id"), str):
                continue
            name = room.get("name") if isinstance(room.get("name"), str) else ""
            binding = bound.get(room["id"])
            area = binding.get("area") if isinstance(binding, dict) else None
            if not isinstance(area, str) or not area:
                area = by_name.get(norm(name)) if name else None
            rooms.append(
                Room(
                    id=room["id"],
                    name=name or room["id"],
                    storey=str(storey.get("id", "")),
                    storey_name=str(storey.get("name", "")),
                    area=area,
                )
            )
    return rooms


class RoomFinder:
    """Finds the room a source's state names."""

    def __init__(self, rooms: Iterable[Room], areas: Iterable[Area]) -> None:
        """Index the rooms by area and by name."""
        self.rooms = list(rooms)
        by_area: dict[str, list[Room]] = {}
        for room in self.rooms:
            if room.area:
                by_area.setdefault(room.area, []).append(room)
        self._by_area = by_area
        self._by_id = {room.id: room for room in self.rooms}
        # Each spelling of an area (its id, its name, its aliases) -> the area.
        spelled: dict[str, str] = {}
        for area in areas:
            for text in (area.id, area.name, *area.aliases):
                if text:
                    spelled.setdefault(norm(text), area.id)
        self._areas = spelled
        names: dict[str, list[Room]] = {}
        for room in self.rooms:
            names.setdefault(norm(room.name), []).append(room)
        self._names = names

    def room(self, room_id: str) -> Room | None:
        """The room with this id."""
        return self._by_id.get(room_id)

    def find(self, state: str, attributes: Mapping[str, Any] | None = None) -> Room | None:
        """The room a state names, or None.

        A state that names nowhere (unknown, away) names no room, whatever its attributes still
        say. Else a `room_id` attribute naming a room of the plans (DomoTwin's own Bluetooth
        locating) wins; then an `area_id` attribute (Bermuda's); then an area's id, name or alias,
        when a room reads that area; then a room's name. An area two rooms read, or a name two rooms
        have (a bathroom on each storey), names neither: guessing would put someone on the wrong
        floor.
        """
        said = norm(state)
        if said in NOWHERE:
            return None
        room_id = (attributes or {}).get("room_id")
        if isinstance(room_id, str) and room_id in self._by_id:
            return self._by_id[room_id]
        area = (attributes or {}).get("area_id")
        if isinstance(area, str) and area:
            return _single(self._by_area.get(area))
        area_id = self._areas.get(said)
        if area_id is not None and area_id in self._by_area:
            return _single(self._by_area[area_id])
        return _single(self._names.get(said))


def _single(rooms: list[Room] | None) -> Room | None:
    return rooms[0] if rooms and len(rooms) == 1 else None


@dataclass(frozen=True)
class Reading:
    """A source's state, as the tracker read it."""

    entity: str
    state: str
    attributes: Mapping[str, Any]
    changed: datetime


@dataclass(frozen=True)
class Place:
    """Where a person is: away, at home in a room, or at home somewhere not known."""

    home: bool
    room: Room | None = None
    source: str | None = None
    since: datetime | None = None


AWAY: Final = Place(home=False)


def place_of(person_state: str | None, readings: Iterable[Reading], finder: RoomFinder) -> Place:
    """Where a person is, from their own state and their sources' readings.

    Only a person at home is placed (`home`; a zone's name or `not_home` is away), whatever their
    sources still say. Of the sources naming a room, the one that changed last wins.
    """
    if person_state != "home":
        return AWAY
    best: tuple[datetime, Reading, Room] | None = None
    for reading in readings:
        room = finder.find(reading.state, reading.attributes)
        if room is None:
            continue
        if best is None or reading.changed > best[0]:
            best = (reading.changed, reading, room)
    if best is None:
        return Place(home=True)
    changed, reading, room = best
    return Place(home=True, room=room, source=reading.entity, since=changed)


def likeness(said: str, names: Iterable[str]) -> int | None:
    """How well a name said matches one of a person's names, the lower the better.

    0 the whole name, 1 the first name, 2 a letter off (a name heard wrong: "Torsten" for
    "Thorsten"), None not at all. Case, accents and a possessive ("Anna's") are forgiven.
    """
    wanted = norm(re.sub(r"(?:['\u2019]s|['\u2019])$", "", said.strip()))
    if not wanted:
        return None
    best: int | None = None
    for name in names:
        full = norm(name)
        if not full:
            continue
        first = full.split(" ")[0]
        if wanted == full:
            return 0
        if wanted == first:
            best = 1
        elif best is None and _near(wanted, full, first):
            best = 2
    return best


# Words before a thing's name: "where are my keys", "où sont les clés".
DETERMINERS: Final = frozenset(
    {"the", "my", "our", "your", "a", "le", "la", "les", "l", "mes", "mon", "ma", "nos", "notre"}
)


def _thing_words(text: str) -> str:
    words = norm(text).split(" ")
    while words and words[0] in DETERMINERS:
        words.pop(0)
    return " ".join(words)


def thing_likeness(said: str, name: str) -> int | None:
    """How well a name said matches a thing's name, the lower the better (as `likeness`).

    0 the whole name, 1 its first or last words ("keys" for "Alex's keys"), 2 a letter off in a
    name of five letters or more; the words before it ("my", "les") are left out.
    """
    wanted, full = _thing_words(said), _thing_words(name)
    if not wanted or not full:
        return None
    if wanted == full:
        return 0
    if full.endswith(" " + wanted) or full.startswith(wanted + " "):
        return 1
    if len(wanted) >= 5 and _distance(wanted, full) <= 1:
        return 2
    return None


def _near(wanted: str, full: str, first: str) -> bool:
    """A name of five letters or more, one letter off the whole name or the first."""
    return len(wanted) >= 5 and min(_distance(wanted, full), _distance(wanted, first)) <= 1


def _distance(a: str, b: str) -> int:
    """Edits (a letter added, removed or changed) from one text to the other."""
    if abs(len(a) - len(b)) > 1:
        return 2
    previous = list(range(len(b) + 1))
    for i, char in enumerate(a, 1):
        current = [i]
        for j, other in enumerate(b, 1):
            changed = previous[j - 1] + (char != other)
            current.append(min(previous[j] + 1, current[j - 1] + 1, changed))
        previous = current
    return previous[-1]


def valid_color(value: Any) -> bool:
    """Whether a value is a colour a person can be given (`#rrggbb`)."""
    return isinstance(value, str) and HEX_COLOR.match(value) is not None
