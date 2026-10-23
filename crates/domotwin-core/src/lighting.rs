//! The light of the scene through the day: four moods (morning, day, evening, night) and the
//! blend between them, from the sun's elevation (Home Assistant's `sun.sun`) or the local clock.

/// The ambient light of the scene, in linear RGB.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lighting {
    /// Light from above (the sky).
    pub sky: [f32; 3],
    /// Light bounced from below.
    pub ground: [f32; 3],
    /// The sun (or the moon at night).
    pub sun: [f32; 3],
    /// Exposure before tone mapping.
    pub exposure: f32,
    /// Darkening at the foot of the walls (0–1, lower is darker).
    pub ao: f32,
}

/// A mood of the day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mood {
    /// Soft light, slightly pink and cool.
    Morning,
    /// Warm daylight, clear shadows.
    Day,
    /// Dimmer, the lamps stand out.
    Evening,
    /// Dark blue, moonlight, lamps glowing.
    Night,
}

impl Mood {
    /// Every mood, from morning to night.
    pub const ALL: [Mood; 4] = [Mood::Morning, Mood::Day, Mood::Evening, Mood::Night];

    /// The card option's name.
    pub const fn name(self) -> &'static str {
        match self {
            Mood::Morning => "morning",
            Mood::Day => "day",
            Mood::Evening => "evening",
            Mood::Night => "night",
        }
    }

    /// Reads a card option; anything else (`auto`) gives `None`.
    pub fn from_name(name: &str) -> Option<Mood> {
        Mood::ALL.into_iter().find(|mood| mood.name() == name)
    }

    /// The light of this mood.
    pub const fn lighting(self) -> Lighting {
        match self {
            Mood::Morning => Lighting {
                sky: [0.37, 0.37, 0.42],
                ground: [0.17, 0.15, 0.15],
                sun: [1.45, 1.26, 1.10],
                exposure: 0.62,
                ao: 0.52,
            },
            Mood::Day => Lighting {
                sky: [0.35, 0.34, 0.34],
                ground: [0.17, 0.15, 0.12],
                sun: [1.78, 1.52, 1.18],
                exposure: 0.62,
                ao: 0.48,
            },
            Mood::Evening => Lighting {
                sky: [0.24, 0.26, 0.31],
                ground: [0.11, 0.10, 0.10],
                sun: [0.85, 0.80, 0.74],
                exposure: 0.58,
                ao: 0.50,
            },
            Mood::Night => Lighting {
                sky: [0.13, 0.15, 0.22],
                ground: [0.05, 0.05, 0.07],
                sun: [0.30, 0.36, 0.52],
                exposure: 0.62,
                ao: 0.50,
            },
        }
    }
}

