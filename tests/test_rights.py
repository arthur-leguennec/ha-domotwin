"""Per-person rights (D-070): what DomoTwin shows each person and lets them do."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, cast

import pytest
from pytest_homeassistant_custom_component.common import (
    CLIENT_ID,
    MockConfigEntry,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.data import SCHEDULER_KEY
from custom_components.domotwin.llm import CancelScheduleTool, ListSchedulesTool, ScheduleTool
from custom_components.domotwin.rights import Viewer, levels_for, linked_rooms, viewer_of
from custom_components.domotwin.validation import InvalidPayloadError, validate_settings
from homeassistant.auth.models import User
from homeassistant.components.homeassistant.exposed_entities import async_expose_entity
from homeassistant.core import Context, HomeAssistant, State
from homeassistant.helpers import area_registry as ar, entity_registry as er, llm
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

# Kim may only look at the living room, except the floor lamp, and does not see the hall's
# spots; the bedroom is hidden from everyone but Kim.
RIGHTS: dict[str, Any] = {
    "everyone": {"rooms": {"bedroom": "hidden"}},
    "people": {
        "person.kim": {
            "rooms": {"living": "see", "bedroom": "use"},
            "entities": {
                "light.living_room_floor_lamp": "use",
                "light.hall_spots": "hidden",
            },
        }
    },
}


def test_a_level_is_the_person_s_own_else_everyone_s_else_use() -> None:
    kim = Viewer(own=RIGHTS["people"]["person.kim"], everyone=RIGHTS["everyone"])
    nobody = Viewer(own={}, everyone=RIGHTS["everyone"])
    assert kim.room("living") == "see"
    assert kim.room("bedroom") == "use"
    assert kim.room("kitchen") == "use"
    assert nobody.room("bedroom") == "hidden"
    assert nobody.room("living") == "use"
    assert kim.entity("light.hall_spots") == "hidden"
    assert kim.entity("light.kitchen_ceiling") is None
    assert kim.rooms("see") == {"living"}
    assert kim.rooms("hidden") == set()
    assert nobody.rooms("hidden") == {"bedroom"}
    assert kim.restricted
    assert not Viewer(own={"rooms": {"living": "use"}}, everyone={}).restricted


def test_a_device_is_in_the_rooms_of_what_it_is_linked_to(
    demo_plan: dict[str, Any], demo_bindings: dict[str, Any]
) -> None:
    rooms = linked_rooms([{"id": "s", "plan": demo_plan}], demo_bindings)
    assert rooms["light.living_room_pendant"] == {"living"}
    assert rooms["light.kitchen_spots"] == {"kitchen"}
    # The entrance's door is the hall's.
    assert rooms["lock.entrance_door"] == {"hall"}
    # A piece moved to another room in edit mode is in that one; one added, in the room named.
    layout = {
        "pendant-living": {"at": [0, 0], "room": "kitchen"},
        "lamp-new": {"add": {"kind": "lamp", "size": [30, 30, 60]}, "at": [0, 0], "room": "hall"},
    }
    bindings = {
        **demo_bindings,
        "elements": {
            **demo_bindings["elements"],
            "lamp-new": {"entities": [{"entity_id": "light.new"}]},
            "kitchen": {"entities": [{"entity_id": "sensor.kitchen_temperature"}]},
        },
    }
    rooms = linked_rooms([{"id": "s", "plan": demo_plan, "layout": layout}], bindings)
    assert rooms["light.living_room_pendant"] == {"kitchen"}
    assert rooms["light.new"] == {"hall"}
    # Linked to the room itself.
    assert rooms["sensor.kitchen_temperature"] == {"kitchen"}
    assert linked_rooms([{"id": "s", "plan": None}], demo_bindings) == {}


def test_the_rights_are_checked_and_kept_without_what_is_empty() -> None:
    settings = validate_settings(
        {"rights": {**RIGHTS, "people": {**RIGHTS["people"], "person.sam": {"rooms": {}}}}}
    )
    assert settings["rights"] == RIGHTS
    assert "rights" not in validate_settings({"rights": {"everyone": {}, "people": {}}})


@pytest.mark.parametrize(
    ("rights", "says"),
    [
        ([], "`rights` has `everyone` and `people`"),
        ({"admins": {}}, "`rights` has `everyone` and `people`"),
        ({"everyone": {"areas": {}}}, "has `rooms` and `entities`"),
        ({"everyone": {"rooms": []}}, "must be an object"),
        ({"everyone": {"rooms": {"living": "edit"}}}, "a level is one of use, see, hidden"),
        ({"everyone": {"entities": {"lamp": "see"}}}, "is not an entity id"),
        ({"everyone": {"rooms": {"": "see"}}}, "a room id"),
        ({"people": {"light.lamp": {}}}, "rights are set for `person` entities"),
        ({"people": []}, "must be an object"),
        ({"people": {f"person.p{k}": {} for k in range(51)}}, "at most 50 people"),
        ({"everyone": {"rooms": {f"r{k}": "see" for k in range(201)}}}, "at most 200 rooms"),
        (
            {"everyone": {"entities": {f"light.l{k}": "see" for k in range(501)}}},
            "at most 500 entities",
        ),
    ],
)
def test_a_refusal_says_what_is_wrong(rights: object, says: str) -> None:
    with pytest.raises(InvalidPayloadError, match=says):
        validate_settings({"rights": rights})


async def _user(hass: HomeAssistant, name: str) -> tuple[User, str]:
    """A user who is not an administrator, and an access token of theirs."""
    user = await hass.auth.async_create_user(name, group_ids=["system-users"])
    refresh = await hass.auth.async_create_refresh_token(user, CLIENT_ID)
    return user, hass.auth.async_create_access_token(refresh)


@pytest.fixture
async def home(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> dict[str, Any]:
    """The demo apartment and its areas, Kim and someone who is nobody's, and the rights."""
    areas = ar.async_get(hass)
    for name in ("Living room", "Kitchen", "Bathroom", "Hallway", "Bedroom"):
        areas.async_create(name)
    # A strip in the kitchen's area, linked to nothing.
    entities = er.async_get(hass)
    strip = entities.async_get_or_create("light", "test", "strip", suggested_object_id="strip")
    entities.async_update_entity(strip.entity_id, area_id="kitchen")
    kim, kim_token = await _user(hass, "Kim")
    robin, robin_token = await _user(hass, "Robin")
    hass.states.async_set("person.kim", "home", {"friendly_name": "Kim", "user_id": kim.id})
    hass.states.async_set("person.alex", "home", {"friendly_name": "Alex"})
    hass.states.async_set("sensor.alex_area", "Bedroom")
    for entity in (
        "light.living_room_pendant",
        "light.living_room_floor_lamp",
        "light.hall_spots",
        "light.bedside_left",
        "light.kitchen_ceiling",
        "light.strip",
        "cover.living_room_curtains",
    ):
        hass.states.async_set(entity, "off")
    client = await hass_ws_client(hass)
    for message in (
        {"type": "domotwin/plan/save", "plan": demo_plan},
        {"type": "domotwin/bindings/save", "bindings": demo_bindings},
        {"type": "domotwin/settings/save", "settings": {"rights": RIGHTS}},
        {
            "type": "domotwin/people/save",
            "people": {"person.alex": {"sources": ["sensor.alex_area"]}},
        },
    ):
        await client.send_json_auto_id(message)
        assert (await client.receive_json())["success"], message
    await hass.async_block_till_done()
    return {"kim": (kim, kim_token), "robin": (robin, robin_token), "admin": client}


