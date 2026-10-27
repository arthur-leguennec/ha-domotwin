//! The kitchen's and the dining room's pieces of the library (D-071): an island, stools, a
//! sideboard, ovens and small appliances, a wine cooler, freezers, and other styles of tables,
//! chairs, fridges and cookers.

use std::f64::consts::{FRAC_PI_2, TAU};

use super::{
    CHROME, DARK, GOLD, Material, Model, Rgb8, SCREEN, STEEL, STONE, Surface, V3, WHITE, WOOD_DARK,
    faucet, shade, surface,
};

/// A handle: a bar standing off a front at `z`, from `a` to `b`.
fn bar(m: &mut Model<'_>, a: V3, b: V3) {
    let steel = Material::metal(STEEL);
    let r = 0.6;
    let lift = [0.0, 0.0, 2.2];
    let out = |p: V3| [p[0] + lift[0], p[1] + lift[1], p[2] + lift[2]];
    m.pipe(steel, &[a, out(a), out(b), b], r);
}

/// A stool for a counter or a bar: a round seat on four splayed legs and a ring for the feet;
/// `backrest`, a low back over the seat.
pub(super) fn bar_stool(m: &mut Model<'_>, backrest: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::metal(c);
    let seat_y = if backrest { h * 0.68 } else { h };
    let r = w.min(d) / 2.0;
    let seat_r = r * 0.92;
    for k in 0..4 {
        let a = f64::from(k) * TAU / 4.0 + TAU / 8.0;
        let (s, co) = a.sin_cos();
        m.rod(
            metal,
            [co * (r - 1.2), 0.0, s * (r - 1.2)],
            [co * seat_r * 0.55, seat_y - 4.0, s * seat_r * 0.55],
            1.0,
        );
    }
    let ring_y = seat_y * 0.38;
    let ring_r = r - 1.2 - (r - 1.2 - seat_r * 0.55) * 0.38;
    let ring: Vec<V3> = (0..=12)
        .map(|k| {
            let a = f64::from(k) * TAU / 12.0;
            [a.cos() * ring_r, ring_y, a.sin() * ring_r]
        })
        .collect();
    m.pipe(metal, &ring, 0.8);
    m.cyl(
        metal,
        [0.0, seat_y - 4.5, 0.0],
        [seat_r * 0.6, seat_r * 0.6],
        1.5,
    );
    m.lathe(
        Material::fabric(Rgb8::from_u32(0x6b4a33)),
        [0.0, seat_y - 3.5, 0.0],
        &[[0.0, 0.0], [1.0, 0.0], [1.0, 2.4], [0.9, 3.5], [0.0, 3.7]],
        [seat_r, seat_r],
    );
    if backrest {
        let back_y = h - 2.0;
        for sx in [-1.0, 1.0] {
            m.rod(
                metal,
                [sx * seat_r * 0.5, seat_y - 3.0, -seat_r * 0.75],
                [sx * seat_r * 0.6, back_y, -seat_r * 0.95],
                0.8,
            );
        }
        let arc: Vec<V3> = (0..=8)
            .map(|k| {
                let a = -0.7 + 1.4 * f64::from(k) / 8.0;
                [
                    a.sin() * seat_r * 0.95,
                    back_y - 3.0,
                    -a.cos() * seat_r * 0.95,
                ]
            })
            .collect();
        m.pipe(Material::fabric(Rgb8::from_u32(0x6b4a33)), &arc, 2.6);
    }
}

