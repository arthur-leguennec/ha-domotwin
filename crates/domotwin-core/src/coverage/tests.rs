use serde_json::{Value, json};

use super::home::{Home, Spot};
use super::*;

const DEMO: &str = include_str!("../../../../examples/demo-apartment.domotwin.json");
const UPPER: &str = include_str!("../../../../examples/demo-upper-floor.domotwin.json");
const LOWER: &str = include_str!("../../../../examples/split-level-lower.domotwin.json");
const ENTRY: &str = include_str!("../../../../examples/split-level-entry.domotwin.json");
const SPLIT_UPPER: &str = include_str!("../../../../examples/split-level-upper.domotwin.json");
/// What the integration's geometry finds (`scripts/make-coverage-fixture.py`).
const FIXTURE: &str = include_str!("../../../../tests/fixtures/coverage-walls.json");

fn plan(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

/// The demo apartment alone, as stored.
fn apartment() -> Value {
    json!([{ "id": "ground", "elevation": 0, "plan": plan(DEMO), "layout": {} }])
}

/// The storeys of the fixture, their plans read.
fn fixture_storeys(fixture: &Value) -> Value {
    let storeys = fixture["storeys"].as_array().unwrap();
    Value::Array(
        storeys
            .iter()
            .map(|storey| {
                let mut storey = storey.clone();
                storey["plan"] = match storey["plan"].as_str().unwrap() {
                    "examples/demo-apartment.domotwin.json" => plan(DEMO),
                    "examples/demo-upper-floor.domotwin.json" => plan(UPPER),
                    "examples/split-level-lower.domotwin.json" => plan(LOWER),
                    "examples/split-level-entry.domotwin.json" => plan(ENTRY),
                    "examples/split-level-upper.domotwin.json" => plan(SPLIT_UPPER),
                    other => panic!("no plan {other}"),
                };
                storey
            })
            .collect(),
    )
}

fn spot_of(value: &Value) -> Spot {
    let v: Vec<f64> = value
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_f64().unwrap())
        .collect();
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Spot {
        storey: v[0] as usize,
        x: v[1],
        y: v[2],
        z: v[3],
    }
}

fn close(a: &Spot, b: &Spot) -> bool {
    a.storey == b.storey
        && (a.x - b.x).abs() < 1e-5
        && (a.y - b.y).abs() < 1e-5
        && (a.z - b.z).abs() < 1e-5
}

#[test]
fn counts_the_walls_the_integration_counts() {
    let fixture = plan(FIXTURE);
    let home = Home::read(&fixture_storeys(&fixture));
    let rooms: Vec<&str> = home.rooms.iter().map(|r| r.id.as_str()).collect();
    let expected: Vec<&str> = fixture["rooms"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap())
        .collect();
    assert_eq!(rooms, expected);
    for (k, room) in home.rooms.iter().enumerate() {
        let points = home.points(k);
        let wanted = fixture["points"][&room.id].as_array().unwrap();
        assert_eq!(points.len(), wanted.len(), "{}", room.id);
        for (p, w) in points.iter().zip(wanted) {
            assert!(close(p, &spot_of(w)), "{}: {p:?} {w}", room.id);
        }
        let middle = home.middle(k).unwrap();
        assert!(close(&middle, &spot_of(&fixture["middles"][&room.id])));
    }
    for (piece, wanted) in fixture["pieces"].as_object().unwrap() {
        match (home.pieces.get(piece), wanted.is_null()) {
            (Some(found), false) => assert!(close(&found.spot, &spot_of(wanted)), "{piece}"),
            (None, true) => {}
            (found, _) => panic!("{piece}: {found:?} for {wanted}"),
        }
    }
    let spots: Vec<Spot> = fixture["spots"]
        .as_array()
        .unwrap()
        .iter()
        .map(spot_of)
        .collect();
    let walls = fixture["walls"].as_array().unwrap();
    let floors = fixture["floors"].as_array().unwrap();
    for (i, a) in spots.iter().enumerate() {
        for (j, b) in spots.iter().enumerate() {
            let wanted = walls[i][j].as_f64().unwrap();
            let found = home.walls(a, b);
            assert!(
                (found - wanted).abs() < 1e-9,
                "{a:?} → {b:?}: {found} ≠ {wanted}"
            );
            // The floors between them too (D-078).
            let wanted = floors[i][j].as_u64().unwrap();
            assert_eq!(home.floors(a, b) as u64, wanted, "{a:?} → {b:?}");
        }
    }
}