impl Lighting {
    /// The light between `self` (`t` = 0) and `to` (`t` = 1).
    #[allow(clippy::cast_possible_truncation)]
    pub fn lerp(&self, to: &Lighting, t: f64) -> Lighting {
        let t = t.clamp(0.0, 1.0) as f32;
        let mix = |a: f32, b: f32| a + (b - a) * t;
        let mix3 = |a: [f32; 3], b: [f32; 3]| [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
        Lighting {
            sky: mix3(self.sky, to.sky),
            ground: mix3(self.ground, to.ground),
            sun: mix3(self.sun, to.sun),
            exposure: mix(self.exposure, to.exposure),
            ao: mix(self.ao, to.ao),
        }
    }
}

impl Default for Lighting {
    fn default() -> Self {
        Mood::Day.lighting()
    }
}

/// `0` at `a`, `1` at `b`, smooth in between (`a` may be greater than `b`).
fn ramp(x: f64, a: f64, b: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The light for a sun `elevation` (degrees above the horizon), `rising` before noon.
///
/// Rising: night below −8°, then morning from the horizon, day from 25°. Setting: day down to 25°,
/// evening below 10°, night below −8°. Every change is a smooth blend.
pub fn lighting_for_sun(elevation: f64, rising: bool) -> Lighting {
    let elevation = if elevation.is_finite() {
        elevation
    } else {
        45.0
    };
    let night = Mood::Night.lighting();
    let day = Mood::Day.lighting();
    if rising {
        let morning = Mood::Morning.lighting();
        if elevation < 0.0 {
            night.lerp(&morning, ramp(elevation, -8.0, 0.0))
        } else {
            morning.lerp(&day, ramp(elevation, 10.0, 25.0))
        }
    } else {
        let evening = Mood::Evening.lighting();
        if elevation > 10.0 {
            evening.lerp(&day, ramp(elevation, 10.0, 25.0))
        } else {
            night.lerp(&evening, ramp(elevation, -8.0, 0.0))
        }
    }
}

/// The light for a local time of day (`hour` 0–24), when the sun's position is unknown.
pub fn lighting_for_hour(hour: f64) -> Lighting {
    let hour = if hour.is_finite() {
        hour.rem_euclid(24.0)
    } else {
        12.0
    };
    let [morning, day, evening, night] = Mood::ALL.map(Mood::lighting);
    match hour {
        h if h < 5.5 => night,
        h if h < 7.0 => night.lerp(&morning, ramp(h, 5.5, 7.0)),
        h if h < 9.0 => morning,
        h if h < 10.5 => morning.lerp(&day, ramp(h, 9.0, 10.5)),
        h if h < 17.0 => day,
        h if h < 18.5 => day.lerp(&evening, ramp(h, 17.0, 18.5)),
        h if h < 21.0 => evening,
        h if h < 22.5 => evening.lerp(&night, ramp(h, 21.0, 22.5)),
        _ => night,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &Lighting, b: &Lighting) -> bool {
        let d = |x: f32, y: f32| (x - y).abs() < 1e-4;
        (0..3)
            .all(|k| d(a.sky[k], b.sky[k]) && d(a.sun[k], b.sun[k]) && d(a.ground[k], b.ground[k]))
            && d(a.exposure, b.exposure)
            && d(a.ao, b.ao)
    }

    #[test]
    fn names_round_trip() {
        for mood in Mood::ALL {
            assert_eq!(Mood::from_name(mood.name()), Some(mood));
        }
        assert_eq!(Mood::from_name("auto"), None);
    }

    #[test]
    fn the_sun_picks_the_mood() {
        assert!(close(
            &lighting_for_sun(-20.0, true),
            &Mood::Night.lighting()
        ));
        assert!(close(
            &lighting_for_sun(5.0, true),
            &Mood::Morning.lighting()
        ));
        assert!(close(&lighting_for_sun(40.0, true), &Mood::Day.lighting()));
        assert!(close(&lighting_for_sun(40.0, false), &Mood::Day.lighting()));
        assert!(close(
            &lighting_for_sun(5.0, false),
            &Mood::Evening.lighting()
        ));
        assert!(close(
            &lighting_for_sun(-20.0, false),
            &Mood::Night.lighting()
        ));
    }

    #[test]
    fn blends_have_no_jumps() {
        for rising in [true, false] {
            let mut last = lighting_for_sun(-30.0, rising);
            let mut e = -30.0;
            while e <= 60.0 {
                let now = lighting_for_sun(e, rising);
                assert!((now.sun[0] - last.sun[0]).abs() < 0.12, "{e} {rising}");
                last = now;
                e += 0.5;
            }
        }
        let mut last = lighting_for_hour(0.0);
        let mut h = 0.0;
        while h <= 24.0 {
            let now = lighting_for_hour(h);
            assert!((now.sun[0] - last.sun[0]).abs() < 0.12, "{h}");
            last = now;
            h += 0.05;
        }
    }

    #[test]
    fn the_clock_picks_the_mood() {
        assert!(close(&lighting_for_hour(3.0), &Mood::Night.lighting()));
        assert!(close(&lighting_for_hour(8.0), &Mood::Morning.lighting()));
        assert!(close(&lighting_for_hour(13.0), &Mood::Day.lighting()));
        assert!(close(&lighting_for_hour(19.5), &Mood::Evening.lighting()));
        assert!(close(&lighting_for_hour(23.5), &Mood::Night.lighting()));
        assert!(close(&lighting_for_hour(f64::NAN), &Mood::Day.lighting()));
    }
}
