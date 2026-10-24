//! The engine exposed to JavaScript.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
use std::sync::Arc;

use domotwin_core::bindings::{Bindings, Role, read_bindings};
use domotwin_core::camera::{Camera, CutawayMode};
use domotwin_core::devices::camera_cone;
use domotwin_core::edit::Session;
use domotwin_core::layers::{
    HeatKind, RoomLayers, legend, read_room_layers, room_shapes, room_texels,
};
use domotwin_core::lighting::{Mood, lighting_for_hour, lighting_for_sun, sun_direction};
use domotwin_core::live::{EntityState, LiveState, read_states, targets};
use domotwin_core::model_mesh::ModelMesh;
use domotwin_core::overlay::{Layout, apply, fit, parse_layout};
use domotwin_core::plan::{Element, Plan, View, parse_plan_json, read_plan_value};
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::{
    ElementInfo, ModelMeshes, Scene, SceneOptions, build_dynamic, build_scene_moving,
};
use domotwin_core::{ReadError, summarize_plan};
use domotwin_render::lamps::power_level;
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

/// The plan with the edit overlay applied, as written by **Export plan** (revision 10).
///
/// # Errors
///
/// Fails with the JSON error of the plan reader when the result is not a valid plan.
#[wasm_bindgen(js_name = applyLayout)]
pub fn apply_layout_json(plan: &str, layout: &str) -> Result<String, JsError> {
    let source = parse_plan_json(plan.as_bytes()).map_err(|err| plan_error(&err))?;
    let mut applied = apply(&source, &parse_layout(layout));
    if let Some(root) = applied.as_object_mut() {
        root.insert("layoutRevision".into(), serde_json::Value::from(10));
    }
    read_plan_value(&applied).map_err(|err| plan_error(&err))?;
    Ok(applied.to_string())
}

/// The legend of a heatmap (`temperature`, `humidity`, `co2`, `pm25`), as JSON `{"unit",
/// "stops": [[value, "#rrggbb"]…], "gradient": ["#rrggbb"…]}` (16 colours from the first stop to
/// the last, for a CSS gradient); an empty string for another name.
#[wasm_bindgen(js_name = heatLegend)]
pub fn heat_legend(kind: &str) -> String {
    let Some(kind) = HeatKind::from_name(kind) else {
        return String::new();
    };
    let stops: Vec<serde_json::Value> = kind
        .stops()
        .iter()
        .map(|&(value, color)| {
            serde_json::json!([value, domotwin_core::plan::Rgb8::from_u32(color).to_hex()])
        })
        .collect();
    let gradient: Vec<String> = legend(kind, 16).into_iter().map(|(_, c)| c).collect();
    serde_json::json!({ "unit": kind.unit(), "stops": stops, "gradient": gradient }).to_string()
}