/// A kitchen island: cabinets towards the front, drawers over doors, a stone worktop running
/// over its back where stools go, and stone ends down to the floor; `sink` or `hob` in its top.
pub(super) fn kitchen_island(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let top = 4.0_f64.min(h * 0.1);
    let plinth = 10.0_f64.min(h * 0.12);
    let cab_d = 60.0_f64.min(d - 20.0).max(d * 0.5);
    let end = 3.0_f64.min(w * 0.05);
    let zc = d / 2.0 - cab_d;
    let body = Material::satin(c);
    m.bx(
        Material::paint(shade(c, 0.6)),
        [-w / 2.0 + end, 0.0, zc],
        [w / 2.0 - end, plinth, d / 2.0 - 5.0],
    );
    m.bx(
        body,
        [-w / 2.0 + end, plinth, zc],
        [w / 2.0 - end, h - top, d / 2.0 - 2.0],
    );
    // The fronts: a row of drawers over the doors.
    let cols = ((w / 55.0).round() as usize).clamp(1, 6);
    let front = Material::satin(shade(c, 1.03));
    let split = plinth + 1.0 + (h - top - plinth - 2.0) * 0.24;
    let saved = m.w;
    m.w = w - 2.0 * end;
    m.fronts(front, split, h - top - 1.0, cols, 1, true);
    m.fronts(front, plinth + 1.0, split, cols, 1, true);
    m.w = saved;
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * w / 2.0, sx * (w / 2.0 - end));
        m.bx(
            STONE,
            [a.min(b), 0.0, -d / 2.0],
            [a.max(b), h - top, d / 2.0],
        );
    }
    m.soft(
        STONE,
        [-w / 2.0, h - top, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        0.4,
    );
    let mid = (zc + d / 2.0) / 2.0;
    match variant {
        Some("sink") => {
            let bw = (w * 0.3).min(60.0);
            m.bx(
                Material::metal(CHROME),
                [-bw / 2.0, h - 0.6, mid - 20.0],
                [bw / 2.0, h + 0.05, mid + 20.0],
            );
            m.bx(
                Material::metal(Rgb8::from_u32(0x8f9493)),
                [-bw / 2.0 + 2.0, h - 0.5, mid - 18.0],
                [bw / 2.0 - 2.0, h + 0.1, mid + 18.0],
            );
            faucet(m, [0.0, h, mid - 24.0]);
        }
        Some("hob") => {
            let hw = (w * 0.4).min(78.0);
            m.bx(
                SCREEN,
                [-hw / 2.0, h - 0.3, mid - 25.0],
                [hw / 2.0, h + 0.4, mid + 25.0],
            );
            for (sx, sz, r) in [
                (-0.27, -0.25, 9.0),
                (0.27, -0.25, 7.0),
                (-0.27, 0.25, 7.0),
                (0.27, 0.25, 9.0),
            ] {
                m.cyl(
                    Material::metal(Rgb8::from_u32(0x3a3d40)),
                    [sx * hw, h + 0.4, mid + sz * 40.0],
                    [r, r],
                    0.1,
                );
            }
        }
        _ => {}
    }
}

/// A sideboard on tapered legs: doors at its ends, drawers in the middle, brass pulls.
pub(super) fn sideboard(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    let leg = (h * 0.2).min(18.0);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.rod(
                Material::wood(shade(c, 0.85)),
                [sx * (w / 2.0 - 3.0), 0.0, sz * (d / 2.0 - 3.0)],
                [sx * (w / 2.0 - 6.0), leg + 0.5, sz * (d / 2.0 - 5.5)],
                1.4,
            );
        }
    }
    m.bx(
        wood,
        [-w / 2.0, leg, -d / 2.0],
        [w / 2.0, h - 2.0, d / 2.0 - 1.5],
    );
    m.soft(
        wood,
        [-w / 2.0, h - 2.0, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        0.5,
    );
    let front = Material::wood(shade(c, 1.07));
    let brass = Material::metal(GOLD);
    let third = w / 3.0;
    let (y0, y1) = (leg + 1.0, h - 3.0);
    for k in 0..3 {
        let x0 = -w / 2.0 + third * f64::from(k);
        if k == 1 {
            let rh = (y1 - y0) / 3.0;
            for r in 0..3 {
                let ya = y0 + rh * f64::from(r);
                m.bx(
                    front,
                    [x0 + 0.4, ya + 0.3, d / 2.0 - 1.5],
                    [x0 + third - 0.4, ya + rh - 0.3, d / 2.0],
                );
                m.bx(
                    brass,
                    [x0 + third / 2.0 - 4.0, ya + rh / 2.0 - 0.5, d / 2.0],
                    [x0 + third / 2.0 + 4.0, ya + rh / 2.0 + 0.5, d / 2.0 + 1.0],
                );
            }
        } else {
            m.bx(
                front,
                [x0 + 0.4, y0 + 0.3, d / 2.0 - 1.5],
                [x0 + third - 0.4, y1 - 0.3, d / 2.0],
            );
            let px = if k == 0 { x0 + third - 3.5 } else { x0 + 3.5 };
            m.bx(
                brass,
                [px - 0.5, y1 - 14.0, d / 2.0],
                [px + 0.5, y1 - 4.0, d / 2.0 + 1.0],
            );
        }
    }
}

