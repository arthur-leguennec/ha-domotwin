//! Runs in headless Chromium with `wasm-bindgen-test` (see CONTRIBUTING.md).

#![cfg(target_arch = "wasm32")]
#![allow(clippy::unwrap_used, clippy::panic)]

use domotwin_web::Engine;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::*;
use web_sys::HtmlCanvasElement;

wasm_bindgen_test_configure!(run_in_browser);

const DEMO: &str = include_str!("../../../examples/demo-apartment.plan.json");

fn canvas() -> HtmlCanvasElement {
    let document = web_sys::window().unwrap().document().unwrap();
    let canvas = document
        .create_element("canvas")
        .unwrap()
        .dyn_into::<HtmlCanvasElement>()
        .unwrap();
    canvas.set_width(320);
    canvas.set_height(240);
    canvas
}

#[wasm_bindgen_test]
fn loads_the_demo_plan_and_draws_a_frame() {
    let mut engine = Engine::new(canvas()).unwrap();
    let summary = engine.load_plan(DEMO, None, None).unwrap();
    assert!(summary.contains("\"rooms\":5"), "{summary}");
    assert!(engine.needs_frame());
    assert!(!engine.frame(0.0));
    assert!(!engine.needs_frame());
}

#[wasm_bindgen_test]
fn refuses_a_bad_plan_with_a_code() {
    let mut engine = Engine::new(canvas()).unwrap();
    let Err(err) = engine.load_plan("{}", None, None) else {
        panic!("an empty object is not a plan")
    };
    let message = wasm_bindgen::JsValue::from(err);
    let text = js_sys::Reflect::get(&message, &"message".into())
        .unwrap()
        .as_string()
        .unwrap();
    assert!(text.contains("\"code\""), "{text}");
}

#[wasm_bindgen_test]
fn picks_rooms_and_switches_to_the_plan() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.frame(0.0);
    // The overview frames the home: the centre of the canvas shows something of the plan.
    let picked = engine.pick(160, 120);
    assert!(picked.contains("\"id\""), "{picked}");
    engine.set_plan_view(true, 0.0);
    let mut t = 0.0;
    while engine.frame(t) {
        t += 16.0;
        assert!(t < 5_000.0);
    }
    assert!(engine.plan_view());
    let picked = engine.pick(160, 120);
    assert!(picked.contains("\"type\""), "{picked}");
    assert!(engine.stats().contains("\"triangles\""));
}

#[wasm_bindgen_test]
fn saved_views_and_focus() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    let views = engine.views();
    assert!(views.starts_with('['), "{views}");
    assert!(engine.focus_element("living", 0.0));
    assert!(!engine.focus_element("nothing-here", 0.0));
    assert!(engine.needs_frame());
}

#[wasm_bindgen_test]
fn quality_can_be_forced() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.set_quality("high");
    assert_eq!(engine.quality(), "high");
    engine.set_quality("eco");
    assert_eq!(engine.quality(), "eco");
}

const BINDINGS: &str = include_str!("../../../examples/demo-apartment.bindings.json");

#[wasm_bindgen_test]
fn live_states_light_lamps_and_move_doors() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_bindings(BINDINGS);
    engine.set_states(
        r#"{
            "light.living_room_pendant": { "state": "on", "attributes": { "brightness": 255 } },
            "light.living_room_floor_lamp": { "state": "off", "attributes": {} },
            "binary_sensor.entrance_door_contact": { "state": "on", "attributes": { "device_class": "door" } },
            "media_player.living_room_tv": { "state": "playing", "attributes": {} }
        }"#,
    );
    assert!(engine.needs_frame());
    let mut t = 0.0;
    while engine.frame(t) {
        t += 16.0;
        assert!(t < 10_000.0, "the fades end");
    }
    let stats = engine.stats();
    assert!(stats.contains("\"bound\":"), "{stats}");
    assert!(!engine.needs_frame());
    engine.highlight("pendant-living");
    assert!(engine.needs_frame());
    // Forgetting an entity greys its lamp out, without breaking anything.
    engine.set_states(r#"{ "light.living_room_pendant": null }"#);
    while engine.frame(t) {
        t += 16.0;
    }
}

