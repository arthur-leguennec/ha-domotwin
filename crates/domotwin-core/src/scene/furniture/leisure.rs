//! The library's pieces for working, keeping fit, the pets and the garage (D-071): a monitor and
//! a computer, a filing cabinet, a standing desk, a treadmill and an exercise bike, a pet's bed,
//! a cat tree, litter boxes, a feeder, and a car.

use std::f64::consts::{FRAC_PI_2, PI};

use super::{CHROME, DARK, Material, Model, Rgb8, STEEL, Surface, V3, shade, surface};

/// Black plastic.
const PLASTIC: Rgb8 = Rgb8::from_u32(0x2a2c2e);

/// A computer monitor on its stand: its foot, its neck, its screen and bezel.
pub(super) fn monitor(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    let foot = (d * 0.9).min(22.0);
    m.soft(
        body,
        [-w * 0.18, 0.0, -d / 2.0],
        [w * 0.18, 1.2, -d / 2.0 + foot],
        0.5,
    );
    let screen_h = (w * 9.0 / 16.0).min(h - 6.0).max(h * 0.5);
    let y0 = h - screen_h;
    let z = -d / 2.0 + 4.0;
    m.bx(
        body,
        [-2.5, 1.0, z - 4.0],
        [2.5, y0 + screen_h * 0.5, z - 1.5],
    );
    m.soft(body, [-w / 2.0, y0, z - 1.5], [w / 2.0, h, z + 1.0], 0.4);
    m.bx(
        Material::new(Rgb8::from_u32(0x0b0d0e), 0.12, Surface::Screen),
        [-w / 2.0 + 0.8, y0 + 1.8, z + 1.0],
        [w / 2.0 - 0.8, h - 0.8, z + 1.15],
    );
}

/// A tower computer: its case, the mesh of its front, its button lit.
pub(super) fn computer(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.soft(
        Material::satin(c),
        [-w / 2.0, 1.5, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        1.0,
    );
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.blk(
                Material::paint(DARK),
                [sx * (w / 2.0 - 2.5), 0.0, sz * (d / 2.0 - 4.0)],
                [3.0, 1.6, 3.0],
            );
        }
    }
    m.bx(
        Material::fabric(shade(c, 0.6)),
        [-w / 2.0 + 1.5, 4.0, d / 2.0],
        [w / 2.0 - 1.5, h - 7.0, d / 2.0 + 0.2],
    );
    m.cyl(
        Material::paint(Rgb8::from_u32(0x7fd3ff)),
        [w * 0.2, h - 1.0, d / 2.0 - 4.0],
        [0.9, 0.9],
        0.2,
    );
    // A window of glass on its side.
    m.bx(
        Material::glass(),
        [w / 2.0 - 0.2, 6.0, -d / 2.0 + 4.0],
        [w / 2.0 + 0.1, h - 4.0, d / 2.0 - 4.0],
    );
}

/// A filing cabinet on castors: three drawers with their handles.
pub(super) fn filing_cabinet(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wheel = 4.0_f64.min(h * 0.1);
    m.bx(
        Material::satin(c),
        [-w / 2.0, wheel, -d / 2.0],
        [w / 2.0, h, d / 2.0 - 1.0],
    );
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.sph(
                Material::paint(DARK),
                [sx * (w / 2.0 - 3.0), wheel / 2.0, sz * (d / 2.0 - 4.0)],
                [wheel / 2.0, wheel / 2.0, wheel / 2.0],
            );
        }
    }
    let (y0, y1) = (wheel + 1.0, h - 1.0);
    let rows = [0.0, 0.25, 0.5, 1.0];
    for k in 0..3 {
        let (a, b) = (y0 + (y1 - y0) * rows[k], y0 + (y1 - y0) * rows[k + 1]);
        m.bx(
            Material::satin(shade(c, 1.04)),
            [-w / 2.0 + 0.5, a + 0.3, d / 2.0 - 1.0],
            [w / 2.0 - 0.5, b - 0.3, d / 2.0],
        );
        m.bx(
            Material::metal(STEEL),
            [-6.0, b - 4.5, d / 2.0],
            [6.0, b - 3.3, d / 2.0 + 1.2],
        );
    }
}

