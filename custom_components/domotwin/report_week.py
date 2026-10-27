"""The week's energy and Hydro-Québec's peaks, for the weekly report (`docs/DECISIONS.md`, D-066).

- **Energy**: what Home Assistant's energy settings count, read from the recorder's hourly
  statistics (their change, in kWh), for the week and the week before: what the home used (from
  the grid, the sun and the battery, less what went back), what it drew from the grid, what the sun
  gave; and each room's, from the individual devices of the energy settings in the room, or, where
  the settings name none, from the energy meters of each room's area (the home's own and Utility
  Meter's copies left out).
- **Peaks** (D-063): the peaks the integrations that read them said were under way this week (their
  on/off sensors' history), and those hydroqc wrote in a calendar (Home Assistant's own Local
  Calendar, or one whose event it bears now); what the home drew from the grid during each, and
  each room.

Nothing is fetched from anywhere: the recorder, the calendars kept in Home Assistant.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
import re
from typing import Any, Final

from homeassistant.const import ATTR_DEVICE_CLASS, ATTR_UNIT_OF_MEASUREMENT
from homeassistant.core import HomeAssistant, State, valid_entity_id
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .report_look import Places

_LOGGER = logging.getLogger(__name__)

#: The units an energy meter counts in, as the recorder converts them.
ENERGY_UNITS: Final = frozenset(
    {"Wh", "kWh", "MWh", "GWh", "TWh", "mWh", "MJ", "GJ", "cal", "kcal", "Mcal", "Gcal"}
)
#: What the integrations' on/off sensors that say a peak is under way are (`platform`,
#: `translation_key`), as the sandbox plays them (D-063).
PEAK_SENSORS: Final = frozenset(
    {
        ("hydroqc", "dpc_peak_in_progress"),
        ("hydroqc", "wc_critical_peak_in_progress"),
        ("hydropeak", "peak_active"),
    }
)
#: Every kind of entity of the integrations, to say whether one reads the peaks here.
PEAK_PLATFORMS: Final = frozenset({"hydroqc", "hydropeak"})
#: hydroqc's mark in the description of the peaks it writes in a calendar.
HYDROQC_MARK: Final = "ID: hydroqc_"
#: A peak hydroqc says is not critical (`Critique: Non`), as the frontend reads it.
CRITICAL_NO: Final = re.compile(r"Critique:\s*Non", re.IGNORECASE)
#: Peaks said at most for a week (two a day).
MAX_PEAKS: Final = 14
#: A room's energy, or the home's, written with this many decimals (kWh).
DECIMALS: Final = 2


@dataclass
class Meters:
    """The statistics the week's energy is read from."""

    grid_in: list[str] = field(default_factory=list)
    grid_out: list[str] = field(default_factory=list)
    solar: list[str] = field(default_factory=list)
    battery_out: list[str] = field(default_factory=list)
    battery_in: list[str] = field(default_factory=list)
    #: Each room's meters.
    rooms: dict[str, list[str]] = field(default_factory=dict)

    @property
    def home(self) -> list[str]:
        """Every meter of the home's own (the energy settings' sources)."""
        return [*self.grid_in, *self.grid_out, *self.solar, *self.battery_out, *self.battery_in]

    def all(self) -> set[str]:
        """Every statistic read."""
        return {*self.home, *(meter for meters in self.rooms.values() for meter in meters)}


