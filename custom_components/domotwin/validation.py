"""Envelope checks of what clients send. The full lenient plan reader lives in domotwin-core."""

from __future__ import annotations

from collections.abc import Callable
import json
import re
from typing import Any, Final

from homeassistant.core import valid_entity_id
from homeassistant.helpers.json import json_bytes

from .const import (
    LOCATED_KINDS,
    MAX_ACCESS_POINT_NAME,
    MAX_ACCESS_POINTS,
    MAX_BINDINGS_BYTES,
    MAX_BOUND_ELEMENTS,
    MAX_ELEMENTS,
    MAX_ELEVATION,
    MAX_ENTITIES_PER_ELEMENT,
    MAX_ID_LENGTH,
    MAX_LAYOUT_BYTES,
    MAX_LEAD_DAYS,
    MAX_LOCATED,
    MAX_LOCATED_NAME,
    MAX_MODEL_BYTES,
    MAX_MODELS,
    MAX_MODELS_BYTES,
    MAX_PEOPLE,
    MAX_PERSON_SOURCES,
    MAX_PLAN_BYTES,
    MAX_PLAN_REACH,
    MAX_PRIVATE_ROOMS,
    MAX_RADARS,
    MAX_RECEIVERS,
    MAX_RIGHTS_ENTITIES,
    MAX_RIGHTS_PEOPLE,
    MAX_RIGHTS_ROOMS,
    MAX_ROOM_ACTION_NAME,
    MAX_ROOM_ACTIONS,
    MAX_STOREY_NAME,
    MAX_STOREYS,
    MAX_UPKEEP_BYTES,
    MAX_UPKEEP_DAYS,
    MAX_UPKEEP_LINK,
    MAX_UPKEEP_MONTHS,
    MAX_UPKEEP_NOTES,
    MAX_UPKEEP_TASKS,
    MAX_UPKEEP_TEXT,
    MIN_ELEVATION,
    MODEL_ENTRY_PREFIX,
    MODEL_FORMATS,
    PEOPLE_LOOKS,
    PEOPLE_SHOWN,
    PLAN_FORMAT,
    PLAN_LISTS,
    RIGHTS_LEVELS,
)
from .people import valid_color
from .upkeep import parse_date

MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
# Bluetooth locating (D-035): a receiver's or a tag's address, a followed device's id, an iBeacon.
MAC = re.compile(r"[0-9A-F]{2}(:[0-9A-F]{2}){5}")
LOCATED_ID = re.compile(r"[a-z0-9][a-z0-9_]{0,39}")
BEACON_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
SHA256 = re.compile(r"[0-9a-f]{64}")

ACTIONS = frozenset(
    {"toggle", "more-info", "perform-action", "call-service", "navigate", "controls", "none"}
)


class InvalidPayloadError(ValueError):
    """A payload was refused. `code` is sent to the client, which translates it."""

    def __init__(self, code: str, message: str) -> None:
        """Keep the code for the websocket error."""
        super().__init__(message)
        self.code = code


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _check_size(value: Any, limit: int, what: str) -> None:
    if len(json_bytes(value)) > limit:
        raise InvalidPayloadError("too_large", f"{what} is larger than {limit} bytes")


def _check_id(value: Any, what: str, code: str) -> None:
    if not isinstance(value, str) or not 0 < len(value) <= MAX_ID_LENGTH:
        raise InvalidPayloadError(
            code, f"{what} must be a string of 1 to {MAX_ID_LENGTH} characters"
        )


def _file_bytes(model: Any) -> int:
    """The declared size of a model's file (0 when it has none)."""
    file = model.get("file") if isinstance(model, dict) else None
    size = file.get("bytes") if isinstance(file, dict) else None
    return size if isinstance(size, int) and not isinstance(size, bool) else 0


def _validate_model(model: Any, code: str) -> None:
    """The envelope of a user model (docs/plan-format.md, user 3D models)."""
    if not isinstance(model, dict):
        raise InvalidPayloadError(code, "a model must be an object")
    name = model.get("name", "")
    if not isinstance(name, str) or len(name) > 100:
        raise InvalidPayloadError(code, "a model's `name` must be a text of at most 100 characters")
    size = model.get("size")
    limits = (10_000, 10_000, 300)
    if (
        not isinstance(size, list)
        or len(size) != 3
        or not all(_is_number(v) and 1 <= v <= m for v, m in zip(size, limits, strict=False))
    ):
        raise InvalidPayloadError(code, "a model's `size` must be [w, d, h] in cm")
    file = model.get("file")
    if not isinstance(file, dict):
        raise InvalidPayloadError(code, "a model's `file` must be an object")
    if file.get("format") not in MODEL_FORMATS or file.get("up") not in ("y", "z"):
        raise InvalidPayloadError(code, "a model file needs a known `format` and `up`")
    if not isinstance(file.get("hash"), str) or not SHA256.fullmatch(file["hash"]):
        raise InvalidPayloadError(code, "a model file's `hash` must be a SHA-256")
    if not 1 <= _file_bytes(model) <= MAX_MODEL_BYTES:
        raise InvalidPayloadError(code, f"a model file has 1 to {MAX_MODEL_BYTES} bytes")
    if "data" in file:
        raise InvalidPayloadError(code, "model files are uploaded, not embedded")


