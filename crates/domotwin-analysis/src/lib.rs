//! DomoTwin's analysis module (`DECISIONS.md`, D-043): reading what Home Assistant hands over
//! about a radio mesh and about automations, and analysing it, for JavaScript; and the home's
//! Wi-Fi QR code (D-058). It is built as its own WebAssembly module, which the frontend loads only
//! when the network map, the automations or the QR code are shown; the engine is handed what it
//! draws (`domotwin_core::network::Drawing`, the automations' placed ends), so that none of this
//! is in the first load.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

use domotwin_core::automation::{Automation, Target};
use domotwin_core::network::Mesh;
use qrcodegen::{QrCode, QrCodeEcc};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

/// What a phone's camera reads to join a Wi-Fi network: `WIFI:T:WPA;S:<name>;P:<password>;;`,
/// with `\`, `;`, `,`, `:` and `"` escaped by a backslash. `security` is `WPA` (WPA2 and WPA3
/// too), `WEP` or `nopass` (an open network, no password); a hidden network says so (`H:true`).
pub fn wifi_payload(name: &str, password: &str, security: &str, hidden: bool) -> String {
    fn escaped(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        for c in text.chars() {
            if matches!(c, '\\' | ';' | ',' | ':' | '"') {
                out.push('\\');
            }
            out.push(c);
        }
        out
    }
    let security = match security {
        "WEP" => "WEP",
        "nopass" => "nopass",
        _ => "WPA",
    };
    let mut payload = format!("WIFI:T:{security};S:{};", escaped(name));
    if security != "nopass" {
        payload.push_str(&format!("P:{};", escaped(password)));
    }
    if hidden {
        payload.push_str("H:true;");
    }
    payload.push(';');
    payload
}

/// The QR code joining a Wi-Fi network (`wifi_payload`): JSON `{"size": modules on a side,
/// "modules": "0110…" row by row, 1 dark}`, or `{"size": 0}` when it does not fit in one.
#[wasm_bindgen(js_name = wifiQr)]
pub fn wifi_qr(name: &str, password: &str, security: &str, hidden: bool) -> String {
    console_error_panic_hook::set_once();
    let payload = wifi_payload(name, password, security, hidden);
    let Ok(code) = QrCode::encode_text(&payload, QrCodeEcc::Medium) else {
        return json!({ "size": 0 }).to_string();
    };
    let size = code.size();
    let mut modules = String::with_capacity(usize::try_from(size * size).unwrap_or_default());
    for y in 0..size {
        for x in 0..size {
            modules.push(if code.get_module(x, y) { '1' } else { '0' });
        }
    }
    json!({ "size": size, "modules": modules }).to_string()
}

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
    fn a_wifi_network_s_payload_with_its_characters_escaped() {
        assert_eq!(
            wifi_payload("Fictional Guests", "tea;and,cake", "WPA", false),
            r"WIFI:T:WPA;S:Fictional Guests;P:tea\;and\,cake;;"
        );
        assert_eq!(
            wifi_payload(r#"a:b"c\d"#, "x", "WEP", true),
            r#"WIFI:T:WEP;S:a\:b\"c\\d;P:x;H:true;;"#
        );
        // An open network has no password; an unknown kind is WPA.
        assert_eq!(
            wifi_payload("Open", "ignored", "nopass", false),
            "WIFI:T:nopass;S:Open;;"
        );
        assert_eq!(
            wifi_payload("N", "p", "WPA3", false),
            "WIFI:T:WPA;S:N;P:p;;"
        );
    }

    #[test]
    fn a_wifi_qr_code_s_modules() {
        let read: Value =
            serde_json::from_str(&wifi_qr("Fictional Guests", "correct horse", "WPA", false))
                .unwrap();
        let size = read["size"].as_i64().unwrap();
        // Version 3 at least (29 modules), each one given, finder patterns in the corners.
        assert!(size >= 29 && (size - 17) % 4 == 0);
        let modules = read["modules"].as_str().unwrap();
        assert_eq!(modules.len() as i64, size * size);
        assert_eq!(&modules[..7], "1111111");
        // Too long for any QR code: no code, said so.
        let read: Value =
            serde_json::from_str(&wifi_qr(&"n".repeat(3000), "p", "WPA", false)).unwrap();
        assert_eq!(read, json!({ "size": 0 }));
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