/// A microwave: its door's dark window and handle, the controls and their display on the right.
pub(super) fn microwave(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    m.soft(
        body,
        [-w / 2.0, 0.8, -d / 2.0],
        [w / 2.0, h, d / 2.0 - 0.6],
        0.8,
    );
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.cyl(
                Material::paint(DARK),
                [sx * (w / 2.0 - 3.0), 0.0, sz * (d / 2.0 - 4.0)],
                [1.0, 1.0],
                0.9,
            );
        }
    }
    let panel = (w * 0.24).min(13.0);
    let door = w - panel;
    m.bx(
        Material::new(shade(c, 0.9), 0.3, Surface::Metal),
        [-w / 2.0 + 0.3, 1.3, d / 2.0 - 0.6],
        [-w / 2.0 + door, h - 0.5, d / 2.0],
    );
    m.bx(
        Material::new(Rgb8::from_u32(0x0f1112), 0.12, Surface::Screen),
        [-w / 2.0 + 3.0, 4.0, d / 2.0],
        [-w / 2.0 + door - 5.0, h - 3.5, d / 2.0 + 0.15],
    );
    bar(
        m,
        [-w / 2.0 + door - 2.5, h * 0.2, d / 2.0],
        [-w / 2.0 + door - 2.5, h * 0.8, d / 2.0],
    );
    let px = w / 2.0 - panel / 2.0;
    m.bx(
        Material::paint(Rgb8::from_u32(0x2a6d5a)),
        [px - panel * 0.35, h - 7.0, d / 2.0 - 0.6],
        [px + panel * 0.35, h - 4.0, d / 2.0 - 0.4],
    );
    for k in 0..3 {
        let y = h - 11.0 - f64::from(k) * 5.0;
        if y > 3.0 {
            m.cyl(
                Material::metal(STEEL),
                [px, y, d / 2.0 - 0.6],
                [1.2, 1.2],
                0.1,
            );
        }
    }
}

/// An oven housing from the floor: a cupboard over the oven at eye level, drawers under it;
/// `double`, two ovens one over the other.
pub(super) fn oven(m: &mut Model<'_>, double: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let plinth = 10.0_f64.min(h * 0.08);
    let body = Material::satin(c);
    m.bx(
        Material::paint(shade(c, 0.6)),
        [-w / 2.0 + 1.0, 0.0, -d / 2.0],
        [w / 2.0 - 1.0, plinth, d / 2.0 - 5.0],
    );
    m.bx(
        body,
        [-w / 2.0, plinth, -d / 2.0],
        [w / 2.0, h, d / 2.0 - 2.0],
    );
    let front = Material::satin(shade(c, 1.03));
    let glass = Material::new(Rgb8::from_u32(0x141618), 0.12, Surface::Screen);
    let steel = Material::metal(STEEL);
    // An oven's front from `y0` to `y1`: its control strip, its door's window, its handle.
    let one = |m: &mut Model<'_>, y0: f64, y1: f64| {
        m.bx(
            steel,
            [-w / 2.0 + 0.6, y0, d / 2.0 - 2.0],
            [w / 2.0 - 0.6, y1, d / 2.0 - 0.6],
        );
        m.bx(
            glass,
            [-w / 2.0 + 1.0, y0 + 0.6, d / 2.0 - 0.6],
            [w / 2.0 - 1.0, y1 - 8.0, d / 2.0],
        );
        m.bx(
            Material::paint(Rgb8::from_u32(0xe9a23b)),
            [-3.0, y1 - 5.0, d / 2.0 - 0.6],
            [3.0, y1 - 3.0, d / 2.0 - 0.4],
        );
        bar(
            m,
            [-w / 2.0 + 6.0, y1 - 10.5, d / 2.0],
            [w / 2.0 - 6.0, y1 - 10.5, d / 2.0],
        );
    };
    let (oven_h, gap) = (58.0_f64.min(h * 0.3), 1.0);
    let top_of = if double {
        let first = (h * 0.4).max(plinth + 30.0);
        one(m, first, first + oven_h - 13.0);
        one(m, first + oven_h - 13.0 + gap, first + 2.0 * oven_h - 13.0);
        (first, first + 2.0 * oven_h - 13.0)
    } else {
        let first = (h * 0.42).max(plinth + 30.0);
        one(m, first, first + oven_h);
        (first, first + oven_h)
    };
    let saved = m.w;
    m.w = w;
    m.fronts(front, plinth + 1.0, top_of.0 - gap, 1, 2, true);
    m.fronts(front, top_of.1 + gap, h - 1.0, 1, 1, true);
    m.w = saved;
}

