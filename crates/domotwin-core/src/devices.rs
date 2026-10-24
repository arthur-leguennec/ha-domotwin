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

/// Segments of the cone's arc.
const ARC_STEPS: usize = 24;

type P2 = [f64; 2];

/// The floor a camera linked to the piece `element` sees, as a polygon of plan points: its cone
/// from the centre of the piece towards its front (the `y + h` side), cut to the piece's room
/// (its `parent`, else the room holding its centre). `None` for an element that is not a piece,
/// outside every room, or a cone that sees no floor.
pub fn camera_cone(
    plan: &Plan,
    scene: &Scene,
    element: usize,
    view: CameraView,
) -> Option<Vec<P2>> {
    let Element::Furniture(piece) = plan.elements.get(element)? else {
        return None;
    };
    let apex = piece.center();
    let rooms = &scene.walls().rooms;
    let room = rooms
        .iter()
        .find(|r| plan.elements.get(r.element).map(Element::id) == Some(piece.parent.as_str()))
        .or_else(|| {
            rooms
                .iter()
                .find(|r| point_in_polygon(apex, &r.points, false))
        })?;
    let (s, c) = piece.angle.to_radians().sin_cos();
    // The piece's local +y (its front) turned by its angle.
    let heading = c.atan2(-s);
    let half = view.fov.to_radians() / 2.0;
    let mut wedge = vec![apex];
    #[allow(clippy::cast_precision_loss)]
    for i in 0..=ARC_STEPS {
        let a = heading - half + 2.0 * half * i as f64 / ARC_STEPS as f64;
        wedge.push([
            apex[0] + view.range * a.cos(),
            apex[1] + view.range * a.sin(),
        ]);
    }
    let seen = clip(&room.points, &wedge);
    (seen.len() >= 3 && signed_area2(&seen).abs() > 1.0).then_some(seen)
}

/// Sutherland–Hodgman: the part of `subject` (any simple polygon) inside `convex`.
fn clip(subject: &[P2], convex: &[P2]) -> Vec<P2> {
    let mut out = subject.to_vec();
    let orientation = signed_area2(convex).signum();
    if orientation == 0.0 {
        return Vec::new();
    }
    let side = |a: P2, b: P2, p: P2| {
        orientation * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
    };
    for (k, &a) in convex.iter().enumerate() {
        let b = convex[(k + 1) % convex.len()];
        let input = std::mem::take(&mut out);
        for (i, &p) in input.iter().enumerate() {
            let q = input[(i + 1) % input.len()];
            let (sp, sq) = (side(a, b, p), side(a, b, q));
            if sp >= 0.0 {
                out.push(p);
            }
            if (sp >= 0.0) != (sq >= 0.0) {
                let t = sp / (sp - sq);
                out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
            }
        }
        if out.is_empty() {
            break;
        }
    }
    out
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
    fn clipping_keeps_what_is_inside() {
        let square = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let half = [[5.0, -5.0], [20.0, -5.0], [20.0, 20.0], [5.0, 20.0]];
        let cut = clip(&square, &half);
        assert!((area(&cut) - 50.0).abs() < 1e-9);
        // Either winding of the clip polygon.
        let reversed: Vec<P2> = half.iter().rev().copied().collect();
        assert!((area(&clip(&square, &reversed)) - 50.0).abs() < 1e-9);
        let far = [[50.0, 50.0], [60.0, 50.0], [60.0, 60.0]];
        assert!(clip(&square, &far).is_empty());
    }
}
