"""Per-person rights (`DECISIONS.md`, D-068): what DomoTwin shows each person and lets them do.

An administrator sets, room by room and device by device, what each person uses (`use`, the
default), only sees (`see`) or does not see (`hidden`), and the same for everyone else. A person is
one through the Home Assistant user of their `person`; a user who is nobody's (a shared screen) has
everyone's. Rights apply to users who are not administrators: an administrator sets them, and Home
Assistant gives them everything.

A device's level is its own when it has one (the person's, else everyone's), else the strictest of
the rooms it is in; a room hidden, or private and closed to the user (D-039), hides all it holds.
A device is in a room when it is linked to the room or to a piece, door or window of it, or when
its area is the room's (as the 3D view and the Home and Rooms tabs find it).

DomoTwin hides and refuses in its own views, controls and services: Home Assistant still lets
every user act on every entity elsewhere (its permissions are by user, not by entity).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Final

from homeassistant.auth.models import User
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er

from .const import PLAN_LISTS, RIGHTS_LEVELS
from .people import Area, rooms_of
from .privacy import private_rooms

USE, SEE, HIDDEN = RIGHTS_LEVELS
_RANK: Final = {level: rank for rank, level in enumerate(RIGHTS_LEVELS)}


def person_of(states: Iterable[State], user_id: str) -> str | None:
    """The person whose Home Assistant user is `user_id` (none: the user is nobody's)."""
    for state in states:
        if state.attributes.get("user_id") == user_id:
            return state.entity_id
    return None


@dataclass(frozen=True)
class Viewer:
    """The rights that apply to one user: their person's own, and everyone's."""

    own: Mapping[str, Any]
    everyone: Mapping[str, Any]

    def _level(self, kind: str, key: str) -> str | None:
        for rights in (self.own, self.everyone):
            level = rights.get(kind, {}).get(key)
            if isinstance(level, str):
                return level
        return None

    def room(self, room: str) -> str:
        """A room's level for the user."""
        return self._level("rooms", room) or USE

    def entity(self, entity: str) -> str | None:
        """A device's own level for the user, if it has one."""
        return self._level("entities", entity)

    def rooms(self, level: str) -> set[str]:
        """The rooms at `level` for the user (among those given one)."""
        named = {*self.own.get("rooms", {}), *self.everyone.get("rooms", {})}
        return {room for room in named if self.room(room) == level}

    @property
    def restricted(self) -> bool:
        """Whether anything is seen only or hidden."""
        return any(
            level != USE
            for rights in (self.own, self.everyone)
            for kind in ("rooms", "entities")
            for level in rights.get(kind, {}).values()
        )


def viewer_of(hass: HomeAssistant, rights: Mapping[str, Any], user: User | None) -> Viewer | None:
    """The rights that apply to `user`.

    None for an administrator and for Home Assistant itself (no user); everyone's for a user who
    is nobody's.
    """
    if user is None or user.is_admin:
        return None
    people: Mapping[str, Any] = rights.get("people", {})
    person = person_of(
        (state for p in people if (state := hass.states.get(p)) is not None), user.id
    )
    return Viewer(own=people.get(person, {}) if person else {}, everyone=rights.get("everyone", {}))


def hidden_rooms(hass: HomeAssistant, settings: Mapping[str, Any], user: User | None) -> set[str]:
    """The rooms hidden by rights from `user`, as told to anyone (`None`): everyone's."""
    rights: Mapping[str, Any] = settings.get("rights", {})
    if user is None:
        return Viewer(own={}, everyone=rights.get("everyone", {})).rooms(HIDDEN)
    viewer = viewer_of(hass, rights, user)
    return viewer.rooms(HIDDEN) if viewer is not None else set()


def entity_area(hass: HomeAssistant, entity: str) -> str | None:
    """An entity's area: its own, else its device's."""
    entry = er.async_get(hass).async_get(entity)
    if entry is None:
        return None
    if entry.area_id is not None:
        return entry.area_id
    if entry.device_id is None:
        return None
    device = dr.async_get(hass).async_get(entry.device_id)
    return device.area_id if device is not None else None


def linked_rooms(
    storeys: Iterable[Mapping[str, Any]], bindings: Mapping[str, Any]
) -> dict[str, set[str]]:
    """The rooms each linked entity is in by its links: to a room, or to something of one.

    A piece, a door or a window is in the room it names, its overlay's first (edit mode); a piece
    added in edit mode, in the one its overlay names.
    """
    room_of: dict[str, str] = {}
    rooms: set[str] = set()
    for storey in storeys:
        plan = storey.get("plan")
        plan = plan if isinstance(plan, Mapping) else {}
        layout = storey.get("layout")
        layout = layout if isinstance(layout, Mapping) else {}
        for key in PLAN_LISTS:
            listed = plan.get(key)
            for element in listed if isinstance(listed, list) else []:
                if not isinstance(element, Mapping) or not isinstance(element.get("id"), str):
                    continue
                if key == "rooms":
                    rooms.add(element["id"])
                elif isinstance(element.get("room"), str):
                    room_of[element["id"]] = element["room"]
        for element, entry in layout.items():
            if isinstance(entry, Mapping) and isinstance(entry.get("room"), str):
                room_of[element] = entry["room"]
    found: dict[str, set[str]] = {}
    elements: Mapping[str, Any] = bindings.get("elements", {})
    for element, binding in elements.items():
        room = element if element in rooms else room_of.get(element)
        if room is None or not isinstance(binding, Mapping):
            continue
        for linked in binding.get("entities", []):
            if isinstance(linked, Mapping) and isinstance(linked.get("entity_id"), str):
                found.setdefault(linked["entity_id"], set()).add(room)
    return found


class Levels:
    """Each entity's level for one user, worked out once for a request."""

    def __init__(
        self,
        hass: HomeAssistant,
        viewer: Viewer,
        user: User | None,
        home: tuple[list[dict[str, Any]], Mapping[str, Any], Mapping[str, Any]],
    ) -> None:
        """Gather the rooms closed to the user (`None`: nobody's), and where each entity is.

        `home`: the storeys, the bindings and the settings.
        """
        storeys, bindings, settings = home
        self._hass = hass
        self._viewer = viewer
        self._closed = viewer.rooms(HIDDEN) | private_rooms(
            settings.get("rooms", {}), hass.states.get, user.id if user else None
        )
        self._linked = linked_rooms(storeys, bindings)
        areas = [
            Area(area.id, area.name, tuple(sorted(area.aliases)))
            for area in ar.async_get(hass).async_list_areas()
        ]
        self._by_area: dict[str, set[str]] = {}
        for room in rooms_of(storeys, bindings.get("rooms", {}), areas):
            if room.area:
                self._by_area.setdefault(room.area, set()).add(room.id)

    def rooms(self, entity: str) -> set[str]:
        """The rooms an entity is in: by its links, and by its area."""
        area = entity_area(self._hass, entity)
        return self._linked.get(entity, set()) | self._by_area.get(area or "", set())

    def level(self, entity: str) -> str:
        """An entity's level.

        Hidden in a room closed to the user; else its own; else its rooms' strictest.
        """
        rooms = self.rooms(entity)
        if rooms & self._closed:
            return HIDDEN
        own = self._viewer.entity(entity)
        if own is not None:
            return own
        return max((self._viewer.room(room) for room in rooms), key=_RANK.__getitem__, default=USE)

    def uses(self, entities: Iterable[str]) -> bool:
        """Whether the user may act on all of these entities."""
        return all(self.level(entity) == USE for entity in entities)


def levels_for(hass: HomeAssistant, user: User | None, *, voice: bool = False) -> Levels | None:
    """The levels of entities for `user`; none when no rights apply (`viewer_of`).

    `voice`: asked by voice, where no user is nobody's (a satellite's), with everyone's rights, as
    `domotwin.where` tells it; otherwise no user is Home Assistant itself (an automation).
    """
    from .data import DATA_KEY  # noqa: PLC0415 (data imports the modules that use this one)

    data = hass.data.get(DATA_KEY)
    if data is None or (user is None and not voice):
        return None
    settings = data.settings
    rights: Mapping[str, Any] = settings.get("rights", {})
    viewer = (
        viewer_of(hass, rights, user)
        if user is not None
        else Viewer(own={}, everyone=rights.get("everyone", {}))
    )
    if viewer is None or (not viewer.restricted and not settings.get("rooms")):
        return None
    return Levels(hass, viewer, user, (data.storeys, data.bindings, settings))
