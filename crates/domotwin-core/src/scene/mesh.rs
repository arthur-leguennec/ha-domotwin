//! Renderer-agnostic triangle meshes: packed vertex attributes ready for a GPU upload, and the
//! primitives the scene is made of (quads, boxes, cylinders, spheres, extruded polygons).
//!
//! World axes: `x` = plan x, `y` = height, `z` = plan y, all in cm.

use crate::plan::Rgb8;

/// How a surface is shaded. Stored in the vertex (6 bits).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Surface {
    /// Matte paint.
    Matte = 0,
    /// Floor planks, along the vertex `uv` (cm).
    Planks = 1,
    /// Floor tiles, 40 cm.
    Tiles = 2,
    /// Subway tiles on a wall face.
    Subway = 3,
    /// Glass (transparent pass).
    Glass = 4,
    /// A lamp's shade or bulb: shaded like paint when off, glowing with its element's light when
    /// on (the light comes from the live state, not from the mesh).
    Glow = 5,
    /// Metal.
    Metal = 6,
    /// Fabric.
    Fabric = 7,
    /// Mirror.
    Mirror = 8,
    /// Screens and dark gloss.
    Screen = 9,
    /// Soft contact shadow under furniture (transparent pass).
    Shadow = 10,
    /// Top of a wall (dark on the 2D plan).
    WallCap = 11,
    /// Plain floor.
    Floor = 12,
    /// Wood.
    Wood = 13,
    /// Leaves of plants.
    Leaf = 14,
    /// A room's ceiling, seen from below when walking (D-029): lit like the room, not by the sun.
    Ceiling = 15,
    /// A lawn (D-077): its grass as long as it has grown since it was mown, striped just after.
    Grass = 16,
    /// Gravel.
    Gravel = 17,
    /// Water (a pool, a hot tub).
    Water = 18,
    /// Bare soil (a bed, a vegetable patch).
    Soil = 19,
    /// Paving slabs, 60 cm.
    Paving = 20,
}

/// How a vertex reacts to the cut-away of its wall group. Stored in the vertex (2 bits).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum CutMode {
    /// Never cut.
    Keep = 0,
    /// Clamped to the cut height; pieces starting above it disappear.
    Clamp = 1,
    /// Hidden while its wall is cut (pictures, curtains, wall cabinets).
    Hide = 2,
}

/// A material: colour, roughness and surface.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Material {
    /// sRGB colour.
    pub color: Rgb8,
    /// Roughness 0–1.
    pub roughness: f32,
    /// Shading.
    pub surface: Surface,
}

impl Material {
    /// A material.
    pub const fn new(color: Rgb8, roughness: f32, surface: Surface) -> Self {
        Self {
            color,
            roughness,
            surface,
        }
    }
    /// Matte paint.
    pub const fn paint(color: Rgb8) -> Self {
        Self::new(color, 0.8, Surface::Matte)
    }
    /// Satin paint (furniture fronts, trims).
    pub const fn satin(color: Rgb8) -> Self {
        Self::new(color, 0.45, Surface::Matte)
    }
    /// Wood.
    pub const fn wood(color: Rgb8) -> Self {
        Self::new(color, 0.6, Surface::Wood)
    }
    /// Metal.
    pub const fn metal(color: Rgb8) -> Self {
        Self::new(color, 0.35, Surface::Metal)
    }
    /// Fabric.
    pub const fn fabric(color: Rgb8) -> Self {
        Self::new(color, 0.95, Surface::Fabric)
    }
    /// Ceramic and enamel.
    pub const fn ceramic(color: Rgb8) -> Self {
        Self::new(color, 0.15, Surface::Matte)
    }
    /// Glass.
    pub const fn glass() -> Self {
        Self::new(Rgb8::from_u32(0xcfe6ec), 0.05, Surface::Glass)
    }
    /// A part that glows when its lamp is on; `color` is its look when off.
    pub const fn glow(color: Rgb8) -> Self {
        Self::new(color, 0.6, Surface::Glow)
    }
}

/// Where the next vertices belong: element (for picking) and wall group (for the cut-away).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tag {
    /// Element index + 1 in `Plan::elements` (0: none).
    pub element: u16,
    /// Wall group, [`NO_GROUP`] when none.
    pub group: u8,
    /// Reaction to the cut-away.
    pub cut: CutMode,
    /// Room slot (1–254) whose lamps light the vertex; 0 for none.
    pub room: u8,
}

/// No wall group.
pub const NO_GROUP: u8 = 255;

impl Default for Tag {
    fn default() -> Self {
        Self {
            element: 0,
            group: NO_GROUP,
            cut: CutMode::Keep,
            room: 0,
        }
    }
}

/// A triangle mesh with packed attributes, laid out for the GPU.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Mesh {
    /// `x, y, z` and the base height of the piece the vertex belongs to (cut-away).
    pub positions: Vec<[f32; 4]>,
    /// Unit normal × 127, and the room slot (as a byte) in the last lane.
    pub normals: Vec<[i8; 4]>,
    /// sRGB colour and roughness × 255.
    pub colors: Vec<[u8; 4]>,
    /// Wall group, cut mode | surface << 2, element index + 1 (little endian).
    pub extras: Vec<[u8; 4]>,
    /// Pattern coordinates (cm) for floors and tiles.
    pub uvs: Vec<[f32; 2]>,
    /// Triangles.
    pub indices: Vec<u32>,
}

/// A point or vector in world space (cm).
pub type V3 = [f64; 3];

impl Mesh {
    /// Number of vertices.
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// Number of triangles.
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Appends a vertex; returns its index.
    #[allow(clippy::cast_possible_truncation, clippy::too_many_arguments)]
    pub fn vertex(
        &mut self,
        p: V3,
        base: f64,
        n: V3,
        uv: [f64; 2],
        material: &Material,
        tag: Tag,
    ) -> u32 {
        let index = u32::try_from(self.positions.len()).unwrap_or(u32::MAX);
        self.positions
            .push([p[0] as f32, p[1] as f32, p[2] as f32, base as f32]);
        let q = |c: f64| (c.clamp(-1.0, 1.0) * 127.0).round() as i8;
        let room = i8::from_ne_bytes([tag.room]);
        self.normals.push([q(n[0]), q(n[1]), q(n[2]), room]);
        let Rgb8 { r, g, b } = material.color;
        let rough = (material.roughness.clamp(0.0, 1.0) * 255.0).round() as u8;
        self.colors.push([r, g, b, rough]);
        let [lo, hi] = tag.element.to_le_bytes();
        self.extras.push([
            tag.group,
            (tag.cut as u8) | ((material.surface as u8) << 2),
            lo,
            hi,
        ]);
        self.uvs.push([uv[0] as f32, uv[1] as f32]);
        index
    }

    /// Appends a triangle.
    pub fn triangle(&mut self, a: u32, b: u32, c: u32) {
        self.indices.extend_from_slice(&[a, b, c]);
    }

    /// Appends another mesh.
    pub fn append(&mut self, other: &Mesh) {
        let offset = u32::try_from(self.positions.len()).unwrap_or(u32::MAX);
        self.positions.extend_from_slice(&other.positions);
        self.normals.extend_from_slice(&other.normals);
        self.colors.extend_from_slice(&other.colors);
        self.extras.extend_from_slice(&other.extras);
        self.uvs.extend_from_slice(&other.uvs);
        self.indices
            .extend(other.indices.iter().map(|i| i.saturating_add(offset)));
    }

    /// Bounding box `[min, max]` of the vertices (zeros when empty).
    pub fn bounds(&self) -> [[f32; 3]; 2] {
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for p in &self.positions {
            for k in 0..3 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        if min[0].is_finite() {
            [min, max]
        } else {
            [[0.0; 3]; 2]
        }
    }
}

/// A rigid transform: rotation (columns are the local axes in world space) and translation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Xform {
    /// Local x, y and z axes in world space.
    pub axes: [V3; 3],
    /// Origin in world space.
    pub origin: V3,
}

