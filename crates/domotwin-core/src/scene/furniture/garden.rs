//! The garden's pieces (M18, D-077): trees, shrubs and hedges, planters, garden furniture, a
//! parasol, a barbecue and a fire pit, garden lights, a pool and a hot tub, a robot mower's dock,
//! a shed, a pergola, a greenhouse, a trampoline, a swing, fences and gates, a letter box.
//!
//! Foliage is drawn as blobs of leaves, few sides each, so that a tree as tall as a house costs
//! about what a sofa does.

use std::f64::consts::{FRAC_PI_2, FRAC_PI_4, PI, TAU};

use super::{CHROME, DARK, Material, Model, Rgb8, STEEL, Surface, V3, shade, surface};
use crate::scene::mesh::{Blade, Xform};

/// Bark, and the light wood of garden furniture.
const BARK: Rgb8 = Rgb8::from_u32(0x5b4636);
const TEAK: Rgb8 = Rgb8::from_u32(0xa0784e);
/// Soil, and stone.
const SOIL: Rgb8 = Rgb8::from_u32(0x4a3a2a);
const STONE: Rgb8 = Rgb8::from_u32(0x8f8a82);
/// A pool's coping, and its water at the edge (the deep end darker, as the piece's colour says).
const COPING: Rgb8 = Rgb8::from_u32(0xd8d2c4);
/// The sides of a blob of foliage: a ball of leaves needs few, a small one fewer.
const FOLIAGE_SIDES: usize = 10;
const SMALL_FOLIAGE_SIDES: usize = 8;

/// A leaf's material, a shade of `green` lighter or darker each time.
fn leaves(m: &mut Model<'_>, green: Rgb8) -> Material {
    Material::new(shade(green, 0.8 + 0.34 * m.rng.next()), 0.7, Surface::Leaf)
}

/// A blob of foliage centred on `c`, of radii `r`.
fn foliage(m: &mut Model<'_>, green: Rgb8, c: V3, r: V3) {
    let tone = leaves(m, green);
    let x = m.x;
    m.p.material = tone;
    let sides = if r[0].max(r[1]).max(r[2]) < 15.0 {
        SMALL_FOLIAGE_SIDES
    } else {
        FOLIAGE_SIDES
    };
    m.p.sphere(&x, c, r, sides);
}

/// A point on the surface of the ellipsoid of centre `c` and radii `r`, from two shares 0–1.
fn on_ellipsoid(c: V3, r: V3, a: f64, b: f64) -> V3 {
    let theta = a * TAU;
    let phi = (1.0 - 2.0 * b).clamp(-1.0, 1.0).acos();
    [
        c[0] + r[0] * phi.sin() * theta.cos(),
        c[1] + r[1] * phi.cos(),
        c[2] + r[2] * phi.sin() * theta.sin(),
    ]
}

/// A tree: a broad crown of leaves on a trunk branching into it; `fruit`, a smaller round one
/// with its fruit; `conifer`, tiers of needles to a point; `palm`, a slender trunk with its fronds.
pub(super) fn tree(m: &mut Model<'_>, variant: Option<&str>) {
    match variant {
        Some("conifer") => conifer(m),
        Some("palm") => palm(m),
        _ => leafy(m, variant == Some("fruit")),
    }
}

fn leafy(m: &mut Model<'_>, fruit: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let (rx, rz) = (w / 2.0, d / 2.0);
    let crown = h * if fruit { 0.32 } else { 0.4 };
    let ry = (h - crown) / 2.0;
    let cy = crown + ry;
    let trunk = (rx.min(rz) * 0.08).clamp(3.0, 30.0);
    let bark = Material::wood(BARK);
    let x = m.x;
    m.p.material = bark;
    m.p.cylinder(&x, [0.0; 3], [trunk * 1.2, trunk * 0.75], cy, 8, false);
    // Boughs from the top of the trunk into the crown.
    for k in 0..3 {
        let a = f64::from(k) * TAU / 3.0 + m.rng.next();
        let end = [a.cos() * rx * 0.4, cy + ry * 0.2, a.sin() * rz * 0.4];
        m.twig(bark, [0.0, crown * 0.95, 0.0], end, trunk * 0.45);
    }
    // The crown: a heart of leaves, blobs round it and one on top, all within the footprint.
    foliage(m, c, [0.0, cy, 0.0], [rx * 0.7, ry * 0.78, rz * 0.7]);
    let blobs = if fruit { 6 } else { 8 };
    let mut fruits = Vec::new();
    for k in 0..blobs {
        let a = f64::from(k) / f64::from(blobs) * TAU + m.rng.next() * 0.5;
        let reach = 0.36 + 0.1 * m.rng.next();
        let size = 0.42 + 0.1 * m.rng.next();
        let up = (m.rng.next() - 0.5) * 0.5;
        let at = [a.cos() * rx * reach, cy + up * ry, a.sin() * rz * reach];
        let r = [rx * size, ry * size * 1.15, rz * size];
        foliage(m, c, at, r);
        if fruit {
            fruits.push((at, r));
        }
    }
    foliage(
        m,
        c,
        [0.0, h - ry * 0.45, 0.0],
        [rx * 0.4, ry * 0.45, rz * 0.4],
    );
    // Fruit, red and orange, on the outside of the crown.
    for (k, (at, r)) in fruits.iter().enumerate() {
        for j in 0..2 {
            let p = on_ellipsoid(*at, *r, m.rng.next(), 0.25 + 0.5 * m.rng.next());
            let tone = if (k + j) % 3 == 0 { 0xe08a2c } else { 0xc8352a };
            let size = (rx * 0.03).clamp(2.5, 3.8);
            m.sph(
                Material::new(Rgb8::from_u32(tone), 0.4, Surface::Matte),
                p,
                [size; 3],
            );
        }
    }
}

fn conifer(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let (rx, rz) = (w / 2.0, d / 2.0);
    let trunk = (rx.min(rz) * 0.07).clamp(3.0, 25.0);
    let x = m.x;
    m.p.material = Material::wood(BARK);
    m.p.cylinder(&x, [0.0; 3], [trunk, trunk * 0.6], h * 0.3, 8, false);
    // Tiers of needles narrowing to the top, each over the one below.
    let tiers = 6;
    let base = h * 0.12;
    let tall = (h - base) * 0.3;
    for k in 0..tiers {
        let t = f64::from(k) / f64::from(tiers);
        let y = base + (h - base - tall) * t;
        let s = 1.0 - 0.72 * t;
        let tone = leaves(m, c);
        m.p.material = tone;
        m.p.ellipse_cylinder(
            &x,
            [0.0, y, 0.0],
            [rx * s, rz * s],
            [rx * 0.06, rz * 0.06],
            tall,
            12,
            true,
        );
    }
}

/// A palm frond's outline: narrow at the stem, widest near its middle, to a point.
fn frond(t: f64) -> f64 {
    (PI * t.powf(0.8)).sin().max(0.0) * (1.0 - t * 0.3)
}

