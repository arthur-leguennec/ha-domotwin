"""Compatibility with the supported Home Assistant versions."""

from __future__ import annotations

from homeassistant.helpers import device_registry as dr

# Home Assistant 2026.10 replaced voluptuous with probatio, which has the same API.
try:
    import probatio as vol
except ImportError:  # Home Assistant before 2026.10
    import voluptuous as vol  # type: ignore[no-redef]

__all__ = ["device_of", "vol"]


def device_of(
    devices: dr.DeviceRegistry, identifier: tuple[str, str], config_entry_id: str
) -> dr.DeviceEntry | None:
    """The device with this identifier of a config entry.

    Identifiers are unique within a config entry only since Home Assistant 2026.x, which looks
    them up with the entry; before, they were unique and looked up alone.
    """
    by_identifier = getattr(devices, "async_get_device_by_identifier", None)
    if by_identifier is not None:
        found: dr.DeviceEntry | None = by_identifier(identifier, config_entry_id)
        return found
    return devices.async_get_device({identifier})