#[wasm_bindgen_test]
fn edit_mode_moves_turns_adds_and_undoes() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_plan_view(true, 0.0);
    let mut t = 0.0;
    while engine.frame(t) {
        t += 16.0;
    }
    let state = engine.begin_edit();
    assert!(state.contains("\"editing\":true"), "{state}");
    let state = engine.edit_select("sofa", false);
    assert!(state.contains("\"id\":\"sofa\""), "{state}");
    let [x, y]: [f64; 2] = serde_json::from_str(&engine.screen_point("sofa")).unwrap();
    assert!(engine.edit_drag_start(x, y), "the sofa is under its centre");
    let state = engine.edit_drag_move(x - 25.0, y);
    assert!(state.contains("\"guides\":[{"), "{state}");
    engine.frame(t);
    let state = engine.edit_drag_end();
    assert!(state.contains("\"dirty\":true"), "{state}");
    assert!(engine.edit_layout().contains("\"sofa\""));
    let state = engine.edit_rotate(1);
    assert!(state.contains("\"canUndo\":true"), "{state}");
    assert!(engine.edit_layout().contains("\"angle\":15"));
    engine.edit_add("plant", "Plant", x, y);
    assert!(engine.edit_layout().contains("plant-added-1"));
    for _ in 0..3 {
        engine.edit_undo();
    }
    let state = engine.edit_state();
    assert!(state.contains("\"dirty\":false"), "{state}");
    assert_eq!(engine.edit_layout(), "{}");
    engine.edit_redo();
    // Saved what was sent: the turn made since stays to be saved.
    let sent = engine.edit_layout();
    engine.edit_select("sofa", false);
    engine.edit_rotate(1);
    engine.edit_saved(&sent);
    assert!(engine.edit_state().contains("\"dirty\":true"));
    engine.edit_undo();
    assert!(engine.edit_state().contains("\"dirty\":false"));
    engine.end_edit(false);
    assert!(engine.edit_state().contains("\"editing\":false"));
    assert!(Engine::edit_catalogue().contains("\"kind\":\"sofa\""));
    assert!(!engine.edit_drag_start(x, y), "not editing");
}