def validate_models(plan: dict[str, Any] | None, layout: dict[str, Any]) -> None:
    """The plan's models and those of the overlay: at most 50, 20 MB of files in all."""
    models: dict[str, Any] = {}
    if plan is not None and isinstance(plan.get("models"), dict):
        models.update(plan["models"])
    for key, entry in layout.items():
        if key.startswith(MODEL_ENTRY_PREFIX):
            models.setdefault(key.removeprefix(MODEL_ENTRY_PREFIX), entry.get("model"))
    if len(models) > MAX_MODELS:
        raise InvalidPayloadError("too_many_models", f"a plan has at most {MAX_MODELS} models")
    if sum(_file_bytes(m) for m in models.values()) > MAX_MODELS_BYTES:
        raise InvalidPayloadError(
            "too_large", f"the files of a plan's models total at most {MAX_MODELS_BYTES} bytes"
        )


def _plan_lists(plan: dict[str, Any]) -> list[list[Any]]:
    """The lists of elements a plan has (a missing one is empty)."""
    return [plan[key] for key in PLAN_LISTS if isinstance(plan.get(key), list)]


def validate_plan(plan: Any) -> dict[str, Any]:
    """Check the envelope of a DomoTwin plan; the engine reads the rest (docs/plan-format.md)."""
    if not isinstance(plan, dict) or plan.get("format") != PLAN_FORMAT:
        raise InvalidPayloadError(
            "invalid_plan", f'a plan is an object with `format` "{PLAN_FORMAT}"'
        )
    version = plan.get("version")
    if not _is_number(version) or version != 1:
        raise InvalidPayloadError("invalid_plan", "`version` must be 1")
    for key in PLAN_LISTS:
        # Missing or null: empty, as the engine reads it.
        if plan.get(key) is not None and not isinstance(plan[key], list):
            raise InvalidPayloadError("invalid_plan", f"`{key}` must be a list")
    elements = [element for found in _plan_lists(plan) for element in found]
    if not 0 < len(elements) <= MAX_ELEMENTS:
        raise InvalidPayloadError("invalid_plan", f"a plan holds 1 to {MAX_ELEMENTS} elements")
    if not all(isinstance(element, dict) for element in elements):
        raise InvalidPayloadError("invalid_plan", "every element must be a JSON object")
    models = plan.get("models")
    if models is not None:
        if not isinstance(models, dict) or len(models) > MAX_MODELS:
            raise InvalidPayloadError("invalid_plan", f"`models` holds at most {MAX_MODELS} models")
        for model in models.values():
            _validate_model(model, "invalid_plan")
    _check_size(plan, MAX_PLAN_BYTES, "the plan")
    return plan


def validate_layout(layout: Any) -> dict[str, Any]:
    """Check the edit overlay: element id → object."""
    if not isinstance(layout, dict):
        raise InvalidPayloadError("invalid_layout", "the layout must be a JSON object")
    if len(layout) > 2 * MAX_ELEMENTS:
        raise InvalidPayloadError("invalid_layout", "the layout has too many entries")
    for element_id, entry in layout.items():
        _check_id(element_id, "a layout key", "invalid_layout")
        if not isinstance(entry, dict):
            raise InvalidPayloadError("invalid_layout", "every layout entry must be an object")
        if element_id.startswith(MODEL_ENTRY_PREFIX):
            if not MODEL_ID.fullmatch(element_id.removeprefix(MODEL_ENTRY_PREFIX)):
                raise InvalidPayloadError("invalid_layout", "a model id is 1 to 64 letters")
            _validate_model(entry.get("model"), "invalid_layout")
    _check_size(layout, MAX_LAYOUT_BYTES, "the layout")
    return layout


def _validate_action(action: Any) -> None:
    if not isinstance(action, dict) or action.get("action") not in ACTIONS:
        raise InvalidPayloadError(
            "invalid_bindings", f"an action must be an object with `action` in {sorted(ACTIONS)}"
        )


def _validate_element_binding(binding: Any) -> None:
    if not isinstance(binding, dict):
        raise InvalidPayloadError("invalid_bindings", "every binding must be an object")
    # The Home Assistant device the element stands for (the network map, D-031): with it, the
    # element may have no entities (a Zigbee coordinator has none).
    device = binding.get("device")
    if device is not None and (not isinstance(device, str) or not 0 < len(device) <= 64):
        raise InvalidPayloadError("invalid_bindings", "`device` must be a device id")
    entities = binding.get("entities")
    least = 0 if device else 1
    if not isinstance(entities, list) or not least <= len(entities) <= MAX_ENTITIES_PER_ELEMENT:
        raise InvalidPayloadError(
            "invalid_bindings",
            f"`entities` must hold {least} to {MAX_ENTITIES_PER_ELEMENT} entities",
        )
    for entity in entities:
        if not isinstance(entity, dict) or not isinstance(entity.get("entity_id"), str):
            raise InvalidPayloadError("invalid_bindings", "every entity needs an `entity_id`")
        if not valid_entity_id(entity["entity_id"]):
            raise InvalidPayloadError(
                "invalid_bindings", f"`{entity['entity_id']}` is not an entity id"
            )
        role = entity.get("role")
        if role is not None and not isinstance(role, str):
            raise InvalidPayloadError("invalid_bindings", "`role` must be a string")
    for key in ("tap_action", "hold_action"):
        if key in binding:
            _validate_action(binding[key])
    # What a linked camera sees (DECISIONS.md, D-024): its angle of view and reach.
    for key, low, high in (("fov", 10, 180), ("range", 50, 3000)):
        if key in binding and not (_is_number(binding[key]) and low <= binding[key] <= high):
            raise InvalidPayloadError(
                "invalid_bindings", f"`{key}` must be a number from {low} to {high}"
            )