/// A coffee machine making coffee from beans: its spout over a cup on the drip tray, its hopper
/// and display; `espresso`, a steel machine with its group head, wand and gauge.
pub(super) fn coffee_machine(m: &mut Model<'_>, espresso: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let cup = Material::ceramic(WHITE);
    let cup_at = |y: f64, z: f64| {
        (
            [0.0, y, z],
            [
                [0.0, 0.0],
                [2.6, 0.0],
                [3.6, 5.5],
                [3.2, 5.5],
                [2.2, 0.6],
                [0.0, 0.6],
            ],
        )
    };
    if espresso {
        let steel = Material::metal(c);
        // Its body behind, the group head standing out over the drip tray in front.
        let face = d / 2.0 - 10.0;
        let base = 3.0;
        m.soft(steel, [-w / 2.0, base, -d / 2.0], [w / 2.0, h, face], 1.0);
        m.soft(
            steel,
            [-w / 2.0, 0.0, -d / 2.0],
            [w / 2.0, base + 3.0, d / 2.0],
            0.8,
        );
        m.bx(
            Material::metal(shade(c, 0.8)),
            [-w / 2.0 + 3.0, base + 3.0, face],
            [w / 2.0 - 3.0, base + 3.6, d / 2.0 - 1.5],
        );
        let head_y = h * 0.62;
        let head_z = face + 4.0;
        m.bx(
            steel,
            [-5.0, head_y, face - 0.5],
            [5.0, head_y + 5.0, face + 6.0],
        );
        m.cyl(
            Material::metal(CHROME),
            [0.0, head_y - 3.0, head_z],
            [3.6, 3.6],
            3.0,
        );
        m.cyl(
            Material::metal(DARK),
            [0.0, head_y - 5.5, head_z],
            [3.4, 3.2],
            2.5,
        );
        m.rod(
            Material::paint(DARK),
            [0.0, head_y - 4.5, head_z + 2.0],
            [0.0, head_y - 5.0, d / 2.0 - 0.5],
            0.9,
        );
        let (at, profile) = cup_at(base + 3.6, head_z);
        m.lathe(cup, at, &profile, [1.0, 1.0]);
        m.pipe(
            Material::metal(CHROME),
            &[
                [w / 2.0 - 5.0, head_y + 3.0, face],
                [w / 2.0 - 4.0, head_y, face + 3.0],
                [w / 2.0 - 4.5, base + 10.0, face + 4.0],
            ],
            0.45,
        );
        let gauge =
            m.x.translated([-w * 0.22, h * 0.82, face])
                .turned_x(FRAC_PI_2);
        m.p.material = Material::paint(Rgb8::from_u32(0xf3f1ea));
        m.p.cylinder(&gauge, [0.0; 3], [2.4, 2.4], 0.5, 12, true);
        m.bx(
            Material::metal(CHROME),
            [-w / 2.0 + 1.0, h, -d / 2.0 + 1.0],
            [w / 2.0 - 1.0, h + 0.8, face - 1.0],
        );
        return;
    }
    let body = Material::satin(c);
    m.soft(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0], 1.5);
    let recess_y = h * 0.62;
    m.bx(
        Material::satin(shade(c, 0.65)),
        [-w / 2.0 + 2.5, 1.5, d / 2.0 - 7.0],
        [w / 2.0 - 2.5, recess_y, d / 2.0 + 0.05],
    );
    m.bx(
        Material::metal(STEEL),
        [-w / 2.0 + 2.5, 1.5, d / 2.0 - 7.0],
        [w / 2.0 - 2.5, 3.0, d / 2.0 + 0.5],
    );
    m.bx(
        Material::metal(CHROME),
        [-2.5, recess_y - 4.0, d / 2.0 - 6.0],
        [2.5, recess_y - 0.5, d / 2.0 - 2.0],
    );
    let (at, profile) = cup_at(3.0, d / 2.0 - 4.0);
    m.lathe(cup, at, &profile, [1.0, 1.0]);
    m.bx(
        Material::new(Rgb8::from_u32(0x101214), 0.12, Surface::Screen),
        [-w / 2.0 + 3.0, recess_y + 3.0, d / 2.0],
        [w / 2.0 - 3.0, h - 4.0, d / 2.0 + 0.15],
    );
    m.soft(
        Material::satin(shade(c, 1.25)),
        [-w / 2.0 + 2.0, h - 0.5, -d / 2.0 + 3.0],
        [w / 2.0 - 2.0, h + 1.5, -d / 2.0 + 15.0],
        0.6,
    );
}