/// A standing desk: its top on two columns that rise and fall, their feet, the paddle under the
/// top.
pub(super) fn standing_desk(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let top = 2.5_f64.min(h * 0.1);
    m.soft(
        surface(c),
        [-w / 2.0, h - top, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        0.8,
    );
    let frame = Material::metal(Rgb8::from_u32(0x2b2d2f));
    let x = w / 2.0 - 12.0;
    for sx in [-1.0, 1.0] {
        m.bx(
            frame,
            [sx * x - 3.5, 0.0, -d / 2.0 + 4.0],
            [sx * x + 3.5, 3.0, d / 2.0 - 4.0],
        );
        m.bx(
            frame,
            [sx * x - 3.0, 3.0, -4.0],
            [sx * x + 3.0, h * 0.55, 3.0],
        );
        m.bx(
            Material::metal(Rgb8::from_u32(0x3a3d40)),
            [sx * x - 2.4, h * 0.55, -3.4],
            [sx * x + 2.4, h - top, 2.4],
        );
        m.bx(
            frame,
            [sx * x - 3.0, h - top - 3.0, -d / 2.0 + 6.0],
            [sx * x + 3.0, h - top, d / 2.0 - 6.0],
        );
    }
    m.bx(
        frame,
        [-x, h - top - 3.0, -d / 2.0 + 10.0],
        [x, h - top, -d / 2.0 + 14.0],
    );
    m.bx(
        Material::paint(DARK),
        [w / 2.0 - 25.0, h - top - 2.0, d / 2.0 - 6.0],
        [w / 2.0 - 13.0, h - top, d / 2.0 - 1.0],
    );
}

/// A treadmill: its deck and belt, the motor's hood at the back, the uprights, rails and console
/// the runner faces.
pub(super) fn treadmill(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    let deck = (h * 0.13).min(20.0);
    let hood = (d * 0.17).min(35.0);
    let (zb, zf) = (-d / 2.0, d / 2.0);
    m.soft(
        body,
        [-w / 2.0 + 4.0, 4.0, zb + hood],
        [w / 2.0 - 4.0, deck, zf],
        2.0,
    );
    for sz in [zb + hood + 10.0, zf - 8.0] {
        for sx in [-1.0, 1.0] {
            m.blk(
                Material::paint(DARK),
                [sx * (w / 2.0 - 8.0), 0.0, sz],
                [5.0, 4.5, 5.0],
            );
        }
    }
    m.bx(
        Material::new(Rgb8::from_u32(0x1a1b1c), 0.85, Surface::Fabric),
        [-w / 2.0 + 13.0, deck, zb + hood + 2.0],
        [w / 2.0 - 13.0, deck + 0.6, zf - 4.0],
    );
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * (w / 2.0 - 4.0), sx * (w / 2.0 - 13.0));
        m.bx(
            Material::satin(shade(c, 1.4)),
            [a.min(b), deck, zb + hood],
            [a.max(b), deck + 1.2, zf - 2.0],
        );
    }
    m.soft(
        body,
        [-w / 2.0, 0.0, zb],
        [w / 2.0, deck + 8.0, zb + hood + 2.0],
        4.0,
    );
    let rail_y = h * 0.72;
    for sx in [-1.0, 1.0] {
        let x = sx * (w / 2.0 - 3.0);
        m.pipe(
            body,
            &[
                [x, deck + 5.0, zb + hood * 0.6],
                [x * 0.97, h - 18.0, zb + hood * 0.2],
            ],
            2.4,
        );
        m.pipe(
            Material::paint(DARK),
            &[
                [x * 0.97, rail_y, zb + hood * 0.4],
                [x * 0.97, rail_y, zb + hood + 40.0],
                [x * 0.97, rail_y - 4.0, zb + hood + 46.0],
            ],
            1.6,
        );
    }
    let console = m.x.translated([0.0, h - 18.0, zb + 13.0]).turned_x(-0.5);
    m.bx_in(
        body,
        &console,
        [-w / 2.0 + 2.0, 0.0, -4.0],
        [w / 2.0 - 2.0, 18.0, 4.0],
    );
    m.bx_in(
        Material::new(Rgb8::from_u32(0x0b0d0e), 0.12, Surface::Screen),
        &console,
        [-w * 0.25, 4.0, 4.0],
        [w * 0.25, 15.0, 4.2],
    );
}

