//! Edit mode for JavaScript: the session of `domotwin_core::edit`, driven with device pixels.
//!
//! Every call that changes something returns the edit state as JSON (`editState`). A change is an
//! edit overlay: it is applied to the stored plan and read again like a loaded plan; a change that
//! makes the plan invalid is forgotten.

use std::collections::BTreeSet;

use domotwin_core::edit::{Guide, Session, indices};
use domotwin_core::geometry::polygon::P2;
use domotwin_core::overlay::{Layout, MODEL_PREFIX, apply, layout_value, parse_layout};
use domotwin_core::plan::{Element, Kind, read_plan_value};
use domotwin_core::scene::build_dynamic_lit;
use domotwin_render::lamps::Mark;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::engine::Engine;

/// Snapping reach, as a share of the drawing buffer's smaller side.
const REACH: f64 = 0.015;

#[wasm_bindgen]
impl Engine {
    /// Starts edit mode on the plan shown. Returns the edit state.
    #[wasm_bindgen(js_name = beginEdit)]
    pub fn begin_edit(&mut self) -> String {
        if self.plan.is_some() && self.edit.is_none() {
            self.edit = Some(Session::new(&self.layout));
        }
        self.edit_state()
    }

    /// Ids the pieces added in this session must not take (the other storeys' elements).
    #[wasm_bindgen(js_name = editReserve)]
    pub fn edit_reserve(&mut self, ids: Vec<String>) {
        if let Some(session) = self.edit.as_mut() {
            session.reserve(ids);
        }
    }

    /// Leaves edit mode, keeping the changes shown (`keep`) or going back to the overlay saved.
    #[wasm_bindgen(js_name = endEdit)]
    pub fn end_edit(&mut self, keep: bool) {
        let Some(session) = self.edit.take() else {
            return;
        };
        self.renderer.set_marks(&[]);
        if (!keep && session.dirty()) || self.drag_built {
            let layout = if keep {
                session.layout().clone()
            } else {
                session.saved().clone()
            };
            self.drag_built = false;
            self.show_layout(&layout);
        }
    }

    /// What edit mode shows, as JSON: `editing`, `selection` (`[{"id", "name", "kind",
    /// "locked"}]`), `conflicts` (ids), `guides` (`[{"a": [x, y], "b": [x, y], "cm"}]`, device
    /// pixels, `cm` only for distances), `canUndo`, `canRedo`, `dirty`, and `changes` (a number
    /// that changes with the overlay).
    #[wasm_bindgen(js_name = editState)]
    pub fn edit_state(&self) -> String {
        let (Some(session), Some(plan)) = (&self.edit, &self.plan) else {
            return json!({ "editing": false }).to_string();
        };
        let selection: Vec<Value> = session
            .selection
            .iter()
            .filter_map(|id| {
                plan.elements.iter().find_map(|e| match e {
                    Element::Furniture(f) if f.id == *id => Some(json!({
                        "id": f.id,
                        "name": f.name,
                        "kind": f.kind.info().name,
                        "locked": f.locked,
                    })),
                    _ => None,
                })
            })
            .collect();
        let height = session.drag_height().unwrap_or(0.0);
        let point = |p: P2| self.renderer.screen_point([p[0], height, p[1]]);
        let round = |p: [f64; 2]| p.map(|v| (v * 10.0).round() / 10.0);
        let guides: Vec<Value> = session
            .guides
            .iter()
            .filter_map(|guide| match guide {
                Guide::Line { a, b } => {
                    Some(json!({ "a": round(point(*a)?), "b": round(point(*b)?) }))
                }
                Guide::Distance { a, b, cm } => Some(json!({
                    "a": round(point(*a)?),
                    "b": round(point(*b)?),
                    "cm": cm.round(),
                })),
            })
            .collect();
        json!({
            "editing": true,
            "selection": selection,
            "conflicts": session.conflicts,
            "guides": guides,
            "canUndo": session.can_undo(),
            "canRedo": session.can_redo(),
            "dirty": session.dirty(),
            "changes": session.changes(),
        })
        .to_string()
    }

    /// Selects the piece `id` (`add`: adds it to the selection or takes it out); another id
    /// clears the selection unless `add`.
    #[wasm_bindgen(js_name = editSelect)]
    pub fn edit_select(&mut self, id: &str, add: bool) -> String {
        if let (Some(session), Some(plan), Some(scene)) = (&mut self.edit, &self.plan, &self.scene)
        {
            session.select(plan, scene.walls(), id, add);
        }
        self.update_marks();
        self.edit_state()
    }

