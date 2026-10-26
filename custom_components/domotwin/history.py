"""The configuration history (`docs/DECISIONS.md`, D-057).

Each change of an automation, a script, a scene or a dashboard is kept, by item and date, in a
store of its own (.storage/domotwin.history), so that an administrator sees what changed and puts
one item back. The automations, scripts and scenes Home Assistant's editors write are read from
their files, as its editors read them; those written in YAML files of one's own from their
entities, as Home Assistant loaded them (shown, not put back); the dashboards from Lovelace.

A version is kept when Home Assistant has started, after it reloads automations or scenes, after
`script.reload`, when one of them leaves the entity registry, when a dashboard is saved or
removed, and when the frontend asks after putting an item back. Putting back is the frontend's,
through Home Assistant's own configuration commands. The store is limited in size: the oldest
versions go first. Administrators only; never in the diagnostics.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from functools import partial
import hashlib
import heapq
import logging
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.lovelace.const import ConfigNotFound
from homeassistant.config import AUTOMATION_CONFIG_PATH, SCENE_CONFIG_PATH, SCRIPT_CONFIG_PATH
from homeassistant.const import EVENT_CALL_SERVICE, EVENT_LOVELACE_UPDATED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.json import json_bytes, json_bytes_sorted
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.json import json_loads
from homeassistant.util.yaml import load_yaml

from .compat import vol
from .const import (
    HISTORY_KINDS,
    HISTORY_STORAGE_KEY,
    HISTORY_STORAGE_VERSION,
    MAX_HISTORY_BYTES,
    MAX_HISTORY_ITEMS,
    MAX_HISTORY_VERSION_BYTES,
    MAX_HISTORY_VERSIONS,
)

_LOGGER = logging.getLogger(__name__)

#: How long after what announces a change it is read (seconds): Home Assistant fires no event
#: after `script.reload`, so the scripts are read once it has surely reloaded them.
READ_DELAY = {"automation": 1.0, "script": 5.0, "scene": 1.0, "dashboard": 1.0}
#: The store is written this long after a change (seconds), several changes at once.
SAVE_DELAY = 10
#: Home Assistant's own events for the automations and scenes reloaded.
RELOADED = {"automation_reloaded": "automation", "scene_reloaded": "scene"}
#: An item's name, at most this long.
MAX_NAME = 200


class HistoryError(Exception):
    """A request refused, with a code the frontend translates."""

    def __init__(self, code: str) -> None:
        """Keep the code."""
        super().__init__(code)
        self.code = code


class UnreadableError(Exception):
    """A configuration Home Assistant cannot read now: nothing in it is taken for removed."""


@dataclass
class Found:
    """One item as it is now."""

    name: str | None
    #: `editor`: written by Home Assistant's editors, put back through them; `yaml`: one's own.
    source: str
    config: Any


@dataclass
class Reading:
    """What a kind holds now, by key, and the keys that could not be read (left as they are)."""

    found: dict[str, Found] = field(default_factory=dict)
    unread: set[str] = field(default_factory=set)
    #: What one's own YAML files hold could not be read (their integration is not loaded).
    own_unread: bool = False


@dataclass
class Version:
    """A version kept: its configuration as JSON, or none (removed, or too large to keep)."""

    id: int
    at: datetime
    #: The fingerprint of the configuration, its keys in any order; None: removed.
    hash: str | None
    json: str | None
    bytes: int = 0

    @property
    def removed(self) -> bool:
        """The item was no longer there."""
        return self.hash is None


@dataclass
class Item:
    """An automation, script, scene or dashboard and its versions, oldest first."""

    kind: str
    key: str
    name: str | None
    source: str
    versions: list[Version] = field(default_factory=list)

    @property
    def id(self) -> str:
        """`<kind>:<key>`."""
        return f"{self.kind}:{self.key}"


def _name(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:MAX_NAME]


def _encoded(config: Any) -> tuple[str, str]:
    """The configuration as JSON, as it is ordered, and its fingerprint (keys sorted)."""
    text = json_bytes(config).decode("utf-8")
    digest = hashlib.sha256(json_bytes_sorted(config)).hexdigest()[:32]
    return text, digest


async def _read_file(hass: HomeAssistant, name: str) -> Any:
    """A configuration file as Home Assistant's editors read it; None when there is none.

    Raises `UnreadableError` when Home Assistant could not read it either.
    """

    def read() -> Any:
        try:
            return load_yaml(hass.config.path(name))
        except FileNotFoundError:
            return None

    try:
        return await hass.async_add_executor_job(read)
    except HomeAssistantError as err:
        raise UnreadableError(name) from err


def _entities(hass: HomeAssistant, domain: str, reading: Reading) -> list[Any]:
    """The entities of a domain's component, as Home Assistant loaded them.

    Without the component (its integration not loaded, or failed), what one's own YAML files hold
    is not known: `reading` says so, and their items are left as they are.
    """
    entities: Any = getattr(hass.data.get(domain), "entities", None)
    try:
        return list(entities)
    except TypeError:
        reading.own_unread = True
        return []


def _entity_name(entity: Any) -> str | None:
    return _name(getattr(entity, "name", None))


def _own(reading: Reading, key: Any, name: str | None, config: Any) -> None:
    """An item written in one's own YAML files, unless the editors' file has it."""
    if isinstance(key, str) and key and key not in reading.found and isinstance(config, dict):
        reading.found[key] = Found(name, "yaml", config)


async def _read_automations(hass: HomeAssistant) -> Reading:
    reading = Reading()
    stored = await _read_file(hass, AUTOMATION_CONFIG_PATH)
    if stored and not isinstance(stored, list):
        raise UnreadableError(AUTOMATION_CONFIG_PATH)
    # Home Assistant's editors edit the automations with an id.
    for raw in stored or []:
        if isinstance(raw, dict) and isinstance(raw.get("id"), str) and raw["id"]:
            reading.found[raw["id"]] = Found(_name(raw.get("alias")), "editor", raw)
    for entity in _entities(hass, "automation", reading):
        raw = getattr(entity, "raw_config", None)
        key = getattr(entity, "unique_id", None) or getattr(entity, "entity_id", None)
        name = (_name(raw.get("alias")) if isinstance(raw, dict) else None) or _entity_name(entity)
        _own(reading, key, name, raw)
    return reading


async def _read_scripts(hass: HomeAssistant) -> Reading:
    reading = Reading()
    stored = await _read_file(hass, SCRIPT_CONFIG_PATH)
    if stored and not isinstance(stored, dict):
        raise UnreadableError(SCRIPT_CONFIG_PATH)
    for key, raw in (stored or {}).items():
        if isinstance(key, str) and key and isinstance(raw, dict):
            reading.found[key] = Found(_name(raw.get("alias")), "editor", raw)
    for entity in _entities(hass, "script", reading):
        raw = getattr(entity, "raw_config", None)
        name = (_name(raw.get("alias")) if isinstance(raw, dict) else None) or _entity_name(entity)
        _own(reading, getattr(entity, "unique_id", None), name, raw)
    return reading


def _scene_config(scene: Any) -> dict[str, Any] | None:
    """A scene of one's own YAML files as its file says it: its name, icon and entities' states."""
    states = getattr(scene, "states", None)
    if not isinstance(states, dict):
        return None
    config: dict[str, Any] = {"name": getattr(scene, "name", None)}
    if getattr(scene, "icon", None):
        config["icon"] = scene.icon
    entities: dict[str, Any] = {}
    for entity_id, state in states.items():
        value = getattr(state, "state", None)
        if not isinstance(value, str):
            return None
        entities[entity_id] = {"state": value, **dict(getattr(state, "attributes", {}))}
    config["entities"] = entities
    return config


async def _read_scenes(hass: HomeAssistant) -> Reading:
    reading = Reading()
    stored = await _read_file(hass, SCENE_CONFIG_PATH)
    if stored and not isinstance(stored, list):
        raise UnreadableError(SCENE_CONFIG_PATH)
    for raw in stored or []:
        if isinstance(raw, dict) and isinstance(raw.get("id"), str) and raw["id"]:
            reading.found[raw["id"]] = Found(_name(raw.get("name")), "editor", raw)
    for entity in _entities(hass, "scene", reading):
        # Home Assistant's own scenes only, and not those `scene.create` made.
        scene = getattr(entity, "scene_config", None)
        if scene is None or getattr(entity, "from_service", False):
            continue
        key = getattr(scene, "id", None) or getattr(entity, "entity_id", None)
        config = _scene_config(scene)
        _own(reading, key, _name(getattr(scene, "name", None)), config)
    return reading


def _dashboards(hass: HomeAssistant) -> dict[Any, Any] | None:
    """Lovelace's dashboards by URL path (None: the default one), in either of its forms."""
    lovelace = hass.data.get("lovelace")
    dashboards = getattr(lovelace, "dashboards", None)
    if dashboards is None and isinstance(lovelace, dict):
        # Home Assistant before LovelaceData (2025.1).
        dashboards = lovelace.get("dashboards")
    return dashboards if isinstance(dashboards, dict) else None