fn palm(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let r = w.min(d) / 2.0;
    let crown = h - r * 0.35;
    // The trunk leaning a little and bending back, ringed.
    let lean = r * 0.18;
    let trunk = (r * 0.09).clamp(5.0, 20.0);
    let rings = 8;
    let x = m.x;
    let at = |t: f64| [lean * (t * PI * 0.8).sin(), crown * t, 0.0];
    for k in 0..rings {
        let (t0, t1) = (
            f64::from(k) / f64::from(rings),
            f64::from(k + 1) / f64::from(rings),
        );
        let (a, b) = (at(t0), at(t1));
        let s = 1.0 - 0.35 * t0;
        m.p.material = Material::wood(shade(BARK, if k % 2 == 0 { 1.25 } else { 1.4 }));
        m.p.tube(&x, a, b, trunk * s, 8, false);
    }
    let top = at(1.0);
    m.sph(Material::wood(shade(BARK, 1.1)), top, [trunk * 0.9; 3]);
    for k in 0..10 {
        let a = f64::from(k) / 10.0 * TAU + m.rng.next() * 0.4;
        let length = r * (0.85 + 0.15 * m.rng.next()) - lean.abs() * 0.5;
        let form = Blade {
            size: [length, (length * 0.22).max(8.0)],
            shape: frond,
            fold: 0.45,
            droop: length * 0.5,
            segments: 6,
        };
        let tone = leaves(m, c);
        let rise = 0.15 + 0.4 * m.rng.next();
        m.leaf(tone, top, [a.cos(), rise, a.sin()], &form);
    }
}

/// A shrub: a bush of a few blobs of leaves; `boxwood`, one clipped ball; `flowering`, a bush in
/// flower.
pub(super) fn shrub(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let (rx, rz) = (w / 2.0, d / 2.0);
    if variant == Some("boxwood") {
        let tone = Material::new(c, 0.75, Surface::Leaf);
        let x = m.x;
        m.p.material = tone;
        m.p.sphere(&x, [0.0, h / 2.0, 0.0], [rx, h / 2.0, rz], 14);
        return;
    }
    let ry = h / 2.0;
    foliage(m, c, [0.0, ry * 0.9, 0.0], [rx * 0.7, ry * 0.85, rz * 0.7]);
    let mut blobs = Vec::new();
    for k in 0..5 {
        let a = f64::from(k) / 5.0 * TAU + m.rng.next() * 0.6;
        let size = 0.45 + 0.1 * m.rng.next();
        let at = [
            a.cos() * rx * (1.0 - size) * 0.95,
            ry * (0.6 + 0.5 * m.rng.next()).min(2.0 - size * 1.1),
            a.sin() * rz * (1.0 - size) * 0.95,
        ];
        let r = [rx * size, ry * size * 1.05, rz * size];
        foliage(m, c, at, r);
        blobs.push((at, r));
    }
    if variant == Some("flowering") {
        for (at, r) in blobs {
            for _ in 0..3 {
                let p = on_ellipsoid(at, r, m.rng.next(), 0.1 + 0.45 * m.rng.next());
                let tone = if m.rng.next() < 0.5 {
                    0xe08fb5
                } else {
                    0xf2e7ef
                };
                let size = (rx * 0.05).clamp(2.0, 3.8);
                m.sph(Material::fabric(Rgb8::from_u32(tone)), p, [size; 3]);
            }
        }
    }
}

/// A clipped hedge: a block of leaves, rounded, lumpy along its top and sides.
pub(super) fn hedge(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let inset = (d * 0.12).min(8.0);
    let tone = Material::new(c, 0.75, Surface::Leaf);
    m.soft(
        tone,
        [-w / 2.0 + inset, 0.0, -d / 2.0 + inset],
        [w / 2.0 - inset, h - inset, d / 2.0 - inset],
        d.min(h) * 0.2,
    );
    // Tufts along it, every half metre or so (a dozen at most), on its top and both faces.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let n = ((w / 50.0).round() as usize).clamp(1, 12);
    #[allow(clippy::cast_precision_loss)]
    for k in 0..n {
        let size = (w / n as f64 * 0.55).min(d * 0.5);
        let reach = (w / 2.0 - size).max(0.0);
        let x0 = (-w / 2.0 + w * (k as f64 + 0.5) / n as f64).clamp(-reach, reach);
        let across = (size * 0.75).min(d / 2.0);
        for (y, z) in [
            (h - size * 0.9, 0.0),
            (h * 0.55, d / 2.0 - across),
            (h * 0.5, -d / 2.0 + across),
        ] {
            foliage(m, c, [x0, y, z], [size, size * 0.9, across]);
        }
    }
}

/// A planter: a wooden box of soil with plants in it; `raised-bed`, a frame of boards and rows of
/// vegetables.
pub(super) fn planter(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = Material::wood(c);
    let board = 3.0_f64.min(w.min(d) * 0.1);
    let soil = Material::new(SOIL, 1.0, Surface::Soil);
    if variant == Some("raised-bed") {
        // The frame: two boards high, its corners posts.
        for (min, max) in [
            ([-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, -d / 2.0 + board]),
            ([-w / 2.0, 0.0, d / 2.0 - board], [w / 2.0, h, d / 2.0]),
            ([-w / 2.0, 0.0, -d / 2.0], [-w / 2.0 + board, h, d / 2.0]),
            ([w / 2.0 - board, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0]),
        ] {
            m.bx(wood, min, max);
        }
        m.bx(
            Material::wood(shade(c, 0.8)),
            [-w / 2.0 - 0.5, h * 0.48, -d / 2.0 - 0.5],
            [w / 2.0 + 0.5, h * 0.52, d / 2.0 + 0.5],
        );
        m.bx(
            soil,
            [-w / 2.0 + board, 0.0, -d / 2.0 + board],
            [w / 2.0 - board, h - 4.0, d / 2.0 - board],
        );
        // Rows of vegetables across it.
        let rows = ((d - 2.0 * board) / 35.0).floor().clamp(1.0, 6.0);
        let per_row = ((w - 2.0 * board) / 30.0).floor().clamp(1.0, 16.0);
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        for i in 0..rows as usize {
            #[allow(clippy::cast_precision_loss)]
            let z = -d / 2.0 + board + (d - 2.0 * board) * (i as f64 + 0.5) / rows;
            let green = Rgb8::from_u32(if i % 2 == 0 { 0x6f9a3e } else { 0x4f7a3a });
            for j in 0..per_row as usize {
                #[allow(clippy::cast_precision_loss)]
                let x0 = -w / 2.0 + board + (w - 2.0 * board) * (j as f64 + 0.5) / per_row;
                let size = 9.0 + 3.0 * m.rng.next();
                foliage(
                    m,
                    green,
                    [x0, h - 4.0 + size * 0.4, z],
                    [size, size * 0.7, size],
                );
            }
        }
        return;
    }
    m.soft(
        wood,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h * 0.62, d / 2.0],
        1.0,
    );
    m.bx(
        soil,
        [-w / 2.0 + board, 0.0, -d / 2.0 + board],
        [w / 2.0 - board, h * 0.62 + 0.4, d / 2.0 - board],
    );
    // Plants along it, up to its height.
    let n = (w / 30.0).round().clamp(1.0, 10.0);
    let top = h * 0.62;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    for k in 0..n as usize {
        #[allow(clippy::cast_precision_loss)]
        let x0 = -w / 2.0 + w * (k as f64 + 0.5) / n;
        let r = (w / n * 0.5).min(d * 0.45);
        let ry = (h - top) / 2.0;
        foliage(
            m,
            Rgb8::from_u32(0x5f8a44),
            [x0, top + ry, 0.0],
            [r, ry, r.min(d / 2.0)],
        );
        if m.rng.next() < 0.6 {
            let p = on_ellipsoid([x0, top + ry, 0.0], [r, ry, r], m.rng.next(), 0.2);
            m.sph(Material::fabric(Rgb8::from_u32(0xd9534f)), p, [3.0; 3]);
        }
    }
}

