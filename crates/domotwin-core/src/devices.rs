//! Devices drawn as what they are (`DECISIONS.md`, D-024): the floor a camera sees, from the piece
//! it is linked to, cut to the room the piece is in.

use crate::geometry::polygon::{point_in_polygon, signed_area2};
use crate::plan::{Element, Plan};
use crate::scene::Scene;

/// What a camera sees: its angle of view and how far.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CameraView {
    /// Angle of view (degrees, 10–180).
    pub fov: f64,
    /// Reach (cm, 50–3 000).
    pub range: f64,
}

impl Default for CameraView {
    fn default() -> Self {
        Self {
            fov: 90.0,
            range: 600.0,
        }
    }
}

impl CameraView {
    /// A view from optional settings: missing or invalid ones take the default, the others are
    /// kept within the limits.
    pub fn new(fov: Option<f64>, range: Option<f64>) -> Self {
        let default = Self::default();
        let finite = |v: Option<f64>| v.filter(|v| v.is_finite());
        Self {
            fov: finite(fov).map_or(default.fov, |v| v.clamp(10.0, 180.0)),
            range: finite(range).map_or(default.range, |v| v.clamp(50.0, 3_000.0)),
        }
    }
}

/// Rays cast across the angle of view (more go to the room's corners).
const RAYS: usize = 32;
/// How far a camera's centre may be moved towards its front to be inside its room (a camera on a
/// wall has its centre in the wall).
const MAX_NUDGE: f64 = 40.0;

type P2 = [f64; 2];

/// The floor a camera linked to the piece `element` sees, as a polygon of plan points: what can be
/// seen from the centre of the piece towards its front (the `y + h` side), within its angle of
/// view and reach, in the piece's room (its `parent`, else the room holding its centre), the
/// room's walls hiding what is behind them. `None` for an element that is not a piece, outside
/// every room, or a view that sees no floor.
pub fn camera_cone(
    plan: &Plan,
    scene: &Scene,
    element: usize,
    view: CameraView,
) -> Option<Vec<P2>> {
    let Element::Furniture(piece) = plan.elements.get(element)? else {
        return None;
    };
    let centre = piece.center();
    let rooms = &scene.walls().rooms;
    let room = rooms
        .iter()
        .find(|r| plan.elements.get(r.element).map(Element::id) == Some(piece.parent.as_str()))
        .or_else(|| {
            rooms
                .iter()
                .find(|r| point_in_polygon(centre, &r.points, false))
        })?;
    let (s, c) = piece.angle.to_radians().sin_cos();
    // The piece's local +y (its front) turned by its angle.
    let front = [-s, c];
    let apex = (0..=8)
        .map(|k| {
            let d = MAX_NUDGE * f64::from(k) / 8.0;
            [centre[0] + front[0] * d, centre[1] + front[1] * d]
        })
        .find(|p| point_in_polygon(*p, &room.points, true))?;
    let seen = visible(&room.points, apex, front[1].atan2(front[0]), view);
    (seen.len() >= 3 && signed_area2(&seen).abs() > 1.0).then_some(seen)
}

/// The visibility polygon from `apex` (inside `room`) across the view: the apex, then where each
/// ray first meets a side of the room, or its reach.
fn visible(room: &[P2], apex: P2, heading: f64, view: CameraView) -> Vec<P2> {
    let half = view.fov.to_radians() / 2.0;
    // Offsets from the heading, the corners' included (just before and after each).
    #[allow(clippy::cast_precision_loss)]
    let mut offsets: Vec<f64> = (0..=RAYS)
        .map(|i| -half + 2.0 * half * i as f64 / RAYS as f64)
        .collect();
    for v in room {
        let angle = (v[1] - apex[1]).atan2(v[0] - apex[0]);
        let offset = (angle - heading + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU)
            - std::f64::consts::PI;
        for e in [-1e-4, 1e-4] {
            if (offset + e).abs() < half {
                offsets.push(offset + e);
            }
        }
    }
    offsets.sort_by(f64::total_cmp);
    let mut points = vec![apex];
    for offset in offsets {
        let (dy, dx) = (heading + offset).sin_cos();
        let reach = (0..room.len())
            .filter_map(|i| ray_hits(apex, [dx, dy], room[i], room[(i + 1) % room.len()]))
            .fold(view.range, f64::min);
        points.push([apex[0] + dx * reach, apex[1] + dy * reach]);
    }
    points
}

