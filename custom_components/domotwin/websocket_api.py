"""Websocket API used by the DomoTwin frontend (see docs/ARCHITECTURE.md)."""

from __future__ import annotations

import copy
import logging
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util

from . import choices, config_history, guests, schedules, voice, wifi
from .compat import vol
from .const import DOMAIN, SIGNAL_SHOW, SIGNAL_UPDATED, TEACH_SECONDS, VERSION
from .data import DATA_KEY, LOCATOR_KEY, PEOPLE_KEY
from .locator import PRIVATE_BLE, Locator
from .models import async_remove_unused
from .people import color_of
from .storage import (
    UNSET,
    DomoTwinData,
    RevisionConflictError,
    UnknownStoreyError,
    UnknownTaskError,
)
from .tracker import PeopleTracker
from .upkeep import piece_names
from .validation import (
    InvalidPayloadError,
    validate_bindings,
    validate_elevation,
    validate_layout,
    validate_locating,
    validate_models,
    validate_people,
    validate_plan,
    validate_settings,
    validate_storey_count,
    validate_storey_name,
    validate_storeys_ids,
    validate_unique_ids,
    validate_upkeep_change,
)

_LOGGER = logging.getLogger(__name__)


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the websocket commands (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_info)
    websocket_api.async_register_command(hass, ws_plan_get)
    websocket_api.async_register_command(hass, ws_plan_save)
    websocket_api.async_register_command(hass, ws_storey_save)
    websocket_api.async_register_command(hass, ws_storey_remove)
    websocket_api.async_register_command(hass, ws_storeys_replace)
    websocket_api.async_register_command(hass, ws_bindings_get)
    websocket_api.async_register_command(hass, ws_bindings_save)
    websocket_api.async_register_command(hass, ws_settings_get)
    websocket_api.async_register_command(hass, ws_settings_save)
    websocket_api.async_register_command(hass, ws_upkeep_get)
    websocket_api.async_register_command(hass, ws_upkeep_save)
    websocket_api.async_register_command(hass, ws_upkeep_done)
    websocket_api.async_register_command(hass, ws_people_get)
    websocket_api.async_register_command(hass, ws_people_save)
    websocket_api.async_register_command(hass, ws_people_hide)
    websocket_api.async_register_command(hass, ws_locating_get)
    websocket_api.async_register_command(hass, ws_locating_save)
    websocket_api.async_register_command(hass, ws_locating_candidates)
    websocket_api.async_register_command(hass, ws_locating_teach)
    websocket_api.async_register_command(hass, ws_locating_forget)
    websocket_api.async_register_command(hass, ws_subscribe)
    voice.async_register_commands(hass)
    schedules.async_register_commands(hass)
    choices.async_register_commands(hass)
    wifi.async_register_commands(hass)
    guests.async_register_commands(hass)
    config_history.async_register_commands(hass)


def _get_data(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> DomoTwinData | None:
    data = hass.data.get(DATA_KEY)
    if data is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return data


@websocket_api.websocket_command({vol.Required("type"): "domotwin/info"})
@callback
def ws_info(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the version and the stored revision."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"],
        {
            "version": VERSION,
            "revision": data.revision,
            "has_plan": data.plan is not None,
            "storeys": len(data.storeys),
        },
    )


def _storey_list(data: DomoTwinData) -> list[dict[str, Any]]:
    return [
        {"id": storey["id"], "name": storey["name"], "elevation": storey["elevation"]}
        for storey in data.storeys
    ]


@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/plan/get", vol.Optional("storey"): str}
)
@callback
def ws_plan_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the plan and overlay of a storey (the ground floor by default), and the storeys."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        storey = data.storey(msg.get("storey"))
    except UnknownStoreyError:
        connection.send_error(msg["id"], "unknown_storey", "no storey has this id")
        return
    connection.send_result(
        msg["id"],
        {
            "plan": copy.deepcopy(storey["plan"]) if storey else None,
            "layout": copy.deepcopy(storey["layout"]) if storey else {},
            "storey": storey["id"] if storey else None,
            "storeys": _storey_list(data),
            "revision": data.revision_of("plan"),
        },
    )


