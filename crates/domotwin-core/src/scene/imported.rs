//! User models drawn from their 3D file (`DECISIONS.md`, D-013 and D-021): the file's mesh,
//! turned so that its `up` axis points up, fitted into the piece's own box. The front of a file is
//! its +z side (Y up) or its −y side (Z up), and becomes the piece's front.

use serde_json::Value;

use super::furniture::Model;
use super::mesh::{Material, Surface};
use crate::model_mesh::{Finish, ModelMesh};
use crate::plan::Rgb8;

/// Whether a model's file is Z up (`file.up`, defaulting to the format's usual axis).
pub(crate) fn z_up(model: &Value) -> bool {
    let file = model.get("file");
    match file.and_then(|f| f.get("up")).and_then(Value::as_str) {
        Some("z") => true,
        Some("y") => false,
        _ => matches!(
            file.and_then(|f| f.get("format")).and_then(Value::as_str),
            Some("stl" | "3mf")
        ),
    }
}

/// The SHA-256 naming a model's file, when it has one.
pub(crate) fn file_hash(model: &Value) -> Option<&str> {
    model
        .get("file")
        .and_then(|f| f.get("hash"))
        .and_then(Value::as_str)
}

/// A file point or direction in the model frame's axes (x right, y up, z front), before fitting.
fn turned([x, y, z]: [f64; 3], z_up: bool) -> [f64; 3] {
    if z_up { [x, z, -y] } else { [x, y, z] }
}

/// Draws `mesh` into the piece's box.
pub(crate) fn draw(m: &mut Model<'_>, mesh: &ModelMesh, z_up: bool) {
    let [lo, hi] = mesh.bounds;
    let a = turned(lo.map(f64::from), z_up);
    let b = turned(hi.map(f64::from), z_up);
    let min = [0, 1, 2].map(|k| a[k].min(b[k]));
    let max = [0, 1, 2].map(|k| a[k].max(b[k]));
    let size = [m.w, m.h, m.d];
    // A flat model keeps its thickness at scale 1.
    let scale = [0, 1, 2].map(|k| {
        let extent = max[k] - min[k];
        if extent > 1e-9 { size[k] / extent } else { 1.0 }
    });
    let local = |p: [f32; 3]| {
        let t = turned(p.map(f64::from), z_up);
        [
            (t[0] - (min[0] + max[0]) / 2.0) * scale[0],
            (t[1] - min[1]) * scale[1],
            (t[2] - (min[2] + max[2]) / 2.0) * scale[2],
        ]
    };
    let base = m.x.point([0.0; 3])[1];
    let piece = m.c;
    let x = m.x;
    let mut opaque = vec![u32::MAX; mesh.positions.len()];
    let mut glass = vec![u32::MAX; mesh.positions.len()];
    for tri in mesh.indices.chunks_exact(3) {
        let first = tri[0] as usize;
        let is_glass = mesh.finishes[first] == Finish::Glass;
        let (painter, ids) = if is_glass {
            (&mut m.g, &mut glass)
        } else {
            (&mut m.p, &mut opaque)
        };
        let mut corner = [0_u32; 3];
        for (slot, &v) in corner.iter_mut().zip(tri) {
            let v = v as usize;
            if ids[v] == u32::MAX {
                let [r, g, b_, rough] = mesh.colors[v];
                let own = Rgb8 { r, g, b: b_ };
                let roughness = f32::from(rough) / 255.0;
                let material = match mesh.finishes[v] {
                    Finish::Piece => Material::new(piece, roughness, Surface::Matte),
                    Finish::Matte => Material::new(own, roughness, Surface::Matte),
                    Finish::Metal => Material::new(own, roughness.min(0.6), Surface::Metal),
                    Finish::Glow => Material::new(own, roughness, Surface::Glow),
                    Finish::Glass => Material::new(own, 0.05, Surface::Glass),
                };
                let n = turned(mesh.normals[v].map(|c| f64::from(c) / 127.0), z_up);
                // Normals carry the inverse of the fit's scale.
                let n = [n[0] / scale[0], n[1] / scale[1], n[2] / scale[2]];
                let p = x.point(local(mesh.positions[v]));
                let base = painter.base.unwrap_or(base);
                ids[v] = painter.mesh.vertex(
                    p,
                    base,
                    normalize(x.dir(n)),
                    [0.0; 2],
                    &material,
                    painter.tag,
                );
            }
            *slot = ids[v];
        }
        painter.mesh.triangle(corner[0], corner[1], corner[2]);
    }
}

