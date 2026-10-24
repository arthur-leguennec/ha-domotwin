"""Persistence and migrations of .storage/domotwin.data."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.domotwin.const import STORAGE_KEY, STORAGE_MINOR_VERSION, STORAGE_VERSION
from custom_components.domotwin.data import DATA_KEY
from custom_components.domotwin.storage import DomoTwinData
from homeassistant.core import HomeAssistant

from .conftest import one_room_plan


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
            "layout": {"sofa": {"at": [1, 1]}},
            "bindings": {"version": 1, "rooms": {}, "elements": {}},
            "settings": {},
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    data = hass.data[DATA_KEY]
    assert data.revision == 7
    assert data.plan == demo_plan
    assert data.layout == {"sofa": {"at": [1, 1]}}
    # Data stored before per-kind revisions: each kind starts at the stored revision.
    assert [data.revision_of(kind) for kind in ("plan", "bindings", "settings")] == [7, 7, 7]
    await data.async_save_settings({"north": 5})
    assert (data.revision, data.revision_of("plan"), data.revision_of("settings")) == (8, 7, 8)


async def test_saves_are_written(
    hass: HomeAssistant, hass_storage: dict[str, Any], demo_plan: dict[str, Any]
) -> None:
    data = DomoTwinData(hass)
    await data.async_load()
    assert await data.async_save_plan(plan=demo_plan) == 1
    stored = hass_storage[STORAGE_KEY]
    assert stored["version"] == STORAGE_VERSION
    assert stored["minor_version"] == STORAGE_MINOR_VERSION
    assert stored["data"]["storeys"] == [
        {"id": "storey-1", "name": "", "elevation": 0, "plan": demo_plan, "layout": {}}
    ]
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


async def test_the_single_plan_of_version_1_1_becomes_the_first_storey(
    hass: HomeAssistant, hass_storage: dict[str, Any], demo_plan: dict[str, Any]
) -> None:
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": STORAGE_KEY,
        "data": {"revision": 3, "plan": demo_plan, "layout": {"sofa": {"at": [1, 1]}}},
    }
    data = DomoTwinData(hass)
    await data.async_load()
    assert [storey["id"] for storey in data.storeys] == ["storey-1"]
    assert data.plan == demo_plan
    assert data.layout == {"sofa": {"at": [1, 1]}}
    assert "plan" not in data.snapshot()
    # Data from before DomoTwin's plan format moves its revision on.
    assert data.revision == 4
    # Without a plan, no storey.
    hass_storage[STORAGE_KEY]["data"] = {"revision": 1, "plan": None, "layout": {}}
    empty = DomoTwinData(hass)
    await empty.async_load()
    assert empty.storeys == []
    assert empty.plan is None


async def test_plans_in_an_older_format_are_set_aside(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    demo_plan: dict[str, Any],
    caplog: pytest.LogCaptureFixture,
) -> None:
    older = {"version": 1, "elements": [{"id": "hall", "type": "room"}]}
    storeys = [
        {"id": "storey-1", "name": "", "elevation": 0, "plan": demo_plan, "layout": {}},
        {"id": "storey-2", "name": "Up", "elevation": 280, "plan": older, "layout": {"a": {}}},
        {"id": "storey-3", "name": "", "elevation": 560, "plan": None, "layout": {}},
    ]

    def stored(version: int) -> dict[str, Any]:
        return {
            "version": version,
            "minor_version": 1,
            "key": STORAGE_KEY,
            "data": {"revision": 5, "storeys": copy.deepcopy(storeys)},
        }

    hass_storage[STORAGE_KEY] = stored(2)
    data = DomoTwinData(hass)
    await data.async_load()
    assert [storey["id"] for storey in data.storeys] == ["storey-1"]
    assert data.plan == demo_plan
    # Kept in the stored data, not shown; an empty storey goes.
    assert [storey["id"] for storey in data.retired] == ["storey-2"]
    assert data.retired[0]["layout"] == {"a": {}}
    # The revision moves on: drafts kept for the old plans are not offered again.
    assert data.revision == 6
    assert data.revision_of("plan") == 6
    warnings = [r.getMessage() for r in caplog.records if r.name.startswith("custom_components")]
    assert len(warnings) == 1
    assert "1 stored plan(s) were not in DomoTwin's plan format" in warnings[0]
    assert "Up" not in warnings[0]
    # Data of this version is read as it is.
    hass_storage[STORAGE_KEY] = stored(STORAGE_VERSION)
    current = DomoTwinData(hass)
    await current.async_load()
    assert len(current.storeys) == 3


async def test_storeys_are_added_changed_ordered_and_removed(
    hass: HomeAssistant, demo_plan: dict[str, Any]
) -> None:
    data = DomoTwinData(hass)
    await data.async_load()
    await data.async_save_plan(plan=demo_plan)
    upper = one_room_plan("attic", "Attic")
    revision, storey = await data.async_save_storey(name="First floor", elevation=280, plan=upper)
    assert storey == "storey-2"
    cellar = one_room_plan("cellar", "Cellar")
    _, below = await data.async_save_storey(name="Cellar", elevation=-250, plan=cellar)
    # Lowest first; the default storey is the ground floor, not the cellar.
    assert [s["id"] for s in data.storeys] == [below, "storey-1", "storey-2"]
    ground = data.storey()
    assert ground is not None
    assert ground["id"] == "storey-1"
    assert data.plan == demo_plan
    await data.async_save_storey(storey="storey-2", name="Attic", expected_revision=revision + 1)
    attic = data.storey("storey-2")
    assert attic is not None
    assert attic["name"] == "Attic"
    await data.async_save_plan(storey="storey-2", layout={"x": {"rotation": 15}})
    attic = data.storey("storey-2")
    assert attic is not None
    assert attic["layout"] == {"x": {"rotation": 15}}
    await data.async_remove_storey(below)
    assert [s["id"] for s in data.storeys] == ["storey-1", "storey-2"]
    # A plan None removes its storey.
    await data.async_save_plan(storey="storey-2", plan=None)
    assert [s["id"] for s in data.storeys] == ["storey-1"]
