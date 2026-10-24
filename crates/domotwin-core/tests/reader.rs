//! The plan reader follows `docs/plan-format.md`: one test per rule.

#![allow(clippy::unwrap_used, clippy::panic)]

use domotwin_core::plan::{DoorStyle, Element, Floor, Kind, View, WallStyle, read_plan};
use domotwin_core::{ErrorCode, Plan};
use serde_json::{Value, json};

fn plan(lists: Value) -> Value {
    let mut out = json!({ "format": "domotwin-plan", "version": 1 });
    for (k, v) in lists.as_object().unwrap() {
        out.as_object_mut().unwrap().insert(k.clone(), v.clone());
    }
    out
}

fn room(id: &str) -> Value {
    json!({ "id": id, "name": "Room", "outline": [[0, 0], [400, 0], [400, 300], [0, 300]] })
}

fn read(value: &Value) -> Result<Plan, (ErrorCode, Option<String>)> {
    read_plan(value.to_string().as_bytes()).map_err(|err| (err.code, err.element))
}

fn read_ok(value: &Value) -> Plan {
    read(value).unwrap_or_else(|err| panic!("{err:?}"))
}

fn code(value: &Value) -> ErrorCode {
    read(value)
        .err()
        .map(|(code, _)| code)
        .unwrap_or_else(|| panic!("accepted: {value}"))
}

fn with(mut base: Value, key: &str, value: Value) -> Value {
    base.as_object_mut().unwrap().insert(key.into(), value);
    base
}

fn without(mut base: Value, key: &str) -> Value {
    base.as_object_mut().unwrap().remove(key);
    base
}

fn item(extra: Value) -> Value {
    let mut item = json!({ "id": "f", "name": "Item", "at": [35, 30], "size": [50, 40, 80] });
    for (k, v) in extra.as_object().unwrap() {
        item.as_object_mut().unwrap().insert(k.clone(), v.clone());
    }
    item
}

fn items(list: Value) -> Value {
    plan(json!({ "items": list }))
}

fn only_item(plan: &Plan) -> &domotwin_core::plan::Furniture {
    plan.furniture().next().unwrap()
}

fn only_room(plan: &Plan) -> &domotwin_core::plan::Room {
    plan.rooms().next().unwrap()
}

#[test]
fn what_is_not_a_plan_is_refused() {
    assert_eq!(read_plan(b"").unwrap_err().code, ErrorCode::Empty);
    assert_eq!(read_plan(b"  \n").unwrap_err().code, ErrorCode::Empty);
    assert_eq!(read_plan(b"{").unwrap_err().code, ErrorCode::NotJson);
    assert_eq!(read_plan(b"[]").unwrap_err().code, ErrorCode::NotAnObject);
    let base = plan(json!({ "rooms": [room("a")] }));
    assert!(read(&base).is_ok());
    assert_eq!(code(&without(base.clone(), "format")), ErrorCode::NotAPlan);
    assert_eq!(
        code(&with(base.clone(), "format", json!("something-else"))),
        ErrorCode::NotAPlan
    );
    assert_eq!(code(&without(base.clone(), "version")), ErrorCode::NotAPlan);
    assert_eq!(
        code(&with(base.clone(), "version", json!(0))),
        ErrorCode::NotAPlan
    );
    assert_eq!(
        code(&with(base.clone(), "version", json!(1.5))),
        ErrorCode::NotAPlan
    );
    assert_eq!(
        code(&with(base.clone(), "version", json!(2))),
        ErrorCode::NewerVersion
    );
    assert_eq!(
        code(&with(base.clone(), "rooms", json!({}))),
        ErrorCode::NotAPlan
    );
    assert_eq!(code(&plan(json!({}))), ErrorCode::NoElements);
    assert_eq!(code(&plan(json!({ "rooms": [] }))), ErrorCode::NoElements);
    let many: Vec<Value> = (0..501)
        .map(|i| item(json!({ "id": format!("f{i}") })))
        .collect();
    assert_eq!(code(&items(json!(many))), ErrorCode::TooManyElements);
    let mut huge = vec![b' '; 32_000_001];
    huge[0] = b'{';
    assert_eq!(read_plan(&huge).unwrap_err().code, ErrorCode::TooLarge);
}

