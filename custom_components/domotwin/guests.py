"""Guest access (`docs/DECISIONS.md`, D-067): passes that open chosen rooms and devices for a while.

An administrator makes a pass: a name, the rooms it opens on the plan, the devices the guest may
see and use, from and until when, whether the guest may act or only look, whether the home's Wi-Fi
is shown, and whether it opens only on the home's network (the default) or from anywhere. A pass is
a link with a secret of its own (32 random bytes), kept in a private store
(.storage/domotwin.guests), never in the plan, the logs, the diagnostics or an export.

The link opens a page of DomoTwin's own, outside Home Assistant's sign-in: the guest has no Home
Assistant user. What the page reads goes through the pass (`guest_home`): the storeys with the rooms
it opens, the others closed, emptied and unnamed; the links and states of its devices only. What it
does goes through the pass too (`guest_call`): only its devices, only the services a guest may call
on them (`GUEST_SERVICES`), with the data each takes, checked here; each action is fired as an event
the logbook says (`EVENT_GUEST_ACTION`). A pass works from its start to its end, then stops.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Callable, Iterable, Mapping
import copy
from datetime import datetime, timedelta
from ipaddress import ip_address
import logging
import secrets
import time
from typing import Any

from aiohttp import web

from homeassistant.components import websocket_api
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Context, Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.network import NoURLAvailableError, get_url, is_cloud_connection
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.network import is_local
from homeassistant.util.ulid import ulid_now

from .compat import vol
from .const import (
    EVENT_GUEST_ACTION,
    GUEST_CALLS_SECONDS,
    GUEST_URL,
    GUESTS_STORAGE_KEY,
    GUESTS_STORAGE_VERSION,
    MAX_GUEST_AHEAD_DAYS,
    MAX_GUEST_CALLS,
    MAX_GUEST_DAYS,
    MAX_GUEST_ENTITIES,
    MAX_GUEST_NAME,
    MAX_GUEST_PASSES,
    MAX_GUEST_ROOMS,
    MAX_GUEST_STREAMS,
    MAX_ID_LENGTH,
    MODEL_ENTRY_PREFIX,
    SIGNAL_GUESTS,
    SIGNAL_UPDATED,
)
from .models import used_hashes
from .overview import piece_rooms
from .storage import DomoTwinData

_LOGGER = logging.getLogger(__name__)

#: A pass ended this long ago is forgotten.
KEEP_ENDED = timedelta(days=30)
#: A secret as `secrets.token_urlsafe(32)` writes it.
TOKEN_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
#: The followed page is told it is still followed this often (seconds), through proxies that close
#: quiet connections.
STREAM_PING_SECONDS = 25
#: Changes waiting for a page too slow to take them: past this many, it is closed, and reads the
#: home again.
STREAM_QUEUE = 500
#: The most devices one action acts on (a room's lights switched off together).
MAX_CALL_ENTITIES = 25
#: What a pass shows of the home: the storeys, the elements whose links it keeps, the rooms it
#: closes (`guest_storeys`).
type Shown = tuple[list[dict[str, Any]], set[str], set[str]]
#: The kinds of change of the home after which a guest's page reads it again.
HOME_KINDS = ("plan", "bindings", "settings", "wifi")

# What a guest may call: by domain, the services and the data each takes. Nothing else: no
# template, no target but the pass's entities, no script's variables, no lock's code.
NOTHING = vol.Schema({})
_PERCENT = vol.All(vol.Coerce(float), vol.Range(min=0, max=100))
_BYTE = vol.All(vol.Coerce(int), vol.Range(min=0, max=255))
_ON_OFF = {"turn_on": NOTHING, "turn_off": NOTHING, "toggle": NOTHING}
GUEST_SERVICES: Mapping[str, Mapping[str, vol.Schema]] = {
    "light": {
        **_ON_OFF,
        "turn_on": vol.Schema(
            {
                vol.Optional("brightness"): _BYTE,
                vol.Optional("brightness_pct"): _PERCENT,
                vol.Optional("brightness_step_pct"): vol.All(
                    vol.Coerce(float), vol.Range(min=-100, max=100)
                ),
                vol.Optional("color_temp_kelvin"): vol.All(
                    vol.Coerce(int), vol.Range(min=1000, max=20000)
                ),
                vol.Optional("rgb_color"): vol.All([_BYTE], vol.Length(min=3, max=3)),
                vol.Optional("hs_color"): vol.All(
                    [vol.All(vol.Coerce(float), vol.Range(min=0, max=360))],
                    vol.Length(min=2, max=2),
                ),
            }
        ),
    },
    "switch": _ON_OFF,
    "input_boolean": _ON_OFF,
    "siren": _ON_OFF,
    "humidifier": {**_ON_OFF, "set_humidity": vol.Schema({vol.Required("humidity"): _PERCENT})},
    "fan": {
        **_ON_OFF,
        "set_percentage": vol.Schema({vol.Required("percentage"): _PERCENT}),
        "increase_speed": NOTHING,
        "decrease_speed": NOTHING,
    },
    "cover": {
        "open_cover": NOTHING,
        "close_cover": NOTHING,
        "stop_cover": NOTHING,
        "toggle": NOTHING,
        "set_cover_position": vol.Schema(
            {vol.Required("position"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100))}
        ),
    },
    "valve": {"open_valve": NOTHING, "close_valve": NOTHING, "toggle": NOTHING},
    "media_player": {
        **_ON_OFF,
        "media_play_pause": NOTHING,
        "media_play": NOTHING,
        "media_pause": NOTHING,
        "media_next_track": NOTHING,
        "media_previous_track": NOTHING,
        "volume_up": NOTHING,
        "volume_down": NOTHING,
        "volume_set": vol.Schema(
            {vol.Required("volume_level"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1))}
        ),
        "volume_mute": vol.Schema({vol.Required("is_volume_muted"): bool}),
    },
    "lock": {"lock": NOTHING, "unlock": NOTHING},
    "climate": {
        "turn_on": NOTHING,
        "turn_off": NOTHING,
        "set_temperature": vol.Schema(
            {vol.Required("temperature"): vol.All(vol.Coerce(float), vol.Range(min=-50, max=100))}
        ),
    },
    "water_heater": {"turn_on": NOTHING, "turn_off": NOTHING},
    "vacuum": {
        "start": NOTHING,
        "pause": NOTHING,
        "stop": NOTHING,
        "return_to_base": NOTHING,
        "locate": NOTHING,
    },
    "lawn_mower": {"start_mowing": NOTHING, "pause": NOTHING, "dock": NOTHING},
    "scene": {"turn_on": NOTHING},
    "script": {"turn_on": NOTHING},
    "button": {"press": NOTHING},
    "input_button": {"press": NOTHING},
}
#: What `homeassistant.turn_on`, `turn_off` and `toggle` (DomoTwin's switches) may act on.
HOMEASSISTANT_TOGGLES = frozenset(
    {
        "light",
        "switch",
        "input_boolean",
        "siren",
        "humidifier",
        "fan",
        "cover",
        "valve",
        "media_player",
        "climate",
        "water_heater",
    }
)
#: What a pass may give: what a guest may use, and what they may only read. Never a person, a
#: tracker, a camera, an alarm, an automation or anything else.
GUEST_DOMAINS = frozenset(GUEST_SERVICES) | {"sensor", "binary_sensor", "weather"}


class GuestError(Exception):
    """A pass refused, or a guest's request: a code the frontend translates, and its status."""

    def __init__(self, code: str, status: int = 400, **details: Any) -> None:
        """Keep the code, the HTTP status and what helps to say it."""
        super().__init__(code)
        self.code = code
        self.status = status
        self.details = details


