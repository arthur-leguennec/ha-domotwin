//! The 3D scene of a plan, as renderer-agnostic meshes: floors and walls, doors and windows,
//! furniture and user models. A few meshes cover everything (opaque, the walls, and glass with the
//! contact shadows), so the renderer draws the whole home in a few calls.
//!
//! A scene holds one storey, or every storey of the home (D-028): each storey is a part of its
//! own, built on its floor and drawn at its height, while the elements, room slots, wall groups
//! and lamps are the home's (an element's tag is its index in the storeys' elements one after the
//! other, as [`stack_plans`] lists them).
//!
//! Walls belong to **groups** by direction (10° steps, interior and façade apart; each free
//! partition its own): the renderer cuts away the groups facing the camera by lowering them to
//! [`CUT_HEIGHT`](crate::geometry::heights::CUT_HEIGHT), in the vertex shader.

pub mod figures;
pub mod lines;
pub mod mesh;
pub mod wires;

mod furniture;
mod imported;
mod openings;
mod roof;
mod structure;

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use crate::geometry::heights::WALL_HEIGHT;
use crate::geometry::polygon::{P2, label_point, point_in_polygon};
use crate::geometry::walls::WallLayout;
use crate::model_mesh::ModelMesh;
use crate::plan::{Element, Plan};
use mesh::{Mesh, NO_GROUP};

/// Most wall groups a scene has (the shader keeps one cut height per group).
pub const MAX_GROUPS: usize = 128;

/// Most triangles drawn from 3D files in one scene; pieces past it are boxes.
pub const MAX_FILE_TRIANGLES: usize = 600_000;

/// The meshes of the plan's 3D files, by SHA-256 (`models[…].file.hash`).
pub type ModelMeshes = BTreeMap<String, Rc<ModelMesh>>;

/// A group of walls cut away together.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WallGroup {
    /// Unit normal on the plan, pointing out of the rooms (façades) or of one of the two rooms
    /// (partitions).
    pub normal: [f64; 2],
    /// Partition between rooms (cut when seen edge-on less than face-on) or façade.
    pub inner: bool,
}

/// A light source of a lamp (for lighting effects and live state).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LightSpot {
    /// Element index in `Plan::elements`.
    pub element: usize,
    /// The storey (part) it is on.
    pub storey: usize,
    /// Position (world, cm).
    pub position: [f64; 3],
    /// Colour.
    pub color: crate::plan::Rgb8,
    /// Intensity in % of the default.
    pub power: f64,
    /// Switched on in the plan.
    pub on: bool,
    /// Room slot the light stays in (0: none).
    pub room: u8,
    /// A screen (TV) rather than a lamp.
    pub screen: bool,
}

/// What the scene knows about one element.
#[derive(Debug, Clone, PartialEq)]
pub struct ElementInfo {
    /// Element id.
    pub id: String,
    /// `room`, `wall`, `door`, `window` or `furniture`.
    pub kind: &'static str,
    /// Bounding box `[min, max]` of its geometry on its storey's floor (zeros when it has none).
    pub bounds: [[f32; 3]; 2],
    /// Room slot it belongs to (0: none).
    pub room: u8,
    /// A door's or a window's room slot on its other side (0: none, or the same room).
    pub beside: u8,
    /// The storey (part) it is on.
    pub storey: usize,
}

impl ElementInfo {
    /// The top of the centre of its footprint, on its storey's floor (cm); none without geometry.
    pub fn top(&self) -> Option<[f32; 3]> {
        let [min, max] = self.bounds;
        (min != max).then(|| [(min[0] + max[0]) * 0.5, max[1], (min[2] + max[2]) * 0.5])
    }
}

/// Live changes to the moving parts of the scene, by element index.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Overrides {
    /// Doors, windows and curtains: opening, 0 (closed) to 1 (open).
    pub open: BTreeMap<usize, f64>,
    /// Windows with a blind: 0 (blind down) to 1 (blind up).
    pub blind: BTreeMap<usize, f64>,
}

