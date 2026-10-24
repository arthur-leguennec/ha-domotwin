//! DomoTwin's plan editor module (`DECISIONS.md`, D-025): the draft of `domotwin_core::structure`
//! for JavaScript, in plan centimetres. It is built as its own WebAssembly module, which the
//! frontend loads only when the plan editor opens; the engine shows each version of the draft
//! (`showDraft`) and turns screen points into plan points.
//!
//! Every change is checked by the plan reader: a refused change is forgotten and fails with the
//! reader's JSON error (`{"code", "element"}`), as the engine's do.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

use domotwin_core::ReadError;
use domotwin_core::plan::read_plan_value;
use domotwin_core::structure::Draft;
use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::*;

fn error(err: &ReadError) -> JsError {
    JsError::new(&err.to_json())
}

/// The plan (JSON text) with ids none of `taken` has, for a storey joining a home whose other
/// storeys use some of them (`DECISIONS.md`, D-026); the `parent` of its elements follows.
///
/// # Errors
///
/// `{"code": "not_json"}` when the text is not JSON.
#[wasm_bindgen(js_name = freeIds)]
pub fn free_ids(plan: &str, taken: Vec<String>) -> Result<String, JsError> {
    let mut value: Value = serde_json::from_str(plan)
        .map_err(|_| JsError::new(&json!({ "code": "not_json" }).to_string()))?;
    domotwin_core::structure::free_ids(&mut value, &taken.into_iter().collect());
    Ok(value.to_string())
}

/// A plan being edited.
#[wasm_bindgen]
#[derive(Debug)]
pub struct Planner {
    draft: Draft,
}

#[wasm_bindgen]
impl Planner {
    /// Starts editing a plan (JSON text, its edit overlay already applied).
    ///
    /// # Errors
    ///
    /// `{"code": "not_json"}` when the text is not JSON; the reader's error when it refuses the
    /// plan (its changes could not be checked).
    #[wasm_bindgen(constructor)]
    pub fn new(plan: &str) -> Result<Planner, JsError> {
        console_error_panic_hook::set_once();
        let value: Value = serde_json::from_str(plan)
            .map_err(|_| JsError::new(&json!({ "code": "not_json" }).to_string()))?;
        read_plan_value(&value).map_err(|e| error(&e))?;
        Ok(Planner {
            draft: Draft::new(value),
        })
    }

    /// A new plan titled `title` holding one room of 400 × 300 cm named `room` (a change to save),
    /// whose id is none of `reserved` (ids whose links are still stored).
    pub fn blank(title: &str, room: &str, reserved: Vec<String>) -> Planner {
        console_error_panic_hook::set_once();
        Planner {
            draft: Draft::blank(title, room, reserved),
        }
    }

    /// Ids new elements must not take: those whose links are still stored (an element removed
    /// earlier), so that a new element never takes over another's links.
    pub fn reserve(&mut self, ids: Vec<String>) {
        self.draft.reserve(ids);
    }

    /// The draft, as JSON text (what Save stores).
    pub fn plan(&self) -> String {
        self.draft.plan().to_string()
    }

    /// Changes not saved.
    pub fn dirty(&self) -> bool {
        self.draft.dirty()
    }

