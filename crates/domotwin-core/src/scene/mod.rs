//! The 3D scene of a plan, as renderer-agnostic meshes: floors and walls, doors and windows,
//! furniture and user models. A few meshes cover everything (opaque, the walls, and glass with the
//! contact shadows), so the renderer draws the whole home in a few calls.
//!
//! Walls belong to **groups** by direction (10° steps, interior and façade apart; each free
//! partition its own): the renderer cuts away the groups facing the camera by lowering them to
//! [`CUT_HEIGHT`](crate::geometry::heights::CUT_HEIGHT), in the vertex shader.

pub mod lines;
pub mod mesh;

mod furniture;
mod imported;
mod kit;
mod openings;
mod structure;

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use crate::geometry::heights::WALL_HEIGHT;
use crate::geometry::polygon::{P2, label_point, point_in_polygon};
use crate::geometry::walls::WallLayout;
use crate::model_mesh::ModelMesh;
use crate::plan::{Element, Kind, Plan};
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
    /// World bounding box `[min, max]` of its geometry (zeros when it has none).
    pub bounds: [[f32; 3]; 2],
    /// Room slot it belongs to (0: none).
    pub room: u8,
}

/// Live changes to the moving parts of the scene, by element index.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Overrides {
    /// Doors, windows and curtains: opening, 0 (closed) to 1 (open).
    pub open: BTreeMap<usize, f64>,
    /// Windows with a blind: 0 (blind down) to 1 (blind up).
    pub blind: BTreeMap<usize, f64>,
}

/// The built scene.
#[derive(Debug, Clone)]
pub struct Scene {
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
    /// The outlines of the home: wall tops and corners, door and window frames, floor outlines
    /// (drawn by the line looks, D-027).
    pub lines: Vec<lines::Line>,
    /// Element id of each room slot (slot `k` is `rooms[k - 1]`).
    pub rooms: Vec<String>,
    /// Where each room's label goes, well inside it (plan x, y), by room slot like `rooms`.
    pub labels: Vec<P2>,
    /// Wall groups, indexed by the vertex group.
    pub groups: Vec<WallGroup>,
    /// One entry per plan element, in plan order (vertex element tag − 1).
    pub elements: Vec<ElementInfo>,
    /// Lamps.
    pub lights: Vec<LightSpot>,
    /// Wall height (cm).
    pub wall_height: f64,
    /// World bounding box of the whole scene.
    pub bounds: [[f32; 3]; 2],
    /// Pieces drawn as boxes because their 3D files would pass [`MAX_FILE_TRIANGLES`].
    pub models_over_budget: usize,
    /// What [`build_dynamic`] needs to rebuild the moving parts the same way.
    context: Builder,
    layout: WallLayout,
}

/// Scene options.
#[derive(Debug, Clone, PartialEq)]
pub struct SceneOptions {
    /// Wall height (cm).
    pub wall_height: f64,
    /// The meshes of the 3D files loaded so far; pieces whose file is not among them are boxes.
    pub models: Rc<ModelMeshes>,
}