/// A kettle on its base: a body turned round, its lid, spout and handle.
pub(super) fn kettle(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let r = d.min(w * 0.7) / 2.0;
    let body = Material::new(c, 0.3, Surface::Matte);
    m.cyl(
        Material::paint(DARK),
        [0.0, 0.0, 0.0],
        [r * 1.05, r * 1.0],
        2.0,
    );
    let profile: Vec<[f64; 2]> = [
        [0.0, 0.0],
        [0.92, 0.0],
        [1.0, 0.08],
        [0.98, 0.7],
        [0.82, 0.88],
        [0.55, 0.94],
        [0.0, 0.96],
    ]
    .iter()
    .map(|p| [p[0] * r, 2.0 + p[1] * (h - 3.0)])
    .collect();
    m.lathe(body, [0.0; 3], &profile, [1.0, 1.0]);
    m.sph(
        Material::paint(DARK),
        [0.0, h - 0.8, 0.0],
        [r * 0.18, 1.0, r * 0.18],
    );
    m.pipe(
        Material::paint(DARK),
        &[
            [-r * 0.85, h * 0.85, 0.0],
            [-r * 1.3, h * 0.8, 0.0],
            [-w / 2.0 + 1.0, h * 0.55, 0.0],
            [-w / 2.0 + 1.2, h * 0.3, 0.0],
            [-r * 0.98, h * 0.2, 0.0],
        ],
        1.0,
    );
    let tip = [w / 2.0 - 0.5, h * 0.8, 0.0];
    m.p.material = body;
    let from = [r * 0.8, h * 0.45, 0.0];
    m.p.pipe(&m.x, &[from, [r * 1.2, h * 0.62, 0.0], tip], 1.2, 8, true);
}

/// A two-slot toaster: its slots, two slices of bread up, its lever.
pub(super) fn toaster(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.soft(
        Material::metal(c),
        [-w / 2.0 + 1.0, 0.6, -d / 2.0],
        [w / 2.0 - 1.0, h, d / 2.0],
        (d * 0.18).min(3.0),
    );
    for sx in [-1.0, 1.0] {
        m.bx(
            Material::paint(DARK),
            [-w / 2.0 + 3.0, 0.0, sx * d * 0.2 - 1.6],
            [w / 2.0 - 3.0, 0.7, sx * d * 0.2 + 1.6],
        );
        m.bx(
            Material::paint(Rgb8::from_u32(0x1a1a1a)),
            [-w / 2.0 + 4.0, h - 0.1, sx * d * 0.2 - 1.4],
            [w / 2.0 - 4.0, h + 0.05, sx * d * 0.2 + 1.4],
        );
        m.soft(
            Material::new(Rgb8::from_u32(0xc89a5e), 0.9, Surface::Fabric),
            [-w / 2.0 + 5.0, h - 6.0, sx * d * 0.2 - 0.8],
            [w / 2.0 - 5.0, h + 3.0, sx * d * 0.2 + 0.8],
            0.6,
        );
    }
    m.bx(
        Material::paint(DARK),
        [w / 2.0 - 1.0, h * 0.6, -1.5],
        [w / 2.0 + 0.0, h * 0.75, 1.5],
    );
}

