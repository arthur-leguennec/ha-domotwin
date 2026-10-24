# Decisions

Architecture decisions, newest last. A decision that deviates from the original brief says so and
explains why. Each entry: context, decision, consequences.

## D-001 · Distribution: a HACS integration that ships its own frontend

- **Context.** A Lovelace card alone cannot store anything on the server, and HACS plugin
  repositories handle several files (JS, `.wasm`, fonts) poorly.
- **Decision.** DomoTwin is a HACS **integration** (`custom_components/domotwin`). It stores the
  plan, the edit overlay and the bindings in Home Assistant's `.storage`, exposes a small websocket
  API, serves the built frontend as static files and registers both a sidebar panel and the
  `custom:domotwin-card` card. The Python side stays thin: no rendering and no geometry.
- **Consequences.** One install gives the panel and the card. `iot_class: calculated`,
  `integration_type: service`, `single_config_entry: true`.

## D-002 · Renderer: three-d on WebGL2

- **Context.** The renderer must run on WebGL2 (companion app webviews, old tablets), stay small
  (first load ≤ 1.2 MB gzipped for wasm + JS) and give enough control for custom post-processing
  (bloom, ambient occlusion, the heatmap halo, the cut-away transition). Bevy is excluded.
- **Measurement** (M0, Rust 1.97, `opt-level = "z"`, LTO, `wasm-bindgen 0.2.129`,
  `wasm-opt -Oz` from binaryen 133, then `gzip -9`):

  | Candidate                     | Test content                                                  | `.wasm`  | gzipped    |
  | ----------------------------- | ------------------------------------------------------------- | -------- | ---------- |
  | three-d 0.19 (no default)     | PBR material, directional shadow map, instancing, point light, offscreen target and a screen effect | 210 KB | **83 KB** |
  | wgpu 30 (`webgl` backend)     | a single lit triangle, no depth, no post-processing           | 1 674 KB | **667 KB** |
  | glow 0.18 (raw GL, reference) | a lit triangle and one post-processing pass                   | 53 KB    | 25 KB      |

  three-d rendered correctly in headless Chromium with software WebGL2 (SwiftShader), which the E2E
  and visual-regression jobs rely on.
- **Decision.** Use **three-d 0.19** with `default-features = false` (no window, no egui, no text).
- **Why not wgpu.** Its WebGL2 path alone costs more than half of the whole first-load budget before
  any DomoTwin code. WebGL2 is a down-level backend for wgpu (no compute, reduced limits), device
  creation is asynchronous, and its API breaks often: four of the calls in the small test had
  changed in the latest release.
- **Post-processing control.** three-d gives render targets, depth and colour textures, screen
  effects and custom `Material`, `Geometry` and `Effect` implementations with full GLSL. It also
  exposes the raw `glow` context, so any pass that does not fit its abstractions (heatmap halo,
  cut-away fades, bloom chain) can be written directly against GL.
- **Maintenance risk.** three-d has essentially one maintainer and still depends on `glow 0.17` and
  `cgmath`. Mitigation: exact version pins, a narrow surface used through `domotwin-render` only,
  and raw `glow` as the escape hatch. If three-d stalls, the renderer can move to raw `glow` piece by
  piece without touching `domotwin-core` or the frontend.
- **Known advisories.** `cargo deny` reports two crates pulled in by three-d as unmaintained (not
  vulnerable): `cgmath` (RUSTSEC-2026-0196) and `instant` (RUSTSEC-2024-0384). They are ignored by
  name in `deny.toml`, with this decision as the reason, and are reviewed at every three-d release.

## D-003 · Frontend loading: `add_extra_js_url` instead of a Lovelace resource entry

- **Context.** The brief asks that users never edit Lovelace resources by hand. Writing into the
  Lovelace resource collection only works in storage mode, not in YAML mode, and it modifies user
  data.
- **Decision (deviation).** The integration registers its small entry module with
  `frontend.add_extra_js_url`. It loads in every frontend session, in storage and in YAML mode, and
  defines `domotwin-card`, `domotwin-panel` and the card editor. The module is tiny: the engine (JS
  glue, wasm) and the editor are separate chunks loaded only when a card or the panel is shown.
- **Consequences.** No resource entry to add or clean up; removing the integration removes the card.
  Cache busting uses `?v=<version>` on the entry and content hashes on the chunks.

## D-004 · The built frontend is not committed

- **Decision.** `custom_components/domotwin/frontend/` is a build output (ignored by git). CI builds
  it, checks its size and attaches it to each release inside `domotwin.zip` (`hacs.json`:
  `zip_release: true`, `filename: domotwin.zip`).
