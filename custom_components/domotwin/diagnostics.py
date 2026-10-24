"""Diagnostics: counts only, never names, entity ids or geometry (privacy)."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from . import DomoTwinConfigEntry
from .const import MODEL_ENTRY_PREFIX, PLAN_LISTS, VERSION
from .models import async_usage


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: DomoTwinConfigEntry
) -> dict[str, Any]:
    """Return what helps to debug without exposing the home."""
    data = entry.runtime_data
    # The ground floor's plan (the others are counted).
    plan = data.plan
    plan_info: dict[str, Any] | None = None
    if plan is not None:
        plan_info = {
            "version": plan.get("version"),
            "elements": {
                key: len(plan[key]) for key in PLAN_LISTS if isinstance(plan.get(key), list)
            },
            "views": len(plan["views"]) if isinstance(plan.get("views"), list) else 0,
            "models": len(plan["models"]) if isinstance(plan.get("models"), dict) else 0,
        }
    bindings = data.bindings
    return {
        "version": VERSION,
        "options": dict(entry.options),
        "revision": data.revision,
        "storeys": len(data.storeys),
        "retired_storeys": len(data.retired),
        "plan": plan_info,
        "layout_entries": len(data.layout),
        "layout_models": sum(1 for key in data.layout if key.startswith(MODEL_ENTRY_PREFIX)),
        "model_files": await async_usage(hass),
        "bindings": {
            "rooms": len(bindings.get("rooms", {})),
            "elements": len(bindings.get("elements", {})),
        },
        # Which settings are set, not their values (north tells how the home faces).
        "settings": sorted(data.settings),
    }
