"""Config and options flows."""

from __future__ import annotations

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.domotwin.const import CONF_SIDEBAR, CONF_SIDEBAR_ADMIN_ONLY, DOMAIN
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType


async def test_user_flow_creates_an_entry(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "DomoTwin"
    assert result["data"] == {}
    assert result["options"] == {CONF_SIDEBAR: True, CONF_SIDEBAR_ADMIN_ONLY: False}


async def test_only_one_entry(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


async def test_options_flow_hides_the_panel(
    hass: HomeAssistant, setup_integration: MockConfigEntry
) -> None:
    assert "domotwin" in hass.data["frontend_panels"]
    result = await hass.config_entries.options.async_init(setup_integration.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SIDEBAR: False, CONF_SIDEBAR_ADMIN_ONLY: False}
    )
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert "domotwin" not in hass.data["frontend_panels"]


async def test_options_flow_admin_only_panel(
    hass: HomeAssistant, setup_integration: MockConfigEntry
) -> None:
    result = await hass.config_entries.options.async_init(setup_integration.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SIDEBAR: True, CONF_SIDEBAR_ADMIN_ONLY: True}
    )
    await hass.async_block_till_done()
    assert hass.data["frontend_panels"]["domotwin"].require_admin is True
