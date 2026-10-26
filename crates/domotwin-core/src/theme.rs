//! The looks of the scene (`docs/DECISIONS.md`, D-027 and D-036): **day** (the home as it is, in
//! the light of the time of day), **neon** (the home at dusk in violet, the tops of its walls lit
//! in the accent, on a ground of dots), **blueprint** (white lines on blue), **cartoon** (flat bright colours in bands of
//! light, inked outlines) and **clay** (an architect's model in matte clay, in the light of the
//! time of day). A look sets the background and the ground, how walls and their outlines are
//! drawn, the furniture's palette, how light falls on it and the glow; the accent colour tints the
//! neon outlines and dots.

use crate::lighting::Lighting;

/// A look of the scene.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThemeName {
    /// The home as it is: opaque walls, the light of the time of day.
    #[default]
    Day,
    /// Dusk (D-048): solid violet walls topped with lit strips in the accent, lamps that shine.
    Neon,
    /// White lines on blue, like an architect's drawing.
    Blueprint,
    /// Flat bright colours in bands of light, inked outlines, a sky and a lawn.
    Cartoon,
    /// An architect's model in matte clay, in the light of the time of day.
    Clay,
}

impl ThemeName {
    /// Every look.
    pub const ALL: [ThemeName; 5] = [
        ThemeName::Day,
        ThemeName::Neon,
        ThemeName::Blueprint,
        ThemeName::Cartoon,
        ThemeName::Clay,
    ];

    /// The option's name.
    pub const fn name(self) -> &'static str {
        match self {
            ThemeName::Day => "day",
            ThemeName::Neon => "neon",
            ThemeName::Blueprint => "blueprint",
            ThemeName::Cartoon => "cartoon",
            ThemeName::Clay => "clay",
        }
    }

    /// Reads an option's name; anything else gives `None`.
    pub fn from_name(name: &str) -> Option<ThemeName> {
        ThemeName::ALL.into_iter().find(|t| t.name() == name)
    }

    /// The look's own accent, when none is chosen (D-048): amber in neon, cyan in the others.
    /// The frontend's `defaultAccent` says the same.
    pub fn default_accent(self) -> [f32; 3] {
        match self {
            ThemeName::Neon => NEON_ACCENT,
            _ => DEFAULT_ACCENT,
        }
    }
}

/// The default accent: a bright cyan.
pub const DEFAULT_ACCENT: [f32; 3] = [0.0, 0.83, 1.0];

/// Neon's own accent: amber, `#ffae45`.
pub const NEON_ACCENT: [f32; 3] = [1.0, 174.0 / 255.0, 69.0 / 255.0];

/// Everything a look sets, colours in sRGB (0–1) unless said otherwise.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Theme {
    /// Which look.
    pub name: ThemeName,
    /// The accent colour.
    pub accent: [f32; 3],
    /// Background at the top of the view and at the horizon.
    pub sky_top: [f32; 3],
    pub sky_horizon: [f32; 3],
    /// The ground around the home, and its grid lines (strength 0–1).
    pub ground: [f32; 3],
    pub grid: [f32; 3],
    pub grid_strength: f32,
    /// Walls of glass (tinted, see-through) rather than opaque.
    pub glass_walls: bool,
    /// Tint and opacity of glass walls, colour of their tops (glass walls only).
    pub wall_tint: [f32; 3],
    pub wall_alpha: f32,
    pub wall_cap: [f32; 3],
    /// Outlines of walls, floors, doors and windows: colour, strength (0: none) and glow.
    pub line: [f32; 3],
    pub line_strength: f32,
    pub line_glow: f32,
    /// Dark lines on a light picture (drawn darkening) rather than light ones (drawn brightening).
    pub dark_lines: bool,
    /// Bloom around what glows (lamps, screens, outlines), 0: none.
    pub bloom: f32,
    /// The bloom is drawn from the Balanced preset up (the night looks, where the glow is the
    /// picture), else on High only.
    pub bloom_on_balanced: bool,
    /// How much furniture and floors take the look's palette (0: their own colours), and it.
    pub tint: f32,
    pub palette: [f32; 3],
    /// The share of `tint` leaves take (1: all of it): neon keeps its plants green (D-048).
    pub leaf_tint: f32,
    pub floor_tint: f32,
    pub floor_palette: [f32; 3],
    /// Light of its own (`None`: the light of the time of day), in linear RGB.
    pub lighting: Option<Lighting>,
    /// Sun shadows (night looks have none).
    pub shadows: bool,
    /// The 2D plan: one colour for every floor (`None`: their own), and the wall tops.
    pub plan_floor: Option<[f32; 3]>,
    pub plan_cap: [f32; 3],
    /// The background is shades of the dashboard's (the day look), not the look's own colours.
    pub sky_from_dashboard: bool,
    /// How light falls and colours show (D-036).
    pub shading: Shading,
    /// Width of the outlines, against the usual width.
    pub line_width: f32,
    /// How strongly the outlines that rise (the corners of walls, the sides of doors and
    /// windows) are drawn against the level ones (1: the same, 0: not at all; D-048).
    pub line_rise: f32,
    /// The ground's grid as dots where its lines cross, rather than lines (D-048).
    pub grid_dots: bool,
    /// Ink around whatever stands out from what is behind it (furniture, people, the home against
    /// the ground), drawn from the depth of the picture: 0 none, 1 full.
    pub outline: f32,
}

