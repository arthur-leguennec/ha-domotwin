//! Files a careless or hostile exporter could write: the import keeps its promises (no hang, no
//! crash, a plan the core accepts) and reads the tricky parts of IFC right.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::time::{Duration, Instant};

use domotwin_core::read_plan;
use domotwin_ifc::{IfcFile, Report};
use serde_json::Value;

/// A small IFC4 file in metres: one storey, spaces and elements added by the test.
struct Step {
    lines: Vec<String>,
    spaces: Vec<String>,
    elements: Vec<String>,
}

impl Step {
    fn new() -> Self {
        let mut step = Step {
            lines: Vec::new(),
            spaces: Vec::new(),
            elements: Vec::new(),
        };
        step.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"); // #1
        step.add("IFCUNITASSIGNMENT((#1))"); // #2
        step.add("IFCPROJECT('project',$,'Project',$,$,$,$,$,#2)"); // #3
        step.add("IFCCARTESIANPOINT((0.,0.,0.))"); // #4
        step.add("IFCAXIS2PLACEMENT3D(#4,$,$)"); // #5
        step.add("IFCLOCALPLACEMENT($,#5)"); // #6
        step.add("IFCBUILDINGSTOREY('storey',$,'Level',$,$,#6,$,$,.ELEMENT.,0.)"); // #7
        step
    }

    fn add(&mut self, entity: &str) -> String {
        self.lines.push(entity.to_owned());
        format!("#{}", self.lines.len())
    }

    fn place(&mut self, x: f64, y: f64) -> String {
        let point = self.add(&format!("IFCCARTESIANPOINT(({x:?},{y:?},0.))"));
        let axis = self.add(&format!("IFCAXIS2PLACEMENT3D({point},$,$)"));
        self.add(&format!("IFCLOCALPLACEMENT(#6,{axis})"))
    }

    fn polyline(&mut self, points: &[(f64, f64)]) -> String {
        let mut refs: Vec<String> = points
            .iter()
            .map(|(x, y)| self.add(&format!("IFCCARTESIANPOINT(({x:?},{y:?}))")))
            .collect();
        refs.push(refs[0].clone());
        self.add(&format!("IFCPOLYLINE(({}))", refs.join(",")))
    }

    fn shape(&mut self, item: &str) -> String {
        let rep = self.add(&format!(
            "IFCSHAPEREPRESENTATION($,'Body','SweptSolid',({item}))"
        ));
        self.add(&format!("IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))"))
    }

    fn extrude(&mut self, profile: &str, height: f64) -> String {
        let dir = self.add("IFCDIRECTION((0.,0.,1.))");
        self.add(&format!(
            "IFCEXTRUDEDAREASOLID({profile},$,{dir},{height:?})"
        ))
    }

    /// A rectangular space from (x0, y0) to (x1, y1).
    fn space(&mut self, name: &str, x0: f64, y0: f64, x1: f64, y1: f64, kind: &str) -> String {
        let outline = self.polyline(&[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]);
        let profile = self.add(&format!("IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{outline})"));
        let solid = self.extrude(&profile, 2.5);
        self.space_with(name, &solid, kind)
    }

    fn space_with(&mut self, name: &str, item: &str, kind: &str) -> String {
        let shape = self.shape(item);
        let id = format!("space-{}", self.spaces.len());
        let space = self.add(&format!(
            "IFCSPACE('{id}',$,'{name}',$,$,#6,{shape},'{name}',.ELEMENT.,.{kind}.,$)"
        ));
        self.spaces.push(space.clone());
        space
    }

    /// A piece whose body is `item`, placed at (x, y).
    fn piece(
        &mut self,
        class: &str,
        name: &str,
        x: f64,
        y: f64,
        item: &str,
        predefined: &str,
    ) -> String {
        let place = self.place(x, y);
        let shape = self.shape(item);
        let id = format!("piece-{}", self.elements.len());
        let piece = self.add(&format!(
            "{class}('{id}',$,'{name}',$,$,{place},{shape},$,{predefined})"
        ));
        self.elements.push(piece.clone());
        piece
    }