/// How far along the ray from `o` towards `d` (a unit vector) it meets segment AB.
fn ray_hits(o: P2, d: P2, a: P2, b: P2) -> Option<f64> {
    let e = [b[0] - a[0], b[1] - a[1]];
    let denominator = d[0] * e[1] - d[1] * e[0];
    if denominator.abs() < 1e-12 {
        return None;
    }
    let w = [a[0] - o[0], a[1] - o[1]];
    let t = (w[0] * e[1] - w[1] * e[0]) / denominator;
    let u = (w[0] * d[1] - w[1] * d[0]) / denominator;
    (t > 1e-9 && (-1e-9..=1.0 + 1e-9).contains(&u)).then_some(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{SceneOptions, build_scene};
    use serde_json::json;

    /// An L-shaped room and a camera on its left wall looking right (+x), 40 cm from the floor's
    /// left edge.
    fn home(angle: f64) -> Plan {
        let value = json!({
            "version": 1, "unit": "cm",
            "elements": [
                { "id": "room", "type": "room", "name": "Room", "x": 0, "y": 0, "w": 600, "h": 400,
                  "vertices": [[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]] },
                { "id": "cam", "type": "furniture", "name": "Camera", "x": 20, "y": 90, "w": 10,
                  "h": 20, "z": 10, "kind": "spot", "angle": angle, "parent": "room" }
            ]
        });
        crate::plan::read_plan_value(&value).unwrap()
    }

    fn area(points: &[P2]) -> f64 {
        signed_area2(points).abs() / 2.0
    }

    #[test]
    fn views_have_limits() {
        assert_eq!(CameraView::new(None, None), CameraView::default());
        assert_eq!(
            CameraView::new(Some(400.0), Some(1.0)),
            CameraView {
                fov: 180.0,
                range: 50.0
            }
        );
        assert_eq!(CameraView::new(Some(f64::NAN), None).fov, 90.0);
    }

    #[test]
    fn the_cone_looks_ahead_and_stays_in_the_room() {
        // Angle −90: the piece's front (+y) turns to +x.
        let plan = home(-90.0);
        let scene = build_scene(&plan, &SceneOptions::default());
        let view = CameraView::new(Some(60.0), Some(500.0));
        let cone = camera_cone(&plan, &scene, 1, view).unwrap();
        // Every point is in the room and ahead of the camera (x ≥ its centre).
        let room = &scene.walls().rooms[0].points;
        for p in &cone {
            assert!(p[0] >= 25.0 - 1e-6, "{p:?}");
            assert!(
                p[0] <= 600.0 + 1e-6 && p[1] >= -1e-6 && p[1] <= 400.0 + 1e-6,
                "{p:?}"
            );
            assert!(
                point_in_polygon(*p, room, false) || near_edge(*p, room),
                "{p:?}"
            );
        }
        // A 60° cone of 500 cm, cut by the room's top wall (y = 0) and the inner corner.
        let full = std::f64::consts::PI * 500.0 * 500.0 / 6.0;
        assert!(
            area(&cone) < full * 0.95 && area(&cone) > full * 0.3,
            "{}",
            area(&cone)
        );
        // Turned to the room's left wall (front towards −x): it sees almost nothing.
        let back = camera_cone(&home(90.0), &scene, 1, view);
        assert!(back.is_none_or(|c| area(&c) < 600.0));
        // Rooms are not cameras.
        assert!(camera_cone(&plan, &scene, 0, view).is_none());
    }

    fn near_edge(p: P2, points: &[P2]) -> bool {
        points.iter().enumerate().any(|(i, &a)| {
            let b = points[(i + 1) % points.len()];
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let t =
                (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
            (a[0] + dx * t - p[0]).hypot(a[1] + dy * t - p[1]) < 1e-3
        })
    }

    #[test]
    fn walls_hide_what_is_behind_them() {
        // From the right arm of the L, looking down-left past the inner corner (300, 200): the
        // floor of the left arm behind the corner is hidden, and the view stays one polygon.
        let room = [
            [0.0, 0.0],
            [600.0, 0.0],
            [600.0, 200.0],
            [300.0, 200.0],
            [300.0, 400.0],
            [0.0, 400.0],
        ];
        let apex = [550.0, 100.0];
        let heading = (350.0_f64 - 100.0).atan2(100.0 - 550.0);
        let seen = visible(
            &room,
            apex,
            heading,
            CameraView::new(Some(30.0), Some(3_000.0)),
        );
        assert!(!crate::geometry::polygon::self_intersects(&seen));
        for p in &seen {
            assert!(
                point_in_polygon(*p, &room, false) || near_edge(*p, &room),
                "{p:?}"
            );
            // Nothing in the notch, nor behind the corner in the left arm's bottom.
            assert!(!(p[0] > 300.5 && p[1] > 200.5), "{p:?}");
        }
        assert!(!point_in_polygon([150.0, 380.0], &seen, false));
        assert!(point_in_polygon([400.0, 150.0], &seen, false));
        // The reach limits a ray that meets no wall first.
        let short = visible(
            &room,
            apex,
            heading,
            CameraView::new(Some(30.0), Some(100.0)),
        );
        assert!(
            short
                .iter()
                .all(|p| (p[0] - apex[0]).hypot(p[1] - apex[1]) <= 100.0 + 1e-6)
        );
        assert_eq!(
            ray_hits([0.0, 0.0], [1.0, 0.0], [5.0, -1.0], [5.0, 1.0]),
            Some(5.0)
        );
        assert_eq!(
            ray_hits([0.0, 0.0], [1.0, 0.0], [-5.0, -1.0], [-5.0, 1.0]),
            None
        );
    }
}