#[test]
fn counts_the_split_level_s_walls_and_floors_as_the_integration_does() {
    let fixture = plan(FIXTURE);
    let split = &fixture["split"];
    let home = Home::read(&fixture_storeys(split));
    let spots: Vec<Spot> = split["spots"]
        .as_array()
        .unwrap()
        .iter()
        .map(spot_of)
        .collect();
    assert!(spots.len() > 20);
    for (i, a) in spots.iter().enumerate() {
        for (j, b) in spots.iter().enumerate() {
            let wanted = split["walls"][i][j].as_f64().unwrap();
            assert!((home.walls(a, b) - wanted).abs() < 1e-9, "{a:?} → {b:?}");
            let wanted = split["floors"][i][j].as_u64().unwrap();
            assert_eq!(home.floors(a, b) as u64, wanted, "{a:?} → {b:?}");
        }
    }
}

#[test]
fn reads_leniently() {
    assert_eq!(Home::read(&Value::Null), Home::default());
    let home = Home::read(&json!([
        { "id": "a", "plan": { "rooms": [
            { "id": "flat", "outline": [[0, 0], [100, 0], [200, 0]] },
            { "id": "few", "outline": [[0, 0], [100, 0]] },
            { "outline": [[0, 0], [100, 0], [100, 100]] },
            { "id": "ok", "outline": [[0, 0], [300, 0], "x", [300, 300], [0, 300]] }
        ], "doors": [{ "from": [0, 0] }, "door"], "items": [{ "id": "x" }, { "at": [1, 1] }] } },
        "storey",
        { "id": 7, "elevation": "high", "plan": [] }
    ]));
    let rooms: Vec<&str> = home.rooms.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(rooms, ["ok"]);
    assert_eq!(home.rooms[0].outline.len(), 4);
    assert_eq!(home.storey_ids, ["a", "", "7"]);
    assert_eq!(home.elevations, [0.0, 0.0, 0.0]);
    assert!(home.pieces.is_empty());
    assert_eq!(advise(&Value::Null), Advice::default());
    assert_eq!(advise(&json!({ "radio": "zwave" })), Advice::default());
    let empty = advise(&json!({ "radio": "wifi" }));
    assert!(empty.rooms.is_empty() && empty.spots.is_empty() && empty.check.is_none());
}

#[test]
fn a_storey_without_a_plan_is_a_floor_and_keeps_its_overlay_s_pieces() {
    let home = Home::read(&json!([
        { "id": "ground", "plan": plan(DEMO) },
        { "id": "first", "elevation": 280, "plan": null,
          "layout": { "router": { "add": { "kind": "box", "size": [20, 20, 10] }, "at": [100, 100] } } },
        { "id": "second", "elevation": 560, "plan": plan(UPPER) }
    ]));
    assert_eq!(home.storey_ids, ["ground", "first", "second"]);
    let router = &home.pieces["router"].spot;
    assert_eq!(
        (router.storey, router.x, router.y, router.z),
        (1, 100.0, 100.0, 285.0)
    );
    let living = home.middle(home.room_index("living").unwrap()).unwrap();
    let office = home.middle(home.room_index("up-office").unwrap()).unwrap();
    assert_eq!(home.floors(&living, &office), 2);
}

#[test]
fn the_signal_falls_with_the_distance_the_walls_and_the_floors() {
    let fixture = plan(FIXTURE);
    let home = Home::read(&fixture_storeys(&fixture));
    let at = |storey: usize, x: f64, y: f64, z: f64| Spot { storey, x, y, z };
    let radio = at(0, 260.0, 260.0, 120.0);
    // A metre away in the same room: as loud as a phone at a metre.
    let near = Radio::Bluetooth.signal(&home, &at(0, 360.0, 260.0, 120.0), &radio);
    assert!((near - -59.0).abs() < 1e-9);
    // Closer than half a metre counts as half a metre.
    let closer = Radio::Bluetooth.signal(&home, &at(0, 261.0, 260.0, 120.0), &radio);
    assert!((closer - (-59.0 + 22.0 * 2.0_f64.log10())).abs() < 1e-9);
    // Into the bathroom through a wall: 4 dB more lost than the distance alone.
    let bathroom = at(0, 120.0, 590.0, 120.0);
    let walls = home.walls(&bathroom, &radio);
    assert!((walls - 1.0).abs() < 1e-9);
    let metres = bathroom.metres(&radio);
    let wanted = -59.0 - 22.0 * metres.log10() - 4.0;
    assert!((Radio::Bluetooth.signal(&home, &bathroom, &radio) - wanted).abs() < 1e-9);
    // Upstairs: a floor more, 15 dB; the other radios are louder.
    let above = at(1, 260.0, 260.0, 400.0);
    let lost = -59.0 - Radio::Bluetooth.signal(&home, &above, &radio);
    assert!((lost - (22.0 * 2.8_f64.log10() + 15.0)).abs() < 1e-9);
    let zigbee = Radio::Zigbee.signal(&home, &above, &radio);
    let wifi = Radio::Wifi.signal(&home, &above, &radio);
    assert!((zigbee - (-45.0 + -59.0 - Radio::Bluetooth.at_1m() - lost)).abs() < 1e-9);
    assert!((wifi - zigbee - 10.0).abs() < 1e-9);
}

