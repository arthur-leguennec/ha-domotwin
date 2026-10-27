"""The radios the weekly report names (`docs/DECISIONS.md`, D-070).

The Zigbee devices of ZHA that reach the coordinator only through a weak link, or not at all, by the
same rules as the network map's analysis (`domotwin_core::network`, D-031, D-043), read from what
`zha/devices` answers (ZHA's own `zha_device_info`): a link is what either end's neighbour table
reports, of the lower quality reported; a device's way to the coordinator is the path whose weakest
link is the best (a link of unknown quality counts as fair), and no device that is not heard from
relays. Only `zha_radios` reads Home Assistant; the rest is pure.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, tzinfo
import logging
import math
from typing import Any, Final

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

#: A link of at least this LQI is fair, below it weak (`domotwin_core::network::FAIR_LQI`).
FAIR_LQI: Final = 80
#: A device not heard from for this long is not counted on (`STALE_AFTER`).
STALE_AFTER: Final = timedelta(hours=24)
#: Devices read at most (`MAX_DEVICES`), and neighbours of each.
MAX_DEVICES: Final = 1_000
MAX_NEIGHBOURS: Final = 128


@dataclass
class Radio:
    """A device of the mesh, as the report needs it."""

    id: str
    name: str
    coordinator: bool
    #: Its Home Assistant device (its registry id).
    device: str | None
    available: bool
    #: When it was last heard from, when ZHA says it.
    seen: datetime | None
    neighbours: list[tuple[str, int | None]] = field(default_factory=list)


@dataclass(frozen=True)
class Weak:
    """A device reaching the coordinator through a weak link, or not at all (`lqi` None).

    `lqi` is the weakest link of its best way, `hops` how many links that way has.
    """

    radio: Radio
    lqi: int | None
    hops: int | None


def _lqi(value: Any) -> int | None:
    """An LQI from ZHA, which gives a neighbour's as a decimal string."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(min(max(number, 0.0), 255.0))


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def read_radio(raw: Any, zone: tzinfo | None = None) -> Radio | None:
    """A device of ZHA's `zha_device_info`; None without an address."""
    if not isinstance(raw, Mapping) or (ieee := _text(raw.get("ieee"))) is None:
        return None
    neighbours: list[tuple[str, int | None]] = []
    listed = raw.get("neighbors")
    for entry in (listed if isinstance(listed, list) else [])[:MAX_NEIGHBOURS]:
        if not isinstance(entry, Mapping) or (other := _text(entry.get("ieee"))) is None:
            continue
        # A child that left is no link any more.
        if entry.get("relationship") == "PreviousChild":
            continue
        neighbours.append((other.lower(), _lqi(entry.get("lqi"))))
    seen = raw.get("last_seen")
    when: datetime | None = None
    if isinstance(seen, str):
        parsed = dt_util.parse_datetime(seen)
        if parsed is not None:
            # ZHA writes the server's local time without its zone.
            when = parsed if parsed.tzinfo else parsed.replace(tzinfo=zone or dt_util.UTC)
    elif isinstance(seen, datetime):
        when = seen
    return Radio(
        id=ieee.lower(),
        name=_text(raw.get("user_given_name")) or _text(raw.get("name")) or ieee,
        coordinator=raw.get("device_type") == "Coordinator",
        device=_text(raw.get("device_reg_id")),
        available=raw.get("available") is not False,
        seen=when,
        neighbours=neighbours,
    )


def _stale(radio: Radio, now: datetime) -> bool:
    return not radio.available or (radio.seen is not None and now - radio.seen > STALE_AFTER)


def weak_radios(radios: Iterable[Radio], now: datetime) -> list[Weak]:
    """The devices heard from whose best way to the coordinator is weak, or that have none.

    Nothing without a coordinator: the mesh cannot be read then. Devices not heard from are left
    out (the report names them among the devices unavailable).
    """
    devices: dict[str, Radio] = {}
    for radio in radios:
        if len(devices) >= MAX_DEVICES:
            break
        devices.setdefault(radio.id, radio)
    start = next((r.id for r in devices.values() if r.coordinator), None)
    if start is None:
        return []
    routes = _widest(start, devices, _adjacent(devices), now)
    found: list[Weak] = []
    for radio in devices.values():
        if radio.id == start or _stale(radio, now):
            continue
        route = routes.get(radio.id)
        if route is None:
            found.append(Weak(radio, None, None))
        elif route[0] < FAIR_LQI:
            found.append(Weak(radio, route[0], route[1]))
    found.sort(key=lambda weak: (weak.lqi is not None, weak.lqi or 0, weak.radio.name))
    return found


def _adjacent(devices: Mapping[str, Radio]) -> dict[str, list[tuple[str, int | None]]]:
    """Each device's links: the other end, and the link's LQI.

    Both ends may report a link: one link, of the lower quality reported.
    """
    links: dict[tuple[str, str], int | None] = {}
    for radio in devices.values():
        for other, lqi in radio.neighbours:
            if other == radio.id or other not in devices:
                continue
            key = (min(radio.id, other), max(radio.id, other))
            if key not in links:
                links[key] = lqi
            elif lqi is not None:
                kept = links[key]
                links[key] = lqi if kept is None else min(kept, lqi)
    adjacent: dict[str, list[tuple[str, int | None]]] = {d: [] for d in devices}
    for (a, b), lqi in links.items():
        adjacent[a].append((b, lqi))
        adjacent[b].append((a, lqi))
    return adjacent


def _widest(
    start: str,
    devices: Mapping[str, Radio],
    adjacent: Mapping[str, list[tuple[str, int | None]]],
    now: datetime,
) -> dict[str, tuple[int, int]]:
    """Each device's best way to the coordinator: (its weakest LQI, its hops).

    The widest path, then the shortest of those. The coordinator's own is (255, 0).
    """
    routes: dict[str, tuple[int, int]] = {start: (255, 0)}
    done: set[str] = set()

    def better(x: tuple[int, int], y: tuple[int, int]) -> bool:
        return x[0] > y[0] or (x[0] == y[0] and x[1] < y[1])

    while True:
        open_ = [(d, r) for d, r in routes.items() if d not in done]
        if not open_:
            break
        current, route = open_[0]
        for device, candidate in open_[1:]:
            if better(candidate, route):
                current, route = device, candidate
        done.add(current)
        # A device not heard from keeps its last way, but no one's messages go through it.
        if current != start and _stale(devices[current], now):
            continue
        for other, lqi in adjacent[current]:
            if other in done:
                continue
            weight = FAIR_LQI if lqi is None else lqi
            candidate = (min(route[0], weight), route[1] + 1)
            if other not in routes or better(candidate, routes[other]):
                routes[other] = candidate
    return routes


def zha_radios(hass: HomeAssistant) -> list[Radio] | None:
    """The devices of ZHA's mesh, read from ZHA as `zha/devices` answers.

    None when ZHA is not set up, or does not answer as it did when DomoTwin was written: the report
    then says nothing of the radios (the network map still reads them).
    """
    if "zha" not in hass.config.components:
        return None
    try:
        from homeassistant.components.zha.helpers import (  # noqa: PLC0415 (ZHA is optional)
            get_zha_gateway_proxy,
        )

        proxy: Any = get_zha_gateway_proxy(hass)
        infos: list[Any] = [device.zha_device_info for device in proxy.device_proxies.values()]
    except Exception:
        _LOGGER.debug("ZHA's devices cannot be read", exc_info=True)
        return None
    zone = dt_util.get_default_time_zone()
    return [radio for raw in infos if (radio := read_radio(raw, zone)) is not None]
