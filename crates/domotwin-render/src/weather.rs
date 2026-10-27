//! The weather around the home (`DECISIONS.md`, D-068): where things fall, how many, in which
//! tint, and how the sky's light turns grey. The particles themselves are worked out by the
//! weather shaders, from their number and the time.

use domotwin_core::lighting::Lighting;
use domotwin_core::scene::{RoofShape, Scene};
use domotwin_core::weather::{Fall, Weather};

use crate::quality::QualityPreset;

/// The home's footprint for what falls: every storey's bounds and the roof's rectangle with its
/// eaves, on the plan's axes. Things fall around it, and on the roof when it is shown.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Footprint {
    /// Its centre on the plan.
    pub(crate) centre: [f64; 2],
    /// Half its size along the plan's x and y (cm).
    pub(crate) half: [f64; 2],
    /// The roof over the home, when it has one.
    pub(crate) roof: Option<RoofShape>,
}

/// How long the weather's shader loops (s): each particle's turn fits a whole number of times in it.
pub(crate) const LOOP_S: f64 = 600.0;

/// How far out around the home things fall: at least this far (cm), else a share of its size.
const MARGIN: f64 = 250.0;
const MARGIN_SHARE: f64 = 0.35;

impl Footprint {
    /// The footprint of a scene, `None` when it has nothing to stand on.
    pub(crate) fn of(scene: &Scene) -> Option<Self> {
        let [min, max] = scene.bounds;
        let mut lo = [f64::from(min[0]), f64::from(min[2])];
        let mut hi = [f64::from(max[0]), f64::from(max[2])];
        let roof = scene.roof.as_ref().map(|roof| roof.shape);
        if let Some(shape) = roof {
            // The eaves stand out of the walls: their corners widen the footprint.
            let [ux, uz] = shape.ridge;
            for (a, b) in [(1.0, 1.0), (1.0, -1.0), (-1.0, 1.0), (-1.0, -1.0)] {
                let (l, w) = (a * shape.half_length, b * shape.half_width);
                let corner = [
                    shape.centre[0] + ux * l - uz * w,
                    shape.centre[1] + uz * l + ux * w,
                ];
                for k in 0..2 {
                    lo[k] = lo[k].min(corner[k]);
                    hi[k] = hi[k].max(corner[k]);
                }
            }
        }
        let (w, d) = (hi[0] - lo[0], hi[1] - lo[1]);
        if !(w > 0.0 && d > 0.0) {
            return None;
        }
        Some(Self {
            centre: [f64::midpoint(lo[0], hi[0]), f64::midpoint(lo[1], hi[1])],
            half: [w / 2.0, d / 2.0],
            roof,
        })
    }

    /// How far out around it things fall (cm).
    pub(crate) fn margin(&self) -> f64 {
        MARGIN.max(MARGIN_SHARE * self.half[0].max(self.half[1]))
    }
}

