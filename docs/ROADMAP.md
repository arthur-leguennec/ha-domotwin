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
| M3b       | Your own furniture and appliances with their 3D model      | ⏳     |
| M4        | Layers: heatmap, alerts, presence, sun and mood, power     | ⏳     |
| M5        | Polish: design, fonts, accessibility, performance, README  | ⏳     |
| M6        | Release 0.1.0 and HACS submission checklist                | ⏳     |

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

- ✅ Core: strict-structure, lenient-field plan reader for revisions 1–10 with stable error codes
  (and the element at fault) translated in English and French, the clean plan model, validation of
  every rule of `plan-format.md`. Fuzzed. The editing checks (overlaps, blocked doors) move to M3,
  where they are shown.
- ✅ Core geometry: room polygons (frame-relative vertices, legacy `bevel`), implicit walls (interior
  partitions centred on shared limits, façades outside the polygon, per-side `edgeThickness`,
  `openEdges`, filled outer corners), openings cut into walls, wall heights and finishes, door sweeps,
  wall groups for the cut-away, the furniture catalogue (55 kinds with defaults, light and soft
  flags, vertical models).
- ✅ Render: three-d's core layer on WebGL2 with DomoTwin's own shaders (D-014). The whole home is
  two merged meshes (one draw call each), which beats instancing here. Procedural models for every
  kind, procedural floors (`uni`, planks, tiles; `photo-*` keys fall back to their procedural look),
  wall finishes (`blanc`, `vert-blanc`, `cimaise`, `metro`, paint), skirting boards and cornices,
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
before 0.1.0.

## M2, live control

- ✅ Core: the bindings reader (roles derived from the domain and device class, lenient like the
  plan reader), entity states, and the **targets** of every element: lamp colour and intensity from
  the light (`rgb_color`, else `color_temp_kelvin`, × brightness × `lightPower`) or a switch, the
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
windows (they stay House Maquette's); refreshing the summary chip's counts while editing.

## M3b, your own furniture and appliances

**Your own furniture or appliance** (`DECISIONS.md`, D-013): import a glTF/GLB model (then OBJ, STL,
3MF) with its real size and behaviour (lamp, screen, appliance…), stored by the integration by hash,
placed, stacked and bound like any piece, and embedded in **Export plan**.

## M4, layers

Heatmap (animated organic halo, perceptual scale, legend, 20–30 fps only while visible), alerts
(pulse and banner, safety alerts always on), presence (room glow, avatars), sun and mood (`sun.sun`,
configurable north, sunlight patches through windows, evening mood), power (labels and glows).

## M5, polish

Design pass, bundled variable font and `font_family` option, accessibility (keyboard, focus rings,
screen-reader labels, reduced motion), performance tuning against the budgets, README with real
screenshots and a GIF made from the demo plan.

## M6, release 0.1.0

Tag and release with the `domotwin.zip` asset, install test as a HACS custom repository, and the
checklist for the HACS default repository list in `HACS_SUBMISSION.md`.
