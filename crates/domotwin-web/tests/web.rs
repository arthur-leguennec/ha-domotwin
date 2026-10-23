//! Runs in headless Chromium with `wasm-bindgen-test` (see CONTRIBUTING.md).

#![cfg(target_arch = "wasm32")]
#![allow(clippy::unwrap_used)]

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
    let summary = engine.load_plan(DEMO).unwrap();
    assert!(summary.contains("\"rooms\":5"), "{summary}");
    assert!(engine.needs_frame());
    assert!(!engine.frame(0.0));
    assert!(!engine.needs_frame());
}

#[wasm_bindgen_test]
fn refuses_a_bad_plan_with_a_code() {
    let mut engine = Engine::new(canvas()).unwrap();
    assert!(engine.load_plan("{}").is_err());
}

#[wasm_bindgen_test]
fn quality_can_be_forced() {
    let mut engine = Engine::new(canvas()).unwrap();
    engine.set_quality("high");
    assert_eq!(engine.quality(), "high");
    engine.set_quality("eco");
    assert_eq!(engine.quality(), "eco");
}