    /// Starts moving the selection when the device pixel `x`, `y` shows a selected piece that is
    /// not fixed. Returns whether it did (else the pointer turns or pans the view).
    #[wasm_bindgen(js_name = editDragStart)]
    pub fn edit_drag_start(&mut self, x: f64, y: f64) -> bool {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let tag = self.renderer.pick(x.max(0.0) as u32, y.max(0.0) as u32);
        let Some(index) = usize::from(tag).checked_sub(1) else {
            return false;
        };
        let (Some(session), Some(plan), Some(scene)) = (&mut self.edit, &self.plan, &self.scene)
        else {
            return false;
        };
        let Some(Element::Furniture(f)) = plan.elements.get(index) else {
            return false;
        };
        let Some(from) = self.renderer.plane_point(x, y, f.elevation) else {
            return false;
        };
        session.drag_start(plan, scene.walls(), &f.id.clone(), [from[0], from[2]])
    }

    /// Moves the pieces of the drag to the device pixel `x`, `y`. Returns the edit state, with
    /// the guides.
    #[wasm_bindgen(js_name = editDragMove)]
    pub fn edit_drag_move(&mut self, x: f64, y: f64) -> String {
        let Some(height) = self.edit.as_ref().and_then(Session::drag_height) else {
            return self.edit_state();
        };
        let Some(to) = self.renderer.plane_point(x, y, height) else {
            return self.edit_state();
        };
        let reach = self.reach(x, y, height);
        if !self.drag_built {
            // The pieces it moves are built apart from now on, to redraw them alone.
            let dragged = self.edit.as_ref().map(Session::dragged).unwrap_or_default();
            if let Some(plan) = self.plan.take() {
                let moving = indices(&plan, &dragged);
                self.show(plan, true, &moving, false);
            }
            self.drag_built = true;
        }
        if let (Some(session), Some(plan)) = (&mut self.edit, &mut self.plan) {
            session.drag_move(plan, [to[0], to[2]], reach);
        }
        self.redraw_dragged();
        self.update_marks();
        self.edit_state()
    }

    /// Drops the pieces of the drag where they are.
    #[wasm_bindgen(js_name = editDragEnd)]
    pub fn edit_drag_end(&mut self) -> String {
        let changed = match (&mut self.edit, &self.plan, &self.scene) {
            (Some(session), Some(plan), Some(scene)) => session.drag_end(plan, scene.walls()),
            _ => false,
        };
        if changed {
            self.commit();
        } else if self.drag_built {
            // Not moved: back to the plan as it was.
            let layout = self.layout.clone();
            self.show_layout(&layout);
        }
        self.drag_built = false;
        self.update_marks();
        self.edit_state()
    }

    /// Turns the selection by `steps` of 15° (negative: anticlockwise on the plan).
    #[wasm_bindgen(js_name = editRotate)]
    pub fn edit_rotate(&mut self, steps: i32) -> String {
        let changed = match (&mut self.edit, &self.plan, &self.scene) {
            (Some(session), Some(plan), Some(scene)) => session.rotate(plan, scene.walls(), steps),
            _ => false,
        };
        if changed {
            self.commit();
        }
        self.edit_state()
    }

    /// Removes the selected pieces.
    #[wasm_bindgen(js_name = editRemove)]
    pub fn edit_remove(&mut self) -> String {
        let changed = match (&mut self.edit, &self.plan) {
            (Some(session), Some(plan)) => session.remove(plan),
            _ => false,
        };
        if changed {
            self.commit();
        }
        self.edit_state()
    }

    /// Adds a piece of the catalogue `kind` named `name` under the device pixel `x`, `y` (or in
    /// the middle of the view when the floor is not there), and selects it. The state has
    /// `refused: true` when it could not be added (the plan holds 500 elements).
    #[wasm_bindgen(js_name = editAdd)]
    pub fn edit_add(&mut self, kind: &str, name: &str, x: f64, y: f64) -> String {
        let Some(kind) = Kind::from_name(kind) else {
            return self.edit_state();
        };
        let target = self.renderer.view.camera.target;
        let at = self
            .renderer
            .plane_point(x, y, 0.0)
            .map_or([target[0], target[2]], |p| [p[0], p[2]]);
        let added = match (&mut self.edit, &self.plan, &self.scene) {
            (Some(session), Some(plan), Some(scene)) => {
                session.add(plan, scene.walls(), kind, name, at).is_some()
            }
            _ => false,
        };
        if added {
            self.commit();
            return self.edit_state();
        }
        let mut state: Value = serde_json::from_str(&self.edit_state()).unwrap_or_default();
        if let Some(object) = state.as_object_mut() {
            object.insert("refused".into(), Value::Bool(true));
        }
        state.to_string()
    }

