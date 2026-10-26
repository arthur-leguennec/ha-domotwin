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

- **Decision.** Python checks only the envelope (types, `format` and `version`, element count, sizes) so
  that garbage and oversized payloads are refused. The full lenient validation lives once, in
  `domotwin-core`, and runs in the browser before a save and on every load.
- **Consequences.** One reader to test and fuzz; the Python side stays thin as required.

## D-007 · UI toolkit: Lit

- **Decision.** Lit 3 for the custom elements and overlays (≈ 6 KB gzipped). It is what Home
  Assistant itself uses, so the theming and lifecycle patterns match. No other UI framework.

## D-008 · Copyright line and attribution

- **Context.** The repository must not contain real names.
- **Decision.** DomoTwin's licence names "DomoTwin contributors"; the works it reuses are credited in
  `THIRD_PARTY_NOTICES.md`.
- **Consequences.** If the maintainer prefers a notice with their name, it is a one-line change in
  `LICENSE`.

## D-009 · IFC import (ISO 16739) as an optional, isolated importer

- **Context.** The maintainer suggested also starting from a standard ("ISO") format so that DomoTwin
  is easier to adopt, provided it never prevents or degrades what the project must do. IFC
  (ISO 16739) is the ISO standard for building models and is exported by FreeCAD, Bonsai (Blender),
  ArchiCAD, Revit and others.
- **Decision.** Keep the JSON plan of `docs/plan-format.md` as the native and stored format (the
  walls, openings and furniture kinds the renderer relies on are defined by it; D-030 redrew it). Add an **IFC importer** that converts one
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
    **Export plan** embeds them as `data` URLs, so a plan round-trips.
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
  Bloom and ambient occlusion are not in M1; they are optional High-preset passes for M10.

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
    it invalid is dropped, and a stored overlay that an updated plan refuses keeps the entries it
    accepts (tried one by one; the view says how many were left out). Only furniture is edited:
    rooms, walls and openings come from the plan.
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
  `<kind>-added-<n>`. The engine grew by 30 kB gzipped; the edit bar and catalogue load only when
  edit mode opens. Rooms, walls, doors and windows are not edited in DomoTwin (until the plan
  editor, D-025).

## D-020 · CI: run what a change needs, nothing twice

- **Context.** Every push to a pull request ran every check (about 14 runner-minutes), every merge
  ran them again on main, and a change of documentation alone did the same. The maintainer asked
  for as little runner time as possible with the same quality.
- **Decision.**
  - One workflow (`ci.yml`) for the required checks. A first job (`changes`, `scripts/ci-changes.sh`)
    lists the changed files (renames at both paths); each job runs only when one concerns it (Rust,
    the browser build, the frontend, the Python integration and its tests including the README's
    links, the Home Assistant validators). A file known to need no job (other workflows, templates,
    release files, documentation tools) runs none; any other file runs everything, as does a change
    of the CI itself. A job skipped by a condition counts as passed for the required checks (a
    workflow skipped by a path filter would leave them pending); if `changes` fails, every job runs.
  - `cargo deny` runs every time (17 s): advisories appear without a commit.
  - A merge to main runs the jobs that keep the caches warm for the next pull requests (Rust,
    Python, the build), not the E2E: with *require branches to be up to date* and squash merges,
    main holds exactly the tree its pull request tested.
  - CodeQL runs on every pull request and every push to main: the code scanning rule blocks a pull
    request without results, and each pull request is compared with the analysis of its base.
  - The weekly run checks the Home Assistant validators and the advisories.
  - The Python environment is cached whole (exact Python, pinned requirements); the fuzz targets are
    built once in one job, cached, and only those the change concerns run (a crash in one does not
    stop the others).
  - The real Home Assistant test runs at night only when there is something new: a Home Assistant
    release or a commit on main since the last run that passed.
  - Dependabot groups compatible updates per ecosystem (npm and pip minors and patches, cargo
    patches); majors, cargo 0.x minors and TypeScript stay apart.
- **Consequences.** A documentation change runs the Python tests, `cargo deny` and CodeQL; a
  frontend change skips the Rust and Python jobs; a merge skips the E2E. The required check names do
  not change. CodeQL (about 6 runner-minutes) remains the largest cost and runs on everything.

## D-021 · Your own 3D models: a module of their own, colours at the vertices, links for behaviour

Decided while the maintainer was away (M3b, D-013 carried out); open to review.

- **Context.** D-013 set the formats, the limits and where files live. Building it raised five
  choices: where the files are read, how textured models look in a renderer without textures
  (D-014), where models imported in edit mode are kept, how the server gets a file's hash, and how a
  model "behaves like" a lamp or a screen when the plan format has no field for it (its schema
  refuses extra fields).
- **Decision.**
  - **A module of its own.** The readers (`domotwin-models`: glTF 2.0 as GLB or with embedded
    data, OBJ, STL binary and ASCII, 3MF with base materials, colour groups and parts in other model
    files of the archive) are their own WebAssembly module (94 kB gzipped), not part of the IFC
    import as D-013 said: cards need them to draw, not only the import. A view loads it only when
    its plan has a piece drawn from a 3D file, reads each file once per page and gives the engine a
    compact mesh (positions, normals, per-vertex colour and finish, indices). The engine fits it
    into the piece's box (`up` axis, front +z or −y) inside the merged scene, so a frame still draws
    the home in the same few calls. Pieces are boxes until their mesh comes, or when the files of a
    plan pass 600 000 triangles in all; the view says how many.
  - **Colours at the vertices.** Base colour pictures are decoded by the browser (scaled to 256 px)
    and sampled at each vertex: a textured model keeps its colours, not the detail between
    vertices. Emissive materials glow with the piece's light, transparent ones are glass, metallic
    ones metal; STL and OBJ files take the piece's colour. Double-sided glTF materials are drawn on
    both sides.
  - **Kept in the overlay.** A model imported in edit mode is an overlay entry `@model:<id>` beside
    its pieces (D-019), so it follows undo, drafts, saving, the revision check and Export like them;
    a model the plan already has stays the plan's. « My models » lists the plan's models; one
    imported in edit mode that no piece shows can be forgotten.
  - **The server hashes.** Files go to `POST /api/domotwin/models` (administrators) and come back
    from `GET /api/domotwin/models/<sha256>.<format>` (signed-in users, cached as immutable). The
    integration computes the SHA-256: browsers only offer it on HTTPS pages, and Home Assistant is
    often served over plain HTTP at home. It checks that the bytes look like the format; the browser
    has read the file fully before sending it. A file nothing uses is deleted a day after its upload
    (an import not saved yet keeps it), and all of them when the integration is removed.
  - **Behaviour from links.** A user model linked to a light lights the room from three quarters of
    its height and its emissive parts glow; linked to a media player it lights like a screen. Nothing is stored for it: the format has no field, and the links already
    say what the piece is. Small and large user models can stand on tables (M3's rule for `custom`).
  - **Exports carry the files.** Export plan embeds each file as a `data:` URL; importing such a
    plan reads every file, uploads it and keeps only its reference. A file that cannot be read fails
    the import with the model's name; a file missing from Home Assistant is left out of the export
    with its pieces, and the panel says so.
- **Consequences.** The first load grows by the engine's drawing and editing of models (about
  14 kB gzipped); the readers cost nothing until a plan uses a 3D file. Textures are approximated
  (no texture memory, no new shader inputs). Behaviour cannot be set without linking an entity: an
  unlinked lamp model never lights. The overlay's `@model:` keys cannot be element ids; DomoTwin
  never writes such ids.

## D-022 · A wider scope: what people expect of a 3D home dashboard, with no account and no cloud

Decided at the maintainer's request (after M3b); the order of the milestones is open to review.

- **Context.** The maintainer asked for DomoTwin to stand comparison with the best 3D dashboards
  for Home Assistant, paid ones included. What they offer beyond M1–M3b: live layers over the rooms
  (climate, safety, presence, energy), sunlight at its true angle, devices with their own look
  (cameras and what they see, locks), a plan drawn in the app, several storeys, looks and a kiosk
  mode for wall tablets, and imports from common home design tools.
- **Decision.** The roadmap grows to cover them, one milestone and one PR at a time:
  M4 layers (`D-023`), M5 devices, M6 plan editor, M7 storeys, M8 looks and kiosk, M9 imports,
  M10 polish, M11 release 0.1.0 (`ROADMAP.md`). What stays as it is, and sets DomoTwin apart: free
  and open source, no account, no licence check and no network call outside the user's Home
  Assistant; the engine in Rust compiled to WebAssembly, drawn on demand within the budgets of
  `PERFORMANCE.md`; open formats in and out (the documented JSON plan, IFC, glTF, OBJ, STL, 3MF);
  every text in English and French.
- **Consequences.** The first release comes later than M6 of the original plan would have put it.
  Features that need a service outside Home Assistant (cloud rendering, accounts, shared online
  catalogues) stay out.

## D-023 · Layers: read from the rooms' areas, drawn on the floors from a texture of rooms

Decided while the maintainer was away (M4); open to review.

- **Context.** M4 shows on the plan what the home's sensors say: a heatmap (temperature, humidity,
  CO₂, fine particles), safety alerts, where someone is, what draws power, and the sun at its true
  angle. A home has dozens of sensors; most are not linked to a plan element, but most are in a
  Home Assistant area.
- **Decision.**
  - **Values come from areas, in the frontend.** Each room's area (its link, else an area with the
    room's name, as for the room panel) gives its sensors by device class; a room shows their mean,
    in °C for temperatures (°F and K converted), or its thermostat's reading when it has no sensor.
    Hidden entities give no value and no presence but still raise their alerts. The view computes
    this from the `hass` object it already has and sends the engine one small JSON (`setLayers`)
    only when a value changes at the precision shown; the states of every sensor never go to the
    engine. Temperatures are shown in °F when Home Assistant uses them; the scales stay in °C.
  - **Perceptual scales, one place.** Each quantity has a scale of stops chosen for its meaning
    (temperature green at 22 °C, CO₂ red from 2 000 ppm…), interpolated in OKLab by the core, which
    also gives the legend's colours.
  - **Drawn on the floors.** Three texels per room slot (heatmap colour; the room's centre, reach
    and alert; presence) in one texture, read by the shader of the floors (planks, tiles, plain):
    the heatmap tints the floor most at the room's centre, its edge moving slowly with noise; an
    alert pulses towards the walls (red once a second for a danger, amber every two seconds for a
    warning); presence warms the floor. The 2D plan shows the same. No geometry, no draw call and
    no pass is added.
  - **Alerts.** Dangers: smoke, gas, carbon monoxide, a water leak, a safety sensor, an alarm panel
    going off. Warnings: a window open while a weather entity says rain or snow, CO₂ over
    1 500 ppm. They show whatever layer is chosen, in a banner whose entries frame the room, unless
    the card turns them off (`alerts: false`).
  - **Power.** The power sensors linked to a piece (W, kW or MW) give its power; the layer tints the
    pieces on a logarithmic scale from 3 W (standby, not shown) to 3 kW and labels them in watts
    (a third texel per element).
  - **Frames.** Animated layers need frames all the time: they come at 24 per second when nothing
    else moves, at the display's rate during gestures, camera moves and fades, and never while the
    view is hidden or off screen (D-014). With reduced motion the layers hold still and frames are
    drawn on demand again.
  - **The real sun.** Optional (`sun: real`, or the layer menu): its direction comes from `sun.sun`
    and from where north points on the plan, a new home setting (`domotwin/settings/*`,
    administrators, in the panel). The shadow map then draws whole walls (not cut away) and the
    rooms' ceilings (kept only on the GPU, never drawn in colour), so the sun comes in through the
    windows (glass casts no shadow) and open doors; the rooms see less of the sky and a little
    light bounces off what the sun lights. The Eco preset, which has no shadows, gets a small
    shadow map for it, read once per pixel and drawn again only when the sun or something in the
    home moves (the cut-away does not change it). Below the horizon the sun lights from just above
    it while the time of day dims it.
  - **Saves stay apart.** The settings are a third kind of save beside the plan and the bindings;
    each save is checked against the last write of its own kind (`ARCHITECTURE.md`), which also
    fixes a bindings save refusing an edit of the plan started before it.
- **Consequences.** The first load grows by about 21 kB gzipped (engine 14 kB, entry 3.5 kB). A
  heatmap or an alert on screen costs frames at 24 per second (a wall tablet's battery: reduced
  motion stops it). Sensors outside the room's area do not count, and picking a room's sensors one
  by one is left for later. The halo is centred on the mean of the room's corners, which can fall
  outside an L-shaped room. The settings hold only north for now.

## D-024 · Devices: badges from the links, cameras' cones from the pieces, both over the picture

Decided while the maintainer was away (M5); open to review.

- **Context.** M5 shows what the devices of the home are doing. The plan format has a closed list
  of kinds, so there is no "camera" or "lock" piece to add; but every element can already be linked
  to entities.
