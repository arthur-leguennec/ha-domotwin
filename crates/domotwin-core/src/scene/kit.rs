//! User models made of primitive parts (`kit`), fitted into the piece's own size. Kit axes: `x` to
//! the right, `y` towards the front, `z` up. Unreadable parts are skipped, never fatal.

use serde_json::Value;

use super::furniture::Model;
use super::mesh::{Material, ROUND, Surface};
use crate::plan::Rgb8;

/// Most parts drawn per kit.
const MAX_PARTS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Shape {
    Box,
    Cylinder,
    Sphere,
}

#[derive(Debug, Clone, PartialEq)]
struct Part {
    shape: Shape,
    at: [f64; 3],
    size: [f64; 3],
    material: Option<String>,
    axis: Option<char>,
    taper: f64,
    rotate: [f64; 3],
}

fn triple(value: Option<&Value>) -> Option<[f64; 3]> {
    let list = value?.as_array()?;
    if list.len() != 3 {
        return None;
    }
    let mut out = [0.0; 3];
    for (slot, v) in out.iter_mut().zip(list) {
        let n = v.as_f64()?;
        if !n.is_finite() {
            return None;
        }
        *slot = n.clamp(-4000.0, 4000.0);
    }
    Some(out)
}

fn part(value: &Value) -> Option<Part> {
    let shape = match value.get("shape")?.as_str()? {
        "box" => Shape::Box,
        "cylinder" => Shape::Cylinder,
        "sphere" => Shape::Sphere,
        _ => return None,
    };
    let at = triple(value.get("at"))?;
    let size = triple(value.get("size"))?;
    if size.iter().any(|s| *s < 0.1) {
        return None;
    }
    Some(Part {
        shape,
        at,
        size,
        material: value
            .get("material")
            .and_then(Value::as_str)
            .map(str::to_owned),
        axis: match value.get("axis").and_then(Value::as_str) {
            Some("x") => Some('x'),
            Some("y") => Some('y'),
            _ => None,
        },
        taper: value
            .get("taper")
            .and_then(Value::as_f64)
            .filter(|t| t.is_finite())
            .map_or(1.0, |t| t.clamp(0.0, 1.0)),
        rotate: triple(value.get("rotate")).unwrap_or([0.0; 3]),
    })
}

/// The material of a part, from the piece's colour for `accent` materials.
fn material(name: Option<&str>, accent: Rgb8) -> Material {
    let finish = |finish: &str, color: Rgb8| match finish {
        "metal" => Material::metal(color),
        "wood" => Material::wood(color),
        "fabric" => Material::fabric(color),
        "leather" => Material::new(color, 0.5, Surface::Matte),
        _ => Material::satin(color),
    };
    let Some(name) = name else {
        return Material::satin(accent);
    };
    if let Some(rest) = name.strip_prefix("accent") {
        return finish(rest.trim_start_matches(':'), accent);
    }
    if let Some((kind, color)) = name
        .split_once(':')
        .and_then(|(kind, hex)| Some((kind, Rgb8::from_hex(hex)?)))
    {
        return finish(kind, color);
    }
    match name {
        "glass" => Material::glass(),
        "glassDark" => Material::new(Rgb8::from_u32(0x26302f), 0.05, Surface::Screen),
        "chrome" => Material::metal(Rgb8::from_u32(0xe4e6e7)),
        "steel" => Material::metal(Rgb8::from_u32(0xc9cccb)),
        "steelDark" => Material::metal(Rgb8::from_u32(0x8f9493)),
        "gold" => Material::metal(Rgb8::from_u32(0xc7a25a)),
        "black" => Material::satin(Rgb8::from_u32(0x1b1d1c)),
        "ceramic" => Material::ceramic(Rgb8::from_u32(0xf6f5f1)),
        "mirror" => Material::new(Rgb8::from_u32(0xeef3f4), 0.02, Surface::Mirror),
        "marble" => Material::new(Rgb8::from_u32(0xe8e6e1), 0.25, Surface::Matte),
        "screen" => Material::new(Rgb8::from_u32(0x0b0d0e), 0.12, Surface::Screen),
        _ => Material::satin(accent),
    }
}

