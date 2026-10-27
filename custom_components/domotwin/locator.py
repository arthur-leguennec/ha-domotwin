"""Bluetooth locating in Home Assistant (docs/DECISIONS.md, D-035).

The locator follows the devices chosen by an administrator (a phone, a watch, a tag) through what
Home Assistant's receivers hear of them, and tells the room each one is in, every two seconds. Its
settings (where the receivers are, which devices are followed) live in `.storage/domotwin.locating`,
what it learned (how loud each receiver hears each room, how loud each device is) in
`.storage/domotwin.locating_learned`.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Callable
import copy
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import statistics
from time import monotonic
from typing import Any, Final

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    LOCATING_LEARNED_KEY,
    LOCATING_STORAGE_KEY,
    LOCATING_STORAGE_VERSION,
    SIGNAL_LOCATED,
    SIGNAL_UPDATED,
)
from .locating.filter import PRESENCE_ON, RoomFilter, presence_weight
from .locating.geometry import Home, Spot
from .locating.identity import Match, Matcher, beacon_of, resolvable
from .locating.radio import AT_1M, Key, Learned, Model, prior
from .locating.radio_ha import Advert, Radio, ha_radio
from .people import Area, rooms_of
from .storage import DomoTwinData, RevisionConflictError

# How often the rooms are worked out, and how many seconds of packets are taken together.
TICK: Final = timedelta(seconds=2)
WINDOW: Final = 6.0
# Not heard this long: not located. A receiver silent this long is not listening.
LOST: Final = 120.0
LISTENING: Final = 60.0
# The addresses a device was heard from, kept this long after their last packet, this many at most.
ADDRESS_KEPT: Final = 900.0
MAX_ADDRESSES: Final = 8
MAX_PACKETS: Final = 400
# Sure enough of a room to learn from it; how fast a device's loudness is learned.
SURE_TO_LEARN: Final = 0.9
OFFSET_RATE: Final = 0.02
# A reading confirmed by a presence sensor counts this much; a room taught, fully.
PRESENCE_LEARN: Final = 0.25
# The model takes in what was learned at most this often (seconds), the store saves it after this.
RELEARN: Final = 60.0
SAVE_DELAY: Final = 60.0
# A burst of registry changes (a start, a proxy reconnecting) makes one rebuild, this long after.
REBUILD_DELAY: Final = 2.0
# Its owner away this long, a device still heard at home is left behind (seconds).
LEFT_BEHIND_AFTER: Final = 120.0
PRIVATE_BLE: Final = "private_ble_device"
MAX_CANDIDATES: Final = 30

type Readings = dict[str, float]


def empty_locating() -> dict[str, Any]:
    """Return the settings before any is set: nothing followed, learning from presence sensors."""
    return {"version": 1, "learn": True, "receivers": {}, "devices": {}}


def located_unique_id(entry_id: str, device: str) -> str:
    """The unique id of a followed device's room sensor."""
    return f"{entry_id}_located_{device}"


@dataclass
class Located:
    """Where a followed device is: its room (id), since when, how sure, heard by how many."""

    room: str | None = None
    since: datetime | None = None
    confidence: float = 0.0
    receivers: int = 0
    last_seen: datetime | None = None
    left_behind: bool = False


@dataclass(frozen=True)
class _Moment:
    """What every device is weighed against at a tick: time, receivers listening, presence."""

    now: float
    seconds: float
    listening: list[str]
    weights: dict[str, float]


@dataclass
class _Teaching:
    room: str
    readings: list[Readings] = field(default_factory=list)


def _mac_variants(source: str) -> list[str]:
    """A receiver's address, and those its device may be registered by, the likeliest first.

    An ESP32 (ESPHome, Shelly) answers Bluetooth two addresses after its Wi-Fi. Home Assistant
    keeps Wi-Fi addresses in lowercase and Bluetooth ones as given (the adapter's in uppercase):
    both are tried.
    """
    try:
        value = int(source.replace(":", ""), 16)
    except ValueError:
        return [source.upper(), source.lower()]
    found: list[str] = []
    for delta in (0, -1, -2):
        raw = f"{(value + delta) % (1 << 48):012x}"
        mac = ":".join(raw[i : i + 2] for i in range(0, 12, 2))
        found += [mac.upper(), mac]
    return found


