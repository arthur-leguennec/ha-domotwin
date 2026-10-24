//! The network map for JavaScript (`DECISIONS.md`, D-031): the mesh a source describes, its links
//! drawn as wires between the pieces its devices are placed at, and what a tap on a wire finds.

use std::collections::HashMap;

use domotwin_core::network::Mesh;
use domotwin_core::scene::ElementInfo;
use domotwin_core::scene::wires::{self, Wire, segments};
use domotwin_render::WireSet;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::engine::Engine;

/// How far above the top of its piece a device's end of a wire is (cm).
pub(crate) const ABOVE: f32 = 12.0;
/// How near a tap must be to a wire to pick it, as a share of the drawing buffer's smaller side.
const TAP_REACH: f64 = 0.02;

/// The mesh shown, and the wires drawn for it.
#[derive(Debug, Default)]
pub(crate) struct NetworkShown {
    mesh: Mesh,
    /// Each drawn wire, with the index of its link.
    wires: Vec<(usize, Wire)>,
}

#[wasm_bindgen]
impl Engine {
    /// Shows the mesh of `snapshot` (JSON, see `domotwin_core::network`): its links are drawn
    /// between the pieces its devices are placed at, coloured by quality, a pulse running towards
    /// the coordinator. Returns the analysis as JSON (devices, links, health). An empty string
    /// hides the map.
    #[wasm_bindgen(js_name = setNetwork)]
    pub fn set_network(&mut self, snapshot: &str) -> String {
        if snapshot.is_empty() {
            self.network = None;
            self.renderer.set_wires(WireSet::Network, &[]);
            return String::new();
        }
        let value: Value = serde_json::from_str(snapshot).unwrap_or(Value::Null);
        self.network = Some(NetworkShown {
            mesh: Mesh::read(&value),
            wires: Vec::new(),
        });
        self.place_network();
        let rooms = self.network_rooms();
        self.network
            .as_ref()
            .map(|n| n.mesh.to_json(&rooms).to_string())
            .unwrap_or_default()
    }

    /// The link of the network map nearest the device pixel (`x`, `y`) from the top left, within
    /// a tap's reach: JSON `{"a", "b"}` (its ends' ids), or an empty string.
    #[wasm_bindgen(js_name = networkAt)]
    pub fn network_at(&self, x: f64, y: f64) -> String {
        let Some(shown) = self.network.as_ref() else {
            return String::new();
        };
        let found = self.nearest_wire(&shown.wires, x, y);
        found
            .and_then(|k| {
                let link = shown.mesh.links.get(k)?;
                let id = |i: usize| shown.mesh.devices[i].id.clone();
                Some(json!({ "a": id(link.a), "b": id(link.b) }).to_string())
            })
            .unwrap_or_default()
    }
}

impl Engine {
    /// Draws the wires of the mesh shown between the pieces of the scene shown (again after the
    /// scene changed).
    pub(crate) fn place_network(&mut self) {
        let Some(shown) = self.network.as_ref() else {
            return;
        };
        let elements = self.elements_by_id();
        let points: Vec<Option<([f32; 3], u8)>> = shown
            .mesh
            .devices
            .iter()
            .map(|d| {
                let info = elements.get(d.element.as_deref()?)?;
                let [x, y, z] = info.top()?;
                Some(([x, y + ABOVE, z], u8::try_from(info.storey).ok()?))
            })
            .collect();
        // Only the wires drawn: a tap finds no link that is not on screen.
        let wires: Vec<(usize, Wire)> = shown
            .mesh
            .wires(&points)
            .into_iter()
            .filter(|(_, w)| wires::drawn(w))
            .collect();
        let pieces: Vec<Wire> = wires.iter().map(|(_, w)| *w).collect();
        self.renderer
            .set_wires(WireSet::Network, &segments(&pieces));
        if let Some(shown) = self.network.as_mut() {
            shown.wires = wires;
        }
    }

    /// The elements of the scene shown, by id.
    pub(crate) fn elements_by_id(&self) -> HashMap<&str, &ElementInfo> {
        self.elements.iter().map(|e| (e.id.as_str(), e)).collect()
    }

    /// No plan is shown any more: its wires are neither drawn nor found under a tap. The mesh is
    /// kept, for the next plan (`place_network`).
    pub(crate) fn drop_network_wires(&mut self) {
        if let Some(shown) = self.network.as_mut() {
            shown.wires.clear();
        }
        self.renderer.set_wires(WireSet::Network, &[]);
    }

    /// The room each device of the mesh shown is in: its piece's room (none when it is not
    /// placed, or its piece is in no room).
    fn network_rooms(&self) -> Vec<Option<String>> {
        let Some(shown) = self.network.as_ref() else {
            return Vec::new();
        };
        let elements = self.elements_by_id();
        shown
            .mesh
            .devices
            .iter()
            .map(|d| self.room_of(elements.get(d.element.as_deref()?)?).cloned())
            .collect()
    }

    /// The key of the wire of `wires` (each with its key) drawn nearest the device pixel (`x`,
    /// `y`), within a tap's reach.
    pub(crate) fn nearest_wire(&self, wires: &[(usize, Wire)], x: f64, y: f64) -> Option<usize> {
        self.wires_near(wires, x, y).first().copied()
    }

    /// The keys of the wires of `wires` (each with its key) drawn within a tap's reach of the
    /// device pixel (`x`, `y`), the nearest first.
    pub(crate) fn wires_near(&self, wires: &[(usize, Wire)], x: f64, y: f64) -> Vec<usize> {
        let (width, height) = self.renderer.size();
        let reach = f64::from(width.min(height)) * TAP_REACH;
        let mut near: Vec<(f64, usize)> = Vec::new();
        for &(k, ref wire) in wires {
            let screen: Vec<Option<[f64; 2]>> = (0..=wires::STEPS)
                .map(|s| {
                    #[allow(clippy::cast_precision_loss)]
                    let t = s as f32 / wires::STEPS as f32;
                    self.renderer.screen_point(self.wire_point(wire, t))
                })
                .collect();
            let nearest = screen
                .windows(2)
                .filter_map(|pair| Some(distance_to_segment([x, y], pair[0]?, pair[1]?)))
                .fold(f64::INFINITY, f64::min);
            if nearest <= reach {
                // Few are within reach: each goes in its place.
                let at = near.partition_point(|&(d, _)| d <= nearest);
                near.insert(at, (nearest, k));
            }
        }
        near.into_iter().map(|(_, k)| k).collect()
    }

    /// Where the point at `t` along `wire` is drawn now, each end moved with its storey.
    fn wire_point(&self, wire: &Wire, t: f32) -> [f64; 3] {
        let p = wires::point(wire, t);
        let from = self.renderer.view.offset(usize::from(wire.parts[0]));
        let to = self.renderer.view.offset(usize::from(wire.parts[1]));
        let t = f64::from(t);
        std::array::from_fn(|i| f64::from(p[i]) + from[i] + (to[i] - from[i]) * t)
    }
}

/// How far `p` is from the segment `a`–`b` (device pixels).
fn distance_to_segment(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length = dx * dx + dy * dy;
    let t = if length > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
}
