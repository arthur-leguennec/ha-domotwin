"""Serve the built frontend and register the sidebar panel and the card module."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import (
    CONF_SIDEBAR,
    CONF_SIDEBAR_ADMIN_ONLY,
    DEFAULT_OPTIONS,
    ENTRY_MODULE,
    FRONTEND_DIR,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
)
from .data import STATIC_REGISTERED_KEY

_LOGGER = logging.getLogger(__name__)

FRONTEND_PATH = Path(__file__).parent / FRONTEND_DIR
MODULE_URL = f"{STATIC_URL}/{ENTRY_MODULE}?v={VERSION}"


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the frontend files and load the entry module on every frontend page."""
    if not (FRONTEND_PATH / ENTRY_MODULE).is_file():
        _LOGGER.warning(
            "The DomoTwin frontend is missing (%s). Install a release, or run scripts/build.sh "
            "in a development checkout",
            FRONTEND_PATH,
        )
    # Static routes cannot be removed, so they are registered once per Home Assistant run.
    if not hass.data.get(STATIC_REGISTERED_KEY):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(FRONTEND_PATH), cache_headers=True)]
        )
        hass.data[STATIC_REGISTERED_KEY] = True
    # The entry module only defines the custom elements; the engine is loaded on demand.
    frontend.add_extra_js_url(hass, MODULE_URL)


@callback
def async_unregister_frontend(hass: HomeAssistant) -> None:
    """Stop loading the entry module (the static route stays until restart)."""
    try:
        frontend.remove_extra_js_url(hass, MODULE_URL)
    except KeyError:
        _LOGGER.debug("The DomoTwin module was not registered")


async def async_update_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Show, hide or update the sidebar panel from the options."""
    options = {**DEFAULT_OPTIONS, **entry.options}
    async_remove_panel(hass)
    if not options[CONF_SIDEBAR]:
        return
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=MODULE_URL,
        embed_iframe=False,
        require_admin=bool(options[CONF_SIDEBAR_ADMIN_ONLY]),
        config={"version": VERSION},
    )


@callback
def async_remove_panel(hass: HomeAssistant) -> None:
    """Remove the sidebar panel if it is registered."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
