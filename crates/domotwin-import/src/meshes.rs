//! The triangles of a mesh scan (`DECISIONS.md`, D-062): OBJ, PLY (text or binary), GLB and STL,
//! read for their positions alone (no colour, no texture, no normal), within budget. What a
//! scanning app exports: Polycam, Scaniverse, 3D Scanner App, Matterport's OBJ…

use serde_json::Value as Json;

use crate::math::{Transform, V3};

/// Most triangles read.
pub(crate) const MAX_TRIANGLES: usize = 5_000_000;
/// Most vertices read: three a triangle, as STL has them (sharing none).
const MAX_VERTICES: usize = 3 * MAX_TRIANGLES;
/// Most nodes of a glTF scene once expanded.
const MAX_NODES: usize = 10_000;
/// Farthest coordinate read.
const FAR: f32 = 1e7;

/// The formats of mesh scans.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeshFormat {
    Obj,
    Ply,
    Glb,
    Stl,
}

impl MeshFormat {
    /// The axis that points up in the format's files: `y` (1), `z` (2) for STL.
    pub(crate) fn up(self) -> usize {
        match self {
            MeshFormat::Stl => 2,
            _ => 1,
        }
    }
}

/// A mesh read: its positions in the file's unit and axes, its triangles, and whether the format
/// says metres (glTF).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Triangles {
    pub(crate) positions: Vec<[f32; 3]>,
    pub(crate) triangles: Vec<[u32; 3]>,
    pub(crate) metres: bool,
}

impl Triangles {
    fn vertex(&mut self, p: [f32; 3]) -> Result<(), &'static str> {
        if self.positions.len() >= MAX_VERTICES {
            return Err("mesh_too_large");
        }
        let p = p.map(|v| {
            if v.is_finite() && v.abs() < FAR {
                v
            } else {
                0.0
            }
        });
        self.positions.push(p);
        Ok(())
    }

    /// A polygon of vertex indices, as a fan of triangles.
    fn polygon(&mut self, corners: &[u32]) -> Result<(), &'static str> {
        for k in 2..corners.len() {
            if self.triangles.len() >= MAX_TRIANGLES {
                return Err("mesh_too_large");
            }
            self.triangles
                .push([corners[0], corners[k - 1], corners[k]]);
        }
        Ok(())
    }
}

/// The format of a mesh from its first bytes, when it is one.
pub(crate) fn sniff(bytes: &[u8]) -> Option<MeshFormat> {
    if bytes.starts_with(b"glTF") {
        return Some(MeshFormat::Glb);
    }
    if bytes.starts_with(b"ply\n") || bytes.starts_with(b"ply\r\n") {
        return Some(MeshFormat::Ply);
    }
    // Binary STL: an 80-byte header, a count, 50 bytes a triangle (its header may say "solid").
    if let Some(count) = bytes.get(80..84) {
        let n = u32::from_le_bytes([count[0], count[1], count[2], count[3]]) as usize;
        if n > 0 && n.checked_mul(50).and_then(|b| b.checked_add(84)) == Some(bytes.len()) {
            return Some(MeshFormat::Stl);
        }
    }
    let start = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let start = start.trim_start_matches('\u{feff}').trim_start();
    if start.starts_with("solid") && start.contains("facet") {
        return Some(MeshFormat::Stl);
    }
    // OBJ: lines of vertices (`v`), faces (`f`), groups, materials, comments and OBJ's other
    // statements; the last line left out when the start cuts it.
    let mut lines: Vec<&str> = start.lines().collect();
    if bytes.len() > 4096 {
        lines.pop();
    }
    let mut vertices = 0;
    for line in lines.into_iter().map(str::trim) {
        let word = line.split_whitespace().next().unwrap_or_default();
        match word {
            "v" => vertices += 1,
            "" | "vn" | "vt" | "vp" | "f" | "l" | "p" | "o" | "g" | "s" | "mg" | "usemtl"
            | "mtllib" | "usemap" | "maplib" | "lod" | "cstype" | "deg" | "bmat" | "step"
            | "curv" | "curv2" | "surf" | "parm" | "trim" | "hole" | "scrv" | "sp" | "end"
            | "con" | "bevel" | "c_interp" | "d_interp" | "shadow_obj" | "trace_obj" | "ctech"
            | "stech" => {}
            _ if word.starts_with('#') => {}
            _ => return None,
        }
    }
    (vertices > 0).then_some(MeshFormat::Obj)
}

