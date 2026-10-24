//! glTF 2.0 (ISO/IEC 12113): binary GLB files, and glTF JSON whose buffers and images are
//! embedded as `data:` URLs. Meshes are drawn through the node tree of the default scene with
//! their materials' colour, metalness, roughness, emission and transparency; base colour pictures
//! are sampled at the vertices once the browser has decoded them.

use std::borrow::Cow;
use std::collections::HashMap;
use std::rc::Rc;

use serde_json::Value;

use crate::base64::data_url;
use crate::image::probe;
use crate::mesh::{Finish, Mesh, to_srgb};
use crate::{Error, Image, MAX_IMAGE_SIDE, MAX_MESHES, MAX_TRIANGLES, Model, Textured, Unit};

const JSON_CHUNK: u32 = 0x4E4F_534A;
const BIN_CHUNK: u32 = 0x004E_4942;
/// Most elements of an accessor without data (filled with zeros).
const MAX_EMPTY_ACCESSOR: usize = 1_000_000;
/// Extensions a file may require: they change nothing this reader needs.
const KNOWN_EXTENSIONS: [&str; 4] = [
    "KHR_materials_emissive_strength",
    "KHR_texture_transform",
    "KHR_mesh_quantization",
    "KHR_materials_unlit",
];

/// Reads a binary glTF file.
pub(crate) fn read_glb(bytes: &[u8]) -> Result<Model, Error> {
    let word = |at: usize| {
        bytes
            .get(at..at + 4)
            .and_then(|b| b.try_into().ok())
            .map(u32::from_le_bytes)
    };
    if bytes.get(..4) != Some(b"glTF".as_slice()) {
        return Err(Error::NotModel);
    }
    match word(4) {
        Some(2) => {}
        Some(_) => return Err(Error::Unsupported),
        None => return Err(Error::NotModel),
    }
    let length = word(8).ok_or(Error::NotModel)? as usize;
    if length > bytes.len() || length < 20 {
        return Err(Error::NotModel);
    }
    let bytes = &bytes[..length];
    if word(16) != Some(JSON_CHUNK) {
        return Err(Error::NotModel);
    }
    let json_end = 20_usize
        .checked_add(word(12).ok_or(Error::NotModel)? as usize)
        .ok_or(Error::NotModel)?;
    let json = bytes.get(20..json_end).ok_or(Error::NotModel)?;
    let mut bin = None;
    if let (Some(len), Some(BIN_CHUNK)) = (word(json_end), word(json_end + 4)) {
        let start = json_end + 8;
        let end = start.checked_add(len as usize).ok_or(Error::NotModel)?;
        bin = Some(bytes.get(start..end).ok_or(Error::NotModel)?);
    }
    read_document(json, bin)
}

/// Reads a glTF JSON file with embedded data.
pub(crate) fn read_gltf(bytes: &[u8]) -> Result<Model, Error> {
    read_document(bytes, None)
}

fn index(value: Option<&Value>) -> Option<usize> {
    value
        .and_then(Value::as_u64)
        .and_then(|n| usize::try_from(n).ok())
}

fn list<'v>(json: &'v Value, key: &str) -> &'v [Value] {
    json.get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

#[allow(clippy::cast_possible_truncation)]
fn numbers<const N: usize>(value: Option<&Value>, default: [f64; N]) -> Result<[f64; N], Error> {
    let Some(value) = value else {
        return Ok(default);
    };
    let items = value.as_array().ok_or(Error::NotModel)?;
    if items.len() != N {
        return Err(Error::NotModel);
    }
    let mut out = [0.0; N];
    for (slot, v) in out.iter_mut().zip(items) {
        *slot = v
            .as_f64()
            .filter(|n| n.is_finite())
            .ok_or(Error::NotModel)?;
    }
    Ok(out)
}

/// A view into a buffer.
#[derive(Debug, Clone, Copy)]
struct View {
    buffer: usize,
    offset: usize,
    length: usize,
    stride: Option<usize>,
}

/// An accessor's bytes from its first element, the distance between elements and the size of
/// a component.
type Elements<'a> = (&'a [u8], usize, usize);

/// A typed view of elements.
#[derive(Debug, Clone, Copy)]
struct Accessor {
    view: Option<usize>,
    offset: usize,
    component: u64,
    normalized: bool,
    count: usize,
    width: usize,
}

fn component_size(component: u64) -> Option<usize> {
    match component {
        5120 | 5121 => Some(1),
        5122 | 5123 => Some(2),
        5125 | 5126 => Some(4),
        _ => None,
    }
}

