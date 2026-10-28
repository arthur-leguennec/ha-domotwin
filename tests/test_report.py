"""The weekly home report (D-081): what needs a look, the week's energy and peaks, on its day."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
from pytest_homeassistant_custom_component.common import (
    CLIENT_ID,
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)
from pytest_homeassistant_custom_component.typing import (
    ClientSessionGenerator,
    WebSocketGenerator,
)

from custom_components.domotwin.const import (
    MAX_REPORT_ITEMS,
    MAX_REPORTS,
    REPORT_EVENT,
    REPORT_STORAGE_KEY,
)
from custom_components.domotwin.data import REPORT_KEY
from custom_components.domotwin.report import CATCH_UP_DELAY, last_slot, read_settings
from custom_components.domotwin.report_look import Places
from custom_components.domotwin.report_radios import read_radio, weak_radios
from custom_components.domotwin.report_week import (
    Meters,
    async_state_windows,
    closed_energy,
    energy,
    merge,
    peaks,
    sources_of,
    week_of,
    within,
)
from custom_components.domotwin.report_words import ask, notification
from homeassistant.auth.const import GROUP_ID_ADMIN
from homeassistant.components import persistent_notification
from homeassistant.core import HomeAssistant, ServiceCall, State, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    issue_registry as ir,
)
from homeassistant.util import dt as dt_util

#: Monday 26 October 2026, 7:30 in Montréal: the report is due at 8.
MONDAY = datetime(2026, 10, 26, 11, 30, tzinfo=UTC)
ZONE = "America/Toronto"

#: A fictional home: the demo apartment's rooms, in their areas.
AREAS = {"living_room": "Living room", "kitchen": "Kitchen", "hallway": "Hallway"}


async def _send(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


async def _admin(hass: HomeAssistant, hass_ws_client: WebSocketGenerator) -> Any:
    """An administrator's connection, their token made now (the clock may have been moved)."""
    admin = await hass.auth.async_create_user("Administrator", group_ids=[GROUP_ID_ADMIN])
    refresh = await hass.auth.async_create_refresh_token(admin, CLIENT_ID)
    return await hass_ws_client(hass, hass.auth.async_create_access_token(refresh))


async def _home(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory | None = None,
    when: datetime | None = None,
) -> Any:
    """DomoTwin set up with the demo apartment and its links, at `when`.

    Set up before an administrator connects: Home Assistant's views are registered while it sets
    up, before its server starts. Their token is made then, at `when`, so the clock moved to
    another week does not refuse it.
    """
    if freezer is not None and when is not None:
        freezer.move_to(when)
    await hass.config.async_set_time_zone(ZONE)
    areas = ar.async_get(hass)
    for area_id, name in AREAS.items():
        areas.async_create(name)
        assert areas.async_get_area(area_id) is not None
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await _admin(hass, hass_ws_client)
    for message in (
        {"type": "domotwin/plan/save", "plan": demo_plan},
        {"type": "domotwin/bindings/save", "bindings": demo_bindings},
    ):
        assert (await _send(client, message))["success"]
    return client


def _device(
    hass: HomeAssistant, entry: MockConfigEntry, name: str, area: str | None = None
) -> dr.DeviceEntry:
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("test", name)}, name=name
    )
    if area:
        device = dr.async_get(hass).async_update_device(device.id, area_id=area) or device
    return device


def _entity(
    hass: HomeAssistant,
    entry: MockConfigEntry,
    entity_id: str,
    *,
    device: dr.DeviceEntry | None = None,
    platform: str = "test",
    translation_key: str | None = None,
    unique_id: str | None = None,
) -> er.RegistryEntry:
    domain, object_id = entity_id.split(".", 1)
    return er.async_get(hass).async_get_or_create(
        domain,
        platform,
        unique_id or object_id,
        suggested_object_id=object_id,
        config_entry=entry,
        device_id=device.id if device else None,
        translation_key=translation_key,
    )


async def _write(client: Any) -> dict[str, Any]:
    answer = await _send(client, {"type": "domotwin/report/write"})
    assert answer["success"], answer
    report: dict[str, Any] = answer["result"]["report"]
    return report


def _names(report: dict[str, Any], section: str) -> list[str]:
    return [item["name"] for item in report["sections"][section]]


def _batteries(hass: HomeAssistant, other: MockConfigEntry) -> None:
    # A sensor at 12 % in the kitchen's area; a door's battery said low; one charging.
    sensor = _device(hass, other, "Kitchen motion", "kitchen")
    _entity(hass, other, "sensor.kitchen_motion_battery", device=sensor)
    hass.states.async_set(
        "sensor.kitchen_motion_battery",
        "12",
        {"device_class": "battery", "unit_of_measurement": "%"},
    )
    hass.states.async_set(
        "binary_sensor.front_door_battery",
        "on",
        {"device_class": "battery", "friendly_name": "Door"},
    )
    phone = _device(hass, other, "Phone")
    _entity(hass, other, "sensor.phone_battery", device=phone)
    _entity(hass, other, "binary_sensor.phone_charging", device=phone)
    hass.states.async_set(
        "sensor.phone_battery", "8", {"device_class": "battery", "unit_of_measurement": "%"}
    )
    hass.states.async_set(
        "binary_sensor.phone_charging", "on", {"device_class": "battery_charging"}
    )
    hass.states.async_set(
        "sensor.full", "80", {"device_class": "battery", "unit_of_measurement": "%"}
    )
    # Battery Notes watches the remote: its threshold and battery, its own level.
    remote = _device(hass, other, "Remote", "living_room")
    _entity(hass, other, "sensor.remote_battery", device=remote)
    hass.states.async_set(
        "sensor.remote_battery", "15", {"device_class": "battery", "unit_of_measurement": "%"}
    )
    notes = MockConfigEntry(domain="battery_notes")
    notes.add_to_hass(hass)
    _entity(
        hass,
        notes,
        "binary_sensor.remote_battery_low",
        device=remote,
        platform="battery_notes",
        translation_key="battery_low",
    )
    _entity(
        hass,
        notes,
        "sensor.remote_battery_plus",
        device=remote,
        platform="battery_notes",
        translation_key="battery_plus",
    )
    hass.states.async_set(
        "binary_sensor.remote_battery_low",
        "on",
        {
            "device_class": "battery",
            "battery_type_and_quantity": "2x AAA",
            "battery_low_threshold": 20,
        },
    )
    hass.states.async_set(
        "sensor.remote_battery_plus", "15", {"device_class": "battery", "unit_of_measurement": "%"}
    )


def _devices_and_updates(hass: HomeAssistant, other: MockConfigEntry) -> None:
    # A plug unavailable for hours.
    plug = _device(hass, other, "Hall plug", "hallway")
    _entity(hass, other, "switch.hall_plug", device=plug)
    _entity(hass, other, "sensor.hall_plug_power", device=plug)
    hass.states.async_set("switch.hall_plug", "unavailable")
    hass.states.async_set("sensor.hall_plug_power", "unavailable")
    # Updates: one waiting, one skipped (off).
    hass.states.async_set(
        "update.router",
        "on",
        {"title": "Router firmware", "installed_version": "1.2", "latest_version": "1.3"},
    )
    hass.states.async_set(
        "update.tv", "off", {"title": "TV", "installed_version": "5", "latest_version": "6"}
    )


