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
