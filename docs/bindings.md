# Bindings

A binding links an element of the plan (a lamp, a door, a window, a curtain, a room…) to one or more
Home Assistant entities and says what a tap and a long press do. Bindings are stored by the
integration beside the plan, keyed by element id, so re-importing an updated plan keeps them.

> Status: the stored format below is fixed in M0 so that storage never needs a breaking migration.
> Suggestions from areas, the editor and the live rendering arrive in M2.

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

## Limits

At most 2 000 bound elements and 16 entities per element; ids up to 100 characters.