/// A material, as far as DomoTwin draws it.
#[derive(Debug, Clone, Copy)]
struct Material {
    /// Linear base colour and alpha.
    base: [f32; 4],
    /// Picture (index in the model's images) and texture coordinate set.
    texture: Option<(u32, usize)>,
    finish: Finish,
    roughness: u8,
    double_sided: bool,
}

const NO_MATERIAL: Material = Material {
    base: [1.0, 1.0, 1.0, 1.0],
    texture: None,
    finish: Finish::Piece,
    roughness: 200,
    double_sided: false,
};

struct Document<'a> {
    json: Value,
    buffers: Vec<Cow<'a, [u8]>>,
    views: Vec<View>,
    accessors: Vec<Accessor>,
    floats: HashMap<usize, Rc<Vec<f32>>>,
}

fn read_document(json: &[u8], bin: Option<&[u8]>) -> Result<Model, Error> {
    let json: Value = serde_json::from_slice(json).map_err(|_| Error::NotModel)?;
    let version = json
        .get("asset")
        .and_then(|a| a.get("version"))
        .and_then(Value::as_str)
        .ok_or(Error::NotModel)?;
    if !version.starts_with("2.") {
        return Err(Error::Unsupported);
    }
    for required in list(&json, "extensionsRequired") {
        let name = required.as_str().unwrap_or_default();
        if !KNOWN_EXTENSIONS.contains(&name) {
            return Err(Error::Unsupported);
        }
    }
    let mut buffers = Vec::new();
    for (i, buffer) in list(&json, "buffers").iter().enumerate() {
        let data: Cow<'_, [u8]> = match buffer.get("uri").and_then(Value::as_str) {
            None if i == 0 => Cow::Borrowed(bin.ok_or(Error::NotModel)?),
            None => return Err(Error::NotModel),
            Some(uri) if uri.starts_with("data:") => {
                Cow::Owned(data_url(uri).ok_or(Error::NotModel)?.1)
            }
            Some(_) => return Err(Error::ExternalReference),
        };
        let length = index(buffer.get("byteLength")).ok_or(Error::NotModel)?;
        if length > data.len() {
            return Err(Error::NotModel);
        }
        buffers.push(data);
    }
    let mut views = Vec::new();
    for view in list(&json, "bufferViews") {
        let v = View {
            buffer: index(view.get("buffer")).ok_or(Error::NotModel)?,
            offset: index(view.get("byteOffset")).unwrap_or(0),
            length: index(view.get("byteLength")).ok_or(Error::NotModel)?,
            stride: index(view.get("byteStride")),
        };
        let end = v.offset.checked_add(v.length).ok_or(Error::NotModel)?;
        if buffers.get(v.buffer).is_none_or(|b| end > b.len()) {
            return Err(Error::NotModel);
        }
        views.push(v);
    }
    let mut accessors = Vec::new();
    for accessor in list(&json, "accessors") {
        if accessor.get("sparse").is_some() {
            return Err(Error::Unsupported);
        }
        let width = match accessor.get("type").and_then(Value::as_str) {
            Some("SCALAR") => 1,
            Some("VEC2") => 2,
            Some("VEC3") => 3,
            Some("VEC4" | "MAT2") => 4,
            Some("MAT3") => 9,
            Some("MAT4") => 16,
            _ => return Err(Error::NotModel),
        };
        let component = accessor
            .get("componentType")
            .and_then(Value::as_u64)
            .filter(|c| component_size(*c).is_some())
            .ok_or(Error::NotModel)?;
        let view = index(accessor.get("bufferView"));
        if view.is_some_and(|v| v >= views.len()) {
            return Err(Error::NotModel);
        }
        accessors.push(Accessor {
            view,
            offset: index(accessor.get("byteOffset")).unwrap_or(0),
            component,
            normalized: accessor.get("normalized").and_then(Value::as_bool) == Some(true),
            count: index(accessor.get("count")).ok_or(Error::NotModel)?,
            width,
        });
    }
    let mut doc = Document {
        json,
        buffers,
        views,
        accessors,
        floats: HashMap::new(),
    };
    doc.draw()
}

