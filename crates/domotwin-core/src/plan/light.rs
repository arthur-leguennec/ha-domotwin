//! Lamps: their colour, colour temperature and power.

use super::{Furniture, Kind, Rgb8};

/// Colour of a light without `lightColor` or `lightKelvin`.
pub const DEFAULT_LIGHT_COLOR: Rgb8 = Rgb8 {
    r: 0xff,
    g: 0xd6,
    b: 0xa0,
};
/// Accepted colour temperatures (K).
pub const KELVIN_RANGE: (f64, f64) = (1800.0, 6500.0);
/// Accepted powers (% of the fitting's default).
pub const POWER_RANGE: (f64, f64) = (10.0, 200.0);

/// sRGB of a black body at `kelvin` (Tanner Helland's fit), clamped to 1800–6500 K.
pub fn kelvin_to_rgb(kelvin: f64) -> Rgb8 {
    let kelvin = if kelvin.is_finite() { kelvin } else { 2700.0 };
    let t = kelvin.clamp(KELVIN_RANGE.0, KELVIN_RANGE.1) / 100.0;
    let r = if t <= 66.0 {
        255.0
    } else {
        329.698_727_446 * (t - 60.0).powf(-0.133_204_759_2)
    };
    let g = if t <= 66.0 {
        99.470_802_586_1 * t.ln() - 161.119_568_166_1
    } else {
        288.122_169_528_3 * (t - 60.0).powf(-0.075_514_849_2)
    };
    let b = if t >= 66.0 {
        255.0
    } else if t <= 19.0 {
        0.0
    } else {
        138.517_731_223_1 * (t - 10.0).ln() - 305.044_792_730_7
    };
    let channel = |v: f64| v.round().clamp(0.0, 255.0) as u8;
    Rgb8 {
        r: channel(r),
        g: channel(g),
        b: channel(b),
    }
}

/// Colour of an aquarium's light without `lightColor` or `lightKelvin`: cool, as its lamps are.
pub const AQUARIUM_LIGHT_COLOR: Rgb8 = Rgb8 {
    r: 0xd4,
    g: 0xec,
    b: 0xff,
};

/// The colour a fitting emits: its picked colour, else its temperature's, else its kind's.
pub fn light_color(item: &Furniture) -> Rgb8 {
    item.light_color
        .or_else(|| item.light_kelvin.map(|k| kelvin_to_rgb(f64::from(k))))
        .unwrap_or(if item.kind == Kind::Aquarium {
            AQUARIUM_LIGHT_COLOR
        } else {
            DEFAULT_LIGHT_COLOR
        })
}

/// The fitting's intensity as a factor of its default (1 = 100 %).
pub fn light_power(item: &Furniture) -> f64 {
    item.light_power.map_or(1.0, |p| {
        f64::from(p).clamp(POWER_RANGE.0, POWER_RANGE.1) / 100.0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kelvin_matches_the_format() {
        assert_eq!(kelvin_to_rgb(2700.0).to_hex(), "#ffa757");
        assert_eq!(kelvin_to_rgb(4000.0).to_hex(), "#ffcea6");
        assert_eq!(kelvin_to_rgb(6500.0).to_hex(), "#fffefa");
        assert_eq!(kelvin_to_rgb(100.0), kelvin_to_rgb(1800.0));
        assert_eq!(kelvin_to_rgb(f64::NAN), kelvin_to_rgb(2700.0));
    }

    #[test]
    fn an_aquarium_lights_cool() {
        let plan = crate::plan::read_plan(
            br#"{"format": "domotwin-plan", "version": 1, "items": [
                {"id": "a", "kind": "aquarium", "at": [0, 0], "size": [100, 40, 140]},
                {"id": "b", "kind": "aquarium", "at": [200, 0], "size": [100, 40, 140], "light": {"kelvin": 2700}},
                {"id": "c", "kind": "floor-lamp", "at": [400, 0], "size": [35, 35, 160]}
            ]}"#,
        )
        .unwrap();
        let colors: Vec<Rgb8> = plan.furniture().map(light_color).collect();
        assert_eq!(
            colors,
            [
                AQUARIUM_LIGHT_COLOR,
                kelvin_to_rgb(2700.0),
                DEFAULT_LIGHT_COLOR
            ]
        );
    }
}