async def _read_dashboards(hass: HomeAssistant) -> Reading:
    dashboards = _dashboards(hass)
    if dashboards is None:
        raise UnreadableError("lovelace")
    reading = Reading()
    for url_path, dashboard in list(dashboards.items()):
        key = url_path if isinstance(url_path, str) else ""
        try:
            config = await dashboard.async_load(False)
        except ConfigNotFound:
            # Made by Home Assistant, not kept: nothing of one's own to keep.
            continue
        except HomeAssistantError, AttributeError, TypeError:
            reading.unread.add(key)
            continue
        if not isinstance(config, dict):
            continue
        item = getattr(dashboard, "config", None)
        title = item.get("title") if isinstance(item, dict) else None
        source = "editor" if getattr(dashboard, "mode", None) == "storage" else "yaml"
        reading.found[key] = Found(_name(title) or _name(config.get("title")), source, config)
    return reading


READERS: dict[str, Callable[[HomeAssistant], Any]] = {
    "automation": _read_automations,
    "script": _read_scripts,
    "scene": _read_scenes,
    "dashboard": _read_dashboards,
}


class ConfigHistory:
    """The versions kept of every item, in their own store."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store; nothing is read before `async_load`, nothing followed before start."""
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, HISTORY_STORAGE_VERSION, HISTORY_STORAGE_KEY, private=True
        )
        self._items: dict[str, Item] = {}
        self._next = 1
        self._unsubscribe: list[Callable[[], None]] = []
        self._debouncers: dict[str, Debouncer[Any]] = {}
        #: One reading at a time, so that an older one is never kept after a newer one.
        self._lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Read the store, leaving out what cannot be read."""
        stored = await self._store.async_load()
        if not isinstance(stored, dict):
            return
        items = stored.get("items")
        for raw in (items if isinstance(items, dict) else {}).values():
            if (item := _read_item(raw)) is not None:
                self._items[item.id] = item
        newest = max((v.id for i in self._items.values() for v in i.versions), default=0)
        stored_next = stored.get("next")
        self._next = max(stored_next if isinstance(stored_next, int) else 1, newest + 1)

    @callback
    def async_start(self) -> None:
        """Follow what announces a change. The first reading is the caller's, once started."""
        hass = self._hass
        for kind in HISTORY_KINDS:
            self._debouncers[kind] = Debouncer(
                hass,
                _LOGGER,
                cooldown=READ_DELAY[kind],
                immediate=False,
                function=partial(self.async_snapshot, (kind,)),
            )
        for event_type, kind in RELOADED.items():
            self._unsubscribe.append(
                hass.bus.async_listen(event_type, partial(self._announced, kind))
            )

        @callback
        def script_reload(data: Any) -> bool:
            return bool(data.get("domain") == "script" and data.get("service") == "reload")

        self._unsubscribe.append(
            hass.bus.async_listen(
                EVENT_CALL_SERVICE, partial(self._announced, "script"), event_filter=script_reload
            )
        )

        @callback
        def removed(data: Any) -> bool:
            entity_id = data.get("entity_id")
            return (
                data.get("action") == "remove"
                and isinstance(entity_id, str)
                and entity_id.split(".", 1)[0] in ("automation", "script", "scene")
            )

        @callback
        def registry_removed(event: Event[Any]) -> None:
            self._later(event.data["entity_id"].split(".", 1)[0])

        self._unsubscribe.append(
            hass.bus.async_listen(
                er.EVENT_ENTITY_REGISTRY_UPDATED, registry_removed, event_filter=removed
            )
        )
        self._unsubscribe.append(
            hass.bus.async_listen(EVENT_LOVELACE_UPDATED, partial(self._announced, "dashboard"))
        )

    @callback
    def async_stop(self) -> None:
        """Stop following; what is waiting to be read is not read."""
        for unsubscribe in self._unsubscribe:
            unsubscribe()
        self._unsubscribe.clear()
        for debouncer in self._debouncers.values():
            debouncer.async_shutdown()
        self._debouncers.clear()

    @callback
    def _announced(self, kind: str, _event: Event[Any]) -> None:
        self._later(kind)

    @callback
    def _later(self, kind: str) -> None:
        if (debouncer := self._debouncers.get(kind)) is not None:
            debouncer.async_schedule_call()

    async def async_snapshot(self, kinds: Iterable[str] = HISTORY_KINDS) -> int:
        """Read each kind and keep what changed since its last version; how many were kept."""
        changed = 0
        async with self._lock:
            for kind in kinds:
                try:
                    reading = await READERS[kind](self._hass)
                except UnreadableError as err:
                    _LOGGER.debug("The %s cannot be read now (%s): left as they were", kind, err)
                    continue
                changed += self._keep(kind, reading, dt_util.utcnow())
        if changed:
            self._prune()
            self._store.async_delay_save(self._data, SAVE_DELAY)
        return changed

    def _keep(self, kind: str, reading: Reading, now: datetime) -> int:
        changed = 0
        for key, found in reading.found.items():
            try:
                text, digest = _encoded(found.config)
            except TypeError, ValueError:
                _LOGGER.debug("The %s %s cannot be kept as JSON", kind, key)
                reading.unread.add(key)
                continue
            item = self._items.get(f"{kind}:{key}")
            if item is None:
                item = self._items[f"{kind}:{key}"] = Item(kind, key, found.name, found.source)
            item.name = found.name or item.name
            item.source = found.source
            if item.versions and item.versions[-1].hash == digest:
                continue
            size = len(text.encode("utf-8"))
            kept = text if size <= MAX_HISTORY_VERSION_BYTES else None
            item.versions.append(self._version(now, digest, kept))
            changed += 1
        for item in list(self._items.values()):
            if item.kind != kind or item.key in reading.found or item.key in reading.unread:
                continue
            if item.source == "yaml" and reading.own_unread:
                continue
            if item.versions and not item.versions[-1].removed:
                item.versions.append(self._version(now, None, None))
                changed += 1
        return changed

    def _version(self, at: datetime, digest: str | None, text: str | None) -> Version:
        version = Version(self._next, at, digest, text, len(text.encode("utf-8")) if text else 0)
        self._next += 1
        return version

    def _prune(self) -> None:
        """The oldest versions go first; an item's newest is always kept."""
        for item in self._items.values():
            del item.versions[:-MAX_HISTORY_VERSIONS]
        total = sum(v.bytes for item in self._items.values() for v in item.versions)
        if total > MAX_HISTORY_BYTES:
            older = [
                (version.id, item.id)
                for item in self._items.values()
                for version in item.versions[:-1]
            ]
            heapq.heapify(older)
            while total > MAX_HISTORY_BYTES and older:
                version_id, item_id = heapq.heappop(older)
                item = self._items[item_id]
                index = next(i for i, v in enumerate(item.versions) if v.id == version_id)
                total -= item.versions.pop(index).bytes
        # An item removed, with nothing else kept, has nothing to show.
        for item_id, item in list(self._items.items()):
            if all(version.removed for version in item.versions):
                del self._items[item_id]
        if len(self._items) > MAX_HISTORY_ITEMS:
            gone = sorted(
                (item for item in self._items.values() if item.versions[-1].removed),
                key=lambda item: item.versions[-1].id,
            )
            for item in gone[: len(self._items) - MAX_HISTORY_ITEMS]:
                del self._items[item.id]

    def items(self) -> list[dict[str, Any]]:
        """Every item, the most recently changed first."""
        listed = sorted(self._items.values(), key=lambda item: -item.versions[-1].id)
        return [_summary(item) for item in listed]

    def item(self, item_id: str) -> dict[str, Any]:
        """An item and its versions, newest first; each says the earlier one it is the same as."""
        item = self._get(item_id)
        versions: list[dict[str, Any]] = []
        seen: dict[str, int] = {}
        for version in item.versions:
            entry: dict[str, Any] = {
                "id": version.id,
                "at": version.at.isoformat(),
                "removed": version.removed,
                "kept": version.json is not None,
            }
            if version.hash is not None:
                if version.hash in seen:
                    entry["same_as"] = seen[version.hash]
                seen[version.hash] = version.id
            versions.append(entry)
        return {"item": _summary(item), "versions": versions[::-1]}

    def version(self, item_id: str, version_id: int) -> Any:
        """A version's configuration; None when it was removed or too large to keep."""
        item = self._get(item_id)
        for version in item.versions:
            if version.id == version_id:
                return json_loads(version.json) if version.json is not None else None
        raise HistoryError("unknown_version")

    def _get(self, item_id: str) -> Item:
        if (item := self._items.get(item_id)) is None:
            raise HistoryError("unknown_item")
        return item

    def size(self) -> int:
        """The bytes the versions kept take."""
        return sum(v.bytes for item in self._items.values() for v in item.versions)

    async def async_remove(self) -> None:
        """Delete the store (the integration removed)."""
        await self._store.async_remove()

    def _data(self) -> dict[str, Any]:
        return {
            "next": self._next,
            "items": {
                item.id: {
                    "kind": item.kind,
                    "key": item.key,
                    "name": item.name,
                    "source": item.source,
                    "versions": [
                        {"id": v.id, "at": v.at.isoformat(), "hash": v.hash, "json": v.json}
                        for v in item.versions
                    ],
                }
                for item in self._items.values()
            },
        }


