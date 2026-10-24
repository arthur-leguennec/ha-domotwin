//! Doors and windows: frames, casings, sills, glass and the leaves of every door style, drawn at
//! the door's `open` fraction.

use super::Builder;
use super::mesh::{CutMode, Material, Painter, Tag, Xform};
use super::structure::TRIM;
use crate::geometry::heights::{DOOR_HEIGHT, SILL, WINDOW_TOP};
use crate::geometry::walls::{WallLayout, opening_axes};
use crate::plan::{DoorStyle, Element, Opening, Plan, Rgb8};

const DOOR: Material = Material::satin(Rgb8::from_u32(0xf3f1ea));
const KNOB: Material = Material::metal(Rgb8::from_u32(0xc7a25a));
const IRON: Material = Material::metal(Rgb8::from_u32(0x26282a));
const BLIND: Material = Material::fabric(Rgb8::from_u32(0xd9d4c8));
const BLIND_BOX: Material = Material::satin(Rgb8::from_u32(0xeceae4));
/// Leaf thickness (cm).
const LEAF: f64 = 4.0;

/// Builds every door and window of the plan (they are moving parts: see [`super::Overrides`]).
pub(crate) fn build(builder: &mut Builder, plan: &Plan, layout: &WallLayout) {
    if !builder.dynamic {
        return;
    }
    for (index, element) in plan.elements.iter().enumerate() {
        let (opening, door) = match element {
            Element::Door(o) => (o, true),
            Element::Window(o) => (o, false),
            _ => continue,
        };
        let range = layout.opening_wall_range(opening).unwrap_or_else(|| {
            let t = layout.opening_thickness(opening) / 2.0;
            [-t, t]
        });
        let group = builder.opening_groups.get(&opening.id).copied();
        let (u, n) = opening_axes(opening.angle);
        let middle = [
            opening.x + u[0] * opening.w / 2.0,
            opening.y + u[1] * opening.w / 2.0,
        ];
        // A parent room, else the room on either side of the opening.
        let room = [0.0, 25.0, -25.0]
            .into_iter()
            .map(|k| [middle[0] + n[0] * k, middle[1] + n[1] * k])
            .map(|p| builder.room_for(plan, &opening.parent, p))
            .find(|slot| *slot != 0)
            .unwrap_or(0);
        let tag = Tag {
            element: builder.element_tag(index),
            group: group.unwrap_or(super::mesh::NO_GROUP),
            cut: if group.is_some() {
                CutMode::Clamp
            } else {
                CutMode::Keep
            },
            room,
        };
        let frame = Xform::plan([opening.x, 0.0, opening.y], u);
        let open = builder.overrides.open.get(&index).copied();
        if door {
            let open = open.unwrap_or_else(|| opening.open_fraction());
            build_door(builder, opening, &frame, range, tag, open);
        } else {
            let blind = builder.overrides.blind.get(&index).copied();
            build_window(
                builder,
                opening,
                &frame,
                range,
                tag,
                open.unwrap_or(0.0),
                blind,
            );
        }
    }
}

/// A casement of a window: a light frame around its glass, `w` wide, in the frame `x` whose local
/// x runs along the pane from its hinge.
fn casement(p: &mut Painter<'_>, g: &mut Painter<'_>, x: &Xform, w: f64, y0: f64, y1: f64) {
    p.material = TRIM;
    p.cuboid(x, [0.0, y0, -2.0], [3.0, y1, 2.0]);
    p.cuboid(x, [w - 3.0, y0, -2.0], [w, y1, 2.0]);
    p.cuboid(x, [0.0, y0, -2.0], [w, y0 + 3.0, 2.0]);
    p.cuboid(x, [0.0, y1 - 3.0, -2.0], [w, y1, 2.0]);
    g.cuboid(x, [3.0, y0 + 3.0, -0.4], [w - 3.0, y1 - 3.0, 0.4]);
}

