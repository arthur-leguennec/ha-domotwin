//! The fictional split-level house of `examples/` (D-078): an entry level, a half level down that
//! opens onto the back garden and a half level up over it.

#![allow(clippy::unwrap_used)]

use domotwin_core::coverage::home::{Home, Spot};
use domotwin_core::plan::read_plan;
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::{SceneOptions, build_home};
use serde_json::{Value, json};

const LOWER: &str = include_str!("../../../examples/split-level-lower.domotwin.json");
const ENTRY: &str = include_str!("../../../examples/split-level-entry.domotwin.json");
const UPPER: &str = include_str!("../../../examples/split-level-upper.domotwin.json");

/// The storeys as stored, lowest first: half a storey down, the entry level, half a storey up.
fn storeys() -> Value {
    let plan = |text: &str| serde_json::from_str::<Value>(text).unwrap();
    json!([
        { "id": "lower", "elevation": -140, "plan": plan(LOWER) },
        { "id": "entry", "elevation": 0, "plan": plan(ENTRY) },
        { "id": "upper", "elevation": 140, "plan": plan(UPPER) }
    ])
}

/// The highest and lowest points of a mesh's vertices that fall within a box on the plan.
fn heights_within(mesh: &Mesh, lo: [f32; 2], hi: [f32; 2]) -> Option<(f32, f32)> {
    mesh.positions
        .iter()
        .filter(|p| p[0] > lo[0] && p[0] < hi[0] && p[2] > lo[1] && p[2] < hi[1])
        .fold(None, |acc, p| {
            let (low, high) = acc.unwrap_or((p[1], p[1]));
            Some((low.min(p[1]), high.max(p[1])))
        })
}

/// The top of the retaining walls within a box on the plan: the stone (the colour of a paving's
/// edge) standing more than 20 cm over its floor.
fn retaining_within(mesh: &Mesh, lo: [f32; 2], hi: [f32; 2]) -> Option<f32> {
    mesh.positions
        .iter()
        .zip(&mesh.colors)
        .filter(|(p, c)| {
            c[..3] == [0xa9, 0xa2, 0x94]
                && p[1] > 20.0
                && p[0] > lo[0]
                && p[0] < hi[0]
                && p[2] > lo[1]
                && p[2] < hi[1]
        })
        .map(|(p, _)| p[1])
        .reduce(f32::max)
}

#[test]
fn the_split_level_house_is_read_and_built() {
    let plans: Vec<_> = [LOWER, ENTRY, UPPER]
        .iter()
        .map(|text| read_plan(text.as_bytes()).unwrap())
        .collect();
    let storeys: Vec<_> = plans.iter().zip([-140.0, 0.0, 140.0]).collect();
    let storeys: Vec<_> = storeys.iter().map(|(p, e)| (*p, *e)).collect();
    let scene = build_home(&storeys, &SceneOptions::default());
    assert_eq!(scene.parts.len(), 3);
    // The back garden, down with the half level, meets the upper garden behind the entry level
    // along a retaining wall of stone, on the upper garden's side: from its lawn up to the
    // other's lawn (136 cm over its floor), its coping a little over it; the terrace there is no
    // ground.
    let lower = &scene.parts[0];
    let (low, high) = heights_within(&lower.opaque, [680.0, 1290.0], [699.0, 1310.0]).unwrap();
    assert!(low < -3.0 && (high - 139.0).abs() < 0.5, "{low} {high}");
    let (_, terrace) = heights_within(&lower.opaque, [680.0, 790.0], [699.0, 810.0]).unwrap();
    assert!((terrace - 139.0).abs() < 0.5, "{terrace}");
    assert!(retaining_within(&lower.opaque, [680.0, 790.0], [699.0, 1310.0]).is_some());
    // None against the family room, nor where the ground beyond is nobody's.
    assert!(retaining_within(&lower.opaque, [701.0, 780.0], [1310.0, 820.0]).is_none());
    assert!(retaining_within(&lower.opaque, [1590.0, 790.0], [1620.0, 1310.0]).is_none());
    assert!(retaining_within(&lower.opaque, [690.0, 1290.0], [1620.0, 1320.0]).is_some());
    assert!(retaining_within(&lower.opaque, [701.0, 1290.0], [1620.0, 1320.0]).is_none());
    // The upper garden has none: the ground beyond it is lower.
    let entry = &scene.parts[1];
    assert!(retaining_within(&entry.opaque, [-400.0, -500.0], [1700.0, 1400.0]).is_none());
    // A roof over the entry level and one over the upper level, none over the lower one.
    let mut covered: Vec<usize> = scene.roofs.iter().map(|r| r.storey).collect();
    covered.sort_unstable();
    covered.dedup();
    assert_eq!(covered, [1, 2]);
}

