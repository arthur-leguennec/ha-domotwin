//! DomoTwin's plan import (`DECISIONS.md` D-009, D-040, D-064): reads a file of another app, lists
//! its storeys and converts one into a DomoTwin plan. IFC files (ISO 16739: IFC2x3, IFC4, IFC4.3
//! subsets), Sweet Home 3D homes, DXF drawings, room scans (RoomPlan's USDZ or JSON), robot
//! vacuum maps (Valetudo's, Roborock's), Floorplanner plans (FML) and mesh scans (OBJ, PLY, GLB,
//! STL); each reader gives the plan builder (`build`) a draft. It is built as its own WebAssembly
//! module, which the frontend loads only to import a file.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod build;
pub mod convert;
pub mod dxf;
mod faces;
pub mod fml;
mod grid;
mod kinds;
pub mod math;
pub mod mesh_scan;
mod meshes;
pub mod model;
pub mod robot;
pub mod scan;
pub mod sh3d;
pub mod step;
mod unpack;
mod upkeep;
mod usda;
mod web;

pub use build::Report;
pub use convert::Storey;

use dxf::DxfFile;
use fml::FmlFile;
use mesh_scan::MeshScan;
use robot::RobotMap;
use scan::ScanFile;
use serde_json::Value as Json;
use sh3d::Sh3dFile;

use model::Model;
use step::{StepError, StepFile};

/// An IFC file, read and indexed.
#[derive(Debug)]
pub struct IfcFile {
    model: Model,
}

impl IfcFile {
    /// Reads a file.
    ///
    /// # Errors
    ///
    /// A stable code: `not_ifc` (not a STEP file, or no `IfcProject`), `too_large`,
    /// `no_storeys`.
    pub fn read(bytes: Vec<u8>) -> Result<Self, &'static str> {
        let step = StepFile::new(bytes).map_err(|e| match e {
            StepError::NotStep => "not_ifc",
            StepError::TooLarge => "too_large",
        })?;
        if step.of_type("IFCPROJECT").is_empty() {
            return Err("not_ifc");
        }
        if step.of_type("IFCBUILDINGSTOREY").is_empty() {
            return Err("no_storeys");
        }
        Ok(IfcFile {
            model: Model::new(step),
        })
    }

    /// The schema named by the file (`IFC4`, `IFC2X3`…).
    pub fn schema(&self) -> &str {
        &self.model.step.schema
    }

    /// The storeys, lowest first.
    pub fn storeys(&self) -> Vec<Storey> {
        convert::storeys(&self.model)
    }

    /// The plan of one storey (by its instance number), what was left out, and the upkeep cards
    /// of its pieces from what the file says of them (`DECISIONS.md`, D-033), by piece id.
    ///
    /// # Errors
    ///
    /// `no_storeys` for an unknown storey, `no_spaces` when it has no space with an outline.
    pub fn convert(
        &self,
        storey: u32,
    ) -> Result<
        (
            serde_json::Value,
            Report,
            serde_json::Map<String, serde_json::Value>,
        ),
        &'static str,
    > {
        if self.model.step.type_of(storey) != Some("IFCBUILDINGSTOREY") {
            return Err("no_storeys");
        }
        convert::convert(&self.model, storey)
    }
}

/// A file of another app, read: the format is found from its content.
#[derive(Debug)]
pub enum PlanFile {
    Ifc(Box<IfcFile>),
    Sh3d(Sh3dFile),
    Dxf(DxfFile),
    Scan(ScanFile),
    Robot(RobotMap),
    Fml(FmlFile),
    Mesh(MeshScan),
}

