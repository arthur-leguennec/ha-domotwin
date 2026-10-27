//! The library's devices (D-072): what heats, cools, cleans the air and keeps the water hot, what
//! charges the car and holds the breakers, and the small devices of a smart home (a router, an
//! access point, a thermostat, detectors, cameras, a tablet on the wall, sensors).

use std::f64::consts::{FRAC_PI_2, TAU};

use super::{CHROME, DARK, Material, Model, Rgb8, STEEL, Surface, V3, shade};

/// A status light: a small spot of colour that stays as it is.
fn led(m: &mut Model<'_>, at: V3, color: u32) {
    m.sph(
        Material::new(Rgb8::from_u32(color), 0.2, Surface::Matte),
        at,
        [0.35, 0.35, 0.2],
    );
}

/// A small dark screen.
fn display(m: &mut Model<'_>, min: V3, max: V3) {
    m.bx(
        Material::new(Rgb8::from_u32(0x101214), 0.12, Surface::Screen),
        min,
        max,
    );
}

/// Copper.
const COPPER: Rgb8 = Rgb8::from_u32(0xb87333);

/// A hot water tank: a white cylinder domed on top on its base, its pipes, the cover of its
/// thermostat and its relief valve.
pub(super) fn water_heater(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let enamel = Material::satin(c);
    let base = 4.0_f64.min(h * 0.05);
    m.cyl(
        Material::paint(shade(c, 0.6)),
        [0.0; 3],
        [w * 0.4, d * 0.4],
        base,
    );
    let dome = (w * 0.12).min(h * 0.1);
    let tank = h - base - dome - 6.0;
    m.lathe(
        enamel,
        [0.0, base, 0.0],
        &[
            [0.0, 0.0],
            [0.97, 0.0],
            [1.0, 2.0],
            [1.0, tank],
            [0.85, tank + dome * 0.7],
            [0.5, tank + dome],
            [0.0, tank + dome],
        ],
        [w / 2.0, d / 2.0],
    );
    let top = base + tank + dome;
    let copper = Material::metal(COPPER);
    for sx in [-1.0, 1.0] {
        m.cyl(
            copper,
            [sx * w * 0.2, top - 2.0, 0.0],
            [1.3, 1.3],
            h - top + 2.0,
        );
        m.cyl(
            Material::metal(STEEL),
            [sx * w * 0.2, top - 1.0, 0.0],
            [2.2, 2.2],
            2.0,
        );
    }
    m.bx(
        Material::satin(shade(c, 0.85)),
        [-6.0, tank * 0.25, d / 2.0 - 1.0],
        [6.0, tank * 0.25 + 14.0, d / 2.0 + 0.6],
    );
    m.rod(
        Material::metal(CHROME),
        [w / 2.0 - 0.5, base + tank * 0.85, 0.0],
        [w / 2.0 + 0.0, base + tank * 0.85, 0.0],
        1.0,
    );
}