#[allow(clippy::too_many_arguments)]
fn build_window(
    builder: &mut Builder,
    o: &Opening,
    x: &Xform,
    [lo, hi]: [f64; 2],
    tag: Tag,
    open: f64,
    blind: Option<f64>,
) {
    let w = o.w;
    let fr = 5.0;
    let mid = f64::midpoint(lo, hi);
    // The room side: the narrower side of the wall range.
    let inside = if hi > -lo { -1.0 } else { 1.0 };
    let inner = if inside < 0.0 { lo } else { hi };
    let (opaque, transparent) = (&mut builder.opaque, &mut builder.transparent);
    let mut p = Painter::new(opaque, TRIM, tag);
    let mut g = Painter::new(transparent, Material::glass(), tag);
    let (d0, d1) = (lo - 0.5, hi + 0.5);
    p.cuboid(x, [0.0, SILL, d0], [fr, WINDOW_TOP, d1]);
    p.cuboid(x, [w - fr, SILL, d0], [w, WINDOW_TOP, d1]);
    p.cuboid(x, [0.0, WINDOW_TOP - fr, d0], [w, WINDOW_TOP, d1]);
    p.cuboid(x, [0.0, SILL, d0], [w, SILL + 3.0, d1]);
    let (y0, y1) = (SILL + 3.0, WINDOW_TOP - fr);
    let pane = (w - 2.0 * fr) / 2.0;
    if pane > 6.0 {
        // Two casements hinged on the jambs, opening towards the room.
        let angle = open.clamp(0.0, 1.0) * 1.25;
        let left = hinge(x, [fr, mid], 1.0, inside, angle);
        casement(&mut p, &mut g, &left, pane, y0, y1);
        let right = hinge(x, [w - fr, mid], -1.0, -inside, -angle);
        casement(&mut p, &mut g, &right, pane, y0, y1);
    } else {
        g.cuboid(x, [fr, y0, mid - 0.4], [w - fr, y1, mid + 0.4]);
    }
    // The inner sill board.
    let (a, b) = (inner, inner + inside * 5.0);
    p.material = TRIM;
    p.cuboid(x, [-4.0, SILL - 3.0, a.min(b)], [w + 4.0, SILL, a.max(b)]);
    // A roller blind on the room side, rolled up as far as `blind` says (1: fully up).
    if let Some(up) = blind {
        let (r0, r1) = (inner + inside * 1.0, inner + inside * 7.0);
        p.material = BLIND_BOX;
        p.cuboid(
            x,
            [-3.0, WINDOW_TOP - 2.0, r0.min(r1)],
            [w + 3.0, WINDOW_TOP + 6.0, r0.max(r1)],
        );
        let bottom = SILL + (WINDOW_TOP - 2.0 - SILL) * up.clamp(0.0, 1.0);
        let (f0, f1) = (inner + inside * 3.6, inner + inside * 4.4);
        p.material = BLIND;
        p.cuboid(
            x,
            [-1.0, bottom, f0.min(f1)],
            [w + 1.0, WINDOW_TOP - 2.0, f0.max(f1)],
        );
        p.material = BLIND_BOX;
        p.cuboid(
            x,
            [-1.0, bottom - 1.5, f0.min(f1) - 0.4],
            [w + 1.0, bottom, f0.max(f1) + 0.4],
        );
    }
}

/// Box between the opening-frame points `a` and `b` (`[t, d]`), from `y0` to `y1`, `thick` cm.
fn panel(p: &mut Painter<'_>, x: &Xform, a: [f64; 2], b: [f64; 2], y: [f64; 2], thick: f64) {
    let (dt, dd) = (b[0] - a[0], b[1] - a[1]);
    let len = dt.hypot(dd);
    if len < 0.1 {
        return;
    }
    let local = Xform {
        axes: [
            [dt / len, 0.0, dd / len],
            [0.0, 1.0, 0.0],
            [-dd / len, 0.0, dt / len],
        ],
        origin: [a[0], 0.0, a[1]],
    };
    p.cuboid(
        &x.then(&local),
        [0.0, y[0], -thick / 2.0],
        [len, y[1], thick / 2.0],
    );
}

