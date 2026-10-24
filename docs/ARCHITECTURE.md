# Architecture

DomoTwin has three layers. Each one does a single job and talks to the next through a small, typed
interface.

![How DomoTwin is built: the Home Assistant integration, the frontend and the WebAssembly engine](figures/architecture.png)

## Crates

| Crate             | Depends on              | Knows about                         | Never knows about    |
| ----------------- | ----------------------- | ----------------------------------- | -------------------- |
| `domotwin-core`   | `serde`, `serde_json`   | plans, geometry, bindings, states   | GPU, browser, HA API |
| `domotwin-render` | core, `three-d`, `glow` | meshes, materials, cameras, passes  | browser, HA          |
| `domotwin-web`    | core, render, `web-sys` | canvas, JS values, timing           | HA                   |
| `domotwin-ifc`    | `serde_json`            | IFC files, one storey → plan JSON   | core, GPU, HA        |
| `domotwin-models` | `serde_json`, `miniz_oxide` | glTF, OBJ, STL, 3MF → meshes    | core, GPU, HA        |
| `domotwin-planner` | core, `serde_json`     | the plan editor's draft (D-025)     | GPU, browser, HA     |

`domotwin-ifc` is the IFC import (`ifc-import.md`): its own wasm module, loaded only when a `.ifc`
file is imported, writing an ordinary plan that the core then reads like any other.
`domotwin-models` reads the 3D files of user models (D-021): its own wasm module too, loaded only
when a plan shows a piece drawn from a 3D file or one is imported. It writes a compact mesh that
the core fits into the piece (`model_mesh`, `scene::imported`).
`domotwin-planner` is the plan editor's draft (`plan-editor.md`, D-025): its own wasm module too,
loaded only when the plan editor opens; the engine shows each version of the draft.

`domotwin-core` is where the logic lives and where the tests concentrate. It never panics on input:
every reader returns `Result` with a stable error code that the frontend translates.

## Frontend

- `src/entry.ts` is the module Home Assistant loads on every page (`add_extra_js_url`). It only
  defines the custom elements and registers the card in the card picker. The engine, the panel UI
  and the editor are separate chunks loaded on demand.
- `src/engine/` loads the wasm module once per page and wraps it in a typed API. `src/ifc/`,
  `src/models/` and `src/planner/` load the IFC import, the 3D model readers and the plan editor's
  draft the same way, on demand.
- `src/scheduler.ts` drives rendering **on demand** (see the figure below): a frame is requested only when the camera
  moves, a state changes, an animation runs or an edit is dragged; it stops when the engine reports
  that nothing is moving, and pauses entirely when the view is off-screen
  (`IntersectionObserver`) or the tab is hidden (`visibilitychange`).
- `src/live/` is the Home Assistant side of live control: bindings and roles, the default tap and
  long-press actions and running them, the states sent to the engine (only bound entities that
  changed), and the suggestions of the link editor.
- `src/components/` holds the card, the panel, `<domotwin-view>` (one canvas, one engine), the
  panels over the scene (`sheets.ts`: an element's controls, a room's panel) and the link editor;
  the last two are chunks loaded the first time they open.
- `src/i18n/` holds the English and French dictionaries. Every visible string goes through `t()`.

![Render on demand: frames only when something changes, nothing while idle or off-screen](figures/render-on-demand.png)

## Rendering

![From plan to pixels: the reader, the scene in two meshes, the draw passes and the cut-away](figures/render-pipeline.png)

- `domotwin-core::plan` reads the file; `geometry` derives the walls, their heights and the door
  sweeps; `scene` turns the static home into three meshes (opaque, the walls, glass;
  `scene::mesh` packs the vertices) and the moving parts (doors, windows, blinds, curtains) into
  two small ones. A home shown whole has these meshes for each storey (a part with its elevation,
  the elements, rooms, walls and lamps numbered across the home) and a roof over the top one
  (`scene::roof`, D-028); `camera` holds the camera math and the cut-away decision; `bindings` and `live`
  turn entity states into the look of each element and fade towards it (D-016).
