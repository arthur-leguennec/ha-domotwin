//! The places outside (M18, D-077): a fictional house with a terrace on its south side, a garden
//! drawn around it all, and a balcony with its railing.

#![allow(clippy::unwrap_used, clippy::panic)]

use domotwin_core::coverage::home::{Home, Spot};
use domotwin_core::error::ErrorCode;
use domotwin_core::geometry::walls::WallLayout;
use domotwin_core::plan::{Element, Floor, read_plan};
use domotwin_core::robots::{MOWER, Robots, Task, VACUUM, Wanted};
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::{SceneOptions, build_home, build_scene};
use serde_json::{Value, json};

/// A living room and a kitchen side by side (900 × 400 cm), a deck south of the living room, a
/// garden drawn round the whole, a balcony west of the kitchen with its railing.
fn house() -> Value {
    json!({
        "format": "domotwin-plan", "version": 1, "name": "Fictional house",
        "rooms": [
            { "id": "living", "name": "Living room", "outline": [[0, 0], [500, 0], [500, 400], [0, 400]] },
            { "id": "kitchen", "name": "Kitchen", "outline": [[500, 0], [900, 0], [900, 400], [500, 400]] },
            { "id": "garden", "name": "Garden", "outside": true,
              "outline": [[-400, -300], [1300, -300], [1300, 1200], [-400, 1200]] },
            { "id": "deck", "name": "Deck", "outside": true, "floor": { "material": "decking" },
              "outline": [[0, 400], [500, 400], [500, 700], [0, 700]] },
            { "id": "balcony", "name": "Balcony", "outside": true, "railing": true,
              "floor": { "material": "paving" },
              "outline": [[900, 0], [1100, 0], [1100, 300], [900, 300]] }
        ],
        "doors": [
            { "id": "garden-door", "from": [150, 400], "to": [240, 400], "room": "living" }
        ],
        "items": [
            { "id": "oak", "kind": "tree", "at": [-200, 1000], "size": [400, 400, 800] },
            { "id": "pool", "kind": "pool", "at": [800, 900], "size": [600, 300, 150] }
        ]
    })
}

fn plan(value: &Value) -> domotwin_core::plan::Plan {
    read_plan(value.to_string().as_bytes()).unwrap()
}

