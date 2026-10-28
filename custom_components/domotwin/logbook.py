"""What the logbook says of a guest's action (`docs/DECISIONS.md`, D-067).

Each action done through a guest pass is fired as an event, in the context the action then runs
in, so that Home Assistant's logbook and "Why?" (D-059) say which pass changed a device.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.components.logbook import (
    LOGBOOK_ENTRY_CONTEXT_ID,
    LOGBOOK_ENTRY_ENTITY_ID,
    LOGBOOK_ENTRY_MESSAGE,
    LOGBOOK_ENTRY_NAME,
    LazyEventPartialState,
)
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, EVENT_GUEST_ACTION


@callback
def async_describe_events(
    hass: HomeAssistant,
    async_describe_event: Callable[
        [str, str, Callable[[LazyEventPartialState], dict[str, Any]]], None
    ],
) -> None:
    """Describe a guest's actions."""

    @callback
    def describe(event: LazyEventPartialState) -> dict[str, Any]:
        data = event.data
        entities = data.get("entity_id")
        first = entities[0] if isinstance(entities, list) and entities else entities
        return {
            LOGBOOK_ENTRY_NAME: data.get("name"),
            # Told before the action is done: what was asked, which Home Assistant may refuse.
            LOGBOOK_ENTRY_MESSAGE: f"asked {data.get('service')} through a guest pass",
            LOGBOOK_ENTRY_ENTITY_ID: first if isinstance(first, str) else None,
            LOGBOOK_ENTRY_CONTEXT_ID: event.context_id,
        }

    async_describe_event(DOMAIN, EVENT_GUEST_ACTION, describe)
