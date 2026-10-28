"""The wall screens (`docs/DECISIONS.md`, D-076).

A screen is a device left on a wall, known by a name (a card's `screen`, D-029): the device names
itself one in DomoTwin's choices. Each screen's layout is kept here, in a store of its own
(.storage/domotwin.screens), so that an administrator sets it from any device and the screen
follows: the tab it opens on and its screen saver (after how long, the sensors that wake it, the
weather, a folder of photos from Home Assistant's media, at night dimmed). Every signed-in user
reads the layouts (a wall screen is often a shared account's); administrators change them.
Nothing in them is private: names, entity ids and a media folder's id.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .compat import vol
from .const import (
    MAX_MEDIA_ID,
    MAX_SAVER_MINUTES,
    MAX_SCREENS,
    MAX_WAKE_SENSORS,
    PHOTO_SECONDS,
    SCREEN_NAME,
    SCREENS_STORAGE_KEY,
    SCREENS_STORAGE_VERSION,
    SIGNAL_UPDATED,
    START_TABS,
)

#: Where Home Assistant's media sources begin.
MEDIA_SOURCE = "media-source://"


def _whole(value: Any) -> int:
    """A whole number, as given (not `true`, which Python takes for 1)."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise vol.Invalid("a whole number")
    return value


def _each_once(values: list[str]) -> list[str]:
    """Each sensor once, in the order given."""
    return list(dict.fromkeys(values))


def _media_folder(value: Any) -> str:
    """A folder of Home Assistant's media, by its id (`media-source://…`)."""
    text = cv.string(value)
    if not text.startswith(MEDIA_SOURCE) or len(text) > MAX_MEDIA_ID:
        raise vol.Invalid("a folder of Home Assistant's media")
    return text


SAVER_SCHEMA = vol.Schema(
    {
        # Minutes with nothing touched and no one moving before it comes; 0: it never comes.
        vol.Optional("after", default=0): vol.All(_whole, vol.Range(min=0, max=MAX_SAVER_MINUTES)),
        vol.Optional("wake", default=list): vol.All(
            [cv.entity_domain("binary_sensor")], _each_once, vol.Length(max=MAX_WAKE_SENSORS)
        ),
        vol.Optional("weather", default=True): bool,
        vol.Optional("photos"): _media_folder,
        vol.Optional("every", default=30): vol.All(
            _whole, vol.Range(min=PHOTO_SECONDS[0], max=PHOTO_SECONDS[1])
        ),
        vol.Optional("dim", default=True): bool,
    }
)

LAYOUT_SCHEMA = vol.Schema(
    {
        vol.Optional("start"): vol.In(START_TABS),
        vol.Optional("saver", default=dict): SAVER_SCHEMA,
    }
)


class ScreenError(Exception):
    """A change refused, with a code the frontend translates."""

    def __init__(self, code: str) -> None:
        """Keep the code."""
        super().__init__(code)
        self.code = code


def screen_name(value: Any) -> str:
    """A screen's name, as a card's `screen` takes it."""
    text = cv.string(value).strip()
    if not SCREEN_NAME.fullmatch(text):
        raise vol.Invalid("a screen's name is made of letters, digits, _ and -")
    return text


def _layout(raw: Any) -> dict[str, Any] | None:
    """A layout as stored, nothing when it cannot be read."""
    try:
        layout: dict[str, Any] = LAYOUT_SCHEMA(raw)
    except vol.Invalid:
        return None
    return layout


