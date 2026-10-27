"""Guest access (D-067): passes that open chosen rooms and devices, through DomoTwin's own page."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from http import HTTPStatus
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import (
    ClientSessionGenerator,
    WebSocketGenerator,
)

from custom_components.domotwin.const import (
    EVENT_GUEST_ACTION,
    GUESTS_STORAGE_KEY,
    MAX_GUEST_CALLS,
    MAX_GUEST_STREAMS,
)
from custom_components.domotwin.data import GUESTS_KEY
from custom_components.domotwin.diagnostics import async_get_config_entry_diagnostics
from custom_components.domotwin.guests import _put, guest_call
from custom_components.domotwin.logbook import async_describe_events
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er
from homeassistant.util import dt as dt_util

from .conftest import ROOT

STOOL = (ROOT / "examples" / "models" / "stool.glb").read_bytes()
# Before the tests run: the access tokens of their websockets, made now, last half an hour.
NOW = datetime(2026, 1, 15, 9, 0, tzinfo=dt_util.UTC)

# The fictional demo apartment's devices: the guest's, and the others'.
GUESTS_LIGHT = "light.living_room_pendant"
GUESTS_SENSOR = "sensor.living_room_temperature"
OTHERS_LIGHT = "light.bedside_left"
OTHERS_LOCK = "lock.entrance_door"
SECRET = "tea-and-cake"  # noqa: S105 (a fictional network's)


async def _send(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


def _pass(**change: Any) -> dict[str, Any]:
    return {
        "name": "Sam and Lee",
        "rooms": ["living", "kitchen"],
        "entities": [GUESTS_LIGHT, GUESTS_SENSOR],
        "starts": (NOW - timedelta(hours=1)).isoformat(),
        "ends": (NOW + timedelta(days=2)).isoformat(),
        **change,
    }


@pytest.fixture
def at_now(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> FrozenDateTimeFactory:
    """`NOW`, before DomoTwin starts."""
    freezer.move_to(NOW)
    return freezer


@pytest.fixture
async def home(
    at_now: FrozenDateTimeFactory,
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> Any:
    """The demo apartment with its links and devices, at `NOW`; an administrator's websocket."""
    admin = await hass_ws_client(hass)
    # A piece drawn from a 3D file in the living room, and one in the bedroom.
    plan = json.loads(json.dumps(demo_plan))
    stool = {"format": "glb", "hash": "a" * 64, "bytes": len(STOOL), "up": "y"}
    chair = {"format": "glb", "hash": "b" * 64, "bytes": len(STOOL), "up": "y"}
    plan["models"] = {
        "stool": {"name": "Stool", "size": [38, 38, 71], "file": stool},
        "chair": {"name": "Chair", "size": [38, 38, 71], "file": chair},
    }
    for item in plan["items"]:
        if item["id"] == "sofa":
            item["model"] = "stool"
        if item["id"] == "dresser":
            item["model"] = "chair"
    plan["views"] = [{"id": "corner", "name": "Corner", "eye": [0, 0, 100], "target": [1, 1, 0]}]
    assert (await _send(admin, {"type": "domotwin/plan/save", "plan": plan}))["success"]
    message = {"type": "domotwin/bindings/save", "bindings": demo_bindings}
    assert (await _send(admin, message))["success"]
    area = ar.async_get(hass).async_create("Living room")
    entry = er.async_get(hass).async_get_or_create("sensor", "demo", "living_temperature")
    er.async_get(hass).async_update_entity(entry.entity_id, area_id=area.id)
    hass.states.async_set(entry.entity_id, "21.5", {"unit_of_measurement": "°C"})
    hass.states.async_set(GUESTS_LIGHT, "off", {"friendly_name": "Pendant"})
    hass.states.async_set(OTHERS_LIGHT, "on", {"friendly_name": "Bedside"})
    hass.states.async_set(OTHERS_LOCK, "locked")
    await hass.async_block_till_done()
    return {"admin": admin, "sensor": entry.entity_id}