/// A door leaf of width `w` in the frame `leaf` (local x along the leaf from the hinge).
fn leaf(p: &mut Painter<'_>, glass: &mut Painter<'_>, leaf: &Xform, w: f64, glazed: bool) {
    let h = DOOR_HEIGHT - 2.0;
    let t = LEAF / 2.0;
    p.material = DOOR;
    if glazed {
        let low = h * 0.42;
        p.cuboid(leaf, [0.0, 1.0, -t], [w, low, t]);
        p.cuboid(leaf, [0.0, h - 10.0, -t], [w, h, t]);
        p.cuboid(leaf, [0.0, low, -t], [9.0, h - 10.0, t]);
        p.cuboid(leaf, [w - 9.0, low, -t], [w, h - 10.0, t]);
        glass.cuboid(leaf, [9.0, low, -0.5], [w - 9.0, h - 10.0, 0.5]);
    } else {
        p.cuboid(leaf, [0.0, 1.0, -t], [w, h, t]);
        // Raised panels on both faces.
        let pw = (w - 24.0) / 2.0;
        if pw > 4.0 {
            for z in [t, -t - 0.6] {
                for (row, (py, ph)) in [
                    (12.0, h * 0.3),
                    (12.0 + h * 0.3 + 8.0, h * 0.16),
                    (h * 0.46 + 28.0, h * 0.3),
                ]
                .into_iter()
                .enumerate()
                {
                    let ph = if row == 2 { ph.min(h - py - 10.0) } else { ph };
                    for c in [0.0, 1.0] {
                        let x0 = 8.0 + c * (pw + 8.0);
                        p.cuboid(leaf, [x0, py, z], [x0 + pw, py + ph, z + 0.6]);
                    }
                }
            }
        }
    }
    p.material = KNOB;
    for z in [t + 2.5, -t - 2.5] {
        p.sphere(leaf, [w - 7.0, 95.0, z], [2.6, 2.6, 2.6], 10);
    }
    p.material = DOOR;
}

/// The frame of a leaf hinged at `[t, d]` of the opening frame, closing along `dir_t` (±1),
/// opened by `angle` radians towards `swing · n`.
fn hinge(x: &Xform, at: [f64; 2], dir_t: f64, swing: f64, angle: f64) -> Xform {
    let (s, c) = angle.sin_cos();
    let (dt, dd) = (dir_t * c, swing * s);
    // Leaves are built with local z = the leaf direction turned +90°: keep it right-handed.
    x.then(&Xform {
        axes: [[dt, 0.0, dd], [0.0, 1.0, 0.0], [-dd, 0.0, dt]],
        origin: [at[0], 0.0, at[1]],
    })
}

fn casing(p: &mut Painter<'_>, x: &Xform, w: f64, d: f64, side: f64) {
    let (a, b) = (d.min(d + side * 2.2), d.max(d + side * 2.2));
    p.cuboid(x, [-9.0, 0.0, a], [0.0, DOOR_HEIGHT + 1.0, b]);
    p.cuboid(x, [w, 0.0, a], [w + 9.0, DOOR_HEIGHT + 1.0, b]);
    p.cuboid(
        x,
        [-9.0, DOOR_HEIGHT + 1.0, a],
        [w + 9.0, DOOR_HEIGHT + 15.0, b],
    );
    let (a, b) = (d.min(d + side * 4.5), d.max(d + side * 4.5));
    p.cuboid(
        x,
        [-12.0, DOOR_HEIGHT + 15.0, a],
        [w + 12.0, DOOR_HEIGHT + 19.0, b],
    );
}

