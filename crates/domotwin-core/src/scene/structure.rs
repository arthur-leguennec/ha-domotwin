//! Floors and walls of the rooms, and free partitions. Walls are grouped by direction so that the
//! renderer can cut away the ones between the camera and the rooms.

use super::Builder;
use super::lines::{LineKind, band_at, bend, offset_corner, top_offset};
use super::mesh::{CutMode, Material, NO_GROUP, Painter, Surface, Tag, Xform};
use crate::geometry::heights::{Covering, RAIL, covering_bands, wall_paint, wall_spans};
use crate::geometry::polygon::{P2, point_in_polygon};
use crate::geometry::walls::{
    EdgeBand, RoomWalls, WallLayout, openings_on_side, side_segments, wall_openings,
};
use crate::plan::{EdgeFinish, Element, Floor, FreeWall, Plan, Rgb8, Room, WallStyle};

/// Trims (skirting boards, rails, frames).
pub(crate) const TRIM: Material = Material::satin(Rgb8::from_u32(0xf4f2ec));
/// Outer face of façades and ends of walls seen from outside.
const WALL_OUTER: Material = Material::new(Rgb8::from_u32(0xe9e6de), 0.95, Surface::Matte);
/// Top of the walls.
const WALL_CAP: Material = Material::new(Rgb8::from_u32(0x4f564d), 0.9, Surface::WallCap);
/// Floor slab edges.
const SLAB: Material = Material::new(Rgb8::from_u32(0xb9b5a8), 1.0, Surface::Matte);
/// Subway tiles.
const TILES: Material = Material::new(Rgb8::from_u32(0xf3f2ee), 0.2, Surface::Subway);
/// Slab thickness (cm).
const SLAB_DEPTH: f64 = 6.0;
/// A railing along a place outside (a balcony): its height and how far apart its posts are (cm).
const RAILING: f64 = 100.0;
const RAILING_POSTS: f64 = 150.0;
/// How far out of a side a room of the home makes it against the home (cm): past a façade.
const AGAINST_HOME: f64 = 40.0;
/// How finely a side is looked along for the home (cm).
const RAILING_STEP: f64 = 5.0;
/// The edge of a deck, of paving.
const DECK_EDGE: Material = Material::new(Rgb8::from_u32(0x7d5c42), 0.75, Surface::Wood);
const STONE_EDGE: Material = Material::new(Rgb8::from_u32(0xa9a294), 0.9, Surface::Matte);
/// A railing's posts and rail, and its glass.
const RAILING_METAL: Material = Material::new(Rgb8::from_u32(0x3d4147), 0.4, Surface::Metal);

/// The floor material of a room.
pub(crate) fn floor_material(room: &Room) -> Material {
    match room.floor {
        Floor::WoodGrey => Material::new(Rgb8::from_u32(0xa8a08b), 0.7, Surface::Planks),
        Floor::WoodOak => Material::new(Rgb8::from_u32(0xbb9668), 0.6, Surface::Planks),
        Floor::WoodPainted => Material::new(Rgb8::from_u32(0xa6b0ab), 0.65, Surface::Planks),
        Floor::TilesBeige => Material::new(Rgb8::from_u32(0xd7cdb8), 0.35, Surface::Tiles),
        Floor::TilesWhite => Material::new(Rgb8::from_u32(0xe8e8e1), 0.3, Surface::Tiles),
        Floor::Plain => Material::new(Rgb8::from_u32(0xd9d3c6), 0.85, Surface::Floor),
        Floor::Lawn => Material::new(Rgb8::from_u32(0x638f42), 0.9, Surface::Grass),
        Floor::Decking => Material::new(Rgb8::from_u32(0x9a7454), 0.7, Surface::Planks),
        Floor::Paving => Material::new(Rgb8::from_u32(0xc4bcae), 0.8, Surface::Paving),
        Floor::Gravel => Material::new(Rgb8::from_u32(0xb7ad9c), 1.0, Surface::Gravel),
        Floor::Soil => Material::new(Rgb8::from_u32(0x5d4a38), 1.0, Surface::Soil),
    }
}

fn covering_material(covering: Covering) -> Material {
    match covering {
        Covering::Paint(color) => Material::paint(color),
        Covering::Tiles => TILES,
    }
}

