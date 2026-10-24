//! The compact mesh handed to the engine, and how triangles without normals get theirs.
//!
//! Encoding (`DTM1`, little endian), read by `domotwin_core::model_mesh`:
//!
//! | Bytes          | Content                                                        |
//! | -------------- | -------------------------------------------------------------- |
//! | 4              | `DTM1`                                                         |
//! | 4              | vertex count `n` (u32)                                         |
//! | 4              | index count `i` (u32, a multiple of 3)                         |
//! | 12 `n`         | positions, `f32` x y z, in the file's axes and unit            |
//! | 4 `n`          | normal x y z (`i8`, × 127) and finish (`u8`, [`Finish`])       |
//! | 4 `n`          | sRGB colour r g b and roughness × 255                          |
//! | 4 `i`          | triangle indices (`u32`), counter-clockwise seen from outside  |

use std::collections::HashMap;

use crate::{Error, MAX_TRIANGLES};

/// How a vertex is shaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Finish {
    /// Painted with the piece's colour (files without colours: STL, most OBJ).
    Piece = 0,
    /// Its own colour, matte to satin.
    Matte = 1,
    /// Metal.
    Metal = 2,
    /// Glows with the light of the piece's lamp or screen (emissive materials).
    Glow = 3,
    /// Glass, drawn transparent.
    Glass = 4,
}

/// An indexed triangle mesh.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Mesh {
    /// Positions.
    pub positions: Vec<[f32; 3]>,
    /// Unit normals.
    pub normals: Vec<[f32; 3]>,
    /// sRGB colours.
    pub colors: Vec<[u8; 3]>,
    /// Finishes.
    pub finishes: Vec<Finish>,
    /// Roughness × 255.
    pub roughness: Vec<u8>,
    /// Triangles.
    pub indices: Vec<u32>,
}

impl Mesh {
    /// Appends a vertex; returns its index.
    pub(crate) fn vertex(
        &mut self,
        p: [f32; 3],
        n: [f32; 3],
        color: [u8; 3],
        finish: Finish,
        roughness: u8,
    ) -> u32 {
        let index = u32::try_from(self.positions.len()).unwrap_or(u32::MAX);
        self.positions.push(p);
        self.normals.push(normalize(n));
        self.colors.push(color);
        self.finishes.push(finish);
        self.roughness.push(roughness);
        index
    }