#[test]
fn a_floor_is_counted_only_where_one_level_lies_over_the_other() {
    let home = Home::read(&storeys());
    let middle = |room: &str| home.middle(home.room_index(room).unwrap()).unwrap();
    let (living, family, bedroom) = (middle("s-living"), middle("s-family"), middle("s-bedroom"));
    // The entry level and the half levels lie beside each other: no floor between them, a wall.
    assert_eq!(home.floors(&living, &bedroom), 0);
    assert_eq!(home.floors(&living, &family), 0);
    assert!(home.walls(&living, &family) >= 1.0);
    // The upper level lies over the lower one: its floor.
    assert_eq!(home.floors(&family, &bedroom), 1);
    assert_eq!(home.floors(&bedroom, &family), 1);
    // A place on the entry level right under the upper level's floor, beside it: none.
    let under = Spot {
        storey: 1,
        x: 650.0,
        y: 400.0,
        z: 130.0,
    };
    assert_eq!(home.floors(&under, &bedroom), 0);
}

#[test]
fn a_full_storey_over_a_larger_one_is_a_floor_over_all_of_it() {
    // A ground floor 10 m wide, a floor over its left half only.
    let square = |x1: i32| json!([[0, 0], [x1, 0], [x1, 800], [0, 800]]);
    let home = Home::read(&json!([
        { "id": "ground", "elevation": 0, "plan": { "rooms": [{ "id": "hall", "outline": square(1000) }] } },
        { "id": "first", "elevation": 280, "plan": { "rooms": [{ "id": "study", "outline": square(500) }] } }
    ]));
    let at = |storey: usize, x: f64, z: f64| Spot {
        storey,
        x,
        y: 400.0,
        z,
    };
    // The line rises through the ground floor's ceiling where the first floor has no room: the
    // floor is counted all the same.
    assert_eq!(home.floors(&at(0, 900.0, 110.0), &at(1, 450.0, 390.0)), 1);
    assert_eq!(home.floors(&at(0, 200.0, 110.0), &at(1, 250.0, 390.0)), 1);
}

#[test]
fn no_floor_two_storeys_over_a_room_and_one_under_a_wall_between_two() {
    let at = |storey: usize, x: f64, z: f64| Spot {
        storey,
        x,
        y: 200.0,
        z,
    };
    let rect = |x0: i32, x1: i32| json!([[x0, 0], [x1, 0], [x1, 400], [x0, 400]]);
    // A basement under the whole home; two wings round a courtyard (a place outside); a first
    // floor over the right wing. From the left wing up to the first floor, the line rises over
    // the courtyard: the basement's ceiling is far under it, open air.
    let home = Home::read(&json!([
        { "id": "basement", "elevation": -280, "plan": { "rooms": [{ "id": "cellar", "outline": rect(0, 1200) }] } },
        { "id": "ground", "elevation": 0, "plan": { "rooms": [
            { "id": "left", "outline": rect(0, 400) },
            { "id": "yard", "outline": rect(400, 800), "outside": true },
            { "id": "right", "outline": rect(800, 1200) }
        ] } },
        { "id": "first", "elevation": 280, "plan": { "rooms": [{ "id": "up", "outline": rect(800, 1200) }] } }
    ]));
    assert_eq!(home.floors(&at(1, 200.0, 110.0), &at(2, 1000.0, 390.0)), 0);
    // From the basement, under the courtyard: its ground (the basement's ceiling), then the first
    // floor's over the right wing.
    assert_eq!(home.floors(&at(0, 600.0, -170.0), &at(2, 1000.0, 390.0)), 2);
    // Two storeys of two rooms a wall apart: a line through the wall between them goes through
    // the floor all the same.
    let two = |id: &str, elevation: i32| {
        json!({ "id": id, "elevation": elevation, "plan": { "rooms": [
            { "id": format!("{id}-a"), "outline": rect(0, 400) },
            { "id": format!("{id}-b"), "outline": rect(420, 800) }
        ] } })
    };
    let home = Home::read(&json!([two("ground", 0), two("first", 280)]));
    let (from, to) = (at(0, 200.0, 110.0), at(1, 545.9, 390.0));
    let t = (280.0 - from.z) / (to.z - from.z);
    assert!((from.x + (to.x - from.x) * t - 410.0).abs() < 1.0);
    assert_eq!(home.floors(&from, &to), 1);
    // Past the home's side, it is not.
    assert_eq!(home.floors(&at(0, 780.0, 110.0), &at(1, 1000.0, 390.0)), 0);
}

/// A storey of one room `[x0, x1] × [0, 800]` at `elevation`.
fn storey(id: &str, elevation: f64, x0: i32, x1: i32) -> Value {
    json!({ "id": id, "elevation": elevation, "plan": { "rooms": [{ "id": format!("{id}-room"),
        "outline": [[x0, 0], [x1, 0], [x1, 800], [x0, 800]] }] } })
}