- **Consequences.** No binary churn in the history. A plain checkout of the repository needs
  `scripts/build.sh` before it can run in Home Assistant (documented in `CONTRIBUTING.md`).

## D-005 · Storage layout and concurrency

- **Decision.** One `Store` (`.storage/domotwin.data`, version 1.1) holds the imported plan exactly as
  read, the edit overlay keyed by element id, the bindings and a `revision` counter. Every write bumps
  the revision; writes may pass `expected_revision` and are refused with `revision_conflict` when
  another device saved in between. Clients subscribe to `domotwin/subscribe` to reload.
- **Consequences.** Re-importing an updated plan keeps the overlay and the bindings of the elements
  that still exist. Migrations go through `Store._async_migrate_func`.

## D-006 · Validation split between Python and Rust

- **Decision.** Python checks only the envelope (types, `version`, `unit`, element count, sizes) so
  that garbage and oversized payloads are refused. The full lenient validation lives once, in
  `domotwin-core`, and runs in the browser before a save and on every load.
- **Consequences.** One reader to test and fuzz; the Python side stays thin as required.

## D-007 · UI toolkit: Lit

- **Decision.** Lit 3 for the custom elements and overlays (≈ 6 KB gzipped). It is what Home
  Assistant itself uses, so the theming and lifecycle patterns match. No other UI framework.

## D-008 · Copyright line and attribution

- **Context.** The repository must not contain real names. The MIT licence asks to keep the copyright
  notice of the copied House Maquette files.
- **Decision.** DomoTwin's licence names "DomoTwin contributors". The House Maquette spec and schema
  are credited in `THIRD_PARTY_NOTICES.md` to "the House Maquette author", who is also DomoTwin's
  maintainer and holds the copyright of both, so they can license their own work this way.
- **Consequences.** If the maintainer prefers the original notice with their name, it is a one-line
  change in `THIRD_PARTY_NOTICES.md`.

## D-009 · IFC import (ISO 16739) as an optional, isolated importer

- **Context.** The maintainer suggested also starting from a standard ("ISO") format so that DomoTwin
  is easier to adopt, provided it never prevents or degrades what the project must do. IFC
  (ISO 16739) is the ISO standard for building models and is exported by FreeCAD, Bonsai (Blender),
  ArchiCAD, Revit and others.
- **Decision.** Keep the House Maquette plan as the native and stored format (the walls, openings and
  furniture kinds the renderer relies on are defined by it). Add an **IFC importer** that converts one
  storey into a plan, in its own crate and its own lazily loaded wasm module (milestone M1b). glTF
  (ISO/IEC 12113) export of the 3D model is a possible later addition.
- **Consequences.** No cost on first load and no change to the native model. If any part of the IFC
  import turns out to hurt size, speed or robustness, that part is dropped and noted here.
- **Outcome (M1b).** Built as planned: 112 kB gzipped, fetched only to import a file, fuzzed, nothing
  dropped. See D-018 for how a storey becomes a plan.

## D-010 · Minimum Home Assistant version: 2025.1

- **Decision.** `hacs.json` declares `2025.1.0`. The integration relies on
  `async_register_static_paths` (2024.7), `single_config_entry` (2024.3) and options flows without a
  stored `config_entry` (2024.11). CI tests against the current release through
  `pytest-homeassistant-custom-component`.

## D-011 · Versions

- **Decision.** The product version lives in `custom_components/domotwin/manifest.json`, `const.py`
  and `frontend/package.json`, all bumped by release-please. The Rust crates are internal
  (`publish = false`) and keep version `0.0.0`, so `Cargo.lock` never changes on a release.
- **Toolchains.** Rust 1.97.0 (`rust-toolchain.toml`), Node 22 (`.nvmrc`), Python 3.14 (required by
  the current Home Assistant). TypeScript stays on 6.0 because `typescript-eslint` does not support
  TypeScript 7 yet.

## D-012 · Secret scanning without a third-party action

- **Decision.** CI downloads a pinned gitleaks release, verifies its SHA-256 and runs it: full history
  on pushes to `main`, the pull request's commits otherwise. The same version runs in `pre-commit`.
  This avoids the licence key the gitleaks action asks for and keeps the job on `GITHUB_TOKEN` only.
  A project rule set (`.gitleaks.toml`) adds Home Assistant tokens and URLs, private IP addresses and
  e-mail addresses to gitleaks' defaults.

## D-013 · User furniture and appliances with their own 3D model

- **Context.** The maintainer wants users to add their own furniture or appliance with the 3D model
  that goes with it. The plan format already has this since revision 10: `models` (a kit of
  primitive parts, or an imported GLB/glTF, OBJ, STL or 3MF file) and the furniture kind `custom`.
