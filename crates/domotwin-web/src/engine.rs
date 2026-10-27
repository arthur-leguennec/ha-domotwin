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
use domotwin_core::live::{EntityState, LiveState, Look, Targets, read_states, targets};
use domotwin_core::model_mesh::ModelMesh;
use domotwin_core::overlay::{Layout, apply, fit, parse_layout};
use domotwin_core::plan::{Element, Furniture, Plan, View, parse_plan_json, read_plan_value};
use domotwin_core::scene::{
    ElementInfo, ModelMeshes, Scene, SceneOptions, build_dynamic, build_home, build_scene_moving,
    stack_plans,
};
use domotwin_core::theme::{Theme, ThemeName, parse_hex};
use domotwin_core::walk::Floor;
use domotwin_core::weather::{Fall, Weather};
use domotwin_core::{ReadError, summarize_plan};
use domotwin_render::lamps::power_level;
use domotwin_render::{CameraFan, CameraTone, GpuHint, QualityPreset, Renderer, Rgb};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext, WebGlContextAttributes};

use crate::automations::AutomationsShown;
use crate::network::NetworkShown;
use crate::people::PeopleShown;
use crate::robots::RobotsShown;
use crate::upkeep::UpkeepShades;

/// How long a tapped camera's view is drawn whole (ms, D-038).
const CAMERA_FOCUS_MS: f64 = 15_000.0;

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
pub(crate) fn plan_error(err: &ReadError) -> JsError {
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

/// The plan with the edit overlay applied, as written by **Export plan**.
///
/// # Errors
///
/// Fails with the JSON error of the plan reader when the result is not a valid plan.
#[wasm_bindgen(js_name = applyLayout)]
pub fn apply_layout_json(plan: &str, layout: &str) -> Result<String, JsError> {
    let source = parse_plan_json(plan.as_bytes()).map_err(|err| plan_error(&err))?;
    let applied = apply(&source, &parse_layout(layout));
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
    /// The canvas's context, to stop drawing once it is lost (the renderer cannot draw on it).
    gl: WebGl2RenderingContext,
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
    /// What each linked camera sees on the floor (element id, camera entity, its storey, plan
    /// points), worked out when the plan shown or the bindings change.
    cones: Vec<(String, String, usize, Vec<[f64; 2]>)>,
    /// What the cameras see is drawn (D-038), and the camera tapped, whose view is drawn whole
    /// until then (frame time, ms).
    camera_views_shown: bool,
    camera_focus: Option<(String, f64)>,
    /// The cameras' tones and focus the renderer was last given; `None` when the fans must be
    /// given again (the plan or the links changed).
    camera_views_sent: Option<Vec<(CameraTone, bool)>>,
    /// The private rooms the viewer may not see (D-039), drawn closed.
    pub(crate) closed_rooms: BTreeSet<String>,
    /// The storeys of the home shown whole (D-028), lowest first; empty for a plan alone.
    pub(crate) home: Vec<HomeStorey>,
    /// The network map, while it is shown (D-031).
    pub(crate) network: Option<NetworkShown>,
    /// The automations whose wires are shown (D-032).
    pub(crate) automations: Option<AutomationsShown>,
    /// Where each piece's upkeep stands, for the upkeep layer (D-033).
    pub(crate) upkeep: UpkeepShades,
    /// The people in their rooms (D-034).
    pub(crate) people: PeopleShown,
    /// The robot vacuums on the floor (D-049).
    pub(crate) robots: RobotsShown,
    /// Where people walk and robots clean on each storey shown, worked out when first needed
    /// after the plans changed.
    pub(crate) floors: Option<Vec<Option<Floor>>>,
}

/// A storey of the home shown whole: its id and name, its plan (its overlay applied) and the
/// height of its floor.
#[derive(Debug, Clone)]
pub(crate) struct HomeStorey {
    id: String,
    name: String,
    plan: Plan,
    elevation: f64,
}

#[wasm_bindgen]
impl Engine {
    /// Creates the engine on a canvas (a WebGL2 context is created on it).
    ///
    /// # Errors
    ///
    /// Fails with `webgl2_unavailable` when the browser cannot create a WebGL2 context, and with
    /// `context_lost` when the canvas's context is already lost.
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
        // A lost context answers nothing (not even its extensions), which the renderer cannot take.
        if gl.is_context_lost() {
            return Err(JsError::new("context_lost"));
        }
        let gpu = gpu_hint(&gl);
        // three-d takes the GL context in an `Arc`; WebAssembly here is single-threaded.
        #[allow(clippy::arc_with_non_send_sync)]
        let renderer = Renderer::new(
            Arc::new(glow::Context::from_webgl2_context(gl.clone())),
            canvas.width(),
            canvas.height(),
        )
        .map_err(|_| JsError::new("webgl2_unavailable"))?;
        let mut engine = Engine {
            renderer,
            gl,
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
            cones: Vec::new(),
            camera_views_shown: true,
            camera_focus: None,
            camera_views_sent: None,
            closed_rooms: BTreeSet::new(),
            home: Vec::new(),
            network: None,
            automations: None,
            upkeep: UpkeepShades::new(),
            people: PeopleShown::default(),
            robots: RobotsShown::default(),
            floors: None,
        };
        engine
            .renderer
            .set_quality(QualityPreset::from_hint(&engine.gpu));
        Ok(engine)
    }

    /// Loads a plan (the text of a `*.domotwin.json`) with its edit overlay (`layout`, JSON) and
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
        let keep = keep_camera.unwrap_or(false) && self.plan.is_some() && self.home.is_empty();
        self.home.clear();
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

    /// Loads every storey of the home to show it whole (D-028): JSON `[{"id", "name",
    /// "elevation", "plan", "layout"}]`, each plan with its overlay. The storeys stand at their
    /// heights, spread apart or not ([`Engine::set_spread`]), the roof over the top one. Returns
    /// the summary of the whole home with `storeys`. Edit mode needs a storey alone
    /// ([`Engine::load_plan`]).
    ///
    /// # Errors
    ///
    /// Fails with the JSON error of the plan reader for a storey's plan (`storey` names it), or
    /// `{"code": "no_storeys"}` without a storey.
    #[wasm_bindgen(js_name = loadStoreys)]
    pub fn load_storeys(
        &mut self,
        json: &str,
        keep_camera: Option<bool>,
    ) -> Result<String, JsError> {
        let value: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
        let mut home = Vec::new();
        for entry in value.as_array().map_or(&[][..], Vec::as_slice) {
            let id = entry
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let text = entry
                .get("plan")
                .map(ToString::to_string)
                .unwrap_or_default();
            let storey_error = |err: &ReadError| {
                let mut value: serde_json::Value =
                    serde_json::from_str(&err.to_json()).unwrap_or_default();
                value["storey"] = id.into();
                JsError::new(&value.to_string())
            };
            let source = parse_plan_json(text.as_bytes()).map_err(|err| storey_error(&err))?;
            let layout = entry
                .get("layout")
                .map_or_else(Layout::new, |l| parse_layout(&l.to_string()));
            let (plan, _, _) = fit(&source, &layout).map_err(|err| storey_error(&err))?;
            let elevation = entry
                .get("elevation")
                .and_then(serde_json::Value::as_f64)
                .filter(|e| e.is_finite())
                .unwrap_or(0.0);
            home.push(HomeStorey {
                id: id.to_owned(),
                name: entry
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                plan,
                elevation,
            });
        }
        if home.is_empty() {
            return Err(JsError::new(r#"{"code":"no_storeys"}"#));
        }
        home.sort_by(|a, b| a.elevation.total_cmp(&b.elevation));
        let keep = keep_camera.unwrap_or(false) && !self.home.is_empty();
        self.home = home;
        self.source = None;
        self.layout = Layout::new();
        self.edit = None;
        self.drag_built = false;
        self.renderer.set_marks(&[]);
        let stacked = self.show_home(keep, true);
        let mut summary: serde_json::Value =
            serde_json::from_str(&stacked.summary().to_json()).unwrap_or_default();
        summary["storeys"] = self.home.len().into();
        Ok(summary.to_string())
    }

    /// Spreads the storeys of the home shown whole apart, or stacks them (animated from
    /// `time_ms`); the camera frames the home as it will be.
    #[wasm_bindgen(js_name = setSpread)]
    pub fn set_spread(&mut self, spread: bool, time_ms: f64) {
        self.renderer.set_spread(spread, time_ms);
    }

    /// Shows or hides the roof over the top storey of the home shown whole.
    #[wasm_bindgen(js_name = setRoof)]
    pub fn set_roof(&mut self, shown: bool) {
        self.renderer.set_roof(shown);
    }

    /// Where each storey of the home shown whole is, as JSON `[{"id", "name", "x", "y", "top"}]`
    /// in device pixels from the top left, where its label goes: in 3D, the rightmost corner of
    /// the storey halfway up its walls; on the 2D plan (`top`), the middle of its top edge.
    /// Storeys behind the camera are left out.
    #[wasm_bindgen(js_name = storeyLabels)]
    pub fn storey_labels(&self) -> String {
        let view = &self.renderer.view;
        let top = view.plan_view;
        let labels: Vec<serde_json::Value> = self
            .home
            .iter()
            .enumerate()
            .filter_map(|(k, storey)| {
                let [min, max] = view.storey_bounds(k)?;
                let y = if top {
                    view.wall_height
                } else {
                    view.wall_height * 0.5
                };
                let corners: Vec<[f64; 2]> = [
                    [min[0], y, min[2]],
                    [max[0], y, min[2]],
                    [max[0], y, max[2]],
                    [min[0], y, max[2]],
                ]
                .into_iter()
                .filter_map(|c| self.renderer.screen_point(view.place(k, c)))
                .collect();
                let [x, y] = if top {
                    let (left, right) = corners
                        .iter()
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, r), p| {
                            (l.min(p[0]), r.max(p[0]))
                        });
                    let up = corners.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
                    [f64::midpoint(left, right), up]
                } else {
                    *corners.iter().max_by(|a, b| a[0].total_cmp(&b[0]))?
                };
                (x.is_finite() && y.is_finite()).then(|| {
                    serde_json::json!({
                        "id": storey.id, "name": storey.name, "x": x, "y": y, "top": top,
                    })
                })
            })
            .collect();
        serde_json::Value::Array(labels).to_string()
    }

    /// A picture of storey `index` (lowest first) of the home shown whole, alone, seen from above
    /// a corner: `width` × `height` RGBA pixels, rows from the top (its thumbnail). Empty without
    /// that storey.
    #[wasm_bindgen(js_name = storeyPicture)]
    pub fn storey_picture(&mut self, index: usize, width: u32, height: u32) -> Vec<u8> {
        self.renderer
            .picture(index, width, height)
            .unwrap_or_default()
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
        // A plan alone, not the home shown whole.
        self.home.clear();
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
        let options = self.scene_options();
        let scene = build_scene_moving(&plan, &options, moving);
        self.put(plan, scene, keep_camera, &old, fresh);
    }

    /// Shows a plan of a piece alone (the catalogue's pictures, D-074) under a ceiling at
    /// `wall_height`: a hood's chimney or a stove's flue reaches up to it, not to a room's.
    pub(crate) fn show_piece(&mut self, plan: Plan, wall_height: f64) {
        let options = SceneOptions {
            wall_height,
            ..self.scene_options()
        };
        let scene = build_scene_moving(&plan, &options, &BTreeSet::new());
        self.put(plan, scene, false, &[], true);
    }

    fn scene_options(&mut self) -> SceneOptions {
        self.models_dirty = false;
        SceneOptions {
            models: Rc::clone(&self.models),
            closed_rooms: self.closed_rooms.clone(),
            ..SceneOptions::default()
        }
    }

    /// Builds and uploads the scene of the home shown whole. Returns its plan (every storey's
    /// elements).
    fn show_home(&mut self, keep_camera: bool, fresh: bool) -> Plan {
        let options = self.scene_options();
        let storeys: Vec<(&Plan, f64)> = self.home.iter().map(|s| (&s.plan, s.elevation)).collect();
        let plans: Vec<&Plan> = storeys.iter().map(|(p, _)| *p).collect();
        let scene = build_home(&storeys, &options);
        let stacked = stack_plans(&plans).unwrap_or_else(|| self.home[0].plan.clone());
        let old: Vec<Option<usize>> = (0..stacked.elements.len()).map(Some).collect();
        self.put(stacked.clone(), scene, keep_camera, &old, fresh);
        stacked
    }

    /// Shows a scene built from `plan`: uploads it and sets its live looks (from their targets
    /// when `fresh`, else each element keeps fading from where it was, `old` giving its index
    /// before).
    fn put(
        &mut self,
        plan: Plan,
        mut scene: Scene,
        keep_camera: bool,
        old: &[Option<usize>],
        fresh: bool,
    ) {
        self.triangles = scene.triangle_count();
        self.renderer.set_scene(&scene, keep_camera);
        if self.renderer.view.walking()
            && let Some(floor) = scene.walk_floor(&plan)
        {
            // The plan saved again, or another storey, while walking: its walls and doors as they
            // are now.
            let height = self.renderer.view.offset(0)[1];
            self.renderer.view.set_walk_floor(floor, height);
        }
        // The meshes live on the GPU now: free the copies.
        scene.drop_meshes();
        self.elements.clone_from(&scene.elements);
        self.plan = Some(plan);
        self.scene = Some(scene);
        let targets = self.live_targets().unwrap_or_default();
        if fresh {
            self.live = LiveState::new(targets);
        } else {
            self.live.retarget_moved(targets, old);
        }
        self.renderer.set_looks(&self.live.looks);
        self.rebuild_moving_parts();
        self.upload_rooms();
        self.update_cones();
        self.place_network();
        self.place_automations();
        self.place_upkeep();
        self.floors = None;
        self.replace_people();
        self.place_robots(true);
    }

    /// Shows no plan (a new plan drawn and dropped).
    pub(crate) fn clear_plan(&mut self) {
        self.home.clear();
        self.renderer.clear_scene();
        self.renderer.set_marks(&[]);
        self.plan = None;
        self.scene = None;
        self.elements.clear();
        self.triangles = 0;
        self.live = LiveState::default();
        self.renderer.set_looks(&self.live.looks);
        self.cones.clear();
        self.camera_focus = None;
        self.camera_views_sent = None;
        self.upload_camera_views();
        self.drop_network_wires();
        self.drop_automation_wires();
        self.renderer.set_upkeep(&[]);
        self.floors = None;
        self.replace_people();
        self.place_robots(true);
    }

    /// Works out what the linked cameras see (`DECISIONS.md`, D-024), and gives it to the
    /// renderer when it changed (D-038).
    fn update_cones(&mut self) {
        let cones = self.work_out_cones();
        if cones != self.cones {
            self.cones = cones;
            self.camera_views_sent = None;
        }
        // A camera tapped and since unlinked is forgotten.
        if let Some((focus, _)) = &self.camera_focus
            && !self.cones.iter().any(|(id, ..)| id == focus)
        {
            self.camera_focus = None;
        }
        self.upload_camera_views();
    }

    /// What each linked camera sees on the floor of the plan shown (element id, camera entity,
    /// its storey, plan points).
    fn work_out_cones(&self) -> Vec<(String, String, usize, Vec<[f64; 2]>)> {
        let mut cones = Vec::new();
        let (Some(plan), Some(scene)) = (&self.plan, &self.scene) else {
            return cones;
        };
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
            // Not of a piece left out (in a room drawn closed, D-039).
            if self.elements.get(index).is_some_and(|e| e.top().is_none()) {
                continue;
            }
            if let Some(cone) = camera_cone(plan, scene, index, self.bindings.view(id)) {
                let storey = scene.storey_of(index).unwrap_or(0);
                cones.push((id.clone(), camera.entity_id.clone(), storey, cone));
            }
        }
        cones
    }

    /// Gives the renderer what the cameras see, in their tones (D-038), when it changed: states
    /// come often, and most do not touch a camera.
    fn upload_camera_views(&mut self) {
        let looks: Vec<(CameraTone, bool)> = if self.camera_views_shown {
            self.cones
                .iter()
                .map(|(id, entity, ..)| (self.camera_tone(entity), self.camera_focused(id)))
                .collect()
        } else {
            Vec::new()
        };
        if self.camera_views_sent.as_ref() == Some(&looks) {
            return;
        }
        let fans: Vec<CameraFan> = self
            .cones
            .iter()
            .zip(&looks)
            .map(|((_, _, storey, cone), &(tone, focused))| CameraFan {
                storey: *storey,
                points: cone.clone(),
                tone,
                focused,
            })
            .collect();
        self.renderer.set_camera_fans(&fans);
        self.camera_views_sent = Some(looks);
    }

    /// Whether the camera of element `id` was tapped: its view drawn whole (D-038).
    fn camera_focused(&self, id: &str) -> bool {
        self.camera_focus
            .as_ref()
            .is_some_and(|(focus, _)| focus == id)
    }

    /// Recording, on, or off (unavailable or unknown to Home Assistant), as its badge says.
    fn camera_tone(&self, entity: &str) -> CameraTone {
        match self.states.get(entity).map(|s| s.state.as_str()) {
            Some("recording") => CameraTone::Recording,
            None | Some("unavailable") => CameraTone::Off,
            Some(_) => CameraTone::On,
        }
    }

    /// Builds the scene shown again (the plan or the home, an edit session kept in step), the
    /// camera and the looks kept. Returns whether there was one.
    fn build_again(&mut self) -> bool {
        let Some(moving) = self.scene.as_ref().map(|s| s.moving().clone()) else {
            return false;
        };
        if !self.home.is_empty() {
            self.show_home(true, false);
        } else if let Some(plan) = self.plan.take() {
            self.show(plan, true, &moving, false);
            if let (Some(session), Some(plan), Some(scene)) =
                (&mut self.edit, &self.plan, &self.scene)
            {
                session.sync(plan, scene.walls());
            }
        }
        true
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
        let mut seen: Vec<&str> = Vec::new();
        let mut files = Vec::new();
        for (plan, f) in self.drawn_pieces() {
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
        let shown = self.drawn_pieces().into_iter().any(|(plan, f)| {
            f.model
                .as_ref()
                .and_then(|id| plan.models.get(id))
                .and_then(|m| m.get("file"))
                .and_then(|f| f.get("hash"))
                .and_then(serde_json::Value::as_str)
                == Some(hash)
        });
        self.models_dirty |= shown;
        true
    }

    /// The pieces of the plans shown, with their plan, but those of the rooms drawn closed
    /// (D-039): their 3D files are neither fetched nor drawn.
    fn drawn_pieces(&self) -> Vec<(&Plan, &Furniture)> {
        let infos = self.elements_by_id();
        self.plans()
            .into_iter()
            .flat_map(|plan| plan.elements.iter().map(move |e| (plan, e)))
            .filter_map(|(plan, element)| match element {
                Element::Furniture(f)
                    if !infos.get(f.id.as_str()).is_some_and(|i| self.is_closed(i)) =>
                {
                    Some((plan, f))
                }
                _ => None,
            })
            .collect()
    }

    /// Draws the pieces whose 3D file came since the scene was built, in one rebuild for all of
    /// them. Returns whether it did.
    #[wasm_bindgen(js_name = showModels)]
    pub fn show_models(&mut self) -> bool {
        self.models_dirty && self.build_again()
    }

    /// Draws the rooms `ids` (JSON array of element ids) closed, as private rooms the viewer may
    /// not see (D-039): nothing in them, a frosted cover over their floor, no way in. Returns
    /// whether the scene was built again: only when a room it shows closed or opened.
    #[wasm_bindgen(js_name = setPrivateRooms)]
    pub fn set_private_rooms(&mut self, ids: &str) -> bool {
        // Unreadable, nothing changes (rather than opening every room).
        let Ok(closed) = serde_json::from_str::<BTreeSet<String>>(ids) else {
            return false;
        };
        let shown = self.scene.as_ref().is_some_and(|scene| {
            closed
                .symmetric_difference(&self.closed_rooms)
                .any(|id| scene.rooms.contains(id))
        });
        self.closed_rooms = closed;
        shown && self.build_again()
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
        self.update_cones();
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
        self.upload_camera_views();
    }

    /// Flashes an element briefly (tap feedback).
    pub fn highlight(&mut self, id: &str) {
        if let Some(index) = self.elements.iter().position(|e| e.id == id) {
            self.live.highlight(index);
            self.renderer.set_looks(&self.live.looks);
        }
    }

    fn retarget(&mut self) {
        if let Some(targets) = self.live_targets() {
            self.live.set_targets(targets);
            self.renderer.invalidate();
        }
    }

    /// What the elements of the scene shown look like from the states of their entities. The
    /// doors and windows of a private room the viewer may not see are drawn as without Home
    /// Assistant: their states would tell what goes on in it (D-039).
    fn live_targets(&self) -> Option<Targets> {
        let (plan, scene) = (self.plan.as_ref()?, self.scene.as_ref()?);
        let mut targets = targets(plan, &scene.lights, &self.bindings, &self.states);
        if !self.closed_rooms.is_empty() {
            for (index, info) in self.elements.iter().enumerate() {
                if self.is_closed(info) {
                    if let Some(look) = targets.looks.get_mut(index) {
                        *look = Look::default();
                    }
                    targets.overrides.open.remove(&index);
                    targets.overrides.blind.remove(&index);
                }
            }
        }
        Some(targets)
    }

    pub(crate) fn rebuild_moving_parts(&mut self) {
        if let (Some(plan), Some(scene)) = (&self.plan, &self.scene) {
            let parts = build_dynamic(plan, scene, &self.live.overrides);
            self.renderer.set_moving_parts(&parts);
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

    /// Sets the look (D-027, D-036): `day`, `neon`, `blueprint`, `cartoon` or `clay` (anything else:
    /// `day`), with an accent colour `#rrggbb` (anything else: the look's own, D-048). Returns the
    /// look's name.
    #[wasm_bindgen(js_name = setTheme)]
    pub fn set_theme(&mut self, name: &str, accent: &str) -> String {
        let theme = ThemeName::from_name(name).unwrap_or_default();
        let accent = parse_hex(accent).unwrap_or_else(|| theme.default_accent());
        self.renderer.set_theme(Theme::new(theme, accent));
        theme.name().to_owned()
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

    /// Draws the weather around the home (D-072) for one of Home Assistant's conditions
    /// (`rainy`, `snowy`, `fog`…; any other is a clear sky), with its wind: `wind_speed` in m/s
    /// and `wind_bearing` in degrees clockwise from north where it comes from (`NaN`: unknown), for
    /// a plan whose north is `north` degrees clockwise from its top.
    #[wasm_bindgen(js_name = setWeather)]
    pub fn set_weather(&mut self, condition: &str, wind_speed: f64, wind_bearing: f64, north: f64) {
        let known = |v: f64| v.is_finite().then_some(v);
        self.renderer.set_weather(Weather::from_condition(
            condition,
            known(wind_speed),
            known(wind_bearing),
            north,
        ));
    }

    /// What falls around the home now: `none`, `rain`, `snow`, `sleet` or `hail` (D-072).
    #[wasm_bindgen(getter)]
    pub fn weather(&self) -> String {
        match self.renderer.weather().fall {
            Fall::None => "none",
            Fall::Rain => "rain",
            Fall::Snow => "snow",
            Fall::Sleet => "sleet",
            Fall::Hail => "hail",
        }
        .to_owned()
    }

    /// Shows the room layers: JSON `{"heat": "temperature", "values": {room id: value},
    /// "peak": {room id: "preheat" | "shed" | "heating"}, "draws": {room id: watts},
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
        let changed = motion != self.renderer.motion();
        self.renderer.set_motion(motion);
        if changed {
            // The robots at rest, or on their way again.
            self.place_robots(false);
        }
    }

    /// Whether the layers shown move, or a robot vacuum (D-049): a frame is then needed all the
    /// time, and the frontend draws fewer per second.
    #[wasm_bindgen(js_name = layersAnimating)]
    pub fn layers_animating(&self) -> bool {
        self.renderer.layers_animating() || self.robots_moving()
    }

    /// Draws what the linked cameras see on the floor, or not (D-038).
    #[wasm_bindgen(js_name = setCameraViews)]
    pub fn set_camera_views(&mut self, shown: bool) {
        if shown != self.camera_views_shown {
            self.camera_views_shown = shown;
            self.upload_camera_views();
        }
    }

    /// Draws the view of the camera linked to element `id` whole from `time_ms` (the frames'
    /// clock) for a while, the others faint (D-038); another id, or none, draws them all faint.
    /// Returns how long it is drawn whole (ms), 0 when `id` is no camera's: a frame is needed
    /// then for it to go faint again.
    #[wasm_bindgen(js_name = focusCamera)]
    pub fn focus_camera(&mut self, id: &str, time_ms: f64) -> f64 {
        let camera = self.cones.iter().any(|(cone, ..)| cone == id);
        self.camera_focus = camera.then(|| (id.to_owned(), time_ms + CAMERA_FOCUS_MS));
        self.upload_camera_views();
        if camera { CAMERA_FOCUS_MS } else { 0.0 }
    }

    /// Where what the linked cameras see is on the screen, as JSON `[{"id", "entity", "points":
    /// [[x, y]…]}]` in device pixels from the top left: each camera's fan cut to its room
    /// (`DECISIONS.md`, D-024), the camera first. A fan partly behind the camera of the view is
    /// left out. The engine draws them (D-038); these points are for tests and tools.
    #[wasm_bindgen(js_name = cameraViews)]
    pub fn camera_views(&self) -> String {
        let views: Vec<serde_json::Value> = self
            .cones
            .iter()
            .filter_map(|(id, entity, storey, cone)| {
                let view = &self.renderer.view;
                let points: Option<Vec<[f64; 2]>> = cone
                    .iter()
                    .map(|p| {
                        self.renderer
                            .screen_point(view.place(*storey, [p[0], 1.0, p[1]]))
                    })
                    .collect();
                points.map(
                    |points| serde_json::json!({ "id": id, "entity": entity, "points": points }),
                )
            })
            .collect();
        serde_json::Value::Array(views).to_string()
    }

    /// The elements of the plan shown (the edit overlay applied), as JSON `[{"id", "type", "name",
    /// "kind"}]` (`kind` for furniture only).
    #[wasm_bindgen(js_name = elementList)]
    pub fn element_list(&self) -> String {
        let infos = self.elements_by_id();
        let list: Vec<serde_json::Value> = self
            .plan
            .iter()
            .flat_map(|plan| &plan.elements)
            .map(|element| {
                let mut entry = serde_json::json!({ "id": element.id(), "name": element.name() });
                // The room a piece, a door or a window is in, as drawn (a door, of the side drawn
                // with it, and the room on its other side); a piece left out keeps its (D-039).
                if let Element::Furniture(_) | Element::Door(_) | Element::Window(_) = element
                    && let Some(info) = infos.get(element.id())
                {
                    if let Some(room) = self.room_of(info) {
                        entry["room"] = room.as_str().into();
                    }
                    if let Some(room) = self.room_in_slot(info.beside) {
                        entry["beside"] = room.as_str().into();
                    }
                }
                let (kind, piece) = match element {
                    Element::Room(_) => ("room", None),
                    Element::Wall(_) => ("wall", None),
                    Element::Door(_) => ("door", None),
                    Element::Window(_) => ("window", None),
                    Element::Furniture(f) => ("furniture", Some(f.kind.name())),
                };
                entry["type"] = kind.into();
                if let Some(piece) = piece {
                    entry["kind"] = piece.into();
                }
                entry
            })
            .collect();
        serde_json::Value::Array(list).to_string()
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
            if let Some(point) = self
                .top_of(info)
                .and_then(|top| self.renderer.screen_point(top))
            {
                points.insert(id, serde_json::json!(point));
            }
        }
        serde_json::Value::Object(points).to_string()
    }

    /// Whether a camera move, a wall animation, a fade or someone walking is running: frames are
    /// then drawn at the display's rate (and what is drawn over the picture follows), else the
    /// layers' animation runs slower.
    pub fn moving(&self) -> bool {
        self.renderer.view.animating() || !self.live.is_settled() || self.people_moving()
    }

    /// Where the values of the layers shown go on the picture, as JSON `[{"id", "kind": "heat"
    /// | "draw" | "power", "value", "x", "y"}]` in device pixels from the top left: each room's
    /// heatmap value, or what it draws (W, D-063), at its centre, and each piece's power (W) when
    /// the power layer is shown.
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
        let heat = self.layers.heat.is_some();
        if let (Some(plan), Some(scene)) = (&self.plan, &self.scene)
            && (heat || !self.layers.draws.is_empty())
        {
            for room in room_shapes(plan, scene) {
                let value = heat
                    .then(|| self.layers.values.get(room.id).map(|v| ("heat", *v)))
                    .flatten()
                    .or_else(|| self.layers.draws.get(room.id).map(|w| ("draw", *w)));
                if let Some((kind, value)) = value {
                    let [x, z] = room.label;
                    let at = self.renderer.view.place(room.storey, [x, 1.0, z]);
                    push(room.id, kind, value, at);
                }
            }
        }
        if self.renderer.power_layer() {
            for (info, look) in self.elements.iter().zip(&self.live.looks) {
                if let Some(top) = self.top_of(info).filter(|_| power_level(look.power) > 0.0) {
                    push(&info.id, "power", f64::from(look.power), top);
                }
            }
        }
        serde_json::Value::Array(labels).to_string()
    }

    /// Where the rooms' names go on the picture, as JSON `[{"id", "name", "x", "y", "area"}]` in
    /// device pixels from the top left: the middle of each room's floor, and its area (m²).
    #[wasm_bindgen(js_name = roomLabels)]
    pub fn room_labels(&self) -> String {
        let mut labels = Vec::new();
        if let (Some(plan), Some(scene)) = (&self.plan, &self.scene) {
            for room in room_shapes(plan, scene) {
                let name = plan.element(room.id).map_or("", Element::name);
                let [x, z] = room.label;
                let at = self.renderer.view.place(room.storey, [x, 1.0, z]);
                if let Some([sx, sy]) = self.renderer.screen_point(at) {
                    labels.push(serde_json::json!({
                        "id": room.id, "name": name, "x": sx, "y": sy, "area": room.area,
                    }));
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

    /// Starts walking through the storey shown at eye level (D-029), or stops (back to the
    /// camera before), animated from `time_ms`. Returns whether walking: not with every storey
    /// shown, without a plan or in edit mode.
    #[wasm_bindgen(js_name = setWalk)]
    pub fn set_walk(&mut self, on: bool, time_ms: f64) -> bool {
        if !on || !self.home.is_empty() || self.edit.is_some() {
            self.renderer.view.stop_walk(time_ms);
            return false;
        }
        let Some(floor) = self
            .plan
            .as_ref()
            .zip(self.scene.as_ref())
            .and_then(|(plan, scene)| scene.walk_floor(plan))
        else {
            return false;
        };
        let height = self.renderer.view.offset(0)[1];
        self.renderer.view.start_walk(floor, height, time_ms);
        true
    }

    /// Whether walking through the storey shown.
    #[wasm_bindgen(getter)]
    pub fn walking(&self) -> bool {
        self.renderer.view.walking()
    }

    /// Whether the kiosk's slow turn is moving the camera: frames go on, slowly.
    #[wasm_bindgen(getter)]
    pub fn orbiting(&self) -> bool {
        self.renderer.view.orbiting()
    }

    /// Walking: moves on its own ahead and to the right (−1…1 each, 0 to stop) while a key or
    /// the pad is held.
    #[wasm_bindgen(js_name = setWalkVelocity)]
    pub fn set_walk_velocity(&mut self, ahead: f64, right: f64) {
        self.renderer.view.set_walk_velocity(ahead, right);
    }

    /// Walking: walks to the floor under the device pixel `x`, `y` (through the doors). Returns
    /// whether the floor is there, in sight (not behind a wall tapped).
    #[wasm_bindgen(js_name = walkTo)]
    pub fn walk_to(&mut self, x: f64, y: f64) -> bool {
        if !self.renderer.view.walking() {
            return false;
        }
        let floor = self.renderer.view.offset(0)[1];
        let Some(p) = self.renderer.plane_point(x, y, floor) else {
            return false;
        };
        if !self.renderer.view.sees([p[0], p[2]]) {
            return false;
        }
        self.renderer.view.walk_to([p[0], p[2]]);
        true
    }

    /// The kiosk's slow turn around the home while nobody touches it (radians per second, 0 to
    /// stop); a gesture stops it.
    #[wasm_bindgen(js_name = setAutoOrbit)]
    pub fn set_auto_orbit(&mut self, per_second: f64) {
        self.renderer.view.set_auto_orbit(per_second);
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
        let view = &self.renderer.view;
        let low = view.place(info.storey, [widen(min[0]), 0.0, widen(min[2])]);
        let high = view.place(info.storey, [widen(max[0]), widen(max[1]), widen(max[2])]);
        let inside = if info.kind == "room" {
            view.room_spot(id)
        } else {
            None
        };
        self.renderer.view.focus([low, high], inside, time_ms);
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
        let centre = self.renderer.view.place(
            info.storey,
            [0, 1, 2].map(|k| f64::from(min[k] + max[k]) * 0.5),
        );
        self.renderer
            .screen_point(centre)
            .map(|p| serde_json::json!(p).to_string())
            .unwrap_or_default()
    }

    /// The plan's saved viewpoints, as JSON `[{"id", "name"}]`.
    pub fn views(&self) -> String {
        let list: Vec<serde_json::Value> = self
            .plan
            .iter()
            .flat_map(|plan| &plan.views)
            .map(|View::Orbit { id, name, .. }| serde_json::json!({ "id": id, "name": name }))
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
        self.renderer
            .view
            .show_camera(Camera::from_view(position, target), time_ms);
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
        let room = self.room_of(info).map_or("", String::as_str);
        let mut picked =
            serde_json::json!({ "id": info.id, "type": info.kind, "name": name, "room": room });
        if let Some(storey) = self.home.get(info.storey) {
            picked["storey"] = storey.id.clone().into();
        }
        picked.to_string()
    }

    /// Figures about the scene, as JSON (for the diagnostics and the performance smoke test).
    pub fn stats(&self) -> String {
        let view = &self.renderer.view;
        let camera = &view.camera;
        let round = |v: f64| (v * 100.0).round() / 100.0;
        let (offscreen, bloom, ink) = self.renderer.effects();
        serde_json::json!({
            "triangles": self.triangles,
            "groups": view.cuts.len(),
            "planView": view.plan_view,
            "walking": view.walking(),
            "lights": self.renderer.light_count(),
            "lit": self
                .live
                .looks
                .iter()
                .filter(|l| l.strength * (1.0 - l.unavailable) > 0.02)
                .count(),
            "bound": self.bindings.elements.len(),
            "quality": self.renderer.quality().as_str(),
            "theme": self.renderer.theme().name.name(),
            // The rooms drawn closed (D-039) among those of the scene shown.
            "closedRooms": self.scene.as_ref().map(|s| s.closed.iter().collect::<Vec<_>>()),
            // What the cameras see, as given to the renderer and drawn: not at eye level.
            "cameraViews": match &self.camera_views_sent {
                Some(sent) if self.renderer.camera_fans_drawable() => self
                    .cones
                    .iter()
                    .zip(sent)
                    .map(|((id, ..), (tone, focused))| {
                        serde_json::json!({ "id": id, "tone": tone.as_str(), "focused": focused })
                    })
                    .collect::<Vec<_>>(),
                _ => Vec::new(),
            },
            "offscreen": { "on": offscreen, "bloom": bloom, "ink": ink },
            "lines": self
                .scene
                .as_ref()
                .map_or(0, |scene| scene.parts.iter().map(|p| p.lines.len()).sum::<usize>()),
            "storeys": view.storey_count(),
            "spread": view.spread(),
            "roof": view.roof_offset().is_some(),
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
        self.renderer.needs_frame()
            || !self.live.is_settled()
            || self.people_moving()
            || self.robots_moving()
    }

    /// Asks for a new frame even though nothing changed.
    pub fn invalidate(&mut self) {
        self.renderer.invalidate();
    }

    /// Draws one frame. Returns `true` while an animation needs more frames. Draws nothing once
    /// the context is lost: the view starts again on a fresh canvas.
    pub fn frame(&mut self, time_ms: f64) -> bool {
        if self.gl.is_context_lost() {
            return false;
        }
        let dt = self.last_frame.map_or(16.0, |last| time_ms - last);
        self.last_frame = Some(time_ms);
        // A tapped camera's view goes faint again after its while (D-038).
        if self
            .camera_focus
            .as_ref()
            .is_some_and(|(_, until)| time_ms >= *until)
        {
            self.camera_focus = None;
            self.upload_camera_views();
        }
        let step = self.live.step(dt);
        if step.looks {
            self.renderer.set_looks(&self.live.looks);
        }
        if step.moving {
            self.rebuild_moving_parts();
        }
        // The figures move only while someone walks or fades, or a robot goes.
        let figures = self.people_moving() || self.robots_moving();
        let people = self.step_people(dt);
        let robots = self.step_robots(dt);
        if figures {
            self.show_figures();
        }
        let camera = self.renderer.render(time_ms);
        camera || !self.live.is_settled() || people || robots
    }
}

impl Engine {
    /// The top of an element's centre where the view draws it, where its labels and badges go;
    /// `None` without geometry.
    fn top_of(&self, info: &ElementInfo) -> Option<[f64; 3]> {
        info.top()
            .map(|top| self.renderer.view.place(info.storey, top.map(f64::from)))
    }

    /// The id of the room an element is in (a room is its own).
    pub(crate) fn room_of(&self, info: &ElementInfo) -> Option<&String> {
        self.room_in_slot(info.room)
    }

    /// The id of the room of a slot of the scene shown.
    fn room_in_slot(&self, slot: u8) -> Option<&String> {
        let slot = usize::from(slot).checked_sub(1)?;
        self.scene.as_ref()?.rooms.get(slot)
    }

    /// Whether an element is drawn closed (D-039): in a private room the viewer may not see, or
    /// a door or a window of one.
    pub(crate) fn is_closed(&self, info: &ElementInfo) -> bool {
        !self.closed_rooms.is_empty()
            && [info.room, info.beside]
                .into_iter()
                .filter_map(|slot| self.room_in_slot(slot))
                .any(|room| self.closed_rooms.contains(room))
    }

    /// The plans shown: every storey's for the home shown whole, else the plan alone.
    fn plans(&self) -> Vec<&Plan> {
        if self.home.is_empty() {
            self.plan.iter().collect()
        } else {
            self.home.iter().map(|s| &s.plan).collect()
        }
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
