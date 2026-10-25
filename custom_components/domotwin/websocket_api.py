"""Websocket API used by the DomoTwin frontend (see docs/ARCHITECTURE.md)."""

from __future__ import annotations

import copy
import logging
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util

from .compat import vol
from .const import SIGNAL_SHOW, SIGNAL_UPDATED, VERSION
from .data import DATA_KEY
from .models import async_remove_unused
from .storage import (
    UNSET,
    DomoTwinData,
    RevisionConflictError,
    UnknownStoreyError,
    UnknownTaskError,
)
from .upkeep import piece_names
from .validation import (
    InvalidPayloadError,
    validate_bindings,
    validate_elevation,
    validate_layout,
    validate_models,
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
    websocket_api.async_register_command(hass, ws_subscribe)


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


@websocket_api.websocket_command({vol.Required("type"): "domotwin/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send an event every time the plan, the bindings, the settings or the upkeep change.

    The plan's overlay counts as the plan.

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