/// One DomoTwin view drawn on one canvas.
#[wasm_bindgen]
#[derive(Debug)]
pub struct Engine {
    pub(crate) renderer: Renderer,
    /// The stored plan's JSON, before the overlay (edit mode applies it again after each change).
    pub(crate) source: Option<serde_json::Value>,
    /// The edit overlay applied to it.
    pub(crate) layout: Layout,
    pub(crate) plan: Option<Plan>,
    /// The scene without its static meshes (on the GPU), to rebuild the moving parts.
    pub(crate) scene: Option<Scene>,
    pub(crate) elements: Vec<ElementInfo>,
    triangles: usize,
    gpu: GpuHint,
    bindings: Bindings,
    states: BTreeMap<String, EntityState>,
    pub(crate) live: LiveState,
    last_frame: Option<f64>,
    /// Edit mode, when on.
    pub(crate) edit: Option<Session>,
    /// The pieces a drag moves are built apart (with the moving parts) since its first move.
    pub(crate) drag_built: bool,
    /// The meshes of the 3D files given so far, by SHA-256.
    models: Rc<ModelMeshes>,
    /// A mesh came for a piece shown since the scene was built.
    models_dirty: bool,
    /// The room layers shown (heatmap, alerts, presence).
    layers: RoomLayers,
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
            source: None,
            layout: Layout::new(),
            plan: None,
            scene: None,
            elements: Vec::new(),
            triangles: 0,
            gpu,
            bindings: Bindings::default(),
            states: BTreeMap::new(),
            live: LiveState::default(),
            last_frame: None,
            edit: None,
            drag_built: false,
            models: Rc::default(),
            models_dirty: false,
            layers: RoomLayers::default(),
        };
        engine
            .renderer
            .set_quality(QualityPreset::from_hint(&engine.gpu));
        Ok(engine)
    }

    /// Loads a plan (the text of a `*.plan.json`) with its edit overlay (`layout`, JSON) and
    /// builds its scene. Returns a JSON summary; `layoutRefused` counts the entries of the overlay
    /// left out because they made the plan invalid (an updated plan). The camera keeps its place
    /// when `keep_camera` (a plan saved from another view).
    ///
    /// # Errors
    ///
    /// Fails with the JSON error of the plan reader (stable code and element id), which the
    /// frontend translates.
    #[wasm_bindgen(js_name = loadPlan)]
    pub fn load_plan(
        &mut self,
        json: &str,
        keep_camera: Option<bool>,
        layout: Option<String>,
    ) -> Result<String, JsError> {
        let source = parse_plan_json(json.as_bytes()).map_err(|err| plan_error(&err))?;
        let layout = layout.as_deref().map_or_else(Layout::new, parse_layout);
        let (plan, layout, refused) = fit(&source, &layout).map_err(|err| plan_error(&err))?;
        let keep = keep_camera.unwrap_or(false) && self.plan.is_some();
        self.source = Some(source);
        self.layout = layout;
        // A plan loaded again ends edit mode (the frontend starts it again).
        self.edit = None;
        self.drag_built = false;
        self.renderer.set_marks(&[]);
        let mut summary: serde_json::Value =
            serde_json::from_str(&self.install(plan, keep)).unwrap_or_default();
        if refused > 0
            && let Some(object) = summary.as_object_mut()
        {
            object.insert("layoutRefused".into(), serde_json::Value::from(refused));
        }
        Ok(summary.to_string())
    }
}

impl Engine {
    /// Shows a plan: builds its scene, uploads it and sets its live looks. Returns the summary.
    fn install(&mut self, plan: Plan, keep_camera: bool) -> String {
        let summary = plan.summary().to_json();
        self.show(plan, keep_camera, &BTreeSet::new(), true);
        summary
    }

    /// Builds and uploads the scene of `plan`, with the pieces `moving` (element indices) among
    /// the moving parts. The live looks start at their targets when `fresh`, else keep fading,
    /// each with its element (an edit may move elements to other indices).
    pub(crate) fn show(
        &mut self,
        plan: Plan,
        keep_camera: bool,
        moving: &BTreeSet<usize>,
        fresh: bool,
    ) {
        // Where each element was before. Edits keep the order of the others, so the search goes
        // on from the last one found (linear for a whole plan).
        let n = self.elements.len();
        let mut cursor = 0;
        let old: Vec<Option<usize>> = plan
            .elements
            .iter()
            .map(|e| {
                let found = (0..n)
                    .map(|k| (cursor + k) % n)
                    .find(|&k| self.elements[k].id == e.id());
                if let Some(k) = found {
                    cursor = k + 1;
                }
                found
            })
            .collect();
        let options = SceneOptions {
            models: Rc::clone(&self.models),
            ..SceneOptions::default()
        };
        self.models_dirty = false;
        let mut scene = build_scene_moving(&plan, &options, moving);
        self.triangles = [
            &scene.opaque,
            &scene.transparent,
            &scene.dynamic_opaque,
            &scene.dynamic_transparent,
        ]
        .iter()
        .map(|m| m.triangle_count())
        .sum();
        self.renderer.set_scene(&scene, keep_camera);
        // The meshes live on the GPU now: free the copies.
        scene.opaque = Mesh::default();
        scene.transparent = Mesh::default();
        scene.dynamic_opaque = Mesh::default();
        scene.dynamic_transparent = Mesh::default();
        scene.ceiling = Mesh::default();
        self.elements.clone_from(&scene.elements);
        let targets = targets(&plan, &scene.lights, &self.bindings, &self.states);
        if fresh {
            self.live = LiveState::new(targets);
        } else {
            self.live.retarget_moved(targets, &old);
        }
        self.plan = Some(plan);
        self.scene = Some(scene);
        self.renderer.set_looks(&self.live.looks);
        self.rebuild_moving_parts();
        self.upload_rooms();
    }