def _validate_room_binding(room: Any) -> None:
    """A room's area, and its own actions (D-047): each a name and an action."""
    if not isinstance(room, dict) or not isinstance(room.get("area", ""), str):
        raise InvalidPayloadError("invalid_bindings", "a room binding needs a string `area`")
    # Missing or null: none, as the frontend reads it.
    actions = room.get("actions") or []
    if not isinstance(actions, list) or len(actions) > MAX_ROOM_ACTIONS:
        raise InvalidPayloadError(
            "invalid_bindings", f"a room's `actions` hold at most {MAX_ROOM_ACTIONS} actions"
        )
    for entry in actions:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not 0 < len(name.strip()) <= MAX_ROOM_ACTION_NAME:
            raise InvalidPayloadError(
                "invalid_bindings",
                f"a room's action needs a `name` of 1 to {MAX_ROOM_ACTION_NAME} characters",
            )
        _validate_action(entry.get("action"))


def validate_bindings(bindings: Any) -> dict[str, Any]:
    """Check bindings (see docs/bindings.md)."""
    if not isinstance(bindings, dict) or bindings.get("version") != 1:
        raise InvalidPayloadError("invalid_bindings", "bindings must be an object with version 1")
    rooms = bindings.get("rooms", {})
    elements = bindings.get("elements", {})
    if not isinstance(rooms, dict) or not isinstance(elements, dict):
        raise InvalidPayloadError("invalid_bindings", "`rooms` and `elements` must be objects")
    if len(rooms) + len(elements) > MAX_BOUND_ELEMENTS:
        raise InvalidPayloadError("invalid_bindings", "too many bound elements")
    for room_id, room in rooms.items():
        _check_id(room_id, "a room id", "invalid_bindings")
        _validate_room_binding(room)
    for element_id, binding in elements.items():
        _check_id(element_id, "an element id", "invalid_bindings")
        _validate_element_binding(binding)
    _check_size(bindings, MAX_BINDINGS_BYTES, "the bindings")
    return {"version": 1, "rooms": rooms, "elements": elements}


THEMES: Final = ("auto", "day", "neon", "blueprint", "cartoon", "clay")
ACCENT: Final = re.compile(r"#[0-9a-fA-F]{6}")
#: The roofs' shapes and slopes (degrees), as the engine draws them (D-077).
ROOF_SHAPES: Final = ("gable", "hip", "shed", "flat")
ROOF_PITCH: Final = (5, 60)


def validate_settings(settings: Any) -> dict[str, Any]:
    """Check the home's settings.

    `north`, degrees clockwise from the top of the plan; the look shown by default (`theme`) and
    its accent colour (`accent`, `#rrggbb`); the private rooms (`rooms`, D-039); where the
    home's energy is read (`energy`, D-049); the Wi-Fi access points placed on the plan
    (`access_points`, D-066); each person's rights (`rights`, D-071); the weather drawn around it
    (`weather`, D-072: a `weather` entity, or `none`); how its roofs are drawn (`roof`, D-077);
    whether it is a workplace, and its opening hours (`workplace`, D-086).
    """
    if not isinstance(settings, dict) or set(settings) - {
        "north",
        "theme",
        "accent",
        "rooms",
        "energy",
        "access_points",
        "rights",
        "weather",
        "roof",
        "workplace",
    }:
        raise InvalidPayloadError(
            "invalid_settings",
            "settings hold only `north`, `theme`, `accent`, `rooms`, `energy`, `access_points`, "
            "`rights`, `weather`, `roof` and `workplace`",
        )
    north = settings.get("north", 0)
    if not _is_number(north) or not 0 <= north < 360:
        raise InvalidPayloadError("invalid_settings", "`north` must be a number from 0 to 360")
    checked: dict[str, Any] = {"north": north}
    if "theme" in settings:
        if settings["theme"] not in THEMES:
            raise InvalidPayloadError("invalid_settings", f"`theme` must be one of {THEMES}")
        checked["theme"] = settings["theme"]
    if "accent" in settings:
        accent = settings["accent"]
        if not isinstance(accent, str) or not ACCENT.fullmatch(accent):
            raise InvalidPayloadError("invalid_settings", "`accent` must be a colour #rrggbb")
        checked["accent"] = accent.lower()
    if "rooms" in settings:
        checked["rooms"] = _private_rooms(settings["rooms"])
    if "weather" in settings:
        checked["weather"] = _weather(settings["weather"])
    # Kept even when empty: a workplace without hours is one still.
    if "workplace" in settings:
        checked["workplace"] = _workplace(settings["workplace"])
    # Left out when empty.
    optional: tuple[tuple[str, Callable[[Any], Any]], ...] = (
        ("energy", _energy),
        ("access_points", _access_points),
        ("rights", _rights),
        ("roof", _roof),
    )
    for key, check in optional:
        if key in settings and (found := check(settings[key])):
            checked[key] = found
    return checked


