"""DomoTwin: your home as a live 3D twin in Home Assistant."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .data import DATA_KEY
from .frontend import (
    async_register_frontend,
    async_remove_panel,
    async_unregister_frontend,
    async_update_panel,
)
from .storage import DomoTwinData
from .websocket_api import async_register_commands

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type DomoTwinConfigEntry = ConfigEntry[DomoTwinData]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the websocket API (it answers `not_loaded` until an entry is set up)."""
    async_register_commands(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> bool:
    """Load the stored data and register the frontend."""
    data = DomoTwinData(hass)
    await data.async_load()
    entry.runtime_data = data
    hass.data[DATA_KEY] = data
    await async_register_frontend(hass)
    await async_update_panel(hass, entry)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> None:
    await async_update_panel(hass, entry)


async def async_unload_entry(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> bool:
    """Remove the panel and the module; keep the stored data."""
    async_remove_panel(hass)
    async_unregister_frontend(hass)
    hass.data.pop(DATA_KEY, None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: DomoTwinConfigEntry) -> None:
    """Delete the stored plan, overlay and bindings when the integration is removed."""
    await DomoTwinData(hass).async_remove()