/// A slatted top `y0`–`y1`, its slats along x, `n` of them across.
fn slats(m: &mut Model<'_>, mat: Material, half: [f64; 2], y: [f64; 2], n: u32) {
    let gap = 0.8;
    let step = 2.0 * half[1] / f64::from(n);
    for k in 0..n {
        let z0 = -half[1] + step * f64::from(k);
        m.bx(
            mat,
            [-half[0], y[0], z0 + gap / 2.0],
            [half[0], y[1], z0 + step - gap / 2.0],
        );
    }
}

/// A garden table: a slatted top on a metal frame; `round`, a round top on a stand.
pub(super) fn garden_table(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let frame = Material::metal(c);
    let top = Material::wood(TEAK);
    if variant == Some("round") {
        m.cyl(
            top,
            [0.0, h - 3.0, 0.0],
            [w.min(d) / 2.0, w.min(d) / 2.0],
            3.0,
        );
        m.cyl(frame, [0.0, 0.0, 0.0], [3.0, 3.0], h - 3.0);
        for k in 0..4 {
            let a = f64::from(k) * FRAC_PI_2 + FRAC_PI_4;
            let r = w.min(d) * 0.32;
            m.rod(frame, [0.0, 8.0, 0.0], [a.cos() * r, 0.0, a.sin() * r], 1.5);
        }
        return;
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let n = ((d / 9.0).round() as u32).clamp(3, 16);
    slats(m, top, [w / 2.0, d / 2.0], [h - 3.0, h], n);
    m.bx(
        frame,
        [-w / 2.0 + 2.0, h - 7.0, -d / 2.0 + 2.0],
        [w / 2.0 - 2.0, h - 3.0, -d / 2.0 + 4.0],
    );
    m.bx(
        frame,
        [-w / 2.0 + 2.0, h - 7.0, d / 2.0 - 4.0],
        [w / 2.0 - 2.0, h - 3.0, d / 2.0 - 2.0],
    );
    m.legs(frame, 4.0, 4.0, h - 3.0);
}

/// A garden chair: a metal frame, a slatted seat and back.
pub(super) fn garden_chair(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let frame = Material::metal(c);
    let wood = Material::wood(TEAK);
    let seat = 44.0_f64.min(h * 0.52);
    slats(
        m,
        wood,
        [w / 2.0 - 2.0, d / 2.0 - 4.0],
        [seat - 2.0, seat],
        5,
    );
    for sx in [-1.0, 1.0] {
        let x0 = sx * (w / 2.0 - 2.0);
        // Front leg, back leg up to the top of the back, the arm between.
        m.rod(
            frame,
            [x0, 0.0, d / 2.0 - 3.0],
            [x0, seat + 20.0, d / 2.0 - 5.0],
            1.3,
        );
        m.rod(
            frame,
            [x0, 0.0, -d / 2.0 + 3.0],
            [x0, h, -d / 2.0 + 1.5],
            1.3,
        );
        m.rod(
            frame,
            [x0, seat + 20.0, d / 2.0 - 5.0],
            [x0, seat + 20.0, -d / 2.0 + 2.5],
            1.2,
        );
    }
    // The back's slats, leaning a little, within the piece.
    let lean = 0.24 * (h - seat - 4.0);
    let back = Xform {
        axes: [[1.0, 0.0, 0.0], [0.0, 0.97, -0.24], [0.0, 0.24, 0.97]],
        origin: [0.0, seat + 4.0, -d / 2.0 + 2.0 + lean],
    };
    let frame_back = m.x.then(&back);
    for k in 0..4 {
        let y0 = (h - seat - 8.0) * f64::from(k) / 4.0;
        m.bx_in(
            wood,
            &frame_back,
            [-w / 2.0 + 3.0, y0, -1.0],
            [w / 2.0 - 3.0, y0 + 6.0, 1.0],
        );
    }
}

/// A sun lounger: a slatted bed on legs, its back raised, a cushion on it.
pub(super) fn sun_lounger(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = Material::wood(TEAK);
    let bed = 30.0_f64.min(h * 0.45);
    let back = (d * 0.32).min(70.0);
    // The flat part, its legs, its frame.
    m.bx(
        wood,
        [-w / 2.0, bed - 4.0, -d / 2.0 + back],
        [w / 2.0, bed, d / 2.0],
    );
    for z in [-d / 2.0 + back + 4.0, d / 2.0 - 4.0] {
        for sx in [-1.0, 1.0] {
            m.blk(wood, [sx * (w / 2.0 - 3.0), 0.0, z], [4.0, bed - 4.0, 4.0]);
        }
    }
    let cushion = Material::fabric(c);
    m.soft(
        cushion,
        [-w / 2.0 + 3.0, bed, -d / 2.0 + back],
        [w / 2.0 - 3.0, bed + 6.0, d / 2.0 - 3.0],
        2.5,
    );
    // The back, raised to the top of the piece.
    let rise = (h - bed).max(1.0);
    let length = back.hypot(rise);
    let (s, co) = (rise / length, back / length);
    let tilt = Xform {
        axes: [[1.0, 0.0, 0.0], [0.0, co, -s], [0.0, s, co]],
        origin: [0.0, bed, -d / 2.0 + back],
    };
    let frame = m.x.then(&tilt);
    m.bx_in(wood, &frame, [-w / 2.0, -4.0, -length], [w / 2.0, 0.0, 0.0]);
    m.bx_in(
        cushion,
        &frame,
        [-w / 2.0 + 3.0, 0.0, -length + 2.0],
        [w / 2.0 - 3.0, 6.0, 0.0],
    );
    // The prop under the back.
    m.rod(
        wood,
        [0.0, 2.0, -d / 2.0 + back * 0.3],
        [0.0, bed + rise * 0.55, -d / 2.0 + back * 0.4],
        1.5,
    );
}

/// A parasol: a weighted base, its pole and an open canopy with its ribs; `closed`, folded round
/// its pole; `cantilever`, a square canopy hung from an arm, its pole to the side.
pub(super) fn parasol(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let pole = Material::metal(STEEL);
    let canopy = Material::fabric(c);
    let r = w.min(d) / 2.0;
    if variant == Some("cantilever") {
        let foot = [-w / 2.0 + 30.0, 0.0, 0.0];
        m.blk(Material::paint(DARK), foot, [55.0, 8.0, 55.0]);
        m.rod(pole, foot, [foot[0], h - 20.0, 0.0], 3.0);
        m.rod(pole, [foot[0], h - 20.0, 0.0], [0.0, h - 2.0, 0.0], 2.2);
        m.rod(pole, [0.0, h - 2.0, 0.0], [0.0, h - 45.0, 0.0], 1.2);
        // A square canopy, a pyramid hung under the arm's end.
        let x = m.x.turned_y(FRAC_PI_4);
        m.p.material = canopy;
        let side = r * std::f64::consts::SQRT_2;
        m.p.lathe(
            &x,
            [0.0, h - 45.0, 0.0],
            &[[side, 0.0], [side * 0.95, 4.0], [2.0, 30.0], [0.0, 31.0]],
            [1.0, 1.0],
            4,
        );
        return;
    }
    m.cyl(
        Material::paint(DARK),
        [0.0; 3],
        [22.0_f64.min(r), 20.0_f64.min(r)],
        8.0,
    );
    if variant == Some("closed") {
        m.rod(pole, [0.0, 0.0, 0.0], [0.0, h, 0.0], 2.0);
        m.lathe(
            canopy,
            [0.0, h * 0.45, 0.0],
            &[
                [2.0, 0.0],
                [r * 0.6, h * 0.25],
                [r * 0.45, h * 0.45],
                [1.5, h * 0.52],
            ],
            [1.0, 1.0],
        );
        return;
    }
    m.rod(pole, [0.0, 0.0, 0.0], [0.0, h, 0.0], 2.0);
    let rim = h - r * 0.35 - 10.0;
    m.lathe(
        canopy,
        [0.0, rim, 0.0],
        &[
            [r, -6.0],
            [r, 0.0],
            [r * 0.5, r * 0.22],
            [3.0, r * 0.33],
            [0.0, r * 0.35],
        ],
        [1.0, 1.0],
    );
    for k in 0..8 {
        let a = f64::from(k) * TAU / 8.0;
        m.rod(
            pole,
            [0.0, rim - r * 0.25, 0.0],
            [a.cos() * r * 0.55, rim + r * 0.12, a.sin() * r * 0.55],
            0.6,
        );
    }
}

/// A gas barbecue on its cart, its hood down, side shelves; `kettle`, a round kettle on three legs.
pub(super) fn barbecue(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::new(c, 0.35, Surface::Metal);
    let steel = Material::metal(STEEL);
    if variant == Some("kettle") {
        let r = w.min(d) / 2.0;
        let bowl_at = h * 0.62;
        m.lathe(
            body,
            [0.0, bowl_at - r * 0.75, 0.0],
            &[[0.0, 0.0], [r * 0.7, r * 0.15], [r, r * 0.6], [r, r * 0.75]],
            [1.0, 1.0],
        );
        m.lathe(
            body,
            [0.0, bowl_at, 0.0],
            &[
                [r * 1.01, 0.0],
                [r * 0.95, r * 0.35],
                [r * 0.6, r * 0.62],
                [0.0, r * 0.7],
            ],
            [1.0, 1.0],
        );
        m.cyl(steel, [0.0, bowl_at + r * 0.7, 0.0], [2.5, 2.5], 3.0);
        for k in 0..3 {
            let a = f64::from(k) * TAU / 3.0;
            m.rod(
                steel,
                [a.cos() * r * 0.4, bowl_at - r * 0.6, a.sin() * r * 0.4],
                [a.cos() * r * 0.85, 0.0, a.sin() * r * 0.85],
                1.2,
            );
        }
        return;
    }
    let cart = (w * 0.62).min(w - 20.0);
    let top = h * 0.8;
    // The cart, its doors and wheels.
    m.bx(
        body,
        [-cart / 2.0, 12.0, -d / 2.0 + 4.0],
        [cart / 2.0, top - 12.0, d / 2.0],
    );
    m.bx(
        Material::metal(shade(c, 1.4)),
        [-cart / 2.0 + 2.0, 16.0, d / 2.0],
        [cart / 2.0 - 2.0, top - 16.0, d / 2.0 + 0.6],
    );
    for sx in [-1.0, 1.0] {
        m.blk(
            Material::paint(DARK),
            [sx * (cart / 2.0 - 8.0), 0.0, d / 2.0 - 10.0],
            [5.0, 12.0, 12.0],
        );
        m.blk(
            steel,
            [sx * (cart / 2.0 - 3.0), 0.0, -d / 2.0 + 8.0],
            [4.0, 12.0, 4.0],
        );
    }
    // The firebox with its knobs, the hood over it, the shelves at each side.
    m.bx(
        body,
        [-cart / 2.0, top - 12.0, -d / 2.0 + 4.0],
        [cart / 2.0, top, d / 2.0],
    );
    for k in 0..3 {
        let x0 = -cart / 3.0 + cart / 3.0 * f64::from(k);
        m.blk(steel, [x0, top - 8.0, d / 2.0 + 1.0], [4.0, 4.0, 2.5]);
    }
    let half = (d - 4.0) / 2.0;
    let arc: Vec<[f64; 2]> = (0..=8)
        .map(|k| {
            let a = f64::from(k) / 8.0 * PI;
            [2.0 + a.cos() * half, top + a.sin() * (h - top)]
        })
        .collect();
    m.side_slab(body, &arc, -cart / 2.0, cart / 2.0);
    // Its handle in front of the hood, half way up.
    let grip = 2.0 + half * 0.6_f64.cos() + 3.0;
    let grip_y = top + (h - top) * 0.6_f64.sin();
    m.rod(
        steel,
        [-cart * 0.3, grip_y, grip.min(d / 2.0 - 1.5)],
        [cart * 0.3, grip_y, grip.min(d / 2.0 - 1.5)],
        1.2,
    );
    for sx in [-1.0, 1.0] {
        m.bx(
            steel,
            [sx * cart / 2.0, top - 3.0, -d / 2.0 + 6.0],
            [sx * w / 2.0, top - 1.0, d / 2.0 - 2.0],
        );
    }
}

/// A fire pit: a ring of stone, logs in it, its fire burning while what it is linked to is on.
pub(super) fn fire_pit(m: &mut Model<'_>) {
    let (w, d, h) = (m.w, m.d, m.h);
    let r = w.min(d) / 2.0;
    let stone = Material::new(STONE, 0.9, Surface::Matte);
    m.lathe(
        stone,
        [0.0; 3],
        &[[r * 0.72, h * 0.6], [r * 0.72, h], [r, h], [r, 0.0]],
        [w / 2.0 / r, d / 2.0 / r],
    );
    m.cyl(
        Material::paint(Rgb8::from_u32(0x2b221d)),
        [0.0; 3],
        [r * 0.73, r * 0.73],
        h * 0.6,
    );
    let logs = Material::wood(Rgb8::from_u32(0x4a3628));
    for k in 0..3 {
        let a = f64::from(k) * TAU / 3.0 + 0.3;
        let (s, c) = a.sin_cos();
        m.rod(
            logs,
            [c * r * 0.5, h * 0.6, s * r * 0.5],
            [-c * r * 0.1, h * 0.6 + r * 0.22, -s * r * 0.1],
            (r * 0.07).max(1.5),
        );
    }
    super::living::flames(m, [0.0, h * 0.6 + 2.0, 0.0], r * 0.8, r * 0.9);
}

/// A garden light: a bollard; `post`, a lantern on a post; `string`, bulbs hung along a wire.
pub(super) fn garden_light(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::new(c, 0.45, Surface::Metal);
    let glow = Material::glow(Rgb8::from_u32(0xeee9dc));
    match variant {
        Some("string") => {
            // A wire sagging between its ends, a bulb hung every 50 cm; two of them light.
            let sag = (w * 0.05).min(30.0);
            let at = |t: f64| {
                [
                    -w / 2.0 + w * t,
                    h - sag * (1.0 - (2.0 * t - 1.0).powi(2)),
                    0.0,
                ]
            };
            let points: Vec<V3> = (0..=12).map(|k| at(f64::from(k) / 12.0)).collect();
            m.pipe(Material::paint(DARK), &points, 0.4);
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let n = ((w / 50.0).round() as usize).clamp(2, 40);
            #[allow(clippy::cast_precision_loss)]
            for k in 0..n {
                let p = at((k as f64 + 0.5) / n as f64);
                m.sph(glow, [p[0], p[1] - 4.0, p[2]], [2.2, 3.0, 2.2]);
            }
            m.bulbs.push([-w / 4.0, h - sag * 0.75 - 4.0, 0.0]);
            m.bulbs.push([w / 4.0, h - sag * 0.75 - 4.0, 0.0]);
            let _ = d;
        }
        Some("post") => {
            let r = (w.min(d) / 2.0).min(8.0);
            m.cyl(metal, [0.0; 3], [r * 0.9, r * 0.9], 4.0);
            m.cyl(metal, [0.0; 3], [r * 0.35, r * 0.3], h - 28.0);
            m.cyl(metal, [0.0, h - 28.0, 0.0], [r * 0.6, r * 0.6], 2.0);
            m.cyl(glow, [0.0, h - 26.0, 0.0], [r * 0.75, r * 0.85], 18.0);
            m.lathe(
                metal,
                [0.0, h - 8.0, 0.0],
                &[[r * 1.05, 0.0], [r * 0.5, 6.0], [0.0, 8.0]],
                [1.0, 1.0],
            );
            m.bulbs.push([0.0, h - 17.0, 0.0]);
        }
        _ => {
            let (rx, rz) = (w / 2.0, d / 2.0);
            m.p.material = metal;
            let x = m.x;
            m.p.ellipse_cylinder(&x, [0.0; 3], [rx, rz], [rx, rz], h - 14.0, 16, true);
            m.p.material = glow;
            m.p.ellipse_cylinder(
                &x,
                [0.0, h - 14.0, 0.0],
                [rx * 0.92, rz * 0.92],
                [rx * 0.92, rz * 0.92],
                10.0,
                16,
                false,
            );
            m.p.material = metal;
            m.p.ellipse_cylinder(
                &x,
                [0.0, h - 4.0, 0.0],
                [rx, rz],
                [rx * 0.9, rz * 0.9],
                4.0,
                16,
                true,
            );
            m.bulbs.push([0.0, h - 9.0, 0.0]);
        }
    }
}

/// Water from its edge (`light`) to its middle (`deep`): a ring of quads from the outline to an
/// inner outline at `inset` of the way in, then the middle, at height `y`.
fn water(m: &mut Model<'_>, outline: &[[f64; 2]], y: f64, light: Rgb8, deep: Rgb8) {
    let n = outline.len();
    if n < 3 {
        return;
    }
    let centre = [
        outline.iter().map(|p| p[0]).sum::<f64>() / n as f64,
        outline.iter().map(|p| p[1]).sum::<f64>() / n as f64,
    ];
    let edge = Material::new(light, 0.05, Surface::Water);
    let middle = Material::new(deep, 0.05, Surface::Water);
    let x = m.x;
    let tag = m.p.tag;
    let up = x.dir([0.0, 1.0, 0.0]);
    let base = x.point([0.0, y, 0.0])[1];
    let mesh = &mut *m.p.mesh;
    let vertex = |mesh: &mut crate::scene::mesh::Mesh, p: [f64; 2], mat: &Material| {
        let world = x.point([p[0], y, p[1]]);
        mesh.vertex(world, base, up, [p[0], p[1]], mat, tag)
    };
    let inner: Vec<[f64; 2]> = outline
        .iter()
        .map(|p| {
            [
                centre[0] + (p[0] - centre[0]) * 0.45,
                centre[1] + (p[1] - centre[1]) * 0.45,
            ]
        })
        .collect();
    let rim: Vec<u32> = outline.iter().map(|p| vertex(mesh, *p, &edge)).collect();
    let deep_ring: Vec<u32> = inner.iter().map(|p| vertex(mesh, *p, &middle)).collect();
    let mid = vertex(mesh, centre, &middle);
    // Counter-clockwise seen from above: the outline's winding decides.
    let area: f64 = (0..n)
        .map(|i| {
            let (a, b) = (outline[i], outline[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum();
    for i in 0..n {
        let j = (i + 1) % n;
        let (a, b, c2, d2) = (rim[i], rim[j], deep_ring[j], deep_ring[i]);
        if area > 0.0 {
            mesh.triangle(a, c2, b);
            mesh.triangle(a, d2, c2);
            mesh.triangle(mid, deep_ring[j], deep_ring[i]);
        } else {
            mesh.triangle(a, b, c2);
            mesh.triangle(a, c2, d2);
            mesh.triangle(mid, deep_ring[i], deep_ring[j]);
        }
    }
}

/// The outline of an ellipse of half-sizes `rx`, `rz`, `n` points.
fn ellipse(rx: f64, rz: f64, n: usize) -> Vec<[f64; 2]> {
    (0..n)
        .map(|k| {
            #[allow(clippy::cast_precision_loss)]
            let a = k as f64 / n as f64 * TAU;
            [a.cos() * rx, a.sin() * rz]
        })
        .collect()
}

/// A pool: in the ground, its coping round water darker where it is deep (its height is its
/// depth); `round`, a round one; `above-ground`, a round tank standing on the ground with its
/// ladder.
pub(super) fn pool(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    // The deeper, the darker its middle.
    let deep = shade(c, 1.0 - 0.45 * (h / 300.0).clamp(0.0, 1.0));
    let light = shade(c, 1.12);
    let coping = Material::new(COPING, 0.8, Surface::Paving);
    match variant {
        Some("above-ground") => {
            // Room left for its ladder at the front.
            let (rx, rz) = (
                w / 2.0 - 30.0_f64.min(w * 0.1),
                d / 2.0 - 30.0_f64.min(d * 0.1),
            );
            let wall = Material::new(Rgb8::from_u32(0xd9dcd6), 0.5, Surface::Matte);
            m.p.material = wall;
            let x = m.x;
            m.p.ellipse_cylinder(&x, [0.0; 3], [rx, rz], [rx, rz], h, 24, false);
            m.p.material = Material::metal(STEEL);
            m.p.ellipse_cylinder(
                &x,
                [0.0, h - 4.0, 0.0],
                [rx + 1.5, rz + 1.5],
                [rx + 1.5, rz + 1.5],
                4.0,
                24,
                true,
            );
            water(m, &ellipse(rx - 1.0, rz - 1.0, 24), h - 10.0, light, deep);
            // The ladder over its side.
            let steel = Material::metal(CHROME);
            let foot = d / 2.0 - 2.0;
            for sx in [-1.0, 1.0] {
                m.rod(
                    steel,
                    [sx * 22.0, 0.0, foot],
                    [sx * 22.0, h + 20.0, rz + 4.0],
                    1.6,
                );
            }
            for k in 1..4 {
                let y = h * f64::from(k) / 4.0;
                let z = foot + (rz + 4.0 - foot) * y / (h + 20.0);
                m.bx(steel, [-22.0, y - 1.0, z - 4.0], [22.0, y + 1.0, z]);
            }
        }
        Some("round") => {
            let (rx, rz) = (w / 2.0, d / 2.0);
            let band = 30.0_f64.min(rx.min(rz) * 0.25);
            let x = m.x;
            m.p.material = coping;
            m.p.ellipse_cylinder(&x, [0.0, -3.0, 0.0], [rx, rz], [rx, rz], 8.0, 32, false);
            // The coping's top: a ring.
            let outer = ellipse(rx, rz, 32);
            let inner = ellipse(rx - band, rz - band, 32);
            ring(m, coping, &outer, &inner, 5.0);
            water(m, &inner, 1.5, light, deep);
        }
        _ => {
            let band = 30.0_f64.min(w.min(d) * 0.15);
            let (hx, hz) = (w / 2.0, d / 2.0);
            for (min, max) in [
                ([-hx, -3.0, -hz], [hx, 5.0, -hz + band]),
                ([-hx, -3.0, hz - band], [hx, 5.0, hz]),
                ([-hx, -3.0, -hz + band], [-hx + band, 5.0, hz - band]),
                ([hx - band, -3.0, -hz + band], [hx, 5.0, hz - band]),
            ] {
                m.bx(coping, min, max);
            }
            let (ix, iz) = (hx - band, hz - band);
            water(
                m,
                &[[-ix, -iz], [ix, -iz], [ix, iz], [-ix, iz]],
                1.5,
                light,
                deep,
            );
            // Steps into the shallow end, under the water.
            let step = Material::new(shade(c, 1.2), 0.3, Surface::Water);
            m.bx(
                step,
                [-ix, 1.0, -iz],
                [-ix + 40.0_f64.min(ix), 1.6, -iz + 60.0_f64.min(iz)],
            );
        }
    }
}

/// A flat ring at height `y` between two outlines of as many points.
fn ring(m: &mut Model<'_>, mat: Material, outer: &[[f64; 2]], inner: &[[f64; 2]], y: f64) {
    let x = m.x;
    m.p.material = mat;
    let n = outer.len().min(inner.len());
    for i in 0..n {
        let j = (i + 1) % n;
        let q = [
            x.point([outer[i][0], y, outer[i][1]]),
            x.point([outer[j][0], y, outer[j][1]]),
            x.point([inner[j][0], y, inner[j][1]]),
            x.point([inner[i][0], y, inner[i][1]]),
        ];
        m.p.quad(
            q,
            [outer[i], outer[j], inner[j], inner[i]],
            Some(x.dir([0.0, 1.0, 0.0])),
            y - 8.0,
        );
    }
}

/// A hot tub: a wooden shell, its rim, the water in it and its headrests.
pub(super) fn hot_tub(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.soft(
        Material::wood(c),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h - 4.0, d / 2.0],
        3.0,
    );
    let rim = Material::new(Rgb8::from_u32(0x3a3c3e), 0.4, Surface::Matte);
    m.soft(
        rim,
        [-w / 2.0, h - 6.0, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        2.0,
    );
    let inset = (w.min(d) * 0.1).min(18.0);
    let (ix, iz) = (w / 2.0 - inset, d / 2.0 - inset);
    let blue = Rgb8::from_u32(0x5fc0d8);
    water(
        m,
        &[[-ix, -iz], [ix, -iz], [ix, iz], [-ix, iz]],
        h + 0.2,
        shade(blue, 1.1),
        shade(blue, 0.8),
    );
    for sx in [-1.0, 1.0] {
        m.soft(
            rim,
            [sx * ix - 12.0, h, -iz],
            [sx * ix + 12.0, h + 4.0, -iz + 8.0],
            1.5,
        );
    }
}

/// A robot mower's dock: a base plate it drives onto and the charging station at its back; the
/// mower itself is drawn moving (D-077).
pub(super) fn robot_mower(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    m.soft(
        Material::satin(shade(c, 0.8)),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, 1.5, d / 2.0],
        0.5,
    );
    let station = (d * 0.3).clamp(8.0, 25.0);
    m.soft(
        body,
        [-w * 0.35, 0.0, -d / 2.0],
        [w * 0.35, h, -d / 2.0 + station],
        3.0,
    );
    m.bx(
        Material::new(Rgb8::from_u32(0x6fd36f), 0.2, Surface::Screen),
        [-2.0, h * 0.7, -d / 2.0 + station],
        [2.0, h * 0.7 + 1.5, -d / 2.0 + station + 0.4],
    );
    for sx in [-1.0, 1.0] {
        m.bx(
            Material::metal(CHROME),
            [sx * 8.0 - 2.0, 1.5, -d / 2.0 + station],
            [sx * 8.0 + 2.0, 3.0, -d / 2.0 + station + 6.0],
        );
    }
}

/// A gable roof over a box `w` × `d` from height `eaves` up `rise`, its ridge along x, standing
/// out `over` all round.
fn gable(m: &mut Model<'_>, mat: Material, w: f64, d: f64, eaves: f64, rise: f64, over: f64) {
    let (hx, hz) = (w / 2.0 + over, d / 2.0 + over);
    let low = eaves - over * rise / (d / 2.0);
    for sz in [-1.0, 1.0] {
        let slope = [
            [sz * hz, low],
            [sz * hz, low + 4.0],
            [0.0, eaves + rise + 4.0],
            [0.0, eaves + rise],
        ];
        m.side_slab(mat, &slope, -hx, hx);
    }
}

/// A garden shed: walls of boards, a door, a window, a roof; `metal`, of ribbed sheet.
pub(super) fn shed(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = variant == Some("metal");
    // The roof stands out of the walls, within the piece.
    let over = 10.0_f64.min(w.min(d) * 0.08);
    let (w, d) = (w - 2.0 * over, d - 2.0 * over);
    let rise = (d / 2.0 * 0.45).min(h * 0.35);
    let eaves = h - rise;
    let walls = if metal {
        Material::new(c, 0.45, Surface::Metal)
    } else {
        Material::wood(c)
    };
    m.bx(walls, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, eaves, d / 2.0]);
    // Boards or ribs on its front.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let n = ((w / 14.0).round() as usize).clamp(4, 60);
    #[allow(clippy::cast_precision_loss)]
    for k in 0..n {
        let x0 = -w / 2.0 + w * k as f64 / n as f64;
        m.bx(
            if metal {
                Material::new(shade(c, 1.1), 0.4, Surface::Metal)
            } else {
                Material::wood(shade(c, 0.85))
            },
            [x0, 0.0, d / 2.0],
            [x0 + 1.0, eaves, d / 2.0 + 0.6],
        );
    }
    // The gables at its sides.
    m.side_slab(
        walls,
        &[[-d / 2.0, eaves], [d / 2.0, eaves], [0.0, h - 2.0]],
        -w / 2.0,
        w / 2.0,
    );
    let roof = Material::new(
        if metal {
            shade(c, 0.8)
        } else {
            Rgb8::from_u32(0x4a4d50)
        },
        0.8,
        Surface::Matte,
    );
    gable(m, roof, w, d, eaves, rise, over);
    // A door on its front, its handle, and a window beside it.
    let door_w = (w * 0.35).min(90.0);
    m.bx(
        Material::wood(shade(c, 0.7)),
        [-door_w / 2.0, 0.0, d / 2.0 + 0.6],
        [door_w / 2.0, eaves * 0.88, d / 2.0 + 2.0],
    );
    m.blk(
        Material::metal(DARK),
        [door_w / 2.0 - 8.0, eaves * 0.45, d / 2.0 + 2.0],
        [2.0, 10.0, 2.0],
    );
    if w > door_w + 80.0 {
        let x0 = door_w / 2.0 + 20.0;
        m.bx(
            Material::glass(),
            [x0, eaves * 0.5, d / 2.0 + 0.6],
            [(x0 + 50.0).min(w / 2.0 - 10.0), eaves * 0.8, d / 2.0 + 1.2],
        );
    }
}

/// A pergola: four posts, beams and rafters over them; `bioclimatic`, a roof of louvres.
pub(super) fn pergola(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let louvres = variant == Some("bioclimatic");
    let wood = if louvres {
        Material::new(c, 0.45, Surface::Metal)
    } else {
        Material::wood(c)
    };
    let post = if louvres { 14.0 } else { 12.0 };
    let beam = if louvres { 20.0 } else { 18.0 };
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.blk(
                wood,
                [
                    sx * (w / 2.0 - post / 2.0),
                    0.0,
                    sz * (d / 2.0 - post / 2.0),
                ],
                [post, h - beam, post],
            );
        }
    }
    m.bx(
        wood,
        [-w / 2.0, h - beam, -d / 2.0],
        [w / 2.0, h, -d / 2.0 + post],
    );
    m.bx(
        wood,
        [-w / 2.0, h - beam, d / 2.0 - post],
        [w / 2.0, h, d / 2.0],
    );
    m.bx(
        wood,
        [-w / 2.0, h - beam, -d / 2.0],
        [-w / 2.0 + post, h, d / 2.0],
    );
    m.bx(
        wood,
        [w / 2.0 - post, h - beam, -d / 2.0],
        [w / 2.0, h, d / 2.0],
    );
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let n = ((w / if louvres { 18.0 } else { 45.0 }).round() as usize).clamp(2, 60);
    #[allow(clippy::cast_precision_loss)]
    for k in 1..n {
        let x0 = -w / 2.0 + w * k as f64 / n as f64;
        if louvres {
            // Blades tilted open.
            let tilt = Xform {
                axes: [[0.8, 0.6, 0.0], [-0.6, 0.8, 0.0], [0.0, 0.0, 1.0]],
                origin: [x0, h - beam * 0.4, 0.0],
            };
            let frame = m.x.then(&tilt);
            m.bx_in(
                wood,
                &frame,
                [-8.0, -1.0, -d / 2.0 + post],
                [8.0, 1.0, d / 2.0 - post],
            );
        } else {
            m.bx(wood, [x0 - 2.5, h - 12.0, -d / 2.0], [x0 + 2.5, h, d / 2.0]);
        }
    }
}

/// A greenhouse: glass walls and roof in a thin frame, benches of plants inside.
pub(super) fn greenhouse(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let rise = (d / 2.0 * 0.5).min(h * 0.3);
    let eaves = h - rise;
    let frame = Material::metal(c);
    let glass = Material::glass();
    m.bx(
        Material::new(STONE, 0.9, Surface::Matte),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, 20.0, d / 2.0],
    );
    for (min, max) in [
        ([-w / 2.0, 20.0, -d / 2.0], [w / 2.0, eaves, -d / 2.0 + 0.5]),
        ([-w / 2.0, 20.0, d / 2.0 - 0.5], [w / 2.0, eaves, d / 2.0]),
        ([-w / 2.0, 20.0, -d / 2.0], [-w / 2.0 + 0.5, eaves, d / 2.0]),
        ([w / 2.0 - 0.5, 20.0, -d / 2.0], [w / 2.0, eaves, d / 2.0]),
    ] {
        m.bx(glass, min, max);
    }
    // The roof's two slopes and the gables, all glass.
    for sz in [-1.0, 1.0] {
        let z = sz * d / 2.0;
        m.side_slab(
            glass,
            &[[z, eaves], [z, eaves + 0.6], [0.0, h], [0.0, h - 0.6]],
            -w / 2.0,
            w / 2.0,
        );
    }
    for x0 in [-w / 2.0, w / 2.0 - 0.5] {
        m.side_slab(
            glass,
            &[[-d / 2.0, eaves], [d / 2.0, eaves], [0.0, h]],
            x0,
            x0 + 0.5,
        );
    }
    // The frame: corners, ridge, eaves, and an upright every 60 cm.
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.blk(
                frame,
                [sx * (w / 2.0 - 1.5), 20.0, sz * (d / 2.0 - 1.5)],
                [3.0, eaves - 20.0, 3.0],
            );
        }
    }
    m.bx(frame, [-w / 2.0, h - 3.0, -1.5], [w / 2.0, h, 1.5]);
    for sz in [-1.0, 1.0] {
        m.bx(
            frame,
            [-w / 2.0, eaves - 3.0, sz * d / 2.0 - 1.5],
            [w / 2.0, eaves, sz * d / 2.0 + 1.5],
        );
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let n = ((w / 60.0).round() as usize).max(1);
    #[allow(clippy::cast_precision_loss)]
    for k in 1..n {
        let x0 = -w / 2.0 + w * k as f64 / n as f64;
        for sz in [-1.0, 1.0] {
            m.blk(
                frame,
                [x0, 20.0, sz * (d / 2.0 - 1.0)],
                [2.0, eaves - 20.0, 2.0],
            );
            m.rod(frame, [x0, eaves, sz * d / 2.0], [x0, h, 0.0], 1.0);
        }
    }
    // A bench of plants along each side.
    for sz in [-1.0, 1.0] {
        let z = sz * (d / 2.0 - 25.0);
        m.bx(
            Material::wood(TEAK),
            [-w / 2.0 + 10.0, 75.0, z - 18.0],
            [w / 2.0 - 10.0, 79.0, z + 18.0],
        );
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let plants = ((w - 20.0) / 45.0).floor().clamp(1.0, 12.0) as usize;
        let x = m.x;
        #[allow(clippy::cast_precision_loss)]
        for k in 0..plants {
            let x0 = -w / 2.0 + 10.0 + (w - 20.0) * (k as f64 + 0.5) / plants as f64;
            m.p.material = Material::ceramic(Rgb8::from_u32(0xb5603c));
            m.p.cylinder(&x, [x0, 79.0, z], [6.0, 7.0], 10.0, 8, true);
            foliage(
                m,
                Rgb8::from_u32(0x5f8a44),
                [x0, 96.0, z],
                [10.0, 9.0, 10.0],
            );
        }
    }
}