impl PlanFile {
    /// Reads a file; `title` names the plan when the file does not (the file's name).
    ///
    /// # Errors
    ///
    /// A stable code: `not_plan` (no format known), `too_large`, `no_storeys`, `not_ifc`,
    /// `sh3d_old` (saved before Sweet Home 3D 5.3), `dxf_binary`, `scan_usdz` (a scan's root layer
    /// alone, without the elements its USDZ holds), `scan_usdc` (a scan in USD's binary format),
    /// `picture` (a picture without a robot's map in it), `fml_xml` (Floorplanner's older XML),
    /// `mesh_points` (points without faces), `mesh_gltf` (a glTF with its buffers apart),
    /// `mesh_fbx`, `mesh_too_large` (past 5 million triangles), `external_reference` and
    /// `unsupported` (a GLB needing other files, or compressed).
    pub fn read(bytes: Vec<u8>, title: &str) -> Result<Self, &'static str> {
        // Valetudo's map in the PNG Home Assistant's camera receives.
        if unpack::is_png(&bytes) {
            return match unpack::png_text(&bytes, b"ValetudoMap")? {
                Some(json) => Self::from_json(&json, title),
                None => Err("picture"),
            };
        }
        // Roborock's map as Valetudo RE serves it, or any other file gzipped.
        if unpack::is_gzip(&bytes) {
            return Self::read_unpacked(unpack::gunzip(&bytes)?, title, false);
        }
        Self::read_unpacked(bytes, title, true)
    }

    /// Reads a file that is not a PNG or gzipped; `inflate` opens a zlib stream (Valetudo's map
    /// over MQTT).
    fn read_unpacked(bytes: Vec<u8>, title: &str, inflate: bool) -> Result<Self, &'static str> {
        let start = &bytes[..bytes.len().min(512)];
        let text = String::from_utf8_lossy(start);
        let trimmed = text.trim_start_matches('\u{feff}').trim_start();
        if step::is_step(&bytes) {
            return IfcFile::read(bytes).map(|f| PlanFile::Ifc(Box::new(f)));
        }
        if bytes.starts_with(b"PK\x03\x04") {
            // A Sweet Home 3D home, else a scan's USDZ.
            return match Sh3dFile::read(&bytes, title) {
                Err("not_plan") => ScanFile::from_usdz(&bytes, title).map(PlanFile::Scan),
                read => read.map(PlanFile::Sh3d),
            };
        }
        if trimmed.starts_with('{') {
            return Self::from_json(&bytes, title);
        }
        if trimmed.starts_with("#usda") {
            return Err("scan_usdz");
        }
        if bytes.starts_with(b"PXR-USDC") {
            return Err("scan_usdc");
        }
        if bytes.starts_with(b"AutoCAD Binary DXF") {
            return Err("dxf_binary");
        }
        if robot::is_rrmap(&bytes) {
            return RobotMap::from_rrmap(&bytes, title).map(PlanFile::Robot);
        }
        if bytes.starts_with(b"Kaydara FBX Binary") || trimmed.starts_with("; FBX") {
            return Err("mesh_fbx");
        }
        let mut lines = trimmed.lines().map(str::trim);
        // Past the comments (`999`) some apps write first.
        let mut code = lines.next();
        while code == Some("999") {
            lines.next();
            code = lines.next();
        }
        if code == Some("0") && lines.next() == Some("SECTION") {
            return DxfFile::read(&bytes, title).map(PlanFile::Dxf);
        }
        if let Some(format) = meshes::sniff(&bytes) {
            return MeshScan::read(&bytes, format, title).map(PlanFile::Mesh);
        }
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
        if fml::is_fml_xml(&head) {
            return Err("fml_xml");
        }
        // A broken stream is not one: what started like it was something else.
        if inflate && unpack::is_zlib(&bytes) {
            match unpack::zlib(&bytes) {
                Ok(inner) => return Self::read_unpacked(inner, title, false),
                Err("too_large") => return Err("too_large"),
                Err(_) => {}
            }
        }
        Err("not_plan")
    }

    /// Reads a JSON file: a Valetudo map, a Floorplanner project or a room scan.
    fn from_json(bytes: &[u8], title: &str) -> Result<Self, &'static str> {
        let body = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
        let root: Json = serde_json::from_slice(body).map_err(|_| "not_plan")?;
        let object = root.as_object().ok_or("not_plan")?;
        if robot::is_valetudo(object) {
            return RobotMap::from_valetudo(&root, title).map(PlanFile::Robot);
        }
        if fml::is_fml(object) {
            return FmlFile::from_value(&root, title).map(PlanFile::Fml);
        }
        if object.contains_key("asset") && object.contains_key("meshes") {
            return Err("mesh_gltf");
        }
        ScanFile::from_value(&root, title).map(PlanFile::Scan)
    }

    /// The format: `ifc`, `sh3d`, `dxf`, `scan`, `robot`, `fml` or `mesh`.
    pub fn format(&self) -> &'static str {
        match self {
            PlanFile::Ifc(_) => "ifc",
            PlanFile::Sh3d(_) => "sh3d",
            PlanFile::Dxf(_) => "dxf",
            PlanFile::Scan(_) => "scan",
            PlanFile::Robot(_) => "robot",
            PlanFile::Fml(_) => "fml",
            PlanFile::Mesh(_) => "mesh",
        }
    }

    /// The storeys, lowest first.
    pub fn storeys(&self) -> Vec<Storey> {
        match self {
            PlanFile::Ifc(f) => f.storeys(),
            PlanFile::Sh3d(f) => f.storeys(),
            PlanFile::Dxf(f) => f.storeys(),
            PlanFile::Scan(f) => f.storeys(),
            PlanFile::Robot(f) => f.storeys(),
            PlanFile::Fml(f) => f.storeys(),
            PlanFile::Mesh(f) => f.storeys(),
        }
    }

    /// The plan of a storey, what was left out, and the upkeep cards the file fills by piece id.
    ///
    /// # Errors
    ///
    /// `no_storeys` for an unknown storey, `no_spaces` when it has no room.
    pub fn convert(
        &self,
        storey: u32,
    ) -> Result<
        (
            serde_json::Value,
            Report,
            serde_json::Map<String, serde_json::Value>,
        ),
        &'static str,
    > {
        match self {
            PlanFile::Ifc(f) => f.convert(storey),
            PlanFile::Sh3d(f) => f.convert(storey),
            PlanFile::Dxf(f) => f.convert(storey),
            PlanFile::Scan(f) => f.convert(storey),
            PlanFile::Robot(f) => f.convert(storey),
            PlanFile::Fml(f) => f.convert(storey),
            PlanFile::Mesh(f) => f.convert(storey),
        }
    }
}
