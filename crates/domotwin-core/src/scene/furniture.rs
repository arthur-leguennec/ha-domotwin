//! Furniture: one procedural model per kind, built at the piece's exact size. Model frame: origin
//! at the centre of the footprint on the piece's underside, `x` across the width, `y` up, `z`
//! towards the front.

use std::rc::Rc;

use super::Builder;
use super::mesh::{CutMode, Material, NO_GROUP, Painter, ROUND, Surface, Tag, V3, Xform};
use super::{imported, kit};
use crate::geometry::polygon::P2;
use crate::geometry::walls::WallLayout;
use crate::model_mesh::ModelMesh;
use crate::plan::light::{light_color, light_power};
use crate::plan::{Element, Furniture, Kind, Plan, Rgb8};

/// Pieces closer than this (cm) to a wall face hang on it.
const WALL_REACH: f64 = 25.0;

/// Multiplies a colour (`f` > 1 lightens).
pub(crate) fn shade(c: Rgb8, f: f64) -> Rgb8 {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let ch = |v: u8| (f64::from(v) * f).round().clamp(0.0, 255.0) as u8;
    Rgb8 {
        r: ch(c.r),
        g: ch(c.g),
        b: ch(c.b),
    }
}

fn luminance(c: Rgb8) -> f64 {
    (0.299 * f64::from(c.r) + 0.587 * f64::from(c.g) + 0.114 * f64::from(c.b)) / 255.0
}

/// A small deterministic generator, seeded by the element id (stable looks across reloads).
#[derive(Debug, Clone)]
pub(crate) struct Rng(u32);

impl Rng {
    pub(crate) fn new(seed: &str) -> Self {
        let mut h: u32 = 2_166_136_261;
        for b in seed.bytes() {
            h ^= u32::from(b);
            h = h.wrapping_mul(16_777_619);
        }
        Self(h)
    }

    /// Next value in 0–1.
    pub(crate) fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

const WHITE: Rgb8 = Rgb8::from_u32(0xf2f1ec);
const DARK: Rgb8 = Rgb8::from_u32(0x1d1f20);
const STEEL: Rgb8 = Rgb8::from_u32(0xb7b8b4);
const CHROME: Rgb8 = Rgb8::from_u32(0xd6d9d8);
const GOLD: Rgb8 = Rgb8::from_u32(0xc7a25a);
const WOOD_DARK: Rgb8 = Rgb8::from_u32(0x3f3127);
const LEAF: Rgb8 = Rgb8::from_u32(0x4f6b3c);
const SCREEN: Material = Material::new(Rgb8::from_u32(0x0b0d0e), 0.12, Surface::Screen);
const STONE: Material = Material::new(Rgb8::from_u32(0x6e6a64), 0.3, Surface::Matte);

/// Builds a model: painters on both meshes, the model frame and the piece's size and colour.
pub(crate) struct Model<'a> {
    pub(crate) p: Painter<'a>,
    pub(crate) g: Painter<'a>,
    pub(crate) x: Xform,
    /// Width (x), depth (z), height (y).
    pub(crate) w: f64,
    pub(crate) d: f64,
    pub(crate) h: f64,
    pub(crate) c: Rgb8,
    pub(crate) rng: Rng,
    /// Live opening (curtains), overriding the plan.
    pub(crate) open: Option<f64>,
    /// Light sources found while building (model frame).
    pub(crate) bulbs: Vec<V3>,
    /// Room above the piece up to the ceiling (cm), for stems and chimneys.
    pub(crate) ceiling: f64,
    /// The mesh of a user model's 3D file, and whether it is Z up.
    pub(crate) file: Option<(Rc<ModelMesh>, bool)>,
}

impl std::fmt::Debug for Model<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Model")
            .field("w", &self.w)
            .field("d", &self.d)
            .finish()
    }
}

impl Model<'_> {
    pub(crate) fn bx(&mut self, m: Material, min: V3, max: V3) {
        if m.surface == Surface::Glass {
            self.g.material = m;
            self.g.cuboid(&self.x, min, max);
        } else {
            self.p.material = m;
            self.p.cuboid(&self.x, min, max);
        }
    }

    /// Box with its bottom centre at `at`.
    pub(crate) fn blk(&mut self, m: Material, at: V3, size: V3) {
        self.bx(
            m,
            [at[0] - size[0] / 2.0, at[1], at[2] - size[2] / 2.0],
            [
                at[0] + size[0] / 2.0,
                at[1] + size[1],
                at[2] + size[2] / 2.0,
            ],
        );
    }

    pub(crate) fn cyl(&mut self, m: Material, at: V3, r: [f64; 2], h: f64) {
        self.p.material = m;
        self.p.cylinder(&self.x, at, r, h, ROUND, true);
    }

    pub(crate) fn sph(&mut self, m: Material, c: V3, r: V3) {
        self.p.material = m;
        self.p.sphere(&self.x, c, r, ROUND);
    }

    pub(crate) fn rod(&mut self, m: Material, a: V3, b: V3, r: f64) {
        self.p.material = m;
        self.p.rod(&self.x, a, b, r, 8);
    }

    /// The glowing part of a lamp: `off` is its look when the lamp is off; the light itself
    /// comes from the live state of the element.
    fn glow(&self, off: Rgb8) -> Material {
        Material::glow(off)
    }

    /// A bulb: glowing sphere and a light source.
    fn bulb(&mut self, c: V3, r: f64) {
        let m = self.glow(Rgb8::from_u32(0xf4f1e8));
        self.sph(m, c, [r, r, r]);
        self.bulbs.push(c);
    }

    /// Drawer or door fronts: `cols × rows` panels on the front face between `y0` and `y1`.
    fn fronts(&mut self, m: Material, y0: f64, y1: f64, cols: usize, rows: usize, knobs: bool) {
        let (w, d) = (self.w, self.d);
        #[allow(clippy::cast_precision_loss)]
        let (cw, rh) = ((w - 2.0) / cols as f64, (y1 - y0) / rows as f64);
        for r in 0..rows {
            for k in 0..cols {
                #[allow(clippy::cast_precision_loss)]
                let (x0, ya) = (-w / 2.0 + 1.0 + cw * k as f64, y0 + rh * r as f64);
                self.bx(
                    m,
                    [x0 + 0.4, ya + 0.4, d / 2.0 - 0.2],
                    [x0 + cw - 0.4, ya + rh - 0.4, d / 2.0 + 1.0],
                );
                if knobs {
                    let kx = if rows > 1 || cols == 1 {
                        x0 + cw / 2.0
                    } else if k % 2 == 0 {
                        x0 + cw - 4.0
                    } else {
                        x0 + 4.0
                    };
                    let ky = if rows > 1 {
                        ya + rh / 2.0
                    } else {
                        ya + rh * 0.8
                    };
                    self.blk(
                        Material::metal(STEEL),
                        [kx, ky - 0.8, d / 2.0 + 1.0],
                        [if rows > 1 { 8.0 } else { 1.6 }, 1.6, 1.6],
                    );
                }
            }
        }
    }

    /// Four legs of `size` inset by `inset` at the corners, from `y0` up `h`.
    fn legs(&mut self, m: Material, inset: f64, size: f64, h: f64) {
        let (w, d) = (self.w, self.d);
        for sx in [-1.0, 1.0] {
            for sz in [-1.0, 1.0] {
                self.blk(
                    m,
                    [sx * (w / 2.0 - inset), 0.0, sz * (d / 2.0 - inset)],
                    [size, h, size],
                );
            }
        }
    }
}

/// The local surface of a colour: light colours read as paint, others as wood.
fn surface(c: Rgb8) -> Material {
    if luminance(c) > 0.74 {
        Material::satin(c)
    } else {
        Material::wood(c)
    }
}

/// Builds every furniture item.
pub(crate) fn build(builder: &mut Builder, plan: &Plan, layout: &WallLayout) {
    for (index, element) in plan.elements.iter().enumerate() {
        let Element::Furniture(item) = element else {
            continue;
        };
        // Curtains move (live control), and pieces being moved in edit mode: they are built
        // with the moving parts.
        let moving = item.kind == Kind::Curtain || builder.moving.contains(&index);
        if moving != builder.dynamic {
            continue;
        }
        piece(builder, plan, layout, index, item);
    }
}