/// A trampoline: its mat in a frame on legs, the pad round it, the net on its poles.
pub(super) fn trampoline(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let (rx, rz) = (w / 2.0, d / 2.0);
    let deck = 85.0_f64.min(h * 0.4);
    let steel = Material::metal(STEEL);
    let x = m.x;
    m.p.material = Material::new(c, 0.9, Surface::Fabric);
    m.p.ellipse_cylinder(
        &x,
        [0.0, deck - 1.0, 0.0],
        [rx * 0.86, rz * 0.86],
        [rx * 0.86, rz * 0.86],
        1.0,
        32,
        true,
    );
    // The pad over the springs.
    m.p.material = Material::fabric(Rgb8::from_u32(0x2f6db5));
    let outer = ellipse(rx, rz, 32);
    let inner = ellipse(rx * 0.86, rz * 0.86, 32);
    ring(
        m,
        Material::fabric(Rgb8::from_u32(0x2f6db5)),
        &outer,
        &inner,
        deck + 1.0,
    );
    m.p.material = steel;
    m.p.ellipse_cylinder(
        &x,
        [0.0, deck - 3.0, 0.0],
        [rx, rz],
        [rx, rz],
        3.0,
        32,
        false,
    );
    // Six legs, six poles for the net, rings of it.
    for k in 0..6 {
        let a = f64::from(k) / 6.0 * TAU;
        let (s, co) = a.sin_cos();
        let foot = [co * rx * 0.98, 0.0, s * rz * 0.98];
        m.rod(steel, foot, [co * rx, deck, s * rz], 2.0);
        m.rod(
            Material::paint(DARK),
            [co * rx, deck, s * rz],
            [co * rx * 0.97, h, s * rz * 0.97],
            1.6,
        );
    }
    let net = Material::paint(DARK);
    for k in 1..4 {
        let y = deck + (h - deck) * f64::from(k) / 3.0;
        let points: Vec<V3> = (0..=24)
            .map(|j| {
                let a = f64::from(j) / 24.0 * TAU;
                [a.cos() * rx * 0.97, y, a.sin() * rz * 0.97]
            })
            .collect();
        m.pipe(net, &points, 0.5);
    }
}

