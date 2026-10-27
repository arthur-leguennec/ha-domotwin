"""Each user's own choices (`docs/DECISIONS.md`, D-055).

A user's favourites (starred in the Rooms tab, shown on the Home tab), the tab DomoTwin opens on,
the cards of their Home tab (an agenda, a list) and its shortcuts (D-084): kept in a store of
their own (.storage/domotwin.users) by user id, so that they follow the user from one device to
another. A user reads and changes only their own; a user removed from Home Assistant is forgotten
when DomoTwin starts.
"""

from __future__ import annotations

import copy
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store

from .compat import vol
from .const import (
    CHOICES_STORAGE_KEY,
    CHOICES_STORAGE_VERSION,
    MAX_CALENDARS,
    MAX_FAVOURITES,
    MAX_HOME_CARDS,
    MAX_LISTED,
    MAX_SHORTCUT_NAME,
    MAX_SHORTCUTS,
    MAX_STEPS,
    START_TABS,
)

#: DomoTwin's summaries (D-061), which a Home tab may hold too.
SUMMARIES = ("people", "network", "automations", "upkeep", "robots")

#: The cards a Home tab may hold (D-055), as Home Assistant's own cards take them.
CARD_SCHEMA = vol.Any(
    vol.Schema(
        {
            vol.Required("type"): "calendar",
            vol.Required("entities"): vol.All(
                [cv.entity_domain("calendar")], vol.Length(min=1, max=MAX_CALENDARS)
            ),
        }
    ),
    vol.Schema(
        {vol.Required("type"): "todo-list", vol.Required("entity"): cv.entity_domain("todo")}
    ),
    vol.Schema({vol.Required("type"): "summary", vol.Required("summary"): vol.In(SUMMARIES)}),
)
CARDS_SCHEMA = vol.All([CARD_SCHEMA], vol.Length(max=MAX_HOME_CARDS))

#: What a shortcut's step acts on, and what it may do to it (the frontend's `STEP_DOES`).
STEP_DOES: dict[str, tuple[str, ...]] = {
    "lights": ("off", "on", "toggle"),
    "covers": ("close", "open", "position"),
    "locks": ("lock", "unlock"),
    "climate": ("eco", "temperature", "heat", "off"),
    "media": ("pause", "off"),
    "vacuum": ("start", "dock"),
    "alarm": ("arm_away", "arm_home", "arm_night"),
    "run": ("run",),
}

#: The icons a shortcut may have (the frontend's `SHORTCUT_ICONS`).
SHORTCUT_ICONS = (
    "lights_off",
    "lights_on",
    "blinds_closed",
    "blinds_open",
    "lock",
    "thermostat",
    "music_off",
    "robot",
    "alarm",
    "play",
    "moon",
    "leave",
    "car",
    "battery",
    "power",
    "home",
)

_ENTITIES = vol.All([cv.entity_id], vol.Length(max=MAX_LISTED))
_PLACE = vol.All(str, vol.Length(min=1, max=64))


def _step_does(step: dict[str, Any]) -> dict[str, Any]:
    """A step does what its kind may; a scene or a script to run is chosen, never every one."""
    if step["do"] not in STEP_DOES[step["kind"]]:
        raise vol.Invalid(f"a {step['kind']} step cannot {step['do']}")
    if step["kind"] == "run" and not step.get("entities"):
        raise vol.Invalid("a run step lists what it runs")
    return step


STEP_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Required("kind"): vol.In(tuple(STEP_DOES)),
            vol.Required("do"): str,
            vol.Optional("floor"): _PLACE,
            vol.Optional("area"): _PLACE,
            vol.Optional("entities"): _ENTITIES,
            vol.Optional("except"): _ENTITIES,
            vol.Optional("value"): vol.All(vol.Coerce(float), vol.Range(min=-50, max=100)),
        }
    ),
    _step_does,
)


def _shortcut_does(shortcut: dict[str, Any]) -> dict[str, Any]:
    """A shortcut does something, or shows something."""
    if not shortcut["steps"] and "show" not in shortcut:
        raise vol.Invalid("a shortcut does or shows something")
    return shortcut


SHORTCUT_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Required("id"): vol.All(str, vol.Match(r"^[a-z0-9]{1,12}$")),
            vol.Required("name"): vol.All(str, vol.Strip, vol.Length(min=1, max=MAX_SHORTCUT_NAME)),
            vol.Required("icon"): vol.In(SHORTCUT_ICONS),
            vol.Required("steps"): vol.All([STEP_SCHEMA], vol.Length(max=MAX_STEPS)),
            vol.Optional("show"): cv.entity_id,
            vol.Optional("quiet"): bool,
            vol.Optional("confirm"): bool,
        }
    ),
    _shortcut_does,
)


