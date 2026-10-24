# Performance

DomoTwin must stay smooth on an old wall tablet and cost nothing when nobody looks at it. This page
lists the budgets, how they are measured, and the numbers measured at each milestone.

## Budgets

| Budget | Limit | Checked by |
| --- | --- | --- |
| First load (wasm + JS a view needs), gzipped | ≤ 1.2 MB, user textures and fonts excluded | `scripts/check-bundle-size.mjs`, CI job `bundle` (fails over budget) |
| Idle CPU | ≈ 0: no frame unless something changed | scheduler unit tests, E2E "no frames while idle" |
| Off-screen or hidden tab | no frame at all | scheduler unit tests |
| Heatmap animation | 20–30 fps only while the layer is visible | scheduler `setMinInterval` (M4) |
| Edit-mode drag | 60 fps on a mid-range phone, 500-element plan | M3, on devices |
| Textures | none so far: floors and tiles are procedural; user pictures capped at 1024 px | M3 |
| WebGL contexts | one per visible view, released on `disconnectedCallback` | E2E "releases the engine" |
| WebAssembly memory | no allocation spikes (it never shrinks) | frame-time smoke test reports it |

![Render on demand: frames only when something changes, nothing while idle or off-screen](figures/render-on-demand.png)

## How it is measured

- **Bundle.** `scripts/build.sh` builds the engine (`opt-level = "z"`, LTO, `wasm-opt -Oz`) and the
  frontend (esbuild, minified, split into chunks), then `node scripts/check-bundle-size.mjs` gzips
  (level 9) every file. "First load" follows the imports: the entry, the chunks it imports
  statically, the engine glue (every view starts it) and the wasm. Chunks imported only on demand
  (the card editor, the panels over the scene, the link editor) are listed apart. CI publishes the
  table in the job summary and the JSON as the `bundle-size` artifact.
- **Frame time.** `frontend/e2e/perf.spec.ts` loads the demo plan in headless Chromium with software
  WebGL2 (SwiftShader), forces 120 consecutive frames and reports the CPU time of a frame, the
  interval between frames and the WebAssembly memory. CI uploads it as the `frame-time` artifact.
  Software rendering is slow and stable, which makes regressions visible; real devices are measured
  by hand.
- **Scene.** `crates/domotwin-core/tests/scene.rs` builds the demo plan and fails above 120 000
  triangles; `stats()` reports the triangles and wall groups of any plan.

## Measurements

### M0 (scaffold: the engine only clears the view)

Bundle (Rust 1.97.0, wasm-bindgen 0.2.129, binaryen 133, esbuild 0.28.2):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 102.4 kB | 49.1 kB |
| `chunks/chunk-<hash>.js` (Lit, shared) | 21.4 kB | 8.2 kB |
| `domotwin.js` (entry) | 23.5 kB | 7.8 kB |
| `chunks/domotwin_web-<hash>.js` (wasm glue) | 12.6 kB | 4.3 kB |
| `chunks/card-editor-<hash>.js` (on demand) | 1.4 kB | 0.8 kB |
| **First load** | | **≈ 69 kB of 1 200 kB** |

Frame-time smoke test (demo plan, SwiftShader, 120 frames): CPU time per frame < 0.1 ms (median
0.0 ms, p95 0.1 ms), frame interval 16.7 ms (median and p95, the display rate), WebAssembly memory
1.18 MB. These numbers only prove the pipeline: the scene arrives with M1.

Renderer candidates measured for [`DECISIONS.md`](DECISIONS.md) (D-002): three-d 83 kB gzipped with
PBR, shadows and post-processing; wgpu (WebGL2) 667 kB gzipped for a single triangle.

### M1 (render: the whole home in 3D and 2D)

Bundle (same toolchain as M0):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 383.5 kB | 173.2 kB |
| `domotwin.js` (entry) | 35.0 kB | 11.1 kB |
| `chunks/chunk-<hash>.js` (Lit, shared) | 25.2 kB | 9.3 kB |
| `chunks/domotwin_web-<hash>.js` (wasm glue) | 25.7 kB | 6.9 kB |
| `chunks/card-editor-<hash>.js` (on demand) | 1.5 kB | 0.8 kB |
| **First load** | | **≈ 200 kB of 1 200 kB** |

The engine grew by 124 kB gzipped: the plan reader, the geometry, the 55 procedural models, the
renderer, the moods of the day and `serde_json`.

Scene of the demo apartment (54 elements): 24 560 + 272 vertices (opaque + glass and shadows),
18 411 triangles, 9 wall groups, 2 draw calls per frame plus the shadow map when walls move.

Frame-time smoke test (demo plan, SwiftShader, 1000 × 700, Eco as picked for software rendering,
120 forced frames): CPU time per frame 0.2 ms median, 1 ms p95; frame interval 66.6 ms median,
150 ms p95; WebAssembly memory 3.1 MB. The interval is the software rasteriser at work (the CPU
side stays under a millisecond); real GPUs draw this scene far within a 60 Hz frame, to be confirmed
by hand on devices.

![The 2D plan of the demo apartment](figures/screenshot-plan.png)

### M2 (live control)

Bundle (same toolchain):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 466.7 kB | 205.8 kB |
| `domotwin.js` (entry) | 41.7 kB | 12.4 kB |
| `chunks/chunk-<hash>.js` (Lit, shared) | 29.4 kB | 10.8 kB |
| `chunks/domotwin_web-<hash>.js` (wasm glue) | 26.8 kB | 7.0 kB |
| `chunks/chunk-<hash>.js` (bindings, actions) | 8.6 kB | 3.8 kB |
| `chunks/chunk-<hash>.js` (suggestions) | 2.2 kB | 1.1 kB |
| **First load** | | **≈ 241 kB of 1 200 kB** |
| On demand: controls and room panel, link editor, card editor | 19.7 kB | 7.0 kB |