/// Reads a mesh.
///
/// # Errors
///
/// `not_plan` for a broken file, `mesh_too_large` past 5 million, `mesh_points` for points
/// without faces, `external_reference` for a glTF needing other files, `unsupported` for a
/// compressed glTF.
pub(crate) fn read(bytes: &[u8], format: MeshFormat) -> Result<Triangles, &'static str> {
    let mesh = match format {
        MeshFormat::Obj => obj(bytes)?,
        MeshFormat::Ply => ply(bytes)?,
        MeshFormat::Glb => glb(bytes)?,
        MeshFormat::Stl => stl(bytes)?,
    };
    if mesh.triangles.is_empty() {
        return Err(if mesh.positions.is_empty() {
            "not_plan"
        } else {
            "mesh_points"
        });
    }
    Ok(mesh)
}

fn obj(bytes: &[u8]) -> Result<Triangles, &'static str> {
    let mut mesh = Triangles::default();
    let mut corners: Vec<u32> = Vec::new();
    for raw in bytes.split(|b| *b == b'\n') {
        let line = std::str::from_utf8(raw).unwrap_or_default().trim();
        let mut parts = line.split_whitespace();
        match parts.next() {
            Some("v") => {
                let mut p = [0.0_f32; 3];
                for v in &mut p {
                    *v = parts
                        .next()
                        .and_then(|s| s.parse().ok())
                        .ok_or("not_plan")?;
                }
                mesh.vertex(p)?;
            }
            Some("f") => {
                corners.clear();
                let count = mesh.positions.len();
                let mut valid = true;
                for part in parts {
                    let first = part.split('/').next().unwrap_or_default();
                    let Ok(k) = first.parse::<i64>() else {
                        valid = false;
                        break;
                    };
                    // From 1, or counted back from the last vertex.
                    let index = if k > 0 { k - 1 } else { count as i64 + k };
                    match u32::try_from(index) {
                        Ok(i) if (i as usize) < count => corners.push(i),
                        _ => {
                            valid = false;
                            break;
                        }
                    }
                }
                if valid {
                    mesh.polygon(&corners)?;
                }
            }
            _ => {}
        }
    }
    Ok(mesh)
}

/// A PLY property's type and size (bytes).
fn ply_type(name: &str) -> Option<(char, usize)> {
    Some(match name {
        "char" | "int8" => ('i', 1),
        "uchar" | "uint8" => ('u', 1),
        "short" | "int16" => ('i', 2),
        "ushort" | "uint16" => ('u', 2),
        "int" | "int32" => ('i', 4),
        "uint" | "uint32" => ('u', 4),
        "float" | "float32" => ('f', 4),
        "double" | "float64" => ('f', 8),
        _ => return None,
    })
}

#[derive(Debug, Clone)]
enum PlyProperty {
    Scalar {
        name: String,
        kind: (char, usize),
    },
    List {
        name: String,
        count: (char, usize),
        item: (char, usize),
    },
}

#[derive(Debug, Clone)]
struct PlyElement {
    name: String,
    count: usize,
    properties: Vec<PlyProperty>,
}

