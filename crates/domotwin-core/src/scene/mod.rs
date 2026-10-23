//! The 3D scene of a plan, as renderer-agnostic meshes: floors and walls, doors and windows,
//! furniture and user models. Two meshes cover everything (opaque, and glass with the contact
//! shadows), so the renderer draws the whole home in a few calls.
//!
//! Walls belong to **groups** by direction (10° steps, interior and façade apart; each free
//! partition its own): the renderer cuts away the groups facing the camera by lowering them to
//! [`CUT_HEIGHT`](crate::geometry::heights::CUT_HEIGHT), in the vertex shader.

pub mod mesh;

mod furniture;
mod kit;
mod openings;
mod structure;

use std::collections::BTreeMap;

use crate::geometry::heights::WALL_HEIGHT;
use crate::geometry::walls::WallLayout;
use crate::plan::{Element, Plan};
use mesh::{Mesh, NO_GROUP};

/// Most wall groups a scene has (the shader keeps one cut height per group).
pub const MAX_GROUPS: usize = 128;

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
}

/// The built scene.
#[derive(Debug, Clone, PartialEq)]
pub struct Scene {
    /// Opaque geometry.
    pub opaque: Mesh,
    /// Glass and contact shadows, drawn after the opaque geometry.
    pub transparent: Mesh,
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
}

/// Scene options.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SceneOptions {
    /// Wall height (cm).
    pub wall_height: f64,
}

impl Default for SceneOptions {
    fn default() -> Self {
        Self {
            wall_height: WALL_HEIGHT,
        }
    }
}

/// Shared state while building.
#[derive(Debug)]
pub(crate) struct Builder {
    pub(crate) opaque: Mesh,
    pub(crate) transparent: Mesh,
    pub(crate) groups: Vec<WallGroup>,
    keys: BTreeMap<(bool, i32), u8>,
    /// Wall group of the side each opening lies on.
    pub(crate) opening_groups: BTreeMap<String, u8>,
    pub(crate) lights: Vec<LightSpot>,
    pub(crate) wall_height: f64,
}

impl Builder {
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

/// Builds the scene of a plan.
pub fn build_scene(plan: &Plan, options: &SceneOptions) -> Scene {
    let layout = WallLayout::new(plan);
    let wall_height = if options.wall_height.is_finite() {
        options.wall_height.clamp(150.0, 400.0)
    } else {
        WALL_HEIGHT
    };
    let mut builder = Builder {
        opaque: Mesh::default(),
        transparent: Mesh::default(),
        groups: Vec::new(),
        keys: BTreeMap::new(),
        opening_groups: BTreeMap::new(),
        lights: Vec::new(),
        wall_height,
    };
    structure::build(&mut builder, plan, &layout);
    openings::build(&mut builder, plan, &layout);
    furniture::build(&mut builder, plan, &layout);
    let elements = element_infos(plan, &builder.opaque, &builder.transparent);
    let bounds = union(builder.opaque.bounds(), builder.transparent.bounds());
    Scene {
        opaque: builder.opaque,
        transparent: builder.transparent,
        groups: builder.groups,
        elements,
        lights: builder.lights,
        wall_height,
        bounds,
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

fn element_infos(plan: &Plan, opaque: &Mesh, transparent: &Mesh) -> Vec<ElementInfo> {
    let n = plan.elements.len();
    let mut min = vec![[f32::INFINITY; 3]; n];
    let mut max = vec![[f32::NEG_INFINITY; 3]; n];
    for mesh in [opaque, transparent] {
        for (p, e) in mesh.positions.iter().zip(&mesh.extras) {
            let tag = usize::from(u16::from_le_bytes([e[2], e[3]]));
            // Contact shadows carry no element.
            let Some(i) = tag.checked_sub(1).filter(|i| *i < n) else {
                continue;
            };
            for k in 0..3 {
                min[i][k] = min[i][k].min(p[k]);
                max[i][k] = max[i][k].max(p[k]);
            }
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
        })
        .collect()
}

/// The element of a plan an element tag designates.
pub fn tagged_element(plan: &Plan, tag: u16) -> Option<&Element> {
    usize::from(tag)
        .checked_sub(1)
        .and_then(|i| plan.elements.get(i))
}
