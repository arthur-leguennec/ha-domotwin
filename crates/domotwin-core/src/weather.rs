//! The weather around the home (`DECISIONS.md`, D-068): what falls, how grey the sky is, the fog,
//! the storm's flashes and the wind, from Home Assistant's `weather` entity. Pure: the renderer
//! draws it, the frontend reads the entity.

/// What falls from the sky.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fall {
    /// Nothing.
    None,
    /// Rain, in streaks.
    Rain,
    /// Snow, in flakes drifting down.
    Snow,
    /// Rain and snow together.
    Sleet,
    /// Hail, in hard, fast grains.
    Hail,
}

/// The weather drawn around the home.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Weather {
    /// What falls.
    pub fall: Fall,
    /// How much falls, 0 (nothing) to 1 (pouring).
    pub amount: f64,
    /// How grey the sky is, 0 (clear) to 1 (dark clouds).
    pub overcast: f64,
    /// How thick the fog is, 0 to 1.
    pub fog: f64,
    /// Whether a storm flashes.
    pub lightning: bool,
    /// The wind over the plan, cm/s: `x` the plan's x, then the plan's y (the scene's `z`).
    pub wind: [f64; 2],
}

/// The strongest wind drawn (cm/s, about 72 km/h): beyond it, what falls would fly sideways.
pub const MAX_WIND: f64 = 2_000.0;

impl Weather {
    /// A clear sky: nothing drawn.
    pub const CLEAR: Self = Self {
        fall: Fall::None,
        amount: 0.0,
        overcast: 0.0,
        fog: 0.0,
        lightning: false,
        wind: [0.0, 0.0],
    };

    /// The weather for one of Home Assistant's conditions (`rainy`, `snowy`…), with its wind:
    /// `wind_speed` in m/s, `wind_bearing` in degrees clockwise from north where the wind comes
    /// from, as Home Assistant gives them, and `north` where north points on the plan (degrees
    /// clockwise from the top of the plan). An unknown condition is a clear sky.
    pub fn from_condition(
        condition: &str,
        wind_speed: Option<f64>,
        wind_bearing: Option<f64>,
        north: f64,
    ) -> Self {
        let (fall, amount, overcast, fog, lightning) = match condition {
            "partlycloudy" => (Fall::None, 0.0, 0.3, 0.0, false),
            "cloudy" => (Fall::None, 0.0, 0.7, 0.0, false),
            "windy" => (Fall::None, 0.0, 0.2, 0.0, false),
            "windy-variant" => (Fall::None, 0.0, 0.5, 0.0, false),
            "exceptional" => (Fall::None, 0.0, 0.5, 0.0, false),
            "fog" => (Fall::None, 0.0, 0.6, 0.8, false),
            "rainy" => (Fall::Rain, 0.5, 0.8, 0.1, false),
            "pouring" => (Fall::Rain, 1.0, 0.9, 0.2, false),
            "lightning" => (Fall::None, 0.0, 0.85, 0.0, true),
            "lightning-rainy" => (Fall::Rain, 0.8, 0.9, 0.15, true),
            "snowy" => (Fall::Snow, 0.6, 0.75, 0.15, false),
            "snowy-rainy" => (Fall::Sleet, 0.6, 0.8, 0.1, false),
            "hail" => (Fall::Hail, 0.7, 0.85, 0.0, false),
            _ => return Self::CLEAR,
        };
        Self {
            fall,
            amount,
            overcast,
            fog,
            lightning,
            wind: wind_on_plan(wind_speed, wind_bearing, north),
        }
    }

    /// Whether it moves, so that frames are needed all the time: something falls, or a storm
    /// flashes.
    pub fn animated(&self) -> bool {
        (self.fall != Fall::None && self.amount > 0.0) || self.lightning
    }
}

/// The wind as it blows over the plan (cm/s, the plan's x then y), from its speed (m/s) and the
/// bearing it comes from (degrees clockwise from north); none when either is unknown.
fn wind_on_plan(speed: Option<f64>, bearing: Option<f64>, north: f64) -> [f64; 2] {
    let (Some(speed), Some(bearing)) = (speed, bearing) else {
        return [0.0, 0.0];
    };
    if !speed.is_finite() || !bearing.is_finite() || speed <= 0.0 {
        return [0.0, 0.0];
    }
    let north = if north.is_finite() { north } else { 0.0 };
    // It blows towards the opposite of where it comes from; the top of the plan is −y.
    let heading = (north + bearing + 180.0).to_radians();
    let cms = (speed * 100.0).min(MAX_WIND);
    [cms * heading.sin(), -cms * heading.cos()]
}