def _summary(item: Item) -> dict[str, Any]:
    newest = item.versions[-1]
    return {
        "id": item.id,
        "kind": item.kind,
        "key": item.key,
        "name": item.name,
        "source": item.source,
        "removed": newest.removed,
        "versions": len(item.versions),
        "changed": newest.at.isoformat(),
    }


def _read_version(raw: Any) -> Version | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), int):
        return None
    at = dt_util.parse_datetime(str(raw.get("at", "")))
    digest, text = raw.get("hash"), raw.get("json")
    if at is None or not isinstance(digest, str | None) or not isinstance(text, str | None):
        return None
    if digest is None and text is not None:
        return None
    return Version(
        raw["id"], dt_util.as_utc(at), digest, text, len(text.encode("utf-8")) if text else 0
    )


def _read_item(raw: Any) -> Item | None:
    """An item as stored, leniently: None when it is not one or has no version."""
    if not isinstance(raw, dict):
        return None
    kind, key, name, source = raw.get("kind"), raw.get("key"), raw.get("name"), raw.get("source")
    if kind not in HISTORY_KINDS or not isinstance(key, str) or source not in ("editor", "yaml"):
        return None
    versions = raw.get("versions")
    kept = [v for v in map(_read_version, versions if isinstance(versions, list) else []) if v]
    if not kept:
        return None
    kept.sort(key=lambda version: version.id)
    return Item(kind, key, _name(name), source, kept)