/// A swing set: an A-frame each end, a beam, two swings on their ropes.
pub(super) fn swing(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let wood = Material::wood(c);
    let post = 9.0_f64.min(w * 0.05);
    for sx in [-1.0, 1.0] {
        let x0 = sx * (w / 2.0 - post);
        for sz in [-1.0, 1.0] {
            m.rod(
                wood,
                [x0, 0.0, sz * (d / 2.0 - post)],
                [x0, h - post, 0.0],
                post / 2.0,
            );
        }
    }
    m.bx(
        wood,
        [-w / 2.0, h - post, -post / 2.0],
        [w / 2.0, h, post / 2.0],
    );
    let rope = Material::fabric(Rgb8::from_u32(0xc9b38a));
    let seat_y = 45.0_f64.min(h * 0.25);
    for k in 0..2 {
        let x0 = -w / 4.0 + w / 2.0 * f64::from(k);
        for sx in [-1.0, 1.0] {
            m.rod(
                rope,
                [x0 + sx * 20.0, h - post, 0.0],
                [x0 + sx * 20.0, seat_y, 0.0],
                0.8,
            );
        }
        m.bx(
            Material::paint(Rgb8::from_u32(if k == 0 { 0xc8352a } else { 0x2f6db5 })),
            [x0 - 23.0, seat_y - 2.0, -8.0],
            [x0 + 23.0, seat_y, 8.0],
        );
    }
}