/// How bright a storm's flash is at `time_s` seconds (0 to 1): a bolt in most seven-second
/// spells, at a moment of its own, in two quick flickers.
pub fn flash(time_s: f64) -> f64 {
    if !time_s.is_finite() {
        return 0.0;
    }
    const SPELL: f64 = 7.0;
    let spell = (time_s / SPELL).floor();
    let seed = hash(spell);
    // About two spells in three have a bolt.
    if seed < 0.35 {
        return 0.0;
    }
    let start = spell * SPELL + 0.5 + hash(spell + 0.5) * (SPELL - 1.5);
    let t = time_s - start;
    let pulse = |dt: f64, width: f64| (-(dt / width).powi(2)).exp();
    pulse(t, 0.05)
        .max(0.6 * pulse(t - 0.18, 0.04))
        .max(0.35 * pulse(t - 0.33, 0.08))
}

/// A number from 0 to 1, the same for the same `x`.
fn hash(x: f64) -> f64 {
    let s = (x * 12.989_8 + 78.233).sin() * 43_758.545_3;
    s - s.floor()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conditions_fall_as_they_say() {
        let w = |c: &str| Weather::from_condition(c, None, None, 0.0);
        assert_eq!(w("sunny"), Weather::CLEAR);
        assert_eq!(w("clear-night"), Weather::CLEAR);
        assert_eq!(w("unavailable"), Weather::CLEAR);
        assert_eq!(w("rainy").fall, Fall::Rain);
        assert!(w("pouring").amount > w("rainy").amount);
        assert_eq!(w("snowy").fall, Fall::Snow);
        assert_eq!(w("snowy-rainy").fall, Fall::Sleet);
        assert_eq!(w("hail").fall, Fall::Hail);
        assert!(w("lightning").lightning && w("lightning").animated());
        assert!(w("lightning-rainy").lightning);
        // Clouds and fog are drawn, still.
        assert!(w("cloudy").overcast > 0.5 && !w("cloudy").animated());
        assert!(w("fog").fog > 0.5 && !w("fog").animated());
    }

    #[test]
    fn the_wind_blows_away_from_where_it_comes() {
        let close =
            |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9;
        // From the north at 5 m/s, north at the top of the plan: towards the bottom (+y).
        let from_north = Weather::from_condition("rainy", Some(5.0), Some(0.0), 0.0);
        assert!(close(from_north.wind, [0.0, 500.0]));
        // From the west: towards the east, the plan's +x.
        let from_west = Weather::from_condition("rainy", Some(5.0), Some(270.0), 0.0);
        assert!(close(from_west.wind, [500.0, 0.0]));
        // North pointing right on the plan: a north wind blows towards −x.
        let turned = Weather::from_condition("rainy", Some(5.0), Some(0.0), 90.0);
        assert!(close(turned.wind, [-500.0, 0.0]));
        // A storm's wind is held to what can be drawn; an unknown one is none.
        let gale = Weather::from_condition("pouring", Some(60.0), Some(90.0), 0.0);
        assert!((gale.wind[0].hypot(gale.wind[1]) - MAX_WIND).abs() < 1e-9);
        assert_eq!(
            Weather::from_condition("rainy", None, Some(10.0), 0.0).wind,
            [0.0, 0.0]
        );
        assert_eq!(
            Weather::from_condition("rainy", Some(f64::NAN), Some(10.0), 0.0).wind,
            [0.0, 0.0]
        );
    }

    #[test]
    fn a_storm_flashes_now_and_then() {
        let samples: Vec<f64> = (0..70_000).map(|k| flash(f64::from(k) * 0.01)).collect();
        assert!(samples.iter().all(|f| (0.0..=1.0).contains(f)));
        // Mostly dark, with bright moments.
        let bright = samples.iter().filter(|f| **f > 0.5).count();
        assert!(bright > 0 && bright < samples.len() / 20, "{bright}");
        assert_eq!(flash(f64::NAN), 0.0);
    }
}
