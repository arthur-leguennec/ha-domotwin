"""Actions done later (`docs/DECISIONS.md`, D-046).

"Switch the lantern on tomorrow at 6:30, at full power, until 6:45": DomoTwin keeps such actions
in a store of their own, so that they outlive a restart of Home Assistant, and does them at their
time. A device is switched on (a light at a brightness given) and, when an end is given, off again;
or it is switched off. Covers open and close.

They are made by `domotwin.schedule` (automations, scripts), by the voice assistants (`llm.py`)
and from a piece's sheet; listed live over `domotwin/schedules/subscribe`; cancelled from the
sheet, by the assistants or by `domotwin.unschedule`.

A step missed while Home Assistant was stopped is done when it starts again if it is less than
`SCHEDULE_GRACE_SECONDS` late, or if the device should be on by now (its end is still to come). A
device switched on and waiting for its end is always switched off, however late. Anything else
missed is dropped.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from functools import partial
import logging
from typing import Any

from homeassistant.auth.models import User
from homeassistant.auth.permissions.const import POLICY_CONTROL, POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.exceptions import Unauthorized, UnknownUser
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.ulid import ulid_now

from .compat import vol
from .const import (
    MAX_SCHEDULE_DAYS,
    MAX_SCHEDULE_ENTITIES,
    MAX_SCHEDULE_SPAN_DAYS,
    MAX_SCHEDULES,
    SCHEDULABLE_DOMAINS,
    SCHEDULE_GRACE_SECONDS,
    SCHEDULES_STORAGE_KEY,
    SCHEDULES_STORAGE_VERSION,
    SIGNAL_SCHEDULES,
    SIGNAL_UPDATED,
)
from .language import spoken
from .rights import HIDDEN, levels_for

_LOGGER = logging.getLogger(__name__)

#: The saves that may change what a user sees of the actions waiting (their rights, D-071).
SEEN_FROM = frozenset({"settings", "plan", "bindings"})
#: An action set a little in the past (the time it took to say it) is done at once.
LATE_ALLOWED = timedelta(minutes=1)
#: A device that could not be switched off (unavailable, failing) is tried again this often…
OFF_RETRY = timedelta(minutes=1)
#: …this many times (an hour), then given up on, and logged.
OFF_RETRIES = 60


class ScheduleError(Exception):
    """An action refused, with a code the frontend and the assistants translate."""

    def __init__(self, code: str) -> None:
        """Keep the code."""
        super().__init__(code)
        self.code = code


@dataclass
class Scheduled:
    """An action waiting: switch `entities` on (`action` "on") or off at `at` (UTC)."""

    id: str
    entities: list[str]
    action: str
    at: datetime
    #: For "on": when to switch them off again.
    until: datetime | None = None
    #: For lights switched on: their brightness (%).
    brightness: int | None = None
    #: Switched on already, waiting for `until`.
    started: bool = False
    created: datetime = field(default_factory=dt_util.utcnow)
    #: Who set it: its steps are done in their name, with their rights.
    user_id: str | None = None

    @property
    def due(self) -> datetime:
        """When its next step is: the start, or the end once started."""
        return self.until if self.started and self.until is not None else self.at

    def as_dict(self) -> dict[str, Any]:
        """As stored and as the frontend gets it (times in ISO 8601, UTC)."""
        return {
            "id": self.id,
            "entities": list(self.entities),
            "action": self.action,
            "at": self.at.isoformat(),
            "until": self.until.isoformat() if self.until else None,
            "brightness": self.brightness,
            "started": self.started,
            "created": self.created.isoformat(),
            "user_id": self.user_id,
        }

    @classmethod
    def read(cls, raw: Any) -> Scheduled | None:
        """Reads a stored action leniently: None when it is not one."""
        if not isinstance(raw, dict):
            return None
        entities = raw.get("entities")
        at = dt_util.parse_datetime(str(raw.get("at", "")))
        if (
            not isinstance(raw.get("id"), str)
            or not isinstance(entities, list)
            or not entities
            or not all(isinstance(e, str) for e in entities)
            or raw.get("action") not in ("on", "off")
            or at is None
        ):
            return None
        until = dt_util.parse_datetime(str(raw["until"])) if raw.get("until") else None
        brightness = raw.get("brightness")
        created = dt_util.parse_datetime(str(raw.get("created", ""))) or dt_util.utcnow()
        return cls(
            id=raw["id"],
            entities=entities,
            action=raw["action"],
            at=dt_util.as_utc(at),
            until=dt_util.as_utc(until) if until else None,
            brightness=brightness if isinstance(brightness, int) else None,
            started=raw.get("started") is True,
            created=dt_util.as_utc(created),
            user_id=raw["user_id"] if isinstance(raw.get("user_id"), str) else None,
        )


def next_moment(moment: datetime | time, after: datetime) -> datetime:
    """A date and time (local when it says no zone), or the next time of day after `after`."""
    if isinstance(moment, datetime):
        return dt_util.as_utc(dt_util.as_local(moment))
    local = dt_util.as_local(after)
    candidate = datetime.combine(local.date(), moment, tzinfo=local.tzinfo)
    if candidate <= local:
        candidate = datetime.combine(local.date() + timedelta(days=1), moment, tzinfo=local.tzinfo)
    return dt_util.as_utc(candidate)


def moment(value: Any) -> datetime | time:
    """A date and time (local when it names no zone), or a time of day: the next one."""
    try:
        return cv.datetime(value)
    except vol.Invalid:
        return cv.time(value)


def times(
    at: datetime | time | None,
    delay: timedelta | None,
    until: datetime | time | None,
    duration: timedelta | None,
) -> tuple[datetime, datetime | None]:
    """When an action starts and, if it has one, ends (UTC).

    It starts at a moment or after a delay, and ends at a moment or a duration after its start.
    """
    now = dt_util.utcnow()
    start = next_moment(at, now) if at is not None else now + (delay or timedelta(0))
    if until is not None:
        return start, next_moment(until, start)
    return start, start + duration if duration is not None else None


def check(hass: HomeAssistant, item: Scheduled) -> None:
    """Raises a `ScheduleError` for an action that cannot be done."""
    entities, action, at, until = item.entities, item.action, item.at, item.until
    if not entities:
        raise ScheduleError("no_entities")
    if len(entities) > MAX_SCHEDULE_ENTITIES:
        raise ScheduleError("too_many_entities")
    for entity in entities:
        if hass.states.get(entity) is None:
            raise ScheduleError("unknown_entity")
        if entity.split(".", 1)[0] not in SCHEDULABLE_DOMAINS:
            raise ScheduleError("not_schedulable")
    now = dt_util.utcnow()
    if at < now - LATE_ALLOWED:
        raise ScheduleError("in_the_past")
    if at > now + timedelta(days=MAX_SCHEDULE_DAYS):
        raise ScheduleError("too_far")
    if action == "off" and (until is not None or item.brightness is not None):
        raise ScheduleError("off_with_end")
    if until is not None:
        if until <= at or until <= now:
            raise ScheduleError("end_before_start")
        if until - at > timedelta(days=MAX_SCHEDULE_SPAN_DAYS):
            raise ScheduleError("too_long")


class Scheduler:
    """The actions waiting, kept in their own store, each with a timer for its next step."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store; nothing is armed before `async_start`."""
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, SCHEDULES_STORAGE_VERSION, SCHEDULES_STORAGE_KEY, private=True
        )
        self._waiting: dict[str, Scheduled] = {}
        self._timers: dict[str, Callable[[], None]] = {}
        self._running = False
        #: Stopped (unloaded): it no longer switches anything nor writes the store.
        self._stopped = False
        #: How many times each switching off was tried and failed.
        self._retries: dict[str, int] = {}

    async def async_load(self) -> None:
        """Load the actions waiting, leaving out what cannot be read."""
        stored = await self._store.async_load()
        items = stored.get("schedules", []) if isinstance(stored, dict) else []
        for raw in items if isinstance(items, list) else []:
            if (item := Scheduled.read(raw)) is not None:
                self._waiting[item.id] = item

    @callback
    def async_start(self) -> None:
        """Arm every action; those missed while Home Assistant was stopped are done or dropped.

        Switching off is always done, however late: it is the safe way. Switching on is done a
        little late, or when the device should be on by now (its end to come).
        """
        self._running = True
        now = dt_util.utcnow()
        missed: list[Scheduled] = []
        dropped = []
        for item in list(self._waiting.values()):
            late = now - item.due
            if late <= timedelta(0):
                self._arm(item, item.due)
            elif not item.started and item.until is not None and item.until <= now:
                # Its whole time on passed while Home Assistant was stopped: nothing to do.
                dropped.append(item.id)
            elif (
                item.started
                or item.action == "off"
                or late <= timedelta(seconds=SCHEDULE_GRACE_SECONDS)
                or (item.until is not None and item.until > now)
            ):
                missed.append(item)
            else:
                dropped.append(item.id)
        if dropped:
            _LOGGER.info("Actions missed while Home Assistant was stopped dropped: %s", dropped)
            for scheduled_id in dropped:
                self._waiting.pop(scheduled_id, None)
            self._hass.async_create_task(self._async_save(), eager_start=True)
        if missed:
            # In the order they were due, one after the other: on a device, the last one wins.
            missed.sort(key=lambda item: item.due)
            self._hass.async_create_task(self._async_catch_up([i.id for i in missed], now))

    async def _async_catch_up(self, ids: list[str], now: datetime) -> None:
        for scheduled_id in ids:
            await self._async_step(scheduled_id, now)

    @callback
    def async_stop(self) -> None:
        """Disarm every action (they stay stored)."""
        self._running = False
        self._stopped = True
        for stop in self._timers.values():
            stop()
        self._timers.clear()

    async def async_remove(self) -> None:
        """Delete the store (the integration is removed)."""
        await self._store.async_remove()

    def items(self) -> list[Scheduled]:
        """The actions waiting, the soonest first."""
        return sorted(self._waiting.values(), key=lambda i: i.due)

    def listing(self, user: User | None = None) -> list[dict[str, Any]]:
        """The actions waiting, the soonest first, as the frontend gets them.

        For a `user`: only those on entities they may read and see in DomoTwin (D-071), without
        who set them.
        """
        if user is None:
            return [item.as_dict() for item in self.items()]
        levels = levels_for(self._hass, user)
        return [
            {key: value for key, value in item.as_dict().items() if key != "user_id"}
            for item in self.items()
            if all(user.permissions.check_entity(e, POLICY_READ) for e in item.entities)
            and (levels is None or not any(levels.level(e) == HIDDEN for e in item.entities))
        ]

    def get(self, scheduled_id: str) -> Scheduled | None:
        """An action waiting, by its id."""
        return self._waiting.get(scheduled_id)

    def of_entities(self, entities: Iterable[str]) -> list[Scheduled]:
        """The actions waiting on any of these entities, the soonest first."""
        wanted = set(entities)
        return [item for item in self.items() if wanted.intersection(item.entities)]

    async def async_add(  # noqa: PLR0913 (what an action is, and who sets it)
        self,
        entities: list[str],
        action: str,
        at: datetime,
        until: datetime | None = None,
        brightness: int | None = None,
        *,
        user_id: str | None = None,
    ) -> Scheduled:
        """Keeps a new action and arms it; raises a `ScheduleError` when it is refused.

        `user_id`: who sets it, who must be allowed to control its devices (none: Home Assistant
        itself, an automation without a user).
        """
        item = Scheduled(
            id=ulid_now(),
            entities=list(dict.fromkeys(entities)),
            action=action,
            at=dt_util.as_utc(at),
            until=dt_util.as_utc(until) if until else None,
            brightness=brightness,
            user_id=user_id,
        )
        check(self._hass, item)
        await self.async_check_user(user_id, item.entities)
        if len(self._waiting) >= MAX_SCHEDULES:
            raise ScheduleError("too_many")
        # Set a little in the past (the time it took to say it): done at once.
        item.at = max(item.at, dt_util.utcnow())
        self._waiting[item.id] = item
        if self._running:
            self._arm(item, item.at)
        await self._async_save()
        return item

    async def async_check_user(self, user_id: str | None, entities: Iterable[str]) -> None:
        """Raises `ScheduleError("not_allowed")` unless the user may control these entities.

        In Home Assistant, and in DomoTwin: their rights let them use each (D-071).
        """
        if user_id is None:
            return
        entities = list(entities)
        user = await self._hass.auth.async_get_user(user_id)
        if user is None or not all(
            user.permissions.check_entity(entity, POLICY_CONTROL) for entity in entities
        ):
            raise ScheduleError("not_allowed")
        levels = levels_for(self._hass, user)
        if levels is not None and not levels.uses(entities):
            raise ScheduleError("not_allowed")

    async def async_cancel(self, ids: Iterable[str], user_id: str | None = None) -> int:
        """Cancels these actions (a device already switched on stays on); how many there were.

        Raises `ScheduleError("not_allowed")` when the user may not control their devices.
        """
        wanted = [self._waiting[i] for i in dict.fromkeys(ids) if i in self._waiting]
        await self.async_check_user(user_id, {e for item in wanted for e in item.entities})
        cancelled = 0
        for item in wanted:
            scheduled_id = item.id
            self._retries.pop(scheduled_id, None)
            if self._waiting.pop(scheduled_id, None) is None:
                continue
            cancelled += 1
            if (stop := self._timers.pop(scheduled_id, None)) is not None:
                stop()
        if cancelled:
            await self._async_save()
        return cancelled

    def _arm(self, item: Scheduled, when: datetime) -> None:
        if (stop := self._timers.pop(item.id, None)) is not None:
            stop()
        self._timers[item.id] = async_track_point_in_utc_time(
            self._hass, partial(self._async_step, item.id), when
        )

    async def _async_step(self, scheduled_id: str, _now: datetime) -> None:
        """Does the next step of an action: switches on (then waits for its end), or off."""
        self._timers.pop(scheduled_id, None)
        item = self._waiting.get(scheduled_id)
        if item is None or self._stopped:
            return
        on = item.action == "on" and not item.started
        reached = await self._async_switch(item, on)
        # Stopped or cancelled meanwhile: what comes next is not this one's.
        if self._stopped or self._waiting.get(scheduled_id) is not item:
            return
        if not on and not reached:
            # A device left on is tried again a while, then given up on.
            tried = self._retries.get(scheduled_id, 0) + 1
            if tried <= OFF_RETRIES:
                self._retries[scheduled_id] = tried
                self._arm(item, dt_util.utcnow() + OFF_RETRY)
                return
            _LOGGER.warning("DomoTwin gave up switching off %s", item.entities)
        self._retries.pop(scheduled_id, None)
        if on and item.until is not None:
            item.started = True
            self._arm(item, item.until)
        else:
            self._waiting.pop(scheduled_id, None)
        await self._async_save()

    async def _async_switch(self, item: Scheduled, on: bool) -> bool:
        """Switches the action's entities on or off, in the name of who set it.

        Lights are switched on at its brightness, covers opened or closed; a failure is logged.
        Switching off falls back on Home Assistant's own name when that person may no longer do
        it. Returns whether every device was reached (none failing, none unavailable).
        """
        entities = item.entities
        covers = [e for e in entities if e.startswith("cover.")]
        lights = [e for e in entities if e.startswith("light.")] if item.brightness else []
        others = [e for e in entities if e not in covers and e not in lights]
        calls: list[tuple[str, str, dict[str, Any]]] = []
        if covers:
            calls.append(("cover", "open_cover" if on else "close_cover", {"entity_id": covers}))
        if lights:
            if on:
                data = {"entity_id": lights, "brightness_pct": item.brightness}
                calls.append(("light", "turn_on", data))
            else:
                others += lights
        if others:
            calls.append(("homeassistant", "turn_on" if on else "turn_off", {"entity_id": others}))
        reached = True
        for domain, service, data in calls:
            try:
                try:
                    await self._hass.services.async_call(
                        domain, service, data, blocking=True, context=Context(user_id=item.user_id)
                    )
                except (Unauthorized, UnknownUser):
                    if on:
                        raise
                    await self._hass.services.async_call(
                        domain, service, data, blocking=True, context=Context()
                    )
            except Exception:  # A device failing must not leave the action stuck.
                _LOGGER.exception("DomoTwin could not do %s.%s", domain, service)
                reached = False
        # Home Assistant passes over unavailable devices without a word.
        unavailable = [
            e
            for e in entities
            if (state := self._hass.states.get(e)) is None or state.state == STATE_UNAVAILABLE
        ]
        return reached and not unavailable

    async def _async_save(self) -> None:
        if self._stopped:
            return
        await self._store.async_save(
            {"schedules": [item.as_dict() for item in self._waiting.values()]}
        )
        async_dispatcher_send(self._hass, SIGNAL_SCHEDULES)