impl Document<'_> {
    /// Where an accessor's elements are, checked against its view once for all of them; `None`
    /// for an accessor without data (zeros).
    fn elements(&self, a: &Accessor) -> Result<Option<Elements<'_>>, Error> {
        let size = component_size(a.component).ok_or(Error::NotModel)?;
        let Some(view) = a.view.and_then(|v| self.views.get(v)) else {
            if a.count > MAX_EMPTY_ACCESSOR {
                return Err(Error::NotModel);
            }
            return Ok(None);
        };
        let element = size * a.width;
        let stride = view.stride.unwrap_or(element);
        if stride < element || a.count == 0 {
            return if a.count == 0 {
                Ok(Some((&[], stride.max(1), size)))
            } else {
                Err(Error::NotModel)
            };
        }
        let needed = (a.count - 1)
            .checked_mul(stride)
            .and_then(|n| n.checked_add(element))
            .and_then(|n| n.checked_add(a.offset))
            .ok_or(Error::NotModel)?;
        if needed > view.length {
            return Err(Error::NotModel);
        }
        let buffer = self.buffers.get(view.buffer).ok_or(Error::NotModel)?;
        let start = view.offset + a.offset;
        let data = buffer
            .get(start..start + needed - a.offset)
            .ok_or(Error::NotModel)?;
        Ok(Some((data, stride, size)))
    }

    /// An accessor's elements as floats (`width` per element), normalized integers mapped to
    /// 0–1 or −1–1. Kept for the next primitive that uses it.
    fn floats(&mut self, index: usize, width: usize) -> Result<Rc<Vec<f32>>, Error> {
        let a = *self.accessors.get(index).ok_or(Error::NotModel)?;
        if a.width != width {
            return Err(Error::NotModel);
        }
        if let Some(cached) = self.floats.get(&index) {
            return Ok(Rc::clone(cached));
        }
        // Checked against the data (or the limit of empty accessors) before anything is allocated.
        let elements = self.elements(&a)?;
        let mut out = Vec::with_capacity(a.count * a.width);
        match elements {
            None => out.resize(a.count * a.width, 0.0),
            Some((data, stride, size)) => {
                for i in 0..a.count {
                    for k in 0..a.width {
                        let at = i * stride + k * size;
                        let raw = data.get(at..at + size).ok_or(Error::NotModel)?;
                        out.push(component(raw, a.component, a.normalized));
                    }
                }
            }
        }
        if out.iter().any(|v| !v.is_finite()) {
            return Err(Error::NotModel);
        }
        let out = Rc::new(out);
        self.floats.insert(index, Rc::clone(&out));
        Ok(out)
    }

    /// An index accessor.
    fn indices(&self, index: usize) -> Result<Vec<u32>, Error> {
        let a = self.accessors.get(index).ok_or(Error::NotModel)?;
        if a.width != 1 || !matches!(a.component, 5121 | 5123 | 5125) {
            return Err(Error::NotModel);
        }
        let Some((data, stride, size)) = self.elements(a)? else {
            return Ok(vec![0; a.count]);
        };
        let mut out = Vec::with_capacity(a.count);
        for i in 0..a.count {
            let raw = data
                .get(i * stride..i * stride + size)
                .ok_or(Error::NotModel)?;
            out.push(match raw {
                [b] => u32::from(*b),
                [a, b] => u32::from(u16::from_le_bytes([*a, *b])),
                [a, b, c, d] => u32::from_le_bytes([*a, *b, *c, *d]),
                _ => return Err(Error::NotModel),
            });
        }
        Ok(out)
    }

    /// The materials, registering the pictures they use.
    fn materials(&self, images: &mut Vec<Image>) -> Result<Vec<Material>, Error> {
        let mut by_image: HashMap<usize, Option<u32>> = HashMap::new();
        let mut out = Vec::new();
        for m in list(&self.json, "materials") {
            let pbr = m.get("pbrMetallicRoughness");
            let base = numbers(pbr.and_then(|p| p.get("baseColorFactor")), [1.0; 4])?;
            #[allow(clippy::cast_possible_truncation)]
            let base = base.map(|c| c.clamp(0.0, 1.0) as f32);
            let metallic = pbr
                .and_then(|p| p.get("metallicFactor"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            let roughness = pbr
                .and_then(|p| p.get("roughnessFactor"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            let mr_texture = pbr
                .and_then(|p| p.get("metallicRoughnessTexture"))
                .is_some();
            let strength = m
                .get("extensions")
                .and_then(|e| e.get("KHR_materials_emissive_strength"))
                .and_then(|e| e.get("emissiveStrength"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            let emissive = numbers(m.get("emissiveFactor"), [0.0; 3])?;
            let glows =
                m.get("emissiveTexture").is_some() || emissive.iter().any(|c| c * strength > 0.05);
            let blend = m.get("alphaMode").and_then(Value::as_str) == Some("BLEND");
            let transmission = m
                .get("extensions")
                .and_then(|e| e.get("KHR_materials_transmission"))
                .is_some();
            let finish = if (blend && base[3] < 0.95) || transmission {
                Finish::Glass
            } else if glows {
                Finish::Glow
            } else if metallic >= 0.5 && !mr_texture {
                Finish::Metal
            } else {
                Finish::Matte
            };
            let texture = match pbr.and_then(|p| p.get("baseColorTexture")) {
                Some(t) => {
                    let set = index(t.get("texCoord")).unwrap_or(0);
                    let source = index(t.get("index"))
                        .and_then(|i| list(&self.json, "textures").get(i))
                        .and_then(|t| index(t.get("source")));
                    match source {
                        Some(source) => {
                            let slot = match by_image.get(&source) {
                                Some(slot) => *slot,
                                None => {
                                    let slot = self.image(source, images)?;
                                    by_image.insert(source, slot);
                                    slot
                                }
                            };
                            slot.map(|s| (s, set))
                        }
                        None => None,
                    }
                }
                None => None,
            };
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let roughness = (roughness.clamp(0.05, 1.0) * 255.0).round() as u8;
            out.push(Material {
                base,
                texture,
                finish,
                roughness,
                double_sided: m.get("doubleSided").and_then(Value::as_bool) == Some(true),
            });
        }
        Ok(out)
    }

    /// Registers picture `index` of the file; `None` when its format is not PNG or JPEG (the
    /// material keeps its colour).
    fn image(&self, index: usize, images: &mut Vec<Image>) -> Result<Option<u32>, Error> {
        let image = list(&self.json, "images")
            .get(index)
            .ok_or(Error::NotModel)?;
        let bytes: Vec<u8> = if let Some(view) = index_of(image, "bufferView") {
            let v = self.views.get(view).ok_or(Error::NotModel)?;
            let buffer = self.buffers.get(v.buffer).ok_or(Error::NotModel)?;
            buffer
                .get(v.offset..v.offset + v.length)
                .ok_or(Error::NotModel)?
                .to_vec()
        } else {
            match image.get("uri").and_then(Value::as_str) {
                Some(uri) if uri.starts_with("data:") => data_url(uri).ok_or(Error::NotModel)?.1,
                Some(_) => return Err(Error::ExternalReference),
                None => return Err(Error::NotModel),
            }
        };
        let Some((mime, width, height)) = probe(&bytes) else {
            return Ok(None);
        };
        if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
            return Err(Error::ImageTooLarge);
        }
        if width == 0 || height == 0 {
            return Ok(None);
        }
        let slot = u32::try_from(images.len()).map_err(|_| Error::NotModel)?;
        images.push(Image {
            mime,
            bytes,
            width,
            height,
            decoded: None,
        });
        Ok(Some(slot))
    }

    /// The nodes of the default scene, as a tree, with their world matrices; checks that the
    /// nodes form trees.
    fn instances(&self) -> Result<Vec<(usize, Matrix)>, Error> {
        let nodes = list(&self.json, "nodes");
        let mut parents = vec![0_u8; nodes.len()];
        for node in nodes {
            for child in list(node, "children") {
                let c = index(Some(child)).filter(|c| *c < nodes.len());
                let c = c.ok_or(Error::NotModel)?;
                parents[c] = parents[c].saturating_add(1);
                if parents[c] > 1 {
                    return Err(Error::NotModel);
                }
            }
        }
        let scenes = list(&self.json, "scenes");
        let roots: Vec<usize> =
            match index(self.json.get("scene")).or_else(|| (!scenes.is_empty()).then_some(0)) {
                Some(s) => {
                    let scene = scenes.get(s).ok_or(Error::NotModel)?;
                    list(scene, "nodes")
                        .iter()
                        .map(|n| index(Some(n)).filter(|n| *n < nodes.len() && parents[*n] == 0))
                        .collect::<Option<_>>()
                        .ok_or(Error::NotModel)?
                }
                None => (0..nodes.len()).filter(|n| parents[*n] == 0).collect(),
            };
        let mut visited = vec![false; nodes.len()];
        let mut out = Vec::new();
        let mut stack: Vec<(usize, Matrix)> = roots.iter().rev().map(|r| (*r, IDENTITY)).collect();
        while let Some((n, parent)) = stack.pop() {
            if std::mem::replace(&mut visited[n], true) {
                return Err(Error::NotModel);
            }
            let node = &nodes[n];
            let world = mul(&parent, &local(node)?);
            if let Some(mesh) = index_of(node, "mesh") {
                if out.len() >= MAX_MESHES {
                    return Err(Error::TooManyMeshes);
                }
                out.push((mesh, world));
            }
            for child in list(node, "children").iter().rev() {
                if let Some(c) = index(Some(child)) {
                    stack.push((c, world));
                }
            }
        }
        Ok(out)
    }

    fn draw(&mut self) -> Result<Model, Error> {
        let mut images = Vec::new();
        let materials = self.materials(&mut images)?;
        let instances = self.instances()?;
        let meshes = list(&self.json, "meshes").to_vec();
        let mut out = Mesh::default();
        let mut textured = Vec::new();
        let mut triangles = 0_usize;
        for (mesh, world) in instances {
            let mesh = meshes.get(mesh).ok_or(Error::NotModel)?;
            let det = determinant(&world);
            if det.abs() < 1e-30 || !det.is_finite() {
                continue;
            }
            for primitive in list(mesh, "primitives") {
                let material = match index_of(primitive, "material") {
                    Some(m) => *materials.get(m).ok_or(Error::NotModel)?,
                    None => NO_MATERIAL,
                };
                let drawn =
                    self.primitive(primitive, &material, &world, det, &mut out, &mut textured)?;
                triangles += drawn;
                if triangles > MAX_TRIANGLES {
                    return Err(Error::TooManyTriangles);
                }
            }
        }
        Ok(Model::new(
            out,
            Some(Unit::Meter),
            images,
            textured,
            triangles,
        ))
    }

    /// Draws one primitive; returns its number of triangles.
    #[allow(clippy::too_many_lines)]
    fn primitive(
        &mut self,
        primitive: &Value,
        material: &Material,
        world: &Matrix,
        det: f64,
        out: &mut Mesh,
        textured: &mut Vec<Textured>,
    ) -> Result<usize, Error> {
        let mode = index(primitive.get("mode")).unwrap_or(4);
        if !(4..=6).contains(&mode) {
            return Ok(0);
        }
        let attributes = primitive.get("attributes").ok_or(Error::NotModel)?;
        let attribute = |name: &str| index_of(attributes, name);
        let positions = self.floats(attribute("POSITION").ok_or(Error::NotModel)?, 3)?;
        let count = positions.len() / 3;
        let normals = match attribute("NORMAL") {
            Some(a) => Some(self.floats(a, 3)?),
            None => None,
        };
        let uvs = match material
            .texture
            .and_then(|(_, set)| attribute(&format!("TEXCOORD_{set}")))
        {
            Some(a) => Some(self.floats(a, 2)?),
            None => None,
        };
        let colors = match attribute("COLOR_0") {
            Some(a) => {
                let width = self.accessors.get(a).map_or(0, |acc| acc.width);
                if width != 3 && width != 4 {
                    return Err(Error::NotModel);
                }
                Some((self.floats(a, width)?, width))
            }
            None => None,
        };
        if normals.as_ref().is_some_and(|n| n.len() < 3 * count)
            || uvs.as_ref().is_some_and(|u| u.len() < 2 * count)
            || colors.as_ref().is_some_and(|(c, w)| c.len() < w * count)
        {
            return Err(Error::NotModel);
        }
        let order: Vec<u32> = match index_of(primitive, "indices") {
            Some(i) => self.indices(i)?,
            None => (0..u32::try_from(count).map_err(|_| Error::NotModel)?).collect(),
        };
        // Triangles of the primitive, in its own vertex numbers.
        let n = order.len();
        let corners = match mode {
            4 => n / 3,
            _ => n.saturating_sub(2),
        };
        if corners > MAX_TRIANGLES {
            return Err(Error::TooManyTriangles);
        }
        let mut tris: Vec<[u32; 3]> = Vec::with_capacity(corners);
        for t in 0..corners {
            let tri = match mode {
                4 => [order[3 * t], order[3 * t + 1], order[3 * t + 2]],
                5 if t % 2 == 0 => [order[t], order[t + 1], order[t + 2]],
                5 => [order[t + 1], order[t], order[t + 2]],
                _ => [order[0], order[t + 1], order[t + 2]],
            };
            if tri.iter().any(|v| *v as usize >= count) {
                return Err(Error::NotModel);
            }
            tris.push(tri);
        }
        let flip = det < 0.0;
        let normal_matrix = cofactor(world);
        let sign = det.signum();
        let color_of = |v: usize| -> [f32; 3] {
            let mut c = [material.base[0], material.base[1], material.base[2]];
            if let Some((list, w)) = &colors {
                for k in 0..3 {
                    c[k] *= list[v * w + k].clamp(0.0, 1.0);
                }
            }
            c
        };
        let finish = if material.finish == Finish::Piece && colors.is_some() {
            Finish::Matte
        } else {
            material.finish
        };
        let point = |v: usize| -> [f32; 3] {
            let p = [0, 1, 2].map(|k| f64::from(positions[3 * v + k]));
            #[allow(clippy::cast_possible_truncation)]
            transform(world, p).map(|c| c as f32)
        };
        let sides: &[bool] = if material.double_sided {
            &[false, true]
        } else {
            &[false]
        };
        let push = |out: &mut Mesh, textured: &mut Vec<Textured>, v: usize, n: [f32; 3]| {
            let c = color_of(v);
            let id = out.vertex(point(v), n, c.map(to_srgb), finish, material.roughness);
            if let (Some((image, _)), Some(uvs)) = (material.texture, uvs.as_ref()) {
                textured.push(Textured {
                    vertex: id,
                    image,
                    uv: [uvs[2 * v], uvs[2 * v + 1]],
                    factor: c,
                });
            }
            id
        };
        if let Some(normals) = &normals {
            // Shared vertices, each with its normal.
            for &back in sides {
                let mut ids: HashMap<u32, u32> = HashMap::new();
                for tri in &tris {
                    let mut corner = [0_u32; 3];
                    for (slot, v) in corner.iter_mut().zip(tri) {
                        *slot = match ids.get(v) {
                            Some(id) => *id,
                            None => {
                                let i = *v as usize;
                                let local = [0, 1, 2].map(|k| f64::from(normals[3 * i + k]));
                                let mut n = transform_dir(&normal_matrix, local).map(|c| c * sign);
                                if back {
                                    n = n.map(|c| -c);
                                }
                                #[allow(clippy::cast_possible_truncation)]
                                let id = push(out, textured, i, n.map(|c| c as f32));
                                ids.insert(*v, id);
                                id
                            }
                        };
                    }
                    if flip != back {
                        corner.swap(1, 2);
                    }
                    out.indices.extend_from_slice(&corner);
                }
            }
        } else {
            // No normals: flat faces (glTF 2.0, 3.7.2.1).
            for &back in sides {
                for tri in &tris {
                    let p = tri.map(|v| point(v as usize));
                    let mut n = crate::mesh::cross(
                        crate::mesh::sub(p[1], p[0]),
                        crate::mesh::sub(p[2], p[0]),
                    );
                    if flip {
                        n = n.map(|c| -c);
                    }
                    if back {
                        n = n.map(|c| -c);
                    }
                    let mut corner = tri.map(|v| push(out, textured, v as usize, n));
                    if flip != back {
                        corner.swap(1, 2);
                    }
                    out.indices.extend_from_slice(&corner);
                }
            }
        }
        Ok(tris.len())
    }
}

fn index_of(value: &Value, key: &str) -> Option<usize> {
    index(value.get(key))
}

/// A component as a float (glTF 2.0, 3.11: normalized integers).
fn component(raw: &[u8], component: u64, normalized: bool) -> f32 {
    #[allow(clippy::cast_precision_loss)]
    match (component, raw) {
        (5126, [a, b, c, d]) => f32::from_le_bytes([*a, *b, *c, *d]),
        (5120, [a]) => {
            let v = f32::from(i8::from_le_bytes([*a]));
            if normalized { (v / 127.0).max(-1.0) } else { v }
        }
        (5121, [a]) => {
            let v = f32::from(*a);
            if normalized { v / 255.0 } else { v }
        }
        (5122, [a, b]) => {
            let v = f32::from(i16::from_le_bytes([*a, *b]));
            if normalized {
                (v / 32767.0).max(-1.0)
            } else {
                v
            }
        }
        (5123, [a, b]) => {
            let v = f32::from(u16::from_le_bytes([*a, *b]));
            if normalized { v / 65535.0 } else { v }
        }
        (5125, [a, b, c, d]) => u32::from_le_bytes([*a, *b, *c, *d]) as f32,
        _ => f32::NAN,
    }
}

/// A 4 × 4 matrix, column-major (glTF's order).
type Matrix = [f64; 16];

const IDENTITY: Matrix = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

fn mul(a: &Matrix, b: &Matrix) -> Matrix {
    let mut out = [0.0; 16];
    for col in 0..4 {
        for row in 0..4 {
            out[col * 4 + row] = (0..4).map(|k| a[k * 4 + row] * b[col * 4 + k]).sum();
        }
    }
    out
}

/// A node's own transform: `matrix`, or translation × rotation × scale.
fn local(node: &Value) -> Result<Matrix, Error> {
    if let Some(m) = node.get("matrix") {
        return numbers(Some(m), IDENTITY);
    }
    let [tx, ty, tz] = numbers(node.get("translation"), [0.0; 3])?;
    let [x, y, z, w] = numbers(node.get("rotation"), [0.0, 0.0, 0.0, 1.0])?;
    let [sx, sy, sz] = numbers(node.get("scale"), [1.0; 3])?;
    let len = (x * x + y * y + z * z + w * w).sqrt();
    let (x, y, z, w) = if len > 1e-12 {
        (x / len, y / len, z / len, w / len)
    } else {
        (0.0, 0.0, 0.0, 1.0)
    };
    let r = [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y + z * w),
            2.0 * (x * z - y * w),
        ],
        [
            2.0 * (x * y - z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z + x * w),
        ],
        [
            2.0 * (x * z + y * w),
            2.0 * (y * z - x * w),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ];
    let s = [sx, sy, sz];
    let mut m = IDENTITY;
    for col in 0..3 {
        for row in 0..3 {
            m[col * 4 + row] = r[col][row] * s[col];
        }
    }
    m[12] = tx;
    m[13] = ty;
    m[14] = tz;
    Ok(m)
}

fn transform(m: &Matrix, p: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|row| m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row])
}

fn determinant(m: &Matrix) -> f64 {
    let a = |row: usize, col: usize| m[col * 4 + row];
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1))
        - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
        + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0))
}

