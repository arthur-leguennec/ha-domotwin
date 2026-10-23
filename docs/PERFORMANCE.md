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
| Textures | mipmapped, capped at 1024 px by default | M1 |
| WebGL contexts | one per visible view, released on `disconnectedCallback` | E2E "releases the engine" |
| WebAssembly memory | no allocation spikes (it never shrinks) | frame-time smoke test reports it |

![Render on demand: frames only when something changes, nothing while idle or off-screen](figures/render-on-demand.png)

## How it is measured

- **Bundle.** `scripts/build.sh` builds the engine (`opt-level = "z"`, LTO, `wasm-opt -Oz`) and the
  frontend (esbuild, minified, split into chunks), then `node scripts/check-bundle-size.mjs` gzips
  (level 9) every file. "First load" counts every JS chunk except the card editor, plus the wasm.
  CI publishes the table in the job summary and the JSON as the `bundle-size` artifact.
- **Frame time.** `frontend/e2e/perf.spec.ts` loads the demo plan in headless Chromium with software
  WebGL2 (SwiftShader), forces 120 consecutive frames and reports the CPU time of a frame, the
  interval between frames and the WebAssembly memory. CI uploads it as the `frame-time` artifact.
  Software rendering is slow and stable, which makes regressions visible; real devices are measured
  by hand from M1 on.

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
