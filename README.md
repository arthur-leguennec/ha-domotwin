<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/hero.png" alt="DomoTwin: an isometric open-dollhouse view of a fictional apartment with glowing lamps" width="100%">
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
> (states, tap, long press, room panel, linking), the edit mode, your own 3D models, the layers and
> the devices work today; a plan editor and storeys come next. The features below describe
> version 0.1.0.

## Features

- **Your floor plan in 3D and 2D.** Import a House Maquette plan (`*.plan.json`) or one storey of an
  IFC model (`*.ifc`, from Revit, ArchiCAD, Bonsai, FreeCAD…) and see it as a clean 3D model. The
  walls facing the camera are lowered automatically, like an open dollhouse. Switch to a crisp 2D
  plan with a smooth animation.
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
  room; tap for the live picture.
- **Edit mode.** Move, rotate and stack furniture with snapping, guides and undo, add pieces from
  a catalogue, link any object to entities (with suggestions from your areas), and add your own
  furniture or appliance with its 3D model (glTF/GLB, OBJ, STL or 3MF). See
  [edit mode](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/edit-mode.md).
- **Light and smooth.** Rust compiled to WebAssembly, rendering only when something changes, quality
  presets for old wall tablets. The first load is budgeted at 1.2 MB, checked by CI.
- **Yours.** English and French, follows your Home Assistant theme, works in the companion apps.

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
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-devices.png" alt="Devices: badges over the entrance door, the TV, the camera and the washing machine, and the cone of what the living room's camera sees on the 2D plan" width="100%">
</p>

## Quick start

1. **Install.** Use the button above, or in HACS add
   `https://github.com/arthur-leguennec/ha-domotwin` as a custom repository of type *Integration*,
   install **DomoTwin** and restart Home Assistant.
2. **Add the integration.** Settings → Devices & services → Add integration → **DomoTwin**. No YAML.
3. **Import your plan.** Open **DomoTwin** in the sidebar → **Import plan** and pick your
   `*.plan.json`, or an IFC file (`*.ifc`, see [IFC
   import](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md)). No plan
   yet? Try the fictional
   [`examples/demo-apartment.plan.json`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.plan.json)
   or
   [`examples/demo-apartment.ifc`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.ifc).

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
| `room`        | a room id of the plan               | none       | Room to focus on when the card opens.     |
| `layer`       | `off`, `temperature`, `humidity`, `co2`, `pm25`, `power` | `off` | Layer shown when the card opens; the layer menu changes it. |
| `alerts`      | `true`, `false`                     | `true`     | Safety alerts of the rooms (smoke, gas, water, alarm, a window open in the rain). |
| `presence`    | `true`, `false`                     | `true`     | The rooms someone is in glow softly.      |
| `sun`         | `fixed`, `real`                     | `fixed`    | `real`: the sun lights from where it is (`sun.sun`), through the windows. |
| `badges`      | `true`, `false`                     | `true`     | Badges over the devices: locks, cameras, what plays, low batteries, appliances running. |
| `cameras`     | `true`, `false`                     | `true`     | What the linked cameras see, drawn on the floor. |
| `font_family` | a font family                       | bundled    | Font of the card's texts.                 |

Integration options (Settings → Devices & services → DomoTwin → Configure): show the panel in the
sidebar, and show it to administrators only. Only administrators can import plans, edit and bind.
The panel's settings (the cog) set where north points on the plan, for the real sun.

**Layers read your areas.** A room's heatmap value is the mean of the temperature, humidity, CO₂ or
PM2.5 sensors of its Home Assistant area (the area linked to the room, or the area with the room's
name); its alerts and presence come from the smoke, gas, carbon monoxide, moisture, safety,
occupancy, motion and presence sensors of that area, and its alarm panel. The power layer uses the
power sensors linked to each piece.

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/architecture.png" alt="How DomoTwin is built: the Home Assistant integration, the frontend and the WebAssembly engine" width="100%">
</p>

A thin Python integration stores your plan, your edits and your bindings in Home Assistant and
serves the frontend. The frontend (TypeScript) talks to Home Assistant; the engine (Rust compiled to
WebAssembly) reads the plan, builds the geometry and draws it with WebGL2. More in
[`docs/ARCHITECTURE.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ARCHITECTURE.md).

## FAQ

**Which plan formats does DomoTwin read?** The House Maquette plan format, documented in
[`docs/plan-format.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-format.md)
with its JSON Schema, and one storey of an IFC file (ISO 16739, exported by FreeCAD, Blender with
Bonsai, ArchiCAD or Revit): see [IFC
import](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md).

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
materials) is served by the integration. Diagnostics contain counts only, never names, entity ids or
geometry.

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