async def _schedule(client: Any, entity: str) -> dict[str, Any]:
    start = dt_util.utcnow() + timedelta(days=1)
    await client.send_json_auto_id(
        {"type": "domotwin/schedules/add", "entities": [entity], "at": start.isoformat()}
    )
    while True:
        message = await client.receive_json()
        if message.get("type") == "result":
            return cast("dict[str, Any]", message)


async def test_a_user_uses_only_what_their_rights_let_them(
    hass: HomeAssistant,
    home: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    hass_admin_user: User,
) -> None:
    kim_user, kim_token = home["kim"]
    robin_user, robin_token = home["robin"]
    kim = await hass_ws_client(hass, kim_token)
    robin = await hass_ws_client(hass, robin_token)

    # Kim: the living room to look at, its floor lamp to use; the hall's spots hidden; the
    # bedroom hers to use; the kitchen everyone's.
    for entity, success in (
        ("light.living_room_pendant", False),
        ("cover.living_room_curtains", False),
        ("light.living_room_floor_lamp", True),
        ("light.hall_spots", False),
        ("light.bedside_left", True),
        ("light.kitchen_ceiling", True),
        ("light.strip", True),
    ):
        answer = await _schedule(kim, entity)
        assert answer["success"] is success, entity
        if not success:
            assert answer["error"]["code"] == "not_allowed"

    # Robin is nobody's: everyone's rights, the bedroom hidden.
    assert not (await _schedule(robin, "light.bedside_left"))["success"]
    assert (await _schedule(robin, "light.living_room_pendant"))["success"]
    assert (await _schedule(robin, "light.hall_spots"))["success"]

    # The kitchen only seen by everyone: a strip in its area is too, unless one's own say.
    admin = home["admin"]
    rights = {**RIGHTS, "everyone": {"rooms": {"bedroom": "hidden", "kitchen": "see"}}}
    await admin.send_json_auto_id(
        {"type": "domotwin/settings/save", "settings": {"rights": rights}}
    )
    assert (await admin.receive_json())["success"]
    assert not (await _schedule(robin, "light.strip"))["success"]
    assert not (await _schedule(kim, "light.kitchen_ceiling"))["success"]

    # A private room closed to a user (D-039) is hidden from them too.
    await admin.send_json_auto_id(
        {
            "type": "domotwin/settings/save",
            "settings": {"rights": RIGHTS, "rooms": {"living": {"people": ["person.kim"]}}},
        }
    )
    assert (await admin.receive_json())["success"]
    assert not (await _schedule(robin, "light.living_room_pendant"))["success"]
    assert (await _schedule(kim, "light.living_room_floor_lamp"))["success"]

    # An administrator sets the rights: none apply to them, nor to Home Assistant itself.
    assert viewer_of(hass, RIGHTS, hass_admin_user) is None
    assert viewer_of(hass, RIGHTS, None) is None
    assert levels_for(hass, hass_admin_user) is None
    assert (await _schedule(admin, "light.hall_spots"))["success"]
    viewer = viewer_of(hass, RIGHTS, kim_user)
    assert viewer is not None
    assert viewer.room("living") == "see"
    nobody = viewer_of(hass, RIGHTS, robin_user)
    assert nobody is not None
    assert nobody.room("living") == "use"