    /// Gives the renderer the room layers of the scene shown.
    fn upload_rooms(&mut self) {
        if let (Some(plan), Some(scene)) = (&self.plan, &self.scene) {
            let texels = room_texels(plan, scene, &self.layers);
            self.renderer
                .set_rooms(&texels, self.layers.shown(), self.layers.animated());
        }
    }
}

#[wasm_bindgen]
impl Engine {
    /// The 3D files the pieces of the plan shown are drawn from, as JSON `[{"hash", "format",
    /// "bytes"}]`, each once: the frontend fetches and reads them, then gives their meshes with
    /// [`Engine::set_model_mesh`]. Files already given are left out.
    #[wasm_bindgen(js_name = modelFiles)]
    pub fn model_files(&self) -> String {
        let Some(plan) = &self.plan else {
            return "[]".to_owned();
        };
        let mut seen: Vec<&str> = Vec::new();
        let mut files = Vec::new();
        for element in &plan.elements {
            let Element::Furniture(f) = element else {
                continue;
            };
            let Some(file) = f
                .model
                .as_ref()
                .and_then(|id| plan.models.get(id))
                .and_then(|m| m.get("file"))
            else {
                continue;
            };
            let (Some(hash), Some(format)) = (
                file.get("hash").and_then(serde_json::Value::as_str),
                file.get("format").and_then(serde_json::Value::as_str),
            ) else {
                continue;
            };
            let valid =
                hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
            if valid && !self.models.contains_key(hash) && !seen.contains(&hash) {
                seen.push(hash);
                files.push(serde_json::json!({
                    "hash": hash,
                    "format": format,
                    "bytes": file.get("bytes").cloned().unwrap_or_default(),
                }));
            }
        }
        serde_json::Value::Array(files).to_string()
    }

    /// Gives the mesh of the 3D file `hash` (`DTM1`, from the model module); the pieces drawn
    /// from it change at the next [`Engine::show_models`]. Returns `false` when the mesh is refused.
    #[wasm_bindgen(js_name = setModelMesh)]
    pub fn set_model_mesh(&mut self, hash: &str, mesh: &[u8]) -> bool {
        let Ok(mesh) = ModelMesh::decode(mesh) else {
            return false;
        };
        Rc::make_mut(&mut self.models).insert(hash.to_owned(), Rc::new(mesh));
        let shown = self.plan.as_ref().is_some_and(|plan| {
            plan.models.values().any(|m| {
                m.get("file")
                    .and_then(|f| f.get("hash"))
                    .and_then(serde_json::Value::as_str)
                    == Some(hash)
            })
        });
        self.models_dirty |= shown;
        true
    }

    /// Draws the pieces whose 3D file came since the scene was built, in one rebuild for all of
    /// them. Returns whether it did.
    #[wasm_bindgen(js_name = showModels)]
    pub fn show_models(&mut self) -> bool {
        if !self.models_dirty {
            return false;
        }
        let Some(moving) = self.scene.as_ref().map(|s| s.moving().clone()) else {
            return false;
        };
        if let Some(plan) = self.plan.take() {
            self.show(plan, true, &moving, false);
            if let (Some(session), Some(plan), Some(scene)) =
                (&mut self.edit, &self.plan, &self.scene)
            {
                session.sync(plan, scene.walls());
            }
        }
        true
    }

    /// How many pieces are drawn as boxes because the 3D files of the plan pass the scene's
    /// triangle budget.
    #[wasm_bindgen(js_name = modelsOverBudget)]
    pub fn models_over_budget(&self) -> usize {
        self.scene.as_ref().map_or(0, |s| s.models_over_budget)
    }

