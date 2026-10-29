"""Actions done later (D-046): kept, done at their time, across restarts, from every way in."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
import probatio
import pytest
from pytest_homeassistant_custom_component.common import (
    CLIENT_ID,
    MockConfigEntry,
    async_fire_time_changed,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.compat import vol
from custom_components.domotwin.const import SCHEDULES_STORAGE_KEY
from custom_components.domotwin.data import SCHEDULER_KEY
from custom_components.domotwin.llm import (
    CancelScheduleTool,
    ListSchedulesTool,
    ScheduleTool,
    async_get_tools,
)
from custom_components.domotwin.schedules import ScheduleError, describe
from homeassistant.components.homeassistant.exposed_entities import async_expose_entity
from homeassistant.core import Context, HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import llm
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util


def local(
    year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0
) -> datetime:
    """A moment where the home is."""
    return datetime(year, month, day, hour, minute, second, tzinfo=dt_util.get_default_time_zone())


@pytest.fixture
async def evening(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> FrozenDateTimeFactory:
    """26 October 2026, 22:00 where the home is."""
    await hass.config.async_set_time_zone("Europe/Paris")
    freezer.move_to(local(2026, 10, 26, 22, 0))
    return freezer


@pytest.fixture
def devices(hass: HomeAssistant) -> None:
    """A dimmable lantern, a kettle, a blind and a thermometer."""
    hass.states.async_set("light.lantern", "off", {"friendly_name": "Lantern"})
    hass.states.async_set("switch.kettle", "off", {"friendly_name": "Kettle"})
    hass.states.async_set("cover.blind", "closed", {"friendly_name": "Blind"})
    hass.states.async_set("sensor.temperature", "20", {"friendly_name": "Temperature"})


@pytest.fixture
def calls(hass: HomeAssistant) -> dict[str, list[ServiceCall]]:
    """What the actions switch, through Home Assistant's own services (mocked)."""
    return {
        "on": async_mock_service(hass, "homeassistant", "turn_on"),
        "off": async_mock_service(hass, "homeassistant", "turn_off"),
        "light": async_mock_service(hass, "light", "turn_on"),
        "open": async_mock_service(hass, "cover", "open_cover"),
        "close": async_mock_service(hass, "cover", "close_cover"),
    }


async def move(hass: HomeAssistant, freezer: FrozenDateTimeFactory, moment: datetime) -> None:
    """Time passes until `moment`, and what was due is done."""
    freezer.move_to(moment)
    async_fire_time_changed(hass, moment)
    await hass.async_block_till_done()


@pytest.mark.usefixtures("devices")
async def test_a_light_switches_on_at_its_time_and_off_at_its_end(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    calls: dict[str, list[ServiceCall]],
    hass_storage: dict[str, Any],
) -> None:
    # Times of day: the next ones; the end the next one after the start.
    answer = await hass.services.async_call(
        "domotwin",
        "schedule",
        {"entity_id": "light.lantern", "at": "06:30", "until": "06:45", "brightness": 100},
        blocking=True,
        return_response=True,
    )
    assert answer is not None
    assert answer["text"] == "Lantern will switch on at 100 % tomorrow at 06:30 and off at 06:45."
    assert answer["at"] == local(2026, 10, 27, 6, 30).astimezone(dt_util.UTC).isoformat()
    # Kept where a restart finds it.
    stored = hass_storage[SCHEDULES_STORAGE_KEY]["data"]["schedules"]
    assert [item["id"] for item in stored] == [answer["id"]]

    await move(hass, evening, local(2026, 10, 27, 6, 29))
    assert not calls["light"]
    await move(hass, evening, local(2026, 10, 27, 6, 30, 1))
    assert [dict(call.data) for call in calls["light"]] == [
        {"entity_id": ["light.lantern"], "brightness_pct": 100}
    ]
    started = hass.data[SCHEDULER_KEY].get(str(answer["id"]))
    assert started is not None
    assert started.started
    await move(hass, evening, local(2026, 10, 27, 6, 45, 1))
    assert [dict(call.data) for call in calls["off"]] == [{"entity_id": ["light.lantern"]}]
    assert hass.data[SCHEDULER_KEY].items() == []
    assert hass_storage[SCHEDULES_STORAGE_KEY]["data"]["schedules"] == []


