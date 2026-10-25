"""Which device an advertisement comes from (docs/DECISIONS.md, D-035).

A device is known by a fixed address (a tag), by its identity key (a phone or a watch that changes
its address every few minutes: the key of a Private BLE Device entry resolves its addresses), or by
the iBeacon it sends (the companion app's transmitter, whatever address it sends from). Pure.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import hmac
import re
from typing import Final

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

APPLE: Final = 0x004C
IBEACON: Final = b"\x02\x15"
ADDRESS: Final = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
UUID: Final = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# Addresses already looked at, at most.
REMEMBERED: Final = 4096


def resolvable(address: str) -> bool:
    """Whether an address is a resolvable private one (its two top bits 01)."""
    return ADDRESS.fullmatch(address) is not None and int(address[:2], 16) & 0xC0 == 0x40


def resolves(key: bytes, address: str) -> bool:
    """Whether a resolvable private address was made with an identity key.

    The address's lower half is the AES-128 of its upper half under the key (Bluetooth Core,
    vol. 3, part H, 2.2.2: the `ah` function).
    """
    if len(key) != 16 or not resolvable(address):
        return False
    raw = bytes.fromhex(address.replace(":", ""))
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()  # noqa: S305
    hashed = encryptor.update(b"\x00" * 13 + raw[:3]) + encryptor.finalize()
    return hmac.compare_digest(hashed[13:], raw[3:])


@dataclass(frozen=True)
class Beacon:
    """An iBeacon: its UUID, major and minor, and its loudness at a metre (dBm)."""

    uuid: str
    major: int
    minor: int
    power: int


def beacon_of(manufacturer: Mapping[int, bytes]) -> Beacon | None:
    """The iBeacon an advertisement sends, if it sends one."""
    data = manufacturer.get(APPLE)
    if data is None or len(data) < 23 or data[:2] != IBEACON:
        return None
    raw = data[2:18].hex()
    uuid = f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"
    power = data[22] - 256 if data[22] > 127 else data[22]
    return Beacon(
        uuid, int.from_bytes(data[18:20], "big"), int.from_bytes(data[20:22], "big"), power
    )


@dataclass(frozen=True)
class Match:
    """How a followed device is known: `address`, `key` (16 bytes) or `beacon`.

    A beacon is its UUID, major and minor.
    """

    device: str
    address: str | None = None
    key: bytes | None = None
    beacon: tuple[str, int, int] | None = None


class Matcher:
    """Finds the followed device an address belongs to, and remembers it."""

    def __init__(self, matches: Iterable[Match]) -> None:
        """Index the followed devices."""
        self._by_address: dict[str, str] = {}
        self._keys: list[tuple[bytes, str]] = []
        self._beacons: dict[tuple[str, int, int], str] = {}
        for match in matches:
            if match.address is not None:
                self._by_address[match.address.upper()] = match.device
            if match.key is not None:
                self._keys.append((match.key, match.device))
            if match.beacon is not None:
                self._beacons[match.beacon] = match.device
        # Addresses already looked at (None: no followed device), the oldest forgotten first.
        self._seen: OrderedDict[str, str | None] = OrderedDict()

    def device_of(self, address: str, manufacturer: Mapping[int, bytes]) -> str | None:
        """The followed device an advertisement comes from, if any.

        An iBeacon is read each time (a beacon may move to another address); a key is tried once
        an address.
        """
        address = address.upper()
        if (fixed := self._by_address.get(address)) is not None:
            return fixed
        if self._beacons and (beacon := beacon_of(manufacturer)) is not None:
            found = self._beacons.get((beacon.uuid, beacon.major, beacon.minor))
            if found is not None:
                return found
        if address in self._seen:
            self._seen.move_to_end(address)
            return self._seen[address]
        found = None
        if self._keys and resolvable(address):
            found = next((device for key, device in self._keys if resolves(key, address)), None)
        self._seen[address] = found
        if len(self._seen) > REMEMBERED:
            self._seen.popitem(last=False)
        return found