- `domotwin-render` uploads the meshes once and draws them with its own shaders (`shaders.rs`):
  the sun shadow map (Balanced and High, day look), the background (sky, ground and grid), the
  opaque home and the walls (their tops alone in neon and blueprint), then glass and contact
  shadows, the glass faces of the walls (neon and blueprint), the outlines of the home
  (`scene::lines`), then the halos of lit bulbs. In the looks that glow, all of it is drawn
  offscreen with 4× MSAA, and a bloom of what glows is added on the way to the screen (D-027).
  The look of every element (glow, greyed out, flash) is a small texture the vertex shader reads;
  `lamps.rs` picks the point lights. `view.rs` runs the camera moves, the 2D switch, the wall
  animations and where the storeys go: each storey is drawn moved by its offset (a uniform), up
  and spread apart in 3D, side by side on the 2D plan, the roof above the top one. See D-014,
  D-016 and D-028.
- `domotwin-web` exposes a small API: `loadPlan` (or `loadStoreys`, with `setSpread`, `setRoof`,
  `storeyLabels` and `storeyPicture`, for every storey at once), `setBindings`, `setStates`, `highlight`,
  `orbit`, `pan`, `zoom`, `setPlanView`, `overview`, `focusElement`, `views`, `showView`, `pick`,
  `screenPoint`, `stats`, `frame`, and for 3D files `modelFiles` (what to fetch) and `setModelMesh`.
- In the frontend, `src/gestures.ts` turns pointer events into drags, pans, pinches, taps and long
  presses, and `<domotwin-view>` applies them, runs the actions and draws the toolbar.

## Data flow

![The four flows: load the home, follow live states, tap and long-press, edit and save](figures/data-flow.png)

1. **Load.** The panel or card calls `domotwin/plan/get` (the storey shown, the ground floor by
   default), `domotwin/bindings/get` and `domotwin/settings/get`, then passes the
   plan, the overlay and the bindings to the engine (`load_plan`). With several storeys, the other
   storeys' plans are fetched too, for their rooms' alerts (D-026); a storey switch loads another
   plan in the same engine, and every storey at once loads them all (`loadStoreys`, D-028). The core reads the plan leniently,
   applies the overlay, builds the geometry, and the renderer uploads batched meshes. Pieces drawn
   from 3D files are boxes until the view has fetched each file once
   (`GET /api/domotwin/models/<sha256>.<format>`), read it with the model module and given its mesh
   to the engine, which builds the scene again.
2. **Live states.** On every `hass` update the frontend keeps only the entities that are bound,
   sends the changed ones to the engine (`set_states`), and the core maps them to visual targets
   (light colour and intensity, cover position, glow, power…). The renderer animates towards the
   targets and asks for frames until they are reached. The layers (D-023) are worked out in the
   frontend from the sensors of each room's area and sent as one small JSON (`set_layers`) when a
   value changes; the floors' shader draws them from a texture of rooms.
3. **Interaction.** Pointer events go to the engine (`pick`) which returns the element under the
   pointer. The frontend runs the binding's action: toggle through `callService`, more-info through
   the `hass-more-info` event, navigation, or the long-press popover.
4. **Edit and save.** In edit mode (`edit-mode.md`) the engine keeps the session: selection,
   snapping, stacking, collisions and undo, in `domotwin-core::edit`. While a piece is dragged, it
   and what stands on it are rebuilt alone with the moving parts. Every change is the overlay,
   applied to the stored plan and read again. On save the frontend sends the overlay with
   `domotwin/plan/save` (admins only, with the revision it started from), and every open view
   reloads through `domotwin/subscribe`.

## Storage

`.storage/domotwin.data` (one file, versioned, migrated by `Store._async_migrate_func`):

