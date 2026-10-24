//! STL, binary or ASCII. Triangles only, without colours: the model takes the piece's colour.
//! Equal corners are welded and the normals rebuilt (the stored facet normals are often wrong).

use crate::mesh::{Corner, Finish, Soup, Welder};
use crate::{Error, MAX_TRIANGLES, Model};

const CORNER: Corner = Corner {
    position: 0,
    color: [255, 255, 255],
    finish: Finish::Piece,
    roughness: 200,
};

pub(crate) fn read(bytes: &[u8]) -> Result<Model, Error> {
    let count = bytes
        .get(80..84)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    // A binary file's size follows from its triangle count; ASCII files may start like one.
    let binary = count
        .is_some_and(|n| n.checked_mul(50).and_then(|b| b.checked_add(84)) == Some(bytes.len()));
    let mut soup = Soup::default();
    let mut welder = Welder::default();
    let mut triangle = |soup: &mut Soup, corners: [[f32; 3]; 3]| -> Result<(), Error> {
        let mut out = [CORNER; 3];
        for (slot, p) in out.iter_mut().zip(corners) {
            slot.position = welder.add(soup, p)?;
        }
        soup.triangle(out)
    };
    if binary {
        let n = count.unwrap_or(0);
        if n > MAX_TRIANGLES {
            return Err(Error::TooManyTriangles);
        }
        for t in 0..n {
            let at = 84 + 50 * t + 12;
            let mut corners = [[0.0_f32; 3]; 3];
            for (k, corner) in corners.iter_mut().enumerate() {
                for (c, slot) in corner.iter_mut().enumerate() {
                    let i = at + 12 * k + 4 * c;
                    let b = bytes.get(i..i + 4).ok_or(Error::NotModel)?;
                    *slot = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                }
            }
            triangle(&mut soup, corners)?;
        }
    } else {
        let text = std::str::from_utf8(bytes).map_err(|_| Error::NotModel)?;
        let mut words = text.split_ascii_whitespace();
        if !words
            .next()
            .is_some_and(|w| w.eq_ignore_ascii_case("solid"))
        {
            return Err(Error::NotModel);
        }
        let mut corners: Vec<[f32; 3]> = Vec::with_capacity(3);
        while let Some(word) = words.next() {
            match word {
                "vertex" => {
                    let mut p = [0.0_f32; 3];
                    for slot in &mut p {
                        *slot = words
                            .next()
                            .and_then(|w| w.parse().ok())
                            .ok_or(Error::NotModel)?;
                    }
                    corners.push(p);
                    if corners.len() > 3 {
                        return Err(Error::NotModel);
                    }
                }
                "endloop" => {
                    let [a, b, c] = corners[..] else {
                        return Err(Error::NotModel);
                    };
                    triangle(&mut soup, [a, b, c])?;
                    corners.clear();
                }
                _ => {}
            }
        }
    }
    let triangles = soup.triangles();
    Ok(Model::new(
        soup.into_mesh(),
        None,
        Vec::new(),
        Vec::new(),
        triangles,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TETRA: [[[f32; 3]; 3]; 4] = [
        [[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
        [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
        [[0.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]],
        [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    ];

    pub(crate) fn binary(triangles: &[[[f32; 3]; 3]]) -> Vec<u8> {
        // A header that starts like an ASCII file, as some exporters write.
        let mut out = b"solid tetra".to_vec();
        out.resize(80, b' ');
        out.extend_from_slice(&u32::try_from(triangles.len()).unwrap().to_le_bytes());
        for t in triangles {
            out.extend_from_slice(&[0; 12]);
            for p in t {
                for c in p {
                    out.extend_from_slice(&c.to_le_bytes());
                }
            }
            out.extend_from_slice(&[0, 0]);
        }
        out
    }

    #[test]
    fn reads_binary_and_ascii() {
        let model = read(&binary(&TETRA)).unwrap();
        assert_eq!(model.triangles, 4);
        assert_eq!(model.mesh.indices.len(), 12);
        assert_eq!(model.mesh.positions.len(), 12, "every corner is sharp");
        let mut ascii = String::from("solid tetra\n");
        for t in TETRA {
            ascii.push_str("  facet normal 0 0 0\n    outer loop\n");
            for p in t {
                ascii.push_str(&format!("      vertex {} {} {}\n", p[0], p[1], p[2]));
            }
            ascii.push_str("    endloop\n  endfacet\n");
        }
        ascii.push_str("endsolid tetra\n");
        assert_eq!(read(ascii.as_bytes()).unwrap().mesh, model.mesh);
    }

    #[test]
    fn refuses_broken_files() {
        let good = binary(&TETRA);
        assert_eq!(read(&good[..good.len() - 1]).err(), Some(Error::NotModel));
        assert_eq!(
            read(b"solid x\nfacet\nouter loop\nvertex 0 0\n").err(),
            Some(Error::NotModel)
        );
        assert_eq!(
            read(b"solid x\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\n").err(),
            Some(Error::NotModel)
        );
        let mut nan = good.clone();
        nan[96..100].copy_from_slice(&f32::NAN.to_le_bytes());
        assert_eq!(read(&nan).err(), Some(Error::NotModel));
        let mut huge = b"x".repeat(80);
        huge.extend_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(read(&huge).err(), Some(Error::NotModel));
    }
}