#[test]
fn levels_by_radio() {
    assert_eq!(Level::of(Radio::Bluetooth, -80.0), Level::Good);
    assert_eq!(Level::of(Radio::Bluetooth, -80.1), Level::Fair);
    assert_eq!(Level::of(Radio::Bluetooth, -95.0), Level::Weak);
    assert_eq!(Level::of(Radio::Bluetooth, -100.5), Level::Out);
    assert_eq!(Level::of(Radio::Zigbee, -80.0), Level::Fair);
    assert_eq!(Level::of(Radio::Wifi, -80.0), Level::Weak);
    assert_eq!(Level::of(Radio::Wifi, -60.0), Level::Good);
    for level in [Level::Out, Level::Weak, Level::Fair, Level::Good] {
        assert_eq!(Level::from_name(level.name()), Some(level));
    }
    assert_eq!(Level::from_name("unknown"), None);
    assert!(Level::Good > Level::Fair && Level::Weak > Level::Out);
    assert_eq!(Level::Good.rank() - Level::Weak.rank(), 2);
    for radio in ["bluetooth", "zigbee", "wifi"] {
        assert!(Radio::from_name(radio).is_some());
    }
}

/// The advice as JSON, for the tests to read.
fn advice(input: &Value) -> Value {
    serde_json::from_str(&advise(input).write()).unwrap()
}

fn room<'a>(advice: &'a Value, id: &str) -> &'a Value {
    advice["rooms"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id)
        .unwrap()
}

#[test]
fn rooms_predicted_from_the_plan() {
    // One receiver in the living room, by the sideboard.
    let found = advice(&json!({
        "radio": "bluetooth",
        "storeys": apartment(),
        "radios": [{ "id": "proxy", "piece": "sideboard" }]
    }));
    assert_eq!(
        found["radios"],
        json!([{ "id": "proxy", "storey": "ground", "at": [205.0, 397.5], "room": "living" }])
    );
    let living = room(&found, "living");
    assert_eq!(living["level"], "good");
    assert!(living.get("measured").is_none());
    let predicted = |id: &str| room(&found, id)["predicted"].as_f64().unwrap();
    // Farther and behind more walls, fainter.
    assert!(predicted("living") > predicted("hall"));
    assert!(predicted("hall") > predicted("bedroom"));
    assert!(found.get("check").is_none() && found.get("agreement").is_none());
    // No radio at all: nothing predicted, every room out of reach.
    let none = advice(&json!({ "radio": "bluetooth", "storeys": apartment() }));
    assert!(
        none["rooms"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["level"] == "out" && r.get("predicted").is_none())
    );
}

