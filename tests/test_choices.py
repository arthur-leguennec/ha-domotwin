"""Each user's own choices (D-055): favourites, the tab DomoTwin opens on, the Home tab's cards."""

from __future__ import annotations

from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.const import CHOICES_STORAGE_KEY, MAX_FAVOURITES
from homeassistant.core import HomeAssistant


async def _send(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


async def test_choices_are_each_users_own(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    hass_storage: dict[str, Any],
) -> None:
    admin = await hass_ws_client(hass)
    # Nothing chosen yet: no favourites, no cards, no tab.
    assert (await _send(admin, {"type": "domotwin/choices/get"}))["result"] == {
        "favourites": [],
        "cards": [],
    }
    for entity_id in ("light.kitchen", "scene.evening", "light.kitchen"):
        answer = await _send(
            admin,
            {"type": "domotwin/choices/favourite", "entity_id": entity_id, "favourite": True},
        )
        assert answer["success"]
    assert answer["result"] == {"favourites": ["light.kitchen", "scene.evening"]}
    answer = await _send(
        admin,
        {
            "type": "domotwin/choices/save",
            "start": "rooms",
            "cards": [
                {"type": "calendar", "entities": ["calendar.family"]},
                {"type": "todo-list", "entity": "todo.shopping"},
                # DomoTwin's own summary (D-061).
                {"type": "summary", "summary": "people"},
            ],
        },
    )
    assert answer["result"]["start"] == "rooms"
    assert len(answer["result"]["cards"]) == 3
    # Another user has their own, and changes only theirs.
    user = await hass_ws_client(hass, hass_read_only_access_token)
    assert (await _send(user, {"type": "domotwin/choices/get"}))["result"]["favourites"] == []
    await _send(
        user, {"type": "domotwin/choices/favourite", "entity_id": "light.desk", "favourite": True}
    )
    mine = (await _send(admin, {"type": "domotwin/choices/get"}))["result"]
    assert mine["favourites"] == ["light.kitchen", "scene.evening"]
    # A star taken away; the tab no longer chosen.
    answer = await _send(
        admin,
        {"type": "domotwin/choices/favourite", "entity_id": "light.kitchen", "favourite": False},
    )
    assert answer["result"] == {"favourites": ["scene.evening"]}
    # The Safety tab (D-068), a wall screen by the door's.
    answer = await _send(admin, {"type": "domotwin/choices/save", "start": "safety"})
    assert answer["result"]["start"] == "safety"
    answer = await _send(admin, {"type": "domotwin/choices/save", "start": ""})
    assert "start" not in answer["result"]
    assert len(answer["result"]["cards"]) == 3
    # Kept by user, in a store of their own.
    await hass.async_block_till_done()
    users = hass_storage[CHOICES_STORAGE_KEY]["data"]["users"]
    assert sorted(len(choices["favourites"]) for choices in users.values()) == [1, 1]


@pytest.mark.parametrize(
    "message",
    [
        {"start": "garden"},
        {"cards": [{"type": "entities", "entities": ["light.kitchen"]}]},
        {"cards": [{"type": "calendar", "entities": ["todo.shopping"]}]},
        {"cards": [{"type": "todo-list", "entity": "todo.a"}] * 7},
        {"cards": [{"type": "summary", "summary": "weather"}]},
    ],
)
async def test_choices_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    message: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    answer = await _send(client, {"type": "domotwin/choices/save", **message})
    assert answer["error"]["code"] == "invalid_format"


async def test_favourites_have_a_limit(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    client = await hass_ws_client(hass)
    for n in range(MAX_FAVOURITES):
        await _send(
            client,
            {"type": "domotwin/choices/favourite", "entity_id": f"light.l{n}", "favourite": True},
        )
    answer = await _send(
        client,
        {"type": "domotwin/choices/favourite", "entity_id": "light.one_more", "favourite": True},
    )
    assert answer["error"]["code"] == "too_many_favourites"
    answer = await _send(
        client, {"type": "domotwin/choices/favourite", "entity_id": "not an id", "favourite": True}
    )
    assert answer["error"]["code"] == "invalid_format"


async def test_users_removed_are_forgotten(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
    hass_admin_user: Any,
) -> None:
    hass_storage[CHOICES_STORAGE_KEY] = {
        "version": 1,
        "key": CHOICES_STORAGE_KEY,
        "data": {
            "users": {
                hass_admin_user.id: {
                    "favourites": ["light.kitchen", "not an id", "light.kitchen"],
                    "start": "garden",
                    "cards": [{"type": "entities"}],
                },
                "someone-removed": {"favourites": ["light.desk"]},
            }
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert list(hass_storage[CHOICES_STORAGE_KEY]["data"]["users"]) == [hass_admin_user.id]
    client = await hass_ws_client(hass)
    # What could not be read is left out.
    assert (await _send(client, {"type": "domotwin/choices/get"}))["result"] == {
        "favourites": ["light.kitchen"],
        "cards": [],
    }


async def test_choices_need_domotwin_set_up(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await _send(
        client, {"type": "domotwin/choices/favourite", "entity_id": "light.a", "favourite": True}
    )
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    answer = await _send(client, {"type": "domotwin/choices/get"})
    assert answer["error"]["code"] == "not_loaded"
    # Removed with the integration.
    assert await hass.config_entries.async_remove(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert CHOICES_STORAGE_KEY not in hass_storage
