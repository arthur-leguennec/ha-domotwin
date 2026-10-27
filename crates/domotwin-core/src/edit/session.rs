//! An edit session: the selection, moving pieces with the pointer, turning, removing and adding
//! them, undo and redo. Every change is an edit overlay ([`Layout`]); the engine applies it to the
//! stored plan and reads the result, so the plan file is never changed. Plan coordinates (cm).

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use super::{
    Footprint, Guide, History, RESTING, ROTATION_STEP, can_stack, carried, collisions, snap,
    snap_angle, support_under, wall_blocks, wall_faces,
};
use crate::geometry::polygon::{P2, point_in_polygon};
use crate::geometry::walls::WallLayout;
use crate::overlay::{Entry, Layout, MAX_ELEMENTS, MAX_ENTRIES, MODEL_PREFIX};
use crate::plan::{Element, Furniture, Kind, Plan, valid_model_id};

/// A piece being moved, as it was when the drag started.
#[derive(Debug, Clone, PartialEq)]
struct Start {
    id: String,
    x: f64,
    y: f64,
    elevation: f64,
}

#[derive(Debug, Clone, PartialEq)]
struct Drag {
    /// Where the pointer grabbed the lead piece (plan, on the plane of its underside).
    from: P2,
    /// The lead piece (snapping and stacking follow it) and the others moving with it.
    pieces: Vec<Start>,
    /// Only one piece selected, standing (on the floor or on a piece) when grabbed: it stands on
    /// what it is dropped on. A piece fixed higher (a TV on a wall) keeps its height.
    stands: bool,
    moved: bool,
    faces: Vec<(P2, P2)>,
    blocks: Vec<[P2; 4]>,
}

/// One edit session.
#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    history: History<Layout>,
    saved: Layout,
    /// Selected pieces (ids), in the order they were selected.
    pub selection: Vec<String>,
    /// What to draw while a piece moves.
    pub guides: Vec<Guide>,
    /// Pieces in conflict with the selection (ids): overlapping each other or a wall.
    pub conflicts: Vec<String>,
    drag: Option<Drag>,
    /// Counts the changes of the overlay (records, undo, redo), to tell when it changed.
    changes: u64,
    /// Ids an added piece must not take: the other storeys' (`DECISIONS.md`, D-026).
    reserved: BTreeSet<String>,
}

/// Whether a piece is set on top of what it is dropped over.
fn stacks(f: &Furniture) -> bool {
    can_stack(f.kind, f.model.is_some())
}

fn pieces(plan: &Plan) -> impl Iterator<Item = &Furniture> {
    plan.elements.iter().filter_map(|e| match e {
        Element::Furniture(f) => Some(f),
        _ => None,
    })
}

/// The pieces among `moving` (ids) that overlap another piece or a wall, and those they overlap.
fn conflicts(plan: &Plan, blocks: &[[P2; 4]], moving: &[String]) -> Vec<String> {
    let all: Vec<&Furniture> = pieces(plan).collect();
    let list: Vec<(Footprint, Kind)> = all.iter().map(|f| (Footprint::of(f), f.kind)).collect();
    let indices: Vec<usize> = all
        .iter()
        .enumerate()
        .filter(|(_, f)| moving.contains(&f.id))
        .map(|(i, _)| i)
        .collect();
    collisions(&list, &indices, blocks)
        .into_iter()
        .map(|i| all[i].id.clone())
        .collect()
}

fn piece<'a>(plan: &'a Plan, id: &str) -> Option<&'a Furniture> {
    pieces(plan).find(|f| f.id == id)
}

fn piece_mut<'a>(plan: &'a mut Plan, id: &str) -> Option<&'a mut Furniture> {
    plan.elements.iter_mut().find_map(|e| match e {
        Element::Furniture(f) if f.id == id => Some(f),
        _ => None,
    })
}

/// The room a plan point is in (its id): a room before a place outside around it, a deck before
/// the garden around it (D-077).
fn room_at(plan: &Plan, walls: &WallLayout, p: P2) -> Option<String> {
    walls
        .lookup_order()
        .iter()
        .map(|&k| &walls.rooms[k])
        .find(|room| point_in_polygon(p, &room.points, false))
        .and_then(|room| match plan.elements.get(room.element) {
            Some(Element::Room(r)) => Some(r.id.clone()),
            _ => None,
        })
}

/// The ids of the pieces resting on `ids` (and on those), not in `ids`, not fixed.
fn carried_by(plan: &Plan, ids: &[String]) -> Vec<String> {
    let all: Vec<&Furniture> = pieces(plan).collect();
    let footprints: Vec<Footprint> = all.iter().map(|f| Footprint::of(f)).collect();
    let mut out: Vec<String> = Vec::new();
    for (i, f) in all.iter().enumerate() {
        if !ids.contains(&f.id) {
            continue;
        }
        for j in carried(i, &footprints) {
            let other = all[j];
            if !other.locked && !ids.contains(&other.id) && !out.contains(&other.id) {
                out.push(other.id.clone());
            }
        }
    }
    out
}