def _repairs(hass: HomeAssistant) -> None:
    # Repairs: one waiting, one ignored; and what Watchman finds missing.
    ir.async_create_issue(
        hass,
        "test",
        "old_login",
        is_fixable=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key="old_login",
    )
    ir.async_create_issue(
        hass,
        "test",
        "ignored",
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="ignored",
    )
    ir.async_ignore_issue(hass, "test", "ignored", True)
    watchman = MockConfigEntry(domain="watchman")
    watchman.add_to_hass(hass)
    _entity(
        hass,
        watchman,
        "sensor.watchman_missing_entities",
        platform="watchman",
        translation_key="missing_entities",
        unique_id="watchman_missing_entities",
    )
    _entity(
        hass,
        watchman,
        "sensor.watchman_missing_actions",
        platform="watchman",
        unique_id="abc_watchman_missing_services",
    )
    hass.states.async_set(
        "sensor.watchman_missing_entities",
        "1",
        {
            "entities": [
                {
                    "id": "light.old_lamp",
                    "state": "missing",
                    "occurrences": "📄 automations.yaml:12",
                }
            ]
        },
    )
    hass.states.async_set(
        "sensor.watchman_missing_actions", "1", {"entities": [{"id": "script.gone"}]}
    )


async def _upkeep(client: Any) -> None:
    # Upkeep: the washer's filter overdue, the fridge's warranty ending.
    upkeep = {
        "washer": {
            "tasks": [
                {
                    "id": "filter",
                    "name": "Clean the filter",
                    "every": 3,
                    "unit": "months",
                    "last_done": "2026-06-01",
                }
            ]
        },
        "fridge": {"warranty_end": "2026-11-10"},
    }
    assert (await _send(client, {"type": "domotwin/upkeep/save", "pieces": upkeep}))["success"]