# What is said of an action, in each language DomoTwin speaks (Home Assistant's, D-081): the
# sentence, with who, the verb (one thing, several), the brightness, when, and the end after it.
_SAID = {
    "en": {
        "sentence": "{who} {verb}{level} {when}{then}.",
        "on": ("will switch on", "will switch on"),
        "off": ("will switch off", "will switch off"),
        "open": ("will open", "will open"),
        "close": ("will close", "will close"),
        # The end, said after the start ("will switch on … and off at 06:45").
        "end": ("off", "off"),
        "end_cover": ("close", "close"),
        "today": "today at {time}",
        "tomorrow": "tomorrow at {time}",
        "day": "on {date} at {time}",
        "date": "%Y-%m-%d",
        "brightness": " at {brightness} %",
        "then": " and {verb} {when}",
        "then_same_day": " and {verb} at {time}",
        "and": " and ",
    },
    "fr": {
        "sentence": "{who} {verb}{level} {when}{then}.",
        "on": ("s'allumera", "s'allumeront"),
        "off": ("s'éteindra", "s'éteindront"),
        "open": ("s'ouvrira", "s'ouvriront"),
        "close": ("se fermera", "se fermeront"),
        "end": ("s'éteindra", "s'éteindront"),
        "end_cover": ("se fermera", "se fermeront"),
        "today": "aujourd'hui à {time}",
        "tomorrow": "demain à {time}",
        "day": "le {date} à {time}",
        "date": "%d/%m/%Y",
        "brightness": " à {brightness} %",
        "then": " et {verb} {when}",
        "then_same_day": " et {verb} à {time}",
        "and": " et ",
    },
}