/// A piece at its place now, turned around `pivot` by `delta` degrees: its new box corner and
/// angle.
fn turned(f: &Furniture, pivot: P2, delta: f64) -> (f64, f64, f64) {
    let (s, c) = delta.to_radians().sin_cos();
    let [cx, cy] = f.center();
    let (dx, dy) = (cx - pivot[0], cy - pivot[1]);
    let centre = [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
    (
        centre[0] - f.w / 2.0,
        centre[1] - f.h / 2.0,
        (f.angle + delta).rem_euclid(360.0),
    )
}

impl Session {
    /// Starts editing a plan shown with `layout`.
    pub fn new(layout: &Layout) -> Self {
        Session {
            history: History::new(layout.clone()),
            saved: layout.clone(),
            selection: Vec::new(),
            guides: Vec::new(),
            conflicts: Vec::new(),
            drag: None,
            changes: 0,
            reserved: BTreeSet::new(),
        }
    }

    /// Ids pieces added from now on must not take.
    pub fn reserve(&mut self, ids: impl IntoIterator<Item = String>) {
        self.reserved.extend(ids);
    }

    /// A number that changes whenever the overlay does.
    pub fn changes(&self) -> u64 {
        self.changes
    }

    /// The overlay now.
    pub fn layout(&self) -> &Layout {
        self.history.current()
    }

    /// The overlay as stored.
    pub fn saved(&self) -> &Layout {
        &self.saved
    }

    /// Whether there are changes not saved.
    pub fn dirty(&self) -> bool {
        *self.history.current() != self.saved
    }

    /// The overlay now is the one stored.
    pub fn mark_saved(&mut self) {
        self.saved = self.history.current().clone();
    }

    /// `layout` is the one stored (it may differ from the overlay now: changes made while it was
    /// being saved).
    pub fn mark_saved_as(&mut self, layout: Layout) {
        self.saved = layout;
    }

    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    pub fn undo(&mut self) -> bool {
        self.drag = None;
        let done = self.history.undo().is_some();
        self.changes += u64::from(done);
        done
    }

    pub fn redo(&mut self) -> bool {
        self.drag = None;
        let done = self.history.redo().is_some();
        self.changes += u64::from(done);
        done
    }

    /// Puts a whole overlay in place as one change (a draft restored). Returns whether it changed
    /// anything.
    pub fn replace(&mut self, layout: Layout) -> bool {
        self.drag = None;
        self.record(layout)
    }

    /// Forgets the last change (the plan it made was refused).
    pub fn reject(&mut self) {
        self.history.drop_current();
        self.changes += 1;
    }

    fn record(&mut self, layout: Layout) -> bool {
        if layout == *self.history.current() || layout.len() > MAX_ENTRIES {
            return false;
        }
        self.history.push(layout);
        self.changes += 1;
        true
    }

    /// After the plan was read again (a change, undo, redo): drops what no longer exists from the
    /// selection and checks it for conflicts.
    pub fn sync(&mut self, plan: &Plan, walls: &WallLayout) {
        self.selection.retain(|id| piece(plan, id).is_some());
        self.conflicts = conflicts(plan, &wall_blocks(walls), &self.selection);
    }

    /// Selects a piece (`add`: adds it to the selection, or takes it out). Another id (a room, a
    /// wall, nothing) clears the selection unless `add`.
    pub fn select(&mut self, plan: &Plan, walls: &WallLayout, id: &str, add: bool) {
        self.drag = None;
        match (piece(plan, id), add) {
            (Some(_), true) => {
                if let Some(at) = self.selection.iter().position(|s| s == id) {
                    self.selection.remove(at);
                } else {
                    self.selection.push(id.to_owned());
                }
            }
            (Some(_), false) => self.selection = vec![id.to_owned()],
            (None, true) => {}
            (None, false) => self.selection.clear(),
        }
        self.guides.clear();
        self.sync(plan, walls);
    }

    /// The selected pieces that may change (not fixed).
    pub fn movable(&self, plan: &Plan) -> Vec<String> {
        self.selection
            .iter()
            .filter(|id| piece(plan, id).is_some_and(|f| !f.locked))
            .cloned()
            .collect()
    }

    /// Element ids of the pieces a drag moves (built apart so that they redraw alone).
    pub fn dragged(&self) -> Vec<String> {
        self.drag
            .iter()
            .flat_map(|d| d.pieces.iter().map(|p| p.id.clone()))
            .collect()
    }

    /// Height (cm) of the underside of the piece a drag holds when it was grabbed: the pointer
    /// moves on that plane for the whole drag, even when the piece goes up onto a table.
    pub fn drag_height(&self) -> Option<f64> {
        self.drag
            .as_ref()?
            .pieces
            .first()
            .map(|lead| lead.elevation)
    }

    /// Starts moving the selection, grabbed by the piece `id` at `from` (plan, on the plane of its
    /// underside). Returns `false` when `id` is not selected or fixed.
    pub fn drag_start(&mut self, plan: &Plan, walls: &WallLayout, id: &str, from: P2) -> bool {
        let movable = self.movable(plan);
        if !movable.iter().any(|m| m == id) {
            return false;
        }
        let mut ids = vec![id.to_owned()];
        ids.extend(movable.iter().filter(|m| *m != id).cloned());
        let carried = carried_by(plan, &ids);
        ids.extend(carried);
        // Standing on the floor or on a piece: it may stand on another one.
        let stands = movable.len() == 1
            && piece(plan, id).is_some_and(|f| {
                let others: Vec<(Footprint, Kind)> = pieces(plan)
                    .filter(|o| !ids.contains(&o.id))
                    .map(|o| (Footprint::of(o), o.kind))
                    .collect();
                f.elevation < RESTING
                    || support_under(&Footprint::of(f), stacks(f), &others, &[])
                        .is_some_and(|(_, top)| (top - f.elevation).abs() < RESTING)
            });
        let pieces = ids
            .iter()
            .filter_map(|id| piece(plan, id))
            .map(|f| Start {
                id: f.id.clone(),
                x: f.x,
                y: f.y,
                elevation: f.elevation,
            })
            .collect();
        self.drag = Some(Drag {
            from,
            pieces,
            stands,
            moved: false,
            faces: wall_faces(walls),
            blocks: wall_blocks(walls),
        });
        true
    }

    /// Moves the dragged pieces in `plan` for the pointer at `to`: the lead piece snaps onto
    /// walls and pieces within `reach` cm and, alone, stands on what it is over. Returns `false`
    /// without a drag.
    pub fn drag_move(&mut self, plan: &mut Plan, to: P2, reach: f64) -> bool {
        let Some(drag) = self.drag.as_mut() else {
            return false;
        };
        let Some(lead) = drag.pieces.first() else {
            return false;
        };
        let Some(f) = piece(plan, &lead.id) else {
            return false;
        };
        let stacking = stacks(f);
        let start = Footprint::of(&Furniture {
            x: lead.x,
            y: lead.y,
            elevation: lead.elevation,
            ..f.clone()
        });
        let delta = [to[0] - drag.from[0], to[1] - drag.from[1]];
        drag.moved |= delta[0].hypot(delta[1]) > 0.5;
        let others: Vec<(Footprint, Kind)> = pieces(plan)
            .filter(|o| !drag.pieces.iter().any(|p| p.id == o.id) && !o.kind.info().flags.hanging)
            .map(|o| (Footprint::of(o), o.kind))
            .collect();
        let footprints: Vec<Footprint> = others.iter().map(|(fp, _)| *fp).collect();
        let proposed = [start.centre[0] + delta[0], start.centre[1] + delta[1]];
        let snapped = snap(&start, proposed, &drag.faces, &footprints, reach);
        let d = [
            snapped.centre[0] - start.centre[0],
            snapped.centre[1] - start.centre[1],
        ];
        let elevation = if drag.stands && stacking {
            let at = Footprint {
                centre: snapped.centre,
                ..start
            };
            support_under(&at, true, &others, &[]).map_or(0.0, |(_, top)| top)
        } else {
            lead.elevation
        };
        let rise = elevation - lead.elevation;
        for p in &drag.pieces {
            if let Some(f) = piece_mut(plan, &p.id) {
                f.x = p.x + d[0];
                f.y = p.y + d[1];
                f.elevation = (p.elevation + rise).clamp(0.0, 300.0);
            }
        }
        let ids: Vec<String> = drag.pieces.iter().map(|p| p.id.clone()).collect();
        self.conflicts = conflicts(plan, &drag.blocks, &ids);
        self.guides = snapped.guides;
        true
    }

    /// Ends a drag: records where the pieces went (and the room they are now in). Returns
    /// whether the overlay changed.
    pub fn drag_end(&mut self, plan: &Plan, walls: &WallLayout) -> bool {
        let Some(drag) = self.drag.take() else {
            return false;
        };
        self.guides.clear();
        if !drag.moved {
            return false;
        }
        let mut layout = self.layout().clone();
        for start in &drag.pieces {
            let Some(f) = piece(plan, &start.id) else {
                continue;
            };
            let entry = layout.entry(f.id.clone()).or_default();
            entry.at = Some(f.center());
            entry.lift = Some(f.elevation);
            if let Some(room) = room_at(plan, walls, f.center()).filter(|r| *r != f.parent) {
                entry.room = Some(room);
            }
        }
        self.record(layout)
    }

    /// Turns the selection by `steps` rotation steps (negative: anticlockwise). One piece turns
    /// on itself onto the next step; several turn together around their middle. Pieces standing on
    /// them turn with them.
    pub fn rotate(&mut self, plan: &Plan, walls: &WallLayout, steps: i32) -> bool {
        self.drag = None;
        let movable = self.movable(plan);
        let selected: Vec<&Furniture> = movable.iter().filter_map(|id| piece(plan, id)).collect();
        let Some(first) = selected.first() else {
            return false;
        };
        let turn = f64::from(steps) * ROTATION_STEP;
        let (pivot, delta) = if selected.len() == 1 {
            let delta = snap_angle(first.angle + turn) - first.angle;
            // The short way round: 345 → 0 is +15, not −345.
            (first.center(), (delta + 180.0).rem_euclid(360.0) - 180.0)
        } else {
            let n = selected.len() as f64;
            let sum = selected.iter().fold([0.0, 0.0], |acc, f| {
                let c = f.center();
                [acc[0] + c[0], acc[1] + c[1]]
            });
            ([sum[0] / n, sum[1] / n], turn)
        };
        let mut ids = movable.clone();
        ids.extend(carried_by(plan, &movable));
        let mut layout = self.layout().clone();
        for f in ids.iter().filter_map(|id| piece(plan, id)) {
            let (x, y, angle) = turned(f, pivot, delta);
            let entry = layout.entry(f.id.clone()).or_default();
            let centre = [x + f.w / 2.0, y + f.h / 2.0];
            entry.at = Some(centre);
            entry.rotation = Some(angle);
            if let Some(room) = room_at(plan, walls, centre).filter(|r| *r != f.parent) {
                entry.room = Some(room);
            }
        }
        self.record(layout)
    }

    /// Removes the selected pieces (pieces added in edit mode are forgotten). What stood on them
    /// goes down to the floor.
    pub fn remove(&mut self, plan: &Plan) -> bool {
        self.drag = None;
        let movable = self.movable(plan);
        if movable.is_empty() {
            return false;
        }
        let mut layout = self.layout().clone();
        for id in &movable {
            if layout.get(id).is_some_and(|e| e.add.is_some()) {
                layout.remove(id);
            } else {
                layout.insert(
                    id.clone(),
                    Entry {
                        removed: true,
                        ..Entry::default()
                    },
                );
            }
        }
        for id in carried_by(plan, &movable) {
            if piece(plan, &id).is_some_and(stacks) {
                layout.entry(id).or_default().lift = Some(0.0);
            }
        }
        self.selection.retain(|id| !movable.contains(id));
        self.record(layout)
    }

    /// Adds a piece of `kind` in `style` (`None`: its own) named `name` centred on `at` (standing
    /// on what is there), at the size and lift of its style, and selects it. Returns its id.
    pub fn add(
        &mut self,
        plan: &Plan,
        walls: &WallLayout,
        kind: Kind,
        style: Option<&str>,
        name: &str,
        at: P2,
    ) -> Option<String> {
        if kind == Kind::Box {
            return None;
        }
        let style = style.filter(|s| kind.has_variant(s));
        let info = kind.style_info(style);
        let piece = Added {
            kind,
            style,
            name: name.to_owned(),
            color: info.color.to_hex(),
            size: info.size,
            elevation: info.elevation,
            model: None,
        };
        self.add_piece(plan, walls, &piece, at, None)
    }

    /// Adds a piece of the user model `model` centred on `at`, and selects it; `define` adds the
    /// model itself to the overlay in the same step (a model imported in edit mode). Returns the
    /// piece's id.
    pub fn add_model(
        &mut self,
        plan: &Plan,
        walls: &WallLayout,
        model: &str,
        define: Option<Map<String, Value>>,
        at: P2,
    ) -> Option<String> {
        if !valid_model_id(model) {
            return None;
        }
        let known = plan.models.get(model).and_then(Value::as_object);
        let fields = define.as_ref().or(known)?;
        let size = fields.get("size").and_then(Value::as_array)?;
        let size: Vec<f64> = size.iter().filter_map(Value::as_f64).collect();
        let &[w, d, h] = size.as_slice() else {
            return None;
        };
        if ![w, d, h].iter().all(|v| v.is_finite() && *v >= 1.0) {
            return None;
        }
        let name = fields
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("3D model")
            .to_owned();
        let color = fields
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_MODEL_COLOR)
            .to_owned();
        let piece = Added {
            kind: Kind::Box,
            style: None,
            name,
            color,
            size: [w, d, h],
            elevation: 0.0,
            model: Some(model),
        };
        let definition = define.map(|m| {
            (
                format!("{MODEL_PREFIX}{model}"),
                Entry {
                    model: Some(m),
                    ..Entry::default()
                },
            )
        });
        self.add_piece(plan, walls, &piece, at, definition)
    }

    /// Forgets a model imported in edit mode that no piece shows. Returns whether it did.
    pub fn remove_model(&mut self, plan: &Plan, model: &str) -> bool {
        let key = format!("{MODEL_PREFIX}{model}");
        if !self.layout().contains_key(&key)
            || pieces(plan).any(|f| f.model.as_deref() == Some(model))
        {
            return false;
        }
        self.drag = None;
        let mut layout = self.layout().clone();
        layout.remove(&key);
        self.record(layout)
    }

    fn add_piece(
        &mut self,
        plan: &Plan,
        walls: &WallLayout,
        piece: &Added<'_>,
        at: P2,
        definition: Option<(String, Entry)>,
    ) -> Option<String> {
        if plan.elements.len() >= MAX_ELEMENTS {
            return None;
        }
        self.drag = None;
        let info = piece.kind.info();
        let [w, d, h] = piece.size;
        let lift = piece.elevation;
        let layout = self.layout().clone();
        // A piece of a user model is named after neither a kind nor the model's name.
        let stem = if piece.model.is_some() {
            "model"
        } else {
            info.name
        };
        let id = (1..).map(|n| format!("{stem}-added-{n}")).find(|id| {
            !layout.contains_key(id)
                && !self.reserved.contains(id)
                && !plan.elements.iter().any(|e| e.id() == id)
        })?;
        let mut element = Map::new();
        element.insert(
            "name".into(),
            Value::from(piece.name.chars().take(100).collect::<String>()),
        );
        if let Some(model) = piece.model {
            element.insert("model".into(), Value::from(model));
        } else {
            element.insert("kind".into(), Value::from(info.name));
            if let Some(style) = piece.style {
                element.insert("style".into(), Value::from(style));
            }
        }
        element.insert("color".into(), Value::from(piece.color.clone()));
        element.insert("size".into(), Value::from(vec![w, d, h]));
        let here = Footprint {
            centre: at,
            half: [w / 2.0, d / 2.0],
            angle: 0.0,
            bottom: lift,
            top: lift + h,
        };
        let others: Vec<(Footprint, Kind)> =
            pieces(plan).map(|f| (Footprint::of(f), f.kind)).collect();
        let elevation = support_under(
            &here,
            can_stack(piece.kind, piece.model.is_some()),
            &others,
            &[],
        )
        .map_or(lift, |(_, top)| top);
        let entry = Entry {
            at: Some(at),
            lift: (elevation > 0.0).then_some(elevation),
            room: room_at(plan, walls, at),
            add: Some(element),
            ..Entry::default()
        };
        let mut layout = layout;
        if let Some((key, model)) = definition {
            layout.insert(key, model);
        }
        layout.insert(id.clone(), entry);
        if !self.record(layout) {
            return None;
        }
        self.selection = vec![id.clone()];
        Some(id)
    }
}

