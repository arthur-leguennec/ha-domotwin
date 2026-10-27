"""The home's Wi-Fi for guests (`docs/DECISIONS.md`, D-060).

An administrator gives the network once: its name, its password, its kind (WPA, WEP or open) and
whether it is hidden; or the image entity in which a router gives its guest network's QR code
(FRITZ!Box, UniFi). It is kept in a store of its own (.storage/domotwin.wifi), private: never in
the plan, the logs, the diagnostics or an export. Administrators read and change it; the screens an
administrator chose (a card's `screen`, D-029) show it, to whoever stands before them.
"""

from __future__ import annotations

import string
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .compat import vol
from .const import (
    MAX_WIFI_SCREENS,
    SCREEN_NAME,
    SIGNAL_UPDATED,
    WIFI_STORAGE_KEY,
    WIFI_STORAGE_VERSION,
)

#: The kinds of network a phone joins from a QR code.
SECURITIES = ("WPA", "WEP", "nopass")
#: The longest network name Wi-Fi allows, in bytes.
MAX_NAME_BYTES = 32
HEX = set(string.hexdigits)


def _screen(value: Any) -> str:
    """A screen's name, as a card's `screen` takes it (`domotwin.show` reads it the same way)."""
    text = cv.string(value).strip()
    if not SCREEN_NAME.fullmatch(text):
        raise vol.Invalid("a screen's name is made of letters, digits, _ and -")
    return text


WIFI_SCHEMA = vol.Schema(
    {
        vol.Optional("name"): cv.string,
        vol.Optional("password"): cv.string,
        vol.Required("security"): vol.In(SECURITIES),
        vol.Optional("hidden", default=False): bool,
        vol.Optional("image"): cv.entity_domain("image"),
        vol.Optional("screens", default=list): vol.All([_screen], vol.Length(max=MAX_WIFI_SCREENS)),
    }
)


class WifiError(Exception):
    """A change refused, with a code the frontend translates."""

    def __init__(self, code: str) -> None:
        """Keep the code."""
        super().__init__(code)
        self.code = code


def name_error(name: str) -> str | None:
    """Why a network's name cannot be joined, if it cannot: Wi-Fi takes 1 to 32 bytes."""
    if not name:
        return "no_name"
    return "long_name" if len(name.encode()) > MAX_NAME_BYTES else None


def password_error(security: str, password: str) -> str | None:
    """Why a password does not suit its kind of network, if it does not."""
    printable = password.isascii() and password.isprintable()
    hexadecimal = set(password) <= HEX
    if security == "WEP":
        fits = (len(password) in (5, 13) and printable) or (
            len(password) in (10, 26) and hexadecimal
        )
        return None if fits else "bad_wep"
    if security == "WPA":
        fits = (8 <= len(password) <= 63 and printable) or (len(password) == 64 and hexadecimal)
        return None if fits else "bad_wpa"
    return None


def _read(raw: Any) -> dict[str, Any] | None:
    """The network as stored, nothing when it cannot be read."""
    if not isinstance(raw, dict):
        return None
    try:
        wifi: dict[str, Any] = WIFI_SCHEMA(raw)
    except vol.Invalid:
        return None
    return wifi if "name" in wifi or "image" in wifi else None


