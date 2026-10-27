//! The bedroom's and the bathroom's pieces of the library (D-074): a cot, bunk beds, a clothes
//! rail, showers, a towel radiator, a laundry basket, and other styles of beds, tubs, toilets,
//! basins and wardrobes.

use std::f64::consts::TAU;

use super::{
    CHROME, Material, Model, Rgb8, STEEL, Surface, WHITE, WOOD_DARK, faucet, shade, surface,
};

/// Bars between `a` and `b` (plan points of the model, `x`, `z`) from `y0` to `y1`, no more
/// than `gap` apart: a cot's or a rail's.
fn bars(m: &mut Model<'_>, a: [f64; 2], b: [f64; 2], y: [f64; 2], gap: f64, r: f64) {
    let length = (b[0] - a[0]).hypot(b[1] - a[1]);
    let count = (length / gap).ceil().max(1.0);
    let material = m.p.material;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    for k in 1..count as usize {
        #[allow(clippy::cast_precision_loss)]
        let t = k as f64 / count;
        let (x, z) = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        m.twig(material, [x, y[0], z], [x, y[1], z], r);
    }
}

/// A mattress, its sheet and duvet over the foot two thirds, and a pillow at the head (`-z`),
/// between `x0` and `x1` from `z0` to `z1`, `y0` to `y1`.
fn bedding(m: &mut Model<'_>, x: [f64; 2], y: [f64; 2], z: [f64; 2], duvet: Rgb8, pillow: bool) {
    let [x0, x1] = x;
    let [y0, y1] = y;
    let [z0, z1] = z;
    m.soft(
        Material::fabric(Rgb8::from_u32(0xf3f1ec)),
        [x0, y0, z0],
        [x1, y1, z1],
        3.0,
    );
    let fold = z0 + (z1 - z0) * 0.32;
    m.soft(
        Material::fabric(duvet),
        [x0 - 0.5, y1 - 6.0, fold],
        [x1 + 0.5, y1 + 2.5, z1 + 0.5],
        2.4,
    );
    m.soft(
        Material::fabric(shade(duvet, 1.08)),
        [x0 - 0.4, y1 + 0.5, fold - 1.0],
        [x1 + 0.4, y1 + 3.5, fold + 12.0],
        1.3,
    );
    if pillow {
        let pw = (x1 - x0 - 8.0).min(60.0);
        let cx = (x0 + x1) / 2.0;
        m.soft(
            Material::fabric(WHITE),
            [cx - pw / 2.0, y1 - 1.0, z0 + 3.0],
            [
                cx + pw / 2.0,
                y1 + 9.0,
                z0 + 3.0 + (fold - z0 - 6.0).min(36.0),
            ],
            4.0,
        );
    }
}

/// A cot: four posts, rails and bars all round no more than 6.5 cm apart, a mattress inside and
/// a small blanket.
pub(super) fn crib(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    let post = 4.5_f64.min(w * 0.1);
    let base = (h * 0.33).min(32.0);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.blk(
                wood,
                [
                    sx * (w / 2.0 - post / 2.0),
                    0.0,
                    sz * (d / 2.0 - post / 2.0),
                ],
                [post, h, post],
            );
        }
    }
    let (xi, zi) = (w / 2.0 - post / 2.0, d / 2.0 - post / 2.0);
    for (a, b) in [
        ([-xi, -zi], [xi, -zi]),
        ([-xi, zi], [xi, zi]),
        ([-xi, -zi], [-xi, zi]),
        ([xi, -zi], [xi, zi]),
    ] {
        let (lo, hi) = (
            [a[0].min(b[0]), a[1].min(b[1])],
            [a[0].max(b[0]), a[1].max(b[1])],
        );
        for (y0, y1) in [(base - 4.0, base), (h - 4.0, h)] {
            m.bx(
                wood,
                [lo[0] - 1.2, y0, lo[1] - 1.2],
                [hi[0] + 1.2, y1, hi[1] + 1.2],
            );
        }
        m.p.material = wood;
        bars(m, a, b, [base, h - 4.0], 6.0, 0.9);
    }
    m.soft(
        Material::fabric(Rgb8::from_u32(0xf6f4ee)),
        [-xi + 1.0, base - 4.0, -zi + 1.0],
        [xi - 1.0, base + 7.0, zi - 1.0],
        2.5,
    );
    m.soft(
        Material::fabric(Rgb8::from_u32(0xb9cfe0)),
        [-xi + 3.0, base + 6.0, 0.0],
        [xi - 3.0, base + 9.0, zi - 4.0],
        1.2,
    );
}

