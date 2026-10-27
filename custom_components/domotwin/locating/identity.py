"""Which device an advertisement comes from (docs/DECISIONS.md, D-035).

A device is known by a fixed address (a tag), by its identity key (a phone or a watch that changes
its address every few minutes: the key of a Private BLE Device entry resolves its addresses), or by
the iBeacon it sends (the companion app's transmitter, whatever address it sends from). Pure.
"""

from __future__ import annotations

import base64
import binascii
from collections import OrderedDict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import re
from typing import Final

from bluetooth_data_tools import get_cipher_for_irk, resolve_private_address
from cryptography.hazmat.primitives.ciphers import Cipher, modes

APPLE: Final = 0x004C
IBEACON: Final = b"\x02\x15"
ADDRESS: Final = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
UUID: Final = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# Addresses already looked at, at most.
REMEMBERED: Final = 4096


# An identity key's 32 hex digits, once the spaces, colons or dashes between them are taken out.
HEX_KEY: Final = re.compile(r"[0-9a-fA-F]{32}")


def parse_key(text: str) -> bytes | None:
    """An identity key (IRK) as the tools that read one write it (D-075), or None.

    Hex (irk-capture, maybe split by spaces, colons or dashes), `irk:` and hex (ESPresense's
    Enroll), or a Mac's base64, whose bytes come the other way round (as Home Assistant's Private
    BLE Device reads it). Sixteen bytes, never all the same.
    """
    written = re.sub(r"\s", "", text)
    if written[:4].lower() == "irk:":
        written = written[4:]
    digits = re.sub(r"[:\-]", "", written)
    key: bytes | None = None
    if HEX_KEY.fullmatch(digits):
        key = bytes.fromhex(digits)
    elif written.endswith("="):
        try:
            decoded = base64.b64decode(written, validate=True)
        except (binascii.Error, ValueError):
            return None
        key = bytes(reversed(decoded)) if len(decoded) == 16 else None
    if key is None or len(set(key)) == 1:
        return None
    return key


def resolvable(address: str) -> bool:
    """Whether an address is a resolvable private one (its two top bits 01)."""
    return ADDRESS.fullmatch(address) is not None and int(address[:2], 16) & 0xC0 == 0x40


def resolves(key: bytes, address: str) -> bool:
    """Whether a resolvable private address was made with an identity key.

    The address's lower half is the AES-128 of its upper half under the key (Bluetooth Core,
    vol. 3, part H, 2.2.2: the `ah` function), checked by the helper Home Assistant's Private BLE
    Device uses.
    """
    return (
        len(key) == 16
        and resolvable(address)
        and resolve_private_address(get_cipher_for_irk(key), address)
    )


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
        # The keys' ciphers, made once.
        self._keys: list[tuple[Cipher[modes.Mode], str]] = []
        self._beacons: dict[tuple[str, int, int], str] = {}
        for match in matches:
            if match.address is not None:
                self._by_address[match.address.upper()] = match.device
            if match.key is not None and len(match.key) == 16:
                self._keys.append((get_cipher_for_irk(match.key), match.device))
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
            found = next(
                (
                    device
                    for cipher, device in self._keys
                    if resolve_private_address(cipher, address)
                ),
                None,
            )
        self._seen[address] = found
        if len(self._seen) > REMEMBERED:
            self._seen.popitem(last=False)
        return found