/// How light falls and colours show in a look (D-036).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shading {
    /// How the palette keeps each surface's lightness (1: much, 0: one flat colour).
    pub tint_contrast: f32,
    /// How many steps sunlight takes from none to full, as drawn by hand (0: smooth).
    pub bands: f32,
    /// Colours more vivid (above 1) or duller (below 1).
    pub saturation: f32,
    /// How much the floors', walls' and fabrics' patterns are left out (1: flat colours).
    pub flatten: f32,
    /// How dark curved pieces turn where they turn away, seen side on (an ink line, 0: none).
    pub rim_ink: f32,
    /// How much surfaces shine and reflect (1: as they are).
    pub specular: f32,
}

impl Shading {
    /// What the looks of D-027 leave as they are: smooth light, their own colours, their shine.
    pub const PLAIN: Shading = Shading {
        tint_contrast: 1.0,
        bands: 0.0,
        saturation: 1.0,
        flatten: 0.0,
        rim_ink: 0.0,
        specular: 1.0,
    };
}

impl Theme {
    /// Whether the look keeps the light of the time of day (its sky and ground dim at night).
    pub fn follows_time(&self) -> bool {
        self.lighting.is_none()
    }
}

/// The night light of the neon look: dusk violet, lamps standing out.
const NEON_LIGHT: Lighting = Lighting {
    sky: [0.085, 0.065, 0.170],
    ground: [0.020, 0.016, 0.045],
    sun: [0.17, 0.13, 0.30],
    exposure: 1.2,
    ao: 0.55,
};

/// The even light of the blueprint look.
const BLUEPRINT_LIGHT: Lighting = Lighting {
    sky: [0.55, 0.62, 0.80],
    ground: [0.25, 0.30, 0.45],
    sun: [0.35, 0.38, 0.45],
    exposure: 0.75,
    ao: 0.7,
};

/// sRGB from `0xRRGGBB`.
#[allow(clippy::cast_precision_loss)]
const fn hex(rgb: u32) -> [f32; 3] {
    [
        ((rgb >> 16) & 255) as f32 / 255.0,
        ((rgb >> 8) & 255) as f32 / 255.0,
        (rgb & 255) as f32 / 255.0,
    ]
}