/// Bunk beds: two beds one over the other between four posts, the upper one's guard rails, and a
/// ladder at its foot.
pub(super) fn bunk_bed(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    let post = 5.5_f64.min(w * 0.08);
    // Room at the foot for the ladder.
    let ladder = 4.0_f64.min(d * 0.05);
    let (xi, zi) = (w / 2.0 - post / 2.0, d / 2.0 - post / 2.0 - ladder / 2.0);
    let z0 = -ladder / 2.0;
    // The head and the foot.
    let (zh, zf) = (z0 - zi, z0 + zi);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.blk(wood, [sx * xi, 0.0, z0 + sz * zi], [post, h, post]);
        }
    }
    let lower = (h * 0.14).min(24.0);
    let upper = (h * 0.62).max(lower + 70.0).min(h - 25.0);
    for y in [lower, upper] {
        for sx in [-1.0, 1.0] {
            m.bx(wood, [sx * xi - 1.5, y, zh], [sx * xi + 1.5, y + 13.0, zf]);
        }
        for sz in [-1.0, 1.0] {
            m.bx(
                wood,
                [-xi, y, (z0 + sz * zi) - 1.5],
                [xi, y + 13.0, (z0 + sz * zi) + 1.5],
            );
        }
        bedding(
            m,
            [-xi + 1.5, xi - 1.5],
            [y + 4.0, y + 17.0],
            [zh + 1.5, zf - 1.5],
            if y < upper {
                Rgb8::from_u32(0x7d95b5)
            } else {
                Rgb8::from_u32(0xd9a35f)
            },
            true,
        );
    }
    // The upper bed's guard rails, the head end's panel.
    let top = h - 2.0;
    for sx in [-1.0, 1.0] {
        m.bx(
            wood,
            [sx * xi - 1.5, top - 5.0, zh],
            [sx * xi + 1.5, top, zf],
        );
    }
    m.bx(wood, [-xi, upper + 13.0, zh - 1.5], [xi, top, zh + 1.5]);
    m.bx(
        wood,
        [-xi, lower + 13.0, zh - 1.5],
        [xi, lower + 40.0, zh + 1.5],
    );
    // The ladder at the foot, standing off it.
    let lx = xi * 0.45;
    let z = zf + post / 2.0 + 1.5;
    for sx in [-1.0, 1.0] {
        m.bx(
            wood,
            [sx * lx - 1.6, 0.0, z - 1.6],
            [sx * lx + 1.6, top, z + 1.6],
        );
    }
    let rungs = ((top - 20.0) / 25.0).floor().max(1.0);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    for k in 1..=rungs as usize {
        #[allow(clippy::cast_precision_loss)]
        let y = 10.0 + (top - 20.0) * k as f64 / (rungs + 1.0);
        m.rod(wood, [-lx, y, z], [lx, y, z], 1.4);
    }
    m.bx(wood, [-xi, top - 5.0, zf - 1.5], [xi, top, zf + 1.5]);
}