impl Xform {
    /// The identity.
    pub const IDENTITY: Xform = Xform {
        axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        origin: [0.0; 3],
    };

    /// A frame on the floor plan: origin `(x, height, plan y)`, local x along `u` (plan), local y
    /// up, local z = `u` turned +90° on the plan (towards plan +y for `u` = +x).
    pub fn plan(origin: V3, u: [f64; 2]) -> Self {
        Self {
            axes: [[u[0], 0.0, u[1]], [0.0, 1.0, 0.0], [-u[1], 0.0, u[0]]],
            origin,
        }
    }

    /// A point from local to world.
    pub fn point(&self, p: V3) -> V3 {
        let [x, y, z] = self.axes;
        [
            self.origin[0] + x[0] * p[0] + y[0] * p[1] + z[0] * p[2],
            self.origin[1] + x[1] * p[0] + y[1] * p[1] + z[1] * p[2],
            self.origin[2] + x[2] * p[0] + y[2] * p[1] + z[2] * p[2],
        ]
    }

    /// A direction from local to world.
    pub fn dir(&self, v: V3) -> V3 {
        let [x, y, z] = self.axes;
        [
            x[0] * v[0] + y[0] * v[1] + z[0] * v[2],
            x[1] * v[0] + y[1] * v[1] + z[1] * v[2],
            x[2] * v[0] + y[2] * v[1] + z[2] * v[2],
        ]
    }

    /// This transform followed by `inner` (a child frame expressed in this one).
    pub fn then(&self, inner: &Xform) -> Xform {
        Xform {
            axes: [
                self.dir(inner.axes[0]),
                self.dir(inner.axes[1]),
                self.dir(inner.axes[2]),
            ],
            origin: self.point(inner.origin),
        }
    }

    /// A child frame moved by `offset` (local).
    pub fn translated(&self, offset: V3) -> Xform {
        Xform {
            axes: self.axes,
            origin: self.point(offset),
        }
    }

    /// A child frame turned by `angle` radians about its local y axis (counter-clockwise seen
    /// from above in a right-handed frame: local +x turns towards local −z).
    pub fn turned_y(&self, angle: f64) -> Xform {
        let (s, c) = angle.sin_cos();
        self.then(&Xform {
            axes: [[c, 0.0, -s], [0.0, 1.0, 0.0], [s, 0.0, c]],
            origin: [0.0; 3],
        })
    }

    /// A child frame turned by `angle` radians about its local x axis (local +y towards +z).
    pub fn turned_x(&self, angle: f64) -> Xform {
        let (s, c) = angle.sin_cos();
        self.then(&Xform {
            axes: [[1.0, 0.0, 0.0], [0.0, c, s], [0.0, -s, c]],
            origin: [0.0; 3],
        })
    }

    /// A child frame turned by `angle` radians about its local z axis (local +x towards +y).
    pub fn turned_z(&self, angle: f64) -> Xform {
        let (s, c) = angle.sin_cos();
        self.then(&Xform {
            axes: [[c, s, 0.0], [-s, c, 0.0], [0.0, 0.0, 1.0]],
            origin: [0.0; 3],
        })
    }
}

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn length(a: V3) -> f64 {
    dot(a, a).sqrt()
}

/// Two faces of an outline whose normals are closer than this (the cosine of about 45°) share
/// their normal where they meet: the light rolls over the bend instead of breaking.
const SMOOTH: f64 = 0.7;

fn cross3(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// A leaf's form for [`Painter::blade`]: its length and widest width (cm), its outline along it
/// (0 at the stem … 1 at the tip, as a share of its width, 0 to 1), its fold along the midrib
/// (radians, each half lifted) and how far its tip falls (cm).
#[derive(Debug, Clone, Copy)]
pub struct Blade {
    pub size: [f64; 2],
    pub shape: fn(f64) -> f64,
    pub fold: f64,
    pub droop: f64,
    /// Stations along it: more for a big leaf whose outline shows.
    pub segments: usize,
}

/// The height of the lowest corner of the box between `min` and `max` (frame `x`), in world space:
/// the bottom its cut-away keeps.
fn lowest(x: &Xform, min: V3, max: V3) -> f64 {
    (0..8)
        .map(|k: usize| {
            x.point([0, 1, 2].map(|a| if k >> a & 1 == 0 { min[a] } else { max[a] }))[1]
        })
        .fold(f64::INFINITY, f64::min)
}

fn normalize(v: V3) -> V3 {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len > 1e-12 {
        [v[0] / len, v[1] / len, v[2] / len]
    } else {
        [0.0, 1.0, 0.0]
    }
}

/// A box face: four corners (0/1 per axis: min/max), its normal and its size for the `uv`.
type Face = ([usize; 3], [usize; 3], [usize; 3], [usize; 3], V3, [f64; 2]);

/// Appends geometry to a mesh with one material and tag at a time.
#[derive(Debug)]
pub struct Painter<'a> {
    /// Target mesh.
    pub mesh: &'a mut Mesh,
    /// Current material.
    pub material: Material,
    /// Current tag.
    pub tag: Tag,
    /// Base height for the cut-away of the next pieces (`None`: the piece's own bottom).
    pub base: Option<f64>,
}

/// Segments of a full circle for cylinders and spheres.
pub const ROUND: usize = 16;

impl<'a> Painter<'a> {
    /// A painter on `mesh`.
    pub fn new(mesh: &'a mut Mesh, material: Material, tag: Tag) -> Self {
        Self {
            mesh,
            material,
            tag,
            base: None,
        }
    }

    /// A flat quad `a b c d` (any winding); its normal faces `want` when given.
    pub fn quad(&mut self, q: [V3; 4], uvs: [[f64; 2]; 4], want: Option<V3>, base: f64) {
        let mut n = normalize(cross3(sub(q[1], q[0]), sub(q[2], q[0])));
        let flip = want.is_some_and(|w| n[0] * w[0] + n[1] * w[1] + n[2] * w[2] < 0.0);
        if flip {
            n = [-n[0], -n[1], -n[2]];
        }
        let material = self.material;
        let ids: Vec<u32> = (0..4)
            .map(|k| self.mesh.vertex(q[k], base, n, uvs[k], &material, self.tag))
            .collect();
        if flip {
            self.mesh.triangle(ids[0], ids[2], ids[1]);
            self.mesh.triangle(ids[0], ids[3], ids[2]);
        } else {
            self.mesh.triangle(ids[0], ids[1], ids[2]);
            self.mesh.triangle(ids[0], ids[2], ids[3]);
        }
    }

    /// A vertical prism over a plan quadrilateral `q` from `y0` to `y1`. `faces[i]` gives the
    /// material of the side from `q[i]` to `q[i + 1]`; `top` the material of the top face. Side
    /// faces get `uv = (distance along the side + u0, height)`.
    pub fn prism(
        &mut self,
        q: [[f64; 2]; 4],
        y0: f64,
        y1: f64,
        faces: [Option<Material>; 4],
        top: Option<Material>,
        u0: f64,
    ) {
        if y1 - y0 < 0.05 {
            return;
        }
        let base = self.base.unwrap_or(y0);
        let saved = self.material;
        let cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4.0;
        let cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4.0;
        for i in 0..4 {
            let (a, b) = (q[i], q[(i + 1) % 4]);
            let len = (b[0] - a[0]).hypot(b[1] - a[1]);
            let Some(material) = faces[i] else { continue };
            if len < 0.01 {
                continue;
            }
            self.material = material;
            let want = [(a[0] + b[0]) / 2.0 - cx, 0.0, (a[1] + b[1]) / 2.0 - cz];
            let (s0, s1) = if i == 0 { (u0, u0 + len) } else { (0.0, len) };
            self.quad(
                [
                    [a[0], y0, a[1]],
                    [b[0], y0, b[1]],
                    [b[0], y1, b[1]],
                    [a[0], y1, a[1]],
                ],
                [[s0, y0], [s1, y0], [s1, y1], [s0, y1]],
                Some(want),
                base,
            );
        }
        if let Some(material) = top {
            self.material = material;
            let p = q.map(|p| [p[0], y1, p[1]]);
            self.quad(p, q.map(|p| [p[0], p[1]]), Some([0.0, 1.0, 0.0]), base);
        }
        if let Some(material) = faces[1].or(top).filter(|_| y0 > 0.5) {
            self.material = material;
            let p = q.map(|p| [p[0], y0, p[1]]);
            self.quad(p, q.map(|p| [p[0], p[1]]), Some([0.0, -1.0, 0.0]), base);
        }
        self.material = saved;
    }

