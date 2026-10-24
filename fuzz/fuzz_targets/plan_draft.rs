//! The plan editor's changes, driven by the bytes, on the demo plan: nothing may panic, and every
//! change kept leaves a plan the reader accepts; so does the plan with its ids made free of the
//! demo's (a storey joining a home).

#![no_main]

use std::collections::BTreeSet;
use std::sync::OnceLock;

use domotwin_core::plan::{LISTS, read_plan_value};
use domotwin_core::structure::{Draft, free_ids};
use libfuzzer_sys::fuzz_target;
use serde_json::{Map, Value, json};

const DEMO: &str = include_str!("../../examples/demo-apartment.domotwin.json");

/// A coordinate from two bytes: −1 000 to 1 548 cm, around the demo home.
fn coordinate(bytes: &[u8]) -> f64 {
    f64::from(u16::from_le_bytes([bytes[0], bytes[1]]) % 2549) - 1000.0
}

fuzz_target!(|data: &[u8]| {
    let Ok(source) = serde_json::from_str::<Value>(DEMO) else {
        return;
    };
    let mut draft = Draft::new(source.clone());
    for op in data.chunks_exact(10).take(64) {
        let ids: Vec<String> = ids_of(draft.plan()).into_iter().collect();
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
                fields.insert("width".into(), json!(a[0] / 4.0));
                fields.insert("thickness".into(), json!(b[0] / 10.0));
                let side = if op[3] % 2 == 0 { "left" } else { "right" };
                fields.insert("opensTo".into(), json!(side));
                fields.insert("name".into(), json!("Renamed"));
                fields.insert("outline".into(), json!(a[1]));
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
    // Joining a home whose other storey uses every id the demo has, and a long one that an element
    // (picked by the bytes) has too.
    let mut joining = draft.plan().clone();
    let long = "é".repeat(100);
    if let Some(list) = joining.get_mut("rooms").and_then(Value::as_array_mut)
        && !list.is_empty()
    {
        let pick = usize::from(data.first().copied().unwrap_or(0)) % list.len();
        let old = list[pick].get("id").and_then(Value::as_str).map(str::to_owned);
        list[pick]["id"] = json!(long);
        for (key, _) in &LISTS[1..] {
            for e in joining
                .get_mut(key)
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
            {
                if old.is_some() && e.get("room").and_then(Value::as_str) == old.as_deref() {
                    e["room"] = json!(long);
                }
            }
        }
    }
    let mut taken = DEMO_IDS.get_or_init(|| ids_of(&source)).clone();
    taken.insert(long);
    free_ids(&mut joining, &taken);
    if draft.read().is_ok() {
        assert!(
            read_plan_value(&joining).is_ok(),
            "ids made free left a plan the reader refuses"
        );
    }
});

/// The demo plan's ids, read once.
static DEMO_IDS: OnceLock<BTreeSet<String>> = OnceLock::new();

fn ids_of(plan: &Value) -> BTreeSet<String> {
    LISTS
        .iter()
        .filter_map(|(key, _)| plan.get(key).and_then(Value::as_array))
        .flatten()
        .filter_map(|e| e.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect()
}