/// An exercise bike: its feet, frame, flywheel under the bars at the back, the saddle, the bars
/// and the pedals on their cranks.
pub(super) fn exercise_bike(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let frame = Material::new(c, 0.4, Surface::Metal);
    let (zb, zf) = (-d / 2.0 + 6.0, d / 2.0 - 6.0);
    for z in [zb, zf] {
        m.pipe(
            frame,
            &[[-w / 2.0 + 3.0, 3.0, z], [w / 2.0 - 3.0, 3.0, z]],
            3.0,
        );
        for sx in [-1.0, 1.0] {
            m.blk(
                Material::paint(DARK),
                [sx * (w / 2.0 - 4.0), 0.0, z],
                [6.0, 1.5, 6.0],
            );
        }
    }
    let crank = [0.0, h * 0.25, d * 0.03];
    let seat = [0.0, h * 0.78, zf - d * 0.12];
    let bars = [0.0, h - 6.0, zb + d * 0.08];
    m.pipe(
        frame,
        &[[0.0, 4.0, zb], [0.0, h * 0.42, zb + d * 0.15], crank],
        2.8,
    );
    m.pipe(frame, &[[0.0, 4.0, zf], crank], 2.8);
    m.pipe(frame, &[crank, [0.0, seat[1] - 12.0, seat[2] - 3.0]], 2.6);
    m.pipe(
        frame,
        &[
            [0.0, h * 0.42, zb + d * 0.15],
            [0.0, bars[1] - 12.0, bars[2] + 4.0],
        ],
        2.6,
    );
    m.rod(
        Material::metal(CHROME),
        [0.0, seat[1] - 14.0, seat[2] - 3.5],
        [0.0, seat[1] - 3.0, seat[2] - 1.0],
        1.4,
    );
    m.soft(
        Material::new(Rgb8::from_u32(0x1d1f20), 0.7, Surface::Fabric),
        [-8.0, seat[1] - 4.0, seat[2] - 8.0],
        [8.0, seat[1], seat[2] + 12.0],
        1.8,
    );
    m.rod(
        Material::metal(CHROME),
        [0.0, bars[1] - 14.0, bars[2] + 5.0],
        bars,
        1.4,
    );
    m.pipe(
        Material::paint(DARK),
        &[
            [-w / 2.0 + 6.0, bars[1] + 2.0, bars[2] + 12.0],
            [-w * 0.2, bars[1], bars[2]],
            [w * 0.2, bars[1], bars[2]],
            [w / 2.0 - 6.0, bars[1] + 2.0, bars[2] + 12.0],
        ],
        1.4,
    );
    // The flywheel, turning about x.
    let r = (h * 0.2).min(d * 0.2);
    let wheel =
        m.x.translated([0.0, r + 8.0, zb + r * 0.9])
            .turned_z(FRAC_PI_2);
    m.p.material = Material::metal(Rgb8::from_u32(0xb9bcbc));
    m.p.cylinder(&wheel, [0.0, -2.0, 0.0], [r, r], 4.0, 24, true);
    m.p.material = frame;
    m.p.cylinder(
        &wheel,
        [0.0, -3.5, 0.0],
        [r * 0.95, r * 0.95],
        1.4,
        20,
        true,
    );
    m.p.cylinder(&wheel, [0.0, 2.1, 0.0], [r * 0.95, r * 0.95], 1.4, 20, true);
    // The cranks and pedals.
    for (sx, a) in [(-1.0, 0.6), (1.0, 0.6 + std::f64::consts::PI)] {
        let x = sx * 9.0;
        let end = [x, crank[1] + 17.0 * a.sin(), crank[2] + 17.0 * a.cos()];
        m.rod(frame, [x, crank[1], crank[2]], end, 1.2);
        m.blk(
            Material::paint(DARK),
            [x + sx * 4.0, end[1] - 1.0, end[2]],
            [8.0, 2.0, 10.0],
        );
    }
}

/// A pet's bed: an oval of soft bolster round a cushion.
pub(super) fn pet_bed(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.lathe(
        Material::fabric(c),
        [0.0; 3],
        &[
            [0.0, 0.0],
            [0.92, 0.0],
            [1.0, h * 0.4],
            [0.96, h * 0.85],
            [0.86, h],
            [0.74, h * 0.85],
            [0.7, h * 0.4],
            [0.62, h * 0.3],
            [0.0, h * 0.3],
        ],
        [w / 2.0, d / 2.0],
    );
    m.lathe(
        Material::fabric(Rgb8::from_u32(0xe9e1d0)),
        [0.0, h * 0.28, 0.0],
        &[
            [0.0, 0.0],
            [0.66, 0.0],
            [0.64, h * 0.1],
            [0.4, h * 0.14],
            [0.0, h * 0.12],
        ],
        [w / 2.0, d / 2.0],
    );
}