- **Decision.**
  - **From the links.** A device is whatever its entity is linked to: a camera on the bookcase, a
    lock on the entrance door, a battery sensor on the door it powers. A new `camera` role joins
    the roles (derived from `camera.*`). The binding of an element may say what its camera sees:
    `fov` (10–180°, 90 by default) and `range` (50–3 000 cm, 600), set in the link editor and
    checked by the integration.
  - **Badges in the page, not in the scene.** The frontend works out each element's badges from
    the states it already has (lock state, camera, playing, battery at 20 % or less, an appliance
    running: power over 10 W or a `running` sensor), at most two per element, the most urgent
    first. The engine only says where elements are drawn (`elementPoints`, one call for all), read
    again only when the camera moves or something changes (D-023's rule for labels). Badges are
    buttons: a tap does the element's tap; they say what they show to screen readers.
  - **What a camera sees, in its room.** The engine works out a camera's view from the centre of
    its piece (moved up to 40 cm forward when it sits in a wall) towards the piece's front: rays
    across the angle of view and to the room's corners, each stopping at the first side of the
    room or at the reach, so that the walls hide what is behind them, an L-shaped room's inner
    corner included. It does so when the plan or the bindings change and only projects it on the
    floor when the view moves (`cameraViews`); the view draws it as an SVG polygon, blue, red while
    recording, grey and dashed when unavailable. No geometry is added to the scene, so nothing is
    rebuilt when a camera's settings change. *Since M5b, the engine draws it on the floor, behind
    the furniture (D-038).*
  - **Kinds and names from the engine.** The badges take each piece's kind (for appliances) and
    name (for their labels) from the plan the engine shows, the edit overlay applied
    (`elementList`), so that pieces added in edit mode get them too.
  - **Unavailable devices.** A lock or a camera that is unavailable greys out its element, as
    lights and covers do.
- **Consequences.** Views are not cut by furniture, and an open side between two rooms stops a
  view as a wall would (the room's polygon stands for its walls). A camera must be linked to a
  piece; cameras of their own come later (the plan editor of M6 does not draw them). Badges hide
  while linking and in edit mode, where taps pick elements.
  The badges and cones of a large home are a few dozen HTML and SVG nodes, moved only when the
  camera moves.

## D-025 · Plan editor: a draft of the plan's JSON checked by the reader, in a module of its own

Decided while the maintainer was away (M6); open to review.

- **Context.** M6 lets a home be drawn in the app: rooms as polygons, partitions, doors and windows
  on the rooms' sides, with snapping and lengths, without another program. The
  format's rules already live in the plan reader; the engine every dashboard loads must stay light
  (D-022); the furniture is arranged as an overlay (D-019).
- **Decision.**
  - **A draft of the JSON.** The editor works on the plan's JSON with the edit overlay applied
    (the entries the plan accepts, at the current revision), in `domotwin-core::structure`. Every
    change builds the next JSON and has the plan reader read it: a change refused is forgotten and
    its code shown (a refused place only stops a drag). Undo keeps whole plans (100 steps); a drag
    is one step. There is no second model of the plan to keep in step with the format.
  - **Shapes.** A room is its frame and its corners in it, written back normalised (a legacy
    `bevel` becomes corners); adding a corner splits a side, removing one merges two, and the per-side settings
    (`openEdges`, `edgeThickness`, `edgeFinish`) follow their sides. When the room is reshaped, its
    doors and windows stay on their side (on the half they are on when a corner splits it, on the
    merged side when one goes) as near their place as they fit, running the same way and opening to
    the same side; a door moved along its side keeps the side it opens to, and one on a wall two
    rooms share stays in its own room. A width or a reshape that leaves an opening longer than its
    side is refused (`opening_too_wide`). An opening is on a side by the walls' own rule (its line
    within 6 cm of both ends of the side). A room moves with everything that belongs to it. A door or a window is placed on the nearest side of a room
    within 60 cm, centred, kept within the side, a door opening into the room (83 cm; windows
    120 cm). Removing a room removes its doors and windows; its furniture stays, in no room. Undo
    and redo wait for a drag to end.
  - **Snapping** in plan centimetres: onto another room's corner within 12 cm, else in line with
    the corners of the other rooms within 8 cm (with a guide), else onto a 5 cm grid. Plans are
    drawn by hand, not measured: these are fixed distances, not a share of the view as in edit mode.
  - **A module of its own.** The draft is built as its own WebAssembly module
    (`domotwin-planner`), loaded only when the plan editor opens, like the IFC import and the 3D
    model readers (D-021): inside the engine it cost 20.5 kB gzipped on every first load (the
    whole engine is inlined differently), for a tool an administrator opens now and then. The
    engine only shows each version of the draft (`showDraft`, the selection marked), gives the
    plan it shows with its overlay (`shownPlan`) and turns screen points into plan points and back.
    The tools, the drags and the handles (corners, lengths, guides, the shape being drawn) are the
    frontend's, loaded with the module; the handles follow the camera like the badges (D-024).
  - **Saving** stores the whole plan, the overlay in it, and an empty overlay, in one save with the
    revision the editor started from. A plan not saved is kept by the browser for that revision,
    as edit mode's overlay is (D-019), and by the view while the panel is away from the page (its
    history with it).
  - **In 2D only**, apart from edit mode: one or the other is on. Edit mode's button is now
    **Arrange**, so that it is not mistaken for **Edit plan**.
- **Consequences.** Once saved from the plan editor, the plan is DomoTwin's: the overlay is in it,
  and importing a file replaces it as before. A drag move builds the whole scene again (4.7 ms in
  headless Chromium for the demo apartment, with the JSON passed from one module to the other).
  Links follow ids: a removed element's links stay stored and do nothing, and a new element never
  takes an id that has links (nor one given earlier in the session). Open sides, per-side
  thicknesses and finishes and typed lengths are kept but not edited yet; the first load
  grew by 7.5 kB gzipped (the engine's 3.3 kB, the texts in two languages, the panel's buttons).

## D-026 · Storeys: one plan each, ids unique in the whole home, one storey drawn at a time

Decided while the maintainer was away (M7); open to review.

- **Context.** Houses have a cellar, floors above, an attic; IFC files hold several storeys. The plan
  format describes one level: its rooms, walls and openings sit on one floor. Links to entities
  and rooms' areas are keyed by element id (`bindings.md`); the edit overlay too (D-019).
- **Decision.**
  - **One plan per storey.** The stored data holds `storeys: [{id, name, elevation, plan,
    layout}]` instead of one `plan` and `layout` (storage 2.1; a 1.1 home becomes `storey-1` at
    elevation 0). A major version: an older DomoTwin refuses the data instead of reading it without
    its storeys and saving that. A storey is an ordinary plan, read, imported, exported, edited and arranged
    exactly as before; no new format and no change to the plan reader. `elevation` (cm, −100 to
    1 000 m) orders the storeys; the **ground floor** is the storey nearest elevation 0 (the lower
    of two as near): what `plan/get` and `plan/save` use without `storey`, so a client from before
    storeys keeps working on the ground floor. At most 20 storeys.
  - **Ids are the home's.** Bindings stay one document for the whole home: an element id, or the
    id of a piece an overlay adds, may be on one storey only (`duplicate_id` on save). A plan
    joining a home (imported as a new storey, every storey of an IFC file) has its taken ids
    renamed first (`living` → `living-2`, the `room` of its pieces following, within the
    reader's 100 characters), by the planner module's `freeIds`; the plan editor and edit mode
    reserve the other storeys' ids.
  - **API.** `plan/get` and `plan/save` take an optional `storey` and `plan/get` lists the storeys;
    `storey/save` adds a storey (with its plan) or renames or moves one, `storey/remove` removes
    one, and `storeys/replace` replaces them all in one write, every plan checked first (every
    storey of an IFC file: all of them stored, or none). Storey ids are `storey-<n>`, the lowest
    free `n`: when the storeys are replaced, the ids are given again in order, so a card set to the
    floor above still shows it. IFC storeys are measured from the storey nearest elevation 0 when
    one is within 2 m of it (else from the lowest, as georeferenced files are far above 0), so a
    cellar stays below the ground floor. Drafts kept by the browser are per storey.
  - **One storey drawn at a time.** The view gets a switcher (one button per storey, highest on
    top, numbered from the ground floor) and the card a `storey` option; `stairs` (a new
    furniture kind, a DomoTwin addition read as `desk` by other readers) lead to the next storey on
    a tap. Stacking the storeys in one scene would multiply what dashboards draw and need the
    floors cut open; one storey at a time keeps every frame as cheap as before.
  - **Alerts from every storey.** Safety alerts are what must not be missed: the card and the
    panel fetch the other storeys' plans (the client keeps them, so switching is then immediate),
    and the banner lists their rooms' alerts with their storey; the switcher marks the storey.
    Heatmap, presence and power stay those of the storey shown.
- **Consequences.** A storey switch loads the plan already fetched: 10 ms median in headless
  Chromium for the demo apartment's two storeys, the camera kept. A home of several storeys
  fetches every storey's plan once per page for the alerts, and again after a save of a plan or an
  overlay (not of the bindings or the settings). The first load grew by 5.8 kB
  gzipped (the switcher, the storeys dialog, the alerts of other storeys, the texts, the stairs).

## D-027 · Looks: neon, blueprint and day, drawn by the same engine, glowing offscreen

Decided while the maintainer was away (M8); open to review.

- **Context.** The maintainer asked for a picture at least as striking as the best 3D home
  dashboards: night scenes of glass walls with glowing outlines over a grid are what people expect
  now. DomoTwin's realistic look stays a strength (furniture, materials, real sun shadows), but it
  stood on a blank background, without glow. The first load is budgeted (D-002) and dashboards run
  on old tablets.
- **Decision.**
  - **Three looks, one renderer.** A look (`domotwin-core::theme`) is data: background and ground
    colours, glass walls or not, outline colour, strength and glow, a palette furniture and floors
    lean to, a light of its own or the time of day's, sun shadows or not, the 2D plan's colours.
    **Day** keeps the realistic home; **neon** and **blueprint** are night and drawing looks. The
    accent tints neon's outlines and grid. No second renderer, no new shader per look.
  - **Outlines from the walls' layout.** The core draws the lines of the home from the same bands
    as the walls (`scene::lines`): wall tops (a façade's two faces, a partition's middle, meeting
    at the rooms' corners), corners where the walls turn, door and window frames, floors'
    outlines. Each line has its wall group and the height of the bottom of what it outlines, so
    that it follows the cut-away like the meshes' pieces (a window's frame goes when its wall is
    cut below the sill). The renderer draws them as quads a few device pixels wide, moved two
    pixels towards the camera (in front of the surfaces they lie on at any zoom, not through the
    walls) and clipped at the near plane, and blends them by **max** (min for day's dark lines):
    the line a partition gets from both its rooms is drawn once.
  - **Glass walls, a mesh of their own.** The walls (faces, tops, trims, corners) are a mesh apart
    from the rest of the opaque home. Day draws it with the rest. With glass walls, its tops are
    drawn with what is opaque and its faces after the glass, tinted, brighter at grazing angles,
    catching their room's lamps; the vertex shader leaves out the other part, so no pass
    discards fragments and doors and windows keep their own look. A tap goes through glass walls
    to what is behind them; their tops still pick their room.
  - **The background is drawn, not cleared.** A full-screen pass draws a sky from the horizon up
    and the ground under the floors' slabs with its grid (fading out when its cells get too small,
    and into the sky far away), the sun's shadow on it in 3D. The day look takes its colours from
    the dashboard's background, the ground dimming with the light of the time of day.
  - **Bloom offscreen, only where it pays.** The glow is carried in the alpha channel of an
    offscreen picture drawn with 4× MSAA (lamps and screens that are on, halos, outlines, the
    grid); four levels of a dual-filter blur at half resolution and below are added back. Neon and
    blueprint are drawn this way from the Balanced preset up, day on High only; Eco draws every
    look straight to the screen, with the canvas' own antialiasing. Night looks have no sun shadow
    map, which pays for part of the bloom.
  - **Which look.** `auto` (the default) is neon in Home Assistant's dark mode and day otherwise;
    the panel's settings choose the home's look and accent (`settings.theme`, `settings.accent`),
    a card's `theme` and `accent` options win over them. The view, the panel's header and their
    dialogs take the look's colours whatever the dashboard's theme (a `look` attribute and CSS
    variables), so a neon view never shows white buttons.
  - **The rooms' names** stand on their floors (from the engine, like the layers' values) unless
    a layer shows its values there or the card turns them off (`names: false`).
