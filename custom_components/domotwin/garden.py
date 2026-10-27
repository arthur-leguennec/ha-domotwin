"""The garden (`docs/DECISIONS.md`, D-077): when each lawn was last mown.

The lawn's grass is drawn as long as it has grown since (the page works it out from the season
where the home is). Its last mowing comes from two places, kept in a store of their own
(.storage/domotwin.garden): someone says a lawn was just mown (any signed-in user, as an upkeep
task is done, for a place outside of the plan), and Home Assistant's robot mowers (`lawn_mower`
entities), each mowing noted when it stops (a mower out of reach meanwhile is still mowing).
Nothing in it is private: room ids, entity ids and times.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.const import EVENT_STATE_CHANGED, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .compat import vol
from .const import (
    GARDEN_STORAGE_KEY,
    GARDEN_STORAGE_VERSION,
    MAX_ID_LENGTH,
    MAX_LAWNS,
    MAX_MOWERS,
    MOWING,
    SIGNAL_UPDATED,
)

#: The domain of Home Assistant's robot mowers.
LAWN_MOWER = "lawn_mower"
#: How long a mowing noted waits before it is written (s): a mower stops and starts again.
SAVE_DELAY = 10


def _times(raw: Any, limit: int, key: Any) -> dict[str, str]:
    """Times as stored (`{id: iso}`), what cannot be read left out, the latest kept."""
    found: dict[str, datetime] = {}
    for name, when in (raw if isinstance(raw, dict) else {}).items():
        if not isinstance(name, str) or not key(name) or not isinstance(when, str):
            continue
        if (at := dt_util.parse_datetime(when)) is not None and at.tzinfo is not None:
            found[name] = at
    latest = sorted(found, key=lambda name: found[name], reverse=True)[:limit]
    return {name: found[name].isoformat() for name in sorted(latest)}


def _room(name: str) -> bool:
    return 0 < len(name) <= MAX_ID_LENGTH


def _mower(name: str) -> bool:
    return name.startswith(f"{LAWN_MOWER}.") and len(name) <= 255


class Garden:
    """When each lawn was last mown, and each robot mower last mowed."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare the store; nothing is read before `async_load`."""
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, GARDEN_STORAGE_VERSION, GARDEN_STORAGE_KEY)
        self._lawns: dict[str, str] = {}
        self._mowers: dict[str, str] = {}
        # The mowers mowing now (or out of reach since), and a write waiting.
        self._mowing: set[str] = set()
        self._dirty = False
        # Changes told to the pages (`domotwin/subscribe`, kind `garden`).
        self._revision = 0

    async def async_load(self) -> None:
        """Read the store; what cannot be read is left out."""
        stored = await self._store.async_load()
        stored = stored if isinstance(stored, dict) else {}
        self._lawns = _times(stored.get("lawns"), MAX_LAWNS, _room)
        self._mowers = _times(stored.get("mowers"), MAX_MOWERS, _mower)

    @callback
    def async_start(self) -> Any:
        """Note each robot mower's mowing as it stops; returns how to stop listening.

        Unavailable or unknown meanwhile (out of Wi-Fi's reach, mostly), a mower mowing is still
        mowing; removed, its mowing is not noted.
        """
        self._mowing = {
            state.entity_id
            for state in self._hass.states.async_all(LAWN_MOWER)
            if state.state == MOWING
        }

        @callback
        def is_mower(event_data: EventStateChangedData) -> bool:
            return event_data["entity_id"].startswith(f"{LAWN_MOWER}.")

        @callback
        def changed(event: Event[EventStateChangedData]) -> None:
            entity_id, new = event.data["entity_id"], event.data["new_state"]
            if new is None:
                self._mowing.discard(entity_id)
            elif new.state == MOWING:
                self._mowing.add(entity_id)
            elif new.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN) and entity_id in self._mowing:
                self._mowing.discard(entity_id)
                self._note_mower(entity_id, dt_util.utcnow())

        return self._hass.bus.async_listen(EVENT_STATE_CHANGED, changed, event_filter=is_mower)

    def get(self) -> dict[str, Any]:
        """When each lawn was last said mown and each mower last mowed (ISO times)."""
        return {"lawns": dict(self._lawns), "mowers": dict(self._mowers)}

    @property
    def counts(self) -> dict[str, int]:
        """How many lawns and mowers are known (for the diagnostics)."""
        return {"lawns": len(self._lawns), "mowers": len(self._mowers)}

    async def async_mowed(self, room: str, when: datetime) -> dict[str, Any]:
        """Notes a lawn mown at `when`; answers the garden."""
        self._lawns[room] = when.isoformat()
        self._lawns = _times(self._lawns, MAX_LAWNS, _room)
        await self._store.async_save(self._saved())
        self._changed()
        return self.get()

    async def async_flush(self) -> None:
        """Write the store now if a write is waiting (the integration unloaded)."""
        if self._dirty:
            await self._store.async_save(self._saved())

    async def async_remove(self) -> None:
        """Delete the store (the integration removed)."""
        await self._store.async_remove()

    def _note_mower(self, entity_id: str, when: datetime) -> None:
        self._mowers[entity_id] = when.isoformat()
        self._mowers = _times(self._mowers, MAX_MOWERS, _mower)
        self._dirty = True
        self._store.async_delay_save(self._saved, SAVE_DELAY)
        self._changed()

    def _saved(self) -> dict[str, Any]:
        """What the store holds, as it is written (no write waits after it)."""
        self._dirty = False
        return {"lawns": self._lawns, "mowers": self._mowers}

    def _changed(self) -> None:
        self._revision += 1
        async_dispatcher_send(self._hass, SIGNAL_UPDATED, "garden", self._revision)