#[test]
fn byte_order_mark_and_texts() {
    let base = with(plan(json!({ "rooms": [room("a")] })), "name", json!("Home"));
    let mut bytes = b"\xEF\xBB\xBF".to_vec();
    bytes.extend(base.to_string().as_bytes());
    assert_eq!(read_plan(&bytes).unwrap().name, "Home");
    // Texts are cut to 100 characters, never inside one.
    let long = "é".repeat(150);
    let p = read_ok(&with(base.clone(), "name", json!(long)));
    assert_eq!(p.name.chars().count(), 100);
    // A name of the wrong type is empty; unknown fields are left out.
    let p = read_ok(&with(
        with(base, "name", json!(3)),
        "extra",
        json!({ "x": 1 }),
    ));
    assert_eq!(p.name, "");
}

#[test]
fn wall_thickness() {
    let base = plan(json!({ "rooms": [room("a")] }));
    let p = read_ok(&base);
    assert_eq!(
        (p.wall_settings.interior, p.wall_settings.exterior),
        (10.0, 20.0)
    );
    let p = read_ok(&with(
        base.clone(),
        "wallThickness",
        json!({ "interior": 7 }),
    ));
    assert_eq!(
        (p.wall_settings.interior, p.wall_settings.exterior),
        (7.0, 20.0)
    );
    for bad in [
        json!({ "exterior": 0 }),
        json!({ "interior": 101 }),
        json!({ "interior": "7" }),
    ] {
        assert_eq!(
            code(&with(base.clone(), "wallThickness", bad)),
            ErrorCode::WallThickness
        );
    }
    // Not an object: the defaults.
    assert!(read(&with(base, "wallThickness", json!(3))).is_ok());
}

#[test]
fn ids_are_required_and_unique() {
    let p = |list: Value| code(&plan(json!({ "rooms": list })));
    assert_eq!(p(json!([3])), ErrorCode::InvalidElement);
    assert_eq!(
        p(json!([without(room("a"), "id")])),
        ErrorCode::InvalidElement
    );
    assert_eq!(
        p(json!([with(room("a"), "id", json!(""))])),
        ErrorCode::InvalidElement
    );
    assert_eq!(
        p(json!([with(room("a"), "id", json!("x".repeat(101)))])),
        ErrorCode::InvalidElement
    );
    let err = read(&plan(json!({ "rooms": [room("a"), 3] }))).unwrap_err();
    assert_eq!(err, (ErrorCode::InvalidElement, Some("rooms[1]".into())));
    // Unique across the lists.
    let twice = plan(json!({ "rooms": [room("a")], "items": [item(json!({ "id": "a" }))] }));
    assert_eq!(
        read(&twice).unwrap_err(),
        (ErrorCode::DuplicateId, Some("a".into()))
    );
    // A name is optional.
    assert_eq!(
        read_ok(&plan(json!({ "rooms": [without(room("a"), "name")] })))
            .rooms()
            .next()
            .unwrap()
            .name,
        ""
    );
}

#[test]
fn rooms_their_frame_and_their_defaults() {
    let p = read_ok(&plan(json!({ "rooms": [json!({
        "id": "l", "outline": [[100, 50], [500, 50], [500, 350], [300, 450], [100, 350]]
    })] })));
    let r = only_room(&p);
    assert_eq!((r.x, r.y, r.w, r.h), (100.0, 50.0, 400.0, 400.0));
    assert_eq!(r.points()[3], [300.0, 450.0]);
    assert_eq!(r.floor, Floor::Plain);
    assert_eq!(r.wall_style, WallStyle::White);
    assert!(r.wall_color.is_none() && !r.cornice && r.open_edges.is_empty());
    assert_eq!(r.edge_thickness, vec![None; 5]);
    assert!(r.edge_finish.is_none());
    // Its materials, finishes and sides.
    let p = read_ok(&plan(json!({ "rooms": [with(with(with(with(room("a"),
        "floor", json!({ "material": "oak", "angle": 450 })),
        "walls", json!({ "finish": "chair-rail", "paint": "#AABBCC", "moulding": true })),
        "color", json!("#112233")),
        "sides", json!([null, { "open": true, "thickness": 30 }, { "finish": "tiles" },
                        { "finish": "#ff0000", "thickness": 500 }, { "open": true }]))] })));
    let r = only_room(&p);
    assert_eq!((r.floor, r.floor_angle), (Floor::WoodOak, 90.0));
    assert_eq!(r.wall_style, WallStyle::ChairRail);
    assert_eq!(r.wall_color.unwrap().to_hex(), "#aabbcc");
    assert_eq!(r.color.to_hex(), "#112233");
    assert!(r.cornice);
    assert_eq!(r.open_edges, vec![1], "a fifth side does not exist");
    assert_eq!(r.edge_thickness, vec![None, Some(30.0), None, None]);
    assert!(r.edge_finish.as_ref().unwrap()[2].is_some());
    // Unknown names take the default.
    let p = read_ok(&plan(
        json!({ "rooms": [with(room("a"), "floor", json!({ "material": "marble" }))] }),
    ));
    assert_eq!(only_room(&p).floor, Floor::Plain);
}

