"""DomoTwin's sensors.

- How many upkeep tasks are due (docs/DECISIONS.md, D-033). Its attributes list them, so that users
  can build their own notifications. It changes when the cards or the plans do, and when a new day
  starts where the home is.
- The room each person is in (D-034), one sensor per person placed: the room's name, `not_home`
  away, unknown at home in a room not known. They come and go with the people's settings.
- The room each device followed by Bluetooth is in (D-035): the room's name, unknown when not
  heard. They come and go with the locating's settings.
- For each room of the plans, on a device of its own in the room's area so that Home Assistant
  shows them on that area's page (D-061): the people at home in it, and the upkeep due in it. They
  come and go with the rooms.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Final

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_change
from homeassistant.helpers.json import json_bytes
from homeassistant.util import dt as dt_util, slugify

from . import DomoTwinConfigEntry
from .compat import device_of
from .const import DOMAIN, SIGNAL_LOCATED, SIGNAL_PEOPLE, SIGNAL_SEEN, SIGNAL_UPDATED
from .data import LOCATOR_KEY, PEOPLE_KEY
from .locator import Locator, located_unique_id, seen_unique_id
from .overview import people_in, piece_rooms, tasks_by_room
from .people import Room
from .privacy import private_rooms
from .rights import hidden_rooms
from .storage import DomoTwinData
from .tracker import PeopleTracker, name_of
from .upkeep import due_tasks, piece_names

# Tasks listed in the attributes at most (the soonest), and their size at most (bytes of JSON):
# the recorder keeps attributes below 16 KB.
MAX_LISTED: Final = 50
MAX_LISTED_BYTES: Final = 12_000


async def async_setup_entry(
    hass: HomeAssistant,
    entry: DomoTwinConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Add the upkeep sensor, and a room sensor for each person placed (as they come and go)."""
    async_add_entities([UpkeepDueSensor(entry, entry.runtime_data)])
    people = hass.data[PEOPLE_KEY]
    added: dict[str, PersonRoomSensor] = {}

    @callback
    def follow(kind: str = "people", revision: int = 0) -> None:
        if kind != "people":
            return
        wanted = people.config["people"]
        new = [
            PersonRoomSensor(entry, people, person, name_of(hass, person))
            for person in wanted
            if person not in added
        ]
        for sensor in new:
            added[sensor.person] = sensor
        if new:
            async_add_entities(new)
        registry = er.async_get(hass)
        for person in [person for person in added if person not in wanted]:
            sensor = added.pop(person)
            if sensor.registry_entry is not None:
                registry.async_remove(sensor.entity_id)
            else:
                hass.async_create_task(sensor.async_remove(force_remove=True))

    follow()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_UPDATED, follow))
    RoomSensors(hass, entry, people, async_add_entities).start()
    locator = hass.data[LOCATOR_KEY]
    follow_located(
        hass,
        entry,
        lambda device, name: LocatedSensor(entry, locator, people, device, name),
        lambda settings: True,
        async_add_entities,
    )
    follow_seen(hass, entry, locator, async_add_entities)


def follow_seen(
    hass: HomeAssistant,
    entry: DomoTwinConfigEntry,
    locator: Locator,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Add the people seen by the presence radars (D-080) while a radar is on the plans."""
    added: PeopleSeenSensor | None = None

    @callback
    def follow() -> None:
        nonlocal added
        if locator.radar.radars and added is None:
            added = PeopleSeenSensor(hass, entry, locator)
            async_add_entities([added])
        elif not locator.radar.radars and added is not None:
            _remove_entity(hass, added)
            added = None

    follow()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_SEEN, follow))


def follow_located(
    hass: HomeAssistant,
    entry: DomoTwinConfigEntry,
    make: Callable[[str, str], LocatedEntity],
    wanted: Callable[[dict[str, Any]], bool],
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Add an entity for each device followed by Bluetooth that is `wanted`, as they come and go.

    A device renamed gets a new entity under the same registry entry: Home Assistant names an
    entity once. One disabled in Home Assistant was never added: it is only replaced.
    """
    locator = hass.data[LOCATOR_KEY]
    added: dict[str, LocatedEntity] = {}

    async def replace(old: LocatedEntity, new: LocatedEntity) -> None:
        if old.hass is not None and old.platform is not None:
            await old.async_remove()
        async_add_entities([new])

    @callback
    def follow(kind: str = "locating", revision: int = 0) -> None:
        if kind != "locating":
            return
        devices = {d: s for d, s in locator.settings["devices"].items() if wanted(s)}
        new: list[LocatedEntity] = []
        for device, settings in devices.items():
            old = added.get(device)
            if old is not None and old.located_name == settings["name"]:
                continue
            entity = make(device, settings["name"])
            added[device] = entity
            if old is None:
                new.append(entity)
            else:
                hass.async_create_task(replace(old, entity))
        if new:
            async_add_entities(new)
        for device in [device for device in added if device not in devices]:
            _remove_entity(hass, added.pop(device))

    follow()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_UPDATED, follow))