    /// Sets the bindings (the JSON stored by the integration). Malformed entries are skipped.
    #[wasm_bindgen(js_name = setBindings)]
    pub fn set_bindings(&mut self, json: &str) {
        let value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        self.bindings = read_bindings(&value);
        self.retarget();
    }

    /// Updates entity states: JSON `{ "entity_id": { "state", "attributes" } | null }`, only the
    /// entities that changed (`null` forgets one).
    #[wasm_bindgen(js_name = setStates)]
    pub fn set_states(&mut self, json: &str) {
        let value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        for (id, state) in read_states(&value) {
            match state {
                Some(state) => {
                    self.states.insert(id, state);
                }
                None => {
                    self.states.remove(&id);
                }
            }
        }
        self.retarget();
    }

    /// Flashes an element briefly (tap feedback).
    pub fn highlight(&mut self, id: &str) {
        if let Some(index) = self.elements.iter().position(|e| e.id == id) {
            self.live.highlight(index);
            self.renderer.set_looks(&self.live.looks);
        }
    }

    fn retarget(&mut self) {
        if let (Some(plan), Some(scene)) = (&self.plan, &self.scene) {
            self.live
                .set_targets(targets(plan, &scene.lights, &self.bindings, &self.states));
            self.renderer.invalidate();
        }
    }

