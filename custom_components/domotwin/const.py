"""Constants of the DomoTwin integration."""

from __future__ import annotations

import re
from typing import Final

DOMAIN: Final = "domotwin"
VERSION: Final = "0.4.0"  # x-release-please-version

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
# The placement advisor (docs/DECISIONS.md, D-066): the Wi-Fi access points placed on the plan, at
# most this many, each named this long, at a point this far from the plan's origin at most (cm).
MAX_ACCESS_POINTS: Final = 16
MAX_ACCESS_POINT_NAME: Final = 60
MAX_PLAN_REACH: Final = 1_000_000

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

# Each user's own choices (docs/DECISIONS.md, D-055): their favourites, the tab DomoTwin opens on
# (the Safety tab since D-068) and their Home tab's cards, in a store of their own
# (.storage/domotwin.users).
CHOICES_STORAGE_KEY: Final = f"{DOMAIN}.users"
CHOICES_STORAGE_VERSION: Final = 1
START_TABS: Final = ("home", "rooms", "safety", "3d")
MAX_FAVOURITES: Final = 100
MAX_HOME_CARDS: Final = 6
MAX_CALENDARS: Final = 10

# The configuration history (docs/DECISIONS.md, D-062): each change of an automation, a script,
# a scene or a dashboard, in a store of its own (.storage/domotwin.config_history). At most this
# many bytes in all and versions an item (the oldest versions go first, an item's newest always
# kept), bytes a version (a larger one keeps its date, not its content); past this many items,
# those removed are forgotten, the longest removed first.
CONFIG_HISTORY_STORAGE_KEY: Final = f"{DOMAIN}.config_history"
CONFIG_HISTORY_STORAGE_VERSION: Final = 1
CONFIG_HISTORY_KINDS: Final = ("automation", "script", "scene", "dashboard")
MAX_CONFIG_HISTORY_BYTES: Final = 4_000_000
MAX_CONFIG_HISTORY_VERSIONS: Final = 50
MAX_CONFIG_HISTORY_VERSION_BYTES: Final = 1_000_000
MAX_CONFIG_HISTORY_ITEMS: Final = 2_000

# Dispatcher signal sent after every write: (kind, revision).
SIGNAL_UPDATED: Final = f"{DOMAIN}_updated"
# `domotwin.show` (docs/DECISIONS.md, D-029): what to show, sent to the screens: (request,).
SERVICE_SHOW: Final = "show"
SIGNAL_SHOW: Final = f"{DOMAIN}_show"
MAX_SHOW_TEXT: Final = 100
MAX_SCREEN_NAME: Final = 64
#: A screen's name (a card's `screen`, D-029): letters, digits, `_` and `-`, in any case.
SCREEN_NAME: Final = re.compile(rf"^[A-Za-z0-9_-]{{1,{MAX_SCREEN_NAME}}}$")

# The home's Wi-Fi for guests (docs/DECISIONS.md, D-060), in a private store of its own
# (.storage/domotwin.wifi): never in the plan, the logs, the diagnostics or an export.
WIFI_STORAGE_KEY: Final = f"{DOMAIN}.wifi"
WIFI_STORAGE_VERSION: Final = 1
MAX_WIFI_SCREENS: Final = 20

# Guest access (docs/DECISIONS.md, D-067): passes that open chosen rooms and devices for a while,
# in a private store of their own (.storage/domotwin.guests), read through DomoTwin's own page
# outside Home Assistant's sign-in (GUEST_URL/<secret>).
GUESTS_STORAGE_KEY: Final = f"{DOMAIN}.guests"
GUESTS_STORAGE_VERSION: Final = 1
GUEST_URL: Final = "/api/domotwin/guest"
GUEST_PAGE: Final = "guest.html"
MAX_GUEST_PASSES: Final = 20
MAX_GUEST_NAME: Final = 60
MAX_GUEST_ROOMS: Final = 200
MAX_GUEST_ENTITIES: Final = 100
# A pass lasts at most this long (days); it may start this far ahead.
MAX_GUEST_DAYS: Final = 31
MAX_GUEST_AHEAD_DAYS: Final = 366
# A pass's guests act at most this many times in this many seconds, and follow the home from at
# most this many pages at once.
MAX_GUEST_CALLS: Final = 20
GUEST_CALLS_SECONDS: Final = 5
MAX_GUEST_STREAMS: Final = 8
# The event fired with each action of a guest, which the logbook says (logbook.py).
EVENT_GUEST_ACTION: Final = f"{DOMAIN}_guest_action"
# Dispatcher signal sent when a pass is made, changed, renewed or removed: (pass id,).
SIGNAL_GUESTS: Final = f"{DOMAIN}_guests"

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

# The weekly report (docs/DECISIONS.md, D-071): its settings and the last reports, in a store of its
# own (.storage/domotwin.reports), private. At most this many reports kept (the oldest go first),
# items a section of a report (the others counted), and a summary's characters.
REPORT_STORAGE_KEY: Final = f"{DOMAIN}.reports"
REPORT_STORAGE_VERSION: Final = 1
MAX_REPORTS: Final = 8
MAX_REPORT_ITEMS: Final = 100
MAX_SUMMARY: Final = 2_000
# What needs a look, in the order a report says it.
REPORT_SECTIONS: Final = (
    "batteries",
    "unavailable",
    "updates",
    "repairs",
    "upkeep",
    "automations",
    "radios",
)
# The event fired after each report written on its day, for automations of one's own; and Home
# Assistant's notification of it, replaced by the next one.
REPORT_EVENT: Final = f"{DOMAIN}_weekly_report"
REPORT_NOTIFICATION: Final = f"{DOMAIN}_weekly_report"