/// A cat tree: its base, posts wrapped in sisal, platforms, a den with its door, a toy on a
/// string.
pub(super) fn cat_tree(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let carpet = Material::fabric(c);
    let sisal = Material::new(Rgb8::from_u32(0xc9ad7c), 0.95, Surface::Fabric);
    m.soft(
        carpet,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, 4.0, d / 2.0],
        1.2,
    );
    let den = (h * 0.28).min(36.0);
    let (dx, dz) = (w * 0.2, d * 0.15);
    m.soft(
        carpet,
        [-w / 2.0 + 2.0, 4.0, -d / 2.0 + 2.0],
        [dx + 2.0, 4.0 + den, dz + 2.0],
        2.0,
    );
    let door =
        m.x.translated([(-w / 2.0 + dx + 4.0) / 2.0, 4.0 + den * 0.45, dz + 2.1])
            .turned_x(FRAC_PI_2);
    m.p.material = Material::paint(Rgb8::from_u32(0x2b2420));
    m.p.cylinder(&door, [0.0; 3], [den * 0.28, den * 0.28], 0.2, 16, true);
    let platforms = [
        (
            4.0 + den,
            [-w / 2.0 + 2.0, -d / 2.0 + 2.0],
            [dx + 2.0, dz + 2.0],
        ),
        (
            h * 0.52,
            [-w * 0.05, -d * 0.1],
            [w / 2.0 - 1.0, d / 2.0 - 1.0],
        ),
        (
            h * 0.78,
            [-w / 2.0 + 1.0, -d / 2.0 + 1.0],
            [w * 0.15, d * 0.2],
        ),
    ];
    for (y, lo, hi) in platforms {
        m.soft(carpet, [lo[0], y, lo[1]], [hi[0], y + 2.5, hi[1]], 1.0);
    }
    let posts: [(V3, f64); 3] = [
        ([w * 0.25, 4.0, d * 0.25], h * 0.52),
        ([-w * 0.3, 4.0 + den + 2.5, -d * 0.25], h * 0.78),
        ([w * 0.25, h * 0.52 + 2.5, d * 0.25], h - 6.0),
    ];
    for (at, top) in posts {
        m.cyl(sisal, at, [4.0, 4.0], top - at[1]);
    }
    m.lathe(
        carpet,
        [w * 0.25, h - 6.0, d * 0.25],
        &[
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 4.0],
            [0.92, 6.0],
            [0.82, 5.0],
            [0.0, 3.5],
        ],
        [
            (w / 2.0 - w * 0.25 - 0.5).min(14.0),
            (d / 2.0 - d * 0.25 - 0.5).min(14.0),
        ],
    );
    let hang = [w / 2.0 - 4.0, h * 0.52, d * 0.05];
    m.rod(
        Material::paint(Rgb8::from_u32(0xd8d0c0)),
        hang,
        [hang[0], hang[1] - 16.0, hang[2]],
        0.15,
    );
    m.sph(
        Material::fabric(Rgb8::from_u32(0xe8742a)),
        [hang[0], hang[1] - 18.0, hang[2]],
        [2.0, 2.0, 2.0],
    );
}

