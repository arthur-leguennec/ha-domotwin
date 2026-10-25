<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-neon.png" alt="DomoTwin: a fictional apartment in the neon look, its walls of glass outlined in cyan, its lamps on, the rooms named on their floors" width="100%">
</p>

<p align="center"><b>Your home as a live 3D twin in Home Assistant.</b><br>
Tap a lamp to switch it on, tap a room to control it, and watch your sensors come alive on the plan.<br>
Local, fast, Rust + WebAssembly.</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=arthur-leguennec&repository=ha-domotwin&category=integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open your Home Assistant instance and add this repository to HACS."></a>
</p>

<p align="center"><a href="https://github.com/arthur-leguennec/ha-domotwin/blob/main/README.fr.md">Lire en français</a></p>

> [!NOTE]
> **Status: early development.** DomoTwin is built milestone by milestone
> ([roadmap](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ROADMAP.md)). The
> integration, the panel, the card, the plan and IFC import, the 3D and 2D views, live control
> (states, tap, long press, room panel, linking), the edit mode, your own 3D models, the layers, the
> devices, the plan editor, storeys, the looks, every storey at once, walking, the kiosk, the
> network map, the automation wires, the upkeep cards, the people in their rooms and Bluetooth
> locating work today;
> more imports come next. The features below describe version 0.1.0.

## Features

- **Your floor plan in 3D and 2D.** Draw it in the panel, or import an IFC model (`*.ifc`, from
  Revit, ArchiCAD, Bonsai, FreeCAD…) or a DomoTwin plan (`*.domotwin.json`), one storey or all of
  them, and see it as a clean 3D model. The
  walls facing the camera are lowered automatically, like an open dollhouse. Switch to a crisp 2D
  plan with a smooth animation.
- **Five looks.** **Neon**: walls of glass outlined in a glowing accent colour over a grid,
  lamps and screens that shine; **blueprint**: white lines on blue; **day**: the home as it is, in
  the light of the time of day; **cartoon**: flat bright colours inked in black, under a blue sky;
  **clay model**: the home in matte clay, like an architect's model. Automatic: neon in Home
  Assistant's dark mode. See
  [looks](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/looks.md).
- **Tap to control.** Tap a lamp to toggle it, long-press for brightness and colour, long-press a
  room to get every light, scene, cover, climate and media player of that room.
- **Live.** Lamps light their room in their real colour and brightness, the TV glows, blinds and
  curtains move, doors and windows open with their contact sensors.
- **Layers.** An animated heatmap of temperature, humidity, CO₂ or fine particles read from the
  sensors of each room's area, safety alerts that pulse in their room (smoke, gas, water leak,
  alarm, a window open in the rain), the rooms someone is in, the real sun coming in through your
  windows, and what each appliance draws.
- **Devices.** Badges over your devices (a lock's state, a camera recording, what plays, a battery
  running low, the washing machine running), and what each camera sees drawn on the floor of its
  room, behind the furniture, faint until you tap the camera; tap for the live picture.
- **Network map.** Your Zigbee mesh drawn over the home: each device at its piece, each link an arc
  coloured by its quality, light running towards the coordinator, and the rooms that hang on a weak
  link named, with *a router here would help*. Tap a device or a link for the details, rescan,
  and place the devices the map cannot find. For administrators, with ZHA. See [the network
  map](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/network.md).
- **Automation wires.** Long-press a lamp: its panel lists the automations that involve it, with
  their switch and when they last ran. Show their wires, from what sets them off to what they act
  on, and watch a pulse run along them when one runs. Or every automation of the home at once.
  See [automation
  wires](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/automations.md).
- **Upkeep cards.** Every appliance and piece of furniture can carry its make, model, serial
  number, warranty, manual and the tasks that come back (change the filter every 3 months). A
  wrench badge shows what is due, the upkeep layer tints the pieces green, amber or red, and a
  list by date has a **Done** button for everyone. An IFC file fills the cards; one sensor,
  `sensor.domotwin_upkeep_due`, is there for your notifications. See [upkeep
  cards](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/upkeep.md).
- **People in their rooms.** Everyone at home stands in their room as a figure in their colour,
  their name above, and walks through the doors when they move. DomoTwin places them from what
  already says where they are (Bermuda's or ESPresense's room sensors, or any entity naming a
  room); the room's panel says who is there, and Assist answers "where is Alex?". Anyone can hide
  themselves. See [people in their
  rooms](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/people.md).
