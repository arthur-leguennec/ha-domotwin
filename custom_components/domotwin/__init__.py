"""DomoTwin: your home as a live 3D twin in Home Assistant."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.typing import ConfigType

from .choices import Choices
from .const import DOMAIN, SIGNAL_SCHEDULES
from .data import CHOICES_KEY, DATA_KEY, LOCATOR_KEY, PEOPLE_KEY, SCHEDULER_KEY
from .frontend import (
    async_register_frontend,
    async_remove_panel,
    async_unregister_frontend,
    async_update_panel,
)
from .http import async_register_views
from .locator import Locator
from .models import async_remove_all
from .schedules import Scheduler
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
    # The actions done later (D-046).
    scheduler = Scheduler(hass)
    await scheduler.async_load()

    @callback
    def start_scheduler(_hass: HomeAssistant) -> None:
        scheduler.async_start()

    # Once every integration is set up, so that the steps missed find their devices.
    entry.async_on_unload(async_at_started(hass, start_scheduler))

    @callback
    def drop_scheduler() -> None:
        # Stopped and forgotten, even when setting up failed further on; the sheets are told.
        scheduler.async_stop()
        if hass.data.get(SCHEDULER_KEY) is scheduler:
            hass.data.pop(SCHEDULER_KEY)
        async_dispatcher_send(hass, SIGNAL_SCHEDULES)

    entry.async_on_unload(drop_scheduler)
    hass.data[SCHEDULER_KEY] = scheduler
    async_dispatcher_send(hass, SIGNAL_SCHEDULES)
    # Each user's own choices (D-055).
    choices = Choices(hass)
    await choices.async_load()

    @callback
    def drop_choices() -> None:
        if hass.data.get(CHOICES_KEY) is choices:
            hass.data.pop(CHOICES_KEY)

    entry.async_on_unload(drop_choices)
    hass.data[CHOICES_KEY] = choices
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
    """Delete everything DomoTwin keeps: data, settings, actions waiting, choices, model files."""
    await DomoTwinData(hass).async_remove()
    await Scheduler(hass).async_remove()
    await Choices(hass).async_remove()
    await PeopleTracker(hass, DomoTwinData(hass)).async_remove()
    await Locator(hass, DomoTwinData(hass), entry.entry_id).async_remove()
    await async_remove_all(hass)
