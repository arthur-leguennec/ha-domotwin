//! 3MF (3D Manufacturing Format, core specification 1.3): the meshes of the build items with
//! their components, coloured by base materials and colour groups (materials extension), with
//! parts split into other model files of the same archive (production extension). Pictures,
//! slices and lattices are not read.

use std::collections::HashMap;
use std::rc::Rc;

use crate::mesh::{Corner, Finish, Soup};
use crate::xml::{Event, Reader};
use crate::zip::Archive;
use crate::{Error, MAX_MESHES, MAX_TRIANGLES, Model, Unit};

/// Deepest nesting of components.
const MAX_NESTING: usize = 16;

/// A row-vector affine transform `x' = x · M` stored as 3MF writes it: `m00 m01 m02 m10 … m32`.
type Transform = [f64; 12];

const IDENTITY: Transform = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];

#[derive(Debug, Clone, Copy)]
struct Triangle {
    v: [u32; 3],
    pid: Option<u32>,
    p: [Option<u32>; 3],
}

#[derive(Debug, Clone)]
struct Component {
    object: u32,
    transform: Transform,
    path: Option<String>,
}

#[derive(Debug, Clone)]
enum Shape {
    Mesh {
        vertices: Vec<[f32; 3]>,
        triangles: Vec<Triangle>,
    },
    Components(Vec<Component>),
}

#[derive(Debug, Clone)]
struct Object {
    shape: Shape,
    pid: Option<u32>,
    pindex: Option<u32>,
}

/// One model file of the archive.
#[derive(Debug, Default)]
struct Part {
    unit: Option<Unit>,
    /// Base materials and colour groups by resource id: sRGB colours with alpha.
    colors: HashMap<u32, Vec<[u8; 4]>>,
    objects: HashMap<u32, Object>,
    build: Vec<Component>,
}

fn number<T: std::str::FromStr>(value: Option<&str>) -> Result<T, Error> {
    value
        .and_then(|v| v.trim().parse().ok())
        .ok_or(Error::NotModel)
}

fn optional<T: std::str::FromStr>(value: Option<&str>) -> Result<Option<T>, Error> {
    value.map(|v| number(Some(v))).transpose()
}

fn transform(value: Option<&str>) -> Result<Transform, Error> {
    let Some(value) = value else {
        return Ok(IDENTITY);
    };
    let mut out = [0.0; 12];
    let mut parts = value.split_ascii_whitespace();
    for slot in &mut out {
        *slot = parts
            .next()
            .and_then(|p| p.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .ok_or(Error::NotModel)?;
    }
    if parts.next().is_some() {
        return Err(Error::NotModel);
    }
    Ok(out)
}

/// `a` then `b`.
fn then(a: &Transform, b: &Transform) -> Transform {
    let m = |t: &Transform, r: usize, c: usize| t[r * 3 + c];
    let mut out = [0.0; 12];
    for r in 0..4 {
        for c in 0..3 {
            let mut v = (0..3).map(|k| m(a, r, k) * m(b, k, c)).sum::<f64>();
            if r == 3 {
                v += m(b, 3, c);
            }
            out[r * 3 + c] = v;
        }
    }
    out
}

fn apply(t: &Transform, p: [f32; 3]) -> [f64; 3] {
    let p = p.map(f64::from);
    [0, 1, 2].map(|c| p[0] * t[c] + p[1] * t[3 + c] + p[2] * t[6 + c] + t[9 + c])
}

fn determinant(t: &Transform) -> f64 {
    t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6])
        + t[2] * (t[3] * t[7] - t[4] * t[6])
}

/// `#RRGGBB` or `#RRGGBBAA`.
fn color(value: Option<&str>) -> Result<[u8; 4], Error> {
    let hex = value
        .and_then(|v| v.trim().strip_prefix('#'))
        .ok_or(Error::NotModel)?;
    let byte = |i: usize| {
        hex.get(i..i + 2)
            .and_then(|h| u8::from_str_radix(h, 16).ok())
            .ok_or(Error::NotModel)
    };
    match hex.len() {
        6 => Ok([byte(0)?, byte(2)?, byte(4)?, 255]),
        8 => Ok([byte(0)?, byte(2)?, byte(4)?, byte(6)?]),
        _ => Err(Error::NotModel),
    }
}

