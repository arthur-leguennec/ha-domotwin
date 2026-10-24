"""The `domotwin.show` service (docs/DECISIONS.md, D-029): what the screens show.

A request names a room or an element (by id or by name), a storey, a view, or several of them, and
optionally the screen (a card's `screen` option) that shows it; every DomoTwin view listening gets
it over `domotwin/subscribe` and finds the room in its plans.
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .compat import vol
from .const import DOMAIN, MAX_SCREEN_NAME, MAX_SHOW_TEXT, SERVICE_SHOW, SIGNAL_SHOW

SCREEN = re.compile(rf"^[A-Za-z0-9_-]{{1,{MAX_SCREEN_NAME}}}$")


def _text(value: Any) -> str:
    text = cv.string(value).strip()
    if not text or len(text) > MAX_SHOW_TEXT:
        raise vol.Invalid(f"expected 1 to {MAX_SHOW_TEXT} characters")
    return text


def _screen(value: Any) -> str:
    """A screen's name, or the empty string for every screen."""
    text = cv.string(value).strip()
    if text and not SCREEN.match(text):
        raise vol.Invalid("a screen's name is made of letters, digits, _ and -")
    return text


SHOW_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Optional("room"): _text,
            vol.Optional("element"): _text,
            vol.Optional("storey"): _text,
            vol.Optional("view"): _text,
            vol.Optional("screen", default=""): _screen,
        }
    ),
    cv.has_at_least_one_key("room", "element", "storey", "view"),
)


@callback
def async_register_services(hass: HomeAssistant) -> None:
    """Register `domotwin.show` (once, at integration setup)."""

    @callback
    def show(call: ServiceCall) -> None:
        request = {key: value for key, value in call.data.items() if value != ""}
        async_dispatcher_send(hass, SIGNAL_SHOW, request)

    hass.services.async_register(DOMAIN, SERVICE_SHOW, show, schema=SHOW_SCHEMA)