/// The cofactor matrix of the upper 3 × 3 (the inverse transpose times the determinant), which
/// carries normals; rows of the result.
fn cofactor(m: &Matrix) -> [[f64; 3]; 3] {
    let a = |row: usize, col: usize| m[col * 4 + row];
    let c = |r: usize, c: usize| {
        let (r1, r2) = ((r + 1) % 3, (r + 2) % 3);
        let (c1, c2) = ((c + 1) % 3, (c + 2) % 3);
        a(r1, c1) * a(r2, c2) - a(r1, c2) * a(r2, c1)
    };
    [
        [c(0, 0), c(0, 1), c(0, 2)],
        [c(1, 0), c(1, 1), c(1, 2)],
        [c(2, 0), c(2, 1), c(2, 2)],
    ]
}

fn transform_dir(rows: &[[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    rows.map(|r| r[0] * v[0] + r[1] * v[1] + r[2] * v[2])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A glTF file of one triangle (and its data URL buffer) with `extra` merged in.
    fn triangle(extra: &Value) -> Vec<u8> {
        let mut data = Vec::new();
        for p in [[0.0_f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]] {
            for c in p {
                data.extend_from_slice(&c.to_le_bytes());
            }
        }
        let mut doc = json!({
            "asset": { "version": "2.0" },
            "buffers": [{ "byteLength": 36, "uri": format!("data:application/octet-stream;base64,{}", encode64(&data)) }],
            "bufferViews": [{ "buffer": 0, "byteLength": 36 }],
            "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
            "nodes": [{ "mesh": 0 }],
            "scenes": [{ "nodes": [0] }],
        });
        merge(&mut doc, extra);
        serde_json::to_vec(&doc).unwrap()
    }

    fn merge(a: &mut Value, b: &Value) {
        if let (Some(a), Some(b)) = (a.as_object_mut(), b.as_object()) {
            for (k, v) in b {
                match a.get_mut(k) {
                    Some(slot) if slot.is_object() && v.is_object() => merge(slot, v),
                    _ => {
                        a.insert(k.clone(), v.clone());
                    }
                }
            }
        }
    }

    pub(crate) fn encode64(bytes: &[u8]) -> String {
        const DIGITS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            for i in 0..4 {
                if i <= chunk.len() {
                    out.push(DIGITS[((n >> (18 - 6 * i)) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    #[test]
    fn reads_a_triangle_with_flat_normals() {
        let model = read_gltf(&triangle(&json!({}))).unwrap();
        assert_eq!(model.triangles, 1);
        assert_eq!(model.unit, Some(Unit::Meter));
        assert_eq!(model.mesh.indices, [0, 1, 2]);
        assert!((model.mesh.normals[0][2] - 1.0).abs() < 1e-6);
        assert_eq!(
            model.mesh.finishes[0],
            Finish::Piece,
            "no material: the piece's colour"
        );
    }

    #[test]
    fn transforms_nodes_and_keeps_faces_outside() {
        // Mirrored by a negative scale: the winding turns so that the face stays in front.
        let model = read_gltf(&triangle(&json!({
            "nodes": [{ "mesh": 0, "scale": [-2, 1, 1], "translation": [0, 0, 5] }],
        })))
        .unwrap();
        let m = &model.mesh;
        assert_eq!(m.positions[1], [-2.0, 0.0, 5.0]);
        let t = [m.indices[0], m.indices[1], m.indices[2]].map(|i| m.positions[i as usize]);
        let n = crate::mesh::cross(crate::mesh::sub(t[1], t[0]), crate::mesh::sub(t[2], t[0]));
        assert!(n[2] > 0.0 && m.normals[0][2] > 0.9);
    }

    #[test]
    fn materials() {
        let model = read_gltf(&triangle(&json!({
            "materials": [{
                "pbrMetallicRoughness": { "baseColorFactor": [1, 0.2159, 0, 1], "metallicFactor": 0, "roughnessFactor": 0.5 },
                "doubleSided": true,
            }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "material": 0 }] }],
        })))
        .unwrap();
        let m = &model.mesh;
        assert_eq!(m.colors[0], [255, 128, 0], "linear factors become sRGB");
        assert_eq!(m.finishes[0], Finish::Matte);
        assert_eq!(m.roughness[0], 128);
        assert_eq!(m.indices.len(), 6, "double sided: both faces");
        assert_eq!(model.triangles, 1);
        let glow = read_gltf(&triangle(&json!({
            "materials": [{ "emissiveFactor": [1, 0.9, 0.6] }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "material": 0 }] }],
        })))
        .unwrap();
        assert_eq!(glow.mesh.finishes[0], Finish::Glow);
        let metal = read_gltf(&triangle(&json!({
            "materials": [{}],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "material": 0 }] }],
        })))
        .unwrap();
        assert_eq!(
            metal.mesh.finishes[0],
            Finish::Metal,
            "glTF's default is metal"
        );
        let glass = read_gltf(&triangle(&json!({
            "materials": [{ "alphaMode": "BLEND", "pbrMetallicRoughness": { "baseColorFactor": [1, 1, 1, 0.3] } }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "material": 0 }] }],
        })))
        .unwrap();
        assert_eq!(glass.mesh.finishes[0], Finish::Glass);
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        let refused = |extra: Value| read_gltf(&triangle(&extra)).err();
        assert_eq!(
            refused(json!({ "buffers": [{ "byteLength": 36, "uri": "triangle.bin" }] })),
            Some(Error::ExternalReference)
        );
        assert_eq!(
            refused(json!({ "extensionsRequired": ["KHR_draco_mesh_compression"] })),
            Some(Error::Unsupported)
        );
        assert_eq!(
            refused(json!({ "asset": { "version": "1.0" } })),
            Some(Error::Unsupported)
        );
        assert_eq!(
            refused(
                json!({ "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3" }] })
            ),
            Some(Error::NotModel),
            "an accessor past its data"
        );
        assert_eq!(
            refused(json!({ "nodes": [{ "mesh": 0, "children": [0] }] })),
            Some(Error::NotModel),
            "a node that is its own child"
        );
        assert_eq!(
            refused(
                json!({ "nodes": [{ "children": [2] }, { "children": [2] }, { "mesh": 0 }], "scenes": [{ "nodes": [0, 1] }] })
            ),
            Some(Error::NotModel),
            "a node with two parents"
        );
        assert_eq!(
            refused(
                json!({ "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "sparse": {} }] })
            ),
            Some(Error::Unsupported)
        );
        assert_eq!(read_gltf(b"{]").err(), Some(Error::NotModel));
    }

    #[test]
    fn checks_counts_before_allocating() {
        for count in [1_000_000_000_000_000_u64, u64::MAX] {
            let refused = read_gltf(&triangle(&json!({
                "accessors": [{ "bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3" }],
            })));
            assert_eq!(refused.err(), Some(Error::NotModel));
            let empty = read_gltf(&triangle(&json!({
                "accessors": [{ "componentType": 5126, "count": count, "type": "VEC3" }],
            })));
            assert_eq!(empty.err(), Some(Error::NotModel));
        }
    }

    #[test]
    fn counts_expanded_meshes() {
        let mut nodes = vec![json!({ "children": (1..=MAX_MESHES + 1).collect::<Vec<_>>() })];
        nodes.extend((0..=MAX_MESHES).map(|_| json!({ "mesh": 0 })));
        let refused = read_gltf(&triangle(
            &json!({ "nodes": nodes, "scenes": [{ "nodes": [0] }] }),
        ));
        assert_eq!(refused.err(), Some(Error::TooManyMeshes));
    }

    #[test]
    fn reads_glb() {
        let json = triangle(&json!({ "buffers": [{ "byteLength": 36 }] }));
        let mut json = json;
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut bin = Vec::new();
        for p in [[0.0_f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]] {
            for c in p {
                bin.extend_from_slice(&c.to_le_bytes());
            }
        }
        let mut glb = b"glTF".to_vec();
        glb.extend_from_slice(&2_u32.to_le_bytes());
        let total = 12 + 8 + json.len() + 8 + bin.len();
        glb.extend_from_slice(&u32::try_from(total).unwrap().to_le_bytes());
        glb.extend_from_slice(&u32::try_from(json.len()).unwrap().to_le_bytes());
        glb.extend_from_slice(&JSON_CHUNK.to_le_bytes());
        glb.extend_from_slice(&json);
        glb.extend_from_slice(&u32::try_from(bin.len()).unwrap().to_le_bytes());
        glb.extend_from_slice(&BIN_CHUNK.to_le_bytes());
        glb.extend_from_slice(&bin);
        assert_eq!(read_glb(&glb).unwrap().triangles, 1);
        assert_eq!(read_glb(&glb[..30]).err(), Some(Error::NotModel));
        let mut v1 = glb.clone();
        v1[4] = 1;
        assert_eq!(read_glb(&v1).err(), Some(Error::Unsupported));
    }
}