def _rights_set(levels: Any, what: str) -> dict[str, dict[str, str]]:
    """One person's rights, or everyone's (D-071).

    `{"rooms"?: {room id: level}, "entities"?: {entity id: level}}`, each level `use`, `see` or
    `hidden`. Empty lists are left out.
    """
    if not isinstance(levels, dict) or set(levels) - {"rooms", "entities"}:
        raise InvalidPayloadError("invalid_settings", f"{what} has `rooms` and `entities`")
    checked: dict[str, dict[str, str]] = {}
    for kind, limit in (("rooms", MAX_RIGHTS_ROOMS), ("entities", MAX_RIGHTS_ENTITIES)):
        given = levels.get(kind, {})
        if not isinstance(given, dict):
            raise InvalidPayloadError("invalid_settings", f"{what}'s `{kind}` must be an object")
        if len(given) > limit:
            raise InvalidPayloadError("invalid_settings", f"{what} names at most {limit} {kind}")
        for key, level in given.items():
            if kind == "rooms":
                _check_id(key, "a room id", "invalid_settings")
            elif not isinstance(key, str) or not valid_entity_id(key):
                raise InvalidPayloadError("invalid_settings", f"`{key}` is not an entity id")
            if level not in RIGHTS_LEVELS:
                raise InvalidPayloadError(
                    "invalid_settings", f"a level is one of {', '.join(RIGHTS_LEVELS)}"
                )
        if given:
            checked[kind] = dict(given)
    return checked


def _rights(rights: Any) -> dict[str, Any]:
    """Each person's rights (D-071).

    `{"everyone"?: rights, "people"?: {person entity id: rights}}`, each as `_rights_set` checks
    it.
    """
    if not isinstance(rights, dict) or set(rights) - {"everyone", "people"}:
        raise InvalidPayloadError("invalid_settings", "`rights` has `everyone` and `people`")
    checked: dict[str, Any] = {}
    everyone = _rights_set(rights.get("everyone", {}), "everyone's rights")
    if everyone:
        checked["everyone"] = everyone
    people = rights.get("people", {})
    if not isinstance(people, dict):
        raise InvalidPayloadError("invalid_settings", "`rights.people` must be an object")
    if len(people) > MAX_RIGHTS_PEOPLE:
        raise InvalidPayloadError(
            "invalid_settings", f"rights are set for at most {MAX_RIGHTS_PEOPLE} people"
        )
    own: dict[str, Any] = {}
    for person, levels in people.items():
        if (
            not isinstance(person, str)
            or not person.startswith("person.")
            or not valid_entity_id(person)
        ):
            raise InvalidPayloadError("invalid_settings", "rights are set for `person` entities")
        found = _rights_set(levels, "a person's rights")
        if found:
            own[person] = found
    if own:
        checked["people"] = own
    return checked


def _weather(weather: Any) -> str:
    """The weather drawn around the home (D-072): a `weather` entity, or `none`."""
    if weather == "none":
        return "none"
    if (
        not isinstance(weather, str)
        or not weather.startswith("weather.")
        or not valid_entity_id(weather)
    ):
        raise InvalidPayloadError(
            "invalid_settings", "`weather` must be a weather entity or `none`"
        )
    return weather


def _workplace(workplace: Any) -> dict[str, Any]:
    """A workplace, an office or a shop (D-086).

    `{"hours"?: a `schedule` entity, "meeting_rooms"?: {room id: {"calendar"?: a `calendar`
    entity}}}`. Its opening hours are those of a schedule of Home Assistant's: on while it is
    open. Its meeting rooms (D-089) are rooms of the plans, each booked in a calendar of Home
    Assistant's, if it has one.
    """
    if not isinstance(workplace, dict) or set(workplace) - {"hours", "meeting_rooms"}:
        raise InvalidPayloadError(
            "invalid_settings", "`workplace` has only `hours` and `meeting_rooms`"
        )
    checked: dict[str, Any] = {}
    if "hours" in workplace:
        hours = workplace["hours"]
        if (
            not isinstance(hours, str)
            or not hours.startswith("schedule.")
            or not valid_entity_id(hours)
        ):
            raise InvalidPayloadError(
                "invalid_settings", "`workplace.hours` must be a schedule entity"
            )
        checked["hours"] = hours
    if "meeting_rooms" in workplace:
        checked["meeting_rooms"] = _meeting_rooms(workplace["meeting_rooms"])
    return checked


def _meeting_rooms(rooms: Any) -> dict[str, dict[str, str]]:
    """A workplace's meeting rooms (D-089): `{room id: {"calendar"?: a `calendar` entity}}`."""
    if not isinstance(rooms, dict):
        raise InvalidPayloadError(
            "invalid_settings", "`meeting_rooms` must be an object of room ids"
        )
    if len(rooms) > MAX_PRIVATE_ROOMS:
        raise InvalidPayloadError("invalid_settings", f"at most {MAX_PRIVATE_ROOMS} meeting rooms")
    checked: dict[str, dict[str, str]] = {}
    for room, rule in rooms.items():
        _check_id(room, "a room id", "invalid_settings")
        if not isinstance(rule, dict) or set(rule) - {"calendar"}:
            raise InvalidPayloadError("invalid_settings", "a meeting room has, maybe, a `calendar`")
        entry: dict[str, str] = {}
        if rule.get("calendar") is not None:
            calendar = rule["calendar"]
            if (
                not isinstance(calendar, str)
                or not calendar.startswith("calendar.")
                or not valid_entity_id(calendar)
            ):
                raise InvalidPayloadError(
                    "invalid_settings", "a meeting room's `calendar` must be a calendar entity"
                )
            entry["calendar"] = calendar
        checked[room] = entry
    return checked