/// The wall group of the wall face nearest to a footprint, when one is within reach.
fn hanging_group(builder: &mut Builder, layout: &WallLayout, corners: &[P2; 4]) -> Option<u8> {
    let centre = [
        corners.iter().map(|p| p[0]).sum::<f64>() / 4.0,
        corners.iter().map(|p| p[1]).sum::<f64>() / 4.0,
    ];
    let mut best: Option<(f64, [f64; 2], bool)> = None;
    for room in &layout.rooms {
        for (i, bands) in room.sides.iter().enumerate() {
            let Some(bands) = bands else { continue };
            let (a, b) = room.side(i);
            let n = room.normal(i);
            for band in bands {
                let p0 = [
                    a[0] + (b[0] - a[0]) * band.t0,
                    a[1] + (b[1] - a[1]) * band.t0,
                ];
                let p1 = [
                    a[0] + (b[0] - a[0]) * band.t1,
                    a[1] + (b[1] - a[1]) * band.t1,
                ];
                // Distance from the footprint to the wall face along the normal, and overlap.
                let (dx, dy) = (p1[0] - p0[0], p1[1] - p0[1]);
                let len = dx.hypot(dy);
                if len < 1.0 {
                    continue;
                }
                let along = ((centre[0] - p0[0]) * dx + (centre[1] - p0[1]) * dy) / len;
                if along < -5.0 || along > len + 5.0 {
                    continue;
                }
                let face = band.o0;
                let dist = corners
                    .iter()
                    .map(|p| (p[0] - p0[0]) * n[0] + (p[1] - p0[1]) * n[1] - face)
                    .fold(f64::NEG_INFINITY, f64::max);
                let gap = -dist;
                if (-2.0..WALL_REACH).contains(&gap) && best.is_none_or(|(g, _, _)| gap < g) {
                    best = Some((gap, n, band.inner));
                }
            }
        }
    }
    best.map(|(_, n, inner)| builder.group(n, inner))
}

fn piece(builder: &mut Builder, plan: &Plan, layout: &WallLayout, index: usize, f: &Furniture) {
    let info = f.kind.info();
    let (s, c) = f.angle.to_radians().sin_cos();
    let rotate = |v: P2| [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
    let centre = f.center();
    let corners: [P2; 4] = [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]].map(|[a, b]| {
        let r = rotate([a * f.w / 2.0, b * f.h / 2.0]);
        [centre[0] + r[0], centre[1] + r[1]]
    });
    let flags = info.flags;
    let element = builder.element_tag(index);
    let group = if flags.wall_decor || f.kind.info().elevation > 0.0 && !flags.hanging {
        hanging_group(builder, layout, &corners)
    } else {
        None
    };
    let tag = Tag {
        element,
        room: builder.room_for(plan, &f.parent, centre),
        group: group.unwrap_or(NO_GROUP),
        cut: if group.is_some() {
            CutMode::Hide
        } else {
            CutMode::Keep
        },
    };
    // Vertical kinds are modelled along the plan's y side, their front towards plan −x.
    let (u, w, d) = if flags.vertical {
        (rotate([0.0, 1.0]), f.h, f.w)
    } else {
        (rotate([1.0, 0.0]), f.w, f.h)
    };
    let x = Xform::plan([centre[0], f.elevation, centre[1]], u);
    let open = builder.overrides.open.get(&index).copied();
    let ceiling = (builder.wall_height - f.elevation - f.z).max(0.0);
    let base = Material::paint(f.color);
    let file = if f.kind == Kind::Custom && !builder.boxed.contains(&index) {
        f.model
            .as_ref()
            .and_then(|id| plan.models.get(id))
            .and_then(|model| {
                let mesh = builder.models.get(imported::file_hash(model)?)?;
                Some((Rc::clone(mesh), imported::z_up(model)))
            })
    } else {
        None
    };
    let mut model = Model {
        p: Painter::new(&mut builder.opaque, base, tag),
        g: Painter::new(&mut builder.transparent, Material::glass(), tag),
        x,
        w,
        d,
        h: f.z,
        c: f.color,
        rng: Rng::new(&f.id),
        open,
        bulbs: Vec::new(),
        ceiling,
        file,
    };
    let before = model.p.mesh.vertex_count() + model.g.mesh.vertex_count();
    draw(&mut model, f, plan);
    if model.p.mesh.vertex_count() + model.g.mesh.vertex_count() == before {
        // Too small for its model: a plain box of its size.
        model.bx(base, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, f.z, d / 2.0]);
    }
    let bulbs: Vec<V3> = model.bulbs.iter().map(|b| model.x.point(*b)).collect();
    if f.kind.is_light() {
        let color = light_color(f);
        let power = light_power(f);
        for position in bulbs {
            builder.lights.push(super::LightSpot {
                element: index,
                position,
                color,
                power,
                on: !f.light_off,
                room: tag.room,
                screen: false,
            });
        }
    }
    if f.kind == Kind::Custom {
        // A user model lights the room when a light is linked to it (D-021): off until then.
        builder.lights.push(super::LightSpot {
            element: index,
            position: x.point([0.0, f.z * 0.75, 0.0]),
            color: light_color(f),
            power: 1.0,
            on: false,
            room: tag.room,
            screen: false,
        });
    }
    if f.kind == Kind::Tv {
        // The screen lights the room in front of it while something plays.
        builder.lights.push(super::LightSpot {
            element: index,
            position: x.point([0.0, f.z * 0.55, d / 2.0 + 30.0]),
            color: Rgb8::from_u32(0xa9c4ff),
            power: 0.8,
            on: false,
            room: tag.room,
            screen: true,
        });
    }
    // A soft contact shadow under pieces standing on the floor.
    if f.elevation < 2.0 && !flags.wall_decor && !flags.hanging && f.z > 8.0 {
        contact_shadow(builder, &x, w, d);
    }
}

/// A quad on the floor under a piece; the shader fades it from the footprint outwards. The
/// colour carries the footprint's share of the quad (red: width, green: depth).
fn contact_shadow(builder: &mut Builder, x: &Xform, w: f64, d: f64) {
    let margin = 6.0 + 0.08 * w.min(d);
    let (hw, hd) = (w / 2.0 + margin, d / 2.0 + margin);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let share = |inner: f64, outer: f64| ((inner / outer) * 255.0).round().clamp(0.0, 255.0) as u8;
    let material = Material::new(
        Rgb8 {
            r: share(w / 2.0, hw),
            g: share(d / 2.0, hd),
            b: 0,
        },
        1.0,
        Surface::Shadow,
    );
    let mut p = Painter::new(&mut builder.transparent, material, Tag::default());
    let ground = |a: f64, b: f64| {
        let q = x.point([a * hw, 0.0, b * hd]);
        [q[0], 0.3, q[2]]
    };
    p.quad(
        [
            ground(-1.0, -1.0),
            ground(1.0, -1.0),
            ground(1.0, 1.0),
            ground(-1.0, 1.0),
        ],
        [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]],
        Some([0.0, 1.0, 0.0]),
        0.0,
    );
}