/// A clothes rail: two uprights on their feet, the rail, a shelf for shoes, and clothes on their
/// hangers.
pub(super) fn clothes_rack(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::metal(c);
    let x = w / 2.0 - 2.0;
    for sx in [-1.0, 1.0] {
        m.rod(
            metal,
            [sx * x, 2.0, -d / 2.0 + 2.0],
            [sx * x, 2.0, d / 2.0 - 2.0],
            1.2,
        );
        m.rod(metal, [sx * x, 2.0, 0.0], [sx * x, h - 2.0, 0.0], 1.4);
    }
    m.rod(metal, [-x, h - 2.0, 0.0], [x, h - 2.0, 0.0], 1.4);
    m.bx(
        Material::wood(Rgb8::from_u32(0xb18455)),
        [-x, 12.0, -d / 2.0 + 4.0],
        [x, 14.0, d / 2.0 - 4.0],
    );
    let colours = [
        0x2f4f6f, 0xe6e1d6, 0x8b3a2e, 0x3d5a40, 0x2b2b2b, 0xc98b3c, 0x6b4f7a,
    ];
    let count = ((w - 20.0) / 14.0).floor().clamp(1.0, 9.0);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    for k in 0..count as usize {
        #[allow(clippy::cast_precision_loss)]
        let cx = -x + 10.0 + (2.0 * x - 20.0) * (k as f64 + 0.5) / count;
        let long = (h - 30.0) * (0.42 + 0.35 * m.rng.next());
        let top = h - 7.0;
        let half = (d / 2.0 - 3.0).min(21.0);
        m.rod(
            Material::metal(STEEL),
            [cx, top, 0.0],
            [cx, h - 1.0, 0.0],
            0.3,
        );
        m.rod(
            Material::wood(Rgb8::from_u32(0x8a6a4a)),
            [cx, top, -half * 0.9],
            [cx, top, half * 0.9],
            0.5,
        );
        let fabric = Material::fabric(Rgb8::from_u32(colours[k % colours.len()]));
        m.soft(
            fabric,
            [cx - 1.6, top - long, -half],
            [cx + 1.6, top - 0.5, half],
            1.2,
        );
    }
    for k in 0..2 {
        let z = (f64::from(k) - 0.5) * 12.0;
        m.soft(
            Material::new(Rgb8::from_u32(0x3a2b20), 0.5, Surface::Matte),
            [-x + 10.0, 14.0, z - 4.0],
            [-x + 18.0, 21.0, z + 4.0],
            2.0,
        );
    }
}

/// The colour of shower glass seen edge on: its frame.
const FRAME: Rgb8 = Rgb8::from_u32(0xc9cdcd);

/// A shower's column on the back wall at `x`: the bar, the rain head on its arm, the hand shower
/// and the mixer.
fn column(m: &mut Model<'_>, x: f64, h: f64, back: f64) {
    let chrome = Material::metal(CHROME);
    let z = back + 3.0;
    m.rod(chrome, [x, 95.0, z], [x, h - 8.0, z], 1.1);
    m.rod(chrome, [x, h - 8.0, z], [x, h - 8.0, z + 25.0], 0.9);
    m.cyl(chrome, [x, h - 10.0, z + 25.0], [11.0, 11.0], 1.2);
    m.bx(chrome, [x - 4.0, 100.0, z - 2.0], [x + 4.0, 106.0, z + 3.5]);
    m.rod(
        chrome,
        [x + 6.0, 130.0, z + 1.5],
        [x + 6.0, 150.0, z + 4.0],
        1.3,
    );
    m.cyl(chrome, [x + 6.0, 150.0, z + 4.0], [3.5, 3.5], 1.0);
}

