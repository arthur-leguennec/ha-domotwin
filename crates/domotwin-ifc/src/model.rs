//! The parts of an IFC model the import needs: units, placements, the spatial structure, the
//! relations between elements, properties, and the geometry reduced to points and outlines.
//! Attribute positions follow IFC2x3 and IFC4 (they agree for everything read here).

use std::cell::Cell;
use std::collections::HashMap;

use crate::math::{P2, Transform, V3, convex_hull, normalize, signed_area2};
use crate::step::{Entity, StepFile, Value};

/// Deepest chain of placements or nested representation items followed.
const MAX_DEPTH: usize = 32;
/// Most geometry points gathered for one product.
const MAX_POINTS: usize = 200_000;
/// Most items, curves, faces and profiles visited to read one product's geometry: a file whose
/// items refer to themselves (`#5=IFCGEOMETRICSET((#5,#5))`) stops here instead of fanning out.
const MAX_STEPS: u32 = 200_000;

/// An IFC file ready to be queried.
#[derive(Debug)]
pub struct Model {
    pub step: StepFile,
    /// Centimetres per length unit of the file.
    pub cm: f64,
    /// Radians per plane angle unit of the file.
    pub radians: f64,
    /// Children aggregated into an object (`IfcRelAggregates`).
    pub parts: HashMap<u32, Vec<u32>>,
    /// Elements contained in a spatial structure (`IfcRelContainedInSpatialStructure`).
    pub contained: HashMap<u32, Vec<u32>>,
    /// The structure an element is contained in.
    pub container: HashMap<u32, u32>,
    /// Opening filled by an element (`IfcRelFillsElement`): element → opening.
    pub fills: HashMap<u32, u32>,
    /// Element an opening is cut in (`IfcRelVoidsElement`): opening → element.
    pub voids: HashMap<u32, u32>,
    /// Property sets of an object (`IfcRelDefinesByProperties`).
    pub properties: HashMap<u32, Vec<u32>>,
    /// Type object of an occurrence (`IfcRelDefinesByType`).
    pub types: HashMap<u32, u32>,
    /// Material of an element (`IfcRelAssociatesMaterial`).
    pub materials: HashMap<u32, u32>,
    /// What is left of the current geometry walk (see `MAX_STEPS`).
    steps: Cell<u32>,
}

fn point3(values: &[Value]) -> Option<V3> {
    let x = values.first()?.number()?;
    let y = values.get(1).and_then(Value::number).unwrap_or(0.0);
    let z = values.get(2).and_then(Value::number).unwrap_or(0.0);
    Some([x, y, z])
}

impl Model {
    pub fn new(step: StepFile) -> Self {
        let mut model = Model {
            step,
            cm: 100.0,
            radians: 1.0,
            parts: HashMap::new(),
            contained: HashMap::new(),
            container: HashMap::new(),
            fills: HashMap::new(),
            voids: HashMap::new(),
            properties: HashMap::new(),
            types: HashMap::new(),
            materials: HashMap::new(),
            steps: Cell::new(MAX_STEPS),
        };
        model.read_units();
        model.read_relations();
        model
    }