/// A boiler hung on the wall: its casing, a display and buttons, its pipes under it, its flue into
/// the wall.
pub(super) fn boiler(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let pipes = (h * 0.14).min(12.0);
    m.soft(
        Material::satin(c),
        [-w / 2.0, pipes, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        2.0,
    );
    let panel = pipes + (h - pipes) * 0.12;
    m.bx(
        Material::satin(shade(c, 0.88)),
        [-w / 2.0 + 3.0, pipes + 2.0, d / 2.0 - 0.2],
        [w / 2.0 - 3.0, panel + 8.0, d / 2.0 + 0.3],
    );
    display(
        m,
        [-5.0, panel + 2.0, d / 2.0 + 0.3],
        [5.0, panel + 6.0, d / 2.0 + 0.45],
    );
    for k in [-1.0, 1.0] {
        m.cyl(
            Material::paint(DARK),
            [k * 10.0, panel + 3.5, d / 2.0 + 0.3],
            [1.2, 1.2],
            0.4,
        );
    }
    let copper = Material::metal(COPPER);
    for k in 0..5 {
        let x = (f64::from(k) - 2.0) * w * 0.15;
        m.cyl(copper, [x, 0.0, -d * 0.1], [1.1, 1.1], pipes + 1.0);
        m.cyl(
            Material::metal(STEEL),
            [x, pipes * 0.5, -d * 0.1],
            [1.6, 1.6],
            1.5,
        );
    }
    m.cyl(
        Material::satin(shade(c, 0.95)),
        [0.0, h, -d * 0.1],
        [5.0, 5.0],
        4.0,
    );
}

/// A forced-air furnace: its cabinet, the louvres of its two panels, a sight light, and the duct
/// on top up to the ceiling.
pub(super) fn furnace(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::new(c, 0.4, Surface::Metal);
    m.bx(
        metal,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h, d / 2.0 - 1.0],
    );
    let split = h * 0.45;
    for (y0, y1) in [(2.0, split - 1.0), (split + 1.0, h - 2.0)] {
        m.bx(
            Material::new(shade(c, 1.06), 0.4, Surface::Metal),
            [-w / 2.0 + 1.5, y0, d / 2.0 - 1.0],
            [w / 2.0 - 1.5, y1, d / 2.0],
        );
        for k in 0..5 {
            let y = y1 - 4.0 - f64::from(k) * 2.4;
            m.bx(
                Material::paint(shade(c, 0.45)),
                [-w / 2.0 + 8.0, y, d / 2.0],
                [w / 2.0 - 8.0, y + 1.0, d / 2.0 + 0.3],
            );
        }
    }
    led(m, [w / 2.0 - 6.0, split + 6.0, d / 2.0 + 0.1], 0x4fbf72);
    let duct = m.ceiling;
    if duct > 1.0 {
        m.bx(
            Material::metal(Rgb8::from_u32(0xb9bcbc)),
            [-w / 2.0 + 4.0, h, -d / 2.0 + 4.0],
            [w / 2.0 - 4.0, h + duct, d / 2.0 - 8.0],
        );
    }
}

/// A heat pump's indoor unit hung high on the wall: rounded in front, its flap open over the air
/// it blows, a light on its front.
pub(super) fn heat_pump(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    let (zb, zf) = (-d / 2.0, d / 2.0);
    let bottom = (h * 0.22).min(7.0);
    let round = (d * 0.35).min(h * 0.35);
    let mut outline = vec![[zb, bottom], [zb, h], [zf - round, h]];
    for k in 1..6 {
        let a = FRAC_PI_2 * f64::from(k) / 6.0;
        outline.push([zf - round + round * a.sin(), h - round + round * a.cos()]);
    }
    outline.push([zf, bottom + 3.0]);
    outline.push([zf - 4.0, bottom]);
    m.side_slab(body, &outline, -w / 2.0, w / 2.0);
    // The outlet under it, and its flap turned down.
    m.bx(
        Material::paint(shade(c, 0.35)),
        [-w / 2.0 + 4.0, bottom - 0.5, zb + 6.0],
        [w / 2.0 - 4.0, bottom, zf - 5.0],
    );
    let flap = m.x.translated([0.0, bottom, zf - 4.0]).turned_x(0.5);
    m.bx_in(
        Material::satin(shade(c, 0.95)),
        &flap,
        [-w / 2.0 + 4.0, -0.6, 0.0],
        [w / 2.0 - 4.0, 0.0, 6.0],
    );
    m.bx(
        Material::satin(shade(c, 0.96)),
        [-w / 2.0, 0.0, zb],
        [w / 2.0, bottom, zb + 5.0],
    );
    led(m, [w / 2.0 - 10.0, bottom + 4.0, zf - 0.3], 0x7fd3ff);
}

/// An air purifier: a tower round its filter, its intake all round below, the grille and the
/// ring of light on top.
pub(super) fn air_purifier(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    let grille = Material::fabric(shade(c, 0.72));
    let r = [w / 2.0, d / 2.0];
    m.lathe(
        body,
        [0.0; 3],
        &[[0.0, 0.0], [0.96, 0.0], [1.0, 1.5], [1.0, h * 0.08]],
        r,
    );
    m.lathe(
        grille,
        [0.0, h * 0.08, 0.0],
        &[[1.0, 0.0], [1.0, h * 0.5]],
        r,
    );
    m.lathe(
        body,
        [0.0, h * 0.58, 0.0],
        &[
            [1.0, 0.0],
            [1.0, h * 0.42 - 2.0],
            [0.92, h * 0.42],
            [0.0, h * 0.42],
        ],
        r,
    );
    m.lathe(
        Material::paint(shade(c, 0.35)),
        [0.0, h, 0.0],
        &[[0.75, 0.0], [0.75, 0.2], [0.0, 0.25]],
        r,
    );
    m.lathe(
        Material::new(Rgb8::from_u32(0x1b2a33), 0.15, Surface::Screen),
        [0.0, h, 0.0],
        &[[0.86, -0.1], [0.86, 0.15], [0.78, 0.15], [0.78, -0.1]],
        r,
    );
    display(
        m,
        [-3.0, h - 6.0, d / 2.0 - 0.2],
        [3.0, h - 3.0, d / 2.0 + 0.1],
    );
}