def _roof(roof: Any) -> dict[str, Any]:
    """How the roofs are drawn (D-077).

    `{"shape"?: "gable" | "hip" | "shed" | "flat", "pitch"?: degrees from 5 to 60, "color"?:
    "#rrggbb"}`; what is left out is drawn as by default.
    """
    if not isinstance(roof, dict) or set(roof) - {"shape", "pitch", "color"}:
        raise InvalidPayloadError("invalid_settings", "`roof` has `shape`, `pitch` and `color`")
    checked: dict[str, Any] = {}
    if "shape" in roof:
        if roof["shape"] not in ROOF_SHAPES:
            raise InvalidPayloadError(
                "invalid_settings", f"`roof.shape` is one of {', '.join(ROOF_SHAPES)}"
            )
        checked["shape"] = roof["shape"]
    if "pitch" in roof:
        pitch = roof["pitch"]
        if not _is_number(pitch) or not ROOF_PITCH[0] <= pitch <= ROOF_PITCH[1]:
            raise InvalidPayloadError(
                "invalid_settings",
                f"`roof.pitch` is a number of degrees from {ROOF_PITCH[0]} to {ROOF_PITCH[1]}",
            )
        checked["pitch"] = pitch
    if "color" in roof:
        color = roof["color"]
        if not isinstance(color, str) or not ACCENT.fullmatch(color):
            raise InvalidPayloadError("invalid_settings", "`roof.color` must be a colour #rrggbb")
        checked["color"] = color.lower()
    return checked


def _access_points(points: Any) -> list[dict[str, Any]]:
    """The Wi-Fi access points placed on the plan (D-066): `[{"storey", "at": [x, y], "name"}]`.

    `storey` is a storey's id, `at` a point of its plan (cm), `name` text of at most 60
    characters (empty: none).
    """
    if not isinstance(points, list):
        raise InvalidPayloadError("invalid_settings", "`access_points` must be a list")
    if len(points) > MAX_ACCESS_POINTS:
        raise InvalidPayloadError("invalid_settings", f"at most {MAX_ACCESS_POINTS} access points")
    checked: list[dict[str, Any]] = []
    for point in points:
        if not isinstance(point, dict) or set(point) - {"storey", "at", "name"}:
            raise InvalidPayloadError(
                "invalid_settings", "an access point has `storey`, `at` and, maybe, `name`"
            )
        _check_id(point.get("storey"), "an access point's storey", "invalid_settings")
        at = point.get("at")
        if (
            not isinstance(at, list)
            or len(at) != 2
            or not all(_is_number(v) and abs(v) <= MAX_PLAN_REACH for v in at)
        ):
            raise InvalidPayloadError(
                "invalid_settings", "an access point's `at` must be a point [x, y] of the plan"
            )
        name = point.get("name", "")
        if not isinstance(name, str) or len(name) > MAX_ACCESS_POINT_NAME:
            raise InvalidPayloadError(
                "invalid_settings",
                f"an access point's name is text of at most {MAX_ACCESS_POINT_NAME} characters",
            )
        entry: dict[str, Any] = {"storey": point["storey"], "at": [float(v) for v in at]}
        if name.strip():
            entry["name"] = name.strip()
        checked.append(entry)
    return checked


# The sensors the energy view reads (D-049), and the signs a sensor may count the other way.
ENERGY_SENSORS = ("solar", "grid", "battery", "battery_level")
ENERGY_REVERSED = ("grid_reversed", "battery_reversed")


def _energy(energy: Any) -> dict[str, Any]:
    """Where the home's energy is read (D-049).

    `solar`, `grid` and `battery`: sensors of the power from the sun, from the grid (positive:
    drawn from it) and from the home battery (positive: drawn from it); `battery_level`, its
    charge; `grid_reversed` and `battery_reversed` when a sensor counts the other way, kept only
    with their sensor. A sensor left out (or `null`) is not shown.
    """
    if not isinstance(energy, dict) or set(energy) - {*ENERGY_SENSORS, *ENERGY_REVERSED}:
        raise InvalidPayloadError(
            "invalid_settings",
            "`energy` holds `solar`, `grid`, `battery`, `battery_level`, `grid_reversed` and "
            "`battery_reversed`",
        )
    checked: dict[str, Any] = {}
    for key in ENERGY_SENSORS:
        sensor = energy.get(key)
        if sensor is None:
            continue
        if (
            not isinstance(sensor, str)
            or not sensor.startswith("sensor.")
            or not valid_entity_id(sensor)
        ):
            raise InvalidPayloadError("invalid_settings", f"`energy.{key}` must be a sensor")
        checked[key] = sensor
    for key in ENERGY_REVERSED:
        if key not in energy:
            continue
        if not isinstance(energy[key], bool):
            raise InvalidPayloadError("invalid_settings", f"`energy.{key}` must be true or false")
        if energy[key] and key.removesuffix("_reversed") in checked:
            checked[key] = True
    return checked


def _private_rooms(rooms: Any) -> dict[str, Any]:
    """The private rooms (D-039): `{room id: {"people": [person ids], "while"?: entity id}}`."""
    if not isinstance(rooms, dict):
        raise InvalidPayloadError("invalid_settings", "`rooms` must be an object of room ids")
    if len(rooms) > MAX_PRIVATE_ROOMS:
        raise InvalidPayloadError("invalid_settings", f"at most {MAX_PRIVATE_ROOMS} private rooms")
    checked: dict[str, Any] = {}
    for room, rule in rooms.items():
        _check_id(room, "a room id", "invalid_settings")
        if not isinstance(rule, dict) or set(rule) - {"people", "while"}:
            raise InvalidPayloadError(
                "invalid_settings", "a private room has `people` and, maybe, `while`"
            )
        people = rule.get("people", [])
        if not isinstance(people, list) or not all(
            isinstance(p, str) and p.startswith("person.") and valid_entity_id(p) for p in people
        ):
            raise InvalidPayloadError(
                "invalid_settings", "a private room's `people` must be a list of `person` entities"
            )
        if len(people) > MAX_PEOPLE:
            raise InvalidPayloadError(
                "invalid_settings", f"a private room is kept for at most {MAX_PEOPLE} people"
            )
        entry: dict[str, Any] = {"people": list(dict.fromkeys(people))}
        if rule.get("while") is not None:
            if not isinstance(rule["while"], str) or not valid_entity_id(rule["while"]):
                raise InvalidPayloadError("invalid_settings", "`while` must be an entity id")
            entry["while"] = rule["while"]
        checked[room] = entry
    return checked


