"""The weekly home report (`docs/DECISIONS.md`, D-066).

Once a week, on the day and at the hour an administrator chose (Monday at 8 by default), DomoTwin
writes what needs a look in the home (`look.py`), the week's energy against the week before and
the week's Hydro-Québec peaks (`week.py`), room by room where it can tell the room (`places.py`),
says what is new since the last report and what was done, and keeps it with the reports of the
weeks before in a store of its own (.storage/domotwin.reports, private). Home Assistant's
notification says it in its language (`words.py`), with a summary by the AI task an administrator
chose, if one was; an event lets one's own automations send it on. The page in the panel shows it,
for administrators: the report holds what only they may read (the automations' traces, the radios).

A week missed (Home Assistant stopped at the hour) is written once it runs again, within the week.
Never in the diagnostics but for the settings; deleted with the integration.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from datetime import datetime, time, timedelta
import logging
from typing import Any, Final

from homeassistant.components import persistent_notification, websocket_api
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .compat import vol
from .const import (
    MAX_REPORT_ITEMS,
    MAX_REPORTS,
    MAX_SUMMARY,
    PANEL_URL_PATH,
    REPORT_EVENT,
    REPORT_NOTIFICATION,
    REPORT_SECTIONS,
    REPORT_STORAGE_KEY,
    REPORT_STORAGE_VERSION,
    SIGNAL_UPDATED,
)
from .overview import piece_rooms
from .report_look import Look, Places, async_failed_runs
from .report_radios import weak_radios, zha_radios
from .report_week import (
    Meters,
    async_calendar_peaks,
    async_energy_prefs,
    async_hourly,
    async_peak_windows,
    energy,
    merge,
    peak_sensors,
    peaks,
    peaks_read,
    room_meters,
    sources_of,
    week_of,
)
from .report_words import ask, language_of, notification
from .storage import DomoTwinData

_LOGGER = logging.getLogger(__name__)

#: The settings: whether a report is written each week, on which day (Monday 0) and at which hour
#: where the home is; whether Home Assistant's notification says it; the AI task that sums it up,
#: if any; the level a battery is low at (%), as Home Assistant's Maintenance page counts it.
SETTINGS_SCHEMA: Final = vol.Schema(
    {
        vol.Optional("weekly", default=True): bool,
        vol.Optional("weekday", default=0): vol.All(int, vol.Range(min=0, max=6)),
        vol.Optional("hour", default=8): vol.All(int, vol.Range(min=0, max=23)),
        vol.Optional("notify", default=True): bool,
        vol.Optional("summary", default=None): vol.Any(None, cv.entity_domain("ai_task")),
        vol.Optional("battery", default=20): vol.All(int, vol.Range(min=1, max=99)),
    }
)
#: After Home Assistant has started, a week missed is written this late (seconds): the
#: integrations it reads (ZHA, the recorder) are then up.
CATCH_UP_DELAY: Final = 120
#: The AI task is waited for this long at most (seconds).
SUMMARY_TIMEOUT: Final = 120
#: Reports written by hand kept at most, besides the weeks'.
MAX_HAND_REPORTS: Final = 2
#: What was done since the last report: at most this many items a section said.
MAX_GONE: Final = 20
#: How the AI task's task is named in its logs.
TASK_NAME: Final = "DomoTwin weekly report"


class ReportError(Exception):
    """A request refused, with a code the frontend translates."""

    def __init__(self, code: str) -> None:
        """Keep the code."""
        super().__init__(code)
        self.code = code


def read_settings(raw: Any) -> dict[str, Any]:
    """The settings as stored, the defaults for what cannot be read."""
    try:
        settings: dict[str, Any] = SETTINGS_SCHEMA(raw if isinstance(raw, dict) else {})
    except vol.Invalid:
        settings = SETTINGS_SCHEMA({})
    return settings


def last_slot(settings: Mapping[str, Any], now: datetime) -> datetime:
    """The last moment a report was due at or before `now`.

    The day and hour chosen, where the home is (an hour a change of time skips is the hour after).
    """
    zone = dt_util.get_default_time_zone()
    local = now.astimezone(zone)
    back = (local.weekday() - settings["weekday"]) % 7
    day = local.date() - timedelta(days=back)
    slot = datetime.combine(day, time(settings["hour"]), tzinfo=zone)
    if slot > local:
        slot = datetime.combine(day - timedelta(days=7), time(settings["hour"]), tzinfo=zone)
    return dt_util.as_utc(slot)


def _pruned(reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The reports kept, oldest first.

    The last eight written on their day, and the last two written by hand, so that writing by
    hand does not push the weeks out.
    """
    scheduled = [report for report in reports if report.get("by") != "hand"][-MAX_REPORTS:]
    by_hand = [report for report in reports if report.get("by") == "hand"][-MAX_HAND_REPORTS:]
    return sorted([*scheduled, *by_hand], key=lambda report: report["id"])


