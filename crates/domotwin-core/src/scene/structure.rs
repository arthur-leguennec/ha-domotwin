//! Floors and walls of the rooms, and free partitions. Walls are grouped by direction so that the
//! renderer can cut away the ones between the camera and the rooms.

use super::Builder;
use super::mesh::{CutMode, Material, Painter, Surface, Tag};
use crate::geometry::heights::{Covering, RAIL, covering_bands, wall_paint, wall_spans};
use crate::geometry::polygon::P2;
use crate::geometry::walls::{
    RoomWalls, WallLayout, openings_on_side, side_segments, wall_openings,
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

/// The floor material of a room.
pub(crate) fn floor_material(room: &Room) -> Material {
    match room.floor.procedural() {
        Floor::WoodGrey => Material::new(Rgb8::from_u32(0xa8a08b), 0.7, Surface::Planks),
        Floor::WoodOak => Material::new(Rgb8::from_u32(0xbb9668), 0.6, Surface::Planks),
        Floor::WoodPainted => Material::new(Rgb8::from_u32(0xa6b0ab), 0.65, Surface::Planks),
        Floor::TilesBeige => Material::new(Rgb8::from_u32(0xd7cdb8), 0.35, Surface::Tiles),
        Floor::TilesWhite => Material::new(Rgb8::from_u32(0xe8e8e1), 0.3, Surface::Tiles),
        _ => Material::new(Rgb8::from_u32(0xd9d3c6), 0.85, Surface::Floor),
    }
}

fn covering_material(covering: Covering) -> Material {
    match covering {
        Covering::Paint(color) => Material::paint(color),
        Covering::Tiles => TILES,
    }
}

/// Builds the floors and walls of every room, then the free partitions.
pub(crate) fn build(builder: &mut Builder, plan: &Plan, layout: &WallLayout) {
    let openings = wall_openings(plan);
    for walls in &layout.rooms {
        let Some(Element::Room(room)) = plan.elements.get(walls.element) else {
            continue;
        };
        let element = builder.element_tag(walls.element);
        floor(builder, room, walls, element);
        room_walls(builder, room, walls, &openings, element);
    }
    for (index, element) in plan.elements.iter().enumerate() {
        if let Element::Wall(wall) = element {
            free_wall(builder, plan, wall, builder.element_tag(index));
        }
    }
}

fn floor(builder: &mut Builder, room: &Room, walls: &RoomWalls, element: u16) {
    let tag = Tag {
        element,
        room: builder.room_slot(walls.element),
        ..Tag::default()
    };
    let mut p = Painter::new(&mut builder.opaque, floor_material(room), tag);
    p.polygon(&walls.points, 0.0, true, room.floor_angle);
    p.material = SLAB;
    let n = walls.points.len();
    for i in 0..n {
        let (a, b) = (walls.points[i], walls.points[(i + 1) % n]);
        let normal = walls.normal(i);
        let out = [
            [a[0], -SLAB_DEPTH, a[1]],
            [b[0], -SLAB_DEPTH, b[1]],
            [b[0], 0.0, b[1]],
            [a[0], 0.0, a[1]],
        ];
        p.quad(
            out,
            [[0.0; 2]; 4],
            Some([normal[0], 0.0, normal[1]]),
            -SLAB_DEPTH,
        );
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
            let mut p = Painter::new(&mut builder.opaque, TRIM, tag);
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
        let mut p = Painter::new(&mut builder.opaque, WALL_OUTER, tag);
        let outer = Some(WALL_OUTER);
        p.prism(corner.quad, 0.0, height, [outer; 4], Some(WALL_CAP), 0.0);
    }
}

fn free_wall(builder: &mut Builder, plan: &Plan, wall: &FreeWall, element: u16) {
    let (dx, dy) = (wall.x2 - wall.x, wall.y2 - wall.y);
    let len = dx.hypot(dy);
    if len < 0.5 {
        return;
    }
    let n = [-dy / len, dx / len];
    let t = wall.thickness / 2.0;
    let side = |x: f64, y: f64, k: f64| [x + n[0] * k, y + n[1] * k];
    let q = [
        side(wall.x, wall.y, t),
        side(wall.x2, wall.y2, t),
        side(wall.x2, wall.y2, -t),
        side(wall.x, wall.y, -t),
    ];
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
    let mut p = Painter::new(&mut builder.opaque, WALL_OUTER, tag);
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
}
