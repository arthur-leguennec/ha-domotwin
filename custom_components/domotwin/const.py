"""Constants of the DomoTwin integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "domotwin"
VERSION: Final = "0.2.0"  # x-release-please-version

# Storage (.storage/domotwin.data), see docs/ARCHITECTURE.md.
STORAGE_KEY: Final = f"{DOMAIN}.data"
# 2: the storeys (1.1 kept one plan). 3: plans in DomoTwin's own format (docs/plan-format.md).
# 4: the upkeep cards (D-033). Major versions, so that an older DomoTwin refuses the data instead
# of misreading it (a 3.x would drop the cards it does not know, and save at once).
STORAGE_VERSION: Final = 4
STORAGE_MINOR_VERSION: Final = 1

# What a plan file says it is, and the lists of its elements (docs/plan-format.md).
PLAN_FORMAT: Final = "domotwin-plan"
PLAN_LISTS: Final = ("rooms", "partitions", "doors", "windows", "items")

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
# so a stored plan stays below that; the 3D files of user models are uploaded separately (M3b).
MAX_PLAN_BYTES: Final = 3_500_000
MAX_LAYOUT_BYTES: Final = 1_000_000
MAX_BINDINGS_BYTES: Final = 1_000_000
MAX_ELEMENTS: Final = 500
MAX_ID_LENGTH: Final = 100
MAX_BOUND_ELEMENTS: Final = 2_000
MAX_ENTITIES_PER_ELEMENT: Final = 16
# A room's own actions (docs/DECISIONS.md, D-047): at most this many, each named this long.
MAX_ROOM_ACTIONS: Final = 8
MAX_ROOM_ACTION_NAME: Final = 40
# Storeys of a home, the length of their names and their elevation (cm, from the ground).
MAX_STOREYS: Final = 20
MAX_STOREY_NAME: Final = 60
MIN_ELEVATION: Final = -10_000
MAX_ELEVATION: Final = 100_000

# Upkeep cards (docs/DECISIONS.md, D-033): one per piece at most, their texts and tasks.
MAX_UPKEEP_BYTES: Final = 1_000_000
MAX_UPKEEP_TEXT: Final = 100
MAX_UPKEEP_LINK: Final = 500
MAX_UPKEEP_NOTES: Final = 2_000
MAX_UPKEEP_TASKS: Final = 20
MAX_UPKEEP_DAYS: Final = 3_650
MAX_UPKEEP_MONTHS: Final = 120
MAX_LEAD_DAYS: Final = 365

# People in their rooms (docs/DECISIONS.md, D-034): their settings in a store of their own
# (.storage/domotwin.people), so that a DomoTwin from before them leaves the main data alone.
PEOPLE_STORAGE_KEY: Final = f"{DOMAIN}.people"
PEOPLE_STORAGE_VERSION: Final = 1
MAX_PEOPLE: Final = 50
# Private rooms (D-039): at most this many.
MAX_PRIVATE_ROOMS: Final = 200
MAX_PERSON_SOURCES: Final = 10
PEOPLE_SHOWN: Final = ("everyone", "admins")
PEOPLE_LOOKS: Final = ("figure", "pin")
# Dispatcher signal sent when a person moves: (person entity id,).
SIGNAL_PEOPLE: Final = f"{DOMAIN}_people"
SERVICE_WHERE: Final = "where"

# DomoTwin's own Bluetooth locating (docs/DECISIONS.md, D-035): its settings (receivers placed,
# devices followed) and what it learned, each in a store of its own.
LOCATING_STORAGE_KEY: Final = f"{DOMAIN}.locating"
LOCATING_LEARNED_KEY: Final = f"{DOMAIN}.locating_learned"
LOCATING_STORAGE_VERSION: Final = 1
MAX_LOCATED: Final = 30
MAX_RECEIVERS: Final = 64
MAX_LOCATED_NAME: Final = 60
LOCATED_KINDS: Final = ("phone", "watch", "thing")
# A device taught in a room is listened to this long (seconds), at least and at most.
TEACH_SECONDS: Final = (10, 120)
# Dispatcher signal sent when a followed device moves, is lost or left behind: (device id,).
SIGNAL_LOCATED: Final = f"{DOMAIN}_located"

# Actions done later (docs/DECISIONS.md, D-046), kept in their own store.
SCHEDULES_STORAGE_KEY: Final = f"{DOMAIN}.schedules"
SCHEDULES_STORAGE_VERSION: Final = 1
SERVICE_SCHEDULE: Final = "schedule"
SERVICE_UNSCHEDULE: Final = "unschedule"
# Dispatcher signal sent every time the actions waiting change: ().
SIGNAL_SCHEDULES: Final = f"{DOMAIN}_schedules"
MAX_SCHEDULES: Final = 100
# A room's lights switched together (D-047) fit in one action.
MAX_SCHEDULE_ENTITIES: Final = 25
# How far ahead an action may be set, and how long it may leave a device on (days).
MAX_SCHEDULE_DAYS: Final = 366
MAX_SCHEDULE_SPAN_DAYS: Final = 7
# A step missed while Home Assistant was stopped is still done this late (seconds).
SCHEDULE_GRACE_SECONDS: Final = 900
# What an action can switch, through Home Assistant's `turn_on` and `turn_off`.
SCHEDULABLE_DOMAINS: Final = (
    "light",
    "switch",
    "fan",
    "input_boolean",
    "media_player",
    "climate",
    "humidifier",
    "siren",
    "cover",
)

# Dispatcher signal sent after every write: (kind, revision).
SIGNAL_UPDATED: Final = f"{DOMAIN}_updated"
# `domotwin.show` (docs/DECISIONS.md, D-029): what to show, sent to the screens: (request,).
SERVICE_SHOW: Final = "show"
SIGNAL_SHOW: Final = f"{DOMAIN}_show"
MAX_SHOW_TEXT: Final = 100
MAX_SCREEN_NAME: Final = 64

# The 3D files of user models (docs/DECISIONS.md, D-013 and D-021): kept by their SHA-256 in
# <config>/domotwin/models/, uploaded by administrators, served to signed-in users.
MODELS_URL: Final = "/api/domotwin/models"
MODELS_DIR: Final = ("domotwin", "models")
MODEL_FORMATS: Final = {
    "glb": "model/gltf-binary",
    "gltf": "model/gltf+json",
    "obj": "model/obj",
    "stl": "model/stl",
    "3mf": "model/3mf",
}
MAX_MODEL_BYTES: Final = 8_000_000
MAX_MODELS_BYTES: Final = 20_000_000
MAX_MODELS: Final = 50
# A file no plan uses is deleted this long after it was uploaded (an import not saved yet).
MODEL_GRACE_SECONDS: Final = 86_400
# Overlay entries of the models imported in edit mode: "@model:<model id>".
MODEL_ENTRY_PREFIX: Final = "@model:"
