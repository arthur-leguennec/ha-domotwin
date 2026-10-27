//! The living room's pieces of the library (D-070): a corner sofa, footstools, a TV stand, rugs,
//! fireplaces, pianos, speakers, a rocking chair, benches, an aquarium and what stands on shelves.

use std::f64::consts::{FRAC_PI_2, PI, TAU};

use super::{
    Blade, DARK, GOLD, Material, Model, Rgb8, STEEL, Surface, V3, WOOD_DARK, shade, strap, surface,
};

/// Lacquer that shines (a piano, a speaker's cabinet).
fn lacquer(c: Rgb8) -> Material {
    Material::new(c, 0.18, Surface::Matte)
}

/// A corner sofa (an L): its main part along the back, its chaise coming forward on the right
/// seen from the front (`left`: on the left), a back along both and an arm at each end.
pub(super) fn corner_sofa(m: &mut Model<'_>, left: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let fabric = Material::fabric(c);
    let cushion = Material {
        color: shade(c, 1.07),
        ..fabric
    };
    let s = if left { -1.0 } else { 1.0 };
    let arm = (w * 0.07).clamp(6.0, 17.0);
    let back = (d * 0.12).clamp(8.0, 20.0);
    let seat_d = (d * 0.56)
        .clamp(40.0, 105.0)
        .min(d - arm - 10.0)
        .max(d * 0.3);
    let chaise = (w * 0.34)
        .clamp(40.0, 110.0)
        .min(w - arm - 20.0)
        .max(w * 0.2);
    let leg_h = 9.0_f64.min(h * 0.15);
    let seat_top = (h * 0.55).min(46.0);
    let base_top = seat_top - 12.0_f64.min(seat_top * 0.3);
    let arm_top = (h * 0.74).min(seat_top + 18.0);
    let (xl, xr, xc) = (-w / 2.0, w / 2.0, w / 2.0 - chaise);
    let (zb, zs, zf) = (-d / 2.0, -d / 2.0 + seat_d, d / 2.0);
    // A soft block from `x0` to `x1` on the chaise's side (mirrored for `left`).
    let block =
        |m: &mut Model<'_>, mat: Material, x: [f64; 2], y: [f64; 2], z: [f64; 2], r: f64| {
            let (a, b) = (s * x[0], s * x[1]);
            m.soft(mat, [a.min(b), y[0], z[0]], [a.max(b), y[1], z[1]], r);
        };
    let leg = Material::wood(WOOD_DARK);
    for (x, z) in [
        (xl + 7.0, zb + 6.0),
        (xr - 7.0, zb + 6.0),
        (xl + 7.0, zs - 6.0),
        (xc + 7.0, zf - 6.0),
        (xr - 7.0, zf - 6.0),
    ] {
        m.cyl(leg, [s * x, 0.0, z], [1.8, 1.4], leg_h);
    }
    block(m, fabric, [xl, xr], [leg_h, base_top], [zb, zs], 2.5);
    block(m, fabric, [xc, xr], [leg_h, base_top], [zs - 1.0, zf], 2.5);
    block(m, fabric, [xl, xl + arm], [leg_h, arm_top], [zb, zs], 4.5);
    block(m, fabric, [xc, xr], [leg_h, arm_top], [zf - arm, zf], 4.5);
    block(m, fabric, [xl + arm, xr], [leg_h, h], [zb, zb + back], 4.0);
    block(
        m,
        fabric,
        [xr - back, xr],
        [leg_h, h],
        [zb + back, zf - arm],
        4.0,
    );
    // Seat cushions: the main part's, the corner's and the chaise's.
    let inner = xc - (xl + arm);
    let n = if inner > 150.0 {
        3
    } else if inner > 80.0 {
        2
    } else {
        1
    };
    let cw = inner / f64::from(n);
    let bh = h - seat_top - 3.0;
    for i in 0..n {
        let x0 = xl + arm + cw * f64::from(i);
        block(
            m,
            cushion,
            [x0 + 0.6, x0 + cw - 0.6],
            [base_top, seat_top],
            [zb + back, zs - 1.0],
            3.5,
        );
        if bh > 8.0 {
            block(
                m,
                cushion,
                [x0 + 1.0, x0 + cw - 1.0],
                [seat_top, seat_top + bh],
                [zb + back, zb + back + 13.0],
                4.5,
            );
        }
    }
    let (cx0, cx1) = (xc + 0.6, xr - back - 0.6);
    block(
        m,
        cushion,
        [cx0, cx1],
        [base_top, seat_top],
        [zb + back, zs - 0.6],
        3.5,
    );
    block(
        m,
        cushion,
        [cx0, cx1],
        [base_top, seat_top],
        [zs + 0.6, zf - arm - 0.6],
        3.5,
    );
    if bh > 8.0 {
        block(
            m,
            cushion,
            [xc + 1.0, xr - back - 1.0],
            [seat_top, seat_top + bh],
            [zb + back, zb + back + 13.0],
            4.5,
        );
        for (z0, z1) in [(zb + back + 13.5, zs - 0.5), (zs + 0.5, zf - arm - 1.0)] {
            block(
                m,
                cushion,
                [xr - back - 13.0, xr - back],
                [seat_top, seat_top + bh],
                [z0, z1],
                4.5,
            );
        }
    }
}

/// A footstool: upholstered on short legs, its top a cushion; `round`, a pouf buttoned on top.
pub(super) fn ottoman(m: &mut Model<'_>, round: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let fabric = Material::fabric(c);
    if round {
        let profile: Vec<[f64; 2]> = [
            [0.0, 0.0],
            [0.86, 0.0],
            [0.98, 0.12],
            [1.0, 0.45],
            [0.97, 0.8],
            [0.85, 0.95],
            [0.5, 1.0],
            [0.0, 0.975],
        ]
        .iter()
        .map(|p| [p[0], p[1] * h])
        .collect();
        m.lathe(fabric, [0.0; 3], &profile, [w / 2.0, d / 2.0]);
        m.sph(
            Material::fabric(shade(c, 0.78)),
            [0.0, h * 0.985, 0.0],
            [1.4, 0.7, 1.4],
        );
        return;
    }
    let leg = 7.0_f64.min(h * 0.2);
    m.soft(
        fabric,
        [-w / 2.0 + 1.0, leg, -d / 2.0 + 1.0],
        [w / 2.0 - 1.0, h - 7.0, d / 2.0 - 1.0],
        2.5,
    );
    m.soft(
        Material {
            color: shade(c, 1.06),
            ..fabric
        },
        [-w / 2.0, h - 8.0, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        3.5,
    );
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.cyl(
                Material::wood(WOOD_DARK),
                [sx * (w / 2.0 - 5.0), 0.0, sz * (d / 2.0 - 5.0)],
                [1.2, 1.7],
                leg + 0.5,
            );
        }
    }
}

/// A low media unit on tapered legs: closed at both ends, open in the middle where a box with
/// its light stands.
pub(super) fn tv_stand(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    let leg_h = (h * 0.24).min(14.0);
    let (y0, y1) = (leg_h, h - 2.5);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.cyl(
                Material::wood(shade(c, 0.8)),
                [sx * (w / 2.0 - 6.0), 0.0, sz * (d / 2.0 - 5.0)],
                [0.9, 1.8],
                leg_h + 0.5,
            );
        }
    }
    m.soft(wood, [-w / 2.0, y1, -d / 2.0], [w / 2.0, h, d / 2.0], 0.6);
    m.bx(wood, [-w / 2.0, y0, -d / 2.0], [w / 2.0, y0 + 2.0, d / 2.0]);
    m.bx(
        wood,
        [-w / 2.0, y0, -d / 2.0],
        [w / 2.0, y1, -d / 2.0 + 1.2],
    );
    let niche = (w * 0.34).min(70.0);
    let front = Material::satin(shade(c, 1.05));
    for (x0, x1) in [(-w / 2.0, -niche / 2.0), (niche / 2.0, w / 2.0)] {
        m.bx(
            wood,
            [x0, y0 + 2.0, -d / 2.0 + 1.2],
            [x1, y1, d / 2.0 - 1.5],
        );
        m.bx(
            front,
            [x0 + 0.4, y0 + 2.4, d / 2.0 - 1.5],
            [x1 - 0.4, y1 - 0.4, d / 2.0],
        );
        let pull = if x0 < 0.0 { x1 - 4.0 } else { x0 + 4.0 };
        let (p0, p1) = (y0 + (y1 - y0) * 0.35, y0 + (y1 - y0) * 0.65);
        m.bx(
            Material::metal(GOLD),
            [pull - 0.5, p0, d / 2.0],
            [pull + 0.5, p1, d / 2.0 + 0.8],
        );
    }
    let bw = (niche * 0.6).min(36.0);
    let bh = ((y1 - y0 - 2.0) * 0.3).min(7.0);
    m.bx(
        Material::metal(DARK),
        [-bw / 2.0, y0 + 2.0, -d / 2.0 + 6.0],
        [bw / 2.0, y0 + 2.0 + bh, d / 2.0 - 6.0],
    );
    m.bx(
        Material::paint(Rgb8::from_u32(0x7fd3ff)),
        [bw / 2.0 - 4.0, y0 + 2.0 + bh * 0.4, d / 2.0 - 6.0],
        [bw / 2.0 - 3.0, y0 + 2.0 + bh * 0.6, d / 2.0 - 5.8],
    );
}

