//! What the plan editor needs from the engine (`DECISIONS.md`, D-025): showing each version of its
//! draft, and turning screen points into plan points and back. The draft itself lives in the plan
//! editor's own module (`domotwin-planner`), loaded only when it opens.

use std::collections::BTreeSet;

use domotwin_core::overlay::apply;
use domotwin_core::plan::{PLAN_REVISION, parse_plan_json, read_plan_value};
use domotwin_render::lamps::Mark;
use wasm_bindgen::prelude::*;

use crate::engine::{Engine, plan_error};

#[wasm_bindgen]
impl Engine {
    /// Shows a plan drawn in the plan editor (JSON text, no overlay), element `selected` marked.
    /// The plan stored and its overlay stay as they are, to come back to (`loadPlan`); the camera
    /// stays, unless nothing was shown.
    ///
    /// # Errors
    ///
    /// The JSON error of the plan reader.
    #[wasm_bindgen(js_name = showDraft)]
    pub fn show_draft(&mut self, json: &str, selected: &str) -> Result<(), JsError> {
        let value = parse_plan_json(json.as_bytes()).map_err(|err| plan_error(&err))?;
        let plan = read_plan_value(&value).map_err(|err| plan_error(&err))?;
        let fresh = self.plan.is_none();
        self.edit = None;
        self.show(plan, !fresh, &BTreeSet::new(), fresh);
        self.mark_selected(selected);
        Ok(())
    }

    /// The plan shown with its edit overlay in it (the entries it accepted), as JSON text of the
    /// current revision: what the plan editor starts from. An empty string when none is shown.
    #[wasm_bindgen(js_name = shownPlan)]
    pub fn shown_plan(&self) -> String {
        let Some(source) = &self.source else {
            return String::new();
        };
        let mut plan = apply(source, &self.layout);
        if let Some(root) = plan.as_object_mut() {
            root.insert("layoutRevision".into(), PLAN_REVISION.into());
        }
        plan.to_string()
    }

    /// Marks element `id` as selected in the draft shown (nothing for an empty id), without
    /// building the scene again.
    #[wasm_bindgen(js_name = markSelected)]
    pub fn mark_selected(&mut self, id: &str) {
        let marks: Vec<Mark> = self
            .elements
            .iter()
            .map(|e| Mark {
                selected: e.id == id,
                conflict: false,
            })
            .collect();
        self.renderer.set_marks(&marks);
    }

    /// Shows no plan (a new plan drawn and dropped).
    #[wasm_bindgen(js_name = clearPlan)]
    pub fn clear_plan_shown(&mut self) {
        self.edit = None;
        self.clear_plan();
    }

    /// The plan point (cm, `[x, y]`) on the floor under the device pixel `x`, `y`; empty when
    /// the floor is not there.
    #[wasm_bindgen(js_name = planPoint)]
    pub fn plan_point(&self, x: f64, y: f64) -> Vec<f64> {
        self.renderer
            .plane_point(x, y, 0.0)
            .map(|p| vec![p[0], p[2]])
            .unwrap_or_default()
    }

    /// Where plan points (cm, `[x0, y0, x1, y1, …]`) are drawn on the floor, in device pixels
    /// (`NaN` for a point not in front of the camera).
    #[wasm_bindgen(js_name = screenPoints)]
    pub fn screen_points(&self, points: &[f64]) -> Vec<f64> {
        points
            .chunks_exact(2)
            .flat_map(|p| {
                self.renderer
                    .screen_point([p[0], 0.0, p[1]])
                    .unwrap_or([f64::NAN, f64::NAN])
            })
            .collect()
    }
}
