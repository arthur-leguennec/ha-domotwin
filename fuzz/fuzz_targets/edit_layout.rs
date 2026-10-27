//! An edit overlay, whatever its bytes, applied to the demo plan, then edit operations on the
//! result: nothing may panic.

#![no_main]

use domotwin_core::edit::Session;
use domotwin_core::geometry::walls::WallLayout;
use domotwin_core::overlay::{apply, read_layout};
use domotwin_core::plan::{Kind, read_plan_value};
use domotwin_core::scene::{SceneOptions, build_scene};
use libfuzzer_sys::fuzz_target;

const DEMO: &str = include_str!("../../examples/demo-apartment.domotwin.json");

fuzz_target!(|data: &[u8]| {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(data) else {
        return;
    };
    let Ok(source) = serde_json::from_str::<serde_json::Value>(DEMO) else {
        return;
    };
    let layout = read_layout(&value);
    let Ok(mut plan) = read_plan_value(&apply(&source, &layout)) else {
        return;
    };
    let _ = build_scene(&plan, &SceneOptions::default());
    let walls = WallLayout::new(&plan);
    let mut session = Session::new(&layout);
    let ids: Vec<String> = plan.elements.iter().map(|e| e.id().to_owned()).collect();
    for id in ids.iter().rev().take(6) {
        session.select(&plan, &walls, id, true);
    }
    let n = data.len() as f64;
    if let Some(id) = session.movable(&plan).first().cloned() {
        if session.drag_start(&plan, &walls, &id, [n, -n]) {
            session.drag_move(&mut plan, [n * 3.0, n * 7.0], 8.0);
            session.drag_end(&plan, &walls);
        }
    }
    session.rotate(&plan, &walls, (data.len() % 7) as i32 - 3);
    // A piece of the library in one of its styles, or in one it does not have (D-074).
    let kind = Kind::ALL[data.len() % Kind::ALL.len()];
    let style = kind
        .info()
        .variants
        .get(data.len() / 7 % 4)
        .copied()
        .unwrap_or("unknown");
    let _ = session.add(&plan, &walls, kind, Some(style), "Piece", [n, n]);
    session.remove(&plan);
    let _ = read_plan_value(&apply(&source, session.layout()));
});