/// A rug flat on the floor: a field in a border, its fringes at both ends; `striped` runs
/// bands across it, `round` is rings of colour.
pub(super) fn rug(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, c) = (m.w, m.d, m.c);
    let h = m.h.max(0.3);
    // Each layer a little over the one under it.
    let step = 0.15;
    if variant == Some("round") {
        let rings = [
            (1.0, 0.74),
            (0.9, 1.0),
            (0.82, 1.12),
            (0.64, 1.0),
            (0.3, 0.74),
        ];
        for (k, (r, tone)) in rings.iter().enumerate() {
            #[allow(clippy::cast_precision_loss)]
            let top = h + step * k as f64;
            m.p.material = Material::fabric(shade(c, *tone));
            m.p.ellipse_cylinder(
                &m.x,
                [0.0, 0.0, 0.0],
                [w / 2.0 * r, d / 2.0 * r],
                [w / 2.0 * r, d / 2.0 * r],
                top,
                if *r > 0.5 { 32 } else { 16 },
                true,
            );
        }
        return;
    }
    let fringe = (w * 0.02).clamp(1.0, 5.0);
    let (x0, x1) = (-w / 2.0 + fringe, w / 2.0 - fringe);
    for (a, b) in [(-w / 2.0, x0), (x1, w / 2.0)] {
        m.bx(
            Material::fabric(Rgb8::from_u32(0xeee6d4)),
            [a, 0.0, -d / 2.0 + 1.0],
            [b, h * 0.4, d / 2.0 - 1.0],
        );
    }
    let border = (w.min(d) * 0.08).clamp(2.0, 18.0);
    m.bx(
        Material::fabric(shade(c, 0.72)),
        [x0, 0.0, -d / 2.0],
        [x1, h, d / 2.0],
    );
    let field = [
        x0 + border,
        -d / 2.0 + border,
        x1 - border,
        d / 2.0 - border,
    ];
    if variant == Some("striped") {
        let bands = ((field[2] - field[0]) / 22.0).round().clamp(3.0, 15.0);
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let count = bands as usize;
        let bw = (field[2] - field[0]) / bands;
        for k in 0..count {
            #[allow(clippy::cast_precision_loss)]
            let a = field[0] + bw * k as f64;
            let tone = if k % 2 == 0 { 1.0 } else { 0.84 };
            m.bx(
                Material::fabric(shade(c, tone)),
                [a, 0.0, field[1]],
                [a + bw, h + step, field[3]],
            );
        }
        return;
    }
    m.bx(
        Material::fabric(c),
        [field[0], 0.0, field[1]],
        [field[2], h + step, field[3]],
    );
    // A fine line inside the border, and a lozenge in the middle.
    let line = Material::fabric(shade(c, 1.14));
    let inset = (border * 0.5).max(2.0);
    let (a, b, cc, e) = (
        field[0] + inset,
        field[1] + inset,
        field[2] - inset,
        field[3] - inset,
    );
    let t = (border * 0.15).clamp(0.6, 2.0);
    let y = [0.0, h + step * 2.0];
    for (lo, hi) in [
        ([a, b], [cc, b + t]),
        ([a, e - t], [cc, e]),
        ([a, b], [a + t, e]),
        ([cc - t, b], [cc, e]),
    ] {
        m.bx(line, [lo[0], y[0], lo[1]], [hi[0], y[1], hi[1]]);
    }
    let (rx, rz) = ((cc - a) * 0.18, (e - b) * 0.3);
    m.plate(
        Material::fabric(shade(c, 0.8)),
        &[[0.0, -rz], [rx, 0.0], [0.0, rz], [-rx, 0.0]],
        0.0,
        h + step * 2.0,
    );
}

/// The ember colour of a fire when it is out: it glows when its switch is on.
const EMBERS: Rgb8 = Rgb8::from_u32(0x2b221d);

/// Flames rising from `at`, `spread` wide and up to `tall` high, leaning back a little: glowing
/// blades facing the front.
fn flames(m: &mut Model<'_>, at: V3, spread: f64, tall: f64) {
    let fire = m.glow(EMBERS);
    let n = ((spread / 6.0).round() as usize).clamp(3, 9);
    for k in 0..n {
        #[allow(clippy::cast_precision_loss)]
        let t = (k as f64 + 0.5) / n as f64 - 0.5;
        let reach = tall * (0.55 + 0.45 * (1.0 - (2.0 * t).abs())) * (0.85 + 0.3 * m.rng.next());
        #[allow(clippy::cast_precision_loss)]
        let form = Blade {
            size: [reach, (spread / n as f64 * 0.95).max(2.0)],
            shape: flame,
            fold: 0.0,
            droop: 0.0,
            segments: 3,
        };
        let lean = (m.rng.next() - 0.5) * 0.12;
        let wander = (m.rng.next() - 0.5) * 1.5;
        m.leaf(
            fire,
            [at[0] + t * spread * 0.85, at[1], at[2] + wander],
            [lean, 1.0, -0.25],
            &form,
        );
    }
}

/// A flame's outline: wide low, to a point.
fn flame(t: f64) -> f64 {
    (1.0 - t).powf(0.8) * (0.4 + 0.6 * (PI * t.powf(0.6)).sin().max(0.0))
}

/// A box made of its walls only, `t` thick, its front open on `window` (`x0`, `y0`, `x1`, `y1`):
/// what is inside shows through.
fn shell(m: &mut Model<'_>, mat: Material, min: V3, max: V3, window: [f64; 4], t: f64) {
    let [x0, y0, x1, y1] = window;
    for (a, b) in [(min[0], min[0] + t), (max[0] - t, max[0])] {
        m.bx(mat, [a, min[1], min[2]], [b, max[1], max[2]]);
    }
    m.bx(mat, [min[0], min[1], min[2]], [max[0], min[1] + t, max[2]]);
    m.bx(mat, [min[0], max[1] - t, min[2]], [max[0], max[1], max[2]]);
    m.bx(mat, [min[0], min[1], min[2]], [max[0], max[1], min[2] + t]);
    let front = [max[2] - t, max[2]];
    for (lo, hi) in [
        ([min[0], min[1]], [max[0], y0]),
        ([min[0], y1], [max[0], max[1]]),
        ([min[0], y0], [x0, y1]),
        ([x1, y0], [max[0], y1]),
    ] {
        m.bx(mat, [lo[0], lo[1], front[0]], [hi[0], hi[1], front[1]]);
    }
}

