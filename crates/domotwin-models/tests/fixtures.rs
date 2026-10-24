//! The fictional models of `examples/models/` (written by `scripts/make-model-fixtures.py`): the
//! same bar stool in four formats, and a floor lamp with a picture and an emissive shade.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use domotwin_core::model_mesh::ModelMesh;
use domotwin_models::{Finish, Format, Model, Unit};

/// Reads a model and checks that the engine accepts its encoding.
fn read(name: &str, format: Format) -> Model {
    let path = format!(
        "{}/../../examples/models/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    let bytes = std::fs::read(&path).unwrap();
    let model = Model::read(&bytes, format).unwrap();
    let decoded = ModelMesh::decode(&model.encode()).unwrap();
    assert_eq!(decoded.indices, model.mesh.indices);
    assert_eq!(decoded.bounds, model.mesh.bounds());
    model
}

fn close(a: [f32; 3], b: [f32; 3], tolerance: f32) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tolerance)
}

#[test]
fn the_stool_in_every_format() {
    let glb = read("stool.glb", Format::Glb);
    assert_eq!(glb.triangles, 224);
    assert_eq!(glb.unit, Some(Unit::Meter));
    assert!(
        close(glb.size(), [0.38, 0.71, 0.38], 0.002),
        "{:?}",
        glb.size()
    );
    assert!(glb.mesh.finishes.contains(&Finish::Metal));
    assert!(glb.mesh.finishes.contains(&Finish::Matte));

    let obj = read("stool.obj", Format::Obj);
    assert_eq!(obj.triangles, 224);
    assert_eq!(obj.unit, None);
    assert!(close(obj.size(), [38.0, 71.0, 38.0], 0.2));
    assert!(obj.mesh.finishes.iter().all(|f| *f == Finish::Piece));

    // Z up, front towards −y, in millimetres.
    let stl = read("stool.stl", Format::Stl);
    assert_eq!(stl.triangles, 224);
    assert!(
        close(stl.size(), [380.0, 380.0, 710.0], 2.0),
        "{:?}",
        stl.size()
    );
    assert!(stl.mesh.finishes.iter().all(|f| *f == Finish::Piece));
    // Welded: far fewer vertices than corners, sharp rims kept.
    assert!(stl.mesh.positions.len() < 3 * 224 / 2);

    let three = read("stool.3mf", Format::ThreeMf);
    assert_eq!(three.triangles, 224);
    assert_eq!(three.unit, Some(Unit::Millimeter));
    assert!(close(three.size(), stl.size(), 0.01));
    assert!(three.mesh.colors.contains(&[0xa0, 0x71, 0x4a]));
    assert!(three.mesh.colors.contains(&[0x8c, 0x8f, 0x91]));
}

#[test]
fn the_lamp_with_its_picture() {
    let mut lamp = read("lamp.gltf", Format::Gltf);
    assert_eq!(lamp.triangles, 176);
    assert_eq!(lamp.images.len(), 1);
    assert_eq!(
        (
            lamp.images[0].mime,
            lamp.images[0].width,
            lamp.images[0].height
        ),
        ("image/png", 2, 2)
    );
    assert!(lamp.mesh.finishes.contains(&Finish::Glow));
    // The shade is double sided: its 48 triangles are drawn twice.
    assert_eq!(lamp.mesh.indices.len() / 3, 176 + 48);
    let untextured = lamp.encode();
    // A dark picture darkens the base only.
    lamp.set_image(0, 1, 1, vec![20, 20, 20, 255]);
    let textured = lamp.encode();
    assert_eq!(untextured.len(), textured.len());
    assert_ne!(untextured, textured);
    // Wrong pixel counts are ignored.
    lamp.set_image(0, 3, 3, vec![0; 4]);
    assert_eq!(lamp.encode(), textured);
}