#[test]
fn what_was_measured_comes_first_and_checks_the_model() {
    let storeys = apartment();
    let radios = json!([{ "id": "ap", "storey": "ground", "at": [300, 300] }]);
    let alone = advice(&json!({ "radio": "wifi", "storeys": storeys, "radios": radios }));
    let living = room(&alone, "living")["predicted"].as_f64().unwrap();
    let bedroom = room(&alone, "bedroom")["predicted"].as_f64().unwrap();
    // Two devices that hear the access point 9 dB fainter than the model says, a third 13 dB:
    // the model is moved by the median, and the rooms with them show what they measured.
    let washer = Home::read(&storeys).pieces["washer"].spot;
    let home = Home::read(&storeys);
    let ap = Spot {
        storey: 0,
        x: 300.0,
        y: 300.0,
        z: 120.0,
    };
    let at_washer = Radio::Wifi.signal(&home, &washer, &ap);
    let found = advice(&json!({
        "radio": "wifi", "storeys": storeys, "radios": radios,
        "measured": [
            { "piece": "washer", "signal": at_washer - 9.0, "name": "Washer" },
            { "room": "bedroom", "signal": bedroom - 9.0, "name": "Bedroom plug" },
            { "room": "living", "signal": living - 13.0, "name": "Living plug" },
            { "room": "nowhere", "signal": -50.0 },
            { "room": "hall" }
        ]
    }));
    assert_eq!(found["check"]["measurements"], 3);
    assert!((found["check"]["offset"].as_f64().unwrap() - -9.0).abs() < 0.11);
    assert!((found["check"]["error"].as_f64().unwrap() - 4.0 / 3.0).abs() < 0.11);
    let bathroom = room(&found, "bathroom");
    assert_eq!(bathroom["measured"]["name"], "Washer");
    let kitchen = room(&found, "kitchen");
    assert!(kitchen.get("measured").is_none());
    let moved = kitchen["predicted"].as_f64().unwrap()
        - room(&alone, "kitchen")["predicted"].as_f64().unwrap();
    assert!((moved - -9.0).abs() < 0.11);
    // A room measured shows what was measured, not what is predicted.
    let measured = room(&found, "living")["measured"]["signal"]
        .as_f64()
        .unwrap();
    assert_eq!(
        room(&found, "living")["level"],
        Level::of(Radio::Wifi, measured).name()
    );
    // One measurement only: checked, the model not moved.
    let one = advice(&json!({
        "radio": "wifi", "storeys": storeys, "radios": radios,
        "measured": [{ "room": "living", "signal": living - 20.0 }]
    }));
    assert_eq!(one["check"]["offset"], 0.0);
    assert!((one["check"]["error"].as_f64().unwrap() - 20.0).abs() < 0.11);
    // Far off: moved by 12 dB at most.
    let far = advice(&json!({
        "radio": "wifi", "storeys": storeys, "radios": radios,
        "measured": [{ "room": "living", "signal": living - 40.0 }, { "room": "hall", "signal": -95.0 }]
    }));
    assert_eq!(far["check"]["offset"], -12.0);
}

#[test]
fn a_receiver_s_learned_rooms() {
    let storeys = apartment();
    let radios = json!([
        { "id": "living-proxy", "storey": "ground", "at": [260, 260], "z": 120 },
        { "id": "bedroom-proxy", "storey": "ground", "at": [630, 590], "z": 120 }
    ]);
    let found = advice(&json!({
        "radio": "bluetooth", "storeys": storeys, "radios": radios,
        "measured": [
            // Taught: the hall heard by the living room's proxy, a little fainter than predicted.
            { "room": "hall", "radio": "living-proxy", "signal": -86.0, "readings": 30, "name": "living-proxy" },
            { "room": "hall", "radio": "bedroom-proxy", "signal": -91.0, "readings": 30, "name": "bedroom-proxy" },
            // Learned from too few readings: not measured.
            { "room": "bathroom", "radio": "living-proxy", "signal": -60.0, "readings": 3 }
        ]
    }));
    let hall = room(&found, "hall");
    assert_eq!(
        hall["measured"],
        json!({ "level": "fair", "signal": -86.0, "name": "living-proxy" })
    );
    assert_eq!(hall["level"], "fair");
    assert!(room(&found, "bathroom").get("measured").is_none());
    assert_eq!(found["check"]["measurements"], 2);
}

#[test]
fn spots_where_the_next_radio_helps_most() {
    // A receiver in the kitchen's far corner: the bathroom, across the home, is badly covered.
    let found = advice(&json!({
        "radio": "bluetooth",
        "storeys": apartment(),
        "radios": [{ "id": "proxy", "storey": "ground", "at": [800, 20], "z": 120 }]
    }));
    let spots = found["spots"].as_array().unwrap();
    assert!(!spots.is_empty() && spots.len() <= 3);
    let first = &spots[0];
    // On the far side of the home, raising the bathroom.
    assert!(first["at"][0].as_f64().unwrap() < 450.0, "{first}");
    let changes = first["changes"].as_array().unwrap();
    assert!(changes.iter().any(|c| c["room"] == "bathroom"), "{first}");
    for change in changes {
        let from = Level::from_name(change["from"].as_str().unwrap()).unwrap();
        let to = Level::from_name(change["to"].as_str().unwrap()).unwrap();
        assert!(to > from);
        assert_eq!(
            room(&found, change["room"].as_str().unwrap())["level"],
            change["from"]
        );
    }
    // One spot a room, the rooms all different.
    let rooms: Vec<&str> = spots.iter().map(|s| s["room"].as_str().unwrap()).collect();
    let mut unique = rooms.clone();
    unique.dedup();
    assert_eq!(rooms.len(), unique.len());
    // Each by a piece of its room, where one is near.
    for spot in spots {
        if let Some(near) = spot["near"].as_str() {
            assert!(Home::read(&apartment()).pieces.contains_key(near));
        }
    }
    // As many as asked.
    let one = advice(&json!({
        "radio": "bluetooth", "storeys": apartment(), "spots": 1,
        "radios": [{ "id": "proxy", "storey": "ground", "at": [800, 20], "z": 120 }]
    }));
    assert_eq!(one["spots"].as_array().unwrap().len(), 1);
    assert_eq!(one["spots"][0], *first);
}

