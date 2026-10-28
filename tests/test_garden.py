"""The garden (D-077): when each lawn was last mown, said by someone or by its robot mower."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator, WebSocketGenerator

from custom_components.domotwin.const import GARDEN_STORAGE_KEY, MAX_LAWNS
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util


async def _send(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


#: A fictional house: a living room, a garden drawn round it and a deck in it.
GARDEN_PLAN: dict[str, Any] = {
    "format": "domotwin-plan",
    "version": 1,
    "rooms": [
        {"id": "living", "outline": [[0, 0], [500, 0], [500, 400], [0, 400]]},
        {
            "id": "back-garden",
            "outside": True,
            "outline": [[-300, -300], [800, -300], [800, 700], [-300, 700]],
        },
        {
            "id": "deck",
            "outside": True,
            "floor": {"material": "decking"},
            "outline": [[0, 400], [500, 400], [500, 600], [0, 600]],
        },
    ],
}


async def _with_garden(client: Any) -> None:
    """Stores the fictional house with its garden (an administrator's client)."""
    saved = await _send(client, {"type": "domotwin/plan/save", "plan": GARDEN_PLAN, "layout": {}})
    assert saved["success"], saved


async def test_a_lawn_said_mown_by_anyone(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    freezer: FrozenDateTimeFactory,
) -> None:
    watcher = await hass_ws_client(hass)
    await _with_garden(watcher)
    await _send(watcher, {"type": "domotwin/subscribe"})
    user = await hass_ws_client(hass, hass_read_only_access_token)
    freezer.move_to("2026-05-04T08:30:00+00:00")
    assert (await _send(user, {"type": "domotwin/garden/get"}))["result"] == {
        "lawns": {},
        "mowers": {},
    }
    # Any user says it: it is mown in the home.
    answer = await _send(user, {"type": "domotwin/garden/mowed", "room": "back-garden"})
    assert answer["result"]["lawns"] == {"back-garden": "2026-05-04T08:30:00+00:00"}
    told = await watcher.receive_json()
    assert told["event"]["kind"] == "garden"
    # A lawn of the plan: not a room of the home, nor a deck, nor an id it does not have.
    for room in ("living", "deck", "nowhere"):
        refused = await _send(user, {"type": "domotwin/garden/mowed", "room": room})
        assert refused["error"]["code"] == "unknown_lawn"
    refused = await _send(user, {"type": "domotwin/garden/mowed", "room": ""})
    assert refused["error"]["code"] == "invalid_format"
    refused = await _send(user, {"type": "domotwin/garden/mowed", "room": "x" * 101})
    assert refused["error"]["code"] == "invalid_format"


async def test_a_robot_mower_noted_when_it_stops_mowing(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    client = await hass_ws_client(hass)
    freezer.move_to("2026-05-04T09:00:00+00:00")
    hass.states.async_set("lawn_mower.mowy", "docked")
    hass.states.async_set("vacuum.dusty", "cleaning")
    await hass.async_block_till_done()
    # Docked, then mowing: nothing noted yet.
    hass.states.async_set("lawn_mower.mowy", "mowing")
    await hass.async_block_till_done()
    assert (await _send(client, {"type": "domotwin/garden/get"}))["result"]["mowers"] == {}
    # Out of reach for a while: still mowing.
    hass.states.async_set("lawn_mower.mowy", "unavailable")
    await hass.async_block_till_done()
    hass.states.async_set("lawn_mower.mowy", "mowing")
    await hass.async_block_till_done()
    assert (await _send(client, {"type": "domotwin/garden/get"}))["result"]["mowers"] == {}
    # It stops at a quarter to eleven: noted then, and written a little later.
    freezer.move_to("2026-05-04T10:45:00+00:00")
    hass.states.async_set("lawn_mower.mowy", "returning")
    hass.states.async_set("vacuum.dusty", "docked")
    await hass.async_block_till_done()
    garden = (await _send(client, {"type": "domotwin/garden/get"}))["result"]
    assert garden["mowers"] == {"lawn_mower.mowy": "2026-05-04T10:45:00+00:00"}
    # Back on its dock: still the time it stopped mowing.
    hass.states.async_set("lawn_mower.mowy", "docked")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=30))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    stored = hass_storage[GARDEN_STORAGE_KEY]["data"]
    assert stored["mowers"] == {"lawn_mower.mowy": "2026-05-04T10:45:00+00:00"}
    # Removed while mowing: not a mowing.
    hass.states.async_set("lawn_mower.other", "mowing")
    await hass.async_block_till_done()
    hass.states.async_remove("lawn_mower.other")
    await hass.async_block_till_done()
    assert (
        "lawn_mower.other"
        not in (await _send(client, {"type": "domotwin/garden/get"}))["result"]["mowers"]
    )


async def test_a_mowing_noted_is_written_when_domotwin_unloads(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_storage: dict[str, Any],
) -> None:
    hass.states.async_set("lawn_mower.mowy", "mowing")
    await hass.async_block_till_done()
    hass.states.async_set("lawn_mower.mowy", "docked")
    await hass.async_block_till_done()
    # Not yet written; written as DomoTwin unloads, before the time is up.
    assert GARDEN_STORAGE_KEY not in hass_storage
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert "lawn_mower.mowy" in hass_storage[GARDEN_STORAGE_KEY]["data"]["mowers"]


async def test_what_cannot_be_read_is_left_out_and_the_latest_kept(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    lawns: dict[str, Any] = {
        f"lawn-{k:03}": f"2026-04-{1 + k % 28:02}T08:00:00+00:00" for k in range(MAX_LAWNS + 5)
    }
    lawns.update(
        {"": "2026-05-01T08:00:00+00:00", "front": "soon", "back": 7, "side": "2026-05-02T08:00:00"}
    )
    hass_storage[GARDEN_STORAGE_KEY] = {
        "version": 1,
        "key": GARDEN_STORAGE_KEY,
        "data": {
            "lawns": lawns,
            "mowers": {
                "lawn_mower.mowy": "2026-05-02T10:00:00+00:00",
                "vacuum.dusty": "2026-05-02T10:00:00+00:00",
            },
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    garden = (await _send(client, {"type": "domotwin/garden/get"}))["result"]
    assert len(garden["lawns"]) == MAX_LAWNS
    assert all(name.startswith("lawn-") for name in garden["lawns"])
    assert garden["mowers"] == {"lawn_mower.mowy": "2026-05-02T10:00:00+00:00"}


async def test_the_garden_needs_domotwin_and_goes_with_it(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
    hass_client: ClientSessionGenerator,
) -> None:
    client = await hass_ws_client(hass)
    await _with_garden(client)
    await _send(client, {"type": "domotwin/garden/mowed", "room": "back-garden"})
    # Counted in the diagnostics, never which or when.
    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, setup_integration)
    assert diagnostics["garden"] == {"lawns": 1, "mowers": 0}
    assert "back-garden" not in str(diagnostics)
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    answer = await _send(client, {"type": "domotwin/garden/get"})
    assert answer["error"]["code"] == "not_loaded"
    # Nothing is noted once unloaded.
    hass.states.async_set("lawn_mower.mowy", "mowing")
    hass.states.async_set("lawn_mower.mowy", "docked")
    await hass.async_block_till_done()
    assert await hass.config_entries.async_remove(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert GARDEN_STORAGE_KEY not in hass_storage