/// How much higher a place outside's ground is drawn than that of the larger one it may lie in
/// (cm), for so many of them at most: a gravel path in the lawn is not in its plane.
const OUTSIDE_LIFT: f64 = 0.3;
const OUTSIDE_LIFTS: usize = 4;

/// Builds the floors and walls of every room, then the free partitions.
pub(crate) fn build(builder: &mut Builder, plan: &Plan, layout: &WallLayout) {
    let openings = wall_openings(plan);
    // The places outside, the largest first (the lookup order's last).
    let mut lifts = vec![0.0; layout.rooms.len()];
    let outside = layout
        .lookup_order()
        .iter()
        .rev()
        .filter(|&&k| layout.rooms[k].outside);
    for (rank, &k) in outside.enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let steps = rank.min(OUTSIDE_LIFTS) as f64;
        lifts[k] = OUTSIDE_LIFT * steps;
    }
    for (k, walls) in layout.rooms.iter().enumerate() {
        let Some(Element::Room(room)) = plan.elements.get(walls.element) else {
            continue;
        };
        let element = builder.element_tag(walls.element);
        floor(builder, room, walls, element, lifts[k]);
        room_walls(builder, room, walls, &openings, element);
        room_lines(builder, walls, &openings);
        if room.railing {
            railing(builder, layout, walls, element, room.level());
        }
    }
    for (index, element) in plan.elements.iter().enumerate() {
        if let Element::Wall(wall) = element {
            free_wall(builder, plan, wall, builder.element_tag(index));
        }
    }
}

/// The floor of a room, on its level (`lift` higher).
fn floor(builder: &mut Builder, room: &Room, walls: &RoomWalls, element: u16, lift: f64) {
    let tag = Tag {
        element,
        room: builder.room_slot(walls.element),
        ..Tag::default()
    };
    let level = room.level() + lift;
    let mut p = Painter::new(&mut builder.opaque, floor_material(room), tag);
    p.polygon(&walls.points, level, true, room.floor_angle);
    // Its edge: a slab's, a deck's boards, paving's stone.
    p.material = match room.floor {
        _ if !room.outside => SLAB,
        Floor::Decking | Floor::WoodGrey | Floor::WoodOak | Floor::WoodPainted => DECK_EDGE,
        _ => STONE_EDGE,
    };
    let n = walls.points.len();
    for i in 0..n {
        let (a, b) = (walls.points[i], walls.points[(i + 1) % n]);
        let normal = walls.normal(i);
        let out = [
            [a[0], -SLAB_DEPTH, a[1]],
            [b[0], -SLAB_DEPTH, b[1]],
            [b[0], level, b[1]],
            [a[0], level, a[1]],
        ];
        p.quad(
            out,
            [[0.0; 2]; 4],
            Some([normal[0], 0.0, normal[1]]),
            -SLAB_DEPTH,
        );
    }
}