#[allow(clippy::too_many_lines)]
fn draw(m: &mut Model<'_>, f: &Furniture, plan: &Plan) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let variant = f.variant.as_deref();
    match f.kind {
        Kind::Sofa => sofa(m, variant == Some("cuir"), None),
        Kind::Armchair => sofa(m, variant == Some("cuir"), Some(1)),
        Kind::Table | Kind::Dining | Kind::Desk | Kind::Console => {
            let top = if f.kind == Kind::Table { 4.0 } else { 3.5 };
            let wood = surface(c);
            m.bx(wood, [-w / 2.0, h - top, -d / 2.0], [w / 2.0, h, d / 2.0]);
            let leg = (w.min(d) * 0.07).clamp(3.0, 6.0);
            m.legs(wood, leg / 2.0 + 2.0, leg, h - top);
            if f.kind == Kind::Desk || f.kind == Kind::Console {
                let dw = (w * 0.3).min(45.0);
                m.bx(
                    wood,
                    [w / 2.0 - dw - 3.0, h - 16.0, -d / 2.0 + 3.0],
                    [w / 2.0 - 3.0, h - top, d / 2.0 - 2.0],
                );
                let front = Material::satin(shade(c, 1.04));
                m.bx(
                    front,
                    [w / 2.0 - dw - 2.5, h - 15.0, d / 2.0 - 2.0],
                    [w / 2.0 - 3.5, h - top - 1.0, d / 2.0 - 1.0],
                );
            } else if f.kind == Kind::Table && h > 30.0 {
                m.bx(
                    wood,
                    [-w / 2.0 + 4.0, 10.0, -d / 2.0 + 4.0],
                    [w / 2.0 - 4.0, 12.0, d / 2.0 - 4.0],
                );
            }
        }
        Kind::Tv => {
            let screen_h = (h - 8.0).max(h * 0.8);
            let wall = variant == Some("mural");
            let z = if wall { -d / 2.0 + 3.0 } else { 0.0 };
            let y0 = if wall { 0.0 } else { h - screen_h };
            m.bx(
                Material::metal(DARK),
                [-w / 2.0, y0, z - 2.5],
                [w / 2.0, y0 + screen_h, z + 2.5],
            );
            m.bx(
                SCREEN,
                [-w / 2.0 + 1.5, y0 + 1.5, z + 2.5],
                [w / 2.0 - 1.5, y0 + screen_h - 1.5, z + 2.7],
            );
            if !wall {
                m.blk(
                    Material::metal(DARK),
                    [0.0, 0.0, z],
                    [w * 0.3, 1.5, d.min(25.0)],
                );
                m.blk(
                    Material::metal(DARK),
                    [0.0, 0.0, z - 1.0],
                    [6.0, y0 + 2.0, 3.0],
                );
            }
        }
        Kind::Plant => plant(m, variant),
        Kind::Bed => bed(m, variant == Some("metal")),
        Kind::Nightstand => {
            let wood = surface(c);
            m.bx(wood, [-w / 2.0, 6.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
            m.legs(wood, 3.0, 3.0, 6.0);
            let rows = match variant {
                Some("3-tiroirs") => 3,
                Some("1-tiroir") => 1,
                _ => 2,
            };
            m.fronts(Material::satin(shade(c, 1.05)), 8.0, h - 2.0, 1, rows, true);
            // The bedside lamp on top.
            let lamp_h = 32.0_f64.min(m.ceiling + 30.0);
            let top = h;
            m.cyl(
                Material::ceramic(Rgb8::from_u32(0xe9e4d8)),
                [0.0, top, -d * 0.1],
                [5.0, 3.0],
                12.0,
            );
            m.rod(
                Material::metal(GOLD),
                [0.0, top + 12.0, -d * 0.1],
                [0.0, top + lamp_h - 12.0, -d * 0.1],
                0.6,
            );
            let glow = m.glow(Rgb8::from_u32(0xf4ecd8));
            m.cyl(
                glow,
                [0.0, top + lamp_h - 16.0, -d * 0.1],
                [10.0, 7.0],
                15.0,
            );
            m.bulbs.push([0.0, top + lamp_h - 9.0, -d * 0.1]);
        }
        Kind::Dresser | Kind::Shoecab | Kind::Cabinet => {
            let wood = surface(c);
            let feet = if f.kind == Kind::Cabinet { 0.0 } else { 8.0 };
            m.bx(wood, [-w / 2.0, feet, -d / 2.0], [w / 2.0, h, d / 2.0]);
            if feet > 0.0 {
                m.legs(Material::wood(shade(c, 0.7)), 4.0, 4.0, feet);
            }
            let front = Material::satin(shade(c, 1.04));
            let cols = if w > 60.0 { 2 } else { 1 };
            match f.kind {
                Kind::Dresser => {
                    m.fronts(front, feet + 2.0, h - 3.0, cols, 3, true);
                    if variant == Some("ancien") {
                        m.bx(
                            wood,
                            [-w / 2.0 - 1.5, h, -d / 2.0 - 1.0],
                            [w / 2.0 + 1.5, h + 2.5, d / 2.0 + 1.5],
                        );
                    }
                }
                Kind::Shoecab => m.fronts(front, feet + 2.0, h - 2.0, cols, 2, true),
                _ => m.fronts(front, 1.0, h - 1.0, cols, 1, true),
            }
        }
        Kind::Chair => chair(m),
        Kind::Officechair => office_chair(m),
        Kind::Stairs => stairs(m),
        Kind::Bookcase | Kind::Shelf | Kind::Openshelf | Kind::Barrister => {
            shelves(m, f.kind, variant)
        }
        Kind::Counter | Kind::Sink | Kind::Stove | Kind::Dishwasher => kitchen(m, f.kind),
        Kind::Fridge => {
            let body = Material::satin(c);
            m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0 - 2.0]);
            let split = h * 0.62;
            for (y0, y1) in [(1.0, split - 0.5), (split + 0.5, h - 1.0)] {
                m.bx(
                    body,
                    [-w / 2.0 + 0.5, y0, d / 2.0 - 2.0],
                    [w / 2.0 - 0.5, y1, d / 2.0],
                );
                m.bx(
                    Material::metal(STEEL),
                    [w / 2.0 - 6.0, y0 + 5.0, d / 2.0],
                    [w / 2.0 - 4.0, (y0 + 35.0).min(y1 - 5.0), d / 2.0 + 3.0],
                );
            }
        }
        Kind::Bathtub => {
            let enamel = Material::ceramic(c);
            m.bx(enamel, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
            m.bx(
                Material::ceramic(shade(c, 0.9)),
                [-w / 2.0 + 6.0, h - 0.5, -d / 2.0 + 6.0],
                [w / 2.0 - 6.0, h + 0.1, d / 2.0 - 6.0],
            );
            m.rod(
                Material::metal(CHROME),
                [-w / 2.0 + 10.0, h, 0.0],
                [-w / 2.0 + 10.0, h + 12.0, 0.0],
                1.2,
            );
            m.rod(
                Material::metal(CHROME),
                [-w / 2.0 + 10.0, h + 12.0, 0.0],
                [-w / 2.0 + 18.0, h + 12.0, 0.0],
                1.0,
            );
        }
        Kind::Vanity => {
            let body = surface(c);
            m.bx(
                body,
                [-w / 2.0, 15.0, -d / 2.0],
                [w / 2.0, h - 4.0, d / 2.0],
            );
            m.fronts(
                Material::satin(shade(c, 1.04)),
                16.0,
                h - 5.0,
                if w > 70.0 { 2 } else { 1 },
                1,
                true,
            );
            m.bx(
                Material::ceramic(WHITE),
                [-w / 2.0, h - 4.0, -d / 2.0],
                [w / 2.0, h, d / 2.0 + 1.0],
            );
            m.bx(
                Material::ceramic(shade(WHITE, 0.88)),
                [-w / 2.0 + 8.0, h - 0.3, -d / 2.0 + 10.0],
                [w / 2.0 - 8.0, h + 0.05, d / 2.0 - 5.0],
            );
            faucet(m, [0.0, h, -d / 2.0 + 5.0]);
        }
        Kind::Linen => {
            let body = surface(c);
            m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
            m.fronts(
                Material::satin(shade(c, 1.04)),
                6.0,
                h - 3.0,
                if w > 50.0 { 2 } else { 1 },
                1,
                true,
            );
            if variant == Some("armoire") {
                m.bx(
                    body,
                    [-w / 2.0 - 2.0, h - 6.0, -d / 2.0 - 1.0],
                    [w / 2.0 + 2.0, h, d / 2.0 + 2.0],
                );
            }
        }
        Kind::Toilet => {
            let porcelain = Material::ceramic(c);
            m.p.material = porcelain;
            m.p.ellipse_cylinder(
                &m.x,
                [0.0, 0.0, d * 0.08],
                [w * 0.28, d * 0.25],
                [w * 0.36, d * 0.33],
                38.0_f64.min(h * 0.55),
                ROUND,
                true,
            );
            let seat = 40.0_f64.min(h * 0.55);
            m.p.ellipse_cylinder(
                &m.x,
                [0.0, seat, d * 0.08],
                [w * 0.48, d * 0.36],
                [w * 0.48, d * 0.36],
                3.0,
                ROUND,
                true,
            );
            m.bx(
                porcelain,
                [-w / 2.0, seat, -d / 2.0],
                [w / 2.0, h, -d / 2.0 + 18.0],
            );
        }
        Kind::Washer | Kind::Dryer => {
            let body = Material::satin(c);
            m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
            m.bx(
                Material::satin(shade(c, 0.92)),
                [-w / 2.0 + 2.0, h - 14.0, d / 2.0],
                [w / 2.0 - 2.0, h - 2.0, d / 2.0 + 0.5],
            );
            let r = (w.min(h) * 0.27).min(25.0);
            let cy = (h - 14.0) / 2.0 + 2.0;
            m.p.material = Material::metal(CHROME);
            let door =
                m.x.translated([0.0, cy, d / 2.0])
                    .turned_x(std::f64::consts::FRAC_PI_2);
            m.p.cylinder(&door, [0.0; 3], [r, r], 2.5, ROUND, true);
            m.p.material = if f.kind == Kind::Washer {
                Material::new(Rgb8::from_u32(0x26302f), 0.1, Surface::Screen)
            } else {
                Material::satin(shade(c, 0.85))
            };
            m.p.cylinder(&door, [0.0; 3], [r * 0.78, r * 0.78], 3.0, ROUND, true);
        }
        Kind::Bin => {
            m.cyl(Material::metal(c), [0.0; 3], [w * 0.42, w * 0.48], h - 3.0);
            m.cyl(
                Material::metal(shade(c, 0.8)),
                [0.0, h - 3.0, 0.0],
                [w * 0.49, w * 0.47],
                3.0,
            );
        }
        Kind::Cart => {
            let metal = Material::metal(c);
            for y in [12.0, h * 0.5, h - 2.0] {
                m.bx(metal, [-w / 2.0, y - 2.0, -d / 2.0], [w / 2.0, y, d / 2.0]);
            }
            for sx in [-1.0, 1.0] {
                for sz in [-1.0, 1.0] {
                    m.rod(
                        metal,
                        [sx * (w / 2.0 - 1.5), 6.0, sz * (d / 2.0 - 1.5)],
                        [sx * (w / 2.0 - 1.5), h, sz * (d / 2.0 - 1.5)],
                        1.0,
                    );
                    m.sph(
                        Material::metal(DARK),
                        [sx * (w / 2.0 - 3.0), 3.0, sz * (d / 2.0 - 3.0)],
                        [3.0, 3.0, 3.0],
                    );
                }
            }
        }
        Kind::Hood => {
            let steel = Material::metal(c);
            m.bx(steel, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
            let chimney = m.ceiling;
            if chimney > 2.0 {
                m.bx(
                    steel,
                    [-w * 0.2, h, -d / 2.0],
                    [w * 0.2, h + chimney, -d / 2.0 + d * 0.5],
                );
            }
        }
        Kind::Soffit => m.bx(
            Material::paint(c),
            [-w / 2.0, 0.0, -d / 2.0],
            [w / 2.0, h, d / 2.0],
        ),
        Kind::Backsplash => m.bx(
            Material::new(c, 0.2, Surface::Subway),
            [-w / 2.0, 0.0, -d / 2.0],
            [w / 2.0, h, d / 2.0],
        ),
        Kind::Heater => {
            let paint = Material::satin(c);
            let fins = ((w / 6.0).floor().max(2.0)) as usize;
            #[allow(clippy::cast_precision_loss)]
            let step = w / fins as f64;
            for k in 0..fins {
                #[allow(clippy::cast_precision_loss)]
                let x0 = -w / 2.0 + step * k as f64;
                m.bx(
                    paint,
                    [x0 + 0.6, 0.0, -d / 2.0],
                    [x0 + step - 0.6, h, d / 2.0],
                );
            }
            m.bx(
                paint,
                [-w / 2.0, h * 0.15, -d / 4.0],
                [w / 2.0, h * 0.3, d / 4.0],
            );
            m.bx(
                paint,
                [-w / 2.0, h * 0.7, -d / 4.0],
                [w / 2.0, h * 0.85, d / 4.0],
            );
        }
        Kind::Curtain => {
            let open = m.open.unwrap_or_else(|| f.curtain_open_fraction());
            curtain(m, open);
        }
        Kind::Frame | Kind::Gallery | Kind::Mirror => pictures(m, f.kind, variant),
        Kind::Chandelier | Kind::Pendant | Kind::Spot | Kind::Ceilinglight | Kind::Fan => {
            ceiling_light(m, f.kind, variant);
        }
        Kind::Lamp | Kind::Tablelamp | Kind::Lantern | Kind::Desklamp => standing_light(m, f.kind),
        Kind::Trunk => {
            let wood = Material::wood(c);
            m.bx(
                wood,
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, h * 0.75, d / 2.0],
            );
            m.bx(
                Material::wood(shade(c, 1.08)),
                [-w / 2.0 - 0.5, h * 0.75, -d / 2.0 - 0.5],
                [w / 2.0 + 0.5, h, d / 2.0 + 0.5],
            );
            let iron = Material::metal(Rgb8::from_u32(0x3a3632));
            for x0 in [-w / 2.0 + 12.0, w / 2.0 - 15.0] {
                m.bx(
                    iron,
                    [x0, -0.1, -d / 2.0 - 0.8],
                    [x0 + 3.0, h + 0.6, d / 2.0 + 0.8],
                );
            }
            m.bx(
                Material::metal(GOLD),
                [-3.0, h * 0.62, d / 2.0],
                [3.0, h * 0.78, d / 2.0 + 1.0],
            );
        }
        Kind::Stand | Kind::Roundtable => {
            let top_m = if variant == Some("marbre") {
                Material::new(Rgb8::from_u32(0xe8e6e1), 0.25, Surface::Matte)
            } else {
                surface(c)
            };
            if f.kind == Kind::Roundtable {
                m.p.material = top_m;
                m.p.ellipse_cylinder(
                    &m.x,
                    [0.0, h - 3.0, 0.0],
                    [w / 2.0, d / 2.0],
                    [w / 2.0, d / 2.0],
                    3.0,
                    24,
                    true,
                );
                m.cyl(Material::metal(c), [0.0; 3], [w * 0.25, 2.0], 2.0);
                m.cyl(Material::metal(c), [0.0, 2.0, 0.0], [2.0, 2.0], h - 5.0);
            } else {
                m.bx(top_m, [-w / 2.0, h - 3.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
                if variant == Some("epingle") {
                    let iron = Material::metal(DARK);
                    for sx in [-1.0, 1.0] {
                        for sz in [-1.0, 1.0] {
                            let (x0, z0) = (sx * (w / 2.0 - 4.0), sz * (d / 2.0 - 4.0));
                            m.rod(iron, [x0, 0.0, z0], [x0 * 0.8, h - 3.0, z0], 0.6);
                            m.rod(
                                iron,
                                [x0 - sx * 3.0, 0.0, z0],
                                [x0 * 0.8 - sx * 3.0, h - 3.0, z0],
                                0.6,
                            );
                        }
                    }
                } else {
                    m.legs(surface(c), 3.0, 3.5, h - 3.0);
                    m.bx(
                        surface(c),
                        [-w / 2.0 + 3.0, h * 0.25, -d / 2.0 + 3.0],
                        [w / 2.0 - 3.0, h * 0.25 + 2.0, d / 2.0 - 3.0],
                    );
                }
            }
        }
        Kind::Printer => {
            let body = Material::satin(c);
            m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
            m.bx(
                Material::metal(DARK),
                [-w / 2.0 + 6.0, h * 0.45, d / 2.0],
                [w / 2.0 - 6.0, h * 0.55, d / 2.0 + 0.5],
            );
            m.bx(
                Material::paint(WHITE),
                [-w * 0.3, h, -d / 2.0 + 2.0],
                [w * 0.3, h + 0.6, -d / 2.0 + 14.0],
            );
        }
        Kind::Conduit => {
            m.p.material = Material::metal(c);
            let tube =
                m.x.translated([-w / 2.0, h / 2.0, 0.0])
                    .turned_z(-std::f64::consts::FRAC_PI_2);
            m.p.cylinder(&tube, [0.0; 3], [h / 2.0, h / 2.0], w, 10, true);
        }
        Kind::Printer3d => printer3d(m, variant),
        Kind::Custom => {
            let drawn = match m.file.take() {
                Some((mesh, z_up)) => {
                    imported::draw(m, &mesh, z_up);
                    true
                }
                None => f
                    .model
                    .as_ref()
                    .and_then(|id| plan.models.get(id))
                    .is_some_and(|model| kit::draw(m, model)),
            };
            if !drawn {
                m.bx(
                    Material::paint(c),
                    [-w / 2.0, 0.0, -d / 2.0],
                    [w / 2.0, h, d / 2.0],
                );
            }
        }
    }
}

fn sofa(m: &mut Model<'_>, leather: bool, seats: Option<usize>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let fabric = if leather {
        Material::new(c, 0.5, Surface::Matte)
    } else {
        Material::fabric(c)
    };
    let cushion = Material {
        color: shade(c, 1.07),
        ..fabric
    };
    let arm = (w * 0.12).min(17.0);
    let back = (d * 0.25).min(20.0);
    let leg_h = 9.0;
    let seat_top = (h * 0.55).min(46.0);
    let base_top = seat_top - 12.0;
    let leg = Material::wood(WOOD_DARK);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.cyl(
                leg,
                [sx * (w / 2.0 - 7.0), 0.0, sz * (d / 2.0 - 6.0)],
                [1.8, 1.4],
                leg_h,
            );
        }
    }
    m.bx(
        fabric,
        [-w / 2.0, leg_h, -d / 2.0],
        [w / 2.0, base_top, d / 2.0],
    );
    let arm_top = (h * 0.74).min(seat_top + 18.0);
    for sx in [-1.0, 1.0] {
        let x0 = sx * (w / 2.0 - arm / 2.0);
        m.bx(
            fabric,
            [x0 - arm / 2.0, leg_h, -d / 2.0],
            [x0 + arm / 2.0, arm_top, d / 2.0],
        );
    }
    m.bx(
        fabric,
        [-w / 2.0 + arm, leg_h, -d / 2.0],
        [w / 2.0 - arm, h, -d / 2.0 + back],
    );
    let inner = w - 2.0 * arm;
    let n = seats.unwrap_or(if inner > 150.0 {
        3
    } else if inner > 85.0 {
        2
    } else {
        1
    });
    #[allow(clippy::cast_precision_loss)]
    let cw = inner / n as f64;
    for i in 0..n {
        #[allow(clippy::cast_precision_loss)]
        let x = -inner / 2.0 + cw * (i as f64 + 0.5);
        m.bx(
            cushion,
            [x - cw / 2.0 + 0.6, base_top, -d / 2.0 + back],
            [x + cw / 2.0 - 0.6, seat_top, d / 2.0 - 1.0],
        );
        let bh = h - seat_top - 3.0;
        if bh > 8.0 {
            m.bx(
                cushion,
                [x - cw / 2.0 + 1.0, seat_top, -d / 2.0 + back],
                [x + cw / 2.0 - 1.0, seat_top + bh, -d / 2.0 + back + 13.0],
            );
        }
    }
}