/// A number of a binary PLY.
fn ply_number(bytes: &[u8], at: usize, (kind, size): (char, usize), big: bool) -> Option<f64> {
    let raw = bytes.get(at..at.checked_add(size)?)?;
    let mut b = [0_u8; 8];
    b[..size].copy_from_slice(raw);
    if big {
        b[..size].reverse();
    }
    Some(match (kind, size) {
        ('u', 1) => f64::from(b[0]),
        ('i', 1) => f64::from(b[0].cast_signed()),
        ('u', 2) => f64::from(u16::from_le_bytes([b[0], b[1]])),
        ('i', 2) => f64::from(i16::from_le_bytes([b[0], b[1]])),
        ('u', 4) => f64::from(u32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        ('i', 4) => f64::from(i32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        ('f', 4) => f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        ('f', 8) => f64::from_le_bytes(b),
        _ => return None,
    })
}

#[allow(clippy::too_many_lines)]
fn ply(bytes: &[u8]) -> Result<Triangles, &'static str> {
    let end = bytes
        .windows(10)
        .take(64 * 1024)
        .position(|w| w == b"end_header")
        .ok_or("not_plan")?;
    let header = std::str::from_utf8(&bytes[..end]).map_err(|_| "not_plan")?;
    let mut body = end + 10;
    // Past the end of the header's line.
    while bytes.get(body).is_some_and(|b| *b == b'\r' || *b == b' ') {
        body += 1;
    }
    if bytes.get(body) == Some(&b'\n') {
        body += 1;
    }
    let mut format = "";
    let mut elements: Vec<PlyElement> = Vec::new();
    for line in header.lines().map(str::trim) {
        let words: Vec<&str> = line.split_whitespace().collect();
        match words.as_slice() {
            ["format", f, ..] => format = f,
            ["element", name, count] => elements.push(PlyElement {
                name: (*name).to_owned(),
                count: count.parse().map_err(|_| "not_plan")?,
                properties: Vec::new(),
            }),
            ["property", "list", count, item, name] => {
                let e = elements.last_mut().ok_or("not_plan")?;
                e.properties.push(PlyProperty::List {
                    name: (*name).to_owned(),
                    count: ply_type(count).ok_or("not_plan")?,
                    item: ply_type(item).ok_or("not_plan")?,
                });
            }
            ["property", kind, name] => {
                let e = elements.last_mut().ok_or("not_plan")?;
                e.properties.push(PlyProperty::Scalar {
                    name: (*name).to_owned(),
                    kind: ply_type(kind).ok_or("not_plan")?,
                });
            }
            _ => {}
        }
    }
    let big = match format {
        "ascii" => None,
        "binary_little_endian" => Some(false),
        "binary_big_endian" => Some(true),
        _ => return Err("not_plan"),
    };
    let mut mesh = Triangles::default();
    let mut corners: Vec<u32> = Vec::new();
    let mut text = big.is_none().then(|| {
        std::str::from_utf8(&bytes[body..])
            .unwrap_or_default()
            .split_whitespace()
    });
    let mut at = body;
    for element in &elements {
        let vertex = element.name == "vertex";
        let face = element.name == "face";
        if vertex && element.count > MAX_VERTICES {
            return Err("mesh_too_large");
        }
        // Each of its properties takes a byte at least: more than the file holds is not a PLY.
        if element.properties.is_empty() {
            continue;
        }
        if element.count > bytes.len() {
            return Err("not_plan");
        }
        let xyz: Vec<Option<usize>> = ["x", "y", "z"]
            .iter()
            .map(|axis| {
                element
                    .properties
                    .iter()
                    .position(|p| matches!(p, PlyProperty::Scalar { name, .. } if name == axis))
            })
            .collect();
        for _ in 0..element.count {
            let mut p = [0.0_f32; 3];
            corners.clear();
            for (k, property) in element.properties.iter().enumerate() {
                match property {
                    PlyProperty::Scalar { kind, .. } => {
                        let v = match (&mut text, big) {
                            (Some(words), _) => words.next().and_then(|w| w.parse::<f64>().ok()),
                            (None, Some(big)) => {
                                let v = ply_number(bytes, at, *kind, big);
                                at += kind.1;
                                v
                            }
                            (None, None) => None,
                        }
                        .ok_or("not_plan")?;
                        if let Some(axis) = xyz.iter().position(|i| *i == Some(k)) {
                            #[allow(clippy::cast_possible_truncation)]
                            {
                                p[axis] = v as f32;
                            }
                        }
                    }
                    PlyProperty::List { name, count, item } => {
                        let n = match (&mut text, big) {
                            (Some(words), _) => words.next().and_then(|w| w.parse::<f64>().ok()),
                            (None, Some(big)) => {
                                let v = ply_number(bytes, at, *count, big);
                                at += count.1;
                                v
                            }
                            (None, None) => None,
                        }
                        .ok_or("not_plan")?;
                        if !(0.0..=1_000.0).contains(&n) {
                            return Err("not_plan");
                        }
                        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                        let n = n as usize;
                        let indices = face && (name == "vertex_indices" || name == "vertex_index");
                        for _ in 0..n {
                            let v = match (&mut text, big) {
                                (Some(words), _) => {
                                    words.next().and_then(|w| w.parse::<f64>().ok())
                                }
                                (None, Some(big)) => {
                                    let v = ply_number(bytes, at, *item, big);
                                    at += item.1;
                                    v
                                }
                                (None, None) => None,
                            }
                            .ok_or("not_plan")?;
                            if indices {
                                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                                corners.push(if v >= 0.0 { v as u32 } else { u32::MAX });
                            }
                        }
                    }
                }
            }
            if vertex {
                mesh.vertex(p)?;
            } else if face {
                let count = mesh.positions.len();
                if corners.iter().all(|&i| (i as usize) < count) {
                    mesh.polygon(&corners)?;
                }
            }
        }
    }
    Ok(mesh)
}

fn stl(bytes: &[u8]) -> Result<Triangles, &'static str> {
    let mut mesh = Triangles::default();
    let binary = bytes.get(80..84).is_some_and(|c| {
        let n = u32::from_le_bytes([c[0], c[1], c[2], c[3]]) as usize;
        n.checked_mul(50).and_then(|b| b.checked_add(84)) == Some(bytes.len())
    });
    if binary {
        for record in bytes[84..].chunks_exact(50) {
            let base = u32::try_from(mesh.positions.len()).map_err(|_| "mesh_too_large")?;
            for k in 0..3 {
                let at = 12 + 12 * k;
                let f = |i: usize| {
                    let b = &record[at + 4 * i..at + 4 * i + 4];
                    f32::from_le_bytes([b[0], b[1], b[2], b[3]])
                };
                mesh.vertex([f(0), f(1), f(2)])?;
            }
            mesh.polygon(&[base, base + 1, base + 2])?;
        }
        return Ok(mesh);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "not_plan")?;
    let mut corners: Vec<u32> = Vec::new();
    for line in text.lines().map(str::trim) {
        let mut parts = line.split_whitespace();
        if parts.next() != Some("vertex") {
            continue;
        }
        let mut p = [0.0_f32; 3];
        for v in &mut p {
            *v = parts
                .next()
                .and_then(|s| s.parse().ok())
                .ok_or("not_plan")?;
        }
        corners.push(u32::try_from(mesh.positions.len()).map_err(|_| "mesh_too_large")?);
        mesh.vertex(p)?;
        if corners.len() == 3 {
            mesh.polygon(&corners)?;
            corners.clear();
        }
    }
    Ok(mesh)
}

