"""Upkeep cards (D-033): due dates, storage, the websocket commands and the sensor."""

from __future__ import annotations

from datetime import date, datetime
import json
from typing import Any

from freezegun.api import FrozenDateTimeFactory
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.const import STORAGE_KEY, STORAGE_VERSION
from custom_components.domotwin.upkeep import (
    add_months,
    due_tasks,
    next_due,
    parse_date,
    piece_names,
    state,
)
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .conftest import ROOT

SENSOR = "sensor.domotwin_upkeep_due"


def _sensor(hass: HomeAssistant) -> State:
    state = hass.states.get(SENSOR)
    assert state is not None
    return state


def _washer(last_done: str = "2026-08-01") -> dict[str, Any]:
    """A fictional washing machine's card: a filter every 3 months, a warranty."""
    return {
        "make": "Fictional Appliances",
        "model": "W-100",
        "serial": "FA-0001",
        "installed": "2024-05-02",
        "warranty_end": "2026-11-10",
        "manual": "/local/manuals/washer.pdf",
        "service_life": 12,
        "notes": "Drain filter behind the bottom flap.",
        "tasks": [
            {
                "id": "filter",
                "name": "Clean the filter",
                "every": 3,
                "unit": "months",
                "last_done": last_done,
            }
        ],
    }


@pytest.mark.parametrize(
    "case",
    json.loads((ROOT / "tests" / "fixtures" / "upkeep-due.json").read_text(encoding="utf-8")),
    ids=lambda case: case["case"],
)
def test_the_cases_the_engine_is_tested_on(case: dict[str, Any]) -> None:
    today = date.fromisoformat(case["today"])
    due = next_due(case, parse_date(case.get("installed")), today)
    assert due.isoformat() == case["due"]
    assert state(due, today, case.get("lead_days", 14)) == case["state"]


def test_dates() -> None:
    assert add_months(date(2025, 1, 31), 1) == date(2025, 2, 28)
    # Never before the day it counts from, at the end of the calendar.
    assert add_months(date(9999, 12, 31), 1) == date(9999, 12, 31)
    # Only `YYYY-MM-DD`, as the engine reads it: no week dates.
    assert parse_date("2026-W43-6") is None
    assert add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)
    assert add_months(date(2025, 11, 15), 2) == date(2026, 1, 15)
    for wrong in ("2025-02-29", "2025-1-01", "", None, 20250101, "2025-01-01T00:00"):
        assert parse_date(wrong) is None
    # Days past the end of the calendar stop at its end.
    assert next_due({"every": 3650, "unit": "days"}, date(9999, 1, 1), date(9999, 1, 1)) == date.max