def _datetime(value: Any) -> datetime:
    """A moment, in Home Assistant's time zone when it says none."""
    moment = cv.datetime(value)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt_util.get_default_time_zone())
    return dt_util.as_utc(moment)


def _name(value: Any) -> str:
    text = " ".join(cv.string(value).split())
    if not 1 <= len(text) <= MAX_GUEST_NAME:
        raise vol.Invalid(f"a pass's name is 1 to {MAX_GUEST_NAME} characters")
    return text


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


PASS_SCHEMA = vol.Schema(
    {
        vol.Optional("id"): vol.All(cv.string, vol.Length(min=1, max=MAX_ID_LENGTH)),
        vol.Required("name"): _name,
        vol.Optional("rooms", default=list): vol.All(
            [vol.All(cv.string, vol.Length(min=1, max=MAX_ID_LENGTH))],
            vol.Length(max=MAX_GUEST_ROOMS),
            _unique,
        ),
        vol.Optional("entities", default=list): vol.All(
            [cv.entity_id], vol.Length(max=MAX_GUEST_ENTITIES), _unique
        ),
        vol.Required("starts"): _datetime,
        vol.Required("ends"): _datetime,
        vol.Optional("act", default=True): bool,
        vol.Optional("wifi", default=True): bool,
        vol.Optional("anywhere", default=False): bool,
        vol.Optional("renew", default=False): bool,
    }
)


