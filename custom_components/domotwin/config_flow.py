"""Config flow: DomoTwin needs no settings to start (no YAML)."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback

from .compat import vol
from .const import (
    CONF_SIDEBAR,
    CONF_SIDEBAR_ADMIN_ONLY,
    DEFAULT_OPTIONS,
    DOMAIN,
    PANEL_TITLE,
)

OPTIONS_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_SIDEBAR): bool,
        vol.Required(CONF_SIDEBAR_ADMIN_ONLY): bool,
    }
)


class DomoTwinConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add DomoTwin from Settings → Devices & services."""

    VERSION = 1
    MINOR_VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Confirm the installation."""
        if user_input is not None:
            return self.async_create_entry(
                title=PANEL_TITLE, data={}, options=dict(DEFAULT_OPTIONS)
            )
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow."""
        return DomoTwinOptionsFlow()


class DomoTwinOptionsFlow(OptionsFlow):
    """Sidebar options."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show or hide the sidebar panel."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                OPTIONS_SCHEMA, {**DEFAULT_OPTIONS, **self.config_entry.options}
            ),
        )