- **Consequences.** The look is part of the picture tests: day's references changed once (the
  ground, the outlines). In headless Chromium a frame costs about the same CPU time in every look
  (0.5–0.8 ms median at High), and the software GPU about the same time too: MSAA and the bloom
  cost about what day's sun shadows cost, and the glass walls redraw the walls alone. The first load grew by 18.6 kB gzipped: the engine
  16.6 kB (the looks' shaders, the outlines, the background, glass and bloom passes), the rest
  2 kB (the options, the settings, the rooms' names, the texts).

## D-028 · Every storey at once: one scene, each storey drawn at its own lift

Decided while the maintainer was away (M9); open to review.

- **Context.** One storey drawn at a time (D-026) keeps frames cheap, but a home of several floors
  is first seen whole: the storeys stacked like a dollhouse, pulled apart to look inside each, a
  roof on top. Dashboards also want a quick way to pick a storey. Links, layers, taps and the live
  looks are keyed by element and room; edit mode, linking and the plan editor work on one plan.
- **Decision.**
  - **One scene of every storey.** The core builds each storey's meshes (opaque, walls, glass,
    moving parts, ceiling, outlines) into a part of its own with the storey's elevation
    (`build_home`), its geometry on its own floor. The elements, the rooms' slots, the wall groups
    and the lamps are numbered across the home, so the live looks, the rooms' texture of the layers,
    the cut-away and picking work for every storey as they did for one. A plan of the storeys put
    together (`stack_plans`) serves the engine's lookups (links, targets, badges). A plan alone is
    a home of one storey: one code path.
  - **Each storey moved where it is shown.** The renderer draws each part with a `u_offset`
    uniform: up to its elevation, plus 1.6 wall heights per storey below it when spread apart.
    Spreading and stacking are animated (0.7 s, eased), the camera framing the home as it will
    be. Lamps are worked out on their storey's floor (how high a bulb is decides its reach and its
    halo), then moved with it; picking draws each part where it is and says which storey was
    tapped. Badges, cameras' cones, the layers' values and the labels follow their storey. The
    shadow map draws every storey where it is shown.
  - **The 2D plan lays the storeys side by side.** Seen from above, stacked storeys hide each
    other: on the plan, they lie down on the ground side by side, the lowest on the left (or down
    the view, the highest on top, in a view taller than wide), a gap of 12 % of the widest between
    them (1.5 m at least), each label over its storey, without the roof. The same offset carries
    them there, animated with the switch to the plan.
  - **A roof over the top storey.** A gable roof over the smallest rectangle around the top
    storey's walls (the convex hull of its rooms and walls, then the rectangle of least area on one
    of its sides), the ridge along the longer side, 30° slopes up to 3.2 m above the eaves, the
    eaves 30 cm out from the walls, gable walls under it, its outlines. It floats above the top
    storey like another storey when spread. It is glass in the looks with glass walls, opaque in
    day; it is never tapped (a tap goes to what is under it) and casts no sun shadow, so that the
    light still comes in. Real roofs vary (hip, flat, several wings): this one says "a house"; the
    plan format has no roof to read, and an imported roof is for later.
  - **Labels and pictures.** Each storey has a label beside it (its name, its rooms, the lights
    on); the view draws a small picture of each storey alone from above a corner, offscreen, in the
    look shown, once per home and per look (280 × 180 device pixels). A tap on either shows that
    storey alone.
  - **Where.** The view's storey switcher gets an "every storey" button above the storeys; a card
    opens on it with `storey: all`, with `spread` and `roof` options (both on by default), the view
    a button for each. A storey without a plan yet is left out; with fewer than two storeys with a
    plan, the storey alone is shown. The panel shows it until a tool starts: edit mode, linking and the plan
    editor work on the storey that was last shown alone, shown alone meanwhile, and the home comes
    back after. With every storey shown, the alerts banner lists every room's alerts, and the
    heatmap, presence and power show on every storey.
- **Consequences.** A home of several storeys costs one draw call per mesh per storey instead of
  per mesh: in headless Chromium at High, neon, the demo apartment's two storeys under their roof
  (27 776 triangles) take 0.7 ms of CPU per frame median against 0.5 ms for the ground floor alone,
  and about the same software GPU time. The live look of every element is a texture of rows of
  512 elements (1 536 texels, within the 2 048 every WebGL2 GPU allows), as a whole home has the
  elements of all its storeys. Every storey's plan is fetched once (the client already
  fetched them for the alerts). The first load grew by 22.0 kB gzipped: the engine 19.5 kB (the
  scene of storeys, the roof, the offsets and the plan side by side, the pictures) and the rest
  2.5 kB (the switcher's button, the labels, the pictures, the options, the texts).

## D-029 · Kiosk: walking at eye level, a card that waits and dims, `domotwin.show` for Assist

Decided while the maintainer was away (M10); open to review.

- **Context.** DomoTwin lives on wall tablets as much as on dashboards. People expect to walk
  through their twin at eye level, a wall screen to go back to its view and dim at night on its own,
  and to ask for a room by voice. Assist, Home Assistant's voice assistant, runs locally and
  already handles speech; nothing outside Home Assistant may be called (D-022).
- **Decision.**
  - **Walking is the same camera, at the eyes.** The orbit camera gets a `walk` amount (0 around the
    home, 1 at eye level): its target 1 m ahead of the eyes at 1.6 m, the pitch free to look up, the
    field of view widened (72° instead of 40°), the walls whole, blended on the way in and out like
    any camera move. No second camera, no second renderer.
  - **Where a walker can go comes from the walls drawn.** `domotwin-core::walk` takes the wall
    bands of the scene, cut where a door is (windows stay walls), and the free partitions (the same
    footprint the scene draws), and keeps a walker 20 cm from them, sliding along a wall in the
    way. A tap on the floor in sight walks there (a tap on a wall does nothing), through the doors
    and the open sides between rooms: the fewest of them between the two rooms (a breadth-first
    search on the rooms they link), 45 cm into each room on the way. A room shown is walked into
    (to a point well inside it), a piece walked up to and faced. Walking starts where the camera
    looked, facing the widest view, a couple of steps back. Furniture is not in the way: a plan's
    pieces are not walls, and stopping at every chair would make tablets frustrating.
  - **Rooms have ceilings when walking** (in the day look; the night looks keep the sky above the
    glass walls): the ceilings the real sun's shadows already used, lit by their room's lamps and
    the light bounced from the room, never by the sun. Under them the sun comes in through the
    windows only, as the real sun does (the ceilings are in its shadow map). What cameras see,
    drawn flat over the picture to be read from above, is not drawn at eye level.
  - **A kiosk is a card's options.** `idle` (seconds) brings it back to the view it opened on
    (its storey, 2D or 3D, its room), `orbit` turns it slowly meanwhile (20 frames per second, not
    with *reduce motion*), `night_dim` dims it when the sun is below the horizon, unless an alert
    shows; without `idle` they wait a minute. `tools: false` leaves the home alone on screen. Any
    touch wakes it; on a dimmed screen that touch does nothing else.
  - **`domotwin.show`, an action, not a voice feature.** Home Assistant's action names a room, an
    element, a storey, a view and optionally a screen (a card's `screen`); the integration sends it
    to every screen over the subscription it already has (`domotwin/subscribe`, open to every user),
    and each screen finds the room in its plans by id or by name as said (no case, accents or
    article). Voice is then an automation: a blueprint with Assist's conversation trigger
    ("show [the] {room}") calls `domotwin.show` and answers. Any automation can use it (a doorbell
    showing the entrance on the hallway tablet), and Assist does the speech, locally or as the user
    chose: DomoTwin adds no intent, no agent, no speech.
- **Consequences.** Walking costs what the overview costs on the CPU (0.9 ms per frame median in
  headless Chromium at High, against 1.1 ms); the software GPU draws more pixels near the eyes
  (417 ms against 300 ms per frame). The first load grew by 10.4 kB gzipped: the engine 6.7 kB (walking, the
  floor, the ceilings' light), the rest 3.7 kB (the walk button and pad, the kiosk, the requests,
  the texts). The Python tests need Assist's packages (`hassil`, `home-assistant-intents`) for the
  blueprint's test.

## D-030 · DomoTwin's own plan format

Asked by the maintainer (M10b).

- **Context.** DomoTwin started from an earlier JSON plan format, adopted with its specification.
  It carried choices DomoTwin did not need: a unit that is always centimetres, rooms as a frame
  with corners relative to it, pieces placed by their top-left corner, a flag that turned some
  kinds sideways, names in two languages, fields no part of DomoTwin read. The maintainer asked for
  that format to be dropped for good.
- **Decision.**
  - **A format of its own**: `docs/plan-format.md`, `schema/plan.schema.json`, files named
    `*.domotwin.json`, marked `"format": "domotwin-plan"` and `"version": 1`. Elements are in lists
    by what they are (`rooms`, `partitions`, `doors`, `windows`, `items`) instead of one list with
    a `type`. Rooms are outlines of plan points; their walls follow from them, and a side can be
    open, thicker or finished on its own. Doors and windows run `from` one end `to` the other along
    their wall and say which way they open (`opensTo`). Items are placed by the centre of their
    footprint (`at`), sized `[width, depth, height]`, turned by `rotation` and raised by `lift`.
    Every name is English (kinds, styles, floors, finishes), and a piece without a colour takes its
    kind's.
  - **The engine keeps its model.** The reader turns a file into the same elements as before, so
    the scene, the walls, walking and the layers are unchanged. The plan editor, the edit overlay
    (now `at`, `rotation`, `lift` and `room`) and the IFC import write the new format.
  - **Nothing reads the earlier format.** Plans stored in it are set aside when DomoTwin starts
    (storage version 3): moved, with their overlays, to `retired` in the stored data, which nothing
    shows, their 3D files kept, a warning in the log and the revision moved on so that browsers'
    drafts for them are not offered again. They are imported again as `*.domotwin.json`; no
    converter ships with DomoTwin. Model kits went with it: a 3D model is a file.
- **Consequences.** A plan stored before this change has to be imported again; the links to its
  elements come back with their ids. The demo apartment now shows its kinds' colours where it
  named none (wooden tables, green plants). A test keeps the schema's kinds, floors, finishes and
  door styles equal to the core's.

## D-031 · The network map: the Zigbee mesh over the home, from ZHA, for administrators

Asked by the maintainer (M9b).

- **Context.** A Zigbee mesh fails quietly: a sensor in the far bathroom hangs on one weak link, an
  unplugged router leaves a room cut off, and nothing says so until an automation does not run.
  ZHA draws its mesh as a graph with no home around it, and the home is what makes it readable:
  *the bathroom only hears the bedroom plug, badly*. Everything needed is in ZHA's `zha/devices`
  answer: each device's role, the quality (LQI) and strength (RSSI) of its last message, when that
  was, and its neighbour table. Home Assistant keeps ZHA's commands for administrators. These
  commands, their answers and who may send them were checked in the ZHA source of the oldest Home
  Assistant DomoTwin supports (2025.1): `zha/devices` lists the devices with their neighbours,
  `zha/topology/update` starts a scan and sends no answer, and both need an administrator.
- **Decision.**
  - **A layer for administrators with ZHA.** `network` joins the layers; the menu offers it when the
    user is an administrator and `zha` is one of Home Assistant's components. It reads ZHA over the
    dashboard's own connection, so the integration runs nothing new and nothing leaves Home
    Assistant (D-022). *Rescan* sends `zha/topology/update`, which starts a scan of minutes and
    never answers, then reads the devices every 30 s for 3 minutes.
  - **A source behind an interface.** The frontend turns a source's devices (ZHA's, for now) into
    one snapshot (devices with role, LQI, RSSI, age, availability, the element they are placed at
    and their neighbours). Zigbee2MQTT or Thread would add a source, not change the map.
  - **The analysis is in the core** (`domotwin_core::network`), read leniently and tested in Rust.
    Links are undirected; when both ends report one, the worse LQI is kept; former children are
    dropped. The thresholds are in one place: good from LQI 150, fair from 80, weak below, unknown
    without a number; LQI scales differ between radios, so they read as a guide, not a measure. A
    device is stale when not heard from for 24 hours (longer than any battery device's check-in)
    or when ZHA counts it unavailable. Each device's way to the coordinator is the widest path:
    the best weakest link, then the fewest hops, an unknown link counting as fair. The ways make
    a tree, as Zigbee's routing towards the coordinator does: a device's way is a link to one
    neighbour and then that neighbour's own way, so the hops shown are the ones its messages
    take. A stale device keeps its last way but relays for no one, and a room's link to it is no
    better than a weak one. Health counts
    weak links and stale devices, and names the rooms whose links out are all weak (*a router here
    would help*), never the coordinator's own room.
  - **Devices are placed by linking.** A device stands at the piece linked to its Home Assistant
    device, else to one of its entities. Bindings gain an optional `device` (a device registry id)
    per element, with no entity needed: a coordinator has none. A piece stands for one device at
    most; the devices with entities are placed by them, so the field matters for those without,
    and a piece that only stands for a device taps and holds as an unlinked one. The devices not
    placed are listed; in the panel, *Place* asks for a tap on a piece, door or window and opens
    the link editor filled in with the device's entities worth linking (not hidden, configuration
    or diagnostic ones).
  - **Wires are a scene primitive** (`scene::wires`), for the automation wires (M9c) as well: a
    quadratic arc between two points rising by a quarter of its length (20 cm to 1.2 m), in 16
    pieces, each end moving with its storey when the storeys spread. The renderer draws them in
    one call after the halos, over everything (no depth test: a wire behind a wall is still a
    link), soft at their sides, dashed every 24 cm when they say so, with a pulse (60 cm at
    1.2 m/s) running the way they flow, still under *reduce motion*; a frame is drawn again while a
    pulse runs. For the mesh, the links devices take to the coordinator pulse towards it, the
    others are lighter and still, and links to a stale device are dashed.
  - **Markers are HTML** over the canvas, as the badges are (D-024): buttons with a name for screen
    readers, placed where the engine projects each piece, side by side when several devices share
    a piece. A tap on a wire asks the engine (`networkAt`) for the nearest link drawn within 2 % of
    the view's smaller side. The sheet sits beside the view's tools, never over them; walking, the
    map steps aside. `last_seen`, which ZHA writes in the server's local time without its zone, is
    read in Home Assistant's time zone.
  - **Addresses stay out of diagnostics**: IEEE and network addresses and device ids are redacted
    from what the integration hands Home Assistant's diagnostics. Tests and fixtures use made-up
    addresses.
- **Consequences.** The map's code loads with the layer, in its own chunk; the engine grew by the
  analysis and the wire pass (see `PERFORMANCE.md`, M9b). The bindings format gains `device`. The
  map is as fresh as ZHA's last neighbour scan.

## D-032 · Automation wires: what sets off what, drawn in the home, live

Asked by the maintainer (M9c).

- **Context.** Home Assistant lists automations; it does not show what they do in the home. "What
  turns this lamp on?" means opening automations one by one. DomoTwin knows where every entity
  is, so it can draw an automation as wires from what sets it off to what it acts on, and light
  them when it runs. Checked in the source of Home Assistant 2025.1: `search/related` finds the
  automations of an entity, a device or an area and is open to every user; `automation/config`
  gives an automation's configuration (open in 2025.1, kept for administrators in later
  versions); the `automation_triggered` event and traces are for administrators only; every
  automation's `last_triggered` reaches every dashboard with its state.