/// Stairs to another storey (`DECISIONS.md`, D-026): solid steps of about 18 cm, rising from the
/// front of the piece (local +z) to its back.
fn stairs(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let steps = ((h / 18.0).round() as usize).clamp(3, 24);
    #[allow(clippy::cast_precision_loss)]
    let (rise, run) = (h / steps as f64, d / steps as f64);
    let wood = surface(c);
    let riser = Material::satin(shade(c, 0.86));
    for i in 0..steps {
        #[allow(clippy::cast_precision_loss)]
        let k = i as f64;
        let front = d / 2.0 - run * k;
        // The tread, and the riser under its front edge.
        m.bx(
            wood,
            [-w / 2.0, 0.0, front - run],
            [w / 2.0, rise * (k + 1.0), front],
        );
        m.bx(
            riser,
            [-w / 2.0 + 0.5, rise * k, front - 0.5],
            [w / 2.0 - 0.5, rise * (k + 1.0) - 1.0, front + 0.3],
        );
    }
}

fn chair(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    let seat_h = (h * 0.57).min(46.0);
    m.legs(wood, 3.5, 3.0, seat_h - 3.0);
    m.bx(
        wood,
        [-w / 2.0 + 2.0, seat_h - 4.0, -d / 2.0 + 2.0],
        [w / 2.0 - 2.0, seat_h - 1.0, d / 2.0 - 2.0],
    );
    m.bx(
        Material::fabric(Rgb8::from_u32(0x1f1d1c)),
        [-w / 2.0 + 3.0, seat_h - 1.0, -d / 2.0 + 4.0],
        [w / 2.0 - 3.0, seat_h + 2.5, d / 2.0 - 3.0],
    );
    for sx in [-1.0, 1.0] {
        let x0 = sx * (w / 2.0 - 3.5);
        m.bx(
            wood,
            [x0 - 1.5, seat_h - 3.0, -d / 2.0 + 2.0],
            [x0 + 1.5, h, -d / 2.0 + 5.0],
        );
    }
    m.bx(
        wood,
        [-w / 2.0 + 2.0, h - 14.0, -d / 2.0 + 2.0],
        [w / 2.0 - 2.0, h - 2.0, -d / 2.0 + 4.5],
    );
}

