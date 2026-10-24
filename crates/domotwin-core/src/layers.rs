//! The layers drawn over the home (`DECISIONS.md`, D-023): a **heatmap** of one quantity per room
//! (temperature, humidity, CO₂ or fine particles) on a perceptual colour scale, **alerts** pulsing
//! on the floor of their room (warnings amber, dangers red) and **presence** (a room someone is in
//! glows softly). The frontend gathers the values from Home Assistant (areas, device classes,
//! units); the core turns them into colours and into the per-room data the renderer reads.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::plan::{Plan, Rgb8};
use crate::scene::Scene;

/// What a heatmap shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeatKind {
    /// Air temperature (°C).
    Temperature,
    /// Relative humidity (%).
    Humidity,
    /// Carbon dioxide (ppm).
    Co2,
    /// Fine particles PM2.5 (µg/m³).
    Pm25,
}

impl HeatKind {
    /// Every kind, in menu order.
    pub const ALL: [HeatKind; 4] = [
        HeatKind::Temperature,
        HeatKind::Humidity,
        HeatKind::Co2,
        HeatKind::Pm25,
    ];

    /// The name in card options and in the API.
    pub const fn name(self) -> &'static str {
        match self {
            HeatKind::Temperature => "temperature",
            HeatKind::Humidity => "humidity",
            HeatKind::Co2 => "co2",
            HeatKind::Pm25 => "pm25",
        }
    }

    /// Reads a name.
    pub fn from_name(name: &str) -> Option<HeatKind> {
        HeatKind::ALL.into_iter().find(|kind| kind.name() == name)
    }

    /// The unit of the values.
    pub const fn unit(self) -> &'static str {
        match self {
            HeatKind::Temperature => "°C",
            HeatKind::Humidity => "%",
            HeatKind::Co2 => "ppm",
            HeatKind::Pm25 => "µg/m³",
        }
    }

    /// The colour scale: values and their sRGB colours. Cold to hot for temperatures, dry to damp
    /// for humidity, good to bad for the air (with the usual thresholds of indoor air quality).
    pub const fn stops(self) -> &'static [(f64, u32)] {
        match self {
            HeatKind::Temperature => &[
                (14.0, 0x2c_7b_b6),
                (18.0, 0x00_a6_ca),
                (20.0, 0x00_cc_bc),
                (22.0, 0x90_eb_9d),
                (24.0, 0xf9_d0_57),
                (26.0, 0xf2_9e_2e),
                (28.0, 0xe7_68_18),
                (30.0, 0xd7_19_1c),
            ],
            HeatKind::Humidity => &[
                (20.0, 0xe6_61_01),
                (35.0, 0xfd_b8_63),
                (45.0, 0x7f_cd_bb),
                (55.0, 0x41_b6_c4),
                (70.0, 0x2c_7f_b8),
                (85.0, 0x25_34_94),
            ],
            HeatKind::Co2 => &[
                (400.0, 0x1a_98_50),
                (800.0, 0x91_cf_60),
                (1000.0, 0xd9_ef_8b),
                (1200.0, 0xfe_e0_8b),
                (1500.0, 0xfc_8d_59),
                (2000.0, 0xd7_30_27),
            ],
            HeatKind::Pm25 => &[
                (0.0, 0x1a_98_50),
                (10.0, 0x91_cf_60),
                (25.0, 0xfe_e0_8b),
                (50.0, 0xfc_8d_59),
                (75.0, 0xd7_30_27),
                (150.0, 0x7b_32_94),
            ],
        }
    }

    /// The colour of a value, interpolated between the stops in OKLab (even steps to the eye);
    /// values outside the scale take its ends.
    pub fn color(self, value: f64) -> Rgb8 {
        let stops = self.stops();
        let Some(&(first_value, first)) = stops.first() else {
            return Rgb8::from_u32(0x80_80_80);
        };
        if !value.is_finite() || value <= first_value {
            return Rgb8::from_u32(first);
        }
        for pair in stops.windows(2) {
            let [(a, ca), (b, cb)] = [pair[0], pair[1]];
            if value <= b {
                let t = (value - a) / (b - a);
                return mix_oklab(Rgb8::from_u32(ca), Rgb8::from_u32(cb), t);
            }
        }
        Rgb8::from_u32(stops[stops.len() - 1].1)
    }
}

