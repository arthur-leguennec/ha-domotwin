"""DomoTwin's binary sensors: the things left behind (docs/DECISIONS.md, D-035).

One for each device followed by Bluetooth that has an owner: on while the device is heard at home
and its owner has been away for two minutes (keys, a watch, a bag left at home).
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import DomoTwinConfigEntry
from .const import DOMAIN, SIGNAL_LOCATED
from .data import LOCATOR_KEY, PEOPLE_KEY
from .locator import Locator
from .sensor import LocatedEntity, device_info, follow_located
from .tracker import PeopleTracker


async def async_setup_entry(
    hass: HomeAssistant,
    entry: DomoTwinConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Add a sensor for each followed device with an owner, as they come and go."""
    locator = hass.data[LOCATOR_KEY]
    people = hass.data[PEOPLE_KEY]
    follow_located(
        hass,
        entry,
        lambda device, name: LeftBehindSensor(entry, locator, people, device, name),
        lambda settings: settings.get("person") is not None,
        async_add_entities,
    )


class LeftBehindSensor(BinarySensorEntity, LocatedEntity):
    """On while a device is heard at home and its owner is away."""

    _attr_has_entity_name = True
    _attr_translation_key = "left_behind"
    _attr_should_poll = False

    def __init__(
        self,
        entry: DomoTwinConfigEntry,
        locator: Locator,
        people: PeopleTracker,
        device: str,
        name: str,
    ) -> None:
        """Name it after the device: `keys` -> `binary_sensor.domotwin_keys_left_behind`."""
        self.device = device
        self.located_name = name
        self._locator = locator
        self._people = people
        self.entity_id = f"binary_sensor.{DOMAIN}_{device}_left_behind"
        self._attr_unique_id = f"{entry.entry_id}_left_behind_{device}"
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
        self._attr_is_on = located is not None and located.left_behind
        attributes: dict[str, Any] = {"person": settings.get("person")}
        room = self._people.finder.room(located.room) if located and located.room else None
        if room is not None:
            attributes.update(room_id=room.id, room=room.name)
        self._attr_extra_state_attributes = attributes
