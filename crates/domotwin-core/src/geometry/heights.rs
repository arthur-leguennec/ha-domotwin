//! The vertical layout of a room wall (cm above the floor): the wall height, the door and window
//! heights it cuts, the rail of `vert-blanc` walls and what covers each part of a wall face.

use crate::plan::{EdgeFinish, Rgb8, Room, WallStyle};

/// Wall height of the 3D view.
pub const WALL_HEIGHT: f64 = 265.0;
/// Doors are cut from the floor to this height.
pub const DOOR_HEIGHT: f64 = 207.0;
/// Windows are cut from their sill…
pub const SILL: f64 = 90.0;
/// …to their head.
pub const WINDOW_TOP: f64 = 215.0;
/// Top of the wainscot of `vert-blanc` walls.
pub const RAIL: f64 = 90.0;
/// Height of walls cut away by the automatic cut-away.
pub const CUT_HEIGHT: f64 = 38.0;

/// Default paint of room walls.
pub const WALL_COLOR: Rgb8 = Rgb8::from_u32(0xf1efe9);
/// Paint of the wainscot of `vert-blanc` walls, below [`RAIL`].
pub const WAINSCOT_COLOR: Rgb8 = Rgb8::from_u32(0x2b4235);
/// Default paint above the wainscot of `vert-blanc` walls.
pub const UPPER_WALL_COLOR: Rgb8 = Rgb8::from_u32(0xe4e1d8);

/// A height range `[y0, y1]` (cm).
pub type Span = [f64; 2];

/// The parts of a wall of height `h` left around an opening, bottom first.
pub fn wall_spans(opening: Option<bool>, h: f64) -> Vec<Span> {
    match opening {
        None => vec![[0.0, h]],
        // A window: the breast and the part above.
        Some(false) => {
            let mut out = vec![[0.0, SILL.min(h)]];
            if h > WINDOW_TOP {
                out.push([WINDOW_TOP, h]);
            }
            out
        }
        // A door: the part above.
        Some(true) if h > DOOR_HEIGHT => vec![[DOOR_HEIGHT, h]],
        Some(true) => Vec::new(),
    }
}

/// The height range an opening cuts in a wall of height `h` (`door` or window).
pub fn opening_cut(door: bool, h: f64) -> Span {
    let top = h.max(0.0);
    if door {
        [0.0, DOOR_HEIGHT.min(top)]
    } else {
        [SILL.min(top), WINDOW_TOP.min(top)]
    }
}

/// What covers a part of a wall face.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Covering {
    /// A paint colour.
    Paint(Rgb8),
    /// Subway tiles.
    Tiles,
}

/// The paint of a room's walls where no side finish applies.
pub fn wall_paint(room: &Room) -> Rgb8 {
    room.wall_color
        .unwrap_or(if room.wall_style == WallStyle::GreenWainscot {
            UPPER_WALL_COLOR
        } else {
            WALL_COLOR
        })
}

/// The coverings of the height range `[y0, y1]` of a wall face of `room`, bottom first. A side's
/// own finish wins; otherwise `vert-blanc` walls have the green wainscot below [`RAIL`].
pub fn covering_bands(
    room: &Room,
    finish: Option<EdgeFinish>,
    y0: f64,
    y1: f64,
) -> Vec<(Span, Covering)> {
    match finish {
        Some(EdgeFinish::Metro) => return vec![([y0, y1], Covering::Tiles)],
        Some(EdgeFinish::Paint(color)) => return vec![([y0, y1], Covering::Paint(color))],
        None => {}
    }
    if room.wall_style == WallStyle::GreenWainscot {
        let mut out = Vec::new();
        if y0 < RAIL {
            out.push(([y0, y1.min(RAIL)], Covering::Paint(WAINSCOT_COLOR)));
        }
        if y1 > RAIL {
            out.push(([y0.max(RAIL), y1], Covering::Paint(wall_paint(room))));
        }
        return out;
    }
    vec![([y0, y1], Covering::Paint(wall_paint(room)))]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_around_openings() {
        assert_eq!(wall_spans(None, 265.0), vec![[0.0, 265.0]]);
        assert_eq!(
            wall_spans(Some(false), 265.0),
            vec![[0.0, 90.0], [215.0, 265.0]]
        );
        assert_eq!(wall_spans(Some(true), 265.0), vec![[207.0, 265.0]]);
        assert_eq!(wall_spans(Some(true), 38.0), Vec::<Span>::new());
        assert_eq!(wall_spans(Some(false), 38.0), vec![[0.0, 38.0]]);
        assert_eq!(opening_cut(true, 265.0), [0.0, 207.0]);
        assert_eq!(opening_cut(false, 100.0), [90.0, 100.0]);
    }
}
