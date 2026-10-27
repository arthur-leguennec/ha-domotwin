"""People in their rooms (D-034): rooms found, people placed, sensors, commands and voice."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
import shutil
from typing import Any, cast

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.const import PEOPLE_STORAGE_KEY
from custom_components.domotwin.people import (
    AWAY,
    Area,
    Reading,
    Room,
    RoomFinder,
    color_of,
    likeness,
    norm,
    place_of,
    rooms_of,
)
from homeassistant.auth.models import User
from homeassistant.core import Context, HomeAssistant, State
from homeassistant.helpers import area_registry as ar, entity_registry as er
from homeassistant.setup import async_setup_component

from .conftest import ROOT

BLUEPRINT = ROOT / "blueprints" / "automation" / "domotwin" / "where_by_voice.yaml"
ALEX = "sensor.domotwin_alex_room"

AREAS = [
    Area("living_room", "Living room", ("Lounge",)),
    Area("kitchen", "Kitchen"),
    Area("hallway", "Hallway"),
]


def _room(room_id: str, name: str, storey: str = "storey-1", area: str | None = None) -> Room:
    return Room(room_id, name, storey, "", area)


def _reading(entity: str, state: str, minutes_ago: int, **attributes: Any) -> Reading:
    changed = datetime(2026, 10, 25, 12, 0, tzinfo=UTC) - timedelta(minutes=minutes_ago)
    return Reading(entity, state, attributes, changed)


def test_names_are_compared_without_case_accents_or_separators() -> None:
    assert norm("Salle_de-Bain") == "salle de bain"
    assert norm("  Séjour   Été ") == "sejour ete"
    assert norm("Bureau (Alex)") == norm("bureau alex")
    assert color_of("person.alex") == color_of("person.alex")
    assert color_of("person.alex").startswith("#")


def test_rooms_read_their_binding_or_the_area_of_their_name() -> None:
    storeys: list[dict[str, Any]] = [
        {
            "id": "storey-1",
            "name": "Ground floor",
            "plan": {
                "rooms": [
                    {"id": "living", "name": "Living room"},
                    {"id": "kitchen", "name": "Kitchen"},
                    {"id": "box"},
                    "not a room",
                ]
            },
        },
        {"id": "storey-2", "name": "Up", "plan": None},
    ]
    rooms = rooms_of(storeys, {"kitchen": {"area": "hallway"}}, AREAS)
    assert rooms == [
        Room("living", "Living room", "storey-1", "Ground floor", "living_room"),
        Room("kitchen", "Kitchen", "storey-1", "Ground floor", "hallway"),
        Room("box", "box", "storey-1", "Ground floor", None),
    ]


def test_a_state_names_a_room_by_area_or_name_never_by_guess() -> None:
    rooms = [
        _room("living", "Living room", area="living_room"),
        _room("kitchen", "Kitchen", area="kitchen"),
        _room("bath-0", "Bathroom"),
        _room("bath-1", "Bathroom", storey="storey-2"),
        _room("office", "Office"),
    ]
    finder = RoomFinder(rooms, AREAS)
    # Bermuda's area id wins over what the state says, unless it says nowhere.
    assert finder.find("Somewhere", {"area_id": "kitchen"}) == rooms[1]
    assert finder.find("unknown", {"area_id": "kitchen"}) is None
    assert finder.find("not_home", {"area_id": "kitchen"}) is None
    # An area by its name, its id or an alias.
    assert finder.find("living room") == rooms[0]
    assert finder.find("living_room") == rooms[0]
    assert finder.find("LOUNGE") == rooms[0]
    # A room by its name, when only one room has it.
    assert finder.find("office") == rooms[4]
    assert finder.find("Bathroom") is None
    # Nowhere.
    for nowhere in ("unknown", "unavailable", "not_home", "away", "", "home"):
        assert finder.find(nowhere) is None
    assert finder.find("garage") is None
    assert finder.room("kitchen") == rooms[1]


def test_a_person_is_placed_by_the_source_that_changed_last() -> None:
    finder = RoomFinder(
        [_room("living", "Living room", area="living_room"), _room("kitchen", "Kitchen")], AREAS
    )
    phone = _reading("sensor.phone_area", "Living room", 120)
    watch = _reading("sensor.watch_area", "Kitchen", 2)
    lost = _reading("sensor.tag_area", "unknown", 0)
    place = place_of("home", [phone, watch, lost], finder)
    assert place.home
    assert place.room is not None
    assert place.room.id == "kitchen"
    assert place.source == "sensor.watch_area"
    assert place.since == watch.changed
    # At home, no source can tell: somewhere at home.
    assert place_of("home", [lost], finder) == place_of("home", [], finder)
    assert place_of("home", [lost], finder).room is None
    # Away (a zone, not_home), whatever the sources still say.
    assert place_of("Work", [watch], finder) == AWAY
    assert place_of("not_home", [watch], finder) == AWAY
    assert place_of(None, [watch], finder) == AWAY


def test_names_said_are_forgiven() -> None:
    names = ["Samantha Doe", "sam_doe"]
    assert likeness("Samantha Doe", names) == 0
    assert likeness("samantha's", names) == 1
    assert likeness("James'", ["James"]) == 0
    assert likeness("Samanta", names) == 2
    assert likeness("Sam", names) == 1  # the first word of `sam_doe`
    assert likeness("Kim", names) is None
    assert likeness("Alix", ["Alex"]) is None  # too short to forgive a letter
    assert likeness("", names) is None


@pytest.fixture
async def home(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    hass_read_only_user: User,
) -> MockConfigEntry:
    """The demo apartment, its areas, Alex (the read-only user) and Sam, both at home."""
    areas = ar.async_get(hass)
    for name in ("Living room", "Kitchen", "Bathroom", "Hallway", "Bedroom"):
        areas.async_create(name)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": demo_plan})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "domotwin/bindings/save", "bindings": demo_bindings})
    assert (await client.receive_json())["success"]
    hass.states.async_set(
        "person.alex", "home", {"friendly_name": "Alex", "user_id": hass_read_only_user.id}
    )
    hass.states.async_set("person.sam", "home", {"friendly_name": "Samantha"})
    hass.states.async_set("sensor.alex_phone_area", "Kitchen")
    hass.states.async_set("sensor.sam_watch_area", "unknown")
    return setup_integration


async def _save_people(client: Any, people: dict[str, Any], **extra: Any) -> dict[str, Any]:
    await client.send_json_auto_id({"type": "domotwin/people/save", "people": people, **extra})
    answer: dict[str, Any] = await client.receive_json()
    return answer


def _state(hass: HomeAssistant, entity: str) -> State:
    state = hass.states.get(entity)
    assert state is not None, entity
    return state


async def test_each_person_gets_a_sensor_of_their_room(
    hass: HomeAssistant, home: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    answer = await _save_people(
        client,
        {
            "person.alex": {"sources": ["sensor.alex_phone_area"]},
            "person.sam": {"sources": ["sensor.sam_watch_area"], "color": "#AA3366"},
        },
    )
    assert answer["success"], answer
    await hass.async_block_till_done()
    alex = _state(hass, ALEX)
    assert alex.state == "Kitchen"
    assert alex.attributes["room_id"] == "kitchen"
    assert alex.attributes["area_id"] == "kitchen"
    assert alex.attributes["source"] == "sensor.alex_phone_area"
    assert alex.attributes["person"] == "person.alex"
    assert alex.name == "DomoTwin Alex room"
    # Sam is home, nobody can tell where.
    assert _state(hass, "sensor.domotwin_sam_room").state == "unknown"

    # Alex walks into the hall (the area's name, as Bermuda says it); then leaves home.
    hass.states.async_set("sensor.alex_phone_area", "Hallway")
    await hass.async_block_till_done()
    assert _state(hass, ALEX).attributes["room_id"] == "hall"
    hass.states.async_set("person.alex", "not_home", {"friendly_name": "Alex"})
    await hass.async_block_till_done()
    assert _state(hass, ALEX).state == "not_home"
    assert "room_id" not in _state(hass, ALEX).attributes

    # Sam is no longer placed: their sensor goes.
    assert (await _save_people(client, {"person.alex": {"sources": ["sensor.alex_phone_area"]}}))[
        "success"
    ]
    await hass.async_block_till_done()
    assert hass.states.get("sensor.domotwin_sam_room") is None
    assert er.async_get(hass).async_get("sensor.domotwin_sam_room") is None


async def test_the_settings_are_kept_apart_and_checked(
    hass: HomeAssistant,
    home: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    hass_storage: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    for people, extra in (
        ({"light.kitchen": {"sources": []}}, {}),
        ({"person.alex": {"sources": ["not an entity"]}}, {}),
        ({"person.alex": {"sources": [f"sensor.s{i}" for i in range(11)]}}, {}),
        ({"person.alex": {"color": "red"}}, {}),
        ({"person.alex": {"sources": [], "icon": "x"}}, {}),
        ({}, {"shown": "nobody"}),
        ({}, {"look": "ghost"}),
    ):
        answer = await _save_people(client, people, **extra)
        assert answer["error"]["code"] == "invalid_people", (people, extra)
    answer = await _save_people(
        client,
        {"person.alex": {"sources": ["sensor.alex_phone_area", "sensor.alex_phone_area"]}},
        shown="admins",
        look="pin",
    )
    assert answer["success"]
    stored = hass_storage[PEOPLE_STORAGE_KEY]["data"]
    assert stored["people"] == {"person.alex": {"sources": ["sensor.alex_phone_area"]}}
    assert (stored["shown"], stored["look"], stored["revision"]) == ("admins", "pin", 1)

    # Everyone reads them, with each person's colour and sensor; administrators who ask, the
    # candidates.
    await client.send_json_auto_id({"type": "domotwin/people/get"})
    got = (await client.receive_json())["result"]
    assert got["people"]["person.alex"]["sensor"] == ALEX
    assert got["people"]["person.alex"]["color"] == color_of("person.alex")
    assert "candidates" not in got
    await client.send_json_auto_id({"type": "domotwin/people/get", "candidates": True})
    got = (await client.receive_json())["result"]
    assert {"entity": "sensor.alex_phone_area"} in got["candidates"]
    user = await hass_ws_client(hass, hass_read_only_access_token)
    await user.send_json_auto_id({"type": "domotwin/people/get", "candidates": True})
    seen = (await user.receive_json())["result"]
    assert "candidates" not in seen
    assert seen["shown"] == "admins"
    answer = await _save_people(user, {})
    assert answer["error"]["code"] == "unauthorized"


async def test_people_hide_themselves(
    hass: HomeAssistant,
    home: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
) -> None:
    admin = await hass_ws_client(hass)
    assert (
        await _save_people(admin, {"person.alex": {"sources": []}, "person.sam": {"sources": []}})
    )["success"]
    alex = await hass_ws_client(hass, hass_read_only_access_token)
    await alex.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.alex", "hidden": True}
    )
    assert (await alex.receive_json())["success"]
    # Not someone else.
    await alex.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.sam", "hidden": True}
    )
    assert (await alex.receive_json())["error"]["code"] == "unauthorized"
    await admin.send_json_auto_id({"type": "domotwin/people/get"})
    assert (await admin.receive_json())["result"]["hidden"] == ["person.alex"]
    # An administrator shows them again; a person not placed cannot be hidden.
    await admin.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.alex", "hidden": False}
    )
    assert (await admin.receive_json())["success"]
    await admin.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.kim", "hidden": True}
    )
    assert (await admin.receive_json())["error"]["code"] == "unknown_person"
    # Hidden people no longer placed are forgotten.
    await alex.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.alex", "hidden": True}
    )
    assert (await alex.receive_json())["success"]
    assert (await _save_people(admin, {"person.sam": {"sources": []}}))["success"]
    await admin.send_json_auto_id({"type": "domotwin/people/get"})
    assert (await admin.receive_json())["result"]["hidden"] == []


async def _where(hass: HomeAssistant, **data: Any) -> dict[str, Any]:
    answer = await hass.services.async_call(
        "domotwin", "where", data, blocking=True, return_response=True
    )
    return cast("dict[str, Any]", answer)


async def test_where_answers_and_shows(
    hass: HomeAssistant, home: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    admin = await hass_ws_client(hass)
    assert (
        await _save_people(
            admin,
            {
                "person.alex": {"sources": ["sensor.alex_phone_area"]},
                "person.sam": {"sources": ["sensor.sam_watch_area"]},
            },
        )
    )["success"]
    screen = await hass_ws_client(hass)
    await screen.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await screen.receive_json())["success"]

    alex = await _where(hass, name="alex", show=True, screen="hallway")
    assert alex["text"] == "Alex is in the Kitchen."
    assert alex["people"][0]["room_id"] == "kitchen"
    event = await screen.receive_json()
    assert event["event"] == {"kind": "show", "show": {"room": "kitchen", "screen": "hallway"}}
    # A letter off, the first name of the name Home Assistant shows.
    assert (await _where(hass, name="Samanta"))["text"] == (
        "Samantha is home, in a room I cannot tell."
    )
    assert (await _where(hass, name="Kim"))["text"] == "I do not know who Kim is."
    assert (await _where(hass))["text"] == (
        "Alex is in the Kitchen, Samantha is home, in a room I cannot tell."
    )
    hass.states.async_set("sensor.sam_watch_area", "Living room")
    await hass.async_block_till_done()
    assert (await _where(hass))["text"] == "Alex is in the Kitchen, Samantha in the Living room."

    # `domotwin.show` shows a person's room; nothing for someone away.
    await hass.services.async_call("domotwin", "show", {"person": "person.sam"}, blocking=True)
    event = await screen.receive_json()
    assert event["event"]["show"] == {"room": "living"}
    hass.states.async_set("person.sam", "not_home", {"friendly_name": "Samantha"})
    hass.states.async_set("person.alex", "Work", {"friendly_name": "Alex"})
    await hass.async_block_till_done()
    await hass.services.async_call("domotwin", "show", {"person": "person.sam"}, blocking=True)
    assert (await _where(hass, name="sam"))["text"] == "Samantha is not home."
    assert (await _where(hass))["text"] == "Nobody is home."
    # In French when Home Assistant speaks French.
    hass.config.language = "fr"
    assert (await _where(hass, name="alex"))["text"] == "Alex n'est pas à la maison."
    hass.config.language = "en"
    # Someone hidden is not told about, nor shown.
    hass.states.async_set("person.sam", "home", {"friendly_name": "Samantha"})
    await hass.async_block_till_done()
    await admin.send_json_auto_id(
        {"type": "domotwin/people/hide", "person": "person.sam", "hidden": True}
    )
    assert (await admin.receive_json())["success"]
    assert (await _where(hass, name="sam"))["text"] == "I cannot tell where Samantha is."
    assert (await _where(hass))["text"] == "Nobody is home."
    await hass.services.async_call("domotwin", "show", {"person": "person.sam"}, blocking=True)


async def test_the_voice_blueprint_says_where_someone_is(
    hass: HomeAssistant,
    home: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    config_dir: Path,
) -> None:
    """Imported as is, "where is Alex" answers with Alex's room and shows it."""
    target = config_dir / "blueprints" / "automation" / "domotwin"
    target.mkdir(parents=True)
    shutil.copy(BLUEPRINT, target / BLUEPRINT.name)
    # Set up before a client starts the web server: Assist's intents add their views to it.
    assert await async_setup_component(hass, "homeassistant", {})
    assert await async_setup_component(hass, "conversation", {})
    assert await async_setup_component(
        hass,
        "automation",
        {"automation": {"use_blueprint": {"path": "domotwin/where_by_voice.yaml", "input": {}}}},
    )
    await hass.async_block_till_done()
    admin = await hass_ws_client(hass)
    assert (await _save_people(admin, {"person.alex": {"sources": ["sensor.alex_phone_area"]}}))[
        "success"
    ]
    screen = await hass_ws_client(hass)
    await screen.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await screen.receive_json())["success"]

    async def ask(text: str) -> str:
        answer = await hass.services.async_call(
            "conversation",
            "process",
            {"text": text, "language": "en"},
            blocking=True,
            return_response=True,
        )
        return str(cast("Any", answer)["response"]["speech"]["plain"]["speech"])

    assert await ask("where is Alex") == "Alex is in the Kitchen."
    assert (await screen.receive_json())["event"]["show"] == {"room": "kitchen"}
    assert await ask("who is home") == "Alex is in the Kitchen."


