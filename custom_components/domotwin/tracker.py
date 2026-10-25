"""People in their rooms (docs/DECISIONS.md, D-034): the people's settings and where each one is.

The settings live in a store of their own (`.storage/domotwin.people`): which entities say where
each person is, who sees the people, how they are drawn, who hid themselves. The tracker follows the
people and their sources and works out each one's room (`people.place_of`) on every change; the
sensors (`sensor.py`) and `domotwin.where` read it.
"""

from __future__ import annotations

from collections.abc import Callable
import copy
from typing import Any, Final

from homeassistant.auth.models import User
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import (
    DOMAIN,
    MAX_PEOPLE,
    PEOPLE_STORAGE_KEY,
    PEOPLE_STORAGE_VERSION,
    SIGNAL_PEOPLE,
    SIGNAL_UPDATED,
)
from .locator import Locator
from .people import AWAY, Area, Place, Reading, RoomFinder, place_of, rooms_of
from .storage import DomoTwinData, RevisionConflictError

# Platforms whose sensors say a room: Bermuda's area sensors, ESPresense's (MQTT room).
ROOM_PLATFORMS: Final = frozenset({"bermuda", "mqtt_room"})
# Sources offered for one person, and in all.
MAX_SUGGESTED: Final = 8
MAX_CANDIDATES: Final = 60


def _own(registry: er.EntityRegistry, entity: str) -> bool:
    """Whether an entity is one of DomoTwin's own people's room sensors (never a source).

    The rooms of the devices DomoTwin follows by Bluetooth are sources, of their owner's place.
    """
    entry = registry.async_get(entity)
    return entry is not None and entry.platform == DOMAIN and "_located_" not in entry.unique_id


def name_of(hass: HomeAssistant, person: str) -> str:
    """A person's name as Home Assistant shows it, else their entity's object id."""
    state = hass.states.get(person)
    return state.name if state is not None else person.split(".", 1)[1]


def empty_people() -> dict[str, Any]:
    """Return the people's settings before any is set: nobody placed, everyone sees them."""
    return {"version": 1, "shown": "everyone", "look": "figure", "hidden": [], "people": {}}