/// One storey of the scene (D-028): its meshes and outlines, built on its floor (height 0) and
/// drawn at its height.
#[derive(Debug, Clone)]
pub struct StoreyPart {
    /// Height of its floor (cm).
    pub elevation: f64,
    /// Its elements: `first..first + count` in the scene's elements.
    pub first: usize,
    pub count: usize,
    /// Opaque geometry that never moves, but the walls.
    pub opaque: Mesh,
    /// The walls of the rooms and the free partitions, their tops, trims and corners: opaque, or
    /// glass in the looks with glass walls (D-027).
    pub wall_mesh: Mesh,
    /// Glass and contact shadows that never move, drawn after the opaque geometry.
    pub transparent: Mesh,
    /// The moving parts (doors, windows, curtains, blinds, and the pieces moved in edit mode),
    /// rebuilt by [`build_dynamic`].
    pub dynamic_opaque: Mesh,
    /// Glass of the moving parts.
    pub dynamic_transparent: Mesh,
    /// The ceilings of the rooms, at the walls' height: they only cast shadows, so that the real
    /// sun (D-023) comes in through the windows.
    pub ceiling: Mesh,
    /// The outlines of the storey: wall tops and corners, door and window frames, floor outlines
    /// (drawn by the line looks, D-027).
    pub lines: Vec<lines::Line>,
    /// Bounding box of its geometry, its floor at 0.
    pub bounds: [[f32; 3]; 2],
    /// Its plan when the scene holds several storeys (one alone is the plan the scene is shown
    /// with), its walls, and what [`build_dynamic`] needs to rebuild its moving parts.
    plan: Option<Plan>,
    layout: WallLayout,
    context: Builder,
}

/// The roof over the top storey (D-028), at the height of its walls' tops.
#[derive(Debug, Clone)]
pub struct Roof {
    /// Height of the floor of the storey it covers (cm): its mesh and lines stand on that floor
    /// like the storey's, their eaves at the walls' height, and are lifted like it.
    pub elevation: f64,
    /// The storey it covers.
    pub storey: usize,
    /// Its slopes and gables.
    pub mesh: Mesh,
    /// Its eaves, ridge and gable edges.
    pub lines: Vec<lines::Line>,
    /// Its shape, for what falls on it (D-068).
    pub shape: RoofShape,
}

/// The shape of a gable roof on the plan, its eaves included: what falls on it stops on its slopes
/// and runs off its eaves (D-068).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoofShape {
    /// Its centre on the plan (cm).
    pub centre: [f64; 2],
    /// The unit direction of its ridge on the plan; its slopes fall at right angles to it.
    pub ridge: [f64; 2],
    /// Half its length along the ridge, and half its width across it (cm).
    pub half_length: f64,
    pub half_width: f64,
    /// The height of its eaves above the floor of the storey it covers, and of its ridge above
    /// its eaves (cm).
    pub eaves: f64,
    pub rise: f64,
}

impl RoofShape {
    /// The height of the roof above the floor of the storey it covers at a point of the plan, or
    /// `None` outside it: the formula the weather's shader lands rain on the roof with (D-068),
    /// checked against the roof's mesh.
    #[cfg(test)]
    pub fn height_at(&self, point: [f64; 2]) -> Option<f64> {
        let d = [point[0] - self.centre[0], point[1] - self.centre[1]];
        let along = d[0] * self.ridge[0] + d[1] * self.ridge[1];
        let across = -d[0] * self.ridge[1] + d[1] * self.ridge[0];
        if along.abs() > self.half_length || across.abs() > self.half_width {
            return None;
        }
        Some(self.eaves + self.rise * (1.0 - across.abs() / self.half_width))
    }
}

/// The built scene.
#[derive(Debug, Clone)]
pub struct Scene {
    /// Its storeys, lowest first (one for a plan alone).
    pub parts: Vec<StoreyPart>,
    /// The roof over the top storey, for the home seen whole (several storeys).
    pub roof: Option<Roof>,
    /// Element id of each room slot (slot `k` is `rooms[k - 1]`).
    pub rooms: Vec<String>,
    /// Where each room's label goes, well inside it (plan x, y), by room slot like `rooms`.
    pub labels: Vec<P2>,
    /// Wall groups, indexed by the vertex group.
    pub groups: Vec<WallGroup>,
    /// One entry per element, in plan order (vertex element tag − 1).
    pub elements: Vec<ElementInfo>,
    /// Lamps.
    pub lights: Vec<LightSpot>,
    /// Wall height (cm).
    pub wall_height: f64,
    /// Bounding box of the whole scene, each storey at its height.
    pub bounds: [[f32; 3]; 2],
    /// Pieces drawn as boxes because their 3D files would pass [`MAX_FILE_TRIANGLES`].
    pub models_over_budget: usize,
    /// The rooms drawn closed (D-039), by element id: nothing in them, no way in.
    pub closed: BTreeSet<String>,
}