#[test]
fn room_outlines() {
    let r = |outline: Value| {
        code(&plan(
            json!({ "rooms": [with(room("a"), "outline", outline)] }),
        ))
    };
    assert_eq!(
        code(&plan(json!({ "rooms": [without(room("a"), "outline")] }))),
        ErrorCode::InvalidOutline
    );
    assert_eq!(r(json!([[0, 0], [10, 0]])), ErrorCode::InvalidOutline);
    assert_eq!(
        r(json!([[0, 0], [10, 0], [10, "a"]])),
        ErrorCode::InvalidOutline
    );
    assert_eq!(r(json!([[0, 0], [10, 0], [10]])), ErrorCode::InvalidOutline);
    assert_eq!(
        r(json!([[0, 0], [60_000, 0], [0, 10]])),
        ErrorCode::InvalidOutline
    );
    assert_eq!(
        r(json!([[0, 0], [20_000, 0], [0, 300]])),
        ErrorCode::InvalidOutline
    );
    let many: Vec<Value> = (0..65)
        .map(|i| {
            let a = f64::from(i) / 65.0 * std::f64::consts::TAU;
            json!([200.0 * a.cos(), 200.0 * a.sin()])
        })
        .collect();
    assert_eq!(r(json!(many)), ErrorCode::InvalidOutline);
    assert_eq!(
        r(json!([[0, 0], [100, 100], [100, 0], [0, 100]])),
        ErrorCode::SelfIntersection
    );
    assert_eq!(
        r(json!([[0, 0], [4, 0], [4, 4], [0, 4]])),
        ErrorCode::MinArea
    );
}

#[test]
fn items_their_box_and_their_defaults() {
    let p = read_ok(&items(json!([item(
        json!({ "kind": "sofa", "rotation": -90 })
    )])));
    let f = only_item(&p);
    // The corner of its unturned box, inside.
    assert_eq!((f.x, f.y, f.w, f.h, f.z), (10.0, 10.0, 50.0, 40.0, 80.0));
    assert_eq!(f.center(), [35.0, 30.0]);
    assert_eq!((f.kind, f.angle, f.elevation), (Kind::Sofa, 270.0, 0.0));
    assert_eq!(f.color, Kind::Sofa.info().color, "the kind's colour");
    assert!(!f.locked && f.parent.is_empty() && f.variant.is_none());
    // An unknown kind is a plain box; a style of another kind is left out.
    let p = read_ok(&items(json!([item(
        json!({ "kind": "spaceship", "style": "leather" })
    )])));
    assert_eq!(
        (only_item(&p).kind, only_item(&p).variant.as_deref()),
        (Kind::Box, None)
    );
    let p = read_ok(&items(json!([item(
        json!({ "kind": "sofa", "style": "leather", "fixed": true, "lift": 40, "color": "#010203" })
    )])));
    let f = only_item(&p);
    assert_eq!(f.variant.as_deref(), Some("leather"));
    assert!(f.locked);
    assert_eq!(f.elevation, 40.0);
    assert_eq!(f.color.to_hex(), "#010203");
}

