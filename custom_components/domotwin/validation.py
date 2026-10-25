"""Envelope checks of what clients send. The full lenient plan reader lives in domotwin-core."""

from __future__ import annotations

import re
from typing import Any, Final

from homeassistant.core import valid_entity_id
from homeassistant.helpers.json import json_bytes

from .const import (
    MAX_BINDINGS_BYTES,
    MAX_BOUND_ELEMENTS,
    MAX_ELEMENTS,
    MAX_ELEVATION,
    MAX_ENTITIES_PER_ELEMENT,
    MAX_ID_LENGTH,
    MAX_LAYOUT_BYTES,
    MAX_LEAD_DAYS,
    MAX_MODEL_BYTES,
    MAX_MODELS,
    MAX_MODELS_BYTES,
    MAX_PLAN_BYTES,
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
    PLAN_FORMAT,
    PLAN_LISTS,
)
from .upkeep import parse_date

MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
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
        if not isinstance(room, dict) or not isinstance(room.get("area", ""), str):
            raise InvalidPayloadError("invalid_bindings", "a room binding needs a string `area`")
    for element_id, binding in elements.items():
        _check_id(element_id, "an element id", "invalid_bindings")
        _validate_element_binding(binding)
    _check_size(bindings, MAX_BINDINGS_BYTES, "the bindings")
    return {"version": 1, "rooms": rooms, "elements": elements}


THEMES: Final = ("auto", "day", "neon", "blueprint")
ACCENT: Final = re.compile(r"#[0-9a-fA-F]{6}")


def validate_settings(settings: Any) -> dict[str, Any]:
    """Check the home's settings.

    `north`, degrees clockwise from the top of the plan; the look shown by default (`theme`) and
    its accent colour (`accent`, `#rrggbb`).
    """
    if not isinstance(settings, dict) or set(settings) - {"north", "theme", "accent"}:
        raise InvalidPayloadError(
            "invalid_settings", "settings hold only `north`, `theme` and `accent`"
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