```json
{
  "revision": 3,
  "storeys": [
    {
      "id": "storey-1",
      "name": "",
      "elevation": 0,
      "plan": { "version": 1, "unit": "cm", "elements": [] },
      "layout": { "sofa": { "x": 360, "y": 110, "angle": 0 } }
    }
  ],
  "bindings": { "version": 1, "rooms": {}, "elements": {} },
  "settings": {},
  "revisions": { "plan": 2, "bindings": 3, "settings": 0 }
}
```

- `storeys` (D-026): each storey's `plan`, the House Maquette plan exactly as read, and `layout`,
  its edit-mode overlay keyed by element id; `name` (empty: named by its place) and `elevation`
  (cm). Element ids, and the ids of pieces an overlay adds, are unique in the whole home. Storage
  1.1 kept one `plan` and `layout`: they become `storey-1` (storage 2.1).
- `bindings`: see [`bindings.md`](bindings.md).
- `settings`: the home's settings, `{"north": <degrees>}`: where north points on the plan,
  clockwise from its top, for the real sun (D-023).
- `revision`: bumped on every write. `revisions` keeps the revision of the last write of each kind
  (`plan` for the plan and the overlay, `bindings`, `settings`): the `get` commands return it and a
  save with `expected_revision` is checked against it, so that saving the bindings or the settings
  does not refuse an edit of the plan started before (optimistic concurrency between devices).

The 3D files of user models are not in `.storage`: they are kept under their SHA-256 in
`<config>/domotwin/models/<sha256>.<format>` (D-021), uploaded with `POST /api/domotwin/models?format=…`
(administrators; answers `{hash, bytes, format}`) and read with
`GET /api/domotwin/models/<sha256>.<format>` (signed-in users, cached as immutable). After every
save of the plan or the overlay, the files neither uses are deleted once a day old; all of them go
when the integration is removed.

## Websocket API

| Command                  | Who    | Payload                                        | Result                           |
| ------------------------ | ------ | ---------------------------------------------- | -------------------------------- |
| `domotwin/info`          | user   | –                                              | `version`, `revision`, `has_plan`, `storeys` |
| `domotwin/plan/get`      | user   | `storey?` (the ground floor by default)        | `plan`, `layout`, `storey`, `storeys`, `revision` |
| `domotwin/plan/save`     | admin  | `storey?`, `plan?` (`null` removes the storey), `layout?`, `expected_revision?` | `revision` |
| `domotwin/storey/save`   | admin  | `storey?` (none: a new storey, `plan` needed), `name?`, `elevation?`, `plan?`, `layout?`, `expected_revision?` | `revision`, `storey` |
| `domotwin/storey/remove` | admin  | `storey`, `expected_revision?`                 | `revision`                       |
| `domotwin/storeys/replace` | admin | `storeys` (`[{plan, name?, elevation?}]`, 1 to 20), `expected_revision?` | `revision`, `storeys` (their ids) |
| `domotwin/bindings/get`  | user   | –                                              | `bindings`, `revision`           |
| `domotwin/bindings/save` | admin  | `bindings`, `expected_revision?`               | `revision`                       |
| `domotwin/settings/get`  | user   | –                                              | `settings`, `revision`           |
| `domotwin/settings/save` | admin  | `settings` (`north`, 0 ≤ n < 360)              | `revision`                       |
| `domotwin/subscribe`     | user   | –                                              | events `{kind, revision}`        |

Errors: `not_loaded`, `invalid_plan`, `invalid_layout`, `invalid_bindings`, `invalid_settings`,
`too_large`,
`too_many_models`, `revision_conflict`, `unknown_storey`, `invalid_storey`, `too_many_storeys`,
`duplicate_id`, and Home Assistant's `unauthorized` for non-admin writes.

## Privacy

The product talks only to the user's own Home Assistant: no CDN, no telemetry, no analytics, no web
fonts from the internet. Every asset (wasm, JS, fonts, materials) is served by the integration.

## Figures

The figures are drawn as SVG in `docs/figures/src/` and rendered to PNG with
`node scripts/render-figures.mjs` (Inter and JetBrains Mono must be installed for the same look).
