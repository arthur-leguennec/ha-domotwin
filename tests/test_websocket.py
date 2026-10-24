"""Websocket API: reads for everyone, writes for admins, revisions and events."""

from __future__ import annotations

import copy
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.const import MAX_ELEMENTS
from homeassistant.core import HomeAssistant


async def test_empty_installation(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/info"})
    info = await client.receive_json()
    assert info["success"]
    assert info["result"]["revision"] == 0
    assert info["result"]["has_plan"] is False

    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    result = (await client.receive_json())["result"]
    assert result == {"plan": None, "layout": {}, "revision": 0}

    await client.send_json_auto_id({"type": "domotwin/bindings/get"})
    result = (await client.receive_json())["result"]
    assert result["bindings"] == {"version": 1, "rooms": {}, "elements": {}}


async def test_save_and_read_back(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    layout = {"sofa": {"x": 360, "y": 110}}
    await client.send_json_auto_id(
        {"type": "domotwin/plan/save", "plan": demo_plan, "layout": layout}
    )
    saved = await client.receive_json()
    assert saved["success"], saved
    assert saved["result"]["revision"] == 1

    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    result = (await client.receive_json())["result"]
    assert result["plan"] == demo_plan
    assert result["layout"] == layout
    assert result["revision"] == 1

    # Saving only the overlay keeps the plan; `plan: null` removes it.
    await client.send_json_auto_id({"type": "domotwin/plan/save", "layout": {}})
    assert (await client.receive_json())["result"]["revision"] == 2
    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    assert (await client.receive_json())["result"]["plan"] == demo_plan
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": None})
    await client.receive_json()
    await client.send_json_auto_id({"type": "domotwin/info"})
    assert (await client.receive_json())["result"]["has_plan"] is False


async def test_bindings_round_trip(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_bindings: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": demo_bindings})
    saved = await client.receive_json()
    assert saved["success"], saved
    await client.send_json_auto_id({"type": "domotwin/bindings/get"})
    assert (await client.receive_json())["result"]["bindings"] == demo_bindings


async def test_revision_conflict(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "domotwin/plan/save", "plan": demo_plan, "expected_revision": 0}
    )
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id(
        {"type": "domotwin/plan/save", "layout": {}, "expected_revision": 0}
    )
    response = await client.receive_json()
    assert not response["success"]
    assert response["error"]["code"] == "revision_conflict"


async def test_each_kind_is_checked_against_its_own_last_write(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """Saving the bindings or the settings does not refuse an edit of the plan started before."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": demo_plan})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    plan_revision = (await client.receive_json())["result"]["revision"]
    await client.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": demo_bindings})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/settings/save", "settings": {"north": 10}})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    assert (await client.receive_json())["result"]["revision"] == plan_revision
    await client.send_json_auto_id(
        {"type": "domotwin/plan/save", "layout": {}, "expected_revision": plan_revision}
    )
    saved = await client.receive_json()
    assert saved["success"], saved
    assert saved["result"]["revision"] == 4
    # The bindings are checked against their own last write too.
    await client.send_json_auto_id(
        {"type": "domotwin/bindings/save", "bindings": demo_bindings, "expected_revision": 2}
    )
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id(
        {"type": "domotwin/bindings/save", "bindings": demo_bindings, "expected_revision": 2}
    )
    assert (await client.receive_json())["error"]["code"] == "revision_conflict"


async def test_writes_need_an_admin(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass, hass_read_only_access_token)
    for message in (
        {"type": "domotwin/plan/save", "plan": demo_plan},
        {"type": "domotwin/bindings/save", "bindings": demo_bindings},
        {"type": "domotwin/settings/save", "settings": {"north": 90}},
    ):
        await client.send_json_auto_id(message)
        response = await client.receive_json()
        assert not response["success"]
        assert response["error"]["code"] == "unauthorized"
    # Reading is allowed.
    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    assert (await client.receive_json())["success"]


def _without(plan: dict[str, Any], key: str) -> dict[str, Any]:
    plan = copy.deepcopy(plan)
    del plan[key]
    return plan


@pytest.mark.parametrize(
    ("change", "code"),
    [
        (lambda plan: {**plan, "version": 2}, "invalid_plan"),
        (lambda plan: {**plan, "version": True}, "invalid_plan"),
        (lambda plan: {**plan, "unit": "mm"}, "invalid_plan"),
        (lambda plan: {**plan, "elements": []}, "invalid_plan"),
        (lambda plan: {**plan, "elements": [1]}, "invalid_plan"),
        (lambda plan: {**plan, "elements": [{}] * (MAX_ELEMENTS + 1)}, "invalid_plan"),
        (lambda plan: _without(plan, "unit"), "invalid_plan"),
        (lambda plan: {**plan, "title": "x" * 3_600_000}, "too_large"),
    ],
)
async def test_invalid_plans_are_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    change: Any,
    code: str,
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": change(demo_plan)})
    response = await client.receive_json()
    assert not response["success"]
    assert response["error"]["code"] == code
    await client.send_json_auto_id({"type": "domotwin/info"})
    assert (await client.receive_json())["result"]["revision"] == 0


@pytest.mark.parametrize(
    "bindings",
    [
        {"version": 2, "rooms": {}, "elements": {}},
        {"version": 1, "rooms": [], "elements": {}},
        {"version": 1, "elements": {"lamp": {"entities": []}}},
        {"version": 1, "elements": {"lamp": {"entities": [{"entity_id": "not an entity"}]}}},
        {"version": 1, "elements": {"lamp": {"entities": [{"entity_id": "light.a", "role": 3}]}}},
        {
            "version": 1,
            "elements": {
                "lamp": {"entities": [{"entity_id": "light.a"}], "tap_action": {"action": "x"}}
            },
        },
        {"version": 1, "elements": {"": {"entities": [{"entity_id": "light.a"}]}}},
        {"version": 1, "rooms": {"living": {"area": 3}}},
        {"version": 1, "elements": {"cam": {"entities": [{"entity_id": "camera.a"}], "fov": 5}}},
        {
            "version": 1,
            "elements": {"cam": {"entities": [{"entity_id": "camera.a"}], "range": "far"}},
        },
    ],
)
async def test_invalid_bindings_are_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    bindings: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": bindings})
    response = await client.receive_json()
    assert not response["success"]
    assert response["error"]["code"] == "invalid_bindings"


async def test_invalid_layout_is_refused(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/plan/save", "layout": {"sofa": 3}})
    response = await client.receive_json()
    assert response["error"]["code"] == "invalid_layout"


async def test_subscribers_hear_about_saves(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    listener = await hass_ws_client(hass)
    await listener.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await listener.receive_json())["success"]

    writer = await hass_ws_client(hass)
    await writer.send_json_auto_id({"type": "domotwin/plan/save", "plan": demo_plan})
    await writer.receive_json()
    event = await listener.receive_json()
    assert event["type"] == "event"
    assert event["event"] == {"kind": "plan", "revision": 1}

    await writer.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": demo_bindings})
    await writer.receive_json()
    assert (await listener.receive_json())["event"] == {"kind": "bindings", "revision": 2}


async def test_commands_before_setup(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    """The commands exist as soon as the integration is loaded, and answer `not_loaded`."""
    from homeassistant.setup import async_setup_component  # noqa: PLC0415

    assert await async_setup_component(hass, "domotwin", {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    response = await client.receive_json()
    assert response["error"]["code"] == "not_loaded"


async def test_settings_round_trip(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    listener = await hass_ws_client(hass)
    await listener.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await listener.receive_json())["success"]

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/settings/get"})
    assert (await client.receive_json())["result"] == {"settings": {}, "revision": 0}
    await client.send_json_auto_id({"type": "domotwin/settings/save", "settings": {"north": 22.5}})
    saved = await client.receive_json()
    assert saved["success"], saved
    assert (await listener.receive_json())["event"] == {"kind": "settings", "revision": 1}
    await client.send_json_auto_id({"type": "domotwin/settings/get"})
    assert (await client.receive_json())["result"] == {"settings": {"north": 22.5}, "revision": 1}


@pytest.mark.parametrize(
    "settings",
    [{"north": 360}, {"north": -1}, {"north": "up"}, {"north": True}, {"theme": "dark"}],
)
async def test_invalid_settings_are_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    settings: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/settings/save", "settings": settings})
    response = await client.receive_json()
    assert not response["success"]
    assert response["error"]["code"] == "invalid_settings"