/// A fence: a panel of boards between posts; `picket`, pickets with pointed tops; `metal`, rods.
pub(super) fn fence(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = variant == Some("metal");
    let mat = if metal {
        Material::new(c, 0.45, Surface::Metal)
    } else {
        surface(c)
    };
    // Posts at its ends and every two metres.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let spans = ((w / 200.0).ceil() as usize).max(1);
    let post = if metal { 5.0 } else { 9.0 };
    #[allow(clippy::cast_precision_loss)]
    for k in 0..=spans {
        let x0 = (-w / 2.0 + post / 2.0) + (w - post) * k as f64 / spans as f64;
        m.blk(mat, [x0, 0.0, 0.0], [post, h, d.max(post)]);
    }
    match variant {
        Some("picket") => {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let n = ((w / 12.0).round() as usize).clamp(2, 400);
            #[allow(clippy::cast_precision_loss)]
            for k in 0..n {
                let x0 = -w / 2.0 + w * (k as f64 + 0.5) / n as f64;
                m.side_slab(
                    mat,
                    &[
                        [d / 2.0, 6.0],
                        [d / 2.0, h - 8.0],
                        [0.0, h],
                        [-d / 2.0, h - 8.0],
                        [-d / 2.0, 6.0],
                    ],
                    x0 - 4.0,
                    x0 + 4.0,
                );
            }
            for y in [h * 0.25, h * 0.7] {
                m.bx(
                    mat,
                    [-w / 2.0, y, -d / 2.0 - 2.0],
                    [w / 2.0, y + 6.0, -d / 2.0],
                );
            }
        }
        Some("metal") => {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let n = ((w / 11.0).round() as usize).clamp(2, 400);
            #[allow(clippy::cast_precision_loss)]
            for k in 0..n {
                let x0 = -w / 2.0 + w * (k as f64 + 0.5) / n as f64;
                m.blk(mat, [x0, 4.0, 0.0], [1.6, h - 6.0, 1.6]);
            }
            for y in [8.0, h - 6.0] {
                m.bx(mat, [-w / 2.0, y, -1.5], [w / 2.0, y + 3.0, 1.5]);
            }
        }
        _ => {
            // Boards side by side, a little apart.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let n = ((w / 15.0).round() as usize).clamp(2, 400);
            #[allow(clippy::cast_precision_loss)]
            for k in 0..n {
                let x0 = -w / 2.0 + w * k as f64 / n as f64;
                let tone = surface(shade(c, 0.92 + 0.14 * m.rng.next()));
                m.bx(
                    tone,
                    [x0 + 0.4, 4.0, -d / 2.0],
                    [x0 + w / n as f64 - 0.4, h - 2.0, d / 2.0],
                );
            }
        }
    }
}