fn plan_of(value: &Value) -> domotwin_core::plan::Plan {
    plan(value)
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

#[test]
fn places_outside_are_read_with_a_lawn_by_default() {
    let plan = plan(&house());
    let rooms: Vec<_> = plan.rooms().collect();
    assert!(!rooms[0].outside && rooms[2].outside);
    assert_eq!(rooms[2].floor, Floor::Lawn);
    assert_eq!(rooms[3].floor, Floor::Decking);
    assert!(rooms[4].railing && !rooms[2].railing);
    // A railing is for a place outside only; a room keeps its plain floor.
    let mut inside = house();
    inside["rooms"][0]["railing"] = true.into();
    assert!(!plan_rooms(&inside)[0].railing);
    assert_eq!(plan_rooms(&inside)[0].floor, Floor::Plain);
    // A tree may be as tall as a house; a sofa may not.
    let mut tall = house();
    tall["items"][1] =
        json!({ "id": "sofa", "kind": "sofa", "at": [100, 100], "size": [200, 90, 800] });
    let err = read_plan(tall.to_string().as_bytes()).unwrap_err();
    assert_eq!(err.code, ErrorCode::ItemHeight);
    let mut taller = house();
    taller["items"][0]["size"] = json!([400, 400, 1001]);
    assert!(read_plan(taller.to_string().as_bytes()).is_err());
    // A gate as open as the plan says; a sofa has no such thing.
    let mut gate = house();
    gate["items"][1] = json!({ "id": "gate", "kind": "gate", "at": [0, 1100], "size": [300, 6, 150], "open": 0.5 });
    let open = |value: &Value| match read_plan(value.to_string().as_bytes())
        .unwrap()
        .elements
        .last()
    {
        Some(Element::Furniture(f)) => f.open,
        _ => panic!("a piece"),
    };
    assert_eq!(open(&gate), Some(50));
    gate["items"][1]["kind"] = "sofa".into();
    gate["items"][1]["size"] = json!([200, 90, 80]);
    assert_eq!(open(&gate), None);
}

fn plan_rooms(value: &Value) -> Vec<domotwin_core::plan::Room> {
    plan(value).rooms().cloned().collect()
}

#[test]
fn places_outside_have_no_walls_and_the_rooms_beside_them_have_facades() {
    let plan = plan(&house());
    let layout = WallLayout::new(&plan);
    let [living, kitchen, garden, deck, balcony] = &layout.rooms[..] else {
        panic!("five rooms");
    };
    for place in [garden, deck, balcony] {
        assert!(place.outside && place.sides.iter().all(Option::is_none));
        assert!(place.corners.is_empty());
    }
    // The living room's south side, against the deck, is a façade built outward; its east side,
    // against the kitchen, a partition.
    let south = living.sides[2].as_ref().unwrap();
    assert!(south.iter().all(|band| !band.inner && band.o0 == 0.0));
    assert!(
        living.sides[1]
            .as_ref()
            .unwrap()
            .iter()
            .any(|band| band.inner)
    );
    // The kitchen's east side, against the balcony: a façade too.
    assert!(
        kitchen.sides[1]
            .as_ref()
            .unwrap()
            .iter()
            .all(|band| !band.inner)
    );
}

#[test]
fn the_scene_draws_grounds_low_no_ceiling_outside_and_a_railing() {
    let plan = plan(&house());
    let scene = build_scene(&plan, &SceneOptions::default());
    let part = &scene.parts[0];
    // The lawn a little under the floors; the deck just under them, not in their plane, and a
    // little over the garden it lies in. (Their corners, where the floors' vertices are.)
    let (lawn_low, lawn_high) =
        heights_within(&part.opaque, [-410.0, 1190.0], [-390.0, 1210.0]).unwrap();
    assert!(
        lawn_high < -3.0 && lawn_low >= -6.5,
        "{lawn_low} {lawn_high}"
    );
    assert!((lawn_high + 4.0).abs() < 0.01, "{lawn_high}");
    let (_, deck_high) = heights_within(&part.opaque, [-5.0, 695.0], [5.0, 705.0]).unwrap();
    assert!(deck_high > -1.5 && deck_high < -0.1, "{deck_high}");
    // A gravel path in the lawn: over it, not in its plane.
    let mut path = house();
    path["rooms"].as_array_mut().unwrap().push(
        json!({ "id": "path", "outside": true, "floor": { "material": "gravel" },
            "outline": [[-300, 800], [-200, 800], [-200, 1100], [-300, 1100]] }),
    );
    let path = build_scene(&plan_of(&path), &SceneOptions::default());
    let (_, path_high) =
        heights_within(&path.parts[0].opaque, [-305.0, 1095.0], [-295.0, 1105.0]).unwrap();
    assert!(path_high > -3.95 && path_high < -1.5, "{path_high}");
    // Ceilings over the rooms alone.
    let [lo, hi] = part.ceiling.bounds();
    assert!(lo[0] >= -0.1 && hi[0] <= 900.1 && lo[2] >= -0.1 && hi[2] <= 400.1);
    // The balcony's railing: glass and posts on its three free sides, none against the kitchen.
    let glass = heights_within(&part.transparent, [905.0, 5.0], [1110.0, 310.0]).unwrap();
    assert!(glass.1 > 90.0);
    assert!(heights_within(&part.transparent, [895.0, 100.0], [902.0, 200.0]).is_none());
    // Drawn from the façade's outer face, on its lawn: still none along the house, and its posts
    // on its ground.
    let mut apart = house();
    apart["rooms"][4] = json!({ "id": "balcony", "outside": true, "railing": true,
        "outline": [[920, 0], [1100, 0], [1100, 300], [920, 300]] });
    let apart = build_scene(&plan_of(&apart), &SceneOptions::default());
    let part = &apart.parts[0];
    assert!(heights_within(&part.transparent, [915.0, 100.0], [925.0, 200.0]).is_none());
    let (low, _) = heights_within(&part.transparent, [925.0, 5.0], [1110.0, 310.0]).unwrap();
    assert!((low - 4.0).abs() < 0.1, "{low}");
    // The home's area leaves the places outside out; the grounds take them in.
    let [home_lo, home_hi] = scene.home_area.unwrap();
    assert!(home_lo[1] >= -21.0 && home_hi[1] <= 421.0 && home_hi[0] <= 921.0);
    assert_eq!(scene.grounds.unwrap(), [[-400.0, -300.0], [1300.0, 1200.0]]);
    // The garden's label is out of the house.
    let garden = scene.rooms.iter().position(|r| r == "garden").unwrap();
    let [x, y] = scene.labels[garden];
    assert!(
        !((0.0..=900.0).contains(&x) && (0.0..=400.0).contains(&y)),
        "{x} {y}"
    );
    // The oak stands on the lawn, a little under the floors.
    let (oak_low, _) = heights_within(&part.opaque, [-250.0, 950.0], [-150.0, 1050.0]).unwrap();
    assert!((oak_low + 4.0).abs() < 0.1, "{oak_low}");
    // What stands in the house is in its room, not in the garden around it.
    let pool = scene.elements.iter().find(|e| e.id == "pool").unwrap();
    assert_eq!(usize::from(pool.room), garden + 1);
    assert_eq!(
        scene.elements.iter().find(|e| e.id == "oak").unwrap().room,
        pool.room
    );
    // With the storeys of a home: the roof covers the rooms only.
    let home = build_home(&[(&plan, 0.0)], &SceneOptions::default());
    assert!(!home.roofs.is_empty());
    for roof in &home.roofs {
        let [rlo, rhi] = roof.mesh.bounds();
        assert!(
            rhi[2] < 500.0 && rlo[0] > -100.0 && rhi[0] < 1000.0,
            "{rlo:?} {rhi:?}"
        );
    }
    assert!(
        plan.elements
            .iter()
            .any(|e| matches!(e, Element::Room(r) if r.outside))
    );
}

#[test]
fn walkers_find_the_rooms_before_the_garden_around_them() {
    let plan = plan(&house());
    let scene = build_scene(&plan, &SceneOptions::default());
    let floor = scene.walk_floor(&plan).unwrap();
    assert!(floor.in_room("living", [250.0, 200.0]));
    assert!(!floor.in_room("garden", [250.0, 200.0]));
    assert!(floor.in_room("garden", [-200.0, 600.0]));
    // The deck in the garden drawn round it: the deck's.
    assert!(floor.in_room("deck", [250.0, 600.0]));
    assert!(!floor.in_room("garden", [250.0, 600.0]));
    let spot = floor.room_spot("garden").unwrap();
    assert!(!((0.0..=900.0).contains(&spot[0]) && (0.0..=400.0).contains(&spot[1])));
    // Through the garden door onto the deck, and on into the garden: no wall between them.
    let path = floor.path([200.0, 200.0], [-200.0, 600.0]);
    assert!(path.len() >= 3, "{path:?}");
    // The garden is swept round the house, never through it.
    let lanes = floor.sweep("garden", [-300.0, -200.0], 60.0, 20.0);
    assert!(!lanes.is_empty());
    assert!(
        lanes
            .iter()
            .all(|p| !((1.0..899.0).contains(&p[0]) && (1.0..399.0).contains(&p[1]))),
        "a lane in the house"
    );
}

#[test]
fn radios_count_no_wall_between_places_outside_and_one_into_the_house() {
    let storeys = json!([{ "id": "ground", "elevation": 0, "plan": house() }]);
    let home = Home::read(&storeys);
    let at = |x: f64, y: f64| Spot {
        storey: 0,
        x,
        y,
        z: 100.0,
    };
    let garden = home.room_index("garden").unwrap();
    assert_eq!(home.room_at(0, [250.0, 200.0]), home.room_index("living"));
    assert_eq!(home.room_at(0, [-200.0, 600.0]), Some(garden));
    assert_eq!(home.room_at(0, [250.0, 600.0]), home.room_index("deck"));
    // The deck and the garden, side by side: open; the deck and the living room: its façade.
    assert!(home.walls(&at(250.0, 600.0), &at(250.0, 900.0)) < 0.01);
    let facade = home.walls(&at(400.0, 600.0), &at(400.0, 200.0));
    assert!((facade - 1.0).abs() < 0.01, "{facade}");
    // From the garden into the living room through its façade: one wall.
    let into = home.walls(&at(250.0, -200.0), &at(250.0, 200.0));
    assert!((into - 1.0).abs() < 0.01, "{into}");
    // The garden's points are around the house.
    assert!(
        home.points(garden)
            .iter()
            .all(|p| !((0.0..=900.0).contains(&p.x) && (0.0..=400.0).contains(&p.y)))
    );
}

#[test]
fn a_gap_between_rooms_in_the_garden_round_them_is_one_wall() {
    // Two rooms drawn 20 cm apart (the wall between them), a garden round both.
    let plan = json!({
        "format": "domotwin-plan", "version": 1, "name": "Fictional house",
        "rooms": [
            { "id": "a", "outline": [[0, 0], [400, 0], [400, 400], [0, 400]] },
            { "id": "b", "outline": [[420, 0], [800, 0], [800, 400], [420, 400]] },
            { "id": "garden", "outside": true,
              "outline": [[-300, -300], [1100, -300], [1100, 700], [-300, 700]] }
        ]
    });
    let storeys = json!([{ "id": "ground", "elevation": 0, "plan": plan }]);
    let home = Home::read(&storeys);
    let at = |x: f64, y: f64| Spot {
        storey: 0,
        x,
        y,
        z: 100.0,
    };
    assert_eq!(home.room_at(0, [410.0, 200.0]), home.room_index("garden"));
    let between = home.walls(&at(200.0, 200.0), &at(600.0, 200.0));
    assert!((between - 1.0).abs() < 0.01, "{between}");
    // Out into the garden: its façade.
    let round = home.walls(&at(200.0, 200.0), &at(200.0, 600.0));
    assert!((round - 1.0).abs() < 0.01, "{round}");
}

/// Whether `p` is in the house (900 × 400 cm from the origin), past its walls' middle.
fn in_house(p: [f64; 2]) -> bool {
    (1.0..899.0).contains(&p[0]) && (1.0..399.0).contains(&p[1])
}

#[test]
fn a_robot_mower_mows_the_lawn_round_the_house_and_never_goes_in() {
    let plan = plan(&house());
    let scene = build_scene(&plan, &SceneOptions::default());
    let floor = scene.walk_floor(&plan).unwrap();
    // The ground: the lawn a little under the floors, the deck just under, the rooms at theirs.
    assert!((floor.level_at([-200.0, 600.0]) + 4.0).abs() < 1e-9);
    assert!((floor.level_at([250.0, 600.0]) + 1.5).abs() < 1e-9);
    assert!(floor.level_at([250.0, 200.0]).abs() < 1e-9);
    // Docked in the garden; mowing as its lawn mower says.
    let dock = [-200.0, 600.0];
    let floors = vec![Some(floor.outdoors(&[dock]))];
    let wanted = |task| Wanted {
        id: "mower".into(),
        storey: 0,
        dock,
        dock_heading: 0.0,
        task,
    };
    let mut mowers = Robots::new(MOWER);
    let mowing = Task::of_state("mowing", vec!["garden".into()]);
    mowers.set(&[wanted(mowing)], &floors, true, false);
    assert!(mowers.moving());
    let mut sides = [false; 4];
    for _ in 0..6000 {
        mowers.step(0.25, &floors, true);
        let r = &mowers.robots()[0];
        assert!(!in_house(r.at), "{:?}", r.at);
        assert_eq!(r.cleaning(), Some("garden"));
        // All round the house.
        let [x, y] = r.at;
        sides[0] |= y < -50.0;
        sides[1] |= x > 950.0;
        sides[2] |= y > 750.0;
        sides[3] |= x < -50.0;
    }
    assert_eq!(sides, [true; 4]);
    // Back to its dock, round the house still.
    mowers.set(
        &[wanted(Task::of_state("returning", Vec::new()))],
        &floors,
        true,
        false,
    );
    for _ in 0..4000 {
        mowers.step(0.25, &floors, true);
        assert!(!in_house(mowers.robots()[0].at));
    }
    assert!(mowers.robots()[0].home() && !mowers.moving());
    // Docked in the living room, it goes out through the garden door.
    let inside = [250.0, 250.0];
    let floors = vec![Some(floor.outdoors(&[inside]))];
    let mut mowers = Robots::new(MOWER);
    mowers.set(
        &[Wanted {
            dock: inside,
            ..wanted(Task::Clean(vec!["garden".into()]))
        }],
        &floors,
        true,
        false,
    );
    let mut out = false;
    for _ in 0..2000 {
        mowers.step(0.25, &floors, true);
        out |= !in_house(mowers.robots()[0].at);
    }
    assert!(out);
}

#[test]
fn a_robot_vacuum_cleans_the_house_and_never_goes_out_through_the_garden_door() {
    let plan = plan(&house());
    let scene = build_scene(&plan, &SceneOptions::default());
    let floor = scene.walk_floor(&plan).unwrap();
    let dock = [250.0, 250.0];
    // The garden door leads out (no door to the kitchen): on its floor, only the living room.
    assert!(floor.reachable_ids(dock).contains(&"garden".to_string()));
    let indoors = floor.indoors(&[dock]);
    assert_eq!(indoors.reachable_ids(dock), ["living"]);
    let floors = vec![Some(indoors)];
    let mut vacuums = Robots::new(VACUUM);
    vacuums.set(
        &[Wanted {
            id: "vacuum".into(),
            storey: 0,
            dock,
            dock_heading: 0.0,
            task: Task::of_state("cleaning", Vec::new()),
        }],
        &floors,
        true,
        false,
    );
    assert!(vacuums.moving());
    for _ in 0..4000 {
        vacuums.step(0.25, &floors, true);
        let r = &vacuums.robots()[0];
        assert!(in_house(r.at), "{:?}", r.at);
    }
}

#[test]
fn a_camera_in_a_room_drawn_after_the_garden_round_it_sees_its_room() {
    use domotwin_core::devices::{CameraView, camera_cone};
    // The garden first in the plan, a room in it, a camera in the room without its room said.
    let value = json!({
        "format": "domotwin-plan", "version": 1, "name": "Fictional house",
        "rooms": [
            { "id": "garden", "outside": true,
              "outline": [[-400, -400], [1000, -400], [1000, 800], [-400, 800]] },
            { "id": "room", "outline": [[0, 0], [600, 0], [600, 400], [0, 400]] }
        ],
        "items": [{ "id": "cam", "kind": "spotlight", "at": [25, 100], "size": [10, 20, 10],
                    "rotation": -90 }]
    });
    let plan = plan(&value);
    let scene = build_scene(&plan, &SceneOptions::default());
    let cam = plan.elements.iter().position(|e| e.id() == "cam").unwrap();
    let cone = camera_cone(&plan, &scene, cam, CameraView::new(Some(60.0), Some(800.0))).unwrap();
    for p in &cone {
        assert!(
            (-1.0..=601.0).contains(&p[0]) && (-1.0..=401.0).contains(&p[1]),
            "{p:?}"
        );
    }
}