/// Scene options.
#[derive(Debug, Clone, PartialEq)]
pub struct SceneOptions {
    /// Wall height (cm).
    pub wall_height: f64,
    /// The meshes of the 3D files loaded so far; pieces whose file is not among them are boxes.
    pub models: Rc<ModelMeshes>,
    /// Rooms to draw closed (private rooms the viewer may not see, D-039), by element id: their
    /// pieces are left out, and nobody walks in.
    pub closed_rooms: BTreeSet<String>,
}

impl Default for SceneOptions {
    fn default() -> Self {
        Self {
            wall_height: WALL_HEIGHT,
            models: Rc::default(),
            closed_rooms: BTreeSet::new(),
        }
    }
}

/// Shared state while building.
#[derive(Debug, Clone, Default)]
pub(crate) struct Builder {
    pub(crate) opaque: Mesh,
    pub(crate) wall_mesh: Mesh,
    pub(crate) transparent: Mesh,
    pub(crate) groups: Vec<WallGroup>,
    keys: BTreeMap<(bool, i32), u8>,
    /// Wall group of the side each opening lies on.
    pub(crate) opening_groups: BTreeMap<String, u8>,
    pub(crate) lights: Vec<LightSpot>,
    pub(crate) wall_height: f64,
    /// Room slot of each room element index.
    room_slots: BTreeMap<usize, u8>,
    /// Room polygons with their slot, to find the room of a point.
    room_shapes: Vec<(u8, Vec<P2>)>,
    /// Building the moving parts (doors, windows, curtains) rather than the rest.
    pub(crate) dynamic: bool,
    /// Live changes to the moving parts.
    pub(crate) overrides: Overrides,
    /// Pieces of furniture built with the moving parts (being moved in edit mode).
    pub(crate) moving: BTreeSet<usize>,
    /// The meshes of 3D files.
    pub(crate) models: Rc<ModelMeshes>,
    /// The outlines of the home.
    pub(crate) lines: lines::Lines,
    /// Pieces whose 3D file is past [`MAX_FILE_TRIANGLES`]: boxes.
    pub(crate) boxed: BTreeSet<usize>,
    /// The storey being built, and the index of its first element among the home's.
    pub(crate) storey: usize,
    pub(crate) base: usize,
    /// The slots of the rooms drawn closed (D-039): their pieces are left out.
    pub(crate) closed: BTreeSet<u8>,
    /// The room slot on the other side of each door and window, by the home's element index.
    pub(crate) beside: BTreeMap<usize, u8>,
}

impl Builder {
    /// The room slot of the room element `index` (0 when it is not a room or past 254 rooms).
    pub(crate) fn room_slot(&self, index: usize) -> u8 {
        self.room_slots.get(&index).copied().unwrap_or(0)
    }

    /// The slot of the room containing a plan point (0 when none).
    pub(crate) fn room_at(&self, p: P2) -> u8 {
        self.room_shapes
            .iter()
            .find(|(_, points)| point_in_polygon(p, points, false))
            .map_or(0, |(slot, _)| *slot)
    }

    /// The slot of the room an element follows (`parent`), else of the room containing `p`.
    pub(crate) fn room_for(&self, plan: &Plan, parent: &str, p: P2) -> u8 {
        plan.elements
            .iter()
            .position(|e| matches!(e, Element::Room(r) if r.id == parent))
            .map(|i| self.room_slot(i))
            .filter(|slot| *slot != 0)
            .unwrap_or_else(|| self.room_at(p))
    }

    /// The home's index of the storey's element `index`.
    pub(crate) fn global(&self, index: usize) -> usize {
        self.base + index
    }