/// A dehumidifier: its body, the louvres on top where it blows, the water tank in front, its
/// handle and controls.
pub(super) fn dehumidifier(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.soft(
        Material::satin(c),
        [-w / 2.0, 1.0, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        2.5,
    );
    for sx in [-1.0, 1.0] {
        for sz in [-1.0, 1.0] {
            m.cyl(
                Material::paint(DARK),
                [sx * (w / 2.0 - 4.0), 0.0, sz * (d / 2.0 - 4.0)],
                [1.6, 1.6],
                1.5,
            );
        }
    }
    let vent = Material::paint(shade(c, 0.4));
    for k in 0..6 {
        let z = -d / 2.0 + 4.0 + f64::from(k) * (d * 0.5 - 4.0) / 5.0;
        m.bx(
            vent,
            [-w / 2.0 + 4.0, h - 0.1, z],
            [w / 2.0 - 4.0, h + 0.1, z + 1.2],
        );
    }
    m.bx(
        Material::satin(shade(c, 0.9)),
        [-w / 2.0 + 2.0, 4.0, d / 2.0 - 0.2],
        [w / 2.0 - 2.0, h * 0.42, d / 2.0 + 0.4],
    );
    m.bx(
        Material::new(Rgb8::from_u32(0x9fb6c2), 0.2, Surface::Matte),
        [w / 2.0 - 8.0, 6.0, d / 2.0 + 0.4],
        [w / 2.0 - 5.0, h * 0.38, d / 2.0 + 0.5],
    );
    display(
        m,
        [-4.0, h - 0.2, d / 2.0 - 7.0],
        [4.0, h + 0.15, d / 2.0 - 3.0],
    );
    m.bx(
        vent,
        [-w * 0.2, h - 0.15, d / 2.0 - 2.5],
        [w * 0.2, h + 0.1, d / 2.0 - 1.0],
    );
}

/// A humidifier: its base, a clear tank of water on it, and the nozzle of its mist.
pub(super) fn humidifier(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let r = [w / 2.0, d / 2.0];
    let base = h * 0.32;
    m.lathe(
        Material::satin(c),
        [0.0; 3],
        &[
            [0.0, 0.0],
            [0.94, 0.0],
            [1.0, 1.0],
            [1.0, base],
            [0.0, base],
        ],
        r,
    );
    m.lathe(
        Material::new(Rgb8::from_u32(0x9fc4d6), 0.1, Surface::Matte),
        [0.0, base, 0.0],
        &[
            [0.0, 0.0],
            [0.9, 0.0],
            [0.9, (h - base) * 0.55],
            [0.0, (h - base) * 0.55],
        ],
        r,
    );
    m.lathe(
        Material::glass(),
        [0.0, base, 0.0],
        &[[0.96, 0.0], [0.96, (h - base) * 0.9], [0.0, h - base - 2.0]],
        r,
    );
    m.cyl(
        Material::satin(c),
        [0.0, h - 3.0, 0.0],
        [w * 0.13, w * 0.11],
        3.0,
    );
    m.lathe(
        Material::new(Rgb8::from_u32(0x1b2a33), 0.15, Surface::Screen),
        [0.0, base * 0.5, 0.0],
        &[[1.005, 0.0], [1.005, 0.8]],
        [w / 2.0 * 0.9, d / 2.0 * 0.15],
    );
}

/// A fan's blades and guard, turning about the axis of `hub` (its frame's z), `r` their reach.
fn rotor(m: &mut Model<'_>, hub: &super::Xform, r: f64, blades: usize) {
    let blade = Material::new(Rgb8::from_u32(0xdfe6ea), 0.35, Surface::Matte);
    #[allow(clippy::cast_precision_loss)]
    for k in 0..blades {
        let turn = hub.turned_z(k as f64 * TAU / blades as f64);
        m.p.material = blade;
        m.p.slab(
            &turn,
            &[
                [r * 0.15, -r * 0.1],
                [r * 0.55, -r * 0.26],
                [r * 0.92, -r * 0.18],
                [r, 0.0],
                [r * 0.88, r * 0.2],
                [r * 0.5, r * 0.24],
                [r * 0.15, r * 0.1],
            ],
            -0.25,
            0.25,
        );
    }
    let guard = Material::metal(Rgb8::from_u32(0xe8e8e6));
    m.p.material = Material::satin(Rgb8::from_u32(0xe8e8e6));
    m.p.cylinder(
        &hub.turned_x(FRAC_PI_2),
        [0.0, -1.5, 0.0],
        [r * 0.18, r * 0.12],
        3.5,
        12,
        true,
    );
    for z in [-r * 0.12, r * 0.12] {
        let ring: Vec<V3> = (0..=16)
            .map(|k| {
                let a = f64::from(k) * TAU / 16.0;
                hub.point([a.cos() * (r + 1.0), a.sin() * (r + 1.0), z])
            })
            .collect();
        m.p.material = guard;
        m.p.pipe(&super::Xform::IDENTITY, &ring, 0.35, 6, false);
    }
    for k in 0..8 {
        let a = f64::from(k) * TAU / 8.0;
        let out = hub.point([a.cos() * (r + 1.0), a.sin() * (r + 1.0), r * 0.12]);
        let tip = hub.point([0.0, 0.0, r * 0.25]);
        m.p.material = guard;
        m.p.pipe(&super::Xform::IDENTITY, &[tip, out], 0.25, 4, false);
    }
}

/// A fan on its stand: a round foot, a pole, its head of blades in a guard; `tower`, a tall
/// slender tower; `desk`, a small fan on a table.
pub(super) fn fan(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    if variant == Some("tower") {
        let r = [w / 2.0 - 1.0, d / 2.0 - 1.0];
        m.lathe(
            body,
            [0.0; 3],
            &[[0.0, 0.0], [1.0, 0.0], [1.0, 2.5], [0.0, 3.0]],
            [w / 2.0, d / 2.0],
        );
        m.lathe(
            body,
            [0.0, 3.0, 0.0],
            &[
                [0.0, 0.0],
                [0.42, 0.0],
                [0.45, h - 6.0],
                [0.38, h - 3.0],
                [0.0, h - 3.0],
            ],
            r,
        );
        m.bx(
            Material::paint(shade(c, 0.4)),
            [-w * 0.12, h * 0.15, d * 0.18],
            [w * 0.12, h * 0.85, d * 0.23],
        );
        display(m, [-2.0, h - 4.0, -2.0], [2.0, h - 2.9, 2.0]);
        return;
    }
    let desk = variant == Some("desk");
    let r = (w.min(h * 0.8) / 2.0 - 1.5).max(4.0);
    let hub_y = h - r - 1.5;
    m.lathe(
        body,
        [0.0; 3],
        &[[0.0, 0.0], [1.0, 0.0], [1.0, 1.2], [0.6, 2.4], [0.0, 2.6]],
        [w.min(d) / 2.0 * 0.8, d / 2.0 * 0.8],
    );
    m.cyl(
        body,
        [0.0, 2.0, 0.0],
        [if desk { 1.2 } else { 1.4 }, 1.2],
        hub_y - 4.0,
    );
    let head = m.x.translated([0.0, hub_y, 0.0]);
    m.p.material = body;
    m.p.cylinder(
        &head.turned_x(FRAC_PI_2),
        [0.0, -6.0, 0.0],
        [r * 0.2, r * 0.25],
        6.0,
        12,
        true,
    );
    rotor(m, &head.translated([0.0, 0.0, 1.0]), r, 3);
}

/// A charger for an electric car on the wall: its box, the light of its state, its cable hanging
/// in a loop to the plug in its holster.
pub(super) fn ev_charger(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    // The box, and the plug's holster beside it on the right.
    let holster = (w * 0.24).min(7.0);
    let right = w / 2.0 - holster - 0.5;
    let mid = (-w / 2.0 + right) / 2.0;
    let bw = right + w / 2.0;
    m.soft(
        body,
        [-w / 2.0, 0.0, -d / 2.0],
        [right, h, d / 2.0 - 2.0],
        2.5,
    );
    m.soft(
        Material::satin(shade(c, 1.6)),
        [-w / 2.0 + 1.5, 1.5, d / 2.0 - 2.5],
        [right - 1.5, h - 1.5, d / 2.0],
        1.0,
    );
    m.bx(
        Material::paint(Rgb8::from_u32(0x4fbf72)),
        [mid - bw * 0.25, h * 0.7, d / 2.0],
        [mid + bw * 0.25, h * 0.7 + 1.2, d / 2.0 + 0.2],
    );
    let cable = Material::new(Rgb8::from_u32(0x1d1f20), 0.5, Surface::Matte);
    let drop = 55.0_f64.min(h * 1.6);
    let path: Vec<V3> = (0..=10)
        .map(|k| {
            let t = f64::from(k) / 10.0;
            let a = t * TAU;
            [
                mid + (w / 2.0 - holster / 2.0 - mid) * t,
                -drop * (a / 2.0).sin() * 0.95 + h * 0.25 * t,
                d * 0.1 + 3.0 * (a / 2.0).sin(),
            ]
        })
        .collect();
    m.pipe(cable, &path, 0.9);
    m.soft(
        body,
        [w / 2.0 - holster, h * 0.2, -d / 2.0 + 2.0],
        [w / 2.0, h * 0.2 + 10.0, d / 2.0 - 3.0],
        1.5,
    );
}

/// A board of breakers behind its door on the wall: the door, its handle, a card holder.
pub(super) fn electrical_panel(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let metal = Material::new(c, 0.45, Surface::Metal);
    m.bx(
        metal,
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h, d / 2.0 - 0.8],
    );
    m.bx(
        Material::new(shade(c, 1.05), 0.45, Surface::Metal),
        [-w / 2.0 + 1.0, 1.0, d / 2.0 - 0.8],
        [w / 2.0 - 1.0, h - 1.0, d / 2.0],
    );
    m.bx(
        Material::paint(DARK),
        [w / 2.0 - 5.0, h * 0.45, d / 2.0],
        [w / 2.0 - 3.5, h * 0.55, d / 2.0 + 1.2],
    );
    m.bx(
        Material::paint(Rgb8::from_u32(0xf3f1ea)),
        [-w * 0.3, h - 9.0, d / 2.0],
        [w * 0.1, h - 4.0, d / 2.0 + 0.2],
    );
}

