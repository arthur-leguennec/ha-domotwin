//! Wires drawn over the home (`DECISIONS.md`, D-031): arcs between two points, each with its
//! colour, the way a pulse runs along it and an optional dash. The network map draws its links as
//! wires.
//!
//! An arc rises in its middle by a share of its length, so that wires between pieces of a room
//! clear the furniture and wires across the home are seen apart from the walls.

/// Which way a pulse runs along a wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flow {
    /// No pulse.
    None,
    /// From `from` to `to`.
    Forward,
    /// From `to` to `from`.
    Backward,
}

impl Flow {
    /// The value the renderer takes: 1, −1 or 0.
    pub const fn sign(self) -> f32 {
        match self {
            Flow::None => 0.0,
            Flow::Forward => 1.0,
            Flow::Backward => -1.0,
        }
    }
}

/// An arc between two points (cm, `y` up), each on its storey's floor: the renderer moves each
/// end with its storey (D-028).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Wire {
    pub from: [f32; 3],
    pub to: [f32; 3],
    /// The storeys (scene parts) of `from` and `to`.
    pub parts: [u8; 2],
    /// Linear RGB.
    pub color: [f32; 3],
    pub flow: Flow,
    pub dashed: bool,
    /// How strongly it is drawn (0–1): faded wires are drawn lighter.
    pub weight: f32,
    /// How high it rises, as a share of the usual rise (1): wires between the same two points
    /// rise apart.
    pub bend: f32,
}

/// A straight piece of a wire, as the renderer draws it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WireSegment {
    pub a: [f32; 3],
    pub b: [f32; 3],
    /// How far along the wire each end is (0 at `from`, 1 at `to`).
    pub ta: f32,
    pub tb: f32,
    /// The storeys of the wire's two ends.
    pub parts: [u8; 2],
    /// The length of the whole wire (cm): dashes and pulses keep their size on long wires.
    pub length: f32,
    pub color: [f32; 3],
    pub flow: f32,
    pub dashed: bool,
    pub weight: f32,
    /// The wire it is a piece of (its index).
    pub wire: u32,
}

/// Straight pieces an arc is drawn with.
pub const STEPS: usize = 16;
/// The middle of an arc rises by this share of its length…
const RISE: f32 = 0.25;
/// …at least this (cm)…
const MIN_RISE: f32 = 20.0;
/// …and at most this.
const MAX_RISE: f32 = 120.0;

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// The point at `t` (0–1) along the arc of `wire`.
pub fn point(wire: &Wire, t: f32) -> [f32; 3] {
    let (p0, p1) = (wire.from, wire.to);
    let rise = (distance(p0, p1) * RISE).clamp(MIN_RISE, MAX_RISE) * wire.bend.clamp(0.0, 4.0);
    let control = [
        (p0[0] + p1[0]) / 2.0,
        (p0[1] + p1[1]) / 2.0 + rise,
        (p0[2] + p1[2]) / 2.0,
    ];
    let (u, v) = (1.0 - t, t);
    std::array::from_fn(|i| u * u * p0[i] + 2.0 * u * v * control[i] + v * v * p1[i])
}

/// Whether `wire` is drawn: its points are finite and its ends apart. Ends on two storeys are
/// apart whatever their places on their floors (the storeys' heights and spread part them).
pub fn drawn(wire: &Wire) -> bool {
    let finite = wire.from.iter().chain(&wire.to).all(|v| v.is_finite());
    finite && (wire.parts[0] != wire.parts[1] || distance(wire.from, wire.to) >= 1.0)
}

/// The pieces the renderer draws the wires with, [`STEPS`] per wire; the wires not [`drawn`] are
/// left out.
#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
pub fn segments(wires: &[Wire]) -> Vec<WireSegment> {
    let mut out = Vec::with_capacity(wires.len() * STEPS);
    for (index, wire) in wires.iter().enumerate() {
        if !drawn(wire) {
            continue;
        }
        let points: Vec<[f32; 3]> = (0..=STEPS)
            .map(|s| point(wire, s as f32 / STEPS as f32))
            .collect();
        let length: f32 = points.windows(2).map(|p| distance(p[0], p[1])).sum();
        for s in 0..STEPS {
            out.push(WireSegment {
                a: points[s],
                b: points[s + 1],
                ta: s as f32 / STEPS as f32,
                tb: (s + 1) as f32 / STEPS as f32,
                parts: wire.parts,
                length,
                color: wire.color,
                flow: wire.flow.sign(),
                dashed: wire.dashed,
                weight: wire.weight.clamp(0.0, 1.0),
                wire: index as u32,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire(from: [f32; 3], to: [f32; 3]) -> Wire {
        Wire {
            from,
            to,
            parts: [0, 0],
            color: [1.0, 0.0, 0.0],
            flow: Flow::Forward,
            dashed: false,
            weight: 1.0,
            bend: 1.0,
        }
    }

    #[test]
    fn arcs_rise_in_their_middle_and_end_at_their_points() {
        let w = wire([0.0, 100.0, 0.0], [400.0, 100.0, 0.0]);
        assert_eq!(point(&w, 0.0), w.from);
        assert_eq!(point(&w, 1.0), w.to);
        // The control point is 100 cm up (a quarter of 400): the middle of the curve half that.
        let middle = point(&w, 0.5);
        assert!((middle[1] - 150.0).abs() < 1e-3, "{middle:?}");
        // A long wire rises at most 1.2 m, a short one at least 20 cm.
        let long = wire([0.0, 0.0, 0.0], [2_000.0, 0.0, 0.0]);
        assert!((point(&long, 0.5)[1] - 60.0).abs() < 1e-3);
        let short = wire([0.0, 0.0, 0.0], [10.0, 0.0, 0.0]);
        assert!((point(&short, 0.5)[1] - 10.0).abs() < 1e-3);
        // Bent further: it rises higher.
        let bent = Wire { bend: 1.5, ..w };
        assert!((point(&bent, 0.5)[1] - 175.0).abs() < 1e-3);
    }

    #[test]
    fn segments_run_along_the_wire() {
        let wires = [
            wire([0.0, 0.0, 0.0], [300.0, 0.0, 400.0]),
            wire([1.0, 1.0, 1.0], [1.0, 1.0, 1.0]),
            wire([f32::NAN, 0.0, 0.0], [1.0, 0.0, 0.0]),
            Wire {
                flow: Flow::Backward,
                dashed: true,
                weight: 3.0,
                ..wire([0.0, 0.0, 0.0], [0.0, 0.0, 200.0])
            },
        ];
        let segments = segments(&wires);
        assert_eq!(segments.len(), 2 * STEPS);
        assert!(!drawn(&wires[1]) && !drawn(&wires[2]));
        // Right above one another on two storeys: drawn.
        let stacked = Wire {
            parts: [0, 1],
            ..wire([1.0, 1.0, 1.0], [1.0, 1.0, 1.0])
        };
        assert!(drawn(&stacked));
        assert_eq!(super::segments(&[stacked]).len(), STEPS);
        assert_eq!(segments[0].a, wires[0].from);
        assert_eq!(segments[STEPS - 1].b, wires[0].to);
        assert!(segments[0].length > 500.0, "longer than the straight line");
        for pair in segments[..STEPS].windows(2) {
            assert_eq!(pair[0].b, pair[1].a);
            assert_eq!(pair[0].tb, pair[1].ta);
        }
        let last = segments[STEPS];
        assert_eq!(
            (last.wire, last.flow, last.dashed, last.weight),
            (3, -1.0, true, 1.0)
        );
    }
}