/// A railing along the sides of a place outside (a balcony, a roof terrace, D-077), but where
/// the home's rooms of its storey are, touching it or across a façade from it: posts, a rail on
/// top and glass between, on its ground (`level`).
fn railing(
    builder: &mut Builder,
    layout: &WallLayout,
    walls: &RoomWalls,
    element: u16,
    level: f64,
) {
    let inside: Vec<&[P2]> = layout
        .rooms
        .iter()
        .filter(|r| !r.outside)
        .map(|r| r.points.as_slice())
        .collect();
    let tag = Tag {
        element,
        room: builder.room_slot(walls.element),
        ..Tag::default()
    };
    let mut metal = Painter::new(&mut builder.opaque, RAILING_METAL, tag);
    let mut glass = Painter::new(&mut builder.transparent, Material::glass(), tag);
    let (low, top) = (level, level + RAILING);
    let n = walls.points.len();
    for i in 0..n {
        let (a, b) = walls.side(i);
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        if len < 5.0 {
            continue;
        }
        let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let normal = walls.normal(i);
        // A couple of centimetres in, along the side.
        let at = |s: f64, k: f64| -> P2 {
            [
                a[0] + u[0] * s - normal[0] * k,
                a[1] + u[1] * s - normal[1] * k,
            ]
        };
        // Against the home where a room lies just out of the side: across its façade or touching.
        let against = |s: f64| {
            let p = at(s, -AGAINST_HOME);
            inside.iter().any(|room| point_in_polygon(p, room, false))
        };
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let steps = (len / RAILING_STEP).ceil().max(1.0) as usize;
        let mut runs: Vec<(f64, f64)> = Vec::new();
        let mut start: Option<f64> = None;
        #[allow(clippy::cast_precision_loss)]
        for k in 0..=steps {
            let s = len * k as f64 / steps as f64;
            match (against(s), start) {
                (false, None) => start = Some(s),
                (true, Some(s0)) => {
                    runs.push((s0, (s - RAILING_STEP).max(s0)));
                    start = None;
                }
                _ => {}
            }
        }
        if let Some(s0) = start {
            runs.push((s0, len));
        }
        for (s0, s1) in runs {
            if s1 - s0 < 5.0 {
                continue;
            }
            let x = Xform::IDENTITY;
            // Posts at both ends and every 1.5 m between.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let spans = ((s1 - s0) / RAILING_POSTS).ceil().max(1.0) as usize;
            #[allow(clippy::cast_precision_loss)]
            for k in 0..=spans {
                let s = s0 + (s1 - s0) * k as f64 / spans as f64;
                let p = at(s, 3.0);
                metal.cuboid(
                    &x,
                    [p[0] - 2.0, low, p[1] - 2.0],
                    [p[0] + 2.0, top, p[1] + 2.0],
                );
            }
            let (p0, p1) = (at(s0, 3.0), at(s1, 3.0));
            metal.rod(&x, [p0[0], top, p0[1]], [p1[0], top, p1[1]], 2.5, 8);
            let (q0, q1) = (at(s0, 2.5), at(s1, 2.5));
            let (r0, r1) = (at(s0, 3.5), at(s1, 3.5));
            glass.quad(
                [
                    [q0[0], low + 8.0, q0[1]],
                    [q1[0], low + 8.0, q1[1]],
                    [q1[0], top - 4.0, q1[1]],
                    [q0[0], top - 4.0, q0[1]],
                ],
                [[0.0; 2]; 4],
                Some([normal[0], 0.0, normal[1]]),
                0.0,
            );
            glass.quad(
                [
                    [r1[0], low + 8.0, r1[1]],
                    [r0[0], low + 8.0, r0[1]],
                    [r0[0], top - 4.0, r0[1]],
                    [r1[0], top - 4.0, r1[1]],
                ],
                [[0.0; 2]; 4],
                Some([-normal[0], 0.0, -normal[1]]),
                0.0,
            );
        }
    }
}