    /// The vertex tag of the storey's element `index`.
    pub(crate) fn element_tag(&self, index: usize) -> u16 {
        u16::try_from(self.global(index) + 1).unwrap_or(0)
    }

    /// The group of walls facing `normal` (10° steps).
    #[allow(clippy::cast_possible_truncation)]
    pub(crate) fn group(&mut self, normal: [f64; 2], inner: bool) -> u8 {
        let angle = (normal[1].atan2(normal[0]).to_degrees() / 10.0).round() as i32 * 10;
        let angle = if angle <= -180 { angle + 360 } else { angle };
        if let Some(group) = self.keys.get(&(inner, angle)) {
            return *group;
        }
        let (s, c) = f64::from(angle).to_radians().sin_cos();
        self.push_group(WallGroup {
            normal: [c, s],
            inner,
        })
        .inspect(|group| {
            self.keys.insert((inner, angle), *group);
        })
        .unwrap_or_else(|| self.nearest(normal, inner))
    }

    /// A group of its own (free partitions), or the nearest one when there are too many.
    pub(crate) fn own_group(&mut self, normal: [f64; 2]) -> u8 {
        self.push_group(WallGroup {
            normal,
            inner: true,
        })
        .unwrap_or_else(|| self.nearest(normal, true))
    }

    fn push_group(&mut self, group: WallGroup) -> Option<u8> {
        if self.groups.len() >= MAX_GROUPS {
            return None;
        }
        let index = u8::try_from(self.groups.len()).ok()?;
        self.groups.push(group);
        Some(index)
    }

    fn nearest(&self, normal: [f64; 2], inner: bool) -> u8 {
        self.groups
            .iter()
            .enumerate()
            .filter(|(_, g)| g.inner == inner)
            .max_by(|(_, a), (_, b)| {
                let dot = |g: &WallGroup| g.normal[0] * normal[0] + g.normal[1] * normal[1];
                dot(a).total_cmp(&dot(b))
            })
            .and_then(|(i, _)| u8::try_from(i).ok())
            .unwrap_or(NO_GROUP)
    }
}

/// Builds the scene of a plan, the moving parts as the plan has them.
pub fn build_scene(plan: &Plan, options: &SceneOptions) -> Scene {
    build_scene_moving(plan, options, &BTreeSet::new())
}

/// Builds the scene of a plan with the pieces of furniture `moving` (element indices) among the
/// moving parts, so that [`build_dynamic`] rebuilds them alone while they are dragged.
pub fn build_scene_moving(plan: &Plan, options: &SceneOptions, moving: &BTreeSet<usize>) -> Scene {
    build(&[(plan, 0.0)], options, moving, false)
}

/// Builds the scene of every storey of a home (D-028): each storey's plan (its overlay applied)
/// with the height of its floor (cm), lowest first; the roof over the top one.
pub fn build_home(storeys: &[(&Plan, f64)], options: &SceneOptions) -> Scene {
    build(storeys, options, &BTreeSet::new(), true)
}

/// The plan of every storey at once, for what the scene of a home ([`build_home`]) refers to by
/// element index: the storeys' elements one after the other, the rest from the first storey's
/// (`None` without storeys).
pub fn stack_plans(plans: &[&Plan]) -> Option<Plan> {
    let mut stacked = (*plans.first()?).clone();
    for plan in plans.iter().skip(1) {
        stacked.elements.extend(plan.elements.iter().cloned());
        for (id, model) in &plan.models {
            stacked
                .models
                .entry(id.clone())
                .or_insert_with(|| model.clone());
        }
    }
    Some(stacked)
}

