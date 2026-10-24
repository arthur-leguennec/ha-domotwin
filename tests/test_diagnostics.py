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
    assert diagnostics["plan"]["elements"] == {
        "room": 5,
        "door": 4,
        "window": 6,
        "furniture": 39,
    }
    assert diagnostics["bindings"] == {"rooms": 5, "elements": 20}
    assert diagnostics["settings"] == ["north"]
    text = json.dumps(diagnostics)
    for private in ("Living room", "light.", "living", "Demo apartment", "37.5"):
        assert private not in text
