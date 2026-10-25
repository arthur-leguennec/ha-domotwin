//! Upkeep for JavaScript (`DECISIONS.md`, D-033): where every card stands today, and the upkeep
//! layer, which tints the pieces by it.

use std::collections::HashMap;

use domotwin_core::upkeep::{Date, states};
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::engine::Engine;

/// Where every upkeep card stands on `today` (`YYYY-MM-DD`, where the home is), from the stored
/// upkeep (`{"lead_days", "pieces": {id: card}}`): JSON `{id: {"state", "warranty", "tasks":
/// [{"id", "due", "state", "days"}]}}` (`domotwin_core::upkeep::states`); `{}` for a date it
/// cannot read.
#[wasm_bindgen(js_name = upkeepStates)]
pub fn upkeep_states(upkeep: &str, today: &str) -> String {
    let Some(today) = Date::parse(today) else {
        return "{}".to_owned();
    };
    let value: Value = serde_json::from_str(upkeep).unwrap_or(Value::Null);
    states(&value, today).to_string()
}

/// A state's shade on the upkeep layer: 1 fine, 2 due soon, 3 overdue.
fn shade(state: &str) -> Option<u8> {
    match state {
        "fine" => Some(1),
        "due" => Some(2),
        "overdue" => Some(3),
        _ => None,
    }
}

#[wasm_bindgen]
impl Engine {
    /// Where each piece's upkeep stands: JSON `{piece id: "fine" | "due" | "overdue"}` (as
    /// `upkeepStates` gives each card's `state`), for the upkeep layer.
    #[wasm_bindgen(js_name = setUpkeep)]
    pub fn set_upkeep(&mut self, json: &str) {
        let value: Value = serde_json::from_str(json).unwrap_or(Value::Null);
        self.upkeep = value
            .as_object()
            .map(|pieces| {
                pieces
                    .iter()
                    .filter_map(|(id, state)| Some((id.clone(), shade(state.as_str()?)?)))
                    .collect()
            })
            .unwrap_or_default();
        self.place_upkeep();
    }

    /// Shows or hides the upkeep layer: the pieces with tasks tinted green when fine, amber when
    /// one is due soon, red when one is overdue.
    #[wasm_bindgen(js_name = setUpkeepLayer)]
    pub fn set_upkeep_layer(&mut self, shown: bool) {
        self.renderer.set_upkeep_layer(shown);
    }
}

impl Engine {
    /// Hands the renderer each element's upkeep shade, for the scene shown.
    pub(crate) fn place_upkeep(&mut self) {
        let shades: Vec<u8> = self
            .elements
            .iter()
            .map(|e| self.upkeep.get(&e.id).copied().unwrap_or(0))
            .collect();
        self.renderer.set_upkeep(&shades);
    }
}

/// Upkeep shades by piece id.
pub(crate) type UpkeepShades = HashMap<String, u8>;