/// A gate: two leaves of bars hung on posts, opening as its cover or contact says; `sliding`,
/// one leaf sliding along its rail.
pub(super) fn gate(m: &mut Model<'_>, variant: Option<&str>, open: f64) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::new(c, 0.45, Surface::Metal);
    // Its posts at its ends, the leaves between them.
    let post = 12.0_f64.min(w * 0.1);
    for sx in [-1.0, 1.0] {
        m.blk(metal, [sx * (w / 2.0 - post / 2.0), 0.0, 0.0], [post, h, d]);
    }
    let w = w - 2.0 * post;
    let leaf = |m: &mut Model<'_>, frame: &Xform, width: f64| {
        m.bx_in(metal, frame, [0.0, 6.0, -d / 2.0], [width, 10.0, d / 2.0]);
        m.bx_in(metal, frame, [0.0, h - 6.0, -d / 2.0], [width, h, d / 2.0]);
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let n = ((width / 12.0).round() as usize).clamp(2, 100);
        #[allow(clippy::cast_precision_loss)]
        for k in 0..=n {
            let x0 = width * k as f64 / n as f64;
            m.bx_in(
                metal,
                frame,
                [(x0 - 1.0).max(0.0), 6.0, -1.0],
                [(x0 + 1.0).min(width), h, 1.0],
            );
        }
    };
    let open = open.clamp(0.0, 1.0);
    if variant == Some("sliding") {
        // The rail on the ground, the leaf slid behind the left post as it opens.
        m.bx(
            Material::metal(STEEL),
            [-w * 1.5, 0.0, -2.0],
            [w / 2.0, 2.0, 2.0],
        );
        let frame = m.x.translated([-w / 2.0 - w * open, 0.0, 0.0]);
        leaf(m, &frame, w);
        return;
    }
    // Two leaves swinging inwards (towards −z).
    let half = w / 2.0;
    let angle = open * FRAC_PI_2 * 0.95;
    let left = m.x.translated([-half, 0.0, 0.0]).turned_y(angle);
    leaf(m, &left, half - 1.0);
    let right = m.x.translated([half, 0.0, 0.0]).turned_y(PI - angle);
    leaf(m, &right, half - 1.0);
}