def _device_by_connection(
    hass: HomeAssistant, connection: tuple[str, str]
) -> dr.DeviceEntry | None:
    """The device registered with a connection (any integration's)."""
    devices = dr.async_get(hass)
    every = getattr(devices, "async_get_devices", None)
    if every is not None:
        found: list[dr.DeviceEntry] = every(connections={connection})
        return found[0] if found else None
    return devices.async_get_device(connections={connection})


class Locator:
    """The followed devices' rooms, the receivers' places, and what was learned."""

    def __init__(
        self,
        hass: HomeAssistant,
        data: DomoTwinData,
        entry_id: str,
        radio: Callable[[HomeAssistant], Radio | None] | None = None,
    ) -> None:
        """Prepare the stores; nothing is heard before `async_start`."""
        self._hass = hass
        self._data = data
        self.entry_id = entry_id
        self._radio_of = radio
        self.radio: Radio | None = None
        self._store: Store[dict[str, Any]] = Store(
            hass, LOCATING_STORAGE_VERSION, LOCATING_STORAGE_KEY, private=True
        )
        self._learned_store: Store[dict[str, Any]] = Store(
            hass, LOCATING_STORAGE_VERSION, LOCATING_LEARNED_KEY, private=True
        )
        self._settings = empty_locating()
        self.revision = 0
        self._learned: dict[Key, Learned] = {}
        self._offsets: dict[str, float] = {}
        self.home: Home = Home([])
        # Each receiver's place (None: not known), and what said so.
        self.places: dict[str, Spot | None] = {}
        self.placed_by: dict[str, str | None] = {}
        self._prior: dict[Key, tuple[float, float]] = {}
        self.model: Model = Model({}, {})
        self._model_built = 0.0
        self._learned_changed = False
        self._presence: dict[str, list[str]] = {}
        self._filters: dict[str, RoomFilter] = {}
        self._packets: dict[str, deque[tuple[float, str, float]]] = {}
        self._last_heard: dict[str, float] = {}
        self._beacon_power: dict[str, float] = {}
        self.located: dict[str, Located] = {}
        self._matcher = Matcher([])
        self.missing_keys: set[str] = set()
        # Each address followed: its device, the stop, its last packet.
        self._addresses: dict[str, tuple[str, Callable[[], None], float]] = {}
        self._teaching: dict[str, _Teaching] = {}
        self._last_tick = monotonic()
        # When each device was last weighed: the time it went unheard counts too.
        self._stepped: dict[str, float] = {}
        # How each device was known when its addresses were followed.
        self._known_by: dict[str, str] = {}
        self._stops: list[Callable[[], None]] = []
        self._rebuilding: asyncio.Task[None] | None = None
        self._rebuild_again = False
        self._rebuild_later: Callable[[], None] | None = None
        self._rebuild_lock = asyncio.Lock()
        self._save_pending = False
        # When each owner left home (going from zone to zone is still away).
        self._away_since: dict[str, datetime] = {}
        self._stopped = False

    # Settings and what was learned.

    async def async_load(self) -> None:
        """Load the settings and what was learned."""
        stored = await self._store.async_load()
        settings = empty_locating()
        if isinstance(stored, dict):
            for key in ("learn", "receivers", "devices"):
                if key in stored:
                    settings[key] = stored[key]
            self.revision = int(stored.get("revision", 0))
        self._settings = settings
        learned = await self._learned_store.async_load()
        if isinstance(learned, dict):
            rooms = learned.get("rooms")
            for room, sources in (rooms if isinstance(rooms, dict) else {}).items():
                for source, value in (sources if isinstance(sources, dict) else {}).items():
                    if (read := Learned.read(value)) is not None:
                        self._learned[room, source] = read
            offsets = learned.get("offsets")
            for device, value in (offsets if isinstance(offsets, dict) else {}).items():
                if isinstance(value, int | float) and abs(value) <= 40:
                    self._offsets[device] = float(value)

    @property
    def settings(self) -> dict[str, Any]:
        """The settings: `learn`, `receivers` (source -> place), `devices` (id -> device)."""
        return self._settings

    def _learned_data(self) -> dict[str, Any]:
        rooms: dict[str, dict[str, list[float]]] = {}
        for (room, source), learned in self._learned.items():
            rooms.setdefault(room, {})[source] = learned.stored()
        devices = self._settings["devices"]
        return {
            "rooms": rooms,
            "offsets": {d: round(v, 2) for d, v in self._offsets.items() if d in devices},
        }

    def _saved_data(self) -> dict[str, Any]:
        self._save_pending = False
        return self._learned_data()

    def _schedule_save(self) -> None:
        """Save what was learned a minute from now (once: more learned meanwhile is in it)."""
        if not self._save_pending:
            self._save_pending = True
            self._learned_store.async_delay_save(self._saved_data, SAVE_DELAY)

    def _save_learned(self) -> None:
        self._learned_changed = True
        self._schedule_save()

    async def async_flush(self) -> None:
        """Save what was learned now, if a save is due (the integration is unloaded)."""
        if self._save_pending:
            await self._learned_store.async_save(self._saved_data())

    async def async_save(
        self,
        receivers: dict[str, Any],
        devices: dict[str, Any],
        learn: bool | None = None,
        expected_revision: int | None = None,
    ) -> int:
        """Store where the receivers are and which devices are followed (checked by validation).

        Raises RevisionConflictError when saved meanwhile since `expected_revision`. Return the
        new revision.
        """
        if expected_revision is not None and expected_revision != self.revision:
            raise RevisionConflictError(self.revision)
        self._settings["receivers"] = receivers
        self._settings["devices"] = devices
        if learn is not None:
            self._settings["learn"] = learn
        for device in [d for d in self._offsets if d not in devices]:
            del self._offsets[device]
        return await self._async_commit()

    async def _async_commit(self) -> int:
        self.revision += 1
        await self._store.async_save({**copy.deepcopy(self._settings), "revision": self.revision})
        self._follow_devices()
        await self.async_rebuild()
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, "locating", self.revision)
        return self.revision

    async def async_forget(self, room: str | None = None) -> int:
        """Forget what was learned in a room (every room: None). Return how many were forgotten."""
        keys = [key for key in self._learned if room is None or key[0] == room]
        for key in keys:
            del self._learned[key]
        if room is None:
            self._offsets.clear()
        self._save_learned()
        self._build_model()
        return len(keys)

    async def async_remove(self) -> None:
        """Delete the settings and what was learned (when the integration is removed)."""
        await self._store.async_remove()
        await self._learned_store.async_remove()

    # Following.

    @callback
    def async_start(self) -> None:
        """Hear Bluetooth (when Home Assistant has it), follow the plans and the registries."""
        self.radio = (self._radio_of or ha_radio)(self._hass)
        self._stops = [
            async_dispatcher_connect(self._hass, SIGNAL_UPDATED, self._saved),
            self._hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, self._registry_changed),
            self._hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, self._registry_changed),
            self._hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, self._registry_changed),
        ]
        self._follow_devices()
        if self.radio is not None:
            self._stops.append(self.radio.watch(self._heard))
            self._stops.append(async_track_time_interval(self._hass, self._tick, TICK))
        self._schedule_rebuild()

    @callback
    def async_stop(self) -> None:
        """Stop hearing and following."""
        self._stopped = True
        for stop in self._stops:
            stop()
        self._stops = []
        for _, unfollow, _ in self._addresses.values():
            unfollow()
        self._addresses = {}
        if self._rebuild_later is not None:
            self._rebuild_later()
            self._rebuild_later = None
        if self._rebuilding is not None:
            self._rebuilding.cancel()
            self._rebuilding = None

    @callback
    def _saved(self, kind: str, revision: int) -> None:
        if kind in ("plan", "bindings"):
            self._schedule_rebuild()

    @callback
    def _registry_changed(self, event: Any) -> None:
        self._schedule_rebuild()

    @callback
    def _schedule_rebuild(self) -> None:
        """Rebuild in a moment: a burst of changes makes one rebuild."""
        if self._rebuild_later is None:
            self._rebuild_later = async_call_later(self._hass, REBUILD_DELAY, self._start_rebuild)

    @callback
    def _start_rebuild(self, now: Any = None) -> None:
        """Rebuild now; once more after the rebuild running, when asked meanwhile."""
        self._rebuild_later = None
        if self._rebuilding is not None and not self._rebuilding.done():
            self._rebuild_again = True
            return
        self._rebuilding = self._hass.async_create_background_task(
            self._async_rebuilds(), f"{DOMAIN} locating rebuild"
        )

    async def _async_rebuilds(self) -> None:
        self._rebuild_again = True
        while self._rebuild_again:
            self._rebuild_again = False
            await self.async_rebuild()

    @callback
    def _follow_devices(self) -> None:
        """Index the followed devices by what they are known by; forget those no longer followed."""
        devices = self._settings["devices"]
        matches: list[Match] = []
        missing: set[str] = set()
        for device, settings in devices.items():
            how = settings.get("match", {})
            if "address" in how:
                matches.append(Match(device, address=how["address"]))
            elif "beacon" in how:
                beacon = how["beacon"]
                matches.append(
                    Match(device, beacon=(beacon["uuid"], beacon["major"], beacon["minor"]))
                )
            elif "key" in how:
                entry = self._hass.config_entries.async_get_entry(how["key"])
                key = entry.data.get("irk") if entry is not None else None
                if entry is None or entry.domain != PRIVATE_BLE or not isinstance(key, str):
                    missing.add(device)
                    continue
                try:
                    matches.append(Match(device, key=bytes.fromhex(key)))
                except ValueError:
                    missing.add(device)
        self.missing_keys = missing
        self._matcher = Matcher(matches)
        # A device no longer followed, or now known another way (another tag under its name),
        # starts again: its addresses, its packets and where it was are forgotten.
        known_by = {device: repr(settings.get("match")) for device, settings in devices.items()}
        changed = {d for d, how in self._known_by.items() if known_by.get(d) != how}
        self._known_by = known_by
        for address, (device, unfollow, _) in list(self._addresses.items()):
            if device in changed:
                unfollow()
                del self._addresses[address]
        for device in changed:
            self._filters.pop(device, None)
            self._packets.pop(device, None)
            self._last_heard.pop(device, None)
            self._stepped.pop(device, None)
            self._beacon_power.pop(device, None)
            self._offsets.pop(device, None)
            self.located.pop(device, None)
        if self.radio is not None:
            # Addresses already heard (a key or a beacon followed from now on).
            for advert in self.radio.seen():
                self._heard(advert)

    @callback
    def _heard(self, advert: Advert) -> None:
        """A new or changed advertisement: if it is a followed device's, follow its address."""
        if advert.address in self._addresses or self.radio is None:
            return
        device = self._matcher.device_of(advert.address, advert.manufacturer or {})
        if device is None:
            return
        if (beacon := beacon_of(advert.manufacturer or {})) is not None:
            self._beacon_power[device] = beacon.power - AT_1M
        mine = sorted(
            (last, address)
            for address, (owner, _, last) in self._addresses.items()
            if owner == device
        )
        for _, address in mine[: max(0, len(mine) - MAX_ADDRESSES + 1)]:
            self._addresses.pop(address)[1]()
        address = advert.address

        @callback
        def packet(heard: Advert) -> None:
            self._packet(device, heard)

        self._addresses[address] = (device, self.radio.follow(address, packet), monotonic())
        self._packet(device, advert)

    @callback
    def _packet(self, device: str, advert: Advert) -> None:
        """A packet of a followed device, counted when it was heard.

        An old one, replayed by Home Assistant at a start, is not news.
        """
        now = monotonic()
        heard = advert.time if 0 < advert.time <= now else now
        if now - heard > WINDOW:
            return
        packets = self._packets.setdefault(device, deque(maxlen=MAX_PACKETS))
        packets.append((heard, advert.source, advert.rssi))
        self._last_heard[device] = max(self._last_heard.get(device, 0.0), heard)
        if (followed := self._addresses.get(advert.address)) is not None:
            self._addresses[advert.address] = (followed[0], followed[1], max(followed[2], heard))

    # The model.

    async def async_rebuild(self) -> None:
        """Read the plans again, place the receivers, and work out what each should hear.

        One at a time, each from what is stored when it starts: the last one asked for wins.
        """
        async with self._rebuild_lock:
            home = Home(self._data.storeys)
            rooms_by_area = self._rooms_by_area(home)
            places, placed_by = self._place_receivers(home, rooms_by_area)
            presence = self._presence_sensors(rooms_by_area)
            expected = await self._hass.async_add_executor_job(prior, home, dict(places))
            self.home, self.places, self.placed_by = home, places, placed_by
            self._presence, self._prior = presence, expected
            self._build_model()
            for device in self._settings["devices"]:
                fresh = RoomFilter(home.neighbours)
                if (old := self._filters.get(device)) is not None:
                    fresh.carry(old)
                self._filters[device] = fresh

    def _build_model(self) -> None:
        self.model = Model(self._prior, self._learned)
        self._model_built = monotonic()
        self._learned_changed = False

    def receivers_now(self) -> list[tuple[str, str, float]]:
        """The receivers Home Assistant has now: (source, name, seconds since it heard)."""
        if self.radio is None:
            return []
        return [(r.source, r.name, r.idle) for r in self.radio.receivers()]

    def _rooms_by_area(self, home: Home) -> dict[str, list[str]]:
        """The rooms each area is read by, as the people's rooms are (`people.rooms_of`)."""
        areas = [
            Area(area.id, area.name, tuple(sorted(area.aliases)))
            for area in ar.async_get(self._hass).async_list_areas()
        ]
        found: dict[str, list[str]] = {}
        for room in rooms_of(self._data.storeys, self._data.bindings.get("rooms", {}), areas):
            if room.area and room.id in home.rooms:
                found.setdefault(room.area, []).append(room.id)
        return found

    def _place_receivers(
        self, home: Home, rooms_by_area: dict[str, list[str]]
    ) -> tuple[dict[str, Spot | None], dict[str, str | None]]:
        """Each receiver's place: as an administrator set it, else from its device.

        Its device is the one registered by its address: a piece linked to it or to one of its
        entities gives the place, else the room of the device's area.
        """
        overrides = self._settings["receivers"]
        pieces_of_device: dict[str, str] = {}
        pieces_of_entity: dict[str, str] = {}
        for piece, binding in self._data.bindings.get("elements", {}).items():
            if not isinstance(binding, dict) or piece not in home.pieces:
                continue
            if isinstance(binding.get("device"), str):
                pieces_of_device.setdefault(binding["device"], piece)
            for linked in binding.get("entities", []):
                if isinstance(linked, dict) and isinstance(linked.get("entity_id"), str):
                    pieces_of_entity.setdefault(linked["entity_id"], piece)
        places: dict[str, Spot | None] = {}
        placed_by: dict[str, str | None] = {}
        sources = {source for source, _, _ in self.receivers_now()} | set(overrides)
        for source in sources:
            override = overrides.get(source, {})
            if override.get("piece") in home.pieces:
                places[source], placed_by[source] = home.pieces[override["piece"]], "piece"
            elif override.get("room") in home.rooms:
                places[source], placed_by[source] = home.middle(override["room"]), "room"
            else:
                places[source], placed_by[source] = self._place_by_device(
                    home, source, (pieces_of_device, pieces_of_entity), rooms_by_area
                )
        return places, placed_by

    def _place_by_device(
        self,
        home: Home,
        source: str,
        pieces: tuple[dict[str, str], dict[str, str]],
        rooms_by_area: dict[str, list[str]],
    ) -> tuple[Spot | None, str | None]:
        """A receiver's place from its Home Assistant device: a piece linked to it, its area."""
        device = next(
            (
                found
                for mac in _mac_variants(source)
                for kind in (dr.CONNECTION_BLUETOOTH, dr.CONNECTION_NETWORK_MAC)
                if (found := _device_by_connection(self._hass, (kind, mac))) is not None
            ),
            None,
        )
        if device is None:
            return None, None
        pieces_of_device, pieces_of_entity = pieces
        entities = er.async_get(self._hass)
        piece = pieces_of_device.get(device.id) or next(
            (
                pieces_of_entity[e.entity_id]
                for e in er.async_entries_for_device(entities, device.id)
                if e.entity_id in pieces_of_entity
            ),
            None,
        )
        if piece is not None:
            return home.pieces[piece], "device_piece"
        rooms = rooms_by_area.get(device.area_id or "", [])
        if len(rooms) == 1:
            return home.middle(rooms[0]), "device_area"
        return None, None

    def _presence_sensors(self, rooms_by_area: dict[str, list[str]]) -> dict[str, list[str]]:
        """The presence, occupancy and motion sensors of each room (by its area)."""
        entities = er.async_get(self._hass)
        devices = dr.async_get(self._hass)
        found: dict[str, list[str]] = {}
        for entry in entities.entities.values():
            if entry.domain != "binary_sensor" or entry.disabled:
                continue
            kind = entry.device_class or entry.original_device_class
            if kind not in ("occupancy", "presence", "motion", "moving"):
                continue
            area = entry.area_id
            if area is None and entry.device_id is not None:
                device = devices.async_get(entry.device_id)
                area = device.area_id if device is not None else None
            for room in rooms_by_area.get(area or "", []):
                found.setdefault(room, []).append(entry.entity_id)
        return found

    def _presence_weights(self) -> dict[str, float]:
        now = dt_util.utcnow()
        weights: dict[str, float] = {}
        for room, sensors in self._presence.items():
            read = [
                (
                    str(state.attributes.get("device_class", "")),
                    state.state == "on",
                    (now - state.last_changed).total_seconds(),
                )
                for entity in sensors
                if (state := self._hass.states.get(entity)) is not None
                and state.state in ("on", "off")
            ]
            if read:
                weights[room] = presence_weight(read)
        return weights

    # Every two seconds.

    def _readings(self, device: str, now: float) -> Readings:
        """What each receiver heard of a device lately (the median of its packets)."""
        packets = self._packets.get(device)
        if not packets:
            return {}
        while packets and packets[0][0] < now - WINDOW:
            packets.popleft()
        by_source: dict[str, list[float]] = {}
        for heard, source, rssi in packets:
            if heard >= now - WINDOW:
                by_source.setdefault(source, []).append(rssi)
        return {source: statistics.median(values) for source, values in by_source.items()}

    @callback
    def _tick(self, wall: datetime | None = None) -> None:
        now = monotonic()
        seconds, self._last_tick = now - self._last_tick, now
        if self.radio is None:
            return
        receivers = self.receivers_now()
        if not {source for source, _, _ in receivers} <= set(self.places):
            # A receiver new to the locating (a proxy that connected late): placed and modelled.
            self._schedule_rebuild()
        listening = [source for source, _, idle in receivers if idle <= LISTENING]
        moment = _Moment(now, seconds, listening, self._presence_weights())
        for device, settings in self._settings["devices"].items():
            located = self.located.setdefault(device, Located())
            readings = self._readings(device, now)
            changed = self._step(device, located, readings, moment)
            left = self._left_behind(settings, located)
            if left != located.left_behind:
                located.left_behind = left
                changed = True
            # The sensors are written when the room changes, not at each reading (the history).
            if changed:
                async_dispatcher_send(self._hass, SIGNAL_LOCATED, device)
        self._forget_old_addresses(now)
        if self._learned_changed and now - self._model_built >= RELEARN:
            self._build_model()

    def _step(self, device: str, located: Located, readings: Readings, moment: _Moment) -> bool:
        """Weigh what was heard of a device lately; return whether its room changed.

        Sure of its room, its loudness is learned, and the room too when a presence sensor there
        agrees; a device not heard for long is no longer located.
        """
        now = moment.now
        filt = self._filters.get(device)
        if not readings or filt is None:
            last = self._last_heard.get(device)
            if (last is None or now - last > LOST) and (located.room or located.receivers):
                if filt is not None:
                    filt.reset()
                located.room, located.since, located.confidence = None, None, 0.0
                located.receivers = 0
                return True
            return False
        # The time since it was last weighed passes for the filter, unheard seconds too.
        filt.predict(now - self._stepped.get(device, now - moment.seconds))
        self._stepped[device] = now
        offset = self._offsets.get(device, self._beacon_power.get(device, 0.0))
        heard = self.model.heard(readings, moment.listening, offset)
        # Presence sensors say someone is in a room: of weight for what people carry, not for
        # keys left on a shelf.
        carried = self._settings["devices"].get(device, {}).get("kind") != "thing"
        weights = moment.weights if carried else {}
        room = filt.update({r: h.score for r, h in heard.items()}, weights)
        fit = heard.get(room) if room is not None else None
        if fit is not None and room is not None and filt.confidence >= SURE_TO_LEARN:
            self._offsets[device] = offset + OFFSET_RATE * (fit.offset - offset)
            self._schedule_save()
            if self._settings.get("learn", True) and weights.get(room, 1.0) >= PRESENCE_ON:
                self._learn(room, readings, fit.offset, PRESENCE_LEARN)
        if (teaching := self._teaching.get(device)) is not None:
            teaching.readings.append(readings)
        changed = room != located.room
        if changed:
            located.since = dt_util.utcnow() if room is not None else None
        located.room = room
        located.confidence = filt.confidence
        located.receivers = len(readings)
        located.last_seen = dt_util.utcnow()
        return changed

    def _learn(self, room: str, readings: Readings, offset: float, weight: float) -> None:
        for source, value in readings.items():
            self._learned.setdefault((room, source), Learned()).add(value - offset, weight)
        self._save_learned()

    def _left_behind(self, settings: dict[str, Any], located: Located) -> bool:
        """Whether a device is heard at home while its owner has been away for a while."""
        person = settings.get("person")
        if not isinstance(person, str):
            return False
        state = self._hass.states.get(person)
        # Not known to be away (unknown after a restart, unavailable): not left behind.
        if state is None or state.state in ("home", "unknown", "unavailable"):
            self._away_since.pop(person, None)
            return False
        # Away since they left home: going from one zone to another is still away.
        since = self._away_since.setdefault(person, state.last_changed)
        if not located.room:
            return False
        return (dt_util.utcnow() - since).total_seconds() >= LEFT_BEHIND_AFTER

    def _forget_old_addresses(self, now: float) -> None:
        for address, (_, unfollow, last) in list(self._addresses.items()):
            if now - last > ADDRESS_KEPT:
                unfollow()
                del self._addresses[address]

    # Teaching, and what the settings show.

    async def async_teach(self, device: str, room: str, seconds: float) -> dict[str, int]:
        """Listen to a device held in a room for `seconds`, and learn the room from it.

        Return how many readings were taken and by how many receivers.
        """
        teaching = _Teaching(room)
        self._teaching[device] = teaching
        try:
            await asyncio.sleep(seconds)
        finally:
            if self._teaching.get(device) is teaching:
                del self._teaching[device]
        if self._stopped:
            # DomoTwin was unloaded meanwhile: its stores belong to another start, or to none.
            return {"readings": 0, "receivers": 0}
        offset = self._offsets.get(device, self._beacon_power.get(device, 0.0))
        sources: set[str] = set()
        for readings in teaching.readings:
            self._learn(room, readings, offset, 1.0)
            sources.update(readings)
        if teaching.readings:
            self._build_model()
            if (filt := self._filters.get(device)) is not None:
                filt.chances = {r: (1.0 if r == room else 0.0) for r in filt.chances}
                filt.update({})
        return {"readings": len(teaching.readings), "receivers": len(sources)}

    def learned_rooms(self) -> dict[str, float]:
        """How much was learned in each room (readings, all receivers together)."""
        found: dict[str, float] = {}
        for (room, _), learned in self._learned.items():
            found[room] = found.get(room, 0.0) + learned.weight
        return {room: round(weight, 1) for room, weight in found.items()}

    def heard(self) -> dict[str, dict[str, dict[str, float]]]:
        """What each receiver learned in each room (D-062): `{room: {source: {signal, readings}}}`.

        The signal is the mean of what it heard, each device's own loudness taken away: what it
        hears of a phone as the model has it (`AT_1M`).
        """
        found: dict[str, dict[str, dict[str, float]]] = {}
        for (room, source), learned in self._learned.items():
            found.setdefault(room, {})[source] = {
                "signal": round(learned.mean, 1),
                "readings": round(learned.weight, 1),
            }
        return found

    def place_of(self, source: str) -> dict[str, Any] | None:
        """Where a receiver stands (D-062): its storey's id, its point (cm) and height, or None."""
        spot = self.places.get(source)
        if spot is None or not 0 <= spot.storey < len(self.home.storey_ids):
            return None
        return {
            "storey": self.home.storey_ids[spot.storey],
            "at": [round(spot.x, 1), round(spot.y, 1)],
            "z": round(spot.z, 1),
        }

    def status(self) -> str:
        """`no_bluetooth`, `no_receivers` or `ready`."""
        if self.radio is None:
            return "no_bluetooth"
        return "ready" if self.receivers_now() else "no_receivers"

    def candidates(self) -> list[dict[str, Any]]:
        """Devices that may be followed: Private BLE Device keys, iBeacons and tags heard now.

        A key's device is listed by its entry's title (the key never leaves the server); a tag by
        its fixed address (public or static; never a private one that changes), the loudest first.
        """
        followed = self._settings["devices"].values()
        keys = {d.get("match", {}).get("key") for d in followed}
        beacons = {
            (b["uuid"], b["major"], b["minor"])
            for d in followed
            if isinstance(b := d.get("match", {}).get("beacon"), dict)
        }
        addresses = {d.get("match", {}).get("address") for d in followed}
        found: list[dict[str, Any]] = [
            {"match": {"key": entry.entry_id}, "name": entry.title}
            for entry in self._hass.config_entries.async_entries(PRIVATE_BLE)
            if entry.entry_id not in keys
        ]
        heard: list[tuple[float, dict[str, Any]]] = []
        seen_beacons: set[tuple[str, int, int]] = set()
        for advert in self.radio.seen() if self.radio is not None else []:
            beacon = beacon_of(advert.manufacturer or {})
            if beacon is not None:
                key = (beacon.uuid, beacon.major, beacon.minor)
                if key in beacons or key in seen_beacons:
                    continue
                seen_beacons.add(key)
                match: dict[str, Any] = {
                    "beacon": {"uuid": beacon.uuid, "major": beacon.major, "minor": beacon.minor}
                }
                heard.append((advert.rssi, {"match": match, "name": advert.name or "iBeacon"}))
            elif advert.name and advert.address not in addresses and not resolvable(advert.address):
                match = {"address": advert.address}
                heard.append((advert.rssi, {"match": match, "name": advert.name}))
        heard.sort(key=lambda item: -item[0])
        found += [{**item, "rssi": round(rssi)} for rssi, item in heard]
        return found[:MAX_CANDIDATES]

    def sensor_of(self, device: str) -> str:
        """A followed device's room sensor: its entity id now, or the one it is given."""
        registry = er.async_get(self._hass)
        unique_id = located_unique_id(self.entry_id, device)
        entity = registry.async_get_entity_id("sensor", DOMAIN, unique_id)
        return entity or f"sensor.{DOMAIN}_{device}_bluetooth"

    def owned_by(self, person: str) -> list[str]:
        """The followed phones and watches of a person: what places them."""
        return [
            device
            for device, settings in self._settings["devices"].items()
            if settings.get("person") == person and settings.get("kind") != "thing"
        ]