def _remove_entity(hass: HomeAssistant, entity: Entity) -> None:
    """Remove an entity of DomoTwin's.

    Its registry entry goes (the entity with it), found by its unique id: disabled, it was never
    added.
    """
    registry = er.async_get(hass)
    found = registry.async_get_entity_id(
        entity.entity_id.split(".", 1)[0], DOMAIN, entity.unique_id or ""
    )
    if found is not None:
        registry.async_remove(found)
    elif entity.hass is not None and entity.platform is not None:
        hass.async_create_task(entity.async_remove(force_remove=True))


class LocatedEntity(Entity):
    """An entity of a device followed by Bluetooth, named after it."""

    located_name: str


def device_info(entry: DomoTwinConfigEntry) -> DeviceInfo:
    """DomoTwin's own device, every sensor's."""
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="DomoTwin",
        entry_type=DeviceEntryType.SERVICE,
    )


class UpkeepDueSensor(SensorEntity):
    """The number of upkeep tasks due soon or overdue, and the list of them."""

    _attr_has_entity_name = True
    _attr_translation_key = "upkeep_due"
    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, entry: DomoTwinConfigEntry, data: DomoTwinData) -> None:
        """Name it the same in every language: `sensor.domotwin_upkeep_due`."""
        self._data = data
        self._day: date = dt_util.now().date()
        self.entity_id = f"sensor.{DOMAIN}_upkeep_due"
        self._attr_unique_id = f"{entry.entry_id}_upkeep_due"
        self._attr_device_info = device_info(entry)
        self._work_out()

    async def async_added_to_hass(self) -> None:
        """Follow the cards, the plans (the pieces and their names) and the days.

        The day is checked every hour, not at midnight only: where the clocks jump at midnight
        (summer time in some zones), midnight does not happen that day.
        """
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self._updated))
        self.async_on_remove(async_track_time_change(self.hass, self._new_day, minute=0, second=1))

    @callback
    def _updated(self, kind: str, revision: int) -> None:
        if kind in ("upkeep", "plan"):
            self._work_out()
            self.async_write_ha_state()

    @callback
    def _new_day(self, now: datetime) -> None:
        if dt_util.now().date() != self._day:
            self._work_out()
            self.async_write_ha_state()

    def _work_out(self) -> None:
        self._day = dt_util.now().date()
        tasks = due_tasks(self._data.upkeep, piece_names(self._data.storeys), self._day)
        self._attr_native_value = len(tasks)
        self._attr_extra_state_attributes = listed_tasks(tasks)


def listed_tasks(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    """The attributes listing tasks: the soonest (`tasks`), and how many more were left out."""
    listed: list[dict[str, Any]] = []
    size = 0
    for task in tasks[:MAX_LISTED]:
        size += len(json_bytes(task))
        if size > MAX_LISTED_BYTES:
            break
        listed.append(task)
    attributes: dict[str, Any] = {"tasks": listed}
    if len(tasks) > len(listed):
        attributes["more"] = len(tasks) - len(listed)
    return attributes


class PersonRoomSensor(SensorEntity):
    """The room a person is in: its name, `not_home` away, unknown when not known."""

    _attr_has_entity_name = True
    _attr_translation_key = "person_room"
    _attr_should_poll = False
    # Where in the room (D-079): told as it moves, not kept in the history.
    _unrecorded_attributes = frozenset({"x", "y"})

    def __init__(
        self, entry: DomoTwinConfigEntry, people: PeopleTracker, person: str, name: str
    ) -> None:
        """Name it after the person: `person.anna` -> `sensor.domotwin_anna_room`."""
        self.person = person
        self._people = people
        self.entity_id = f"sensor.{DOMAIN}_{person.split('.', 1)[1]}_room"
        self._attr_unique_id = f"{entry.entry_id}_room_{person}"
        self._attr_device_info = device_info(entry)
        self._attr_translation_placeholders = {"person": name}
        self._work_out()

    async def async_added_to_hass(self) -> None:
        """Follow the person (named when added: `person` is set up before DomoTwin)."""
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_PEOPLE, self._moved))

    @callback
    def _moved(self, person: str) -> None:
        if person == self.person:
            self._work_out()
            self.async_write_ha_state()

    def _work_out(self) -> None:
        place = self._people.places.get(self.person)
        attributes: dict[str, Any] = {"person": self.person}
        if place is None or not place.home:
            self._attr_native_value = "not_home"
        elif place.room is None:
            self._attr_native_value = None
        else:
            room = place.room
            self._attr_native_value = room.name
            attributes.update(
                room_id=room.id,
                area_id=room.area,
                storey_id=room.storey,
                storey=room.storey_name,
                since=place.since.isoformat() if place.since else None,
                source=place.source,
            )
            if place.at is not None:
                attributes.update(x=place.at[0], y=place.at[1])
        self._attr_extra_state_attributes = attributes


