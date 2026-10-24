"""Websocket API used by the DomoTwin frontend (see docs/ARCHITECTURE.md)."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .compat import vol
from .const import SIGNAL_UPDATED, VERSION
from .data import DATA_KEY
from .models import async_remove_unused
from .storage import UNSET, DomoTwinData, RevisionConflictError
from .validation import (
    InvalidPayloadError,
    validate_bindings,
    validate_layout,
    validate_models,
    validate_plan,
    validate_settings,
)

_LOGGER = logging.getLogger(__name__)


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the websocket commands (once, at integration setup)."""
    websocket_api.async_register_command(hass, ws_info)
    websocket_api.async_register_command(hass, ws_plan_get)
    websocket_api.async_register_command(hass, ws_plan_save)
    websocket_api.async_register_command(hass, ws_bindings_get)
    websocket_api.async_register_command(hass, ws_bindings_save)
    websocket_api.async_register_command(hass, ws_settings_get)
    websocket_api.async_register_command(hass, ws_settings_save)
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
        {"version": VERSION, "revision": data.revision, "has_plan": data.plan is not None},
    )


@websocket_api.websocket_command({vol.Required("type"): "domotwin/plan/get"})
@callback
def ws_plan_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the stored plan and its edit overlay."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    snapshot = data.snapshot()
    connection.send_result(
        msg["id"],
        {"plan": snapshot["plan"], "layout": snapshot["layout"], "revision": data.revision},
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "domotwin/plan/save",
        vol.Optional("plan"): vol.Any(None, dict),
        vol.Optional("layout"): dict,
        vol.Optional("expected_revision"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_plan_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Store a plan (null removes it) and/or the edit overlay. Admins only."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    try:
        plan = msg.get("plan", UNSET)
        if isinstance(plan, dict):
            plan = validate_plan(plan)
        layout = validate_layout(msg["layout"]) if "layout" in msg else UNSET
        validate_models(
            data.plan if plan is UNSET else plan,
            layout if isinstance(layout, dict) else data.layout,
        )
        revision = await data.async_save_plan(
            plan=plan, layout=layout, expected_revision=msg.get("expected_revision")
        )
    except InvalidPayloadError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    except RevisionConflictError as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision})
    # The files no plan uses any more go, a day after they were last used.
    try:
        await async_remove_unused(hass, data.plan, data.layout)
    except OSError:
        _LOGGER.warning("Could not clean up the unused 3D model files", exc_info=True)


@websocket_api.websocket_command({vol.Required("type"): "domotwin/bindings/get"})
@callback
def ws_bindings_get(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the bindings."""
    if (data := _get_data(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"], {"bindings": data.snapshot()["bindings"], "revision": data.revision}
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
        msg["id"], {"settings": data.snapshot()["settings"], "revision": data.revision}
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


@websocket_api.websocket_command({vol.Required("type"): "domotwin/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send an event every time the plan, the overlay, the bindings or the settings change."""

    @callback
    def forward(kind: str, revision: int) -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], {"kind": kind, "revision": revision})
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_UPDATED, forward)
    connection.send_result(msg["id"])