/// A shower: a tray, glass round the open sides with a door, a column on the back wall; `walk-in`,
/// a flush floor with one panel of glass; `quadrant`, its front a curve of glass.
pub(super) fn shower(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let glass = Material::glass();
    let frame = Material::metal(FRAME);
    let pane = |m: &mut Model<'_>, a: [f64; 2], b: [f64; 2], y0: f64, y1: f64| {
        let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
        let len = dx.hypot(dz);
        if len < 1.0 {
            return;
        }
        let at = m.x.translated([a[0], y0, a[1]]).turned_y(-dz.atan2(dx));
        m.bx_in(glass, &at, [0.0, 0.0, -0.4], [len, y1 - y0, 0.4]);
        m.bx_in(frame, &at, [0.0, y1 - y0 - 1.5, -0.8], [len, y1 - y0, 0.8]);
    };
    match variant {
        Some("walk-in") => {
            m.bx(
                Material::new(Rgb8::from_u32(0xb8b6ae), 0.4, Surface::Tiles),
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, 1.2, d / 2.0],
            );
            m.bx(
                Material::metal(STEEL),
                [-w / 2.0 + 8.0, 1.2, -d / 2.0 + 4.0],
                [w / 2.0 - 8.0, 1.35, -d / 2.0 + 8.0],
            );
            let x = w / 2.0 - w * 0.4;
            pane(m, [x, d / 2.0 - 1.0], [x, -d / 2.0 + 1.0], 1.2, h - 5.0);
            // Its arm to the wall.
            m.rod(frame, [x, h - 6.0, 0.0], [x, h - 6.0, -d / 2.0], 0.8);
            column(m, -w / 2.0 + w * 0.3, h, -d / 2.0);
        }
        Some("quadrant") => {
            let r = (w.min(d) - 20.0).max(w.min(d) * 0.6);
            let (cx, cz) = (w / 2.0 - r, d / 2.0 - r);
            let corner = |a: f64| [cx + r * a.cos(), cz + r * a.sin()];
            // The tray: the room's corner at the back left, its front the curve.
            let mut outline = vec![[-w / 2.0, -d / 2.0], [w / 2.0, -d / 2.0]];
            outline.push([w / 2.0, cz]);
            for k in 1..8 {
                outline.push(corner(f64::from(k) / 8.0 * TAU / 4.0));
            }
            outline.push([cx, d / 2.0]);
            outline.push([-w / 2.0, d / 2.0]);
            m.plate(Material::ceramic(c), &outline, 0.0, 5.0);
            m.cyl(
                Material::metal(STEEL),
                [-w * 0.1, 5.0, -d * 0.1],
                [4.0, 4.0],
                0.15,
            );
            pane(
                m,
                [w / 2.0 - 0.6, -d / 2.0 + 1.0],
                [w / 2.0 - 0.6, cz],
                5.0,
                h - 5.0,
            );
            pane(
                m,
                [cx, d / 2.0 - 0.6],
                [-w / 2.0 + 1.0, d / 2.0 - 0.6],
                5.0,
                h - 5.0,
            );
            for k in 0..8 {
                let a0 = f64::from(k) / 8.0 * TAU / 4.0;
                let a1 = f64::from(k + 1) / 8.0 * TAU / 4.0;
                let (p, q) = (corner(a0), corner(a1));
                pane(
                    m,
                    [p[0] - 0.6 * a0.cos(), p[1] - 0.6 * a0.sin()],
                    [q[0] - 0.6 * a1.cos(), q[1] - 0.6 * a1.sin()],
                    5.0,
                    h - 5.0,
                );
            }
            column(m, -w / 2.0 + w * 0.35, h, -d / 2.0);
        }
        _ => {
            m.soft(
                Material::ceramic(c),
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, 5.0, d / 2.0],
                1.0,
            );
            m.cyl(Material::metal(STEEL), [0.0, 5.0, 0.0], [4.0, 4.0], 0.15);
            let (xr, zf) = (w / 2.0 - 1.0, d / 2.0 - 1.0);
            pane(m, [xr, -d / 2.0 + 1.0], [xr, zf], 5.0, h - 5.0);
            pane(
                m,
                [-w / 2.0 + 1.0, zf],
                [-w / 2.0 + w * 0.52, zf],
                5.0,
                h - 5.0,
            );
            pane(
                m,
                [-w / 2.0 + w * 0.48, zf - 1.5],
                [xr, zf - 1.5],
                5.0,
                h - 5.0,
            );
            for (x, z) in [(xr, zf), (-w / 2.0 + 1.0, zf), (xr, -d / 2.0 + 1.0)] {
                m.bx(frame, [x - 0.8, 5.0, z - 0.8], [x + 0.8, h - 5.0, z + 0.8]);
            }
            m.rod(
                frame,
                [-w / 2.0 + w * 0.48 + 3.0, h * 0.5, zf],
                [-w / 2.0 + w * 0.48 + 3.0, h * 0.5 + 25.0, zf],
                0.7,
            );
            column(m, -w / 2.0 + w * 0.32, h, -d / 2.0);
        }
    }
}