@pytest.mark.usefixtures("devices")
async def test_delays_durations_switching_off_and_covers(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    calls: dict[str, list[ServiceCall]],
) -> None:
    hass.config.language = "fr"
    kettle = await hass.services.async_call(
        "domotwin",
        "schedule",
        {"entity_id": ["switch.kettle"], "delay": {"minutes": 10}, "duration": {"minutes": 5}},
        blocking=True,
        return_response=True,
    )
    assert kettle is not None
    assert kettle["text"] == "Kettle s'allumera aujourd'hui à 22:10 et s'éteindra à 22:15."
    blind = await hass.services.async_call(
        "domotwin",
        "schedule",
        {"entity_id": "cover.blind", "action": "off", "at": "2026-10-28 23:00:00"},
        blocking=True,
        return_response=True,
    )
    assert blind is not None
    assert blind["text"] == "Blind se fermera le 28/10/2026 à 23:00."
    both = await hass.services.async_call(
        "domotwin",
        "schedule",
        {"entity_id": ["switch.kettle", "light.lantern"], "at": "07:00"},
        blocking=True,
        return_response=True,
    )
    assert both is not None
    assert both["text"] == "Kettle et Lantern s'allumeront demain à 07:00."

    await move(hass, evening, local(2026, 10, 26, 22, 10, 1))
    assert [dict(call.data) for call in calls["on"]] == [{"entity_id": ["switch.kettle"]}]
    await move(hass, evening, local(2026, 10, 26, 22, 15, 1))
    assert [dict(call.data) for call in calls["off"]] == [{"entity_id": ["switch.kettle"]}]
    # Lights with no brightness given are switched on as anything else.
    await move(hass, evening, local(2026, 10, 27, 7, 0, 1))
    assert dict(calls["on"][-1].data) == {"entity_id": ["switch.kettle", "light.lantern"]}
    assert not calls["light"]
    # Covers are closed as covers: Home Assistant's turn_off does not reach them.
    await move(hass, evening, local(2026, 10, 28, 23, 0, 1))
    assert [dict(call.data) for call in calls["close"]] == [{"entity_id": ["cover.blind"]}]
    assert all("cover.blind" not in call.data["entity_id"] for call in calls["off"])


@pytest.mark.usefixtures("devices")
async def test_ends_are_checked_and_a_failing_device_leaves_nothing_stuck(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    calls: dict[str, list[ServiceCall]],
) -> None:
    # A zero duration is an end, at the start: refused, not a device left on.
    with pytest.raises(ServiceValidationError) as refused:
        await hass.services.async_call(
            "domotwin",
            "schedule",
            {"entity_id": "switch.kettle", "delay": {"minutes": 5}, "duration": 0},
            blocking=True,
            return_response=True,
        )
    assert refused.value.translation_key == "schedule_end_before_start"
    # An end already past, even after a start a little late: refused.
    scheduler = hass.data[SCHEDULER_KEY]
    now = dt_util.utcnow()
    with pytest.raises(ScheduleError, match="end_before_start"):
        await scheduler.async_add(
            ["switch.kettle"], "on", now - timedelta(seconds=50), now - timedelta(seconds=10)
        )
    # Durations longer than anything allowed are refused before any arithmetic.
    with pytest.raises(vol.Invalid):
        await hass.services.async_call(
            "domotwin",
            "schedule",
            {"entity_id": "switch.kettle", "delay": {"minutes": 5}, "duration": {"days": 10**6}},
            blocking=True,
            return_response=True,
        )

    # A device that fails with anything: logged, and the action is done with.
    async def broken(call: ServiceCall) -> None:
        raise TimeoutError

    hass.services.async_register("switch", "turn_on", broken)
    hass.services.async_remove("homeassistant", "turn_on")
    hass.services.async_register("homeassistant", "turn_on", broken)
    await scheduler.async_add(["switch.kettle"], "on", dt_util.utcnow() + timedelta(minutes=1))
    await move(hass, evening, local(2026, 10, 26, 22, 1, 1))
    assert scheduler.items() == []


