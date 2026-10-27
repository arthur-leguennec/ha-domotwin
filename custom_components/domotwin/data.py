"""Typed keys of the data DomoTwin keeps in `hass.data`."""

from __future__ import annotations

from homeassistant.util.hass_dict import HassKey

from .choices import Choices
from .config_history import ConfigHistory
from .const import DOMAIN
from .garden import Garden
from .guests import Guests
from .locator import Locator
from .schedules import Scheduler
from .screens import Screens
from .storage import DomoTwinData
from .tracker import PeopleTracker
from .wifi import Wifi

DATA_KEY: HassKey[DomoTwinData] = HassKey(DOMAIN)
PEOPLE_KEY: HassKey[PeopleTracker] = HassKey(f"{DOMAIN}_people")
LOCATOR_KEY: HassKey[Locator] = HassKey(f"{DOMAIN}_locator")
SCHEDULER_KEY: HassKey[Scheduler] = HassKey(f"{DOMAIN}_scheduler")
CHOICES_KEY: HassKey[Choices] = HassKey(f"{DOMAIN}_choices")
WIFI_KEY: HassKey[Wifi] = HassKey(f"{DOMAIN}_wifi")
SCREENS_KEY: HassKey[Screens] = HassKey(f"{DOMAIN}_screens")
GARDEN_KEY: HassKey[Garden] = HassKey(f"{DOMAIN}_garden")
GUESTS_KEY: HassKey[Guests] = HassKey(f"{DOMAIN}_guests")
CONFIG_HISTORY_KEY: HassKey[ConfigHistory] = HassKey(f"{DOMAIN}_config_history")
STATIC_REGISTERED_KEY: HassKey[bool] = HassKey(f"{DOMAIN}_static_registered")
VIEWS_REGISTERED_KEY: HassKey[bool] = HassKey(f"{DOMAIN}_views_registered")
