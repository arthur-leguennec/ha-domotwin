"""What DomoTwin knows of each room, on Home Assistant's area pages (D-061)."""

from __future__ import annotations

from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.compat import device_of
from custom_components.domotwin.const import DOMAIN, SIGNAL_SHOW
from custom_components.domotwin.overview import piece_rooms
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect

KITCHEN_PEOPLE = "sensor.domotwin_kitchen_people"
BATHROOM_UPKEEP = "sensor.domotwin_bathroom_upkeep_due"


def test_a_piece_is_in_the_room_it_names_or_the_one_around_it() -> None:
    plan = {
        "rooms": [
            {"id": "left", "outline": [[0, 0], [300, 0], [300, 300], [0, 300]]},
            {"id": "right", "outline": [[300, 0], [600, 0], [600, 300], [300, 300]]},
        ],
        "items": [
            {"id": "lamp", "at": [100, 100]},
            # Named, wherever it stands.
            {"id": "shelf", "at": [100, 100], "room": "right"},
            {"id": "outside", "at": [900, 100]},
            {"id": "named-nowhere", "at": [400, 100], "room": "garden"},
            {"id": "moved", "at": [100, 100]},
            {"id": "moved-named", "at": [100, 100], "room": "right"},
            {"id": "removed", "at": [100, 100]},
        ],
    }
    # As edit mode writes it: the room a piece follows next to its place.
    layout = {
        "moved": {"at": [450, 150]},
        "moved-named": {"at": [150, 150], "room": "left"},
        "removed": {"removed": True},
        "added": {"add": {"kind": "plant", "size": [30, 30, 60]}, "at": [500, 200]},
        "added-named": {
            "add": {"kind": "plant", "size": [30, 30, 60]},
            "at": [500, 200],
            "room": "left",
        },
    }
    assert piece_rooms([{"id": "s", "plan": plan, "layout": layout}]) == {
        "lamp": "left",
        "shelf": "right",
        "named-nowhere": "right",
        "moved": "right",
        "moved-named": "left",
        "added": "right",
        "added-named": "left",
    }
    assert piece_rooms([{"id": "s", "plan": None}]) == {}


@pytest.fixture
async def home(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> MockConfigEntry:
    """The demo apartment and its areas, Alex at home in the kitchen."""
    areas = ar.async_get(hass)
    for name in ("Living room", "Kitchen", "Bathroom", "Hallway", "Bedroom", "Office"):
        areas.async_create(name)
    client = await hass_ws_client(hass)
    for message in (
        {"type": "domotwin/plan/save", "plan": demo_plan},
        {"type": "domotwin/bindings/save", "bindings": demo_bindings},
        {"type": "domotwin/people/save", "people": {"person.alex": {"sources": ["sensor.where"]}}},
    ):
        await client.send_json_auto_id(message)
        assert (await client.receive_json())["success"], message
    hass.states.async_set("person.alex", "home", {"friendly_name": "Alex"})
    hass.states.async_set("sensor.where", "Kitchen")
    await hass.async_block_till_done()
    return setup_integration


def _state(hass: HomeAssistant, entity: str) -> State:
    state = hass.states.get(entity)
    assert state is not None, entity
    return state


async def test_each_room_has_a_device_in_its_area_with_who_is_there(
    hass: HomeAssistant, home: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    devices = dr.async_get(hass)
    kitchen = device_of(devices, (DOMAIN, f"{home.entry_id}_room_kitchen"), home.entry_id)
    assert kitchen is not None
    assert kitchen.name == "DomoTwin · Kitchen"
    assert kitchen.area_id == "kitchen"
    # Every room of the plan, each in the area it reads.
    rooms = [
        device
        for device in dr.async_entries_for_config_entry(devices, home.entry_id)
        if "_room_" in next(iter(device.identifiers))[1]
    ]
    assert sorted(device.area_id or "" for device in rooms) == [
        "bathroom",
        "bedroom",
        "hallway",
        "kitchen",
        "living_room",
    ]
    people = _state(hass, KITCHEN_PEOPLE)
    assert people.state == "1"
    assert people.attributes["people"] == ["person.alex"]
    assert people.attributes["area_id"] == "kitchen"
    assert people.name == "DomoTwin · Kitchen People here"
    entry = er.async_get(hass).async_get(KITCHEN_PEOPLE)
    assert entry is not None
    assert entry.device_id == kitchen.id
    # Alex walks into the hall.
    hass.states.async_set("sensor.where", "Hallway")
    await hass.async_block_till_done()
    assert _state(hass, KITCHEN_PEOPLE).state == "0"
    assert _state(hass, "sensor.domotwin_hall_people").attributes["people"] == ["person.alex"]

    # Kept private for nobody: who is there is not said; open again, it is.
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/settings/get"})
    settings = (await client.receive_json())["result"]["settings"]
    hass.states.async_set("input_boolean.do_not_disturb", "on")
    await client.send_json_auto_id(
        {
            "type": "domotwin/settings/save",
            "settings": {
                **settings,
                "rooms": {"hall": {"people": [], "while": "input_boolean.do_not_disturb"}},
            },
        }
    )
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    hall = _state(hass, "sensor.domotwin_hall_people")
    assert hall.state == "unknown"
    assert hall.attributes["private"] is True
    assert "people" not in hall.attributes
    hass.states.async_set("input_boolean.do_not_disturb", "off")
    await hass.async_block_till_done()
    assert _state(hass, "sensor.domotwin_hall_people").state == "1"

    # Alex hides: not on the area pages either. No longer placed: gone from them too.
    await client.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.alex", "hidden": True}
    )
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    hall = _state(hass, "sensor.domotwin_hall_people")
    assert (hall.state, hall.attributes["people"]) == ("0", [])
    await client.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.alex", "hidden": False}
    )
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert _state(hass, "sensor.domotwin_hall_people").state == "1"
    await client.send_json_auto_id({"type": "domotwin/people/save", "people": {}})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert _state(hass, "sensor.domotwin_hall_people").state == "0"