fn glb(bytes: &[u8]) -> Result<Triangles, &'static str> {
    let u32_at = |at: usize| -> Option<usize> {
        let b = bytes.get(at..at + 4)?;
        Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    if u32_at(4) != Some(2) {
        return Err("unsupported");
    }
    let json_len = u32_at(12).ok_or("not_plan")?;
    if u32_at(16) != Some(0x4E4F_534A) {
        return Err("not_plan");
    }
    let json = bytes.get(20..20 + json_len).ok_or("not_plan")?;
    let doc: Json = serde_json::from_slice(json).map_err(|_| "not_plan")?;
    let bin_at = 20 + json_len;
    let bin = match (u32_at(bin_at), u32_at(bin_at + 4)) {
        (Some(len), Some(0x004E_4942)) => bytes.get(bin_at + 8..bin_at + 8 + len),
        _ => None,
    };
    for required in doc["extensionsRequired"].as_array().into_iter().flatten() {
        let name = required.as_str().unwrap_or_default();
        if name.contains("draco") || name.contains("meshopt") || name.contains("quantization") {
            return Err("unsupported");
        }
    }
    let mut mesh = Triangles {
        metres: true,
        ..Triangles::default()
    };
    // The nodes to draw: the scene's, with their transforms.
    let nodes = doc["nodes"].as_array().map_or(&[][..], Vec::as_slice);
    let scene = doc["scene"].as_u64().unwrap_or(0) as usize;
    let roots: Vec<usize> = doc["scenes"][scene]["nodes"]
        .as_array()
        .map(|r| {
            r.iter()
                .filter_map(|n| n.as_u64().map(|n| n as usize))
                .collect()
        })
        .unwrap_or_else(|| (0..nodes.len()).collect());
    let mut stack: Vec<(usize, Transform, usize)> = roots
        .into_iter()
        .map(|n| (n, Transform::IDENTITY, 0))
        .collect();
    let mut visited = 0;
    while let Some((index, parent, depth)) = stack.pop() {
        visited += 1;
        if visited > MAX_NODES || depth > 32 {
            return Err("mesh_too_large");
        }
        let Some(node) = nodes.get(index) else {
            continue;
        };
        let world = parent.then(&node_transform(node));
        for child in node["children"].as_array().into_iter().flatten() {
            if let Some(c) = child.as_u64() {
                stack.push((c as usize, world, depth + 1));
            }
        }
        let Some(m) = node["mesh"].as_u64() else {
            continue;
        };
        for primitive in doc["meshes"][m as usize]["primitives"]
            .as_array()
            .into_iter()
            .flatten()
        {
            primitive_triangles(&doc, bin, primitive, &world, &mut mesh)?;
        }
    }
    Ok(mesh)
}