def _domain(entity_id: str) -> str:
    return entity_id.split(".", 1)[0]


def _when(text: str) -> datetime:
    """A moment as a pass keeps it (ISO 8601, checked when kept)."""
    moment = dt_util.parse_datetime(text)
    return moment if moment is not None else dt_util.utc_from_timestamp(0)


def status_of(guest_pass: Mapping[str, Any], now: datetime) -> str:
    """Where a pass stands: `upcoming`, `open` or `ended`."""
    if now >= _when(guest_pass["ends"]):
        return "ended"
    if now < _when(guest_pass["starts"]):
        return "upcoming"
    return "open"


def _read_pass(raw: Any) -> dict[str, Any] | None:
    """A pass as stored, or nothing when it cannot be read."""
    if not isinstance(raw, dict):
        return None
    token = raw.get("token")
    pass_id = raw.get("id")
    if (
        not isinstance(token, str)
        or len(token) < 40
        or not set(token) <= TOKEN_CHARS
        or not isinstance(pass_id, str)
    ):
        return None
    try:
        read = PASS_SCHEMA({key: value for key, value in raw.items() if key != "token"})
    except vol.Invalid:
        return None
    return _stored(pass_id, token, read)


def _stored(pass_id: str, token: str, read: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": pass_id,
        "token": token,
        "name": read["name"],
        "rooms": list(read["rooms"]),
        "entities": [e for e in read["entities"] if _domain(e) in GUEST_DOMAINS],
        "starts": read["starts"].isoformat(),
        "ends": read["ends"].isoformat(),
        "act": read["act"],
        "wifi": read["wifi"],
        "anywhere": read["anywhere"],
    }