async def test_passes_are_made_by_administrators_and_kept_apart(
    home: Any,
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    hass_storage: dict[str, Any],
) -> None:
    admin = home["admin"]
    user = await hass_ws_client(hass, hass_read_only_access_token)
    sensor = home["sensor"]
    # Nobody else reads, makes or removes one: its link is its secret.
    for message in (
        {"type": "domotwin/guests/get"},
        {"type": "domotwin/guests/save", "pass": _pass(entities=[sensor])},
        {"type": "domotwin/guests/remove", "pass": "x"},
    ):
        assert (await _send(user, message))["error"]["code"] == "unauthorized"
    answer = await _send(admin, {"type": "domotwin/guests/save", "pass": _pass(entities=[sensor])})
    made = answer["result"]
    assert made["name"] == "Sam and Lee"
    assert made["rooms"] == ["living", "kitchen"]
    assert made["status"] == "open"
    assert made["act"] is True
    assert made["wifi"] is True
    assert made["anywhere"] is False
    token = made["path"].rsplit("/", 1)[1]
    assert made["path"] == f"/api/domotwin/guest/{token}"
    assert len(token) >= 43
    assert "token" not in made
    # Changed, it keeps its link; renewed, it gets another and the old one stops.
    change = _pass(id=made["id"], name="Sam", entities=[sensor])
    changed = (await _send(admin, {"type": "domotwin/guests/save", "pass": change}))["result"]
    assert changed["path"] == made["path"]
    assert changed["name"] == "Sam"
    change["renew"] = True
    renewed = (await _send(admin, {"type": "domotwin/guests/save", "pass": change}))["result"]
    assert renewed["path"] != made["path"]
    listed = (await _send(admin, {"type": "domotwin/guests/get"}))["result"]["passes"]
    assert [p["id"] for p in listed] == [made["id"]]
    # In a private store of its own, never in DomoTwin's data or the diagnostics.
    await hass.async_block_till_done()
    secret = renewed["path"].rsplit("/", 1)[1]
    assert hass_storage[GUESTS_STORAGE_KEY]["data"]["passes"][0]["token"] == secret
    others = json.dumps({k: v for k, v in hass_storage.items() if k != GUESTS_STORAGE_KEY})
    assert secret not in others
    diagnostics = json.dumps(await async_get_config_entry_diagnostics(hass, setup_integration))
    assert secret not in diagnostics
    assert "Sam" not in diagnostics
    assert json.loads(diagnostics)["guests"] == {
        "upcoming": 0,
        "open": 1,
        "ended": 0,
        "anywhere": 0,
    }
    # Removed: gone.
    answer = await _send(admin, {"type": "domotwin/guests/remove", "pass": made["id"]})
    assert answer["result"] == {"removed": True}
    assert (await _send(admin, {"type": "domotwin/guests/get"}))["result"]["passes"] == []


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"ends": (NOW - timedelta(hours=2)).isoformat()}, "ends_before"),
        (
            {
                "starts": (NOW - timedelta(days=3)).isoformat(),
                "ends": (NOW - timedelta(days=1)).isoformat(),
            },
            "already_ended",
        ),
        ({"ends": (NOW + timedelta(days=40)).isoformat()}, "too_long"),
        (
            {
                "starts": (NOW + timedelta(days=400)).isoformat(),
                "ends": (NOW + timedelta(days=401)).isoformat(),
            },
            "too_far",
        ),
        ({"rooms": ["attic"]}, "unknown_room"),
        ({"entities": ["person.alex"]}, "not_for_guests"),
        ({"entities": ["camera.living_room"]}, "not_for_guests"),
        ({"entities": ["alarm_control_panel.home"]}, "not_for_guests"),
        ({"rooms": [], "entities": []}, "nothing_open"),
        ({"id": "nobody"}, "unknown_pass"),
        ({"name": " "}, "invalid"),
        ({"starts": "tomorrow"}, "invalid"),
    ],
)
async def test_a_pass_that_cannot_be_made(home: Any, change: dict[str, Any], code: str) -> None:
    answer = await _send(home["admin"], {"type": "domotwin/guests/save", "pass": _pass(**change)})
    assert answer["error"]["code"] == code


async def test_at_most_so_many_passes(home: Any) -> None:
    admin = home["admin"]
    for _ in range(20):
        assert (await _send(admin, {"type": "domotwin/guests/save", "pass": _pass()}))["success"]
    answer = await _send(admin, {"type": "domotwin/guests/save", "pass": _pass()})
    assert answer["error"]["code"] == "too_many"


