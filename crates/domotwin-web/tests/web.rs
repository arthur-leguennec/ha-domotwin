//! Runs in headless Chromium with `wasm-bindgen-test` (see CONTRIBUTING.md).

#![cfg(target_arch = "wasm32")]
#![allow(clippy::unwrap_used, clippy::panic)]

use domotwin_web::Engine;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::*;
use web_sys::HtmlCanvasElement;

wasm_bindgen_test_configure!(run_in_browser);

const DEMO: &str = include_str!("../../../examples/demo-apartment.domotwin.json");

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

/// Loses the canvas's WebGL2 context, as a GPU reset does.
fn lose_context(canvas: &HtmlCanvasElement) {
    canvas
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::WebGl2RenderingContext>()
        .unwrap()
        .get_extension("WEBGL_lose_context")
        .unwrap()
        .unwrap()
        .unchecked_into::<web_sys::WebglLoseContext>()
        .lose_context();
}

#[wasm_bindgen_test]
fn refuses_a_lost_context_with_a_code() {
    // As a canvas whose context was lost before the engine came (moved off the page meanwhile).
    let canvas = canvas();
    lose_context(&canvas);
    let Err(err) = Engine::new(canvas) else {
        panic!("a lost context cannot draw")
    };
    let message = wasm_bindgen::JsValue::from(err);
    let text = js_sys::Reflect::get(&message, &"message".into())
        .unwrap()
        .as_string()
        .unwrap();
    assert_eq!(text, "context_lost");
}