fn office_chair(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let dark = Material::metal(DARK);
    let r = w.min(d) / 2.0 - 2.0;
    for k in 0..5 {
        let a = f64::from(k) * std::f64::consts::TAU / 5.0;
        let (s, co) = a.sin_cos();
        m.rod(dark, [0.0, 7.0, 0.0], [co * r, 5.0, s * r], 1.5);
        m.sph(dark, [co * r, 2.5, s * r], [2.5, 2.5, 2.5]);
    }
    let seat = (h * 0.45).min(50.0);
    m.cyl(
        Material::metal(CHROME),
        [0.0, 6.0, 0.0],
        [2.0, 2.0],
        seat - 10.0,
    );
    let fabric = Material::fabric(c);
    m.bx(
        fabric,
        [-w / 2.0 + 4.0, seat - 6.0, -d / 2.0 + 6.0],
        [w / 2.0 - 4.0, seat, d / 2.0 - 3.0],
    );
    m.bx(
        dark,
        [-2.0, seat - 4.0, -d / 2.0 + 4.0],
        [2.0, seat + 8.0, -d / 2.0 + 7.0],
    );
    m.bx(
        fabric,
        [-w / 2.0 + 6.0, seat + 6.0, -d / 2.0 + 3.0],
        [w / 2.0 - 6.0, h, -d / 2.0 + 8.0],
    );
    for sx in [-1.0, 1.0] {
        let x0 = sx * (w / 2.0 - 5.0);
        m.bx(
            dark,
            [x0 - 1.5, seat, -d / 4.0],
            [x0 + 1.5, seat + 18.0, -d / 4.0 + 3.0],
        );
        m.bx(
            dark,
            [x0 - 2.5, seat + 18.0, -d / 4.0 - 4.0],
            [x0 + 2.5, seat + 20.0, d / 4.0],
        );
    }
}

fn bed(m: &mut Model<'_>, metal: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let frame = if metal {
        Material::metal(Rgb8::from_u32(0x47494b))
    } else {
        Material::wood(Rgb8::from_u32(0x8a6a4a))
    };
    let mattress_top = h;
    let mattress = Material::fabric(Rgb8::from_u32(0xf3f1ec));
    if metal {
        for sx in [-1.0, 1.0] {
            m.bx(
                frame,
                [sx * (w / 2.0) - 1.25, 16.0, -d / 2.0],
                [sx * (w / 2.0) + 1.25, 21.0, d / 2.0],
            );
        }
        for (z, top) in [(-d / 2.0 + 1.6, h + 46.0), (d / 2.0 - 1.6, h + 12.0)] {
            for sx in [-1.0, 1.0] {
                m.cyl(frame, [sx * (w / 2.0 - 1.6), 0.0, z], [1.6, 1.6], top);
            }
            m.rod(
                frame,
                [-w / 2.0 + 1.6, top - 2.0, z],
                [w / 2.0 - 1.6, top - 2.0, z],
                1.3,
            );
            m.rod(
                frame,
                [-w / 2.0 + 1.6, 20.0, z],
                [w / 2.0 - 1.6, 20.0, z],
                1.1,
            );
            let mut x = -w / 2.0 + 15.0;
            while x <= w / 2.0 - 14.0 {
                m.rod(frame, [x, 20.0, z], [x, top - 2.0, z], 0.8);
                x += 13.0;
            }
        }
    } else {
        m.bx(
            frame,
            [-w / 2.0, 8.0, -d / 2.0],
            [w / 2.0, (h - 22.0).max(20.0), d / 2.0],
        );
        m.legs(frame, 4.0, 5.0, 8.0);
        m.bx(
            frame,
            [-w / 2.0, 0.0, -d / 2.0],
            [w / 2.0, h + 45.0, -d / 2.0 + 6.0],
        );
    }
    let low = (h - 22.0).max(20.0);
    m.bx(
        mattress,
        [-w / 2.0 + 2.0, low, -d / 2.0 + 6.0],
        [w / 2.0 - 2.0, mattress_top, d / 2.0 - 1.0],
    );
    // Duvet over the lower two thirds, and pillows.
    let duvet = Material::fabric(c);
    m.bx(
        duvet,
        [-w / 2.0 + 1.0, mattress_top - 6.0, -d / 2.0 + d * 0.35],
        [w / 2.0 - 1.0, mattress_top + 3.0, d / 2.0],
    );
    let pillows = if w > 120.0 { 2 } else { 1 };
    #[allow(clippy::cast_precision_loss)]
    let pw = (w - 12.0) / f64::from(pillows);
    for k in 0..pillows {
        let x0 = -w / 2.0 + 6.0 + pw * f64::from(k);
        m.sph(
            Material::fabric(WHITE),
            [x0 + pw / 2.0, mattress_top + 4.0, -d / 2.0 + 22.0],
            [pw / 2.0 - 3.0, 6.0, 15.0],
        );
    }
}