    /// A box between `min` and `max` in the frame `x`, with the current material.
    pub fn cuboid(&mut self, x: &Xform, min: V3, max: V3) {
        if (0..3).any(|k| max[k] - min[k] < 0.02) {
            return;
        }
        let base = self.base.unwrap_or_else(|| lowest(x, min, max));
        let corner = |i: usize, j: usize, k: usize| {
            x.point([
                if i == 0 { min[0] } else { max[0] },
                if j == 0 { min[1] } else { max[1] },
                if k == 0 { min[2] } else { max[2] },
            ])
        };
        let size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        // (axis, side): the four corners counter-clockwise seen from outside.
        let faces: [Face; 6] = [
            (
                [1, 0, 0],
                [1, 1, 0],
                [1, 1, 1],
                [1, 0, 1],
                [1.0, 0.0, 0.0],
                [size[2], size[1]],
            ),
            (
                [0, 0, 1],
                [0, 1, 1],
                [0, 1, 0],
                [0, 0, 0],
                [-1.0, 0.0, 0.0],
                [size[2], size[1]],
            ),
            (
                [0, 1, 1],
                [1, 1, 1],
                [1, 1, 0],
                [0, 1, 0],
                [0.0, 1.0, 0.0],
                [size[0], size[2]],
            ),
            (
                [0, 0, 0],
                [1, 0, 0],
                [1, 0, 1],
                [0, 0, 1],
                [0.0, -1.0, 0.0],
                [size[0], size[2]],
            ),
            (
                [0, 0, 1],
                [1, 0, 1],
                [1, 1, 1],
                [0, 1, 1],
                [0.0, 0.0, 1.0],
                [size[0], size[1]],
            ),
            (
                [1, 0, 0],
                [0, 0, 0],
                [0, 1, 0],
                [1, 1, 0],
                [0.0, 0.0, -1.0],
                [size[0], size[1]],
            ),
        ];
        let material = self.material;
        for (a, b, c, d, n, [su, sv]) in faces {
            let normal = x.dir(n);
            let ids = [a, b, c, d]
                .iter()
                .zip([[0.0, 0.0], [su, 0.0], [su, sv], [0.0, sv]])
                .map(|(v, uv)| {
                    self.mesh.vertex(
                        corner(v[0], v[1], v[2]),
                        base,
                        normal,
                        uv,
                        &material,
                        self.tag,
                    )
                })
                .collect::<Vec<_>>();
            self.mesh.triangle(ids[0], ids[1], ids[2]);
            self.mesh.triangle(ids[0], ids[2], ids[3]);
        }
    }

    /// A box between `min` and `max` (frame `x`) whose edges are cut by `r` and shaded round:
    /// each edge and corner joins the faces around it with their own normals, so the light rolls
    /// over it (a cushion, a mattress, a table's top). 48 vertices and 44 triangles; `r` is at
    /// most a third of the box's thinnest side.
    #[allow(clippy::needless_range_loop)]
    pub fn soft_box(&mut self, x: &Xform, min: V3, max: V3, r: f64) {
        let thin = (0..3)
            .map(|k| max[k] - min[k])
            .fold(f64::INFINITY, f64::min);
        let r = r.min(thin / 3.0);
        if thin < 0.02 || r < 0.05 {
            self.cuboid(x, min, max);
            return;
        }
        let base = self.base.unwrap_or_else(|| lowest(x, min, max));
        let (lo, hi) = (min.map(|v| v + r), max.map(|v| v - r));
        let material = self.material;
        // Face `axis, side` (side 0: min, 1: max): its four corners, keyed by the two other axes'
        // sides.
        let mut ids = [[[0_u32; 4]; 2]; 3];
        let mut spots = [[[[0.0; 3]; 4]; 2]; 3];
        // Texture axes as a box's: x along the top and the front, z along the sides.
        let frame = |axis: usize| match axis {
            0 => (2, 1),
            1 => (0, 2),
            _ => (0, 1),
        };
        let normal = |axis: usize, side: usize| {
            let mut n = [0.0; 3];
            n[axis] = if side == 0 { -1.0 } else { 1.0 };
            n
        };
        for axis in 0..3 {
            let (a, b) = ((axis + 1) % 3, (axis + 2) % 3);
            let (u, v) = frame(axis);
            for side in 0..2 {
                for corner in 0..4 {
                    let (sa, sb) = (corner & 1, corner >> 1);
                    let mut p = [0.0; 3];
                    p[axis] = if side == 0 { min[axis] } else { max[axis] };
                    p[a] = if sa == 0 { lo[a] } else { hi[a] };
                    p[b] = if sb == 0 { lo[b] } else { hi[b] };
                    spots[axis][side][corner] = p;
                    ids[axis][side][corner] = self.mesh.vertex(
                        x.point(p),
                        base,
                        x.dir(normal(axis, side)),
                        [p[u] - min[u], p[v] - min[v]],
                        &material,
                        self.tag,
                    );
                }
            }
        }
        // Faces.
        for face in ids.iter().flatten() {
            self.outward(face[0], face[1], face[3]);
            self.outward(face[0], face[3], face[2]);
        }
        // Edges: between the face of `axis` and the face of `next`, along the third axis.
        for axis in 0..3 {
            let next = (axis + 1) % 3;
            for side in 0..2 {
                for next_side in 0..2 {
                    // On `axis`'s face, `next` is its first other axis (bit 0); on `next`'s
                    // face, `axis` is its second other axis (bit 1).
                    let on_a = |k: usize| ids[axis][side][next_side | (k << 1)];
                    // `next`'s side again, with `axis`'s texture axes: the patterns run on
                    // over the edge instead of crowding into it.
                    let (u, v) = frame(axis);
                    let mut on_b = [0_u32; 2];
                    for (k, id) in on_b.iter_mut().enumerate() {
                        let p = spots[next][next_side][k | (side << 1)];
                        *id = self.mesh.vertex(
                            x.point(p),
                            base,
                            x.dir(normal(next, next_side)),
                            [p[u] - min[u], p[v] - min[v]],
                            &material,
                            self.tag,
                        );
                    }
                    self.outward(on_a(0), on_a(1), on_b[1]);
                    self.outward(on_a(0), on_b[1], on_b[0]);
                }
            }
        }
        // Corners: the three faces meeting there.
        for corner in 0..8 {
            let s = [corner & 1, (corner >> 1) & 1, corner >> 2];
            let at = |axis: usize| {
                let (a, b) = ((axis + 1) % 3, (axis + 2) % 3);
                ids[axis][s[axis]][s[a] | (s[b] << 1)]
            };
            self.outward(at(0), at(1), at(2));
        }
    }

