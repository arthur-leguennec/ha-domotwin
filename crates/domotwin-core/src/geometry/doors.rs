//! Door sweeps: the floor area a door leaf passes through when it opens fully, drawn on the 2D
//! plan. Local frame of a door: origin at the hinge `(x, y)`, local +x along the opening, local +y
//! along `n = (−sin a, cos a)`; the leaf opens towards `swing · n`.

use crate::geometry::polygon::P2;
use crate::geometry::walls::opening_axes;
use crate::plan::{DoorStyle, Opening};

/// Number of segments of the quarter-circle arcs.
const ARC_STEPS: usize = 8;

/// Swept polygons in the door's local frame, by style: a quarter disc for hinged and glazed
/// doors, two half-width quarter discs for double doors, folded panels for folding doors, nothing
/// for sliding, barn, passage and sealed doors.
pub fn sweep_local(door: &Opening) -> Vec<Vec<P2>> {
    let (w, s) = (door.w, f64::from(door.swing));
    let fan = |x0: f64, dir: f64, r: f64| {
        let mut polygon = vec![[x0, 0.0]];
        for k in 0..=ARC_STEPS {
            #[allow(clippy::cast_precision_loss)]
            let a = (k as f64 / ARC_STEPS as f64) * std::f64::consts::FRAC_PI_2;
            polygon.push([x0 + dir * r * a.cos(), s * r * a.sin()]);
        }
        polygon
    };
    let fold = |x0: f64, dir: f64, l: f64| {
        vec![
            [x0, 0.0],
            [x0 + dir * l, 0.0],
            [x0 + dir * l / 2.0, s * l / 2.0],
            [x0, s * l / 2.0],
        ]
    };
    match door.style {
        DoorStyle::Hinged | DoorStyle::Glazed => vec![fan(0.0, 1.0, w)],
        DoorStyle::Double => vec![fan(0.0, 1.0, w / 2.0), fan(w, -1.0, w / 2.0)],
        DoorStyle::Folding => vec![fold(0.0, 1.0, w)],
        DoorStyle::FoldingDouble => vec![fold(0.0, 1.0, w / 2.0), fold(w, -1.0, w / 2.0)],
        DoorStyle::Sliding | DoorStyle::Barn | DoorStyle::Passage | DoorStyle::Sealed => Vec::new(),
    }
}

/// [`sweep_local`] in plan coordinates.
pub fn sweep_world(door: &Opening) -> Vec<Vec<P2>> {
    let (u, n) = opening_axes(door.angle);
    sweep_local(door)
        .into_iter()
        .map(|polygon| {
            polygon
                .into_iter()
                .map(|[x, y]| [door.x + x * u[0] + y * n[0], door.y + x * u[1] + y * n[1]])
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn door(style: DoorStyle) -> Opening {
        Opening {
            id: String::new(),
            name: String::new(),
            x: 100.0,
            y: 0.0,
            w: 80.0,
            angle: 90.0,
            swing: 1,
            parent: String::new(),
            style,
            open: None,
        }
    }

    #[test]
    fn sweeps_by_style() {
        assert_eq!(sweep_local(&door(DoorStyle::Hinged)).len(), 1);
        assert_eq!(sweep_local(&door(DoorStyle::Double)).len(), 2);
        assert_eq!(sweep_local(&door(DoorStyle::FoldingDouble)).len(), 2);
        assert!(sweep_local(&door(DoorStyle::Sliding)).is_empty());
        // Angle 90°: u = (0, 1), n = (−1, 0); the arc ends at the hinge + w·n.
        let world = sweep_world(&door(DoorStyle::Hinged));
        let Some(end) = world[0].last() else {
            panic!("an arc")
        };
        assert!((end[0] - 20.0).abs() < 1e-9 && end[1].abs() < 1e-9);
    }
}