- **Decision.**
  - M1 draws `custom` pieces made from **kits**; a piece whose model is a file is drawn as a box of
    its size until M3.
  - M3 adds **Add my own furniture or appliance** in edit mode: import a **glTF/GLB** file
    (ISO/IEC 12113) first, then OBJ, STL and 3MF; give its real size and what it behaves like
    (lamp, screen, appliance…) so that live rendering, bindings and layers treat it like a built-in
    kind; place, stack and bind it like any other piece.
  - Model files are not stored in `.storage` (base64 would bloat it): the integration keeps them in
    `<config>/domotwin/models/<sha256>.<ext>`, admin-only upload, served to authenticated users only.
    **Export plan** embeds them as `data` URLs, as House Maquette does, so a plan round-trips.
  - Parsing 3D files happens in the same lazily loaded import module as the IFC import (D-009) and
    produces a compact mesh the engine loads directly, so the first load does not grow.
  - The format's limits apply: 50 models per plan, 8 MB per file, 20 MB of files per plan,
    150 000 triangles per file, external references refused.

## D-014 · Own shaders on three-d's core layer, the home as two meshes

- **Context.** D-002 chose three-d. Its high-level renderer (materials, lights, objects) would draw
  each mesh and material separately, re-upload geometry to cut walls away, and grow the wasm with
  features DomoTwin does not use.
- **Decision.**
  - `domotwin-core` builds the scene as **two meshes** with packed vertices (36 bytes: position and
    the base height of its piece, normal, colour and roughness, wall group and surface, element id,
    pattern coordinates). Merging everything static beats instancing here: a frame is one draw call
    for the opaque home and one for glass and contact shadows, whatever the plan.
  - `domotwin-render` uses only three-d's **core layer** (programs, buffers, render targets) with
    DomoTwin's own GLSL: lighting (sky and ground, the sun with an optional shadow map), procedural
    floors and tiles (no texture to download), a flat look for the 2D plan, tone mapping.
  - **Cut-away in the vertex shader.** Walls belong to groups by direction (façade or partition);
    each group has a cut height animated between the wall height and 38 cm, sent as a uniform array.
    Vertices clamp to it, pieces starting above it and things hung on a cut wall disappear. Nothing
    is rebuilt or uploaded during the transition.
  - **Picking on the GPU.** On a tap, the element ids are drawn into a one-pixel scissor of an
    offscreen target and read back: exact, whatever the shape.
  - The camera, the cut-away decision and the animations live in plain Rust (`domotwin-core::camera`,
    `domotwin-render::view`) and are unit-tested without a GPU.
- **Consequences.** Live changes in M2 (a lamp turning on, a door opening) rebuild the scene in Rust
  (a few milliseconds for a 500-element plan) or use per-element uniforms; both keep the draw count.
  Bloom and ambient occlusion are not in M1; they are optional High-preset passes for M5.

## D-015 · Light that follows the time of day

- **Context.** During M1 the maintainer found the first lighting too bright, picked a darker,
  warmer daylight among five proposals, and asked for the light to change with the time of day.
- **Decision.** Four moods in `domotwin-core::lighting` (sky, ground, sun colour, exposure,
  darkening at the foot of walls): **morning** (soft, slightly cool), **day** (warm, clear
  shadows), **evening** (dim, the lamps stand out), **night** (dark blue moonlight). In `auto` the
  frontend reads the elevation and `rising` attribute of Home Assistant's `sun.sun` (local to the
  home, no network) and the core blends the moods smoothly; without a sun entity it uses the local
  clock. Changes under half a degree are skipped, so following the sun draws a frame every few
  minutes at most. The card option `lighting` fixes a mood.
- **Not yet.** The sun's direction does not move (shadows always fall the same way): the real sun
  through the windows is the M4 layer.

## D-016 · Live states: targets in the core, looks in a texture, moving parts apart

- **Context.** M2 shows Home Assistant states in the scene: lamps on and off in their colour, the
  TV, curtains, blinds, doors and windows, unavailable entities. A home has dozens of bound
  entities and Home Assistant sends a new `hass` object for every change anywhere.