/// The model part the package's relationships name.
fn start_part(archive: &Archive<'_>) -> Result<String, Error> {
    let rels = archive.read("_rels/.rels")?;
    let mut reader = Reader::new(&rels)?;
    while let Some(event) = reader.next()? {
        if let Event::Start(tag) = event
            && tag.name == "Relationship"
            && tag.attr("Type").is_some_and(|t| t.ends_with("/3dmodel"))
        {
            let target = tag.attr("Target").ok_or(Error::NotModel)?;
            return Ok(target.to_owned());
        }
    }
    Err(Error::NotModel)
}

#[allow(clippy::too_many_lines)]
fn parse(bytes: &[u8]) -> Result<Part, Error> {
    let mut reader = Reader::new(bytes)?;
    let mut part = Part::default();
    let mut group: Option<u32> = None;
    let mut object: Option<(u32, Object)> = None;
    let mut root = true;
    while let Some(event) = reader.next()? {
        let tag = match event {
            Event::Start(tag) => tag,
            Event::End(name) => {
                match name {
                    "basematerials" | "colorgroup" => group = None,
                    "object" => {
                        let (id, done) = object.take().ok_or(Error::NotModel)?;
                        part.objects.insert(id, done);
                    }
                    _ => {}
                }
                continue;
            }
        };
        if std::mem::take(&mut root) {
            if tag.name != "model" {
                return Err(Error::NotModel);
            }
            part.unit = Some(match tag.attr("unit").unwrap_or("millimeter") {
                "micron" => Unit::Micron,
                "millimeter" => Unit::Millimeter,
                "centimeter" => Unit::Centimeter,
                "meter" => Unit::Meter,
                "inch" => Unit::Inch,
                "foot" => Unit::Foot,
                _ => return Err(Error::NotModel),
            });
            for prefix in tag
                .attr("requiredextensions")
                .unwrap_or_default()
                .split_ascii_whitespace()
            {
                let namespace = tag.attr(prefix).unwrap_or_default();
                if !(namespace.contains("/3dmanufacturing/material/")
                    || namespace.contains("/3dmanufacturing/production/"))
                {
                    return Err(Error::Unsupported);
                }
            }
            continue;
        }
        match tag.name {
            "basematerials" | "colorgroup" => {
                let id = number(tag.attr("id"))?;
                if part.colors.insert(id, Vec::new()).is_some() {
                    return Err(Error::NotModel);
                }
                group = (!tag.empty).then_some(id);
            }
            "base" | "color" => {
                let value = if tag.name == "base" {
                    tag.attr("displaycolor")
                } else {
                    tag.attr("color")
                };
                let id = group.ok_or(Error::NotModel)?;
                let c = color(value)?;
                part.colors.entry(id).or_default().push(c);
            }
            "object" => {
                if object.is_some() {
                    return Err(Error::NotModel);
                }
                let id: u32 = number(tag.attr("id"))?;
                let pid = optional(tag.attr("pid"))?;
                let pindex = optional(tag.attr("pindex"))?;
                let support = matches!(tag.attr("type"), Some("support" | "solidsupport"));
                let o = Object {
                    shape: Shape::Components(Vec::new()),
                    pid,
                    pindex,
                };
                if part.objects.contains_key(&id) {
                    return Err(Error::NotModel);
                }
                if support {
                    // Printing supports are not part of the object: an empty one.
                    part.objects.insert(id, o.clone());
                    object = (!tag.empty).then_some((u32::MAX, o));
                } else if tag.empty {
                    part.objects.insert(id, o);
                } else {
                    object = Some((id, o));
                }
            }
            "mesh" => {
                let (_, o) = object.as_mut().ok_or(Error::NotModel)?;
                o.shape = Shape::Mesh {
                    vertices: Vec::new(),
                    triangles: Vec::new(),
                };
            }
            "vertex" => {
                let Some((
                    _,
                    Object {
                        shape: Shape::Mesh { vertices, .. },
                        ..
                    },
                )) = object.as_mut()
                else {
                    return Err(Error::NotModel);
                };
                let p: [f32; 3] = [
                    number(tag.attr("x"))?,
                    number(tag.attr("y"))?,
                    number(tag.attr("z"))?,
                ];
                if p.iter().any(|c| !c.is_finite()) {
                    return Err(Error::NotModel);
                }
                vertices.push(p);
            }
            "triangle" => {
                let Some((
                    _,
                    Object {
                        shape:
                            Shape::Mesh {
                                vertices,
                                triangles,
                            },
                        ..
                    },
                )) = object.as_mut()
                else {
                    return Err(Error::NotModel);
                };
                let v: [u32; 3] = [
                    number(tag.attr("v1"))?,
                    number(tag.attr("v2"))?,
                    number(tag.attr("v3"))?,
                ];
                if v.iter().any(|i| *i as usize >= vertices.len()) {
                    return Err(Error::NotModel);
                }
                triangles.push(Triangle {
                    v,
                    pid: optional(tag.attr("pid"))?,
                    p: [
                        optional(tag.attr("p1"))?,
                        optional(tag.attr("p2"))?,
                        optional(tag.attr("p3"))?,
                    ],
                });
            }
            "component" => {
                let Some((
                    _,
                    Object {
                        shape: Shape::Components(list),
                        ..
                    },
                )) = object.as_mut()
                else {
                    return Err(Error::NotModel);
                };
                list.push(Component {
                    object: number(tag.attr("objectid"))?,
                    transform: transform(tag.attr("transform"))?,
                    path: tag.attr("path").map(str::to_owned),
                });
            }
            "item" => {
                part.build.push(Component {
                    object: number(tag.attr("objectid"))?,
                    transform: transform(tag.attr("transform"))?,
                    path: tag.attr("path").map(str::to_owned),
                });
            }
            _ => {}
        }
    }
    part.objects.remove(&u32::MAX);
    Ok(part)
}