/// A wine cooler: a glass door in its frame on rows of bottles lying on their shelves.
pub(super) fn wine_cooler(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    let kick = 8.0_f64.min(h * 0.1);
    // A shell open behind its door: its sides, top, bottom and back.
    let front = d / 2.0 - 2.5;
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * w / 2.0, sx * (w / 2.0 - 2.5));
        m.bx(body, [a.min(b), 0.0, -d / 2.0], [a.max(b), h, front]);
    }
    m.bx(body, [-w / 2.0, h - 3.0, -d / 2.0], [w / 2.0, h, front]);
    m.bx(
        body,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, kick + 1.0, front],
    );
    m.bx(
        body,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h, -d / 2.0 + 1.5],
    );
    // Lit inside, as a cooler is behind its glass.
    let inside = Material::paint(Rgb8::from_u32(0xc9d2d6));
    m.bx(
        inside,
        [-w / 2.0 + 2.5, kick + 1.0, -d / 2.0 + 1.5],
        [w / 2.0 - 2.5, h - 3.0, -d / 2.0 + 2.5],
    );
    let rows = ((h - kick - 4.0) / 13.0).floor().clamp(1.0, 12.0);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let (rows_n, per) = (
        rows as usize,
        ((w - 5.0) / 8.0).floor().clamp(1.0, 12.0) as usize,
    );
    let step = (h - kick - 4.0) / rows;
    #[allow(clippy::cast_precision_loss)]
    let pitch = (w - 5.0) / per as f64;
    let glass_green = Material::new(Rgb8::from_u32(0x2f4a33), 0.2, Surface::Matte);
    for r in 0..rows_n {
        #[allow(clippy::cast_precision_loss)]
        let y = kick + 1.0 + step * r as f64;
        m.bx(
            Material::wood(Rgb8::from_u32(0xb18455)),
            [-w / 2.0 + 2.5, y, -d / 2.0 + 2.0],
            [w / 2.0 - 2.5, y + 1.0, d / 2.0 - 3.0],
        );
        for k in 0..per {
            #[allow(clippy::cast_precision_loss)]
            let x = -w / 2.0 + 2.5 + pitch * (k as f64 + 0.5);
            let at =
                m.x.translated([x, y + 1.0 + 3.6, -d / 2.0 + 4.0])
                    .turned_x(FRAC_PI_2);
            m.p.material = glass_green;
            m.p.cylinder(&at, [0.0; 3], [3.6, 3.6], d - 11.0, 8, true);
        }
    }
    m.bx(
        Material::glass(),
        [-w / 2.0 + 0.8, kick, d / 2.0 - 2.0],
        [w / 2.0 - 0.8, h - 1.0, d / 2.0 - 1.4],
    );
    let frame = Material::metal(STEEL);
    for (lo, hi) in [
        ([-w / 2.0, kick - 1.0], [w / 2.0, kick + 1.5]),
        ([-w / 2.0, h - 2.0], [w / 2.0, h]),
        ([-w / 2.0, kick], [-w / 2.0 + 2.0, h]),
        ([w / 2.0 - 2.0, kick], [w / 2.0, h]),
    ] {
        m.bx(
            frame,
            [lo[0], lo[1], d / 2.0 - 2.4],
            [hi[0], hi[1], d / 2.0 - 1.0],
        );
    }
    bar(
        m,
        [w / 2.0 - 5.0, h * 0.3, d / 2.0 - 1.0],
        [w / 2.0 - 5.0, h * 0.75, d / 2.0 - 1.0],
    );
}

/// A chest freezer: its lid with a handle, a little light on the front; `upright`, a tall
/// freezer with one door.
pub(super) fn freezer(m: &mut Model<'_>, upright: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    if upright {
        m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0 - 2.0]);
        m.bx(
            Material::paint(shade(c, 0.5)),
            [-w / 2.0 + 1.0, 0.0, d / 2.0 - 2.0],
            [w / 2.0 - 1.0, 8.0, d / 2.0 - 1.0],
        );
        m.bx(
            body,
            [-w / 2.0 + 0.5, 9.0, d / 2.0 - 2.0],
            [w / 2.0 - 0.5, h - 1.0, d / 2.0],
        );
        m.bx(
            Material::metal(STEEL),
            [w / 2.0 - 5.0, h * 0.45, d / 2.0],
            [w / 2.0 - 3.0, h * 0.75, d / 2.0 + 3.0],
        );
        return;
    }
    let lid = 7.0_f64.min(h * 0.12);
    m.bx(
        Material::paint(shade(c, 0.5)),
        [-w / 2.0 + 2.0, 0.0, -d / 2.0 + 2.0],
        [w / 2.0 - 2.0, 6.0, d / 2.0 - 2.0],
    );
    m.soft(
        body,
        [-w / 2.0, 6.0, -d / 2.0],
        [w / 2.0, h - lid, d / 2.0],
        1.5,
    );
    m.soft(
        body,
        [-w / 2.0 - 0.5, h - lid, -d / 2.0 - 0.5],
        [w / 2.0 + 0.5, h, d / 2.0 + 1.0],
        1.2,
    );
    m.bx(
        Material::paint(shade(c, 0.75)),
        [-w * 0.15, h - lid + 1.0, d / 2.0 + 1.0],
        [w * 0.15, h - lid + 3.0, d / 2.0 + 1.6],
    );
    m.bx(
        Material::paint(Rgb8::from_u32(0x4fbf72)),
        [w / 2.0 - 9.0, h - lid - 5.0, d / 2.0],
        [w / 2.0 - 7.5, h - lid - 4.0, d / 2.0 + 0.2],
    );
}