- **Decision.**
  - **The panels list them.** The controls of a piece and the panel of a room end with the
    automations related to the piece's entities, its device and its room's area: name, how the
    piece takes part, a switch, when it last ran, and an editor link for administrators.
  - **The configuration is read in the core** (`domotwin_core::automation`), leniently and
    fuzzed: triggers, conditions and actions in both spellings Home Assistant accepts, `choose`,
    `if`, `repeat`, `parallel`, `sequence`, `wait_for_trigger` followed, at most 24 deep. Each
    end is an entity, a device, an area, a floor, a label, a place with no piece (a time, the
    sun, a template, the action called) or something a template decides when it runs. What is not known is skipped
    and counted, never refused. Configurations that cannot be read leave the list without wires.
  - **Placed by the bindings.** An entity's end is at the piece linked to it; a device's at the
    piece linked to it or to one of its entities; an area's in the room linked to it; a label's
    at every piece its entities are linked to. What has no piece (a floor among them) floats as
    a label above its room, or above the home.
  - **A tap on a piece comes first.** A linked piece under a wire still does what a tap on it
    does; elsewhere a tap picks out the automation of the wires within reach, the next one at
    each tap where several pass. Walking hides the wires.
  - **Wires as for the network map** (the `scene::wires` of D-031, a wire set of their own):
    every trigger and every condition to every action, in one colour per automation; dashed from
    a condition and to an action a template decides. Every automation at once is drawn lighter,
    and bundled by room above 30: one wire between two rooms for all the automations between
    them, stronger the more there are.
  - **Live from the states.** A run is seen when `last_triggered` moves on, which needs no
    subscription and works for every user: a one-shot pulse runs along the automation's wires
    (400 cm/s), and the pieces it acted on that changed flash. Under *reduce motion* the wires
    flash instead. Nothing is watched while no wires are shown.
  - **Who sees what.** The list is for everyone. The wires need the configurations: where Home
    Assistant keeps them for administrators, only they get the wires. The editor links and the
    layer of every automation are for administrators.
- **Consequences.** The section and the wires are chunks of their own; the engine grew by the
  reader and the wires' placing (see `PERFORMANCE.md`, M9c). A step DomoTwin does not know is
  missing from the wires until the reader learns it. Scripts called are ends, not followed into.

## D-033 · Upkeep cards: what each piece needs, and what is due

Asked by the maintainer (M9d).

- **Context.** A home is looked after piece by piece: a washing machine's filter, a fridge's coils,
  a boiler's yearly service, a warranty that ends. The information is on paper, in e-mails, in an
  IFC file the architect gave; nothing ties it to the piece. DomoTwin knows every piece and shows it
  in place, so each can carry its card, and the 3D view can show what is due.
- **Decision.**
  - **A card per piece, kept with the bindings.** Make, model, serial number, install date,
    warranty end, service life, a manual link and notes, and recurring tasks (a name, every so many
    days or months, when last done). The integration keeps them in its own storage by piece id
    (storage 4.1), out of the plan: a plan shared or exported carries no serial number. Exporting a
    plan offers its pieces' cards as a file of their own (`.upkeep.json`).
  - **Dates are days where the home is.** A task is next due an interval after it was last done
    (never done: after the piece was installed; neither known: now). A month after 31 January is the
    end of February. It is due soon from 14 days before (the home can set another lead, 0 to 365),
    overdue the day after. A warranty ending within 30 days is shown. The core works this out
    (`domotwin_core::upkeep`) for the view; the integration's sensor does the same in Python. Both
    are tested on the same cases (`tests/fixtures/upkeep-due.json`), so they cannot drift apart.
  - **Who does what.** Every user sees the cards and marks a task done (it is done in the home,
    by whoever did it); administrators write and change cards and the lead.
  - **Shown where the pieces are.** The badges of D-024 gain three kinds (a task due soon, a task
    overdue, a warranty ending), one badge system, the most urgent first. The `upkeep` layer tints
    the pieces with tasks (green, amber, red) through a free channel of the elements' texture,
    without frames of its own, and lists every task by date with **Done**.
  - **A piece's own sheet.** A long press on a piece linked to nothing used to open its room's
    panel. It now opens the piece's sheet when it has a card, or for administrators, who write
    cards there; the room's panel is a tap away in it. Linked pieces show their card with their
    controls.
  - **From IFC files.** The import reads the standard property sets, checked against
    buildingSMART's definitions of IFC2x3, IFC4 and IFC4.3: `Pset_ManufacturerTypeInformation`
    (`Manufacturer`, `ModelLabel` else `ModelReference`, on the piece or its type),
    `Pset_ManufacturerOccurrence` (`SerialNumber`, `AcquisitionDate`), `Pset_Warranty`
    (`WarrantyEndDate`, else `WarrantyStartDate` and `WarrantyPeriod`), `Pset_ServiceLife`
    (`ServiceLifeDuration`), an `InstallationDate` property in any set, and the `IncorporationDate`
    of the `IfcAsset` a piece belongs to. IFC2x3 dates (an `IfcCalendarDate` by reference) and
    periods in seconds are read too. Installed: said so, else incorporated, else bought. What a card
    already says stays; the file fills what it lacks.
  - **One entity.** `sensor.domotwin_upkeep_due`: the number of tasks due soon or overdue, the
    tasks in its attributes (at most 50), for users' own notifications. It is named the same in
    every language, and changes with the cards, the plans and at midnight. No other entity.
- **Consequences.** The integration has a sensor platform and a service device, "DomoTwin". The
  stored data is version 4: a DomoTwin from before upkeep refuses it rather than drop the cards
  (an older 3.x reading a newer 3.x would have dropped them and saved at once). The card, the list
  and the IFC reading are in chunks loaded with the sheets, the layer and the import; the engine
  grew by the date reckoning and a layer flag (see `PERFORMANCE.md`, M9d).

## D-034 · People in their rooms: placed by the integration from what already says where they are

Asked by the maintainer (M9e).

- **Context.** A twin of the home shows who is in it: a figure in each person's room, walking to
  the next room when they move, the room's panel saying who is there, a voice assistant answering
  "where is Alex?". Home Assistant knows who is home (`person`) but not in which room. Room-level
  locating already exists around it: Bermuda's area sensors (Bluetooth, through ESPHome proxies or
  Shelly devices), ESPresense's room sensors, template sensors. DomoTwin's own Bluetooth locating,
  for homes without them, is a milestone of its own (M9f).
- **Decision.**
  - **The integration places people, not the browser.** For each person an administrator lists
    the entities that say where they are (those on their phone's or watch's device are suggested).
    The integration follows them and works out each person's room: the entity that changed last
    wins (a watch that just walked into the kitchen says more than a phone left on the desk); only
    a person `home` is placed; a state naming nowhere names no room whatever its attributes still
    say. A room is found by Bermuda's `area_id`, then an area's id, name or alias read by a room
    (its binding, else its name, D-022), then a room's name; a name two rooms have is not guessed.
    Names are compared without case, accents or punctuation, as the frontend compares them.
  - **A sensor per person.** `sensor.domotwin_<person>_room`: the room's name, `not_home`, or
    unknown; its id, area, storey, since when and what said so in attributes. Automations and
    other dashboards use them, every screen shows the same, and the voice answers need no screen
    open. The upkeep sensor (D-033) is no longer DomoTwin's one entity.
  - **Settings in a store of their own** (`.storage/domotwin.people`): an older DomoTwin leaves
    them alone, and the main data's version (D-033) does not move for them. Saves are checked
    against the revision they started from; a renamed entity (its id) is followed.
  - **Figures, drawn by the engine.** A stylised person (a body turned on a lathe, arms, a head)
    or a pin, in the person's colour, lit by the sky and the sun, glowing in the looks that glow,
    with a soft shadow; one shared mesh, a draw call each. They stand around the middle of their
    room, clear of its walls, its pieces and its name, each keeping their place while others come
    and go. A move walks through the doors along the way a walker takes (D-029), at 1.3 m/s; to
    another storey, out and in. *Reduce motion* places them at once. Their names are HTML over the
    picture, as the badges; a tap opens their sheet.
  - **Pictures only from Home Assistant.** A person's picture is shown when Home Assistant serves
    it (a path); an outside address is never loaded (D-022): their initials instead.
  - **Hiding and who sees.** Anyone can hide themselves from DomoTwin's views, and show themselves
    again; administrators anyone. With people shown to administrators only, others see nobody and
    `domotwin.where` tells nobody where anyone is unless an administrator calls it: a voice
    question runs as an automation, whoever asks. Home Assistant has no per-entity permissions:
    the sensors stay readable by every user, which the documentation says.
  - **Voice through an action, as D-029.** `domotwin.where` returns where a person is (a name heard
    a letter off is forgiven) or everyone at home, with a sentence in Home Assistant's language;
    `domotwin.show` takes a person. The blueprint `where_by_voice.yaml` asks Assist's
    conversation trigger; DomoTwin adds no intent and no agent.
- **Consequences.** The engine draws a new pass of up to a draw call per person and frames while
  someone walks; the walk floors know the pieces (for where people stand, not for walking). The
  settings dialog is a chunk of its own. See `PERFORMANCE.md`, M9e.

## D-035 · Bluetooth locating: from the plan first, then learned, along the doors

Asked by the maintainer (M9f, after M9e).

- **Context.** People in their rooms (D-034) need something that says which room someone is in.
  Bermuda and ESPresense do, but many homes have neither: they have Home Assistant's Bluetooth
  receivers (its adapter, ESPHome proxies, Shelly devices) and phones, watches and tags. Room
  locating by signal strength is noisy (bodies, walls, pockets) and fingerprinting it room by room
  is a chore that most people stop halfway through. DomoTwin has what others lack: the plan, with
  its walls, doors, storeys and the pieces receivers sit on.
