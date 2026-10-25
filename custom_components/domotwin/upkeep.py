"""Upkeep (docs/DECISIONS.md, D-033): when the pieces' recurring tasks are next due.

The same rules as `domotwin_core::upkeep`, which the view uses; both are tested on the cases of
`tests/fixtures/upkeep-due.json`. Dates are calendar days where the home is.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
import re
from typing import Any, Final

# A task due within this many days is due soon, unless the home sets another lead.
LEAD_DAYS: Final = 14
# A calendar day as the engine reads it: `YYYY-MM-DD` and nothing else (no week dates).
DAY: Final = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_date(value: Any) -> date | None:
    """Read `YYYY-MM-DD`, or nothing."""
    if not isinstance(value, str) or not DAY.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def add_months(day: date, months: int) -> date:
    """The same day `months` later, or the month's last day when it is shorter."""
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    if year > date.max.year:
        # Past the end of the calendar: its last day.
        return date.max
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def next_due(task: dict[str, Any], installed: date | None, today: date) -> date:
    """When a task is next due.

    An interval after it was last done, else after the piece was installed; neither known, today.
    """
    since = parse_date(task.get("last_done")) or installed
    if since is None:
        return today
    every = int(task["every"])
    if task["unit"] == "months":
        return add_months(since, every)
    try:
        return since + timedelta(days=every)
    except OverflowError:
        return date.max


def state(due: date, today: date, lead: int) -> str:
    """`overdue` the day after it is due, `due` from `lead` days before, else `fine`."""
    left = (due - today).days
    if left < 0:
        return "overdue"
    return "due" if left <= lead else "fine"


def _name(entry: Any, piece: str) -> str:
    name = entry.get("name") if isinstance(entry, dict) else None
    return name if isinstance(name, str) and name else piece


def piece_names(storeys: list[dict[str, Any]]) -> dict[str, str]:
    """The name of every piece of the stored storeys, by id.

    The pieces of the plans and those edit mode added, less those it removed (the overlay).
    """
    names: dict[str, str] = {}
    for storey in storeys:
        plan = storey.get("plan")
        layout = storey.get("layout")
        layout = layout if isinstance(layout, dict) else {}
        items = plan.get("items") if isinstance(plan, dict) else None
        for item in items if isinstance(items, list) else []:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                names[item["id"]] = _name(item, item["id"])
        for piece, entry in layout.items():
            if not isinstance(entry, dict):
                continue
            if entry.get("removed") is True:
                names.pop(piece, None)
            elif isinstance(entry.get("add"), dict):
                names[piece] = _name(entry["add"], piece)
    return names


def due_tasks(upkeep: dict[str, Any], names: dict[str, str], today: date) -> list[dict[str, Any]]:
    """The tasks due soon or overdue of the pieces in `names`, the soonest first.

    Each with `piece` (its id), `piece_name`, `task` (its name), `due` (`YYYY-MM-DD`), `state`.
    The cards of pieces no plan has any more are left out: nothing shows them.
    """
    lead = upkeep.get("lead_days", LEAD_DAYS)
    out: list[dict[str, Any]] = []
    for piece, card in upkeep.get("pieces", {}).items():
        if piece not in names:
            continue
        installed = parse_date(card.get("installed"))
        for task in card.get("tasks", []):
            due = next_due(task, installed, today)
            now = state(due, today, lead)
            if now != "fine":
                out.append(
                    {
                        "piece": piece,
                        "piece_name": names[piece],
                        "task": task["name"],
                        "due": due.isoformat(),
                        "state": now,
                    }
                )
    out.sort(key=lambda task: (task["due"], task["piece_name"], task["task"]))
    return out
