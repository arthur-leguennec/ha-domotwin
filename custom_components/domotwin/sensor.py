"""DomoTwin's sensors.

- How many upkeep tasks are due (docs/DECISIONS.md, D-033). Its attributes list them, so that users
  can build their own notifications. It changes when the cards or the plans do, and when a new day
  starts where the home is.
- The room each person is in (D-034), one sensor per person placed: the room's name, `not_home`
  away, unknown at home in a room not known. They come and go with the people's settings.
- The room each device followed by Bluetooth is in (D-035): the room's name, unknown when not
  heard. They come and go with the locating's settings.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Final

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.json import json_bytes
from homeassistant.util import dt as dt_util

from . import DomoTwinConfigEntry
from .const import DOMAIN, SIGNAL_LOCATED, SIGNAL_PEOPLE, SIGNAL_UPDATED
from .data import LOCATOR_KEY, PEOPLE_KEY
from .locator import Locator, located_unique_id
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
    locator = hass.data[LOCATOR_KEY]
    follow_located(
        hass,
        entry,
        lambda device, name: LocatedSensor(entry, locator, people, device, name),
        lambda settings: True,
        async_add_entities,
    )


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
        registry = er.async_get(hass)
        for device in [device for device in added if device not in devices]:
            entity = added.pop(device)
            # Its registry entry goes (the entity with it), found by its unique id: disabled, it
            # was never added.
            found = registry.async_get_entity_id(
                entity.entity_id.split(".", 1)[0], DOMAIN, entity.unique_id or ""
            )
            if found is not None:
                registry.async_remove(found)
            elif entity.hass is not None and entity.platform is not None:
                hass.async_create_task(entity.async_remove(force_remove=True))

    follow()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_UPDATED, follow))


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
        self._attr_extra_state_attributes = attributes


class PersonRoomSensor(SensorEntity):
    """The room a person is in: its name, `not_home` away, unknown when not known."""

    _attr_has_entity_name = True
    _attr_translation_key = "person_room"
    _attr_should_poll = False

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
        self._attr_extra_state_attributes = attributes


class LocatedSensor(SensorEntity, LocatedEntity):
    """The room a device followed by Bluetooth is in: its name, unknown when not heard."""

    _attr_has_entity_name = True
    _attr_translation_key = "located"
    _attr_should_poll = False

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
        self._attr_extra_state_attributes = attributes