/// A fireplace: a mantel round a firebox with its logs, on a hearth; `stove`, a wood stove with
/// its flue up to the ceiling; `electric`, a fire behind glass hung on the wall. Its fire glows
/// while what it is linked to is on.
#[allow(clippy::too_many_lines)]
pub(super) fn fireplace(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let soot = Material::paint(Rgb8::from_u32(0x1f1c1a));
    let logs = Material::wood(Rgb8::from_u32(0x4a3628));
    match variant {
        Some("stove") => {
            let iron = Material::new(c, 0.55, Surface::Metal);
            let (bw, bd) = (w * 0.84, d * 0.8);
            let legs = (h * 0.12).min(12.0);
            let top = h * 0.78;
            for sx in [-1.0, 1.0] {
                for sz in [-1.0, 1.0] {
                    m.cyl(
                        iron,
                        [sx * (bw / 2.0 - 3.0), 0.0, sz * (bd / 2.0 - 3.0)],
                        [1.5, 2.0],
                        legs + 0.5,
                    );
                }
            }
            // Its body, open behind the door's window on the fire.
            let (gx, g0, g1) = (bw * 0.34, legs + 7.0, top - 9.0);
            shell(
                m,
                iron,
                [-bw / 2.0, legs, -bd / 2.0],
                [bw / 2.0, top, bd / 2.0],
                [-gx, g0, gx, g1],
                2.0,
            );
            m.bx(
                soot,
                [-bw / 2.0 + 2.0, legs + 2.0, -bd / 2.0 + 2.0],
                [bw / 2.0 - 2.0, top - 2.0, -bd / 2.0 + 2.5],
            );
            m.bx(
                iron,
                [-bw / 2.0 - 1.0, top, -bd / 2.0 - 1.0],
                [bw / 2.0 + 1.0, top + 1.5, bd / 2.0 + 1.0],
            );
            m.rod(
                logs,
                [-gx * 0.8, g0 + 2.5, 0.0],
                [gx * 0.8, g0 + 2.5, 1.0],
                2.2,
            );
            flames(m, [0.0, g0 + 3.0, bd * 0.1], gx * 1.5, (g1 - g0) * 0.7);
            m.bx(
                Material::glass(),
                [-gx, g0, bd / 2.0 - 1.4],
                [gx, g1, bd / 2.0 - 1.0],
            );
            let frame = Material::new(shade(c, 0.8), 0.5, Surface::Metal);
            for (lo, hi) in [
                ([-gx - 2.0, g0 - 2.0], [gx + 2.0, g0]),
                ([-gx - 2.0, g1], [gx + 2.0, g1 + 2.0]),
                ([-gx - 2.0, g0], [-gx, g1]),
                ([gx, g0], [gx + 2.0, g1]),
            ] {
                m.bx(
                    frame,
                    [lo[0], lo[1], bd / 2.0],
                    [hi[0], hi[1], bd / 2.0 + 0.8],
                );
            }
            m.rod(
                Material::metal(STEEL),
                [gx + 4.0, (g0 + g1) / 2.0 - 5.0, bd / 2.0 + 1.5],
                [gx + 4.0, (g0 + g1) / 2.0 + 5.0, bd / 2.0 + 1.5],
                0.7,
            );
            // The flue, up to the ceiling.
            let r = (bw * 0.13).clamp(4.0, 8.0);
            m.cyl(
                iron,
                [0.0, top + 1.5, -bd * 0.15],
                [r, r],
                h - top - 1.5 + m.ceiling,
            );
            m.cyl(iron, [0.0, top + 1.5, -bd * 0.15], [r + 1.2, r + 1.2], 3.0);
        }
        Some("electric") => {
            let glass_black = Material::new(c, 0.12, Surface::Matte);
            let (x0, y0, x1, y1) = (-w / 2.0 + 3.0, 3.0, w / 2.0 - 3.0, h - 3.0);
            shell(
                m,
                Material::metal(shade(c, 1.4)),
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, h, d / 2.0],
                [x0, y0, x1, y1],
                1.0,
            );
            m.bx(soot, [x0, y0, -d / 2.0 + 1.0], [x1, y1, -d / 2.0 + 1.5]);
            // An ember bed of crystals, the flames over it.
            for k in 0..9 {
                let t = f64::from(k) / 8.0 - 0.5;
                m.sph(
                    m.glow(Rgb8::from_u32(0x3a2c26)),
                    [t * (x1 - x0) * 0.92, y0 + 1.5, d * 0.1],
                    [2.4, 1.6, 1.2],
                );
            }
            flames(
                m,
                [0.0, y0 + 1.0, d * 0.2],
                (x1 - x0) * 0.9,
                (y1 - y0) * 0.75,
            );
            for (a, b) in [(0.0, y0), (y1, h)] {
                m.bx(
                    glass_black,
                    [-w / 2.0, a, d / 2.0],
                    [w / 2.0, b, d / 2.0 + 0.15],
                );
            }
            m.bx(
                Material::glass(),
                [x0, y0, d / 2.0 - 0.6],
                [x1, y1, d / 2.0 - 0.2],
            );
        }
        _ => {
            let stone = Material::new(c, 0.55, Surface::Matte);
            let hearth = 4.0_f64.min(h * 0.05);
            m.bx(
                Material::new(shade(c, 0.78), 0.4, Surface::Matte),
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, hearth, d / 2.0],
            );
            let body = (d * 0.72).max(8.0);
            let jamb = (w * 0.16).clamp(8.0, 30.0);
            let shelf = 5.0_f64.min(h * 0.06);
            let opening = (h * 0.62).min(h - shelf - 14.0).max(h * 0.3);
            let (zb, zf) = (-d / 2.0, -d / 2.0 + body);
            let inner = w / 2.0 - 3.0 - jamb;
            for sx in [-1.0, 1.0] {
                let (a, b) = (sx * (w / 2.0 - 3.0), sx * inner);
                m.bx(stone, [a.min(b), hearth, zb], [a.max(b), h - shelf, zf]);
            }
            m.bx(
                stone,
                [-inner, hearth + opening, zb],
                [inner, h - shelf, zf],
            );
            m.soft(
                stone,
                [-w / 2.0, h - shelf, zb],
                [w / 2.0, h, (zf + 3.0).min(d / 2.0)],
                0.8,
            );
            // The firebox: dark brick at its back and sides, its logs and fire.
            m.bx(
                soot,
                [-inner, hearth, zb],
                [inner, hearth + opening, zb + 2.0],
            );
            for sx in [-1.0, 1.0] {
                let (a, b) = (sx * inner, sx * (inner - 0.6));
                m.bx(
                    soot,
                    [a.min(b), hearth, zb],
                    [a.max(b), hearth + opening, zf - 1.0],
                );
            }
            m.bx(
                soot,
                [-inner, hearth + opening - 0.6, zb],
                [inner, hearth + opening, zf - 1.0],
            );
            let lz = (zb + zf) / 2.0;
            let reach = inner * 0.62;
            m.rod(
                logs,
                [-reach, hearth + 3.0, lz],
                [reach, hearth + 3.0, lz + 1.0],
                3.0,
            );
            m.rod(
                logs,
                [-reach * 0.7, hearth + 7.0, lz + 3.0],
                [reach * 0.8, hearth + 6.0, lz - 2.0],
                2.6,
            );
            flames(
                m,
                [0.0, hearth + 5.0, lz + 3.0],
                inner * 1.2,
                opening * 0.55,
            );
        }
    }
}

/// The keys of a keyboard from `x0` to `x1`, their fronts at `zf`, their tops at `y`: 52 white
/// keys and 36 black ones, as an 88-key keyboard has.
fn keys(m: &mut Model<'_>, [x0, x1]: [f64; 2], zf: f64, y: f64) {
    let white = Material::satin(Rgb8::from_u32(0xf3f1ea));
    let ebony = Material::new(Rgb8::from_u32(0x141414), 0.25, Surface::Matte);
    let length = 14.5_f64.min((x1 - x0) * 0.2);
    m.bx(white, [x0, y - 2.0, zf - length], [x1, y, zf]);
    let ww = (x1 - x0) / 52.0;
    // From A0: the black keys follow A, C, D, F and G.
    for i in 0..51 {
        if matches!(i % 7, 0 | 2 | 3 | 5 | 6) {
            #[allow(clippy::cast_precision_loss)]
            let x = x0 + ww * (i + 1) as f64;
            m.bx(
                ebony,
                [x - ww * 0.29, y, zf - length],
                [x + ww * 0.29, y + 1.1, zf - length * 0.36],
            );
        }
    }
}