/// A gas cooker's top: steel, four burners under cast-iron grates.
pub(super) fn gas_top(m: &mut Model<'_>, y: f64) {
    let (w, d) = (m.w, m.d);
    m.bx(
        Material::metal(STEEL),
        [-w / 2.0, y, -d / 2.0],
        [w / 2.0, y + 0.8, d / 2.0],
    );
    let iron = Material::new(Rgb8::from_u32(0x222426), 0.5, Surface::Metal);
    for (sx, sz) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
        let (cx, cz) = (sx * w * 0.22, sz * d * 0.2);
        let r = (w * 0.09).min(5.0);
        m.cyl(
            Material::metal(Rgb8::from_u32(0x5a5d60)),
            [cx, y + 0.8, cz],
            [r, r * 0.8],
            1.2,
        );
        m.cyl(iron, [cx, y + 2.0, cz], [r * 0.45, r * 0.45], 0.6);
    }
    // The grates: bars across and along, standing on the top.
    for k in 0..3 {
        let x = (f64::from(k) - 1.0) * w * 0.44;
        m.bx(
            iron,
            [x - 0.6, y + 0.8, -d / 2.0 + 2.0],
            [x + 0.6, y + 3.0, d / 2.0 - 2.0],
        );
    }
    for k in 0..3 {
        let z = (f64::from(k) - 1.0) * d * 0.4;
        m.bx(
            iron,
            [-w / 2.0 + 2.0, y + 2.4, z - 0.6],
            [w / 2.0 - 2.0, y + 3.2, z + 0.6],
        );
    }
}

/// A fridge with French doors: two doors over a freezer drawer, long handles, in steel.
pub(super) fn french_door(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::new(c, 0.3, Surface::Metal);
    m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0 - 3.0]);
    m.bx(
        Material::paint(DARK),
        [-w / 2.0 + 1.0, 0.0, d / 2.0 - 3.0],
        [w / 2.0 - 1.0, 4.0, d / 2.0 - 1.0],
    );
    let split = h * 0.3;
    m.bx(
        body,
        [-w / 2.0 + 0.5, 4.5, d / 2.0 - 3.0],
        [w / 2.0 - 0.5, split - 0.5, d / 2.0],
    );
    bar(
        m,
        [-w * 0.3, split - 6.0, d / 2.0],
        [w * 0.3, split - 6.0, d / 2.0],
    );
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * 0.25, sx * (w / 2.0 - 0.5));
        m.bx(
            body,
            [a.min(b), split + 0.5, d / 2.0 - 3.0],
            [a.max(b), h - 1.0, d / 2.0],
        );
        bar(
            m,
            [sx * 4.0, split + 15.0, d / 2.0],
            [sx * 4.0, h - 20.0, d / 2.0],
        );
    }
    m.bx(
        Material::new(Rgb8::from_u32(0x0f1112), 0.12, Surface::Screen),
        [-w / 2.0 + 8.0, h * 0.68, d / 2.0],
        [-w / 2.0 + 18.0, h * 0.68 + 18.0, d / 2.0 + 0.15],
    );
}

/// A round table on a turned pedestal standing on four feet.
pub(super) fn pedestal_table(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    m.p.material = wood;
    m.p.ellipse_cylinder(
        &m.x,
        [0.0, h - 3.5, 0.0],
        [w / 2.0, d / 2.0],
        [w / 2.0, d / 2.0],
        3.5,
        32,
        true,
    );
    m.p.ellipse_cylinder(
        &m.x,
        [0.0, h - 7.0, 0.0],
        [w / 2.0 * 0.7, d / 2.0 * 0.7],
        [w / 2.0 * 0.7, d / 2.0 * 0.7],
        3.5,
        24,
        true,
    );
    let col = (w.min(d) * 0.06).clamp(3.0, 9.0);
    m.lathe(
        wood,
        [0.0, 6.0, 0.0],
        &[
            [col * 1.6, 0.0],
            [col * 1.2, (h - 13.0) * 0.12],
            [col * 0.9, (h - 13.0) * 0.4],
            [col, (h - 13.0) * 0.7],
            [col * 1.3, h - 13.0],
        ],
        [1.0, 1.0],
    );
    let reach = w.min(d) * 0.36;
    for k in 0..4 {
        let a = f64::from(k) * TAU / 4.0 + TAU / 8.0;
        let foot = m.x.turned_y(-a);
        m.p.material = wood;
        m.p.slab(
            &foot,
            &[
                [0.0, 0.0],
                [reach, 0.0],
                [reach, 2.5],
                [col * 1.4, 9.0],
                [0.0, 9.0],
            ],
            -2.0,
            2.0,
        );
    }
}

