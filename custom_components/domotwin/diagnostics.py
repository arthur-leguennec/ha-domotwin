"""Diagnostics: counts only, never names, entity ids or geometry (privacy)."""

from __future__ import annotations

from collections import Counter
from typing import Any

from homeassistant.core import HomeAssistant

from . import DomoTwinConfigEntry
from .const import VERSION


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: DomoTwinConfigEntry
) -> dict[str, Any]:
    """Return what helps to debug without exposing the home."""
    data = entry.runtime_data
    plan = data.plan
    plan_info: dict[str, Any] | None = None
    if plan is not None:
        elements = plan.get("elements", [])
        plan_info = {
            "layout_revision": plan.get("layoutRevision"),
            "elements": dict(
                Counter(
                    str(element.get("type")) for element in elements if isinstance(element, dict)
                )
            ),
            "has_site": plan.get("site") is not None,
            "models": len(plan.get("models") or {}),
        }
    bindings = data.bindings
    return {
        "version": VERSION,
        "options": dict(entry.options),
        "revision": data.revision,
        "plan": plan_info,
        "layout_entries": len(data.layout),
        "bindings": {
            "rooms": len(bindings.get("rooms", {})),
            "elements": len(bindings.get("elements", {})),
        },
    }