def _cap(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """A section's items kept, and how many more there were."""
    return items[:MAX_REPORT_ITEMS], max(len(items) - MAX_REPORT_ITEMS, 0)


def _keys(report: Mapping[str, Any] | None) -> dict[str, dict[str, str]]:
    """Each section's items of a report, by key: their names."""
    found: dict[str, dict[str, str]] = {}
    sections = report.get("sections", {}) if report else {}
    for section, items in sections.items():
        found[section] = {item["key"]: str(item.get("name", "")) for item in items}
    return found


def _read_report(raw: Any) -> dict[str, Any] | None:
    """A report as stored, leniently: None when it is not one."""
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), int):
        return None
    week = raw.get("week")
    sections = raw.get("sections")
    if not isinstance(week, dict) or not isinstance(sections, dict):
        return None
    if dt_util.parse_datetime(str(raw.get("at", ""))) is None:
        return None
    for items in sections.values():
        if not isinstance(items, list) or not all(
            isinstance(item, dict) and isinstance(item.get("key"), str) for item in items
        ):
            return None
    return raw


def summary_of(report: Mapping[str, Any]) -> dict[str, Any]:
    """What the list of reports says of one: when, the week, how many items each section has."""
    sections = report.get("sections", {})
    more = report.get("more", {})
    return {
        "id": report["id"],
        "at": report["at"],
        "by": report.get("by", "schedule"),
        "week": report["week"],
        "counts": {
            section: len(items) + int(more.get(section, 0)) for section, items in sections.items()
        },
    }


