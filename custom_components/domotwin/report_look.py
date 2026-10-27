"""What needs a look, for the weekly report (`docs/DECISIONS.md`, D-070).

Read from what Home Assistant and the integrations installed already say, rather than worked out
again: the batteries low (Battery Notes' where it is installed), the devices unavailable, the
updates and the repairs waiting (Spook's among them; what Watchman finds missing), the upkeep due
(D-033), the automations that failed this week, never ran or cannot run, and the Zigbee devices
that hang by a weak link (D-031). Each item has a `key`, the same from one week to the next while
it is the same thing to look at, and the room it is in, when it has one.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from datetime import date, datetime, timedelta
import logging
import math
from typing import Any, Final

from homeassistant.const import ATTR_DEVICE_CLASS, ATTR_FRIENDLY_NAME, ATTR_UNIT_OF_MEASUREMENT
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    issue_registry as ir,
)
from homeassistant.helpers.translation import async_get_translations
from homeassistant.util import dt as dt_util

from .overview import piece_rooms
from .people import Area, Room, rooms_of
from .report_radios import Weak
from .upkeep import due_tasks, parse_date, piece_names

_LOGGER = logging.getLogger(__name__)

#: A device is named among the unavailable once all its entities have been for this long.
UNAVAILABLE_FOR: Final = timedelta(hours=1)
#: A warranty ending within this many days is said (as the pieces' badges say it, D-033).
WARRANTY_DAYS: Final = 30
#: An automation never run is named once it has existed for this long.
NEVER_RUN_AFTER: Final = timedelta(days=7)
#: Texts kept at most this long (names, errors, titles).
MAX_TEXT: Final = 200
#: Watchman's sensors of what it finds missing (`translation_key`; the end of their unique id in
#: its versions before translation keys, `missing_services` the oldest's).
WATCHMAN: Final = {
    "missing_entities": "_missing_entities",
    "missing_actions": "_missing_actions",
    "missing_services": "_missing_services",
}

type Item = dict[str, Any]


# The elements of a plan that may name their room (`docs/plan-format.md`).
ROOM_NAMED = ("doors", "windows", "partitions")


def element_rooms(storeys: Iterable[Mapping[str, Any]], rooms: set[str]) -> dict[str, str]:
    """The room of every element that has one, by element id: pieces, openings, rooms."""
    storeys = list(storeys)
    found: dict[str, str] = {room: room for room in rooms}
    for storey in storeys:
        plan = storey.get("plan")
        for key in ROOM_NAMED:
            listed = plan.get(key) if isinstance(plan, Mapping) else None
            for element in listed if isinstance(listed, list) else []:
                if not isinstance(element, Mapping) or not isinstance(element.get("id"), str):
                    continue
                room = element.get("room")
                if isinstance(room, str) and room in rooms:
                    found[element["id"]] = room
    found.update(piece_rooms(storeys))
    return found


class Places:
    """The room of an entity or a device, for the report's items."""

    def __init__(
        self,
        storeys: list[dict[str, Any]],
        bindings: Mapping[str, Any],
        areas: ar.AreaRegistry,
        devices: dr.DeviceRegistry,
        entities: er.EntityRegistry,
    ) -> None:
        """Read the plans, the bindings and Home Assistant's registries once."""
        bound = bindings.get("rooms")
        known = [Area(area.id, area.name, tuple(area.aliases)) for area in areas.async_list_areas()]
        self.rooms: list[Room] = rooms_of(storeys, bound if isinstance(bound, dict) else {}, known)
        self._devices = devices
        self._entities = entities
        by_area: dict[str, str] = {}
        for each in self.rooms:
            if each.area:
                by_area.setdefault(each.area, each.id)
        self._by_area = by_area
        elements = element_rooms(storeys, {room.id for room in self.rooms})
        self._by_entity: dict[str, str] = {}
        self._by_device: dict[str, str] = {}
        linked = bindings.get("elements")
        for element, binding in (linked if isinstance(linked, Mapping) else {}).items():
            room = elements.get(element)
            if room is None or not isinstance(binding, Mapping):
                continue
            device = binding.get("device")
            if isinstance(device, str):
                self._by_device.setdefault(device, room)
            for entity in binding.get("entities") or []:
                entity_id = entity.get("entity_id") if isinstance(entity, Mapping) else None
                if isinstance(entity_id, str):
                    self._by_entity.setdefault(entity_id, room)

    def of_device(self, device_id: str | None) -> str | None:
        """The room of a device: an element linked to it or its entities, else its area's."""
        if device_id is None:
            return None
        if (room := self._by_device.get(device_id)) is not None:
            return room
        for entry in er.async_entries_for_device(self._entities, device_id):
            if (room := self._by_entity.get(entry.entity_id)) is not None:
                return room
        device = self._devices.async_get(device_id)
        return self._by_area.get(device.area_id) if device and device.area_id else None

    def of_entity(self, entity_id: str) -> str | None:
        """The room of an entity: an element linked to it, else its area's, else its device's."""
        if (room := self._by_entity.get(entity_id)) is not None:
            return room
        entry = self._entities.async_get(entity_id)
        if entry is None:
            return None
        if entry.area_id:
            return self._by_area.get(entry.area_id)
        return self.of_device(entry.device_id)


