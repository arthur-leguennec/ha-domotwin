# Bindings

A binding links an element of the plan (a lamp, a door, a window, a curtain, a room…) to one or more
Home Assistant entities and says what a tap and a long press do. Bindings are stored by the
integration beside the plan, keyed by element id, so re-importing an updated plan keeps them.

> Status: the stored format below has not changed since M0. Since M2 the scene follows the bound
> entities, taps and long presses act on them, and administrators link elements from the panel.
> The full editor (any action, entity search everywhere) comes with the edit mode in M3.

![Long press on a lamp: its controls. Long press on a floor: the room panel](figures/screenshot-live.png)

## Stored format

```json
{
  "version": 1,
  "rooms": {
    "living": { "area": "living_room" }
  },
  "elements": {
    "pendant-living": {
      "entities": [{ "entity_id": "light.living_room_pendant" }],
      "tap_action": { "action": "toggle" },
      "hold_action": { "action": "controls" }
    },
    "floor-lamp": {
      "entities": [
        { "entity_id": "light.living_room_floor_lamp" },
        { "entity_id": "sensor.floor_lamp_power", "role": "power" }
      ]
    }
  }
}
```

A complete example for the demo apartment is in
[`examples/demo-apartment.bindings.json`](../examples/demo-apartment.bindings.json).

### `rooms`

| Field  | Type   | Notes                                                                      |
| ------ | ------ | -------------------------------------------------------------------------- |
| `area` | string | Home Assistant area id. Room panels and layers use the area's entities.    |

### `elements`

| Field         | Type   | Default              | Notes                                                 |
| ------------- | ------ | -------------------- | ----------------------------------------------------- |
| `entities`    | array  | required (1–16)      | `{ entity_id, role? }`, see roles below.               |
| `tap_action`  | object | from the first role  | See actions.                                          |
| `hold_action` | object | `{ "action": "controls" }` | Long press.                                     |

**Roles.** When `role` is absent it is derived from the domain and the device class:

| Role       | Derived from                                                  | Used for                       |
| ---------- | ------------------------------------------------------------- | ------------------------------ |
| `light`    | `light.*`                                                     | glow, colour, brightness       |
| `switch`   | `switch.*`, `input_boolean.*`                                 | on/off look                    |
| `fan`      | `fan.*`                                                       | on/off, blades                 |
| `cover`    | `cover.*`                                                     | curtains, blinds, position     |
| `media`    | `media_player.*`                                              | TV screen glow, media controls |
| `contact`  | `binary_sensor.*` with class `door`, `window`, `opening`, `garage_door` | doors and windows open |
| `lock`     | `lock.*`                                                      | alerts, door look              |
| `power`    | `sensor.*` with class `power`                                 | power layer                    |
| `climate`  | `climate.*`                                                   | room panel                     |
| `sensor`   | any other entity                                              | labels, layers                 |

### Actions

The same shape as Home Assistant dashboard actions:

| `action`         | Other fields                                   | Effect                                       |
| ---------------- | ---------------------------------------------- | -------------------------------------------- |
| `toggle`         | `entity_id?`                                   | Toggles the primary entity (or the one given). |
| `more-info`      | `entity_id?`                                   | Opens Home Assistant's more-info dialog.     |
| `perform-action` | `perform_action`, `data?`, `target?`           | Calls a service (`call-service` and `service` are accepted as aliases). |
| `navigate`       | `navigation_path`                              | Navigates inside Home Assistant.             |
| `controls`       | –                                              | Opens DomoTwin's in-scene popover.           |
| `none`           | –                                              | Does nothing.                                |

Default tap: `toggle` for lights, switches, fans and covers, `more-info` otherwise.

## In the scene

The engine receives only the bound entities, and only when their state changes. What it shows:

| Element | Entities | What changes |
| --- | --- | --- |
| Lamp (any light kind) | `light` | Glows in the light's colour (`rgb_color`, else `color_temp_kelvin`), at its brightness × the lamp's `lightPower`; lights its own room. Fades in and out. |
| Lamp | `switch` | On or off, in the plan's light colour. |
| TV | `media` | The screen glows while playing, dimmer when paused or idle, and lights the room in front of it. |
| Curtain | `cover` | Opens with `current_position` (else open/closed). |
| Window | `cover` | A roller blind comes down as the cover closes. |
| Window | `contact` | Open (casements inward) while the contact is on. |
| Door | `contact`, `cover` | Opens while the contact is on, or with the cover's position. |
| Any | all entities of a shown role `unavailable` or missing | Greyed out, gives no light. |

Lamps not bound keep the plan's state (`lightOff`). Lamps count less in daylight: a lamp lit at noon
barely shows, at night it lights its room (`DECISIONS.md`, D-016). At most 16 lamps light the scene
at once, the strongest first.

## Tap and long press

- **Tap** a bound element: its `tap_action`, with a short blue flash. A failed action shows a short
  message with Home Assistant's reason.
- **Tap** anything else: frames its room. The room's name appears at the bottom; tap it (or press
  Enter) for the room panel.
- **Long press** a bound element: its `hold_action`, by default DomoTwin's controls: a switch,
  brightness, warmth and colours for lights, open/stop/close and position for covers, media
  buttons and volume, lock, climate target, scene activation, the state of sensors.
- **Long press** the floor of a room: the room panel, from the room's area (below): lights, scenes,
  blinds and curtains, climate, media, other devices, and **All lights off**.
- **Double tap**: the whole home.

### The room's area

A room uses the area of its `rooms` binding. Without one, an area with the same name as the room
(ignoring case and accents) is used, so "Living room" finds the area "Living room" without any
setup. Hidden entities and configuration or diagnostic entities are left out.

## Linking in the panel

Administrators get **Link entities** in the DomoTwin panel. In this mode a tap picks an element
instead of acting on it, and opens its editor:

- **Linked entities**, each with its role, and a button to unlink it.
- **Suggestions** from the room's area: the entities that fit the element, best first, those
  already linked left out. Lamps take lights and switches, fans fans and lights, curtains covers,
  TVs media players, doors door contacts, locks and garage covers, windows window contacts and
  covers, appliances power sensors and switches.
- **Search** by name or entity id, accents ignored.
- **On tap**: automatic (from the first role), toggle, more info or nothing. An action written by
  hand in the file (`perform-action`, `navigate`…) is kept as it is.
- For a room: its **Home Assistant area**, with the one found by name preselected.

Each save applies this one change to the latest stored bindings and sends the revision it read: if
another device saved in between, the save is refused with a message instead of overwriting it.
Every view follows the new bindings at once.

![Linking a lamp: linked entities, suggestions from its room, search and the tap action](figures/screenshot-link.png)

## Limits

At most 2 000 bound elements and 16 entities per element; ids up to 100 characters.
