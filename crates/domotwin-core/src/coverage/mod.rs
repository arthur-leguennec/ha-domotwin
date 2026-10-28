//! The placement advisor (`DECISIONS.md`, D-066): how well each room is covered by the home's
//! Bluetooth receivers, Zigbee routers or Wi-Fi access points, and where the next one helps most.
//!
//! The model is the locating's (D-035), for each radio: the signal falls with the distance and
//! with each wall and floor in the way, worked out over a few points of each room. What was
//! measured comes before what is predicted: a room measured shows what was measured, and the
//! measurements move the model when they say it is off. The frontend hands over, for one radio:
//!
//! ```json
//! { "radio": "bluetooth" | "zigbee" | "wifi",
//!   "storeys": [{ "id": "ground", "elevation": 0, "plan": {…}, "layout": {…} }],
//!   "radios": [{ "id": "AA:BB…", "storey": "ground", "at": [250, 300], "z": 120 },
//!              { "id": "00:12…", "piece": "floor-lamp" }],
//!   "measured": [{ "room": "hall", "signal": -78.5, "radio": "AA:BB…", "readings": 40 },
//!                { "piece": "washer", "level": "weak", "name": "Washing machine plug" }],
//!   "spots": 3 }
//! ```
//!
//! It is read leniently: what is missing or malformed is left out, never refused.

pub mod home;

use serde::{Serialize, Serializer};
use serde_json::Value;

use home::{Home, Point, RADIO_AT, Spot, number, point};

/// How fast the signal falls with the distance indoors (the log-distance law, D-035).
pub const EXPONENT: f64 = 2.2;
/// What a wall and a floor take away (dB).
pub const WALL_DB: f64 = 4.0;
pub const FLOOR_DB: f64 = 15.0;
/// The model is moved by what was measured this much at most (dB).
pub const MAX_OFFSET: f64 = 12.0;
/// A room a receiver learned from fewer readings than this is not measured (the plan counts as
/// eight, D-035).
pub const LEARNED_ENOUGH: f64 = 8.0;
/// Spots advised by default, and at most.
const DEFAULT_SPOTS: usize = 3;
const MAX_SPOTS: usize = 10;
/// Each room offers its middle and this many of its points as spots.
const SPOTS_PER_ROOM: usize = 4;
/// Spots this close to one already offered are the same (cm).
const SAME_SPOT: f64 = 30.0;
/// A piece this close to a spot, in its room, is the one it stands by (cm).
const NEAR_PIECE: f64 = 150.0;
/// A room's signal raised by more than this counts no more (dB), in a room not covered well.
const GAIN_CAP_DB: f64 = 20.0;
/// What a room no radio reaches is taken to hear (dBm).
const SILENCE_DB: f64 = -130.0;
/// Beyond this many rooms, each is weighed from fewer points and offers its middle alone: the
/// advice then takes tens of milliseconds, not hundreds.
const MANY_ROOMS: usize = 24;
const FEW_POINTS: usize = 4;
/// Most radios and measurements read.
const MAX_RADIOS: usize = 256;
const MAX_MEASURED: usize = 2_000;
/// Longest id or name kept (characters).
const MAX_TEXT: usize = 100;
/// Pieces no radio stands by: the finishes of a room, and what hangs from its ceiling or walls.
const NOT_BY: [&str; 19] = [
    "grey-wood",
    "oak",
    "painted-wood",
    "beige-tiles",
    "white-tiles",
    "wainscot",
    "chair-rail",
    "backsplash",
    "bulkhead",
    "curtain",
    "picture",
    "picture-wall",
    "mirror",
    "hood",
    "chandelier",
    "pendant",
    "spotlight",
    "ceiling-light",
    "ceiling-fan",
];

/// A kind of radio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Radio {
    /// A phone, a watch or a tag heard by a receiver (D-035).
    Bluetooth,
    /// A device heard by the coordinator or a router (D-031).
    Zigbee,
    /// An access point heard by a device.
    Wifi,
}