class Guests:
    """The guest passes, kept in their own private store, and the pages that follow them."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store; nothing is read before `async_load`."""
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, GUESTS_STORAGE_VERSION, GUESTS_STORAGE_KEY, private=True
        )
        self._passes: list[dict[str, Any]] = []
        self._by_token: dict[str, dict[str, Any]] = {}
        # The moments each pass's guests acted lately, by pass id.
        self._calls: dict[str, deque[float]] = {}
        # The pages following each pass, by pass id, oldest first: what wakes each one.
        self._streams: dict[str, dict[asyncio.Queue[bytes | None], None]] = {}
        # What each pass shows of the home (`guest_storeys`), for the home's revision it was
        # worked out at: a plan of 500 elements takes tens of milliseconds.
        self._shown: dict[str, tuple[int, list[str], Shown]] = {}
        self._revision = 0

    async def async_load(self) -> None:
        """Read the store; passes ended long ago are forgotten."""
        stored = await self._store.async_load()
        listed = stored.get("passes") if isinstance(stored, dict) else None
        passes = [p for p in map(_read_pass, listed if isinstance(listed, list) else []) if p]
        self._set(self._kept(passes))

    def _kept(self, passes: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        limit = dt_util.utcnow() - KEEP_ENDED
        return [p for p in passes if _when(p["ends"]) > limit]

    def _set(self, passes: list[dict[str, Any]]) -> None:
        self._passes = passes
        self._by_token = {p["token"]: p for p in passes}

    @property
    def passes(self) -> list[dict[str, Any]]:
        """Every pass kept, as stored (their secrets with them)."""
        return self._passes

    def by_token(self, token: str) -> dict[str, Any] | None:
        """The pass of a link's secret, if one has it."""
        if not 40 <= len(token) <= 100 or not set(token) <= TOKEN_CHARS:
            return None
        return self._by_token.get(token)

    def admin_view(self, guest_pass: Mapping[str, Any]) -> dict[str, Any]:
        """A pass as an administrator sees it: all of it, where it stands and its link."""
        view = {key: value for key, value in guest_pass.items() if key != "token"}
        view["path"] = f"{GUEST_URL}/{guest_pass['token']}"
        view["url"] = _link(self._hass, view["path"], anywhere=guest_pass["anywhere"])
        view["status"] = status_of(guest_pass, dt_util.utcnow())
        return view

    async def async_save(self, change: Mapping[str, Any], rooms: set[str]) -> dict[str, Any]:
        """Makes or changes a pass (`rooms`: the home's rooms); answers it as `admin_view` does."""
        read = PASS_SCHEMA(dict(change))
        now = dt_util.utcnow()
        if read["ends"] <= read["starts"]:
            raise GuestError("ends_before")
        if read["ends"] <= now:
            raise GuestError("already_ended")
        if read["ends"] - read["starts"] > timedelta(days=MAX_GUEST_DAYS):
            raise GuestError("too_long", days=MAX_GUEST_DAYS)
        if read["starts"] > now + timedelta(days=MAX_GUEST_AHEAD_DAYS):
            raise GuestError("too_far")
        if unknown := [room for room in read["rooms"] if room not in rooms]:
            raise GuestError("unknown_room", room=unknown[0])
        if refused := [e for e in read["entities"] if _domain(e) not in GUEST_DOMAINS]:
            raise GuestError("not_for_guests", entity=refused[0])
        if not read["rooms"] and not read["entities"]:
            raise GuestError("nothing_open")
        passes = self._kept(self._passes)
        kept = next((p for p in passes if p["id"] == read.get("id")), None)
        if "id" in read and kept is None:
            raise GuestError("unknown_pass")
        if kept is None and len(passes) >= MAX_GUEST_PASSES:
            raise GuestError("too_many", passes=MAX_GUEST_PASSES)
        token = (
            kept["token"] if kept is not None and not read["renew"] else secrets.token_urlsafe(32)
        )
        stored = _stored(kept["id"] if kept is not None else ulid_now(), token, read)
        passes = [stored if p is kept else p for p in passes] if kept else [*passes, stored]
        self._set(passes)
        await self._async_write()
        self._changed(stored["id"])
        return self.admin_view(stored)

    async def async_remove_pass(self, pass_id: str) -> bool:
        """Removes a pass: its link stops working at once."""
        passes = [p for p in self._passes if p["id"] != pass_id]
        if len(passes) == len(self._passes):
            return False
        self._set(passes)
        await self._async_write()
        self._changed(pass_id)
        return True

    async def _async_write(self) -> None:
        await self._store.async_save({"passes": self._passes})

    async def async_remove(self) -> None:
        """Delete the store (the integration removed)."""
        await self._store.async_remove()

    def shown(self, data: DomoTwinData, guest_pass: Mapping[str, Any]) -> Shown:
        """What a pass shows of the home (`guest_storeys`), worked out once for each revision."""
        kept = self._shown.get(guest_pass["id"])
        if kept is not None and kept[0] == data.revision and kept[1] == guest_pass["rooms"]:
            return kept[2]
        shown = guest_storeys(
            data.storeys, set(guest_pass["rooms"]), self._hass.config.location_name
        )
        self._shown[guest_pass["id"]] = (data.revision, list(guest_pass["rooms"]), shown)
        return shown

    def _changed(self, pass_id: str) -> None:
        self._revision += 1
        self._calls.pop(pass_id, None)
        self._shown.pop(pass_id, None)
        async_dispatcher_send(self._hass, SIGNAL_GUESTS, pass_id)
        # Administrators' screens are told, never what changed.
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, "guests", self._revision)

    @callback
    def async_stop(self) -> None:
        """Close the pages following a pass (the integration unloaded)."""
        for queues in self._streams.values():
            for queue in queues:
                _put(queue, None)
        self._streams.clear()

    # What a guest's page asks: through the pass, each time checked.

    def check(self, request: web.Request, token: str) -> dict[str, Any]:
        """The pass of a request, if it opens now and from where it is asked; else `GuestError`."""
        guest_pass = self.by_token(token)
        if guest_pass is None:
            raise GuestError("unknown", 404)
        if not guest_pass["anywhere"] and not _from_home(self._hass, request):
            raise GuestError("home_only", 403)
        status = status_of(guest_pass, dt_util.utcnow())
        if status == "upcoming":
            raise GuestError("not_yet", 403, starts=guest_pass["starts"])
        if status == "ended":
            raise GuestError("ended", 410, ends=guest_pass["ends"])
        return guest_pass

    def allow_call(self, guest_pass: Mapping[str, Any]) -> None:
        """Counts an action of the pass's guests; refuses one past `MAX_GUEST_CALLS` in a while."""
        now = time.monotonic()
        calls = self._calls.setdefault(guest_pass["id"], deque())
        while calls and calls[0] <= now - GUEST_CALLS_SECONDS:
            calls.popleft()
        if len(calls) >= MAX_GUEST_CALLS:
            raise GuestError("too_many_calls", 429)
        calls.append(now)

    async def async_stream(
        self,
        request: web.Request,
        guest_pass: Mapping[str, Any],
        followed: Iterable[str],
    ) -> web.StreamResponse:
        """Follows the pass's devices for its page (server-sent events) until the pass ends.

        `state`: an entity's new state, those followed first as they are now; `home`: the home or
        the pass changed (the page reads it again, then follows it anew); `end`: the pass ended.
        The page is closed after `home` and `end`, and when Home Assistant or DomoTwin stops. Past
        `MAX_GUEST_STREAMS` pages, the oldest is closed (a page reloaded leaves its old one open
        until the next ping finds it gone).
        """
        pass_id = guest_pass["id"]
        queues = self._streams.setdefault(pass_id, {})
        while len(queues) >= MAX_GUEST_STREAMS:
            oldest = next(iter(queues))
            del queues[oldest]
            _put(oldest, None)
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=STREAM_QUEUE)
        queues[queue] = None
        entities = sorted(set(followed))
        stops = self._follow(pass_id, entities, queue)
        response = web.StreamResponse(
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
            }
        )
        try:
            await response.prepare(request)
            await response.write(b"retry: 5000\n\n")
            for entity_id in entities:
                if (state := self._hass.states.get(entity_id)) is not None:
                    await response.write(_event("state", guest_state(state)))
            await self._async_send(response, queue, _when(guest_pass["ends"]))
        except ConnectionError:
            _LOGGER.debug("A guest's page stopped following its pass")
        finally:
            for stop in stops:
                stop()
            queues.pop(queue, None)
            if not queues and self._streams.get(pass_id) is queues:
                self._streams.pop(pass_id, None)
        return response

    def _follow(
        self, pass_id: str, entities: list[str], queue: asyncio.Queue[bytes | None]
    ) -> list[Callable[[], None]]:
        """What wakes a page.

        Its devices changing, the home or the pass changing, Home Assistant stopping.
        """

        @callback
        def state_changed(event: Event[EventStateChangedData]) -> None:
            new = event.data["new_state"]
            if new is not None:
                _put(queue, _event("state", guest_state(new)))

        @callback
        def home_changed(kind: str, _revision: int) -> None:
            if kind in HOME_KINDS:
                _put(queue, _event("home", {}))
                _put(queue, None)

        @callback
        def pass_changed(changed: str) -> None:
            if changed == pass_id:
                _put(queue, _event("home", {}))
                _put(queue, None)

        @callback
        def stopping(_event: Event) -> None:
            _put(queue, None)

        return [
            async_track_state_change_event(self._hass, entities, state_changed),
            async_dispatcher_connect(self._hass, SIGNAL_UPDATED, home_changed),
            async_dispatcher_connect(self._hass, SIGNAL_GUESTS, pass_changed),
            self._hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, stopping),
        ]

    @staticmethod
    async def _async_send(
        response: web.StreamResponse, queue: asyncio.Queue[bytes | None], ends: datetime
    ) -> None:
        """Writes what wakes the page, a ping when nothing does, until it ends or is closed."""
        while True:
            left = (ends - dt_util.utcnow()).total_seconds()
            if left <= 0:
                await response.write(_event("end", {"ends": ends.isoformat()}))
                return
            try:
                async with asyncio.timeout(min(STREAM_PING_SECONDS, left)):
                    message = await queue.get()
            except TimeoutError:
                await response.write(b": ping\n\n")
                continue
            if message is None:
                return
            await response.write(message)