fn normalize(v: [f64; 3]) -> [f64; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len > 1e-12 {
        v.map(|c| c / len)
    } else {
        [0.0, 1.0, 0.0]
    }
}

#[cfg(test)]
mod tests {
    use std::rc::Rc;

    use super::*;
    use crate::scene::{MAX_FILE_TRIANGLES, ModelMeshes, SceneOptions, build_scene};
    use serde_json::json;

    const HASH: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    /// A room with two pieces of a Z-up STL model, 40 × 60 × 80 cm, at (100, 100) and (200, 100).
    fn plan() -> crate::Plan {
        let plan = json!({
            "version": 1, "unit": "cm",
            "elements": [
                { "id": "room", "type": "room", "name": "Room", "x": 0, "y": 0, "w": 400, "h": 300 },
                { "id": "a", "type": "furniture", "name": "A", "x": 100, "y": 100, "w": 40, "h": 60, "z": 80,
                  "kind": "custom", "model": "m-1" },
                { "id": "b", "type": "furniture", "name": "B", "x": 200, "y": 100, "w": 40, "h": 60, "z": 80,
                  "kind": "custom", "model": "m-1" }
            ],
            "models": { "m-1": { "name": "Stool", "size": [40, 60, 80],
                "file": { "format": "stl", "hash": HASH, "bytes": 84, "up": "z" } } }
        });
        crate::plan::read_plan_value(&plan).unwrap()
    }

    /// One triangle: its top corner on the file's +z, its back corner on the file's +y.
    fn mesh() -> ModelMesh {
        ModelMesh {
            positions: vec![[0.0, 0.0, 4.0], [1.0, 0.0, 0.0], [0.0, 2.0, 0.0]],
            normals: vec![[127, 0, 0]; 3],
            finishes: vec![Finish::Piece; 3],
            colors: vec![[0, 0, 0, 200]; 3],
            indices: vec![0, 1, 2],
            bounds: [[0.0; 3], [1.0, 2.0, 4.0]],
        }
    }

    fn options(mesh: ModelMesh) -> SceneOptions {
        let mut models = ModelMeshes::new();
        models.insert(HASH.to_owned(), Rc::new(mesh));
        SceneOptions {
            models: Rc::new(models),
            ..SceneOptions::default()
        }
    }

    #[test]
    fn fits_the_file_into_the_piece_front_forward() {
        let plan = plan();
        let scene = build_scene(&plan, &options(mesh()));
        let a = &scene.elements[1];
        assert_eq!(a.bounds, [[100.0, 0.0, 100.0], [140.0, 80.0, 160.0]]);
        // The top corner is at the front (the piece's y + h side) and on the left.
        let top = scene.parts[0]
            .opaque
            .positions
            .iter()
            .find(|p| (p[1] - 80.0).abs() < 1e-3)
            .unwrap();
        assert_eq!([top[0], top[2]], [100.0, 160.0]);
        assert_eq!(scene.models_over_budget, 0);
        // Not loaded: a box of the piece's size, with the same bounds.
        let boxed = build_scene(&plan, &SceneOptions::default());
        assert_eq!(boxed.elements[1].bounds, a.bounds);
        assert!(boxed.parts[0].opaque.triangle_count() > scene.parts[0].opaque.triangle_count());
        // Each piece may light the room once a light is linked to it: off until then.
        let spots: Vec<_> = scene.lights.iter().filter(|l| l.element == 1).collect();
        assert_eq!(spots.len(), 1);
        assert!(!spots[0].on && !spots[0].screen);
        assert!((spots[0].position[1] - 60.0).abs() < 1e-9);
    }

    #[test]
    fn pieces_past_the_budget_are_boxes() {
        let mut big = mesh();
        big.indices = [0, 1, 2].repeat(MAX_FILE_TRIANGLES / 2 + 1);
        let scene = build_scene(&plan(), &options(big));
        assert_eq!(scene.models_over_budget, 1);
    }

    #[test]
    fn up_axis() {
        assert!(z_up(&json!({ "file": { "format": "stl" } })));
        assert!(!z_up(&json!({ "file": { "format": "stl", "up": "y" } })));
        assert!(!z_up(&json!({ "file": { "format": "glb" } })));
        assert!(z_up(&json!({ "file": { "format": "glb", "up": "z" } })));
        // Z up, front −y: the file's −y becomes the frame's +z (front).
        assert_eq!(turned([1.0, -2.0, 3.0], true), [1.0, 3.0, 2.0]);
        assert_eq!(file_hash(&json!({ "file": { "hash": "ab" } })), Some("ab"));
        assert_eq!(file_hash(&json!({ "kit": {} })), None);
    }
}