    pub(crate) fn rebuild_moving_parts(&mut self) {
        if let (Some(plan), Some(scene)) = (&self.plan, &self.scene) {
            let (opaque, transparent) = build_dynamic(plan, scene, &self.live.overrides);
            self.renderer.set_moving_parts(&opaque, &transparent);
        }
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

    /// Fixes the light to a mood: `morning`, `day`, `evening` or `night`. Returns `false` for
    /// another name (the light then follows the sun or the clock).
    #[wasm_bindgen(js_name = setLightingMood)]
    pub fn set_lighting_mood(&mut self, name: &str) -> bool {
        let Some(mood) = Mood::from_name(name) else {
            return false;
        };
        self.renderer.set_lighting(mood.lighting());
        true
    }

    /// Lights the scene for the sun's `elevation` (degrees), `rising` before noon (Home
    /// Assistant's `sun.sun`).
    #[wasm_bindgen(js_name = setSun)]
    pub fn set_sun(&mut self, elevation: f64, rising: bool) {
        self.renderer
            .set_lighting(lighting_for_sun(elevation, rising));
    }

    /// Lights the scene for a local time of day (`hour` 0–24) when the sun is unknown.
    #[wasm_bindgen(js_name = setLocalHour)]
    pub fn set_local_hour(&mut self, hour: f64) {
        self.renderer.set_lighting(lighting_for_hour(hour));
    }

    /// Lights the scene from where the sun really is (`azimuth` and `elevation` in degrees, as
    /// `sun.sun` gives them) for a plan whose north is `north` degrees clockwise from its top:
    /// its light comes into the rooms through the windows.
    #[wasm_bindgen(js_name = setSunPosition)]
    pub fn set_sun_position(&mut self, azimuth: f64, elevation: f64, north: f64) {
        self.renderer
            .set_sun(Some(sun_direction(azimuth, elevation, north)));
    }

    /// Goes back to the default sun, high in the south-east of the plan.
    #[wasm_bindgen(js_name = useDefaultSun)]
    pub fn use_default_sun(&mut self) {
        self.renderer.set_sun(None);
    }

    /// Shows the room layers: JSON `{"heat": "temperature", "values": {room id: value},
    /// "alerts": {room id: "warning" | "danger"}, "presence": [room id…]}`; `{}` shows none.
    #[wasm_bindgen(js_name = setLayers)]
    pub fn set_layers(&mut self, json: &str) {
        let value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        self.layers = read_room_layers(&value);
        self.upload_rooms();
    }

    /// Shows or hides the power layer: the pieces whose power sensors read more than standby are
    /// tinted, from yellow to red.
    #[wasm_bindgen(js_name = setPowerLayer)]
    pub fn set_power_layer(&mut self, shown: bool) {
        self.renderer.set_power_layer(shown);
    }

    /// Lets the layers move, or holds them still (the user prefers reduced motion).
    #[wasm_bindgen(js_name = setMotion)]
    pub fn set_motion(&mut self, motion: bool) {
        self.renderer.set_motion(motion);
    }

    /// Whether the layers shown move: a frame is then needed all the time, and the frontend
    /// draws fewer per second.
    #[wasm_bindgen(js_name = layersAnimating)]
    pub fn layers_animating(&self) -> bool {
        self.renderer.layers_animating()
    }

    /// What the linked cameras see on the floor, as JSON `[{"id", "entity", "points": [[x, y]…]}]`
    /// in device pixels from the top left: each camera's cone cut to its room (`DECISIONS.md`,
    /// D-024). A cone partly behind the camera of the view is left out.
    #[wasm_bindgen(js_name = cameraViews)]
    pub fn camera_views(&self) -> String {
        let (Some(plan), Some(scene)) = (&self.plan, &self.scene) else {
            return "[]".to_owned();
        };
        let mut views = Vec::new();
        for (id, entities) in &self.bindings.elements {
            let camera = entities.iter().find(|e| {
                let class = self
                    .states
                    .get(&e.entity_id)
                    .and_then(|s| s.device_class.as_deref());
                e.role.unwrap_or_else(|| Role::derive(&e.entity_id, class)) == Role::Camera
            });
            let (Some(camera), Some(index)) =
                (camera, plan.elements.iter().position(|e| e.id() == id))
            else {
                continue;
            };
            let Some(cone) = camera_cone(plan, scene, index, self.bindings.view(id)) else {
                continue;
            };
            let points: Option<Vec<[f64; 2]>> = cone
                .iter()
                .map(|p| self.renderer.screen_point([p[0], 1.0, p[1]]))
                .collect();
            if let Some(points) = points {
                views.push(serde_json::json!({
                    "id": id, "entity": camera.entity_id, "points": points,
                }));
            }
        }
        serde_json::Value::Array(views).to_string()
    }

    /// Where the elements `ids` (JSON array) are drawn now: the top of each one's centre, as JSON
    /// `{"id": [x, y]}` in device pixels from the top left. Elements behind the camera or without
    /// geometry are left out.
    #[wasm_bindgen(js_name = elementPoints)]
    pub fn element_points(&self, ids: &str) -> String {
        let ids: Vec<String> = serde_json::from_str(ids).unwrap_or_default();
        let mut points = serde_json::Map::new();
        for id in ids {
            let Some(info) = self.elements.iter().find(|e| e.id == id) else {
                continue;
            };
            let [min, max] = info.bounds;
            if min == max {
                continue;
            }
            let top = [
                f64::from(min[0] + max[0]) * 0.5,
                f64::from(max[1]),
                f64::from(min[2] + max[2]) * 0.5,
            ];
            if let Some(point) = self.renderer.screen_point(top) {
                points.insert(id, serde_json::json!(point));
            }
        }
        serde_json::Value::Object(points).to_string()
    }

    /// Whether a camera move, a wall animation or a fade is running: frames are then drawn at
    /// the display's rate, else the layers' animation runs slower.
    pub fn moving(&self) -> bool {
        self.renderer.view.animating() || !self.live.is_settled()
    }

    /// Where the values of the layers shown go on the picture, as JSON `[{"id", "kind": "heat"
    /// | "power", "value", "x", "y"}]` in device pixels from the top left: each room's heatmap
    /// value at its centre, and each piece's power (W) when the power layer is shown.
    #[wasm_bindgen(js_name = layerLabels)]
    pub fn layer_labels(&self) -> String {
        let mut labels = Vec::new();
        let mut push = |id: &str, kind: &str, value: f64, point: [f64; 3]| {
            if let Some([x, y]) = self.renderer.screen_point(point) {
                labels.push(serde_json::json!({
                    "id": id, "kind": kind, "value": value, "x": x, "y": y,
                }));
            }
        };
        if let (Some(plan), Some(scene)) = (&self.plan, &self.scene)
            && self.layers.heat.is_some()
        {
            for room in room_shapes(plan, scene) {
                if let Some(value) = self.layers.values.get(room.id) {
                    let [x, z] = room.centre;
                    push(room.id, "heat", *value, [x, 1.0, z]);
                }
            }
        }
        if self.renderer.power_layer() {
            for (info, look) in self.elements.iter().zip(&self.live.looks) {
                let [min, max] = info.bounds;
                if power_level(look.power) > 0.0 && min != max {
                    let top = [
                        f64::from(min[0] + max[0]) * 0.5,
                        f64::from(max[1]),
                        f64::from(min[2] + max[2]) * 0.5,
                    ];
                    push(&info.id, "power", f64::from(look.power), top);
                }
            }
        }
        serde_json::Value::Array(labels).to_string()
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

    /// Where the centre of an element is drawn now, as JSON `[x, y]` in device pixels from the
    /// top left, or an empty string (no such element, no geometry, behind the camera).
    #[wasm_bindgen(js_name = screenPoint)]
    pub fn screen_point(&self, id: &str) -> String {
        let Some(info) = self.elements.iter().find(|e| e.id == id) else {
            return String::new();
        };
        let [min, max] = info.bounds;
        if min == max {
            return String::new();
        }
        let centre = [0, 1, 2].map(|k| f64::from(min[k] + max[k]) * 0.5);
        self.renderer
            .screen_point(centre)
            .map(|p| serde_json::json!(p).to_string())
            .unwrap_or_default()
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
    /// `{"id", "type", "name", "room"}` (`room`: the id of the room it is in, maybe empty), or an
    /// empty string.
    pub fn pick(&mut self, x: u32, y: u32) -> String {
        let tag = self.renderer.pick(x, y);
        let Some((index, info)) = usize::from(tag)
            .checked_sub(1)
            .and_then(|i| Some((i, self.elements.get(i)?)))
        else {
            return String::new();
        };
        let name = self
            .plan
            .as_ref()
            .and_then(|plan| plan.elements.get(index))
            .map_or("", Element::name);
        // The room it stands in (a room is its own).
        let room = self
            .scene
            .as_ref()
            .and_then(|scene| scene.rooms.get(usize::from(info.room).checked_sub(1)?))
            .map_or("", String::as_str);
        serde_json::json!({ "id": info.id, "type": info.kind, "name": name, "room": room })
            .to_string()
    }

    /// Figures about the scene, as JSON (for the diagnostics and the performance smoke test).
    pub fn stats(&self) -> String {
        let view = &self.renderer.view;
        let camera = &view.camera;
        let round = |v: f64| (v * 100.0).round() / 100.0;
        serde_json::json!({
            "triangles": self.triangles,
            "groups": view.cuts.len(),
            "planView": view.plan_view,
            "lights": self.renderer.light_count(),
            "lit": self
                .live
                .looks
                .iter()
                .filter(|l| l.strength * (1.0 - l.unavailable) > 0.02)
                .count(),
            "bound": self.bindings.elements.len(),
            "quality": self.renderer.quality().as_str(),
            "camera": {
                "target": camera.target.map(round),
                "distance": round(camera.distance),
                "yaw": round(camera.yaw),
                "pitch": round(camera.pitch),
                "ortho": round(camera.ortho),
            },
        })
        .to_string()
    }

    /// Whether a frame is needed (something changed or an animation is running).
    #[wasm_bindgen(js_name = needsFrame)]
    pub fn needs_frame(&self) -> bool {
        self.renderer.needs_frame() || !self.live.is_settled()
    }

    /// Asks for a new frame even though nothing changed.
    pub fn invalidate(&mut self) {
        self.renderer.invalidate();
    }

    /// Draws one frame. Returns `true` while an animation needs more frames.
    pub fn frame(&mut self, time_ms: f64) -> bool {
        let dt = self.last_frame.map_or(16.0, |last| time_ms - last);
        self.last_frame = Some(time_ms);
        let step = self.live.step(dt);
        if step.looks {
            self.renderer.set_looks(&self.live.looks);
        }
        if step.moving {
            self.rebuild_moving_parts();
        }
        let camera = self.renderer.render(time_ms);
        camera || !self.live.is_settled()
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