def _keep_models(folder: Path) -> None:
    """The 3D files of the stool (in the living room) and the chair (in the bedroom)."""
    folder.mkdir(parents=True)
    (folder / f"{'a' * 64}.glb").write_bytes(STOOL)
    (folder / f"{'b' * 64}.glb").write_bytes(STOOL)


async def _made(home: Any, **change: Any) -> str:
    answer = await _send(home["admin"], {"type": "domotwin/guests/save", "pass": _pass(**change)})
    path: str = answer["result"]["path"]
    return path


async def test_the_page_opens_the_chosen_rooms_and_devices_only(
    hass: HomeAssistant,
    home: Any,
    hass_client_no_auth: ClientSessionGenerator,
    frontend_built: Path,
) -> None:
    sensor = home["sensor"]
    (frontend_built / "guest.html").write_text("<!doctype html><title>Guest</title>", "utf-8")
    message = {
        "type": "domotwin/wifi/save",
        "wifi": {"name": "Fictional Guests", "password": SECRET, "security": "WPA"},
    }
    assert (await _send(home["admin"], message))["success"]
    path = await _made(home, entities=[GUESTS_LIGHT, sensor, OTHERS_LOCK])
    client = await hass_client_no_auth()
    # The page: DomoTwin's own, never kept, and loading nothing from elsewhere.
    response = await client.get(path)
    assert response.status == HTTPStatus.OK
    assert "Guest" in await response.text()
    assert response.headers["Cache-Control"] == "no-store"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert "script-src 'self' 'wasm-unsafe-eval'" in response.headers["Content-Security-Policy"]
    # The home, as the pass shows it.
    response = await client.get(f"{path}/home")
    assert response.status == HTTPStatus.OK
    assert response.headers["Cache-Control"] == "no-store"
    shown = await response.json()
    assert shown["pass"] == {
        "name": "Sam and Lee",
        "starts": (NOW - timedelta(hours=1)).isoformat(),
        "ends": (NOW + timedelta(days=2)).isoformat(),
        "act": True,
        "entities": [GUESTS_LIGHT, sensor, OTHERS_LOCK],
    }
    (storey,) = shown["storeys"]
    plan = storey["plan"]
    names = {room["id"]: room["name"] for room in plan["rooms"]}
    # Every room's walls stay; only those it opens keep their names.
    assert names == {
        "living": "Living room",
        "kitchen": "Kitchen",
        "bathroom": "",
        "hall": "",
        "bedroom": "",
    }
    assert plan["name"] == hass.config.location_name
    assert "views" not in plan
    pieces = {item["id"] for item in plan["items"]}
    assert {"sofa", "tv", "fridge"} <= pieces
    assert not pieces & {"bed", "dresser", "toilet", "shoe-cabinet"}
    # Only the 3D files of the pieces it shows.
    assert list(plan["models"]) == ["stool"]
    assert {d["id"]: d["name"] for d in plan["doors"]}["door-entrance"] == ""
    # The other rooms are closed, for nobody.
    assert shown["settings"]["rooms"] == {
        "bathroom": {"people": []},
        "bedroom": {"people": []},
        "hall": {"people": []},
    }
    # The links of its devices only, in the rooms it opens: not the lock of the hall's door.
    bindings = shown["bindings"]
    assert set(bindings["rooms"]) == {"living", "kitchen"}
    assert bindings["elements"] == {
        "pendant-living": {
            "entities": [{"entity_id": GUESTS_LIGHT}],
            "tap_action": {"action": "toggle"},
            "hold_action": {"action": "controls"},
        }
    }
    # The states of its devices only (the lock too, given outside the rooms it opens: listed, not
    # on the plan), without who changed them.
    assert set(shown["states"]) == {GUESTS_LIGHT, sensor, OTHERS_LOCK}
    assert "context" not in shown["states"][GUESTS_LIGHT]
    assert OTHERS_LIGHT not in json.dumps(shown)
    assert shown["entities"][sensor]["area_id"] == "living_room"
    assert shown["areas"]["living_room"] == {"area_id": "living_room", "name": "Living room"}
    # The Wi-Fi, since it shows it; never the screens that show it.
    assert shown["wifi"]["name"] == "Fictional Guests"
    assert shown["wifi"]["password"] == SECRET
    assert "screens" not in shown["wifi"]
    # Its 3D files, not the others'.
    await hass.async_add_executor_job(_keep_models, Path(hass.config.path("domotwin", "models")))
    response = await client.get(f"{path}/models/{'a' * 64}.glb")
    assert response.status == HTTPStatus.OK
    assert await response.read() == STOOL
    response = await client.get(f"{path}/models/{'b' * 64}.glb")
    assert response.status == HTTPStatus.NOT_FOUND