#[test]
fn item_errors() {
    let e = |extra: Value| code(&items(json!([item(extra)])));
    assert_eq!(
        code(&items(json!([without(item(json!({})), "at")]))),
        ErrorCode::PositionRange
    );
    assert_eq!(e(json!({ "at": [60_000, 0] })), ErrorCode::PositionRange);
    assert_eq!(
        code(&items(json!([without(item(json!({})), "size")]))),
        ErrorCode::ItemSize
    );
    assert_eq!(e(json!({ "size": [0, 40, 80] })), ErrorCode::ItemSize);
    assert_eq!(e(json!({ "size": [50, 40] })), ErrorCode::ItemSize);
    assert_eq!(e(json!({ "size": [50, 40, 301] })), ErrorCode::ItemHeight);
    // A lift out of range is held at its limits.
    let lift = |value: Value| {
        only_item(&read_ok(&items(json!([item(json!({ "lift": value }))])))).elevation
    };
    assert_eq!(
        (lift(json!(301)), lift(json!(-1)), lift(json!("high"))),
        (300.0, 0.0, 0.0)
    );
    // A rotation of the wrong type is none.
    assert_eq!(
        only_item(&read_ok(&items(json!([item(json!({ "rotation": "a" }))])))).angle,
        0.0
    );
}

#[test]
fn lamps() {
    let lamp = |light: Value| {
        let p = read_ok(&items(json!([item(
            json!({ "kind": "floor-lamp", "light": light })
        )])));
        only_item(&p).clone()
    };
    let f = lamp(json!({ "on": false, "kelvin": 99_999, "power": 1.5 }));
    assert!(f.light_off);
    assert_eq!((f.light_kelvin, f.light_power), (Some(6500), Some(150)));
    // A colour wins over a temperature; 100 % is not kept.
    let f = lamp(json!({ "color": "#ff0000", "kelvin": 2700, "power": 1 }));
    assert_eq!(f.light_color.unwrap().to_hex(), "#ff0000");
    assert_eq!((f.light_kelvin, f.light_power), (None, None));
    let f = lamp(json!(3));
    assert!(!f.light_off && f.light_color.is_none());
    // Only lamps have a light.
    let p = read_ok(&items(json!([item(
        json!({ "kind": "sofa", "light": { "on": false } })
    )])));
    assert!(!only_item(&p).light_off);
}

#[test]
fn curtains_and_models() {
    let p = read_ok(&items(json!([item(
        json!({ "kind": "curtain", "open": 0.25 })
    )])));
    assert_eq!(only_item(&p).curtain_open_fraction(), 0.25);
    let p = read_ok(&items(json!([item(
        json!({ "kind": "curtain", "style": "closed" })
    )])));
    assert_eq!(only_item(&p).curtain_open_fraction(), 0.0);
    let stool = json!({ "name": "Stool", "size": [38, 38, 71],
        "file": { "format": "glb", "hash": "a".repeat(64), "bytes": 100, "up": "y" } });
    let with_model = |model: Value| {
        with(
            items(json!([item(json!({ "kind": "chair", "model": "stool" }))])),
            "models",
            model,
        )
    };
    let p = read_ok(&with_model(json!({ "stool": stool })));
    let f = only_item(&p);
    assert_eq!((f.kind, f.model.as_deref()), (Kind::Box, Some("stool")));
    assert_eq!(
        read(&with_model(json!({}))).unwrap_err(),
        (ErrorCode::MissingModel, Some("f".into()))
    );
    assert_eq!(
        code(&with_model(json!({ "bad id": stool }))),
        ErrorCode::InvalidModel
    );
    assert_eq!(
        code(&with_model(json!({ "stool": { "size": [1, 1, 1] } }))),
        ErrorCode::InvalidModel
    );
    assert_eq!(
        code(&with_model(
            json!({ "stool": with(stool.clone(), "size", json!([1, 1, 400])) })
        )),
        ErrorCode::InvalidModel
    );
    assert_eq!(code(&with_model(json!([]))), ErrorCode::InvalidModel);
}