@pytest.fixture
async def at_noon(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> FrozenDateTimeFactory:
    """24 October 2026 at noon where the home is."""
    await hass.config.async_set_time_zone("Europe/Paris")
    freezer.move_to(datetime(2026, 10, 24, 12, 0, tzinfo=dt_util.get_default_time_zone()))
    return freezer


async def test_cards_are_kept_and_counted(
    hass: HomeAssistant,
    at_noon: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": demo_plan})
    assert (await client.receive_json())["success"]
    # The one entity, under the same id in every language: nothing due yet.
    assert _sensor(hass).state == "0"
    entry = er.async_get(hass).async_get(SENSOR)
    assert entry is not None
    assert entry.unique_id == f"{setup_integration.entry_id}_upkeep_due"

    await client.send_json_auto_id({"type": "domotwin/upkeep/get"})
    result = (await client.receive_json())["result"]
    assert result["upkeep"] == {"version": 1, "lead_days": 14, "pieces": {}}
    assert result["today"] == "2026-10-24"

    washer = _washer()
    await client.send_json_auto_id(
        {"type": "domotwin/upkeep/save", "pieces": {"washer": washer, "fridge": {"make": "Cold"}}}
    )
    saved = await client.receive_json()
    assert saved["success"], saved
    stored = hass_storage[STORAGE_KEY]
    assert stored["version"] == STORAGE_VERSION
    assert stored["minor_version"] == 1
    assert stored["data"]["upkeep"]["pieces"]["washer"] == washer
    assert stored["data"]["revisions"]["upkeep"] == saved["result"]["revision"]
    # The filter is due on 1 November: within 14 days.
    state_now = _sensor(hass)
    assert state_now.state == "1"
    assert state_now.attributes["tasks"] == [
        {
            "piece": "washer",
            "piece_name": "Washing machine",
            "task": "Clean the filter",
            "due": "2026-11-01",
            "state": "due",
        }
    ]
    # A lead of a week: not due yet. Only the cards given change; null removes one.
    await client.send_json_auto_id(
        {"type": "domotwin/upkeep/save", "pieces": {"fridge": None}, "lead_days": 7}
    )
    assert (await client.receive_json())["success"]
    assert _sensor(hass).state == "0"
    await client.send_json_auto_id({"type": "domotwin/upkeep/get"})
    upkeep = (await client.receive_json())["result"]["upkeep"]
    assert upkeep["lead_days"] == 7
    assert list(upkeep["pieces"]) == ["washer"]

    # Days go by: from midnight of 25 October it is due within a week.
    at_noon.move_to(datetime(2026, 10, 25, 0, 0, 2, tzinfo=dt_util.get_default_time_zone()))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert _sensor(hass).state == "1"
    # Overdue from 2 November, then done: every user can say so.
    at_noon.move_to(datetime(2026, 11, 2, 0, 0, 2, tzinfo=dt_util.get_default_time_zone()))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert _sensor(hass).attributes["tasks"][0]["state"] == "overdue"


async def test_done_is_for_everyone_editing_for_administrators(
    hass: HomeAssistant,
    at_noon: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    demo_plan: dict[str, Any],
) -> None:
    admin = await hass_ws_client(hass)
    await admin.send_json_auto_id({"type": "domotwin/plan/save", "plan": demo_plan})
    assert (await admin.receive_json())["success"]
    await admin.send_json_auto_id(
        {"type": "domotwin/upkeep/save", "pieces": {"washer": _washer("2026-07-01")}}
    )
    assert (await admin.receive_json())["success"]
    assert _sensor(hass).state == "1"

    user = await hass_ws_client(hass, hass_read_only_access_token)
    await user.send_json_auto_id({"type": "domotwin/upkeep/save", "pieces": {"washer": None}})
    refused = await user.receive_json()
    assert refused["error"]["code"] == "unauthorized"
    await user.send_json_auto_id({"type": "domotwin/upkeep/get"})
    assert (await user.receive_json())["success"]
    await user.send_json_auto_id(
        {"type": "domotwin/upkeep/done", "piece": "washer", "task": "filter"}
    )
    done = await user.receive_json()
    assert done["success"], done
    assert done["result"]["last_done"] == "2026-10-24"
    assert _sensor(hass).state == "0"
    # A task no card has.
    await user.send_json_auto_id({"type": "domotwin/upkeep/done", "piece": "washer", "task": "x"})
    assert (await user.receive_json())["error"]["code"] == "unknown_task"
    # Saved meanwhile elsewhere: the revision tells.
    await admin.send_json_auto_id(
        {"type": "domotwin/upkeep/save", "pieces": {"washer": _washer()}, "expected_revision": 2}
    )
    assert (await admin.receive_json())["error"]["code"] == "revision_conflict"


def _task(task_id: str) -> dict[str, Any]:
    return {"id": task_id, "name": "T", "every": 1, "unit": "days"}


def test_pieces_and_their_names() -> None:
    storeys = [
        {
            "plan": {"items": [{"id": "washer", "name": "Washing machine"}, {"id": "sofa"}]},
            # Edit mode removed the sofa and added a lamp.
            "layout": {"sofa": {"removed": True}, "lamp-1": {"add": {"name": "Lamp"}}},
        }
    ]
    names = piece_names(storeys)
    assert names == {"washer": "Washing machine", "lamp-1": "Lamp"}
    task = {"id": "t", "name": "T", "every": 1, "unit": "days"}
    upkeep = {
        "lead_days": 14,
        "pieces": {piece: {"tasks": [task]} for piece in ("washer", "lamp-1", "sofa")},
    }
    # The sofa is no more: its card is not counted.
    due = due_tasks(upkeep, names, date(2026, 10, 24))
    assert [(t["piece"], t["piece_name"]) for t in due] == [
        ("lamp-1", "Lamp"),
        ("washer", "Washing machine"),
    ]


@pytest.mark.parametrize(
    ("pieces", "extra"),
    [
        ({"washer": {"colour": "red"}}, {}),
        ({"washer": {"installed": "2026-02-30"}}, {}),
        ({"washer": {"installed": "2026-W43-6"}}, {}),
        ({"washer": {"manual": "javascript:alert(1)"}}, {}),
        ({"washer": {"manual": "file:///etc/passwd"}}, {}),
        ({"washer": {"serial": "x" * 101}}, {}),
        ({"washer": {"service_life": 0}}, {}),
        ({"washer": {"service_life": 12.5}}, {}),
        ({"washer": {"tasks": [{"id": "a", "name": "A", "every": 2, "unit": "weeks"}]}}, {}),
        ({"washer": {"tasks": [{"id": "a", "name": "A", "every": 0, "unit": "days"}]}}, {}),
        ({"washer": {"tasks": [{"id": "a", "name": "A", "every": 121, "unit": "months"}]}}, {}),
        ({"washer": {"tasks": [{"id": "a", "name": " ", "every": 1, "unit": "days"}]}}, {}),
        (
            {
                "washer": {
                    "tasks": [
                        {"id": "a", "name": "A", "every": 1, "unit": "days"},
                        {"id": "a", "name": "B", "every": 1, "unit": "days"},
                    ]
                }
            },
            {},
        ),
        ({"washer": {"tasks": [_task(f"t{n}") for n in range(21)]}}, {}),
        ({"x" * 101: {}}, {}),
        ({}, {"lead_days": 366}),
        ({}, {"lead_days": True}),
    ],
)
async def test_invalid_cards_are_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    pieces: dict[str, Any],
    extra: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/upkeep/save", "pieces": pieces, **extra})
    response = await client.receive_json()
    assert not response["success"]
    assert response["error"]["code"] in ("invalid_upkeep", "invalid_format")


async def test_cards_too_large_together_are_refused(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
    demo_plan: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    items = [
        {"id": f"piece-{n}", "name": "Piece", "kind": "box", "at": [100, 100], "size": [10, 10, 10]}
        for n in range(480)
    ]
    await client.send_json_auto_id(
        {"type": "domotwin/plan/save", "plan": {**demo_plan, "items": items}}
    )
    assert (await client.receive_json())["success"]
    # Cards of pieces no plan has any more (a storey removed): kept, but not counted.
    orphans = {f"gone-{n}": {"notes": "o" * 2000} for n in range(100)}
    await client.send_json_auto_id({"type": "domotwin/upkeep/save", "pieces": orphans})
    assert (await client.receive_json())["success"]
    card = {"notes": "x" * 2000, "make": "m" * 100, "model": "m" * 100, "serial": "s" * 100}
    refused = False
    for batch in range(5):
        pieces = {f"piece-{n}": card for n in range(batch * 100, min(480, batch * 100 + 100))}
        await client.send_json_auto_id({"type": "domotwin/upkeep/save", "pieces": pieces})
        response = await client.receive_json()
        if not response["success"]:
            assert response["error"]["code"] == "too_large"
            refused = True
            break
    assert refused, "480 cards of 2 300 characters were all kept"
    # Room ran short: the cards no plan has went first.
    stored = hass_storage[STORAGE_KEY]["data"]["upkeep"]["pieces"]
    assert not [piece for piece in stored if piece.startswith("gone-")]


async def test_data_without_cards_gets_them(
    hass: HomeAssistant, hass_storage: dict[str, Any], config_entry: MockConfigEntry
) -> None:
    # Written by DomoTwin before upkeep (3.1): read, its cards empty, their revision its own.
    hass_storage[STORAGE_KEY] = {
        "version": 3,
        "minor_version": 1,
        "key": STORAGE_KEY,
        "data": {"revision": 4, "storeys": [], "bindings": {}, "settings": {}},
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    data = config_entry.runtime_data
    assert data.upkeep == {"version": 1, "lead_days": 14, "pieces": {}}
    assert data.revision_of("upkeep") == 4
    assert hass_storage[STORAGE_KEY]["data"]["revisions"]["upkeep"] == 4
    # Saving something else leaves the cards' revision as it is.
    await data.async_save_settings({"north": 10})
    assert data.revision_of("upkeep") == 4
    assert _sensor(hass).state == "0"
    # Unloading removes the sensor; the cards stay stored.
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert _sensor(hass).state == "unavailable"


async def test_blank_texts_are_not_said(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    card = {"make": "   ", "manual": "  ", "notes": " \n ", "model": " W-100 "}
    await client.send_json_auto_id({"type": "domotwin/upkeep/save", "pieces": {"washer": card}})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/upkeep/get"})
    stored = (await client.receive_json())["result"]["upkeep"]["pieces"]["washer"]
    assert stored == {"model": "W-100", "tasks": []}