class WeeklyReport:
    """The weekly report: its settings, the reports kept, and when the next one is written."""

    def __init__(self, hass: HomeAssistant, data: DomoTwinData) -> None:
        """Prepare the store; nothing is read before `async_load`."""
        self._hass = hass
        self._data = data
        self._store: Store[dict[str, Any]] = Store(
            hass, REPORT_STORAGE_VERSION, REPORT_STORAGE_KEY, private=True
        )
        self.settings: dict[str, Any] = read_settings({})
        self._reports: list[dict[str, Any]] = []
        self._next = 1
        # When reports were first kept: a week before is not caught up (a new install).
        self._since: datetime = dt_util.utcnow()
        # When the last report was written on its day (those written by hand do not count).
        self._last_scheduled: datetime | None = None
        self._lock = asyncio.Lock()
        self._unsubscribe: list[CALLBACK_TYPE] = []
        self._task: asyncio.Task[dict[str, Any] | None] | None = None
        self._revision = 0
        self._stopped = False

    async def async_load(self) -> None:
        """Read the store; the first time, say when reports start being kept."""
        stored = await self._store.async_load()
        if not isinstance(stored, dict):
            await self._store.async_save(self._saved())
            return
        self.settings = read_settings(stored.get("settings"))
        reports = stored.get("reports")
        kept = [r for r in map(_read_report, reports if isinstance(reports, list) else []) if r]
        kept.sort(key=lambda report: report["id"])
        self._reports = _pruned(kept)
        listed_next = stored.get("next")
        self._next = max(
            listed_next if isinstance(listed_next, int) else 1,
            *(report["id"] + 1 for report in self._reports),
            1,
        )
        since = dt_util.parse_datetime(str(stored.get("since", "")))
        self._since = dt_util.as_utc(since) if since else dt_util.utcnow()
        scheduled = [
            at
            for raw in (stored.get("last_scheduled"), *(r["at"] for r in kept if r["by"] != "hand"))
            if isinstance(raw, str) and (at := dt_util.parse_datetime(raw)) is not None
        ]
        self._last_scheduled = dt_util.as_utc(max(scheduled)) if scheduled else None

    def _saved(self) -> dict[str, Any]:
        saved: dict[str, Any] = {
            "settings": self.settings,
            "since": self._since.isoformat(),
            "next": self._next,
            "reports": self._reports,
        }
        if self._last_scheduled is not None:
            saved["last_scheduled"] = self._last_scheduled.isoformat()
        return saved

    @callback
    def async_start(self) -> None:
        """Look every hour, on the hour, whether a report is due."""
        self._unsubscribe.append(
            async_track_time_change(self._hass, self._hour, minute=0, second=0)
        )

    @callback
    def async_catch_up(self) -> None:
        """Once Home Assistant has started: a week missed is written, a little later."""
        self._unsubscribe.append(async_call_later(self._hass, CATCH_UP_DELAY, self._hour))

    @callback
    def async_stop(self) -> None:
        """Write no more reports; the one being written on its day is given up."""
        self._stopped = True
        for unsubscribe in self._unsubscribe:
            unsubscribe()
        self._unsubscribe.clear()
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None

    @callback
    def _hour(self, now: datetime) -> None:
        # One at a time: the hour and a week caught up may come together (and the task may have
        # run to its end before it is even kept, started eagerly).
        if (self._task is None or self._task.done()) and self.due(dt_util.utcnow()):
            self._task = self._hass.async_create_background_task(
                self._async_write("schedule"), "domotwin weekly report"
            )

    def due(self, now: datetime) -> bool:
        """Whether a report is due.

        Its day and hour have come since the last one written on its day (a week missed too), and
        since reports are kept.
        """
        if not self.settings["weekly"] or self._stopped:
            return False
        slot = last_slot(self.settings, now)
        if slot < self._since:
            return False
        return self._last_scheduled is None or self._last_scheduled < slot

    # The reports.

    def list(self) -> list[dict[str, Any]]:
        """Every report kept, the newest first, in short."""
        return [summary_of(report) for report in reversed(self._reports)]

    def get(self, report_id: int | None = None) -> dict[str, Any] | None:
        """A report (the newest without an id); None when there is none."""
        if report_id is None:
            return self._reports[-1] if self._reports else None
        for report in self._reports:
            if report["id"] == report_id:
                return report
        raise ReportError("unknown_report")

    async def async_save_settings(self, change: Mapping[str, Any]) -> dict[str, Any]:
        """Change the settings (those not given stay as they are)."""
        settings: dict[str, Any] = SETTINGS_SCHEMA({**self.settings, **change})
        self.settings = settings
        await self._store.async_save(self._saved())
        self._changed()
        return settings

    async def async_write(self) -> dict[str, Any]:
        """Write a report now, by hand, and keep it; the report written.

        Neither told nor counted as the week's. Raises `ReportError` once DomoTwin is unloaded.
        """
        report = await self._async_write("hand")
        if report is None:
            raise ReportError("not_loaded")
        return report

    async def _async_write(self, by: str) -> dict[str, Any] | None:
        """Write a report and keep it; the report, or None when none was written.

        On its day, Home Assistant's notification and the event tell it. None: DomoTwin unloaded,
        or the week's report written already.
        """
        async with self._lock:
            now = dt_util.utcnow()
            if by == "schedule" and not self.due(now):
                return None
            report, places = await self._work_out(by, now)
            rooms = {room.id: room.name for room in places.rooms}
            language = language_of(self._hass.config.language)
            if self.settings["summary"]:
                report["summary"] = await self._summarise(report, language, rooms)
            # Unloaded meanwhile (the entry reloaded or removed): its store is no longer this one's.
            if self._stopped:
                return None
            self._next = report["id"] + 1
            self._reports = _pruned([*self._reports, report])
            if by == "schedule":
                self._last_scheduled = now
            await self._store.async_save(self._saved())
        self._changed()
        if by == "schedule":
            self._tell(report, language)
        return report

    def _places(self) -> Places:
        return Places(
            self._data.storeys,
            self._data.bindings,
            ar.async_get(self._hass),
            dr.async_get(self._hass),
            er.async_get(self._hass),
        )

    async def _work_out(self, by: str, now: datetime) -> tuple[dict[str, Any], Places]:
        """The report, and the rooms it places its items in."""
        hass = self._hass
        week, before = week_of(now)
        places = self._places()
        # What the week's report is compared with: last week's; one written by hand, the last.
        last = next(
            (r for r in reversed(self._reports) if by == "hand" or r.get("by") != "hand"), None
        )
        was_unavailable = {
            item["key"]: str(item.get("since", ""))
            for item in (last or {}).get("sections", {}).get("unavailable", [])
        }
        look = Look(hass, places, now)
        storeys = self._data.storeys
        found: dict[str, list[dict[str, Any]]] = {
            "batteries": look.batteries(self.settings["battery"]),
            "unavailable": look.unavailable(was_unavailable),
            "updates": look.updates(),
            "repairs": await look.repairs(hass.config.language),
            "upkeep": look.upkeep(
                storeys, self._data.upkeep, piece_rooms(storeys), dt_util.as_local(now).date()
            ),
        }
        # The runs that failed: the week's, to the moment it is written.
        failures = await async_failed_runs(hass, week[0], now)
        registry = er.async_get(hass)

        def created(entity: str) -> datetime | None:
            entry = registry.async_get(entity)
            made = getattr(entry, "created_at", None) if entry else None
            return made if isinstance(made, datetime) else None

        found["automations"] = look.automations(failures, created)
        radios = zha_radios(hass)
        if radios is not None:
            found["radios"] = look.radios(weak_radios(radios, now))
        report: dict[str, Any] = {
            "id": self._next,
            "at": now.isoformat(),
            "by": by,
            "week": {"start": week[0].isoformat(), "end": week[1].isoformat()},
            "sections": {},
        }
        previous = _keys(last)
        more: dict[str, int] = {}
        gone: dict[str, list[dict[str, str]]] = {}
        for section in REPORT_SECTIONS:
            if section not in found:
                continue
            items, left = _cap(found[section])
            if left:
                more[section] = left
            before_keys = previous.get(section)
            if before_keys is not None:
                now_keys = {item["key"] for item in found[section]}
                for item in items:
                    if item["key"] not in before_keys:
                        item["new"] = True
                done = [
                    {"key": key, "name": name}
                    for key, name in before_keys.items()
                    if key not in now_keys
                ]
                if done:
                    gone[section] = done[:MAX_GONE]
            report["sections"][section] = items
        if more:
            report["more"] = more
        if gone:
            report["gone"] = gone
        await self._week(report, places, week, before)
        return report, places

    async def _week(
        self,
        report: dict[str, Any],
        places: Places,
        week: tuple[datetime, datetime],
        before: tuple[datetime, datetime],
    ) -> None:
        """The week's energy, and its peaks where an integration reads them."""
        hass = self._hass
        prefs = await async_energy_prefs(hass)
        meters: Meters = sources_of(prefs)
        meters.rooms = room_meters(hass, prefs, places, meters.home)
        windows: list[tuple[datetime, datetime]] = []
        read_peaks = peaks_read(hass)
        if read_peaks:
            windows = merge(
                [
                    *(await async_peak_windows(hass, peak_sensors(hass), *week)),
                    *(await async_calendar_peaks(hass, *week)),
                ]
            )
        hourly = await async_hourly(hass, meters.all(), before[0], week[1])
        if (counted := energy(meters, hourly, week, before)) is not None:
            report["energy"] = counted
        if read_peaks:
            report["peaks"] = peaks(windows, meters, hourly)

    async def _summarise(
        self, report: dict[str, Any], language: str, rooms: Mapping[str, str]
    ) -> dict[str, Any]:
        """The summary by the AI task chosen, or why there is none."""
        entity = self.settings["summary"]
        said: dict[str, Any] = {"by": entity}
        if not self._hass.services.has_service("ai_task", "generate_data"):
            said["error"] = "no_ai_task"
            return said
        try:
            async with asyncio.timeout(SUMMARY_TIMEOUT):
                answer: Any = await self._hass.services.async_call(
                    "ai_task",
                    "generate_data",
                    {
                        "task_name": TASK_NAME,
                        "instructions": ask(report, language, rooms),
                        "entity_id": entity,
                    },
                    blocking=True,
                    return_response=True,
                )
        except TimeoutError:
            said["error"] = "timeout"
            return said
        except (HomeAssistantError, vol.Invalid) as err:
            said["error"] = str(err)[:MAX_SUMMARY] or "failed"
            return said
        text = answer.get("data") if isinstance(answer, Mapping) else None
        if not isinstance(text, str) or not text.strip():
            said["error"] = "empty"
            return said
        said["text"] = text.strip()[:MAX_SUMMARY]
        return said

    def _tell(self, report: dict[str, Any], language: str) -> None:
        """Home Assistant's notification (when wanted) and the event, for a report on its day."""
        hass = self._hass
        link = f"/{PANEL_URL_PATH}?report={report['id']}"
        summary = report.get("summary", {}).get("text")
        if self.settings["notify"]:
            panel = PANEL_URL_PATH in hass.data.get("frontend_panels", {})
            title, message = notification(report, language, summary, link if panel else None)
            persistent_notification.async_create(
                hass, message, title=title, notification_id=REPORT_NOTIFICATION
            )
        counts = summary_of(report)["counts"]
        hass.bus.async_fire(
            REPORT_EVENT,
            {
                "report": report["id"],
                "week_start": report["week"]["start"],
                "week_end": report["week"]["end"],
                "counts": counts,
                "total": sum(counts.values()),
                "summary": summary,
                "url": link,
            },
        )

    def _changed(self) -> None:
        self._revision += 1
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, "report", self._revision)

    async def async_remove(self) -> None:
        """Delete the store (the integration removed)."""
        await self._store.async_remove()