class Wifi:
    """The home's Wi-Fi, kept in its own private store."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store; nothing is read before `async_load`."""
        self._hass = hass
        # Changes told to the screens (`domotwin/subscribe`, kind `wifi`), never what changed.
        self._revision = 0
        self._store: Store[dict[str, Any]] = Store(
            hass, WIFI_STORAGE_VERSION, WIFI_STORAGE_KEY, private=True
        )
        self._wifi: dict[str, Any] | None = None

    async def async_load(self) -> None:
        """Read the store."""
        stored = await self._store.async_load()
        self._wifi = _read(stored.get("wifi") if isinstance(stored, dict) else None)

    @property
    def is_set(self) -> bool:
        """Whether a network was given."""
        return self._wifi is not None

    @property
    def from_image(self) -> bool:
        """Whether the router's own QR code is shown."""
        return self._wifi is not None and "image" in self._wifi

    def get(self, *, admin: bool, screen: str = "", password: bool = False) -> dict[str, Any]:
        """What the asker may see of the network.

        All of it for an administrator; what draws the code on a screen an administrator chose
        (its name matched whatever the case, as `domotwin.show` matches it); elsewhere only
        whether there is one. The password only when asked for: when the dialog opens.
        """
        wifi = self._wifi
        if wifi is None:
            return {"set": False, "shown": False}
        chosen = {name.casefold() for name in wifi["screens"]}
        shown = admin or (bool(screen) and screen.casefold() in chosen)
        if not shown:
            return {"set": True, "shown": False}
        result: dict[str, Any] = {
            "set": True,
            "shown": True,
            "security": wifi["security"],
            "hidden": wifi["hidden"],
        }
        for key in ("name", "password", "image") if password else ("name", "image"):
            if key in wifi:
                result[key] = wifi[key]
        if admin:
            result["screens"] = list(wifi["screens"])
        return result

    async def async_save(self, change: dict[str, Any]) -> dict[str, Any]:
        """Sets the network; a password not given is the one kept (the same network's)."""
        wifi = WIFI_SCHEMA(change)
        if "image" not in wifi:
            if code := name_error(wifi.get("name", "")):
                raise WifiError(code)
            if "password" not in wifi:
                kept = self._wifi or {}
                same = kept.get("name") == wifi["name"] and kept.get("security") == wifi["security"]
                if same and "password" in kept:
                    wifi["password"] = kept["password"]
                else:
                    wifi["password"] = ""
            if wifi["security"] == "nopass":
                wifi.pop("password", None)
            elif code := password_error(wifi["security"], wifi["password"]):
                raise WifiError(code)
        else:
            wifi.pop("password", None)
        self._wifi = wifi
        await self._store.async_save({"wifi": wifi})
        self._changed()
        return self.get(admin=True, password=True)

    async def async_clear(self) -> None:
        """Forgets the network."""
        self._wifi = None
        await self._store.async_save({"wifi": None})
        self._changed()

    async def async_remove(self) -> None:
        """Delete the store (the integration removed)."""
        await self._store.async_remove()

    def _changed(self) -> None:
        self._revision += 1
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, "wifi", self._revision)


# The websocket commands: any signed-in user reads what they may see; administrators change it.


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the home's Wi-Fi (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_wifi_get)
    websocket_api.async_register_command(hass, ws_wifi_save)
    websocket_api.async_register_command(hass, ws_wifi_clear)


def _wifi(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> Wifi | None:
    from .data import WIFI_KEY  # noqa: PLC0415 (data imports this module)

    wifi = hass.data.get(WIFI_KEY)
    if wifi is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return wifi


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/wifi/get",
        vol.Optional("screen", default=""): str,
        vol.Optional("password", default=False): bool,
    }
)
@callback
def ws_wifi_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The home's Wi-Fi, as the asker may see it (see `Wifi.get`)."""
    if (wifi := _wifi(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"],
        wifi.get(admin=connection.user.is_admin, screen=msg["screen"], password=msg["password"]),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/wifi/save", vol.Required("wifi"): dict}
)
@websocket_api.async_response
async def ws_wifi_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Sets the home's Wi-Fi; answers it."""
    if (wifi := _wifi(hass, connection, msg)) is None:
        return
    try:
        result = await wifi.async_save(msg["wifi"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    except WifiError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "domotwin/wifi/clear"})
@websocket_api.async_response
async def ws_wifi_clear(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Forgets the home's Wi-Fi."""
    if (wifi := _wifi(hass, connection, msg)) is None:
        return
    await wifi.async_clear()
    connection.send_result(msg["id"], {"set": False, "shown": False})