    /// The draft was saved as it is.
    #[wasm_bindgen(js_name = markSaved)]
    pub fn mark_saved(&mut self) {
        self.draft.mark_saved();
    }

    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.draft.can_undo()
    }

    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.draft.can_redo()
    }

    /// Undoes the last change; false when there was none.
    pub fn undo(&mut self) -> bool {
        self.draft.undo()
    }

    /// Does the last undone change again; false when there was none.
    pub fn redo(&mut self) -> bool {
        self.draft.redo()
    }

    /// Starts a drag: its changes make one change to undo.
    #[wasm_bindgen(js_name = beginDrag)]
    pub fn begin_drag(&mut self) {
        self.draft.begin_drag();
    }

    /// Ends the drag.
    #[wasm_bindgen(js_name = endDrag)]
    pub fn end_drag(&mut self) {
        self.draft.end_drag();
    }

    /// Element `id` as JSON (its fields in the plan file), or an empty string.
    pub fn element(&self, id: &str) -> String {
        self.draft
            .element(id)
            .map(Value::to_string)
            .unwrap_or_default()
    }

    /// The corners of room `id` (plan cm, `[x0, y0, x1, y1, …]`); empty for anything else.
    #[wasm_bindgen(js_name = roomPoints)]
    pub fn room_points(&self, id: &str) -> Vec<f64> {
        self.draft
            .room_points(id)
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .collect()
    }

    /// Where a point goes, snapped (rooms' corners but those of `except`, lines of corners, the
    /// 5 cm grid), then the guides it was lined up on: `[x, y, ax, ay, bx, by, …]` (plan cm).
    pub fn snap(&self, x: f64, y: f64, except: Option<String>) -> Vec<f64> {
        let (p, guides) = self.draft.snap([x, y], except.as_deref());
        let mut out = vec![p[0], p[1]];
        for guide in guides {
            out.extend([guide.a[0], guide.a[1], guide.b[0], guide.b[1]]);
        }
        out
    }

    /// Adds a rectangular room from corner (`ax`, `ay`) to (`bx`, `by`). Returns its id.
    ///
    /// # Errors
    ///
    /// The reader's (`room_size`: a side shorter than 30 cm…).
    #[wasm_bindgen(js_name = addRoom)]
    pub fn add_room(
        &mut self,
        ax: f64,
        ay: f64,
        bx: f64,
        by: f64,
        name: &str,
    ) -> Result<String, JsError> {
        self.draft
            .add_room([ax, ay], [bx, by], name)
            .map_err(|e| error(&e))
    }

    /// Adds a partition from (`ax`, `ay`) to (`bx`, `by`). Returns its id.
    ///
    /// # Errors
    ///
    /// The reader's (shorter than 5 cm…).
    #[wasm_bindgen(js_name = addWall)]
    pub fn add_wall(
        &mut self,
        ax: f64,
        ay: f64,
        bx: f64,
        by: f64,
        name: &str,
    ) -> Result<String, JsError> {
        self.draft
            .add_wall([ax, ay], [bx, by], name)
            .map_err(|e| error(&e))
    }

    /// Places a door (`door`) or a window on the side of a room nearest to (`x`, `y`). Returns its
    /// id, or an empty string when no side is near enough (60 cm).
    ///
    /// # Errors
    ///
    /// The reader's.
    #[wasm_bindgen(js_name = addOpening)]
    pub fn add_opening(
        &mut self,
        door: bool,
        x: f64,
        y: f64,
        name: &str,
    ) -> Result<String, JsError> {
        self.draft
            .add_opening(door, [x, y], name)
            .map(Option::unwrap_or_default)
            .map_err(|e| error(&e))
    }

    /// Moves corner `i` of room `id` to (`x`, `y`).
    ///
    /// # Errors
    ///
    /// The reader's (a shape that crosses itself…).
    #[wasm_bindgen(js_name = moveCorner)]
    pub fn move_corner(&mut self, id: &str, i: usize, x: f64, y: f64) -> Result<(), JsError> {
        self.draft.move_corner(id, i, [x, y]).map_err(|e| error(&e))
    }

    /// Adds a corner to side `side` of room `id` at (`x`, `y`).
    ///
    /// # Errors
    ///
    /// The reader's.
    #[wasm_bindgen(js_name = insertCorner)]
    pub fn insert_corner(&mut self, id: &str, side: usize, x: f64, y: f64) -> Result<(), JsError> {
        self.draft
            .insert_corner(id, side, [x, y])
            .map_err(|e| error(&e))
    }

    /// Removes corner `i` of room `id` (three are kept at least).
    ///
    /// # Errors
    ///
    /// The reader's.
    #[wasm_bindgen(js_name = removeCorner)]
    pub fn remove_corner(&mut self, id: &str, i: usize) -> Result<(), JsError> {
        self.draft.remove_corner(id, i).map_err(|e| error(&e))
    }

    /// Moves element `id` by (`dx`, `dy`): a room with everything in it, a partition, or a door or
    /// a window along the rooms' sides.
    ///
    /// # Errors
    ///
    /// The reader's.
    #[wasm_bindgen(js_name = moveElement)]
    pub fn move_element(&mut self, id: &str, dx: f64, dy: f64) -> Result<(), JsError> {
        self.draft.move_element(id, [dx, dy]).map_err(|e| error(&e))
    }

    /// Changes fields of element `id` (a JSON object: `name`, `floor`, `w`, `swing`, `style`,
    /// `thickness`… as its type allows; others are left alone).
    ///
    /// # Errors
    ///
    /// The reader's, or `{"code": "not_json"}`.
    pub fn update(&mut self, id: &str, fields: &str) -> Result<(), JsError> {
        let fields: Map<String, Value> = serde_json::from_str(fields)
            .map_err(|_| JsError::new(&json!({ "code": "not_json" }).to_string()))?;
        self.draft.update(id, &fields).map_err(|e| error(&e))
    }

    /// Removes element `id` (a room takes its doors and windows with it).
    ///
    /// # Errors
    ///
    /// The reader's (the last element…).
    pub fn remove(&mut self, id: &str) -> Result<(), JsError> {
        self.draft.remove(id).map_err(|e| error(&e))
    }

    /// Puts a whole plan in place (JSON text; a draft kept by the browser), as one change.
    ///
    /// # Errors
    ///
    /// The reader's, or `{"code": "not_json"}`.
    pub fn replace(&mut self, plan: &str) -> Result<(), JsError> {
        let plan: Value = serde_json::from_str(plan)
            .map_err(|_| JsError::new(&json!({ "code": "not_json" }).to_string()))?;
        self.draft.replace(plan).map_err(|e| error(&e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The error paths call into JavaScript; the core's tests cover the changes themselves.
    #[test]
    fn a_new_plan_is_drawn_and_undone() {
        let mut planner = Planner::blank("Home", "Room", vec!["room-1".to_owned()]);
        assert!(planner.dirty());
        assert_eq!(planner.room_points("room-2").len(), 8);
        let snapped = planner.snap(403.0, -4.0, None);
        assert_eq!(&snapped[..2], &[400.0, 0.0]);
        let id = planner
            .add_room(400.0, 0.0, 700.0, 300.0, "Study")
            .ok()
            .unwrap();
        assert!(planner.element(&id).contains("\"Study\""));
        let door = planner.add_opening(true, 550.0, 2.0, "Door").ok().unwrap();
        assert!(planner.element(&door).contains("\"door\""));
        assert!(
            planner
                .add_opening(true, 5_000.0, 5_000.0, "Far")
                .ok()
                .unwrap()
                .is_empty()
        );
        assert!(planner.undo());
        assert!(planner.element(&door).is_empty());
        assert!(planner.can_redo());
        planner.mark_saved();
        assert!(!planner.dirty());
        assert!(planner.plan().contains("\"Study\""));
    }
}
