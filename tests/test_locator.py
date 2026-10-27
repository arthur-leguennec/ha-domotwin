"""Bluetooth locating in Home Assistant (D-035).

Receivers placed, devices followed and told in their rooms, the people they place, teaching,
things left behind, the commands and `where`.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Callable
from datetime import timedelta
import importlib
import sys
from types import ModuleType, SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, Mock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.domotwin.const import LOCATING_LEARNED_KEY, LOCATING_STORAGE_KEY
from custom_components.domotwin.data import DATA_KEY, LOCATOR_KEY, PEOPLE_KEY
from custom_components.domotwin.locating.radio import expected_at
from custom_components.domotwin.locating.radio_ha import Advert, HaRadio, Receiver, ha_radio
from custom_components.domotwin.locator import KeyNotTakenError, Locator
from homeassistant.core import HomeAssistant, State
from homeassistant.data_entry_flow import (
    FlowResultType,
    InvalidData,
    UnknownFlow,
    UnknownHandler,
)
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.util import dt as dt_util

from .test_locating import SPEC_ADDRESS, SPEC_KEY, _beacon

LIVING_PROXY = "AA:00:00:00:00:03"  # an ESP32: its Wi-Fi address is two before
BEDROOM_PROXY = "BB:00:00:00:00:01"
HALL_PROXY = "CC:00:00:00:00:01"
LOST_PROXY = "DD:00:00:00:00:01"
TAG = "F1:22:33:44:55:66"
UUID = "e2c56db5-dffb-48d2-b060-d0f5a71096e0"
PHONE = "sensor.domotwin_alex_phone_bluetooth"


class FakeRadio:
    """Bluetooth as the tests make it: receivers, and the packets they hear."""

    def __init__(self, receivers: dict[str, str]) -> None:
        """Start with these receivers (address -> name), hearing nothing."""
        self.sources = receivers
        self.watchers: list[Callable[[Advert], None]] = []
        self.followers: dict[str, list[Callable[[Advert], None]]] = {}
        self.adverts: dict[str, Advert] = {}

    def receivers(self) -> list[Receiver]:
        """The receivers, working."""
        return [Receiver(source, name, 1.0) for source, name in self.sources.items()]

    def watch(self, heard: Callable[[Advert], None]) -> Callable[[], None]:
        """Tell `heard` of each address heard for the first time."""
        self.watchers.append(heard)
        return lambda: self.watchers.remove(heard)

    def follow(self, address: str, heard: Callable[[Advert], None]) -> Callable[[], None]:
        """Tell `heard` of each packet of an address."""
        self.followers.setdefault(address, []).append(heard)
        return lambda: self.followers[address].remove(heard)

    def seen(self) -> list[Advert]:
        """The latest packet of each address."""
        return list(self.adverts.values())

    def send(self, advert: Advert) -> None:
        """A packet heard: its address's followers first, then the watchers.

        That is Home Assistant's order; the watchers see each address once.
        """
        for heard in list(self.followers.get(advert.address, [])):
            heard(advert)
        new = advert.address not in self.adverts
        self.adverts[advert.address] = advert
        if new:
            for watcher in list(self.watchers):
                watcher(advert)


class Clock:
    """The locator's clock, moved on by the tests."""

    def __init__(self) -> None:
        """Start somewhere."""
        self.now = 1000.0

    def __call__(self) -> float:
        """The time now (seconds)."""
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def radio() -> FakeRadio:
    return FakeRadio(
        {
            LIVING_PROXY: "living-proxy",
            BEDROOM_PROXY: "bedroom-proxy",
            HALL_PROXY: "hall-proxy",
            LOST_PROXY: "attic-proxy",
        }
    )


@pytest.fixture
async def home(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    radio: FakeRadio,
    clock: Clock,
) -> AsyncGenerator[Locator]:
    """The demo apartment and its areas, heard by four receivers.

    - the living room's, an ESPHome proxy whose device is in the living room's area;
    - the bedroom's, placed by an administrator;
    - the hall's, whose device is linked to the shoe cabinet;
    - one nobody placed.
    """
    for name in ("Living room", "Kitchen", "Bathroom", "Hallway", "Bedroom"):
        ar.async_get(hass).async_create(name)
    proxies = MockConfigEntry(domain="esphome")
    proxies.add_to_hass(hass)
    devices = dr.async_get(hass)
    living = devices.async_get_or_create(
        config_entry_id=proxies.entry_id,
        connections={(dr.CONNECTION_NETWORK_MAC, "aa:00:00:00:00:01")},
        name="Living proxy",
    )
    devices.async_update_device(living.id, area_id="living_room")
    hall = devices.async_get_or_create(
        config_entry_id=proxies.entry_id,
        # As Home Assistant registers a Bluetooth address: as given, in uppercase.
        connections={(dr.CONNECTION_BLUETOOTH, "CC:00:00:00:00:01")},
        name="Hall proxy",
    )
    hass.states.async_set("person.alex", "home", {"friendly_name": "Alex"})
    with (
        patch("custom_components.domotwin.locator.ha_radio", return_value=radio),
        patch("custom_components.domotwin.locator.monotonic", clock),
    ):
        config_entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(config_entry.entry_id)
        await hass.async_block_till_done()
        client = await hass_ws_client(hass)
        await client.send_json_auto_id({"type": "domotwin/plan/save", "plan": demo_plan})
        assert (await client.receive_json())["success"]
        demo_bindings["elements"]["shoe-cabinet"] = {"device": hall.id, "entities": []}
        await client.send_json_auto_id(
            {"type": "domotwin/bindings/save", "bindings": demo_bindings}
        )
        assert (await client.receive_json())["success"]
        await hass.async_block_till_done()
        yield hass.data[LOCATOR_KEY]