    /// A box body from (0, 0, 0) to (x, y, z) in the piece's frame.
    fn block(&mut self, x: f64, y: f64, z: f64) -> String {
        let origin = self.add("IFCCARTESIANPOINT((0.,0.,0.))");
        let axis = self.add(&format!("IFCAXIS2PLACEMENT3D({origin},$,$)"));
        self.add(&format!("IFCBLOCK({axis},{x:?},{y:?},{z:?})"))
    }

    fn bytes(&self) -> Vec<u8> {
        let mut lines = self.lines.clone();
        if !self.spaces.is_empty() {
            lines.push(format!(
                "IFCRELAGGREGATES('agg',$,$,$,#7,({}))",
                self.spaces.join(",")
            ));
        }
        if !self.elements.is_empty() {
            lines.push(format!(
                "IFCRELCONTAINEDINSPATIALSTRUCTURE('in',$,$,$,({}),#7)",
                self.elements.join(",")
            ));
        }
        let body: Vec<String> = lines
            .iter()
            .enumerate()
            .map(|(i, l)| format!("#{}={l};", i + 1))
            .collect();
        format!(
            "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",
            body.join("\n")
        )
        .into_bytes()
    }
}

/// Converts the storey, has the core read the plan, and returns both.
fn convert(bytes: Vec<u8>) -> (Value, Report) {
    let file = IfcFile::read(bytes).unwrap();
    let storey = file.storeys()[0].id;
    let (plan, report) = file.convert(storey).unwrap();
    let text = serde_json::to_vec(&plan).unwrap();
    if let Err(e) = read_plan(&text) {
        panic!("the core refuses the plan: {e:?}\n{plan:#}");
    }
    (plan, report)
}

/// The elements of a list of the plan (`rooms`, `items`…).
fn elements<'a>(plan: &'a Value, list: &str) -> Vec<&'a Value> {
    plan[list].as_array().into_iter().flatten().collect()
}

#[test]
fn self_references_end_quickly() {
    let mut step = Step::new();
    step.space("Living", 0.0, 0.0, 5.0, 4.0, "INTERNAL");
    // A geometric set holding itself twice, and a derived profile deriving from itself.
    let n = step.lines.len() + 1;
    step.add(&format!("IFCGEOMETRICSET((#{n},#{n}))"));
    let looped = format!("#{n}");
    step.piece("IFCFURNITURE", "Chair", 1.0, 1.0, &looped, ".CHAIR.");
    let p = step.lines.len() + 1;
    step.add(&format!("IFCDERIVEDPROFILEDEF(.AREA.,$,#{p},$,$)"));
    let solid = step.extrude(&format!("#{p}"), 2.5);
    step.space_with("Loop", &solid, "INTERNAL");
    let start = Instant::now();
    let (plan, report) = convert(step.bytes());
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    assert_eq!(elements(&plan, "rooms").len(), 1);
    assert_eq!(report.skipped_furniture, 1);
    assert_eq!(report.skipped_spaces, 1);
}

#[test]
fn byte_order_mark() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend(Step::new().bytes());
    assert!(IfcFile::read(bytes).is_ok());
}

#[test]
fn hairline_gaps_are_closed_but_are_not_walls() {
    let mut step = Step::new();
    step.space("A", 0.0, 0.0, 4.0, 3.0, "INTERNAL");
    step.space("B", 4.1, 0.0, 8.0, 3.0, "INTERNAL");
    // 6 mm between C and D.
    step.space("C", 0.0, 3.1, 4.0, 6.0, "INTERNAL");
    step.space("D", 4.006, 3.1, 8.0, 6.0, "INTERNAL");
    let (plan, _) = convert(step.bytes());
    assert_eq!(plan["wallThickness"]["interior"], 10.0);
    for room in elements(&plan, "rooms") {
        for side in room["sides"].as_array().into_iter().flatten() {
            let t = &side["thickness"];
            assert!(t.is_null() || t.as_f64().unwrap() >= 1.0, "{room}");
        }
    }
}

