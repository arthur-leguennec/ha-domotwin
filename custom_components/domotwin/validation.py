"""Envelope checks of what clients send. The full lenient plan reader lives in domotwin-core."""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import valid_entity_id
from homeassistant.helpers.json import json_bytes

from .const import (
    MAX_BINDINGS_BYTES,
    MAX_BOUND_ELEMENTS,
    MAX_ELEMENTS,
    MAX_ENTITIES_PER_ELEMENT,
    MAX_ID_LENGTH,
    MAX_LAYOUT_BYTES,
    MAX_MODEL_BYTES,
    MAX_MODELS,
    MAX_MODELS_BYTES,
    MAX_PLAN_BYTES,
    MODEL_ENTRY_PREFIX,
    MODEL_FORMATS,
)

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
    """The declared size of a model's file (0 for a kit)."""
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
    if ("kit" in model) == ("file" in model):
        raise InvalidPayloadError(code, "a model has a `kit` or a `file`, not both")
    file = model.get("file")
    if file is None:
        if not isinstance(model.get("kit"), dict):
            raise InvalidPayloadError(code, "a model's `kit` must be an object")
        return
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


def validate_plan(plan: Any) -> dict[str, Any]:
    """Check the envelope of a House Maquette plan (see docs/plan-format.md)."""
    if not isinstance(plan, dict):
        raise InvalidPayloadError("invalid_plan", "the plan must be a JSON object")
    version = plan.get("version")
    if not _is_number(version) or version != 1:
        raise InvalidPayloadError("invalid_plan", "`version` must be 1")
    if plan.get("unit") != "cm":
        raise InvalidPayloadError("invalid_plan", '`unit` must be "cm"')
    elements = plan.get("elements")
    if not isinstance(elements, list) or not 0 < len(elements) <= MAX_ELEMENTS:
        raise InvalidPayloadError(
            "invalid_plan", f"`elements` must hold 1 to {MAX_ELEMENTS} elements"
        )
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
    entities = binding.get("entities")
    if not isinstance(entities, list) or not 0 < len(entities) <= MAX_ENTITIES_PER_ELEMENT:
        raise InvalidPayloadError(
            "invalid_bindings",
            f"`entities` must hold 1 to {MAX_ENTITIES_PER_ELEMENT} entities",
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


def validate_settings(settings: Any) -> dict[str, Any]:
    """Check the home's settings: `north`, degrees clockwise from the top of the plan."""
    if not isinstance(settings, dict) or set(settings) - {"north"}:
        raise InvalidPayloadError("invalid_settings", "settings hold only `north`")
    north = settings.get("north", 0)
    if not _is_number(north) or not 0 <= north < 360:
        raise InvalidPayloadError("invalid_settings", "`north` must be a number from 0 to 360")
    return {"north": north}