fn plant(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, h, c) = (m.w, m.h, m.c);
    let r = w.min(m.d) / 2.0;
    let pot_h = (h * 0.3).clamp(10.0, 45.0);
    m.cyl(
        Material::ceramic(Rgb8::from_u32(0xd9d2c3)),
        [0.0; 3],
        [r * 0.7, r * 0.9],
        pot_h,
    );
    m.cyl(
        Material::paint(Rgb8::from_u32(0x4a3a2a)),
        [0.0, pot_h - 0.5, 0.0],
        [r * 0.85, r * 0.85],
        0.6,
    );
    let leaf = Material::new(
        if c == Rgb8::from_u32(0x536c42) {
            LEAF
        } else {
            c
        },
        0.7,
        Surface::Leaf,
    );
    let top = h - pot_h;
    match variant {
        Some("dracaena") => {
            for k in 0..3 {
                let x = (f64::from(k) - 1.0) * r * 0.3;
                let stem_top = pot_h + top * (0.55 + 0.15 * f64::from(k % 2));
                m.rod(
                    Material::wood(Rgb8::from_u32(0x6a5038)),
                    [x, pot_h, 0.0],
                    [x, stem_top, 0.0],
                    1.4,
                );
                m.sph(
                    leaf,
                    [x, stem_top + top * 0.12, 0.0],
                    [r * 0.6, top * 0.18, r * 0.6],
                );
            }
        }
        Some("pothos") => {
            m.sph(
                leaf,
                [0.0, pot_h + 4.0, 0.0],
                [r * 1.05, top * 0.35, r * 1.05],
            );
            for k in 0..5 {
                let a = f64::from(k) * 1.3;
                let (s, co) = a.sin_cos();
                m.sph(
                    leaf,
                    [co * r * 0.9, pot_h - top * 0.15, s * r * 0.9],
                    [r * 0.25, top * 0.3, r * 0.25],
                );
            }
        }
        _ => {
            let n = 7;
            for k in 0..n {
                let a = f64::from(k) / f64::from(n) * std::f64::consts::TAU + m.rng.next();
                let (s, co) = a.sin_cos();
                let reach = r * (0.6 + 0.5 * m.rng.next());
                let y = pot_h + top * (0.45 + 0.45 * m.rng.next());
                let stem = Material::wood(Rgb8::from_u32(0x5b6b3c));
                m.rod(
                    stem,
                    [0.0, pot_h, 0.0],
                    [co * reach * 0.7, y, s * reach * 0.7],
                    0.6,
                );
                m.sph(
                    leaf,
                    [co * reach, y, s * reach],
                    [r * 0.45, 1.5_f64.max(top * 0.05), r * 0.35],
                );
            }
            m.sph(
                leaf,
                [0.0, pot_h + top * 0.35, 0.0],
                [r * 0.6, top * 0.3, r * 0.6],
            );
        }
    }
}

fn shelves(m: &mut Model<'_>, kind: Kind, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = kind == Kind::Openshelf && variant == Some("metal");
    let body = if metal {
        Material::metal(c)
    } else {
        surface(c)
    };
    let t = if metal { 1.5 } else { 2.0 };
    let open = kind == Kind::Openshelf || kind == Kind::Shelf;
    if open {
        for sx in [-1.0, 1.0] {
            for sz in [-1.0, 1.0] {
                m.bx(
                    body,
                    [
                        sx * (w / 2.0) - t / 2.0 * (1.0 + sx),
                        0.0,
                        sz * (d / 2.0) - t / 2.0 * (1.0 + sz),
                    ],
                    [
                        sx * (w / 2.0) + t / 2.0 * (1.0 - sx),
                        h,
                        sz * (d / 2.0) + t / 2.0 * (1.0 - sz),
                    ],
                );
            }
        }
    } else {
        m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [-w / 2.0 + t, h, d / 2.0]);
        m.bx(body, [w / 2.0 - t, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
        m.bx(
            body,
            [-w / 2.0, 0.0, -d / 2.0],
            [w / 2.0, h, -d / 2.0 + 1.0],
        );
        m.bx(body, [-w / 2.0, h - t, -d / 2.0], [w / 2.0, h, d / 2.0]);
    }
    let levels = ((h / 35.0).round() as usize).clamp(2, 8);
    #[allow(clippy::cast_precision_loss)]
    let step = (h - 6.0) / levels as f64;
    for k in 0..levels {
        #[allow(clippy::cast_precision_loss)]
        let y = 4.0 + step * k as f64;
        m.bx(
            body,
            [-w / 2.0 + t, y, -d / 2.0 + 1.0],
            [w / 2.0 - t, y + t, d / 2.0],
        );
        // Books on most shelves.
        if kind != Kind::Shelf && m.rng.next() > 0.2 && step > 18.0 {
            let mut x = -w / 2.0 + t + 1.0;
            let end = w / 2.0 - t - 1.0 - (m.rng.next() * w * 0.3);
            while x < end {
                let bw = 2.0 + m.rng.next() * 3.0;
                let bh = (step - 6.0) * (0.65 + m.rng.next() * 0.3);
                let palette = [
                    0x8b3a2e, 0x2f4f6f, 0xd8c9a3, 0x3d5a40, 0x6b4f7a, 0xc98b3c, 0x2b2b2b, 0xe6e1d6,
                ];
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let color = palette[(m.rng.next() * palette.len() as f64) as usize % palette.len()];
                let book = Material::new(Rgb8::from_u32(color), 0.8, Surface::Matte);
                m.bx(
                    book,
                    [x, y + t, -d / 2.0 + 3.0],
                    [x + bw - 0.3, y + t + bh, d / 2.0 - 4.0],
                );
                x += bw;
            }
        }
    }
    if kind == Kind::Barrister {
        // Glass doors on each section.
        for k in 0..levels {
            #[allow(clippy::cast_precision_loss)]
            let y = 4.0 + step * k as f64 + t;
            m.bx(
                Material::glass(),
                [-w / 2.0 + t, y + 1.0, d / 2.0 - 1.0],
                [w / 2.0 - t, y + step - t - 1.0, d / 2.0 - 0.5],
            );
            m.bx(
                body,
                [-w / 2.0 + t, y + step - t - 3.0, d / 2.0 - 1.5],
                [w / 2.0 - t, y + step - t, d / 2.0],
            );
        }
    }
}

fn faucet(m: &mut Model<'_>, at: V3) {
    let chrome = Material::metal(CHROME);
    m.cyl(chrome, at, [1.6, 1.4], 16.0);
    m.rod(
        chrome,
        [at[0], at[1] + 15.0, at[2]],
        [at[0], at[1] + 15.0, at[2] + 13.0],
        1.1,
    );
}

fn kitchen(m: &mut Model<'_>, kind: Kind) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let plinth = 10.0;
    let top_t = 4.0;
    let body = Material::satin(c);
    m.bx(
        Material::paint(shade(c, 0.6)),
        [-w / 2.0 + 1.0, 0.0, -d / 2.0],
        [w / 2.0 - 1.0, plinth, d / 2.0 - 5.0],
    );
    m.bx(
        body,
        [-w / 2.0, plinth, -d / 2.0],
        [w / 2.0, h - top_t, d / 2.0 - 2.0],
    );
    let worktop = STONE;
    match kind {
        Kind::Stove => {
            m.bx(
                Material::metal(c),
                [-w / 2.0, plinth, d / 2.0 - 2.0],
                [w / 2.0, h - top_t, d / 2.0 - 1.0],
            );
            m.bx(
                SCREEN,
                [-w / 2.0 + 5.0, plinth + 8.0, d / 2.0 - 1.0],
                [w / 2.0 - 5.0, h - top_t - 18.0, d / 2.0 - 0.5],
            );
            m.bx(
                Material::metal(STEEL),
                [-w / 2.0 + 6.0, h - top_t - 12.0, d / 2.0 - 0.5],
                [w / 2.0 - 6.0, h - top_t - 10.0, d / 2.0 + 2.0],
            );
            m.bx(
                SCREEN,
                [-w / 2.0, h - top_t, -d / 2.0],
                [w / 2.0, h, d / 2.0],
            );
            for (sx, sz) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
                m.cyl(
                    Material::metal(Rgb8::from_u32(0x3a3d40)),
                    [sx * w * 0.22, h, sz * d * 0.2],
                    [w * 0.1, w * 0.1],
                    0.4,
                );
            }
        }
        Kind::Dishwasher => {
            m.bx(
                Material::metal(c),
                [-w / 2.0 + 0.5, plinth + 0.5, d / 2.0 - 2.0],
                [w / 2.0 - 0.5, h - top_t - 0.5, d / 2.0],
            );
            m.bx(
                Material::metal(DARK),
                [-w / 2.0 + 4.0, h - top_t - 8.0, d / 2.0],
                [w / 2.0 - 4.0, h - top_t - 3.0, d / 2.0 + 0.6],
            );
            m.bx(
                worktop,
                [-w / 2.0, h - top_t, -d / 2.0],
                [w / 2.0, h, d / 2.0],
            );
        }
        _ => {
            let cols = ((w / 50.0).round() as usize).clamp(1, 6);
            m.fronts(
                Material::satin(shade(c, 1.03)),
                plinth + 1.0,
                h - top_t - 1.0,
                cols,
                1,
                true,
            );
            m.bx(
                worktop,
                [-w / 2.0, h - top_t, -d / 2.0],
                [w / 2.0, h, d / 2.0],
            );
            if kind == Kind::Sink {
                let bw = (w * 0.45).min(50.0);
                m.bx(
                    Material::metal(CHROME),
                    [-bw / 2.0, h - 0.6, -d / 2.0 + 8.0],
                    [bw / 2.0, h + 0.05, d / 2.0 - 8.0],
                );
                m.bx(
                    Material::metal(Rgb8::from_u32(0x8f9493)),
                    [-bw / 2.0 + 2.0, h - 0.5, -d / 2.0 + 10.0],
                    [bw / 2.0 - 2.0, h + 0.1, d / 2.0 - 10.0],
                );
                faucet(m, [0.0, h, -d / 2.0 + 5.0]);
            }
        }
    }
}

