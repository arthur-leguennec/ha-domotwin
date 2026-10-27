//! The library's lights (D-074): wall lights, light strips and track lights, and other styles of
//! pendants, floor lamps and ceiling lights.

use std::f64::consts::{FRAC_PI_2, TAU};

use super::{DARK, GOLD, Material, Model, Rgb8, STEEL, V3, Xform, shade};

/// The look of a lamp's shade when it is off: the light itself comes from the lamp's state.
const OPAL: Rgb8 = Rgb8::from_u32(0xf4f1e8);

/// A wall light: its plate on the wall, an arm, a shade open upwards round its bulb; `swing-arm`,
/// a reading light on a jointed arm, its shade looking down.
pub(super) fn wall_light(m: &mut Model<'_>, swing: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::metal(if swing { c } else { Rgb8::from_u32(0xc7a25a) });
    let back = -d / 2.0;
    if swing {
        let plate = h * 0.35;
        let face = m.x.translated([0.0, plate, back]).turned_x(FRAC_PI_2);
        m.p.material = metal;
        m.p.cylinder(&face, [0.0; 3], [3.5, 3.5], 1.5, 12, true);
        let elbow = [0.0, plate + 3.0, back + d * 0.5];
        let tip = [0.0, h - 4.0, d / 2.0 - w / 2.0];
        m.pipe(
            metal,
            &[[0.0, plate, back + 1.5], [0.0, plate, back + 4.0], elbow],
            0.6,
        );
        m.pipe(metal, &[elbow, [0.0, h - 2.0, tip[2] - 3.0], tip], 0.6);
        let r = w / 2.0 - 0.5;
        m.lathe(
            metal,
            [tip[0], tip[1] - h * 0.4, tip[2]],
            &[
                [r, 0.0],
                [r * 0.85, h * 0.2],
                [r * 0.4, h * 0.38],
                [0.0, h * 0.4],
            ],
            [1.0, 1.0],
        );
        let glow = m.glow(OPAL);
        m.cyl(
            glow,
            [tip[0], tip[1] - h * 0.4 + 0.3, tip[2]],
            [r * 0.8, r * 0.8],
            0.2,
        );
        m.bulbs.push([tip[0], tip[1] - h * 0.3, tip[2]]);
        return;
    }
    let face = m.x.translated([0.0, h * 0.3, back]).turned_x(FRAC_PI_2);
    m.p.material = metal;
    m.p.cylinder(&face, [0.0; 3], [3.2, 3.2], 1.2, 12, true);
    let cup = [0.0, h * 0.42, back + d * 0.55];
    m.pipe(
        metal,
        &[
            [0.0, h * 0.3, back + 1.2],
            [0.0, h * 0.28, back + d * 0.3],
            [0.0, h * 0.32, back + d * 0.5],
            cup,
        ],
        0.7,
    );
    let r = (w / 2.0).min(d * 0.5) - 0.5;
    let glow = m.glow(OPAL);
    m.p.material = glow;
    m.p.cylinder(
        &m.x,
        [cup[0], cup[1], cup[2]],
        [r * 0.45, r],
        h - cup[1],
        16,
        false,
    );
    m.cyl(
        metal,
        [cup[0], cup[1] - 1.0, cup[2]],
        [r * 0.45, r * 0.45],
        1.2,
    );
    m.bulbs.push([cup[0], cup[1] + (h - cup[1]) * 0.4, cup[2]]);
}

/// A light strip: an aluminium channel with its diffuser lit along it, under a cabinet or behind
/// a screen.
pub(super) fn light_strip(m: &mut Model<'_>) {
    let (w, d, h) = (m.w, m.d, m.h.max(0.6));
    m.bx(
        Material::metal(Rgb8::from_u32(0xb5b8b8)),
        [-w / 2.0, h * 0.3, -d / 2.0],
        [w / 2.0, h, d / 2.0],
    );
    let glow = m.glow(OPAL);
    m.bx(
        glow,
        [-w / 2.0 + 0.2, 0.0, -d / 2.0 + d * 0.15],
        [w / 2.0 - 0.2, h * 0.3, d / 2.0 - d * 0.15],
    );
    let count = (w / 120.0).ceil().clamp(1.0, 3.0);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    for k in 0..count as usize {
        #[allow(clippy::cast_precision_loss)]
        let x = -w / 2.0 + w * (k as f64 + 0.5) / count;
        m.bulbs.push([x, -2.0, 0.0]);
    }
}