- **Decision.**
  - The frontend sends the engine only the **bound** entities whose state **changed**, with only the
    attributes the scene uses (brightness, colour, colour temperature, position, device class).
    Home Assistant keeps the object of an entity that did not change, so most updates cost one
    comparison per bound entity and nothing reaches the engine.
  - `domotwin-core::live` turns plan, bindings and states into **targets** (per element: glow
    colour and strength, greyed out, highlight; opening of doors, windows and curtains; blinds) and
    fades towards them. Everything is plain Rust, tested without a GPU.
  - Looks reach the GPU as a **float texture of two texels per element**, read by the vertex shader
    with the element id every vertex already carries (D-014): a lamp turning on uploads a few bytes
    and rebuilds nothing.
  - Lamps light their room with **point lights**: at most 16, the strongest first, each limited to
    its own room (every vertex carries its room), so light does not leak through walls without a
    shadow pass per lamp. They count less in daylight (`Lighting::lamp_gain`: a quarter by day, all
    at night). Halos are drawn around bulbs, not on the ceiling, which is not drawn.
  - Doors, windows, blinds and curtains live in a **second, small mesh** rebuilt only while one of
    them moves; the rest of the home is never rebuilt.
- **Consequences.** The draw count stays fixed (four meshes and the halos). Lamps do not cast
  shadows. More than 16 lit lamps in view: the weakest stop lighting their room (they still glow).

## D-017 · Linking in M2, one change per save

- **Context.** Bindings are written by hand or from the UI, possibly from two devices. The full
  editor belongs to the edit mode (M3), but linking must be possible as soon as states show.
- **Decision.** The panel gets a link mode for administrators: a tap picks an element and opens a
  small editor (entities suggested from the room's area by what fits the element's kind, search,
  tap action; an area for a room). Each save reads the latest stored bindings, applies this one
  change and sends the revision it read (`expected_revision`): a save from another device in
  between is refused, never overwritten. Actions written by hand are kept as they are.
- **Consequences.** Plan and bindings share one revision (D-005), so the client drops both cached
  copies on any save event. The M3 editor will reuse the same save path.

## D-018 · IFC storey to plan: rooms meet in the middle of walls, ids from GlobalIds

- **Context.** IFC spaces stop at the wall faces and walls are separate objects; the plan format
  draws partitions centred on the limit two rooms share and façades outside the rooms. IFC models
  are often placed at an angle or far away (georeferenced). Bindings are keyed by element id.
- **Decision.**
  - Rooms come from spaces only. Where two spaces face each other across a wall of up to 59 cm,
    each is widened by half the gap along the part where they face, so that they share a limit in
    the middle of the wall; partitions of another thickness keep it per side. Exterior walls are
    not touched (façades lie outside rooms, as in IFC).
  - The plan is mirrored (y down), moved next to the origin and turned so that its main walls run
    along the axes (the length-weighted direction of the room sides, modulo 90°).
  - Doors and windows are put on the nearest parallel room side within 45 cm, where the plan
    format expects them; the others are reported, not guessed.
  - Element ids are the IFC GlobalIds: importing an updated model keeps the bindings.
  - Wall thicknesses: the measured gaps between spaces (interior), the walls marked `IsExternal`
    (exterior), else the walls' material layers or geometry.
- **Consequences.** A model without spaces cannot be imported (the message says how to add them);
  rooms from walls alone may come later. Window sills follow the plan format's fixed 90 cm.

## D-019 · Edit mode: an overlay replayed on the plan, the session in the engine

- **Context.** M3 moves, turns, stacks, removes and adds furniture. The imported plan stays as it
  was read (D-005) so that importing an updated plan keeps the edits; editing must feel immediate on
  wall tablets; undo must be reliable; two devices may edit.
- **Decision.**
  - Every edit is the **overlay** (`layout`, keyed by element id: position, angle, elevation, room,
    removed, added pieces), applied to the plan's JSON **before** it is read
    (`domotwin-core::overlay`). The reader checks the result like any plan; a change that would make
    it invalid is dropped. Only furniture is edited: rooms, walls and openings come from the plan.
  - The session lives in `domotwin-core::edit`, tested without a GPU: selection, snapping (each side
    onto the nearest parallel wall face or piece edge within about 1.5 % of the view, else a 5 cm
    grid), distance guides, stacking, collisions, and a history of **whole overlays** (100), so that
    undo cannot drift.
  - While a piece is dragged, it and what stands on it are built with the moving parts (D-016):
    a pointer move rebuilds only them; the scene is rebuilt once when they are dropped.
  - **Stacking** is for small objects only (lamps, plants, screens, printers, a dryer on a washer,
    the user's models) on pieces with a top: an armchair dropped on a table is a conflict, not a
    stack. **Conflicts** are drawn red and never refused: plans are approximate.
  - **Save** sends the overlay with the revision edit mode started from (D-005, D-017). The overlay
    not saved is kept in the browser's local storage for that revision, on the device only, and
    offered again when edit mode opens.
- **Consequences.** **Export plan** writes the overlay applied. Added pieces get ids
  `<kind>-added-<n>`. The engine grew by 28 kB gzipped; the edit bar and catalogue load only when
  edit mode opens. Rooms, walls, doors and windows are not edited in DomoTwin.