fn curtain(m: &mut Model<'_>, open: f64) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let rod = Material::metal(Rgb8::from_u32(0x3a3632));
    m.rod(
        rod,
        [-w / 2.0 - 6.0, h - 3.0, 0.0],
        [w / 2.0 + 6.0, h - 3.0, 0.0],
        1.0,
    );
    for sx in [-1.0, 1.0] {
        m.sph(rod, [sx * (w / 2.0 + 6.0), h - 3.0, 0.0], [2.0, 2.0, 2.0]);
    }
    let fabric = Material::fabric(c);
    // Each panel covers half the width when closed, a sixth gathered at its side when open.
    let half = w / 2.0;
    let panel = half * (1.0 - open * 0.8);
    let folds = ((panel / 9.0).ceil() as usize).max(2);
    #[allow(clippy::cast_precision_loss)]
    let step = panel / folds as f64;
    for sx in [-1.0, 1.0] {
        for k in 0..folds {
            #[allow(clippy::cast_precision_loss)]
            let x = sx * (half - step * (k as f64 + 0.5));
            let depth = (d * 0.5).max(2.0) * (1.0 + open);
            m.p.material = fabric;
            m.p.ellipse_cylinder(
                &m.x,
                [x, 2.0, 0.0],
                [step * 0.62, depth],
                [step * 0.62, depth],
                h - 6.0,
                8,
                true,
            );
        }
    }
}

fn pictures(m: &mut Model<'_>, kind: Kind, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let z0 = -d / 2.0;
    match kind {
        Kind::Mirror => {
            let frame = if variant == Some("blanc") {
                Material::satin(WHITE)
            } else {
                Material::metal(c)
            };
            m.bx(frame, [-w / 2.0, 0.0, z0], [w / 2.0, h, z0 + d]);
            m.bx(
                Material::new(Rgb8::from_u32(0xeef3f4), 0.02, Surface::Mirror),
                [-w / 2.0 + 4.0, 4.0, z0 + d],
                [w / 2.0 - 4.0, h - 4.0, z0 + d + 0.2],
            );
        }
        Kind::Gallery => {
            let cols = ((w / 40.0).round() as usize).clamp(2, 6);
            #[allow(clippy::cast_precision_loss)]
            let cw = w / cols as f64;
            for k in 0..cols {
                #[allow(clippy::cast_precision_loss)]
                let x0 = -w / 2.0 + cw * k as f64;
                let fh = h * (0.45 + 0.4 * m.rng.next());
                let y0 = (h - fh) * m.rng.next();
                picture(m, [x0 + 3.0, y0, z0], [cw - 6.0, fh, d], c);
            }
        }
        _ => {
            let art = match variant {
                Some("carte") => Rgb8::from_u32(0xd9c9a0),
                Some("bd") => Rgb8::from_u32(0xe9b949),
                Some("affiche") => Rgb8::from_u32(0xc8553d),
                Some("portrait") => Rgb8::from_u32(0x7a6a5a),
                _ => Rgb8::from_u32(0xe8e2d4),
            };
            m.bx(Material::wood(c), [-w / 2.0, 0.0, z0], [w / 2.0, h, z0 + d]);
            m.bx(
                Material::paint(Rgb8::from_u32(0xf6f3ec)),
                [-w / 2.0 + 2.5, 2.5, z0 + d],
                [w / 2.0 - 2.5, h - 2.5, z0 + d + 0.2],
            );
            m.bx(
                Material::paint(art),
                [-w / 2.0 + 6.0, 6.0, z0 + d + 0.2],
                [w / 2.0 - 6.0, h - 6.0, z0 + d + 0.35],
            );
        }
    }
}

fn picture(m: &mut Model<'_>, at: V3, size: V3, frame: Rgb8) {
    let palette = [0xc8553d, 0x2f4f6f, 0xe9b949, 0x7a9a6a, 0xd9c9a0, 0x5a4a6a];
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let art = palette[(m.rng.next() * 6.0) as usize % 6];
    m.bx(
        Material::wood(frame),
        at,
        [at[0] + size[0], at[1] + size[1], at[2] + size[2]],
    );
    m.bx(
        Material::paint(Rgb8::from_u32(art)),
        [at[0] + 2.5, at[1] + 2.5, at[2] + size[2]],
        [
            at[0] + size[0] - 2.5,
            at[1] + size[1] - 2.5,
            at[2] + size[2] + 0.2,
        ],
    );
}

fn ceiling_light(m: &mut Model<'_>, kind: Kind, variant: Option<&str>) {
    let (w, h, c) = (m.w, m.h, m.c);
    let r = w.min(m.d) / 2.0;
    let stem = m.ceiling;
    let metal = Material::metal(c);
    if stem > 0.5 && kind != Kind::Spot {
        m.rod(
            Material::metal(DARK),
            [0.0, h, 0.0],
            [0.0, h + stem, 0.0],
            0.4,
        );
        m.cyl(metal, [0.0, h + stem - 2.0, 0.0], [5.0, 5.0], 2.0);
    }
    match kind {
        Kind::Spot => {
            m.cyl(Material::metal(c), [0.0; 3], [r, r], h);
            let glow = m.glow(Rgb8::from_u32(0xf4f1e8));
            m.cyl(glow, [0.0, -0.2, 0.0], [r * 0.6, r * 0.6], 0.3);
            m.bulbs.push([0.0, -1.0, 0.0]);
        }
        Kind::Pendant => {
            let shade_m = Material::satin(c);
            if variant == Some("cylindre") {
                m.p.material = shade_m;
                m.p.cylinder(
                    &m.x,
                    [0.0, h * 0.2, 0.0],
                    [r * 0.6, r * 0.6],
                    h * 0.8,
                    ROUND,
                    false,
                );
            } else {
                m.p.material = shade_m;
                m.p.cylinder(
                    &m.x,
                    [0.0, h * 0.25, 0.0],
                    [r, r * 0.25],
                    h * 0.6,
                    ROUND,
                    false,
                );
                m.cyl(shade_m, [0.0, h * 0.85, 0.0], [r * 0.25, 2.0], h * 0.15);
            }
            m.bulb([0.0, h * 0.35, 0.0], (r * 0.18).min(6.0));
        }
        Kind::Ceilinglight => {
            m.cyl(metal, [0.0, h - 2.0, 0.0], [r * 0.6, r * 0.6], 2.0);
            let glow = m.glow(Rgb8::from_u32(0xf6f2e8));
            m.sph(glow, [0.0, h - 2.0, 0.0], [r, h - 2.0, r]);
            m.bulbs.push([0.0, h * 0.4, 0.0]);
            if variant == Some("fleurons") {
                for k in 0..6 {
                    let a = f64::from(k) * std::f64::consts::TAU / 6.0;
                    let (s, co) = a.sin_cos();
                    m.sph(
                        metal,
                        [co * r * 0.9, h - 3.0, s * r * 0.9],
                        [r * 0.25, 2.0, r * 0.25],
                    );
                }
            }
        }
        Kind::Fan => {
            m.cyl(metal, [0.0, h * 0.45, 0.0], [10.0, 9.0], h * 0.35);
            for k in 0..5 {
                let a = f64::from(k) * std::f64::consts::TAU / 5.0;
                let blade = m.x.translated([0.0, h * 0.55, 0.0]).turned_y(a);
                m.p.material = Material::wood(Rgb8::from_u32(0x8a6a4a));
                m.p.cuboid(&blade, [10.0, 0.0, -6.0], [r, 1.2, 6.0]);
            }
            let glow = m.glow(Rgb8::from_u32(0xf4f1e8));
            m.sph(glow, [0.0, h * 0.4, 0.0], [12.0, 8.0, 12.0]);
            m.bulbs.push([0.0, h * 0.3, 0.0]);
        }
        _ => {
            // Chandelier: a body and candle arms in a ring.
            m.cyl(metal, [0.0, h * 0.3, 0.0], [4.0, 3.0], h * 0.7);
            m.sph(metal, [0.0, h * 0.3, 0.0], [6.0, 6.0, 6.0]);
            let arms = 6;
            for k in 0..arms {
                let a = f64::from(k) * std::f64::consts::TAU / f64::from(arms);
                let (s, co) = a.sin_cos();
                let tip = [co * (r - 4.0), h * 0.3 + 6.0, s * (r - 4.0)];
                m.rod(metal, [0.0, h * 0.3, 0.0], tip, 0.7);
                m.cyl(metal, [tip[0], tip[1], tip[2]], [2.5, 2.5], 2.0);
                let flame = m.glow(Rgb8::from_u32(0xf8f4ea));
                m.cyl(
                    Material::paint(WHITE),
                    [tip[0], tip[1] + 2.0, tip[2]],
                    [1.0, 1.0],
                    6.0,
                );
                m.sph(flame, [tip[0], tip[1] + 9.5, tip[2]], [1.4, 2.4, 1.4]);
                m.bulbs.push([tip[0], tip[1] + 9.5, tip[2]]);
            }
        }
    }
}