class PeopleTracker:
    """The people's settings, kept in their own store, and where each person is now."""

    def __init__(
        self, hass: HomeAssistant, data: DomoTwinData, locator: Locator | None = None
    ) -> None:
        """Prepare the store; nothing is followed before `async_start`.

        The phones and watches the `locator` follows place their owners too.
        """
        self._hass = hass
        self._data = data
        self._locator = locator
        self._store: Store[dict[str, Any]] = Store(
            hass, PEOPLE_STORAGE_VERSION, PEOPLE_STORAGE_KEY, private=True
        )
        self._config = empty_people()
        self.revision = 0
        self.places: dict[str, Place] = {}
        self._finder = RoomFinder([], [])
        # Each entity followed -> the people it places, and the subscription to their changes.
        self._watched: dict[str, set[str]] = {}
        self._followed: set[str] = set()
        self._unfollow: Callable[[], None] | None = None
        self._stops: list[Callable[[], None]] = []

    async def async_load(self) -> None:
        """Load the settings, or start with nobody placed."""
        stored = await self._store.async_load()
        config = empty_people()
        if isinstance(stored, dict):
            for key in ("shown", "look", "hidden", "people"):
                if key in stored:
                    config[key] = stored[key]
            self.revision = int(stored.get("revision", 0))
        self._config = config

    @property
    def config(self) -> dict[str, Any]:
        """The settings: `shown` (`everyone` or `admins`), `look`, `hidden`, `people`."""
        return self._config

    def untold(self, user: User | None) -> set[str]:
        """The people not to show or tell about to `user` (None: an automation, nobody known).

        Those who hid themselves; every one when only administrators see the people and the one
        asking is not known to be one (a voice question runs as an automation, whoever asks).
        """
        if self._config["shown"] == "admins" and (user is None or not user.is_admin):
            return set(self._config["people"])
        return set(self._config["hidden"])

    def sources(self, person: str) -> list[str]:
        """The entities that say where a person is: those chosen, and their Bluetooth devices'."""
        settings = self._config["people"].get(person)
        sources = settings.get("sources") if isinstance(settings, dict) else None
        found = list(sources) if isinstance(sources, list) else []
        return found + [s for s in self.located_sources(person) if s not in found]

    def located_sources(self, person: str) -> list[str]:
        """The room sensors of the phones and watches DomoTwin follows for a person (D-035)."""
        if self._locator is None:
            return []
        return [self._locator.sensor_of(device) for device in self._locator.owned_by(person)]

    async def async_place(self, people: list[str]) -> None:
        """Place people not placed yet (their Bluetooth devices were just chosen)."""
        missing = [p for p in dict.fromkeys(people) if p not in self._config["people"]]
        # Never past the people's limit, which their settings are checked against.
        missing = missing[: max(0, MAX_PEOPLE - len(self._config["people"]))]
        if missing:
            self._config["people"] = {
                **self._config["people"],
                **{person: {"sources": []} for person in missing},
            }
            await self._async_commit()

    @callback
    def async_start(self) -> None:
        """Follow the states, the areas and the plans."""
        self._stops = [
            self._hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, self._rooms_changed),
            self._hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, self._renamed),
            async_dispatcher_connect(self._hass, SIGNAL_UPDATED, self._saved),
        ]
        self._rebuild()

    @callback
    def async_stop(self) -> None:
        """Stop following."""
        for stop in self._stops:
            stop()
        self._stops = []
        self._follow(set())

    @callback
    def _follow(self, entities: set[str]) -> None:
        """Follow the states of `entities` alone, from now on.

        Home Assistant's index of them is used: not every change of the home is looked at.
        """
        if entities == self._followed:
            return
        if self._unfollow is not None:
            self._unfollow()
            self._unfollow = None
        self._followed = entities
        if entities:
            self._unfollow = async_track_state_change_event(
                self._hass, sorted(entities), self._state_changed
            )

    async def async_save(
        self,
        people: dict[str, Any],
        shown: str | None = None,
        look: str | None = None,
        expected_revision: int | None = None,
    ) -> int:
        """Store who is placed from what, who sees the people and how they are drawn.

        The people are checked by `validation.validate_people`. Raises RevisionConflictError
        when saved meanwhile since `expected_revision`. Return the new revision.
        """
        if expected_revision is not None and expected_revision != self.revision:
            raise RevisionConflictError(self.revision)
        self._config["people"] = people
        if shown is not None:
            self._config["shown"] = shown
        if look is not None:
            self._config["look"] = look
        known = set(people)
        self._config["hidden"] = [p for p in self._config["hidden"] if p in known]
        return await self._async_commit()

    async def async_hide(self, person: str, hidden: bool) -> int:
        """Hide a person from the views (or show them again). Return the new revision."""
        listed = [p for p in self._config["hidden"] if p != person]
        if hidden:
            listed.append(person)
        self._config["hidden"] = listed
        return await self._async_commit()

    async def _async_commit(self) -> int:
        self.revision += 1
        await self._store.async_save({**copy.deepcopy(self._config), "revision": self.revision})
        self._rebuild()
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, "people", self.revision)
        return self.revision

    async def async_remove(self) -> None:
        """Delete the settings (when the integration is removed)."""
        await self._store.async_remove()

    def _areas(self) -> list[Area]:
        return [
            Area(area.id, area.name, tuple(sorted(area.aliases)))
            for area in ar.async_get(self._hass).async_list_areas()
        ]

    @callback
    def _rebuild(self) -> None:
        """Index the rooms again and place everyone."""
        areas = self._areas()
        rooms = rooms_of(self._data.storeys, self._data.bindings.get("rooms", {}), areas)
        self._finder = RoomFinder(rooms, areas)
        watched: dict[str, set[str]] = {}
        for person in self._config["people"]:
            for entity in (person, *self.sources(person)):
                watched.setdefault(entity, set()).add(person)
        self._watched = watched
        if self._stops:
            self._follow(set(watched))
        for person in list(self.places):
            if person not in self._config["people"]:
                del self.places[person]
        for person in self._config["people"]:
            self._place(person)

    @callback
    def _saved(self, kind: str, revision: int) -> None:
        if kind in ("plan", "bindings", "locating"):
            self._rebuild()

    @callback
    def _rooms_changed(self, event: Event[Any]) -> None:
        self._rebuild()

    @callback
    def _renamed(self, event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        """An entity renamed (its id changed): the people and sources follow it."""
        data = event.data
        if data["action"] != "update" or "old_entity_id" not in data:
            return
        old, new = data["old_entity_id"], data["entity_id"]
        people: dict[str, Any] = self._config["people"]
        if old not in self._watched:
            return
        renamed: dict[str, Any] = {}
        for person, settings in people.items():
            sources = [new if s == old else s for s in settings.get("sources", [])]
            renamed[new if person == old else person] = {**settings, "sources": sources}
        self._config["hidden"] = [new if p == old else p for p in self._config["hidden"]]
        self._config["people"] = renamed
        self._hass.async_create_task(self._async_commit())

    @callback
    def _state_changed(self, event: Event[EventStateChangedData]) -> None:
        for person in self._watched.get(event.data["entity_id"], ()):
            self._place(person)

    @callback
    def _place(self, person: str) -> None:
        state = self._hass.states.get(person)
        # DomoTwin's own room sensors say where someone was placed: never a source.
        registry = er.async_get(self._hass)
        readings = [
            Reading(source.entity_id, source.state, source.attributes, source.last_changed)
            for entity in self.sources(person)
            if (source := self._hass.states.get(entity)) is not None and not _own(registry, entity)
        ]
        place = AWAY if state is None else place_of(state.state, readings, self._finder)
        if self.places.get(person) != place:
            self.places[person] = place
            async_dispatcher_send(self._hass, SIGNAL_PEOPLE, person)

    @property
    def finder(self) -> RoomFinder:
        """The rooms of the plans, found by what a source says."""
        return self._finder

    def candidates(self) -> list[dict[str, Any]]:
        """Entities that may say where someone is, for the settings (administrators).

        A sensor of Bermuda or ESPresense, or any sensor whose state names a room now; those on the
        device of a person's device tracker come with that person (`person`), first.
        """
        registry = er.async_get(self._hass)
        owner: dict[str, str] = {}
        for someone in self._hass.states.async_all("person"):
            for tracker in someone.attributes.get("device_trackers", []) or []:
                entry = registry.async_get(tracker) if isinstance(tracker, str) else None
                if entry is not None and entry.device_id:
                    owner.setdefault(entry.device_id, someone.entity_id)
        found: list[dict[str, Any]] = []
        for state in self._hass.states.async_all("sensor"):
            entry = registry.async_get(state.entity_id)
            platform = entry.platform if entry is not None else None
            if platform == DOMAIN and "_located_" not in (entry.unique_id if entry else ""):
                continue
            names_room = self._finder.find(state.state, state.attributes) is not None
            if platform not in ROOM_PLATFORMS and not names_room:
                continue
            item: dict[str, Any] = {"entity": state.entity_id}
            if entry is not None and entry.device_id in owner:
                item["person"] = owner[entry.device_id]
            found.append(item)
        found.sort(key=lambda item: ("person" not in item, item["entity"]))
        per_person: dict[str, int] = {}
        kept: list[dict[str, Any]] = []
        for item in found:
            person = item.get("person")
            if person is not None:
                count = per_person.get(person, 0)
                per_person[person] = count + 1
                if count >= MAX_SUGGESTED:
                    del item["person"]
            kept.append(item)
        return kept[:MAX_CANDIDATES]
