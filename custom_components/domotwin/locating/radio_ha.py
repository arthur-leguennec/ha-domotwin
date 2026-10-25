"""Home Assistant's Bluetooth, as the locating hears it (docs/DECISIONS.md, D-035).

The receivers (the adapter, ESPHome proxies, Shelly devices) and what they hear. The only module
that touches `homeassistant.components.bluetooth`: imported when Bluetooth is set up, so that
DomoTwin runs without it. Every packet of a followed address is heard where Home Assistant offers it
(2026.x); before, the latest packet each receiver heard is read every second.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import timedelta
import logging
import time
from types import ModuleType
from typing import Any, Final, Protocol

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

_LOGGER = logging.getLogger(__name__)

# How often the latest packets are read where every packet is not heard.
POLL: Final = timedelta(seconds=1)


@dataclass(frozen=True)
class Receiver:
    """A receiver: its address (Home Assistant's `source`), name, and how long since it heard."""

    source: str
    name: str
    idle: float


@dataclass(frozen=True)
class Advert:
    """A packet heard: from which address, by which receiver, how loud, with what."""

    address: str
    source: str
    rssi: float
    name: str | None = None
    manufacturer: Mapping[int, bytes] | None = None
    time: float = 0.0


class Radio(Protocol):
    """What the locating needs of Bluetooth."""

    def receivers(self) -> list[Receiver]:
        """The receivers working now."""

    def watch(self, heard: Callable[[Advert], None]) -> Callable[[], None]:
        """Call `heard` for each new or changed advertisement of any address; return a stop."""

    def follow(self, address: str, heard: Callable[[Advert], None]) -> Callable[[], None]:
        """Call `heard` for each packet of an address, by each receiver; return a stop."""

    def seen(self) -> list[Advert]:
        """The latest advertisement of each address heard lately."""


def ha_radio(hass: HomeAssistant) -> Radio | None:
    """Home Assistant's Bluetooth, or None when it is not set up."""
    if "bluetooth" not in hass.config.components:
        return None
    try:
        from homeassistant.components import bluetooth  # noqa: PLC0415
    except ImportError:
        _LOGGER.warning("Bluetooth is set up but could not be loaded: no Bluetooth locating")
        return None
    return HaRadio(hass, bluetooth)


def _advert(info: Any) -> Advert:
    return Advert(
        address=str(info.address).upper(),
        source=str(info.source).upper(),
        rssi=float(info.rssi),
        name=info.name if isinstance(info.name, str) and info.name != info.address else None,
        manufacturer=dict(info.manufacturer_data or {}),
        time=float(getattr(info, "time", 0.0) or time.monotonic()),
    )


class HaRadio:
    """Home Assistant's Bluetooth (the module is handed in: tests hand in their own)."""

    def __init__(self, hass: HomeAssistant, bluetooth: ModuleType | Any) -> None:
        """Wrap the `bluetooth` component's functions."""
        self._hass = hass
        self._bluetooth = bluetooth
        # Where every packet is not heard: the addresses read every second, and what was read.
        self._polled: dict[str, list[Callable[[Advert], None]]] = {}
        self._last: dict[tuple[str, str], Any] = {}
        self._stop_polling: Callable[[], None] | None = None

    def _scanners(self) -> Iterable[Any]:
        current = getattr(self._bluetooth, "async_current_scanners", None)
        if current is not None:
            return list(current(self._hass))
        try:
            from habluetooth import get_manager  # noqa: PLC0415
        except ImportError:
            return []
        return list(get_manager().async_current_scanners())

    def receivers(self) -> list[Receiver]:
        """The receivers Home Assistant has now."""
        found: list[Receiver] = []
        for scanner in self._scanners():
            since = getattr(scanner, "time_since_last_detection", None)
            idle = float(since()) if callable(since) else 0.0
            source = str(scanner.source).upper()
            found.append(Receiver(source, str(getattr(scanner, "name", source)), idle))
        return found

    def watch(self, heard: Callable[[Advert], None]) -> Callable[[], None]:
        """Each new or changed advertisement of any address (those already known first)."""

        @callback
        def changed(info: Any, change: Any) -> None:
            heard(_advert(info))

        # Every advertisement, those that cannot be connected to too (beacons, tags, phones).
        stop: Callable[[], None] = self._bluetooth.async_register_callback(
            self._hass,
            changed,
            {"connectable": False},
            self._bluetooth.BluetoothScanningMode.PASSIVE,
        )
        return stop

    def follow(self, address: str, heard: Callable[[Advert], None]) -> Callable[[], None]:
        """Each packet of an address, by each receiver that hears it."""
        every = getattr(self._bluetooth, "async_register_advertisement_callback", None)
        if every is not None:

            @callback
            def packet(info: Any) -> None:
                heard(_advert(info))

            stop: Callable[[], None] = every(self._hass, packet, address)
            return stop
        self._polled.setdefault(address, []).append(heard)
        if self._stop_polling is None:
            self._stop_polling = async_track_time_interval(self._hass, self._poll, POLL)

        def unfollow() -> None:
            listeners = self._polled.get(address, [])
            if heard in listeners:
                listeners.remove(heard)
            if not listeners:
                self._polled.pop(address, None)
                self._last = {k: v for k, v in self._last.items() if k[0] != address}
            if not self._polled and self._stop_polling is not None:
                self._stop_polling()
                self._stop_polling = None

        return unfollow

    @callback
    def _poll(self, now: Any = None) -> None:
        """Read the latest packet each receiver heard of each address followed; tell the new."""
        for address, listeners in list(self._polled.items()):
            for found in self._bluetooth.async_scanner_devices_by_address(
                self._hass, address, connectable=False
            ):
                scanner, advertisement = found.scanner, found.advertisement
                source = str(scanner.source).upper()
                stamps = getattr(scanner, "discovered_device_timestamps", None)
                stamp = stamps.get(address) if isinstance(stamps, Mapping) else None
                mark = stamp if stamp is not None else id(advertisement)
                if self._last.get((address, source)) == mark:
                    continue
                self._last[address, source] = mark
                advert = Advert(
                    address=address,
                    source=source,
                    rssi=float(advertisement.rssi),
                    manufacturer=dict(advertisement.manufacturer_data or {}),
                    time=float(stamp) if stamp is not None else time.monotonic(),
                )
                for heard in list(listeners):
                    heard(advert)

    def seen(self) -> list[Advert]:
        """The latest advertisement of each address heard lately (from its loudest receiver)."""
        return [
            _advert(info)
            for info in self._bluetooth.async_discovered_service_info(self._hass, connectable=False)
        ]