- **Bluetooth locating.** No Bermuda? DomoTwin finds the room of a phone, a watch or a tag itself,
  from what Home Assistant's Bluetooth receivers hear (its adapter, ESPHome proxies, Shelly
  devices). It starts from the plan (distances, walls, doors, floors), so it works from the first
  minute, and learns as rooms are taught and presence sensors agree. Phones place their owners;
  keys left behind are told; "where are my keys?" by voice. See [Bluetooth
  locating](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/bluetooth.md).
- **Plan editor.** No plan to import? Draw one in the panel: rooms as polygons with their lengths,
  partitions, doors and windows placed on the walls, with snapping and undo. See [plan
  editor](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-editor.md).
- **Storeys.** A cellar, floors above, an attic: one plan each, a switcher in the view, stairs that
  take you up a tap at a time, and the alerts of every storey wherever you are. Or the whole home
  at once, its storeys spread apart under a roof, each with its label and a picture, live on every
  floor. See
  [storeys](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/storeys.md).
- **Edit mode.** Move, rotate and stack furniture with snapping, guides and undo, add pieces from
  a catalogue, link any object to entities (with suggestions from your areas), and add your own
  furniture or appliance with its 3D model (glTF/GLB, OBJ, STL or 3MF). See
  [edit mode](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/edit-mode.md).
- **Walk through it, hang it on the wall, ask for it.** Walk through your home at eye level, from
  room to room through the doors. On a wall tablet, a card goes back to its view when left alone,
  turns slowly and dims at night. Say "show the kitchen" to Assist and your screens show it. See
  [walking, kiosks and your voice](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/kiosk.md).
- **Light and smooth.** Rust compiled to WebAssembly, rendering only when something changes, quality
  presets for old wall tablets. The first load is budgeted at 1.2 MB, checked by CI.
- **Yours.** English and French, follows your Home Assistant theme, works in the companion apps.

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-looks.png" alt="The demo apartment in the evening in three looks: neon, blueprint and day" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-cartoon-clay.png" alt="The demo apartment in the day in the cartoon look, its furniture and people inked in black on bright floors under a blue sky, and in the clay model look, all in one warm matte clay" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-3d.png" alt="The fictional demo apartment in 3D: walls facing the camera are lowered, furniture in every room" width="49%">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-plan.png" alt="The same apartment as a 2D plan seen from above" width="49%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-edit.png" alt="Edit mode: a piece dragged on the 2D plan snaps onto a wall, with the distances to the other walls; the catalogue of pieces to add" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-live.png" alt="Live control in the evening: a long press on a lamp opens its controls, a long press on a room's floor opens the room panel" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-layers.png" alt="Layers: the temperature of each room as a heatmap with its legend, the power drawn by the appliances, a smoke alert pulsing in the kitchen, and the sun coming in through the windows" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-devices.png" alt="Devices: badges over the entrance door, the TV, the camera and the washing machine, and what the living room's camera sees, a fan with a ring every metre on the floor of the 2D plan" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-network.png" alt="The network map: the Zigbee devices of the demo apartment on their pieces, linked by arcs in green, amber and red, and a sheet with a router's details, the mesh's health and a sensor not placed in the home" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-automations.png" alt="Automation wires: every automation of the demo apartment drawn from the TV and the entrance door to the lamps and curtains, with labels floating above the home for the sun, a time, a notification and what a template decides" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-people.png" alt="People in their rooms: the demo apartment in the neon look, Sam a glowing blue figure in the living room and Alex a pink one in the kitchen, each with their name above" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-bluetooth.png" alt="Bluetooth locating: the settings over the demo apartment, three receivers and how each is placed, Alex's phone and keys followed in the kitchen, a watch heard that may be followed" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-upkeep.png" alt="The upkeep layer: the washing machine of the demo apartment in red as its filter is late, the fridge in amber as its coils are due soon, the fan and the hob in green, beside the list of tasks by date with Done buttons" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-plan-editor.png" alt="The plan editor: a corner of the living room dragged with the lengths of its sides, and a room drawn beside the home" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-storeys.png" alt="Storeys: the floor above the demo apartment with its stairs and the storey switcher, and the dialog listing the storeys with their names and floor heights" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-home.png" alt="Every storey at once: the demo apartment's two storeys spread apart under a glass roof in the neon look, each with its label (rooms, lights on) and a picture of each storey on the left" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-walk.png" alt="Walking through the demo apartment's living room at eye level in the evening, its lamps on, with the walk pad in the corner" width="100%">
</p>