/// A towel radiator: its two uprights, its rails in groups, a towel over one of them.
pub(super) fn towel_radiator(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let paint = Material::satin(c);
    let x = w / 2.0 - 1.8;
    let z = d / 2.0 - 2.0;
    for sx in [-1.0, 1.0] {
        m.cyl(paint, [sx * x, 0.0, z], [1.6, 1.6], h);
        for y in [h * 0.12, h * 0.85] {
            m.rod(paint, [sx * x, y, z], [sx * x, y, -d / 2.0], 1.0);
        }
    }
    let groups = ((h / 38.0).round() as usize).clamp(1, 5);
    let per = 5;
    #[allow(clippy::cast_precision_loss)]
    let band = h / groups as f64;
    for g in 0..groups {
        for k in 0..per {
            #[allow(clippy::cast_precision_loss)]
            let y = band * g as f64 + 5.0 + f64::from(k) * (band - 12.0) / f64::from(per - 1);
            m.rod(paint, [-x, y, z], [x, y, z], 1.0);
        }
    }
    // A towel folded over the top group's rail.
    let rail = h - 5.0 - (band - 12.0) * 0.25;
    let towel = Material::fabric(Rgb8::from_u32(0xe9e1d0));
    let hang = (h * 0.32).min(40.0);
    m.soft(
        towel,
        [-x * 0.8, rail - hang, z + 1.2],
        [x * 0.8, rail + 1.4, z + 2.4],
        0.5,
    );
    m.soft(
        towel,
        [-x * 0.8, rail - hang * 0.7, z - 2.4],
        [x * 0.8, rail + 1.4, z - 1.2],
        0.5,
    );
}

/// A laundry basket of woven rush, open, a few clothes in it, its two handles.
pub(super) fn laundry_basket(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let rush = Material::new(c, 0.9, Surface::Fabric);
    m.lathe(
        rush,
        [0.0; 3],
        &[
            [0.0, 0.0],
            [0.84, 0.0],
            [1.0, h],
            [0.94, h],
            [0.79, 2.0],
            [0.0, 2.0],
        ],
        [w / 2.0, d / 2.0],
    );
    m.sph(
        Material::fabric(Rgb8::from_u32(0x7d95b5)),
        [-w * 0.08, h * 0.82, 0.0],
        [w * 0.32, h * 0.18, d * 0.3],
    );
    m.sph(
        Material::fabric(WHITE),
        [w * 0.12, h * 0.86, d * 0.05],
        [w * 0.25, h * 0.15, d * 0.25],
    );
    for sx in [-1.0, 1.0] {
        m.bx(
            Material::paint(shade(c, 0.5)),
            [sx * w / 2.0 * 0.98 - 0.6, h * 0.8, -4.0],
            [sx * w / 2.0 * 0.98 + 0.6, h * 0.88, 4.0],
        );
    }
}