fn room_walls(
    builder: &mut Builder,
    room: &Room,
    walls: &RoomWalls,
    openings: &[(&crate::plan::Opening, bool)],
    element: u16,
) {
    let height = builder.wall_height;
    let slot = builder.room_slot(walls.element);
    let n = walls.points.len();
    let jamb = Material::paint(wall_paint(room));
    for (i, bands) in walls.sides.iter().enumerate() {
        let Some(bands) = bands else { continue };
        let (a, b) = walls.side(i);
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        if len < 0.5 {
            continue;
        }
        let normal = walls.normal(i);
        let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let finish = room
            .edge_finish
            .as_ref()
            .and_then(|f| f.get(i).copied().flatten());
        let on_side = openings_on_side(a, b, openings);
        for band in bands {
            let group = builder.group(normal, band.inner);
            let tag = Tag {
                element,
                group,
                cut: CutMode::Clamp,
                room: slot,
            };
            for op in &on_side {
                builder
                    .opening_groups
                    .entry(op.opening.id.clone())
                    .or_insert(group);
            }
            let at = |s: f64, k: f64| -> P2 {
                [
                    a[0] + u[0] * s + normal[0] * k,
                    a[1] + u[1] * s + normal[1] * k,
                ]
            };
            // The other face of a partition is skipped when the neighbour's half touches it
            // (`o1 < depth` means the gap is narrower than the partition).
            let back = if !band.inner {
                Some(WALL_OUTER)
            } else if band.o1 + 0.05 >= band.depth() {
                Some(jamb)
            } else {
                None
            };
            let mut p = Painter::new(&mut builder.wall_mesh, TRIM, tag);
            for (sa, sb, op) in side_segments(band.t0 * len, band.t1 * len, &on_side) {
                if sb - sa < 0.2 {
                    continue;
                }
                let q = [
                    at(sa, band.o0),
                    at(sb, band.o0),
                    at(sb, band.o1),
                    at(sa, band.o1),
                ];
                for [y0, y1] in wall_spans(op.map(|o| o.door), height) {
                    for ([m0, m1], covering) in covering_bands(room, finish, y0, y1) {
                        p.prism(
                            q,
                            m0,
                            m1,
                            [
                                Some(covering_material(covering)),
                                Some(jamb),
                                back,
                                Some(jamb),
                            ],
                            Some(WALL_CAP),
                            sa,
                        );
                    }
                }
                // Skirting board, rails and cornice on the room face.
                let strip = |k: f64| -> [P2; 4] {
                    [
                        q[0],
                        q[1],
                        [q[1][0] - normal[0] * k, q[1][1] - normal[1] * k],
                        [q[0][0] - normal[0] * k, q[0][1] - normal[1] * k],
                    ]
                };
                let trims = [Some(TRIM); 4];
                let window_or_wall = op.is_none_or(|o| !o.door);
                if window_or_wall && finish != Some(EdgeFinish::Metro) && height > 12.0 {
                    p.prism(strip(1.5), 0.0, 12.0, trims, Some(TRIM), 0.0);
                    p.prism(strip(2.1), 10.5, 12.5, trims, Some(TRIM), 0.0);
                    let plain = finish.is_none() && op.is_none();
                    if plain && room.wall_style == WallStyle::GreenWainscot && height > RAIL + 4.0 {
                        p.prism(strip(2.4), RAIL - 3.0, RAIL + 4.0, trims, Some(TRIM), 0.0);
                    }
                    if plain && room.wall_style == WallStyle::ChairRail && height > 98.0 {
                        p.prism(strip(1.4), 91.0, 96.0, trims, Some(TRIM), 0.0);
                        p.prism(strip(2.2), 94.0, 96.0, trims, Some(TRIM), 0.0);
                    }
                }
                if room.cornice && height > 150.0 {
                    p.prism(
                        strip(2.2),
                        height - 12.0,
                        height - 8.0,
                        trims,
                        Some(TRIM),
                        0.0,
                    );
                    p.prism(
                        strip(4.8),
                        height - 8.0,
                        height - 4.0,
                        trims,
                        Some(TRIM),
                        0.0,
                    );
                    p.prism(strip(8.0), height - 4.0, height, trims, Some(TRIM), 0.0);
                }
            }
        }
    }
    for corner in &walls.corners {
        let side = corner.vertex % n.max(1);
        let inner = walls.sides[side]
            .as_ref()
            .and_then(|b| b.first())
            .is_some_and(|b| b.inner);
        let group = builder.group(walls.normal(side), inner);
        let tag = Tag {
            element,
            group,
            cut: CutMode::Clamp,
            room: slot,
        };
        let mut p = Painter::new(&mut builder.wall_mesh, WALL_OUTER, tag);
        let outer = Some(WALL_OUTER);
        p.prism(corner.quad, 0.0, height, [outer; 4], Some(WALL_CAP), 0.0);
    }
}

/// Sine of the turn below which the walls of a room run on at a vertex (no corner there).
const BEND: f64 = 0.02;
/// Farthest a joined corner of the outlines may be from the room's vertex, in thicknesses (a
/// sharper corner is left open).
const JOIN_REACH: f64 = 4.0;

/// How the outer face of a façade ends at a vertex of its room.
enum FacadeEnd {
    /// It meets the outer face of the next façade there (a concave corner).
    Joined(P2),
    /// It runs into a corner piece or into the next wall: nothing more to draw.
    Covered,
    /// The end of the wall shows.
    Open,
}

