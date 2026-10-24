//! The plan editor's changes, driven by the bytes, on the demo plan: nothing may panic, and every
//! change kept leaves a plan the reader accepts.

#![no_main]

use domotwin_core::structure::Draft;
use libfuzzer_sys::fuzz_target;
use serde_json::{Map, Value, json};

const DEMO: &str = include_str!("../../examples/demo-apartment.plan.json");

/// A coordinate from two bytes: −1 000 to 1 548 cm, around the demo home.
fn coordinate(bytes: &[u8]) -> f64 {
    f64::from(u16::from_le_bytes([bytes[0], bytes[1]]) % 2549) - 1000.0
}

fuzz_target!(|data: &[u8]| {
    let Ok(source) = serde_json::from_str::<Value>(DEMO) else {
        return;
    };
    let mut draft = Draft::new(source);
    for op in data.chunks_exact(10).take(64) {
        let ids: Vec<String> = draft
            .plan()
            .get("elements")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|e| e.get("id").and_then(Value::as_str).map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let id = ids
            .get(usize::from(op[1]) % ids.len().max(1))
            .cloned()
            .unwrap_or_default();
        let a = [coordinate(&op[2..4]), coordinate(&op[4..6])];
        let b = [coordinate(&op[6..8]), coordinate(&op[8..10])];
        let index = usize::from(op[2] % 8);
        let kept = match op[0] % 14 {
            0 => draft.add_room(a, b, "Room").is_ok(),
            1 => draft.add_wall(a, b, "Partition").is_ok(),
            2 => draft.add_opening(op[3] % 2 == 0, a, "Door").is_ok(),
            3 => draft.move_corner(&id, index, a).is_ok(),
            4 => draft.insert_corner(&id, index, a).is_ok(),
            5 => draft.remove_corner(&id, index).is_ok(),
            6 => draft.move_element(&id, [a[0] / 10.0, a[1] / 10.0]).is_ok(),
            7 => {
                let mut fields = Map::new();
                fields.insert("w".into(), json!(a[0] / 4.0));
                fields.insert("thickness".into(), json!(b[0] / 10.0));
                fields.insert("swing".into(), json!(if op[3] % 2 == 0 { 1 } else { -1 }));
                fields.insert("name".into(), json!("Renamed"));
                fields.insert("x".into(), json!(a[1]));
                draft.update(&id, &fields).is_ok()
            }
            8 => draft.remove(&id).is_ok(),
            9 => draft.undo(),
            10 => draft.redo(),
            11 => {
                draft.begin_drag();
                true
            }
            12 => {
                draft.end_drag();
                true
            }
            _ => {
                let (p, _) = draft.snap(a, Some(&id));
                p.iter().all(|v| v.is_finite())
            }
        };
        if kept {
            assert!(draft.read().is_ok(), "a change kept left a plan the reader refuses");
        }
    }
});