def _stat(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def sources_of(prefs: Mapping[str, Any] | None) -> Meters:
    """The energy settings' sources (`energy/get_prefs`), whatever their shape.

    The grid's import and export as one connection (2026.3 and later) or as lists (`flow_from`,
    `flow_to`, before).
    """
    meters = Meters()
    sources = prefs.get("energy_sources") if isinstance(prefs, Mapping) else None
    # Where each kind of source counts what comes in (`stat_energy_from`) and what goes out.
    kinds: dict[Any, tuple[list[str], list[str]]] = {
        "grid": (meters.grid_in, meters.grid_out),
        "solar": (meters.solar, []),
        "battery": (meters.battery_out, meters.battery_in),
    }
    for source in sources if isinstance(sources, list) else []:
        if not isinstance(source, Mapping) or source.get("type") not in kinds:
            continue
        into, out = kinds[source["type"]]
        flows: list[Any] = [source]
        if source["type"] == "grid":
            flows += [*(source.get("flow_from") or []), *(source.get("flow_to") or [])]
        for flow in flows:
            if not isinstance(flow, Mapping):
                continue
            if stat := _stat(flow.get("stat_energy_from")):
                into.append(stat)
            if stat := _stat(flow.get("stat_energy_to")):
                out.append(stat)
    return meters


def room_meters(
    hass: HomeAssistant, prefs: Mapping[str, Any] | None, places: Places, home: Iterable[str]
) -> dict[str, list[str]]:
    """Each room's energy meters.

    The energy settings' individual devices in it (those counted in another's left out), else,
    where the settings name none, the energy meters of each room's area.
    """
    devices = prefs.get("device_consumption") if isinstance(prefs, Mapping) else None
    listed = [d for d in devices if isinstance(d, Mapping)] if isinstance(devices, list) else []
    rooms: dict[str, list[str]] = {}
    if listed:
        for device in listed:
            stat = _stat(device.get("stat_consumption"))
            if stat is None or device.get("included_in_stat") or not valid_entity_id(stat):
                continue
            if (room := places.of_entity(stat)) is not None:
                rooms.setdefault(room, []).append(stat)
        return rooms
    own = set(home)
    registry = er.async_get(hass)
    for state in hass.states.async_all("sensor"):
        if not _meter(state) or state.entity_id in own:
            continue
        entry = registry.async_get(state.entity_id)
        # Utility Meter's sensors count again what another meter counts.
        if entry is not None and entry.platform == "utility_meter":
            continue
        if (room := places.of_entity(state.entity_id)) is not None:
            rooms.setdefault(room, []).append(state.entity_id)
    return rooms


def _meter(state: State) -> bool:
    """An energy meter whose statistics count up: kWh (or another energy unit), total."""
    return (
        state.attributes.get(ATTR_DEVICE_CLASS) == "energy"
        and state.attributes.get("state_class") in ("total", "total_increasing")
        and state.attributes.get(ATTR_UNIT_OF_MEASUREMENT) in ENERGY_UNITS
    )


async def async_energy_prefs(hass: HomeAssistant) -> Mapping[str, Any] | None:
    """Home Assistant's energy settings, None without them."""
    if "energy" not in hass.config.components:
        return None
    try:
        from homeassistant.components.energy.data import (  # noqa: PLC0415 (energy is optional)
            async_get_manager,
        )

        manager = await async_get_manager(hass)
    except Exception:
        _LOGGER.debug("Home Assistant's energy settings cannot be read", exc_info=True)
        return None
    data: Any = manager.data
    return data if isinstance(data, Mapping) else None


async def async_hourly(
    hass: HomeAssistant, statistics: set[str], start: datetime, end: datetime
) -> dict[str, list[tuple[float, float]]]:
    """Each statistic's hourly change (kWh) from `start` to `end`.

    Each hour as (its start, a timestamp; its change). Nothing without the recorder.
    """
    if not statistics or "recorder" not in hass.config.components:
        return {}
    from homeassistant.components.recorder import get_instance  # noqa: PLC0415
    from homeassistant.components.recorder.statistics import (  # noqa: PLC0415
        statistics_during_period,
    )

    try:
        rows: Mapping[str, list[Any]] = await get_instance(
            hass
        ).async_add_executor_job(
            statistics_during_period,
            hass,
            start,
            end,
            statistics,
            "hour",
            {"energy": "kWh"},
            {"change"},
        )
    except Exception:
        _LOGGER.debug("The energy statistics cannot be read", exc_info=True)
        return {}
    hourly: dict[str, list[tuple[float, float]]] = {}
    for stat, listed in rows.items():
        kept = [
            (float(row["start"]), float(row["change"]))
            for row in listed
            if isinstance(row.get("start"), int | float)
            and isinstance(row.get("change"), int | float)
        ]
        if kept:
            hourly[stat] = kept
    return hourly


def total(
    hourly: Mapping[str, list[tuple[float, float]]],
    stats: Iterable[str],
    start: datetime,
    end: datetime,
) -> float | None:
    """What the statistics counted from `start` to `end` (kWh); None when none has a row then."""
    begin, finish = start.timestamp(), end.timestamp()
    found = False
    counted = 0.0
    for stat in stats:
        for at, change in hourly.get(stat, []):
            if begin <= at < finish:
                counted += change
                found = True
    return counted if found else None


def _kwh(value: float | None) -> float | None:
    return None if value is None else round(value, DECIMALS)


def energy(
    meters: Meters,
    hourly: Mapping[str, list[tuple[float, float]]],
    week: tuple[datetime, datetime],
    before: tuple[datetime, datetime],
) -> dict[str, Any] | None:
    """The week's energy and the week before's: the home's and each room's (kWh)."""

    def pair(stats: Iterable[str]) -> dict[str, float] | None:
        stats = list(stats)
        now, then = total(hourly, stats, *week), total(hourly, stats, *before)
        if now is None and then is None:
            return None
        result: dict[str, float] = {}
        if (kept := _kwh(now)) is not None:
            result["week"] = kept
        if (kept := _kwh(then)) is not None:
            result["before"] = kept
        return result

    def used(span: tuple[datetime, datetime]) -> float | None:
        parts = {
            1: [*meters.grid_in, *meters.solar, *meters.battery_out],
            -1: [*meters.grid_out, *meters.battery_in],
        }
        counted = [(sign, total(hourly, stats, *span)) for sign, stats in parts.items()]
        if all(value is None for _, value in counted):
            return None
        return max(sum(sign * (value or 0.0) for sign, value in counted), 0.0)

    found: dict[str, Any] = {}
    home_now, home_then = used(week), used(before)
    if home_now is not None or home_then is not None:
        found["home"] = {
            key: kept
            for key, value in (("week", home_now), ("before", home_then))
            if (kept := _kwh(value)) is not None
        }
    if meters.grid_in and (grid := pair(meters.grid_in)):
        found["grid"] = grid
    if meters.solar and (solar := pair(meters.solar)):
        found["solar"] = solar
    rooms: dict[str, dict[str, float]] = {}
    for room, stats in meters.rooms.items():
        if (counted := pair(stats)) is not None:
            rooms[room] = counted
    if rooms:
        found["rooms"] = rooms
    return found or None


# The peaks.


def peak_sensors(hass: HomeAssistant) -> list[str]:
    """The integrations' on/off sensors that say a peak is under way."""
    registry = er.async_get(hass)
    return sorted(
        entry.entity_id
        for entry in registry.entities.values()
        if (entry.platform, entry.translation_key) in PEAK_SENSORS and entry.disabled_by is None
    )


def peaks_read(hass: HomeAssistant) -> bool:
    """Whether an integration reads Hydro-Québec's peaks here (D-063)."""
    registry = er.async_get(hass)
    return any(entry.platform in PEAK_PLATFORMS for entry in registry.entities.values())


async def async_peak_windows(
    hass: HomeAssistant, sensors: list[str], start: datetime, end: datetime
) -> list[tuple[datetime, datetime]]:
    """When the sensors said a peak was under way between `start` and `end` (their history)."""
    if not sensors or "recorder" not in hass.config.components:
        return []
    from homeassistant.components.recorder import get_instance  # noqa: PLC0415
    from homeassistant.components.recorder.history import (  # noqa: PLC0415
        get_significant_states,
    )

    try:
        history: Mapping[str, list[Any]] = await get_instance(hass).async_add_executor_job(
            lambda: get_significant_states(
                hass,
                start,
                end,
                sensors,
                None,
                include_start_time_state=True,
                significant_changes_only=False,
                no_attributes=True,
            )
        )
    except Exception:
        _LOGGER.debug("The peaks' history cannot be read", exc_info=True)
        return []
    windows: list[tuple[datetime, datetime]] = []
    for states in history.values():
        on: datetime | None = None
        for state in states:
            if not isinstance(state, State):
                continue
            at = max(state.last_changed, start)
            if state.state == "on" and on is None:
                on = at
            elif state.state != "on" and on is not None:
                if at > on:
                    windows.append((on, at))
                on = None
        if on is not None and end > on:
            windows.append((on, end))
    return windows


async def async_calendar_peaks(
    hass: HomeAssistant, start: datetime, end: datetime
) -> list[tuple[datetime, datetime]]:
    """The peaks hydroqc wrote in a calendar between `start` and `end`.

    In Home Assistant's Local Calendars, and in a calendar whose event bears its mark now. No
    other calendar is asked: a calendar of an online service would be fetched.
    """
    registry = er.async_get(hass)
    calendars = sorted(
        state.entity_id
        for state in hass.states.async_all("calendar")
        if _marked(state.attributes.get("description"))
        or (
            (entry := registry.async_get(state.entity_id)) is not None
            and entry.platform == "local_calendar"
        )
    )
    if not calendars or not hass.services.has_service("calendar", "get_events"):
        return []
    try:
        answer: Any = await hass.services.async_call(
            "calendar",
            "get_events",
            {"start_date_time": start, "end_date_time": end},
            target={"entity_id": calendars},
            blocking=True,
            return_response=True,
        )
    except Exception:
        _LOGGER.debug("The calendars cannot be read", exc_info=True)
        return []
    windows: list[tuple[datetime, datetime]] = []
    for found in (answer or {}).values():
        events = found.get("events") if isinstance(found, Mapping) else None
        for event in events if isinstance(events, list) else []:
            if not isinstance(event, Mapping) or not _marked(event.get("description")):
                continue
            begin = _when(event.get("start"))
            finish = _when(event.get("end"))
            if begin is not None and finish is not None and finish > begin:
                windows.append((begin, finish))
    return windows


def _marked(description: Any) -> bool:
    """A peak hydroqc wrote: its mark, and not said not to be critical."""
    return (
        isinstance(description, str)
        and HYDROQC_MARK in description
        and not CRITICAL_NO.search(description)
    )


def _when(value: Any) -> datetime | None:
    """An event's start or end: a time (with its zone, else Home Assistant's), not a day."""
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str) and "T" in value:
        parsed = dt_util.parse_datetime(value)
        if parsed is None:
            return None
        moment = parsed
    else:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt_util.get_default_time_zone())
    return dt_util.as_utc(moment)