class LocatedSensor(SensorEntity, LocatedEntity):
    """The room a device followed by Bluetooth is in: its name, unknown when not heard."""

    _attr_has_entity_name = True
    _attr_translation_key = "located"
    _attr_should_poll = False
    # Where in the room (D-079): told as it moves, not kept in the history.
    _unrecorded_attributes = frozenset({"x", "y", "z", "accuracy"})

    def __init__(
        self,
        entry: DomoTwinConfigEntry,
        locator: Locator,
        people: PeopleTracker,
        device: str,
        name: str,
    ) -> None:
        """Name it after the device: `alex_phone` -> `sensor.domotwin_alex_phone_bluetooth`."""
        self.device = device
        self.located_name = name
        self._locator = locator
        self._people = people
        self.entity_id = f"sensor.{DOMAIN}_{device}_bluetooth"
        self._attr_unique_id = located_unique_id(entry.entry_id, device)
        self._attr_device_info = device_info(entry)
        self._attr_translation_placeholders = {"name": name}
        self._work_out()

    async def async_added_to_hass(self) -> None:
        """Follow the device."""
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_LOCATED, self._moved))

    @callback
    def _moved(self, device: str) -> None:
        if device == self.device:
            self._work_out()
            self.async_write_ha_state()

    def _work_out(self) -> None:
        settings = self._locator.settings["devices"].get(self.device, {})
        located = self._locator.located.get(self.device)
        room = self._people.finder.room(located.room) if located and located.room else None
        attributes: dict[str, Any] = {
            "device_name": self.located_name,
            "kind": settings.get("kind"),
            "person": settings.get("person"),
            "left_behind": bool(located and located.left_behind),
        }
        if room is None or located is None:
            self._attr_native_value = None
        else:
            self._attr_native_value = room.name
            attributes.update(
                room_id=room.id,
                area_id=room.area,
                storey_id=room.storey,
                storey=room.storey_name,
                since=located.since.isoformat() if located.since else None,
            )
            if located.spot is not None:
                # Where in the room (D-079): on its storey's plan and how high, in metres, and
                # how far around it the device may be.
                x, y, z, spread = located.spot
                attributes.update(
                    x=round(x / 100, 2),
                    y=round(y / 100, 2),
                    z=round(z / 100, 2),
                    accuracy=round(spread / 100, 1),
                )
        self._attr_extra_state_attributes = attributes


