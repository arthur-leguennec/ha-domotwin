"""The configuration history (D-057): each change kept, by item and date; one item put back."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)
from pytest_homeassistant_custom_component.typing import (
    ClientSessionGenerator,
    WebSocketGenerator,
)

from custom_components.domotwin.const import HISTORY_STORAGE_KEY
from custom_components.domotwin.data import HISTORY_KEY
from custom_components.domotwin.history import SAVE_DELAY, _encoded
from homeassistant.const import EVENT_CALL_SERVICE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from homeassistant.util.yaml import dump

#: Fictional automations, as Home Assistant's editor writes them.
EVENING = {
    "id": "1700000000001",
    "alias": "Evening lights",
    "description": "",
    "triggers": [{"trigger": "sun", "event": "sunset", "offset": "-00:30:00"}],
    "conditions": [],
    "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.living_lamp"}}],
    "mode": "single",
}
CURTAINS = {
    "id": "1700000000002",
    "alias": "Curtains in the morning",
    "triggers": [{"trigger": "time", "at": "07:30:00"}],
    "actions": [{"action": "cover.open_cover", "target": {"entity_id": "cover.bedroom"}}],
}


def _write(folder: Path, name: str, content: Any) -> None:
    (folder / name).write_text(dump(content), encoding="utf-8")


async def _send(client: Any, message: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(message)
    answer: dict[str, Any] = await client.receive_json()
    return answer


async def _items(client: Any) -> dict[str, dict[str, Any]]:
    answer = await _send(client, {"type": "domotwin/history/list"})
    assert answer["success"], answer
    return {item["id"]: item for item in answer["result"]["items"]}


async def _versions(client: Any, item: str) -> list[dict[str, Any]]:
    answer = await _send(client, {"type": "domotwin/history/item", "item": item})
    assert answer["success"], answer
    versions: list[dict[str, Any]] = answer["result"]["versions"]
    return versions


async def _config(client: Any, item: str, version: int) -> Any:
    answer = await _send(
        client, {"type": "domotwin/history/version", "item": item, "version": version}
    )
    assert answer["success"], answer
    return answer["result"]["config"]


async def _later(hass: HomeAssistant, seconds: float = 6) -> None:
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
    await hass.async_block_till_done()


async def test_editor_automations_are_kept_on_each_change(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    _write(config_dir, "automations.yaml", [EVENING, CURTAINS])
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)

    # Read once Home Assistant has started: each with its first version.
    items = await _items(client)
    assert set(items) == {"automation:1700000000001", "automation:1700000000002"}
    evening = items["automation:1700000000001"]
    assert evening["name"] == "Evening lights"
    assert evening["source"] == "editor"
    assert evening["versions"] == 1
    assert evening["removed"] is False

    # The offset changed in the editor, which writes the file and reloads.
    later = {"trigger": "sun", "event": "sunset", "offset": "-00:20:00"}
    changed = {**EVENING, "triggers": [later]}
    _write(config_dir, "automations.yaml", [changed, CURTAINS])
    hass.bus.async_fire("automation_reloaded")
    await _later(hass)
    versions = await _versions(client, "automation:1700000000001")
    assert len(versions) == 2
    newest, oldest = versions
    assert newest["id"] > oldest["id"]
    assert newest["kept"]
    assert not newest["removed"]
    assert await _config(client, "automation:1700000000001", oldest["id"]) == EVENING
    assert await _config(client, "automation:1700000000001", newest["id"]) == changed
    # The other automation did not change: no version of it.
    assert len(await _versions(client, "automation:1700000000002")) == 1

    # Reloaded again with the same automations, its keys in another order: nothing new.
    _write(config_dir, "automations.yaml", [dict(reversed(changed.items())), CURTAINS])
    hass.bus.async_fire("automation_reloaded")
    await _later(hass)
    assert len(await _versions(client, "automation:1700000000001")) == 2

    # Removed in the editor (the file, then the entity registry, with no reload).
    _write(config_dir, "automations.yaml", [CURTAINS])
    registry = er.async_get(hass)
    entry = registry.async_get_or_create("automation", "automation", "1700000000001")
    registry.async_remove(entry.entity_id)
    await _later(hass)
    items = await _items(client)
    assert items["automation:1700000000001"]["removed"] is True
    versions = await _versions(client, "automation:1700000000001")
    assert versions[0]["removed"] is True
    assert versions[0]["kept"] is False
    assert await _config(client, "automation:1700000000001", versions[0]["id"]) is None
    # The most recently changed first.
    assert next(iter(items)) == "automation:1700000000001"

    # Put back as it first was: the same as that version.
    _write(config_dir, "automations.yaml", [CURTAINS, EVENING])
    answer = await _send(client, {"type": "domotwin/history/refresh", "kind": "automation"})
    assert answer["result"] == {"changed": 1}
    versions = await _versions(client, "automation:1700000000001")
    assert versions[0]["same_as"] == oldest["id"]
    assert "same_as" not in versions[1]


async def test_an_unreadable_file_is_left_alone(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    _write(config_dir, "automations.yaml", [EVENING])
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    # A typo in the file: Home Assistant cannot read it, nothing in it is taken for removed.
    (config_dir / "automations.yaml").write_text("- id: [unclosed\n", encoding="utf-8")
    answer = await _send(client, {"type": "domotwin/history/refresh"})
    assert answer["result"] == {"changed": 0}
    assert (await _items(client))["automation:1700000000001"]["removed"] is False
    # A file that holds something else than a list of automations, the same.
    _write(config_dir, "automations.yaml", {"not": "a list"})
    answer = await _send(client, {"type": "domotwin/history/refresh", "kind": "automation"})
    assert answer["result"] == {"changed": 0}
    # No file at all: the automations were removed.
    (config_dir / "automations.yaml").unlink()
    answer = await _send(client, {"type": "domotwin/history/refresh", "kind": "automation"})
    assert answer["result"] == {"changed": 1}
    assert (await _items(client))["automation:1700000000001"]["removed"] is True


async def test_scripts_are_read_after_their_reload(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    script = {"alias": "Good night", "sequence": [{"action": "light.turn_off"}], "mode": "single"}
    _write(config_dir, "scripts.yaml", {"good_night": script})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    assert (await _items(client))["script:good_night"]["name"] == "Good night"

    changed = {**script, "sequence": [*script["sequence"], {"action": "lock.lock"}]}
    _write(config_dir, "scripts.yaml", {"good_night": changed})
    # Home Assistant fires no event after `script.reload`: it is read a few seconds after it is
    # called, not at once.
    hass.bus.async_fire(EVENT_CALL_SERVICE, {"domain": "script", "service": "reload"})
    await _later(hass, 2)
    assert len(await _versions(client, "script:good_night")) == 1
    await _later(hass, 6)
    assert len(await _versions(client, "script:good_night")) == 2
    # Another service called: nothing read.
    _write(config_dir, "scripts.yaml", {})
    hass.bus.async_fire(EVENT_CALL_SERVICE, {"domain": "script", "service": "turn_on"})
    await _later(hass)
    assert (await _items(client))["script:good_night"]["removed"] is False


async def test_own_yaml_is_shown_not_editable(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    _write(config_dir, "scenes.yaml", [{"id": "1700000000003", "name": "Reading", "entities": {}}])
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                {
                    "id": "hall_motion",
                    "alias": "Hall light on motion",
                    "triggers": [
                        {"trigger": "state", "entity_id": "binary_sensor.hall", "to": "on"}
                    ],
                    "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.hall"}}],
                },
                {
                    "alias": "No id",
                    "triggers": [
                        {"trigger": "state", "entity_id": "binary_sensor.door", "to": "on"}
                    ],
                    "actions": [],
                },
            ]
        },
    )
    assert await async_setup_component(
        hass,
        "script",
        {"script": {"leave": {"alias": "Leave home", "sequence": [{"action": "lock.lock"}]}}},
    )
    hass.states.async_set("light.lamp", "off")
    assert await async_setup_component(
        hass,
        "scene",
        {"scene": [{"name": "Evening", "entities": {"light.lamp": {"state": "on"}}}]},
    )
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    # Made by `scene.create`: not configuration.
    made = {"scene_id": "made_now", "entities": {"light.lamp": "off"}}
    await hass.services.async_call("scene", "create", made, blocking=True)
    await _send(client, {"type": "domotwin/history/refresh"})

    items = await _items(client)
    assert items["automation:hall_motion"]["source"] == "yaml"
    assert items["automation:hall_motion"]["name"] == "Hall light on motion"
    assert items["automation:automation.no_id"]["source"] == "yaml"
    assert items["script:leave"]["source"] == "yaml"
    assert items["scene:scene.evening"]["source"] == "yaml"
    assert items["scene:1700000000003"]["source"] == "editor"
    assert not any("made_now" in item for item in items)
    versions = await _versions(client, "scene:scene.evening")
    config = await _config(client, "scene:scene.evening", versions[0]["id"])
    assert config["name"] == "Evening"
    assert config["entities"]["light.lamp"]["state"] == "on"
    versions = await _versions(client, "automation:hall_motion")
    config = await _config(client, "automation:hall_motion", versions[0]["id"])
    assert config["triggers"][0]["entity_id"] == "binary_sensor.hall"

    # The automations' integration not there (failed to set up): one's own are not known, and
    # left as they were; the editor's file is still read.
    component = hass.data.pop("automation")
    answer = await _send(client, {"type": "domotwin/history/refresh", "kind": "automation"})
    assert answer["result"] == {"changed": 0}
    assert (await _items(client))["automation:hall_motion"]["removed"] is False
    hass.data["automation"] = component


async def test_dashboards_are_kept_when_saved(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    assert await async_setup_component(hass, "lovelace", {})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    # Made by Home Assistant until it is saved: nothing kept.
    assert await _items(client) == {}

    first = {"title": "Home", "views": [{"title": "Kitchen", "cards": []}]}
    answer = await _send(client, {"type": "lovelace/config/save", "config": first})
    assert answer["success"], answer
    await _later(hass)
    items = await _items(client)
    assert items["dashboard:"]["source"] == "editor"
    assert items["dashboard:"]["name"] == "Home"
    card = {"type": "tile", "entity": "light.kitchen"}
    second = {"title": "Home", "views": [{"title": "Kitchen", "cards": [card]}]}
    await _send(client, {"type": "lovelace/config/save", "config": second})
    await _later(hass)
    versions = await _versions(client, "dashboard:")
    assert len(versions) == 2
    assert await _config(client, "dashboard:", versions[0]["id"]) == second

    # Its configuration deleted: Home Assistant makes the dashboard again, it was removed.
    await _send(client, {"type": "lovelace/config/delete"})
    await _later(hass)
    assert (await _items(client))["dashboard:"]["removed"] is True


async def test_the_oldest_versions_go_first(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)

    async def change(offset: int, *more: dict[str, Any]) -> None:
        evening = {**EVENING, "description": "x" * offset}
        _write(config_dir, "automations.yaml", [evening, *more])
        await _send(client, {"type": "domotwin/history/refresh", "kind": "automation"})

    # At most 3 versions an item.
    with patch("custom_components.domotwin.history.MAX_HISTORY_VERSIONS", 3):
        for offset in range(5):
            await change(offset)
    versions = await _versions(client, "automation:1700000000001")
    assert len(versions) == 3
    newest = await _config(client, "automation:1700000000001", versions[0]["id"])
    assert newest["description"] == "xxxx"
    oldest = await _config(client, "automation:1700000000001", versions[-1]["id"])
    assert oldest["description"] == "xx"

    # In all, the oldest versions first, whatever their item; each item's newest kept.
    size = (await _send(client, {"type": "domotwin/history/list"}))["result"]["bytes"]
    with patch("custom_components.domotwin.history.MAX_HISTORY_BYTES", size + 100):
        await change(5, CURTAINS)
    versions = await _versions(client, "automation:1700000000001")
    assert len(versions) == 2
    assert len(await _versions(client, "automation:1700000000002")) == 1
    answer = await _send(client, {"type": "domotwin/history/list"})
    assert answer["result"]["bytes"] <= size + 100

    # A version too large to keep: its date, not its content.
    with patch("custom_components.domotwin.history.MAX_HISTORY_VERSION_BYTES", 300):
        await change(400, CURTAINS)
    versions = await _versions(client, "automation:1700000000001")
    assert versions[0]["kept"] is False
    assert versions[0]["removed"] is False
    assert await _config(client, "automation:1700000000001", versions[0]["id"]) is None

    # A removed item with nothing else kept is forgotten.
    with patch("custom_components.domotwin.history.MAX_HISTORY_BYTES", 0):
        _write(config_dir, "automations.yaml", [EVENING])
        await _send(client, {"type": "domotwin/history/refresh", "kind": "automation"})
    assert "automation:1700000000002" not in await _items(client)


async def test_kept_in_the_store_and_read_leniently(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_storage: dict[str, Any],
) -> None:
    wake_up = {"alias": "Wake up", "sequence": []}
    text, digest = _encoded(wake_up)
    hass_storage[HISTORY_STORAGE_KEY] = {
        "version": 1,
        "key": HISTORY_STORAGE_KEY,
        "data": {
            "next": 3,
            "items": {
                "script:wake_up": {
                    "kind": "script",
                    "key": "wake_up",
                    "name": "Wake up",
                    "source": "editor",
                    "versions": [
                        {
                            "id": 2,
                            "at": "2026-10-01T06:00:00+00:00",
                            "hash": digest,
                            "json": text,
                        },
                        {"id": 1, "at": "2026-09-01T06:00:00+00:00", "hash": None, "json": None},
                        {"id": "x", "at": "never"},
                    ],
                },
                "nothing:here": {"kind": "nothing", "key": "here", "source": "editor"},
                "script:empty": {"kind": "script", "key": "empty", "source": "editor"},
                "junk": 42,
            },
        },
    }
    # As it was kept: nothing new when DomoTwin starts.
    _write(config_dir, "scripts.yaml", {"wake_up": wake_up})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    items = await _items(client)
    assert set(items) == {"script:wake_up"}
    versions = await _versions(client, "script:wake_up")
    assert [v["id"] for v in versions] == [2, 1]

    # A change is written to the store a few seconds later, with the ids going on.
    _write(config_dir, "scripts.yaml", {"wake_up": {"alias": "Wake up!", "sequence": []}})
    await _send(client, {"type": "domotwin/history/refresh", "kind": "script"})
    await _later(hass, SAVE_DELAY + 1)
    stored = hass_storage[HISTORY_STORAGE_KEY]["data"]
    versions = stored["items"]["script:wake_up"]["versions"]
    assert [v["id"] for v in versions] == [1, 2, 3]
    assert stored["next"] == 4
    assert stored["items"]["script:wake_up"]["name"] == "Wake up!"


async def test_for_administrators_only(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
) -> None:
    user = await hass_ws_client(hass, hass_read_only_access_token)
    for message in (
        {"type": "domotwin/history/list"},
        {"type": "domotwin/history/item", "item": "automation:1"},
        {"type": "domotwin/history/version", "item": "automation:1", "version": 1},
        {"type": "domotwin/history/refresh"},
    ):
        answer = await _send(user, message)
        assert answer["error"]["code"] == "unauthorized"
    admin = await hass_ws_client(hass)
    answer = await _send(admin, {"type": "domotwin/history/item", "item": "automation:1"})
    assert answer["error"]["code"] == "unknown_item"
    answer = await _send(admin, {"type": "domotwin/history/refresh", "kind": "group"})
    assert answer["error"]["code"] == "invalid_format"


async def test_unknown_version_and_not_loaded(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    _write(config_dir, "automations.yaml", [EVENING])
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    answer = await _send(
        client,
        {"type": "domotwin/history/version", "item": "automation:1700000000001", "version": 999},
    )
    assert answer["error"]["code"] == "unknown_version"
    # Unloaded: the commands say so, the history is followed no more.
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert HISTORY_KEY not in hass.data
    answer = await _send(client, {"type": "domotwin/history/list"})
    assert answer["error"]["code"] == "not_loaded"


async def test_put_back_through_home_assistants_own_command(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_client: ClientSessionGenerator,
) -> None:
    # Loaded by Home Assistant: a trigger that arms no timer.
    hall = {
        "id": "1700000000004",
        "alias": "Hall light",
        "triggers": [{"trigger": "state", "entity_id": "binary_sensor.hall", "to": "on"}],
        "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.hall"}}],
    }
    _write(config_dir, "automations.yaml", [hall])
    (config_dir / "configuration.yaml").write_text(
        "automation: !include automations.yaml\n", encoding="utf-8"
    )
    assert await async_setup_component(hass, "automation", {"automation": []})
    assert await async_setup_component(hass, "config", {})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    http = await hass_client()
    changed = {**hall, "alias": "Hall light, at night"}
    response = await http.post(f"/api/config/automation/config/{hall['id']}", json=changed)
    assert response.status == 200
    await hass.async_block_till_done()
    await _later(hass)
    versions = await _versions(client, "automation:1700000000004")
    assert len(versions) == 2
    # The first version put back, as the frontend does it: Home Assistant's command, then a read.
    first = await _config(client, "automation:1700000000004", versions[-1]["id"])
    response = await http.post(f"/api/config/automation/config/{hall['id']}", json=first)
    assert response.status == 200
    answer = await _send(client, {"type": "domotwin/history/refresh", "kind": "automation"})
    assert answer["result"] == {"changed": 1}
    versions = await _versions(client, "automation:1700000000004")
    assert versions[0]["same_as"] == versions[-1]["id"]
    assert (await _items(client))["automation:1700000000004"]["name"] == "Hall light"
    # The reload that follows finds nothing new.
    await hass.async_block_till_done()
    await _later(hass)
    assert len(await _versions(client, "automation:1700000000004")) == 3


async def test_never_in_the_diagnostics(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_client: ClientSessionGenerator,
) -> None:
    _write(config_dir, "automations.yaml", [EVENING])
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data[HISTORY_KEY].items()
    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, config_entry)
    text = str(diagnostics)
    assert "history" not in text
    assert "Evening lights" not in text
    assert "1700000000001" not in text


async def test_removed_with_the_integration(
    hass: HomeAssistant,
    config_dir: Path,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
) -> None:
    _write(config_dir, "automations.yaml", [EVENING])
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    await _later(hass, SAVE_DELAY + 1)
    assert HISTORY_STORAGE_KEY in hass_storage
    assert await hass.config_entries.async_remove(config_entry.entry_id)
    await hass.async_block_till_done()
    assert HISTORY_STORAGE_KEY not in hass_storage