async def test_the_settings_survive_a_restart(
    hass: HomeAssistant, home: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    assert (await _save_people(client, {"person.alex": {"sources": ["sensor.alex_phone_area"]}}))[
        "success"
    ]
    assert await hass.config_entries.async_reload(home.entry_id)
    await hass.async_block_till_done()
    assert _state(hass, ALEX).state == "Kitchen"
    # A plan saved again re-reads the rooms: a renamed room is named anew.
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/plan/get"})
    plan = (await client.receive_json())["result"]["plan"]
    for room in plan["rooms"]:
        if room["id"] == "kitchen":
            room["name"] = "Cooking"
    await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": plan})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert _state(hass, ALEX).state == "Cooking"


async def test_shown_to_administrators_only_is_not_told_to_others(
    hass: HomeAssistant,
    home: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: User,
    hass_admin_user: User,
    hass_read_only_access_token: str,
) -> None:
    admin = await hass_ws_client(hass)
    assert (
        await _save_people(
            admin, {"person.alex": {"sources": ["sensor.alex_phone_area"]}}, shown="admins"
        )
    )["success"]
    asked = await hass.services.async_call(
        "domotwin",
        "where",
        {"name": "alex"},
        blocking=True,
        return_response=True,
        context=Context(user_id=hass_read_only_user.id),
    )
    assert cast("dict[str, Any]", asked)["text"] == "I cannot tell where Alex is."
    # Nor an automation (a voice question runs as one, whoever asks); administrators are told.
    assert (await _where(hass, name="alex"))["text"] == "I cannot tell where Alex is."
    told = await hass.services.async_call(
        "domotwin",
        "where",
        {"name": "alex"},
        blocking=True,
        return_response=True,
        context=Context(user_id=hass_admin_user.id),
    )
    assert cast("dict[str, Any]", told)["text"] == "Alex is in the Kitchen."
    # Others learn nobody from the settings either.
    user = await hass_ws_client(hass, hass_read_only_access_token)
    await user.send_json_auto_id({"type": "domotwin/people/get"})
    assert (await user.receive_json())["result"]["people"] == {}


async def test_sources_follow_renames_and_never_are_domotwin_own(
    hass: HomeAssistant, home: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    registry = er.async_get(hass)
    entry = registry.async_get_or_create(
        "sensor", "bermuda", "alex-phone", suggested_object_id="alex_phone_area"
    )
    hass.states.async_set(entry.entity_id, "Kitchen")
    client = await hass_ws_client(hass)
    answer = await _save_people(
        client, {"person.alex": {"sources": [entry.entity_id, "sensor.domotwin_sam_room"]}}
    )
    assert answer["success"]
    await hass.async_block_till_done()
    assert _state(hass, ALEX).state == "Kitchen"
    # Renamed in Home Assistant: the source follows.
    registry.async_update_entity(entry.entity_id, new_entity_id="sensor.alex_phone_room")
    await hass.async_block_till_done()
    hass.states.async_set("sensor.alex_phone_room", "Hallway")
    await hass.async_block_till_done()
    assert _state(hass, ALEX).attributes["room_id"] == "hall"
    await client.send_json_auto_id({"type": "domotwin/people/get", "candidates": True})
    got = (await client.receive_json())["result"]
    assert got["people"]["person.alex"]["sources"][0] == "sensor.alex_phone_room"
    # DomoTwin's own room sensors are never offered, nor read.
    assert not any(c["entity"].startswith("sensor.domotwin_") for c in got["candidates"])
    # Saved meanwhile elsewhere: the revision tells.
    answer = await _save_people(client, {}, expected_revision=0)
    assert answer["error"]["code"] == "revision_conflict"


async def _ask(hass: HomeAssistant, user: User | None, **data: Any) -> dict[str, Any]:
    answer = await hass.services.async_call(
        "domotwin",
        "where",
        data,
        blocking=True,
        return_response=True,
        context=Context(user_id=user.id if user else None),
    )
    return cast("dict[str, Any]", answer)


async def test_a_private_room_is_not_told_nor_shown(
    hass: HomeAssistant,
    home: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: User,
    hass_admin_user: User,
) -> None:
    admin = await hass_ws_client(hass)
    assert (
        await _save_people(
            admin,
            {
                "person.alex": {"sources": ["sensor.alex_phone_area"]},
                "person.sam": {"sources": ["sensor.sam_watch_area"]},
            },
        )
    )["success"]
    hass.states.async_set("sensor.sam_watch_area", "Living room")
    # The kitchen kept for Alex (D-039).
    await admin.send_json_auto_id(
        {
            "type": "domotwin/settings/save",
            "settings": {"rooms": {"kitchen": {"people": ["person.alex"]}}},
        }
    )
    assert (await admin.receive_json())["success"]
    await hass.async_block_till_done()
    screen = await hass_ws_client(hass)
    await screen.send_json_auto_id({"type": "domotwin/subscribe"})
    assert (await screen.receive_json())["success"]

    # Asked by nobody's voice, or by an administrator who is not Alex: in a private room, which
    # is neither said nor shown.
    for user in (None, hass_admin_user):
        alex = await _ask(hass, user, name="alex", show=True)
        assert alex["text"] == "Alex is in a private room."
        assert alex["people"] == [
            {"person": "person.alex", "name": "Alex", "home": True, "private": True}
        ]
    assert (await _ask(hass, None))["text"] == (
        "Alex is in a private room, Samantha in the Living room."
    )
    await hass.services.async_call("domotwin", "show", {"person": "person.alex"}, blocking=True)
    await hass.services.async_call("domotwin", "show", {"person": "person.sam"}, blocking=True)
    # The first show request to come is Sam's: Alex's room was not shown.
    assert (await screen.receive_json())["event"]["show"] == {"room": "living"}
    # Alex (their user) is told.
    told = await _ask(hass, hass_read_only_user, name="alex")
    assert told["text"] == "Alex is in the Kitchen."
    # In French.
    hass.config.language = "fr"
    assert (await _ask(hass, None, name="alex"))["text"] == "Alex est dans une pièce privée."
    hass.config.language = "en"

    # Private only while guests are here: open while the switch is off, private when it is on
    # or cannot be read.
    await admin.send_json_auto_id(
        {
            "type": "domotwin/settings/save",
            "settings": {"rooms": {"kitchen": {"people": [], "while": "input_boolean.guests"}}},
        }
    )
    assert (await admin.receive_json())["success"]
    assert (await _ask(hass, None, name="alex"))["text"] == "Alex is in a private room."
    hass.states.async_set("input_boolean.guests", "off")
    assert (await _ask(hass, None, name="alex"))["text"] == "Alex is in the Kitchen."
    hass.states.async_set("input_boolean.guests", "on")
    assert (await _ask(hass, hass_read_only_user, name="alex"))["text"] == (
        "Alex is in a private room."
    )