/// A node's transform: its matrix, else its translation, rotation and scale.
fn node_transform(node: &Json) -> Transform {
    let numbers = |key: &str| -> Vec<f64> {
        node[key]
            .as_array()
            .map(|a| a.iter().filter_map(Json::as_f64).collect())
            .unwrap_or_default()
    };
    let m = numbers("matrix");
    if m.len() == 16 && m.iter().all(|v| v.is_finite()) {
        // Column major: the columns are the axes, then the translation.
        return Transform {
            x: [m[0], m[1], m[2]],
            y: [m[4], m[5], m[6]],
            z: [m[8], m[9], m[10]],
            origin: [m[12], m[13], m[14]],
        };
    }
    let t = numbers("translation");
    let r = numbers("rotation");
    let s = numbers("scale");
    let t: V3 = if t.len() == 3 {
        [t[0], t[1], t[2]]
    } else {
        [0.0; 3]
    };
    let s: V3 = if s.len() == 3 {
        [s[0], s[1], s[2]]
    } else {
        [1.0; 3]
    };
    let [qx, qy, qz, qw] = if r.len() == 4 {
        [r[0], r[1], r[2], r[3]]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    };
    let rotate = |v: V3| -> V3 {
        // v + 2w(q × v) + 2 q × (q × v)
        let q = [qx, qy, qz];
        let c = [
            q[1] * v[2] - q[2] * v[1],
            q[2] * v[0] - q[0] * v[2],
            q[0] * v[1] - q[1] * v[0],
        ];
        let cc = [
            q[1] * c[2] - q[2] * c[1],
            q[2] * c[0] - q[0] * c[2],
            q[0] * c[1] - q[1] * c[0],
        ];
        [0, 1, 2].map(|k| v[k] + 2.0 * qw * c[k] + 2.0 * cc[k])
    };
    let axis = |k: usize| {
        let mut e = [0.0; 3];
        e[k] = s[k];
        rotate(e)
    };
    Transform {
        x: axis(0),
        y: axis(1),
        z: axis(2),
        origin: t,
    }
}