async def test_a_pass_without_the_wifi_or_only_to_look(
    home: Any, hass_client_no_auth: ClientSessionGenerator
) -> None:
    message = {
        "type": "domotwin/wifi/save",
        "wifi": {"name": "Fictional Guests", "password": SECRET, "security": "WPA"},
    }
    assert (await _send(home["admin"], message))["success"]
    path = await _made(home, wifi=False, act=False)
    client = await hass_client_no_auth()
    shown = await (await client.get(f"{path}/home")).json()
    assert shown["wifi"] is None
    assert SECRET not in json.dumps(shown)
    assert shown["pass"]["act"] is False
    call = {"domain": "light", "service": "toggle", "target": {"entity_id": GUESTS_LIGHT}}
    response = await client.post(f"{path}/call", json=call)
    assert response.status == HTTPStatus.FORBIDDEN
    assert (await response.json())["code"] == "look_only"


async def test_only_on_the_home_s_network_unless_from_anywhere(
    home: Any, hass_client_no_auth: ClientSessionGenerator
) -> None:
    path = await _made(home)
    anywhere = await _made(home, anywhere=True)
    client = await hass_client_no_auth()
    with patch("custom_components.domotwin.guests.is_local", return_value=False):
        response = await client.get(f"{path}/home")
        assert response.status == HTTPStatus.FORBIDDEN
        assert (await response.json()) == {"code": "home_only"}
        assert (await client.get(f"{anywhere}/home")).status == HTTPStatus.OK
    # Through Home Assistant Cloud: from outside, whatever the address.
    with patch("custom_components.domotwin.guests.is_cloud_connection", return_value=True):
        assert (await client.get(f"{path}/home")).status == HTTPStatus.FORBIDDEN
        assert (await client.get(f"{anywhere}/home")).status == HTTPStatus.OK


async def test_a_pass_opens_from_its_start_to_its_end(
    home: Any,
    hass: HomeAssistant,
    hass_client_no_auth: ClientSessionGenerator,
    at_now: FrozenDateTimeFactory,
) -> None:
    freezer = at_now
    starts = NOW + timedelta(hours=2)
    path = await _made(
        home, starts=starts.isoformat(), ends=(starts + timedelta(hours=3)).isoformat()
    )
    client = await hass_client_no_auth()
    response = await client.get(f"{path}/home")
    assert response.status == HTTPStatus.FORBIDDEN
    assert await response.json() == {"code": "not_yet", "starts": starts.isoformat()}
    freezer.move_to(starts)
    assert (await client.get(f"{path}/home")).status == HTTPStatus.OK
    freezer.move_to(starts + timedelta(hours=3))
    response = await client.get(f"{path}/home")
    assert response.status == HTTPStatus.GONE
    assert (await response.json())["code"] == "ended"
    # A link nobody has, or not even a link.
    response = await client.get(f"/api/domotwin/guest/{'x' * 43}/home")
    assert response.status == HTTPStatus.NOT_FOUND
    assert (await client.get("/api/domotwin/guest/short/home")).status == HTTPStatus.NOT_FOUND
    # Ended a month ago: forgotten when DomoTwin starts again.
    freezer.move_to(starts + timedelta(days=31))
    guests = hass.data[GUESTS_KEY]
    await guests.async_load()
    assert guests.passes == []