def _put(queue: asyncio.Queue[bytes | None], message: bytes | None) -> None:
    """Gives a page something to write (`None`: to stop).

    A page too slow to follow loses what waited: it is told to read the home again, then closed.
    """
    try:
        queue.put_nowait(message)
    except asyncio.QueueFull:
        while not queue.empty():
            queue.get_nowait()
        queue.put_nowait(_event("home", {}))
        queue.put_nowait(None)


def _event(name: str, data: Any) -> bytes:
    return b"event: " + name.encode() + b"\ndata: " + json_bytes(data) + b"\n\n"


def _from_home(hass: HomeAssistant, request: web.Request) -> bool:
    """Whether a request comes from the home's network, as a local-only user's must.

    Not through Home Assistant Cloud, from a local address.
    """
    if is_cloud_connection(hass):
        return False
    try:
        return is_local(ip_address(request.remote or ""))
    except ValueError:
        return False


def _link(hass: HomeAssistant, path: str, *, anywhere: bool) -> str | None:
    """A pass's link: Home Assistant's address on the home's network, or from anywhere."""
    try:
        if anywhere:
            base = get_url(hass, allow_internal=False)
        else:
            base = get_url(hass, allow_external=False, allow_cloud=False)
    except NoURLAvailableError:
        return None
    return f"{base}{path}"