    pub fn get(&self, id: u32) -> Option<Entity<'_>> {
        self.step.get(id)
    }

    /// Takes one step of the current geometry walk; false once the walk is over budget.
    fn step(&self) -> bool {
        let left = self.steps.get();
        self.steps.set(left.saturating_sub(1));
        left > 0
    }

    fn read_units(&mut self) {
        let Some(&project) = self.step.of_type("IFCPROJECT").first() else {
            return;
        };
        let Some(units) = self.get(project).and_then(|p| p.reference(8)) else {
            return;
        };
        let Some(assignment) = self.get(units) else {
            return;
        };
        for unit in assignment.get(0).references() {
            let Some(e) = self.get(unit) else { continue };
            let kind = e.enumeration(1).unwrap_or_default().to_owned();
            let factor = match e.ty {
                "IFCSIUNIT" => si_factor(e.enumeration(2), e.enumeration(3)),
                "IFCCONVERSIONBASEDUNIT" => self.conversion_factor(&e),
                _ => None,
            };
            match (kind.as_str(), factor) {
                ("LENGTHUNIT", Some(m)) if m > 0.0 => self.cm = m * 100.0,
                ("PLANEANGLEUNIT", Some(r)) if r > 0.0 => self.radians = r,
                _ => {}
            }
        }
    }

    /// The SI value of a conversion-based unit (`FOOT`: 0.3048 metre, `DEGREE`: π/180 radian).
    fn conversion_factor(&self, unit: &Entity<'_>) -> Option<f64> {
        let measure = self.get(unit.reference(3)?)?;
        let value = measure.number(0)?;
        let base = measure
            .reference(1)
            .and_then(|id| self.get(id))
            .and_then(|si| si_factor(si.enumeration(2), si.enumeration(3)))
            .unwrap_or(1.0);
        Some(value * base)
    }

    fn read_relations(&mut self) {
        let pairs: [(&str, usize, usize); 7] = [
            ("IFCRELAGGREGATES", 4, 5),
            ("IFCRELCONTAINEDINSPATIALSTRUCTURE", 5, 4),
            ("IFCRELFILLSELEMENT", 4, 5),
            ("IFCRELVOIDSELEMENT", 4, 5),
            ("IFCRELDEFINESBYPROPERTIES", 5, 4),
            ("IFCRELDEFINESBYTYPE", 5, 4),
            ("IFCRELASSOCIATESMATERIAL", 5, 4),
        ];
        for (ty, one, many) in pairs {
            for &rel in self.step.of_type(ty) {
                let Some(e) = self.step.get(rel) else {
                    continue;
                };
                let Some(a) = e.reference(one) else { continue };
                let related: Vec<u32> = match e.get(many) {
                    Value::Ref(r) => vec![*r],
                    other => other.references(),
                };
                for b in related {
                    match ty {
                        "IFCRELAGGREGATES" => self.parts.entry(a).or_default().push(b),
                        "IFCRELCONTAINEDINSPATIALSTRUCTURE" => {
                            self.contained.entry(a).or_default().push(b);
                            self.container.insert(b, a);
                        }
                        "IFCRELFILLSELEMENT" => {
                            self.fills.insert(b, a);
                        }
                        "IFCRELVOIDSELEMENT" => {
                            self.voids.insert(b, a);
                        }
                        "IFCRELDEFINESBYPROPERTIES" => {
                            self.properties.entry(b).or_default().push(a);
                        }
                        "IFCRELDEFINESBYTYPE" => {
                            self.types.insert(b, a);
                        }
                        _ => {
                            self.materials.insert(b, a);
                        }
                    }
                }
            }
        }
    }

    /// A point in the file's units, from an `IfcCartesianPoint`.
    pub fn point(&self, id: u32) -> Option<V3> {
        let e = self.get(id)?;
        point3(e.get(0).list())
    }

    /// A direction, from an `IfcDirection`.
    pub fn direction(&self, id: u32) -> Option<V3> {
        let e = self.get(id)?;
        normalize(point3(e.get(0).list())?)
    }

    /// An `IfcAxis2Placement3D` or `IfcAxis2Placement2D`.
    pub fn axis_placement(&self, id: u32) -> Transform {
        let Some(e) = self.get(id) else {
            return Transform::IDENTITY;
        };
        let origin = e
            .reference(0)
            .and_then(|p| self.point(p))
            .unwrap_or([0.0; 3]);
        match e.ty {
            "IFCAXIS2PLACEMENT3D" => Transform::frame(
                origin,
                e.reference(1).and_then(|d| self.direction(d)),
                e.reference(2).and_then(|d| self.direction(d)),
            ),
            "IFCAXIS2PLACEMENT2D" => {
                Transform::frame(origin, None, e.reference(1).and_then(|d| self.direction(d)))
            }
            _ => Transform {
                origin,
                ..Transform::IDENTITY
            },
        }
    }

    /// The world placement of a product (file units).
    pub fn placement(&self, product: u32) -> Transform {
        let Some(e) = self.get(product) else {
            return Transform::IDENTITY;
        };
        e.reference(5)
            .map_or(Transform::IDENTITY, |p| self.local_placement(p, 0))
    }

    fn local_placement(&self, id: u32, depth: usize) -> Transform {
        let Some(e) = self.get(id) else {
            return Transform::IDENTITY;
        };
        if e.ty != "IFCLOCALPLACEMENT" || depth > MAX_DEPTH {
            return Transform::IDENTITY;
        }
        let local = e
            .reference(1)
            .map_or(Transform::IDENTITY, |p| self.axis_placement(p));
        match e.reference(0) {
            Some(parent) => self.local_placement(parent, depth + 1).then(&local),
            None => local,
        }
    }

    /// A property of an object or of its type: the first `name` found in any of its property sets
    /// (case-insensitive).
    pub fn property(&self, object: u32, name: &str) -> Option<Value> {
        let mut sets: Vec<u32> = self.properties.get(&object).cloned().unwrap_or_default();
        if let Some(ty) = self.types.get(&object).and_then(|&t| self.get(t)) {
            sets.extend(ty.get(5).references());
        }
        for set in sets {
            let Some(set) = self.get(set) else { continue };
            for property in set.get(4).references() {
                let Some(p) = self.get(property) else {
                    continue;
                };
                if p.ty == "IFCPROPERTYSINGLEVALUE"
                    && p.text(0).is_some_and(|n| n.eq_ignore_ascii_case(name))
                {
                    return Some(p.get(2).clone());
                }
            }
        }
        None
    }

    /// Total thickness of the material layers of an element or its type (file units).
    pub fn layer_thickness(&self, element: u32) -> Option<f64> {
        let mut candidates = vec![element];
        if let Some(&ty) = self.types.get(&element) {
            candidates.push(ty);
        }
        for c in candidates {
            let Some(mut material) = self.materials.get(&c).and_then(|&m| self.get(m)) else {
                continue;
            };
            for _ in 0..3 {
                match material.ty {
                    "IFCMATERIALLAYERSETUSAGE" => {
                        let Some(next) = material.reference(0).and_then(|m| self.get(m)) else {
                            break;
                        };
                        material = next;
                    }
                    "IFCMATERIALLAYERSET" => {
                        let total: f64 = material
                            .get(0)
                            .references()
                            .into_iter()
                            .filter_map(|l| self.get(l)?.number(1))
                            .sum();
                        if total > 0.0 {
                            return Some(total);
                        }
                        break;
                    }
                    _ => break,
                }
            }
        }
        None
    }

    /// The shape representations of a product, `Body` first.
    fn representations(&self, product: u32) -> Vec<(String, Vec<u32>)> {
        let Some(shape) = self
            .get(product)
            .and_then(|p| p.reference(6))
            .and_then(|s| self.get(s))
        else {
            return Vec::new();
        };
        let mut out: Vec<(String, Vec<u32>)> = shape
            .get(2)
            .references()
            .into_iter()
            .filter_map(|r| {
                let r = self.get(r)?;
                let identifier = r.text(1).unwrap_or_default().to_owned();
                Some((identifier, r.get(3).references()))
            })
            .collect();
        out.sort_by_key(|(identifier, _)| match identifier.as_str() {
            "Body" => 0,
            "Facetation" => 1,
            "Box" => 2,
            _ => 3,
        });
        out
    }

    /// The points of the product's solid geometry, in its own placement frame (file units).
    pub fn local_points(&self, product: u32) -> Vec<V3> {
        self.steps.set(MAX_STEPS);
        let mut out = Vec::new();
        for (identifier, items) in self.representations(product) {
            if matches!(
                identifier.as_str(),
                "Axis" | "FootPrint" | "Annotation" | "Clearance"
            ) {
                continue;
            }
            for item in items {
                self.item_points(item, &Transform::IDENTITY, 0, &mut out);
            }
            if !out.is_empty() {
                break;
            }
        }
        out
    }

    fn push(out: &mut Vec<V3>, t: &Transform, p: V3) {
        if out.len() < MAX_POINTS && p.iter().all(|v| v.is_finite()) {
            out.push(t.point(p));
        }
    }

    /// Gathers the points of a representation item, transformed by `t`.
    fn item_points(&self, id: u32, t: &Transform, depth: usize, out: &mut Vec<V3>) {
        if depth > MAX_DEPTH || out.len() >= MAX_POINTS || !self.step() {
            return;
        }
        let Some(e) = self.get(id) else { return };
        match e.ty {
            "IFCEXTRUDEDAREASOLID" | "IFCEXTRUDEDAREASOLIDTAPERED" => {
                let position = e
                    .reference(1)
                    .map_or(Transform::IDENTITY, |p| self.axis_placement(p));
                let t = t.then(&position);
                let direction = e
                    .reference(2)
                    .and_then(|d| self.direction(d))
                    .unwrap_or([0.0, 0.0, 1.0]);
                let depth_len = e.number(3).unwrap_or(0.0);
                let top = [
                    direction[0] * depth_len,
                    direction[1] * depth_len,
                    direction[2] * depth_len,
                ];
                for p in self.profile(e.reference(0), depth) {
                    Self::push(out, &t, [p[0], p[1], 0.0]);
                    Self::push(out, &t, [p[0] + top[0], p[1] + top[1], top[2]]);
                }
            }
            "IFCREVOLVEDAREASOLID"
            | "IFCSURFACECURVESWEPTAREASOLID"
            | "IFCFIXEDREFERENCESWEPTAREASOLID" => {
                let position = e
                    .reference(1)
                    .map_or(Transform::IDENTITY, |p| self.axis_placement(p));
                let t = t.then(&position);
                for p in self.profile(e.reference(0), depth) {
                    Self::push(out, &t, [p[0], p[1], 0.0]);
                }
            }
            "IFCBOOLEANRESULT" | "IFCBOOLEANCLIPPINGRESULT" => {
                if let Some(first) = e.reference(1) {
                    self.item_points(first, t, depth + 1, out);
                }
            }
            "IFCCSGSOLID" => {
                if let Some(root) = e.reference(0) {
                    self.item_points(root, t, depth + 1, out);
                }
            }
            "IFCBLOCK" => {
                let position = e
                    .reference(0)
                    .map_or(Transform::IDENTITY, |p| self.axis_placement(p));
                let t = t.then(&position);
                let (x, y, z) = (
                    e.number(1).unwrap_or(0.0),
                    e.number(2).unwrap_or(0.0),
                    e.number(3).unwrap_or(0.0),
                );
                for corner in box_corners([0.0; 3], [x, y, z]) {
                    Self::push(out, &t, corner);
                }
            }
            "IFCBOUNDINGBOX" => {
                let corner = e
                    .reference(0)
                    .and_then(|p| self.point(p))
                    .unwrap_or([0.0; 3]);
                let size = [
                    e.number(1).unwrap_or(0.0),
                    e.number(2).unwrap_or(0.0),
                    e.number(3).unwrap_or(0.0),
                ];
                let far = [
                    corner[0] + size[0],
                    corner[1] + size[1],
                    corner[2] + size[2],
                ];
                for p in box_corners(corner, far) {
                    Self::push(out, t, p);
                }
            }
            "IFCFACETEDBREP" | "IFCFACETEDBREPWITHVOIDS" | "IFCADVANCEDBREP" => {
                if let Some(shell) = e.reference(0) {
                    self.item_points(shell, t, depth + 1, out);
                }
            }
            "IFCCLOSEDSHELL" | "IFCOPENSHELL" | "IFCCONNECTEDFACESET" => {
                for face in e.get(0).references() {
                    for p in self.face_loop(face) {
                        Self::push(out, t, p);
                    }
                }
            }
            "IFCSHELLBASEDSURFACEMODEL"
            | "IFCFACEBASEDSURFACEMODEL"
            | "IFCGEOMETRICSET"
            | "IFCGEOMETRICCURVESET" => {
                for item in e.get(0).references() {
                    self.item_points(item, t, depth + 1, out);
                }
            }
            "IFCTRIANGULATEDFACESET" | "IFCPOLYGONALFACESET" => {
                if let Some(list) = e.reference(0).and_then(|l| self.get(l)) {
                    for p in list.get(0).list() {
                        if let Some(p) = point3(p.list()) {
                            Self::push(out, t, p);
                        }
                    }
                }
            }
            "IFCMAPPEDITEM" => {
                let Some(map) = e.reference(0).and_then(|m| self.get(m)) else {
                    return;
                };
                let origin = map
                    .reference(0)
                    .map_or(Transform::IDENTITY, |p| self.axis_placement(p));
                let target = e
                    .reference(1)
                    .map_or(Transform::IDENTITY, |o| self.operator(o));
                let t = t.then(&target).then(&origin);
                let Some(representation) = map.reference(1).and_then(|r| self.get(r)) else {
                    return;
                };
                for item in representation.get(3).references() {
                    self.item_points(item, &t, depth + 1, out);
                }
            }
            "IFCSWEPTDISKSOLID" | "IFCSWEPTDISKSOLIDPOLYGONAL" => {
                if let Some(curve) = e.reference(0) {
                    self.item_points(curve, t, depth + 1, out);
                }
            }
            _ => {
                for p in self.curve(id, depth) {
                    Self::push(out, t, p);
                }
            }
        }
    }

    /// The outer loop of an `IfcFace`.
    fn face_loop(&self, face: u32) -> Vec<V3> {
        if !self.step() {
            return Vec::new();
        }
        let Some(face) = self.get(face) else {
            return Vec::new();
        };
        let bounds = face.get(0).references();
        let outer = bounds
            .iter()
            .copied()
            .find(|&b| self.step.type_of(b) == Some("IFCFACEOUTERBOUND"))
            .or_else(|| bounds.first().copied());
        let Some(bound) = outer.and_then(|b| self.get(b)) else {
            return Vec::new();
        };
        let Some(lp) = bound.reference(0).and_then(|l| self.get(l)) else {
            return Vec::new();
        };
        if lp.ty != "IFCPOLYLOOP" {
            return Vec::new();
        }
        lp.get(0)
            .references()
            .into_iter()
            .filter_map(|p| self.point(p))
            .collect()
    }

    /// The faces of a brep, each as its outer loop (for floor outlines).
    pub fn brep_faces(&self, item: u32, depth: usize) -> Vec<Vec<V3>> {
        if depth > MAX_DEPTH || !self.step() {
            return Vec::new();
        }
        let Some(e) = self.get(item) else {
            return Vec::new();
        };
        match e.ty {
            "IFCFACETEDBREP" | "IFCFACETEDBREPWITHVOIDS" => e
                .reference(0)
                .map_or_else(Vec::new, |s| self.brep_faces(s, depth + 1)),
            "IFCCLOSEDSHELL" | "IFCOPENSHELL" | "IFCCONNECTEDFACESET" => e
                .get(0)
                .references()
                .into_iter()
                .map(|f| self.face_loop(f))
                .filter(|l| l.len() >= 3)
                .collect(),
            "IFCSHELLBASEDSURFACEMODEL" | "IFCFACEBASEDSURFACEMODEL" => e
                .get(0)
                .references()
                .into_iter()
                .flat_map(|s| self.brep_faces(s, depth + 1))
                .collect(),
            _ => Vec::new(),
        }
    }

    /// An `IfcCartesianTransformationOperator3D` (mapped items).
    fn operator(&self, id: u32) -> Transform {
        let Some(e) = self.get(id) else {
            return Transform::IDENTITY;
        };
        let x = e.reference(0).and_then(|d| self.direction(d));
        let origin = e
            .reference(2)
            .and_then(|p| self.point(p))
            .unwrap_or([0.0; 3]);
        let z = e.reference(4).and_then(|d| self.direction(d));
        let s = e.number(3).filter(|s| *s > 0.0).unwrap_or(1.0);
        let (sy, sz) = if e.ty.ends_with("NONUNIFORM") {
            (
                e.number(5).filter(|v| *v > 0.0).unwrap_or(s),
                e.number(6).filter(|v| *v > 0.0).unwrap_or(s),
            )
        } else {
            (s, s)
        };
        let frame = Transform::frame(origin, z, x);
        let y = mirrored(frame.y, e.reference(1).and_then(|d| self.direction(d)));
        Transform {
            x: crate::math::scale(frame.x, s),
            y: crate::math::scale(y, sy),
            z: crate::math::scale(frame.z, sz),
            origin,
        }
    }

    /// The outer outline of a profile, in its own 2D frame placed by its position.
    pub fn profile(&self, id: Option<u32>, depth: usize) -> Vec<P2> {
        if depth > MAX_DEPTH || !self.step() {
            return Vec::new();
        }
        let Some(e) = id.and_then(|i| self.get(i)) else {
            return Vec::new();
        };
        let placed = |points: Vec<P2>, position: Option<u32>| -> Vec<P2> {
            let t = position.map_or(Transform::IDENTITY, |p| self.axis_placement(p));
            points
                .into_iter()
                .map(|p| {
                    let q = t.point([p[0], p[1], 0.0]);
                    [q[0], q[1]]
                })
                .collect()
        };
        match e.ty {
            "IFCRECTANGLEPROFILEDEF"
            | "IFCROUNDEDRECTANGLEPROFILEDEF"
            | "IFCRECTANGLEHOLLOWPROFILEDEF" => {
                let (x, y) = (
                    e.number(3).unwrap_or(0.0) / 2.0,
                    e.number(4).unwrap_or(0.0) / 2.0,
                );
                placed(vec![[-x, -y], [x, -y], [x, y], [-x, y]], e.reference(2))
            }
            "IFCCIRCLEPROFILEDEF" | "IFCCIRCLEHOLLOWPROFILEDEF" => {
                let r = e.number(3).unwrap_or(0.0);
                placed(ellipse(r, r), e.reference(2))
            }
            "IFCELLIPSEPROFILEDEF" => placed(
                ellipse(e.number(3).unwrap_or(0.0), e.number(4).unwrap_or(0.0)),
                e.reference(2),
            ),
            // OverallWidth (x), then OverallDepth (y).
            "IFCISHAPEPROFILEDEF" => {
                let (x, y) = (
                    e.number(3).unwrap_or(0.0) / 2.0,
                    e.number(4).unwrap_or(0.0) / 2.0,
                );
                placed(vec![[-x, -y], [x, -y], [x, y], [-x, y]], e.reference(2))
            }
            // Depth (y), then the width of the flange or leg (x).
            "IFCUSHAPEPROFILEDEF"
            | "IFCCSHAPEPROFILEDEF"
            | "IFCZSHAPEPROFILEDEF"
            | "IFCTSHAPEPROFILEDEF"
            | "IFCLSHAPEPROFILEDEF" => {
                let (y, x) = (
                    e.number(3).unwrap_or(0.0) / 2.0,
                    e.number(4).unwrap_or(0.0) / 2.0,
                );
                placed(vec![[-x, -y], [x, -y], [x, y], [-x, y]], e.reference(2))
            }
            "IFCARBITRARYCLOSEDPROFILEDEF"
            | "IFCARBITRARYPROFILEDEFWITHVOIDS"
            | "IFCARBITRARYOPENPROFILEDEF" => e.reference(2).map_or_else(Vec::new, |c| {
                self.curve(c, depth + 1)
                    .into_iter()
                    .map(|p| [p[0], p[1]])
                    .collect()
            }),
            "IFCDERIVEDPROFILEDEF" => {
                let inner = self.profile(e.reference(2), depth + 1);
                let t = e
                    .reference(3)
                    .map_or(Transform::IDENTITY, |o| self.operator2d(o));
                inner
                    .into_iter()
                    .map(|p| {
                        let q = t.point([p[0], p[1], 0.0]);
                        [q[0], q[1]]
                    })
                    .collect()
            }
            "IFCCOMPOSITEPROFILEDEF" => {
                let points: Vec<P2> = e
                    .get(2)
                    .references()
                    .into_iter()
                    .flat_map(|p| self.profile(Some(p), depth + 1))
                    .collect();
                convex_hull(&points)
            }
            _ => Vec::new(),
        }
    }

    fn operator2d(&self, id: u32) -> Transform {
        let Some(e) = self.get(id) else {
            return Transform::IDENTITY;
        };
        let x = e.reference(0).and_then(|d| self.direction(d));
        let origin = e
            .reference(2)
            .and_then(|p| self.point(p))
            .unwrap_or([0.0; 3]);
        let s = e.number(3).filter(|s| *s > 0.0).unwrap_or(1.0);
        let frame = Transform::frame(origin, None, x);
        let y = mirrored(frame.y, e.reference(1).and_then(|d| self.direction(d)));
        Transform {
            x: crate::math::scale(frame.x, s),
            y: crate::math::scale(y, s),
            z: frame.z,
            origin,
        }
    }

    /// The points of a curve, in order (arcs are reduced to their end points).
    pub fn curve(&self, id: u32, depth: usize) -> Vec<V3> {
        if depth > MAX_DEPTH || !self.step() {
            return Vec::new();
        }
        let Some(e) = self.get(id) else {
            return Vec::new();
        };
        match e.ty {
            "IFCPOLYLINE" => e
                .get(0)
                .references()
                .into_iter()
                .filter_map(|p| self.point(p))
                .collect(),
            "IFCINDEXEDPOLYCURVE" => {
                let coords: Vec<V3> = e
                    .reference(0)
                    .and_then(|l| self.get(l))
                    .map(|l| {
                        l.get(0)
                            .list()
                            .iter()
                            .filter_map(|p| point3(p.list()))
                            .collect()
                    })
                    .unwrap_or_default();
                let segments = e.get(1).list();
                if segments.is_empty() {
                    return coords;
                }
                let mut out: Vec<V3> = Vec::new();
                for segment in segments {
                    let Value::Typed(_, inner) = segment else {
                        continue;
                    };
                    for index in inner.list() {
                        let Some(i) = index.number() else { continue };
                        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                        let i = i as usize;
                        if let Some(p) = i.checked_sub(1).and_then(|i| coords.get(i))
                            && out.last() != Some(p)
                        {
                            out.push(*p);
                        }
                    }
                }
                out
            }
            "IFCCOMPOSITECURVE" | "IFCCOMPOSITECURVEONSURFACE" => {
                let mut out: Vec<V3> = Vec::new();
                for segment in e.get(0).references() {
                    let Some(s) = self.get(segment) else { continue };
                    let Some(parent) = s.reference(2) else {
                        continue;
                    };
                    let mut points = self.curve(parent, depth + 1);
                    if s.get(1).enumeration() == Some("F") {
                        points.reverse();
                    }
                    for p in points {
                        if out.last() != Some(&p) {
                            out.push(p);
                        }
                    }
                }
                out
            }
            "IFCTRIMMEDCURVE" => {
                let trim = |v: &Value| -> Option<V3> {
                    v.list()
                        .iter()
                        .find_map(|t| t.reference().and_then(|p| self.point(p)))
                };
                // Always from Trim1 to Trim2: the sense only says which way around the basis
                // curve, which end points alone cannot show.
                match (trim(e.get(1)), trim(e.get(2))) {
                    (Some(a), Some(b)) => vec![a, b],
                    _ => Vec::new(),
                }
            }
            "IFCCARTESIANPOINT" => self.point(id).into_iter().collect(),
            _ => Vec::new(),
        }
    }

    /// The outline of a space on its floor, in its own frame (file units), counter-clockwise:
    /// its `FootPrint` curve, else the profile of its extruded body, else the lowest face of its
    /// brep, else the hull of its points.
    pub fn footprint(&self, space: u32) -> Vec<P2> {
        self.steps.set(MAX_STEPS);
        let representations = self.representations(space);
        for (identifier, items) in &representations {
            if identifier == "FootPrint" {
                for &item in items {
                    let points: Vec<P2> = self
                        .curve_item(item)
                        .into_iter()
                        .map(|p| [p[0], p[1]])
                        .collect();
                    if points.len() >= 3 {
                        return ccw(points);
                    }
                }
            }
        }
        for (identifier, items) in &representations {
            if identifier != "Body" && !identifier.is_empty() {
                continue;
            }
            for &item in items {
                if let Some(outline) = self.extrusion_outline(item, &Transform::IDENTITY, 0) {
                    return ccw(outline);
                }
                if let Some(outline) = self.lowest_face(item) {
                    return ccw(outline);
                }
            }
        }
        let points: Vec<P2> = self
            .local_points(space)
            .into_iter()
            .map(|p| [p[0], p[1]])
            .collect();
        ccw(convex_hull(&points))
    }

    fn curve_item(&self, item: u32) -> Vec<V3> {
        match self.step.type_of(item) {
            Some("IFCGEOMETRICCURVESET" | "IFCGEOMETRICSET") => self
                .get(item)
                .map(|e| e.get(0).references())
                .unwrap_or_default()
                .into_iter()
                .map(|c| self.curve(c, 1))
                .max_by_key(Vec::len)
                .unwrap_or_default(),
            _ => self.curve(item, 0),
        }
    }

    /// The outline of a vertical extrusion seen from above.
    fn extrusion_outline(&self, item: u32, t: &Transform, depth: usize) -> Option<Vec<P2>> {
        if depth > MAX_DEPTH || !self.step() {
            return None;
        }
        let e = self.get(item)?;
        match e.ty {
            "IFCEXTRUDEDAREASOLID" | "IFCEXTRUDEDAREASOLIDTAPERED" => {
                let position = e
                    .reference(1)
                    .map_or(Transform::IDENTITY, |p| self.axis_placement(p));
                let t = t.then(&position);
                if t.z[2].abs() < 0.99 {
                    return None;
                }
                let outline: Vec<P2> = self
                    .profile(e.reference(0), depth)
                    .into_iter()
                    .map(|p| {
                        let q = t.point([p[0], p[1], 0.0]);
                        [q[0], q[1]]
                    })
                    .collect();
                (outline.len() >= 3).then_some(outline)
            }
            "IFCBOOLEANRESULT" | "IFCBOOLEANCLIPPINGRESULT" => {
                self.extrusion_outline(e.reference(1)?, t, depth + 1)
            }
            "IFCMAPPEDITEM" => {
                let map = self.get(e.reference(0)?)?;
                let origin = map
                    .reference(0)
                    .map_or(Transform::IDENTITY, |p| self.axis_placement(p));
                let target = e
                    .reference(1)
                    .map_or(Transform::IDENTITY, |o| self.operator(o));
                let t = t.then(&target).then(&origin);
                let representation = self.get(map.reference(1)?)?;
                representation
                    .get(3)
                    .references()
                    .into_iter()
                    .find_map(|i| self.extrusion_outline(i, &t, depth + 1))
            }
            _ => None,
        }
    }

    /// The largest horizontal face at the bottom of a brep.
    fn lowest_face(&self, item: u32) -> Option<Vec<P2>> {
        let faces = self.brep_faces(item, 0);
        let min_z = faces
            .iter()
            .flatten()
            .map(|p| p[2])
            .fold(f64::INFINITY, f64::min);
        faces
            .into_iter()
            .filter(|face| face.iter().all(|p| (p[2] - min_z).abs() < 0.5 / self.cm))
            .map(|face| face.into_iter().map(|p| [p[0], p[1]]).collect::<Vec<P2>>())
            .max_by(|a, b| signed_area2(a).abs().total_cmp(&signed_area2(b).abs()))
            .filter(|face| face.len() >= 3)
    }
}

