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
            let (gain, radius) = if spot.screen || look.screen {
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
            // A user model linked to a media player lights like a screen: no halo.
            if s < 0.02 || look.screen {
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

/// Texels per element tag in [`element_texels`].
pub const ELEMENT_TEXELS: usize = 3;
/// Element tags per row of the elements' texture (`ELEMENTS_PER_ROW` in `shaders.rs`): a row is
/// 1 536 texels wide, within the 2 048 every WebGL2 GPU allows, however many elements a home has.
pub const ELEMENTS_PER_ROW: usize = 512;

/// Below this (W), an appliance is on standby: the power layer leaves it out.
const STANDBY_WATTS: f32 = 3.0;

/// How strongly the power layer marks a piece drawing `watts`: 0 on standby, then on a
/// logarithmic scale up to 1 at 3 kW (30 W reads a third, 300 W two thirds).
pub fn power_level(watts: f32) -> f32 {
    if watts.is_nan() || watts <= STANDBY_WATTS {
        return 0.0;
    }
    ((watts / STANDBY_WATTS).log10() / 3.0).clamp(0.02, 1.0)
}

/// Three texels per element tag (index + 1, tag 0 = no element): the light (`rgb`, strength),
/// the flags (greyed out, highlight, selected, in conflict) and the power layer's level.
pub fn element_texels(looks: &[Look], marks: &[Mark]) -> Vec<[f32; 4]> {
    let mut texels = vec![[0.0; 4]; ELEMENT_TEXELS * (looks.len() + 1)];
    for (i, look) in looks.iter().enumerate() {
        let at = ELEMENT_TEXELS * (i + 1);
        let mark = marks.get(i).copied().unwrap_or_default();
        texels[at] = [look.glow[0], look.glow[1], look.glow[2], strength(look)];
        texels[at + 1] = [
            look.unavailable.clamp(0.0, 1.0),
            look.highlight.clamp(0.0, 1.0),
            if mark.selected { 1.0 } else { 0.0 },
            if mark.conflict { 1.0 } else { 0.0 },
        ];
        texels[at + 2][0] = power_level(look.power);
    }
    texels
}

/// [`element_texels`] laid out as the elements' texture: its width and height, and its texels,
/// [`ELEMENTS_PER_ROW`] tags per row (the last row padded).
pub fn element_rows(mut texels: Vec<[f32; 4]>) -> (u32, u32, Vec<[f32; 4]>) {
    let tags = texels.len().div_ceil(ELEMENT_TEXELS).max(1);
    let per_row = tags.min(ELEMENTS_PER_ROW);
    let rows = tags.div_ceil(per_row);
    texels.resize(per_row * rows * ELEMENT_TEXELS, [0.0; 4]);
    let width = u32::try_from(per_row * ELEMENT_TEXELS).unwrap_or(u32::MAX);
    (width, u32::try_from(rows).unwrap_or(u32::MAX), texels)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spot(element: usize, position: [f64; 3], screen: bool) -> LightSpot {
        LightSpot {
            element,
            storey: 0,
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
    fn a_lamp_spot_showing_a_screen_lights_like_one() {
        let spots = [spot(0, [0.0, 100.0, 0.0], false)];
        let lamp = point_lights(&spots, &[lit(0.8)]);
        let looks = [Look {
            screen: true,
            ..lit(0.8)
        }];
        let screen = point_lights(&spots, &looks);
        assert!(screen[0].radius < lamp[0].radius);
        assert!(halos(&spots, &looks).is_empty());
        assert_eq!(halos(&spots, &[lit(0.8)]).len(), 1);
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
        assert_eq!(texels.len(), 6);
        assert_eq!(texels[3][3], 0.0);
        assert_eq!(texels[4][0], 1.0);
        let marked = element_texels(
            &looks,
            &[Mark {
                selected: true,
                conflict: true,
            }],
        );
        assert_eq!(marked[4][2..], [1.0, 1.0]);
    }

    #[test]
    fn power_reads_on_a_logarithmic_scale() {
        assert_eq!(power_level(0.0), 0.0);
        assert_eq!(power_level(2.5), 0.0);
        assert_eq!(power_level(f32::NAN), 0.0);
        assert!((power_level(30.0) - 1.0 / 3.0).abs() < 1e-4);
        assert!((power_level(300.0) - 2.0 / 3.0).abs() < 1e-4);
        assert_eq!(power_level(1e6), 1.0);
        let looks = [Look {
            power: 300.0,
            ..Look::default()
        }];
        assert!((element_texels(&looks, &[])[5][0] - 2.0 / 3.0).abs() < 1e-4);
    }

    #[test]
    fn the_elements_texture_wraps_onto_rows() {
        // A few elements: one row, as wide as they need.
        let (w, h, texels) = element_rows(element_texels(&[lit(1.0); 4], &[]));
        assert_eq!((w, h, texels.len()), (15, 1, 15));
        // A home of many: rows of 512 tags, 1 536 texels, the last one padded.
        let looks = vec![lit(1.0); 1500];
        let (w, h, texels) = element_rows(element_texels(&looks, &[]));
        assert_eq!((w, h), (1536, 3));
        assert_eq!(texels.len(), 1536 * 3);
        // Tag 1 000 (element 999) is on the second row, where the shader reads it.
        let at = (1000 / ELEMENTS_PER_ROW) * 1536 + (1000 % ELEMENTS_PER_ROW) * ELEMENT_TEXELS;
        assert!((texels[at][3] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn at_most_sixteen_lights() {
        let spots: Vec<LightSpot> = (0..40).map(|i| spot(i, [0.0; 3], false)).collect();
        let looks: Vec<Look> = (0..40).map(|i| lit(0.1 + i as f32 / 40.0)).collect();
        let lights = point_lights(&spots, &looks);
        assert_eq!(lights.len(), MAX_LIGHTS);
    }
}
