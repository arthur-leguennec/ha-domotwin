//! The engine exposed to JavaScript.

use std::sync::Arc;

use domotwin_core::{PlanSummary, summarize_plan};
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

/// Reads a plan without drawing it (the import checks a file with it). Returns a JSON summary.
///
/// # Errors
///
/// Fails with the stable error code of the plan reader.
#[wasm_bindgen(js_name = summarizePlan)]
pub fn summarize_plan_json(json: &str) -> Result<String, JsError> {
    summarize_plan(json.as_bytes())
        .map(|summary| summary.to_json())
        .map_err(|err| JsError::new(err.code.as_str()))
}

/// One DomoTwin view drawn on one canvas.
#[wasm_bindgen]
#[derive(Debug)]
pub struct Engine {
    renderer: Renderer,
    plan: Option<PlanSummary>,
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
            gpu,
        };
        engine
            .renderer
            .set_quality(QualityPreset::from_hint(&engine.gpu));
        Ok(engine)
    }

    /// Loads a plan (the text of a `*.plan.json`). Returns a JSON summary of the plan.
    ///
    /// # Errors
    ///
    /// Fails with a stable error code (`not_json`, `bad_unit`…) that the frontend translates.
    #[wasm_bindgen(js_name = loadPlan)]
    pub fn load_plan(&mut self, json: &str) -> Result<String, JsError> {
        let summary =
            summarize_plan(json.as_bytes()).map_err(|err| JsError::new(err.code.as_str()))?;
        let result = summary.to_json();
        self.plan = Some(summary);
        Ok(result)
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

    /// Whether a frame is needed (something changed since the last one).
    #[wasm_bindgen(js_name = needsFrame)]
    pub fn needs_frame(&self) -> bool {
        self.renderer.is_dirty()
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