#[wasm_bindgen_test]
fn an_overlay_the_plan_refuses_is_left_out_entry_by_entry() {
    let mut engine = Engine::new(canvas()).unwrap();
    let layout =
        r#"{"sofa":{"x":200},"bad-added-1":{"add":{"name":"Bad","kind":"lamp","w":35,"h":35}}}"#;
    let summary = engine
        .load_plan(DEMO, None, Some(layout.to_owned()))
        .unwrap();
    assert!(summary.contains("\"layoutRefused\":1"), "{summary}");
    engine.begin_edit();
    assert_eq!(engine.edit_layout(), r#"{"sofa":{"x":200.0}}"#);
}

/// A `DTM1` mesh (as the model module writes it) of one triangle.
fn triangle_mesh() -> Vec<u8> {
    let mut out = b"DTM1".to_vec();
    out.extend_from_slice(&3_u32.to_le_bytes());
    out.extend_from_slice(&3_u32.to_le_bytes());
    for p in [[0.0_f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 1.0]] {
        for c in p {
            out.extend_from_slice(&c.to_le_bytes());
        }
    }
    out.extend_from_slice(&[0, 0, 127, 1].repeat(3));
    out.extend_from_slice(&[200, 100, 50, 128].repeat(3));
    for i in 0_u32..3 {
        out.extend_from_slice(&i.to_le_bytes());
    }
    out
}

fn triangles(engine: &Engine) -> u64 {
    let stats: serde_json::Value = serde_json::from_str(&engine.stats()).unwrap();
    stats["triangles"].as_u64().unwrap()
}

#[wasm_bindgen_test]
fn pieces_of_3d_files_are_boxes_until_their_mesh_comes() {
    let hash = "c".repeat(64);
    let mut plan: serde_json::Value = serde_json::from_str(DEMO).unwrap();
    plan["models"] = serde_json::json!({ "m-1": { "name": "Stool", "size": [38, 38, 71],
        "file": { "format": "glb", "hash": hash, "bytes": 100, "up": "y" } } });
    let elements = plan["elements"].as_array_mut().unwrap();
    for (id, x) in [("stool-1", 300), ("stool-2", 340)] {
        elements.push(
            serde_json::json!({ "id": id, "type": "furniture", "name": "Stool",
            "x": x, "y": 150, "w": 38, "h": 38, "z": 71, "kind": "custom", "model": "m-1" }),
        );
    }
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(&plan.to_string(), None, None).unwrap();
    let files: serde_json::Value = serde_json::from_str(&engine.model_files()).unwrap();
    assert_eq!(
        files,
        serde_json::json!([{ "hash": hash, "format": "glb", "bytes": 100 }])
    );
    let boxes = triangles(&engine);
    assert!(!engine.set_model_mesh(&hash, b"DTM1"), "a broken mesh");
    assert!(engine.set_model_mesh(&hash, &triangle_mesh()));
    // Drawn at the next showModels, once for every mesh that came.
    assert_eq!(triangles(&engine), boxes);
    assert!(engine.show_models());
    assert!(!engine.show_models());
    // Two boxes (12 triangles each) became two triangles.
    assert_eq!(triangles(&engine), boxes - 2 * 12 + 2);
    assert_eq!(engine.model_files(), "[]");
    assert_eq!(engine.models_over_budget(), 0);
}

#[wasm_bindgen_test]
fn edit_mode_imports_a_model_and_forgets_it() {
    let hash = "d".repeat(64);
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.begin_edit();
    assert!(engine.set_model_mesh(&hash, &triangle_mesh()));
    let definition = serde_json::json!({ "name": "Lamp", "size": [40, 40, 160],
        "file": { "format": "gltf", "hash": hash, "bytes": 2000, "up": "y" } })
    .to_string();
    let state: serde_json::Value =
        serde_json::from_str(&engine.edit_add_model("m-lamp", &definition, 160.0, 120.0)).unwrap();
    assert_eq!(state["refused"], serde_json::Value::Null, "{state}");
    assert_eq!(state["selection"][0]["kind"], "custom");
    let layout: serde_json::Value = serde_json::from_str(&engine.edit_layout()).unwrap();
    assert_eq!(layout["@model:m-lamp"]["model"]["name"], "Lamp");
    let models: serde_json::Value = serde_json::from_str(&engine.edit_models()).unwrap();
    assert_eq!(models[0]["id"], "m-lamp");
    assert_eq!(
        (
            models[0]["pieces"].as_u64(),
            models[0]["removable"].as_bool()
        ),
        (Some(1), Some(false))
    );
    engine.edit_remove();
    engine.edit_remove_model("m-lamp");
    assert_eq!(engine.edit_models(), "[]");
    // A model with a bad id or without a size is refused.
    let refused: serde_json::Value =
        serde_json::from_str(&engine.edit_add_model("bad id", &definition, 160.0, 120.0)).unwrap();
    assert_eq!(refused["refused"], true);
    let refused: serde_json::Value =
        serde_json::from_str(&engine.edit_add_model("m-2", "{\"name\":\"x\"}", 160.0, 120.0))
            .unwrap();
    assert_eq!(refused["refused"], true);
}

#[wasm_bindgen_test]
fn layers_show_move_and_label() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.frame(0.0);
    assert!(!engine.layers_animating());
    engine.set_layers(
        r#"{"heat": "temperature", "values": {"living": 21.5, "nowhere": 30}, "alerts": {"kitchen": "danger"}}"#,
    );
    assert!(engine.layers_animating());
    assert!(engine.needs_frame());
    assert!(engine.frame(16.0), "a pulsing alert keeps drawing");
    let labels: serde_json::Value = serde_json::from_str(&engine.layer_labels()).unwrap();
    let labels = labels.as_array().unwrap();
    assert_eq!(labels.len(), 1, "{labels:?}");
    assert_eq!(labels[0]["id"], "living");
    assert_eq!(labels[0]["kind"], "heat");
    // Held still for reduced motion: drawn once, then idle.
    engine.set_motion(false);
    assert!(!engine.layers_animating());
    assert!(!engine.frame(32.0));
    assert!(!engine.needs_frame());
    engine.set_motion(true);
    // Presence alone does not move.
    engine.set_layers(r#"{"presence": ["living"]}"#);
    assert!(!engine.layers_animating());
    engine.set_layers("{}");
    assert!(!engine.frame(48.0));
}

#[wasm_bindgen_test]
fn the_power_layer_tints_running_appliances() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_bindings(include_str!(
        "../../../examples/demo-apartment.bindings.json"
    ));
    engine.set_states(
        r#"{"sensor.fridge_power": {"state": "85", "attributes": {"unit_of_measurement": "W"}},
            "sensor.tv_power": {"state": "1", "attributes": {"unit_of_measurement": "W"}}}"#,
    );
    engine.frame(0.0);
    assert_eq!(engine.layer_labels(), "[]", "no labels without the layer");
    engine.set_power_layer(true);
    assert!(engine.layers_animating());
    let labels: serde_json::Value = serde_json::from_str(&engine.layer_labels()).unwrap();
    let labels = labels.as_array().unwrap();
    // The TV on standby is left out.
    assert_eq!(labels.len(), 1, "{labels:?}");
    assert_eq!(labels[0]["id"], "fridge");
    assert_eq!(labels[0]["value"], 85.0);
    engine.set_power_layer(false);
    assert!(!engine.layers_animating());
}