/// A freestanding bath: an oval of enamel with a rolled rim, on four feet, its tap standing on
/// the floor at one end.
pub(super) fn freestanding_bath(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let enamel = Material::ceramic(c);
    let feet = (h * 0.14).min(10.0);
    let profile = [
        [0.0, feet],
        [0.78, feet],
        [0.92, feet + (h - feet) * 0.4],
        [0.98, h - 2.0],
        [1.0, h],
        [0.95, h + 0.4],
        [0.91, h - 1.5],
        [0.84, feet + (h - feet) * 0.5],
        [0.72, feet + 5.0],
        [0.0, feet + 5.0],
    ];
    m.lathe(enamel, [0.0; 3], &profile, [w / 2.0 - 1.0, d / 2.0 - 1.0]);
    let brass = Material::metal(super::GOLD);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.sph(
                brass,
                [sx * w * 0.3, feet * 0.55, sz * d * 0.25],
                [2.6, feet * 0.55, 2.6],
            );
        }
    }
    let chrome = Material::metal(CHROME);
    let x = w / 2.0 - 4.0;
    m.pipe(
        chrome,
        &[
            [x, 0.0, 0.0],
            [x, h + 12.0, 0.0],
            [x - 4.0, h + 20.0, 0.0],
            [x - 13.0, h + 20.0, 0.0],
            [x - 15.0, h + 14.0, 0.0],
        ],
        1.3,
    );
    m.cyl(chrome, [x, 0.0, 0.0], [3.5, 3.0], 1.2);
}

/// A wall-hung toilet: its bowl clear of the floor, its cistern boxed in the wall behind, and the
/// flush plate.
pub(super) fn wall_hung_toilet(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let porcelain = Material::ceramic(c);
    let boxed = (d * 0.25).min(16.0);
    m.bx(
        Material::satin(Rgb8::from_u32(0xeceae4)),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h, -d / 2.0 + boxed],
    );
    m.bx(
        Material::metal(CHROME),
        [-11.0, h - 18.0, -d / 2.0 + boxed],
        [11.0, h - 3.0, -d / 2.0 + boxed + 0.6],
    );
    for sx in [-1.0, 1.0] {
        m.bx(
            Material::paint(WHITE),
            [sx * 5.5 - 4.5, h - 15.5, -d / 2.0 + boxed + 0.6],
            [sx * 5.5 + 4.5, h - 5.5, -d / 2.0 + boxed + 0.9],
        );
    }
    let seat = 40.0_f64.min(h * 0.5);
    let (zc, rz) = ((-d / 2.0 + boxed + d / 2.0) / 2.0, (d - boxed) / 2.0);
    m.p.material = porcelain;
    m.p.ellipse_cylinder(
        &m.x,
        [0.0, seat - 14.0, zc],
        [w * 0.3, rz * 0.6],
        [w * 0.48, rz * 0.96],
        11.0,
        super::ROUND,
        true,
    );
    m.p.ellipse_cylinder(
        &m.x,
        [0.0, seat - 3.0, zc],
        [w * 0.48, rz * 0.96],
        [w * 0.48, rz * 0.96],
        3.0,
        super::ROUND,
        true,
    );
    m.bx(
        porcelain,
        [-w * 0.3, seat - 14.0, -d / 2.0 + boxed],
        [w * 0.3, seat - 3.0, zc - rz * 0.5],
    );
}

/// A basin on its pedestal: a turned column under a bowl, its tap.
pub(super) fn pedestal_basin(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let porcelain = Material::ceramic(c);
    let bowl = (h * 0.2).min(18.0);
    m.lathe(
        porcelain,
        [0.0, 0.0, -d * 0.1],
        &[
            [0.0, 0.0],
            [9.0, 0.0],
            [7.0, 6.0],
            [6.0, (h - bowl) * 0.6],
            [7.5, h - bowl],
            [0.0, h - bowl],
        ],
        [1.0, 1.0],
    );
    m.lathe(
        porcelain,
        [0.0, h - bowl, 0.0],
        &[
            [0.0, 0.0],
            [0.5, 0.0],
            [0.92, bowl * 0.6],
            [1.0, bowl],
            [0.92, bowl],
            [0.6, bowl * 0.35],
            [0.0, bowl * 0.3],
        ],
        [w / 2.0, d / 2.0],
    );
    faucet(m, [0.0, h - 1.0, -d / 2.0 + 4.0]);
}

