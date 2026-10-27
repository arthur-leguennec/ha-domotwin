# A room's graphs, and the home's energy

What a room measured over the last day or week, drawn by Home Assistant's own graph cards, and the
home's energy on Home Assistant's own Energy page (`DECISIONS.md`, D-068). DomoTwin draws no graph
of its own and keeps nothing: Home Assistant's cards read its recorder for you, as its dashboards
do.

## Opening a room's graphs

- **In the Rooms tab**: open a room; **Graphs** is beside the way back, when the room has
  something to graph. Its address is `/domotwin/rooms/<area>/graphs`, so that back, a bookmark
  and a link work.
- **In 3D**: long-press the room's floor; its panel has **Graphs** beside **History**. The graphs
  open in the Rooms tab; their way back leads to the room's page, and from there back to the 3D
  view, its panel still open.

## What they show

One of Home Assistant's cards for each kind of measure of the room's area, each entity by name,
eight at most a card and ten cards a room:

| Card | Holds | Home Assistant's card |
| --- | --- | --- |
| Temperature | the temperature sensors, and the thermostats (their room and target temperatures, and when they heat) | `history-graph` |
| Humidity, CO₂, particles… | each kind of sensor, by its device class (else by its unit) | `history-graph` |
| Power and the other measures | the power sensors, then any sensor with a unit | `history-graph` |
| *Energy, counted* (and water, gas…) | the meters, which only count up: what each hour (or day) added, as bars | `statistics-graph` |
| Doors and windows | their contacts, as a timeline | `history-graph` |
| Presence | motion, occupancy and presence sensors, as a timeline | `history-graph` |

Hidden, configuration and diagnostic entities are left out, as in the Rooms tab. A private room you
may not see has no graphs, and what is linked to it is left out of the others
([private rooms](privacy.md)).

**The period**: the last 24 hours or the last 7 days, which Home Assistant keeps of each change by
default (its recorder's `purge_keep_days`, 10), so that Home Assistant 2025.1 draws them too.

**As a table** opens the [history report](history.md) of the same sensors (eight at most) over the
same period; **In Home Assistant's History** opens its History page on them.

## The Energy tab

**Energy**, beside Rooms, opens Home Assistant's own Energy page rather than copying it: its
energy integration (part of `default_config`) makes it for every user. Its back arrow (Home
Assistant 2025.10 and later) leads back to the page of DomoTwin you left; on 2025.1, the browser's
back does. The tab shows once something is set up in Home Assistant's energy settings (a grid, the
sun, a battery, gas, water or a device): before, the page would only show its setup wizard, which
is in Home Assistant's settings too. Without it, there is no Energy tab: the 3D view's **Power**
layer still shows what each room draws, with the home's energy at a glance.

## In the demo house

Home Assistant's cards and pages do not know the demo house's entities: its graphs say what each
sensor says now, its table answers from its own day, and its Energy tab opens the 3D view on the
power layer, with the demo house's sun, grid and battery. The sandbox has neither: its day has a
report of its own ([sandbox](sandbox.md)).
