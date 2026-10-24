//! Wavefront OBJ: `v`, `vn` and `f` records (polygons are split into triangles). Material
//! libraries are other files and are not read: the model takes the piece's colour, unless its
//! vertices carry colours (`v x y z r g b`).

use std::collections::HashMap;

use crate::mesh::{Corner, Finish, Mesh, Soup};
use crate::{Error, MAX_TRIANGLES, Model};

/// A face corner: position, normal (when given), both 0-based.
type Ref = (usize, Option<usize>);

/// Resolves an OBJ index (1-based, or negative from the end) among `count` items.
fn resolve(text: &str, count: usize) -> Result<usize, Error> {
    let n: i64 = text.parse().map_err(|_| Error::NotModel)?;
    let count = i64::try_from(count).map_err(|_| Error::NotModel)?;
    let i = if n > 0 { n - 1 } else { count + n };
    if n == 0 || i < 0 || i >= count {
        return Err(Error::NotModel);
    }
    usize::try_from(i).map_err(|_| Error::NotModel)
}

fn floats<'a>(parts: impl Iterator<Item = &'a str>) -> Result<Vec<f32>, Error> {
    parts
        .map(|p| {
            p.parse::<f32>()
                .ok()
                .filter(|v| v.is_finite())
                .ok_or(Error::NotModel)
        })
        .collect()
}

pub(crate) fn read(bytes: &[u8]) -> Result<Model, Error> {
    let text = std::str::from_utf8(bytes).map_err(|_| Error::NotModel)?;
    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut colors: Vec<Option<[f32; 3]>> = Vec::new();
    let mut normals: Vec<[f32; 3]> = Vec::new();
    let mut faces: Vec<[Ref; 3]> = Vec::new();
    let mut polygon: Vec<Ref> = Vec::new();
    let mut records = 0_usize;
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let Some(keyword) = parts.next() else {
            continue;
        };
        match keyword {
            "v" => {
                let values = floats(parts)?;
                if values.len() < 3 {
                    return Err(Error::NotModel);
                }
                positions.push([values[0], values[1], values[2]]);
                // `v x y z r g b` (a common extension); `v x y z w` is a weight.
                colors.push((values.len() >= 6).then(|| [values[3], values[4], values[5]]));
            }
            "vn" => {
                let values = floats(parts)?;
                if values.len() < 3 {
                    return Err(Error::NotModel);
                }
                normals.push([values[0], values[1], values[2]]);
            }
            "f" => {
                polygon.clear();
                for corner in parts {
                    let mut fields = corner.split('/');
                    let v = resolve(fields.next().unwrap_or_default(), positions.len())?;
                    let _texture = fields.next();
                    let n = match fields.next() {
                        Some(n) if !n.is_empty() => Some(resolve(n, normals.len())?),
                        _ => None,
                    };
                    polygon.push((v, n));
                }
                if polygon.len() < 3 {
                    return Err(Error::NotModel);
                }
                for k in 1..polygon.len() - 1 {
                    if faces.len() >= MAX_TRIANGLES {
                        return Err(Error::TooManyTriangles);
                    }
                    faces.push([polygon[0], polygon[k], polygon[k + 1]]);
                }
            }
            // Comments, groups, materials (other files), texture coordinates, lines, points,
            // free-form curves and surfaces: nothing to draw.
            _ => {}
        }
        records += 1;
    }
    if records == 0 {
        return Err(Error::NotModel);
    }
    // Vertex colours are 0–1, or 0–255 in some files.
    let scale = if colors.iter().flatten().flatten().any(|c| *c > 1.0) {
        255.0
    } else {
        1.0
    };
    let colored = colors.iter().any(Option::is_some);
    let corner_style = |v: usize| -> ([u8; 3], Finish) {
        match colors.get(v).copied().flatten() {
            Some(c) => (c.map(|x| to_srgb_byte(x / scale)), Finish::Matte),
            None if colored => ([255, 255, 255], Finish::Matte),
            None => ([255, 255, 255], Finish::Piece),
        }
    };
    let triangles = faces.len();
    let mesh = if !faces.is_empty() && faces.iter().flatten().all(|(_, n)| n.is_some()) {
        // Normals given for every corner: shared vertices by position and normal.
        let mut mesh = Mesh::default();
        let mut ids: HashMap<Ref, u32> = HashMap::new();
        for face in &faces {
            for r in face {
                let id = match ids.get(r) {
                    Some(id) => *id,
                    None => {
                        let (color, finish) = corner_style(r.0);
                        let n = normals[r.1.unwrap_or_default()];
                        let id = mesh.vertex(positions[r.0], n, color, finish, 200);
                        ids.insert(*r, id);
                        id
                    }
                };
                mesh.indices.push(id);
            }
        }
        mesh
    } else {
        let mut soup = Soup::new(positions);
        for face in &faces {
            let corners = face.map(|(v, _)| {
                let (color, finish) = corner_style(v);
                Corner {
                    position: u32::try_from(v).unwrap_or(u32::MAX),
                    color,
                    finish,
                    roughness: 200,
                }
            });
            soup.triangle(corners)?;
        }
        soup.into_mesh()
    };
    Ok(Model::new(mesh, None, Vec::new(), Vec::new(), triangles))
}

/// A 0–1 sRGB component as a byte.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn to_srgb_byte(c: f32) -> u8 {
    (c.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    const CUBE: &str = "# a cube\no cube\nmtllib cube.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n\
v 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\nusemtl wood\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 4 8 7 3\n\
f 1 5 8 4\nf -7 -6 -2 -3\n";

    #[test]
    fn reads_polygons_with_sharp_edges() {
        let model = read(CUBE.as_bytes()).unwrap();
        assert_eq!(model.triangles, 12);
        assert_eq!(model.mesh.indices.len(), 36);
        assert_eq!(model.mesh.positions.len(), 24, "creases stay sharp");
        assert!(model.mesh.finishes.iter().all(|f| *f == Finish::Piece));
        assert_eq!(model.unit, None);
    }

    #[test]
    fn keeps_given_normals_and_vertex_colours() {
        let obj = "v 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 0 1 0 0 0 1\nvn 0 0 1\nf 1//1 2//1 3//1\n";
        let model = read(obj.as_bytes()).unwrap();
        assert_eq!(model.mesh.positions.len(), 3);
        assert_eq!(model.mesh.colors[0], [255, 0, 0]);
        assert_eq!(model.mesh.finishes[0], Finish::Matte);
        assert!((model.mesh.normals[0][2] - 1.0).abs() < 1e-6);
        let bytes = "v 0 0 0 255 128 0\nv 1 0 0 0 0 0\nv 0 1 0 0 0 0\nf 1 2 3\n";
        assert_eq!(
            read(bytes.as_bytes()).unwrap().mesh.colors[0],
            [255, 128, 0]
        );
    }

    #[test]
    fn refuses_bad_indices_and_values() {
        for bad in [
            "v 0 0 0\nf 1 2 3\n",
            "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n",
            "v 0 0 nan\n",
            "v 0 0\n",
            "v 0 0 0\nv 1 0 0\nf 1 2\n",
            "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1//4 2 3\n",
        ] {
            assert_eq!(read(bad.as_bytes()).err(), Some(Error::NotModel), "{bad}");
        }
        assert_eq!(read(b"\xff\xfe").err(), Some(Error::NotModel));
        assert_eq!(read(b"").err(), Some(Error::NotModel));
    }
}