/// A router: a flat box, its lights in a row and its antennas; `mesh`, a white point of a mesh
/// network with its light below.
pub(super) fn router(m: &mut Model<'_>, mesh: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    if mesh {
        m.lathe(
            Material::satin(c),
            [0.0; 3],
            &[
                [0.0, 0.0],
                [0.86, 0.0],
                [1.0, h * 0.15],
                [1.0, h * 0.85],
                [0.8, h],
                [0.0, h],
            ],
            [w / 2.0, d / 2.0],
        );
        led(m, [0.0, h * 0.12, d / 2.0 - 0.3], 0x4fbf72);
        return;
    }
    let body = h.min(4.0);
    m.soft(
        Material::satin(c),
        [-w / 2.0, 0.5, -d / 2.0 + 1.0],
        [w / 2.0, body, d / 2.0],
        1.2,
    );
    for k in 0..5 {
        let x = (f64::from(k) - 2.0) * w * 0.08;
        led(m, [x, body * 0.6, d / 2.0], 0x4fbf72);
    }
    let antenna = Material::satin(shade(c, 1.1));
    for k in 0..4 {
        let t = f64::from(k) / 3.0 - 0.5;
        let x = t * w * 0.85;
        let tall = 14.0_f64.min(w * 0.6);
        m.rod(
            antenna,
            [x, body * 0.6, -d / 2.0 + 1.0],
            [x * 1.15, body + tall, -d / 2.0 - 2.0],
            0.6,
        );
    }
}