def validate_storey_name(name: Any) -> str:
    """A storey's name: text of at most 60 characters (empty: named by its place)."""
    if not isinstance(name, str) or len(name) > MAX_STOREY_NAME:
        raise InvalidPayloadError(
            "invalid_storey", f"a storey's name is text of at most {MAX_STOREY_NAME} characters"
        )
    return name.strip()


def validate_elevation(elevation: Any) -> float:
    """A storey's elevation (cm above the ground floor's)."""
    if not _is_number(elevation) or not MIN_ELEVATION <= elevation <= MAX_ELEVATION:
        raise InvalidPayloadError(
            "invalid_storey", f"an elevation is {MIN_ELEVATION} to {MAX_ELEVATION} cm"
        )
    return float(elevation)


def validate_storey_count(count: int) -> None:
    """At most 20 storeys."""
    if count > MAX_STOREYS:
        raise InvalidPayloadError("too_many_storeys", f"a home has at most {MAX_STOREYS} storeys")


def element_ids(plan: dict[str, Any] | None, layout: dict[str, Any] | None = None) -> set[str]:
    """The ids a storey uses: its plan's elements and the pieces its overlay adds."""
    ids = {
        element["id"]
        for found in (_plan_lists(plan) if isinstance(plan, dict) else [])
        for element in found
        if isinstance(element, dict) and isinstance(element.get("id"), str)
    }
    if isinstance(layout, dict):
        ids |= {key for key, entry in layout.items() if isinstance(entry, dict) and "add" in entry}
    return ids


type StoreyContent = tuple[dict[str, Any] | None, dict[str, Any] | None]


def validate_unique_ids(storey: StoreyContent, others: list[StoreyContent]) -> None:
    """Element ids are unique in the whole home: links and room areas are keyed by them.

    `storey` and each of `others` are a plan and its overlay.
    """
    taken: set[str] = set()
    for other in others:
        taken |= element_ids(*other)
    _check_shared(element_ids(*storey) & taken)


def _check_shared(shared: set[str]) -> None:
    if shared:
        named = ", ".join(sorted(shared)[:5])
        raise InvalidPayloadError("duplicate_id", f"ids already used on another storey: {named}")


def validate_storeys_ids(plans: list[dict[str, Any]]) -> None:
    """No element id is on two of `plans` (storeys replacing the home's)."""
    taken: set[str] = set()
    for plan in plans:
        ids = element_ids(plan)
        _check_shared(ids & taken)
        taken |= ids


# What an upkeep card holds besides its dates and tasks: texts, at most so long.
UPKEEP_TEXTS: Final = {
    "make": MAX_UPKEEP_TEXT,
    "model": MAX_UPKEEP_TEXT,
    "serial": MAX_UPKEEP_TEXT,
    "manual": MAX_UPKEEP_LINK,
    "notes": MAX_UPKEEP_NOTES,
}
UPKEEP_DATES: Final = ("installed", "warranty_end")
# How many years a piece should last (an IFC file's service life), at most.
MAX_SERVICE_LIFE: Final = 200
# A manual is a page of Home Assistant (`/local/…`) or a web address, never fetched by DomoTwin.
MANUAL_LINK = re.compile(r"(/|https?://)\S*", re.IGNORECASE)


def _upkeep_error(message: str) -> InvalidPayloadError:
    return InvalidPayloadError("invalid_upkeep", message)


def _validate_task(task: Any, ids: set[str]) -> dict[str, Any]:
    if not isinstance(task, dict) or set(task) - {"id", "name", "every", "unit", "last_done"}:
        raise _upkeep_error("a task holds `id`, `name`, `every`, `unit` and `last_done`")
    _check_id(task.get("id"), "a task's `id`", "invalid_upkeep")
    if task["id"] in ids:
        raise _upkeep_error(f"two tasks of a card have the id {task['id']!r}")
    ids.add(task["id"])
    name = task.get("name")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= MAX_UPKEEP_TEXT:
        raise _upkeep_error(f"a task's `name` is text of 1 to {MAX_UPKEEP_TEXT} characters")
    unit = task.get("unit")
    every = task.get("every")
    longest = {"days": MAX_UPKEEP_DAYS, "months": MAX_UPKEEP_MONTHS}.get(str(unit))
    if longest is None or isinstance(every, bool) or not isinstance(every, int):
        raise _upkeep_error("a task is done `every` so many `days` or `months`")
    if not 1 <= every <= longest:
        raise _upkeep_error(f"a task is done every 1 to {longest} {unit}")
    checked: dict[str, Any] = {"id": task["id"], "name": name.strip(), "every": every, "unit": unit}
    if task.get("last_done") is not None:
        if parse_date(task["last_done"]) is None:
            raise _upkeep_error("a task's `last_done` is a date YYYY-MM-DD")
        checked["last_done"] = task["last_done"]
    return checked