    /// Adds a piece of the user model `model` under the device pixel `x`, `y` (or in the middle of
    /// the view), and selects it. `definition` is the model itself (JSON) when it is imported now,
    /// empty for a model the plan has. The state has `refused: true` when it could not be added.
    #[wasm_bindgen(js_name = editAddModel)]
    pub fn edit_add_model(&mut self, model: &str, definition: &str, x: f64, y: f64) -> String {
        let define = match serde_json::from_str::<Value>(definition) {
            Ok(Value::Object(map)) => Some(map),
            _ => None,
        };
        let target = self.renderer.view.camera.target;
        let at = self
            .renderer
            .plane_point(x, y, 0.0)
            .map_or([target[0], target[2]], |p| [p[0], p[2]]);
        let added = match (&mut self.edit, &self.plan, &self.scene) {
            (Some(session), Some(plan), Some(scene)) => session
                .add_model(plan, scene.walls(), model, define, at)
                .is_some(),
            _ => false,
        };
        // A model the plan refuses (more than 50, a bad definition) is undone by the commit.
        let before = self.edit.as_ref().map(Session::changes);
        if added {
            self.commit();
        }
        let kept = added && self.edit.as_ref().map(Session::changes) == before;
        if kept {
            return self.edit_state();
        }
        let mut state: Value = serde_json::from_str(&self.edit_state()).unwrap_or_default();
        if let Some(object) = state.as_object_mut() {
            object.insert("refused".into(), Value::Bool(true));
        }
        state.to_string()
    }

    /// Forgets a model imported in edit mode that no piece shows.
    #[wasm_bindgen(js_name = editRemoveModel)]
    pub fn edit_remove_model(&mut self, model: &str) -> String {
        let changed = match (&mut self.edit, &self.plan) {
            (Some(session), Some(plan)) => session.remove_model(plan, model),
            _ => false,
        };
        if changed {
            self.commit();
        }
        self.edit_state()
    }

    /// The user models of the plan shown (« My models »), as JSON `[{"id", "name", "w", "d",
    /// "h", "color", "format", "bytes", "pieces", "removable"}]`: `format` and `bytes` are the 3D
    /// file's (`null` for a kit), `pieces` how many pieces show it, `removable` whether it was
    /// imported in edit mode and no piece shows it.
    #[wasm_bindgen(js_name = editModels)]
    pub fn edit_models(&self) -> String {
        let Some(plan) = &self.plan else {
            return "[]".to_owned();
        };
        let layout = self.edit.as_ref().map_or(&self.layout, Session::layout);
        let list: Vec<Value> = plan
            .models
            .iter()
            .map(|(id, model)| {
                let pieces = plan
                    .elements
                    .iter()
                    .filter(
                        |e| matches!(e, Element::Furniture(f) if f.model.as_deref() == Some(id)),
                    )
                    .count();
                let size = |k: usize| {
                    model
                        .get("size")
                        .and_then(|s| s.get(k))
                        .cloned()
                        .unwrap_or_default()
                };
                let file = model.get("file");
                let format = file.and_then(|f| f.get("format"));
                let bytes = file.and_then(|f| f.get("bytes"));
                let imported = layout.contains_key(&format!("{MODEL_PREFIX}{id}"));
                json!({
                    "id": id,
                    "name": model.get("name").and_then(Value::as_str).unwrap_or_default(),
                    "w": size(0),
                    "d": size(1),
                    "h": size(2),
                    "color": model.get("color").cloned().unwrap_or(Value::Null),
                    "format": format.cloned().unwrap_or(Value::Null),
                    "bytes": bytes.cloned().unwrap_or(Value::Null),
                    "pieces": pieces,
                    "removable": imported && pieces == 0,
                })
            })
            .collect();
        Value::Array(list).to_string()
    }

    /// Undoes the last change.
    #[wasm_bindgen(js_name = editUndo)]
    pub fn edit_undo(&mut self) -> String {
        if self.edit.as_mut().is_some_and(Session::undo) {
            self.commit();
        }
        self.edit_state()
    }

    /// Does again the last change undone.
    #[wasm_bindgen(js_name = editRedo)]
    pub fn edit_redo(&mut self) -> String {
        if self.edit.as_mut().is_some_and(Session::redo) {
            self.commit();
        }
        self.edit_state()
    }