async def _remove_unused_models(hass: HomeAssistant, data: DomoTwinData) -> None:
    """The files no storey uses any more go, a day after they were last used.

    Storeys set aside keep theirs, should they be imported again.
    """
    try:
        await async_remove_unused(
            hass,
            [
                (storey.get("plan"), storey.get("layout"))
                for storey in [*data.storeys, *data.retired]
                if isinstance(storey, dict)
            ],
        )
    except OSError:
        _LOGGER.warning("Could not clean up the unused 3D model files", exc_info=True)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/plan/save",
        vol.Optional("storey"): str,
        vol.Optional("plan"): vol.Any(None, dict),
        vol.Optional("layout"): dict,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_plan_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Store the plan (null removes the storey) and/or the overlay of a storey. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        storey = data.storey(msg.get("storey"))
        plan = msg.get("plan", UNSET)
        if isinstance(plan, dict):
            plan = validate_plan(plan)
        layout = validate_layout(msg["layout"]) if "layout" in msg else UNSET
        shown_plan = (storey["plan"] if storey else None) if plan is UNSET else plan
        shown_layout = layout if isinstance(layout, dict) else (storey["layout"] if storey else {})
        if plan is not None:
            _check_home_ids(data, storey, shown_plan, shown_layout)
        validate_models(shown_plan, shown_layout)
        revision = await data.async_save_plan(
            plan=plan,
            layout=layout,
            storey=msg.get("storey"),
            expected_revision=msg.get("expected_revision"),
        )
    except UnknownStoreyError:
        connection.send_error(msg["id"], "unknown_storey", "no storey has this id")
        return
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision})
    await _remove_unused_models(hass, data)


def _check_home_ids(
    data: DomoTwinData,
    storey: dict[str, Any] | None,
    plan: dict[str, Any] | None,
    layout: dict[str, Any],
) -> None:
    """The ids of a storey's plan and overlay are none of the other storeys'."""
    validate_unique_ids(
        (plan, layout), [(s["plan"], s["layout"]) for s in data.storeys if s is not storey]
    )


def _check_new_storey(data: DomoTwinData, msg: dict[str, Any]) -> None:
    """A new storey comes with its plan, within the number of storeys a home has."""
    if "plan" not in msg:
        raise InvalidPayloadError("invalid_storey", "a new storey needs a plan")
    validate_storey_count(len(data.storeys) + 1)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/storey/save",
        vol.Optional("storey"): str,
        vol.Optional("name"): str,
        vol.Optional("elevation"): vol.Any(int, float),
        vol.Optional("plan"): dict,
        vol.Optional("layout"): dict,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_storey_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Add a storey (without `storey`; its plan is needed) or change one. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        storey = data.storey(msg["storey"]) if "storey" in msg else None
        if storey is None:
            _check_new_storey(data, msg)
        name = validate_storey_name(msg["name"]) if "name" in msg else UNSET
        elevation = validate_elevation(msg["elevation"]) if "elevation" in msg else UNSET
        plan = validate_plan(msg["plan"]) if "plan" in msg else UNSET
        layout = validate_layout(msg["layout"]) if "layout" in msg else UNSET
        shown_plan = plan if isinstance(plan, dict) else (storey["plan"] if storey else None)
        shown_layout = layout if isinstance(layout, dict) else (storey["layout"] if storey else {})
        if plan is not UNSET or layout is not UNSET:
            _check_home_ids(data, storey, shown_plan, shown_layout)
        validate_models(shown_plan, shown_layout)
        revision, storey_id = await data.async_save_storey(
            storey=msg.get("storey"),
            name=name,
            elevation=elevation,
            plan=plan,
            layout=layout,
            expected_revision=msg.get("expected_revision"),
        )
    except UnknownStoreyError:
        connection.send_error(msg["id"], "unknown_storey", "no storey has this id")
        return
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision, "storey": storey_id})
    await _remove_unused_models(hass, data)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/storey/remove",
        vol.Required("storey"): str,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_storey_remove(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Remove a storey with its plan and overlay. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        revision = await data.async_remove_storey(
            msg["storey"], expected_revision=msg.get("expected_revision")
        )
    except UnknownStoreyError:
        connection.send_error(msg["id"], "unknown_storey", "no storey has this id")
        return
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision})
    await _remove_unused_models(hass, data)