class Screens:
    """Every wall screen's layout, kept in its own store."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store; nothing is read before `async_load`."""
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, SCREENS_STORAGE_VERSION, SCREENS_STORAGE_KEY
        )
        self._screens: dict[str, dict[str, Any]] = {}
        # Changes told to the screens (`domotwin/subscribe`, kind `screens`).
        self._revision = 0

    async def async_load(self) -> None:
        """Read the store; what cannot be read is left out."""
        stored = await self._store.async_load()
        screens = stored.get("screens") if isinstance(stored, dict) else None
        for name, raw in (screens if isinstance(screens, dict) else {}).items():
            if len(self._screens) >= MAX_SCREENS:
                break
            if not isinstance(name, str) or not SCREEN_NAME.fullmatch(name):
                continue
            if self._key(name) is None and (layout := _layout(raw)) is not None:
                self._screens[name] = layout

    def get(self) -> dict[str, Any]:
        """Every screen's layout, by name, sorted."""
        return {
            "screens": {
                name: _copy(self._screens[name]) for name in sorted(self._screens, key=str.casefold)
            }
        }

    @property
    def count(self) -> int:
        """How many screens there are."""
        return len(self._screens)

    def with_photos(self) -> int:
        """How many screens show photos."""
        return sum(1 for layout in self._screens.values() if "photos" in layout["saver"])

    async def async_save(
        self, name: str, layout: dict[str, Any], *, new: bool = False
    ) -> dict[str, Any]:
        """Sets a screen's layout, or adds a screen (`new`); answers every screen.

        Names are matched whatever the case, as `domotwin.show` matches them, and kept as first
        spelled. A screen is not renamed: each device that is it keeps its name (D-076), and so
        do the cards, the Wi-Fi's screens and the automations that name it.
        """
        name = screen_name(name)
        read = _layout(layout)
        if read is None:
            raise ScreenError("invalid_screen")
        same = self._key(name)
        if new and same is not None:
            raise ScreenError("screen_exists")
        if same is None and len(self._screens) >= MAX_SCREENS:
            raise ScreenError("too_many_screens")
        self._screens[same or name] = read
        await self._async_save()
        return self.get()

    async def async_forget(self, name: str) -> dict[str, Any]:
        """Removes a screen (nothing when there is none); answers every screen."""
        if (key := self._key(name.strip())) is not None:
            del self._screens[key]
            await self._async_save()
        return self.get()

    async def async_remove(self) -> None:
        """Delete the store (the integration removed)."""
        await self._store.async_remove()

    def _key(self, name: str | None) -> str | None:
        """The name a screen is kept under, whatever the case."""
        if not name:
            return None
        wanted = name.casefold()
        return next((key for key in self._screens if key.casefold() == wanted), None)

    async def _async_save(self) -> None:
        await self._store.async_save({"screens": self._screens})
        self._revision += 1
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, "screens", self._revision)


def _copy(layout: dict[str, Any]) -> dict[str, Any]:
    copied = dict(layout)
    copied["saver"] = {**layout["saver"], "wake": list(layout["saver"]["wake"])}
    return copied


# The websocket commands: any signed-in user reads the layouts; administrators change them.


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the wall screens (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_screens_get)
    websocket_api.async_register_command(hass, ws_screens_save)
    websocket_api.async_register_command(hass, ws_screens_remove)


def _screens(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> Screens | None:
    from .data import SCREENS_KEY  # noqa: PLC0415 (data imports this module)

    screens = hass.data.get(SCREENS_KEY)
    if screens is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return screens


@websocket_api.websocket_command({vol.Required("type"): "domotwin/screens/get"})
@callback
def ws_screens_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Every wall screen's layout: `{"screens": {name: layout}}`."""
    if (screens := _screens(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], screens.get())


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/screens/save",
        vol.Required("name"): str,
        vol.Required("layout"): dict,
        vol.Optional("new", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_screens_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Sets a screen's layout, or adds one (`new`); answers every screen. Admins only."""
    if (screens := _screens(hass, connection, msg)) is None:
        return
    try:
        result = await screens.async_save(msg["name"], msg["layout"], new=msg["new"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_screen", str(err))
        return
    except ScreenError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/screens/remove", vol.Required("name"): str}
)
@websocket_api.async_response
async def ws_screens_remove(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Removes a screen; answers every screen. Admins only."""
    if (screens := _screens(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], await screens.async_forget(msg["name"]))