/// How the outer face of façade `band` on side `side` ends at its start or (`at_end`) its end.
fn facade_end(walls: &RoomWalls, side: usize, band: &EdgeBand, at_end: bool) -> FacadeEnd {
    let n = walls.points.len().max(1);
    let (vertex, other_side) = if at_end {
        ((side + 1) % n, (side + 1) % n)
    } else {
        (side, (side + n - 1) % n)
    };
    // Along the side, a façade gives way to a partition: its end shows.
    if !band.reaches(at_end) {
        return FacadeEnd::Open;
    }
    let Some(other) = band_at(walls, other_side, !at_end) else {
        return FacadeEnd::Open;
    };
    let bend = bend(walls, vertex).unwrap_or(0.0);
    if other.inner {
        return if bend.abs() < BEND {
            FacadeEnd::Open
        } else {
            FacadeEnd::Covered
        };
    }
    if bend > BEND {
        let (a, b) = walls.side(side);
        let (c, d) = walls.side(other_side);
        let joined = offset_corner(
            (a, b, walls.normal(side), band.o1),
            (c, d, walls.normal(other_side), other.o1),
        );
        let v = walls.points[vertex];
        let reach = JOIN_REACH * band.o1.max(other.o1) + 0.5;
        return match joined {
            Some(p) if (p[0] - v[0]).hypot(p[1] - v[1]) <= reach => FacadeEnd::Joined(p),
            _ => FacadeEnd::Open,
        };
    }
    if bend < -BEND && !walls.corners.iter().any(|c| c.vertex % n == vertex) {
        // A corner too sharp for its corner piece.
        return FacadeEnd::Open;
    }
    FacadeEnd::Covered
}

/// Where the tops of the walls on both sides of vertex `i` meet, if both reach it.
fn top_joint(walls: &RoomWalls, i: usize) -> Option<P2> {
    let n = walls.points.len().max(1);
    let prev = (i + n - 1) % n;
    let before = band_at(walls, prev, true)?;
    let after = band_at(walls, i, false)?;
    let (k0, k1) = (top_offset(&before), top_offset(&after));
    let ((a, b), (c, d)) = (walls.side(prev), walls.side(i));
    let p = offset_corner((a, b, walls.normal(prev), k0), (c, d, walls.normal(i), k1))?;
    let v = walls.points[i % n];
    let reach = JOIN_REACH * k0.abs().max(k1.abs()) + 0.5;
    ((p[0] - v[0]).hypot(p[1] - v[1]) <= reach).then_some(p)
}