/// A Wi-Fi access point on the ceiling: a white disc, the ring of its light underneath, on a stem
/// to the ceiling.
pub(super) fn access_point(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.lathe(
        Material::satin(c),
        [0.0; 3],
        &[[0.0, 0.0], [0.86, 0.0], [1.0, h * 0.45], [1.0, h], [0.0, h]],
        [w / 2.0, d / 2.0],
    );
    m.lathe(
        Material::paint(Rgb8::from_u32(0x7fd3ff)),
        [0.0, -0.05, 0.0],
        &[[0.42, 0.0], [0.38, 0.0], [0.0, 0.0]],
        [w / 2.0, d / 2.0],
    );
    if m.ceiling > 0.5 {
        m.cyl(Material::metal(STEEL), [0.0, h, 0.0], [1.0, 1.0], m.ceiling);
    }
}

/// A thermostat on the wall: its face, its screen and its two keys.
pub(super) fn thermostat(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.soft(
        Material::satin(c),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        0.8,
    );
    display(
        m,
        [-w / 2.0 + 1.2, h * 0.45, d / 2.0],
        [w / 2.0 - 1.2, h - 1.2, d / 2.0 + 0.1],
    );
    m.bx(
        Material::paint(Rgb8::from_u32(0xe9a23b)),
        [-w * 0.18, h * 0.62, d / 2.0 + 0.1],
        [w * 0.18, h * 0.78, d / 2.0 + 0.15],
    );
    for sx in [-1.0, 1.0] {
        m.bx(
            Material::satin(shade(c, 0.85)),
            [sx * w * 0.22 - 1.0, h * 0.15, d / 2.0],
            [sx * w * 0.22 + 1.0, h * 0.3, d / 2.0 + 0.2],
        );
    }
}

