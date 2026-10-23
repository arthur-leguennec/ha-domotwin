//! The engine exposed to JavaScript.

use std::sync::Arc;

use domotwin_core::camera::{Camera, CutawayMode};
use domotwin_core::plan::{Plan, View};
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::{ElementInfo, SceneOptions, build_scene};
use domotwin_core::{ReadError, read_plan, summarize_plan};
use domotwin_render::{GpuHint, QualityPreset, Renderer, Rgb};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext, WebGlContextAttributes};

/// Installs the panic hook so that a bug shows a readable message in the console.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// The version of the engine (the product version is set by the frontend).
#[wasm_bindgen(js_name = engineVersion)]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// A plan error for JavaScript: the JSON `{"code": …, "element": …}`.
fn plan_error(err: &ReadError) -> JsError {
    JsError::new(&err.to_json())
}

/// Reads a plan without drawing it (the import checks a file with it). Returns a JSON summary.
///
/// # Errors
///
/// Fails with the JSON error of the plan reader (stable code and element id).
#[wasm_bindgen(js_name = summarizePlan)]
pub fn summarize_plan_json(json: &str) -> Result<String, JsError> {
    summarize_plan(json.as_bytes())
        .map(|summary| summary.to_json())
        .map_err(|err| plan_error(&err))
}

/// One DomoTwin view drawn on one canvas.
#[wasm_bindgen]
#[derive(Debug)]
pub struct Engine {
    renderer: Renderer,
    plan: Option<Plan>,
    elements: Vec<ElementInfo>,
    triangles: usize,
    gpu: GpuHint,
}

#[wasm_bindgen]
impl Engine {
    /// Creates the engine on a canvas (a WebGL2 context is created on it).
    ///
    /// # Errors
    ///
    /// Fails with `webgl2_unavailable` when the browser cannot create a WebGL2 context.
    #[wasm_bindgen(constructor)]
    pub fn new(canvas: HtmlCanvasElement) -> Result<Engine, JsError> {
        let attributes = WebGlContextAttributes::new();
        attributes.set_antialias(true);
        attributes.set_alpha(false);
        attributes.set_depth(true);
        attributes.set_premultiplied_alpha(false);
        attributes.set_preserve_drawing_buffer(false);
        let gl = canvas
            .get_context_with_context_options("webgl2", &attributes)
            .ok()
            .flatten()
            .and_then(|context| context.dyn_into::<WebGl2RenderingContext>().ok())
            .ok_or_else(|| JsError::new("webgl2_unavailable"))?;
        let gpu = gpu_hint(&gl);
        // three-d takes the GL context in an `Arc`; WebAssembly here is single-threaded.
        #[allow(clippy::arc_with_non_send_sync)]
        let renderer = Renderer::new(
            Arc::new(glow::Context::from_webgl2_context(gl)),
            canvas.width(),
            canvas.height(),
        )
        .map_err(|_| JsError::new("webgl2_unavailable"))?;
        let mut engine = Engine {
            renderer,
            plan: None,
            elements: Vec::new(),
            triangles: 0,
            gpu,
        };
        engine
            .renderer
            .set_quality(QualityPreset::from_hint(&engine.gpu));
        Ok(engine)
    }

    /// Loads a plan (the text of a `*.plan.json`) and builds its scene. Returns a JSON summary.
    /// The camera keeps its place when `keep_camera` (a plan saved from another view).
    ///
    /// # Errors
    ///
    /// Fails with the JSON error of the plan reader (stable code and element id), which the
    /// frontend translates.
    #[wasm_bindgen(js_name = loadPlan)]
    pub fn load_plan(&mut self, json: &str, keep_camera: Option<bool>) -> Result<String, JsError> {
        let plan = read_plan(json.as_bytes()).map_err(|err| plan_error(&err))?;
        let mut scene = build_scene(&plan, &SceneOptions::default());
        self.triangles = scene.opaque.triangle_count() + scene.transparent.triangle_count();
        self.renderer
            .set_scene(&scene, keep_camera.unwrap_or(false) && self.plan.is_some());
        // The meshes live on the GPU now: free the copies.
        scene.opaque = Mesh::default();
        scene.transparent = Mesh::default();
        self.elements = scene.elements;
        let summary = plan.summary().to_json();
        self.plan = Some(plan);
        Ok(summary)
    }

    /// Sets the drawing buffer size in device pixels.
    pub fn resize(&mut self, width: u32, height: u32) {
        self.renderer.resize(width, height);
    }

    /// Sets the background colour (sRGB, 0–255) from the Home Assistant theme.
    #[wasm_bindgen(js_name = setBackground)]
    pub fn set_background(&mut self, r: u8, g: u8, b: u8) {
        self.renderer.set_background(Rgb {
            r: f32::from(r) / 255.0,
            g: f32::from(g) / 255.0,
            b: f32::from(b) / 255.0,
        });
    }

    /// Forces a quality preset (`eco`, `balanced`, `high`) or returns to automatic (`auto`).
    #[wasm_bindgen(js_name = setQuality)]
    pub fn set_quality(&mut self, name: &str) {
        let preset =
            QualityPreset::from_name(name).unwrap_or_else(|| QualityPreset::from_hint(&self.gpu));
        self.renderer.set_quality(preset);
    }

    /// The active quality preset.
    pub fn quality(&self) -> String {
        self.renderer.quality().as_str().to_owned()
    }

    /// Sets the cut-away mode: `auto`, `always` or `off`.
    #[wasm_bindgen(js_name = setCutaway)]
    pub fn set_cutaway(&mut self, name: &str) {
        self.renderer.set_cutaway(CutawayMode::from_name(name));
    }