def guest_state(state: State) -> dict[str, Any]:
    """An entity's state for a guest: without its context, which names Home Assistant's users."""
    return {
        "entity_id": state.entity_id,
        "state": state.state,
        "attributes": dict(state.attributes),
        "last_changed": state.last_changed.isoformat(),
        "last_updated": state.last_updated.isoformat(),
    }


# The home as a pass shows it.


def _listed(plan: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    listed = plan.get(key)
    return [e for e in listed if isinstance(e, dict)] if isinstance(listed, list) else []


def guest_storeys(storeys: list[dict[str, Any]], opened: set[str], name: str = "") -> Shown:
    """The storeys a pass shows, the elements whose links it keeps, and the rooms it closes.

    Only the storeys with a room it opens. Their rooms, partitions, doors and windows stay, so that
    the walls are as they are; those of the other rooms unnamed. Only the pieces in the rooms it
    opens (a piece's room as the 3D view finds it), and the 3D models they are drawn from; no
    saved viewpoint. Each plan is named `name` (Home Assistant's name of the home), not its own.
    """
    rooms_of_pieces = piece_rooms(storeys)
    shown: list[dict[str, Any]] = []
    kept: set[str] = set()
    closed: set[str] = set()
    for storey in storeys:
        plan = storey.get("plan")
        if not isinstance(plan, dict):
            continue
        room_ids = {r["id"] for r in _listed(plan, "rooms") if isinstance(r.get("id"), str)}
        if not room_ids & opened:
            continue
        closed |= room_ids - opened
        kept |= room_ids & opened
        out: dict[str, Any] = {
            key: copy.deepcopy(plan[key])
            for key in ("format", "version", "wallThickness")
            if key in plan
        }
        out["name"] = name
        out["rooms"] = [
            room if room.get("id") in opened else {**room, "name": ""}
            for room in map(copy.deepcopy, _listed(plan, "rooms"))
        ]
        for key in ("partitions", "doors", "windows"):
            elements = []
            for element in map(copy.deepcopy, _listed(plan, key)):
                if element.get("room") in opened:
                    if isinstance(element.get("id"), str):
                        kept.add(element["id"])
                else:
                    element["name"] = ""
                elements.append(element)
            out[key] = elements
        items = [
            copy.deepcopy(item)
            for item in _listed(plan, "items")
            if rooms_of_pieces.get(str(item.get("id"))) in opened
        ]
        out["items"] = items
        pieces = {item["id"] for item in items if isinstance(item.get("id"), str)}
        layout_in = storey.get("layout")
        layout_in = layout_in if isinstance(layout_in, dict) else {}
        layout: dict[str, Any] = {}
        for key, entry in layout_in.items():
            added = isinstance(entry, dict) and isinstance(entry.get("add"), dict)
            if key in pieces or (added and rooms_of_pieces.get(key) in opened):
                layout[key] = copy.deepcopy(entry)
                pieces.add(key)
        used = {item.get("model") for item in items} | {
            entry["add"].get("model")
            for entry in layout.values()
            if isinstance(entry, dict) and isinstance(entry.get("add"), dict)
        }
        models = plan.get("models")
        out["models"] = {
            key: copy.deepcopy(model)
            for key, model in (models.items() if isinstance(models, dict) else [])
            if key in used
        }
        for key, entry in layout_in.items():
            if key.startswith(MODEL_ENTRY_PREFIX) and key.removeprefix(MODEL_ENTRY_PREFIX) in used:
                layout[key] = copy.deepcopy(entry)
        kept |= pieces
        shown.append(
            {
                "info": {
                    "id": storey.get("id"),
                    "name": storey.get("name", ""),
                    "elevation": storey.get("elevation", 0),
                },
                "plan": out,
                "layout": layout,
            }
        )
    return shown, kept, closed


#: The actions a guest's piece keeps: DomoTwin's own, on its devices.
GUEST_ACTIONS = frozenset({"toggle", "more-info", "controls", "none"})


def guest_bindings(
    bindings: Mapping[str, Any], kept: set[str], opened: set[str], allowed: set[str]
) -> dict[str, Any]:
    """The links a pass shows.

    The rooms it opens with their area, the elements it keeps with its devices only; their taps and
    long presses when DomoTwin's own on those devices; no room's own action, no device of the
    network map.
    """
    rooms_in = bindings.get("rooms")
    rooms: dict[str, Any] = {}
    for room, binding in rooms_in.items() if isinstance(rooms_in, dict) else []:
        area = binding.get("area") if isinstance(binding, dict) else None
        if room in opened and isinstance(area, str):
            rooms[room] = {"area": area}
    elements_in = bindings.get("elements")
    elements: dict[str, Any] = {}
    for element, binding in elements_in.items() if isinstance(elements_in, dict) else []:
        if element not in kept or not isinstance(binding, dict):
            continue
        listed = binding.get("entities")
        entities = []
        for entity in listed if isinstance(listed, list) else []:
            if isinstance(entity, dict) and entity.get("entity_id") in allowed:
                kept_entity = {"entity_id": entity["entity_id"]}
                if isinstance(entity.get("role"), str):
                    kept_entity["role"] = entity["role"]
                entities.append(kept_entity)
        if not entities:
            continue
        out: dict[str, Any] = {"entities": entities}
        for key in ("tap_action", "hold_action"):
            action = binding.get(key)
            if not isinstance(action, dict) or action.get("action") not in GUEST_ACTIONS:
                continue
            target = action.get("entity_id")
            if target is None:
                out[key] = {"action": action["action"]}
            elif target in allowed:
                out[key] = {"action": action["action"], "entity_id": target}
        elements[element] = out
    return {"version": 1, "rooms": rooms, "elements": elements}


def guest_home(
    hass: HomeAssistant,
    data: DomoTwinData,
    wifi: Mapping[str, Any] | None,
    guest_pass: Mapping[str, Any],
    storeys: Shown,
) -> dict[str, Any]:
    """What a guest's page reads of the home.

    The storeys, links, settings and states the pass shows (`storeys`: `Guests.shown`'s), the areas
    and registry entries of its devices, and the home's Wi-Fi (`wifi`, as an administrator sees it)
    if it shows it.
    """
    allowed = set(guest_pass["entities"])
    shown, kept, closed = storeys
    opened = set(guest_pass["rooms"]) & kept
    links = guest_bindings(data.bindings, kept, opened, allowed)
    settings = data.settings
    home_settings: dict[str, Any] = {
        key: settings[key] for key in ("north", "theme", "accent") if key in settings
    }
    # The rooms it does not open are closed as private rooms are, for nobody (D-039).
    home_settings["rooms"] = {room: {"people": []} for room in sorted(closed)}
    entity_reg = er.async_get(hass)
    device_reg = dr.async_get(hass)
    area_reg = ar.async_get(hass)
    entities: dict[str, Any] = {}
    areas: dict[str, Any] = {}
    states: dict[str, Any] = {}
    for entity_id in guest_pass["entities"]:
        if (state := hass.states.get(entity_id)) is not None:
            states[entity_id] = guest_state(state)
        entry = entity_reg.async_get(entity_id)
        if entry is None:
            continue
        area_id = entry.area_id
        if area_id is None and entry.device_id is not None:
            device = device_reg.async_get(entry.device_id)
            area_id = device.area_id if device is not None else None
        entities[entity_id] = {
            "entity_id": entity_id,
            "area_id": area_id,
            "name": entry.name,
            "entity_category": entry.entity_category,
            "hidden": entry.hidden,
        }
        if area_id is not None:
            areas.setdefault(area_id, None)
    for binding in links["rooms"].values():
        areas.setdefault(binding["area"], None)
    for area_id in list(areas):
        area = area_reg.async_get_area(area_id)
        if area is None:
            del areas[area_id]
        else:
            areas[area_id] = {"area_id": area_id, "name": area.name}
    shown_wifi = None
    if wifi is not None and guest_pass["wifi"]:
        shown_wifi = {key: value for key, value in wifi.items() if key != "screens"}
        image = wifi.get("image")
        if isinstance(image, str) and (state := hass.states.get(image)) is not None:
            states[image] = guest_state(state)
    return {
        "pass": {
            "name": guest_pass["name"],
            "starts": guest_pass["starts"],
            "ends": guest_pass["ends"],
            "act": guest_pass["act"],
            "entities": list(guest_pass["entities"]),
        },
        "home": hass.config.location_name,
        "storeys": shown,
        "bindings": links,
        "settings": home_settings,
        "states": states,
        "entities": entities,
        "areas": areas,
        "wifi": shown_wifi,
        "config": {
            "time_zone": hass.config.time_zone,
            "unit_system": {"temperature": hass.config.units.temperature_unit},
        },
    }


def followed_by(guest_pass: Mapping[str, Any], wifi: Mapping[str, Any] | None) -> list[str]:
    """The entities a guest's page follows: the pass's, and the router's code if it shows it."""
    followed = list(guest_pass["entities"])
    image = wifi.get("image") if wifi is not None and guest_pass["wifi"] else None
    if isinstance(image, str):
        followed.append(image)
    return followed


def guest_models(storeys: list[dict[str, Any]]) -> set[str]:
    """The 3D files (their SHA-256) the storeys a pass shows are drawn from."""
    files: set[str] = set()
    for storey in storeys:
        files |= used_hashes(storey["plan"], storey["layout"])
    return files


def guest_call(guest_pass: Mapping[str, Any], body: Any) -> tuple[str, str, dict[str, Any]]:
    """What a guest asks done, checked.

    The pass lets them act, on its devices only, with a service a guest may call on them and the
    data it takes. Returns the domain, the service and its data (its entities with it).
    """
    if not guest_pass["act"]:
        raise GuestError("look_only", 403)
    if not isinstance(body, dict):
        raise GuestError("invalid")
    domain, service = body.get("domain"), body.get("service")
    data = body.get("data", {})
    target = body.get("target", {})
    if (
        not isinstance(domain, str)
        or not isinstance(service, str)
        or not isinstance(data, dict)
        or not isinstance(target, dict)
        or set(target) - {"entity_id"}
    ):
        raise GuestError("invalid")
    data = dict(data)
    asked = target.get("entity_id", data.pop("entity_id", None))
    ids = [asked] if isinstance(asked, str) else asked
    if (
        not isinstance(ids, list)
        or not 1 <= len(ids) <= MAX_CALL_ENTITIES
        or not all(isinstance(i, str) for i in ids)
    ):
        raise GuestError("invalid")
    allowed = set(guest_pass["entities"])
    if any(i not in allowed for i in ids):
        raise GuestError("not_allowed", 403)
    if domain == "homeassistant":
        toggles = all(_domain(i) in HOMEASSISTANT_TOGGLES for i in ids)
        if service not in _ON_OFF or data or not toggles:
            raise GuestError("not_allowed", 403)
        return domain, service, {"entity_id": ids}
    schema = GUEST_SERVICES.get(domain, {}).get(service)
    if schema is None or any(_domain(i) != domain for i in ids):
        raise GuestError("not_allowed", 403)
    try:
        checked: dict[str, Any] = schema(data)
    except vol.Invalid as err:
        raise GuestError("invalid") from err
    return domain, service, {**checked, "entity_id": ids}


async def async_guest_call(
    hass: HomeAssistant,
    guest_pass: Mapping[str, Any],
    call: tuple[str, str, dict[str, Any]],
) -> None:
    """Does a guest's action (`guest_call`'s).

    Told to the logbook first, in a context of its own; Home Assistant's refusal raised as
    `GuestError`.
    """
    domain, service, data = call
    context = Context()
    hass.bus.async_fire(
        EVENT_GUEST_ACTION,
        {
            "name": guest_pass["name"],
            "entity_id": data["entity_id"],
            "service": f"{domain}.{service}",
        },
        context=context,
    )
    try:
        await hass.services.async_call(domain, service, data, blocking=True, context=context)
    except (HomeAssistantError, vol.Invalid) as err:
        raise GuestError("refused", 400, message=str(err)) from err


# The websocket commands: administrators only, since a pass's link is its secret.


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the guest passes (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_guests_get)
    websocket_api.async_register_command(hass, ws_guests_save)
    websocket_api.async_register_command(hass, ws_guests_remove)


def _guests(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> Guests | None:
    from .data import GUESTS_KEY  # noqa: PLC0415 (data imports this module)

    guests = hass.data.get(GUESTS_KEY)
    if guests is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return guests


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "domotwin/guests/get"})
@callback
def ws_guests_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The guest passes, newest last, with their links."""
    if (guests := _guests(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], {"passes": [guests.admin_view(p) for p in guests.passes]})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/guests/save", vol.Required("pass"): dict}
)
@websocket_api.async_response
async def ws_guests_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Makes or changes a pass (`renew`: a new link, the old one stops working); answers it."""
    from .data import DATA_KEY  # noqa: PLC0415 (data imports this module)

    if (guests := _guests(hass, connection, msg)) is None:
        return
    if (data := hass.data.get(DATA_KEY)) is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
        return
    rooms = {
        room["id"]
        for storey in data.storeys
        if isinstance(storey.get("plan"), dict)
        for room in _listed(storey["plan"], "rooms")
        if isinstance(room.get("id"), str)
    }
    try:
        result = await guests.async_save(msg["pass"], rooms)
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    except GuestError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/guests/remove", vol.Required("pass"): str}
)
@websocket_api.async_response
async def ws_guests_remove(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Removes a pass: its link stops working at once."""
    if (guests := _guests(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], {"removed": await guests.async_remove_pass(msg["pass"])})
