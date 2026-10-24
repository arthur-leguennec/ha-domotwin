//! The radio mesh of the home (`DECISIONS.md`, D-031): the devices of a Zigbee network (or any
//! mesh a source describes the same way), the links their neighbour tables report, how good each
//! link is, each device's best way to the coordinator, and what looks unhealthy: weak links,
//! devices not seen for a while, rooms that reach the mesh only through weak links.
//!
//! The source (the frontend, from ZHA) hands over a snapshot in one shape whatever the network:
//!
//! ```json
//! { "devices": [
//!     { "id": "00:11:22:33:44:55:66:77", "name": "Hall lamp", "role": "router",
//!       "lqi": 190, "rssi": -61, "seen": 42, "available": true, "element": "lamp-hall",
//!       "neighbours": [{ "id": "…", "lqi": 172, "relation": "parent" }] } ] }
//! ```
//!
//! It is read leniently: what is missing or malformed is left out, never refused.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{Map, Value, json};

use crate::scene::wires::{Flow, Wire};

/// Most devices read from a snapshot.
pub const MAX_DEVICES: usize = 1_000;
/// Most neighbours read for one device.
const MAX_NEIGHBOURS: usize = 128;
/// Longest id or name kept (characters).
const MAX_TEXT: usize = 100;

/// A link quality (LQI, 0–255) at least this is good.
pub const GOOD_LQI: u8 = 150;
/// A link quality at least this, and under [`GOOD_LQI`], is fair; under it, weak.
pub const FAIR_LQI: u8 = 80;
/// A device not heard from for this long (seconds) is not seen for a while: a day, more than
/// any battery device's check-in.
pub const STALE_AFTER: f64 = 24.0 * 3_600.0;

/// How strongly a link no device takes to the coordinator is drawn: the ways in stand out.
const SPARE_WEIGHT: f32 = 0.45;

/// What a device is in the mesh.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    /// Starts and runs the network.
    Coordinator,
    /// Mains powered: relays for the others.
    Router,
    /// Sleeps most of the time and talks through a parent.
    EndDevice,
    Unknown,
}

impl Role {
    fn read(name: Option<&str>) -> Self {
        match name {
            Some("coordinator") => Role::Coordinator,
            Some("router") => Role::Router,
            Some("end") => Role::EndDevice,
            _ => Role::Unknown,
        }
    }

    /// The name in snapshots and in the analysis.
    pub const fn name(self) -> &'static str {
        match self {
            Role::Coordinator => "coordinator",
            Role::Router => "router",
            Role::EndDevice => "end",
            Role::Unknown => "unknown",
        }
    }
}

/// How good a link is, from its LQI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Quality {
    Weak,
    Fair,
    Good,
    /// No LQI was reported.
    Unknown,
}

impl Quality {
    /// The quality of a link of this LQI.
    pub fn of(lqi: Option<u8>) -> Self {
        match lqi {
            None => Quality::Unknown,
            Some(l) if l >= GOOD_LQI => Quality::Good,
            Some(l) if l >= FAIR_LQI => Quality::Fair,
            Some(_) => Quality::Weak,
        }
    }

    /// The name in the analysis.
    pub const fn name(self) -> &'static str {
        match self {
            Quality::Weak => "weak",
            Quality::Fair => "fair",
            Quality::Good => "good",
            Quality::Unknown => "unknown",
        }
    }

    /// The colour a link of this quality is drawn in (linear RGB): green, amber, red, grey.
    pub const fn color(self) -> [f32; 3] {
        match self {
            Quality::Good => [0.16, 0.78, 0.38],
            Quality::Fair => [0.98, 0.66, 0.12],
            Quality::Weak => [0.94, 0.22, 0.2],
            Quality::Unknown => [0.6, 0.62, 0.66],
        }
    }
}

/// A device of the mesh.
#[derive(Debug, Clone, PartialEq)]
pub struct Device {
    /// Its address in the mesh (an IEEE address for Zigbee).
    pub id: String,
    pub name: String,
    pub role: Role,
    /// The quality of the last message heard from it.
    pub lqi: Option<u8>,
    /// Its strength (dBm).
    pub rssi: Option<i16>,
    /// How long ago it was last heard from (seconds).
    pub seen: Option<f64>,
    /// Whether the source counts it as available.
    pub available: bool,
    /// The plan element it is placed at.
    pub element: Option<String>,
}