def _when(said: dict[str, Any], moment: datetime) -> str:
    local = dt_util.as_local(moment)
    today = dt_util.now().date()
    time = local.strftime("%H:%M")
    if local.date() == today:
        return str(said["today"]).format(time=time)
    if local.date() == today + timedelta(days=1):
        return str(said["tomorrow"]).format(time=time)
    return str(said["day"]).format(date=local.strftime(str(said["date"])), time=time)


def describe(hass: HomeAssistant, item: Scheduled) -> str:
    """A sentence saying what will happen, in Home Assistant's language."""
    said = _SAID[spoken(hass.config.language)]
    names = [
        state.name if (state := hass.states.get(entity)) is not None else entity
        for entity in item.entities
    ]
    who = names[0] if len(names) == 1 else ", ".join(names[:-1]) + str(said["and"]) + names[-1]
    plural = 1 if len(names) > 1 else 0
    covers = all(entity.startswith("cover.") for entity in item.entities)
    on_verb = said["open" if covers else "on"][plural]
    off_verb = said["close" if covers else "off"][plural]
    sentence = str(said["sentence"])
    if item.started and item.until is not None:
        # On already: only its end is to come.
        when = _when(said, item.until)
        return sentence.format(who=who, verb=off_verb, level="", when=when, then="")
    verb = on_verb if item.action == "on" else off_verb
    level = ""
    if item.brightness is not None and not covers:
        level = str(said["brightness"]).format(brightness=item.brightness)
    then = ""
    if item.until is not None:
        start, end = dt_util.as_local(item.at), dt_util.as_local(item.until)
        end_verb = said["end_cover" if covers else "end"][plural]
        if start.date() == end.date():
            then = str(said["then_same_day"]).format(verb=end_verb, time=end.strftime("%H:%M"))
        else:
            then = str(said["then"]).format(verb=end_verb, when=_when(said, item.until))
    return sentence.format(who=who, verb=verb, level=level, when=_when(said, item.at), then=then)