/// How serious an alert is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Alert {
    /// Something to look at (a window open in the rain).
    Warning,
    /// Smoke, gas, carbon monoxide, a water leak, an alarm going off.
    Danger,
}

impl Alert {
    fn from_name(name: &str) -> Option<Alert> {
        match name {
            "warning" => Some(Alert::Warning),
            "danger" => Some(Alert::Danger),
            _ => None,
        }
    }
}

/// What the layers show, by room id.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RoomLayers {
    /// The quantity of the heatmap, when one is shown.
    pub heat: Option<HeatKind>,
    /// Its value in each room that has one.
    pub values: BTreeMap<String, f64>,
    /// Rooms with an alert.
    pub alerts: BTreeMap<String, Alert>,
    /// Rooms someone is in.
    pub presence: BTreeSet<String>,
}

impl RoomLayers {
    /// Whether something is drawn that moves (the heatmap's halo, a pulsing alert).
    pub fn animated(&self) -> bool {
        (self.heat.is_some() && !self.values.is_empty()) || !self.alerts.is_empty()
    }

    /// Whether anything is drawn.
    pub fn shown(&self) -> bool {
        self.animated() || !self.presence.is_empty()
    }
}

/// Colours of a heatmap's legend: its stops and `steps` colours spread evenly from the first
/// stop to the last (for a CSS gradient), as `#rrggbb`.
pub fn legend(kind: HeatKind, steps: usize) -> Vec<(f64, String)> {
    let stops = kind.stops();
    let (Some(&(low, _)), Some(&(high, _))) = (stops.first(), stops.last()) else {
        return Vec::new();
    };
    let steps = steps.max(2);
    #[allow(clippy::cast_precision_loss)]
    (0..steps)
        .map(|i| {
            let value = low + (high - low) * i as f64 / (steps - 1) as f64;
            (value, kind.color(value).to_hex())
        })
        .collect()
}

/// Most rooms read.
const MAX_ROOMS: usize = 1000;

/// Reads the layers from JSON leniently: `{"heat": "temperature", "values": {"living": 21.5},
/// "alerts": {"kitchen": "danger"}, "presence": ["living"]}`.
pub fn read_room_layers(value: &Value) -> RoomLayers {
    let mut layers = RoomLayers {
        heat: value
            .get("heat")
            .and_then(Value::as_str)
            .and_then(HeatKind::from_name),
        ..RoomLayers::default()
    };
    if let Some(values) = value.get("values").and_then(Value::as_object) {
        for (room, v) in values.iter().take(MAX_ROOMS) {
            if let Some(v) = v.as_f64().filter(|v| v.is_finite()) {
                layers.values.insert(room.clone(), v);
            }
        }
    }
    if let Some(alerts) = value.get("alerts").and_then(Value::as_object) {
        for (room, level) in alerts.iter().take(MAX_ROOMS) {
            if let Some(alert) = level.as_str().and_then(Alert::from_name) {
                layers.alerts.insert(room.clone(), alert);
            }
        }
    }
    if let Some(rooms) = value.get("presence").and_then(Value::as_array) {
        layers.presence = rooms
            .iter()
            .take(MAX_ROOMS)
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
    }
    layers
}

/// Texels per room slot in [`room_texels`].
pub const ROOM_TEXELS: usize = 3;

/// A room of a scene, as the layers place it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoomShape<'a> {
    /// Element id.
    pub id: &'a str,
    /// Room slot (1 for the first room).
    pub slot: usize,
    /// The storey (part of the scene) it is on.
    pub storey: usize,
    /// Centre: the mean of its corners (plan x, y).
    pub centre: [f64; 2],
    /// Where its label goes, well inside it (plan x, y).
    pub label: [f64; 2],
    /// Distance from the centre to its farthest corner.
    pub reach: f64,
}

