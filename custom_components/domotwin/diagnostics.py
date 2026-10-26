"""Diagnostics: counts only, never names, entity ids or geometry (privacy)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from . import DomoTwinConfigEntry
from .const import MODEL_ENTRY_PREFIX, PLAN_LISTS, VERSION
from .data import LOCATOR_KEY, PEOPLE_KEY, SCHEDULER_KEY
from .models import async_usage
from .upkeep import due_tasks, piece_names

# Addresses of the radio mesh (an IEEE address, a network address) and the Home Assistant device a
# piece stands for (the network map, D-031): never in diagnostics, whatever part of them holds one.
TO_REDACT = {"ieee", "nwk", "device", "device_reg_id"}


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
    elements = bindings.get("elements", {})
    cards = data.upkeep.get("pieces", {})
    diagnostics: dict[str, Any] = {
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
            "elements": len(elements),
            "devices": sum(1 for b in elements.values() if isinstance(b, dict) and "device" in b),
        },
        # Which settings are set, not their values (north tells how the home faces).
        "settings": sorted(data.settings),
        # The upkeep cards counted (D-033): never their makes, serial numbers, links or notes.
        "upkeep": {
            "cards": len(cards),
            "tasks": sum(len(card.get("tasks", [])) for card in cards.values()),
            "due": len(due_tasks(data.upkeep, piece_names(data.storeys), dt_util.now().date())),
            "lead_days": data.upkeep.get("lead_days"),
        },
    }
    # The people counted (D-034): never who they are, their sources or where they are.
    if (people := hass.data.get(PEOPLE_KEY)) is not None:
        placed = people.config["people"]
        diagnostics["people"] = {
            "placed": len(placed),
            "sources": sum(len(people.sources(person)) for person in placed),
            "located": sum(1 for place in people.places.values() if place.room is not None),
            "rooms": len(people.finder.rooms),
            "shown": people.config["shown"],
            "look": people.config["look"],
            "hidden": len(people.config["hidden"]),
        }
    # The Bluetooth locating counted (D-035): never addresses, keys, names or rooms.
    if (locator := hass.data.get(LOCATOR_KEY)) is not None:
        devices = locator.settings["devices"].values()
        diagnostics["locating"] = {
            "status": locator.status(),
            "receivers": len(locator.receivers_now()),
            "placed_receivers": sum(1 for place in locator.places.values() if place is not None),
            "devices": {
                kind: sum(1 for d in devices if d["kind"] == kind)
                for kind in ("phone", "watch", "thing")
            },
            "known_by": {
                how: sum(1 for d in devices if how in d["match"])
                for how in ("address", "key", "beacon")
            },
            "missing_keys": len(locator.missing_keys),
            "located": sum(1 for found in locator.located.values() if found.room is not None),
            "rooms_learned": len(locator.learned_rooms()),
            "learn": locator.settings.get("learn", True),
        }
    # The actions done later counted (D-045): never which devices or when.
    if (scheduler := hass.data.get(SCHEDULER_KEY)) is not None:
        waiting = scheduler.items()
        diagnostics["schedules"] = {
            "waiting": len(waiting),
            "started": sum(1 for item in waiting if item.started),
        }
    redacted: dict[str, Any] = async_redact_data(diagnostics, TO_REDACT)
    return redacted
