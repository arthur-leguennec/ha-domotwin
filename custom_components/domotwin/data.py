"""Typed keys of the data DomoTwin keeps in `hass.data`."""

from __future__ import annotations

from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN
from .storage import DomoTwinData

DATA_KEY: HassKey[DomoTwinData] = HassKey(DOMAIN)
STATIC_REGISTERED_KEY: HassKey[bool] = HassKey(f"{DOMAIN}_static_registered")