#[test]
fn stray_pieces_and_overall_spaces_are_left_out() {
    let mut step = Step::new();
    step.space("Studio", 0.0, 0.0, 5.0, 4.0, "INTERNAL");
    // A gross floor area by type, and one holding a single room.
    step.space("Area", -0.3, -0.3, 5.3, 4.3, "GFA");
    step.space("Outline", -0.3, -0.3, 5.3, 4.3, "INTERNAL");
    let table = step.block(1.0, 0.6, 0.75);
    step.piece("IFCFURNITURE", "Table", 1.0, 1.0, &table, ".TABLE.");
    // At the project origin of a building 2 km away.
    let lost = step.block(0.5, 0.5, 0.5);
    step.piece("IFCFURNITURE", "Chair", -2000.0, 0.0, &lost, ".CHAIR.");
    let (plan, report) = convert(step.bytes());
    assert_eq!(elements(&plan, "rooms").len(), 1);
    assert_eq!(report.skipped_spaces, 2);
    assert_eq!(elements(&plan, "items").len(), 1);
    assert_eq!(report.skipped_furniture, 1);
}

#[test]
fn names_types_mirrors_and_profiles() {
    let mut step = Step::new();
    step.space("Chambre 1 : parents", 0.0, 0.0, 6.0, 5.0, "INTERNAL");
    // IfcFurnitureType: AssemblyPlace before PredefinedType.
    let bed_box = step.block(1.6, 2.0, 0.5);
    let bed = step.piece("IFCFURNITURE", "Object 12", 1.0, 1.0, &bed_box, "$");
    let ty = step.add("IFCFURNITURETYPE('bedtype',$,'Type 3',$,$,$,$,$,$,.FACTORY.,.BED.)");
    step.add(&format!("IFCRELDEFINESBYTYPE('t',$,$,$,({bed}),{ty})"));
    let shelf_box = step.block(0.8, 0.3, 1.2);
    step.piece(
        "IFCFURNITURE",
        "M_Shelf:Shelf 800:123456",
        4.0,
        1.0,
        &shelf_box,
        ".SHELF.",
    );
    // The same mapped box, plain and mirrored by Axis2.
    let map_box = step.block(1.0, 0.6, 0.4);
    let rep = step.add(&format!(
        "IFCSHAPEREPRESENTATION($,'Body','SweptSolid',({map_box}))"
    ));
    let origin = step.add("IFCCARTESIANPOINT((0.,0.,0.))");
    let axis = step.add(&format!("IFCAXIS2PLACEMENT3D({origin},$,$)"));
    let map = step.add(&format!("IFCREPRESENTATIONMAP({axis},{rep})"));
    let plain_op = step.add(&format!(
        "IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,{origin},1.,$)"
    ));
    let minus_y = step.add("IFCDIRECTION((0.,-1.,0.))");
    let mirror_op = step.add(&format!(
        "IFCCARTESIANTRANSFORMATIONOPERATOR3D($,{minus_y},{origin},1.,$)"
    ));
    let plain = step.add(&format!("IFCMAPPEDITEM({map},{plain_op})"));
    let mirrored = step.add(&format!("IFCMAPPEDITEM({map},{mirror_op})"));
    step.piece("IFCFURNITURE", "Bench", 2.0, 3.0, &plain, ".NOTDEFINED.");
    step.piece("IFCFURNITURE", "Bench", 4.0, 3.0, &mirrored, ".NOTDEFINED.");
    // A U profile: depth 20 cm along y, flange 5 cm along x.
    let position = step.add("IFCAXIS2PLACEMENT2D(#4,$)");
    let u = step.add(&format!(
        "IFCUSHAPEPROFILEDEF(.AREA.,$,{position},0.2,0.05,0.01,0.01,$,$,$)"
    ));
    let rail = step.extrude(&u, 1.0);
    step.piece("IFCFURNITURE", "Rail", 5.0, 4.0, &rail, ".NOTDEFINED.");

    let (plan, _) = convert(step.bytes());
    assert_eq!(elements(&plan, "rooms")[0]["name"], "Chambre 1 : parents");
    let pieces = elements(&plan, "items");
    let named = |name: &str| {
        pieces
            .iter()
            .filter(|p| p["name"] == name)
            .collect::<Vec<_>>()
    };
    assert_eq!(named("Object 12")[0]["kind"], "bed");
    assert_eq!(named("M_Shelf").len(), 1);
    // Plan y points down: the mirrored bench lies 60 cm further down.
    let benches = named("Bench");
    let centre_y = |p: &Value| p["at"][1].as_f64().unwrap();
    assert!(((centre_y(benches[1]) - centre_y(benches[0])) - 60.0).abs() < 0.5);
    let rail = named("Rail")[0];
    assert!(
        (rail["size"][0].as_f64().unwrap() - 5.0).abs() < 0.2,
        "{rail}"
    );
    assert!(
        (rail["size"][1].as_f64().unwrap() - 20.0).abs() < 0.2,
        "{rail}"
    );
}