/// Colour of new pieces of a model without one (`plan-format.md`).
const DEFAULT_MODEL_COLOR: &str = "#b8ad9a";

/// A piece about to be added.
#[derive(Debug)]
struct Added<'a> {
    kind: Kind,
    /// Its style (D-074).
    style: Option<&'a str>,
    name: String,
    color: String,
    /// Width, depth, height (cm).
    size: [f64; 3],
    /// The height of its underside (cm).
    elevation: f64,
    model: Option<&'a str>,
}

/// The ids in `plan` order of `ids` (to build their indices).
pub fn indices(plan: &Plan, ids: &[String]) -> BTreeSet<usize> {
    plan.elements
        .iter()
        .enumerate()
        .filter(|(_, e)| ids.iter().any(|id| id == e.id()))
        .map(|(i, _)| i)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay::apply;
    use crate::plan::Rgb8;
    use crate::plan::read_plan_value;

    const DEMO: &str = include_str!("../../../../examples/demo-apartment.domotwin.json");

    /// The demo plan with an overlay, as the engine shows it.
    fn shown(layout: &Layout) -> (Plan, WallLayout) {
        let source: Value = serde_json::from_str(DEMO).unwrap();
        let plan = read_plan_value(&apply(&source, layout)).unwrap();
        let walls = WallLayout::new(&plan);
        (plan, walls)
    }

    fn at(plan: &Plan, id: &str) -> (f64, f64, f64, f64) {
        let f = piece(plan, id).unwrap();
        (f.x, f.y, f.elevation, f.angle)
    }

    /// Drags piece `id` by `by` and drops it; returns the session's plan after.
    fn drag(session: &mut Session, id: &str, by: P2) -> (Plan, WallLayout) {
        let (mut plan, walls) = shown(session.layout());
        let from = piece(&plan, id).unwrap().center();
        assert!(session.drag_start(&plan, &walls, id, from));
        let to = [from[0] + by[0], from[1] + by[1]];
        assert!(session.drag_move(&mut plan, to, 3.0));
        session.drag_end(&plan, &walls);
        shown(session.layout())
    }

    #[test]
    fn moves_a_piece_with_what_stands_on_it() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        session.select(&plan, &walls, "sideboard", false);
        assert_eq!(session.selection, ["sideboard"]);
        let (plan, walls) = drag(&mut session, "sideboard", [100.0, -40.0]);
        assert_eq!(at(&plan, "sideboard").0, 255.0);
        assert_eq!(at(&plan, "sideboard").1, 335.0);
        // The lamp on it came along, still on top.
        assert_eq!(at(&plan, "table-lamp"), (290.0, 343.0, 85.0, 0.0));
        assert!(session.dirty() && session.can_undo());
        // Back towards the wall: snapped against it.
        let (plan, _) = {
            session.select(&plan, &walls, "sideboard", false);
            drag(&mut session, "sideboard", [0.0, 38.0])
        };
        // The demo sideboard overlapped the wall; its back now touches the face (415).
        assert_eq!(at(&plan, "sideboard").1, 370.0, "pulled onto the wall face");
    }

    #[test]
    fn stacks_on_tables_and_drops_to_the_floor() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        session.select(&plan, &walls, "table-lamp", false);
        // From the sideboard (centre 205, 398) onto the coffee table (centre 212.5, 210).
        let (plan, walls) = drag(&mut session, "table-lamp", [7.5, -188.0]);
        assert_eq!(at(&plan, "table-lamp").2, 42.0);
        session.select(&plan, &walls, "table-lamp", false);
        let (plan, _) = drag(&mut session, "table-lamp", [150.0, 0.0]);
        assert_eq!(at(&plan, "table-lamp").2, 0.0);
    }

    #[test]
    fn turns_removes_and_adds() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        session.select(&plan, &walls, "chair-1", false);
        assert!(session.rotate(&plan, &walls, -1));
        let (plan, walls) = shown(session.layout());
        assert_eq!(at(&plan, "chair-1").3, 345.0);
        assert_eq!(at(&plan, "chair-1").0, 610.0, "turned on itself");
        assert!(session.rotate(&plan, &walls, 1));
        let (plan, walls) = shown(session.layout());
        assert_eq!(at(&plan, "chair-1").3, 0.0);

        // Removing the sideboard puts its lamp on the floor.
        session.select(&plan, &walls, "sideboard", false);
        assert!(session.remove(&plan));
        let (plan, walls) = shown(session.layout());
        assert!(piece(&plan, "sideboard").is_none());
        assert_eq!(at(&plan, "table-lamp").2, 0.0);
        assert!(session.selection.is_empty());

        // A floor lamp in the bedroom.
        let id = session
            .add(&plan, &walls, Kind::FloorLamp, None, "Lamp", [480.0, 700.0])
            .unwrap();
        assert_eq!(id, "floor-lamp-added-1");
        // Another storey's ids are not taken.
        let mut other = Session::new(&Layout::new());
        other.reserve(["floor-lamp-added-1".to_owned()]);
        let (plan_before, walls_before) = shown(other.layout());
        let next = other
            .add(
                &plan_before,
                &walls_before,
                Kind::FloorLamp,
                None,
                "Lamp",
                [480.0, 700.0],
            )
            .unwrap();
        assert_eq!(next, "floor-lamp-added-2");
        let (plan, walls) = shown(session.layout());
        let lamp = piece(&plan, &id).unwrap();
        assert_eq!(
            (lamp.center(), lamp.parent.as_str()),
            ([480.0, 700.0], "bedroom")
        );
        assert_eq!(session.selection, std::slice::from_ref(&id));
        // Removing an added piece forgets it.
        assert!(session.remove(&plan));
        assert!(!session.layout().contains_key(&id));
        let (plan, _) = shown(session.layout());
        assert!(piece(&plan, &id).is_none());
        let _ = walls;
    }

    #[test]
    fn a_piece_is_added_in_its_style_at_its_size_and_lift() {
        // D-074: a soundbar is added at a soundbar's size, a dome camera on the ceiling, a style
        // the kind does not have as the kind.
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(session.layout());
        let bar = session
            .add(
                &plan,
                &walls,
                Kind::Speaker,
                Some("soundbar"),
                "Speaker",
                [480.0, 700.0],
            )
            .unwrap();
        let (plan, walls) = shown(session.layout());
        let dome = session
            .add(
                &plan,
                &walls,
                Kind::Camera,
                Some("dome"),
                "Camera",
                [480.0, 600.0],
            )
            .unwrap();
        let (plan, walls) = shown(session.layout());
        let odd = session
            .add(
                &plan,
                &walls,
                Kind::Sofa,
                Some("dome"),
                "Sofa",
                [300.0, 600.0],
            )
            .unwrap();
        let (plan, _) = shown(session.layout());
        let bar = piece(&plan, &bar).unwrap();
        assert_eq!(
            (bar.variant.as_deref(), [bar.w, bar.h, bar.z], bar.color),
            (
                Some("soundbar"),
                [90.0, 10.0, 7.0],
                Rgb8::from_u32(0x2a2c2e)
            )
        );
        let dome = piece(&plan, &dome).unwrap();
        assert_eq!(
            (dome.variant.as_deref(), dome.elevation),
            (Some("dome"), 256.0)
        );
        let odd = piece(&plan, &odd).unwrap();
        assert_eq!((odd.variant.as_deref(), odd.w), (None, 210.0));
        let entry = session.layout().get("speaker-added-1").unwrap();
        assert_eq!(
            entry.add.as_ref().and_then(|a| a.get("style")),
            Some(&Value::from("soundbar"))
        );
    }

    #[test]
    fn several_pieces_turn_around_their_middle() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        session.select(&plan, &walls, "chair-1", false);
        session.select(&plan, &walls, "chair-2", true);
        assert_eq!(session.selection.len(), 2);
        // Centres 632.5 and 687.5 at y 172.5: a half turn swaps them.
        assert!(session.rotate(&plan, &walls, 12));
        let (plan, _) = shown(session.layout());
        let c1 = piece(&plan, "chair-1").unwrap().center();
        assert!(
            (c1[0] - 687.5).abs() < 1e-6 && (c1[1] - 172.5).abs() < 1e-6,
            "{c1:?}"
        );
        assert_eq!(at(&plan, "chair-1").3, 180.0);
    }

    #[test]
    fn marks_conflicts_and_undoes() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        session.select(&plan, &walls, "armchair", false);
        assert!(session.conflicts.is_empty());
        // Onto the coffee table.
        let (plan, walls) = drag(&mut session, "armchair", [-90.0, -110.0]);
        session.select(&plan, &walls, "armchair", false);
        assert_eq!(session.conflicts, ["coffee-table", "armchair"]);
        assert!(session.undo());
        let (plan, walls) = shown(session.layout());
        session.sync(&plan, &walls);
        assert!(session.conflicts.is_empty());
        assert!(!session.dirty());
        assert!(session.redo());
        session.mark_saved();
        assert!(!session.dirty());
        // A refused change is forgotten.
        session.select(&plan, &walls, "plant-living", false);
        assert!(session.remove(&plan));
        session.reject();
        assert!(!session.dirty() && !session.can_redo());
    }

    #[test]
    fn the_pointer_stays_on_the_plane_it_grabbed() {
        let mut session = Session::new(&Layout::new());
        let (mut plan, walls) = shown(&Layout::new());
        session.select(&plan, &walls, "table-lamp", false);
        let from = piece(&plan, "table-lamp").unwrap().center();
        assert!(session.drag_start(&plan, &walls, "table-lamp", from));
        assert_eq!(session.drag_height(), Some(85.0));
        // Over the coffee table: it goes down onto it, the pointer plane does not move.
        session.drag_move(&mut plan, [212.5, 210.0], 3.0);
        assert_eq!(piece(&plan, "table-lamp").unwrap().elevation, 42.0);
        assert_eq!(session.drag_height(), Some(85.0));
    }

    #[test]
    fn pieces_fixed_high_keep_their_height() {
        let source: Value = serde_json::from_str(DEMO).unwrap();
        let mut high = source.clone();
        for e in high["items"].as_array_mut().unwrap() {
            if e["id"] == "plant-living" {
                // A plant on a shelf the plan does not have: it hangs at 120 cm.
                e["lift"] = Value::from(120);
            }
        }
        let mut plan = read_plan_value(&high).unwrap();
        let walls = WallLayout::new(&plan);
        let mut session = Session::new(&Layout::new());
        session.select(&plan, &walls, "plant-living", false);
        let from = piece(&plan, "plant-living").unwrap().center();
        assert!(session.drag_start(&plan, &walls, "plant-living", from));
        session.drag_move(&mut plan, [from[0] + 30.0, from[1] + 30.0], 3.0);
        assert_eq!(piece(&plan, "plant-living").unwrap().elevation, 120.0);
    }

    #[test]
    fn adds_in_the_kind_colour_up_to_the_limit() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        let id = session
            .add(&plan, &walls, Kind::Sofa, None, "Sofa", [300.0, 200.0])
            .unwrap();
        let (plan, _) = shown(session.layout());
        assert_eq!(piece(&plan, &id).unwrap().color, Kind::Sofa.info().color);
        // A plan already holding 500 elements takes no more.
        let mut full = plan.clone();
        while full.elements.len() < MAX_ELEMENTS {
            full.elements.push(full.elements[0].clone());
        }
        assert!(
            session
                .add(&full, &walls, Kind::Plant, None, "Plant", [100.0, 100.0])
                .is_none()
        );
    }

    #[test]
    fn adds_imported_models_in_one_step() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        let stool = serde_json::json!({ "name": "Stool", "size": [38, 42, 71], "color": "#a0714a",
            "file": { "format": "glb", "hash": "b".repeat(64), "bytes": 100, "up": "y" } });
        let Value::Object(stool) = stool else {
            panic!("an object")
        };
        assert!(
            session
                .add_model(&plan, &walls, "m-1", None, [300.0, 200.0])
                .is_none(),
            "an unknown model"
        );
        let id = session
            .add_model(&plan, &walls, "m-1", Some(stool), [300.0, 200.0])
            .unwrap();
        assert!(session.layout().contains_key("@model:m-1"));
        assert_eq!(id, "model-added-1");
        let added = session.layout()[&id].add.as_ref().unwrap();
        assert!(added.get("kind").is_none(), "the model gives its shape");
        let (plan, walls) = shown(session.layout());
        let f = piece(&plan, &id).unwrap();
        assert_eq!(
            (
                f.kind,
                f.model.as_deref(),
                f.w,
                f.h,
                f.z,
                f.color.to_hex().as_str()
            ),
            (Kind::Box, Some("m-1"), 38.0, 42.0, 71.0, "#a0714a")
        );
        // Another piece of the same model, known to the plan now.
        let second = session
            .add_model(&plan, &walls, "m-1", None, [100.0, 100.0])
            .unwrap();
        assert_ne!(second, id);
        // In use: kept.
        let (plan, _) = shown(session.layout());
        assert!(!session.remove_model(&plan, "m-1"));
        // Undoing the import takes the model away with its piece.
        assert!(session.undo() && session.undo());
        assert!(session.layout().is_empty());
        assert!(session.redo());
        session.select(&plan, &walls, &id, false);
        assert!(session.remove(&plan));
        let (plan, _) = shown(session.layout());
        assert!(session.remove_model(&plan, "m-1"));
        assert!(session.layout().is_empty());
        assert!(!session.remove_model(&plan, "m-1"));
    }

    #[test]
    fn counts_changes_and_saves_what_was_sent() {
        let mut session = Session::new(&Layout::new());
        let (plan, walls) = shown(&Layout::new());
        session.select(&plan, &walls, "bed", false);
        assert_eq!(session.changes(), 0);
        assert!(session.rotate(&plan, &walls, 1));
        let sent = session.layout().clone();
        let (plan, walls) = shown(session.layout());
        // Turned again while the save was on its way: still a change to save.
        assert!(session.rotate(&plan, &walls, 1));
        session.mark_saved_as(sent);
        assert!(session.dirty());
        assert_eq!(session.changes(), 2);
        assert!(session.undo());
        assert!(!session.dirty());
        assert_eq!(session.changes(), 3);
    }

    #[test]
    fn fixed_pieces_stay() {
        let mut layout = Layout::new();
        let source: Value = serde_json::from_str(DEMO).unwrap();
        let mut locked = source.clone();
        for e in locked["items"].as_array_mut().unwrap() {
            if e["id"] == "bed" {
                e["fixed"] = Value::Bool(true);
            }
        }
        let plan = read_plan_value(&locked).unwrap();
        let walls = WallLayout::new(&plan);
        let mut session = Session::new(&layout);
        session.select(&plan, &walls, "bed", false);
        assert_eq!(session.selection, ["bed"], "selected, to see it");
        assert!(!session.drag_start(&plan, &walls, "bed", [660.0, 525.0]));
        assert!(!session.rotate(&plan, &walls, 1));
        assert!(!session.remove(&plan));
        layout.clear();
        assert_eq!(*session.layout(), layout);
    }
}