/// An upright piano: its case and lid, the keys between its cheeks, a music desk, the lower panel
/// and three pedals; `digital`, a slim keyboard on its stand.
pub(super) fn piano(m: &mut Model<'_>, digital: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let case = lacquer(c);
    let brass = Material::metal(GOLD);
    if digital {
        let key_y = (h * 0.82).min(76.0);
        let side = 2.5;
        for sx in [-1.0, 1.0] {
            let (a, b) = (sx * (w / 2.0 - side), sx * w / 2.0);
            m.bx(
                case,
                [a.min(b), 0.0, -d / 2.0 + 2.0],
                [a.max(b), key_y - 9.0, -d / 2.0 + d * 0.62],
            );
            m.soft(
                case,
                [a.min(b) - 0.5, 0.0, -d / 2.0],
                [a.max(b) + 0.5, 4.0, d / 2.0],
                0.8,
            );
        }
        m.bx(
            case,
            [-w / 2.0 + side, 10.0, -d / 2.0 + 2.0],
            [w / 2.0 - side, key_y - 12.0, -d / 2.0 + 3.5],
        );
        m.soft(
            case,
            [-w / 2.0, key_y - 10.0, -d / 2.0],
            [w / 2.0, key_y - 1.5, d / 2.0 - 2.0],
            0.8,
        );
        m.soft(
            case,
            [-w / 2.0, key_y - 1.5, -d / 2.0],
            [w / 2.0, key_y + 2.0, d / 2.0 - 18.5],
            0.6,
        );
        keys(m, [-w / 2.0 + 3.0, w / 2.0 - 3.0], d / 2.0 - 2.5, key_y);
        m.bx(
            case,
            [-w * 0.3, key_y + 2.0, -d / 2.0 + 5.0],
            [w * 0.3, h, -d / 2.0 + 6.0],
        );
        for k in [-1.0, 0.0, 1.0] {
            m.bx(
                brass,
                [k * 7.0 - 2.0, 0.0, -d / 2.0 + 8.0],
                [k * 7.0 + 2.0, 3.0, -d / 2.0 + 18.0],
            );
        }
        return;
    }
    let key_y = (h * 0.58).min(74.0).max(h * 0.4);
    let case_d = (d * 0.55).max(15.0);
    let cheek = 3.5;
    let zc = -d / 2.0 + case_d;
    m.bx(
        case,
        [-w / 2.0 + cheek, 6.0, -d / 2.0],
        [w / 2.0 - cheek, h - 2.5, zc],
    );
    m.soft(
        case,
        [-w / 2.0, h - 2.5, -d / 2.0 - 0.5],
        [w / 2.0, h, zc + 1.5],
        0.6,
    );
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * (w / 2.0 - cheek), sx * w / 2.0);
        m.bx(
            case,
            [a.min(b), 0.0, -d / 2.0],
            [a.max(b), key_y + 3.0, d / 2.0],
        );
        m.bx(
            case,
            [a.min(b), key_y + 3.0, -d / 2.0],
            [a.max(b), h - 2.5, zc + 1.0],
        );
    }
    // The toe board under it all, and the key bed with its front rail.
    m.bx(
        case,
        [-w / 2.0 + cheek, 0.0, -d / 2.0],
        [w / 2.0 - cheek, 6.0, zc + 2.0],
    );
    m.bx(
        case,
        [-w / 2.0 + cheek, key_y - 9.0, zc],
        [w / 2.0 - cheek, key_y - 2.0, d / 2.0 - 1.0],
    );
    m.bx(
        case,
        [-w / 2.0 + cheek, key_y - 8.0, d / 2.0 - 1.5],
        [w / 2.0 - cheek, key_y - 0.5, d / 2.0],
    );
    keys(m, [-w / 2.0 + cheek, w / 2.0 - cheek], d / 2.0 - 1.5, key_y);
    // The fallboard folded back, the music desk, and the panels' mouldings.
    m.bx(
        case,
        [-w / 2.0 + cheek, key_y, zc],
        [w / 2.0 - cheek, key_y + 9.0, zc + 1.5],
    );
    m.bx(
        case,
        [-w / 2.0 + cheek + 4.0, key_y + 14.0, zc],
        [w / 2.0 - cheek - 4.0, key_y + 15.5, zc + 3.5],
    );
    let moulding = lacquer(shade(c, 1.35));
    let (p0, p1) = (key_y + 20.0, h - 8.0);
    if p1 - p0 > 6.0 {
        m.bx(moulding, [-w * 0.33, p0, zc], [w * 0.33, p1, zc + 0.4]);
        m.bx(
            case,
            [-w * 0.33 + 1.5, p0 + 1.5, zc],
            [w * 0.33 - 1.5, p1 - 1.5, zc + 0.6],
        );
    }
    let (l0, l1) = (12.0, key_y - 14.0);
    if l1 - l0 > 6.0 {
        m.bx(moulding, [-w * 0.33, l0, zc], [w * 0.33, l1, zc + 0.4]);
        m.bx(
            case,
            [-w * 0.33 + 1.5, l0 + 1.5, zc],
            [w * 0.33 - 1.5, l1 - 1.5, zc + 0.6],
        );
    }
    for k in [-1.0, 0.0, 1.0] {
        m.rod(brass, [k * 7.0, 5.0, zc], [k * 7.0, 4.0, zc + 7.0], 0.9);
    }
    for sx in [-1.0, 1.0] {
        m.sph(brass, [sx * w * 0.36, h * 0.82, zc + 0.5], [1.0, 1.0, 0.6]);
    }
}

/// A speaker cone facing the front from `(x, y)` on the face at `z`, `r` its radius.
fn cone(m: &mut Model<'_>, at: V3, r: f64) {
    let face = m.x.translated(at).turned_x(FRAC_PI_2);
    m.p.material = Material::new(Rgb8::from_u32(0x262626), 0.6, Surface::Matte);
    m.p.lathe(
        &face,
        [0.0; 3],
        &[
            [r, 0.0],
            [r * 0.86, 0.5],
            [r * 0.3, -1.2 * r / 6.0],
            [0.0, -0.9 * r / 6.0],
        ],
        [1.0, 1.0],
        if r > 4.0 { 16 } else { 10 },
    );
    m.p.material = Material::new(Rgb8::from_u32(0x3a3a3a), 0.3, Surface::Metal);
    m.p.sphere(&face, [0.0, -0.3, 0.0], [r * 0.25, r * 0.12, r * 0.25], 8);
}

/// A speaker: a smart one of fabric, the light round its top lit while it plays; `display`, a
/// screen leaning on its speaker; `floor`, a tower of its own; `soundbar`, a bar under a TV.
pub(super) fn speaker(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let ring = Material::new(Rgb8::from_u32(0x1b2a33), 0.15, Surface::Screen);
    match variant {
        Some("floor") => {
            let plinth = 3.0_f64.min(h * 0.05);
            m.bx(
                Material::metal(DARK),
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, plinth, d / 2.0],
            );
            m.soft(
                lacquer(c),
                [-w / 2.0 + 1.0, plinth, -d / 2.0 + 1.0],
                [w / 2.0 - 1.0, h, d / 2.0 - 0.5],
                1.2,
            );
            m.bx(
                Material::satin(Rgb8::from_u32(0x1a1a1a)),
                [-w / 2.0 + 1.6, plinth + 2.0, d / 2.0 - 0.6],
                [w / 2.0 - 1.6, h - 1.5, d / 2.0 - 0.2],
            );
            let r = (w * 0.34).min((h - plinth) * 0.12);
            for y in [plinth + (h - plinth) * 0.2, plinth + (h - plinth) * 0.46] {
                cone(m, [0.0, y, d / 2.0 - 0.2], r);
            }
            cone(
                m,
                [0.0, plinth + (h - plinth) * 0.72, d / 2.0 - 0.2],
                r * 0.4,
            );
        }
        Some("soundbar") => {
            m.soft(
                Material::satin(c),
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, h, d / 2.0],
                (h * 0.25).min(2.0),
            );
            m.bx(
                Material::fabric(shade(c, 0.7)),
                [-w / 2.0 + 1.0, h * 0.18, d / 2.0 - 0.1],
                [w / 2.0 - 1.0, h * 0.82, d / 2.0 + 0.2],
            );
            m.bx(ring, [-2.0, h - 0.1, -d * 0.1], [2.0, h + 0.1, d * 0.1]);
        }
        Some("display") => {
            let fabric = Material::fabric(c);
            m.soft(
                fabric,
                [-w / 2.0, 0.0, -d / 2.0],
                [w / 2.0, h * 0.38, d * 0.2],
                (h * 0.12).min(2.5),
            );
            let lean = m.x.translated([0.0, h * 0.05, d * 0.18]).turned_x(-0.28);
            let tall = h * 0.95;
            m.bx_in(
                Material::satin(shade(c, 1.05)),
                &lean,
                [-w / 2.0, 0.0, -1.6],
                [w / 2.0, tall, 0.0],
            );
            m.bx_in(
                Material::new(Rgb8::from_u32(0x101214), 0.12, Surface::Screen),
                &lean,
                [-w / 2.0 + 0.8, 0.8, 0.0],
                [w / 2.0 - 0.8, tall - 0.8, 0.15],
            );
        }
        _ => {
            let profile: Vec<[f64; 2]> = [
                [0.0, 0.0],
                [0.9, 0.0],
                [1.0, 0.06],
                [1.0, 0.88],
                [0.92, 0.97],
                [0.6, 1.0],
                [0.0, 1.0],
            ]
            .iter()
            .map(|p| [p[0], p[1] * h])
            .collect();
            m.lathe(Material::fabric(c), [0.0; 3], &profile, [w / 2.0, d / 2.0]);
            m.lathe(
                ring,
                [0.0, h, 0.0],
                &[[0.55, -0.3], [0.65, 0.12], [0.5, 0.12], [0.0, 0.1]],
                [w / 2.0, d / 2.0],
            );
        }
    }
}

