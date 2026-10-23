"""Persistence and migrations of .storage/domotwin.data."""

from __future__ import annotations

from typing import Any

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.domotwin.const import STORAGE_KEY, STORAGE_MINOR_VERSION, STORAGE_VERSION
from custom_components.domotwin.data import DATA_KEY
from custom_components.domotwin.storage import DomoTwinData
from homeassistant.core import HomeAssistant


async def test_data_survives_a_restart(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
) -> None:
    hass_storage[STORAGE_KEY] = {
        "version": STORAGE_VERSION,
        "minor_version": STORAGE_MINOR_VERSION,
        "key": STORAGE_KEY,
        "data": {
            "revision": 7,
            "plan": demo_plan,
            "layout": {"sofa": {"x": 1}},
            "bindings": {"version": 1, "rooms": {}, "elements": {}},
            "settings": {},
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    data = hass.data[DATA_KEY]
    assert data.revision == 7
    assert data.plan == demo_plan
    assert data.layout == {"sofa": {"x": 1}}


async def test_saves_are_written(
    hass: HomeAssistant, hass_storage: dict[str, Any], demo_plan: dict[str, Any]
) -> None:
    data = DomoTwinData(hass)
    await data.async_load()
    assert await data.async_save_plan(plan=demo_plan) == 1
    stored = hass_storage[STORAGE_KEY]
    assert stored["version"] == STORAGE_VERSION
    assert stored["minor_version"] == STORAGE_MINOR_VERSION
    assert stored["data"]["plan"] == demo_plan
    assert stored["data"]["revision"] == 1


async def test_unknown_keys_and_missing_keys_are_normalised(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    hass_storage[STORAGE_KEY] = {
        "version": STORAGE_VERSION,
        "minor_version": STORAGE_MINOR_VERSION,
        "key": STORAGE_KEY,
        "data": {"revision": 2, "something": "else"},
    }
    data = DomoTwinData(hass)
    await data.async_load()
    snapshot = data.snapshot()
    assert snapshot["revision"] == 2
    assert "something" not in snapshot
    assert snapshot["bindings"] == {"version": 1, "rooms": {}, "elements": {}}


async def test_older_minor_version_is_migrated(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    hass_storage[STORAGE_KEY] = {
        "version": STORAGE_VERSION,
        "minor_version": 0,
        "key": STORAGE_KEY,
        "data": {"revision": 4, "plan": None, "obsolete": True},
    }
    data = DomoTwinData(hass)
    await data.async_load()
    assert data.revision == 4
    assert "obsolete" not in data.snapshot()


async def test_removing_the_integration_deletes_the_data(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    setup_integration: MockConfigEntry,
    demo_plan: dict[str, Any],
) -> None:
    await hass.data[DATA_KEY].async_save_plan(plan=demo_plan)
    assert STORAGE_KEY in hass_storage
    assert await hass.config_entries.async_remove(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert STORAGE_KEY not in hass_storage