#[wasm_bindgen_test]
fn draws_nothing_once_its_context_is_lost() {
    let canvas = canvas();
    let mut engine = Engine::new(canvas.clone()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    assert!(!engine.frame(0.0));
    lose_context(&canvas);
    engine.invalidate();
    assert!(!engine.frame(16.0));
    // Nothing was drawn: the frame asked for is still to come.
    assert!(engine.needs_frame());
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
    // The sofa stands turned a quarter in the plan: a step turns it 15° more.
    assert!(engine.edit_layout().contains("\"rotation\":105"));
    engine.edit_add("plant", "Plant", x, y, None);
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
fn the_library_lists_its_styles_adds_them_and_draws_each_piece() {
    // Each style comes with its own size.
    let catalogue: serde_json::Value = serde_json::from_str(&Engine::edit_catalogue()).unwrap();
    let kinds = catalogue.as_array().unwrap();
    assert!(kinds.len() > 100, "{}", kinds.len());
    let speaker = kinds.iter().find(|k| k["kind"] == "speaker").unwrap();
    let soundbar = speaker["styles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["style"] == "soundbar")
        .unwrap();
    assert_eq!(
        (soundbar["w"].as_f64(), soundbar["h"].as_f64()),
        (Some(90.0), Some(7.0))
    );

    // A piece is added in its style, at that style's size.
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.begin_edit();
    let state = engine.edit_add("speaker", "Soundbar", 160.0, 120.0, Some("soundbar".into()));
    assert!(!state.contains("\"refused\""), "{state}");
    let layout: serde_json::Value = serde_json::from_str(&engine.edit_layout()).unwrap();
    let added = &layout["speaker-added-1"]["add"];
    assert_eq!(added["style"], "soundbar", "{layout}");
    assert_eq!(added["size"][0].as_f64(), Some(90.0), "{layout}");
    // An unknown style is no style.
    engine.edit_add(
        "speaker",
        "Speaker",
        160.0,
        120.0,
        Some("gramophone".into()),
    );
    let layout: serde_json::Value = serde_json::from_str(&engine.edit_layout()).unwrap();
    assert!(
        layout["speaker-added-2"]["add"].get("style").is_none(),
        "{layout}"
    );
    engine.end_edit(false);

    // A picture of every piece, in each of its styles, on the background asked.
    let mut artist = Engine::new(canvas()).unwrap();
    let (w, h) = (48, 36);
    let background = [0xf4, 0xf2, 0xee];
    for entry in kinds {
        let kind = entry["kind"].as_str().unwrap();
        let styles = entry["styles"].as_array().unwrap();
        for style in std::iter::once("").chain(styles.iter().map(|s| s["style"].as_str().unwrap()))
        {
            let picture = artist.piece_picture(kind, style, w, h, "#f4f2ee");
            assert_eq!(picture.len(), (w * h * 4) as usize, "{kind} {style}");
            assert_eq!(
                &picture[..3],
                &background,
                "{kind} {style}: the corner is background"
            );
            assert!(
                picture.chunks(4).any(|p| p[..3] != background),
                "{kind} {style} drawn"
            );
        }
    }
    assert!(artist.piece_picture("box", "", w, h, "#ffffff").is_empty());
    assert!(
        artist
            .piece_picture("spaceship", "", w, h, "#ffffff")
            .is_empty()
    );

    // Rows come from the top: a floor lamp's shade is up, its foot down, and a rug lies low.
    let (w, h) = (64, 96);
    let rows = |picture: &[u8], from: u32, to: u32| {
        (from..to)
            .flat_map(|y| (0..w).map(move |x| ((y * w + x) * 4) as usize))
            .filter(|&i| picture[i..i + 3] != background)
            .count()
    };
    let lamp = artist.piece_picture("floor-lamp", "", w, h, "#f4f2ee");
    assert!(
        rows(&lamp, 0, h / 3) > rows(&lamp, h / 3, 2 * h / 3),
        "the shade is at the top"
    );
    // Drawn again, the same piece comes out the same.
    assert_eq!(
        artist.piece_picture("floor-lamp", "", w, h, "#f4f2ee"),
        lamp
    );
}

#[wasm_bindgen_test]
fn an_overlay_the_plan_refuses_is_left_out_entry_by_entry() {
    let mut engine = Engine::new(canvas()).unwrap();
    let layout = r#"{"sofa":{"at":[300,210]},"bad-added-1":{"add":{"name":"Bad","kind":"floor-lamp","size":[35,35]},"at":[10,10]}}"#;
    let summary = engine
        .load_plan(DEMO, None, Some(layout.to_owned()))
        .unwrap();
    assert!(summary.contains("\"layoutRefused\":1"), "{summary}");
    engine.begin_edit();
    assert_eq!(engine.edit_layout(), r#"{"sofa":{"at":[300.0,210.0]}}"#);
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
    let items = plan["items"].as_array_mut().unwrap();
    for (id, x) in [("stool-1", 319), ("stool-2", 359)] {
        items.push(
            serde_json::json!({ "id": id, "name": "Stool", "at": [x, 169],
            "size": [38, 38, 71], "model": "m-1" }),
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
    assert_eq!(state["selection"][0]["kind"], "box");
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
fn the_peak_tints_rooms_and_says_what_they_draw() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.frame(0.0);
    engine.set_layers(
        r#"{"peak": {"living": "shed", "bedroom": "heating"}, "draws": {"bedroom": 1450, "kitchen": 48}}"#,
    );
    assert!(engine.layers_animating(), "the peak's halo moves");
    let labels: serde_json::Value = serde_json::from_str(&engine.layer_labels()).unwrap();
    let mut labels = labels.as_array().unwrap().clone();
    labels.sort_by_key(|label| label["id"].as_str().unwrap_or_default().to_owned());
    assert_eq!(labels.len(), 2, "{labels:?}");
    assert_eq!(
        (&labels[0]["id"], &labels[0]["kind"], &labels[0]["value"]),
        (&"bedroom".into(), &"draw".into(), &1450.0.into())
    );
    assert_eq!(labels[1]["id"], "kitchen");
    // What rooms draw alone is written, not drawn on the floor.
    engine.set_layers(r#"{"draws": {"kitchen": 48}}"#);
    assert!(!engine.layers_animating());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&engine.layer_labels()).unwrap()[0]["kind"],
        "draw"
    );
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
fn the_weather_falls_around_the_home() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.frame(0.0);
    assert_eq!(engine.weather(), "none");
    assert!(!engine.layers_animating());
    // Rain from the west: it falls, and frames go on while it does (D-072).
    engine.set_weather("rainy", 6.0, 270.0, 0.0);
    assert_eq!(engine.weather(), "rain");
    assert!(engine.needs_frame());
    assert!(engine.frame(16.0), "the rain keeps drawing");
    assert!(engine.layers_animating());
    // Held still for reduced motion: a picture of the rain, drawn once.
    engine.set_motion(false);
    assert!(!engine.layers_animating());
    assert!(!engine.frame(32.0));
    engine.set_motion(true);
    // On the plan, nothing falls.
    engine.set_plan_view(true, 48.0);
    for t in 1..40 {
        engine.frame(48.0 + f64::from(t) * 50.0);
    }
    assert!(!engine.layers_animating());
    engine.set_plan_view(false, 2_100.0);
    for t in 1..40 {
        engine.frame(2_100.0 + f64::from(t) * 50.0);
    }
    // Snow, fog and clouds; a storm flashes even without rain; an unknown sky is clear.
    engine.set_weather("snowy", f64::NAN, f64::NAN, 0.0);
    assert_eq!(engine.weather(), "snow");
    engine.set_weather("fog", f64::NAN, f64::NAN, 0.0);
    assert_eq!(engine.weather(), "none");
    assert!(!engine.layers_animating(), "fog holds still");
    engine.set_weather("lightning", 3.0, 90.0, 0.0);
    assert!(engine.layers_animating(), "a storm flashes");
    // Not on the plan, where it does not flash.
    engine.set_plan_view(true, 4_200.0);
    for t in 1..40 {
        engine.frame(4_200.0 + f64::from(t) * 50.0);
    }
    assert!(!engine.layers_animating(), "no storm on the plan");
    engine.set_plan_view(false, 6_200.0);
    engine.set_weather("unavailable", f64::NAN, f64::NAN, 0.0);
    assert_eq!(engine.weather(), "none");
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
    // The room it stands in, as drawn.
    assert_eq!(washer["room"], "bathroom");
}

#[wasm_bindgen_test]
fn what_cameras_see_is_drawn_faint_whole_and_in_its_tone() {
    let surface = canvas();
    let mut engine = Engine::new(surface.clone()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_bindings(BINDINGS);
    let gl = surface
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::WebGl2RenderingContext>()
        .unwrap();
    let views = |engine: &Engine| {
        let stats: serde_json::Value = serde_json::from_str(&engine.stats()).unwrap();
        stats["cameraViews"].clone()
    };
    // A camera Home Assistant does not know is off, as its badge says.
    assert_eq!(
        views(&engine),
        serde_json::json!([{ "id": "bookcase", "tone": "off", "focused": false }])
    );
    engine.set_states(r#"{ "camera.living_room": { "state": "idle", "attributes": {} } }"#);
    assert_eq!(views(&engine)[0]["tone"], "on");
    engine.set_states(r#"{ "camera.living_room": { "state": "unavailable", "attributes": {} } }"#);
    assert_eq!(views(&engine)[0]["tone"], "off");
    engine.set_states(r#"{ "camera.living_room": { "state": "unknown", "attributes": {} } }"#);
    assert_eq!(views(&engine)[0]["tone"], "on");
    for quality in ["eco", "high"] {
        engine.set_quality(quality);
        engine.frame(0.0);
        assert_eq!(
            gl.get_error(),
            web_sys::WebGl2RenderingContext::NO_ERROR,
            "{quality}"
        );
    }
    // The rest on Eco: lighter frames.
    engine.set_quality("eco");
    let mut t = 0.0;
    while engine.frame(t) {
        t += 16.0;
        assert!(t < 10_000.0, "the fades end");
    }
    // Tapped: whole for a while, a frame needed; then faint again by itself.
    let whole = engine.focus_camera("bookcase", t);
    assert!(whole > 1_000.0, "{whole}");
    assert_eq!(views(&engine)[0]["focused"], true);
    assert!(engine.needs_frame());
    engine.frame(t + whole - 16.0);
    assert_eq!(views(&engine)[0]["focused"], true);
    t += whole;
    engine.frame(t);
    assert_eq!(views(&engine)[0]["focused"], false);
    // Tapped, then another piece: faint again at once.
    assert!(engine.focus_camera("bookcase", t) > 0.0);
    assert!(engine.focus_camera("tv", t) <= 0.0);
    assert_eq!(views(&engine)[0]["focused"], false);
    // Recording: red.
    engine.set_states(r#"{ "camera.living_room": { "state": "recording", "attributes": {} } }"#);
    assert_eq!(views(&engine)[0]["tone"], "recording");
    engine.frame(t + 16.0);
    // In the 2D plan, and hidden.
    engine.set_plan_view(true, t + 16.0);
    engine.frame(t + 10_000.0);
    assert_eq!(gl.get_error(), web_sys::WebGl2RenderingContext::NO_ERROR);
    engine.set_camera_views(false);
    assert_eq!(views(&engine), serde_json::json!([]));
    engine.set_camera_views(true);
    assert_eq!(views(&engine).as_array().unwrap().len(), 1);
    // Not while walking.
    t += 10_000.0;
    engine.set_plan_view(false, t);
    engine.frame(t + 10_000.0);
    t += 10_000.0;
    assert!(engine.set_walk(true, t));
    assert_eq!(views(&engine), serde_json::json!([]));
    engine.frame(t + 16.0);
    assert_eq!(gl.get_error(), web_sys::WebGl2RenderingContext::NO_ERROR);
    // Nor on the way back up, only once there.
    t += 10_000.0;
    engine.frame(t);
    assert!(!engine.set_walk(false, t));
    engine.frame(t + 16.0);
    assert_eq!(views(&engine), serde_json::json!([]));
    engine.frame(t + 10_000.0);
    assert_eq!(views(&engine).as_array().unwrap().len(), 1);
    // A camera tapped, then the plan dropped: nothing left, nor tapped when it comes back.
    assert!(engine.focus_camera("bookcase", t + 10_000.0) > 0.0);
    engine.clear_plan_shown();
    assert_eq!(views(&engine), serde_json::json!([]));
    engine.frame(t + 10_016.0);
    assert_eq!(gl.get_error(), web_sys::WebGl2RenderingContext::NO_ERROR);
    engine.load_plan(DEMO, None, None).unwrap();
    assert_eq!(views(&engine)[0]["focused"], false);
}

#[wasm_bindgen_test]
fn a_private_room_is_drawn_closed() {
    let surface = canvas();
    let mut engine = Engine::new(surface.clone()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_bindings(BINDINGS);
    engine.set_states(
        r#"{
            "camera.living_room": { "state": "idle", "attributes": {} },
            "light.living_room_pendant": { "state": "on", "attributes": { "brightness": 255 } }
        }"#,
    );
    let settle = |engine: &mut Engine| {
        let mut t = 0.0;
        while engine.frame(t) {
            t += 16.0;
            assert!(t < 10_000.0, "the fades end");
        }
    };
    let gl = surface
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::WebGl2RenderingContext>()
        .unwrap();
    let stats =
        |engine: &Engine| -> serde_json::Value { serde_json::from_str(&engine.stats()).unwrap() };
    let open = stats(&engine)["triangles"].as_u64().unwrap();
    settle(&mut engine);
    let lit = stats(&engine)["lit"].as_u64().unwrap();
    let sofa: [f64; 2] = serde_json::from_str::<serde_json::Value>(
        &engine.element_points(r#"["sofa"]"#),
    )
    .unwrap()["sofa"]
        .as_array()
        .map(|p| [p[0].as_f64().unwrap(), p[1].as_f64().unwrap()])
        .unwrap();
    assert_eq!(stats(&engine)["cameraViews"].as_array().unwrap().len(), 1);
    // The living room closed: its pieces and its camera's view gone, its floor still there.
    assert!(engine.set_private_rooms(r#"["living"]"#));
    assert!(!engine.set_private_rooms(r#"["living"]"#));
    // A room of another storey: nothing to build again.
    assert!(!engine.set_private_rooms(r#"["living", "upstairs"]"#));
    assert!(stats(&engine)["triangles"].as_u64().unwrap() < open);
    assert_eq!(stats(&engine)["cameraViews"], serde_json::json!([]));
    // Nor are its lamps lit from Home Assistant: their states would tell what goes on in it.
    settle(&mut engine);
    assert!(stats(&engine)["lit"].as_u64().unwrap() < lit);
    // Its door, drawn with the hall, is said to be beside it, for the views to close it too.
    let list: Vec<serde_json::Value> = serde_json::from_str(&engine.element_list()).unwrap();
    let door = list.iter().find(|e| e["id"] == "door-living").unwrap();
    assert_eq!([&door["room"], &door["beside"]], ["hall", "living"]);
    let points = engine.element_points(r#"["sofa", "bed"]"#);
    assert!(
        !points.contains("sofa") && points.contains("bed"),
        "{points}"
    );
    for quality in ["eco", "high"] {
        engine.set_quality(quality);
        engine.frame(0.0);
        assert_eq!(
            gl.get_error(),
            web_sys::WebGl2RenderingContext::NO_ERROR,
            "{quality}"
        );
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let picked = engine.pick(sofa[0] as u32, sofa[1] as u32);
    assert!(!picked.contains("\"sofa\""), "{picked}");
    // The room itself can still be framed.
    engine.set_quality("eco");
    assert!(engine.focus_element("living", 0.0));
    // Open again.
    assert!(engine.set_private_rooms("[]"));
    assert_eq!(stats(&engine)["triangles"].as_u64().unwrap(), open);
    assert_eq!(stats(&engine)["cameraViews"].as_array().unwrap().len(), 1);
    assert!(!engine.set_private_rooms("not json"));
}

#[wasm_bindgen_test]
fn the_plan_editor_s_drafts_are_shown_and_points_turned_both_ways() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_plan_view(true, 0.0);
    let mut t = 0.0;
    while engine.frame(t) {
        t += 16.0;
    }
    // A plan point and back: the same device pixel.
    let p = engine.plan_point(160.0, 120.0);
    assert_eq!(p.len(), 2);
    let back = engine.screen_points(&p);
    assert!(
        (back[0] - 160.0).abs() < 0.5 && (back[1] - 120.0).abs() < 0.5,
        "{back:?}"
    );
    // The plan shown, the overlay in it.
    let shown = engine.shown_plan();
    assert!(shown.contains("\"format\":\"domotwin-plan\""), "{shown}");
    // A draft with the living room renamed, the living room marked; the camera stays.

    let camera = engine.stats();
    let draft = DEMO.replacen("\"Living room\"", "\"Lounge\"", 1);
    engine.show_draft(&draft, "living").unwrap();
    assert_eq!(engine.stats(), camera);
    let [x, y]: [f64; 2] = serde_json::from_str(&engine.screen_point("living")).unwrap();
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let picked = engine.pick(x as u32, y as u32);
    assert!(picked.contains("\"living\""), "{picked}");
    assert!(
        engine.show_draft("{}", "").is_err(),
        "a draft the reader refuses"
    );
    engine.mark_selected("kitchen");
    engine.mark_selected("");
    // Edit mode works on the plan stored, which is still the one loaded.
    engine.load_plan(DEMO, Some(true), None).unwrap();
    assert!(engine.begin_edit().contains("\"editing\":true"));
    engine.end_edit(false);
    // A new plan drawn and dropped: nothing is drawn.
    let mut other = Engine::new(canvas()).unwrap();
    assert!(other.shown_plan().is_empty());
    other.show_draft(DEMO, "").unwrap();
    assert!(!other.stats().contains("\"triangles\":0"));
    other.clear_plan_shown();
    assert!(
        other.stats().contains("\"triangles\":0"),
        "{}",
        other.stats()
    );
    assert!(other.pick(160, 120).is_empty());
    assert!(other.begin_edit().contains("\"editing\":false"));
}

#[wasm_bindgen_test]
fn every_look_draws_with_and_without_its_bloom() {
    let surface = canvas();
    let mut engine = Engine::new(surface.clone()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    assert!(engine.stats().contains("\"lines\":"));
    assert!(!engine.stats().contains("\"lines\":0"));
    assert_eq!(engine.set_theme("blue", ""), "day");
    let gl = surface
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::WebGl2RenderingContext>()
        .unwrap();
    for quality in ["eco", "balanced", "high"] {
        engine.set_quality(quality);
        for (name, accent) in [
            ("day", "#00d4ff"),
            ("neon", "#FF2D95"),
            ("blueprint", "x"),
            ("cartoon", "#00d4ff"),
            ("clay", "#00d4ff"),
        ] {
            assert_eq!(engine.set_theme(name, accent), name);
            assert!(engine.stats().contains(&format!("\"theme\":\"{name}\"")));
            engine.frame(0.0);
            assert_eq!(
                gl.get_error(),
                web_sys::WebGl2RenderingContext::NO_ERROR,
                "{name}"
            );
            // Picking does not depend on the look.
            assert!(engine.pick(160, 120).contains("\"id\""), "{name} {quality}");
        }
    }
    // The cartoon on Balanced: offscreen for its ink alone, without the bloom (D-036).
    engine.set_quality("balanced");
    engine.set_theme("cartoon", "");
    engine.frame(0.0);
    let stats = engine.stats();
    assert!(
        stats.contains("\"offscreen\":{\"bloom\":false,\"ink\":true,\"on\":true}"),
        "{stats}"
    );
    engine.set_quality("eco");
    assert!(
        engine
            .stats()
            .contains("\"offscreen\":{\"bloom\":false,\"ink\":false,\"on\":false}")
    );
    // The 2D plan, at the end of its move.
    engine.set_plan_view(true, 0.0);
    engine.frame(10_000.0);
    assert_eq!(gl.get_error(), web_sys::WebGl2RenderingContext::NO_ERROR);
}

#[wasm_bindgen_test]
fn a_tap_goes_through_glass_walls() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    let picks = |engine: &mut Engine| {
        engine.frame(0.0);
        let mut picked = Vec::new();
        for y in (8..240).step_by(16) {
            for x in (8..320).step_by(16) {
                picked.push(engine.pick(x, y));
            }
        }
        picked
    };
    let day = picks(&mut engine);
    engine.set_theme("blueprint", "#00d4ff");
    let glass = picks(&mut engine);
    // Where a wall stood in front of the view, what is behind its glass.
    let through = day
        .iter()
        .zip(&glass)
        .filter(|(d, n)| d.contains("\"type\":\"room\"") && d != n)
        .count();
    assert!(through > 0);
    // The rooms are still there to tap.
    assert!(glass.iter().any(|n| n.contains("\"type\":\"room\"")));
}

#[wasm_bindgen_test]
fn a_robot_vacuum_cleans_then_goes_home() {
    let mut plan: serde_json::Value = serde_json::from_str(DEMO).unwrap();
    plan["items"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "robot", "name": "Robot", "kind": "robot-vacuum", "at": [100, 395],
            "size": [40, 50, 12], "rotation": 180, "room": "living"
        }));
    let surface = canvas();
    let mut engine = Engine::new(surface.clone()).unwrap();
    engine.load_plan(&plan.to_string(), None, None).unwrap();
    engine.frame(0.0);
    // On its dock, still.
    assert!(!engine.layers_animating());
    engine.set_robots(r#"[{"id":"robot","state":"cleaning"}]"#);
    assert!(engine.layers_animating() && engine.needs_frame());
    for k in 1..=20 {
        engine.frame(f64::from(k) * 100.0);
    }
    let gl = surface
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::WebGl2RenderingContext>()
        .unwrap();
    assert_eq!(gl.get_error(), web_sys::WebGl2RenderingContext::NO_ERROR);
    // At rest under reduce motion (drawn there once, then no pace of its own), on its way again
    // after.
    engine.set_motion(false);
    assert!(!engine.layers_animating());
    engine.set_motion(true);
    assert!(engine.layers_animating());
    // Home again: it stops there.
    engine.set_robots(r#"[{"id":"robot","state":"returning"}]"#);
    for k in 21..=200 {
        engine.frame(f64::from(k) * 100.0);
    }
    assert!(!engine.layers_animating());
    // A robot no longer named rests on its dock; a plan without docks has none.
    engine.set_robots("[]");
    assert!(!engine.layers_animating());
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_robots(r#"[{"id":"robot","state":"cleaning"}]"#);
    assert!(!engine.layers_animating());
}

const UPPER: &str = include_str!("../../../examples/demo-upper-floor.domotwin.json");

/// The fictional home of two storeys, as the frontend gives it to the engine.
fn home() -> String {
    serde_json::json!([
        { "id": "upper", "name": "Upper floor", "elevation": 280,
          "plan": serde_json::from_str::<serde_json::Value>(UPPER).unwrap(), "layout": {} },
        { "id": "ground", "name": "", "elevation": 0,
          "plan": serde_json::from_str::<serde_json::Value>(DEMO).unwrap() },
    ])
    .to_string()
}

#[wasm_bindgen_test]
fn the_whole_home_stands_storey_above_storey() {
    let surface = canvas();
    let mut engine = Engine::new(surface.clone()).unwrap();
    let summary = engine.load_storeys(&home(), None).unwrap();
    assert!(summary.contains("\"storeys\":2"), "{summary}");
    let stats = engine.stats();
    assert!(
        stats.contains("\"storeys\":2") && stats.contains("\"spread\":true"),
        "{stats}"
    );
    assert!(stats.contains("\"roof\":true"), "{stats}");
    let gl = surface
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::WebGl2RenderingContext>()
        .unwrap();
    for look in ["day", "neon", "blueprint"] {
        engine.set_theme(look, "#00d4ff");
        engine.frame(0.0);
        assert_eq!(
            gl.get_error(),
            web_sys::WebGl2RenderingContext::NO_ERROR,
            "{look}"
        );
    }
    // Each storey has its label, lowest first; a tap says which storey it is on.
    let labels: serde_json::Value = serde_json::from_str(&engine.storey_labels()).unwrap();
    assert_eq!(labels.as_array().unwrap().len(), 2);
    assert_eq!(labels[0]["id"], "ground");
    let mut storeys = std::collections::BTreeSet::new();
    for y in (8..240).step_by(12) {
        for x in (8..320).step_by(12) {
            let picked = engine.pick(x, y);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&picked) {
                storeys.insert(value["storey"].as_str().unwrap_or_default().to_owned());
            }
        }
    }
    assert!(
        storeys.contains("ground") && storeys.contains("upper"),
        "{storeys:?}"
    );
    // A picture of each storey.
    for index in 0..2 {
        let picture = engine.storey_picture(index, 64, 48);
        assert_eq!(picture.len(), 64 * 48 * 4);
        let first = &picture[..4];
        assert!(
            picture.chunks(4).any(|p| p != first),
            "storey {index} drawn"
        );
    }
    assert!(engine.storey_picture(2, 64, 48).is_empty());
    // Stacked, the home is lower; without its roof, too.
    engine.set_spread(false, 0.0);
    let mut t = 0.0;
    while engine.frame(t) {
        t += 16.0;
        assert!(t < 5_000.0);
    }
    assert!(engine.stats().contains("\"spread\":false"));
    engine.set_roof(false);
    assert!(engine.stats().contains("\"roof\":false"));
    // On the 2D plan, the storeys lie side by side, the ground floor on the left, each with its
    // label over it.
    engine.set_roof(true);
    engine.set_plan_view(true, t);
    while engine.frame(t) {
        t += 16.0;
        assert!(t < 10_000.0);
    }
    assert!(engine.stats().contains("\"roof\":false"));
    let labels: serde_json::Value = serde_json::from_str(&engine.storey_labels()).unwrap();
    assert_eq!(labels[0]["top"], true);
    let x = |k: usize| labels[k]["x"].as_f64().unwrap();
    assert!(x(0) < x(1), "{labels}");
    let mut sides = std::collections::BTreeMap::new();
    for y in (8..240).step_by(8) {
        for x in (8..320).step_by(8) {
            let picked = engine.pick(x, y);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&picked) {
                let storey = value["storey"].as_str().unwrap_or_default().to_owned();
                let (low, high) = sides.entry(storey).or_insert((x, x));
                (*low, *high) = ((*low).min(x), (*high).max(x));
            }
        }
    }
    let (ground, upper) = (sides["ground"], sides["upper"]);
    assert!(ground.1 < upper.0, "{sides:?}");
    engine.set_plan_view(false, t);
    // The whole home is not edited; a storey alone is.
    assert!(engine.begin_edit().contains("\"editing\":false"));
    engine.load_plan(DEMO, None, None).unwrap();
    assert!(engine.stats().contains("\"storeys\":1"));
    assert!(engine.begin_edit().contains("\"editing\":true"));
    // No storeys: refused.
    assert!(engine.load_storeys("[]", None).is_err());
}

/// The camera's target, from the scene's figures.
fn target(engine: &Engine) -> [f64; 3] {
    let stats: serde_json::Value = serde_json::from_str(&engine.stats()).unwrap();
    let t = &stats["camera"]["target"];
    [0, 1, 2].map(|k| t[k].as_f64().unwrap())
}

#[wasm_bindgen_test]
fn walking_through_the_home_at_eye_level() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    let settle = |engine: &mut Engine, t: &mut f64| {
        while engine.frame(*t) {
            *t += 16.0;
            assert!(*t < 20_000.0, "the walk ends");
        }
    };
    let mut t = 0.0;
    settle(&mut engine, &mut t);
    assert!(!engine.walking());
    // In: the eyes go down into a room, looking a little down.
    assert!(engine.set_walk(true, t));
    settle(&mut engine, &mut t);
    let stats = engine.stats();
    assert!(stats.contains("\"walking\":true"), "{stats}");
    let at = target(&engine);
    assert!(at[1] > 100.0 && at[1] < 160.0, "{at:?}");
    // A tap on the floor ahead: the walker goes there.
    assert!(engine.walk_to(160.0, 200.0));
    settle(&mut engine, &mut t);
    let there = target(&engine);
    assert!(
        (there[0] - at[0]).hypot(there[2] - at[2]) > 10.0,
        "{at:?} {there:?}"
    );
    // Held keys: it walks ahead until a wall stops it, never through it.
    engine.set_walk_velocity(1.0, 0.0);
    for _ in 0..400 {
        t += 16.0;
        engine.frame(t);
    }
    engine.set_walk_velocity(0.0, 0.0);
    let stopped = target(&engine);
    for _ in 0..30 {
        t += 16.0;
        engine.frame(t);
    }
    assert_eq!(target(&engine), stopped);
    // Out: back to the camera before.
    assert!(!engine.set_walk(false, t));
    settle(&mut engine, &mut t);
    assert!(engine.stats().contains("\"walking\":false"));
    // Not with every storey shown.
    engine.load_storeys(&home(), None).unwrap();
    assert!(!engine.set_walk(true, t));
}

#[wasm_bindgen_test]
fn the_network_map_draws_links_between_pieces_and_finds_them() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    // A fictional mesh: the coordinator on the sideboard, a router in the floor lamp, a sensor on
    // the washer that only hears the router, badly; a device placed nowhere.
    let snapshot = serde_json::json!({ "devices": [
        { "id": "00:00:00:00:00:00:00:01", "role": "coordinator", "element": "sideboard",
          "neighbours": [{ "id": "00:00:00:00:00:00:00:02", "lqi": 210 }] },
        { "id": "00:00:00:00:00:00:00:02", "role": "router", "element": "floor-lamp",
          "neighbours": [{ "id": "00:00:00:00:00:00:00:03", "lqi": 30 }] },
        { "id": "00:00:00:00:00:00:00:03", "role": "end", "element": "washer" },
        { "id": "00:00:00:00:00:00:00:04", "role": "end",
          "neighbours": [{ "id": "00:00:00:00:00:00:00:02", "lqi": 120 }] },
        { "id": "00:00:00:00:00:00:00:05", "role": "end", "element": "floor-lamp",
          "neighbours": [{ "id": "00:00:00:00:00:00:00:02", "lqi": 200 }] }
    ] });
    // The analysis module reads it and hands the engine what it draws (D-043); the engine says
    // the room each device is in, for the analysis's health.
    let mesh = domotwin_core::network::Mesh::read(&snapshot);
    let rooms: Vec<Option<String>> =
        serde_json::from_str(&engine.set_network(&mesh.write_drawing())).unwrap();
    assert_eq!(rooms[2].as_deref(), Some("bathroom"));
    assert_eq!(rooms[3], None, "not placed");
    let analysis: serde_json::Value = serde_json::from_str(&mesh.report(&rooms)).unwrap();
    assert_eq!(analysis["health"]["weakLinks"], 1);
    assert_eq!(analysis["health"]["weakRooms"][0]["room"], "bathroom");
    // The pulse needs frames while the map is shown.
    assert!(engine.frame(0.0), "a pulse runs");
    // A tap somewhere on a wire finds its link; one far from every wire finds none.
    let mut found = Vec::new();
    for y in (0..240).step_by(3) {
        for x in (0..320).step_by(3) {
            let hit = engine.network_at(f64::from(x), f64::from(y));
            if !hit.is_empty() {
                found.push(hit);
            }
        }
    }
    assert!(!found.is_empty(), "the wires are on screen");
    assert!(
        found.iter().all(|h| h.contains("00:00:00:00:00:00:00:02")),
        "{found:?}"
    );
    // Two devices on the same piece: their link is not drawn, nor found.
    assert!(
        !found.iter().any(|h| h.contains("00:00:00:00:00:00:00:05")),
        "{found:?}"
    );
    // Hidden: no wires, no frames.
    assert_eq!(engine.set_network(""), "");
    assert!(engine.network_at(160.0, 120.0).is_empty());
    assert!(!engine.frame(16.0));
}

#[wasm_bindgen_test]
fn automation_wires_join_their_ends_and_pulse_when_one_runs() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    // Two fictional automations: motion in the hall (the floor lamp's piece stands for its
    // sensor here) turns the floor lamp on at sunset; a button on the sideboard dims the living
    // room, if a template says so.
    let automations = serde_json::json!({ "automations": [
        { "id": "automation.dusk", "color": [1.0, 0.5, 0.1], "ends": [
            { "role": "trigger", "piece": "sideboard" },
            { "role": "trigger", "above": "Sun" },
            { "role": "action", "piece": "floor-lamp" }
        ] },
        { "id": "automation.dim", "color": [0.2, 0.6, 1.0], "ends": [
            { "role": "trigger", "piece": "tv" },
            { "role": "condition", "above": "Template", "room": "living" },
            { "role": "action", "room": "living", "dynamic": true }
        ] }
    ] });
    let spots: serde_json::Value =
        serde_json::from_str(&engine.set_automations(&automations.to_string())).unwrap();
    let spots = spots.as_array().unwrap();
    assert_eq!(spots.len(), 6, "{spots:?}");
    assert_eq!(spots[0]["piece"], "sideboard");
    assert_eq!(spots[1]["above"], "Sun");
    assert_eq!(spots[5]["room"], "living");
    assert_eq!(spots[5]["dynamic"], true);
    let points: Vec<Option<[f64; 2]>> = serde_json::from_str(&engine.automation_points()).unwrap();
    assert_eq!(points.len(), 6);
    assert!(points.iter().all(Option::is_some), "{points:?}");
    // No wire is moving: no frames needed until one runs.
    engine.frame(0.0);
    assert!(!engine.frame(16.0));
    assert!(engine.pulse_automation("automation.dusk", 20.0));
    assert!(engine.frame(40.0), "the pulse runs");
    assert!(!engine.frame(5_000.0), "and is over");
    assert!(!engine.pulse_automation("automation.unknown", 50.0));
    // A tap on a wire finds its automation.
    let mut found = Vec::new();
    for y in (0..240).step_by(3) {
        for x in (0..320).step_by(3) {
            let hit = engine.automation_at(f64::from(x), f64::from(y));
            if !hit.is_empty() && !found.contains(&hit) {
                found.push(hit);
            }
        }
    }
    assert!(
        found.iter().any(|h| h.contains("automation.dusk")),
        "{found:?}"
    );
    // Two alike automations (the same two pieces): their wires rise apart, each can be tapped;
    // an id longer than a label is kept whole; a pulse goes on when one is picked out.
    let long = format!("automation.{}", "x".repeat(150));
    let alike = serde_json::json!({ "automations": [
        { "id": "automation.on", "color": [1.0, 0.5, 0.1], "ends": [
            { "role": "trigger", "piece": "sideboard" }, { "role": "action", "piece": "floor-lamp" }
        ] },
        { "id": long, "color": [0.2, 0.6, 1.0], "ends": [
            { "role": "trigger", "piece": "sideboard" }, { "role": "action", "piece": "floor-lamp" }
        ] }
    ] });
    engine.set_automations(&alike.to_string());
    let mut hits = std::collections::BTreeSet::new();
    for y in (0..240).step_by(2) {
        for x in (0..320).step_by(2) {
            let hit = engine.automation_at(f64::from(x), f64::from(y));
            if !hit.is_empty() {
                hits.insert(hit);
            }
        }
    }
    assert!(hits.iter().any(|h| h.contains("automation.on")), "{hits:?}");
    assert!(hits.iter().any(|h| h.contains(&long)), "{hits:?}");
    // Where the two wires are close, a tap finds both (each tap then picks the next).
    assert!(
        hits.iter()
            .any(|h| h.contains("automation.on") && h.contains(&long)),
        "{hits:?}"
    );
    engine.frame(10_000.0);
    assert!(engine.pulse_automation(&long, 10_010.0));
    engine.pick_automation("automation.on");
    assert!(
        engine.frame(10_100.0),
        "the pulse runs on, picked out or not"
    );
    // The same automations handed over again (the scene or the names changed): the pulse goes on.
    engine.set_automations(&alike.to_string());
    assert!(
        engine.frame(10_150.0),
        "the pulse runs on, handed over again"
    );
    engine.set_automations(&automations.to_string());
    // Picked out, then bundled by room: the hall's and the living room's.
    engine.pick_automation("automation.dim");
    let bundled = serde_json::json!({ "automations": automations["automations"], "grouped": true });
    let spots: serde_json::Value =
        serde_json::from_str(&engine.set_automations(&bundled.to_string())).unwrap();
    assert!(
        spots
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s.get("piece").is_none()),
        "{spots:?}"
    );
    // Hidden: nothing drawn, nothing found.
    assert_eq!(engine.set_automations("{}"), "[]");
    assert!(engine.automation_at(160.0, 120.0).is_empty());
    assert_eq!(engine.automation_points(), "[]");
}

#[wasm_bindgen_test]
fn upkeep_states_and_the_layer() {
    // Where the cards stand on a day (D-033): the washing machine's filter is late, the fridge's
    // coils due soon; an unreadable day gives nothing.
    let upkeep = serde_json::json!({ "lead_days": 14, "pieces": {
        "washer": { "tasks": [{ "id": "filter", "name": "Filter", "every": 3, "unit": "months",
                                "last_done": "2026-07-20" }] },
        "fridge": { "tasks": [{ "id": "coils", "name": "Coils", "every": 6, "unit": "months",
                                "last_done": "2026-05-01" }] }
    } })
    .to_string();
    let states: serde_json::Value =
        serde_json::from_str(&domotwin_web::upkeep_states(&upkeep, "2026-10-24")).unwrap();
    assert_eq!(states["washer"]["state"], "overdue");
    assert_eq!(states["fridge"]["state"], "due");
    assert_eq!(states["fridge"]["tasks"][0]["due"], "2026-11-01");
    assert_eq!(domotwin_web::upkeep_states(&upkeep, "24/10/2026"), "{}");
    // The layer: shades for the pieces of the plan, kept when the plan is shown again.
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_upkeep(r#"{"washer": "overdue", "fridge": "due", "gone": "fine", "sofa": 3}"#);
    engine.set_upkeep_layer(true);
    engine.frame(0.0);
    engine.load_plan(DEMO, Some(true), None).unwrap();
    engine.frame(16.0);
    // Held still: no frames needed for it.
    assert!(!engine.frame(32.0));
    engine.set_upkeep_layer(false);
    engine.set_upkeep("{}");
}

#[wasm_bindgen_test]
fn the_cartoons_ink_comes_before_people_fading_and_glass() {
    // D-036: with the ink, a frame is drawn in two phases around it; people fading in are drawn
    // after it.
    let surface = canvas();
    let mut engine = Engine::new(surface.clone()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    let gl = surface
        .get_context("webgl2")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::WebGl2RenderingContext>()
        .unwrap();
    for quality in ["balanced", "high"] {
        engine.set_quality(quality);
        engine.set_theme("cartoon", "");
        engine.set_people(r##"[{"id": "person.alex", "room": "kitchen", "color": "#e8508a"}]"##);
        // A few frames while they fade in are enough (each is slow on a software GPU).
        let mut t = 0.0;
        let mut fading = 0;
        while engine.frame(t) && fading < 4 && t < 2_000.0 {
            let points: Vec<serde_json::Value> =
                serde_json::from_str(&engine.people_points()).unwrap();
            if points
                .iter()
                .any(|p| p["opacity"].as_f64().is_some_and(|o| o > 0.0 && o < 1.0))
            {
                fading += 1;
            }
            assert_eq!(
                gl.get_error(),
                web_sys::WebGl2RenderingContext::NO_ERROR,
                "{quality} at {t}"
            );
            t += 50.0;
        }
        assert_eq!(fading, 4, "{quality}: {fading} frames fading");
        assert!(engine.stats().contains("\"ink\":true"));
        engine.set_motion(false);
        engine.set_people("[]");
        engine.set_motion(true);
    }
}

#[wasm_bindgen_test]
fn people_walk_from_room_to_room() {
    // D-034: Alex fades in in the kitchen, then walks to the bedroom; Sam is in a room the plan
    // does not have.
    let mut engine = Engine::new(canvas()).unwrap();
    engine.load_plan(DEMO, None, None).unwrap();
    engine.set_people(
        r##"[{"id": "person.alex", "room": "kitchen", "color": "#e8508a", "look": "figure"},
            {"id": "person.sam", "room": "attic", "color": "#2f9fd8"}, {"room": "hall"}]"##,
    );
    assert!(engine.needs_frame());
    let points = |engine: &Engine| -> Vec<serde_json::Value> {
        serde_json::from_str(&engine.people_points()).unwrap()
    };
    let mut t = 0.0;
    while engine.frame(t) && t < 2_000.0 {
        t += 16.0;
    }
    let seen = points(&engine);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["id"], "person.alex");
    assert_eq!(seen[0]["opacity"], 1.0);
    let before = (
        seen[0]["x"].as_f64().unwrap(),
        seen[0]["y"].as_f64().unwrap(),
    );
    engine.set_people(r##"[{"id": "person.alex", "room": "bedroom", "color": "#e8508a"}]"##);
    engine.frame(t + 16.0);
    assert!(engine.needs_frame(), "walking");
    let mut frames = 0;
    t += 32.0;
    while engine.frame(t) && frames < 2_000 {
        t += 16.0;
        frames += 1;
    }
    assert!(frames > 30, "a walk takes a while: {frames} frames");
    let after = points(&engine);
    let moved = (after[0]["x"].as_f64().unwrap() - before.0)
        .hypot(after[0]["y"].as_f64().unwrap() - before.1);
    assert!(moved > 20.0, "{moved}");
    // Held still: gone at once, no frames needed.
    engine.set_motion(false);
    engine.set_people("[]");
    assert!(points(&engine).is_empty());
    assert!(!engine.frame(t + 16.0));
    // Every storey shown: someone upstairs stands on the upper floor.
    engine.load_storeys(&home(), None).unwrap();
    engine.set_people(
        r#"[{"id": "person.alex", "room": "kitchen"}, {"id": "person.sam", "room": "up-office"}]"#,
    );
    engine.frame(t + 32.0);
    let both = points(&engine);
    assert_eq!(both.len(), 2);
    let y = |id: &str| {
        both.iter().find(|p| p["id"] == id).unwrap()["y"]
            .as_f64()
            .unwrap()
    };
    assert!(
        y("person.sam") < y("person.alex"),
        "upstairs is higher on the screen"
    );
}