/// The triangles of a glTF primitive, placed by `world`.
fn primitive_triangles(
    doc: &Json,
    bin: Option<&[u8]>,
    primitive: &Json,
    world: &Transform,
    mesh: &mut Triangles,
) -> Result<(), &'static str> {
    let mode = primitive["mode"].as_u64().unwrap_or(4);
    if !(4..=6).contains(&mode) {
        return Ok(());
    }
    let Some(position) = primitive["attributes"]["POSITION"].as_u64() else {
        return Ok(());
    };
    let (raw, stride, count) = accessor(doc, bin, position as usize, 5126, 12)?;
    let base = u32::try_from(mesh.positions.len()).map_err(|_| "mesh_too_large")?;
    if mesh.positions.len() + count > MAX_VERTICES {
        return Err("mesh_too_large");
    }
    for k in 0..count {
        let at = k * stride;
        let f = |i: usize| {
            raw.get(at + 4 * i..at + 4 * i + 4)
                .map_or(0.0, |b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        };
        let p = world.point([f64::from(f(0)), f64::from(f(1)), f64::from(f(2))]);
        #[allow(clippy::cast_possible_truncation)]
        mesh.vertex(p.map(|v| v as f32))?;
    }
    let indices: Vec<u32> = match primitive["indices"].as_u64() {
        Some(i) => {
            let kind = doc["accessors"][i as usize]["componentType"]
                .as_u64()
                .unwrap_or(0);
            let size = match kind {
                5121 => 1,
                5123 => 2,
                5125 => 4,
                _ => return Err("not_plan"),
            };
            let (raw, stride, n) = accessor(doc, bin, i as usize, kind, size)?;
            (0..n)
                .map(|k| {
                    let b = raw.get(k * stride..k * stride + size).unwrap_or_default();
                    match b {
                        [v] => u32::from(*v),
                        [a, b] => u32::from(u16::from_le_bytes([*a, *b])),
                        [a, b, c, d] => u32::from_le_bytes([*a, *b, *c, *d]),
                        _ => u32::MAX,
                    }
                })
                .collect()
        }
        None => (0..u32::try_from(count).map_err(|_| "mesh_too_large")?).collect(),
    };
    let valid = |i: u32| (i as usize) < count;
    let mut push = |a: u32, b: u32, c: u32| -> Result<(), &'static str> {
        if valid(a) && valid(b) && valid(c) {
            mesh.polygon(&[base + a, base + b, base + c])?;
        }
        Ok(())
    };
    match mode {
        4 => {
            for t in indices.chunks_exact(3) {
                push(t[0], t[1], t[2])?;
            }
        }
        5 => {
            for k in 2..indices.len() {
                push(indices[k - 2], indices[k - 1], indices[k])?;
            }
        }
        _ => {
            for k in 2..indices.len() {
                push(indices[0], indices[k - 1], indices[k])?;
            }
        }
    }
    Ok(())
}