# The websocket commands: administrators only, who alone may read Home Assistant's configuration.


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the configuration history (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_history_list)
    websocket_api.async_register_command(hass, ws_history_item)
    websocket_api.async_register_command(hass, ws_history_version)
    websocket_api.async_register_command(hass, ws_history_refresh)


def _history(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> ConfigHistory | None:
    from .data import HISTORY_KEY  # noqa: PLC0415 (data imports this module)

    history = hass.data.get(HISTORY_KEY)
    if history is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return history


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "domotwin/history/list"})
@callback
def ws_history_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Every item kept, the most recently changed first, and the room the history takes."""
    if (history := _history(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"],
        {"items": history.items(), "bytes": history.size(), "max_bytes": MAX_HISTORY_BYTES},
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/history/item", vol.Required("item"): str}
)
@callback
def ws_history_item(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """An item and its versions, newest first."""
    if (history := _history(hass, connection, msg)) is None:
        return
    try:
        connection.send_result(msg["id"], history.item(msg["item"]))
    except HistoryError as err:
        connection.send_error(msg["id"], err.code, err.code)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/history/version",
        vol.Required("item"): str,
        vol.Required("version"): int,
    }
)
@callback
def ws_history_version(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """A version's configuration (`null`: removed, or too large to keep)."""
    if (history := _history(hass, connection, msg)) is None:
        return
    try:
        connection.send_result(msg["id"], {"config": history.version(msg["item"], msg["version"])})
    except HistoryError as err:
        connection.send_error(msg["id"], err.code, err.code)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/history/refresh", vol.Optional("kind"): vol.In(HISTORY_KINDS)}
)
@websocket_api.async_response
async def ws_history_refresh(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Reads a kind (every kind without one) now, after an item was put back; the versions kept."""
    if (history := _history(hass, connection, msg)) is None:
        return
    kinds = (msg["kind"],) if "kind" in msg else HISTORY_KINDS
    connection.send_result(msg["id"], {"changed": await history.async_snapshot(kinds)})