    /// Turns the camera by a pointer move of `dx`, `dy` CSS pixels.
    pub fn orbit(&mut self, dx: f64, dy: f64) {
        self.renderer.view.orbit(dx, dy);
    }

    /// Pans by a pointer move of `dx`, `dy` CSS pixels on a view `height` CSS pixels high.
    pub fn pan(&mut self, dx: f64, dy: f64, height: f64) {
        self.renderer.view.pan(dx, dy, height);
    }

    /// Zooms by `factor` (< 1 closer) towards the screen point `x`, `y` (−1…1, y up).
    pub fn zoom(&mut self, factor: f64, x: f64, y: f64) {
        self.renderer.view.zoom(factor, [x, y]);
    }

    /// Switches between the 3D view and the 2D plan (animated from `time_ms`).
    #[wasm_bindgen(js_name = setPlanView)]
    pub fn set_plan_view(&mut self, plan: bool, time_ms: f64) {
        self.renderer.view.set_plan_view(plan, time_ms);
    }

    /// Whether the 2D plan is shown.
    #[wasm_bindgen(js_name = planView)]
    pub fn plan_view(&self) -> bool {
        self.renderer.view.plan_view
    }

    /// Back to the whole home (animated from `time_ms`).
    pub fn overview(&mut self, time_ms: f64) {
        self.renderer.view.overview(time_ms);
    }

    /// Frames an element (a room, a piece). Returns `false` when it has no geometry.
    #[wasm_bindgen(js_name = focusElement)]
    pub fn focus_element(&mut self, id: &str, time_ms: f64) -> bool {
        let Some(info) = self.elements.iter().find(|e| e.id == id) else {
            return false;
        };
        let [min, max] = info.bounds;
        if min == max {
            return false;
        }
        let widen = |v: f32| f64::from(v);
        self.renderer.view.focus(
            [
                [widen(min[0]), 0.0, widen(min[2])],
                [widen(max[0]), widen(max[1]), widen(max[2])],
            ],
            time_ms,
        );
        true
    }

    /// The plan's saved viewpoints, as JSON `[{"id", "name"}]` (eye-level views are skipped).
    pub fn views(&self) -> String {
        let list: Vec<serde_json::Value> = self
            .plan
            .iter()
            .flat_map(|plan| &plan.views)
            .filter_map(|view| match view {
                View::Orbit { id, name, .. } => Some(serde_json::json!({ "id": id, "name": name })),
                View::Walk { .. } => None,
            })
            .collect();
        serde_json::Value::Array(list).to_string()
    }

    /// Moves to a saved viewpoint. Returns `false` when there is none with this id.
    #[wasm_bindgen(js_name = showView)]
    pub fn show_view(&mut self, id: &str, time_ms: f64) -> bool {
        let found = self
            .plan
            .iter()
            .flat_map(|plan| &plan.views)
            .find_map(|view| match view {
                View::Orbit { id: v, p, t, .. } if v == id => Some((*p, *t)),
                _ => None,
            });
        let Some((position, target)) = found else {
            return false;
        };
        if self.renderer.view.plan_view {
            self.renderer.view.plan_view = false;
        }
        self.renderer
            .view
            .go_to(Camera::from_view(position, target), time_ms);
        true
    }

    /// The element drawn at the device pixel `x`, `y` (from the top left), as JSON
    /// `{"id", "type"}`, or an empty string.
    pub fn pick(&mut self, x: u32, y: u32) -> String {
        let tag = self.renderer.pick(x, y);
        usize::from(tag)
            .checked_sub(1)
            .and_then(|i| self.elements.get(i))
            .map(|e| serde_json::json!({ "id": e.id, "type": e.kind }).to_string())
            .unwrap_or_default()
    }

    /// Figures about the scene, as JSON (for the diagnostics and the performance smoke test).
    pub fn stats(&self) -> String {
        let view = &self.renderer.view;
        serde_json::json!({
            "triangles": self.triangles,
            "groups": view.cuts.len(),
            "planView": view.plan_view,
            "quality": self.renderer.quality().as_str(),
        })
        .to_string()
    }

    /// Whether a frame is needed (something changed or an animation is running).
    #[wasm_bindgen(js_name = needsFrame)]
    pub fn needs_frame(&self) -> bool {
        self.renderer.needs_frame()
    }

    /// Asks for a new frame even though nothing changed.
    pub fn invalidate(&mut self) {
        self.renderer.invalidate();
    }

    /// Draws one frame. Returns `true` while an animation needs more frames.
    pub fn frame(&mut self, time_ms: f64) -> bool {
        self.renderer.render(time_ms)
    }
}

fn gpu_hint(gl: &WebGl2RenderingContext) -> GpuHint {
    const UNMASKED_RENDERER_WEBGL: u32 = 0x9246;
    let renderer = gl
        .get_extension("WEBGL_debug_renderer_info")
        .ok()
        .flatten()
        .and_then(|_| gl.get_parameter(UNMASKED_RENDERER_WEBGL).ok())
        .or_else(|| gl.get_parameter(WebGl2RenderingContext::RENDERER).ok())
        .and_then(|value| value.as_string())
        .unwrap_or_default();
    let max_texture_size = gl
        .get_parameter(WebGl2RenderingContext::MAX_TEXTURE_SIZE)
        .ok()
        .and_then(|value| value.as_f64())
        .map_or(0, |size| size as u32);
    let mobile = js_sys::Reflect::get(&js_sys::global(), &"navigator".into())
        .ok()
        .and_then(|navigator| js_sys::Reflect::get(&navigator, &"maxTouchPoints".into()).ok())
        .and_then(|points| points.as_f64())
        .is_some_and(|points| points > 0.0);
    GpuHint {
        renderer,
        max_texture_size,
        mobile,
    }
}
