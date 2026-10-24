<p align="center">
  <img src="docs/figures/hero.png" alt="DomoTwin: an isometric open-dollhouse view of a fictional apartment with glowing lamps" width="100%">
</p>

<p align="center"><b>Your home as a live 3D twin in Home Assistant.</b><br>
Tap a lamp to switch it on, tap a room to control it, and watch your sensors come alive on the plan.<br>
Local, fast, Rust + WebAssembly.</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=arthur-leguennec&repository=ha-domotwin&category=integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open your Home Assistant instance and add this repository to HACS."></a>
</p>

<p align="center"><a href="README.fr.md">Lire en français</a></p>

> [!NOTE]
> **Status: early development.** DomoTwin is built milestone by milestone
> ([roadmap](docs/ROADMAP.md)). The integration, the panel, the card, the plan and IFC import, the
> 3D and 2D views and live control (states, tap, long press, room panel, linking) work today; the
> edit mode and layers come next. The features below describe version 0.1.0.

## Features

- **Your floor plan in 3D and 2D.** Import a House Maquette plan (`*.plan.json`) or one storey of an
  IFC model (`*.ifc`, from Revit, ArchiCAD, Bonsai, FreeCAD…) and see it as a clean 3D model. The walls facing the camera are lowered automatically, like an open dollhouse.
  Switch to a crisp 2D plan with a smooth animation.
- **Tap to control.** Tap a lamp to toggle it, long-press for brightness and colour, long-press a
  room to get every light, scene, cover, climate and media player of that room.
- **Live.** Lamps light their room in their real colour and brightness, the TV glows, blinds and
  curtains move, doors and windows open with their contact sensors.
- **Layers.** An animated heatmap of temperature, humidity or CO₂, safety alerts, presence, the real
  sun through your windows, and power consumption.
- **Edit mode.** Move, rotate and stack furniture with snapping and undo, link any object to
  entities (with suggestions from your areas), and add your own furniture or appliance with its 3D
  model.
- **Light and smooth.** Rust compiled to WebAssembly, rendering only when something changes, quality
  presets for old wall tablets. The first load is budgeted at 1.2 MB, checked by CI.
- **Yours.** English and French, follows your Home Assistant theme, works in the companion apps.

<p align="center">
  <img src="docs/figures/screenshot-3d.png" alt="The fictional demo apartment in 3D: walls facing the camera are lowered, furniture in every room" width="49%">
  <img src="docs/figures/screenshot-plan.png" alt="The same apartment as a 2D plan seen from above" width="49%">
</p>

<p align="center">
  <img src="docs/figures/screenshot-live.png" alt="Live control in the evening: a long press on a lamp opens its controls, a long press on a room's floor opens the room panel" width="100%">
</p>

## Quick start

1. **Install.** Use the button above, or in HACS add `https://github.com/arthur-leguennec/ha-domotwin`
   as a custom repository of type *Integration*, install **DomoTwin** and restart Home Assistant.
2. **Add the integration.** Settings → Devices & services → Add integration → **DomoTwin**. No YAML.
3. **Import your plan.** Open **DomoTwin** in the sidebar → **Import plan** and pick your
   `*.plan.json`, or an IFC file (`*.ifc`, see [IFC import](docs/ifc-import.md)). No plan yet? Try
   the fictional [`examples/demo-apartment.plan.json`](examples/demo-apartment.plan.json) or
   [`examples/demo-apartment.ifc`](examples/demo-apartment.ifc).

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
| `font_family` | a font family                       | bundled    | Font of the card's texts.                 |

Integration options (Settings → Devices & services → DomoTwin → Configure): show the panel in the
sidebar, and show it to administrators only. Only administrators can import plans, edit and bind.

## How it works

<p align="center">
  <img src="docs/figures/architecture.png" alt="How DomoTwin is built: the Home Assistant integration, the frontend and the WebAssembly engine" width="100%">
</p>

A thin Python integration stores your plan, your edits and your bindings in Home Assistant and
serves the frontend. The frontend (TypeScript) talks to Home Assistant; the engine (Rust compiled
to WebAssembly) reads the plan, builds the geometry and draws it with WebGL2. More in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## FAQ

**Which plan formats does DomoTwin read?** The House Maquette plan format, documented in
[`docs/plan-format.md`](docs/plan-format.md) with its JSON Schema. An import of IFC files (ISO 16739,
exported by FreeCAD, Blender with Bonsai, ArchiCAD or Revit) is planned.

**Does it need an internet connection?** No. See [Privacy](#privacy).

**Will it run on my wall tablet?** It needs WebGL2, available in current browsers and in the Home
Assistant companion apps. On old devices DomoTwin picks the Eco preset and renders only when
something changes, so an idle view costs almost nothing.

**Who can change the plan?** Everyone can view and use DomoTwin; only administrators can import a
plan, edit it and change bindings.

**What happens to my data if I remove the integration?** The stored plan, edits and bindings are
deleted. Use **Export plan** first to keep a copy.

## Privacy

DomoTwin talks only to your own Home Assistant. It makes no other network call: no CDN, no
telemetry, no analytics, no web fonts. Every file it uses (JavaScript, WebAssembly, fonts, materials)
is served by the integration. Diagnostics contain counts only, never names, entity ids or geometry.

## Contributing

Contributions are welcome: see [`CONTRIBUTING.md`](CONTRIBUTING.md). Security issues: see
[`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE). The plan format specification and schema are reused under the MIT licence, and the
bundled third-party components are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
