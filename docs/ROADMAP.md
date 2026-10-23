# Roadmap

DomoTwin is built milestone by milestone, with one pull request per milestone. Each milestone ends
with this file updated: what was done, what was measured and what was left for later.

Legend: ✅ done · 🚧 in progress · ⏳ planned · ❓ needs a decision from the maintainer

| Milestone | Scope                                                      | Status |
| --------- | ---------------------------------------------------------- | ------ |
| M0        | Scaffold: workspace, integration skeleton, CI, docs, demo  | 🚧     |
| M1        | Render: plan, walls, openings, furniture, 2D/3D, cut-away  | ⏳     |
| M1b       | IFC import (ISO 16739), one storey → plan                  | ⏳ ❓  |
| M2        | Live control: bindings, tap, long-press, room panel        | ⏳     |
| M3        | Edit mode: move, rotate, stack, undo, save, card editor    | ⏳     |
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

## M1b, IFC import (ISO 16739) ❓

Suggested by the maintainer during M0 and accepted on condition that it never degrades the core
product (see `DECISIONS.md`, D-009). Planned shape, to be confirmed before it starts:

- A separate crate `domotwin-ifc` compiled to its **own small wasm module, loaded only when the
  user imports a `.ifc` file**, so it costs nothing on first load.
- An IFC-SPF (ISO 10303-21 "STEP") reader that never panics, fuzzed like the plan reader.
- IFC2x3, IFC4 and IFC4.3 subset: `IfcBuildingStorey` (the user picks one), `IfcSpace` → rooms
  (footprint from the `FootPrint` curve or the `Body` extrusion profile), `IfcDoor` and `IfcWindow` →
  openings (width, placement, operation type → door style, sill height), furnishing, sanitary,
  lighting and appliance elements → furniture kinds, length units converted to cm.
- Output: an ordinary plan, so everything downstream (render, bindings, edit, export) is unchanged.
- Fixtures: fictional IFC files generated by a script in the repository.
- The same lazily loaded module later reads the 3D files of user models (M3).

## M2, live control

Bindings with suggestions from Home Assistant areas, tap actions (`toggle`, `more-info`,
`perform-action`/`call-service`, `navigate`, `none`), long-press popovers (light brightness and
colour, cover position, media controls), the room panel (lights, scenes, climate, covers, media,
"all lights off"), live state rendering (lamp colour and brightness with bloom and fades, TV glow,
covers and curtains, doors and windows from contact sensors, unavailable entities greyed out).

## M3, edit mode

Select and multi-select, move with snapping (walls, furniture edges, grid) and distance guides,
rotate with 15° snapping, stacking on top surfaces with attached children, collision hints, undo and
redo (≥ 50 steps), save and discard, local draft autosave, the bindings editor with entity search,
the full visual card editor, and optionally a small procedural catalogue to add or remove furniture.

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