#[test]
fn trimmed_curves_run_from_trim1_to_trim2() {
    let mut step = Step::new();
    // A footprint whose last side is an arc segment written clockwise (`.F.`).
    let a = step.add("IFCCARTESIANPOINT((0.,0.))");
    let b = step.add("IFCCARTESIANPOINT((4.,0.))");
    let c = step.add("IFCCARTESIANPOINT((4.,3.))");
    let d = step.add("IFCCARTESIANPOINT((0.,3.))");
    let line = step.add(&format!("IFCPOLYLINE(({a},{b},{c},{d}))"));
    let centre = step.add("IFCCARTESIANPOINT((0.,1.5))");
    let position = step.add(&format!("IFCAXIS2PLACEMENT2D({centre},$)"));
    let circle = step.add(&format!("IFCCIRCLE({position},1.5)"));
    let arc = step.add(&format!(
        "IFCTRIMMEDCURVE({circle},({d}),({a}),.F.,.CARTESIAN.)"
    ));
    let s1 = step.add(&format!(
        "IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,{line})"
    ));
    let s2 = step.add(&format!("IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,{arc})"));
    let curve = step.add(&format!("IFCCOMPOSITECURVE(({s1},{s2}),.F.)"));
    let rep = step.add(&format!(
        "IFCSHAPEREPRESENTATION($,'FootPrint','Curve2D',({curve}))"
    ));
    let shape = step.add(&format!("IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))"));
    let space = step.add(&format!(
        "IFCSPACE('arc',$,'Round',$,$,#6,{shape},'Round',.ELEMENT.,.INTERNAL.,$)"
    ));
    step.spaces.push(space);
    let (plan, _) = convert(step.bytes());
    let room = elements(&plan, "rooms")[0];
    assert_eq!(room["outline"].as_array().unwrap().len(), 4, "{room}");
}

/// A file with storeys only, at these elevations (m), without placements.
fn storeys_at(elevations: &[f64]) -> Vec<f64> {
    let mut lines = vec![
        "IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)".to_owned(),
        "IFCUNITASSIGNMENT((#1))".to_owned(),
        "IFCPROJECT('project',$,'Project',$,$,$,$,$,#2)".to_owned(),
    ];
    for (i, e) in elevations.iter().enumerate() {
        lines.push(format!(
            "IFCBUILDINGSTOREY('s{i}',$,'Level {i}',$,$,$,$,$,.ELEMENT.,{e:?})"
        ));
    }
    let body: Vec<String> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| format!("#{}={l};", i + 1))
        .collect();
    let text = format!(
        "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",
        body.join("\n")
    );
    let file = IfcFile::read(text.into_bytes()).unwrap();
    file.storeys()
        .iter()
        .map(|s| (s.elevation * 10.0).round() / 10.0)
        .collect()
}

#[test]
fn storeys_are_measured_from_the_ground_floor() {
    // A cellar below the ground floor stays below it.
    assert_eq!(storeys_at(&[2.8, -2.6, 0.0]), [-260.0, 0.0, 280.0]);
    // A raised ground floor is still the ground floor.
    assert_eq!(storeys_at(&[-2.3, 0.5, 3.3]), [-280.0, 0.0, 280.0]);
    // Two as near: the lower one.
    assert_eq!(storeys_at(&[-1.0, 1.0]), [0.0, 200.0]);
    // Georeferenced, far above zero: from the lowest storey.
    assert_eq!(storeys_at(&[47.8, 45.0]), [0.0, 280.0]);
}