    /// A triangle wound to face where its vertices' normals point.
    fn outward(&mut self, a: u32, b: u32, c: u32) {
        let at = |i: u32| {
            let p = self.mesh.positions[i as usize];
            [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])]
        };
        let n = |i: u32| self.mesh.normals[i as usize];
        let face = cross3(sub(at(b), at(a)), sub(at(c), at(a)));
        let want = [0, 1, 2].map(|k| f64::from(n(a)[k]) + f64::from(n(b)[k]) + f64::from(n(c)[k]));
        if face[0] * want[0] + face[1] * want[1] + face[2] * want[2] < 0.0 {
            self.mesh.triangle(a, c, b);
        } else {
            self.mesh.triangle(a, b, c);
        }
    }

    /// A leaf: a blade from `stem` pointing along `along`, its face turned up as far as it can
    /// (towards +x when it points straight up or down), its form given by `blade`. Both faces are drawn, each with
    /// its own normals, so it reads from above and below.
    #[allow(clippy::cast_precision_loss)]
    pub fn blade(&mut self, x: &Xform, stem: V3, along: V3, blade: &Blade) {
        let Blade {
            size: [length, width],
            shape,
            fold,
            droop,
            segments,
        } = *blade;
        let reach = (along[0] * along[0] + along[1] * along[1] + along[2] * along[2]).sqrt();
        if length < 0.2 || width < 0.05 || reach < 1e-9 {
            return;
        }
        let along = along.map(|v| v / reach);
        // Up, square to the leaf: it turns smoothly however steep the leaf is, but for a leaf
        // pointing straight up or down, which has no up of its own.
        let up = if along[0].hypot(along[2]) < 1e-6 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        let segments = segments.max(2);
        let side = normalize(cross3(along, up));
        let up = normalize(cross3(side, along));
        let base = self.base.unwrap_or_else(|| x.point(stem)[1] - length);
        let material = self.material;
        let (fs, fc) = fold.sin_cos();
        // Midrib and both edges at each station.
        let mut rows: Vec<[V3; 3]> = Vec::with_capacity(segments + 1);
        // Rows narrowed to a point (a pointed stem or tip): the strip closes there with one
        // triangle a side instead of two.
        let mut pointed: Vec<bool> = Vec::with_capacity(segments + 1);
        for i in 0..=segments {
            let t = i as f64 / segments as f64;
            let fall = droop * t * t;
            let c = [0, 1, 2].map(|k| stem[k] + along[k] * length * t - up[k] * fall);
            let half = width / 2.0 * shape(t).clamp(0.0, 1.0);
            let edge =
                |s: f64| [0, 1, 2].map(|k| c[k] + side[k] * s * half * fc + up[k] * half * fs);
            rows.push([edge(-1.0), c, edge(1.0)]);
            pointed.push(half < width * 1e-3);
        }
        for flip in [false, true] {
            let mut ids: Vec<[u32; 3]> = Vec::with_capacity(rows.len());
            for (i, row) in rows.iter().enumerate() {
                let next = rows[(i + 1).min(segments)];
                let prev = rows[i.saturating_sub(1)];
                let tangent = normalize(sub(next[1], prev[1]));
                // The face along the midrib, and each half's, turned the same way.
                let face = normalize(cross3(side, tangent));
                let mut out = [0_u32; 3];
                for (j, p) in row.iter().enumerate() {
                    let mut n = if j == 1 || i == segments || pointed[i] {
                        face
                    } else {
                        normalize(cross3(tangent, sub(*p, row[1])))
                    };
                    if n[0] * face[0] + n[1] * face[1] + n[2] * face[2] < 0.0 {
                        n = n.map(|v| -v);
                    }
                    if flip {
                        n = n.map(|v| -v);
                    }
                    out[j] = self.mesh.vertex(
                        x.point(*p),
                        base,
                        x.dir(n),
                        [
                            (j as f64 - 1.0) * width,
                            i as f64 / segments as f64 * length,
                        ],
                        &material,
                        self.tag,
                    );
                }
                ids.push(out);
            }
            for i in 0..segments {
                for (j, k) in [(0, 1), (1, 2)] {
                    let quad = [ids[i][j], ids[i][k], ids[i + 1][k], ids[i + 1][j]];
                    if !pointed[i] {
                        self.outward(quad[0], quad[1], quad[2]);
                    }
                    if !pointed[i + 1] {
                        self.outward(quad[0], quad[2], quad[3]);
                    }
                }
            }
        }
    }

    /// A box of size `size` whose bottom centre is at `at` (frame `x`).
    pub fn block(&mut self, x: &Xform, at: V3, size: V3) {
        self.cuboid(
            x,
            [at[0] - size[0] / 2.0, at[1], at[2] - size[2] / 2.0],
            [
                at[0] + size[0] / 2.0,
                at[1] + size[1],
                at[2] + size[2] / 2.0,
            ],
        );
    }

    /// A vertical (local y) cylinder or cone from `at` (bottom centre) up `h`, radii `r0` at
    /// the bottom and `r1` at the top, `rz0`/`rz1` along z (ellipses), with caps.
    #[allow(clippy::too_many_arguments, clippy::cast_precision_loss)]
    pub fn cylinder(
        &mut self,
        x: &Xform,
        at: V3,
        radii: [f64; 2],
        h: f64,
        segments: usize,
        caps: bool,
    ) {
        self.ellipse_cylinder(
            x,
            at,
            [radii[0], radii[0]],
            [radii[1], radii[1]],
            h,
            segments,
            caps,
        );
    }

    /// [`Self::cylinder`] with elliptic sections: `r0 = [rx, rz]` at the bottom, `r1` at the top.
    #[allow(clippy::too_many_arguments, clippy::cast_precision_loss)]
    pub fn ellipse_cylinder(
        &mut self,
        x: &Xform,
        at: V3,
        r0: [f64; 2],
        r1: [f64; 2],
        h: f64,
        segments: usize,
        caps: bool,
    ) {
        if h <= 0.02 || (r0[0].max(r1[0]) <= 0.01) {
            return;
        }
        let segments = segments.max(3);
        let base = self.base.unwrap_or_else(|| {
            let bottom = x.point(at)[1];
            let top = x.point([at[0], at[1] + h, at[2]])[1];
            bottom.min(top) - r0[0].max(r1[0]) * (1.0 - x.axes[1][1].abs())
        });
        let material = self.material;
        let slope = (r0[0] - r1[0]) / h;
        let mut ring = Vec::with_capacity(2 * (segments + 1));
        for k in 0..=segments {
            let a = k as f64 / segments as f64 * std::f64::consts::TAU;
            let (s, c) = a.sin_cos();
            let n = x.dir(normalize([c, slope, s]));
            let u = k as f64 / segments as f64;
            let p0 = x.point([at[0] + c * r0[0], at[1], at[2] + s * r0[1]]);
            let p1 = x.point([at[0] + c * r1[0], at[1] + h, at[2] + s * r1[1]]);
            ring.push(self.mesh.vertex(p0, base, n, [u, 0.0], &material, self.tag));
            ring.push(self.mesh.vertex(p1, base, n, [u, h], &material, self.tag));
        }
        for k in 0..segments {
            let (a0, a1, b0, b1) = (
                ring[2 * k],
                ring[2 * k + 1],
                ring[2 * k + 2],
                ring[2 * k + 3],
            );
            // Counter-clockwise seen from outside: angle grows from +x towards +z.
            self.mesh.triangle(a0, a1, b1);
            self.mesh.triangle(a0, b1, b0);
        }
        if caps {
            for (y, r, up) in [(at[1], r0, -1.0), (at[1] + h, r1, 1.0)] {
                if r[0] <= 0.01 {
                    continue;
                }
                let n = x.dir([0.0, up, 0.0]);
                let center = self.mesh.vertex(
                    x.point([at[0], y, at[2]]),
                    base,
                    n,
                    [0.0, 0.0],
                    &material,
                    self.tag,
                );
                let mut rim = Vec::with_capacity(segments + 1);
                for k in 0..=segments {
                    let a = k as f64 / segments as f64 * std::f64::consts::TAU;
                    let (s, c) = a.sin_cos();
                    let p = x.point([at[0] + c * r[0], y, at[2] + s * r[1]]);
                    rim.push(self.mesh.vertex(
                        p,
                        base,
                        n,
                        [c * r[0], s * r[1]],
                        &material,
                        self.tag,
                    ));
                }
                for k in 0..segments {
                    if up > 0.0 {
                        self.mesh.triangle(center, rim[k + 1], rim[k]);
                    } else {
                        self.mesh.triangle(center, rim[k], rim[k + 1]);
                    }
                }
            }
        }
    }

    /// A rod of radius `r` from `a` to `b` (frame `x`), its ends closed.
    pub fn rod(&mut self, x: &Xform, a: V3, b: V3, r: f64, segments: usize) {
        self.tube(x, a, b, r, segments, true);
    }

    /// A rod from `a` to `b`, its ends closed by `caps` or left open (hidden in a joint).
    pub fn tube(&mut self, x: &Xform, a: V3, b: V3, r: f64, segments: usize, caps: bool) {
        let d = sub(b, a);
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 0.05 {
            return;
        }
        let y = normalize(d);
        let helper = if y[1].abs() < 0.9 {
            [0.0, 1.0, 0.0]
        } else {
            [1.0, 0.0, 0.0]
        };
        let xa = normalize(cross3(helper, y));
        let za = cross3(xa, y);
        let local = Xform {
            axes: [xa, y, za],
            origin: a,
        };
        self.cylinder(&x.then(&local), [0.0; 3], [r, r], len, segments, caps);
    }

    /// An ellipsoid of radii `r` centred on `c` (frame `x`).
    #[allow(clippy::cast_precision_loss)]
    pub fn sphere(&mut self, x: &Xform, c: V3, r: V3, segments: usize) {
        if r.iter().any(|v| *v <= 0.01) {
            return;
        }
        let segments = segments.max(6);
        let rings = segments / 2;
        let base = self
            .base
            .unwrap_or_else(|| x.point(c)[1] - r[0].max(r[1]).max(r[2]));
        let material = self.material;
        let mut ids = Vec::with_capacity((rings + 1) * (segments + 1));
        for i in 0..=rings {
            let phi = i as f64 / rings as f64 * std::f64::consts::PI;
            let (sp, cp) = phi.sin_cos();
            for k in 0..=segments {
                let theta = k as f64 / segments as f64 * std::f64::consts::TAU;
                let (st, ct) = theta.sin_cos();
                let unit = [sp * ct, cp, sp * st];
                let p = [
                    c[0] + unit[0] * r[0],
                    c[1] + unit[1] * r[1],
                    c[2] + unit[2] * r[2],
                ];
                let n = normalize([unit[0] / r[0], unit[1] / r[1], unit[2] / r[2]]);
                ids.push(self.mesh.vertex(
                    x.point(p),
                    base,
                    x.dir(n),
                    [k as f64, i as f64],
                    &material,
                    self.tag,
                ));
            }
        }
        let w = segments + 1;
        for i in 0..rings {
            for k in 0..segments {
                let (a, b) = (ids[i * w + k], ids[i * w + k + 1]);
                let (c2, d) = (ids[(i + 1) * w + k], ids[(i + 1) * w + k + 1]);
                if i > 0 {
                    self.mesh.triangle(a, b, d);
                }
                if i + 1 < rings {
                    self.mesh.triangle(a, d, c2);
                }
            }
        }
    }

    /// A solid turned about the local y axis through `at` (frame `x`): `profile` is its outline
    /// from one end to the other as `[radius, height]` points (heights from `at`), stretched by
    /// `scale` along local x and z (an oval). The light rolls round where the outline bends gently
    /// and breaks where it turns sharply (a rim, a foot); an outline that comes back inside (a
    /// vase's mouth, a tub's inner side) is lit from within. An end off the axis is closed by a
    /// flat cap facing away from the outline.
    #[allow(clippy::cast_precision_loss)]
    pub fn lathe(
        &mut self,
        x: &Xform,
        at: V3,
        profile: &[[f64; 2]],
        scale: [f64; 2],
        segments: usize,
    ) {
        if profile.len() < 2 || scale.iter().any(|s| s.is_nan() || *s <= 1e-6) {
            return;
        }
        let segments = segments.max(3);
        let reach = profile.iter().map(|p| p[0].abs()).fold(0.0, f64::max) * scale[0].max(scale[1]);
        let base = self.base.unwrap_or_else(|| {
            profile
                .iter()
                .map(|p| x.point([at[0], at[1] + p[1], at[2]])[1])
                .fold(f64::INFINITY, f64::min)
                - reach * (1.0 - x.axes[1][1].abs())
        });
        let material = self.material;
        // Each length of the outline: its direction in the (radius, height) plane, and its normal
        // (outwards when the outline goes up the outside).
        let lengths: Vec<Option<[f64; 2]>> = profile
            .windows(2)
            .map(|w| {
                let d = [w[1][0] - w[0][0], w[1][1] - w[0][1]];
                let len = d[0].hypot(d[1]);
                (len > 1e-6).then(|| [d[1] / len, -d[0] / len])
            })
            .collect();
        let shared = |n: [f64; 2], other: Option<[f64; 2]>| match other {
            Some(m) if n[0] * m[0] + n[1] * m[1] > SMOOTH => {
                let s = [n[0] + m[0], n[1] + m[1]];
                let len = s[0].hypot(s[1]);
                [s[0] / len, s[1] / len]
            }
            _ => n,
        };
        let ring = |painter: &mut Self, [r, y]: [f64; 2], n: [f64; 2]| -> Vec<u32> {
            (0..=segments)
                .map(|k| {
                    let a = k as f64 / segments as f64 * std::f64::consts::TAU;
                    let (s, c) = a.sin_cos();
                    let p = x.point([
                        at[0] + c * r * scale[0],
                        at[1] + y,
                        at[2] + s * r * scale[1],
                    ]);
                    let normal = x.dir(normalize([c * n[0] / scale[0], n[1], s * n[0] / scale[1]]));
                    painter.mesh.vertex(
                        p,
                        base,
                        normal,
                        [k as f64 / segments as f64, y],
                        &material,
                        painter.tag,
                    )
                })
                .collect()
        };
        for (i, w) in profile.windows(2).enumerate() {
            let Some(n) = lengths[i] else { continue };
            let before = lengths[..i].iter().rev().find_map(|l| *l);
            let after = lengths[i + 1..].iter().find_map(|l| *l);
            let low = ring(self, w[0], shared(n, before));
            let high = ring(self, w[1], shared(n, after));
            for k in 0..segments {
                if w[0][0].abs() > 1e-6 {
                    self.outward(low[k], low[k + 1], high[k + 1]);
                }
                if w[1][0].abs() > 1e-6 {
                    self.outward(low[k], high[k + 1], high[k]);
                }
            }
        }
        // The ends off the axis: flat, facing away from the outline (back along its first length,
        // on along its last).
        let first = lengths.iter().find_map(|l| *l);
        let last = lengths.iter().rev().find_map(|l| *l);
        let ends = [
            (profile[0], first.map(|n| [n[1], -n[0]])),
            (profile[profile.len() - 1], last.map(|n| [-n[1], n[0]])),
        ];
        for ([r, y], along) in ends {
            let Some(along) = along.filter(|_| r.abs() > 0.01) else {
                continue;
            };
            let up = if along[1] > 1e-9 { 1.0 } else { -1.0 };
            let normal = x.dir([0.0, up, 0.0]);
            let centre = self.mesh.vertex(
                x.point([at[0], at[1] + y, at[2]]),
                base,
                normal,
                [0.0, 0.0],
                &material,
                self.tag,
            );
            let rim: Vec<u32> = (0..=segments)
                .map(|k| {
                    let a = k as f64 / segments as f64 * std::f64::consts::TAU;
                    let (s, c) = a.sin_cos();
                    let (px, pz) = (c * r * scale[0], s * r * scale[1]);
                    self.mesh.vertex(
                        x.point([at[0] + px, at[1] + y, at[2] + pz]),
                        base,
                        normal,
                        [px, pz],
                        &material,
                        self.tag,
                    )
                })
                .collect();
            for k in 0..segments {
                self.outward(centre, rim[k], rim[k + 1]);
            }
        }
    }

    /// A tube of radius `r` along `points` (frame `x`): each ring is turned halfway into the next
    /// length and widened across the bend, so that the tube keeps its girth round a corner (a
    /// rail, a lamp's arc, a frame). Its ends are closed by `caps` or left open (in a joint).
    #[allow(clippy::cast_precision_loss)]
    pub fn pipe(&mut self, x: &Xform, points: &[V3], r: f64, segments: usize, caps: bool) {
        let mut path: Vec<V3> = Vec::with_capacity(points.len());
        for p in points {
            if path.last().is_none_or(|q: &V3| length(sub(*p, *q)) > 0.01) {
                path.push(*p);
            }
        }
        if path.len() < 2 || r.is_nan() || r <= 0.01 {
            return;
        }
        let segments = segments.max(3);
        let n = path.len();
        let dirs: Vec<V3> = path
            .windows(2)
            .map(|w| normalize(sub(w[1], w[0])))
            .collect();
        let tangent = |i: usize| {
            if i == 0 {
                dirs[0]
            } else if i == n - 1 {
                dirs[n - 2]
            } else {
                let s = add(dirs[i - 1], dirs[i]);
                if length(s) < 1e-6 {
                    dirs[i]
                } else {
                    normalize(s)
                }
            }
        };
        let base = self.base.unwrap_or_else(|| {
            path.iter()
                .map(|p| x.point(*p)[1])
                .fold(f64::INFINITY, f64::min)
                - r
        });
        let material = self.material;
        // A first normal square to the start, carried along without twisting.
        let t0 = tangent(0);
        let helper = if t0[1].abs() < 0.9 {
            [0.0, 1.0, 0.0]
        } else {
            [1.0, 0.0, 0.0]
        };
        let mut normal = normalize(cross3(helper, t0));
        let mut rings: Vec<Vec<u32>> = Vec::with_capacity(n);
        let mut along = 0.0;
        for i in 0..n {
            let t = tangent(i);
            normal = normalize(sub(normal, scale(t, dot(normal, t))));
            let side = cross3(t, normal);
            // Across a bend, the ring reaches further by the bend's half angle.
            let bend = (i > 0 && i < n - 1).then(|| {
                let b = sub(dirs[i], dirs[i - 1]);
                let widen = 1.0 / dot(dirs[i], t).clamp(0.35, 1.0);
                (normalize(b), widen)
            });
            if i > 0 {
                along += length(sub(path[i], path[i - 1]));
            }
            let ring: Vec<u32> = (0..=segments)
                .map(|k| {
                    let a = k as f64 / segments as f64 * std::f64::consts::TAU;
                    let (s, c) = a.sin_cos();
                    let v = add(scale(normal, c), scale(side, s));
                    let reach = match bend {
                        Some((b, widen)) if length(b) > 1e-9 => {
                            add(v, scale(b, dot(v, b) * (widen - 1.0)))
                        }
                        _ => v,
                    };
                    self.mesh.vertex(
                        x.point(add(path[i], scale(reach, r))),
                        base,
                        x.dir(v),
                        [k as f64 / segments as f64, along],
                        &material,
                        self.tag,
                    )
                })
                .collect();
            if let Some(previous) = rings.last() {
                for k in 0..segments {
                    let (a, b, c, d) = (previous[k], previous[k + 1], ring[k + 1], ring[k]);
                    self.outward(a, b, c);
                    self.outward(a, c, d);
                }
            }
            rings.push(ring);
        }
        if !caps {
            return;
        }
        for (i, facing) in [(0, scale(tangent(0), -1.0)), (n - 1, tangent(n - 1))] {
            let normal = x.dir(facing);
            let centre = self.mesh.vertex(
                x.point(path[i]),
                base,
                normal,
                [0.0, 0.0],
                &material,
                self.tag,
            );
            let rim: Vec<u32> = rings[i]
                .iter()
                .map(|&v| {
                    let p = self.mesh.positions[v as usize];
                    let p = [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])];
                    self.mesh
                        .vertex(p, base, normal, [0.0, 0.0], &material, self.tag)
                })
                .collect();
            for k in 0..segments {
                self.outward(centre, rim[k], rim[k + 1]);
            }
        }
    }

    /// A solid whose outline is `outline` (local x, y: a simple polygon, either way round), from
    /// `z0` to `z1` along local z (frame `x`): two flat faces and a side square to them, sharp
    /// where the outline turns by more than about 45°, rounded by its normals elsewhere (a rocker,
    /// the side of a wing chair, a car's flank).
    pub fn slab(&mut self, x: &Xform, outline: &[[f64; 2]], z0: f64, z1: f64) {
        let mut points: Vec<[f64; 2]> = Vec::with_capacity(outline.len());
        for p in outline {
            if points
                .last()
                .is_none_or(|q: &[f64; 2]| (p[0] - q[0]).hypot(p[1] - q[1]) > 0.01)
            {
                points.push(*p);
            }
        }
        while points.len() > 3
            && (points[0][0] - points[points.len() - 1][0])
                .hypot(points[0][1] - points[points.len() - 1][1])
                <= 0.01
        {
            points.pop();
        }
        let triangles = crate::geometry::polygon::triangulate(&points);
        if triangles.is_empty() || z1 - z0 < 0.02 {
            return;
        }
        let base = self.base.unwrap_or_else(|| {
            points
                .iter()
                .flat_map(|p| [z0, z1].map(|z| x.point([p[0], p[1], z])[1]))
                .fold(f64::INFINITY, f64::min)
        });
        let material = self.material;
        // Positive: anticlockwise with y up.
        let turn = if crate::geometry::polygon::signed_area2(&points) >= 0.0 {
            1.0
        } else {
            -1.0
        };
        for (z, facing) in [(z0, -1.0), (z1, 1.0)] {
            let normal = x.dir([0.0, 0.0, facing]);
            let ids: Vec<u32> = points
                .iter()
                .map(|p| {
                    self.mesh.vertex(
                        x.point([p[0], p[1], z]),
                        base,
                        normal,
                        *p,
                        &material,
                        self.tag,
                    )
                })
                .collect();
            for [a, b, c] in &triangles {
                self.outward(ids[*a], ids[*b], ids[*c]);
            }
        }
        let n = points.len();
        let normals: Vec<[f64; 2]> = (0..n)
            .map(|i| {
                let (a, b) = (points[i], points[(i + 1) % n]);
                let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                let len = dx.hypot(dy).max(1e-9);
                [turn * dy / len, -turn * dx / len]
            })
            .collect();
        let corner = |own: [f64; 2], other: [f64; 2]| {
            if own[0] * other[0] + own[1] * other[1] > SMOOTH {
                let s = [own[0] + other[0], own[1] + other[1]];
                let len = s[0].hypot(s[1]);
                [s[0] / len, s[1] / len]
            } else {
                own
            }
        };
        let mut along = 0.0;
        for i in 0..n {
            let (a, b) = (points[i], points[(i + 1) % n]);
            let own = normals[i];
            let ends = [
                (a, corner(own, normals[(i + n - 1) % n])),
                (b, corner(own, normals[(i + 1) % n])),
            ];
            let span = (b[0] - a[0]).hypot(b[1] - a[1]);
            let mut ids = [[0_u32; 2]; 2];
            for (e, (p, nn)) in ends.iter().enumerate() {
                let normal = x.dir([nn[0], nn[1], 0.0]);
                let u = along + span * f64::from(u8::try_from(e).unwrap_or(0));
                for (k, z) in [z0, z1].into_iter().enumerate() {
                    ids[e][k] = self.mesh.vertex(
                        x.point([p[0], p[1], z]),
                        base,
                        normal,
                        [u, z - z0],
                        &material,
                        self.tag,
                    );
                }
            }
            self.outward(ids[0][0], ids[1][0], ids[1][1]);
            self.outward(ids[0][0], ids[1][1], ids[0][1]);
            along += span;
        }
    }

    /// A horizontal polygon (plan points) at height `y`, facing up or down, with `uv` = plan
    /// coordinates turned by `uv_angle` degrees.
    pub fn polygon(&mut self, points: &[[f64; 2]], y: f64, up: bool, uv_angle: f64) {
        let triangles = crate::geometry::polygon::triangulate(points);
        if triangles.is_empty() {
            return;
        }
        let (s, c) = (-uv_angle).to_radians().sin_cos();
        let material = self.material;
        let n = [0.0, if up { 1.0 } else { -1.0 }, 0.0];
        let base = self.base.unwrap_or(y);
        let ids: Vec<u32> = points
            .iter()
            .map(|p| {
                let uv = [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
                self.mesh
                    .vertex([p[0], y, p[1]], base, n, uv, &material, self.tag)
            })
            .collect();
        // Plan clockwise (y down) is counter-clockwise seen from above (+y up, z = plan y).
        let clockwise = crate::geometry::polygon::signed_area2(points) >= 0.0;
        for [a, b, c2] in triangles {
            let (a, b, c2) = (ids[a], ids[b], ids[c2]);
            if clockwise == up {
                self.mesh.triangle(a, c2, b);
            } else {
                self.mesh.triangle(a, b, c2);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn painter(mesh: &mut Mesh) -> Painter<'_> {
        Painter::new(
            mesh,
            Material::paint(Rgb8::from_u32(0x808080)),
            Tag::default(),
        )
    }

    /// Every triangle faces away from `inside` (a point inside a closed convex shape).
    fn faces_out(mesh: &Mesh, inside: V3) -> bool {
        mesh.indices.chunks_exact(3).all(|t| {
            let p = |i: u32| {
                let v = mesh.positions[i as usize];
                [f64::from(v[0]), f64::from(v[1]), f64::from(v[2])]
            };
            let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
            let n = cross3(sub(b, a), sub(c, a));
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            if len < 1e-9 {
                return true;
            }
            let to = sub(a, inside);
            n[0] * to[0] + n[1] * to[1] + n[2] * to[2] > 0.0
        })
    }

    #[test]
    fn boxes_face_out_and_carry_their_base() {
        let mut mesh = Mesh::default();
        let mut p = painter(&mut mesh);
        let frame = Xform::plan([100.0, 0.0, 50.0], [0.0, 1.0]);
        p.cuboid(&frame, [0.0, 10.0, 0.0], [20.0, 30.0, 10.0]);
        assert_eq!(mesh.vertex_count(), 24);
        assert_eq!(mesh.triangle_count(), 12);
        assert!(mesh.positions.iter().all(|v| (v[3] - 10.0).abs() < 1e-6));
        let centre = frame.point([10.0, 20.0, 5.0]);
        assert!(faces_out(&mesh, centre));
    }

    #[test]
    fn round_shapes_face_out() {
        let mut mesh = Mesh::default();
        painter(&mut mesh).cylinder(&Xform::IDENTITY, [0.0; 3], [5.0, 3.0], 10.0, 12, true);
        assert!(faces_out(&mesh, [0.0, 5.0, 0.0]));
        let mut mesh = Mesh::default();
        painter(&mut mesh).sphere(&Xform::IDENTITY, [0.0, 20.0, 0.0], [5.0, 8.0, 5.0], 12);
        assert!(faces_out(&mesh, [0.0, 20.0, 0.0]));
        let mut mesh = Mesh::default();
        painter(&mut mesh).rod(&Xform::IDENTITY, [0.0; 3], [10.0, 10.0, 0.0], 1.0, 8);
        assert!(faces_out(&mesh, [5.0, 5.0, 0.0]));
    }

    #[test]
    fn prisms_and_floors_face_out() {
        let mut mesh = Mesh::default();
        let m = Material::paint(Rgb8::from_u32(0xffffff));
        painter(&mut mesh).prism(
            [[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
            0.0,
            250.0,
            [Some(m); 4],
            Some(m),
            0.0,
        );
        assert!(faces_out(&mesh, [50.0, 125.0, 10.0]));
        let mut mesh = Mesh::default();
        let square = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
        painter(&mut mesh).polygon(&square, 0.0, true, 0.0);
        assert!(faces_out(&mesh, [50.0, -1.0, 50.0]));
        let reversed: Vec<[f64; 2]> = square.iter().rev().copied().collect();
        let mut mesh = Mesh::default();
        painter(&mut mesh).polygon(&reversed, 0.0, true, 0.0);
        assert!(faces_out(&mesh, [50.0, -1.0, 50.0]));
    }

    #[test]
    fn soft_boxes_are_closed_and_face_out() {
        let mut mesh = Mesh::default();
        let frame = Xform::plan([40.0, 0.0, 20.0], [0.6, 0.8]);
        painter(&mut mesh).soft_box(&frame, [0.0, 5.0, 0.0], [80.0, 25.0, 40.0], 4.0);
        assert_eq!(mesh.vertex_count(), 48);
        assert_eq!(mesh.triangle_count(), 44);
        assert!(faces_out(&mesh, frame.point([40.0, 15.0, 20.0])));
        // Every edge is shared by exactly two triangles: no gap where the light could leak.
        #[allow(clippy::cast_possible_truncation)]
        let key = |i: u32| mesh.positions[i as usize].map(|c| (c * 100.0).round() as i64);
        let mut edges = std::collections::HashMap::new();
        for t in mesh.indices.chunks_exact(3) {
            for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                let (a, b) = (key(a), key(b));
                *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
            }
        }
        assert!(edges.values().all(|&n| n == 2));
        // Turned over, it still knows its lowest point.
        let mut mesh = Mesh::default();
        let tipped = Xform::IDENTITY.turned_z(0.6);
        painter(&mut mesh).soft_box(&tipped, [0.0; 3], [80.0, 25.0, 40.0], 4.0);
        let corners = (0..8).map(|k: usize| {
            let p = tipped.point([0, 1, 2].map(|a| [0.0, [80.0, 25.0, 40.0][a]][k >> a & 1]));
            p[1]
        });
        let low = corners.fold(f64::INFINITY, f64::min);
        #[allow(clippy::cast_possible_truncation)]
        let low = low as f32;
        assert!(mesh.positions.iter().all(|v| (v[3] - low).abs() < 1e-3));
        // Too thin to round: a plain box.
        let mut mesh = Mesh::default();
        painter(&mut mesh).soft_box(&frame, [0.0; 3], [80.0, 0.1, 40.0], 4.0);
        assert_eq!(mesh.triangle_count(), 12);
    }

    #[test]
    fn blades_show_both_faces() {
        let mut mesh = Mesh::default();
        let leaf = |t: f64| (std::f64::consts::PI * t).sin();
        let form = Blade {
            size: [20.0, 8.0],
            shape: leaf,
            fold: 0.3,
            droop: 4.0,
            segments: 5,
        };
        // Not of unit length, and steep: still a leaf facing up.
        painter(&mut mesh).blade(&Xform::IDENTITY, [0.0, 30.0, 0.0], [2.0, 1.8, 0.0], &form);
        assert_eq!(mesh.vertex_count(), 2 * 3 * 6);
        // Pointed at both ends: one triangle a side there instead of two.
        assert_eq!(mesh.triangle_count(), 2 * (4 * 5 - 4));
        // Each triangle is wound the way its normals point, and half of them look up.
        let mut up = 0;
        for t in mesh.indices.chunks_exact(3) {
            let p = |i: u32| {
                let v = mesh.positions[i as usize];
                [f64::from(v[0]), f64::from(v[1]), f64::from(v[2])]
            };
            let n = cross3(sub(p(t[1]), p(t[0])), sub(p(t[2]), p(t[0])));
            let want = mesh.normals[t[0] as usize].map(f64::from);
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            assert!(len > 1e-6, "no flat triangle");
            assert!(n[0] * want[0] + n[1] * want[1] + n[2] * want[2] > 0.0);
            if n[1] > 0.0 {
                up += 1;
            }
        }
        assert_eq!(up, 16);
        // Too small to see: nothing.
        let mut mesh = Mesh::default();
        let tiny = Blade {
            size: [0.1, 8.0],
            ..form
        };
        painter(&mut mesh).blade(&Xform::IDENTITY, [0.0; 3], [1.0, 0.0, 0.0], &tiny);
        assert_eq!(mesh.triangle_count(), 0);
    }

    /// Every edge is shared by exactly two triangles (by position): no gap the light leaks
    /// through.
    fn closed(mesh: &Mesh) -> bool {
        #[allow(clippy::cast_possible_truncation)]
        let key = |i: u32| mesh.positions[i as usize].map(|c| (c * 100.0).round() as i64);
        let mut edges = std::collections::HashMap::new();
        for t in mesh.indices.chunks_exact(3) {
            for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                let (a, b) = (key(a), key(b));
                if a != b {
                    *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
                }
            }
        }
        edges.values().all(|&n| n == 2)
    }

    /// Every triangle is wound the way its vertices' normals point.
    fn wound(mesh: &Mesh) -> bool {
        mesh.indices.chunks_exact(3).all(|t| {
            let p = |i: u32| {
                let v = mesh.positions[i as usize];
                [f64::from(v[0]), f64::from(v[1]), f64::from(v[2])]
            };
            let n = cross3(sub(p(t[1]), p(t[0])), sub(p(t[2]), p(t[0])));
            let want = t.iter().fold([0.0; 3], |s, &i| {
                add(
                    s,
                    mesh.normals[i as usize].map(f64::from)[..3]
                        .try_into()
                        .unwrap(),
                )
            });
            length(n) < 1e-6 || dot(n, want) > 0.0
        })
    }

    #[test]
    fn turned_shapes_are_closed_and_lit_from_the_right_side() {
        // A drum with both ends closed.
        let mut mesh = Mesh::default();
        let frame = Xform::plan([20.0, 0.0, 10.0], [0.6, 0.8]);
        painter(&mut mesh).lathe(&frame, [0.0; 3], &[[4.0, 0.0], [4.0, 10.0]], [1.0, 1.0], 12);
        assert!(closed(&mesh) && wound(&mesh));
        assert!(faces_out(&mesh, frame.point([0.0, 5.0, 0.0])));
        // A vase: up the outside, over its lip and down the inside to its floor, an oval.
        let vase = [
            [0.0, 0.0],
            [4.0, 0.0],
            [6.0, 8.0],
            [4.0, 18.0],
            [4.5, 20.0],
            [4.0, 20.0],
            [3.5, 18.0],
            [5.0, 8.0],
            [3.0, 1.0],
            [0.0, 1.0],
        ];
        let mut mesh = Mesh::default();
        painter(&mut mesh).lathe(&Xform::IDENTITY, [0.0; 3], &vase, [1.0, 0.7], 16);
        assert!(closed(&mesh) && wound(&mesh));
        // Its inner wall faces the axis.
        let inner = mesh
            .positions
            .iter()
            .zip(&mesh.normals)
            .find(|(p, _)| {
                (p[1] - 18.0).abs() < 0.1 && (p[0] - 3.5).abs() < 0.1 && p[2].abs() < 0.1
            })
            .map(|(_, n)| n[0]);
        assert!(inner.is_some_and(|nx| nx < 0));
        // Nothing for an outline of one point, or no width.
        let mut mesh = Mesh::default();
        painter(&mut mesh).lathe(&Xform::IDENTITY, [0.0; 3], &[[4.0, 0.0]], [1.0, 1.0], 12);
        painter(&mut mesh).lathe(&Xform::IDENTITY, [0.0; 3], &vase, [0.0, 1.0], 12);
        assert_eq!(mesh.triangle_count(), 0);
    }

    #[test]
    fn pipes_bend_without_gaps() {
        let mut mesh = Mesh::default();
        painter(&mut mesh).pipe(
            &Xform::IDENTITY,
            &[[0.0; 3], [0.0, 10.0, 0.0]],
            1.0,
            8,
            true,
        );
        assert!(closed(&mesh) && wound(&mesh));
        assert!(faces_out(&mesh, [0.0, 5.0, 0.0]));
        // An arc, and a right angle: closed, and as thick across the corner as along it.
        let arc: Vec<V3> = (0..=8)
            .map(|k| {
                let a = f64::from(k) / 8.0 * std::f64::consts::FRAC_PI_2;
                [50.0 * a.cos(), 50.0 * a.sin(), 0.0]
            })
            .collect();
        let mut mesh = Mesh::default();
        painter(&mut mesh).pipe(&Xform::IDENTITY, &arc, 1.5, 8, true);
        assert!(closed(&mesh) && wound(&mesh));
        let mut mesh = Mesh::default();
        let corner = [[0.0; 3], [20.0, 0.0, 0.0], [20.0, 20.0, 0.0]];
        painter(&mut mesh).pipe(&Xform::IDENTITY, &corner, 1.0, 8, false);
        assert!(wound(&mesh));
        let reach = mesh
            .positions
            .iter()
            .map(|p| p[0])
            .fold(f32::NEG_INFINITY, f32::max);
        assert!((reach - 21.0).abs() < 0.05, "{reach}");
        // Points repeated or a single point: no tube of nothing.
        let mut mesh = Mesh::default();
        painter(&mut mesh).pipe(&Xform::IDENTITY, &[[1.0; 3], [1.0; 3]], 1.0, 8, true);
        assert_eq!(mesh.triangle_count(), 0);
    }

    #[test]
    fn slabs_follow_their_outline_either_way_round() {
        // An L, concave, both ways round.
        let l = [
            [0.0, 0.0],
            [30.0, 0.0],
            [30.0, 10.0],
            [10.0, 10.0],
            [10.0, 40.0],
            [0.0, 40.0],
        ];
        for outline in [l.to_vec(), l.iter().rev().copied().collect()] {
            let mut mesh = Mesh::default();
            let frame = Xform::plan([5.0, 2.0, 5.0], [0.0, 1.0]);
            painter(&mut mesh).slab(&frame, &outline, -3.0, 3.0);
            assert!(closed(&mesh) && wound(&mesh));
            // 4 triangles a face, two a side.
            assert_eq!(mesh.triangle_count(), 2 * 4 + 2 * 6);
        }
        // A rocker's curve: its long side round, its ends sharp.
        let rocker: Vec<[f64; 2]> = (0..=10)
            .map(|k| {
                let a = -0.5 + f64::from(k) / 10.0;
                [100.0 * a.sin(), 100.0 - 100.0 * a.cos()]
            })
            .chain((0..=10).rev().map(|k| {
                let a = -0.5 + f64::from(k) / 10.0;
                [96.0 * a.sin(), 104.0 - 96.0 * a.cos()]
            }))
            .collect();
        let mut mesh = Mesh::default();
        painter(&mut mesh).slab(&Xform::IDENTITY, &rocker, 0.0, 2.0);
        assert!(closed(&mesh) && wound(&mesh));
    }

    #[test]
    fn transforms_compose() {
        let frame = Xform::plan([0.0; 3], [0.0, 1.0]);
        // Local x along plan +y, local z towards plan −x.
        assert_eq!(frame.point([1.0, 0.0, 0.0]), [0.0, 0.0, 1.0]);
        assert_eq!(frame.point([0.0, 0.0, 1.0]), [-1.0, 0.0, 0.0]);
        let turned = Xform::IDENTITY.turned_y(std::f64::consts::FRAC_PI_2);
        let p = turned.point([1.0, 0.0, 0.0]);
        assert!(p[0].abs() < 1e-12 && (p[2] - -1.0).abs() < 1e-12);
    }
}
