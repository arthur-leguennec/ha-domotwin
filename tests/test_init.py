"""Setup, frontend registration and unload."""

from __future__ import annotations

from http import HTTPStatus
from pathlib import Path

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.domotwin.const import VERSION
from custom_components.domotwin.frontend import MODULE_URL
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant


def state(entry: ConfigEntry) -> ConfigEntryState:
    """Read the state afresh (it changes behind mypy's back)."""
    return entry.state


async def test_setup_registers_the_frontend(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_client: ClientSessionGenerator,
) -> None:
    assert state(setup_integration) is ConfigEntryState.LOADED
    assert MODULE_URL in hass.data[DATA_EXTRA_MODULE_URL].urls
    assert MODULE_URL.endswith(f"?v={VERSION}")

    panel = hass.data["frontend_panels"]["domotwin"]
    assert panel.sidebar_title == "DomoTwin"
    assert panel.config["_panel_custom"]["name"] == "domotwin-panel"
    assert panel.config["_panel_custom"]["module_url"] == MODULE_URL
    assert panel.require_admin is False

    client = await hass_client()
    response = await client.get("/domotwin_static/domotwin.js")
    assert response.status == HTTPStatus.OK


async def test_unload_and_reload(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert state(setup_integration) is ConfigEntryState.NOT_LOADED
    assert MODULE_URL not in hass.data[DATA_EXTRA_MODULE_URL].urls
    assert "domotwin" not in hass.data["frontend_panels"]

    # The static route survives the unload: setting up again must not register it twice.
    assert await hass.config_entries.async_setup(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert state(setup_integration) is ConfigEntryState.LOADED
    assert "domotwin" in hass.data["frontend_panels"]


async def test_missing_frontend_is_logged(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    frontend_built: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    (frontend_built / "domotwin.js").unlink()
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    assert "frontend is missing" in caplog.text