    /// Bounding box `[min, max]` (zeros when empty).
    pub fn bounds(&self) -> [[f32; 3]; 2] {
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for p in &self.positions {
            for k in 0..3 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        if min[0].is_finite() {
            [min, max]
        } else {
            [[0.0; 3]; 2]
        }
    }

    /// The `DTM1` encoding.
    #[allow(clippy::cast_possible_truncation)]
    pub fn encode(&self) -> Vec<u8> {
        let n = self.positions.len();
        let mut out = Vec::with_capacity(12 + 20 * n + 4 * self.indices.len());
        out.extend_from_slice(b"DTM1");
        out.extend_from_slice(&u32::try_from(n).unwrap_or(0).to_le_bytes());
        out.extend_from_slice(&u32::try_from(self.indices.len()).unwrap_or(0).to_le_bytes());
        for p in &self.positions {
            for c in p {
                out.extend_from_slice(&c.to_le_bytes());
            }
        }
        let q = |c: f32| (c.clamp(-1.0, 1.0) * 127.0).round() as i8;
        for (normal, finish) in self.normals.iter().zip(&self.finishes) {
            let [x, y, z] = normal.map(|c| q(c).to_le_bytes()[0]);
            out.extend_from_slice(&[x, y, z, *finish as u8]);
        }
        for (color, rough) in self.colors.iter().zip(&self.roughness) {
            out.extend_from_slice(&[color[0], color[1], color[2], *rough]);
        }
        for i in &self.indices {
            out.extend_from_slice(&i.to_le_bytes());
        }
        out
    }
}

/// sRGB (0–255) to linear (0–1).
pub(crate) fn to_linear(c: u8) -> f32 {
    let c = f32::from(c) / 255.0;
    if c <= 0.040_45 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear (0–1) to sRGB (0–255).
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub(crate) fn to_srgb(c: f32) -> u8 {
    let c = if c.is_finite() {
        c.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let s = if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round() as u8
}

pub(crate) fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(crate) fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// The unit vector of `v`, or +y when it has no length.
pub(crate) fn normalize(v: [f32; 3]) -> [f32; 3] {
    let len = dot(v, v).sqrt();
    if len > 1e-20 && len.is_finite() {
        v.map(|c| c / len)
    } else {
        [0.0, 1.0, 0.0]
    }
}

/// One corner of a triangle in a [`Soup`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Corner {
    /// Index in [`Soup::positions`]: corners sharing it are smoothed together.
    pub(crate) position: u32,
    pub(crate) color: [u8; 3],
    pub(crate) finish: Finish,
    pub(crate) roughness: u8,
}

/// Triangles over shared positions, without normals (STL, 3MF, OBJ without normals): the
/// normals are made smooth across edges flatter than a crease angle, and sharp elsewhere.
#[derive(Debug, Default)]
pub(crate) struct Soup {
    pub(crate) positions: Vec<[f32; 3]>,
    corners: Vec<Corner>,
}

/// Edges sharper than this stay sharp (degrees).
const CREASE: f32 = 40.0;
/// A position shared by more triangles than this gets flat normals (bounded work).
const MAX_VALENCE: usize = 64;

impl Soup {
    /// A soup over these positions, without triangles yet.
    pub(crate) fn new(positions: Vec<[f32; 3]>) -> Self {
        Self {
            positions,
            corners: Vec::new(),
        }
    }

    /// Number of triangles.
    pub(crate) fn triangles(&self) -> usize {
        self.corners.len() / 3
    }

    /// Appends a triangle.
    ///
    /// # Errors
    ///
    /// [`Error::TooManyTriangles`] past the limit, [`Error::NotModel`] for a position out of
    /// range.
    pub(crate) fn triangle(&mut self, corners: [Corner; 3]) -> Result<(), Error> {
        if self.triangles() >= MAX_TRIANGLES {
            return Err(Error::TooManyTriangles);
        }
        if corners
            .iter()
            .any(|c| c.position as usize >= self.positions.len())
        {
            return Err(Error::NotModel);
        }
        self.corners.extend_from_slice(&corners);
        Ok(())
    }

    /// The indexed mesh with its normals. Triangles without area are left out.
    pub(crate) fn into_mesh(self) -> Mesh {
        let count = self.positions.len();
        let faces: Vec<[f32; 3]> = self
            .corners
            .chunks_exact(3)
            .map(|t| {
                let p = |k: usize| self.positions[t[k].position as usize];
                cross(sub(p(1), p(0)), sub(p(2), p(0)))
            })
            .collect();
        let units: Vec<Option<[f32; 3]>> = faces
            .iter()
            .map(|f| {
                let len = dot(*f, *f).sqrt();
                (len > 1e-20 && len.is_finite()).then(|| f.map(|c| c / len))
            })
            .collect();
        // Triangles around each position (compressed rows).
        let mut start = vec![0_usize; count + 1];
        for c in &self.corners {
            start[c.position as usize + 1] += 1;
        }
        for i in 0..count {
            start[i + 1] += start[i];
        }
        let mut fill = start.clone();
        let mut around = vec![0_u32; self.corners.len()];
        for (i, c) in self.corners.iter().enumerate() {
            let slot = &mut fill[c.position as usize];
            around[*slot] = u32::try_from(i / 3).unwrap_or(0);
            *slot += 1;
        }
        let threshold = CREASE.to_radians().cos();
        let mut mesh = Mesh::default();
        // Position, normal, colour, finish and roughness: one vertex each.
        type Key = (u32, [i8; 3], [u8; 3], u8, u8);
        let mut seen: HashMap<Key, u32> = HashMap::new();
        for (t, corners) in self.corners.chunks_exact(3).enumerate() {
            let Some(own) = units[t] else { continue };
            let mut ids = [0_u32; 3];
            for (slot, c) in ids.iter_mut().zip(corners) {
                let p = c.position as usize;
                let neighbours = &around[start[p]..start[p + 1]];
                let normal = if neighbours.len() > MAX_VALENCE {
                    own
                } else {
                    let mut sum = [0.0_f32; 3];
                    for &u in neighbours {
                        let u = u as usize;
                        if units[u].is_some_and(|n| dot(n, own) >= threshold) {
                            for k in 0..3 {
                                sum[k] += faces[u][k];
                            }
                        }
                    }
                    normalize(sum)
                };
                #[allow(clippy::cast_possible_truncation)]
                let q = normal.map(|v| (v * 127.0).round() as i8);
                let key = (c.position, q, c.color, c.finish as u8, c.roughness);
                *slot = *seen.entry(key).or_insert_with(|| {
                    mesh.vertex(self.positions[p], normal, c.color, c.finish, c.roughness)
                });
            }
            mesh.indices.extend_from_slice(&ids);
        }
        mesh
    }
}

/// Welds equal positions (bit for bit) as they are added.
#[derive(Debug, Default)]
pub(crate) struct Welder {
    seen: HashMap<[u32; 3], u32>,
}

impl Welder {
    /// The index of `p` in `soup.positions`, adding it when new.
    ///
    /// # Errors
    ///
    /// [`Error::NotModel`] for a coordinate that is not finite.
    pub(crate) fn add(&mut self, soup: &mut Soup, p: [f32; 3]) -> Result<u32, Error> {
        if p.iter().any(|c| !c.is_finite()) {
            return Err(Error::NotModel);
        }
        // -0.0 and 0.0 are the same point.
        let key = p.map(|c| if c == 0.0 { 0 } else { c.to_bits() });
        if let Some(index) = self.seen.get(&key) {
            return Ok(*index);
        }
        let index = u32::try_from(soup.positions.len()).map_err(|_| Error::TooLarge)?;
        soup.positions.push(p);
        self.seen.insert(key, index);
        Ok(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn corner(position: u32) -> Corner {
        Corner {
            position,
            color: [200, 100, 50],
            finish: Finish::Piece,
            roughness: 200,
        }
    }

    /// A unit cube: 8 positions, 12 triangles facing out.
    fn cube() -> Soup {
        let mut soup = Soup::default();
        for i in 0..8 {
            soup.positions
                .push([(i & 1) as f32, ((i >> 1) & 1) as f32, ((i >> 2) & 1) as f32]);
        }
        let quads = [
            [0, 2, 3, 1],
            [4, 5, 7, 6],
            [0, 1, 5, 4],
            [2, 6, 7, 3],
            [0, 4, 6, 2],
            [1, 3, 7, 5],
        ];
        for q in quads {
            soup.triangle([corner(q[0]), corner(q[1]), corner(q[2])])
                .unwrap();
            soup.triangle([corner(q[0]), corner(q[2]), corner(q[3])])
                .unwrap();
        }
        soup
    }

    #[test]
    fn creases_stay_sharp() {
        let mesh = cube().into_mesh();
        assert_eq!(mesh.indices.len(), 36);
        // Each corner of the cube is split by its three faces: 24 vertices.
        assert_eq!(mesh.positions.len(), 24);
        for n in &mesh.normals {
            let axis = n.iter().filter(|c| c.abs() > 0.99).count();
            assert_eq!(axis, 1, "a flat face normal: {n:?}");
        }
        // Faces point out of the cube.
        for t in mesh.indices.chunks_exact(3) {
            let p = |k: usize| mesh.positions[t[k] as usize];
            let n = cross(sub(p(1), p(0)), sub(p(2), p(0)));
            let centre = [0, 1, 2].map(|k| (p(0)[k] + p(1)[k] + p(2)[k]) / 3.0 - 0.5);
            assert!(dot(n, centre) > 0.0);
            assert!(dot(mesh.normals[t[0] as usize], centre) > 0.0);
        }
    }

    #[test]
    fn gentle_bends_are_smooth() {
        // Two triangles folded by 20°: one shared normal on the fold.
        let a = 20.0_f32.to_radians();
        let mut soup = Soup::new(vec![
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
            [-1.0, 0.0, 0.0],
            [a.cos(), a.sin(), 0.0],
        ]);
        soup.triangle([corner(0), corner(1), corner(2)]).unwrap();
        soup.triangle([corner(0), corner(3), corner(1)]).unwrap();
        let mesh = soup.into_mesh();
        assert_eq!(mesh.positions.len(), 4);
    }

    #[test]
    fn limits_and_degenerate_triangles() {
        let mut soup = Soup::new(vec![[0.0; 3], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]]);
        assert_eq!(
            soup.triangle([corner(0), corner(1), corner(9)]),
            Err(Error::NotModel)
        );
        soup.triangle([corner(0), corner(1), corner(2)]).unwrap();
        assert!(soup.into_mesh().indices.is_empty(), "no area: left out");
        let mut welder = Welder::default();
        let mut soup = Soup::default();
        assert_eq!(welder.add(&mut soup, [0.0, -0.0, 1.0]), Ok(0));
        assert_eq!(welder.add(&mut soup, [-0.0, 0.0, 1.0]), Ok(0));
        assert_eq!(
            welder.add(&mut soup, [f32::NAN, 0.0, 1.0]),
            Err(Error::NotModel)
        );
    }

    #[test]
    fn encodes_and_converts_colours() {
        let mesh = cube().into_mesh();
        let bytes = mesh.encode();
        assert_eq!(&bytes[..4], b"DTM1");
        assert_eq!(bytes.len(), 12 + 20 * 24 + 4 * 36);
        for c in [0_u8, 1, 10, 128, 200, 255] {
            assert_eq!(to_srgb(to_linear(c)), c);
        }
        assert_eq!(to_srgb(f32::NAN), 0);
        assert_eq!(to_srgb(4.0), 255);
    }
}