class PeopleSeenSensor(SensorEntity):
    """How many people the presence radars see (D-080), and where those no device names are.

    Nothing of a room closed to everyone (D-039, D-071): an entity is everyone's, as the rooms' own
    sensors say nothing of who is in one.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "people_seen"
    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT
    # Where they are: told as they move, not kept in the history.
    _unrecorded_attributes = frozenset({"seen"})

    def __init__(self, hass: HomeAssistant, entry: DomoTwinConfigEntry, locator: Locator) -> None:
        """One for the home: `sensor.domotwin_people_seen`."""
        self._locator = locator
        self._closed = ClosedRooms(hass, entry.runtime_data, self._changed)
        self._closed.work_out()
        self.entity_id = f"sensor.{DOMAIN}_people_seen"
        self._attr_unique_id = seen_unique_id(entry.entry_id)
        self._attr_device_info = device_info(entry)
        self._work_out()

    async def async_added_to_hass(self) -> None:
        """Follow what the radars see, and the rooms closed to everyone."""
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_SEEN, self._changed))
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self._saved))
        self.async_on_remove(self._closed.stop)
        self._closed.watch()
        self._work_out()

    @callback
    def _changed(self) -> None:
        self._work_out()
        self.async_write_ha_state()

    @callback
    def _saved(self, kind: str, revision: int) -> None:
        if kind == "settings":
            self._closed.watch()
            self._changed()

    def _work_out(self) -> None:
        home = self._locator.home
        closed = self._closed.rooms
        targets = [t for t in self._locator.radar.sight.targets if t.room not in closed]
        self._attr_native_value = len(targets)
        # Those no device names: on their storey's plan, in metres, numbered as they are followed.
        self._attr_extra_state_attributes = {
            "seen": [
                {
                    "id": n,
                    "room_id": target.room,
                    "storey_id": home.storey_ids[target.storey],
                    "x": round(target.x / 100, 2),
                    "y": round(target.y / 100, 2),
                }
                for n, target in sorted(self._locator.radar.seen.items())
                if target.room not in closed and target.storey < len(home.storey_ids)
            ]
        }


class ClosedRooms:
    """The rooms closed now to everyone (an entity is everyone's), followed as they open and close.

    Private, as D-039 locks them, or hidden from everyone by the rights (D-071). `changed` is told
    when an entity that opens or closes one changed them.
    """

    def __init__(
        self, hass: HomeAssistant, data: DomoTwinData, changed: Callable[[], None]
    ) -> None:
        """Nothing is followed before `watch`."""
        self._hass = hass
        self._data = data
        self._changed = changed
        self.rooms: set[str] = set()
        self._unwatch: Callable[[], None] | None = None

    def work_out(self) -> None:
        """Work the rooms closed now out."""
        settings = self._data.settings
        rules: dict[str, Any] = settings.get("rooms", {})
        self.rooms = private_rooms(rules, self._hass.states.get, None) | hidden_rooms(
            self._hass, settings, None
        )

    def watch(self) -> None:
        """Work them out, and follow the entities that open or close them."""
        self.work_out()
        self.stop()
        rules: dict[str, Any] = self._data.settings.get("rooms", {})
        watched = sorted({rule["while"] for rule in rules.values() if "while" in rule})
        if watched:
            self._unwatch = async_track_state_change_event(self._hass, watched, self._while_changed)

    @callback
    def stop(self) -> None:
        """Follow nothing more."""
        if self._unwatch is not None:
            self._unwatch()
            self._unwatch = None

    @callback
    def _while_changed(self, event: Event[EventStateChangedData]) -> None:
        before = self.rooms
        self.work_out()
        if self.rooms != before:
            self._changed()


class RoomSensors:
    """Two sensors for each room of the plans, on a device of the room's own (D-061).

    The device is put in the room's area (the one it reads, docs/bindings.md) when it is made, or
    later when it has none, and follows the room when it is given another, as soon as that area
    exists; one moved by hand elsewhere stays there until then. What the rooms hold is worked out
    once for them all when something changes. The rooms are the people tracker's, which follows
    the plans, the bindings and the areas before these sensors do.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        entry: DomoTwinConfigEntry,
        people: PeopleTracker,
        async_add_entities: AddEntitiesCallback,
    ) -> None:
        """Nothing is added before `start`."""
        self._hass = hass
        self._entry = entry
        self._data = entry.runtime_data
        self.people = people
        self._add = async_add_entities
        self._added: dict[str, tuple[RoomPeopleSensor, RoomUpkeepSensor]] = {}
        # The area each room's device was last put in or found in, to follow a change of the room's.
        self._placed: dict[str, str | None] = {}
        # Rooms whose device does not exist yet: put in the room's area once their sensors make it.
        self._fresh: set[str] = set()
        self._day: date = dt_util.now().date()
        # Each piece's room, worked out again only when the plans change.
        self._pieces: dict[str, str] = {}
        self.tasks: dict[str, list[dict[str, Any]]] = {}
        self._closed = ClosedRooms(hass, self._data, lambda: self._write(people=True))

    @property
    def private(self) -> set[str]:
        """The rooms closed now to everyone."""
        return self._closed.rooms

    def start(self) -> None:
        """Add the rooms' sensors; follow the rooms, areas, people, cards and days."""
        entry = self._entry
        self._pieces = piece_rooms(self._data.storeys)
        self._work_out_tasks()
        self._closed.watch()
        self._sync()
        entry.async_on_unload(async_dispatcher_connect(self._hass, SIGNAL_UPDATED, self._saved))
        entry.async_on_unload(async_dispatcher_connect(self._hass, SIGNAL_PEOPLE, self._moved))
        entry.async_on_unload(
            self._hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, self._areas_changed)
        )
        entry.async_on_unload(
            async_track_time_change(self._hass, self._new_day, minute=0, second=2)
        )
        entry.async_on_unload(self._closed.stop)

    @callback
    def _saved(self, kind: str, revision: int) -> None:
        if kind in ("plan", "bindings"):
            # The pieces' rooms follow the plans only; the bindings change the rooms' areas.
            if kind == "plan":
                self._pieces = piece_rooms(self._data.storeys)
                self._work_out_tasks()
            self._sync()
            self._write(people=True, upkeep=True)
        elif kind == "upkeep":
            self._work_out_tasks()
            self._write(upkeep=True)
        elif kind == "settings":
            self._closed.watch()
            self._write(people=True)
        elif kind == "people":
            # Someone no longer placed, or hidden: nothing else tells.
            self._write(people=True)

    @callback
    def _areas_changed(self, event: Event[Any]) -> None:
        self._sync()
        self._write(people=True, upkeep=True)

    @callback
    def _moved(self, person: str) -> None:
        self._write(people=True, changed_only=True)

    @callback
    def _new_day(self, now: datetime) -> None:
        if dt_util.now().date() != self._day:
            self._work_out_tasks()
            self._write(upkeep=True)

    def _work_out_tasks(self) -> None:
        self._day = dt_util.now().date()
        tasks = due_tasks(self._data.upkeep, piece_names(self._data.storeys), self._day)
        self.tasks = tasks_by_room(tasks, self._pieces)

    def _write(
        self, *, people: bool = False, upkeep: bool = False, changed_only: bool = False
    ) -> None:
        for people_sensor, upkeep_sensor in self._added.values():
            if people and people_sensor.hass is not None:
                people_sensor.refresh(changed_only=changed_only)
            if upkeep and upkeep_sensor.hass is not None:
                upkeep_sensor.refresh(changed_only=changed_only)

    @callback
    def _sync(self) -> None:
        """Add the sensors of new rooms, remove those of rooms gone, follow names and areas."""
        rooms = {room.id: room for room in self.people.finder.rooms}
        areas = ar.async_get(self._hass)
        new: list[SensorEntity] = []
        for room in rooms.values():
            area = areas.async_get_area(room.area) if room.area else None
            if room.id not in self._added:
                sensors = (
                    RoomPeopleSensor(self, room, area.name if area else None),
                    RoomUpkeepSensor(self, room, area.name if area else None),
                )
                self._added[room.id] = sensors
                new.extend(sensors)
                if self._device(room.id) is None:
                    self._fresh.add(room.id)
            else:
                for sensor in self._added[room.id]:
                    sensor.room = room
            # A device kept from before (a restart) is followed as well as one made now.
            self._follow_device(room, area)
        if new:
            self._add(new)
        for room_id in [room_id for room_id in self._added if room_id not in rooms]:
            self._remove(room_id)

    def _device(self, room_id: str) -> dr.DeviceEntry | None:
        return device_of(
            dr.async_get(self._hass),
            (DOMAIN, room_device_id(self._entry, room_id)),
            self._entry.entry_id,
        )

    @callback
    def device_made(self, room: Room) -> None:
        """A room's sensors were added: a device made (or brought back) now goes to its area."""
        if room.id in self._fresh:
            area = ar.async_get(self._hass).async_get_area(room.area) if room.area else None
            self._follow_device(room, area)

    def _follow_device(self, room: Room, area: ar.AreaEntry | None) -> None:
        """A room renamed renames its device; given another area, its device moves there.

        A device made now, or in no area, goes to its room's. One found in place (after a restart)
        is left where it is, as it may have been moved by hand. An area that does not exist (yet,
        or any more) moves nothing: the device goes to it once it is made.
        """
        device = self._device(room.id)
        if device is None:
            return
        fresh = room.id in self._fresh
        self._fresh.discard(room.id)
        changes: dict[str, Any] = {}
        if device.name != room_device_name(room):
            changes["name"] = room_device_name(room)
        if area is not None:
            given_another = room.id in self._placed and self._placed[room.id] != area.id
            if device.area_id != area.id and (fresh or device.area_id is None or given_another):
                changes["area_id"] = area.id
            self._placed[room.id] = area.id
        else:
            self._placed.setdefault(room.id, device.area_id)
        if changes:
            dr.async_get(self._hass).async_update_device(device.id, **changes)

    def _remove(self, room_id: str) -> None:
        """A room gone: its sensors and its device go."""
        registry = er.async_get(self._hass)
        for sensor in self._added.pop(room_id):
            found = registry.async_get_entity_id("sensor", DOMAIN, sensor.unique_id or "")
            if found is not None:
                registry.async_remove(found)
            elif sensor.hass is not None and sensor.platform is not None:
                self._hass.async_create_task(sensor.async_remove(force_remove=True))
        self._placed.pop(room_id, None)
        self._fresh.discard(room_id)
        device = self._device(room_id)
        if device is not None:
            dr.async_get(self._hass).async_remove_device(device.id)