- **Decision.**
  - **The integration locates, every two seconds.** It follows only the devices an administrator
    chose: a Private BLE Device entry (its identity key resolves the phone's or watch's changing
    addresses; the key is read from that entry and never stored, sent or logged), the iBeacon of
    the companion app's transmitter (any address), or a tag's fixed address. Every packet of a
    followed address is heard where Home Assistant offers it (2026.x), else the latest packet of
    each receiver is read every second. The readings of the last six seconds make one observation
    (the median of each receiver's).
  - **A model from the plan first.** For each room and receiver, what a phone held in the room
    should give: the log-distance law (exponent 2.2) with about 4 dB a wall, 0.4 of a wall for a
    door, none for a side left open and 15 dB a floor (the multi-wall model), over a few points of
    the room, as a mean and a spread. A receiver is placed in the room of its device's area, at the
    piece linked to its device, or where an administrator says. It locates from the first minute,
    without a calibration walk.
  - **Then what is learned.** A room taught (a device held there for half a minute) and, for phones
    and watches, readings in a room whose presence or occupancy sensor agrees, are learned as a
    running mean and variance per room and receiver; the plan counts as eight readings, what is
    learned up to four hundred. Each device's own loudness is learned when it is surely located,
    so that a quiet tag and a loud phone are not confused with near and far.
  - **Silence counts, strays do not.** A receiver listening that did not hear a device says it is
    far (a censored reading); a reading off by far (a reflection) or a packet missed weighs little.
  - **A filter along the doors.** A forward filter over the rooms: staying put is likeliest, a room
    through a door, a side left open or stairs next, a jump across the home almost never. Presence
    sensors are a weight on rooms for what people carry, never for things. The room told changes
    only at a chance of 0.6 held twice in a row, or 0.85 at once.
  - **A sensor per device, implicit sources of people.** `sensor.domotwin_<device>_bluetooth` names
    the room; a phone or a watch with an owner is a source of their place (D-034), the owner placed
    if they were not, so the figures walk from it. Things get their own sensor, and a
    `left_behind` binary sensor for an owner away while they are heard at home. `domotwin.where`
    finds devices by name; a person is meant before a device named alike.
  - **Kept apart, saved sparingly.** Settings and what was learned are two stores of their own;
    the learned store is saved a minute after it changes and when DomoTwin stops. The sensors are
    written when the room changes, not at each reading: the recorder keeps no flood of rows.
- **Consequences.** A home without Bluetooth loses nothing (the module is imported only when
  Home Assistant has Bluetooth). The model is rebuilt when the plans, bindings or registries change
  (a burst of changes is one rebuild) and when a receiver appears; one rebuild of the demo home
  takes milliseconds, run in an executor. Accuracy is room-level, and depends on the receivers:
  a simulated walk through the demo home with noisy readings is told right nine ticks in ten with a
  receiver in each room, three in four with four receivers for ten rooms (`tests/test_locating.py`).
  The settings dialog is a chunk of its own. See `PERFORMANCE.md`, M9f.

## D-036 · Two more looks: a cartoon with ink, and a clay model

Asked by the maintainer (M8b): two looks besides neon, blueprint and day, a cartoon among them,
researched first. Decided while the maintainer was away; open to review.

- **Context.** A cartoon look, as games and illustrated maps draw them, rests on four things: light
  in a few flat bands with a hard edge (cel shading), flat vivid colours instead of textures, ink
  around shapes, and a simple bright backdrop. The ink is the hard part. There are three usual
  ways to draw it:
  - an **inverted hull** draws every mesh a second time, a little larger and from behind. It
    doubles the draw cost and breaks on thin parts (a lamp's stem, a chair's legs);
  - **edges found in the picture**: one full-screen pass over the depth (and the normals, when
    there are any) after the scene is drawn;
  - **lines from the geometry**: DomoTwin already draws the home's outlines (D-027): walls,
    corners, doors, windows and floors, as lines a few pixels wide.

  The second look had to be as different from the others as the cartoon. The candidates were
  watercolour (noisy, and hard to keep calm on small dashboards), low poly (DomoTwin's pieces are
  already simple) and an **architect's clay model**. The clay model reads the space and the light
  first, with one matte colour and soft shadows, which no other look does.
- **Decision.**
  - **The looks stay data.** A look (`domotwin-core::theme`) gains its shading (how much the
    palette keeps each surface's lightness, steps of sunlight, vividness, patterns left out, rim
    ink, shine), the width of its outlines, its **ink** (0: none), whether its background comes
    from the dashboard and whether its bloom is drawn from the Balanced preset up. The renderer
    asks the look, never its name; the looks of D-027 keep their values and draw as before.
  - **The cartoon.** Sunlight in two steps (none, half, full) whose edges are smoothed over about
    a pixel (`fwidth`), so they do not shimmer, on the furniture and the people alike; the sky's
    light even, so that faces are flat colours. Colours are 1.55 times as vivid and patterns 60 %
    left out. A highlight is a spot or nothing. The home's outlines are dark ink, 2.2 times as
    wide. Ink comes in three layers:
    - the outlines of the home, as before;
    - rim ink in the shader where a curved piece turns away from the eye, only where the surface
      curves (its normal changes from pixel to pixel), so that a flat wall or table top seen at a
      grazing angle keeps its colour;
    - **edges found in the depth**: the frame is drawn in two phases. What is opaque comes first
      (the background, the home, the people wholly shown); its depth is resolved and turned back
      into distances from the eye (the projection's third and fourth rows), and a pixel is inked
      where the distance bends towards the eye. Then come glass, the outlines, the halos and the
      wires in their usual order, so the ink never crosses them. Across a plane, however slanted, it barely bends. At the edge
      of something in front of what is behind it, it bends by the gap between them. The bend is
      measured in line widths at that distance (the size of a pixel there, in perspective or in
      the 2D plan's orthographic view), so the ink does not change as the view zooms or moves to
      the plan. Only the near side is inked, so the ink hugs the furniture, the people and the home
      against the ground: the pixel next to the edge fully, the one after it by half (a softer
      edge). Normals are not needed, so the scene is drawn once, without a second target. People
      fading in or out (dissolved pixel by pixel, D-034) are drawn in the second phase, so their
      holes are not inked. Nothing is read on the sky and the lawn.
    - The sky is blue over a lawn. The rooms' names are inked like the lines; people's tags keep
      their colour inside a ring of ink.
  - **The clay model.** Every surface takes one warm matte clay, a little lighter or darker by its
    material. Patterns are left out, the lines are faint and thin, and the look's shine also scales
    reflections: metals and mirrors turn to clay too. The backdrop is the same clay. Sun shadows and
    lamps stay: at night it reads like a lit model.
  - **Both follow the time of day.** Their light, sky and ground dim with it, like day; neither
    has glass walls. Their overlays (buttons, names, dialogs, the panel's header) stay light
    whatever the dashboard's theme, as the night looks' stay dark. Automatic still means neon in
    dark mode and day otherwise.
  - **The ink costs a pass only where it shows.** The cartoon is drawn offscreen with MSAA from the
    Balanced preset up, its depth resolved for the ink. Its bloom (lamps) is drawn on High only,
    like day's; on Balanced the bloom's textures are not even made. On Eco it is drawn straight to
    the screen, with the outlines and the rim ink but without the ink from the depth. The clay is
    drawn like day.
- **Consequences.** Five looks, one renderer and no new mesh: the cartoon's ink is a depth resolve
  and a full-screen pass of nine depth reads a pixel over what is opaque. The steps of light and
  the vividness are one piece of shader code shared by the home and the people. The ink is found in the depth, not in
  the normals, so a crease between two faces of a box seen from the front is not inked (its bands
  of light tell the faces apart); a deep fold is. Small pieces far away get a dot of ink. See
  `PERFORMANCE.md`, M8b, and [`looks.md`](looks.md).

## D-037 · The first release moved forward

Asked by the maintainer, after M8b.

- **Context.** The roadmap put 0.1.0 at the end, after the imports and the polish (D-022, M13).
  Everything else it promised was done: the views, live control, editing, storeys, the looks, the
  kiosk, the layers, the network map, the automations, the upkeep cards, people and Bluetooth
  locating. Nobody could install it from HACS without a release.
- **Decision.** Release 0.1.0 right after M8b, as it is, through release-please's pull request
  (`CONTRIBUTING.md`, *Releases*). Then: what cameras see drawn on the floor (M5b), the imports
  (M11), the polish (M12), a pass over size and speed (M12b), and a second release, 0.2.0, with
  the HACS submission (M13). Before 1.0, a new feature raises the minor version
  (`release-please-config.json`), so the next release with features is 0.2.0.
- **Consequences.** 0.1.0 ships the camera views as flat shapes over the picture (fixed in M5b) and
  without the install test on a clean Home Assistant and the measurements on real devices, which
  M13 does before the submission. The changelog of 0.1.0 lists every milestone so far.

## D-038 · What cameras see, drawn by the engine on the floor

Raised by the maintainer, twice (M5b).

- **Context.** D-024 drew a camera's view as an SVG polygon over the picture: flat on the screen,
  over the sofa and the people, its outline along the walls of the room. It was taken for the
  room's outline, or its highlight.
- **Decision.**
  - **In the scene.** The engine draws the views in the frame, as a fan of triangles from the
    camera to the points D-024 works out, 3 cm over the floor of its storey (over the rugs) and
    moved with it (D-028). It is drawn after what is opaque and before the cartoon's ink (D-036)
    and glass, with the depth tested and not written: the furniture and the people standing on
    it hide it, the ink outlines them over it, and it blends with the floor. Its mesh is rebuilt only when the plan, the bindings, a camera's state or the
    focus change; the frame costs one draw call for all the cameras.
  - **A look of its own.** The fan's colour fades with the distance from the camera; a ring every
    metre from the camera and its two side rays are drawn as lines about a pixel and a half wide
    (from the screen-space derivatives, so they stay thin at any zoom). The side along the walls
    is never drawn: it was what read as the room. Blue (the look's accent), red while recording,
    grey when unavailable or unknown to Home Assistant, as its badge says. The tones are the
    picture's, like the lamps' light, not the dashboard theme's; the badges keep the theme's.
  - **Faint until tapped.** A tap on a camera's piece or badge draws its view whole for 15
    seconds; the others stay faint. A tap anywhere else (a piece, a room, the floor) makes them all
    faint again. The engine times the 15 seconds on its frames' clock; the view only asks for a
    frame then.
  - **Where it is not drawn.** While walking and on the way down to eye level or back up (it
    would lie under the feet, D-029), in the storeys' pictures (D-028), and while editing or
    linking; the card's `cameras: false` and the layer menu leave it out.
  - **For tests and tools.** The engine's stats list the views drawn (`cameraViews`: the element,
    the tone, whether tapped); `cameraViews()` still gives their points on the screen.
- **Consequences.** The view no longer needs SVG nodes or a projection on every camera move. A
  view is still not cut by the furniture (D-024): it is hidden by it, not stopped. The rings
  measure from the camera's spot on the floor, not from its height.

## D-039 · Private rooms: closed in the scene, for whoever may not see them

Asked by the maintainer (M9g).

- **Context.** A home is shared: a bedroom or an office should not show what is in it, who is
  there, or give its lamps and blinds to anyone at a wall tablet, a guest's phone or a child's.
  Home Assistant's permissions are by user, not by entity (D-034).
- **Decision.**
  - **Stored with the settings.** `settings.rooms`: `{room id: {"people": [person ids], "while"?:
    entity id}}`, checked by the integration (at most 200 rooms, 50 people each). A room listed
    is private; open while its `while` entity is `off` (unavailable or unknown keeps it private).
  - **Who sees it.** Its people, through the Home Assistant user of their `person`. Nobody else:
    not an administrator who is not among them, not a shared screen's user, not a voice
    satellite (a voice question runs as nobody's user). The same rule in Python (`privacy.py`,
    for the services) and TypeScript (`live/privacy.ts`, for the views), each with its tests.
  - **Closed in the scene, not hidden on the GPU.** The engine builds the scene without the
    pieces of a closed room (`SceneOptions.closed_rooms`): no mesh, lamp, pick, point or bounds
    to leak them, and the moving parts rebuilt keep them out; its doors and windows (those drawn
    with the room beside it too: each knows the room on its other side) are drawn as in the
    plan, their states left out of the live looks, and the 3D files of its pieces are not
    fetched. Building again costs what a
    change of the plan costs, only when a room the scene shows closes or opens, and the rooms
    closed are given before a plan is built. Its floor stays, under a
    frosted, hatched cover drawn by the floors' shader from a flag in the rooms' texture
    (D-023), toned to the look's light.
  - **Walls as the others'.** The roadmap said "walls up": a private room in front would then hide
    the rooms behind it in the cut-away. Its walls follow the cut-away; the cover and the lock on
    its name say it is closed.
  - **No way in.** The walking floor puts a wall across every door and open side into a closed
    room; nobody starts or stops in it (D-029, D-034).
  - **The views.** No badges, layer values, presence, camera views or people in it, nor its lit
    lights in its storey's label; its dangers still show (smoke, gas, CO, a leak, an alarm), they
    matter more than privacy, but not its warnings (CO₂, a window open in the rain), which would
    tell someone is in. Taps do nothing; a long press opens its panel, which only says it is
    private. People and things in it are "in a private room".
  - **Not before the settings.** The card and the panel show the home once its settings are read
    (asked again every 10 s until then; read once, they stay when a later read fails): before,
    its private rooms are not known.
  - **Administrators change the home.** In the edit and plan modes and while linking, nothing is
    closed.
  - **The services.** `domotwin.where` says "in a private room" and shows nothing;
    `domotwin.show` does not show a person's room when it is private for the caller. Each screen
    does nothing for a room its own viewer may not see or something in it, whoever asked, not
    even switch to its storey.
- **Consequences.** Closing or opening a room builds the scene again (6 ms on the demo, 9 ms with
  its upper floor, `PERFORMANCE.md`). DomoTwin's own sensors of each person's room still say the
  room to every Home Assistant user, as every entity does; the settings say so: private on a shared screen, not behind a
  security barrier. A closed room splitting a storey in two leaves people's figures no way round
  it: they walk straight, as between rooms with no door (D-034).

## D-040 · Plans of other apps: one builder, a reader per format

Planned since M3b (D-022, M11).

- **Context.** People draw their homes in other apps. Sweet Home 3D is the free home planner,
  DXF what every drawing app exports, and phones with LiDAR scan a room in a minute (Apple's
  RoomPlan, which most room-scanning apps use). The IFC import (D-009, D-018) already turned a
  storey into a plan: closing the gaps between rooms, placing the openings, turning the plan
  square.
- **Decision.**
  - **One crate, one module.** `domotwin-ifc` became `domotwin-import`. A file's format comes
    from its content (`PlanFile`: the STEP header, a ZIP holding `Home.xml` or a USD layer, the
    DXF section marker, a JSON object with walls or rooms), not from its name. The module is still
    fetched only to import a file. Its ZIP and XML readers are `domotwin-models`' (made public,
    its wasm API behind a feature the import leaves out).
  - **A draft, then one builder.** Each reader turns its file into a `Draft` in plan
    coordinates: rooms inside their walls, wall thicknesses, openings with a centre, a direction
    and a side, pieces with a kind. `build::build` does what the IFC conversion did, for every
    format, and the IFC plans stayed byte for byte the same.
  - **Rooms from lines.** Sweet Home 3D levels drawn with walls only, DXF drawings without room
    outlines, and scans without floors get their rooms from `faces`: the lines are cut where they
    cross or meet, the bounded faces are walked, and each is moved inside its walls. In a DXF,
    the faces between a wall's two lines are walls (narrower than 65 cm). A face mostly covered
    by others is the building around them; a small one inside a room is a table or a stair well
    drawn with lines. Door gaps are closed by the doors' own jambs.
  - **What is what, in a DXF**: from the names of its layers and blocks, in four languages; a
    door from its swing's arc, the units from `$INSUNITS` or the drawing's size. This is a guess,
    so the message says what was left out and the plan editor finishes the rest.
  - **Room scans: RoomPlan's own files.** Its USDZ holds one text layer (`.usda`) per wall, door,
    window, floor and object, with its category in `customData`. DomoTwin reads these layers
    with a small USDA parser, without composing USD's references. Its JSON (`CapturedRoom`,
    `CapturedStructure`) holds the same elements. A scan is in metres, `y` up, turned where the
    phone pointed: the plan is turned square like an IFC model. Its stories are storeys (a USDZ
    does not say them: the levels its floors and walls stand at), its sections name the rooms,
    and its objects' categories and attributes give the kinds.
  - **Left out, and said so.** USD's binary layers (`usdc`), which need a far larger reader, and
    mesh scans (OBJ, PLY), which are triangles without walls or rooms. Telling walls from
    furniture in a mesh is guesswork that would make plans no one can trust. Their furniture can
    come in as 3D models (D-021). DWG and binary DXF files ask to be saved as ASCII DXF.
  - **Ids.** A file's own ids are kept where it has stable ones (IFC `GlobalId`s, the ids Sweet
    Home 3D writes since 6.4), so importing an updated file keeps the links. DXF drawings and
    scans number their elements in their order.
  - **Names in the user's language.** The rooms a scan names by their kind are named in the
    panel's language. The others keep the file's names.
- **Consequences.** The import module grows from 120 to 218 kB gzipped, still fetched only to
  import a file (`PERFORMANCE.md`); the first load does not change. Readers are fuzzed together
  (`plan_import`), and their limits are counted (elements, entities, nesting) so that a
  malicious file runs out of budget, not of memory. A DXF without layer names reads every line
  as a wall: its rooms come out right when its furniture is in blocks named for what they are.

## D-041 · Voice at hand: Home Assistant's Assist, opened listening

Asked by the maintainer for M12.

- **Context.** A wall tablet showing DomoTwin is where people would like to say "show the
  kitchen" or "turn off the living room". Home Assistant already has all of voice: Assist hears
  (speech-to-text), understands (its intents, or a conversation agent) and answers
  (text-to-speech), with a pipeline each user chooses, local Whisper and Piper included. Two
  things stand in the way. The browser lends the microphone to pages served over HTTPS only, and
  many homes reach Home Assistant over plain HTTP on their network. A fresh Home Assistant has
  Assist without speech-to-text, so it can read but not hear.
- **Decision.**
  - **No voice engine in DomoTwin.** The card's and the panel's microphone button fires Home
    Assistant's own `assist` action (`hass-action`, as a dashboard button does), with the
    preferred pipeline when it hears, else the first that does. Assist's dialog listens, shows
    what it heard and answers. Without Assist (no `conversation` integration), or with
    `voice: false`, there is no button.
  - **Over HTTP, a dialog says why.** No microphone means a button that does nothing, so
    instead the dialog explains that HTTPS is needed and how to get it: Home Assistant Cloud, the
    Let's Encrypt or NGINX app, or a reverse proxy. It also notes that the companion apps listen
    themselves. It offers to type instead (Assist without listening).
  - **Voice set up when Assist cannot hear.** Administrators are offered local voice, with
    their consent and with what is downloaded said first.
    - On Home Assistant OS and Supervised, DomoTwin installs and starts Whisper (or
      Speech-to-Phrase, quicker on a Raspberry Pi) and Piper through the Supervisor's
      `AddonManager`, as the Z-Wave JS and Matter integrations install theirs. An app it installs
      is set to the home's language. One installed before keeps its user's settings and is only
      started.
    - Then it accepts the Wyoming integration's discoveries of these apps, and no other (another
      Wyoming app waits for its user). It finds their engines by the apps' host names, so an
      engine of another Wyoming server is never taken. The first start downloads the apps'
      models, so it waits up to ten minutes for them; a discovery Home Assistant was told to
      ignore is said at once, with how to stop ignoring it.
    - It creates an Assist pipeline, "DomoTwin (local)", in the home's language
      (`async_create_default_pipeline`). The integration makes it the preferred one, once and only
      if the preferred one could not hear, so a pipeline chosen later is never taken back.
    - The steps run in Home Assistant, in the background. The dialog follows them and says
      which one failed.
    - On Container and Core, which have no apps, the dialog gives the containers to run and
      the integrations to add.
    - Someone who is not an administrator is told to ask one.
  - **The voice blueprints in one tap.** "Show the kitchen" and "where is…" (`blueprints/`)
    ship inside the integration. The panel's voice settings install them into Home Assistant's
    blueprint folder, say when one was edited there (kept unless replaced), and open the
    blueprint page to make an automation from them. Nothing is fetched from the internet.