def _text(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:MAX_TEXT]


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _placed(item: Item, room: str | None) -> Item:
    if room is not None:
        item["room"] = room
    return item


class Look:
    """Reads what needs a look now, from Home Assistant's states and registries."""

    def __init__(self, hass: HomeAssistant, places: Places, now: datetime) -> None:
        """What is read, and when."""
        self._hass = hass
        self._places = places
        self._now = now
        self._entities = er.async_get(hass)
        self._devices = dr.async_get(hass)

    def device_name(self, device_id: str | None) -> str | None:
        """A device as Home Assistant names it: the user's name, else its own."""
        device = self._devices.async_get(device_id) if device_id else None
        if device is None:
            return None
        return _text(device.name_by_user) or _text(device.name)

    def entity_name(self, state: State) -> str:
        """An entity as Home Assistant shows it: its friendly name, else its id."""
        return _text(state.attributes.get(ATTR_FRIENDLY_NAME)) or state.entity_id

    def _device_of(self, entity_id: str) -> str | None:
        entry = self._entities.async_get(entity_id)
        return entry.device_id if entry else None

    # The batteries.

    def batteries(self, threshold: int) -> list[Item]:
        """The batteries low, one item per device (else per entity).

        Battery Notes' low-battery sensors where it is installed (its threshold, the battery to
        buy); else a battery sensor at `threshold` % or below, or a battery binary sensor on, as
        Home Assistant's Maintenance page counts them (a device charging left out).
        """
        by_device: dict[str, Item] = {}
        loose: list[Item] = []
        notes, noted = self._battery_notes(by_device, loose)
        charging = self._charging()
        for state in self._hass.states.async_all(("sensor", "binary_sensor")):
            if state.attributes.get(ATTR_DEVICE_CLASS) != "battery":
                continue
            device = self._device_of(state.entity_id)
            if device in noted or state.entity_id in notes:
                continue
            if state.domain == "binary_sensor":
                if state.state != "on":
                    continue
                item = self._battery_item(state, device, "binary_sensor")
            else:
                level = _number(state.state)
                unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
                if level is None or unit != "%" or level > threshold or device in charging:
                    continue
                item = self._battery_item(state, device, "sensor")
                item["level"] = round(level)
            self._keep(item, device, by_device, loose)
        items = [*by_device.values(), *loose]
        items.sort(key=lambda item: (item.get("level", -1), item["name"].casefold()))
        return items

    def _battery_notes(
        self, by_device: dict[str, Item], loose: list[Item]
    ) -> tuple[set[str], set[str]]:
        """Battery Notes' batteries low; its entities, and the devices it watches.

        It knows each device's threshold and battery, and its own sensor the level.
        """
        levels: dict[str, float] = {}
        lows: list[er.RegistryEntry] = []
        notes: set[str] = set()
        noted: set[str] = set()
        for entry in list(self._entities.entities.values()):
            if entry.platform != "battery_notes" or entry.disabled_by is not None:
                continue
            notes.add(entry.entity_id)
            if entry.domain == "binary_sensor" and entry.translation_key == "battery_low":
                lows.append(entry)
                if entry.device_id:
                    noted.add(entry.device_id)
            elif entry.domain == "sensor" and entry.translation_key == "battery_plus":
                plus = self._hass.states.get(entry.entity_id)
                level = _number(plus.state) if plus is not None else None
                if entry.device_id and level is not None:
                    levels[entry.device_id] = level
        for entry in lows:
            state = self._hass.states.get(entry.entity_id)
            if state is None or state.state != "on":
                continue
            item = self._battery_item(state, entry.device_id, "battery_notes")
            if entry.device_id and (level := levels.get(entry.device_id)) is not None:
                item["level"] = round(level)
            kind = _text(state.attributes.get("battery_type_and_quantity")) or _text(
                state.attributes.get("battery_type")
            )
            if kind is not None:
                item["battery"] = kind
            self._keep(item, entry.device_id, by_device, loose)
        return notes, noted

    def _charging(self) -> set[str]:
        """The devices charging now (a `battery_charging` binary sensor on): not low for long."""
        found: set[str] = set()
        for state in self._hass.states.async_all("binary_sensor"):
            if state.attributes.get(ATTR_DEVICE_CLASS) != "battery_charging":
                continue
            if state.state == "on" and (device := self._device_of(state.entity_id)) is not None:
                found.add(device)
        return found

    def _battery_item(self, state: State, device: str | None, source: str) -> Item:
        key = f"battery:{device or state.entity_id}"
        item: Item = {
            "key": key,
            "name": self.device_name(device) or self.entity_name(state),
            "entity": state.entity_id,
            "source": source,
        }
        if device:
            item["device"] = device
        return _placed(item, self._places.of_entity(state.entity_id))

    @staticmethod
    def _keep(
        item: Item, device: str | None, by_device: dict[str, Item], loose: list[Item]
    ) -> None:
        """One item per device: the lowest level said."""
        if device is None:
            loose.append(item)
            return
        kept = by_device.get(device)
        if kept is None or item.get("level", 101) < kept.get("level", 101):
            by_device[device] = item

    # The devices unavailable.

    def unavailable(self, before: Mapping[str, str] | None = None) -> list[Item]:
        """The devices whose entities have all been unavailable for an hour at least.

        Their entities with a state: those disabled have none. Since when: the last of them to go,
        or when the report before (`before`: its items' keys and their `since`) said, since Home
        Assistant's restarts start their states again.
        """
        before = before or {}
        by_device: dict[str, list[State]] = {}
        for state in self._hass.states.async_all():
            entry = self._entities.async_get(state.entity_id)
            if entry is None or entry.device_id is None:
                continue
            by_device.setdefault(entry.device_id, []).append(state)
        items: list[Item] = []
        for device_id, states in by_device.items():
            if any(state.state != "unavailable" for state in states):
                continue
            device = self._devices.async_get(device_id)
            if device is None or device.disabled_by is not None:
                continue
            key = f"unavailable:{device_id}"
            since = max(state.last_changed for state in states)
            said = dt_util.parse_datetime(before.get(key, ""))
            if said is not None and dt_util.as_utc(said) < since:
                since = dt_util.as_utc(said)
            elif self._now - since < UNAVAILABLE_FOR:
                continue
            item: Item = {
                "key": key,
                "name": self.device_name(device_id) or self.entity_name(states[0]),
                "device": device_id,
                "since": since.isoformat(),
            }
            items.append(_placed(item, self._places.of_device(device_id)))
        items.sort(key=lambda item: (item["since"], item["name"].casefold()))
        return items

    # The updates.

    def updates(self) -> list[Item]:
        """The updates waiting: the update entities that are on (one skipped is off)."""
        items: list[Item] = []
        for state in self._hass.states.async_all("update"):
            if state.state != "on":
                continue
            latest = _text(state.attributes.get("latest_version"))
            item: Item = {
                # The same while it waits, whichever version it waits for.
                "key": f"update:{state.entity_id}",
                "name": _text(state.attributes.get("title")) or self.entity_name(state),
                "entity": state.entity_id,
            }
            installed = _text(state.attributes.get("installed_version"))
            if installed is not None:
                item["installed"] = installed
            if latest is not None:
                item["latest"] = latest
            items.append(_placed(item, self._places.of_entity(state.entity_id)))
        items.sort(key=lambda item: item["name"].casefold())
        return items

    # The repairs.

    async def repairs(self, language: str) -> list[Item]:
        """The repairs waiting, as Settings → Repairs lists them: active and not ignored.

        Their titles in the home's language, as the integration that raised each writes it.
        """
        issues = [
            issue
            for issue in ir.async_get(self._hass).issues.values()
            if issue.active and issue.dismissed_version is None
        ]
        domains = {issue.domain for issue in issues}
        titles: dict[str, str] = {}
        if domains:
            try:
                titles = await async_get_translations(self._hass, language, "issues", domains)
            except Exception:
                _LOGGER.debug("The repairs' titles cannot be read", exc_info=True)
        items: list[Item] = []
        for issue in issues:
            # As Settings → Repairs titles it: its translation, else `<domain>: <key>`.
            key = issue.translation_key or issue.issue_id
            text = titles.get(f"component.{issue.domain}.issues.{key}.title")
            title = _format(text, issue.translation_placeholders)
            item: Item = {
                "key": f"repair:{issue.domain}:{issue.issue_id}",
                "name": _text(title) or f"{issue.domain}: {key}"[:MAX_TEXT],
                "domain": issue.domain,
                "severity": str(issue.severity),
            }
            if issue.issue_domain and issue.issue_domain != issue.domain:
                item["about"] = issue.issue_domain
            items.append(item)
        items.extend(self._watchman())
        items.sort(key=lambda item: (item["domain"], item["name"].casefold()))
        return items

    def _watchman(self) -> list[Item]:
        """What Watchman found missing in the configuration.

        The entities and actions named in it that Home Assistant does not have, from its sensors'
        `entities` (read live: they are not recorded).
        """
        items: list[Item] = []
        for entry in list(self._entities.entities.values()):
            if entry.platform != "watchman" or entry.domain != "sensor":
                continue
            what = entry.translation_key or ""
            if what not in WATCHMAN:
                what = next((k for k, v in WATCHMAN.items() if entry.unique_id.endswith(v)), "")
            if not what or (state := self._hass.states.get(entry.entity_id)) is None:
                continue
            listed = state.attributes.get("entities")
            for missing in listed if isinstance(listed, list) else []:
                name = _text(missing.get("id")) if isinstance(missing, Mapping) else None
                if name is None:
                    continue
                item: Item = {
                    "key": f"watchman:{what}:{name}",
                    "name": name,
                    "domain": "watchman",
                    "missing": "entity" if what == "missing_entities" else "action",
                }
                if isinstance(missing, Mapping) and (said := _text(missing.get("state"))):
                    item["state"] = said
                items.append(item)
        return items

    # The upkeep.

    def upkeep(
        self,
        storeys: list[dict[str, Any]],
        upkeep: Mapping[str, Any],
        rooms: Mapping[str, str],
        today: date,
    ) -> list[Item]:
        """The pieces' upkeep: tasks due soon or overdue (D-033), warranties ending soon.

        A warranty is said in its last 30 days, as the pieces' badges say it.
        """
        names = piece_names(storeys)
        items: list[Item] = []
        for task in due_tasks(dict(upkeep), names, today):
            item: Item = {
                "key": f"upkeep:{task['piece']}:{task['task']}:{task['due']}",
                "name": task["piece_name"],
                "piece": task["piece"],
                "task": task["task"],
                "due": task["due"],
                "state": task["state"],
            }
            items.append(_placed(item, rooms.get(task["piece"])))
        pieces = upkeep.get("pieces")
        for piece, card in (pieces if isinstance(pieces, Mapping) else {}).items():
            if piece not in names or not isinstance(card, Mapping):
                continue
            ends = parse_date(card.get("warranty_end"))
            if ends is None or not 0 <= (ends - today).days <= WARRANTY_DAYS:
                continue
            item = {
                "key": f"warranty:{piece}:{ends.isoformat()}",
                "name": names[piece],
                "piece": piece,
                "warranty_end": ends.isoformat(),
            }
            items.append(_placed(item, rooms.get(piece)))
        items.sort(key=lambda item: (item.get("due") or item.get("warranty_end"), item["name"]))
        return items

    # The radios.

    def radios(self, weak: Iterable[Weak]) -> list[Item]:
        """The Zigbee devices reaching the coordinator through a weak link, or not at all."""
        items: list[Item] = []
        for found in weak:
            radio = found.radio
            item: Item = {
                "key": f"radio:{radio.device or radio.id}",
                "name": self.device_name(radio.device) or radio.name,
            }
            if radio.device:
                item["device"] = radio.device
            if found.lqi is not None:
                item["lqi"] = found.lqi
                item["hops"] = found.hops
            else:
                item["cut"] = True
            items.append(_placed(item, self._places.of_device(radio.device)))
        return items

    # The automations.

    def automations(
        self,
        failures: Mapping[str, list[dict[str, Any]]],
        created: Callable[[str], datetime | None],
    ) -> list[Item]:
        """The automations to look at.

        Those that failed this week (`failures`: their runs, by entity id), and those turned on
        that cannot run (their configuration invalid) or have never run since they were made, a
        week ago at least.
        """
        items: list[Item] = []
        for state in self._hass.states.async_all("automation"):
            entity = state.entity_id
            base: Item = {"entity": entity, "name": self.entity_name(state)}
            config_id = _text(state.attributes.get("id"))
            if config_id is not None:
                base["id"] = config_id
            runs = failures.get(entity, [])
            if runs:
                item = {**base, "key": f"automation:{entity}:failed", "problem": "failed"}
                item["runs"] = len(runs)
                last = max(runs, key=lambda run: run["at"])
                item["last"] = last["at"]
                if last.get("run_id"):
                    item["run_id"] = last["run_id"]
                if error := _text(last.get("error")):
                    item["error"] = error
                items.append(item)
            if state.state == "unavailable":
                items.append({**base, "key": f"automation:{entity}:broken", "problem": "broken"})
            elif state.state == "on" and state.attributes.get("last_triggered") is None:
                made = created(entity)
                if made is not None and self._now - made >= NEVER_RUN_AFTER:
                    items.append({**base, "key": f"automation:{entity}:never", "problem": "never"})
        order = {"failed": 0, "broken": 1, "never": 2}
        items.sort(key=lambda item: (order[item["problem"]], item["name"].casefold()))
        return items