def room_device_id(entry: DomoTwinConfigEntry, room: str) -> str:
    """The identifier of a room's device."""
    return f"{entry.entry_id}_room_{room}"


def room_device_name(room: Room) -> str:
    """A room's device, named after it: "DomoTwin · Living room"."""
    return f"DomoTwin · {room.name}"


class RoomSensor(SensorEntity):
    """A sensor of a room, on the room's own device."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT
    _what: str

    def __init__(self, rooms: RoomSensors, room: Room, area: str | None) -> None:
        """Name it after the room: `living` -> `sensor.domotwin_living_<what>`."""
        entry = rooms._entry  # noqa: SLF001 (made by it)
        self._rooms = rooms
        self.room = room
        self.entity_id = f"sensor.{DOMAIN}_{slugify(room.id)}_{self._what}"
        self._attr_unique_id = f"{entry.entry_id}_room_{room.id}_{self._what}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, room_device_id(entry, room.id))},
            name=room_device_name(room),
            entry_type=DeviceEntryType.SERVICE,
            suggested_area=area,
        )
        self._work_out()

    async def async_added_to_hass(self) -> None:
        """Its device exists now: put it in the room's area if it was just made."""
        await super().async_added_to_hass()
        self._rooms.device_made(self.room)

    @callback
    def refresh(self, *, changed_only: bool = False) -> None:
        """Work it out again and tell Home Assistant (`changed_only`: if it changed)."""
        before = (self._attr_native_value, self._attr_extra_state_attributes)
        self._work_out()
        if changed_only and (self._attr_native_value, self._attr_extra_state_attributes) == before:
            return
        self.async_write_ha_state()

    def _work_out(self) -> None:
        raise NotImplementedError

    def _room_attributes(self) -> dict[str, Any]:
        return {
            "room": self.room.name,
            "room_id": self.room.id,
            "area_id": self.room.area,
            "storey_id": self.room.storey,
            "storey": self.room.storey_name,
        }


class RoomPeopleSensor(RoomSensor):
    """How many people are at home in a room, and who; unknown while the room is private."""

    _attr_translation_key = "room_people"
    _what = "people"

    def _work_out(self) -> None:
        attributes = self._room_attributes()
        if self.room.id in self._rooms.private:
            # D-039: a private room says nothing of who is in it, here as in DomoTwin's views.
            self._attr_native_value = None
            attributes["private"] = True
        else:
            # Those who hid themselves (D-034) are not shown on the area pages either.
            hidden = set(self._rooms.people.config["hidden"])
            people = [
                person
                for person in people_in(self._rooms.people.places, self.room.id)
                if person not in hidden
            ]
            self._attr_native_value = len(people)
            attributes["people"] = people
        self._attr_extra_state_attributes = attributes


class RoomUpkeepSensor(RoomSensor):
    """How many upkeep tasks are due soon or overdue in a room, and the soonest of them."""

    _attr_translation_key = "room_upkeep"
    _what = "upkeep_due"

    def _work_out(self) -> None:
        tasks = self._rooms.tasks.get(self.room.id, [])
        self._attr_native_value = len(tasks)
        self._attr_extra_state_attributes = {**self._room_attributes(), **listed_tasks(tasks)}