fn build(
    storeys: &[(&Plan, f64)],
    options: &SceneOptions,
    moving: &BTreeSet<usize>,
    home: bool,
) -> Scene {
    let wall_height = if options.wall_height.is_finite() {
        options.wall_height.clamp(150.0, 400.0)
    } else {
        WALL_HEIGHT
    };
    let mut builder = Builder {
        wall_height,
        moving: moving.clone(),
        models: Rc::clone(&options.models),
        ..Builder::default()
    };
    let mut drawn = 0;
    let mut rooms = Vec::new();
    let mut labels = Vec::new();
    let mut infos = Vec::new();
    let mut parts = Vec::new();
    let mut lights = Vec::new();
    for (storey, (plan, elevation)) in storeys.iter().enumerate() {
        let layout = WallLayout::new(plan);
        builder.storey = storey;
        builder.base = infos.len();
        builder.boxed = over_budget(plan, &options.models, &mut drawn);
        builder.room_slots.clear();
        builder.room_shapes.clear();
        for walls in &layout.rooms {
            let Some(Element::Room(room)) = plan.elements.get(walls.element) else {
                continue;
            };
            let Ok(slot) = u8::try_from(rooms.len() + 1) else {
                break;
            };
            if slot == u8::MAX {
                break;
            }
            rooms.push(room.id.clone());
            labels.push(label_point(&walls.points));
            if options.closed_rooms.contains(&room.id) {
                builder.closed.insert(slot);
            }
            builder.room_slots.insert(walls.element, slot);
            builder.room_shapes.push((slot, walls.points.clone()));
        }
        builder.dynamic = false;
        structure::build(&mut builder, plan, &layout);
        let outlines = std::mem::take(&mut builder.lines.list);
        furniture::build(&mut builder, plan, &layout);
        // The moving parts go to their own meshes, rebuilt alone when they move.
        let opaque = std::mem::take(&mut builder.opaque);
        let wall_mesh = std::mem::take(&mut builder.wall_mesh);
        let transparent = std::mem::take(&mut builder.transparent);
        builder.dynamic = true;
        openings::build(&mut builder, plan, &layout);
        furniture::build(&mut builder, plan, &layout);
        let dynamic_opaque = std::mem::take(&mut builder.opaque);
        let dynamic_transparent = std::mem::take(&mut builder.transparent);
        let meshes = [
            &opaque,
            &wall_mesh,
            &transparent,
            &dynamic_opaque,
            &dynamic_transparent,
        ];
        let mut storey_infos = element_infos(plan, &meshes, builder.base, storey);
        // Pieces left out (in a room drawn closed, D-039) keep the room they are in; doors and
        // windows tell the room on their other side.
        for (i, (info, element)) in storey_infos.iter_mut().zip(&plan.elements).enumerate() {
            if info.room == 0
                && let Element::Furniture(f) = element
            {
                info.room = builder.room_for(plan, &f.parent, f.center());
            }
            info.beside = builder.beside.get(&builder.global(i)).copied().unwrap_or(0);
        }
        infos.extend(storey_infos);
        let bounds = meshes.iter().map(|m| m.bounds()).fold([[0.0; 3]; 2], union);
        lights.append(&mut builder.lights);
        let mut ceiling = Mesh::default();
        {
            let mut painter = mesh::Painter::new(
                &mut ceiling,
                mesh::Material::new(
                    crate::plan::Rgb8::from_u32(0xf4_f2_ee),
                    0.95,
                    mesh::Surface::Ceiling,
                ),
                mesh::Tag::default(),
            );
            for walls in &layout.rooms {
                // Lit by its room's lamps.
                painter.tag = mesh::Tag {
                    room: builder.room_slot(walls.element),
                    ..mesh::Tag::default()
                };
                painter.polygon(&walls.points, wall_height, false, 0.0);
            }
        }
        builder.dynamic = false;
        parts.push(StoreyPart {
            elevation: if elevation.is_finite() {
                *elevation
            } else {
                0.0
            },
            first: builder.base,
            count: plan.elements.len(),
            opaque,
            wall_mesh,
            transparent,
            dynamic_opaque,
            dynamic_transparent,
            ceiling,
            lines: outlines,
            bounds,
            plan: (storeys.len() > 1).then(|| (*plan).clone()),
            layout,
            context: builder.clone(),
        });
    }
    let models_over_budget = parts.iter().map(|p| p.context.boxed.len()).sum();
    let roof = if home {
        roof::build(&parts, wall_height)
    } else {
        None
    };
    let mut bounds = [[0.0; 3]; 2];
    for part in &parts {
        #[allow(clippy::cast_possible_truncation)]
        let lift = part.elevation as f32;
        let [min, max] = part.bounds;
        if min != max {
            let raised = [
                [min[0], min[1] + lift, min[2]],
                [max[0], max[1] + lift, max[2]],
            ];
            bounds = union(bounds, raised);
        }
    }
    let closed = rooms
        .iter()
        .filter(|id| options.closed_rooms.contains(*id))
        .cloned()
        .collect();
    Scene {
        parts,
        roof,
        rooms,
        labels,
        groups: builder.groups.clone(),
        elements: infos,
        lights,
        wall_height,
        bounds,
        models_over_budget,
        closed,
    }
}