/// A rocking chair of turned wood: two rockers, the seat of rush, a back of spindles under its
/// crest rail, and arms.
pub(super) fn rocking_chair(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = Material::wood(c);
    let seat_y = (h * 0.42).min(44.0);
    // The rockers: arcs rising at both ends, `rise` above the floor under the posts.
    let radius = d * 1.3;
    let reach = (d / 2.0 / radius).asin();
    let thick = (h * 0.04).clamp(2.0, 4.0);
    let arc = |r: f64, k: usize| {
        #[allow(clippy::cast_precision_loss)]
        let a = -reach + 2.0 * reach * k as f64 / 12.0;
        [r * a.sin(), radius - r * a.cos()]
    };
    let mut outline: Vec<[f64; 2]> = (0..=12).map(|k| arc(radius, k)).collect();
    outline.extend((0..=12).rev().map(|k| arc(radius - thick, k)));
    let top_of = |z: f64| radius - ((radius - thick).powi(2) - z * z).max(0.0).sqrt();
    let side = w / 2.0 - 4.0;
    for sx in [-1.0, 1.0] {
        m.side_slab(wood, &outline, sx * side - 1.4, sx * side + 1.4);
    }
    let (zf, zb) = (d * 0.22, -d * 0.2);
    let lean = 0.24;
    let back_z = |y: f64| zb - (y - seat_y).max(0.0) * lean;
    let arm_y = seat_y + (h - seat_y) * 0.36;
    for sx in [-1.0, 1.0] {
        let x = sx * side;
        m.rod(wood, [x, top_of(zf) - 0.5, zf], [x * 0.97, arm_y, zf], 1.5);
        m.pipe(
            wood,
            &[
                [x, top_of(zb) - 0.5, zb],
                [x * 0.97, seat_y, zb],
                [x * 0.94, h - 2.0, back_z(h - 2.0)],
            ],
            1.7,
        );
        // The arm, from the back post over the front one to a scroll.
        m.pipe(
            wood,
            &[
                [x * 0.95, arm_y + 1.0, back_z(arm_y)],
                [x * 0.97, arm_y + 1.5, zf - 2.0],
                [x * 0.98, arm_y + 0.5, zf + 4.0],
                [x * 0.98, arm_y - 1.5, zf + 5.0],
            ],
            1.8,
        );
        // Stretchers between the legs.
        m.rod(
            wood,
            [x * 0.98, top_of(zb) + 8.0, zb],
            [x * 0.98, top_of(zf) + 8.0, zf],
            0.9,
        );
    }
    m.bx(
        wood,
        [-side, seat_y - 4.0, zb - 1.5],
        [side, seat_y - 1.0, zf + 2.5],
    );
    m.soft(
        Material::new(Rgb8::from_u32(0xc4a46a), 0.9, Surface::Fabric),
        [-side + 1.5, seat_y - 1.5, zb - 0.5],
        [side - 1.5, seat_y + 0.8, zf + 1.5],
        0.6,
    );
    // The crest rail, curving back in the middle, a rail under the spindles, the spindles.
    let crest: Vec<V3> = (0..=6)
        .map(|k| {
            let t = f64::from(k) / 3.0 - 1.0;
            let y = h - 4.0;
            [t * side * 0.94, y, back_z(y) - 2.5 * (1.0 - t * t)]
        })
        .collect();
    m.pipe(wood, &crest, 2.4);
    let low = seat_y + 3.0;
    m.rod(
        wood,
        [-side * 0.96, low, back_z(low)],
        [side * 0.96, low, back_z(low)],
        1.2,
    );
    let spindles = 5;
    for k in 0..spindles {
        let t = f64::from(k) / f64::from(spindles - 1) * 2.0 - 1.0;
        let x = t * side * 0.62;
        let y = h - 5.0;
        m.rod(
            wood,
            [x, low, back_z(low)],
            [x, y, back_z(y) - 2.5 * (1.0 - t * t * 0.4)],
            0.75,
        );
    }
}

/// A bench: a board on two panel legs and a stretcher; `upholstered`, a buttoned cushion on four
/// legs.
pub(super) fn bench(m: &mut Model<'_>, upholstered: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    if upholstered {
        let fabric = Material::fabric(c);
        let frame = Material::wood(WOOD_DARK);
        let leg = (h * 0.6).max(4.0);
        m.bx(
            frame,
            [-w / 2.0, leg - 3.0, -d / 2.0],
            [w / 2.0, leg, d / 2.0],
        );
        for sx in [-1.0, 1.0] {
            for sz in [-1.0, 1.0] {
                m.cyl(
                    frame,
                    [sx * (w / 2.0 - 4.0), 0.0, sz * (d / 2.0 - 4.0)],
                    [1.1, 1.8],
                    leg - 2.5,
                );
            }
        }
        m.soft(
            fabric,
            [-w / 2.0, leg, -d / 2.0],
            [w / 2.0, h, d / 2.0],
            3.5,
        );
        let buttons = ((w / 30.0).round() as usize).clamp(2, 8);
        for k in 0..buttons {
            #[allow(clippy::cast_precision_loss)]
            let x = -w / 2.0 + w * (k as f64 + 0.5) / buttons as f64;
            m.sph(
                Material::fabric(shade(c, 0.75)),
                [x, h - 0.2, 0.0],
                [1.2, 0.5, 1.2],
            );
        }
        return;
    }
    let wood = surface(c);
    let top = 4.0_f64.min(h * 0.2);
    m.soft(
        wood,
        [-w / 2.0, h - top, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        0.8,
    );
    let inset = (w * 0.08).clamp(3.0, 15.0);
    for sx in [-1.0, 1.0] {
        let x = sx * (w / 2.0 - inset);
        m.bx(
            wood,
            [x - 1.5, 0.0, -d / 2.0 + 3.0],
            [x + 1.5, h - top, d / 2.0 - 3.0],
        );
    }
    let y = (h * 0.28).min(14.0);
    m.bx(
        wood,
        [-w / 2.0 + inset, y, -2.0],
        [w / 2.0 - inset, y + 4.0, 2.0],
    );
}

/// The colour of an aquarium's water.
const WATER: Rgb8 = Rgb8::from_u32(0x4f8fa8);

/// An aquarium on its cabinet: the tank's glass, its back lit by the light under the hood, sand,
/// stones, plants and a few fish.
pub(super) fn aquarium(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    let cab = (h * 0.52).min(75.0).max(h * 0.25);
    let hood = (h * 0.09).clamp(3.0, 14.0);
    let tank_top = h - hood;
    m.bx(
        wood,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, cab - 2.0, d / 2.0],
    );
    m.soft(
        wood,
        [-w / 2.0 - 0.5, cab - 2.0, -d / 2.0 - 0.5],
        [w / 2.0 + 0.5, cab, d / 2.0 + 0.5],
        0.5,
    );
    m.fronts(Material::satin(shade(c, 1.1)), 4.0, cab - 3.0, 2, 1, true);
    m.bx(
        Material::new(WATER, 0.3, Surface::Matte),
        [-w / 2.0 + 0.8, cab + 2.5, -d / 2.0 + 0.6],
        [w / 2.0 - 0.8, tank_top - 1.5, -d / 2.0 + 1.2],
    );
    let sand = (tank_top - cab) * 0.1;
    m.bx(
        Material::new(Rgb8::from_u32(0xd8c8a0), 0.9, Surface::Matte),
        [-w / 2.0 + 0.6, cab, -d / 2.0 + 0.6],
        [w / 2.0 - 0.6, cab + sand, d / 2.0 - 0.6],
    );
    for k in 0..3 {
        let x = (f64::from(k) - 1.0) * w * 0.28 + (m.rng.next() - 0.5) * 6.0;
        let r = 2.5 + 2.0 * m.rng.next();
        m.sph(
            Material::new(Rgb8::from_u32(0x8a8a82), 0.7, Surface::Matte),
            [x, cab + sand, -d * 0.1],
            [r * 1.3, r, r],
        );
    }
    let tall = (tank_top - cab - sand) * 0.85;
    let inside = w - 16.0;
    for k in 0..7 {
        let x = -inside / 2.0 + inside * (f64::from(k) + 0.5) / 7.0 + (m.rng.next() - 0.5) * 3.0;
        let z = -d / 2.0 + 4.0 + m.rng.next() * d * 0.2;
        for j in 0..4 {
            let a = f64::from(j) * 1.7 + m.rng.next();
            let reach = tall * (0.45 + 0.5 * m.rng.next());
            let blade = Blade {
                size: [reach, 1.6],
                shape: strap,
                fold: 0.1,
                droop: reach * 0.12,
                segments: 3,
            };
            let tone = Material::new(
                shade(Rgb8::from_u32(0x4f8a3c), 0.8 + 0.4 * m.rng.next()),
                0.6,
                Surface::Leaf,
            );
            m.leaf(
                tone,
                [x, cab + sand, z],
                [a.cos() * 0.15, 1.0, a.sin() * 0.15],
                &blade,
            );
        }
    }
    for (k, color) in [0xe8742a, 0xf2c14e, 0xe8742a].iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let t = k as f64;
        let at = [
            (t - 1.0) * w * 0.22 + (m.rng.next() - 0.5) * 5.0,
            cab + sand + tall * (0.35 + 0.15 * t),
            d * 0.05 * (t - 1.0),
        ];
        m.sph(
            Material::new(Rgb8::from_u32(*color), 0.4, Surface::Matte),
            at,
            [2.2, 1.1, 0.6],
        );
    }
    m.bx(
        Material::glass(),
        [-w / 2.0 + 0.3, cab, -d / 2.0 + 0.3],
        [w / 2.0 - 0.3, tank_top, d / 2.0 - 0.3],
    );
    m.soft(
        Material::satin(shade(c, 0.9)),
        [-w / 2.0, tank_top, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        1.0,
    );
    // Its light under the hood, lit with the lamp.
    let glow = m.glow(Rgb8::from_u32(0xd8e8f0));
    m.bx(
        glow,
        [-w / 2.0 + 2.0, tank_top - 0.4, -d / 2.0 + 2.0],
        [w / 2.0 - 2.0, tank_top, d / 2.0 - 2.0],
    );
    m.bulbs.push([0.0, tank_top - 2.0, 0.0]);
}