/// A vanity unit with two basins: drawers under a top of ceramic with a basin and a tap each.
pub(super) fn double_vanity(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = surface(c);
    m.bx(
        body,
        [-w / 2.0, 15.0, -d / 2.0],
        [w / 2.0, h - 4.0, d / 2.0],
    );
    m.fronts(Material::satin(shade(c, 1.04)), 16.0, h - 5.0, 2, 2, true);
    m.bx(
        Material::ceramic(WHITE),
        [-w / 2.0, h - 4.0, -d / 2.0],
        [w / 2.0, h, d / 2.0 + 1.0],
    );
    for sx in [-1.0, 1.0] {
        let x = sx * w / 4.0;
        let bw = (w / 2.0 - 14.0).min(45.0);
        m.bx(
            Material::ceramic(shade(WHITE, 0.88)),
            [x - bw / 2.0, h - 0.3, -d / 2.0 + 10.0],
            [x + bw / 2.0, h + 0.05, d / 2.0 - 5.0],
        );
        faucet(m, [x, h, -d / 2.0 + 5.0]);
    }
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.blk(
                Material::metal(STEEL),
                [sx * (w / 2.0 - 4.0), 0.0, sz * (d / 2.0 - 4.0)],
                [2.5, 15.0, 2.5],
            );
        }
    }
}

/// A wardrobe with two sliding doors, one of them a mirror, on their rails.
pub(super) fn sliding_wardrobe(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = surface(c);
    m.bx(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0 - 4.0]);
    let rail = Material::metal(Rgb8::from_u32(0xa8acab));
    m.bx(
        rail,
        [-w / 2.0, h - 4.0, d / 2.0 - 4.0],
        [w / 2.0, h, d / 2.0],
    );
    m.bx(
        rail,
        [-w / 2.0, 0.0, d / 2.0 - 4.0],
        [w / 2.0, 3.0, d / 2.0],
    );
    let half = w / 2.0 + 2.0;
    let front = Material::satin(shade(c, 1.04));
    m.bx(
        front,
        [-w / 2.0 + 0.5, 3.0, d / 2.0 - 3.5],
        [-w / 2.0 + half, h - 4.0, d / 2.0 - 2.2],
    );
    m.bx(
        rail,
        [w / 2.0 - half, 3.0, d / 2.0 - 1.8],
        [w / 2.0 - 0.5, h - 4.0, d / 2.0 - 0.4],
    );
    m.bx(
        Material::new(Rgb8::from_u32(0xeef3f4), 0.02, Surface::Mirror),
        [w / 2.0 - half + 2.0, 5.0, d / 2.0 - 0.4],
        [w / 2.0 - 2.5, h - 6.0, d / 2.0 - 0.2],
    );
    m.bx(
        rail,
        [-w / 2.0 + half - 3.0, h * 0.4, d / 2.0 - 2.2],
        [-w / 2.0 + half - 1.5, h * 0.6, d / 2.0 - 1.8],
    );
}