struct Drawing<'a> {
    archive: Archive<'a>,
    parts: HashMap<String, Rc<Part>>,
    soup: Soup,
    meshes: usize,
}

impl Drawing<'_> {
    fn part(&mut self, path: &str) -> Result<Rc<Part>, Error> {
        let key = path.trim_start_matches('/').to_ascii_lowercase();
        if let Some(part) = self.parts.get(&key) {
            return Ok(Rc::clone(part));
        }
        if !self.archive.has(path) {
            return Err(Error::NotModel);
        }
        let part = Rc::new(parse(&self.archive.read(path)?)?);
        self.parts.insert(key, Rc::clone(&part));
        Ok(part)
    }

    fn draw(&mut self, path: &str, object: u32, t: &Transform, depth: usize) -> Result<(), Error> {
        if depth > MAX_NESTING {
            return Err(Error::NotModel);
        }
        let part = self.part(path)?;
        let o = part.objects.get(&object).ok_or(Error::NotModel)?;
        match &o.shape {
            Shape::Components(list) => {
                for c in list {
                    let inner = then(&c.transform, t);
                    let inner_path = c.path.as_deref().unwrap_or(path);
                    self.draw(inner_path, c.object, &inner, depth + 1)?;
                }
            }
            Shape::Mesh {
                vertices,
                triangles,
            } => {
                self.meshes += 1;
                if self.meshes > MAX_MESHES {
                    return Err(Error::TooManyMeshes);
                }
                if self.soup.triangles() + triangles.len() > MAX_TRIANGLES {
                    return Err(Error::TooManyTriangles);
                }
                let flip = determinant(t) < 0.0;
                let mut ids: HashMap<u32, u32> = HashMap::new();
                for tri in triangles {
                    let mut corners = [Corner {
                        position: 0,
                        color: [255; 3],
                        finish: Finish::Piece,
                        roughness: 200,
                    }; 3];
                    for (k, corner) in corners.iter_mut().enumerate() {
                        let v = tri.v[k];
                        corner.position = match ids.get(&v) {
                            Some(id) => *id,
                            None => {
                                #[allow(clippy::cast_possible_truncation)]
                                let p = apply(t, vertices[v as usize]).map(|c| c as f32);
                                if p.iter().any(|c| !c.is_finite()) {
                                    return Err(Error::NotModel);
                                }
                                let id = u32::try_from(self.soup.positions.len())
                                    .map_err(|_| Error::TooLarge)?;
                                self.soup.positions.push(p);
                                ids.insert(v, id);
                                id
                            }
                        };
                        // A triangle's `pid` and `p1` (… `p3`) override the object's.
                        let pid = tri.pid.or(o.pid);
                        let index = tri.p[k]
                            .or(tri.p[0])
                            .or(o.pindex.filter(|_| tri.pid.is_none()));
                        if let Some(group) = pid.and_then(|pid| part.colors.get(&pid)) {
                            let index = index.ok_or(Error::NotModel)? as usize;
                            let c = *group.get(index).ok_or(Error::NotModel)?;
                            corner.color = [c[0], c[1], c[2]];
                            corner.finish = if c[3] < 128 {
                                Finish::Glass
                            } else {
                                Finish::Matte
                            };
                        }
                    }
                    if flip {
                        corners.swap(1, 2);
                    }
                    self.soup.triangle(corners)?;
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn read(bytes: &[u8]) -> Result<Model, Error> {
    let archive = Archive::new(bytes)?;
    let start = start_part(&archive)?;
    let mut drawing = Drawing {
        archive,
        parts: HashMap::new(),
        soup: Soup::default(),
        meshes: 0,
    };
    let root = drawing.part(&start)?;
    for item in &root.build {
        let path = item.path.as_deref().unwrap_or(&start);
        drawing.draw(path, item.object, &item.transform, 0)?;
    }
    let triangles = drawing.soup.triangles();
    Ok(Model::new(
        drawing.soup.into_mesh(),
        root.unit,
        Vec::new(),
        Vec::new(),
        triangles,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip::tests::archive;

    const RELS: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>"#;

    /// A model of one coloured triangle, placed twice (once through a component).
    fn model(extra: &str) -> String {
        format!(
            r##"<?xml version="1.0" encoding="UTF-8"?>
<model unit="centimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" {extra}>
  <resources>
    <basematerials id="1"><base name="Red" displaycolor="#FF0000"/><base name="Glass" displaycolor="#FFFFFF40"/></basematerials>
    <object id="2" type="model" pid="1" pindex="0">
      <mesh>
        <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
        <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="1" pid="1" p1="1"/></triangles>
      </mesh>
    </object>
    <object id="3"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></components></object>
  </resources>
  <build><item objectid="2"/><item objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 5"/></build>
</model>"##
        )
    }

    fn package(model: &str) -> Vec<u8> {
        archive(&[
            ("_rels/.rels", RELS),
            ("3D/3dmodel.model", model.as_bytes()),
        ])
    }

    #[test]
    fn reads_items_components_and_colours() {
        let m = read(&package(&model(""))).unwrap();
        assert_eq!(m.triangles, 4);
        assert_eq!(m.unit, Some(Unit::Centimeter));
        let [min, max] = m.mesh.bounds();
        assert_eq!((min, max), ([0.0, 0.0, 0.0], [11.0, 1.0, 5.0]));
        assert!(m.mesh.colors.contains(&[255, 0, 0]));
        assert!(m.mesh.finishes.contains(&Finish::Glass));
        assert!(m.mesh.finishes.contains(&Finish::Matte));
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        let bad = |text: &str| read(&package(text)).err();
        assert_eq!(
            bad(&model(
                r#"xmlns:s="http://schemas.microsoft.com/3dmanufacturing/slice/2015/07" requiredextensions="s""#
            )),
            Some(Error::Unsupported)
        );
        assert_eq!(
            bad(&model("").replace(r#"v3="2""#, r#"v3="9""#)),
            Some(Error::NotModel)
        );
        assert_eq!(
            bad(&model("").replace(r#"<component objectid="2""#, r#"<component objectid="3""#)),
            Some(Error::NotModel),
            "a component of itself"
        );
        assert_eq!(
            bad(&model("").replace("#FF0000", "red")),
            Some(Error::NotModel)
        );
        let no_rels = archive(&[("3D/3dmodel.model", model("").as_bytes())]);
        assert_eq!(read(&no_rels).err(), Some(Error::NotModel));
        assert_eq!(read(b"not a zip").err(), Some(Error::NotModel));
    }

    #[test]
    fn transforms_compose() {
        let a = [2.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0];
        let b = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 3.0, 0.0];
        // Scale by 2 and move by x + 1, then move by y + 3.
        assert_eq!(apply(&then(&a, &b), [1.0, 0.0, 0.0]), [3.0, 3.0, 0.0]);
        assert!(transform(Some("1 0 0")).is_err());
        assert!(transform(Some("1 0 0 0 1 0 0 0 1 0 0 0 7")).is_err());
    }
}