- **Consequences.** DomoTwin calls no speech service and adds nothing to its bundles but a
  dialog loaded on demand. What is heard and said stays in the home whenever the pipeline is
  local. Installing apps goes through Home Assistant's Supervisor API and its usual permissions
  (administrators only, websocket commands checked server-side). Setting up a pipeline needs the
  `assist_pipeline` integration, which is imported only when used.

## D-042 · Polish: a font of its own, the keyboard, a calmer header

M12.

- **Context.** DomoTwin drew its texts in whatever font Home Assistant's theme set, and its
  buttons in the browser's default, Arial on most systems. Its header had eleven buttons in the
  panel, so the title shrank to its first letter on a laptop. Everything in the 3D view could be
  reached with a pointer, but the keyboard could only turn and zoom: no room, no lamp. Dialogs
  did not take the focus, and closing them lost it.
- **Decision.**
  - **A bundled variable font.** Inter 4.1 (SIL Open Font License, no reserved name), its
    optical size set for text, every weight from 100 to 900 in one file. It is cut down to the
    characters of a home's names and DomoTwin's texts (Latin, punctuation, °, ², ₂, arrows):
    about 60 kB (`scripts/subset-font.py`, reproducible). It is served by the integration under
    its content hash, never from the internet, and declared once in the document (`FontFace`),
    since shadow roots ignore `@font-face`. The browser fetches it only when a text uses it. The
    card's `font_family` puts another font first (`theme`: the theme's), the bundled one still
    covering what it lacks. Buttons and fields inherit it.
  - **A menu for what is not done every day.** The panel's header keeps the actions of each day
    (import, storeys, plan, arrange, link). The export and the settings (home, people,
    Bluetooth, private rooms, voice) go in a "More" menu.
  - **The keyboard everywhere a pointer goes in the view.**
    - The 3D view is an `application` described by its keys. Tab from it reaches a list of the
      rooms, out of sight until focused, with the layer's value of each room. A room's button
      frames it and opens its controls, where every lamp, cover and scene is.
    - Menus follow the WAI-ARIA menu pattern: arrows, Home, End, Escape, the focus in and back.
    - Dialogs and sheets take the focus when they open. Escape presses their cancel button
      (except in a field, which may hold what is being typed), and the focus goes back to what
      opened them.
  - **Names that say which.** A switch is named after its entity (the role says on or off), and
    a row of buttons is a group named after its entity. A button whose label says what it does
    (2D plan / 3D view, walk, spread) no longer also claims to be pressed. The layers button names
    the layer shown.
  - **Seen.** Focus rings on every control, in the header's text colour on the header. Warning
    texts are mixed towards the text colour, and the chips and counts darkened, to reach WCAG's
    4.5:1. Toasts are read by a live region that is always there.
  - **Reduced motion, in the engine too.** Under *reduce motion*, camera moves, the storeys
    spreading, the walls going down and a walk to where the floor was tapped happen at once, as
    the layers and the people already held still. Walking with the keys keeps a walker's pace.
- **Consequences.** The first load does not change (the font is outside it and fetched once,
  cached by its hash). Some pointer-only work remains for later:
  - picking an element in link mode, arranging pieces in edit mode, drawing in the plan
    editor, picking a link in the network map and a wire among the automations;
  - error messages of the forms that are not yet tied to their field.

## D-043 · Size and speed: the analysis in a module of its own, measured before and after

M12b.

- **Context.** The network map (D-031) and the automation wires (D-032) put their reading and
  analysis in the engine, so in every view's first load, for panels that only administrators
  open. Most of a large mesh's time went into writing it as JSON. The frame time on each preset,
  the integration's work and the CI's time had not been measured.
- **Decision.**
  - **A fifth wasm module, `domotwin-analysis`**, loaded the first time the network map or the
    automations are shown (as the plan import, the 3D models and the plan editor are, D-021,
    D-025). It reads a mesh's snapshot, finds the routes and writes the analysis, and reads
    automations' configurations. The engine keeps what it draws:
    - for the map, a drawing: each device's piece and whether it is stale, each link's ends,
      quality and pulse. The engine draws it and answers with the room of each device, which the
      analysis needs for its health;
    - for the automations, their ends placed, as before.

    The module is fetched only when there is something for it to read. Home Assistant gives the
    automations' configurations to administrators only, so a piece's sheet opened by anyone else
    never fetches it. When it cannot be loaded, the sheet, the wires and the map say so.
  - **Small JSON between them.** A link of the drawing is five numbers, not an object (48 kB for
    a mesh of 2 400 links instead of 164 kB). The drawing and the analysis are written from what
    they borrow of the mesh, without building JSON values first: the same JSON, ten times
    faster.
  - **Measured and left as they are**, since they are within their budgets:
    - the frame time: the renderer did not change; the presets are now measured against each
      other in `e2e/perf.spec.ts`;
    - the integration's work: the Bluetooth tick, every two seconds, takes about 80 µs a device
      followed, and a packet heard 3 µs (`PERFORMANCE.md`).
  - **The CI's browser tests in four parts**, run side by side: the measurements on a runner of
    their own (a Playwright project, `perf`), the rest split between three, test by test
    (`fullyParallel`, `--shard`). One `e2e` check gathers them, so the required checks keep
    their names.
  - **Tried and dropped**:
    - `opt-level = "s"`: the engine is 30 kB bigger gzipped;
    - more of `wasm-opt`'s passes: about 1 kB, for a slower build;
    - keeping the Bluetooth packets by receiver: the tick's time stayed within its noise.
- **Consequences.**
  - The first load goes from 480.5 kB to 468.7 kB gzipped.
  - The map and the automations fetch 67 kB more the first time they are shown, cached
    afterwards. That is more than left the engine: the module has its own copy of the JSON
    reader and of what it uses of the standard library.
  - A large mesh shows as fast as before, end to end. The engine's share falls from 27 ms to
    18 ms.
  - `setNetwork` takes a drawing, not a snapshot. `readAutomation` moves to the analysis module.

## D-044 · Release 0.2.0: brand images of its own, tried in a real Home Assistant

M13.

- **Context.** HACS's default list checks that an integration has brand images. Until Home
  Assistant 2026.3 they went to the `home-assistant/brands` repository. Since 2026.3 a custom
  integration ships them in a `brand/` folder of its own, which Home Assistant serves itself, and
  that repository's folder for custom integrations is legacy. The browser tests use a mocked
  `hass`; they had never been compared with Home Assistant's own frontend, which lays panels and
  cards out its own way.
- **Decision.**
  - **Brand images in the integration** (`custom_components/domotwin/brand/`): the icon, the logo
    and the dark logo, each with its `@2x`. They are rendered by `scripts/render-brand.mjs` from
    one drawing (`docs/brand/icon.svg`) and the bundled font, as transparent PNG at the sizes
    Home Assistant asks for (`tests/test_brand.py`). Home Assistant falls back on the icon for
    any image left out, so none is asked of the internet. The HACS check runs with nothing
    ignored.
  - **Tried in a real Home Assistant** (2026.10, a fresh configuration), installed from a zip
    made as the release makes it. First the smoke test (`scripts/ha-smoke.mjs`), which now also
    asks for the brand icon; then the panel, and a dashboard with the card next to another, in a
    browser. Two faults came out, both hidden by the mocked `hass`:
    - **The panel was 216 px high.** Home Assistant's custom panel element
      (`ha-panel-custom`) is as high as its content, so a percentage has no height to take,
      and it pads the screen's safe areas. The panel now takes the window's height (`100dvh`,
      the visible part on phones) less those areas, and the browser tests lay it out in an
      element like Home Assistant's, with a test of its height.
    - **A card moved while its engine loaded crashed that engine.** Dashboards place their
      cards that way. On stopping, the view asked the canvas for a context to lose, which made
      a lost one; the engine then panicked on it. The engine is now built only if its view
      still wants it once the WebAssembly is loaded, it gives its own context back when freed,
      and it refuses a lost context with a code (`context_lost`).
  - **A context lost later** (a GPU reset, the browser's limit on contexts, a phone putting the
    page away) loses everything drawn. The engine refuses every call on it rather than reach the
    renderer, and the view starts again on a fresh canvas, keeping the plan being drawn, as
    when it leaves the page and comes back. It starts again once the page is shown, and once a
    minute at most: lost again within the minute, the GPU is failing, and the view says
    DomoTwin could not start until the minute is past.
  - **The release zip keeps the build's manifest** (`build.json`), so that the smoke test runs on
    the zip as released. The smoke test asks for the brand icon only from Home Assistant 2026.3.