@pytest.mark.usefixtures("devices")
async def test_actions_are_cancelled_by_id_or_by_device(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    calls: dict[str, list[ServiceCall]],
) -> None:
    ids = []
    for entity in ("light.lantern", "switch.kettle", "light.lantern"):
        answer = await hass.services.async_call(
            "domotwin",
            "schedule",
            {"entity_id": entity, "delay": {"minutes": 30}},
            blocking=True,
            return_response=True,
        )
        assert answer is not None
        ids.append(answer["id"])
    cancelled = await hass.services.async_call(
        "domotwin", "unschedule", {"id": ids[1]}, blocking=True, return_response=True
    )
    assert cancelled == {"cancelled": 1}
    cancelled = await hass.services.async_call(
        "domotwin",
        "unschedule",
        {"entity_id": "light.lantern"},
        blocking=True,
        return_response=True,
    )
    assert cancelled == {"cancelled": 2}
    await move(hass, evening, local(2026, 10, 26, 22, 31))
    assert not calls["on"]


@pytest.mark.usefixtures("devices")
@pytest.mark.parametrize(
    ("data", "code"),
    [
        ({"entity_id": "light.lantern", "at": "2026-10-26 21:00:00"}, "in_the_past"),
        ({"entity_id": "light.lantern", "at": "2028-01-01 08:00:00"}, "too_far"),
        ({"entity_id": "light.missing", "delay": 60}, "unknown_entity"),
        ({"entity_id": "sensor.temperature", "delay": 60}, "not_schedulable"),
        (
            {"entity_id": "light.lantern", "at": "2026-10-27 08:00", "until": "2026-10-27 07:00"},
            "end_before_start",
        ),
        ({"entity_id": "light.lantern", "delay": 60, "duration": {"days": 8}}, "too_long"),
        (
            {"entity_id": "light.lantern", "action": "off", "delay": 60, "duration": 60},
            "off_with_end",
        ),
        (
            {"entity_id": "light.lantern", "action": "off", "delay": 60, "brightness": 5},
            "off_with_end",
        ),
    ],
)
async def test_actions_that_cannot_be_done_are_refused(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    data: dict[str, Any],
    code: str,
) -> None:
    with pytest.raises(ServiceValidationError) as refused:
        await hass.services.async_call("domotwin", "schedule", data, blocking=True)
    assert refused.value.translation_key == f"schedule_{code}"
    assert hass.data[SCHEDULER_KEY].items() == []


@pytest.mark.parametrize(
    "data",
    [
        {"entity_id": "light.lantern"},
        {"entity_id": "light.lantern", "at": "07:00", "delay": 60},
        {"entity_id": "light.lantern", "delay": 60, "until": "08:00", "duration": 60},
        {"entity_id": "light.lantern", "delay": 60, "brightness": 0},
        {"entity_id": "light.lantern", "delay": 60, "action": "toggle"},
        {"entity_id": [f"light.l{i}" for i in range(26)], "delay": 60},
    ],
)
async def test_malformed_requests_are_refused(
    hass: HomeAssistant, setup_integration: MockConfigEntry, data: dict[str, Any]
) -> None:
    with pytest.raises(vol.Invalid):
        await hass.services.async_call("domotwin", "schedule", data, blocking=True)


@pytest.mark.usefixtures("devices")
async def test_a_hundred_actions_at_most(
    hass: HomeAssistant, evening: FrozenDateTimeFactory, setup_integration: MockConfigEntry
) -> None:
    scheduler = hass.data[SCHEDULER_KEY]
    for minutes in range(100):
        await scheduler.async_add(
            ["light.lantern"], "on", dt_util.utcnow() + timedelta(minutes=minutes + 1)
        )
    with pytest.raises(ServiceValidationError) as refused:
        await hass.services.async_call(
            "domotwin", "schedule", {"entity_id": "light.lantern", "delay": 60}, blocking=True
        )
    assert refused.value.translation_key == "schedule_too_many"


def stored(item_id: str, at: datetime, **more: Any) -> dict[str, Any]:
    """An action as the store keeps it."""
    return {
        "id": item_id,
        "entities": ["light.lantern"],
        "action": "on",
        "at": at.astimezone(dt_util.UTC).isoformat(),
        "until": None,
        "brightness": None,
        "started": False,
        "created": at.astimezone(dt_util.UTC).isoformat(),
        **more,
    }