async def test_a_room_s_device_opens_domotwin_on_the_room(
    hass: HomeAssistant, home: MockConfigEntry
) -> None:
    devices = dr.async_get(hass)

    def link() -> str | None:
        kitchen = device_of(devices, (DOMAIN, f"{home.entry_id}_room_kitchen"), home.entry_id)
        assert kitchen is not None
        return kitchen.configuration_url

    # Home Assistant opens it in its own page: the panel, the kitchen framed in 3D (D-087).
    assert link() == "homeassistant://domotwin/3d?room=kitchen"
    # The panel no longer in the sidebar: no page to open; back, the link is back.
    hass.config_entries.async_update_entry(home, options={"sidebar": False})
    await hass.async_block_till_done()
    assert link() is None
    hass.config_entries.async_update_entry(home, options={"sidebar": True})
    await hass.async_block_till_done()
    assert link() == "homeassistant://domotwin/3d?room=kitchen"


async def test_a_workplace_counts_its_people_and_names_none(
    hass: HomeAssistant, home: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    """D-086: the rooms say how many, `domotwin.where` how many, nobody where."""
    client = await hass_ws_client(hass)
    watcher = await hass_ws_client(hass)
    await watcher.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await watcher.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/settings/get"})
    settings = (await client.receive_json())["result"]["settings"]
    workplace = {**settings, "workplace": {"hours": "schedule.opening_hours"}}
    await client.send_json_auto_id({"type": "domotwin/settings/save", "settings": workplace})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    # The views read the people again: counted now.
    kinds = {(await watcher.receive_json())["event"]["kind"] for _ in range(2)}
    assert kinds == {"settings", "people"}
    await client.send_json_auto_id({"type": "domotwin/people/get"})
    assert (await client.receive_json())["result"]["counted"] is True
    kitchen = _state(hass, KITCHEN_PEOPLE)
    assert kitchen.state == "1"
    assert "people" not in kitchen.attributes
    answer = await hass.services.async_call(
        DOMAIN, "where", {"name": "alex"}, blocking=True, return_response=True
    )
    assert answer == {
        "people": [],
        "text": "This is a workplace: I count people, I do not say where anyone is. "
        "People here: 1.",
    }
    # Nobody's room is shown either.
    shown: list[dict[str, Any]] = []
    stop = async_dispatcher_connect(hass, SIGNAL_SHOW, shown.append)
    await hass.services.async_call(DOMAIN, "show", {"person": "person.alex"}, blocking=True)
    await hass.async_block_till_done()
    stop()
    assert shown == []
    # Its hours changed: still a workplace, the people not read again.
    await client.send_json_auto_id(
        {"type": "domotwin/settings/save", "settings": {**settings, "workplace": {}}}
    )
    assert (await client.receive_json())["success"]
    assert (await watcher.receive_json())["event"]["kind"] == "settings"
    # A home again: named.
    await client.send_json_auto_id({"type": "domotwin/settings/save", "settings": settings})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert _state(hass, KITCHEN_PEOPLE).attributes["people"] == ["person.alex"]
    await client.send_json_auto_id({"type": "domotwin/people/get"})
    assert "counted" not in (await client.receive_json())["result"]
    # A workplace with nobody placed and no radar: Home Assistant's people at home are counted.
    await client.send_json_auto_id({"type": "domotwin/settings/save", "settings": workplace})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/people/save", "people": {}})
    assert (await client.receive_json())["success"]
    home_now = sum(1 for state in hass.states.async_all("person") if state.state == "home")
    assert home_now > 0
    answer = await hass.services.async_call(
        DOMAIN, "where", {}, blocking=True, return_response=True
    )
    assert answer is not None
    assert str(answer["text"]).endswith(f"People here: {home_now}.")


async def test_the_upkeep_due_is_told_in_its_room(
    hass: HomeAssistant, home: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    assert _state(hass, BATHROOM_UPKEEP).state == "0"
    client = await hass_ws_client(hass)
    # Done last in July, every three months: overdue since October, whenever this runs.
    washer = {
        "installed": "2024-05-02",
        "tasks": [
            {
                "id": "filter",
                "name": "Clean the filter",
                "every": 3,
                "unit": "months",
                "last_done": "2026-07-01",
            }
        ],
    }
    await client.send_json_auto_id({"type": "domotwin/upkeep/save", "pieces": {"washer": washer}})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    upkeep = _state(hass, BATHROOM_UPKEEP)
    assert upkeep.state == "1"
    assert upkeep.attributes["tasks"][0]["piece"] == "washer"
    assert upkeep.attributes["tasks"][0]["state"] == "overdue"
    assert _state(hass, "sensor.domotwin_kitchen_upkeep_due").state == "0"


async def test_rooms_come_and_go_and_their_devices_follow_their_area(
    hass: HomeAssistant,
    home: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    devices = dr.async_get(hass)
    client = await hass_ws_client(hass)
    # The bedroom read as the office now: its device moves there.
    bindings = {**demo_bindings, "rooms": {**demo_bindings["rooms"], "bedroom": {"area": "office"}}}
    await client.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": bindings})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    bedroom = device_of(devices, (DOMAIN, f"{home.entry_id}_room_bedroom"), home.entry_id)
    assert bedroom is not None
    assert bedroom.area_id == "office"
    # Renamed, then gone from the plan: its sensors and its device go.
    renamed = {
        **demo_plan,
        "rooms": [
            {**room, "name": "Guest room"} if room["id"] == "bedroom" else room
            for room in demo_plan["rooms"]
        ],
    }
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": renamed})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    bedroom = device_of(devices, (DOMAIN, f"{home.entry_id}_room_bedroom"), home.entry_id)
    assert bedroom is not None
    assert bedroom.name == "DomoTwin · Guest room"
    smaller = {
        **demo_plan,
        "rooms": [room for room in demo_plan["rooms"] if room["id"] != "bedroom"],
        "items": [item for item in demo_plan["items"] if item.get("room") != "bedroom"],
        "doors": [door for door in demo_plan["doors"] if door.get("room") != "bedroom"],
        "windows": [window for window in demo_plan["windows"] if window.get("room") != "bedroom"],
    }
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": smaller})
    assert (await client.receive_json())["success"], "plan"
    await hass.async_block_till_done()
    assert hass.states.get("sensor.domotwin_bedroom_people") is None
    assert er.async_get(hass).async_get("sensor.domotwin_bedroom_upkeep_due") is None
    assert device_of(devices, (DOMAIN, f"{home.entry_id}_room_bedroom"), home.entry_id) is None
    assert _state(hass, KITCHEN_PEOPLE).state == "1"
    # Linked back to the bedroom while gone, then back in the plan: its device, brought back by
    # Home Assistant in the office where it was, goes to the bedroom.
    await client.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": demo_bindings})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": demo_plan})
    assert (await client.receive_json())["success"], "plan back"
    await hass.async_block_till_done()
    bedroom = device_of(devices, (DOMAIN, f"{home.entry_id}_room_bedroom"), home.entry_id)
    assert bedroom is not None
    assert bedroom.area_id == "bedroom"


async def test_a_room_s_device_goes_into_its_area_once_there_is_one(
    hass: HomeAssistant, home: MockConfigEntry
) -> None:
    devices = dr.async_get(hass)
    areas = ar.async_get(hass)

    def kitchen() -> dr.DeviceEntry:
        device = device_of(devices, (DOMAIN, f"{home.entry_id}_room_kitchen"), home.entry_id)
        assert device is not None
        return device

    # The area the kitchen is bound to deleted: its device is in none; made again, the device
    # goes into it.
    areas.async_delete("kitchen")
    await hass.async_block_till_done()
    assert kitchen().area_id is None
    areas.async_create("Kitchen")
    await hass.async_block_till_done()
    assert kitchen().area_id == "kitchen"
    # Moved by hand elsewhere, it stays there while the room keeps its area, even when the area's
    # name no longer reads as the room's.
    devices.async_update_device(kitchen().id, area_id="office")
    areas.async_update("office", name="Study")
    await hass.async_block_till_done()
    assert kitchen().area_id == "office"


async def test_a_room_s_device_goes_to_its_new_area_once_made(
    hass: HomeAssistant,
    home: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_bindings: dict[str, Any],
) -> None:
    devices = dr.async_get(hass)
    client = await hass_ws_client(hass)
    # The kitchen linked to an area not made yet: its device stays; once made, it goes there.
    bindings = {**demo_bindings, "rooms": {**demo_bindings["rooms"], "kitchen": {"area": "garage"}}}
    await client.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": bindings})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    kitchen = device_of(devices, (DOMAIN, f"{home.entry_id}_room_kitchen"), home.entry_id)
    assert kitchen is not None
    assert kitchen.area_id == "kitchen"
    ar.async_get(hass).async_create("Garage")
    await hass.async_block_till_done()
    kitchen = device_of(devices, (DOMAIN, f"{home.entry_id}_room_kitchen"), home.entry_id)
    assert kitchen is not None
    assert kitchen.area_id == "garage"
