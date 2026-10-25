# Roadmap

DomoTwin is built milestone by milestone, with one pull request per milestone. Each milestone ends
with this file updated: what was done, what was measured and what was left for later.

Legend: ✅ done · 🚧 in progress · ⏳ planned · ❓ needs a decision from the maintainer

| Milestone | Scope                                                      | Status |
| --------- | ---------------------------------------------------------- | ------ |
| M0        | Scaffold: workspace, integration skeleton, CI, docs, demo  | ✅     |
| M1        | Render: plan, walls, openings, furniture, 2D/3D, cut-away  | ✅     |
| M2        | Live control: bindings, tap, long-press, room panel        | ✅     |
| M1b       | IFC import (ISO 16739), one storey → plan                  | ✅     |
| M3        | Edit mode: move, rotate, stack, undo, save, card editor    | ✅     |
| M3b       | Your own furniture and appliances with their 3D model      | ✅     |
| M4        | Layers: heatmap, alerts, presence, real sun, power         | ✅     |
| M5        | Devices: cameras and what they see, locks, appliances      | ✅     |
| M6        | Plan editor: draw rooms, walls, doors and windows          | ✅     |
| M7        | Storeys: several floors, stairs, a storey switcher         | ✅     |
| M8        | Looks: neon, blueprint and day, glowing outlines, bloom    | ✅     |
| M9        | Every storey at once: stacked, spread apart, with a roof   | ✅     |
| M10       | Kiosk: walk mode, idle and night modes, Assist voice       | ✅     |
| M10b      | DomoTwin's own plan format, `*.domotwin.json`              | ✅     |
| M9b       | Network map: the Zigbee mesh over the home (ZHA)           | ✅     |
| M9c       | Automation wires: what sets off what, drawn in 3D          | ✅     |
| M9d       | Upkeep cards: makes, warranties, recurring tasks           | ✅     |
| M9e       | People in their rooms, live                                | ✅     |
| M9f       | Bluetooth locating, without Bermuda or ESPresense          | ✅     |
| M8b       | Two more looks: cartoon and clay                           | ✅     |
| 0.1.0     | First release: all of the above, `domotwin.zip` for HACS   | ✅     |
| M5b       | What cameras see, drawn on the floor behind the furniture  | ⏳     |
| M9g       | Private rooms: locked, or kept for some people             | ⏳     |
| M11       | Imports: Sweet Home 3D, DXF, room scans                    | ⏳     |
| M12       | Polish: design, fonts, accessibility, voice, README        | ⏳     |
| M12b      | Size and speed: a pass that keeps the picture as it is     | ⏳     |
| M13       | Release 0.2.0 and HACS submission checklist                | ⏳     |

M5 to M11 were added after M3b (`DECISIONS.md`, D-022): what people expect of a 3D home dashboard,
with no account and no network call outside Home Assistant. M8 became the looks alone, and the
storeys seen together their own milestone (M9), so that the picture comes first (D-027). M10b
replaced the plan format DomoTwin started from with its own (D-030); M9b to M9f and M8b were asked
for after M10, and come before the imports. The maintainer then moved the first release forward
(D-037): 0.1.0 is everything done up to M8b. What cameras see drawn on the floor (M5b), private
rooms (M9g), the imports (M11), the polish (M12) and a pass over size and speed that keeps the
picture as it is (M12b) come before a second release, 0.2.0, with the submission to HACS's default
list (M13).

## M0, scaffold

Goal: every piece exists, every check runs and is green, nothing is rendered yet.

- ✅ Cargo workspace (`domotwin-core`, `domotwin-render`, `domotwin-web`) with a pinned toolchain and
  exact dependency versions; `cargo fmt`, `clippy -D warnings`, unit tests, `wasm-bindgen-test` in
  headless Chromium, `cargo deny`.
- ✅ Fuzz target for the plan reader (`cargo-fuzz`, scheduled job).
- ✅ Home Assistant integration `custom_components/domotwin`: config flow (no YAML), options flow,
  versioned storage with migrations, websocket API (admin-only writes), static files, sidebar panel,
  dashboard card module, diagnostics, English and French translations.
- ✅ Frontend: `domotwin-card`, `domotwin-panel` and the card editor as Lit custom elements, wasm
  loading, render-on-demand loop skeleton with off-screen and hidden-tab pauses, i18n (en, fr).
- ✅ CI: Rust, frontend, Python (`ruff`, `mypy`, `pytest`, `hassfest`, HACS validation), E2E
  (Playwright with a mocked `hass`), bundle-size budget, frame-time smoke test, gitleaks, CodeQL,
  Dependabot, release-please, Conventional Commit PR titles. Every action is pinned by commit SHA and
  every workflow declares least-privilege `permissions:`.
- ✅ Secret scanning: gitleaks in CI (full history on `main`) and in `pre-commit`.
- ✅ Docs skeleton and a fictional demo apartment with bindings (`examples/`).

Measured at the end of M0: see [`PERFORMANCE.md`](PERFORMANCE.md).

## M1, render

- ✅ Core: strict-structure, lenient-field plan reader with stable error codes
  (and the element at fault) translated in English and French, the clean plan model, validation of
  every rule of `plan-format.md`. Fuzzed. The editing checks (overlaps, blocked doors) move to M3,
  where they are shown.
- ✅ Core geometry: room polygons, implicit walls (interior partitions centred on shared limits,
  façades outside the polygon, per-side thickness, open sides, filled outer corners), openings cut into walls, wall heights and finishes, door sweeps,
  wall groups for the cut-away, the furniture catalogue (55 kinds with defaults, light and soft
  flags).