def _format(text: str | None, placeholders: Mapping[str, str] | None) -> str | None:
    """A translated text with its placeholders, as the frontend fills them; None when it fails."""
    if text is None:
        return None
    try:
        return text.format(**(placeholders or {}))
    except (KeyError, IndexError, ValueError):
        return text


async def async_failed_runs(
    hass: HomeAssistant, start: datetime, end: datetime
) -> dict[str, list[dict[str, Any]]]:
    """The automations' runs that failed between `start` and `end`, by entity id.

    From the traces Home Assistant keeps (the last five runs of each automation unless set
    otherwise, kept across a restart): a run failed when it recorded an error. A run stopped by a
    condition, or one not set off, is no failure. Nothing when the traces cannot be read.
    """
    if "trace" not in hass.config.components:
        return {}
    try:
        from homeassistant.components.trace.util import (  # noqa: PLC0415 (traces are optional)
            async_list_traces,
        )

        traces: list[Any] = await async_list_traces(hass, "automation", None)
    except Exception:
        _LOGGER.debug("The automations' traces cannot be read", exc_info=True)
        return {}
    registry = er.async_get(hass)
    found: dict[str, list[dict[str, Any]]] = {}
    for trace in traces:
        if not isinstance(trace, Mapping) or trace.get("not_triggered"):
            continue
        error = trace.get("error")
        if error is None and trace.get("script_execution") != "error":
            continue
        stamps = trace.get("timestamp")
        at = _moment(stamps.get("start") if isinstance(stamps, Mapping) else None)
        if at is None or not start <= at < end:
            continue
        item_id = trace.get("item_id")
        entity = (
            registry.async_get_entity_id("automation", "automation", item_id)
            if isinstance(item_id, str)
            else None
        )
        if entity is None:
            continue
        run: dict[str, Any] = {"at": at.isoformat()}
        if isinstance(trace.get("run_id"), str):
            run["run_id"] = trace["run_id"]
        if error is not None:
            run["error"] = str(error)[:MAX_TEXT]
        found.setdefault(entity, []).append(run)
    return found


def _moment(value: Any) -> datetime | None:
    """A trace's time: a datetime while it runs, its ISO text once restored from storage."""
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str):
        parsed = dt_util.parse_datetime(value)
        if parsed is None:
            return None
        moment = parsed
    else:
        return None
    return dt_util.as_utc(moment) if moment.tzinfo else moment.replace(tzinfo=dt_util.UTC)
