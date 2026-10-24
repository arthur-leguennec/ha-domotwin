//! Lamps: the point lights that light a lamp's room, the halos around lit bulbs and the
//! per-element data the shaders read (light, greyed out, tap highlight, edit marks). No GPU here.

use domotwin_core::live::Look;
use domotwin_core::scene::LightSpot;

/// Most point lights a frame uses (the strongest win).
pub const MAX_LIGHTS: usize = 16;
/// Bulbs higher than this (cm) are on the ceiling, which is not drawn: seen from above, a halo
/// there would float over the floor like a stain. Their glowing disc is enough.
const HALO_MAX_HEIGHT: f64 = 200.0;

/// A point light, limited to its room.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PointLight {
    /// Position (world, cm).
    pub position: [f32; 3],
    /// Reach (cm): no light beyond.
    pub radius: f32,
    /// Colour × intensity (linear).
    pub color: [f32; 3],
    /// Room slot it lights (0: every room).
    pub room: u8,
}

/// A soft glow drawn around a lit bulb.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Halo {
    /// Centre (world, cm).
    pub center: [f32; 3],
    /// Radius (cm).
    pub size: f32,
    /// Colour × intensity (linear).
    pub tint: [f32; 3],
}

fn strength(look: &Look) -> f32 {
    look.strength.max(0.0) * (1.0 - look.unavailable.clamp(0.0, 1.0))
}

/// The point lights of the lit lamps and screens, strongest first.
#[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
pub fn point_lights(spots: &[LightSpot], looks: &[Look]) -> Vec<PointLight> {
    let mut by_element: Vec<(usize, [f64; 3], usize, &LightSpot)> = Vec::new();
    for spot in spots {
        match by_element.iter_mut().find(|(e, ..)| *e == spot.element) {
            Some((_, sum, count, _)) => {
                for (total, v) in sum.iter_mut().zip(spot.position) {
                    *total += v;
                }
                *count += 1;
            }
            None => by_element.push((spot.element, spot.position, 1, spot)),
        }
    }
    let mut lights: Vec<(f32, PointLight)> = by_element
        .into_iter()
        .filter_map(|(element, sum, count, spot)| {
            let look = looks.get(element)?;
            let s = strength(look);
            if s < 0.02 {
                return None;
            }
            let n = count as f64;
            let position = [
                (sum[0] / n) as f32,
                (sum[1] / n) as f32,
                (sum[2] / n) as f32,
            ];
            let (gain, radius) = if spot.screen {
                (0.55, 260.0)
            } else {
                // High lamps reach further, so that their light gets to the floor.
                (1.5, (300.0 + 0.9 * position[1]).clamp(300.0, 560.0))
            };
            let color = look.glow.map(|c| c * s * gain);
            Some((
                s,
                PointLight {
                    position,
                    radius,
                    color,
                    room: spot.room,
                },
            ))
        })
        .collect();
    lights.sort_by(|a, b| b.0.total_cmp(&a.0));
    lights
        .into_iter()
        .take(MAX_LIGHTS)
        .map(|(_, light)| light)
        .collect()
}

/// Halos around the bulbs of lit lamps (not on the ceiling).
#[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
pub fn halos(spots: &[LightSpot], looks: &[Look]) -> Vec<Halo> {
    spots
        .iter()
        .filter(|spot| !spot.screen && spot.position[1] <= HALO_MAX_HEIGHT)
        .filter_map(|spot| {
            let look = looks.get(spot.element)?;
            let s = strength(look);
            if s < 0.02 {
                return None;
            }
            let bulbs = spots.iter().filter(|o| o.element == spot.element).count() as f32;
            let size = (14.0 + 10.0 * s.min(1.5)) / bulbs.sqrt().max(1.0);
            Some(Halo {
                center: spot.position.map(|v| v as f32),
                size,
                tint: look.glow.map(|c| c * s.min(1.5) * 0.9),
            })
        })
        .collect()
}

/// How edit mode marks an element.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Mark {
    /// Selected.
    pub selected: bool,
    /// Overlapping another piece or a wall.
    pub conflict: bool,
}

/// Two texels per element tag (index + 1, tag 0 = no element): the light (`rgb`, strength) and
/// the flags (greyed out, highlight, selected, in conflict).
pub fn element_texels(looks: &[Look], marks: &[Mark]) -> Vec<[f32; 4]> {
    let mut texels = vec![[0.0; 4]; 2 * (looks.len() + 1)];
    for (i, look) in looks.iter().enumerate() {
        let at = 2 * (i + 1);
        let mark = marks.get(i).copied().unwrap_or_default();
        texels[at] = [look.glow[0], look.glow[1], look.glow[2], strength(look)];
        texels[at + 1] = [
            look.unavailable.clamp(0.0, 1.0),
            look.highlight.clamp(0.0, 1.0),
            if mark.selected { 1.0 } else { 0.0 },
            if mark.conflict { 1.0 } else { 0.0 },
        ];
    }
    texels
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spot(element: usize, position: [f64; 3], screen: bool) -> LightSpot {
        LightSpot {
            element,
            position,
            color: domotwin_core::plan::Rgb8::from_u32(0xffd6a0),
            power: 1.0,
            on: true,
            room: 1,
            screen,
        }
    }

    fn lit(strength: f32) -> Look {
        Look {
            strength,
            ..Look::default()
        }
    }

    #[test]
    fn one_light_per_lamp_strongest_first() {
        let spots = [
            spot(0, [0.0, 200.0, 0.0], false),
            spot(0, [20.0, 200.0, 0.0], false),
            spot(1, [100.0, 100.0, 0.0], false),
            spot(2, [0.0, 50.0, 0.0], true),
        ];
        let looks = [lit(0.5), lit(1.0), lit(0.0)];
        let lights = point_lights(&spots, &looks);
        assert_eq!(lights.len(), 2);
        assert_eq!(lights[0].position, [100.0, 100.0, 0.0]);
        assert_eq!(lights[1].position, [10.0, 200.0, 0.0]);
        assert!(lights[1].radius > lights[0].radius);
        assert_eq!(halos(&spots, &looks).len(), 3);
        let ceiling = [spot(0, [0.0, 240.0, 0.0], false)];
        assert!(halos(&ceiling, &[lit(1.0)]).is_empty());
    }

    #[test]
    fn unavailable_lamps_give_no_light() {
        let spots = [spot(0, [0.0; 3], false)];
        let looks = [Look {
            strength: 1.0,
            unavailable: 1.0,
            ..Look::default()
        }];
        assert!(point_lights(&spots, &looks).is_empty());
        let texels = element_texels(&looks, &[]);
        assert_eq!(texels.len(), 4);
        assert_eq!(texels[2][3], 0.0);
        assert_eq!(texels[3][0], 1.0);
        let marked = element_texels(
            &looks,
            &[Mark {
                selected: true,
                conflict: true,
            }],
        );
        assert_eq!(marked[3][2..], [1.0, 1.0]);
    }

    #[test]
    fn at_most_sixteen_lights() {
        let spots: Vec<LightSpot> = (0..40).map(|i| spot(i, [0.0; 3], false)).collect();
        let looks: Vec<Look> = (0..40).map(|i| lit(0.1 + i as f32 / 40.0)).collect();
        let lights = point_lights(&spots, &looks);
        assert_eq!(lights.len(), MAX_LIGHTS);
    }
}