#[test]
fn partitions_doors_and_windows() {
    let p = read_ok(&plan(json!({
        "rooms": [room("a")],
        "partitions": [{ "id": "p", "from": [10, 10], "to": [10, 200], "room": "a" }],
        "doors": [{ "id": "d", "from": [100, 0], "to": [100, 90], "opensTo": "left",
                    "style": "barn", "open": 0.4, "room": "a" }],
        "windows": [{ "id": "w", "from": [300, 0], "to": [200, 0], "style": "barn", "open": 0 }]
    })));
    let mut elements = p.elements.iter();
    assert!(matches!(elements.next(), Some(Element::Room(_))));
    let Some(Element::Wall(w)) = elements.next() else {
        panic!()
    };
    assert_eq!(
        (w.x2, w.y2, w.thickness, w.parent.as_str()),
        (10.0, 200.0, 10.0, "a")
    );
    let Some(Element::Door(d)) = elements.next() else {
        panic!()
    };
    assert_eq!(
        (d.x, d.y, d.w, d.angle, d.swing),
        (100.0, 0.0, 90.0, 90.0, -1)
    );
    assert_eq!((d.style, d.open), (DoorStyle::Barn, Some(40)));
    let Some(Element::Window(w)) = elements.next() else {
        panic!()
    };
    assert_eq!((w.x, w.w, w.angle, w.swing), (300.0, 100.0, 180.0, 1));
    assert_eq!(
        (w.style, w.open),
        (DoorStyle::Hinged, None),
        "windows have no style"
    );
    // Fully open is not kept.
    let p = read_ok(&plan(
        json!({ "doors": [{ "id": "d", "from": [0, 0], "to": [90, 0], "open": 1 }] }),
    ));
    assert!(matches!(&p.elements[0], Element::Door(d) if d.open.is_none()));
    let bad = |list: &str, e: Value| code(&plan(json!({ list: [e] })));
    assert_eq!(
        bad(
            "partitions",
            json!({ "id": "p", "from": [0, 0], "to": [3, 0] })
        ),
        ErrorCode::InvalidPartition
    );
    assert_eq!(
        bad("partitions", json!({ "id": "p", "from": [0, 0] })),
        ErrorCode::InvalidPartition
    );
    assert_eq!(
        bad(
            "doors",
            json!({ "id": "d", "from": [0, 0], "to": [400, 0] })
        ),
        ErrorCode::InvalidOpening
    );
    assert_eq!(
        bad(
            "windows",
            json!({ "id": "w", "from": [0, 0], "to": [10, 0] })
        ),
        ErrorCode::InvalidOpening
    );
    assert!(
        read(&plan(
            json!({ "windows": [{ "id": "w", "from": [0, 0], "to": [900, 0] }] })
        ))
        .is_ok()
    );
    // Ends written rounded put a door at its widest a hair over 300 cm on a slanted wall: read at
    // 300. Farther over, refused.
    let door = |to: Value| plan(json!({ "doors": [{ "id": "d", "from": [0, 0], "to": to }] }));
    let read = read_ok(&door(json!([271.9, 126.8])));
    assert_eq!(read.openings().next().unwrap().0.w, 300.0);
    assert_eq!(code(&door(json!([300.3, 0]))), ErrorCode::InvalidOpening);
}

#[test]
fn rooms_named_must_exist() {
    let p = plan(json!({ "rooms": [room("a")], "items": [item(json!({ "room": "b" }))] }));
    assert_eq!(
        read(&p).unwrap_err(),
        (ErrorCode::MissingRoom, Some("f".into()))
    );
    let p = plan(json!({ "rooms": [room("a")], "items": [item(json!({ "room": "a" }))] }));
    assert_eq!(only_item(&read_ok(&p)).parent, "a");
}

#[test]
fn viewpoints() {
    let p = read_ok(&with(
        plan(json!({ "rooms": [room("a")] })),
        "views",
        json!([
            { "id": "v", "name": "Corner", "eye": [10, 20, 300], "target": [100, 200, 0] },
            { "name": "", "eye": [1, 2, 3], "target": [4, 5, 6] },
            { "id": "half", "eye": [1, 2, 3] },
            3
        ]),
    ));
    assert_eq!(p.views.len(), 2);
    let View::Orbit {
        id,
        name,
        p: eye,
        t,
    } = &p.views[0];
    assert_eq!((id.as_str(), name.as_str()), ("v", "Corner"));
    assert_eq!((*eye, *t), ([10.0, 300.0, 20.0], [100.0, 0.0, 200.0]));
    let View::Orbit { id, name, .. } = &p.views[1];
    assert_eq!((id.as_str(), name.as_str()), ("view-1", "view-1"));
}

#[test]
fn error_json_names_the_element() {
    let err = read_plan(
        plan(json!({ "items": [item(json!({ "size": [0, 1, 1] }))] }))
            .to_string()
            .as_bytes(),
    )
    .unwrap_err();
    let json: Value = serde_json::from_str(&err.to_json()).unwrap();
    assert_eq!(json["code"], "item_size");
    assert_eq!(json["element"], "f");
}