/// The pieces whose 3D file would pass [`MAX_FILE_TRIANGLES`] (with the `drawn` triangles of the
/// storeys before), in plan order.
fn over_budget(plan: &Plan, meshes: &ModelMeshes, drawn: &mut usize) -> BTreeSet<usize> {
    let mut boxed = BTreeSet::new();
    for (index, element) in plan.elements.iter().enumerate() {
        let Element::Furniture(f) = element else {
            continue;
        };
        if f.model.is_none() {
            continue;
        }
        let triangles = f
            .model
            .as_ref()
            .and_then(|id| plan.models.get(id))
            .and_then(imported::file_hash)
            .and_then(|hash| meshes.get(hash))
            .map_or(0, |mesh| mesh.triangle_count());
        if *drawn + triangles > MAX_FILE_TRIANGLES {
            boxed.insert(index);
        } else {
            *drawn += triangles;
        }
    }
    boxed
}

/// The moving parts of one storey: opaque and glass.
pub type MovingParts = (Mesh, Mesh);

/// Rebuilds the moving parts of a scene (doors, windows, curtains, blinds) with live changes,
/// storey by storey. `plan` is the plan the scene is shown with: for a storey alone, its current
/// version (edit mode moves pieces without building the scene again).
pub fn build_dynamic(plan: &Plan, scene: &Scene, overrides: &Overrides) -> Vec<MovingParts> {
    build_dynamic_lit(plan, scene, overrides).0
}

/// [`build_dynamic`], with the lamps of the moving parts where they are now (pieces dragged in
/// edit mode carry theirs).
pub fn build_dynamic_lit(
    plan: &Plan,
    scene: &Scene,
    overrides: &Overrides,
) -> (Vec<MovingParts>, Vec<LightSpot>) {
    let mut meshes = Vec::with_capacity(scene.parts.len());
    let mut lights = Vec::new();
    for part in &scene.parts {
        let mut builder = part.context.clone();
        builder.overrides = overrides.clone();
        builder.lights.clear();
        builder.dynamic = true;
        let plan = part.plan.as_ref().unwrap_or(plan);
        openings::build(&mut builder, plan, &part.layout);
        furniture::build(&mut builder, plan, &part.layout);
        meshes.push((builder.opaque, builder.transparent));
        lights.append(&mut builder.lights);
    }
    (meshes, lights)
}

impl Scene {
    /// The pieces built with the moving parts (element indices).
    pub fn moving(&self) -> &BTreeSet<usize> {
        static NONE: BTreeSet<usize> = BTreeSet::new();
        self.parts.first().map_or(&NONE, |p| &p.context.moving)
    }

    /// The walls of the first storey (edit mode works on a storey alone).
    pub fn walls(&self) -> &WallLayout {
        static NONE: std::sync::OnceLock<WallLayout> = std::sync::OnceLock::new();
        self.parts
            .first()
            .map_or_else(|| NONE.get_or_init(WallLayout::default), |p| &p.layout)
    }

    /// The walls of every storey with the index of its first element.
    pub fn storey_walls(&self) -> impl Iterator<Item = (usize, &WallLayout)> {
        self.parts.iter().map(|p| (p.first, &p.layout))
    }

    /// The storey (part) element `index` is on.
    pub fn storey_of(&self, index: usize) -> Option<usize> {
        self.parts
            .iter()
            .position(|p| index >= p.first && index < p.first + p.count)
    }

    /// The triangles of every mesh.
    pub fn triangle_count(&self) -> usize {
        self.parts
            .iter()
            .flat_map(|p| {
                [
                    &p.opaque,
                    &p.wall_mesh,
                    &p.transparent,
                    &p.dynamic_opaque,
                    &p.dynamic_transparent,
                ]
            })
            .chain(self.roof.as_ref().map(|r| &r.mesh))
            .map(Mesh::triangle_count)
            .sum()
    }