impl Device {
    /// Not heard from for a while, or counted unavailable by its source.
    pub fn stale(&self) -> bool {
        !self.available || self.seen.is_some_and(|s| s > STALE_AFTER)
    }
}

/// A link between two devices, as their neighbour tables report it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Link {
    /// The devices it joins (indices, `a < b`).
    pub a: usize,
    pub b: usize,
    /// The lower of the qualities both ends reported (one end often reports none).
    pub lqi: Option<u8>,
}

impl Link {
    /// How good it is.
    pub fn quality(&self) -> Quality {
        Quality::of(self.lqi)
    }

    /// The other end from device `i`.
    pub fn other(&self, i: usize) -> usize {
        if self.a == i { self.b } else { self.a }
    }
}

/// A device's best way to the coordinator: the path whose weakest link is the best, then the
/// shortest of those.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Route {
    /// Links to the coordinator.
    pub hops: usize,
    /// The LQI of its weakest link (the coordinator: none).
    pub bottleneck: Option<u8>,
    /// The first link on the way (the coordinator: none).
    pub link: Option<usize>,
}

/// The mesh read from a snapshot.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Mesh {
    pub devices: Vec<Device>,
    pub links: Vec<Link>,
    /// The device that runs the network, when the snapshot has one.
    pub coordinator: Option<usize>,
    /// Each device's way to the coordinator (none when it has no way there).
    pub routes: Vec<Option<Route>>,
    /// Neighbour entries left out: of devices the snapshot does not have, or malformed.
    pub skipped: usize,
}

/// A room that reaches the rest of the mesh only through weak links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeakRoom {
    pub room: String,
    /// The weak links leaving it.
    pub links: usize,
}

/// What looks unhealthy in the mesh.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Health {
    /// Indices of the weak links.
    pub weak_links: Vec<usize>,
    /// Indices of the devices not seen for a while.
    pub stale: Vec<usize>,
    /// Rooms whose devices reach the others only through weak links: a router there would help.
    pub weak_rooms: Vec<WeakRoom>,
}

fn text(value: Option<&Value>) -> Option<String> {
    let s = value?.as_str()?.trim();
    (!s.is_empty()).then(|| s.chars().take(MAX_TEXT).collect())
}

fn lqi(value: Option<&Value>) -> Option<u8> {
    let v = value?.as_f64().filter(|v| v.is_finite())?;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Some(v.clamp(0.0, 255.0).round() as u8)
}