def _replacement(given: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The storeys replacing the home's, checked: 1 to 20, each id on one storey only."""
    if not given:
        raise InvalidPayloadError("invalid_storey", "at least one storey is needed")
    validate_storey_count(len(given))
    storeys: list[dict[str, Any]] = []
    for storey in given:
        plan = validate_plan(storey["plan"])
        validate_models(plan, {})
        storeys.append(
            {
                "name": validate_storey_name(storey["name"]),
                "elevation": validate_elevation(storey["elevation"]),
                "plan": plan,
            }
        )
    validate_storeys_ids([storey["plan"] for storey in storeys])
    return storeys


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/storeys/replace",
        vol.Required("storeys"): [
            {
                vol.Required("plan"): dict,
                vol.Optional("name", default=""): str,
                vol.Optional("elevation", default=0): vol.Any(int, float),
            }
        ],
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_storeys_replace(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Replace every storey at once (a whole IFC file imported), or none. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        revision, ids = await data.async_replace_storeys(
            _replacement(msg["storeys"]), expected_revision=msg.get("expected_revision")
        )
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision, "storeys": ids})
    await _remove_unused_models(hass, data)


@websocket_api.websocket_command({vol.Required("type"): "domotwin/bindings/get"})
@callback
def ws_bindings_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the bindings."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"],
        {"bindings": copy.deepcopy(data.bindings), "revision": data.revision_of("bindings")},
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/bindings/save",
        vol.Required("bindings"): dict,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_bindings_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Store the bindings. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        bindings = validate_bindings(msg["bindings"])
        revision = await data.async_save_bindings(bindings, msg.get("expected_revision"))
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision})


@websocket_api.websocket_command({vol.Required("type"): "domotwin/settings/get"})
@callback
def ws_settings_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the home's settings."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"],
        {"settings": copy.deepcopy(data.settings), "revision": data.revision_of("settings")},
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "domotwin/settings/save", vol.Required("settings"): dict}
)
@websocket_api.async_response
async def ws_settings_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Store the home's settings. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        revision = await data.async_save_settings(validate_settings(msg["settings"]))
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], {"revision": revision})