/// A track light: its rail on the ceiling and three spots on it, each turned towards the front.
pub(super) fn track_light(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::metal(c);
    m.bx(metal, [-w / 2.0, h - 3.0, -d / 2.0], [w / 2.0, h, d / 2.0]);
    if m.ceiling > 0.5 {
        for sx in [-1.0, 1.0] {
            m.cyl(metal, [sx * w * 0.35, h, 0.0], [0.6, 0.6], m.ceiling);
        }
    }
    let spots = if w > 80.0 { 3 } else { 2 };
    for k in 0..spots {
        #[allow(clippy::cast_precision_loss)]
        let x = -w / 2.0 + w * (f64::from(k) + 0.5) / f64::from(spots);
        m.bx(metal, [x - 1.5, h - 5.0, -1.5], [x + 1.5, h - 3.0, 1.5]);
        let turn = (f64::from(k) - 1.0) * 0.4;
        // The spot's frame in the model's, and in the world's.
        let aim = Xform::IDENTITY
            .translated([x, h - 6.0, 0.0])
            .turned_y(turn)
            .turned_x(-0.65);
        let head = m.x.then(&aim);
        let r = (d * 0.6).clamp(2.5, 4.5);
        m.p.material = metal;
        m.p.cylinder(
            &head,
            [0.0, -h * 0.55, 0.0],
            [r, r * 0.9],
            h * 0.55,
            12,
            true,
        );
        let glow = m.glow(OPAL);
        m.p.material = glow;
        m.p.cylinder(
            &head,
            [0.0, -h * 0.55 - 0.2, 0.0],
            [r * 0.7, r * 0.7],
            0.3,
            12,
            true,
        );
        m.bulbs.push(aim.point([0.0, -h * 0.6, 0.0]));
    }
}

/// A pendant's cord to the ceiling and its canopy, from `top`.
fn cord(m: &mut Model<'_>, top: f64) {
    if m.ceiling > 0.5 {
        m.rod(
            Material::metal(DARK),
            [0.0, top, 0.0],
            [0.0, top + m.ceiling, 0.0],
            0.35,
        );
        m.cyl(
            Material::metal(shade(m.c, 0.9)),
            [0.0, top + m.ceiling - 2.0, 0.0],
            [5.0, 5.0],
            2.0,
        );
    }
}

/// A pendant: `globe`, an opal glass globe; `dome`, a metal dome looking down.
pub(super) fn pendant(m: &mut Model<'_>, dome: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let r = w.min(d) / 2.0;
    if dome {
        cord(m, h);
        let metal = Material::metal(c);
        m.lathe(
            metal,
            [0.0; 3],
            &[
                [r, 0.0],
                [r * 0.96, h * 0.25],
                [r * 0.75, h * 0.6],
                [r * 0.25, h * 0.85],
                [r * 0.12, h * 0.9],
                [r * 0.12, h],
                [0.0, h],
            ],
            [1.0, 1.0],
        );
        let glow = m.glow(OPAL);
        m.lathe(
            glow,
            [0.0; 3],
            &[
                [r * 0.93, 0.2],
                [r * 0.7, h * 0.55],
                [r * 0.2, h * 0.8],
                [0.0, h * 0.82],
            ],
            [1.0, 1.0],
        );
        m.bulbs.push([0.0, h * 0.35, 0.0]);
        return;
    }
    cord(m, h);
    m.cyl(Material::metal(GOLD), [0.0, h - 3.0, 0.0], [2.5, 2.5], 3.0);
    let glow = m.glow(OPAL);
    m.sph(glow, [0.0, (h - 3.0) / 2.0, 0.0], [r, (h - 3.0) / 2.0, r]);
    m.bulbs.push([0.0, (h - 3.0) / 2.0, 0.0]);
}