/// Draws a user model into `m`. Returns `false` when it has no kit (3D files are boxes until
/// they can be read) or no readable part.
pub(crate) fn draw(m: &mut Model<'_>, model: &Value) -> bool {
    let Some(kit) = model.get("kit").filter(|k| k.is_object()) else {
        return false;
    };
    let parts: Vec<Part> = kit
        .get("parts")
        .and_then(Value::as_array)
        .map(|list| list.iter().take(MAX_PARTS).filter_map(part).collect())
        .unwrap_or_default();
    if parts.is_empty() {
        return false;
    }
    let design = triple(kit.get("size")).filter(|s| s.iter().all(|v| *v >= 0.1));
    let (mut min, mut max) = match design {
        Some(size) => ([0.0; 3], size),
        None => ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]),
    };
    for p in &parts {
        for k in 0..3 {
            min[k] = min[k].min(p.at[k]);
            max[k] = max[k].max(p.at[k] + p.size[k]);
        }
    }
    let extent = [0, 1, 2].map(|k| (max[k] - min[k]).max(0.1));
    // Kit x → width, kit y → depth (front), kit z → height.
    let scale = [m.w / extent[0], m.d / extent[1], m.h / extent[2]];
    let accent = m.c;
    for p in &parts {
        let centre = [
            (p.at[0] + p.size[0] / 2.0 - min[0]) * scale[0] - m.w / 2.0,
            (p.at[2] + p.size[2] / 2.0 - min[2]) * scale[2],
            (p.at[1] + p.size[1] / 2.0 - min[1]) * scale[1] - m.d / 2.0,
        ];
        // Model frame size: x width, y height, z depth.
        let size = [
            p.size[0] * scale[0],
            p.size[2] * scale[2],
            p.size[1] * scale[1],
        ];
        let [lean_front, lean_right, turn] = p.rotate.map(f64::to_radians);
        let frame =
            m.x.translated(centre)
                .turned_y(-turn)
                .turned_z(-lean_right)
                .turned_x(lean_front);
        let mat = material(p.material.as_deref(), accent);
        let half = size.map(|s| s / 2.0);
        match p.shape {
            Shape::Box => {
                let painter = if mat.surface == Surface::Glass {
                    &mut m.g
                } else {
                    &mut m.p
                };
                painter.material = mat;
                painter.cuboid(&frame, half.map(|v| -v), half);
            }
            Shape::Sphere => {
                m.p.material = mat;
                m.p.sphere(&frame, [0.0; 3], half, ROUND);
            }
            Shape::Cylinder => {
                m.p.material = mat;
                let (axis_frame, length, radii) = match p.axis {
                    // Lying along x: the cylinder's own y axis points to +x.
                    Some('x') => (
                        frame.turned_z(-std::f64::consts::FRAC_PI_2),
                        size[0],
                        [half[1], half[2]],
                    ),
                    // Lying along the front axis.
                    Some(_) => (
                        frame.turned_x(std::f64::consts::FRAC_PI_2),
                        size[2],
                        [half[0], half[1]],
                    ),
                    None => (frame, size[1], [half[0], half[2]]),
                };
                let top = [radii[0] * p.taper, radii[1] * p.taper];
                m.p.ellipse_cylinder(
                    &axis_frame,
                    [0.0, -length / 2.0, 0.0],
                    radii,
                    top,
                    length,
                    ROUND,
                    true,
                );
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materials() {
        let accent = Rgb8::from_u32(0x808080);
        assert_eq!(material(None, accent).color, accent);
        assert_eq!(
            material(Some("accent:metal"), accent).surface,
            Surface::Metal
        );
        assert_eq!(
            material(Some("wood:#a0714a"), accent).color,
            Rgb8::from_u32(0xa0714a)
        );
        assert_eq!(material(Some("glass"), accent).surface, Surface::Glass);
        assert_eq!(material(Some("unknown"), accent).color, accent);
    }

    #[test]
    fn parts_are_read_leniently() {
        let ok = serde_json::json!({ "shape": "cylinder", "at": [0, 0, 62], "size": [38, 38, 4], "axis": "x", "taper": 0.5 });
        let Some(p) = part(&ok) else {
            panic!("a valid part")
        };
        assert_eq!(
            (p.shape, p.axis, p.taper),
            (Shape::Cylinder, Some('x'), 0.5)
        );
        assert!(
            part(&serde_json::json!({ "shape": "cone", "at": [0, 0, 0], "size": [1, 1, 1] }))
                .is_none()
        );
        assert!(
            part(&serde_json::json!({ "shape": "box", "at": [0, 0], "size": [1, 1, 1] })).is_none()
        );
        assert!(
            part(&serde_json::json!({ "shape": "box", "at": [0, 0, 0], "size": [0, 1, 1] }))
                .is_none()
        );
    }
}