# The websocket commands: administrators only. The report holds what only they may read (the
# automations' traces, the radios), and its settings are the home's.


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the weekly report (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_report_get)
    websocket_api.async_register_command(hass, ws_report_write)
    websocket_api.async_register_command(hass, ws_report_settings)


def _report(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> WeeklyReport | None:
    from .data import REPORT_KEY  # noqa: PLC0415 (data imports this module)

    report = hass.data.get(REPORT_KEY)
    if report is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return report


def _answer(weekly: WeeklyReport, shown: dict[str, Any] | None) -> dict[str, Any]:
    return {"settings": weekly.settings, "reports": weekly.list(), "report": shown}


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/report/get", vol.Optional("report"): int}
)
@callback
def ws_report_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The settings, the reports kept in short, and one report (the newest without an id)."""
    if (weekly := _report(hass, connection, msg)) is None:
        return
    try:
        shown = weekly.get(msg.get("report"))
    except ReportError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], _answer(weekly, shown))


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "domotwin/report/write"})
@websocket_api.async_response
async def ws_report_write(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Writes a report now (no notification: the one asking sees it); answers it."""
    if (weekly := _report(hass, connection, msg)) is None:
        return
    try:
        report = await weekly.async_write()
    except ReportError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], _answer(weekly, report))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/report/settings", vol.Required("settings"): dict}
)
@websocket_api.async_response
async def ws_report_settings(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Changes the settings; answers them."""
    if (weekly := _report(hass, connection, msg)) is None:
        return
    try:
        settings = await weekly.async_save_settings(msg["settings"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], {"settings": settings})