- ✅ Render: three-d's core layer on WebGL2 with DomoTwin's own shaders (D-014). The whole home is
  two merged meshes (one draw call each), which beats instancing here. Procedural models for every
  kind, procedural floors (plain, planks, tiles),
  wall finishes (plain, wainscot, chair rail, tiles, paint), skirting boards and cornices,
  doors and windows with all their styles and their `open` fraction, lit lamps glowing in their
  colour, soft contact shadows, user models made from kits (file models as boxes until M3).
- ✅ Camera: orbit with mouse, touch and pinch, pan, zoom towards the pointer, keyboard; overview,
  top view, room focus on tap, saved viewpoints; every move animated.
- ✅ Automatic cut-away (auto, always, full walls), animated in the vertex shader.
- ✅ 2D view (top-down plan style) and an animated 2D ↔ 3D switch.
- ✅ Light through the day (asked by the maintainer during M1): four moods, morning, day, evening and
  night, blended from the sun's elevation (`sun.sun`) or the local clock; the card option
  `lighting` fixes one (D-015).

![The four moods of the day](figures/screenshot-moods.png)
- ✅ Render on demand; quality presets (Eco, Balanced, High) picked from the GPU; adaptive
  resolution from the frame time.
- ✅ Panel: **Import plan** and **Export plan** (since M0).
- ✅ Tests: geometry and camera unit tests, golden tests on the demo plan, every kind at odd sizes,
  wasm tests in headless Chromium (load, pick, 2D switch), E2E for the gestures, toolbar, saved views
  and translated errors, visual-regression baselines of the 3D view and the 2D plan.

![The fictional demo apartment in 3D, walls facing the camera cut away](figures/screenshot-3d.png)

Measured at the end of M1: see [`PERFORMANCE.md`](PERFORMANCE.md). Not measured yet: real devices
(an old wall tablet, a mid-range phone), which need hardware CI does not have; to be done by hand
before the HACS submission (M13).

## M2, live control