/// A bed whose headboard and frame are upholstered: the headboard in padded channels.
pub(super) fn upholstered_bed(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let fabric = Material::fabric(Rgb8::from_u32(0x8f8a80));
    let low = (h - 22.0).max(20.0);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.cyl(
                Material::wood(WOOD_DARK),
                [sx * (w / 2.0 - 6.0), 0.0, sz * (d / 2.0 - 6.0)],
                [1.6, 2.2],
                6.5,
            );
        }
    }
    m.soft(
        fabric,
        [-w / 2.0, 6.0, -d / 2.0 + 6.0],
        [w / 2.0, low + 2.0, d / 2.0],
        3.0,
    );
    let channels = ((w / 22.0).round() as usize).clamp(3, 10);
    #[allow(clippy::cast_precision_loss)]
    let cw = (w + 4.0) / channels as f64;
    for k in 0..channels {
        #[allow(clippy::cast_precision_loss)]
        let x0 = -w / 2.0 - 2.0 + cw * k as f64;
        m.soft(
            fabric,
            [x0 + 0.3, 6.0, -d / 2.0],
            [x0 + cw - 0.3, h + 60.0, -d / 2.0 + 8.0],
            3.5,
        );
    }
    bedding(
        m,
        [-w / 2.0 + 2.0, w / 2.0 - 2.0],
        [low, h],
        [-d / 2.0 + 8.0, d / 2.0 - 1.0],
        c,
        false,
    );
    pillows(m, h, -d / 2.0 + 10.0);
}

/// Pillows at the head of a bed, its mattress's top at `y`.
fn pillows(m: &mut Model<'_>, y: f64, z: f64) {
    let w = m.w;
    let count = if w > 120.0 { 2 } else { 1 };
    #[allow(clippy::cast_precision_loss)]
    let pw = (w - 12.0) / f64::from(count);
    for k in 0..count {
        let x0 = -w / 2.0 + 6.0 + pw * f64::from(k);
        m.soft(
            Material::fabric(WHITE),
            [x0 + 3.0, y - 1.0, z],
            [x0 + pw - 3.0, y + 11.0, z + 28.0],
            4.5,
        );
    }
}

/// A four-poster bed: its frame and headboard of wood, a turned post at each corner and the rails
/// of its canopy over it.
pub(super) fn four_poster(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = Material::wood(Rgb8::from_u32(0x6e4a30));
    let low = (h - 22.0).max(20.0);
    let top = (h + 150.0).min(h + m.ceiling - 5.0).max(h + 60.0);
    m.bx(
        wood,
        [-w / 2.0, 12.0, -d / 2.0],
        [w / 2.0, low + 1.0, d / 2.0],
    );
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            let at = [sx * (w / 2.0 - 3.0), 0.0, sz * (d / 2.0 - 3.0)];
            m.lathe(
                wood,
                at,
                &[
                    [3.4, 0.0],
                    [3.4, 14.0],
                    [2.4, 18.0],
                    [2.0, top * 0.5],
                    [2.6, top * 0.55],
                    [2.0, top * 0.6],
                    [1.8, top - 3.0],
                    [2.6, top - 2.0],
                    [0.0, top + 1.0],
                ],
                [1.0, 1.0],
            );
        }
    }
    for sz in [-1.0, 1.0] {
        let z = sz * (d / 2.0 - 3.0);
        m.bx(
            wood,
            [-w / 2.0 + 3.0, top - 6.0, z - 1.5],
            [w / 2.0 - 3.0, top - 3.0, z + 1.5],
        );
    }
    for sx in [-1.0, 1.0] {
        let x = sx * (w / 2.0 - 3.0);
        m.bx(
            wood,
            [x - 1.5, top - 6.0, -d / 2.0 + 3.0],
            [x + 1.5, top - 3.0, d / 2.0 - 3.0],
        );
    }
    m.bx(
        wood,
        [-w / 2.0 + 4.0, low, -d / 2.0 + 1.5],
        [w / 2.0 - 4.0, h + 55.0, -d / 2.0 + 4.0],
    );
    m.bx(
        wood,
        [-w / 2.0 + 4.0, low - 6.0, d / 2.0 - 4.0],
        [w / 2.0 - 4.0, h + 8.0, d / 2.0 - 2.0],
    );
    bedding(
        m,
        [-w / 2.0 + 4.0, w / 2.0 - 4.0],
        [low, h],
        [-d / 2.0 + 4.5, d / 2.0 - 4.5],
        c,
        false,
    );
    pillows(m, h, -d / 2.0 + 6.0);
}