impl Mesh {
    /// Reads a snapshot (see the module's documentation). Anything that is not one gives an
    /// empty mesh.
    pub fn read(value: &Value) -> Self {
        let mut mesh = Mesh::default();
        let Some(list) = value.get("devices").and_then(Value::as_array) else {
            return mesh;
        };
        let mut index: HashMap<String, usize> = HashMap::new();
        let mut tables: Vec<&[Value]> = Vec::new();
        for raw in list.iter().take(MAX_DEVICES) {
            let Some(id) = text(raw.get("id")) else {
                continue;
            };
            if index.contains_key(&id) {
                continue;
            }
            let role = Role::read(raw.get("role").and_then(Value::as_str));
            #[allow(clippy::cast_possible_truncation)]
            let rssi = raw
                .get("rssi")
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite())
                .map(|v| v.clamp(-128.0, 127.0).round() as i16);
            let device = Device {
                name: text(raw.get("name")).unwrap_or_else(|| id.clone()),
                id: id.clone(),
                role,
                lqi: lqi(raw.get("lqi")),
                rssi,
                seen: raw
                    .get("seen")
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite() && *v >= 0.0),
                available: raw.get("available").and_then(Value::as_bool) != Some(false),
                element: text(raw.get("element")),
            };
            if role == Role::Coordinator && mesh.coordinator.is_none() {
                mesh.coordinator = Some(mesh.devices.len());
            }
            index.insert(id, mesh.devices.len());
            mesh.devices.push(device);
            tables.push(
                raw.get("neighbours")
                    .and_then(Value::as_array)
                    .map_or(&[][..], Vec::as_slice),
            );
        }
        // Both ends may list a link: one link, of the lower quality reported.
        let mut links: BTreeMap<(usize, usize), Option<u8>> = BTreeMap::new();
        for (i, table) in tables.iter().enumerate() {
            for entry in table.iter().take(MAX_NEIGHBOURS) {
                let other = text(entry.get("id")).and_then(|id| index.get(&id).copied());
                let Some(j) = other.filter(|j| *j != i) else {
                    mesh.skipped += 1;
                    continue;
                };
                // A child that left (`previous`) is no link any more; a parent, a child, a
                // sibling or another neighbour is.
                if entry.get("relation").and_then(Value::as_str) == Some("previous") {
                    continue;
                }
                let reported = lqi(entry.get("lqi"));
                let key = (i.min(j), i.max(j));
                let slot = links.entry(key).or_insert(reported);
                *slot = match (*slot, reported) {
                    (Some(x), Some(y)) => Some(x.min(y)),
                    (x, y) => x.or(y),
                };
            }
        }
        mesh.links = links
            .into_iter()
            .map(|((a, b), lqi)| Link { a, b, lqi })
            .collect();
        mesh.routes = mesh.find_routes();
        mesh
    }

    /// The links of each device (indices into `links`).
    fn adjacency(&self) -> Vec<Vec<usize>> {
        let mut adjacent = vec![Vec::new(); self.devices.len()];
        for (k, link) in self.links.iter().enumerate() {
            adjacent[link.a].push(k);
            adjacent[link.b].push(k);
        }
        adjacent
    }

    /// The widest paths to the coordinator: each device's path whose weakest link is the best,
    /// then the one with the fewest hops (a link of unknown quality counts as fair). The routes
    /// make a tree, as Zigbee's routing towards a concentrator does: a device hands its messages
    /// to one neighbour, which sends them on its own way, so a device's way is a link and then
    /// that neighbour's way, and its hops are the ones its messages take.
    fn find_routes(&self) -> Vec<Option<Route>> {
        let mut routes: Vec<Option<Route>> = vec![None; self.devices.len()];
        let Some(start) = self.coordinator else {
            return routes;
        };
        let adjacent = self.adjacency();
        routes[start] = Some(Route {
            hops: 0,
            bottleneck: None,
            link: None,
        });
        let mut done = vec![false; self.devices.len()];
        // Few devices: a scan for the best open one is fast enough and plain.
        loop {
            let next = (0..self.devices.len())
                .filter(|&i| !done[i])
                .filter_map(|i| routes[i].map(|r| (i, r)))
                .max_by(|(_, x), (_, y)| better(x, y));
            let Some((i, route)) = next else { break };
            done[i] = true;
            // A device not heard from (unplugged, out of reach) keeps its last way, but no one's
            // messages go through it any more.
            if i != start && self.devices[i].stale() {
                continue;
            }
            for &k in &adjacent[i] {
                let link = &self.links[k];
                let j = link.other(i);
                if done[j] {
                    continue;
                }
                let weight = link.lqi.unwrap_or(FAIR_LQI);
                let candidate = Route {
                    hops: route.hops + 1,
                    bottleneck: Some(route.bottleneck.map_or(weight, |b| b.min(weight))),
                    link: Some(k),
                };
                if routes[j].is_none_or(|current| {
                    better(&candidate, &current) == std::cmp::Ordering::Greater
                }) {
                    routes[j] = Some(candidate);
                }
            }
        }
        routes
    }

    /// The end of link `k` nearer the coordinator, by hops (none when neither end reaches it or
    /// both are as near).
    pub fn toward_coordinator(&self, k: usize) -> Option<usize> {
        let link = self.links.get(k)?;
        let hops = |i: usize| self.routes.get(i).copied().flatten().map(|r| r.hops);
        match (hops(link.a), hops(link.b)) {
            (Some(a), Some(b)) if a < b => Some(link.a),
            (Some(a), Some(b)) if b < a => Some(link.b),
            (Some(_), None) => Some(link.a),
            (None, Some(_)) => Some(link.b),
            _ => None,
        }
    }

    /// What looks unhealthy, with the room each device is in (`rooms[i]`, none when it is not
    /// placed or its piece is in no room).
    pub fn health(&self, rooms: &[Option<String>]) -> Health {
        let room = |i: usize| rooms.get(i).and_then(Option::as_deref);
        let weak_links = (0..self.links.len())
            .filter(|&k| self.links[k].quality() == Quality::Weak)
            .collect();
        let stale = (0..self.devices.len())
            .filter(|&i| self.devices[i].stale())
            .collect();
        // The links leaving each room, and whether any of them is not weak. A link to a device
        // not heard from is no better than a weak one.
        let coordinator_room = self.coordinator.and_then(room);
        let mut leaving: BTreeMap<&str, (usize, bool)> = BTreeMap::new();
        for link in &self.links {
            for (from, to) in [(link.a, link.b), (link.b, link.a)] {
                let Some(r) = room(from) else { continue };
                if room(to) == Some(r) {
                    continue;
                }
                let entry = leaving.entry(r).or_insert((0, false));
                if link.quality() == Quality::Weak || self.devices[to].stale() {
                    entry.0 += 1;
                } else {
                    entry.1 = true;
                }
            }
        }
        let weak_rooms = leaving
            .into_iter()
            .filter(|(r, (weak, other))| *weak > 0 && !other && Some(*r) != coordinator_room)
            .map(|(r, (weak, _))| WeakRoom {
                room: r.to_owned(),
                links: weak,
            })
            .collect();
        Health {
            weak_links,
            stale,
            weak_rooms,
        }
    }

    /// The analysis for the interface: each device with its role, quality, way to the
    /// coordinator and whether it is stale; each link with its ends, LQI and quality; the
    /// health summary. `rooms` as for [`Mesh::health`].
    pub fn to_json(&self, rooms: &[Option<String>]) -> Value {
        let health = self.health(rooms);
        let devices: Vec<Value> = self
            .devices
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let mut out = Map::new();
                out.insert("id".into(), json!(d.id));
                out.insert("role".into(), json!(d.role.name()));
                out.insert("quality".into(), json!(Quality::of(d.lqi).name()));
                out.insert("stale".into(), json!(d.stale()));
                if let Some(route) = self.routes.get(i).copied().flatten() {
                    out.insert("hops".into(), json!(route.hops));
                    if let Some(b) = route.bottleneck {
                        out.insert("bottleneck".into(), json!(b));
                    }
                    if let Some(k) = route.link {
                        out.insert("via".into(), json!(self.devices[self.links[k].other(i)].id));
                    }
                }
                if let Some(r) = rooms.get(i).and_then(Option::as_deref) {
                    out.insert("room".into(), json!(r));
                }
                Value::Object(out)
            })
            .collect();
        let links: Vec<Value> = self
            .links
            .iter()
            .map(|l| {
                json!({
                    "a": self.devices[l.a].id, "b": self.devices[l.b].id,
                    "lqi": l.lqi, "quality": l.quality().name()
                })
            })
            .collect();
        json!({
            "devices": devices,
            "links": links,
            "coordinator": self.coordinator.map(|c| self.devices[c].id.clone()),
            "health": {
                "weakLinks": health.weak_links.len(),
                "stale": health.stale.iter().map(|&i| &self.devices[i].id).collect::<Vec<_>>(),
                "weakRooms": health.weak_rooms.iter()
                    .map(|w| json!({ "room": w.room, "links": w.links }))
                    .collect::<Vec<_>>(),
            },
            "skipped": self.skipped,
        })
    }
}