fn build_door(
    builder: &mut Builder,
    o: &Opening,
    x: &Xform,
    [lo, hi]: [f64; 2],
    tag: Tag,
    frac: f64,
) {
    let w = o.w;
    let s = if o.swing < 0 { -1.0 } else { 1.0 };
    let face = if s > 0.0 { hi } else { lo };
    let frac = frac.clamp(0.0, 1.0);
    let (opaque, transparent) = (&mut builder.opaque, &mut builder.transparent);
    let mut p = Painter::new(opaque, TRIM, tag);
    let mut g = Painter::new(transparent, Material::glass(), tag);
    if o.style == DoorStyle::Sealed {
        casing(&mut p, x, w, face, s);
        let closed = hinge(x, [0.0, face + s * 2.4], 1.0, s, 0.0);
        leaf(&mut p, &mut g, &closed, w, false);
        return;
    }
    casing(&mut p, x, w, lo, -1.0);
    casing(&mut p, x, w, hi, 1.0);
    p.cuboid(x, [0.0, 0.0, lo], [1.5, DOOR_HEIGHT, hi]);
    p.cuboid(x, [w - 1.5, 0.0, lo], [w, DOOR_HEIGHT, hi]);
    p.cuboid(x, [0.0, DOOR_HEIGHT - 1.5, lo], [w, DOOR_HEIGHT, hi]);
    let angle = frac * std::f64::consts::FRAC_PI_2;
    match o.style {
        DoorStyle::Hinged | DoorStyle::Glazed => {
            let frame = hinge(x, [0.0, face], 1.0, s, angle);
            leaf(&mut p, &mut g, &frame, w, o.style == DoorStyle::Glazed);
        }
        DoorStyle::Double => {
            let left = hinge(x, [0.0, face], 1.0, s, angle);
            leaf(&mut p, &mut g, &left, w / 2.0, false);
            // The right leaf is the mirror image: build it from its own hinge, facing back.
            let right = hinge(x, [w, face], -1.0, -s, -angle);
            leaf(&mut p, &mut g, &right, w / 2.0, false);
        }
        DoorStyle::Folding | DoorStyle::FoldingDouble => {
            p.material = DOOR;
            let parts: &[(f64, f64, f64)] = if o.style == DoorStyle::Folding {
                &[(0.0, w, 1.0)]
            } else {
                &[(0.0, w / 2.0, 1.0), (w, w / 2.0, -1.0)]
            };
            let phi = frac * 1.4;
            for &(t0, len, dir) in parts {
                let half = len / 2.0;
                let a = [t0, face];
                let b = [t0 + dir * half * phi.cos(), face + s * half * phi.sin()];
                let c = [t0 + dir * 2.0 * half * phi.cos(), face];
                panel(&mut p, x, a, b, [1.0, DOOR_HEIGHT - 3.0], 2.5);
                panel(&mut p, x, b, c, [1.0, DOOR_HEIGHT - 3.0], 2.5);
            }
        }
        DoorStyle::Sliding => {
            p.material = DOOR;
            let shift = -frac * (w - 4.0);
            let (a, b) = (face + s * 1.5, face + s * 4.5);
            p.cuboid(
                x,
                [shift, 1.0, a.min(b)],
                [shift + w, DOOR_HEIGHT - 2.0, a.max(b)],
            );
        }
        DoorStyle::Barn => {
            let shift = -frac * (w + 6.0);
            let depth = |k0: f64, k1: f64| {
                let (a, b) = (face + s * k0, face + s * k1);
                (a.min(b), a.max(b))
            };
            p.material = DOOR;
            let (a, b) = depth(3.5, 7.0);
            p.cuboid(
                x,
                [shift - 5.0, 1.0, a],
                [shift + w + 5.0, DOOR_HEIGHT + 3.0, b],
            );
            let (a, b) = depth(7.0, 7.8);
            for t in [10.0, w - 10.0] {
                for y in [30.0, DOOR_HEIGHT - 30.0] {
                    p.cuboid(
                        x,
                        [shift + t - 2.0, y - 25.0, a],
                        [shift + t + 2.0, y + 25.0, b],
                    );
                }
            }
            p.material = IRON;
            let (a, b) = depth(0.5, 2.6);
            p.cuboid(
                x,
                [-w * 0.95, DOOR_HEIGHT + 10.0, a],
                [w + 8.0, DOOR_HEIGHT + 14.0, b],
            );
            let (a, b) = depth(4.5, 5.5);
            for t in [8.0, w - 8.0] {
                p.cuboid(
                    x,
                    [shift + t - 2.0, DOOR_HEIGHT, a],
                    [shift + t + 2.0, DOOR_HEIGHT + 13.0, b],
                );
            }
        }
        DoorStyle::Passage | DoorStyle::Sealed => {}
    }
}