## Quick start

1. **Install.** Use the button above, or in HACS add
   `https://github.com/arthur-leguennec/ha-domotwin` as a custom repository of type *Integration*,
   install **DomoTwin** and restart Home Assistant.
2. **Add the integration.** Settings → Devices & services → Add integration → **DomoTwin**. No YAML.
3. **Draw or import your plan.** Open **DomoTwin** in the sidebar → **Draw a plan**, or
   **Import plan** and pick a DomoTwin plan (`*.domotwin.json`) or an IFC file (`*.ifc`, see [IFC
   import](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md)). No plan
   yet? Try the fictional
   [`examples/demo-apartment.domotwin.json`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.domotwin.json)
   or
   [`examples/demo-apartment.ifc`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.ifc),
   or **Draw a plan** in the app.

Then add the **DomoTwin** card to any dashboard from the card picker.

## Configuration

Everything is set from the user interface: the integration options and the visual card editor.
YAML is never required. For reference, the card options are:

| Option        | Values                              | Default    | Description                               |
| ------------- | ----------------------------------- | ---------- | ----------------------------------------- |
| `type`        | `custom:domotwin-card`              | required   |                                           |
| `title`       | text                                | none       | Card header.                              |
| `view`        | `3d`, `2d`                          | `3d`       | View shown when the card opens.           |
| `height`      | CSS length (`400px`, `60vh`…)       | 4:3 ratio  | Fixed height; in sections the grid decides. |
| `quality`     | `auto`, `eco`, `balanced`, `high`   | `auto`     | Rendering quality; `auto` adapts to the device. |
| `cutaway`     | `auto`, `always`, `off`             | `auto`     | How walls facing the camera are lowered.  |
| `lighting`    | `auto`, `morning`, `day`, `evening`, `night` | `auto` | The light of the scene. `auto` follows the sun of your Home Assistant (`sun.sun`), or the clock without it. |
| `storey`      | a storey id (`storey-2`…), `all`    | ground floor | Storey shown when the card opens, `all` for every storey at once; the switcher changes it. |
| `spread`      | `true`, `false`                     | `true`     | Every storey at once: spread apart, or stacked. |
| `roof`        | `true`, `false`                     | `true`     | Every storey at once: the roof over the top one. |
| `room`        | a room id of the plan               | none       | Room to focus on when the card opens.     |
| `layer`       | `off`, `temperature`, `humidity`, `co2`, `pm25`, `power`, `network`, `automations`, `upkeep` | `off` | Layer shown when the card opens; the layer menu changes it. `network` shows to administrators with ZHA only, `automations` to administrators. |
| `alerts`      | `true`, `false`                     | `true`     | Safety alerts of the rooms (smoke, gas, water, alarm, a window open in the rain). |
| `presence`    | `true`, `false`                     | `true`     | The rooms someone is in glow softly.      |
| `people`      | `true`, `false`                     | `true`     | The people in their rooms, as figures.    |
| `sun`         | `fixed`, `real`                     | `fixed`    | `real`: the sun lights from where it is (`sun.sun`), through the windows. |
| `badges`      | `true`, `false`                     | `true`     | Badges over the devices: locks, cameras, what plays, low batteries, appliances running. |
| `cameras`     | `true`, `false`                     | `true`     | What the linked cameras see, drawn on the floor. |
| `theme`       | `auto`, `day`, `neon`, `blueprint`, `cartoon`, `clay` | the home's | The look; `auto` is neon in dark mode. |
| `accent`      | a colour `#rrggbb`                  | the home's | Accent of the look (neon's glowing outlines). |
| `names`       | `true`, `false`                     | `true`     | The rooms' names on their floors.         |
| `idle`        | seconds (0 to 86400)                | `0`        | Kiosk: back to this view after this long untouched (0: never). |
| `orbit`       | `true`, `false`                     | `false`    | Kiosk: a slow turn around the home meanwhile. |
| `night_dim`   | `true`, `false`                     | `false`    | Kiosk: dimmed at night meanwhile (unless an alert shows). |
| `tools`       | `true`, `false`                     | `true`     | The view's buttons.                       |
| `screen`      | a name (`hallway`…)                 | none       | This screen's name, for `domotwin.show`.  |
| `font_family` | a font family                       | bundled    | Font of the card's texts.                 |

