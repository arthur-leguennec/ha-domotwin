"""The home's Wi-Fi for guests (D-058): kept private, shown to administrators and chosen screens."""

from __future__ import annotations

import json
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.const import WIFI_STORAGE_KEY
from custom_components.domotwin.diagnostics import async_get_config_entry_diagnostics
from custom_components.domotwin.wifi import password_error
from homeassistant.core import HomeAssistant

# A fictional guest network.
SECRET = "tea-and-cake-42"  # noqa: S105 (a fictional network's)
GUESTS = {
    "name": "Fictional Guests",
    "password": SECRET,
    "security": "WPA",
    "screens": ["hall"],
}


async def _send(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


async def test_the_wifi_is_given_once_and_shown_where_chosen(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    hass_storage: dict[str, Any],
) -> None:
    admin = await hass_ws_client(hass)
    user = await hass_ws_client(hass, hass_read_only_access_token)
    # A screen listening is told it changed, never what.
    screen = await hass_ws_client(hass, hass_read_only_access_token)
    await _send(screen, {"type": "domotwin/subscribe"})
    assert (await _send(admin, {"type": "domotwin/wifi/get"}))["result"] == {
        "set": False,
        "shown": False,
    }
    answer = await _send(admin, {"type": "domotwin/wifi/save", "wifi": GUESTS})
    assert answer["result"] == {
        "set": True,
        "shown": True,
        "name": "Fictional Guests",
        "password": SECRET,
        "security": "WPA",
        "hidden": False,
        "screens": ["hall"],
    }
    # Someone else sees it on a screen an administrator chose (whatever the case of its name),
    # without the list of screens; its password only when asked for (the dialog open). Not
    # elsewhere.
    seen = (await _send(user, {"type": "domotwin/wifi/get", "screen": "HALL"}))["result"]
    assert seen["name"] == "Fictional Guests"
    assert "password" not in seen
    assert "screens" not in seen
    message = {"type": "domotwin/wifi/get", "screen": "hall", "password": True}
    seen = (await _send(user, message))["result"]
    assert seen["password"] == SECRET
    event = await screen.receive_json()
    assert event["event"] == {"kind": "wifi", "revision": 1}
    for elsewhere in ("kitchen", ""):
        message = {"type": "domotwin/wifi/get", "screen": elsewhere, "password": True}
        answer = await _send(user, message)
        assert answer["result"] == {"set": True, "shown": False}
    # Only an administrator changes it.
    answer = await _send(user, {"type": "domotwin/wifi/save", "wifi": GUESTS})
    assert answer["error"]["code"] == "unauthorized"
    answer = await _send(user, {"type": "domotwin/wifi/clear"})
    assert answer["error"]["code"] == "unauthorized"
    # The same network saved without its password keeps it; another one needs its own.
    kept = {key: value for key, value in GUESTS.items() if key != "password"}
    answer = await _send(admin, {"type": "domotwin/wifi/save", "wifi": {**kept, "hidden": True}})
    assert answer["result"]["password"] == SECRET
    # Even an administrator's screens are not sent it unless they ask.
    assert "password" not in (await _send(admin, {"type": "domotwin/wifi/get"}))["result"]
    assert answer["result"]["hidden"] is True
    answer = await _send(admin, {"type": "domotwin/wifi/save", "wifi": {**kept, "name": "Other"}})
    assert answer["error"]["code"] == "bad_wpa"
    # In a store of its own, never in DomoTwin's data or its diagnostics.
    await hass.async_block_till_done()
    assert hass_storage[WIFI_STORAGE_KEY]["data"]["wifi"]["password"] == SECRET
    others = json.dumps(
        {key: value for key, value in hass_storage.items() if key != WIFI_STORAGE_KEY}
    )
    assert SECRET not in others
    diagnostics = await async_get_config_entry_diagnostics(hass, setup_integration)
    assert diagnostics["wifi"] == {"set": True, "router_code": False}
    assert SECRET not in json.dumps(diagnostics)
    assert "Fictional Guests" not in json.dumps(diagnostics)
    # Forgotten.
    await _send(admin, {"type": "domotwin/wifi/clear"})
    assert (await _send(user, {"type": "domotwin/wifi/get", "screen": "hall"}))["result"] == {
        "set": False,
        "shown": False,
    }


async def test_a_router_s_own_code_and_an_open_network(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    admin = await hass_ws_client(hass)
    answer = await _send(
        admin,
        {
            "type": "domotwin/wifi/save",
            "wifi": {"image": "image.router_guest_wifi_qr", "security": "WPA", "password": "x"},
        },
    )
    # The router's code is shown as it is: no password kept.
    assert answer["result"]["image"] == "image.router_guest_wifi_qr"
    assert "password" not in answer["result"]
    answer = await _send(
        admin,
        {
            "type": "domotwin/wifi/save",
            "wifi": {"name": "Café", "security": "nopass", "screens": [" Hall\n"]},
        },
    )
    assert answer["result"]["security"] == "nopass"
    assert "password" not in answer["result"]
    # A screen's name read as a card's: around it, nothing.
    assert answer["result"]["screens"] == ["Hall"]


@pytest.mark.parametrize(
    ("wifi", "code"),
    [
        ({"security": "WPA", "password": SECRET}, "no_name"),
        ({"name": "", "security": "nopass"}, "no_name"),
        ({"name": "é" * 17, "security": "nopass"}, "long_name"),
        ({"name": "N", "security": "WPA", "password": "short"}, "bad_wpa"),
        ({"name": "N", "security": "WEP", "password": "abcdef"}, "bad_wep"),
        ({"name": "N", "security": "WPA2", "password": SECRET}, "invalid"),
        ({"name": "N", "security": "nopass", "screens": ["the hall"]}, "invalid"),
        ({"name": "N", "security": "nopass", "image": "camera.door"}, "invalid"),
    ],
)
async def test_a_wifi_that_cannot_be_joined_is_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    wifi: dict[str, Any],
    code: str,
) -> None:
    admin = await hass_ws_client(hass)
    answer = await _send(admin, {"type": "domotwin/wifi/save", "wifi": wifi})
    assert answer["error"]["code"] == code
    # Nothing was kept, and the password is not said back.
    assert (await _send(admin, {"type": "domotwin/wifi/get"}))["result"]["set"] is False
    assert SECRET not in answer["error"]["message"]


def test_passwords_as_each_kind_of_network_takes_them() -> None:
    assert password_error("WPA", "tea-and-cake-42") is None
    assert password_error("WPA", "a" * 64) is None
    assert password_error("WPA", "g" * 64) == "bad_wpa"
    assert password_error("WPA", "thé-et-gâteau") == "bad_wpa"
    assert password_error("WEP", "abcde") is None
    assert password_error("WEP", "0123456789") is None
    assert password_error("WEP", "abcdefg") == "bad_wep"
    assert password_error("nopass", "") is None


async def test_the_wifi_is_read_again_after_a_restart(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    hass_storage[WIFI_STORAGE_KEY] = {
        "version": 1,
        "key": WIFI_STORAGE_KEY,
        "data": {"wifi": {**GUESTS, "hidden": False}},
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    admin = await hass_ws_client(hass)
    assert (await _send(admin, {"type": "domotwin/wifi/get"}))["result"]["name"] == (
        "Fictional Guests"
    )
    # Removing DomoTwin deletes it.
    assert await hass.config_entries.async_remove(config_entry.entry_id)
    await hass.async_block_till_done()
    assert WIFI_STORAGE_KEY not in hass_storage