impl Theme {
    /// The look `name` with `accent` (sRGB).
    pub fn new(name: ThemeName, accent: [f32; 3]) -> Theme {
        let accent = accent.map(|c| {
            if c.is_finite() {
                c.clamp(0.0, 1.0)
            } else {
                0.0
            }
        });
        match name {
            ThemeName::Day => Theme {
                name,
                accent,
                sky_top: hex(0xeef2f6),
                sky_horizon: hex(0xdfe6ec),
                ground: hex(0xe3e8ec),
                grid: hex(0xb9c4cd),
                grid_strength: 0.18,
                glass_walls: false,
                wall_tint: [1.0; 3],
                wall_alpha: 1.0,
                wall_cap: hex(0x4f564d),
                line: hex(0x2c3a46),
                line_strength: 0.35,
                line_glow: 0.0,
                dark_lines: true,
                bloom: 0.35,
                bloom_on_balanced: false,
                tint: 0.0,
                palette: [0.5; 3],
                leaf_tint: 1.0,
                floor_tint: 0.0,
                floor_palette: [0.5; 3],
                lighting: None,
                shadows: true,
                plan_floor: None,
                plan_cap: hex(0x373b3a),
                sky_from_dashboard: true,
                shading: Shading::PLAIN,
                line_width: 0.9,
                line_rise: 1.0,
                grid_dots: false,
                outline: 0.0,
            },
            // Night over the home (D-048): opaque walls in dusk violet, a strip of light along
            // their tops, a ground of dots, the rooms lit by their lamps.
            ThemeName::Neon => Theme {
                name,
                accent,
                sky_top: hex(0x08071a),
                sky_horizon: hex(0x221a48),
                ground: hex(0x0e0b22),
                grid: accent,
                grid_strength: 0.32,
                glass_walls: false,
                wall_tint: [1.0; 3],
                wall_alpha: 1.0,
                wall_cap: hex(0x2c2552),
                line: accent,
                line_strength: 1.0,
                line_glow: 0.95,
                dark_lines: false,
                bloom: 1.0,
                bloom_on_balanced: true,
                tint: 0.62,
                palette: hex(0x30295a),
                leaf_tint: 0.4,
                floor_tint: 0.62,
                floor_palette: hex(0x1d1838),
                lighting: Some(NEON_LIGHT),
                shadows: false,
                plan_floor: Some(hex(0x17132b)),
                plan_cap: hex(0x2c2552),
                sky_from_dashboard: false,
                shading: Shading::PLAIN,
                line_width: 1.7,
                line_rise: 0.0,
                grid_dots: true,
                outline: 0.0,
            },
            ThemeName::Blueprint => Theme {
                name,
                accent,
                sky_top: hex(0x0b2c63),
                sky_horizon: hex(0x14438f),
                ground: hex(0x123d83),
                grid: [1.0; 3],
                grid_strength: 0.18,
                glass_walls: true,
                wall_tint: [1.0; 3],
                wall_alpha: 0.1,
                wall_cap: hex(0x2a62b5),
                line: hex(0xf2f7ff),
                line_strength: 0.9,
                line_glow: 0.35,
                dark_lines: false,
                bloom: 0.45,
                bloom_on_balanced: true,
                tint: 0.8,
                palette: hex(0x3a73c9),
                leaf_tint: 1.0,
                floor_tint: 0.85,
                floor_palette: hex(0x1d4f9c),
                lighting: Some(BLUEPRINT_LIGHT),
                shadows: false,
                plan_floor: Some(hex(0x16468f)),
                plan_cap: hex(0xf2f7ff),
                sky_from_dashboard: false,
                shading: Shading::PLAIN,
                line_width: 1.2,
                line_rise: 1.0,
                grid_dots: false,
                outline: 0.0,
            },
            ThemeName::Cartoon => Theme {
                name,
                accent,
                sky_top: hex(0x5cbcff),
                sky_horizon: hex(0xd8f1ff),
                ground: hex(0xc4ee9c),
                grid: hex(0x9ad47a),
                grid_strength: 0.0,
                glass_walls: false,
                wall_tint: [1.0; 3],
                wall_alpha: 1.0,
                wall_cap: hex(0x2a2c3a),
                line: hex(0x1b1d29),
                line_strength: 0.95,
                line_glow: 0.0,
                dark_lines: true,
                bloom: 0.3,
                bloom_on_balanced: false,
                tint: 0.0,
                palette: [0.5; 3],
                leaf_tint: 1.0,
                floor_tint: 0.0,
                floor_palette: [0.5; 3],
                lighting: None,
                shadows: true,
                plan_floor: None,
                plan_cap: hex(0x2a2c3a),
                sky_from_dashboard: false,
                shading: Shading {
                    tint_contrast: 1.0,
                    bands: 2.0,
                    saturation: 1.55,
                    flatten: 0.6,
                    rim_ink: 0.85,
                    specular: 0.6,
                },
                line_width: 2.2,
                line_rise: 1.0,
                grid_dots: false,
                outline: 1.0,
            },
            ThemeName::Clay => Theme {
                name,
                accent,
                sky_top: hex(0xf4f1ec),
                sky_horizon: hex(0xe7e1d8),
                ground: hex(0xebe6de),
                grid: hex(0xd3cbbf),
                grid_strength: 0.12,
                glass_walls: false,
                wall_tint: [1.0; 3],
                wall_alpha: 1.0,
                wall_cap: hex(0xcbc2b4),
                line: hex(0x6a6257),
                line_strength: 0.22,
                line_glow: 0.0,
                dark_lines: true,
                bloom: 0.25,
                bloom_on_balanced: false,
                tint: 0.92,
                palette: hex(0xebe4d8),
                leaf_tint: 1.0,
                floor_tint: 0.9,
                floor_palette: hex(0xddd5c8),
                lighting: None,
                shadows: true,
                plan_floor: None,
                plan_cap: hex(0x9c9284),
                sky_from_dashboard: false,
                shading: Shading {
                    tint_contrast: 0.3,
                    bands: 0.0,
                    saturation: 1.0,
                    flatten: 1.0,
                    rim_ink: 0.0,
                    specular: 0.15,
                },
                line_width: 0.8,
                line_rise: 1.0,
                grid_dots: false,
                outline: 0.0,
            },
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Theme::new(ThemeName::Day, DEFAULT_ACCENT)
    }
}

/// Reads a `#rrggbb` colour (sRGB, 0–1).
pub fn parse_hex(text: &str) -> Option<[f32; 3]> {
    let digits = text.trim().strip_prefix('#')?;
    if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(digits, 16).ok().map(hex)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for name in ThemeName::ALL {
            assert_eq!(ThemeName::from_name(name.name()), Some(name));
        }
        assert_eq!(ThemeName::from_name("auto"), None);
    }