/// The rooms of `scene` (built from `plan`, every storey's for a home) with their slot, centre
/// and reach.
pub fn room_shapes<'a>(plan: &'a Plan, scene: &Scene) -> Vec<RoomShape<'a>> {
    scene
        .storey_walls()
        .enumerate()
        .flat_map(|(storey, (first, layout))| {
            layout.rooms.iter().map(move |walls| (storey, first, walls))
        })
        .filter_map(|(storey, first, walls)| {
            let id = plan.elements.get(first + walls.element)?.id();
            let slot = scene.rooms.iter().position(|r| r == id)? + 1;
            #[allow(clippy::cast_precision_loss)]
            let n = walls.points.len().max(1) as f64;
            let cx = walls.points.iter().map(|p| p[0]).sum::<f64>() / n;
            let cz = walls.points.iter().map(|p| p[1]).sum::<f64>() / n;
            let reach = walls
                .points
                .iter()
                .map(|p| (p[0] - cx).hypot(p[1] - cz))
                .fold(0.0, f64::max);
            Some(RoomShape {
                id,
                slot,
                storey,
                centre: [cx, cz],
                label: scene.labels.get(slot - 1).copied().unwrap_or([cx, cz]),
                reach,
            })
        })
        .collect()
}

/// What the renderer reads for each room slot (slot 0, no room, first): the heatmap colour
/// (linear) and strength; the centre and reach of the room (its halo) and its alert (0 none, 0.5
/// warning, 1 danger); presence.
#[allow(clippy::cast_possible_truncation)]
pub fn room_texels(plan: &Plan, scene: &Scene, layers: &RoomLayers) -> Vec<[f32; 4]> {
    let mut texels = vec![[0.0; 4]; ROOM_TEXELS * (scene.rooms.len() + 1)];
    for room in room_shapes(plan, scene) {
        let at = ROOM_TEXELS * room.slot;
        if let (Some(kind), Some(value)) = (layers.heat, layers.values.get(room.id)) {
            let [r, g, b] = kind.color(*value).to_linear();
            texels[at] = [r, g, b, 1.0];
        }
        let alert = match layers.alerts.get(room.id) {
            Some(Alert::Danger) => 1.0,
            Some(Alert::Warning) => 0.5,
            None => 0.0,
        };
        let [cx, cz] = room.centre;
        texels[at + 1] = [cx as f32, cz as f32, room.reach.max(1.0) as f32, alert];
        if layers.presence.contains(room.id) {
            texels[at + 2][0] = 1.0;
        }
    }
    texels
}

// ---------------------------------------------------------------- colour

fn srgb_to_linear(c: u8) -> f64 {
    let c = f64::from(c) / 255.0;
    if c <= 0.040_45 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn linear_to_srgb(c: f64) -> u8 {
    let c = c.clamp(0.0, 1.0);
    let s = if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round() as u8
}

/// sRGB to OKLab (Björn Ottosson, 2020).
fn oklab(c: Rgb8) -> [f64; 3] {
    let [r, g, b] = [c.r, c.g, c.b].map(srgb_to_linear);
    let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
    let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
    let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
    [
        0.210_454_255_3 * l + 0.793_617_785_0 * m - 0.004_072_046_8 * s,
        1.977_998_495_1 * l - 2.428_592_205_0 * m + 0.450_593_709_9 * s,
        0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766_0 * s,
    ]
}

fn from_oklab([l, a, b]: [f64; 3]) -> Rgb8 {
    let l_ = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b).powi(3);
    let m_ = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b).powi(3);
    let s_ = (l - 0.089_484_177_5 * a - 1.291_485_548_0 * b).powi(3);
    Rgb8 {
        r: linear_to_srgb(4.076_741_662_1 * l_ - 3.307_711_591_3 * m_ + 0.230_969_929_2 * s_),
        g: linear_to_srgb(-1.268_438_004_6 * l_ + 2.609_757_401_1 * m_ - 0.341_319_396_5 * s_),
        b: linear_to_srgb(-0.004_196_086_3 * l_ - 0.703_418_614_7 * m_ + 1.707_614_701_0 * s_),
    }
}