impl Mesh {
    /// The wires of the links whose two ends are placed (`points[i]`: where device `i` is
    /// drawn, on its storey's floor, and that storey), coloured by their quality; each with the
    /// index of its link. The links devices take to the coordinator carry a pulse towards it; the
    /// others, between two devices that have their own way, are drawn lighter and still. A link
    /// to a device not seen for a while is dashed.
    pub fn wires(&self, points: &[Option<([f32; 3], u8)>]) -> Vec<(usize, Wire)> {
        let at = |i: usize| points.get(i).copied().flatten();
        let taken: HashSet<usize> = self
            .routes
            .iter()
            .flatten()
            .filter_map(|r| r.link)
            .collect();
        let routed = |i: usize| self.routes.get(i).is_some_and(Option::is_some);
        self.links
            .iter()
            .enumerate()
            .filter_map(|(k, link)| {
                let ((from, pa), (to, pb)) = (at(link.a)?, at(link.b)?);
                let spare = !taken.contains(&k) && routed(link.a) && routed(link.b);
                let flow = match self.toward_coordinator(k) {
                    _ if spare => Flow::None,
                    Some(i) if i == link.b => Flow::Forward,
                    Some(_) => Flow::Backward,
                    None => Flow::None,
                };
                let wire = Wire {
                    from,
                    to,
                    parts: [pa, pb],
                    color: link.quality().color(),
                    flow,
                    dashed: self.devices[link.a].stale() || self.devices[link.b].stale(),
                    weight: if spare { SPARE_WEIGHT } else { 1.0 },
                    bend: 1.0,
                };
                Some((k, wire))
            })
            .collect()
    }
}