Integration options (Settings → Devices & services → DomoTwin → Configure): show the panel in the
sidebar, and show it to administrators only. Only administrators can import plans, edit and bind.
The panel's settings (the cog) set where north points on the plan, for the real sun.

**Layers read your areas.** A room's heatmap value is the mean of the temperature, humidity, CO₂ or
PM2.5 sensors of its Home Assistant area (the area linked to the room, or the area with the room's
name); its alerts and presence come from the smoke, gas, carbon monoxide, moisture, safety,
occupancy, motion and presence sensors of that area, and its alarm panel. The power layer uses the
power sensors linked to each piece. The network map places each Zigbee device at the piece linked
to its device or to one of its entities.

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/architecture.png" alt="How DomoTwin is built: the Home Assistant integration, the frontend and the WebAssembly engine" width="100%">
</p>

A thin Python integration stores your plan, your edits and your bindings in Home Assistant and
serves the frontend. The frontend (TypeScript) talks to Home Assistant; the engine (Rust compiled to
WebAssembly) reads the plan, builds the geometry and draws it with WebGL2. More in
[`docs/ARCHITECTURE.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ARCHITECTURE.md).

## FAQ

**Which plan formats does DomoTwin read?** Its own plan format, documented in
[`docs/plan-format.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-format.md)
with its JSON Schema, and IFC files (ISO 16739, exported by FreeCAD, Blender with Bonsai, ArchiCAD
or Revit), one storey or every storey at once: see [IFC
import](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md).

**Can I put it on a wall tablet, or ask for a room by voice?** Yes: the `idle`, `orbit`,
`night_dim` and `tools` options make a card a kiosk, and the `domotwin.show` action (with a
blueprint for Assist) shows a room on your screens. See [walking, kiosks and your
voice](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/kiosk.md).

**My home has several floors.** Each floor is a storey with its own plan: **Storeys** in the panel
adds one (imported or drawn), names it and sets its height; the view switches between them or
shows them all at once, and a card can open on any of them or on the whole home. See
[storeys](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/storeys.md).

**Can I draw my home without another program?** Yes: **Draw a plan** in the panel (or **Edit
plan** to change one), see [plan
editor](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-editor.md).

**Can I use my own furniture?** Yes: in edit mode, **Import a 3D model** takes a glTF/GLB, OBJ, STL
or 3MF file up to 8 MB. Give its real size; it is placed, stacked and linked like any piece, kept
by Home Assistant and included in **Export plan**.

**Does it need an internet connection?** No. See
[Privacy](https://github.com/arthur-leguennec/ha-domotwin#privacy).

**Will it run on my wall tablet?** It needs WebGL2, available in current browsers and in the Home
Assistant companion apps. On old devices DomoTwin picks the Eco preset and renders only when
something changes, so an idle view costs almost nothing.

**Who can change the plan?** Everyone can view and use DomoTwin; only administrators can import a
plan, edit it and change bindings.

**What happens to my data if I remove the integration?** The stored plan, edits, bindings and 3D
model files are deleted. Use **Export plan** first to keep a copy (it includes the 3D files).

## Privacy

DomoTwin talks only to your own Home Assistant. It makes no other network call: no CDN, no
telemetry, no analytics, no web fonts. Every file it uses (JavaScript, WebAssembly, fonts,
materials) is served by the integration. Diagnostics contain counts only, never names, entity ids,
device ids, Zigbee addresses or geometry.

## Contributing

Contributions are welcome: see
[`CONTRIBUTING.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/CONTRIBUTING.md).
Security issues: see
[`SECURITY.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/SECURITY.md).

## Licence

[MIT](https://github.com/arthur-leguennec/ha-domotwin/blob/main/LICENSE). The plan format
specification and schema are reused under the MIT licence, and the bundled third-party components
are listed in
[`THIRD_PARTY_NOTICES.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/THIRD_PARTY_NOTICES.md).