/// `a` to `b` by `t` (0–1) in OKLab.
fn mix_oklab(a: Rgb8, b: Rgb8, t: f64) -> Rgb8 {
    let t = t.clamp(0.0, 1.0);
    let (a, b) = (oklab(a), oklab(b));
    from_oklab([0, 1, 2].map(|k| a[k] + (b[k] - a[k]) * t))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{SceneOptions, build_scene};

    const DEMO: &str = include_str!("../../../examples/demo-apartment.domotwin.json");

    #[test]
    fn scales_follow_their_stops() {
        for kind in HeatKind::ALL {
            assert_eq!(HeatKind::from_name(kind.name()), Some(kind));
            let stops = kind.stops();
            assert!(stops.windows(2).all(|p| p[0].0 < p[1].0), "{kind:?} rising");
            for &(value, color) in stops {
                assert_eq!(kind.color(value), Rgb8::from_u32(color));
            }
            // Ends hold outside the scale.
            assert_eq!(kind.color(-1e9), Rgb8::from_u32(stops[0].1));
            assert_eq!(kind.color(1e9), Rgb8::from_u32(stops[stops.len() - 1].1));
            assert_eq!(kind.color(f64::NAN), Rgb8::from_u32(stops[0].1));
        }
        assert_eq!(HeatKind::from_name("noise"), None);
        // Half way between two stops is between them.
        let mid = HeatKind::Temperature.color(21.0);
        assert!(mid.g > 0xcc && mid.r < 0x90, "{mid:?}");
    }

    #[test]
    fn oklab_round_trips() {
        for c in [0x00_00_00, 0xff_ff_ff, 0x12_34_56, 0xd7_19_1c, 0x80_80_80] {
            let rgb = Rgb8::from_u32(c);
            assert_eq!(from_oklab(oklab(rgb)), rgb);
        }
    }

    #[test]
    fn reads_layers_leniently() {
        let layers = read_room_layers(&serde_json::json!({
            "heat": "temperature",
            "values": { "living": 21.5, "bad": "x", "kitchen": 26 },
            "alerts": { "kitchen": "danger", "hall": "warning", "bath": "panic" },
            "presence": ["living", 3]
        }));
        assert_eq!(layers.heat, Some(HeatKind::Temperature));
        assert_eq!(layers.values.len(), 2);
        assert_eq!(layers.alerts.len(), 2);
        assert_eq!(layers.presence.len(), 1);
        assert!(layers.animated());
        assert!(!read_room_layers(&Value::Null).animated());
        let still = read_room_layers(&serde_json::json!({ "presence": ["living"] }));
        assert!(!still.animated(), "presence does not move");
        assert!(still.shown());
        // A heatmap without values draws nothing.
        assert!(!read_room_layers(&serde_json::json!({ "heat": "co2" })).shown());
    }

    #[test]
    fn legends_run_from_the_first_stop_to_the_last() {
        let colors = legend(HeatKind::Temperature, 5);
        assert_eq!(colors.len(), 5);
        assert_eq!(colors[0], (14.0, "#2c7bb6".to_owned()));
        assert_eq!(colors[4], (30.0, "#d7191c".to_owned()));
        assert_eq!(colors[2].0, 22.0);
        assert_eq!(colors[2].1, "#90eb9d");
        assert_eq!(legend(HeatKind::Co2, 0).len(), 2);
    }

    #[test]
    fn texels_per_room_slot() {
        let plan = crate::read_plan(DEMO.as_bytes()).unwrap();
        let scene = build_scene(&plan, &SceneOptions::default());
        let layers = read_room_layers(&serde_json::json!({
            "heat": "co2",
            "values": { "living": 2500 },
            "alerts": { "living": "danger" },
            "presence": ["living"]
        }));
        let texels = room_texels(&plan, &scene, &layers);
        assert_eq!(texels.len(), ROOM_TEXELS * (scene.rooms.len() + 1));
        let slot = scene.rooms.iter().position(|r| r == "living").unwrap() + 1;
        let at = ROOM_TEXELS * slot;
        let red = HeatKind::Co2.color(2000.0).to_linear();
        assert_eq!(texels[at], [red[0], red[1], red[2], 1.0]);
        // The living room of the demo: 520 × 420 cm from the origin.
        assert_eq!(texels[at + 1][0], 260.0);
        assert_eq!(texels[at + 1][1], 210.0);
        assert!((texels[at + 1][2] - 334.2).abs() < 0.5);
        assert_eq!(texels[at + 1][3], 1.0);
        assert_eq!(texels[at + 2][0], 1.0);
        // Other rooms: no heat, no alert, no presence; slot 0 empty.
        let other = ROOM_TEXELS * if slot == 1 { 2 } else { 1 };
        assert_eq!(texels[other][3], 0.0);
        assert_eq!(texels[other + 1][3], 0.0);
        assert_eq!(texels[0], [0.0; 4]);
    }
}