/// A smoke detector on the ceiling: a low dome, the slots of its vents, its light.
pub(super) fn smoke_detector(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let r = [w / 2.0, d / 2.0];
    m.lathe(
        Material::satin(c),
        [0.0; 3],
        &[
            [0.0, 0.0],
            [0.55, 0.05],
            [0.8, h * 0.35],
            [1.0, h * 0.7],
            [1.0, h],
            [0.0, h],
        ],
        r,
    );
    m.lathe(
        Material::paint(shade(c, 0.6)),
        [0.0; 3],
        &[[0.72, h * 0.25], [0.74, h * 0.32]],
        r,
    );
    led(m, [w * 0.18, h * 0.05, 0.0], 0xd23c3c);
    if m.ceiling > 0.5 {
        m.cyl(Material::metal(STEEL), [0.0, h, 0.0], [0.8, 0.8], m.ceiling);
    }
}

/// A camera's lens facing along its frame's z from its origin, `r` its size.
fn lens(m: &mut Model<'_>, at: &super::Xform, r: f64) {
    let face = at.turned_x(FRAC_PI_2);
    m.p.material = Material::new(Rgb8::from_u32(0x0d0f10), 0.1, Surface::Screen);
    m.p.cylinder(&face, [0.0; 3], [r, r * 0.9], 0.6, 12, true);
    m.p.material = Material::new(Rgb8::from_u32(0x2a3a4a), 0.05, Surface::Mirror);
    m.p.sphere(&face, [0.0, 0.6, 0.0], [r * 0.45, r * 0.2, r * 0.45], 8);
}

/// A camera: a small one on its stand, its lens forward; `wall`, a bullet camera on its arm
/// looking down; `dome`, a smoked dome on the ceiling.
pub(super) fn camera(m: &mut Model<'_>, variant: Option<&str>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    match variant {
        Some("wall") => {
            m.soft(
                body,
                [-w / 2.0, h * 0.2, -d / 2.0],
                [w / 2.0, h * 0.85, -d / 2.0 + 1.5],
                0.5,
            );
            m.rod(
                body,
                [0.0, h * 0.5, -d / 2.0 + 1.0],
                [0.0, h * 0.62, -d / 2.0 + 5.0],
                1.2,
            );
            let aim =
                m.x.translated([0.0, h * 0.62, -d / 2.0 + 4.0])
                    .turned_x(0.3);
            let r = (w / 2.0).min(h / 2.0) * 0.9;
            m.p.material = body;
            m.p.cylinder(
                &aim.turned_x(FRAC_PI_2),
                [0.0; 3],
                [r, r],
                d - 5.0,
                12,
                true,
            );
            // Its sun hood over it.
            m.p.material = body;
            m.p.cuboid(&aim, [-r - 0.4, r * 0.8, -0.5], [r + 0.4, r + 0.5, d - 3.5]);
            lens(m, &aim.translated([0.0, 0.0, d - 5.0]), r * 0.55);
        }
        Some("dome") => {
            m.lathe(
                body,
                [0.0; 3],
                &[[0.0, h * 0.62], [0.98, h * 0.62], [1.0, h], [0.0, h]],
                [w / 2.0, d / 2.0],
            );
            m.lathe(
                Material::new(Rgb8::from_u32(0x1d2226), 0.05, Surface::Screen),
                [0.0; 3],
                &[[0.0, 0.0], [0.4, 0.06], [0.7, h * 0.25], [0.8, h * 0.62]],
                [w / 2.0, d / 2.0],
            );
            if m.ceiling > 0.5 {
                m.cyl(Material::metal(STEEL), [0.0, h, 0.0], [1.0, 1.0], m.ceiling);
            }
        }
        _ => {
            let r = w.min(d) / 2.0;
            m.lathe(
                body,
                [0.0; 3],
                &[
                    [0.0, 0.0],
                    [0.95, 0.0],
                    [1.0, 0.8],
                    [0.4, 1.8],
                    [0.3, h * 0.45],
                    [0.0, h * 0.45],
                ],
                [r, r],
            );
            let head_y = h * 0.45 + (h * 0.55) / 2.0;
            m.soft(
                body,
                [-w / 2.0, h * 0.45, -d / 2.0 + 1.0],
                [w / 2.0, h, d / 2.0 - 0.5],
                (w * 0.3).min(2.5),
            );
            let at = m.x.translated([0.0, head_y, d / 2.0 - 0.5]);
            lens(m, &at, (w * 0.28).min(2.4));
            led(m, [w * 0.28, h - 1.5, d / 2.0 - 0.4], 0x4fbf72);
        }
    }
}