# The websocket commands: any signed-in user reads the garden and says a lawn was mown.


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the commands of the garden (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_garden_get)
    websocket_api.async_register_command(hass, ws_garden_mowed)


def _is_lawn(hass: HomeAssistant, room: str) -> bool:
    """Whether `room` is a lawn of one of the stored plans (D-077): a place outside on a lawn."""
    from .data import DATA_KEY  # noqa: PLC0415 (data imports this module)

    data = hass.data.get(DATA_KEY)
    for storey in data.storeys if data is not None else []:
        plan = storey.get("plan")
        rooms = plan.get("rooms") if isinstance(plan, dict) else None
        for found in rooms if isinstance(rooms, list) else []:
            if isinstance(found, dict) and found.get("id") == room:
                floor = found.get("floor")
                material = floor.get("material") if isinstance(floor, dict) else None
                return found.get("outside") is True and material in (None, "lawn")
    return False


def _garden(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> Garden | None:
    from .data import GARDEN_KEY  # noqa: PLC0415 (data imports this module)

    garden = hass.data.get(GARDEN_KEY)
    if garden is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return garden


@websocket_api.websocket_command({vol.Required("type"): "domotwin/garden/get"})
@callback
def ws_garden_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """When each lawn was last mown: `{"lawns": {room: iso}, "mowers": {entity: iso}}`."""
    if (garden := _garden(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], garden.get())


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/garden/mowed",
        vol.Required("room"): vol.All(str, vol.Length(min=1, max=MAX_ID_LENGTH)),
    }
)
@websocket_api.async_response
async def ws_garden_mowed(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """A lawn was just mown; answers the garden. Every user: it is mown in the home."""
    if (garden := _garden(hass, connection, msg)) is None:
        return
    # A lawn of the plan: not any id, which would push the lawns out.
    if not _is_lawn(hass, msg["room"]):
        connection.send_error(msg["id"], "unknown_lawn", "no lawn has this id")
        return
    connection.send_result(msg["id"], await garden.async_mowed(msg["room"], dt_util.utcnow()))
