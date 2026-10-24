# Performance

DomoTwin must stay smooth on an old wall tablet and cost nothing when nobody looks at it. This page
lists the budgets, how they are measured, and the numbers measured at each milestone.

## Budgets

| Budget | Limit | Checked by |
| --- | --- | --- |
| First load (wasm + JS a view needs), gzipped | ≤ 1.2 MB, user textures and fonts excluded | `scripts/check-bundle-size.mjs`, CI job `bundle` (fails over budget) |
| Idle CPU | ≈ 0: no frame unless something changed | scheduler unit tests, E2E "no frames while idle" |
| Off-screen or hidden tab | no frame at all | scheduler unit tests |
| Layer animation (heatmap, alerts, power) | 24 fps only while a moving layer is visible, none with reduced motion | scheduler `setMinInterval`, E2E "24 frames per second" (M4) |
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


### M4 (layers)

Bundle: the first load is **314.8 kB gzipped** of 1 200 kB (+21.3 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 596.4 kB | 260.3 kB |
| `domotwin.js` (entry) | 73.8 kB | 20.6 kB |

The engine grew by 14 kB gzipped (the scales and their OKLab colours, the room and power texels,
the layers' shading, the real sun and its shadow pass, the labels and legends), the entry by 3.5 kB
(reading the rooms' sensors, the layer menu, legend, labels and alerts, the settings).

In headless Chromium (SwiftShader, High quality, the demo apartment with its fictional sensors),
the CPU time per frame stays at 0.2–0.4 ms median with the heatmap, the power layer or the real sun
(1–2 ms p95): the layers are read by the floors' shading, with no added draw call. A move of the
sun draws the shadow map again (0.5 ms of CPU that frame). Working out the layers from the `hass`
object on a state change takes 0.05–0.2 ms. A moving layer draws 24 frames per second while
nothing else moves (`frameInterval` in the view's debug state); SwiftShader itself draws only a
few per second, so the rate on real GPUs is checked through the scheduler's cap, not by counting.


### M5 (devices)

Bundle: the first load is **327.3 kB gzipped** of 1 200 kB (+12.5 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 613.0 kB | 267.4 kB |
| `domotwin.js` (entry) | 82.6 kB | 23.1 kB |

The engine grew by 7 kB gzipped (the camera role and settings, the cone and its clipping, the
cameras' and elements' points), the entry by 2.5 kB (the badges, their icons and the cones).

In headless Chromium with the demo apartment (three elements with badges, one camera): working
out the badges from the `hass` object takes 0.04 ms, the elements' points 0.02 ms and the cameras'
cones 0.07 ms, read only when the camera moves or a state changes; the CPU time per frame is
unchanged (0.3 ms median, 1.1 ms p95).

### M6 (plan editor)

Bundle: the first load is **334.8 kB gzipped** of 1 200 kB (+7.5 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 621.5 kB | 270.7 kB |
| `domotwin.js` (entry) | 90.4 kB | 23.8 kB |
| `domotwin_planner_bg.<hash>.wasm` (on demand) | 237.9 kB | 112.8 kB |
| The plan editor's JS: bar, tools and handles, glue (on demand) | 29.6 kB | 10.2 kB |

Inside the engine, the plan editor cost 20.5 kB gzipped (LTO inlined the whole engine
differently): it is its own module, loaded when the plan editor opens (D-025). The engine grew by
3.3 kB (showing a draft, marking the selection, the plan shown with its overlay, points both
ways), the first load's other chunks by 4.2 kB (the texts in English and French, the panel's and
the view's side of the plan editor).

In headless Chromium with the demo apartment, dragging a corner of the living room costs 4.7 ms
per pointer move (median; 12 ms p95): the change checked by the plan reader in the planner, the
draft passed as JSON to the engine, read again, the whole scene built and uploaded, and the
handles placed; drawing the frame then takes 0.2 ms. The view applies at most one move per frame;
a tap that only selects marks the element without building the scene again.

### M7 (storeys)

Bundle: the first load is **340.6 kB gzipped** of 1 200 kB (+5.8 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 625.6 kB | 272.1 kB |
| `domotwin.js` (entry) | 103.9 kB | 26.7 kB |

The engine grew by 1.4 kB (the stairs, the ids edit mode keeps for the other storeys), the rest by
4.4 kB (the switcher, the storeys dialog, the alerts of the other storeys, the texts in two
languages).

In headless Chromium with the demo apartment and its fictional upper floor, switching storeys takes
10 ms median from the tap to the new storey read (7–16 ms): the plan was already fetched for the
alerts, so it is read and its scene built, the camera kept. Every frame then costs what one storey
costs; nothing of the other storeys is drawn.

### M8 (looks)

Bundle: the first load is **359.2 kB gzipped** of 1 200 kB (+18.6 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 662.5 kB | 288.7 kB |
| `domotwin.js` (entry) | 106.8 kB | 27.1 kB |

The engine grew by 16.6 kB (the looks' shaders, the outlines of the home, the background, glass
walls and bloom passes, the rooms' label points), the rest by 2 kB (the options and settings,
the rooms' names, the texts).

Frame time in headless Chromium at the High preset, the demo apartment in the evening with its
lamps on (`e2e/perf.spec.ts`, "frame time of each look"):

| Look | CPU per frame (median, p95) | Software GPU per frame (median) |
| --- | ---: | ---: |
| Day (straight to the screen) | 0.8 ms, 5.1 ms | 317 ms |
| Neon (offscreen, 4× MSAA, bloom) | 0.6 ms, 1.6 ms | 283 ms |
| Blueprint (offscreen, 4× MSAA, bloom) | 0.5 ms, 2.9 ms | 267 ms |

The CPU's share does not change with the look. SwiftShader rasterises on the CPU, so its time is
no guide to a real GPU, only to the ratio: the offscreen picture with MSAA and the bloom cost
about what day's sun shadow map and soft shadows cost (night looks draw no shadow map), and the
glass walls draw the walls' mesh again, not the whole home. Eco draws every look straight to the
screen, as before.


### M9 (every storey at once)

Bundle: the first load is **381.2 kB gzipped** of 1 200 kB (+22.0 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 710.8 kB | 308.2 kB |
| `domotwin.js` (entry) | 113.7 kB | 28.7 kB |

The engine grew by 19.5 kB (the scene of every storey, the roof, where each storey is drawn and
its animations, the plan of storeys side by side, the pictures of the storeys, the labels), the
rest by 2.5 kB (the "every storey" button, the storeys' labels and pictures, the options, the
texts).

Frame time in headless Chromium at the High preset, neon, in the evening with the lamps on
(`e2e/perf.spec.ts`, "frame time of each look" and "frame time of the whole home", one run):

| Shown | CPU per frame (median, p95) | Software GPU per frame (median) |
| --- | ---: | ---: |
| The ground floor alone | 0.5 ms, 2.8 ms | 283 ms |
| Both storeys, spread apart, with the roof (27 776 triangles) | 0.7 ms, 3.1 ms | 250 ms |

The CPU's share grows a little with the draw calls (each storey's meshes, outlines and lamps), the
GPU's not measurably (software rendering times vary by a frame of the display from run to run):
the storeys are small and most of a frame is the offscreen picture and its bloom. The
pictures of the storeys are drawn once per home and per look (280 × 180 pixels each), not per
frame. Spreading the storeys apart redraws the sun's shadow map on each frame of the animation in
the day look (0.7 s), as a moving wall does.

### M10 (walking, kiosks and voice)

Bundle: the first load is **391.6 kB gzipped** of 1 200 kB (+10.4 kB):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 725.1 kB | 314.9 kB |
| `domotwin.js` (entry) | 123.3 kB | 31.3 kB |

The engine grew by 6.7 kB (the walls and doors a walker meets, the way through the doors, the
widest view, the walking camera, the ceilings), the rest by 3.7 kB (the walk button, pad and keys,
the kiosk's wait, slow turn and dimming, `domotwin.show`, the options, the texts).

Frame time in headless Chromium at the High preset, in the day look in the evening with the lamps
on (`e2e/perf.spec.ts`, "frame time of each look" and "frame time walking", one run):

| Shown | CPU per frame (median, p95) | Software GPU per frame (median) |
| --- | ---: | ---: |
| The ground floor from above | 1.1 ms, 5.0 ms | 300 ms |
| Walking through it at eye level, ceilings on | 0.9 ms, 5.2 ms | 417 ms |

At eye level the walls are whole (no cut-away) and the ceilings are drawn, so more of the screen
is covered by near surfaces, each lit by the lamps of its room: the software GPU, which shades
every pixel, takes about a third longer; a real GPU does not notice. A walk step costs a few
segment distances (the walls of a storey) per frame while moving, and nothing once standing. The
kiosk's slow turn draws 20 frames per second, the dimmed screen none at all, and the wait for
idle is a check per second, not a frame.

### M10b (DomoTwin's own plan format)

Bundle: the first load is **389.5 kB gzipped** of 1 200 kB, 3.7 kB less than M10 as merged
(393.2 kB, measured again on the same build tools):

| File | Raw | Gzipped |
| --- | ---: | ---: |
| `domotwin_web_bg.<hash>.wasm` | 717.3 kB | 312.8 kB |
| `domotwin_planner_bg.<hash>.wasm` (on demand) | 207.5 kB | 95.2 kB |
| `domotwin_ifc_bg.<hash>.wasm` (on demand) | 245.1 kB | 114.1 kB |

The new reader has less to undo (corners relative to a frame, kinds turned sideways, names in two
languages, model kits): the engine lost 3.6 kB. The plan editor's module lost 19.4 kB: it edits the
file's lists as they are and keeps no second, read copy of the plan. The demo apartment is
8.3 kB instead of 13.9 kB (2.0 kB gzipped instead of 2.2 kB). Its scene is the same geometry
(13 843 triangles, 9 wall groups); only the colours of the pieces that named none changed.