impl Radio {
    /// Reads a name (`bluetooth`, `zigbee`, `wifi`).
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "bluetooth" => Some(Radio::Bluetooth),
            "zigbee" => Some(Radio::Zigbee),
            "wifi" => Some(Radio::Wifi),
            _ => None,
        }
    }

    /// What is heard a metre away (dBm).
    pub const fn at_1m(self) -> f64 {
        match self {
            Radio::Bluetooth => -59.0,
            Radio::Zigbee => -45.0,
            Radio::Wifi => -35.0,
        }
    }

    /// The least signal (dBm) that is good, fair and weak; below it, out of reach.
    pub const fn thresholds(self) -> [f64; 3] {
        match self {
            Radio::Bluetooth => [-80.0, -90.0, -100.0],
            Radio::Zigbee => [-75.0, -85.0, -95.0],
            Radio::Wifi => [-67.0, -75.0, -85.0],
        }
    }

    /// The least signal of a level (dBm): out of reach, what nothing hears.
    pub const fn least(self, level: Level) -> f64 {
        let [good, fair, weak] = self.thresholds();
        match level {
            Level::Good => good,
            Level::Fair => fair,
            Level::Weak => weak,
            Level::Out => SILENCE_DB,
        }
    }

    /// Whether the next one must itself be reached by one already there: a router joins the
    /// mesh through its neighbours, an access point without a cable through the first one.
    const fn needs_reach(self) -> bool {
        matches!(self, Radio::Zigbee | Radio::Wifi)
    }

    /// What a radio at `radio` and a device at `place` hear of each other, by the plan (dBm):
    /// the walls are counted on `place`'s storey, as the locating counts them.
    pub fn signal(self, home: &Home, place: &Spot, radio: &Spot) -> f64 {
        #[allow(clippy::cast_precision_loss)]
        let floors = home.floors(place, radio) as f64;
        self.at_1m()
            - 10.0 * EXPONENT * place.metres(radio).max(0.5).log10()
            - WALL_DB * home.walls(place, radio)
            - FLOOR_DB * floors
    }
}

/// How well a place is covered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    /// Nothing heard, or too faint to count on.
    Out,
    Weak,
    Fair,
    Good,
}

impl Level {
    /// The level of a signal (dBm) for a radio.
    pub fn of(radio: Radio, signal: f64) -> Self {
        let [good, fair, weak] = radio.thresholds();
        if signal >= good {
            Level::Good
        } else if signal >= fair {
            Level::Fair
        } else if signal >= weak {
            Level::Weak
        } else {
            Level::Out
        }
    }

    /// The name in the advice.
    pub const fn name(self) -> &'static str {
        match self {
            Level::Out => "out",
            Level::Weak => "weak",
            Level::Fair => "fair",
            Level::Good => "good",
        }
    }

    /// Reads a name (the network map's qualities read the same, D-031).
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "out" => Some(Level::Out),
            "weak" => Some(Level::Weak),
            "fair" => Some(Level::Fair),
            "good" => Some(Level::Good),
            _ => None,
        }
    }

    /// Its rank, from 0 (out of reach) to 3 (good): the steps between two levels.
    pub const fn rank(self) -> u8 {
        self as u8
    }
}

impl Serialize for Level {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.name())
    }
}

/// What was measured in a room.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Measured {
    pub level: Level,
    /// The signal (dBm), where one was measured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<f64>,
    /// What measured it (a device, a receiver).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// How well a room is covered.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RoomCoverage {
    pub id: String,
    pub storey: String,
    /// What was measured, else what is predicted.
    pub level: Level,
    /// The signal the model predicts (dBm, moved by what was measured), with no radio none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicted: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measured: Option<Measured>,
}

/// A radio of the advice, where it stands.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlacedRadio {
    pub id: String,
    pub storey: String,
    pub at: Point,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room: Option<String>,
}

/// What a spot changes in a room.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Change {
    pub room: String,
    pub from: Level,
    pub to: Level,
}

/// Where the next radio helps, and what it changes.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AdvisedSpot {
    pub storey: String,
    pub at: Point,
    pub room: String,
    /// The piece it stands by, if one is near.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub near: Option<String>,
    /// What the radios already there give it (dBm), where there are some.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reach: Option<f64>,
    /// The rooms whose level rises, the biggest rise first.
    pub changes: Vec<Change>,
}

/// How far off the model is where signals were measured.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Check {
    /// How many signals were measured where the model predicts one.
    pub measurements: usize,
    /// What the predictions were moved by (dB).
    pub offset: f64,
    /// How far off they still are, on average (dB).
    pub error: f64,
}