- ✅ Core: the bindings reader (roles derived from the domain and device class, lenient like the
  plan reader), entity states, and the **targets** of every element: lamp colour and intensity from
  the light (`rgb_color`, else `color_temp_kelvin`, × brightness × the lamp's power) or a switch, the
  TV screen from the media player, curtains and doors from covers, window blinds from covers, doors
  and windows from contact sensors, unavailable entities greyed out. Lights fade (≈ 0.35 s),
  moving parts move (≈ 0.7 s). See D-016.
- ✅ Render: per-element looks in a small float texture read by the vertex shader (one upload per
  change, no rebuild); lamp shades and screens glow; up to 16 point lights, each limited to its own
  room, the strongest first, counting less in daylight; halos around bulbs (not on the ceiling);
  doors, windows, blinds and curtains as a second, small mesh rebuilt only while they move.
- ✅ Frontend: the card and the panel load the bindings and follow their changes; only bound
  entities whose state changed go to the engine. Tap actions (`toggle`, `more-info`,
  `perform-action`/`call-service`, `navigate`, `none`) with a short flash; long-press controls
  (switch, brightness, warmth, colours, cover position, media and volume, lock, climate, scenes);
  the room panel (lights, scenes, blinds and curtains, climate, media, devices, **All lights off**)
  from the room's area, or the area with the room's name; a tap on a room shows its name, which
  opens the panel. The panels are a separate chunk loaded the first time one opens.
- ✅ Linking in the panel (administrators): pick an element, link entities suggested from its room's
  area by what fits its kind, or searched; choose the tap action; link a room to an area. Each save
  is one change on top of the latest stored bindings, refused if another device saved first.
- ✅ Fixed on the way: in Eco quality, lamps and screens did not glow (a texture created mid-frame
  took the element texture's unit); halos of ceiling lights floated over the floor.
- ✅ Tests: core targets and fades, lamps and texels, the moving parts rebuild, wasm (states light
  lamps and move doors), unit tests of roles, actions, state sync and suggestions, E2E with a mocked
  demo home (tap toggles and the scene follows, more-info, long-press controls, room panel and
  **All lights off**, failed action, bindings saved elsewhere, linking a lamp and a room, admin
  only), a night baseline of live states and a check that a playing TV glows.

![Long press on a lamp: its controls. Long press on a floor: the room panel](figures/screenshot-live.png)

Measured at the end of M2: see [`PERFORMANCE.md`](PERFORMANCE.md).

Left for later: fan blades turning; locks and power shown on the scene (the alerts and power layers,
M4); the full bindings editor with every action (M3).

## M1b, IFC import (ISO 16739)

Suggested by the maintainer during M0 and accepted on condition that it never degrades the core
product (`DECISIONS.md`, D-009); done after M2 and before M3 as the maintainer confirmed. See
[`ifc-import.md`](ifc-import.md).

- ✅ A separate crate `domotwin-ifc` built as its **own wasm module (112 kB gzipped), loaded only
  when an `.ifc` file is imported**: the first load does not change.
- ✅ A STEP (ISO 10303-21) reader that indexes a file in one pass and parses attributes on demand,
  never panics, and is fuzzed like the plan reader.
- ✅ IFC2x3, IFC4 and IFC4.3 subsets: units (SI prefixes, feet, inches), placements, the spatial
  structure, properties, material layers; geometry reduced to floor outlines and boxes
  (extrusions, profiles, breps, face sets, mapped items, boolean results).
- ✅ One storey → a plan: spaces become rooms (outside and gross-area spaces left out, rooms facing
  each other across a wall widened to its middle, the plan turned so that its walls run along the
  axes), wall thicknesses from the gaps and the walls, doors and windows put on the room side they
  sit in (width, hinge side, swing, style from the operation type), furniture, sanitary terminals,
  appliances and lights as pieces of the matching kind (names in English, French and German, then
  IFC types), GlobalIds as ids so that a re-import keeps the bindings.
- ✅ Panel: **Import plan** takes `.ifc` files, asks which storey when several have spaces, has the
  engine check the plan, and says what was left out.
- ✅ Tests: fictional fixtures written by `scripts/make-ifc-fixtures.py` (IFC4 in millimetres,
  IFC2x3 on two storeys turned by 30° far from the origin, a studio in feet, a shell without spaces)
  converted and read by the core with every opening on a wall; unit tests of the reader, the math
  and the kinds; E2E of the import, the storey picker, a refusal, and the module not loaded before.

![The storey picker of a two-storey file, and a fictional apartment imported](figures/screenshot-ifc.png)

Measured at the end of M1b: see [`PERFORMANCE.md`](PERFORMANCE.md).

Left for later: window sills (the plan format fixes them at 90 cm), stairs and slabs, rooms from walls
when a model has no spaces, reading the 3D files of user models with the same module (M3).

## M3, edit mode

Goal: administrators rearrange the furniture from the panel, and link and configure everything from
the UI. See [`edit-mode.md`](edit-mode.md). The maintainer chose to split the milestone: the user's
own 3D models are M3b.

- ✅ The **edit overlay** (`layout`) applied to the plan's JSON before it is read, by the card and the
  panel; a plan made invalid by its overlay is shown without it and says so. **Export plan** writes
  the plan with the overlay applied.
- ✅ Edit mode in the panel (administrators): select and select several, **drag** with snapping onto
  wall faces, piece edges and a 5 cm grid, with dashed guides and the distances to the walls;
  **turn** by 15°; **stack** small objects on tables, chests and shelves, and move what stands on a
  piece with it; **conflicts** in red; **remove**; **add** from a catalogue of every kind, by room,
  with a search; **undo and redo** (100 steps); keyboard shortcuts.
- ✅ **Save** with the revision edit mode started from (refused if another device saved), **Cancel**
  with a question when there are changes, and a **draft** kept by the browser for that revision and
  offered again.
- ✅ The **link editor** completed: the role of each entity, the long-press action, **run an action**
  (`domain.action` on a linked entity) and **open a page**, checked before saving.
- ✅ The **card editor** completed: the room shown first, picked among the rooms of the stored plan,
  and the font.
- ✅ Tests: the overlay, snapping, stacking, collisions, the history and the session on the demo
  plan (core); the edit session through the wasm API in headless Chromium; the catalogue, the draft
  and the action fields (vitest); E2E of moving and saving, export with the overlay, turning,
  removing, adding, undo and discard, the conflict colours (visual regression), the draft restored,
  the full link editor, and non-administrators. A new fuzz target applies arbitrary overlays and
  edits the result.

![Edit mode: a piece dragged on the 2D plan with its guides, and the catalogue](figures/screenshot-edit.png)

Measured at the end of M3: see [`PERFORMANCE.md`](PERFORMANCE.md).

Left for later: moving several pieces with the keyboard arrows; editing rooms, walls, doors and
windows (done in M6); refreshing the summary chip's counts while editing.

## M3b, your own furniture and appliances

**Your own furniture or appliance** (`DECISIONS.md`, D-013 and D-021).

- ✅ Readers for **glTF 2.0** (GLB, or glTF with embedded data), **OBJ**, **STL** (binary and ASCII)
  and **3MF** (base materials, colour groups, parts in other model files of the archive), in their
  own WebAssembly module, loaded only when a plan shows a 3D file or one is imported. The format's
  limits apply (8 MB, 150 000 triangles, 5 000 meshes, pictures up to 4 096 px, 32 MB unpacked),
  external files are refused. Fuzzed.
- ✅ The engine draws a file's mesh fitted into its piece (`up` axis and front), with the colours,
  metal, glass and glowing parts of its materials and the colours of its pictures sampled at the
  vertices; pieces are boxes until their file is read, or past 600 000 triangles of files in a plan.
- ✅ **Import a 3D model** in edit mode's catalogue: the name, the unit and up axis (guessed from the
  format and the file), the real size and, for files without colours, a colour; **My models** lists
  the plan's models to add more pieces of them, and forgets an imported model no piece shows.
  Imported models are overlay entries: undo, drafts and saving treat them like pieces.
- ✅ The integration keeps the files by SHA-256 in `<config>/domotwin/models/` (upload by
  administrators, reading by signed-in users), deletes the files nothing uses a day after their
  upload, and all of them when it is removed; the models of plans and overlays are checked (50 per
  plan, 20 MB of files).
- ✅ A user model linked to a light lights the room and its emissive parts glow; linked to a media
  player it lights like a screen.
- ✅ **Export plan** embeds the files as `data:` URLs; importing such a plan uploads them back.
- ✅ Tests: the four readers on fictional models in every format (`scripts/make-model-fixtures.py`),
  the fit, the overlay's models, the session; the upload, reading and clean-up views (pytest); the
  engine API in headless Chromium; the import, My models, export and import back, a refused file
  and a missing file (Playwright).

![Your own 3D models: bar stools drawn from a GLB file, and the import of a glTF lamp](figures/screenshot-models.png)

Measured at the end of M3b: see [`PERFORMANCE.md`](PERFORMANCE.md).

Left for later: textures drawn as textures, kits made in the app, resizing a piece in edit mode.

## M4, layers

The rooms show what their sensors say (`DECISIONS.md`, D-023). The layer menu of the view (or the
card's `layer` option) picks one layer at a time; alerts and presence show whatever the layer.

- ✅ **Heatmap** of temperature, humidity, CO₂ or fine particles (PM2.5): each room's value is the
  mean of the sensors of its Home Assistant area (°F and K converted; a thermostat when there is no
  sensor), drawn on its floor as a halo from the centre whose edge moves slowly, on perceptual
  scales interpolated in OKLab, with a legend and each room's value. The 2D plan shows it too.
- ✅ **Alerts**: smoke, gas, carbon monoxide, a water leak, a safety sensor or an alarm going off
  (dangers, red); a window open in the rain or the snow, CO₂ over 1 500 ppm (warnings, amber). The
  room's floor pulses and a banner lists them; tapping one frames the room. On unless the card
  sets `alerts: false`.
- ✅ **Presence**: the floor of a room whose occupancy, motion or presence sensor is on glows warm
  (`presence: false` turns it off).
- ✅ **Power**: pieces linked to power sensors are tinted from yellow (tens of watts) to red
  (kilowatts) and labelled; standby (3 W or less) is left out.
- ✅ **Real sun** (`sun: real`, or the layer menu): the sun lights the home from where it is
  (`sun.sun`) with the home's north, set by an administrator in the panel's settings; walls and
  ceilings cast shadows, so it comes in through the windows and open doors. Below the horizon the
  time of day dims it (D-015).
- ✅ The animation runs at 24 frames per second only while a layer that moves is shown and the
  view is visible, at the display's rate during gestures; reduced motion holds it still.
- ✅ Tests: the scales, the room texels, the power scale and the sun's direction (Rust); the
  engine's layer API in headless Chromium; the values from areas, units, alerts and presence
  (vitest); the settings commands (pytest); the heatmap, the power layer, alerts, the frame rate
  and reduced motion, the real sun and the north setting (Playwright).

![Layers: the temperature heatmap, the power layer, an alert and the sun through the windows](figures/screenshot-layers.png)

Measured at the end of M4: see [`PERFORMANCE.md`](PERFORMANCE.md).

Left for later: avatars of the people at home, picking a room's sensors one by one, more scales
(noise, light level, radon), the sun's position computed without `sun.sun`.

## M5, devices

Devices drawn as what they are (`DECISIONS.md`, D-024; `bindings.md`, Devices).

- ✅ **Badges** over linked elements, in 3D and 2D: a lock's state (locked, unlocked, moving,
  open, jammed), a camera (recording, unavailable), what plays, a battery at 20 % or less, an
  appliance running (washing machine, dryer, dishwasher, cooker, hood, printers: power over 10 W or
  a `running` sensor). At most two per element, the most urgent first; a tap does what a tap on
  the element does.
- ✅ **Cameras**: a new `camera` role; what a camera sees on the floor, from the piece it is
  linked to, in its room with its walls hiding what is behind them, red while recording; its angle of view and reach set in the link
  editor (`fov`, `range`); a tap opens Home Assistant's more-info with the live picture.
- ✅ Unavailable locks and cameras grey out their element, like lights.
- ✅ Card options `badges` and `cameras`, the layer menu turns both off; linking suggests
  cameras for shelves, picture frames, spots and models.
- ✅ Tests: what a camera sees and what walls hide, the camera's settings (Rust); the engine's camera and
  point API in headless Chromium; the badges' rules (vitest); `fov` and `range` validation
  (pytest); badges, a tap on them, cones, recording, and setting a camera when linking (Playwright).

![Devices: badges over the entrance door, the TV, the camera and the washing machine; what the living room's camera sees](figures/screenshot-devices.png)

Left for later: cameras not on a piece (not drawn by the plan editor either), a camera's picture in the
view, cones cut by furniture, more device classes (vacuums with their position, irrigation).

## M6, plan editor

Draw a plan in the app (`DECISIONS.md`, D-025; [`plan-editor.md`](plan-editor.md)).

- ✅ **Edit plan** in the panel, **Draw a plan** when none is stored (a new plan with one room); the
  2D plan, Cancel and Save, a bar with the tools, Undo, Redo and Remove.
- ✅ **Rooms**: drawn as rectangles or dropped with a tap, moved with everything in them, reshaped
  by their corners (dragged, added in the middle of a side, removed), the length of each side
  shown; name and floor.
- ✅ **Partitions** drawn from end to end, with their thickness; **doors** and **windows** placed on
  the nearest side of a room, moved along the sides, kept on their side when the room is reshaped;
  width, kind and opening side of doors.
- ✅ **Snapping** onto the other rooms' corners, in line with them (with guides), else onto a 5 cm
  grid; every change checked by the plan reader, refused changes said.
- ✅ **Saved** with the overlay in the plan, refused if another device saved; a plan not saved kept
  by the browser and offered again. Edit mode's button is now **Arrange**.
- ✅ The draft in **its own wasm module**, loaded when the plan editor opens: the first load grew by
  7.5 kB gzipped.
- ✅ Tests: the draft's changes (Rust) and fuzzing (every change kept leaves a plan the reader
  accepts); the engine's drafts and points in headless Chromium; the fields, keys, labels and
  draft storage (vitest); editing, drawing from nothing, keys, the kept draft and cancelling
  (Playwright); the cost of a drag (4.7 ms).

![The plan editor: a corner of the living room dragged with the lengths of its sides, and a room drawn beside the home](figures/screenshot-plan-editor.png)

Left for later: sides without a wall, per-side thicknesses and finishes, typing a side's length,
a camera of its own (not on a piece).

## M7, storeys

Several storeys in one home (`DECISIONS.md`, D-026; [`storeys.md`](storeys.md)).

- ✅ **Storage 2.1**: storeys `{id, name, elevation, plan, layout}`, the home of 1.1 migrated as its
  first storey; `plan/get` and `plan/save` take a storey (the ground floor by default),
  `storey/save`, `storey/remove` and `storeys/replace` (all at once, or none); element ids, and
  pieces added in edit mode, unique in the whole home (`duplicate_id`); at most 20 storeys; 3D
  files kept while any storey uses them.
- ✅ **A storey switcher** in the view's tools, highest on top, numbered from the ground floor; the
  card's `storey` option, with a picker in the visual editor; **stairs**, a new furniture kind,
  lead to the next storey on a tap.
- ✅ **Storeys** in the panel: name, floor height, removal, a new storey imported or drawn in the
  plan editor; import, edit, arrange and export work on the storey shown; drafts kept per storey.
- ✅ **IFC**: **Import every storey** of a file in one save, with their names and elevations
  measured from the ground floor; ids renamed where two storeys share them (`freeIds`).
- ✅ **Alerts from every storey** in the banner, with their storey; the switcher marks a storey with
  an alert and a tap on the alert goes there.
- ✅ A fictional upper floor for the demo apartment (`examples/demo-upper-floor.domotwin.json`).
- ✅ Tests: migration, storey commands, unique ids, admin-only writes (pytest); stairs, the upper
  floor and renaming ids (Rust); levels, names, the card editor's picker, alerts elsewhere
  (vitest); the switcher, stairs, the card option, the dialog, a storey drawn, imported, a whole
  IFC file, an alert upstairs (Playwright).

![The floor above with its stairs and the storey switcher; the storeys dialog](figures/screenshot-storeys.png)

Left for later: the storeys stacked in one 3D view (the floors above see-through), stairs cut into
the floor above, the heatmap and presence of the other storeys.

## M8, looks

Three looks for the scene (`DECISIONS.md`, D-027; [`looks.md`](looks.md)).

- ✅ **Neon**: a night sky, a grid on the ground fading into the dark, walls of tinted glass, the
  outlines of the home glowing in an accent colour, the furniture in a palette of night blues,
  lamps and screens that shine.
- ✅ **Blueprint**: white lines on blue, an architect's drawing in 3D.
- ✅ **Day**: the home as it is, in the light of the time of day, now standing on a ground with
  its shadow, thin outlines, lamps that glow on desktop GPUs.
- ✅ **Outlines** of the home from the walls' layout: wall tops and corners, the frames of doors and
  windows, the floors' outlines, lowered with the cut-away; lines a few pixels wide whatever the
  zoom.
- ✅ **Bloom** of what glows (lamps, halos, screens, outlines, the grid), drawn offscreen with 4×
  MSAA; on old tablets (Eco) the looks are drawn straight to the screen, without it.
- ✅ **Automatic**: neon in Home Assistant's dark mode, day otherwise; the home's look and accent in
  the panel's settings (shown as they are chosen), the card's `theme` and `accent` options, the
  panel's header and the view's buttons and dialogs in the look's colours.
- ✅ **The rooms' names** on their floors (card option `names`).
- ✅ Tests: the outlines of the demo apartment, the looks (Rust); every look drawn with and without
  its bloom, without a WebGL error (headless Chromium); options and settings (vitest, pytest); the
  looks of a card and of the panel, automatic, the names (Playwright); the frame time of each look.

![The demo apartment in the evening, in the neon, blueprint and day looks](figures/screenshot-looks.png)

Left for later: every storey at once (M9), reflections on the floors, a sky that follows the
weather.

## M9, every storey at once

The whole home in one view (`DECISIONS.md`, D-028; [`storeys.md`](storeys.md)).

- ✅ **One scene of every storey**: each storey's meshes and outlines built apart with its height,
  its elements, rooms, walls and lamps numbered across the home, so that the live looks, the
  layers, the cut-away and taps work on every storey.
- ✅ **Spread apart or stacked**, animated, the camera framing the home as it will be; each storey
  drawn at its lift, lamps lighting their own storey, badges, cones and labels following it.
- ✅ **A roof** over the top storey: a gable over the smallest rectangle around its walls, of glass
  in the night looks, tiled in day, never in the way of a tap.
- ✅ **The 2D plan of every storey**, side by side, each with its label over it.
- ✅ **Each storey's label** (its name, rooms and lights on) and **a picture of each storey**, drawn
  offscreen in the look shown; a tap on either shows that storey alone.
- ✅ **Where**: an "every storey" button in the switcher, the card's `storey: all`, `spread` and
  `roof` options and buttons; in the panel, edit mode, linking and the plan editor work on one
  storey, and the home comes back after.
- ✅ Tests: the roof's rectangle and slopes, the demo home built storey by storey (Rust); the
  storeys spreading, stacking and lying side by side on the plan (view); the whole home drawn, a
  tap on the floor above, the plan of storeys side by side (headless Chromium); the options, the
  card editor, the counts on the labels, a storey without a plan (vitest); a card showing every
  storey, spreading, the roof, a lamp upstairs tapped, the 2D plan, edit mode on a storey alone
  (Playwright); the frame time of the whole home.

![The demo apartment's two storeys spread apart under their roof, with their labels and pictures](figures/screenshot-home.png)

Left for later: stairs cut into the floor above, a roof read from an IFC file, several roofs over
a home of several wings.

## M10, kiosk

Walking, wall tablets and the voice (`DECISIONS.md`, D-029; [`kiosk.md`](kiosk.md)).

- ✅ **Walking at eye level**: the walk button, drag to look around, tap the floor to go there
  (through the doors and the open sides between rooms, the shortest way), the pad and the keys to
  walk, the wheel and a pinch to step; never through a wall, a partition or a window; a room shown
  is walked into, a piece walked up to; whole walls and lit ceilings; stairs still lead up.
- ✅ **The kiosk**: back to the card's view after `idle` seconds untouched, a slow turn (`orbit`),
  dimmed at night (`night_dim`, unless an alert shows), `tools: false`; a touch wakes it.
- ✅ **`domotwin.show`**: an action that shows a room, an element, a storey or a view on every
  screen or on one (`screen`), found by name as said, on any storey.
- ✅ **Assist**: a blueprint turning "show the kitchen" into `domotwin.show`, with Assist's answer.
- ✅ Tests: where a walker can go, the doors and the way between rooms, the widest view, the eyes'
  camera (Rust); walking, a tap on the floor, the walls stopping it (view, headless Chromium); the
  kiosk's options, the requests found by name (vitest); `domotwin.show` checked and sent, the
  blueprint answering a sentence (pytest); walking with the pad, the keys and a tap, the kiosk going
  back and dimming, requests for this screen and another (Playwright); the frame time walking.

![Walking through the demo apartment's living room at eye level](figures/screenshot-walk.png)

Left for later: furniture in a walker's way, walking up the stairs, a voice answer naming what was
not found.

## M10b, DomoTwin's own plan format

The plan format DomoTwin started from is dropped for one of its own (`DECISIONS.md`, D-030;
[`plan-format.md`](plan-format.md)).

- ✅ **`*.domotwin.json`**: `"format": "domotwin-plan"`, elements in lists by what they are, rooms
  as outlines, openings from one end to the other, items by their centre, size and rotation, every
  name in English; its JSON Schema, kept equal to the core's lists by a test.
- ✅ **Written everywhere**: the plan editor, the edit overlay (`at`, `rotation`, `lift`, `room`),
  the IFC import, **Export plan**; the demo apartment and its upper floor converted.
- ✅ **Stored plans of the earlier format are set aside** at start-up (storage 3.1, kept in the
  stored data, with a warning); no reader or converter of it ships.
- ✅ Tests: the reader's codes and defaults, the overlay, the editor, the IFC fixtures (Rust); the
  plan's lists (vitest); the envelope, the storage migration (pytest); every e2e test on the new
  files (Playwright).

## M9b, network map

The Zigbee mesh drawn over the home (`DECISIONS.md`, D-031; [`network.md`](network.md)).

- ✅ **The network layer**, for administrators with ZHA: each device at the piece linked to its
  device or entities, the links as arcs coloured by quality (good, fair, weak, in one place), a
  pulse towards the coordinator along the ways devices take, spare links lighter, links to a
  device not heard from for a day dashed; still under *reduce motion*.
- ✅ **Tap a device or a link** for its details: type, LQI, RSSI, last seen, hops and through
  which device, neighbours best first; a link's ends and quality.
- ✅ **Health**: devices, weak links, devices not seen for a day, and the rooms that reach the mesh
  only through weak links (*a router here would help*). **Rescan** asks ZHA for a new scan.
- ✅ **Not placed in the home**: the devices the map cannot place, with *Place* in the panel (tap
  the piece, the link editor opens filled in). Bindings gain `device`, for a coordinator without
  entities.
- ✅ **A source behind an interface** (ZHA now), the analysis in the core, wires as a scene
  primitive the automation wires will use; device ids and Zigbee addresses kept out of
  diagnostics.
- ✅ Tests: the mesh read, merged and routed, its health, its wires and arcs (Rust); the wires drawn
  and found under a tap (headless Chromium); ZHA's answer mapped, devices placed, the snapshot
  (vitest); the `device` field, diagnostics without ids (pytest); the layer offered to
  administrators with ZHA only, the sheet, a tap on a device and on a link, rescan, placing from
  the panel, markers on a dense screen, a picture per look (Playwright); the frame time with the
  map and the cost of a 300-device mesh.

![The network map over the demo apartment](figures/screenshot-network.png)

Left for later: Zigbee2MQTT and Thread as sources, a device's history of quality, a link's
neighbour table both ways.

## M9c, automation wires

What sets off what, drawn in the home, live (`DECISIONS.md`, D-032; [`automations.md`](automations.md)).

- ✅ **Automations in the panels**: those related to a piece's entities, its device and its room's
  area, with how the piece takes part, a switch, when it last ran and an editor link for
  administrators; the same in a room's panel.
- ✅ **Show wires**: from every trigger and condition to every action, one colour per automation,
  dashed from conditions and to what a template decides; ends marked by role; labels floating
  above a room or the home for what has no piece, lifted apart; a tap picks one out.
- ✅ **Live**: a pulse along an automation's wires when it runs, the pieces it acted on flashing;
  wires flashing under *reduce motion*.
- ✅ **Every automation of the home** from the layer menu, lighter, bundled by room above 30.
- ✅ **The reader in the core**, lenient and fuzzed; both spellings of Home Assistant's
  configuration; nested steps followed.
- ✅ Tests: reading fictional configurations (nested `choose`, `if`, `repeat`, device triggers,
  area targets, templates, unknown steps, depth), wires and bundles (Rust); wires drawn, found,
  pulsing (headless Chromium); related automations, placing, roles, runs, labels lifted
  (vitest); the panel section, the wires, a mocked run, others without wires, the layer, 50
  bundled, a picture per look (Playwright); the frame time with 50 automations.

![Every automation of the demo apartment as wires](figures/screenshot-automations.png)

Left for later: scripts followed into, a run's trace (which branch it took), wires between
storeys shown apart.

## M9d, upkeep cards

What each piece needs to be looked after, and what is due (`DECISIONS.md`, D-033;
[`upkeep.md`](upkeep.md)).

- ✅ **A card per piece**: make, model, serial number, install date, warranty end, service life, a
  manual link and notes, recurring tasks; written by administrators in the piece's sheet (a sheet
  of its own for a piece linked to nothing), **Done** for everyone.
- ✅ **Kept by the integration** by piece id, out of the plan (storage 4.1); a plan's export offers
  its cards as a file of their own.
- ✅ **Due soon and overdue**: the date reckoning in the core (months ending at the end of shorter
  ones), the same in the integration, both tested on shared cases; badges joining the devices';
  a warranty ending within 30 days.
- ✅ **The upkeep layer**: the pieces tinted green, amber or red, the tasks listed by date with
  **Done**, the lead set by administrators.
- ✅ **From IFC files**: manufacturer, model, serial number, installation, warranty and service
  life from the standard property sets and the assets, IFC2x3 and IFC4.
- ✅ **One sensor**, `sensor.domotwin_upkeep_due`, the tasks in its attributes.
- ✅ Tests: dates, ends of months and of February, states (Rust and Python on the same cases);
  storage, migration, validation, commands, the sensor across days (pytest); the IFC reader on a
  new fictional fixture and IFC2x3 (Rust); the engine's states and layer (headless Chromium);
  badges, lists, merging (vitest); writing a card, a task falling due, Done, others, the layer's
  picture (Playwright); a fuzz target.

![The upkeep layer of the demo apartment](figures/screenshot-upkeep.png)

Left for later: reminders sent by DomoTwin itself (the sensor is there for automations), tasks
of a room rather than a piece, a history of what was done.

## M9e, people in their rooms

Who is home and in which room, live (`DECISIONS.md`, D-034; [`people.md`](people.md)).

- ✅ **Placed by the integration** from the entities that say where each person is (Bermuda's
  area sensors, ESPresense, any entity naming a room or an area): the last to change wins, only
  people at home; settings in a store of their own, chosen by administrators with suggestions.
- ✅ **A sensor per person**, `sensor.domotwin_<person>_room`, for automations.
- ✅ **Figures in the 3D view**: a person or a pin in their colour, glowing in the looks that glow,
  standing clear of the walls, the furniture and the room's name; walking through the doors when
  they change rooms (fading to another storey); still under *reduce motion*.
- ✅ **Names over them**, a sheet each (where, since when, what said so), who is there in the
  room's panel, how many on each storey's button; a card option `people`.
- ✅ **Hiding**: anyone hides themselves and shows themselves again; administrators anyone; people
  shown to administrators only.
- ✅ **Asking**: `domotwin.where` with a sentence in English or French, `domotwin.show` for a
  person, the `where_by_voice.yaml` blueprint for Assist.
- ✅ Tests: rooms found, people placed, likeness of names (pytest); the sensors, the commands, who
  may do what, renames, revisions, the voice blueprint (pytest); walking through the doors, places
  clear of the furniture, storeys, plan changes (Rust); the engine in headless Chromium; the shown
  people, colours, initials (vitest); names, sheets, walking, hiding, the settings, a picture per
  look (Playwright); a frame-time case with ten people walking.

![The people of the demo apartment](figures/screenshot-people.png)

Left for later: a history of where people went.

## M9f, Bluetooth locating

DomoTwin's own room locating from Home Assistant's Bluetooth receivers, for homes without Bermuda
or ESPresense (`DECISIONS.md`, D-035; [`bluetooth.md`](bluetooth.md)).

- ✅ **Devices followed**: phones and watches by their Private BLE Device key (the key never leaves
  Home Assistant), Android phones by the companion app's iBeacon, tags by their address; chosen by
  administrators from what is heard.
- ✅ **Receivers placed** from their device (its area, the piece linked to it) or by hand.
- ✅ **A model from the plan**: distance, walls, doors, open sides, floors; it locates from the
  first minute, without a calibration walk; silence from a receiver counts.
- ✅ **Learned**: a room taught in half a minute, presence sensors agreeing as people live, each
  device's loudness.
- ✅ **Along the doors**: a filter over the rooms that follows the doors and stairs, slow to change
  its mind; presence sensors weigh in for what people carry.
- ✅ **Sensors**: `sensor.domotwin_<device>_bluetooth`, a source of its owner's room (D-034), and
  `binary_sensor.domotwin_<device>_left_behind` for things left at home.
- ✅ **In the views**: a person's devices in their sheet, the things in a room's panel; "where are
  my keys?" by voice.
- ✅ Tests: walls, ways and pieces of the demo home, the specification's key sample, iBeacons, the
  model, the filter, a simulated walk with noisy readings (pytest); the locator with a mocked
  Bluetooth (receivers placed, devices by address, key and beacon, teaching, presence, left
  behind, the commands, voice); the frontend's helpers (vitest); the settings, teaching, sheets
  and panels (Playwright).

![The Bluetooth settings over the demo apartment](figures/screenshot-bluetooth.png)

Left for later: a position inside the room (trilateration), a heat map of what each receiver
hears.

## M8b, two more looks

A cartoon and a clay model besides neon, blueprint and day (`DECISIONS.md`, D-036;
[`looks.md`](looks.md)).

- ✅ **Researched**: cel shading, flat colours and the three usual ways to ink a 3D scene (an
  inverted hull, edges found in the picture, lines from the geometry), and which second look.
- ✅ **Cartoon**: two steps of sunlight, vivid flat colours, thick ink on the home's outlines, a
  darker rim on curved pieces, and ink found in the picture's depth around the furniture, the
  people and the home (from the Balanced quality up), under a blue sky on a lawn; inked labels.
- ✅ **Clay model**: one warm matte clay, soft light and shadows, faint lines; lamps still glow.
- ✅ Both follow the time of day, in the 3D view and the 2D plan; a card's `theme: cartoon` or
  `clay`, and the panel's settings.
- ✅ Tests: the looks' data (Rust); every look drawn at each quality, the cartoon's ink alone on
  Balanced (wasm); the options (vitest, pytest); the sky, the ink by quality, the time of day, the
  settings and a picture of each (Playwright); the frame time of each look.

![The demo apartment in the day, in the cartoon and clay looks](figures/screenshot-cartoon-clay.png)

Left for later: ink on the creases of a piece (found in its normals), a watercolour look.

## 0.1.0, the first release

Moved forward by the maintainer, right after M8b (D-037): every milestone above, released as it is.

- ✅ release-please's pull request merged: the `v0.1.0` tag, the GitHub release with its changelog,
  and `domotwin.zip` (the integration with its built frontend) attached for HACS.
- HACS installs it as a custom repository (README, *Quick start*). The submission to HACS's default
  list waits for M13.
- Left for M13: the install test on a clean Home Assistant and the measurements on real devices.

## M5b, what cameras see, on the floor

Raised by the maintainer, twice: the view of a camera (D-024) was a flat shape laid over the
picture, over the sofa and the people, and was taken for the room's outline. The engine draws it
on the floor of its room instead:

- hidden by the furniture and the people standing on it;
- a fan from the camera's badge, fading out with distance, in a look of its own (not a room's
  highlight);
- faint until the camera is tapped, then whole.

The card's `cameras: false` still leaves the views out.

## M9g, private rooms

Asked by the maintainer: a room whose view and controls can be locked, or kept for some people
only.

- **Per room**, in the panel's settings (administrators):
  - **open** to everyone, as now (the default);
  - **locked** for everyone, always or while a Home Assistant entity is on (an automation can then
    lock the bedrooms when guests come);
  - **kept for some people**: the people chosen, through the Home Assistant user of their
    `person`. A shared wall tablet's user is no one's, so the room stays locked there.
- **For whoever may not see it**:
  - the room is drawn closed: its walls up, a frosted cover with a lock over its floor, its name
    only;
  - no furniture, devices, badges, layers' values, camera views or people inside;
  - taps and long presses do nothing, and its panel says it is private;
  - walking does not go through its doors;
  - the people's sheets and the voice answers say "in a private room".
- **Administrators** still see it in the edit and plan modes, to change the home.
- **The limit, said in the settings**: DomoTwin locks its own views and controls. Home Assistant
  gives every user every entity in its other dashboards and its API (its permissions are by user,
  not by entity), so this keeps a room private on a shared screen, not behind a security barrier.

## M11, imports

Plans from Sweet Home 3D (`.sh3d`), DXF drawings and room scans (USDZ or OBJ from phone LiDAR
apps), turned into DomoTwin plans.

## M12, polish

Design pass, bundled variable font and `font_family` option, accessibility (keyboard, focus rings,
screen-reader labels, reduced motion), README with real screenshots and a GIF made from the demo
plan, and voice (asked by the maintainer; Home Assistant's Assist does the listening, the
recognition and the speech, with whatever pipeline the user set up, local Whisper and Piper
included: DomoTwin embeds no voice engine):

- **A microphone button** in the card and the panel opens Home Assistant's Assist already
  listening (the dashboards' `assist` action), so a wall tablet without a voice satellite can
  speak to it. The browser gives the microphone to pages served over HTTPS only: over HTTP, a
  dialog says so and how to serve Home Assistant over HTTPS, instead of a button that does nothing.
- **The voice blueprints at hand**: DomoTwin's settings offer to import "show the kitchen" and
  "where is…" (`blueprints/`) in one tap, instead of a link in the documentation.
- **Voice set up when it is not**: when Assist has no speech-to-text, the microphone button offers
  to set it up, locally, with the administrator's consent and saying what is downloaded:
  - on Home Assistant OS and Supervised, DomoTwin installs and starts the Whisper add-on (or
    Speech-to-Phrase, faster on small hardware such as a Raspberry Pi) and Piper through the
    Supervisor, as the Z-Wave JS and Matter integrations install theirs. Then it adds them
    through the Wyoming integration and sets up an Assist pipeline in the user's language;
  - on Home Assistant Container and Core, which have no add-ons, the dialog gives the steps (the
    Wyoming containers to run) instead;
  - someone who is not an administrator is told to ask one.

  Nothing leaves the home: the models run in Home Assistant, and DomoTwin calls no other service.

## M12b, size and speed

A pass over the whole of DomoTwin that keeps the picture as it is, measured before and after: the
first load (the network map's analysis and the automation reader in modules of their own, see
`PERFORMANCE.md`), the frame time on the Balanced and Eco presets against the budgets, the
integration's work in Home Assistant, and the CI's time.

## M13, release 0.2.0

Tag and release 0.2.0 with the `domotwin.zip` asset, install test as a HACS custom repository on a
clean Home Assistant, measurements on real devices, and the checklist for the HACS default
repository list in `HACS_SUBMISSION.md`.