/// How many particles fall at once, for the preset and how much falls: fewer on old devices.
pub(crate) fn particles(weather: &Weather, quality: QualityPreset) -> u32 {
    let base: [f64; 3] = match weather.fall {
        Fall::None => return 0,
        Fall::Rain | Fall::Sleet => [1_200.0, 3_000.0, 6_000.0],
        Fall::Snow => [900.0, 2_200.0, 4_000.0],
        Fall::Hail => [600.0, 1_500.0, 3_000.0],
    };
    let n = match quality {
        QualityPreset::Eco => base[0],
        QualityPreset::Balanced => base[1],
        QualityPreset::High => base[2],
    };
    let amount = weather.amount.clamp(0.0, 1.0);
    if amount <= 0.0 {
        return 0;
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let count = (n * (0.35 + 0.65 * amount)).round() as u32;
    count
}

/// What falls, as the shaders number it (rain 0, snow 1, hail 2, sleet 3), and its speed (cm/s).
pub(crate) fn fall(weather: &Weather) -> (f32, f32) {
    match weather.fall {
        Fall::None | Fall::Rain => (0.0, 900.0),
        Fall::Snow => (1.0, 70.0),
        Fall::Hail => (2.0, 1_400.0),
        Fall::Sleet => (3.0, 900.0),
    }
}

/// The tint of what falls and how opaque it is, against the ground behind it: a slate blue over a
/// light ground, a pale one over a dark ground (the night, the neon look), so that it shows on both.
pub(crate) fn tint(ground: [f32; 3]) -> [f32; 4] {
    if luma(ground) < 0.42 {
        [0.72, 0.82, 1.0, 0.6]
    } else {
        [0.3, 0.37, 0.48, 0.5]
    }
}

/// The light under clouds: the sun dimmer, the sky and the ground greyer, a little darker. `cover`
/// from 0 (clear) to 1.
pub(crate) fn overcast(light: Lighting, cover: f64) -> Lighting {
    #[allow(clippy::cast_possible_truncation)]
    let k = (cover.clamp(0.0, 1.0) * 0.8) as f32;
    if k <= 0.0 {
        return light;
    }
    let sun = sun_left(cover);
    let grey = |c: [f32; 3], shade: f32| {
        let g = luma(c) * shade;
        c.map(|v| v + (g - v) * k)
    };
    Lighting {
        sky: grey(light.sky, 0.9),
        ground: grey(light.ground, 0.85),
        sun: light.sun.map(|v| v * sun),
        exposure: light.exposure * (1.0 - 0.2 * k),
        ao: light.ao,
    }
}

/// How much of the sun clouds let through, from 1 (clear) down: its light and its shadows.
pub(crate) fn sun_left(cover: f64) -> f32 {
    #[allow(clippy::cast_possible_truncation)]
    let k = (cover.clamp(0.0, 1.0) * 0.8) as f32;
    1.0 - 0.85 * k
}

/// A colour greyed and darkened by clouds, as [`overcast`] greys the sky (for the background).
pub(crate) fn grey(color: [f32; 3], cover: f64) -> [f32; 3] {
    #[allow(clippy::cast_possible_truncation)]
    let cover = cover.clamp(0.0, 1.0) as f32;
    let k = cover * 0.7;
    let g = luma(color) * (1.0 - 0.22 * cover);
    color.map(|v| v + (g - v) * k)
}

/// A colour lit by a storm's flash, from 0 (none) to 1.
pub(crate) fn flashed(color: [f32; 3], flash: f32) -> [f32; 3] {
    color.map(|v| v + (1.0 - v) * flash * 0.5)
}

/// How bright a colour looks.
pub(crate) fn luma(c: [f32; 3]) -> f32 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fewer_fall_on_old_devices_and_in_a_drizzle() {
        let rain = Weather::from_condition("rainy", None, None, 0.0);
        let pouring = Weather::from_condition("pouring", None, None, 0.0);
        let eco = particles(&rain, QualityPreset::Eco);
        assert!(eco > 0 && eco < particles(&rain, QualityPreset::Balanced));
        assert!(particles(&rain, QualityPreset::High) < particles(&pouring, QualityPreset::High));
        assert_eq!(particles(&Weather::CLEAR, QualityPreset::High), 0);
        assert_eq!(
            particles(
                &Weather::from_condition("fog", None, None, 0.0),
                QualityPreset::High
            ),
            0
        );
    }

    #[test]
    fn clouds_grey_the_light_and_a_flash_lights_it() {
        let day = Lighting::default();
        let grey_day = overcast(day, 1.0);
        assert!(grey_day.exposure < day.exposure);
        assert!(grey_day.sun[0] < day.sun[0]);
        assert_eq!(overcast(day, 0.0), day);
        let c = [0.2, 0.4, 0.8];
        let g = grey(c, 1.0);
        assert!((g[2] - g[0]).abs() < (c[2] - c[0]).abs());
        assert_eq!(flashed(c, 0.0), c);
        assert!(flashed(c, 1.0)[0] > c[0]);
        // Over a dark ground what falls is lighter, over a light one darker: it shows on both.
        let rgb = |t: [f32; 4]| [t[0], t[1], t[2]];
        assert!(luma(rgb(tint([0.05, 0.05, 0.1]))) > 0.5);
        assert!(luma(rgb(tint([0.8, 0.85, 0.9]))) < 0.5);
        // Clouds darken a light sky.
        assert!(luma(grey([0.95, 0.96, 0.98], 1.0)) < 0.85);
    }
}
