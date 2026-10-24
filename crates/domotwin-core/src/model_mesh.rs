//! The meshes of user models' 3D files, as the import module writes them (`DTM1`, see the
//! `domotwin-models` crate): decoded and checked once, then fitted into every piece that shows
//! the model.

/// Most vertices accepted (a file has at most 150 000 triangles, double-sided faces count twice).
pub const MAX_VERTICES: usize = 1_000_000;
/// Most triangles accepted.
pub const MAX_TRIANGLES: usize = 300_000;

/// How a vertex is shaded (the import module's `Finish`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Finish {
    /// The piece's colour.
    Piece,
    /// Its own colour.
    Matte,
    /// Metal.
    Metal,
    /// Glows with the piece's light.
    Glow,
    /// Glass.
    Glass,
}

/// A decoded mesh, in the file's own axes and unit.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelMesh {
    /// Positions.
    pub positions: Vec<[f32; 3]>,
    /// Unit normals × 127.
    pub normals: Vec<[i8; 3]>,
    /// Finishes.
    pub finishes: Vec<Finish>,
    /// sRGB colour and roughness × 255.
    pub colors: Vec<[u8; 4]>,
    /// Triangles.
    pub indices: Vec<u32>,
    /// Bounding box `[min, max]`.
    pub bounds: [[f32; 3]; 2],
}

/// Why a mesh was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidMesh;

fn word(bytes: &[u8], at: usize) -> Result<u32, InvalidMesh> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or(InvalidMesh)
}

impl ModelMesh {
    /// Decodes a `DTM1` mesh.
    ///
    /// # Errors
    ///
    /// [`InvalidMesh`] when the bytes are not a complete, consistent mesh.
    pub fn decode(bytes: &[u8]) -> Result<Self, InvalidMesh> {
        if bytes.get(..4) != Some(b"DTM1".as_slice()) {
            return Err(InvalidMesh);
        }
        let n = word(bytes, 4)? as usize;
        let i = word(bytes, 8)? as usize;
        if n > MAX_VERTICES || i > 3 * MAX_TRIANGLES || !i.is_multiple_of(3) {
            return Err(InvalidMesh);
        }
        if bytes.len() != 12 + 20 * n + 4 * i {
            return Err(InvalidMesh);
        }
        let mut positions = Vec::with_capacity(n);
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for v in 0..n {
            let at = 12 + 12 * v;
            let mut p = [0.0_f32; 3];
            for (k, slot) in p.iter_mut().enumerate() {
                *slot = f32::from_bits(word(bytes, at + 4 * k)?);
                if !slot.is_finite() {
                    return Err(InvalidMesh);
                }
                min[k] = min[k].min(*slot);
                max[k] = max[k].max(*slot);
            }
            positions.push(p);
        }
        let normals_at = 12 + 12 * n;
        let mut normals = Vec::with_capacity(n);
        let mut finishes = Vec::with_capacity(n);
        for chunk in bytes[normals_at..normals_at + 4 * n].chunks_exact(4) {
            normals.push([chunk[0], chunk[1], chunk[2]].map(|b| i8::from_le_bytes([b])));
            finishes.push(match chunk[3] {
                0 => Finish::Piece,
                1 => Finish::Matte,
                2 => Finish::Metal,
                3 => Finish::Glow,
                4 => Finish::Glass,
                _ => return Err(InvalidMesh),
            });
        }
        let colors_at = normals_at + 4 * n;
        let colors = bytes[colors_at..colors_at + 4 * n]
            .chunks_exact(4)
            .map(|c| [c[0], c[1], c[2], c[3]])
            .collect();
        let indices_at = colors_at + 4 * n;
        let mut indices = Vec::with_capacity(i);
        for k in 0..i {
            let index = word(bytes, indices_at + 4 * k)?;
            if index as usize >= n {
                return Err(InvalidMesh);
            }
            indices.push(index);
        }
        let bounds = if n > 0 { [min, max] } else { [[0.0; 3]; 2] };
        Ok(Self {
            positions,
            normals,
            finishes,
            colors,
            indices,
            bounds,
        })
    }

    /// Number of triangles.
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A `DTM1` mesh of one triangle with `finish` (0–4).
    pub(crate) fn triangle(finish: u8) -> Vec<u8> {
        let mut out = b"DTM1".to_vec();
        out.extend_from_slice(&3_u32.to_le_bytes());
        out.extend_from_slice(&3_u32.to_le_bytes());
        for p in [[0.0_f32, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 1.0, 0.5]] {
            for c in p {
                out.extend_from_slice(&c.to_le_bytes());
            }
        }
        for _ in 0..3 {
            out.extend_from_slice(&[0, 0, 127, finish]);
        }
        for _ in 0..3 {
            out.extend_from_slice(&[200, 100, 50, 128]);
        }
        for i in 0_u32..3 {
            out.extend_from_slice(&i.to_le_bytes());
        }
        out
    }

    #[test]
    fn decodes_and_checks() {
        let mesh = ModelMesh::decode(&triangle(1)).unwrap();
        assert_eq!(mesh.triangle_count(), 1);
        assert_eq!(mesh.bounds, [[0.0, 0.0, 0.0], [2.0, 1.0, 0.5]]);
        assert_eq!(mesh.finishes, [Finish::Matte; 3]);
        assert_eq!(mesh.colors[0], [200, 100, 50, 128]);
        let good = triangle(1);
        assert_eq!(ModelMesh::decode(&good[..good.len() - 1]), Err(InvalidMesh));
        assert_eq!(ModelMesh::decode(&triangle(9)), Err(InvalidMesh));
        let mut bad_index = good.clone();
        let last = bad_index.len() - 4;
        bad_index[last..].copy_from_slice(&3_u32.to_le_bytes());
        assert_eq!(ModelMesh::decode(&bad_index), Err(InvalidMesh));
        let mut nan = good.clone();
        nan[12..16].copy_from_slice(&f32::NAN.to_le_bytes());
        assert_eq!(ModelMesh::decode(&nan), Err(InvalidMesh));
        assert_eq!(ModelMesh::decode(b"DTM2"), Err(InvalidMesh));
    }
}