/// A wall clock: its rim and face, the hours marked, its hands at ten past ten.
pub(super) fn clock(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let r = w.min(h) / 2.0;
    let face = m.x.translated([0.0, h / 2.0, -d / 2.0]).turned_x(FRAC_PI_2);
    m.p.material = Material::satin(c);
    m.p.lathe(
        &face,
        [0.0; 3],
        &[[r, 0.0], [r, d], [r * 0.9, d], [r * 0.9, d * 0.55]],
        [w / 2.0 / r, h / 2.0 / r],
        24,
    );
    m.p.material = Material::paint(Rgb8::from_u32(0xf6f3ec));
    m.p.cylinder(&face, [0.0; 3], [r * 0.9, r * 0.9], d * 0.55, 24, true);
    let z = d / 2.0 - d * 0.45 + 0.1;
    let centre = m.x.translated([0.0, h / 2.0, z]);
    let ink = Material::paint(Rgb8::from_u32(0x1d1f20));
    for k in 0..12 {
        let mark = centre.turned_z(f64::from(k) * TAU / 12.0);
        let long = if k % 3 == 0 { 0.16 } else { 0.08 };
        m.bx_in(
            ink,
            &mark,
            [-r * 0.012 - 0.3, r * (0.82 - long), 0.0],
            [r * 0.012 + 0.3, r * 0.82, 0.2],
        );
    }
    // The hour hand just past ten, the minute hand on two.
    for (angle, reach, width) in [
        (TAU * 2.0 / 12.0 - 0.09, 0.5, 0.05),
        (-TAU * 2.0 / 12.0, 0.74, 0.03),
    ] {
        let hand = centre.turned_z(angle);
        m.bx_in(
            ink,
            &hand,
            [-r * width, -r * 0.1, 0.25],
            [r * width, r * reach, 0.45],
        );
    }
    m.p.material = ink;
    m.p.cylinder(
        &centre.turned_x(FRAC_PI_2),
        [0.0; 3],
        [r * 0.05, r * 0.05],
        0.6,
        8,
        true,
    );
}

/// A vase's outline, as shares of its radius and height: a round belly, a neck, a lip, and its
/// inside.
const VASE: [[f64; 2]; 11] = [
    [0.0, 0.0],
    [0.55, 0.0],
    [0.62, 0.04],
    [0.98, 0.38],
    [0.9, 0.62],
    [0.52, 0.84],
    [0.5, 0.94],
    [0.62, 1.0],
    [0.54, 1.0],
    [0.42, 0.9],
    [0.0, 0.88],
];

/// A vase of ceramic; `flowers`, tulips in it; `branches`, a few dry branches.
pub(super) fn vase(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let (share, tall) = match variant {
        Some("flowers") => (0.6, 0.55),
        Some("branches") => (0.55, 0.36),
        _ => (1.0, 1.0),
    };
    let (rx, rz, vh) = (w / 2.0 * share, d / 2.0 * share, h * tall);
    let profile: Vec<[f64; 2]> = VASE.iter().map(|p| [p[0], p[1] * vh]).collect();
    m.lathe(Material::ceramic(c), [0.0; 3], &profile, [rx, rz]);
    let mouth = [0.0, vh * 0.9, 0.0];
    let neck = rx.min(rz) * 0.45;
    match variant {
        Some("flowers") => {
            let stem = Material::wood(Rgb8::from_u32(0x5f7a3a));
            let colours = [0xd23c3c, 0xf2c14e, 0xe98aa6, 0xd23c3c, 0xf7f1e8];
            for k in 0..7 {
                let a = f64::from(k) * 2.4 + m.rng.next() * 0.5;
                let (s, co) = a.sin_cos();
                let spread = (w / 2.0 - 2.5) * (0.4 + 0.6 * m.rng.next());
                let top = vh + (h - vh) * (0.7 + 0.3 * m.rng.next()) - 3.5;
                let head = [co * spread, top, s * spread];
                m.twig(
                    stem,
                    [co * neck * 0.4, mouth[1], s * neck * 0.4],
                    head,
                    0.35,
                );
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let color = colours[k as usize % colours.len()];
                m.lathe(
                    Material::new(Rgb8::from_u32(color), 0.6, Surface::Fabric),
                    head,
                    &[
                        [0.0, 0.0],
                        [0.6, 0.4],
                        [1.0, 1.8],
                        [0.9, 3.4],
                        [0.55, 3.0],
                        [0.0, 2.6],
                    ],
                    [1.1, 1.1],
                );
                if k % 2 == 0 {
                    let blade = Blade {
                        size: [(top - vh) * 0.6, 2.2],
                        shape: strap,
                        fold: 0.3,
                        droop: 3.0,
                        segments: 3,
                    };
                    m.leaf(
                        Material::new(super::LEAF, 0.6, Surface::Leaf),
                        [co * neck * 0.3, mouth[1], s * neck * 0.3],
                        [co * 0.4, 1.0, s * 0.4],
                        &blade,
                    );
                }
            }
        }
        Some("branches") => {
            let twig = Material::wood(Rgb8::from_u32(0x6a5038));
            for k in 0..4 {
                let a = f64::from(k) * 1.9 + m.rng.next();
                let (s, co) = a.sin_cos();
                let lean = 0.15 + 0.25 * m.rng.next();
                let top = [
                    co * (w / 2.0 - 2.0) * lean * 2.0,
                    h - 2.0 - m.rng.next() * h * 0.15,
                    s * (d / 2.0 - 2.0) * lean * 2.0,
                ];
                let base = [co * neck * 0.3, mouth[1] - 2.0, s * neck * 0.3];
                m.twig(twig, base, top, 0.45);
                for j in 1..4 {
                    let t = f64::from(j) / 4.0;
                    let from = [0, 1, 2].map(|i| base[i] + (top[i] - base[i]) * t);
                    let b = a + if j % 2 == 0 { 0.9 } else { -0.9 };
                    let len = (h - vh) * 0.18 * (1.0 - t * 0.5);
                    let to = [
                        from[0] + b.cos() * len * 0.7,
                        from[1] + len,
                        from[2] + b.sin() * len * 0.7,
                    ];
                    m.twig(twig, from, to, 0.25);
                    m.sph(
                        Material::new(Rgb8::from_u32(0xb9c9a8), 0.8, Surface::Leaf),
                        to,
                        [0.9, 0.9, 0.9],
                    );
                }
            }
        }
        _ => {}
    }
}

/// A book of `size` lying at `at` (its bottom centre), turned by `turn`: its cover, and its pages
/// within it.
fn book(m: &mut Model<'_>, at: V3, size: V3, turn: f64, color: Rgb8) {
    let frame = m.x.translated(at).turned_y(turn);
    let [w, h, d] = size;
    m.bx_in(
        Material::new(color, 0.7, Surface::Matte),
        &frame,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h, d / 2.0],
    );
    m.bx_in(
        Material::paint(Rgb8::from_u32(0xf1ead9)),
        &frame,
        [-w / 2.0 + 0.4, 0.2, -d / 2.0 + 0.4],
        [w / 2.0 + 0.05, h - 0.2, d / 2.0 + 0.05],
    );
}

/// Book covers.
const COVERS: [u32; 8] = [
    0x8b3a2e, 0x2f4f6f, 0xd8c9a3, 0x3d5a40, 0x6b4f7a, 0xc98b3c, 0x2b2b2b, 0xe6e1d6,
];