/// The outlines of a room (`lines.rs`): its floor, the tops and corners of its walls, the outer
/// faces of its façades, and the frames of the doors and windows on its sides.
fn room_lines(
    builder: &mut Builder,
    walls: &RoomWalls,
    openings: &[(&crate::plan::Opening, bool)],
) {
    let height = builder.wall_height;
    let n = walls.points.len();
    builder.lines.floor(&walls.points, NO_GROUP);
    let mut side_groups = vec![None; n];
    for (i, bands) in walls.sides.iter().enumerate() {
        let Some(bands) = bands else { continue };
        let (a, b) = walls.side(i);
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        if len < 0.5 {
            continue;
        }
        let normal = walls.normal(i);
        let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let at = |s: f64, k: f64| -> P2 {
            [
                a[0] + u[0] * s + normal[0] * k,
                a[1] + u[1] * s + normal[1] * k,
            ]
        };
        let on_side = openings_on_side(a, b, openings);
        for band in bands {
            let group = builder.group(normal, band.inner);
            side_groups[i].get_or_insert(group);
            let (s0, s1) = (band.t0 * len, band.t1 * len);
            // The top, meeting the next wall's at the room's corners.
            let k = top_offset(band);
            let start = band
                .reaches(false)
                .then(|| top_joint(walls, i))
                .flatten()
                .unwrap_or_else(|| at(s0, k));
            let end = band
                .reaches(true)
                .then(|| top_joint(walls, (i + 1) % n))
                .flatten()
                .unwrap_or_else(|| at(s1, k));
            builder
                .lines
                .push(start, height, end, height, group, LineKind::Wall);
            for op in &on_side {
                let middle = f64::midpoint(op.s0, op.s1);
                if middle >= s0 && middle <= s1 {
                    builder.lines.opening(at(0.0, k), u, op, height, group);
                }
            }
            if band.inner {
                continue;
            }
            // The outer face of a façade.
            let mut outer = [at(s0, band.o1), at(s1, band.o1)];
            for (at_end, s) in [(false, s0), (true, s1)] {
                match facade_end(walls, i, band, at_end) {
                    FacadeEnd::Joined(p) => {
                        outer[usize::from(at_end)] = p;
                        // The corner's edge, drawn once (by the façade starting there).
                        if !at_end {
                            builder
                                .lines
                                .vertical(p, 0.0, height, group, LineKind::Wall);
                        }
                    }
                    FacadeEnd::Open => {
                        builder.lines.push(
                            at(s, band.o0),
                            height,
                            at(s, band.o1),
                            height,
                            group,
                            LineKind::Wall,
                        );
                        builder
                            .lines
                            .vertical(at(s, band.o1), 0.0, height, group, LineKind::Wall);
                    }
                    FacadeEnd::Covered => {}
                }
            }
            builder
                .lines
                .push(outer[0], height, outer[1], height, group, LineKind::Wall);
        }
    }
    // The corners of the room, up its walls (none where the walls run on).
    for i in 0..n {
        let prev = (i + n - 1) % n;
        if bend(walls, i).is_none_or(|b| b.abs() < BEND) {
            continue;
        }
        let Some(group) = side_groups[i].or(side_groups[prev]) else {
            continue;
        };
        let offset_point = |side: usize, at_end: bool| {
            band_at(walls, side, at_end).map(|band| {
                let (a, b) = walls.side(side);
                let p = if at_end { b } else { a };
                let normal = walls.normal(side);
                let k = top_offset(&band);
                [p[0] + normal[0] * k, p[1] + normal[1] * k]
            })
        };
        let p = top_joint(walls, i)
            .or_else(|| offset_point(i, false))
            .or_else(|| offset_point(prev, true))
            .unwrap_or(walls.points[i]);
        builder
            .lines
            .vertical(p, 0.0, height, group, LineKind::Wall);
    }
    // The outer corners of façades: the mitre and its edge. A corner piece between a façade and a
    // partition (the gap between two rooms) carries on the façade's outer face alone.
    for corner in &walls.corners {
        let v = corner.vertex % n.max(1);
        let Some(group) = side_groups[v] else {
            continue;
        };
        let facade =
            |side: usize, at_end: bool| band_at(walls, side, at_end).is_some_and(|b| !b.inner);
        let (before, after) = (facade((v + n - 1) % n, true), facade(v, false));
        let q = corner.quad;
        if before {
            builder
                .lines
                .push(q[1], height, q[2], height, group, LineKind::Wall);
        }
        if after {
            builder
                .lines
                .push(q[2], height, q[3], height, group, LineKind::Wall);
        }
        if before && after {
            builder
                .lines
                .vertical(q[2], 0.0, height, group, LineKind::Wall);
        }
    }
}

fn free_wall(builder: &mut Builder, plan: &Plan, wall: &FreeWall, element: u16) {
    // Its footprint is the one a walker meets (`walk`).
    let Some((q, n)) = crate::geometry::walls::free_wall_quad(wall) else {
        return;
    };
    let room = plan.element(&wall.parent).and_then(|e| match e {
        Element::Room(r) => Some(r),
        _ => None,
    });
    let group = builder.own_group(n);
    let middle = [
        f64::midpoint(wall.x, wall.x2),
        f64::midpoint(wall.y, wall.y2),
    ];
    let tag = Tag {
        element,
        group,
        cut: CutMode::Clamp,
        room: builder.room_for(plan, &wall.parent, middle),
    };
    let height = builder.wall_height;
    let mut p = Painter::new(&mut builder.wall_mesh, WALL_OUTER, tag);
    let bands = room.map_or_else(
        || {
            vec![(
                [0.0, height],
                Covering::Paint(crate::geometry::heights::WALL_COLOR),
            )]
        },
        |r| covering_bands(r, None, 0.0, height),
    );
    for ([y0, y1], covering) in bands {
        let m = Some(covering_material(covering));
        p.prism(q, y0, y1, [m; 4], Some(WALL_CAP), 0.0);
    }
    for k in 0..4 {
        let (from, to) = (q[k], q[(k + 1) % 4]);
        builder
            .lines
            .push(from, height, to, height, group, LineKind::Wall);
        builder
            .lines
            .vertical(from, 0.0, height, group, LineKind::Wall);
    }
}