/// A floor lamp: `arc`, its weight at the back and its arc reaching over the front to a shade
/// looking down; `tripod`, a drum shade on three wooden legs.
pub(super) fn floor_lamp(m: &mut Model<'_>, arc: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    if arc {
        let base = Material::new(Rgb8::from_u32(0xe8e6e1), 0.25, super::Surface::Matte);
        let bz = -d / 2.0 + w / 2.0;
        m.soft(
            base,
            [-w / 2.0 + 2.0, 0.0, bz - w / 2.0 + 2.0],
            [w / 2.0 - 2.0, 6.0, bz + w / 2.0 - 2.0],
            1.0,
        );
        let steel = Material::metal(Rgb8::from_u32(0xc9cccc));
        let r = (w / 2.0 - 1.0).min(18.0);
        let tip_z = d / 2.0 - r;
        let reach = tip_z - bz;
        // Up from the weight, bending over to the front: a quarter of an ellipse, then down into
        // the shade.
        let top = h - 3.0;
        let mut path: Vec<V3> = (0..=12)
            .map(|k| {
                let a = f64::from(k) / 12.0 * FRAC_PI_2;
                [
                    0.0,
                    6.0 + (top - 6.0) * a.sin(),
                    bz + reach * (1.0 - a.cos()),
                ]
            })
            .collect();
        path.push([0.0, top - 3.0, tip_z + 0.5]);
        m.pipe(steel, &path, 0.9);
        let shade_y = top - 19.0;
        let metal = Material::metal(c);
        m.lathe(
            metal,
            [0.0, shade_y, tip_z],
            &[
                [r, 0.0],
                [r * 0.9, 6.0],
                [r * 0.5, 13.0],
                [r * 0.15, 16.0],
                [0.0, 16.5],
            ],
            [1.0, 1.0],
        );
        let glow = m.glow(OPAL);
        m.cyl(glow, [0.0, shade_y + 0.3, tip_z], [r * 0.85, r * 0.85], 0.2);
        m.bulbs.push([0.0, shade_y + 5.0, tip_z]);
        return;
    }
    let wood = Material::wood(Rgb8::from_u32(0x8a6a4a));
    let hub = h - 40.0;
    let r = w.min(d) / 2.0;
    for k in 0..3 {
        let a = f64::from(k) * TAU / 3.0 + 0.3;
        let (s, co) = a.sin_cos();
        m.rod(
            wood,
            [co * (r - 2.0), 0.0, s * (r - 2.0)],
            [co * 1.5, hub + 6.0, s * 1.5],
            1.2,
        );
    }
    m.rod(
        Material::metal(STEEL),
        [0.0, hub, 0.0],
        [0.0, hub + 14.0, 0.0],
        0.5,
    );
    let glow = m.glow(c);
    let sr = (r * 0.75).min(24.0);
    m.p.material = glow;
    m.p.cylinder(&m.x, [0.0, h - 30.0, 0.0], [sr, sr], 30.0, 20, true);
    m.bulbs.push([0.0, h - 15.0, 0.0]);
}

/// A flat light panel on the ceiling: its frame, its diffuser lit underneath.
pub(super) fn ceiling_panel(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.bx(
        Material::satin(c),
        [-w / 2.0, 0.5, -d / 2.0],
        [w / 2.0, h, d / 2.0],
    );
    let glow = m.glow(OPAL);
    m.bx(
        glow,
        [-w / 2.0 + 2.0, 0.0, -d / 2.0 + 2.0],
        [w / 2.0 - 2.0, 0.6, d / 2.0 - 2.0],
    );
    m.bulbs.push([0.0, -2.0, 0.0]);
}