/// Which of two routes is better: the stronger weakest link, then the fewer hops.
fn better(x: &Route, y: &Route) -> std::cmp::Ordering {
    // The coordinator's own route (no links) is the best of all.
    let strength = |r: &Route| r.bottleneck.map_or(256, u16::from);
    strength(x)
        .cmp(&strength(y))
        .then_with(|| y.hops.cmp(&x.hops))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fictional mesh: the coordinator in the hall, a router in the living room and one in the
    /// bedroom, a sensor in the bathroom that only hears the bedroom router, badly.
    fn snapshot() -> Value {
        json!({ "devices": [
            { "id": "c", "name": "Coordinator", "role": "coordinator", "element": "hub",
              "neighbours": [
                { "id": "r1", "lqi": 200, "relation": "child" },
                { "id": "r2", "lqi": 90, "relation": "child" },
                { "id": "gone", "lqi": 10, "relation": "previous" }
              ] },
            { "id": "r1", "name": "Living lamp", "role": "router", "lqi": 210, "seen": 30,
              "neighbours": [
                { "id": "c", "lqi": 190, "relation": "parent" },
                { "id": "r2", "lqi": 170, "relation": "sibling" },
                { "id": "nobody", "lqi": 255 }
              ] },
            { "id": "r2", "name": "Bedroom plug", "role": "router", "lqi": 120,
              "neighbours": [
                { "id": "r1", "lqi": 160, "relation": "sibling" },
                { "id": "s", "lqi": 40, "relation": "child" }
              ] },
            { "id": "s", "name": "Bath sensor", "role": "end", "lqi": 40,
              "seen": 100_000, "neighbours": [] },
            { "id": "gone", "role": "end", "available": false },
            { "id": "c", "name": "Twice" },
            { "name": "No id" }
        ] })
    }

    fn rooms(mesh: &Mesh) -> Vec<Option<String>> {
        mesh.devices
            .iter()
            .map(|d| match d.id.as_str() {
                "c" => Some("hall".to_owned()),
                "r1" => Some("living".to_owned()),
                "r2" => Some("bedroom".to_owned()),
                "s" => Some("bathroom".to_owned()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn thresholds() {
        assert_eq!(Quality::of(Some(255)), Quality::Good);
        assert_eq!(Quality::of(Some(GOOD_LQI)), Quality::Good);
        assert_eq!(Quality::of(Some(GOOD_LQI - 1)), Quality::Fair);
        assert_eq!(Quality::of(Some(FAIR_LQI)), Quality::Fair);
        assert_eq!(Quality::of(Some(FAIR_LQI - 1)), Quality::Weak);
        assert_eq!(Quality::of(None), Quality::Unknown);
    }

    #[test]
    fn reads_devices_and_merges_links() {
        let mesh = Mesh::read(&snapshot());
        let ids: Vec<&str> = mesh.devices.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["c", "r1", "r2", "s", "gone"]);
        assert_eq!(mesh.coordinator, Some(0));
        assert_eq!(mesh.devices[3].role, Role::EndDevice);
        assert_eq!(mesh.devices[1].element, None);
        assert_eq!(mesh.devices[0].element.as_deref(), Some("hub"));
        // c–r1 reported 200 and 190: 190. A previous child is no link; an unknown one is skipped.
        let link = |a: usize, b: usize| mesh.links.iter().find(|l| (l.a, l.b) == (a, b)).copied();
        assert_eq!(link(0, 1).unwrap().lqi, Some(190));
        assert_eq!(link(1, 2).unwrap().lqi, Some(160));
        assert_eq!(link(0, 2).unwrap().quality(), Quality::Fair);
        assert_eq!(link(2, 3).unwrap().quality(), Quality::Weak);
        assert!(link(0, 4).is_none());
        assert_eq!(mesh.links.len(), 4);
        assert_eq!(mesh.skipped, 1);
    }

    #[test]
    fn routes_take_the_widest_path() {
        let mesh = Mesh::read(&snapshot());
        // r2 reaches c directly at 90, or through r1 at min(190, 160) = 160: through r1.
        let r2 = mesh.routes[2].unwrap();
        assert_eq!((r2.hops, r2.bottleneck), (2, Some(160)));
        assert_eq!(mesh.links[r2.link.unwrap()].other(2), 1);
        let s = mesh.routes[3].unwrap();
        assert_eq!((s.hops, s.bottleneck), (3, Some(40)));
        assert!(mesh.routes[4].is_none(), "no link");
        assert_eq!(mesh.routes[0].unwrap().hops, 0);
        // Pulses run towards the coordinator.
        let k = mesh
            .links
            .iter()
            .position(|l| (l.a, l.b) == (2, 3))
            .unwrap();
        assert_eq!(mesh.toward_coordinator(k), Some(2));
    }

    #[test]
    fn a_device_not_heard_from_relays_for_no_one() {
        // r is unplugged: s goes straight to c, badly, and its room hangs by weak links.
        let mesh = Mesh::read(&json!({ "devices": [
            { "id": "c", "role": "coordinator",
              "neighbours": [{ "id": "r", "lqi": 200 }, { "id": "s", "lqi": 60 }] },
            { "id": "r", "role": "router", "available": false,
              "neighbours": [{ "id": "s", "lqi": 200 }] },
            { "id": "s", "role": "end" }
        ] }));
        let r = mesh.routes[1].unwrap();
        assert_eq!(
            (r.hops, r.bottleneck),
            (1, Some(200)),
            "it keeps its last way"
        );
        let s = mesh.routes[2].unwrap();
        assert_eq!((s.hops, s.bottleneck), (1, Some(60)));
        let rooms = [
            Some("hall".to_owned()),
            Some("study".to_owned()),
            Some("attic".to_owned()),
        ];
        let health = mesh.health(&rooms);
        assert_eq!(
            health.weak_rooms,
            [WeakRoom {
                room: "attic".to_owned(),
                links: 2
            }]
        );
    }

    #[test]
    fn a_device_goes_on_its_neighbours_own_way() {
        // c–a 100, c–b 200, b–a 200, a–d 50: a goes through b (200, 2 hops); d, which hears
        // only a, goes through a and then a's own way (3 hops), not c–a–d.
        let mesh = Mesh::read(&json!({ "devices": [
            { "id": "c", "role": "coordinator",
              "neighbours": [{ "id": "a", "lqi": 100 }, { "id": "b", "lqi": 200 }] },
            { "id": "a", "role": "router",
              "neighbours": [{ "id": "b", "lqi": 200 }, { "id": "d", "lqi": 50 }] },
            { "id": "b", "role": "router" },
            { "id": "d", "role": "end" }
        ] }));
        let a = mesh.routes[1].unwrap();
        assert_eq!((a.hops, a.bottleneck), (2, Some(200)));
        let d = mesh.routes[3].unwrap();
        assert_eq!((d.hops, d.bottleneck), (3, Some(50)));
        assert_eq!(mesh.links[d.link.unwrap()].other(3), 1);
        // The c–a link is no one's way: drawn spare.
        let c_a = mesh
            .links
            .iter()
            .position(|l| (l.a, l.b) == (0, 1))
            .unwrap();
        assert!(mesh.routes.iter().flatten().all(|r| r.link != Some(c_a)));
    }

    #[test]
    fn health_finds_weak_links_stale_devices_and_rooms_hanging_by_them() {
        let mesh = Mesh::read(&snapshot());
        let health = mesh.health(&rooms(&mesh));
        assert_eq!(health.weak_links.len(), 1);
        assert_eq!(health.stale, [3, 4], "seen a day ago, and unavailable");
        assert_eq!(
            health.weak_rooms,
            [WeakRoom {
                room: "bathroom".to_owned(),
                links: 1
            }]
        );
        // The bedroom has a weak link too, but good ones as well.
        let json = mesh.to_json(&rooms(&mesh));
        assert_eq!(json["health"]["weakRooms"][0]["room"], "bathroom");
        assert_eq!(json["devices"][2]["via"], "r1");
        assert_eq!(json["devices"][3]["bottleneck"], 40);
        assert_eq!(json["links"][0]["quality"], "good");
    }

    #[test]
    fn wires_join_placed_devices_and_pulse_towards_the_coordinator() {
        let mesh = Mesh::read(&snapshot());
        let mut points = vec![None; mesh.devices.len()];
        points[1] = Some(([0.0, 100.0, 0.0], 0));
        points[2] = Some(([500.0, 100.0, 0.0], 0));
        points[3] = Some(([500.0, 50.0, 300.0], 1));
        let wires = mesh.wires(&points);
        // c is not placed: its links are not drawn.
        assert_eq!(wires.len(), 2);
        let (k, r1_r2) = wires[0];
        assert_eq!((mesh.links[k].a, mesh.links[k].b), (1, 2));
        assert_eq!(r1_r2.flow, Flow::Backward, "r1 is nearer the coordinator");
        assert_eq!(r1_r2.color, Quality::Good.color());
        let (_, r2_s) = wires[1];
        assert_eq!(
            (r2_s.flow, r2_s.color),
            (Flow::Backward, Quality::Weak.color())
        );
        assert_eq!(r2_s.parts, [0, 1], "a wire between two storeys");
        assert!(r2_s.dashed, "the bath sensor is not seen for a day");
        assert!(!r1_r2.dashed);
        // The coordinator placed: r2 goes through r1 (160) rather than straight to it (90), so
        // that link is spare: lighter, still.
        points[0] = Some(([0.0, 100.0, 500.0], 0));
        let wires = mesh.wires(&points);
        assert_eq!(wires.len(), 4);
        let ends = |(k, _): &(usize, Wire)| (mesh.links[*k].a, mesh.links[*k].b);
        let c_r1 = wires.iter().find(|w| ends(w) == (0, 1)).expect("c–r1").1;
        let c_r2 = wires.iter().find(|w| ends(w) == (0, 2)).expect("c–r2").1;
        assert_eq!((c_r1.flow, c_r1.weight), (Flow::Backward, 1.0));
        assert_eq!((c_r2.flow, c_r2.weight), (Flow::None, SPARE_WEIGHT));
        assert_eq!(c_r2.color, Quality::Fair.color());
    }

    #[test]
    fn anything_else_is_an_empty_mesh() {
        for value in [json!(null), json!([]), json!({ "devices": 3 })] {
            assert_eq!(Mesh::read(&value), Mesh::default());
        }
        // Without a coordinator, nothing has a route; health still counts.
        let mesh = Mesh::read(&json!({ "devices": [
            { "id": "a", "role": "router", "neighbours": [{ "id": "b", "lqi": 3 }] },
            { "id": "b", "role": "end", "lqi": "high", "rssi": -999 }
        ] }));
        assert!(mesh.routes.iter().all(Option::is_none));
        assert_eq!(mesh.devices[1].rssi, Some(-128));
        assert_eq!(mesh.health(&[]).weak_links.len(), 1);
    }
}