#[test]
fn a_half_level_between_hides_no_ceiling_and_wings_at_one_height_are_one_level() {
    let at = |storey: usize, x: f64, z: f64| Spot {
        storey,
        x,
        y: 400.0,
        z,
    };
    // A half level beside the ground floor, a first floor over half of it: the ground floor's
    // ceiling is still crossed.
    let home = Home::read(&json!([
        storey("ground", 0.0, 0, 1000),
        storey("half", 140.0, 1000, 1400),
        storey("first", 280.0, 0, 500)
    ]));
    assert_eq!(home.floors(&at(0, 900.0, 110.0), &at(2, 450.0, 390.0)), 1);
    // Two wings at one height, a floor over one: one floor between them and it, either way.
    let home = Home::read(&json!([
        storey("a", 0.0, 0, 1000),
        storey("b", 0.0, 2000, 3000),
        storey("f", 280.0, 0, 500)
    ]));
    assert_eq!(home.floors(&at(0, 900.0, 110.0), &at(2, 450.0, 390.0)), 1);
    assert_eq!(home.floors(&at(2, 450.0, 390.0), &at(0, 900.0, 110.0)), 1);
    assert_eq!(home.floors(&at(0, 500.0, 110.0), &at(1, 2500.0, 110.0)), 0);
    // A place right on its storey's floor (a piece with no height) still has that floor under it.
    assert_eq!(home.floors(&at(2, 250.0, 280.0), &at(0, 250.0, 110.0)), 1);
}

#[test]
fn a_balcony_over_a_terrace_is_no_ground_to_hold_back() {
    let plan = |value: Value| read_plan(value.to_string().as_bytes()).unwrap();
    let ground = plan(json!({
        "format": "domotwin-plan", "version": 1,
        "rooms": [
            { "id": "living", "outline": [[0, 0], [500, 0], [500, 400], [0, 400]] },
            { "id": "terrace", "outside": true, "floor": { "material": "paving" },
              "outline": [[0, 400], [400, 400], [400, 600], [0, 600]] }
        ]
    }));
    let first = plan(json!({
        "format": "domotwin-plan", "version": 1,
        "rooms": [
            { "id": "bedroom", "outline": [[0, 0], [500, 0], [500, 400], [0, 400]] },
            { "id": "balcony", "outside": true, "railing": true, "floor": { "material": "paving" },
              "outline": [[0, 400], [500, 400], [500, 700], [0, 700]] },
            { "id": "roof-garden", "outside": true,
              "outline": [[500, 400], [700, 400], [700, 700], [500, 700]] }
        ]
    }));
    let scene = build_home(&[(&ground, 0.0), (&first, 280.0)], &SceneOptions::default());
    for part in &scene.parts {
        assert!(retaining_within(&part.opaque, [-100.0, -100.0], [900.0, 900.0]).is_none());
    }
}

#[test]
fn a_balcony_holds_back_no_ground_and_a_storey_at_no_height_is_at_0() {
    let plan = |value: Value| read_plan(value.to_string().as_bytes()).unwrap();
    // A balcony beside a garden higher up: no wall along it, it is over the ground.
    let low = plan(json!({
        "format": "domotwin-plan", "version": 1,
        "rooms": [
            { "id": "room", "outline": [[0, 0], [500, 0], [500, 400], [0, 400]] },
            { "id": "balcony", "outside": true, "railing": true, "floor": { "material": "paving" },
              "outline": [[0, 400], [400, 400], [400, 600], [0, 600]] }
        ]
    }));
    let high = plan(json!({
        "format": "domotwin-plan", "version": 1,
        "rooms": [
            { "id": "garden", "outside": true,
              "outline": [[-300, 600], [700, 600], [700, 1000], [-300, 1000]] }
        ]
    }));
    let scene = build_home(&[(&low, 0.0), (&high, 140.0)], &SceneOptions::default());
    for part in &scene.parts {
        assert!(retaining_within(&part.opaque, [-400.0, -100.0], [800.0, 1100.0]).is_none());
    }
    // A storey whose height is not a number stands at 0: its garden's wall is no higher.
    let terrace = plan(json!({
        "format": "domotwin-plan", "version": 1,
        "rooms": [
            { "id": "terrace", "outside": true, "floor": { "material": "paving" },
              "outline": [[0, 400], [400, 400], [400, 600], [0, 600]] }
        ]
    }));
    for elevation in [f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
        let scene = build_home(
            &[(&terrace, -140.0), (&high, elevation)],
            &SceneOptions::default(),
        );
        for part in &scene.parts {
            assert!(
                part.opaque
                    .positions
                    .iter()
                    .flatten()
                    .all(|v| v.is_finite())
            );
        }
    }
}