async def test_actions_on_what_is_hidden_are_not_listed_nor_cancelled(
    hass: HomeAssistant, home: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    async_mock_service(hass, "homeassistant", "turn_on")
    admin = home["admin"]
    added = await _schedule(admin, "light.bedside_left")
    assert added["success"]
    kitchen = await _schedule(admin, "light.kitchen_ceiling")
    assert kitchen["success"]

    _, robin_token = home["robin"]
    robin = await hass_ws_client(hass, robin_token)
    await robin.send_json_auto_id({"type": "domotwin/schedules/subscribe"})
    assert (await robin.receive_json())["success"]
    listed = (await robin.receive_json())["event"]["schedules"]
    assert [item["entities"] for item in listed] == [["light.kitchen_ceiling"]]
    await robin.send_json_auto_id(
        {"type": "domotwin/schedules/cancel", "schedule_id": added["result"]["schedule"]["id"]}
    )
    assert (await robin.receive_json())["error"]["code"] == "not_allowed"

    # The kitchen hidden from everyone too: Robin's list is sent again, without its action.
    rights = {**RIGHTS, "everyone": {"rooms": {"bedroom": "hidden", "kitchen": "hidden"}}}
    await admin.send_json_auto_id(
        {"type": "domotwin/settings/save", "settings": {"rights": rights}}
    )
    assert (await admin.receive_json())["success"]
    assert (await robin.receive_json())["event"]["schedules"] == []
    await admin.send_json_auto_id(
        {"type": "domotwin/settings/save", "settings": {"rights": RIGHTS}}
    )
    assert (await admin.receive_json())["success"]
    listed = (await robin.receive_json())["event"]["schedules"]
    assert [item["entities"] for item in listed] == [["light.kitchen_ceiling"]]

    # The assistants say no more of them to Robin.
    assert await async_setup_component(hass, "homeassistant", {})
    for entity in ("light.bedside_left", "light.kitchen_ceiling", "light.living_room_pendant"):
        async_expose_entity(hass, "conversation", entity, True)
    robin_user, _ = home["robin"]

    async def tool(user_id: str | None, used: llm.Tool, **args: Any) -> dict[str, Any]:
        context = llm.LLMContext(
            platform="test",
            context=Context(user_id=user_id),
            language="en",
            assistant="conversation",
            device_id=None,
        )
        result = await used.async_call(hass, llm.ToolInput(used.name, args), context)
        assert isinstance(result, llm.ToolResult)
        return dict(result.data)

    # Robin, and a satellite's voice, nobody's: everyone's rights, the bedroom hidden.
    for user_id in (robin_user.id, None):
        told = (await tool(user_id, ListSchedulesTool()))["schedules"]
        assert isinstance(told, list)
        assert len(told) == 1
        refused = await tool(user_id, CancelScheduleTool(), name="light.bedside_left")
        assert refused["error"] == "not_allowed"
        refused = await tool(user_id, ScheduleTool(), name="light.bedside_left", in_minutes=5)
        assert refused["error"] == "not_allowed"
    assert (await tool(None, ScheduleTool(), name="light.kitchen_ceiling", in_minutes=5))["success"]
    scheduler = hass.data[SCHEDULER_KEY]
    assert len(scheduler.items()) == 3
    # An automation's `domotwin.schedule` is Home Assistant's own: not held to anyone's rights.
    await hass.services.async_call(
        "domotwin",
        "schedule",
        {"entity_id": ["light.bedside_left"], "delay": {"minutes": 5}},
        blocking=True,
        return_response=True,
    )
    assert len(scheduler.items()) == 4


async def test_a_room_hidden_from_everyone_is_not_told(
    hass: HomeAssistant, home: dict[str, Any]
) -> None:
    async def ask(user: User | None) -> str:
        answer = await hass.services.async_call(
            "domotwin",
            "where",
            {"name": "alex"},
            blocking=True,
            return_response=True,
            context=Context(user_id=user.id if user else None),
        )
        return cast("str", cast("dict[str, Any]", answer)["text"])

    kim, _ = home["kim"]
    robin, _ = home["robin"]
    # Alex is in the bedroom, hidden from everyone but Kim: not said to Robin, nor by a voice
    # that is nobody's; said to Kim.
    assert await ask(robin) == "Alex is in a private room."
    assert await ask(None) == "Alex is in a private room."
    assert await ask(kim) == "Alex is in the Bedroom."
    # The bedroom's sensor, everyone's, does not say who is there.
    bedroom = hass.states.get("sensor.domotwin_bedroom_people")
    assert isinstance(bedroom, State)
    assert bedroom.attributes["private"] is True
    assert "people" not in bedroom.attributes