    #[test]
    fn neon_is_drawn_with_its_accent() {
        let theme = Theme::new(ThemeName::Neon, [1.0, 0.2, 0.6]);
        assert_eq!(theme.line, [1.0, 0.2, 0.6]);
        assert_eq!(theme.grid, [1.0, 0.2, 0.6]);
        // Dusk: solid walls topped by a lit strip (no upright lines), dots on the ground.
        assert!(!theme.glass_walls && !theme.shadows && theme.lighting.is_some());
        assert!(theme.grid_dots && theme.line_rise < 0.01 && theme.outline < 0.01);
        // Its plants stay green, and its plan's floors are violet; blueprint's plants are blue.
        assert!(theme.leaf_tint < 1.0 && theme.plan_floor.is_some());
        let blueprint = Theme::new(ThemeName::Blueprint, DEFAULT_ACCENT);
        assert!(blueprint.leaf_tint > 0.99 && blueprint.plan_floor.is_some());
        assert!(theme.sky_top.iter().all(|&c| c < 0.15));
        // Each look's own accent.
        assert_eq!(ThemeName::Neon.default_accent(), NEON_ACCENT);
        assert_eq!(parse_hex("#ffae45"), Some(NEON_ACCENT));
        assert_eq!(ThemeName::Day.default_accent(), DEFAULT_ACCENT);
        // An accent out of range is brought back.
        let odd = Theme::new(ThemeName::Neon, [2.0, f32::NAN, -1.0]);
        assert_eq!(odd.accent, [1.0, 0.0, 0.0]);
        // Day keeps its light, opaque walls and shadows.
        let day = Theme::default();
        assert!(!day.glass_walls && day.shadows && day.lighting.is_none() && day.dark_lines);
        assert!(!day.grid_dots && day.line_rise > 0.99 && day.plan_floor.is_none());
    }

    #[test]
    fn cartoon_and_clay_keep_the_time_of_day() {
        let cartoon = Theme::new(ThemeName::Cartoon, DEFAULT_ACCENT);
        assert!(cartoon.follows_time() && cartoon.shadows && !cartoon.bloom_on_balanced);
        let toon = cartoon.shading;
        assert!(toon.bands >= 2.0 && toon.saturation > 1.0 && toon.rim_ink > 0.0);
        assert!(cartoon.line_width > Theme::default().line_width && cartoon.outline > 0.0);
        let clay = Theme::new(ThemeName::Clay, DEFAULT_ACCENT);
        assert!(clay.follows_time() && clay.shadows && !clay.bloom_on_balanced);
        assert!(clay.shading.flatten >= 1.0 && clay.tint > 0.8 && clay.shading.specular < 0.5);
        assert_eq!(clay.shading.bands, 0.0);
        assert_eq!(clay.outline, 0.0);
        // The looks of D-027 are drawn as they were.
        for name in [ThemeName::Day, ThemeName::Neon, ThemeName::Blueprint] {
            let t = Theme::new(name, DEFAULT_ACCENT);
            assert_eq!(t.shading, Shading::PLAIN, "{name:?}");
            assert_eq!(t.outline, 0.0, "{name:?}");
        }
        // Only day takes its background from the dashboard.
        for name in ThemeName::ALL {
            let t = Theme::new(name, DEFAULT_ACCENT);
            assert_eq!(t.sky_from_dashboard, name == ThemeName::Day, "{name:?}");
        }
        assert!(Theme::new(ThemeName::Neon, DEFAULT_ACCENT).bloom_on_balanced);
        assert!(Theme::new(ThemeName::Blueprint, DEFAULT_ACCENT).bloom_on_balanced);
    }

    #[test]
    fn reads_hex_colours() {
        assert_eq!(parse_hex("#00d4ff"), Some([0.0, 212.0 / 255.0, 1.0]));
        assert_eq!(parse_hex(" #FFFFFF "), Some([1.0; 3]));
        assert_eq!(parse_hex("00d4ff"), None);
        assert_eq!(parse_hex("#00d4f"), None);
        assert_eq!(parse_hex("#00d4fg"), None);
    }
}