def _unique_ids(shortcuts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = [shortcut["id"] for shortcut in shortcuts]
    if len(set(ids)) != len(ids):
        raise vol.Invalid("each shortcut has an id of its own")
    return shortcuts


SHORTCUTS_SCHEMA = vol.All([SHORTCUT_SCHEMA], vol.Length(max=MAX_SHORTCUTS), _unique_ids)


class ChoiceError(Exception):
    """A change refused, with a code the frontend translates."""

    def __init__(self, code: str) -> None:
        """Keep the code."""
        super().__init__(code)
        self.code = code


def _read(raw: Any) -> dict[str, Any] | None:
    """One user's choices as stored, what cannot be read left out."""
    if not isinstance(raw, dict):
        return None
    choices: dict[str, Any] = {}
    favourites = raw.get("favourites")
    if isinstance(favourites, list):
        kept: list[str] = []
        for entity_id in favourites:
            readable = isinstance(entity_id, str) and cv.valid_entity_id(entity_id)
            if readable and entity_id not in kept:
                kept.append(entity_id)
        choices["favourites"] = kept[:MAX_FAVOURITES]
    if raw.get("start") in START_TABS:
        choices["start"] = raw["start"]
    try:
        choices["cards"] = CARDS_SCHEMA(raw.get("cards", []))
    except vol.Invalid:
        choices["cards"] = []
    # Each shortcut on its own: one that cannot be read does not take the others with it.
    shortcuts: list[dict[str, Any]] = []
    for shortcut in raw.get("shortcuts", []) if isinstance(raw.get("shortcuts"), list) else []:
        try:
            read = SHORTCUT_SCHEMA(shortcut)
        except vol.Invalid:
            continue
        if all(kept["id"] != read["id"] for kept in shortcuts):
            shortcuts.append(read)
    choices["shortcuts"] = shortcuts[:MAX_SHORTCUTS]
    return choices


class Choices:
    """Every user's choices, kept in their own store."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store; nothing is read before `async_load`."""
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, CHOICES_STORAGE_VERSION, CHOICES_STORAGE_KEY, private=True
        )
        self._users: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        """Read the store; the choices of users no longer in Home Assistant are forgotten."""
        stored = await self._store.async_load()
        users = stored.get("users") if isinstance(stored, dict) else None
        known = {user.id for user in await self._hass.auth.async_get_users()}
        dropped = False
        for user_id, raw in (users if isinstance(users, dict) else {}).items():
            if user_id not in known:
                dropped = True
                continue
            if (choices := _read(raw)) is not None:
                self._users[user_id] = choices
        if dropped:
            await self._async_save()

    def get(self, user_id: str) -> dict[str, Any]:
        """A user's choices, as the frontend reads them (`start` absent until chosen)."""
        choices = self._users.get(user_id, {})
        result: dict[str, Any] = {
            "favourites": list(choices.get("favourites", [])),
            "cards": [dict(card) for card in choices.get("cards", [])],
            "shortcuts": copy.deepcopy(choices.get("shortcuts", [])),
        }
        if "start" in choices:
            result["start"] = choices["start"]
        return result

    async def async_favourite(self, user_id: str, entity_id: str, favourite: bool) -> list[str]:
        """Stars an entity (last of the favourites) or takes its star away; answers them all."""
        choices = self._users.setdefault(user_id, {})
        favourites: list[str] = list(choices.get("favourites", []))
        if favourite and entity_id not in favourites:
            if len(favourites) >= MAX_FAVOURITES:
                raise ChoiceError("too_many_favourites")
            favourites.append(entity_id)
        elif not favourite and entity_id in favourites:
            favourites.remove(entity_id)
        else:
            return favourites
        choices["favourites"] = favourites
        await self._async_save()
        return list(favourites)

    async def async_save(
        self,
        user_id: str,
        *,
        start: str | None = None,
        cards: list[dict[str, Any]] | None = None,
        shortcuts: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Sets the tab DomoTwin opens on (`""`: none chosen), the Home tab's cards, shortcuts."""
        choices = self._users.setdefault(user_id, {})
        if start is not None:
            if start:
                choices["start"] = start
            else:
                choices.pop("start", None)
        if cards is not None:
            choices["cards"] = cards
        if shortcuts is not None:
            choices["shortcuts"] = shortcuts
        await self._async_save()
        return self.get(user_id)

    async def async_remove(self) -> None:
        """Delete the store (the integration removed)."""
        await self._store.async_remove()

    async def _async_save(self) -> None:
        await self._store.async_save({"users": self._users})


# The websocket commands: any signed-in user, for their own choices only.


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the users' choices (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_choices_get)
    websocket_api.async_register_command(hass, ws_choices_favourite)
    websocket_api.async_register_command(hass, ws_choices_save)


def _choices(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> Choices | None:
    from .data import CHOICES_KEY  # noqa: PLC0415 (data imports this module)

    choices = hass.data.get(CHOICES_KEY)
    if choices is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return choices


@websocket_api.websocket_command({vol.Required("type"): "domotwin/choices/get"})
@callback
def ws_choices_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The user's own choices: their favourites, cards, shortcuts and, once chosen, `start`."""
    if (choices := _choices(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], choices.get(connection.user.id))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/choices/favourite",
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("favourite"): bool,
    }
)
@websocket_api.async_response
async def ws_choices_favourite(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Stars an entity, or takes its star away; answers the favourites."""
    if (choices := _choices(hass, connection, msg)) is None:
        return
    try:
        favourites = await choices.async_favourite(
            connection.user.id, msg["entity_id"], msg["favourite"]
        )
    except ChoiceError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], {"favourites": favourites})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/choices/save",
        vol.Optional("start"): vol.In(("", *START_TABS)),
        vol.Optional("cards"): CARDS_SCHEMA,
        vol.Optional("shortcuts"): SHORTCUTS_SCHEMA,
    }
)
@websocket_api.async_response
async def ws_choices_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Sets the tab DomoTwin opens on, the Home tab's cards and shortcuts; answers the choices."""
    if (choices := _choices(hass, connection, msg)) is None:
        return
    result = await choices.async_save(
        connection.user.id,
        start=msg.get("start"),
        cards=msg.get("cards"),
        shortcuts=msg.get("shortcuts"),
    )
    connection.send_result(msg["id"], result)