/// In how many rooms both measured and predicted the two agree (Zigbee measures levels only).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Agreement {
    pub rooms: usize,
    pub same: usize,
}

/// The advice for one radio.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Advice {
    pub rooms: Vec<RoomCoverage>,
    pub radios: Vec<PlacedRadio>,
    pub spots: Vec<AdvisedSpot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check: Option<Check>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agreement: Option<Agreement>,
}

impl Advice {
    /// As JSON.
    pub fn write(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// A measurement read: its room, what it says, and the model's error there.
#[derive(Debug, Clone)]
struct Reading {
    room: usize,
    measured: Measured,
    error: Option<f64>,
}

fn text(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    (!text.is_empty()).then(|| text.chars().take(MAX_TEXT).collect())
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn mean(values: impl Iterator<Item = f64>) -> Option<f64> {
    let (sum, n) = values.fold((0.0, 0_u32), |(s, n), v| (s + v, n + 1));
    (n > 0).then(|| sum / f64::from(n))
}

fn median(values: &mut [f64]) -> Option<f64> {
    values.sort_by(f64::total_cmp);
    let n = values.len();
    match n {
        0 => None,
        _ if n % 2 == 1 => Some(values[n / 2]),
        _ => Some(f64::midpoint(values[n / 2 - 1], values[n / 2])),
    }
}

/// Up to `k` of `items`, spread evenly, the first and the last among them.
fn spread<T: Clone>(items: &[T], k: usize) -> Vec<T> {
    let n = items.len();
    if n <= k {
        return items.to_vec();
    }
    if k <= 1 {
        return items.iter().take(k).cloned().collect();
    }
    (0..k)
        .filter_map(|i| items.get(i * (n - 1) / (k - 1)).cloned())
        .collect()
}

/// A place given by a piece, or by a storey and a point (and a height on the storeys'
/// elevations, as [`Spot::z`]; [`RADIO_AT`] above its own floor without).
fn place_of(home: &Home, value: &Value) -> Option<Spot> {
    if let (Some(storey), Some([x, y])) = (
        value
            .get("storey")
            .and_then(Value::as_str)
            .and_then(|id| home.storey_index(id)),
        point(value.get("at")),
    ) {
        let floor = home.elevations.get(storey).copied().unwrap_or(0.0);
        let z = number(value.get("z")).unwrap_or(floor + RADIO_AT);
        return Some(Spot { storey, x, y, z });
    }
    let piece = value.get("piece").and_then(Value::as_str)?;
    home.pieces.get(piece).map(|p| p.spot)
}

/// The advice for the radio and home of `input` (see the module's documentation).
pub fn advise(input: &Value) -> Advice {
    let Some(radio) = input
        .get("radio")
        .and_then(Value::as_str)
        .and_then(Radio::from_name)
    else {
        return Advice::default();
    };
    let home = Home::read(input.get("storeys").unwrap_or(&Value::Null));
    let many = home.rooms.len() > MANY_ROOMS;
    let points: Vec<Vec<Spot>> = (0..home.rooms.len())
        .map(|room| {
            let points = home.points(room);
            if many {
                spread(&points, FEW_POINTS)
            } else {
                points
            }
        })
        .collect();
    let radios: Vec<(String, Spot)> = input
        .get("radios")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_RADIOS)
        .filter_map(|r| Some((text(r.get("id")).unwrap_or_default(), place_of(&home, r)?)))
        .collect();
    let storey_id = |storey: usize| home.storey_ids.get(storey).cloned().unwrap_or_default();
    // The best radio's signal at a place, and in a room (the mean over its points).
    let best_at = |place: &Spot| {
        radios
            .iter()
            .map(|(_, r)| radio.signal(&home, place, r))
            .reduce(f64::max)
    };
    let room_mean =
        |room: usize, of: &dyn Fn(&Spot) -> Option<f64>| mean(points[room].iter().filter_map(of));
    let predicted: Vec<Option<f64>> = (0..home.rooms.len())
        .map(|room| room_mean(room, &best_at))
        .collect();

    // What was measured, and how far off the model is there.
    let mut readings: Vec<Reading> = Vec::new();
    for item in input
        .get("measured")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_MEASURED)
    {
        if number(item.get("readings")).is_some_and(|n| n < LEARNED_ENOUGH) {
            continue;
        }
        let by_room = item
            .get("room")
            .and_then(Value::as_str)
            .and_then(|id| home.room_index(id));
        let place = if by_room.is_some() {
            None
        } else {
            place_of(&home, item)
        };
        let Some(room) = by_room.or_else(|| place.and_then(|p| home.room_at(p.storey, [p.x, p.y])))
        else {
            continue;
        };
        let signal = number(item.get("signal"));
        let level = item
            .get("level")
            .and_then(Value::as_str)
            .and_then(Level::from_name)
            .or_else(|| signal.map(|s| Level::of(radio, s)));
        let Some(level) = level else { continue };
        let measuring = text(item.get("radio"))
            .and_then(|id| radios.iter().find(|(r, _)| *r == id).map(|(_, spot)| *spot));
        let expected = match (measuring, place) {
            // What this receiver should hear in this room.
            (Some(r), _) => room_mean(room, &|p| Some(radio.signal(&home, p, &r))),
            // What the best radio gives where the device stands.
            (None, Some(p)) => best_at(&p),
            (None, None) => predicted[room],
        };
        readings.push(Reading {
            room,
            error: signal.zip(expected).map(|(s, e)| s - e),
            measured: Measured {
                level,
                signal: signal.map(round1),
                name: text(item.get("name")),
            },
        });
    }
    let mut errors: Vec<f64> = readings.iter().filter_map(|r| r.error).collect();
    let check = (!errors.is_empty()).then(|| {
        let offset = if errors.len() >= 2 {
            median(&mut errors)
                .unwrap_or(0.0)
                .clamp(-MAX_OFFSET, MAX_OFFSET)
        } else {
            0.0
        };
        let error = mean(errors.iter().map(|e| (e - offset).abs())).unwrap_or(0.0);
        Check {
            measurements: errors.len(),
            offset: round1(offset),
            error: round1(error),
        }
    });
    let offset = check.as_ref().map_or(0.0, |c| c.offset);

    // Each room: what was measured first (the best of it), else what is predicted.
    let mut measured: Vec<Option<Measured>> = vec![None; home.rooms.len()];
    for reading in readings {
        let slot = &mut measured[reading.room];
        let better = slot.as_ref().is_none_or(|m| {
            (
                reading.measured.level,
                reading.measured.signal.unwrap_or(f64::NEG_INFINITY),
            ) > (m.level, m.signal.unwrap_or(f64::NEG_INFINITY))
        });
        if better {
            *slot = Some(reading.measured);
        }
    }
    let corrected: Vec<Option<f64>> = predicted.iter().map(|p| p.map(|s| s + offset)).collect();
    let levels: Vec<Level> = (0..home.rooms.len())
        .map(|room| {
            measured[room].as_ref().map_or_else(
                || corrected[room].map_or(Level::Out, |s| Level::of(radio, s)),
                |m| m.level,
            )
        })
        .collect();
    let agreement = (radio == Radio::Zigbee && !radios.is_empty()).then(|| {
        let both: Vec<(Level, Level)> = (0..home.rooms.len())
            .filter_map(|room| {
                Some((
                    measured[room].as_ref()?.level,
                    Level::of(radio, corrected[room]?),
                ))
            })
            .collect();
        Agreement {
            rooms: both.len(),
            same: both.iter().filter(|(m, p)| m == p).count(),
        }
    });
    let rooms = home
        .rooms
        .iter()
        .enumerate()
        .map(|(k, room)| RoomCoverage {
            id: room.id.clone(),
            storey: storey_id(room.storey),
            level: levels[k],
            predicted: corrected[k].map(round1),
            measured: measured[k].clone(),
        })
        .collect();
    let placed = radios
        .iter()
        .map(|(id, spot)| PlacedRadio {
            id: id.clone(),
            storey: storey_id(spot.storey),
            at: [round1(spot.x), round1(spot.y)],
            room: home
                .room_at(spot.storey, [spot.x, spot.y])
                .map(|r| home.rooms[r].id.clone()),
        })
        .collect();

    // The spots: what each would change, the best of each room, then the best of all.
    let wanted = input
        .get("spots")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_SPOTS, |n| usize::try_from(n).unwrap_or(MAX_SPOTS))
        .min(MAX_SPOTS);
    // What each room has now: what was measured, else what is predicted; a room measured by its
    // level alone (Zigbee) has the least of its level.
    let current: Vec<f64> = (0..home.rooms.len())
        .map(|room| match &measured[room] {
            Some(m) => m.signal.unwrap_or_else(|| radio.least(m.level)),
            None => corrected[room].unwrap_or(SILENCE_DB),
        })
        .collect();
    let areas: Vec<f64> = home.rooms.iter().map(home::Room::area).collect();
    let mut best: Vec<(u32, f64, usize, AdvisedSpot)> = Vec::new();
    for (r, room) in home.rooms.iter().enumerate() {
        let floor = home.elevations.get(room.storey).copied().unwrap_or(0.0);
        let mut offered: Vec<Spot> = home.middle_of(&points[r]).into_iter().collect();
        if !many {
            for p in spread(&points[r], SPOTS_PER_ROOM) {
                let spot = Spot {
                    z: floor + RADIO_AT,
                    ..p
                };
                if offered
                    .iter()
                    .all(|o| (o.x - spot.x).hypot(o.y - spot.y) > SAME_SPOT)
                {
                    offered.push(spot);
                }
            }
        }
        let mut kept: Option<(u32, f64, AdvisedSpot)> = None;
        for spot in offered {
            let reach = best_at(&spot).map(|s| s + offset);
            if radio.needs_reach() && reach.is_some_and(|s| Level::of(radio, s) < Level::Fair) {
                continue;
            }
            let mut worth = 0_u32;
            let mut added = 0.0;
            let mut changes: Vec<(u8, usize, Change)> = Vec::new();
            for (q, other) in home.rooms.iter().enumerate() {
                let Some(alone) = room_mean(q, &|p| Some(radio.signal(&home, p, &spot))) else {
                    continue;
                };
                let alone = alone + offset;
                let before = levels[q];
                let after = before.max(Level::of(radio, alone));
                if after > before {
                    let rise = after.rank() - before.rank();
                    worth += u32::from(rise) * if measured[q].is_some() { 2 } else { 1 };
                    changes.push((
                        rise,
                        q,
                        Change {
                            room: other.id.clone(),
                            from: before,
                            to: after,
                        },
                    ));
                }
                // The signal it adds where it is wanted: in the rooms not covered well yet.
                if before < Level::Good {
                    added += areas[q] * (alone - current[q]).clamp(0.0, GAIN_CAP_DB);
                }
            }
            if worth == 0 {
                continue;
            }
            if kept
                .as_ref()
                .is_some_and(|(w, a, _)| (*w, *a) >= (worth, added))
            {
                continue;
            }
            changes.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
            kept = Some((
                worth,
                added,
                AdvisedSpot {
                    storey: storey_id(spot.storey),
                    at: [round1(spot.x), round1(spot.y)],
                    room: room.id.clone(),
                    near: near_piece(&home, r, &spot),
                    reach: reach.map(round1),
                    changes: changes.into_iter().map(|(_, _, c)| c).collect(),
                },
            ));
        }
        if let Some((worth, added, spot)) = kept {
            best.push((worth, added, r, spot));
        }
    }
    best.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.total_cmp(&a.1)).then(a.2.cmp(&b.2)));
    Advice {
        rooms,
        radios: placed,
        spots: best
            .into_iter()
            .take(wanted)
            .map(|(_, _, _, spot)| spot)
            .collect(),
        check,
        agreement,
    }
}

/// The piece of room `room` nearest a spot, within [`NEAR_PIECE`] (not one of [`NOT_BY`]).
fn near_piece(home: &Home, room: usize, spot: &Spot) -> Option<String> {
    home.pieces
        .iter()
        .filter(|(_, p)| {
            p.spot.storey == spot.storey
                && p.kind.as_deref().is_none_or(|kind| !NOT_BY.contains(&kind))
        })
        .map(|(id, p)| (id, (p.spot.x - spot.x).hypot(p.spot.y - spot.y), p))
        .filter(|(_, d, p)| {
            *d <= NEAR_PIECE && home.room_at(p.spot.storey, [p.spot.x, p.spot.y]) == Some(room)
        })
        .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(b.0)))
        .map(|(id, _, _)| id.clone())
}

#[cfg(test)]
mod tests;