/// A covered litter box: its tray, its hood with the doorway in front, a handle on top;
/// `self-cleaning`, a globe turning on its base.
pub(super) fn litter_box(m: &mut Model<'_>, globe: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    let dark = Material::paint(Rgb8::from_u32(0x2b2420));
    if globe {
        let base = h * 0.3;
        m.soft(
            Material::satin(Rgb8::from_u32(0x3a3d40)),
            [-w / 2.0, 0.0, -d / 2.0],
            [w / 2.0, base, d / 2.0],
            4.0,
        );
        let r = (w / 2.0).min(h - base * 0.6) - 1.0;
        let centre = [0.0, h - r - 0.5, -d * 0.05];
        m.sph(body, centre, [r, r, r.min(d / 2.0)]);
        let door =
            m.x.translated([0.0, centre[1] - r * 0.15, centre[2] + r.min(d / 2.0) - 0.4])
                .turned_x(FRAC_PI_2 - 0.2);
        m.p.material = dark;
        m.p.ellipse_cylinder(
            &door,
            [0.0; 3],
            [r * 0.5, r * 0.42],
            [r * 0.5, r * 0.42],
            0.6,
            20,
            true,
        );
        m.bx(
            Material::paint(Rgb8::from_u32(0x4fbf72)),
            [-1.5, base - 3.0, d / 2.0 - 0.2],
            [1.5, base - 2.0, d / 2.0 + 0.2],
        );
        return;
    }
    let tray = h * 0.3;
    m.soft(
        Material::satin(shade(c, 0.85)),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, tray, d / 2.0],
        2.0,
    );
    m.soft(
        body,
        [-w / 2.0 + 0.5, tray - 0.5, -d / 2.0 + 0.5],
        [w / 2.0 - 0.5, h - 1.0, d / 2.0 - 0.5],
        (h * 0.2).min(8.0),
    );
    let door =
        m.x.translated([0.0, tray + (h - tray) * 0.4, d / 2.0 - 0.4])
            .turned_x(FRAC_PI_2);
    m.p.material = dark;
    m.p.ellipse_cylinder(
        &door,
        [0.0; 3],
        [w * 0.22, (h - tray) * 0.3],
        [w * 0.22, (h - tray) * 0.3],
        0.6,
        20,
        true,
    );
    m.bx(
        Material::satin(shade(c, 0.85)),
        [-w * 0.15, h - 1.5, -2.0],
        [w * 0.15, h, 2.0],
    );
}

/// A pet feeder: its hopper of kibble behind a clear window, its lid, its bowl in front, its
/// button.
pub(super) fn pet_feeder(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    let zb = d * 0.1;
    m.soft(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h - 3.0, zb], 2.5);
    m.soft(
        Material::satin(shade(c, 0.6)),
        [-w / 2.0 - 0.3, h - 3.5, -d / 2.0 - 0.3],
        [w / 2.0 + 0.3, h, zb + 0.3],
        1.5,
    );
    m.bx(
        Material::new(Rgb8::from_u32(0x9a6a3a), 0.9, Surface::Fabric),
        [-w / 2.0 + 3.0, h * 0.4, zb - 0.1],
        [w / 2.0 - 3.0, h * 0.7, zb + 0.05],
    );
    m.bx(
        Material::glass(),
        [-w / 2.0 + 2.5, h * 0.38, zb],
        [w / 2.0 - 2.5, h - 5.0, zb + 0.3],
    );
    m.soft(
        body,
        [-w / 2.0, 0.0, zb - 1.0],
        [w / 2.0, 4.0, d / 2.0],
        1.5,
    );
    let bowl = (w * 0.38).min((d / 2.0 - zb) * 0.9);
    m.lathe(
        Material::metal(STEEL),
        [0.0, 2.0, (zb + d / 2.0) / 2.0],
        &[
            [0.0, 0.0],
            [0.6, 0.0],
            [1.0, 3.5],
            [0.92, 3.5],
            [0.5, 0.6],
            [0.0, 0.6],
        ],
        [bowl, bowl],
    );
    m.cyl(
        Material::paint(Rgb8::from_u32(0x7fd3ff)),
        [0.0, h * 0.25, zb + 0.1],
        [1.2, 1.2],
        0.1,
    );
}

