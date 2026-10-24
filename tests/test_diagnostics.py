"""Diagnostics never expose names, entity ids or geometry."""

from __future__ import annotations

import json
from typing import Any

from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.domotwin.data import DATA_KEY
from homeassistant.core import HomeAssistant


async def test_diagnostics_are_counts_only(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    setup_integration: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    data = hass.data[DATA_KEY]
    await data.async_save_plan(plan=demo_plan)
    await data.async_save_bindings(demo_bindings)
    await data.async_save_settings({"north": 37.5})

    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, setup_integration)
    assert diagnostics["revision"] == 3
    assert diagnostics["plan"] == {
        "version": 1,
        "elements": {"rooms": 5, "doors": 4, "windows": 6, "items": 39},
        "views": 2,
        "models": 0,
    }
    assert diagnostics["bindings"] == {"rooms": 5, "elements": 20}
    assert diagnostics["settings"] == ["north"]
    text = json.dumps(diagnostics)
    for private in ("Living room", "light.", "living", "Demo apartment", "37.5"):
        assert private not in text


async def test_odd_plan_fields_are_counted_as_none(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    setup_integration: MockConfigEntry,
    demo_plan: dict[str, Any],
) -> None:
    # The integration checks only a plan's envelope: a field it does not check may be anything.
    await hass.data[DATA_KEY].async_save_plan(plan={**demo_plan, "views": 3, "models": True})
    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, setup_integration)
    assert (diagnostics["plan"]["views"], diagnostics["plan"]["models"]) == (0, 0)
    assert diagnostics["retired_storeys"] == 0