@websocket_api.websocket_command({vol.Required("type"): "domotwin/upkeep/get"})
@callback
def ws_upkeep_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the upkeep cards (D-033), with today's date where the home is."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"],
        {
            "upkeep": copy.deepcopy(data.upkeep),
            "revision": data.revision_of("upkeep"),
            "today": dt_util.now().date().isoformat(),
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/upkeep/save",
        vol.Required("pieces"): dict,
        vol.Optional("lead_days"): int,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_upkeep_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Store upkeep cards (`null` removes one) and how early a task is due. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        # The cards of pieces no plan has any more are kept (a storey put back finds them), but
        # do not count against the room the others need: they go first when room is short.
        names = piece_names(data.storeys)
        kept = {piece: card for piece, card in data.upkeep["pieces"].items() if piece in names}
        pieces = validate_upkeep_change(msg["pieces"], msg.get("lead_days"), kept)
        revision = await data.async_save_upkeep(
            pieces, msg.get("lead_days"), msg.get("expected_revision"), names
        )
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/upkeep/done",
        vol.Required("piece"): str,
        vol.Required("task"): str,
    }
)
@websocket_api.async_response
async def ws_upkeep_done(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Mark a task done today, where the home is. Every user: it is done in the home."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    today = dt_util.now().date()
    try:
        revision = await data.async_upkeep_done(msg["piece"], msg["task"], today)
    except UnknownTaskError as err:
        connection.send_error(msg["id"], "unknown_task", f"no task {err}")
        return
    connection.send_result(msg["id"], {"revision": revision, "last_done": today.isoformat()})


def _get_people(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> PeopleTracker | None:
    people = hass.data.get(PEOPLE_KEY)
    if people is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return people


def _sensor_of(hass: HomeAssistant, person: str) -> str:
    """The room sensor of a person, as the user may have renamed it."""
    registry = er.async_get(hass)
    for entry in hass.config_entries.async_entries(DOMAIN):
        found = registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_room_{person}")
        if found is not None:
            return found
    return f"sensor.{DOMAIN}_{person.split('.', 1)[1]}_room"


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/people/get",
        vol.Optional("candidates", default=False): bool,
    }
)
@callback
def ws_people_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the people's settings (D-034): who is placed, from what, in which colour.

    Each person's room is the state of their room sensor (`sensor`). Administrators who ask
    (`candidates`) also get the entities that may say where someone is: a look at every sensor,
    for the people's settings only.
    """
    if (people := _get_people(hass, connection, msg)) is None:
        return
    config = people.config
    # Shown to administrators only: others learn nobody (not even who is placed).
    shown_to = config["people"] if connection.user.is_admin or config["shown"] != "admins" else {}
    result: dict[str, Any] = {
        "revision": people.revision,
        "shown": config["shown"],
        "look": config["look"],
        "hidden": [p for p in config["hidden"] if p in shown_to],
        "people": {
            person: {
                "sources": list(settings.get("sources", [])),
                "color": settings.get("color") or color_of(person),
                "sensor": _sensor_of(hass, person),
                "located": people.located_sources(person),
            }
            for person, settings in shown_to.items()
        },
    }
    if msg["candidates"] and connection.user.is_admin:
        result["candidates"] = people.candidates()
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/people/save",
        vol.Required("people"): dict,
        vol.Optional("shown"): str,
        vol.Optional("look"): str,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_people_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Store who is placed from what, who sees the people and how they are drawn. Admins only."""
    if (people := _get_people(hass, connection, msg)) is None:
        return
    try:
        checked = validate_people(msg["people"], msg.get("shown"), msg.get("look"))
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    try:
        revision = await people.async_save(
            checked, msg.get("shown"), msg.get("look"), msg.get("expected_revision")
        )
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/people/hide",
        vol.Required("person"): str,
        vol.Required("hidden"): bool,
    }
)
@websocket_api.async_response
async def ws_people_hide(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Hide a person from DomoTwin's views, or show them again.

    A user hides themselves (the person their user is); administrators anyone.
    """
    if (people := _get_people(hass, connection, msg)) is None:
        return
    person = msg["person"]
    state = hass.states.get(person)
    own = state is not None and state.attributes.get("user_id") == connection.user.id
    if not (own or connection.user.is_admin):
        connection.send_error(msg["id"], "unauthorized", "only yourself, or as an administrator")
        return
    if person not in people.config["people"]:
        connection.send_error(msg["id"], "unknown_person", "this person is not placed")
        return
    revision = await people.async_hide(person, msg["hidden"])
    connection.send_result(msg["id"], {"revision": revision})


def _get_locator(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> Locator | None:
    locator = hass.data.get(LOCATOR_KEY)
    if locator is None:
        connection.send_error(msg["id"], "not_loaded", "DomoTwin is not set up")
    return locator


def _match_shown(hass: HomeAssistant, match: dict[str, Any]) -> dict[str, Any]:
    """How a device is known, as the settings show it: a key by its entry's title, never itself."""
    if "key" not in match:
        return dict(match)
    entry = hass.config_entries.async_get_entry(match["key"])
    title = entry.title if entry is not None and entry.domain == PRIVATE_BLE else None
    return {"key": match["key"], "title": title}


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "domotwin/locating/get"})
@callback
def ws_locating_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the Bluetooth locating (D-035): the receivers, the devices followed and their rooms.

    Administrators only. An identity key never leaves the server: a device known by one is shown
    by its Private BLE Device entry. For the placement advisor (D-066), each receiver's place and
    what each learned in each room (`heard`).
    """
    if (locator := _get_locator(hass, connection, msg)) is None:
        return
    settings = locator.settings
    now = {source: (name, idle) for source, name, idle in locator.receivers_now()}
    receivers = []
    for source in sorted(set(now) | set(settings["receivers"])):
        name, idle = now.get(source, (None, None))
        receivers.append(
            {
                "source": source,
                "name": name,
                "idle": round(idle) if idle is not None else None,
                **settings["receivers"].get(source, {}),
                "placed_by": locator.placed_by.get(source),
                "place": locator.place_of(source),
            }
        )
    devices: dict[str, Any] = {}
    for device, followed in settings["devices"].items():
        located = locator.located.get(device)
        devices[device] = {
            **followed,
            "match": _match_shown(hass, followed["match"]),
            "sensor": locator.sensor_of(device),
            "room": located.room if located else None,
            "confidence": round(located.confidence, 2) if located else 0,
            "last_seen": located.last_seen.isoformat() if located and located.last_seen else None,
            "left_behind": bool(located and located.left_behind),
            "missing_key": device in locator.missing_keys,
        }
    connection.send_result(
        msg["id"],
        {
            "revision": locator.revision,
            "status": locator.status(),
            "learn": settings.get("learn", True),
            "receivers": receivers,
            "devices": devices,
            "learned": locator.learned_rooms(),
            "heard": locator.heard(),
            "rooms": [
                {"id": room.id, "name": room.name, "storey": room.storey_name}
                for room in people.finder.rooms
            ]
            if (people := hass.data.get(PEOPLE_KEY)) is not None
            else [],
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/locating/save",
        vol.Required("receivers"): dict,
        vol.Required("devices"): dict,
        vol.Optional("learn"): bool,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_locating_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Store where the receivers are and which devices are followed. Admins only.

    The owners of the phones and watches followed are placed (People) if they were not.
    """
    if (locator := _get_locator(hass, connection, msg)) is None:
        return
    if (people := _get_people(hass, connection, msg)) is None:
        return
    try:
        receivers, devices = validate_locating(msg["receivers"], msg["devices"], msg.get("learn"))
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    try:
        revision = await locator.async_save(
            receivers, devices, msg.get("learn"), msg.get("expected_revision")
        )
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    await people.async_place(
        [d["person"] for d in devices.values() if d.get("person") and d["kind"] != "thing"]
    )
    connection.send_result(msg["id"], {"revision": revision})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "domotwin/locating/candidates"})