/// Metres per SI unit with its prefix (`MILLI` `METRE` is 0.001).
fn si_factor(prefix: Option<&str>, name: Option<&str>) -> Option<f64> {
    let base = match name? {
        "METRE" | "RADIAN" | "SQUARE_METRE" | "CUBIC_METRE" => 1.0,
        _ => return None,
    };
    let scale = match prefix {
        None => 1.0,
        Some("EXA") => 1e18,
        Some("PETA") => 1e15,
        Some("TERA") => 1e12,
        Some("GIGA") => 1e9,
        Some("MEGA") => 1e6,
        Some("KILO") => 1e3,
        Some("HECTO") => 1e2,
        Some("DECA") => 1e1,
        Some("DECI") => 1e-1,
        Some("CENTI") => 1e-2,
        Some("MILLI") => 1e-3,
        Some("MICRO") => 1e-6,
        Some("NANO") => 1e-9,
        Some(_) => 1.0,
    };
    Some(base * scale)
}

/// The second axis of a transformation operator: the right-handed `y`, or its opposite when the
/// file's `Axis2` points the other way (a mirrored instance).
fn mirrored(y: V3, axis2: Option<V3>) -> V3 {
    match axis2 {
        Some(a) if crate::math::dot(a, y) < 0.0 => crate::math::scale(y, -1.0),
        _ => y,
    }
}

fn box_corners(a: V3, b: V3) -> [V3; 8] {
    [
        [a[0], a[1], a[2]],
        [b[0], a[1], a[2]],
        [a[0], b[1], a[2]],
        [b[0], b[1], a[2]],
        [a[0], a[1], b[2]],
        [b[0], a[1], b[2]],
        [a[0], b[1], b[2]],
        [b[0], b[1], b[2]],
    ]
}

fn ellipse(a: f64, b: f64) -> Vec<P2> {
    (0..16)
        .map(|i| {
            let t = f64::from(i) / 16.0 * std::f64::consts::TAU;
            [a * t.cos(), b * t.sin()]
        })
        .collect()
}

/// The polygon counter-clockwise (y up), without a repeated last point.
fn ccw(mut points: Vec<P2>) -> Vec<P2> {
    if points.len() > 1 && points.first() == points.last() {
        points.pop();
    }
    if signed_area2(&points) < 0.0 {
        points.reverse();
    }
    points
}
