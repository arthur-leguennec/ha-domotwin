"""Envelope checks of what clients send. The full lenient plan reader lives in domotwin-core."""

from __future__ import annotations

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
    MAX_PLAN_BYTES,
)

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