/// A car: its body in its side's outline, the windows of its cabin, the roof, its pillars, wheels
/// and lights, its nose to the front.
#[allow(clippy::too_many_lines)]
pub(super) fn car(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    // A car of other proportions keeps its shape: everything as shares of its length and height.
    let (l, t) = (d, h);
    let z = |share: f64| -l / 2.0 + l * share;
    let y = |share: f64| t * share;
    let r = (t * 0.215).min(l * 0.075);
    let (rear, front) = (z(0.2), z(0.795));
    let paint = Material::new(c, 0.22, Surface::Matte);
    let glass = Material::new(Rgb8::from_u32(0x24303a), 0.08, Surface::Screen);
    // The lower body, round the wheel arches.
    let arch = |centre: f64, from: f64, to: f64| -> Vec<[f64; 2]> {
        (0..=8)
            .map(|k| {
                let a = from + (to - from) * f64::from(k) / 8.0;
                [centre + (r + 4.0) * a.cos(), r + (r + 4.0) * a.sin()]
            })
            .collect()
    };
    let bottom = y(0.12).min(r);
    let reach = r + 4.0;
    let mut body = vec![
        [z(0.005), y(0.2)],
        [z(0.02), bottom],
        [rear - reach, bottom],
    ];
    body.extend(arch(rear, PI, 0.0));
    body.extend([[rear + reach, bottom], [front - reach, bottom]]);
    body.extend(arch(front, PI, 0.0));
    body.extend([
        [front + reach, bottom],
        [z(0.985), bottom],
        [z(1.0), y(0.28)],
        [z(0.995), y(0.42)],
        [z(0.95), y(0.55)],
        [z(0.8), y(0.64)],
        [z(0.74), y(0.65)],
        [z(0.18), y(0.67)],
        [z(0.04), y(0.62)],
        [z(0.0), y(0.45)],
    ]);
    m.side_slab(paint, &body, -w / 2.0 + 1.0, w / 2.0 - 1.0);
    // The cabin's glass, narrower, and its roof.
    let cabin = [
        [z(0.73), y(0.65)],
        [z(0.56), y(0.95)],
        [z(0.25), y(0.96)],
        [z(0.13), y(0.67)],
    ];
    let inset = w * 0.07;
    m.side_slab(glass, &cabin, -w / 2.0 + inset, w / 2.0 - inset);
    let roof = [
        [z(0.575), y(0.935)],
        [z(0.55), y(1.0) - 0.5],
        [z(0.27), y(1.0)],
        [z(0.245), y(0.95)],
    ];
    m.side_slab(paint, &roof, -w / 2.0 + inset + 1.5, w / 2.0 - inset - 1.5);
    // The pillars at each side: by the windscreen, between the doors, by the back window.
    for sx in [-1.0, 1.0] {
        let x = sx * (w / 2.0 - inset - 0.2);
        for (a, b) in [
            (cabin[0], [z(0.575), y(0.94)]),
            ([z(0.42), y(0.66)], [z(0.42), y(0.96)]),
            ([z(0.15), y(0.68)], [z(0.255), y(0.95)]),
        ] {
            m.rod(paint, [x, a[1], a[0]], [x, b[1], b[0]], 2.4);
        }
        // A mirror by the windscreen.
        let mirror = [sx * (w / 2.0 - 4.0), y(0.66), z(0.71)];
        m.soft(
            paint,
            [mirror[0] - 4.0, mirror[1], mirror[2] - 3.0],
            [mirror[0] + 4.0, mirror[1] + 7.0, mirror[2] + 3.0],
            1.5,
        );
    }
    // Wheels: tyres and their rims.
    for zc in [rear, front] {
        for sx in [-1.0, 1.0] {
            let hub =
                m.x.translated([sx * (w / 2.0 - 12.0), r, zc])
                    .turned_z(FRAC_PI_2);
            m.p.material = Material::new(Rgb8::from_u32(0x1b1c1d), 0.85, Surface::Matte);
            m.p.cylinder(&hub, [0.0, -10.0, 0.0], [r, r], 20.0, 20, true);
            m.p.material = Material::metal(Rgb8::from_u32(0xc0c4c4));
            let side = if sx > 0.0 { -10.4 } else { 10.0 };
            m.p.cylinder(&hub, [0.0, side, 0.0], [r * 0.62, r * 0.62], 0.4, 16, true);
        }
    }
    // Lights, the grille and the plates.
    let lamp = Material::new(Rgb8::from_u32(0xf3f1ea), 0.15, Surface::Matte);
    let tail = Material::new(Rgb8::from_u32(0xb3202a), 0.2, Surface::Matte);
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * (w / 2.0 - 10.0), sx * (w / 2.0 - 34.0));
        m.bx(
            lamp,
            [a.min(b), y(0.44), z(0.985)],
            [a.max(b), y(0.5), z(0.996)],
        );
        m.bx(
            tail,
            [a.min(b), y(0.52), z(0.002)],
            [a.max(b), y(0.58), z(0.015)],
        );
    }
    m.bx(
        Material::paint(PLASTIC),
        [-w * 0.22, y(0.22), z(0.993)],
        [w * 0.22, y(0.36), z(1.0)],
    );
    let plate = Material::paint(Rgb8::from_u32(0xf3f1ea));
    m.bx(
        plate,
        [-w * 0.13, y(0.3), z(1.0) - 0.2],
        [w * 0.13, y(0.37), z(1.0) + 0.2],
    );
    m.bx(
        plate,
        [-w * 0.13, y(0.3), z(0.0) - 0.6],
        [w * 0.13, y(0.37), z(0.0) - 0.2],
    );
}