async def test_a_guest_acts_on_the_pass_s_devices_only(
    hass: HomeAssistant, home: Any, hass_client_no_auth: ClientSessionGenerator
) -> None:
    path = await _made(home, entities=[GUESTS_LIGHT, "cover.living_room_curtains", OTHERS_LOCK])
    toggled = async_mock_service(hass, "homeassistant", "toggle")
    lit = async_mock_service(hass, "light", "turn_on")
    locked = async_mock_service(hass, "lock", "unlock")
    events = async_capture_events(hass, EVENT_GUEST_ACTION)
    client = await hass_client_no_auth()

    async def call(body: Any) -> Any:
        return await client.post(f"{path}/call", json=body)

    response = await call(
        {"domain": "homeassistant", "service": "toggle", "target": {"entity_id": GUESTS_LIGHT}}
    )
    assert response.status == HTTPStatus.OK
    assert toggled[0].data == {"entity_id": [GUESTS_LIGHT]}
    # Told to the logbook, in the context the action ran in.
    assert events[0].data == {
        "name": "Sam and Lee",
        "entity_id": [GUESTS_LIGHT],
        "service": "homeassistant.toggle",
    }
    assert events[0].context.id == toggled[0].context.id
    assert toggled[0].context.user_id is None
    body = {
        "domain": "light",
        "service": "turn_on",
        "data": {"brightness_pct": 40, "rgb_color": [255, 0, 0]},
        "target": {"entity_id": GUESTS_LIGHT},
    }
    assert (await call(body)).status == HTTPStatus.OK
    assert lit[0].data == {
        "brightness_pct": 40,
        "rgb_color": [255, 0, 0],
        "entity_id": [GUESTS_LIGHT],
    }
    # A lock given: locked and unlocked, never with a code.
    unlock = {"domain": "lock", "service": "unlock", "target": {"entity_id": OTHERS_LOCK}}
    assert (await call(unlock)).status == HTTPStatus.OK
    assert len(locked) == 1
    response = await call({**unlock, "data": {"code": "1234"}})
    assert (await response.json())["code"] == "invalid"
    # Refused: a device it does not give, a service it does not allow, data not taken, a service
    # of another domain on its device, toggling a lock as a switch, a target other than entities.
    refused: list[tuple[Any, int]] = [
        ({"domain": "light", "service": "turn_on", "target": {"entity_id": OTHERS_LIGHT}}, 403),
        ({"domain": "light", "service": "turn_on", "target": {"entity_id": "light.x"}}, 403),
        (
            {
                "domain": "light",
                "service": "turn_on",
                "target": {"entity_id": [GUESTS_LIGHT, OTHERS_LIGHT]},
            },
            403,
        ),
        ({"domain": "light", "service": "turn_on", "target": {"area_id": "bedroom"}}, 400),
        ({"domain": "script", "service": "turn_on", "target": {"entity_id": GUESTS_LIGHT}}, 403),
        (
            {"domain": "homeassistant", "service": "turn_on", "target": {"entity_id": OTHERS_LOCK}},
            403,
        ),
        (
            {
                "domain": "homeassistant",
                "service": "restart",
                "target": {"entity_id": GUESTS_LIGHT},
            },
            403,
        ),
        (
            {
                "domain": "light",
                "service": "turn_on",
                "data": {"flash": "long"},
                "target": {"entity_id": GUESTS_LIGHT},
            },
            400,
        ),
        (
            {
                "domain": "cover",
                "service": "set_cover_position",
                "data": {"position": 150},
                "target": {"entity_id": "cover.living_room_curtains"},
            },
            400,
        ),
        ({"domain": "light", "service": "turn_on"}, 400),
        ("light.toggle", 400),
    ]
    for body, code in refused:
        response = await call(body)
        assert response.status == code, body
    assert len(lit) == 1
    response = await client.post(f"{path}/call", data=b"{" * 5000)
    assert response.status == HTTPStatus.BAD_REQUEST


async def test_home_assistant_s_refusal_said_and_too_many_actions_refused(
    hass: HomeAssistant, home: Any, hass_client_no_auth: ClientSessionGenerator
) -> None:
    path = await _made(home)
    client = await hass_client_no_auth()
    body = {"domain": "light", "service": "toggle", "target": {"entity_id": GUESTS_LIGHT}}
    # No such service in this Home Assistant.
    response = await client.post(f"{path}/call", json=body)
    assert response.status == HTTPStatus.BAD_REQUEST
    assert (await response.json())["code"] == "refused"
    async_mock_service(hass, "light", "toggle")
    for _ in range(MAX_GUEST_CALLS - 1):
        assert (await client.post(f"{path}/call", json=body)).status == HTTPStatus.OK
    response = await client.post(f"{path}/call", json=body)
    assert response.status == HTTPStatus.TOO_MANY_REQUESTS
    assert (await response.json())["code"] == "too_many_calls"


