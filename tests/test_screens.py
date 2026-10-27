"""The wall screens (D-076): each one's layout, by its name, kept by the integration."""

from __future__ import annotations

from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator, WebSocketGenerator

from custom_components.domotwin.const import MAX_SCREENS, SCREENS_STORAGE_KEY
from homeassistant.core import HomeAssistant

KITCHEN = {
    "start": "home",
    "saver": {
        "after": 5,
        "wake": ["binary_sensor.kitchen_motion", "binary_sensor.kitchen_motion"],
        "photos": "media-source://media_source/local/holidays",
        "every": 20,
    },
}


async def _send(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


async def test_screens_are_set_by_administrators_and_read_by_everyone(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    hass_storage: dict[str, Any],
) -> None:
    admin = await hass_ws_client(hass)
    watcher = await hass_ws_client(hass)
    await _send(watcher, {"type": "domotwin/subscribe"})
    assert (await _send(admin, {"type": "domotwin/screens/get"}))["result"] == {"screens": {}}
    answer = await _send(
        admin, {"type": "domotwin/screens/save", "name": "kitchen", "layout": KITCHEN}
    )
    # What is not said is the default; each sensor once.
    assert answer["result"]["screens"] == {
        "kitchen": {
            "start": "home",
            "saver": {
                "after": 5,
                "wake": ["binary_sensor.kitchen_motion"],
                "weather": True,
                "photos": "media-source://media_source/local/holidays",
                "every": 20,
                "dim": True,
            },
        }
    }
    # The screens are told it changed.
    told = await watcher.receive_json()
    assert told["event"]["kind"] == "screens"
    # Everyone reads them; only administrators change them.
    user = await hass_ws_client(hass, hass_read_only_access_token)
    assert "kitchen" in (await _send(user, {"type": "domotwin/screens/get"}))["result"]["screens"]
    refused = await _send(user, {"type": "domotwin/screens/save", "name": "hall", "layout": {}})
    assert refused["error"]["code"] == "unauthorized"
    refused = await _send(user, {"type": "domotwin/screens/remove", "name": "kitchen"})
    assert refused["error"]["code"] == "unauthorized"
    # Another screen; the kitchen's changed, named whatever the case, kept as first spelled.
    await _send(admin, {"type": "domotwin/screens/save", "name": "hall", "layout": {}, "new": True})
    answer = await _send(
        admin,
        {"type": "domotwin/screens/save", "name": "KITCHEN", "layout": {"saver": {"after": 0}}},
    )
    screens = answer["result"]["screens"]
    assert list(screens) == ["hall", "kitchen"]
    assert screens["kitchen"] == {
        "saver": {"after": 0, "wake": [], "weather": True, "every": 30, "dim": True}
    }
    # A new screen under a name taken: refused, whatever the case.
    answer = await _send(
        admin, {"type": "domotwin/screens/save", "name": "HALL", "layout": {}, "new": True}
    )
    assert answer["error"]["code"] == "screen_exists"
    answer = await _send(admin, {"type": "domotwin/screens/remove", "name": " Kitchen "})
    assert list(answer["result"]["screens"]) == ["hall"]
    # Removing one that is not there changes nothing.
    answer = await _send(admin, {"type": "domotwin/screens/remove", "name": "attic"})
    assert list(answer["result"]["screens"]) == ["hall"]
    await hass.async_block_till_done()
    assert list(hass_storage[SCREENS_STORAGE_KEY]["data"]["screens"]) == ["hall"]


@pytest.mark.parametrize(
    ("name", "layout"),
    [
        ("the kitchen", {}),
        ("", {}),
        ("kitchen", {"start": "garden"}),
        ("kitchen", {"saver": {"after": -1}}),
        ("kitchen", {"saver": {"after": 241}}),
        ("kitchen", {"saver": {"wake": ["light.kitchen"]}}),
        ("kitchen", {"saver": {"wake": [f"binary_sensor.m{n}" for n in range(11)]}}),
        ("kitchen", {"saver": {"photos": "/media/local/holidays"}}),
        ("kitchen", {"saver": {"photos": "media-source://" + "a" * 600}}),
        ("kitchen", {"saver": {"every": 2}}),
        ("kitchen", {"saver": {"after": True}}),
        ("kitchen", {"saver": {"every": 30.5}}),
        ("kitchen", {"saver": {"clock": False}}),
        ("kitchen", {"cards": []}),
    ],
)
async def test_screens_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    name: str,
    layout: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    answer = await _send(client, {"type": "domotwin/screens/save", "name": name, "layout": layout})
    assert answer["error"]["code"] == "invalid_screen"


async def test_screens_have_a_limit(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    client = await hass_ws_client(hass)
    for n in range(MAX_SCREENS):
        answer = await _send(
            client, {"type": "domotwin/screens/save", "name": f"s{n}", "layout": {}}
        )
        assert answer["success"]
    answer = await _send(
        client, {"type": "domotwin/screens/save", "name": "one_more", "layout": {}}
    )
    assert answer["error"]["code"] == "too_many_screens"
    # Changing one is still allowed; a sensor given twice counts once.
    wake = ["binary_sensor.a", "binary_sensor.b"] * 6
    answer = await _send(
        client,
        {
            "type": "domotwin/screens/save",
            "name": "s0",
            "layout": {"start": "3d", "saver": {"wake": wake}},
        },
    )
    assert answer["result"]["screens"]["s0"]["saver"]["wake"] == wake[:2]


async def test_what_cannot_be_read_is_left_out(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    hass_storage[SCREENS_STORAGE_KEY] = {
        "version": 1,
        "key": SCREENS_STORAGE_KEY,
        "data": {
            "screens": {
                "kitchen": KITCHEN,
                "KITCHEN": {"start": "rooms"},
                "the hall": {},
                "attic": {"saver": {"after": "soon"}},
                "porch": "not a layout",
            }
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    screens = (await _send(client, {"type": "domotwin/screens/get"}))["result"]["screens"]
    assert list(screens) == ["kitchen"]
    assert screens["kitchen"]["saver"]["wake"] == ["binary_sensor.kitchen_motion"]


async def test_screens_need_domotwin_set_up(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await _send(client, {"type": "domotwin/screens/save", "name": "hall", "layout": {}})
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    answer = await _send(client, {"type": "domotwin/screens/get"})
    assert answer["error"]["code"] == "not_loaded"
    # Removed with the integration.
    assert await hass.config_entries.async_remove(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert SCREENS_STORAGE_KEY not in hass_storage


async def test_screens_counted_in_the_diagnostics(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_client: ClientSessionGenerator,
) -> None:
    """D-076: how many screens, and how many show photos; never their names, sensors or folders."""
    client = await hass_ws_client(hass)
    await _send(client, {"type": "domotwin/screens/save", "name": "kitchen", "layout": KITCHEN})
    await _send(client, {"type": "domotwin/screens/save", "name": "hall", "layout": {}})
    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, setup_integration)
    assert diagnostics["screens"] == {"screens": 2, "photos": 1}
    told = str(diagnostics)
    assert "kitchen" not in told
    assert "holidays" not in told
