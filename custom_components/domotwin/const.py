"""Constants of the DomoTwin integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "domotwin"
VERSION: Final = "0.0.0"  # x-release-please-version

# Storage (.storage/domotwin.data), see docs/ARCHITECTURE.md.
STORAGE_KEY: Final = f"{DOMAIN}.data"
STORAGE_VERSION: Final = 1
STORAGE_MINOR_VERSION: Final = 1

# Frontend files served by the integration.
STATIC_URL: Final = "/domotwin_static"
FRONTEND_DIR: Final = "frontend"
ENTRY_MODULE: Final = "domotwin.js"

# Sidebar panel.
PANEL_URL_PATH: Final = "domotwin"
PANEL_ELEMENT: Final = "domotwin-panel"
PANEL_TITLE: Final = "DomoTwin"
PANEL_ICON: Final = "mdi:floor-plan"

# Options.
CONF_SIDEBAR: Final = "sidebar"
CONF_SIDEBAR_ADMIN_ONLY: Final = "sidebar_admin_only"
DEFAULT_OPTIONS: Final = {CONF_SIDEBAR: True, CONF_SIDEBAR_ADMIN_ONLY: False}

# Limits of what the websocket API accepts. Home Assistant refuses websocket messages above 4 MiB,
# so a stored plan stays below that; the 3D files of user models are uploaded separately (M3).
MAX_PLAN_BYTES: Final = 3_500_000
MAX_LAYOUT_BYTES: Final = 1_000_000
MAX_BINDINGS_BYTES: Final = 1_000_000
MAX_ELEMENTS: Final = 500
MAX_ID_LENGTH: Final = 100
MAX_BOUND_ELEMENTS: Final = 2_000
MAX_ENTITIES_PER_ELEMENT: Final = 16

# Dispatcher signal sent after every write: (kind, revision).
SIGNAL_UPDATED: Final = f"{DOMAIN}_updated"