/// A letter box on its post: a box with a rounded top, its flap and its flag.
pub(super) fn mailbox(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::new(c, 0.4, Surface::Metal);
    let box_h = (h * 0.28).min(35.0);
    m.blk(Material::wood(BARK), [0.0, 0.0, 0.0], [8.0, h - box_h, 8.0]);
    m.soft(
        body,
        [-w / 2.0, h - box_h, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        w.min(d) * 0.15,
    );
    m.bx(
        Material::metal(shade(c, 1.3)),
        [-w / 2.0 + 3.0, h - box_h * 0.55, d / 2.0],
        [w / 2.0 - 3.0, h - box_h * 0.35, d / 2.0 + 0.5],
    );
    m.bx(
        Material::paint(Rgb8::from_u32(0xc8352a)),
        [w / 2.0, h - box_h * 0.6, -2.0],
        [w / 2.0 + 1.0, h - 2.0, 2.0],
    );
}

/// Whether a piece of the kind stands without the soft shadow under it: the pool and what spreads
/// above the ground (a tree's crown, a parasol, a pergola), a fence, a gate, lights on a wire.
pub(super) fn no_contact_shadow(kind: crate::plan::Kind, variant: Option<&str>) -> bool {
    use crate::plan::Kind;
    matches!(
        kind,
        Kind::Pool | Kind::Tree | Kind::Parasol | Kind::Pergola | Kind::Fence | Kind::Gate
    ) || (kind == Kind::GardenLight && variant == Some("string"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_point_on_an_ellipsoid_is_on_it() {
        for (a, b) in [(0.0, 0.0), (0.3, 0.5), (0.9, 1.0)] {
            let p = on_ellipsoid([1.0, 2.0, 3.0], [10.0, 20.0, 30.0], a, b);
            let q = [
                (p[0] - 1.0) / 10.0,
                (p[1] - 2.0) / 20.0,
                (p[2] - 3.0) / 30.0,
            ];
            assert!((q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - 1.0).abs() < 1e-9);
        }
        assert!(frond(0.0).abs() < 1e-9 && frond(0.5) > 0.5);
    }
}