fn standing_light(m: &mut Model<'_>, kind: Kind) {
    let (w, h, c) = (m.w, m.h, m.c);
    let r = w.min(m.d) / 2.0;
    let metal = Material::metal(c);
    match kind {
        Kind::Lamp => {
            m.cyl(Material::metal(DARK), [0.0; 3], [r * 0.6, r * 0.55], 2.5);
            m.rod(
                Material::metal(GOLD),
                [0.0, 2.5, 0.0],
                [0.0, h - 30.0, 0.0],
                1.0,
            );
            let glow = m.glow(c);
            m.p.material = glow;
            m.p.cylinder(&m.x, [0.0, h - 34.0, 0.0], [r, r * 0.7], 34.0, ROUND, true);
            m.bulbs.push([0.0, h - 20.0, 0.0]);
        }
        Kind::Tablelamp => {
            m.sph(
                Material::ceramic(c),
                [0.0, h * 0.22, 0.0],
                [r * 0.5, h * 0.22, r * 0.5],
            );
            m.rod(
                Material::metal(GOLD),
                [0.0, h * 0.4, 0.0],
                [0.0, h * 0.62, 0.0],
                0.6,
            );
            let glow = m.glow(Rgb8::from_u32(0xf4ecd8));
            m.p.material = glow;
            m.p.cylinder(
                &m.x,
                [0.0, h * 0.58, 0.0],
                [r, r * 0.65],
                h * 0.42,
                ROUND,
                true,
            );
            m.bulbs.push([0.0, h * 0.72, 0.0]);
        }
        Kind::Lantern => {
            let frame = Material::metal(c);
            m.blk(frame, [0.0; 3], [w, 2.0, m.d]);
            m.blk(frame, [0.0, h - 4.0, 0.0], [w, 2.0, m.d]);
            for sx in [-1.0, 1.0] {
                for sz in [-1.0, 1.0] {
                    m.rod(
                        frame,
                        [sx * (w / 2.0 - 1.0), 2.0, sz * (m.d / 2.0 - 1.0)],
                        [sx * (w / 2.0 - 1.0), h - 4.0, sz * (m.d / 2.0 - 1.0)],
                        0.5,
                    );
                }
            }
            m.cyl(frame, [0.0, h - 2.0, 0.0], [r * 0.5, 0.5], 2.0);
            m.bx(
                Material::glass(),
                [-w / 2.0 + 1.0, 2.0, -m.d / 2.0 + 1.0],
                [w / 2.0 - 1.0, h - 4.0, m.d / 2.0 - 1.0],
            );
            m.cyl(
                Material::paint(WHITE),
                [0.0, 2.0, 0.0],
                [r * 0.3, r * 0.3],
                h * 0.35,
            );
            let flame = m.glow(Rgb8::from_u32(0xf8f4ea));
            m.sph(flame, [0.0, 2.0 + h * 0.35 + 2.0, 0.0], [1.2, 2.2, 1.2]);
            m.bulbs.push([0.0, 2.0 + h * 0.35 + 2.0, 0.0]);
        }
        _ => {
            // Desk lamp: base, two arms, head pointing down.
            m.cyl(metal, [0.0; 3], [r, r], 2.0);
            let elbow = [0.0, h * 0.55, -r * 0.6];
            let top = [0.0, h - 4.0, r * 0.4];
            m.rod(metal, [0.0, 2.0, 0.0], elbow, 0.8);
            m.rod(metal, elbow, top, 0.8);
            m.p.material = metal;
            m.p.cylinder(
                &m.x,
                [top[0], top[1] - 6.0, top[2] + 4.0],
                [5.0, 2.0],
                8.0,
                12,
                true,
            );
            let glow = m.glow(Rgb8::from_u32(0xf4f1e8));
            m.cyl(glow, [top[0], top[1] - 6.3, top[2] + 4.0], [4.0, 4.0], 0.3);
            m.bulbs.push([top[0], top[1] - 7.0, top[2] + 4.0]);
        }
    }
}

fn printer3d(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let enclosure = matches!(variant, Some("enclosure" | "enclosure-sans-bobine"));
    let spool = !matches!(variant, Some("sans-bobine" | "enclosure-sans-bobine"));
    let frame = Material::metal(c);
    let (iw, id, ih) = if enclosure {
        (w - 8.0, d - 8.0, h - 8.0)
    } else {
        (w, d, h)
    };
    m.bx(
        frame,
        [-iw / 2.0, 0.0, -id / 2.0],
        [iw / 2.0, 6.0, id / 2.0],
    );
    m.bx(
        Material::metal(Rgb8::from_u32(0x8f9493)),
        [-iw * 0.4, 8.0, -id * 0.4],
        [iw * 0.4, 9.0, id * 0.4],
    );
    for sx in [-1.0, 1.0] {
        m.bx(
            frame,
            [sx * iw / 2.0 - 1.5, 6.0, -2.0],
            [sx * iw / 2.0 + 1.5, ih, 2.0],
        );
    }
    m.bx(
        frame,
        [-iw / 2.0, ih * 0.55, -2.0],
        [iw / 2.0, ih * 0.55 + 3.0, 2.0],
    );
    m.bx(frame, [-iw / 2.0, ih - 3.0, -2.0], [iw / 2.0, ih, 2.0]);
    m.bx(
        Material::metal(Rgb8::from_u32(0x3a3d40)),
        [-4.0, ih * 0.55 - 6.0, 2.0],
        [4.0, ih * 0.55 + 4.0, 7.0],
    );
    if spool {
        let holder =
            m.x.translated([iw / 2.0 + 1.5, ih * 0.8, 0.0])
                .turned_z(-std::f64::consts::FRAC_PI_2);
        m.p.material = Material::new(Rgb8::from_u32(0xd8572a), 0.4, Surface::Matte);
        m.p.cylinder(&holder, [0.0, 0.0, 0.0], [10.0, 10.0], 6.0, ROUND, true);
    }
    if enclosure {
        let glass = Material::glass();
        m.bx(frame, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, 3.0, d / 2.0]);
        m.bx(frame, [-w / 2.0, h - 3.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
        m.bx(
            glass,
            [-w / 2.0, 3.0, -d / 2.0],
            [w / 2.0, h - 3.0, -d / 2.0 + 0.5],
        );
        m.bx(
            glass,
            [-w / 2.0, 3.0, d / 2.0 - 0.5],
            [w / 2.0, h - 3.0, d / 2.0],
        );
        m.bx(
            glass,
            [-w / 2.0, 3.0, -d / 2.0],
            [-w / 2.0 + 0.5, h - 3.0, d / 2.0],
        );
        m.bx(
            glass,
            [w / 2.0 - 0.5, 3.0, -d / 2.0],
            [w / 2.0, h - 3.0, d / 2.0],
        );
    }
}
