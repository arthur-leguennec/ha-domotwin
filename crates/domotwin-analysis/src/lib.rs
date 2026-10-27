//! DomoTwin's analysis module (`DECISIONS.md`, D-043): reading what Home Assistant hands over
//! about a radio mesh and about automations, and analysing it, for JavaScript; and where the next
//! radio helps most (D-060). It is built as its own WebAssembly module, which the frontend loads
//! only when the network map, the automations or the radio coverage are shown; the engine is
//! handed what it draws (`domotwin_core::network::Drawing`, the automations' placed ends, the
//! rooms' coverage as a layer), so that none of this is in the first load.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

use domotwin_core::automation::{Automation, Target};
use domotwin_core::coverage;
use domotwin_core::network::Mesh;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

/// What an automation's configuration (JSON, `automation/config`'s `config`) involves: JSON
/// `{"ends": [{"role", "entity" | "device" | "area" | "floor" | "label" | "place" | "dynamic":
/// name}], "skipped"}`.
#[wasm_bindgen(js_name = readAutomation)]
pub fn read_automation(config: &str) -> String {
    console_error_panic_hook::set_once();
    let value: Value = serde_json::from_str(config).unwrap_or(Value::Null);
    let automation = Automation::read(&value);
    let ends: Vec<Value> = automation
        .ends
        .iter()
        .map(|end| {
            let (kind, name) = match &end.target {
                Target::Entity(id) => ("entity", id),
                Target::Device(id) => ("device", id),
                Target::Area(id) => ("area", id),
                Target::Floor(id) => ("floor", id),
                Target::Label(id) => ("label", id),
                Target::Place(kind) => ("place", kind),
                Target::Dynamic(label) => ("dynamic", label),
            };
            let mut entry = json!({ "role": end.role.name() });
            entry[kind] = json!(name);
            entry
        })
        .collect();
    json!({ "ends": ends, "skipped": automation.skipped }).to_string()
}

/// How well one radio covers the home, and where the next one helps most (JSON in and out, see
/// `domotwin_core::coverage`): `{"rooms", "radios", "spots", "check", "agreement"}`.
#[wasm_bindgen(js_name = advisePlacement)]
pub fn advise_placement(input: &str) -> String {
    console_error_panic_hook::set_once();
    let value: Value = serde_json::from_str(input).unwrap_or(Value::Null);
    coverage::advise(&value).write()
}

/// A radio mesh read from a snapshot (JSON, see `domotwin_core::network`).
#[wasm_bindgen]
#[derive(Debug)]
pub struct NetworkAnalysis {
    mesh: Mesh,
}

#[wasm_bindgen]
impl NetworkAnalysis {
    /// Reads `snapshot`; anything that is not one gives an empty mesh.
    #[wasm_bindgen(constructor)]
    pub fn new(snapshot: &str) -> NetworkAnalysis {
        console_error_panic_hook::set_once();
        let value: Value = serde_json::from_str(snapshot).unwrap_or(Value::Null);
        NetworkAnalysis {
            mesh: Mesh::read(&value),
        }
    }

    /// What the engine draws of it (JSON, for the engine's `setNetwork`).
    pub fn drawing(&self) -> String {
        self.mesh.write_drawing()
    }

    /// The analysis (JSON: devices, links, health), with the room each device is in (`rooms`:
    /// the JSON array the engine's `setNetwork` returns).
    pub fn report(&self, rooms: &str) -> String {
        let rooms: Vec<Option<String>> = serde_json::from_str::<Vec<Value>>(rooms)
            .unwrap_or_default()
            .into_iter()
            .map(|room| room.as_str().map(str::to_owned))
            .collect();
        self.mesh.report(&rooms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_automation_s_ends() {
        let read: Value = serde_json::from_str(&read_automation(
            &json!({
                "triggers": [{ "trigger": "state", "entity_id": "binary_sensor.hall_motion" }],
                "actions": [{ "action": "light.turn_on", "target": { "area_id": "living" } }]
            })
            .to_string(),
        ))
        .unwrap();
        assert_eq!(read["ends"][0]["entity"], "binary_sensor.hall_motion");
        assert_eq!(read["ends"][1]["area"], "living");
        assert_eq!(read_automation("not json"), r#"{"ends":[],"skipped":0}"#);
        // Places, floors and labels; what it does not know is counted.
        let read: Value = serde_json::from_str(&read_automation(
            r#"{"triggers": [{"trigger": "sun"}], "actions": [{"action": "light.turn_on", "target": {"area_id": "living_room", "floor_id": "ground", "label_id": "evening"}}, {"fictional": 1}]}"#,
        ))
        .unwrap();
        assert_eq!(
            read,
            json!({ "ends": [
                { "role": "trigger", "place": "sun" },
                { "role": "action", "area": "living_room" },
                { "role": "action", "floor": "ground" },
                { "role": "action", "label": "evening" }
            ], "skipped": 1 })
        );
    }

    #[test]
    fn placement_advised() {
        let advice: Value = serde_json::from_str(&advise_placement(
            &json!({
                "radio": "wifi",
                "storeys": [{ "id": "ground", "plan": { "rooms": [
                    { "id": "near", "outline": [[0, 0], [400, 0], [400, 400], [0, 400]] },
                    { "id": "far", "outline": [[4000, 0], [4400, 0], [4400, 400], [4000, 400]] }
                ] } }],
                "radios": [{ "id": "ap", "storey": "ground", "at": [200, 200] }]
            })
            .to_string(),
        ))
        .unwrap();
        assert_eq!(advice["rooms"][0]["level"], "good");
        assert_eq!(advice["rooms"][1]["level"], "weak");
        assert_eq!(advice["radios"][0]["room"], "near");
        assert_eq!(
            advise_placement("not json"),
            r#"{"rooms":[],"radios":[],"spots":[]}"#
        );
    }

    #[test]
    fn a_mesh_drawn_then_reported_with_its_rooms() {
        let analysis = NetworkAnalysis::new(
            &json!({ "devices": [
                { "id": "c", "role": "coordinator", "element": "hub",
                  "neighbours": [{ "id": "s", "lqi": 30 }] },
                { "id": "s", "role": "end", "element": "sensor" }
            ] })
            .to_string(),
        );
        let drawing: Value = serde_json::from_str(&analysis.drawing()).unwrap();
        assert_eq!(drawing["devices"][1]["element"], "sensor");
        // c–s: weak, its pulse back towards c, taken by s.
        assert_eq!(drawing["links"], json!([0, 1, 0, 2, 0]));
        let report: Value = serde_json::from_str(&analysis.report(r#"["hall", "bath"]"#)).unwrap();
        assert_eq!(report["devices"][1]["room"], "bath");
        assert_eq!(report["health"]["weakRooms"][0]["room"], "bath");
        // Rooms unknown: no room, no weak room.
        let report: Value = serde_json::from_str(&analysis.report("oops")).unwrap();
        assert!(report["health"]["weakRooms"].as_array().unwrap().is_empty());
    }
}