- **Consequences.**
  - From Home Assistant 2026.3, its integration pages show DomoTwin's icon and logo, served from
    the integration's folder. Before 2026.3 they show the placeholder of any integration without
    images, as 0.1.0 did.
  - Three steps are left to the maintainer (`HACS_SUBMISSION.md`): measurements on real devices,
    the install through HACS's own pages (it signs in to GitHub), and the pull request to HACS's
    default list.

## D-045 · Phones and crowded names: icons in the toolbar, the rooms' names given way

M13b.

- **Context.** Tried on a phone and on a computer with a real home, the view was crowded: every
  room had its name in full over its floor, closets and toilets included, and the names of small
  rooms side by side covered one another. In the panel on a phone, the toolbar's buttons with
  their names made the page wider than the screen, which scrolled sideways.
- **Decision.**
  - **The panel is never wider than the screen.** The toolbar can shrink (its title is cut
    with an ellipsis), the buttons keep their size, and what is too long is cut, not scrolled;
    menus and dialogs scroll within the screen's height. When the buttons' names do not fit
    beside the title, or when Home Assistant says the screen is narrow, the buttons keep their
    icons alone; their names stay as tooltips and for screen readers. Whether they fit is
    measured, with them shown, whenever they change or a font loads: French names are longer
    than English ones, and the languages to come (M21) longer still. Narrower than 560 px (a
    phone), the import and the storeys move to the More menu, so the buttons left fit in
    360 px; without that menu (while linking, or without a plan) the import stays in the
    toolbar.
  - **Each room's name has an icon** for its kind, read from its name in English or French
    (kitchen, living room, bedroom, bathroom, toilet, office, laundry, hall, closet, garage,
    stairs, outside), a plain room otherwise. The first word of the name that names a kind gives
    it: "Chambre avec dressing" is a bedroom, "Salle de bains / WC" a bathroom. A private room
    keeps its lock.
  - **Small rooms are left out**: closets, whatever their size (the maintainer asked not to see
    them), and rooms under 2.5 m², unless asked for (the layers menu's **Small rooms' names**,
    shown while the names are; the card option `small_rooms`). The engine gives each name its
    room's area, within its outline.
  - **Names give way to the bigger rooms.** The names are placed from the biggest room to the
    smallest: a name that would cover another keeps only its icon, and an icon that would too is
    left out, as is a name outside the view. A name's width is measured in the view's font (the
    card's `font_family` too), no wider than the 240 px or 40 % of the view past which it is
    cut. A name keeps how it is shown while it covers nothing; to be shown, or shown whole, it
    needs 12 px around it rather than 4, so that names do not come and go as the camera turns.
- **Consequences.**
  - A phone shows the plan without sideways scroll, and an apartment's names stay readable at any
    zoom: zooming in gives the rooms left with their icon their names back.
  - Rooms whose name says nothing of their kind keep the plain room icon; the words are those of
    the languages DomoTwin speaks, and grow with them (M21).
  - The names are placed again only when they move (the camera turns), the view changes size or
    the small rooms are asked for: 0.18 ms for a hundred rooms (Node 22), each name measured
    once.

## D-046 · Actions done later: kept by DomoTwin, set from the sheet, an automation or a voice

M14.

- **Context.** Asked to "switch the lantern on tomorrow at 6:30 until 6:45", Home Assistant's Assist
  refused: it controls devices now, and Home Assistant has no way to do something once, later,
  short of writing an automation. Its timers say when, but act only on what a person does then.
  A piece's sheet is where its device is controlled; the clock of what waits belongs over the piece.
- **Decision.**
  - **DomoTwin keeps the actions** in a store of its own (`domotwin.schedules`), and does each at
    its time with Home Assistant's `homeassistant.turn_on` and `turn_off`, a light's brightness
    with `light.turn_on`, covers with `cover.open_cover` and `close_cover` (the generic actions
    leave covers out). An action switches devices on, a light at a brightness, and off again at a time or
    after a while; or switches them off. At most 100 wait, each on 25 devices at most, a year
    ahead at most, a device left on a week at most.
  - **A restart loses nothing.** Once Home Assistant has started (every integration set up, so
    the devices are there), the steps missed are done in the order they were due. Switching off
    is always done, however late: it is the safe way. Switching on is done if it was missed by
    less than 15 minutes, or if the device should be on by now (its end to come). Anything else
    missed is dropped and logged. A device that cannot be switched off (unavailable, failing) is
    tried again every minute for an hour.
  - **Three ways in, one rule.** The piece's sheet (a section **Later**, with what waits and a
    short form), the actions `domotwin.schedule` and `domotwin.unschedule` (for automations and
    scripts; they answer what will happen, in Home Assistant's language), and three tools for the
    voice assistants driven by a language model (set, list, cancel), offered by the integration
    (`llm.py`) with nothing to install, on the devices exposed to the assistant only. Each checks
    the same way: devices that exist, that can be switched, times to come.
  - **The sheet's form asks for a time of day** ("06:30": the next one) and a duration, which the
    integration turns into dates in Home Assistant's time zone, not the browser's.
  - **Rights are Home Assistant's.** Only someone who may control the devices may set or cancel
    an action on them (a read-only user may not); each step is done in the name of who set it,
    with their rights, and shows in the logbook as theirs. Automations without a user act as
    Home Assistant. A device failing, however it fails, is logged and the action done with.
  - **A clock over the piece** says the time of its next step, in Home Assistant's time zone and
    12 or 24 hours; a tap on it opens the sheet. The list is followed live
    (`domotwin/schedules/subscribe`), on one subscription per connection however many views show
    it, even while DomoTwin is not set up (a screen kept open across a restart). Each user gets
    the actions on what they may see, never who set them.
- **Consequences.**
  - "Switch the lantern on at 6:30 for a quarter of an hour" works from the sheet, an automation or
    a voice assistant driven by a language model. Home Assistant's built-in agent, without one,
    cannot use tools: there, the sheet or an automation set them. The tools need a Home
    Assistant that hands integrations' tools to its assistants (tried with 2026.10); an older
    one, down to DomoTwin's 2025.1, leaves them out.
  - The actions are DomoTwin's: they show in its sheets and its diagnostics (counted, never which
    devices or when), not in Home Assistant's automations.

## D-047 · Taps that say what they do: a bubble, plain actions, a room's own buttons

M16.

- **Context.** On a phone, a tap on a lamp switched it with nothing to show what happened; a tap
  on a TV opened Home Assistant's dialog, far from the home drawn. Linking a TV offered "toggle",
  "more info" and "run an action" with a service to type: nothing said "volume up". A room did
  nothing with a tap but frame itself, and switching its lights off took its panel.
- **Decision.**
  - **A tap leaves a bubble** over the piece for 8 seconds (longer while it is touched or used
    from the keyboard): its name, its device as it is now and
    its main control (a lamp's switch and brightness, a fan's speed, a blind's buttons and
    position, a TV's power, play and volume, a robot vacuum's start, pause and base, a lock, a
    thermostat), and a way to the whole sheet. A long press still opens the sheet. Lights,
    switches, fans and covers still switch on a tap, the bubble saying so; a camera still shows
    its picture; anything else (a TV, a thermostat, a sensor) shows its bubble. A piece linked
    to nothing shows an administrator the devices of its room that fit it, each linked with one
    tap. A tip says once, per device, what a tap and a long press do.
  - **Plain actions first.** The link editor offers, for each linked device, what it does in
    words (switch on, dimmer, volume up, mute, open, stop, start cleaning, back to its base…),
    grouped by device in a native list a phone shows well. An action left as it was is saved as
    it was written, and one with fields the editor does not show stays as written. Each is
    stored as an ordinary Home Assistant action (`perform-action` with its target and data, or a toggle), so a file written
    by hand, a dashboard or an older DomoTwin reads it the same. An **advanced mode** adds the
    main device's toggle, any action with its data (JSON) and a page; an action the plain list
    cannot show opens the editor in it, and it cannot be left while one needs it.
  - **A room has buttons.** A framed room's chip shows what it does with a tap: its lights on and
    off, its blinds open and closed, its media off while one plays (icons), and the actions an
    administrator gave it (names). Its panel shows the same with words, and **Later** switches its
    lights or its blinds at a time (D-046).
    A room's devices are those of its area and those linked to its pieces (where the view places
    them, edits included): a lamp on a plug linked as a light is one of its lights. Its blinds
    leave out garage doors, gates and doors, which a tap on a room must not open, and covers that
    cannot open and close (a tilt-only one); its media off
    leaves out players that cannot switch off, which would fail the whole call. More lights than
    an action takes at once are set later in several actions. Lights switch through `light`, the others through
    `homeassistant`; nothing targets the area itself, so a device of the area kept out (hidden,
    configuration) is left alone.
  - **A room's own actions** are stored with its area (`rooms.<id>.actions`, at most 8, each a
    name of 40 characters at most and an action), checked by the integration like a piece's.
  - An action switches up to 25 devices at once (was 10), so that a room's lights fit in one.
- **Consequences.**
  - The default tap of a TV changes from Home Assistant's dialog to its bubble; a binding that
    says `more-info` keeps it.
  - The room panel's **All lights off** becomes **Lights off** among the room's buttons, and
    switches the room's lights by name rather than the whole area.
  - Nothing new is sent anywhere: the bubble and the buttons call the same services as before.

## D-048 · Pieces that look made, and a neon of its own

M15.

- **Context.** The plants were balls of green on sticks, and the sofas, beds and cushions were
  boxes with sharp edges: the home read as a sketch next to the light and the looks around it.
  The neon look (walls of tinted glass, every edge glowing in cyan, a square grid on a black
  ground) looked like other 3D home dashboards. The maintainer asked for better pieces with no
  loss of speed, and for a neon that is DomoTwin's own and still beautiful.
- **Decision.**
  - **Leaves are folded blades.** A leaf is a midrib and its two edges, in a few lengths, its
    outline given by a shape (a heart for the monstera and the pothos, a long strap for the
    dracaena), folded along its midrib and falling towards its tip. Both faces are drawn with
    their own normals, so a leaf reads from above and from below; where its outline comes to a
    point, the strip closes with one triangle a side. Each leaf is a little lighter or darker than
    the next. The monstera holds nine leaves out on stems that rise and bend; the pothos is a mound
    with vines trailing over the rim of its pot; the dracaena has three canes, each with a crown of
    eleven arching leaves. The pot has a rolled rim and soil. The piece's footprint is the plant's
    spread: its leaves stay within it, over a pot narrower than it, so that a plant beside a wall
    does not reach into it.
  - **Soft pieces have round edges.** Sofas (base, arms, back, cushions), beds (mattress, duvet,
    pillows), chair pads and seats, and the tops of tables, desks and consoles are boxes whose
    edges and corners are cut and shaded round: 48 vertices and 44 triangles a box, the light
    rolling over each edge by its normals and its fabric or grain running on over it, the radius
    at most a third of the box's thinnest side.
    Pillows are soft boxes instead of spheres.
  - **No more triangles.** Spheres take fewer segments when they are small, the pillows and
    plants that were made of them are drawn otherwise, and stems have no ends hidden in a joint: the demo apartment has 12 551 triangles,
    down from 13 843.
  - **Neon at dusk.** The home stands in a deep violet dusk, on a ground of dots rather than a
    grid. Its walls are solid, in violet; their tops are drawn as lit strips in the accent and the
    corners have no upright lines. The accent is amber by default (`#ffae45`). The furniture keeps
    more of its colours, tinted towards violet, and the leaves keep part of their green. The view's
    buttons and the panel take the same violet and amber. Glass walls stay blueprint's.
  - **Each look says** whether its plants keep part of their green (neon) and whether its 2D plan
    colours every floor alike (neon's violet, blueprint's blue).
  - **Each look has its own default accent**: amber in neon, cyan in the others. An accent chosen
    in the settings or a card's options is kept whatever the look; the settings' **Default** goes
    back to the look's own.
