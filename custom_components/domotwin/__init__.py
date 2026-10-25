"""DomoTwin: your home as a live 3D twin in Home Assistant."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .data import DATA_KEY, LOCATOR_KEY, PEOPLE_KEY
from .frontend import (
    async_register_frontend,
    async_remove_panel,
    async_unregister_frontend,
    async_update_panel,
)
from .http import async_register_views
from .locator import Locator
from .models import async_remove_all
from .services import async_register_services
from .storage import DomoTwinData
from .tracker import PeopleTracker
from .websocket_api import async_register_commands

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
# The upkeep sensor (D-033), the people's rooms (D-034), the Bluetooth devices' rooms and the
# things left behind (D-035).
PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]

type DomoTwinConfigEntry = ConfigEntry[DomoTwinData]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the websocket API, the model views and `domotwin.show`.

    The commands answer `not_loaded` until an entry is set up.
    """
    async_register_commands(hass)
    async_register_views(hass)
    async_register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> bool:
    """Load the stored data, follow the people and their devices, add the frontend and sensors."""
    data = DomoTwinData(hass)
    await data.async_load()
    entry.runtime_data = data
    hass.data[DATA_KEY] = data
    locator = Locator(hass, data, entry.entry_id)
    await locator.async_load()
    hass.data[LOCATOR_KEY] = locator
    people = PeopleTracker(hass, data, locator)
    await people.async_load()
    people.async_start()
    entry.async_on_unload(people.async_stop)
    hass.data[PEOPLE_KEY] = people
    locator.async_start()
    entry.async_on_unload(locator.async_flush)
    entry.async_on_unload(locator.async_stop)
    await async_register_frontend(hass)
    await async_update_panel(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> None:
    await async_update_panel(hass, entry)


async def async_unload_entry(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> bool:
    """Remove the panel, the module and the sensors; keep the stored data."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    async_remove_panel(hass)
    async_unregister_frontend(hass)
    hass.data.pop(DATA_KEY, None)
    hass.data.pop(PEOPLE_KEY, None)
    hass.data.pop(LOCATOR_KEY, None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> None:
    """Delete the stored data, the people's and the locating's settings, the model files."""
    await DomoTwinData(hass).async_remove()
    await PeopleTracker(hass, DomoTwinData(hass)).async_remove()
    await Locator(hass, DomoTwinData(hass), entry.entry_id).async_remove()
    await async_remove_all(hass)
