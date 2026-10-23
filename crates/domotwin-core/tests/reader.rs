//! The plan reader follows `docs/plan-format.md`: one test per rule.

#![allow(clippy::unwrap_used, clippy::panic)]

use domotwin_core::plan::{DoorStyle, Element, Floor, Kind, Role, WallStyle, read_plan};
use domotwin_core::{ErrorCode, Plan};
use serde_json::{Value, json};

fn plan(elements: Value) -> Value {
    json!({ "version": 1, "unit": "cm", "layoutRevision": 10, "elements": elements })
}

fn room(id: &str) -> Value {
    json!({ "id": id, "type": "room", "name": "Room", "x": 0, "y": 0, "w": 400, "h": 300 })
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

fn furniture(extra: Value) -> Value {
    let mut item = json!({
        "id": "f", "type": "furniture", "name": "Item", "x": 10, "y": 10, "w": 50, "h": 40, "z": 80
    });
    for (k, v) in extra.as_object().unwrap() {
        item.as_object_mut().unwrap().insert(k.clone(), v.clone());
    }
    item
}

fn only_furniture(plan: &Plan) -> &domotwin_core::plan::Furniture {
    plan.furniture().next().unwrap()
}

#[test]
fn envelope_errors() {
    assert_eq!(read_plan(b"").unwrap_err().code, ErrorCode::Empty);
    assert_eq!(read_plan(b"  \n").unwrap_err().code, ErrorCode::Empty);
    assert_eq!(read_plan(b"{").unwrap_err().code, ErrorCode::NotJson);
    assert_eq!(code(&json!([1])), ErrorCode::NotAnObject);
    assert_eq!(
        code(&with(plan(json!([room("a")])), "version", json!(2))),
        ErrorCode::BadVersion
    );
    assert_eq!(
        code(&with(plan(json!([room("a")])), "unit", json!("mm"))),
        ErrorCode::BadUnit
    );
    assert_eq!(code(&plan(json!([]))), ErrorCode::NoElements);
    assert_eq!(
        code(&without(plan(json!([])), "elements")),
        ErrorCode::NoElements
    );
    let many: Vec<Value> = (0..501).map(|i| room(&format!("r{i}"))).collect();
    assert_eq!(code(&plan(Value::Array(many))), ErrorCode::TooManyElements);
}

#[test]
fn revisions() {
    let base = plan(json!([room("a")]));
    assert_eq!(read_ok(&base).source_revision, 10);
    assert_eq!(
        read_ok(&with(base.clone(), "layoutRevision", json!(7))).source_revision,
        7
    );
    assert_eq!(
        read_ok(&without(base.clone(), "layoutRevision")).source_revision,
        1
    );
    assert_eq!(
        read_ok(&with(base.clone(), "layoutRevision", json!("9"))).source_revision,
        1
    );
    assert_eq!(
        read_ok(&with(base.clone(), "layoutRevision", json!(0))).source_revision,
        1
    );
    assert_eq!(
        code(&with(base, "layoutRevision", json!(11))),
        ErrorCode::NewerRevision
    );
}

#[test]
fn byte_order_mark_and_texts() {
    let mut bytes = b"\xEF\xBB\xBF".to_vec();
    bytes.extend(plan(json!([room("a")])).to_string().as_bytes());
    assert!(read_plan(&bytes).is_ok());

    let long = "é".repeat(150);
    let p = read_ok(&with(
        plan(json!([with(room("a"), "name", json!(long))])),
        "title",
        json!(long),
    ));
    assert_eq!(p.title.chars().count(), 100);
    assert_eq!(p.elements[0].name().chars().count(), 100);
}

#[test]
fn wall_settings() {
    let base = plan(json!([room("a")]));
    let p = read_ok(&with(
        base.clone(),
        "wallSettings",
        json!({ "interior": 12, "reflow": true }),
    ));
    assert_eq!(
        (p.wall_settings.interior, p.wall_settings.exterior),
        (12.0, 20.0)
    );
    assert!(p.wall_settings.reflow);
    assert_eq!(
        read_ok(&with(base.clone(), "wallSettings", json!(5)))
            .wall_settings
            .exterior,
        20.0
    );
    assert_eq!(
        code(&with(
            base.clone(),
            "wallSettings",
            json!({ "interior": 0 })
        )),
        ErrorCode::WallThickness
    );
    assert_eq!(
        code(&with(base, "wallSettings", json!({ "exterior": "20" }))),
        ErrorCode::WallThickness
    );
}

#[test]
fn element_identity_errors() {
    assert_eq!(
        code(&plan(json!([without(room("a"), "id")]))),
        ErrorCode::InvalidElement
    );
    assert_eq!(
        code(&plan(json!([with(
            room("a"),
            "id",
            json!("x".repeat(101))
        )]))),
        ErrorCode::InvalidElement
    );
    assert_eq!(
        code(&plan(json!([without(room("a"), "name")]))),
        ErrorCode::InvalidElement
    );
    assert_eq!(
        code(&plan(json!([with(room("a"), "type", json!("stair"))]))),
        ErrorCode::InvalidElement
    );
    assert_eq!(
        code(&plan(json!([room("a"), room("a")]))),
        ErrorCode::DuplicateId
    );
    let err = read(&plan(json!([
        room("a"),
        with(room("b"), "x", json!(60_000))
    ])))
    .unwrap_err();
    assert_eq!(err, (ErrorCode::PositionRange, Some("b".into())));
}

#[test]
fn rooms_defaults_and_lenient_fields() {
    let r = with(
        with(
            with(room("a"), "floor", json!("marble")),
            "wallStyle",
            json!("cimaise"),
        ),
        "angle",
        json!(-90),
    );
    let r = with(
        with(
            with(r, "color", json!("blue")),
            "wallColor",
            json!("#AABBCC"),
        ),
        "role",
        json!("placard"),
    );
    let p = read_ok(&plan(json!([r])));
    let Element::Room(room) = &p.elements[0] else {
        panic!()
    };
    assert_eq!(room.floor, Floor::Plain);
    assert_eq!(room.wall_style, WallStyle::ChairRail);
    assert_eq!(room.angle, 270.0);
    assert_eq!(room.color.to_hex(), "#e5e9dc");
    assert_eq!(room.wall_color.unwrap().to_hex(), "#aabbcc");
    assert_eq!(room.role, Role::Closet);
    assert_eq!(room.vertices.len(), 4);
    assert_eq!(room.material_source, "Revêtement à confirmer.");
    assert_eq!(room.edge_thickness, vec![None; 4]);
}

#[test]
fn room_errors() {
    assert_eq!(
        code(&plan(json!([with(room("a"), "w", json!(4))]))),
        ErrorCode::RoomSize
    );
    assert_eq!(
        code(&plan(json!([with(room("a"), "angle", json!(null))]))),
        ErrorCode::InvalidAngle
    );
    let triangle_outside = json!([[0, 0], [1.2, 0], [0, 1]]);
    assert_eq!(
        code(&plan(json!([with(
            room("a"),
            "vertices",
            triangle_outside
        )]))),
        ErrorCode::VertexCount
    );
    assert_eq!(
        code(&plan(json!([with(
            room("a"),
            "vertices",
            json!([[0, 0], [1, 1]])
        )]))),
        ErrorCode::VertexCount
    );
    let bow_tie = json!([[0, 0], [1, 1], [1, 0], [0, 1]]);
    assert_eq!(
        code(&plan(json!([with(room("a"), "vertices", bow_tie)]))),
        ErrorCode::SelfIntersection
    );
    let tiny = with(with(room("a"), "w", json!(5)), "h", json!(5));
    assert_eq!(
        code(&plan(json!([with(
            tiny,
            "vertices",
            json!([[0, 0], [1, 0], [0, 1]])
        )]))),
        ErrorCode::MinArea
    );
    assert_eq!(
        code(&plan(json!([with(room("a"), "openEdges", json!(3))]))),
        ErrorCode::InvalidOpenEdges
    );
    assert_eq!(
        code(&plan(json!([with(room("a"), "openEdges", json!([4]))]))),
        ErrorCode::OpenEdgeRange
    );
    assert_eq!(
        code(&plan(json!([with(
            room("a"),
            "edgeThickness",
            json!([null, 5])
        )]))),
        ErrorCode::InvalidEdgeThickness
    );
    assert_eq!(
        code(&plan(json!([with(
            room("a"),
            "edgeThickness",
            json!([null, 0, null, null])
        )]))),
        ErrorCode::InvalidEdgeThickness
    );
}

#[test]
fn room_geometry_fields() {
    let r = with(
        with(room("a"), "openEdges", json!([2, 0, 2])),
        "edgeThickness",
        json!([null, 15, null, null]),
    );
    let r = with(r, "edgeFinish", json!(["metro", "#112233", "nope"]));
    let p = read_ok(&plan(json!([r])));
    let Element::Room(rm) = &p.elements[0] else {
        panic!()
    };
    assert_eq!(rm.open_edges, vec![0, 2]);
    assert_eq!(rm.edge_thickness, vec![None, Some(15.0), None, None]);
    let finish = rm.edge_finish.as_ref().unwrap();
    assert_eq!(finish.len(), 4);
    assert!(matches!(
        finish[0],
        Some(domotwin_core::plan::EdgeFinish::Metro)
    ));
    assert!(finish[2].is_none() && finish[3].is_none());

    // The legacy bevel cuts the bottom-right corner.
    let p = read_ok(&plan(json!([with(room("b"), "bevel", json!(100))])));
    let Element::Room(rm) = &p.elements[0] else {
        panic!()
    };
    assert_eq!(rm.vertices[2], [0.75, 1.0]);
}

#[test]
fn furniture_rules() {
    let p = read_ok(&plan(json!([furniture(
        json!({ "kind": "sofa-bed", "variant": "cuir" })
    )])));
    let f = only_furniture(&p);
    assert_eq!(f.kind, Kind::Desk);
    assert_eq!(f.variant, None);
    assert_eq!(f.elevation, 0.0);

    let p = read_ok(&plan(json!([furniture(
        json!({ "kind": "sofa", "variant": "cuir", "elevation": 12 })
    )])));
    assert_eq!(only_furniture(&p).variant.as_deref(), Some("cuir"));
    assert_eq!(only_furniture(&p).elevation, 12.0);

    assert_eq!(
        code(&plan(json!([furniture(json!({ "z": 0 }))]))),
        ErrorCode::FurnitureHeight
    );
    assert_eq!(
        code(&plan(json!([furniture(json!({ "w": 0.5 }))]))),
        ErrorCode::FurnitureSize
    );
    assert_eq!(
        code(&plan(json!([furniture(json!({ "elevation": 301 }))]))),
        ErrorCode::ElevationRange
    );
    assert_eq!(
        code(&plan(json!([furniture(json!({ "angle": "90" }))]))),
        ErrorCode::InvalidAngle
    );
}

#[test]
fn light_settings() {
    let lamp = |extra: Value| {
        let mut item = furniture(json!({ "kind": "lamp" }));
        for (k, v) in extra.as_object().unwrap() {
            item.as_object_mut().unwrap().insert(k.clone(), v.clone());
        }
        read_ok(&plan(json!([item])))
    };
    let p = lamp(json!({ "lightOff": true, "lightKelvin": 9000, "lightPower": 100 }));
    let f = only_furniture(&p);
    assert!(f.light_off);
    assert_eq!(f.light_kelvin, Some(6500));
    assert_eq!(f.light_power, None);
    let p = lamp(json!({ "lightColor": "#FFAA00", "lightKelvin": 3000, "lightPower": 4 }));
    let f = only_furniture(&p);
    assert_eq!(f.light_color.unwrap().to_hex(), "#ffaa00");
    assert_eq!(f.light_kelvin, None);
    assert_eq!(f.light_power, Some(10));
    // Not a light: the fields are dropped.
    let p = read_ok(&plan(json!([furniture(
        json!({ "kind": "sofa", "lightOff": true, "lightColor": "#ffffff" })
    )])));
    let f = only_furniture(&p);
    assert!(!f.light_off && f.light_color.is_none());
}

#[test]
fn curtains_and_custom_models() {
    let p = read_ok(&plan(json!([furniture(
        json!({ "kind": "curtain", "open": "42.6" })
    )])));
    assert_eq!(only_furniture(&p).open, Some(43));
    let p = read_ok(&plan(json!([furniture(
        json!({ "kind": "curtain", "variant": "ferme" })
    )])));
    assert_eq!(only_furniture(&p).curtain_open_fraction(), 0.0);
    let p = read_ok(&plan(json!([furniture(
        json!({ "kind": "table", "open": 50 })
    )])));
    assert_eq!(only_furniture(&p).open, None);

    assert_eq!(
        code(&plan(json!([furniture(
            json!({ "kind": "custom", "model": "m1" })
        )]))),
        ErrorCode::MissingModel
    );
    let kit = json!({ "m1": { "name": "Stool", "size": [38, 38, 71], "kit": { "parts": [] } } });
    let p = read_ok(&with(
        plan(json!([furniture(
            json!({ "kind": "custom", "model": "m1" })
        )])),
        "models",
        kit,
    ));
    assert_eq!(only_furniture(&p).model.as_deref(), Some("m1"));
    let both = json!({ "m1": { "name": "x", "size": [1, 1, 1], "kit": {}, "file": {} } });
    assert_eq!(
        code(&with(plan(json!([room("a")])), "models", both)),
        ErrorCode::InvalidModel
    );
}

#[test]
fn walls_and_openings() {
    let wall = json!({ "id": "w", "type": "wall", "name": "W", "x": 0, "y": 0, "x2": 3, "y2": 0, "thickness": 10 });
    assert_eq!(code(&plan(json!([wall]))), ErrorCode::InvalidWall);
    let door = json!({ "id": "d", "type": "door", "name": "D", "x": 0, "y": 0, "w": 80, "angle": 450,
                       "style": "revolving", "open": 99.6, "swing": -1 });
    let p = read_ok(&plan(json!([door])));
    let Element::Door(d) = &p.elements[0] else {
        panic!()
    };
    assert_eq!(
        (d.angle, d.style, d.open, d.swing),
        (90.0, DoorStyle::Hinged, Some(100), -1)
    );
    let window =
        json!({ "id": "w", "type": "window", "name": "W", "x": 0, "y": 0, "w": 1200, "angle": 0 });
    assert_eq!(code(&plan(json!([window]))), ErrorCode::InvalidOpening);
    let door = json!({ "id": "d", "type": "door", "name": "D", "x": 0, "y": 0, "w": 80 });
    assert_eq!(code(&plan(json!([door]))), ErrorCode::InvalidOpening);
}

#[test]
fn parents_must_be_rooms() {
    let err = read(&plan(json!([
        room("a"),
        furniture(json!({ "parent": "nowhere" }))
    ])))
    .unwrap_err();
    assert_eq!(err, (ErrorCode::MissingParent, Some("f".into())));
    let err = read(&plan(json!([
        room("a"),
        with(room("b"), "id", json!("b")),
        furniture(json!({ "parent": "a" }))
    ])));
    assert!(err.is_ok());
}

#[test]
fn views_are_cleaned() {
    let views = json!([
        { "id": "o", "name": "Top", "mode": "orbit", "p": [0, 900, 0], "t": [0, 0, 0] },
        { "name": "", "mode": "walk", "x": 10, "y": 10, "yaw": 0, "pitch": 3, "eye": 500 },
        { "name": "Bad", "mode": "orbit", "p": [0, 1e6, 0], "t": [0, 0, 0] },
        { "mode": "orbit" }
    ]);
    let p = read_ok(&with(plan(json!([room("a")])), "views", views));
    assert_eq!(p.views.len(), 2);
    let domotwin_core::plan::View::Walk {
        name, pitch, eye, ..
    } = &p.views[1]
    else {
        panic!()
    };
    assert_eq!((name.as_str(), *pitch, *eye), ("Vue", 1.3, 200.0));
}

#[test]
fn site_is_kept_or_refused() {
    let base = plan(json!([room("a")]));
    assert!(
        read_ok(&with(
            base.clone(),
            "site",
            json!({ "version": 1, "label": "x" })
        ))
        .site
        .is_some()
    );
    assert!(
        read_ok(&with(base.clone(), "site", Value::Null))
            .site
            .is_none()
    );
    assert_eq!(
        code(&with(base, "site", json!({ "version": 2 }))),
        ErrorCode::InvalidSite
    );
}

#[test]
fn error_json_names_the_element() {
    let err = read_plan(
        plan(json!([with(room("kitchen"), "w", json!(1))]))
            .to_string()
            .as_bytes(),
    )
    .unwrap_err();
    assert_eq!(err.to_json(), r#"{"code":"room_size","element":"kitchen"}"#);
}