/// A tablet on the wall showing a dashboard: its bezel, its screen, the cards on it.
pub(super) fn wall_tablet(m: &mut Model<'_>) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    m.soft(
        Material::satin(c),
        [-w / 2.0, 0.0, -d / 2.0],
        [w / 2.0, h, d / 2.0],
        0.8,
    );
    let (x0, y0, x1, y1) = (-w / 2.0 + 1.2, 1.2, w / 2.0 - 1.2, h - 1.2);
    display(m, [x0, y0, d / 2.0], [x1, y1, d / 2.0 + 0.1]);
    let cards = [
        (0.0, 0.0, 0.5, 0.45, 0x34495e),
        (0.52, 0.0, 1.0, 0.45, 0x2f5f6f),
        (0.0, 0.5, 0.32, 1.0, 0x5a4a2f),
        (0.34, 0.5, 0.66, 1.0, 0x2f4a3a),
        (0.68, 0.5, 1.0, 1.0, 0x3a3a52),
    ];
    let (iw, ih) = (x1 - x0 - 2.0, y1 - y0 - 2.0);
    for (a, b, cc, e, color) in cards {
        m.bx(
            Material::new(Rgb8::from_u32(color), 0.3, Surface::Screen),
            [x0 + 1.0 + iw * a, y0 + 1.0 + ih * b, d / 2.0 + 0.1],
            [
                x0 + 1.0 + iw * cc - 0.3,
                y0 + 1.0 + ih * e - 0.3,
                d / 2.0 + 0.16,
            ],
        );
    }
}

/// A sensor on the wall: a small square with its light; `motion`, a motion sensor's lens
/// looking out and down.
pub(super) fn sensor(m: &mut Model<'_>, motion: bool) {
    let (w, d, h, c) = (m.w, m.d, m.h, m.c);
    let body = Material::satin(c);
    if motion {
        m.soft(
            body,
            [-w / 2.0, 0.0, -d / 2.0],
            [w / 2.0, h, -d / 2.0 + d * 0.45],
            0.8,
        );
        let aim =
            m.x.translated([0.0, h * 0.5, -d / 2.0 + d * 0.45])
                .turned_x(FRAC_PI_2 + 0.35);
        let r = w.min(h) * 0.42;
        m.p.material = Material::new(Rgb8::from_u32(0xf6f6f2), 0.25, Surface::Matte);
        m.p.lathe(
            &aim,
            [0.0; 3],
            &[
                [r, 0.0],
                [r * 0.9, r * 0.45],
                [r * 0.5, r * 0.8],
                [0.0, r * 0.9],
            ],
            [1.0, 1.0],
            12,
        );
        return;
    }
    m.soft(body, [-w / 2.0, 0.0, -d / 2.0], [w / 2.0, h, d / 2.0], 0.8);
    led(m, [w * 0.28, h * 0.72, d / 2.0], 0x4fbf72);
}