def _automations(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> list[dict[str, Any]]:
    # The automations' registry entries: made a month ago, and this morning.
    freezer.move_to(MONDAY - timedelta(days=30))
    for key, name in (("1", "evening"), ("3", "never")):
        er.async_get(hass).async_get_or_create(
            "automation", "automation", key, suggested_object_id=name
        )
    freezer.move_to(MONDAY)
    er.async_get(hass).async_get_or_create(
        "automation", "automation", "4", suggested_object_id="new"
    )
    # Automations: one that failed (its trace), one that cannot run, one never run.
    for entity_id, state, attributes in (
        (
            "automation.evening",
            "on",
            {"id": "1", "last_triggered": "2026-10-25T21:00:00+00:00", "friendly_name": "Evening"},
        ),
        ("automation.broken", "unavailable", {"friendly_name": "Broken"}),
        ("automation.never", "on", {"id": "3", "last_triggered": None, "friendly_name": "Never"}),
        ("automation.new", "on", {"id": "4", "last_triggered": None, "friendly_name": "New"}),
        ("automation.off", "off", {"id": "5", "last_triggered": None, "friendly_name": "Off"}),
    ):
        hass.states.async_set(entity_id, state, attributes)
    return [
        {
            "item_id": "1",
            "run_id": "r1",
            "error": "Light not found",
            "script_execution": "error",
            "timestamp": {"start": "2026-10-24T22:00:00+00:00"},
        },
        {
            "item_id": "1",
            "run_id": "r2",
            "script_execution": "finished",
            "timestamp": {"start": "2026-10-25T22:00:00+00:00"},
        },
        {
            "item_id": "1",
            "run_id": "r3",
            "script_execution": "aborted",
            "timestamp": {"start": "2026-10-25T22:10:00+00:00"},
        },
        {
            "item_id": "1",
            "run_id": "r0",
            "error": "Too old",
            "timestamp": {"start": "2026-10-01T22:00:00+00:00"},
        },
        {
            "item_id": "1",
            "run_id": "r4",
            "not_triggered": True,
            "error": "x",
            "timestamp": {"start": "2026-10-25T23:00:00+00:00"},
        },
        {
            "item_id": "9",
            "run_id": "r5",
            "error": "No entity",
            "timestamp": {"start": "2026-10-25T23:00:00+00:00"},
        },
    ]


async def test_what_needs_a_look(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Batteries, devices, updates, repairs, upkeep and automations, each in its room."""
    client = await _home(
        hass,
        config_entry,
        hass_ws_client,
        demo_plan,
        demo_bindings,
        freezer,
        MONDAY - timedelta(hours=3),
    )
    other = MockConfigEntry(domain="test")
    other.add_to_hass(hass)
    _batteries(hass, other)
    _devices_and_updates(hass, other)
    _repairs(hass)
    await _upkeep(client)
    traces = _automations(hass, freezer)
    # A lamp just gone (a restart, a blip): not yet unavailable for long.
    lamp = _device(hass, other, "Lamp", "hallway")
    _entity(hass, other, "light.lamp", device=lamp)
    hass.states.async_set("light.lamp", "unavailable")
    hass.config.components.add("trace")
    with patch("homeassistant.components.trace.util.async_list_traces", return_value=traces):
        report = await _write(client)
    sections = report["sections"]
    batteries = {item["name"]: item for item in sections["batteries"]}
    assert set(batteries) == {"Kitchen motion", "Door", "Remote"}
    assert batteries["Kitchen motion"]["level"] == 12
    assert batteries["Kitchen motion"]["room"] == "kitchen"
    assert {key: batteries["Remote"][key] for key in ("source", "level", "battery", "room")} == {
        "source": "battery_notes",
        "level": 15,
        "battery": "2x AAA",
        "room": "living",
    }
    assert "room" not in batteries["Door"]
    assert [item["name"] for item in sections["unavailable"]] == ["Hall plug"]
    assert sections["unavailable"][0]["room"] == "hall"
    assert sections["updates"] == [
        {
            "key": "update:update.router",
            "name": "Router firmware",
            "entity": "update.router",
            "installed": "1.2",
            "latest": "1.3",
        }
    ]
    repairs = {item["key"]: item for item in sections["repairs"]}
    assert repairs["repair:test:old_login"]["name"] == "test: old_login"
    assert repairs["repair:test:old_login"]["severity"] == "error"
    assert "repair:test:ignored" not in repairs
    assert repairs["watchman:missing_entities:light.old_lamp"]["missing"] == "entity"
    assert repairs["watchman:missing_services:script.gone"]["missing"] == "action"
    upkeep_items = {item["key"].split(":")[0]: item for item in sections["upkeep"]}
    assert upkeep_items["upkeep"]["task"] == "Clean the filter"
    assert upkeep_items["upkeep"]["state"] == "overdue"
    assert upkeep_items["warranty"]["warranty_end"] == "2026-11-10"
    automations = {item["problem"]: item for item in sections["automations"]}
    assert set(automations) == {"failed", "broken", "never"}
    assert automations["failed"]["runs"] == 1
    assert automations["failed"]["error"] == "Light not found"
    assert automations["failed"]["run_id"] == "r1"
    assert automations["never"]["entity"] == "automation.never"
    # Nothing to compare with yet: nothing is new.
    assert not any(item.get("new") for items in sections.values() for item in items)
    assert "radios" not in sections


async def test_new_and_done_since_the_last_report(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """What is new since the last report is said; what was done, listed."""
    client = await _home(hass, config_entry, hass_ws_client, demo_plan, demo_bindings)
    battery = {"device_class": "battery", "unit_of_measurement": "%"}
    hass.states.async_set("sensor.a_battery", "5", {**battery, "friendly_name": "A"})
    hass.states.async_set("sensor.b_battery", "6", {**battery, "friendly_name": "B"})
    first = await _write(client)
    hass.states.async_set("sensor.a_battery", "100", battery)
    hass.states.async_set("sensor.c_battery", "7", {**battery, "friendly_name": "C"})
    second = await _write(client)
    assert {item["name"]: item.get("new", False) for item in second["sections"]["batteries"]} == {
        "B": False,
        "C": True,
    }
    assert second["gone"] == {"batteries": [{"key": "battery:sensor.a_battery", "name": "A"}]}
    assert second["id"] == first["id"] + 1
    answer = await _send(client, {"type": "domotwin/report/get", "report": first["id"]})
    assert answer["result"]["report"]["id"] == first["id"]
    assert [entry["id"] for entry in answer["result"]["reports"]] == [second["id"], first["id"]]
    assert answer["result"]["reports"][0]["counts"]["batteries"] == 2
    unknown = await _send(client, {"type": "domotwin/report/get", "report": 999})
    assert unknown["error"]["code"] == "unknown_report"


async def test_a_device_unavailable_stays_so_across_a_restart(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A restart starts the states again: the report before says since when."""
    client = await _home(
        hass, config_entry, hass_ws_client, demo_plan, demo_bindings, freezer, MONDAY
    )
    other = MockConfigEntry(domain="test")
    other.add_to_hass(hass)
    plug = _device(hass, other, "Hall plug", "hallway")
    _entity(hass, other, "switch.hall_plug", device=plug)
    hass.states.async_set("switch.hall_plug", "unavailable")
    freezer.move_to(MONDAY + timedelta(hours=2))
    first = await _write(client)
    assert [item["since"] for item in first["sections"]["unavailable"]] == [MONDAY.isoformat()]
    # Home Assistant restarted: the plug's state is new, still unavailable.
    freezer.move_to(MONDAY + timedelta(days=1))
    hass.states.async_remove("switch.hall_plug")
    hass.states.async_set("switch.hall_plug", "unavailable")
    second = await _write(client)
    assert [item["since"] for item in second["sections"]["unavailable"]] == [MONDAY.isoformat()]
    assert "gone" not in second


async def test_unloaded_while_writing(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """DomoTwin unloaded while its AI task writes: nothing is kept, the one asking is told."""
    client = await _home(hass, config_entry, hass_ws_client, demo_plan, demo_bindings)
    release = asyncio.Event()

    async def generate(call: ServiceCall) -> dict[str, Any]:
        await release.wait()
        return {"data": "Late."}

    hass.services.async_register(
        "ai_task", "generate_data", generate, supports_response=SupportsResponse.ONLY
    )
    saved = await _send(
        client, {"type": "domotwin/report/settings", "settings": {"summary": "ai_task.helper"}}
    )
    assert saved["success"]
    await client.send_json_auto_id({"type": "domotwin/report/write"})
    await hass.async_block_till_done(wait_background_tasks=False)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    release.set()
    answer = await client.receive_json()
    assert answer["error"]["code"] == "not_loaded"
    assert hass_storage[REPORT_STORAGE_KEY]["data"]["reports"] == []


def test_rooms_from_links_and_areas(hass: HomeAssistant) -> None:
    """A piece linked to the entity, its device, or its area's first room."""
    storeys = [
        {
            "id": "s",
            "plan": {
                "rooms": [
                    {
                        "id": "living",
                        "name": "Living",
                        "outline": [[0, 0], [300, 0], [300, 300], [0, 300]],
                    },
                    {
                        "id": "den",
                        "name": "Den",
                        "outline": [[300, 0], [600, 0], [600, 300], [300, 300]],
                    },
                ],
                "items": [{"id": "lamp", "kind": "floor-lamp", "at": [100, 100]}],
                "doors": [{"id": "door", "from": [300, 100], "to": [300, 180], "room": "den"}],
            },
        }
    ]
    entry = MockConfigEntry(domain="test")
    entry.add_to_hass(hass)
    areas = ar.async_get(hass)
    lounge = areas.async_create("Lounge")
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    lamp = _device(hass, entry, "Lamp")
    _entity(hass, entry, "light.lamp", device=lamp)
    _entity(hass, entry, "sensor.lamp_power", device=lamp)
    contact = _device(hass, entry, "Contact")
    _entity(hass, entry, "binary_sensor.contact", device=contact)
    lounge_device = _device(hass, entry, "Thermostat", lounge.id)
    _entity(hass, entry, "climate.lounge", device=lounge_device)
    bindings = {
        "rooms": {"living": {"area": lounge.id}},
        "elements": {
            "lamp": {"entities": [{"entity_id": "light.lamp"}]},
            "door": {"entities": [], "device": contact.id},
        },
    }
    places = Places(storeys, bindings, areas, devices, entities)
    assert places.of_entity("light.lamp") == "living"
    # Its device's other entity: through the piece linked to the device's entity.
    assert places.of_entity("sensor.lamp_power") == "living"
    assert places.of_entity("binary_sensor.contact") == "den"
    assert places.of_entity("climate.lounge") == "living"
    assert places.of_entity("sensor.nowhere") is None
    assert places.of_device(None) is None


def test_weak_radios_by_the_network_maps_rules() -> None:
    """The widest way to the coordinator; a weak link, or none; stale devices left out."""
    now = datetime(2026, 10, 26, 12, tzinfo=UTC)

    def zha(ieee: str, kind: str, neighbours: list[tuple[str, str, str]], **more: Any) -> Any:
        return read_radio(
            {
                "ieee": ieee,
                "name": ieee.upper(),
                "device_type": kind,
                "available": True,
                "last_seen": "2026-10-26T07:55:00",
                "device_reg_id": f"dev-{ieee}",
                "neighbors": [
                    {"ieee": other, "lqi": lqi, "relationship": relation}
                    for other, lqi, relation in neighbours
                ],
                **more,
            },
            dt_util.get_time_zone(ZONE),
        )

    radios = [
        zha(
            "c",
            "Coordinator",
            [("r", "200", "Child"), ("w", "40", "Child"), ("x", "255", "PreviousChild")],
        ),
        zha("r", "Router", [("c", "180", "Parent"), ("e", "120", "Child"), ("w", "60", "Sibling")]),
        zha("e", "EndDevice", []),
        # Heard from the coordinator at 40 and the router at 60: its best way is weak.
        zha("w", "Router", []),
        # Only a child that left: no way at all.
        zha("x", "EndDevice", []),
        # Not heard from for two days: left to the devices unavailable.
        zha("s", "EndDevice", [("c", "20", "Parent")], last_seen="2026-10-24T08:00:00"),
        zha("u", "Router", [("c", "10", "Parent")], available=False),
    ]
    assert all(radio is not None for radio in radios)
    found = weak_radios([radio for radio in radios if radio], now)
    assert [(weak.radio.id, weak.lqi, weak.hops) for weak in found] == [
        ("x", None, None),
        ("w", 60, 2),
    ]
    assert found[1].radio.device == "dev-w"
    # No coordinator: the mesh cannot be read.
    assert weak_radios([radio for radio in radios[1:] if radio], now) == []
    assert read_radio({"name": "no address"}) is None


def test_energy_from_the_settings_and_the_rooms() -> None:
    """The home's energy (in, from the sun, out), the grid's and each room's, both weeks."""
    legacy = {
        "energy_sources": [
            {
                "type": "grid",
                "flow_from": [{"stat_energy_from": "sensor.grid_in"}],
                "flow_to": [{"stat_energy_to": "sensor.grid_out"}],
            },
            {"type": "solar", "stat_energy_from": "sensor.solar"},
            {"type": "gas", "stat_energy_from": "sensor.gas"},
        ]
    }
    flat = {
        "energy_sources": [
            {"type": "grid", "stat_energy_from": "sensor.grid_in", "stat_energy_to": None},
            {"type": "grid", "stat_energy_from": None, "stat_energy_to": "sensor.grid_out"},
            {"type": "solar", "stat_energy_from": "sensor.solar"},
            {
                "type": "battery",
                "stat_energy_from": "sensor.bat_out",
                "stat_energy_to": "sensor.bat_in",
            },
        ]
    }
    meters = sources_of(legacy)
    assert (meters.grid_in, meters.grid_out, meters.solar) == (
        ["sensor.grid_in"],
        ["sensor.grid_out"],
        ["sensor.solar"],
    )
    both = sources_of(flat)
    assert (both.grid_in, both.grid_out, both.battery_out, both.battery_in) == (
        ["sensor.grid_in"],
        ["sensor.grid_out"],
        ["sensor.bat_out"],
        ["sensor.bat_in"],
    )
    assert sources_of(None) == Meters()
    week = (datetime(2026, 10, 19, 4, tzinfo=UTC), datetime(2026, 10, 26, 4, tzinfo=UTC))
    before = (datetime(2026, 10, 12, 4, tzinfo=UTC), week[0])

    def hours(span: tuple[datetime, datetime], total: float) -> list[tuple[float, float]]:
        count = int((span[1] - span[0]).total_seconds() // 3600)
        return [((span[0] + timedelta(hours=h)).timestamp(), total / count) for h in range(count)]

    meters.rooms = {"kitchen": ["sensor.oven"], "den": ["sensor.den"]}
    hourly = {
        "sensor.grid_in": hours(week, 80) + hours(before, 100),
        "sensor.grid_out": hours(week, 10),
        "sensor.solar": hours(week, 20),
        "sensor.oven": hours(week, 7) + hours(before, 5),
    }
    found = energy(meters, hourly, week, before)
    assert found is not None
    assert found["home"] == {"week": 90.0, "before": 100.0}
    assert found["grid"] == {"week": 80.0, "before": 100.0}
    assert found["solar"] == {"week": 20.0}
    assert found["rooms"] == {"kitchen": {"week": 7.0, "before": 5.0}}
    assert energy(Meters(), {}, week, before) is None
    # A peak from 6 to 9 on Tuesday morning: three hours.
    tuesday = datetime(2026, 10, 20, 10, tzinfo=UTC)
    windows = merge(
        [
            (tuesday, tuesday + timedelta(hours=3)),
            (tuesday + timedelta(hours=1), tuesday + timedelta(hours=3)),
            (tuesday + timedelta(days=2), tuesday + timedelta(days=2, hours=4)),
        ]
    )
    assert len(windows) == 2
    said = peaks(windows, meters, hourly)
    hour = 80 / (7 * 24)
    assert said[0]["start"] == tuesday.isoformat()
    assert said[0]["grid"] == round(3 * hour, 2)
    assert said[0]["rooms"] == {"kitchen": round(3 * 7 / (7 * 24), 2)}
    assert said[1]["grid"] == round(4 * hour, 2)


def test_what_a_workplace_used_while_closed() -> None:
    """Each hour counted for the part of it closed; its share of the week's (D-088)."""
    week = (datetime(2026, 10, 19, 4, tzinfo=UTC), datetime(2026, 10, 26, 4, tzinfo=UTC))
    start = week[0].timestamp()
    # 1 kWh from the grid each hour, 0.5 of it in the kitchen; 0.25 back to the grid each hour.
    hourly = {
        "sensor.grid_in": [(start + h * 3600, 1.0) for h in range(7 * 24)],
        "sensor.grid_out": [(start + h * 3600, 0.25) for h in range(7 * 24)],
        "sensor.oven": [(start + h * 3600, 0.5) for h in range(7 * 24)],
    }
    meters = Meters(
        grid_in=["sensor.grid_in"], grid_out=["sensor.grid_out"], rooms={"kitchen": ["sensor.oven"]}
    )
    # Closed from 18:30 to 8:00 the next morning: 13.5 hours, the half hour counted as half.
    evening = datetime(2026, 10, 20, 22, 30, tzinfo=UTC)
    night = [(evening, evening + timedelta(hours=13, minutes=30))]
    assert within(hourly, ["sensor.grid_in"], night) == 13.5
    found = closed_energy(meters, hourly, night, week)
    assert found == {"kwh": round(13.5 * 0.75, 2), "share": 8, "rooms": {"kitchen": 6.75}}
    # Closed before and after the week as well: only its part within the week is counted.
    around = [(week[0] - timedelta(hours=5), week[0] + timedelta(hours=2))]
    assert closed_energy(meters, hourly, around, week) == {
        "kwh": 1.5,
        "share": 1,
        "rooms": {"kitchen": 1.0},
    }
    # Never closed in the week, or no meter: nothing to say.
    assert closed_energy(meters, hourly, [], week) is None
    assert closed_energy(Meters(), hourly, night, week) is None


class FakeRecorder:
    """The recorder's executor, answering the hourly statistics asked from rows made up."""

    def __init__(self, rows: dict[str, list[dict[str, Any]]]) -> None:
        """Rows by statistic, as `statistics_during_period` gives them."""
        self.rows = rows
        self.asked: list[tuple[Any, ...]] = []

    async def async_add_executor_job(self, job: Any, *args: Any) -> Any:
        """The statistics from the rows; any other job (the history) run."""
        if getattr(job, "__name__", "") == "statistics_during_period":
            self.asked.append(args)
            _hass, start, end, ids, period, units, types = args
            assert (period, units, types) == ("hour", {"energy": "kWh"}, {"change"})
            return {
                stat: [row for row in rows if start.timestamp() <= row["start"] < end.timestamp()]
                for stat, rows in self.rows.items()
                if stat in ids
            }
        return job(*args)


def _hourly(start: datetime, end: datetime, per_hour: float) -> list[dict[str, Any]]:
    rows = []
    at = start
    while at < end:
        rows.append(
            {
                "start": at.timestamp(),
                "end": (at + timedelta(hours=1)).timestamp(),
                "change": per_hour,
            }
        )
        at += timedelta(hours=1)
    return rows


async def test_the_weeks_energy_and_peaks_from_home_assistant(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """The energy settings, the meters of the rooms' areas, the statistics; the week's peaks."""
    client = await _home(
        hass, config_entry, hass_ws_client, demo_plan, demo_bindings, freezer, MONDAY
    )
    other = MockConfigEntry(domain="test")
    other.add_to_hass(hass)
    oven = _device(hass, other, "Oven", "kitchen")
    _entity(hass, other, "sensor.oven_energy", device=oven)
    meter = {
        "device_class": "energy",
        "state_class": "total_increasing",
        "unit_of_measurement": "kWh",
    }
    hass.states.async_set("sensor.oven_energy", "3", meter)
    hass.states.async_set("sensor.grid_in", "100", meter)
    # A utility meter counts the oven again; a power sensor counts no energy: left out.
    _entity(hass, other, "sensor.oven_daily", device=oven, platform="utility_meter")
    hass.states.async_set("sensor.oven_daily", "1", meter)
    _entity(hass, other, "sensor.oven_power", device=oven)
    hass.states.async_set(
        "sensor.oven_power", "1200", {"device_class": "power", "unit_of_measurement": "W"}
    )
    # hydroqc says a peak was under way on Tuesday from 6 to 9, where the home is.
    hydroqc = MockConfigEntry(domain="hydroqc")
    hydroqc.add_to_hass(hass)
    _entity(
        hass,
        hydroqc,
        "binary_sensor.critical_peak",
        platform="hydroqc",
        translation_key="dpc_peak_in_progress",
    )
    week, before = week_of(dt_util.utcnow())
    tuesday = datetime(2026, 10, 20, 10, tzinfo=UTC)
    history = [
        State("binary_sensor.critical_peak", "off", last_changed=week[0] - timedelta(days=1)),
        State("binary_sensor.critical_peak", "on", last_changed=tuesday),
        State("binary_sensor.critical_peak", "off", last_changed=tuesday + timedelta(hours=3)),
        State("binary_sensor.critical_peak", "on", last_changed=week[1] - timedelta(hours=1)),
    ]
    rows = {
        "sensor.grid_in": _hourly(before[0], week[0], 1.0) + _hourly(*week, 0.5),
        "sensor.oven_energy": _hourly(before[0], week[0], 0.2) + _hourly(*week, 0.1),
    }
    recorder = FakeRecorder(rows)
    prefs = {
        "energy_sources": [
            {"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_in"}], "flow_to": []}
        ],
        "device_consumption": [],
    }

    async def manager(_hass: HomeAssistant) -> Any:
        return type("Manager", (), {"data": prefs})()

    hass.config.components.add("recorder")
    hass.config.components.add("energy")
    with (
        patch("homeassistant.components.recorder.get_instance", return_value=recorder),
        patch("homeassistant.components.energy.data.async_get_manager", manager),
        patch(
            "homeassistant.components.recorder.history.get_significant_states",
            return_value={"binary_sensor.critical_peak": history},
        ) as significant,
    ):
        report = await _write(client)
    assert significant.call_args.args[1:4] == (week[0], week[1], ["binary_sensor.critical_peak"])
    assert recorder.asked[0][3] == {"sensor.grid_in", "sensor.oven_energy"}
    assert report["energy"] == {
        "home": {"week": 84.0, "before": 168.0},
        "grid": {"week": 84.0, "before": 168.0},
        "rooms": {"kitchen": {"week": 16.8, "before": 33.6}},
    }
    assert report["peaks"] == [
        {
            "start": tuesday.isoformat(),
            "end": (tuesday + timedelta(hours=3)).isoformat(),
            "grid": 1.5,
            "rooms": {"kitchen": 0.3},
        },
        {
            "start": (week[1] - timedelta(hours=1)).isoformat(),
            "end": week[1].isoformat(),
            "grid": 0.5,
            "rooms": {"kitchen": 0.1},
        },
    ]
    # The individual devices of the energy settings, where they name some, and nothing else.
    prefs["device_consumption"] = [
        {"stat_consumption": "sensor.grid_in"},
        {"stat_consumption": "sensor.oven_energy", "included_in_stat": "sensor.grid_in"},
    ]
    with (
        patch("homeassistant.components.recorder.get_instance", return_value=recorder),
        patch("homeassistant.components.energy.data.async_get_manager", manager),
        patch("homeassistant.components.recorder.history.get_significant_states", return_value={}),
    ):
        report = await _write(client)
    assert "rooms" not in report["energy"]
    # Without Home Assistant's recorder: no energy, the rest is written.
    hass.config.components.remove("recorder")
    with patch("homeassistant.components.energy.data.async_get_manager", manager):
        report = await _write(client)
    assert "energy" not in report
    assert report["peaks"] == []


async def test_written_on_its_day_and_told(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """On Monday at 8: written, Home Assistant's notification, the event; once."""
    client = await _home(
        hass,
        config_entry,
        hass_ws_client,
        demo_plan,
        demo_bindings,
        freezer,
        MONDAY - timedelta(days=8),
    )
    hass.states.async_set(
        "sensor.a_battery",
        "5",
        {"device_class": "battery", "unit_of_measurement": "%", "friendly_name": "Smoke alarm"},
    )
    events = async_capture_events(hass, REPORT_EVENT)
    weekly = hass.data[REPORT_KEY]
    assert not weekly.due(dt_util.utcnow())
    freezer.move_to(MONDAY + timedelta(minutes=30))
    async_fire_time_changed(hass, MONDAY + timedelta(minutes=30))
    await hass.async_block_till_done()
    reports = weekly.list()
    assert len(reports) == 1
    assert reports[0]["by"] == "schedule"
    notifications = persistent_notification._async_get_or_create_notifications(hass)
    said = notifications["domotwin_weekly_report"]
    assert said["title"] == "DomoTwin · The week's report"
    assert "**1 battery low**: Smoke alarm (5 %)" in said["message"]
    assert f"[Open the report](/domotwin?report={reports[0]['id']})" in said["message"]
    assert len(events) == 1
    assert events[0].data["counts"]["batteries"] == 1
    assert events[0].data["url"] == f"/domotwin?report={reports[0]['id']}"
    # Another hour: written already.
    freezer.move_to(MONDAY + timedelta(hours=1, minutes=30))
    async_fire_time_changed(hass, MONDAY + timedelta(hours=1, minutes=30))
    await hass.async_block_till_done()
    assert len(weekly.list()) == 1
    # Written by hand, three times: neither told nor the week's, and the week's is kept. A new
    # connection: the clock moved a week, past the first one's heartbeat.
    client = await _admin(hass, hass_ws_client)
    for _ in range(3):
        assert (await _send(client, {"type": "domotwin/report/write"}))["success"]
    assert [entry["by"] for entry in weekly.list()] == ["hand", "hand", "schedule"]
    assert not weekly.due(dt_util.utcnow())
    # The next Monday, two hours ring at once (the hour and a week caught up): written once.
    next_monday = MONDAY + timedelta(days=7, hours=2)
    freezer.move_to(next_monday)
    weekly._hour(next_monday)
    weekly._hour(next_monday)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert [entry["by"] for entry in weekly.list()] == ["schedule", "hand", "hand", "schedule"]
    # Told once a week, never for those written by hand; compared with last week's.
    assert len(events) == 2
    assert "gone" not in (weekly.get() or {})


async def test_a_week_missed_is_caught_up(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Home Assistant stopped at the hour: the report is written once it has started."""
    hass_storage[REPORT_STORAGE_KEY] = {
        "version": 1,
        "key": REPORT_STORAGE_KEY,
        "data": {
            "settings": {"weekday": 0, "hour": 8, "notify": False},
            "since": (MONDAY - timedelta(days=30)).isoformat(),
            "next": 5,
            "reports": [],
        },
    }
    await _home(
        hass,
        config_entry,
        hass_ws_client,
        demo_plan,
        demo_bindings,
        freezer,
        MONDAY + timedelta(days=1),
    )
    weekly = hass.data[REPORT_KEY]
    assert weekly.due(dt_util.utcnow())
    later = dt_util.utcnow() + timedelta(seconds=CATCH_UP_DELAY + 1)
    freezer.move_to(later)
    async_fire_time_changed(hass, later)
    await hass.async_block_till_done()
    assert [report["id"] for report in weekly.list()] == [5]
    assert (
        "domotwin_weekly_report"
        not in persistent_notification._async_get_or_create_notifications(hass)
    )
    assert not weekly.due(dt_util.utcnow())


async def test_a_new_home_waits_for_its_first_day(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """DomoTwin just installed on a Tuesday: no report until Monday."""
    await _home(
        hass,
        config_entry,
        hass_ws_client,
        demo_plan,
        demo_bindings,
        freezer,
        MONDAY + timedelta(days=1),
    )
    weekly = hass.data[REPORT_KEY]
    assert not weekly.due(dt_util.utcnow())
    # The next Monday at 8, after the clocks went back: 13:00 UTC.
    assert not weekly.due(MONDAY + timedelta(days=7, hours=1))
    assert weekly.due(MONDAY + timedelta(days=7, hours=2))


async def test_the_summary_by_the_ai_task(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """The AI task chosen sums the facts up; its refusal is kept as it gives it."""
    client = await _home(hass, config_entry, hass_ws_client, demo_plan, demo_bindings)
    hass.states.async_set(
        "sensor.a_battery",
        "5",
        {"device_class": "battery", "unit_of_measurement": "%", "friendly_name": "Smoke alarm"},
    )
    other = MockConfigEntry(domain="test")
    other.add_to_hass(hass)
    kitchen = _device(hass, other, "Kitchen smoke alarm", "kitchen")
    _entity(hass, other, "sensor.kitchen_smoke_battery", device=kitchen)
    hass.states.async_set(
        "sensor.kitchen_smoke_battery", "5", {"device_class": "battery", "unit_of_measurement": "%"}
    )
    asked: list[ServiceCall] = []
    answer: dict[str, Any] = {"data": "  The smoke alarm needs a battery.  "}

    async def generate(call: ServiceCall) -> dict[str, Any]:
        asked.append(call)
        if "refuse" in answer:
            raise HomeAssistantError(answer["refuse"])
        return answer

    hass.services.async_register(
        "ai_task", "generate_data", generate, supports_response=SupportsResponse.ONLY
    )
    saved = await _send(
        client, {"type": "domotwin/report/settings", "settings": {"summary": "ai_task.helper"}}
    )
    assert saved["success"], saved
    report = await _write(client)
    assert report["summary"] == {"by": "ai_task.helper", "text": "The smoke alarm needs a battery."}
    assert asked[0].data["entity_id"] == "ai_task.helper"
    assert "(in the Kitchen)" in asked[0].data["instructions"]
    assert "Battery low: Smoke alarm (5 %)" in asked[0].data["instructions"]
    assert "In English" in asked[0].data["instructions"]
    # The kitchen kept private for nobody: the AI task is not told the room.
    settings = (await _send(client, {"type": "domotwin/settings/get"}))["result"]["settings"]
    private = {**settings, "rooms": {"kitchen": {"people": []}}}
    assert (await _send(client, {"type": "domotwin/settings/save", "settings": private}))["success"]
    await _write(client)
    assert "(in the Kitchen)" not in asked[1].data["instructions"]
    assert "Kitchen smoke alarm (5 %)" in asked[1].data["instructions"]
    # Nor when the rights hide it from everyone (D-071), as the rooms' sensors do.
    hidden = {**settings, "rights": {"everyone": {"rooms": {"kitchen": "hidden"}}}}
    assert (await _send(client, {"type": "domotwin/settings/save", "settings": hidden}))["success"]
    await _write(client)
    assert "(in the Kitchen)" not in asked[2].data["instructions"]
    assert "Kitchen smoke alarm (5 %)" in asked[2].data["instructions"]
    answer["refuse"] = "The model is not available"
    report = await _write(client)
    assert report["summary"] == {"by": "ai_task.helper", "error": "The model is not available"}
    hass.services.async_remove("ai_task", "generate_data")
    report = await _write(client)
    assert report["summary"]["error"] == "no_ai_task"


async def test_settings_for_administrators_only(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """The report and its settings are an administrator's; what is not a setting is refused."""
    client = await _home(hass, config_entry, hass_ws_client, demo_plan, demo_bindings)
    user = await hass_ws_client(hass, hass_read_only_access_token)
    for message in (
        {"type": "domotwin/report/get"},
        {"type": "domotwin/report/write"},
        {"type": "domotwin/report/settings", "settings": {"hour": 9}},
    ):
        assert (await _send(user, message))["error"]["code"] == "unauthorized"
    answer = await _send(client, {"type": "domotwin/report/get"})
    assert answer["result"] == {
        "settings": {
            "weekly": True,
            "weekday": 0,
            "hour": 8,
            "notify": True,
            "summary": None,
            "battery": 20,
        },
        "reports": [],
        "report": None,
    }
    for wrong in ({"hour": 24}, {"summary": "light.kitchen"}, {"colour": "red"}):
        refused = await _send(client, {"type": "domotwin/report/settings", "settings": wrong})
        assert refused["error"]["code"] == "invalid"
    saved = await _send(
        client, {"type": "domotwin/report/settings", "settings": {"weekday": 6, "hour": 18}}
    )
    assert saved["result"]["settings"]["weekday"] == 6
    # Kept when DomoTwin is set up again.
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data[REPORT_KEY].settings["hour"] == 18


async def test_kept_leniently_and_in_bounds(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """Reports not read are left out, the oldest go first, a section keeps its first items."""
    report = {
        "at": "2026-10-19T12:00:00+00:00",
        "by": "schedule",
        "week": {"start": "2026-10-12T04:00:00+00:00", "end": "2026-10-19T04:00:00+00:00"},
        "sections": {"batteries": []},
    }
    hass_storage[REPORT_STORAGE_KEY] = {
        "version": 1,
        "key": REPORT_STORAGE_KEY,
        "data": {
            "settings": {"hour": "eight"},
            "reports": [
                *({**report, "id": n} for n in range(1, 12)),
                {**report, "id": 20, "sections": {"batteries": [{"name": "no key"}]}},
                {"id": 21},
                "junk",
            ],
        },
    }
    client = await _home(hass, config_entry, hass_ws_client, demo_plan, demo_bindings)
    weekly = hass.data[REPORT_KEY]
    assert [entry["id"] for entry in weekly.list()] == list(range(11, 11 - MAX_REPORTS, -1))
    assert weekly.settings == read_settings({})
    battery = {"device_class": "battery", "unit_of_measurement": "%"}
    for n in range(MAX_REPORT_ITEMS + 5):
        hass.states.async_set(f"sensor.b{n}_battery", "1", battery)
    written = await _write(client)
    assert written["id"] == 12
    assert len(written["sections"]["batteries"]) == MAX_REPORT_ITEMS
    assert written["more"] == {"batteries": 5}
    # Written by hand: kept besides the weeks', which stay.
    assert [entry["by"] for entry in weekly.list()].count("schedule") == MAX_REPORTS
    assert weekly.list()[0]["id"] == 12


def test_the_notification_and_the_question_in_words() -> None:
    """The notification names what any user may see, counts the rest; the facts for the AI."""
    report: dict[str, Any] = {
        "id": 3,
        "week": {"start": "2026-10-19T04:00:00+00:00", "end": "2026-10-26T04:00:00+00:00"},
        "sections": {
            "batteries": [{"key": "a", "name": f"Sensor {n}", "level": n} for n in range(7)],
            "updates": [
                {
                    "key": "u",
                    "name": "Router",
                    "installed": "1",
                    "latest": "2",
                    "room": "hall",
                    "new": True,
                }
            ],
            "automations": [
                {"key": "x", "name": "Evening", "problem": "failed", "runs": 2, "error": "Boom"}
            ],
            "radios": [{"key": "r", "name": "Plug", "lqi": 40, "new": True, "room": "hall"}],
            "upkeep": [
                {
                    "key": "w",
                    "name": "Washer",
                    "task": "Clean the filter",
                    "due": "2026-10-20",
                    "state": "overdue",
                }
            ],
        },
        "more": {"batteries": 3},
        "energy": {
            "home": {"week": 90.04, "before": 100},
            "rooms": {"hall": {"week": 4.5}, "bedroom": {"week": 2.0}},
        },
        "peaks": [
            {"start": "2026-10-20T10:00:00+00:00", "end": "2026-10-20T13:00:00+00:00", "grid": 1.5},
            {"start": "2026-10-22T20:00:00+00:00", "end": "2026-10-23T00:00:00+00:00"},
        ],
    }
    with patch.object(dt_util, "DEFAULT_TIME_ZONE", dt_util.get_time_zone(ZONE)):
        title, message = notification(report, "en", "All is well.", "/domotwin?report=3")
        assert title == "DomoTwin · The week's report"
        lines = message.split("\n")
        assert lines[0] == "The week of 19 October to 25 October."
        assert lines[2] == "All is well."
        assert (
            "- **10 batteries low**: Sensor 0 (0 %), Sensor 1 (1 %), Sensor 2 (2 %), "
            "Sensor 3 (3 %), Sensor 4 (4 %), and 5 more"
        ) in lines
        assert "- **1 automation to look at** (in the report)" in lines
        assert "- **1 Zigbee device on a weak link** (in the report)" in lines
        assert "- **1 upkeep task due**: Washer: Clean the filter" in lines
        # Names are shown as they are: what Markdown formats or links with is escaped.
        tricky = {**report, "sections": {"updates": [{"key": "u", "name": "[Bad](x) *fw*"}]}}
        assert "- **1 update waiting**: \\[Bad\\]\\(x\\) \\*fw\\*" in notification(
            tricky, "en", None, None
        )[1].split("\n")
        assert "- **Energy**: 90 kWh used, 10 % less than the week before" in lines
        assert "- **2 Hydro-Québec peaks**: 1.5 kWh drawn from the grid during them" in lines
        assert lines[-1] == "[Open the report](/domotwin?report=3)"
        _, french = notification(report, "fr", None, None)
        assert "La semaine du 19 octobre au 25 octobre." in french
        assert "- **10 piles faibles** : Sensor 0 (0 %)" in french
        assert "- **Énergie** : 90 kWh consommés, 10 % de moins que la semaine d'avant" in french
        assert "Ouvrir le bilan" not in french
        empty = {**report, "sections": {}, "more": {}, "energy": None, "peaks": []}
        assert "Nothing needs a look this week." in notification(empty, "en", None, None)[1]
        # The bedroom is private: not named.
        question = ask(report, "fr", {"hall": "Entrée"})
        assert "bedroom" not in question
        assert "In French" in question
        assert (
            "- Mise à jour en attente : Router (1 → 2) (pièce : Entrée), nouveau cette semaine"
        ) in question
        # Counted, not named: the summary goes into a notification every user sees.
        assert "- 1 automatisation à revoir" in question
        assert "- 1 appareil Zigbee sur un lien faible" in question
        assert "Evening" not in question
        assert "Plug" not in question
        assert "- Entretien : Washer : Clean the filter, en retard depuis le 2026-10-20" in question
        assert (
            "Énergie consommée (pièce : Entrée) : 4,5 kWh cette semaine, inconnue kWh" in question
        )
        assert (
            "Pointe d'Hydro-Québec du 20 octobre, 6 h 00 au 20 octobre, 9 h 00 : 1,5 kWh"
            in question
        )


def test_the_day_and_hour_where_the_home_is() -> None:
    """The last slot, across a change of time."""
    settings = read_settings({"weekday": 6, "hour": 2})
    zone = dt_util.get_time_zone(ZONE)
    with patch.object(dt_util, "DEFAULT_TIME_ZONE", zone):
        # Sunday 1 November 2026, 3:30 after the clocks went back at 2.
        now = datetime(2026, 11, 1, 3, 30, tzinfo=zone)
        slot = last_slot(settings, dt_util.as_utc(now))
        assert dt_util.as_local(slot).date().isoformat() == "2026-11-01"
        assert dt_util.as_local(slot).hour == 2
        # The Saturday before: the Sunday before that.
        saturday = datetime(2026, 10, 31, 12, tzinfo=zone)
        assert dt_util.as_local(last_slot(settings, saturday)).day == 25
        week, before = week_of(dt_util.as_utc(saturday))
        assert dt_util.as_local(week[0]).isoformat().startswith("2026-10-24T00:00")
        assert dt_util.as_local(week[1]).isoformat().startswith("2026-10-31T00:00")
        assert dt_util.as_local(before[0]).isoformat().startswith("2026-10-17T00:00")


async def test_settings_in_the_diagnostics_never_the_reports(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """The diagnostics say the settings and how many reports are kept, nothing they say."""
    client = await _home(hass, config_entry, hass_ws_client, demo_plan, demo_bindings)
    hass.states.async_set(
        "sensor.secret_battery",
        "5",
        {"device_class": "battery", "unit_of_measurement": "%", "friendly_name": "Secret safe"},
    )
    await _write(client)
    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, config_entry)
    assert diagnostics["report"] == {
        "weekly": True,
        "weekday": 0,
        "hour": 8,
        "notify": True,
        "summary": False,
        "battery": 20,
        "kept": 1,
    }
    assert "Secret safe" not in str(diagnostics)


async def test_removed_with_the_integration(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
) -> None:
    """Unloaded: no more reports; removed: the store goes."""
    client = await _home(hass, config_entry, hass_ws_client, demo_plan, demo_bindings)
    await _write(client)
    await hass.async_block_till_done()
    assert REPORT_STORAGE_KEY in hass_storage
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    assert REPORT_KEY not in hass.data
    not_loaded = await _send(client, {"type": "domotwin/report/get"})
    assert not_loaded["error"]["code"] == "not_loaded"
    await hass.config_entries.async_remove(config_entry.entry_id)
    await hass.async_block_till_done()
    assert REPORT_STORAGE_KEY not in hass_storage


def _kept_history(states: list[State], oldest: datetime) -> Any:
    """`get_significant_states` over `states`, from a recorder that keeps them since `oldest`."""

    def history(
        _hass: HomeAssistant,
        start: datetime,
        end: datetime,
        entities: list[str],
        _filters: Any = None,
        *,
        include_start_time_state: bool = True,
        **_kwargs: Any,
    ) -> dict[str, list[State]]:
        kept = [state for state in states if state.last_changed >= oldest]
        found: dict[str, list[State]] = {}
        for entity in entities:
            own = [state for state in kept if state.entity_id == entity]
            rows = [state for state in own if start < state.last_changed < end]
            # The state at `start`, where the recorder keeps anything from before it.
            earlier = [state for state in own if state.last_changed <= start]
            if include_start_time_state and oldest < start and earlier:
                rows.insert(0, earlier[-1])
            if rows:
                found[entity] = rows
        return found

    return history


async def test_when_the_history_says(hass: HomeAssistant) -> None:
    """Unavailable is not what was asked; a purged start is said (D-088)."""
    start = datetime(2026, 10, 19, 4, tzinfo=UTC)
    end = start + timedelta(days=1)
    hours = "schedule.opening"
    states = [
        State(hours, "off", last_changed=start - timedelta(days=3)),
        State(hours, "unavailable", last_changed=start + timedelta(hours=2)),
        State(hours, "off", last_changed=start + timedelta(hours=3)),
        State(hours, "on", last_changed=start + timedelta(hours=9)),
        State(hours, "off", last_changed=start + timedelta(hours=18)),
    ]
    hass.config.components.add("recorder")

    async def windows(oldest: datetime) -> tuple[list[tuple[datetime, datetime]], datetime]:
        with (
            patch("homeassistant.components.recorder.get_instance", return_value=FakeRecorder({})),
            patch(
                "homeassistant.components.recorder.history.get_significant_states",
                _kept_history(states, oldest),
            ),
        ):
            return await async_state_windows(hass, [hours], start, end, "off")

    assert await windows(start - timedelta(days=30)) == (
        [
            (start, start + timedelta(hours=2)),
            (start + timedelta(hours=3), start + timedelta(hours=9)),
            (start + timedelta(hours=18), end),
        ],
        start,
    )
    # The recorder keeps nothing before 5:00: its history is said from its first state after.
    assert await windows(start + timedelta(hours=1)) == (
        [
            (start + timedelta(hours=3), start + timedelta(hours=9)),
            (start + timedelta(hours=18), end),
        ],
        start + timedelta(hours=2),
    )
    # Nothing kept: nothing said, from the end.
    assert await windows(end) == ([], end)


async def test_a_workplace_s_energy_while_closed(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    config_entry: MockConfigEntry,
    demo_plan: dict[str, Any],
    demo_bindings: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """In the weekly report, and for the Home tab: the last seven days and this month (D-088)."""
    last_monday = MONDAY - timedelta(days=7)
    client = await _home(
        hass, config_entry, hass_ws_client, demo_plan, demo_bindings, freezer, last_monday
    )
    meter = {
        "device_class": "energy",
        "state_class": "total_increasing",
        "unit_of_measurement": "kWh",
    }
    hass.states.async_set("sensor.grid_in", "100", meter)
    prefs = {
        "energy_sources": [
            {"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_in"}], "flow_to": []}
        ],
        "device_consumption": [],
    }

    async def manager(_hass: HomeAssistant) -> Any:
        return type("Manager", (), {"data": prefs})()

    # 1 kWh each hour since the end of September.
    since = datetime(2026, 9, 26, 4, tzinfo=UTC)
    recorder = FakeRecorder({"sensor.grid_in": _hourly(since, MONDAY, 1.0)})
    hass.config.components.add("recorder")
    hass.config.components.add("energy")
    # Open from 9 to 18 where the shop is (13:00 to 22:00 UTC), every day but October 14th;
    # closed otherwise.
    history: list[State] = [State("schedule.opening", "off", last_changed=since)]
    day = datetime(2026, 9, 27, 13, tzinfo=UTC)
    while day < MONDAY:
        if day.day != 14:
            history.append(State("schedule.opening", "on", last_changed=day))
            history.append(State("schedule.opening", "off", last_changed=day + timedelta(hours=9)))
        day += timedelta(days=1)
    history = [state for state in history if state.last_changed < MONDAY]

    async def energy_now() -> dict[str, Any]:
        answer = await _send(client, {"type": "domotwin/workplace/energy"})
        assert answer["success"], answer
        result: dict[str, Any] = answer["result"]
        return result

    def kept_since(oldest: datetime) -> Any:
        return patch(
            "homeassistant.components.recorder.history.get_significant_states",
            _kept_history(history, oldest),
        )

    with (
        patch("homeassistant.components.recorder.get_instance", return_value=recorder),
        patch("homeassistant.components.energy.data.async_get_manager", manager),
    ):
        with kept_since(since):
            # A home: nothing.
            assert await energy_now() == {}
            assert "closed" not in await _write(client)
            answer = await _send(client, {"type": "domotwin/settings/get"})
            settings = answer["result"]["settings"]
            answer = await _send(
                client,
                {
                    "type": "domotwin/settings/save",
                    "settings": {**settings, "workplace": {"hours": "schedule.opening"}},
                },
            )
            assert answer["success"], answer
            # The week of October 12th, closed all the 14th: 114 hours of its 168.
            assert (await _write(client))["closed"] == {
                "week": {"kwh": 114.0, "share": 68},
                "before": {"kwh": 105.0, "share": 63},
            }
            freezer.move_to(MONDAY)
            # Closed 15 hours a day of 24 the week of the 19th: 105 kWh of its 168.
            assert (await _write(client))["closed"] == {
                "week": {"kwh": 105.0, "share": 63},
                "before": {"kwh": 114.0, "share": 68},
            }
            # The last seven days to now (11:30), and this month since its first day where the
            # shop is (October 1st, 4:00): 607.5 hours, 216 of them open.
            assert await energy_now() == {
                "week": {"kwh": 105.0, "share": 63},
                "month": {"kwh": 391.5, "share": 64},
            }
        # The recorder keeps ten days of history: what is older is not guessed.
        with kept_since(MONDAY - timedelta(days=10)):
            # The week before as its report said it.
            assert (await _write(client))["closed"] == {
                "week": {"kwh": 105.0, "share": 63},
                "before": {"kwh": 114.0, "share": 68},
            }
            # This month from the first state kept, October 16th at 13:00: 238.5 hours, 90 open.
            assert await energy_now() == {
                "week": {"kwh": 105.0, "share": 63},
                "month": {"kwh": 148.5, "share": 62, "since": "2026-10-16T13:00:00+00:00"},
            }
            # No report of that week: the week before is not said in part.
            weekly = hass.data[REPORT_KEY]
            weekly._reports = [r for r in weekly._reports if "closed" not in r]
            assert (await _write(client))["closed"] == {"week": {"kwh": 105.0, "share": 63}}
