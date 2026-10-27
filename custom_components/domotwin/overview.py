"""What DomoTwin knows of each room, for Home Assistant's area pages (`docs/DECISIONS.md`, D-061).

Pure: the stored storeys, the upkeep cards and the people's places in, what each room holds out. A
piece's room is the one it names (its `room`), else the one its centre is in, as the 3D view
finds it.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .locating.geometry import Home
from .people import Place


def piece_rooms(storeys: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    """The room of every piece of the stored storeys (with their overlays), by piece id."""
    storeys = list(storeys)
    home = Home(storeys)
    named: dict[str, str] = {}
    for storey in storeys:
        plan = storey.get("plan")
        items = plan.get("items") if isinstance(plan, Mapping) else None
        for item in items if isinstance(items, list) else []:
            if isinstance(item, Mapping) and isinstance(item.get("id"), str):
                room = item.get("room")
                if isinstance(room, str) and room in home.rooms:
                    named[item["id"]] = room
        # A piece moved or added in edit mode follows the room its overlay names
        # (`docs/edit-mode.md`), which comes before the plan's.
        layout = storey.get("layout")
        for piece, entry in (layout if isinstance(layout, Mapping) else {}).items():
            room = entry.get("room") if isinstance(entry, Mapping) else None
            if isinstance(room, str) and room in home.rooms:
                named[piece] = room
    rooms: dict[str, str] = {}
    for piece, spot in home.pieces.items():
        room = named.get(piece) or home.room_at(spot.storey, (spot.x, spot.y))
        if room is not None:
            rooms[piece] = room
    return rooms


def tasks_by_room(
    tasks: Iterable[dict[str, Any]], rooms: Mapping[str, str]
) -> dict[str, list[dict[str, Any]]]:
    """The tasks (`due_tasks`) of the pieces in each room, in their order, by room id."""
    by_room: dict[str, list[dict[str, Any]]] = {}
    for task in tasks:
        room = rooms.get(str(task.get("piece")))
        if room is not None:
            by_room.setdefault(room, []).append(task)
    return by_room


def people_in(places: Mapping[str, Place], room: str) -> list[str]:
    """The people at home in a room, by person entity id, in a steady order."""
    return sorted(
        person
        for person, place in places.items()
        if place.home and place.room is not None and place.room.id == room
    )
