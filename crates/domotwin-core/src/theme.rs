//! The looks of the scene (`docs/DECISIONS.md`, D-027): **day** (the home as it is, in the light
//! of the time of day), **neon** (a night view of glass walls with glowing outlines over a grid)
//! and **blueprint** (white lines on blue). A look sets the background and the ground, how walls
//! and their outlines are drawn, the furniture's palette and the glow; the accent colour tints the
//! neon outlines and grid.

use crate::lighting::Lighting;

/// A look of the scene.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThemeName {
    /// The home as it is: opaque walls, the light of the time of day.
    #[default]
    Day,
    /// Night: glass walls, glowing outlines in the accent colour, lamps that shine.
    Neon,
    /// White lines on blue, like an architect's drawing.
    Blueprint,
}

impl ThemeName {
    /// Every look.
    pub const ALL: [ThemeName; 3] = [ThemeName::Day, ThemeName::Neon, ThemeName::Blueprint];

    /// The option's name.
    pub const fn name(self) -> &'static str {
        match self {
            ThemeName::Day => "day",
            ThemeName::Neon => "neon",
            ThemeName::Blueprint => "blueprint",
        }
    }

    /// Reads an option's name; anything else gives `None`.
    pub fn from_name(name: &str) -> Option<ThemeName> {
        ThemeName::ALL.into_iter().find(|t| t.name() == name)
    }
}

/// The default accent: a bright cyan.
pub const DEFAULT_ACCENT: [f32; 3] = [0.0, 0.83, 1.0];

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
    /// Tint and opacity of glass walls, colour of their tops.
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
    /// How much furniture and floors take the look's palette (0: their own colours), and it.
    pub tint: f32,
    pub palette: [f32; 3],
    pub floor_tint: f32,
    pub floor_palette: [f32; 3],
    /// Light of its own (`None`: the light of the time of day), in linear RGB.
    pub lighting: Option<Lighting>,
    /// Sun shadows (night looks have none).
    pub shadows: bool,
    /// The 2D plan: floors and wall tops.
    pub plan_floor: [f32; 3],
    pub plan_cap: [f32; 3],
}

/// The night light of the neon look: dark blue, lamps standing out.
const NEON_LIGHT: Lighting = Lighting {
    sky: [0.050, 0.075, 0.150],
    ground: [0.015, 0.022, 0.045],
    sun: [0.10, 0.14, 0.26],
    exposure: 1.15,
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
                tint: 0.0,
                palette: [0.5; 3],
                floor_tint: 0.0,
                floor_palette: [0.5; 3],
                lighting: None,
                shadows: true,
                plan_floor: [0.0; 3],
                plan_cap: hex(0x373b3a),
            },
            ThemeName::Neon => Theme {
                name,
                accent,
                sky_top: hex(0x060a14),
                sky_horizon: hex(0x15213b),
                ground: hex(0x0a1222),
                grid: accent,
                grid_strength: 0.09,
                glass_walls: true,
                wall_tint: lighten(accent, 0.55),
                wall_alpha: 0.06,
                wall_cap: hex(0x0f1b30),
                line: accent,
                line_strength: 1.0,
                line_glow: 0.85,
                dark_lines: false,
                bloom: 1.0,
                tint: 0.55,
                palette: hex(0x2a3a5c),
                floor_tint: 0.85,
                floor_palette: hex(0x141d30),
                lighting: Some(NEON_LIGHT),
                shadows: false,
                plan_floor: hex(0x111b2e),
                plan_cap: hex(0x0f1b30),
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
                tint: 0.8,
                palette: hex(0x3a73c9),
                floor_tint: 0.85,
                floor_palette: hex(0x1d4f9c),
                lighting: Some(BLUEPRINT_LIGHT),
                shadows: false,
                plan_floor: hex(0x16468f),
                plan_cap: hex(0xf2f7ff),
            },
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Theme::new(ThemeName::Day, DEFAULT_ACCENT)
    }
}

/// `c` moved towards white by `k` (0–1).
fn lighten(c: [f32; 3], k: f32) -> [f32; 3] {
    c.map(|v| v + (1.0 - v) * k)
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
        assert!(theme.glass_walls && !theme.shadows && theme.lighting.is_some());
        // An accent out of range is brought back.
        let odd = Theme::new(ThemeName::Neon, [2.0, f32::NAN, -1.0]);
        assert_eq!(odd.accent, [1.0, 0.0, 0.0]);
        // Day keeps its light, opaque walls and shadows.
        let day = Theme::default();
        assert!(!day.glass_walls && day.shadows && day.lighting.is_none() && day.dark_lines);
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