/// A bistro chair of bent wood: a round seat on splayed legs held by a ring, its back a hoop.
pub(super) fn bistro_chair(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = Material::wood(c);
    let seat_y = (h * 0.53).min(47.0);
    let r = w.min(d) / 2.0 - 1.0;
    let zc = d * 0.06;
    for k in 0..4 {
        let a = f64::from(k) * TAU / 4.0 + TAU / 8.0;
        let (s, co) = a.sin_cos();
        let back = s < 0.0;
        let top = [co * r * 0.75, seat_y - 2.0, zc + s * r * 0.75];
        let foot = [
            co * (r + 0.5),
            0.0,
            zc + s * (r + 0.5) - if back { 3.0 } else { 0.0 },
        ];
        m.rod(wood, foot, top, 1.2);
    }
    let ring_y = seat_y * 0.38;
    let ring: Vec<V3> = (0..=12)
        .map(|k| {
            let a = f64::from(k) * TAU / 12.0;
            [a.cos() * r * 0.86, ring_y, zc + a.sin() * r * 0.86]
        })
        .collect();
    m.pipe(wood, &ring, 0.7);
    m.lathe(
        Material::new(Rgb8::from_u32(0xc4a46a), 0.9, Surface::Fabric),
        [0.0, seat_y - 2.5, zc],
        &[[0.0, 0.0], [r, 0.0], [r, 2.5], [0.0, 2.7]],
        [1.0, 1.0],
    );
    let hoop: Vec<V3> = (0..=10)
        .map(|k| {
            let a = std::f64::consts::PI * f64::from(k) / 10.0;
            [
                -a.cos() * r * 0.7,
                seat_y + (h - seat_y - 2.0) * a.sin().sqrt(),
                -d / 2.0 + 3.0 - a.sin() * 2.0,
            ]
        })
        .collect();
    m.pipe(wood, &hoop, 1.1);
    let inner: Vec<V3> = (0..=8)
        .map(|k| {
            let a = std::f64::consts::PI * f64::from(k) / 8.0;
            [
                -a.cos() * r * 0.42,
                seat_y + (h - seat_y) * 0.65 * a.sin().sqrt(),
                -d / 2.0 + 3.5 - a.sin() * 1.5,
            ]
        })
        .collect();
    m.pipe(wood, &inner, 0.8);
}

/// A dining chair upholstered: its seat and its tall back padded, on wooden legs.
pub(super) fn upholstered_chair(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let fabric = Material::fabric(c);
    let leg = Material::wood(WOOD_DARK);
    let seat_y = (h * 0.5).min(48.0);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            let (x, z) = (sx * (w / 2.0 - 3.0), sz * (d / 2.0 - 3.5));
            m.rod(leg, [x * 1.02, 0.0, z * 1.04], [x, seat_y - 6.0, z], 1.4);
        }
    }
    m.soft(
        fabric,
        [-w / 2.0 + 0.5, seat_y - 8.0, -d / 2.0 + 4.0],
        [w / 2.0 - 0.5, seat_y, d / 2.0],
        2.5,
    );
    // Its back leaning a little, within the piece.
    let tilt: f64 = 0.1;
    let lean = (h - seat_y + 5.0) * tilt.sin() + 3.0 * tilt.cos();
    let back =
        m.x.translated([0.0, seat_y - 6.0, -d / 2.0 + lean])
            .turned_x(-tilt);
    m.p.material = fabric;
    m.p.soft_box(
        &back,
        [-w / 2.0 + 1.0, 0.0, -3.0],
        [w / 2.0 - 1.0, h - seat_y + 5.0, 3.0],
        2.5,
    );
}
