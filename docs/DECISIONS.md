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
- **Python: 3.12.** Home Assistant 2025.1 runs on Python 3.12 and 3.13 (2025.2 dropped 3.12, 2026.3
  is the first on 3.14), so the integration must parse and run on 3.12, whatever the tests run on
  (D-011). Ruff targeted `py314` at first: its formatter wrote `except A, B:` (3.14 only) in
  `schedules.py`, and in 0.3.0 and 0.4.0 the whole integration failed to load before Home
  Assistant 2026.3. Ruff and mypy now target 3.12 (both reject newer syntax, mypy also the newer
  standard library), and CI byte-compiles `custom_components/domotwin` with Python 3.12 before the
  other checks. Raising the floor means raising `hacs.json`, these targets and that step together.

## D-011 · Versions

- **Decision.** The product version lives in `custom_components/domotwin/manifest.json`, `const.py`
  and `frontend/package.json`, all bumped by release-please. The Rust crates are internal
  (`publish = false`) and keep version `0.0.0`, so `Cargo.lock` never changes on a release.
- **Toolchains.** Rust 1.97.0 (`rust-toolchain.toml`), Node 22 (`.nvmrc`), Python 3.14 (required by
  the current Home Assistant) for the tests; the integration's code stays on 3.12 (D-010). TypeScript stays on 6.0 because `typescript-eslint` does not support
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

## D-054 · The practical home, made of Home Assistant's cards (amends D-051)

After M16d, before M23: how DomoTwin becomes the one place for the home.

- **Context.** D-051 planned six milestones (M23 to M28) for DomoTwin to be the only dashboard a
  home needs, DomoTwin drawing everything itself: its own controls for each kind of device, its
  own charts, cameras, agenda and lists. Using it at home, the maintainer found the 3D view
  beautiful but not practical every day: to switch on a lamp or check the heating, a list or a
  tile is faster than turning a model. And one person keeps DomoTwin up: what Home Assistant
  already draws well, redrawn by DomoTwin, would be theirs to keep up for good.