/// A pile of books lying flat; `upright`, standing in a row between bookends.
pub(super) fn books(m: &mut Model<'_>, upright: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let pick = |m: &mut Model<'_>| {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let k = (m.rng.next() * COVERS.len() as f64) as usize % COVERS.len();
        COVERS[k]
    };
    if upright {
        let end = Material::metal(DARK);
        for sx in [-1.0, 1.0] {
            let x = sx * (w / 2.0 - 0.4);
            m.bx(
                end,
                [x - 0.4, 0.0, -d / 2.0 + 1.0],
                [x + 0.4, h * 0.6, d / 2.0 - 1.0],
            );
            // Its foot, under the books.
            let (a, b) = (x, x - sx * 5.0);
            m.bx(
                end,
                [a.min(b), 0.0, -d / 2.0 + 1.0],
                [a.max(b), 0.3, d / 2.0 - 1.0],
            );
        }
        let mut x = -w / 2.0 + 1.0;
        let end_x = w / 2.0 - 1.0;
        while x < end_x - 1.5 {
            let bw = (1.8 + m.rng.next() * 2.8).min(end_x - x);
            let bh = h * (0.7 + 0.3 * m.rng.next());
            let bd = d * (0.75 + 0.2 * m.rng.next());
            let color = if x < -w / 2.0 + 2.0 {
                m.c
            } else {
                Rgb8::from_u32(pick(m))
            };
            m.bx(
                Material::new(color, 0.7, Surface::Matte),
                [x, 0.3, -bd / 2.0],
                [x + bw - 0.15, bh, bd / 2.0],
            );
            x += bw;
        }
        return;
    }
    let count = ((h / 3.2).round() as usize).clamp(1, 6);
    #[allow(clippy::cast_precision_loss)]
    let th = h / count as f64;
    for k in 0..count {
        let shrink = 0.82 + 0.18 * m.rng.next();
        let turn = (m.rng.next() - 0.5) * 0.25;
        let color = if k == 0 { c } else { Rgb8::from_u32(pick(m)) };
        #[allow(clippy::cast_precision_loss)]
        book(
            m,
            [0.0, th * k as f64, 0.0],
            [w * shrink * 0.94, th, d * shrink * 0.94],
            turn,
            color,
        );
    }
}

/// A shelf hung on the wall, nothing seen to hold it, with a few things on it: books, a small
/// plant, a framed picture leaning back.
pub(super) fn wall_shelf(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let board = 3.5_f64.min(h * 0.3);
    m.soft(
        surface(c),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, board, d / 2.0],
        0.5,
    );
    if h < board + 6.0 || w < 30.0 {
        return;
    }
    let room = h - board;
    let mut x = -w / 2.0 + 3.0;
    for k in 0..5 {
        let bw = 2.0 + m.rng.next() * 2.0;
        let bh = room * (0.7 + 0.25 * m.rng.next());
        m.bx(
            Material::new(
                Rgb8::from_u32(COVERS[(k * 3 + 1) % COVERS.len()]),
                0.7,
                Surface::Matte,
            ),
            [x, board, -d / 2.0 + 2.0],
            [x + bw - 0.2, board + bh, d / 2.0 - 3.0],
        );
        x += bw;
    }
    // A small pot with a few leaves in the middle.
    let pot_r = (d * 0.22).min(6.0);
    m.lathe(
        Material::ceramic(Rgb8::from_u32(0xd9d2c3)),
        [w * 0.08, board, 0.0],
        &[
            [0.0, 0.0],
            [pot_r * 0.8, 0.0],
            [pot_r, room * 0.35],
            [pot_r * 0.85, room * 0.35],
            [0.0, room * 0.33],
        ],
        [1.0, 1.0],
    );
    for j in 0..5 {
        let a = f64::from(j) * 1.3 + m.rng.next();
        let leaf = Blade {
            size: [room * 0.45, room * 0.3],
            shape: super::heart,
            fold: 0.2,
            droop: room * 0.1,
            segments: 3,
        };
        let tone = Material::new(
            shade(super::LEAF, 0.85 + 0.3 * m.rng.next()),
            0.6,
            Surface::Leaf,
        );
        m.leaf(
            tone,
            [w * 0.08, board + room * 0.34, 0.0],
            [a.cos() * 0.8, 0.9, a.sin() * 0.5],
            &leaf,
        );
    }
    // A picture leaning against the wall.
    let lean =
        m.x.translated([w * 0.3, board, -d / 2.0 + 3.0])
            .turned_x(-0.12);
    let (pw, ph) = ((w * 0.25).min(30.0), room * 0.85);
    m.bx_in(
        Material::wood(Rgb8::from_u32(0x24211e)),
        &lean,
        [-pw / 2.0, 0.0, 0.0],
        [pw / 2.0, ph, 1.2],
    );
    m.bx_in(
        Material::paint(Rgb8::from_u32(0xe8e2d4)),
        &lean,
        [-pw / 2.0 + 1.5, 1.5, 1.2],
        [pw / 2.0 - 1.5, ph - 1.5, 1.35],
    );
    m.bx_in(
        Material::paint(Rgb8::from_u32(0x7a9a6a)),
        &lean,
        [-pw / 2.0 + 3.5, 3.5, 1.35],
        [pw / 2.0 - 3.5, ph - 3.5, 1.45],
    );
}

/// A coat stand: a pole on curved feet, its hooks at the top with a coat and a hat on them.
pub(super) fn coat_rack(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = Material::wood(c);
    let r = w.min(d) / 2.0;
    for k in 0..4 {
        let a = f64::from(k) * TAU / 4.0 + 0.4;
        let (s, co) = a.sin_cos();
        m.pipe(
            wood,
            &[
                [0.0, 14.0, 0.0],
                [co * r * 0.45, 7.0, s * r * 0.45],
                [co * (r - 2.0), 1.2, s * (r - 2.0)],
            ],
            1.2,
        );
    }
    m.cyl(wood, [0.0; 3], [1.8, 1.6], h - 4.0);
    m.sph(wood, [0.0, h - 3.0, 0.0], [2.4, 3.0, 2.4]);
    let top = h - 14.0;
    for k in 0..6 {
        let a = f64::from(k) * TAU / 6.0;
        let (s, co) = a.sin_cos();
        let reach = (r * 0.4).min(12.0);
        m.pipe(
            wood,
            &[
                [0.0, top - 6.0, 0.0],
                [co * reach * 0.6, top - 2.0, s * reach * 0.6],
                [co * reach, top + 3.0, s * reach],
            ],
            0.7,
        );
        m.sph(wood, [co * reach, top + 3.3, s * reach], [1.0, 1.0, 1.0]);
    }
    // A coat on a hook in front, a hat on the one behind it.
    let coat_top = top - 2.0;
    let length = (h * 0.5).min(coat_top - 10.0);
    // Its hem, its body, its shoulders on the hook.
    let fall: Vec<[f64; 2]> = [
        [0.0, 0.0],
        [0.5, 0.0],
        [0.44, 0.45],
        [0.48, 0.82],
        [0.42, 0.92],
        [0.14, 0.99],
        [0.0, 1.0],
    ]
    .iter()
    .map(|p| [p[0], p[1] * length])
    .collect();
    m.lathe(
        Material::fabric(Rgb8::from_u32(0x8a5a3a)),
        [0.0, coat_top - length, r * 0.3],
        &fall,
        [r * 1.05, r * 0.42],
    );
    m.lathe(
        Material::fabric(Rgb8::from_u32(0x2f3a4a)),
        [-r * 0.15, top + 1.0, -r * 0.3],
        &[
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 0.3],
            [0.55, 0.4],
            [0.55, 1.0],
            [0.45, 1.15],
            [0.0, 1.15],
        ],
        [9.0, 9.0],
    );
}

/// Buttons sunk in upholstery, a grid with every other row offset, on the face at `z` (facing
/// `+z`) between `x0` and `x1`, `y0` and `y1`.
fn tufts(m: &mut Model<'_>, x: [f64; 2], y: [f64; 2], z: f64, spacing: f64) {
    let button = Material::fabric(shade(m.c, 0.62));
    let cols = ((x[1] - x[0]) / spacing).floor().max(1.0);
    let rows = ((y[1] - y[0]) / spacing).floor().max(1.0);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    for r in 0..=rows as usize {
        #[allow(clippy::cast_precision_loss)]
        let yy = y[0] + (y[1] - y[0]) * r as f64 / rows;
        let shift = if r % 2 == 0 { 0.0 } else { 0.5 };
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        for k in 0..=cols as usize {
            #[allow(clippy::cast_precision_loss)]
            let t = (k as f64 + shift) / (cols + 1.0) + 0.5 / (cols + 1.0) * (1.0 - shift * 2.0);
            let xx = x[0] + (x[1] - x[0]) * t;
            if xx > x[1] - 1.0 {
                continue;
            }
            m.blk(button, [xx, yy - 0.7, z], [1.4, 1.4, 0.8]);
        }
    }
}