impl Default for SceneOptions {
    fn default() -> Self {
        Self {
            wall_height: WALL_HEIGHT,
            models: Rc::default(),
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

    /// The vertex tag of element `index`.
    pub(crate) fn element_tag(&self, index: usize) -> u16 {
        u16::try_from(index + 1).unwrap_or(0)
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
    let layout = WallLayout::new(plan);
    let wall_height = if options.wall_height.is_finite() {
        options.wall_height.clamp(150.0, 400.0)
    } else {
        WALL_HEIGHT
    };
    let mut builder = Builder {
        wall_height,
        moving: moving.clone(),
        models: Rc::clone(&options.models),
        boxed: over_budget(plan, &options.models),
        ..Builder::default()
    };
    let mut rooms = Vec::new();
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
        builder.room_slots.insert(walls.element, slot);
        builder.room_shapes.push((slot, walls.points.clone()));
    }
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
    let elements = element_infos(plan, &meshes);
    let bounds = meshes.iter().map(|m| m.bounds()).fold([[0.0; 3]; 2], union);
    let lights = std::mem::take(&mut builder.lights);
    let models_over_budget = builder.boxed.len();
    let labels = builder
        .room_shapes
        .iter()
        .map(|(_, points)| label_point(points))
        .collect();
    let mut ceiling = Mesh::default();
    {
        let mut painter = mesh::Painter::new(
            &mut ceiling,
            mesh::Material::paint(crate::plan::Rgb8::from_u32(0xff_ff_ff)),
            mesh::Tag::default(),
        );
        for walls in &layout.rooms {
            painter.polygon(&walls.points, wall_height, false, 0.0);
        }
    }
    Scene {
        opaque,
        wall_mesh,
        transparent,
        dynamic_opaque,
        dynamic_transparent,
        ceiling,
        lines: outlines,
        rooms,
        labels,
        groups: builder.groups.clone(),
        elements,
        lights,
        wall_height,
        bounds,
        models_over_budget,
        context: builder,
        layout,
    }
}

/// The pieces whose 3D file would pass [`MAX_FILE_TRIANGLES`], in plan order.
fn over_budget(plan: &Plan, meshes: &ModelMeshes) -> BTreeSet<usize> {
    let mut drawn = 0_usize;
    let mut boxed = BTreeSet::new();
    for (index, element) in plan.elements.iter().enumerate() {
        let Element::Furniture(f) = element else {
            continue;
        };
        if f.kind != Kind::Custom {
            continue;
        }
        let triangles = f
            .model
            .as_ref()
            .and_then(|id| plan.models.get(id))
            .and_then(imported::file_hash)
            .and_then(|hash| meshes.get(hash))
            .map_or(0, |mesh| mesh.triangle_count());
        if drawn + triangles > MAX_FILE_TRIANGLES {
            boxed.insert(index);
        } else {
            drawn += triangles;
        }
    }
    boxed
}

/// Rebuilds the moving parts of a scene (doors, windows, curtains, blinds) with live changes.
/// Returns the opaque and the transparent meshes.
pub fn build_dynamic(plan: &Plan, scene: &Scene, overrides: &Overrides) -> (Mesh, Mesh) {
    let (opaque, transparent, _) = build_dynamic_lit(plan, scene, overrides);
    (opaque, transparent)
}

/// [`build_dynamic`], with the lamps of the moving parts where they are now (pieces dragged in
/// edit mode carry theirs).
pub fn build_dynamic_lit(
    plan: &Plan,
    scene: &Scene,
    overrides: &Overrides,
) -> (Mesh, Mesh, Vec<LightSpot>) {
    let mut builder = scene.context.clone();
    builder.overrides = overrides.clone();
    builder.lights.clear();
    openings::build(&mut builder, plan, &scene.layout);
    furniture::build(&mut builder, plan, &scene.layout);
    (builder.opaque, builder.transparent, builder.lights)
}

impl Scene {
    /// The pieces built with the moving parts (element indices).
    pub fn moving(&self) -> &BTreeSet<usize> {
        &self.context.moving
    }

    /// The walls of the plan (faces and blocks for edit mode).
    pub fn walls(&self) -> &WallLayout {
        &self.layout
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

fn element_infos(plan: &Plan, meshes: &[&Mesh]) -> Vec<ElementInfo> {
    let n = plan.elements.len();
    let mut min = vec![[f32::INFINITY; 3]; n];
    let mut max = vec![[f32::NEG_INFINITY; 3]; n];
    let mut room = vec![0_u8; n];
    for mesh in meshes {
        for ((p, e), normal) in mesh.positions.iter().zip(&mesh.extras).zip(&mesh.normals) {
            let tag = usize::from(u16::from_le_bytes([e[2], e[3]]));
            // Contact shadows carry no element.
            let Some(i) = tag.checked_sub(1).filter(|i| *i < n) else {
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
        })
        .collect()
}

/// The element of a plan an element tag designates.
pub fn tagged_element(plan: &Plan, tag: u16) -> Option<&Element> {
    usize::from(tag)
        .checked_sub(1)
        .and_then(|i| plan.elements.get(i))
}