#[wasm_bindgen_test]
fn the_real_sun_and_legends() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.frame(0.0);
    engine.set_sun_position(135.0, 30.0, 20.0);
    assert!(engine.needs_frame());
    assert!(!engine.frame(16.0));
    engine.use_default_sun();
    assert!(engine.needs_frame());
    let legend: serde_json::Value =
        serde_json::from_str(&domotwin_web::heat_legend("co2")).unwrap();
    assert_eq!(legend["unit"], "ppm");
    assert_eq!(legend["gradient"].as_array().unwrap().len(), 16);
    assert_eq!(legend["stops"][0][0], 400.0);
    assert_eq!(domotwin_web::heat_legend("noise"), "");
}

#[wasm_bindgen_test]
fn cameras_see_their_room_and_badges_have_places() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_bindings(include_str!(
        "../../../examples/demo-apartment.bindings.json"
    ));
    engine.frame(0.0);
    let views: serde_json::Value = serde_json::from_str(&engine.camera_views()).unwrap();
    let views = views.as_array().unwrap();
    assert_eq!(views.len(), 1, "{views:?}");
    assert_eq!(views[0]["id"], "bookcase");
    assert_eq!(views[0]["entity"], "camera.living_room");
    assert!(views[0]["points"].as_array().unwrap().len() >= 3);
    let points: serde_json::Value =
        serde_json::from_str(&engine.element_points(r#"["tv", "door-entrance", "nowhere"]"#))
            .unwrap();
    let points = points.as_object().unwrap();
    assert_eq!(points.len(), 2, "{points:?}");
    assert!(points["tv"].as_array().unwrap()[0].as_f64().unwrap() > 0.0);
    assert_eq!(engine.element_points("not json"), "{}");
    let list: serde_json::Value = serde_json::from_str(&engine.element_list()).unwrap();
    let washer = list
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "washer")
        .unwrap();
    assert_eq!(washer["kind"], "washer");
    assert_eq!(washer["type"], "furniture");
    assert_eq!(washer["name"], "Washing machine");
}