@callback
def ws_locating_candidates(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the devices that may be followed. Admins only."""
    if (locator := _get_locator(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], {"candidates": locator.candidates()})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/locating/teach",
        vol.Required("device"): str,
        vol.Required("room"): str,
        vol.Optional("seconds", default=30): vol.All(
            vol.Coerce(float), vol.Range(min=TEACH_SECONDS[0], max=TEACH_SECONDS[1])
        ),
    }
)
@websocket_api.async_response
async def ws_locating_teach(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Teach a room: listen to a device held there, then answer what was heard. Admins only."""
    if (locator := _get_locator(hass, connection, msg)) is None:
        return
    if locator.radio is None:
        connection.send_error(msg["id"], "no_bluetooth", "Home Assistant has no Bluetooth")
        return
    if msg["device"] not in locator.settings["devices"]:
        connection.send_error(msg["id"], "unknown_device", "this device is not followed")
        return
    if msg["room"] not in locator.home.rooms:
        connection.send_error(msg["id"], "unknown_room", "the plans have no such room")
        return
    connection.send_result(
        msg["id"], await locator.async_teach(msg["device"], msg["room"], msg["seconds"])
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/locating/forget",
        vol.Optional("room"): str,
    }
)
@websocket_api.async_response
async def ws_locating_forget(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Forget what was learned in a room (in every room without one). Admins only."""
    if (locator := _get_locator(hass, connection, msg)) is None:
        return
    forgotten = await locator.async_forget(msg.get("room"))
    connection.send_result(msg["id"], {"forgotten": forgotten})


@websocket_api.websocket_command({vol.Required("type"): "domotwin/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send an event every time something stored changes: its kind and revision.

    The kinds: the plan (its overlay counts as the plan), the bindings, the settings, the upkeep,
    the people's settings, the home's Wi-Fi (`wifi`: only that it changed, D-060) and the guest
    passes (`guests`: only that they changed, D-067).

    Every `domotwin.show` is sent too: kind `show`, the request in `show`.
    """

    @callback
    def forward(kind: str, revision: int) -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], {"kind": kind, "revision": revision})
        )

    @callback
    def show(request: dict[str, Any]) -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], {"kind": "show", "show": request})
        )

    stops = [
        async_dispatcher_connect(hass, SIGNAL_UPDATED, forward),
        async_dispatcher_connect(hass, SIGNAL_SHOW, show),
    ]

    @callback
    def stop() -> None:
        for each in stops:
            each()

    connection.subscriptions[msg["id"]] = stop
    connection.send_result(msg["id"])