def merge(windows: Iterable[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    """The windows, those that overlap or touch as one, earliest first."""
    merged: list[tuple[datetime, datetime]] = []
    for begin, finish in sorted(windows):
        if merged and begin <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], finish))
        else:
            merged.append((begin, finish))
    return merged


def peaks(
    windows: list[tuple[datetime, datetime]],
    meters: Meters,
    hourly: Mapping[str, list[tuple[float, float]]],
) -> list[dict[str, Any]]:
    """Each peak of the week, with what the home and each room drew during it.

    The home's from the grid; in kWh, over the hours the peak covers.
    """
    found: list[dict[str, Any]] = []
    for begin, finish in merge(windows)[:MAX_PEAKS]:
        peak: dict[str, Any] = {"start": begin.isoformat(), "end": finish.isoformat()}
        if (
            meters.grid_in
            and (grid := _kwh(total(hourly, meters.grid_in, begin, finish))) is not None
        ):
            peak["grid"] = grid
        rooms = {
            room: kwh
            for room, stats in meters.rooms.items()
            if (kwh := _kwh(total(hourly, stats, begin, finish))) is not None
        }
        if rooms:
            peak["rooms"] = rooms
        found.append(peak)
    return found


def week_of(now: datetime) -> tuple[tuple[datetime, datetime], tuple[datetime, datetime]]:
    """The seven days to the last midnight where the home is, and the seven before (UTC)."""
    today = dt_util.as_local(now).date()
    midnight = dt_util.start_of_local_day(today)
    week_start = dt_util.start_of_local_day(today - timedelta(days=7))
    before_start = dt_util.start_of_local_day(today - timedelta(days=14))
    return (
        (dt_util.as_utc(week_start), dt_util.as_utc(midnight)),
        (dt_util.as_utc(before_start), dt_util.as_utc(week_start)),
    )