async def _call(client: Any, kind: str, **data: Any) -> dict[str, Any]:
    await client.send_json_auto_id({"type": f"domotwin/locating/{kind}", **data})
    answer: dict[str, Any] = await client.receive_json()
    return answer


async def _follow(client: Any, devices: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return await _call(
        client,
        "save",
        receivers={BEDROOM_PROXY: {"room": "bedroom"}},
        devices=devices,
        **extra,
    )


def _hear(radio: FakeRadio, locator: Locator, address: str, room: str, **extra: Any) -> None:
    """Every receiver placed hears a device held in a room's middle, as the plan says."""
    held = locator.home.middle(room)
    for _ in range(3):
        for source, spot in locator.places.items():
            if spot is not None:
                rssi = expected_at(locator.home, held, spot)
                radio.send(Advert(address, source, rssi, **extra))


def _ticks(locator: Locator, radio: FakeRadio, address: str, room: str, n: int = 4) -> None:
    """`n` ticks, two seconds apart, the device heard in a room before each."""
    clock = cast("Clock", locator_clock(locator))
    for _ in range(n):
        clock.now += 2
        _hear(radio, locator, address, room)
        locator._tick()


def locator_clock(locator: Locator) -> Any:
    from custom_components.domotwin import locator as module  # noqa: PLC0415

    return vars(module)["monotonic"]


def _state(hass: HomeAssistant, entity: str) -> State:
    state = hass.states.get(entity)
    assert state is not None, entity
    return state


async def test_receivers_are_placed_from_their_devices_or_by_hand(
    hass: HomeAssistant, home: Locator, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    assert (await _follow(client, {}))["success"]
    got = (await _call(client, "get"))["result"]
    assert got["status"] == "ready"
    placed = {r["source"]: r["placed_by"] for r in got["receivers"]}
    assert placed == {
        LIVING_PROXY: "device_area",
        BEDROOM_PROXY: "room",
        HALL_PROXY: "device_piece",
        LOST_PROXY: None,
    }
    hall = home.places[HALL_PROXY]
    assert hall is not None
    assert home.home.room_at(0, (hall.x, hall.y)) == "hall"
    receiver = next(r for r in got["receivers"] if r["source"] == BEDROOM_PROXY)
    assert (receiver["name"], receiver["room"]) == ("bedroom-proxy", "bedroom")
    # Where each stands, for the placement advisor (D-066): a receiver placed by its room in the
    # room's middle, one placed nowhere nowhere.
    middle = home.home.middle("bedroom")
    ground = hass.data[DATA_KEY].storeys[0]["id"]
    assert receiver["place"] == {
        "storey": ground,
        "at": [round(middle.x, 1), round(middle.y, 1)],
        "z": 120.0,
    }
    lost = next(r for r in got["receivers"] if r["source"] == LOST_PROXY)
    assert lost["place"] is None
    assert got["heard"] == {}


async def test_a_phone_is_followed_from_room_to_room_and_places_its_owner(
    hass: HomeAssistant,
    home: Locator,
    radio: FakeRadio,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    answer = await _follow(
        client,
        {
            "alex_phone": {
                "name": "Alex's phone",
                "kind": "phone",
                "person": "person.alex",
                "match": {"address": TAG.lower()},
            }
        },
    )
    assert answer["success"], answer
    await hass.async_block_till_done()
    stored = hass_storage[LOCATING_STORAGE_KEY]["data"]
    assert stored["devices"]["alex_phone"]["match"] == {"address": TAG}
    # Alex was not placed: they are now, by their phone.
    people = hass.data[PEOPLE_KEY]
    assert "person.alex" in people.config["people"]
    assert people.sources("person.alex") == [PHONE]
    assert _state(hass, PHONE).state == "unknown"

    _ticks(home, radio, TAG, "living")
    await hass.async_block_till_done()
    phone = _state(hass, PHONE)
    assert phone.state == "Living room"
    assert phone.attributes["room_id"] == "living"
    assert phone.attributes["area_id"] == "living_room"
    # How sure, and heard by how many: for the settings, not written into the history.
    assert "confidence" not in phone.attributes
    assert home.located["alex_phone"].receivers == 3
    assert home.located["alex_phone"].confidence > 0.6
    assert phone.name == "DomoTwin Alex's phone: room"
    assert _state(hass, "sensor.domotwin_alex_room").attributes["room_id"] == "living"

    _ticks(home, radio, TAG, "bedroom", 8)
    await hass.async_block_till_done()
    assert _state(hass, PHONE).attributes["room_id"] == "bedroom"
    assert _state(hass, "sensor.domotwin_alex_room").attributes["source"] == PHONE

    # Not heard for long: not located.
    locator_clock(home).now += 1000
    home._tick()
    await hass.async_block_till_done()
    assert _state(hass, PHONE).state == "unknown"

    # Renamed, then no longer followed.
    renamed = {"name": "Phone", "kind": "phone", "match": {"address": TAG}}
    assert (await _follow(client, {"alex_phone": renamed}))["success"]
    await hass.async_block_till_done()
    assert _state(hass, PHONE).name == "DomoTwin Phone: room"
    assert (await _follow(client, {}))["success"]
    await hass.async_block_till_done()
    assert hass.states.get(PHONE) is None
    assert er.async_get(hass).async_get(PHONE) is None


async def test_phones_by_their_key_and_beacons_by_their_ids(
    hass: HomeAssistant, home: Locator, radio: FakeRadio, hass_ws_client: WebSocketGenerator
) -> None:
    private = MockConfigEntry(
        domain="private_ble_device", title="Sam's watch", data={"irk": SPEC_KEY.hex()}
    )
    private.add_to_hass(hass)
    client = await hass_ws_client(hass)
    # Offered: the Private BLE Device entry by its title (never its key), the beacon and the
    # named tag heard; not the private address.
    radio.send(Advert("C1:00:00:00:00:01", LIVING_PROXY, -60, manufacturer=_beacon()))
    radio.send(Advert(TAG, LIVING_PROXY, -70, name="Keys tag"))
    radio.send(Advert(SPEC_ADDRESS, LIVING_PROXY, -50, name="iPhone"))
    offered = (await _call(client, "candidates"))["result"]["candidates"]
    assert {"match": {"key": private.entry_id}, "name": "Sam's watch"} in offered
    assert any("beacon" in c["match"] for c in offered)
    assert any(c["match"] == {"address": TAG} for c in offered)
    assert all(c["match"].get("address") != SPEC_ADDRESS for c in offered)
    assert SPEC_KEY.hex() not in str(offered)

    beacon: dict[str, Any] = {
        "uuid": "E2C56DB5-DFFB-48D2-B060-D0F5A71096E0",
        "major": 1,
        "minor": 2,
    }
    followed = {
        "sam_watch": {"name": "Watch", "kind": "watch", "match": {"key": private.entry_id}},
        "android": {"name": "Android", "kind": "phone", "match": {"beacon": beacon}},
    }
    answer = await _follow(client, followed)
    assert answer["success"], answer
    _ticks(home, radio, SPEC_ADDRESS, "bedroom", 6)
    # The beacon moves to another address: it is still known.
    for _ in range(6):
        locator_clock(home).now += 2
        _hear(radio, home, "C2:00:00:00:00:02", "living", manufacturer=_beacon())
        home._tick()
    await hass.async_block_till_done()
    assert _state(hass, "sensor.domotwin_sam_watch_bluetooth").attributes["room_id"] == "bedroom"
    assert _state(hass, "sensor.domotwin_android_bluetooth").attributes["room_id"] == "living"
    got = (await _call(client, "get"))["result"]
    assert got["devices"]["sam_watch"]["match"] == {"key": private.entry_id, "title": "Sam's watch"}
    assert got["devices"]["android"]["match"]["beacon"]["uuid"] == beacon["uuid"].lower()
    assert SPEC_KEY.hex() not in str(got)
    assert not got["devices"]["sam_watch"]["missing_key"]
    # The key's entry removed: the device is no longer recognised, and says so.
    await hass.config_entries.async_remove(private.entry_id)
    assert (await _follow(client, followed))["success"]
    assert (await _call(client, "get"))["result"]["devices"]["sam_watch"]["missing_key"]


async def test_a_receiver_that_connects_late_is_placed_and_heard(
    hass: HomeAssistant, home: Locator, radio: FakeRadio, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    tag = {"name": "Keys", "kind": "thing", "match": {"address": TAG}}
    assert (await _follow(client, {"keys": tag}))["success"]
    radio.sources["EE:00:00:00:00:01"] = "late-proxy"
    # Heard by it before it is placed: no harm done, and it is placed at the next rebuild.
    locator_clock(home).now += 2
    radio.send(Advert(TAG, "EE:00:00:00:00:01", -60))
    home._tick()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=3))
    # The rebuild runs as a background task.
    await hass.async_block_till_done(wait_background_tasks=True)
    assert "EE:00:00:00:00:01" in home.places
    _ticks(home, radio, TAG, "bedroom", 6)
    assert home.located["keys"].room == "bedroom"


async def test_another_tag_under_the_same_name_starts_again(
    hass: HomeAssistant, home: Locator, radio: FakeRadio, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    tag = {"name": "Keys", "kind": "thing", "match": {"address": TAG}}
    assert (await _follow(client, {"keys": tag}))["success"]
    _ticks(home, radio, TAG, "bedroom", 6)
    assert TAG in home._addresses
    other = "F9:99:99:99:99:99"
    assert (await _follow(client, {"keys": {**tag, "match": {"address": other}}}))["success"]
    assert TAG not in home._addresses
    assert home.located.get("keys") is None or home.located["keys"].room is None
    # The old tag heard again says nothing of the keys; an old packet replayed neither.
    _ticks(home, radio, TAG, "living", 3)
    assert home.located["keys"].room is None
    radio.send(Advert(other, LIVING_PROXY, -50, time=locator_clock(home).now - 100))
    home._tick()
    assert home.located["keys"].receivers == 0


async def test_the_settings_are_checked(
    hass: HomeAssistant,
    home: Locator,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
) -> None:
    client = await hass_ws_client(hass)
    tag = {"name": "Keys", "kind": "thing", "match": {"address": TAG}}
    for devices in (
        {"Bad Id": tag},
        {"keys": {**tag, "kind": "car"}},
        {"keys": {**tag, "name": " "}},
        {"keys": {**tag, "match": {"address": "nope"}}},
        {"keys": {**tag, "match": {"address": TAG, "key": "x"}}},
        {"keys": {**tag, "match": {"beacon": {"uuid": "x", "major": 1, "minor": 2}}}},
        {"keys": {**tag, "person": "light.kitchen"}},
        {"keys": {**tag, "colour": "red"}},
        {"keys": tag, "keys_2": tag},
        {
            "a": {**tag, "match": {"beacon": {"uuid": UUID, "major": 1, "minor": 2}}},
            "b": {**tag, "match": {"beacon": {"minor": 2, "major": 1, "uuid": UUID}}},
        },
        {f"d{i}": {**tag, "match": {"address": f"F1:00:00:00:00:{i:02X}"}} for i in range(31)},
    ):
        answer = await _follow(client, devices)
        assert answer["error"]["code"] == "invalid_locating", devices
    answer = await _call(client, "save", receivers={"nope": {"room": "x"}}, devices={})
    assert answer["error"]["code"] == "invalid_locating"
    answer = await _call(client, "save", receivers={TAG: {"floor": "x"}}, devices={})
    assert answer["error"]["code"] == "invalid_locating"
    assert (await _follow(client, {"keys": tag}, expected_revision=0))["success"]
    answer = await _follow(client, {"keys": tag}, expected_revision=0)
    assert answer["error"]["code"] == "revision_conflict"
    # Administrators only.
    user = await hass_ws_client(hass, hass_read_only_access_token)
    for kind, data in (
        ("get", {}),
        ("candidates", {}),
        ("save", {"receivers": {}, "devices": {}}),
        ("teach", {"device": "keys", "room": "hall"}),
        ("forget", {}),
    ):
        assert (await _call(user, kind, **data))["error"]["code"] == "unauthorized", kind


async def test_a_room_is_taught_and_forgotten(
    hass: HomeAssistant,
    home: Locator,
    radio: FakeRadio,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    tag = {"name": "Keys", "kind": "thing", "match": {"address": TAG}}
    assert (await _follow(client, {"keys": tag}))["success"]
    for kind, data, code in (
        ("teach", {"device": "nope", "room": "hall"}, "unknown_device"),
        ("teach", {"device": "keys", "room": "attic"}, "unknown_room"),
    ):
        assert (await _call(client, kind, **data))["error"]["code"] == code

    async def listening(seconds: float) -> None:
        # While "waiting", the keys are held in the kitchen, louder than the plan says there.
        for _ in range(5):
            locator_clock(home).now += 2
            for source in (LIVING_PROXY, BEDROOM_PROXY, HALL_PROXY):
                radio.send(Advert(TAG, source, -45 if source == LIVING_PROXY else -80))
            home._tick()

    with patch("custom_components.domotwin.locator.asyncio.sleep", listening):
        answer = await _call(client, "teach", device="keys", room="kitchen", seconds=10)
    assert answer["result"] == {"readings": 5, "receivers": 3}
    expected = home.model.expected("kitchen", LIVING_PROXY)
    assert expected is not None
    assert expected[0] > home._prior["kitchen", LIVING_PROXY][0] + 5
    got = (await _call(client, "get"))["result"]
    assert got["learned"]["kitchen"] == pytest.approx(15)
    # What each receiver learned there, for the placement advisor (D-066): what was heard, the
    # little learned of the keys' own loudness meanwhile taken away.
    heard = got["heard"]["kitchen"]
    assert heard[LIVING_PROXY] == {"signal": pytest.approx(-45, abs=1), "readings": 5.0}
    assert heard[HALL_PROXY] == {"signal": pytest.approx(-80, abs=1), "readings": 5.0}
    # Kept for the next start (the store saves a minute later, or when DomoTwin is unloaded), and
    # read back.
    await home.async_flush()
    assert "kitchen" in hass_storage[LOCATING_LEARNED_KEY]["data"]["rooms"]
    again = Locator(hass, hass.data[DATA_KEY], "entry")
    await again.async_load()
    assert again.learned_rooms() == got["learned"]
    assert (await _call(client, "forget", room="kitchen"))["result"] == {"forgotten": 3}
    assert (await _call(client, "get"))["result"]["learned"] == {}


async def test_presence_sensors_confirm_and_teach(
    hass: HomeAssistant, home: Locator, radio: FakeRadio, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    entry = er.async_get(hass).async_get_or_create(
        "binary_sensor", "mmwave", "bedroom-1", original_device_class="occupancy"
    )
    er.async_get(hass).async_update_entity(entry.entity_id, area_id="bedroom")
    hass.states.async_set(entry.entity_id, "on", {"device_class": "occupancy"})
    # A phone (carried): presence sensors weigh in and teach; keys (things) are left alone.
    phone = {"name": "Phone", "kind": "phone", "match": {"address": TAG}}
    keys = {"name": "Keys", "kind": "thing", "match": {"address": "F2:00:00:00:00:02"}}
    assert (await _follow(client, {"keys": keys}))["success"]
    await hass.async_block_till_done()
    assert home._presence["bedroom"] == [entry.entity_id]
    _ticks(home, radio, "F2:00:00:00:00:02", "bedroom", 6)
    assert home.located["keys"].room == "bedroom"
    assert home.learned_rooms() == {}
    assert (await _follow(client, {"phone": phone}))["success"]
    _ticks(home, radio, TAG, "bedroom", 6)
    assert home.located["phone"].room == "bedroom"
    assert home.learned_rooms().get("bedroom", 0) > 0


async def test_a_thing_left_behind_is_told_and_found_by_voice(
    hass: HomeAssistant, home: Locator, radio: FakeRadio, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    keys = {"name": "Keys", "kind": "thing", "person": "person.alex", "match": {"address": TAG}}
    assert (await _follow(client, {"keys": keys}))["success"]
    await hass.async_block_till_done()
    # A thing does not place its owner.
    assert hass.data[PEOPLE_KEY].sources("person.alex") == []
    _ticks(home, radio, TAG, "hall", 4)
    await hass.async_block_till_done()
    left = "binary_sensor.domotwin_keys_left_behind"
    assert _state(hass, left).state == "off"
    hass.states.async_set("person.alex", "not_home", {"friendly_name": "Alex"})
    later = dt_util.utcnow() + timedelta(minutes=5)
    # Not known to be away (unknown after a restart): not left behind.
    hass.states.async_set("person.alex", "unknown", {"friendly_name": "Alex"})
    with patch("custom_components.domotwin.locator.dt_util.utcnow", return_value=later):
        _ticks(home, radio, TAG, "hall", 1)
    await hass.async_block_till_done()
    assert _state(hass, left).state == "off"
    hass.states.async_set("person.alex", "not_home", {"friendly_name": "Alex"})
    with patch("custom_components.domotwin.locator.dt_util.utcnow", return_value=later):
        _ticks(home, radio, TAG, "hall", 1)
    await hass.async_block_till_done()
    assert _state(hass, left).state == "on"
    assert _state(hass, left).attributes["room_id"] == "hall"
    # From one zone to another: still away, still left behind.
    hass.states.async_set("person.alex", "Work", {"friendly_name": "Alex"})
    with patch("custom_components.domotwin.locator.dt_util.utcnow", return_value=later):
        _ticks(home, radio, TAG, "hall", 1)
    await hass.async_block_till_done()
    assert _state(hass, left).state == "on"
    assert _state(hass, left).name == "DomoTwin Left behind: Keys"

    answer = cast(
        "dict[str, Any]",
        await hass.services.async_call(
            "domotwin", "where", {"name": "my keys"}, blocking=True, return_response=True
        ),
    )
    assert answer["text"] == "I hear Keys in the Hall."
    assert answer["things"][0]["left_behind"] is True
    hass.config.language = "fr"
    answer = cast(
        "dict[str, Any]",
        await hass.services.async_call(
            "domotwin", "where", {"name": "les keys"}, blocking=True, return_response=True
        ),
    )
    assert answer["text"] == "J'entends Keys dans la pièce Hall."


async def test_a_person_is_meant_before_their_phone(
    hass: HomeAssistant, home: Locator, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    phone = {
        "name": "Alex's phone",
        "kind": "phone",
        "person": "person.alex",
        "match": {"address": TAG},
    }
    assert (await _follow(client, {"alex_phone": phone}))["success"]
    await hass.async_block_till_done()
    answer = cast(
        "dict[str, Any]",
        await hass.services.async_call(
            "domotwin", "where", {"name": "Alex"}, blocking=True, return_response=True
        ),
    )
    assert answer["people"][0]["person"] == "person.alex"
    answer = cast(
        "dict[str, Any]",
        await hass.services.async_call(
            "domotwin", "where", {"name": "Alex's phone"}, blocking=True, return_response=True
        ),
    )
    assert answer["text"] == "I cannot hear Alex's phone now."


async def test_diagnostics_count_the_locating_only(
    hass: HomeAssistant, home: Locator, hass_ws_client: WebSocketGenerator
) -> None:
    from custom_components.domotwin.diagnostics import (  # noqa: PLC0415
        async_get_config_entry_diagnostics,
    )

    client = await hass_ws_client(hass)
    tag = {"name": "Keys", "kind": "thing", "match": {"address": TAG}}
    assert (await _follow(client, {"keys": tag}))["success"]
    entry = hass.config_entries.async_entries("domotwin")[0]
    found = await async_get_config_entry_diagnostics(hass, entry)
    assert found["locating"]["receivers"] == 4
    assert found["locating"]["placed_receivers"] == 3
    assert found["locating"]["devices"] == {"phone": 0, "watch": 0, "thing": 1}
    assert TAG not in str(found)
    assert "Keys" not in str(found)


async def test_without_bluetooth_nothing_is_heard(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    got = (await _call(client, "get"))["result"]
    assert (got["status"], got["receivers"], got["devices"]) == ("no_bluetooth", [], {})
    tag = {"name": "Keys", "kind": "thing", "match": {"address": TAG}}
    assert (await _call(client, "save", receivers={}, devices={"keys": tag}))["success"]
    answer = await _call(client, "teach", device="keys", room="x")
    assert answer["error"]["code"] == "no_bluetooth"
    assert ha_radio(hass) is None


def _scanner(source: str, stamps: dict[str, float] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        source=source,
        name=f"proxy {source}",
        time_since_last_detection=lambda: 2.0,
        discovered_device_timestamps=stamps,
    )


async def test_home_assistant_bluetooth_is_heard_both_ways(hass: HomeAssistant) -> None:
    """Every packet where Home Assistant offers it; else the latest, read every second."""
    calls: list[Any] = []
    info = SimpleNamespace(
        address="aa:bb:cc:dd:ee:ff",
        source="11:22:33:44:55:66",
        rssi=-61,
        name="Tag",
        manufacturer_data={76: b"\x02\x15"},
        time=5.0,
    )

    matched: list[Any] = []

    def register(hass: HomeAssistant, cb: Any, *rest: Any) -> Callable[[], None]:
        calls.append(cb)
        matched.append(rest[0])
        return lambda: None

    every = SimpleNamespace(
        BluetoothScanningMode=SimpleNamespace(PASSIVE="passive"),
        async_current_scanners=lambda hass: [_scanner("11:22:33:44:55:66")],
        async_register_callback=register,
        async_register_advertisement_callback=register,
        async_discovered_service_info=lambda hass, connectable: [info],
    )
    radio = HaRadio(hass, every)
    assert radio.receivers() == [Receiver("11:22:33:44:55:66", "proxy 11:22:33:44:55:66", 2.0)]
    heard: list[Advert] = []
    radio.watch(heard.append)
    radio.follow("AA:BB:CC:DD:EE:FF", heard.append)
    calls[0](info, "advertisement")
    calls[1](info)
    assert [h.address for h in heard] == ["AA:BB:CC:DD:EE:FF"] * 2
    # Advertisements that cannot be connected to are heard too (beacons, tags).
    assert matched[0] == {"connectable": False}
    assert heard[0].rssi == -61
    assert radio.seen()[0].name == "Tag"

    # An older Home Assistant: the latest packet of each receiver, when it is new.
    stamps = {"AA:BB:CC:DD:EE:FF": 1.0}
    found = SimpleNamespace(
        scanner=_scanner("11:22:33:44:55:66", stamps),
        advertisement=SimpleNamespace(rssi=-70, manufacturer_data={}),
    )
    older = SimpleNamespace(
        async_current_scanners=lambda hass: [],
        async_scanner_devices_by_address=lambda hass, address, connectable: [found],
    )
    radio = HaRadio(hass, older)
    polled: list[Advert] = []
    stop = radio.follow("AA:BB:CC:DD:EE:FF", polled.append)
    radio._poll()
    radio._poll()
    stamps["AA:BB:CC:DD:EE:FF"] = 2.0
    radio._poll()
    assert [p.rssi for p in polled] == [-70, -70]
    stop()
    assert radio._stop_polling is None


async def test_the_rooms_found_are_measured_beside_bermuda(
    hass: HomeAssistant,
    home: Locator,
    radio: FakeRadio,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    """M41: DomoTwin's rooms counted, Bermuda's area sensor of the same phone beside them."""
    client = await hass_ws_client(hass)
    bermuda = er.async_get(hass).async_get_or_create(
        "sensor", "bermuda", "f1:22:33:44:55:66_area", suggested_object_id="alex_phone_area"
    )
    er.async_get(hass).async_get_or_create("sensor", "bermuda", "f1:22:33:44:55:66_distance")
    sensor = er.async_get(hass).async_get_or_create(
        "binary_sensor", "mmwave", "living-1", original_device_class="occupancy"
    )
    er.async_get(hass).async_update_entity(sensor.entity_id, area_id="living_room")
    hass.states.async_set(sensor.entity_id, "on", {"device_class": "occupancy"})
    answer = await _call(client, "get")
    # Only Bermuda's area sensors are offered.
    assert answer["result"]["bermuda"] == [bermuda.entity_id]
    phone = {
        "name": "Alex's phone",
        "kind": "phone",
        "person": "person.alex",
        "match": {"address": TAG},
        "bermuda": bermuda.entity_id,
    }
    assert (await _follow(client, {"alex_phone": phone}))["success"]
    await hass.async_block_till_done()
    assert (await _call(client, "get"))["result"]["devices"]["alex_phone"]["bermuda"] == (
        bermuda.entity_id
    )

    # The rooms settle for a minute after a start: Bermuda agrees meanwhile.
    hass.states.async_set(bermuda.entity_id, "living room")
    _ticks(home, radio, TAG, "living", 31)
    # Then Bermuda flickers between the living room and the bedroom, by name or by area id.
    for k in range(12):
        if k % 2:
            hass.states.async_set(bermuda.entity_id, "Bedroom", {"area_id": "bedroom"})
        else:
            hass.states.async_set(bermuda.entity_id, "living room")
        _ticks(home, radio, TAG, "living", 1)
    measured = (await _call(client, "measure"))["result"]
    shown = measured["devices"]["alex_phone"]
    assert shown["domotwin"]["changes_per_hour"] == 0.0
    assert shown["domotwin"]["short_stays"] == 0
    assert shown["bermuda"]["changes_per_hour"] > 100
    assert shown["bermuda"]["short_stays"] >= 9
    assert 0.5 < shown["agreement"] < 0.95
    # Alex alone at home, the living room's presence sensor alone on: DomoTwin right.
    assert shown["domotwin"]["right_share"] == 1.0
    assert shown["bermuda"]["right_share"] < 0.95
    # Away from Bermuda's sensor: unknown for Bermuda.
    hass.states.async_set(bermuda.entity_id, "unknown")
    _ticks(home, radio, TAG, "living", 2)
    shown = (await _call(client, "measure"))["result"]["devices"]["alex_phone"]
    assert shown["bermuda"]["unknown_share"] > 0

    # Kept with what is learned (a save always waiting while measuring, written within ten
    # minutes, or when Home Assistant stops), figures only in the diagnostics.
    assert home._save_due is not None
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=11))
    await hass.async_block_till_done()
    kept = hass_storage[LOCATING_LEARNED_KEY]["data"]["measure"]
    assert kept["devices"]["alex_phone"]["bermuda"]["changes"] >= 10
    from custom_components.domotwin.diagnostics import (  # noqa: PLC0415
        async_get_config_entry_diagnostics,
    )

    entry = hass.config_entries.async_entries("domotwin")[0]
    found = await async_get_config_entry_diagnostics(hass, entry)
    assert found["locating"]["measured"]["devices"][0]["bermuda"]["short_stays"] >= 9
    assert "alex_phone" not in str(found["locating"])
    assert "Alex" not in str(found["locating"])

    # Started again.
    again = await _call(client, "measure/reset")
    assert again["success"]
    assert (await _call(client, "measure"))["result"]["devices"] == {}


async def test_bermuda_unpaired_or_another_device_starts_its_figures_again(
    hass: HomeAssistant, home: Locator, radio: FakeRadio, hass_ws_client: WebSocketGenerator
) -> None:
    """M41: figures of a sensor no longer paired, or of a tag no longer followed, go."""
    client = await hass_ws_client(hass)
    phone = {
        "name": "Alex's phone",
        "kind": "phone",
        "person": "person.alex",
        "match": {"address": TAG},
        "bermuda": "sensor.alex_phone_area",
    }
    bad = {**phone, "bermuda": "light.lamp"}
    refused = await _follow(client, {"alex_phone": bad})
    assert refused["error"]["code"] == "invalid_locating"
    # A sensor Home Assistant knows as another integration's is not Bermuda's.
    other = er.async_get(hass).async_get_or_create(
        "sensor", "demo", "living-temperature", suggested_object_id="living_temperature"
    )
    refused = await _follow(client, {"alex_phone": {**phone, "bermuda": other.entity_id}})
    assert refused["error"]["code"] == "invalid_locating"
    # One Bermuda sensor, one device.
    watch = {**phone, "name": "Watch", "kind": "watch", "match": {"address": "F1:22:33:44:55:77"}}
    refused = await _follow(client, {"alex_phone": phone, "watch": watch})
    assert refused["error"]["code"] == "invalid_locating"
    assert (await _follow(client, {"alex_phone": phone}))["success"]
    await hass.async_block_till_done()
    hass.states.async_set("sensor.alex_phone_area", "Living room", {"area_id": "living_room"})
    _ticks(home, radio, TAG, "living", 3)
    shown = (await _call(client, "measure"))["result"]["devices"]["alex_phone"]
    assert set(shown) == {"domotwin", "domotwin_areas", "bermuda", "agreement"}
    # Paired no more: Bermuda's figures go with it.
    assert (await _follow(client, {"alex_phone": {**phone, "bermuda": None}}))["success"]
    await hass.async_block_till_done()
    _ticks(home, radio, TAG, "living", 1)
    shown = (await _call(client, "measure"))["result"]["devices"]["alex_phone"]
    assert set(shown) == {"domotwin"}
    # Known another way (another tag under its id): its figures start again.
    retagged = {**phone, "match": {"address": "F1:22:33:44:55:88"}}
    del retagged["bermuda"]
    assert (await _follow(client, {"alex_phone": retagged}))["success"]
    await hass.async_block_till_done()
    assert "alex_phone" not in home.measure.devices


async def test_an_iphones_key_goes_to_private_ble_device(
    hass: HomeAssistant, home: Locator, hass_ws_client: WebSocketGenerator
) -> None:
    """D-075: the key, however it is written, handed to Private BLE Device; never said back."""
    client = await hass_ws_client(hass)
    written = "irk:11111111 22222222 33333333 44444444"
    flows = hass.config_entries.flow

    async def add(key: str) -> dict[str, Any]:
        return await _call(client, "add_key", key=key)

    assert (await add("not a key"))["error"]["code"] == "invalid_key"
    # Too long: refused by the locator, not by the schema, whose error would say it back.
    long = await add("1111" * 30)
    assert long["error"]["code"] == "invalid_key"
    assert "1111" not in long["error"]["message"]
    # Home Assistant has no Bluetooth: Private BLE Device says so.
    abort = {"type": FlowResultType.ABORT, "reason": "bluetooth_not_available"}
    with patch.object(flows, "async_init", AsyncMock(return_value=abort)):
        assert (await add(written))["error"]["code"] == "no_bluetooth"
    # The phone not heard: the flow left is closed.
    opened = {"type": FlowResultType.FORM, "flow_id": "f1", "errors": {}}
    unheard = {"type": FlowResultType.FORM, "flow_id": "f1", "errors": {"irk": "irk_not_found"}}
    closed = Mock()
    with (
        patch.object(flows, "async_init", AsyncMock(return_value=opened)),
        patch.object(flows, "async_configure", AsyncMock(return_value=unheard)) as configure,
        patch.object(flows, "async_abort", closed),
    ):
        answer = await add(written)
    assert answer["error"]["code"] == "key_not_heard"
    assert "1111" not in answer["error"]["message"]
    closed.assert_called_once_with("f1")
    # Sent as hex, whatever the tool wrote.
    assert configure.call_args.args[1] == {"irk": "11111111222222223333333344444444"}
    # Taken: its entry, by its title; the device can be followed by it.
    entry = MockConfigEntry(
        domain="private_ble_device",
        title="Sam's iPhone",
        data={"irk": "11111111222222223333333344444444"},
    )
    created = {"type": FlowResultType.CREATE_ENTRY, "flow_id": "f1", "result": entry}
    with (
        patch.object(flows, "async_init", AsyncMock(return_value=opened)),
        patch.object(flows, "async_configure", AsyncMock(return_value=created)),
    ):
        answer = await add(written)
    assert answer["result"] == {
        "entry": entry.entry_id,
        "title": "Sam's iPhone",
        "named": True,
        "added": True,
    }
    # Already there: its entry given back, Private BLE Device not asked again.
    entry.add_to_hass(hass)
    with patch.object(flows, "async_init", AsyncMock()) as asked:
        answer = await add("RERERDMzMzMiIiIiEREREQ==")
    assert answer["result"]["added"] is False
    assert answer["result"]["entry"] == entry.entry_id
    asked.assert_not_called()
    candidates = (await _call(client, "candidates"))["result"]["candidates"]
    assert {"match": {"key": entry.entry_id}, "name": "Sam's iPhone"} in candidates


async def test_a_key_refused_leaves_no_flow_open(hass: HomeAssistant, home: Locator) -> None:
    """D-075: what Private BLE Device answers, each said plainly; its setup never left open."""
    written = "11111111222222223333333344444444"
    flows = hass.config_entries.flow
    opened = {"type": FlowResultType.FORM, "flow_id": "f1", "errors": {}}

    async def code(configure: AsyncMock, init: AsyncMock | None = None) -> str:
        closed = Mock()
        with (
            patch.object(flows, "async_init", init or AsyncMock(return_value=opened)),
            patch.object(flows, "async_configure", configure),
            patch.object(flows, "async_abort", closed),
            pytest.raises(KeyNotTakenError) as refused,
        ):
            await home.async_add_key(written)
        if configure.await_count:
            closed.assert_called_once_with("f1")
        return refused.value.code

    def answers(**result: Any) -> AsyncMock:
        return AsyncMock(return_value={"flow_id": "f1", **result})

    form = FlowResultType.FORM
    assert await code(answers(type=form, errors={"irk": "irk_not_valid"})) == "invalid_key"
    assert await code(answers(type=form, errors={"irk": "something_new"})) == "key_refused"
    # Bluetooth gone between the two steps.
    gone = answers(type=FlowResultType.ABORT, reason="bluetooth_not_available")
    assert await code(gone) == "no_bluetooth"
    busy = answers(type=FlowResultType.ABORT, reason="already_in_progress")
    assert await code(busy) == "key_refused"
    # Private BLE Device cannot be set up, or its setup fails: refused, the flow closed.
    missing = AsyncMock(side_effect=UnknownHandler)
    assert await code(AsyncMock(), missing) == "key_refused"
    assert await code(AsyncMock(side_effect=UnknownFlow)) == "key_refused"
    # Its form asking for another field: refused, never said with the command (the key in it).
    other = InvalidData("extra keys not allowed", ["irk"], None, {"irk": "extra"})
    assert await code(AsyncMock(side_effect=other)) == "key_refused"
    # Without Bluetooth, Private BLE Device is not asked: its first step would fail.
    radio, home.radio = home.radio, None
    with (
        patch.object(flows, "async_init", AsyncMock()) as asked,
        pytest.raises(KeyNotTakenError) as refusal,
    ):
        await home.async_add_key(written)
    home.radio = radio
    assert refusal.value.code == "no_bluetooth"
    asked.assert_not_called()


async def test_one_key_added_twice_at_once_makes_one_entry(
    hass: HomeAssistant, home: Locator
) -> None:
    """D-075: two clicks at once: one entry, the second given it back; known by its unique id."""
    flows = hass.config_entries.flow
    opened = {"type": FlowResultType.FORM, "flow_id": "f1", "errors": {}}
    entry = MockConfigEntry(
        domain="private_ble_device",
        title="AB:CD:EF:01:23:45",
        unique_id="11111111222222223333333344444444",
        data={"irk": "something else"},
    )

    async def create(flow: str, data: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(0)
        entry.add_to_hass(hass)
        return {"type": FlowResultType.CREATE_ENTRY, "flow_id": flow, "result": entry}

    with (
        patch.object(flows, "async_init", AsyncMock(return_value=opened)) as init,
        patch.object(flows, "async_configure", AsyncMock(side_effect=create)),
    ):
        first, second = await asyncio.gather(
            home.async_add_key("11111111222222223333333344444444"),
            home.async_add_key("irk:11111111222222223333333344444444"),
        )
    init.assert_awaited_once()
    # Titled by an address: not a name (the frontend calls it an iPhone).
    assert first == {
        "entry": entry.entry_id,
        "title": "AB:CD:EF:01:23:45",
        "named": False,
        "added": True,
    }
    assert second == {**first, "added": False}


async def test_private_ble_devices_own_setup_takes_the_key(
    hass: HomeAssistant, home: Locator
) -> None:
    """D-075: Private BLE Device's real setup, its field, errors and titles as DomoTwin reads them.

    Only Bluetooth is played: a receiver, and the phone heard (or not), with or without a name.
    """
    flows = hass.config_entries.flow
    heard: SimpleNamespace | None = None
    receivers = 1
    # Bluetooth played by stand-ins of the two modules Private BLE Device's setup reads it from
    # (Home Assistant's own needs libraries a home's adapters use, not installed here); the setup
    # itself is Private BLE Device's own, imported afresh beside them and forgotten after.
    bluetooth = ModuleType("homeassistant.components.bluetooth")
    bluetooth.async_scanner_count = lambda *_, **__: receivers  # type: ignore[attr-defined]
    coordinator = ModuleType("homeassistant.components.private_ble_device.coordinator")
    coordinator.async_last_service_info = lambda *_: heard  # type: ignore[attr-defined]
    stand_ins = {
        "homeassistant.components.bluetooth": bluetooth,
        "homeassistant.components.private_ble_device.coordinator": coordinator,
    }
    package = importlib.import_module("homeassistant.components.private_ble_device")
    components = importlib.import_module("homeassistant.components")

    async def add(key: str) -> dict[str, Any]:
        with (
            patch.dict(sys.modules, stand_ins),
            patch.object(components, "bluetooth", bluetooth, create=True),
            # Bluetooth is not set up either: only what Private BLE Device asks of it.
            patch("homeassistant.config_entries.async_process_deps_reqs", return_value=None),
            patch.object(hass.config_entries, "async_setup", AsyncMock(return_value=True)),
        ):
            sys.modules.pop("homeassistant.components.private_ble_device.config_flow", None)
            try:
                return await home.async_add_key(key)
            finally:
                vars(package).pop("config_flow", None)
                vars(package).pop("coordinator", None)

    async def refused(key: str) -> str:
        with pytest.raises(KeyNotTakenError) as refusal:
            await add(key)
        # Its setup is never left open.
        assert flows.async_progress_by_handler("private_ble_device") == []
        return refusal.value.code

    assert await refused("11111111222222223333333344444444") == "key_not_heard"
    receivers = 0
    assert await refused("11111111222222223333333344444444") == "no_bluetooth"
    receivers = 1
    # Heard, sending no name: Private BLE Device's default title, not a name.
    heard = SimpleNamespace(name=None)
    answer = await add("RERERDMzMzMiIiIiEREREQ==")
    assert answer["named"] is False
    assert answer["added"] is True
    entry = hass.config_entries.async_get_entry(answer["entry"])
    assert entry is not None
    assert entry.data == {"irk": "11111111222222223333333344444444"}
    assert entry.unique_id == "11111111222222223333333344444444"
    # Heard by its name.
    heard = SimpleNamespace(name="Sam's watch")
    answer = await add("irk:55555555666666667777777788888888")
    assert (answer["title"], answer["named"], answer["added"]) == ("Sam's watch", True, True)
    # Given again: the entry already there.
    again = await add("55555555 66666666 77777777 88888888")
    assert again == {**answer, "added": False}