def validate_upkeep_card(card: Any) -> dict[str, Any]:
    """Check a piece's upkeep card: its texts, dates and tasks (docs/upkeep.md)."""
    if not isinstance(card, dict) or set(card) - {
        *UPKEEP_TEXTS,
        *UPKEEP_DATES,
        "service_life",
        "tasks",
    }:
        raise _upkeep_error(
            "a card holds `make`, `model`, `serial`, `installed`, `warranty_end`, "
            "`service_life`, `manual`, `notes` and `tasks`"
        )
    checked: dict[str, Any] = {}
    for key, longest in UPKEEP_TEXTS.items():
        value = card.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or len(value) > longest:
            raise _upkeep_error(f"`{key}` is text of at most {longest} characters")
        # Blank: not said. Notes keep their own spaces and lines.
        if value.strip():
            checked[key] = value if key == "notes" else value.strip()
    if "manual" in checked and not MANUAL_LINK.fullmatch(checked["manual"]):
        raise _upkeep_error("`manual` is a path of Home Assistant (/local/…) or a web address")
    for key in UPKEEP_DATES:
        if card.get(key) is not None:
            if parse_date(card[key]) is None:
                raise _upkeep_error(f"`{key}` is a date YYYY-MM-DD")
            checked[key] = card[key]
    life = card.get("service_life")
    if life is not None:
        if isinstance(life, bool) or not isinstance(life, int) or not 1 <= life <= MAX_SERVICE_LIFE:
            raise _upkeep_error(f"`service_life` is a number of years from 1 to {MAX_SERVICE_LIFE}")
        checked["service_life"] = life
    tasks = card.get("tasks", [])
    if not isinstance(tasks, list) or len(tasks) > MAX_UPKEEP_TASKS:
        raise _upkeep_error(f"a card has at most {MAX_UPKEEP_TASKS} tasks")
    ids: set[str] = set()
    checked["tasks"] = [_validate_task(task, ids) for task in tasks]
    return checked