# The websocket commands of the sheets (any signed-in user: they control the devices anyway).


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the actions done later (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_schedules_subscribe)
    websocket_api.async_register_command(hass, ws_schedules_add)
    websocket_api.async_register_command(hass, ws_schedules_cancel)


def _current(hass: HomeAssistant) -> Scheduler | None:
    """The entry's scheduler of the moment (a reload makes another one), if set up."""
    from .data import SCHEDULER_KEY  # noqa: PLC0415 (data imports this module)

    return hass.data.get(SCHEDULER_KEY)


def _scheduler(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> Scheduler | None:
    scheduler = _current(hass)
    if scheduler is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return scheduler


@websocket_api.websocket_command({vol.Required("type"): "domotwin/schedules/subscribe"})
@callback
def ws_schedules_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The actions waiting, now and every time they change: `{"schedules": [...]}`.

    Followed even before DomoTwin is set up (a screen kept open while Home Assistant restarts):
    the list is empty until then, and sent again when it is set up or unloaded. Each user gets
    the actions on what they may see, sent again when what they see may change (the home's
    settings, its plan or its links, D-071).
    """

    @callback
    def send() -> None:
        scheduler = _current(hass)
        listing = scheduler.listing(connection.user) if scheduler is not None else []
        connection.send_message(websocket_api.event_message(msg["id"], {"schedules": listing}))

    @callback
    def saved(kind: str, _revision: int) -> None:
        if kind in SEEN_FROM and not connection.user.is_admin:
            send()

    stops = [
        async_dispatcher_connect(hass, SIGNAL_SCHEDULES, send),
        async_dispatcher_connect(hass, SIGNAL_UPDATED, saved),
    ]

    @callback
    def stop() -> None:
        for each in stops:
            each()

    connection.subscriptions[msg["id"]] = stop
    connection.send_result(msg["id"])
    send()


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/schedules/add",
        vol.Required("entities"): vol.All(
            [cv.entity_id], vol.Length(min=1, max=MAX_SCHEDULE_ENTITIES)
        ),
        vol.Optional("action", default="on"): vol.In(("on", "off")),
        vol.Required("at"): moment,
        vol.Exclusive("until", "end"): moment,
        vol.Exclusive("duration", "end"): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=MAX_SCHEDULE_DAYS * 86_400)
        ),
        vol.Optional("brightness"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
    }
)
@websocket_api.async_response
async def ws_schedules_add(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Sets an action; answers it and what will happen, or the code it was refused with."""
    scheduler = _scheduler(hass, connection, msg)
    if scheduler is None:
        return
    try:
        duration = timedelta(seconds=msg["duration"]) if "duration" in msg else None
        start, end = times(msg["at"], None, msg.get("until"), duration)
        item = await scheduler.async_add(
            msg["entities"],
            msg["action"],
            start,
            end,
            msg.get("brightness"),
            user_id=connection.user.id,
        )
    except ScheduleError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], {"schedule": item.as_dict(), "text": describe(hass, item)})


@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/schedules/cancel", vol.Required("schedule_id"): str}
)
@websocket_api.async_response
async def ws_schedules_cancel(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Cancels an action; answers how many were (0: it was done or cancelled already)."""
    scheduler = _scheduler(hass, connection, msg)
    if scheduler is None:
        return
    try:
        cancelled = await scheduler.async_cancel([msg["schedule_id"]], connection.user.id)
    except ScheduleError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], {"cancelled": cancelled})
