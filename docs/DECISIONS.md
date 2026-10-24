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
  refuses extra fields, and DomoTwin's exports must stay valid House Maquette plans).
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
  `PERFORMANCE.md`; open formats in and out (the House Maquette plan, IFC, glTF, OBJ, STL, 3MF);
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
  of kinds (unknown ones read as `desk`) and DomoTwin's exports must stay valid House Maquette
  plans, so there is no "camera" or "lock" piece to add; but every element can already be linked
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
    rebuilt when a camera's settings change.
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
  on the rooms' sides, with snapping and lengths, without House Maquette or another program. The
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
    within 6 cm of both ends of the side). A room moves with everything whose `parent` it is. A door or a window is placed on the nearest side of a room
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