def test_what_a_guest_may_call_checked() -> None:
    guest_pass = {"act": True, "entities": ["fan.ceiling", "script.movie_night", "media_player.tv"]}
    assert guest_call(
        guest_pass,
        {
            "domain": "fan",
            "service": "set_percentage",
            "data": {"percentage": "40"},
            "target": {"entity_id": "fan.ceiling"},
        },
    ) == ("fan", "set_percentage", {"percentage": 40.0, "entity_id": ["fan.ceiling"]})
    # A script runs without variables; a media player's volume within its range.
    script = {
        "domain": "script",
        "service": "turn_on",
        "target": {"entity_id": "script.movie_night"},
    }
    assert guest_call(guest_pass, script)[2] == {"entity_id": ["script.movie_night"]}
    with pytest.raises(Exception, match="invalid"):
        guest_call(guest_pass, {**script, "data": {"variables": {"x": 1}}})
    volume = {
        "domain": "media_player",
        "service": "volume_set",
        "data": {"volume_level": 2},
        "target": {"entity_id": "media_player.tv"},
    }
    with pytest.raises(Exception, match="invalid"):
        guest_call(guest_pass, volume)
    # The entity in the data, as older dashboards send it.
    assert guest_call(
        guest_pass,
        {
            "domain": "media_player",
            "service": "media_play_pause",
            "data": {"entity_id": "media_player.tv"},
        },
    ) == ("media_player", "media_play_pause", {"entity_id": ["media_player.tv"]})


async def _read_events(response: Any, count: int) -> list[tuple[str, Any]]:
    """The next `count` events of a page following its pass."""
    events: list[tuple[str, Any]] = []
    name = ""
    while len(events) < count:
        line = (await asyncio.wait_for(response.content.readline(), 5)).decode().rstrip("\n")
        if line.startswith("event: "):
            name = line.removeprefix("event: ")
        elif line.startswith("data: "):
            events.append((name, json.loads(line.removeprefix("data: "))))
    return events


async def test_the_page_follows_its_devices_until_the_pass_changes(
    hass: HomeAssistant, home: Any, hass_client_no_auth: ClientSessionGenerator
) -> None:
    path = await _made(home)
    client = await hass_client_no_auth()
    response = await client.get(f"{path}/events")
    assert response.status == HTTPStatus.OK
    assert response.headers["Content-Type"] == "text/event-stream"
    # As they are, then as they change; nothing of the others.
    first = await _read_events(response, 1)
    assert first == [("state", first[0][1])]
    assert first[0][1]["entity_id"] == GUESTS_LIGHT
    hass.states.async_set(OTHERS_LIGHT, "off")
    hass.states.async_set(GUESTS_LIGHT, "on")
    (event,) = await _read_events(response, 1)
    assert event[0] == "state"
    assert event[1]["entity_id"] == GUESTS_LIGHT
    assert event[1]["state"] == "on"
    assert "context" not in event[1]
    # The home linked anew: the page reads it again.
    unlinked = {"version": 1, "rooms": {}, "elements": {}}
    message = {"type": "domotwin/bindings/save", "bindings": unlinked}
    assert (await _send(home["admin"], message))["success"]
    assert await _read_events(response, 1) == [("home", {})]
    # Then closed: it follows the home anew once it has read it.
    assert (await asyncio.wait_for(response.content.read(), 5)).strip() == b""