#[test]
fn no_spot_where_every_room_is_covered_well() {
    // An access point in the hall covers the small apartment well.
    let found = advice(&json!({
        "radio": "wifi",
        "storeys": apartment(),
        "radios": [{ "id": "ap", "storey": "ground", "at": [340, 590] }]
    }));
    assert!(
        found["rooms"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["level"] == "good"),
        "{found}"
    );
    assert_eq!(found["spots"], json!([]));
}

#[test]
fn the_first_radio_of_its_kind() {
    // No receiver yet: the best spot covers the most of the home.
    let found = advice(&json!({ "radio": "bluetooth", "storeys": apartment() }));
    let first = &found["spots"][0];
    let changes = first["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 5, "{first}");
    assert!(first.get("reach").is_none());
}

#[test]
fn a_router_joins_the_mesh_through_its_neighbours() {
    let storeys = json!([
        { "id": "ground", "elevation": 0, "plan": plan(DEMO), "layout": {} },
        { "id": "upper", "elevation": 280, "plan": plan(UPPER), "layout": {} }
    ]);
    let found = advice(&json!({
        "radio": "zigbee",
        "storeys": storeys,
        "radios": [{ "id": "coordinator", "piece": "sideboard" }],
        "measured": [
            { "piece": "washer", "level": "weak", "name": "Washing machine plug" },
            { "piece": "bed", "level": "fair" }
        ],
        "spots": 10
    }));
    // Every spot advised is reached at least fairly by the coordinator.
    let spots = found["spots"].as_array().unwrap();
    assert!(!spots.is_empty());
    for spot in spots {
        let reach = spot["reach"].as_f64().unwrap();
        assert!(Level::of(Radio::Zigbee, reach) >= Level::Fair, "{spot}");
    }
    // The bathroom's plug is weak, measured: it comes before the model's prediction.
    assert_eq!(room(&found, "bathroom")["level"], "weak");
    assert_eq!(
        room(&found, "bathroom")["measured"]["name"],
        "Washing machine plug"
    );
    assert!(room(&found, "bathroom")["predicted"].as_f64().is_some());
    // Measured and predicted compared by level, in the two rooms measured.
    assert_eq!(found["agreement"]["rooms"], 2);
    assert!(found.get("check").is_none());
}

#[test]
fn a_large_home_stays_quick() {
    // Sixty rooms of 4 m by 4 m on three storeys, a door between neighbours.
    let storeys: Vec<Value> = (0..3)
        .map(|s| {
            let mut rooms = Vec::new();
            let mut doors = Vec::new();
            for i in 0..5 {
                for j in 0..4 {
                    let (x, y) = (f64::from(i) * 400.0, f64::from(j) * 400.0);
                    rooms.push(json!({ "id": format!("r{s}-{i}-{j}"),
                        "outline": [[x, y], [x + 400.0, y], [x + 400.0, y + 400.0], [x, y + 400.0]] }));
                    doors.push(json!({ "from": [x + 400.0, y + 150.0], "to": [x + 400.0, y + 240.0] }));
                }
            }
            json!({ "id": format!("s{s}"), "elevation": s * 280, "plan": { "rooms": rooms, "doors": doors } })
        })
        .collect();
    let found = advice(&json!({
        "radio": "wifi",
        "storeys": storeys,
        "radios": [{ "id": "ap", "storey": "s0", "at": [100, 100] }]
    }));
    assert_eq!(found["rooms"].as_array().unwrap().len(), 60);
    let spots = found["spots"].as_array().unwrap();
    assert_eq!(spots.len(), 3);
    // The best spot is reached by the access point, and raises rooms upstairs or far away.
    assert!(!spots[0]["changes"].as_array().unwrap().is_empty());
}