- **Decision.**
  - **The goal stays**: one place for the home. **The way changes**: a practical side next to the
    3D view, made of what Home Assistant already has, as DomoTwin does already
    (`window.loadCardHelpers()` and `createCardElement` in the card editor, `hass-more-info` in
    the sheets).
  - **Reuse Home Assistant, do not rebuild it.** An entity's controls are its tile card and its
    more-info dialog, not DomoTwin's own climate, cover, media, lock or alarm controls, which stay
    on the 3D view only. History and graphs are the history-graph and statistics-graph cards and
    links to Home Assistant's History, Logbook and Energy pages: no chart drawn by DomoTwin.
    Cameras, the alarm, the weather, calendars and lists are the picture-glance and camera,
    alarm-panel, weather-forecast, calendar and todo-list cards.
  - **Checked, not remembered.** A card type, a helper or an event is relied on only once found
    in Home Assistant's frontend for the oldest version DomoTwin supports (2025.1, `hacs.json`).
    Checked for this plan in that frontend (20250103.0): the tile, history-graph,
    statistics-graph, picture-glance, picture-entity, alarm-panel, weather-forecast, calendar,
    todo-list and energy cards, `loadCardHelpers` and `hass-more-info` are there.
    `loadCardHelpers` is set by the dashboards' own module only, so DomoTwin opened before any
    dashboard loads that module first, and shows plain rows if it cannot. The page Home
    Assistant opens first is a choice of each device there (its `hass-default-panel` event); a
    choice of each user, or of everyone, came later: DomoTwin uses what the Home Assistant it
    runs in has.
  - **Smaller milestones, a new order.**
    1. **M23, the practical home**, the one that matters: tabs (at the bottom of a phone, on the
       side of a tablet or a computer) *Home*, *Rooms* and *3D*. *Home* at a glance: who is in,
       the lamps on, the doors and windows open, the alerts, the weather, the favourite scenes as
       big buttons, and the cards chosen in the settings (an agenda, a list). *Rooms*: Home
       Assistant's floors and areas, each room a list of tile cards, with a search. The 3D view
       becomes a tab; a room tapped in it opens its room's tab, and back. Favourites, chosen with
       a star, kept by the integration for each user. The tab DomoTwin opens on is a setting of
       each user, which a device can change for itself; a device that cannot draw 3D opens on the
       others. DomoTwin can be the page Home Assistant opens first, with Home Assistant's own
       setting.
    2. **Release 0.4.0** after M23, then **two weeks of use** at home before the rest: what is
       missed decides the order of what follows.
    3. **M24, history and energy**: a sheet for each room with its sensors' history-graph cards;
       an Energy tab made of Home Assistant's energy cards. Replay (M19) stays a 3D feature, later.
    4. **M25, safety**: the cameras side by side, the doorbell full screen when it rings, the
       alarm, the full-screen alerts already in the 3D view shown on every tab.
    5. **M26, the wall screen**: a screen saver (the clock, the weather, the photos of Home
       Assistant's media) woken by motion; a layout for each device.
    6. **Deferred** until someone asks: one's dashboards taken over and pages arranged without
       YAML (the former M28). The agenda and lists of the former M27 are cards of the Home tab,
       chosen in the settings, not a milestone.
  - **The rules stay**: each milestone its own pull request, every string through `t()` in
    English and French, no network call outside Home Assistant, the first load and its budget as
    they are (each tab a chunk loaded the first time it opens), tests in vitest and Playwright.
- **Consequences.**
  - The roadmap lists M23 to M26 and 0.4.0 as above; M17, M18, M20 to M22 and 0.5.0 follow as
    before. The former M24 to M28 of D-051 are replaced, not kept as well.
  - What was begun for the former M23 on DomoTwin's own (its rooms page drawn by DomoTwin) is set
    aside; what fits the new M23 (the glance, the tabs, the address of a page, Home Assistant's
    choice of the first page) is kept for it.
  - The plan is written first, in its own pull request, before M23 starts.

## D-055 · The practical home: Home, Rooms and 3D (M23)

M23, the first milestone of D-054.

- **Context.** D-054 gave DomoTwin a practical side next to the 3D view, made of Home Assistant's
  own cards. M23 is that side: tabs, the home at a glance, the rooms of Home Assistant, each
  user's favourites, the tab DomoTwin opens on.
- **Decision.**
  - **Tabs**: *Home*, *Rooms*, *3D*; a rail on the side of a tablet or a computer, a bar at the
    bottom of a phone (a panel narrower than 560 px). They give way while a tool works on the 3D
    view (edit mode, the plan editor, link mode). The tab is in Home Assistant's address
    (`/domotwin/home`, `/domotwin/rooms/<area>`, `/domotwin/3d`), so that back, a bookmark and a
    link work; the panel's own address opens on the tab chosen and says which, keeping what the
    address says beyond the page.
  - **The 3D view is a tab**: drawn once shown (its engine not loaded before), then kept, hidden
    and not drawn, on the other tabs (its camera, its storey). A room tapped in it opens its room
    in *Rooms* when the room has an area of Home Assistant, its own actions (D-047) above its
    devices, with a way back to the 3D view; the room's own panel stays a long press.
    `domotwin.show` and the measure (D-053) show the 3D tab.
  - **Home**: who is in, the lamps on (and all of them off at once), the doors and windows open,
    the alerts, each opening its tiles or its words (D-023's alerts); the weather
    (`weather-forecast`, `weather.home` first); the favourite scenes and scripts as big buttons
    (the `button` card: a tap runs it, a hold its more-info); the other favourites as tiles; the
    user's cards (an agenda, `calendar`; a list, `todo-list`).
  - **Rooms**: Home Assistant's floors, by level, and their areas, by name; areas on no floor
    last. A room's page shows its entities as tile cards, what one acts on first; updates,
    events, hidden, configuration and diagnostic entities are left out. A search finds every word
    in a name, an entity id or an area's name, accents and case aside (60 at most).
  - **Home Assistant's cards** come from its card helpers, which its dashboards' own module sets
    (`window.loadCardHelpers`, in 2025.1 and since): opened before any dashboard, DomoTwin loads
    that module as Home Assistant's panel resolver does. Where it cannot, and in the demo house
    (whose entities Home Assistant's dialogs do not know, D-050), DomoTwin's own rows stand in.
  - **Each user's own choices**, kept by the integration in a store of their own
    (`.storage/domotwin.users`), by user id: the favourites (100 at most, each starred or not on
    its own, so that two devices do not overwrite each other), the tab DomoTwin opens on, the Home
    tab's cards (6 at most; an agenda of 10 calendars at most). Any signed-in user, their own
    only; a user removed from Home Assistant is forgotten when DomoTwin starts; all removed with
    the integration. A device may open on a tab of its own (kept by its browser); one that cannot
    draw 3D does not open on it. Home opens when nothing was chosen.
  - **Opened first**: *Open DomoTwin when Home Assistant opens*, in the choices, sets Home
    Assistant's own setting: 2025.1 keeps it for each device (its `hass-default-panel` event),
    later versions for each user (`frontend/set_user_data`, `core`'s `default_panel`, known by
    `systemData` being there). Not in the demo house.
  - **Private rooms (D-039)**: the area of a private room the viewer may not see shows its name
    and that it is private. Its entities, and those linked to the room and to what it holds on
    any storey, whatever their area, are left out of the glance, the rooms, the search and the
    favourites.
- **Consequences.**
  - What the tabs show is a chunk loaded the first time one shows (`chunks/practical-<hash>.js`),
    with its texts in both languages, added to the translator as it loads. The first load grows
    by the tabs, the address, the favourites' client and their few texts (+5.6 kB gzipped).
    Opened on *Home*, the engine is not loaded until the 3D tab is.
  - The panel opens on *Home* unless the user or the device chose otherwise: a wall screen that
    showed the 3D view chooses it, on that device.
  - In the panel, a tap on a room no longer frames it with its chip (the card's still does): the
    room's own actions are on its page in *Rooms*.
  - What was begun for the former M23 with DomoTwin's own rooms page is not kept; its glance is.

## D-056 · Into Home Assistant's Overview, and ten ideas after 0.4.0 (amends D-054, D-055)

After M23, before 0.4.0: a plan only, nothing built now; 0.4.0 and its two weeks of use stay as
D-054 planned them.

- **Context.** Home Assistant now opens on an Overview of its own, which shows much of what the
  Home and Rooms tabs of M23 show. The maintainer asked for M23 to plug into it rather than copy
  it, if it has what it was said to have, and for ten new milestones, each with what exists
  already, what would be new, and whether a custom integration can do it or it needs Home
  Assistant itself. Checked in Home Assistant's frontend at the versions its releases pin
  (2026.1.0: 20260107.0; 2026.2.0: 20260128.6; 2026.10.0: 20260930.2), its core on `dev`, its
  release notes, the HACS default lists, GitHub and the community forum, in October 2026.
- **The Overview, checked.**
  - **The page Home Assistant opens on** since 2026.2, for new installs: "The Home Dashboard is
    now Overview as it becomes the official default standard"
    ([2026.2](https://www.home-assistant.io/blog/2026/02/04/release-20262/#a-new-way-to-view-your-home);
    `DEFAULT_PANEL = "home"` in
    [`src/data/panel.ts`](https://github.com/home-assistant/frontend/blob/20260128.6/src/data/panel.ts#L16-L19),
    `"lovelace"` in
    [2026.1](https://github.com/home-assistant/frontend/blob/20260107.0/src/data/panel.ts#L16)). An
    install whose old Overview was edited keeps it as its first page
    ([core's migration](https://github.com/home-assistant/core/blob/2026.2.0/homeassistant/components/lovelace/__init__.py#L389-L469)).
  - **Summaries**: the lights, the climate, security, media players, the weather and energy, each
    shown when the home has them: "summary cards (like lights, climate, security, media players,
    weather, and energy)" ([2026.1](https://www.home-assistant.io/blog/2026/01/07/release-20261/);
    [`home-overview-view-strategy.ts`](https://github.com/home-assistant/frontend/blob/20260107.0/src/panels/lovelace/strategies/home/home-overview-view-strategy.ts#L199-L367)).
    Maintenance and shortcuts came in 2026.5
    ([`home_shortcuts.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/data/home_shortcuts.ts)).
  - **Favourites**: chosen by an administrator in *Edit Overview*, the same for every user (the
    frontend's system data, `home.favorite_entities`, written by an administrator only), shown as
    tile cards with suggestions
    ([`dialog-edit-home.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/home/dialogs/dialog-edit-home.ts#L104-L172),
    [`frontend.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/data/frontend.ts#L34-L52)).
  - **A page for each area**, at `/home/areas-<area_id>`, by floor
    ([`home-dashboard-strategy.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/lovelace/strategies/home/home-dashboard-strategy.ts#L63-L120),
    [`home-area-view-strategy.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/lovelace/strategies/home/home-area-view-strategy.ts)).
  - **Active alerts** since 2026.10: "The Home dashboard now shows active alerts too"
    ([2026.10](https://www.home-assistant.io/blog/2026/10/07/release-202610/#other-noteworthy-changes)):
    the entities an administrator chose on the Security page (2026.9) with the *alert* severity,
    shown while one is active
    ([`security-alerts.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/security/strategies/security-alerts.ts#L14-L105),
    [the summary](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/lovelace/strategies/home/home-overview-view-strategy.ts#L348-L357)).
  - **No place for a card that is not its own.** The Overview cannot be edited (`no-edit`; edit
    and save do nothing,
    [`ha-panel-home.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/home/ha-panel-home.ts#L336-L431));
    its options are a fixed list (favourites, alerts, shortcuts, the welcome message, the
    suggestions,
    [`home-dashboard-strategy.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/lovelace/strategies/home/home-dashboard-strategy.ts#L21-L29));
    its summaries are a fixed list, and one it does not know is dropped. Nothing found on an area
    page links out to another page. So DomoTwin's 3D view cannot be put at the top of the Overview or of an area page,
    and an area page cannot open DomoTwin on its room, from a custom integration.
  - **What can be done.** A shortcut of the Overview (2026.5 and later) opens any path, DomoTwin's
    panel too
    ([`dialog-edit-shortcut.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/home/dialogs/dialog-edit-shortcut.ts#L58-L76)).
    An entity put in an area can show on that area's page, and any entity can be a favourite. A
    custom dashboard strategy is documented
    ([strategies](https://contributors.home-assistant.io/frontend/custom-ui/strategy/)) but makes
    a dashboard of its own, not the Overview: one with the 3D view on top would be a copy of it,
    and the Overview's own parts are not an API to build on.
- **Decision: M23 amended, as M23b.** M23 was merged before this request; its amendment is a
  milestone of its own, after 0.4.0 (nothing is built now), after the sandbox and the Wi-Fi QR code,
  and before M24 and M25, which follow the same rule.
  - Home Assistant's cards and dialogs are reused, not rebuilt (D-054), and now its pages too:
    where Home Assistant has the Overview, a room tapped in 3D opens that room's area page, and
    the room's own actions (D-047) stay in its 3D panel. Where it has none, or the room has no
    area page, its page in *Rooms*. The versions whose Overview has area pages at that address are
    checked in Home Assistant's frontend when M23b is built (its *Home* dashboard came before 2026.1,
    hidden, [2025.12](https://www.home-assistant.io/blog/2025/12/03/release-202512/#experimental-dashboards-have-graduated)).
  - What DomoTwin knows and the Overview does not show becomes entities, in the area of their
    room where they have one, so that Home Assistant's own cards can show them on the area pages
    (which ones it shows is checked when M23b is built) and an administrator can make them
    favourites of the Overview: who is in which room (M9e already
    has a sensor for each person), the weak spots of the network (M9b), the upkeep due (M9d,
    already a sensor), where the robots are (M16b).
  - DomoTwin summary cards, in the Overview's manner, for what an entity does not say well:
    people in their rooms, the network, the wires, the upkeep, the robots; for one's own
    dashboards and the Home tab, each opening the 3D view on what it sums up.
  - The docs show how to put DomoTwin among the Overview's shortcuts. DomoTwin does not write
    Home Assistant's system data itself: its format is Home Assistant's own, shared by every user.
  - Each card type, helper and path used is checked in Home Assistant's frontend for each version
    it is used on, as D-054 asks.
- **Decision: ten ideas, eleven new milestones** (the Wi-Fi QR code apart from guest access),
  after 0.4.0, numbered from M29 (M27 and M28 stay the former ones of D-051, deferred). "HACS
  default" means in HACS's default lists today.
  1. **M29, the sandbox.**
     - *Exists*: [Event Simulator](https://github.com/eseverson/hass-event-simulator) (HACS
       default, MIT) replays recorded history against one automation, in a separate process
       running Home Assistant's own code, every action recorded, none made; one automation at a
       time, actions with no effect on the states. Home Assistant's own testing runs actions "for
       real" ([docs](https://www.home-assistant.io/docs/automation/testing/)). Developers have
       [pytest-homeassistant-custom-component](https://github.com/MatthewFlamm/pytest-homeassistant-custom-component)
       and the [Appdaemon Test Framework](https://github.com/HelloThisIsFlo/Appdaemon-Test-Framework);
       virtual devices in the real home exist ([hass-virtual](https://github.com/twrecked/hass-virtual)).
       Asked for on the forum
       ([testing framework](https://community.home-assistant.io/t/automations-testing-framework/688889)).
       Automations that have not fired are listed by
       [HA Automation Analyzer](https://github.com/MacSiem/ha-automation-analyzer) (HACS default),
       with no simulation; nothing found finds two automations working against each other.
     - *New*: the whole home at once, every automation, script and scene, their actions changing
       the copy, so that one setting off another, and two fighting, show; a day made up (its
       weather, who leaves when) rather than recorded; the day on the 3D view and a timeline; the
       report.
     - *Feasible*: as a custom integration, in the page, on the demo house's Home Assistant in
       memory, as asked. Home Assistant's templates are Jinja with hundreds of its own functions
       and can only be read in part in the page; Home Assistant renders them against the real
       home only. The sandbox plays what it reads and names the rest. Reading automations,
       scripts and scenes is for administrators. A player on the server running Home Assistant's
       own code, as Event Simulator does, would play every template but depends on Home
       Assistant's insides and costs a small host's memory ❓.
  2. **M30, the Wi-Fi QR code** (the first part of item 5, early because it is small).
     - *Exists*: routers that give their guest network's QR code as an entity
       ([FRITZ!Box](https://www.home-assistant.io/integrations/fritz/),
       [UniFi](https://www.home-assistant.io/integrations/unifi/));
       [QR-Code Generator](https://github.com/DeerMaximum/QR-Code-Generator) (HACS default) draws a
       QR code from a template; the format is ZXing's `WIFI:` code
       ([its definition](https://github.com/zxing/zxing/wiki/Barcode-Contents)), now in the Wi-Fi
       Alliance's WPA3 specification. Encoders: Nayuki's
       [QR Code generator](https://github.com/nayuki/QR-Code-generator) (MIT, in Rust as
       `qrcodegen` and in TypeScript) and others under MIT.
     - *New*: the code drawn in the page with no service, the password kept private, shown on a
       chosen screen.
     - *Feasible*: as a custom integration. The password in the integration's private storage,
       left out of the diagnostics, the exports and the logs; the encoder a crate `cargo deny`
       checks.
  3. **M31, the placement advisor.**
     - *Exists*: locating, with no advice on placement:
       [Bermuda](https://github.com/agittins/bermuda), [BPS](https://github.com/Hogster/BPS)
       (HACS default) and [ESPresense](https://github.com/ESPresense/ESPresense-companion), whose
       docs give rules of thumb for nodes. [Spatial Context](https://github.com/Greminn/ha-spatial-context)
       (HACS default) draws the Zigbee, Wi-Fi, Thread and Bluetooth links measured on a plan with
       walls. Home Assistant draws the Bluetooth (2025.6), Zigbee and Matter (2026.9) networks.
       Wi-Fi surveys are walked with a laptop
       ([wifi-heatmapper](https://github.com/hnykda/wifi-heatmapper)) or bought (Ekahau, NetSpot).
       Asked for on the forum
       ([RF heat maps](https://community.home-assistant.io/t/wifi-and-other-rf-heat-maps/161759)).
       Nothing found predicts coverage from a plan or says where the next radio should go.
     - *New*: coverage predicted from the plan and checked against what was measured; the next
       proxy, router or access point, ranked by what it changes.
     - *Feasible*: as a custom integration; the Bluetooth receivers and the Zigbee mesh are read
       by administrators only; Wi-Fi is known only through the devices that report their signal
       (ESPHome's `wifi_signal`, routers' integrations).
  4. **M32, "Why?".**
     - *Exists*: Home Assistant does most of it since 2026.9: a row of its Activity opens "the
       full story": what started it (a person, a state change, a schedule, an integration, a
       restart), the automations or scripts it passed through, then the change, each step opening
       its entity or its trace
       ([2026.9, "From what changed to why it changed"](https://www.home-assistant.io/blog/2026/09/02/release-20269/));
       since 2026.7 each row shows its cause
       ([2026.7](https://www.home-assistant.io/blog/2026/07/01/release-20267/)). Some triggers make
       no parent context ([data model](https://contributors.home-assistant.io/data/reference/data-model/)).
       Around it: [HA Trace Viewer](https://github.com/MacSiem/ha-trace-viewer) (HACS default).
     - *New*: the chain drawn in the home, room to room, with the wires of M9c; the same on Home
       Assistant before 2026.9, read from the logbook's context; "why did it not" from the sandbox.
     - *Feasible*: in the frontend; the logbook gives the chain to any user, the traces to
       administrators only. Smaller than asked, since Home Assistant has the list.
  5. **M33, guest access.**
     - *Exists*: [Guest Mode](https://github.com/Darkdragon14/ha-guest-mode) (HACS default; a fork
       of [Virtual Keys](https://github.com/kcsoft/virtual-keys)) makes temporary sign-in links,
       with a QR code; Home Assistant users can be local only and read only, which Home Assistant
       enforces, but no user can be limited to some devices through Home Assistant's settings
       ([permissions](https://contributors.home-assistant.io/core/internals/permissions/)).
     - *New*: one flow for a guest: the Wi-Fi, a link, the rooms they may use, on the plan, ending
       on its own.
     - *Feasible*: the link and its expiry as a custom integration. Limiting a guest to chosen
       devices is enforced only by a page of DomoTwin's own that acts for the guest, served
       outside Home Assistant's sign-in, which needs a security review; a guest given a Home
       Assistant user sees every entity ❓.
  6. **M34, per-person rights.**
     - *Exists*: in Home Assistant, an administrator or a user, and dashboards and cards hidden
       for some, which is not enforcement. Roles are its most asked-for feature
       ([discussion #22](https://github.com/orgs/home-assistant/discussions/22), 443 votes); a
       proof of concept was declined in April 2026: "today we are not in a position to accept
       changes to authentication and authorization"
       ([architecture #1374](https://github.com/home-assistant/architecture/discussions/1374)).
       [Access Control Manager](https://github.com/Darkdragon14/ha-access-control-manager) (HACS
       default) edits Home Assistant's groups' policies;
       [user-rbac](https://github.com/SamAthanas/user-rbac) (HACS default) patches Home Assistant;
       [ha-rbac](https://github.com/FezVrasta/ha-rbac) is a proxy in front of it;
       [kiosk-mode](https://github.com/NemesisRE/kiosk-mode) and
       [browser_mod](https://github.com/thomasloven/hass-browser_mod) only hide.
     - *New*: rights set on the plan, room by room, from private rooms (M9g), and one place that
       says what each person sees and does in DomoTwin.
     - *Feasible*: what DomoTwin shows and its own services, as a custom integration, said to be
       that and no more. Enforcement needs Home Assistant; patching it or rewriting its groups is
       not proposed ❓.
  7. **M35, automations in plain words, tested first.**
     - *Exists*: Home Assistant's AI task (2025.8) gives structured answers from the agent the
       user chose ([AI Task](https://www.home-assistant.io/integrations/ai_task/)); "Suggest with
       AI" names an automation but does not write one
       ([2025.8](https://www.home-assistant.io/blog/2025/08/06/release-20258/)).
       [AI Automation Suggester](https://github.com/ITSpecialist111/ai_automation_suggester) and
       [Home Generative Agent](https://github.com/goruck/home-generative-agent) (HACS default)
       write automations with a provider of their own, with no replay.
     - *New*: the user's own agent, through Home Assistant; the draft played in the sandbox before
       it is saved; shown on the plan.
     - *Feasible*: as a custom integration, on Home Assistant 2025.8 and later, for administrators;
       the AI task rather than a conversation agent, which might act instead of drafting. Depends
       on M29.
  8. **M36, configuration history.**
     - *Exists*: [Home Assistant Version Control](https://github.com/saihgupr/HomeAssistantVersionControl)
       (an add-on, Git, files) and
       [Home Assistant Time Machine](https://github.com/saihgupr/HomeAssistantTimeMachine) (one
       automation or dashboard back from a backup); [HA GitOps](https://github.com/ckrl/ha-gitops)
       (HACS default). Home Assistant's backups put back whole parts, and its editor's undo lasts
       one session ([2025.10](https://www.home-assistant.io/blog/2025/10/01/release-202510/)).
     - *New*: one item at a time, inside Home Assistant, with no add-on and no Git; its changes in
       words; one item put back.
     - *Feasible*: as a custom integration, through the commands Home Assistant's editors use;
       what is written in one's own YAML files is shown, not put back.
  9. **M37, a weekly home report.**
     - *Exists*: [Battery Notes](https://github.com/andrew-codechimp/HA-Battery-Notes),
       [Watchman](https://github.com/dummylabs/thewatchman), [Spook](https://github.com/frenck/spook),
       [Unavailable Devices Report](https://github.com/VilniusTechnology/ha-unavailable-devices-report),
       [Maintenance Supporter](https://github.com/iluebbe/maintenance_supporter) (HACS default);
       Home Assistant's Maintenance page (2026.5). No weekly summary of all of them found.
     - *New*: one report a week, room by room on the plan, what changed since the last, with
       DomoTwin's own findings (upkeep, radios, automations that never fired).
     - *Feasible*: as a custom integration, reading those integrations' entities when they are
       installed rather than redoing their work.
  10. **M38, history as reports.**
      - *Exists*: Home Assistant's History downloads CSV since 2024.2
        ([2024.2](https://www.home-assistant.io/blog/2024/02/07/release-20242/)), its Activity
        since 2026.8 ([2026.8](https://www.home-assistant.io/blog/2026/08/05/release-20268/)); no
        table, no search by value. [History Table Card](https://github.com/LiBe-net/history_table_card),
        [flex-table-card](https://github.com/custom-cards/flex-table-card) and
        [logbook-card](https://github.com/royto/logbook-card); history-explorer-card is no longer
        kept up.
      - *New*: tables filtered by value and duration, the logbook searched by value, opened from a
        device on the plan.
      - *Feasible*: in the frontend, read only, from the recorder's own commands; raw history is
        kept ten days by default, hourly statistics after.
  11. **M39, Hydro-Québec's peaks** (optional).
      - *Exists*: [hydroqc-ha](https://github.com/hydroqc/hydroqc-ha) (HACS default, AGPL-3.0)
        gives the peaks and pre-heating of Flex D and the winter credit as entities, a calendar and
        blueprints; [HydroPeak](https://github.com/Beat-YT/hydropeak-ha) (HACS default) reads
        Hydro-Québec's open data with no account. The winter credit is closed to new contracts
        since March 2026
        ([Hydro-Québec](https://www.hydroquebec.com/residential/customer-space/rates/winter-credit-option.html));
        Flex D is open
        ([Hydro-Québec](https://www.hydroquebec.com/residential/customer-space/rates/rate-flex-d.html)).
      - *New*: the peak on the plan (which rooms pre-heat, which shed), tomorrow's peak played in
        the sandbox, the week's peaks in the report.
      - *Feasible*: as a custom integration, reading their entities only; no code of hydroqc's
        copied (AGPL).
- **Decision: the order.**
  1. **0.4.0** and its two weeks of use, as planned.
  2. **M29, the sandbox**, first: the maintainer's first wish, built during the two weeks since it
     does not wait on what they show.
  3. **M30, the Wi-Fi QR code**: small, and asked for early if cheap.
  4. **M23b**, before M24 and M25, which follow its rule (Home Assistant's Energy and Security
     pages opened rather than copied where it has them).
  5. **M24 to M26**, in the order the two weeks decide, as D-054 planned.
  6. **M31, the placement advisor**: the maintainer's second wish.
  7. **M22, a first launch in five minutes**: eighth after 0.4.0, where it was (after M24 to M26,
     M17, M18, M20 and M21): the new milestones before it take the place of M17, M18, M20 and
     M21, which come after, so that it does not slip further. It uses the imports and pieces
     there are; robot maps and more pieces join it later.
  8. **0.5.0**, right after M22, so that a first launch in five minutes reaches people first.
  9. Then, to **0.6.0**: M32 and M33 (the maintainer's order, after M29 and M31); M34 next to M33,
     both about who may see what; M35, once the sandbox is there; M20 and M17, which make the
     first launch richer; M36, M37 and M38; M18; M39, optional and for one region; M21 last, once
     the texts of the rest are written, so that they are translated once.
- **Questions for the maintainer (❓).** Each is asked before its milestone starts, which goes on
  with what needs no answer.
  1. The 3D view at the top of the Overview and of its area pages, and an area page opening
     DomoTwin on its room, need Home Assistant's frontend to give them a place. Asking Home
     Assistant for it is the maintainer's call. A script DomoTwin would load on every page of
     Home Assistant to add them is not proposed: it would break with Home Assistant's releases.
  2. The Home and Rooms tabs where the Overview is. They keep what it does not have: each user's
     own favourites (the Overview's are everyone's, set by an administrator), private rooms
     (D-039), the rooms' own actions (D-047), the demo house. They also show again what it shows.
     Proposed: kept where Home Assistant does not open on its Overview (before 2026.2, or an
     install that kept its old one); where it does, DomoTwin opens on 3D and the Rooms tab hands
     its rooms to the area pages. Keep them, slim them down, or remove them.
  3. The sandbox in the page only, or also a player on the server for the templates it cannot
     read.
  4. Guest access: a page of DomoTwin's own outside Home Assistant's sign-in, enforced by
     DomoTwin, or Home Assistant users only, which see every entity.
  5. Per-person rights: what DomoTwin shows and does only, or a way to enforce them that touches
     Home Assistant.
- **Consequences.**
  - The roadmap lists M29 to M39 and M23b with ⏳ in that order, 0.5.0 after M22, and a sixth
    release, 0.6.0, after the rest.
  - The rules hold for each: its own pull request, no network call outside Home Assistant,
    fictional data in tests and docs, every string through `t()` in English and French, Home
    Assistant's cards, dialogs and now pages reused rather than rebuilt.
  - Many of them read what only administrators may (automations, traces, the radios): each says
    what other users see.

## D-057 · The sandbox: the home's day played on a copy of it (M29)

M29, the first milestone after 0.4.0 (D-056).

- **Context.** The maintainer wanted to see what the home's automations do over a whole day before
  living it: a day picked, its weather, who goes out and comes back when; the 3D view and a
  timeline as it plays; a report of what ran, what never did, what worked against what. Nothing
  may reach a device. Home Assistant has no dry run ("the actions of the automation run for
  real"); Event Simulator (HACS) replays recorded history against one automation at a time in a
  separate process, its actions changing nothing (D-056).
- **Decision.**
  - **In the page, on a copy.** As D-056 planned, on the demo house's way of keeping a home in
    the page (D-050): the home's states, registries, DomoTwin's plan, links and settings are read
    once, with the configurations of the automations, scripts and scenes and the entity registry
    (for administrators: Home Assistant gives them to them only). The copy has its own `hass` and
    its own connection, which answers DomoTwin's commands from memory; the panel runs on it
    unchanged. Nothing is written to Home Assistant, no service is called: the tests check it.
  - **The day is played at once.** An engine of its own (`src/sandbox/engine.ts`) plays the day
    from midnight to midnight as a queue of moments, in Home Assistant's time zone: a trigger sets
    its automation off after the change that fired it, its conditions first, then its mode
    (single, restart, queued, parallel); `for`, delays and waits take their time; what an action
    changes can set off another. Runs are generators the engine steps through, so a day of a
    hundred automations is played in a fifth of a second here and gives the same day each time.
    The 3D view then shows the copy at a moment of it: playing moves that moment on.
  - **Played as Home Assistant plays them**: the usual triggers, conditions and actions
    (`docs/sandbox.md`), both spellings of each (`trigger`/`platform`, `action`/`service`), and
    what the usual services do to the states, from the demo house's effects (D-050) and more.
    Templates are read by a small reader of Home Assistant's Jinja for the usual (states, the
    time, what set it off, numbers, texts, areas). **What cannot be played is said, never
    guessed**: a template beyond it, an integration's own service, a scene written in YAML, what
    comes from outside the home's day (MQTT, webhooks, Home Assistant starting…), each named
    with its automation in the report. The page is enough for most homes; a player on the server
    running Home Assistant's own code stays a question (D-056 ❓3).
  - **The day picked**: a date (the sun rises and sets as it does there, from Home Assistant's
    latitude and longitude), a weather (the weather entities' state by day and by night, their
    temperature each hour between a lowest and a highest), who is home at midnight and when each
    goes out and comes back (their trackers with them). A tap in the sandbox is done at the moment
    shown and kept with the day, which is played again with it.
  - **The report**: what each automation did and when (what set it off, what each action changed
    or said, how it ended), what never ran and why (stopped by its conditions, running already,
    never set off), two automations working against each other (an entity one set and another set
    otherwise within two minutes), an entity going back and forth (six changes within ten
    minutes), an automation setting itself off over and over (more than sixty times a minute:
    stopped for the rest of the day), what could not be played.
  - **The way in**: an entry of the panel's ⋮ menu, for administrators; the bar of the sandbox
    under the toolbar (the time, play, speed, the day's line with its runs and conflicts, the day,
    the report, the way out). The demo house and the measure wait until it is left. The sandbox is
    a chunk loaded the first time it opens, with its texts in both languages.
- **Consequences.**
  - The demo house's connection serves any home kept in the page (`MemoryHome`): the demo
    house's automations and energy settings are its own, the sandbox's are the copy's. The switch
    between the home and a home kept in the page (`DemoSwitch`) shows either.
  - The first load grows by the menu entry and its texts (+0.9 kB gzipped); the sandbox is
    31.5 kB gzipped when opened.
  - The copy is a model: sensors change only as the day makes them and as automations and taps set
    them. Said in the guide and in the bar.
  - At the played day's midnight no automation or script runs, and what the home ran later than
    that has not run yet; the people's room sensors (D-034) follow them out and back. The
    automation wires (D-032) take a run's time going back as well as on, so they pulse again when
    the day is played over.

## D-058 · History as reports: Home Assistant's history as tables (M38; amends D-056)

After the sandbox (M29, D-057): the maintainer asked for M38 now, ahead of the order D-056 gave
it.

- **Context.** Home Assistant's History draws graphs and timelines and downloads what it shows as
  CSV; its Logbook lists the changes, newest first. Neither answers "when was the bedroom above
  24 °C for more than an hour?", nor searches the logbook by value (D-056). D-056 found it
  feasible in the frontend, read only, from the recorder's own commands. It needs nothing of the
  milestones before it in D-056's order, and nothing of the integration.
- **Decision.**
  - **The order.** M38 comes right after the sandbox (M29), before the Wi-Fi QR code (M30): the
    maintainer's call. The rest of D-056's order stays.
  - **Opened from the plan.** A long press on a device (its controls) has **History**: a report
    of its entities. A room's panel has it too when its area has air sensors (temperature,
    humidity, CO₂, fine particles): a report of those. In the report, entities are added by a
    search (every word in a name, an id or an area's name, accents and case aside, as the Rooms
    tab's) and taken away; eight at most. The search leaves out what the viewer may not see
    (D-039), as the Rooms tab does (one rule for both, `unseenOf`), and a room that turns private
    takes its entities out of an open report.
  - **A sheet of the view**, as an element's controls or a room's panel: one at a time, closed
    where they close (a tap, a storey chosen, walking, editing), with the focus going into it and
    Escape closing it.
  - **The period.** The last 24 hours (first), 7 days, 30 days or a year, or two dates and times,
    where the home is (Home Assistant's time zone, as the person sheet's times). Changes and the
    logbook are read 31 days at most: Home Assistant keeps each change 10 days unless set
    otherwise, its statistics for good, and the report says so when the period goes further back.
  - **Three ways to read it.**
    - *Each change*: Home Assistant's history (`history/history_during_period`, the state alone:
      `minimal_response`, `no_attributes`, with the state at the start), a row for each change
      with how long it lasted, until the next or now. The same state twice in a row (a climate
      entity whose attributes changed) is one row.
    - *Each hour*: its statistics (`recorder/statistics_during_period`, `hour`): the mean, the
      lowest and the highest of a measurement, the hour's change for a meter. An entity without
      statistics is worked out in the page from its history, for the same hours: the mean
      weighted by time, the lowest and the highest of a number; for anything else, the state held
      longest in the hour and for how long. Its history is read 31 days at most, as for the
      changes, and the report says so when the period goes further back. Only the hours that
      ended, aligned as Home Assistant's statistics are.
    - *Logbook*: `logbook/get_events` for the entities and the period, searched: every word of the
      search in the state (as stored and as shown), the message, the name, or what caused it (an
      automation or a script by name, an entity, a person, an action). Home Assistant leaves
      measurements (sensors with a unit) out of its logbook: the report says so for them.
  - **Filtered by value and by how long.** Above, below, equal to or not equal to a value, and
    for at least a time. With a value, the rows in a row that match make one period (from, to,
    how long, the lowest and the highest); the time then keeps the periods that long. Without
    one, it keeps the rows that lasted that long. "The bedroom above 24 °C for more than an hour"
    is the bedroom's temperature, above 24, for at least an hour. Equal to compares numbers as
    numbers, other states as stored or as shown, accents and case aside. Of several entities, a
    value filters one (the first unless another is chosen: a room's temperature, a lamp before
    its power) or all of them.
  - **The table** shows the newest first, 500 rows at most, with a line saying how many there are
    and, filtered, how long they last in all. States are shown as Home Assistant shows them
    (`formatEntityState`, in 2025.1 and since), with their unit; as stored where it is missing (the
    demo house).
  - **CSV**: every row (not only the 500 shown), oldest first as Home Assistant's own export,
    with column names that stay the same in every language, times in ISO 8601 (UTC), states as
    the recorder gives them, numbers with a point and four decimals at most. A cell a
    spreadsheet would read as a formula (`=`, `+`, `-`, `@` before text) starts with `'`.
    Downloaded by the browser as Home Assistant's History does, and **Copy** for the companion
    apps that do not download (the text then selected to copy by hand where the clipboard is
    refused).
  - **Read only, for every user.** Home Assistant answers the three commands for any signed-in
    user; DomoTwin asks nothing more of it, keeps nothing (the report is gone once closed) and
    sends nothing elsewhere. Home Assistant's History and Logbook pages are a tap away with the
    same entities and period (`/history` and `/logbook`, `entity_id`, `start_date`, `end_date`);
    not in the demo house, whose entities they do not know (D-050). Not in the sandbox (D-057)
    either, whose day has a report of its own: there, **History** is not offered.
  - **The demo house** answers the three commands from its day (D-050): its sensors and devices
    minute by minute, the same day every day, ten days back as Home Assistant keeps each change
    by default; no statistics, so its hours are worked out in the page; its logbook from the
    day's changes, with the automations that made them. What the visitor changed is not in its
    history.
  - **A chunk of its own**, loaded the first time **History** is pressed, with its texts in both
    languages added to the translator as it loads (as D-055's tabs). The button and its label are
    in the first load.
  - **Checked, not remembered** (D-054), in Home Assistant 2025.1 (core 2025.1.0, frontend
    20250103.0): `history/history_during_period` (`start_time`, `end_time`, `entity_ids`,
    `include_start_time_state`, `significant_changes_only`, `minimal_response`, `no_attributes`;
    the answer by entity, `s` the state, `lu` and `lc` seconds);
    `recorder/statistics_during_period` (`period`, `types` among `mean`, `min`, `max`, `change`,
    `state`, `sum`; `start` and `end` in milliseconds); `logbook/get_events` (`start_time`,
    `end_time`, `entity_ids`; `when` in seconds, `state`, `message`, `name`, `context_*`;
    continuous sensors left out); none needs an administrator. The History and Logbook pages
    read `entity_id`, `start_date` and `end_date`; `hass.formatEntityState` is there; the
    History page downloads its CSV through a link.
- **Consequences.**
  - The roadmap shows M38 done after M29; D-056's order goes on from M30.
  - A long press on a device, and a room's panel, gain a button; the report is the first table
    of DomoTwin's own, where D-054 kept graphs Home Assistant's: a table of what Home Assistant
    recorded is not a chart redrawn.
  - Nothing new in the integration; the demo house (a home kept in the page that keeps a history,
    `MemoryHome.history`) and the E2E harness answer the three commands.

## D-059 · "Why?": who or what changed a device, as Home Assistant recorded it (M32)

M32, moved forward by the maintainer: asked right after 0.4.0, next to the sandbox (M29), rather
than after 0.5.0; the rest of D-056's order keeps its place.

- **Context.** D-056 planned M32 as what Home Assistant's Activity shows since 2026.9, drawn in
  the home, and the same on the versions before it. Checked in Home Assistant's core and frontend
  at the versions DomoTwin supports and the latest (2025.1.0: frontend 20250103.0; 2026.10.0:
  frontend 20260930.2), in October 2026:
  - **A state's context** reaches every dashboard with the state (`context`: `id`, `parent_id`,
    `user_id`). A service called by a signed-in user carries their user id; an automation runs
    in a new context whose parent is its trigger's
    ([`automation/__init__.py`](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/automation/__init__.py#L701-L702),
    same in 2025.1); a script runs in the context of what started it
    ([`script/__init__.py`](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/script/__init__.py#L242-L267)).
  - **The logbook** (`logbook/get_events`, open to every user, `context_id` since before 2025.1)
    gives each row where its context began: the action called (`context_domain`,
    `context_service`), the state change (`context_entity_id`, `context_state`), the run
    (`context_event_type`, `context_name`, `context_source`), and the user (`context_user_id`; in
    2026.10, not 2025.1, rows asked by entity also carry the user of their context's parent)
    ([`processor.py`](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/logbook/processor.py)).
    Only the rows of runs carry their context id; a state's row does not
    ([`automation/logbook.py`](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/automation/logbook.py)).
    A trigger is said in English words (`state of binary_sensor.hall`, `numeric state of …`,
    `time`, `time pattern`, `event '…'`, `Home Assistant starting`; the sun's `sunset with
    offset` in 2025.1, `sun event sunset` in 2026). Sensors that measure are not in it.
  - **The traces** of each context (`trace/contexts`, administrators only) give the page of each
    run: `/config/<domain>/trace/<item>?run_id=<run>`, as Home Assistant's own Activity links it
    in both versions.
  - **The Activity** opens on entities and a time from its address (`/logbook?entity_id=…,…`
    `&start_date=…&end_date=…`, in both). Since 2026.9 a row opens "what happened": its run,
    found among the automation's last three runs of the day before, and the state change of the
    trigger that set it off, one step
    ([`logbook-chain-resolver.ts`](https://github.com/home-assistant/frontend/blob/20260930.2/src/panels/logbook/logbook-chain-resolver.ts)).
  - **Voice** leaves no trace of its own: what Assist does is recorded as the actions it called,
    by the user signed in where there is one; the conversation entity writes its state in a
    context of its own, not linked to them.
- **Decision.**
  - **Asked from the device's sheet**: **Why** under the controls, with **Who or what changed
    it?**; nothing is read before (the sheets open often). It explains the entity shown in the
    scene (`primaryEntity`), not for a sensor that measures (with a unit, a state class or, as in
    2026.10, a kind that is a number: the logbook never has it). Asked again when the device's
    state changes while its chain shows, once the chain being read is read.
  - **Read as Home Assistant reads it**, in the frontend (`src/live/why.ts`): the device's last
    change of state, by the context it was written in when nothing was written since, else its row
    of the logbook around `last_changed`; the rows of that context; the run in them, else found
    as Home Assistant 2026.9 finds it (the automation's last three runs of the day before, the one
    whose rows hold the change); what set the run off: the state change of a state trigger,
    followed back the same way (by the trigger's live state when its context is the run's parent,
    else its row before the run), someone, a time, the sun, a start, an event, or Home
    Assistant's words; for a run another run started, or someone by hand, its parent context, and
    its row asked by its automation (which carries the user since 2026.10). A change written in a
    context of another's doing (a thermostat's heater) is followed to that parent too. The live
    context is trusted only when the logbook holds the change in it; what ran after the change
    in the same context is not among its causes; a context id that is not a ULID is not asked for
    (Home Assistant would read it as none and answer every row). Followed up to six changes back.
  - **Only what Home Assistant recorded.** A change whose context began with itself is "nobody, as
    far as Home Assistant knows" (the device itself, or its integration); one whose parent the
    logbook does not have, or that the logbook does not have at all, is "not in the logbook";
    further back, a change that began with itself is where the chain starts. Without Home
    Assistant's logbook (not loaded, or the sandbox's copy, D-057), no **Why**; when it cannot be
    read, what the state's context says, and that it could not be read.
  - **Drawn with the wires of M9c** (`setAutomations`, no change in the engine): a wire from each
    step to the next that has a place, through the automations and scripts that ran between them,
    in the first one's colour; a person, a time, an action float as labels; pulses one after the
    other from the start to the device. A tap names the wire's runs. It takes the place of the
    automations' wires while it shows.
  - **Home Assistant's pages reused** (D-054): the Activity on the chain's entities around it, for
    everyone; a run's trace for administrators. Neither in the demo house (they show the home).
  - **Names**: a user is named by their `person`, or the user viewing; for an administrator, by
    Home Assistant's users (`config/auth/list`, theirs only) when no person is theirs; "a user of
    Home Assistant" otherwise.
  - **Private rooms (D-039)**: a step of what a room the viewer may not see holds, by its pieces
    or its area, is "in a private room", left out of the Activity's address and not drawn.
  - **The demo house** records as Home Assistant does (`src/demo/logbook.ts`): the visitor's
    actions as theirs, its automations' runs with their triggers, the house as it opens and the
    moment the visitor goes to as the demo's day; its logbook answered as `logbook/get_events`
    answers: a context's rows from what it recorded, an entity's from its day before it opened
    (D-058) and from what it recorded since.
- **Consequences.**
  - The section and its texts come with the sheets, the drawing is a chunk of its own
    (`chunks/why-wires-<hash>.js`); the first load grows by the view's part and five icons
    (+0.9 kB gzipped). The automation wires and the chain share their spots and chip
    (`wire-spots.ts`).
  - On 2026.9 and later, Home Assistant's own Activity shows the same chain as a list: DomoTwin's
    is the same read, drawn in the home, followed further back, and on 2025.1 too.
  - Why something did not happen stays the sandbox's (M29).

## D-060 · The Wi-Fi for guests: its QR code drawn in the page (M30)

M30, the first part of guest access (M33), planned after the sandbox (D-056).

- **Context.** Guests ask for the Wi-Fi; a QR code joins a phone to it at once. Home Assistant
  has no place of its own for the home's Wi-Fi; some routers give their guest network's code as an
  image entity (FRITZ!Box, UniFi). The password is a secret like no other DomoTwin keeps: it must
  never be in the plan, the logs, the diagnostics, an export or the repository.
- **Decision.**
  - **Kept apart.** The network (its name, password, kind, whether it is hidden, or the router's
    image entity, and the screens that show it) is kept in a private store of its own
    (`.storage/domotwin.wifi`), read and changed by its own commands (`domotwin/wifi/get`,
    `/save`, `/clear`). An administrator gives and changes it; the password is checked against
    its kind (WPA, WEP, open) as phones take it. The same network saved without its password
    keeps it. Diagnostics say only whether there is one. Removing DomoTwin deletes it.
  - **Shown where chosen.** `domotwin/wifi/get` answers an administrator with all of it, and
    anyone else only on a screen an administrator chose (a card's `screen`, D-029, its name
    matched whatever the case as `domotwin.show` matches it), with what draws the code; elsewhere
    only whether there is one. The password comes only when asked for (`password: true`), which
    the dialog does when it opens: the panel and the cards keep the network without it. A
    screen's name is no secret (it is in the dashboard's configuration): anyone signed in to Home
    Assistant can ask as one of those screens would, as anyone before it can scan it. That suits a
    network meant for guests, and the guide says so. A change is told to the screens
    (`kind: wifi`), never what changed.
  - **Drawn in the page.** The analysis module (D-043), loaded the first time the code is shown,
    builds what a phone reads (`WIFI:T:WPA;S:<name>;P:<password>;;`, with `\`, `;`, `,`, `:` and
    `"` escaped; `H:true` for a hidden network) and encodes it with `qrcodegen` (MIT, no
    dependencies, checked by `cargo deny`); the page draws its modules as an SVG, dark on white
    whatever the look. A router's code is its image entity's picture, from Home Assistant.
  - **The way in.** A Wi-Fi button among the view's buttons when it may be shown here, in the panel
    and in cards, and on its own when a card hides its tools or cannot draw in 3D (a wall screen
    still gives the Wi-Fi); for administrators, an entry of the ⋮ menu, which opens the form when
    nothing is given yet. A wall screen left alone closes the dialog as it goes back to its view.
    The demo house has a fictional guest network; the sandbox has none.
- **Consequences.**
  - The first load grows by the button, the client's commands and their texts; the dialog is a
    chunk of its own, the encoder a few kilobytes of the analysis module.
  - A password Home Assistant's own debug logging writes (its connection's messages, when someone
    turns it on) is out of DomoTwin's hands: said in the guide.
  - Guest access (M33) builds on it: a guest's own screen, for a time, with this code.

## D-061 · Into Home Assistant's Overview: area pages, room sensors, summaries (M23b)

M23b, planned in D-056 after the sandbox (D-057) and the Wi-Fi QR code (D-060).

- **Context.** Home Assistant opens on its own Overview since 2026.2 (D-056): a page for each area,
  summaries in its manner, favourites an administrator chooses. Checked when built, in Home
  Assistant's frontend at the versions its releases pin: its `home` panel came in 2025.12, hidden
  (core's `async_register_built_in_panel(hass, "home", …, sidebar_default_visible=False)`), and
  became the page Home Assistant opens on in 2026.2 (`DEFAULT_PANEL = "home"`, frontend
  20260128.6). Every area has a page at `/home/areas-<area_id>` from 2025.12 to 2026.10
  (`home-dashboard-strategy.ts`), and that page shows, beside its summaries, the other entities of
  the area grouped by device, under the device's name, those with no entity category
  (`home-area-view-strategy.ts`, 20260930.2).
- **Decision.**
  - **A room tapped in 3D opens its area's page.** In the panel, where Home Assistant is 2026.2 or
    later and has its `home` panel, a room tapped whose area Home Assistant has opens
    `/home/areas-<area>`; Home Assistant's back button leads back to the 3D view. Elsewhere, in
    the demo house and in the sandbox (whose areas are not the home's), the room's page in
    *Rooms*, as before (D-055). The room's own actions (D-047) stay in its 3D panel, opened by a
    long press. Cards are unchanged: a tap frames the room there.
  - **Each room a device, two sensors.** Each room of the plans has a service device of its own,
    *DomoTwin · \<room\>*, made in the room's area (the one it reads, D-034), which Home Assistant
    shows on that area's page: the people at home in the room (unknown while the room is private
    for nobody, as D-039 locks it: an entity is everyone's; those who hid themselves, D-034, not
    counted), and the upkeep due for the pieces in it (D-033), the soonest listed. A piece is in
    the room it follows since edit mode moved it (D-019), else the room it names, else the room
    its centre is in, as the engine finds it. The rooms are the people tracker's, which follows
    the plans, the bindings and the areas first. When the room is linked to another area, its
    device moves there as soon as that area exists, and a device in no area, or made now (Home
    Assistant brings a deleted one back where it was), goes into its room's; one moved by hand
    stays where it was put until the room's area changes, and an area renamed moves
    nothing. A room removed takes its device and sensors with it. The device's identifiers are looked up with the config entry, as Home
    Assistant 2026.x asks, and alone before (`compat.device_of`).
  - **No sensor for the mesh or the robots.** The weak spots of the mesh are worked out in the
    browser from ZHA's tables (D-031, D-043), which the integration does not read; the robots are
    drawn moving by the engine (D-049), not reported by Home Assistant. Their summaries say what
    DomoTwin knows of them instead.
  - **Summaries, in the Overview's manner.** `custom:domotwin-summary-card`, with `summary` one
    of `people`, `network`, `automations`, `upkeep`, `robots`: an icon, a title and a line, a tap
    opening the 3D view (`/domotwin/3d`, with `?layer=` for the network, the automations and the
    upkeep). The panel chooses a layer asked for in its address once the plan is drawn, then
    takes it out of the address; the view shows it only if the user may see it (the network and
    the automations are for administrators), as for a layer chosen in its menu. The people's
    summary names the rooms of the people the viewer may see in DomoTwin only (D-034): none of
    those hidden, none at all for someone who is not an administrator when only administrators
    see them. The network's summary reads ZHA's devices and the analysis module's health every
    ten minutes, for administrators only, and not sooner when the card is shown again. A
    summary is drawn again only when what it says changes, and opens nothing for someone without
    DomoTwin's panel (Home Assistant lists only the panels a user may open). The card is defined with the first picture and
    loads what it shows with the first one on the page. The Home tab takes them as cards of its
    own (`{"type": "summary", "summary": …}`, validated by the integration).
  - **Shortcuts.** The guide shows how to put DomoTwin among the Overview's shortcuts (2026.5 and
    later); DomoTwin does not write Home Assistant's system data (D-056).
  - **Asked, not decided.** The 3D view at the top of the Overview or of an area's page, and an
    area's page opening DomoTwin on its room, need Home Assistant itself; whether the Home and
    Rooms tabs stay where the Overview is was asked: they stay until the answer.
- **Consequences.**
  - The first load grows by the summary card's shell, the area page's rule and a few texts; what
    the summaries show is a chunk of its own, their editor another.
  - Each room adds a device and two entities to Home Assistant; a plan of 40 rooms, 40 devices.
  - M24 and M25 follow the same rule: Home Assistant's own pages opened where it has them.

## D-062 · Configuration history: each change kept, one item put back (M36, amends D-056)

After the sandbox (M29, D-057), history as reports (M38, D-058), "Why?" (M32, D-059), the Wi-Fi for
guests (M30, D-060) and Home Assistant's Overview (M23b, D-061): the maintainer asked for M36
ahead of the order D-056 gave it. It waits on nothing the other milestones build.

- **Context.** Home Assistant keeps no history of its own configuration: its editors' undo lasts
  one session, and a backup puts back a whole part, not one automation. What exists does it with
  an add-on and Git, or from backups (D-056, item 8). M36 keeps each change of an automation, a
  script, a scene and a dashboard inside Home Assistant, says what changed in words, and puts one
  item back, with Home Assistant's own configuration commands.
- **Decision.**
  - **What is kept**: the automations, scripts and scenes Home Assistant's editors write
    (`automations.yaml`, `scripts.yaml`, `scenes.yaml`, read as its editors read them), those
    written in YAML files of one's own (configuration.yaml, packages), read from their entities as
    Home Assistant loaded them, and the dashboards that have a configuration (storage or YAML).
    Scenes made by `scene.create` are not configuration and are left out.
  - **When**: once Home Assistant has started (what changed while it was stopped, or by hand),
    after Home Assistant reloads automations or scenes (its `automation_reloaded` and
    `scene_reloaded`), five seconds after `script.reload` is called and again thirty seconds
    after (Home Assistant fires no event of its own after it), when one of them is removed from
    the entity registry (its editors
    delete that way, without a reload), when a dashboard is saved or removed (`lovelace_updated`),
    and when DomoTwin has put an item back. A version is kept when the item's configuration, its
    keys in any order, is not the one kept last; an item no longer there is kept as removed. A
    file Home Assistant cannot read is left alone: nothing in it is taken for removed.
  - **Where**: in a store of its own (`.storage/domotwin.config_history`, private), each version as
    the JSON of its configuration with its date. **Limited in size**: 4 MB in all and 50
    versions an item, past which the oldest versions go first, an item's newest always kept; 1 MB
    a version (a larger one keeps its date, not its content); a removed item with nothing else
    kept is forgotten, and past 2 000 items the removed ones are, the longest removed first.
    Removed with the integration; written at once and kept when it is only unloaded.
  - **What changed, in words**: worked out in the page between any two versions: what was
    added, removed or changed, and where, in words for the parts known (the name, description and
    mode; the triggers, conditions and actions of an automation; the steps and fields of a
    script; a scene's entities and their states; a dashboard's title, views, sections and cards),
    by the place in the configuration otherwise, each value said in short. A list's items are
    matched before they are compared, so that an action added does not read as every action after
    it changed. A version is compared with the one before it, or with the current one: what
    putting it back would change. Its whole content can be read.
  - **Put back** through the commands Home Assistant's editors use: the configuration API
    (`POST /api/config/<automation|script|scene>/config/<id>`), which checks the configuration,
    writes the file and reloads, and `lovelace/config/save` for a dashboard. A removed
    automation, script or scene can be put back; a removed dashboard only once it exists again.
    Home Assistant's refusal (an entity or an integration gone) is shown as it gives it. Shown,
    not put back: what is written in one's own YAML files, a version too large to keep, a removed
    one. After putting back, DomoTwin reads the item again: the item put back is its newest
    version, said to be the same as the one it came from.
  - **Where it is**: *Configuration history* in the panel's ⋮ menu, for administrators, who
    alone may read and change Home Assistant's configuration; its commands refuse anyone else.
    The items by kind, with a search, the most recently changed first; an item's versions, newest
    first, with what each changed; a link to Home Assistant's editor of the item. The dialog is a
    chunk loaded when it opens. The demo house shows a history of its own automations, put back
    in the page; the sandbox (D-057), a copy of the home, has none until it is left.
  - **Never in the diagnostics**, not even counted; nothing sent anywhere.
- **Consequences.**
  - The integration reads Home Assistant's automations, scripts, scenes and dashboards as they
    are loaded (their entities' configuration, the dashboards Lovelace keeps), in the forms Home
    Assistant has had since 2025.1; a form it does not know is left out rather than misread.
  - Who made a change is not known: Home Assistant's editors do not say it.
  - The history begins when DomoTwin first sees the configuration: what changed before is not
    known, and the oldest version kept says so.
  - The first load grows by the menu item and its text; the rest comes when the dialog opens.
  - The roadmap shows M36 done after M23b; the rest of D-056's order stays.
  - Its names say *configuration history* (`config_history.py`, `config-history.ts`,
    `domotwin/config_history/*`, `.storage/domotwin.config_history`), beside the history
    reports of M38, which read Home Assistant's history of states.

## D-063 · Hydro-Québec's peaks, on the plan, the Home tab and in the sandbox (M39)

M39, moved forward by the maintainer from the end of the way to 0.6.0 (D-056), after the
sandbox (M29, D-057), whose day it plays; its part in the weekly report (M37) comes with it.

- **Context.** For a home on one of Hydro-Québec's offers with peak events (Flex D; the winter
  credit, kept by those who had it), each announced peak costs or earns: the home pre-heats before
  it and sheds rooms during it. Two integrations of HACS's default lists read the peaks; DomoTwin
  reads their entities only (D-056). What they give was checked in their code, in October 2026:
  [hydroqc-ha](https://github.com/hydroqc/hydroqc-ha) 0.7.0 (`main` at `164e031`, AGPL-3.0: read,
  nothing copied) and [HydroPeak](https://github.com/Beat-YT/hydropeak-ha) 1.6.5 (MIT).
- **The integrations, checked.**
  - **hydroqc** (`hydroqc`), for Flex D and the winter credit: the next peak's start and end as
    timestamp sensors (`dpc_next_peak_start`, `dpc_next_peak_end`; for the winter credit, its
    announced peaks, `wc_next_critical_peak_start` and `_end`, its daily windows being
    `wc_next_peak_*`), in UTC, `unknown` without a peak and, for the winter credit, off season;
    the pre-heating's start (`dpc_next_pre_heat_start`, off by default; `wc_next_pre_heat_start`,
    its next window's), 120 minutes before the peak unless set; on/off sensors of the pre-heating
    and the peak, the contract's state (`critical_peak` during one). Since 0.7.0 they come from a
    calendar the user picks, where hydroqc writes each announced peak (`🔴 Pointe critique`; its
    description says `Tarif:`, `Critique: Oui` and `ID: hydroqc_…`); without an account (its open
    data mode) the calendar is all there is, with a *Refresh peak data* button hydroqc makes only
    for Flex D or the winter credit with such a calendar.
  - **HydroPeak** (`hydropeak`), Hydro-Québec's open data, one device per offer: `event_start`,
    `event_end` and `preheat_start` (180 minutes before, by default), with Hydro-Québec's offset,
    and on/off sensors of the pre-heating and the peak; every event is an announced peak.
  - Both name their entities from their translations: the ids are in the home's language, and
    may be renamed. Their kind is in Home Assistant's entity registry as the frontend has it
    (`platform`, `translation_key`).
- **Decision.**
  - **Where the peak is read**: hydroqc's sensors, HydroPeak's, and a calendar whose current or
    next event bears hydroqc's mark (its attributes say when, as a wall clock in Home Assistant's
    time zone). Entities are found by their integration and kind, never by their id; hydroqc's
    button says it reads the peaks while its calendar shows none. With several (two contracts,
    both integrations), the peak under way, else the soonest. Only announced peaks: the winter
    credit's daily windows are not shown. The pre-heating where the integration says it (the
    winter credit's when it is its announced peak's; within twelve hours of the peak), else the
    integration's own default (hydroqc's two hours, HydroPeak's three), nothing else guessed.
  - **Where it stands**: to come, pre-heating, under way, or none announced; worked out again
    when that changes, by a timer, since nothing in Home Assistant may change then.
  - **What the rooms do**, read from the thermostats of each room's area as the layers read
    their sensors (D-023): a thermostat heats when it says so (`hvac_action`), else when its
    target is 0.3 °C above the room; it is set back when it is off or its target is 0.3 °C below
    the room; otherwise it holds the room. While pre-heating, a room that heats pre-heats; during
    the peak, a room set back is shed, one that heats still heats, one that holds the room is
    neither; before and after, nothing. What a room draws is what its area's power sensors read,
    the home's own meters (the energy settings, D-049) left out, from 5 W. An area shared by
    several rooms counts once, for the first. Seen, not set: whatever sheds the rooms (hydroqc's
    blueprints, one's own automations), the plan shows what it did. Nothing of a private room the
    viewer may not see (D-039), nor of its area, nor of what its pieces link.
  - **In 3D, a layer**: *Hydro-Québec peaks*, offered in the menu and the card's options only
    where an integration reads them. The rooms tinted as a heatmap is (the engine's `peak`:
    pre-heating amber, shed blue, still heating red, the ends of the temperature scale), what each
    draws written at its centre (`draws`, labels of kind `draw`), the rooms' names while nothing
    is. Its legend says when (the peak under way and until when; the pre-heating and the peak's
    hours; the next peak and its pre-heating; or none announced), how many rooms do what, and what
    they draw.
  - **On the Home tab, a chip** while a peak is announced: the next one, the pre-heating, or the
    peak under way (amber then). It opens when, each room with what it does and draws, *See it in
    3D*, which opens the 3D tab on the layer, and, for an administrator before the peak, *Play its
    day in the sandbox*.
  - **In the sandbox (M29)**: the peak announced when the home is copied is played on its day.
    Through it, the integrations' on/off sensors of the pre-heating and the peak go on and off,
    hydroqc's contract says a critical peak, today's peaks are said from midnight and hydroqc's
    calendar is on; their timestamps keep the copy's. So the home's automations set off by them
    run on the copy, and the peak's layer shows what the rooms then do, at the sandbox's time.
    *The day* says the announced peak and leads to its day, shown from its pre-heating; the day's
    line shows the pre-heating and the peak; the report says what each room did, from the
    pre-heating to the peak's end, read every five minutes and at each change of phase, nothing of
    a private room the visitor may not see. Only the devices and calendars that say this peak are
    moved. Another peak announced that day (the copy's sensors of the day after say so) is said by
    the integrations from midnight but not played, its times unknown, and *The day* says it. In
    the copy, whose rooms' temperatures and thermostats' `hvac_action` do not move, a thermostat's
    target alone says what it does; an air conditioner off says nothing of the heat, live or in
    the sandbox.
  - **Its cost**: only whether an integration is there is in the first load; the peak, the rooms
    and the legend come in a chunk the first time the layer shows, shared with the Home tab's
    and the sandbox's, with their texts in both languages.
- **Consequences.**
  - Nothing is stored and nothing is asked of Hydro-Québec: no setting, nothing in the
    integration; the peak comes from the states Home Assistant already sends.
  - The engine's layers read `peak` and `draws` (`setLayers`).
  - A home with neither integration sees nothing of it. A calendar that holds other events shows
    the peak only while it is its current or next one.
  - A peak announced after the sandbox opened is played once it is opened again.
  - The week's peaks in the weekly report come with M37.

## D-064 · More imports: robot vacuum maps, Floorplanner, mesh scans (amends D-040)

M20, moved forward by the maintainer from after 0.5.0 (D-056) to before it, so that the first
launch in five minutes (M22) has it.

- **Context.** Many homes already have a map, drawn by something other than a planning app: the
  robot vacuum's, made while it cleans; a Floorplanner plan, and the plans other apps export to
  it; a mesh scanned with a phone or a Matterport camera. D-040 read Sweet Home 3D homes, DXF
  drawings and RoomPlan's own files, and refused meshes. Checked at their sources in October
  2026: Valetudo's map classes and its MQTT map handle
  ([`MapLayer.js`](https://github.com/Hypfer/Valetudo/blob/master/backend/lib/entities/map/MapLayer.js),
  [`ValetudoMap.js`](https://github.com/Hypfer/Valetudo/blob/master/backend/lib/entities/map/ValetudoMap.js),
  [`MapNodeMqttHandle.js`](https://github.com/Hypfer/Valetudo/blob/master/backend/lib/mqtt/handles/MapNodeMqttHandle.js)),
  Valetudo RE's reader of Roborock's map
  ([`RRMapParser.js`](https://github.com/rand256/valetudo/blob/master/lib/RRMapParser.js)) and the
  Xiaomi Cloud Map Extractor's
  ([`image_handler.py`](https://github.com/PiotrMachowski/Home-Assistant-custom-components-Xiaomi-Cloud-Map-Extractor/blob/master/custom_components/xiaomi_cloud_map_extractor/xiaomi/image_handler.py)), and
  Floorplanner's FML 3.0 specification ([fml.floorplanner.dev](https://fml.floorplanner.dev/intro/)).
- **Decision.**
  - **Robot vacuum maps.**
    - **Valetudo**, which runs on many robots (Roborock, Dreame, Xiaomi, Viomi…) without their
      maker's cloud: its map as its REST API gives it (`/api/v2/robot/state/map`, JSON), as it
      publishes it over MQTT (`map-data`, the JSON deflated), or as Home Assistant receives it
      (`map-data-hass`: a PNG whose `zTXt` chunk `ValetudoMap` holds the deflated JSON, the
      *Map data* camera of its MQTT discovery). Layers are pixels of `pixelSize` cm (1 to 100), as
      run-length triples (`compressedPixels`) or, before Valetudo compressed them, as pairs;
      entities are in cm; the origin is the top left, `y` down, as on a plan.
    - **Roborock's own map** (`rr`), as Valetudo RE serves it (`/api/map/latest`, gzipped) and as
      the Xiaomi Cloud Map Extractor stores it (`store_map_raw`): its image block, 5 cm a pixel,
      `y` up (turned, not mirrored), each pixel a wall, a floor or a room (its id in the upper
      five bits, on robots that have rooms; `0xFF` a floor in none); the dock's place in
      millimetres.
    - **What a map becomes.** Each segment is a room, kept by its id (`segment-16`), so that
      importing the map again keeps the links; named by Valetudo's name for it. A map without
      segments is one room, its largest floor. A room is its pixels closed over the furniture
      the robot went round (holes and notches under 30 cm), its outline traced, simplified and
      squared to the map's walls, the map turned so that they run along the axes. A door is
      where two rooms touch without a wall between them, as wide as they touch; wider than
      1.6 m, an opening; it opens into the room with fewer doors (a bedroom off the hall). The
      floors Valetudo knows (tiles, wood and its direction) are the rooms' floors. The dock is a
      robot vacuum's dock (`robot-vacuum`, D-049), its back to the nearest wall. A robot map has
      no windows, no furniture, one storey.
    - **From Home Assistant itself**: *Import a robot's map* lists the cameras of Valetudo's MQTT
      discovery, reads the one picked through Home Assistant (`/api/camera_proxy`, the user's
      session), and links the dock to the vacuum of the same device. Nothing reaches the robot.
    - **Other robots** keep their map in their maker's app and cloud; their integrations show it
      as a picture (Roborock's, the Xiaomi Cloud Map Extractor's camera), whose rooms are
      colours and boxes, not outlines. A picture is refused with what to do instead.
  - **Floorplanner** (`.fml`, FML 3.0, JSON, centimetres): each floor a storey (its name, its
    level, its height), its first design read; its areas the rooms (inside their walls, as
    D-040's drafts are), named by their name or a label inside them; its walls the wall
    thicknesses, the rooms their faces enclose when the design has no areas; the walls' openings
    doors and windows (centred at `t` along their wall, the hinge and swing from `mirrored`);
    its items the furniture, a box of their size unless their name says a kind. Curved walls
    are straight; surfaces (a terrace), lines, dimensions, cameras and the drawing are left out.
    The older XML FML is refused with what to do instead.
  - **Mesh scans** (OBJ, PLY, GLB, STL), amending D-040. Telling walls from furniture in a mesh
    is still guesswork, so DomoTwin does not try: it reads the heights where furniture is not.
    - **Up and unit.** The axis up is the format's (`y`, `z` for STL), unless another holds twice
      the horizontal surface at one height (a floor: the walls of storeys over one another are in
      one plane, their floors are not); the unit is the one whose storey height (floor to ceiling)
      is a storey's, else the one whose size is a home's.
    - **Storeys** are the floors: the heights holding the most surface facing up, more than
      1.8 m apart; each storey's ceiling the most surface facing down above it.
    - **Turned square** by the directions of the walls (the vertical surfaces), before anything
      is drawn, so that the rooms come out square.
    - **Rooms** are the spaces under the ceiling (or over the floor where the ceiling was not
      scanned) that the walls enclose above the doors, between 2.1 m and the ceiling: there the
      walls are whole, lintels included, and furniture does not reach. The walls are cut there
      into lines, drawn 5 cm a cell; a space narrower than 60 cm is the inside of a wall or a
      cupboard, not a room.
    - **Doors** are where the wall between two rooms, or to the outside, is open at 0.4, 1.0 and
      1.5 m; **windows** where a room's wall to the outside is open at 1.0 and 1.5 m over a sill at
      0.4 m (glass the scan saw through). Wider than 1.6 m, a door is an opening.
    - **No furniture**: a mesh does not say what a piece is. Its furniture can still come in as
      one's own 3D models (D-021). Points without faces (a point cloud), FBX and glTF with its
      buffers apart are refused with what to do instead.
  - **One import, as before** (D-040): each reader gives the builder a draft; the format comes
    from the content (the JSON's keys, the PNG's chunk, the `rr`, `ply`, `glTF` and STL headers,
    OBJ's lines, a deflated or gzipped stream opened first); limits counted while reading
    (4 million map pixels and cells, 16 million with the grids of its rooms, a million cells two
    rooms share, 100 rooms; 5 million triangles and the cells they cover; 64 MB inflated) so that
    a malicious file runs out of budget, not of memory or of time. Rooms traced from cells share
    one module (`grid`).
- **Consequences.**
  - The import module grows, still fetched only to import a file; the first load grows by the
    menu item and the formats' names (`PERFORMANCE.md`).
  - Valetudo, FML and mesh files are numbered in their order, except a robot's segments; a
    Floorplanner plan imported again keeps its links only if nothing was added before them.
  - A mesh's rooms and doors are measured, not guessed, but only where the scan saw: a door
    scanned closed is a wall, a room scanned without its ceiling stops at its furniture. The
    plan editor finishes the rest, as for every import.

## D-065 · What Home Assistant's users say of 3D twins: said plainly, measured first (amends D-056)

Read by the maintainer on r/homeassistant in October 2026, and passed on in their own words.

- **Context.**
  - **AI-written code.** Threads about 3D plans for Home Assistant drew a strong reaction to code
    written with AI. The most upvoted answer said AI is not the problem; *paying* for AI-written
    extras in an open-source project is.
  - **A toy.** The most upvoted comment of another thread: a 3D plan "looks cool, then you abandon
    it in a week"; it fits no daily use. The one practical use named was seeing each device's
    signal strength on the plan.
  - **Split levels** were asked for three times.
  - **Locating.** Room presence learned by walking around, with a tool that reads an iPhone's
    identity key (IRK) with an ESP32 and no Mac, was shown elsewhere in the same days as DomoTwin's
    Bluetooth locating (M9f, D-035).
  - **Measured, not claimed.** A user's own twin (not released) does what M9f does (it predicts
    what each receiver hears from the 3D model), on a grid of half-metre cells with a cloud of
    likely spots that changes floor only through the stairs, with 21 receivers. Measured against
    Bermuda on the same readings: room changes per hour from 38 to 7, floor jumps per hour from
    15.5 to 1.9, about 1.5 m off (60 cm where trained). Their tip: ESPHome proxies listening all
    the time, Shelly scanners in Auto.
  - Also asked: several mmWave sensors merged into one map of the home, each knowing only its own
    zone today. And a top comment: a presence sensor in each room often makes Bluetooth unneeded.
  - Checked when written (2026-10-27): ESPHome 2026.10 warns that scan windows over 600 ms starve
    the Wi-Fi on the same radio, so the older tip of a window as long as the interval, at 1 100 ms,
    now harms Wi-Fi proxies; a 300 ms window every 320 ms, scanning actively, listens about 94 % of
    the time without Wi-Fi drops (corrected by the maintainer); since Home Assistant 2026.6, Home Assistant chooses active or passive scanning (Auto) for
    ESPHome proxies and its adapter, and offers the same Auto to Shelly devices, whose scanner is
    off until it is turned on. Tools that read an iPhone's key without a Mac
    exist and are kept up: irk-capture (an ESPHome package, MIT) and ESPresense's *Enroll* (AGPL).
- **Decision.**
  - **Say how DomoTwin is built.** The READMEs say it plainly: written with Claude Code; every
    change of the code through a pull request, checked by its tests, two automated reviews, clippy,
    CodeQL, `cargo deny`, gitleaks and a size budget, and fuzzing when a reader changes; no network
    call outside Home Assistant; no shop, no licence key, no paid tier, ever. And, near the top,
    what sets it apart: the IFC and Sweet Home 3D imports, everything free, the network map, the
    sandbox (the placement advisor once it is there). The first screens of both READMEs are
    shortened, their headings made plainer.
  - **The Bluetooth guide** gives the receivers' settings as they are now (ESPHome, Shelly, Home
    Assistant's scanning mode) and what they change, what to expect with one receiver or one per
    room, that a presence sensor per room may be enough, and how to get an iPhone's key today.
  - **Measure before adding** (M41): a diagnostic records DomoTwin's room changes, storey changes
    and time unknown per hour, and Bermuda's for the same devices where it runs; the maintainer
    runs it at home and the figures go in the guide, as they fall. It comes before any other
    locating feature, and soon (right after the weather, asked for before it), because it is small
    and because it is what makes M9f credible.
  - **Finer locating** (M42), only if M41's figures justify it, and **mmWave sensors merged**
    (M43): after the sandbox (done) and the placement advisor (M31), which they build on (the
    radio model turned around, the radios placed on the plan). M42 reuses M9f's radio model, the
    devices' learned loudness, the rooms taught, the presence sensors' weight and the sureness
    rule, and the walk's stairs (D-029) for the storeys.
  - **Split levels** (M44): storeys at any height already draw and join by stairs; the Bluetooth
    model's floors, the half levels' names and a ground that steps are missing. Next to the
    outdoors (M18), whose ground it needs, with a fictional example.
  - **An iPhone's key** (M45): DomoTwin links to the tools that exist and takes the key in their
    forms, rather than building a firmware of its own; small, next to M41.
  - **The weather** (M40), asked for by the maintainer before these, is put on the roadmap here;
    its decision comes with it.
- **Consequences.**
  - D-056's order goes on: M23b done, then M40, M41 and M45, then M24 to M26, M31 and M22 before
    0.5.0; M42 and M43 open the way to 0.6.0, M44 sits by M18.
  - The other 3D plan is not named in the repository, nor anyone from the threads; the user's
    figures are quoted as a user's, not as DomoTwin's.
  - The figures DomoTwin publishes are its own, measured in a real home, with the same figures
    for Bermuda beside them.

## D-066 · The placement advisor: where the next radio helps most (M31)

Asked by the maintainer after the sandbox (D-057) and history as reports (D-058), as "Why?" was
(D-059): M31 now, before M24 to M26, out of the order D-056 set, as M16d was brought forward
(D-053); the Wi-Fi QR code (M30, D-060), Home Assistant's Overview joined (M23b, D-061), the
configuration history (M36, D-062), Hydro-Québec's peaks (M39, D-063) and more imports (M20,
D-064) were built meanwhile. It does not wait on what the two weeks of use show, and the order of
the rest stays.

- **Context.** The locating (D-035) works out from the plan what each Bluetooth receiver should
  hear in each room, and learns what it really heard; the network map (D-031) reads the Zigbee
  mesh's links and names the rooms reached only through weak ones. Neither says where the next
  radio would help: a Bluetooth proxy, a Zigbee router or a Wi-Fi access point is placed by
  guesswork, and moved until it works. Nothing found predicts coverage from a plan or says where
  the next radio should go (D-056).
- **Decision.**
  - **A layer for administrators.** *Radio coverage* (`coverage`) joins the layers, offered to
    administrators only: they alone may read the receivers and the mesh. Its sheet chooses the
    radio: Bluetooth, Zigbee (with ZHA set up) or Wi-Fi. Each room of the plan is coloured for the
    radio chosen, with the heatmap's halo (D-023) on a scale of its own: good (green), fair
    (yellow), weak (orange), out of reach (red). The radios known are markers; the spots advised
    are numbered markers. The sheet lists the rooms, the worst first, then the spots.
  - **What was measured comes before what is predicted.** A room is measured when:
    - Bluetooth: a receiver learned it (taught, or presence sensors agreeing, D-035) for at least
      as many readings as the plan counts for (eight): the best receiver's mean, the device's own
      loudness taken away (a phone as the model has it);
    - Zigbee: an end device placed in it (D-031) has a link of known LQI to the coordinator or a
      router heard from in the last day: the best one, read as the map reads it (good from 150,
      fair from 80, weak below). A room with the coordinator or a router is covered by it: its
      links to the others are the mesh's health, the network map's;
    - Wi-Fi: a device placed in it reports its Wi-Fi signal: a sensor of the `signal_strength`
      class in dBm of an ESPHome, Shelly, Tasmota, WLED or other Wi-Fi device, or named after
      Wi-Fi; never one of ZHA's, Z-Wave's or Bluetooth's, nor a phone's, which moves. The best of
      them.

    A measured room shows what was measured, and by what; the others what the model predicts.
    Its Wi-Fi signals are read again as they change, to a decibel, at most every 30 seconds.
  - **The model is D-035's, for each radio.** The signal falls with the distance (exponent 2.2),
    4 dB a wall, 0.4 of a wall for a door, none for a side left open, 15 dB a floor, worked out
    over the same points of each room as the locating (up to twelve, clear of its sides) at
    110 cm. A radio stands at its piece's centre, else at 120 cm where it was placed. What changes
    is how loud it is at a metre, and the thresholds (dBm), guides rather than measures:

    | Radio                               | At 1 m | Good  | Fair  | Weak   | Out of reach |
    | ----------------------------------- | ------ | ----- | ----- | ------ | ------------ |
    | Bluetooth: a phone, by a receiver   | −59    | ≥ −80 | ≥ −90 | ≥ −100 | below        |
    | Zigbee: a device, by a router       | −45    | ≥ −75 | ≥ −85 | ≥ −95  | below        |
    | Wi-Fi: an access point, by a device | −35    | ≥ −67 | ≥ −75 | ≥ −85  | below        |

    A room's signal is the mean over its points of the best radio's.
  - **Checked against what was measured.** Where a signal was measured (a Bluetooth room learned,
    a Wi-Fi device), the model's error is what was measured less what it predicts there. From two
    measurements, the predictions are moved by the errors' median (12 dB at most), and the sheet
    says by how much and how far off the model still is on average. Zigbee measures its links in
    LQI, not in dBm: the rooms both measured and predicted are compared by level, and the sheet
    says in how many they agree.
  - **The spots advised.** Each room offers its middle and up to four of its points as spots for
    the next radio, at 120 cm. With a radio there, each room gets the better of what it has
    (measured or predicted) and what the new radio alone gives it (with the model's correction).
    A spot's worth is the levels it raises, a measured room's counting double (something there
    uses the radio now), then the signal it adds where a room is not covered well yet (20 dB at
    most a room), by the rooms' areas; a room measured by its level alone (Zigbee) has the least
    signal of its level. A Zigbee router, and a
    Wi-Fi access point, must be reached at least fairly where it stands by one of its kind that
    is already there (when there is one): a router joins the mesh through its neighbours, and an
    access point without a cable through the first one. The best spot of each room is kept, then
    the three best, each with what it changes ("Bathroom: weak → good") and the piece of its room
    it stands by (within 1.5 m; not a finish of the room nor what hangs from its ceiling or walls);
    none when no spot raises a room's level ("every room is covered well"). Each spot is the next
    radio alone, not one of three to add; a spot tapped shows the rooms as they would be with it.
    Beyond 24 rooms, each room is weighed from four of its points and offers its middle alone:
    the advice takes tens of milliseconds there, not hundreds.
  - **Private rooms (D-039)** the viewer may not see show nothing of their coverage, as their
    floors are not coloured: not in the sheet, no spot in them, nothing they would gain.
  - **The radios.**
    - The Bluetooth receivers, where the locating places them (D-035): `domotwin/locating/get`
      gives each one's place (storey, point, height) and what each learned in each room (mean and
      readings), to administrators only as before. A receiver placed nowhere is listed, with the
      Bluetooth settings a tap away in the panel.
    - The Zigbee coordinator and routers placed at their pieces (D-031), but not those not heard
      from for a day: they relay for no one.
    - The Wi-Fi access points an administrator placed: in the panel, *Place an access point*
      asks for a tap on the floor of the storey shown where it stands, and keeps it in DomoTwin's
      settings (`access_points`: its storey, its point, a name; 16 at most); the sheet removes
      one. A router's integration does not say where its access points are in the home.
  - **Where it runs: in the page.** The model is the analysis module's (D-043), loaded the first
    time the layer is shown, from what the page already has: the storeys' plans and overlays (a
    storey without a plan still a floor), the bindings, ZHA's mesh, the Wi-Fi sensors and the
    locating's answer. It is written again in the
    core (`domotwin_core::coverage`), reading the plans as the integration does (rooms, doors,
    sides left open, pieces moved by the overlay), and tested against it: the walls between the
    same places of the demo apartment are the integration's. Each spot is weighed against every
    point of every room, the walls counted along each line: in the integration that would take
    seconds for a home of thirty rooms on a small host (D-001 keeps the Python side free of
    geometry; the locating needs its own), in the page milliseconds. Nothing is sent outside Home
    Assistant (D-022); nothing is kept but the access points.
  - **Said to be a model.** The sheet says so: from the plan's walls, doors and floors, what was
    measured first. Furniture, what walls are made of and how thick, a fridge or a mirror, and
    the outdoors are not in it.
- **Consequences.**
  - `domotwin/locating/get` gives each receiver's `place` and what was learned (`heard`), to
    administrators only.
  - DomoTwin's settings gain `access_points`, checked by the integration.
  - The analysis module grows by the model; the first load by the layer's name and the coverage
    scale. The sheet is a chunk of its own, with its texts in both languages.
  - An open menu of the view stands over the layers' sheets: the coverage's sheet is tall enough
    to cover the layer menu, the network map's could be.
  - Thread and Matter, Zigbee2MQTT, Z-Wave, Wi-Fi at 5 or 6 GHz and a heat map inside a room are
    left for later.

## D-067 · Guest access: a pass, DomoTwin's own page, chosen rooms and devices for a while (M33)

M33, moved forward by the maintainer from after 0.5.0 (D-056), after the placement advisor (M31, D-066);
per-person rights (M34) next to it.

- **Context.** A guest (a friend staying the weekend, a sitter, a holiday let's tenants) needs
  the Wi-Fi, the lights and blinds of a room or two, maybe the front door, for a few days, and
  nothing else. Home Assistant gives each of its users every entity (its permissions are by user,
  not by entity); a user can be local only and read only, which it enforces. Guest Mode (HACS
  default) makes temporary sign-in links to a Home Assistant user, who then sees the whole home.
  D-056 asked (❓4): a page of DomoTwin's own outside Home Assistant's sign-in, enforced by
  DomoTwin, or Home Assistant users only. The maintainer asked for M33 and M34 to be carried
  through without waiting: the answer is the first, the only one that gives chosen rooms and
  devices, with what it costs said plainly, after a security review. Home Assistant users for
  guests stay possible, with Guest Mode; they are not DomoTwin's.
- **Decision.**
  - **A pass**, kept in a private store of its own (`.storage/domotwin.guests`): who it is for,
    the rooms it opens, the devices it gives (at most 100, of the domains a guest may use or read:
    lights, switches, covers, valves, fans, thermostats, water heaters, humidifiers, sirens, media
    players, locks, vacuums, mowers, scenes, scripts, buttons, sensors, binary sensors, weather;
    never a person, a tracker, a camera, an alarm panel or an automation), from and until when (at
    most 31 days, starting within a year), whether the guests may use the devices or only look,
    whether the home's Wi-Fi (D-060) is shown, and whether it opens only on the home's network
    (the default) or from anywhere. At most 20 passes; one ended 30 days ago is forgotten.
    Administrators make, change, renew and remove them (`domotwin/guests/*`); nobody else reads
    them: a pass's link is its key.
  - **Its link**: `/api/domotwin/guest/<secret>`, a secret of 32 random bytes
    (`secrets.token_urlsafe`), and its QR code, drawn in the page by the analysis module
    (`textQr`, D-043). Its address is Home Assistant's own on the home's network for a pass that
    opens there (`get_url`, internal), its external one otherwise, the page's own when Home
    Assistant knows neither. A new link replaces the old one, which then opens nothing; a pass
    removed, the same.
  - **DomoTwin's own page**, served by the integration outside Home Assistant's sign-in
    (`requires_auth = False`), each request checked: the secret is a pass's; the pass opens now
    (else when it opens, or when it ended); the request comes from the home's network (a local
    address, not through Home Assistant Cloud, as Home Assistant checks its local-only users)
    unless the pass opens from anywhere. The page (`guest.html`) loads DomoTwin's own module and
    nothing else, under a policy that allows only its own files (`Content-Security-Policy`), in no
    frame, never kept (`no-store`) or indexed, sending its address nowhere (Home Assistant's
    `Referrer-Policy: no-referrer`).
  - **What it reads** (`…/home`): the storeys with a room the pass opens; every room's outline,
    partitions, doors and windows, so that the walls are as they are; the other rooms unnamed,
    their pieces left out, closed as private rooms are (D-039), for nobody; the pieces of the rooms
    it opens and their 3D files (`…/models/<file>`, those only); no viewpoint; the plans named
    after the home. The links of its devices in the rooms it opens, DomoTwin's own taps only
    (toggle, controls), no room's own action; the states of its devices only, without their
    context, which names Home Assistant's users; their areas; the Wi-Fi, its password with it, when
    the pass shows it. Home Assistant's time zone and unit of temperature; not its version, its
    place or its users.
  - **Followed** (`…/events`, server-sent events): its devices' states as they change; the page
    reads the home again when the plan, the links, the settings, the Wi-Fi or the pass change,
    and is told when the pass ends. At most 8 pages a pass.
  - **What the guests do** (`POST …/call`): only on the pass's devices, only the services a guest
    may call on each kind, with the data each takes and nothing else: on, off and toggle (DomoTwin's
    switches); a light's brightness, colour and white; a fan's speed; a cover's position; a media
    player's playback and volume; a thermostat's target; a lock locked and unlocked, never with a
    code; a scene or a script run without variables; a button pressed; a vacuum's or a mower's
    start, pause and dock. Refused for a pass to look at; at most 20 actions in 5 seconds a pass.
    Each is fired as an event (`domotwin_guest_action`) in the context the action then runs in, so
    that Home Assistant's logbook says the pass's name (`logbook.py`), and "Why?" (D-059) too.
    Home Assistant's refusal is said as it gives it.
  - **The page**: the home in 3D on DomoTwin's own card, on a `hass` of the guest's (nobody's
    user, as a shared screen's, D-039) whose connection answers DomoTwin's commands from what the
    pass shows and refuses everything else; nothing hands over to Home Assistant's pages, dialogs,
    history, automations or schedules. Below it, the pass's devices room by room with DomoTwin's
    own controls (those it gives outside the rooms it opens apart), disabled for a pass to look
    at. The Wi-Fi from the card, or a button of its own when no room is open. In the guest's
    language. Built apart (`guest.js`), so that nothing of it changes how Home Assistant's pages
    load DomoTwin.
  - **For administrators**: *Guest access* in the panel's ⋮ menu: the passes, each with when, how
    much and how it opens; a pass's link and code, to copy or share; the form, where the rooms are
    chosen and their devices listed and ticked (but locks, garage doors and gates), and a device of
    another room added. A chunk loaded when it opens; not in the demo house or the sandbox.
  - **Diagnostics** count the passes by state, and those from anywhere; never their names, links,
    rooms or devices.
- **Consequences.**
  - **Enforced by DomoTwin, outside Home Assistant's sign-in**: whoever has a pass's link uses
    what it gives until it ends, is renewed or is removed, as with Home Assistant's own webhooks;
    a pass from anywhere is used from anywhere. The secret is as hard to guess as Home Assistant's
    own tokens and is sent nowhere, but it is in the address: the guest's browser history keeps
    it, and it opens nothing once the pass has ended. Said in the guide and in the form.
  - A guest sees the rooms' outlines and how many there are; not the names of those the pass does
    not open, what is in them or what they link.
  - A guest has no Home Assistant user: Home Assistant's permissions do not apply to the pass,
    DomoTwin's checks do; nothing else of Home Assistant is reachable through it.
  - The first load grows by the menu item and the client's commands (+1.0 kB gzipped); the dialog
    is a chunk of its own; the guests' page and its chunks are loaded by it alone.
  - Per-person rights (M34) are for Home Assistant's users; a pass is for those without one.

## D-068 · Safety: the alerts on every tab, a Safety tab, the doorbell full screen (M25)

M25, planned in D-054 among M24 to M26, whose order the two weeks of use after 0.4.0 were to
decide. After more imports (M20, D-064), the placement advisor (M31, D-066) and guest access
(M33, D-067), the maintainer asked for safety next, ahead of the weather (M40), locating measured
(M41) and an iPhone's key (M45) that D-065 put before M24 to M26, and of M24 and M26. It follows
D-056's rule, as M23b did: Home Assistant's own Security page opened rather than copied where it
has it.

- **Context.** D-054 planned the cameras side by side, the doorbell full screen when it rings, the
  alarm, and the alerts the 3D view shows (D-023) on every tab. Since, Home Assistant has a
  Security page of its own, and alerts chosen on it. Checked in Home Assistant's code at the
  versions its releases pin:
  - **The Security page**: a `security` panel, registered without a place in the sidebar since
    2025.11 (an experiment then, `async_register_built_in_panel(hass, "security")`) and still in
    2026.10 (`show_in_sidebar=False` since 2026.3). It shows the cameras (as picture cards, in
    their area among the rest), the alarm panels, the locks, the doors, windows and garage doors,
    the safety sensors (smoke, gas, carbon monoxide, moisture, glass break, safety, tamper) by
    floor and area, and the activity of the last 24 hours (`security-view-strategy.ts`,
    frontend 20260930.2); its back button comes with `?historyBack=1`, which its Overview opens
    it with (`home-overview-view-strategy.ts`), since 20251203.0.
  - **Its alerts** (frontend 20260826.4, Home Assistant 2026.9): an administrator chooses entities
    on the page (*Edit security and safety page*, *Active alert entities*), each with a severity,
    *Alert* or *Warning*, kept in Home Assistant's system data (`frontend/get_system_data` and
    `frontend/subscribe_system_data`, key `security`: `alert_entities`, a list of
    `{entity, severity?}`), which any signed-in user may read (2025.12 and later). An alert is
    on when its entity is: an alarm panel `triggered`, a cover `open`, a lock `jammed`,
    `unlocked` or `open`, anything else `on`. Without a severity, an alarm panel and the binary
    sensors of the danger classes (carbon monoxide, gas, glass break since 2026.10, moisture,
    safety, smoke) are *Alert*, the rest *Warning* (`security-alerts.ts`). Since 2026.10, the
    Overview shows those of severity *Alert* that are on.
  - **Doorbells**: an `event` entity of the `doorbell` class (2023.8 and later; its state is when
    it last fired, `isoformat`), given by UniFi Protect, Ring, Nest, DoorBird, August, Yale,
    Axis, SwitchBot, HomeKit devices, Hue, SimpliSafe, Homematic IP and UniFi Access in 2026.10
    (their `event.py`), and by ESPHome devices that declare one. Home Assistant gives the last
    time back when it starts (`RestoreEntity`).
  - **Cards** (frontend 20250103.0, Home Assistant 2025.1): the picture-entity card takes
    `camera_view` (`auto`: a still Home Assistant refreshes; `live`: the stream), the alarm-panel
    card, and the tile card's `lock-commands` feature are there.
- **Decision.**
  - **The alerts on every tab.** Above the *Home* and *Rooms* tabs, a bar says the alerts the 3D
    view's banner says: the rooms' (D-023) of the storey shown, then those of the other storeys
    (D-026), dangers first, two at most, then *and N more*, which opens the *Safety* tab. A
    room's opens the 3D view and frames its room, its storey shown first, as a tap in the 3D
    view's banner does (`frameAlert`); where the 3D view cannot draw, its room's page (its
    area's page of the Overview, D-061, else *Rooms*). The Home tab's alerts chip goes: the bar is
    above it. Of a private room the viewer may not see (D-039), only the dangers, on another
    storey too (the 3D view's banner told the warnings of other storeys' private rooms until now).
  - **Home Assistant's alerts, read, not copied.** Where Home Assistant keeps them (2026.9 and
    later, with its Security page), the panel follows the alerts chosen there
    (`frontend/subscribe_system_data`) and says those on now in the same bar, in the 3D view's
    banner and on the *Safety* tab: `{name}: {state}`, the state in Home Assistant's words
    (`formatEntityState`), red for *Alert*, amber for *Warning*, Home Assistant's defaults without
    a severity. A tap opens Home Assistant's Security page. An entity that raised a room's alert is
    said once, as the room's, which says where. Of a private room the viewer may not see, only the
    dangers. DomoTwin chooses nothing itself and writes nothing in Home Assistant's system data;
    not in the demo house or the sandbox, whose devices are not the home's; not for a card.
  - **A Safety tab**, `/domotwin/safety`, between *Rooms* and *3D*, always offered, a tab to open
    on like the others (the integration's choices take `safety`). From the top: every alert (or
    that all is calm); each alarm panel as Home Assistant's alarm-panel card; each doorbell and
    when it last rang; every camera side by side, as Home Assistant's picture-entity card
    (`camera_view: auto`, its name, no state), the doorbells' first (the one rung last first),
    each labelled with its doorbell, then the others by name; where Home Assistant has no
    Security page (before 2025.12), the locks as tiles with their buttons; where it has one, a way
    to it for the locks, the doors and windows, the sensors and the activity, which it shows and
    DomoTwin does not copy. Hidden entities and those of an entity category are left out, and
    what a private room the viewer may not see holds. Live streams are kept for Home Assistant's
    own dialog (a tap) and the doorbell's full screen: a phone's data and a small host's
    processor are spared. It is part of the tabs' chunk (D-055), with its texts.
  - **The doorbell, full screen.** The panel watches the home's doorbells (events of the
    `doorbell` class, not hidden), whatever tab shows: a ring is a newer time than the doorbell
    said when first seen, two minutes old at most by the device's clock (Home Assistant's own
    relative times take it to be right; a device more than two minutes off misses the rings), so
    that the time given back as Home Assistant starts, and a ring heard while the page was asleep,
    do not ring. The doorbells are looked for among the events of the entity registry, read again
    when it changes, and at each new set of states, as an event's state may come after its entry.
    A ring heard before the settings are read (who may see what, D-039) waits for them. It shows full screen, over
    every tab and tool (`position: fixed`, an `alertdialog` that takes the focus): *Someone is at
    the door*, the doorbell and when; its camera live (`camera_view: live`, a tap doing nothing),
    the camera of the doorbell's own device, else the only camera in its area; the lock of its
    door as a tile with its buttons, the lock of the doorbell's device, else the only lock in its
    area; *Close*. It goes after two minutes, when closed or on Escape; a new ring shows it again.
    Its screen is a chunk loaded at the first ring; only the watch is in the first load. Not over
    the demo house or the sandbox, homes of their own; not a doorbell, camera or lock in a private
    room the viewer may not see. A binary sensor said to be a doorbell (Reolink's *visitor*) is
    not watched.
  - **What the card shows is unchanged**: the alerts' bar, the Safety tab and the doorbell are the
    panel's. The doorbell on a dashboard's card, a wall screen's, comes with the wall screen
    (M26).
- **Consequences.**
  - The tabs are four; on a phone, four at the bottom.
  - The first load grows by the watch of the doorbells, Home Assistant's alerts, the alerts' button
    the 3D view's banner shares with the other tabs, and the tab's name;
    the Safety tab is in the tabs' chunk, a chunk shared with the doorbell's full screen carries
    Home Assistant's cards and the safety texts.
  - A home's alerts read the same everywhere in the panel: one list, worked out from the states,
    the rooms of every storey and the alerts Home Assistant keeps.
  - The demo house has no camera, doorbell or alarm: its Safety tab shows its alerts.
  - The roadmap shows M25 done after M33; D-065's order goes on for the rest: M40, M41 and M45,
    then M24 and M26.

## D-069 · History and energy, with Home Assistant's own cards (M24)

M24, planned in D-054 and held to D-061's rule (Home Assistant's own pages opened where it has
them); the maintainer asked for it ahead of the order D-065 gives it (the weather, M40, locating
measured, M41, and an iPhone's key, M45, first), which stays for the rest.

- **Context.** The practical side (M23) shows each room's devices as Home Assistant's tile cards;
  the history reports (M38) read Home Assistant's history as tables. What a room measured, as a
  graph, and the home's energy over time were left to M24, to be made of Home Assistant's own
  cards, or its pages opened, never drawn by DomoTwin (D-054). Checked when built, in Home
  Assistant's frontend at 2025.1 (20250103.0), 2025.10 (20251001.0), 2026.2 (20260128.6) and
  2026.10 (20260930.2), and its core at 2025.1.0 and 2026.10.0.
- **Home Assistant, checked.**
  - The **history-graph** card takes `entities`, `hours_to_show` and `title` in every one of
    them; it draws a line for each unit and a timeline for the rest. In 2025.1 it reads the
    history alone (10 days kept by default); 2026.10 fills older days from the statistics.
  - The **statistics-graph** card takes `entities`, `days_to_show`, `period` (`hour`, `day`),
    `stat_types` (`change`) and `chart_type` (`bar`) in every one of them: what a meter added
    each hour or day.
  - Its **History** page reads `entity_id`, `start_date` and `end_date` from its address (the
    history reports open it so already, D-058).
  - Its **Energy page** is the `energy` panel, which its energy integration (in `default_config`)
    registers for every user, with no administrator needed, in 2025.1 and 2026.10. Its energy
    cards read that integration's preferences (`energy/get_prefs`): wherever they would work,
    the page is there. With `historyBack=1` in its address it shows a back arrow (2025.10 and
    later), which leads to `backPath` (2026.2 and later), as the Overview opens it; before,
    the browser's back. Until a source, a device or water is set up (`energy/get_prefs`, which
    every user may read, answers `not_found` when nothing was ever saved), it shows its setup
    wizard alone; the Overview shows its energy summary only once a grid is set up.
  - The Overview's area pages (D-061) show no graph.
- **Decision.**
  - **A room's graphs**, a page of the Rooms tab (`/domotwin/rooms/<area>/graphs`): *Graphs* on
    the room's page, and on its panel in 3D (a long press), beside its history report (D-058),
    when its area has something to graph; opened from 3D, the room's way back still leads there. Home Assistant's own cards, one for
    each kind of measure of the room's area (its device class, else its unit): the sensors with
    a unit or kept as statistics, the thermostats with the temperatures (Home Assistant draws
    their room and target temperatures and when they heat), the doors and windows, and the
    presence. Temperature, humidity, CO₂ and particles first, then the others, power and energy
    among them, then the meters (`total_increasing`, `total`: bars of what each hour or day
    added, `statistics-graph`), then the doors and windows and the presence (timelines). Eight
    entities a card at most, by name, ten cards a room. Hidden, configuration and diagnostic
    entities left out, as in the Rooms tab; nothing of a private room the viewer may not see,
    nor what is linked to it (D-039).
  - **The last 24 hours or 7 days**: what Home Assistant keeps of each change by default, so
    that 2025.1 draws them too. *As a table* opens the history report (D-058) of the same
    sensors (eight at most) over the same period, over the Rooms tab; *In Home Assistant's
    History* opens its page on the same entities and period.
  - **The Energy tab**: Home Assistant's Energy page, opened rather than copied, where it has
    one with something set up (read once a connection): a tab beside Rooms whose address is the
    page's, `historyBack=1&backPath=` the page of DomoTwin it was left from. No tab of energy
    cards: where they would work, the page is there. No tab while only the setup wizard would
    show: setting the energy up is Home Assistant's, in its settings.
  - **The demo house** (D-050): Home Assistant's cards and pages do not know its entities, so
    its graphs are DomoTwin's own rows, what each sensor says now, its table answers from its
    day, and its Energy tab is DomoTwin's own picture of its energy, the 3D view on the power
    layer with the energy at a glance (D-049). Neither in the sandbox (D-057), whose day has its
    report, nor where Home Assistant has no Energy page or nothing set up on it.
- **Consequences.**
  - Nothing new in the integration, nothing stored: the cards and the pages read Home
    Assistant's recorder for the viewer, as its dashboards do. The panel asks for Home
    Assistant's energy settings once a connection, to know whether to offer the tab.
  - The first load grows by the Energy tab, its address and its word; the graphs come with the
    Rooms tab's chunk.
  - Replay, the home's past in 3D (M19), stays a 3D feature, later.
  - The energy of each room over the week, on the plan, comes with the weekly report (M37).
  - The roadmap shows M24 done after M20, M31, M33 and M25; M40, M41 and M45 come next, as D-065
    orders them.

## D-070 · Automations in plain words, played in the sandbox first (M35, amends D-057)

M35, moved forward by the maintainer from the way to 0.6.0 (D-056), after the sandbox (M29,
D-057) it plays its drafts in; the rest of the order (D-056, D-065) keeps its place.

- **Context.** Saying what one wants ("when the last person leaves, switch the lights off and lock
  the door") is easier than writing an automation, and an automation written by a model has to be
  read and tried before it runs at home. Home Assistant's AI task (2025.8) gives structured
  answers from the agent the user chose; its "Suggest with AI" names an automation but does not
  write one; the integrations that write automations call a provider of their own and try
  nothing (D-056, item 7). Checked in Home Assistant's core at 2025.1.0, 2025.8.0 and 2026.10.0,
  in October 2026:
  - **`ai_task.generate_data`** (2025.8 and since): `task_name`, `instructions`, `entity_id` (else
    the one `ai_task/preferences/get` names, `gen_data_entity_id`; refused when there is none),
    `structure` (fields, each a selector, `required` or not), answered only with a response
    (`return_response`): `{conversation_id, data}`, `data` the fields asked for. Every user may
    call it; `ai_task/preferences/get` is open to every user. An entity that generates data has
    the feature 1 (`GENERATE_DATA`).
  - **`validate_config`** (websocket, every user, the same in 2025.1 and 2026.10): `triggers`,
    `conditions`, `actions`, each answered `{valid, error}` by Home Assistant's own validators:
    the form and the integrations' rules, not whether an entity exists.
  - **The configuration API** (`POST /api/config/automation/config/<id>`, administrators): checks
    the whole automation, writes `automations.yaml` and reloads it; a bad one is refused with
    "Message malformed: …". Home Assistant's editor makes a new automation's id from the time
    (milliseconds), and opens a draft of its own only from inside its frontend:
    `/config/automation/edit/new` opens empty, its YAML mode takes a configuration pasted (JSON is
    YAML).
  - **What Assist may see** (`homeassistant/expose_entity/list`): people and locks are not
    exposed by default, nor most sensors: an automation of the most common kind could not be
    written from the exposed entities alone.
- **Decision.**
  - **The way in**: *An automation in plain words* in the panel's ⋮ menu, for administrators
    (Home Assistant saves automations for them only), and only where Home Assistant has an AI
    task that generates data. Without one, nothing is offered: DomoTwin calls no model itself.
    Not in the demo house, which has none, nor in the sandbox, a copy of the home. The dialog is a
    chunk loaded when it opens, with its texts in both languages.
  - **What one says**, in any language, then **Write it**: the AI task the user prefers in Home
    Assistant writes it (another can be chosen when there are several).
  - **What the AI task is given**, said in the dialog before it is sent: the request; what
    Home Assistant's automation editor saves, in short; the home's areas and entities, each its
    id, name and area, with what helps write it (a sensor's kind and unit, a select's options, a
    thermostat's modes), and the actions of their domains (with `notify` and
    `persistent_notification`). Not their states: nobody's whereabouts, nothing on or off. Left
    out: hidden entities, those of a category (configuration, diagnostics), and those of a private
    room the viewer may not see (D-039, `unseenOf`, as the reports): nothing is asked of the AI
    task before the panel has read the settings, the plan, its links and the other storeys' rooms
    that say which those are. At most 1 000 entities, those in an area first. Where the AI task
    sends it then is the AI task's: a service on the internet gets it, and the dialog says so.
  - **The answer asked**: three texts, `name` (in the request's language), `automation` (the
    automation as one JSON object: `triggers`, `conditions`, `actions`, `mode`) and `notes` (what
    it assumed or could not do). Read leniently (code fences and text around the object left
    out; an object given as such; an answer that is the automation alone), and refused when it
    is not one object with a trigger and an action. Its `id` and `description` are dropped: the
    description saved is the request, in the user's words, with each change asked since. Of its
    other keys only those Home Assistant's automations take are kept (`variables`,
    `trigger_variables`, `max` from two, `max_exceeded`, `trace`; it refuses any other), the rest
    said to be left out; not `initial_state`, so that it is saved on.
  - **Said back in plain words**, by DomoTwin from the configuration, never from the model's own
    words: *When* each trigger, *Only if* each condition, *Then* each action, in order and nested
    (choose, if, repeat, parallel, waits), in the user's language; entities, areas and devices by
    their names, states as Home Assistant says them (`formatEntityState`), times and durations
    in words. What has no words of its own is said by its kind and its settings in short. The
    model's notes are shown apart, as its words.
  - **Checked with Home Assistant**: `validate_config` on its triggers, conditions and actions,
    each refusal shown where it is; and, since Home Assistant's check does not, every entity,
    area, device and floor it names is looked up, and every action it calls among Home
    Assistant's actions (`hass.services`): what Home Assistant does not have is marked in the
    words and listed. Labels, whose registry the frontend does not have, are said by their id.
    Checked again when the dialog opens again (a check that failed, a name added since), and on
    *Check again*.
  - **Changed by asking**: *What to change* sends the request, the draft and the change to the AI
    task again, which answers the whole automation; the draft then starts over (checked again,
    played again). The name can be edited by hand. *Copy* gives its configuration, and Home
    Assistant's editor is a tap away to paste it in.
  - **Played in the sandbox (M29)**: *Play it in the sandbox* opens the sandbox with the draft
    added to the copy as an automation of its own, on, beside the home's automations, its wires
    shown on the plan as the automation wires (D-032) and pulsing when it runs. The sandbox's bar
    says it is a draft and what it did on the day played; its report puts it first (its runs,
    why it never ran, what it worked against). Each day played (picked in *The day*: its date, its
    weather, who goes out; what is done by hand in it is that day's, played again) is kept with
    what the draft did that day, the latest ten, once the sandbox is shown. *Back to the draft*
    leaves the sandbox for the dialog, which lists them.
  - **The sandbox's home zone** (amends D-057): `zone.home` counts who is in it as the day's
    people go out and come back, its `persons` too, as Home Assistant's zones do, after the
    people's own changes of that minute. "When the last person leaves" is a zone back to `0`: the
    copy did not move it before, and such an automation never ran there.
  - **Only then saved**: *Save* is offered once Home Assistant found nothing wrong, every name is
    one Home Assistant has, and the draft as it is now was played in the sandbox at least once.
    Saved as Home Assistant's editor saves (a new id, its time in milliseconds; the configuration
    API), switched on, once: the save is the draft's, not the dialog's, so that a dialog closed
    and opened again does not save it twice; Home Assistant's refusal is shown as it gives it.
    Then *Open in Home
    Assistant's editor* (`/config/automation/edit/<id>`). The configuration history (M36) keeps
    it from then on.
  - **Kept in the page**: the draft lives while the panel is open, across the sandbox and back;
    gone when the page is closed or the draft forgotten. Nothing stored by DomoTwin, nothing in
    the integration or the diagnostics.
- **Consequences.**
  - Nothing new in the integration: the frontend calls Home Assistant's own service and commands.
  - On Home Assistant before 2025.8, or without an AI task, the menu has no such item.
  - A model can still write something odd; the words, the checks and the sandbox are there to
    show it before it is saved, and what the sandbox cannot play is said, as for the home's own
    automations.
  - The first load grows by the menu item, its text and whether there is an AI task; the dialog
    and its words come on demand, and the sandbox's chunk by the draft's part.
  - The roadmap shows M35 done after M24; the rest of the order (D-056, D-065, D-067, D-068,
    D-069) stays.

## D-071 · Per-person rights: what DomoTwin shows each person and lets them do (M34)

M34, moved forward with guest access (M33, D-067) at the maintainer's request.

- **Context.** In a family home one screen is everyone's and a tablet is a child's; a
  housemate's room is theirs. Home Assistant gives each of its users every entity (its
  permissions are by user, administrator or not, not by entity), and roles are its most asked-for
  feature (D-056); what exists either hides dashboards (kiosk-mode, browser_mod), rewrites Home
  Assistant's groups' policies (Access Control Manager), patches it (user-rbac) or stands in
  front of it as a proxy (ha-rbac). Private rooms (D-039) already close rooms for some people in
  DomoTwin. D-056 asked (❓5): what DomoTwin shows and does only, or a way to enforce rights that
  touches Home Assistant. The maintainer asked for M34 to be carried through without waiting: the
  answer is the first, said plainly where the rights are set. Patching Home Assistant, rewriting
  its groups or proxying it is not proposed: it would break with its releases and is not
  DomoTwin's to change.
- **Decision.**
  - **Levels**: a room or a device is used (`use`, the default), only seen (`see`) or not seen
    (`hidden`). Kept in the home's settings (`settings.rights`): everyone's (`everyone`) and each
    person's own (`people`, by `person` entity), each `{rooms: {room id: level}, entities: {entity
    id: level}}`; at most 50 people, 200 rooms and 500 devices each, checked by the integration
    (`validation._rights`). Set by administrators, as the other settings.
  - **Whose**: a person's through the Home Assistant user of their `person`, as private rooms
    find them (D-039); everyone's for a user who is nobody's (a shared screen's), and for what a
    person's own leave unset. Not for administrators: they set the rights, and Home Assistant gives
    them everything; nor for the demo house, the sandbox or a guest's page (D-067), whose `hass`
    is DomoTwin's own.
  - **A device's level**: its own when it has one (the person's, else everyone's), else the
    strictest of the rooms it is in. It is in a room when it is linked to the room or to a piece,
    door or window that names the room (its overlay's first), or when its area is the room's (the
    room's link, else the area of its name). A room not seen, or private and closed to the viewer
    (D-039), hides everything in it, whatever their own level. The same rule in the integration
    (`rights.py`) and the page (`live/rights.ts`).
  - **In the page**: the rooms not seen join the private ones closed to the viewer
    (`closedRooms`), so that everything D-039 does for those (the engine's closed rooms, the
    people out of sight, the Home and Rooms tabs' areas and entities, the Safety tab and the
    alerts (D-068), a room's graphs (D-069), `domotwin.show`) holds for them; the devices not seen are unlinked from what the view shows outside those rooms
    (`Gate.shown`; inside, the view closes them whole, their dangers still shown) and left out of
    the tabs, the sheets, "Why?" and the reports' search. The panel and the card give
    their views a `hass` of the viewer's (`gatedHass`): `canAct` and `canSee` say what they may
    do and see, and a call on a device they may not use is refused before Home Assistant
    (`not_allowed`). DomoTwin's controls read them: a row's controls disabled, a tap on a piece
    opening DomoTwin's own panel rather than Home Assistant's dialog, Home Assistant's cards made
    to do nothing on a tap (`lookOnly`, the doorbell's lock too), a room's commands and own
    actions and the Home tab's lights off on what may be used only, no action set or cancelled for
    later.
  - **In the integration**: an action set or cancelled for later (`domotwin.schedule`, the
    sheets, the voice assistants) by a user who may not use one of its devices is refused
    (`not_allowed`); the actions waiting on what a user does not see are not listed to them, nor
    said by the assistants; `domotwin.where` and `domotwin.show` treat a room hidden from the one
    asking as a private room. A question by voice with no user (a satellite's) is nobody's, with
    everyone's rights, for the assistants' tools as for `domotwin.where`; an action set by an
    automation or a script (no user) is Home Assistant's own, held to no one's. The rooms' people
    sensors, everyone's entities, say nothing of a room hidden from everyone.
  - **For administrators**: *Rights* in the panel's ⋮ menu, in one place: everyone's, then each
    person's own, room by room on every storey with each room's devices, and devices in no room;
    a sentence of what the person uses, only sees and does not see; an administrator, or a person
    with no user, said as such (`config/auth/list`). A chunk loaded when it opens.
- **Consequences.**
  - **DomoTwin's own, not enforcement**: Home Assistant still lets every user use every entity in
    its other dashboards, its API and its voice assistants. Said in the dialog and the guide:
    rights keep a shared screen or a child's tablet to what is theirs, not behind a security
    barrier. Real enforcement needs Home Assistant.
  - The rights are read by every user, as the home's other settings.
  - Private rooms (D-039) stay as they are, for everyone, administrators too; rights add to them
    for those who are not administrators. A device in a private room closed to a user who is not
    an administrator is not set for later by them either.
  - Guest access (D-067) is for those without a Home Assistant user; rights for those with one.
  - The first load grows by the gate and the menu item; the dialog is a chunk of its own.

## D-072 · A weekly home report: written by the integration on its day, read in the panel (M37)

M37, moved forward by the maintainer from the way to 0.6.0 (D-056), after Hydro-Québec's peaks
(M39, D-063), whose week it reports. It waits on nothing the milestones before it build.

- **Context.** What needs a look in a home is spread over Home Assistant: its repairs and
  updates, the batteries of its Maintenance page (2026.5 and later, batteries only), the devices
  unavailable on their own pages, the automations that failed in their traces; and over
  integrations of HACS's default lists: Battery Notes (the batteries and what they take),
  Watchman (the entities and actions the configuration names that do not exist), Spook (its
  findings, as repairs). Nothing found says it once a week, with what changed since, room by room
  (D-056, item 9). What they give was checked in their code in October 2026: Home Assistant
  2026.10.2 (its traces, repairs, AI task, update entities, energy settings, statistics and
  notifications, and the Maintenance page of its frontend 20260930.4),
  [Battery Notes](https://github.com/andrew-codechimp/HA-Battery-Notes) 3.7.2,
  [Watchman](https://github.com/dummylabs/thewatchman) 0.8.6 and
  [Spook](https://github.com/frenck/spook) 5.11.1.
- **Decision.**
  - **Written by the integration**, once a week, on the day and at the hour an administrator
    chose (Monday at 8 by default) where the home is: no screen needs to be open. It is looked
    for every hour, on the hour: a week missed (Home Assistant stopped at the hour) is written
    once Home Assistant has started again, within the week; a home that has just installed
    DomoTwin waits for its first day. One can be written by hand from the page: it is kept, but
    neither told nor counted as the week's.
  - **What needs a look**, as it stands when written, read from what Home Assistant and the
    integrations installed say, rather than worked out again:
    - *batteries low*: Battery Notes' low-battery sensor where it watches a device (its own
      threshold, the battery to buy, the level its sensor says); else, as Home Assistant's
      Maintenance page counts them, a battery sensor at the level chosen (20 % by default) or
      below, unless its device is charging, or a battery binary sensor on; one a device;
    - *devices unavailable*: a device all of whose entities have been unavailable for an hour at
      least, and since when (the report before says it across a restart, which starts Home
      Assistant's states again);
    - *updates waiting*: the update entities that are on (one skipped is off);
    - *repairs waiting*: what Settings → Repairs lists (active and not ignored), titled as it
      titles them, in the home's language, Spook's among them; and what Watchman finds missing,
      from its sensors' lists (read live: Home Assistant does not record them);
    - *upkeep due* (D-033): tasks due soon or overdue, warranties in their last 30 days;
    - *automations*: those whose runs failed this week, from Home Assistant's traces (an error,
      not a condition that was false; the last five runs of each automation unless set
      otherwise, kept across a restart); those that cannot run (unavailable: their
      configuration is invalid); those turned on that have never run, made a week ago at least
      (the entity registry says when);
    - *Zigbee devices on a weak link* (M9b): ZHA's devices as `zha/devices` answers them, by the
      network map's rules (D-031, D-043): each device's widest way to the coordinator, weak below
      an LQI of 80, or none at all. ZHA's insides may change: a ZHA that does not answer as it
      did is left out, and the network map still reads it. The placement advisor's weak spots
      (M31) are worked out in the page from the plans' walls (D-066): the integration, which
      writes the report, does not work them out again; the radio coverage shows them.
  - **The week's energy** against the week before: the seven days to the midnight before the
    report is written, and the seven before them, from the recorder's hourly statistics (their
    change, in kWh). The home's, from Home Assistant's energy settings (both shapes of their grid:
    one connection since 2026.3, lists before): what it used (from the grid, the sun and the
    battery, less what went back), what it drew from the grid, what the sun gave. Each room's,
    from the individual devices of the energy settings in it (one counted in another's left out),
    or, where the settings name none, from the energy meters of its area (the home's own and
    Utility Meter's copies of another left out).
  - **The week's Hydro-Québec peaks**, where an integration reads them (D-063): when its on/off
    sensors said a peak was under way (their history), and the peaks hydroqc wrote in a calendar
    (Home Assistant's own Local Calendar, or one whose event bears its mark now: no calendar of an
    online service is asked); for each, what the home drew from the grid and each room drew.
  - **Room by room**: an item is in the room of the element linked to it or to its device (a
    piece, a door, a window or a partition that names its room, a room), else in the first room
    whose area is its entity's or its device's, as the layers read the rooms' areas (D-023). An
    item in no room is said in its section only.
  - **Private rooms** (D-039): the page closes a room its viewer may not see now, as DomoTwin's
    views do: drawn closed, nothing of what is in it shown (counted only), its energy and its
    part of the peaks left out. The report itself keeps every room: whether one is private
    depends on who looks, and when. The page is for administrators, whom the rights (D-071) do not
    hold. The AI task, whose summary goes to every user, is not told a room closed now for nobody:
    private, or hidden from everyone by the rights, as the rooms' sensors (D-071); the
    notification names no room.
  - **What changed since the last**: an item is new when the report before did not have it (its
    key stays the same while it is the same thing to look at: an update waiting, whichever version
    it waits for); what the report before had and this one has not is listed as done. The week's
    report is compared with last week's, one written by hand with the last.
  - **Kept** in a store of its own (`.storage/domotwin.reports`, private) with the settings: the
    last eight weeks' reports and the last two written by hand, so that writing by hand does not
    push the weeks out; a hundred items a section (the others counted). One report is written at
    a time: the hour and a week caught up coming together write it once, and DomoTwin unloaded
    while writing keeps nothing. Never in the diagnostics
    but its settings and how many reports are kept; deleted with the integration.
  - **Told** by Home Assistant's notification, replaced by the next one, which an administrator
    can turn off: the week, the summary, a line for each section, a link to the report in the
    panel. Home Assistant shows its notifications to every user and cannot keep them to
    administrators: a line names what every user may see in Home Assistant (batteries, devices,
    updates, repairs, upkeep) and counts the automations and the radios, which only
    administrators may read. An event, `domotwin_weekly_report` (the report's id, its week, the
    counts, the summary, the link), lets one's own automations send it on, to a phone.
  - **Summed up by an AI task**, only when an administrator chose one (Home Assistant 2025.8 and
    later): `ai_task.generate_data`, asked for three to five sentences in the home's language from
    the report's facts in plain lines, the automations and the radios counted as the notification
    it goes into counts them; waited for two minutes at most, its refusal kept as it gives it. Not
    a conversation agent, which might act on the home instead of writing (as D-056 chose for M35,
    and D-070 built); not by default, since the facts go to the agent the administrator set up,
    which may be an online service, as the settings say. Without one, the lists are the report. The
    page lists the AI tasks as the plain words' dialog does (`live/ai-task.ts`).
  - **The page in the panel**: *Weekly report* in the ⋮ menu, for administrators, since the report
    holds what only they may read (its commands refuse anyone else); a chunk loaded when it opens.
    The week shown and those kept; the summary; what needs a look, by section and room by room on
    a drawing of each storey's plan, made in the page from the rooms' outlines (each room tinted
    by how many things need a look in it, its week's energy written; a room picked shows only
    what is in it), so that it reads as a page, on a phone and without WebGL too; each item
    opening where Home Assistant shows it (a device's page, an entity's dialog, the repairs, an
    automation's trace or editor; the Maintenance page for the batteries) or framed in 3D; the
    energy as a table; the peaks; what was done; the settings. The notification's link opens the
    report it names. The demo house has reports of its own, made up for its rooms, another one
    written in the page; the sandbox has none.
- **Consequences.**
  - The integration reads Home Assistant's registries and states, its traces
    (`trace.util.async_list_traces`, 2024.11 and later), its issue registry, energy settings and
    recorder, and ZHA's own helpers, each guarded: what cannot be read is left out of the report,
    the rest is written. The manifest names `energy`, `recorder`, `trace` and `zha` among its
    `after_dependencies`, as hassfest asks of what an integration imports: none is needed, and
    one that is configured is set up before DomoTwin.
  - A run that failed and has left the five traces kept by the time the report is written is not
    counted; a crash loses the traces since the last start (Home Assistant saves them when it
    stops).
  - The first load grows by the menu item and its text; the page comes when opened
    (`PERFORMANCE.md`).
  - The roadmap shows M37 done after per-person rights (M34); the rest of the order stays.