- **Consequences.**
  - Neon no longer shows through its walls: it cuts them away as day does, and a tap on a wall in
    front of a room no longer reaches the room behind it. Walking, its rooms have their ceilings;
    with every storey shown, its roof is solid. Blueprint keeps its glass.
  - A home whose accent was never chosen shows neon in amber; one whose accent was chosen keeps it.
  - The pictures of the docs are made again with the new pieces and the new neon.
  - Nothing else changes for the plans: the kinds and their styles are those of before.

## D-049 · Robot vacuums on the floor, and the home's energy at a glance

M16b, the first half of the demo house milestone: what the demo house shows, built for every home.

- **Context.** A robot vacuum was a vacuum entity with a bubble: nothing on the plan said it was
  cleaning, or where. The power layer said what each piece draws, but not where the home's power
  came from: the sun, the grid, a battery. The maintainer asked for a demo house with a robot
  vacuum and energy, shown in a way anyone understands.
- **Decision.**
  - **A robot-vacuum piece** (`robot-vacuum`, 40 × 50 × 12 cm) is its dock: a station against the
    wall and the ramp in front of it. Its robot is drawn moving, like the people: a low round
    body with a turret, the colour of its dock, on its own shadow.
  - **What it does comes from its vacuum** (linked as any entity, suggested first for a dock):
    `cleaning` sends it out, `returning` brings it home (it turns on its dock to face out),
    `docked` puts it on its dock, `paused`, `idle` and `error` stop it where it is. Where it is,
    Home Assistant does not say (most robots keep their map), so its way is drawn from the plan:
    the rooms its dock's room leads to through the doors, its own first then the nearest next,
    closets left out, each swept back and forth in lanes 30 cm apart from its corner nearest the
    robot, every point of them clear of the walls, from a lane to the next where both are; a
    room whose lanes part (shaped like a U, or round a wall jutting in) is swept part by part,
    back the way it came between them, its body clear of the corners. Around again while it
    cleans, the room it just cleaned last. It goes at a real robot's pace (30 cm/s) and turns on
    the spot. A dock left out of the scene (in a room drawn closed, D-039) has no robot; a robot
    in a room closed while it cleans is back on its dock and leaves that room out, and one sent
    home where no door leads is put on its dock, never through a wall. When another storey is
    shown, or the plan is built again, it carries on its way while no wall stands in it. Under
    *reduce motion* it rests: on its dock, or in the room it cleans, which it starts again when
    it moves. While the plan, its pieces or its links are edited, every robot rests on its dock
    and follows it when it is moved.
  - **It costs little.** A cleaning robot is drawn at the layers' pace (24 frames a second), not
    the display's; a home without a dock works nothing out, and the floors are worked out only
    for a robot away from its dock or leaving it; the robot's shape is drawn once and moved,
    like a person.
  - **The home's energy** is chosen in the settings (**Energy**): the sensors of the power from
    the sun, from the grid (positive when drawn from it) and from the home battery (positive
    when drawn from it), and the battery's charge, each sign turned when a sensor counts the
    other way. The likeliest sensors are offered first: those Home Assistant's own energy
    settings name, then those whose name says it (solar, inverter, grid, meter, battery…), each
    with what it says now. They are stored with the settings (`energy`), checked by the
    integration.
  - **Shown with the power layer**: in its legend, the sun, the grid and the battery around the
    home, a line where power flows, its dots going from where it comes to where it goes, faster
    the more there is; what each gives or takes, the battery's charge, what the home uses. What
    comes in feeds the home first, then the battery, then the grid. Said in words for screen
    readers; still under *reduce motion*. On a narrow view (under 480 px) it stands above the
    room chip, which keeps the whole width.
- **Consequences.**
  - A new kind in the plan format and its schema; plans without it read as before.
  - The settings may hold `energy`; an older integration refuses it, so the panel and the
    integration go together, as always.
  - Nothing is sent anywhere new: the robot and the energy are read from the states Home
    Assistant already sends.

## D-050 · The demo house

M16c, the second half of the demo house milestone: a home to try DomoTwin on before drawing one's
own.

- **Context.** Trying DomoTwin meant drawing or importing a plan, then linking entities, before
  anything moved. The maintainer asked for a realistic demo of a home with a lot of automation, a
  robot vacuum and its energy, understood at a glance.
- **Decision.**
  - **A demo house** of two storeys, fictional like every example
    (`examples/demo-house.domotwin.json`, `examples/demo-house-upper.domotwin.json`): on the
    ground floor a living room open to the kitchen with the robot vacuum's dock, an office, the
    hall with the stairs, a WC, a cloakroom and the laundry; upstairs the main bedroom, the
    bathroom, a children's room, the landing, a playroom and a guest room.
  - **Its own Home Assistant, in the page.** About seventy entities (lamps, curtains, TVs,
    thermostats, temperature, humidity and CO₂ sensors, motion, the front door's lock, the robot
    vacuum, the appliances and their power, solar panels, the grid meter, a battery), thirteen
    areas on two floors, three people, eight automations, upkeep cards and the energy settings,
    named in English or French as the visitor's Home Assistant is. Its connection answers
    DomoTwin's commands from memory as the integration would (plans, links, settings, upkeep,
    people, actions to do later), and the few of Home Assistant's the frontend asks (an
    automation's configuration, the energy settings, what an area relates to); what it has not
    (Bluetooth, ZHA, voice) it says so. The panel and the card run on it unchanged.
  - **A day of its own**, a spring day at a minute a second. The sun rises and sets (the light and
    the real sun follow it), the panels give with it, the battery charges from them and is drawn
    at night, the grid takes the rest. The family wakes up, has breakfast; two leave, one works in
    the office; they come back, cook, watch TV, go to bed. The washing machine, the dryer, the
    dishwasher (when the sun gives enough) and the oven run; the robot vacuum cleans while the
    house is quiet. Automations light the evening, follow people after dark, open the curtains in
    the morning, lock the door, put the house to bed, each running as it acts, so that its wire
    pulses. Temperatures, humidity and CO₂ follow who is where.
  - **What the visitor does stays**: a lamp switched off stays off until the day changes it again,
    a robot sent out comes home after a while, an action set for later runs on the demo's clock
    (checked as the integration checks it). The day held by the visitor stays held when they come
    back from another page; going on, it waits while they are away.
    Edits, links and settings change the demo's copy only, gone when it is left.
  - **Nothing reaches the home**: no service, no save, no subscription goes to the visitor's Home
    Assistant (only Home Assistant's own menu button keeps it, for the sidebar). Its `hass` says it
    is the demo's: nothing hands over to Home Assistant's own dialogs or pages, which would show
    the home's entities (*more info* opens DomoTwin's controls, an automation has no edit link).
    Its edit drafts are kept apart from the home's, and forgotten when it is left or shown again;
    leaving it ends what runs on it (edit mode, the plan editor, link mode) without saving, and
    waits for an import being read; answers the home or the demo had on their way are dropped, and
    what the client read of the home is read again on coming back. The panel and the card share
    one controller for all this. The demo is a chunk loaded when asked for.
  - **Its own clock**: its `hass` tells its time, which the sheets, the schedules, the
    automations' "ran … ago" and the upkeep read instead of the device's; it is a wall clock in
    the device's time zone.
  - **In the panel**, *Try the demo house* where there is no plan yet, and *Demo house* in the
    menu. A bar over the view says it is the demo and that nothing touches the home, shows its
    time, holds it or lets it go on, goes to the morning, midday, the evening or the night, and
    leaves it. **A card** with `demo: true` shows it (a dashboard showing DomoTwin), its bar
    without the way out.
  - The robot vacuum's dock, and its robot, are graphite by default: light ones were lost on light
    floors.
- **Consequences.**
  - The demo house is an example plan too, imported like any other.
  - The first load grows by the entry points only; the demo itself comes on demand.
  - Docks placed with the default colour before change colour.

## D-051 · Release 0.3.0, then DomoTwin as the only dashboard

After M16c.

- **Context.** Since 0.2.0, DomoTwin has learnt phones and crowded names (M13b), actions done
  later (M14), taps that say what they do (M16), pieces that look made and a neon of its own
  (M15), robot vacuums and the home's energy (M16b), and the demo house (M16c). The maintainer
  asked for a release once the demo house is in. A library of objects, the outdoors and the lawn,
  Replay, more imports, more languages and a first launch in five minutes were planned next; the
  maintainer then asked for DomoTwin to be the only dashboard a home uses, and chose to do that
  first.
- **Decision.**
  - **0.3.0 is everything up to M16c.** As 0.2.0 was (D-044), it is tried in a fresh Home
    Assistant (2026.10) from the build the zip is made of: the smoke test, then the panel in a
    browser, the demo house opened from its menu, its day going on, its evening, and the home
    again on leaving it, with no error in the console and no request outside Home Assistant.
  - **release-please's pull request makes the release**: the version in the manifest and the
    frontend, the notes from the commits, the `v0.3.0` tag and `domotwin.zip`.
  - **DomoTwin, the only dashboard, next.** The maintainer wants a home to need no other
    dashboard. The 3D view cannot do that alone: what has no place on a plan (scenes, scripts,
    the weather, calendars, lists, the alarm, inputs), a way to act without it on a phone, the
    screens of history, energy and safety, daily life, and opening straight on DomoTwin. Six
    milestones come first, in this order: an app with its tabs and a home screen (M23), rooms,
    devices and favourites for all of Home Assistant (M24), history, graphs and energy over time
    with Replay (M25, which takes M19 in), safety and cameras (M26), daily life and the wall
    screen (M27), and pages arranged without YAML, one's dashboards taken over (M28); then 0.4.0.
    Home Assistant's settings, integrations, automation editor and add-ons stay its own.
  - **Then** a library of objects (M17), the outdoors (M18), more imports (M20), more languages
    (M21), and a first launch in five minutes (M22) last, as it is made of what comes before it;
    then 0.5.0.
- **Consequences.**
  - The submission to HACS's default list still waits on the maintainer's steps
    (`HACS_SUBMISSION.md`); 0.3.0 changes nothing it checks.
  - The roadmap lists M23 to M28 and 0.4.0, then M17, M18, M20 to M22 and 0.5.0, as planned;
    M19 is part of M25.

## D-053 · Measure performance: a button for any device

M16d, after 0.3.0: the measurements on real devices that HACS's default list waits for
(`HACS_SUBMISSION.md`).

- **Context.** `benchmark()` measured the view only from the tests, and a device only with the
  developer tools, which a phone does not have and an iPhone needs a Mac for. A wall tablet in
  the companion app had no way at all.
- **Decision.**
  - **Measure performance**, in the panel's ⋮ menu, for administrators. It opens the demo house
    (or keeps it), in the evening with its lamps on and its day held, so that every device draws
    the same home: its ground floor, in 3D, framed whole, not walking; waits until it is drawn in the
    look; draws a few frames that are not counted
    (the look's shaders are built then); then measures for five seconds while the camera turns
    half around the home, and five seconds still while a lamp dims ten times a second. It
    measures the look shown, or, as an option off by default, each of the five looks (about a
    minute). A line says what runs and asks not to touch the screen; the panel's tools and the
    demo's time and way out wait meanwhile, and a measure starts only when nothing else runs. The
    demo house is put back exactly as it was (a copy of its states: its moment, its clock, its
    lamps, what the visitor changed), with the storey and the 2D view shown before, and the home's
    look comes back. A measure left (the panel closed, a phone locked) says
    so when the panel shows again. Under reduced motion, the intro says the camera will still
    turn.
  - **`benchmark()`** runs for a time as well as for a number of frames, turning the camera or
    calling back before each frame; the view's own frames are held meanwhile (its scheduler), so
    that only the measured frames are drawn. A timed run draws a frame as in use: its labels and badges read
    (counted in its CPU time) and its resolution adapted; a run during which the page was hidden
    is not counted, and the measure asks to start again.
  - **What it measures**, for each look: the frames a second (a second over the median interval
    between frames) and the p95 interval, the CPU time of a frame (median, p95), the WebAssembly
    memory, the quality `auto` chose and the resolution scale, the scene's triangles. And once:
    the first picture, from opening the panel to the first frame of the home's own plan (not
    the demo's; none when the home had no plan as the panel opened, or the page was hidden before
    it was drawn); the device's user agent, screen and pixel
    ratio, logical processors, memory where the browser says it (`deviceMemory`), the GPU where
    WebGL names it (`WEBGL_debug_renderer_info`, else what WebGL says), browser or Home
    Assistant's companion app (its bridge to the page, or its user agent), DomoTwin's version.
  - **The result** in a sheet, readable, and as rows of the table of real devices in
    `PERFORMANCE.md` (one a look), with **Copy**; where the clipboard is refused (some companion
    apps), the text is selected to copy by hand.
  - **Nothing is sent or kept** (D-022): no request, no storage; the rows are the user's to paste.
    The measure is a chunk loaded when the menu item is used; nothing of it runs otherwise.
- **Consequences.**
  - The menu is the administrator's of a home with a plan; without one, it shows once the demo
    house is open.
  - `PERFORMANCE.md` has a table of real devices and how to fill it; the maintainer fills it from
    a computer, a phone and a tablet, then ticks the box of `HACS_SUBMISSION.md`.
  - The first load grows by the menu item, the view's run and first picture, and the texts
    (+3.5 kB gzipped).