@pytest.mark.usefixtures("devices")
async def test_a_restart_keeps_the_actions_and_does_what_is_still_due(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    config_entry: MockConfigEntry,
    calls: dict[str, list[ServiceCall]],
    hass_storage: dict[str, Any],
) -> None:
    now = local(2026, 10, 26, 22, 0)
    hass_storage[SCHEDULES_STORAGE_KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": SCHEDULES_STORAGE_KEY,
        "data": {
            "schedules": [
                # Missed long ago: dropped.
                stored("long-missed", now - timedelta(hours=2)),
                # Missed a little: done at once.
                stored("just-missed", now - timedelta(minutes=5)),
                # Its start missed, but meant to be on until later: on now, off at its end.
                stored(
                    "still-on",
                    now - timedelta(hours=1),
                    until=(now + timedelta(hours=1)).astimezone(dt_util.UTC).isoformat(),
                ),
                # Switched on before the restart, its end missed: switched off, however late.
                stored(
                    "left-on",
                    now - timedelta(hours=5),
                    until=(now - timedelta(hours=4)).astimezone(dt_util.UTC).isoformat(),
                    started=True,
                    entities=["switch.kettle"],
                ),
                # Its whole time on passed while stopped, never switched on: dropped.
                stored(
                    "came-and-went",
                    now - timedelta(minutes=10),
                    until=(now - timedelta(minutes=5)).astimezone(dt_util.UTC).isoformat(),
                ),
                # Switching off missed long ago: still done, it is the safe way.
                stored(
                    "late-off", now - timedelta(hours=3), action="off", entities=["cover.blind"]
                ),
                # To come: armed.
                stored("to-come", now + timedelta(hours=2), entities=["cover.blind"]),
                # Not an action: left out.
                {"id": 3, "entities": "light.lantern"},
            ]
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    scheduler = hass.data[SCHEDULER_KEY]
    assert {item.id for item in scheduler.items()} == {"still-on", "to-come"}
    assert len(calls["on"]) == 2  # just-missed and still-on, together or apart
    assert {e for call in calls["on"] for e in call.data["entity_id"]} == {"light.lantern"}
    assert [dict(call.data) for call in calls["off"]] == [{"entity_id": ["switch.kettle"]}]
    assert [dict(call.data) for call in calls["close"]] == [{"entity_id": ["cover.blind"]}]
    # Started: only its end is told.
    still_on = scheduler.get("still-on")
    assert still_on is not None
    assert still_on.started
    assert describe(hass, still_on) == "Lantern will switch off today at 23:00."
    ids = [item["id"] for item in hass_storage[SCHEDULES_STORAGE_KEY]["data"]["schedules"]]
    assert sorted(ids) == ["still-on", "to-come"]

    await move(hass, evening, now + timedelta(hours=1, seconds=1))
    assert [dict(call.data) for call in calls["off"]][-1] == {"entity_id": ["light.lantern"]}
    await move(hass, evening, now + timedelta(hours=2, seconds=1))
    assert [dict(call.data) for call in calls["open"]] == [{"entity_id": ["cover.blind"]}]
    assert scheduler.items() == []

    # Unloaded: nothing armed is done; the actions stay stored.
    await scheduler.async_add(["light.lantern"], "on", dt_util.utcnow() + timedelta(minutes=5))
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await move(hass, evening, dt_util.now() + timedelta(minutes=6))
    assert len(calls["on"]) == 2
    assert len(hass_storage[SCHEDULES_STORAGE_KEY]["data"]["schedules"]) == 1


@pytest.mark.usefixtures("devices")
async def test_steps_missed_together_are_done_in_their_order(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
) -> None:
    # Set first: off at 21:55; set later: on at 21:45. The last one due wins: off.
    done: list[str] = []

    async def record(call: ServiceCall) -> None:
        done.append(call.service)

    for service in ("turn_on", "turn_off"):
        hass.services.async_register("homeassistant", service, record)
    now = local(2026, 10, 26, 22, 0)
    hass_storage[SCHEDULES_STORAGE_KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": SCHEDULES_STORAGE_KEY,
        "data": {
            "schedules": [
                stored("off", now - timedelta(minutes=5), action="off"),
                stored("on", now - timedelta(minutes=15)),
            ]
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert done == ["turn_on", "turn_off"]


@pytest.mark.usefixtures("devices")
async def test_a_device_unavailable_is_switched_off_once_it_is_back(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    calls: dict[str, list[ServiceCall]],
) -> None:
    scheduler = hass.data[SCHEDULER_KEY]
    await scheduler.async_add(["switch.kettle"], "off", dt_util.utcnow() + timedelta(minutes=1))
    hass.states.async_set("switch.kettle", "unavailable")
    await move(hass, evening, local(2026, 10, 26, 22, 1, 1))
    # Home Assistant passed over it: tried again a minute later.
    assert len(calls["off"]) == 1
    assert len(scheduler.items()) == 1
    hass.states.async_set("switch.kettle", "on")
    await move(hass, evening, local(2026, 10, 26, 22, 2, 2))
    assert len(calls["off"]) == 2
    assert scheduler.items() == []


@pytest.mark.usefixtures("devices")
async def test_the_list_says_nothing_of_who_set_an_action_and_follows_the_entry(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/schedules/subscribe"})
    assert (await client.receive_json())["success"]
    assert (await client.receive_json())["event"] == {"schedules": []}
    await client.send_json_auto_id(
        {"type": "domotwin/schedules/add", "entities": ["light.lantern"], "at": "06:30"}
    )
    added, listed = await answer_and_event(client)
    assert added["success"]
    assert listed[0]["entities"] == ["light.lantern"]
    assert "user_id" not in listed[0]
    # Unloaded: the screens are told there is nothing waiting any more.
    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    assert (await client.receive_json())["event"] == {"schedules": []}


async def answer_and_event(client: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """A command's answer and the list sent as it changed, in whichever order they came.

    Home Assistant may send both in one frame (coalesced).
    """
    messages: list[dict[str, Any]] = []
    while not ({"result", "event"} <= {message["type"] for message in messages}):
        frame = await client.receive_json()
        messages += frame if isinstance(frame, list) else [frame]
    answer = next(message for message in messages if message["type"] == "result")
    event = next(message for message in messages if message["type"] == "event")
    return answer, event["event"]["schedules"]


@pytest.mark.usefixtures("devices")
async def test_the_sheets_list_set_and_cancel_actions_live(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
) -> None:
    # Someone who may only look sees what waits, and may not set or cancel anything.
    looking = await hass_ws_client(hass, hass_read_only_access_token)
    start = dt_util.utcnow() + timedelta(days=1)
    await looking.send_json_auto_id(
        {"type": "domotwin/schedules/add", "entities": ["light.lantern"], "at": start.isoformat()}
    )
    assert (await looking.receive_json())["error"]["code"] == "not_allowed"

    # Someone who is not an administrator controls the devices, and their actions too.
    user = await hass.auth.async_create_user("Someone", group_ids=["system-users"])
    refresh = await hass.auth.async_create_refresh_token(user, CLIENT_ID)
    client = await hass_ws_client(hass, hass.auth.async_create_access_token(refresh))
    await client.send_json_auto_id({"type": "domotwin/schedules/subscribe"})
    assert (await client.receive_json())["success"]
    assert (await client.receive_json())["event"] == {"schedules": []}

    await client.send_json_auto_id(
        {
            "type": "domotwin/schedules/add",
            "entities": ["light.lantern"],
            "at": start.isoformat(),
            "until": (start + timedelta(minutes=15)).isoformat(),
            "brightness": 40,
        }
    )
    added, listed = await answer_and_event(client)
    assert added["success"]
    assert added["result"]["text"].startswith("Lantern will switch on at 40 % tomorrow at ")
    item = added["result"]["schedule"]
    assert item["entities"] == ["light.lantern"]
    assert item["brightness"] == 40
    assert [each["id"] for each in listed] == [item["id"]]

    await client.send_json_auto_id(
        {
            "type": "domotwin/schedules/add",
            "entities": ["sensor.temperature"],
            "at": start.isoformat(),
        }
    )
    refused = await client.receive_json()
    assert refused["error"]["code"] == "not_schedulable"

    assert item["user_id"] == user.id
    await looking.send_json_auto_id(
        {"type": "domotwin/schedules/cancel", "schedule_id": item["id"]}
    )
    assert (await looking.receive_json())["error"]["code"] == "not_allowed"

    await client.send_json_auto_id({"type": "domotwin/schedules/cancel", "schedule_id": item["id"]})
    cancelled, listed = await answer_and_event(client)
    assert cancelled["result"] == {"cancelled": 1}
    assert listed == []
    await client.send_json_auto_id({"type": "domotwin/schedules/cancel", "schedule_id": item["id"]})
    assert (await client.receive_json())["result"] == {"cancelled": 0}


@pytest.mark.usefixtures("devices")
async def test_the_heating_goes_back_as_it_was_when_one_is_back(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Leaving home, the heating set to eco goes back to comfort before one's return (D-091)."""
    hass.states.async_set("climate.living", "heat", {"friendly_name": "Living room"})
    hass.states.async_set("climate.office", "heat", {"friendly_name": "Office"})
    presets = async_mock_service(hass, "climate", "set_preset_mode")
    temperatures = async_mock_service(hass, "climate", "set_temperature")
    client = await hass_ws_client(hass)
    back = local(2026, 10, 27, 17, 30)
    heating = {
        "type": "domotwin/schedules/add",
        "entities": ["climate.living", "climate.office"],
        "action": "climate",
        "at": back.isoformat(),
    }
    await client.send_json_auto_id({**heating, "climate": {"preset_mode": "comfort"}})
    added = await client.receive_json()
    assert added["success"]
    assert added["result"]["text"] == (
        "Living room and Office will go back to how they were tomorrow at 17:30."
    )
    assert added["result"]["schedule"]["climate"] == {"preset_mode": "comfort"}
    await client.send_json_auto_id(
        {**heating, "entities": ["climate.office"], "climate": {"temperature": 19.5}}
    )
    assert (await client.receive_json())["success"]

    # Only the heating, put back to one thing, once.
    for wrong in (
        {**heating, "entities": ["light.lantern"], "climate": {"preset_mode": "comfort"}},
        heating,
        {**heating, "climate": {"preset_mode": "comfort"}, "duration": 60},
        {**heating, "action": "on", "climate": {"preset_mode": "comfort"}},
    ):
        await client.send_json_auto_id(wrong)
        assert (await client.receive_json())["error"]["code"] == "not_climate"
    for malformed in ({"preset_mode": "comfort", "temperature": 20}, {"fan_mode": "auto"}):
        await client.send_json_auto_id({**heating, "climate": malformed})
        assert (await client.receive_json())["error"]["code"] == "invalid_format"

    await move(hass, evening, back)
    assert [dict(call.data) for call in presets] == [
        {"entity_id": ["climate.living", "climate.office"], "preset_mode": "comfort"}
    ]
    assert presets[0].context.user_id is not None
    assert [dict(call.data) for call in temperatures] == [
        {"entity_id": ["climate.office"], "temperature": 19.5}
    ]
    assert hass.data[SCHEDULER_KEY].items() == []


@pytest.mark.usefixtures("devices")
async def test_the_heating_missed_while_stopped_goes_back_however_late(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
) -> None:
    hass.states.async_set("climate.living", "off", {"friendly_name": "Living room"})
    modes = async_mock_service(hass, "climate", "set_hvac_mode")
    now = local(2026, 10, 26, 22, 0)
    hass_storage[SCHEDULES_STORAGE_KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": SCHEDULES_STORAGE_KEY,
        "data": {
            "schedules": [
                stored(
                    "back-home",
                    now - timedelta(hours=3),
                    action="climate",
                    entities=["climate.living"],
                    climate={"hvac_mode": "heat"},
                ),
                # The heating without what it goes back to, or a switch with one: left out.
                stored("no-setting", now, action="climate", entities=["climate.living"]),
                stored("switch-setting", now, climate={"hvac_mode": "heat"}),
            ]
        },
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    assert [dict(call.data) for call in modes] == [
        {"entity_id": ["climate.living"], "hvac_mode": "heat"}
    ]
    assert hass.data[SCHEDULER_KEY].items() == []


async def test_the_list_waits_for_an_entry_and_the_commands_refuse(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    # A screen kept open while Home Assistant restarts follows the list before DomoTwin is set
    # up: empty until then.
    assert await async_setup_component(hass, "domotwin", {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "domotwin/schedules/subscribe"})
    assert (await client.receive_json())["success"]
    assert (await client.receive_json())["event"] == {"schedules": []}
    await client.send_json_auto_id({"type": "domotwin/schedules/cancel", "schedule_id": "x"})
    assert (await client.receive_json())["error"]["code"] == "not_loaded"


@pytest.fixture
async def assistant(hass: HomeAssistant, devices: None) -> llm.LLMContext:
    """The conversation assistant, with the lantern and the blind exposed to it (not the kettle)."""
    assert await async_setup_component(hass, "homeassistant", {})
    for entity, exposed in (
        ("light.lantern", True),
        ("cover.blind", True),
        ("switch.kettle", False),
    ):
        async_expose_entity(hass, "conversation", entity, exposed)
    return llm.LLMContext(
        platform="test",
        context=Context(),
        language="en",
        assistant="conversation",
        device_id=None,
    )


async def call(
    hass: HomeAssistant, tool: llm.Tool, context: llm.LLMContext, **args: Any
) -> dict[str, Any]:
    """What a tool answers the assistant."""
    result = await tool.async_call(hass, llm.ToolInput(tool.name, args), context)
    assert isinstance(result, llm.ToolResult)
    return dict(result.data)


async def test_the_assistants_get_the_tools(
    hass: HomeAssistant, setup_integration: MockConfigEntry, assistant: llm.LLMContext
) -> None:
    tools = async_get_tools(hass, assistant, llm.LLM_API_ASSIST)
    assert tools is not None
    assert [tool.name for tool in tools.tools] == [
        "domotwin__schedule",
        "domotwin__list_schedules",
        "domotwin__cancel_schedule",
    ]
    assert tools.prompt is not None
    assert "domotwin__schedule" in tools.prompt
    # Their parameters read as the agents send them to the models.
    for tool in tools.tools:
        probatio.to_openapi(
            tool.parameters, custom_serializer=llm.selector_serializer, openapi_version="3.1.0"
        )
    assert async_get_tools(hass, assistant, "another-api") is None


async def test_the_tools_wait_for_an_entry(hass: HomeAssistant, assistant: llm.LLMContext) -> None:
    assert async_get_tools(hass, assistant, llm.LLM_API_ASSIST) is None


async def test_an_assistant_schedules_lists_and_cancels(
    hass: HomeAssistant,
    evening: FrozenDateTimeFactory,
    setup_integration: MockConfigEntry,
    assistant: llm.LLMContext,
    calls: dict[str, list[ServiceCall]],
) -> None:
    hass.config.language = "fr"
    answer = await call(
        hass,
        ScheduleTool(),
        assistant,
        name="lantern",
        start="2026-10-27T06:30:00",
        end="06:45",
        brightness=100,
    )
    assert answer["success"]
    assert answer["devices"] == ["Lantern"]
    assert answer["text"] == "Lantern s'allumera à 100 % demain à 06:30 et s'éteindra à 06:45."
    blind = await call(
        hass, ScheduleTool(), assistant, name="Blind", action="turn_off", in_minutes=30
    )
    assert blind["text"] == "Blind se fermera aujourd'hui à 22:30."

    # Not exposed, unknown, or with no time: said why.
    refused = await call(hass, ScheduleTool(), assistant, name="Kettle", in_minutes=5)
    assert refused["error"] == "no_match"
    refused = await call(hass, ScheduleTool(), assistant, name="lantern")
    assert refused["error"] == "no_start"
    refused = await call(hass, ScheduleTool(), assistant, name="lantern", start="soon")
    assert refused["error"] == "bad_time"
    refused = await call(
        hass, ScheduleTool(), assistant, name="lantern", start="2026-10-25T06:30:00"
    )
    assert refused["error"] == "in_the_past"

    listed = await call(hass, ListSchedulesTool(), assistant)
    assert [each["text"] for each in listed["schedules"]] == [
        "Blind se fermera aujourd'hui à 22:30.",
        "Lantern s'allumera à 100 % demain à 06:30 et s'éteindra à 06:45.",
    ]
    # An action on a device no longer exposed is not told about.
    async_expose_entity(hass, "conversation", "cover.blind", False)
    listed = await call(hass, ListSchedulesTool(), assistant)
    assert len(listed["schedules"]) == 1

    cancelled = await call(hass, CancelScheduleTool(), assistant, name="light.lantern")
    assert cancelled == {"success": True, "cancelled": 1}
    await move(hass, evening, local(2026, 10, 27, 6, 31))
    assert not calls["light"]
