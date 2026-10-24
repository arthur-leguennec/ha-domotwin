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
    assert result == {"plan": None, "layout": {}, "storey": None, "storeys": [], "revision": 0}

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
    # The look shown by default and its accent.
    await client.send_json_auto_id(
        {
            "type": "domotwin/settings/save",
            "settings": {"north": 0, "theme": "neon", "accent": "#FF2D95"},
        }
    )
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/settings/get"})
    assert (await client.receive_json())["result"]["settings"] == {
        "north": 0,
        "theme": "neon",
        "accent": "#ff2d95",
    }


@pytest.mark.parametrize(
    "settings",
    [
        {"north": 360},
        {"north": -1},
        {"north": "up"},
        {"north": True},
        {"theme": "dark"},
        {"accent": "red"},
        {"accent": "#12345"},
        {"other": 1},
    ],
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


async def test_storeys_over_the_websocket(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)

    async def send(message: dict[str, Any]) -> dict[str, Any]:
        await client.send_json_auto_id(message)
        response: dict[str, Any] = await client.receive_json()
        return response

    assert (await send({"type": "domotwin/plan/save", "plan": demo_plan}))["success"]
    upper = {
        **demo_plan,
        "elements": [
            {"id": "attic", "type": "room", "name": "Attic", "x": 0, "y": 0, "w": 300, "h": 300}
        ],
    }
    added = await send(
        {"type": "domotwin/storey/save", "name": "First floor", "elevation": 280, "plan": upper}
    )
    assert added["success"]
    storey = added["result"]["storey"]
    got = (await send({"type": "domotwin/plan/get", "storey": storey}))["result"]
    assert got["plan"] == upper
    assert got["storey"] == storey
    assert got["storeys"] == [
        {"id": "storey-1", "name": "", "elevation": 0},
        {"id": storey, "name": "First floor", "elevation": 280.0},
    ]
    # The ground floor by default.
    assert (await send({"type": "domotwin/plan/get"}))["result"]["storey"] == "storey-1"
    # Ids are unique in the whole home: the demo's on another storey are refused.
    clash = await send({"type": "domotwin/storey/save", "plan": demo_plan})
    assert clash["error"]["code"] == "duplicate_id"
    clash = await send({"type": "domotwin/plan/save", "storey": storey, "plan": demo_plan})
    assert clash["error"]["code"] == "duplicate_id"
    # A storey of its own may keep its ids.
    same = await send({"type": "domotwin/plan/save", "storey": storey, "plan": upper})
    assert same["success"]
    # Checked fields.
    bad = await send({"type": "domotwin/storey/save", "storey": storey, "elevation": 10**9})
    assert bad["error"]["code"] == "invalid_storey"
    bad = await send({"type": "domotwin/storey/save", "name": "Nothing"})
    assert bad["error"]["code"] == "invalid_storey"
    unknown = await send({"type": "domotwin/plan/get", "storey": "nope"})
    assert unknown["error"]["code"] == "unknown_storey"
    unknown = await send({"type": "domotwin/storey/remove", "storey": "nope"})
    assert unknown["error"]["code"] == "unknown_storey"
    # Removed.
    assert (await send({"type": "domotwin/storey/remove", "storey": storey}))["success"]
    got = (await send({"type": "domotwin/plan/get"}))["result"]
    assert [s["id"] for s in got["storeys"]] == ["storey-1"]
    info = (await send({"type": "domotwin/info"}))["result"]
    assert info["storeys"] == 1


async def test_pieces_added_in_edit_mode_have_ids_of_their_own(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)

    async def send(message: dict[str, Any]) -> dict[str, Any]:
        await client.send_json_auto_id(message)
        response: dict[str, Any] = await client.receive_json()
        return response

    lamp = {
        "lamp-added-1": {
            "add": {"name": "Floor lamp", "kind": "lamp", "w": 35, "h": 35, "z": 160},
            "x": 40,
            "y": 20,
        }
    }
    assert (await send({"type": "domotwin/plan/save", "plan": demo_plan, "layout": lamp}))[
        "success"
    ]
    upper = {
        **demo_plan,
        "elements": [
            {"id": "attic", "type": "room", "name": "Attic", "x": 0, "y": 0, "w": 300, "h": 300}
        ],
    }
    added = await send({"type": "domotwin/storey/save", "plan": upper, "elevation": 280})
    storey = added["result"]["storey"]
    # The same id added on another storey is refused, in the overlay as in the plan.
    clash = await send({"type": "domotwin/plan/save", "storey": storey, "layout": lamp})
    assert clash["error"]["code"] == "duplicate_id"
    clash = await send({"type": "domotwin/storey/save", "storey": storey, "layout": lamp})
    assert clash["error"]["code"] == "duplicate_id"
    # Moving a piece of its own is not adding one.
    moved = await send(
        {"type": "domotwin/plan/save", "storey": storey, "layout": {"attic": {"x": 10}}}
    )
    assert moved["success"]


async def test_every_storey_is_replaced_at_once_or_none(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)

    async def send(message: dict[str, Any]) -> dict[str, Any]:
        await client.send_json_auto_id(message)
        response: dict[str, Any] = await client.receive_json()
        return response

    assert (await send({"type": "domotwin/plan/save", "plan": demo_plan}))["success"]
    upper = {
        **demo_plan,
        "elements": [
            {"id": "attic", "type": "room", "name": "Attic", "x": 0, "y": 0, "w": 300, "h": 300}
        ],
    }
    cellar = {
        **demo_plan,
        "elements": [
            {"id": "cellar", "type": "room", "name": "Cellar", "x": 0, "y": 0, "w": 300, "h": 300}
        ],
    }
    replace = {
        "type": "domotwin/storeys/replace",
        "storeys": [
            {"name": "Cellar", "elevation": -300, "plan": cellar},
            {"name": "Attic", "elevation": 280, "plan": upper},
        ],
    }
    # Refused, the home as it was: ids on two storeys, a bad height, none, too many.
    for storeys, code in (
        ([{"plan": upper}, {"plan": upper}], "duplicate_id"),
        ([{"plan": upper, "elevation": 10**9}], "invalid_storey"),
        ([], "invalid_storey"),
        ([{"plan": upper}] * 21, "too_many_storeys"),
    ):
        refused = await send({**replace, "storeys": storeys})
        assert refused["error"]["code"] == code
    got = (await send({"type": "domotwin/plan/get"}))["result"]
    assert got["plan"] == demo_plan
    # Replaced: ids in order, the ground floor the one nearest 0.
    done = await send(replace)
    assert done["result"]["storeys"] == ["storey-1", "storey-2"]
    got = (await send({"type": "domotwin/plan/get"}))["result"]
    assert got["storey"] == "storey-2"
    assert got["plan"] == upper
    assert [(s["name"], s["elevation"]) for s in got["storeys"]] == [
        ("Cellar", -300.0),
        ("Attic", 280.0),
    ]


async def test_storeys_need_an_admin(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id({"type": "domotwin/storey/save", "plan": demo_plan})
    assert (await client.receive_json())["error"]["code"] == "unauthorized"
    await client.send_json_auto_id({"type": "domotwin/storey/remove", "storey": "storey-1"})
    assert (await client.receive_json())["error"]["code"] == "unauthorized"
    await client.send_json_auto_id(
        {"type": "domotwin/storeys/replace", "storeys": [{"plan": demo_plan}]}
    )
    assert (await client.receive_json())["error"]["code"] == "unauthorized"