The engine grew by 33 kB gzipped (bindings, states, targets and fades, the moving parts, lamps).
The panels over the scene load the first time one opens.

Scene of the demo apartment: the same 18 411 triangles, now in four meshes (static opaque and
glass, moving opaque and glass) plus the halos. A state change uploads one small texture (two
texels per element); only doors, windows, blinds and curtains that move rebuild their small mesh,
and only while they move. A `hass` update costs a comparison of the bound entities' state objects
(Home Assistant keeps the object of an entity that did not change).

Frame-time smoke test (demo plan, SwiftShader, 1000 × 700, Eco, 120 forced frames): CPU time per
frame 0.3 ms median, 1.9 ms p95; WebAssembly memory 3.2 MB. Frame interval 133 ms median, 283 ms
p95. To compare with M1 on the same machine at the same moment (software rendering depends on the
machine's load): M1 83 ms, M2 100 ms with no lamp lit and 117 ms with six. The extra time is per
pixel (the lamp lights of the pixel's room, glows, greyed-out entities), which the software
rasteriser runs on the CPU; on a GPU it is small, still to be confirmed on real devices by hand.
Frames are only drawn while something moves.

### M1b (IFC import)

Bundle: the first load is **242.6 kB gzipped** (+1.7 kB: the panel's import of `.ifc` files). The
IFC import is its own module, fetched only when an `.ifc` file is picked:

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_ifc_bg.<hash>.wasm` (on demand) | 241.6 kB | 112.2 kB |
| `chunks/domotwin_ifc-<hash>.js` (glue, on demand) | 5.3 kB | 2.0 kB |
| `chunks/ifc-<hash>.js` (wrapper, on demand) | 0.7 kB | 0.4 kB |

An E2E test checks that the page never requests the IFC module before a file is picked.

Import time in headless Chromium (reading the file, converting, the engine's check, saving and
showing the plan, the module's first download included): the fictional
`examples/demo-apartment.ifc` (53 kB, 6 rooms, 10 openings, 24 pieces) 0.5 s; a synthetic 9.8 MB
file with 20 000 extra pieces 2.1 s (the plan keeps 500 elements and says so). The reader keeps the
file's bytes and a small index; attributes are parsed only when needed. The module's memory is kept
until the page reloads (WebAssembly memory never shrinks).

### M3 (edit mode)

Bundle: the first load is **280.0 kB gzipped** of 1 200 kB (+37 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 537.0 kB | 235.7 kB |
| `domotwin.js` (entry) | 54.7 kB | 15.6 kB |
| `chunks/edit-bar-<hash>.js` (edit bar and catalogue, on demand) | 8.1 kB | 2.7 kB |

The engine grew by 30 kB gzipped (the overlay, snapping, stacking, collisions, the session and its
API); the entry by 3 kB (edit mode in the view, the panel's edit mode, the names of the kinds in
English and French). The edit bar and the catalogue load the first time edit mode opens.

Edit mode in headless Chromium (demo plan, SwiftShader, 1000 × 700): a pointer move while the sofa
is dragged (rebuilding the dragged pieces, snapping, guides, collisions) **1.2 ms median, 4.2 ms
p95**, then 0.2 ms to draw the frame; dropping it (the whole scene rebuilt) 6.6 ms. Pointer moves
are applied once per frame. Logged by `e2e/perf.spec.ts` with the frame-time smoke test, which is
unchanged (CPU time per frame 0.3 ms median, 1.6 ms p95; WebAssembly memory 3.5 MB).


### M3b (your own 3D models)

Bundle: the first load is **293.5 kB gzipped** of 1 200 kB (+13.5 kB). The 3D model readers are
their own module, fetched only when a plan shows a piece drawn from a 3D file or one is imported:

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 562.8 kB | 246.1 kB |
| `domotwin.js` (entry) | 60.2 kB | 17.1 kB |
| `domotwin_models_bg.<hash>.wasm` (on demand) | 186.2 kB | 94.0 kB |
| `chunks/domotwin_models-<hash>.js` (glue, on demand) | 5.7 kB | 2.2 kB |
| `chunks/edit-bar-<hash>.js` (edit bar, catalogue, model import, on demand) | 15.2 kB | 4.3 kB |

The engine grew by 10 kB gzipped (reading and fitting meshes, the overlay's models, the session's
model pieces and their API), the entry by 1.5 kB (fetching and reading a plan's files in the view).

A large model in headless Chromium (SwiftShader, `e2e/perf.spec.ts`): two pieces drawn from a
generated STL of **139 392 triangles** (7 MB, a little under the 150 000-triangle limit). Fetching
and reading the file took **315 ms**; drawing it (the whole scene rebuilt and uploaded once for
every mesh that came before the next frame, 297 199 triangles) **80 ms**; then the CPU time per
frame was 0.3 ms median, 0.8 ms p95, and the WebAssembly memory 21.7 MB (3.5 MB without it). The
demo plan's figures are unchanged: 0.3 ms median and 1.4 ms p95 per frame, a drag step 0.9 ms
median and 3.0 ms p95, a drop 5.0 ms.

The readers outside the browser (native, release build) on real files from public sample
collections, kept out of the repository: a 3 MB 3MF archive of 96 692 triangles in 0.37 s, a 0.4 MB
textured GLB of 3 624 triangles in 2 ms.