def validate_upkeep_change(
    pieces: Any, lead_days: Any = None, current: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Check a change of the upkeep cards: `{piece id: card, or None to remove it}`.

    With the `current` cards, the cards once changed must fit in the size allowed too.
    """
    if not isinstance(pieces, dict) or len(pieces) > MAX_BOUND_ELEMENTS:
        raise _upkeep_error(f"at most {MAX_BOUND_ELEMENTS} cards are changed at once")
    _check_size(pieces, MAX_UPKEEP_BYTES, "the upkeep cards")
    checked: dict[str, Any] = {}
    for piece, card in pieces.items():
        _check_id(piece, "a piece's id", "invalid_upkeep")
        checked[piece] = None if card is None else validate_upkeep_card(card)
    if lead_days is not None and (
        isinstance(lead_days, bool)
        or not isinstance(lead_days, int)
        or not 0 <= lead_days <= MAX_LEAD_DAYS
    ):
        raise _upkeep_error(f"`lead_days` is a number of days from 0 to {MAX_LEAD_DAYS}")
    if current is not None:
        merged = {key: card for key, card in {**current, **checked}.items() if card}
        _check_size(merged, MAX_UPKEEP_BYTES, "the upkeep cards")
    return checked


def validate_people(people: Any, shown: Any = None, look: Any = None) -> dict[str, Any]:
    """Check who is placed from what (D-034), and `shown` and `look` when given.

    `{person entity id: {"sources": [entity ids], "color"?: "#rrggbb"}}`, at most 50 people of 10
    sources each.
    """
    if not isinstance(people, dict) or len(people) > MAX_PEOPLE:
        raise InvalidPayloadError("invalid_people", f"at most {MAX_PEOPLE} people")
    checked: dict[str, Any] = {}
    for person, settings in people.items():
        if not isinstance(person, str) or not person.startswith("person."):
            raise InvalidPayloadError("invalid_people", f"`{person}` is not a person")
        if not valid_entity_id(person):
            raise InvalidPayloadError("invalid_people", f"`{person}` is not a person")
        if not isinstance(settings, dict) or set(settings) - {"sources", "color"}:
            raise InvalidPayloadError("invalid_people", "a person has `sources` and a `color`")
        sources = settings.get("sources", [])
        if (
            not isinstance(sources, list)
            or len(sources) > MAX_PERSON_SOURCES
            or not all(isinstance(e, str) and valid_entity_id(e) for e in sources)
        ):
            raise InvalidPayloadError(
                "invalid_people", f"a person has at most {MAX_PERSON_SOURCES} entities as sources"
            )
        entry: dict[str, Any] = {"sources": list(dict.fromkeys(sources))}
        if "color" in settings and settings["color"] is not None:
            if not valid_color(settings["color"]):
                raise InvalidPayloadError("invalid_people", "`color` must be a colour #rrggbb")
            entry["color"] = settings["color"].lower()
        checked[person] = entry
    if shown is not None and shown not in PEOPLE_SHOWN:
        raise InvalidPayloadError("invalid_people", f"`shown` must be one of {PEOPLE_SHOWN}")
    if look is not None and look not in PEOPLE_LOOKS:
        raise InvalidPayloadError("invalid_people", f"`look` must be one of {PEOPLE_LOOKS}")
    return checked


def _locating_error(message: str) -> InvalidPayloadError:
    return InvalidPayloadError("invalid_locating", message)


def _validate_match(match: Any) -> dict[str, Any]:
    """How a followed device is known: exactly one of `address`, `key` and `beacon`."""
    if not isinstance(match, dict) or len(match) != 1:
        raise _locating_error("a device is known by one of `address`, `key` and `beacon`")
    if "address" in match:
        if not isinstance(match["address"], str) or not MAC.fullmatch(match["address"].upper()):
            raise _locating_error("`address` must be a Bluetooth address")
        return {"address": match["address"].upper()}
    if "key" in match:
        if not isinstance(match["key"], str) or not 0 < len(match["key"]) <= 64:
            raise _locating_error("`key` must be a Private BLE Device entry id")
        return {"key": match["key"]}
    beacon = match.get("beacon")
    if (
        not isinstance(beacon, dict)
        or set(beacon) != {"uuid", "major", "minor"}
        or not isinstance(beacon["uuid"], str)
        or not BEACON_UUID.fullmatch(beacon["uuid"].lower())
        or not all(
            isinstance(beacon[k], int)
            and not isinstance(beacon[k], bool)
            and 0 <= beacon[k] < 65536
            for k in ("major", "minor")
        )
    ):
        raise _locating_error("`beacon` must be an iBeacon's uuid, major and minor")
    return {"beacon": {**beacon, "uuid": beacon["uuid"].lower()}}


def _validate_receivers(receivers: Any) -> dict[str, Any]:
    if not isinstance(receivers, dict) or len(receivers) > MAX_RECEIVERS:
        raise _locating_error(f"at most {MAX_RECEIVERS} receivers")
    placed: dict[str, Any] = {}
    for source, place in receivers.items():
        if not isinstance(source, str) or not MAC.fullmatch(source.upper()):
            raise _locating_error("a receiver is known by its Bluetooth address")
        if not isinstance(place, dict) or set(place) - {"room", "piece"}:
            raise _locating_error("a receiver is placed by a `room` or a `piece`")
        for key, value in place.items():
            _check_id(value, f"a receiver's {key}", "invalid_locating")
        placed[source.upper()] = dict(place)
    return placed


def validate_radars(radars: Any) -> dict[str, Any]:
    """Check the presence radars' own settings (D-080): `{piece: {"mirror"?: bool}}`.

    Each radar said of is mirrored or not (not said: not).
    """
    if not isinstance(radars, dict) or len(radars) > MAX_RADARS:
        raise _locating_error(f"at most {MAX_RADARS} radars")
    found: dict[str, Any] = {}
    for piece, settings in radars.items():
        _check_id(piece, "a radar's piece", "invalid_locating")
        if not isinstance(settings, dict) or set(settings) - {"mirror"}:
            raise _locating_error("a radar is `mirror`ed or not")
        if "mirror" in settings and not isinstance(settings["mirror"], bool):
            raise _locating_error("`mirror` must be true or false")
        found[piece] = {"mirror": settings.get("mirror") is True}
    return found


def _validate_located(device: Any, settings: Any) -> dict[str, Any]:
    if not isinstance(device, str) or not LOCATED_ID.fullmatch(device):
        raise _locating_error("a device's id is 1 to 40 lowercase letters, digits or _")
    if not isinstance(settings, dict) or set(settings) - {
        "name",
        "kind",
        "person",
        "match",
        "bermuda",
    }:
        raise _locating_error(
            "a device has a `name`, a `kind`, a `person`, a `match` and a `bermuda` sensor"
        )
    name = settings.get("name")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= MAX_LOCATED_NAME:
        raise _locating_error(f"a device's name is 1 to {MAX_LOCATED_NAME} characters")
    if settings.get("kind") not in LOCATED_KINDS:
        raise _locating_error(f"`kind` must be one of {LOCATED_KINDS}")
    person = settings.get("person")
    if person is not None and (
        not isinstance(person, str)
        or not person.startswith("person.")
        or not valid_entity_id(person)
    ):
        raise _locating_error("`person` must be a person")
    entry: dict[str, Any] = {
        "name": name.strip(),
        "kind": settings["kind"],
        "match": _validate_match(settings.get("match")),
    }
    if person is not None:
        entry["person"] = person
    # Bermuda's area sensor of the same device, measured beside DomoTwin's room (M41).
    bermuda = settings.get("bermuda")
    if bermuda is not None:
        if (
            not isinstance(bermuda, str)
            or not bermuda.startswith("sensor.")
            or not (valid_entity_id(bermuda))
        ):
            raise _locating_error("`bermuda` must be a sensor")
        entry["bermuda"] = bermuda
    return entry


def validate_locating(
    receivers: Any, devices: Any, learn: Any = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Check where the receivers are and which devices are followed (D-035).

    `receivers`: `{address: {"room"?: id, "piece"?: id}}`; `devices`: `{id: {"name", "kind",
    "person"?, "match", "bermuda"?}}`, at most 30. Return both, cleaned.
    """
    placed = _validate_receivers(receivers)
    if not isinstance(devices, dict) or len(devices) > MAX_LOCATED:
        raise _locating_error(f"at most {MAX_LOCATED} devices")
    followed = {device: _validate_located(device, settings) for device, settings in devices.items()}
    known = [json.dumps(e["match"], sort_keys=True) for e in followed.values()]
    if len(set(known)) != len(known):
        raise _locating_error("two devices are known the same way")
    paired = [e["bermuda"] for e in followed.values() if "bermuda" in e]
    if len(set(paired)) != len(paired):
        raise _locating_error("a Bermuda sensor is paired with one device at most")
    if learn is not None and not isinstance(learn, bool):
        raise _locating_error("`learn` must be true or false")
    return placed, followed