/// A Chesterfield: its arms rolled over at the height of its back, the back and arms deep
/// buttoned, its seat cushions, on bun feet.
pub(super) fn chesterfield(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let leather = Material::new(c, 0.45, Surface::Matte);
    let feet = 6.0_f64.min(h * 0.1);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.sph(
                Material::wood(WOOD_DARK),
                [sx * (w / 2.0 - 7.0), feet / 2.0, sz * (d / 2.0 - 7.0)],
                [3.2, feet / 2.0 + 0.3, 3.2],
            );
        }
    }
    let seat = (h * 0.55).min(44.0);
    let arm = (w * 0.1).clamp(8.0, 22.0);
    let back = (d * 0.22).min(22.0);
    let roll = (arm * 0.55).min((h - seat) * 0.6);
    m.soft(
        leather,
        [-w / 2.0, feet, -d / 2.0],
        [w / 2.0, seat - 9.0, d / 2.0],
        3.0,
    );
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * w / 2.0, sx * (w / 2.0 - arm));
        m.soft(
            leather,
            [a.min(b), feet, -d / 2.0],
            [a.max(b), h - roll, d / 2.0],
            2.5,
        );
        let x = sx * (w / 2.0 - arm / 2.0);
        m.pipe(
            leather,
            &[[x, h - roll, -d / 2.0 + roll], [x, h - roll, d / 2.0 - 1.0]],
            roll,
        );
    }
    m.soft(
        leather,
        [-w / 2.0 + arm, feet, -d / 2.0],
        [w / 2.0 - arm, h - roll * 0.6, -d / 2.0 + back],
        2.5,
    );
    m.pipe(
        leather,
        &[
            [-w / 2.0 + arm - 1.0, h - roll * 0.8, -d / 2.0 + back * 0.5],
            [w / 2.0 - arm + 1.0, h - roll * 0.8, -d / 2.0 + back * 0.5],
        ],
        (roll * 0.75).min(back * 0.55),
    );
    tufts(
        m,
        [-w / 2.0 + arm + 6.0, w / 2.0 - arm - 6.0],
        [seat + 8.0, h - roll * 1.5],
        -d / 2.0 + back,
        14.0,
    );
    let inner = w - 2.0 * arm;
    let n = if inner > 140.0 {
        3
    } else if inner > 80.0 {
        2
    } else {
        1
    };
    let cw = inner / f64::from(n);
    for i in 0..n {
        let x0 = -w / 2.0 + arm + cw * f64::from(i);
        m.soft(
            Material {
                color: shade(c, 1.06),
                ..leather
            },
            [x0 + 0.6, seat - 9.0, -d / 2.0 + back],
            [x0 + cw - 0.6, seat, d / 2.0 - 1.0],
            3.0,
        );
    }
}

/// A wing chair: its tall back, the wings beside the head, its rolled arms, the seat cushion, on
/// short legs.
pub(super) fn wingback(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let fabric = Material::fabric(c);
    let legs = (h * 0.11).min(13.0);
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.cyl(
                Material::wood(WOOD_DARK),
                [sx * (w / 2.0 - 5.0), 0.0, sz * (d / 2.0 - 5.0)],
                [1.3, 2.0],
                legs + 0.5,
            );
        }
    }
    let seat = (h * 0.4).min(44.0);
    let arm_y = seat + (h - seat) * 0.3;
    let back = (d * 0.17).min(16.0);
    let arm = (w * 0.14).clamp(6.0, 13.0);
    m.soft(
        fabric,
        [-w / 2.0, legs, -d / 2.0],
        [w / 2.0, seat - 6.0, d / 2.0],
        2.5,
    );
    m.soft(
        fabric,
        [-w / 2.0 + arm, legs, -d / 2.0],
        [w / 2.0 - arm, h, -d / 2.0 + back],
        3.0,
    );
    for sx in [-1.0, 1.0] {
        let (a, b) = (sx * w / 2.0, sx * (w / 2.0 - arm));
        m.soft(
            fabric,
            [a.min(b), legs, -d / 2.0 + back * 0.5],
            [a.max(b), arm_y - arm * 0.4, d / 2.0],
            2.0,
        );
        let x = sx * (w / 2.0 - arm / 2.0);
        m.pipe(
            fabric,
            &[
                [x, arm_y - arm * 0.45, -d / 2.0 + back],
                [x, arm_y - arm * 0.45, d / 2.0 - 0.5],
            ],
            arm * 0.55,
        );
        // The wing: up from the arm to the top of the back, rounded forwards at the head.
        let reach = (d * 0.36).min(32.0);
        let wing = [
            [-d / 2.0, arm_y - 2.0],
            [-d / 2.0, h - 3.0],
            [-d / 2.0 + 4.0, h],
            [-d / 2.0 + reach * 0.55, h - 3.0],
            [-d / 2.0 + reach * 0.95, h - (h - arm_y) * 0.25],
            [-d / 2.0 + reach, h - (h - arm_y) * 0.5],
            [-d / 2.0 + reach * 0.8, arm_y - 2.0],
        ];
        let (x0, x1) = (sx * (w / 2.0 - arm * 0.15), sx * (w / 2.0 - arm * 0.85));
        m.side_slab(fabric, &wing, x0.min(x1), x0.max(x1));
    }
    m.soft(
        Material {
            color: shade(c, 1.07),
            ..fabric
        },
        [-w / 2.0 + arm + 0.5, seat - 6.0, -d / 2.0 + back],
        [w / 2.0 - arm - 0.5, seat + 2.0, d / 2.0 - 0.5],
        3.0,
    );
    tufts(
        m,
        [-w / 2.0 + arm + 8.0, w / 2.0 - arm - 8.0],
        [seat + 14.0, h - 14.0],
        -d / 2.0 + back,
        15.0,
    );
}

/// A coffee table: `round`, a round top on four tapered legs; `glass`, a top of glass on a slim
/// frame over a shelf of wood.
pub(super) fn coffee_table(m: &mut Model<'_>, glass: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = surface(c);
    if glass {
        let frame = Material::metal(Rgb8::from_u32(0x2b2d2f));
        let t = 1.6;
        for sx in [-1.0, 1.0] {
            for sz in [-1.0, 1.0] {
                m.blk(
                    frame,
                    [sx * (w / 2.0 - t), 0.0, sz * (d / 2.0 - t)],
                    [2.0 * t, h - 1.0, 2.0 * t],
                );
            }
            m.bx(
                frame,
                [sx * (w / 2.0) - t, h - 3.0, -d / 2.0],
                [sx * (w / 2.0) + t, h - 1.0, d / 2.0],
            );
        }
        for sz in [-1.0, 1.0] {
            m.bx(
                frame,
                [-w / 2.0, h - 3.0, sz * (d / 2.0) - t],
                [w / 2.0, h - 1.0, sz * (d / 2.0) + t],
            );
        }
        m.bx(
            Material::glass(),
            [-w / 2.0, h - 1.0, -d / 2.0],
            [w / 2.0, h, d / 2.0],
        );
        m.soft(
            wood,
            [-w / 2.0 + 2.0 * t, 10.0, -d / 2.0 + 2.0 * t],
            [w / 2.0 - 2.0 * t, 12.5, d / 2.0 - 2.0 * t],
            0.5,
        );
        return;
    }
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
        [0.0, h - 9.0, 0.0],
        [w / 2.0 * 0.86, d / 2.0 * 0.86],
        [w / 2.0 * 0.86, d / 2.0 * 0.86],
        5.5,
        24,
        true,
    );
    for k in 0..4 {
        let a = f64::from(k) * TAU / 4.0 + TAU / 8.0;
        let (s, co) = a.sin_cos();
        m.rod(
            wood,
            [co * w / 2.0 * 0.7, 0.0, s * d / 2.0 * 0.7],
            [co * w / 2.0 * 0.6, h - 8.0, s * d / 2.0 * 0.6],
            1.6,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flame_closes_to_a_point() {
        for k in 0..=20 {
            let v = flame(f64::from(k) / 20.0);
            assert!(v.is_finite() && (0.0..=1.0).contains(&v));
        }
        assert!(flame(1.0).abs() < 1e-9);
        assert!(flame(0.3) > flame(0.9));
    }

    #[test]
    fn a_keyboard_has_36_black_keys() {
        let black = (0..51)
            .filter(|i| matches!(i % 7, 0 | 2 | 3 | 5 | 6))
            .count();
        assert_eq!(black, 36);
    }
}
