# Walking, kiosks and your voice

DomoTwin is made to live on a wall tablet as well as on a dashboard: you can walk through your home
at eye level, let a kiosk go back to its view and dim at night on its own, and have Home Assistant,
an automation or your voice show a room on your screens.

![Walking through the demo apartment's living room at eye level, its lamps on](figures/screenshot-walk.png)

## Walking

The **walk** button (a walking figure, under the overview's) takes you into the storey shown, at
eye level, where the camera was looking (or into the nearest room), facing the widest view. The walls
stay whole and the rooms have their ceilings (in the day look; the night looks keep the sky above).

- **Look around**: drag (one finger or two, or the mouse).
- **Go somewhere**: tap the floor there. The walk goes through the doors, the shortest way from
  room to room, turning towards where it goes.
- **Walk**: hold the pad's arrows (ahead, back, to the left or right), or the keys: ↑/↓ or W/S (Z/S
  on AZERTY) ahead and back, A/D (Q/D) to the sides, ← and → to turn. The wheel and a pinch step
  ahead or back.
- **Leave**: the walk button again, the overview's button, a double tap, or Esc.

You walk through doors and the open sides between rooms, never through walls, partitions or
windows; furniture is not in the way. A tap on a wall does nothing (the floor behind it is not in
sight). A lamp, a TV or anything linked still answers a tap, and stairs still take you up (you walk
on upstairs). Edit mode, linking and the plan editor work from above: starting one ends the walk.

## A kiosk on the wall

A card on a wall tablet can go back to the view it opened on when nobody touches it for a while,
turn slowly around the home meanwhile, and dim at night:

```yaml
type: custom:domotwin-card
idle: 120          # back to this view after 2 minutes untouched (0: never)
orbit: true        # a slow turn around the home meanwhile
night_dim: true    # dimmed at night meanwhile (sun below the horizon)
tools: false       # no buttons: the home alone
screen: hallway    # the name domotwin.show uses for this screen
```

- **Back to its view**: its storey, 2D or 3D (`view`), its room (`room`) or the whole home; open
  panels close and a walk ends.
- **The slow turn** (`orbit`) starts after `idle` seconds untouched (a minute without `idle`), goes
  round in two and a half minutes, at 20 frames per second, and stops at the first touch. It does
  not run with *reduce motion* on, on the 2D plan, or in the dark.
- **Dimmed at night** (`night_dim`): when the sun is below the horizon (`sun.sun`, else from 22:00
  to 07:00), after `idle` seconds untouched (a minute without `idle`). An alert (smoke, water, an
  alarm…) keeps the screen bright.
- A touch, a click, a key or the wheel wakes it up at once. On a dimmed screen, the touch or key
  that wakes it does nothing else: what it was on could not be seen.

## Showing something from Home Assistant: `domotwin.show`

The **`domotwin.show`** action (Developer tools → Actions, scripts, automations) shows something
on every DomoTwin screen, cards and panel, or on one card:

| Field     | What it does |
| --------- | ------------ |
| `room`    | A room, by its name or its id, on any storey: its storey is shown and the room framed. |
| `element` | Any element of the plan (a lamp, the sofa, a door), by its name or its id: framed. |
| `storey`  | A storey, by its name, its id or its number (`0` the ground floor, `1` above, `-1` below), or `all` for every storey at once. |
| `view`    | `overview`, `3d`, `2d`, `walk` (at eye level on the storey of the room or element given, walking into the room or up to the element), or the name of a saved viewpoint. |
| `screen`  | The card to show it on (its `screen` option); none for every screen. |

Names are found as said: case, accents and a leading article do not matter (`the kitchen`, `Entrée`,
`l'entrée`). A request naming a screen is for the card with that `screen` only; the panel answers the
requests without one. A screen running edit mode, linking or the plan editor lets requests pass.

```yaml
# When the doorbell rings, the hallway tablet shows the entrance.
actions:
  - action: domotwin.show
    data:
      room: Entrance
      view: overview
      screen: hallway
```

## Your voice: Assist

Import the blueprint (Settings → Automations & scenes → Blueprints → **Import blueprint**) from
`https://github.com/arthur-leguennec/ha-domotwin/blob/main/blueprints/automation/domotwin/show_by_voice.yaml`,
then make an automation from it. Say "**show the kitchen**" (or "**montre la cuisine**") to Assist on
your phone, a voice satellite or a tablet: the screens frame the kitchen, and Assist answers. The
blueprint chooses the sentences (with `{room}` in them), the screen and how to show it (from above,
walking there, on the 2D plan). A storey's name works too ("show the attic").

Everything runs in Home Assistant: the speech is Assist's (local with Whisper and Piper, or the
voice service you chose), and DomoTwin itself makes no call outside your Home Assistant.

## Limits

Walking goes through the doors of the storey shown; to go upstairs, take the stairs (or the
switcher). Furniture does not stop a walker. A kiosk's wait and dimming follow the clock of the
tablet; the night is the sun's when `sun.sun` exists.
