"""Each user's own choices (D-055): favourites, the tab, the Home tab's cards and shortcuts."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.choices import SHORTCUT_ICONS, STEP_DOES
from custom_components.domotwin.const import (
    CHOICES_STORAGE_KEY,
    MAX_FAVOURITES,
    MAX_LISTED,
    MAX_SHORTCUT_NAME,
    MAX_SHORTCUTS,
    MAX_STEPS,
)
from homeassistant.core import HomeAssistant

MODEL = Path(__file__).parent.parent / "frontend" / "src" / "live" / "shortcut-model.ts"


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
    # Nothing chosen yet: no favourites, no cards, no shortcuts, no tab.
    assert (await _send(admin, {"type": "domotwin/choices/get"}))["result"] == {
        "favourites": [],
        "cards": [],
        "shortcuts": [],
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
        # Shortcuts (D-084): a kind, a deed, an icon it may not have; nothing to do or show.
        {
            "shortcuts": [
                {
                    "id": "a",
                    "name": "A",
                    "icon": "lock",
                    "steps": [{"kind": "doors", "do": "open"}],
                }
            ]
        },
        {
            "shortcuts": [
                {
                    "id": "a",
                    "name": "A",
                    "icon": "lock",
                    "steps": [{"kind": "locks", "do": "open"}],
                }
            ]
        },
        {
            "shortcuts": [
                {
                    "id": "a",
                    "name": "A",
                    "icon": "rocket",
                    "steps": [{"kind": "locks", "do": "lock"}],
                }
            ]
        },
        {"shortcuts": [{"id": "a", "name": "A", "icon": "lock", "steps": []}]},
        {
            "shortcuts": [
                {"id": "a", "name": " ", "icon": "lock", "steps": [{"kind": "locks", "do": "lock"}]}
            ]
        },
        {
            "shortcuts": [
                {
                    "id": "A!",
                    "name": "A",
                    "icon": "lock",
                    "steps": [{"kind": "locks", "do": "lock"}],
                }
            ]
        },
        # A run step lists what it runs; a value stays a value.
        {
            "shortcuts": [
                {"id": "a", "name": "A", "icon": "play", "steps": [{"kind": "run", "do": "run"}]}
            ]
        },
        {
            "shortcuts": [
                {
                    "id": "a",
                    "name": "A",
                    "icon": "lock",
                    "steps": [{"kind": "lights", "do": "on", "value": 500}],
                }
            ]
        },
        # Each id once, and no more than the limit.
        {
            "shortcuts": [
                {"id": "a", "name": "A", "icon": "lock", "steps": [{"kind": "locks", "do": "lock"}]}
            ]
            * 2
        },
        {
            "shortcuts": [
                {
                    "id": f"s{n}",
                    "name": "A",
                    "icon": "lock",
                    "steps": [{"kind": "locks", "do": "lock"}],
                }
                for n in range(MAX_SHORTCUTS + 1)
            ]
        },
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
        "shortcuts": [],
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


async def test_shortcuts_are_kept(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    shortcuts = [
        {
            "id": "lights",
            "name": "All the lights off",
            "icon": "lights_off",
            "steps": [
                {"kind": "lights", "do": "off", "floor": "upstairs", "except": ["light.night_lamp"]}
            ],
        },
        {
            "id": "night",
            "name": "Good night",
            "icon": "moon",
            "quiet": True,
            "confirm": True,
            "steps": [
                {"kind": "covers", "do": "position", "area": "living_room", "value": 20},
                {"kind": "run", "do": "run", "entities": ["scene.evening"]},
            ],
        },
        {
            "id": "car",
            "name": "Car: battery",
            "icon": "car",
            "steps": [],
            "show": "sensor.car_battery",
        },
    ]
    answer = await _send(client, {"type": "domotwin/choices/save", "shortcuts": shortcuts})
    assert answer["success"]
    kept = answer["result"]["shortcuts"]
    assert [s["id"] for s in kept] == ["lights", "night", "car"]
    assert kept[1]["steps"][0]["value"] == 20
    # Kept with the rest of the user's choices, read back as saved.
    await hass.async_block_till_done()
    assert (await _send(client, {"type": "domotwin/choices/get"}))["result"]["shortcuts"] == kept
    users = hass_storage[CHOICES_STORAGE_KEY]["data"]["users"]
    assert [s["id"] for choices in users.values() for s in choices["shortcuts"]] == [
        "lights",
        "night",
        "car",
    ]
    # Saving the tab leaves them as they are; an empty list takes them all away.
    answer = await _send(client, {"type": "domotwin/choices/save", "start": "home"})
    assert len(answer["result"]["shortcuts"]) == 3
    answer = await _send(client, {"type": "domotwin/choices/save", "shortcuts": []})
    assert answer["result"]["shortcuts"] == []


async def test_shortcuts_not_understood_are_left_out(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
    hass_admin_user: Any,
) -> None:
    good = {"id": "ok", "name": "Lock", "icon": "lock", "steps": [{"kind": "locks", "do": "lock"}]}
    hass_storage[CHOICES_STORAGE_KEY] = {
        "version": 1,
        "key": CHOICES_STORAGE_KEY,
        "data": {
            "users": {
                hass_admin_user.id: {
                    "favourites": [],
                    "shortcuts": [
                        {"id": "bad", "name": "Fly", "icon": "rocket", "steps": []},
                        good,
                        good,
                        "not a shortcut",
                    ],
                }
            }
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    assert (await _send(client, {"type": "domotwin/choices/get"}))["result"]["shortcuts"] == [good]


def test_the_frontend_makes_the_same_shortcuts() -> None:
    """What a step does, the icons and the limits, here and in `shortcut-model.ts`."""
    text = MODEL.read_text(encoding="utf-8")
    does = re.search(r"export const STEP_DOES[^=]*= \{(.*?)\n\};", text, re.DOTALL)
    assert does is not None
    assert {
        kind: tuple(re.findall(r'"(\w+)"', listed))
        for kind, listed in re.findall(r"(\w+): \[([^\]]*)\]", does.group(1))
    } == STEP_DOES
    icons = re.search(r"export const SHORTCUT_ICONS = \[(.*?)\] as const;", text, re.DOTALL)
    assert icons is not None
    assert tuple(re.findall(r'"(\w+)"', icons.group(1))) == SHORTCUT_ICONS
    limits = dict(re.findall(r"export const (MAX_\w+) = (\d+);", text))
    assert limits == {
        "MAX_SHORTCUTS": str(MAX_SHORTCUTS),
        "MAX_STEPS": str(MAX_STEPS),
        "MAX_LISTED": str(MAX_LISTED),
        "MAX_NAME": str(MAX_SHORTCUT_NAME),
    }
