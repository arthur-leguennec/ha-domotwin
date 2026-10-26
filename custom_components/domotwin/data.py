"""Typed keys of the data DomoTwin keeps in `hass.data`."""

from __future__ import annotations

from homeassistant.util.hass_dict import HassKey

from .choices import Choices
from .const import DOMAIN
from .history import ConfigHistory
from .locator import Locator
from .schedules import Scheduler
from .storage import DomoTwinData
from .tracker import PeopleTracker

DATA_KEY: HassKey[DomoTwinData] = HassKey(DOMAIN)
PEOPLE_KEY: HassKey[PeopleTracker] = HassKey(f"{DOMAIN}_people")
LOCATOR_KEY: HassKey[Locator] = HassKey(f"{DOMAIN}_locator")
SCHEDULER_KEY: HassKey[Scheduler] = HassKey(f"{DOMAIN}_scheduler")
CHOICES_KEY: HassKey[Choices] = HassKey(f"{DOMAIN}_choices")
HISTORY_KEY: HassKey[ConfigHistory] = HassKey(f"{DOMAIN}_history")
STATIC_REGISTERED_KEY: HassKey[bool] = HassKey(f"{DOMAIN}_static_registered")
VIEWS_REGISTERED_KEY: HassKey[bool] = HassKey(f"{DOMAIN}_views_registered")