async def test_the_page_is_told_when_the_pass_ends_or_goes(
    home: Any,
    hass: HomeAssistant,
    hass_client_no_auth: ClientSessionGenerator,
    at_now: FrozenDateTimeFactory,
) -> None:
    freezer = at_now
    path = await _made(home, ends=(NOW + timedelta(seconds=1)).isoformat())
    client = await hass_client_no_auth()
    response = await client.get(f"{path}/events")
    await _read_events(response, 1)
    freezer.move_to(NOW + timedelta(seconds=2))
    events = await _read_events(response, 1)
    assert events == [("end", {"ends": (NOW + timedelta(seconds=1)).isoformat()})]
    # Removed while followed.
    freezer.move_to(NOW)
    path = await _made(home)
    response = await client.get(f"{path}/events")
    await _read_events(response, 1)
    made = (await _send(home["admin"], {"type": "domotwin/guests/get"}))["result"]["passes"][-1]
    await _send(home["admin"], {"type": "domotwin/guests/remove", "pass": made["id"]})
    assert await _read_events(response, 1) == [("home", {})]
    assert (await client.get(f"{path}/home")).status == HTTPStatus.NOT_FOUND


async def test_removed_with_domotwin(
    home: Any,
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_storage: dict[str, Any],
) -> None:
    await _made(home)
    await hass.async_block_till_done()
    assert GUESTS_STORAGE_KEY in hass_storage
    await hass.config_entries.async_remove(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert GUESTS_STORAGE_KEY not in hass_storage


def test_the_logbook_says_the_pass_s_name(hass: HomeAssistant) -> None:
    described: dict[str, Any] = {}

    def describe_event(domain: str, event: str, describe: Any) -> None:
        described[f"{domain}:{event}"] = describe

    async_describe_events(hass, describe_event)
    describe = described[f"domotwin:{EVENT_GUEST_ACTION}"]
    row = SimpleNamespace(
        data={"name": "Sam and Lee", "entity_id": [GUESTS_LIGHT], "service": "light.toggle"},
        context_id="01K8C000000000000000000001",
    )
    assert describe(row) == {
        "name": "Sam and Lee",
        "message": "asked light.toggle through a guest pass",
        "entity_id": GUESTS_LIGHT,
        "context_id": "01K8C000000000000000000001",
    }


async def test_a_page_too_slow_or_too_many_is_closed_and_reads_the_home_again(
    home: Any, hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator
) -> None:
    # A page that cannot keep up: what waited is dropped, it reads the home again, then closes.
    queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=3)
    for n in range(3):
        _put(queue, f"state {n}".encode())
    _put(queue, b"state 3")
    waiting = [queue.get_nowait() for _ in range(queue.qsize())]
    assert waiting == [b"event: home\ndata: {}\n\n", None]
    # Past eight pages of a pass, the oldest is closed (a page reloaded leaves its old one open).
    path = await _made(home)
    client = await hass_client_no_auth()
    stopping = hass.bus.async_listeners().get(EVENT_HOMEASSISTANT_STOP, 0)
    pages = [await client.get(f"{path}/events") for _ in range(MAX_GUEST_STREAMS)]
    for page in pages:
        await _read_events(page, 1)
    newest = await client.get(f"{path}/events")
    assert newest.status == HTTPStatus.OK
    await _read_events(newest, 1)
    assert (await asyncio.wait_for(pages[0].content.read(), 5)).strip() == b""
    # Each one open is closed when Home Assistant stops.
    await hass.async_block_till_done()
    listening = hass.bus.async_listeners()[EVENT_HOMEASSISTANT_STOP]
    assert listening == stopping + MAX_GUEST_STREAMS


async def test_an_action_sent_in_pieces(
    hass: HomeAssistant, home: Any, hass_client_no_auth: ClientSessionGenerator
) -> None:
    path = await _made(home)
    toggled = async_mock_service(hass, "light", "toggle")
    client = await hass_client_no_auth()
    body = json.dumps(
        {"domain": "light", "service": "toggle", "target": {"entity_id": GUESTS_LIGHT}}
    ).encode()

    async def pieces() -> AsyncIterator[bytes]:
        for start in range(0, len(body), 7):
            yield body[start : start + 7]

    response = await client.post(f"{path}/call", data=pieces())
    assert response.status == HTTPStatus.OK
    assert len(toggled) == 1

    async def too_much() -> AsyncIterator[bytes]:
        for _ in range(10):
            yield b" " * 1000

    response = await client.post(f"{path}/call", data=too_much())
    assert response.status == HTTPStatus.BAD_REQUEST