/// An accessor's bytes in the binary chunk, its stride and its count, checked to be of
/// `component` (`size` bytes an element).
fn accessor<'a>(
    doc: &Json,
    bin: Option<&'a [u8]>,
    index: usize,
    component: u64,
    size: usize,
) -> Result<(&'a [u8], usize, usize), &'static str> {
    let a = &doc["accessors"][index];
    if a["componentType"].as_u64() != Some(component) || a["normalized"].as_bool() == Some(true) {
        return Err("unsupported");
    }
    let count = a["count"].as_u64().ok_or("not_plan")? as usize;
    if count > MAX_VERTICES * 3 {
        return Err("mesh_too_large");
    }
    let view = &doc["bufferViews"][a["bufferView"].as_u64().ok_or("not_plan")? as usize];
    let buffer = view["buffer"].as_u64().unwrap_or(0);
    if buffer != 0 || doc["buffers"][0]["uri"].is_string() {
        return Err("external_reference");
    }
    let bin = bin.ok_or("not_plan")?;
    let start = (view["byteOffset"].as_u64().unwrap_or(0) as usize)
        .checked_add(a["byteOffset"].as_u64().unwrap_or(0) as usize)
        .ok_or("not_plan")?;
    let stride = view["byteStride"]
        .as_u64()
        .map_or(size, |s| s as usize)
        .max(size);
    let length = view["byteLength"].as_u64().ok_or("not_plan")? as usize;
    let view_end = (view["byteOffset"].as_u64().unwrap_or(0) as usize)
        .checked_add(length)
        .ok_or("not_plan")?;
    let needed = if count == 0 {
        0
    } else {
        (count - 1)
            .checked_mul(stride)
            .and_then(|n| n.checked_add(size))
            .ok_or("not_plan")?
    };
    let end = start.checked_add(needed).ok_or("not_plan")?;
    if end > view_end || end > bin.len() {
        return Err("not_plan");
    }
    Ok((&bin[start..end], stride, count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obj_and_its_formats() {
        let obj_text = b"# scan\nmtllib scan.mtl\nv 0 0 0\nv 1 0 0\nv 1 0 1\nv 0 0 1\nvt 0 0\nf 1/1 2/1 3/1 4/1\nf -1 -2 -3\nf 1 2 9\n";
        assert_eq!(sniff(obj_text), Some(MeshFormat::Obj));
        let mesh = read(obj_text, MeshFormat::Obj).unwrap();
        assert_eq!((mesh.positions.len(), mesh.triangles.len()), (4, 3));
        assert_eq!(mesh.triangles[2], [3, 2, 1]);
        assert_eq!(sniff(b"0\nSECTION\n"), None);
        assert_eq!(
            read(b"v 0 0 0\nv 1 1 1\n", MeshFormat::Obj).err(),
            Some("mesh_points")
        );
        // Lines of edges; a material's name cut where the start of the file ends.
        assert_eq!(sniff(b"v 0 0 0\nv 1 0 0\nl 1 2\n"), Some(MeshFormat::Obj));
        let mut long = b"v 0 0 0\n".repeat(511);
        long.extend_from_slice(b"# ab\nusemtl wall\nf 1 2 3\n");
        assert!(long.len() > 4096 && &long[4093..4096] == b"use");
        assert_eq!(sniff(&long), Some(MeshFormat::Obj));
    }

    #[test]
    fn ply_as_text_and_binary() {
        let text = b"ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 255\n1 0 0 0\n0 1 0 9\n3 0 1 2\n";
        assert_eq!(sniff(text), Some(MeshFormat::Ply));
        let mesh = read(text, MeshFormat::Ply).unwrap();
        assert_eq!((mesh.positions.len(), mesh.triangles.len()), (3, 1));
        assert_eq!(mesh.positions[1], [1.0, 0.0, 0.0]);
        let mut binary = b"ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar uint vertex_indices\nend_header\n".to_vec();
        for p in [[0.0_f32, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 0.0, 2.0]] {
            for v in p {
                binary.extend_from_slice(&v.to_le_bytes());
            }
        }
        binary.push(3);
        for i in [0_u32, 1, 2] {
            binary.extend_from_slice(&i.to_le_bytes());
        }
        let mesh = read(&binary, MeshFormat::Ply).unwrap();
        assert_eq!(mesh.positions[2], [0.0, 0.0, 2.0]);
        assert_eq!(mesh.triangles, [[0, 1, 2]]);
        // Points alone: a point cloud.
        let points = b"ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n";
        assert_eq!(read(points, MeshFormat::Ply).err(), Some("mesh_points"));
        assert_eq!(
            read(&binary[..binary.len() - 3], MeshFormat::Ply).err(),
            Some("not_plan")
        );
    }

    #[test]
    fn stl_both_ways() {
        let mut binary = vec![0_u8; 80];
        binary.extend_from_slice(&1_u32.to_le_bytes());
        binary.extend_from_slice(&[0; 12]);
        for p in [[0.0_f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]] {
            for v in p {
                binary.extend_from_slice(&v.to_le_bytes());
            }
        }
        binary.extend_from_slice(&[0; 2]);
        assert_eq!(sniff(&binary), Some(MeshFormat::Stl));
        assert_eq!(read(&binary, MeshFormat::Stl).unwrap().triangles.len(), 1);
        let text = b"solid scan\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid\n";
        assert_eq!(sniff(text), Some(MeshFormat::Stl));
        assert_eq!(read(text, MeshFormat::Stl).unwrap().triangles.len(), 1);
    }

    #[test]
    fn glb_with_its_nodes() {
        let positions: Vec<u8> = [[0.0_f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]
            .iter()
            .flat_map(|p| p.iter().flat_map(|v| v.to_le_bytes()))
            .collect();
        let indices: Vec<u8> = [0_u16, 1, 2, 0]
            .iter()
            .flat_map(|i| i.to_le_bytes())
            .collect();
        let mut bin = positions.clone();
        bin.extend(&indices);
        let doc = serde_json::json!({
            "asset": { "version": "2.0" }, "scene": 0, "scenes": [{ "nodes": [0] }],
            "nodes": [{ "children": [1], "translation": [10.0, 0.0, 0.0] }, { "mesh": 0, "scale": [2.0, 2.0, 2.0] }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "indices": 1 }] }],
            "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" },
                { "bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR" },
            ],
            "bufferViews": [
                { "buffer": 0, "byteOffset": 0, "byteLength": 36 },
                { "buffer": 0, "byteOffset": 36, "byteLength": 8 },
            ],
            "buffers": [{ "byteLength": 44 }],
        });
        let pack = |doc: &serde_json::Value| {
            let mut json = doc.to_string().into_bytes();
            while !json.len().is_multiple_of(4) {
                json.push(b' ');
            }
            let mut glb = b"glTF".to_vec();
            glb.extend_from_slice(&2_u32.to_le_bytes());
            glb.extend_from_slice(&((28 + json.len() + bin.len()) as u32).to_le_bytes());
            glb.extend_from_slice(&(json.len() as u32).to_le_bytes());
            glb.extend_from_slice(b"JSON");
            glb.extend(&json);
            glb.extend_from_slice(&(bin.len() as u32).to_le_bytes());
            glb.extend_from_slice(b"BIN\0");
            glb.extend(&bin);
            glb
        };
        let glb = pack(&doc);
        assert_eq!(sniff(&glb), Some(MeshFormat::Glb));
        let mesh = read(&glb, MeshFormat::Glb).unwrap();
        assert!(mesh.metres);
        assert_eq!(mesh.triangles.len(), 1);
        assert_eq!(mesh.positions[1], [12.0, 0.0, 0.0]);
        // Offsets past any file, which add up past any number.
        let mut far = doc.clone();
        far["bufferViews"][0]["byteOffset"] = (u64::MAX / 2 + 1).into();
        far["accessors"][0]["byteOffset"] = (u64::MAX / 2 + 1).into();
        assert_eq!(read(&pack(&far), MeshFormat::Glb).err(), Some("not_plan"));
    }
}