    /// Where a walker can go on the storey shown alone (D-029), `plan` being its plan; `None` for
    /// a home of several storeys.
    pub fn walk_floor(&self, plan: &Plan) -> Option<crate::walk::Floor> {
        match self.parts.as_slice() {
            [part] => {
                let mut floor =
                    crate::walk::Floor::new(part.plan.as_ref().unwrap_or(plan), &part.layout);
                floor.close(&self.closed);
                Some(floor)
            }
            _ => None,
        }
    }

    /// The plan of each storey shown, by index: `plan` for a scene of one.
    pub fn storey_plans<'a>(&'a self, plan: &'a Plan) -> Vec<&'a Plan> {
        self.parts
            .iter()
            .map(|part| part.plan.as_ref().unwrap_or(plan))
            .collect()
    }

    /// Where a walker can go on each storey of the scene (by index), `plan` being the plan of a
    /// scene of one storey: where people stand and walk (D-034).
    pub fn walk_floors(&self, plan: &Plan) -> Vec<crate::walk::Floor> {
        self.parts
            .iter()
            .map(|part| {
                let mut floor =
                    crate::walk::Floor::new(part.plan.as_ref().unwrap_or(plan), &part.layout);
                floor.close(&self.closed);
                floor
            })
            .collect()
    }

    /// Frees the meshes once they are on the GPU (what rebuilding the moving parts needs stays).
    pub fn drop_meshes(&mut self) {
        for part in &mut self.parts {
            for mesh in [
                &mut part.opaque,
                &mut part.wall_mesh,
                &mut part.transparent,
                &mut part.dynamic_opaque,
                &mut part.dynamic_transparent,
                &mut part.ceiling,
            ] {
                *mesh = Mesh::default();
            }
        }
        if let Some(roof) = self.roof.as_mut() {
            roof.mesh = Mesh::default();
        }
    }
}

fn union(a: [[f32; 3]; 2], b: [[f32; 3]; 2]) -> [[f32; 3]; 2] {
    let empty = |m: &[[f32; 3]; 2]| m[0] == m[1];
    if empty(&a) {
        return b;
    }
    if empty(&b) {
        return a;
    }
    [
        [
            a[0][0].min(b[0][0]),
            a[0][1].min(b[0][1]),
            a[0][2].min(b[0][2]),
        ],
        [
            a[1][0].max(b[1][0]),
            a[1][1].max(b[1][1]),
            a[1][2].max(b[1][2]),
        ],
    ]
}

/// What the scene knows of each element of a storey, the storey's elements starting at `base`.
fn element_infos(plan: &Plan, meshes: &[&Mesh], base: usize, storey: usize) -> Vec<ElementInfo> {
    let n = plan.elements.len();
    let mut min = vec![[f32::INFINITY; 3]; n];
    let mut max = vec![[f32::NEG_INFINITY; 3]; n];
    let mut room = vec![0_u8; n];
    for mesh in meshes {
        for ((p, e), normal) in mesh.positions.iter().zip(&mesh.extras).zip(&mesh.normals) {
            let tag = usize::from(u16::from_le_bytes([e[2], e[3]]));
            // Contact shadows carry no element.
            let Some(i) = tag.checked_sub(1 + base).filter(|i| *i < n) else {
                continue;
            };
            for k in 0..3 {
                min[i][k] = min[i][k].min(p[k]);
                max[i][k] = max[i][k].max(p[k]);
            }
            room[i] = u8::from_ne_bytes(normal[3].to_ne_bytes());
        }
    }
    plan.elements
        .iter()
        .enumerate()
        .map(|(i, e)| ElementInfo {
            id: e.id().to_owned(),
            kind: e.type_name(),
            bounds: if min[i][0].is_finite() {
                [min[i], max[i]]
            } else {
                [[0.0; 3]; 2]
            },
            room: room[i],
            beside: 0,
            storey,
        })
        .collect()
}

/// The element of a plan an element tag designates.
pub fn tagged_element(plan: &Plan, tag: u16) -> Option<&Element> {
    usize::from(tag)
        .checked_sub(1)
        .and_then(|i| plan.elements.get(i))
}