    /// Puts a whole overlay (JSON, a draft kept by the browser) in place as one change that can
    /// be undone.
    #[wasm_bindgen(js_name = editRestore)]
    pub fn edit_restore(&mut self, layout: &str) -> String {
        let layout = parse_layout(layout);
        if self
            .edit
            .as_mut()
            .is_some_and(|session| session.replace(layout))
        {
            self.commit();
        }
        self.edit_state()
    }

    /// The edit overlay now, as JSON (what **Save** stores).
    #[wasm_bindgen(js_name = editLayout)]
    pub fn edit_layout(&self) -> String {
        let layout = self.edit.as_ref().map_or(&self.layout, Session::layout);
        layout_value(layout).to_string()
    }

    /// The overlay `layout` (JSON, what was sent) was stored. Changes made while it was being saved
    /// stay to be saved.
    #[wasm_bindgen(js_name = editSaved)]
    pub fn edit_saved(&mut self, layout: &str) {
        if let Some(session) = self.edit.as_mut() {
            session.mark_saved_as(parse_layout(layout));
        }
    }

    /// The catalogue of kinds a piece can be added as, as JSON `[{"kind", "w", "d", "h",
    /// "light"}]` (default sizes in cm).
    #[wasm_bindgen(js_name = editCatalogue)]
    pub fn edit_catalogue() -> String {
        let kinds: Vec<Value> = Kind::ALL
            .iter()
            .filter(|kind| **kind != Kind::Custom)
            .map(|kind| {
                let info = kind.info();
                json!({
                    "kind": info.name,
                    "w": info.size[0],
                    "d": info.size[1],
                    "h": info.size[2],
                    "light": info.flags.light,
                })
            })
            .collect();
        Value::Array(kinds).to_string()
    }
}

impl Engine {
    /// Shows the stored plan with the session's overlay, after a change; a change that makes the
    /// plan invalid is forgotten.
    fn commit(&mut self) {
        let Some(layout) = self.edit.as_ref().map(|s| s.layout().clone()) else {
            return;
        };
        if !self.show_layout(&layout) {
            if let Some(session) = self.edit.as_mut() {
                session.reject();
            }
            let back = self.edit.as_ref().map(|s| s.layout().clone());
            if let Some(back) = back {
                self.show_layout(&back);
            }
        }
        self.update_marks();
    }

    /// Shows the stored plan with `layout`, keeping the camera and the live looks. Returns
    /// `false` (and changes nothing) when the result is not a valid plan.
    fn show_layout(&mut self, layout: &Layout) -> bool {
        let Some(source) = &self.source else {
            return false;
        };
        let Ok(plan) = read_plan_value(&apply(source, layout)) else {
            return false;
        };
        self.layout = layout.clone();
        self.show(plan, true, &BTreeSet::new(), false);
        if let (Some(session), Some(plan), Some(scene)) = (&mut self.edit, &self.plan, &self.scene)
        {
            session.sync(plan, scene.walls());
        }
        true
    }

    /// Redraws the pieces being dragged, with their lamps.
    fn redraw_dragged(&mut self) {
        let (Some(plan), Some(scene)) = (&self.plan, &self.scene) else {
            return;
        };
        let (opaque, transparent, lights) = build_dynamic_lit(plan, scene, &self.live.overrides);
        self.renderer.set_moving_parts(&opaque, &transparent);
        let mut spots: Vec<_> = scene
            .lights
            .iter()
            .filter(|spot| !scene.moving().contains(&spot.element))
            .copied()
            .collect();
        spots.extend(lights);
        self.renderer.set_spots(&spots);
    }

    /// Marks the selected pieces and those in conflict.
    fn update_marks(&mut self) {
        let (Some(session), Some(plan)) = (&self.edit, &self.plan) else {
            self.renderer.set_marks(&[]);
            return;
        };
        let mut marks = vec![Mark::default(); plan.elements.len()];
        for i in indices(plan, &session.selection) {
            marks[i].selected = true;
        }
        for i in indices(plan, &session.conflicts) {
            marks[i].conflict = true;
        }
        self.renderer.set_marks(&marks);
    }

    /// Snapping reach in cm at the device pixel `x`, `y` on the plane at `height`.
    fn reach(&self, x: f64, y: f64, height: f64) -> f64 {
        let (width, buffer_height) = self.renderer.size();
        let px = REACH * f64::from(width.min(buffer_height));
        match (
            self.renderer.plane_point(x, y, height),
            self.renderer.plane_point(x + px, y, height),
        ) {
            (Some(a), Some(b)) => (a[0] - b[0]).hypot(a[2] - b[2]).clamp(1.0, 30.0),
            _ => 8.0,
        }
    }
}
